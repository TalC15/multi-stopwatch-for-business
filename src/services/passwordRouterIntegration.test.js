import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {loadAccountSecurity} from './accountSecurity.js';
const ACCOUNT_SECURITY_TIMEOUT_MS=10000;
import {message,messageState} from '../composables/message.js';
import {createRouter,createMemoryHistory} from 'vue-router';
import {managementRedirect} from '../domain/subscriptionManagement.js';
import {browser,loggedIn,user,sidB,installPasswordRequests,deferred,settle} from './testSupport/authHarness.js';

// Real router module (guards AND login-required listener). Replace only history
// and lazy page bodies: this is routing/service integration, not browser layout.
async function fixture(role='worker',supported=true,native=false,loadSecurity=null){
 messageState.messages.splice(0);
 const tab=browser().tab();tab.setFetch(()=>loggedIn(undefined,{...user,role}));await tab.auth.login('A','fixture-pin');
 let source=await readFile(new URL('../router/index.js',import.meta.url),'utf8');
 source=source.replace(/^import[\s\S]*?from\s*["'][^"']+["'];\s*/gm,'')
   .replace(/component:\s*\(\)\s*=>\s*import\([^)]*\)/g,'component:{render:()=>null}')
   .replace('export default router;','globalThis.router=router;');
 const context=vm.createContext({...tab.auth,window:tab.window,createRouter,createWebHistory:createMemoryHistory,managementRedirect,
  Capacitor:{getPlatform:()=>native?'android':'web',isNativePlatform:()=>native},
  loadAccountSecurity:()=>loadSecurity?loadSecurity(tab):Promise.resolve({ok:true,supported})});
 vm.runInContext(source,context);const router=context.router;
 const api=installPasswordRequests(tab,message);return {tab,router,api};
}
for(const [kind,path] of [['change','password/change'],['change','sessions/revoke-all'],['activation','activation/complete'],['reset','reset/complete']]){
 test(`router completion: ${path} appears once after real login-required redirect`,async()=>{
  const {tab,router,api}=await fixture();
  const initial=kind==='change'?'/account/security':kind==='activation'?'/account/activate':'/account/reset';
  await router.push(initial);
  tab.setFetch(()=>({ok:true,json:async()=>({success:true,requiresLogin:true,userId:user.id})}));
  const result=await api.passwordAuthRequest(path,{}, {isCurrent:()=>router.currentRoute.value.path===initial});
  await settle();await settle();
  assert.equal(result.ok,true);assert.equal(tab.auth.getSessionMarker(),null);
  assert.equal(router.currentRoute.value.path,'/login');
  assert.equal(messageState.messages.length,1);assert.match(messageState.messages[0].text,/Yeniden giriş yapın/);
  // A new login must remove the old account's notice as well.
  tab.setFetch(()=>loggedIn(sidB,{...user,id:'00000000-0000-4000-8000-000000000002'}));
  await tab.auth.login('B','fixture-pin');assert.equal(messageState.messages.length,0);
 });
}
for(const changed of ['account','route'])test(`router completion: delayed body after ${changed} switch gives no notice`,async()=>{
 const {tab,router,api}=await fixture();await router.push('/account/security');
 const body=deferred(),entered=deferred();tab.setFetch(()=>({ok:true,json:()=>{entered.resolve();return body.promise;}}));
 const work=api.passwordAuthRequest('sessions/revoke-all',{}, {isCurrent:()=>router.currentRoute.value.path==='/account/security'});
 await entered.promise;
 if(changed==='route')await router.push('/profile');else{tab.setFetch(()=>loggedIn(sidB));await tab.auth.login('B','fixture-pin');}
 body.resolve({success:true,requiresLogin:true});await work;await settle();
 assert.equal(messageState.messages.length,0);
});
for(const [role,supported,native,target] of [
 ['manager',false,false,'/account/security-unavailable'],['worker',false,false,'/account/security-unavailable'],
 ['worker',true,false,'/account/security'],['agent',true,false,'/account/security'],['superadmin',true,false,'/account/security'],
 ['worker',true,true,'/account/security-unavailable'],['agent',true,true,'/account/security-unavailable']]){
 test(`security direct route: ${role} password=${supported} native=${native}`,async()=>{
  const {router}=await fixture(role,supported,native);await router.push('/account/security');assert.equal(router.currentRoute.value.path,target);
 });
}

test('security route guard reaches retry screen after real capability request times out',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {tab,router}=await fixture('worker',true,false,tab=>loadAccountSecurity(tab.auth));
 tab.setFetch(()=>new Promise(()=>{}));let finished=false;
 const navigation=router.push('/account/security').then(()=>{finished=true;});
 await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(ACCOUNT_SECURITY_TIMEOUT_MS);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,true);await navigation;
 assert.equal(router.currentRoute.value.path,'/account/security-unavailable');assert.notEqual(tab.auth.getSessionMarker(),null);
});
