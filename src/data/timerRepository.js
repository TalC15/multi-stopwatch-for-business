import { timerDb } from "./timerDb.js";
import { getTimerDataMode, TIMER_DATA_MODE } from "../domain/timerDataMode.js";

function requireId(id) {
  if (typeof id !== "string" || !id.trim()) throw new Error("Timer ID is required");
}

function requireScope(context) {
  if (!context || typeof context.userId !== "string" || !context.userId.trim() ||
      typeof context.workspaceId !== "string" || !context.workspaceId.trim()) {
    throw new Error("An authenticated user and workspace scope is required");
  }
}

function timerFields(timer) {
  // Explicit local schema; the backend transport will map its own fields.
  return {
    id: timer.id,
    dataMode: timer.dataMode,
    userId: timer.userId,
    workspaceId: timer.workspaceId,
    name: timer.name,
    type: timer.type,
    targetMinutes: timer.targetMinutes ?? null,
    isPay: Boolean(timer.isPay),
    isShared: timer.isShared,
    status: timer.status,
    startTime: timer.startTime ?? null,
    accumulatedTime: timer.accumulatedTime ?? 0,
    elapsed: timer.elapsed ?? 0,
    remaining: timer.remaining ?? null,
    reachedTarget: Boolean(timer.reachedTarget),
    pausedCount: timer.pausedCount ?? 0,
    syncState: timer.syncState ?? null,
    createdAt: timer.createdAt ?? null,
    updatedAt: timer.updatedAt ?? null,
  };
}

export async function saveTimer(timer, context) {
  requireId(timer?.id);
  const mode = getTimerDataMode(timer);
  if (mode === TIMER_DATA_MODE.SHARED) {
    throw new Error("Shared timers can only be stored from a server snapshot");
  }
  if (!Number.isFinite(Number(timer.targetMinutes)) || Number(timer.targetMinutes) <= 0) {
    throw new Error("A new local timer needs a positive target duration");
  }
  if (mode === TIMER_DATA_MODE.WORKSPACE_PERSONAL) {
    requireScope(context);
    if (timer.userId !== context.userId || timer.workspaceId !== context.workspaceId) {
      throw new Error("Timer does not belong to the active user/workspace");
    }
  }

  const record = timerFields(timer);
  return timerDb.transaction("rw", timerDb.timers, async () => {
    const existing = await timerDb.timers.get(record.id);
    if (existing && (
      existing.dataMode !== record.dataMode ||
      existing.userId !== record.userId ||
      existing.workspaceId !== record.workspaceId
    )) {
      throw new Error("A timer ID cannot change data mode or ownership");
    }
    if (existing?.createdAt && !record.createdAt) record.createdAt = existing.createdAt;
    await timerDb.timers.put(record);
    return record;
  });
}

export async function getStandaloneTimer(id) {
  const timer = await timerDb.timers.get(id);
  return timer?.dataMode === TIMER_DATA_MODE.STANDALONE ? timer : undefined;
}

export async function listStandaloneTimers() {
  return timerDb.timers.where("dataMode").equals(TIMER_DATA_MODE.STANDALONE).toArray();
}

export async function removeStandaloneTimer(id) {
  return timerDb.transaction("rw", timerDb.timers, async () => {
    const timer = await timerDb.timers.get(id);
    if (timer?.dataMode !== TIMER_DATA_MODE.STANDALONE) return false;
    await timerDb.timers.delete(id);
    return true;
  });
}

export async function getWorkspacePersonalTimer(id, context) {
  requireScope(context);
  const timer = await timerDb.timers.get(id);
  return timer?.dataMode === TIMER_DATA_MODE.WORKSPACE_PERSONAL &&
    timer.userId === context.userId && timer.workspaceId === context.workspaceId
    ? timer : undefined;
}

export async function listWorkspacePersonalTimers(context) {
  requireScope(context);
  const scoped = await timerDb.timers
    .where("[userId+workspaceId]")
    .equals([context.userId, context.workspaceId])
    .toArray();
  return scoped.filter((timer) => timer.dataMode === TIMER_DATA_MODE.WORKSPACE_PERSONAL);
}

export async function listSharedTimerCache({ workspaceId }) {
  if (typeof workspaceId !== "string" || !workspaceId.trim()) {
    throw new Error("Workspace scope is required");
  }
  const scoped = await timerDb.timers.where("workspaceId").equals(workspaceId).toArray();
  return scoped.filter((timer) => timer.dataMode === TIMER_DATA_MODE.SHARED);
}

// The caller must supply a successfully authenticated backend snapshot for this workspace.
// A failed snapshot cannot clear cache. No local shared mutation uses saveTimer().
export async function replaceSharedCacheFromServerSnapshot({ workspaceId, snapshot }) {
  if (typeof workspaceId !== "string" || !workspaceId.trim() ||
      snapshot?.success !== true || !Array.isArray(snapshot.timers)) {
    throw new Error("A successful workspace-scoped server snapshot is required");
  }
  const records = snapshot.timers.map((timer) => {
    requireId(timer?.id);
    if (getTimerDataMode(timer) !== TIMER_DATA_MODE.SHARED ||
        timer.workspaceId !== workspaceId) {
      throw new Error("Shared snapshot contains an out-of-scope timer");
    }
    return timerFields(timer);
  });
  const ids = new Set(records.map((timer) => timer.id));
  if (ids.size !== records.length) throw new Error("Duplicate shared timer ID");

  return timerDb.transaction("rw", timerDb.timers, async () => {
    for (const record of records) {
      const existing = await timerDb.timers.get(record.id);
      if (existing && (
        existing.dataMode !== TIMER_DATA_MODE.SHARED ||
        existing.userId !== record.userId ||
        existing.workspaceId !== workspaceId
      )) {
        throw new Error("Shared timer ID cannot change creator or workspace");
      }
    }
    const scoped = await timerDb.timers.where("workspaceId").equals(workspaceId).toArray();
    for (const timer of scoped) {
      if (timer.dataMode === TIMER_DATA_MODE.SHARED && !ids.has(timer.id)) {
        await timerDb.timers.delete(timer.id);
      }
    }
    await timerDb.timers.bulkPut(records);
    return records.length;
  });
}
