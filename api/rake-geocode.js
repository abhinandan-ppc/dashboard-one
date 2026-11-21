import { verifySession, readCookie } from './_session.js';
import { resolveAccess } from './_acl.js';
export const config = { runtime: 'edge' };

// Small shared city dictionary, separate from the access registry. Reserve a
// credit durably BEFORE every upstream request; failed requests consume it too.
export const DAILY_LIMIT = 100;
export const MONTHLY_LIMIT = 200;
export const ENTRY_LIMIT = 5000;
export function placeKey(city, state = '') {
  return [city, state, 'India'].map(v => String(v).trim().replace(/\s+/g, ' ').toLowerCase()).join('|');
}
const path = 'rake-geocode/v1.json';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function readStore(token) {
  const id = token.split('_')[3];
  const r = await fetch(`https://${id}.private.blob.vercel-storage.com/${path}?v=${crypto.randomUUID()}`, {
    headers: { authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(8000)
  });
  if (r.status === 404) return { data: { entries: {}, day: '', month: '', daily: 0, monthly: 0 }, etag: null };
  if (!r.ok || !r.headers.get('etag')) throw new Error('Shared location cache unavailable');
  return { data: await r.json(), etag: r.headers.get('etag') };
}
async function writeStore(token, data, etag) {
  const r = await fetch(`https://vercel.com/api/blob/?${new URLSearchParams({ pathname: path })}`, {
    method: 'PUT', headers: {
      authorization: `Bearer ${token}`, 'x-api-version': '12',
      'x-vercel-blob-access': 'private', 'x-content-type': 'application/json',
      'x-add-random-suffix': '0', 'x-allow-overwrite': etag ? '1' : '0',
      'x-cache-control-max-age': '0', ...(etag ? { 'x-if-match': etag } : {})
    }, body: JSON.stringify(data), signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error('Shared cache busy; retry later');
}
export function reserve(data, now = new Date()) {
  const day = now.toISOString().slice(0, 10), month = day.slice(0, 7);
  if (data.day !== day) { data.day = day; data.daily = 0; }
  if (data.month !== month) { data.month = month; data.monthly = 0; }
  if (data.daily >= DAILY_LIMIT || data.monthly >= MONTHLY_LIMIT) return false;
  data.daily++; data.monthly++;
  return true;
}
export default async function handler(req) {
  try {
    if (req.method !== 'POST') return reply({ error: 'POST required' }, 405);
    const session = await verifySession(readCookie(req, 'session'));
    if (!session) return reply({ error: 'Sign in required' }, 401);
    const { admin, user } = await resolveAccess(session.email);
    if (!admin && !(user?.status === 'approved' && (user.allPages || user.pages?.includes('Rake-Planner.html')))) return reply({ error: 'Rake Planner access required' }, 403);
    const input = await req.json();
    const city = String(input.city || '').trim(), state = String(input.state || '').trim();
    if (!city || city.length > 120 || state.length > 80) return reply({ error: 'Invalid city or state' }, 400);
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return reply({ error: 'Shared destination cache is not configured' }, 503);
    let { data, etag } = await readStore(token);
    const key = placeKey(city, state), cached = data.entries[key];
    if (cached && (!cached.retryAt || cached.retryAt > Date.now())) return reply(cached);
    if (!process.env.GEOAPIFY_API_KEY) return reply({ error: 'Live mapping needs GEOAPIFY_API_KEY' }, 503);
    // Explicit opt-in confirms this key belongs to the provider's free plan.
    if (process.env.GEOCODING_FREE_PLAN !== '1') return reply({ error: 'Free-plan geocoding is not enabled' }, 503);
    if (data.busyUntil > Date.now()) return reply({ error: 'Location lookup in progress; retry later' }, 429);
    if (Object.keys(data.entries).length >= ENTRY_LIMIT && !cached) return reply({ error: 'Destination cache limit reached' }, 429);
    if (!reserve(data)) return reply({ error: 'Free lookup budget reached; cached destinations remain available' }, 429);
    data.busyUntil = Date.now() + 30000;
    await writeStore(token, data, etag);
    const params = new URLSearchParams({ city, ...(state ? { state } : {}), country: 'India', type: 'city', filter: 'countrycode:in', format: 'json', limit: '2', apiKey: process.env.GEOAPIFY_API_KEY });
    const upstream = await fetch(`https://api.geoapify.com/v1/geocode/search?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) return reply({ error: 'Location provider unavailable; no automatic retry' }, 502);
    const body = await upstream.json(), matches = body.results || [];
    const best = matches[0];
    const valid = best && Number.isFinite(best.lat) && Number.isFinite(best.lon) && best.country_code === 'in' && best.rank?.confidence >= 0.9 && matches.length === 1;
    const result = valid ? { lat: best.lat, lng: best.lon, city: best.city || city, state: best.state || state, label: best.formatted, source: 'Geoapify / OpenStreetMap', checkedAt: Date.now() }
      : { error: matches.length ? 'Ambiguous destination; refine city and state' : 'Destination not found', retryAt: Date.now() + 86400000 };
    // Re-read after reservation; never overwrite a competing update.
    ({ data, etag } = await readStore(token));
    data.entries[key] = result;
    data.busyUntil = 0;
    await writeStore(token, data, etag);
    return reply(result);
  } catch { return reply({ error: 'Shared mapping unavailable; existing map remains usable' }, 503); }
}
