import { canEnqueuePersonalTimer } from "./personalSyncPolicy.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isRevision = (n) => Number.isSafeInteger(n) && n >= 0 && n < Number.MAX_SAFE_INTEGER;
export function requireUuid(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("A valid UUID is required");
}
export function requireScope(scope) {
  requireUuid(scope?.userId);
  requireUuid(scope?.workspaceId);
}
export function requirePersonal(timer, scope) {
  requireScope(scope);
  requireUuid(timer?.id);
  if (!canEnqueuePersonalTimer(timer, scope)) throw new Error("Personal timer scope mismatch");
}
const ms = (n) => Number.isSafeInteger(n) && n >= 0;
function timestamp(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("Invalid canonical timestamp");
  }
  return new Date(value).toISOString();
}

// Whitelist only. This function also validates server snapshots and persisted payloads.
export function canonicalState(state) {
  if (!state || typeof state.name !== "string" || !state.name.trim() || state.name.length > 35 ||
      !["up", "down"].includes(state.type) ||
      typeof state.targetMinutes !== "number" || !Number.isFinite(state.targetMinutes) ||
      state.targetMinutes <= 0 || state.targetMinutes * 60000 > Number.MAX_SAFE_INTEGER ||
      typeof state.isPay !== "boolean" ||
      !["idle", "running", "paused", "completed"].includes(state.status) ||
      (state.type === "up" && state.status === "completed") ||
      !ms(state.accumulatedMs) || !ms(state.pausedCount) || state.pausedCount > 2147483647 ||
      (state.durationMs !== null && !ms(state.durationMs))) {
    throw new Error("Invalid complete canonical timer state");
  }
  const endsAt = timestamp(state.endsAt);
  const endedAt = timestamp(state.endedAt);
  if (state.status === "running" && !endsAt) throw new Error("Running timer needs endsAt");
  return {
    name: state.name, type: state.type, targetMinutes: state.targetMinutes,
    isPay: state.isPay, status: state.status, endsAt, endedAt,
    durationMs: state.durationMs, accumulatedMs: state.accumulatedMs, pausedCount: state.pausedCount,
  };
}

// accumulatedTime is milliseconds already accrued at startTime, NOT elapsed at send time.
// No Date.now() here: an offline snapshot must retain its original time anchor.
export function personalStateFromLocal(timer) {
  const status = timer.status === "expired" && timer.type === "down" ? "completed" : timer.status;
  let endsAt = null;
  if (status === "running") {
    if (!ms(timer.startTime) || !ms(timer.accumulatedTime)) throw new Error("Running timer needs a reliable start anchor");
    const end = timer.startTime + timer.targetMinutes * 60000 - timer.accumulatedTime;
    if (!Number.isFinite(end) || Math.abs(end) > 8640000000000000) throw new Error("Invalid time anchor");
    endsAt = new Date(end).toISOString();
  }
  if (status === "completed" && (timer.endedAt == null || timer.durationMs == null)) {
    throw new Error("Completion requires explicit endedAt and durationMs from the local action");
  }
  return canonicalState({
    name: timer.name, type: timer.type, targetMinutes: timer.targetMinutes,
    isPay: timer.isPay, status, endsAt, endedAt: timer.endedAt ?? null,
    durationMs: timer.durationMs ?? null, accumulatedMs: timer.accumulatedTime,
    pausedCount: timer.pausedCount ?? 0,
  });
}

export function validateServerTimer(row, scope, recordStatus = "active") {
  requireScope(scope);
  requireUuid(row?.id);
  if (row.user_id !== scope.userId || row.workspace_id !== scope.workspaceId ||
      row.is_shared !== false || row.archived_at != null || row.record_status !== recordStatus ||
      !isRevision(row.sync_revision)) throw new Error("Invalid server timer scope/revision/status");
  return canonicalState({
    name: row.name, type: row.type, targetMinutes: row.target_minutes,
    isPay: row.is_pay, status: row.status, endsAt: row.ends_at ?? null,
    endedAt: row.ended_at ?? null, durationMs: row.duration_ms ?? null,
    accumulatedMs: row.accumulated_ms, pausedCount: row.paused_count,
  });
}

export function validateAcknowledgement(data, operation) {
  if (data?.success !== true || typeof data.duplicate !== "boolean") throw new Error("Invalid acknowledgement");
  const row = data.timer;
  const state = validateServerTimer(row, operation, operation.method === "DELETE" ? "deleted" : "active");
  if (row.id !== operation.timerId) throw new Error("Unexpected acknowledgement identity");
  if (operation.method === "DELETE") {
    // Phase 2 returns an already-deleted owned row even if another mutation deleted it.
    // Its terminal state is safe to acknowledge; an active/missing/archived row is not.
    if (row.sync_revision <= operation.expectedRevision) throw new Error("Unexpected delete revision");
    return row.sync_revision;
  }
  if (row.sync_revision !== operation.expectedRevision + 1 ||
      row.last_sync_mutation_id !== operation.mutationId) throw new Error("Unexpected acknowledgement revision/mutation");
  if (operation.method === "PUT" && (typeof data.created !== "boolean" ||
      JSON.stringify(state) !== JSON.stringify(canonicalState(operation.payload)))) {
    throw new Error("Server state differs from the submitted snapshot");
  }
  return row.sync_revision;
}

export function localFromServer(row, scope, now = Date.now()) {
  const state = validateServerTimer(row, scope);
  const accumulatedTime = state.accumulatedMs;
  // Keep the server's time anchor even when the local clock is behind it.
  const startTime = state.status === "running"
    ? Date.parse(state.endsAt) - state.targetMinutes * 60000 + accumulatedTime : null;
  const elapsed = Math.max(0, accumulatedTime + (startTime === null ? 0 : now - startTime));
  return {
    id: row.id, dataMode: "workspace-personal", userId: scope.userId, workspaceId: scope.workspaceId,
    name: state.name, type: state.type, targetMinutes: state.targetMinutes,
    isPay: state.isPay, isShared: false, status: state.status,
    startTime, accumulatedTime,
    elapsed, remaining: Math.max(0, state.targetMinutes * 60000 - elapsed),
    reachedTarget: elapsed >= state.targetMinutes * 60000, pausedCount: state.pausedCount,
    endedAt: state.endedAt, durationMs: state.durationMs,
    syncRevision: row.sync_revision, syncState: "synced", syncDeleted: false,
    createdAt: row.created_at ?? null, updatedAt: row.updated_at ?? null,
  };
}
