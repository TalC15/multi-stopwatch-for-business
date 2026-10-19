import { apiFetch, getAccessToken, getSessionMarker, isSameAuthSession, getAuthGeneration, clearAuthSessionIfCurrent, AUTH_SESSION_CHANGED_EVENT, AUTH_USER_CHANGED_EVENT } from './backendSync.js';
import { message } from '../composables/message.js';
import { isAndroidAuthPlatform } from './keepTimerAuth.js';
const stale=()=>({ok:false,stale:true,error:'Oturum değişti; işlem sonucunu tekrar doğrulayın.'});
const paths=new Set(['activation/request','activation/complete','reset/request','reset/complete','password/change','sessions/list','sessions/revoke-all']);
export async function passwordAuthRequest(path,body,{isCurrent=()=>true}={}) {
 if(!paths.has(path) || isAndroidAuthPlatform())return {ok:false,error:'Bu işlem güvenli web hesabı üzerinden kullanılabilir.'};
 if(globalThis.navigator?.onLine===false)return {ok:false,error:'İşlem için internet bağlantısı gerekli.'};
 const marker=getSessionMarker(),generation=getAuthGeneration();
 let clearedGeneration,completionNotified=false;
 try {
  const options={method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-KeepTimer-CSRF':'1'},body:JSON.stringify(body)};
  if(['password/change','sessions/list','sessions/revoke-all'].includes(path)) options.headers.Authorization=`Bearer ${getAccessToken()}`;
  const response=['password/change','sessions/list','sessions/revoke-all'].includes(path)?await apiFetch('/api/auth/'+path,options):await fetch('/api/auth/'+path,options);
  if(!isSameAuthSession(generation,marker))return stale();
  const data=response && await response.json();
  if(!isSameAuthSession(generation,marker))return stale();
  if(!response?.ok)return {ok:false,status:response?.status,error:data?.error || 'İşlem tamamlanamadı.'};
  if (data?.success===true && ((['password/change','sessions/revoke-all'].includes(path) && data.requiresLogin===true) ||
      (['activation/complete','reset/complete'].includes(path) && typeof data.userId==='string' && marker?.split(':')[0]?.toLowerCase()===data.userId.toLowerCase()))) {
    const cleared=await clearAuthSessionIfCurrent(generation,marker,{
      isCurrent,
      onCleared(){
        if(!isSameAuthSession(generation+1,null))return;
        const id=message.success(path==='sessions/revoke-all'?'Tüm oturumlar iptal edildi. Yeniden giriş yapın.':'Parolanız güncellendi. Yeniden giriş yapın.');
        completionNotified=true;
        const events=[AUTH_SESSION_CHANGED_EVENT,AUTH_USER_CHANGED_EVENT];
        const remove=()=>{events.forEach(name=>globalThis.window?.removeEventListener(name,changed));};
        const changed=()=>{if(!isSameAuthSession(generation+1,null)){message.dismiss(id);remove();}};
        events.forEach(name=>globalThis.window?.addEventListener(name,changed));
        const cleanup=setTimeout(remove,3000);cleanup?.unref?.();
      },
    });
    // clearCurrentSession increments generation once and removes the marker.
    if(!cleared || !isSameAuthSession(generation+1,null))return stale();
    clearedGeneration=generation+1;
  }
  return {ok:true,data,...(clearedGeneration===undefined?{}:{clearedGeneration,completionNotified})};
 } catch {return {ok:false,error:'İşlem sonucu doğrulanamadı. Yeniden deneyin.'};}
}
