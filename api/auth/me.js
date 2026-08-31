import { verifySession, readCookie } from '../../lib/_session.js';
import { resolveAccess } from '../../lib/_acl.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const session = await verifySession(readCookie(req, 'session'));
  if (!session) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let admin = false;
  try {
    ({ admin } = await resolveAccess(session.email));
  } catch {
    admin = false;
  }
  return new Response(JSON.stringify({
    authenticated: true,
    email: session.email,
    name: session.name,
    picture: session.picture,
    domain: session.domain,
    admin,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
