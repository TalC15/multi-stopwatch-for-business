import { defineStore } from "pinia";
import { onScopeDispose, watch } from "vue";
import { createStopwatchController } from "./stopwatchController.js";
import * as backend from "../services/backendSync.js";
import * as socket from "../services/socket.js";
import { createPersonalSyncApi } from "../sync/personalSyncApi.js";
import { createPersonalSyncEngine } from "../sync/personalSyncEngine.js";
import { message } from "../composables/message.js";
import { notifyTimerEnd, cancelTimerSound, syncNativeTimerNotifications, stopAllAlarmSounds, updateQueuedAlarm } from "../utils/notifications.js";
import { alarmSnapshot } from "../utils/alarms/snapshot.js";
import { hapticTap } from "../utils/haptics.js";
import { accountExperience } from "../services/accountExperience.js";

export const useStopwatchStore = defineStore("stopwatch", () => {
  const personalApi = createPersonalSyncApi({ experience: accountExperience });
  const store = createStopwatchController({ backend, socket, personalApi,
    engine: createPersonalSyncEngine({ api: personalApi }), message,
    notify: notifyTimerEnd, cancelSound: cancelTimerSound, haptic: hapticTap, experience: accountExperience });
  // Observe durable anchors plus server-derived elapsed time, never mutate timer state here.
  const stopAlarmWatch = watch(() => ({ ready: store.ready.value, timers: alarmSnapshot(store.stopwatches.value) }), ({ ready, timers }, previous) => {
    if (!ready) {
      // A scope switch must replace any in-flight stale plan, but cold boot must
      // not clear native alarms before IndexedDB has supplied the first snapshot.
      if (previous?.ready) void syncNativeTimerNotifications(timers);
      return;
    }
    const current = new Map(timers.map(timer => [timer.id, timer]));
    for (const old of previous?.timers ?? []) {
      const next = current.get(old.id);
      if (next && (next.name !== old.name || next.isPay !== old.isPay)) updateQueuedAlarm(next);
      if (!next || (next.status === 'paused' && old.status !== 'paused' && !(next.reachedTarget && !old.reachedTarget))) cancelTimerSound(old.id);
    }
    void syncNativeTimerNotifications(timers);
  }, { immediate: true });
  onScopeDispose(() => { stopAlarmWatch(); stopAllAlarmSounds(); store.dispose(); });
  return store;
});
