import { createPersonalSyncApi } from "./personalSyncApi.js";
import {
  listPersonalOutbox, preparePersonalOperation, acknowledgePersonalOperation,
  markPersonalOperation, importPersonalSnapshot,
} from "./personalOutbox.js";

export function createPersonalSyncEngine({ api = createPersonalSyncApi(), locks = globalThis.navigator?.locks, now = Date.now, online = () => globalThis.navigator?.onLine !== false } = {}) {
  async function inSessionLock(work) {
    let session;
    try { session = api.captureSession(); } catch { return { status: "auth-required" }; }
    if (!online()) return { status: "offline" };
    // No unsafe in-memory fallback: multiple tabs share the same IndexedDB.
    if (!locks?.request) return { status: "unsupported-locks" };
    return locks.request(`keeptimer-personal:${session.userId}:${session.workspaceId}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) return { status: "busy" };
      try {
        session.assertCurrent();
        return await work(session);
      } catch (error) {
        if (error.code === "session-changed") return { status: "session-changed" };
        throw error; // IndexedDB failures must be visible to the caller.
      }
    });
  }

  return {
    flush() {
      return inSessionLock(async (session) => {
        // Finite snapshot: newly queued work waits for the next explicit flush.
        const queued = await listPersonalOutbox(session);
        session.assertCurrent();
        const result = { status: "done", acknowledged: 0, blocked: [], deferred: [] };
        if (queued.some((op) => op.status === "forbidden")) return { ...result, status: "forbidden" };
        const stopped = new Set();
        for (const row of queued) {
          session.assertCurrent();
          if (stopped.has(row.timerId)) continue;
          if (["conflict", "error"].includes(row.status)) {
            result.blocked.push({ timerId: row.timerId, status: row.status });
            stopped.add(row.timerId);
            continue;
          }
          const op = await preparePersonalOperation(row.seq, session, session.assertCurrent, now());
          session.assertCurrent();
          if (!op) { stopped.add(row.timerId); result.deferred.push(row.timerId); continue; }
          let data;
          try {
            data = await api.mutate(session, op);
            session.assertCurrent();
          } catch (error) {
            session.assertCurrent();
            const status = error.status;
            const state = status === 409 || status === 404 ? "conflict" :
              status === 400 || error.code === "invalid-operation" ? "error" :
              status === 403 ? "forbidden" : status === 401 ? "auth-required" : "retry";
            await markPersonalOperation(op, state, { code: error.code || "network", httpStatus: status || 0 }, session.assertCurrent, now());
            session.assertCurrent();
            if (state === "conflict") {
              // Evidence only, never rebase or acknowledge based on a GET snapshot.
              let server = { kind: "unavailable" };
              try {
                const rows = await api.list(session);
                session.assertCurrent();
                const found = rows.find((item) => item.id === op.timerId);
                server = found ? { kind: "active", timer: found, expectedRevision: op.expectedRevision } : { kind: "absent-from-active-list" };
              } catch { session.assertCurrent(); }
              await markPersonalOperation(op, state, { code: error.code || "http-error", httpStatus: status }, session.assertCurrent, now(), server);
              session.assertCurrent();
            }
            result.blocked.push({ timerId: op.timerId, status: state });
            stopped.add(op.timerId);
            if (["auth-required", "forbidden", "retry"].includes(state)) return { ...result, status: state };
            continue;
          }
          // Separate from transport catch: a failed local ack leaves the SAME request pending.
          await acknowledgePersonalOperation(op, data, session.assertCurrent);
          session.assertCurrent();
          result.acknowledged += 1;
        }
        return result;
      });
    },
    pull() {
      return inSessionLock(async (session) => {
        const rows = await api.list(session);
        session.assertCurrent();
        const result = await importPersonalSnapshot(rows, session, session.assertCurrent);
        session.assertCurrent();
        return { status: "done", ...result };
      });
    },
  };
}
