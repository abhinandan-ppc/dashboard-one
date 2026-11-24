export function setupScheduleControls({getState, save}) {
  const $ = id => document.getElementById(id);
  let draft = [];
  const timeEdits = new WeakMap();
  const dialog = $('scheduleDialog'), list = $('scheduleList');
  const button = (text, action, disabled = false) => {
    const el = document.createElement('button'); el.type='button'; el.textContent=text; el.disabled=disabled; el.onclick=action; return el;
  };
  function render() {
    const state=getState(), root=$('scheduleSummary');
    root.replaceChildren();
    for (const s of state.schedules || []) {
      const line=document.createElement('p');
      line.textContent=`${s.time} IST · ${s.enabled?'Enabled':'Paused'} · ${s.pcs.map(id=>state.machines.find(p=>p.id===id)?.name||'Removed PC').join(' → ')}`;
      root.append(line);
    }
    if (!root.children.length) root.textContent=state.legacySchedule?.time?`Existing schedule: ${state.legacySchedule.time} IST. Open settings to choose its PC order.`:'No schedules configured.';
  }
  function draw() {
    list.replaceChildren();
    const machines=getState().machines.filter(p=>!p.revoked);
    for (const [index,s] of draft.entries()) {
      const section=document.createElement('section'); section.className='schedule-editor';
      const header=document.createElement('div'); header.className='schedule-editor-header';
      const heading=document.createElement('h3'); heading.textContent=`Schedule ${index+1}`;
      const remove=button('Remove schedule',()=>{draft.splice(index,1);draw()});remove.className='schedule-remove';header.append(heading,remove);
      const settings=document.createElement('div'); settings.className='schedule-settings';
      const label=document.createElement('div'); label.className='schedule-time';
      const caption=document.createElement('span');caption.className='schedule-time-label';caption.textContent='Time (India)';
      const time=document.createElement('div');time.className='schedule-time-controls';time.setAttribute('role','group');time.setAttribute('aria-label',`Schedule ${index+1} time in India`);
      const parts=/^(\d{2}):(\d{2})$/.exec(s.time||'');const initialHour=parts?Number(parts[1]):8;
      const savedEdit=timeEdits.get(s);let period=savedEdit?.period||(initialHour>=12?'PM':'AM');
      const hour=document.createElement('input');hour.type='number';hour.min='1';hour.max='12';hour.inputMode='numeric';hour.value=savedEdit?savedEdit.hour:String(initialHour%12||12).padStart(2,'0');hour.setAttribute('aria-label','Hour');
      const separator=document.createElement('span');separator.className='schedule-time-separator';separator.setAttribute('aria-hidden','true');separator.textContent=':';
      const minute=document.createElement('input');minute.type='number';minute.min='0';minute.max='59';minute.inputMode='numeric';minute.value=savedEdit?savedEdit.minute:(parts?parts[2]:'00');minute.setAttribute('aria-label','Minute');
      const periodGroup=document.createElement('div');periodGroup.className='schedule-period';periodGroup.setAttribute('role','group');periodGroup.setAttribute('aria-label','AM or PM');
      const am=button('AM',()=>setPeriod('AM')),pm=button('PM',()=>setPeriod('PM'));
      function updateTime(){timeEdits.set(s,{hour:hour.value,minute:minute.value,period});const h=Number(hour.value),m=Number(minute.value);if(hour.value===''||minute.value===''||!Number.isInteger(h)||!Number.isInteger(m)||h<1||h>12||m<0||m>59){s.time='';return}s.time=String((h%12)+(period==='PM'?12:0)).padStart(2,'0')+':'+String(m).padStart(2,'0')}
      function setPeriod(value){period=value;am.setAttribute('aria-pressed',String(value==='AM'));pm.setAttribute('aria-pressed',String(value==='PM'));updateTime()}
      hour.oninput=minute.oninput=updateTime;
      hour.onblur=()=>{if(hour.value!==''&&Number(hour.value)>=1&&Number(hour.value)<=12)hour.value=String(Number(hour.value)).padStart(2,'0')};
      minute.onblur=()=>{if(minute.value!==''&&Number(minute.value)>=0&&Number(minute.value)<=59)minute.value=String(Number(minute.value)).padStart(2,'0')};
      periodGroup.append(am,pm);setPeriod(period);time.append(hour,separator,minute,periodGroup);label.append(caption,time);
      const enabled=document.createElement('label'); enabled.className='schedule-enabled'; const check=document.createElement('input'); check.type='checkbox'; check.checked=s.enabled; check.onchange=()=>{s.enabled=check.checked}; enabled.append(check,document.createTextNode('Enabled'));
      settings.append(label,enabled);section.append(header,settings);
      const help=document.createElement('p'); help.className='schedule-pc-label'; help.textContent='PC priority'; section.append(help);
      if(!s.pcs.length){const empty=document.createElement('p');empty.className='schedule-pc-empty';empty.textContent='No PCs added yet. Add a PC to set the run order.';section.append(empty)}
      for (const [i,id] of s.pcs.entries()) {
        const pc=machines.find(p=>p.id===id), row=document.createElement('div'); row.className='schedule-pc-row';
        const name=document.createElement('span'); name.textContent=`${i+1}. ${pc?.name||'Removed PC'}`;
        const actions=document.createElement('div'); actions.className='schedule-pc-actions';
        const up=button('Up',()=>{[s.pcs[i-1],s.pcs[i]]=[s.pcs[i],s.pcs[i-1]];draw()},i===0),down=button('Down',()=>{[s.pcs[i+1],s.pcs[i]]=[s.pcs[i],s.pcs[i+1]];draw()},i===s.pcs.length-1),removePC=button('Remove',()=>{s.pcs.splice(i,1);draw()});
        up.setAttribute('aria-label',`Move ${pc?.name||'PC'} up`);down.setAttribute('aria-label',`Move ${pc?.name||'PC'} down`);removePC.setAttribute('aria-label',`Remove ${pc?.name||'PC'}`);
        actions.append(up,down,removePC);row.append(name,actions); section.append(row);
      }
      const available=machines.filter(p=>!s.pcs.includes(p.id));
      const select=document.createElement('select'); select.setAttribute('aria-label','Add PC to schedule');
      for(const pc of available) select.add(new Option(pc.name,pc.id));
      if(!available.length){select.add(new Option('No more PCs available',''));select.disabled=true}
      const addRow=document.createElement('div');addRow.className='schedule-add-pc';addRow.append(select,button('Add PC',()=>{if(select.value){s.pcs.push(select.value);draw()}},!available.length));section.append(addRow);
      list.append(section);
    }
    if (!draft.length){const empty=document.createElement('div');empty.className='schedule-empty';const title=document.createElement('strong');title.textContent='No schedules yet';const description=document.createElement('p');description.textContent='Add a schedule to choose a time and prioritize your PCs.';empty.append(title,description);list.append(empty)}
  }
  $('editSchedules').onclick=()=>{const state=getState();draft=structuredClone(state.schedules||[]);if(!draft.length&&state.legacySchedule?.time)draft.push({id:crypto.randomUUID(),time:state.legacySchedule.time,enabled:true,pcs:[]});$('scheduleFeedback').textContent='';draw();dialog.showModal()};
  $('closeSchedules').onclick=()=>dialog.close();
  $('addSchedule').onclick=()=>{draft.push({id:crypto.randomUUID(),time:'08:00',enabled:true,pcs:[]});draw()};
  $('saveSchedules').onclick=async()=>{const btn=$('saveSchedules');btn.disabled=true;try{if(draft.some(s=>!s.time||!s.pcs.length))throw Error('Enter a valid time and choose at least one PC for each schedule.');await save(draft);dialog.close()}catch(e){$('scheduleFeedback').textContent=e.message}finally{btn.disabled=false}};
  return {render};
}
