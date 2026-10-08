// Shared Google service-account auth for the Sheets/Drive proxies below.
// Deliberately a SEPARATE credential from GOOGLE_SA_CLIENT_EMAIL/GOOGLE_SA_PRIVATE_KEY
// in api/_directory.js (which has domain-wide-delegated Admin Directory access) —
// this one is scoped to nothing but the specific sheets/folders it's been
// shared on, so keep it under its own env vars: SHEETS_SA_CLIENT_EMAIL,
// SHEETS_SA_PRIVATE_KEY.
//
// Signs its own JWT with Web Crypto instead of the googleapis SDK, which pulls
// in Node-only dependencies that Edge Functions can't bundle.

function base64UrlEncode(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

// Tokens are cached per scope for their ~1hr lifetime — Edge Function instances
// are reused across requests, so this saves a round trip to Google on every hit.
const tokenCache = new Map();

export async function getSheetsAccessToken(scope) {
  const cached = tokenCache.get(scope);
  if (cached && cached.exp > Date.now() + 60000) return cached.token;

  const clientEmail = process.env.SHEETS_SA_CLIENT_EMAIL;
  const privateKeyPem = process.env.SHEETS_SA_PRIVATE_KEY;
  if (!clientEmail || !privateKeyPem) {
    throw new Error('Sheets access is not configured (missing SHEETS_SA_CLIENT_EMAIL / SHEETS_SA_PRIVATE_KEY)');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claim))}`;

  const keyData = pemToArrayBuffer(privateKeyPem.replace(/\\n/g, '\n'));
  const key = await crypto.subtle.importKey(
    'pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Could not get a Sheets access token (${res.status}): ${text}`);
  }
  const data = await res.json();
  tokenCache.set(scope, { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

// Minimal CSV serializer for values.get()'s array-of-arrays response — good
// enough for the EBTP proxy's downstream CSV parser (quotes/commas/newlines only).
export function valuesToCsv(values) {
  return (values || []).map(row =>
    (row || []).map(cell => {
      const s = cell == null ? '' : String(cell);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')
  ).join('\n');
}
