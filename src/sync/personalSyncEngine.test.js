import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { beforeEach, after, test } from "node:test";
import { timerDb } from "../data/timerDb.js";
import { enqueuePersonalPut, enqueuePersonalDelete, listPersonalOutbox } from "./personalOutbox.js";
import { createPersonalSyncApi } from "./personalSyncApi.js";
import { createPersonalSyncEngine } from "./personalSyncEngine.js";
import { ids, scope, timer, serverTimer, fakeAuth, fakeLocks, mockServer, response, deferred } from "./testSupport/fixtures.js";
let auth, server, locks, time;
const api = (request = server.request, timeoutMs = 500) => createPersonalSyncApi({ auth, request, baseUrl: "https://mock.invalid", timeoutMs });
const engine = (transport = api(), options = {}) => createPersonalSyncEngine({ api: transport, locks, now: () => time, online: () => true, ...options });
const create = (changes = {}) => enqueuePersonalPut(timer(changes), scope, { isNew: true });
beforeEach(async () => {
  await timerDb.delete(); await timerDb.open();
  auth = fakeAuth(); server = mockServer(); locks = fakeLocks(); time = 1000;
});
after(() => timerDb.close());

test("create/update/update/delete are ordered, use revisions 0..3 and flat exact bodies", async () => {
  await create();
  await enqueuePersonalPut(timer({ name: "Updated" }), scope);
  await enqueuePersonalPut(timer({ name: "Last", status: "paused", accumulatedTime: 1200 }), scope);
  await enqueuePersonalDelete(ids.timer, scope);
  const result = await engine().flush();
  assert.equal(result.acknowledged, 4);
  const bodies = server.requests.map((req) => JSON.parse(req.body));
  assert.deepEqual(bodies.map((body) => body.expectedRevision), [0, 1, 2, 3]);
  assert.deepEqual(server.requests.map((req) => req.method), ["PUT", "PUT", "PUT", "DELETE"]);
  assert.ok(server.requests.every((req) => req.url.endsWith(`/timers/personal/${ids.timer}`)));
  assert.ok(bodies.every((body) => !body.timer && !body.userId && !body.workspaceId));
  assert.deepEqual(Object.keys(bodies[3]).sort(), ["dataMode", "expectedRevision", "mutationId"]);
  assert.equal(new Set(bodies.map((body) => body.mutationId)).size, 4);
  assert.equal(server.rows.get(ids.timer).record_status, "deleted");
  assert.equal((await listPersonalOutbox(scope)).length, 0);
  const tombstone = await timerDb.timers.get(ids.timer);
  assert.equal(tombstone.syncDeleted, true);
  assert.equal(tombstone.syncRevision, 4);
  assert.equal(tombstone.name, undefined);
  await assert.rejects(enqueuePersonalPut(timer(), scope, { isNew: true }), /deleted/);
});

test("new offline create followed by delete first creates then deletes; no blind 404 success", async () => {
  await create(); await enqueuePersonalDelete(ids.timer, scope);
  assert.equal((await engine().flush()).acknowledged, 2);
  assert.deepEqual(server.requests.map((request) => request.method), ["PUT", "DELETE"]);
});

test("different timer operations are processed with independent revisions", async () => {
  await create(); await create({ id: ids.second });
  await enqueuePersonalPut(timer({ name: "Update" }), scope);
  assert.equal((await engine().flush()).acknowledged, 3);
  assert.deepEqual(server.requests.map((req) => JSON.parse(req.body).expectedRevision), [0, 0, 1]);
});

