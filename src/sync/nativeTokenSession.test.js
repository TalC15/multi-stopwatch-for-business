import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test, beforeEach, after } from 'node:test';
import { timerDb } from '../data/timerDb.js';
import { enqueuePersonalPut, listPersonalOutbox } from './personalOutbox.js';
import { createPersonalSyncApi } from './personalSyncApi.js';
import { createPersonalSyncEngine } from './personalSyncEngine.js';
import { createStopwatchController } from '../stores/stopwatchController.js';
import { timer, scope, ids, mockServer } from './testSupport/fixtures.js';
import { browser, user, sid, sidB, access, deferred, settle, installSocket } from '../services/testSupport/authHarness.js';
const initial = { user: JSON.stringify({ ...user, username: 'worker' }), 'keeptimer-auth-session': `${user.id}:${sid}` };
const state = () => ({ hasCredential: true, sessionId: sid, requiresLogin: false });
const accessResult = () => ({ accessToken: access(), sessionId: sid });
const fail = (indeterminate = false) => { throw Object.assign(Error('unavailable'), { data: { status: 503, indeterminate } }); };
beforeEach(async () => { await timerDb.delete(); await timerDb.open(); });
after(() => timerDb.close());
function setup(native, online = true) {
  const b = browser({ initial }), tab = b.tab({ platform: 'android', native, online });
  const api = createPersonalSyncApi({ auth: tab.auth, request: tab.auth.apiFetch });
  const engine = createPersonalSyncEngine({ api, locks: tab.context.navigator.locks, online: () => tab.context.navigator.onLine });
  return { tab, b, api, engine };
}
function controller(tab, api, engine) {
  const noop = () => {};
  return createStopwatchController({ backend: tab.auth, engine, personalApi: api,
    socket: { onTimerEvent: noop, onSocketConnected: noop }, notify: noop, cancelSound: noop, haptic: noop,
    message: { error: noop, warning: noop, success: noop, loading: noop, dismiss: noop },
    storage: tab.localStorage, events: tab.window, document: tab.document,
    online: () => tab.context.navigator.onLine, setInterval: () => 1, clearInterval: noop });
}

test('native bootstrap gates real personal sync preparation, HTTP Bearer and Socket.IO until refresh', async () => {
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  const before = (await listPersonalOutbox(scope))[0], gate = deferred(), order = [];
  const { tab, engine } = setup({ getSessionState: async () => { order.push('state'); return state(); },
    refresh: async () => { order.push('refresh'); await gate.promise; order.push('access'); return accessResult(); } });
  const socket = installSocket(tab), server = mockServer();
  tab.setFetch((url, options) => {
    assert.equal(url.startsWith('/api/auth/'), false);
    assert.equal(options.headers.get('Authorization'), `Bearer ${access()}`);
    order.push('personal'); return server.request(url, options);
  });
  const boot = tab.auth.bootstrapNativeAuthSession(), connected = socket.api.connectSocket();
  assert.equal((await engine.flush()).status, "auth-required"); // Pending metadata has no local scope.
  await settle();
  const flush = engine.flush(); await settle();
  assert.deepEqual(order, ['state', 'refresh']); assert.equal(socket.sockets.length, 0);
  assert.equal((await listPersonalOutbox(scope))[0].body, null);
  gate.resolve(); assert.equal((await boot).ok, true); assert.equal((await flush).acknowledged, 1);
  await connected; await settle();
  assert.deepEqual(order, ['state', 'refresh', 'access', 'personal']); assert.equal(socket.sockets.length, 1);
  const sent = JSON.parse(server.requests[0].body);
  assert.equal(sent.mutationId, before.mutationId); assert.equal(sent.expectedRevision, 0);
  assert.equal((await timerDb.timers.get(ids.timer)).syncRevision, 1);
  assert.equal(JSON.stringify(await timerDb.timers.toArray()).includes('.signature'), false);
  socket.api.disconnectSocket();
});

