import test from 'node:test';import assert from 'node:assert/strict';import {Pool} from './worker.mjs';
function fixture(){const data=new Map(),sockets=[];let tail=Promise.resolve();const storage={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),delete:async k=>data.delete(k),list:async({prefix='',reverse=false,limit=1000}={})=>new Map([...data].filter(([k])=>k.startsWith(prefix)).sort(([a],[b])=>reverse?b.localeCompare(a):a.localeCompare(b)).slice(0,limit)),setAlarm:async()=>{},deleteAlarm:async()=>{}};const ctx={storage,getWebSockets:()=>sockets,blockConcurrencyWhile:fn=>{const p=tail.then(fn);tail=p.catch(()=>{});return p}};const pool=new Pool(ctx,{RELAY_SECRET:'test'});const socket=(role,id)=>{const s={messages:[],deserializeAttachment:()=>({role,id,expires:Date.now()+60000}),send:raw=>s.messages.push(JSON.parse(raw)),close:()=>{}};sockets.push(s);return s};return {pool,data,storage,socket};}
const req=id=>({id,scope:'all',account:'test',years:[2026]});

test('live resume targets original PC and HTTP retry does not dispatch twice',async()=>{
 const f=fixture();await f.storage.put('pc:p',{id:'p',ready:true,seen:Date.now(),accounts:['test'],lastRun:0});
 const host=f.socket('agent','p'),viewer=f.socket('browser','viewer');
 viewer.deserializeAttachment=()=>({role:'browser',id:'viewer',email:'signed-in@example.invalid',expires:Date.now()+60000});
 await f.storage.put('run',{...req('old'),pcId:'p',status:'stopped',checkpoint:true});
 const request={...req('resumed'),resume:true,pcId:'wrong',requestedBy:'spoofed'};
 await f.pool.webSocketMessage(viewer,JSON.stringify({type:'runRequest',requestId:'resumed',run:request}));
 const result=viewer.messages.find(m=>m.type==='runResult');
 assert.equal(result.data.pcId,'p');assert.equal(result.data.requestedBy,'signed-in@example.invalid');
 assert.equal(host.messages.length,1);assert.equal((await f.pool.state()).liveRunRequests,true);
 await f.pool.fetch(control({action:'run',...request}));assert.equal(host.messages.length,1);
});
test('live run rejection is correlated and expired browser cannot launch',async()=>{
 const f=fixture(),viewer=f.socket('browser','viewer');
 await f.pool.webSocketMessage(viewer,JSON.stringify({type:'runRequest',requestId:'r',run:req('r')}));
 assert.equal(viewer.messages[0].requestId,'r');assert.match(viewer.messages[0].error,/No compatible/);
 viewer.deserializeAttachment=()=>({role:'browser',expires:0});let closed=false;viewer.close=()=>{closed=true};
 await f.pool.webSocketMessage(viewer,JSON.stringify({type:'runRequest',requestId:'r',run:req('r')}));
 assert.equal(closed,true);assert.equal(f.data.has('run'),false);
});
test('simultaneous starts reserve one PC only',async()=>{const f=fixture();await f.storage.put('pc:p',{id:'p',ready:true,seen:Date.now(),accounts:['test'],lastRun:0});const s=f.socket('agent','p');const results=await Promise.allSettled([f.pool.start(req('one')),f.pool.start(req('two'))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(s.messages.length,1)});
test('completed request cannot replay after another run',async()=>{const f=fixture();await f.storage.put('pc:p',{id:'p',ready:true,seen:Date.now(),accounts:['test'],lastRun:0});const s=f.socket('agent','p');await f.pool.start(req('one'));await f.pool.webSocketMessage(s,JSON.stringify({type:'status',runId:'one',status:'completed'}));await f.pool.start(req('two'));const count=s.messages.length;await f.pool.start(req('one'));assert.equal(s.messages.length,count);assert.equal(f.data.get('run').id,'two')});
test('pending credential update excludes PC',async()=>{const f=fixture();await f.storage.put('pc:p',{id:'p',ready:true,seen:Date.now(),accounts:['test'],lastRun:0});f.socket('agent','p');await f.storage.put('command:p',{action:'accounts'});await assert.rejects(f.pool.start(req('one')),/No compatible/)});
test('unauthenticated API denied',async()=>{const {pool}=fixture();assert.equal((await pool.fetch(new Request('https://relay/control'))).status,401)});
test('terminal message from wrong PC cannot release reservation',async()=>{const f=fixture();await f.storage.put('run',{id:'one',pcId:'p',status:'running'});await f.storage.put('pc:other',{id:'other'});await f.pool.webSocketMessage(f.socket('agent','other'),JSON.stringify({type:'status',runId:'one',status:'completed'}));assert.equal(f.data.get('run').status,'running')});

test('local launch stays on its host and broadcasts lifecycle to online viewers',async()=>{
 const f=fixture();for(const id of ['local','other'])await f.storage.put('pc:'+id,{id,ready:true,seen:Date.now(),accounts:['test'],lastRun:0});
 const host=f.socket('agent','local');f.socket('agent','other');const viewer=f.socket('browser','viewer');
 await f.pool.webSocketMessage(host,JSON.stringify({type:'localRequest',action:'run',...req('local-run')}));
 assert.equal(f.data.get('run').pcId,'local');assert.equal(f.data.get('run').requestedBy,'local:local');
 assert.ok(viewer.messages.some(m=>m.type==='state'&&m.run?.status==='reserved'));
 for(const status of ['running','completed']){await f.pool.webSocketMessage(host,JSON.stringify({type:'status',runId:'local-run',status}));assert.ok(viewer.messages.some(m=>m.type==='state'&&m.run?.status===status))}
 assert.ok([...f.data.keys()].some(k=>k.startsWith('history:')));
});
test('account maintenance targets only the selected PC',async()=>{const f=fixture();for(const id of ['one','two'])await f.storage.put('pc:'+id,{id});const one=f.socket('agent','one'),two=f.socket('agent','two');const response=await f.pool.fetch(new Request('https://relay/control',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({action:'accounts',pcId:'one',version:'v2',envelopes:{one:{data:'encrypted'}}})}));assert.equal(response.status,200);assert.equal(one.messages.length,1);assert.equal(two.messages.length,0);assert.ok(f.data.has('command:one'));assert.equal(f.data.has('command:two'),false)});
test('account maintenance without a selected PC is rejected',async()=>{const f=fixture();await f.storage.put('pc:one',{id:'one'});const response=await f.pool.fetch(new Request('https://relay/control',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({action:'accounts',envelopes:{one:{}}})}));assert.equal(response.status,409);assert.equal(f.data.has('command:one'),false)});
test('clearing checkpoints updates current run and history only after matching acknowledgement',async()=>{const f=fixture();await f.storage.put('pc:p',{id:'p',checkpoint:true});await f.storage.put('run',{id:'old',pcId:'p',status:'failed',checkpoint:true,createdAt:10});await f.storage.put('command:p',{id:'clear-1',action:'clear'});const host=f.socket('agent','p');await f.pool.webSocketMessage(host,JSON.stringify({type:'ack',id:'wrong'}));assert.equal(f.data.get('run').checkpoint,true);await f.pool.webSocketMessage(host,JSON.stringify({type:'ack',id:'clear-1'}));assert.equal(f.data.get('run').checkpoint,false);assert.equal(f.data.get('history:10').checkpoint,false);assert.equal(f.data.get('pc:p').checkpoint,false);assert.equal(f.data.has('command:p'),false)});
test('heartbeat reconciles removed checkpoints but never changes active or other host runs',async()=>{for(const [pcId,status,expected] of [['p','failed',false],['other','failed',true],['p','running',true]]){const f=fixture();await f.storage.put('pc:p',{id:'p'});await f.storage.put('run',{id:'old',pcId,status,checkpoint:true});await f.pool.webSocketMessage(f.socket('agent','p'),JSON.stringify({type:'heartbeat',data:{checkpoint:false}}));assert.equal(f.data.get('run').checkpoint,expected)}});
test('offline read returns correlated result instead of global error',async()=>{const f=fixture(),viewer=f.socket('browser','v');await f.pool.webSocketMessage(viewer,JSON.stringify({type:'read',kind:'log',pcId:'offline',requestId:'read-1'}));assert.equal(viewer.messages[0].type,'readResult');assert.equal(viewer.messages[0].requestId,'read-1');assert.match(viewer.messages[0].error,/offline/)});
const control=(body)=>new Request('https://relay/control',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)});
test('prepare host requires warning confirmation and an updated idle host',async()=>{
 const f=fixture();await f.storage.put('pc:p',{id:'p',makeReady:true,seen:Date.now(),ready:true});const host=f.socket('agent','p');
 assert.equal((await f.pool.fetch(control({action:'make-ready',pcId:'p'}))).status,409);
 await f.storage.put('run',{pcId:'p',status:'running'});
 assert.equal((await f.pool.fetch(control({action:'make-ready',pcId:'p',confirmCloseApps:true}))).status,409);
 await f.storage.delete('run');
 assert.equal((await f.pool.fetch(control({action:'make-ready',pcId:'p',confirmCloseApps:true}))).status,200);
 assert.equal(host.messages[0].action,'make-ready');assert.ok(host.messages[0].expiresAt>Date.now());
 assert.equal(f.data.get('pc:p').ready,false);assert.ok(f.data.has('command:p'));
});
test('prepare another PC preserves the active run and sends cleanup only to the selected host',async()=>{
 const f=fixture();const run={id:'active',pcId:'bot',status:'running'};
 await f.storage.put('run',run);await f.storage.put('pc:idle',{id:'idle',makeReady:true,seen:Date.now(),ready:false});
 const bot=f.socket('agent','bot'),idle=f.socket('agent','idle');
 const result=await f.pool.fetch(control({action:'make-ready',pcId:'idle',confirmCloseApps:true}));
 assert.equal(result.status,200);assert.deepEqual(f.data.get('run'),run);
 assert.equal(bot.messages.length,0);assert.equal(idle.messages.length,1);assert.equal(idle.messages[0].action,'make-ready');
 assert.ok(f.data.has('command:idle'));assert.equal(f.data.has('command:bot'),false);
});
test('remove deletes enrollment and pending work and clears terminal continuation',async()=>{const f=fixture();await f.storage.put('pc:p',{id:'p'});await f.storage.put('command:p',{id:'old'});await f.storage.put('run',{id:'old',pcId:'p',status:'failed',checkpoint:true});const response=await f.pool.fetch(control({action:'remove',pcId:'p'}));assert.equal(response.status,200);assert.equal(f.data.has('pc:p'),false);assert.equal(f.data.has('command:p'),false);assert.equal(f.data.get('run').checkpoint,false)});
test('remove rejects an active execution host',async()=>{const f=fixture();await f.storage.put('pc:p',{id:'p'});await f.storage.put('run',{pcId:'p',status:'running'});assert.equal((await f.pool.fetch(control({action:'remove',pcId:'p'}))).status,409);assert.equal(f.data.has('pc:p'),true)});
test('banner clear targets original run and exposes pending confirmation',async()=>{const f=fixture();await f.storage.put('pc:p',{id:'p'});await f.storage.put('run',{id:'old',pcId:'p',status:'failed',checkpoint:true});assert.equal((await f.pool.fetch(control({action:'clear',pcId:'p',runId:'other'}))).status,409);assert.equal((await f.pool.fetch(control({action:'clear',pcId:'p',runId:'old'}))).status,200);assert.equal(f.data.get('pc:p').checkpointClearing,true);assert.equal(f.data.get('run').checkpoint,true)});

