import {cleanAutomationLog,logEntries,workflowStepState,batchProgress,workflowOutcome} from './automation-log.js';
import {readAutomationResponse} from './automation-response.js';
import {outputGroups} from './automation-outputs.js';

import {availability,selectedHostAvailability,hostStatus,statusLabel} from './automation-status.js';
import {setupScheduleControls} from './schedule-controls.js';

const $=s=>document.querySelector(s);

let state={machines:[],history:[]},socket,selected,admin=false,pending=new Map();

const finished=r=>!r||['completed','failed','stopped','missed'].includes(r.status);

let pendingAccountUpdate=null;
let noticeUntil=0,acknowledgedFailure=null,refreshingPC=false,launchPending=false;

const notice=text=>{noticeUntil=Date.now()+8000;$('#notice').textContent=text;};
const scheduleControls=setupScheduleControls({getState:()=>state,save:async schedules=>{await api({action:'schedules',schedules});render(await api());}});

const readyButton=document.createElement('button');
readyButton.textContent='Make System Ready';
$('#resolve').parentElement.append(readyButton);
const readyDialog=document.createElement('dialog');
readyDialog.innerHTML='<h2>Make System Ready</h2><p class="ready-warning"></p><p>Excel and SAP GUI will be force-closed. Unsaved work may be lost. Bot-owned processes will also be stopped. Windows must remain signed in and unlocked.</p><p class="ready-countdown" role="status"></p><div class="controls"><button type="button" class="ready-cancel">Cancel</button><button type="button" class="ready-confirm">Start 10-second countdown</button></div>';
document.body.append(readyDialog);
let readyTimer=null;
function cancelReady(){clearInterval(readyTimer);readyTimer=null;readyDialog.close();}
readyDialog.querySelector('.ready-cancel').onclick=cancelReady;
readyDialog.addEventListener('cancel',()=>{clearInterval(readyTimer);readyTimer=null;});
readyButton.onclick=()=>guard(async()=>{
 const pc=state.machines.find(p=>p.id===$('#pc').value&&!p.revoked);
 if(!pc)throw Error('Select a specific PC first.');
 if(state.run?.pcId===pc.id&&!finished(state.run))throw Error('Stop the bot run on the selected PC first.');
 if(!pc.connected)throw Error('The selected PC is offline.');
 if(!pc.makeReady)throw Error('Update agent.py on the selected PC and restart its agent first.');
 readyDialog.querySelector('.ready-warning').textContent='Target PC: '+pc.name;
 const start=readyDialog.querySelector('.ready-confirm'),count=readyDialog.querySelector('.ready-countdown');
 start.disabled=false;count.textContent='Nothing will close until you start the countdown.';
 start.onclick=()=>{
  start.disabled=true;
  const deadline=Date.now()+10000;
  count.textContent='Closing applications in 10 seconds…';
  readyTimer=setInterval(()=>{
   const remaining=Math.max(0,Math.ceil((deadline-Date.now())/1000));
   count.textContent='Closing applications in '+remaining+' seconds…';
   if(remaining)return;
   cancelReady();
   guard(async()=>{
    await api({action:'make-ready',pcId:pc.id,confirmCloseApps:true});
    notice('Preparation requested on '+pc.name+'. Waiting for its live readiness status.');
   });
  },200);
 };
 readyDialog.showModal();
});

async function api(body){const r=await fetch('/api/automation',{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});const data=await readAutomationResponse(r);admin=data.admin;return data;}

function option(select,value,label){const o=new Option(label,value);select.add(o);}

function runningStep(run){
 const stage=lastStages.get(run.id)||run.stage||0;
 const step=document.querySelectorAll('.step')[stage-1];
 if(!step)return run.status==='reserved'?'Preparing workflow':'Waiting for step update';
 const label=step.lastElementChild.cloneNode(true);label.querySelectorAll('.batch-detail').forEach(el=>el.remove());
 const batch=batchProgress(logSnapshots.get(run.id)||'');
 return label.textContent.trim()+(stage===8&&batch.current?` · Batch ${batch.current} of ${batch.total}`:'');
}

