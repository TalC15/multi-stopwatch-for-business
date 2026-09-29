import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { timerDb } from "../data/timerDb.js";
import { enqueuePersonalPut } from "./personalOutbox.js";
import { scope, timer } from "./testSupport/fixtures.js";
const script=await readFile(new URL("../../scripts/personal-sync-diagnostic.js",import.meta.url),"utf8");
test("Android diagnostic uses only readonly transactions and exposes no private fields",async()=>{
  await timerDb.delete(); await timerDb.open();
  await enqueuePersonalPut(timer({name:"SECRET_NAME"}),scope,{isNew:true});
  const op=await timerDb.personalOutbox.toArray();
  await timerDb.personalOutbox.update(op[0].seq,{error:{code:"SECRET_TOKEN",httpStatus:409},body:"SECRET_BODY"});
  const before=await timerDb.personalOutbox.toArray();
  const modes=[], logs=[];
  const real=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(...args){modes.push(args[1]);return real.apply(this,args);};
  try {
    await vm.runInNewContext(script,{indexedDB,console:{table:rows=>logs.push(rows),info:value=>logs.push(value)}});
  } finally {IDBDatabase.prototype.transaction=real;}
  assert.deepEqual(modes,["readonly"]);
  const printed=JSON.stringify(logs);
  for(const secret of ["SECRET_NAME","SECRET_TOKEN","SECRET_BODY",scope.userId,scope.workspaceId,op[0].timerId,op[0].mutationId]) assert.equal(printed.includes(secret),false);
  assert.deepEqual(await timerDb.personalOutbox.toArray(),before); await timerDb.delete();
});
test("Android diagnostic does not create a missing database",async()=>{
  let opens=0;
  await vm.runInNewContext(script,{indexedDB:{databases:async()=>[],open:()=>{opens++;}},console:{info(){}}});
  assert.equal(opens,0);
});
