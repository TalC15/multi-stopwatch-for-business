import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browser, access, user, sid, sidB, response, loggedIn, deferred, settle, installSocket } from './testSupport/authHarness.js';

const account = { ...user, username: 'worker' };
const marker = `${user.id}:${sid}`;
const persisted = { user: JSON.stringify(account), 'keeptimer-auth-session': marker };
const state = (sessionId = sid) => ({ hasCredential: true, requiresLogin: false, sessionId });
const loginData = (sessionId = sid, who = account) => ({ accessToken: access(sessionId, who.id), sessionId, user: who });
const refreshData = (sessionId = sid) => ({ accessToken: access(sessionId), sessionId });
const failure = (status = 503, indeterminate = false) => Object.assign(Error('DO-NOT-EXPOSE credential/header/body'), {
  code: 'AUTH_UNAVAILABLE', data: { status, indeterminate, body: 'DO-NOT-EXPOSE' },
});
function setup({ initial = persisted, native: overrides = {}, online = true, locks = true } = {}) {
  const calls = [], b = browser({ initial, locks });
  const handlers = { getSessionState: async () => state(), login: async () => loginData(),
    refresh: async () => refreshData(), logout: async () => ({ success: true, sessionId: sid }), ...overrides };
  const native = Object.fromEntries(Object.keys(handlers).map(method => [method, async body => {
    calls.push({ method, body }); return handlers[method](body);
  }]));
  const tab = b.tab({ platform: 'android', native, online });
  let fetches = 0;
  tab.setFetch(() => { fetches++; throw Error('Android must not fetch web auth'); });
  return { tab, b, calls, handlers, fetches: () => fetches };
}

test('web login, refresh, logout and bootstrap never call native; fetch contract remains exact', async () => {
  let nativeCalls = 0;
  const native = new Proxy({}, { get: () => () => { nativeCalls++; throw Error('native on web'); } });
  const tab = browser().tab({ native }), requests = [];
  tab.setFetch(async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('login')) return loggedIn();
    if (url.endsWith('refresh')) return response(200, refreshData());
    return response(200, { success: true, sessionId: sid });
  });
  await tab.auth.bootstrapNativeAuthSession();
  assert.equal((await tab.auth.login('worker', '1234')).success, true);
  assert.equal((await tab.auth.refreshAccessToken()).ok, true);
  assert.equal((await tab.auth.logout()).success, true);
  assert.deepEqual(requests.map(r => r.url), ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout']);
  for (const { options } of requests) {
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store');
    assert.equal(options.method, 'POST'); assert.equal(options.headers['X-KeepTimer-CSRF'], '1');
    assert.equal(options.headers['Content-Type'], 'application/json');
  }
  assert.equal(nativeCalls, 0);
});

test('Android login routes exact credentials to native and keeps access only in RAM', async () => {
  const { tab, b, calls, fetches } = setup({ initial: {} });
  const result = await tab.auth.login('worker', '1234');
  assert.equal(result.success, true); assert.equal(tab.auth.getAccessToken(), access());
  assert.equal(tab.auth.getSessionMarker(), marker); assert.equal(tab.auth.getTabSessionIdentity(), marker);
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'login');
  assert.equal(JSON.stringify(calls[0].body), JSON.stringify({ username: 'worker', pin: '1234' }));
  assert.ok(b.writes.every(w => !w.value.includes('.signature') && !/Token/.test(w.key)));
  assert.equal(JSON.stringify(result).includes('Token'), false); assert.equal(fetches(), 0);
});

for (const bad of [
  { sessionId: 'bad' }, { accessToken: access(sidB) }, { accessToken: access(sid, 'other-user') },
  { user: { ...account, role: 'unknown' } }, { user: { ...account, workspace_id: 'bad' } },
  { user: { ...account, username: null } }, { user: null },
]) test(`Android rejects inconsistent login: ${JSON.stringify(bad)}`, async () => {
  const { tab } = setup({ initial: {}, native: { login: async () => ({ ...loginData(), ...bad }) } });
  assert.equal((await tab.auth.login('worker', '1234')).success, false);
  assert.equal(tab.auth.getAccessToken(), null); assert.equal(tab.auth.getSessionMarker(), null);
});

