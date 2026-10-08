export const config = { runtime: 'edge' };

import { fetchWithSheetsAuth, valuesToCsv } from './_sheets-sa.js';

// Private sheet (service-account shared, not published-to-web) — replaces the
// old publish-to-web CSV export. Downstream (index.html's fetchAndCacheEBTP)
// still expects CSV text, so this converts the Sheets API's array-of-arrays
// response to CSV rather than touching every caller.
const SPREADSHEET_ID = '1mIoA3R9LCUozGBLx4okQoQYWHjZD4tDf-OFM9m6OsQU';
const SHEET_NAME = 'LIVE';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default async function handler() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}?valueRenderOption=UNFORMATTED_VALUE`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const upstream = await fetchWithSheetsAuth(SCOPE, url, { cache: 'no-store' });
      if (!upstream.ok) {
        if (upstream.status >= 500 && attempt === 0) { await sleep(300); continue; }
        return new Response('Upstream data is temporarily unavailable.', { status: 502 });
      }
      const data = await upstream.json();
      const csv = valuesToCsv(data.values || []);
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    } catch (e) {
      if (attempt === 0) { await sleep(300); continue; }
      return new Response('Upstream data is temporarily unavailable.', { status: 502 });
    }
  }
  return new Response('Upstream data is temporarily unavailable.', { status: 502 });
}
