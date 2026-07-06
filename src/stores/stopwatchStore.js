import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { message } from "../composables/message";
import { notifyTimerEnd, cancelTimerSound } from "../utils/notifications";
import { hapticTap } from "../utils/haptics";
import {
  syncTimerStart,
  syncTimerCancel,
  isLoggedIn,
  dbCreateTimer,
  dbUpdateTimer,
  dbDeleteTimer,
} from "../services/backendSync";
import { emitTimerEvent, onTimerEvent } from "../services/socket";

export const useStopwatchStore = defineStore("stopwatch", () => {
  const stopwatches = ref(JSON.parse(localStorage.getItem("timers")) || []);
  const presetTimes = ref(
    JSON.parse(localStorage.getItem("presetTimes")) || [],
  );
  const presetNames = ref(
    JSON.parse(localStorage.getItem("presetNames")) || [],
  );
  const duration = ref(
    JSON.parse(localStorage.getItem("defaultDuration")) || 0,
  );
  const name = ref(JSON.parse(localStorage.getItem("defaultName")) || "");

  watch(
    stopwatches,
    (val) => {
      localStorage.setItem("timers", JSON.stringify(val));
    },
    { deep: true },
  );

  // ─── Tick ────────────────────────────────────────────────────────────────
  let tickInterval = null;

  const startTick = () => {
    if (tickInterval) return;
    tickInterval = setInterval(() => {
      const now = Date.now();
      stopwatches.value.forEach((timer) => {
        if (timer.status !== "running") return;
        const elapsed = timer.accumulatedTime + (now - timer.startTime);

        if (timer.type === "up") {
          timer.elapsed = elapsed;
          if (
            timer.targetMinutes &&
            elapsed >= timer.targetMinutes * 60 * 1000 &&
            !timer.reachedTarget
          ) {
            timer.reachedTarget = true;
            notifyTimerEnd(timer.id, timer.name, timer.isPay);
            // DB güncelle — timer tamamlandı
            if (isLoggedIn())
              dbUpdateTimer(timer.id, {
                status: "completed",
                ended_at: new Date().toISOString(),
                duration_ms: elapsed,
              });
          }
        } else {
          const total = timer.targetMinutes * 60 * 1000;
          const remaining = total - elapsed;
          if (remaining <= 0) {
            timer.remaining = 0;
            timer.elapsed = total;
            timer.status = "expired";
            timer.startTime = null;
            timer.accumulatedTime = total;
            timer.reachedTarget = true;
            notifyTimerEnd(timer.id, timer.name, timer.isPay);
            // DB güncelle — timer tamamlandı
            if (isLoggedIn())
              dbUpdateTimer(timer.id, {
                status: "completed",
                ended_at: new Date().toISOString(),
                duration_ms: total,
              });
          } else {
            timer.remaining = remaining;
            timer.elapsed = elapsed;
          }
        }
      });

      const anyRunning = stopwatches.value.some((t) => t.status === "running");
      if (!anyRunning) {
        clearInterval(tickInterval);
        tickInterval = null;
      }
    }, 100);
  };

  const stopTick = () => {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  };

  // ─── Actions ──────────────────────────────────────────────────────────────

  const addTimer = async (timer) => {
    console.log('[DEBUG] addTimer çağrıldı:', JSON.stringify(timer));
    const targetMs = timer.duration * 60 * 1000;
    const newTimer = {
      id: crypto.randomUUID(),
      name: timer.name,
      targetMinutes: timer.duration,
      type: timer.type,
      isPay: false,
      isShared: timer.isShared || false,
      status: "idle",
      startTime: null,
      accumulatedTime: 0,
      elapsed: 0,
      remaining: timer.type === "down" ? targetMs : null,
      reachedTarget: false,
    };
    console.log('[DEBUG] newTimer (frozen):', JSON.stringify(newTimer));
    stopwatches.value.push(newTimer);

    // DB'ye kaydet
    if (isLoggedIn()) {
      await dbCreateTimer(newTimer);
      if (newTimer.isShared) {
        console.log('[DEBUG] emitTimerEvent çağrılıyor');
        emitTimerEvent("created", newTimer);
      } else {
        console.log('[DEBUG] isShared false, emit yapılmadı - newTimer.isShared:', newTimer.isShared);
      }
    }

    return newTimer.id;
  };

  const startTimer = (id) => {
    const timer = stopwatches.value.find((t) => t.id === id);
    if (!timer) return;
    if (timer.type === "down" && timer.status === "expired") return;
    timer.startTime = Date.now();
    timer.status = "running";
    startTick();

    if (isLoggedIn()) {
      let endsAt = null;
      if (timer.type === "down") {
        const remaining =
          timer.targetMinutes * 60 * 1000 - timer.accumulatedTime;
        endsAt = new Date(Date.now() + remaining).toISOString();
      }

      syncTimerStart(timer);
      dbUpdateTimer(timer.id, {
        status: "running",
        ends_at: endsAt,
      });

      if (timer.isShared) {
        emitTimerEvent("updated", timer);
      }
    }
  };

  const pauseTimer = (id, pausedCount) => {
    const timer = stopwatches.value.find((t) => t.id === id);
    if (timer && timer.status === "running") {
      timer.accumulatedTime += Date.now() - timer.startTime;
      timer.startTime = null;
      timer.status = "paused";
      pausedCount++;
      localStorage.setItem(`pausedCount${id}`, JSON.stringify(pausedCount));
      cancelTimerSound(id);

      if (isLoggedIn()) {
        syncTimerCancel(id);
        dbUpdateTimer(timer.id, {
          status: "paused",
          paused_count: pausedCount,
        });

        if (timer.isShared) {
          emitTimerEvent("updated", timer);
        }
      }
    }
  };

  const deleteTimer = (timer, deger) => {
    cancelTimerSound(timer.id);

    if (isLoggedIn()) {
      syncTimerCancel(timer.id);
      dbDeleteTimer(timer.id);

      if (timer.isShared) {
        emitTimerEvent("deleted", { id: timer.id });
      }
    }

    stopwatches.value = stopwatches.value.filter((t) => t.id !== timer.id);
    localStorage.removeItem(`isPay${timer.id}`);
    localStorage.removeItem(`pausedCount${timer.id}`);
    hapticTap();
    message.success(`${timer.name} ${deger} silindi`);
  };

  const updateIsPay = (id, isPay) => {
    const timer = stopwatches.value.find((t) => t.id === id);
    if (!timer) return;
    timer.isPay = isPay;
    if (isLoggedIn()) {
      dbUpdateTimer(id, { is_pay: isPay });
      if (timer.isShared) {
        emitTimerEvent("updated", timer);
      }
    }
  };
  // Diğer kullanıcılardan gelen ortak timer olaylarını dinle
  onTimerEvent(({ event, data }) => {
    if (event === "created") {
      // Zaten varsa ekleme
      if (!stopwatches.value.find((t) => t.id === data.id)) {
        stopwatches.value.push(data);
      }
    } else if (event === "updated") {
      const timer = stopwatches.value.find((t) => t.id === data.id);
      if (timer) Object.assign(timer, data);
    } else if (event === "deleted") {
      stopwatches.value = stopwatches.value.filter((t) => t.id !== data.id);
    }
  });

  // ─── Rehydrate ────────────────────────────────────────────────────────────
  const rehydrateTimers = () => {
    const now = Date.now();
    stopwatches.value.forEach((timer) => {
      if (timer.status === "running" && timer.startTime) {
        const missedTime = now - timer.startTime;
        timer.accumulatedTime += missedTime;
        timer.startTime = null;

        if (timer.type === "up") {
          timer.elapsed = timer.accumulatedTime;
          if (
            timer.targetMinutes &&
            timer.elapsed >= timer.targetMinutes * 60 * 1000
          ) {
            timer.reachedTarget = true;
          }
          timer.status = "paused";
        } else {
          const total = timer.targetMinutes * 60 * 1000;
          const remaining = total - timer.accumulatedTime;
          if (remaining <= 0) {
            timer.remaining = 0;
            timer.elapsed = total;
            timer.status = "expired";
          } else {
            timer.remaining = remaining;
            timer.elapsed = timer.accumulatedTime;
            timer.status = "paused";
          }
        }
      }
    });
  };

  rehydrateTimers();

  return {
    stopwatches,
    presetTimes,
    presetNames,
    duration,
    name,
    addTimer,
    startTimer,
    pauseTimer,
    deleteTimer,
    updateIsPay,
    startTick,
    stopTick,
  };
});
