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
const render = (experience,count=0,ready=true) => renderToString(h(Card,{experience,count,ready}));
for (const n of [0,7,10,12]) test('Phase 5 real Vue card: free '+n+'/10 with preserved old records and paid-feature explanation',async()=>{
  const html=await render(policy(),n);assert.match(html,/Ücretsiz Kullanım/);assert.match(html,new RegExp(n+' / 10'));
  assert.match(html,/Normal alarm|Ücretsiz kullanımda en fazla 10/);assert.match(html,/doğrulanmış ücretli/);
  if(n>=10)assert.match(html,/Ücretsiz kullanımda en fazla 10 süreölçer oluşturabilirsiniz/);
  assert.doesNotMatch(html,/Satın al|ödeme|sepet/i);
});
for(const [status,label,detail] of [['active','Aktif','Yalnız size ait'],['pending','Başlaması bekleniyor','henüz başlamadı'],['expired','Süresi doldu','silinmez'],['cancelled','İptal edilmiş','korunur']])
 test('Phase 5 real Vue card: Individual '+status+' shows server status, ending date and appropriate rights',async()=>{
  const html=await render(policy('verified',status));assert.match(html,/Bireysel Kullanıcı/);assert.ok(html.includes(label));assert.ok(html.includes(detail));
  assert.match(html,/datetime="2026-11-01T00:00:00.000002Z"/);assert.match(html,/Abonelik bitişi/);
  assert.match(html,status==='active'?/kullanılabilir/:/kullanılamıyor/);
 });
for(const status of ['offline','unavailable'])test('Phase 5 real Vue card: '+status+' retains data and never presents stale paid rights as usable',async()=>{
  const html=await render(policy(status));assert.match(html,/Haklar doğrulanamadı/);assert.match(html,/Cihazdaki kayıtlarınız korunuyor/);
  assert.match(html,/kullanılamıyor/);assert.match(html,/Hakları yeniden doğrula/);
});
test('Phase 5 real Vue card: unresolved account and initial IndexedDB loading have accessible loading state',async()=>{
  const loading=await render(policy('loading'));assert.match(loading,/Hesap doğrulaması/);assert.match(loading,/Doğrulanıyor/);assert.match(loading,/disabled/);
  assert.doesNotMatch(loading,/Ücretsiz Kullanım/);assert.match(await render(policy(),0,false),/Cihazdaki sayaçlarınız açılıyor/);
});
test('Phase 5 real Vue card: rejected private outbox is visible and never presented as a successful cloud write',async()=>{
  const html=await renderToString(h(Card,{experience:policy('verified'),ready:true,pendingCount:1,syncStatus:'forbidden'}));
  assert.match(html,/Sunucu kişisel değişiklikleri kabul etmedi/);assert.match(html,/henüz hesabınıza aktarılmış sayılmaz/);
});
test('Phase 5 real Vue card: queued private changes stay visible until a real acknowledgement clears them',async()=>{
  const pending=await renderToString(h(Card,{experience:policy('verified'),ready:true,pendingCount:2,syncStatus:'offline'}));
  assert.match(pending,/2 kişisel değişiklik bu cihazda kayıtlı/);
  const clean=await renderToString(h(Card,{experience:policy('verified'),ready:true,pendingCount:0,syncStatus:'done'}));
  assert.doesNotMatch(clean,/aktarılmayı bekliyor|kabul etmedi/);
});
test('Phase 5 component layout uses Tailwind 4 theme tokens, wrapping, touch target and both-theme focus/contrast styles',async()=>{
  const html=await render(policy('verified'));
  for(const token of ['rounded-card','border-border','bg-card','text-text-primary','flex-wrap','break-words','min-w-0','min-h-11','w-full','sm:w-auto','dark:text-text-primary','focus-visible:outline'])assert.ok(html.includes(token),token);
  const source=await readFile(new URL('./AccountStatusCard.vue',import.meta.url),'utf8');
  assert.doesNotMatch(source,/<style|style=|linear-gradient/);assert.match(html,/aria-live="polite"/);assert.match(html,/aria-labelledby="account-status-title"/);
});

test('Phase 6 card: server start date and stale labels remain accessible without implying current rights', async () => {
  const current = policy('verified', 'pending'); current.state.data.subscription.startsAt = '2026-10-31T23:59:59.999999Z';
  const pending = await render(current); assert.match(pending, /Abonelik başlangıcı/);
  assert.match(pending, /datetime="2026-10-31T23:59:59.999999Z"/);
  current.state.status = 'stale'; current.canFeature = () => false;
  const stale = await render(current); assert.match(stale, /Son doğrulanan başlangıç/); assert.match(stale, /Son doğrulanan bitiş/);
  assert.match(stale, /Haklar doğrulanamadı/); assert.match(stale, /kullanılamıyor/); assert.match(stale, /aria-live="polite"/);
});