function renderAvailability(){const selectedPC=$('#pc').value;const status=selectedHostAvailability(state,selectedPC);const failed=state.run?.status==='failed'&&acknowledgedFailure!==state.run.id;if(failed&&!selectedPC){status.label='Failed';status.tone='danger';status.message=state.run.error||'The last workflow failed. Resume its checkpoint or start afresh.'}$('#status').textContent=refreshingPC?'Refreshing':status.label;$('#status').dataset.tone=refreshingPC?'warning':status.tone;$('#notice').dataset.tone=status.tone;$('#progressLabel').textContent=workflowOutcome(selected,verifiedManifests.get(selected?.id))==='completed'?(selected?.status==='failed'?'Completed · PC cleanup needs attention':'Completed'):failed?'Failed':finished(state.run)?(status.canRun?'Ready to run':'Waiting for an available PC'):`${availability(state).label} · ${runningStep(state.run)}`;if(refreshingPC)$('#notice').textContent='Refreshing PC status…';else if(Date.now()>noticeUntil)$('#notice').textContent=status.message;$('#run').disabled=launchPending||(finished(state.run)&&!status.canRun);$('#resume').disabled=launchPending;$('#fresh').disabled=launchPending;}

let stateLoaded=false;const observedRuns=new Set(),lastStages=new Map(),revealedOutputs=new Set();
let lastLogState='';
const verifiedManifests=new Map(),verifyingCleanup=new Set();
async function verifyCleanupOutcome(run){
 if(run?.status!=='failed'||!String(run.error||'').startsWith('Post-run process cleanup failed:')||verifiedManifests.has(run.id)||verifyingCleanup.has(run.id))return;
 verifyingCleanup.add(run.id);
 try{
  const manifest=await read('manifest',{},run);
  if(manifest?.run?.id!==run.id)return;
  verifiedManifests.set(run.id,manifest);
  if(selected?.id===run.id){paintWorkflow(selected,lastStages.get(run.id)||selected.stage||0);renderAvailability()}
 }catch{/* Retain failure until the host confirms the saved output manifest. */}
 finally{verifyingCleanup.delete(run.id)}
}

