import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { beforeEach, after, test } from "node:test";
import { timerDb } from "../data/timerDb.js";
import { enqueuePersonalPut, enqueuePersonalDelete, listPersonalOutbox } from "./personalOutbox.js";
import { createPersonalSyncApi } from "./personalSyncApi.js";
import { createPersonalSyncEngine } from "./personalSyncEngine.js";
import { ids, scope, timer, serverTimer, fakeAuth, fakeLocks, mockServer, response } from "./testSupport/fixtures.js";
let auth, server, time, locks;
beforeEach(async () => { await timerDb.delete(); await timerDb.open(); auth=fakeAuth(); server=mockServer(); time=1000; locks=fakeLocks(); });
after(() => timerDb.close());

test("legacy untyped 404 conflict is reclassified without rewriting its frozen body",async()=>{
  await create(); await engine(async()=>response(404,{})).flush();
  const op=(await queue())[0]; await timerDb.personalOutbox.update(op.seq,{status:"conflict"});
  await engine().flush(); assert.equal((await queue())[0].status,"retry");
  assert.equal((await queue())[0].body,op.body); time+=6000;
  assert.equal((await engine().flush()).acknowledged,1);
});
for(const [label,change] of [
  ["mutation",row=>({...row,last_sync_mutation_id:ids.second})],
  ["revision",row=>({...row,sync_revision:9})],
  ["canonical state",row=>({...row,name:"Different"})],
]) test(`ACK evidence rejects different ${label}`,async()=>{
  await create(); await engine(async(...args)=>{await server.request(...args);throw Error("lost");}).flush();
  const op=(await queue())[0]; await timerDb.personalOutbox.update(op.seq,{status:"conflict"});
  server.rows.set(ids.timer,change(server.rows.get(ids.timer)));
  assert.equal((await engine().flush()).acknowledged,0);
  assert.equal((await queue()).length,1); assert.equal((await timerDb.timers.get(ids.timer)).name,"Work");
});
test("server-deleted local edit is kept until explicit reviewed acceptance",async()=>{
  await create(); await engine().flush(); await enqueuePersonalPut(timer({name:"Keep local"}),scope);
  server.rows.set(ids.timer,serverTimer({record_status:"deleted",sync_revision:2}));
  const e=engine(); await e.flush(); assert.equal((await queue()).length,1);
  assert.equal((await timerDb.timers.get(ids.timer)).name,"Keep local");
  const review=await e.review(ids.timer); assert.equal(review.kind,"terminal");
  assert.equal((await e.acceptServer(review)).status,"resolved");
  assert.equal((await timerDb.timers.get(ids.timer)).syncState,"deleted");
});
test("confirmation from previous session cannot alter a new session's queue",async()=>{
  await create(); server.rows.set(ids.timer,serverTimer({sync_revision:9}));
  const e=engine(); await e.flush(); const review=await e.review(ids.timer);
  auth.state.identity="new-login"; auth.state.marker="new-marker";
  assert.equal((await e.acceptServer(review)).status,"session-changed");
  assert.equal((await queue()).length,1);
});
test("typed timer denial is not recognized with wrong HTTP status",async()=>{
  await create(); await engine(async()=>response(404,{code:"PERSONAL_TIMER_FORBIDDEN"})).flush();
  assert.equal((await queue())[0].status,"retry");
  assert.equal((await queue())[0].error.code,"http-error");
});
const create = changes => enqueuePersonalPut(timer(changes),scope,{isNew:true});
const queue = () => listPersonalOutbox(scope);
const engine = (request=server.request) => createPersonalSyncEngine({api:createPersonalSyncApi({auth,request,baseUrl:"https://mock.invalid"}),locks,now:()=>time,online:()=>true});

