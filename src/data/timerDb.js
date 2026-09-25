import Dexie from "dexie";

export const timerDb = new Dexie("keeptimer-data");

// Versioned schema. The persistent outbox will be added with a later version.
timerDb.version(1).stores({
  timers: "id, dataMode, [userId+workspaceId], workspaceId",
});