function render(data){const previousRunId=state.run?.id,previousSelectedId=selected?.id;stateLoaded=true;state=data;scheduleControls.render();const run=state.run;const revealOutputs=run&&finished(run)&&observedRuns.has(run.id)&&!revealedOutputs.has(run.id);renderAvailability();$('#run').textContent=finished(run)?'Start':'Stop';$('#run').classList.toggle('stop',!finished(run));$('#run').classList.toggle('primary',finished(run));if(run&&!finished(run))observedRuns.add(run.id);

 const accounts=$('#accounts'),previous=accounts.value;accounts.replaceChildren();for(const uid of new Set(state.machines.filter(p=>!p.revoked&&(!$('#pc').value||p.id===$('#pc').value)).flatMap(p=>p.accounts||[]).filter(uid=>typeof uid==='string'&&uid.trim()&&!/"|&\s*UID\d/i.test(uid))))option(accounts,uid,uid);accounts.value=[...accounts.options].some(o=>o.value===previous)?previous:accounts.options[0]?.value||'';

 renderAccountPicker();if(pendingAccountUpdate&&state.machines.some(p=>p.id===pendingAccountUpdate.pcId&&p.accountVersion===pendingAccountUpdate.version)){$('#accountFeedback').textContent='UID and password saved on the selected PC.';pendingAccountUpdate=null}if($('#accountPanel').open)renderExistingUsers();
 const pc=$('#pc'),old=pc.value;pc.replaceChildren();option(pc,'','Automatic · available PC');for(const p of state.machines.filter(p=>!p.revoked))option(pc,p.id,`${p.name} — ${hostStatus(p,state.run)}`);if([...pc.options].some(o=>o.value===old))pc.value=old;renderHostPicker();

 renderMachines();

 if(!accounts.options.length)option(accounts,'','No SAP users available');accounts.disabled=!accounts.value;if(!pc.options.length)option(pc,'','No enrolled PCs');pc.disabled=!state.machines.some(p=>!p.revoked);

 const history=$('#history'),choice=history.value;history.replaceChildren();if(!run||(run.status==='completed'&&!observedRuns.has(run.id)))option(history,'','New run');if(run)option(history,run.id,`Current: ${statusLabel(run.status)}`);for(const r of state.history||[])if(r.id!==run?.id)option(history,r.id,`${new Date(r.createdAt).toLocaleString()} — ${r.status}`);if(revealOutputs||(run&&!finished(run)&&run.id!==previousRunId))history.value=run.id;else if([...history.options].some(o=>o.value===choice))history.value=choice;

 if(!history.options.length)option(history,'','No runs yet');history.disabled=![...history.options].some(o=>o.value);$('#downloadRefresh').disabled=!history.value;selected=[run,...state.history||[]].find(r=>r?.id===history.value);if(!selected&&run&&!finished(run)){selected=run;history.value=run.id;}if(selected&&selected.id!==previousSelectedId){renderLogView(selected.id,logSnapshots.get(selected.id)||'');}if(selected?.id!==previousRunId)renderBatches('');if(!selected){paintWorkflow(null);$('#runtime').textContent='Runtime --';}else if(selected.id!==previousRunId||finished(selected)){paintWorkflow(selected,selected.stage||lastStages.get(selected.id)||0)}for(const el of document.querySelectorAll('[data-admin]'))el.hidden=!admin;

 $('#checkpoint').hidden=!run?.checkpoint||!finished(run);const origin=state.machines.find(p=>p.id===run?.pcId);$('#clear').disabled=!run?.checkpoint||!!origin?.checkpointClearing;$('#clear').textContent=origin?.checkpointClearing?'Clearing checkpoint…':'Clear checkpoint';$('#checkpointMessage').textContent=origin?.checkpointClearing?`Waiting for ${origin.name} to confirm checkpoint clearing${origin.connected?'':'; reconnect this PC to finish'}.`:`Resume on ${origin?.name||'the original PC'} or start afresh.`;$('#activityTitle').textContent=selected?.error||'Live output from the selected PC.';
 if(revealOutputs){revealedOutputs.add(run.id);$('#outputsPanel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});guard(outputs);}
 const logState=selected ? selected.id+':'+selected.status : '';
 if(logState!==lastLogState){lastLogState=logState;queueMicrotask(()=>logs());}



}

let reconnectTimer,renewTimer,connecting=false;
function retryConnection(){clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connect,3000)}
async function connect(){
 if(connecting||socket?.readyState===1)return;
 connecting=true;
 try{
  const ticket=await api({action:'ticket'});
  const ws=new WebSocket(ticket.relay.replace(/^http/,'ws')+'/connect?ticket='+encodeURIComponent(ticket.ticket));socket=ws;
  const opening=setTimeout(()=>{if(ws.readyState===0)ws.close()},15000);
  ws.onopen=()=>{clearTimeout(opening);connecting=false;ws.send(JSON.stringify({type:'state'}));$('#activityTitle').textContent='Live output from the selected PC.';logs();clearTimeout(renewTimer);renewTimer=setTimeout(()=>ws.close(),290000)};
  ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.type==='state')render(m);else if(m.type==='readResult'||m.type==='runResult'){const p=pending.get(m.requestId);if(p){pending.delete(m.requestId);m.error?p.reject(Object.assign(Error(m.error),{commandRejected:true})):p.resolve(m.data)}}else if(m.error)notice(m.error)}catch{$('#activityTitle').textContent='Unable to read a live update. Retrying…'}};
  ws.onclose=()=>{clearTimeout(opening);clearTimeout(renewTimer);connecting=false;for(const p of pending.values())p.reject(Error('Live connection interrupted'));pending.clear();$('#activityTitle').textContent='Reconnecting live updates… Last received log is preserved.';retryConnection()};
  ws.onerror=()=>ws.close();
 }catch(e){connecting=false;$('#activityTitle').textContent=`Live updates unavailable: ${e.name==='TimeoutError'?'Dashboard authorization request timed out; this does not mean the Bot PC stopped':e.message}. Retrying…`;retryConnection()}
}
window.addEventListener('online',()=>{clearTimeout(reconnectTimer);connect()});
setInterval(()=>{if(socket?.readyState!==1&&!connecting&&!document.hidden)api().then(render).catch(()=>{})},15000);


function read(kind,extra={},run=selected){return new Promise((resolve,reject)=>{if(!run)return reject(Error('Choose a run'));if(socket?.readyState!==1)return reject(Error('Relay disconnected'));if(!state.machines.some(p=>p.id===run.pcId&&p.connected&&!p.revoked))return reject(Error('This run’s PC is offline. Reconnect it to view its logs or outputs.'));const requestId=crypto.randomUUID();pending.set(requestId,{resolve,reject});socket.send(JSON.stringify({type:'read',pcId:run.pcId,runId:run.id,kind,requestId,...extra}));setTimeout(()=>{if(pending.delete(requestId))reject(Error('PC did not respond'))},15000)});}

let activityRunId=null,loadingLog=false;
const logSnapshots=new Map(),clearedLogs=new Map();
async function logs(){if(!selected||loadingLog||socket?.readyState!==1)return;if(!state.machines.some(p=>p.id===selected.pcId&&p.connected&&!p.revoked)){$('#activityTitle').textContent='This run’s PC is offline. Last received output is preserved.';return}loadingLog=true;const runId=selected.id;try{const raw=await read('log');if(selected?.id!==runId)return;const text=cleanAutomationLog(raw);const area=$('#activity'),output=$('#activityText');const follow=activityRunId!==runId||area.scrollTop<32;activityRunId=runId;const oldHeight=area.scrollHeight,oldTop=area.scrollTop;logSnapshots.set(runId,text);renderLogView(runId,text);area.scrollTop=follow?0:oldTop+(area.scrollHeight-oldHeight);const patterns=['Dashboard selected','PHASE A:','PHASE B:','PHASE C:','PHASE 1:','Auto-planned batches:','PHASE 2:','--- Batch','PHASE 3:','PHASE 4:','PHASE 5:','EBTP MACRO: Starting','EBTP MACRO: Saving','EBTP CLEANUP:','EBTP output created','EBTP POST: Downloading','Applying UID pivot','All selected steps are finished'];let stage=0;patterns.forEach((p,i)=>{if(text.toLowerCase().includes(p.toLowerCase()))stage=i+1});renderBatches(text);lastStages.set(runId,stage);paintWorkflow(selected,stage);renderAvailability();}catch(e){$('#activityTitle').textContent=e.message+' — retaining last received output.'}finally{loadingLog=false}}

let outputRequest=0;
async function outputs(){
 const run=selected,request=++outputRequest,files=$('#files');
 files.textContent='Loading outputs…';files.setAttribute('aria-busy','true');
 try{
  const manifest=await read('manifest',{},run);
  if(request!==outputRequest||selected?.id!==run?.id)return;
  files.replaceChildren();
  if(!manifest.files?.length)files.textContent='No output files are available for this run.';
  for(const group of outputGroups(manifest.files||[])){
   const section=document.createElement('div');section.className='output-group'+(group.main?' main-outputs':'');
   const heading=document.createElement('h3');heading.textContent=group.title;section.append(heading);
   files.append(section);
  for(const f of group.files){
   const button=document.createElement('button');button.className='download-pill';
   const fill=document.createElement('span');fill.className='download-fill';fill.setAttribute('aria-hidden','true');
   const label=document.createElement('span');label.className='download-label';
   const detail=document.createElement('span');detail.className='download-detail';
   label.textContent=f.name;detail.textContent=`${(f.size/1048576).toFixed(1)} MB`;
   button.append(fill,label,detail);
   button.onclick=()=>guard(async()=>{
    button.disabled=true;button.classList.add('downloading');button.setAttribute('aria-busy','true');
    const progress=(value,text)=>{button.style.setProperty('--download-progress',value+'%');detail.textContent=text;button.setAttribute('aria-label',`${f.name}: ${text}`)};
    progress(0,'Downloading · 0%');
    try{
     let offset=0,parts=[];
     while(offset<f.size){
      const c=await read('chunk',{file:f.name,offset},run);
      const bytes=Uint8Array.from(atob(c.chunk),c=>c.charCodeAt(0));
      if(!bytes.length||c.offset!==offset||offset+bytes.length>f.size)throw Error('Invalid transfer');
      parts.push(bytes);offset+=bytes.length;
      progress(Math.round(offset/f.size*100),`Downloading · ${Math.round(offset/f.size*100)}%`);
     }
     progress(100,'Verifying…');
     const blob=new Blob(parts);
     const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
     if(hash!==f.sha256)throw Error('Download checksum mismatch');
     const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
     progress(100,'Download ready');
    }catch(error){progress(0,'Failed · click to retry');throw error}
    finally{button.disabled=false;button.classList.remove('downloading');button.removeAttribute('aria-busy')}
   });
   section.append(button);
  }
  }
 }catch(error){if(request===outputRequest)files.textContent=error.message+' Use Load outputs to retry.';throw error}
 finally{if(request===outputRequest)files.removeAttribute('aria-busy')}
}


async function guard(fn){try{await fn()}catch(e){notice(e.message);if($('#accountPanel').open)$('#accountFeedback').textContent=e.message}}

async function submitRun(request){
 if(launchPending)return;
 launchPending=true;notice(request.resume?'Sending resume request to the original PC…':'Sending run request…');renderAvailability();
 try{
  let accepted;
  if(state.liveRunRequests&&socket?.readyState===1){
   let timer;
   try{accepted=await new Promise((resolve,reject)=>{
    pending.set(request.id,{resolve,reject});
    timer=setTimeout(()=>{pending.delete(request.id);reject(Error('Run acknowledgement delayed'))},5000);
    socket.send(JSON.stringify({type:'runRequest',requestId:request.id,run:request}));
   })}catch(e){if(e.commandRejected)throw e;/* Retry the SAME id: the relay returns its existing reservation. */}
   finally{clearTimeout(timer);pending.delete(request.id)}
  }
  if(!accepted)accepted=await api(request);
  // Show the reservation immediately; never overwrite a newer live run update.
  if(state.run?.id!==accepted.id&&finished(state.run))render({...state,run:accepted});
  notice(request.resume?'Resume accepted on the original PC. Waiting for host startup.':'Run accepted. Waiting for host startup.');
 }finally{launchPending=false;renderAvailability()}
}
async function launch(mode){if(mode==='resume'){const run=state.run;if(!run?.checkpoint)throw Error('No saved checkpoint is available');await submitRun({action:'run',id:crypto.randomUUID(),pcId:run.pcId,scope:run.scope,account:run.account,years:run.years,resume:true});return}if(!['all','btr','btp','ebtp','btr-btp','btp-ebtp'].includes($('#scope').value))throw Error('Select one stage or consecutive stages. To run BTR and EBTP together, also select BTP.');if(!$('#accounts').value)throw Error('Choose a SAP user');if(!$('#years').selectedOptions.length)throw Error('Select at least one export year');await submitRun({action:'run',id:crypto.randomUUID(),scope:$('#scope').value,pcId:$('#pc').value||undefined,account:$('#accounts').value,years:[...$('#years').selectedOptions].map(o=>Number(o.value)),resume:mode==='resume',abandon:mode==='fresh'});}

$('#run').onclick=()=>guard(()=>finished(state.run)?launch():api({action:'stop'}));$('#resume').onclick=()=>guard(()=>launch('resume'));$('#fresh').onclick=()=>{if(confirm('Abandon the saved continuation and start fresh?'))guard(()=>launch('fresh'))};$('#refresh').onclick=()=>guard(refreshPCStatus);$('#history').onchange=()=>{selected=[state.run,...state.history].find(r=>r?.id===$('#history').value);paintWorkflow(selected,selected?.stage||lastStages.get(selected?.id)||0);if(!selected){outputRequest++;$('#files').textContent='Select a run to load its outputs.';$('#files').removeAttribute('aria-busy');$('#activityText').replaceChildren();$('#logCount').textContent='0 lines';$('#runtime').textContent='Runtime --';return}guard(async()=>{await logs();await outputs()})};$('#downloadRefresh').onclick=()=>guard(outputs);

$('#clear').onclick=()=>{const run=state.run;if(!run?.checkpoint)return;const name=state.machines.find(p=>p.id===run.pcId)?.name||'the original PC';if(confirm(`Clear the saved checkpoint on ${name}?`))guard(async()=>{await api({action:'clear',pcId:run.pcId,runId:run.id});render(await api());notice(`Checkpoint clearing requested on ${name}.`);})};$('#enroll').onclick=()=>guard(async()=>{const name=$('#pcName').value.trim();if(!name){$('#pcName').focus();throw Error('Enter a PC display name')}const button=$('#enroll');button.disabled=true;try{const {code}=await api({action:'enroll',name});$('#enrollment').hidden=false;$('#enrollment').textContent=`Enrollment code: ${code} · Valid for 10 minutes. Enter this on ${name} during host setup.`}finally{button.disabled=false}});$('#resolve').onclick=()=>{if(confirm('Have you verified that the reserved workflow has stopped on its PC?'))guard(()=>api({action:'resolve',confirmStopped:true}))};

$('#manage').onclick=()=>{const select=$('#accountPC');select.replaceChildren();for(const p of state.machines.filter(p=>!p.revoked))option(select,p.id,p.name);if([...select.options].some(o=>o.value===$('#pc').value))select.value=$('#pc').value;renderExistingUsers();$('#accountFeedback').textContent='';$('#accountPanel').showModal()};
$('#closeAccounts').onclick=()=>$('#accountPanel').close();
$('#accountPanel').addEventListener('close',()=>{$('#password').value='';$('#manage').focus()});
function renderExistingUsers(){const list=$('#existingUsers');list.replaceChildren();const pc=state.machines.find(p=>p.id===$('#accountPC').value&&!p.revoked);$('#saveAccount').disabled=!pc;if(!pc){list.textContent='Select an enrolled PC.';return}const slots=pc.accountSlots||[];if(slots.length){for(const entry of slots){const button=document.createElement('button');button.className='user-edit-card';button.textContent=`Slot ${entry.slot} · ${entry.user}`;button.onclick=()=>{$('#slot').value=entry.slot;$('#uid').value=entry.user;$('#password').value='';$('#password').focus()};list.append(button)}}else{list.textContent=(pc.accounts||[]).filter(u=>!/"|&\s*UID\d/i.test(u)).join(' · ')||'No users reported';}}
$('#accountPC').onchange=()=>{$('#uid').value='';$('#password').value='';$('#accountFeedback').textContent='';renderExistingUsers()};


const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));

$('#saveAccount').onclick=()=>guard(async()=>{const values={slot:Number($('#slot').value),user:$('#uid').value,password:$('#password').value};if(!Number.isInteger(values.slot)||values.slot<1||values.slot>9)throw Error('Choose an account slot from 1 to 9');if(!state.machines.some(p=>!p.revoked))throw Error('Enroll a PC before updating users');if(!values.user||!values.password)throw Error('Enter user ID and new password');const envelopes={};for(const pc of state.machines.filter(p=>!p.revoked&&p.id===$('#accountPC').value)){const key=await crypto.subtle.importKey('spki',Uint8Array.from(atob(pc.publicKey),c=>c.charCodeAt(0)),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);const aes=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));envelopes[pc.id]={key:b64(await crypto.subtle.encrypt({name:'RSA-OAEP'},key,await crypto.subtle.exportKey('raw',aes))),iv:b64(iv),data:b64(await crypto.subtle.encrypt({name:'AES-GCM',iv},aes,new TextEncoder().encode(JSON.stringify(values))))};}if(!Object.keys(envelopes).length)throw Error('Select an enrolled PC');const version=crypto.randomUUID();await api({action:'accounts',pcId:$('#accountPC').value,version,envelopes});pendingAccountUpdate={pcId:$('#accountPC').value,version};$('#password').value='';$('#accountFeedback').textContent='Encrypted update sent to the selected PC. Waiting for confirmation.';notice('Encrypted update sent to the selected PC.');});