test('Android matching bootstrap deduplicates refresh; metadata cannot authenticate REST/socket before access', async () => {
  const gate = deferred(), { tab, calls, fetches } = setup({ native: { refresh: async () => { await gate.promise; return refreshData(); } } });
  const socket = installSocket(tab);
  const bootstrap = tab.auth.bootstrapNativeAuthSession(), ready = tab.auth.ensureAccessToken(), connected = socket.api.connectSocket();
  await settle();
  assert.deepEqual(calls.map(c => c.method), ['getSessionState', 'refresh']);
  assert.equal(calls[1].body.sessionId, sid); assert.equal(tab.auth.getAccessToken(), null);
  assert.equal(socket.sockets.length, 0); assert.equal(fetches(), 0);
  gate.resolve();
  assert.equal((await bootstrap).ok, true); assert.equal((await ready).ok, true);
  await connected; await settle();
  assert.equal(socket.sockets.length, 1); assert.equal(socket.sockets[0].auth.token, access());
  socket.api.disconnectSocket();
});

for (const change of ['generation', 'marker']) test(`Android stale refresh after ${change} change never installs access`, async () => {
  const gate = deferred(), { tab } = setup({ native: { refresh: async () => gate.promise } });
  const pending = tab.auth.refreshAccessToken(); await settle();
  if (change === 'generation') tab.auth.initializeAuthSession();
  else tab.localStorage.setItem(tab.auth.AUTH_SESSION_KEY, `${user.id}:${sidB}`);
  gate.resolve(refreshData()); assert.equal((await pending).stale, true);
  assert.equal(tab.auth.getAccessToken(), null);
});

for (const result of [refreshData(sidB), { ...refreshData(), accessToken: access(sid, 'other-user') }])
  test('Android mismatched refresh response cannot install RAM access', async () => {
    const { tab } = setup({ native: { refresh: async () => result } });
    assert.equal((await tab.auth.refreshAccessToken()).ok, false); assert.equal(tab.auth.getAccessToken(), null);
  });

test('native metadata mismatch invalidates RAM and existing socket without adopting or deleting account', async () => {
  const { tab, handlers, b, calls } = setup(); await tab.auth.login('worker', '1234');
  const socket = installSocket(tab); await socket.api.connectSocket(); const oldGeneration = tab.auth.getAuthGeneration();
  const saved = new Map(b.entries); handlers.getSessionState = async () => state(sidB);
  assert.equal((await tab.auth.bootstrapNativeAuthSession()).ok, false);
  assert.equal(tab.auth.getAccessToken(), null); assert.equal(tab.auth.isLoggedIn(), false);
  assert.equal(tab.auth.getUser(), null); // Stored cache survives but mismatched scope is hidden.
  assert.deepEqual(b.entries, saved); assert.equal(socket.sockets[0].closed, true);
  assert.ok(tab.auth.getAuthGeneration() > oldGeneration);
  assert.equal(calls.filter(c => c.method === 'refresh').length, 0);
  assert.equal((await tab.auth.apiFetch('/protected')), null);
});

for (const initial of [{}, { 'keeptimer-auth-session': marker }]) test('native credential alone does not fabricate user, marker or authenticated scope', async () => {
  const { tab, calls, b } = setup({ initial }); const saved = new Map(b.entries);
  assert.equal((await tab.auth.bootstrapNativeAuthSession()).ok, false);
  assert.equal(tab.auth.getAccessToken(), null); assert.equal(tab.auth.getUser(), null);
  assert.deepEqual(b.entries, saved); assert.deepEqual(calls.map(c => c.method), ['getSessionState']);
});

test('offline native bootstrap reads metadata but keeps local scope and performs no refresh/network', async () => {
  const { tab, calls, b } = setup({ online: false }); const saved = new Map(b.entries);
  const result = await tab.auth.bootstrapNativeAuthSession();
  assert.equal(result.ok, false); assert.equal(result.status, 0); assert.equal(tab.auth.isLoggedIn(), true);
  assert.deepEqual(calls.map(c => c.method), ['getSessionState']); assert.deepEqual(b.entries, saved);
});

