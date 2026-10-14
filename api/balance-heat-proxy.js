export const config = { runtime: 'edge' };

import { fetchWithSheetsAuth, valuesToCsv } from './_sheets-sa.js';

const SPREADSHEET_ID = '1GTkvWjV890lVIZWc4d-SEz-2plHzeanMuTf9Q8P7pVo';
const SHEET_NAME = 'SAP';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export default async function handler() {
  const range = `'${SHEET_NAME}'`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const upstream = await fetchWithSheetsAuth(SCOPE, url, { cache: 'no-store' });
      if (!upstream.ok) {
        if (upstream.status >= 500 && attempt === 0) {
          await sleep(300);
          continue;
        }
        return new Response('Upstream data is temporarily unavailable.', { status: 502 });
      }
      const data = await upstream.json();
      return new Response(valuesToCsv(data.values || []), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      if (attempt === 0) {
        await sleep(300);
        continue;
      }
      console.error('Balance Heat Sheets request failed', error);
      return new Response('Upstream data is temporarily unavailable.', { status: 502 });
    }
  }
  return new Response('Upstream data is temporarily unavailable.', { status: 502 });
}
