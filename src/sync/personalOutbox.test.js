import "fake-indexeddb/auto";
import Dexie from "dexie";
import assert from "node:assert/strict";
import { beforeEach, after, test } from "node:test";
import { timerDb } from "../data/timerDb.js";
import { saveTimer, getWorkspacePersonalTimer, listWorkspacePersonalTimers } from "../data/timerRepository.js";
import { enqueuePersonalPut, enqueuePersonalDelete, listPersonalOutbox, importPersonalSnapshot } from "./personalOutbox.js";
import { personalStateFromLocal, localFromServer, requireUuid } from "./personalSyncModel.js";
import { ids, scope, timer, serverTimer } from "./testSupport/fixtures.js";
const current = () => {};
beforeEach(async () => { await timerDb.delete(); await timerDb.open(); });
after(() => timerDb.close());

test("Dexie v1 upgrades to v2, retaining existing standalone and personal rows", async () => {
  await timerDb.delete();
  const v1 = new Dexie("keeptimer-data");
  v1.version(1).stores({ timers: "id, dataMode, [userId+workspaceId], workspaceId" });
  const old = timer();
  await v1.table("timers").bulkPut([old, timer({ id: ids.second, dataMode: "standalone", userId: null, workspaceId: null })]);
  v1.close();
  await timerDb.open();
  assert.equal(timerDb.verno, 2);
  assert.deepEqual(await timerDb.timers.get(ids.timer), old);
  assert.equal(await timerDb.timers.count(), 2);
  assert.equal(await timerDb.personalOutbox.count(), 0);
});

test("offline create, update and delete survive reopen with monotonic durable sequence", async () => {
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  await enqueuePersonalPut(timer({ name: "Changed" }), scope);
  await enqueuePersonalDelete(ids.timer, scope);
  timerDb.close(); await timerDb.open();
  const rows = await listPersonalOutbox(scope);
  assert.deepEqual(rows.map((row) => row.method), ["PUT", "PUT", "DELETE"]);
  assert.ok(rows[0].seq < rows[1].seq && rows[1].seq < rows[2].seq);
  assert.ok(rows.every((row) => row.expectedRevision === null && row.body === null));
  assert.equal((await timerDb.timers.get(ids.timer)).syncDeleted, true);
  assert.equal(await getWorkspacePersonalTimer(ids.timer, scope), undefined);
  assert.deepEqual(await listWorkspacePersonalTimers(scope), []);
  await assert.rejects(enqueuePersonalPut(timer(), scope), /deleted/);
  await assert.rejects(saveTimer(timer(), scope), /deleted/);
});

for (const action of ["create", "update", "delete"]) {
  test(`outbox add failure rolls back local ${action}`, async () => {
    if (action !== "create") await enqueuePersonalPut(timer(), scope, { isNew: true });
    const before = await timerDb.timers.toArray();
    const queue = await listPersonalOutbox(scope);
    const fail = () => { throw new Error("simulated quota failure"); };
    timerDb.personalOutbox.hook("creating", fail);
    try {
      await assert.rejects(action === "delete" ? enqueuePersonalDelete(ids.timer, scope) :
        enqueuePersonalPut(timer({ name: "New" }), scope, { isNew: action === "create" }), /quota/);
    } finally { timerDb.personalOutbox.hook("creating").unsubscribe(fail); }
    assert.deepEqual(await timerDb.timers.toArray(), before);
    assert.deepEqual(await listPersonalOutbox(scope), queue);
  });
}

for (const [label, changes, context] of [
  ["standalone", { dataMode: "standalone", userId: null, workspaceId: null }, scope],
  ["shared", { dataMode: "shared", isShared: true }, scope],
  ["owner", {}, { ...scope, userId: ids.other }],
  ["workspace", {}, { ...scope, workspaceId: ids.otherWorkspace }],
  ["invalid UUID", { id: "not-a-uuid" }, scope],
]) test(`outbox rejects ${label}`, async () => {
  await assert.rejects(enqueuePersonalPut(timer(changes), context, { isNew: true }));
  assert.equal(await timerDb.timers.count(), 0);
  assert.equal(await timerDb.personalOutbox.count(), 0);
});

test("unknown v1 revision is never guessed; ownership and immutable target cannot change", async () => {
  await saveTimer(timer(), scope);
  await assert.rejects(enqueuePersonalPut(timer(), scope), /revision/);
  await assert.rejects(enqueuePersonalPut(timer(), scope, { isNew: true }), /UUID/);
  await timerDb.timers.clear();
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  await assert.rejects(enqueuePersonalPut(timer({ targetMinutes: 10 }), scope), /immutable/);
  await assert.rejects(enqueuePersonalPut(timer({ type: "down" }), scope), /immutable/);
  await assert.rejects(enqueuePersonalDelete(ids.timer, { ...scope, userId: ids.other }));
});

