# Portfolio Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a passkey-authenticated admin panel to thunderborn.dev so the owner can create/edit blog posts and manage tools from the browser without redeploying.

**Architecture:** Convert Astro from `output: 'static'` to `output: 'server'` with `@astrojs/node` standalone adapter. All pages are SSR by default; `/` and `/about` opt back into prerendering. Blog, tools, and all admin pages query SQLite (better-sqlite3) at request time so content changes are instant. A middleware guards `/admin/*` and `/api/*` (except `/api/auth/*`) with an HttpOnly session cookie.

**Tech Stack:** Astro 6, `@astrojs/node`, `better-sqlite3`, `@simplewebauthn/server` v13, `@simplewebauthn/browser` v13, `@tiptap/core` v2 + `@tiptap/starter-kit` + `@tiptap/extension-link`, Node.js 22, Docker multi-stage build

---

## File Map

```
src/
  lib/
    db.ts                          CREATE — all SQLite operations + schema
  middleware.ts                    CREATE — session guard + setup-token logger
  layouts/
    Base.astro                     unchanged
    AdminBase.astro                CREATE — admin sidebar layout
  pages/
    index.astro                    MODIFY — add export const prerender = true
    about.astro                    MODIFY — add export const prerender = true
    tools.astro                    MODIFY — read from SQLite
    blog/
      index.astro                  MODIFY — read from SQLite
      [id].astro                   MODIFY — read from SQLite
    admin/
      index.astro                  CREATE — dashboard
      login.astro                  CREATE — passkey login
      setup.astro                  CREATE — first-time passkey registration
      tools.astro                  CREATE — tools CRUD
      passkeys.astro               CREATE — passkey management
      posts/
        new.astro                  CREATE — new post editor
        [id].astro                 CREATE — edit post
    api/
      auth/
        login-challenge.ts         CREATE — GET: generate auth challenge
        verify-login.ts            CREATE — POST: verify assertion + set cookie
        register-challenge.ts      CREATE — GET: generate registration challenge
        verify-registration.ts     CREATE — POST: verify registration + store credential
        logout.ts                  CREATE — POST: clear session cookie
      posts/
        index.ts                   CREATE — POST: create post
        [id].ts                    CREATE — PUT: update, DELETE: delete
      tools/
        index.ts                   CREATE — POST: create tool
        [id].ts                    CREATE — PUT: update, DELETE: delete
      passkeys/
        [id].ts                    CREATE — DELETE: delete passkey
  content.config.ts                DELETE
  content/blog/.gitkeep            DELETE
astro.config.mjs                   MODIFY — output: server + node adapter
package.json                       MODIFY — add dependencies
Dockerfile                         CREATE — multi-stage Node.js build
docker-compose.yml                 MODIFY — Node.js container + data volume
deploy.sh                          MODIFY — git push + SSH rebuild
.env.example                       CREATE
nginx.conf                         DELETE — portfolio is now Node.js, not nginx
vigilant-vps/nginx/thunderborn.conf MODIFY — upstream port 3000
```

---

### Task 0: Install dependencies and configure Astro for SSR

**Goal:** Install all required packages and switch Astro from static to server output with Node adapter; mark the two static pages as prerendered.

**Files:**
- Modify: `package.json`
- Modify: `astro.config.mjs`
- Modify: `src/pages/index.astro` (add prerender export)
- Modify: `src/pages/about.astro` (add prerender export)
- Create: `.env.example`
- Modify: `.gitignore` (add `data/`)

**Acceptance Criteria:**
- [ ] `npm run build` succeeds and `dist/server/entry.mjs` exists
- [ ] `dist/client/` contains static assets (CSS, JS)
- [ ] No TypeScript errors

**Verify:** `npm run build && ls dist/server/entry.mjs` → file exists

**Steps:**

- [ ] **Step 1: Install dependencies**

```bash
cd ~/Documents/Personal/Portfolio
npm install @astrojs/node better-sqlite3 @simplewebauthn/server @simplewebauthn/browser @tiptap/core @tiptap/starter-kit @tiptap/extension-link
npm install --save-dev @types/better-sqlite3
```

- [ ] **Step 2: Update `astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  site: 'https://thunderborn.dev',
});
```

- [ ] **Step 3: Add prerender export to `src/pages/index.astro`**

Add this as the first line of the frontmatter (inside the `---` block):

```astro
---
export const prerender = true;
import Base from '../layouts/Base.astro';
---
```

- [ ] **Step 4: Add prerender export to `src/pages/about.astro`**

```astro
---
export const prerender = true;
import Base from '../layouts/Base.astro';
---
```

- [ ] **Step 5: Create `.env.example`**

```
# WebAuthn settings — must match your domain
RP_ID=thunderborn.dev
RP_NAME=thunderborn.dev
ORIGIN=https://thunderborn.dev

# SQLite database path (Docker volume)
DB_PATH=/app/data/db.sqlite

# Node server settings (set by docker-compose)
PORT=3000
HOST=0.0.0.0
```

- [ ] **Step 6: Add `data/` to `.gitignore`**

Append to `.gitignore`:
```
data/
```

- [ ] **Step 7: Build and verify**

```bash
npm run build
ls dist/server/entry.mjs
```

Expected: file exists, no build errors.

- [ ] **Step 8: Commit**

```bash
git add astro.config.mjs package.json package-lock.json src/pages/index.astro src/pages/about.astro .env.example .gitignore
git commit -m "feat: switch to Astro SSR with Node adapter"
```

---

### Task 1: Database layer

**Goal:** Create `src/lib/db.ts` with all SQLite operations — schema init, seeding, and typed query functions for posts, tools, passkeys, sessions, challenges, and setup tokens.

**Files:**
- Create: `src/lib/db.ts`

**Acceptance Criteria:**
- [ ] `npm run build` succeeds with no TypeScript errors
- [ ] Schema creates 6 tables: `posts`, `tools`, `passkey_credentials`, `sessions`, `challenges`, `setup_tokens`
- [ ] Vigilant tool entry seeded on first run when tools table is empty
- [ ] All exported functions have correct TypeScript signatures

**Verify:** `npm run build` → no errors

**Steps:**

- [ ] **Step 1: Create `src/lib/db.ts`**

```typescript
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DB_PATH = process.env.DB_PATH ?? join(process.cwd(), 'data', 'db.sqlite');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  seedIfEmpty(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      content_html TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      published INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      description TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      display_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS passkey_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credential_id BLOB NOT NULL UNIQUE,
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challenges (
      token TEXT PRIMARY KEY,
      challenge TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS setup_tokens (
      token TEXT PRIMARY KEY,
      used INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
}

function seedIfEmpty(db: Database.Database) {
  const { n } = db.prepare('SELECT COUNT(*) as n FROM tools').get() as { n: number };
  if (n > 0) return;
  db.prepare(`
    INSERT INTO tools (name, url, description, tags, display_order, active)
    VALUES (?, ?, ?, ?, 0, 1)
  `).run(
    'Vigilant',
    'https://vigilant.thunderborn.dev',
    'EVE Online companion dashboard — multi-character overview, interactive star map, ship fitting tool, intel, and more.',
    JSON.stringify(['Python', 'React', 'EVE ESI']),
  );
}

// ── Posts ─────────────────────────────────────────────────────────────────────

export interface Post {
  id: number;
  title: string;
  slug: string;
  content_html: string;
  summary: string;
  published: number;
  created_at: number;
  updated_at: number;
}

export function listPosts(publishedOnly = false): Post[] {
  const db = getDb();
  if (publishedOnly) {
    return db.prepare('SELECT * FROM posts WHERE published = 1 ORDER BY created_at DESC').all() as Post[];
  }
  return db.prepare('SELECT * FROM posts ORDER BY created_at DESC').all() as Post[];
}

export function getPostBySlug(slug: string): Post | undefined {
  return getDb().prepare('SELECT * FROM posts WHERE slug = ?').get(slug) as Post | undefined;
}

export function getPostById(id: number): Post | undefined {
  return getDb().prepare('SELECT * FROM posts WHERE id = ?').get(id) as Post | undefined;
}

export function createPost(data: {
  title: string; slug: string; content_html: string; summary: string; published: number;
}): number {
  const now = Math.floor(Date.now() / 1000);
  const result = getDb().prepare(`
    INSERT INTO posts (title, slug, content_html, summary, published, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(data.title, data.slug, data.content_html, data.summary, data.published, now, now);
  return result.lastInsertRowid as number;
}

export function updatePost(id: number, data: {
  title: string; slug: string; content_html: string; summary: string; published: number;
}): void {
  const now = Math.floor(Date.now() / 1000);
  getDb().prepare(`
    UPDATE posts SET title=?, slug=?, content_html=?, summary=?, published=?, updated_at=? WHERE id=?
  `).run(data.title, data.slug, data.content_html, data.summary, data.published, now, id);
}

export function deletePost(id: number): void {
  getDb().prepare('DELETE FROM posts WHERE id = ?').run(id);
}

// ── Tools ─────────────────────────────────────────────────────────────────────

export interface Tool {
  id: number;
  name: string;
  url: string;
  description: string;
  tags: string;
  display_order: number;
  active: number;
}

export function listTools(activeOnly = false): Tool[] {
  const db = getDb();
  if (activeOnly) {
    return db.prepare('SELECT * FROM tools WHERE active = 1 ORDER BY display_order ASC').all() as Tool[];
  }
  return db.prepare('SELECT * FROM tools ORDER BY display_order ASC').all() as Tool[];
}

export function getToolById(id: number): Tool | undefined {
  return getDb().prepare('SELECT * FROM tools WHERE id = ?').get(id) as Tool | undefined;
}

