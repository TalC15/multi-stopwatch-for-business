<script setup>
import { computed, reactive, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { Capacitor } from '@capacitor/core';
import * as auth from '../services/backendSync.js';
import { useThemeStore } from '../stores/themeStore.js';
import { createManagementApi } from '../services/subscriptionManagementApi.js';
import { createManagementController } from '../composables/subscriptionManagement.js';
import { currencies, cancellationReasons, formatDate, formatMoney, historyStatus, statusNames } from '../domain/subscriptionManagement.js';
import ManagementDialog from '../components/ui/ManagementDialog.vue';

const route = useRoute(), router = useRouter(), theme = useThemeStore();
const authVersion = ref(0), selectedCustomer = ref(null), details = ref([]);
function context() {
  void authVersion.value;
  const user = auth.getUser(), loggedIn = auth.isLoggedIn();
  return { user, loggedIn, native: Capacitor.getPlatform() !== 'web' || Capacitor.isNativePlatform(),
    identity: loggedIn ? `${user?.id}|${auth.getAuthGeneration()}|${auth.getTabSessionIdentity()}` : null };
}
const allowed = computed(() => !context().native && context().loggedIn && context().user?.role === route.meta.salesRole);
const api = createManagementApi({ request: auth.apiFetch, baseUrl: auth.BASE_URL, context });
const controller = createManagementController(api), state = controller.state;
const emptyForm = () => ({ username: '', password: '', mfaEmail: '', termMonths: '1', amount: '', currency: 'TRY', reason: '' });
const form = reactive(emptyForm());
const title = computed(() => state.kind === 'agents' ? 'Vekil Yönetimi' : state.kind === 'customers' ? 'Bireysel Müşteri Yönetimi' : 'Abonelik geçmişi');
const customerName = computed(() => selectedCustomer.value?.id === state.customerId ? selectedCustomer.value.username : 'Bireysel müşteri');
const actionTitles = { createAgent: 'Yeni Vekil', createCustomer: 'Yeni Bireysel müşteri', renew: 'Abonelik yenileme', cancel: 'Dönemi iptal et', reset: 'Parola sıfırlama', revoke: 'Vekil yetkisini kaldır' };
const saleForm = computed(() => ['createCustomer', 'renew'].includes(state.action));
const accountForm = computed(() => ['createAgent', 'createCustomer'].includes(state.action));
const passwordForm = computed(() => accountForm.value || state.action === 'reset');
function open(action, target) { if (controller.open(action, target)) Object.assign(form, emptyForm()); }
function cancelAction() { if (controller.clearAction()) Object.assign(form, emptyForm()); }
function confirmForm() {
  if (!controller.prepare(form)) return;
  const name = accountForm.value ? form.username : state.kind === 'history' ? customerName.value : state.target?.username;
  details.value = [name, ...(state.customerId ? [`Müşteri: ${state.customerId}`] : [])];
  if (saleForm.value) details.value.push(`${form.termMonths} ay · ${form.amount} ${form.currency}`, 'Ödeme sistem dışında alınır; bu işlem yalnız satış kaydı oluşturur. Başlangıç ve bitişi sunucu belirler.');
  if (state.action === 'cancel') details.value.push(`Dönem #${state.target.sequenceNo} · ${state.target.id}`, `${formatDate(state.target.startsAt)} — ${formatDate(state.target.endsAt)}`, cancellationReasons[form.reason], 'Yalnız bu dönem iptal edilir. Diğer dönemler, müşteri ve süreölçerler korunur.');
  if (state.action === 'revoke') details.value.push('Vekil’in oturumları iptal edilir. Hesap ve geçmiş kayıtları silinmez.');
  if (passwordForm.value) details.value.push('Yeni parola onay ekranında gösterilmez. Yeni hesapların parola ile girişi henüz kullanıma açık değildir.');
  if (state.action === 'reset') details.value.push('Mevcut oturumlar iptal edilir ve ilk girişte parola değişikliği gerekir.');
  form.password = '';
}
function openCustomer(row) { selectedCustomer.value = { id: row.id, username: row.username }; void router.push(`/agent/customers/${row.id}`); }
const mayLeave = () => !controller.blocked();
onBeforeRouteLeave(mayLeave); onBeforeRouteUpdate(mayLeave);
function beforeUnload(event) { if (controller.blocked()) { event.preventDefault(); event.returnValue = ''; } }
function sessionChanged() {
  authVersion.value++;
  const next = context().identity;
  if (next !== mountedIdentity || !allowed.value) {
    controller.reset(route.meta.salesKind, route.params.customerId || null);
    Object.assign(form, emptyForm()); selectedCustomer.value = null; details.value = [];
    mountedIdentity = next;
    if (allowed.value) void controller.load();
    else void router.replace(auth.isLoggedIn() ? (auth.getUser()?.role === 'agent' ? '/agent/customers' : '/') : '/login');
  }
}
let mountedIdentity = context().identity;
const events = [auth.AUTH_SESSION_CHANGED_EVENT, auth.AUTH_LOCAL_LOGOUT_EVENT, auth.AUTH_LOGIN_REQUIRED_EVENT, auth.AUTH_USER_CHANGED_EVENT];
for (const event of events) window.addEventListener(event, sessionChanged);
window.addEventListener('beforeunload', beforeUnload);
watch(() => [route.meta.salesKind, route.params.customerId], ([kind, customerId]) => {
  controller.reset(kind, customerId || null); Object.assign(form, emptyForm()); details.value = [];
  mountedIdentity = context().identity;
  if (allowed.value) void controller.load();
}, { immediate: true });
onBeforeUnmount(() => {
  for (const event of events) window.removeEventListener(event, sessionChanged);
  window.removeEventListener('beforeunload', beforeUnload);
  controller.reset(); Object.assign(form, emptyForm()); selectedCustomer.value = null; details.value = [];
});
async function signOut() {
  if (controller.blocked()) return;
  const result = await auth.logout();
  if (!result.success) state.error = 'Çıkış doğrulanamadı. Tekrar deneyin.';
}
</script>

<template>
  <div class="sales-page">
    <header class="sales-header">
      <div><span class="brand">KeepTimer</span><span class="eyebrow">WEB YÖNETİMİ</span></div>
      <div class="header-actions">
        <button type="button" @click="theme.toggleTheme()" :aria-pressed="theme.isDark">{{ theme.isDark ? 'Açık tema' : 'Koyu tema' }}</button>
        <button type="button" :disabled="controller.blocked()" @click="signOut">Çıkış yap</button>
      </div>
    </header>
    <main v-if="allowed" class="sales-content">
      <nav aria-label="Yönetim gezinmesi" class="breadcrumbs">
        <RouterLink v-if="state.kind === 'agents'" to="/superadmin">Superadmin</RouterLink>
        <button v-else-if="state.kind === 'history'" type="button" :disabled="controller.blocked()" @click="router.push('/agent/customers')">Müşteriler</button>
        <span v-else>Bireysel abonelikler</span><span aria-hidden="true"> / </span><span>{{ title }}</span>
      </nav>
      <section class="page-heading">
        <div><p class="eyebrow">{{ state.kind === 'agents' ? 'SUPERADMIN' : 'VEKİL' }}</p><h1>{{ title }}</h1>
          <p v-if="state.kind === 'history'">{{ customerName }} <span class="identifier">{{ state.customerId }}</span></p>
          <p v-else>{{ state.kind === 'agents' ? 'Tek aktif Vekil. Yetki ve hesap geçmişi birlikte korunur.' : 'Bireysel hesaplar, satış kayıtları ve abonelik dönemleri.' }}</p>
        </div>
        <button v-if="state.kind !== 'history'" type="button" class="primary" :disabled="!state.ready || state.loading || !!state.action" @click="open(state.kind === 'agents' ? 'createAgent' : 'createCustomer')">{{ state.kind === 'agents' ? 'Yeni Vekil' : 'Yeni müşteri' }}</button>
        <div v-else class="header-actions">
          <button type="button" class="primary" :disabled="!state.ready || !!state.action" @click="open('renew')">Aboneliği yenile</button>
          <button type="button" :disabled="!state.ready || !!state.action" @click="open('reset')">Parolayı sıfırla</button>
        </div>
      </section>
      <p class="notice">Yönetim işlemleri için e-posta güvenlik doğrulaması gerekir. Yeni hesapların parola ile girişi henüz kullanıma açık değildir.</p>
      <p v-if="state.uncertain" role="status" class="notice">Çıkış yapmadan önce aynı isteği yeniden deneyerek veya güvenilir satış geçmişinden kontrol ederek sonucu netleştirin.</p>
      <div v-if="state.error" role="alert" class="notice error"><p>{{ state.error }}</p><button type="button" :disabled="state.loading || controller.blocked() || state.confirm" @click="controller.load()">Tekrar dene</button></div>
      <p v-if="state.success" role="status" class="notice success">{{ state.success }}</p>

      <section v-if="state.action" class="panel form-panel" :aria-labelledby="'form-title'">
        <h2 id="form-title">{{ actionTitles[state.action] }}</h2>
        <form @submit.prevent="confirmForm">
          <fieldset :disabled="state.confirm || state.busy || !state.ready">
            <div class="form-grid">
              <div v-if="accountForm"><label for="sales-username">Kullanıcı adı</label><input id="sales-username" v-model="form.username" required maxlength="25" autocomplete="off" /><p class="help">3–25 karakter; harf, rakam, nokta, alt çizgi veya tire.</p></div>
              <div v-if="passwordForm"><label for="sales-password">{{ state.action === 'reset' ? 'Yeni güçlü parola' : 'Güçlü başlangıç parolası' }}</label><input id="sales-password" v-model="form.password" type="password" :required="!state.confirm" autocomplete="new-password" aria-describedby="password-help" /><p id="password-help" class="help">En az 16 karakter; en fazla 72 UTF-8 byte. Parola bu cihazda kalıcı saklanmaz ve onayda gösterilmez.</p></div>
              <div v-if="state.action === 'createAgent'"><label for="sales-email">MFA e-posta adresi</label><input id="sales-email" v-model="form.mfaEmail" type="email" required maxlength="254" autocomplete="off" /></div>
              <template v-if="saleForm">
                <div><label for="sales-months">Abonelik süresi</label><select id="sales-months" v-model="form.termMonths"><option v-for="month in 12" :key="month" :value="String(month)">{{ month }} ay</option></select></div>
                <div><label for="sales-amount">Kaydedilecek satış tutarı</label><input id="sales-amount" v-model="form.amount" inputmode="decimal" required maxlength="18" placeholder="0,00" aria-describedby="amount-help" /><p id="amount-help" class="help">Binlik ayırıcı kullanmayın. Ödeme burada alınmaz.</p></div>
                <div><label for="sales-currency">Para birimi</label><select id="sales-currency" v-model="form.currency"><option v-for="currency in currencies" :key="currency" :value="currency">{{ currency }}</option></select></div>
              </template>
              <div v-if="state.action === 'cancel'"><label for="sales-reason">İptal nedeni</label><select id="sales-reason" v-model="form.reason" required><option disabled value="">Neden seçin</option><option v-for="(label, key) in cancellationReasons" :key="key" :value="key">{{ label }}</option></select></div>
            </div>
            <p v-if="saleForm" class="help">Paket: Bireysel (Individual). Aktif dönem bitişi veya güncel başlangıç tarihi sunucu tarafından belirlenir. Bekleyen dönem varsa yeni yenileme reddedilebilir.</p>
            <p v-if="state.action === 'revoke'" class="help">{{ state.target?.username }} hesabının yetkisi kaldırılacak. Geçmiş kayıtları korunacak.</p>
            <p v-if="state.formError" role="alert" class="notice error">{{ state.formError }}</p>
            <div class="form-actions"><button type="button" @click="cancelAction">Vazgeç</button><button type="submit" class="primary">Bilgileri gözden geçir</button></div>
          </fieldset>
        </form>
      </section>

      <section class="panel" :aria-busy="state.loading" aria-label="Kayıt listesi">
        <p v-if="state.loading" role="status" class="empty">Kayıtlar yükleniyor…</p>
        <p v-else-if="state.ready && !state.rows.length" class="empty">{{ state.kind === 'history' ? 'Bu müşteriye ait abonelik dönemi bulunamadı.' : state.kind === 'agents' ? 'Henüz Vekil kaydı yok.' : 'Henüz Bireysel müşteri yok.' }}</p>
        <div v-else-if="state.ready" class="table-scroll" tabindex="0" aria-label="Yatay kaydırılabilir kayıtlar">
          <table v-if="state.kind !== 'history'">
            <caption class="sr-only">{{ title }}</caption><thead><tr><th scope="col">Kullanıcı adı</th><th scope="col">Durum</th><th v-if="state.kind === 'customers'" scope="col">Abonelik bitişi</th><th scope="col">İşlemler</th></tr></thead>
            <tbody><tr v-for="row in state.rows" :key="row.id"><th scope="row">{{ row.username }}</th><td><span class="badge">{{ state.kind === 'agents' ? (row.disabledAt ? 'Pasif' : 'Aktif') : (row.disabledAt ? 'Hesap kapalı' : statusNames[row.status] || 'Abonelik yok') }}</span></td>
              <td v-if="state.kind === 'customers'">{{ formatDate(row.endsAt) }}</td>
              <td><div class="row-actions"><template v-if="state.kind === 'agents'"><button type="button" :disabled="!!row.disabledAt || !!state.action" @click="open('reset', row)" :aria-label="`${row.username} parolasını sıfırla`">Parola sıfırla</button><button type="button" :disabled="!!row.disabledAt || !!state.action" @click="open('revoke', row)" :aria-label="`${row.username} yetkisini kaldır`">Yetkiyi kaldır</button></template><button v-else type="button" :disabled="!!state.action" @click="openCustomer(row)" :aria-label="`${row.username} abonelik detayını aç`">Detay ve geçmiş</button></div></td>
            </tr></tbody>
          </table>
          <table v-else>
            <caption class="sr-only">{{ customerName }} abonelik dönemleri</caption><thead><tr><th scope="col">Dönem</th><th scope="col">Tarih aralığı</th><th scope="col">Durum</th><th scope="col">Süre ve tutar</th><th scope="col">İşlem</th></tr></thead>
            <tbody><tr v-for="row in state.rows" :key="row.id"><th scope="row">#{{ row.sequenceNo }}</th><td>{{ formatDate(row.startsAt) }}<br />{{ formatDate(row.endsAt) }}</td><td><span class="badge">{{ statusNames[historyStatus(row)] || 'Bilinmiyor' }}</span><p v-if="row.cancelledAt" class="help">{{ formatDate(row.cancelledAt) }}<br />{{ cancellationReasons[row.cancellationReason] || 'Neden belirtilmedi' }}</p></td><td>{{ row.termMonths }} ay<br /><strong>{{ formatMoney(row.amountMinor, row.currency) }}</strong></td><td><button type="button" :disabled="row.cancelledAt !== null || !!state.action" @click="open('cancel', row)" :aria-label="`Dönem ${row.sequenceNo} iptal et`">Dönemi iptal et</button></td></tr></tbody>
          </table>
        </div>
        <footer v-if="state.ready" class="pagination" aria-label="Sayfalama"><button type="button" :disabled="state.page === 0 || !!state.action" @click="controller.previous()">Önceki</button><span>Sayfa {{ state.page + 1 }}</span><button type="button" :disabled="!state.nextCursor || !!state.action" @click="controller.next()">Sonraki</button></footer>
      </section>
      <p v-if="state.kind === 'history'" class="help">Geçmişteki durum etiketleri cihaz saatine göre bilgilendirme amaçlıdır. Satış ve erişim kararlarını sunucu doğrular. İptal işlemi müşteri veya süreölçer verilerini silmez.</p>
      <ManagementDialog :open="state.confirm" :title="actionTitles[state.action]" :details="details" :busy="state.busy" :uncertain="state.uncertain" :error="state.mutationError" @confirm="controller.submit()" @cancel="cancelAction" />
    </main>
    <main v-else class="sales-content"><h1>Yönetim erişimi yok</h1><p>Bu ekran yalnız yetkili web oturumları içindir.</p></main>
  </div>
</template>

<style scoped>
.sales-page { min-height: 100dvh; background: var(--color-surface); color: var(--color-text-primary); }
.sales-header { padding: 1rem max(1rem, calc((100vw - 72rem) / 2)); display: flex; gap: 1rem; justify-content: space-between; align-items: center; background: var(--color-card); border-bottom: 1px solid var(--color-border); }
.brand { font-size: 1.3rem; font-weight: 900; color: var(--color-primary-light); margin-right: 1rem; }
.eyebrow { font-size: .7rem; letter-spacing: .1em; font-weight: 800; color: var(--color-text-secondary); }
.sales-content { max-width: 72rem; margin: auto; padding: 1.5rem 1rem 4rem; }
.breadcrumbs { font-size: .85rem; margin-bottom: 1.75rem; display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
.breadcrumbs a { color: var(--color-primary-light); text-decoration: underline; }
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
h1 { font-size: clamp(1.7rem, 4vw, 2.1rem); font-weight: 850; letter-spacing: -.035em; margin: .3rem 0 .5rem; }
h2 { font-size: 1.1rem; font-weight: 800; margin-bottom: 1.25rem; }
.page-heading p { color: var(--color-text-secondary); }
.identifier { display: block; font-size: .75rem; overflow-wrap: anywhere; user-select: text; }
.header-actions, .row-actions, .form-actions { display: flex; gap: .65rem; flex-wrap: wrap; }
button { border: 1px solid var(--color-border); background: var(--color-card); border-radius: .75rem; padding: .65rem .95rem; font-size: .85rem; font-weight: 700; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--color-primary-light); }
button:disabled { opacity: .45; cursor: not-allowed; }
button:focus-visible, a:focus-visible, .table-scroll:focus-visible { outline: 3px solid #818cf8; outline-offset: 3px; }
.primary { background: #4338ca; color: white; border-color: #4338ca; }
.notice { padding: 1rem 1.2rem; border: 1px solid var(--color-border); border-left: 4px solid #6366f1; background: var(--color-card); border-radius: .8rem; margin-bottom: 1rem; font-size: .9rem; line-height: 1.65; }
.notice button { margin-top: .75rem; }.error { border-left-color: #e11d48; }.success { border-left-color: #059669; }
.panel { border: 1px solid var(--color-border); background: var(--color-card); border-radius: 1.2rem; overflow: hidden; margin: 1.2rem 0; }
.form-panel { padding: 1.5rem; }.form-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 1.25rem; }
label { display: block; font-weight: 700; font-size: .85rem; margin-bottom: .5rem; }
input, select { width: 100%; padding: .75rem; border-radius: .65rem; background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-primary); }
input:focus, select:focus { outline: 2px solid #818cf8; outline-offset: 2px; }
.help { font-size: .8rem; color: var(--color-text-secondary); margin-top: .6rem; line-height: 1.6; }.form-actions { margin-top: 1.4rem; justify-content: flex-end; }
.table-scroll { overflow-x: auto; }table { width: 100%; text-align: left; font-size: .9rem; border-collapse: collapse; }th, td { padding: 1.1rem; border-bottom: 1px solid var(--color-border); vertical-align: middle; }thead { background: var(--color-surface); color: var(--color-text-secondary); font-size: .75rem; }tbody th { font-weight: 750; }td { min-width: 8rem; }
.badge { display: inline-block; border-radius: .5rem; background: var(--color-primary-bg); padding: .3rem .65rem; font-size: .75rem; font-weight: 700; }.empty { padding: 3rem 1.5rem; text-align: center; color: var(--color-text-secondary); }
.pagination { display: flex; align-items: center; justify-content: flex-end; gap: 1rem; padding: 1rem; font-size: .85rem; }
@media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; }.sales-header .eyebrow { display: none; }.sales-header { padding: .85rem 1rem; }.header-actions button { padding: .5rem .6rem; }.form-panel { padding: 1rem; }.page-heading { align-items: flex-start; }.pagination { justify-content: space-between; } }
</style>
