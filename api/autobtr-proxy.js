export const config = { runtime: 'edge' };

import { getSheetsAccessToken } from './_sheets-sa.js';

// The AutoBTR workbook lives in Drive as a plain .xlsx, not a native Google
// Sheet, so this reads it with the Drive API's binary export (alt=media)
// instead of the Sheets API.
const FILE_ID = '1mY8UlWqgTSZku0GYcrDRDzPb5XL7tf-v';

export default async function handler() {
  try {
    const token = await getSheetsAccessToken('https://www.googleapis.com/auth/drive.readonly');
    const url = `https://www.googleapis.com/drive/v3/files/${FILE_ID}?alt=media`;
    const upstream = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
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
    return new Response(e.message || 'AutoBTR fetch failed', { status: 502 });
  }
}