for (const failureAt of ['state', 'refresh', 'indeterminate', 'mismatch', 'missing-credential'])
  test(`native ${failureAt} failure preserves actual IndexedDB timers and outbox byte contents`, async () => {
    await enqueuePersonalPut(timer(), scope, { isNew: true });
    const beforeTimers = await timerDb.timers.toArray(), beforeOutbox = await listPersonalOutbox(scope);
    const { tab, engine } = setup({ getSessionState: async () => {
      if (failureAt === 'state') fail(true);
      if (failureAt === 'mismatch') return { ...state(), sessionId: sidB };
      if (failureAt === 'missing-credential') return { hasCredential: false, sessionId: null, requiresLogin: true };
      return state();
    }, refresh: async () => fail(failureAt === 'indeterminate') });
    let sent = 0; tab.setFetch(() => { sent++; throw Error('network not allowed'); });
    assert.equal((await tab.auth.bootstrapNativeAuthSession()).ok, false);
    if (["refresh", "indeterminate"].includes(failureAt)) await assert.rejects(engine.flush(), /auth-unavailable/);
    else assert.equal((await engine.flush()).status, "auth-required");
    assert.deepEqual(await timerDb.timers.toArray(), beforeTimers); assert.deepEqual(await listPersonalOutbox(scope), beforeOutbox);
    assert.equal(tab.auth.getUser()?.id ?? null, ["refresh", "indeterminate"].includes(failureAt) ? user.id : null);
    assert.equal(tab.auth.getSessionMarker(), initial['keeptimer-auth-session']);
    assert.equal(sent, 0);
  });

test('native cold offline controller, uncertain logout and definitive logout retain rows/outbox and never show account timers as standalone', async () => {
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  await timerDb.timers.put(timer({ id: ids.second, dataMode: 'standalone', userId: null, workspaceId: null }));
  let finishLogout = false;
  const { tab, api, engine } = setup({ getSessionState: async () => state(), refresh: async () => fail(true),
    logout: async () => finishLogout ? { success: true, sessionId: sid } : fail(true) }, false);
  const c = controller(tab, api, engine), before = await listPersonalOutbox(scope);
  try {
    await tab.auth.bootstrapNativeAuthSession();
    assert.equal(await c.initialize(), true);
    assert.ok(c.stopwatches.value.some(t => t.id === ids.timer)); assert.equal(tab.auth.getAccessToken(), null);
    tab.online(true); assert.equal((await tab.auth.logout()).success, false); tab.online(false);
    await c.initialize(); assert.ok(c.stopwatches.value.some(t => t.id === ids.timer));
    finishLogout = true; tab.online(true); assert.equal((await tab.auth.logout()).success, true); tab.online(false);
    await c.initialize(); assert.deepEqual(c.stopwatches.value.map(t => t.id), [ids.second]);
    assert.equal((await timerDb.timers.get(ids.timer)).dataMode, 'workspace-personal');
    assert.deepEqual(await listPersonalOutbox(scope), before);
  } finally { c.dispose(); }
});

test('indeterminate login cannot send old or new account outbox after credential switches', async () => {
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  await timerDb.timers.put(timer({ id: ids.second, dataMode: "standalone", userId: null, workspaceId: null }));
  const before = await listPersonalOutbox(scope);
  const { tab, api, engine } = setup({ login: async () => fail(true),
    getSessionState: async () => ({ ...state(), sessionId: sidB }), refresh: async () => { throw Error('must not refresh mismatched scope'); } }, false);
  const c = controller(tab, api, engine);
  try {
    await c.initialize(); tab.online(true);
    const result = await tab.auth.login('new-account', '1234'); assert.equal(result.indeterminate, true);
    await tab.auth.bootstrapNativeAuthSession(); tab.online(false); await c.initialize();
    assert.equal(tab.auth.getAccessToken(), null); assert.equal(tab.auth.getUser(), null);
    assert.deepEqual(c.stopwatches.value.map(t => t.id), [ids.second]);
    assert.deepEqual(await listPersonalOutbox(scope), before);
    assert.equal((await timerDb.timers.get(ids.timer)).dataMode, 'workspace-personal');
  } finally { c.dispose(); }
});

