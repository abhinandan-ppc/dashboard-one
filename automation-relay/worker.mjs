import {reserve} from './coordinator.mjs';
import {digest,token,terminal} from './auth.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export default {fetch(r,e){return e.POOL.get(e.POOL.idFromName(e.POOL_NAME||'production')).fetch(r)}};
export class Pool {
 constructor(ctx,env){this.ctx=ctx;this.env=env;}
 async locked(work){
  // Expected request errors must not escape this callback and reset the object.
  const result=await this.ctx.blockConcurrencyWhile(async()=>{try{return {value:await work()}}catch(error){return {error:error.message}}});
  if(result.error)throw Error(result.error);
  return result.value;
 }
 sockets(role,id){return this.ctx.getWebSockets().filter(s=>{const a=s.deserializeAttachment();return a.role===role&&(!id||a.id===id)});}
 send(role,id,data){for(const s of this.sockets(role,id))try{const a=s.deserializeAttachment();if(role==='browser'&&a.expires<Date.now()){s.close(1008,'Renew authorization');continue;}s.send(JSON.stringify(data))}catch{}}
 async state(){return {run:await this.ctx.storage.get('run')||null,machines:[...(await this.ctx.storage.list({prefix:'pc:'})).values()].map(({secret,...p})=>({...p,connected:!!this.sockets('agent',p.id).length})),history:[...(await this.ctx.storage.list({prefix:'history:',reverse:true,limit:100})).values()],schedule:await this.ctx.storage.get('schedule')||null};}
 async broadcast(){this.send('browser',null,{type:'state',...await this.state()});}
 async fetch(request){try{
  const url=new URL(request.url);
  if(url.pathname==='/connect')return await this.connect(request,url);
  if(url.pathname==='/enroll'&&request.method==='POST'){
   const b=await request.json();return await this.locked(async()=>{const key='enroll:'+await digest(String(b.code)),grant=await this.ctx.storage.get(key);if(!grant||grant.expires<Date.now())return json({error:'Enrollment code expired'},403);if(typeof b.publicKey!=='string'||b.publicKey.length>4096)throw Error('Invalid device key');const id=crypto.randomUUID(),secret=token();await this.ctx.storage.put('pc:'+id,{id,name:grant.name,secret:await digest(secret),publicKey:b.publicKey,seen:0,accounts:[],lastRun:0});await this.ctx.storage.delete(key);return json({id,secret});});
  }
  if(!this.env.RELAY_SECRET||request.headers.get('Authorization')!==`Bearer ${this.env.RELAY_SECRET}`)return json({error:'Unauthorized'},401);
  if(request.method==='GET')return json(await this.state());
  const b=await request.json(),action=b.action;
  if(action==='ticket'){const ticket=token();await this.ctx.storage.put('ticket:'+await digest(ticket),{expires:Date.now()+60000,email:b.requestedBy});return json({ticket});}
  if(action==='enroll'){const code=token();await this.ctx.storage.put('enroll:'+await digest(code),{name:String(b.name).slice(0,80),expires:Date.now()+600000});return json({code});}
  if(action==='rename'){const name=String(b.name||'').trim();if(!name||name.length>80)throw Error('Enter a valid PC name');return await this.locked(async()=>{const pc=await this.ctx.storage.get('pc:'+b.pcId);if(!pc||pc.revoked)throw Error('PC not found');await this.ctx.storage.put('pc:'+b.pcId,{...pc,name});await this.broadcast();return json({ok:true});});}
  if(action==='remove'){return await this.locked(async()=>{const run=await this.ctx.storage.get('run');if(run?.pcId===b.pcId&&!terminal(run))throw Error('Stop and confirm this PC’s workflow before removing it');if(!b.pcId)throw Error('Select a PC');await this.clearCheckpoint(b.pcId);await this.ctx.storage.delete('pc:'+b.pcId);await this.ctx.storage.delete('command:'+b.pcId);for(const ws of this.sockets('agent',b.pcId))ws.close(1008,'Removed');await this.broadcast();return json({ok:true});});}
  if(action==='revoke'){const pc=await this.ctx.storage.get('pc:'+b.pcId);if(pc){await this.ctx.storage.put('pc:'+b.pcId,{...pc,revoked:true});for(const s of this.sockets('agent',b.pcId))s.close(1008,'Revoked');}return json({ok:true});}
  if(action==='schedule'){if(b.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time))throw Error('Invalid time');await this.ctx.storage.put('schedule',{time:b.time||null,account:b.account});await this.nextAlarm();return json({ok:true});}
  if(action==='run'){const run=await this.start(b);await this.broadcast();return json(run);}
  if(action==='stop'){const run=await this.ctx.storage.get('run');if(!terminal(run)){await this.ctx.storage.put('run',{...run,status:'stopping'});this.send('agent',run.pcId,{type:'command',action:'stop',runId:run.id});}return json({ok:true});}
  if(action==='resolve'){const run=await this.ctx.storage.get('run');if(!b.confirmStopped)throw Error('Confirm workflow is stopped');if(run)await this.ctx.storage.put('run',{...run,status:'stopped',checkpoint:true});await this.broadcast();return json({ok:true});}
  if(action==='make-ready')return await this.locked(async()=>{
   if(!b.confirmCloseApps)throw Error('Confirm that unsaved SAP and Excel work may be lost');
   if(!terminal(await this.ctx.storage.get('run')))throw Error('Stop the active bot run before preparing a PC');
   const pc=await this.ctx.storage.get('pc:'+b.pcId);
   if(!pc||pc.revoked||!this.sockets('agent',b.pcId).length||Date.now()-pc.seen>30000)throw Error('Select an online PC');
   if(!pc.makeReady)throw Error('Update agent.py on this PC and restart its agent first');
   if(await this.ctx.storage.get('command:'+b.pcId))throw Error('Wait for pending maintenance');
   const command={type:'command',action,id:crypto.randomUUID(),expiresAt:Date.now()+15000};
   await this.ctx.storage.put('command:'+b.pcId,command);
   await this.ctx.storage.put('pc:'+b.pcId,{...pc,ready:false,reason:'Preparing system'});
   this.send('agent',b.pcId,command);
   await this.broadcast();
   return json({ok:true});
  });
  if(['setup','clear','accounts'].includes(action)){
   if(!terminal(await this.ctx.storage.get('run')))throw Error('Stop automation before maintenance');
   const current=await this.ctx.storage.get('run');if(action==='clear'&&b.runId&&(current?.id!==b.runId||current?.pcId!==b.pcId))throw Error('The workflow changed. Refresh before clearing its checkpoint');
   const pcs=[...(await this.ctx.storage.list({prefix:'pc:'})).values()].filter(p=>!p.revoked&&p.id===b.pcId);if(!pcs.length)throw Error('Select a PC');
   if(action==='accounts'&&pcs.some(p=>!b.envelopes?.[p.id]))throw Error('Encrypt updates for the selected PC');
   for(const pc of pcs){const pending=await this.ctx.storage.get('command:'+pc.id);if(pending){if(action==='clear'&&pending.action==='clear')return json({ok:true});throw Error('Wait for the pending maintenance action to finish');}const cmd={type:'command',action,id:crypto.randomUUID(),envelope:b.envelopes?.[pc.id],version:b.version};await this.ctx.storage.put('command:'+pc.id,cmd);if(action==='clear')await this.ctx.storage.put('pc:'+pc.id,{...pc,checkpointClearing:true});this.send('agent',pc.id,cmd);}await this.broadcast();return json({ok:true});
  }throw Error('Unknown action');
 }catch(e){return json({error:e.message},409)}}
 async clearCheckpoint(pcId){const run=await this.ctx.storage.get('run');if(run?.pcId===pcId&&terminal(run)&&run.checkpoint){const next={...run,checkpoint:false};await this.ctx.storage.put('run',next);if(run.createdAt)await this.ctx.storage.put('history:'+run.createdAt,next);}}
 async start(b){return this.locked(async()=>{const previous=await this.ctx.storage.get('request:'+b.id);if(previous)return previous;const state=await this.state();const pending=await this.ctx.storage.list({prefix:'command:'});const machines=state.machines.map(p=>({...p,ready:p.ready&&p.connected&&!p.revoked&&!pending.has('command:'+p.id)}));const run=reserve({run:state.run},b,machines);await this.ctx.storage.put('run',run);await this.ctx.storage.put('request:'+run.id,run);this.send('agent',run.pcId,{type:'command',action:'run',run});return run;});}
 async connect(request,url){
  if(request.headers.get('Upgrade')!=='websocket')return json({error:'WebSocket required'},400);let a;
  if(url.searchParams.has('ticket')){const key='ticket:'+await digest(url.searchParams.get('ticket'));a=await this.ctx.storage.get(key);await this.ctx.storage.delete(key);if(!a||a.expires<Date.now())return json({error:'Ticket expired'},403);a={role:'browser',id:crypto.randomUUID(),email:a.email,expires:Date.now()+300000};}
  else{const id=url.searchParams.get('id'),p=await this.ctx.storage.get('pc:'+id);if(!p||p.revoked||await digest((request.headers.get('Authorization')||'').replace(/^Bearer /,''))!==p.secret)return json({error:'Invalid device'},403);a={role:'agent',id};for(const s of this.sockets('agent',id))s.close(1000,'Replaced');}
  const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1]);pair[1].serializeAttachment(a);return new Response(null,{status:101,webSocket:pair[0]});
 }
 async webSocketMessage(ws,raw){try{
  if(typeof raw!=='string'||raw.length>400000)throw Error('Message too large');const m=JSON.parse(raw),a=ws.deserializeAttachment();
  if(a.role==='browser'){
   if(a.expires<Date.now()){ws.close(1008,'Renew authorization');return;}
   if(m.type==='state'){ws.send(JSON.stringify({type:'state',...await this.state()}));return;}
   if(m.type==='read'){if(!['log','manifest','chunk'].includes(m.kind))throw Error('Invalid read');if(!this.sockets('agent',m.pcId).length){ws.send(JSON.stringify({type:'readResult',requestId:m.requestId,pcId:m.pcId,error:'This run’s PC is offline. Reconnect it to view its logs or outputs.'}));return;}this.send('agent',m.pcId,{type:'read',client:a.id,requestId:String(m.requestId).slice(0,80),kind:m.kind,runId:m.runId,file:m.file,offset:m.offset});return;}throw Error('Invalid message');
  }
  const pc=await this.ctx.storage.get('pc:'+a.id);if(!pc||pc.revoked){ws.close(1008,'Revoked');return;}
  if(m.type==='localRequest'){
   try{if(m.action==='stop'){const run=await this.ctx.storage.get('run');if(run?.pcId===a.id&&!terminal(run)){await this.ctx.storage.put('run',{...run,status:'stopping'});this.send('agent',a.id,{type:'command',action:'stop',runId:run.id});}}else await this.start({...m,pcId:a.id,requestedBy:'local:'+a.id});ws.send(JSON.stringify({type:'localReply',id:m.id}));await this.broadcast();}catch(e){ws.send(JSON.stringify({type:'localReply',id:m.id,error:e.message}));}return;
  }
  if(m.type==='heartbeat'){const d=m.data||{};await this.ctx.storage.put('pc:'+a.id,{...pc,seen:Date.now(),makeReady:!!d.makeReady,ready:!!d.ready,reason:String(d.reason||''),accounts:d.accounts||[],accountSlots:d.accountSlots||[],version:d.version,checkpoint:!!d.checkpoint,accountVersion:d.accountVersion,files:d.files||[]});if(d.checkpoint===false)await this.clearCheckpoint(a.id);const run=await this.ctx.storage.get('run');if(run?.pcId===a.id&&!terminal(run))this.send('agent',a.id,{type:'command',action:run.status==='stopping'?'stop':'run',run,runId:run.id});const cmd=await this.ctx.storage.get('command:'+a.id);if(cmd)this.send('agent',a.id,cmd);await this.broadcast();return;}
  if(m.type==='ack'){const cmd=await this.ctx.storage.get('command:'+a.id);if(cmd?.id===m.id){if(cmd.action==='clear'){await this.clearCheckpoint(a.id);await this.ctx.storage.put('pc:'+a.id,{...pc,checkpoint:false,checkpointClearing:false});}await this.ctx.storage.delete('command:'+a.id);await this.broadcast();}return;}
  if(m.type==='status'){const run=await this.ctx.storage.get('run');if(run?.id!==m.runId||run.pcId!==a.id)return;if(!['running','completed','failed','stopped'].includes(m.status))throw Error('Invalid status');const next={...run,status:m.status,checkpoint:!!m.checkpoint,updatedAt:Date.now(),stage:m.stage||0,error:String(m.error||'').slice(0,500)};await this.ctx.storage.put('run',next);if(terminal(next)){await this.ctx.storage.put('history:'+next.createdAt,next);await this.ctx.storage.put('pc:'+a.id,{...pc,lastRun:Date.now()});}await this.broadcast();return;}
  if(m.type==='readResult')this.send('browser',m.client,{...m,pcId:a.id});
 }catch(e){ws.send(JSON.stringify({type:'error',error:e.message}));}}
 webSocketClose(ws,code){try{ws.close(code===1006?1000:code)}catch{}}
 webSocketError(ws){try{ws.close(1011)}catch{}}
 async nextAlarm(){const s=await this.ctx.storage.get('schedule');if(!s?.time){await this.ctx.storage.deleteAlarm();return;}const [h,m]=s.time.split(':').map(Number),now=Date.now(),day=Math.floor((now+19800000)/86400000);let target=day*86400000+h*3600000+m*60000-19800000;if(target<=now)target+=86400000;await this.ctx.storage.setAlarm(target);}
 async alarm(){const now=Date.now(),s=await this.ctx.storage.get('schedule');try{await this.start({id:'scheduled-'+Math.floor((now+19800000)/86400000),scope:'all',account:s.account,years:[new Date(now+19800000).getUTCFullYear()],requestedBy:'schedule'});}catch(e){await this.ctx.storage.put('history:'+now,{id:crypto.randomUUID(),createdAt:now,status:'missed',error:e.message});}for(const [k,v] of await this.ctx.storage.list({prefix:'history:'}))if(v.createdAt<now-604800000)await this.ctx.storage.delete(k);await this.nextAlarm();}
}
