import { readFileSync } from 'node:fs';
const sa = JSON.parse(readFileSync('d:\\Projects\\dashboard-one-1\\service-account.json', 'utf8'));
function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return Buffer.from(s, 'binary').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const now = Math.floor(Date.now() / 1000) - 30;
const unsigned = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64url(JSON.stringify({
  iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly',
  aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
const { webcrypto } = await import('node:crypto');
const key = await webcrypto.subtle.importKey('pkcs8',
  Buffer.from(sa.private_key.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, ''), 'base64'),
  { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
const sig = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
const jwt = unsigned + '.' + b64url(new Uint8Array(sig));
const t = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
const { access_token } = await t.json();
const auth = { Authorization: 'Bearer ' + access_token };
const q = "mimeType='application/vnd.google-apps.folder' and name='TruckDashboard-DataBase' and trashed=false";
const r = await fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true', { headers: auth });
console.log('FOLDERS', await r.text());
const FOLDER = '1QSQ73lKMrdO5YpFnqwWJLG1wJ5bb5B9v';
const q2 = `'${FOLDER}' in parents and trashed=false`;
async function tryList(label, extra, qq) {
  const url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(qq || q2) + '&fields=files(id,name,mimeType,size,modifiedTime)' + extra;
  const r = await fetch(url, { headers: auth });
  console.log(label, r.status, (await r.text()).slice(0, 2000));
}
await tryList('INPARENTS ', '&pageSize=100', q2);
await tryList('ALLXLSX   ', '&pageSize=100', "mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' and trashed=false");
await tryList('ALLFILES  ', '&pageSize=100', 'trashed=false');
