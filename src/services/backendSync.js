import { KeepTimerAuth, isAndroidAuthPlatform } from "./keepTimerAuth.js";

export const BASE_URL = "https://multi-stopwatch-backend.onrender.com";
export const AUTH_SESSION_KEY = "keeptimer-auth-session";
const TAB_AUTH_SESSION_KEY = "keeptimer-tab-auth-session";
const AUTH_LOCK_NAME = "keeptimer-auth";
export const AUTH_LOGIN_REQUIRED_EVENT = "keeptimer:auth-login-required";
export const AUTH_SESSION_CHANGED_EVENT = "keeptimer:auth-session-changed";
export const AUTH_USER_CHANGED_EVENT = "keeptimer:auth-user-changed";
export const AUTH_LOCAL_LOGOUT_EVENT = "keeptimer:auth-local-logout";
export const AUTH_ACCESS_INVALIDATED_EVENT = "keeptimer:auth-access-invalidated";
export const AUTH_ACCESS_TOKEN_REFRESHED_EVENT = "keeptimer:auth-access-token-refreshed";

let accessToken = null; // Never persisted or broadcast to another tab.
let authGeneration = 0;
let refreshState = null;
let localAuthQueue = Promise.resolve();
let nativeNeedsReconciliation = true;
let nativeRequiresLogin = false;
let nativeLocalScopeIdentity = null; // Display scope only; never network authority.
const emit = name => globalThis.window?.dispatchEvent(new Event(name));
export const getAuthGeneration = () => authGeneration;

function withAuthMutationLock(callback) {
  if (globalThis.navigator?.locks?.request) return navigator.locks.request(AUTH_LOCK_NAME, callback);
  // Serializes this JS runtime only. No cross-tab guarantee without Web Locks.
  const work = localAuthQueue.then(callback, callback);
  localAuthQueue = work.catch(() => {});
  return work;
}

function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
  } catch { return null; }
}
// Used only for the access JWT's local session consistency, not authorization.
export function getTokenSessionIdentity(token, expectedType) {
  const payload = decodeJwtPayload(token);
  return payload?.type === expectedType && payload.id && payload.sessionId
    ? `${payload.id}:${payload.sessionId}` : null;
}
export function getSessionMarker() {
  return globalThis.localStorage?.getItem(AUTH_SESSION_KEY) || null;
}
export function getTabSessionIdentity() {
  return globalThis.sessionStorage?.getItem(TAB_AUTH_SESSION_KEY) || null;
}
export function isTabSessionCurrent() {
  const identity = getTabSessionIdentity();
  return Boolean(identity && identity === getSessionMarker());
}
function getCachedUser() {
  if (!isTabSessionCurrent()) return null;
  try {
    const user = JSON.parse(localStorage.getItem("user"));
    return user?.id && getSessionMarker()?.startsWith(`${user.id}:`) ? user : null;
  } catch { return null; }
}
export function isLocalAccountScopeReconciled() {
  return isTabSessionCurrent() && (!isAndroidAuthPlatform() || nativeLocalScopeIdentity === getSessionMarker());
}
export function getUser() {
  return isLocalAccountScopeReconciled() ? getCachedUser() : null;
}
export function saveUser(user) {
  localStorage.setItem("user", JSON.stringify(user));
  emit(AUTH_USER_CHANGED_EVENT);
}
// Local UI/scope availability is independent of network/access-token readiness.
export function isLoggedIn() {
  const user = getUser();
  return Boolean(user && !user.disabled_at && !(isAndroidAuthPlatform() && nativeRequiresLogin));
}
export function getAccessToken() {
  if (isAndroidAuthPlatform() && nativeNeedsReconciliation) return null;
  return isLoggedIn() && getTokenSessionIdentity(accessToken, "access") === getTabSessionIdentity()
    ? accessToken : null;
}
export function hasUsableAccessToken() {
  const token = getAccessToken();
  const payload = decodeJwtPayload(token);
  return Boolean(token && (!payload.exp || payload.exp * 1000 > Date.now()));
}
export function initializeAuthSession() {
  nativeNeedsReconciliation = true;
  nativeRequiresLogin = false;
  nativeLocalScopeIdentity = null;
  accessToken = null;
  authGeneration++;
  // No legacy token is read or exchanged. Keep user cache and IndexedDB intact.
  for (const storage of [globalThis.localStorage, globalThis.sessionStorage]) {
    storage?.removeItem("accessToken");
    storage?.removeItem("refreshToken");
  }
  const marker = getSessionMarker();
  if (marker && !getTabSessionIdentity()) sessionStorage.setItem(TAB_AUTH_SESSION_KEY, marker);
}
if (typeof window !== "undefined") {
  initializeAuthSession();
  window.addEventListener("storage", event => {
    if (event.key === AUTH_SESSION_KEY || event.key === null) {
      if (isAndroidAuthPlatform()) invalidateNativeAccess({ dropScope: true, force: true });
      else if (!isTabSessionCurrent()) { accessToken = null; authGeneration++; }
      emit(AUTH_SESSION_CHANGED_EVENT);
    }
  });
}
function isSameAuthSession(generation, marker) {
  return generation === authGeneration && marker === getSessionMarker();
}
function clearCurrentSession(generation, marker) {
  if (!marker || !isSameAuthSession(generation, marker) || !isTabSessionCurrent()) return false;
  authGeneration++;
  accessToken = null;
  if (isAndroidAuthPlatform()) { nativeLocalScopeIdentity = null; nativeNeedsReconciliation = true; }
  emit(AUTH_LOCAL_LOGOUT_EVENT);
  localStorage.removeItem(AUTH_SESSION_KEY);
  localStorage.removeItem("user");
  sessionStorage.removeItem(TAB_AUTH_SESSION_KEY);
  emit(AUTH_SESSION_CHANGED_EVENT);
  emit(AUTH_LOGIN_REQUIRED_EVENT);
  return true;
}
export function clearAuthSessionIfCurrent(generation, marker) {
  return withAuthMutationLock(() => clearCurrentSession(generation, marker));
}
const sessionIdFrom = marker => marker?.slice(marker.indexOf(":") + 1);
const staleResult = generation => ({ ok: false, hardFail: false, stale: true, generation });

