import test from 'node:test';
import assert from 'node:assert/strict';
import '../rake-planning-rules.js';

const rules=globalThis.RakePlanningRules;

test('actualSiding parses underscore-separated rake modes',()=>{
  assert.equal(rules.actualSiding('RAKE_BNHT'),'BNHT');
  assert.equal(rules.sidingKey(rules.actualSiding('RAKE_BNHT_LONG')),'BNHT(LONG)');
});

test('simulatorCandidates for an individual rake returns only road orders',()=>{
  const rows=[
    {'SO No.':'100','_LineItem':'10','_ModeC':'RAKE-CCJS','Bal to PGI':'25',_Country:'India'},
    {'SO No.':'101','_LineItem':'20','_ModeC':'RAKE-BNHT','Bal to PGI':'50',_Country:'India'},
    {'SO No.':'102','_LineItem':'30','_ModeC':'ROAD','Bal to PGI':'15',_Country:'India'},
    {'SO No.':'103','_LineItem':'40','_ModeC':'ROAD','Bal to PGI':'40',_Country:'United States'},
    {'SO No.':'104','_LineItem':'50','_ModeC':'ROAD','_WagonType':'LONG','Bal to PGI':'35',_Country:'India'},
    {'SO No.':'105','_LineItem':'60','_ModeC':'ROAD','_WagonType':'ROAD-ODC','Bal to PGI':'20',_Country:'India'},
    {'SO No.':'106','_LineItem':'70','_ModeC':'ROAD','Bal to PGI':'0',_Country:'India'},
    {'SO No.':'107','_LineItem':'80','_ModeC':'HOLD-MARKETING','Bal to PGI':'10',_Country:'India'},
    {'SO No.':'108','_LineItem':'90','_ModeC':'ROAD','_WagonType':'BOSM/BRN','Bal to PGI':'12',_Country:'India'},
  ];

  assert.deepEqual(rules.simulatorCandidates(rows,'BNHT').map(row=>row['SO No.']),['102','108']);
  assert.deepEqual(rules.simulatorCandidates(rows,'CCJS').map(row=>row['SO No.']),['102','108']);
});

test('simulatorCandidates for a long rake returns only road orders with LONG wagon type',()=>{
  const rows=[
    {'SO No.':'100','_LineItem':'10','_ModeC':'ROAD','_WagonType':'LONG','Bal to PGI':'25',_Country:'India'},
    {'SO No.':'101','_LineItem':'20','_ModeC':'ROAD','_WagonType':'BOSM/BRN','Bal to PGI':'50',_Country:'India'},
    {'SO No.':'102','_LineItem':'30','_ModeC':'RAKE-KAV','_WagonType':'LONG','Bal to PGI':'15',_Country:'India'},
    {'SO No.':'103','_LineItem':'40','_ModeC':'ROAD','_WagonType':'ROAD-ODC','Bal to PGI':'15',_Country:'India'},
  ];
  assert.deepEqual(rules.simulatorCandidates(rows,'BNHT (Long)').map(row=>row['SO No.']),['100']);
});

test('simulatorCandidates never includes HOLD (marketing) modes',()=>{
  const rows=[
    {'SO No.':'1','_LineItem':'10','_ModeC':'HOLD-MARKETING','Bal to PGI':'10',_Country:'India'},
    {'SO No.':'2','_LineItem':'10','_ModeC':'ROAD',MODE:'HOLD-MARKETING','Bal to PGI':'10',_Country:'India'},
    {'SO No.':'3','_LineItem':'10','_ModeC':'ROAD','Bal to PGI':'10',_Country:'India'},
  ];
  assert.deepEqual(rules.simulatorCandidates(rows,'BNHT').map(row=>row['SO No.']),['3']);
});

test('simulatorCandidates deduplicates available rows by SO and line item',()=>{
  const rows=[
    {UID:'row-1','SO No.':'100','_LineItem':'10','_ModeC':'ROAD','Bal to PGI':'25',_Country:'India'},
    {UID:'row-2','SO No.':'100','_LineItem':'10','_ModeC':'ROAD','Bal to PGI':'20',_Country:'India'},
    {'SO No.':'100','_LineItem':'20','_ModeC':'ROAD','Bal to PGI':'10',_Country:'India'},
  ];
  assert.deepEqual(rules.simulatorCandidates(rows,'BNHT').map(row=>row._LineItem),['10','20']);
});

test('simulatorCandidates counts only mode = Road (any case) as road',()=>{
  const rows=[
    {'SO No.':'1','_LineItem':'1','_ModeC':'Road','Bal to PGI':'5',_Country:'India'},
    {'SO No.':'2','_LineItem':'1','_ModeC':' ROAD ','Bal to PGI':'5',_Country:'India'},
    {'SO No.':'3','_LineItem':'1','_ModeC':'TRUCK','Bal to PGI':'5',_Country:'India'},
    {'SO No.':'4','_LineItem':'1','_ModeC':'','Bal to PGI':'5',_Country:'India'},
    {'SO No.':'5','_LineItem':'1','_ModeC':'RAKE-KAV','Bal to PGI':'5',_Country:'India'},
  ];
  assert.deepEqual(rules.simulatorCandidates(rows,'BNHT').map(row=>row['SO No.']),['1','2']);
});
