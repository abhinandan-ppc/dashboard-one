import test from 'node:test';
import assert from 'node:assert/strict';
import '../rake-planning-rules.js';

const rules=globalThis.RakePlanningRules;

test('actualSiding parses underscore-separated rake modes',()=>{
  assert.equal(rules.actualSiding('RAKE_BNHT'),'BNHT');
  assert.equal(rules.sidingKey(rules.actualSiding('RAKE_BNHT_LONG')),'BNHT(LONG)');
});

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

test('predicted backup orders match siding and wagon type',()=>{
  const order=(UID,SO,Siding,Mode,WagonType)=>({UID,'SO No.':SO,_LineItem:'10',_Siding:Siding,_ModeC:Mode,_WagonType:WagonType});
  const predictedPlans={
    BNHT:{siding:'BNHT',rakes:[{items:[
      {ord:order('actual-bnht','100','BNHT','RAKE-BNHT','BOSM/BRN')},
      {ord:order('backup-bnht','101','BNHT','HOLD','BOSM')},
      {ord:order('backup-bnht-brn','104','BNHT','HOLD','BRN')},
      {ord:order('wrong-siding','102','CCJS','HOLD','BRN')},
      {ord:order('wrong-wagon-bnht','105','BNHT','HOLD','LONG')},
      {ord:order('bnht-long-mode-brn-type','106','BNHT','RAKE-BNHT(Long)','BRN')},
      {ord:order('duplicate-bnht','103','BNHT','HOLD','BRN')},
    ]},{items:[
      {ord:order('duplicate-bnht','103','BNHT','HOLD','BRN')},
    ]}]},
    'BNHT (Long)':{siding:'BNHT (Long)',rakes:[{items:[
      {ord:order('actual-bnht-long','110','BNHT (Long)','RAKE-BNHT-LONG','LONG')},
      {ord:order('backup-bnht-long','111','BNHT (Long)','HOLD','LONG')},
      {ord:order('wrong-wagon-bnht-long','112','BNHT (Long)','HOLD','BRN')},
      {ord:order('wrong-siding-bnht-long','113','BNHT','HOLD','LONG')},
    ]}]},
    'KAV (Long)':{siding:'KAV (Long)',rakes:[{items:[
      {ord:order('actual-kav','200','KAV (Long)','RAKE-KAV (LONG)','LONG')},
      {ord:order('backup-kav','201','KAV (Long)','HOLD','LONG')},
      {ord:order('wrong-wagon-kav','203','KAV (Long)','HOLD','BRN')},
      {ord:order('wrong-kav','202','KAV','HOLD','LONG')},
    ]}]},
  };
  const actualBnht={siding:'BNHT',items:[{ord:order('actual-bnht','100','BNHT','RAKE-BNHT','BOSM/BRN')}]};
  const actualBnhtLong={siding:'BNHT- LONG',items:[{ord:order('actual-bnht-long','110','BNHT (Long)','RAKE-BNHT-LONG','LONG')}]};
  const actualKav={siding:'KAV(LONG)',items:[{ord:order('actual-kav','200','KAV (Long)','RAKE-KAV (LONG)','LONG')}]};

  assert.deepEqual(
    rules.predictedOrdersMissingFromActual(predictedPlans,actualBnht).map(row=>row.UID),
    ['backup-bnht','backup-bnht-brn','bnht-long-mode-brn-type','duplicate-bnht'],
  );
  assert.deepEqual(
    rules.predictedOrdersMissingFromActual(predictedPlans,actualBnhtLong).map(row=>row.UID),
    ['backup-bnht-long'],
  );
  assert.deepEqual(
    rules.predictedOrdersMissingFromActual(predictedPlans,actualKav).map(row=>row.UID),
    ['backup-kav'],
  );
});

test('HTC labels use the backup-order category labels',()=>{
  assert.deepEqual(
    ['FN','Q','Q/T','NON HTC'].map(value=>rules.htcLabel(value)),
    ['FN','Q','Q&T','Non HTC'],
  );
});
