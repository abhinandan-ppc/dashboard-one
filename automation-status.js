export function statusLabel(status){return ({ready:'Ready',reserved:'Starting',running:'Running',stopping:'Stopping',completed:'Completed',failed:'Failed',stopped:'Stopped',missed:'Missed'})[status]||'Checking';}
export function hostStatus(pc,run,now=Date.now()) {
  const online=!!pc?.connected&&now-(pc.seen||0)<30000;
  if(run&&run.pcId===pc?.id&&!['completed','failed','stopped','missed'].includes(run.status))return online?'Running':'Offline';
  if(!online)return 'Offline';
  return pc.ready?'Ready':'Failed';
}
export function availability(state,now=Date.now()) {
  const machines=(state.machines||[]).filter(p=>!p.revoked);
  const online=machines.filter(p=>p.connected&&now-(p.seen||0)<30000);
  const ready=online.filter(p=>p.ready);
  const run=state.run;
  if(run&&!['completed','failed','stopped','missed'].includes(run.status)){
    const pc=online.find(p=>p.id===run.pcId);
    return {tone:pc?'warning':'danger',label:pc?'Running':'Offline',message:pc?`${pc.name}: ${statusLabel(run.status)}.`:'Live host status is unavailable or out of date. The workflow may still be running; its run remains reserved. Reconnecting does not stop the workflow.',canRun:false};
  }
  if(!machines.length)return {tone:'danger',label:'Offline',message:'Enroll a host PC to run automation.',canRun:false};
  if(ready.length)return {tone:'success',label:'Ready',message:`${ready.length} PC${ready.length===1?' is':'s are'} ready. Run automation will select an available PC.`,canRun:true};
  if(online.length)return {tone:'danger',label:'Failed',message:online.map(p=>`${p.name}: ${p.reason||'Not ready'}`).join(' · '),canRun:false};
  return {tone:'danger',label:'Offline',message:'No execution PC is connected. Start the host agent and sign in to Windows.',canRun:false};
}
