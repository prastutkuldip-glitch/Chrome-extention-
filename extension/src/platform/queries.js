/**
 * Read models shared by the popup, the dashboard and the badge.
 *
 * This is also the single place where the free plan's history window is applied,
 * so there is no way for one surface to leak data another one hides. Note that
 * the data itself is never deleted for free users — the window only limits what
 * is *shown*, so upgrading reveals history that was quietly accumulating all
 * along.
 */

import { buildTimesheet } from '../core/timesheet.js';
import { dayRange, tzOffsetMinutes, weekRange } from '../core/time.js';
import { historyCutoff, planFor } from '../core/plan.js';
import { getVisitsBetween } from './db.js';
import { loadState } from './store.js';

/**
 * @param {{ from: number, to: number }} range
 * @param {{ state?: object, now?: number }} [options]
 */
export async function buildSheetFor(range, options = {}) {
  const now = options.now ?? Date.now();
  const state = options.state ?? await loadState();
  const plan = planFor(state.license, now);
  const cutoff = historyCutoff(plan, now);

  const effective = { from: Math.max(range.from, cutoff), to: range.to };
  const limited = effective.from > range.from;

  const visits = effective.to > effective.from ? await getVisitsBetween(effective.from, effective.to) : [];
  const offsetMin = tzOffsetMinutes(range.from);

  const sheet = buildTimesheet({
    visits,
    rules: state.rules,
    clients: state.clients,
    settings: {
      minSegmentSeconds: state.settings.tracking.minSegmentSeconds,
      mergeGapSeconds: state.settings.tracking.mergeGapSeconds,
      rounding: plan === 'pro' ? state.settings.billing.rounding : { incrementMinutes: 0 },
    },
    range: effective,
    offsetMin,
  });

  return {
    sheet,
    plan,
    state,
    limited,
    requestedRange: range,
    effectiveRange: effective,
    currency: state.settings.billing.currency,
  };
}

/** The current week, honouring the user's week-start preference. */
export async function buildWeekSheet(anchor = Date.now(), options = {}) {
  const state = options.state ?? await loadState();
  const range = weekRange(anchor, {
    weekStartsOn: state.settings.display.weekStartsOn,
    offsetMin: tzOffsetMinutes(anchor),
  });
  return buildSheetFor(range, { ...options, state });
}

/** Today only — what the popup and the toolbar badge show. */
export async function buildTodaySheet(now = Date.now(), options = {}) {
  return buildSheetFor(dayRange(now), { ...options, now });
}

/**
 * Headline numbers for the badge and the popup.
 * `unassignedSeconds` is the honest one: time that exists but would be lost if
 * you invoiced from memory.
 */
export async function todaySummary(now = Date.now(), options = {}) {
  const { sheet, currency, plan } = await buildTodaySheet(now, options);
  return {
    plan,
    currency,
    billableSeconds: sheet.totals.billableSeconds,
    billedSeconds: sheet.totals.roundedBillableSeconds,
    trackedSeconds: sheet.totals.trackedSeconds,
    unassignedSeconds: sheet.totals.unassignedSeconds,
    amount: sheet.totals.amount,
    clientCount: sheet.totals.clientCount,
    topClients: sheet.byClient.slice(0, 3).map((client) => ({
      name: client.name,
      color: client.color,
      seconds: client.seconds,
    })),
    unassigned: sheet.unassigned.slice(0, 5),
  };
}
