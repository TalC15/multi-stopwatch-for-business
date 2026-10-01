import test from 'node:test';
import assert from 'node:assert/strict';
import { reactive, watch, nextTick } from 'vue';
import { createAlarmAudio } from './audio.js';
import { createAlarmQueue } from './queue.js';
import { alarmSnapshot } from './snapshot.js';
import { alarmDeadline, createNativeScheduler } from './nativeScheduler.js';
import { normalizeSoundSettings, readSoundSettings, notificationSoundProfile, DEFAULT_SOUND_SETTINGS } from './preferences.js';
import { speakWeb, speakNative } from './speech.js';
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
function audioFixture(overrides = {}) {
  const preferences = { ...DEFAULT_SOUND_SETTINGS, ...overrides }, players = [], errors = [];
  const manager = createAlarmAudio({ sources: { up: 'radar.mp3', down: 'digital.mp3' }, settings: () => preferences,
    onError: error => errors.push(error), createAudio: () => {
      const audio = { pauses: 0, plays: 0, currentTime: 0, play() { this.plays++; return Promise.resolve(); }, pause() { this.pauses++; } };
      players.push(audio); return audio;
    } });
  return { preferences, players, errors, manager };
}

test('TTS begins without waiting for the alarm to end; alarm stays alive across all five turns', async () => {
  const spoken = [], finished = deferred(); let toneActive = false;
  const queue = createAlarmQueue({ gap: 0, tone: (_item, signal) => {
    toneActive = true;
    signal.addEventListener('abort', () => { toneActive = false; finished.resolve(); }, { once: true });
    return finished.promise;
  }, speak: async item => { assert.equal(toneActive, true); spoken.push(item.id); } });
  await queue.enqueue({ id: 'a' });
  assert.equal(spoken.length, 5); assert.equal(toneActive, false);
});
test('payment change updates the next TTS turn without adding a new event or resetting turns', async () => {
  const entered = deferred(), release = deferred(), spoken = [];
  const queue = createAlarmQueue({ gap: 0, speak: async item => {
    spoken.push(item.paid);
    if (spoken.length === 1) { entered.resolve(); await release.promise; }
  } });
  const done = queue.enqueue({ id: 'a', name: 'Masa 1', paid: 'ödenmedi' });
  await entered.promise; queue.update('a', { name: 'Masa 1', paid: 'ödendi' }); release.resolve();
  await done; assert.deepEqual(spoken, ['ödenmedi','ödendi','ödendi','ödendi','ödendi']);
  queue.update('missing', { name: 'Unused', paid: 'ödendi' }); assert.equal(queue.size, 0);
});
test('tone-only mode plays once to media end and never invokes TTS', async () => {
  const fx = audioFixture({ speechEnabled: false }); let speeches = 0;
  const started = deferred();
  const queue = createAlarmQueue({ gap: 0, canSpeak: () => false,
    tone: (item, signal) => { const done = fx.manager.play(item, signal); started.resolve(); return done; },
    speak: async () => { speeches++; } });
  const done = queue.enqueue({ id: 'a', type: 'down' }); await started.promise;
  assert.equal(fx.players[0].loop, false); assert.equal(fx.players[0].plays, 1);
  fx.players[0].onended(); await done;
  assert.equal(speeches, 0); assert.equal(queue.size, 0);
});
test('one hundred simultaneous owners allocate only two audio elements and cancel independently', async () => {
  const fx = audioFixture(), controls = [], jobs = [];
  for (let i = 0; i < 100; i++) {
    const controller = new AbortController(); controls.push(controller);
    jobs.push(fx.manager.play({ id: String(i), type: i % 2 ? 'up' : 'down' }, controller.signal));
  }
  assert.equal(fx.players.length, 2); assert.deepEqual(fx.players.map(p => p.plays), [1,1]);
  controls[0].abort(); assert.equal(fx.players[0].pauses, 0);
  controls.forEach(c => c.abort()); await Promise.all(jobs);
  assert.deepEqual(fx.players.map(p => p.pauses), [1,1]);
});
test('live alarm volume changes preserve playback; disabling immediately releases every owner', async () => {
  const fx = audioFixture(), control = new AbortController();
  const done = fx.manager.play({ id: 'a', type: 'up' }, control.signal);
  fx.preferences.alarmVolume = 35; fx.manager.applySettings();
  assert.equal(fx.players[0].volume, 0.35); assert.equal(fx.players[0].pauses, 0);
  fx.preferences.alarmEnabled = false; fx.manager.applySettings(); await done;
  assert.equal(fx.players[0].pauses, 1);
  await fx.manager.play({ id: 'b' }, new AbortController().signal); assert.equal(fx.players.length, 1);
});
test('turning TTS off changes looping audio to one final pass and interrupts speech only', async () => {
  const fx = audioFixture(), entered = deferred();
  const queue = createAlarmQueue({ gap: 0, canSpeak: () => fx.preferences.speechEnabled,
    tone: (item, signal) => fx.manager.play(item, signal), speak: async (_item, signal) => {
      entered.resolve(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    } });
  const done = queue.enqueue({ id: 'a', type: 'down' }); await entered.promise;
  fx.preferences.speechEnabled = false; queue.interruptSpeech(); fx.manager.applySettings();
  assert.equal(fx.players[0].loop, false); assert.equal(fx.players[0].pauses, 0);
  fx.players[0].onended(); await done; assert.equal(queue.size, 0);
});
test('late rejected playback from a cancelled generation cannot stop a newer alarm', async () => {
  const fx = audioFixture(), old = new AbortController(); const pending = deferred();
  fx.manager.unlock(); await Promise.resolve(); await Promise.resolve();
  const player = fx.players[0]; player.play = () => pending.promise;
  const before = fx.manager.play({ id: 'old', type: 'up' }, old.signal); old.abort(); await before;
  player.play = () => Promise.resolve();
  const next = new AbortController(), after = fx.manager.play({ id: 'new', type: 'up' }, next.signal);
  const pauses = player.pauses;
  pending.reject(new Error('stale playback')); await Promise.resolve();
  assert.equal(fx.errors.length, 0);
  assert.equal(player.pauses, pauses); next.abort(); await after;
});
test('preferences retain false/zero, clamp volumes and recover from invalid or denied storage', () => {
  assert.deepEqual(normalizeSoundSettings({ speechEnabled:false, alarmEnabled:false, speechVolume:0, alarmVolume:0 }),
    { speechEnabled:false, alarmEnabled:false, speechVolume:0, alarmVolume:0 });
  assert.equal(normalizeSoundSettings({ alarmVolume: 150 }).alarmVolume, 100);
  assert.equal(normalizeSoundSettings({ speechVolume: -4 }).speechVolume, 0);
  assert.deepEqual(readSoundSettings({ getItem: () => '{broken' }), DEFAULT_SOUND_SETTINGS);
  assert.deepEqual(readSoundSettings({ getItem: () => { throw Error('blocked'); } }), DEFAULT_SOUND_SETTINGS);
  assert.deepEqual(readSoundSettings({ getItem: () => JSON.stringify({ ...DEFAULT_SOUND_SETTINGS, alarmEnabled: false }) }),
    { ...DEFAULT_SOUND_SETTINGS, alarmEnabled: false });
});
test('alarm-disabled and foreground native notifications use quiet profile; background enabled uses audible', () => {
  assert.equal(notificationSoundProfile(DEFAULT_SOUND_SETTINGS, true), 'quiet');
  assert.equal(notificationSoundProfile(DEFAULT_SOUND_SETTINGS, false), 'audible');
  assert.equal(notificationSoundProfile({ ...DEFAULT_SOUND_SETTINGS, alarmEnabled: false }, false), 'quiet');
  assert.equal(notificationSoundProfile({ ...DEFAULT_SOUND_SETTINGS, alarmVolume: 0 }, false), 'quiet');
});
test('100 display ticks do not trigger alarm watchers; actual payment change does', async () => {
  const timers = reactive([{ id:'a', type:'up', dataMode:'standalone', status:'running', startTime:1000,
    targetMinutes:1, accumulatedTime:0, elapsed:0, remaining:60000, name:'Masa', isPay:false },
    { id:'b', type:'down', dataMode:'shared', status:'running', targetMinutes:1, elapsed:0, name:'Ortak', isPay:false }]);
  let changes = 0;
  const stop = watch(() => alarmSnapshot(timers, 1000), () => changes++);
  for (let i=0;i<100;i++) {
    timers[0].elapsed = i*100; timers[0].remaining = 60000-i*100; timers[1].elapsed = i*100;
    await nextTick();
  }
  assert.equal(changes, 0);
  timers[0].isPay = true; await nextTick(); assert.equal(changes, 1); stop();
});
test('shared settings/lifecycle replan keeps its original deadline rather than delaying by snapshot age', () => {
  const snapshot = alarmSnapshot([{ id:'s', dataMode:'shared', status:'running', targetMinutes:1, elapsed:10000 }], 100000)[0];
  assert.equal(alarmDeadline(snapshot, 100000), 150000);
  assert.equal(alarmDeadline(snapshot, 130000), 150000);
});
test('native and web TTS receive independent selected speech volume', async () => {
  let nativeVolume, webVolume;
  await speakNative('test', new AbortController().signal, { speak: async options => { nativeVolume=options.volume; }, stop: async()=>{} }, 15000, 0.4);
  await speakWeb('test', new AbortController().signal, { SpeechSynthesisUtterance: class {}, speechSynthesis: {
    getVoices: () => [{lang:'tr-TR'}], speak: u => { webVolume=u.volume; u.onend(); }, cancel() {},
  } }, 15000, 0.65);
  assert.equal(nativeVolume, 0.4); assert.equal(webVolume, 0.65);
});
test('native replans only when audio profile changes, without erasing due receipts', async () => {
  let currentProfile='quiet', time=1000; const calls=[];
  const scheduler = createNativeScheduler({ now:()=>time, profile:()=>currentProfile,
    plugin: { getPending:async()=>({notifications:[]}), getDeliveredNotifications:async()=>({notifications:[]}),
      schedule:async payload=>calls.push(payload), cancel:async()=>{}, removeDeliveredNotifications:async()=>{} },
    makeNotification:(timer,entry)=>entry });
  const timer={id:'a',status:'running',type:'down',targetMinutes:1,startTime:1000,accumulatedTime:0};
  await scheduler.reconcile([timer]); await scheduler.reconcile([timer]); assert.equal(calls.length,1);
  currentProfile='audible'; await scheduler.reconcile([timer]); assert.equal(calls.length,2);
  assert.equal(calls[1].notifications[0].profile,'audible');
  time=62000; currentProfile='quiet'; await scheduler.complete(timer); assert.equal(calls.length,2);
});
