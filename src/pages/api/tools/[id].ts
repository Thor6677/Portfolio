import type { APIRoute } from 'astro';
import { getToolById, updateTool, deleteTool } from '../../../lib/db';

export const PUT: APIRoute = async ({ params, request }) => {
  const id = parseInt(params.id ?? '');
  if (!id || !getToolById(id)) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
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
    return new Response(JSON.stringify({ error: 'Name and URL are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  updateTool(id, { name, url, description, tags, display_order, active });
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = parseInt(params.id ?? '');
  if (!id) return new Response(JSON.stringify({ error: 'Invalid id' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
  deleteTool(id);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
