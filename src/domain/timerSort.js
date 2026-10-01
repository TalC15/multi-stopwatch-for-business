export const TIMER_SORT = Object.freeze({ NEAREST: 'nearest', FARTHEST: 'farthest' });
export const normalizeTimerSort = value => value === TIMER_SORT.FARTHEST ? TIMER_SORT.FARTHEST : TIMER_SORT.NEAREST;
const nonNegative = value => Number.isFinite(value) && value >= 0;

// Read the controller's display values. In particular, shared timers already use
// the server clock; sorting must never recompute them with this device's Date.now().
function rank(timer, index) {
  const entry = { timer, index, id: typeof timer?.id === 'string' ? timer.id : '', group: 2, remaining: 0 };
  if (!timer || !['up', 'down'].includes(timer.type)) return entry;
  if (['completed', 'expired'].includes(timer.status) || timer.reachedTarget === true) {
    entry.group = 0;
    return entry;
  }
  if (!['running', 'paused', 'idle'].includes(timer.status)) return entry;
  if (!Number.isFinite(timer.targetMinutes) || timer.targetMinutes <= 0) return entry;
  const target = timer.targetMinutes * 60000;
  if (!Number.isFinite(target)) return entry;
  let remaining;
  if (timer.type === 'down' && timer.remaining != null) {
    if (!nonNegative(timer.remaining)) return entry;
    remaining = timer.remaining;
  } else {
    const elapsed = timer.elapsed ?? (timer.status !== 'running' ? timer.accumulatedTime : undefined);
    if (!nonNegative(elapsed)) return entry;
    remaining = Math.max(0, target - elapsed);
  }
  entry.group = remaining === 0 ? 0 : 1;
  entry.remaining = remaining;
  return entry;
}

// Pure view ordering: no mutation of the source array, records or persisted state.
// A previously sorted view can be reused in O(n) as time advances. Only actual
// order/membership changes require O(n log n) sorting and a new rendered array.
export function sortTimers(timers, direction = TIMER_SORT.NEAREST, previous) {
  const sign = normalizeTimerSort(direction) === TIMER_SORT.FARTHEST ? -1 : 1;
  const entries = timers.map(rank);
  const compare = (a, b) => {
    // Unknown/corrupt timing data is always last, including in reverse mode.
    if ((a.group === 2) !== (b.group === 2)) return a.group === 2 ? 1 : -1;
    const priority = a.group - b.group || a.remaining - b.remaining;
    if (priority) return sign * priority;
    // Equal times retain a deterministic identity order in either direction.
    return (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || a.index - b.index;
  };
  if (previous?.length === entries.length) {
    const byTimer = new Map(entries.map(entry => [entry.timer, entry]));
    if (byTimer.size === entries.length) {
      const seen = new Set();
      let last, ordered = true;
      for (const timer of previous) {
        const entry = byTimer.get(timer);
        if (!entry || seen.has(timer) || (last && compare(last, entry) > 0)) { ordered = false; break; }
        seen.add(timer);
        last = entry;
      }
      if (ordered) return previous;
    }
  }
  return entries.sort(compare).map(entry => entry.timer);
}
