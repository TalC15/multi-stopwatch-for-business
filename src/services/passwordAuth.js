import { apiFetch, getAccessToken, getSessionMarker, isSameAuthSession, getAuthGeneration, clearAuthSessionIfCurrent } from './backendSync.js';
import { isAndroidAuthPlatform } from './keepTimerAuth.js';
const stale=()=>({ok:false,stale:true,error:'Oturum değişti; işlem sonucunu tekrar doğrulayın.'});
const paths=new Set(['activation/request','activation/complete','reset/request','reset/complete','password/change','sessions/list','sessions/revoke-all']);
export async function passwordAuthRequest(path,body) {
 if(!paths.has(path) || isAndroidAuthPlatform())return {ok:false,error:'Bu işlem güvenli web hesabı üzerinden kullanılabilir.'};
 if(globalThis.navigator?.onLine===false)return {ok:false,error:'İşlem için internet bağlantısı gerekli.'};
 const marker=getSessionMarker(),generation=getAuthGeneration();
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
    const cleared=await clearAuthSessionIfCurrent(generation,marker);
    // clearCurrentSession increments generation once and removes the marker.
    if(!cleared || !isSameAuthSession(generation+1,null))return stale();
  }
  return {ok:true,data};
 } catch {return {ok:false,error:'İşlem sonucu doğrulanamadı. Yeniden deneyin.'};}
}
