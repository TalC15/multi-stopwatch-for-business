import { timerDb } from "../data/timerDb.js";
import { saveTimer } from "../data/timerRepository.js";
import {
  requirePersonal, requireScope, requireUuid, isRevision, personalStateFromLocal,
  validateAcknowledgement, validateServerTimer, localFromServer, validatePersonalTombstone, canonicalState,
} from "./personalSyncModel.js";

const scoped = (scope) => timerDb.personalOutbox.where("[userId+workspaceId]").equals([scope.userId, scope.workspaceId]);
const sameScope = (a, b) => a.userId === b.userId && a.workspaceId === b.workspaceId;
const transaction = (fn) => timerDb.transaction("rw", timerDb.timers, timerDb.personalOutbox, fn);
const retryDelay = (attempts) => Math.min(300000, 5000 * 2 ** Math.min(6, Math.max(0, attempts - 1)));

export async function listPersonalOutbox(scope) {
  requireScope(scope);
  return (await scoped(scope).toArray()).sort((a, b) => a.seq - b.seq);
}

// isNew must be explicit: absence from GET is never evidence that an ID is new.
export async function enqueuePersonalPut(timer, scope, { isNew = false } = {}) {
  timer = { ...timer };
  scope = { userId: scope?.userId, workspaceId: scope?.workspaceId };
  requirePersonal(timer, scope);
  if (timer.syncDeleted) throw new Error("A deleted timer cannot be recreated");
  const payload = personalStateFromLocal(timer);
  const mutationId = crypto.randomUUID();
  return transaction(async () => {
    const previous = await timerDb.timers.get(timer.id);
    if (previous) requirePersonal(previous, scope);
    if (previous?.syncDeleted) throw new Error("A deleted timer cannot be recreated");
    if (isNew ? Boolean(previous) : !previous || !isRevision(previous.syncRevision)) {
      throw new Error("New UUID or verified server revision required");
    }
    if (previous && (previous.type !== timer.type || previous.targetMinutes !== timer.targetMinutes)) {
      throw new Error("Type and target duration are immutable");
    }
    const record = await saveTimer(timer, scope);
    record.syncRevision = isNew ? 0 : previous.syncRevision;
    record.syncState = ["conflict", "error", "forbidden"].includes(previous?.syncState) ? previous.syncState : "pending";
    await timerDb.timers.put(record);
    const queued = (await scoped(scope).toArray()).filter(row => row.timerId === timer.id).sort((a,b) => a.seq-b.seq);
    if (queued.some(row => ["conflict", "error", "forbidden"].includes(row.status))) {
      const tail = queued.at(-1);
      // Only compact an unsent tail behind a blocked head, never its frozen identity.
      if (tail !== queued[0] && tail.method === "PUT" && tail.status === "pending" &&
          tail.body === null && tail.expectedRevision === null && tail.attempts === 0) {
        await timerDb.personalOutbox.update(tail.seq, { payload });
        return { timer: record, seq: tail.seq };
      }
    }
    const seq = await timerDb.personalOutbox.add({
      timerId: timer.id, userId: scope.userId, workspaceId: scope.workspaceId,
      method: "PUT", mutationId, expectedRevision: null, payload, body: null,
      status: "pending", attempts: 0, retryAt: 0, error: null,
    });
    return { timer: record, seq };
  });
}

export async function enqueuePersonalDelete(timerId, scope) {
  scope = { userId: scope?.userId, workspaceId: scope?.workspaceId };
  requireScope(scope);
  requireUuid(timerId);
  return transaction(async () => {
    const timer = await timerDb.timers.get(timerId);
    requirePersonal(timer, scope);
    if (timer.syncDeleted) throw new Error("Timer is already deleted locally");
    if (!isRevision(timer.syncRevision)) throw new Error("Verified server revision required");
    await timerDb.timers.update(timerId, { syncDeleted: true,
      syncState: ["conflict", "error", "forbidden"].includes(timer.syncState) ? timer.syncState : "pending" });
    for (const row of await scoped(scope).toArray()) {
      if (row.timerId === timerId && row.status === "conflict") await timerDb.personalOutbox.update(row.seq, { reconcileAt: 0 });
    }
    const seq = await timerDb.personalOutbox.add({
      timerId, userId: scope.userId, workspaceId: scope.workspaceId,
      method: "DELETE", mutationId: crypto.randomUUID(), expectedRevision: null,
      payload: null, body: null, status: "pending", attempts: 0, retryAt: 0, error: null,
    });
    return { timerId, seq };
  });
}