for (const committed of [false, true]) test(`indeterminate login does not succeed or rollback (new credential committed: ${committed})`, async () => {
  const { tab, handlers, calls, b } = setup(); await tab.auth.login('worker', '1234');
  const socket = installSocket(tab); await socket.api.connectSocket(); const saved = new Map(b.entries);
  handlers.login = async () => { throw failure(503, true); };
  handlers.getSessionState = async () => state(committed ? sidB : sid);
  const result = await tab.auth.login('new-user', '1234');
  assert.equal(result.success, false); assert.equal(result.indeterminate, true);
  assert.equal(tab.auth.getAccessToken(), null); assert.equal(socket.sockets[0].closed, true);
  assert.deepEqual(b.entries, saved); assert.equal(JSON.stringify(result).includes('DO-NOT-EXPOSE'), false);
  assert.equal(calls.filter(c => c.method === 'logout').length, 0);
  const reconciled = await tab.auth.ensureAccessToken();
  assert.equal(reconciled.ok, !committed);
  assert.equal(tab.auth.getAccessToken(), committed ? null : access());
  assert.deepEqual(b.entries, saved);
  assert.equal(tab.auth.getUser()?.id ?? null, committed ? null : account.id);
});

for (const error of [failure(), failure(503, true), Error('network'), failure(401, true)])
  test(`native logout uncertain error preserves marker/user and never announces logout (${error.data?.status}/${error.data?.indeterminate})`, async () => {
    const { tab, b } = setup({ native: { logout: async () => { throw error; } } });
    await tab.auth.login('worker', '1234'); const saved = new Map(b.entries); let logouts = 0;
    tab.window.addEventListener(tab.auth.AUTH_LOCAL_LOGOUT_EVENT, () => logouts++);
    const result = await tab.auth.logout();
    assert.equal(result.success, false); assert.equal(result.status, 503); assert.equal(logouts, 0);
    assert.deepEqual(b.entries, saved); assert.equal(tab.auth.getUser().id, account.id);
    assert.equal(JSON.stringify(result).includes('DO-NOT-EXPOSE'), false);
  });

for (const expired of [false, true]) test(`native definitive logout (${expired ? '401' : 'success'}) clears local auth and disconnects`, async () => {
  const { tab, calls, fetches } = setup({ native: { logout: async () => {
    if (expired) throw failure(401); return { success: true, sessionId: sid };
  } } });
  await tab.auth.login('worker', '1234'); const socket = installSocket(tab); await socket.api.connectSocket();
  const result = await tab.auth.logout(); assert.equal(result.success, !expired);
  if (expired) assert.equal(result.expired, true);
  assert.equal(tab.auth.getSessionMarker(), null); assert.equal(tab.auth.getUser(), null); assert.equal(tab.auth.getAccessToken(), null);
  assert.equal(socket.sockets[0].closed, true); assert.equal(calls.at(-1).body.sessionId, sid); assert.equal(fetches(), 0);
});

for (const outcome of ['success', '401', '503-indeterminate']) test(`late native logout ${outcome} cannot clear newer marker/account`, async () => {
  const gate = deferred(), { tab, b } = setup({ native: { logout: async () => {
    await gate.promise; if (outcome !== 'success') throw failure(outcome === '401' ? 401 : 503, outcome !== '401');
    return { success: true, sessionId: sid };
  } } });
  const pending = tab.auth.logout(); await settle(); const other = b.tab();
  const newUser = { ...account, id: '00000000-0000-4000-8000-000000000002' }, newMarker = `${newUser.id}:${sidB}`;
  other.localStorage.setItem(tab.auth.AUTH_SESSION_KEY, newMarker); other.localStorage.setItem('user', JSON.stringify(newUser));
  gate.resolve(); assert.equal((await pending).stale, true);
  assert.equal(b.entries.get(tab.auth.AUTH_SESSION_KEY), newMarker); assert.equal(JSON.parse(b.entries.get('user')).id, newUser.id);
});

test('missing Android plugin returns controlled error; no cookie fallback for any operation', async () => {
  const b = browser({ initial: persisted }), tab = b.tab({ platform: 'android' }); let requests = 0;
  tab.setFetch(() => { requests++; throw Error('forbidden fallback'); });
  assert.equal((await tab.auth.login('worker', '1234')).success, false);
  assert.equal((await tab.auth.refreshAccessToken()).ok, false);
  assert.equal((await tab.auth.logout()).success, false);
  assert.equal(requests, 0); assert.equal(tab.auth.getSessionMarker(), marker);
});

