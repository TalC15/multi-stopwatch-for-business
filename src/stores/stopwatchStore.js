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
  dbGetSharedTimers,
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
  const name = ref(JSON.parse(localStorage.getItem("defaultName")) || "kronometre");

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
      // Mutlak bitiş zamanı — her cihaz kendi saatine göre buradan geriye
      // doğru hesap yapar, cihaza özel Date.now() değerini asla birbirine göndermeyiz.
      let endsAt = null;
      if (timer.targetMinutes) {
        const remaining =
          timer.targetMinutes * 60 * 1000 - timer.accumulatedTime;
        endsAt = new Date(Date.now() + remaining).toISOString();
      }

      syncTimerStart(timer);
      dbUpdateTimer(timer.id, {
        status: "running",
        ends_at: endsAt,
        accumulated_ms: timer.accumulatedTime,
      });

      if (timer.isShared) {
        // Diğer cihazlara SADECE senkronize edilecek bilgiyi gönder.
        // startTime/accumulatedTime bu cihaza özeldir, gönderilmez.
        emitTimerEvent("updated", {
          id: timer.id,
          status: timer.status,
          endsAt,
          accumulatedTimeAtStart: timer.accumulatedTime,
        });
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
          accumulated_ms: timer.accumulatedTime,
        });

        if (timer.isShared) {
          emitTimerEvent("updated", {
            id: timer.id,
            status: timer.status,
            endsAt: null,
            accumulatedTimeAtStart: timer.accumulatedTime,
          });
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
        emitTimerEvent("updated", { id: timer.id, isPay });
      }
    }
  };
  // Diğer kullanıcılardan gelen ortak timer olaylarını dinle
    // Diğer kullanıcılardan gelen ortak timer olaylarını dinle
  onTimerEvent(({ event, data }) => {
    console.log("[Socket] Event alındı:", event, "id:", data?.id, "zaman:", new Date().toISOString());
    if (event === "created") {
      // Zaten varsa ekleme
      if (!stopwatches.value.find((t) => t.id === data.id)) {
        stopwatches.value.push(data);
      }
    } else if (event === "updated") {
      const timer = stopwatches.value.find((t) => t.id === data.id);
      if (!timer) return;

      // KRİTİK: startTime / accumulatedTime cihaza özeldir, ASLA başka
      // bir cihazdan gelen değerle ezilmez. Sadece "veri" alanları kopyalanır;
      // zaman ise mutlak endsAt'ten bu cihazın kendi saatine göre yeniden kurulur.
      if (data.status !== undefined) timer.status = data.status;
      if (data.isPay !== undefined) timer.isPay = data.isPay;
      if (data.reachedTarget !== undefined)
        timer.reachedTarget = data.reachedTarget;

      if (data.status === "running" && data.endsAt) {
        // Diğer cihaz timer'ı başlattı → bu cihaz kendi startTime'ını,
        // gönderilen mutlak bitiş zamanından geriye doğru hesaplar.
        const totalMs = (timer.targetMinutes || 0) * 60 * 1000;
        const endsAtMs = new Date(data.endsAt).getTime();
        const remaining = endsAtMs - Date.now();
        timer.accumulatedTime = totalMs - remaining;
        timer.startTime = Date.now();
        startTick();
      } else if (data.status === "running") {
        // Hedefsiz (targetMinutes yok) count-up — mutlak endsAt hesaplanamaz,
        // bu cihaz kendi accumulatedTime'ından devam eder.
        if (data.accumulatedTimeAtStart !== undefined) {
          timer.accumulatedTime = data.accumulatedTimeAtStart;
        }
        timer.startTime = Date.now();
        startTick();
      } else if (data.status === "paused") {
        // Diğer cihaz durdurdu → bu cihazda da yerel start/accumulated durur.
        if (
          data.accumulatedTimeAtStart !== undefined &&
          timer.status === "paused"
        ) {
          timer.accumulatedTime = data.accumulatedTimeAtStart;
        } else if (timer.startTime) {
          timer.accumulatedTime += Date.now() - timer.startTime;
        }
        timer.startTime = null;
      }
    } else if (event === "deleted") {
      stopwatches.value = stopwatches.value.filter((t) => t.id !== data.id);
    }
  });

  // ─── DB'den ortak timer'ları yükle (sayfa açılışında) ────────────────────
  const loadSharedTimers = async () => {
    if (!isLoggedIn()) return;
    const dbTimers = await dbGetSharedTimers();
    if (!dbTimers || dbTimers.length === 0) return;

    const now = Date.now();

    dbTimers.forEach((dbTimer) => {
      // Zaten local'de varsa dokunma — canlı/güncel veri DB'den daha değerli
      if (stopwatches.value.find((t) => t.id === dbTimer.id)) return;

      const targetMinutes = dbTimer.target_minutes
        ? Number(dbTimer.target_minutes)
        : null;
      const accumulatedMs = dbTimer.accumulated_ms || 0;

      const timer = {
        id: dbTimer.id,
        name: dbTimer.name,
        targetMinutes,
        type: dbTimer.type,
        isPay: dbTimer.is_pay || false,
        isShared: true,
        status: dbTimer.status === "running" ? "paused" : dbTimer.status,
        startTime: null,
        accumulatedTime: accumulatedMs,
        elapsed: accumulatedMs,
        remaining:
          dbTimer.type === "down" && targetMinutes
            ? Math.max(targetMinutes * 60 * 1000 - accumulatedMs, 0)
            : null,
        reachedTarget: false,
      };

      // running olarak DB'de kayıtlıysa, ends_at üzerinden bu cihazın
      // kendi saatine göre yeniden hesapla ve gerçekten çalıştır.
      if (dbTimer.status === "running" && dbTimer.ends_at) {
        const endsAtMs = new Date(dbTimer.ends_at).getTime();
        const remaining = endsAtMs - now;
        if (remaining > 0 || dbTimer.type === "up") {
          timer.status = "running";
          timer.startTime = now;
          if (targetMinutes) {
            timer.accumulatedTime = targetMinutes * 60 * 1000 - remaining;
          }
        } else {
          timer.status = "expired";
        }
      }

      stopwatches.value.push(timer);
    });

    if (stopwatches.value.some((t) => t.status === "running")) {
      startTick();
    }
  };

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
    loadSharedTimers,
  };
});
