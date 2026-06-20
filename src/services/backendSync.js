const BASE_URL = "https://multi-stopwatch-backend.onrender.com";

// Kullanıcı ID'sini localStorage'dan al veya oluştur
export function getUserId() {
  let userId = localStorage.getItem("userId");
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem("userId", userId);
  }
  return userId;
}

// Kullanıcıyı sunucuya kaydet
export async function registerUser(chatId) {
  const userId = getUserId();
  try {
    const response = await fetch(`${BASE_URL}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, chatId }),
    });
    const data = await response.json();
    console.log("[Backend] Kullanıcı kaydedildi:", data);
    return data;
  } catch (err) {
    console.error("[Backend] Kayıt hatası:", err);
  }
}

// Sunucuya kayıtlı mı kontrol et
export function isRegistered() {
  return !!localStorage.getItem("telegramChatId");
}

// Chat ID'yi kaydet
export function saveChatId(chatId) {
  localStorage.setItem("telegramChatId", chatId);
}

// Chat ID'yi al
export function getChatId() {
  return localStorage.getItem("telegramChatId");
}

// Timer başlat
export async function syncTimerStart(timer) {
  const userId = getUserId();
  const chatId = getChatId();
  if (!chatId) return; // Kayıtlı değilse atla

  // endsAt hesapla
  let endsAt;
  if (timer.type === "down") {
    const total = timer.targetMinutes * 60 * 1000;
    const elapsed = timer.accumulatedTime + (Date.now() - timer.startTime);
    const remaining = total - elapsed;
    endsAt = Date.now() + remaining;
  } else {
    // count-up — hedef varsa
    if (!timer.targetMinutes) return;
    const elapsed = timer.accumulatedTime + (Date.now() - timer.startTime);
    const remaining = timer.targetMinutes * 60 * 1000 - elapsed;
    if (remaining <= 0) return;
    endsAt = Date.now() + remaining;
  }

  try {
    await fetch(`${BASE_URL}/timer/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        timerId: timer.id,
        timerName: timer.name,
        timerIsPay: timer.isPay,
        endsAt,
      }),
    });
    console.log("[Backend] Timer başlatıldı:", timer.name);
  } catch (err) {
    console.error("[Backend] Timer başlatma hatası:", err);
  }
}

// Timer iptal
export async function syncTimerCancel(timerId) {
  try {
    await fetch(`${BASE_URL}/timer/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timerId }),
    });
    console.log("[Backend] Timer iptal edildi:", timerId);
  } catch (err) {
    console.error("[Backend] Timer iptal hatası:", err);
  }
}