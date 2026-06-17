// ─── Tur Bazlı Ses Kuyruğu ────────────────────────────────────────────────
//
// APK: @capacitor-community/text-to-speech (native TTS)
// PWA/Tarayıcı: Web Speech API fallback
// ─────────────────────────────────────────────────────────────────────────────
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { LocalNotifications } from "@capacitor/local-notifications";
import { hapticAlarm } from "./haptics";
const activeTimers = new Map();

const TOTAL_TURNS = 5;
const GAP_BETWEEN = 1000;
const GAP_TURN = 1000;

let isRunning = false;

function isCapacitor() {
  return (
    typeof window !== "undefined" &&
    window.Capacitor &&
    window.Capacitor.isNativePlatform()
  );
}

// Native TTS — sadece APK'da çalışır
async function speakNative(text) {
  await TextToSpeech.speak({
    text,
    lang: "tr-TR",
    rate: 0.88,
    pitch: 1.05,
    volume: 1.0,
  });
}

// Web TTS — tarayıcı/PWA
function speakWeb(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const trVoice =
      voices.find((v) => v.lang === "tr-TR" && v.localService) ||
      voices.find((v) => v.lang === "tr-TR") ||
      voices.find((v) => v.lang.startsWith("tr")) ||
      null;
    if (trVoice) utterance.voice = trVoice;
    utterance.lang = "tr-TR";
    utterance.rate = 0.88;
    utterance.pitch = 1.05;
    utterance.volume = 1.0;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    setTimeout(() => window.speechSynthesis.speak(utterance), 80);
  });
}

async function speakOne(text) {
  try {
    if (isCapacitor()) {
      await speakNative(text);
    } else {
      await speakWeb(text);
    }
  } catch (err) {
    console.error("TTS Error:", err);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTurns() {
  if (isRunning) return;
  isRunning = true;

  while (true) {
    const toSpeak = [...activeTimers.values()].filter(
      (t) => t.remainingTurns > 0,
    );
    if (toSpeak.length === 0) break;

    for (let i = 0; i < toSpeak.length; i++) {
      const item = toSpeak[i];
      const current = activeTimers.get(item.timerId);
      if (!current || current.remainingTurns <= 0) continue;
      await speakOne(`${item.name} bitti ve ${item.isPay}`);

      const hasNext = toSpeak.slice(i + 1).some((t) => {
        const c = activeTimers.get(t.timerId);
        return c && c.remainingTurns > 0;
      });
      if (hasNext) await wait(GAP_BETWEEN);
    }

    for (const item of toSpeak) {
      const current = activeTimers.get(item.timerId);
      if (current) {
        current.remainingTurns--;
        if (current.remainingTurns <= 0) {
          activeTimers.delete(item.timerId);
        }
      }
    }

    const remaining = [...activeTimers.values()].filter(
      (t) => t.remainingTurns > 0,
    );
    if (remaining.length === 0) break;

    await wait(GAP_TURN);
  }

  isRunning = false;
}

export async function requestNotificationPermission() {
  // Sadece Android'de kanal oluştur
  if (isCapacitor()) {
    try {
      await LocalNotifications.createChannel({
        id: "timer-channel",
        name: "Zamanlayıcı Bildirimleri",
        description: "Süre dolduğunda gelen bildirimler",
        importance: 5,
        sound: "default",
        vibration: true,
        visibility: 1,
        lights: true,
      });
      console.log("[DEBUG] kanal oluşturuldu");
      console.log(
        "[DEBUG] kanallar:",
        JSON.stringify(await LocalNotifications.listChannels()),
      );
    } catch (e) {
      console.error("[DEBUG] kanal hatası:", e);
    }
  }

  const perm = await LocalNotifications.checkPermissions();
  console.log("[DEBUG] izin durumu:", JSON.stringify(perm));

  if (perm.display !== "granted") {
    await LocalNotifications.requestPermissions();
    console.log("[DEBUG] izin istendi, sonuç:", JSON.stringify(result));
  }
}

function toNotifId(timerId) {
  // UUID'nin son 8 karakterini al, hex → integer'a çevir
  const hex = timerId.replace(/-/g, "").slice(-8);
  return parseInt(hex, 16) % 2147483647; // Android max int sınırı
}

export async function notifyTimerEnd(timerId, timerName, timerIsPay) {
  console.log("[DEBUG] notifyTimerEnd çağrıldı:", timerId, timerName);
  const paid = timerIsPay ? "ödendi" : "ödenmedi";
  hapticAlarm();
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: toNotifId(timerId),
          title: "Süre Doldu",
          body: `${timerName} bitti ve ${paid}`,
          channelId: isCapacitor() ? "timer-channel" : undefined,
          schedule: { at: new Date(Date.now() + 100) },
        },
      ],
    });
    console.log("[DEBUG] bildirim schedule edildi");
    const pending = await LocalNotifications.getPending();
    console.log("[DEBUG] pending bildirimler:", JSON.stringify(pending));
  } catch (e) {
    console.error("[DEBUG] schedule hatası:", e);
  }

  if (activeTimers.has(timerId)) {
    activeTimers.get(timerId).remainingTurns = TOTAL_TURNS;
  } else {
    activeTimers.set(timerId, {
      timerId,
      name: timerName,
      remainingTurns: TOTAL_TURNS,
      isPay: paid,
    });
  }
  console.log("[DEBUG] activeTimers:", [...activeTimers.keys()]);
  await runTurns();
}

export function cancelTimerSound(timerId) {
  activeTimers.delete(timerId);
   if (isCapacitor()) {
    LocalNotifications.cancel({ notifications: [{ id: toNotifId(timerId) }] });
  }
}