test("repository resave retains acknowledged metadata instead of resetting revision", async () => {
  await importPersonalSnapshot([serverTimer({ sync_revision: 4 })], scope, current);
  await saveTimer(timer(), scope);
  const saved = await timerDb.timers.get(ids.timer);
  assert.equal(saved.syncRevision, 4);
  assert.equal(saved.syncState, "synced");
});

test("GET never acknowledges queued work or overwrites dirty/unbased/deleted local state", async () => {
  await enqueuePersonalPut(timer({ name: "Offline" }), scope, { isNew: true });
  const result = await importPersonalSnapshot([serverTimer()], scope, current);
  assert.deepEqual(result.preserved, [ids.timer]);
  assert.equal((await timerDb.timers.get(ids.timer)).name, "Offline");
  assert.equal((await listPersonalOutbox(scope)).length, 1);
  await importPersonalSnapshot([], scope, current);
  assert.equal((await listPersonalOutbox(scope)).length, 1);
  await saveTimer(timer({ id: ids.second }), scope);
  assert.deepEqual((await importPersonalSnapshot([serverTimer({ id: ids.second })], scope, current)).preserved, [ids.second]);
});

test("snapshot import is scoped and atomic, rejects bad or duplicate rows", async () => {
  await assert.rejects(importPersonalSnapshot([serverTimer({ user_id: ids.other })], scope, current));
  await assert.rejects(importPersonalSnapshot([serverTimer(), serverTimer()], scope, current));
  await assert.rejects(importPersonalSnapshot([serverTimer()], scope, () => { throw new Error("stale"); }));
  assert.equal(await timerDb.timers.count(), 0);
  assert.deepEqual((await importPersonalSnapshot([serverTimer()], scope, current)).imported, [ids.timer]);
});

test("canonical mapping preserves running millisecond anchor and count-up past target", () => {
  const start = Date.parse("2026-09-26T20:00:00Z");
  const mapped = personalStateFromLocal(timer({ status: "running", startTime: start, accumulatedTime: 400000, elapsed: 900000 }));
  assert.equal(mapped.endsAt, new Date(start - 100000).toISOString());
  assert.equal(mapped.accumulatedMs, 400000);
  assert.equal(mapped.status, "running");
  assert.equal("elapsed" in mapped, false);
  assert.equal("userId" in mapped, false);
  assert.throws(() => personalStateFromLocal(timer({ status: "running", startTime: null })));
  assert.throws(() => personalStateFromLocal(timer({ type: "up", status: "completed" })));
  assert.throws(() => personalStateFromLocal(timer({ type: "down", status: "expired" })), /Completion/);
  assert.equal(personalStateFromLocal(timer({ type: "down", status: "expired", endedAt: new Date(start).toISOString(), durationMs: 300000 })).status, "completed");
  const local = localFromServer(serverTimer({ status: "running", ends_at: new Date(start + 300000).toISOString() }), scope, start + 10000);
  assert.equal(personalStateFromLocal(local).endsAt, new Date(start + 300000).toISOString());
});

for (const changes of [{ targetMinutes: 0 }, { accumulatedTime: -1 }, { accumulatedTime: 1.1 }, { pausedCount: 2147483648 }, { name: " " }, { name: "A".repeat(36) }, { isPay: "false" }]) {
  test(`invalid local state rejects before transaction: ${JSON.stringify(changes)}`, async () => {
    await assert.rejects(enqueuePersonalPut(timer(changes), scope, { isNew: true }));
    assert.equal(await timerDb.personalOutbox.count(), 0);
    assert.equal(await timerDb.timers.count(), 0);
  });
}

test("caller mutations after enqueue cannot change the captured local or wire snapshot", async () => {
  const input = timer(); const context = { ...scope };
  const saving = enqueuePersonalPut(input, context, { isNew: true });
  input.name = "Changed outside transaction"; context.userId = ids.other;
  await saving;
  assert.equal((await timerDb.timers.get(ids.timer)).name, "Work");
  assert.equal((await listPersonalOutbox(scope))[0].payload.name, "Work");
});

test("only canonical lowercase UUIDs are accepted at the sync boundary", async () => {
  const letterUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  requireUuid(letterUuid);
  assert.throws(() => requireUuid(letterUuid.toUpperCase()), /UUID/);
  await assert.rejects(enqueuePersonalPut(timer({ id: letterUuid.toUpperCase() }), scope, { isNew: true }), /UUID/);
  assert.equal(await timerDb.personalOutbox.count(), 0);
});

test("timer name boundary accepts 35 characters", () => {
  assert.equal(personalStateFromLocal(timer({ name: "A".repeat(35) })).name.length, 35);
});

test("server running anchor roundtrips when local clock is behind", () => {
  const start = Date.parse("2026-09-26T20:00:00Z");
  const row = serverTimer({ status: "running", ends_at: new Date(start + 300000).toISOString() });
  const local = localFromServer(row, scope, start - 10000);
  assert.equal(personalStateFromLocal(local).endsAt, row.ends_at);
});
