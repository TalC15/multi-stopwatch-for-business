import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { amountMinor, buildBody, managementRedirect, salesError, MFA_NOT_READY, historyStatus, formatMoney } from '../domain/subscriptionManagement.js';
import { createManagementApi } from './subscriptionManagementApi.js';
import { createManagementController } from '../composables/subscriptionManagement.js';
import { browser, user, loggedIn, response, deferred, settle, refreshed, installSocket } from './testSupport/authHarness.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const secret = 'fixture-password-only';
const form = { username: 'customer.test', password: secret, termMonths: '3', amount: '250,00', currency: 'TRY', mfaEmail: 'TEST@example.invalid' };
const period = (changes = {}) => ({ id: id(3), customerId: id(2), planCode: 'individual', sequenceNo: 1, startsAt: '2026-10-01T00:00:00.000001+00:00', endsAt: '2026-10-01T00:00:00.000002+00:00', termMonths: 3, amountMinor: '25000', currency: 'TRY', createdBy: id(1), cancelledAt: null, cancelledBy: null, cancellationReason: null, ...changes });
const customer = { id: id(2), username: 'customer.test', disabledAt: null, status: 'active', endsAt: '2027-01-08T00:00:00Z', isEntitled: false, code: 'INDIVIDUAL_SCOPE_NOT_READY' };
function fixture(role = 'agent') {
  const ctx = { identity: 'session-A', loggedIn: true, native: false, user: { id: id(1), role } };
  const calls = []; let serial = 100;
  const f = { ctx, calls, handler: () => response(200, { items: [], nextCursor: null }) };
  f.api = createManagementApi({ baseUrl: 'https://mock.invalid', context: () => ctx, uuid: () => id(serial++), request: async (url, opts) => { calls.push({ url, opts }); return f.handler(url, opts); } });
  f.controller = createManagementController(f.api);
  f.controller.reset(role === 'agent' ? 'customers' : 'agents');
  return f;
}
for (const [value, expected] of [['250,00', 25000], ['0.01', 1], ['0', 0], ['90', 9000], ['90071992547409,91', Number.MAX_SAFE_INTEGER]]) test(`exact minor-unit conversion: ${value}`, () => assert.equal(amountMinor(value), expected));
for (const value of ['', '-1', '1e3', '1.000,00', '250,001', ' 250', '250 ', 'NaN', 'Infinity', '90071992547409,92', '999999999999999', 250, ['250']]) test(`reject malformed/unsafe amount ${JSON.stringify(value)}`, () => assert.throws(() => amountMinor(value)));
test('forms whitelist Individual, 1–12 months and safe account fields; client dates/roles never sent', () => {
  const body = buildBody('createCustomer', { ...form, planCode: 'enterprise', role: 'superadmin', startsAt: 'forged', endsAt: 'forged', status: 'active' });
  assert.deepEqual(body, { username: form.username, password: secret, planCode: 'individual', termMonths: 3, amountMinor: 25000, currency: 'TRY' });
  assert.equal(buildBody('createAgent', form).mfaEmail, 'test@example.invalid');
  for (const termMonths of [0, 13, 1.5, '01', [1], '', true]) assert.throws(() => buildBody('renew', { ...form, termMonths }));
  for (const username of ['', 'ab', 'with space', 'a'.repeat(26), ['valid'], 123]) assert.throws(() => buildBody('createAgent', { ...form, username }));
  for (const mfaEmail of ['', 'broken', 'a@b', 'a b@c.d']) assert.throws(() => buildBody('createAgent', { ...form, mfaEmail }));
  for (const password of ['', 'a'.repeat(15), 'x'.repeat(73), '😀'.repeat(19), `123456789012345\n`]) assert.throws(() => buildBody('reset', { password }));
  assert.equal(buildBody('reset', { password: '😀'.repeat(16) }).password, '😀'.repeat(16));
  assert.equal(buildBody('reset', { password: 'x'.repeat(72) }).password.length, 72);
  for (const reason of ['customer_request', 'payment_record_correction', 'administrative']) assert.deepEqual(buildBody('cancel', { reason }), { reason });
  for (const reason of ['', 'delete', ['customer_request']]) assert.throws(() => buildBody('cancel', { reason }));
  assert.deepEqual(buildBody('revoke', { password: secret }), {});
});
test('money formatting keeps integer precision and history labels never grant authority', () => {
  assert.equal(formatMoney('9007199254740991', 'TRY'), '90.071.992.547.409,91 TRY');
  assert.equal(formatMoney('123', 'JPY'), '123 alt birim (JPY)');
  const row = { startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z', cancelledAt: null };
  assert.equal(historyStatus(row, Date.parse('2026-09-01')), 'pending');
  assert.equal(historyStatus(row, Date.parse('2026-10-08')), 'active');
  assert.equal(historyStatus(row, Date.parse('2026-11-01')), 'expired');
  assert.equal(historyStatus({ ...row, cancelledAt: row.startsAt }), 'cancelled');
});
test('actual router enforces role and platform matrix; existing worker/manager routes stay available', async () => {
  const source = await readFile(new URL('../router/index.js', import.meta.url), 'utf8');
  let routes, guard; const actor = { user: null, native: false, loggedIn: false };
  const router = { beforeEach(fn) { guard = fn; } };
  vm.runInNewContext(source.replace(/import[\s\S]*?from ["'][^"']+["'];/g, '').replace('export default router;', ''), {
    createRouter(options) { routes = options.routes; return router; }, createWebHistory() {}, managementRedirect,
    Capacitor: { getPlatform: () => actor.native ? 'android' : 'web', isNativePlatform: () => actor.native },
    isLoggedIn: () => actor.loggedIn, getUser: () => actor.user,
  });
  const route = path => routes.find(r => r.path === path);
  for (const role of ['worker', 'manager', 'individual', 'superadmin', 'agent']) {
    Object.assign(actor, { loggedIn: true, user: { role }, native: false });
    assert.equal(guard(route('/superadmin/agents')), role === 'superadmin' ? undefined : role === 'agent' ? '/agent/customers' : '/');
    for (const path of ['/agent/customers', '/agent/customers/:customerId']) assert.equal(guard(route(path)), role === 'agent' ? undefined : '/');
    actor.native = true;
    for (const path of ['/superadmin/agents', '/agent/customers']) assert.equal(guard(route(path)), '/management-unavailable');
  }
  Object.assign(actor, { loggedIn: true, user: { role: 'agent' }, native: false });
  for (const path of ['/', '/settings', '/manager', '/superadmin', '/profile', '/login']) assert.equal(guard(route(path)), '/agent/customers');
  actor.native = true; assert.equal(guard(route('/')), '/management-unavailable');
  actor.native = false; actor.loggedIn = false; actor.user = null;
  assert.equal(guard(route('/agent/customers')), '/login'); assert.equal(guard(route('/')), undefined);
  actor.loggedIn = true; actor.user = { role: 'manager' }; assert.equal(guard(route('/manager')), undefined);
  actor.user = { role: 'worker' }; assert.equal(guard(route('/')), undefined); assert.equal(guard(route('/manager')), '/');
});
test('API rejects role/native/session access before any request', async () => {
  for (const changes of [{ native: true }, { loggedIn: false }, { identity: null }, { user: { role: 'worker' } }, { user: { role: 'individual' } }]) {
    const f = fixture(); Object.assign(f.ctx, changes);
    await assert.rejects(f.api.list('customers')); assert.throws(() => f.api.prepare('customers', 'createCustomer', null, null, form)); assert.equal(f.calls.length, 0);
  }
  const f = fixture('superadmin'); assert.throws(() => f.api.prepare('agents', 'createCustomer', null, null, form));
});
test('API list paths, after/limit cursor, projection and wrong customer isolation', async () => {
  const f = fixture(); f.handler = () => response(200, { items: [{ ...customer, password: secret, token: 'not-exposed' }], nextCursor: id(2) });
  const data = await f.api.list('customers', null, id(4));
  assert.deepEqual(data.items, [customer]);
  assert.equal(f.calls[0].url, `https://mock.invalid/agent/customers?limit=25&after=${id(4)}`);
  assert.equal(f.calls[0].opts.cache, 'no-store'); assert.equal(f.calls[0].opts.credentials, 'omit');
  assert.equal(f.calls[0].opts.headers?.Origin, undefined);
  await assert.rejects(f.api.list('history', '../admin')); await assert.rejects(f.api.list('customers', null, 'bad'));
  f.handler = () => response(200, { items: [], nextCursor: null });
  await f.api.list('history', id(2), id(3)); assert.match(f.calls.at(-1).url, new RegExp(`/agent/customers/${id(2)}/subscriptions\\?limit=25&after=${id(3)}$`));
  f.handler = () => response(200, { items: [], nextCursor: 'malformed' }); await assert.rejects(f.api.list('customers'), { code: 'SALES_UNAVAILABLE' });
});
for (const [kind, action, target, sub, expected, result] of [
  ['agents', 'createAgent', null, null, '/admin/agents', { agentId: id(2), mustChangePassword: true, loginReady: false }],
  ['agents', 'revoke', id(2), null, `/admin/agents/${id(2)}/revoke`, { agentId: id(2), disabled: true }],
  ['agents', 'reset', id(2), null, `/admin/agents/${id(2)}/password-reset`, { userId: id(2), mustChangePassword: true, loginReady: false }],
  ['customers', 'createCustomer', null, null, '/agent/customers', { customerId: id(2), subscription: period(), loginReady: false }],
  ['customers', 'renew', id(2), null, `/agent/customers/${id(2)}/subscriptions`, { customerId: id(2), subscription: period(), loginReady: false }],
  ['customers', 'cancel', id(2), id(3), `/agent/customers/${id(2)}/subscriptions/${id(3)}/cancel`, { customerId: id(2), subscription: period() }],
  ['customers', 'reset', id(2), null, `/agent/customers/${id(2)}/password-reset`, { userId: id(2), mustChangePassword: true, loginReady: false }],
]) test(`real command contract ${action} (${kind})`, async () => {
  const f = fixture(kind === 'agents' ? 'superadmin' : 'agent'); f.handler = () => response(200, { ...result, password: secret, accessToken: 'hidden' });
  const body = buildBody(action, { ...form, reason: 'customer_request' });
  const output = await f.api.prepare(kind, action, target, sub, body).send();
  assert.deepEqual(output, { id: id(2) }); assert.equal(f.calls[0].url, 'https://mock.invalid' + expected);
  const opts = f.calls[0].opts;
  assert.equal(opts.method, 'POST'); assert.equal(opts.headers['Content-Type'], 'application/json'); assert.equal(opts.headers['X-KeepTimer-CSRF'], '1'); assert.equal(opts.headers['Idempotency-Key'], id(100));
  assert.deepEqual(JSON.parse(opts.body), body); assert.equal(opts.headers.Origin, undefined);
});
for (const [status, code] of [[503,'PRIVILEGED_MFA_NOT_READY'], [403,'PRIVILEGED_MFA_REQUIRED'],[403,'SALES_FORBIDDEN'],[401,'SALES_SESSION_INVALID'],[409,'ACTIVE_AGENT_EXISTS'],[409,'PENDING_PERIOD_EXISTS'],[409,'SUBSCRIPTION_CONFLICT'],[409,'IDEMPOTENCY_CONFLICT'],[429,'SALES_RATE_LIMITED']]) test(`safe Turkish error ${status} ${code}`, async () => {
  const f = fixture(); f.handler = () => response(status, { code, message: secret, password: secret });
  await f.controller.load();
  assert.equal(f.controller.state.ready, false); assert.equal(f.controller.open('createCustomer'), false);
  assert.equal(f.controller.state.errorCode, code); assert.ok(!f.controller.state.error.includes(secret));
  if (code === 'PRIVILEGED_MFA_NOT_READY') assert.equal(f.controller.state.error, MFA_NOT_READY);
});
test('unknown backend error strings are never rendered', () => {
  assert.equal(salesError(secret, 503).code, 'SALES_UNAVAILABLE'); assert.ok(!salesError(secret, 503).message.includes(secret));
  assert.equal(salesError(['SALES_FORBIDDEN'], 401).code, 'SALES_SESSION_INVALID');
});
test('double click sends once; uncertain retry retains exact body/key; later new intent uses a new key', async () => {
  const f = fixture(), c = f.controller, gate = deferred();
  await c.load(); assert.equal(c.open('createCustomer'), true); assert.equal(c.prepare(form), true);
  f.handler = async (_url, opts) => opts.method === 'POST' ? gate.promise : response(200, { items: [customer], nextCursor: null });
  const first = c.submit(); assert.equal(c.submit(), first);
  await settle(); assert.equal(f.calls.filter(v => v.opts.method === 'POST').length, 1);
  assert.equal(c.state.busy, true); gate.reject(Error(secret)); assert.equal(await first, false); await settle();
  assert.equal(c.state.uncertain, true); assert.equal(c.clearAction(), false); assert.equal(c.open('renew'), false); assert.equal(c.next(), undefined);
  const initial = f.calls.at(-1).opts; assert.ok(!JSON.stringify(c.state).includes(secret));
  f.handler = (_url, opts) => response(200, opts.method === 'POST' ? { customerId: id(2), subscription: period(), loginReady: false } : { items: [customer], nextCursor: null });
  assert.equal(await c.submit(), true); await settle();
  const retried = f.calls.filter(v => v.opts.method === 'POST').at(-1).opts;
  assert.equal(retried.body, initial.body); assert.deepEqual(retried.headers, initial.headers);
  assert.equal(c.state.confirm, false); assert.deepEqual(c.state.rows, [customer]); assert.match(c.state.success, /giriş henüz/);
  assert.equal(c.open('createCustomer'), true); assert.equal(c.prepare(form), true); await c.submit();
  assert.notEqual(f.calls.filter(v => v.opts.method === 'POST').at(-1).opts.headers['Idempotency-Key'], initial.headers['Idempotency-Key']);
});
test('read and write outcomes from an old identity cannot populate a new session', async () => {
  const f = fixture(), gate = deferred(); f.handler = () => gate.promise;
  const loading = f.controller.load(); f.ctx.identity = 'session-B'; gate.resolve(response(200, { items: [customer], nextCursor: null })); await loading;
  assert.equal(f.controller.state.ready, false); assert.deepEqual(f.controller.state.rows, []); assert.equal(f.controller.state.errorCode, 'SESSION_CHANGED');
  f.handler = () => response(200, { items: [], nextCursor: null }); await f.controller.load(); f.controller.open('createCustomer'); f.controller.prepare(form);
  f.ctx.identity = 'session-C'; const before = f.calls.length; await f.controller.submit();
  assert.equal(f.calls.length, before); assert.equal(f.controller.state.errorCode, 'SESSION_CHANGED');
});
test('reset invalidates pending reads and writes, dropping secrets and completion callbacks', async () => {
  const f = fixture(), c = f.controller, gate = deferred(); await c.load(); c.open('createCustomer'); c.prepare(form);
  f.handler = () => gate.promise; const pending = c.submit(); c.reset('customers');
  gate.resolve(response(200, { customerId: id(2), subscription: period(), loginReady: false })); assert.equal(await pending, false);
  assert.equal(c.state.action, null); assert.equal(c.state.success, ''); assert.equal(c.state.confirm, false); assert.deepEqual(c.state.rows, []);
});
for (const kind of ['customers', 'history']) test(`${kind} next/previous pages use correct cursor, not arbitrary offsets`, async () => {
  const f = fixture(), c = f.controller; c.reset(kind, kind === 'history' ? id(2) : null);
  f.handler = url => response(200, { items: [], nextCursor: url.includes('after=') ? null : id(3) });
  await c.load(); await c.next(); assert.equal(c.state.page, 1); assert.match(f.calls.at(-1).url, /after=/); assert.equal(c.next(), undefined);
  await c.previous(); assert.equal(c.state.page, 0); assert.ok(!f.calls.at(-1).url.includes('after='));
});
test('malformed successful write is uncertain and cannot allow a fresh duplicate sale', async () => {
  const f = fixture(), c = f.controller; await c.load(); c.open('createCustomer'); c.prepare(form);
  f.handler = () => response(200, { customerId: id(2), loginReady: true, password: secret }); await c.submit();
  assert.equal(c.state.uncertain, true); assert.equal(c.clearAction(), false); assert.ok(!c.state.mutationError.includes(secret));
});
test('real apiFetch owns bearer and 401 refresh; retransmission preserves idempotency and secrets stay out of storage', async () => {
  const b = browser(), tab = b.tab(), calls = []; const account = { ...user, role: 'agent' };
  tab.setFetch(() => loggedIn(undefined, account)); await tab.auth.login('fixture', '1234');
  let count = 0;
  tab.setFetch((url, opts) => { calls.push({ url, opts }); if (url === '/api/auth/refresh') return refreshed(); return response(++count === 1 ? 401 : 200, count === 1 ? {} : { customerId: id(2), subscription: period(), loginReady: false }); });
  const api = createManagementApi({ baseUrl: 'https://mock.invalid', request: tab.auth.apiFetch, uuid: () => id(100), context: () => ({ user: tab.auth.getUser(), identity: tab.auth.getTabSessionIdentity(), loggedIn: tab.auth.isLoggedIn(), native: false }) });
  await api.prepare('customers', 'createCustomer', null, null, buildBody('createCustomer', form)).send();
  const posts = calls.filter(c => c.url.endsWith('/agent/customers'));
  assert.equal(posts.length, 2); assert.ok(calls.some(c => c.url === '/api/auth/refresh'));
  for (const { opts } of posts) {
    assert.match(new Headers(opts.headers).get('Authorization'), /^Bearer /);
    assert.equal(new Headers(opts.headers).get('X-KeepTimer-CSRF'), '1'); assert.equal(new Headers(opts.headers).get('Idempotency-Key'), id(100));
    assert.equal(opts.body, JSON.stringify(buildBody('createCustomer', form)));
  }
  assert.ok(b.writes.every(w => !w.value.includes(secret) && !w.value.includes('.signature')));
});
test('agent auth fixture never opens timer Socket.IO; existing worker socket regressions remain separate', async () => {
  const tab = browser().tab(); tab.setFetch(() => loggedIn(undefined, { ...user, role: 'agent' })); await tab.auth.login('fixture', '1234');
  const socket = installSocket(tab); socket.api.connectSocket(); await settle(); assert.equal(socket.sockets.length, 0);
});

// Revision tests exercise the real API factory; no validator mocks.
for (const [action, subscription] of [
  ['createCustomer', undefined], ['createCustomer', null], ['createCustomer', []],
  ['renew', {}], ['renew', period({ customerId: id(9) })],
]) test(`revision: ${action} rejects missing/malformed/wrong-customer subscription`, async () => {
  const f = fixture(); f.handler = () => response(201, { customerId: id(2), subscription, loginReady: false });
  await assert.rejects(f.api.prepare('customers', action, action === 'renew' ? id(2) : null, null, buildBody(action, form)).send(), { code: 'SALES_UNAVAILABLE', uncertain: true });
});
for (const [kind, action] of [['agents','createAgent'], ['agents','reset'], ['customers','reset']]) {
  for (const flag of [undefined, false]) test(`revision: ${kind}/${action} requires mustChangePassword=true (${flag})`, async () => {
    const f = fixture(kind === 'agents' ? 'superadmin' : 'agent');
    f.handler = () => response(200, { [action === 'createAgent' ? 'agentId' : 'userId']: id(2), mustChangePassword: flag, loginReady: false });
    await assert.rejects(f.api.prepare(kind, action, action === 'reset' ? id(2) : null, null, buildBody(action, form)).send(), { code: 'SALES_UNAVAILABLE', uncertain: true });
  });
}
for (const missing of Object.keys(period())) test(`revision: subscription requires ${missing}`, async () => {
  const f = fixture(), subscription = period(); delete subscription[missing];
  f.handler = () => response(200, { customerId: id(2), subscription, loginReady: false });
  await assert.rejects(f.api.prepare('customers', 'renew', id(2), null, buildBody('renew', form)).send(), { code: 'SALES_UNAVAILABLE', uncertain: true });
});
for (const [label, changes] of [
  ['bad calendar', { startsAt: '2026-02-30T00:00:00Z' }], ['bad format', { startsAt: 'not-a-timestamp' }],
  ['bad offset', { startsAt: '2026-10-01T00:00:00+24:00' }], ['bad offset minutes', { endsAt: '2026-10-01T00:00:00+00:60' }],
  ['equal microsecond', { endsAt: '2026-10-01T00:00:00.000001Z' }], ['earlier microsecond', { endsAt: '2026-10-01T00:00:00.000000Z' }],
  ['orphan actor', { cancelledBy: id(1) }], ['orphan reason', { cancellationReason: 'administrative' }],
  ['invalid cancel date', { cancelledAt: 'bad', cancelledBy: id(1) }], ['missing cancel actor', { cancelledAt: '2026-10-01T00:00:00Z' }],
  ['invalid actor UUID', { createdBy: 'actor' }], ['UUID with trailing newline', { createdBy: `${id(1)}\n` }], ['wrong plan', { planCode: 'enterprise' }],
  ['bad sequence', { sequenceNo: 0 }], ['bad duration', { termMonths: 13 }], ['numeric money', { amountMinor: 25000 }],
  ['negative money', { amountMinor: '-1' }], ['bad currency', { currency: 'try' }], ['unknown cancellation reason', { cancellationReason: 'delete', cancelledAt: '2026-10-01T00:00:00Z', cancelledBy: id(1) }],
]) test(`revision: malformed subscription ${label} is uncertain`, async () => {
  const f = fixture(); f.handler = () => response(200, { customerId: id(2), subscription: period(changes), loginReady: false });
  await assert.rejects(f.api.prepare('customers', 'createCustomer', null, null, buildBody('createCustomer', form)).send(), { code: 'SALES_UNAVAILABLE', uncertain: true });
});
test('revision: cancel rejects a different subscription and a malformed matching subscription', async () => {
  const f = fixture();
  for (const subscription of [period({ id: id(9) }), { id: id(3) }, period({ customerId: id(9) })]) {
    f.handler = () => response(200, { customerId: id(2), subscription });
    await assert.rejects(f.api.prepare('customers', 'cancel', id(2), id(3), { reason: 'customer_request' }).send(), { code: 'SALES_UNAVAILABLE', uncertain: true });
  }
});
for (const changes of [
  {}, { startsAt: '2026-10-01T02:00:00.000001+02:00', endsAt: '2026-09-30T23:00:00.000002-01:00' },
  { startsAt: '2026-10-01 02:00:00.1+02', endsAt: '2026-10-01 00:00:00.100001+00' },
  { startsAt: '2026-10-01T02:00:00.123456+0200', endsAt: '2026-10-01T00:00:00.123457Z' },
  { startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z', amountMinor: '9223372036854775807' },
  { cancelledAt: '2026-09-30T00:00:00.000001Z', cancelledBy: id(1), cancellationReason: null },
]) test(`revision: valid PostgreSQL period ${JSON.stringify(changes)} remains accepted`, async () => {
  const f = fixture(); f.handler = () => response(200, { customerId: id(2), subscription: period(changes), loginReady: false });
  assert.deepEqual(await f.api.prepare('customers', 'renew', id(2), null, buildBody('renew', form)).send(), { id: id(2) });
});
const alphaCustomer = 'abcdefab-cdef-4abc-8abc-abcdefabcdef';
const alphaPeriod = 'fedcba98-abcd-4abc-8abc-fedcbafedcba';
test('revision: uppercase history customer/cursor and response IDs are canonicalized', async () => {
  const f = fixture(); f.handler = () => response(200, { items: [period({ id: alphaPeriod.toUpperCase(), customerId: alphaCustomer })], nextCursor: alphaPeriod.toUpperCase() });
  const data = await f.api.list('history', alphaCustomer.toUpperCase(), alphaPeriod.toUpperCase());
  assert.equal(data.items[0].id, alphaPeriod); assert.equal(data.items[0].customerId, alphaCustomer); assert.equal(data.nextCursor, alphaPeriod);
  assert.ok(f.calls[0].url.endsWith(`/agent/customers/${alphaCustomer}/subscriptions?limit=25&after=${alphaPeriod}`));
});
for (const action of ['renew', 'cancel', 'reset', 'revoke']) test(`revision: UUID casing matches for ${action}`, async () => {
  const f = fixture(action === 'revoke' ? 'superadmin' : 'agent');
  f.handler = () => response(200, action === 'revoke' ? { agentId: alphaCustomer, disabled: true } : action === 'reset' ?
    { userId: alphaCustomer, mustChangePassword: true, loginReady: false } : { customerId: alphaCustomer.toUpperCase(), subscription: period({ id: alphaPeriod, customerId: alphaCustomer }), loginReady: false });
  const output = await f.api.prepare(action === 'revoke' ? 'agents' : 'customers', action, alphaCustomer.toUpperCase(), action === 'cancel' ? alphaPeriod.toUpperCase() : null, buildBody(action, { ...form, reason: 'administrative' })).send();
  assert.deepEqual(output, { id: alphaCustomer }); assert.ok(f.calls[0].url.includes(alphaCustomer)); assert.ok(!f.calls[0].url.includes(alphaCustomer.toUpperCase()));
});
test('revision: invalid UUID rejected before transport and distinct normalized UUIDs stay distinct', async () => {
  const f = fixture(); const count = f.calls.length;
  for (const invalid of ['not-a-uuid', `${alphaCustomer}\n`, null, 123, [alphaCustomer]]) {
    await assert.rejects(f.api.list('history', invalid), { code: 'SALES_INPUT_INVALID' });
    assert.throws(() => f.api.prepare('customers', 'renew', invalid, null, {}), { code: 'SALES_INPUT_INVALID' });
  }
  assert.equal(f.calls.length, count);
  f.handler = () => response(200, { customerId: alphaCustomer, subscription: period({ customerId: alphaCustomer }), loginReady: false });
  await assert.rejects(f.api.prepare('customers', 'renew', id(2), null, buildBody('renew', form)).send(), { code: 'SALES_UNAVAILABLE', uncertain: true });
});
test('revision: malformed 2xx retains confirmation and exact attempt; valid replay clears it', async () => {
  const f = fixture(), c = f.controller; await c.load(); c.open('createCustomer'); c.prepare(form);
  f.handler = () => response(200, { customerId: id(2), loginReady: false, password: secret });
  assert.equal(await c.submit(), false); await settle();
  assert.equal(c.state.confirm, true); assert.equal(c.state.action, 'createCustomer'); assert.equal(c.state.uncertain, true); assert.equal(c.state.busy, false); assert.equal(c.state.success, '');
  assert.equal(c.clearAction(), false); assert.equal(c.open('createCustomer'), false); assert.ok(!JSON.stringify(c.state).includes(secret));
  const initial = f.calls.at(-1).opts;
  f.handler = (_url, opts) => response(200, opts.method === 'POST' ? { customerId: id(2), subscription: period(), loginReady: false } : { items: [customer], nextCursor: null });
  assert.equal(await c.submit(), true); await settle(); const replay = f.calls.filter(v => v.opts.method === 'POST').at(-1).opts;
  assert.equal(replay.body, initial.body); assert.deepEqual(replay.headers, initial.headers); assert.equal(JSON.parse(replay.body).password, secret);
  assert.equal(c.state.action, null); assert.equal(c.state.confirm, false); assert.equal(c.state.uncertain, false); assert.deepEqual(c.state.rows, [customer]);
});
