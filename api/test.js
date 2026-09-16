export const config = { runtime: 'nodejs' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async function handler(req) {
  return json({ 
    success: true, 
    message: 'Test endpoint working from api/test.js',
    env: {
      hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
      hasSessionSecret: !!process.env.SESSION_SECRET,
      hasOmnirouteKey: !!process.env.OMNIROUTE_KEY
    }
  });
}