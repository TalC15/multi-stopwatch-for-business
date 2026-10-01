import { sharedFixture } from "../sync/testSupport/sharedFixture.js";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { beforeEach, afterEach, after, test } from "node:test";
import { timerDb } from "../data/timerDb.js";
import { createStopwatchController } from "./stopwatchController.js";
import { createPersonalSyncApi } from "../sync/personalSyncApi.js";
import { createPersonalSyncEngine } from "../sync/personalSyncEngine.js";
import {
  enqueuePersonalPut,
  enqueuePersonalDelete,
  listPersonalOutbox,
} from "../sync/personalOutbox.js";
import {
  ids,
  scope,
  timer,
  serverTimer,
  fakeAuth,
  fakeLocks,
  mockServer,
  response,
  deferred,
} from "../sync/testSupport/fixtures.js";
let sharedMock,
  controllers,
  auth,
  backend,
  server,
  legacy,
  online,
  clock,
  signals,
  notifications,
  errors,
  successes,
  socketCallback,
  connectedCallback,
  events;
const input = (changes) => ({
  name: "Work",
  type: "up",
  duration: 1,
  isShared: false,
  ...changes,
});
function makeController(request = server.request, overrides = {}) {
  const personalApi = createPersonalSyncApi({
    auth: backend,
    request,
    baseUrl: "https://mock.invalid",
  });
  const engine = createPersonalSyncEngine({
    api: personalApi,
    locks: fakeLocks(),
    now: () => clock,
    online: () => online,
  });
  const controller = createStopwatchController({
    backend,
    engine,
    personalApi,
    sharedApi: sharedMock.api,
    monotonicNow: () => clock,
    socket: {
      onTimerEvent: (callback) => {
        socketCallback = (payload) => sharedMock.event(callback, payload);
        return () => {};
      },
      onSocketConnected: (callback) => {
        connectedCallback = callback;
        return () => {};
      },
    },
    notify: (...args) => {
      notifications.push(args);
    },
    cancelSound: () => {},
    haptic: () => {},
    message: {
      warning: (text) => errors.push(text),
      error: (text) => errors.push(text),
      success: (text) => successes.push(text),
      loading: () => Symbol("loading"),
      dismiss: () => {},
    },
    storage: {
      getItem: (key) =>
        key === "timers"
          ? JSON.stringify([timer({ name: "Legacy should not load" })])
          : null,
    },
    events,
    document: new EventTarget(),
    now: () => clock,
    setInterval: (callback) => {
      signals.push(callback);
      return signals.length;
    },
    clearInterval: () => {},
    ...overrides,
  });
  controllers.push(controller);
  return controller;
}
const settle = async (c) => {
  await c.requestSync();
  await new Promise((resolve) => setImmediate(resolve));
};
beforeEach(async () => {
  await timerDb.delete();
  await timerDb.open();
  controllers = [];
  auth = fakeAuth();
  server = mockServer();
  legacy = [];
  online = false;
  clock = Date.now();
  signals = [];
  notifications = [];
  errors = [];
  successes = [];
  events = new EventTarget();
  backend = {
    ...auth,
    AUTH_LOCAL_LOGOUT_EVENT: "logout",
    AUTH_SESSION_CHANGED_EVENT: "login",
    AUTH_LOGIN_REQUIRED_EVENT: "invalid",
    AUTH_USER_CHANGED_EVENT: "user",
    dbGetSharedTimers: async () => {
      legacy.push("GET shared");
      return [];
    },
    dbCreateTimer: async (row) => {
      legacy.push("POST legacy");
      return {
        success: true,
        timer: serverTimer({
          id: row.id,
          user_id: ids.user,
          workspace_id: ids.workspace,
          is_shared: true,
          target_minutes: row.targetMinutes,
        }),
      };
    },
    dbUpdateTimer: async () => {
      legacy.push("PATCH legacy");
      return { success: true };
    },
    dbDeleteTimer: async () => {
      legacy.push("DELETE legacy");
      return { success: true };
    },
    syncTimerStart: async () => {
      legacy.push("START notification");
    },
    syncTimerCancel: async () => {
      legacy.push("CANCEL notification");
    },
  };
  sharedMock = sharedFixture({ backend, auth, now: () => clock, serverTimer });
});
afterEach(async () => {
  controllers.forEach((c) => c.dispose());
  await new Promise((resolve) => setImmediate(resolve));
});
after(() => timerDb.close());

test("failed deletion proof retries after cooldown and clears warning only with a tombstone", async () => {
  online = true;
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  await enqueuePersonalDelete(ids.timer, scope);
  server.rows.set(
    ids.timer,
    serverTimer({ record_status: "deleted", sync_revision: 2 }),
  );
  const jobs = new Map();
  let serial = 0,
    failSnapshot = true;
  const c = makeController(
    (url, opts) => {
      if (url.includes("syncPage=1") && failSnapshot)
        throw Error("temporary snapshot outage");
      return server.request(url, opts);
    },
    {
      setTimeout: (fn, delay) => {
        jobs.set(++serial, { fn, delay });
        return serial;
      },
      clearTimeout: (id) => jobs.delete(id),
    },
  );
  await c.initialize();
  await settle(c);
  assert.equal(c.syncStatus.value, "conflict");
  assert.equal((await listPersonalOutbox(scope)).length, 2);
  const [id, job] = jobs.entries().next().value;
  assert.ok(job.delay >= 60000);
  failSnapshot = false;
  jobs.delete(id);
  clock += job.delay;
  job.fn();
  await settle(c);
  assert.equal(c.pendingCount.value, 0);
  assert.equal(c.syncIssues.value.length, 0);
  assert.equal((await timerDb.timers.get(ids.timer)).syncState, "deleted");
});