export function createTool(data: {
  name: string; url: string; description: string; tags: string; display_order: number;
}): void {
  getDb().prepare(`
    INSERT INTO tools (name, url, description, tags, display_order, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(data.name, data.url, data.description, data.tags, data.display_order);
}

export function updateTool(id: number, data: {
  name: string; url: string; description: string; tags: string; display_order: number; active: number;
}): void {
  getDb().prepare(`
    UPDATE tools SET name=?, url=?, description=?, tags=?, display_order=?, active=? WHERE id=?
  `).run(data.name, data.url, data.description, data.tags, data.display_order, data.active, id);
}

export function deleteTool(id: number): void {
  getDb().prepare('DELETE FROM tools WHERE id = ?').run(id);
}

// ── Passkeys ──────────────────────────────────────────────────────────────────

export interface PasskeyCredential {
  id: number;
  credential_id: Buffer;
  public_key: Buffer;
  counter: number;
  name: string;
  created_at: number;
}

export function listPasskeys(): PasskeyCredential[] {
  return getDb().prepare('SELECT * FROM passkey_credentials ORDER BY created_at ASC').all() as PasskeyCredential[];
}

export function getPasskeyByCredentialId(credentialId: Uint8Array): PasskeyCredential | undefined {
  return getDb().prepare('SELECT * FROM passkey_credentials WHERE credential_id = ?').get(
    Buffer.from(credentialId),
  ) as PasskeyCredential | undefined;
}

export function createPasskey(data: {
  credential_id: Uint8Array; public_key: Uint8Array; counter: number; name: string;
}): void {
  const now = Math.floor(Date.now() / 1000);
  getDb().prepare(`
    INSERT INTO passkey_credentials (credential_id, public_key, counter, name, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(Buffer.from(data.credential_id), Buffer.from(data.public_key), data.counter, data.name, now);
}

export function updatePasskeyCounter(id: number, counter: number): void {
  getDb().prepare('UPDATE passkey_credentials SET counter = ? WHERE id = ?').run(counter, id);
}

export function deletePasskey(id: number): void {
  getDb().prepare('DELETE FROM passkey_credentials WHERE id = ?').run(id);
}

export function countPasskeys(): number {
  return (getDb().prepare('SELECT COUNT(*) as n FROM passkey_credentials').get() as { n: number }).n;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function createSession(): string {
  const id = randomBytes(32).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  getDb().prepare('INSERT INTO sessions (id, expires_at) VALUES (?, ?)').run(id, expiresAt);
  return id;
}

export function validateSession(id: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  return !!getDb().prepare('SELECT id FROM sessions WHERE id = ? AND expires_at > ?').get(id, now);
}

export function deleteSession(id: string): void {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

// ── Challenges (WebAuthn) ─────────────────────────────────────────────────────

export function storeChallenge(challenge: string): string {
  const db = getDb();
  const token = randomBytes(16).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + 120;
  db.prepare('DELETE FROM challenges WHERE expires_at < ?').run(Math.floor(Date.now() / 1000));
  db.prepare('INSERT INTO challenges (token, challenge, expires_at) VALUES (?, ?, ?)').run(token, challenge, expiresAt);
  return token;
}

export function consumeChallenge(token: string): string | null {
  const now = Math.floor(Date.now() / 1000);
  const row = getDb().prepare('SELECT challenge FROM challenges WHERE token = ? AND expires_at > ?').get(token, now) as { challenge: string } | undefined;
  if (!row) return null;
  getDb().prepare('DELETE FROM challenges WHERE token = ?').run(token);
  return row.challenge;
}

// ── Setup tokens (first-time passkey registration) ────────────────────────────

export function getOrCreateSetupToken(): string {
  const db = getDb();
  const existing = db.prepare('SELECT token FROM setup_tokens WHERE used = 0').get() as { token: string } | undefined;
  if (existing) return existing.token;
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO setup_tokens (token, used, created_at) VALUES (?, 0, ?)').run(token, Math.floor(Date.now() / 1000));
  return token;
}

export function isSetupTokenValid(token: string): boolean {
  if (countPasskeys() > 0) return false;
  return !!getDb().prepare('SELECT token FROM setup_tokens WHERE token = ? AND used = 0').get(token);
}

export function consumeSetupToken(token: string): boolean {
  if (!isSetupTokenValid(token)) return false;
  getDb().prepare('UPDATE setup_tokens SET used = 1 WHERE token = ?').run(token);
  return true;
}
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: no TypeScript errors, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: add SQLite database layer"
```

---

### Task 2: Auth middleware

**Goal:** Create `src/middleware.ts` that guards all `/admin/*` and `/api/*` routes (except `/api/auth/*`) with a session cookie check, and logs the first-time setup token to stdout on the first request if no passkeys are registered.

**Files:**
- Create: `src/middleware.ts`

**Acceptance Criteria:**
- [ ] Requests to `/admin` without a session cookie redirect to `/admin/login`
- [ ] Requests to `/api/posts` without a session cookie return 401 JSON
- [ ] Requests to `/api/auth/login-challenge` pass through without auth check
- [ ] On first request when no passkeys registered, setup token is logged to stdout
- [ ] `npm run build` succeeds

**Verify:** `npm run build` → no errors; `npm run dev` → `curl -s http://localhost:4321/admin` returns redirect to `/admin/login`

**Steps:**

- [ ] **Step 1: Create `src/middleware.ts`**

```typescript
import { defineMiddleware } from 'astro:middleware';
import { validateSession, countPasskeys, getOrCreateSetupToken } from './lib/db';

let setupTokenLogged = false;

export const onRequest = defineMiddleware(async (context, next) => {
  if (!setupTokenLogged) {
    setupTokenLogged = true;
    if (countPasskeys() === 0) {
      const token = getOrCreateSetupToken();
      console.log(`[portfolio] No passkeys registered.`);
      console.log(`[portfolio] Setup token: ${token}`);
      console.log(`[portfolio] Visit https://thunderborn.dev/admin/setup?token=${token}`);
    }
  }

  const { pathname } = context.url;
  const isAdminRoute = pathname.startsWith('/admin') && pathname !== '/admin/login' && !pathname.startsWith('/admin/setup');
  const isProtectedApi = pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/');

  if (isAdminRoute || isProtectedApi) {
    const sessionId = context.cookies.get('session')?.value;
    const valid = sessionId ? validateSession(sessionId) : false;
    if (!valid) {
      if (isProtectedApi) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return context.redirect('/admin/login');
    }
  }

  return next();
});
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Quick smoke test**

```bash
npm run dev &
sleep 3
curl -sv http://localhost:4321/admin 2>&1 | grep -E 'Location|HTTP/'
# Expected: HTTP/1.1 302 and Location: /admin/login
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: add auth middleware with session guard and setup token logger"
```

---

### Task 3: WebAuthn API endpoints

**Goal:** Implement the five `/api/auth/*` endpoints that handle passkey login challenge/verify, registration challenge/verify, and logout.

**Files:**
- Create: `src/pages/api/auth/login-challenge.ts`
- Create: `src/pages/api/auth/verify-login.ts`
- Create: `src/pages/api/auth/register-challenge.ts`
- Create: `src/pages/api/auth/verify-registration.ts`
- Create: `src/pages/api/auth/logout.ts`

**Acceptance Criteria:**
- [ ] `GET /api/auth/login-challenge` returns JSON with WebAuthn options and a challenge token
- [ ] `POST /api/auth/verify-login` with valid assertion returns 200 + sets `session` cookie
- [ ] `GET /api/auth/register-challenge?token=<valid>` returns registration options
- [ ] `GET /api/auth/register-challenge?token=<invalid>` returns 403
- [ ] `POST /api/auth/verify-registration` stores credential and returns 200
- [ ] `POST /api/auth/logout` clears the session cookie
- [ ] `npm run build` succeeds

**Verify:** `npm run build` → no errors

**Steps:**

- [ ] **Step 1: Create `src/pages/api/auth/login-challenge.ts`**

```typescript
import type { APIRoute } from 'astro';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { listPasskeys, storeChallenge } from '../../../lib/db';

const RP_ID = process.env.RP_ID ?? 'thunderborn.dev';

export const GET: APIRoute = async () => {
  const passkeys = listPasskeys();
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    allowCredentials: passkeys.map(p => ({
      id: new Uint8Array(p.credential_id),
      type: 'public-key' as const,
    })),
  });
  const challengeToken = storeChallenge(options.challenge);
  return new Response(JSON.stringify({ challengeToken, options }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
```

- [ ] **Step 2: Create `src/pages/api/auth/verify-login.ts`**

```typescript
import type { APIRoute } from 'astro';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import {
  consumeChallenge, getPasskeyByCredentialId,
  updatePasskeyCounter, createSession,
} from '../../../lib/db';

const RP_ID = process.env.RP_ID ?? 'thunderborn.dev';
const ORIGIN = process.env.ORIGIN ?? 'https://thunderborn.dev';

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { challengeToken: string; response: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const challenge = consumeChallenge(body.challengeToken);
  if (!challenge) {
    return new Response(JSON.stringify({ error: 'Challenge expired or invalid' }), { status: 400 });
  }

  const authResponse = body.response as Parameters<typeof verifyAuthenticationResponse>[0]['response'];
  const credentialId = new Uint8Array(Buffer.from(authResponse.rawId, 'base64url'));
  const passkey = getPasskeyByCredentialId(credentialId);
  if (!passkey) {
    return new Response(JSON.stringify({ error: 'Passkey not found' }), { status: 400 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: new Uint8Array(passkey.credential_id),
        publicKey: new Uint8Array(passkey.public_key),
        counter: passkey.counter,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Verification failed' }), { status: 400 });
  }

  if (!verification.verified) {
    return new Response(JSON.stringify({ error: 'Not verified' }), { status: 401 });
  }

  updatePasskeyCounter(passkey.id, verification.authenticationInfo.newCounter);
  const sessionId = createSession();
  cookies.set('session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
```

- [ ] **Step 3: Create `src/pages/api/auth/register-challenge.ts`**

```typescript
import type { APIRoute } from 'astro';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { isSetupTokenValid, listPasskeys, storeChallenge, validateSession } from '../../../lib/db';

const RP_ID = process.env.RP_ID ?? 'thunderborn.dev';
const RP_NAME = process.env.RP_NAME ?? 'thunderborn.dev';

export const GET: APIRoute = async ({ url, cookies }) => {
  // Allow if authenticated admin OR valid setup token
  const sessionId = cookies.get('session')?.value;
  const isAdmin = sessionId ? validateSession(sessionId) : false;
  const setupToken = url.searchParams.get('token') ?? '';
  const isSetup = isSetupTokenValid(setupToken);

  if (!isAdmin && !isSetup) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const existingPasskeys = listPasskeys();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: 'admin',
    userDisplayName: 'Admin',
    attestationType: 'none',
    excludeCredentials: existingPasskeys.map(p => ({
      id: new Uint8Array(p.credential_id),
      type: 'public-key' as const,
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });
  const challengeToken = storeChallenge(options.challenge);
  return new Response(JSON.stringify({ challengeToken, options, setupToken }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
```

- [ ] **Step 4: Create `src/pages/api/auth/verify-registration.ts`**

```typescript
import type { APIRoute } from 'astro';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import {
  consumeChallenge, isSetupTokenValid, consumeSetupToken,
  createPasskey, createSession, validateSession,
} from '../../../lib/db';

const RP_ID = process.env.RP_ID ?? 'thunderborn.dev';
const ORIGIN = process.env.ORIGIN ?? 'https://thunderborn.dev';

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { challengeToken: string; setupToken?: string; name: string; response: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const sessionId = cookies.get('session')?.value;
  const isAdmin = sessionId ? validateSession(sessionId) : false;
  const isSetup = body.setupToken ? isSetupTokenValid(body.setupToken) : false;
  if (!isAdmin && !isSetup) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const challenge = consumeChallenge(body.challengeToken);
  if (!challenge) {
    return new Response(JSON.stringify({ error: 'Challenge expired or invalid' }), { status: 400 });
  }

  const regResponse = body.response as Parameters<typeof verifyRegistrationResponse>[0]['response'];
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: regResponse,
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Verification failed' }), { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return new Response(JSON.stringify({ error: 'Not verified' }), { status: 401 });
  }

  const { credential } = verification.registrationInfo;
  createPasskey({
    credential_id: credential.id,
    public_key: credential.publicKey,
    counter: credential.counter,
    name: body.name || 'Passkey',
  });

  if (body.setupToken) {
    consumeSetupToken(body.setupToken);
    const sessionId = createSession();
    cookies.set('session', sessionId, {
      httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 7 * 24 * 60 * 60,
    });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
```

- [ ] **Step 5: Create `src/pages/api/auth/logout.ts`**

```typescript
import type { APIRoute } from 'astro';
import { deleteSession } from '../../../lib/db';

export const POST: APIRoute = async ({ cookies }) => {
  const sessionId = cookies.get('session')?.value;
  if (sessionId) {
    deleteSession(sessionId);
    cookies.delete('session', { path: '/' });
  }
  return new Response(null, { status: 302, headers: { Location: '/admin/login' } });
};
```

- [ ] **Step 6: Build and verify**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/api/auth/
git commit -m "feat: add WebAuthn passkey auth API endpoints"
```

---

### Task 4: Admin login and setup pages

**Goal:** Build the `AdminBase.astro` layout and the two unauthenticated admin pages: `/admin/login` (passkey sign-in) and `/admin/setup` (first-time passkey registration protected by a one-time token).

**Files:**
- Create: `src/layouts/AdminBase.astro`
- Create: `src/pages/admin/login.astro`
- Create: `src/pages/admin/setup.astro`

**Acceptance Criteria:**
- [ ] `/admin/login` renders a "Sign in with passkey" button
- [ ] Clicking the button triggers WebAuthn, on success redirects to `/admin`
- [ ] `/admin/setup?token=<invalid>` shows "Setup already complete" message
- [ ] `/admin/setup?token=<valid>` shows passkey registration form
- [ ] Successful registration on `/admin/setup` redirects to `/admin`
- [ ] `npm run build` succeeds

**Verify:** `npm run dev` → visit `/admin`, confirm redirect to `/admin/login`; page renders without JS errors.

**Steps:**

- [ ] **Step 1: Create `src/layouts/AdminBase.astro`**

```astro
---
import '../styles/global.css';
interface Props { title: string; }
const { title } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title} — Admin</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head>
  <body>
    <div class="admin-shell">
      <nav class="admin-nav">
        <a href="/" class="wordmark">thunderborn.dev</a>
        <div class="admin-links">
          <a href="/admin">Dashboard</a>
          <a href="/admin/posts/new">New Post</a>
          <a href="/admin/tools">Tools</a>
          <a href="/admin/passkeys">Passkeys</a>
          <form method="POST" action="/api/auth/logout" style="display:inline">
            <button type="submit" class="signout-btn">Sign out</button>
          </form>
        </div>
      </nav>
      <main class="admin-main">
        <slot />
      </main>
    </div>
  </body>
</html>

<style>
  .admin-shell { display: flex; flex-direction: column; min-height: 100vh; }
  .admin-nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1.5rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .wordmark { font-weight: 600; font-size: 0.9rem; letter-spacing: 0.02em; }
  .admin-links { display: flex; gap: 1.25rem; align-items: center; font-size: 0.8rem; color: var(--text-muted); }
  .admin-links a:hover { color: var(--text-secondary); }
  .signout-btn {
    background: none; border: 1px solid var(--border); border-radius: 3px;
    color: var(--text-muted); font-size: 0.8rem; padding: 0.2rem 0.5rem;
    cursor: pointer; transition: color 0.15s;
  }
  .signout-btn:hover { color: var(--text-secondary); }
  .admin-main { flex: 1; padding: 2rem 1.5rem; max-width: 900px; width: 100%; }
</style>
```

- [ ] **Step 2: Create `src/pages/admin/login.astro`**

```astro
---
import '../../../styles/global.css';
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sign in — thunderborn.dev</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head>
  <body>
    <main class="login-wrap">
      <p class="site-label">thunderborn.dev</p>
      <h1>Admin</h1>
      <p class="hint">Use your registered passkey to sign in.</p>
      <button id="signin-btn" class="btn-primary">Sign in with passkey</button>
      <p id="error-msg" class="error-msg" hidden></p>
    </main>
  </body>
</html>

<style>
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .login-wrap { text-align: center; max-width: 320px; }
  .site-label { color: var(--text-muted); font-size: 0.8rem; margin: 0 0 0.5rem; }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
  .hint { color: var(--text-muted); font-size: 0.8rem; margin: 0 0 1.5rem; }
  .btn-primary {
    background: var(--text); color: var(--bg); border: none; border-radius: 4px;
    padding: 0.6rem 1.5rem; font-size: 0.875rem; font-weight: 600; cursor: pointer;
    transition: opacity 0.15s; width: 100%;
  }
  .btn-primary:hover { opacity: 0.85; }
  .btn-primary:disabled { opacity: 0.5; cursor: default; }
  .error-msg { color: #f87171; font-size: 0.8rem; margin-top: 1rem; }
</style>

<script>
  import { startAuthentication } from '@simplewebauthn/browser';

  const btn = document.getElementById('signin-btn') as HTMLButtonElement;
  const errEl = document.getElementById('error-msg') as HTMLElement;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    errEl.hidden = true;
    try {
      const res = await fetch('/api/auth/login-challenge');
      const { challengeToken, options } = await res.json();
      const authResponse = await startAuthentication({ optionsJSON: options });
      const verify = await fetch('/api/auth/verify-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken, response: authResponse }),
      });
      if (verify.ok) {
        window.location.href = '/admin';
      } else {
        const { error } = await verify.json();
        throw new Error(error ?? 'Sign-in failed');
      }
    } catch (err: unknown) {
      errEl.textContent = err instanceof Error ? err.message : 'Sign-in failed';
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
</script>
```

- [ ] **Step 3: Create `src/pages/admin/setup.astro`**

```astro
---
import { isSetupTokenValid } from '../../lib/db';

const token = Astro.url.searchParams.get('token') ?? '';
const valid = isSetupTokenValid(token);
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Setup — thunderborn.dev</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <style>
      :root { --bg:#0f0f0f;--surface:#1a1a1a;--border:#262626;--text:#fafafa;--text-secondary:#a3a3a3;--text-muted:#525252; }
      *,*::before,*::after{box-sizing:border-box}
      body{background:var(--bg);color:var(--text);font-family:system-ui,sans-serif;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;}
      .wrap{text-align:center;max-width:360px;padding:1rem;}
      h1{font-size:1.25rem;font-weight:600;margin:0 0 0.5rem;}
      p{color:var(--text-muted);font-size:0.85rem;margin:0 0 1rem;}
      input{width:100%;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:0.5rem 0.75rem;color:var(--text);font-size:0.875rem;margin-bottom:0.75rem;}
      .btn{background:var(--text);color:var(--bg);border:none;border-radius:4px;padding:0.6rem 1.5rem;font-size:0.875rem;font-weight:600;cursor:pointer;width:100%;transition:opacity 0.15s;}
      .btn:disabled{opacity:0.5;}
      .error{color:#f87171;font-size:0.8rem;margin-top:0.75rem;}
    </style>
  </head>
  <body>
    <div class="wrap">
      {valid ? (
        <>
          <h1>Register your passkey</h1>
          <p>Give this passkey a name, then follow your device prompt.</p>
          <input type="text" id="passkey-name" placeholder="e.g. MacBook Touch ID" value="My Passkey" />
          <button id="register-btn" class="btn">Register passkey</button>
          <p id="error-msg" class="error" hidden></p>
        </>
      ) : (
        <>
          <h1>Setup complete</h1>
          <p>A passkey is already registered. <a href="/admin/login" style="color:inherit;text-decoration:underline">Sign in</a>.</p>
        </>
      )}
    </div>

  </body>
</html>

<script>
  import { startRegistration } from '@simplewebauthn/browser';

  const btn = document.getElementById('register-btn') as HTMLButtonElement | null;
  if (!btn) { /* not valid — do nothing */ }
  else {
    const nameInput = document.getElementById('passkey-name') as HTMLInputElement;
    const errEl = document.getElementById('error-msg') as HTMLElement;
    const params = new URLSearchParams(window.location.search);
    const setupToken = params.get('token') ?? '';

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      errEl.hidden = true;
      try {
        const res = await fetch(`/api/auth/register-challenge?token=${setupToken}`);
        if (!res.ok) throw new Error('Invalid setup token');
        const { challengeToken, options } = await res.json();
        const regResponse = await startRegistration({ optionsJSON: options });
        const verify = await fetch('/api/auth/verify-registration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challengeToken,
            setupToken,
            name: nameInput.value || 'Passkey',
            response: regResponse,
          }),
        });
        if (verify.ok) {
          window.location.href = '/admin';
        } else {
          const { error } = await verify.json();
          throw new Error(error ?? 'Registration failed');
        }
      } catch (err: unknown) {
        errEl.textContent = err instanceof Error ? err.message : 'Registration failed';
        errEl.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });
  }
