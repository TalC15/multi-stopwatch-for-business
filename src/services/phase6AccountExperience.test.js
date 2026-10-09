import test from 'node:test';
import assert from 'node:assert/strict';
import { computed } from 'vue';
import { createAccountExperience } from './accountExperience.js';
import { historyStatus } from '../domain/subscriptionManagement.js';
import { browser, loggedIn, response, deferred, settle, sidB } from './testSupport/authHarness.js';
const user={id:'aaaaaaaa-0000-4000-8000-000000000001',workspace_id:'aaaaaaaa-0000-4000-8000-000000000002',role:'worker'};
const active=()=>({account:{kind:'individual',userId:user.id,workspaceId:user.workspace_id},
  subscription:{planCode:'individual',status:'active',startsAt:'2026-10-01T00:00:00.000001Z',endsAt:'2026-10-09T09:00:00.010999Z',isEntitled:true},
  evaluatedAt:'2026-10-09T09:00:00.000999Z',code:null,features:{tts:true,telegram:true,presets:true},
  personal:{readable:true,writable:true},shared:false,loginReady:false});
function fixture() {
  let now=0,body=active(),connected=true,generation=0;
  const events=new EventTarget(),tasks=new Map();let serial=0;
  const auth={getUser:()=>user,isTabSessionCurrent:()=>true,getAuthGeneration:()=>generation,
    getTabSessionIdentity:()=>String(generation),getSessionMarker:()=>String(generation),getAccessToken:()=> 'fixture',
    ACCOUNT_AUTHORITY_DENIED_EVENT:'denied'};
  const policy=createAccountExperience({auth,events,online:()=>connected,monotonicNow:()=>now,
    request:async()=>typeof body==='function'?body():response(200,body),baseUrl:'https://fixture.invalid',
    schedule:(fn,ms)=>{const id=++serial;tasks.set(id,{fn,ms});return id;},unschedule:id=>tasks.delete(id)});
  return {policy,events,tasks,set:x=>{body=x;},clock:x=>{now=x;},offline:()=>{connected=false;events.dispatchEvent(new Event('offline'));},switch:()=>{generation++;policy.reset();}};
}
test('Phase 6: lease closes at DB expiry, no millisecond round-up and reactive UI is invalidated',async()=>{
  const f=fixture();assert.equal(await f.policy.refresh(),true);const usable=computed(()=>f.policy.canFeature('tts'));
  assert.equal(usable.value,true);assert.equal([...f.tasks.values()][0].ms,10);
  f.clock(9.999);assert.equal(f.policy.canWritePersonal(),true);
  f.clock(10);assert.equal(f.policy.canWritePersonal(),false);
  [...f.tasks.values()][0].fn();assert.equal(usable.value,false);assert.equal(f.policy.state.status,'stale');
  assert.equal(f.policy.state.data.personal.readable,true);f.policy.dispose();
});
for(const observed of [undefined,null,'bad','2026-10-09T09:00:00.010999Z','2026-09-30T00:00:00Z'])test('Phase 6: missing/inconsistent DB observation cannot grant rights '+observed,async()=>{
  const f=fixture();f.set({...active(),evaluatedAt:observed});assert.equal(await f.policy.refresh(),false);
  assert.equal(f.policy.canFeature('presets'),false);f.policy.dispose();
});
test('Phase 6: sub-millisecond remaining period closes conservatively',async()=>{
  const f=fixture();f.set({...active(),evaluatedAt:'2026-10-09T09:00:00.010000Z'});
  assert.equal(await f.policy.refresh(),false);assert.equal(f.policy.canFeature('tts'),false);f.policy.dispose();
});
test('Phase 6: complete transport and JSON duration consumes the lease',async()=>{
  const f=fixture();f.set(()=>({ok:true,json:async()=>{f.clock(11);return active();}}));
  assert.equal(await f.policy.refresh(),false);assert.equal(f.policy.canFeature('telegram'),false);f.policy.dispose();
});
test('Phase 6: changed wall clock cannot extend a lease or activate pending history',async t=>{
  const f=fixture();await f.policy.refresh();t.mock.method(Date,'now',()=>0);f.clock(10);
  assert.equal(f.policy.canFeature('tts'),false);
  const d=active();Object.assign(d,{code:'SUBSCRIPTION_PENDING'});Object.assign(d.subscription,{status:'pending',isEntitled:false});
  d.features={tts:false,telegram:false,presets:false};d.personal.writable=false;f.set(d);await f.policy.refresh();
  t.mock.method(Date,'now',()=>9e15);assert.equal(f.policy.canWritePersonal(),false);f.policy.dispose();
});
test('Phase 6: monotonic clock regression fails closed',async()=>{
  const f=fixture();f.clock(10);await f.policy.refresh();f.clock(9);assert.equal(f.policy.canFeature('tts'),false);f.policy.dispose();
});
test('Phase 6: a current rejection supersedes an in-flight positive response and survives disconnect',async()=>{
  const f=fixture();await f.policy.refresh();const gate=deferred();f.set(()=>gate.promise);
  const pending=f.policy.refresh();f.events.dispatchEvent(new Event('denied'));gate.resolve(response(200,active()));
  assert.equal(await pending,false);assert.equal(f.policy.canFeature('tts'),false);f.offline();assert.equal(f.policy.canFeature('tts'),false);
  assert.equal(f.policy.state.data.account.userId,user.id);f.policy.dispose();
});
for(const event of ['focus','pageshow'])test('Phase 6: resume '+event+' invalidates old Individual proof',async()=>{
  const f=fixture();await f.policy.refresh();f.events.dispatchEvent(new Event(event));
  assert.equal(f.policy.canFeature('tts'),false);assert.equal(f.policy.state.data.personal.readable,true);f.policy.dispose();
});
test('Phase 6: old expiry callback cannot close another session proof',async()=>{
  const f=fixture();await f.policy.refresh();const old=[...f.tasks.values()][0].fn;
  f.switch();await f.policy.refresh();old();assert.equal(f.policy.canFeature('tts'),true);f.policy.dispose();
});
test('Phase 6: history has no precise status without server metadata, regardless of wall clock',()=>{
  const row={cancelledAt:null,startsAt:'2000-01-01Z',endsAt:'2100-01-01Z'};
  assert.equal(historyStatus(row),null);assert.equal(historyStatus({...row,status:'pending'}),'pending');
  assert.equal(historyStatus({...row,status:'expired'}),'expired');
});
for(const [status,code] of [[403,'SUBSCRIPTION_EXPIRED'],[403,'SUBSCRIPTION_CANCELLED'],[409,'SUBSCRIPTION_CONFLICT'],[503,'SUBSCRIPTION_UNAVAILABLE']])test('Phase 6: real apiFetch publishes current entitlement rejection '+code,async()=>{
  const tab=browser().tab();tab.setFetch(async()=>loggedIn());await tab.auth.login('fixture','1234');let rejected=0;
  tab.window.addEventListener(tab.auth.ACCOUNT_AUTHORITY_DENIED_EVENT,()=>rejected++);
  tab.setFetch(async()=>response(status,{code}));const result=await tab.auth.apiFetch('/timers/personal/fixture');
  assert.equal(result.status,status);assert.equal((await result.json()).code,code);assert.equal(rejected,1);
  assert.equal(tab.auth.isLoggedIn(),true);
});
test('Phase 6: late previous-session denial is ignored by real apiFetch',async()=>{
  const tab=browser().tab();tab.setFetch(async()=>loggedIn());await tab.auth.login('fixture','1234');const gate=deferred();let rejected=0;
  tab.window.addEventListener(tab.auth.ACCOUNT_AUTHORITY_DENIED_EVENT,()=>rejected++);
  tab.setFetch(async()=>gate.promise);const request=tab.auth.apiFetch('/timers/personal/fixture');await settle();
  tab.setFetch(async()=>loggedIn(sidB));await tab.auth.login('fixture','1234');gate.resolve(response(403,{code:'SUBSCRIPTION_EXPIRED'}));
  assert.equal(await request,null);assert.equal(rejected,0);
});