test("bounded scheduled retries respect persistent backoff, background, resume and dispose", async () => {
  online = true;
  const jobs = new Map();
  let serial = 0,
    puts = 0;
  const doc = new EventTarget();
  doc.visibilityState = "visible";
  const c = makeController(
    async (url, opts) => {
      if (opts.method === "PUT") {
        puts++;
        throw Error("offline");
      }
      return server.request(url, opts);
    },
    {
      online: () => online,
      document: doc,
      setTimeout: (fn, delay) => {
        jobs.set(++serial, { fn, delay });
        return serial;
      },
      clearTimeout: (id) => jobs.delete(id),
    },
  );
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  await c.initialize();
  await settle(c);
  const fire = async () => {
    const [id, job] = jobs.entries().next().value;
    jobs.delete(id);
    clock += job.delay;
    job.fn();
    await settle(c);
  };
  assert.equal(puts, 1);
  assert.equal(jobs.size, 1);
  assert.ok([...jobs.values()][0].delay >= 5000);
  doc.visibilityState = "hidden";
  doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(jobs.size, 0);
  doc.visibilityState = "visible";
  doc.dispatchEvent(new Event("visibilitychange"));
  await settle(c);
  for (let i = 0; i < 3; i++) await fire();
  assert.equal(puts, 4);
  assert.equal(jobs.size, 0); // Exhausted until a lifecycle/user trigger.
  events.dispatchEvent(new Event("focus"));
  await settle(c);
  assert.equal(jobs.size, 1);
  online = false;
  events.dispatchEvent(new Event("offline"));
  assert.equal(jobs.size, 0);
  online = true;
  events.dispatchEvent(new Event("online"));
  await settle(c);
  assert.equal(jobs.size, 1);
  const stale = [...jobs.values()][0].fn;
  c.dispose();
  assert.equal(jobs.size, 0);
  const before = puts;
  stale();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(puts, before);
});
test("explicit server acceptance clears only resolved warning; cancel and edits retain work", async () => {
  online = true;
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  server.rows.set(
    ids.timer,
    serverTimer({ name: "Other device", sync_revision: 9 }),
  );
  const c = makeController();
  await c.initialize();
  await settle(c);
  assert.equal(c.syncStatus.value, "conflict");
  assert.equal(c.syncIssues.value[0].name, "Work");
  assert.equal(await c.reviewSyncIssue(ids.timer), true);
  c.cancelSyncReview();
  assert.equal((await listPersonalOutbox(scope)).length, 1);
  await c.reviewSyncIssue(ids.timer);
  assert.equal(await c.acceptSyncServer(), true);
  await settle(c);
  assert.equal(c.syncStatus.value, "done");
  assert.equal(c.syncIssues.value.length, 0);
  assert.equal(c.pendingCount.value, 0);
  assert.equal(c.stopwatches.value[0].name, "Other device");
});
test("record denial does not prevent controller pull or expose another account's timer name", async () => {
  online = true;
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  server.rows.set(ids.second, serverTimer({ id: ids.second }));
  const c = makeController((url, opts) =>
    opts.method === "PUT"
      ? response(403, { code: "PERSONAL_TIMER_FORBIDDEN" })
      : server.request(url, opts),
  );
  await c.initialize();
  await settle(c);
  assert.ok(c.stopwatches.value.some((row) => row.id === ids.second));
  assert.equal(c.syncIssues.value[0].status, "forbidden");
  auth.state.user = { id: ids.other, workspace_id: ids.otherWorkspace };
  events.dispatchEvent(new Event("user"));
  await c.initialize();
  await settle(c);
  assert.equal(c.syncIssues.value.length, 0);
  assert.equal(c.pendingCount.value, 0);
});
test("global auth/permission failures schedule no retry and keep operation visible", async () => {
  for (const http of [401, 403]) {
    await timerDb.personalOutbox.clear();
    await timerDb.timers.clear();
    await enqueuePersonalPut(timer(), scope, { isNew: true });
    online = true;
    const jobs = new Map();
    let serial = 0;
    const c = makeController(async () => response(http, {}), {
      setTimeout: (fn, delay) => {
        jobs.set(++serial, { fn, delay });
        return serial;
      },
      clearTimeout: (id) => jobs.delete(id),
    });
    await c.initialize();
    await settle(c);
    assert.equal(jobs.size, 0);
    assert.equal(c.syncIssues.value.length, 1);
    assert.equal((await listPersonalOutbox(scope)).length, 1);
    c.dispose();
  }
});

