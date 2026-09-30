import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { beforeEach, afterEach, after, test } from "node:test";
import { timerDb } from "../data/timerDb.js";
import { createStopwatchController } from "./stopwatchController.js";
import { fakeAuth, ids, deferred } from "../sync/testSupport/fixtures.js";

let auth, controller, events, online, snapshots, warnings, gate;
beforeEach(async () => {
  await timerDb.delete(); await timerDb.open();
  auth = fakeAuth(); events = new EventTarget(); online = true; snapshots = 0; warnings = []; gate = null;
  const backend = { ...auth, isTabSessionCurrent: () => {
    if (auth.state.sessionUnreadable) throw Error("Session metadata unavailable");
    return auth.isTabSessionCurrent();
  }, AUTH_LOCAL_LOGOUT_EVENT: "logout", AUTH_SESSION_CHANGED_EVENT: "session",
    AUTH_LOGIN_REQUIRED_EVENT: "invalid", AUTH_USER_CHANGED_EVENT: "user" };
  controller = createStopwatchController({ backend, events, online: () => online,
    sharedApi: { snapshot: async () => {
      snapshots++;
      if (gate) { gate.entered.resolve(); await gate.release.promise; }
      return { protocol: 5, success: true, complete: true, workspaceId: ids.workspace,
        generation: "0", serverNow: new Date().toISOString(), timers: [] };
    }, command: () => { throw Error("Unexpected command"); } },
    engine: { flush: async () => ({ status: "offline" }), pull: async () => { throw Error("Unexpected pull"); } },
    socket: { onTimerEvent: () => () => {}, onSocketConnected: () => () => {} },
    notify() {}, cancelSound() {}, haptic() {}, message: { warning: text => warnings.push(text), error() {}, success() {} },
    storage: { getItem: () => null }, document: new EventTarget(), setInterval: () => 1, clearInterval() {},
  });
});
afterEach(async () => { controller.dispose(); await new Promise(resolve => setImmediate(resolve)); });
after(() => timerDb.close());

for (const connected of [true, false]) test(`signed out / online=${connected} prompts login without a sync/offline claim`, async () => {
  auth.state.current = false; auth.state.user = null; online = connected;
  await controller.initialize();
  assert.equal(controller.sharedNotice.value.state, "signed-out");
  assert.equal(controller.sharedNotice.value.message, "Ortak sayaçları kullanmak için giriş yapın.");
  assert.equal(controller.sharedNotice.value.to, "/login");
  assert.equal(snapshots, 0); assert.equal(await timerDb.personalOutbox.count(), 0);
  assert.equal(controller.requireSharedWrite(), false);
  assert.equal(warnings[0], controller.sharedNotice.value.message);
});
for (const connected of [true, false]) test(`confirmed null workspace / online=${connected} directs to existing company join`, async () => {
  auth.state.user.workspace_id = null; online = connected;
  await controller.initialize();
  assert.equal(controller.sharedNotice.value.state, "workspace-required");
  assert.equal(controller.sharedNotice.value.message, "Ortak sayaçları kullanmak için bir çalışma gurubuna katılın.");
  assert.equal(controller.sharedNotice.value.to, "/profile");
  assert.equal(snapshots, 0); assert.equal(controller.requireSharedWrite(), false);
  assert.equal(warnings[0], controller.sharedNotice.value.message);
});
test("current session with user still missing is loading, never signed out", async () => {
  auth.state.user = null;
  await controller.initialize();
  assert.equal(controller.sharedNotice.value.state, "loading");
  assert.doesNotMatch(controller.sharedNotice.value.message, /giriş|katıl|İnternet/);
  auth.state.user = { id: ids.user, workspace_id: null };
  events.dispatchEvent(new Event("user")); await controller.initialize();
  assert.equal(controller.sharedNotice.value.state, "workspace-required");
});
test("unreadable session metadata stays neutral until the existing auth source is readable", async () => {
  auth.state.sessionUnreadable = true;
  await controller.initialize();
  assert.equal(controller.sharedNotice.value.state, "loading");
  assert.equal(snapshots, 0);
  auth.state.sessionUnreadable = false;
  events.dispatchEvent(new Event("session")); await controller.initialize(); await controller.loadSharedTimers();
  assert.equal(controller.sharedNotice.value.state, "ready");
});
test("missing workspace property is loading until explicit membership information arrives", async () => {
  delete auth.state.user.workspace_id; online = false;
  await controller.initialize();
  assert.equal(controller.sharedNotice.value.state, "loading");
  assert.equal(snapshots, 0);
  auth.state.user.workspace_id = ids.workspace;
  events.dispatchEvent(new Event("user")); await controller.initialize();
  assert.equal(controller.sharedNotice.value.state, "offline-readonly");
});
test("initial empty store is neutral; valid signed-in scope shows real refresh then ready", async () => {
  assert.equal(controller.sharedNotice.value.state, "loading");
  gate = { entered: deferred(), release: deferred() };
  await controller.initialize(); await gate.entered.promise;
  assert.equal(controller.sharedNotice.value.state, "reconciling");
  assert.equal(controller.sharedNotice.value.message, "Ortak sayaçlar güncelleniyor…");
  const pending = controller.loadSharedTimers(); gate.release.resolve(); await pending;
  assert.equal(controller.sharedNotice.value.state, "ready");
  assert.equal(controller.sharedNotice.value.message, "Ortak sayaçlar ekip üyeleriyle güncel tutulur.");
  assert.equal(controller.sharedWritable.value, true);
});
test("signed-in workspace offline remains readonly and reconnect restores existing flow", async () => {
  online = false; await controller.initialize();
  assert.equal(controller.sharedNotice.value.state, "offline-readonly");
  assert.match(controller.sharedNotice.value.message, /İnternet bağlantısı bekleniyor/);
  assert.match(controller.sharedNotice.value.message, /değiştirilemez/);
  assert.equal(controller.requireSharedWrite(), false); assert.equal(snapshots, 0);
  online = true; events.dispatchEvent(new Event("online")); await controller.loadSharedTimers();
  assert.equal(controller.sharedNotice.value.state, "ready");
});
test("logout event overrides stored user before local logout has removed tokens", async () => {
  await controller.initialize(); await controller.loadSharedTimers();
  events.dispatchEvent(new Event("logout")); await controller.initialize();
  assert.equal(controller.sharedNotice.value.state, "signed-out");
  assert.equal(controller.user.value, null);
});
