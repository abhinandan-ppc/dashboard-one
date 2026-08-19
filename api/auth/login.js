export const config = { runtime: 'edge' };

export default function handler(req) {
  const url = new URL(req.url);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const allowedDomain = process.env.ALLOWED_DOMAIN || '';
  const redirectUri = `${url.origin}/api/auth/callback`;
  const next = url.searchParams.get('next') || '/';
  const state = btoa(JSON.stringify({ next, n: crypto.randomUUID() }));

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('hd', allowedDomain);
  authUrl.searchParams.set('prompt', 'select_account');
  authUrl.searchParams.set('state', state);

  const res = Response.redirect(authUrl.toString(), 302);
  res.headers.append('Set-Cookie', `oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  return res;
}