// Network readiness and reconciled local display scope are independent. Stored
// cache/markers survive failures, but unknown account switches hide that scope.
function invalidateNativeAccess({ dropScope = false, requiresLogin = false, force = false } = {}) {
  const scopeChanged = dropScope && nativeLocalScopeIdentity !== null;
  const changed = force || accessToken !== null || !nativeNeedsReconciliation ||
    nativeRequiresLogin !== requiresLogin || scopeChanged;
  accessToken = null;
  nativeNeedsReconciliation = true;
  nativeRequiresLogin = requiresLogin;
  if (dropScope) nativeLocalScopeIdentity = null;
  if (changed) {
    authGeneration++;
    emit(AUTH_ACCESS_INVALIDATED_EVENT);
    if (requiresLogin) emit(AUTH_LOGIN_REQUIRED_EVENT);
  }
}
function nativeFailure(error) {
  const nestedUncertainty = error?.data?.indeterminate, uncertainty = error?.indeterminate;
  const indeterminate = nestedUncertainty === true || uncertainty === true;
  const candidate = Number(error?.data?.status ?? error?.status);
  const status = !indeterminate && [400, 401, 403, 409, 415, 429, 503].includes(candidate) ? candidate : 503;
  // A missing uncertainty flag is not proof of definitive expiry. All failures
  // require reconciliation; only explicit, non-indeterminate 401 can end auth.
  const definitive = status === 401 && !indeterminate && (nestedUncertainty === false || uncertainty === false);
  return { response: { ok: false, status }, definitive, indeterminate, data: {
    error: ["UNIMPLEMENTED", "UNAVAILABLE", "AUTH_LOGGING_CONFIGURATION"].includes(error?.code)
      ? "Android güvenli giriş eklentisi kullanılamıyor. Uygulama yapılandırmasını kontrol edin."
      : "Android oturum işlemi doğrulanamadı. Yeniden deneyin.",
  } }; // Never return/log raw native message/body/header/cause.
}
async function reconcileNativeSession(generation, marker) {
  let state;
  try { state = await KeepTimerAuth.getSessionState(); }
  catch (error) {
    if (!isSameAuthSession(generation, marker)) return staleResult(generation);
    const failure = nativeFailure(error);
    invalidateNativeAccess({ dropScope: true });
    return { ok: false, hardFail: false, status: failure.response.status, indeterminate: failure.indeterminate, generation };
  }
  if (!isSameAuthSession(generation, marker)) return staleResult(generation);
  const cached = getCachedUser();
  if (state?.hasCredential !== true || state.requiresLogin !== false || !marker ||
      !isTabSessionCurrent() || state.sessionId !== sessionIdFrom(marker) || !cached || cached.disabled_at) {
    invalidateNativeAccess({ dropScope: true, requiresLogin: true });
    return { ok: false, hardFail: false, stale: true, status: 409, requiresLogin: true, generation };
  }
  const changed = nativeLocalScopeIdentity !== marker || nativeRequiresLogin;
  nativeLocalScopeIdentity = marker;
  nativeRequiresLogin = false;
  // Metadata opens only the existing matching offline display scope. It never
  // sets access/user/markers and never opens network readiness.
  if (changed) emit(AUTH_USER_CHANGED_EVENT);
  return { ok: true, generation };
}
export async function bootstrapNativeAuthSession() {
  return isAndroidAuthPlatform() ? refreshAccessToken() : { ok: false, native: false };
}
function installNativeSession(data, identity, previousMarker) {
  try {
    // Prepare profile/tab first. The resumable shared marker is the final commit.
    localStorage.setItem("user", JSON.stringify(data.user));
    sessionStorage.setItem(TAB_AUTH_SESSION_KEY, identity);
    localStorage.setItem(AUTH_SESSION_KEY, identity);
  } catch {
    // Best effort removes only this installation's old/partial JS markers.
    // Never restore a guessed native credential or delete timer/outbox data.
    for (const [storage, key] of [[localStorage, AUTH_SESSION_KEY], [sessionStorage, TAB_AUTH_SESSION_KEY]]) {
      try {
        const value = storage.getItem(key);
        if (value === identity || value === previousMarker) storage.removeItem(key);
      } catch { /* Keep access/scope closed even if JS storage is unavailable. */ }
    }
    throw new Error("Native session installation failed");
  }
  authGeneration++;
  nativeLocalScopeIdentity = identity;
  nativeRequiresLogin = false;
  nativeNeedsReconciliation = false;
  accessToken = data.accessToken;
  emit(AUTH_USER_CHANGED_EVENT);
  emit(AUTH_SESSION_CHANGED_EVENT);
}
const nativeUuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function validNativeLogin(data) {
  return nativeUuid(data?.sessionId) && nativeUuid(data?.user?.id) &&
    typeof data.user.username === "string" && Boolean(data.user.username.trim()) &&
    ["worker", "manager", "superadmin"].includes(data.user.role) &&
    (data.user.workspace_id === null || nativeUuid(data.user.workspace_id));
}
async function authRequest(path, body, timeoutMs = 0) {
  if (isAndroidAuthPlatform()) {
    try {
      const data = await KeepTimerAuth[path](body);
      return { response: { ok: true, status: 200 }, data };
    } catch (error) { return nativeFailure(error); }
  }
  const controller = new AbortController();
  // Refresh has no cookie mutation. Login/logout keep the lock until fetch and
  // body settle; do not release it early via a timeout Promise.race.
  const timeout = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`/api/auth/${path}`, {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-KeepTimer-CSRF": "1" },
      body: JSON.stringify(body), signal: controller.signal,
    });
    let data = null;
    try { data = await response.json(); } catch { /* HTTP status remains authoritative. */ }
    return { response, data };
  } finally { if (timeout) clearTimeout(timeout); }
}