// Called only under the engine's cross-tab Web Lock. Finalize BEFORE any network IO.
export async function preparePersonalOperation(seq, scope, assertCurrent, now) {
  return transaction(async () => {
    assertCurrent();
    const op = await timerDb.personalOutbox.get(seq);
    assertCurrent();
    if (!op || !sameScope(op, scope)) throw new Error("Outbox scope changed");
    const rows = await scoped(scope).toArray();
    assertCurrent();
    if (rows.some((row) => row.timerId === op.timerId && row.seq < seq)) return null;
    if (["conflict", "error", "forbidden"].includes(op.status) || op.retryAt > now) return null;
    try { requireUuid(op.timerId); requireUuid(op.mutationId); }
    catch { throw Object.assign(new Error("Invalid persisted identity"), { code: "invalid-operation" }); }
    const timer = await timerDb.timers.get(op.timerId);
    assertCurrent();
    validatePersonalOperation(op, timer, scope);
    if (!op.body) {
      if (!isRevision(timer.syncRevision)) throw new Error("Missing verified revision");
      op.expectedRevision = timer.syncRevision;
      op.body = JSON.stringify({
        dataMode: "workspace-personal", mutationId: op.mutationId,
        expectedRevision: op.expectedRevision, ...(op.method === "PUT" ? op.payload : {}),
      });
    }
    op.attempts += 1;
    op.status = "sending";
    // A tab crash leaves a retriable immutable request, never a permanent sending lock.
    op.retryAt = now + retryDelay(op.attempts);
    await timerDb.personalOutbox.put(op);
    assertCurrent();
    return op;
  });
}

export async function acknowledgePersonalOperation(op, data, assertCurrent) {
  const revision = validateAcknowledgement(data, op);
  return transaction(async () => {
    assertCurrent();
    const stored = await timerDb.personalOutbox.get(op.seq);
    assertCurrent();
    if (!stored || stored.body !== op.body || !sameScope(stored, op)) throw new Error("Outbox acknowledgement changed");
    const timer = await timerDb.timers.get(op.timerId);
    assertCurrent();
    requirePersonal(timer, op);
    await timerDb.personalOutbox.delete(op.seq);
    assertCurrent();
    const pending = (await scoped(op).toArray()).some((row) => row.timerId === op.timerId);
    assertCurrent();
    if (op.method === "DELETE") {
      // Minimal terminal marker prevents stale local objects from reviving this UUID.
      await timerDb.timers.put({
        id: timer.id, dataMode: timer.dataMode, userId: timer.userId,
        workspaceId: timer.workspaceId, isShared: false, syncDeleted: true,
        syncRevision: revision, syncState: "deleted",
      });
    } else {
      // Never replace newer local fields with the response of an earlier operation.
      await timerDb.timers.update(timer.id, { syncRevision: revision, syncState: pending ? "pending" : "synced" });
    }
    assertCurrent();
    return revision;
  });
}

export async function markPersonalOperation(op, status, error, assertCurrent, now, server = undefined) {
  return transaction(async () => {
    assertCurrent();
    const stored = await timerDb.personalOutbox.get(op.seq);
    assertCurrent();
    if (!stored || stored.body !== op.body || !sameScope(stored, op)) throw new Error("Outbox state changed");
    await timerDb.personalOutbox.update(op.seq, {
      status, error, retryAt: now + retryDelay(stored.attempts),
      ...(server === undefined ? {} : { server }),
    });
    assertCurrent();
    let validKey = true;
    try { requireUuid(op.timerId); } catch { validKey = false; }
    const local = validKey ? await timerDb.timers.get(op.timerId) : null;
    assertCurrent();
    if (local && sameScope(local, op) && local.dataMode === "workspace-personal" && local.isShared === false)
      await timerDb.timers.update(op.timerId, { syncState: status });
    assertCurrent();
  });
}

