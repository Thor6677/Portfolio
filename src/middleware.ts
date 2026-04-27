import { defineMiddleware } from 'astro:middleware';
import { validateSession, countPasskeys, getOrCreateSetupToken } from './lib/db';

let setupTokenLogged = false;

export const onRequest = defineMiddleware(async (context, next) => {
  if (!setupTokenLogged) {
    setupTokenLogged = true;
    if (countPasskeys() === 0) {
      const token = getOrCreateSetupToken();
      console.log(`[portfolio] No passkeys registered. Setup token (expires in 30 min): ${token}`);
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
