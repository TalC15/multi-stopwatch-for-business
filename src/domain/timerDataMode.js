export const TIMER_DATA_MODE = Object.freeze({
  STANDALONE: "standalone",
  WORKSPACE_PERSONAL: "workspace-personal",
  SHARED: "shared",
});

function validId(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function deriveTimerDataMode({ workspaceId = null, isShared = false }) {
  if (workspaceId !== null && !validId(workspaceId)) {
    throw new Error("Invalid workspace ID");
  }
  if (typeof isShared !== "boolean") throw new Error("Invalid shared flag");
  if (isShared && workspaceId === null) {
    throw new Error("A shared timer requires an active workspace");
  }
  if (workspaceId === null) return TIMER_DATA_MODE.STANDALONE;
  return isShared ? TIMER_DATA_MODE.SHARED : TIMER_DATA_MODE.WORKSPACE_PERSONAL;
}

export function getNewTimerContext(user, isShared = false) {
  const workspaceId = user?.workspace_id ?? null;
  const dataMode = deriveTimerDataMode({ workspaceId, isShared });
  if (workspaceId !== null && !validId(user?.id)) {
    throw new Error("A workspace timer requires an authenticated creator");
  }

  return {
    dataMode,
    workspaceId,
    // For company data this is the creator/owner, never the current viewer.
    userId: workspaceId === null ? null : user.id,
  };
}

export function getTimerDataMode(timer) {
  if (!timer || !Object.values(TIMER_DATA_MODE).includes(timer.dataMode)) {
    throw new Error("Timer must have an explicit data mode");
  }
  if (!("workspaceId" in timer) || !("userId" in timer)) {
    throw new Error("Timer ownership context is required");
  }
  if (typeof timer.isShared !== "boolean") {
    throw new Error("Timer shared flag is required");
  }
  const actual = deriveTimerDataMode({
    workspaceId: timer.workspaceId,
    isShared: timer.isShared,
  });
  if (timer.dataMode !== actual) {
    throw new Error("Timer data mode conflicts with its workspace or shared flag");
  }
  if (actual === TIMER_DATA_MODE.STANDALONE) {
    if (timer.userId !== null || timer.workspaceId !== null) {
      throw new Error("Standalone timer must have no account or workspace owner");
    }
  } else if (!validId(timer.userId)) {
    throw new Error("Company timer must have a creator/owner ID");
  }
  return actual;
}
