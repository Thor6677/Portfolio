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
