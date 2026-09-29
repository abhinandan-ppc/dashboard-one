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
// Importing an HMAC key is pure CPU work whose result never changes for the
// life of the instance, so it is prepared once and shared. Both session
// creation and every middleware verification go through here, so this is on
// the hot path for all authenticated traffic.
let keyPromise = null;
function getKey() {
  if (!keyPromise) {
    keyPromise = (async () => {
      const secret = process.env.SESSION_SECRET;
      if (!secret) throw new Error('SESSION_SECRET env var is not set');
      return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    })().catch((e) => { keyPromise = null; throw e; }); // don't cache a failure
  }
  return keyPromise;
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

// Response.redirect() returns a Response with immutable headers, so
// Set-Cookie can't be appended to it afterwards. Build it manually instead.
export function redirectWithCookies(location, cookies) {
  const headers = new Headers({ Location: location });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}
