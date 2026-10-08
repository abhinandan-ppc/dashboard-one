export const config = { runtime: 'edge' };

import { getSheetsAccessToken } from './_sheets-sa.js';

const SPREADSHEET_ID = '1KP7GV1jcbKFrXUH5_ZjraQM5231nhs7yrkJyuJ2Dq5I';
const SHEET_NAME = 'ZSTK_LIVE_TEMP';

export default async function handler() {
  try {
    const token = await getSheetsAccessToken('https://www.googleapis.com/auth/spreadsheets.readonly');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}?valueRenderOption=UNFORMATTED_VALUE`;
    const upstream = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
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
    return new Response(JSON.stringify({ error: e.message || 'ZSTK fetch failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
