import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createRenderer, h, reactive, nextTick } from 'vue';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { response, deferred } from '../services/testSupport/authHarness.js';
import { MFA_NOT_READY } from '../domain/subscriptionManagement.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const compiled = new URL('../../.phase4-management-test.mjs', import.meta.url);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const secret = 'fixture-password-only';
const customer = { id: id(2), username: 'deniz.test', disabledAt: null, status: 'active', endsAt: '2027-01-01T00:00:00Z', isEntitled: false, code: 'INDIVIDUAL_SCOPE_NOT_READY' };
const period = n => ({ id: id(n), customerId: id(2), planCode: 'individual', sequenceNo: n, startsAt: '2026-10-01T00:00:00.000001Z', endsAt: '2026-11-01T00:00:00.000002Z', termMonths: 1, amountMinor: '25000', currency: 'TRY', createdBy: id(1), cancelledAt: null, cancelledBy: null, cancellationReason: null });
let View;
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const text = node => (node.text || '') + (node.children || []).map(text).join('');
const renderer = createRenderer({
  createElement: tag => ({ tag, tagName: tag.toUpperCase(), props: {}, children: [], parent: null, open: false,
    get options() { return walk(this).filter(n => n.tag === 'option'); },
    getRootNode() { return globalThis.document; },
    getAttribute(k) { return this.props[k] ?? null; },
    addEventListener(k, fn) { this.props['on' + k[0].toUpperCase() + k.slice(1)] = fn; }, removeEventListener() {},
    setAttribute(k, v) { this.props[k] = v; }, removeAttribute(k) { delete this.props[k]; },
    focus() { globalThis.document.activeElement = this; },
    showModal() { this.open = true; }, close() { this.open = false; },
  }),
  createText: value => ({ text: value }), createComment: () => ({ text: '' }),
  setText: (n, v) => { n.text = v; }, setElementText: (n, v) => { n.children = [{ text: v }]; },
  patchProp: (n, k, _old, v) => { n.props[k] = v; n[k] = v; },
  parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] || null,
  insert(n, parent, anchor) {
    if (n.parent) { const index = n.parent.children.indexOf(n); if (index >= 0) n.parent.children.splice(index, 1); }
    n.parent = parent; const at = parent.children.indexOf(anchor); parent.children.splice(at < 0 ? parent.children.length : at, 0, n);
  },
  remove(n) { const i = n.parent?.children.indexOf(n); if (i >= 0) n.parent.children.splice(i, 1); },
});
const tick = async () => { await new Promise(resolve => setImmediate(resolve)); await nextTick(); };
function fixture({ role = 'agent', kind = 'customers', native = false, handler } = {}) {
  globalThis.Document = class {}; globalThis.ShadowRoot = class {};
  globalThis.window = new EventTarget(); globalThis.document = Object.assign(new Document(), { activeElement: null });
  const f = { user: { id: id(1), role }, loggedIn: true, native, identity: 'A', calls: [], navigation: [], logouts: 0,
    route: reactive({ meta: { salesRole: kind === 'agents' ? 'superadmin' : 'agent', salesKind: kind }, params: kind === 'history' ? { customerId: id(2) } : {} }),
    handler: handler || (() => response(200, { items: [], nextCursor: null })),
  };
  globalThis.__salesUi = f;
  f.tree = { children: [] }; f.app = renderer.createApp(View);
  f.app.component('RouterLink', { props: ['to'], render() { return h('a', { href: this.to }, this.$slots.default?.()); } });
  f.app.mount(f.tree);
  f.button = label => walk(f.tree).find(n => n.tag === 'button' && text(n) === label);
  f.click = async label => { const n = f.button(label); assert.ok(n, label); assert.ok(!n.props.disabled, `${label} enabled`); n.props.onClick(); await tick(); };
  f.input = async (name, value) => { const n = walk(f.tree).find(n => n.props?.id === 'sales-' + name); assert.ok(n, name); n.props['onUpdate:modelValue'](value); await nextTick(); };
  f.review = async () => { walk(f.tree).find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} }); await tick(); };
  f.dialog = () => walk(f.tree).find(n => n.tag === 'dialog');
  return f;
}
before(async () => {
  const mocks = {
    backend: `const f=()=>globalThis.__salesUi;
      export const BASE_URL='https://mock.invalid'; export const getUser=()=>f().user;
      export const isLoggedIn=()=>f().loggedIn; export const getAuthGeneration=()=>1; export const getTabSessionIdentity=()=>f().identity;
      export const AUTH_SESSION_CHANGED_EVENT='sales-test-session'; export const AUTH_LOCAL_LOGOUT_EVENT='sales-test-logout';
      export const AUTH_LOGIN_REQUIRED_EVENT='sales-test-expired'; export const AUTH_USER_CHANGED_EVENT='sales-test-user';
      export const apiFetch=async(url,opts)=>{f().calls.push({url,opts});return f().handler(url,opts);};
      export const logout=async()=>{f().logouts++;return {success:true};};`,
    router: `export const useRoute=()=>globalThis.__salesUi.route;
      export const useRouter=()=>({push:path=>globalThis.__salesUi.navigation.push(path),replace:path=>globalThis.__salesUi.navigation.push(path)});
      export const onBeforeRouteLeave=fn=>{globalThis.__salesUi.mayLeave=fn;}; export const onBeforeRouteUpdate=fn=>{globalThis.__salesUi.mayUpdate=fn;};`,
    capacitor: `export const Capacitor={getPlatform:()=>globalThis.__salesUi.native?'android':'web',isNativePlatform:()=>globalThis.__salesUi.native};`,
    theme: 'export const useThemeStore=()=>({isDark:false,toggleTheme(){}});',
  };
  const result = await build({ configFile: false, root, logLevel: 'silent', plugins: [{ name: 'test-only-sales-contract', enforce: 'pre',
    resolveId(source) { const key = source.includes('backendSync') ? 'backend' : source === 'vue-router' ? 'router' : source === '@capacitor/core' ? 'capacitor' : source.includes('themeStore') ? 'theme' : null; if (key) return '\0sales-fixture:' + key; },
    load(name) { if (name.startsWith('\0sales-fixture:')) return mocks[name.slice(15)]; },
  }, vue({ template: { compilerOptions: { hoistStatic: false } } })], build: { write: false, minify: false, lib: { entry: root + 'src/views/SubscriptionManagementView.vue', formats: ['es'] }, rollupOptions: { external: ['vue'] } } });
  const code = (Array.isArray(result) ? result[0] : result).output.find(o => o.type === 'chunk').code;
  await writeFile(compiled, code); View = (await import(pathToFileURL(fileURLToPath(compiled)).href)).default;
});
after(async () => { await unlink(compiled).catch(() => {}); delete globalThis.__salesUi; });
for (const role of ['worker', 'manager', 'individual', 'superadmin']) test(`real customer view excludes ${role} and makes no request`, async () => {
  const f = fixture({ role }); try { await tick(); assert.match(text(f.tree), /Yönetim erişimi yok/); assert.equal(f.calls.length, 0); assert.equal(f.button('Yeni müşteri'), undefined); } finally { f.app.unmount(); }
});
test('real SA view excludes agent; native management always blocked', async () => {
  for (const opts of [{ kind: 'agents', role: 'agent' }, { native: true }, { native: true, role: 'superadmin', kind: 'agents' }]) {
    const f = fixture(opts); try { await tick(); assert.equal(f.calls.length, 0); assert.match(text(f.tree), /Yönetim erişimi yok/); } finally { f.app.unmount(); }
  }
});
test('closed release shows exact Turkish MFA notice, retry and disabled create', async () => {
  const f = fixture({ role: 'superadmin', kind: 'agents', handler: () => response(503, { code: 'PRIVILEGED_MFA_NOT_READY', message: secret }) });
  try { await tick(); assert.ok(text(f.tree).includes(MFA_NOT_READY)); assert.ok(f.button('Yeni Vekil').props.disabled); assert.ok(!text(f.tree).includes(secret)); await f.click('Tekrar dene'); assert.equal(f.calls.length, 2); assert.ok(f.calls.every(c => c.opts.method === 'GET')); } finally { f.app.unmount(); }
});
test('SA form validates and confirms without password exposure; active-agent conflict stays explicit', async () => {
  const f = fixture({ role: 'superadmin', kind: 'agents' });
  try {
    await tick(); await f.click('Yeni Vekil'); await f.review(); assert.match(text(f.tree), /Kullanıcı adı 3–25/); assert.equal(f.dialog().open, false);
    await f.input('username', 'vekil.test'); await f.input('password', secret); await f.input('email', 'mfa@example.invalid'); await f.review();
    assert.equal(f.dialog().open, true); assert.ok(!text(f.dialog()).includes(secret)); assert.equal(walk(f.tree).find(n => n.props?.id === 'sales-password').value, '');
    f.handler = () => response(409, { code: 'ACTIVE_AGENT_EXISTS', details: secret }); await f.click('Onayla');
    assert.match(text(f.dialog()), /Zaten aktif bir Vekil var/); assert.ok(!text(f.tree).includes(secret));
    const post = f.calls.find(c => c.opts.method === 'POST'); assert.deepEqual(JSON.parse(post.opts.body), { username: 'vekil.test', password: secret, mfaEmail: 'mfa@example.invalid' });
    f.dialog().props.onCancel({ preventDefault() {} }); await tick(); assert.equal(f.dialog().open, false);
  } finally { f.app.unmount(); }
});
test('customer UI only offers Individual; exact sale body and successful list refresh', async () => {
  const f = fixture(); try {
    await tick(); assert.match(text(f.tree), /Henüz Bireysel müşteri yok/); await f.click('Yeni müşteri');
    assert.ok(!/Enterprise|Team/.test(text(f.tree))); await f.input('username', 'deniz.test'); await f.input('password', secret); await f.input('amount', '250,00'); await f.input('months', '3');
    await f.review(); assert.ok(!text(f.tree).includes(secret)); assert.equal(f.dialog().open, true);
    f.handler = (_url, opts) => response(200, opts.method === 'POST' ? { customerId: id(2), subscription: period(3), loginReady: false } : { items: [customer], nextCursor: null });
    await f.click('Onayla'); assert.equal(f.dialog().open, false); assert.match(text(f.tree), /deniz.test/); assert.match(text(f.tree), /giriş henüz kullanıma açık değil/);
    const body = JSON.parse(f.calls.find(c => c.opts.method === 'POST').opts.body);
    assert.deepEqual(body, { username: 'deniz.test', password: secret, planCode: 'individual', termMonths: 3, amountMinor: 25000, currency: 'TRY' });
    await f.click('Detay ve geçmiş'); assert.deepEqual(f.navigation, [`/agent/customers/${id(2)}`]);
  } finally { f.app.unmount(); }
});
test('pending request blocks buttons/route/escape; ambiguous retry sends same intent', async () => {
  const f = fixture(), gate = deferred(); try {
    await tick(); await f.click('Yeni müşteri'); await f.input('username', 'deniz.test'); await f.input('password', secret); await f.input('amount', '250,00'); await f.review();
    f.handler = () => gate.promise; await f.click('Onayla'); assert.equal(f.mayLeave(), false); assert.equal(f.mayUpdate(), false); assert.ok(f.button('İşlem bekleniyor…').props.disabled);
    f.dialog().props.onCancel({ preventDefault() {} }); await tick(); assert.equal(f.dialog().open, true);
    gate.reject(Error(secret)); await tick(); assert.ok(walk(f.dialog()).find(n => n.tag === 'button' && text(n) === 'Vazgeç').props.disabled); assert.match(text(f.dialog()), /Sonuç belirsiz/);
    const before = f.calls.at(-1).opts;
    f.handler = (_url, opts) => response(200, opts.method === 'POST' ? { customerId: id(2), subscription: period(3), loginReady: false } : { items: [], nextCursor: null });
    await f.click('Aynı işlemi tekrar dene'); const posts = f.calls.filter(c => c.opts.method === 'POST');
    assert.equal(posts.length, 2); assert.equal(posts[1].opts.body, before.body); assert.equal(posts[1].opts.headers['Idempotency-Key'], before.headers['Idempotency-Key']); assert.equal(f.mayLeave(), true);
  } finally { f.app.unmount(); }
});
test('history cancel identifies only the selected customer and period; cancelled periods cannot be chosen', async () => {
  const f = fixture({ kind: 'history', handler: () => response(200, { items: [period(3), { ...period(4), cancelledAt: '2026-10-08T00:00:00Z', cancelledBy: id(1), cancellationReason: 'administrative' }], nextCursor: null }) });
  try {
    await tick(); const buttons = walk(f.tree).filter(n => n.props?.['aria-label']?.startsWith('Dönem ')); assert.equal(buttons.length, 2); assert.ok(buttons[1].props.disabled); buttons[0].props.onClick(); await tick();
    await f.input('reason', 'payment_record_correction'); await f.review(); assert.ok(text(f.dialog()).includes(id(2))); assert.ok(text(f.dialog()).includes(id(3))); assert.ok(!text(f.dialog()).includes(id(4))); assert.match(text(f.dialog()), /Ödeme kaydı düzeltmesi/);
    f.handler = (_url, opts) => response(200, opts.method === 'POST' ? { customerId: id(2), subscription: period(3) } : { items: [], nextCursor: null }); await f.click('Onayla');
    const post = f.calls.find(c => c.opts.method === 'POST'); assert.ok(post.url.endsWith(`/agent/customers/${id(2)}/subscriptions/${id(3)}/cancel`)); assert.deepEqual(JSON.parse(post.opts.body), { reason: 'payment_record_correction' });
  } finally { f.app.unmount(); }
});
test('customer and history UI pagination uses real returned cursors', async () => {
  for (const kind of ['customers', 'history']) {
    const f = fixture({ kind, handler: url => response(200, { items: kind === 'history' ? [period(3)] : [customer], nextCursor: url.includes('after=') ? null : id(3) }) });
    try { await tick(); await f.click('Sonraki'); assert.match(text(f.tree), /Sayfa 2/); assert.ok(f.button('Sonraki').props.disabled); assert.ok(f.calls.at(-1).url.includes(`after=${id(3)}`)); await f.click('Önceki'); assert.match(text(f.tree), /Sayfa 1/); assert.ok(!f.calls.at(-1).url.includes('after=')); } finally { f.app.unmount(); }
  }
});
test('auth identity change clears form/confirmation and revalidates list; same-identity role revocation hides screen', async () => {
  const f = fixture(); try {
    await tick(); await f.click('Yeni müşteri'); await f.input('username', 'deniz.test'); await f.input('password', secret); await f.input('amount', '250'); await f.review(); assert.equal(f.dialog().open, true);
    f.identity = 'B'; window.dispatchEvent(new Event('sales-test-session')); await tick(); assert.equal(f.dialog().open, false); assert.equal(walk(f.tree).find(n => n.tag === 'form'), undefined); assert.equal(f.calls.filter(c => c.opts.method === 'GET').length, 2);
    f.user = { ...f.user, role: 'worker' }; window.dispatchEvent(new Event('sales-test-user')); await tick(); assert.match(text(f.tree), /Yönetim erişimi yok/); assert.deepEqual(f.navigation, ['/']); assert.ok(!text(f.tree).includes(secret));
  } finally { f.app.unmount(); }
});