</script>
```

- [ ] **Step 4: Build and verify**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/layouts/AdminBase.astro src/pages/admin/login.astro src/pages/admin/setup.astro
git commit -m "feat: add admin login and first-time passkey setup pages"
```

---

### Task 5: Content API endpoints

**Goal:** Implement REST API routes for creating, updating, and deleting posts, tools, and passkeys. All are protected by the middleware session guard.

**Files:**
- Create: `src/pages/api/posts/index.ts`
- Create: `src/pages/api/posts/[id].ts`
- Create: `src/pages/api/tools/index.ts`
- Create: `src/pages/api/tools/[id].ts`
- Create: `src/pages/api/passkeys/[id].ts`

**Acceptance Criteria:**
- [ ] `POST /api/posts` with valid FormData creates a post and returns 302 to `/admin`
- [ ] `PUT /api/posts/123` with valid FormData updates the post and returns 302 to `/admin`
- [ ] `DELETE /api/posts/123` deletes the post and returns 200 JSON
- [ ] Same patterns for tools and passkeys
- [ ] Missing slug returns 400; slug collision returns 409
- [ ] `npm run build` succeeds

**Verify:** `npm run build` → no errors

**Steps:**

- [ ] **Step 1: Create `src/pages/api/posts/index.ts`**

```typescript
import type { APIRoute } from 'astro';
import { createPost, getPostBySlug } from '../../../lib/db';

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const title = (form.get('title') as string)?.trim();
  const slug = (form.get('slug') as string)?.trim();
  const content_html = (form.get('content_html') as string) ?? '';
  const summary = (form.get('summary') as string)?.trim() ?? '';
  const published = form.get('published') === '1' ? 1 : 0;

  if (!title || !slug) {
    return new Response(JSON.stringify({ error: 'Title and slug are required' }), { status: 400 });
  }
  if (getPostBySlug(slug)) {
    return new Response(JSON.stringify({ error: 'Slug already in use' }), { status: 409 });
  }

  createPost({ title, slug, content_html, summary, published });
  return new Response(null, { status: 302, headers: { Location: '/admin' } });
};
```