test("lost response, DB reopen and retry reuse identical wire body before the next update", async () => {
  await create(); await enqueuePersonalPut(timer({ name: "Latest" }), scope);
  const transport = api(async (...args) => { await server.request(...args); throw new Error("connection lost after commit"); });
  assert.equal((await engine(transport).flush()).status, "retry");
  const first = (await listPersonalOutbox(scope))[0];
  assert.equal(first.status, "retry");
  assert.equal(first.expectedRevision, 0);
  assert.equal(server.requests.length, 1);
  timerDb.close(); await timerDb.open();
  assert.equal((await engine().flush()).acknowledged, 0);
  time += 6000;
  assert.equal((await engine().flush()).acknowledged, 2);
  assert.equal(server.requests[0].body, server.requests[1].body);
  assert.equal(JSON.parse(server.requests[2].body).expectedRevision, 1);
  assert.equal((await timerDb.timers.get(ids.timer)).name, "Latest");
});

test("uncertain create followed by delete retries the create before deleting", async () => {
  await create();
  await engine(api(async (...args) => { await server.request(...args); throw new Error("lost"); })).flush();
  await enqueuePersonalDelete(ids.timer, scope);
  time += 6000;
  assert.equal((await engine().flush()).acknowledged, 2);
  assert.deepEqual(server.requests.map((req) => req.method), ["PUT", "PUT", "DELETE"]);
  assert.equal(server.requests[0].body, server.requests[1].body);
});

test("timeout aborts transport and keeps an immutable retriable request", async () => {
  await create();
  let signal;
  const result = await engine(api(async (_url, options) => { signal = options.signal; return new Promise(() => {}); }, 10)).flush();
  assert.equal(result.status, "retry");
  assert.equal(signal.aborted, true);
  const op = (await listPersonalOutbox(scope))[0];
  assert.equal(op.error.code, "timeout");
  assert.ok(op.body);
});

for (const [http, expected] of [[400, "error"], [401, "auth-required"], [403, "forbidden"], [404, "conflict"], [409, "conflict"], [429, "retry"], [500, "retry"], [503, "retry"]]) {
  test(`HTTP ${http} persists ${expected}, never acknowledges and blocks later writes for that timer`, async () => {
    await create(); await enqueuePersonalPut(timer({ name: "Pending" }), scope);
    let puts = 0;
    const transport = api(async (_url, options) => {
      if (options.method === "GET") return response(200, { timers: [] });
      puts += 1; return response(http, {});
    });
    await engine(transport).flush();
    const queue = await listPersonalOutbox(scope);
    assert.equal(queue.length, 2);
    assert.equal(queue[0].status, expected);
    assert.equal(queue[1].body, null);
    assert.equal(puts, 1);
    if ([404, 409].includes(http)) assert.equal(queue[0].server.kind, "absent-from-active-list");
    if ([400, 403, 404, 409].includes(http)) {
      time += 600000; await engine(transport).flush(); assert.equal(puts, 1);
    }
  });
}

test("409 stores current scoped server revision as evidence and continues other timers", async () => {
  await create(); await create({ id: ids.second });
  server.rows.set(ids.timer, serverTimer({ sync_revision: 9 }));
  const result = await engine().flush();
  assert.equal(result.acknowledged, 1);
  const op = (await listPersonalOutbox(scope))[0];
  assert.equal(op.status, "conflict");
  assert.equal(op.server.timer.sync_revision, 9);
  assert.equal((await timerDb.timers.get(ids.timer)).syncRevision, 0);
});

test("DELETE 404 remains a conflict and retains the durable tombstone", async () => {
  await create(); await engine().flush(); await enqueuePersonalDelete(ids.timer, scope);
  server.rows.clear();
  await engine().flush();
  assert.equal((await listPersonalOutbox(scope))[0].status, "conflict");
  assert.equal((await timerDb.timers.get(ids.timer)).syncDeleted, true);
});

