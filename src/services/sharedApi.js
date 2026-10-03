const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const validRevision = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value)<=9223372036854775807n;
export function validateSharedEnvelope(data, scope, snapshot = false) {
  if (data?.protocol!==5 || data.success!==true || data.workspaceId!==scope.workspaceId || !validRevision(data.generation) ||
      !Number.isFinite(Date.parse(data.serverNow)) || (snapshot && (data.complete!==true || !Array.isArray(data.timers)))) throw new Error('Eksiksiz ortak sunucu yanıtı doğrulanamadı');
  const rows = snapshot ? data.timers : [data.timer]; const seen=new Set();
  for(const row of rows) {
    if (!row || !uuid.test(row.id) || seen.has(row.id) || row.workspace_id!==scope.workspaceId || row.is_shared!==true ||
        !uuid.test(row.user_id) || !validRevision(row.shared_revision) || !['active','deleted','completed'].includes(row.record_status)) throw new Error('Ortak sayaç kapsamı veya revizyonu geçersiz');
    seen.add(row.id);
    if (row.record_status!=='active' || row.archived_at) continue;
    if (typeof row.name!=='string' || !row.name.trim() || !['up','down'].includes(row.type) ||
        !Number.isFinite(Number(row.target_minutes)) || Math.trunc(Number(row.target_minutes)*60000)<1 ||
        !['idle','running','paused','completed'].includes(row.status) || (row.type==='up' && row.status==='completed') ||
        typeof row.is_pay!=='boolean' || !Number.isSafeInteger(Number(row.accumulated_ms ?? 0)) || Number(row.accumulated_ms ?? 0)<0 ||
        !Number.isSafeInteger(Number(row.paused_count ?? 0)) || Number(row.paused_count ?? 0)<0 ||
        (row.status==='running' && !Number.isFinite(Date.parse(row.ends_at)))) throw new Error('Ortak sayaç zaman durumu geçersiz');
  }
  return data;
}
export function createSharedApi({ backend, online = ()=>globalThis.navigator?.onLine!==false, baseUrl='https://multi-stopwatch-backend.onrender.com' }) {
  async function request(path, body, options) {
    if (!online()) throw Object.assign(new Error('Ortak sayacı değiştirmek için internet bağlantınızı kontrol edin.'),{status:0});
    const user=backend.getUser();
    const scope={workspaceId:user?.workspace_id,userId:user?.id};
    const generation=backend.getAuthGeneration(), identity=backend.getTabSessionIdentity(), marker=backend.getSessionMarker();
    const current=()=>backend.isTabSessionCurrent() && backend.getAuthGeneration()===generation && backend.getTabSessionIdentity()===identity &&
      backend.getSessionMarker()===marker && backend.getUser()?.id===scope.userId && backend.getUser()?.workspace_id===scope.workspaceId &&
      !backend.getUser()?.disabled_at && options.isRequestCurrent();
    if (!scope.workspaceId || !current()) throw Object.assign(new Error('Oturum geçerli değil'),{status:401});
    const abort=new AbortController(); const timeout=setTimeout(()=>abort.abort(),15000); timeout.unref?.();
    try {
      const response=await backend.apiFetch(`${baseUrl}${path}`,{ method:body?'POST':'GET',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${backend.getAccessToken()}`},
        ...(body?{body:JSON.stringify(body)}:{}), signal:abort.signal,isRequestCurrent:current });
      if (!current()) throw Object.assign(new Error('Oturum değişti'),{status:401});
      if (!response) throw new Error('İşlemin sonucu doğrulanamadı');
      if (!response.ok) throw Object.assign(new Error('Ortak sunucu isteği reddedildi'),{status:response.status});
      const data=await response.json();
      if (!current()) throw Object.assign(new Error('Oturum değişti'),{status:401});
      validateSharedEnvelope(data,scope,!body);
      if (body && (data.timer.id!==body.timerId || data.mutationId!==body.mutationId)) throw new Error('Komut yanıtı eşleşmiyor');
      return data;
    } finally { clearTimeout(timeout); }
  }
  return { snapshot: options=>request('/timers/shared?protocol=5',null,options),
    command: (body,options)=>request('/timers/shared/commands',body,options) };
}