- [ ] **Step 2: Create `src/pages/api/posts/[id].ts`**

```typescript
import type { APIRoute } from 'astro';
import { getPostById, updatePost, deletePost, getPostBySlug } from '../../../lib/db';

export const PUT: APIRoute = async ({ params, request }) => {
  const id = parseInt(params.id ?? '');
  if (!id || !getPostById(id)) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }

  const form = await request.formData();
  const title = (form.get('title') as string)?.trim();
  const slug = (form.get('slug') as string)?.trim();
  const content_html = (form.get('content_html') as string) ?? '';
  const summary = (form.get('summary') as string)?.trim() ?? '';
  const published = form.get('published') === '1' ? 1 : 0;

  if (!title || !slug) {
    return new Response(JSON.stringify({ error: 'Title and slug are required' }), { status: 400 });
  }

  const existing = getPostBySlug(slug);
  if (existing && existing.id !== id) {
    return new Response(JSON.stringify({ error: 'Slug already in use' }), { status: 409 });
  }

  updatePost(id, { title, slug, content_html, summary, published });
  return new Response(null, { status: 302, headers: { Location: '/admin' } });
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = parseInt(params.id ?? '');
  if (!id) return new Response(JSON.stringify({ error: 'Invalid id' }), { status: 400 });
  deletePost(id);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
```

- [ ] **Step 3: Create `src/pages/api/tools/index.ts`**

```typescript
import type { APIRoute } from 'astro';
import { createTool, listTools } from '../../../lib/db';

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const name = (form.get('name') as string)?.trim();
  const url = (form.get('url') as string)?.trim();
  const description = (form.get('description') as string)?.trim() ?? '';
  const tagsRaw = (form.get('tags') as string)?.trim() ?? '';
  const tags = JSON.stringify(tagsRaw.split(',').map(t => t.trim()).filter(Boolean));
  const tools = listTools();
  const display_order = tools.length > 0 ? Math.max(...tools.map(t => t.display_order)) + 1 : 0;

  if (!name || !url) {
    return new Response(JSON.stringify({ error: 'Name and URL are required' }), { status: 400 });
  }

  createTool({ name, url, description, tags, display_order });
  return new Response(null, { status: 302, headers: { Location: '/admin/tools' } });
};
```

- [ ] **Step 4: Create `src/pages/api/tools/[id].ts`**

```typescript
import type { APIRoute } from 'astro';
import { getToolById, updateTool, deleteTool } from '../../../lib/db';

export const PUT: APIRoute = async ({ params, request }) => {
  const id = parseInt(params.id ?? '');
  if (!id || !getToolById(id)) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }

  const form = await request.formData();
  const name = (form.get('name') as string)?.trim();
  const url = (form.get('url') as string)?.trim();
  const description = (form.get('description') as string)?.trim() ?? '';
  const tagsRaw = (form.get('tags') as string)?.trim() ?? '';
  const tags = JSON.stringify(tagsRaw.split(',').map(t => t.trim()).filter(Boolean));
  const display_order = parseInt(form.get('display_order') as string) || 0;
  const active = form.get('active') === '1' ? 1 : 0;

  if (!name || !url) {
    return new Response(JSON.stringify({ error: 'Name and URL are required' }), { status: 400 });
  }

  updateTool(id, { name, url, description, tags, display_order, active });
  return new Response(null, { status: 302, headers: { Location: '/admin/tools' } });
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = parseInt(params.id ?? '');
  if (!id) return new Response(JSON.stringify({ error: 'Invalid id' }), { status: 400 });
  deleteTool(id);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
```

- [ ] **Step 5: Create `src/pages/api/passkeys/[id].ts`**

```typescript
import type { APIRoute } from 'astro';
import { deletePasskey, countPasskeys } from '../../../lib/db';

export const DELETE: APIRoute = async ({ params }) => {
  const id = parseInt(params.id ?? '');
  if (!id) return new Response(JSON.stringify({ error: 'Invalid id' }), { status: 400 });
  if (countPasskeys() <= 1) {
    return new Response(JSON.stringify({ error: 'Cannot delete the last passkey' }), { status: 409 });
  }
  deletePasskey(id);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
```

- [ ] **Step 6: Build and verify**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/api/posts/ src/pages/api/tools/ src/pages/api/passkeys/
git commit -m "feat: add content API endpoints for posts, tools, passkeys"
```

---

### Task 6: Admin dashboard

**Goal:** Build `/admin/index.astro` — the main dashboard listing all posts (with draft/published status) and all tools, with edit links and delete buttons.

**Files:**
- Create: `src/pages/admin/index.astro`

**Acceptance Criteria:**
- [ ] Lists all posts (published and draft) with title, status badge, edit link, delete button
- [ ] Lists all tools with name, edit link, delete button
- [ ] "New Post" and "Add Tool" links present
- [ ] Delete buttons use JavaScript fetch DELETE + page reload
- [ ] Redirects to `/admin/login` when accessed without session (middleware handles this)

**Verify:** `npm run dev` → after auth, dashboard shows seeded Vigilant tool; create a test post via API and confirm it appears.

**Steps:**

- [ ] **Step 1: Create `src/pages/admin/index.astro`**

```astro
---
import AdminBase from '../../layouts/AdminBase.astro';
import { listPosts, listTools } from '../../lib/db';

