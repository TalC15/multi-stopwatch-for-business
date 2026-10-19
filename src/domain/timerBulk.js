// Display selection only. Store commands and the server retain write authority.
export function bulkEligible(timer, tab) {
  const shared=timer?.isShared===true;
  return Boolean(timer && (tab==='shared'?shared:!shared && timer.type===tab) &&
    ['running','paused','idle'].includes(timer.status) && !timer.syncDeleted &&
    !timer.archivedAt && !timer.archived_at && !timer.deletedAt &&
    (timer.recordStatus==null || timer.recordStatus==='active') &&
    (timer.record_status==null || timer.record_status==='active'));
}
export function timerBulkState(timers,tab,writable=true) {
  const eligible=writable && ['up','down','shared'].includes(tab)?timers.filter(t=>bulkEligible(t,tab)):[];
  const action=eligible.some(t=>t.status==='running')?'pause':'start';
  return {action,ids:eligible.filter(t=>action==='pause'?t.status==='running':t.status==='paused'||t.status==='idle').map(t=>t.id),
    label:action==='pause'?'Tümünü duraklat':'Tümünü başlat'};
}
