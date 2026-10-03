import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test, beforeEach, after } from 'node:test';
import { timerDb } from '../data/timerDb.js';
import { enqueuePersonalPut, listPersonalOutbox } from './personalOutbox.js';
import { createPersonalSyncApi } from './personalSyncApi.js';
import { createPersonalSyncEngine } from './personalSyncEngine.js';
import { createStopwatchController } from '../stores/stopwatchController.js';
import { timer, scope, ids, mockServer } from './testSupport/fixtures.js';
import { browser, user, sid, response, refreshed, deferred, settle, installSocket } from '../services/testSupport/authHarness.js';
const initial = { user: JSON.stringify(user), 'keeptimer-auth-session': `${user.id}:${sid}` };
beforeEach(async () => { await timerDb.delete(); await timerDb.open(); });
after(() => timerDb.close());
function setup(tab) {
  const api = createPersonalSyncApi({ auth: tab.auth, request: tab.auth.apiFetch });
  const engine = createPersonalSyncEngine({ api, locks: tab.context.navigator.locks, online: () => tab.context.navigator.onLine });
  return { api, engine };
}
test('offline cold scope mounts personal timers without token; logout errors retain scope; confirmed logout hides but never converts personal rows', async () => {
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  await timerDb.timers.put(timer({ id: ids.second, dataMode: 'standalone', userId: null, workspaceId: null }));
  const tab = browser({ initial }).tab({ online: false });
  const { api, engine } = setup(tab);
  const noop = () => {};
  const c = createStopwatchController({ backend: tab.auth, engine, personalApi: api,
    socket: { onTimerEvent: noop, onSocketConnected: noop }, notify: noop, cancelSound: noop, haptic: noop,
    message: { error: noop, warning: noop, success: noop, loading: noop, dismiss: noop },
    storage: tab.localStorage, events: tab.window, document: tab.document,
    online: () => tab.context.navigator.onLine, setInterval: () => 1, clearInterval: noop });
  try {
    assert.equal(await c.initialize(), true);
    assert.equal(c.ready.value, true);
    assert.equal(tab.auth.getAccessToken(), null);
    assert.deepEqual(c.stopwatches.value.map(t => t.id).sort(), [ids.timer, ids.second].sort());
    assert.equal((await engine.flush()).status, 'offline');
    assert.equal((await listPersonalOutbox(scope))[0].body, null);
    tab.online(true); tab.setFetch(async () => response(503, {}));
    assert.equal((await tab.auth.logout()).success, false);
    assert.ok(c.stopwatches.value.some(t => t.id === ids.timer));
    tab.online(false); // Avoid background sync triggered by controller events.
    const gate = deferred(); tab.setFetch(async () => gate.promise); tab.online(true);
    const pending = tab.auth.logout(); await settle();
    assert.ok(c.stopwatches.value.some(t => t.id === ids.timer));
    tab.online(false); gate.resolve(response(200, { success: true, sessionId: sid }));
    assert.equal((await pending).success, true);
    await c.initialize();
    assert.deepEqual(c.stopwatches.value.map(t => t.id), [ids.second]);
    assert.equal((await timerDb.timers.get(ids.timer)).dataMode, 'workspace-personal');
    assert.equal((await listPersonalOutbox(scope)).length, 1);
  } finally { c.dispose(); }
});
test('reconnect refresh completes before socket and personal outbox preparation/send; mutation ID/revision/body ACK stay unchanged', async () => {
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  const before = (await listPersonalOutbox(scope))[0];
  const tab = browser({ initial }).tab({ online: false }), { engine } = setup(tab);
  const socket = installSocket(tab), gate = deferred(), server = mockServer(), order = [];
  await socket.api.connectSocket();
  assert.equal((await engine.flush()).status, 'offline');
  tab.setFetch(async (url, options) => {
    if (url === '/api/auth/refresh') { order.push('refresh'); await gate.promise; order.push('ready'); return refreshed(); }
    order.push('personal'); return server.request(url, options);
  });
  tab.online(true); tab.window.dispatchEvent(new Event('online'));
  const flush = engine.flush(); await settle();
  assert.deepEqual(order, ['refresh']); assert.equal(socket.sockets.length, 0);
  assert.equal((await listPersonalOutbox(scope))[0].body, null);
  gate.resolve(); const result = await flush; await settle();
  assert.equal(result.acknowledged, 1); assert.equal(socket.sockets.length, 1);
  assert.deepEqual(order, ['refresh', 'ready', 'personal']);
  const body = JSON.parse(server.requests[0].body);
  assert.equal(body.mutationId, before.mutationId); assert.equal(body.expectedRevision, 0);
  assert.equal(body.dataMode, 'workspace-personal');
  assert.equal((await timerDb.timers.get(ids.timer)).syncRevision, 1);
  assert.equal((await listPersonalOutbox(scope)).length, 0);
  // No token is persisted in the timer or outbox stores.
  assert.ok(!JSON.stringify(await timerDb.timers.toArray()).includes('signature'));
  socket.api.disconnectSocket();
});
test('refresh 503/403/network never prepares or changes a queued personal mutation', async () => {
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  const before = await listPersonalOutbox(scope);
  const tab = browser({ initial }).tab(), { engine } = setup(tab);
  for (const status of [503, 403, 0]) {
    tab.setFetch(async url => { assert.equal(url, '/api/auth/refresh'); if (!status) throw Error('offline'); return response(status, {}); });
    await assert.rejects(engine.flush(), /auth-unavailable/);
    assert.deepEqual(await listPersonalOutbox(scope), before);
    assert.equal(tab.auth.isLoggedIn(), true);
  }
});
