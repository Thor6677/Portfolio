import type { APIRoute } from 'astro';
import { createTool, listTools } from '../../../lib/db';

function isValidToolUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

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
    return new Response(JSON.stringify({ error: 'Name and URL are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!isValidToolUrl(url)) {
    return new Response(JSON.stringify({ error: 'URL must use http or https' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  createTool({ name, url, description, tags, display_order });
  return new Response(null, { status: 302, headers: { Location: '/admin/tools' } });
};