setInterval(()=>{if(selected){const end=finished(selected)?selected.updatedAt||selected.createdAt:Date.now();$('#runtime').textContent='Runtime '+new Date(Math.max(0,end-selected.createdAt)).toISOString().slice(11,19)}},1000);
setInterval(()=>{if(!document.hidden&&selected&&!finished(selected))logs()},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){logs();if(socket?.readyState===1)socket.send(JSON.stringify({type:'state'}));else connect();}});

guard(async()=>{render(await api())});connect();

setInterval(()=>{if(stateLoaded)renderAvailability()},1000);


function renderAccountPicker(){
 const list=$('#accountOptions');list.replaceChildren();const options=[...$('#accounts').options].filter(o=>o.value);
 $('#accountSummary').textContent=$('#accounts').value||'No SAP users available';
 if(!options.length){list.textContent='No SAP accounts reported by enrolled PCs.';return}
 for(const o of options){const label=document.createElement('label'),input=document.createElement('input');input.type='radio';input.name='sapAccount';input.value=o.value;input.checked=o.value===$('#accounts').value;input.onchange=()=>{$('#accounts').value=input.value;$('#accountSummary').textContent=input.value;$('#accountPicker').open=false;$('#accountPicker summary').focus()};label.append(input,document.createTextNode(o.textContent));list.append(label)}
}
$('#scopeOptions').addEventListener('change',()=>{const stages=[...document.querySelectorAll('#scopeOptions input:checked')].map(i=>i.value);$('#scope').value=stages.length===3?'all':stages.join('-');$('#scopeSummary').textContent=stages.length===3?'Full workflow':stages.map(s=>s.toUpperCase()).join(' + ')||'Select stages';if($('#scope').value==='btr-ebtp')notice('BTR + EBTP requires BTP. Select BTP as well, or run these stages separately.')});
for(const id of ['scopePicker','accountPicker','hostPicker']){const picker=$('#'+id);document.addEventListener('click',e=>{if(!picker.contains(e.target))picker.open=false});picker.addEventListener('keydown',e=>{if(e.key==='Escape'){picker.open=false;picker.querySelector('summary').focus()}})}

