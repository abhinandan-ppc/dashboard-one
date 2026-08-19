import { verifySession, readCookie } from './api/_session.js';

export const config = {
  matcher: ['/((?!api/auth|favicon.ico).*)'],
};

export default async function middleware(req) {
  const token = readCookie(req, 'session');
  const session = await verifySession(token);
  if (session) return;

  const url = new URL(req.url);
  const loginUrl = new URL('/api/auth/login', url);
  loginUrl.searchParams.set('next', url.pathname + url.search);
  return Response.redirect(loginUrl, 302);
}
