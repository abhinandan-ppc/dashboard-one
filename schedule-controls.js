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
      const header=document.createElement('div'); header.className='schedule-editor-header';
      const heading=document.createElement('h3'); heading.textContent=`Schedule ${index+1}`;
      const remove=button('Remove schedule',()=>{draft.splice(index,1);draw()});remove.className='schedule-remove';header.append(heading,remove);
      const settings=document.createElement('div'); settings.className='schedule-settings';
      const label=document.createElement('label'); label.className='schedule-time'; label.textContent='Time (India)';
      const time=document.createElement('input'); time.type='time'; time.value=s.time; time.onchange=()=>{s.time=time.value}; label.append(time);
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
  $('saveSchedules').onclick=async()=>{const btn=$('saveSchedules');btn.disabled=true;try{if(draft.some(s=>!s.time||!s.pcs.length))throw Error('Choose a time and at least one PC for each schedule.');await save(draft);dialog.close()}catch(e){$('scheduleFeedback').textContent=e.message}finally{btn.disabled=false}};
  return {render};
}