export async function refreshAccessToken(generation = authGeneration, marker = getSessionMarker()) {
  const android = isAndroidAuthPlatform();
  if (!isSameAuthSession(generation, marker) || (!android && (!marker || !isLoggedIn()))) return staleResult(generation);
  if (!isAndroidAuthPlatform() && globalThis.navigator?.onLine === false) return { ok: false, hardFail: false, status: 0, generation };
  if (refreshState?.generation === generation && refreshState.marker === marker) return refreshState.promise;
  const promise = withAuthMutationLock(async () => {
    if (!isSameAuthSession(generation, marker) || (!android && !isLoggedIn())) return staleResult(generation);
    try {
      if (isAndroidAuthPlatform()) {
        const reconciled = await reconcileNativeSession(generation, marker);
        if (!reconciled.ok) return reconciled;
        if (globalThis.navigator?.onLine === false) {
          invalidateNativeAccess();
          return { ok: false, hardFail: false, status: 0, generation };
        }
      }
      const { response, data, indeterminate, definitive } = await authRequest("refresh", { sessionId: sessionIdFrom(marker) }, 15000);
      if (!isSameAuthSession(generation, marker)) return staleResult(generation);
      if (!isLoggedIn()) {
        if (android) invalidateNativeAccess({ dropScope: true, requiresLogin: true });
        return staleResult(generation);
      }
      if (response.status === 401 && (!android || definitive)) {
        clearCurrentSession(generation, marker);
        return { ok: false, hardFail: true, stale: false, status: 401, generation };
      }
      if (response.ok && data?.sessionId === sessionIdFrom(marker) &&
          getTokenSessionIdentity(data.accessToken, "access") === marker) {
        nativeNeedsReconciliation = false;
        accessToken = data.accessToken;
        emit(AUTH_ACCESS_TOKEN_REFRESHED_EVENT);
        return { ok: true, hardFail: false, stale: false, generation };
      }
      if (android) invalidateNativeAccess();
      return { ok: false, hardFail: false, stale: response.status === 409, status: response.status, ...(indeterminate ? { indeterminate: true } : {}), generation };
    } catch {
      if (!isSameAuthSession(generation, marker)) return staleResult(generation);
      if (android) invalidateNativeAccess();
      return { ok: false, hardFail: false, status: 0, generation };
    }
  }).finally(() => { if (refreshState?.promise === promise) refreshState = null; });
  refreshState = { generation, marker, promise };
  return promise;
}
export async function ensureAccessToken() {
  if (!isAndroidAuthPlatform() && !isLoggedIn()) return staleResult(authGeneration);
  if (hasUsableAccessToken()) return { ok: true, generation: authGeneration };
  return refreshAccessToken();
}

