
import {
  getTimerDataMode,
  TIMER_DATA_MODE
} from "../domain/timerDataMode.js";

const hasId = (value) =>
  typeof value === "string" &&
  value.trim().length > 0;

// Yalnızca aktif kullanıcı ve workspace'e ait
// kişisel sayaçlar outbox adayı olabilir.
export function canEnqueuePersonalTimer(timer, context) {
  if (
    !hasId(timer?.id) ||
    !hasId(context?.userId) ||
    !hasId(context?.workspaceId)
  ) {
    return false;
  }

  try {
    return (
      getTimerDataMode(timer) ===
        TIMER_DATA_MODE.WORKSPACE_PERSONAL &&

      timer.isShared === false &&

      timer.userId === context.userId &&

      timer.workspaceId === context.workspaceId
    );
  } catch {
    return false;
  }
}
