export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  // Quick test - return immediately WITHOUT imports
  return new Response(JSON.stringify({ 
    success: true, 
    message: 'No imports test working',
    timestamp: Date.now()
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}