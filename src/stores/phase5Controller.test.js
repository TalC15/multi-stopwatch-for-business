import 'fake-indexeddb/auto';
import test, { beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { timerDb } from '../data/timerDb.js';
import { saveTimer, listStandaloneTimers, listWorkspacePersonalTimers } from '../data/timerRepository.js';
import { createAccountExperience } from '../services/accountExperience.js';
import { createStopwatchController } from './stopwatchController.js';
import { createPersonalSyncApi } from '../sync/personalSyncApi.js';
import { createPersonalSyncEngine } from '../sync/personalSyncEngine.js';
import { enqueuePersonalPut, listPersonalOutbox } from '../sync/personalOutbox.js';
import { ids, scope, timer, fakeAuth, fakeLocks, mockServer, response } from '../sync/testSupport/fixtures.js';
let fixtures=[];
beforeEach(async()=>{await timerDb.delete(); await timerDb.open();});
afterEach(()=>{for(const f of fixtures){f.controller.dispose();f.experience.dispose();}fixtures=[];});
after(()=>timerDb.close());
function fixture(preferences={}) {
  const auth=fakeAuth(); auth.state.user.role='worker';
  const server=mockServer(), events=new EventTarget(), errors=[], notices=[], io={shared:0,flush:0}, net={online:true,status:'active',code:null};
  const experience=createAccountExperience({auth,events,online:()=>net.online,request:async()=>({ok:true,json:async()=>({
    evaluatedAt:'2026-10-09T09:00:00.000001Z', account:{kind:'individual',userId:auth.state.user.id,workspaceId:auth.state.user.workspace_id},
    subscription:{planCode:'individual',status:net.status,startsAt:'2026-10-01T00:00:00.000001Z',endsAt:'2026-11-01T00:00:00.000002Z',isEntitled:net.code===null},code:net.code,
    features:{tts:net.code===null,telegram:net.code===null,presets:net.code===null},personal:{readable:true,writable:net.code===null},shared:false,loginReady:false})})});
  const backend={...auth,AUTH_LOCAL_LOGOUT_EVENT:'logout',AUTH_SESSION_CHANGED_EVENT:'session',AUTH_USER_CHANGED_EVENT:'user'};
  const api=createPersonalSyncApi({auth,request:server.request,baseUrl:'https://fixture.invalid',experience});
  const realEngine=createPersonalSyncEngine({api,locks:fakeLocks(),online:()=>net.online});
  const engine={...realEngine,flush:async()=>{io.flush++;return realEngine.flush();}};
  const controller=createStopwatchController({backend,experience,personalApi:api,engine,online:()=>net.online,
    socket:{onTimerEvent:()=>()=>{},onSocketConnected:()=>()=>{}},sharedApi:{snapshot:async()=>{io.shared++;throw Error('Private must not read shared');}},
    notify:(...args)=>notices.push(args),cancelSound(){},haptic(){},message:{error:x=>errors.push(x),warning:x=>errors.push(x),success(){},loading(){},dismiss(){}},
    storage:{getItem:key=>key in preferences?JSON.stringify(preferences[key]):null},events,document:new EventTarget(),setInterval:()=>0,clearInterval(){}});
  const f={auth,server,experience,controller,net,errors,notices,io,api,realEngine,events};fixtures.push(f);return f;
}
const input={name:'Own',duration:5,type:'up',isShared:false};

test('Phase 5 real controller: cached preset defaults are applied only after server-verified feature rights',async()=>{
  for(const status of ['pending','active','offline']){
    const f=fixture({defaultName:'Paid default',defaultDuration:77});
    assert.equal(f.controller.name.value,'kronometre');assert.equal(f.controller.duration.value,5);
    if(status==='pending'){f.net.status='pending';f.net.code='SUBSCRIPTION_PENDING';}
    if(status==='offline')f.net.online=false;
    await f.controller.initialize();
    assert.equal(f.controller.name.value,status==='active'?'Paid default':'kronometre');
    assert.equal(f.controller.duration.value,status==='active'?77:5);
  }
});

test('Phase 5 real controller: active private creation uses existing outbox; Standalone is never uploaded and shared is never loaded',async()=>{
  const f=fixture(); const standalone={...timer({id:ids.second}),dataMode:'standalone',userId:null,workspaceId:null};
  await saveTimer(standalone);await f.controller.initialize();const id=await f.controller.addTimer(input);assert.ok(id);
  await f.controller.requestSync();assert.equal(f.io.shared,0);assert.equal((await listStandaloneTimers()).length,1);
  assert.ok(f.server.requests.filter(r=>r.method!=='GET').every(r=>!r.url.includes(ids.second)));
  assert.equal((await listWorkspacePersonalTimers(scope)).length,1);
});
test('Phase 5 real controller: expired reads data, skips flush, blocks new and online mutations; renewal keeps same records',async()=>{
  const f=fixture();await enqueuePersonalPut(timer(),scope,{isNew:true});
  f.net.status='expired';f.net.code='SUBSCRIPTION_EXPIRED';await f.controller.initialize();await f.controller.requestSync();
  assert.equal(f.controller.stopwatches.value.length,1);assert.equal(f.io.flush,0);assert.equal(await f.controller.addTimer(input),null);
  assert.equal(await f.controller.startTimer(ids.timer),false);assert.equal((await listPersonalOutbox(scope)).length,1);
  f.net.status='active';f.net.code=null;await f.controller.retrySync();
  assert.equal((await listPersonalOutbox(scope)).length,0);assert.equal((await listWorkspacePersonalTimers(scope))[0].id,ids.timer);
});
test('Phase 5 real controller: offline existing timer controls stay local/queued, paid features and new private creation remain closed',async()=>{
  const f=fixture();await enqueuePersonalPut(timer(),scope,{isNew:true});await f.controller.initialize();await f.controller.requestSync();
  f.net.online=false;f.events.dispatchEvent(new Event('offline'));assert.equal(await f.controller.startTimer(ids.timer),true);
  assert.equal(f.experience.canFeature('tts'),false);assert.equal(await f.controller.addTimer(input),null);
  assert.equal((await listWorkspacePersonalTimers(scope)).length,1);assert.equal((await listPersonalOutbox(scope)).length,1);
});
test('Phase 5 real controller: account switch hides prior private rows and retains durable outbox/cache',async()=>{
  const f=fixture();await enqueuePersonalPut(timer(),scope,{isNew:true});await f.controller.initialize();await f.controller.requestSync();
  f.auth.state.user={id:ids.other,workspace_id:ids.otherWorkspace,role:'worker'};f.auth.state.generation++;f.auth.state.identity='B';f.auth.state.marker='B';
  f.events.dispatchEvent(new Event('user'));await f.controller.initialize();
  assert.ok(f.controller.stopwatches.value.every(t=>t.userId!==ids.user));assert.equal((await listWorkspacePersonalTimers(scope)).length,1);
});
test('Phase 5 real sync API/engine: subscription-denied frozen operation retries unchanged only after fresh rights',async()=>{
  const f=fixture();await enqueuePersonalPut(timer(),scope,{isNew:true});
  const original=f.server.request;let denied=true;const api=createPersonalSyncApi({auth:f.auth,experience:f.experience,baseUrl:'https://fixture.invalid',
    request:async(url,opts)=>opts.method==='PUT'&&denied?response(403,{code:'SUBSCRIPTION_EXPIRED'}):original(url,opts)});
  const engine=createPersonalSyncEngine({api,locks:fakeLocks()});await engine.flush();
  const before=(await listPersonalOutbox(scope))[0];assert.equal(before.status,'forbidden');assert.equal(before.error.code,'SUBSCRIPTION_EXPIRED');
  f.net.status='expired';f.net.code='SUBSCRIPTION_EXPIRED';assert.equal((await engine.flush()).status,'forbidden');
  assert.equal((await listPersonalOutbox(scope))[0].body,before.body);
  f.net.status='active';f.net.code=null;denied=false;assert.equal((await engine.flush()).acknowledged,1);
  const sent=f.server.requests.find(r=>r.method==='PUT');assert.equal(sent.body,before.body);assert.equal(JSON.parse(sent.body).mutationId,before.mutationId);
  assert.equal((await listPersonalOutbox(scope)).length,0);
});
test('Phase 5 real sync API/engine: unknown or array-valued 403 remains forbidden after active verification',async()=>{
  const f=fixture();
  for(const code of ['UNKNOWN_CODE',['SUBSCRIPTION_EXPIRED']]){
    await enqueuePersonalPut(timer({id:ids.timer}),scope,{isNew:true}); let attempts=0;
    const api=createPersonalSyncApi({auth:f.auth,experience:f.experience,baseUrl:'https://fixture.invalid',
      request:async()=>{attempts++;return response(403,{code});}});
    const engine=createPersonalSyncEngine({api,locks:fakeLocks()});
    assert.equal((await engine.flush()).status,'forbidden'); const before=(await listPersonalOutbox(scope))[0];
    assert.equal(before.error.code,'http-error'); assert.equal(await f.experience.refresh(),true);
    assert.equal((await engine.flush()).status,'forbidden'); assert.equal(attempts,1);
    const after=(await listPersonalOutbox(scope))[0]; assert.equal(after.body,before.body); assert.equal(after.mutationId,before.mutationId);
    await timerDb.personalOutbox.clear(); await timerDb.timers.clear();
  }
});
