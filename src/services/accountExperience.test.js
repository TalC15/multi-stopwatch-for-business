import test from 'node:test';
import assert from 'node:assert/strict';
import { computed } from 'vue';
import { createAccountExperience } from './accountExperience.js';
import { validateExperience } from '../domain/accountExperience.js';
const id = n => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = { id: id(1), workspace_id: id(2), role: 'worker', plan_code: 'individual' };
const data = (status = 'active', code = null) => ({ account: { kind: 'individual', userId: user.id, workspaceId: user.workspace_id },
  subscription: { planCode: 'individual', status, startsAt: '2026-10-01T00:00:00.000001Z', endsAt: '2026-11-01T00:00:00.000002Z', isEntitled: code === null }, code,
  features: { tts: code === null, telegram: code === null, presets: code === null }, personal: { readable: true, writable: code === null }, shared: false, loginReady: false });
const response = body => ({ ok: true, json: async () => body });
function fixture() {
  let current = { ...user }, clock = 0, connected = true, result = data(), generation = 0;
  const events = new EventTarget();
  const auth = { getUser: () => current, isTabSessionCurrent: () => !!current, getAuthGeneration: () => generation,
    getTabSessionIdentity: () => current?.id+':session', getSessionMarker: () => current?.id+':session', getAccessToken: () => 'synthetic',
    AUTH_SESSION_CHANGED_EVENT: 'session' };
  const policy = createAccountExperience({ auth, request: async () => { if (result instanceof Error) throw result; return typeof result === 'function' ? result() : response(result); },
    baseUrl: 'https://fixture.invalid', events, online: () => connected, monotonicNow: () => clock, timeoutMs: 30 });
  return { policy, events, set: value => { result = value; }, offline: () => { connected = false; events.dispatchEvent(new Event('offline')); },
    online: () => { connected = true; }, advance: n => { clock += n; }, switch: next => { current = next; generation++; events.dispatchEvent(new Event('session')); } };
}

