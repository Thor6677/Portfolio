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
  _db.pragma('busy_timeout = 5000');
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
  let tagsJson: string;
  try { tagsJson = JSON.stringify(JSON.parse(data.tags)); }
  catch { throw new Error('tags must be a valid JSON array string'); }
  getDb().prepare(`
    INSERT INTO tools (name, url, description, tags, display_order, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(data.name, data.url, data.description, tagsJson, data.display_order);
}

export function updateTool(id: number, data: {
  name: string; url: string; description: string; tags: string; display_order: number; active: number;
}): void {
  let tagsJson: string;
  try { tagsJson = JSON.stringify(JSON.parse(data.tags)); }
  catch { throw new Error('tags must be a valid JSON array string'); }
  getDb().prepare(`
    UPDATE tools SET name=?, url=?, description=?, tags=?, display_order=?, active=? WHERE id=?
  `).run(data.name, data.url, data.description, tagsJson, data.display_order, data.active, id);
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
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  const id = randomBytes(32).toString('hex');
  const expiresAt = now + 7 * 24 * 60 * 60;
  db.prepare('INSERT INTO sessions (id, expires_at) VALUES (?, ?)').run(id, expiresAt);
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
