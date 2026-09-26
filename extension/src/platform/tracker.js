/**
 * The tracker: the only writer of recorded time.
 *
 * A Manifest V3 service worker can be shut down at any moment, which makes naive
 * "start a timer, stop a timer" tracking lose hours. So the open segment lives in
 * chrome.storage rather than in memory, is written to the database on every
 * heartbeat, and every event funnels through one reconciliation pass that
 * compares stored state against reality.
 *
 * The decision itself lives in `core/tracking-policy.js` as a pure, tested
 * function. This file only carries it out.
 */

import { prepareVisit } from '../core/privacy.js';
import { extractRefs } from '../core/refs.js';
import { createId } from '../core/defaults.js';
import { ACTIONS, decide, REASONS } from '../core/tracking-policy.js';
import { TRACKING } from '../config.js';
import { putVisit } from './db.js';
import { clearCurrent, getCurrent, getSettings, setCurrent } from './store.js';

export { REASONS as STOP_REASONS };

export function isPaused(settings, now = Date.now()) {
  return Number(settings?.tracking?.pausedUntil || 0) > now;
}

export function isTrackingOn(settings, now = Date.now()) {
  return Boolean(settings?.tracking?.enabled) && !isPaused(settings, now);
}

/**
 * The focused, active tab — or null. A minimised or background window still
 * reports an active tab, so window focus is checked explicitly.
 */
async function focusedTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return null;
    if (tab.windowId !== undefined) {
      const win = await chrome.windows.get(tab.windowId).catch(() => null);
      if (win && win.focused === false) return null;
    }
    return tab;
  } catch {
    return null;
  }
}

function queryIdle(seconds) {
  const threshold = Math.max(15, Number(seconds) || 120); // Chrome's floor is 15s
  return new Promise((resolve) => {
    try {
      chrome.idle.queryState(threshold, resolve);
    } catch {
      resolve('active');
    }
  });
}

/** Write the open segment's current extent. Idempotent. */
async function persist(current, end) {
  if (!current || end <= current.start) return;
  await putVisit({
    id: current.id,
    start: current.start,
    end,
    hostname: current.hostname,
    path: current.path,
    title: current.title,
    refs: current.refs,
  });
}

/**
 * Close the open segment.
 * @param {string} reason see {@link REASONS}
 * @param {number} [at] instant to close at, clamped so it can never precede the start.
 */
export async function stop(reason, at = Date.now()) {
  const current = await getCurrent();
  if (!current) return null;
  await persist(current, Math.max(current.start, at));
  await clearCurrent();
  return { ...current, end: at, reason };
}

async function open(visit, now) {
  const current = {
    id: createId('v'),
    start: now,
    lastSeenAt: now,
    hostname: visit.hostname,
    path: visit.path,
    title: visit.title,
    refs: extractRefs(visit.title),
  };
  await setCurrent(current);
  return current;
}

function mergeUnique(a = [], b = [], cap = 8) {
  const out = [...a];
  for (const item of b) if (!out.includes(item)) out.push(item);
  return out.slice(0, cap);
}

/**
 * Compare stored state with reality and repair the difference. Backs every
 * listener and the heartbeat, which is what makes the tracker self-healing:
 * there is no code path that leaves a segment open against a tab the user
 * abandoned twenty minutes ago.
 *
 * @param {{ reason?: string, now?: number }} [options]
 */
export async function reconcile(options = {}) {
  const now = options.now ?? Date.now();
  const settings = await getSettings();
  const current = await getCurrent();

  const tab = isTrackingOn(settings, now) ? await focusedTab() : null;
  const visit = tab?.url
    ? prepareVisit({ url: tab.url, title: tab.title }, {
      ...settings.tracking,
      blocklist: settings.privacy.blocklist,
    })
    : (isTrackingOn(settings, now) ? { ok: false, reason: 'unfocused' } : null);

  const verdict = decide({
    current,
    now,
    trackingEnabled: Boolean(settings.tracking.enabled),
    pausedUntil: Number(settings.tracking.pausedUntil || 0),
    idleState: isTrackingOn(settings, now) ? await queryIdle(settings.tracking.idleSeconds) : 'active',
    visit,
    staleMs: TRACKING.staleSegmentMs,
  });

  switch (verdict.action) {
    case ACTIONS.none:
      return verdict;

    case ACTIONS.closeStale:
    case ACTIONS.stop:
      await persist(current, verdict.closeAt);
      await clearCurrent();
      // A stale segment is only half the story: something may well be in front
      // of the user right now, so decide again with a clean slate.
      return verdict.action === ACTIONS.closeStale
        ? { ...verdict, next: await reconcile({ ...options, now }) }
        : verdict;

    case ACTIONS.extend:
      await persist(current, verdict.closeAt);
      await setCurrent({
        ...current,
        lastSeenAt: verdict.closeAt,
        // Titles change as work progresses — a ticket key appears, a doc is
        // renamed — so keep the newest and accumulate any new references.
        title: visit.title || current.title,
        refs: mergeUnique(current.refs, extractRefs(visit.title)),
      });
      return verdict;

    case ACTIONS.switch:
      await persist(current, verdict.closeAt);
      await clearCurrent();
      await open(visit, now);
      return verdict;

    case ACTIONS.start:
      await open(visit, now);
      return verdict;

    default:
      return verdict;
  }
}

/**
 * Write out the open segment so a UI about to read the database sees time that
 * is accurate to this second rather than to the last heartbeat.
 */
export async function flush(now = Date.now()) {
  const current = await getCurrent();
  if (!current) return null;
  // Never extend past what a heartbeat could have confirmed.
  const end = Math.min(now, current.lastSeenAt + TRACKING.staleSegmentMs);
  await persist(current, end);
  await setCurrent({ ...current, lastSeenAt: Math.max(current.lastSeenAt, Math.min(now, end)) });
  return { ...current, end };
}