const posts = listPosts();
const tools = listTools();
---
<AdminBase title="Dashboard">
  <div class="dashboard">
    <section class="section">
      <div class="section-header">
        <h2>Posts</h2>
        <a href="/admin/posts/new" class="btn-sm">+ New Post</a>
      </div>
      {posts.length === 0 ? (
        <p class="empty">No posts yet.</p>
      ) : (
        <table class="data-table">
          <thead><tr><th>Title</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {posts.map(post => (
              <tr>
                <td><a href={`/admin/posts/${post.id}`}>{post.title}</a></td>
                <td>
                  <span class={`badge ${post.published ? 'badge-live' : 'badge-draft'}`}>
                    {post.published ? 'Live' : 'Draft'}
                  </span>
                </td>
                <td class="actions">
                  <a href={`/admin/posts/${post.id}`} class="action-link">Edit</a>
                  <button class="action-delete" data-type="posts" data-id={post.id}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>

    <section class="section">
      <div class="section-header">
        <h2>Tools</h2>
        <a href="/admin/tools" class="btn-sm">Manage Tools</a>
      </div>
      {tools.length === 0 ? (
        <p class="empty">No tools yet.</p>
      ) : (
        <table class="data-table">
          <thead><tr><th>Name</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {tools.map(tool => (
              <tr>
                <td>{tool.name}</td>
                <td>
                  <span class={`badge ${tool.active ? 'badge-live' : 'badge-draft'}`}>
                    {tool.active ? 'Active' : 'Hidden'}
                  </span>
                </td>
                <td class="actions">
                  <a href="/admin/tools" class="action-link">Edit</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  </div>
</AdminBase>

<style>
  .dashboard { display: flex; flex-direction: column; gap: 2.5rem; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
  h2 { font-size: 0.95rem; font-weight: 600; margin: 0; }
  .btn-sm {
    font-size: 0.75rem; padding: 0.25rem 0.6rem; border: 1px solid var(--border);
    border-radius: 3px; color: var(--text-muted); transition: color 0.15s;
  }
  .btn-sm:hover { color: var(--text-secondary); }
  .empty { color: var(--text-muted); font-size: 0.85rem; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .data-table th { text-align: left; color: var(--text-muted); font-weight: 400; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); }
  .data-table td { padding: 0.6rem 0.5rem; border-bottom: 1px solid var(--border); }
  .data-table tr:last-child td { border-bottom: none; }
  .badge { font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 3px; }
  .badge-live { background: #14532d; color: #86efac; }
  .badge-draft { background: var(--surface); color: var(--text-muted); border: 1px solid var(--border); }
  .actions { display: flex; gap: 0.75rem; }
  .action-link { color: var(--text-muted); font-size: 0.8rem; }
  .action-link:hover { color: var(--text-secondary); }
  .action-delete {
    background: none; border: none; color: #f87171; font-size: 0.8rem;
    cursor: pointer; padding: 0; transition: color 0.15s;
  }
  .action-delete:hover { color: #fca5a5; }
</style>

<script>
  document.querySelectorAll<HTMLButtonElement>('.action-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete this ${btn.dataset.type?.slice(0, -1)}?`)) return;
      const res = await fetch(`/api/${btn.dataset.type}/${btn.dataset.id}`, { method: 'DELETE' });
      if (res.ok) window.location.reload();
      else alert('Delete failed');
    });
  });
</script>
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/index.astro
git commit -m "feat: add admin dashboard"
```

---

### Task 7: Post editor

**Goal:** Build the TipTap-powered post editor for creating and editing blog posts at `/admin/posts/new` and `/admin/posts/[id]`.

**Files:**
- Create: `src/pages/admin/posts/new.astro`
- Create: `src/pages/admin/posts/[id].astro`

**Acceptance Criteria:**
- [ ] TipTap editor renders in the browser with a toolbar (Bold, Italic, H2, H3, Code, Code Block, Link, Bullet List, Ordered List)
- [ ] Title input auto-generates the slug on change (slugified)
- [ ] Slug field is editable
- [ ] Published toggle controls draft/live
- [ ] Form submits to `/api/posts` (new) or `/api/posts/[id]` (edit) with content_html from TipTap
- [ ] Saving redirects to `/admin`
- [ ] `/admin/posts/[id]` pre-fills all fields with existing post data

**Verify:** `npm run dev` → create a post, confirm it appears on dashboard; visit `/blog/<slug>` confirms it's live.

**Steps:**

- [ ] **Step 1: Create `src/pages/admin/posts/new.astro`**

```astro
---
import AdminBase from '../../../layouts/AdminBase.astro';
---
<AdminBase title="New Post">
  <h1 class="page-title">New Post</h1>
  <form id="post-form" method="POST" action="/api/posts" class="post-form">
    <div class="field">
      <label for="title">Title</label>
      <input type="text" id="title" name="title" required autocomplete="off" />
    </div>
    <div class="field">
      <label for="slug">Slug</label>
      <input type="text" id="slug" name="slug" required autocomplete="off" pattern="[a-z0-9\-]+" />
      <small class="slug-preview">thunderborn.dev/blog/<span id="slug-display">—</span></small>
    </div>
    <div class="field">
      <label for="summary">Summary <span class="optional">(shown on blog index)</span></label>
      <input type="text" id="summary" name="summary" autocomplete="off" />
    </div>
    <div class="field">
      <label>Content</label>
      <div class="editor-toolbar">
        <button type="button" data-action="bold"><b>B</b></button>
        <button type="button" data-action="italic"><i>I</i></button>
        <button type="button" data-action="h2">H2</button>
        <button type="button" data-action="h3">H3</button>
        <button type="button" data-action="code">Code</button>
        <button type="button" data-action="codeBlock">Block</button>
        <button type="button" data-action="link">Link</button>
        <button type="button" data-action="bulletList">• List</button>
        <button type="button" data-action="orderedList">1. List</button>
      </div>
      <div id="editor-mount" class="editor-body"></div>
      <input type="hidden" name="content_html" id="content-hidden" />
    </div>
    <div class="field field-row">
      <label class="toggle-label">
        <input type="checkbox" id="published-cb" name="published" value="1" />
        Publish immediately
      </label>
    </div>
    <div class="form-actions">
      <a href="/admin" class="btn-cancel">Cancel</a>
      <button type="submit" class="btn-save">Save Post</button>
    </div>
  </form>
</AdminBase>

<style>
  .page-title { font-size: 1.1rem; font-weight: 600; margin: 0 0 1.5rem; }
  .post-form { display: flex; flex-direction: column; gap: 1.25rem; max-width: 720px; }
  .field { display: flex; flex-direction: column; gap: 0.35rem; }
  label { font-size: 0.8rem; color: var(--text-muted); }
  .optional { font-weight: 400; }
  input[type="text"] {
    background: var(--surface); border: 1px solid var(--border); border-radius: 4px;
    padding: 0.5rem 0.75rem; color: var(--text); font-size: 0.875rem;
  }
  input[type="text"]:focus { outline: 1px solid var(--text-muted); }
  .slug-preview { font-size: 0.75rem; color: var(--text-muted); }
  .editor-toolbar {
    display: flex; gap: 0.25rem; padding: 0.4rem; background: var(--surface);
    border: 1px solid var(--border); border-bottom: none; border-radius: 4px 4px 0 0; flex-wrap: wrap;
  }
  .editor-toolbar button {
    background: none; border: none; color: var(--text-muted); font-size: 0.8rem;
    padding: 0.2rem 0.5rem; cursor: pointer; border-radius: 3px; transition: all 0.1s;
  }
  .editor-toolbar button:hover, .editor-toolbar button.is-active {
    background: var(--border); color: var(--text);
  }
  .editor-body {
    background: var(--surface); border: 1px solid var(--border); border-radius: 0 0 4px 4px;
    padding: 0.75rem 1rem; min-height: 300px; font-size: 0.875rem; line-height: 1.7;
    color: var(--text-secondary);
  }
  .editor-body:focus-within { outline: 1px solid var(--text-muted); }
  .editor-body :global(.ProseMirror) { outline: none; min-height: 280px; }
  .editor-body :global(.ProseMirror p.is-editor-empty:first-child::before) {
    content: 'Start writing...'; color: var(--text-muted); float: left; pointer-events: none;
  }
  .field-row { flex-direction: row; align-items: center; }
  .toggle-label { display: flex; gap: 0.5rem; align-items: center; font-size: 0.875rem; color: var(--text-secondary); cursor: pointer; }
  .form-actions { display: flex; gap: 0.75rem; align-items: center; }
  .btn-cancel { font-size: 0.85rem; color: var(--text-muted); }
  .btn-save {
    background: var(--text); color: var(--bg); border: none; border-radius: 4px;
    padding: 0.5rem 1.25rem; font-size: 0.875rem; font-weight: 600; cursor: pointer;
  }
</style>

<script>
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Link from '@tiptap/extension-link';

  const editor = new Editor({
    element: document.getElementById('editor-mount')!,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
    ],
    onUpdate({ editor }) {
      (document.getElementById('content-hidden') as HTMLInputElement).value = editor.getHTML();
    },
  });

  // Toolbar
  document.querySelector('.editor-toolbar')!.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.action!;
    const chain = editor.chain().focus();
    switch (action) {
      case 'bold': chain.toggleBold().run(); break;
      case 'italic': chain.toggleItalic().run(); break;
      case 'h2': chain.toggleHeading({ level: 2 }).run(); break;
      case 'h3': chain.toggleHeading({ level: 3 }).run(); break;
      case 'code': chain.toggleCode().run(); break;
      case 'codeBlock': chain.toggleCodeBlock().run(); break;
      case 'link': {
        const url = prompt('URL:');
        if (url) chain.setLink({ href: url }).run();
        break;
      }
      case 'bulletList': chain.toggleBulletList().run(); break;
      case 'orderedList': chain.toggleOrderedList().run(); break;
    }
  });

  // Slug auto-generation
  document.getElementById('title')!.addEventListener('input', e => {
    const slug = (e.target as HTMLInputElement).value
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    (document.getElementById('slug') as HTMLInputElement).value = slug;
    document.getElementById('slug-display')!.textContent = slug || '—';
  });
  document.getElementById('slug')!.addEventListener('input', e => {
    document.getElementById('slug-display')!.textContent = (e.target as HTMLInputElement).value || '—';
  });

  // Sync content_html before submit
  document.getElementById('post-form')!.addEventListener('submit', () => {
    (document.getElementById('content-hidden') as HTMLInputElement).value = editor.getHTML();
  });
</script>
```

- [ ] **Step 2: Create `src/pages/admin/posts/[id].astro`**

```astro
---
import AdminBase from '../../../layouts/AdminBase.astro';
import { getPostById } from '../../../lib/db';

const id = parseInt(Astro.params.id ?? '');
const post = id ? getPostById(id) : undefined;
if (!post) return Astro.redirect('/admin');
---
<AdminBase title={`Edit: ${post.title}`}>
  <h1 class="page-title">Edit Post</h1>
  <form id="post-form" class="post-form">
    <div class="field">
      <label for="title">Title</label>
      <input type="text" id="title" name="title" required value={post.title} autocomplete="off" />
    </div>
    <div class="field">
      <label for="slug">Slug</label>
      <input type="text" id="slug" name="slug" required value={post.slug} autocomplete="off" pattern="[a-z0-9\-]+" />
      <small class="slug-preview">thunderborn.dev/blog/<span id="slug-display">{post.slug}</span></small>
    </div>
    <div class="field">
      <label for="summary">Summary <span class="optional">(shown on blog index)</span></label>
      <input type="text" id="summary" name="summary" value={post.summary} autocomplete="off" />
    </div>
    <div class="field">
      <label>Content</label>
      <div class="editor-toolbar">
        <button type="button" data-action="bold"><b>B</b></button>
        <button type="button" data-action="italic"><i>I</i></button>
        <button type="button" data-action="h2">H2</button>
        <button type="button" data-action="h3">H3</button>
        <button type="button" data-action="code">Code</button>
        <button type="button" data-action="codeBlock">Block</button>
        <button type="button" data-action="link">Link</button>
        <button type="button" data-action="bulletList">• List</button>
        <button type="button" data-action="orderedList">1. List</button>
      </div>
      <div id="editor-mount" class="editor-body"></div>
      <input type="hidden" name="content_html" id="content-hidden" value={post.content_html} />
    </div>
    <div class="field field-row">
      <label class="toggle-label">
        <input type="checkbox" id="published-cb" name="published" value="1" checked={post.published === 1} />
        Published (live)
      </label>
    </div>
    <div class="form-actions">
      <a href="/admin" class="btn-cancel">Cancel</a>
      <button type="submit" class="btn-save">Save Changes</button>
    </div>
  </form>
</AdminBase>

<style>
  .page-title { font-size: 1.1rem; font-weight: 600; margin: 0 0 1.5rem; }
  .post-form { display: flex; flex-direction: column; gap: 1.25rem; max-width: 720px; }
  .field { display: flex; flex-direction: column; gap: 0.35rem; }
  label { font-size: 0.8rem; color: var(--text-muted); }
  .optional { font-weight: 400; }
  input[type="text"] {
    background: var(--surface); border: 1px solid var(--border); border-radius: 4px;
    padding: 0.5rem 0.75rem; color: var(--text); font-size: 0.875rem;
  }
  input[type="text"]:focus { outline: 1px solid var(--text-muted); }
  .slug-preview { font-size: 0.75rem; color: var(--text-muted); }
  .editor-toolbar {
    display: flex; gap: 0.25rem; padding: 0.4rem; background: var(--surface);
    border: 1px solid var(--border); border-bottom: none; border-radius: 4px 4px 0 0; flex-wrap: wrap;
  }
  .editor-toolbar button {
    background: none; border: none; color: var(--text-muted); font-size: 0.8rem;
    padding: 0.2rem 0.5rem; cursor: pointer; border-radius: 3px; transition: all 0.1s;
  }
  .editor-toolbar button:hover, .editor-toolbar button.is-active { background: var(--border); color: var(--text); }
  .editor-body {
    background: var(--surface); border: 1px solid var(--border); border-radius: 0 0 4px 4px;
    padding: 0.75rem 1rem; min-height: 300px; font-size: 0.875rem; line-height: 1.7; color: var(--text-secondary);
  }
  .editor-body:focus-within { outline: 1px solid var(--text-muted); }
  .editor-body :global(.ProseMirror) { outline: none; min-height: 280px; }
  .editor-body :global(.ProseMirror p.is-editor-empty:first-child::before) {
    content: 'Start writing...'; color: var(--text-muted); float: left; pointer-events: none;
  }
  .field-row { flex-direction: row; align-items: center; }
  .toggle-label { display: flex; gap: 0.5rem; align-items: center; font-size: 0.875rem; color: var(--text-secondary); cursor: pointer; }
  .form-actions { display: flex; gap: 0.75rem; align-items: center; }
  .btn-cancel { font-size: 0.85rem; color: var(--text-muted); }
  .btn-save {
    background: var(--text); color: var(--bg); border: none; border-radius: 4px;
    padding: 0.5rem 1.25rem; font-size: 0.875rem; font-weight: 600; cursor: pointer;
  }
</style>

<script type="application/json" id="post-data" set:text={JSON.stringify({ content_html: post.content_html, id: post.id })}></script>

<script>
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Link from '@tiptap/extension-link';

  const { content_html: initialContent, id: postId } = JSON.parse(
    (document.getElementById('post-data') as HTMLScriptElement).textContent ?? '{}'
  );

  const editor = new Editor({
    element: document.getElementById('editor-mount')!,
    extensions: [StarterKit, Link.configure({ openOnClick: false })],
    content: initialContent,
    onUpdate({ editor }) {
      (document.getElementById('content-hidden') as HTMLInputElement).value = editor.getHTML();
    },
  });

  document.querySelector('.editor-toolbar')!.addEventListener('click', e => {
    const btn = (e.target as Element).closest('[data-action]') as HTMLElement | null;
    if (!btn) return;
    const chain = editor.chain().focus();
    switch (btn.dataset.action) {
      case 'bold': chain.toggleBold().run(); break;
      case 'italic': chain.toggleItalic().run(); break;
      case 'h2': chain.toggleHeading({ level: 2 }).run(); break;
      case 'h3': chain.toggleHeading({ level: 3 }).run(); break;
      case 'code': chain.toggleCode().run(); break;
      case 'codeBlock': chain.toggleCodeBlock().run(); break;
      case 'link': { const url = prompt('URL:'); if (url) chain.setLink({ href: url }).run(); break; }
      case 'bulletList': chain.toggleBulletList().run(); break;
      case 'orderedList': chain.toggleOrderedList().run(); break;
    }
  });

  document.getElementById('slug')!.addEventListener('input', e => {
    document.getElementById('slug-display')!.textContent = (e.target as HTMLInputElement).value || '—';
  });

  document.getElementById('post-form')!.addEventListener('submit', async e => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    formData.set('content_html', editor.getHTML());
    const res = await fetch(`/api/posts/${postId}`, { method: 'PUT', body: formData });
    if (res.ok) { window.location.href = '/admin'; }
    else { const { error } = await res.json(); alert(error ?? 'Save failed'); }
  });
</script>
```

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/posts/
git commit -m "feat: add TipTap post editor (new and edit)"
```

---

### Task 8: Tools and passkeys admin pages

**Goal:** Build `/admin/tools.astro` (tool CRUD with edit forms inline) and `/admin/passkeys.astro` (list passkeys, delete, add new).

**Files:**
- Create: `src/pages/admin/tools.astro`
- Create: `src/pages/admin/passkeys.astro`

**Acceptance Criteria:**
- [ ] Tools page lists all tools with edit form per row and delete button
- [ ] "Add Tool" form at the bottom creates a new tool
- [ ] Passkeys page lists registered passkeys by name + date
- [ ] "Add another passkey" button runs WebAuthn registration ceremony in-browser
- [ ] Cannot delete the last passkey (API returns 409, UI shows error)

**Verify:** `npm run dev` → add a second tool, confirm it appears on `/tools`; add a second passkey.

**Steps:**

- [ ] **Step 1: Create `src/pages/admin/tools.astro`**

```astro
---
import AdminBase from '../../layouts/AdminBase.astro';
import { listTools } from '../../lib/db';
const tools = listTools();
---
<AdminBase title="Tools">
  <h1 class="page-title">Tools</h1>

  <div class="tools-list">
    {tools.map(tool => (
      <div class="tool-row">
        <form method="POST" action={`/api/tools/${tool.id}`} class="tool-edit-form">
          <input type="hidden" name="_method" value="PUT" />
          <div class="tool-fields">
            <input type="text" name="name" value={tool.name} placeholder="Name" required />
            <input type="text" name="url" value={tool.url} placeholder="URL" required />
            <input type="text" name="description" value={tool.description} placeholder="Description" />
            <input type="text" name="tags" value={JSON.parse(tool.tags).join(', ')} placeholder="Tags (comma-separated)" />
            <input type="number" name="display_order" value={tool.display_order} style="width:60px" />
            <label class="active-label">
              <input type="checkbox" name="active" value="1" checked={tool.active === 1} />
              Active
            </label>
          </div>
          <div class="tool-actions">
            <button type="submit" class="btn-save-sm">Save</button>
            <button type="button" class="btn-delete" data-id={tool.id}>Delete</button>
          </div>
        </form>
      </div>
    ))}
  </div>

  <h2 class="add-title">Add Tool</h2>
  <form method="POST" action="/api/tools" class="add-form">
    <div class="tool-fields">
      <input type="text" name="name" placeholder="Name" required />
      <input type="text" name="url" placeholder="https://..." required />
      <input type="text" name="description" placeholder="Description" />
      <input type="text" name="tags" placeholder="Tags (comma-separated)" />
    </div>
    <button type="submit" class="btn-save-sm">Add Tool</button>
  </form>
</AdminBase>

<style>
  .page-title { font-size: 1.1rem; font-weight: 600; margin: 0 0 1.25rem; }
  .add-title { font-size: 0.9rem; font-weight: 600; margin: 2rem 0 0.75rem; color: var(--text-muted); }
  .tools-list { display: flex; flex-direction: column; gap: 0.75rem; }
  .tool-row { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 0.85rem 1rem; }
  .tool-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; margin-bottom: 0.6rem; }
  .tool-fields input[type="text"] {
    background: var(--bg); border: 1px solid var(--border); border-radius: 3px;
    padding: 0.35rem 0.6rem; color: var(--text); font-size: 0.8rem; width: 100%;
  }
  .tool-fields input[type="number"] {
    background: var(--bg); border: 1px solid var(--border); border-radius: 3px;
    padding: 0.35rem 0.6rem; color: var(--text); font-size: 0.8rem;
  }
  .active-label { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--text-muted); }
  .tool-actions { display: flex; gap: 0.6rem; align-items: center; }
  .btn-save-sm {
    background: var(--text); color: var(--bg); border: none; border-radius: 3px;
    padding: 0.3rem 0.8rem; font-size: 0.78rem; font-weight: 600; cursor: pointer;
  }
  .btn-delete { background: none; border: none; color: #f87171; font-size: 0.78rem; cursor: pointer; padding: 0; }
  .btn-delete:hover { color: #fca5a5; }
  .add-form { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 0.85rem 1rem; }
</style>

<script>
  // PUT forms (tool edits)
  document.querySelectorAll<HTMLFormElement>('form.tool-edit-form').forEach(form => {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const data = new FormData(form);
      const toolId = form.dataset.id;
      const res = await fetch(`/api/tools/${toolId}`, { method: 'PUT', body: data });
      if (res.ok || res.redirected) window.location.reload();
      else alert('Save failed');
    });
  });

  // Delete buttons
  document.querySelectorAll<HTMLButtonElement>('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this tool?')) return;
      const res = await fetch(`/api/tools/${btn.dataset.id}`, { method: 'DELETE' });
      if (res.ok) window.location.reload();
      else alert('Delete failed');
    });
  });
</script>
```

- [ ] **Step 2: Create `src/pages/admin/passkeys.astro`**

```astro
---
import AdminBase from '../../layouts/AdminBase.astro';
import { listPasskeys } from '../../lib/db';
const passkeys = listPasskeys();
---
<AdminBase title="Passkeys">
  <h1 class="page-title">Passkeys</h1>
  <p class="hint">Devices registered for admin sign-in.</p>

  <ul class="passkey-list">
    {passkeys.map(pk => (
      <li class="passkey-row">
        <div>
          <span class="pk-name">{pk.name}</span>
          <span class="pk-date">
            Registered {new Date(pk.created_at * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
          </span>
        </div>
        <button class="btn-delete" data-id={pk.id}>Delete</button>
      </li>
    ))}
  </ul>

  <h2 class="add-title">Add another passkey</h2>
  <p class="hint">Name the device before registering.</p>
  <div class="add-row">
    <input type="text" id="new-passkey-name" placeholder="e.g. iPhone Face ID" value="New Passkey" />
    <button id="add-passkey-btn" class="btn-save-sm">Register passkey</button>
  </div>
  <p id="reg-error" class="error-msg" hidden></p>
</AdminBase>

<style>
  .page-title { font-size: 1.1rem; font-weight: 600; margin: 0 0 0.25rem; }
  .hint { font-size: 0.8rem; color: var(--text-muted); margin: 0 0 1.25rem; }
  .add-title { font-size: 0.9rem; font-weight: 600; margin: 2rem 0 0.25rem; color: var(--text-muted); }
  .passkey-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0; }
  .passkey-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.75rem 0; border-bottom: 1px solid var(--border); font-size: 0.875rem;
  }
  .passkey-row:last-child { border-bottom: none; }
  .pk-name { font-weight: 500; }
  .pk-date { display: block; font-size: 0.75rem; color: var(--text-muted); margin-top: 0.1rem; }
  .btn-delete { background: none; border: none; color: #f87171; font-size: 0.8rem; cursor: pointer; padding: 0; }
  .btn-delete:hover { color: #fca5a5; }
  .add-row { display: flex; gap: 0.6rem; align-items: center; }
  .add-row input {
    background: var(--surface); border: 1px solid var(--border); border-radius: 4px;
    padding: 0.4rem 0.75rem; color: var(--text); font-size: 0.875rem; flex: 1; max-width: 280px;
  }
  .btn-save-sm {
    background: var(--text); color: var(--bg); border: none; border-radius: 3px;
    padding: 0.4rem 0.8rem; font-size: 0.78rem; font-weight: 600; cursor: pointer;
  }
  .error-msg { color: #f87171; font-size: 0.8rem; margin-top: 0.75rem; }
</style>

<script>
  import { startRegistration } from '@simplewebauthn/browser';

  // Delete passkeys
  document.querySelectorAll<HTMLButtonElement>('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this passkey? Make sure you have another registered first.')) return;
      const res = await fetch(`/api/passkeys/${btn.dataset.id}`, { method: 'DELETE' });
      if (res.ok) window.location.reload();
      else {
        const { error } = await res.json();
        alert(error ?? 'Delete failed');
      }
    });
  });

  // Add new passkey
  const addBtn = document.getElementById('add-passkey-btn') as HTMLButtonElement;
  const nameInput = document.getElementById('new-passkey-name') as HTMLInputElement;
  const errEl = document.getElementById('reg-error') as HTMLElement;

  addBtn.addEventListener('click', async () => {
    addBtn.disabled = true;
    errEl.hidden = true;
    try {
      const res = await fetch('/api/auth/register-challenge');
      if (!res.ok) throw new Error('Could not get registration options');
      const { challengeToken, options } = await res.json();
      const regResponse = await startRegistration({ optionsJSON: options });
      const verify = await fetch('/api/auth/verify-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken, name: nameInput.value || 'Passkey', response: regResponse }),
      });
      if (verify.ok) window.location.reload();
      else {
        const { error } = await verify.json();
        throw new Error(error ?? 'Registration failed');
      }
    } catch (err: unknown) {
      errEl.textContent = err instanceof Error ? err.message : 'Registration failed';
      errEl.hidden = false;
    } finally {
      addBtn.disabled = false;
    }
  });
</script>
```

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/tools.astro src/pages/admin/passkeys.astro
git commit -m "feat: add tools manager and passkey management pages"
```

---

### Task 9: Rewrite public blog and tools pages to use SQLite

**Goal:** Replace the static Content Collections-based blog and hardcoded tools page with server-rendered versions that query SQLite. Delete `content.config.ts` and the blog content directory.

**Files:**
- Modify: `src/pages/blog/index.astro`
- Modify: `src/pages/blog/[id].astro`
- Modify: `src/pages/tools.astro`
- Delete: `src/content.config.ts`
- Delete: `src/content/blog/.gitkeep` (and directory)

**Acceptance Criteria:**
- [ ] `/blog` lists published posts from SQLite ordered by date
- [ ] `/blog/<slug>` renders a published post's HTML; returns 404 for unknown slugs or unpublished posts
- [ ] `/tools` renders tools from SQLite ordered by `display_order`
- [ ] `npm run build` succeeds with no references to `astro:content`

**Verify:** `npm run build` → no errors; `npm run dev` → `/tools` shows Vigilant card from DB (seeded); create a published post in admin, confirm it appears on `/blog`.

**Steps:**

- [ ] **Step 1: Rewrite `src/pages/blog/index.astro`**

```astro
---
import Base from '../../layouts/Base.astro';
import { listPosts } from '../../lib/db';

const posts = listPosts(true);
---
<Base title="Blog">
  <h1>Blog</h1>
  <p class="subtitle">Dev writeups and notes</p>

  {posts.length === 0 ? (
    <div class="empty">Posts coming soon</div>
  ) : (
    <ul class="post-list">
      {posts.map(post => (
        <li>
          <a href={`/blog/${post.slug}`} class="post-link">
            <span class="post-title">{post.title}</span>
            <span class="post-date">
              {new Date(post.created_at * 1000).toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric'
              })}
            </span>
          </a>
        </li>
      ))}
    </ul>
  )}
</Base>

<style>
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.25rem; }
  .subtitle { color: var(--text-muted); font-size: 0.85rem; margin: 0 0 1.5rem; }
  .empty {
    background: var(--surface); border: 1px dashed var(--border);
    border-radius: 6px; padding: 2rem; text-align: center;
    color: var(--text-muted); font-size: 0.875rem;
  }
  .post-list { list-style: none; padding: 0; margin: 0; }
  .post-list li { border-bottom: 1px solid var(--border); }
  .post-list li:last-child { border-bottom: none; }
  .post-link {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.75rem 0; font-size: 0.875rem; color: var(--text-secondary); transition: color 0.15s;
  }
  .post-link:hover .post-title { color: var(--text); }
  .post-date { color: var(--text-muted); font-size: 0.75rem; flex-shrink: 0; }
</style>
```

- [ ] **Step 2: Rewrite `src/pages/blog/[id].astro`**

The `[id]` parameter now serves as the slug (renamed from file-based id to slug-based lookup).

```astro
---
import Base from '../../layouts/Base.astro';
import { getPostBySlug } from '../../lib/db';

const { id } = Astro.params;
const post = id ? getPostBySlug(id) : undefined;

if (!post || !post.published) {
  return Astro.redirect('/404');
}
---
<Base title={post.title}>
  <article>
    <h1>{post.title}</h1>
    <time class="date">
      {new Date(post.created_at * 1000).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
      })}
    </time>
    <div class="content" set:html={post.content_html} />
  </article>
</Base>

<style>
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.25rem; }
  .date { color: var(--text-muted); font-size: 0.8rem; display: block; margin-bottom: 2rem; }
  .content { font-size: 0.875rem; line-height: 1.8; color: var(--text-secondary); }
  .content :global(h2) { font-size: 1rem; font-weight: 600; color: var(--text); margin-top: 2rem; }
  .content :global(a) { color: var(--text-secondary); text-decoration: underline; }
  .content :global(code) {
    background: var(--surface); padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.8em;
  }
  .content :global(pre) {
    background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
    padding: 1rem; overflow-x: auto;
  }
  .content :global(pre code) { background: none; padding: 0; }
