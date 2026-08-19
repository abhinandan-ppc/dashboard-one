import { verifySession, readCookie } from './api/_session.js';

// The root page and index.html render unauthenticated too — they show their
// own login box and call /api/auth/me client-side. Every other page (the
// actual tools) stays hard-gated by this middleware.
export const config = {
  matcher: ['/((?!api/auth|favicon.ico|favicon.png|index.html|$).*)'],
};

export default async function middleware(req) {
  const token = readCookie(req, 'session');
  const session = await verifySession(token);
  if (session) return;

  const url = new URL(req.url);
  const loginUrl = new URL('/api/auth/login', url);
  loginUrl.searchParams.set('next', url.pathname + url.search);
  return Response.redirect(loginUrl.toString(), 302);
}
