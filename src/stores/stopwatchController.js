import { ref } from "vue";
import { liveQuery } from "dexie";
import { timerDb } from "../data/timerDb.js";
import * as repository from "../data/timerRepository.js";
import { getNewTimerContext, getTimerDataMode, TIMER_DATA_MODE as MODE } from "../domain/timerDataMode.js";
import { enqueuePersonalPut, enqueuePersonalDelete, listPersonalOutbox } from "../sync/personalOutbox.js";
import { personalStateFromLocal } from "../sync/personalSyncModel.js";
import { displayTimer, elapsedAt, thresholdState, sharedFromServer, sharedTargetReached } from "./timerClock.js";

// The Pinia wrapper supplies platform effects; tests exercise this same controller with mock IO.
export function createStopwatchController({ backend, socket, engine, personalApi,
  notify, cancelSound, haptic, message, storage = globalThis.localStorage,
  events = globalThis.window, document = globalThis.document, now = Date.now,
  setInterval: every = globalThis.setInterval, clearInterval: stopEvery = globalThis.clearInterval,
}) {
  const preference = (key, fallback) => { try { return JSON.parse(storage?.getItem(key)) ?? fallback; } catch { return fallback; } };
  const stopwatches = ref([]), ready = ref(false), user = ref(null), syncStatus = ref("idle"), pendingCount = ref(0);
  const presetTimes = ref(preference("presetTimes", [])), presetNames = ref(preference("presetNames", []));
  const duration = ref(preference("defaultDuration", 5)), name = ref(preference("defaultName", "kronometre"));
  const roleStyles = { worker: { text: "text-teal-400" }, manager: { text: "text-indigo-400" }, superadmin: { text: "text-amber-400" } };
  let epoch = 0, disposed = false, suspended = false, active = null, subscription = null;
  let initPromise = null, syncPromise = null, syncRequested = false, sharedPromise = null, sharedRequested = false, tickInterval = null;
  const transitions = new Set(), failedTransitions = new Set(), actions = new Map(), notified = new Map();
  const sharedDeleted = new Set();
  let sharedEventRevision = 0;
  const removers = [];

  function context() {
    let current = null;
    try { current = !suspended && backend.isTabSessionCurrent() ? backend.getUser() : null; } catch { /* invalid stored auth */ }
    if (current?.disabled_at) current = null;
    return { user: current, scope: current?.workspace_id ? { userId: current.id, workspaceId: current.workspace_id } : null,
      key: JSON.stringify([backend.getAuthGeneration(), backend.getTabSessionIdentity(), backend.getRefreshToken(), current?.id, current?.workspace_id]) };
  }
  function capture() { return { ...context(), epoch }; }
  function current(ctx) { return !disposed && ctx.epoch === epoch && context().key === ctx.key; }
  function assertCurrent(ctx) {
    if (!current(ctx)) throw Object.assign(new Error("Oturum değişti; işlem uygulanmadı"), { code: "session-changed" });
  }
  function visible(timer, ctx) {
    return timer.dataMode === MODE.STANDALONE || (ctx.scope && timer.workspaceId === ctx.scope.workspaceId &&
      (timer.dataMode === MODE.SHARED || timer.userId === ctx.scope.userId));
  }
  async function readVisible(ctx) {
    const local = await repository.listStandaloneTimers();
    const personal = ctx.scope ? await repository.listWorkspacePersonalTimers(ctx.scope) : [];
    const shared = ctx.scope ? await repository.listSharedTimerCache(ctx.scope) : [];
    return [...local, ...personal, ...shared];
  }
  function applyRows(rows, ctx) {
    if (!current(ctx)) return;
    // Shared realtime display is reconciled through its existing GET/socket flow.
    const existingShared = stopwatches.value.filter(t => t.dataMode === MODE.SHARED && visible(t, ctx));
    const sharedIds = new Set(existingShared.map(t => t.id));
    stopwatches.value = [...rows.filter(t => t.dataMode !== MODE.SHARED || !sharedIds.has(t.id)), ...existingShared]
      .filter(t => visible(t, ctx) && (t.dataMode !== MODE.SHARED || !sharedDeleted.has(t.id)))
      .map(t => displayTimer(t, now()));
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
    epoch++;
    subscription?.unsubscribe(); subscription = null;
    for (const timer of stopwatches.value) if (timer.dataMode !== MODE.STANDALONE) cancelSound(timer.id);
    stopwatches.value = stopwatches.value.filter(t => t.dataMode === MODE.STANDALONE);
    ready.value = false; pendingCount.value = 0; user.value = null;
    sharedPromise = null; sharedRequested = false; sharedDeleted.clear(); sharedEventRevision++; notified.clear(); failedTransitions.clear();
  }
  async function initialize() {
    if (disposed) return false;
    const next = context();
    user.value = next.user;
    if (active?.key === next.key && initPromise) return initPromise;
    if (active?.key === next.key && ready.value) { void requestSync(); return true; }
    clearView();
    const ctx = capture(); active = ctx; user.value = ctx.user;
    const task = (async () => {
      try {
        await reloadLocal(ctx);
        assertCurrent(ctx);
        subscription = liveQuery(() => readVisible(ctx)).subscribe({
          next: rows => applyRows(rows, ctx),
          error: () => { if (current(ctx)) message.error("Yerel sayaçlar okunamadı; veriler silinmedi"); },
        });
        void loadSharedTimers();
        void requestSync();
        return true;
      } catch (error) {
        if (current(ctx)) message.error("Yerel kayıtlar açılamadı. İşlem yapılmadı.");
        return false;
      }
    })();
    initPromise = task;
    try { return await task; } finally { if (initPromise === task) initPromise = null; }
  }
  function startTick() {
    if (!tickInterval && stopwatches.value.some(t => t.status === "running")) tickInterval = every(() => { void tick(); }, 100);
  }
  function stopTick() { if (tickInterval) stopEvery(tickInterval); tickInterval = null; }
  function publish(record, ctx) {
    assertCurrent(ctx);
    const item = displayTimer(record, now());
    const index = stopwatches.value.findIndex(t => t.id === item.id);
    if (index < 0) stopwatches.value.push(item); else stopwatches.value[index] = item;
    startTick();
  }
  function serial(id, work) {
    const task = (actions.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
    actions.set(id, task);
    task.finally(() => { if (actions.get(id) === task) actions.delete(id); }).catch(() => {});
    return task;
  }
  // This marker is device-local and durable. The transaction elects one tab to
  // deliver the alarm even if GET, Socket.IO and the deadline race each other.
  async function markSharedAlarm(id, ctx) {
    try {
      const alarm = await timerDb.transaction("rw", timerDb.timers, async () => {
        assertCurrent(ctx);
        const cached = await timerDb.timers.get(id);
        assertCurrent(ctx);
        const displayed = stopwatches.value.find(t => t.id === id && t.dataMode === MODE.SHARED && visible(t, ctx));
        if (!cached || cached.dataMode !== MODE.SHARED || cached.workspaceId !== ctx.scope?.workspaceId ||
            sharedDeleted.has(id) || !displayed || !sharedTargetReached(displayed, now())) return null;
        if (cached.sharedAlarmDelivered) return "recorded";
        await timerDb.timers.put({ ...cached, sharedAlarmDelivered: true });
        assertCurrent(ctx);
        return "claimed";
      });
      if (alarm && current(ctx) && !sharedDeleted.has(id)) {
        const displayed = stopwatches.value.find(t => t.id === id && t.dataMode === MODE.SHARED && visible(t, ctx));
        if (displayed) {
          displayed.sharedAlarmDelivered = true;
          displayed.reachedTarget = true;
          if (alarm === "claimed") Promise.resolve(notify(id, displayed.name, displayed.isPay)).catch(() => {});
        }
      }
    } catch (error) { if (current(ctx)) message.error("Ortak sayaç bildirimi yerel olarak kaydedilemedi"); }
  }
  function checkSharedAlarms(ctx) {
    if (!current(ctx)) return;
    for (const timer of stopwatches.value) {
      if (timer.dataMode === MODE.SHARED && !timer.sharedAlarmDelivered && sharedTargetReached(timer, now())) {
        void markSharedAlarm(timer.id, ctx);
      }
    }
  }
  async function localChange(id, ctx, transform, deleting = false) {
    return timerDb.transaction("rw", timerDb.timers, timerDb.personalOutbox, async () => {
      assertCurrent(ctx);
      const old = await timerDb.timers.get(id);
      assertCurrent(ctx);
      if (!old || old.syncDeleted || !visible(old, ctx)) throw new Error("Sayaç bu hesapta bulunamadı");
      const mode = getTimerDataMode(old);
      if (mode === MODE.SHARED) throw new Error("Shared sayaç yerel işlem yoluna giremez");
      if (deleting) {
        if (mode === MODE.STANDALONE) await repository.removeStandaloneTimer(id);
        else await enqueuePersonalDelete(id, ctx.scope);
        assertCurrent(ctx); return old;
      }
      const next = transform({ ...old });
      if (!next) return old;
      personalStateFromLocal(next); // Same canonical time rules for both local modes.
      const saved = mode === MODE.STANDALONE ? await repository.saveTimer(next) : (await enqueuePersonalPut(next, ctx.scope)).timer;
      assertCurrent(ctx); return saved;
    });
  }
  async function action(id, transform, sharedUpdates, deleting = false, label = "sayacı") {
    const ctx = capture();
    return serial(id, async () => {
      try {
        assertCurrent(ctx);
        const old = stopwatches.value.find(t => t.id === id);
        if (!old || !visible(old, ctx)) throw new Error("Sayaç bulunamadı");
        let record;
        if (old.dataMode === MODE.SHARED) {
          if (!ctx.scope) throw new Error("Ortak sayaç için oturum gerekli");
          record = transform ? transform({ ...old }) : old;
          if (!record) return true;
          // Preserve legacy shared commands. Phase 5 owns further authority/refactoring.
          const result = deleting ? await backend.dbDeleteTimer(id, { isRequestCurrent: () => current(ctx) }) : await backend.dbUpdateTimer(id, sharedUpdates(record), { isRequestCurrent: () => current(ctx) });
          assertCurrent(ctx);
          if (!result?.success) throw new Error(result?.error || "Ortak sayaç kaydedilemedi");
          // A server deletion may have arrived while this PATCH was in flight.
          if (!deleting && (sharedDeleted.has(id) || !stopwatches.value.some(t => t.id === id && t.dataMode === MODE.SHARED))) return false;
          if (deleting) {
            await removeSharedAfterServerDelete(id, ctx);
            assertCurrent(ctx);
          }
          if (deleting || record.status !== "running") void backend.syncTimerCancel(id, { isRequestCurrent: () => current(ctx) });
          else void backend.syncTimerStart(record, { isRequestCurrent: () => current(ctx) });
          void loadSharedTimers();
        } else {
          record = await localChange(id, ctx, transform, deleting);
          assertCurrent(ctx);
        }
        if (deleting) {
          stopwatches.value = stopwatches.value.filter(t => t.id !== id);
          cancelSound(id); void haptic(); message.success(`${old.name} ${label} silindi`);
        } else {
          publish(record, ctx);
          if (record.status !== "running") cancelSound(id);
        }
        if (!deleting && old.dataMode !== MODE.SHARED && ((record.type === "up" && record.reachedTarget && !old.reachedTarget) ||
            (record.type === "down" && record.status === "completed" && old.status === "running"))) {
          Promise.resolve(notify(record.id, record.name, record.isPay)).catch(() => {});
        }
        if (!deleting && old.dataMode === MODE.SHARED) checkSharedAlarms(ctx);
        failedTransitions.delete(id);
        if (old.dataMode === MODE.WORKSPACE_PERSONAL) void requestSync();
        return true;
      } catch (error) {
        if (current(ctx)) message.error(error.message || "Sayaç kaydedilemedi; işlem uygulanmadı");
        return false;
      }
    });
  }
  async function addTimer(input) {
    const ctx = capture();
    try {
      if (!ready.value) throw new Error("Yerel kayıtların açılmasını bekleyin");
      const ownership = getNewTimerContext(ctx.user, input.isShared === true);
      const record = { id: crypto.randomUUID(), ...ownership, name: input.name?.trim(), type: input.type,
        targetMinutes: Number(input.duration), isPay: false, isShared: input.isShared === true,
        status: "idle", startTime: null, accumulatedTime: 0, elapsed: 0,
        remaining: input.type === "down" ? Number(input.duration) * 60000 : null,
        reachedTarget: false, pausedCount: 0, endedAt: null, durationMs: null };
      personalStateFromLocal(record);
      let saved = record;
      if (record.dataMode === MODE.SHARED) {
        const response = await backend.dbCreateTimer(record, { isRequestCurrent: () => current(ctx) });
        assertCurrent(ctx);
        if (!response?.success) throw new Error(response?.error || "Ortak sayaç oluşturulamadı");
        if (response.timer?.id !== record.id || response.timer.workspace_id !== ctx.scope.workspaceId ||
            response.timer.is_shared !== true || (response.timer.user_id ?? response.timer.created_by) !== ctx.scope.userId) {
          throw new Error("Ortak sayaç yanıtının kimliği veya kapsamı uyuşmuyor");
        }
        sharedEventRevision++; // Confirmed POST invalidates any pre-create shared GET.
        saved = sharedFromServer(response.timer, now());
        saved = await timerDb.transaction("rw", timerDb.timers, async () => {
          assertCurrent(ctx);
          const cached = await timerDb.timers.get(record.id);
          assertCurrent(ctx);
          if (sharedDeleted.has(record.id)) throw new Error("Ortak sayaç sunucuda silindi");
          if (cached && (cached.dataMode !== MODE.SHARED || cached.userId !== saved.userId || cached.workspaceId !== saved.workspaceId)) {
            throw new Error("Ortak sayaç cache kimliği değiştirilemez");
          }
          // POST is authenticated server evidence too. Keep any newer GET state.
          if (!cached) await timerDb.timers.put(saved);
          assertCurrent(ctx);
          return cached ?? saved;
        });
      } else {
        saved = await timerDb.transaction("rw", timerDb.timers, timerDb.personalOutbox, async () => {
          assertCurrent(ctx);
          const value = record.dataMode === MODE.STANDALONE ? await repository.saveTimer(record) :
            (await enqueuePersonalPut(record, ctx.scope, { isNew: true })).timer;
          assertCurrent(ctx); return value;
        });
      }
      assertCurrent(ctx); publish(saved, ctx);
      if (record.dataMode === MODE.WORKSPACE_PERSONAL) void requestSync();
      return record.id;
    } catch (error) { if (current(ctx)) message.error(error.message || "Sayaç oluşturulamadı"); return null; }
  }
  const startTimer = id => action(id, old => {
    if (old.status === "running" || ["expired", "completed"].includes(old.status)) return null;
    return { ...old, status: "running", startTime: now() };
  }, next => ({ status: "running", ends_at: personalStateFromLocal(next).endsAt, accumulated_ms: next.accumulatedTime }));
  const pauseTimer = id => action(id, old => {
    if (old.status !== "running") return null;
    const completed = thresholdState(old, now());
    if (completed?.status === "completed") return completed;
    return { ...(completed ?? old), accumulatedTime: Math.round(elapsedAt(old, now())), status: "paused", startTime: null, pausedCount: old.pausedCount + 1 };
  }, next => next.status === "completed" ? { status: "completed", ended_at: next.endedAt, duration_ms: next.durationMs } :
    { status: "paused", accumulated_ms: next.accumulatedTime });
  const updateIsPay = (id, value) => action(id, old => {
    if (typeof value !== "boolean") throw new Error("Geçersiz ödeme durumu");
    return { ...old, isPay: value };
  }, next => ({ is_pay: next.isPay }));
  const deleteTimer = (timer, label) => action(timer.id, null, null, true, label);

  async function tick() {
    if (disposed) return;
    if (active && !current(active)) { void initialize(); return; }
    const ctx = capture();
    const tasks = [];
    for (const timer of stopwatches.value) {
      if (timer.status !== "running") continue;
      const display = displayTimer(timer, now());
      timer.elapsed = display.elapsed; timer.remaining = display.remaining;
      if (timer.dataMode === MODE.SHARED && sharedTargetReached(timer, now())) {
        if (!timer.sharedAlarmDelivered) tasks.push(markSharedAlarm(timer.id, ctx));
        if (timer.type === "up") continue;
      }
      if (!thresholdState(timer, now()) || transitions.has(timer.id) || failedTransitions.has(timer.id)) continue;
      transitions.add(timer.id);
      const task = (async () => {
        const success = await action(timer.id, old => thresholdState(old, now()), next =>
          next.type === "up" ? { status: "running", ends_at: personalStateFromLocal(next).endsAt } :
          { status: "completed", ended_at: next.endedAt, duration_ms: next.durationMs });
        if (!success && current(ctx)) failedTransitions.add(timer.id);
      })().finally(() => transitions.delete(timer.id));
      tasks.push(task);
    }
    await Promise.all(tasks);
    if (!stopwatches.value.some(t => t.status === "running")) stopTick();
  }

  async function requestSync() {
    if (disposed || !ready.value || !active?.scope) return { status: "local-only" };
    syncRequested = true;
    if (syncPromise) return syncPromise;
    const work = (async () => {
      let result = { status: "idle" };
      while (syncRequested && !disposed) {
        syncRequested = false;
        const ctx = active;
        try {
          assertCurrent(ctx); syncStatus.value = "syncing";
          result = await engine.flush();
          assertCurrent(ctx);
          if (result.status === "done") {
            const pulled = await engine.pull();
            assertCurrent(ctx);
            if (pulled.status !== "done") result = pulled;
          }
          await reloadLocal(ctx);
          const queue = await listPersonalOutbox(ctx.scope);
          assertCurrent(ctx);
          pendingCount.value = queue.length;
          syncStatus.value = queue.some(op => ["conflict", "error", "forbidden"].includes(op.status)) ? "conflict" : result.status;
          if (result.status === "done" && personalApi?.syncNotification) {
            const session = personalApi.captureSession();
            const rows = await timerDb.timers.where("[userId+workspaceId]").equals([ctx.scope.userId, ctx.scope.workspaceId]).toArray();
            assertCurrent(ctx);
            for (const row of rows) {
              if (row.dataMode !== MODE.WORKSPACE_PERSONAL || !["synced", "deleted"].includes(row.syncState) || notified.get(row.id) === row.syncRevision) continue;
              try {
                assertCurrent(ctx); session.assertCurrent();
                await personalApi.syncNotification(session, row);
                assertCurrent(ctx); notified.set(row.id, row.syncRevision);
              } catch { assertCurrent(ctx); /* Notification failure never discards a saved timer. */ }
            }
          }
        } catch (error) { if (current(ctx)) syncStatus.value = error.code === "snapshot-unavailable" ? "backend-update-required" : "retry"; }
      }
      return result;
    })();
    syncPromise = work;
    try { return await work; } finally { if (syncPromise === work) syncPromise = null; }
  }

  // Both an acknowledged DELETE and the scoped socket event are server evidence.
  // Invalidate older reads immediately, even when this UUID is not in memory yet.
  async function removeSharedAfterServerDelete(id, ctx) {
    assertCurrent(ctx);
    sharedEventRevision++;
    sharedDeleted.add(id);
    const displayed = stopwatches.value.find(t => t.id === id && t.dataMode === MODE.SHARED && visible(t, ctx));
    if (displayed) {
      cancelSound(id);
      stopwatches.value = stopwatches.value.filter(t => t !== displayed);
    }
    await timerDb.transaction("rw", timerDb.timers, async () => {
      assertCurrent(ctx);
      const cached = await timerDb.timers.get(id);
      assertCurrent(ctx);
      if (cached?.dataMode === MODE.SHARED && cached.workspaceId === ctx.scope?.workspaceId) {
        await timerDb.timers.delete(id);
        assertCurrent(ctx);
      }
    });
  }

  async function loadSharedTimers() {
    const ctx = active;
    if (!ctx?.scope || !current(ctx)) return false;
    sharedRequested = true;
    if (sharedPromise) return sharedPromise;
    const work = (async () => {
      let loaded = false;
      // An event arriving during GET needs a fresh read after that response.
      while (current(ctx) && sharedRequested) {
        sharedRequested = false;
        try {
          const revision = sharedEventRevision;
          const rows = await backend.dbGetSharedTimers({ isRequestCurrent: () => current(ctx) });
          assertCurrent(ctx);
          if (revision !== sharedEventRevision) continue; // An older GET cannot undo a socket deletion.
          if (!Array.isArray(rows) || rows.some(row => row.workspace_id !== ctx.scope.workspaceId || row.is_shared !== true)) continue;
          const records = rows.map(row => sharedFromServer(row, now()));
          await timerDb.transaction("rw", timerDb.timers, async () => {
            assertCurrent(ctx);
            if (revision !== sharedEventRevision) throw new Error("Stale shared snapshot");
            for (const record of records) {
              const cached = await timerDb.timers.get(record.id);
              record.sharedAlarmDelivered = cached?.dataMode === MODE.SHARED && cached.workspaceId === ctx.scope.workspaceId && cached.sharedAlarmDelivered === true;
            }
            await repository.replaceSharedCacheFromServerSnapshot({ workspaceId: ctx.scope.workspaceId, snapshot: { success: true, timers: records } });
            assertCurrent(ctx);
          });
          assertCurrent(ctx);
          if (revision !== sharedEventRevision) continue;
          sharedDeleted.clear();
          stopwatches.value = [...stopwatches.value.filter(t => t.dataMode !== MODE.SHARED),
            ...records.map(record => ({ ...record, sharedAlarmDelivered: record.sharedAlarmDelivered ||
              stopwatches.value.find(t => t.id === record.id && t.dataMode === MODE.SHARED)?.sharedAlarmDelivered === true }))];
          checkSharedAlarms(ctx);
          startTick(); loaded = true;
        } catch { /* Keep cache on failure; retry only on another explicit event. */ }
      }
      return loaded;
    })();
    sharedPromise = work;
    try { return await work; } finally { if (sharedPromise === work) sharedPromise = null; }
  }
  const offTimer = socket.onTimerEvent(({ event, data }) => {
    const ctx = active;
    if (!ctx?.scope || !current(ctx)) return;
    if (event === "deleted") {
      if (typeof data?.id !== "string" || !data.id.trim()) return;
      void removeSharedAfterServerDelete(data.id, ctx)
        .catch(() => { if (current(ctx)) message.error("Ortak sayaç önbelleği güncellenemedi"); });
      void loadSharedTimers();
      return;
    }
    const timer = stopwatches.value.find(t => t.id === data?.id && t.dataMode === MODE.SHARED && visible(t, ctx));
    if (event === "created") { void loadSharedTimers(); return; }
    if (!timer) return;
    if (event === "updated") {
      if (data.status !== undefined) timer.status = data.status;
      if (data.isPay !== undefined) timer.isPay = data.isPay;
      if (data.pausedCount !== undefined) timer.pausedCount = Number(data.pausedCount);
      // The remote device's target flag is not this device's notification receipt.
      if (data.status === "running") {
        timer.accumulatedTime = data.endsAt ? Math.max(0, timer.targetMinutes * 60000 - (Date.parse(data.endsAt) - now())) : Number(data.accumulatedTimeAtStart || 0);
        timer.startTime = now(); startTick();
      } else if (data.status === "paused") { timer.accumulatedTime = Number(data.accumulatedTimeAtStart ?? elapsedAt(timer, now())); timer.startTime = null; cancelSound(timer.id); }
      else if (["expired", "completed"].includes(data.status)) {
        Object.assign(timer, { status: "expired", startTime: null, accumulatedTime: timer.targetMinutes * 60000, elapsed: timer.targetMinutes * 60000, remaining: 0 });
      }
      checkSharedAlarms(ctx);
    }
    void loadSharedTimers();
  });
  const offConnected = socket.onSocketConnected(() => { void loadSharedTimers(); });
  function listen(target, type, callback) {
    target?.addEventListener(type, callback);
    removers.push(() => target?.removeEventListener(type, callback));
  }
  const resume = () => { failedTransitions.clear(); void initialize(); void tick(); void loadSharedTimers(); };
  listen(events, backend.AUTH_LOCAL_LOGOUT_EVENT, () => { suspended = true; clearView(); active = null; void initialize(); });
  listen(events, backend.AUTH_SESSION_CHANGED_EVENT, () => { suspended = false; void initialize(); });
  listen(events, backend.AUTH_LOGIN_REQUIRED_EVENT, () => { suspended = false; void initialize(); });
  listen(events, backend.AUTH_USER_CHANGED_EVENT, () => { void initialize(); });
  listen(events, "storage", event => { if ([null, "user", "refreshToken", "accessToken"].includes(event.key)) void initialize(); });
  listen(events, "online", resume); listen(events, "focus", resume); listen(events, "pageshow", resume);
  listen(document, "visibilitychange", () => { if (document.visibilityState === "visible") resume(); });
  function dispose() {
    disposed = true; epoch++; subscription?.unsubscribe(); stopTick();
    offTimer?.(); offConnected?.(); removers.forEach(remove => remove());
  }
  return { stopwatches, ready, user, syncStatus, pendingCount, presetTimes, presetNames, duration, name, roleStyles,
    initialize, addTimer, startTimer, pauseTimer, deleteTimer, updateIsPay, tick, startTick, stopTick, loadSharedTimers, requestSync, dispose };
}