test("standalone offline CRUD/payment uses IndexedDB, no outbox or backend timer request", async () => {
  auth.state.user.workspace_id = null;
  const c = makeController();
  await c.initialize();
  assert.equal(c.stopwatches.value.length, 0);
  const id = await c.addTimer(input());
  assert.ok(id);
  assert.equal(await c.startTimer(id), true);
  clock += 5000;
  assert.equal(await c.pauseTimer(id), true);
  assert.equal(await c.updateIsPay(id, true), true);
  const persisted = await timerDb.timers.get(id);
  assert.equal(persisted.accumulatedTime, 5000);
  assert.equal(persisted.isPay, true);
  assert.equal(persisted.dataMode, "standalone");
  assert.equal(await timerDb.personalOutbox.count(), 0);
  assert.deepEqual(legacy, []);
  assert.equal(server.requests.length, 0);
  assert.equal(await c.deleteTimer({ id }, "sayacı"), true);
  assert.equal(await timerDb.timers.get(id), undefined);
  assert.equal(successes.length, 1);
});

test("standalone anchor survives app/DB reopen and continues running without pausing", async () => {
  auth.state.user.workspace_id = null;
  const first = makeController();
  await first.initialize();
  const id = await first.addTimer(input());
  await first.startTimer(id);
  first.dispose();
  timerDb.close();
  await timerDb.open();
  clock += 15000;
  const second = makeController();
  await second.initialize();
  const restored = second.stopwatches.value.find((t) => t.id === id);
  assert.equal(restored.status, "running");
  assert.equal(restored.elapsed, 15000);
  assert.equal(restored.startTime, clock - 15000);
  assert.equal(server.requests.length, 0);
});

test("standalone keeps its mode after joining workspace; new timers become personal", async () => {
  auth.state.user.workspace_id = null;
  const c = makeController();
  await c.initialize();
  const standalone = await c.addTimer(input());
  auth.state.user.workspace_id = ids.workspace;
  events.dispatchEvent(new Event("user"));
  await c.initialize();
  const personal = await c.addTimer(input({ name: "Company" }));
  assert.equal((await timerDb.timers.get(standalone)).dataMode, "standalone");
  assert.equal(
    (await timerDb.timers.get(personal)).dataMode,
    "workspace-personal",
  );
  assert.equal((await listPersonalOutbox(scope)).length, 1);
});

test("all personal actions enqueue atomically offline and never call legacy mutations", async () => {
  const c = makeController();
  await c.initialize();
  const id = await c.addTimer(input());
  await c.startTimer(id);
  clock += 3000;
  await c.pauseTimer(id);
  await c.updateIsPay(id, true);
  await c.deleteTimer({ id }, "sayacı");
  await settle(c);
  const queue = await listPersonalOutbox(scope);
  assert.deepEqual(
    queue.map((op) => op.method),
    ["PUT", "PUT", "PUT", "PUT", "DELETE"],
  );
  assert.equal(queue[2].payload.accumulatedMs, 3000);
  assert.equal(queue[3].payload.isPay, true);
  assert.ok(legacy.every((call) => call === "GET shared"));
  assert.equal(server.requests.length, 0);
  assert.equal(c.stopwatches.value.length, 0);
});

test("failed local save never publishes success; update rollback retains previous UI and DB", async () => {
  const c = makeController();
  await c.initialize();
  const fail = () => {
    throw new Error("quota failure");
  };
  timerDb.personalOutbox.hook("creating", fail);
  assert.equal(await c.addTimer(input()), null);
  assert.equal(c.stopwatches.value.length, 0);
  timerDb.personalOutbox.hook("creating").unsubscribe(fail);
  const id = await c.addTimer(input());
  timerDb.personalOutbox.hook("creating", fail);
  try {
    assert.equal(await c.startTimer(id), false);
    assert.equal(await c.updateIsPay(id, true), false);
    assert.equal(await c.deleteTimer({ id }, "sayacı"), false);
  } finally {
    timerDb.personalOutbox.hook("creating").unsubscribe(fail);
  }
  assert.equal((await timerDb.timers.get(id)).status, "idle");
  assert.equal(c.stopwatches.value[0].isPay, false);
  assert.equal((await listPersonalOutbox(scope)).length, 1);
  assert.equal(successes.length, 0);
});

test("personal queue survives restart and flushes on online event with stable UUID", async () => {
  const first = makeController();
  await first.initialize();
  const id = await first.addTimer(input());
  await first.startTimer(id);
  await settle(first);
  first.dispose();
  timerDb.close();
  await timerDb.open();
  const second = makeController();
  await second.initialize();
  await settle(second);
  assert.equal((await listPersonalOutbox(scope)).length, 2);
  online = true;
  events.dispatchEvent(new Event("online"));
  await settle(second);
  assert.equal((await listPersonalOutbox(scope)).length, 0);
  assert.equal(server.rows.get(id).status, "running");
  assert.equal(
    second.stopwatches.value.find((t) => t.id === id).syncRevision,
    2,
  );
  assert.ok(legacy.every((call) => call === "GET shared"));
});

test("account/workspace switch immediately hides old personal records and preserves their queue", async () => {
  const c = makeController();
  await c.initialize();
  const a = await c.addTimer(input());
  await settle(c);
  auth.state.user = { id: ids.other, workspace_id: ids.otherWorkspace };
  events.dispatchEvent(new Event("user"));
  assert.equal(
    c.stopwatches.value.some((t) => t.id === a),
    false,
  );
  await c.initialize();
  online = true;
  await settle(c);
  assert.equal((await listPersonalOutbox(scope)).length, 1);
  assert.equal(
    server.requests.some((req) => req.method === "PUT"),
    false,
  );
});

