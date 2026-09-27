// Display is derived from the durable anchor. Rendering never advances persisted time.
export function elapsedAt(timer, now) {
  return Math.max(0, Number(timer.accumulatedTime || 0) +
    (timer.status === "running" && Number.isFinite(timer.startTime) ? now - timer.startTime : 0));
}
export function displayTimer(timer, now) {
  const elapsed = elapsedAt(timer, now);
  const total = timer.targetMinutes * 60000;
  return { ...timer, status: timer.status === "completed" ? "expired" : timer.status,
    elapsed: timer.type === "down" ? Math.min(total, elapsed) : elapsed,
    remaining: timer.type === "down" ? Math.max(0, total - elapsed) : null };
}
export function thresholdState(timer, now) {
  if (timer.status !== "running" || (timer.type === "up" && timer.reachedTarget) || elapsedAt(timer, now) < timer.targetMinutes * 60000) return null;
  if (timer.type === "up") return { ...timer, reachedTarget: true };
  const total = Math.trunc(timer.targetMinutes * 60000);
  return { ...timer, status: "completed", accumulatedTime: total, startTime: null,
    reachedTarget: true, elapsed: total, remaining: 0, durationMs: total,
    endedAt: new Date(timer.startTime + total - timer.accumulatedTime).toISOString() };
}

export function sharedTargetReached(timer, now) {
  const target = timer.targetMinutes * 60000;
  return timer.dataMode === "shared" && target > 0 &&
    (timer.type === "down" && ["expired", "completed"].includes(timer.status) ||
      elapsedAt(timer, now) >= target);
}

export function sharedFromServer(row, now) {
  const total = Number(row.target_minutes || 0) * 60000;
  const accumulated = Number(row.accumulated_ms || 0);
  const completed = row.type === "down" && (row.status === "completed" ||
    (row.status === "running" && row.ends_at && Date.parse(row.ends_at) <= now));
  const running = row.status === "running" && !completed;
  const elapsed = running && row.ends_at ? Math.max(0, total - (Date.parse(row.ends_at) - now)) : completed ? total : accumulated;
  return displayTimer({ id: row.id, dataMode: "shared", userId: row.user_id ?? row.created_by,
    workspaceId: row.workspace_id, isShared: true, name: row.name, type: row.type,
    targetMinutes: Number(row.target_minutes), isPay: Boolean(row.is_pay),
    status: completed ? "expired" : running ? "running" : row.status,
    startTime: running ? now : null, accumulatedTime: elapsed,
    reachedTarget: completed || elapsed >= total, pausedCount: Number(row.paused_count || 0),
    // Server time and this device's alarm receipt are separate facts.
    sharedAlarmDelivered: false,
  }, now);
}
