// Render terminal output as plain text; keep timestamps and message order.
export function cleanAutomationLog(value) {
  return String(value ?? '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

export function logEntries(text,full=false){
 const result=[];
 for(const raw of text.split('\n')){
  if(!raw.trim())continue;
  const match=raw.match(/^\s*\[(\d{1,2}:\d{2}:\d{2})\]\s*(.*)$/);
  let message=(match?match[2]:raw).trim();
  if(!full){
   if(/^[\s=+|*#_─━┌┐└┘│┼┬┴├┤-]{3,}$/.test(message))continue;
   message=message.replace(/^\|\s*(.*?)\s*\|?$/,'$1').trim();
   if(/^(?:SAP reporting automation suite|AUTO BTP\s*\/\s*AUTO BTR)$/i.test(message))continue;
  }
  if(!message)continue;
  const level=/\b(error|failed|failure|fatal)\b/i.test(message)?'error':/\b(warn(?:ing)?|retrying)\b/i.test(message)?'warning':/\b(success(?:ful(?:ly)?)?|completed|finished)\b/i.test(message)?'success':/PHASE|--- Batch/.test(message)?'phase':'info';
  result.push({time:match?match[1]:'',message,level});
 }
 return result;
}
export function workflowStepState(index,stage,status,scope='all'){
 const included=scope==='all'||(index<4?scope.includes('btr'):index<10?scope.split('-').includes('btp'):scope.includes('ebtp'));
 return {done:included&&(status==='completed'||index<stage-1),active:included&&index===stage-1&&!['completed','failed','stopped','missed'].includes(status),skipped:!included,failed:included&&index===stage-1&&['failed','stopped'].includes(status)};
}

export function workflowOutcome(run,manifest){
 if(!run)return undefined;
 const cleanupFailure=run.status==='failed'&&String(run.error||'').startsWith('Post-run process cleanup failed:');
 if(cleanupFailure&&(run.workflowStatus==='completed'||(manifest?.run?.id===run.id&&manifest.status==='completed')))return 'completed';
 return run.status;
}

export function batchProgress(text){
 const plan=[...text.matchAll(/AUTO-PLANNED BATCHES:\s*(\d+)/gi)].at(-1);
 const batch=[...text.matchAll(/---\s*Batch\s+(\d+)\s*\/\s*(\d+)/gi)].at(-1);
 return {total:batch?Number(batch[2]):plan?Number(plan[1]):0,current:batch?Number(batch[1]):0};
}