test('native bridge UNIMPLEMENTED is surfaced without error payload or web fallback', async () => {
  const { tab, fetches } = setup({ native: { login: async () => { throw Object.assign(Error('DO-NOT-EXPOSE'), { code: 'UNIMPLEMENTED' }); } } });
  const result = await tab.auth.login('worker', '1234');
  assert.equal(result.status, 503); assert.match(result.error, /eklenti/); assert.equal(fetches(), 0);
  assert.equal(result.error.includes('DO-NOT-EXPOSE'), false);
});

test('state read racing a generation change cannot refresh or adopt metadata', async () => {
  const gate = deferred(), { tab, calls } = setup({ native: { getSessionState: async () => gate.promise } });
  const pending = tab.auth.bootstrapNativeAuthSession(); await settle(); tab.auth.initializeAuthSession();
  gate.resolve(state()); assert.equal((await pending).stale, true);
  assert.deepEqual(calls.map(c => c.method), ['getSessionState']); assert.equal(tab.auth.getAccessToken(), null);
});

test('same-runtime queued native logout/login keeps the newer successful session', async () => {
  const gate = deferred(), { tab, calls, handlers } = setup({ native: { logout: async () => { await gate.promise; return { success: true, sessionId: sid }; } } });
  handlers.login = async () => loginData(sidB);
  const logout = tab.auth.logout(), login = tab.auth.login('worker', '1234'); await settle();
  assert.deepEqual(calls.map(c => c.method), ['logout']); gate.resolve();
  assert.equal((await logout).success, true); assert.equal((await login).success, true);
  assert.equal(tab.auth.getAccessToken(), access(sidB)); assert.equal(tab.auth.getSessionMarker(), `${account.id}:${sidB}`);
});

test('native refresh revocation clears only the current local auth session', async () => {
  const { tab } = setup({ native: { refresh: async () => { throw failure(401); } } });
  const result = await tab.auth.bootstrapNativeAuthSession();
  assert.equal(result.hardFail, true); assert.equal(result.status, 401);
  assert.equal(tab.auth.getAccessToken(), null); assert.equal(tab.auth.getSessionMarker(), null);
});

test('partial JS marker/user-cache installation failure does not leave usable native access', async () => {
  const { tab } = setup({ initial: {} }); const setItem = tab.localStorage.setItem;
  tab.localStorage.setItem = (key, value) => { if (key === 'user') throw Error('quota'); setItem(key, value); };
  assert.equal((await tab.auth.login('worker', '1234')).success, false);
  assert.equal(tab.auth.getAccessToken(), null); assert.equal((await tab.auth.ensureAccessToken()).ok, false);
});

test('native uncertainty closes an old socket; only verified reconciliation can resume connection intent', async () => {
  const { tab, handlers } = setup(); await tab.auth.login('worker', '1234');
  const socket = installSocket(tab); await socket.api.connectSocket();
  handlers.logout = async () => { throw failure(503, true); };
  await tab.auth.logout(); assert.equal(socket.sockets[0].closed, true); assert.equal(socket.sockets.length, 1);
  const gate = deferred(); handlers.refresh = async () => { await gate.promise; return refreshData(); };
  const pending = tab.auth.ensureAccessToken(); await settle(); assert.equal(socket.sockets.length, 1);
  gate.resolve(); assert.equal((await pending).ok, true); await settle();
  assert.equal(socket.sockets.length, 2); assert.equal(socket.sockets[1].auth.token, access());
  socket.api.disconnectSocket();
});

test('stale native login success cannot overwrite externally replaced marker/user', async () => {
  const gate = deferred(), { tab, b } = setup({ native: { login: async () => gate.promise } });
  const pending = tab.auth.login('worker', '1234'); await settle();
  const other = b.tab(); other.localStorage.setItem(tab.auth.AUTH_SESSION_KEY, `${user.id}:${sidB}`);
  gate.resolve(loginData()); assert.equal((await pending).stale, true);
  assert.equal(tab.auth.getSessionMarker(), `${user.id}:${sidB}`); assert.equal(tab.auth.getAccessToken(), null);
});

