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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Tokens are cached per scope for their ~1hr lifetime — Edge Function instances
// are reused across requests, so this saves a round trip to Google on every hit.
// Every Edge isolate starts with its own empty Map (cold starts are common),
// so this is a best-effort cache, not a guarantee — callers must still handle
// a 401 from Google by invalidating and retrying (see invalidateSheetsToken).
const tokenCache = new Map();

async function requestToken(scope) {
  const clientEmail = process.env.SHEETS_SA_CLIENT_EMAIL;
  const privateKeyPem = process.env.SHEETS_SA_PRIVATE_KEY;
  if (!clientEmail || !privateKeyPem) {
    throw new Error('Sheets access is not configured (missing SHEETS_SA_CLIENT_EMAIL / SHEETS_SA_PRIVATE_KEY)');
  }

  // Backdate `iat` by 30s: Edge Functions run across many global regions and
  // an isolate's clock can drift a few seconds from Google's — issuing a token
  // that looks like it was minted slightly in the future is exactly the
  // intermittent "Invalid JWT Signature" / invalid_grant failures this was
  // seeing under load, and a tiny backdate buys enough slack to absorb it.
  const now = Math.floor(Date.now() / 1000) - 30;
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
    const err = new Error(`Could not get a Sheets access token (${res.status}): ${text}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
}

export async function getSheetsAccessToken(scope) {
  const cached = tokenCache.get(scope);
  if (cached && cached.exp > Date.now() + 60000) return cached.token;

  // Transient failures (network blips, Google 5xx, a borderline clock-skew
  // rejection) are common enough under concurrent cold starts that retrying
  // in-process is worth it — the alternative is surfacing a flaky 502 to the
  // user for something that would have worked a second later.
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fresh = await requestToken(scope);
      tokenCache.set(scope, fresh);
      return fresh.token;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(150 * (attempt + 1));
    }
  }
  throw lastErr;
}

// Call after a 401 from Sheets/Drive using a cached token — it means the
// cached token is no longer honored (revoked, clock skew, etc.) even though
// our local expiry math says it should still be good. Without this, every
// subsequent request keeps reusing the same bad token until it naturally
// expires an hour later.
export function invalidateSheetsToken(scope) {
  tokenCache.delete(scope);
}

// Fetches a Google API URL with a Bearer token, retrying once with a forced-
// fresh token if the first attempt comes back 401 — covers the case where a
// cached token looked valid locally but Google had already stopped honoring it.
export async function fetchWithSheetsAuth(scope, url, init) {
  const token = await getSheetsAccessToken(scope);
  const run = (bearer) => fetch(url, {
    ...(init || {}),
    headers: { ...((init && init.headers) || {}), authorization: `Bearer ${bearer}` },
  });

  let res = await run(token);
  if (res.status === 401) {
    invalidateSheetsToken(scope);
    const fresh = await getSheetsAccessToken(scope);
    res = await run(fresh);
  }
  return res;
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
