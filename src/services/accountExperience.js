import { reactive, readonly, computed, ref } from 'vue';
import * as backend from './backendSync.js';
import { validateExperience, experienceLeaseMs } from '../domain/accountExperience.js';

export function createAccountExperience({ auth = backend, request = auth.apiFetch, baseUrl = auth.BASE_URL,
  online = () => globalThis.navigator?.onLine !== false, events = globalThis.window,
  monotonicNow = () => globalThis.performance?.now() ?? NaN, timeoutMs = 10000,
  schedule = setTimeout, unschedule = clearTimeout } = {}) {
  const state = reactive({ status: 'loading', data: null, refreshing: false, scopeVersion: 0 });
  const companyOfflineProof = ref(false);
  let identity = null, lastVerified = -Infinity, validUntil = -Infinity, expiryTimer = null, pending = null, version = 0, leaseVersion = 0, activeRequest = null, bootstrap = null, retryAfter = -Infinity;
  let owners = 0, renewalTimer = null, renewalVersion = 0;
  const clearLease = () => { leaseVersion++; unschedule(expiryTimer); expiryTimer = null; validUntil = -Infinity; };
  const key = () => {
    const u = auth.getUser();
    return auth.isTabSessionCurrent() && u && !u.disabled_at && !['agent', 'superadmin'].includes(u.role)
      ? JSON.stringify([auth.getAuthGeneration(), auth.getTabSessionIdentity(), auth.getSessionMarker(), u.id, u.workspace_id, u.role]) : null;
  };
  const guestStatus = () => ['agent', 'superadmin'].includes(auth.getUser()?.role) ? 'restricted' : auth.isTabSessionCurrent() ? online() ? 'loading' : 'offline' : 'standalone';
  function reset() {
    clearLease(); version++; activeRequest?.abort(); activeRequest = null; identity = key(); pending = null; bootstrap = null; lastVerified = -Infinity; retryAfter = -Infinity;
    state.scopeVersion++; state.refreshing = false;
    companyOfflineProof.value = false;
    state.data = null; state.status = identity ? 'loading' : guestStatus();
    if (owners) queueRenewal(0);
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
    if (!identity && !auth.getUser() && auth.isTabSessionCurrent() && online()) {
      const before = version;
      bootstrap ||= Promise.resolve().then(() => auth.ensureAccessToken?.()).catch(() => {});
      const work = bootstrap; await work; if (bootstrap === work) bootstrap = null;
      if (before !== version) return false;
      reconcile();
    }
    if (!identity) { state.status = guestStatus(); return false; }
    if (!online()) { state.status = 'offline'; lastVerified = -Infinity; return false; }
    if (pending) return pending;
    const expected = identity, generation = ++version, requestedAt = monotonicNow();
    const controller = new AbortController(); activeRequest = controller;
    const valid = () => expected === key() && generation === version && !controller.signal.aborted;
    let timer;
    const work = (async () => {
      state.refreshing = true;
      if (!state.data) state.status = 'loading';
      try {
        const data = await Promise.race([
          (async () => {
            const response = await request(`${baseUrl}/account/experience`, { method: 'GET', cache: 'no-store', signal: controller.signal,
              headers: { Authorization: `Bearer ${auth.getAccessToken()}` }, isRequestCurrent: valid });
            if (!valid()) throw Error('stale');
            // A received denial/malformed reply also revokes Company offline proof.
            companyOfflineProof.value = false;
            if (!response?.ok) throw Error('SUBSCRIPTION_UNAVAILABLE');
            const body = await response.json();
            if (!valid()) throw Error('stale');
            return validateExperience(body, auth.getUser());
          })(),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('timeout')); }, timeoutMs); }),
        ]);
        if (!valid()) return false;
        clearLease();
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
        const installedLease = leaseVersion;
        expiryTimer = schedule(() => {
          if (expected === key() && installedLease === leaseVersion) { clearLease(); state.status = 'stale'; }
        }, remaining);
        expiryTimer?.unref?.();
        return true;
      } catch {
        if (expected === key() && generation === version) { clearLease(); state.status = online() ? 'unavailable' : 'offline'; lastVerified = -Infinity; retryAfter = monotonicNow() + 5000; }
        return false;
      } finally { clearTimeout(timer); if (expected === key() && generation === version) state.refreshing = false; if (activeRequest === controller) activeRequest = null; }
    })();
    pending = work;
    try { return await work; } finally { if (pending === work) pending = null; }
  }
  // Reuse only the remaining server-bounded decision; display data is never proof.
  const ensureFresh = () => verified() ? Promise.resolve(true) : monotonicNow() < retryAfter ? Promise.resolve(false) : refresh();
  const requireFeature = async feature => canFeature(feature) || await ensureFresh() && canFeature(feature);
  const requirePersonalWrite = async scope => {
    reconcile();
    // A company already verified in this unchanged session keeps local-first
    // offline edits/creation. This never grants an Individual feature or RPC.
    const localCompany = offlineCompany();
    if (!localCompany && (!await ensureFresh() || !canWritePersonal())) return false;
    const a = currentData.value.account;
    return a.userId === scope?.userId?.toLowerCase() && a.workspaceId === scope?.workspaceId?.toLowerCase();
  };
  function rejectAuthority() {
    reconcile(); version++; activeRequest?.abort(); activeRequest = null; pending = null; state.refreshing = false; clearLease(); lastVerified = -Infinity;
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
    if (state.data?.account.kind === 'individual' && !(pending && state.status === 'stale')) {
      version++; activeRequest?.abort(); activeRequest = null; pending = null; state.refreshing = false; clearLease(); state.status = 'stale';
    }
    if (owners) void ensureFresh();
  };
  for (const name of ['focus', 'pageshow']) {
    events?.addEventListener(name, resume); removers.push(() => events?.removeEventListener(name, resume));
  }
  const offline = () => { reconcile(); clearLease(); lastVerified = -Infinity; state.status = identity || auth.isTabSessionCurrent() ? 'offline' : 'standalone'; };
  events?.addEventListener('offline', offline); removers.push(() => events?.removeEventListener('offline', offline));
  const onlineAgain = () => { if (owners) { void ensureFresh(); queueRenewal(25000); } };
  events?.addEventListener('online', onlineAgain); removers.push(() => events?.removeEventListener('online', onlineAgain));
  // One application-owned renewal loop, independent of route mounts.
  function queueRenewal(delay) {
    const turn = ++renewalVersion;
    unschedule(renewalTimer);
    renewalTimer = schedule(async () => {
      renewalTimer = null;
      if (!owners) return;
      if (online() && (!verified() || monotonicNow() - lastVerified >= 25000)) await refresh();
      if (owners && turn === renewalVersion) queueRenewal(verified() ? Math.max(1000, Math.min(25000, validUntil - monotonicNow() - 5000)) : 25000);
    }, delay);
    renewalTimer?.unref?.();
  }
  function start() {
    if (++owners === 1) { void ensureFresh(); queueRenewal(25000); }
    let stopped = false;
    return () => { if (stopped) return; stopped = true; if (owners > 0 && --owners === 0) { renewalVersion++; unschedule(renewalTimer); renewalTimer = null; } };
  }
  reset();
  return { state: readonly(state), currentData, refresh, ensureFresh, start, reset, canFeature, canShared, canWritePersonal,
    requireFeature, requirePersonalWrite, rejectAuthority, dispose: () => { owners = 0; renewalVersion++; unschedule(renewalTimer); renewalTimer = null; reset(); removers.forEach(remove => remove()); } };
}
export const accountExperience = createAccountExperience();