test('verified native account switch retains old account rows/outbox but cannot display or drain them under new scope', async () => {
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  const before = await listPersonalOutbox(scope);
  const next = { ...user, id: ids.other, username: 'other', workspace_id: ids.otherWorkspace };
  const { tab, api, engine } = setup({ getSessionState: async () => state(),
    login: async () => ({ accessToken: access(sidB, next.id), sessionId: sidB, user: next }) }, false);
  const c = controller(tab, api, engine);
  try {
    await tab.auth.bootstrapNativeAuthSession();
    await c.initialize(); assert.ok(c.stopwatches.value.some(t => t.id === ids.timer));
    tab.online(true); assert.equal((await tab.auth.login('other', '1234')).success, true); tab.online(false);
    await c.initialize(); assert.equal(c.stopwatches.value.some(t => t.id === ids.timer), false);
    assert.equal(tab.auth.getUser().id, next.id);
    assert.deepEqual(await listPersonalOutbox(scope), before);
    assert.equal((await timerDb.timers.get(ids.timer)).dataMode, 'workspace-personal');
  } finally { c.dispose(); }
});

const standalone = () => timer({ id: ids.second, dataMode: 'standalone', userId: null, workspaceId: null });
const sharedId = '00000000-0000-4000-8000-000000000008';
async function seedAllScopes() {
  await enqueuePersonalPut(timer(), scope, { isNew: true });
  await timerDb.timers.put(standalone());
  await timerDb.timers.put(timer({ id: sharedId, dataMode: 'shared', isShared: true, userId: ids.other }));
  return { timers: JSON.stringify(await timerDb.timers.toArray()), outbox: JSON.stringify(await listPersonalOutbox(scope)) };
}
async function assertDiskUnchanged(before) {
  assert.equal(JSON.stringify(await timerDb.timers.toArray()), before.timers);
  assert.equal(JSON.stringify(await listPersonalOutbox(scope)), before.outbox);
  assert.equal((await timerDb.timers.get(ids.timer)).dataMode, 'workspace-personal');
}

test('cold native controller exposes only standalone before metadata; matching offline state opens local scope but no network', async () => {
  const before = await seedAllScopes(), gate = deferred(); let refreshes = 0, requests = 0;
  const { tab, api, engine } = setup({ getSessionState: async () => gate.promise,
    refresh: async () => { refreshes++; return accessResult(); } }, false);
  const c = controller(tab, api, engine), socket = installSocket(tab);
  tab.setFetch(() => { requests++; throw Error('network forbidden'); });
  try {
    const boot = tab.auth.bootstrapNativeAuthSession(); await settle(); await c.initialize();
    assert.equal(tab.auth.getUser(), null); assert.equal(tab.auth.isLocalAccountScopeReconciled(), false);
    assert.deepEqual(c.stopwatches.value.map(t => t.id), [ids.second]);
    const connected = socket.api.connectSocket();
    gate.resolve(state());
    await boot; await connected; await c.initialize();
    assert.deepEqual(c.stopwatches.value.map(t => t.id).sort(), [ids.timer, ids.second, sharedId].sort());
    assert.equal(socket.sockets.length, 0);
  } finally {
    // Release metadata even when an assertion fails; no fixture waits forever.
    gate.resolve(state());
    await settle(); c.dispose(); socket.api.disconnectSocket();
  }
  assert.equal(refreshes, 0); assert.equal(requests, 0);
  assert.equal(tab.auth.getUser().id, user.id); assert.equal(tab.auth.getAccessToken(), null);
  await assertDiskUnchanged(before);
});

