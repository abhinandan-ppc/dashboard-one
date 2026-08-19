import { createSession, readCookie } from '../_session.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = readCookie(req, 'oauth_state');

  if (!code || !state || state !== expectedState) {
    return new Response('Invalid or expired sign-in attempt. Go back and try again.', { status: 400 });
  }
  let next = '/';
  try { next = JSON.parse(atob(state)).next || '/'; } catch {}

  const redirectUri = `${url.origin}/api/auth/callback`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return new Response('Google sign-in failed during token exchange.', { status: 401 });
  const tokens = await tokenRes.json();

  const payloadB64 = tokens.id_token.split('.')[1];
  const claims = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

  const allowedDomain = (process.env.ALLOWED_DOMAIN || '').toLowerCase();
  const emailDomain = (claims.email || '').split('@')[1]?.toLowerCase();
  if (!claims.email_verified || emailDomain !== allowedDomain) {
    return new Response(`Access denied — your Google account is not part of ${allowedDomain}.`, { status: 403 });
  }

  const session = await createSession({ email: claims.email, exp: Date.now() + 1000 * 60 * 60 * 12 });
  const res = Response.redirect(new URL(next, url.origin), 302);
  res.headers.append('Set-Cookie', `session=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`);
  res.headers.append('Set-Cookie', `oauth_state=; Path=/; HttpOnly; Max-Age=0`);
  return res;
}