function renderMachines(){const root=$('#machines');root.replaceChildren();for(const pc of state.machines){const online=pc.connected&&Date.now()-(pc.seen||0)<30000,hostState=hostStatus(pc,state.run),tone=hostState==='Ready'?'success':hostState==='Offline'?'danger':'warning';const card=document.createElement('article');card.className='machine-card';card.dataset.tone=tone;const head=document.createElement('div');head.className='row';const title=document.createElement('h3');title.textContent=pc.name;const chip=document.createElement('span');chip.className='host-status';chip.textContent=hostState;head.append(title,chip);if(admin){const remove=document.createElement('button');remove.className='remove-host';remove.textContent='Remove PC';remove.disabled=state.run?.pcId===pc.id&&!finished(state.run);remove.onclick=()=>{if(confirm(`Remove ${pc.name} from the dashboard? Its enrollment will be revoked. Local files are kept; reconnecting requires a new enrollment.`))guard(async()=>{await api({action:'remove',pcId:pc.id});render(await api());notice(`${pc.name} removed.`)})};head.append(remove)}const reason=document.createElement('p');reason.textContent=online?pc.reason||'Connected':'Host agent is not connected.';const meta=document.createElement('p');meta.className='host-meta';meta.textContent=`Last seen: ${pc.seen?new Date(pc.seen).toLocaleString():'Never'} · ${pc.checkpoint?'Checkpoint saved':'No saved checkpoint'}`;card.append(head,reason,meta);const files=document.createElement('div');files.className='host-files';for(const f of pc.files||[]){const row=document.createElement('div');row.className='file-row';const label=document.createElement('strong');label.textContent=f.name;const status=document.createElement('span');status.className='file-status';status.textContent=f.exists?'Available':'Missing';status.dataset.tone=f.exists?'success':'warning';const info=document.createElement('span');info.className='file-meta';info.textContent=f.exists?`${new Date(f.modified).toLocaleString()} · ${(f.size/1048576).toFixed(1)} MB`:'No file reported';row.append(label,status,info);files.append(row)}if(!files.children.length)files.textContent='No file diagnostics reported yet.';card.append(files);root.append(card)}if(!root.children.length)root.textContent='No PCs enrolled yet.';}

