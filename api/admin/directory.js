import { readCookie, verifySession } from '../../lib/_session.js';
import { resolveAccess } from '../../lib/_acl.js';
import { searchDirectory } from '../_directory.js';

export const config = { runtime: 'edge' };

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  const session = await verifySession(readCookie(req, 'session'));
  if (!session) return json({ error: 'forbidden' }, 403);
  const { admin } = await resolveAccess(session.email);
  if (!admin) return json({ error: 'forbidden' }, 403);

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 2) return json({ results: [] });

  try {
    const results = await searchDirectory(q);
    return json({ results });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
