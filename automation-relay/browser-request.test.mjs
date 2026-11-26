import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {workflowOutcome,isCleanupFailure,cleanAutomationLog} from '../automation-log.js';
import {statusLabel} from '../automation-status.js';
const source=readFileSync(new URL('../auto-btp.js',import.meta.url),'utf8');
const submit=source.slice(source.indexOf('async function submitRun('),source.indexOf('async function launch('));
function setup(live=true){
 const messages=[],calls=[],notices=[],context={state:{liveRunRequests:live,run:null},launchPending:false,pending:new Map(),setTimeout,clearTimeout,Error,JSON,
  notice:m=>notices.push(m),renderAvailability(){},finished:r=>!r||r.status==='stopped',render(s){context.state=s},
  api:async r=>{calls.push(r);return {...r,status:'reserved'}},socket:{readyState:1,send:m=>messages.push(JSON.parse(m))}};
 vm.createContext(context);vm.runInContext(submit,context);return {context,messages,calls,notices};
}
test('resume shows immediate feedback and prevents repeated clicks while awaiting acknowledgement',async()=>{
 const f=setup(),r={id:'resume-1',resume:true};const pending=f.context.submitRun(r);
 assert.match(f.notices[0],/Sending resume/);assert.equal(f.context.launchPending,true);
 await f.context.submitRun({id:'duplicate'});assert.equal(f.messages.length,1);
 f.context.pending.get(r.id).resolve({...r,status:'reserved'});await pending;
 assert.equal(f.calls.length,0);assert.equal(f.context.state.run.id,r.id);assert.equal(f.context.launchPending,false);
});
test('live transport interruption falls back with the same run ID; server rejection does not retry',async()=>{
 for(const commandRejected of [false,true]){
  const f=setup(),r={id:'stable-id'};const promise=f.context.submitRun(r);
  f.context.pending.get(r.id).reject(Object.assign(Error('interrupted'),{commandRejected}));
  if(commandRejected){await assert.rejects(promise);assert.equal(f.calls.length,0)}
  else{await promise;assert.equal(f.calls[0].id,r.id)}
 }
});
test('older relay uses HTTP directly without waiting for unsupported live commands',async()=>{
 const f=setup(false);await f.context.submitRun({id:'legacy'});assert.equal(f.messages.length,0);assert.equal(f.calls.length,1);
});
test('refresh status survives intervening live updates and clears on completion',()=>{
 const nodes=new Map(),context={state:{machines:[]},selected:null,workflowOutcome,verifiedManifests:new Map(),refreshingPC:true,launchPending:false,acknowledgedFailure:null,noticeUntil:0,Date,
  $:s=>{if(!nodes.has(s))nodes.set(s,{value:'',dataset:{}});return nodes.get(s)},
  selectedHostAvailability:()=>({label:'Ready',tone:'success',canRun:true,message:'Ready PC'}),finished:()=>true};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function renderAvailability('),source.indexOf('let stateLoaded=')),context);
 context.renderAvailability();context.renderAvailability();assert.equal(nodes.get('#status').textContent,'Refreshing');
 context.refreshingPC=false;context.renderAvailability();assert.equal(nodes.get('#status').textContent,'Ready');
});
test('legacy cleanup failure is presented as completed only after the host confirms outputs and the success log',async()=>{
 const run={id:'r',scope:'all',status:'failed',error:'Process cleanup failed: AccessDenied: (pid=28040)'};
 const manifest={run:{id:'r',scope:'all'},status:'failed',files:[{name:'NoPlan.xlsx'},{name:'EBTP-25.11.2026.xlsx'}]};
 let painted=0,availability=0;
 const history={options:[{value:'r',textContent:'Current: Failed'}]};
 const context={workflowOutcome,isCleanupFailure,cleanAutomationLog,statusLabel,selected:run,lastStages:new Map(),paintWorkflow(){painted++},renderAvailability(){availability++},$:()=>history,read:async kind=>kind==='manifest'?manifest:'All selected steps are finished successfully.'};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const verifiedManifests='),source.indexOf('function render(data)')),context);
 await context.verifyFailedOutcome(run);
 assert.equal(vm.runInContext('workflowOutcome(selected,verifiedManifests.get(selected.id))',context),'completed');
 assert.equal(history.options[0].textContent,'Current: Completed');
 assert.equal(painted,1);assert.equal(availability,1);
});
test('false failed current run is shown completed after the success banner and expected outputs are verified',async()=>{
 const run={id:'r',scope:'all',status:'failed',error:'Workflow did not confirm successful completion'};
 const manifest={run:{id:'r',scope:'all'},status:'failed',files:[{name:'Auto BTR.xlsx'},{name:'BTPExcel.xlsx'},{name:'NoPlan.xlsx'},{name:'EBTP-26.11.2026.xlsx'}]};
 const history={options:[{value:'r',textContent:'Current: Failed'}]};let painted=0,availability=0;
 const context={workflowOutcome,isCleanupFailure,cleanAutomationLog,statusLabel,selected:run,lastStages:new Map(),paintWorkflow(){painted++},renderAvailability(){availability++},$:()=>history,read:async kind=>kind==='manifest'?manifest:'[09:53:48] ALL STEPS COMPLETED SUCCESSFULLY!'};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const verifiedManifests='),source.indexOf('function render(data)')),context);
 await context.verifyFailedOutcome(run);
 assert.equal(vm.runInContext('workflowOutcome(selected,verifiedManifests.get(selected.id))',context),'completed');
 assert.equal(history.options[0].textContent,'Current: Completed');
 assert.equal(painted,1);assert.equal(availability,1);
});
