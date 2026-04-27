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
