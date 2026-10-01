import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlarmQueue } from './queue.js';
import { speakWeb, speakNative } from './speech.js';
import { createNativeScheduler, notificationId, alarmDeadline, NOTIFICATION_OWNER } from './nativeScheduler.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const timer = (patch = {}) => ({ id: 'timer-business-1', name: 'Masa 1', isPay: false,
  type: 'down', dataMode: 'standalone', status: 'running', targetMinutes: 1,
  accumulatedTime: 10000, startTime: 1000, reachedTarget: false, ...patch });
const memory = () => { const data = new Map(); return { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v) }; };
function platform({ pending = [], delivered = [], storage = memory() } = {}) {
  const calls = [], clock = { now: 1000 };
  const plugin = { getPending: async () => ({ notifications: pending }),
    getDeliveredNotifications: async () => ({ notifications: delivered }),
    schedule: async ({ notifications }) => calls.push(['schedule', notifications]),
    cancel: async ({ notifications }) => calls.push(['cancel', notifications]),
    removeDeliveredNotifications: async ({ notifications }) => calls.push(['remove', notifications]) };
  const makeNotification = (t, entry, immediate) => ({ ...entry, immediate,
    extra: { owner: NOTIFICATION_OWNER, timerId: t.id, ...entry } });
  const scheduler = createNativeScheduler({ plugin, makeNotification, now: () => clock.now, storage });
  return { scheduler, calls, plugin, clock, storage, makeNotification };
}

test('five round-robin turns, one tone per timer, duplicate enqueue does not reset budget', async () => {
  const spoken = [], tones = [];
  const queue = createAlarmQueue({ gap: 0, speak: async item => { spoken.push(item.id); }, tone: async item => { tones.push(item.id); } });
  const done = queue.enqueue({ id: 'a', name: 'A' });
  queue.enqueue({ id: 'b', name: 'B' }); queue.enqueue({ id: 'a', name: 'Updated' });
  await done;
  assert.deepEqual(spoken, Array.from({ length: 5 }, () => ['a', 'b']).flat());
  assert.deepEqual(tones, ['a', 'b']); assert.equal(queue.size, 0);
});
test('cancel interrupts current speech; the other timer completes all five turns', async () => {
  const entered = deferred(), spoken = [];
  const queue = createAlarmQueue({ gap: 0, speak: async (item, signal) => {
    spoken.push(item.id);
    if (item.id === 'a') { entered.resolve(); await new Promise(r => signal.addEventListener('abort', r, { once: true })); }
  } });
  const done = queue.enqueue({ id: 'a' }); queue.enqueue({ id: 'b' });
  await entered.promise; queue.cancel('a'); await done;
  assert.equal(spoken.filter(id => id === 'a').length, 1);
  assert.equal(spoken.filter(id => id === 'b').length, 5);
});
test('failed speech cannot wedge the queue; newly arriving timers are processed', async () => {
  const errors = [], spoken = [];
  const queue = createAlarmQueue({ gap: 0, turns: 1, onError: e => errors.push(e), speak: async item => {
    spoken.push(item.id); if (item.id === 'a') { queue.enqueue({ id: 'b' }); throw Error('TTS failed'); }
  } });
  await queue.enqueue({ id: 'a' });
  assert.deepEqual(spoken, ['a','b']); assert.equal(errors.length, 1);
});
test('voiceschanged followed by fallback does not speak twice and removes listener', async () => {
  const events = new EventTarget(); let calls = 0;
  const host = { SpeechSynthesisUtterance: class {}, speechSynthesis: {
    getVoices: () => [], addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    cancel() {}, speak: utterance => { calls++; utterance.onend(); },
  } };
  const done = speakWeb('Test', new AbortController().signal, host);
  events.dispatchEvent(new Event('voiceschanged')); events.dispatchEvent(new Event('voiceschanged'));
  await done; assert.equal(calls, 1);
});
test('cancelling while waiting for voices never starts an utterance', async () => {
  const signal = new AbortController(); const events = new EventTarget(); let calls = 0;
  const host = { SpeechSynthesisUtterance: class {}, speechSynthesis: {
    getVoices: () => [], addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    cancel() {}, speak() { calls++; },
  } };
  const done = speakWeb('Test', signal.signal, host); signal.abort();
  events.dispatchEvent(new Event('voiceschanged')); await done; assert.equal(calls, 0);
});
test('missing native end callback times out and stops the plugin', async () => {
  let stopped = 0;
  await speakNative('Test', new AbortController().signal, { speak: () => new Promise(() => {}), stop: async () => { stopped++; } }, 5);
  assert.equal(stopped, 1);
});
test('deadlines use local anchors and shared server-derived elapsed, not device clock as server time', () => {
  assert.equal(alarmDeadline(timer(), 11000), 51000);
  assert.equal(alarmDeadline(timer({ dataMode: 'shared', elapsed: 25000, startTime: 999999 }), 11000), 46000);
  assert.equal(alarmDeadline(timer({ status: 'paused' })), null);
  assert.equal(alarmDeadline(timer({ reachedTarget: true })), null);
});
test('arbitrary string IDs are stable positive signed 32-bit integers', () => {
  for (const id of ['Masa 1', 'timer-business-1', 'abc', '00000000-0000-0000-0000-000000000000']) {
    const value = notificationId(id); assert.ok(Number.isInteger(value) && value > 0 && value <= 2147483647);
    assert.equal(value, notificationId(id));
  }
});
test('schedule once, update payment, cancel pause, reschedule resume, delete removes', async () => {
  const { scheduler, calls } = platform();
  await scheduler.reconcile([timer()]); await scheduler.reconcile([timer()]);
  assert.equal(calls.length, 1);
  await scheduler.reconcile([timer({ isPay: true })]); assert.equal(calls.filter(c => c[0] === 'schedule').length, 2);
  await scheduler.reconcile([timer({ status: 'paused' })]); assert.equal(calls.at(-2)[0], 'cancel');
  await scheduler.reconcile([timer({ startTime: 2000 })]); assert.equal(calls.at(-1)[0], 'schedule');
  await scheduler.reconcile([]); assert.equal(calls.at(-2)[0], 'cancel');
});
test('completion of a planned deadline does not post a second system notification', async () => {
  const { scheduler, calls, clock } = platform();
  await scheduler.reconcile([timer()]); clock.now = 51000;
  await scheduler.reconcile([timer({ status: 'completed', reachedTarget: true })]);
  await scheduler.complete(timer()); assert.equal(calls.filter(c => c[0] === 'schedule').length, 1);
});
test('unplanned completion sends once immediately, without scheduling an exact alarm', async () => {
  const { scheduler, calls } = platform();
  await scheduler.complete(timer()); await scheduler.complete(timer());
  assert.equal(calls.length, 1); assert.equal(calls[0][1][0].immediate, true);
});
test('cancellation is ordered after an in-flight schedule', async () => {
  const { scheduler, plugin, calls } = platform(); const entered = deferred(), release = deferred();
  plugin.schedule = async () => { entered.resolve(); await release.promise; calls.push(['schedule']); };
  const pending = scheduler.reconcile([timer()]); await entered.promise;
  const canceled = scheduler.cancel(timer().id); release.resolve(); await Promise.all([pending, canceled]);
  assert.deepEqual(calls.map(c => c[0]), ['schedule','cancel','remove']);
});
test('reload restores an already delivered receipt even when Android omits extra metadata', async () => {
  const setup = platform(); await setup.scheduler.reconcile([timer()]); setup.clock.now = 60000;
  const scheduler = createNativeScheduler({ plugin: setup.plugin, makeNotification: setup.makeNotification, now: () => setup.clock.now, storage: setup.storage });
  await scheduler.complete(timer()); assert.equal(setup.calls.length, 1);
});
test('missing future native plans are rescheduled on restart', async () => {
  const setup = platform(); await setup.scheduler.reconcile([timer()]);
  const scheduler = createNativeScheduler({ plugin: setup.plugin, makeNotification: setup.makeNotification, now: () => setup.clock.now, storage: setup.storage });
  await scheduler.reconcile([timer()]); assert.equal(setup.calls.length, 2);
});
test('native IDs do not collide with an existing unrelated notification', async () => {
  const setup = platform({ pending: [{ id: notificationId(timer().id), extra: { owner: 'other-plugin' } }] });
  await setup.scheduler.reconcile([timer()]); assert.notEqual(setup.calls[0][1][0].id, notificationId(timer().id));
  await setup.scheduler.reconcile([]); assert.notEqual(setup.calls.find(c => c[0] === 'cancel')[1][0].id, notificationId(timer().id));
});

