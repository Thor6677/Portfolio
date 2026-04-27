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