test("logout during pending HTTP cannot apply an old result to the new view", async () => {
  const entered = deferred(),
    release = deferred();
  const c = makeController(async (...args) => {
    const res = await server.request(...args);
    if (args[1].method === "PUT") {
      entered.resolve();
      await release.promise;
    }
    return res;
  });
  await c.initialize();
  const id = await c.addTimer(input());
  await settle(c);
  online = true;
  const flushing = c.requestSync();
  await entered.promise;
  events.dispatchEvent(new Event("logout"));
  auth.state.current = false;
  auth.state.user = null;
  release.resolve();
  await flushing;
  await c.initialize();
  assert.equal(
    c.stopwatches.value.some((t) => t.id === id),
    false,
  );
  assert.equal((await listPersonalOutbox(scope)).length, 1);
});

test("count-up persists target notification once and remains running after target", async () => {
  auth.state.user.workspace_id = null;
  const c = makeController();
  await c.initialize();
  const id = await c.addTimer(input());
  await c.startTimer(id);
  clock += 61000;
  await c.tick();
  await c.tick();
  assert.equal((await timerDb.timers.get(id)).status, "running");
  assert.equal(c.stopwatches.value[0].elapsed, 61000);
  assert.equal(notifications.length, 1);
  c.dispose();
  const second = makeController();
  await second.initialize();
  await second.tick();
  assert.equal(notifications.length, 1);
});

test("countdown completes durably at original deadline after offline reopen", async () => {
  const c = makeController();
  await c.initialize();
  const id = await c.addTimer(input({ type: "down" }));
  await c.startTimer(id);
  const start = clock;
  await settle(c);
  c.dispose();
  clock += 90000;
  const second = makeController();
  await second.initialize();
  await second.tick();
  await settle(second);
  const saved = await timerDb.timers.get(id);
  assert.equal(saved.status, "completed");
  assert.equal(saved.durationMs, 60000);
  assert.equal(saved.endedAt, new Date(start + 60000).toISOString());
  assert.equal(second.stopwatches.value[0].status, "expired");
  const queue = await listPersonalOutbox(scope);
  assert.equal(queue.at(-1).payload.status, "completed");
  assert.equal(notifications.length, 1);
});

test("same UUID downloaded on device B, then explicit remote deletion removes only clean local copy", async () => {
  const a = makeController();
  await a.initialize();
  const id = await a.addTimer(input());
  await settle(a);
  online = true;
  await settle(a);
  a.dispose();
  // A new database models device B; server rows remain intact.
  await timerDb.delete();
  await timerDb.open();
  const b = makeController();
  await b.initialize();
  await settle(b);
  assert.equal(b.stopwatches.value[0].id, id);
  const remote = server.rows.get(id);
  remote.record_status = "deleted";
  remote.sync_revision++;
  await settle(b);
  assert.equal(
    b.stopwatches.value.some((t) => t.id === id),
    false,
  );
  assert.equal((await timerDb.timers.get(id)).syncDeleted, true);
});

test("remote deletion plus pending local edit stays a conflict; it never erases the outbox", async () => {
  server.rows.set(ids.timer, serverTimer());
  online = true;
  const c = makeController();
  await c.initialize();
  await settle(c);
  online = false;
  await c.updateIsPay(ids.timer, true);
  await settle(c);
  server.rows.set(ids.timer, {
    ...serverTimer(),
    record_status: "deleted",
    sync_revision: 3,
  });
  online = true;
  await settle(c);
  assert.equal((await listPersonalOutbox(scope)).length, 1);
  assert.equal(c.stopwatches.value[0].isPay, true);
  assert.equal(c.syncStatus.value, "conflict");
});

test("transient sync failure does not roll back successful personal local save", async () => {
  const c = makeController(async () => response(503, {}));
  await c.initialize();
  online = true;
  const id = await c.addTimer(input());
  await settle(c);
  assert.ok(id);
  assert.equal((await timerDb.timers.get(id)).name, "Work");
  assert.equal((await listPersonalOutbox(scope)).length, 1);
  assert.equal(c.syncStatus.value, "retry");
});

test("shared commands and socket updates use existing path and never enter personal outbox", async () => {
  const shared = serverTimer({ id: ids.second, is_shared: true });
  backend.dbGetSharedTimers = async () => [shared];
  backend.dbUpdateTimer = async (_id, update) => {
    legacy.push("PATCH legacy");
    Object.assign(shared, update);
    return { success: true };
  };
  const c = makeController();
  await c.initialize();
  await c.loadSharedTimers();
  assert.equal(c.stopwatches.value[0].dataMode, "shared");
  await c.startTimer(ids.second);
  await c.pauseTimer(ids.second);
  await c.updateIsPay(ids.second, true);
  assert.equal(await timerDb.personalOutbox.count(), 0);
  assert.ok(legacy.includes("PATCH legacy"));
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  await c.initialize();
  await new Promise((resolve) => setTimeout(resolve, 10));
  socketCallback({ event: "deleted", data: { id: ids.timer } });
  assert.equal((await timerDb.timers.get(ids.timer)).syncDeleted, false);
  connectedCallback({ isReconnect: true });
  await c.loadSharedTimers();
  assert.equal((await listPersonalOutbox(scope)).length, 1);
});

