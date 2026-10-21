import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test, beforeEach, afterEach, after } from 'node:test';
import { createAccountExperience } from '../services/accountExperience.js';
import { createStopwatchController } from './stopwatchController.js';
import { timerDb } from '../data/timerDb.js';
import { fakeAuth, ids, serverTimer, deferred } from '../sync/testSupport/fixtures.js';

let fixtures = [];
beforeEach(async () => { await timerDb.delete(); await timerDb.open(); });
afterEach(async () => {
  for (const f of fixtures) { f.controller.dispose(); f.stop(); f.experience.dispose(); }
  fixtures = [];
  await new Promise(resolve => setImmediate(resolve));
});
after(() => timerDb.close());
const turn = () => new Promise(resolve => setImmediate(resolve));
async function until(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await turn(); }
  assert.ok(check(), 'Automatic recovery must finish without a manual GET, focus or reload');
}
const reply = (status, data) => ({ ok: status === 200, status, json: async () => data });
function fixture(server = { generation: 1, row: serverTimer({ is_shared: true, shared_revision: '1', status: 'paused' }) }) {
  const auth = fakeAuth(); auth.state.user.role = 'worker';
  Object.assign(auth, { AUTH_SESSION_CHANGED_EVENT: 'session', AUTH_USER_CHANGED_EVENT: 'user', AUTH_LOCAL_LOGOUT_EVENT: 'logout' });
  const events = new EventTarget(), renewals = new Map(), calls = { proof: 0, snapshots: 0, commands: [] };
  const net = { online: true, mono: 0, proofStatus: 200, snapshotStatus: 200 };
  let sequence = 0, connected;
  const proof = () => ({
    account: { kind: 'company', userId: auth.state.user.id, workspaceId: auth.state.user.workspace_id },
    subscription: { planCode: null, status: null, startsAt: null, endsAt: null, isEntitled: false },
    code: 'SUBSCRIPTION_REQUIRED', features: { tts: true, telegram: true, presets: true },
    shared: true, personal: { readable: true, writable: true }, loginReady: true,
  });
  const frame = fields => ({ protocol: 5, success: true, workspaceId: auth.state.user.workspace_id,
    generation: String(server.generation), serverNow: new Date().toISOString(), ...fields });
  async function gate(name) {
    const pending = net[name];
    if (pending) { pending.entered.resolve(); await pending.release.promise; }
  }
  const experience = createAccountExperience({ auth, events, online: () => net.online, monotonicNow: () => net.mono,
    schedule: (callback, delay) => { const id = ++sequence; renewals.set(id, { callback, at: net.mono + delay }); return id; },
    unschedule: id => renewals.delete(id),
    request: async () => { calls.proof++; const data = structuredClone(proof()); await gate('proofGate'); return reply(net.proofStatus, data); },
  });
  const backend = { ...auth, async apiFetch(url, options) {
    if (options.method === 'GET') {
      calls.snapshots++;
      const data = structuredClone(frame({ complete: true, timers: [server.row] }));
      await gate('snapshotGate');
      return reply(net.snapshotStatus, data);
    }
    const body = JSON.parse(options.body); calls.commands.push(body);
    assert.equal(body.expectedRevision, server.row.shared_revision);
    assert.equal(body.command, 'set-pay');
    server.generation++; server.row.shared_revision = String(server.generation); server.row.is_pay = body.value;
    const data = structuredClone(frame({ timer: server.row, mutationId: body.mutationId }));
    await gate('ackGate');
    if (net.ackLost) throw Error('Controlled lost ACK after server acceptance');
    return reply(200, data);
  } };
  const controller = createStopwatchController({ backend, experience, events, online: () => net.online,
    engine: { flush: async () => ({ status: 'offline' }) },
    socket: { onTimerEvent: () => () => {}, onSocketConnected: callback => { connected = callback; return () => { connected = null; }; } },
    notify() {}, cancelSound() {}, haptic() {},
    message: { error() {}, warning() {}, success() {}, loading() {}, dismiss() {} },
    storage: { getItem: () => null }, document: new EventTarget(), setInterval: () => 0, clearInterval() {},
  });
  const stop = experience.start();
  const f = { auth, events, controller, experience, stop, net, calls, server,
    socketConnected: () => connected?.(),
    offline() { net.online = false; events.dispatchEvent(new Event('offline')); },
    online() { net.online = true; events.dispatchEvent(new Event('online')); },
    async boot() { await controller.initialize(); await until(() => controller.sharedState.value === 'ready'); await turn(); },
    async renew() {
      net.mono += 25001;
      for (const [id, task] of [...renewals]) if (task.at <= net.mono) { renewals.delete(id); await task.callback(); }
    },
    switch(workspace = ids.otherWorkspace, user = ids.other) {
      auth.state.user = { id: user, workspace_id: workspace, role: 'worker' };
      auth.state.generation++; auth.state.identity = 'session-B'; auth.state.marker = 'marker-B';
      events.dispatchEvent(new Event('session'));
    },
  };
  fixtures.push(f); return f;
}
const hold = () => ({ entered: deferred(), release: deferred() });
const row = f => f.controller.stopwatches.value.find(t => t.id === ids.timer);

