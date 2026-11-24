export function setupScheduleControls({getState, save}) {
  const $ = id => document.getElementById(id);
  let draft = [];
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
      const heading=document.createElement('h3'); heading.textContent=`Schedule ${index+1}`;
      const label=document.createElement('label'); label.textContent='Time (India) ';
      const time=document.createElement('input'); time.type='time'; time.value=s.time; time.onchange=()=>{s.time=time.value}; label.append(time);
      const enabled=document.createElement('label'); const check=document.createElement('input'); check.type='checkbox'; check.checked=s.enabled; check.onchange=()=>{s.enabled=check.checked}; enabled.append(check,document.createTextNode(' Enabled'));
      section.append(heading,label,enabled,button('Remove schedule',()=>{draft.splice(index,1);draw()}));
      const help=document.createElement('p'); help.textContent='Selected PCs, in order:'; section.append(help);
      for (const [i,id] of s.pcs.entries()) {
        const pc=machines.find(p=>p.id===id), row=document.createElement('div'); row.className='schedule-pc-row';
        const name=document.createElement('span'); name.textContent=`${i+1}. ${pc?.name||'Removed PC'}`;
        row.append(name,button('Up',()=>{[s.pcs[i-1],s.pcs[i]]=[s.pcs[i],s.pcs[i-1]];draw()},i===0),button('Down',()=>{[s.pcs[i+1],s.pcs[i]]=[s.pcs[i],s.pcs[i+1]];draw()},i===s.pcs.length-1),button('Remove',()=>{s.pcs.splice(i,1);draw()})); section.append(row);
      }
      const available=machines.filter(p=>!s.pcs.includes(p.id));
      const select=document.createElement('select'); select.setAttribute('aria-label','Add PC to schedule');
      for(const pc of available) select.add(new Option(pc.name,pc.id));
      section.append(select,button('Add PC',()=>{if(select.value){s.pcs.push(select.value);draw()}},!available.length));
      list.append(section);
    }
    if (!draft.length) list.textContent='Add a schedule to begin.';
  }
  $('editSchedules').onclick=()=>{const state=getState();draft=structuredClone(state.schedules||[]);if(!draft.length&&state.legacySchedule?.time)draft.push({id:crypto.randomUUID(),time:state.legacySchedule.time,enabled:true,pcs:[]});$('scheduleFeedback').textContent='';draw();dialog.showModal()};
  $('closeSchedules').onclick=()=>dialog.close();
  $('addSchedule').onclick=()=>{draft.push({id:crypto.randomUUID(),time:'08:00',enabled:true,pcs:[]});draw()};
  $('saveSchedules').onclick=async()=>{const btn=$('saveSchedules');btn.disabled=true;try{if(draft.some(s=>!s.time||!s.pcs.length))throw Error('Choose a time and at least one PC for each schedule.');await save(draft);dialog.close()}catch(e){$('scheduleFeedback').textContent=e.message}finally{btn.disabled=false}};
  return {render};
}