</style>
```

- [ ] **Step 3: Rewrite `src/pages/tools.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import { listTools } from '../lib/db';

const tools = listTools(true);
---
<Base title="Tools">
  <h1>Tools</h1>
  <p class="subtitle">Things I've built and shipped</p>

  <div class="tools-list">
    {tools.map(tool => (
      <div class="tool-card">
        <div class="tool-header">
          <h2 class="tool-name">{tool.name}</h2>
          <a href={tool.url} target="_blank" rel="noopener" class="live-link">Live ↗</a>
        </div>
        <p class="tool-desc">{tool.description}</p>
        <div class="tool-tags">
          {(JSON.parse(tool.tags) as string[]).map((tag: string) => (
            <span class="tag">{tag}</span>
          ))}
        </div>
      </div>
    ))}
  </div>
</Base>

<style>
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.25rem; }
  .subtitle { color: var(--text-muted); font-size: 0.85rem; margin: 0 0 1.5rem; }
  .tools-list { display: flex; flex-direction: column; gap: 0.75rem; }
  .tool-card { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 1.25rem; }
  .tool-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
  .tool-name { font-weight: 600; font-size: 0.95rem; margin: 0; }
  .live-link {
    font-size: 0.75rem; color: var(--text-muted); border: 1px solid var(--border);
    border-radius: 3px; padding: 0.2rem 0.5rem; transition: color 0.15s;
  }
  .live-link:hover { color: var(--text-secondary); }
  .tool-desc { font-size: 0.8rem; color: var(--text-secondary); line-height: 1.6; margin: 0 0 0.75rem; }
  .tool-tags { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .tag {
    background: var(--bg); border: 1px solid var(--border); border-radius: 3px;
    padding: 0.15rem 0.4rem; font-size: 0.7rem; color: var(--text-muted);
  }
</style>
```

- [ ] **Step 4: Delete content collections**

```bash
rm src/content.config.ts
rm src/content/blog/.gitkeep
rmdir src/content/blog
rmdir src/content
```

- [ ] **Step 5: Build and verify**

```bash
npm run build
```

Expected: no TypeScript errors, no `astro:content` references.

- [ ] **Step 6: Smoke test with dev server**

```bash
npm run dev &
sleep 3
curl -s http://localhost:4321/tools | grep -i "vigilant"
# Expected: HTML containing "Vigilant"
curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/blog/nonexistent-slug
# Expected: 404 or 302
kill %1
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/blog/index.astro src/pages/blog/[id].astro src/pages/tools.astro
git rm src/content.config.ts src/content/blog/.gitkeep
git commit -m "feat: rewrite blog and tools pages to read from SQLite"
```

---

### Task 10: Docker build, deploy infrastructure, and nginx port update

**Goal:** Replace the static nginx Docker setup with a multi-stage Node.js Docker build. Update `docker-compose.yml` for the Node container with a SQLite data volume. Update `deploy.sh` to push code and rebuild on VPS. Update `thunderborn.conf` in vigilant-vps to proxy to port 3000. Perform first deploy.

**Files:**
- Create: `Dockerfile` (in Portfolio repo)
- Modify: `docker-compose.yml` (Portfolio repo)
- Modify: `deploy.sh` (Portfolio repo)
- Delete: `nginx.conf` (Portfolio repo — no longer used)
- Modify: `~/Documents/Personal/vigilant-vps/nginx/thunderborn.conf` — change upstream to port 3000

**Acceptance Criteria:**
- [ ] `docker build -t portfolio-test .` succeeds locally
- [ ] VPS: `docker logs portfolio` shows startup without errors and prints the setup token if no passkeys
- [ ] `https://thunderborn.dev` returns 200
- [ ] `https://thunderborn.dev/tools` shows Vigilant card
- [ ] `https://thunderborn.dev/admin` redirects to `/admin/login`

**Verify:** `curl -s -o /dev/null -w "%{http_code}" https://thunderborn.dev` → `200`

**Steps:**

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0 DB_PATH=/app/data/db.sqlite RP_ID=thunderborn.dev RP_NAME=thunderborn.dev ORIGIN=https://thunderborn.com
CMD ["node", "dist/server/entry.mjs"]
```

Fix the `ORIGIN` env var typo — it should be `https://thunderborn.dev`:

```dockerfile
ENV PORT=3000 HOST=0.0.0.0 DB_PATH=/app/data/db.sqlite RP_ID=thunderborn.dev RP_NAME=thunderborn.dev ORIGIN=https://thunderborn.dev
```

- [ ] **Step 2: Rewrite `docker-compose.yml`**

```yaml
services:
  portfolio:
    build: .
    container_name: portfolio
    restart: unless-stopped
    environment:
      PORT: "3000"
      HOST: "0.0.0.0"
      DB_PATH: "/app/data/db.sqlite"
      RP_ID: "thunderborn.dev"
      RP_NAME: "thunderborn.dev"
      ORIGIN: "https://thunderborn.dev"
    volumes:
      - portfolio_data:/app/data
    networks:
      - web
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: "0.25"
          pids: 100
    logging:
      driver: json-file
      options:
        max-size: "5m"
        max-file: "2"

volumes:
  portfolio_data:

networks:
  web:
    external: true
    name: web
```

- [ ] **Step 3: Rewrite `deploy.sh`**

```bash
#!/usr/bin/env bash
# Deploy the portfolio site to the VPS.
#
# FIRST-TIME VPS SETUP (run once):
#   ssh ijohnson@146.190.140.112 "sudo rm -rf /opt/portfolio && sudo git clone https://github.com/Thor6677/Portfolio /opt/portfolio && sudo chown -R ijohnson:ijohnson /opt/portfolio"
#   ssh ijohnson@146.190.140.112 "cd /opt/portfolio && docker compose up -d --build"
#   # Check logs for the setup token:
#   ssh ijohnson@146.190.140.112 "docker logs portfolio"
#   # Open the setup URL in your browser to register your passkey.
#
# ROUTINE DEPLOYS: just run this script.
set -euo pipefail

VPS="ijohnson@146.190.140.112"
VPS_DIR="/opt/portfolio"

echo "==> Pushing to GitHub..."
git push origin main

echo "==> Deploying on $VPS..."
ssh "$VPS" "cd $VPS_DIR && git pull && docker compose up -d --build"

echo "==> Done. https://thunderborn.dev"
```

- [ ] **Step 4: Delete `nginx.conf`**

```bash
rm nginx.conf
git rm nginx.conf
```

- [ ] **Step 5: Add `.dockerignore`**

Create `.dockerignore` to keep the build context lean:

```
node_modules
dist
data
.env
.env.*
!.env.example
.git
docs
```

- [ ] **Step 6: Test Docker build locally**

```bash
docker build -t portfolio-test .
```

Expected: build completes, no errors. The builder stage compiles Astro, the runtime stage copies dist + node_modules.

- [ ] **Step 7: Update `nginx/thunderborn.conf` in vigilant-vps**

In `~/Documents/Personal/vigilant-vps/nginx/thunderborn.conf`, change:

```nginx
set $portfolio_upstream "http://portfolio";
```

to:

```nginx
set $portfolio_upstream "http://portfolio:3000";
```

Commit in the vigilant-vps repo:

```bash
cd ~/Documents/Personal/vigilant-vps
git add nginx/thunderborn.conf
git commit -m "fix: update portfolio upstream port to 3000 (Node.js SSR)"
git push origin main
```

- [ ] **Step 8: Commit Portfolio repo changes**

```bash
cd ~/Documents/Personal/Portfolio
git add Dockerfile docker-compose.yml deploy.sh .dockerignore
git commit -m "feat: add Dockerfile, update docker-compose for Node.js SSR"
```

- [ ] **Step 9: First-time VPS migration**

The VPS currently has `/opt/portfolio/` as a plain directory (not a git repo). Run:

```bash
ssh ijohnson@146.190.140.112 "
  docker stop portfolio || true
  docker rm portfolio || true
  sudo rm -rf /opt/portfolio
  sudo git clone https://github.com/Thor6677/Portfolio /opt/portfolio
  sudo chown -R ijohnson:ijohnson /opt/portfolio
  cd /opt/portfolio && docker compose up -d --build
"
```

Expected: Docker build runs, container starts.

- [ ] **Step 10: Pull nginx config update + recreate nginx**

```bash
ssh ijohnson@146.190.140.112 "
  cd /opt/vigilant && git pull &&
  docker compose up -d --force-recreate nginx
"
```

- [ ] **Step 11: Retrieve setup token and register passkey**

```bash
ssh ijohnson@146.190.140.112 "docker logs portfolio 2>&1 | grep 'portfolio'"
```

Expected output (example):
```
[portfolio] No passkeys registered.
[portfolio] Setup token: a3f9c2...
[portfolio] Visit https://thunderborn.dev/admin/setup?token=a3f9c2...
```

Open the printed URL in your browser. Enter a name for the passkey (e.g. "MacBook Touch ID"), click "Register passkey", complete the biometric prompt. On success you are redirected to `/admin`.

- [ ] **Step 12: Verify site is live**

```bash
curl -s -o /dev/null -w "%{http_code}" https://thunderborn.dev
# Expected: 200
curl -s -o /dev/null -w "%{http_code}" https://thunderborn.dev/tools
# Expected: 200
curl -s -o /dev/null -w "%{http_code}" https://thunderborn.dev/admin
# Expected: 302 (redirect to /admin/login)
```

- [ ] **Step 13: Final commit — deploy.sh is now authoritative**

The `./deploy.sh` script handles all future deploys:
```bash
cd ~/Documents/Personal/Portfolio && ./deploy.sh
```

---

## Routine deploy workflow (after this feature is live)

For content changes (posts, tools): no deploy needed — use the admin panel at `https://thunderborn.dev/admin`.

For code changes (templates, styles, new features):
```bash
cd ~/Documents/Personal/Portfolio
# make your changes
git add -p && git commit -m "your message"
./deploy.sh
```