test('matching offline native metadata makes personal/shared cache visible while socket and Bearer REST remain unavailable', async () => {
  const before = await seedAllScopes(); let requests = 0, refreshes = 0;
  const { tab, api, engine } = setup({ getSessionState: async () => state(),
    refresh: async () => { refreshes++; return accessResult(); } }, false);
  const c = controller(tab, api, engine), socket = installSocket(tab);
  tab.setFetch(() => { requests++; throw Error('no REST'); });
  try {
    await tab.auth.bootstrapNativeAuthSession(); await c.initialize();
    assert.deepEqual(c.stopwatches.value.map(t => t.id).sort(), [ids.timer, ids.second, sharedId].sort());
    assert.equal(tab.auth.isLocalAccountScopeReconciled(), true); assert.equal(tab.auth.getAccessToken(), null);
    await socket.api.connectSocket(); assert.equal(socket.sockets.length, 0);
    assert.equal(await tab.auth.apiFetch('/protected'), null);
    assert.equal(refreshes, 0); assert.equal(requests, 0); await assertDiskUnchanged(before);
  } finally { c.dispose(); socket.api.disconnectSocket(); }
});

for (const invalidState of [
  { ...state(), sessionId: sidB }, { hasCredential: false, requiresLogin: true, sessionId: null },
  { ...state(), requiresLogin: true },
]) test('definitive native mismatch hides both cached account timer modes, preserving all disk data', async () => {
  const before = await seedAllScopes(); let currentState = state();
  const { tab, api, engine } = setup({ getSessionState: async () => currentState }, false);
  const c = controller(tab, api, engine);
  try {
    await tab.auth.bootstrapNativeAuthSession(); await c.initialize();
    assert.ok(c.stopwatches.value.some(t => t.id === ids.timer));
    currentState = invalidState; const result = await tab.auth.bootstrapNativeAuthSession(); await c.initialize();
    assert.equal(result.requiresLogin, true); assert.equal(tab.auth.getUser(), null);
    assert.deepEqual(c.stopwatches.value.map(t => t.id), [ids.second]); await assertDiskUnchanged(before);
    // Restoring the correct credential opens only its original local scope.
    currentState = state(); await tab.auth.bootstrapNativeAuthSession(); await c.initialize();
    assert.ok(c.stopwatches.value.some(t => t.id === ids.timer)); assert.equal(tab.auth.getAccessToken(), null);
  } finally { c.dispose(); }
});

for (const afterLogin of ['old-session', 'different-session', 'state-unreadable'])
  test(`indeterminate native login ${afterLogin}: local scope requires fresh metadata; disk survives`, async () => {
    const before = await seedAllScopes(); let mode = 'old-session';
    const { tab, api, engine } = setup({ login: async () => fail(true), getSessionState: async () => {
      if (mode === 'state-unreadable') fail(); return { ...state(), sessionId: mode === 'different-session' ? sidB : sid };
    } }, false);
    const c = controller(tab, api, engine);
    try {
      await tab.auth.bootstrapNativeAuthSession(); await c.initialize();
      assert.ok(c.stopwatches.value.some(t => t.id === ids.timer));
      tab.online(true); assert.equal((await tab.auth.login('next', '1234')).indeterminate, true); tab.online(false);
      await c.initialize(); assert.deepEqual(c.stopwatches.value.map(t => t.id), [ids.second]);
      mode = afterLogin; await tab.auth.bootstrapNativeAuthSession(); await c.initialize();
      assert.equal(tab.auth.getAccessToken(), null);
      if (mode === 'old-session') assert.ok(c.stopwatches.value.some(t => t.id === ids.timer));
      else assert.deepEqual(c.stopwatches.value.map(t => t.id), [ids.second]);
      assert.equal(JSON.parse(tab.localStorage.getItem('user')).id, user.id);
      await assertDiskUnchanged(before);
    } finally { c.dispose(); }
  });

