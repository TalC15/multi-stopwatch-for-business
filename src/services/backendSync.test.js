import test from 'node:test';
import assert from 'node:assert/strict';
import { browser, user, sid, sidB, access, response, loggedIn, refreshed, deferred, settle, installSocket } from './testSupport/authHarness.js';
const marker = `${user.id}:${sid}`;
const persisted = { 'keeptimer-auth-session': marker, user: JSON.stringify(user) };

test('login uses cookie contract and only keeps access in runtime memory', async () => {
  const b = browser(), tab = b.tab(), calls = [];
  tab.setFetch(async (url, options) => { calls.push({ url, options }); return loggedIn(); });
  assert.equal((await tab.auth.login('worker', '1234')).success, true);
  assert.equal(tab.auth.getAccessToken(), access());
  assert.equal(tab.auth.getSessionMarker(), marker);
  assert.equal(tab.auth.isLoggedIn(), true);
  assert.equal(calls[0].url, '/api/auth/login');
  const options = calls[0].options;
  assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store');
  assert.equal(options.headers['X-KeepTimer-CSRF'], '1');
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(options.headers.Origin, undefined);
  assert.deepEqual(JSON.parse(options.body), { username: 'worker', pin: '1234' });
  assert.ok(b.writes.every(write => !['accessToken','refreshToken'].includes(write.key) && !write.value.includes('.signature')));
  assert.equal(tab.sessionStorage.getItem('accessToken'), null);
  assert.equal(tab.localStorage.getItem('refreshToken'), null);
});

test('legacy token cleanup preserves user cache, unrelated preferences and does not create a session', () => {
  const b = browser({ initial: { accessToken: 'old-access', refreshToken: 'old-refresh', user: JSON.stringify(user), theme: 'dark' } });
  const tab = b.tab();
  assert.equal(b.entries.has('accessToken'), false); assert.equal(b.entries.has('refreshToken'), false);
  assert.equal(b.entries.get('user'), JSON.stringify(user)); assert.equal(b.entries.get('theme'), 'dark');
  assert.equal(tab.auth.getSessionMarker(), null); assert.equal(tab.auth.isLoggedIn(), false);
});

test('cold reload preserves offline scope; standalone boot has no auth network dependency', async () => {
  const tab = browser({ initial: persisted }).tab({ online: false });
  assert.equal(tab.auth.getAccessToken(), null); assert.equal(tab.auth.isLoggedIn(), true);
  assert.equal(tab.auth.getUser().id, user.id);
  assert.equal((await tab.auth.ensureAccessToken()).ok, false);
  assert.equal(tab.auth.isLoggedIn(), true);
  const standalone = browser().tab();
  assert.equal((await standalone.auth.ensureAccessToken()).ok, false);
  assert.equal(standalone.auth.isLoggedIn(), false);
});

