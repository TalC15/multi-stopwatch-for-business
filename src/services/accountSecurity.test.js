import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAccountSecurity} from './accountSecurity.js';
const ACCOUNT_SECURITY_TIMEOUT_MS=10000;
import {browser,user,sid,refreshed,response} from './testSupport/authHarness.js';
import {fakeAuth,deferred} from '../sync/testSupport/fixtures.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const denied={ok:false,supported:false};
function fixture(){
 const auth=fakeAuth();auth.BASE_URL='https://fixture.invalid';
 const response=()=>({ok:true,json:async()=>({userId:auth.state.user.id,passwordSecurity:true})});
 return {auth,response};
}
for(const stage of ['http','json','late rejection'])test('capability total deadline, abort-ignoring '+stage,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {auth,response}=fixture();
 const gate=deferred();let options,jsonReads=0,settled=false,result;
 auth.apiFetch=async(_url,opts)=>{options=opts;
  if(stage==='http')return gate.promise;
  return {ok:true,json:()=>{jsonReads++;return gate.promise;}};
 };
 const work=loadAccountSecurity(auth).then(value=>{settled=true;result=value;});
 await flush();t.mock.timers.tick(ACCOUNT_SECURITY_TIMEOUT_MS-1);await flush();assert.equal(settled,false);
 t.mock.timers.tick(1);await flush();assert.equal(settled,true);await work;
 assert.deepEqual(result,denied);assert.equal(options.signal.aborted,true);assert.equal(options.isRequestCurrent(),false);
 assert.equal(auth.state.generation,1);assert.equal(auth.state.marker,'marker-A');
 gate.resolve(stage==='http'?{...response(),json:()=>{jsonReads++;throw Error('late JSON must not run');}}:
  stage==='late rejection'?Promise.reject(Error('late body rejection')):{userId:auth.state.user.id,passwordSecurity:true});
 await flush();assert.deepEqual(result,denied);if(stage==='http')assert.equal(jsonReads,0);
});
test('capability uses one total budget across headers and JSON, not two timeouts',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {auth}=fixture(),headers=deferred(),body=deferred();let settled=false;
 auth.apiFetch=()=>headers.promise;
 const work=loadAccountSecurity(auth).then(result=>{settled=true;return result;});
 t.mock.timers.tick(7000);headers.resolve({ok:true,json:()=>body.promise});await flush();
 t.mock.timers.tick(3000);await flush();assert.equal(settled,true);assert.deepEqual(await work,denied);
 body.resolve({userId:auth.state.user.id,passwordSecurity:true});await flush();
});
for(const changed of ['user','generation','identity','marker','workspace','disabled'])test('capability JSON ignores changed '+changed,async()=>{
 const {auth}=fixture(),body=deferred(),entered=deferred();
 const userId=auth.state.user.id;auth.apiFetch=async()=>({ok:true,json:()=>{entered.resolve();return body.promise;}});
 const work=loadAccountSecurity(auth);await entered.promise;
 if(changed==='user')auth.state.user={...auth.state.user,id:'another'};
 else if(changed==='workspace')auth.state.user.workspace_id='another';
 else if(changed==='disabled')auth.state.user.disabled_at='closed';
 else if(changed==='generation')auth.state.generation++;
 else auth.state[changed]='another';
 body.resolve({userId,passwordSecurity:true});assert.deepEqual(await work,denied);
});
test('capability completion/failure clears deadline and aborts only its own request',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {auth,response}=fixture();let opts,aborts=0;
 auth.apiFetch=async(_url,options)=>{opts=options;options.signal.addEventListener('abort',()=>aborts++,{once:true});return response();};
 assert.deepEqual(await loadAccountSecurity(auth),{ok:true,supported:true});assert.equal(opts.signal.aborted,true);assert.equal(aborts,1);
 t.mock.timers.tick(ACCOUNT_SECURITY_TIMEOUT_MS);assert.equal(aborts,1);
 auth.apiFetch=async()=>{throw Error('network');};assert.deepEqual(await loadAccountSecurity(auth),denied);
 assert.equal(auth.state.current,true);
});

test('capability timeout while real apiFetch awaits refresh does not release the auth lock',async t=>{
 // Capture real auth timers before mocking only the capability budget.
 const tab=browser({initial:{'keeptimer-auth-session':`${user.id}:${sid}`,user:JSON.stringify(user)}}).tab();
 t.mock.timers.enable({apis:['setTimeout']});const entered=deferred(),release=deferred(),calls=[];
 tab.setFetch(async url=>{calls.push(url);if(url.endsWith('/refresh')){entered.resolve();await release.promise;return refreshed();}return response(200,{success:true,sessionId:sid});});
 let completed=false;const check=loadAccountSecurity(tab.auth).then(value=>{completed=true;return value;});await entered.promise;
 const logout=tab.auth.logout();await flush();assert.equal(calls.length,1);
 t.mock.timers.tick(ACCOUNT_SECURITY_TIMEOUT_MS);await flush();assert.equal(completed,true);assert.deepEqual(await check,denied);
 assert.equal(calls.length,1,'logout still waits on the original auth lock');assert.notEqual(tab.auth.getSessionMarker(),null);
 release.resolve();assert.equal((await logout).success,true);
 assert.equal(calls.some(url=>url.endsWith('/account/security')),false,'timed out request cannot later send');
});
