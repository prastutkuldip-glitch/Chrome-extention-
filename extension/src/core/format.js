/**
 * Formatting helpers shared by the popup, the dashboard and every export.
 * Deliberately locale-independent so a timesheet looks the same everywhere.
 */

import { CURRENCIES } from './defaults.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `3h 25m`, `45m`, `—` for nothing. */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  if (!total) return '—';
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/** `3.42` — the format every invoicing tool wants. */
export function formatDecimalHours(seconds, decimals = 2) {
  return ((Number(seconds) || 0) / 3600).toFixed(decimals);
}

export function formatHours(seconds, { decimal = true } = {}) {
  return decimal ? `${formatDecimalHours(seconds)} h` : formatDuration(seconds);
}

export function currencySymbol(code) {
  return CURRENCIES.find((currency) => currency.code === code)?.symbol ?? `${code} `;
}

export function formatMoney(amount, code = 'USD') {
  const value = Number(amount) || 0;
  const body = Math.abs(value) >= 1000
    ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value.toFixed(2);
  return `${currencySymbol(code)}${body}`;
}

/** `Fri 25 Sep` */
export function formatDayLabel(dayKey) {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dayKey;
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** `25 Sep` */
export function formatShortDate(dayKey) {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dayKey;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** `22 Sep – 28 Sep 2026` */
export function formatRangeLabel(days = []) {
  if (!days.length) return '';
  const first = days[0];
  const last = days[days.length - 1];
  const year = last.slice(0, 4);
  if (first === last) return `${formatShortDate(first)} ${year}`;
  return `${formatShortDate(first)} – ${formatShortDate(last)} ${year}`;
}

/** `9:42 am` */
export function formatClock(ts) {
  const date = new Date(ts);
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${suffix}`;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
