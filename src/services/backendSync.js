const BASE_URL = "https://multi-stopwatch-backend.onrender.com";
import router from "../router";
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
// Token yönetimi
export function getAccessToken() {
  return localStorage.getItem("accessToken");
}

export function getRefreshToken() {
  return localStorage.getItem("refreshToken");
}

export function saveTokens(accessToken, refreshToken) {
  localStorage.setItem("accessToken", accessToken);
  if (refreshToken) localStorage.setItem("refreshToken", refreshToken);
}

export function clearTokens() {
  // Bekleyen eski auth işlemlerini geçersiz kıl.
  advanceAuthGeneration();

  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("user");
}

export function getUser() {
  const user = localStorage.getItem("user");
  return user ? JSON.parse(user) : null;
}

export function saveUser(user) {
  localStorage.setItem("user", JSON.stringify(user));
}

export function isLoggedIn() {
  return !!getAccessToken();
}

// Auth header
function authHeader() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getAccessToken()}`,
  };
}

// Token yenile
async function performRefresh(expectedGeneration) {
  // Bu refresh daha başlamadan oturum değişmişse hiçbir şey yapma.
  if (expectedGeneration !== authGeneration) {
    return {
      ok: false,
      hardFail: false,
      stale: true,
      generation: expectedGeneration,
    };
  }

  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    return {
      ok: false,
      hardFail: true,
      stale: false,
      generation: expectedGeneration,
    };
  }

  try {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    // Fetch beklerken logout / başka login gerçekleşmiş olabilir.
    // Eski cevabın yeni oturuma etkisi olmamalı.
    if (expectedGeneration !== authGeneration) {
      return {
        ok: false,
        hardFail: false,
        stale: true,
        generation: expectedGeneration,
      };
    }

    if (response.ok) {
      const data = await response.json();

      // response.json() beklenirken de oturum değişmiş olabilir.
      if (expectedGeneration !== authGeneration) {
        return {
          ok: false,
          hardFail: false,
          stale: true,
          generation: expectedGeneration,
        };
      }

      saveTokens(data.accessToken, null);

      return {
        ok: true,
        hardFail: false,
        stale: false,
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
    // Network hatası gelirken kullanıcı başka oturuma geçmiş olabilir.
    if (expectedGeneration !== authGeneration) {
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
export async function refreshAccessToken(expectedGeneration = authGeneration) {
  // Çağıran işlem artık eski bir oturuma aitse refresh başlatma.
  if (expectedGeneration !== authGeneration) {
    return {
      ok: false,
      hardFail: false,
      stale: true,
      generation: expectedGeneration,
    };
  }

  // Aynı oturuma ait mevcut refresh varsa onu paylaş.
  if (refreshState && refreshState.generation === expectedGeneration) {
    return refreshState.promise;
  }

  const promise = performRefresh(expectedGeneration).finally(() => {
    // Çok önemli:
    // Bu eski refresh tamamlanırken yeni oturumun refresh'i
    // başlamış olabilir. Yeni refreshState'i temizleme.
    if (
      refreshState?.generation === expectedGeneration &&
      refreshState?.promise === promise
    ) {
      refreshState = null;
    }
  });

  refreshState = {
    generation: expectedGeneration,
    promise,
  };

  return promise;
}

// Genel fetch — token süresi dolunca otomatik yeniler
export async function apiFetch(url, options = {}) {
  if (!getAccessToken()) return null;

  let response = await fetch(url, options);

  if (response.status === 401) {
    const result = await refreshAccessToken();
    if (result.ok) {
      options.headers = authHeader();
      response = await fetch(url, options);
    } else if (result.hardFail) {
      clearTokens();
      router.push("/login");
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
      return { success: false, error: data.error };
    }
    advanceAuthGeneration();
    saveTokens(data.accessToken, data.refreshToken);
    saveUser(data.user);
    return { success: true, user: data.user };
  } catch {
    return { success: false, error: "Sunucuya bağlanılamadı" };
  }
}

// Çıkış — backend'e haber ver (oturumu iptal et), sonra local temizle
export async function logout() {
  try {
    await apiFetch(`${BASE_URL}/auth/logout`, {
      method: "POST",
      headers: authHeader(),
    });
  } catch {
    // Backend'e ulaşılamasa bile local temizlik devam etmeli
  }
  clearTokens();
  window.location.reload();
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
