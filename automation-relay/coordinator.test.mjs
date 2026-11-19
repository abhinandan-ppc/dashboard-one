import test from 'node:test';
import assert from 'node:assert/strict';
import {reserve} from './coordinator.mjs';
const now=100000;
const request={id:'run-1',scope:'all',account:'default',years:[2026]};
const pc={id:'pc-1',ready:true,seen:now,accounts:['default'],lastRun:0};
test('selects least recently used compatible PC',()=>assert.equal(reserve({},request,[{...pc,id:'pc-2',lastRun:10},pc],now).pcId,'pc-1'));
test('duplicate request returns reservation',()=>{const run=reserve({},request,[pc],now);assert.equal(reserve({run},request,[],now),run)});
test('disconnect does not release active reservation',()=>assert.throws(()=>reserve({run:{id:'other',status:'running'}},request,[],now),/reserved/));
test('stale or locked PC cannot accept work',()=>{assert.throws(()=>reserve({},request,[{...pc,seen:0}],now),/No compatible/);assert.throws(()=>reserve({},request,[{...pc,ready:false}],now),/No compatible/)});
test('checkpoint requires decision and original PC for resume',()=>{const state={run:{...request,id:'old',status:'stopped',checkpoint:true,pcId:'pc-2'}};assert.throws(()=>reserve(state,request,[pc],now),/Choose/);assert.throws(()=>reserve(state,{...request,resume:true},[pc],now),/No compatible/)});

test('resume restores original host scope user and years despite changed dropdowns',()=>{const original={...request,id:'old',pcId:'pc-1',status:'failed',checkpoint:true,scope:'btp',years:[2025]};const next=reserve({run:original},{id:'new',resume:true,pcId:'wrong',scope:'ebtp',account:'other',years:[2026]},[pc],now);assert.equal(next.pcId,'pc-1');assert.equal(next.scope,'btp');assert.equal(next.account,'default');assert.deepEqual(next.years,[2025]);assert.equal(next.resume,true)});
