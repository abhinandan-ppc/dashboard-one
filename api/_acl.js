// Access-control registry backed by Vercel Blob storage.
// Requires env var BLOB_READ_WRITE_TOKEN (auto-injected once a Blob store is
// connected to the project in the Vercel dashboard).
//
// Talks to the Blob REST API directly via fetch instead of importing the
// @vercel/blob SDK — that package pulls in Node-only deps (undici, node:*
// builtins) that Edge Middleware can't bundle. Plain fetch works fine there.

const REGISTRY_PATH = 'acl/registry.json';
const BLOB_API_URL = 'https://vercel.com/api/blob';
const BLOB_API_VERSION = '12';

function blobToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is not configured');
  return token;
}

function storeIdFromToken(token) {
  // Tokens look like vercel_blob_rw_<storeId>_<secret>
  return token.split('_')[3] || '';
}

async function blobPutJson(pathname, value) {
  const token = blobToken();
  const storeId = storeIdFromToken(token);
  const requestId = `${storeId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const url = `${BLOB_API_URL}/?${new URLSearchParams({ pathname })}`;
  const res = await fetch(url, {
    method: 'PUT',
    body: JSON.stringify(value),
    headers: {
      'x-api-blob-request-id': requestId,
      'x-vercel-blob-store-id': storeId,
      'x-api-blob-request-attempt': '0',
      'x-api-version': BLOB_API_VERSION,
      authorization: `Bearer ${token}`,
      'x-vercel-blob-access': 'private',
      'x-content-type': 'application/json',
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Blob write failed (${res.status}): ${text}`);
  }
}

async function blobGetJson(pathname) {
  const token = blobToken();
  const storeId = storeIdFromToken(token);
  const url = `https://${storeId}.private.blob.vercel-storage.com/${pathname}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Blob read failed (${res.status})`);
  return res.json();
}

export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'abhinandan.mandal@jindalsteel.in')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export const DEV_HOSTS = (process.env.DEV_HOSTS || 'pmppc-dev.vercel.app')
  .split(',').map(s => s.trim()).filter(Boolean);

// Known tool pages users can be granted access to. Admins can also grant
// access to arbitrary custom paths (e.g. cards added with a one-off path).
export const KNOWN_PAGES = [
  'PM-Yard.html',
  'Plate-Tagging-Tool.html',
  'Rake-Planner.html',
  'SMS Heat Planner Daily.html',
  'SMS Heat Planner Monthly.html',
  'SMS-Heat-Planner.html',
  'VDO-Generator.html',
];

export function isAdmin(email) {
  return !!email && ADMIN_EMAILS.includes(String(email).toLowerCase());
}

export async function getRegistry() {
  const parsed = await blobGetJson(REGISTRY_PATH);
  if (!parsed || typeof parsed !== 'object') return { users: {} };
  if (!parsed.users || typeof parsed.users !== 'object') parsed.users = {};
  return parsed;
}

export async function saveRegistry(registry) {
  await blobPutJson(REGISTRY_PATH, registry);
}

// Called on every successful login. Creates a pending record for new users,
// refreshes profile fields + lastLogin for existing ones. Admin accounts are
// never stored — they always have full access.
export async function recordLogin({ email, name, picture, domain }) {
  const lower = String(email || '').toLowerCase();
  if (!lower || isAdmin(lower)) return;
  const registry = await getRegistry();
  const now = Date.now();
  const existing = registry.users[lower];
  if (existing) {
    existing.name = name || existing.name;
    existing.picture = picture || existing.picture;
    existing.domain = domain || existing.domain;
    existing.lastLogin = now;
  } else {
    registry.users[lower] = {
      name: name || lower,
      picture: picture || '',
      domain: domain || '',
      status: 'pending',
      pages: [],
      allPages: false,
      devAccess: false,
      firstLogin: now,
      lastLogin: now,
    };
  }
  await saveRegistry(registry);
}

export async function checkAccess(email, pagePath) {
  if (isAdmin(email)) return true;
  const registry = await getRegistry();
  const user = registry.users[String(email).toLowerCase()];
  if (!user || user.status !== 'approved') return false;
  if (user.allPages) return true;
  return (user.pages || []).includes(pagePath);
}

export async function checkDevAccess(email) {
  if (isAdmin(email)) return true;
  const registry = await getRegistry();
  const user = registry.users[String(email).toLowerCase()];
  return !!(user && user.status === 'approved' && user.devAccess);
}
