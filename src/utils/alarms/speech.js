// Both APIs are bounded: a missing end callback must never block all later timers.
export function speakWeb(text, signal, host = globalThis, timeoutMs = 15000, volume = 1) {
  return new Promise(resolve => {
    const synth = host.speechSynthesis;
    if (!synth || !host.SpeechSynthesisUtterance || signal.aborted) return resolve();
    let finished = false, started = false, voiceTimer, watchdog;
    const cleanup = () => {
      clearTimeout(voiceTimer); clearTimeout(watchdog);
      synth.removeEventListener?.('voiceschanged', start);
      signal.removeEventListener('abort', abort);
    };
    const finish = () => { if (finished) return; finished = true; cleanup(); resolve(); };
    const abort = () => { finish(); synth.cancel(); };
    function start() {
      if (started || finished || signal.aborted) return;
      started = true;
      clearTimeout(voiceTimer);
      synth.removeEventListener?.('voiceschanged', start);
      const utterance = new host.SpeechSynthesisUtterance(text);
      const voices = synth.getVoices();
      const voice = voices.find(v => v.lang === 'tr-TR' && v.localService)
        || voices.find(v => v.lang?.toLowerCase().startsWith('tr'));
      if (voice) utterance.voice = voice;
      Object.assign(utterance, { lang: 'tr-TR', rate: 0.88, pitch: 1.05, volume: Math.max(0, Math.min(1, volume)),
        onend: finish, onerror: finish });
      try { synth.speak(utterance); } catch { finish(); }
    }
    signal.addEventListener('abort', abort, { once: true });
    watchdog = setTimeout(abort, timeoutMs);
    if (synth.getVoices().length) start();
    else {
      synth.addEventListener?.('voiceschanged', start);
      voiceTimer = setTimeout(start, 500);
    }
  });
}

export async function speakNative(text, signal, plugin, timeoutMs = 15000, volume = 1) {
  if (signal.aborted) return;
  let timer, abort;
  const stopped = new Promise(resolve => {
    abort = () => { Promise.resolve().then(() => plugin.stop()).catch(() => {}).finally(resolve); };
    signal.addEventListener('abort', abort, { once: true });
    // Resolve even if a broken native bridge never acknowledges stop().
    timer = setTimeout(() => { void Promise.resolve().then(() => plugin.stop()).catch(() => {}); resolve(); }, timeoutMs);
  });
  try {
    await Promise.race([plugin.speak({ text, lang: 'tr-TR', rate: 0.88, pitch: 1.05, volume: Math.max(0, Math.min(1, volume)) }), stopped]);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
