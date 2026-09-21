const BASE_URL = "https://multi-stopwatch-backend.onrender.com";
import router from "../router";
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
export async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return { ok: false, hardFail: true };

  try {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (response.ok) {
      const data = await response.json();
      saveTokens(data.accessToken, null);
      return { ok: true };
    }

    // 401/403 → oturum gerçekten geçersiz, çıkış yapılmalı
    // Diğer (503, 500 vb.) → geçici sorun, oturum SİLİNMEMELİ
    const hardFail = response.status === 401 || response.status === 403;
    return { ok: false, hardFail };
  } catch {
    // Ağ hatası (internet yok, sunucuya ulaşılamadı) → geçici, oturum SİLİNMEMELİ
    return { ok: false, hardFail: false };
  }
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
  if (!response) return [];
  const data = await response.json();
  return data.timers || [];
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
    if (!response) return {success:false};
    const data = await response.json();
    return data;
  } catch (err) {
    console.error("[Backend] Telegram bağlantısı kontrol hatası:", err);
    return { success: false };
  }
}
