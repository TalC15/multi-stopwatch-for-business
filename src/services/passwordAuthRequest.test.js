import test from 'node:test';
import assert from 'node:assert/strict';
import {browser,loggedIn,sid,sidB,user,response,deferred,installPasswordRequests} from './testSupport/authHarness.js';
const accountB={...user,id:'00000000-0000-4000-8000-000000000002'};
for(const path of ['sessions/list','sessions/revoke-all','password/change','activation/request','activation/complete','reset/request','reset/complete']) {
 test(`P2 JSON: ${path} rejects account switch after HTTP, before body completion`,async()=>{
  const tab=browser().tab();tab.setFetch(()=>loggedIn());await tab.auth.login('A','fixture-pin');
  const gate=deferred(),entered=deferred();tab.setFetch(()=>({ok:true,status:200,json:()=>{entered.resolve();return gate.promise;}}));
  const work=installPasswordRequests(tab).passwordAuthRequest(path,{});await entered.promise;
  tab.setFetch(()=>loggedIn(sidB,accountB));await tab.auth.login('B','fixture-pin');
  gate.resolve({success:true,requiresLogin:true,sessions:[{id:'A-session',createdAt:'A-time'}]});
  const result=await work;assert.equal(result.ok,false);assert.equal(result.stale,true);assert.equal(result.data,undefined);
  assert.equal(tab.auth.getUser().id,accountB.id);
 });
}
for(const change of ['new-session','logout'])test(`P2 JSON: same account ${change} invalidates parsed session list`,async()=>{
 const tab=browser().tab();tab.setFetch(()=>loggedIn());await tab.auth.login('A','fixture-pin');
 const gate=deferred(),entered=deferred();tab.setFetch(()=>({ok:true,status:200,json:()=>{entered.resolve();return gate.promise;}}));
 const work=installPasswordRequests(tab).passwordAuthRequest('sessions/list',{});await entered.promise;
 tab.setFetch(()=>change==='logout'?response(200,{success:true,sessionId:sid}):loggedIn(sidB));if(change==='logout')assert.equal((await tab.auth.logout()).success,true);else await tab.auth.login('A','fixture-pin');
 gate.resolve({sessions:[{id:'old-session'}]});assert.equal((await work).ok,false);
});
test('P2 clear: a new account while waiting for auth mutation lock makes clear=false and never success',async()=>{
 const b=browser({locks:false}),tab=b.tab(),other=b.tab();tab.setFetch(()=>loggedIn());await tab.auth.login('A','fixture-pin');
 const waitingLock={request:async(_name,callback)=>{
  other.setFetch(()=>loggedIn(sidB,accountB));await other.auth.login('B','fixture-pin');return callback();
 }};
 tab.setFetch(()=>({ok:true,status:200,json:async()=>{tab.context.navigator.locks=waitingLock;return {success:true,requiresLogin:true};}}));
 const result=await installPasswordRequests(tab).passwordAuthRequest('sessions/revoke-all',{});
 assert.equal(result.ok,false);assert.equal(result.stale,true);assert.equal(other.auth.getUser().id,accountB.id);
});
test('P2 positive: current list and confirmed own-session clear still succeed',async()=>{
 const tab=browser().tab();tab.setFetch(()=>loggedIn());await tab.auth.login('A','fixture-pin');
 const api=installPasswordRequests(tab);tab.setFetch(()=>({ok:true,status:200,json:async()=>({sessions:[{id:'A'}]})}));
 assert.equal((await api.passwordAuthRequest('sessions/list',{})).data.sessions[0].id,'A');
 tab.setFetch(()=>({ok:true,status:200,json:async()=>({success:true,requiresLogin:true})}));
 assert.equal((await api.passwordAuthRequest('sessions/revoke-all',{})).ok,true);assert.equal(tab.auth.getSessionMarker(),null);
});
