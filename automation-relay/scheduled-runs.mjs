import {indiaYear, nextScheduledTime} from './schedule.mjs';
import {terminal} from './auth.mjs';

const ACCOUNT = '11103144';
const TIMEOUT = 300000;

export async function saveSchedules(pool, input) {
  if (!Array.isArray(input) || input.length > 30) throw Error('Invalid schedules');
  const machines = (await pool.state()).machines;
  const ids = new Set();
  const now = Date.now();
  const schedules = input.map(s => {
    if (!/^[\w-]{1,100}$/.test(s.id || '') || ids.has(s.id)) throw Error('Invalid schedule ID');
    ids.add(s.id);
    if (!Array.isArray(s.pcs) || !s.pcs.length || new Set(s.pcs).size !== s.pcs.length || s.pcs.some(id => !machines.some(p => p.id === id && !p.revoked))) throw Error('Select at least one enrolled PC per schedule');
    return {id:s.id, time:s.time, enabled:!!s.enabled, pcs:s.pcs, nextAt:nextScheduledTime(s.time, now)};
  });
  await pool.ctx.storage.put('schedules', schedules);
  await pool.ctx.storage.delete('schedule');
  await scheduleAlarm(pool);
  await pool.broadcast();
}

export async function scheduleAlarm(pool) {
  const storage = pool.ctx.storage;
  const saved = await storage.get('schedules');
  const legacy = !saved && await storage.get('schedule');
  if (legacy?.time) { await storage.setAlarm(nextScheduledTime(legacy.time)); return; }
  const schedules = saved || [];
  const job = await storage.get('scheduledJob');
  const times = schedules.filter(s => s.enabled).map(s => s.nextAt);
  if (job) times.push(Date.now() + 10000);
  if (times.length) await storage.setAlarm(Math.max(Date.now() + 100, Math.min(...times)));
  else await storage.deleteAlarm();
}

async function missed(pool, time, message, scheduleId) {
  const id = crypto.randomUUID();
  await pool.ctx.storage.put('history:' + time + ':' + id, {id, createdAt:time, status:'missed', error:message, scheduleId, requestedBy:'schedule'});
}

export async function scheduledAlarm(pool) {
  const store = pool.ctx.storage, now = Date.now();
  const saved = await store.get('schedules');
  const legacy = !saved && await store.get('schedule');
  if (legacy?.time) {
    try { await pool.start({id:'scheduled-'+Math.floor((now+19800000)/86400000),scope:'all',account:legacy.account,years:[indiaYear(now)],requestedBy:'schedule'}); }
    catch(e) { await missed(pool,now,e.message,'legacy'); }
    await pool.broadcast(); await scheduleAlarm(pool); return;
  }
  let schedules = saved || [];
  let job = await store.get('scheduledJob');
  for (const s of schedules) {
    if (!s.enabled || s.nextAt > now) continue;
    const due = s.nextAt;
    s.nextAt = nextScheduledTime(s.time, now);
    const run = await store.get('run');
    if (job || !terminal(run)) await missed(pool, due, 'A run was already active at the scheduled time.', s.id);
    else {
      job = {id:crypto.randomUUID(), scheduleId:s.id, pcs:[...s.pcs], index:0, retries:0, current:null, due, pendingSince:now};
      await store.put('scheduledJob', job);
    }
  }
  await store.put('schedules', schedules);
  if (job) {
    let run = await store.get('run');
    if (job.current && run?.id !== job.current) {
      await missed(pool, now, 'Another run replaced the scheduled run.', job.scheduleId);
      job = null;
    } else if (job.current && !terminal(run)) {
      const pc = await store.get('pc:' + run.pcId);
      if (now - (pc?.seen || run.createdAt) >= TIMEOUT) {
        run = {...run, status:'failed', checkpoint:false, error:'PC disconnected for five minutes; it may still be running.', updatedAt:now};
        await store.put('run', run);
        await store.put('history:' + run.createdAt, run);
      }
    }
    if (job && job.current && terminal(run)) {
      if (run.status === 'completed' || run.status === 'stopped') job = null;
      else {
        if (run.checkpoint && job.retries < 3) job.retries++;
        else { job.index++; job.retries = 0; }
        job.current = null;
        job.pendingSince = now;
      }
    }
    if (job && !job.current) {
      const state = await pool.state();
      // An offline host is skipped immediately. After a failure, briefly allow
      // the original host to finish cleanup and report ready before retrying.
      while (job.index < job.pcs.length) {
        const pc = state.machines.find(p => p.id === job.pcs[job.index]);
        const eligible = pc && !pc.revoked && pc.connected && pc.ready && now-pc.seen < 30000 && pc.accounts?.includes(ACCOUNT);
        if (eligible) break;
        if (job.retries && pc?.connected && now-job.pendingSince < TIMEOUT) break;
        job.index++; job.retries = 0;
      }
      if (job.index >= job.pcs.length) {
        await missed(pool, now, 'All scheduled PCs failed or were unavailable.', job.scheduleId);
        job = null;
      } else {
        const pc = state.machines.find(p => p.id === job.pcs[job.index]);
        if (pc?.connected && pc.ready && now-pc.seen < 30000 && pc.accounts?.includes(ACCOUNT)) {
          const previous = await store.get('run');
          if (!job.retries && previous?.checkpoint && previous.pcId !== pc.id) {
            const key = 'command:' + previous.pcId;
            if (!await store.get(key)) {
              const command = {type:'command',action:'clear',id:crypto.randomUUID()};
              await store.put(key, command);
              pool.send('agent',previous.pcId,command);
            }
          }
          const id = 'scheduled-' + crypto.randomUUID();
          // Persist the dispatch intent first so an interrupted alarm cannot
          // silently launch the same scheduled attempt a second time.
          job.current = id;
          await store.put('scheduledJob', job);
          try {
            const started = await pool.start({id, pcId:pc.id, scope:'all', account:ACCOUNT, years:[indiaYear(job.due)], requestedBy:'schedule', resume:job.retries>0, abandon:job.retries===0});
            job.current = started.id;
          } catch (e) {
            if (!terminal(await store.get('run'))) { await missed(pool, now, 'A run became active before the schedule could start.', job.scheduleId); job = null; }
            else { job.current=null; job.index++; job.retries=0; }
          }
        }
      }
    }
    if (job) await store.put('scheduledJob', job); else await store.delete('scheduledJob');
  }
  await pool.broadcast();
  await scheduleAlarm(pool);
}
