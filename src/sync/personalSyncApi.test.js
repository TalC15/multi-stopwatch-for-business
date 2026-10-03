import assert from "node:assert/strict";
import { beforeEach, after, test } from "node:test";
import * as backend from "../services/backendSync.js";
import { createPersonalSyncApi } from "./personalSyncApi.js";
import { personalStateFromLocal } from "./personalSyncModel.js";
import { ids, scope, timer, mockServer, response, deferred } from "./testSupport/fixtures.js";
const originalFetch = globalThis.fetch;
const storage = () => {
  const entries = new Map();
  return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, String(value)), removeItem: (key) => entries.delete(key) };
};
const token = (type, sessionId = "session-one", serial = 1) => `header.${Buffer.from(JSON.stringify({ id: ids.user, sessionId, type, serial })).toString("base64url")}.signature`;
let server, operation;
beforeEach(async () => {
  globalThis.localStorage = storage(); globalThis.sessionStorage = storage(); globalThis.window = new EventTarget();
  sessionStorage.setItem("keeptimer-tab-auth-session", `${ids.user}:session-one`);
  backend.initializeAuthSession();
  globalThis.fetch = async () => ({ ...response(200, {
    accessToken: token("access"), sessionId: "session-one", user: { id: ids.user, workspace_id: ids.workspace },
  }), ok: true });
  assert.equal((await backend.login("test", "test")).success, true);
  server = mockServer();
  const payload = personalStateFromLocal(timer());
  operation = { ...scope, timerId: ids.timer, method: "PUT", mutationId: crypto.randomUUID(), expectedRevision: 0, payload };
  operation.body = JSON.stringify({ dataMode: "workspace-personal", mutationId: operation.mutationId, expectedRevision: 0, ...payload });
});
after(() => { globalThis.fetch = originalFetch; delete globalThis.localStorage; delete globalThis.sessionStorage; delete globalThis.window; delete navigator.locks; });

test("real apiFetch refreshes once and repeats the exact personal body with same-session token", async () => {
  let mutations = 0; let refreshes = 0; const bodies = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/auth/refresh")) { refreshes++; return { ...response(200, { accessToken: token("access", "session-one", 2), sessionId: "session-one" }), ok: true }; }
    bodies.push(options.body); mutations++;
    if (mutations === 1) return response(401, {});
    assert.equal(new Headers(options.headers).get("Authorization"), `Bearer ${token("access", "session-one", 2)}`);
    return server.request(url, options);
  };
  const api = createPersonalSyncApi();
  const data = await api.mutate(api.captureSession(), operation);
  assert.equal(data.timer.sync_revision, 1);
  assert.equal(refreshes, 1); assert.equal(mutations, 2); assert.equal(bodies[0], bodies[1]);
});

test("real apiFetch rejects changed workspace while waiting for auth context lock", async () => {
  let calls = 0;
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name, callback) => {
    backend.saveUser({ id: ids.user, workspace_id: ids.otherWorkspace });
    return callback();
  } } });
  globalThis.fetch = async () => { calls++; return response(200, {}); };
  try {
    const api = createPersonalSyncApi();
    await assert.rejects(api.mutate(api.captureSession(), operation), /session-changed/);
    assert.equal(calls, 0);
  } finally { delete navigator.locks; }
});

test("real apiFetch does not retry mutation after workspace changes during refresh", async () => {
  let mutations = 0;
  globalThis.fetch = async (url) => {
    if (url.endsWith("/auth/refresh")) {
      backend.saveUser({ id: ids.user, workspace_id: ids.otherWorkspace });
      return { ...response(200, { accessToken: token("access", "session-one", 2), sessionId: "session-one" }), ok: true };
    }
    mutations++; return response(401, {});
  };
  const api = createPersonalSyncApi();
  await assert.rejects(api.mutate(api.captureSession(), operation), /session-changed/);
  assert.equal(mutations, 1);
});

