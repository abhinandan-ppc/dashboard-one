/* One page-level mapping queue. Views subscribe; opening them does no work. */
globalThis.RakeDestinationMapping=(()=>{
  const DAY=86400000,STATE_KEY='rake-mapping-state-v1',LIMIT=5000;
  const key=parts=>parts.map(v=>String(v||'').trim().replace(/\s+/g,' ').toUpperCase()).join('|');
  const valid=r=>r&&Number.isFinite(r.lat)&&Number.isFinite(r.lng)&&Math.abs(r.lat)<=90&&Math.abs(r.lng)<=180;
  function create({cache={},storage,fetch:request=globalThis.fetch.bind(globalThis),endpoint='/api/rake-geocode',now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),locks}={}){
    const listeners=new Set();let places=[],running=null,entries={},lastAutoCheck=0,outcomeKnown=false;
    let state={busy:false,phase:'idle',done:0,total:0,mapped:0,review:0,revision:0,status:'Cached destinations · checked daily',provider:'photon',providers:['photon'],lastChecked:0};
    const emit=patch=>{
      state={...state,...patch};
      const allCached=places.length>0&&places.every(p=>valid(entries[key([p.city,p.state,p.country])]));
      state={...state,result:state.busy?null:allCached?'success':state.phase==='quota'?'quota':state.phase==='error'||state.review>0?'warning':null};
      listeners.forEach(fn=>fn());
    };
    const restore=()=>{
      try{const saved=JSON.parse(storage?.getItem(STATE_KEY)||'{}');lastAutoCheck=Number(saved.lastAutoCheck)||lastAutoCheck;entries={...entries,...saved.entries};state={...state,lastChecked:Number(saved.lastChecked)||state.lastChecked};if(saved.outcome&&now()-lastAutoCheck<DAY){outcomeKnown=true;if(state.phase==='idle')state={...state,...saved.outcome};}}catch{}
      for(const[k,v]of Object.entries(entries))if(valid(v))cache[k]=v;
    };
    Object.assign(entries,cache);restore();
    const persist=()=>{try{storage?.setItem(STATE_KEY,JSON.stringify({entries:Object.fromEntries(Object.entries(entries).slice(-LIMIT)),lastAutoCheck,lastChecked:state.lastChecked,outcome:['complete','error','quota'].includes(state.phase)?{phase:state.phase,status:state.status,review:state.review}:undefined}));}catch{}};
    const json=async(url,options)=>{
      const r=await request(url,{...options,signal:AbortSignal.timeout(90000)});
      if(!r.headers.get('content-type')?.includes('json'))throw new Error('Sign in to map destinations');
      const body=await r.json();if(!r.ok)throw Object.assign(new Error(body.error||'Mapping unavailable'),{code:body.code||(/quota|(?:daily|monthly|credit|allowance).*(?:limit|exhaust)|reached their limits/i.test(body.error||'')?'quota_exceeded':undefined)});return body;
    };
    async function perform(manual){
      restore();
      const dailySkip=!manual&&lastAutoCheck&&now()-lastAutoCheck<DAY;
      if(dailySkip&&outcomeKnown)return;
      // Record the attempt before network access, including failures. A failed
      // check must not create an automatic retry loop on refresh or popup open.
      lastAutoCheck=now();persist();
      emit({busy:true,phase:'cache',done:0,total:0,mapped:0,review:0,status:'Checking shared destination cache…'});
      try{
        const shared=await json(endpoint+'?cache=1');
        for(const[k,v]of Object.entries(shared.entries||{})){
          const id=key(k.split('|'));entries[id]=v;if(valid(v))cache[id]=v;
        }
        const used=Object.values(entries).map(v=>({'Photon':'photon','Geoapify':'geoapify','Maps.co':'mapsco'}[v.source?.split(' / ')[0]])).filter(Boolean);
        emit({revision:state.revision+1,provider:shared.provider||'photon',providers:[...new Set([...(shared.providers||[shared.provider||'photon']),...used])]});persist();
        if(!shared.ready)throw new Error('Online mapping unavailable; using cached locations');
        // Automatic passes only map never-checked destinations. An explicit
        // manual run may retry a negative result after its server cooldown.
        const unique=[...new Map(places.map(p=>[key([p.city,p.state,p.country]),p])).entries()];
        const pending=unique.filter(([k])=>!valid(entries[k])&&(!entries[k]||(manual&&entries[k].retryAt<=now())));
        if(dailySkip){const review=unique.filter(([k])=>!valid(entries[k])).length;emit({phase:review&&shared.quotaExceeded?'quota':'complete',review,status:review&&shared.quotaExceeded?'Mapping allowance exhausted; cached destinations remain available':review?review+' destinations need review':'Destinations are up to date'});return;}
        emit({phase:'mapping',total:pending.length,status:pending.length?`Mapping 0 / ${pending.length} destinations`:'Destinations are up to date'});
        for(const[k,place]of pending){
          const result=await json(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(place)});
          if(!valid(result)&&!result.error)throw new Error('Mapping returned an invalid location');
          entries[k]=result;
          if(valid(result))cache[k]=result;
          emit({done:state.done+1,mapped:state.mapped+(valid(result)?1:0),review:state.review+(valid(result)?0:1),revision:state.revision+1,status:`Mapping ${state.done+1} / ${pending.length} destinations`});
          persist();
          if(state.done<pending.length&&result.waitMs)await sleep(Math.min(5000,Math.max(2000,result.waitMs)));
        }
        const review=unique.filter(([k])=>!valid(entries[k])).length;
        emit({lastChecked:now(),phase:review&&shared.quotaExceeded?'quota':'complete',review,status:review&&shared.quotaExceeded?'Mapping allowance exhausted; cached destinations remain available':pending.length?`${state.mapped} locations cached${review?` · ${review} need review`:''}`:review?`${unique.length-review} locations cached · ${review} need review`:'Destinations are up to date'});persist();
      }catch(e){emit({phase:e.code==='quota_exceeded'?'quota':'error',status:`${e.message}. Offline mapping remains active.`});}
      finally{outcomeKnown=true;emit({busy:false});persist();}
    }
    function run({manual=false}={}){
      if(running)return running;
      if(!places.length)return Promise.resolve();
      // Web Locks also coordinates multiple tabs on this origin. The server's
      // conditional reservation remains authoritative across users/devices.
      running=Promise.resolve().then(()=>locks?.request
        ?locks.request('rake-destination-mapping',{ifAvailable:true},lock=>lock?perform(manual):emit({status:'Mapping is running in another tab'}))
        :perform(manual)).catch(()=>emit({busy:false,phase:'error',status:'Mapping could not start. Offline mapping remains active.'})).finally(()=>{running=null;});
      return running;
    }
    return{
      getSnapshot:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
      setPlaces:next=>{places=next.filter(p=>p.city&&p.country);restore();emit({review:places.filter(p=>{const entry=entries[key([p.city,p.state,p.country])];return entry&&!valid(entry);}).length});},run,
      refresh:()=>{restore();emit({revision:state.revision+1});},
    };
  }
  return{create,key,DAY,STATE_KEY};
})();
