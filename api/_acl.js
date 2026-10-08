// Access-control registry backed by Vercel Blob storage.
// Requires env var BLOB_READ_WRITE_TOKEN (auto-injected once a Blob store is
// connected to the project in the Vercel dashboard).
//
// Talks to the Blob REST API directly via fetch instead of importing the
// @vercel/blob SDK — that package pulls in Node-only deps (undici, node:*
// builtins) that Edge Middleware can't bundle. Plain fetch works fine there.

// Two properties matter for correctness here, and both are load-bearing:
//
//   1. Caching. The registry is read on every page load and every API call, so
//      a per-instance copy with a short TTL (REGISTRY_CACHE_TTL_MS, default
//      5s) keeps that off the Blob round-trip. Writes update the copy in the
//      instance that made them, so an admin never sees their own change lag.
//
//   2. Conditional writes. A read-modify-write with no version check silently
//      loses edits whenever a login (recordLogin) or a second admin tab writes
//      in between — which is what made checkboxes appear to "revert". Every
//      write carries the ETag it was based on (x-if-match); a mismatch fails
//      the write and updateRegistry() re-reads, re-applies and retries.

const REGISTRY_PATH = 'acl/registry.json';
const BLOB_API_URL = 'https://vercel.com/api/blob';
const BLOB_API_VERSION = '12';

// Keep the CDN copy effectively uncached so a write is visible to the very next
// read on any instance. The local in-memory cache below is what absorbs
// repeat reads; the CDN cache is only ever in the way.
const WRITE_CACHE_MAX_AGE = '0';
const MAX_WRITE_ATTEMPTS = 3;

// Set by __setCacheTtl() in tests; null means "read the env var".
let cacheTtlOverride = null;
let cache = null; // { registry, etag, fetchedAt }

function cacheTtlMs() {
  if (cacheTtlOverride !== null) return cacheTtlOverride;
  const raw = process.env.REGISTRY_CACHE_TTL_MS;
  if (raw === undefined || raw === '') return 5000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 5000;
}

function blobToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is not configured');
  return token;
}

function storeIdFromToken(token) {
  // Tokens look like vercel_blob_rw_<storeId>_<secret>
  return token.split('_')[3] || '';
}

function isConflict(e) {
  return !!e && (e.status === 412 || e.code === 'precondition_failed');
}

