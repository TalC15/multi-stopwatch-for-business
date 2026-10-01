export const NOTIFICATION_OWNER = 'keeptimer-v2';
export function notificationId(value) {
  // Full string hash, including non-UUID IDs; always a positive Android int.
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) % 2147483646 + 1;
}
export function alarmDeadline(timer, now = Date.now()) {
  if (timer.status !== 'running' || timer.reachedTarget || !(timer.targetMinutes > 0)) return null;
  if (timer.dataMode === 'shared' && Number.isFinite(timer.alarmAt)) return timer.alarmAt;
  const elapsed = timer.dataMode === 'shared'
    ? Number(timer.elapsed || 0)
    : Number(timer.accumulatedTime || 0) + (Number.isFinite(timer.startTime) ? now - timer.startTime : 0);
  const at = now + timer.targetMinutes * 60000 - elapsed;
  return Number.isFinite(at) ? at : null;
}

// All native writes are serialized, so an in-flight schedule cannot undo a later pause/delete.
export function createNativeScheduler({ plugin, makeNotification, now = Date.now, storage = globalThis.localStorage, profile = () => 'audible' }) {
  const planned = new Map();
  const reserved = new Set();
  const storageKey = 'keeptimer.notification-plans.v2';
  const save = () => {
    try { storage?.setItem(storageKey, JSON.stringify([...planned])); } catch { /* native pending list remains a fallback */ }
  };
  let loaded = false, chain = Promise.resolve();
  const serial = work => {
    const job = chain.then(work);
    chain = job.catch(() => {});
    return job;
  };
  async function load() {
    if (loaded) return;
    const [pending, delivered] = await Promise.all([plugin.getPending(), plugin.getDeliveredNotifications()]);
    for (const item of [...delivered.notifications, ...pending.notifications]) reserved.add(item.id);
    // Android 8.2's delivered API omits our custom extra metadata. Keep receipts
    // locally so reopening after a delivered/dismissed alarm cannot replay it.
    try {
      for (const [id, entry] of JSON.parse(storage?.getItem(storageKey) || '[]')) {
        if (typeof id === 'string' && Number.isInteger(entry.id) && Number.isFinite(entry.at) &&
            (entry.at <= now() || pending.notifications.some(item => item.id === entry.id))) planned.set(id, entry);
      }
    } catch { /* corrupt optional receipt cache */ }
    for (const item of [...delivered.notifications, ...pending.notifications]) {
      if (item.extra?.owner === NOTIFICATION_OWNER) {
        planned.set(item.extra.timerId, { id: item.id, at: item.extra.at, name: item.extra.name,
          isPay: item.extra.isPay, type: item.extra.type, profile: item.extra.profile });
      }
    }
    loaded = true;
    save();
  }
  function idFor(timerId) {
    if (planned.has(timerId)) return planned.get(timerId).id;
    let id = notificationId(timerId);
    const used = new Set([...planned.values()].map(item => item.id));
    while (used.has(id) || reserved.has(id)) id = id % 2147483646 + 1;
    return id;
  }
  async function remove(timerId, delivered = false) {
    const entry = planned.get(timerId);
    if (!entry) return;
    await plugin.cancel({ notifications: [{ id: entry.id }] });
    if (delivered) await plugin.removeDeliveredNotifications({ notifications: [{ id: entry.id }] });
    planned.delete(timerId);
    reserved.delete(entry.id);
    save();
  }
  return {
    reconcile(timers) {
      // Capture plain snapshots before crossing the asynchronous native bridge.
      const snapshot = timers.map(timer => ({ ...timer, deadline: alarmDeadline(timer, now()) }));
      return serial(async () => {
        await load();
        const visible = new Map(snapshot.map(t => [t.id, t]));
        for (const [id, entry] of planned) {
          const timer = visible.get(id);
          const completed = timer && (timer.reachedTarget || ['completed', 'expired'].includes(timer.status));
          if (!timer || (timer.deadline === null && !completed)) await remove(id, true);
          // Keep a due receipt so completion doesn't post the same notification twice.
          else if (completed && entry.at > now() + 1000) await remove(id);
        }
        for (const timer of snapshot) {
          if (timer.deadline === null || timer.deadline <= now()) continue;
          const existing = planned.get(timer.id);
          if (existing && !existing.dirty && Math.abs(existing.at - timer.deadline) < 1000 &&
              existing.profile === profile() && existing.name === timer.name && existing.isPay === timer.isPay && existing.type === timer.type) continue;
          const entry = { id: idFor(timer.id), at: timer.deadline, name: timer.name, isPay: timer.isPay, type: timer.type, profile: profile() };
          await plugin.schedule({ notifications: [makeNotification(timer, entry)] });
          planned.set(timer.id, entry);
          save();
        }
      });
    },
    complete(timer) {
      return serial(async () => {
        await load();
        const previous = planned.get(timer.id);
        if (previous && previous.at <= now() + 1000) return;
        const entry = { id: idFor(timer.id), at: now(), name: timer.name, isPay: timer.isPay, type: timer.type, profile: profile() };
        // No artificial 100ms exact alarm: immediate delivery uses no schedule.
        await plugin.schedule({ notifications: [makeNotification(timer, entry, true)] });
        planned.set(timer.id, entry);
        save();
      });
    },
    acknowledge(id) {
      return serial(async () => {
        await load();
        const entry = planned.get(id);
        if (!entry) return;
        await plugin.cancel({ notifications: [{ id: entry.id }] });
        await plugin.removeDeliveredNotifications({ notifications: [{ id: entry.id }] });
        // Keep the due receipt: tapping an OS alarm can precede the resumed JS tick.
        entry.acknowledged = true;
        save();
      });
    },
    invalidateFuture() {
      return serial(async () => {
        await load();
        for (const entry of planned.values()) if (entry.at > now()) entry.dirty = true;
      });
    },
    cancel(id) { return serial(async () => { await load(); await remove(id, true); }); },
  };
}
