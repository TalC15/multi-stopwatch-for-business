import { timerDb } from "../data/timerDb.js";
import { createPersonalSyncApi } from "./personalSyncApi.js";
import { validateAcknowledgement, validateServerTimer, validatePersonalTombstone } from "./personalSyncModel.js";
import {
  listPersonalOutbox, preparePersonalOperation, acknowledgePersonalOperation,
  markPersonalOperation, importPersonalSnapshot, reconcileAlreadyDeletedPersonalTimer,
  validatePersonalOperation, deferPersonalReconciliation, readPersonalResolution, acceptPersonalServer,
} from "./personalOutbox.js";

export function createPersonalSyncEngine({ api = createPersonalSyncApi(), locks = globalThis.navigator?.locks, now = Date.now, online = () => globalThis.navigator?.onLine !== false } = {}) {
  const reviews = new WeakMap();
  async function inSessionLock(work) {
    let session;
    try { session = api.captureSession(); } catch { return { status: "auth-required" }; }
    if (!online()) return { status: "offline" };
    if (!locks?.request) return { status: "unsupported-locks" };
    return locks.request(`keeptimer-personal:${session.userId}:${session.workspaceId}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) return { status: "busy" };
      try {
        session.assertCurrent();
        if (api.ensureReady) await api.ensureReady(session);
        session.assertCurrent();
        return await work(session);
      }
      catch (error) {
        if (error.code === "session-changed") return { status: "session-changed" };
        throw error;
      }
    });
  }
  function proofFor(snapshot, timerId, session) {
    const active = snapshot?.timers?.find(row => row.id === timerId);
    const terminal = snapshot?.tombstones?.find(row => row.id === timerId);
    if (active && terminal) throw Error("Ambiguous snapshot");
    if (active) { validateServerTimer(active, session); return { kind: "active", timer: active }; }
    if (terminal) { validatePersonalTombstone(terminal, session); return { kind: "terminal", timer: terminal }; }
    return null; // Absence never proves deletion.
  }
  return {
    flush() {
      return inSessionLock(async (session) => {
        const queued = await listPersonalOutbox(session);
        session.assertCurrent();
        const result = { status: "done", acknowledged: 0, resolvedDeletes: 0, blocked: [], deferred: [] };
        // Old/unknown 403s remain fail-closed until an explicit, scoped review.
        if (queued.some(op => op.status === "forbidden" && op.error?.code !== "PERSONAL_TIMER_FORBIDDEN"))
          return { ...result, status: "forbidden" };
        let snapshotTask;
        const snapshot = () => snapshotTask ??= (async () => {
          const value = api.snapshot ? await api.snapshot(session) : { timers: await api.list(session), tombstones: [] };
          session.assertCurrent(); return value;
        })();
        async function reconcile(op) {
          if (op.reconcileAt > now()) return false;
          await deferPersonalReconciliation(op, session.assertCurrent, now() + 60000);
          let data;
          try { data = await snapshot(); } catch { session.assertCurrent(); return false; }
          session.assertCurrent();
          const local = await timerDb.timers.get(op.timerId);
          session.assertCurrent();
          const proof = proofFor(data, op.timerId, session);
          if (op.method === "PUT" && op.body && proof?.kind === "active") {
            const ack = { success: true, duplicate: true, created: false, timer: proof.timer };
            let valid = false;
            try { validatePersonalOperation(op, local, session); validateAcknowledgement(ack, op); valid = true; } catch { /* Real conflict. */ }
            if (valid) {
              await acknowledgePersonalOperation(op, ack, session.assertCurrent);
              result.acknowledged++; return true;
            }
          }
          if (local?.syncDeleted && proof?.kind === "terminal" &&
              await reconcileAlreadyDeletedPersonalTimer(op, proof.timer, session, session.assertCurrent)) {
            result.resolvedDeletes++; return true;
          }
          await markPersonalOperation(op, "conflict", op.error, session.assertCurrent, now(),
            proof ? { ...proof, expectedRevision: op.expectedRevision } : { kind: "absent-from-active-list" });
          return false;
        }
        const stopped = new Set();
        for (const row of queued) {
          session.assertCurrent();
          if (stopped.has(row.timerId)) continue;
          if (row.status === "conflict" && row.error?.httpStatus === 404 && row.error?.code === "http-error") {
            // Pre-fix clients persisted untyped proxy 404s as permanent conflicts.
            // Reclassify only; preserve the frozen body and mutation identity.
            await markPersonalOperation(row, "retry", row.error, session.assertCurrent, now());
            stopped.add(row.timerId); result.deferred.push(row.timerId); continue;
          }
          if (row.status === "conflict" && await reconcile(row)) {
            stopped.add(row.timerId); continue;
          }
          if (["conflict", "error", "forbidden"].includes(row.status)) {
            result.blocked.push({ timerId: row.timerId, status: row.status });
            stopped.add(row.timerId); continue;
          }
          let op;
          try { op = await preparePersonalOperation(row.seq, session, session.assertCurrent, now()); }
          catch (error) {
            session.assertCurrent();
            if (error.code !== "invalid-operation") throw error;
            await markPersonalOperation(row, "error", { code: "invalid-operation", httpStatus: 0 }, session.assertCurrent, now());
            result.blocked.push({ timerId: row.timerId, status: "error" }); stopped.add(row.timerId); continue;
          }
          session.assertCurrent();
          if (!op) { stopped.add(row.timerId); result.deferred.push(row.timerId); continue; }
          let data;
          try { data = await api.mutate(session, op); session.assertCurrent(); }
          catch (error) {
            session.assertCurrent();
            const status = error.status;
            const state = status === 409 || (status === 404 && error.code === "PERSONAL_TIMER_NOT_FOUND") ? "conflict" :
              status === 400 || error.code === "invalid-operation" ? "error" :
              status === 403 ? "forbidden" : status === 401 ? "auth-required" : "retry";
            const metadata = { code: error.code || "network", httpStatus: status || 0 };
            await markPersonalOperation(op, state, metadata, session.assertCurrent, now());
            session.assertCurrent();
            if (state === "conflict" && await reconcile({ ...op, status: state, error: metadata })) {
              stopped.add(op.timerId); continue;
            }
            result.blocked.push({ timerId: op.timerId, status: state }); stopped.add(op.timerId);
            // Network, service-wide throttling/unavailability and auth stop the batch.
            if (state === "auth-required" || (state === "forbidden" && error.code !== "PERSONAL_TIMER_FORBIDDEN") ||
                (state === "retry" && (!status || [429, 502, 503, 504].includes(status))))
              return { ...result, status: state };
            continue;
          }
          // A storage failure is not a transport error. Retry the unchanged request.
          await acknowledgePersonalOperation(op, data, session.assertCurrent);
          session.assertCurrent(); result.acknowledged++;
        }
        return result;
      });
    },
    pull() {
      return inSessionLock(async (session) => {
        const snapshot = api.snapshot ? await api.snapshot(session) : { timers: await api.list(session), tombstones: [] };
        session.assertCurrent();
        const result = await importPersonalSnapshot(snapshot.timers, session, session.assertCurrent, snapshot.tombstones);
        session.assertCurrent(); return { status: "done", ...result };
      });
    },
    review(timerId) {
      return inSessionLock(async session => {
        const state = await readPersonalResolution(timerId, session, session.assertCurrent);
        if (!state.rows.length || !["conflict", "error", "forbidden"].includes(state.rows[0].status)) return { status: "unavailable" };
        const proof = proofFor(await api.snapshot(session), timerId, session);
        session.assertCurrent();
        if (!proof || proof.timer.sync_revision < state.local.syncRevision) return { status: "unavailable" };
        const review = { status: "review", timerId, name: state.local.name, kind: proof.kind,
          serverName: proof.timer.name, revision: proof.timer.sync_revision };
        reviews.set(review, { timerId, fingerprint: state.fingerprint, proof: JSON.stringify(proof), session });
        return review;
      });
    },
    acceptServer(review) {
      return inSessionLock(async session => {
        const saved = reviews.get(review);
        if (!saved) throw Error("Resolution changed; review again");
        saved.session.assertCurrent(); session.assertCurrent();
        const proof = proofFor(await api.snapshot(session), saved.timerId, session);
        saved.session.assertCurrent(); session.assertCurrent();
        if (!proof || JSON.stringify(proof) !== saved.proof) throw Error("Server changed; review again");
        await acceptPersonalServer(saved, proof, session, () => { saved.session.assertCurrent(); session.assertCurrent(); });
        reviews.delete(review); return { status: "resolved" };
      });
    },
  };
}
