import test from 'node:test';
import assert from 'node:assert/strict';
import {outputGroups} from '../automation-outputs.js';
test('primary workbooks come first and batch plan heads supporting files',()=>{
 const names=['workflow.log','NoPlan.xlsx','EBTP-20.11.2026.xlsx','SAP SO Batch Plan.xlsx','BTPExcel.xlsx','Auto BTR.xlsx'];
 const groups=outputGroups(names.map(name=>({name})));
 assert.deepEqual(groups[0].files.map(f=>f.name),['Auto BTR.xlsx','BTPExcel.xlsx','EBTP-20.11.2026.xlsx']);
 assert.deepEqual(groups[1].files.map(f=>f.name),['SAP SO Batch Plan.xlsx','NoPlan.xlsx','workflow.log']);
 assert.deepEqual(outputGroups([]),[]);
 assert.equal(outputGroups([{name:'workflow.log'}])[0].title,'Supporting files');
});