test('late verified authority resumes shared snapshot after online and socket callbacks already returned', async () => {
  const f = fixture(); await f.boot(); f.offline();
  const before = f.calls.snapshots; f.net.proofGate = hold(); f.online();
  await f.net.proofGate.entered.promise; f.socketConnected(); await turn();
  assert.equal(f.net.online, true); assert.equal(f.experience.canShared(), false);
  assert.equal(f.calls.snapshots, before); assert.equal(f.controller.sharedWritable.value, false);
  f.server.row.is_pay = true; f.server.row.shared_revision = '2'; f.server.generation = 2;
  f.net.proofGate.release.resolve();
  await until(() => f.controller.sharedState.value === 'ready' && row(f)?.isPay);
  assert.ok(f.calls.snapshots > before); assert.equal(f.calls.commands.length, 0);
});

test('verified authority still waits for canonical snapshot before shared writes reopen', async () => {
  const f = fixture(); await f.boot(); f.offline(); f.net.snapshotGate = hold(); f.online();
  await f.net.snapshotGate.entered.promise;
  assert.equal(f.experience.canShared(), true); assert.equal(f.controller.sharedWritable.value, false);
  assert.equal(await f.controller.updateIsPay(ids.timer, !row(f).isPay), false);
  assert.equal(f.calls.commands.length, 0);
  f.net.snapshotGate.release.resolve(); await until(() => f.controller.sharedState.value === 'ready');
});

test('Manager and Worker converge after repeated outages with no replay or duplicate records', async () => {
  const manager = fixture(), worker = fixture(manager.server);
  manager.auth.state.user.role = 'manager'; worker.auth.state.user.id = ids.other;
  await manager.boot(); await worker.boot();
  for (let i = 0; i < 3; i++) {
    worker.offline(); const before = worker.calls.commands.length;
    assert.equal(await worker.controller.updateIsPay(ids.timer, !row(worker).isPay), false);
    assert.equal(await manager.controller.updateIsPay(ids.timer, !row(manager).isPay), true);
    worker.net.proofGate = hold(); worker.online(); worker.socketConnected();
    await worker.net.proofGate.entered.promise; worker.net.proofGate.release.resolve();
    await until(() => worker.controller.sharedState.value === 'ready' && row(worker)?.isPay === row(manager)?.isPay);
    assert.equal(worker.calls.commands.length, before);
    assert.equal(worker.controller.stopwatches.value.filter(t => t.id === ids.timer).length, 1);
    assert.equal(row(worker).sharedRevision, row(manager).sharedRevision);
  }
  assert.equal(manager.calls.commands.length, 3);
  assert.equal(new Set(manager.calls.commands.map(c => c.mutationId)).size, 3);
});

test('backend verification unavailable despite browser online stays closed, renewal then recovers', async () => {
  const f = fixture(); await f.boot(); f.offline(); f.net.proofStatus = 503; f.online();
  await until(() => f.experience.state.status === 'unavailable');
  assert.equal(f.net.online, true); assert.equal(f.controller.requireSharedWrite(true), false);
  const snapshots = f.calls.snapshots; f.socketConnected(); await turn();
  assert.equal(f.calls.snapshots, snapshots);
  f.net.proofStatus = 200; await f.renew();
  await until(() => f.controller.sharedState.value === 'ready');
  assert.equal(f.calls.commands.length, 0);
});

