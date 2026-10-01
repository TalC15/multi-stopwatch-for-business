// Five round-robin TTS turns; each alarm has a separate lifetime from its utterances.
// Tone starts concurrently and is never paused merely because speech starts.
export function createAlarmQueue({ speak, tone = async () => {}, canSpeak = () => true,
  gap = 1000, turns = 5, onError = () => {} }) {
  const items = new Map();
  let running = null, current = null;
  const pause = () => new Promise(resolve => setTimeout(resolve, gap));
  function remove(item) {
    if (items.get(item.id) === item) items.delete(item.id);
    item.lifetime.abort();
    if (current?.item === item) current.controller.abort();
  }
  async function drain() {
    try {
      while (items.size) {
        for (const item of [...items.values()]) {
          if (items.get(item.id) !== item) continue;
          const controller = new AbortController();
          current = { item, controller };
          try {
            if (!item.started) {
              item.started = true;
              // Do not await this before speaking: audio and TTS must overlap.
              item.toneDone = Promise.resolve(tone(item, item.lifetime.signal)).catch(onError);
            }
            if (!controller.signal.aborted && canSpeak(item)) await speak(item, controller.signal);
            else if (!controller.signal.aborted) {
              // TTS disabled: finish the alarm file once instead of looping silently.
              await item.toneDone;
              item.remaining = 1;
            }
          } catch (error) { onError(error); }
          finally { if (current?.item === item) current = null; }
          if (items.get(item.id) === item && --item.remaining <= 0) remove(item);
          if (items.size) await pause();
        }
      }
    } finally {
      running = null;
      if (items.size) start();
    }
  }
  function start() { running ??= Promise.resolve().then(drain); return running; }
  return {
    enqueue(item) {
      const existing = items.get(item.id);
      if (existing) { existing.name = item.name; existing.paid = item.paid; return start(); }
      items.set(item.id, { ...item, remaining: item.turns ?? turns, started: false, lifetime: new AbortController() });
      return start();
    },
    update(id, { name, paid }) {
      const item = items.get(id);
      if (item) { item.name = name; item.paid = paid; }
    },
    interruptSpeech() { current?.controller.abort(); },
    cancel(id) { const item = items.get(id); if (item) remove(item); },
    stop() { for (const item of items.values()) remove(item); },
    get size() { return items.size; },
  };
}
