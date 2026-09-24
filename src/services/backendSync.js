const BASE_URL = "https://multi-stopwatch-backend.onrender.com";

// Her login / token temizleme yeni bir auth oturumu olarak değerlendirilir.
// Access token refresh olmak authGeneration'ı değiştirmez.
let authGeneration = 0;

// Devam eden refresh hangi auth oturumuna ait, onu da takip et.
// Eski bir refresh'in yeni oturumun refresh state'ini bozmasını engeller.
let refreshState = null;

export function getAuthGeneration() {
  return authGeneration;
}

function advanceAuthGeneration() {
  authGeneration += 1;
  return authGeneration;
}

const AUTH_LOCK_NAME = "keeptimer-auth";
export const AUTH_LOGIN_REQUIRED_EVENT = "keeptimer:auth-login-required";

async function withAuthMutationLock(callback) {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(AUTH_LOCK_NAME, callback);
  }

  // Tek WebView / desteklenmeyen ortam için fallback.
  return callback();
}

export const AUTH_SESSION_CHANGED_EVENT = "keeptimer:auth-session-changed";
export const AUTH_LOCAL_LOGOUT_EVENT = "keeptimer:auth-local-logout";

const TAB_AUTH_SESSION_KEY = "keeptimer-tab-auth-session";

function decodeJwtPayload(token) {
  if (typeof token !== "string") {
    return null;
  }

  try {
    const parts = token.split(".");

    if (parts.length !== 3) {
      return null;
    }

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");

    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");

    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function getTokenSessionIdentity(token, expectedType) {
  const payload = decodeJwtPayload(token);

  if (
    !payload ||
    payload.type !== expectedType ||
    !payload.id ||
    !payload.sessionId
  ) {
    return null;
  }

  return `${payload.id}:${payload.sessionId}`;
}

export function getTabSessionIdentity() {
  if (typeof sessionStorage === "undefined") {
    return null;
  }

  return sessionStorage.getItem(TAB_AUTH_SESSION_KEY);
}

export function isTabSessionCurrent() {
  const tabIdentity = getTabSessionIdentity();

  const storedIdentity = getTokenSessionIdentity(getRefreshToken(), "refresh");

  return Boolean(
    tabIdentity && storedIdentity && tabIdentity === storedIdentity,
  );
}

function bindTabToRefreshToken(refreshToken) {
  const identity = getTokenSessionIdentity(refreshToken, "refresh");

  if (!identity) {
    return false;
  }

  sessionStorage.setItem(TAB_AUTH_SESSION_KEY, identity);

  return true;
}

function isSameAuthSession(expectedGeneration, expectedRefreshToken) {
  return (
    expectedGeneration === authGeneration &&
    getRefreshToken() === expectedRefreshToken
  );
}

// Token yönetimi
export function getAccessToken() {
  return localStorage.getItem("accessToken");
}

export function getRefreshToken() {
  return localStorage.getItem("refreshToken");
}

function initializeTabSessionBinding() {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") {
    return;
  }

  // Reload sırasında mevcut sekmenin eski session bağı korunur.
  if (getTabSessionIdentity()) {
    return;
  }

  // Gerçekten yeni sekmeyse mevcut aktif login'i devralabilir.
  const refreshToken = getRefreshToken();

  if (refreshToken) {
    bindTabToRefreshToken(refreshToken);
  }
}

initializeTabSessionBinding();
export function saveTokens(accessToken, refreshToken) {
  localStorage.setItem("accessToken", accessToken);
  if (refreshToken) localStorage.setItem("refreshToken", refreshToken);
}

export function getUser() {
  if (!isTabSessionCurrent()) {
    return null;
  }

  const user = localStorage.getItem("user");
  return user ? JSON.parse(user) : null;
}

export function saveUser(user) {
  localStorage.setItem("user", JSON.stringify(user));
}

export function isLoggedIn() {
  if (!isTabSessionCurrent()) {
    return false;
  }

  const accessToken = getAccessToken();
  const tabSessionIdentity = getTabSessionIdentity();

  if (!accessToken || !tabSessionIdentity) {
    return false;
  }

  return getTokenSessionIdentity(accessToken, "access") === tabSessionIdentity;
}

// Auth header
function authHeader() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getAccessToken()}`,
  };
}

function getBearerTokenFromHeaders(headers) {
  const normalizedHeaders = new Headers(headers || {});

  const authorization = normalizedHeaders.get("Authorization");

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice(7);
}

function withAccessToken(options, accessToken) {
  const headers = new Headers(options.headers || {});

  headers.set("Authorization", `Bearer ${accessToken}`);

  return {
    ...options,
    headers,
  };
}

async function captureApiRequestContext(options) {
  return withAuthMutationLock(async () => {
    const generation = getAuthGeneration();

    const tabIdentity = getTabSessionIdentity();

    const refreshToken = getRefreshToken();

    const activeIdentity = getTokenSessionIdentity(refreshToken, "refresh");

    const accessToken = getAccessToken();

    const accessIdentity = getTokenSessionIdentity(accessToken, "access");

    const requestToken = getBearerTokenFromHeaders(options.headers);

    const requestIdentity = getTokenSessionIdentity(requestToken, "access");

    // Bu sekme artık browser'daki aktif session'a ait değil.
    if (!tabIdentity || activeIdentity !== tabIdentity) {
      return { ok: false };
    }

    // Stored access token da aynı session'a ait olmalı.
    if (!accessToken || accessIdentity !== tabIdentity) {
      return { ok: false };
    }

    // İsteğin Authorization header'ı başka session'a aitse
    // request'i kesinlikle gönderme.
    if (!requestToken || requestIdentity !== tabIdentity) {
      return { ok: false };
    }

    return {
      ok: true,
      generation,
      tabIdentity,
      refreshToken,
      accessToken,
      requestToken,
    };
  });
}

function isApiRequestContextCurrent(context) {
  if (!context?.ok) {
    return false;
  }

  if (context.generation !== getAuthGeneration()) {
    return false;
  }

  if (context.tabIdentity !== getTabSessionIdentity()) {
    return false;
  }

  // Cross-tab login/logout kontrolü.
  if (context.refreshToken !== getRefreshToken()) {
    return false;
  }

  return (
    getTokenSessionIdentity(getRefreshToken(), "refresh") ===
    context.tabIdentity
  );
}

async function clearApiRequestSessionIfCurrent(context) {
  return withAuthMutationLock(async () => {
    // Refresh sonucu geldikten sonra başka bir login/session
    // devreye girdiyse onun tokenlarına dokunma.
    if (!isApiRequestContextCurrent(context)) {
      return false;
    }

    // Bu sekmedeki bekleyen eski auth işlerini geçersiz kıl.
    advanceAuthGeneration();

    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");

    return true;
  });
}

// Token yenile
async function performRefresh(expectedGeneration, expectedRefreshToken) {
  // Aynı sekmede oturum değişmiş olabilir veya başka sekmede
  // localStorage'daki refresh token değişmiş olabilir.
  if (
    !expectedRefreshToken ||
    !isSameAuthSession(expectedGeneration, expectedRefreshToken)
  ) {
    return {
      ok: false,
      hardFail: false,
      stale: true,
      generation: expectedGeneration,
    };
  }

  try {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refreshToken: expectedRefreshToken,
      }),
    });

    // Fetch beklerken aynı veya başka sekmede oturum değişmiş olabilir.
    if (!isSameAuthSession(expectedGeneration, expectedRefreshToken)) {
      return {
        ok: false,
        hardFail: false,
        stale: true,
        generation: expectedGeneration,
      };
    }

    if (response.ok) {
      const data = await response.json();

      if (!isSameAuthSession(expectedGeneration, expectedRefreshToken)) {
        return {
          ok: false,
          hardFail: false,
          stale: true,
          generation: expectedGeneration,
        };
      }

      // Backend beklenmedik şekilde geçerli access token
      // döndürmediyse mevcut oturumu bozma.
      if (typeof data?.accessToken !== "string" || !data.accessToken.trim()) {
        return {
          ok: false,
          hardFail: false,
          stale: false,
          generation: expectedGeneration,
        };
      }

      const committed = await withAuthMutationLock(async () => {
        // Lock'u beklerken başka sekmede login gerçekleşmiş olabilir.
        // Kontrolü lock İÇİNDE tekrar yapmak kritik.
        if (!isSameAuthSession(expectedGeneration, expectedRefreshToken)) {
          return false;
        }

        saveTokens(data.accessToken, null);
        return true;
      });

      if (!committed) {
        return {
          ok: false,
          hardFail: false,
          stale: true,
          generation: expectedGeneration,
        };
      }

      return {
        ok: true,
        hardFail: false,
        stale: false,
        generation: expectedGeneration,
      };
    }

    // Response geldikten sonra session değişmişse eski 401/403
    // yeni kullanıcıyı logout ettirmemeli.
    if (!isSameAuthSession(expectedGeneration, expectedRefreshToken)) {
      return {
        ok: false,
        hardFail: false,
        stale: true,
        generation: expectedGeneration,
      };
    }

    const hardFail = response.status === 401 || response.status === 403;

    return {
      ok: false,
      hardFail,
      stale: false,
      generation: expectedGeneration,
    };
  } catch {
    if (!isSameAuthSession(expectedGeneration, expectedRefreshToken)) {
      return {
        ok: false,
        hardFail: false,
        stale: true,
        generation: expectedGeneration,
      };
    }

    return {
      ok: false,
      hardFail: false,
      stale: false,
      generation: expectedGeneration,
    };
  }
}

// Aynı anda birden fazla apiFetch 401 alırsa, hepsi TEK bir refresh'i paylaşsın
export async function refreshAccessToken(
  expectedGeneration = authGeneration,
  expectedRefreshToken = getRefreshToken(),
) {
  if (
    expectedGeneration !== authGeneration ||
    getRefreshToken() !== expectedRefreshToken
  ) {
    return {
      ok: false,
      hardFail: false,
      stale: true,
      generation: expectedGeneration,
    };
  }

  if (!expectedRefreshToken) {
    return {
      ok: false,
      hardFail: true,
      stale: false,
      generation: expectedGeneration,
    };
  }

  // Aynı generation yetmez.
  // Başka sekmede logout/login olduysa refresh token değişmiş olabilir.
  if (
    refreshState &&
    refreshState.generation === expectedGeneration &&
    refreshState.refreshToken === expectedRefreshToken
  ) {
    return refreshState.promise;
  }

  const promise = performRefresh(
    expectedGeneration,
    expectedRefreshToken,
  ).finally(() => {
    // Eski refresh tamamlanırken yeni session için başka refresh
    // başlamış olabilir. Yalnız kendi state'imizi temizleyebiliriz.
    if (
      refreshState?.generation === expectedGeneration &&
      refreshState?.refreshToken === expectedRefreshToken &&
      refreshState?.promise === promise
    ) {
      refreshState = null;
    }
  });

  refreshState = {
    generation: expectedGeneration,
    refreshToken: expectedRefreshToken,
    promise,
  };

  return promise;
}

// Genel fetch — token süresi dolunca otomatik yeniler
export async function apiFetch(url, options = {}) {
  const context = await captureApiRequestContext(options);

  if (!context.ok) {
    return null;
  }

  // options hazırlanırken eski access token kullanılmış,
  // fakat aynı server session içinde başka request refresh
  // etmiş olabilir.
  //
  // Session identity aynı olduğu için başka kullanıcı değildir;
  // ilk isteği güncel access token ile gönder.
  const firstRequestOptions =
    context.requestToken === context.accessToken
      ? options
      : withAccessToken(options, context.accessToken);

  let response = await fetch(url, firstRequestOptions);

  // Request beklerken aynı sekmede veya başka sekmede
  // auth session değişmiş olabilir.
  //
  // 200 dahil hiçbir eski response yeni session'a ulaşmamalı.
  if (!isApiRequestContextCurrent(context)) {
    return null;
  }

  if (response.status === 401) {
    const currentAccessToken = getAccessToken();

    const currentAccessIdentity = getTokenSessionIdentity(
      currentAccessToken,
      "access",
    );

    // Bizim request T0 ile gitti.
    // Bu sırada aynı session'daki başka bir request
    // T1 üretmiş olabilir.
    //
    // Yeni bir refresh başlatmak yerine T1 ile yalnız
    // bir kez retry ediyoruz.
    if (
      currentAccessToken &&
      currentAccessIdentity === context.tabIdentity &&
      currentAccessToken !== context.accessToken
    ) {
      response = await fetch(url, withAccessToken(options, currentAccessToken));

      // Retry beklenirken session değiştiyse
      // eski cevabı yeni kullanıcıya verme.
      if (!isApiRequestContextCurrent(context)) {
        return null;
      }

      // Burada ikinci 401 olsa bile yeni refresh YOK.
      return response;
    }

    const result = await refreshAccessToken(
      context.generation,
      context.refreshToken,
    );
    if (result.ok) {
      // Refresh beklerken session değişmiş olabilir.
      if (!isApiRequestContextCurrent(context)) {
        return null;
      }

      const refreshedAccessToken = getAccessToken();

      const refreshedAccessIdentity = getTokenSessionIdentity(
        refreshedAccessToken,
        "access",
      );

      // Backend'den gelen yeni access token mutlaka
      // bu request'in başladığı server session'a ait olmalı.
      if (
        !refreshedAccessToken ||
        refreshedAccessIdentity !== context.tabIdentity
      ) {
        return null;
      }

      response = await fetch(
        url,
        withAccessToken(options, refreshedAccessToken),
      );

      // Retry beklerken login/logout/session değiştiyse
      // cevabı discard et.
      if (!isApiRequestContextCurrent(context)) {
        return null;
      }

      // Bu ikinci istek 401 olsa bile burada tekrar
      // refresh zinciri başlatılmayacak.
      return response;
    } else if (result.hardFail) {
      const cleared = await clearApiRequestSessionIfCurrent(context);

      if (!cleared) {
        // HardFail eski/stale session'a aitti.
        // Yeni session'a hiçbir şey yapma.
        return null;
      }

      // Aynı sekmedeki socket ve auth consumer'larına
      // session'ın artık aktif olmadığını bildir.
      window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));

      window.dispatchEvent(new Event(AUTH_LOGIN_REQUIRED_EVENT));

      return null;
    }
    // hardFail false (geçici sorun) → oturumu koru, sadece bu istek başarısız sayılır
  }

  return response;
}

// Giriş
export async function login(username, pin) {
  try {
    const response = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, pin }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error,
      };
    }

    const refreshIdentity = getTokenSessionIdentity(
      data.refreshToken,
      "refresh",
    );

    const accessIdentity = getTokenSessionIdentity(data.accessToken, "access");

    if (!refreshIdentity || accessIdentity !== refreshIdentity) {
      return {
        success: false,
        error: "Sunucudan geçersiz oturum bilgisi alındı",
      };
    }

    await withAuthMutationLock(async () => {
      advanceAuthGeneration();

      saveTokens(data.accessToken, data.refreshToken);

      saveUser(data.user);

      // Bu sekme artık yeni login session'ına bağlı.
      sessionStorage.setItem(TAB_AUTH_SESSION_KEY, refreshIdentity);

      // Aynı sekmedeki eski socket'e session değiştiğini bildir.
      window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
    });

    return {
      success: true,
      user: data.user,
    };
  } catch {
    return { success: false, error: "Sunucuya bağlanılamadı" };
  }
}

// Çıkış — backend'e haber ver (oturumu iptal et), sonra local temizle
export async function logout() {
  // İlk await'ten ÖNCE bu sekmenin hangi session'a ait olduğunu snapshot al.
  const logoutTabIdentity = getTabSessionIdentity();

  const logoutAccessToken = getAccessToken();

  const logoutRefreshToken = getRefreshToken();

  const logoutAccessIdentity = getTokenSessionIdentity(
    logoutAccessToken,
    "access",
  );

  const logoutRefreshIdentity = getTokenSessionIdentity(
    logoutRefreshToken,
    "refresh",
  );

  // Bu tab gerçekten localStorage'daki aktif session'ın sahibi mi?
  const ownsActiveSession = Boolean(
    logoutTabIdentity && logoutRefreshIdentity === logoutTabIdentity,
  );

  // KRİTİK:
  // Socket ilk await'ten önce kapanır.
  window.dispatchEvent(new Event(AUTH_LOCAL_LOGOUT_EVENT));

  // Bu sekmedeki bekleyen eski HTTP/refresh işlerini stale yap.
  const logoutGeneration = advanceAuthGeneration();

  // Local cleanup network beklemez.
  await withAuthMutationLock(async () => {
    // Stale A tab, localStorage'daki B session'ını silemez.
    if (
      !ownsActiveSession ||
      getTabSessionIdentity() !== logoutTabIdentity ||
      getRefreshToken() !== logoutRefreshToken
    ) {
      return;
    }

    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
  });

  // Server logout LOCAL logout'u bloklamaz.
  //
  // Yalnız snapshot'ın gerçekten bu tab session'ına
  // ait access token olduğunu biliyorsak gönder.
  if (
    ownsActiveSession &&
    logoutAccessToken &&
    logoutAccessIdentity === logoutTabIdentity
  ) {
    void fetch(`${BASE_URL}/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${logoutAccessToken}`,
      },
      keepalive: true,
    }).catch(() => {
      // Local logout zaten tamamlandı.
      // Expired access token server revoke konusu
      // backend adımında ayrıca çözülecek.
    });
  }

  // Logout başladıktan sonra aynı sekmede yeni login olduysa
  // eski logout yeni session'ı /login'e gönderemez.
  if (getAuthGeneration() === logoutGeneration) {
    window.dispatchEvent(new Event(AUTH_LOGIN_REQUIRED_EVENT));
  }
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
export async function dbCreateTimer(timer) {
  const response = await apiFetch(`${BASE_URL}/timers`, {
    method: "POST",
    headers: authHeader(),
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
export async function dbUpdateTimer(timerId, updates) {
  const response = await apiFetch(`${BASE_URL}/timers/${timerId}`, {
    method: "PATCH",
    headers: authHeader(),
    body: JSON.stringify(updates),
  });
  if (!response) return null;
  return await response.json();
}

// Timer sil (soft delete)
export async function dbDeleteTimer(timerId) {
  console.log(
    "[DEBUG-DBDELETE] çağrıldı, timerId:",
    timerId,
    "url:",
    `${BASE_URL}/timers/${timerId}`,
  );
  const response = await apiFetch(`${BASE_URL}/timers/${timerId}`, {
    method: "DELETE",
    headers: authHeader(),
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
export async function dbGetSharedTimers() {
  const response = await apiFetch(`${BASE_URL}/timers/shared`, {
    headers: authHeader(),
  });
  // token yok ya da istek başarısız (503/500 vb.) → null: "bilinmiyor", local veriyi silme
  if (!response || !response.ok) return null;
  const data = await response.json();
  return data.timers || []; // gerçekten boşsa [] — bu güvenle "hiç yok" demek
}

// Timer başlat
export async function syncTimerStart(timer) {
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
export async function syncTimerCancel(timerId) {
  try {
    await apiFetch(`${BASE_URL}/timer/cancel`, {
      method: "POST",
      headers: authHeader(),
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
