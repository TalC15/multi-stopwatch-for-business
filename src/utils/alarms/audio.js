import { alarmOn, speechOn } from './preferences.js';

// At most two reusable media elements, regardless of the number of finished timers.
export function createAlarmAudio({ sources, settings, createAudio = () => new Audio(), onError = () => {} }) {
  const players = new Map();
  function playerFor(type) {
    const key = type === 'up' ? 'up' : 'down';
    if (!players.has(key)) {
      const audio = createAudio();
      audio.src = sources[key]; audio.preload = 'auto';
      const state = { audio, owners: new Map(), generation: 0, timeout: null };
      audio.onended = () => stop(state);
      audio.onerror = () => { onError(new Error('Alarm sesi yüklenemedi')); stop(state); };
      players.set(key, state);
    }
    return players.get(key);
  }
  function release(state, owner) {
    if (state.owners.get(owner.id) !== owner) return;
    state.owners.delete(owner.id);
    owner.signal.removeEventListener('abort', owner.abort);
    owner.resolve();
    if (!state.owners.size) {
      state.generation++;
      clearTimeout(state.timeout); state.timeout = null;
      state.audio.pause(); state.audio.currentTime = 0;
    }
  }
  function stop(state) { for (const owner of state.owners.values()) release(state, owner); }
  function apply(state) {
    const preferences = settings();
    if (!alarmOn(preferences)) { stop(state); return; }
    state.audio.volume = preferences.alarmVolume / 100;
    state.audio.loop = speechOn(preferences);
    clearTimeout(state.timeout); state.timeout = null;
    // Tone-only mode should end with the file; bound stalled media without polling.
    if (state.owners.size && !state.audio.loop) state.timeout = setTimeout(() => stop(state), 30000);
  }
  return {
    play(item, signal) {
      if (signal.aborted || !alarmOn(settings())) return Promise.resolve();
      const state = playerFor(item.type);
      if (state.owners.has(item.id)) return state.owners.get(item.id).done;
      const first = !state.owners.size;
      let resolve;
      const done = new Promise(r => { resolve = r; });
      const owner = { id: item.id, signal, resolve, done, abort: null };
      owner.abort = () => release(state, owner);
      state.owners.set(item.id, owner);
      signal.addEventListener('abort', owner.abort, { once: true });
      apply(state);
      if (first) {
        const generation = ++state.generation;
        state.audio.muted = false; state.audio.currentTime = 0;
        try {
          Promise.resolve(state.audio.play()).catch(error => {
            if (generation !== state.generation) return;
            onError(error); stop(state);
          });
        } catch (error) { onError(error); stop(state); }
      }
      return done;
    },
    applySettings() { for (const state of players.values()) apply(state); },
    stop() { for (const state of players.values()) stop(state); },
    unlock() {
      if (!alarmOn(settings())) return;
      for (const type of ['up', 'down']) {
        const state = playerFor(type);
        if (state.owners.size) continue;
        const generation = ++state.generation;
        state.audio.muted = true;
        try {
          Promise.resolve(state.audio.play()).catch(() => {}).finally(() => {
            if (generation !== state.generation) return;
            state.audio.pause(); state.audio.currentTime = 0; state.audio.muted = false;
          });
        } catch { state.audio.muted = false; }
      }
    },
  };
}
