import { toRaw } from 'vue';

// Subscribe to anchors/metadata only, not the UI's 100ms display updates.
// Keep a concrete shared deadline so settings/lifecycle replans can't shift it.
export function alarmSnapshot(timers, now = Date.now()) {
  return timers.map(timer => ({
    id: timer.id, name: timer.name, type: timer.type, status: timer.status,
    dataMode: timer.dataMode, targetMinutes: timer.targetMinutes, isPay: timer.isPay,
    reachedTarget: timer.reachedTarget, startTime: timer.startTime,
    accumulatedTime: timer.accumulatedTime,
    alarmAt: timer.dataMode === 'shared'
      ? now + timer.targetMinutes * 60000 - Number(toRaw(timer).elapsed || 0) : undefined,
  }));
}