// Validation errors are quarantinable; storage/session failures must still propagate.
export function validatePersonalOperation(op, timer, scope) {
  try {
    requirePersonal(timer, scope); requireUuid(op.timerId); requireUuid(op.mutationId);
    if (!sameScope(op, scope) || timer.id !== op.timerId || !["PUT", "DELETE"].includes(op.method) ||
        !Number.isSafeInteger(op.attempts) || op.attempts < 0 || !isRevision(timer.syncRevision) ||
        !["pending", "sending", "retry", "auth-required", "conflict"].includes(op.status)) throw Error();
    const payload = op.method === "PUT" ? canonicalState(op.payload) : {};
    if (op.body === null) {
      if (op.expectedRevision !== null || op.attempts !== 0) throw Error();
    } else {
      if (typeof op.body !== "string" || !isRevision(op.expectedRevision)) throw Error();
      const body = JSON.parse(op.body);
      const expected = { dataMode: "workspace-personal", mutationId: op.mutationId, expectedRevision: op.expectedRevision, ...payload };
      if (Object.keys(body).length !== Object.keys(expected).length ||
          Object.entries(expected).some(([key,value]) => body[key] !== value)) throw Error();
    }
  } catch { throw Object.assign(new Error("Invalid persisted personal operation"), { code: "invalid-operation" }); }
}

export async function deferPersonalReconciliation(op, assertCurrent, until) {
  return transaction(async () => {
    assertCurrent();
    const stored = await timerDb.personalOutbox.get(op.seq);
    assertCurrent();
    if (stored && sameScope(stored,op) && stored.mutationId === op.mutationId && stored.body === op.body)
      await timerDb.personalOutbox.update(op.seq, { reconcileAt: until });
    assertCurrent();
  });
}

// A review is read-only. Confirmation must match both the local queue and freshly
// fetched canonical server proof, under the same scoped Web Lock.
export async function readPersonalResolution(timerId, scope, assertCurrent) {
  return timerDb.transaction("r", timerDb.timers, timerDb.personalOutbox, async () => {
    assertCurrent();
    const local = await timerDb.timers.get(timerId);
    requirePersonal(local, scope);
    const rows = (await listPersonalOutbox(scope)).filter(op => op.timerId === timerId);
    assertCurrent();
    return { local, rows, fingerprint: JSON.stringify([local, rows]) };
  });
}

export async function acceptPersonalServer(review, proof, scope, assertCurrent) {
  if (proof.kind === "active") validateServerTimer(proof.timer, scope);
  else validatePersonalTombstone(proof.timer, scope);
  if (proof.timer.id !== review.timerId) throw Error("Resolution identity changed");
  return transaction(async () => {
    const state = await readPersonalResolution(review.timerId, scope, assertCurrent);
    if (state.fingerprint !== review.fingerprint || !state.rows.length ||
        proof.timer.sync_revision < state.local.syncRevision) throw Error("Resolution changed; review again");
    const record = proof.kind === "active" ? localFromServer(proof.timer, scope) : {
      id: review.timerId, userId: scope.userId, workspaceId: scope.workspaceId, dataMode: "workspace-personal", isShared: false,
      syncDeleted: true, syncState: "deleted", syncRevision: proof.timer.sync_revision,
    };
    if (proof.kind === "active") record.reachedTarget = state.local.reachedTarget === true;
    await timerDb.timers.put(record);
    for (const row of state.rows) { assertCurrent(); await timerDb.personalOutbox.delete(row.seq); }
    assertCurrent();
  });
}