test("409 with a confirmed same-scope tombstone resolves queued edits plus final delete atomically", async () => {
  await create(); await engine().flush();
  await enqueuePersonalPut(timer({ name: "Stale edit" }), scope);
  await enqueuePersonalPut(timer({ name: "Later edit" }), scope);
  await enqueuePersonalDelete(ids.timer, scope);
  server.rows.set(ids.timer, { ...server.rows.get(ids.timer), record_status: "deleted", sync_revision: 2 });

  const result = await engine().flush();
  assert.equal(result.status, "done");
  assert.equal(result.resolvedDeletes, 1);
  assert.equal(result.acknowledged, 0); // No PUT/DELETE acknowledgement was fabricated.
  assert.equal((await listPersonalOutbox(scope)).length, 0);
  assert.deepEqual(await timerDb.timers.get(ids.timer), {
    id: ids.timer, dataMode: "workspace-personal", ...scope,
    isShared: false, syncDeleted: true, syncRevision: 2, syncState: "deleted",
  });
  const mutations = server.requests.filter(row => ["PUT", "DELETE"].includes(row.method));
  assert.equal(mutations.length, 2); // Initial create plus stale edit; no stale DELETE sent.
  await engine().pull();
  assert.equal((await timerDb.timers.get(ids.timer)).syncState, "deleted");
});

test("previously persisted conflict heals when user later chooses delete, without disturbing other timers", async () => {
  await create(); await engine().flush();
  await enqueuePersonalPut(timer({ name: "Old edit" }), scope);
  server.rows.set(ids.timer, { ...server.rows.get(ids.timer), record_status: "deleted", sync_revision: 2 });
  assert.equal((await engine().flush()).blocked.length, 1); // Do not discard an edit-vs-delete conflict.
  await enqueuePersonalDelete(ids.timer, scope);
  await create({ id: ids.second });

  const result = await engine().flush();
  assert.equal(result.resolvedDeletes, 1);
  assert.equal(result.acknowledged, 1);
  assert.equal((await listPersonalOutbox(scope)).length, 0);
  assert.equal((await timerDb.timers.get(ids.timer)).syncState, "deleted");
  assert.equal((await timerDb.timers.get(ids.second)).syncState, "synced");
});

for (const [label, alter] of [
  ["wrong owner", row => ({ ...row, user_id: ids.other })],
  ["wrong workspace", row => ({ ...row, workspace_id: ids.otherWorkspace })],
  ["archived row", row => ({ ...row, archived_at: "2026-09-29T00:00:00.000Z" })],
  ["nonterminal row", row => ({ ...row, record_status: "active" })],
  ["nonnewer revision", row => ({ ...row, sync_revision: 1 })],
]) test(`409 never auto-resolves ${label}`, async () => {
  await create(); await engine().flush();
  await enqueuePersonalPut(timer({ name: "Queued" }), scope);
  await enqueuePersonalDelete(ids.timer, scope);
  const tombstone = alter({ ...server.rows.get(ids.timer), record_status: "deleted", sync_revision: 2 });
  server.rows.set(ids.timer, tombstone);
  const transport = api(async (url, options) => options.method === "GET"
    ? server.request(url, options) : response(409, {}));

  const result = await engine(transport).flush();
  assert.equal(result.resolvedDeletes, 0);
  assert.equal((await listPersonalOutbox(scope)).length, 2);
  assert.equal((await listPersonalOutbox(scope))[0].status, "conflict");
  assert.equal((await timerDb.timers.get(ids.timer)).syncState, "conflict");
});

test("409 with unavailable tombstone snapshot keeps both operations intact", async () => {
  await create(); await engine().flush();
  await enqueuePersonalPut(timer({ name: "Queued" }), scope);
  await enqueuePersonalDelete(ids.timer, scope);
  server.rows.set(ids.timer, { ...server.rows.get(ids.timer), record_status: "deleted", sync_revision: 2 });
  const transport = api(async (url, options) => {
    if (url.includes("syncPage=1")) throw new Error("snapshot unavailable");
    return server.request(url, options);
  });
  const result = await engine(transport).flush();
  assert.equal(result.resolvedDeletes, 0);
  assert.equal((await listPersonalOutbox(scope)).length, 2);
  assert.equal((await timerDb.timers.get(ids.timer)).syncState, "conflict");
});

