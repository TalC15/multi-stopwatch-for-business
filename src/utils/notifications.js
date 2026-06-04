// ─── Tur Bazlı Ses Kuyruğu ────────────────────────────────────────────────
//
// Her timer bitince activeTimers setine eklenir (max 3 tur).
// Her tur: o anda aktif olan tüm timer'lar sırayla söylenir, aralarında 1sn.
// Tur bittikten sonra 2sn beklenip sonraki tur başlar.
// Timer durdurulunca o timer setden çıkar — o turdan itibaren söylenmez.
// ─────────────────────────────────────────────────────────────────────────────
 
// { timerId → { name, remainingTurns } }
const activeTimers = new Map();
 
const TOTAL_TURNS = 5;       // kaç tur tekrar edilecek
const GAP_BETWEEN = 1000;    // aynı tur içinde sesler arası (ms)
const GAP_TURN = 1000;       // turlar arası bekleme (ms)
 
let isRunning = false;
 
function getTurkishVoice() {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find(v => v.lang === 'tr-TR' && v.localService) ||
    voices.find(v => v.lang === 'tr-TR') ||
    voices.find(v => v.lang.startsWith('tr')) ||
    null
  );
}
 
function speakOne(text) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    window.speechSynthesis.cancel();
 
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getTurkishVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = 'tr-TR';
    utterance.rate = 0.88;
    utterance.pitch = 1.05;
    utterance.volume = 1.0;
 
    utterance.onend = resolve;
    utterance.onerror = resolve;
 
    setTimeout(() => window.speechSynthesis.speak(utterance), 80);
  });
}
 
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
 
async function runTurns() {
  if (isRunning) return;
  isRunning = true;
 
  // Kaç tur çalıştıracağımızı başlangıçta belirle
  // Her döngüde activeTimers'a yeni timer eklenebilir
  let turn = 0;
 
  while (true) {
    // Bu turda seslendirilecek timer'ları al (remainingTurns > 0 olanlar)
    const toSpeak = [...activeTimers.values()].filter(t => t.remainingTurns > 0);
    
    if (toSpeak.length === 0) break;
 
    // Bu turdaki her timer'ı sırayla söyle
    for (let i = 0; i < toSpeak.length; i++) {
      const item = toSpeak[i];
 
      // Timer bu arada durdurulmuş olabilir, kontrol et
      const current = activeTimers.get(item.timerId);
      if (!current || current.remainingTurns <= 0) continue;
 
      await speakOne(`${item.name} bitti`);
 
      // Aynı tur içinde sonraki ses varsa 1sn bekle
      const hasNext = toSpeak.slice(i + 1).some(t => {
        const c = activeTimers.get(t.timerId);
        return c && c.remainingTurns > 0;
      });
      if (hasNext) await wait(GAP_BETWEEN);
    }
 
    // Bu turda seslendirilen timer'ların remainingTurns'ünü azalt
    for (const item of toSpeak) {
      const current = activeTimers.get(item.timerId);
      if (current) {
        current.remainingTurns--;
        if (current.remainingTurns <= 0) {
          activeTimers.delete(item.timerId);
        }
      }
    }
 
    turn++;
 
    // Hâlâ seslendirilecek timer var mı?
    const remaining = [...activeTimers.values()].filter(t => t.remainingTurns > 0);
    if (remaining.length === 0) break;
 
    // Sonraki tura geçmeden 2sn bekle
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
  // Sistem bildirimi
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Süre doldu! ⏰', {
      body: `${timerName} bitti`,
      icon: '/icons/pwa-192x192.png',
      vibrate: [200, 100, 200],
      tag: timerId,
    });
  }
 
  // Zaten aktifse turlarını sıfırla (tekrar bitti durumu)
  if (activeTimers.has(timerId)) {
    activeTimers.get(timerId).remainingTurns = TOTAL_TURNS;
  } else {
    activeTimers.set(timerId, { timerId, name: timerName, remainingTurns: TOTAL_TURNS });
  }
 
  // Döngü çalışmıyorsa başlat
  runTurns();
}
 
export function cancelTimerSound(timerId) {
  activeTimers.delete(timerId);
}