// A verified server tombstone may satisfy the user's FINAL local delete intent,
// even when an older PUT hit 409 first. Never resolve an edit-vs-edit conflict.
// Called only while the sync engine holds the scoped cross-tab Web Lock.
export async function reconcileAlreadyDeletedPersonalTimer(op, tombstone, scope, assertCurrent) {
  requireScope(scope);
  requireUuid(op?.timerId);
  if (!tombstone || tombstone.id !== op.timerId || tombstone.record_status !== "deleted" ||
      tombstone.archived_at != null) return false;
  try { validatePersonalTombstone(tombstone, scope); } catch { return false; }

  return transaction(async () => {
    assertCurrent();
    const local = await timerDb.timers.get(op.timerId);
    assertCurrent();
    if (!local || !sameScope(local, scope) || local.dataMode !== "workspace-personal" ||
        local.isShared !== false || local.syncDeleted !== true ||
        !isRevision(local.syncRevision) || tombstone.sync_revision <= local.syncRevision) return false;

    const rows = (await scoped(scope).toArray())
      .filter(row => row.timerId === op.timerId).sort((a, b) => a.seq - b.seq);
    assertCurrent();
    if (!rows.length || rows[0].seq !== op.seq || rows[0].mutationId !== op.mutationId ||
        rows[0].status !== "conflict" || rows.at(-1).method !== "DELETE" ||
        rows.some(row => !["PUT", "DELETE"].includes(row.method) ||
          ["error", "forbidden", "auth-required"].includes(row.status) ||
          (row.expectedRevision === null ? row.body !== null :
            !isRevision(row.expectedRevision) || row.expectedRevision >= tombstone.sync_revision ||
            typeof row.body !== "string"))) return false;

    // Queue removal and terminal marker are atomic. No other timer is touched.
    for (const row of rows) {
      await timerDb.personalOutbox.delete(row.seq);
      assertCurrent();
    }
    await timerDb.timers.put({
      id: local.id, dataMode: local.dataMode, userId: local.userId,
      workspaceId: local.workspaceId, isShared: false, syncDeleted: true,
      syncRevision: tombstone.sync_revision, syncState: "deleted",
    });
    assertCurrent();
    return true;
  });
}

// GET is not an ack. Existing dirty/unbased/deleted records are left untouched.
export async function importPersonalSnapshot(rows, scope, assertCurrent, tombstones = []) {
  requireScope(scope);
  if (typeof assertCurrent !== "function" || !Array.isArray(rows)) throw new Error("Authenticated snapshot required");
  rows = rows.map((row) => ({ ...row }));
  scope = { userId: scope.userId, workspaceId: scope.workspaceId };
  rows.forEach((row) => validateServerTimer(row, scope));
  tombstones = tombstones.map(row => ({ ...row }));
  tombstones.forEach(row => validatePersonalTombstone(row, scope));
  if (new Set([...rows, ...tombstones].map(row => row.id)).size !== rows.length + tombstones.length) throw new Error("Duplicate snapshot UUID");
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error("Duplicate server UUID");
  return transaction(async () => {
    assertCurrent();
    const pending = new Set((await scoped(scope).toArray()).map((row) => row.timerId));
    assertCurrent();
    const result = { imported: [], preserved: [] };
    for (const row of rows) {
      const old = await timerDb.timers.get(row.id);
      assertCurrent();
      if (old) requirePersonal(old, scope);
      if (pending.has(row.id) || (old && (old.syncState !== "synced" || old.syncDeleted ||
          !isRevision(old.syncRevision) || old.syncRevision > row.sync_revision))) {
        result.preserved.push(row.id);
        continue;
      }
      const imported = localFromServer(row, scope);
      // Delivery of the local target alarm is device state, not evidence from GET.
      if (imported.type === "up") imported.reachedTarget = old?.reachedTarget === true;
      await timerDb.timers.put(imported);
      assertCurrent();
      result.imported.push(row.id);
    }
    for (const row of tombstones) {
      const old = await timerDb.timers.get(row.id);
      assertCurrent();
      if (!old) continue;
      requirePersonal(old, scope);
      if (pending.has(row.id) || !isRevision(old.syncRevision) ||
          old.syncRevision > row.sync_revision || !["synced", "deleted"].includes(old.syncState)) {
        result.preserved.push(row.id);
        continue;
      }
      await timerDb.timers.put({ id: old.id, dataMode: old.dataMode, userId: old.userId,
        workspaceId: old.workspaceId, isShared: false, syncDeleted: true,
        syncRevision: row.sync_revision, syncState: "deleted" });
      assertCurrent();
      result.imported.push(row.id);
    }
    return result;
  });
}
