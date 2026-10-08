export const MFA_NOT_READY = 'Yönetim ve satış sistemi henüz kullanıma açılmadı. E-posta güvenlik doğrulaması hazırlanıyor.';
export const currencies = Object.freeze(['TRY', 'USD', 'EUR']); // Two minor-unit digits; no price catalogue.
export const cancellationReasons = Object.freeze({
  customer_request: 'Müşteri talebi', payment_record_correction: 'Ödeme kaydı düzeltmesi', administrative: 'İdari neden',
});
const messages = Object.freeze({
  PRIVILEGED_MFA_NOT_READY: MFA_NOT_READY,
  PRIVILEGED_MFA_REQUIRED: 'E-posta güvenlik doğrulaması gerekli veya süresi dolmuş. İşlem yapılamadı.',
  PASSWORD_CHANGE_REQUIRED: 'Önce parola değişikliği gerekiyor. Yeni parola giriş akışı henüz kullanıma açık değil.',
  SALES_FORBIDDEN: 'Bu yönetim işlemi için yetkiniz yok.',
  SALES_SESSION_INVALID: 'Oturumunuz doğrulanamadı. Yeniden giriş yapın.',
  SESSION_CHANGED: 'Oturum değişti. Önceki işleme ait bilgiler temizlendi.',
  NATIVE_BLOCKED: 'Vekil ve satış yönetimi yalnız web tarayıcısında kullanılabilir.',
  SALES_INPUT_INVALID: 'Formdaki bilgileri kontrol edin.',
  PLAN_NOT_AVAILABLE: 'Bu paket satışa açık değil. Yalnız Bireysel paket kullanılabilir.',
  ACTIVE_AGENT_EXISTS: 'Zaten aktif bir Vekil var. Önce mevcut Vekil’in yetkisini kaldırın.',
  PENDING_PERIOD_EXISTS: 'Henüz başlamamış bir abonelik dönemi var. Yeni yenileme kaydedilemedi.',
  SUBSCRIPTION_CONFLICT: 'Abonelik dönemleri çakışıyor. Satış geçmişini kontrol edin.',
  IDEMPOTENCY_CONFLICT: 'Bu işlem anahtarı farklı bilgilerle kullanılmış. Yeni satış başlatmadan önce geçmişi kontrol edin.',
  SALES_IDENTITY_CONFLICT: 'Bu kullanıcı adı zaten kullanılıyor. Başka bir ad seçin.',
  CUSTOMER_NOT_FOUND: 'Bireysel müşteri bulunamadı.', AGENT_NOT_FOUND: 'Vekil bulunamadı.',
  SUBSCRIPTION_NOT_FOUND: 'Bu müşteriye ait abonelik dönemi bulunamadı.',
  SALES_RATE_LIMITED: 'Çok fazla istek gönderildi. Bir süre bekleyip tekrar deneyin.',
  SALES_UNAVAILABLE: 'Yönetim servisine şu anda ulaşılamıyor. Bir süre sonra tekrar deneyin.',
  NETWORK_ERROR: 'İşlem sonucu doğrulanamadı. Aynı işlemi tekrar deneyin; yeni satış başlatmayın.',
});
export function salesError(code, status = 0, uncertain = false) {
  const known = typeof code === 'string' && Object.hasOwn(messages, code);
  const safeCode = known ? code : status === 401 ? 'SALES_SESSION_INVALID' : status === 403 ? 'SALES_FORBIDDEN' : status === 429 ? 'SALES_RATE_LIMITED' : 'SALES_UNAVAILABLE';
  return Object.assign(new Error(messages[safeCode]), { code: safeCode, status, uncertain });
}
export function managementRedirect(to, { loggedIn, user, native }) {
  if (to.meta.managementBlocked) return undefined;
  if (user?.role === 'agent' && loggedIn) {
    if (native) return '/management-unavailable';
    if (to.meta.salesRole !== 'agent') return '/agent/customers';
  }
  if (!to.meta.salesRole) return undefined;
  if (native) return '/management-unavailable';
  if (!loggedIn) return '/login';
  if (user?.role !== to.meta.salesRole) return '/';
}
export function validId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function amountMinor(value) {
  if (typeof value !== 'string' || !/^\d{1,14}(?:[.,]\d{1,2})?$/.test(value)) throw new Error('Tutarı binlik ayırıcı olmadan, en fazla iki ondalık basamakla yazın. Örnek: 250,00.');
  const [whole, fraction = ''] = value.split(/[.,]/);
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Tutar izin verilen sınırı aşıyor.');
  return Number(minor);
}
export function buildBody(kind, form) {
  const body = {};
  if (kind === 'createAgent' || kind === 'createCustomer') {
    if (typeof form.username !== 'string' || !/^[A-Za-z0-9_.-]{3,25}$/.test(form.username)) throw new Error('Kullanıcı adı 3–25 harf, rakam, nokta, alt çizgi veya tire içermeli.');
    body.username = form.username;
  }
  if (['createAgent', 'createCustomer', 'reset'].includes(kind)) {
    // eslint-disable-next-line no-control-regex -- The API explicitly forbids these password control characters.
    if (typeof form.password !== 'string' || [...form.password].length < 16 || new TextEncoder().encode(form.password).length > 72 || /[\u0000-\u001f\u007f]/.test(form.password)) throw new Error('Parola en az 16 karakter ve en fazla 72 UTF-8 byte olmalı; kontrol karakteri içeremez.');
    body.password = form.password;
  }
  if (kind === 'createAgent') {
    if (typeof form.mfaEmail !== 'string' || form.mfaEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.mfaEmail)) throw new Error('Geçerli bir MFA e-posta adresi girin.');
    body.mfaEmail = form.mfaEmail.toLowerCase();
  }
  if (kind === 'createCustomer' || kind === 'renew') {
    if (!['string', 'number'].includes(typeof form.termMonths) || !/^(?:[1-9]|1[0-2])$/.test(String(form.termMonths))) throw new Error('Abonelik süresi 1–12 ay olmalı.');
    if (!currencies.includes(form.currency)) throw new Error('Listeden bir para birimi seçin.');
    Object.assign(body, { planCode: 'individual', termMonths: Number(form.termMonths), amountMinor: amountMinor(form.amount), currency: form.currency });
  }
  if (kind === 'cancel') {
    if (typeof form.reason !== 'string' || !Object.hasOwn(cancellationReasons, form.reason)) throw new Error('Bir iptal nedeni seçin.');
    body.reason = form.reason;
  }
  return Object.freeze(body);
}
export function formatMoney(minor, currency) {
  if (!/^\d+$/.test(String(minor))) return 'Tutar okunamadı';
  if (!currencies.includes(currency)) return `${minor} alt birim (${currency})`;
  const n = BigInt(minor);
  return `${new Intl.NumberFormat('tr-TR').format(n / 100n)},${String(n % 100n).padStart(2, '0')} ${currency}`;
}
export function formatDate(value) {
  if (value === null) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'Tarih okunamadı';
}
export const statusNames = Object.freeze({ active: 'Aktif', pending: 'Bekleyen', expired: 'Süresi dolmuş', cancelled: 'İptal edilmiş' });
// History RPC has no status/serverNow. This label is informational, never write authority.
export function historyStatus(row, now = Date.now()) {
  if (row.cancelledAt !== null) return 'cancelled';
  const start = Date.parse(row.startsAt), end = Date.parse(row.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return end <= now ? 'expired' : start > now ? 'pending' : 'active';
}
