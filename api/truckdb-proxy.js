export const config = { runtime: 'edge' };

import { fetchWithSheetsAuth } from './_sheets-sa.js';

// Truck Dashboard database: four .xlsx files in one Drive folder, picked by
// file-name tag (newest wins per tag). Same service account as the other
// sheets proxies — the folder is shared Viewer on it, so no new credentials.
//
//   folder "TruckDashboard-DataBase"
//     *-PLAN.xlsx  dispatch plan
//     *-FR.xlsx    freight rates
//     *-SOB.xlsx   transporter SOB
//     *-Delay.xlsx unloading delay (REPORT-CLOSEDTRIPDETAILS-*-Delay.xlsx)
//
// GET /api/truckdb-proxy               -> index { kinds: { plan, fr, sob, delay } }
// GET /api/truckdb-proxy?kind=plan|fr|sob|delay -> newest .xlsx bytes for that kind
//
// The page fetches on open only (never via the hub cache/chips).
const FOLDER_NAME = 'TruckDashboard-DataBase';
// Hardcoded fallback from the verified folder lookup; the live lookup below
// resolves by name first so a folder recreate still works.
const FOLDER_ID_FALLBACK = '1QSQ73lKMrdO5YpFnqwWJLG1wJ5bb5B9v';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

const KINDS = [
  { kind: 'plan', token: '-PLAN', label: 'Dispatch plan' },
  { kind: 'fr', token: '-FR', label: 'Freight rate' },
  { kind: 'sob', token: '-SOB', label: 'Transporter SOB' },
  { kind: 'delay', token: '-Delay', label: 'Unloading delay' },
];

const EXT = /\.(xlsx|xlsm|xls)$/i;

function classifyFile(name) {
  if (name.startsWith('~$') || name.startsWith('.') || !EXT.test(name)) return [];
  const base = name.replace(EXT, '');
  return KINDS.filter(({ token }) =>
    new RegExp(token.replace(/[-]/g, '\\-') + '(?![A-Za-z])', 'i').test(base)
  ).map((k) => k.kind);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function resolveFolderId() {
  try {
    const q = `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`;
    const url = 'https://www.googleapis.com/drive/v3/files?'
      + new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '10' });
    const upstream = await fetchWithSheetsAuth(SCOPE, url, { cache: 'no-store' });
    if (!upstream.ok) return FOLDER_ID_FALLBACK;
    const data = await upstream.json();
    const hit = (data.files || [])[0];
    return hit ? hit.id : FOLDER_ID_FALLBACK;
  } catch {
    return FOLDER_ID_FALLBACK;
  }
}

async function listFolderFiles() {
  const folderId = await resolveFolderId();
  const q = `'${folderId}' in parents and trashed=false`;
  let files = [];
  let pageToken = '';
  for (let pages = 0; pages < 5; pages++) {
    const url = 'https://www.googleapis.com/drive/v3/files?'
      + new URLSearchParams({
        q,
        fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)',
        pageSize: '100',
        ...(pageToken ? { pageToken } : {}),
      });
    const upstream = await fetchWithSheetsAuth(SCOPE, url, { cache: 'no-store' });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      const err = new Error(`Drive list failed (${upstream.status}): ${text}`);
      err.status = upstream.status;
      throw err;
    }
    const data = await upstream.json();
    files = files.concat(data.files || []);
    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }
  return files.map((f) => ({
    id: f.id,
    name: f.name,
    size: Number(f.size) || 0,
    modified: Date.parse(f.modifiedTime) || 0,
    kinds: classifyFile(f.name || ''),
  }));
}

function buildIndex(files) {
  const out = { folder: 'TruckDashboard-DataBase', exists: true, kinds: {}, ambiguous: [] };
  for (const k of KINDS) {
    const matches = files
      .filter((f) => f.kinds.length === 1 && f.kinds[0] === k.kind)
      .sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
    out.kinds[k.kind] = {
      token: k.token,
      label: k.label,
      file: matches[0]
        ? { id: matches[0].id, name: matches[0].name, size: matches[0].size, modified: matches[0].modified }
        : null,
      older: matches.slice(1).map((f) => f.name),
    };
  }
  out.ambiguous = files.filter((f) => f.kinds.length > 1).map((f) => f.name);
  return out;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const kind = (url.searchParams.get('kind') || '').toLowerCase();

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const files = await listFolderFiles();
      const index = buildIndex(files);

      if (!kind) return json(index);

      const entry = KINDS.some((k) => k.kind === kind)
        ? index.kinds[kind].file
        : null;
      if (!entry) {
        return json({ error: kind ? `No TruckDashboard-DataBase file for kind "${kind}".` : 'Unknown request.' }, 404);
      }

      // Stream the bytes straight through (the delay workbook is ~13 MB —
      // buffering it would risk the Edge isolate's memory/response limits).
      const fileUrl = `https://www.googleapis.com/drive/v3/files/${entry.id}?alt=media`;
      const upstream = await fetchWithSheetsAuth(SCOPE, fileUrl, { cache: 'no-store' });
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        if (upstream.status >= 500 && attempt === 0) { await sleep(300); continue; }
        return new Response(`Upstream ${upstream.status}: ${text}`, { status: 502 });
      }
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (e) {
      lastErr = e;
      // Transient 5xx/network from the list call is worth one retry.
      if (attempt === 0) await sleep(300);
    }
  }
  const status = (lastErr && lastErr.status >= 500) ? 502 : 502;
  return json({ error: (lastErr && lastErr.message) || 'Truck database fetch failed' }, status);
}
