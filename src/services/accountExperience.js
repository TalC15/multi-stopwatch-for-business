import { reactive, readonly, computed, ref } from 'vue';
import * as backend from './backendSync.js';
import { validateExperience, experienceLeaseMs } from '../domain/accountExperience.js';

export function createAccountExperience({ auth = backend, request = auth.apiFetch, baseUrl = auth.BASE_URL,
  online = () => globalThis.navigator?.onLine !== false, events = globalThis.window,
  monotonicNow = () => globalThis.performance?.now() ?? NaN, timeoutMs = 10000,
  schedule = setTimeout, unschedule = clearTimeout } = {}) {
  const state = reactive({ status: 'loading', data: null });
  const companyOfflineProof = ref(false);
  let identity = null, lastVerified = -Infinity, validUntil = -Infinity, expiryTimer = null, pending = null, version = 0;
  const clearLease = () => { unschedule(expiryTimer); expiryTimer = null; validUntil = -Infinity; };
  const key = () => {
    const u = auth.getUser();
    return auth.isTabSessionCurrent() && u && !u.disabled_at
      ? JSON.stringify([auth.getAuthGeneration(), auth.getTabSessionIdentity(), auth.getSessionMarker(), u.id, u.workspace_id, u.role]) : null;
  };
  const guestStatus = () => auth.isTabSessionCurrent() ? online() ? 'loading' : 'offline' : 'standalone';
  function reset() {
    clearLease(); version++; identity = key(); pending = null; lastVerified = -Infinity;
    companyOfflineProof.value = false;
    state.data = null; state.status = identity ? 'loading' : guestStatus();
  }
  function reconcile() { if (identity !== key()) reset(); }
  const currentData = computed(() => {
    reconcile();
    return state.data;
  });
  // An Individual cached display never grants rights. Company legacy local
  // features may continue offline only with server proof in this SAME session;
  // no persisted metadata or previous session is accepted as that proof.
  const verified = () => {
    reconcile();
    const now = monotonicNow();
    return online() && state.status === 'verified' && Number.isFinite(now) && now >= lastVerified && now < validUntil;
  };
  const offlineCompany = () => { reconcile(); return !online() && companyOfflineProof.value && currentData.value?.account.kind === 'company'; };
  const canFeature = feature => (offlineCompany() || verified()) && currentData.value?.features[feature] === true;
  const canWritePersonal = () => verified() && currentData.value?.personal.writable === true;
  const canShared = () => verified() && currentData.value?.shared === true;
  async function refresh() {
    reconcile();
    if (!identity && auth.isTabSessionCurrent() && online()) {
      try { await auth.ensureAccessToken?.(); } catch { /* Keep unresolved scope closed. */ }
      reconcile();
    }
    if (!identity) { state.status = guestStatus(); return false; }
    if (!online()) { state.status = 'offline'; lastVerified = -Infinity; return false; }
    if (pending) return pending;
    const expected = identity, generation = ++version, requestedAt = monotonicNow();
    const controller = new AbortController();
    const valid = () => expected === key() && generation === version && !controller.signal.aborted;
    let timer;
    const work = (async () => {
      clearLease(); state.status = 'loading'; lastVerified = -Infinity;
      try {
        const response = await Promise.race([
          request(`${baseUrl}/account/experience`, { method: 'GET', cache: 'no-store', signal: controller.signal,
            headers: { Authorization: `Bearer ${auth.getAccessToken()}` }, isRequestCurrent: valid }),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('timeout')); }, timeoutMs); }),
        ]);
        if (!valid()) return false;
        // A current server reply supersedes prior offline authority even when
        // it denies access or contains malformed data. A transport failure
        // without a reply keeps the unchanged-session legacy company proof.
        companyOfflineProof.value = false;
        if (!response?.ok) throw Error('SUBSCRIPTION_UNAVAILABLE');
        const data = validateExperience(await response.json(), auth.getUser());
        if (!valid()) return false;
        companyOfflineProof.value = data.account.kind === 'company';
        state.data = data; lastVerified = requestedAt;
        // Subtract the entire request/JSON duration, including database waits.
        // Delayed replies cannot renew a lease that has already elapsed.
        validUntil = requestedAt + experienceLeaseMs(data);
        const remaining = validUntil - monotonicNow();
        if (!Number.isFinite(remaining) || remaining <= 0 || monotonicNow() < requestedAt) {
          state.status = 'stale'; return false;
        }
        state.status = 'verified';
        expiryTimer = schedule(() => {
          if (expected === key() && generation === version) { clearLease(); state.status = 'stale'; }
        }, remaining);
        expiryTimer?.unref?.();
        return true;
      } catch {
        if (expected === key() && generation === version) { state.status = online() ? 'unavailable' : 'offline'; lastVerified = -Infinity; }
        return false;
      } finally { clearTimeout(timer); }
    })();
    pending = work;
    try { return await work; } finally { if (pending === work) pending = null; }
  }
  const requireFeature = async feature => offlineCompany() ? canFeature(feature) : await refresh() && canFeature(feature);
  const requirePersonalWrite = async scope => {
    reconcile();
    // A company already verified in this unchanged session keeps local-first
    // offline edits/creation. This never grants an Individual feature or RPC.
    const localCompany = offlineCompany();
    if (!localCompany && (!await refresh() || !canWritePersonal())) return false;
    const a = currentData.value.account;
    return a.userId === scope?.userId?.toLowerCase() && a.workspaceId === scope?.workspaceId?.toLowerCase();
  };
  function rejectAuthority() {
    reconcile(); version++; pending = null; clearLease(); lastVerified = -Infinity;
    companyOfflineProof.value = false; state.status = online() ? 'unavailable' : 'offline';
  }
  const removers = [];
  for (const name of [auth.AUTH_SESSION_CHANGED_EVENT, auth.AUTH_LOCAL_LOGOUT_EVENT, auth.AUTH_LOGIN_REQUIRED_EVENT,
    auth.AUTH_USER_CHANGED_EVENT, auth.AUTH_ACCESS_INVALIDATED_EVENT]) if (name) {
    events?.addEventListener(name, reset); removers.push(() => events?.removeEventListener(name, reset));
  }
  if (auth.ACCOUNT_AUTHORITY_DENIED_EVENT) {
    events?.addEventListener(auth.ACCOUNT_AUTHORITY_DENIED_EVENT, rejectAuthority);
    removers.push(() => events?.removeEventListener(auth.ACCOUNT_AUTHORITY_DENIED_EVENT, rejectAuthority));
  }
  // A suspended/background page must obtain a fresh Individual proof on return.
  const resume = () => {
    reconcile();
    if (state.data?.account.kind === 'individual') { version++; pending = null; clearLease(); state.status = 'stale'; }
  };
  for (const name of ['focus', 'pageshow']) {
    events?.addEventListener(name, resume); removers.push(() => events?.removeEventListener(name, resume));
  }
  const offline = () => { reconcile(); clearLease(); lastVerified = -Infinity; state.status = identity || auth.isTabSessionCurrent() ? 'offline' : 'standalone'; };
  events?.addEventListener('offline', offline); removers.push(() => events?.removeEventListener('offline', offline));
  reset();
  return { state: readonly(state), currentData, refresh, reset, canFeature, canShared, canWritePersonal,
    requireFeature, requirePersonalWrite, rejectAuthority, dispose: () => { reset(); removers.forEach(remove => remove()); } };
}
export const accountExperience = createAccountExperience();
