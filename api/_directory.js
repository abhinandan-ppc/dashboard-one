// Google Workspace directory search via a domain-wide-delegated service
// account. Requires GOOGLE_SA_CLIENT_EMAIL, GOOGLE_SA_PRIVATE_KEY, and
// GOOGLE_SA_IMPERSONATE (a super admin's email the service account acts as)
// to be set — see the setup checklist for your Workspace admin.
//
// Signs its own JWT with Web Crypto instead of the googleapis SDK, which
// pulls in Node-only dependencies that Edge Functions can't bundle.

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

async function getDirectoryAccessToken() {
  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL;
  const privateKeyPem = process.env.GOOGLE_SA_PRIVATE_KEY;
  const impersonate = process.env.GOOGLE_SA_IMPERSONATE;
  if (!clientEmail || !privateKeyPem || !impersonate) {
    throw new Error('Directory search is not configured (missing GOOGLE_SA_CLIENT_EMAIL / GOOGLE_SA_PRIVATE_KEY / GOOGLE_SA_IMPERSONATE)');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/admin.directory.user.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    sub: impersonate,
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
    throw new Error(`Could not get a directory access token (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.access_token;
}

export async function searchDirectory(query) {
  const token = await getDirectoryAccessToken();
  const domain = (process.env.ALLOWED_DOMAIN || '').split(',')[0].trim();

  const params = new URLSearchParams({ maxResults: '10', orderBy: 'email' });
  if (domain) params.set('domain', domain);
  const q = String(query || '').trim();
  if (q) params.set('query', `email:${q}* OR givenName:${q}* OR familyName:${q}*`);

  const res = await fetch(`https://admin.googleapis.com/admin/directory/v1/users?${params}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Directory search failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return (data.users || []).map(u => ({
    email: u.primaryEmail,
    name: (u.name && u.name.fullName) || u.primaryEmail,
    photo: u.thumbnailPhotoUrl || '',
  }));
}
