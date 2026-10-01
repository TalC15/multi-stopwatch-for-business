import {
  createSharedApi,
  validateSharedEnvelope,
} from "../services/sharedApi.js";
import { ref, shallowRef, computed, watch } from "vue";
import { liveQuery } from "dexie";
import { timerDb } from "../data/timerDb.js";
import * as repository from "../data/timerRepository.js";
import {
  getNewTimerContext,
  getTimerDataMode,
  TIMER_DATA_MODE as MODE,
} from "../domain/timerDataMode.js";
import {
  enqueuePersonalPut,
  enqueuePersonalDelete,
  listPersonalOutbox,
} from "../sync/personalOutbox.js";
import { personalStateFromLocal } from "../sync/personalSyncModel.js";
import {
  displayTimer,
  elapsedAt,
  thresholdState,
  sharedFromServer,
  sharedTargetReached,
} from "./timerClock.js";

// The Pinia wrapper supplies platform effects; tests exercise this same controller with mock IO.
export function createStopwatchController({
  backend,
  socket,
  engine,
  personalApi,
  notify,
  cancelSound,
  haptic,
  message,
  storage = globalThis.localStorage,
  events = globalThis.window,
  document = globalThis.document,
  now = Date.now,
  sharedApi,
  online = () => globalThis.navigator?.onLine !== false,
  monotonicNow = () => globalThis.performance?.now() ?? now(),
  setInterval: every = globalThis.setInterval,
  clearInterval: stopEvery = globalThis.clearInterval,
  setTimeout: later = globalThis.setTimeout,
  clearTimeout: cancelLater = globalThis.clearTimeout,
}) {
  sharedApi ??= createSharedApi({ backend, online });
  const preference = (key, fallback) => {
    try {
      return JSON.parse(storage?.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const stopwatches = ref([]),
    ready = ref(false),
    user = ref(null),
    syncStatus = ref("idle"),
    pendingCount = ref(0);
  const syncIssues = ref([]),
    syncReview = shallowRef(null),
    resolvingSync = ref(false);
  let retryTimer = null,
    retryBudget = 3;
  function cancelRetry() {
    if (retryTimer !== null) cancelLater(retryTimer);
    retryTimer = null;
  }
  function scheduleRetry(queue, ctx, status) {
    cancelRetry();
    if (
      !current(ctx) ||
      !online() ||
      document?.visibilityState === "hidden" ||
      retryBudget <= 0 ||
      [
        "auth-required",
        "forbidden",
        "unsupported-locks",
        "session-changed",
        "backend-update-required",
      ].includes(status)
    )
      return;
    const heads = [
      ...new Map([...queue].reverse().map((op) => [op.timerId, op])).values(),
    ];
    const retryable = heads.filter(
      (op) =>
        ["pending", "retry", "sending"].includes(op.status) ||
        (op.status === "conflict" &&
          op.reconcileAt > now() &&
          queue.filter((row) => row.timerId === op.timerId).at(-1)?.method ===
            "DELETE"),
    );
    if (!retryable.length && status !== "retry" && status !== "busy") return;
    const wait = Math.max(
      1000,
      Math.min(
        ...retryable.map((op) =>
          Math.max(
            0,
            ((op.status === "conflict" ? op.reconcileAt : op.retryAt) || 0) -
              now(),
          ),
        ),
        300000,
      ),
    );
    retryTimer = later(
      () => {
        retryTimer = null;
        if (
          !current(ctx) ||
          !online() ||
          document?.visibilityState === "hidden"
        )
          return;
        retryBudget--;
        void requestSync();
      },
      retryable.length ? wait : 5000,
    );
    retryTimer?.unref?.();
  }
  async function refreshSyncState(ctx, status) {
    const queue = await listPersonalOutbox(ctx.scope);
    const issues = [];
    for (const op of queue) {
      if (
        issues.some((issue) => issue.timerId === op.timerId) ||
        !["conflict", "error", "forbidden", "auth-required"].includes(op.status)
      )
        continue;
      const local =
        typeof op.timerId === "string"
          ? await timerDb.timers.get(op.timerId)
          : null;
      const owned =
        local?.dataMode === MODE.WORKSPACE_PERSONAL &&
        local.userId === ctx.scope.userId &&
        local.workspaceId === ctx.scope.workspaceId;
      issues.push({
        timerId: op.timerId,
        seq: op.seq,
        name: owned
          ? local.name || "Silinen sayaç"
          : "Yerel karşılığı bulunamayan işlem",
        method: op.method === "DELETE" ? "Silme" : "Kaydetme",
        status: op.status,
        httpStatus: op.error?.httpStatus || 0,
        reason:
          op.status === "forbidden"
            ? "Bu işlem için yetki doğrulanamadı."
            : op.status === "auth-required"
              ? "Oturumunuzu yeniden doğrulayın."
              : op.status === "error"
                ? "Yerel işlem geçersiz veya sunucu tarafından reddedildi."
                : "Sunucu ile cihazdaki değişiklikler çakışıyor.",
        canReview: owned && op.status !== "auth-required",
      });
    }
    assertCurrent(ctx);
    pendingCount.value = queue.length;
    syncIssues.value = issues;
    syncStatus.value = issues.length
      ? "conflict"
      : queue.some((op) => op.status === "retry")
        ? "retry"
        : status;
    scheduleRetry(queue, ctx, status);
  }
  async function reviewSyncIssue(id) {
    const ctx = capture();
    if (resolvingSync.value) return false;
    resolvingSync.value = true;
    syncReview.value = null;
    try {
      const review = await engine.review(id);
      assertCurrent(ctx);
      if (review.status !== "review") {
        message.warning(
          "Güncel ve yetkili sunucu kaydı doğrulanamadı. Değişiklikler korundu; bağlantınızı ve hesabınızı kontrol edin. Sorun sürerse salt okunur tanı raporunu paylaşın.",
        );
        return false;
      }
      syncReview.value = review;
      return true;
    } catch {
      if (current(ctx))
        message.warning(
          "Sunucu kaydı incelenemedi. Yerel değişiklikler korundu.",
        );
      return false;
    } finally {
      if (current(ctx)) resolvingSync.value = false;
    }
  }
  async function acceptSyncServer() {
    const ctx = capture(),
      review = syncReview.value;
    if (!review || resolvingSync.value) return false;
    resolvingSync.value = true;
    try {
      const result = await engine.acceptServer(review);
      assertCurrent(ctx);
      if (result.status !== "resolved") throw Error();
      syncReview.value = null;
      await reloadLocal(ctx);
      await refreshSyncState(ctx, "done");
      void requestSync();
      return true;
    } catch {
      if (current(ctx)) {
        syncReview.value = null;
        message.warning(
          "Kayıt veya oturum değişmiş olabilir. İşlem uygulanmadı; yeniden inceleyin.",
        );
      }
      return false;
    } finally {
      if (current(ctx)) resolvingSync.value = false;
    }
  }
  function retrySync() {
    retryBudget = 3;
    cancelRetry();
    return requestSync();
  }
  const presetTimes = ref(preference("presetTimes", [])),
    presetNames = ref(preference("presetNames", []));
  const duration = ref(preference("defaultDuration", 5)),
    name = ref(preference("defaultName", "kronometre"));
  const roleStyles = {
    worker: { text: "text-blue-600 dark:text-blue-300" },
    manager: { text: "text-violet-600 dark:text-violet-300" },
    superadmin: { text: "text-amber-600 dark:text-amber-300" },
  };
  let epoch = 0,
    disposed = false,
    suspended = false,
    active = null,
    subscription = null;
  let initPromise = null,
    syncPromise = null,
    syncRequested = false,
    sharedPromise = null,
    sharedRequested = false,
    tickInterval = null;
  const transitions = new Set(),
    failedTransitions = new Set(),
    actions = new Map(),
    notified = new Map();
  const sharedDeleted = new Set();
  let sharedEventRevision = 0;
  const sharedState = ref("reconciling"),
    sharedPending = ref(false),
    sharedLastVerified = ref(null);
  // Presentation only: missing initial user/workspace metadata is not a logout
  // or a confirmed lack of membership. Keep the existing sync state/guards intact.
  const sharedAccess = ref("loading");
  const sharedNotice = computed(() => {
    if (sharedAccess.value === "signed-out")
      return {
        state: "signed-out",
        tone: "info",
        message: "Ortak zamanlayıcıları kullanmak için giriş yapın.",
        to: "/login",
        action: "Giriş yap",
      };
    if (sharedAccess.value === "workspace-required")
      return {
        state: "workspace-required",
        tone: "info",
        message: "Ortak sayaçları kullanmak için bir çalışma gurubuna katılın.",
        to: "/profile",
        action: "çalışma gurubuna katıl",
      };
    if (!ready.value || sharedAccess.value === "loading")
      return {
        state: "loading",
        tone: "neutral",
        message: "Ortak bölüm hazırlanıyor…",
      };
    if (sharedState.value === "auth-required")
      return {
        state: "auth-required",
        tone: "error",
        message: "Ortak sayaçlar için oturumunuzu doğrulayın.",
        to: "/login",
        action: "Giriş yap",
      };
    if (sharedState.value === "offline-readonly")
      return {
        state: "offline-readonly",
        tone: "warning",
        message:
          "İnternet bağlantısı bekleniyor. Ortak sayaçlar çevrimdışıyken değiştirilemez.",
      };
    if (sharedState.value === "unavailable")
      return {
        state: "unavailable",
        tone: "warning",
        message:
          "Ortak sayaçlara şu anda ulaşılamıyor. Değişiklik yapmadan yeniden deneyin.",
        action: "Yeniden dene",
      };
    if (sharedPending.value)
      return {
        state: "pending",
        tone: "neutral",
        message: "Ortak zamanlayıcı işlemi tamamlanıyor…",
      };
    if (sharedState.value === "reconciling")
      return {
        state: "reconciling",
        tone: "neutral",
        message: "Ortak zamanlayıcılar güncelleniyor…",
      };
    return {
      state: "ready",
      tone: "info",
      message: "Ortak zamanlayıcılar ekip üyeleriyle güncel tutulur.",
    };
  });
  let sharedGeneration = -1n,
    sharedClock = null,
    lastWarning = -Infinity;
  // Only the identity of an uncertain create, never an offline operation queue.
  // It is reused solely on an explicit same-form retry in this session.
  let uncertainCreate = null;
  const sharedNow = () =>
    sharedClock
      ? sharedClock.server + monotonicNow() - sharedClock.local
      : now();
  const sharedWritable = computed(
    () => sharedState.value === "ready" && !sharedPending.value,
  );

  const loadingNoticeStates = new Set(["loading", "pending", "reconciling"]);

  let sharedLoadingMessageId = null;

  function closeSharedLoadingMessage() {
    if (sharedLoadingMessageId !== null) {
      message.dismiss(sharedLoadingMessageId);
      sharedLoadingMessageId = null;
    }
  }

  const stopSharedLoadingMessage = watch(
    () => loadingNoticeStates.has(sharedNotice.value.state),
    (isLoading) => {
      if (!isLoading) {
        closeSharedLoadingMessage();
      }
    },
    { flush: "sync" },
  );

  function requireSharedWrite() {
    if (!online()) {
      sharedState.value = "offline-readonly";
    }

    if (sharedWritable.value) {
      return true;
    }

    if (now() - lastWarning >= 2000) {
      lastWarning = now();

      const notice = sharedNotice.value;

      if (loadingNoticeStates.has(notice.state)) {
        if (sharedLoadingMessageId === null) {
          sharedLoadingMessageId = message.loading(notice.message);
        }
      } else {
        message.warning(notice.message);
      }
    }

    return false;
  }
  const removers = [];

  function context() {
    let current = null,
      sessionCurrent = null;
    try {
      sessionCurrent = !suspended && backend.isTabSessionCurrent();
      current = sessionCurrent ? backend.getUser() : null;
    } catch {
      /* invalid stored auth */
    }
    const disabled = Boolean(current?.disabled_at);
    if (disabled) current = null;
    return {
      user: current,
      scope: current?.workspace_id
        ? { userId: current.id, workspaceId: current.workspace_id }
        : null,
      sharedAccess:
        sessionCurrent === false || disabled
          ? "signed-out"
          : !current
            ? "loading"
            : current.workspace_id === null
              ? "workspace-required"
              : typeof current.workspace_id === "string" &&
                  current.workspace_id.trim()
                ? "available"
                : "loading",
      key: JSON.stringify([
        backend.getAuthGeneration(),
        backend.getTabSessionIdentity(),
        backend.getRefreshToken(),
        current?.id,
        current?.workspace_id,
      ]),
    };
  }
  function capture() {
    return { ...context(), epoch };
  }
  function current(ctx) {
    return !disposed && ctx.epoch === epoch && context().key === ctx.key;
  }
  function assertCurrent(ctx) {
    if (!current(ctx))
      throw Object.assign(new Error("Oturum değişti; işlem uygulanmadı"), {
        code: "session-changed",
      });
  }
  function visible(timer, ctx) {
    return (
      timer.dataMode === MODE.STANDALONE ||
      (ctx.scope &&
        timer.workspaceId === ctx.scope.workspaceId &&
        (timer.dataMode === MODE.SHARED || timer.userId === ctx.scope.userId))
    );
  }
  async function readVisible(ctx) {
    const local = await repository.listStandaloneTimers();
    const personal = ctx.scope
      ? await repository.listWorkspacePersonalTimers(ctx.scope)
      : [];
    const shared = ctx.scope
      ? await repository.listSharedTimerCache(ctx.scope)
      : [];
    return [...local, ...personal, ...shared];
  }
  function applyRows(rows, ctx) {
    if (!current(ctx)) return;
    if (!sharedClock) {
      const cachedClock = rows.find(
        (t) =>
          t.dataMode === MODE.SHARED &&
          visible(t, ctx) &&
          Number.isFinite(t.sharedClockOffset),
      );
      if (cachedClock)
        sharedClock = {
          server: now() + cachedClock.sharedClockOffset,
          local: monotonicNow(),
        };
    }
    // Shared realtime display is reconciled through its existing GET/socket flow.
    const existingShared = stopwatches.value.filter(
      (t) => t.dataMode === MODE.SHARED && visible(t, ctx),
    );
    const sharedIds = new Set(existingShared.map((t) => t.id));
    stopwatches.value = [
      ...rows.filter((t) => t.dataMode !== MODE.SHARED || !sharedIds.has(t.id)),
      ...existingShared,
    ]
      .filter(
        (t) =>
          visible(t, ctx) &&
          (t.dataMode !== MODE.SHARED || !sharedDeleted.has(t.id)),
      )
      .map((t) =>
        displayTimer(t, t.dataMode === MODE.SHARED ? sharedNow() : now()),
      );
    ready.value = true;
    startTick();
    checkSharedAlarms(ctx);
  }
  async function reloadLocal(ctx = active) {
    if (!ctx) return;
    const rows = await readVisible(ctx);
    assertCurrent(ctx);
    applyRows(rows, ctx);
  }
  function clearView() {
    closeSharedLoadingMessage();
    sharedAccess.value = "loading";
    cancelRetry();
    retryBudget = 3;
    syncIssues.value = [];
    syncReview.value = null;
    resolvingSync.value = false;
    syncStatus.value = "idle";
    epoch++;
    subscription?.unsubscribe();
    subscription = null;
    for (const timer of stopwatches.value)
      if (timer.dataMode !== MODE.STANDALONE) cancelSound(timer.id);
    stopwatches.value = stopwatches.value.filter(
      (t) => t.dataMode === MODE.STANDALONE,
    );
    ready.value = false;
    pendingCount.value = 0;
    user.value = null;
    sharedState.value = online() ? "reconciling" : "offline-readonly";
    sharedPending.value = false;
    sharedGeneration = -1n;
    sharedClock = null;
    uncertainCreate = null;
    sharedPromise = null;
    sharedRequested = false;
    sharedDeleted.clear();
    sharedEventRevision++;
    notified.clear();
    failedTransitions.clear();
  }
  async function initialize() {
    if (disposed) return false;
    const next = context();
    user.value = next.user;
    sharedAccess.value = next.sharedAccess;
    if (active?.key === next.key && initPromise) return initPromise;
    if (active?.key === next.key && ready.value) {
      void requestSync();
      return true;
    }
    clearView();
    const ctx = capture();
    active = ctx;
    user.value = ctx.user;
    sharedAccess.value = ctx.sharedAccess;
    const task = (async () => {
      try {
        await reloadLocal(ctx);
        assertCurrent(ctx);
        subscription = liveQuery(() => readVisible(ctx)).subscribe({
          next: (rows) => applyRows(rows, ctx),
          error: () => {
            if (current(ctx))
              message.error("Yerel sayaçlar okunamadı; veriler silinmedi");
          },
        });
        void loadSharedTimers();
        void requestSync();
        return true;
      } catch (error) {
        if (current(ctx))
          message.error("Yerel kayıtlar açılamadı. İşlem yapılmadı.");
        return false;
      }
    })();
    initPromise = task;
    try {
      return await task;
    } finally {
      if (initPromise === task) initPromise = null;
    }
  }
  function startTick() {
    if (!tickInterval && stopwatches.value.some((t) => t.status === "running"))
      tickInterval = every(() => {
        void tick();
      }, 100);
  }
  function stopTick() {
    if (tickInterval) stopEvery(tickInterval);
    tickInterval = null;
  }
  function publish(record, ctx) {
    assertCurrent(ctx);
    const item = displayTimer(record, now());
    const index = stopwatches.value.findIndex((t) => t.id === item.id);
    if (index < 0) stopwatches.value.push(item);
    else stopwatches.value[index] = item;
    startTick();
  }
  function serial(id, work) {
    const task = (actions.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(work);
    actions.set(id, task);
    task
      .finally(() => {
        if (actions.get(id) === task) actions.delete(id);
      })
      .catch(() => {});
    return task;
  }
  // This marker is device-local and durable. The transaction elects one tab to
  // deliver the alarm even if GET, Socket.IO and the deadline race each other.
  async function markSharedAlarm(id, ctx) {
    try {
      const alarm = await timerDb.transaction(
        "rw",
        timerDb.timers,
        async () => {
          assertCurrent(ctx);
          const cached = await timerDb.timers.get(id);
          assertCurrent(ctx);
          const displayed = stopwatches.value.find(
            (t) => t.id === id && t.dataMode === MODE.SHARED && visible(t, ctx),
          );
          if (
            !cached ||
            cached.dataMode !== MODE.SHARED ||
            cached.workspaceId !== ctx.scope?.workspaceId ||
            sharedDeleted.has(id) ||
            !displayed ||
            !sharedTargetReached(displayed, sharedNow())
          )
            return null;
          if (cached.sharedAlarmDelivered) return "recorded";
          await timerDb.timers.put({ ...cached, sharedAlarmDelivered: true });
          assertCurrent(ctx);
          return "claimed";
        },
      );
      if (alarm && current(ctx) && !sharedDeleted.has(id)) {
        const displayed = stopwatches.value.find(
          (t) => t.id === id && t.dataMode === MODE.SHARED && visible(t, ctx),
        );
        if (displayed) {
          displayed.sharedAlarmDelivered = true;
          displayed.reachedTarget = true;
          if (alarm === "claimed")
            Promise.resolve(notify(id, displayed.name, displayed.isPay, displayed.type)).catch(
              () => {},
            );
        }
      }
    } catch (error) {
      if (current(ctx))
        message.error("Ortak sayaç bildirimi yerel olarak kaydedilemedi");
    }
  }
  function checkSharedAlarms(ctx) {
    if (!current(ctx)) return;
    for (const timer of stopwatches.value) {
      if (
        timer.dataMode === MODE.SHARED &&
        !timer.sharedAlarmDelivered &&
        sharedTargetReached(timer, sharedNow())
      ) {
        void markSharedAlarm(timer.id, ctx);
      }
    }
  }
  async function localChange(id, ctx, transform, deleting = false) {
    return timerDb.transaction(
      "rw",
      timerDb.timers,
      timerDb.personalOutbox,
      async () => {
        assertCurrent(ctx);
        const old = await timerDb.timers.get(id);
        assertCurrent(ctx);
        if (!old || old.syncDeleted || !visible(old, ctx))
          throw new Error("Sayaç bu hesapta bulunamadı");
        const mode = getTimerDataMode(old);
        if (mode === MODE.SHARED)
          throw new Error("Shared sayaç yerel işlem yoluna giremez");
        if (deleting) {
          if (mode === MODE.STANDALONE)
            await repository.removeStandaloneTimer(id);
          else await enqueuePersonalDelete(id, ctx.scope);
          assertCurrent(ctx);
          return { record: old, previous: old };
        }
        const next = transform({ ...old });
        if (!next) return { record: old, previous: old };
        personalStateFromLocal(next); // Same canonical time rules for both local modes.
        const saved =
          mode === MODE.STANDALONE
            ? await repository.saveTimer(next)
            : (await enqueuePersonalPut(next, ctx.scope)).timer;
        assertCurrent(ctx);
        return { record: saved, previous: old };
      },
    );
  }
  async function action(
    id,
    transform,
    sharedCommand,
    deleting = false,
    label = "sayacı",
  ) {
    const selected = stopwatches.value.find((t) => t.id === id);
    if (selected?.dataMode === MODE.SHARED)
      return sharedMutation(id, sharedCommand, label);
    const ctx = capture();
    return serial(id, async () => {
      try {
        assertCurrent(ctx);
        const old = stopwatches.value.find((t) => t.id === id);
        if (!old || !visible(old, ctx)) throw new Error("Sayaç bulunamadı");
        const { record, previous } = await localChange(id, ctx, transform, deleting);
        // Claim the alarm from the state read inside the IndexedDB transaction,
        // not a possibly stale view in another tab.
        const newAlarm = !deleting && previous.dataMode !== MODE.SHARED && (
          (record.type === 'up' && record.reachedTarget && !previous.reachedTarget) ||
          (record.type === 'down' && record.status === 'completed' && previous.status === 'running')
        );
        assertCurrent(ctx);
        if (deleting) {
          stopwatches.value = stopwatches.value.filter((t) => t.id !== id);
          cancelSound(id);
          void haptic();
          message.success(`${old.name} ${label} silindi`);
        } else {
          publish(record, ctx);
          if (!newAlarm && record.status !== previous.status && ["paused", "idle"].includes(record.status)) cancelSound(id);
        }
        if (newAlarm) {
          Promise.resolve(notify(record.id, record.name, record.isPay, record.type)).catch(
            () => {},
          );
        }
        if (!deleting && old.dataMode === MODE.SHARED) checkSharedAlarms(ctx);
        failedTransitions.delete(id);
        if (old.dataMode === MODE.WORKSPACE_PERSONAL) void requestSync();
        return true;
      } catch (error) {
        if (current(ctx))
          message.error(
            error.message || "Sayaç kaydedilemedi; işlem uygulanmadı",
          );
        return false;
      }
    });
  }
  async function addTimer(input) {
    const ctx = capture();
    try {
      if (!ready.value) throw new Error("Yerel kayıtların açılmasını bekleyin");
      const ownership = getNewTimerContext(ctx.user, input.isShared === true);
      const retryCreate =
        input.isShared === true &&
        uncertainCreate?.key === ctx.key &&
        uncertainCreate.body.name === input.name?.trim() &&
        uncertainCreate.body.type === input.type &&
        uncertainCreate.body.targetMinutes === Number(input.duration);
      const record = {
        id: retryCreate ? uncertainCreate.body.timerId : crypto.randomUUID(),
        ...ownership,
        name: input.name?.trim(),
        type: input.type,
        targetMinutes: Number(input.duration),
        isPay: false,
        isShared: input.isShared === true,
        status: "idle",
        startTime: null,
        accumulatedTime: 0,
        elapsed: 0,
        remaining:
          input.type === "down" ? Number(input.duration) * 60000 : null,
        reachedTarget: false,
        pausedCount: 0,
        endedAt: null,
        durationMs: null,
      };
      personalStateFromLocal(record);
      let saved = record;
      if (record.dataMode === MODE.SHARED) {
        if (!requireSharedWrite()) return null;
        const result = await sharedMutation(
          record.id,
          {
            command: "create",
            name: record.name,
            type: record.type,
            targetMinutes: record.targetMinutes,
          },
          "sayacı",
          { autoStart: input.autoStart === true },
        );
        if (!result) return null;
        return input.autoStart === true
          ? { id: record.id, started: result.started === true }
          : record.id;
      } else {
        saved = await timerDb.transaction(
          "rw",
          timerDb.timers,
          timerDb.personalOutbox,
          async () => {
            assertCurrent(ctx);
            const value =
              record.dataMode === MODE.STANDALONE
                ? await repository.saveTimer(record)
                : (await enqueuePersonalPut(record, ctx.scope, { isNew: true }))
                    .timer;
            assertCurrent(ctx);
            return value;
          },
        );
      }
      assertCurrent(ctx);
      publish(saved, ctx);
      if (record.dataMode === MODE.WORKSPACE_PERSONAL) void requestSync();
      return record.id;
    } catch (error) {
      if (current(ctx)) message.error(error.message || "Sayaç oluşturulamadı");
      return null;
    }
  }
  const startTimer = (id) =>
    action(
      id,
      (old) => {
        if (
          old.status === "running" ||
          ["expired", "completed"].includes(old.status)
        )
          return null;
        return { ...old, status: "running", startTime: now() };
      },
      { command: "start" },
    );
  const pauseTimer = (id) =>
    action(
      id,
      (old) => {
        if (old.status !== "running") return null;
        const completed = thresholdState(old, now());
        if (completed?.status === "completed") return completed;
        return {
          ...(completed ?? old),
          accumulatedTime: Math.round(elapsedAt(old, now())),
          status: "paused",
          startTime: null,
          pausedCount: old.pausedCount + 1,
        };
      },
      { command: "pause" },
    );
  const updateIsPay = (id, value) =>
    action(
      id,
      (old) => {
        if (typeof value !== "boolean")
          throw new Error("Geçersiz ödeme durumu");
        return { ...old, isPay: value };
      },
      { command: "set-pay", value },
    );
  const deleteTimer = (timer, label) =>
    action(timer.id, null, { command: "delete" }, true, label);

  async function tick() {
    if (disposed) return;
    if (active && !current(active)) {
      void initialize();
      return;
    }
    const ctx = capture();
    const tasks = [];
    for (const timer of stopwatches.value) {
      if (timer.status !== "running") continue;
      const display = displayTimer(
        timer,
        timer.dataMode === MODE.SHARED ? sharedNow() : now(),
      );
      timer.elapsed = display.elapsed;
      timer.remaining = display.remaining;
      if (timer.dataMode === MODE.SHARED) {
        if (sharedTargetReached(timer, sharedNow())) {
          if (!timer.sharedAlarmDelivered)
            tasks.push(markSharedAlarm(timer.id, ctx));
          const key = `${timer.id}:${timer.sharedRevision}`;
          if (
            timer.type === "down" &&
            !failedTransitions.has(key) &&
            online()
          ) {
            failedTransitions.add(key);
            void loadSharedTimers();
          }
        }
        continue; // Rendering/alarming can never issue a shared write.
      }
      if (
        !thresholdState(timer, now()) ||
        transitions.has(timer.id) ||
        failedTransitions.has(timer.id)
      )
        continue;
      transitions.add(timer.id);
      const task = (async () => {
        const success = await action(
          timer.id,
          (old) => thresholdState(old, now()),
          (next) =>
            next.type === "up"
              ? {
                  status: "running",
                  ends_at: personalStateFromLocal(next).endsAt,
                }
              : {
                  status: "completed",
                  ended_at: next.endedAt,
                  duration_ms: next.durationMs,
                },
        );
        if (!success && current(ctx)) failedTransitions.add(timer.id);
      })().finally(() => transitions.delete(timer.id));
      tasks.push(task);
    }
    await Promise.all(tasks);
    if (!stopwatches.value.some((t) => t.status === "running")) stopTick();
  }

  async function requestSync() {
    if (disposed || !ready.value || !active?.scope)
      return { status: "local-only" };
    syncRequested = true;
    if (syncPromise) return syncPromise;
    cancelRetry();
    const work = (async () => {
      let result = { status: "idle" };
      while (syncRequested && !disposed) {
        syncRequested = false;
        const ctx = active;
        try {
          assertCurrent(ctx);
          syncStatus.value = "syncing";
          result = await engine.flush();
          assertCurrent(ctx);
          if (result.status === "done") {
            const pulled = await engine.pull();
            assertCurrent(ctx);
            if (pulled.status !== "done") result = pulled;
          }
          await reloadLocal(ctx);
          await refreshSyncState(ctx, result.status);
          if (result.status === "done" && personalApi?.syncNotification) {
            const session = personalApi.captureSession();
            const rows = await timerDb.timers
              .where("[userId+workspaceId]")
              .equals([ctx.scope.userId, ctx.scope.workspaceId])
              .toArray();
            assertCurrent(ctx);
            for (const row of rows) {
              if (
                row.dataMode !== MODE.WORKSPACE_PERSONAL ||
                !["synced", "deleted"].includes(row.syncState) ||
                notified.get(row.id) === row.syncRevision
              )
                continue;
              try {
                assertCurrent(ctx);
                session.assertCurrent();
                await personalApi.syncNotification(session, row);
                assertCurrent(ctx);
                notified.set(row.id, row.syncRevision);
              } catch {
                assertCurrent(
                  ctx,
                ); /* Notification failure never discards a saved timer. */
              }
            }
          }
        } catch (error) {
          if (current(ctx)) {
            const status =
              error.code === "snapshot-unavailable"
                ? "backend-update-required"
                : error.status === 401
                  ? "auth-required"
                  : error.status === 403
                    ? "forbidden"
                    : "retry";
            try {
              await refreshSyncState(ctx, status);
            } catch {
              if (current(ctx)) syncStatus.value = status;
            }
          }
        }
      }
      return result;
    })();
    syncPromise = work;
    try {
      return await work;
    } finally {
      if (syncPromise === work) syncPromise = null;
    }
  }

  async function applySharedEnvelope(envelope, ctx, snapshot = false) {
    assertCurrent(ctx);
    validateSharedEnvelope(envelope, ctx.scope, snapshot);
    const generation = BigInt(envelope.generation);
    if (generation < sharedGeneration) return false;
    const rows = snapshot ? envelope.timers : [envelope.timer];
    const ids = new Set(rows.map((row) => row.id));
    await timerDb.transaction("rw", timerDb.timers, async () => {
      assertCurrent(ctx);
      for (const row of rows) {
        const cached = await timerDb.timers.get(row.id);
        assertCurrent(ctx);
        if (
          cached &&
          (cached.dataMode !== MODE.SHARED ||
            cached.workspaceId !== ctx.scope.workspaceId ||
            cached.userId !== row.user_id)
        )
          throw new Error("Ortak cache kapsamı değiştirilemez");
        if (
          cached?.sharedRevision &&
          BigInt(cached.sharedRevision) > BigInt(row.shared_revision)
        )
          continue;
        if (
          cached?.syncDeleted &&
          row.record_status === "active" &&
          !row.archived_at
        )
          continue;
        const terminal =
          row.record_status !== "active" || Boolean(row.archived_at);
        const record = terminal
          ? {
              id: row.id,
              dataMode: MODE.SHARED,
              isShared: true,
              userId: row.user_id,
              workspaceId: row.workspace_id,
            }
          : sharedFromServer(row, Date.parse(envelope.serverNow));
        await timerDb.timers.put({
          ...record,
          sharedRevision: row.shared_revision,
          sharedGeneration: envelope.generation,
          sharedClockOffset: Date.parse(envelope.serverNow) - now(),
          syncDeleted: terminal,
          sharedAlarmDelivered: cached?.sharedAlarmDelivered === true,
        });
        assertCurrent(ctx);
      }
      if (snapshot) {
        const cached = await timerDb.timers
          .where("workspaceId")
          .equals(ctx.scope.workspaceId)
          .toArray();
        for (const row of cached)
          if (
            row.dataMode === MODE.SHARED &&
            !row.syncDeleted &&
            !ids.has(row.id) &&
            BigInt(row.sharedGeneration ?? "0") <= generation
          )
            await timerDb.timers.delete(row.id);
      }
      assertCurrent(ctx);
    });
    assertCurrent(ctx);
    for (const row of rows)
      if (row.record_status !== "active" || row.archived_at) {
        sharedDeleted.add(row.id);
        cancelSound(row.id);
      }
    stopwatches.value = stopwatches.value.filter(
      (t) => t.dataMode !== MODE.SHARED || !sharedDeleted.has(t.id),
    );
    if (generation < sharedGeneration) return false;
    sharedGeneration =
      generation > sharedGeneration ? generation : sharedGeneration;
    // A slow same-generation response was sampled before the UI's last tick.
    // Keep a monotonic estimate; this never changes a canonical timer status.
    const serverTime = Date.parse(envelope.serverNow);
    sharedClock = {
      server: sharedClock ? Math.max(sharedNow(), serverTime) : serverTime,
      local: monotonicNow(),
    };
    const rowsNow = await repository.listSharedTimerCache(ctx.scope);
    assertCurrent(ctx);
    stopwatches.value = [
      ...stopwatches.value.filter((t) => t.dataMode !== MODE.SHARED),
      ...rowsNow.map((t) => displayTimer(t, sharedNow())),
    ];
    checkSharedAlarms(ctx);
    startTick();
    return true;
  }
  // Continue only this user's accepted create-and-start action. A canonical CREATE
  // ACK supplies the START revision; a transient socket GET must not cancel it.
  // The server still checks that revision. Never queue or replay a failed START.
  async function startAfterConfirmedCreate(id, createdEnvelope, ctx) {
    assertCurrent(ctx);
    const created = stopwatches.value.find(
      (t) => t.id === id && t.dataMode === MODE.SHARED,
    );
    if (
      !online() ||
      sharedDeleted.has(id) ||
      createdEnvelope.timer.record_status !== "active" ||
      createdEnvelope.timer.status !== "idle" ||
      !created ||
      created.status !== "idle" ||
      created.sharedRevision !== createdEnvelope.timer.shared_revision
    )
      return false;
    const body = {
      protocol: 5,
      timerId: id,
      mutationId: crypto.randomUUID(),
      expectedRevision: createdEnvelope.timer.shared_revision,
      command: "start",
    };
    try {
      const result = await sharedApi.command(body, {
        isRequestCurrent: () => current(ctx),
      });
      assertCurrent(ctx);
      if (result.timer.status !== "running")
        throw new Error("Başlatma yanıtı doğrulanamadı");
      sharedEventRevision++;
      const applied = await applySharedEnvelope(result, ctx);
      assertCurrent(ctx);
      return (
        applied &&
        stopwatches.value.some(
          (t) =>
            t.id === id &&
            t.dataMode === MODE.SHARED &&
            t.status === "running" &&
            BigInt(t.sharedRevision) >= BigInt(result.timer.shared_revision),
        )
      );
    } catch (error) {
      if (current(ctx)) {
        sharedState.value =
          error.status === 401
            ? "auth-required"
            : online()
              ? "reconciling"
              : "offline-readonly";
        if (error.status !== 401) await loadSharedTimers();
      }
      return false;
    }
  }
  async function sharedMutation(
    id,
    command,
    label = "sayacı",
    { autoStart = false } = {},
  ) {
    if (!requireSharedWrite()) return false;
    const ctx = capture();
    const old = stopwatches.value.find((t) => t.id === id);
    if (
      !ctx.scope ||
      (command.command !== "create" && (!old || old.dataMode !== MODE.SHARED))
    )
      return false;
    sharedPending.value = true;
    const body =
      command.command === "create" &&
      uncertainCreate?.key === ctx.key &&
      uncertainCreate.body.timerId === id
        ? uncertainCreate.body
        : {
            protocol: 5,
            timerId: id,
            mutationId: crypto.randomUUID(),
            expectedRevision: old?.sharedRevision ?? "0",
            ...command,
          };
    try {
      const envelope = await sharedApi.command(body, {
        isRequestCurrent: () => current(ctx),
      });
      assertCurrent(ctx);
      if (envelope?.timer?.id !== id || envelope.mutationId !== body.mutationId)
        throw new Error("Ortak komut cevabı eşleşmiyor");
      if (
        command.command === "create" &&
        envelope.timer.user_id !== ctx.scope.userId
      )
        throw new Error("Ortak sahiplik yanıtı eşleşmiyor");
      sharedEventRevision++;
      const applied = await applySharedEnvelope(envelope, ctx);
      assertCurrent(ctx);
      if (command.command === "create") {
        uncertainCreate = null;
        if (autoStart) {
          const started = applied
            ? await startAfterConfirmedCreate(id, envelope, ctx)
            : false;
          assertCurrent(ctx);
          return { started };
        }
      }
      if (command.command === "delete") {
        void haptic();
        message.success(`${old.name} ${label} silindi`);
      }
      return true;
    } catch (error) {
      if (current(ctx)) {
        if (command.command === "create")
          uncertainCreate =
            !error.status || error.status >= 500
              ? { key: ctx.key, body }
              : null;
        sharedState.value =
          error.status === 401
            ? "auth-required"
            : online()
              ? "unavailable"
              : "offline-readonly";
        const isLoading =
          online() && error.status !== 401 && error.status !== 403;

        const text =
          error.status === 401
            ? "Oturumunuzu doğrulayın."
            : error.status === 403
              ? "Bu ortak işlem için izniniz yok."
              : !online()
                ? "İşlemin sonucu henüz doğrulanamadı. İnternet bağlantınızı kontrol edin."
                : error.status === 409
                  ? "Ortak sayaç değişti. Güncel durum alınıyor."
                  : "İşlemin sonucu henüz doğrulanamadı. Güncel durum alınıyor.";

        const loadingId = isLoading ? message.loading(text) : null;

        if (!isLoading) {
          message.warning(text);
        }

        try {
          if (error.status !== 401) {
            await loadSharedTimers();
          }
        } finally {
          if (loadingId !== null) {
            message.dismiss(loadingId);
          }
        }
      }
      return false;
    } finally {
      if (current(ctx)) sharedPending.value = false;
    }
  }
  async function loadSharedTimers() {
    const ctx = active;
    if (!ctx?.scope || !current(ctx)) return false;
    if (!online()) {
      sharedState.value = "offline-readonly";
      return false;
    }
    sharedRequested = true;
    if (sharedPromise) return sharedPromise;
    const work = (async () => {
      let loaded = false,
        attempts = 0;
      while (current(ctx) && sharedRequested && attempts++ < 3) {
        sharedRequested = false;
        sharedState.value = "reconciling";
        const revision = sharedEventRevision;
        try {
          const envelope = await sharedApi.snapshot({
            isRequestCurrent: () => current(ctx),
          });
          assertCurrent(ctx);
          if (revision !== sharedEventRevision) {
            sharedRequested = true;
            continue;
          }
          if (!(await applySharedEnvelope(envelope, ctx, true))) {
            sharedRequested = true;
            continue;
          }
          assertCurrent(ctx);
          if (revision !== sharedEventRevision) {
            sharedRequested = true;
            continue;
          }
          sharedState.value = online() ? "ready" : "offline-readonly";
          sharedLastVerified.value = now();
          loaded = true;
        } catch (error) {
          if (current(ctx))
            sharedState.value =
              error.status === 401
                ? "auth-required"
                : online()
                  ? "unavailable"
                  : "offline-readonly";
        }
      }
      return loaded;
    })();
    sharedPromise = work;
    try {
      return await work;
    } finally {
      if (sharedPromise === work) sharedPromise = null;
    }
  }
  const offTimer = socket.onTimerEvent(({ data }) => {
    const ctx = active;
    if (!ctx?.scope || !current(ctx)) return;
    if (data?.workspaceId && data.workspaceId !== ctx.scope.workspaceId) return;
    sharedEventRevision++;
    // Missing/legacy payload is never authoritative. A scoped GET is required.
    if (data?.protocol === 5)
      void applySharedEnvelope(data, ctx).catch(() => {});
    void loadSharedTimers();
  });
  const offConnected = socket.onSocketConnected(() => {
    void loadSharedTimers();
  });
  function listen(target, type, callback) {
    target?.addEventListener(type, callback);
    removers.push(() => target?.removeEventListener(type, callback));
  }
  const resume = () => {
    retryBudget = 3;
    failedTransitions.clear();
    void initialize();
    void tick();
    void loadSharedTimers();
  };
  listen(events, backend.AUTH_LOCAL_LOGOUT_EVENT, () => {
    suspended = true;
    clearView();
    active = null;
    void initialize();
  });
  listen(events, backend.AUTH_SESSION_CHANGED_EVENT, () => {
    suspended = false;
    void initialize();
  });
  listen(events, backend.AUTH_LOGIN_REQUIRED_EVENT, () => {
    suspended = false;
    void initialize();
  });
  listen(events, backend.AUTH_USER_CHANGED_EVENT, () => {
    void initialize();
  });
  listen(events, "storage", (event) => {
    if ([null, "user", "refreshToken", "accessToken"].includes(event.key))
      void initialize();
  });
  listen(events, "offline", () => {
    cancelRetry();
    sharedState.value = "offline-readonly";
  });
  listen(events, "online", resume);
  listen(events, "focus", resume);
  listen(events, "pageshow", resume);
  listen(document, "visibilitychange", () => {
    if (document.visibilityState === "visible") resume();
    else cancelRetry();
  });
  function dispose() {
    stopSharedLoadingMessage();
    closeSharedLoadingMessage();
    disposed = true;
    epoch++;
    subscription?.unsubscribe();
    stopTick();
    cancelRetry();
    offTimer?.();
    offConnected?.();
    removers.forEach((remove) => remove());
  }
  return {
    sharedNotice,
    sharedState,
    sharedPending,
    sharedWritable,
    sharedLastVerified,
    requireSharedWrite,
    stopwatches,
    ready,
    user,
    syncStatus,
    pendingCount,
    presetTimes,
    presetNames,
    duration,
    name,
    roleStyles,
    syncIssues,
    syncReview,
    resolvingSync,
    reviewSyncIssue,
    acceptSyncServer,
    retrySync,
    cancelSyncReview: () => {
      if (!resolvingSync.value) syncReview.value = null;
    },
    initialize,
    addTimer,
    startTimer,
    pauseTimer,
    deleteTimer,
    updateIsPay,
    tick,
    startTick,
    stopTick,
    loadSharedTimers,
    requestSync,
    dispose,
  };
}