$('#pc').onchange=()=>{noticeUntil=0;render(state);renderAvailability()};

function renderLogView(runId,text){
 const cleared=clearedLogs.get(runId);let visible=text;
 if(cleared){if(text.startsWith(cleared))visible=text.slice(cleared.length);else{const tail=cleared.slice(-200),index=text.lastIndexOf(tail);if(index>=0)visible=text.slice(index+tail.length)}}
 const output=$('#activityText');if(output.dataset.run===runId&&output.dataset.log===visible&&output.dataset.full===String($('#fullLog').checked))return;
 output.dataset.full=String($('#fullLog').checked);output.dataset.run=runId;output.dataset.log=visible;output.replaceChildren();
 const lines=logEntries(visible,$('#fullLog').checked).reverse();$('#logCount').textContent=`${lines.length} ${lines.length===1?'line':'lines'}`;
 if(!lines.length){const empty=document.createElement('div');empty.className='log-empty';empty.textContent=cleared?'View cleared. New messages will appear here.':'Waiting for workflow output…';output.append(empty);return}
 const fragment=document.createDocumentFragment();for(const entry of lines){const row=document.createElement('div');row.className='log-line';row.dataset.level=entry.level;const time=document.createElement('span');time.className='log-time';time.textContent=entry.time||'·';const message=document.createElement('span');message.className='log-message';message.textContent=entry.message;row.append(time,message);fragment.append(row)}output.append(fragment);
}
$('#clearLog').onclick=()=>{if(!selected)return;const text=logSnapshots.get(selected.id)||'';clearedLogs.set(selected.id,text);renderLogView(selected.id,text);$('#activity').scrollTop=0};
$('#latestLog').onclick=()=>{$('#activity').scrollTop=0};

