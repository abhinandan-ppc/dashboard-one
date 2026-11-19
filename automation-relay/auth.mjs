export async function digest(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join(''); }
export function token() { return crypto.randomUUID()+crypto.randomUUID(); }
export const terminal = run => !run || ['completed','failed','stopped','missed'].includes(run.status);
