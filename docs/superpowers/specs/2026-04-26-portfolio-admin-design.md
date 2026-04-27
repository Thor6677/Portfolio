# Portfolio Admin Panel Design

**Goal:** Add a passkey-authenticated admin panel to thunderborn.dev that lets the owner create and edit blog posts and manage tools without redeploying.

**Architecture:** Astro 6 hybrid mode with `@astrojs/node` adapter — public blog and tools pages become server-rendered (reading from SQLite at request time), while the homepage and about page stay prerendered static HTML. All content mutations go through `/admin/*` SSR routes. SQLite persists content across deploys via a Docker volume.

**Tech Stack:** Astro 6 (hybrid), `@astrojs/node`, `better-sqlite3`, `@simplewebauthn/server`, `@simplewebauthn/browser`, TipTap (rich text editor)

---

## Architecture

### Output Modes

| Route | Mode | Reason |
|---|---|---|
| `/`, `/about` | Prerendered (static) | Never needs live data |
| `/blog`, `/blog/[id]` | Server-rendered | Reads posts from SQLite on each request |
| `/tools` | Server-rendered | Reads tools from SQLite on each request |
| `/admin/*` | Server-rendered | Auth-gated CRUD |
| `/api/*` | Server-rendered | WebAuthn ceremony endpoints, form actions |

### SQLite Schema

Database lives at `/app/data/db.sqlite` inside the container, mounted as a Docker volume so it persists across image rebuilds.

```sql
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  content_html TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0,  -- 0 = draft, 1 = live
  created_at INTEGER NOT NULL,           -- Unix timestamp
  updated_at INTEGER NOT NULL
);

CREATE TABLE tools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',       -- JSON array of strings
  display_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE passkey_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id BLOB NOT NULL UNIQUE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,                    -- e.g. "MacBook Touch ID"
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                   -- random 32-byte hex token
  expires_at INTEGER NOT NULL            -- Unix timestamp
);
```

### Docker Changes

The portfolio container switches from `nginx:alpine` to a Node.js image:

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/server/entry.mjs"]
```

The `docker-compose.yml` mounts a named volume for the SQLite database only — no bind mounts for built assets:

```yaml
volumes:
  - portfolio_data:/app/data

volumes:
  portfolio_data:
```

The vigilant nginx `thunderborn.conf` upstream changes from `http://portfolio` to `http://portfolio:3000`.

### Deploy Model

Content edits (posts, tools): no redeploy needed — changes are live instantly via SQLite.

Code changes (templates, styles, features): push to GitHub → SSH to VPS → `docker compose up -d --build`. The `deploy.sh` script is updated to run this instead of rsyncing a dist folder. The SQLite volume is untouched by rebuilds.

---

## Authentication

### WebAuthn / Passkey Flow

**Library:** `@simplewebauthn/server` (server) + `@simplewebauthn/browser` (client).

**First-time passkey registration:** On startup, if no passkey credentials exist in the database, the app generates a cryptographically random one-time setup token and logs it to stdout:

```
[portfolio] No passkeys registered. Setup token: a3f9c2...
[portfolio] Visit https://thunderborn.dev/admin/register?token=a3f9c2... to register your first passkey.
```

Retrieve it with `docker logs portfolio`. Visit that URL in your browser, complete the passkey prompt (Touch ID, Face ID, Windows Hello, or hardware key), and the credential is stored in `passkey_credentials`. The token is single-use and invalidated immediately after registration. Once at least one credential exists, the `/admin/register` route returns 404.

**Login flow:**
1. User visits `/admin/login`
2. Page calls `GET /api/auth/login-challenge` → server generates and stores a challenge, returns it as JSON
3. Browser calls `startAuthentication()` from `@simplewebauthn/browser`
4. Device prompts for passkey (biometric or hardware key)
5. Browser POSTs assertion to `/api/auth/verify-login`
6. Server calls `verifyAuthenticationResponse()`, checks credential against DB, updates counter
7. On success: server inserts a session row (random 32-byte token, 7-day expiry), sets `HttpOnly Secure SameSite=Strict` cookie, redirects to `/admin`