for (const broken of ['user', 'shared-marker', 'tab-marker', 'shared-marker-after-write'])
  test(`native login installation ${broken} failure cannot resume old same-ID profile after process restart`, async () => {
    const { tab, b, handlers, calls } = setup(); await tab.auth.login('worker', '1234');
    const changedUser = { ...account, role: 'manager', workspace_id: '00000000-0000-4000-8000-000000000004' };
    let committed = false;
    handlers.login = async () => { committed = true; return loginData(sidB, changedUser); };
    handlers.getSessionState = async () => state(committed ? sidB : sid);
    const store = broken === 'tab-marker' ? tab.sessionStorage : tab.localStorage;
    const key = broken === 'user' ? 'user' : broken === 'tab-marker' ? 'keeptimer-tab-auth-session' : tab.auth.AUTH_SESSION_KEY;
    const original = store.setItem;
    store.setItem = (name, value) => {
      if (name !== key) return original(name, value);
      if (broken.endsWith('after-write')) original(name, value);
      throw Error('storage unavailable');
    };
    const result = await tab.auth.login('worker', '1234'); store.setItem = original;
    assert.equal(result.success, false); assert.equal(committed, true);
    assert.equal(tab.auth.getAccessToken(), null); assert.equal(tab.auth.getUser(), null);
    assert.equal(tab.auth.getSessionMarker(), null); assert.equal(tab.auth.getTabSessionIdentity(), null);
    assert.equal(calls.filter(c => c.method === 'logout').length, 0);
    const restarted = b.tab({ platform: 'android', native: handlers, online: false });
    assert.equal(restarted.auth.getAccessToken(), null); assert.equal(restarted.auth.getUser(), null);
    assert.equal((await restarted.auth.bootstrapNativeAuthSession()).ok, false);
    assert.equal(restarted.auth.getUser(), null); assert.equal(restarted.auth.isLoggedIn(), false);
    assert.equal(restarted.auth.getSessionMarker(), null);
    assert.ok([...b.entries.values(), ...tab.sessionEntries.values()].every(v => !v.includes('.signature')));
  });

test('native user/tab preparation occurs with hidden scope/access; shared resumable marker commits last', async () => {
  const { tab, b } = setup({ initial: {} }); const setItem = tab.localStorage.setItem;
  tab.localStorage.setItem = (key, value) => {
    assert.equal(tab.auth.getAccessToken(), null); assert.equal(tab.auth.getUser(), null);
    if (key === tab.auth.AUTH_SESSION_KEY) {
      assert.equal(JSON.parse(b.entries.get('user')).workspace_id, account.workspace_id);
      assert.equal(tab.auth.getTabSessionIdentity(), marker);
    }
    setItem(key, value);
  };
  assert.equal((await tab.auth.login('worker', '1234')).success, true);
  assert.deepEqual(b.writes.map(w => [w.store, w.key]), [
    ['local', 'user'], ['session', 'keeptimer-tab-auth-session'], ['local', 'keeptimer-auth-session'],
  ]);
  assert.equal(tab.auth.getAccessToken(), access()); assert.equal(tab.auth.getUser().id, account.id);
});

for (const crashAt of ['tab-preparation', 'marker-commit'])
  test(`process death snapshot before ${crashAt} cannot bind prepared new workspace to old marker`, async () => {
    const { tab, handlers } = setup(); await tab.auth.login('worker', '1234');
    const changedUser = { ...account, workspace_id: '00000000-0000-4000-8000-000000000004' };
    handlers.login = async () => loginData(sidB, changedUser);
    let snapshot; const store = crashAt === 'tab-preparation' ? tab.sessionStorage : tab.localStorage;
    const original = store.setItem, target = crashAt === 'tab-preparation' ? 'keeptimer-tab-auth-session' : tab.auth.AUTH_SESSION_KEY;
    store.setItem = (key, value) => {
      // Capture disk exactly before this write, without simulating cleanup on that disk.
      if (key === target) snapshot = { user: tab.localStorage.getItem('user'), [tab.auth.AUTH_SESSION_KEY]: tab.auth.getSessionMarker() };
      original(key, value);
    };
    await tab.auth.login('worker', '1234');
    assert.equal(JSON.parse(snapshot.user).workspace_id, changedUser.workspace_id);
    assert.equal(snapshot[tab.auth.AUTH_SESSION_KEY], marker);
    const restarted = browser({ initial: snapshot }).tab({ platform: 'android', online: false,
      native: { getSessionState: async () => state(sidB) } });
    assert.equal(restarted.auth.getUser(), null);
    assert.equal((await restarted.auth.bootstrapNativeAuthSession()).requiresLogin, true);
    assert.equal(restarted.auth.getUser(), null); assert.equal(restarted.auth.getAccessToken(), null);
  });

