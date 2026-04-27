# Portfolio

Personal portfolio site at thunderborn.dev. Astro 6 SSR app with a passkey-authenticated admin panel for managing blog posts and tools. Content lives in SQLite — no redeploy needed for content changes.

## Access
- **VPS**: `ssh ijohnson@146.190.140.112`
- **Code on VPS**: `/opt/portfolio/`
- **GitHub**: `Thor6677/Portfolio`
- **Live URL**: `https://thunderborn.dev`
- **Admin panel**: `https://thunderborn.dev/admin`

## Deploy
Run from repo root — pushes to GitHub, rebuilds the Docker image on VPS, syncs the nginx vhost if changed:
```
./deploy.sh
```
The nginx container belongs to the Vigilant stack (`/opt/vigilant/`) but `deploy.sh` handles recreating it when `deploy/thunderborn.conf` changes.

### Rollback
No rollback script. Use `git revert` for bad code:
```
git revert <bad-commit>
git push origin main
./deploy.sh
```

## First-Time Passkey Setup
If no passkeys are registered, the setup token is logged on startup:
```
ssh ijohnson@146.190.140.112 "docker logs portfolio | grep 'Setup token'"
```
Visit the logged URL to register the first passkey via Touch ID / Face ID.

## Debugging
```
ssh ijohnson@146.190.140.112 "docker logs portfolio --tail=50"
```

## Architecture

**Stack:** Astro 6 (`output: server`), `@astrojs/node` standalone, `better-sqlite3`, `@simplewebauthn/server` + `@simplewebauthn/browser` v13, TipTap rich text editor.

**Output modes:**
| Route | Mode |
|---|---|
| `/`, `/about` | Prerendered static (`export const prerender = true`) |
| `/blog`, `/blog/[slug]`, `/tools` | SSR — reads SQLite on each request |
| `/admin/*`, `/api/*` | SSR — auth-gated |

**SQLite:** `/app/data/db.sqlite` inside the container, mounted as Docker named volume `portfolio_data`. Persists across image rebuilds. Tables: `posts`, `tools`, `passkey_credentials`, `sessions`, `challenges`, `setup_tokens`.

**Auth:** Passkey-only via WebAuthn. Session cookie (`HttpOnly Secure SameSite=Strict`, 7-day expiry). Middleware at `src/middleware.ts` guards all `/admin/*` (except `/admin/login`, `/admin/setup`) and `/api/*` (except `/api/auth/*`).

**DB layer:** `src/lib/db.ts` — synchronous better-sqlite3, WAL mode, `busy_timeout = 5000`. All query functions exported from here.

## Key Gotchas

### Passing server data to module scripts
`<script define:vars={{...}}>` forces a non-module inline script — ES `import` breaks. Pass server data via a JSON tag instead:
```astro
<script type="application/json" id="my-data" set:text={JSON.stringify(data)}></script>
<script>
  const data = JSON.parse(document.getElementById('my-data').textContent);
</script>
```
This matters anywhere TipTap or other ES module libraries are used alongside server data.

### 404 responses
`Astro.redirect(url, 404)` is non-standard — browsers don't follow it. Use:
```ts
return new Response(null, { status: 404 });
```

### WebAuthn field name
`verify-registration` expects `body.response` (not `body.credential`) — matches `@simplewebauthn/server`'s contract. Also requires `body.name` for the credential name.

### Tool reorder
Must swap both rows' `display_order` in two parallel PUTs. Changing only one row creates duplicates and breaks ordering.

### Tags format
Stored as JSON array strings (`'["Python","React"]'`). Always guard after parsing:
```ts
const parsed = JSON.parse(tool.tags);
const tags = Array.isArray(parsed) ? parsed : [];
```

### Docker build
`better-sqlite3` requires native compilation. The builder stage needs:
```dockerfile
RUN apk add --no-cache python3 make g++
```
The `.dockerignore` excludes `data/` so the local dev SQLite database is never baked into the image.

### nginx vhost
`deploy/thunderborn.conf` is the nginx config for proxying thunderborn.dev to this container. It lives in this repo (not vigilant-vps). `deploy.sh` syncs it to `/opt/vigilant/nginx/thunderborn.conf` and force-recreates the nginx container when it changes (`nginx -s reload` reads old inodes on bind-mounts; container recreate is required).

## Workflow
Commit and push at the end of every session. Before finishing, ask: "Should I commit and push these changes?"
