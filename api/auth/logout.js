export const config = { runtime: 'edge' };

export default function handler(req) {
  const url = new URL(req.url);
  const res = Response.redirect(new URL('/', url.origin).toString(), 302);
  res.headers.append('Set-Cookie', `session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return res;
}
