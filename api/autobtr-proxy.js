export const config = { runtime: 'edge' };

import { fetchWithSheetsAuth } from './_sheets-sa.js';

// The AutoBTR workbook lives in Drive as a plain .xlsx, not a native Google
// Sheet, so this reads it with the Drive API's binary export (alt=media)
// instead of the Sheets API.
const FILE_ID = '1mY8UlWqgTSZku0GYcrDRDzPb5XL7tf-v';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default async function handler() {
  const url = `https://www.googleapis.com/drive/v3/files/${FILE_ID}?alt=media`;

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const upstream = await fetchWithSheetsAuth(SCOPE, url, { cache: 'no-store' });
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        if (upstream.status >= 500 && attempt === 0) { await sleep(300); continue; }
        return new Response(`Upstream ${upstream.status}: ${text}`, { status: 502 });
      }
      const buf = await upstream.arrayBuffer();
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Cache-Control': 'no-store',
        },
      });
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await sleep(300);
    }
  }
  return new Response((lastErr && lastErr.message) || 'AutoBTR fetch failed', { status: 502 });
}
