import { verifySession, readCookie } from './_session.js';
import { resolveAccess, DEV_HOSTS } from './_acl.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  try {
  // Vercel Node handlers expose a plain header object; shared session helpers
  // use the Web Headers interface used by the existing Edge routes.
  const headers=new Headers();
  for(const [name,value] of Object.entries(req.headers||{})) if(value!==undefined) headers.set(name,Array.isArray(value)?value.join('; '):value);
  const session=await verifySession(readCookie({headers},'session'));
  if(!session) return res.status(401).json({error:'Sign in required'});
  const {admin,user}=await resolveAccess(session.email);
  if(!admin && DEV_HOSTS.includes((req.headers.host||'').split(':')[0]) && !user?.devAccess)return res.status(403).json({error:'Development access required'});
  if(!admin && !(user?.status==='approved' && user.pages?.includes('Auto-BTP.html'))) return res.status(403).json({error:'Explicit automation page access required'});
  if(!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Method not allowed'});
  if(req.method==='POST' && req.headers.origin !== `https://${req.headers.host}`) return res.status(403).json({error:'Invalid origin'});
  const origin=process.env.AUTOMATION_RELAY_URL;
  const secret=process.env.AUTOMATION_RELAY_SECRET;
  if(!origin || !secret) return res.status(503).json({error:'Automation relay is not configured. No PC has been enrolled.'});
  try {
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
    if(req.method==='POST'&&!['ticket','run','stop'].includes(body?.action)&&!admin)return res.status(403).json({error:'Administrator access required'});
    const response=await fetch(new URL('/control',origin),{method:req.method,headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:req.method==='POST'?JSON.stringify({...body,requestedBy:session.email}):undefined,signal:AbortSignal.timeout(10000)});
    return res.status(response.status).json({...await response.json(),admin,relay:origin});
  } catch { return res.status(503).json({error:'Automation relay is unavailable'}); }
  } catch { return res.status(500).json({error:'Unable to verify automation access. Please sign in again or retry.'}); }
}