$('#fullLog').onchange=()=>{if(selected)renderLogView(selected.id,logSnapshots.get(selected.id)||'')};

function renderHostPicker(){
 const select=$('#pc'),list=$('#hostOptions');$('#hostSummary').textContent=select.value?(state.machines.find(p=>p.id===select.value)?.name||'Select host'):'Automatic · available PC';
 list.replaceChildren();for(const option of select.options){const pc=state.machines.find(p=>p.id===option.value);const label=document.createElement('label'),radio=document.createElement('input'),copy=document.createElement('span');radio.type='radio';radio.name='executionHost';radio.value=option.value;radio.checked=select.value===option.value;copy.className='host-option-copy';const name=document.createElement('strong');name.textContent=pc?pc.name:'Automatic';const status=document.createElement('span');status.className='host-option-status';const hostState=pc?hostStatus(pc,state.run):'Ready';status.dataset.tone=hostState==='Ready'?'success':hostState==='Offline'?'danger':'warning';status.textContent=pc?hostState:'Select an available PC';copy.append(name,status);radio.onchange=()=>{select.value=radio.value;$('#hostPicker').open=false;select.dispatchEvent(new Event('change'));$('#hostPicker summary').focus()};label.append(radio,copy);list.append(label)}
}

function paintWorkflow(run,stage=0){
 verifyCleanupOutcome(run);
 if(!run)renderBatches('');
 let done=0,total=0;
 document.querySelectorAll('.step').forEach((el,i)=>{const step=run?workflowStepState(i,stage,workflowOutcome(run,verifiedManifests.get(run.id)),run.scope):{done:false,active:false,skipped:false,failed:false};for(const name of ['done','active','skipped','failed'])el.classList.toggle(name,step[name]);if(!step.skipped)total++;if(step.done)done++;const badge=el.querySelector('.badge');badge.textContent=step.done?'✓':step.failed?'!':step.skipped?'—':String(i+1);badge.setAttribute('aria-label',step.done?'Completed':step.failed?'Stopped here':step.active?'In progress':step.skipped?'Not selected':`Step ${i+1}`)});
 $('progress').value=run?.status==='completed'?100:Math.round(done/Math.max(1,total)*100);$('#percent').textContent=$('progress').value+'%';
}
// Top-layer menus sample the actual page backdrop, outside ancestor blur layers.
for(const id of ['hostPicker','scopePicker','accountPicker','yearPicker']){
 const picker=$('#'+id),panel=picker.querySelector('.year-options'),summary=picker.querySelector('summary');panel.setAttribute('popover','manual');
 function position(){if(!picker.open)return;const rect=summary.getBoundingClientRect();const width=Math.min(innerWidth-32,Math.max(rect.width,id==='hostPicker'?340:240));panel.style.width=width+'px';panel.style.left=Math.max(16,Math.min(rect.left,innerWidth-width-16))+'px';panel.style.top=(rect.bottom+6)+'px';panel.style.maxHeight=Math.max(100,Math.min(300,innerHeight-rect.bottom-22))+'px'}
 picker.addEventListener('toggle',()=>{if(picker.open){for(const other of document.querySelectorAll('.year-field details[open]'))if(other!==picker)other.open=false;panel.showPopover();position()}else panel.hidePopover()});
 window.addEventListener('resize',position);window.addEventListener('scroll',position,{capture:true,passive:true});
}

