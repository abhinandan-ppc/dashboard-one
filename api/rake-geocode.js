import { verifySession, readCookie } from './_session.js';
import { resolveAccess } from './_acl.js';
export const config = { runtime: 'edge' };

// Small shared city dictionary, separate from the access registry. Reserve a
// credit durably BEFORE every upstream request; failed requests consume it too.
export const DAILY_LIMIT = 100;
export const MONTHLY_LIMIT = 200;
export const ENTRY_LIMIT = 5000;
const COUNTRY_CODES={India:'in',Switzerland:'ch',Germany:'de','United Kingdom':'gb',Denmark:'dk',Czechia:'cz',Estonia:'ee',Norway:'no',Oman:'om','United Arab Emirates':'ae',Canada:'ca','United States':'us',Japan:'jp','South Korea':'kr',Brazil:'br',Nepal:'np',Bhutan:'bt'};
Object.assign(COUNTRY_CODES,{Albania:'al',Andorra:'ad',Austria:'at',Belarus:'by',Belgium:'be','Bosnia and Herzegovina':'ba',Bulgaria:'bg',Croatia:'hr',Finland:'fi',France:'fr',Greece:'gr','Holy See':'va',Hungary:'hu',Iceland:'is',Ireland:'ie',Italy:'it',Latvia:'lv',Liechtenstein:'li',Lithuania:'lt',Luxembourg:'lu',Malta:'mt',Moldova:'md',Monaco:'mc',Montenegro:'me',Netherlands:'nl','North Macedonia':'mk',Poland:'pl',Portugal:'pt',Romania:'ro',Russia:'ru','San Marino':'sm',Serbia:'rs',Slovakia:'sk',Slovenia:'si',Spain:'es',Sweden:'se',Ukraine:'ua',Bahrain:'bh',Cyprus:'cy',Egypt:'eg',Iran:'ir',Iraq:'iq',Israel:'il',Jordan:'jo',Kuwait:'kw',Lebanon:'lb',Palestine:'ps',Qatar:'qa','Saudi Arabia':'sa',Syria:'sy','Türkiye':'tr',Yemen:'ye',Afghanistan:'af',Bangladesh:'bd',China:'cn',Myanmar:'mm',Pakistan:'pk','Sri Lanka':'lk',Maldives:'mv'});
const norm=v=>String(v||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const stateAlias=v=>({orissa:'odisha',chattisgarh:'chhattisgarh',nrthrhinewestfalia:'northrhinewestphalia',harju:'harjucounty'}[norm(v)]||norm(v));
export function selectPhotonMatch(features,{city,state,country}){
  const code=COUNTRY_CODES[country];
  const exact=features.filter(f=>{
    const p=f.properties||{},c=f.geometry?.coordinates;
    return Array.isArray(c)&&c.length>=2&&Number.isFinite(c[0])&&Number.isFinite(c[1])&&Math.abs(c[0])<=180&&Math.abs(c[1])<=90
      &&(code?String(p.countrycode).toLowerCase()===code:norm(p.country)===norm(country))
      &&norm(p.name)===norm(city)&&['city','town','village','hamlet','suburb'].includes(p.osm_value)
      &&(!state||stateAlias(state)===norm(country)||stateAlias(p.state)===stateAlias(state));
  });
  // A city-name query may also match villages with the same name. Prefer the
  // exact city/town in the stated subdivision; never choose between two cities.
  const urban=exact.filter(f=>['city','town'].includes(f.properties.osm_value));
  const candidates=urban.length?urban:exact;
  return candidates.length===1?candidates[0]:null;
}
const provider=()=>process.env.RAKE_GEOCODER||(process.env.GEOAPIFY_API_KEY&&process.env.GEOCODING_FREE_PLAN==='1'?'geoapify':'photon');
export function placeKey(city, state = '', country='India') {
  return [city, state, country].map(v => String(v).trim().replace(/\s+/g, ' ').toLowerCase()).join('|');
}
const path = 'rake-geocode/v1.json';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function readStore(token) {
  const id = token.split('_')[3];
  // Private Blob's supported origin-read flag. Random query strings and fetch
  // no-store do not bypass its CDN; stale ETags break conditional reservations.
  const r = await fetch(`https://${id}.private.blob.vercel-storage.com/${path}?cache=0`, {
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
    if (!['POST','GET'].includes(req.method)) return reply({ error: 'GET or POST required' }, 405);
    const session = await verifySession(readCookie(req, 'session'));
    if (!session) return reply({ error: 'Sign in required' }, 401);
    const { admin, user } = await resolveAccess(session.email);
    if (!admin && !(user?.status === 'approved' && (user.allPages || user.pages?.includes('Rake-Planner.html')))) return reply({ error: 'Rake Planner access required' }, 403);
    const selectedProvider=provider();
    const providerReady=selectedProvider==='photon'||selectedProvider==='geoapify'&&!!process.env.GEOAPIFY_API_KEY&&process.env.GEOCODING_FREE_PLAN==='1';
    if(req.method==='GET')return reply({ready:!!process.env.BLOB_READ_WRITE_TOKEN&&providerReady,cacheConfigured:!!process.env.BLOB_READ_WRITE_TOKEN,providerConfigured:providerReady,provider:selectedProvider,dailyLimit:DAILY_LIMIT,monthlyLimit:MONTHLY_LIMIT});
    const input = await req.json();
    const city = String(input.city || '').trim(), state = String(input.state || '').trim();
    const country=String(input.country||'India').trim();
    if(!country||country.length>80)return reply({error:'Country required'},400);
    if (!city || city.length > 120 || state.length > 80) return reply({ error: 'Invalid city or state' }, 400);
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return reply({ error: 'Shared destination cache is not configured' }, 503);
    let { data, etag } = await readStore(token);
    const key = placeKey(city, state,country), cached = data.entries[key];
    if (cached && (!cached.retryAt || cached.retryAt > Date.now())) return reply(cached);
    if (!providerReady) return reply({ error: 'Free location provider is not enabled' }, 503);
    if (data.busyUntil > Date.now()) return reply({ error: 'Location lookup in progress; retry later' }, 429);
    if (data.nextLookupAt > Date.now()) return reply({ error: 'Free lookup rate limit; retry shortly' }, 429);
    if (Object.keys(data.entries).length >= ENTRY_LIMIT && !cached) return reply({ error: 'Destination cache limit reached' }, 429);
    if (!reserve(data)) return reply({ error: 'Free lookup budget reached; cached destinations remain available' }, 429);
    data.busyUntil = Date.now() + 30000;
    data.nextLookupAt = Date.now() + 2000;
    await writeStore(token, data, etag);
    const countryCode=COUNTRY_CODES[country];
    const params = selectedProvider==='photon'
      ? new URLSearchParams({q:[city,state,country].filter(Boolean).join(', '),lang:'en',limit:'5',layer:'city',...(countryCode?{countrycode:countryCode.toUpperCase()}:{})})
      : new URLSearchParams({ city, ...(state ? { state } : {}), country, type: 'city', ...(countryCode?{filter:`countrycode:${countryCode}`} : {}), format: 'json', limit: '2', apiKey: process.env.GEOAPIFY_API_KEY });
    const endpoint=selectedProvider==='photon'?'https://photon.komoot.io/api/':'https://api.geoapify.com/v1/geocode/search';
    const upstream = await fetch(`${endpoint}?${params}`, { headers:{'User-Agent':'Dashboard-One-RakePlanner/1.0 (https://pmppc.vercel.app)'},signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) return reply({ error: 'Location provider unavailable; no automatic retry' }, 502);
    const body = await upstream.json(), matches = selectedProvider==='photon'?body.features||[]:body.results || [];
    const best = matches[0];
    const valid = best && Number.isFinite(best.lat) && Number.isFinite(best.lon) && (countryCode?best.country_code===countryCode:String(best.country||'').toLowerCase()===country.toLowerCase()) && best.rank?.confidence >= 0.9 && matches.length === 1;
    const photonMatch=selectedProvider==='photon'?selectPhotonMatch(matches,{city,state,country}):null;
    const result = photonMatch?{lat:photonMatch.geometry.coordinates[1],lng:photonMatch.geometry.coordinates[0],city:photonMatch.properties.name,state:photonMatch.properties.state||state,source:'Photon / OpenStreetMap',checkedAt:Date.now()}:valid ? { lat: best.lat, lng: best.lon, city: best.city || city, state: best.state || state, label: best.formatted, source: 'Geoapify / OpenStreetMap', checkedAt: Date.now() }
      : { error: matches.length ? 'Ambiguous destination; refine city and state' : 'Destination not found', retryAt: Date.now() + 86400000 };
    // Re-read after reservation; never overwrite a competing update.
    ({ data, etag } = await readStore(token));
    data.entries[key] = result;
    data.busyUntil = 0;
    await writeStore(token, data, etag);
    return reply({...result,waitMs:2000});
  } catch { return reply({ error: 'Shared mapping unavailable; existing map remains usable' }, 503); }
}
