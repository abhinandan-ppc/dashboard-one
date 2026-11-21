/* Shared, side-effect-free planning rules. Quantities are MT; dimensions mm/m. */
globalThis.RakePlanningRules=(()=>{
  const clean=v=>String(v??'').trim().replace(/\s+/g,' ');
  const key=v=>clean(v).toUpperCase();
  const qty=v=>Math.max(0,Number(v)||0);
  const orderKey=r=>clean(r.UID)||`${clean(r['SO No.'])}|${clean(r._LineItem??r.SOItm)}`;
  const odc=r=>Number(r.Width)>3150||Number(r['Length Plan'])>14.2;
  function release(r){
    const s=key(r.Remarks).replace(/\s+/g,'');
    if(s==='CAPTIVE'||s==='SBURELEASED'||s==='FIRELEASED'||/^(FI\(2\)RELEASED|FIRELEASED\(2\))$/.test(s))return'Released';
    if(/^(FI\(1\)RELEASED|FIRELEASED\(1\)|WAITINGFORFIRELEASE|WAITINGFORFI|WAITINGFIREL\.)$/.test(s))return'Unreleased';
    return'Other / review';
  }
  function completion(r){
    const bal=qty(r['Bal to PGI']),fg=qty(r['FG UR Stock']),wip=Math.max(0,qty(r['Plate Stock'])-fg);
    const stages=[['FG',fg],['WIP',wip],['Slab',qty(r['Slab Stock'])],['Issued',qty(r.ISSUED)]];
    let remaining=bal;
    return {bal,stages:stages.map(([name,raw])=>{const value=Math.min(raw,remaining);remaining-=value;return{name,raw,value};}),uncovered:remaining};
  }
  const state=v=>({'CHATTISGARH':'Chhattisgarh','ORISSA':'Odisha','UTTARANCHAL':'Uttarakhand'}[key(v)]||clean(v));
  const europe='Albania|Andorra|Austria|Belarus|Belgium|Bosnia and Herzegovina|Bulgaria|Croatia|Czechia|Denmark|Estonia|Finland|France|Germany|Greece|Holy See|Hungary|Iceland|Ireland|Italy|Latvia|Liechtenstein|Lithuania|Luxembourg|Malta|Moldova|Monaco|Montenegro|Netherlands|North Macedonia|Norway|Poland|Portugal|Romania|Russia|San Marino|Serbia|Slovakia|Slovenia|Spain|Sweden|Switzerland|Ukraine|United Kingdom'.split('|');
  const middleEast='Bahrain|Cyprus|Egypt|Iran|Iraq|Israel|Jordan|Kuwait|Lebanon|Oman|Palestine|Qatar|Saudi Arabia|Syria|Türkiye|United Arab Emirates|Yemen'.split('|');
  const neighbours='Afghanistan|Bangladesh|Bhutan|China|Myanmar|Nepal|Pakistan'.split('|');
  const countryNames=new Map([...europe,...middleEast,...neighbours,'India','Canada','United States','Japan','South Korea','Brazil','Sri Lanka','Maldives'].map(c=>[key(c),c]));
  Object.entries({'TURKEY':'Türkiye','UAE':'United Arab Emirates','UK':'United Kingdom','USA':'United States','CZECH REPUBLIC':'Czechia','RUSSIAN FEDERATION':'Russia','REPUBLIC OF KOREA':'South Korea','VATICAN CITY':'Holy See'}).forEach(([a,c])=>countryNames.set(a,c));
  const countryGroup=c=>neighbours.includes(c)?'Export Road':europe.includes(c)?'EURO':middleEast.includes(c)?'Middle East':c;
  // Verified STO aliases in the current LIVE sheet. Unknown export destinations stay explicit.
  const destinations={
    'JURA':['Switzerland','EURO'],'NRTH RHINE WESTFALIA':['Germany','EURO'],'GERMANY':['Germany','EURO'],
    'CHESHIRE':['United Kingdom','EURO'],'LONDONDERRY':['United Kingdom','EURO'],'SOUTH DENMARK':['Denmark','EURO'],
    'PRAHA':['Czechia','EURO'],'HARJU':['Estonia','EURO'],'AUST-AGDER COUNTY':['Norway','EURO'],
    'OMAN':['Oman','Middle East'],'DUBAI':['United Arab Emirates','Middle East'],
    'ONTARIO':['Canada','Canada'],'ARIZONA':['United States','United States'],'TOKYO':['Japan','Japan'],
    'INCH´ON-JIKHALSI':['South Korea','South Korea'],'SOUL-T´UKPYOLSI':['South Korea','South Korea'],
    'SANTA CATARINA':['Brazil','Brazil'],'KATHMANDU':['Nepal','Export Road'],'SAMTSE':['Bhutan','Export Road']
  };
  function destination(r){
    const found=destinations[key(r.STO)];
    const country=countryNames.get(key(r['Ship To Party Country']||r.Country))||found?.[0]||countryNames.get(key(r.STO));
    if(country==='India'||!country&&key(r['Customer TYPE'])!=='EXPORT')return{country:'India',group:'Domestic',state:state(r.STO)};
    return{country:country||'',group:country?countryGroup(country):'Export — country unresolved',state:state(r.STO)};
  }
  const isExport=r=>key(r['Customer TYPE'])==='EXPORT'||!!r._Country&&r._Country!=='India';
  const city=v=>clean(v).replace(/[.,]+$/,'').trim();
  const mapCategory=r=>r._ODC||odc(r)?'odc':isExport(r)?'export':/ROAD/i.test(r._Siding||'')||/^ROAD/i.test(r._ModeC||'')?'road':'rail';
  function shortfall(balance,capacity=2850,tolerance=.03){
    const b=qty(balance),target=Math.max(1,Math.ceil(b/(capacity*(1+tolerance))))*capacity;
    return{target,minimum:target*(1-tolerance),maximum:target*(1+tolerance),missing:Math.max(0,target*(1-tolerance)-b)};
  }
  function nearby(rows,plan,{coords,hub,distance}){
    const assigned=new Set(plan.items.map(({ord})=>orderKey(ord)));
    const states=new Set(plan.items.map(({ord})=>key(state(ord._State))).filter(s=>s&&!['UNKNOWN','UNMAPPED','UNSPECIFIED','—','N/A'].includes(s)));
    if(hub?.state)states.add(key(state(hub.state)));
    const seen=new Set();
    return rows.filter(r=>{const id=orderKey(r);if(seen.has(id))return false;seen.add(id);return qty(r['Bal to PGI'])>0&&!assigned.has(id)&&!/^RAKE[-\s]|^ROAD/i.test(clean(r._ModeC))&&!odc(r)&&r._Region!=='Export'&&!/^ROAD|^Export Road/.test(r._Siding||'');}).map(ord=>{
      const c=coords(ord),km=c&&hub?distance(hub.lat,hub.lng,c[0],c[1]):null;
      return{ord,km,band:km!==null&&km<=100?0:states.has(key(state(ord._State)))?1:2,release:release(ord)};
    }).filter(r=>r.band<2).sort((a,b)=>a.band-b.band||(a.km??Infinity)-(b.km??Infinity)||orderKey(a.ord).localeCompare(orderKey(b.ord)));
  }
  return{clean,key,qty,orderKey,odc,release,completion,state,city,isExport,mapCategory,destination,countryGroup,shortfall,nearby};
})();
