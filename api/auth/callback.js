import { createSession, readCookie, redirectWithCookies } from '../_session.js';
import { recordLogin } from '../_acl.js';
import { waitUntil } from '@vercel/functions';

export const config = { runtime: 'edge' };

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function accessDeniedPage(email, allowedDomains) {
  const domainList = allowedDomains.map(d => `<code>${esc(d)}</code>`).join(', ') || '(none configured)';
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Access Denied</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center;
    font-family: 'DM Sans', system-ui, -apple-system, Segoe UI, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; }
  .card { max-width: 420px; width: 100%; background: rgba(30,41,59,0.75); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 22px; padding: 36px 32px; text-align: center; box-shadow: 0 10px 40px rgba(2,6,23,0.4); }
  h1 { font-size: 19px; margin: 0 0 12px; color: #f87171; }
  p { font-size: 13.5px; color: #94a3b8; line-height: 1.6; margin: 0 0 10px; }
  code { background: rgba(255,255,255,0.08); border-radius: 6px; padding: 2px 7px; color: #8dcdff; font-size: 12.5px; }
  a { display: inline-block; margin-top: 18px; padding: 10px 20px; border-radius: 999px; background: #8dcdff;
    color: #00344f; font-weight: 700; font-size: 13px; text-decoration: none; }
</style></head>
<body>
  <div class="card">
    <h1>Access Denied</h1>
    <p>The Google account <code>${esc(email || 'unknown')}</code> isn't part of an allowed organization.</p>
    <p>Only accounts on these domains can sign in: ${domainList}</p>
    <a href="/">Back to sign-in</a>
  </div>
</body></html>`;
  return new Response(html, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export default async function handler(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = readCookie(req, 'oauth_state');

  if (!code || !state || state !== expectedState) {
    return new Response('Invalid or expired sign-in attempt. Go back and try again.', { status: 400 });
  }
  let next = '/';
  try {
    const decoded = JSON.parse(atob(state)).next;
    if (typeof decoded === 'string' && decoded.startsWith('/') && !decoded.startsWith('//')) next = decoded;
  } catch {}

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
  if (!tokens.id_token) return new Response('Google sign-in failed: no ID token returned.', { status: 401 });

  // Let Google validate the signature and return the claims. Decoding the JWT
  // locally is not sufficient because an attacker can modify an unsigned
  // payload while keeping the token structurally valid.
  const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`);
  if (!verifyRes.ok) return new Response('Google sign-in failed: invalid ID token.', { status: 401 });
  let claims;
  try {
    claims = await verifyRes.json();
  } catch {
    return new Response('Google sign-in failed: invalid identity response.', { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);
  const issuerValid = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  const audienceValid = claims.aud === process.env.GOOGLE_CLIENT_ID;
  const expiryValid = Number(claims.exp) > now;
  if (!issuerValid || !audienceValid || !expiryValid || !claims.sub) {
    return new Response('Google sign-in failed: invalid token claims.', { status: 401 });
  }

  const allowedDomains = (process.env.ALLOWED_DOMAIN || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
  const emailDomain = (claims.email || '').split('@')[1]?.toLowerCase();
  if (!claims.email_verified || !allowedDomains.includes(emailDomain)) {
    return accessDeniedPage(claims.email, allowedDomains);
  }

  const session = await createSession({
    email: claims.email,
    name: claims.name || claims.email,
    picture: claims.picture || '',
    domain: emailDomain,
    exp: Date.now() + 1000 * 60 * 60 * 12,
  });
  // Recording the login is a read-modify-write against the access registry, so
  // it costs a Blob round-trip each way. It is bookkeeping, not part of
  // authentication — the session is already signed and the user is already
  // allowed in, so hold the work past the response instead of delaying the
  // redirect the user is waiting on. waitUntil keeps the function alive until
  // it settles.
  waitUntil(
    recordLogin({ email: claims.email, name: claims.name, picture: claims.picture, domain: emailDomain })
      .catch(() => { /* blob not configured or unreachable — never block sign-in over it */ })
  );
  return redirectWithCookies(new URL(next, url.origin).toString(), [
    `session=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`,
    `oauth_state=; Path=/; HttpOnly; Max-Age=0`,
  ]);
}
