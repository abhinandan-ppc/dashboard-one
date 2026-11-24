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
});

test('simulatorCandidates for all rakes returns only plain road orders (no ODC, no export)',()=>{
  const rows=[
    {'SO No.':'100','_LineItem':'10','_ModeC':'RAKE-CCJS','Bal to PGI':'25',_Country:'India'},
    {'SO No.':'101','_LineItem':'20','_ModeC':'ROAD','Bal to PGI':'50',_Country:'India'},
    {'SO No.':'102','_LineItem':'30','_ModeC':'ROAD-ODC','_ODC':'ROAD-ODC','Bal to PGI':'15',_Country:'India'},
    {'SO No.':'103','_LineItem':'40','_ModeC':'HOLD','Bal to PGI':'10',_Country:'India'},
    {'SO No.':'104','_LineItem':'50','_ModeC':'EXPORT ROAD','Bal to PGI':'35',_Country:'Germany'},
    {'SO No.':'105','_LineItem':'60','_ModeC':'ROAD','Bal to PGI':'0',_Country:'India'},
    {'SO No.':'106','_LineItem':'70','_ModeC':'ROAD','_ODC':'ROAD-ODC','Bal to PGI':'20',_Country:'India'},
    {'SO No.':'101','_LineItem':'20','_ModeC':'ROAD','Bal to PGI':'5',_Country:'India'},
  ];

  assert.deepEqual(
    rules.simulatorCandidates(rows,'ALL_RAKES').map(row=>row['SO No.']),
    ['101'],
  );
});

test('simulatorCandidates excludes road_odc wagon type for individual rakes',()=>{
  const rows=[
    {'SO No.':'100','_LineItem':'10','_ModeC':'RAKE-CCJS','_WagonType':'BOSM/BRN','Bal to PGI':'25',_Country:'India'},
    {'SO No.':'101','_LineItem':'20','_ModeC':'RAKE-BNHT','_WagonType':'ROAD-ODC','Bal to PGI':'50',_Country:'India'},
    {'SO No.':'103','_LineItem':'40','_ModeC':'RAKE-KAV','_WagonType':'BOSM/BRN','Bal to PGI':'40',_Country:'India'},
  ];

  assert.deepEqual(
    rules.simulatorCandidates(rows,'CCJS',['BNHT','KAV']).map(row=>row['SO No.']),
    ['103'],
  );
});

test('simulatorCandidates long mode shows only LONG wagon type',()=>{
  const rows=[
    {'SO No.':'100','_LineItem':'10','_ModeC':'RAKE-BNHT','_WagonType':'BOSM/BRN','Bal to PGI':'25',_Country:'India'},
    {'SO No.':'101','_LineItem':'20','_ModeC':'RAKE-BNHT','_WagonType':'LONG','Bal to PGI':'50',_Country:'India'},
    {'SO No.':'102','_LineItem':'30','_ModeC':'RAKE-KAV','_WagonType':'LONG','Bal to PGI':'15',_Country:'India'},
  ];

  // Selecting BNHT-LONG with peer BNHT: only LONG wagon type from BNHT (101), BOSM/BRN (100) excluded, KAV (102) not a peer
  assert.deepEqual(
    rules.simulatorCandidates(rows,'BNHT (Long)',['BNHT']).map(row=>row['SO No.']),
    ['101'],
  );
});

test('simulatorCandidates non-long mode excludes LONG wagon type',()=>{
  const rows=[
    {'SO No.':'100','_LineItem':'10','_ModeC':'RAKE-KAV','_WagonType':'BOSM/BRN','Bal to PGI':'25',_Country:'India'},
    {'SO No.':'101','_LineItem':'20','_ModeC':'RAKE-KAV','_WagonType':'LONG','Bal to PGI':'50',_Country:'India'},
    {'SO No.':'102','_LineItem':'30','_ModeC':'RAKE-BNHT','_WagonType':'BOSM/BRN','Bal to PGI':'15',_Country:'India'},
    {'SO No.':'103','_LineItem':'40','_ModeC':'RAKE-BNHT','_WagonType':'LONG','Bal to PGI':'40',_Country:'India'},
  ];

  // Selecting KAV: row 100 is the selected mode itself (excluded), row 101 is LONG (excluded), row 102 is peer non-LONG (included), row 103 is LONG (excluded)
  assert.deepEqual(
    rules.simulatorCandidates(rows,'KAV',['BNHT']).map(row=>row['SO No.']),
    ['102'],
  );
});

test('simulatorCandidates distinguishes BNHT from BNHT Long assignments',()=>{
  const rows=[
    {'SO No.':'100','_LineItem':'10','_ModeC':'RAKE-BNHT','_WagonType':'BOSM/BRN','Bal to PGI':'25',_Country:'India'},
    {'SO No.':'101','_LineItem':'20','_ModeC':'RAKE-BNHT','_WagonType':'LONG','Bal to PGI':'30',_Country:'India'},
    {'SO No.':'102','_LineItem':'30','_ModeC':'RAKE-KAV','_WagonType':'BOSM/BRN','Bal to PGI':'40',_Country:'India'},
    {'SO No.':'103','_LineItem':'40','_ModeC':'RAKE-KAV','_WagonType':'LONG','Bal to PGI':'50',_Country:'India'},
  ];

  // BNHT-Long scope with peer BNHT: only LONG wagon type from BNHT (101), BOSM/BRN (100) excluded, KAV rows not peers
  assert.deepEqual(
    rules.simulatorCandidates(rows,'BNHT (Long)',['BNHT']).map(row=>row['SO No.']),
    ['101'],
  );
  // BNHT scope with peer KAV: LONG wagon type excluded (103), KAV BOSM/BRN (102) included; BNHT rows are selected mode itself (excluded)
  assert.deepEqual(
    rules.simulatorCandidates(rows,'BNHT',['KAV']).map(row=>row['SO No.']),
    ['102'],
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

test('simulatorCandidates never includes HOLD (marketing) modes',()=>{
  const rows=[
    {'SO No.':'1','_LineItem':'10','_ModeC':'HOLD-MARKETING','Bal to PGI':'10',_Country:'India'},
    {'SO No.':'2','_LineItem':'10','_ModeC':'ROAD',MODE:'HOLD-MARKETING','Bal to PGI':'10',_Country:'India'},
    {'SO No.':'3','_LineItem':'10','_ModeC':'ROAD','Bal to PGI':'10',_Country:'India'},
  ];
  assert.deepEqual(rules.simulatorCandidates(rows,'ALL_RAKES').map(row=>row['SO No.']),['3']);
});
