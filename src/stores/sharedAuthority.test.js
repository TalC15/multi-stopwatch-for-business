import "fake-indexeddb/auto";
import test, { beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { timerDb } from "../data/timerDb.js";
import { createStopwatchController } from "./stopwatchController.js";
import { validateSharedEnvelope } from "../services/sharedApi.js";
import {
  ids,
  fakeAuth,
  serverTimer,
  deferred,
} from "../sync/testSupport/fixtures.js";
let c,
  env,
  auth,
  rows,
  calls,
  notifications,
  warnings,
  events,
  receive,
  connected,
  generation;
const reply = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const get = () => c.stopwatches.value.find((t) => t.id === ids.timer);
const envelope = (fields) => ({
  protocol: 5,
  workspaceId: ids.workspace,
  generation: String(generation),
  serverNow: new Date(env.serverTime).toISOString(),
  success: true,
  ...fields,
});
const settle = async () => {
  await new Promise((r) => setImmediate(r));
  await c.loadSharedTimers();
  await new Promise((r) => setImmediate(r));
};
function updateServer(changes) {
  const old = rows.get(ids.timer);
  generation++;
  Object.assign(old, changes, {
    shared_revision: String(BigInt(old.shared_revision) + 1n),
  });
}
beforeEach(async () => {
  await timerDb.delete();
  await timerDb.open();
  auth = fakeAuth();
  generation = 1;
  env = {
    online: true,
    wall: Date.parse("2026-09-28T00:00:00Z"),
    mono: 0,
    serverTime: Date.parse("2026-09-28T00:00:00Z"),
    commands: 0,
  };
  rows = new Map([
    [
      ids.timer,
      serverTimer({
        is_shared: true,
        shared_revision: "1",
        target_minutes: 1,
        status: "running",
        ends_at: new Date(env.serverTime + 60000).toISOString(),
        accumulated_ms: 0,
        is_pay: false,
      }),
    ],
  ]);
  calls = [];
  notifications = [];
  warnings = [];
  events = new EventTarget();
  const backend = {
    ...auth,
    AUTH_LOCAL_LOGOUT_EVENT: "logout",
    AUTH_SESSION_CHANGED_EVENT: "login",
    AUTH_USER_CHANGED_EVENT: "user",
    AUTH_LOGIN_REQUIRED_EVENT: "invalid",
    async apiFetch(url, options) {
      calls.push({ url, options });
      if (options.method === "GET") {
        if (env.getError) return reply(env.getError, {});
        const data = structuredClone(
          envelope({ timers: [...rows.values()], complete: true }),
        );
        if (env.getGate) {
          env.getGate.entered.resolve();
          await env.getGate.release.promise;
        }
        return reply(200, env.snapshotOverride ?? data);
      }
      env.commands++;
      const body = JSON.parse(options.body);
      if (env.postGate) {
        env.postGate.entered.resolve();
        await env.postGate.release.promise;
      }
      if (env.reject) return reply(env.reject, {});
      if (env.rejectStart && body.command === "start")
        return reply(env.rejectStart, {});
      let row = rows.get(body.timerId);
      if (body.command === "create") {
        row = serverTimer({
          id: body.timerId,
          is_shared: true,
          name: body.name,
          type: body.type,
          target_minutes: body.targetMinutes,
          shared_revision: "0",
        });
        rows.set(row.id, row);
      } else if (row.shared_revision !== body.expectedRevision)
        return reply(409, {});
      if (body.command === "pause")
        Object.assign(row, {
          status: "paused",
          accumulated_ms:
            row.target_minutes * 60000 -
            (Date.parse(row.ends_at) - env.serverTime),
          ends_at: null,
          paused_count: row.paused_count + 1,
        });
      if (body.command === "start")
        Object.assign(row, {
          status: "running",
          ends_at: new Date(
            env.serverTime + row.target_minutes * 60000 - row.accumulated_ms,
          ).toISOString(),
        });
      if (body.command === "set-pay") row.is_pay = body.value;
      if (body.command === "delete") row.record_status = "deleted";
      row.shared_revision = String(BigInt(row.shared_revision) + 1n);
      generation++;
      const data = structuredClone(
        envelope({ timer: row, mutationId: body.mutationId }),
      );
      if (env.ackLost) throw new TypeError("ACK lost");
      if (env.ackGate) {
        env.ackGate.entered.resolve();
        await env.ackGate.release.promise;
      }
      return reply(200, data);
    },
  };
  c = createStopwatchController({
    backend,
    online: () => env.online,
    now: () => env.wall,
    monotonicNow: () => env.mono,
    socket: {
      onTimerEvent: (cb) => {
        receive = cb;
        return () => {};
      },
      onSocketConnected: (cb) => {
        connected = cb;
        return () => {};
      },
    },
    engine: {
      flush: async () => ({ status: "offline" }),
      pull: async () => ({ status: "offline" }),
    },
    notify: (...args) => notifications.push(args),
    cancelSound: () => {},
    haptic: () => {},

    message: {
      warning: (t) => warnings.push(t),
      error: (t) => warnings.push(t),
      success: () => {},
      loading: () => Symbol("loading"),
      dismiss: () => {},
    },
    events,
    document: new EventTarget(),
    storage: { getItem: () => null },
    setInterval: () => 1,
    clearInterval: () => {},
  });
  await c.initialize();
  await c.loadSharedTimers();
});
afterEach(async () => {
  c.dispose();
  await new Promise((r) => setImmediate(r));
});
after(() => timerDb.close());

test("A running / B offline rejects pause, pay, delete, create; reconnect never rewinds A", async () => {
  env.online = false;
  events.dispatchEvent(new Event("offline"));
  assert.equal(await c.pauseTimer(ids.timer), false);
  assert.equal(await c.updateIsPay(ids.timer, true), false);
  assert.equal(await c.deleteTimer({ id: ids.timer }), false);
  assert.equal(
    await c.addTimer({
      name: "Shared",
      type: "up",
      duration: 1,
      isShared: true,
    }),
    null,
  );
  assert.equal(env.commands, 0);
  assert.equal(get().status, "running");
  assert.equal(rows.get(ids.timer).status, "running");
  assert.equal(warnings.length, 1);
  assert.equal(await timerDb.personalOutbox.count(), 0);
  env.serverTime += 15000;
  env.mono += 15000;
  env.wall += 15000;
  env.online = true;
  connected();
  await settle();
  assert.equal(get().status, "running");
  assert.equal(get().elapsed, 15000);
  assert.equal(env.commands, 0);
});
test("shared read-only does not block personal or standalone writes", async () => {
  env.online = false;
  events.dispatchEvent(new Event("offline"));
  const personal = await c.addTimer({
    name: "Personal",
    type: "up",
    duration: 1,
  });
  assert.ok(personal);
  assert.equal(await c.startTimer(personal), true);
  assert.equal(await timerDb.personalOutbox.count(), 2);
  auth.state.user.workspace_id = null;
  await c.initialize();
  const local = await c.addTimer({ name: "Local", type: "down", duration: 1 });
  assert.ok(local);
  assert.equal(await c.startTimer(local), true);
  assert.equal((await timerDb.timers.get(local)).dataMode, "standalone");
  assert.equal(env.commands, 0);
});
test("REST failure despite online leaves shared read-only; a socket connect alone cannot authorize writes", async () => {
  env.getError = 503;
  connected();
  await settle();
  assert.equal(c.sharedState.value, "unavailable");
  assert.equal(await c.pauseTimer(ids.timer), false);
  assert.equal(get().status, "running");
  assert.equal(env.commands, 0);
  delete env.getError;
  await c.loadSharedTimers();
  assert.equal(c.sharedWritable.value, true);
});
test("a GET started online cannot reopen shared controls after the device goes offline", async () => {
  env.getGate = { entered: deferred(), release: deferred() };
  const pending = c.loadSharedTimers();
  await env.getGate.entered.promise;
  env.online = false;
  events.dispatchEvent(new Event("offline"));
  env.getGate.release.resolve();
  await pending;
  assert.equal(c.sharedState.value, "offline-readonly");
  assert.equal(c.sharedWritable.value, false);
  assert.equal(await c.pauseTimer(ids.timer), false);
  assert.equal(env.commands, 0);
  assert.equal(get().status, "running");
});
test("a stale online client receives 409, reconciles, and only an explicit next command uses the new revision", async () => {
  updateServer({ is_pay: true });
  assert.equal(await c.pauseTimer(ids.timer), false);
  assert.equal(env.commands, 1);
  assert.equal(get().sharedRevision, "2");
  assert.equal(get().status, "running");
  assert.equal(get().isPay, true);
  assert.equal(await c.pauseTimer(ids.timer), true);
  assert.equal(env.commands, 2);
  const requests = calls
    .filter((call) => call.options.method === "POST")
    .map((call) => JSON.parse(call.options.body));
  assert.deepEqual(
    requests.map((r) => r.expectedRevision),
    ["1", "2"],
  );
  assert.notEqual(requests[0].mutationId, requests[1].mutationId);
});
test("confirmed shared create auto-starts even while its socket GET is reconciling", async () => {
  env.ackGate = { entered: deferred(), release: deferred() };
  env.getGate = { entered: deferred(), release: deferred() };
  const creating = c.addTimer({
    name: "Auto",
    type: "up",
    duration: 1,
    isShared: true,
    autoStart: true,
  });
  await env.ackGate.entered.promise;
  const id = [...rows.keys()].find((key) => key !== ids.timer);
  assert.ok(id);
  receive({ event: "created", data: envelope({ timer: rows.get(id) }) });
  await env.getGate.entered.promise;
  assert.equal(c.sharedState.value, "reconciling");
  env.ackGate.release.resolve();
  const result = await creating;
  assert.deepEqual(result, { id, started: true });
  const sent = calls
    .filter((call) => call.options.method === "POST")
    .map((call) => JSON.parse(call.options.body));
  assert.deepEqual(
    sent.map((body) => body.command),
    ["create", "start"],
  );
  assert.equal(sent[1].expectedRevision, "1");
  assert.notEqual(sent[0].mutationId, sent[1].mutationId);
  assert.equal(rows.get(id).status, "running");
  assert.equal(await timerDb.personalOutbox.count(), 0);
  env.getGate.release.resolve();
  delete env.getGate;
  await settle();
  assert.equal(c.stopwatches.value.find((t) => t.id === id).status, "running");
});

test("failed shared auto-start keeps confirmed create and never replays START", async () => {
  env.rejectStart = 409;
  const result = await c.addTimer({
    name: "Rejected",
    type: "up",
    duration: 1,
    isShared: true,
    autoStart: true,
  });
  assert.ok(result?.id);
  assert.equal(result.started, false);
  assert.equal(rows.get(result.id).status, "idle");
  assert.deepEqual(
    calls
      .filter((call) => call.options.method === "POST")
      .map((call) => JSON.parse(call.options.body).command),
    ["create", "start"],
  );
  assert.equal(await timerDb.personalOutbox.count(), 0);
  connected();
  await settle();
  assert.equal(env.commands, 2); // Never retry a write as a side effect of GET/socket.
  assert.equal(
    c.stopwatches.value.find((t) => t.id === result.id).status,
    "idle",
  );
});

test("going offline after confirmed shared CREATE blocks automatic START", async () => {
  env.ackGate = { entered: deferred(), release: deferred() };
  const creating = c.addTimer({
    name: "Offline",
    type: "down",
    duration: 1,
    isShared: true,
    autoStart: true,
  });
  await env.ackGate.entered.promise;
  env.online = false;
  events.dispatchEvent(new Event("offline"));
  env.ackGate.release.resolve();
  const result = await creating;
  assert.ok(result?.id);
  assert.equal(result.started, false);
  assert.equal(env.commands, 1);
  assert.equal(rows.get(result.id).status, "idle");
  assert.equal(await timerDb.personalOutbox.count(), 0);
});

test("lost CREATE acknowledgment never sends an automatic START", async () => {
  env.ackLost = true;
  const result = await c.addTimer({
    name: "Unknown",
    type: "up",
    duration: 1,
    isShared: true,
    autoStart: true,
  });
  assert.equal(result, null);
  assert.equal(env.commands, 1);
  const created = [...rows.values()].find((t) => t.name === "Unknown");
  assert.equal(created?.status, "idle");
  assert.equal(await timerDb.personalOutbox.count(), 0);
});

test("changed session during confirmed create cannot dispatch automatic START", async () => {
  env.ackGate = { entered: deferred(), release: deferred() };
  const creating = c.addTimer({
    name: "Stale",
    type: "up",
    duration: 1,
    isShared: true,
    autoStart: true,
  });
  await env.ackGate.entered.promise;
  auth.state.generation++;
  env.ackGate.release.resolve();
  assert.equal(await creating, null);
  assert.equal(env.commands, 1);
  assert.equal(await timerDb.personalOutbox.count(), 0);
});
test("same-session access-token refresh during ACK does not reject an accepted canonical command", async () => {
  env.ackGate = { entered: deferred(), release: deferred() };
  const pending = c.pauseTimer(ids.timer);
  await env.ackGate.entered.promise;
  auth.state.access = "access-new";
  env.ackGate.release.resolve();
  assert.equal(await pending, true);
  assert.equal(get().status, "paused");
});
test("socket loss alone does not block REST-confirmed commands", async () => {
  // No socket connection was ever required by this fixture; HTTP remains available.
  assert.equal(c.sharedWritable.value, true);
  assert.equal(await c.pauseTimer(ids.timer), true);
  assert.equal(env.commands, 1);
});
test("a reload cannot resurrect a revisioned tombstone from an older canonical event", async () => {
  const old = structuredClone(envelope({ timer: rows.get(ids.timer) }));
  updateServer({ record_status: "deleted" });
  await c.loadSharedTimers();
  auth.state.generation++;
  env.getError = 503;
  await c.initialize();
  receive({ event: "updated", data: old });
  await settle();
  assert.equal(get(), undefined);
  assert.equal((await timerDb.timers.get(ids.timer)).syncDeleted, true);
});
test("cached shared clock offset survives session reopen while GET is unavailable", async () => {
  env.wall += 3600000;
  await c.loadSharedTimers();
  assert.equal(get().elapsed, 0);
  auth.state.generation++;
  env.getError = 503;
  await c.initialize();
  await c.loadSharedTimers();
  await c.tick();
  assert.equal(get().elapsed, 0);
  assert.equal(notifications.length, 0);
  assert.equal(c.sharedWritable.value, false);
});
test("in-flight command has no optimistic pause and repeated click sends no second request", async () => {
  env.postGate = { entered: deferred(), release: deferred() };
  const pending = c.pauseTimer(ids.timer);
  await env.postGate.entered.promise;
  assert.equal(get().status, "running");
  assert.equal(await c.pauseTimer(ids.timer), false);
  assert.equal(env.commands, 1);
  env.postGate.release.resolve();
  assert.equal(await pending, true);
  assert.equal(get().status, "paused");
});
for (const cmd of ["pause", "delete", "create"])
  test(`lost ${cmd} ACK reconciles accepted state without command replay`, async () => {
    env.ackLost = true;
    const outcome =
      cmd === "pause"
        ? await c.pauseTimer(ids.timer)
        : cmd === "delete"
          ? await c.deleteTimer({ id: ids.timer })
          : await c.addTimer({
              name: "New",
              type: "up",
              duration: 1,
              isShared: true,
            });
    assert.equal(Boolean(outcome), false);
    assert.equal(env.commands, 1);
    assert.equal(await timerDb.personalOutbox.count(), 0);
    assert.equal(c.sharedWritable.value, true);
    if (cmd === "pause") assert.equal(get().status, "paused");
    if (cmd === "delete") assert.equal(get(), undefined);
    if (cmd === "create")
      assert.ok(c.stopwatches.value.some((t) => t.name === "New"));
    connected();
    await settle();
    assert.equal(env.commands, 1);
  });
test("explicit retry of uncertain create reuses its UUID and mutation if GET preceded the late commit", async () => {
  env.ackLost = true;
  env.snapshotOverride = envelope({
    complete: true,
    timers: [...rows.values()],
  });
  assert.equal(
    await c.addTimer({
      name: "Uncertain",
      type: "up",
      duration: 1,
      isShared: true,
    }),
    null,
  );
  assert.equal(env.commands, 1);
  env.ackLost = false;
  delete env.snapshotOverride;
  assert.ok(
    await c.addTimer({
      name: "Uncertain",
      type: "up",
      duration: 1,
      isShared: true,
    }),
  );
  const sent = calls
    .filter((call) => call.options.method === "POST")
    .map((call) => JSON.parse(call.options.body));
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(rows.size, 2);
  assert.equal(await timerDb.personalOutbox.count(), 0);
});
for (const status of [401, 403, 409, 500, 503])
  test(`HTTP ${status} never fabricates command success or offline replay`, async () => {
    env.reject = status;
    assert.equal(await c.pauseTimer(ids.timer), false);
    assert.equal(get().status, "running");
    assert.equal(env.commands, 1);
    if (status === 401) {
      assert.equal(c.sharedState.value, "auth-required");
      assert.match(warnings.at(-1), /Oturum/);
    } else assert.equal(c.sharedWritable.value, true);
    assert.equal(await timerDb.personalOutbox.count(), 0);
  });
for (const changes of [
  { complete: false },
  { timers: null },
  { protocol: 4 },
  { workspaceId: ids.otherWorkspace },
])
  test(`unproven snapshot ${JSON.stringify(changes)} cannot erase cache`, async () => {
    env.snapshotOverride = {
      ...envelope({ complete: true, timers: [] }),
      ...changes,
    };
    assert.equal(await c.loadSharedTimers(), false);
    assert.ok(get());
    assert.ok(await timerDb.timers.get(ids.timer));
    assert.equal(c.sharedWritable.value, false);
  });
for (const success of [false, "missing"])
  test(`snapshot success=${success} cannot remove shared cache`, async () => {
    const original = await timerDb.timers.get(ids.timer);
    env.snapshotOverride = envelope({ complete: true, timers: [], success });
    if (success === "missing") delete env.snapshotOverride.success;
    assert.equal(await c.loadSharedTimers(), false);
    assert.equal(c.sharedWritable.value, false);
    assert.equal(get().status, "running");
    assert.deepEqual(await timerDb.timers.get(ids.timer), original);
  });
test("canonical one-row envelope also requires explicit success=true", () => {
  const row = rows.get(ids.timer);
  for (const success of [false, "missing"]) {
    const response = envelope({ timer: row, success });
    if (success === "missing") delete response.success;
    assert.throws(
      () => validateSharedEnvelope(response, { workspaceId: ids.workspace }),
      /doğrulanamadı/,
    );
  }
});
test("legacy positive but zero-ms shared row fails snapshot validation and keeps last cache", async () => {
  const original = await timerDb.timers.get(ids.timer);
  env.snapshotOverride = envelope({
    complete: true,
    timers: [{ ...rows.get(ids.timer), target_minutes: 1e-12 }],
  });
  assert.equal(await c.loadSharedTimers(), false);
  assert.deepEqual(await timerDb.timers.get(ids.timer), original);
  assert.equal(c.sharedWritable.value, false);
});
test("1005 rows arrive as one complete snapshot; explicit tombstone hides only its scoped row", async () => {
  for (let i = 0; i < 1004; i++) {
    const id = `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    rows.set(id, serverTimer({ id, is_shared: true, shared_revision: "1" }));
  }
  await c.loadSharedTimers();
  assert.equal(c.stopwatches.value.length, 1005);
  updateServer({ record_status: "deleted" });
  await c.loadSharedTimers();
  assert.equal(c.stopwatches.value.length, 1004);
  assert.equal((await timerDb.timers.get(ids.timer)).syncDeleted, true);
});
test("new canonical delete beats delayed PATCH ACK and older snapshot/event without ghost resurrection", async () => {
  env.ackGate = { entered: deferred(), release: deferred() };
  const pending = c.updateIsPay(ids.timer, true);
  await env.ackGate.entered.promise;
  const old = structuredClone(envelope({ timer: rows.get(ids.timer) }));
  updateServer({ record_status: "deleted" });
  receive({ event: "deleted", data: envelope({ timer: rows.get(ids.timer) }) });
  await settle();
  env.ackGate.release.resolve();
  await pending;
  receive({ event: "updated", data: old });
  await settle();
  assert.equal(get(), undefined);
  assert.equal((await timerDb.timers.get(ids.timer)).syncDeleted, true);
});
test("foreign workspace and partial socket events cannot publish state", async () => {
  env.getError = 503;
  receive({ event: "updated", data: { id: ids.timer, status: "paused" } });
  await settle();
  assert.equal(get().status, "running");
  receive({
    event: "deleted",
    data: {
      ...envelope({
        timer: { ...rows.get(ids.timer), record_status: "deleted" },
      }),
      workspaceId: ids.otherWorkspace,
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(get().status, "running");
});
test("server clock offset and a later wall-clock jump do not complete or rewind the canonical shared timer", async () => {
  env.wall += 3600000;
  await c.loadSharedTimers();
  assert.equal(get().elapsed, 0);
  env.wall -= 7200000;
  env.mono += 10000;
  await c.tick();
  assert.equal(get().elapsed, 10000);
  assert.equal(get().status, "running");
  env.mono += 51000;
  env.serverTime += 61000;
  await c.tick();
  assert.equal(get().status, "running");
  assert.equal(notifications.length, 1);
  assert.equal(env.commands, 0);
});
test("a delayed same-generation GET cannot rewind the monotonic server clock estimate", async () => {
  env.getGate = { entered: deferred(), release: deferred() };
  const loading = c.loadSharedTimers();
  await env.getGate.entered.promise;
  env.mono += 10000;
  await c.tick();
  assert.equal(get().elapsed, 10000);
  env.getGate.release.resolve();
  await loading;
  assert.equal(get().elapsed, 10000);
});
test("fractional shared countdown uses the DB integer-millisecond deadline and finishes at zero", async () => {
  updateServer({
    type: "down",
    target_minutes: 0.3333333,
    status: "completed",
    accumulated_ms: 19999,
  });
  await c.loadSharedTimers();
  assert.equal(get().status, "expired");
  assert.equal(get().remaining, 0);
  assert.equal(get().elapsed, 19999);
});
test("countdown tick alarms once without remote mutation; only server snapshot completes it", async () => {
  updateServer({ type: "down" });
  await c.loadSharedTimers();
  env.online = false;
  env.mono += 61000;
  await c.tick();
  await c.tick();
  assert.equal(get().status, "running");
  assert.equal(get().remaining, 0);
  assert.equal(env.commands, 0);
  assert.equal(notifications.length, 1);
  updateServer({ status: "completed", accumulated_ms: 60000 });
  env.online = true;
  env.serverTime += 61000;
  await c.loadSharedTimers();
  assert.equal(get().status, "expired");
  assert.equal(notifications.length, 1);
});
for (const remote of ["pause", "delete"])
  test(`offline local alarm can sound after A ${remote}; B makes no shared write or Telegram request`, async () => {
    env.online = false;
    events.dispatchEvent(new Event("offline"));
    updateServer(
      remote === "pause"
        ? { status: "paused", ends_at: null, accumulated_ms: 1000 }
        : { record_status: "deleted" },
    );
    const verifiedCalls = calls.length;
    env.mono += 61000;
    await c.tick();
    await c.tick();
    assert.equal(notifications.length, 1);
    assert.equal(get().status, "running"); // B has only its last verified state.
    assert.equal(calls.length, verifiedCalls); // No shared POST or legacy Telegram request.
    assert.equal(env.commands, 0);
    assert.equal(await timerDb.personalOutbox.count(), 0);
    assert.equal(
      rows.get(ids.timer).status,
      remote === "pause" ? "paused" : "running",
    );
    env.online = true;
    env.serverTime += 61000;
    await c.loadSharedTimers();
    assert.equal(
      remote === "pause" ? get().status : get(),
      remote === "pause" ? "paused" : undefined,
    );
    assert.equal(notifications.length, 1);
  });
for (const change of ["workspace", "account", "session", "logout"])
  test(`delayed canonical ACK cannot cross ${change}`, async () => {
    env.ackGate = { entered: deferred(), release: deferred() };
    const pending = c.pauseTimer(ids.timer);
    await env.ackGate.entered.promise;
    if (change === "workspace")
      auth.state.user.workspace_id = ids.otherWorkspace;
    if (change === "account") auth.state.user.id = ids.other;
    if (change === "session") auth.state.generation++;
    if (change === "logout") {
      auth.state.current = false;
      auth.state.user = null;
    }
    env.getError = 503;
    await c.initialize();
    env.ackGate.release.resolve();
    assert.equal(await pending, false);
    assert.equal((await timerDb.timers.get(ids.timer)).status, "running");
  });
