export const SCOPES = ['all', 'btr', 'btp', 'ebtp', 'btr-btp', 'btp-ebtp'];
export function reserve(state, request, machines, now = Date.now()) {
  if(request.resume){
    if(!state.run?.checkpoint)throw new Error('No saved checkpoint is available to resume');
    request={...request,pcId:state.run.pcId,scope:state.run.scope,account:state.run.account,years:state.run.years,abandon:false};
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(request.id||'') || !SCOPES.includes(request.scope) || typeof request.account!=='string') throw new Error('Invalid run request');
  if (state.run?.id === request.id) return state.run;
  if (state.run && !['completed', 'failed', 'stopped'].includes(state.run.status)) throw new Error('A run is already reserved');
  if (state.run?.checkpoint && !request.abandon && !request.resume) throw new Error('Choose resume or start fresh');
  const eligible = machines.filter(pc => pc.ready && now - pc.seen < 30000 && pc.accounts?.includes(request.account) && (!request.pcId || pc.id===request.pcId) && (!request.resume || !state.run?.checkpoint || pc.id === state.run?.pcId));
  eligible.sort((a, b) => a.lastRun - b.lastRun || a.id.localeCompare(b.id));
  if (!eligible.length) throw new Error('No compatible PC is ready. Retry when one is available.');
  if (!Array.isArray(request.years) || !request.years.length || request.years.some(y => !Number.isInteger(y) || y < 2000 || y > 2100)) throw new Error('Invalid export years');
  return { id:request.id,scope:request.scope,account:request.account,years:request.years,resume:!!request.resume,abandon:!!request.abandon,requestedBy:request.requestedBy, pcId: eligible[0].id, status: 'reserved', createdAt: now };
}