// Writes the registry. ifMatch is the quoted ETag the caller based its change
// on; when present the API rejects the write (412 / precondition_failed) if the
// stored object moved on. Returns the new ETag, or null if the API didn't
// report one (in which case the next write simply skips the check).
async function blobPutJson(pathname, value, ifMatch) {
  const token = blobToken();
  const storeId = storeIdFromToken(token);
  const requestId = `${storeId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const url = `${BLOB_API_URL}/?${new URLSearchParams({ pathname })}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const headers = {
      'x-api-blob-request-id': requestId,
      'x-vercel-blob-store-id': storeId,
      'x-api-blob-request-attempt': '0',
      'x-api-version': BLOB_API_VERSION,
      authorization: `Bearer ${token}`,
      'x-vercel-blob-access': 'private',
      'x-content-type': 'application/json',
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
      'x-cache-control-max-age': WRITE_CACHE_MAX_AGE,
    };
    // x-if-match must carry the ETag exactly as returned (quotes included), and
    // only ever travels alongside x-allow-overwrite: 1 — which we always send.
    // Sending it without that produced conflicting conditional headers
    // server-side and failed the write (vercel/storage INC-5751).
    if (ifMatch) headers['x-if-match'] = ifMatch;

    const res = await fetch(url, {
      method: 'PUT',
      body: JSON.stringify(value),
      headers,
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Blob write failed (${res.status}): ${text}`);
      err.status = res.status;
      // Surface the API's machine-readable code so callers detect a version
      // conflict without string-matching the human-readable message.
      try { err.code = JSON.parse(text)?.error?.code; } catch { /* not JSON */ }
      throw err;
    }
    try {
      const body = await res.json();
      return body && body.etag ? body.etag : null;
    } catch {
      return null;
    }
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Blob write timeout');
    throw e;
  }
}

// Returns { data, etag }. data is null when the registry doesn't exist yet.
async function blobGetJson(pathname) {
  const token = blobToken();
  const storeId = storeIdFromToken(token);
  // The nonce defeats any CDN-cached copy of this private object. Without it a
  // read can return the previous version for a few seconds after a write,
  // which is exactly how a just-saved change appeared to vanish.
  const nonce = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 8)}`;
  const url = `https://${storeId}.private.blob.vercel-storage.com/${pathname}?v=${nonce}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (res.status === 404) return { data: null, etag: null };
    if (!res.ok) throw new Error(`Blob read failed (${res.status})`);
    // ETag arrives as a standard response header on the private storage URL.
    // It is null only if the store is misconfigured; writes then fall back to
    // an unconditional overwrite rather than failing outright.
    const etag = res.headers.get('etag');
    return { data: await res.json(), etag };
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Blob read timeout');
    throw e;
  }
}

export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'abhinandan.mandal@jindalsteel.in')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export const DEV_HOSTS = (process.env.DEV_HOSTS || 'pmppc-dev.vercel.app')
  .split(',').map(s => s.trim()).filter(Boolean);

// Known tool pages users can be granted access to. Keep this explicit so a
// permission record cannot accidentally authorize a future route or API path.
//
// "SMS Heat Planner Daily.html" and "SMS Heat Planner Monthly.html" are not
// listed here — they're just the two tabs SMS-Heat-Planner.html loads in
// iframes internally, never opened directly. See CHILD_PAGE_PARENTS below.
export const KNOWN_PAGES = [
  'Grade-Clubbing-Matrix.html',
  'Order-Status-Report.html',
  'PM-Yard.html',
  'Plate-Tagging-Tool.html',
  'Rake-Planner.html',
  'SMS-Heat-Planner.html',
  'VDO-Generator.html',
];

// Pages that are sub-resources of another page rather than standalone tools.
// Granting the parent page implicitly grants these too, so middleware
// doesn't block the iframe tab a user is already allowed to open.
export const CHILD_PAGE_PARENTS = {
  'SMS Heat Planner Daily.html': 'SMS-Heat-Planner.html',
  'SMS Heat Planner Monthly.html': 'SMS-Heat-Planner.html',
};

// The env-configured admin(s). This list is the irrevocable safety net —
// these accounts can never be demoted or blocked through the UI, so access
// can't be locked out by a mistake in the registry.
export function isPrimaryAdmin(email) {
  return !!email && ADMIN_EMAILS.includes(String(email).toLowerCase());
}

// Back-compat alias.
export const isAdmin = isPrimaryAdmin;

function normalize(parsed) {
  if (!parsed || typeof parsed !== 'object') return { users: {} };
  if (!parsed.users || typeof parsed.users !== 'object') parsed.users = {};
  return parsed;
}

// Always hits Blob, bypassing the cache. updateRegistry() must use this so a
// mutation is never applied on top of a copy something else already superseded.
async function readRegistryFresh() {
  const { data, etag } = await blobGetJson(REGISTRY_PATH);
  return { registry: normalize(data), etag };
}

// Cached read used by every access check. Returns a deep copy: callers
// routinely mutate what they get back (admin.html hands out the users map, and
// recordLogin-style code pokes at records), and a shared cached object would
// let one request's edit leak into the next request's view.
export async function getRegistry() {
  const ttl = cacheTtlMs();
  const now = Date.now();
  if (cache && ttl > 0 && now - cache.fetchedAt < ttl) {
    return structuredClone(cache.registry);
  }
  const fresh = await readRegistryFresh();
  cache = { registry: fresh.registry, etag: fresh.etag, fetchedAt: now };
  return structuredClone(cache.registry);
}

// The single write path. `mutate` receives the freshly-read registry, edits it
// in place, and returns a result that is handed back to the caller.
//
// The ETag of the version `mutate` saw travels with the write. If another
// writer (a concurrent login, a second admin tab) committed in between, Blob
// rejects the write and we re-read and re-apply rather than clobbering their
// change. `mutate` must therefore be a pure function of the registry it is
// given — it will be run more than once.
export async function updateRegistry(mutate) {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const { registry, etag } = await readRegistryFresh();
    const result = await mutate(registry);
    let newEtag;
    try {
      newEtag = await blobPutJson(REGISTRY_PATH, registry, etag);
    } catch (e) {
      if (!isConflict(e) || attempt === MAX_WRITE_ATTEMPTS) throw e;
      lastErr = e;
      continue; // re-read and re-apply against the newer version
    }
    // Refresh the local copy from what we just wrote, so the instance that made
    // the change sees it immediately rather than after the TTL.
    cache = {
      registry: normalize(registry),
      etag: newEtag || etag,
      fetchedAt: Date.now(),
    };
    return result;
  }
  throw lastErr || new Error('Registry update failed');
}

// Resolves everything a request needs to know about one user in a single
// registry fetch: whether they're an admin (env-configured OR promoted via
// the admin page), and their registry record (null for primary admins,
// who are never stored).
export async function resolveAccess(email) {
  const lower = String(email || '').toLowerCase();
  if (isPrimaryAdmin(lower)) return { admin: true, user: null, registry: null };
  let registry;
  try {
    registry = await getRegistry();
  } catch {
    return { admin: false, user: null, registry: null };
  }
  const user = registry.users[lower] || null;
  const admin = !!(user && user.role === 'admin' && user.status !== 'blocked');
  return { admin, user, registry };
}

// Called on every successful login. Creates a pending record for new users,
// refreshes profile fields + lastLogin for existing ones. Admin accounts are
// never stored — they always have full access.
export async function recordLogin({ email, name, picture, domain }) {
  const lower = String(email || '').toLowerCase();
  if (!lower || isPrimaryAdmin(lower)) return;
  const now = Date.now();
  await updateRegistry(registry => {
    const existing = registry.users[lower];
    if (existing) {
      existing.name = name || existing.name;
      existing.picture = picture || existing.picture;
      existing.domain = domain || existing.domain;
      if (!existing.firstLogin) existing.firstLogin = now;
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
  });
}

// Test-only hooks. Not used by the app; exported so node --test can drive the
// cache and TTL without reaching into module internals.
export function __setCacheTtl(ms) { cacheTtlOverride = ms; }
export function __resetCache() { cache = null; cacheTtlOverride = null; }