test('online reload deduplicates refresh before protected API calls and never reads cookie', async () => {
  const tab = browser({ initial: persisted }).tab(), gate = deferred(), calls = [];
  tab.setFetch(async (url, options) => {
    calls.push(url);
    if (url === '/api/auth/refresh') {
      assert.deepEqual(JSON.parse(options.body), { sessionId: sid });
      assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store');
      await gate.promise; return refreshed();
    }
    assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${access()}`);
    return response(200, { ok: true });
  });
  const first = tab.auth.apiFetch('/protected', { headers: { Authorization: 'Bearer null' } });
  const second = tab.auth.ensureAccessToken();
  await settle(); assert.deepEqual(calls, ['/api/auth/refresh']);
  gate.resolve(); assert.equal((await first).status, 200); assert.equal((await second).ok, true);
  assert.deepEqual(calls, ['/api/auth/refresh','/protected']);
});

for (const kind of [503, 403, 409, 'network', 'timeout']) test(`refresh ${kind} preserves local session and produces no logout`, async () => {
  const tab = browser({ initial: persisted }).tab(); let exits = 0, calls = 0;
  tab.window.addEventListener(tab.auth.AUTH_LOCAL_LOGOUT_EVENT, () => exits++);
  tab.setFetch(async () => { calls++; if (typeof kind === 'string') throw Object.assign(Error(kind), { name: kind === 'timeout' ? 'TimeoutError' : 'TypeError' }); return response(kind, {}); });
  assert.equal((await tab.auth.ensureAccessToken()).ok, false);
  assert.equal(tab.auth.isLoggedIn(), true); assert.equal(tab.auth.getSessionMarker(), marker);
  assert.equal(exits, 0); assert.equal(calls, 1);
});

test('current refresh 401 invalidates only the current scope', async () => {
  const tab = browser({ initial: persisted }).tab(); let exits = 0;
  tab.window.addEventListener(tab.auth.AUTH_LOCAL_LOGOUT_EVENT, () => exits++);
  tab.setFetch(async () => response(401, {}));
  assert.equal((await tab.auth.ensureAccessToken()).hardFail, true);
  assert.equal(tab.auth.isLoggedIn(), false); assert.equal(tab.auth.getAccessToken(), null);
  assert.equal(tab.auth.getSessionMarker(), null); assert.equal(exits, 1);
});

for (const status of [200, 401]) test(`stale refresh ${status} cannot alter another account marker/cache`, async () => {
  const b = browser({ initial: persisted }), tab = b.tab(), gate = deferred();
  tab.setFetch(async () => { await gate.promise; return status === 200 ? refreshed() : response(status, {}); });
  const pending = tab.auth.ensureAccessToken(); await settle();
  // External storage change also models an old client which does not honor Web Locks.
  const other = b.tab();
  other.localStorage.setItem('keeptimer-auth-session', `${user.id}:${sidB}`);
  other.localStorage.setItem('user', JSON.stringify({ ...user, username: 'B' }));
  gate.resolve(); assert.equal((await pending).stale, true);
  assert.equal(b.entries.get('keeptimer-auth-session'), `${user.id}:${sidB}`);
  assert.equal(JSON.parse(b.entries.get('user')).username, 'B');
  assert.equal(tab.auth.getAccessToken(), null); assert.equal(tab.auth.isLoggedIn(), false);
});

test('refresh rejects a successful response from the wrong session', async () => {
  const tab = browser({ initial: persisted }).tab();
  tab.setFetch(async () => refreshed(sidB));
  assert.equal((await tab.auth.ensureAccessToken()).ok, false);
  assert.equal(tab.auth.getAccessToken(), null); assert.equal(tab.auth.getSessionMarker(), marker);
});

for (const kind of [503, 403, 409, 'network', 'timeout', 'offline', 'wrong-session']) test(`logout ${kind} keeps scope and never emits success/local logout`, async () => {
  const tab = browser({ initial: persisted }).tab({ online: kind !== 'offline' }); let exits = 0;
  tab.window.addEventListener(tab.auth.AUTH_LOCAL_LOGOUT_EVENT, () => exits++);
  tab.setFetch(async () => {
    if (kind === 'offline') throw Error('Offline logout must not call fetch');
    if (['network','timeout'].includes(kind)) throw Error(kind);
    return kind === 'wrong-session' ? response(200, { success: true, sessionId: sidB }) : response(kind, {});
  });
  assert.equal((await tab.auth.logout()).success, false);
  assert.equal(tab.auth.isLoggedIn(), true); assert.equal(exits, 0);
});

test('logout waits for parsed matching success; 401 is session expiry rather than logout success', async () => {
  const tab = browser({ initial: persisted }).tab(), gate = deferred(); let exits = 0;
  tab.window.addEventListener(tab.auth.AUTH_LOCAL_LOGOUT_EVENT, () => exits++);
  tab.setFetch(async (url, options) => {
    assert.equal(url, '/api/auth/logout'); assert.deepEqual(JSON.parse(options.body), { sessionId: sid });
    return { status: 200, ok: true, json: () => gate.promise };
  });
  const pending = tab.auth.logout(); await settle();
  assert.equal(exits, 0); assert.equal(tab.auth.isLoggedIn(), true);
  gate.resolve({ success: true, sessionId: sid });
  assert.equal((await pending).success, true); assert.equal(exits, 1); assert.equal(tab.auth.isLoggedIn(), false);
  const expired = browser({ initial: persisted }).tab(); expired.setFetch(async () => response(401, {}));
  const result = await expired.auth.logout();
  assert.equal(result.success, false); assert.equal(result.expired, true); assert.equal(expired.auth.isLoggedIn(), false);
});

for (const multiTab of [false, true]) test(`A logout -> B login holds full network/body lock (${multiTab ? 'two tabs' : 'same tab'})`, async () => {
  const b = browser({ initial: persisted }), a = b.tab(), other = multiTab ? b.tab() : a;
  const gate = deferred(), sequence = [];
  let browserCookie = 'A';
  const fetch = async url => {
    sequence.push(url);
    if (url === '/api/auth/logout') {
      await gate.promise; browserCookie = null;
      return response(200, { success: true, sessionId: sid });
    }
    browserCookie = 'B'; return loggedIn(sidB);
  };
  a.setFetch(fetch); other.setFetch(fetch);
  const exiting = a.auth.logout(); await settle();
  const entering = other.auth.login('B','pin'); await settle();
  assert.deepEqual(sequence, ['/api/auth/logout']);
  gate.resolve(); assert.equal((await exiting).success, true); assert.equal((await entering).success, true);
  assert.equal(browserCookie, 'B'); assert.equal(other.auth.getSessionMarker(), `${user.id}:${sidB}`);
  assert.equal(other.auth.getAccessToken(), access(sidB));
});

test('without Web Locks the fallback still serializes same-tab mutations', async () => {
  const tab = browser({ locks: false, initial: persisted }).tab(), gate = deferred(), calls = [];
  tab.setFetch(async url => { calls.push(url); if (url.endsWith('logout')) { await gate.promise; return response(200,{success:true, sessionId:sid}); } return loggedIn(sidB); });
  const a = tab.auth.logout(), b = tab.auth.login('B','pin'); await settle();
  assert.equal(calls.length, 1); gate.resolve(); await a; await b;
  assert.equal(tab.auth.getAccessToken(), access(sidB));
});

test('API stale 200/JSON response never crosses an account change', async () => {
  const b = browser({ initial: persisted }), tab = b.tab(), gate = deferred();
  tab.setFetch(async url => url.includes('/auth/refresh') ? refreshed() : gate.promise);
  const pending = tab.auth.apiFetch('/protected'); await settle();
  tab.localStorage.setItem(tab.auth.AUTH_SESSION_KEY, `${user.id}:${sidB}`);
  gate.resolve(response(200, { secret: 'A' }));
  assert.equal(await pending, null);
});

test('socket waits for access, uses Bearer auth callback and closes on confirmed logout', async () => {
  const tab = browser({ initial: persisted }).tab(), gate = deferred(), { api, sockets } = installSocket(tab);
  tab.setFetch(async url => { if (url.endsWith('refresh')) { await gate.promise; return refreshed(); } return response(200,{success:true,sessionId:sid}); });
  const pending = api.connectSocket(); await settle(); assert.equal(sockets.length, 0);
  gate.resolve(); await pending; await settle();
  assert.equal(sockets.length, 1); assert.equal(sockets[0].auth.token, access());
  assert.equal(sockets[0].options.withCredentials, undefined);
  await tab.auth.logout(); assert.equal(sockets[0].closed, true);
});

test('intentional socket disconnect and stale refresh cannot reopen old connection', async () => {
  const tab = browser({ initial: persisted }).tab(), gate = deferred(), { api, sockets } = installSocket(tab);
  tab.setFetch(async () => { await gate.promise; return refreshed(); });
  const pending = api.connectSocket(); await settle(); api.disconnectSocket();
  gate.resolve(); await pending; await settle(); assert.equal(sockets.length, 0);
});

test('actual refresh abort deadline preserves scope and releases auth lock', async () => {
  const tab = browser({ initial: persisted }).tab(); let deadline, signal;
  tab.context.setTimeout = (fn, ms) => { assert.equal(ms, 15000); deadline = fn; return 1; };
  tab.context.clearTimeout = () => {};
  tab.setFetch((_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })));
  }));
  const pending = tab.auth.ensureAccessToken(); await settle(); deadline();
  assert.equal((await pending).ok, false); assert.equal(signal.aborted, true);
  assert.equal(tab.auth.isLoggedIn(), true);
  tab.setFetch(async () => response(200, { success: true, sessionId: sid }));
  assert.equal((await tab.auth.logout()).success, true);
});

test('new tab has no access token even after another tab logged in; all persisted values are nonsecret', async () => {
  const b = browser(), first = b.tab(); first.setFetch(async () => loggedIn());
  await first.auth.login('worker', 'pin');
  const second = b.tab({ online: false });
  assert.equal(second.auth.isLoggedIn(), true); assert.equal(second.auth.getAccessToken(), null);
  assert.ok([...b.entries.values(), ...first.sessionEntries.values()].every(value => !value.includes('.signature')));
});

for (const status of [200, 401, 409]) test(`late logout ${status} cannot clear a newer account after external storage change`, async () => {
  const b = browser({ initial: persisted }), a = b.tab(), gate = deferred();
  a.setFetch(async () => { await gate.promise; return response(status, { success: true, sessionId: sid }); });
  const pending = a.auth.logout(); await settle();
  const other = b.tab(), accountB = { ...user, id: '00000000-0000-4000-8000-000000000002' };
  other.localStorage.setItem('keeptimer-auth-session', `${accountB.id}:${sidB}`);
  other.localStorage.setItem('user', JSON.stringify(accountB));
  gate.resolve(); assert.equal((await pending).stale, true);
  assert.equal(b.entries.get('keeptimer-auth-session'), `${accountB.id}:${sidB}`);
  assert.equal(JSON.parse(b.entries.get('user')).id, accountB.id);
});
