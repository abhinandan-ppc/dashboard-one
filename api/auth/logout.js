import { redirectWithCookies } from '../_session.js';

export const config = { runtime: 'edge' };

export default function handler(req) {
  const url = new URL(req.url);
  return redirectWithCookies(new URL('/', url.origin).toString(), [
    `session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  ]);
}
