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
import { onTimerEvent, onSocketConnected } from "../services/socket";

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
  const name = ref(
    JSON.parse(localStorage.getItem("defaultName")) || "kronometre",
  );

  const roleStyles = {
    worker: {
      text: "text-teal-400",
    },

    manager: {
      text: "text-indigo-400",
    },

    superadmin: {
      text: "text-amber-400",
    },
  };

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
    console.log("[DEBUG] addTimer çağrıldı:", JSON.stringify(timer));
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
      pausedCount: 0,
    };
    console.log("[DEBUG] newTimer (frozen):", JSON.stringify(newTimer));
    stopwatches.value.push(newTimer);

    // DB'ye kaydet
    if (isLoggedIn()) {
      await dbCreateTimer(newTimer);
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
    }
  };

  const pauseTimer = (id) => {
    const timer = stopwatches.value.find((t) => t.id === id);

    if (timer && timer.status === "running") {
      timer.accumulatedTime += Date.now() - timer.startTime;
      timer.startTime = null;
      timer.status = "paused";

      // Önce local state anında güncellenir.
      timer.pausedCount = Number(timer.pausedCount || 0) + 1;

      cancelTimerSound(id);

      if (isLoggedIn()) {
        syncTimerCancel(id);

        const updates = {
          status: "paused",
          accumulated_ms: timer.accumulatedTime,
        };

        // Personal timer'ın pause sayısı kendi local state'inden gelir.
        // Shared timer'da ise sayıyı backend hesaplar.
        if (!timer.isShared) {
          updates.paused_count = timer.pausedCount;
        }

        dbUpdateTimer(timer.id, updates);
      }
    }
  };

  const deleteTimer = (timer, deger) => {
    cancelTimerSound(timer.id);

    if (isLoggedIn()) {
      syncTimerCancel(timer.id);
      dbDeleteTimer(timer.id);
    }

    stopwatches.value = stopwatches.value.filter((t) => t.id !== timer.id);
    localStorage.removeItem(`isPay${timer.id}`);
    hapticTap();
    message.success(`${timer.name} ${deger} silindi`);
  };

  const updateIsPay = (id, isPay) => {
    const timer = stopwatches.value.find((t) => t.id === id);
    if (!timer) return;
    timer.isPay = isPay;
    if (isLoggedIn()) {
      dbUpdateTimer(id, { is_pay: isPay });
    }
  };
  // Diğer kullanıcılardan gelen ortak timer olaylarını dinle
  // Diğer kullanıcılardan gelen ortak timer olaylarını dinle
  onTimerEvent(({ event, data }) => {
    console.log(
      "[Socket] Event alındı:",
      event,
      "id:",
      data?.id,
      "zaman:",
      new Date().toISOString(),
    );
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
      if (data.pausedCount !== undefined)
        timer.pausedCount = Number(data.pausedCount);
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
  let sharedTimersLoadPromise = null;
  let hasSuccessfulSharedSnapshot = false;
  let sharedReconcileTimer = null;
  const loadSharedTimers = async () => {
    if (!isLoggedIn()) return false;

    // Aynı anda ikinci shared timer isteğini başlatma.
    // Devam eden isteğin sonucunu paylaş.
    if (sharedTimersLoadPromise) {
      return sharedTimersLoadPromise;
    }

    const request = (async () => {
      try {
        const dbTimers = await dbGetSharedTimers();

        // null → istek başarısız.
        // Local shared state'e dokunma.
        if (dbTimers === null) {
          return false;
        }

        const now = Date.now();
        const dbIds = new Set(dbTimers.map((t) => t.id));

        // Server'da artık bulunmayan shared timer'ları temizle.
        stopwatches.value = stopwatches.value.filter(
          (t) => !t.isShared || dbIds.has(t.id),
        );

        dbTimers.forEach((dbTimer) => {
          const targetMinutes = dbTimer.target_minutes
            ? Number(dbTimer.target_minutes)
            : null;

          const accumulatedMs = Number(dbTimer.accumulated_ms || 0);

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

            pausedCount: Number(dbTimer.paused_count || 0),
          };

          // Running timer'ı server'ın mutlak ends_at değerinden yeniden kur.
          if (dbTimer.status === "running" && dbTimer.ends_at) {
            const endsAtMs = new Date(dbTimer.ends_at).getTime();
            const remaining = endsAtMs - now;

            if (remaining > 0 || dbTimer.type === "up") {
              timer.status = "running";
              timer.startTime = now;

              if (targetMinutes) {
                timer.accumulatedTime = targetMinutes * 60 * 1000 - remaining;

                timer.elapsed = timer.accumulatedTime;

                if (timer.type === "down") {
                  timer.remaining = Math.max(remaining, 0);
                }
              }
            } else {
              timer.status = "expired";
              timer.remaining = 0;
            }
          }

          // Reconciliation sırasında server/DB shared timer için otoritedir.
          const existingIndex = stopwatches.value.findIndex(
            (t) => t.id === dbTimer.id,
          );

          if (existingIndex === -1) {
            stopwatches.value.push(timer);
          } else {
            stopwatches.value[existingIndex] = timer;
          }
        });

        if (stopwatches.value.some((t) => t.status === "running")) {
          startTick();
        }

        hasSuccessfulSharedSnapshot = true;

        return true;
      } catch (err) {
        console.error("[Sync] Shared timer yükleme hatası:", err);

        return false;
      }
    })();

    sharedTimersLoadPromise = request;

    try {
      return await request;
    } finally {
      // Bu request hâlâ aktif request ise temizle.
      if (sharedTimersLoadPromise === request) {
        sharedTimersLoadPromise = null;
      }
    }
  };
  const scheduleSharedTimersReconciliation = ({
    force = false,
    delay = 300,
  } = {}) => {
    // Ağ hızlı hızlı gidip geliyorsa önceki planı iptal et.
    if (sharedReconcileTimer) {
      clearTimeout(sharedReconcileTimer);
    }

    sharedReconcileTimer = setTimeout(async () => {
      sharedReconcileTimer = null;

      // İlk socket bağlantısıysa ve HomeView zaten başarılı şekilde
      // snapshot yüklediyse ikinci kez GET atmaya gerek yok.
      if (!force && hasSuccessfulSharedSnapshot) {
        console.log(
          "[Sync] Shared snapshot zaten güncel, ilk socket fetch atlandı.",
        );
        return;
      }

      console.log(
        force
          ? "[Sync] Socket yeniden bağlandı, reconciliation başlıyor..."
          : "[Sync] İlk shared snapshot eksik, reconciliation başlıyor...",
      );

      const success = await loadSharedTimers();

      if (success) {
        console.log("[Sync] Shared timer reconciliation tamamlandı.");
      } else {
        console.warn("[Sync] Shared timer reconciliation tamamlanamadı.");
      }
    }, delay);
  };
  onSocketConnected(({ isReconnect }) => {
  if (isReconnect) {
    // Gerçek reconnect veya manuel socket yeniden oluşturma:
    // DB kesinlikle tekrar okunmalı.
    scheduleSharedTimersReconciliation({
      force: true,
    });

    return;
  }

  // İlk socket bağlantısı.
  // HomeView henüz başarılı snapshot alamadıysa tamamla.
  if (!hasSuccessfulSharedSnapshot) {
    scheduleSharedTimersReconciliation({
      force: false,
    });
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
    roleStyles,
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