test('SA active/passive rows permit reset/revoke only on the selected active agent', async () => {
  const agent = { id: id(2), username: 'active.agent', disabledAt: null, mustChangePassword: true };
  const f = fixture({ role: 'superadmin', kind: 'agents', handler: () => response(200, { items: [agent, { ...agent, id: id(3), username: 'former.agent', disabledAt: '2026-10-08T00:00:00Z' }], nextCursor: null }) });
  try {
    await tick(); assert.match(text(f.tree), /Aktif/); assert.match(text(f.tree), /Pasif/);
    const revoke = walk(f.tree).find(n => n.props?.['aria-label'] === 'former.agent yetkisini kaldır'); assert.ok(revoke.props.disabled);
    await f.click('Yetkiyi kaldır'); await f.review(); assert.match(text(f.dialog()), /active.agent/); assert.match(text(f.dialog()), /Hesap ve geçmiş kayıtları silinmez/);
    f.handler = (_url, opts) => response(200, opts.method === 'POST' ? { agentId: id(2), disabled: true } : { items: [agent], nextCursor: null }); await f.click('Onayla');
    const revokePost = f.calls.find(c => c.opts.method === 'POST'); assert.ok(revokePost.url.endsWith(`/admin/agents/${id(2)}/revoke`)); assert.deepEqual(JSON.parse(revokePost.opts.body), {});
    await f.click('Parola sıfırla'); await f.input('password', secret); await f.review(); assert.ok(!text(f.dialog()).includes(secret));
    f.handler = (_url, opts) => response(200, opts.method === 'POST' ? { userId: id(2), mustChangePassword: true, loginReady: false } : { items: [], nextCursor: null }); await f.click('Onayla');
    assert.ok(f.calls.filter(c => c.opts.method === 'POST').at(-1).url.endsWith(`/admin/agents/${id(2)}/password-reset`));
  } finally { f.app.unmount(); }
});
test('history renewal validates amount without inventing dates; pending-period rejection is visible', async () => {
  const f = fixture({ kind: 'history' }); try {
    await tick(); await f.click('Aboneliği yenile'); await f.input('amount', '-1'); await f.review(); assert.equal(f.dialog().open, false); assert.match(text(f.tree), /Tutarı binlik ayırıcı olmadan/);
    await f.input('amount', '250,00'); await f.input('months', '12'); await f.review();
    f.handler = () => response(409, { code: 'PENDING_PERIOD_EXISTS' }); await f.click('Onayla'); assert.match(text(f.dialog()), /Henüz başlamamış bir abonelik dönemi var/);
    const post = f.calls.find(c => c.opts.method === 'POST'); assert.ok(post.url.endsWith(`/agent/customers/${id(2)}/subscriptions`));
    assert.deepEqual(JSON.parse(post.opts.body), { planCode: 'individual', termMonths: 12, amountMinor: 25000, currency: 'TRY' });
  } finally { f.app.unmount(); }
});