test('Phase 5 verified active microsecond subscription opens exactly personal paid features', async () => {
  const f = fixture(); assert.equal(f.policy.canFeature('tts'), false); assert.equal(await f.policy.refresh(), true);
  assert.equal(f.policy.canFeature('tts'), true); assert.equal(f.policy.canFeature('telegram'), true); assert.equal(f.policy.canFeature('presets'), true);
  assert.equal(f.policy.canShared(), false); assert.equal(await f.policy.requirePersonalWrite({ userId: user.id, workspaceId: user.workspace_id }), true);
  assert.equal(await f.policy.requirePersonalWrite({ userId: id(9), workspaceId: user.workspace_id }), false); f.policy.dispose();
});
for (const [status, code] of [['pending', 'SUBSCRIPTION_PENDING'], ['expired', 'SUBSCRIPTION_EXPIRED'], ['cancelled', 'SUBSCRIPTION_CANCELLED']]) test('Phase 5 '+status+' preserves readable private scope without paid rights', async () => {
  const f = fixture(); f.set(data(status, code)); assert.equal(await f.policy.refresh(), true);
  assert.equal(f.policy.canFeature('tts'), false); assert.equal(f.policy.canWritePersonal(), false);
  assert.equal(f.policy.state.data.personal.readable, true); f.policy.dispose();
});
test('Phase 5 cancelled history cannot override the server-selected active entitlement', async () => {
  const f = fixture(); f.set({ ...data(), history: [{ status: 'cancelled' }] }); assert.equal(await f.policy.refresh(), true);
  assert.equal(f.policy.canFeature('presets'), true); assert.equal('history' in f.policy.state.data, false); f.policy.dispose();
});
test('Phase 5 offline/error/stale verification closes rights and retains only matching display data', async () => {
  const f = fixture(); await f.policy.refresh(); f.offline(); assert.equal(f.policy.canFeature('tts'), false);
  assert.equal(f.policy.state.data.account.userId, user.id); assert.equal(await f.policy.requirePersonalWrite({ userId: user.id, workspaceId: user.workspace_id }), false);
  f.online(); f.set(new Error('network')); assert.equal(await f.policy.refresh(), false); assert.equal(f.policy.canFeature('presets'), false);
  assert.equal(f.policy.state.data.subscription.status, 'active'); f.set(data()); await f.policy.refresh(); f.advance(30001);
  assert.equal(f.policy.canFeature('telegram'), false); f.policy.dispose();
});
test('Phase 5 response arriving after account switch cannot reveal the previous scope or grant rights', async () => {
  const f = fixture(); let finish; f.set(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.policy.refresh(); f.switch({ ...user, id: id(3), workspace_id: id(4) }); finish(response(data()));
  assert.equal(await pending, false); assert.equal(f.policy.state.data, null); assert.equal(f.policy.canFeature('tts'), false); f.policy.dispose();
});
test('Phase 5 standalone and a local plan claim never open paid rights', async () => {
  const f = fixture(); f.switch(null); assert.equal(await f.policy.refresh(), false); assert.equal(f.policy.state.status, 'standalone');
  assert.equal(f.policy.canFeature('tts'), false); f.policy.dispose();
});
test('Phase 5 company policy is derived from verified empty-history server response', async () => {
  const f = fixture(); f.set({ ...data(), account: { ...data().account, kind: 'company' }, subscription: { planCode: null, status: null, startsAt: null, endsAt: null, isEntitled: false },
    code: 'SUBSCRIPTION_REQUIRED', shared: true });
  assert.equal(await f.policy.refresh(), true); assert.equal(f.policy.canShared(), true); assert.equal(f.policy.canFeature('tts'), true); f.policy.dispose();
});
test('Phase 5 verified company keeps offline personal writes in the same session; unverified scope stays closed', async () => {
  const f = fixture(); f.set({ ...data(), account: { ...data().account, kind: 'company' }, subscription: { planCode: null, status: null, startsAt: null, endsAt: null, isEntitled: false },
    code: 'SUBSCRIPTION_REQUIRED', shared: true });
  assert.equal(await f.policy.refresh(), true); f.offline();
  assert.equal(await f.policy.requirePersonalWrite({ userId: user.id, workspaceId: user.workspace_id }), true);
  assert.equal(f.policy.canFeature('tts'), true); assert.equal(await f.policy.requireFeature('presets'), true);
  f.switch({ ...user, id: id(3) });
  assert.equal(f.policy.canFeature('tts'), false);
  assert.equal(await f.policy.requirePersonalWrite({ userId: id(3), workspaceId: user.workspace_id }), false); f.policy.dispose();
});
test('Phase 5 unresolved current session never becomes Standalone during offline refresh', async () => {
  const events = new EventTarget();
  const policy = createAccountExperience({ auth: { getUser: () => null, isTabSessionCurrent: () => true }, events, online: () => false });
  assert.equal(policy.state.status, 'offline'); events.dispatchEvent(new Event('offline'));
  assert.equal(policy.state.status, 'offline'); await policy.refresh();
  assert.equal(policy.state.status, 'offline'); assert.equal(policy.canFeature('presets'), false); policy.dispose();
});
for (const status of [401, 403, 409, 503]) test('Phase 5 company proof cannot reopen offline after server rejection '+status, async () => {
  const f = fixture(); f.set({ ...data(), account: { ...data().account, kind: 'company' }, subscription: { planCode: null, status: null, startsAt: null, endsAt: null, isEntitled: false },
    code: 'SUBSCRIPTION_REQUIRED', shared: true });
  assert.equal(await f.policy.refresh(), true);
  f.set(() => ({ ok: false, status })); assert.equal(await f.policy.refresh(), false); f.offline();
  assert.equal(f.policy.canFeature('tts'), false); assert.equal(await f.policy.requireFeature('presets'), false);
  assert.equal(await f.policy.requirePersonalWrite({ userId: user.id, workspaceId: user.workspace_id }), false);
  assert.equal(f.policy.state.data.account.kind, 'company', 'display data may remain without granting rights'); f.policy.dispose();
});
test('Phase 5 malformed server reply invalidates company offline proof until a fresh valid company reply', async () => {
  const f = fixture(); const company = { ...data(), account: { ...data().account, kind: 'company' }, subscription: { planCode: null, status: null, startsAt: null, endsAt: null, isEntitled: false },
    code: 'SUBSCRIPTION_REQUIRED', shared: true };
  f.set(company); assert.equal(await f.policy.refresh(), true);
  f.set({ ...company, code: ['SUBSCRIPTION_REQUIRED'] }); assert.equal(await f.policy.refresh(), false); f.offline();
  assert.equal(f.policy.canFeature('tts'), false); assert.equal(await f.policy.requireFeature('presets'), false);
  f.online(); f.set(company); assert.equal(await f.policy.refresh(), true); f.offline();
  assert.equal(f.policy.canFeature('tts'), true); f.policy.dispose();
});
test('Phase 5 server rejection received while already offline reactively closes cached company features', async () => {
  const f = fixture(); f.set({ ...data(), account: { ...data().account, kind: 'company' }, subscription: { planCode: null, status: null, startsAt: null, endsAt: null, isEntitled: false },
    code: 'SUBSCRIPTION_REQUIRED', shared: true });
  await f.policy.refresh(); const enabled = computed(() => f.policy.canFeature('tts'));
  let finish; f.set(() => new Promise(resolve => { finish = resolve; })); const pending = f.policy.refresh();
  f.offline(); assert.equal(enabled.value, true); assert.equal(f.policy.state.status, 'offline');
  finish({ ok: false, status: 403 }); assert.equal(await pending, false);
  assert.equal(f.policy.state.status, 'offline'); assert.equal(enabled.value, false); f.policy.dispose();
});
test('Phase 5 late rejection for account A cannot revoke fresh company proof for account B', async () => {
  const f = fixture(); let finish; f.set(() => new Promise(resolve => { finish = resolve; })); const pending = f.policy.refresh();
  const b = { ...user, id: id(3), workspace_id: id(4) }; f.switch(b);
  f.set({ ...data(), account: { kind: 'company', userId: b.id, workspaceId: b.workspace_id }, subscription: { planCode: null, status: null, startsAt: null, endsAt: null, isEntitled: false }, code: 'SUBSCRIPTION_REQUIRED', shared: true });
  assert.equal(await f.policy.refresh(), true); finish({ ok: false, status: 403 }); assert.equal(await pending, false); f.offline();
  assert.equal(f.policy.state.data.account.userId, b.id); assert.equal(f.policy.canFeature('tts'), true); f.policy.dispose();
});
test('Phase 5 transport failure without a server reply preserves same-session company offline behavior', async () => {
  const f = fixture(); f.set({ ...data(), account: { ...data().account, kind: 'company' }, subscription: { planCode: null, status: null, startsAt: null, endsAt: null, isEntitled: false },
    code: 'SUBSCRIPTION_REQUIRED', shared: true });
  assert.equal(await f.policy.refresh(), true); f.set(Error('transport disconnected'));
  assert.equal(await f.policy.refresh(), false); assert.equal(f.policy.canFeature('tts'), false); f.offline();
  assert.equal(f.policy.canFeature('tts'), true); assert.equal(await f.policy.requireFeature('presets'), true);
  assert.equal(await f.policy.requirePersonalWrite({ userId: user.id, workspaceId: user.workspace_id }), true); f.policy.dispose();
});
for (const [label, alter] of [
  ['calendar', x => { x.subscription.startsAt = '2026-02-30T00:00:00Z'; }],
  ['offset', x => { x.subscription.startsAt = '2026-10-01T00:00:00+25:00'; }],
  ['equal microseconds', x => { x.subscription.endsAt = x.subscription.startsAt; }],
  ['reversed', x => { x.subscription.endsAt = '2026-09-01T00:00:00Z'; }],
  ['unknown code', x => { x.code = 'UNKNOWN_CODE'; }],
  ['array code', x => { x.code = ['SUBSCRIPTION_EXPIRED']; }],
  ['foreign account', x => { x.account.userId = id(9); }],
  ['foreign workspace', x => { x.account.workspaceId = id(9); }],
  ['paid mismatch', x => { x.subscription.isEntitled = false; }],
  ['feature mismatch', x => { x.features.tts = false; }],
  ['scope mismatch', x => { x.shared = true; }],
]) test('Phase 5 malformed '+label+' response fails closed', async () => {
  const f = fixture(), x = data(); alter(x); f.set(x); assert.equal(await f.policy.refresh(), false);
  assert.equal(f.policy.canFeature('tts'), false); assert.throws(() => validateExperience(x, user)); f.policy.dispose();
});
test('Phase 5 mixed timezone offsets compare true instants without millisecond loss', () => {
  const x = data(); x.subscription.startsAt = '2026-10-01T03:00:00.000001+03:00'; x.subscription.endsAt = '2026-09-30T20:00:00.000002-04:00';
  assert.equal(validateExperience(x, user).subscription.isEntitled, true);
});
