import { verifySession, readCookie } from '../_session.js';
import { resolveAccess } from '../_acl.js';

// Uses default Node.js runtime to avoid Edge bundling conflicts with middleware.

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
    intranet: 'http://10.36.4.165:20128/v1',
    ngrok: 'https://traffic-appetite-relay.ngrok-free.dev/v1',
    cloudflare: 'https://speech-constructed-sims-deputy.trycloudflare.com/v1'
  };

  return new Response(JSON.stringify({ 
    success: true, 
    endpoint,
    url: endpoints[endpoint] + '/chat/completions'
  }), { 
    status: 200, 
    headers: { 'Content-Type': 'application/json' } 
  });
}