test('snapshot 503 stays unavailable; next socket recovery obtains canonical state without commands', async () => {
  const f = fixture(); await f.boot(); f.offline(); f.net.snapshotStatus = 503; f.online();
  await until(() => f.controller.sharedState.value === 'unavailable');
  assert.equal(f.controller.requireSharedWrite(true), false);
  f.net.snapshotStatus = 200; f.socketConnected(); await until(() => f.controller.sharedState.value === 'ready');
  assert.equal(f.calls.commands.length, 0);
});

test('pre-outage snapshot cannot reopen writes after online authority verification fails', async () => {
  const f = fixture(); await f.boot(); f.net.snapshotGate = hold();
  const pending = f.controller.loadSharedTimers(); await f.net.snapshotGate.entered.promise;
  f.offline(); await turn(); f.net.proofStatus = 503; f.online();
  await until(() => f.experience.state.status === 'unavailable');
  f.net.snapshotGate.release.resolve(); await pending;
  assert.equal(f.experience.canShared(), false);
  assert.equal(f.controller.sharedWritable.value, false);
  assert.notEqual(f.controller.sharedNotice.value.state, 'ready');
  assert.equal(f.calls.commands.length, 0);
});

test('lost ACK accepted on server is reconciled once, never resent on reconnect', async () => {
  const f = fixture(); await f.boot(); f.net.ackLost = true;
  assert.equal(await f.controller.updateIsPay(ids.timer, !row(f).isPay), false);
  assert.equal(row(f).isPay, true); f.offline(); f.online(); f.socketConnected();
  await until(() => f.controller.sharedState.value === 'ready');
  assert.equal(f.calls.commands.length, 1); assert.equal(f.server.generation, 2);
});

test('pending ACK remains non-writable through recovery and is not replayed', async () => {
  const f = fixture(); await f.boot(); f.net.ackGate = hold();
  const pending = f.controller.updateIsPay(ids.timer, !row(f).isPay); await f.net.ackGate.entered.promise;
  f.offline(); f.online(); f.socketConnected();
  await until(() => f.experience.canShared());
  assert.equal(f.controller.sharedWritable.value, false);
  assert.equal(await f.controller.updateIsPay(ids.timer, !row(f).isPay), false);
  f.net.ackGate.release.resolve(); assert.equal(await pending, true);
  await until(() => f.controller.sharedState.value === 'ready');
  assert.equal(f.calls.commands.length, 1); assert.equal(row(f).sharedRevision, '2');
});

for (const change of ['account', 'workspace']) test(`late snapshot after ${change} switch cannot change new scope`, async () => {
  const f = fixture(); await f.boot(); f.offline(); f.net.snapshotGate = hold(); f.online();
  await f.net.snapshotGate.entered.promise;
  f.switch(ids.otherWorkspace, change === 'account' ? ids.other : ids.user);
  f.net.snapshotGate.release.resolve();
  await f.controller.initialize(); await turn();
  assert.equal(f.controller.stopwatches.value.some(t => t.workspaceId === ids.workspace), false);
  assert.equal(f.controller.sharedWritable.value, false);
  assert.equal(f.calls.commands.length, 0);
});

test('late authority and ACK from previous session cannot reopen or mutate logged-out scope', async () => {
  const f = fixture(); await f.boot(); f.net.ackGate = hold();
  const pending = f.controller.updateIsPay(ids.timer, !row(f).isPay); await f.net.ackGate.entered.promise;
  f.offline(); f.net.proofGate = hold(); f.online(); await f.net.proofGate.entered.promise;
  f.auth.state.current = false; f.events.dispatchEvent(new Event('logout')); f.auth.state.user = null;
  f.net.proofGate.release.resolve(); f.net.ackGate.release.resolve();
  assert.equal(await pending, false); await f.controller.initialize(); await turn();
  assert.equal(f.controller.sharedNotice.value.state, 'signed-out');
  assert.equal(f.controller.stopwatches.value.length, 0);
  assert.equal(f.controller.sharedWritable.value, false); assert.equal(f.calls.commands.length, 1);
});

test('dispose removes authority recovery observer', async () => {
  const f = fixture(); await f.boot(); f.offline(); f.net.proofGate = hold(); f.online();
  await f.net.proofGate.entered.promise; f.controller.dispose(); const before = f.calls.snapshots;
  f.net.proofGate.release.resolve(); await until(() => f.experience.canShared()); await turn();
  assert.equal(f.calls.snapshots, before);
});
