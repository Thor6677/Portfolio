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
