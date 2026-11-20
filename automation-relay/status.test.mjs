import test from 'node:test';import assert from 'node:assert/strict';import {availability,hostStatus,selectedHostAvailability} from '../automation-status.js';
test('unavailable PC uses Not ready while retaining its reason',()=>{const s=availability({machines:[{name:'Host',connected:true,seen:100,ready:false,reason:'Close SAP and Excel'}]},100);assert.equal(s.label,'Not ready');assert.match(s.message,/Close SAP and Excel/);assert.equal(s.canRun,false)});
test('selected PC status is independent of another hosts active run',()=>{
 const state={machines:[{id:'bot',name:'Bot',connected:true,seen:100,ready:false},{id:'office',name:'Office',connected:true,seen:100,ready:false,reason:'Excel is open'}],run:{pcId:'bot',status:'running'}};
 const office=selectedHostAvailability(state,'office',100);
 assert.equal(office.label,'Not ready');assert.equal(office.message,'Office: Excel is open');assert.equal(office.canRun,false);
 assert.equal(selectedHostAvailability(state,'bot',100).label,'Running');
 state.machines[1].ready=true;
 assert.equal(selectedHostAvailability(state,'office',100).label,'Ready');
 assert.equal(selectedHostAvailability(state,'office',100).canRun,false);
 assert.equal(selectedHostAvailability(state,'office',40000).label,'Offline');
 assert.equal(availability(state,100).label,'Running');
});
test('ready requires fresh heartbeat',()=>{const s={machines:[{name:'Host',connected:true,seen:100,ready:true}]};assert.equal(availability(s,100).canRun,true);assert.equal(availability(s,40000).label,'Offline')});
test('active and disconnected execution hosts use the allowed status labels',()=>{assert.equal(hostStatus({id:'p',connected:true,seen:100,ready:true},{pcId:'p',status:'reserved'},100),'Running');assert.equal(availability({machines:[],run:{status:'running',pcId:'x'}}).label,'Offline')});
