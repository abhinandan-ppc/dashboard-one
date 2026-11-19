export function statusLabel(status){return ({ready:'Ready',reserved:'Starting',running:'Running',stopping:'Stopping',completed:'Completed',failed:'Failed',stopped:'Stopped',missed:'Missed'})[status]||'Checking';}
export function availability(state,now=Date.now()) {
  const machines=(state.machines||[]).filter(p=>!p.revoked);
  const online=machines.filter(p=>p.connected&&now-(p.seen||0)<30000);
  const ready=online.filter(p=>p.ready);
  const run=state.run;
  if(run&&!['completed','failed','stopped','missed'].includes(run.status)){
    const pc=online.find(p=>p.id===run.pcId);
    return {tone:pc?'warning':'danger',label:pc?statusLabel(run.status):'Run connection lost',message:pc?`${pc.name}: ${statusLabel(run.status)}.`:'The execution PC is disconnected. Its run remains reserved until it reconnects or is confirmed stopped.',canRun:false};
  }
  if(!machines.length)return {tone:'danger',label:'No PCs enrolled',message:'Enroll a host PC to run automation.',canRun:false};
  if(ready.length)return {tone:'success',label:'Ready',message:`${ready.length} PC${ready.length===1?' is':'s are'} ready. Run automation will select an available PC.`,canRun:true};
  if(online.length)return {tone:'warning',label:'PC unavailable',message:online.map(p=>`${p.name}: ${p.reason||'Not ready'}`).join(' · '),canRun:false};
  return {tone:'danger',label:'PCs offline',message:'No execution PC is connected. Start the host agent and sign in to Windows.',canRun:false};
}