test("shared cache and late shared response cannot cross workspace/session boundaries", async () => {
  const gate = deferred();
  backend.dbGetSharedTimers = async () => {
    await gate.promise;
    return [serverTimer({ is_shared: true })];
  };
  const c = makeController();
  await c.initialize();
  const loading = c.loadSharedTimers();
  auth.state.user.workspace_id = ids.otherWorkspace;
  await c.initialize();
  gate.resolve();
  await loading;
  assert.equal(
    c.stopwatches.value.some((t) => t.workspaceId === ids.workspace),
    false,
  );
});

test("all new modes enforce name limit and positive target before publishing", async () => {
  const c = makeController();
  await c.initialize();
  for (const changes of [
    { name: "x".repeat(36) },
    { duration: 0 },
    { duration: -1 },
    { name: "  " },
  ])
    assert.equal(await c.addTimer(input(changes)), null);
  assert.equal(c.stopwatches.value.length, 0);
  assert.equal(await timerDb.personalOutbox.count(), 0);
});

test("pause just after deadline persists and notifies both timer types before the next tick", async () => {
  auth.state.user.workspace_id = null;
  const c = makeController();
  await c.initialize();
  for (const type of ["up", "down"]) {
    const id = await c.addTimer(input({ type }));
    await c.startTimer(id);
    clock += 61000;
    await c.pauseTimer(id);
    await c.tick();
    const saved = await timerDb.timers.get(id);
    assert.equal(saved.status, type === "up" ? "paused" : "completed");
    assert.equal(saved.reachedTarget, true);
  }
  assert.equal(notifications.length, 2);
});

test("two controllers read-modify-write in one transaction without losing another local field", async () => {
  const a = makeController();
  await a.initialize();
  const id = await a.addTimer(input());
  const b = makeController();
  await b.initialize();
  assert.deepEqual(
    await Promise.all([a.startTimer(id), b.updateIsPay(id, true)]),
    [true, true],
  );
  const saved = await timerDb.timers.get(id);
  assert.equal(saved.status, "running");
  assert.equal(saved.isPay, true);
  assert.equal((await listPersonalOutbox(scope)).length, 3);
});

test("personal notification start/cancel follows acknowledged state and uses no legacy CRUD", async () => {
  const c = makeController();
  await c.initialize();
  const id = await c.addTimer(input());
  await c.startTimer(id);
  await settle(c);
  assert.equal(server.requests.length, 0);
  online = true;
  await settle(c);
  assert.ok(server.requests.some((req) => req.url.endsWith("/timer/start")));
  await c.pauseTimer(id);
  await settle(c);
  assert.ok(server.requests.some((req) => req.url.endsWith("/timer/cancel")));
  assert.ok(legacy.every((call) => call === "GET shared"));
});

test("pull of overdue count-up cannot mark the local alarm delivered before the tick", async () => {
  server.rows.set(
    ids.timer,
    serverTimer({
      status: "running",
      ends_at: new Date(clock - 1000).toISOString(),
    }),
  );
  online = true;
  const c = makeController();
  await c.initialize();
  await settle(c);
  assert.equal(c.stopwatches.value[0].reachedTarget, false);
  await c.tick();
  await settle(c);
  await c.tick();
  assert.equal(notifications.length, 1);
  assert.equal(c.stopwatches.value[0].status, "running");
  assert.equal(c.stopwatches.value[0].reachedTarget, true);
});

test("shared socket event during GET triggers another read instead of losing the event", async () => {
  const entered = deferred(),
    release = deferred();
  let reads = 0;
  backend.dbGetSharedTimers = async () => {
    reads++;
    if (reads === 1) {
      entered.resolve();
      await release.promise;
      return [];
    }
    return [serverTimer({ id: ids.second, is_shared: true })];
  };
  const c = makeController();
  await c.initialize();
  await entered.promise;
  socketCallback({ event: "created", data: { id: ids.second } });
  release.resolve();
  await c.loadSharedTimers();
  assert.equal(reads, 2);
  assert.equal(
    c.stopwatches.value.some((row) => row.id === ids.second && row.isShared),
    true,
  );
  assert.equal(await timerDb.personalOutbox.count(), 0);
});

test("shared socket deletion removes cache; failed GET and unrelated liveQuery cannot resurrect it", async () => {
  const shared = serverTimer({ id: ids.second, is_shared: true });
  backend.dbGetSharedTimers = async () => [shared];
  const c = makeController();
  await c.initialize();
  await c.loadSharedTimers();
  assert.equal((await timerDb.timers.get(ids.second)).dataMode, "shared");
  backend.dbGetSharedTimers = async () => null;
  socketCallback({ event: "deleted", data: { id: ids.second } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await timerDb.timers.get(ids.second))?.syncDeleted, true);
  await c.addTimer(input({ name: "Unrelated" }));
  await new Promise((resolve) => setImmediate(resolve));
  await c.loadSharedTimers();
  assert.equal(
    c.stopwatches.value.some((t) => t.id === ids.second),
    false,
  );
  assert.equal(await timerDb.personalOutbox.count(), 1);
});

