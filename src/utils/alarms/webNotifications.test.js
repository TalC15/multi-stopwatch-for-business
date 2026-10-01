import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebNotificationPresenter } from './webNotifications.js';
const timer = { id: 'masa-1', name: 'Masa 1', isPay: true };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('mobile PWA uses service worker, stable tag, Turkish payment text and the supplied logo', async () => {
  const calls = [];
  const presenter = createWebNotificationPresenter({ Notification: { permission: 'granted' }, navigator: { serviceWorker: {
    getRegistration: async () => ({ active: true, showNotification: async (...args) => calls.push(args) }),
  } } });
  await presenter.show(timer);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].tag, 'keeptimer:masa-1');
  assert.equal(calls[0][1].body, 'Masa 1 bitti ve ödendi');
  assert.equal(calls[0][1].icon, '/icons/notification-logo.png');
});
test('denied permission does not prompt or post', async () => {
  let calls = 0;
  const presenter = createWebNotificationPresenter({ Notification: { permission: 'denied' }, navigator: { serviceWorker: {
    getRegistration: async () => { calls++; },
  } } });
  await presenter.show(timer); assert.equal(calls, 0);
});
test('cancel while waiting for the worker does not show stale notification', async () => {
  const wait = deferred(); let valid = true, shown = 0;
  const presenter = createWebNotificationPresenter({ Notification: { permission: 'granted' }, navigator: { serviceWorker: {
    getRegistration: () => wait.promise,
  } } });
  const done = presenter.show(timer, () => valid); valid = false;
  wait.resolve({ active: true, showNotification: async () => { shown++; } });
  await done; assert.equal(shown, 0);
});
test('cancel during in-flight show closes the newly delivered notification', async () => {
  const entered = deferred(), release = deferred(); let valid = true, closed = 0;
  const presenter = createWebNotificationPresenter({ Notification: { permission: 'granted' }, navigator: { serviceWorker: {
    getRegistration: async () => ({ active: true,
      showNotification: async () => { entered.resolve(); await release.promise; },
      getNotifications: async ({ tag }) => { assert.equal(tag, 'keeptimer:masa-1'); return [{ close: () => closed++ }]; },
    }),
  } } });
  const done = presenter.show(timer, () => valid); await entered.promise; valid = false; release.resolve();
  await done; assert.equal(closed, 1);
});
test('desktop fallback focuses app and acknowledges the correct timer', async () => {
  let notification, focused = 0, acknowledged;
  class FakeNotification {
    static permission = 'granted';
    constructor(title, options) { notification = this; this.options = options; }
    close() { this.onclose?.(); }
  }
  const presenter = createWebNotificationPresenter({ Notification: FakeNotification, focus: () => focused++ });
  await presenter.show(timer, () => true, id => { acknowledged = id; }); notification.onclick();
  assert.equal(focused, 1); assert.equal(acknowledged, timer.id);
  await presenter.cancel(timer.id);
});