test("untyped infrastructure 404 retries after reopen with identical identity",async()=>{
  await create(); const e=engine(async()=>response(404,{})); await e.flush();
  const first=(await queue())[0]; assert.equal(first.status,"retry");
  timerDb.close(); await timerDb.open(); time+=6000;
  assert.equal((await engine().flush()).acknowledged,1);
  assert.equal(server.requests[0].body,first.body);
});
for(const [http,code,state] of [[403,"PERSONAL_TIMER_FORBIDDEN","forbidden"],[500,null,"retry"],[408,null,"retry"],[404,"PERSONAL_TIMER_NOT_FOUND","conflict"]])
test(`record HTTP ${http}/${code} allows independent timer and pull`,async()=>{
  await create(); await create({id:ids.second});
  const e=engine((url,opts)=>opts.method!=="GET" && url.endsWith(ids.timer)?response(http,{code}):server.request(url,opts));
  assert.equal((await e.flush()).acknowledged,1);
  assert.equal((await queue())[0].status,state);
  assert.equal((await e.pull()).status,"done");
  time+=6000; await e.flush(); assert.equal((await timerDb.timers.get(ids.second)).syncState,"synced");
});
for(const code of [undefined,"PERSONAL_WORKSPACE_REQUIRED"])
test(`global 403 ${code} stops all writes without dropping work`,async()=>{
  await create(); await create({id:ids.second}); let calls=0;
  const e=engine(async()=>{calls++;return response(403,{code});});
  assert.equal((await e.flush()).status,"forbidden"); await e.flush();
  assert.equal(calls,1); assert.equal((await queue()).length,2);
});
for(const kind of ["orphan","method","payload","foreign-local","frozen-body","invalid-key"])
test(`quarantine ${kind} without blocking another timer or touching foreign data`,async()=>{
  await create(); await create({id:ids.second}); const first=(await queue())[0];
  if(kind==="orphan") await timerDb.timers.delete(ids.timer);
  if(kind==="method") await timerDb.personalOutbox.update(first.seq,{method:"PATCH"});
  if(kind==="payload") await timerDb.personalOutbox.update(first.seq,{payload:{}});
  if(kind==="foreign-local") await timerDb.timers.update(ids.timer,{userId:ids.other});
  if(kind==="frozen-body") await timerDb.personalOutbox.update(first.seq,{body:'{"dataMode":"shared"}',expectedRevision:0});
  if(kind==="invalid-key") await timerDb.personalOutbox.update(first.seq,{timerId:null});
  assert.equal((await engine().flush()).acknowledged,1);
  assert.equal((await queue())[0].status,"error");
  assert.equal(server.requests.filter(r=>r.method==="PUT").length,1);
  if(kind==="foreign-local") assert.equal((await timerDb.timers.get(ids.timer)).syncState,"pending");
});
test("blocked edits compact only unsent tail; frozen head and final delete survive",async()=>{
  await create(); server.rows.set(ids.timer,serverTimer({sync_revision:9})); await engine().flush();
  const frozen=(await queue())[0];
  for(let i=0;i<30;i++) await enqueuePersonalPut(timer({name:`Edit ${i}`}),scope);
  const rows=await queue(); assert.equal(rows.length,2); assert.equal(rows[0].body,frozen.body);
  assert.equal(rows[0].mutationId,frozen.mutationId); assert.equal(rows[1].payload.name,"Edit 29");
  await enqueuePersonalDelete(ids.timer,scope); assert.equal((await queue()).at(-1).method,"DELETE");
});
test("blocked deletes share one snapshot and respect persistent reconciliation cooldown",async()=>{
  await create(); await create({id:ids.second}); await engine().flush();
  for(const id of [ids.timer,ids.second]) {
    await enqueuePersonalPut(timer({id,name:"Offline"}),scope); await enqueuePersonalDelete(id,scope);
    server.rows.set(id,serverTimer({id,sync_revision:9}));
  }
  let pages=0;
  const request=(url,opts)=>{if(url.includes("syncPage=1")) pages++;return server.request(url,opts);};
  await engine(request).flush(); assert.equal(pages,2); // One full snapshot, including terminal page.
  await engine(request).flush(); assert.equal(pages,2);
  time+=61000; await engine(request).flush(); assert.equal(pages,4);
});
test("confirmed ACK evidence heals persisted conflict but never a different mutation",async()=>{
  await create(); await engine(async(...args)=>{await server.request(...args); throw Error("lost");}).flush();
  const first=(await queue())[0]; await timerDb.personalOutbox.update(first.seq,{status:"conflict"});
  assert.equal((await engine().flush()).acknowledged,1); assert.equal((await queue()).length,0);
});
test("server acceptance needs reviewed unchanged local queue and fresh server revision",async()=>{
  await create(); server.rows.set(ids.timer,serverTimer({name:"Other device",sync_revision:9}));
  const e=engine(); await e.flush(); const review=await e.review(ids.timer);
  assert.equal(review.status,"review"); assert.equal((await queue()).length,1);
  await enqueuePersonalPut(timer({name:"New local intent"}),scope);
  await assert.rejects(e.acceptServer(review),/changed/); assert.equal((await queue()).length,2);
  const next=await e.review(ids.timer); server.rows.set(ids.timer,serverTimer({name:"Raced",sync_revision:10}));
  await assert.rejects(e.acceptServer(next),/changed/); assert.equal((await queue()).length,2);
  assert.equal((await e.acceptServer(await e.review(ids.timer))).status,"resolved");
  assert.equal((await queue()).length,0); assert.equal((await timerDb.timers.get(ids.timer)).name,"Raced");
});
test("absence or foreign proof cannot authorize discarding local work",async()=>{
  await create(); const e=engine();
  await timerDb.personalOutbox.update((await queue())[0].seq,{status:"conflict"});
  assert.equal((await e.review(ids.timer)).status,"unavailable"); assert.equal((await queue()).length,1);
  server.rows.set(ids.timer,serverTimer({user_id:ids.other})); await assert.rejects(e.review(ids.timer));
  assert.equal((await queue()).length,1);
});
