export const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  other: "00000000-0000-4000-8000-000000000002",
  workspace: "00000000-0000-4000-8000-000000000003",
  otherWorkspace: "00000000-0000-4000-8000-000000000004",
  timer: "00000000-0000-4000-8000-000000000005",
  second: "00000000-0000-4000-8000-000000000006",
};
export const scope = { userId: ids.user, workspaceId: ids.workspace };
export const timer = (changes = {}) => ({
  id: ids.timer, ...scope, name: "Work", dataMode: "workspace-personal", isShared: false,
  type: "up", targetMinutes: 5, isPay: false, status: "idle", startTime: null,
  accumulatedTime: 0, pausedCount: 0, ...changes,
});
export const serverTimer = (changes = {}) => ({
  id: ids.timer, user_id: ids.user, workspace_id: ids.workspace, is_shared: false,
  archived_at: null, record_status: "active", name: "Work", type: "up", target_minutes: 5,
  is_pay: false, status: "idle", ends_at: null, ended_at: null, duration_ms: null,
  accumulated_ms: 0, paused_count: 0, sync_revision: 1,
  last_sync_mutation_id: "00000000-0000-4000-8000-000000000007", ...changes,
});
export function fakeAuth() {
  const state = { user: { id: ids.user, workspace_id: ids.workspace }, generation: 1, identity: "session-A", refresh: "refresh-A", current: true, access: "access-A" };
  return {
    state, getUser: () => state.user, getAuthGeneration: () => state.generation,
    getTabSessionIdentity: () => state.identity, isTabSessionCurrent: () => state.current,
    getRefreshToken: () => state.refresh, getAccessToken: () => state.access,
    getTokenSessionIdentity: () => state.identity,
  };
}
export function fakeLocks() {
  const held = new Set();
  return { async request(name, options, callback) {
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name }); } finally { held.delete(name); }
  } };
}
export const response = (status, data) => ({ status, json: async () => data });
export function mockServer() {
  const rows = new Map();
  const requests = [];
  const request = async (url, options) => {
    requests.push({ url, ...options });
    if (options.method === "GET") {
      if (url.includes("syncPage=1")) {
        const after = new URL(url).searchParams.get("after");
        const page = [...rows.values()].filter(row => !after || row.id > after).sort((a,b) => a.id < b.id ? -1 : 1).slice(0, 200);
        return response(200, { timers: page.filter(row => row.record_status === "active" && !row.archived_at),
          tombstones: page.filter(row => row.record_status === "deleted" || row.archived_at), nextCursor: page.at(-1)?.id ?? null });
      }
      return response(200, { timers: [...rows.values()].filter((row) => row.record_status === "active") });
    }
    if (url.endsWith("/timer/start") || url.endsWith("/timer/cancel")) return response(200, { success: true });
    const id = url.split("/").at(-1);
    const body = JSON.parse(options.body);
    const old = rows.get(id);
    if (old?.last_sync_mutation_id === body.mutationId) return response(200, { success: true, created: false, duplicate: true, timer: old });
    if ((old?.sync_revision ?? 0) !== body.expectedRevision) return response(409, {});
    if (options.method === "DELETE" && !old) return response(404, {});
    const row = options.method === "DELETE" ? { ...old, record_status: "deleted" } : serverTimer({
      id, name: body.name, type: body.type, target_minutes: body.targetMinutes,
      is_pay: body.isPay, status: body.status, ends_at: body.endsAt, ended_at: body.endedAt,
      duration_ms: body.durationMs, accumulated_ms: body.accumulatedMs, paused_count: body.pausedCount,
    });
    row.sync_revision = body.expectedRevision + 1;
    row.last_sync_mutation_id = body.mutationId;
    rows.set(id, row);
    return response(old ? 200 : 201, { success: true, created: !old, duplicate: false, timer: row });
  };
  return { rows, requests, request };
}
export function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
