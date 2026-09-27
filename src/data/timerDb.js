import Dexie from "dexie";

export const timerDb = new Dexie("keeptimer-data");

// Keep v1 so existing installations upgrade without losing timers.
timerDb.version(1).stores({
  timers: "id, dataMode, [userId+workspaceId], workspaceId",
});

timerDb.version(2).stores({
  timers: "id, dataMode, [userId+workspaceId], workspaceId",
  personalOutbox: "++seq, [userId+workspaceId], timerId",
});
