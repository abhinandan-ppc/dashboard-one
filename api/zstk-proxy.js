export const config = { runtime: 'edge' };

import { fetchWithSheetsAuth } from './_sheets-sa.js';

const SPREADSHEET_ID = '1KP7GV1jcbKFrXUH5_ZjraQM5231nhs7yrkJyuJ2Dq5I';
const SHEET_NAME = 'ZSTK_LIVE_TEMP';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default async function handler() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}?valueRenderOption=UNFORMATTED_VALUE`;

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const upstream = await fetchWithSheetsAuth(SCOPE, url, { cache: 'no-store' });
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        // 5xx from Google is transient often enough to be worth one retry
        // before surfacing it as a hard failure to the dashboard.
        if (upstream.status >= 500 && attempt === 0) { await sleep(300); continue; }
        return new Response(JSON.stringify({ error: `Upstream ${upstream.status}: ${text}` }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const data = await upstream.json();
      return new Response(JSON.stringify({ values: data.values || [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await sleep(300);
    }
  }
  return new Response(JSON.stringify({ error: (lastErr && lastErr.message) || 'ZSTK fetch failed' }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  });
}
