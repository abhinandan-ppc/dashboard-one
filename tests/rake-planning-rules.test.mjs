import test from 'node:test';
import assert from 'node:assert/strict';
import '../rake-planning-rules.js';

const rules=globalThis.RakePlanningRules;

test('simulatorCandidates excludes the selected rake and keeps domestic peer-rake orders',()=>{
  const rows=[
    {'SO No.':'100','_LineItem':'10','_ModeC':'RAKE-CCJS','Bal to PGI':'25',_Country:'India'},
    {'SO No.':'101','_LineItem':'20','_ModeC':'RAKE-BNHT','Bal to PGI':'50',_Country:'India'},
    {'SO No.':'102','_LineItem':'30','_ModeC':'HOLD','Bal to PGI':'15',_Country:'India'},
    {'SO No.':'103','_LineItem':'40','_ModeC':'RAKE-KAV','Bal to PGI':'40',_Country:'United States'},
    {'SO No.':'104','_LineItem':'50','_ModeC':'RAKE-KAV','Bal to PGI':'35',_Country:'India'},
    {'SO No.':'105','_LineItem':'60','_ModeC':'RAKE-CCJS','Bal to PGI':'0',_Country:'India'},
  ];

  assert.deepEqual(
    rules.simulatorCandidates(rows,'CCJS',['BNHT','KAV']).map(row=>row['SO No.']),
    ['101','104'],
  );
  assert.deepEqual(
    rules.simulatorCandidates(rows,'ALL').map(row=>row['SO No.']),
    ['100','101','102','104'],
  );
});

test('simulatorCandidates separates all rake assignments from all non-export orders',()=>{
  const rows=[
    {'SO No.':'100','_LineItem':'10','_ModeC':'RAKE-CCJS','Bal to PGI':'25',_Country:'India'},
    {'SO No.':'101','_LineItem':'20','_ModeC':'RAKE-OTHER','Bal to PGI':'50',_Country:'India'},
    {'SO No.':'102','_LineItem':'30','_ModeC':'ROAD','Bal to PGI':'15',_Country:'India'},
    {'SO No.':'103','_LineItem':'40','_ModeC':'HOLD','Bal to PGI':'10',_Country:'India'},
    {'SO No.':'104','_LineItem':'50','_ModeC':'RAKE-CCJS','Bal to PGI':'35',_Country:'Germany','Customer TYPE':'EXPORT'},
    {'SO No.':'105','_LineItem':'60','_ModeC':'HOLD','Bal to PGI':'10',_Country:'India',_ExportGroup:'EURO',_Region:'Export'},
    {'SO No.':'106','_LineItem':'70','_ModeC':'HOLD','Bal to PGI':'10',_Country:'india',_ExportGroup:'Domestic'},
  ];

  assert.deepEqual(
    rules.simulatorCandidates(rows,'ALL_RAKES').map(row=>row['SO No.']),
    ['100','101','104'],
  );
  assert.deepEqual(
    rules.simulatorCandidates(rows,'ALL').map(row=>row['SO No.']),
    ['100','101','102','103','106'],
  );
});

test('simulatorCandidates deduplicates available rows by SO and line item',()=>{
  const rows=[
    {UID:'row-1','SO No.':'100','_LineItem':'10','_ModeC':'HOLD','Bal to PGI':'25'},
    {UID:'row-2','SO No.':'100','_LineItem':'10','_ModeC':'HOLD','Bal to PGI':'20'},
    {'SO No.':'100','_LineItem':'20','_ModeC':'HOLD','Bal to PGI':'10'},
  ];

  assert.deepEqual(
    rules.simulatorCandidates(rows,'ALL').map(row=>row._LineItem),
    ['10','20'],
  );
});

test('simulatorCandidates distinguishes BNHT from BNHT Long assignments',()=>{
  const rows=[
    {'SO No.':'100','_LineItem':'10','_ModeC':'RAKE-BNHT','Bal to PGI':'25',_Country:'India'},
    {'SO No.':'101','_LineItem':'20','_ModeC':'RAKE-BNHT (Long)','Bal to PGI':'30',_Country:'India'},
  ];

  assert.deepEqual(
    rules.simulatorCandidates(rows,'BNHT (Long)',['BNHT']).map(row=>row['SO No.']),
    ['100'],
  );
  assert.deepEqual(
    rules.simulatorCandidates(rows,'BNHT',['BNHT (Long)']).map(row=>row['SO No.']),
    ['101'],
  );
});
