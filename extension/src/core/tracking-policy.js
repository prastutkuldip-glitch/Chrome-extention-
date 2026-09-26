/**
 * The tracking decision, as a pure function.
 *
 * This is the highest-risk logic in Billed: it decides whether an hour is
 * recorded, discarded, or — worst of all — invented. It is deliberately kept
 * free of Chrome APIs so every branch can be tested directly, and so the
 * service worker is left with nothing to do but carry out the verdict.
 */

export const ACTIONS = {
  /** Nothing open, nothing to do. */
  none: 'none',
  /** A segment survived the worker's death: close it at its last heartbeat. */
  closeStale: 'close-stale',
  /** Close the open segment at `closeAt`. */
  stop: 'stop',
  /** Same page still in front: push the end forward. */
  extend: 'extend',
  /** Different page: close the old segment and open a new one. */
  switch: 'switch',
  /** Nothing open, something trackable in front: open a segment. */
  start: 'start',
};

export const REASONS = {
  stale: 'worker-restarted',
  disabled: 'tracking-off',
  paused: 'paused',
  idle: 'idle',
  untrackable: 'not-a-web-page',
  blocked: 'blocked-by-privacy-list',
  unfocused: 'window-unfocused',
};

/**
 * @param {{
 *   current: { start: number, lastSeenAt: number, hostname: string, path: string }|null,
 *   now: number,
 *   trackingEnabled: boolean,
 *   pausedUntil?: number,
 *   idleState?: 'active'|'idle'|'locked',
 *   visit: { ok: boolean, reason?: string, hostname?: string, path?: string, title?: string }|null,
 *   staleMs?: number
 * }} input
 * @returns {{ action: string, reason?: string, closeAt?: number }}
 */
export function decide(input) {
  const {
    current = null,
    now,
    trackingEnabled = true,
    pausedUntil = 0,
    idleState = 'active',
    visit = null,
    staleMs = 180_000,
  } = input;

  // 1. Repair before anything else. A segment whose worker died must be closed
  //    at the last moment we can actually vouch for, never at "now" — that is
  //    how a tracker quietly bills a lunch break.
  if (current && now - current.lastSeenAt > staleMs) {
    return { action: ACTIONS.closeStale, closeAt: current.lastSeenAt, reason: REASONS.stale };
  }

  const stopWith = (reason, closeAt = now) => (
    current ? { action: ACTIONS.stop, reason, closeAt: clamp(current, closeAt) } : { action: ACTIONS.none, reason }
  );

  if (!trackingEnabled) return stopWith(REASONS.disabled);
  if (pausedUntil > now) return stopWith(REASONS.paused);

  // 2. Away from the keyboard. Close at the last confirmed heartbeat, because
  //    the idle event only tells us the user *has* gone, not when.
  if (idleState !== 'active') {
    return stopWith(REASONS.idle, current ? Math.min(now, current.lastSeenAt) : now);
  }

  // 3. Nothing trackable in front of us.
  if (!visit || !visit.ok) {
    const reason = visit?.reason === 'blocked'
      ? REASONS.blocked
      : visit?.reason === 'unfocused'
        ? REASONS.unfocused
        : REASONS.untrackable;
    return stopWith(reason);
  }

  // 4. Same page, or a different one.
  if (current && current.hostname === visit.hostname && current.path === visit.path) {
    return { action: ACTIONS.extend, closeAt: now };
  }
  if (current) return { action: ACTIONS.switch, closeAt: now };
  return { action: ACTIONS.start };
}

/** An end can never precede the start it belongs to. */
function clamp(current, closeAt) {
  return Math.max(current.start, closeAt);
}