test("real apiFetch hard refresh failure clears only current auth", async () => {
  globalThis.fetch = async () => ({ ...response(401, {}), ok: false });
  const api = createPersonalSyncApi();
  await assert.rejects(api.mutate(api.captureSession(), operation), /session-changed/);
  assert.equal(backend.getAccessToken(), null);
  assert.equal(operation.expectedRevision, 0);
});

test("same-account new session cannot receive old HTTP acknowledgement", async () => {
  globalThis.fetch = async (...args) => {
    const result = await server.request(...args);
    localStorage.setItem(backend.AUTH_SESSION_KEY, `${ids.user}:session-two`);
    sessionStorage.setItem("keeptimer-tab-auth-session", `${ids.user}:session-two`);
    return result;
  };
  const api = createPersonalSyncApi();
  await assert.rejects(api.mutate(api.captureSession(), operation), /session-changed/);
});

test("body parsing await is session-guarded, including GET snapshots", async () => {
  globalThis.fetch = async () => ({ status: 200, json: async () => {
    backend.saveUser({ id: ids.user, workspace_id: ids.otherWorkspace });
    return { timers: [] };
  } });
  const api = createPersonalSyncApi();
  await assert.rejects(api.list(api.captureSession()), /session-changed/);
});

test("timeout during existing refresh prevents a late mutation retry", async () => {
  const release = deferred(); const finished = deferred(); let mutations = 0;
  globalThis.fetch = async (url) => {
    if (url.endsWith("/auth/refresh")) {
      await release.promise;
      return { status: 200, ok: true, json: async () => { finished.resolve(); return { accessToken: token("access", "session-one", 2), sessionId: "session-one" }; } };
    }
    mutations++; return response(401, {});
  };
  const api = createPersonalSyncApi({ timeoutMs: 10 });
  await assert.rejects(api.mutate(api.captureSession(), operation), /timeout/);
  release.resolve(); await finished.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mutations, 1);
});

test("DELETE uses flat JSON, validates duplicate revision, GET is read-only", async () => {
  globalThis.fetch = server.request;
  const api = createPersonalSyncApi(); const session = api.captureSession();
  await api.mutate(session, operation);
  const deleting = { ...operation, method: "DELETE", expectedRevision: 1, mutationId: crypto.randomUUID(), payload: null };
  deleting.body = JSON.stringify({ dataMode: "workspace-personal", mutationId: deleting.mutationId, expectedRevision: 1 });
  assert.equal((await api.mutate(session, deleting)).timer.sync_revision, 2);
  assert.equal((await api.mutate(session, deleting)).duplicate, true);
  assert.deepEqual(await api.list(session), []);
  assert.ok(server.requests.every((req) => req.url.includes("/timers/personal")));
  assert.equal(server.requests[1].body, server.requests[2].body);
});

test("Phase 2 already-deleted response can confirm terminal state from another mutation", async () => {
  globalThis.fetch = server.request;
  const api = createPersonalSyncApi(); const session = api.captureSession();
  await api.mutate(session, operation);
  const row = server.rows.get(ids.timer);
  row.record_status = "deleted"; row.sync_revision = 3; row.last_sync_mutation_id = ids.second;
  const deleting = { ...operation, method: "DELETE", expectedRevision: 1, mutationId: crypto.randomUUID(), payload: null };
  deleting.body = JSON.stringify({ dataMode: "workspace-personal", mutationId: deleting.mutationId, expectedRevision: 1 });
  globalThis.fetch = async () => response(200, { success: true, duplicate: false, timer: row });
  assert.equal((await api.mutate(session, deleting)).timer.sync_revision, 3);
  row.sync_revision = 1;
  await assert.rejects(api.mutate(session, deleting), /unexpected-response/);
  row.sync_revision = 3; row.archived_at = "2026-09-26T20:00:00Z";
  await assert.rejects(api.mutate(session, deleting), /unexpected-response/);
});