test('stop clears queued timers and aborts current speech', async () => {
  const entered = deferred(), spoken = [];
  const queue = createAlarmQueue({ gap: 0, speak: async (item, signal) => {
    spoken.push(item.id); entered.resolve(); await new Promise(resolve => signal.addEventListener('abort', resolve));
  } });
  const done = queue.enqueue({ id: 'a' }); queue.enqueue({ id: 'b' });
  await entered.promise; queue.stop(); await done;
  assert.equal(queue.size, 0); assert.deepEqual(spoken, ['a']);
});

test('an exact-alarm permission change replans future deadlines without duplicating due alarms', async () => {
  const { scheduler, calls, clock } = platform();
  await scheduler.reconcile([timer()]);
  await scheduler.invalidateFuture(); await scheduler.reconcile([timer()]);
  assert.equal(calls.filter(c => c[0] === 'schedule').length, 2);
  clock.now = 60000;
  await scheduler.invalidateFuture(); await scheduler.complete(timer());
  assert.equal(calls.filter(c => c[0] === 'schedule').length, 2);
});

test('tapping a delivered OS alarm before the resumed JS tick preserves its receipt', async () => {
  const setup = platform();
  await setup.scheduler.reconcile([timer()]); setup.clock.now = 60000;
  await setup.scheduler.acknowledge(timer().id);
  await setup.scheduler.complete(timer());
  assert.equal(setup.calls.filter(c => c[0] === 'schedule').length, 1);
  const reopened = createNativeScheduler({ plugin: setup.plugin, makeNotification: setup.makeNotification,
    now: () => setup.clock.now, storage: setup.storage });
  await reopened.complete(timer());
  assert.equal(setup.calls.filter(c => c[0] === 'schedule').length, 1);
});