test("overdue shared count-up GET notifies this device once across reconnect and reopen", async () => {
  const start = clock - 61000;
  const shared = serverTimer({
    id: ids.second,
    is_shared: true,
    status: "running",
    target_minutes: 1,
    accumulated_ms: 0,
    ends_at: new Date(start + 60000).toISOString(),
  });
  backend.dbGetSharedTimers = async () => [shared];
  const a = makeController();
  await a.initialize();
  await a.loadSharedTimers();
  await a.tick();
  assert.equal(notifications.length, 1);
  assert.equal(
    a.stopwatches.value.find((t) => t.id === ids.second).status,
    "running",
  );
  assert.equal(
    (await timerDb.timers.get(ids.second)).sharedAlarmDelivered,
    true,
  );
  connectedCallback({ isReconnect: true });
  await a.loadSharedTimers();
  await a.tick();
  a.dispose();
  timerDb.close();
  await timerDb.open();
  const reopened = makeController();
  await reopened.initialize();
  await reopened.loadSharedTimers();
  await reopened.tick();
  assert.equal(notifications.length, 1);
});

test("completed shared countdown GET and failing reconnect preserve a single local alarm", async () => {
  const shared = serverTimer({
    id: ids.second,
    is_shared: true,
    type: "down",
    target_minutes: 1,
    status: "completed",
    accumulated_ms: 60000,
    ended_at: new Date(clock).toISOString(),
  });
  backend.dbGetSharedTimers = async () => [shared];
  const c = makeController();
  await c.initialize();
  await c.loadSharedTimers();
  assert.equal(
    c.stopwatches.value.find((t) => t.id === ids.second).status,
    "expired",
  );
  assert.equal(notifications.length, 1);
  backend.dbGetSharedTimers = async () => null;
  connectedCallback({ isReconnect: true });
  await c.loadSharedTimers();
  c.dispose();
  timerDb.close();
  await timerDb.open();
  const reopened = makeController();
  await reopened.initialize();
  await reopened.tick();
  assert.equal(notifications.length, 1);
});

test("shared target race in two tabs emits one alarm per device, then another device can alarm", async () => {
  const start = clock;
  const shared = serverTimer({
    id: ids.second,
    is_shared: true,
    status: "running",
    target_minutes: 1,
    ends_at: new Date(start + 60000).toISOString(),
  });
  backend.dbGetSharedTimers = async () => [shared];
  const a = makeController();
  await a.initialize();
  await a.loadSharedTimers();
  const b = makeController();
  await b.initialize();
  await b.loadSharedTimers();
  clock += 61000;
  socketCallback({
    event: "updated",
    data: {
      id: ids.second,
      status: "running",
      endsAt: new Date(start + 60000).toISOString(),
      reachedTarget: true,
    },
  });
  await Promise.all([
    a.tick(),
    b.tick(),
    a.loadSharedTimers(),
    b.loadSharedTimers(),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications.length, 1);
  assert.equal(a.stopwatches.value[0].sharedAlarmDelivered, true);
  assert.equal(b.stopwatches.value[0].sharedAlarmDelivered, true);
  a.dispose();
  b.dispose();
  await timerDb.delete();
  await timerDb.open();
  const otherDevice = makeController();
  await otherDevice.initialize();
  await otherDevice.loadSharedTimers();
  await otherDevice.tick();
  assert.equal(notifications.length, 2);
});

test("shared countdown socket completion racing the deadline cannot duplicate its alarm", async () => {
  const shared = serverTimer({
    id: ids.second,
    is_shared: true,
    type: "down",
    status: "running",
    target_minutes: 1,
    ends_at: new Date(clock + 60000).toISOString(),
  });
  backend.dbGetSharedTimers = async () => [shared];
  const c = makeController();
  await c.initialize();
  await c.loadSharedTimers();
  clock += 61000;
  socketCallback({
    event: "updated",
    data: { id: ids.second, status: "completed", reachedTarget: true },
  });
  await Promise.all([c.tick(), c.loadSharedTimers()]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications.length, 1);
  assert.equal(
    (await timerDb.timers.get(ids.second)).sharedAlarmDelivered,
    true,
  );
});

test("GET begun before shared delete cannot write its stale response back into cache", async () => {
  const shared = serverTimer({ id: ids.second, is_shared: true });
  backend.dbGetSharedTimers = async () => [shared];
  const c = makeController();
  await c.initialize();
  await c.loadSharedTimers();
  const entered = deferred(),
    release = deferred();
  let reads = 0;
  backend.dbGetSharedTimers = async () => {
    if (++reads === 1) {
      entered.resolve();
      await release.promise;
      return [shared];
    }
    return null;
  };
  const stale = c.loadSharedTimers();
  await entered.promise;
  socketCallback({ event: "deleted", data: { id: ids.second } });
  release.resolve();
  await stale;
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(reads >= 2);
  assert.equal((await timerDb.timers.get(ids.second))?.syncDeleted, true);
  assert.equal(
    c.stopwatches.value.some((t) => t.id === ids.second),
    false,
  );
});

test("two tabs crossing a shared countdown deadline do not duplicate the device alarm", async () => {
  const shared = serverTimer({
    id: ids.second,
    is_shared: true,
    type: "down",
    status: "running",
    target_minutes: 1,
    ends_at: new Date(clock + 60000).toISOString(),
  });
  backend.dbGetSharedTimers = async () => [shared];
  backend.dbUpdateTimer = async (_id, update) => {
    Object.assign(shared, update);
    return { success: true };
  };
  const a = makeController();
  await a.initialize();
  await a.loadSharedTimers();
  const b = makeController();
  await b.initialize();
  await b.loadSharedTimers();
  clock += 61000;
  await Promise.all([a.tick(), b.tick()]);
  await Promise.all([a.loadSharedTimers(), b.loadSharedTimers()]);
  assert.equal(notifications.length, 1);
  assert.equal(
    (await timerDb.timers.get(ids.second)).sharedAlarmDelivered,
    true,
  );
});

test("pre-fix shared cache reachedTarget=true is not mistaken for a delivered alarm", async () => {
  await timerDb.timers.put({
    id: ids.second,
    dataMode: "shared",
    workspaceId: ids.workspace,
    userId: ids.user,
    isShared: true,
    name: "Legacy",
    type: "up",
    targetMinutes: 1,
    status: "running",
    startTime: clock - 61000,
    accumulatedTime: 0,
    reachedTarget: true,
  });
  backend.dbGetSharedTimers = async () => null;
  const c = makeController();
  await c.initialize();
  await c.tick();
  assert.equal(notifications.length, 1);
  assert.equal(
    (await timerDb.timers.get(ids.second)).sharedAlarmDelivered,
    true,
  );
  c.dispose();
  timerDb.close();
  await timerDb.open();
  const reopened = makeController();
  await reopened.initialize();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications.length, 1);
});