function withAccessToken(options, token) {
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  return { ...options, headers };
}
function authHeader() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken()}` };
}
function apiContextCurrent(context) {
  return isSameAuthSession(context.generation, context.marker) &&
    getTabSessionIdentity() === context.identity && isLoggedIn();
}
export async function apiFetch(url, options = {}) {
  const context = { generation: authGeneration, marker: getSessionMarker(), identity: getTabSessionIdentity() };
  const current = () => apiContextCurrent(context) && !options.signal?.aborted &&
    (!options.isRequestCurrent || options.isRequestCurrent());
  const supplied = new Headers(options.headers || {}).get("Authorization")?.replace(/^Bearer /, "");
  if (!current() || (supplied && supplied !== "null" && getTokenSessionIdentity(supplied, "access") !== context.identity)) return null;
  const ready = await ensureAccessToken();
  if (!ready.ok || !current()) return null;
  // Retain the existing auth-lock checkpoint before sending a scoped request.
  const token = await withAuthMutationLock(() => current() ? getAccessToken() : null);
  if (!token || !current()) return null;
  let response = await fetch(url, withAccessToken(options, token));
  if (!current()) return null;
  if (response.status !== 401) return response;
  let nextToken = getAccessToken();
  if (nextToken === token || !nextToken) {
    const result = await refreshAccessToken(context.generation, context.marker);
    if (!result.ok || !current()) return null;
    nextToken = getAccessToken();
  }
  if (!nextToken || !current()) return null;
  response = await fetch(url, withAccessToken(options, nextToken));
  return current() ? response : null; // One retry, same body/mutation identity.
}

export async function login(username, pin) {
  if (globalThis.navigator?.onLine === false) {
    if (isAndroidAuthPlatform()) invalidateNativeAccess();
    return { success: false, error: "Giriş için internet bağlantısı gerekli." };
  }
  return withAuthMutationLock(async () => {
    if (isAndroidAuthPlatform()) invalidateNativeAccess({ dropScope: true, force: true });
    const generation = authGeneration, marker = getSessionMarker();
    let installingSession = false;
    try {
      const { response, data, indeterminate } = await authRequest("login", { username, pin });
      if (!isSameAuthSession(generation, marker)) return { success: false, stale: true, error: "Oturum değişti; giriş sonucu uygulanmadı." };
      if (!response.ok) return { success: false, status: response.status, ...(indeterminate ? { indeterminate: true } : {}), error: data?.error || "Giriş yapılamadı." };
      const identity = data?.user?.id && data?.sessionId ? `${data.user.id}:${data.sessionId}` : null;
      if (!identity || (isAndroidAuthPlatform() && !validNativeLogin(data)) || getTokenSessionIdentity(data.accessToken, "access") !== identity) {
        return { success: false, error: "Sunucudan geçersiz oturum bilgisi alındı." };
      }
      installingSession = true;
      if (isAndroidAuthPlatform()) {
        installNativeSession(data, identity, marker);
        return { success: true, user: data.user };
      }
      authGeneration++;
      nativeNeedsReconciliation = false;
      nativeRequiresLogin = false;
      accessToken = data.accessToken;
      localStorage.setItem(AUTH_SESSION_KEY, identity);
      sessionStorage.setItem(TAB_AUTH_SESSION_KEY, identity);
      saveUser(data.user);
      emit(AUTH_SESSION_CHANGED_EVENT);
      return { success: true, user: data.user };
    } catch {
      if (isAndroidAuthPlatform() && (installingSession || isSameAuthSession(generation, marker))) invalidateNativeAccess({ dropScope: true, requiresLogin: true });
      return { success: false, error: "Giriş sonucu doğrulanamadı. İnternet bağlantınızı kontrol edin." };
    }
  });
}
export async function logout() {
  const generation = authGeneration, marker = getSessionMarker();
  const android = isAndroidAuthPlatform();
  const hasContext = () => android ? Boolean(getCachedUser() && !getCachedUser().disabled_at) : isLoggedIn();
  if (!hasContext()) {
    if (android) invalidateNativeAccess({ dropScope: true });
    return { success: false, stale: true, error: "Bu sekmenin oturumu geçerli değil." };
  }
  if (globalThis.navigator?.onLine === false) {
    if (android) invalidateNativeAccess();
    return { success: false, error: "Çıkış için internet bağlantısı gerekli." };
  }
  return withAuthMutationLock(async () => {
    if (!isSameAuthSession(generation, marker)) return { success: false, stale: true, error: "Oturum değişti." };
    if (!hasContext()) {
      if (android) invalidateNativeAccess({ dropScope: true, requiresLogin: true });
      return { success: false, stale: true, error: "Oturum değişti." };
    }
    try {
      const { response, data, indeterminate, definitive } = await authRequest("logout", { sessionId: sessionIdFrom(marker) });
      if (!isSameAuthSession(generation, marker)) return { success: false, stale: true, error: "Oturum değişti." };
      if (!hasContext()) {
        if (android) invalidateNativeAccess({ dropScope: true, requiresLogin: true });
        return { success: false, stale: true, error: "Oturum değişti." };
      }
      if (response.status === 401 && (!android || definitive)) {
        clearCurrentSession(generation, marker);
        return { success: false, expired: true, error: "Oturum artık geçerli değil. Yeniden giriş yapın." };
      }
      if (response.status === 200 && data?.success === true && data.sessionId === sessionIdFrom(marker)) {
        clearCurrentSession(generation, marker);
        return { success: true };
      }
      if (android) invalidateNativeAccess();
      return { success: false, status: response.status, stale: response.status === 409, ...(indeterminate ? { indeterminate: true } : {}), error: data?.error || "Çıkış doğrulanamadı; oturumunuz açık tutuldu." };
    } catch {
      if (android && !isSameAuthSession(generation, marker)) return { success: false, stale: true, error: "Oturum değişti." };
      if (android) invalidateNativeAccess();
      return { success: false, error: "Çıkış doğrulanamadı; oturumunuz açık tutuldu. İnternet bağlantınızı kontrol edin." };
    }
  });
}

// Telegram chat ID kaydet
export async function saveTelegramChatId(chatId) {
  try {
    const response = await apiFetch(`${BASE_URL}/register`, {
      method: "POST",
      headers: authHeader(),
      body: JSON.stringify({ chatId }),
    });
    if (!response) return { success: false };
    const data = await response.json();
    return data;
  } catch (err) {
    console.error("[Backend] Telegram kayıt hatası:", err);
    return { success: false };
  }
}

// Timer DB'ye kaydet
export async function dbCreateTimer(timer, options = {}) {
  const response = await apiFetch(`${BASE_URL}/timers`, {
    method: "POST",
    headers: authHeader(),
    isRequestCurrent: options.isRequestCurrent,
    body: JSON.stringify({
      id: timer.id,
      name: timer.name,
      type: timer.type,
      targetMinutes: timer.targetMinutes,
      isShared: timer.isShared || false,
    }),
  });
  if (!response) return null;
  return await response.json();
}

// Timer güncelle
export async function dbUpdateTimer(timerId, updates, options = {}) {
  const response = await apiFetch(`${BASE_URL}/timers/${timerId}`, {
    method: "PATCH",
    headers: authHeader(),
    isRequestCurrent: options.isRequestCurrent,
    body: JSON.stringify(updates),
  });
  if (!response) return null;
  return await response.json();
}

// Timer sil (soft delete)
export async function dbDeleteTimer(timerId, options = {}) {
  console.log(
    "[DEBUG-DBDELETE] çağrıldı, timerId:",
    timerId,
    "url:",
    `${BASE_URL}/timers/${timerId}`,
  );
  const response = await apiFetch(`${BASE_URL}/timers/${timerId}`, {
    method: "DELETE",
    headers: authHeader(),
    isRequestCurrent: options.isRequestCurrent,
  });
  console.log(
    "[DEBUG-DBDELETE] apiFetch sonucu var mı:",
    !!response,
    "status:",
    response ? response.status : "null (response yok)",
  );
  if (!response) return null;
  const json = await response.json();
  console.log("[DEBUG-DBDELETE] response body:", JSON.stringify(json));
  return json;
}

// Ortak timer'ları getir
export async function dbGetSharedTimers(options = {}) {
  const response = await apiFetch(`${BASE_URL}/timers/shared`, {
    headers: authHeader(),
    isRequestCurrent: options.isRequestCurrent,
  });
  // token yok ya da istek başarısız (503/500 vb.) → null: "bilinmiyor", local veriyi silme
  if (!response || !response.ok) return null;
  const data = await response.json();
  return data.timers || []; // gerçekten boşsa [] — bu güvenle "hiç yok" demek
}

// Timer başlat
export async function syncTimerStart(timer, options = {}) {
  const user = getUser();
  if (!user) return;

  let endsAt;
  if (timer.type === "down") {
    const total = timer.targetMinutes * 60 * 1000;
    const elapsed = timer.accumulatedTime + (Date.now() - timer.startTime);
    const remaining = total - elapsed;
    endsAt = Date.now() + remaining;
  } else {
    if (!timer.targetMinutes) return;
    const elapsed = timer.accumulatedTime + (Date.now() - timer.startTime);
    const remaining = timer.targetMinutes * 60 * 1000 - elapsed;
    if (remaining <= 0) return;
    endsAt = Date.now() + remaining;
  }

  try {
    const response = await apiFetch(`${BASE_URL}/timer/start`, {
      method: "POST",
      headers: authHeader(),
      isRequestCurrent: options.isRequestCurrent,
      body: JSON.stringify({
        timerId: timer.id,
        timerName: timer.name,
        endsAt,
      }),
    });

    if (!response) return; // token yok, apiFetch zaten hiç istek atmadı

    if (response.status === 400) {
      // Telegram bağlı değilse bu normal bir durum, hata değil — sessizce geç
      return;
    }

    if (!response.ok) {
      console.warn(
        "[Backend] Timer başlatma bildirimi gönderilemedi:",
        response.status,
      );
      return;
    }

    console.log("[Backend] Timer başlatıldı:", timer.name);
  } catch (err) {
    console.error("[Backend] Timer başlatma hatası:", err);
  }
}

// Timer iptal
export async function syncTimerCancel(timerId, options = {}) {
  try {
    await apiFetch(`${BASE_URL}/timer/cancel`, {
      method: "POST",
      headers: authHeader(),
      isRequestCurrent: options.isRequestCurrent,
      body: JSON.stringify({ timerId }),
    });
  } catch (err) {
    console.error("[Backend] Timer iptal hatası:", err);
  }
}

// telegram bağlantısı kaldırma
export async function cancelTelegramChatId(user_id) {
  try {
    const response = await apiFetch(`${BASE_URL}/telegram/cancel`, {
      method: "PATCH",
      headers: authHeader(),
      body: JSON.stringify({ user_id }),
    });
    if (!response) return { success: false };
    const data = await response.json();
    return data;
  } catch (err) {
    console.error("[Backend] Telegram bağlantı kaldırma hatası:", err);
    return { success: false };
  }
}

// telegram chatID var mı kontrolü
export async function telegramControl(user_id) {
  try {
    const response = await apiFetch(`${BASE_URL}/telegram/control`, {
      method: "POST",
      headers: authHeader(),
      body: JSON.stringify({ user_id }),
    });
    if (!response) return { success: false };
    const data = await response.json();
    return data;
  } catch (err) {
    console.error("[Backend] Telegram bağlantısı kontrol hatası:", err);
    return { success: false };
  }
}
