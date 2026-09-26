/**
 * Local-time helpers.
 *
 * Every function takes an explicit timezone offset (minutes east of UTC) so the
 * logic is deterministic and testable. Callers that want "the user's current
 * timezone" pass the result of `tzOffsetMinutes()`.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** Minutes east of UTC for a given instant, e.g. +330 for IST. */
export function tzOffsetMinutes(ts = Date.now()) {
  return -new Date(ts).getTimezoneOffset();
}

/** `YYYY-MM-DD` for an instant, in the given local timezone. */
export function dayKey(ts, offsetMin = tzOffsetMinutes(ts)) {
  return new Date(ts + offsetMin * MINUTE_MS).toISOString().slice(0, 10);
}

/** UTC timestamp of local midnight that starts the given `YYYY-MM-DD`. */
export function dayStart(key, offsetMin = tzOffsetMinutes()) {
  return Date.parse(`${key}T00:00:00.000Z`) - offsetMin * MINUTE_MS;
}

/** UTC timestamp of the local midnight that ends the given `YYYY-MM-DD`. */
export function dayEnd(key, offsetMin = tzOffsetMinutes()) {
  return dayStart(key, offsetMin) + DAY_MS;
}

/** Day-of-week index in local time: 0 = Sunday … 6 = Saturday. */
export function localDayOfWeek(ts, offsetMin = tzOffsetMinutes(ts)) {
  return new Date(ts + offsetMin * MINUTE_MS).getUTCDay();
}

/**
 * Range covering the week that contains `ts`.
 * @param {number} ts
 * @param {{ weekStartsOn?: number, offsetMin?: number }} [opts] weekStartsOn: 0=Sun, 1=Mon
 * @returns {{ from: number, to: number, days: string[] }} `to` is exclusive.
 */
export function weekRange(ts, opts = {}) {
  const { weekStartsOn = 1, offsetMin = tzOffsetMinutes(ts) } = opts;
  const dow = localDayOfWeek(ts, offsetMin);
  const back = (dow - weekStartsOn + 7) % 7;
  const from = dayStart(dayKey(ts, offsetMin), offsetMin) - back * DAY_MS;
  return { from, to: from + 7 * DAY_MS, days: dayKeysBetween(from, from + 7 * DAY_MS, offsetMin) };
}

/** Range covering a single local day. */
export function dayRange(ts, offsetMin = tzOffsetMinutes(ts)) {
  const from = dayStart(dayKey(ts, offsetMin), offsetMin);
  return { from, to: from + DAY_MS, days: [dayKey(ts, offsetMin)] };
}

/**
 * Range covering the calendar month that contains `ts`.
 * Invoices and retainers are usually monthly, so this is what "unlimited history"
 * is actually for.
 */
export function monthRange(ts, offsetMin = tzOffsetMinutes(ts)) {
  const key = dayKey(ts, offsetMin);
  const [year, month] = key.split('-').map(Number);
  const from = dayStart(`${year}-${String(month).padStart(2, '0')}-01`, offsetMin);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const to = dayStart(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01`, offsetMin);
  return { from, to, days: dayKeysBetween(from, to, offsetMin) };
}

/** Shift a month range by whole calendar months. */
export function shiftMonths(range, months, offsetMin = tzOffsetMinutes(range.from)) {
  const key = dayKey(range.from, offsetMin);
  const [year, month] = key.split('-').map(Number);
  const total = (year * 12 + (month - 1)) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (total % 12) + 1;
  const anchor = dayStart(`${targetYear}-${String(targetMonth).padStart(2, '0')}-01`, offsetMin);
  return monthRange(anchor + HOUR_MS, offsetMin);
}

/** `September 2026` */
export function monthLabel(ts, offsetMin = tzOffsetMinutes(ts)) {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const key = dayKey(ts, offsetMin);
  const [year, month] = key.split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

/** Every `YYYY-MM-DD` touched by `[from, to)`. */
export function dayKeysBetween(from, to, offsetMin = tzOffsetMinutes(from)) {
  const keys = [];
  let cursor = dayStart(dayKey(from, offsetMin), offsetMin);
  while (cursor < to) {
    keys.push(dayKey(cursor, offsetMin));
    cursor += DAY_MS;
  }
  return keys;
}

/** Shift a range by whole weeks (negative = earlier). */
export function shiftWeeks(range, weeks, offsetMin = tzOffsetMinutes(range.from)) {
  const from = range.from + weeks * 7 * DAY_MS;
  const to = from + (range.to - range.from);
  return { from, to, days: dayKeysBetween(from, to, offsetMin) };
}
