import * as auth from './backendSync.js';
import { captureWorkspaceSession } from './workspaceSession.js';
// Match accountExperience: one budget for auth waits, HTTP and body consumption.
export const ACCOUNT_SECURITY_TIMEOUT_MS = 10000;
export async function loadAccountSecurity(backend=auth) {
  const denied=()=>({ok:false,supported:false});
  const session=captureWorkspaceSession(backend);
  if(!session.isCurrent())return denied();
  const controller=new AbortController();
  let finished=false,timer;
  const current=()=>!finished && !controller.signal.aborted && session.isCurrent();
  try {
    const deadline=new Promise(resolve=>{
      timer=setTimeout(()=>{controller.abort();resolve(denied());},ACCOUNT_SECURITY_TIMEOUT_MS);
    });
    const request=(async()=>{
      try {
        const response=await backend.apiFetch(backend.BASE_URL+'/account/security',{
          cache:'no-store',signal:controller.signal,
          headers:{Authorization:`Bearer ${backend.getAccessToken()}`},isRequestCurrent:current,
        });
        if(!current())return denied();
        const data=response && await response.json();
        if(!current() || !response?.ok || data?.userId!==backend.getUser()?.id || typeof data.passwordSecurity!=='boolean')return denied();
        return {ok:true,supported:data.passwordSecurity};
      } catch {return denied();}
    })();
    // This releases only the capability caller, never an underlying auth lock.
    return await Promise.race([request,deadline]);
  } finally {
    finished=true;clearTimeout(timer);controller.abort();
  }
}
