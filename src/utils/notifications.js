// ─── Tur Bazlı Ses Kuyruğu ────────────────────────────────────────────────
 
const activeTimers = new Map();
 
const TOTAL_TURNS = 5;
const GAP_BETWEEN = 1000;
const GAP_TURN = 1000;
 
let isRunning = false;
 
// Capacitor ortamında mıyız?
function isCapacitor() {
  return typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform();
}
 
// Native TTS (sadece APK)
async function speakNative(text) {
  const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
  await TextToSpeech.speak({
    text,
    lang: 'tr-TR',
    rate: 0.88,
    pitch: 1.05,
    volume: 1.0,
    category: 'ambient',
  });
}
 
// Web TTS (tarayıcı / PWA)
function speakWeb(text) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const trVoice =
      voices.find(v => v.lang === 'tr-TR' && v.localService) ||
      voices.find(v => v.lang === 'tr-TR') ||
      voices.find(v => v.lang.startsWith('tr')) ||
      null;
    if (trVoice) utterance.voice = trVoice;
    utterance.lang = 'tr-TR';
    utterance.rate = 0.88;
    utterance.pitch = 1.05;
    utterance.volume = 1.0;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    setTimeout(() => window.speechSynthesis.speak(utterance), 80);
  });
}
 
async function speakOne(text) {
  if (isCapacitor()) {
    await speakNative(text);
  } else {
    await speakWeb(text);
  }
}
 
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
 
async function runTurns() {
  if (isRunning) return;
  isRunning = true;
 
  while (true) {
    const toSpeak = [...activeTimers.values()].filter(t => t.remainingTurns > 0);
    if (toSpeak.length === 0) break;
 
    for (let i = 0; i < toSpeak.length; i++) {
      const item = toSpeak[i];
      const current = activeTimers.get(item.timerId);
      if (!current || current.remainingTurns <= 0) continue;
 
      await speakOne(`${item.name} bitti`);
 
      const hasNext = toSpeak.slice(i + 1).some(t => {
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
 
    const remaining = [...activeTimers.values()].filter(t => t.remainingTurns > 0);
    if (remaining.length === 0) break;
 
    await wait(GAP_TURN);
  }
 
  isRunning = false;
}
 
// ─── Dışa açık fonksiyonlar ───────────────────────────────────────────────
 
export async function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}
 
export function notifyTimerEnd(timerId, timerName) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Süre doldu! ⏰', {
      body: `${timerName} bitti`,
      icon: '/icons/pwa-192x192.png',
      vibrate: [200, 100, 200],
      tag: timerId,
    });
  }
 
  if (activeTimers.has(timerId)) {
    activeTimers.get(timerId).remainingTurns = TOTAL_TURNS;
  } else {
    activeTimers.set(timerId, { timerId, name: timerName, remainingTurns: TOTAL_TURNS });
  }
 
  runTurns();
}
 
export function cancelTimerSound(timerId) {
  activeTimers.delete(timerId);
}