test("successful local shared DELETE clears cache without socket and invalidates an older GET", async () => {
  const shared = serverTimer({ id: ids.second, is_shared: true });
  backend.dbGetSharedTimers = async () => [shared];
  const c = makeController();
  await c.initialize();
  await c.loadSharedTimers();
  const entered = deferred(),
    release = deferred();
  let reads = 0;
  backend.dbGetSharedTimers = async () => {
    if (++reads === 1) {
      entered.resolve();
      await release.promise;
      return [shared];
    }
    return null;
  };
  const deleteEntered = deferred(),
    deleteRelease = deferred();
  backend.dbDeleteTimer = async () => {
    deleteEntered.resolve();
    await deleteRelease.promise;
    return { success: true };
  };
  const deleting = c.deleteTimer({ id: ids.second }, "sayacı");
  await deleteEntered.promise;
  const stale = c.loadSharedTimers();
  await entered.promise;
  deleteRelease.resolve();
  assert.equal(await deleting, true);
  const cachedAfterDelete = await timerDb.timers.get(ids.second);
  release.resolve();
  await stale;
  assert.equal(cachedAfterDelete?.syncDeleted, true);
  await c.addTimer(input({ name: "Unrelated local write" }));
  await settle(c);
  assert.equal((await timerDb.timers.get(ids.second))?.syncDeleted, true);
  assert.equal(
    c.stopwatches.value.some((t) => t.id === ids.second),
    false,
  );
  assert.equal((await listPersonalOutbox(scope)).length, 1);
});

test("shared deletion before initial GET finishes cannot be lost when timer is not in memory", async () => {
  const shared = serverTimer({ id: ids.second, is_shared: true });
  const entered = deferred(),
    release = deferred();
  let reads = 0;
  backend.dbGetSharedTimers = async () => {
    if (++reads === 1) {
      entered.resolve();
      await release.promise;
      return [shared];
    }
    return null;
  };
  const c = makeController();
  await c.initialize();
  await entered.promise;
  assert.equal(
    c.stopwatches.value.some((t) => t.id === ids.second),
    false,
  );
  const loading = c.loadSharedTimers();
  socketCallback({
    event: "deleted",
    data: {
      protocol: 5,
      success: true,
      workspaceId: ids.workspace,
      generation: "1",
      serverNow: new Date(clock).toISOString(),
      timer: { ...shared, record_status: "deleted", shared_revision: "1" },
    },
  });
  release.resolve();
  await loading;
  await c.addTimer(input({ name: "Unrelated local write" }));
  await settle(c);
  assert.equal((await timerDb.timers.get(ids.second))?.syncDeleted, true);
  assert.equal(
    c.stopwatches.value.some((t) => t.id === ids.second),
    false,
  );
  assert.equal((await listPersonalOutbox(scope)).length, 1);
});

test("failed local shared DELETE preserves the cache and visible timer", async () => {
  const shared = serverTimer({ id: ids.second, is_shared: true });
  backend.dbGetSharedTimers = async () => [shared];
  backend.dbDeleteTimer = async () => ({
    success: false,
    error: "Delete rejected",
  });
  const c = makeController();
  await c.initialize();
  await c.loadSharedTimers();
  assert.equal(await c.deleteTimer({ id: ids.second }, "sayacı"), false);
  assert.equal((await timerDb.timers.get(ids.second)).dataMode, "shared");
  assert.equal(
    c.stopwatches.value.some((t) => t.id === ids.second),
    true,
  );
  assert.equal(successes.length, 0);
});