async function uncertainFixture() {
  const f = fixture(); await tick(); await f.click('Yeni müşteri'); await f.input('username', 'deniz.test'); await f.input('password', secret); await f.input('amount', '250,00'); await f.review();
  f.handler = () => response(200, { customerId: id(2), loginReady: false }); await f.click('Onayla'); return f;
}
test('revision: malformed 2xx keeps form/confirmation and disables normal logout until replay succeeds', async () => {
  const f = await uncertainFixture(); try {
    assert.equal(f.dialog().open, true); assert.ok(f.button('Çıkış yap').props.disabled); assert.match(text(f.tree), /Sonuç belirsiz/); assert.equal(f.logouts, 0);
    const original = f.calls.at(-1).opts; assert.ok(!text(f.tree).includes(secret));
    assert.ok(walk(f.tree).find(n => n.tag === 'fieldset').props.disabled);
    f.handler = (_url, opts) => response(200, opts.method === 'POST' ? { customerId: id(2), subscription: period(3), loginReady: false } : { items: [customer], nextCursor: null });
    await f.click('Aynı işlemi tekrar dene'); assert.equal(f.dialog().open, false); assert.ok(!f.button('Çıkış yap').props.disabled);
    const replay = f.calls.filter(c => c.opts.method === 'POST').at(-1).opts; assert.equal(replay.body, original.body); assert.equal(replay.headers['Idempotency-Key'], original.headers['Idempotency-Key']);
    await f.click('Çıkış yap'); assert.equal(f.logouts, 1);
  } finally { f.app.unmount(); }
});
test('revision: signOut itself refuses ambiguous network intent, even if the handler is called directly', async () => {
  const f = fixture(); try {
    await tick(); await f.click('Yeni müşteri'); await f.input('username', 'deniz.test'); await f.input('password', secret); await f.input('amount', '250,00'); await f.review();
    f.handler = () => { throw Error(secret); }; await f.click('Onayla'); assert.match(text(f.dialog()), /Sonuç belirsiz/);
    await f.button('Çıkış yap').props.onClick(); await tick(); assert.equal(f.logouts, 0);
    assert.match(text(f.tree), /aynı isteği yeniden deneyerek veya güvenilir satış geçmişinden kontrol ederek/i); assert.equal(f.dialog().open, true);
  } finally { f.app.unmount(); }
});
test('revision: signOut refuses pending intent; logout works once a valid response resolves it', async () => {
  const f = fixture(), gate = deferred(); try {
    await tick(); await f.click('Yeni müşteri'); await f.input('username', 'deniz.test'); await f.input('password', secret); await f.input('amount', '250,00'); await f.review();
    f.handler = (_url, opts) => opts.method === 'POST' ? gate.promise : response(200, { items: [], nextCursor: null }); await f.click('Onayla');
    await f.button('Çıkış yap').props.onClick(); await tick(); assert.equal(f.logouts, 0); assert.ok(f.button('Çıkış yap').props.disabled);
    gate.resolve(response(200, { customerId: id(2), subscription: period(3), loginReady: false })); await tick(); await f.click('Çıkış yap'); assert.equal(f.logouts, 1);
  } finally { f.app.unmount(); }
});
test('revision: externally expired session still clears ambiguous state and routes to login', async () => {
  const f = await uncertainFixture(); try {
    f.loggedIn = false; f.user = null; window.dispatchEvent(new Event('sales-test-expired')); await tick();
    assert.deepEqual(f.navigation, ['/login']); assert.equal(f.dialog(), undefined); assert.equal(walk(f.tree).find(n => n.tag === 'form'), undefined); assert.equal(f.logouts, 0);
  } finally { f.app.unmount(); }
});
