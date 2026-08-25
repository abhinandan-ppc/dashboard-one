export const config = { runtime: 'edge' };

const EBTP_SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQEKS6uq6epbkSmpv548hSG63WVUiFwKLXctpeM3G8NMeXJ_ZJaTCuFj95n4gTRuhchM_T4q_kp5_au/pub?gid=0&single=true&output=csv";

export default async function handler(req) {
  try {
    const upstream = await fetch(EBTP_SHEET_URL, { cache: 'no-store' });
    if (!upstream.ok) {
      return new Response('Upstream error: ' + upstream.status, { status: 502 });
    }
    const text = await upstream.text();
    return new Response(text, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response('Proxy fetch failed: ' + ((e && e.message) || e), { status: 502 });
  }
}
