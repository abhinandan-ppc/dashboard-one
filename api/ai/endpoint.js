import { verifySession, readCookie } from '../_session.js';
import { resolveAccess } from '../_acl.js';

export const config = { runtime: 'nodejs' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async function handler(req) {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const session = await verifySession(readCookie(req, 'session'));
  if (!session) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let admin = false;
  try {
    ({ admin } = await resolveAccess(session.email));
  } catch {
    admin = false;
  }

  if (!admin) {
    return json({ error: 'Access denied' }, 403);
  }

  const url = new URL(req.url);
  const endpoint = url.searchParams.get('endpoint');

  if (!endpoint || !['intranet', 'ngrok', 'cloudflare'].includes(endpoint)) {
    return json({ error: 'Invalid endpoint. Use: intranet, ngrok, or cloudflare' }, 400);
  }

  const endpoints = {
    intranet: process.env.OMNIROUTE_URL_INTRANET,
    ngrok: process.env.OMNIROUTE_URL_NGROK,
    cloudflare: process.env.OMNIROUTE_URL_CLOUDFLARE,
  };

  const base = endpoints[endpoint];
  if (!base) {
    return json({ error: 'Endpoint is not configured' }, 503);
  }

  return json({ success: true, endpoint, configured: true });
}