function renderBatches(text){const batch=batchProgress(text);for(const [index,label] of [[5,batch.total?`${batch.total} planned batches`:''],[7,batch.total?`${batch.current||0} / ${batch.total} batches`:'']]){const step=document.querySelectorAll('.step')[index];let detail=step.querySelector('.batch-detail');if(!detail){detail=document.createElement('small');detail.className='batch-detail';step.lastElementChild.append(detail)}detail.textContent=label;detail.hidden=!label}}

async function refreshPCStatus(){
 if(refreshingPC)return;
 refreshingPC=true;
 renderAvailability();
 const buttons=[$('#refresh'),$('#headerRefresh')].filter(Boolean);
 buttons.forEach(b=>{b.disabled=true;b.setAttribute('aria-busy','true')});
 $('#refresh').textContent='Refreshing…';
 try{if(socket?.readyState===1){socket.send(JSON.stringify({type:'state'}));logs();}else{connect();}const fresh=await api();acknowledgedFailure=fresh.run?.id;noticeUntil=0;render(fresh)}
 finally{refreshingPC=false;buttons.forEach(b=>{b.disabled=false;b.removeAttribute('aria-busy')});$('#refresh').textContent='Refresh PC status';renderAvailability()}
}
window.addEventListener('message',event=>{
 if(event.source===window.parent&&event.origin===location.origin&&event.data?.type==='refresh-automation-status')guard(refreshPCStatus);
});
// Embedded pages use the hub controls; direct visits get the same core actions.
if(window.parent===window){
 const slot=$('#hubFrameHeaderSlot');
 const refresh=document.createElement('button');refresh.id='headerRefresh';refresh.title='Refresh PC status';refresh.setAttribute('aria-label','Refresh PC status');
 refresh.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>';
 refresh.onclick=()=>guard(refreshPCStatus);
 const theme=document.createElement('button');theme.id='headerTheme';
 const syncTheme=()=>{const dark=document.documentElement.dataset.theme==='dark';theme.title=dark?'Switch to light theme':'Switch to dark theme';theme.setAttribute('aria-label',theme.title);theme.innerHTML=dark?'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>'};
 theme.onclick=()=>window.jsplTheme.set(document.documentElement.dataset.theme==='dark'?'light':'dark');
 new MutationObserver(syncTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
 syncTheme();slot.append(refresh,theme);
}
