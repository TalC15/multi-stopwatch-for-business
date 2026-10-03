import * as backend from "./backendSync.js";

// UI workspace responses can finish reading JSON after apiFetch has returned.
// Retain the original session/scope through that final await before saving user state.
export function captureWorkspaceSession(auth = backend) {
  const user = auth.getUser();
  const userId = user?.id, workspaceId = user?.workspace_id;
  const generation = auth.getAuthGeneration(), identity = auth.getTabSessionIdentity();
  const marker = auth.getSessionMarker();
  const isCurrent = () => {
    const current = auth.getUser();
    return Boolean(userId && identity && auth.isTabSessionCurrent() &&
      auth.getAuthGeneration() === generation && auth.getTabSessionIdentity() === identity &&
      auth.getSessionMarker() === marker && current?.id === userId &&
      current?.workspace_id === workspaceId && !current?.disabled_at);
  };
  return {
    isCurrent,
    saveWorkspace(nextId) {
      if (!isCurrent() || (nextId !== null && (typeof nextId !== "string" || !nextId.trim()))) return false;
      auth.saveUser({ ...auth.getUser(), workspace_id: nextId });
      return true;
    },
  };
}
