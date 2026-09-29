// Paste into the affected app/WebView's DevTools console. Read-only; no HTTP,
// localStorage, tokens, names, UUIDs or mutation bodies are logged.
(async () => {
  const names = await indexedDB.databases();
  if (!names.some(db => db.name === "keeptimer-data")) {
    console.info("KeepTimer diagnostic: existing database not found; nothing opened."); return [];
  }
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("keeptimer-data");
    request.onupgradeneeded = () => { request.transaction.abort(); };
    request.onerror = () => reject(new Error("Existing database unavailable; no changes made."));
    request.onsuccess = () => resolve(request.result);
  });
  try {
    if (!db.objectStoreNames.contains("personalOutbox") || !db.objectStoreNames.contains("timers")) {
      console.info("KeepTimer diagnostic: expected stores unavailable."); return [];
    }
    const [operations, timers] = await new Promise((resolve, reject) => {
      const tx = db.transaction(["personalOutbox", "timers"], "readonly");
      const outbox = tx.objectStore("personalOutbox").getAll();
      const local = tx.objectStore("timers").getAll();
      tx.oncomplete = () => resolve([outbox.result, local.result]);
      tx.onerror = tx.onabort = () => reject(new Error("Read-only diagnostic could not complete."));
    });
    const aliases = new Map();
    const alias = (kind, value) => {
      if (typeof value !== "string") return "invalid";
      const key = kind + ":" + value;
      if (!aliases.has(key)) aliases.set(key, kind + "-" + (aliases.size + 1));
      return aliases.get(key);
    };
    const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    const member = (value, list) => list.includes(value) ? value : "other";
    const rows = operations.map(op => {
      const local = timers.find(timer => timer.id === op.timerId);
      const owned = local?.dataMode === "workspace-personal" && local.userId === op.userId && local.workspaceId === op.workspaceId && local.isShared === false;
      const server = op.server?.timer;
      return {
        scope: alias("user", op.userId) + "/" + alias("workspace", op.workspaceId), timer: alias("timer", op.timerId),
        seq: number(op.seq), method: member(op.method, ["PUT", "DELETE"]),
        status: member(op.status, ["pending", "sending", "retry", "conflict", "error", "forbidden", "auth-required"]),
        attempts: number(op.attempts), expectedRevision: number(op.expectedRevision), frozen: typeof op.body === "string",
        errorCode: member(op.error?.code, ["http-error", "timeout", "network", "no-response", "unexpected-response", "invalid-operation",
          "PERSONAL_TIMER_NOT_FOUND", "PERSONAL_TIMER_FORBIDDEN", "PERSONAL_WORKSPACE_REQUIRED"]),
        httpStatus: number(op.error?.httpStatus), retryInMs: number(op.retryAt) === null ? null : Math.max(0, op.retryAt - Date.now()),
        serverKind: member(op.server?.kind, ["active", "terminal", "unavailable", "absent-from-active-list"]),
        serverRevision: number(server?.sync_revision), serverMutationMatches: Boolean(server?.last_sync_mutation_id && server.last_sync_mutation_id === op.mutationId),
        localExists: Boolean(local), localMatchesScope: owned,
        syncState: owned ? member(local.syncState, ["pending", "sending", "retry", "conflict", "error", "forbidden", "auth-required", "synced", "deleted"]) : null,
        syncRevision: owned ? number(local.syncRevision) : null, syncDeleted: owned ? local.syncDeleted === true : null,
      };
    });
    console.table(rows); return rows;
  } finally { db.close(); }
})().catch(() => { console.info("KeepTimer diagnostic could not read metadata. No records changed."); });