test("late local DELETE success after account/workspace switch cannot clean another scope", async () => {
  const shared = serverTimer({ id: ids.second, is_shared: true });
  backend.dbGetSharedTimers = async () => [shared];
  const c = makeController();
  await c.initialize();
  await c.loadSharedTimers();
  const entered = deferred(),
    release = deferred();
  backend.dbDeleteTimer = async () => {
    entered.resolve();
    await release.promise;
    return { success: true };
  };
  const deleting = c.deleteTimer({ id: ids.second });
  await entered.promise;
  auth.state.user = { id: ids.other, workspace_id: ids.otherWorkspace };
  backend.dbGetSharedTimers = async () => null;
  await c.initialize();
  release.resolve();
  assert.equal(await deleting, false);
  assert.equal(
    (await timerDb.timers.get(ids.second)).workspaceId,
    ids.workspace,
  );
  assert.equal(
    c.stopwatches.value.some((t) => t.id === ids.second),
    false,
  );
  assert.equal(successes.length, 0);
});

test("unloaded deletion events cannot remove foreign shared cache or personal outbox data", async () => {
  await timerDb.timers.put({
    id: ids.second,
    dataMode: "shared",
    isShared: true,
    userId: ids.other,
    workspaceId: ids.otherWorkspace,
    status: "idle",
    targetMinutes: 1,
  });
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  const entered = deferred(),
    release = deferred();
  let reads = 0;
  backend.dbGetSharedTimers = async () => {
    if (++reads === 1) {
      entered.resolve();
      await release.promise;
    }
    return null;
  };
  const c = makeController();
  await c.initialize();
  await entered.promise;
  socketCallback({ event: "deleted", data: { id: ids.second } });
  socketCallback({ event: "deleted", data: { id: ids.timer } });
  release.resolve();
  await c.loadSharedTimers();
  await settle(c);
  assert.equal(
    (await timerDb.timers.get(ids.second)).workspaceId,
    ids.otherWorkspace,
  );
  assert.equal((await timerDb.timers.get(ids.timer)).syncDeleted, false);
  assert.equal((await listPersonalOutbox(scope)).length, 1);
});

test("late shared PATCH response cannot republish a timer deleted while PATCH was in flight", async () => {
  const shared = serverTimer({ id: ids.second, is_shared: true });
  backend.dbGetSharedTimers = async () => [shared];
  const c = makeController();
  await c.initialize();
  await c.loadSharedTimers();
  const entered = deferred(),
    release = deferred();
  backend.dbUpdateTimer = async () => {
    entered.resolve();
    await release.promise;
    return { success: true };
  };
  const updating = c.updateIsPay(ids.second, true);
  await entered.promise;
  backend.dbGetSharedTimers = async () => null;
  socketCallback({ event: "deleted", data: { id: ids.second } });
  release.resolve();
  await updating;
  assert.equal(
    c.stopwatches.value.some((t) => t.id === ids.second),
    false,
  );
  assert.equal((await timerDb.timers.get(ids.second))?.syncDeleted, true);
});

test("confirmed shared create is cached even if GET fails; its target alarm remains available", async () => {
  const c = makeController();
  await c.initialize();
  await c.loadSharedTimers();
  backend.dbGetSharedTimers = async () => null;
  const id = await c.addTimer(input({ isShared: true }));
  assert.ok(id);
  assert.equal((await timerDb.timers.get(id))?.dataMode, "shared");
  await c.startTimer(id);
  clock += 61000;
  await c.tick();
  assert.equal(notifications.length, 1);
  assert.equal(await timerDb.personalOutbox.count(), 0);
});

test("shared create rejects a response belonging to another workspace", async () => {
  backend.dbCreateTimer = async (row) => ({
    success: true,
    timer: serverTimer({
      id: row.id,
      is_shared: true,
      workspace_id: ids.otherWorkspace,
    }),
  });
  const c = makeController();
  await c.initialize();
  await c.loadSharedTimers();
  backend.dbGetSharedTimers = async () => null;
  assert.equal(await c.addTimer(input({ isShared: true })), null);
  assert.equal(c.stopwatches.value.length, 0);
  assert.equal(await timerDb.timers.count(), 0);
});

test("fractional-minute personal timer remains editable after server round trip", async () => {
  const c = makeController();
  await c.initialize();
  const id = await c.addTimer(input({ duration: 0.3333333 }));
  await c.startTimer(id);
  await settle(c);
  online = true;
  await settle(c);
  assert.equal(await c.updateIsPay(id, true), true);
  await settle(c);
  assert.equal((await timerDb.timers.get(id)).isPay, true);
});

test("confirmed shared POST cannot be erased by an older GET if follow-up GET fails", async () => {
  const c = makeController();
  await c.initialize();
  await c.loadSharedTimers();
  const entered = deferred(),
    release = deferred(),
    posted = deferred(),
    ack = deferred();
  let reads = 0;
  backend.dbGetSharedTimers = async () => {
    if (++reads === 1) {
      entered.resolve();
      await release.promise;
      return [];
    }
    return null;
  };
  const create = backend.dbCreateTimer;
  backend.dbCreateTimer = async (...args) => {
    posted.resolve();
    await ack.promise;
    return create(...args);
  };
  const creating = c.addTimer(input({ isShared: true }));
  await posted.promise;
  const loading = c.loadSharedTimers();
  await entered.promise;
  ack.resolve();
  const id = await creating;
  assert.ok(id);
  assert.equal((await timerDb.timers.get(id))?.dataMode, "shared");
  release.resolve();
  await loading;
  assert.equal((await timerDb.timers.get(id))?.dataMode, "shared");
  assert.equal(
    c.stopwatches.value.some((t) => t.id === id),
    true,
  );
});
