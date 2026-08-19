import { verifySession, readCookie } from '../_session.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const session = await verifySession(readCookie(req, 'session'));
  if (!session) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({
    authenticated: true,
    email: session.email,
    name: session.name,
    picture: session.picture,
    domain: session.domain,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
