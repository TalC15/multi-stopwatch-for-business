import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { h } from 'vue';
import { renderToString } from '@vue/server-renderer';
const root = fileURLToPath(new URL('../../', import.meta.url));
const compiled = new URL('../../.phase5-account-card-test.mjs', import.meta.url);
let Card;
before(async () => {
  const result = await build({ root, configFile: false, logLevel: 'silent', plugins: [vue()],
    build: { write: false, minify: false, lib: { entry: root+'src/components/AccountStatusCard.vue', formats: ['es'] }, rollupOptions: { external: ['vue'] } } });
  const output = (Array.isArray(result) ? result[0] : result).output.find(x => x.type==='chunk');
  await writeFile(compiled, output.code); Card = (await import(compiled.href)).default;
});
after(async () => { await unlink(compiled).catch(()=>{}); });
const policy = (status='standalone', subscription='active') => ({ state: { status, data: status === 'standalone' || status === 'loading' ? null : {
  account: { kind:'individual' }, subscription: { status:subscription, isEntitled:subscription==='active', endsAt:'2026-11-01T00:00:00.000002Z' } } },
  canFeature: () => status==='verified' && subscription==='active' });
const render = (experience, extra={}) => renderToString(h(Card,{experience,ready:true,...extra}));
for (const count of [0,7,10,12]) test('UX normal standalone screen has no persistent quota card: '+count,async()=>{
 assert.equal(await render(policy(),{count}), '<!--v-if-->');
});
for (const state of ['loading','verified','stale','offline','unavailable']) test('UX normal account screen has no periodic status or feature dashboard: '+state,async()=>{
 assert.equal(await render(policy(state)), '<!--v-if-->');
});
for (const subscription of ['active','pending','expired','cancelled']) test('UX profile retains subscription details without claiming cached authority: '+subscription,async()=>{
 const current=policy('stale',subscription);const html=await render(current,{details:true});
 assert.match(html,/Son alınan hesap bilgisi/);assert.match(html,/Kayıtlarınız korunur/);assert.match(html,/datetime=/);
 assert.doesNotMatch(html,/kullanılabilir|Hakları yeniden doğrula|Ücretli özellikler/);
});
for(const syncStatus of ['forbidden','auth-required','conflict','retry'])test('UX critical sync status remains actionable: '+syncStatus,async()=>{
 const html=await render(policy('verified'),{syncStatus});assert.match(html,/role="status"/);assert.match(html,/Yeniden dene/);assert.match(html,/korunuyor/);
});
test('UX ordinary queued changes stay silent while sync failures remain actionable',async()=>{
 for(const syncStatus of ['idle','syncing','done']) {
  assert.equal(await render(policy('verified'),{pendingCount:2,syncStatus}),'<!--v-if-->');
 }
 for(const syncStatus of ['retry','forbidden','auth-required','conflict']) {
  const html=await render(policy('verified'),{pendingCount:2,syncStatus});
  assert.match(html,/role="status"/);assert.match(html,/Yeniden dene/);
  assert.doesNotMatch(html,/2 kişisel değişiklik/);
 }
 assert.equal(await render(policy('verified'),{pendingCount:0,syncStatus:'done'}),'<!--v-if-->');
});
test('UX sync notice retains responsive theme and keyboard focus styles',async()=>{
 const html=await render(policy('verified'),{pendingCount:1,syncStatus:'retry'});
 for(const token of ['rounded-card','border-border','bg-card','text-text-primary','break-words','min-w-0','min-h-11','w-full','sm:w-auto','dark:text-text-primary','focus-visible:outline'])assert.ok(html.includes(token),token);
 const source=await readFile(new URL('./AccountStatusCard.vue',import.meta.url),'utf8');assert.doesNotMatch(source,/<style|style=|linear-gradient/);
 assert.match(html,/aria-live="polite"/);
});
