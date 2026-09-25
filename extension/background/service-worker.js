/**
 * Service worker: the only place that drives the tracker.
 *
 * Every listener funnels into `reconcile()`, which compares stored state with
 * what the browser is really doing. That is what makes the tracker survive the
 * worker being torn down mid-session — the thing that quietly breaks most
 * Manifest V3 time trackers.
 */

import { ALARMS, TRACKING } from '../src/config.js';
import { flush, isPaused, reconcile, stop, STOP_REASONS } from '../src/platform/tracker.js';
import {
  clearCurrent,
  getInstall,
  getSettings,
  loadState,
  patchSettings,
  setInstall,
} from '../src/platform/store.js';
import { deactivateLicense, activateLicense, reverifyIfDue } from '../src/platform/license.js';
import { todaySummary } from '../src/platform/queries.js';
import { deleteAllVisits, pruneBefore } from '../src/platform/db.js';
import { planFor } from '../src/core/plan.js';
import { formatDecimalHours } from '../src/core/format.js';
import { DAY_MS, localDayOfWeek } from '../src/core/time.js';
import { MSG } from '../src/platform/messages.js';

const DASHBOARD_URL = 'src/ui/dashboard/dashboard.html';

// ----------------------------------------------------------------- lifecycle

chrome.runtime.onInstalled.addListener(async (details) => {
  await ensureAlarms();
  await applyIdleThreshold();

  if (details.reason === 'install') {
    await setInstall({ installedAt: Date.now(), version: chrome.runtime.getManifest().version });
    await chrome.tabs.create({ url: chrome.runtime.getURL(`${DASHBOARD_URL}#welcome`) });
  } else if (details.reason === 'update') {
    const install = (await getInstall()) || {};
    await setInstall({ ...install, version: chrome.runtime.getManifest().version, updatedAt: Date.now() });
  }

  await reconcile({ reason: 'installed' });
  await refreshBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarms();
  await applyIdleThreshold();
  // A browser restart means any segment we held is stale by definition.
  await reconcile({ reason: 'startup' });
  await refreshBadge();
});

async function ensureAlarms() {
  await chrome.alarms.create(ALARMS.heartbeat, {
    periodInMinutes: TRACKING.heartbeatMinutes,
    delayInMinutes: TRACKING.heartbeatMinutes,
  });
  await chrome.alarms.create(ALARMS.maintenance, {
    periodInMinutes: TRACKING.maintenanceMinutes,
    delayInMinutes: 2,
  });
}

async function applyIdleThreshold() {
  const settings = await getSettings();
  const seconds = Math.max(15, Number(settings.tracking.idleSeconds) || 120);
  try {
    chrome.idle.setDetectionInterval(seconds);
  } catch {
    /* older Chrome; queryState still works */
  }
}

// ----------------------------------------------------------------- tracking events

chrome.tabs.onActivated.addListener(() => reconcileAndPaint('tab-activated'));

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!tab?.active) return;
  if (changeInfo.url === undefined && changeInfo.title === undefined && changeInfo.status !== 'complete') return;
  reconcileAndPaint('tab-updated');
});

chrome.tabs.onRemoved.addListener(() => reconcileAndPaint('tab-removed'));

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await stop(STOP_REASONS.unfocused);
    await refreshBadge();
    return;
  }
  await reconcileAndPaint('window-focus');
});

chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === 'active') await reconcileAndPaint('idle-active');
  else {
    await stop(STOP_REASONS.idle);
    await refreshBadge();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARMS.heartbeat) {
    await reconcileAndPaint('heartbeat');
    return;
  }
  if (alarm.name === ALARMS.maintenance) {
    await runMaintenance();
    return;
  }
  if (alarm.name === ALARMS.weeklyReview) {
    await sendWeeklyReviewNudge();
  }
});

// Settings changed in a page: re-arm anything the worker derives from them.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    await applyIdleThreshold();
    await scheduleWeeklyReview();
    await reconcileAndPaint('settings-changed');
  } else if (changes.rules || changes.clients || changes.license) {
    await refreshBadge();
  }
});

async function reconcileAndPaint(reason) {
  try {
    await reconcile({ reason });
  } catch (error) {
    console.error('[billed] reconcile failed', reason, error);
  }
  await refreshBadge();
}

// ----------------------------------------------------------------- badge

/**
 * The badge is the retention mechanism: a passive tracker nobody sees is a
 * tracker that gets uninstalled. It shows today's billable hours, and turns
 * amber when a meaningful chunk of the day is still unassigned.
 */
async function refreshBadge() {
  try {
    const settings = await getSettings();
    if (!settings.tracking.enabled) return paintBadge('off', '#64748b');
    if (isPaused(settings)) return paintBadge('⏸', '#f59e0b');

    const summary = await todaySummary();
    if (summary.billableSeconds < 60 && summary.trackedSeconds < 60) return paintBadge('', '#0b1220');

    const hours = formatDecimalHours(summary.billableSeconds || summary.trackedSeconds, 1);
    const needsReview = summary.unassignedSeconds > 15 * 60;
    return paintBadge(hours, needsReview ? '#f59e0b' : '#16a34a');
  } catch (error) {
    console.error('[billed] badge failed', error);
    return undefined;
  }
}

