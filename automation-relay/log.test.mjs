import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanAutomationLog} from '../automation-log.js';
test('removes terminal colors while preserving timestamps and message order',()=>{
 assert.equal(cleanAutomationLog('\x1b[90m[13:11:57] \x1b[0m\x1b[37mStarting\x1b[0m\r\n\x1b[36;1mPHASE 1: Orders\x1b[0m'),'[13:11:57] Starting\nPHASE 1: Orders');
});
test('removes terminal links and controls without treating output as HTML',()=>{
 assert.equal(cleanAutomationLog('\x1b]8;;https://example.com\x07report\x1b]8;;\x07\x1b[2K\x00 <script>text</script>'),'report <script>text</script>');
});

import {logEntries,workflowStepState} from '../automation-log.js';
test('presentation removes banners and preserves top-to-bottom messages',()=>{const text='+=======+\n| SAP reporting automation suite |\n[13:01:01] PHASE 1: Read orders\n[13:01:02] ERROR: SAP unavailable';assert.deepEqual(logEntries(text).map(x=>x.message),['PHASE 1: Read orders','ERROR: SAP unavailable']);assert.equal(logEntries(text,true).length,4)});
test('completed scope ticks final step without marking unrelated scopes done',()=>{assert.equal(workflowStepState(17,18,'completed','all').done,true);assert.equal(workflowStepState(17,0,'completed','ebtp').done,true);assert.equal(workflowStepState(9,0,'completed','ebtp').skipped,true);assert.equal(workflowStepState(17,18,'running','all').active,true);assert.equal(workflowStepState(17,18,'failed','all').done,false)});

import {batchProgress} from '../automation-log.js';
test('reads planned and resumed BTP batch counts',()=>{assert.deepEqual(batchProgress('AUTO-PLANNED BATCHES: 12 balanced batches'),{total:12,current:0});assert.deepEqual(batchProgress('--- Batch 7/12 : SOs 1801-2100 ---'),{total:12,current:7});assert.deepEqual(batchProgress(''),{total:0,current:0})});
