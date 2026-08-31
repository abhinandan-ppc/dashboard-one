import { redirectWithCookies } from '../../lib/_session.js';

export const config = { runtime: 'edge' };

export default function handler(req) {
  const url = new URL(req.url);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const allowedDomains = (process.env.ALLOWED_DOMAIN || '').split(',').map(d => d.trim()).filter(Boolean);
  const redirectUri = `${url.origin}/api/auth/callback`;
  const next = url.searchParams.get('next') || '/';
  const state = btoa(JSON.stringify({ next, n: crypto.randomUUID() }));

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  if (allowedDomains.length === 1) authUrl.searchParams.set('hd', allowedDomains[0]);
  authUrl.searchParams.set('prompt', 'select_account');
  authUrl.searchParams.set('state', state);

  return redirectWithCookies(authUrl.toString(), [
    `oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  ]);
}
