const enc = new TextEncoder();

function toBase64Url(bytes) {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}
async function getKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET env var is not set');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createSession(payload) {
  const body = toBase64Url(enc.encode(JSON.stringify(payload)));
  const key = await getKey();
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifySession(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const key = await getKey();
    const valid = await crypto.subtle.verify('HMAC', key, fromBase64Url(sig), enc.encode(body));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readCookie(req, name) {
  const cookie = req.headers.get('cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}