const nativeUnknownCases = [
  ['plain Error', () => { throw Error('DO-NOT-EXPOSE network'); }],
  ['metadata missing', () => { throw { message: 'DO-NOT-EXPOSE', cause: { secret: 'DO-NOT-EXPOSE' } }; }],
  ['503 false', () => { throw failure(503, false); }],
  ['401 indeterminate', () => { throw failure(401, true); }],
  ['401 missing uncertainty', () => { throw { data: { status: 401 } }; }],
  ['401 conflicting uncertainty', () => { throw { indeterminate: true, data: { status: 401, indeterminate: false } }; }],
  ...[400, 403, 409, 415, 429].map(status => [`${status}`, () => { throw failure(status, false); }]),
  ['UNIMPLEMENTED', () => { throw { code: 'UNIMPLEMENTED' }; }],
  ['malformed resolve', () => null],
  ['wrong-session resolve', () => ({ ...refreshData(sidB), success: true })],
];
for (const operation of ['refresh', 'logout']) for (const [name, failNative] of nativeUnknownCases)
  test(`native ${operation} ${name} suspends old access/socket; only state + matching refresh restores REST/socket`, async () => {
    const { tab, b, handlers, calls } = setup(); await tab.auth.login('worker', '1234');
    const socket = installSocket(tab); await socket.api.connectSocket();
    const saved = new Map(b.entries); let invalidations = 0, logouts = 0, requests = 0; const logs = [];
    tab.window.addEventListener(tab.auth.AUTH_ACCESS_INVALIDATED_EVENT, () => invalidations++);
    tab.window.addEventListener(tab.auth.AUTH_LOCAL_LOGOUT_EVENT, () => logouts++);
    tab.context.console = { log: (...values) => logs.push(values), error: (...values) => logs.push(values), warn: (...values) => logs.push(values) };
    tab.setFetch((_url, options) => { requests++; assert.equal(options.headers.get('Authorization'), `Bearer ${access(sid, user.id, 2)}`); return response(200, {}); });
    handlers[operation] = async () => failNative();
    const result = await (operation === 'refresh' ? tab.auth.refreshAccessToken() : tab.auth.logout());
    assert.equal(operation === 'refresh' ? result.ok : result.success, false);
    assert.equal(Boolean(result.expired || result.hardFail), false); assert.equal(logouts, 0);
    assert.equal(tab.auth.getAccessToken(), null); assert.equal(tab.auth.hasUsableAccessToken(), false);
    assert.equal(invalidations, 1); assert.equal(socket.sockets[0].closed, true);
    assert.deepEqual(b.entries, saved); assert.equal(tab.auth.getUser().id, account.id);
    assert.equal(JSON.stringify(result).includes('DO-NOT-EXPOSE'), false); assert.equal(JSON.stringify(logs).includes('DO-NOT-EXPOSE'), false);
    // Continued failure cannot reuse the previous RAM token for a new Bearer request.
    if (operation === 'logout') handlers.refresh = async () => { throw Error('network'); };
    assert.equal(await tab.auth.apiFetch('/protected'), null); assert.equal(requests, 0);
    const start = calls.length, stateGate = deferred(), refreshGate = deferred();
    handlers.getSessionState = async () => stateGate.promise;
    handlers.refresh = async () => { await refreshGate.promise; return { accessToken: access(sid, user.id, 2), sessionId: sid }; };
    const ready = tab.auth.ensureAccessToken(); await settle();
    assert.deepEqual(calls.slice(start).map(c => c.method), ['getSessionState']);
    assert.equal(tab.auth.getAccessToken(), null); assert.equal(socket.sockets.length, 1);
    stateGate.resolve(state()); await settle();
    assert.deepEqual(calls.slice(start).map(c => c.method), ['getSessionState', 'refresh']);
    assert.equal(tab.auth.getAccessToken(), null); assert.equal(socket.sockets.length, 1);
    refreshGate.resolve(); assert.equal((await ready).ok, true); await settle();
    assert.equal(tab.auth.getAccessToken(), access(sid, user.id, 2)); assert.equal(socket.sockets.length, 2);
    assert.equal(socket.sockets[1].auth.token, access(sid, user.id, 2));
    assert.equal((await tab.auth.apiFetch('/protected')).status, 200); assert.equal(requests, 1);
    assert.deepEqual(b.entries, saved); socket.api.disconnectSocket();
  });