test("logout during tombstone fetch cannot remove pending operations", async () => {
  await create(); await engine().flush();
  await enqueuePersonalPut(timer({ name: "Queued" }), scope);
  await enqueuePersonalDelete(ids.timer, scope);
  server.rows.set(ids.timer, { ...server.rows.get(ids.timer), record_status: "deleted", sync_revision: 2 });
  const entered = deferred(), release = deferred();
  const transport = api(async (url, options) => {
    if (url.includes("syncPage=1")) { entered.resolve(); await release.promise; }
    return server.request(url, options);
  });
  const flushing = engine(transport).flush();
  await entered.promise;
  auth.state.user = null;
  release.resolve();
  assert.equal((await flushing).status, "session-changed");
  assert.equal((await listPersonalOutbox(scope)).length, 2);
  assert.equal((await timerDb.timers.get(ids.timer)).syncDeleted, true);
});

for (const [name, bad] of [
  ["null response", () => null],
  ["empty response", () => response(200, undefined)],
  ["wrong revision", (data) => response(200, { ...data, timer: { ...data.timer, sync_revision: 77 } })],
  ["wrong UUID", (data) => response(200, { ...data, timer: { ...data.timer, id: ids.second } })],
  ["wrong owner", (data) => response(200, { ...data, timer: { ...data.timer, user_id: ids.other } })],
  ["wrong mutation", (data) => response(200, { ...data, timer: { ...data.timer, last_sync_mutation_id: ids.second } })],
  ["wrong state", (data) => response(200, { ...data, timer: { ...data.timer, name: "Wrong" } })],
  ["invalid JSON", () => ({ status: 200, json: async () => { throw new Error("parse"); } })],
  ["204", () => response(204, undefined)],
]) test(`${name} never acknowledges a possibly committed operation`, async () => {
  await create();
  const result = await engine(api(async (...args) => bad(await (await server.request(...args)).json()))).flush();
  assert.equal(result.acknowledged, 0);
  assert.equal((await listPersonalOutbox(scope)).length, 1);
  assert.equal((await timerDb.timers.get(ids.timer)).syncRevision, 0);
});

for (const [name, switchSession] of [
  ["A to B", () => { auth.state.user = { id: ids.other, workspace_id: ids.workspace }; }],
  ["workspace X to Y", () => { auth.state.user.workspace_id = ids.otherWorkspace; }],
  ["stale tab", () => { auth.state.current = false; }],
  ["logout", () => { auth.state.user = null; auth.state.generation += 1; }],
  ["same account new session", () => { auth.state.identity = "session-new"; auth.state.refresh = "refresh-new"; }],
  ["disabled account", () => { auth.state.user.disabled_at = new Date().toISOString(); }],
]) test(`pending response after ${name} cannot acknowledge or send next operation`, async () => {
  await create(); await enqueuePersonalPut(timer({ name: "Next" }), scope);
  const entered = deferred(); const release = deferred();
  const transport = api(async (...args) => { const res = await server.request(...args); entered.resolve(); await release.promise; return res; });
  const flushing = engine(transport).flush();
  await entered.promise; switchSession(); release.resolve();
  assert.equal((await flushing).status, "session-changed");
  assert.equal(server.requests.length, 1);
  assert.equal((await listPersonalOutbox(scope)).length, 2);
  assert.equal((await timerDb.timers.get(ids.timer)).syncRevision, 0);
});

test("new login of same account retries previous session's uncertain operation", async () => {
  await create();
  await engine(api(async (...args) => { const res = await server.request(...args); auth.state.identity = "new"; auth.state.refresh = "new"; return res; })).flush();
  time += 6000;
  assert.equal((await engine().flush()).acknowledged, 1);
  assert.equal(server.requests[0].body, server.requests[1].body);
});

test("invalid tab at flush start sends nothing", async () => {
  await create(); auth.state.current = false;
  assert.equal((await engine().flush()).status, "auth-required");
  assert.equal(server.requests.length, 0);
});

