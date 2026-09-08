import { verifySession, readCookie } from '../_session.js';
import { resolveAccess } from '../_acl.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const session = await verifySession(readCookie(req, 'session'));
  if (!session) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let admin = false, user = null;
  try {
    ({ admin, user } = await resolveAccess(session.email));
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
    status: user ? user.status : (admin ? 'approved' : 'pending'),
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