for (const operation of ['refresh', 'logout']) test(`stale native ${operation} failure cannot invalidate newer account RAM access`, async () => {
  const gate = deferred(), { tab, b, handlers } = setup({ locks: false }); await tab.auth.login('worker', '1234');
  handlers[operation] = async () => { await gate.promise; throw Error('DO-NOT-EXPOSE'); };
  const pending = operation === 'refresh' ? tab.auth.refreshAccessToken() : tab.auth.logout(); await settle();
  const accountB = { ...account, id: '00000000-0000-4000-8000-000000000002' };
  const other = b.tab({ platform: 'android', native: { login: async () => loginData(sidB, accountB) } });
  assert.equal((await other.auth.login('other', '1234')).success, true);
  const generationB = other.auth.getAuthGeneration(); gate.resolve();
  assert.equal((await pending).stale, true);
  assert.equal(other.auth.getAccessToken(), access(sidB, accountB.id));
  assert.equal(other.auth.getUser().id, accountB.id); assert.equal(other.auth.getAuthGeneration(), generationB);
  assert.equal(other.auth.getSessionMarker(), `${accountB.id}:${sidB}`);
});

for (const bad of [{ sessionId: 'bad' }, { user: null }, { user: { ...account, workspace_id: 'bad' } }, { accessToken: access(sidB) }])
  test('malformed resolved native login hides old scope pending reconciliation without native rollback', async () => {
    const { tab, handlers, calls, b } = setup(); await tab.auth.login('worker', '1234'); const saved = new Map(b.entries);
    handlers.login = async () => ({ ...loginData(), ...bad }); handlers.getSessionState = async () => state(sidB);
    const result = await tab.auth.login('worker', '1234'); assert.equal(result.success, false);
    assert.equal(tab.auth.getAccessToken(), null); assert.equal(tab.auth.getUser(), null);
    assert.equal((await tab.auth.bootstrapNativeAuthSession()).requiresLogin, true);
    assert.equal(tab.auth.getUser(), null); assert.deepEqual(b.entries, saved);
    assert.equal(calls.filter(c => c.method === 'logout').length, 0);
  });

test('completed native installation survives process restart with correct new workspace, metadata-only scope and RAM empty', async () => {
  const { tab, b, handlers } = setup(); const changedUser = { ...account, workspace_id: '00000000-0000-4000-8000-000000000004' };
  handlers.login = async () => loginData(sidB, changedUser); handlers.getSessionState = async () => state(sidB);
  assert.equal((await tab.auth.login('worker', '1234')).success, true);
  const restarted = b.tab({ platform: 'android', native: handlers, online: false });
  assert.equal(restarted.auth.getAccessToken(), null); assert.equal(restarted.auth.getUser(), null);
  await restarted.auth.bootstrapNativeAuthSession();
  assert.equal(restarted.auth.getUser().workspace_id, changedUser.workspace_id);
  assert.equal(restarted.auth.getAccessToken(), null);
});

for (const operation of ['refresh', 'logout']) test(`cache/marker user inconsistency during native ${operation} closes current access/scope/socket`, async () => {
  const gate = deferred(), { tab, handlers } = setup(); await tab.auth.login('worker', '1234');
  const socket = installSocket(tab); await socket.api.connectSocket();
  handlers[operation] = async () => { await gate.promise; return operation === 'refresh' ? refreshData() : { success: true, sessionId: sid }; };
  const pending = operation === 'refresh' ? tab.auth.refreshAccessToken() : tab.auth.logout(); await settle();
  tab.localStorage.setItem('user', JSON.stringify({ ...account, id: '00000000-0000-4000-8000-000000000002' }));
  gate.resolve(); assert.equal((await pending).stale, true);
  assert.equal(tab.auth.getAccessToken(), null); assert.equal(tab.auth.getUser(), null); assert.equal(socket.sockets[0].closed, true);
  assert.equal(tab.auth.getSessionMarker(), marker); socket.api.disconnectSocket();
});