test("other user/workspace queues remain intact and are never sent with current credentials", async () => {
  await create();
  const otherScope = { userId: ids.other, workspaceId: ids.otherWorkspace };
  await enqueuePersonalPut(timer({ id: ids.second, ...otherScope }), otherScope, { isNew: true });
  assert.equal((await engine().flush()).acknowledged, 1);
  assert.equal((await listPersonalOutbox(otherScope)).length, 1);
  assert.equal(server.requests.length, 1);
});

test("two tabs share an exclusive lock; only one sends the queue", async () => {
  await create();
  const entered = deferred(); const release = deferred();
  const first = engine(api(async (...args) => { entered.resolve(); await release.promise; return server.request(...args); })).flush();
  await entered.promise;
  assert.equal((await engine().flush()).status, "busy");
  release.resolve();
  assert.equal((await first).acknowledged, 1);
  assert.equal(server.requests.length, 1);
});

test("unsupported Web Locks and offline mode fail closed without touching queued requests", async () => {
  await create();
  assert.equal((await engine(api(), { locks: null }).flush()).status, "unsupported-locks");
  assert.equal((await engine(api(), { online: () => false }).flush()).status, "offline");
  assert.equal(server.requests.length, 0);
  assert.equal((await listPersonalOutbox(scope))[0].body, null);
});

test("new local edit during an in-flight request survives acknowledgement and waits for next flush", async () => {
  await create();
  const result = await engine(api(async (...args) => {
    await enqueuePersonalPut(timer({ name: "Latest local" }), scope);
    return server.request(...args);
  })).flush();
  assert.equal(result.acknowledged, 1);
  const local = await timerDb.timers.get(ids.timer);
  assert.equal(local.name, "Latest local");
  assert.equal(local.syncRevision, 1);
  assert.equal(local.syncState, "pending");
  assert.equal((await listPersonalOutbox(scope)).length, 1);
  assert.equal((await engine().flush()).acknowledged, 1);
});

test("failed local acknowledgement rolls back queue removal and retries exact request", async () => {
  await create();
  const fail = () => { throw new Error("quota"); };
  const transport = api(async (...args) => { const res = await server.request(...args); timerDb.timers.hook("updating", fail); return res; });
  try { await assert.rejects(engine(transport).flush(), /quota/); }
  finally { timerDb.timers.hook("updating").unsubscribe(fail); }
  assert.equal((await listPersonalOutbox(scope)).length, 1);
  assert.equal((await timerDb.timers.get(ids.timer)).syncRevision, 0);
  time += 6000;
  assert.equal((await engine().flush()).acknowledged, 1);
  assert.equal(server.requests[0].body, server.requests[1].body);
});

test("pull preserves dirty local records and imports clean server records without acknowledging", async () => {
  await create({ name: "Dirty" });
  server.rows.set(ids.timer, serverTimer());
  server.rows.set(ids.second, serverTimer({ id: ids.second }));
  const result = await engine().pull();
  assert.deepEqual(result.preserved, [ids.timer]);
  assert.deepEqual(result.imported, [ids.second]);
  assert.equal((await timerDb.timers.get(ids.timer)).name, "Dirty");
  assert.equal((await listPersonalOutbox(scope)).length, 1);
});

test("editing a conflicted timer retains conflict metadata and never rebases queued work", async () => {
  await create();
  server.rows.set(ids.timer, serverTimer({ sync_revision: 9 }));
  await engine().flush();
  const first = (await listPersonalOutbox(scope))[0];
  await enqueuePersonalPut(timer({ name: "Another local edit" }), scope);
  assert.equal((await timerDb.timers.get(ids.timer)).syncState, "conflict");
  const queue = await listPersonalOutbox(scope);
  assert.equal(queue[0].body, first.body);
  assert.equal(queue[1].expectedRevision, null);
  assert.equal((await engine().flush()).acknowledged, 0);
});