test('expected start rejection does not escape the concurrency callback or reset relay',async()=>{const f=fixture();let reset=false;const original=f.pool.ctx.blockConcurrencyWhile;f.pool.ctx.blockConcurrencyWhile=fn=>original(async()=>{try{return await fn()}catch(e){reset=true;throw e}});const r=await f.pool.fetch(control({action:'run',...req('no-host')}));assert.equal(r.status,409);assert.match((await r.json()).error,/No compatible/);assert.equal(reset,false);assert.equal(f.data.has('run'),false)});
test('new host may run its installed scripts without matching an unrelated PC hash',async()=>{const f=fixture();for(const [id,version] of [['old','older-scripts'],['new','updated-scripts']]){await f.storage.put('pc:'+id,{id,version,ready:true,seen:Date.now(),accounts:['test'],lastRun:0});f.socket('agent',id)}const run=await f.pool.start({...req('new-host-run'),pcId:'new'});assert.equal(run.pcId,'new')});

test('scheduled failure waits five minutes and restarts fresh three times before the next PC',async()=>{
 const f=fixture();for(const id of ['one','two']){await f.storage.put('pc:'+id,{id,ready:true,seen:Date.now(),accounts:['11103144'],lastRun:0});f.socket('agent',id)}
 await f.storage.put('schedules',[{id:'s',time:'08:00',enabled:true,pcs:['one','two'],nextAt:Date.now()-1}]);
 await f.pool.alarm();let run=f.data.get('run');assert.equal(run.pcId,'one');assert.equal(run.abandon,true);
 for(let n=0;n<4;n++){
  const previous=run.id;await f.pool.webSocketMessage(f.pool.sockets('agent','one')[0],JSON.stringify({type:'status',runId:run.id,status:'failed',checkpoint:n%2===0,error:'SAP login failed'}));
  await f.pool.alarm();assert.equal(f.data.get('run').id,previous);const job=f.data.get('scheduledJob');assert.ok(job.retryAt>=Date.now()+299000);
  await f.pool.alarm();assert.equal(f.data.get('run').id,previous,'no retry before five minutes');
  await f.storage.put('scheduledJob',{...job,retryAt:Date.now()-1});
  for(const id of ['one','two'])await f.storage.put('pc:'+id,{...f.data.get('pc:'+id),seen:Date.now(),ready:true});
  await f.pool.alarm();run=f.data.get('run');assert.equal(run.pcId,n<3?'one':'two');assert.equal(run.resume,false);assert.equal(run.abandon,true);
 }
});
test('an active manual run causes a missed schedule without stopping it',async()=>{
 const f=fixture(),run={id:'manual',pcId:'p',status:'running'};await f.storage.put('run',run);
 await f.storage.put('schedules',[{id:'s',time:'08:00',enabled:true,pcs:['p'],nextAt:Date.now()-1}]);await f.pool.alarm();
 assert.deepEqual(f.data.get('run'),run);assert.ok([...f.data.values()].some(v=>v?.status==='missed'));
});
test('a manual run started while a scheduled retry waits is never replaced',async()=>{
 const f=fixture();await f.storage.put('pc:p',{id:'p',ready:true,seen:Date.now(),accounts:['11103144'],lastRun:0});const host=f.socket('agent','p');
 await f.storage.put('schedules',[{id:'s',time:'08:00',enabled:true,pcs:['p'],nextAt:Date.now()-1}]);await f.pool.alarm();
 const scheduled=f.data.get('run');await f.pool.webSocketMessage(host,JSON.stringify({type:'status',runId:scheduled.id,status:'failed'}));await f.pool.alarm();
 const manual={id:'manual',pcId:'p',status:'running'};await f.storage.put('run',manual);await f.pool.alarm();
 assert.deepEqual(f.data.get('run'),manual);assert.equal(f.data.has('scheduledJob'),false);assert.ok([...f.data.values()].some(v=>v?.status==='missed'));
});
test('an online unready PC gets three delayed retry opportunities before the next host',async()=>{
 const f=fixture();for(const id of ['one','two']){await f.storage.put('pc:'+id,{id,ready:true,seen:Date.now(),accounts:['11103144'],lastRun:0});f.socket('agent',id)}
 await f.storage.put('schedules',[{id:'s',time:'08:00',enabled:true,pcs:['one','two'],nextAt:Date.now()-1}]);await f.pool.alarm();const run=f.data.get('run');
 await f.pool.webSocketMessage(f.pool.sockets('agent','one')[0],JSON.stringify({type:'status',runId:run.id,status:'failed',error:'SAP login failed'}));await f.pool.alarm();
 for(let n=0;n<3;n++){const job=f.data.get('scheduledJob');await f.storage.put('scheduledJob',{...job,retryAt:Date.now()-1});await f.storage.put('pc:one',{...f.data.get('pc:one'),ready:false,seen:Date.now()});await f.storage.put('pc:two',{...f.data.get('pc:two'),ready:true,seen:Date.now()});await f.pool.alarm();assert.equal(f.data.get('run').id,run.id);}
 const job=f.data.get('scheduledJob');assert.equal(job.index,1);await f.storage.put('scheduledJob',{...job,retryAt:Date.now()-1});await f.storage.put('pc:two',{...f.data.get('pc:two'),seen:Date.now()});await f.pool.alarm();assert.equal(f.data.get('run').pcId,'two');
});
test('disconnected scheduled PC times out after five minutes and next PC starts fresh',async()=>{
 const f=fixture();for(const id of ['one','two']){await f.storage.put('pc:'+id,{id,ready:true,seen:Date.now(),accounts:['11103144'],lastRun:0});f.socket('agent',id)}
 await f.storage.put('schedules',[{id:'s',time:'08:00',enabled:true,pcs:['one','two'],nextAt:Date.now()-1}]);await f.pool.alarm();
 const old=f.data.get('run');await f.storage.put('pc:one',{...f.data.get('pc:one'),seen:Date.now()-300001});await f.pool.alarm();
 assert.equal(f.data.get('run').pcId,'two');assert.equal(f.data.get('run').abandon,true);assert.match(f.data.get('history:'+old.createdAt).error,/may still be running/);
});
test('schedule settings validate PCs and create independent India-time alarms',async()=>{
 const f=fixture();await f.storage.put('pc:p',{id:'p'});
 const schedules=[{id:'a',time:'08:00',enabled:true,pcs:['p']},{id:'b',time:'15:00',enabled:false,pcs:['p']}];
 assert.equal((await f.pool.fetch(control({action:'schedules',schedules}))).status,200);
 assert.equal(f.data.get('schedules').length,2);assert.ok(f.data.get('schedules')[0].nextAt>Date.now());
 assert.equal((await f.pool.fetch(control({action:'schedules',schedules:[{...schedules[0],pcs:['missing']}]}))).status,409);
 assert.equal(f.data.get('schedules').length,2);
});
test('schedule records a miss when no listed PC can run',async()=>{
 const f=fixture();await f.storage.put('pc:p',{id:'p',ready:false,seen:Date.now(),accounts:['11103144']});f.socket('agent','p');
 await f.storage.put('schedules',[{id:'s',time:'08:00',enabled:true,pcs:['p'],nextAt:Date.now()-1}]);await f.pool.alarm();
 assert.equal(f.data.get('run'),undefined);assert.ok([...f.data.values()].some(v=>v?.status==='missed'));
});
