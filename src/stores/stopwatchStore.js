import { defineStore } from "pinia";
import { onScopeDispose } from "vue";
import { createStopwatchController } from "./stopwatchController.js";
import * as backend from "../services/backendSync.js";
import * as socket from "../services/socket.js";
import { createPersonalSyncApi } from "../sync/personalSyncApi.js";
import { createPersonalSyncEngine } from "../sync/personalSyncEngine.js";
import { message } from "../composables/message.js";
import { notifyTimerEnd, cancelTimerSound } from "../utils/notifications.js";
import { hapticTap } from "../utils/haptics.js";

export const useStopwatchStore = defineStore("stopwatch", () => {
  const personalApi = createPersonalSyncApi();
  const store = createStopwatchController({ backend, socket, personalApi,
    engine: createPersonalSyncEngine({ api: personalApi }), message,
    notify: notifyTimerEnd, cancelSound: cancelTimerSound, haptic: hapticTap });
  onScopeDispose(store.dispose);
  return store;
});
