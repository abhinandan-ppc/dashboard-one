import { verifySession, readCookie } from '../_session.js';
import { resolveAccess } from '../_acl.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  const session = await verifySession(readCookie(req, 'session'));
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let admin = false;
  try {
    ({ admin } = await resolveAccess(session.email));
  } catch {
    admin = false;
  }

  if (!admin) {
    return new Response(JSON.stringify({ error: 'Access denied' }), { status: 403 });
  }

  const url = new URL(req.url);
  const endpoint = url.searchParams.get('endpoint');

  if (!endpoint || !['intranet', 'ngrok', 'cloudflare'].includes(endpoint)) {
    return new Response(JSON.stringify({ error: 'Invalid endpoint. Use: intranet, ngrok, or cloudflare' }), { status: 400 });
  }

  const endpoints = {
    intranet: process.env.OMNIROUTE_URL_INTRANET,
    ngrok: process.env.OMNIROUTE_URL_NGROK,
    cloudflare: process.env.OMNIROUTE_URL_CLOUDFLARE,
  };

  const base = endpoints[endpoint];
  if (!base) {
    return new Response(JSON.stringify({ error: 'Endpoint is not configured' }), { status: 503 });
  }

  return new Response(JSON.stringify({
    success: true,
    endpoint,
    url: base + '/chat/completions'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}