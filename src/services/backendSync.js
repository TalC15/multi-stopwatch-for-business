export const BASE_URL = "https://multi-stopwatch-backend.onrender.com";
export const AUTH_SESSION_KEY = "keeptimer-auth-session";
const TAB_AUTH_SESSION_KEY = "keeptimer-tab-auth-session";
const AUTH_LOCK_NAME = "keeptimer-auth";
export const AUTH_LOGIN_REQUIRED_EVENT = "keeptimer:auth-login-required";
export const AUTH_SESSION_CHANGED_EVENT = "keeptimer:auth-session-changed";
export const AUTH_USER_CHANGED_EVENT = "keeptimer:auth-user-changed";
export const AUTH_LOCAL_LOGOUT_EVENT = "keeptimer:auth-local-logout";
export const AUTH_ACCESS_TOKEN_REFRESHED_EVENT = "keeptimer:auth-access-token-refreshed";

let accessToken = null; // Never persisted or broadcast to another tab.
let authGeneration = 0;
let refreshState = null;
let localAuthQueue = Promise.resolve();
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
export function getUser() {
  if (!isTabSessionCurrent()) return null;
  try {
    const user = JSON.parse(localStorage.getItem("user"));
    return user?.id && getSessionMarker()?.startsWith(`${user.id}:`) ? user : null;
  } catch { return null; }
}
export function saveUser(user) {
  localStorage.setItem("user", JSON.stringify(user));
  emit(AUTH_USER_CHANGED_EVENT);
}
// Local UI/scope availability is independent of network/access-token readiness.
export function isLoggedIn() {
  const user = getUser();
  return Boolean(user && !user.disabled_at);
}
export function getAccessToken() {
  return isLoggedIn() && getTokenSessionIdentity(accessToken, "access") === getTabSessionIdentity()
    ? accessToken : null;
}
export function hasUsableAccessToken() {
  const token = getAccessToken();
  const payload = decodeJwtPayload(token);
  return Boolean(token && (!payload.exp || payload.exp * 1000 > Date.now()));
}
export function initializeAuthSession() {
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
      if (!isTabSessionCurrent()) { accessToken = null; authGeneration++; }
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

async function authRequest(path, body, timeoutMs = 0) {
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
  if (!marker || !isSameAuthSession(generation, marker) || !isLoggedIn()) return staleResult(generation);
  if (globalThis.navigator?.onLine === false) return { ok: false, hardFail: false, status: 0, generation };
  if (refreshState?.generation === generation && refreshState.marker === marker) return refreshState.promise;
  const promise = withAuthMutationLock(async () => {
    if (!isSameAuthSession(generation, marker) || !isLoggedIn()) return staleResult(generation);
    try {
      const { response, data } = await authRequest("refresh", { sessionId: sessionIdFrom(marker) }, 15000);
      if (!isSameAuthSession(generation, marker) || !isLoggedIn()) return staleResult(generation);
      if (response.status === 401) {
        clearCurrentSession(generation, marker);
        return { ok: false, hardFail: true, stale: false, status: 401, generation };
      }
      if (response.ok && data?.sessionId === sessionIdFrom(marker) &&
          getTokenSessionIdentity(data.accessToken, "access") === marker) {
        accessToken = data.accessToken;
        emit(AUTH_ACCESS_TOKEN_REFRESHED_EVENT);
        return { ok: true, hardFail: false, stale: false, generation };
      }
      return { ok: false, hardFail: false, stale: response.status === 409, status: response.status, generation };
    } catch {
      return isSameAuthSession(generation, marker) ? { ok: false, hardFail: false, status: 0, generation } : staleResult(generation);
    }
  }).finally(() => { if (refreshState?.promise === promise) refreshState = null; });
  refreshState = { generation, marker, promise };
  return promise;
}
export async function ensureAccessToken() {
  if (!isLoggedIn()) return staleResult(authGeneration);
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
  if (globalThis.navigator?.onLine === false) return { success: false, error: "Giriş için internet bağlantısı gerekli." };
  return withAuthMutationLock(async () => {
    const generation = authGeneration, marker = getSessionMarker();
    try {
      const { response, data } = await authRequest("login", { username, pin });
      if (!isSameAuthSession(generation, marker)) return { success: false, stale: true, error: "Oturum değişti; giriş sonucu uygulanmadı." };
      if (!response.ok) return { success: false, status: response.status, error: data?.error || "Giriş yapılamadı." };
      const identity = data?.user?.id && data?.sessionId ? `${data.user.id}:${data.sessionId}` : null;
      if (!identity || getTokenSessionIdentity(data.accessToken, "access") !== identity) {
        return { success: false, error: "Sunucudan geçersiz oturum bilgisi alındı." };
      }
      authGeneration++;
      accessToken = data.accessToken;
      localStorage.setItem(AUTH_SESSION_KEY, identity);
      sessionStorage.setItem(TAB_AUTH_SESSION_KEY, identity);
      saveUser(data.user);
      emit(AUTH_SESSION_CHANGED_EVENT);
      return { success: true, user: data.user };
    } catch { return { success: false, error: "Giriş sonucu doğrulanamadı. İnternet bağlantınızı kontrol edin." }; }
  });
}
export async function logout() {
  const generation = authGeneration, marker = getSessionMarker();
  if (!isLoggedIn()) return { success: false, stale: true, error: "Bu sekmenin oturumu geçerli değil." };
  if (globalThis.navigator?.onLine === false) return { success: false, error: "Çıkış için internet bağlantısı gerekli." };
  return withAuthMutationLock(async () => {
    if (!isSameAuthSession(generation, marker) || !isLoggedIn()) return { success: false, stale: true, error: "Oturum değişti." };
    try {
      const { response, data } = await authRequest("logout", { sessionId: sessionIdFrom(marker) });
      if (!isSameAuthSession(generation, marker) || !isLoggedIn()) return { success: false, stale: true, error: "Oturum değişti." };
      if (response.status === 401) {
        clearCurrentSession(generation, marker);
        return { success: false, expired: true, error: "Oturum artık geçerli değil. Yeniden giriş yapın." };
      }
      if (response.status === 200 && data?.success === true && data.sessionId === sessionIdFrom(marker)) {
        clearCurrentSession(generation, marker);
        return { success: true };
      }
      return { success: false, status: response.status, stale: response.status === 409, error: data?.error || "Çıkış doğrulanamadı; oturumunuz açık tutuldu." };
    } catch { return { success: false, error: "Çıkış doğrulanamadı; oturumunuz açık tutuldu. İnternet bağlantınızı kontrol edin." }; }
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