function paintBadge(text, color) {
  chrome.action.setBadgeText({ text: String(text) });
  chrome.action.setBadgeBackgroundColor({ color });
}

// ----------------------------------------------------------------- maintenance

async function runMaintenance() {
  try {
    const state = await loadState();
    const days = Number(state.settings.privacy.retentionDays) || 0;
    if (days > 0) await pruneBefore(Date.now() - days * DAY_MS);
    await reverifyIfDue();
    await scheduleWeeklyReview();
  } catch (error) {
    console.error('[billed] maintenance failed', error);
  }
  await refreshBadge();
}

/** Friday-afternoon nudge — the moment the whole product exists for. */
async function scheduleWeeklyReview() {
  const state = await loadState();
  const enabled = state.settings.reminders.weeklyReview && planFor(state.license) === 'pro';
  if (!enabled) {
    await chrome.alarms.clear(ALARMS.weeklyReview);
    return;
  }
  if (!(await chrome.permissions.contains({ permissions: ['notifications'] }))) return;

  const when = nextReminderInstant(state.settings.reminders, Date.now());
  await chrome.alarms.create(ALARMS.weeklyReview, { when });
}

/** Next occurrence of the configured weekday and hour, in local time. */
export function nextReminderInstant(reminders, now) {
  const target = new Date(now);
  target.setHours(Number(reminders.hour) || 16, 0, 0, 0);
  const wantedDay = Number(reminders.dayOfWeek) ?? 5;
  let delta = (wantedDay - localDayOfWeek(target.getTime()) + 7) % 7;
  if (delta === 0 && target.getTime() <= now) delta = 7;
  return target.getTime() + delta * DAY_MS;
}

async function sendWeeklyReviewNudge() {
  try {
    if (!(await chrome.permissions.contains({ permissions: ['notifications'] }))) return;
    await flush();
    const summary = await todaySummary();
    const hours = formatDecimalHours(summary.billableSeconds, 1);
    const unassigned = formatDecimalHours(summary.unassignedSeconds, 1);

    chrome.notifications.create('billed:weekly', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
      title: 'Review your week in Billed',
      message: summary.unassignedSeconds > 300
        ? `${hours} h billable so far, and ${unassigned} h still unassigned. Two minutes now beats guessing later.`
        : `${hours} h billable today. Export your timesheet before you close the laptop.`,
      priority: 1,
    });
  } catch (error) {
    console.error('[billed] reminder failed', error);
  }
  await scheduleWeeklyReview();
}

/**
 * `chrome.notifications` only exists once the optional permission is granted, and
 * the worker may have started before that happened — so registration is retried
 * when a permission is added rather than only at startup.
 */
let notificationClicksWired = false;

function wireNotificationClicks() {
  if (notificationClicksWired || !chrome.notifications?.onClicked) return;
  notificationClicksWired = true;
  chrome.notifications.onClicked.addListener(async (id) => {
    if (id !== 'billed:weekly') return;
    chrome.notifications.clear(id);
    await openDashboard();
  });
}

chrome.permissions.onAdded.addListener(() => wireNotificationClicks());
wireNotificationClicks();

async function openDashboard(hash = '') {
  const url = chrome.runtime.getURL(`${DASHBOARD_URL}${hash}`);
  const existing = await chrome.tabs.query({ url: chrome.runtime.getURL(`${DASHBOARD_URL}*`) });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true, url });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

// ----------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  handleMessage(message)
    .then((result) => respond({ ok: true, ...result }))
    .catch((error) => {
      console.error('[billed] message failed', message?.type, error);
      respond({ ok: false, error: String(error?.message || error) });
    });
  return true; // async response
});

async function handleMessage(message) {
  switch (message?.type) {
    case MSG.flush: {
      const current = await flush();
      return { current };
    }

    case MSG.reconcile: {
      await reconcileAndPaint('requested');
      return {};
    }

    case MSG.status: {
      await flush();
      const summary = await todaySummary();
      return { summary };
    }

    case MSG.pause: {
      const minutes = Number(message.minutes) || 60;
      await patchSettings('tracking', { pausedUntil: Date.now() + minutes * 60_000 });
      await stop(STOP_REASONS.paused);
      await refreshBadge();
      return { pausedUntil: Date.now() + minutes * 60_000 };
    }

    case MSG.resume: {
      await patchSettings('tracking', { pausedUntil: 0 });
      await reconcileAndPaint('resumed');
      return {};
    }

    case MSG.activateLicense: {
      const result = await activateLicense(message.key, { interactive: true });
      await scheduleWeeklyReview();
      await refreshBadge();
      return result;
    }

    case MSG.deactivateLicense: {
      const license = await deactivateLicense();
      await refreshBadge();
      return { license };
    }

    case MSG.enableReminders: {
      const granted = await chrome.permissions.request({ permissions: ['notifications'] });
      if (granted) {
        await patchSettings('reminders', { weeklyReview: true });
        await scheduleWeeklyReview();
      }
      return { granted };
    }

    case MSG.refreshBadge: {
      await refreshBadge();
      return {};
    }

    case MSG.wipe: {
      await clearCurrent();
      await deleteAllVisits();
      await refreshBadge();
      return {};
    }

    default:
      return { ok: false, error: `unknown message: ${message?.type}` };
  }
}