for (const operation of ['refresh', 'logout']) for (const nativeError of ['plain', '503-false', 'metadata-missing'])
  test(`${operation} ${nativeError} preserves timer/outbox bytes and matched offline scope while shutting network`, async () => {
    const before = await seedAllScopes(); let failing = false;
    const reject = () => {
      if (nativeError === 'plain') throw Error('network');
      if (nativeError === 'metadata-missing') throw {};
      fail(false);
    };
    const native = { getSessionState: async () => state(), login: async () => ({ ...accessResult(), user: { ...user, username: 'worker' } }),
      refresh: async () => failing ? reject() : accessResult(), logout: async () => reject() };
    const { tab, api, engine } = setup(native, false);
    // Establish RAM access before mounting controller effects, then mount offline.
    tab.online(true); await tab.auth.login('worker', '1234'); tab.online(false);
    const c = controller(tab, api, engine);
    try {
      await c.initialize();
      failing = true; tab.online(true);
      const result = await (operation === 'refresh' ? tab.auth.refreshAccessToken() : tab.auth.logout()); tab.online(false);
      assert.equal(operation === 'refresh' ? result.ok : result.success, false);
      await c.initialize(); assert.ok(c.stopwatches.value.some(t => t.id === ids.timer));
      assert.equal(tab.auth.getAccessToken(), null); assert.equal(tab.auth.getSessionMarker(), initial['keeptimer-auth-session']);
      await assertDiskUnchanged(before);
    } finally { c.dispose(); }
  });

for (const broken of ['user', 'shared-marker', 'tab-marker'])
  test(`partial native ${broken} installation/restart does not show old profile under changed workspace and preserves disk`, async () => {
    const before = await seedAllScopes(), newProfile = { ...user, username: 'worker', role: 'manager', workspace_id: ids.otherWorkspace };
    let sessionId = sid;
    const native = { getSessionState: async () => ({ ...state(), sessionId }),
      login: async () => { sessionId = sidB; return { accessToken: access(sidB), sessionId: sidB, user: newProfile }; } };
    const { tab, b, api, engine } = setup(native, false); const c = controller(tab, api, engine);
    try {
      await tab.auth.bootstrapNativeAuthSession(); await c.initialize();
      assert.ok(c.stopwatches.value.some(t => t.id === ids.timer));
      const store = broken === 'tab-marker' ? tab.sessionStorage : tab.localStorage, setItem = store.setItem;
      const target = broken === 'user' ? 'user' : broken === 'tab-marker' ? 'keeptimer-tab-auth-session' : tab.auth.AUTH_SESSION_KEY;
      store.setItem = (key, value) => { if (key === target) throw Error('storage'); setItem(key, value); };
      tab.online(true); assert.equal((await tab.auth.login('worker', '1234')).success, false); tab.online(false); store.setItem = setItem;
      await c.initialize(); assert.deepEqual(c.stopwatches.value.map(t => t.id), [ids.second]);
      const restarted = b.tab({ platform: 'android', native, online: false });
      const nextApi = createPersonalSyncApi({ auth: restarted.auth, request: restarted.auth.apiFetch });
      const nextEngine = createPersonalSyncEngine({ api: nextApi, locks: restarted.context.navigator.locks, online: () => false });
      const nextController = controller(restarted, nextApi, nextEngine);
      try {
        await restarted.auth.bootstrapNativeAuthSession(); await nextController.initialize();
        assert.equal(restarted.auth.getAccessToken(), null); assert.equal(restarted.auth.getUser(), null);
        assert.deepEqual(nextController.stopwatches.value.map(t => t.id), [ids.second]); await assertDiskUnchanged(before);
      } finally { nextController.dispose(); }
    } finally { c.dispose(); }
  });

test('matching native session with inconsistent marker/user ID never opens cached account scope', async () => {
  const before = await seedAllScopes(), { tab, api, engine } = setup({ getSessionState: async () => state() }, false);
  tab.localStorage.setItem('user', JSON.stringify({ ...user, id: ids.other, username: 'other' }));
  const c = controller(tab, api, engine);
  try {
    assert.equal((await tab.auth.bootstrapNativeAuthSession()).requiresLogin, true); await c.initialize();
    assert.equal(tab.auth.getUser(), null); assert.deepEqual(c.stopwatches.value.map(t => t.id), [ids.second]);
    await assertDiskUnchanged(before);
  } finally { c.dispose(); }
});
