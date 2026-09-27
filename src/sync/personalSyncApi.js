import * as backend from "../services/backendSync.js";
import { requireScope, requireUuid, validateServerTimer, validateAcknowledgement, validatePersonalTombstone, requirePersonal, personalStateFromLocal } from "./personalSyncModel.js";

function failure(code, status = 0) {
  return Object.assign(new Error(code), { code, status });
}

// Injection is for mock HTTP/auth tests; production uses the existing refresh/session flow.
export function createPersonalSyncApi({ auth = backend, request = backend.apiFetch, baseUrl = backend.BASE_URL, timeoutMs = 15000 } = {}) {
  function captureSession() {
    const user = auth.getUser();
    const scope = { userId: user?.id, workspaceId: user?.workspace_id };
    requireScope(scope);
    const generation = auth.getAuthGeneration();
    const identity = auth.getTabSessionIdentity();
    const refreshToken = auth.getRefreshToken();
    const assertCurrent = () => {
      const current = auth.getUser();
      if (!identity || !auth.isTabSessionCurrent() || auth.getAuthGeneration() !== generation ||
          auth.getTabSessionIdentity() !== identity || auth.getRefreshToken() !== refreshToken ||
          current?.id !== scope.userId || current?.workspace_id !== scope.workspaceId || current?.disabled_at ||
          !auth.getAccessToken() || auth.getTokenSessionIdentity(auth.getAccessToken(), "access") !== identity) {
        throw failure("session-changed");
      }
    };
    assertCurrent();
    return Object.freeze({ ...scope, assertCurrent });
  }

  async function send(session, path, method, body) {
    session.assertCurrent();
    const controller = new AbortController();
    let timeout;
    try {
      return await Promise.race([
        (async () => {
          session.assertCurrent();
          const response = await request(`${baseUrl}${path}`, {
            method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.getAccessToken()}` },
            ...(body === undefined ? {} : { body }), signal: controller.signal,
            isRequestCurrent: () => {
              if (controller.signal.aborted) return false;
              try { session.assertCurrent(); return true; } catch { return false; }
            },
          });
          session.assertCurrent();
          if (!response) throw failure("no-response");
          if (![200, 201].includes(response.status)) throw failure("http-error", response.status);
          let data;
          try { data = await response.json(); } catch { throw failure("unexpected-response"); }
          session.assertCurrent();
          return data;
        })(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => { controller.abort(); reject(failure("timeout")); }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    captureSession,
    async list(session) {
      const data = await send(session, "/timers/personal", "GET");
      session.assertCurrent();
      if (!Array.isArray(data?.timers)) throw failure("unexpected-response");
      try { data.timers.forEach((row) => validateServerTimer(row, session)); }
      catch { throw failure("unexpected-response"); }
      return data.timers;
    },
    async snapshot(session) {
      const timers = [], tombstones = [], seen = new Set();
      let after = null;
      do {
        const data = await send(session, `/timers/personal?syncPage=1${after ? `&after=${after}` : ""}`, "GET");
        session.assertCurrent();
        if (!Array.isArray(data?.timers) || !Array.isArray(data?.tombstones)) throw failure("snapshot-unavailable");
        const rows = [...data.timers, ...data.tombstones].sort((a, b) => a.id < b.id ? -1 : 1);
        try {
          data.timers.forEach(row => validateServerTimer(row, session));
          data.tombstones.forEach(row => validatePersonalTombstone(row, session));
          for (const row of rows) {
            if (seen.has(row.id) || (after && row.id <= after)) throw new Error("Invalid cursor");
            seen.add(row.id);
          }
          if (rows.length ? data.nextCursor !== rows.at(-1).id : data.nextCursor !== null) throw new Error("Invalid next cursor");
        } catch { throw failure("unexpected-response"); }
        timers.push(...data.timers); tombstones.push(...data.tombstones);
        after = data.nextCursor;
      } while (after !== null);
      return { timers, tombstones };
    },
    async syncNotification(session, timer) {
      requirePersonal(timer, session);
      session.assertCurrent();
      const state = timer.syncDeleted ? null : personalStateFromLocal(timer);
      if (state?.status === "running" && Date.parse(state.endsAt) > Date.now()) {
        return send(session, "/timer/start", "POST", JSON.stringify({
          timerId: timer.id, timerName: timer.name, endsAt: Date.parse(state.endsAt),
        }));
      }
      return send(session, "/timer/cancel", "POST", JSON.stringify({ timerId: timer.id }));
    },
    async mutate(session, op) {
      session.assertCurrent();
      requireUuid(op.timerId);
      requireUuid(op.mutationId);
      if (op.userId !== session.userId || op.workspaceId !== session.workspaceId ||
          !["PUT", "DELETE"].includes(op.method) || typeof op.body !== "string") throw failure("invalid-operation");
      // The durable body is the exact wire representation, including all retries.
      const data = await send(session, `/timers/personal/${op.timerId}`, op.method, op.body);
      session.assertCurrent();
      try { validateAcknowledgement(data, op); } catch { throw failure("unexpected-response"); }
      return data;
    },
  };
}