**Session guard:** A shared `requireAdmin(request)` utility checks the session cookie against the `sessions` table. All `/admin/*` and mutation API routes call it and return 302 to `/admin/login` if the session is missing or expired.

**Multiple passkeys:** Supported — the passkey management page allows registering additional devices and deleting existing credentials.

---

## Admin UI

All admin pages use a shared `AdminBase.astro` layout with a minimal dark sidebar. Routes are:

- `/admin/login` — unauthenticated; shows "Sign in with passkey" button
- `/admin` — dashboard; lists posts and tools with edit links
- `/admin/posts/new` — new post editor
- `/admin/posts/[id]` — edit existing post
- `/admin/tools` — manage tools list
- `/admin/passkeys` — manage registered passkeys

### Dashboard (`/admin`)

Two columns:
- **Posts** — table of all posts (title, draft/published badge, edit link, delete button), "New Post" button at top
- **Tools** — list of tools (name, display order controls, edit link, delete button), "Add Tool" button at top

### Post Editor (`/admin/posts/new`, `/admin/posts/[id]`)

Fields:
- **Title** — text input; auto-generates slug on change (slugified, e.g. "My First Post" → `my-first-post`)
- **Slug** — text input, editable, must be unique; shown as a preview URL below the field
- **Summary** — text input; shown on the `/blog` index page
- **Content** — TipTap rich text editor with toolbar: Bold, Italic, H2, H3, Code block, Inline code, Link, Bullet list, Ordered list
- **Published** — toggle; draft posts are invisible to the public
- **Save** button — POSTs to `/api/posts` (new) or `PUT /api/posts/[id]` (edit), redirects back to dashboard on success

TipTap outputs HTML. Content is stored as HTML in `posts.content_html` and rendered directly in the public blog template.

### Tools Manager (`/admin/tools`)

A list where each tool row shows: name, URL, description, tags (comma-separated), display order (↑ ↓ buttons), active toggle, delete button. "Add Tool" reveals an inline form at the bottom of the list. Changes submit to `/api/tools` (create), `PUT /api/tools/[id]` (update), or `DELETE /api/tools/[id]` (delete).

### Passkey Management (`/admin/passkeys`)

Lists registered credentials by name and creation date. Each has a delete button. "Add another passkey" button runs the WebAuthn registration ceremony in-browser (calls `GET /api/auth/register-challenge` then `POST /api/auth/verify-registration`).

---

## Public Content

### Blog Index (`/blog`)

Queries `SELECT * FROM posts WHERE published = 1 ORDER BY created_at DESC`. Renders the same list layout as the current static blog index. Draft posts are not returned.

### Blog Post (`/blog/[id]`)

The `[id]` segment is the slug. Queries `SELECT * FROM posts WHERE slug = ? AND published = 1`. Renders `content_html` inside the existing `.content` div. Returns 404 if slug not found or post is unpublished.

### Tools (`/tools`)

Queries `SELECT * FROM tools WHERE active = 1 ORDER BY display_order ASC`. Renders the same card layout as today. The Vigilant card currently hardcoded in `tools.astro` becomes the first tool entry seeded into the database on first run.

### Homepage (`/`)

Stays prerendered static. No live data needed.

### About (`/about`)

Stays prerendered static. Editing requires a code change and redeploy.

---

## Seeding

On first startup, the app checks if the `tools` table is empty and seeds it with the existing Vigilant entry:

```js
{ name: 'Vigilant', url: 'https://vigilant.thunderborn.dev',
  description: 'EVE Online companion dashboard — multi-character overview, interactive star map, ship fitting tool, intel, and more.',
  tags: '["Python","React","EVE ESI"]', display_order: 0, active: 1 }
```

This ensures the tools page has content immediately after first deploy without manual data entry.
