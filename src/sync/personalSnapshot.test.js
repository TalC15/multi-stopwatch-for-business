import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { beforeEach, after, test } from "node:test";
import { timerDb } from "../data/timerDb.js";
import { createPersonalSyncApi } from "./personalSyncApi.js";
import { createPersonalSyncEngine } from "./personalSyncEngine.js";
import { enqueuePersonalPut, listPersonalOutbox, importPersonalSnapshot } from "./personalOutbox.js";
import { serverTimer, ids, scope, fakeAuth, fakeLocks, response, timer } from "./testSupport/fixtures.js";
let auth;
beforeEach(async () => { await timerDb.delete(); await timerDb.open(); auth = fakeAuth(); });
after(() => timerDb.close());
const api = request => createPersonalSyncApi({ auth, request, baseUrl: "https://mock.invalid" });
const engine = transport => createPersonalSyncEngine({ api: transport, locks: fakeLocks() });
const terminal = changes => ({ id: ids.timer, user_id: ids.user, workspace_id: ids.workspace, is_shared: false,
  record_status: "deleted", archived_at: null, sync_revision: 3, ...changes });

test("paged pull follows short pages to empty and imports all active and terminal rows", async () => {
  await importPersonalSnapshot([serverTimer()], scope, () => {});
  const pages = [
    { timers: [], tombstones: [terminal()], nextCursor: ids.timer },
    { timers: [serverTimer({ id: ids.second })], tombstones: [], nextCursor: ids.second },
    { timers: [], tombstones: [], nextCursor: null },
  ];
  const paths = [];
  const result = await engine(api(async url => { paths.push(url); return response(200, pages.shift()); })).pull();
  assert.equal(result.status, "done"); assert.equal(paths.length, 3);
  assert.ok(paths[1].endsWith(`after=${ids.timer}`));
  assert.equal((await timerDb.timers.get(ids.timer)).syncDeleted, true);
  assert.equal((await timerDb.timers.get(ids.second)).syncRevision, 1);
});

test("failed second page cannot partially import or hide any local record", async () => {
  await importPersonalSnapshot([serverTimer()], scope, () => {});
  let call = 0;
  await assert.rejects(engine(api(async () => ++call === 1 ? response(200, { timers: [], tombstones: [terminal()], nextCursor: ids.timer }) : response(503, {}))).pull());
  assert.equal((await timerDb.timers.get(ids.timer)).syncDeleted, false);
});

test("absent IDs in an empty page do not delete clean local records", async () => {
  await importPersonalSnapshot([serverTimer()], scope, () => {});
  await engine(api(async () => response(200, { timers: [], tombstones: [], nextCursor: null }))).pull();
  assert.equal((await timerDb.timers.get(ids.timer)).syncDeleted, false);
});

test("terminal row cannot erase pending, unbased or newer local data", async () => {
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  const result = await importPersonalSnapshot([], scope, () => {}, [terminal()]);
  assert.deepEqual(result.preserved, [ids.timer]);
  assert.equal((await listPersonalOutbox(scope)).length, 1);
  assert.equal((await timerDb.timers.get(ids.timer)).syncDeleted, false);
  await timerDb.personalOutbox.clear();
  await timerDb.timers.update(ids.timer, { syncRevision: 4, syncState: "synced" });
  await importPersonalSnapshot([], scope, () => {}, [terminal()]);
  assert.equal((await timerDb.timers.get(ids.timer)).syncDeleted, false);
});

test("explicit archive marker hides only its clean, correctly scoped local timer", async () => {
  await importPersonalSnapshot([serverTimer()], scope, () => {});
  await assert.rejects(importPersonalSnapshot([], scope, () => {}, [terminal({ user_id: ids.other })]));
  await importPersonalSnapshot([], scope, () => {}, [terminal({ record_status: "active", archived_at: "2026-09-27T00:00:00Z" })]);
  assert.equal((await timerDb.timers.get(ids.timer)).syncDeleted, true);
});

for (const [label, value] of [
  ["old backend without paging contract", { timers: [] }],
  ["nonprogressing cursor", { timers: [serverTimer()], tombstones: [], nextCursor: ids.second }],
  ["duplicate ID", { timers: [serverTimer(), serverTimer()], tombstones: [], nextCursor: ids.timer }],
  ["wrong scope", { timers: [serverTimer({ workspace_id: ids.otherWorkspace })], tombstones: [], nextCursor: ids.timer }],
]) test(`snapshot rejects ${label} without importing`, async () => {
  await assert.rejects(engine(api(async () => response(200, value))).pull());
  assert.equal(await timerDb.timers.count(), 0);
});

test("session change between pages prevents import of old-account data", async () => {
  let call = 0;
  const result = await engine(api(async () => {
    if (++call === 1) return response(200, { timers: [serverTimer()], tombstones: [], nextCursor: ids.timer });
    auth.state.identity = "new-login";
    return response(200, { timers: [], tombstones: [], nextCursor: null });
  })).pull();
  assert.equal(result.status, "session-changed"); assert.equal(await timerDb.timers.count(), 0);
});
