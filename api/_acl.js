// Access-control registry backed by Vercel Blob storage.
// Requires env var BLOB_READ_WRITE_TOKEN (auto-injected once a Blob store is
// connected to the project in the Vercel dashboard).
import { get, put, BlobNotFoundError } from '@vercel/blob';

const REGISTRY_PATH = 'acl/registry.json';

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
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN is not configured');
  try {
    const res = await get(REGISTRY_PATH, { access: 'private' });
    const text = await res.text();
    const parsed = JSON.parse(text);
    if (!parsed.users || typeof parsed.users !== 'object') parsed.users = {};
    return parsed;
  } catch (e) {
    if (e instanceof BlobNotFoundError) return { users: {} };
    throw e;
  }
}

export async function saveRegistry(registry) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN is not configured');
  await put(REGISTRY_PATH, JSON.stringify(registry), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
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
