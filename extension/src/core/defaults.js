/**
 * Default settings and factory helpers.
 */

import { SUGGESTED_BLOCKLIST } from './privacy.js';

export const CLIENT_COLORS = [
  '#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5',
];

export const CURRENCIES = [
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'GBP', symbol: '£' },
  { code: 'INR', symbol: '₹' },
  { code: 'AUD', symbol: 'A$' },
  { code: 'CAD', symbol: 'C$' },
  { code: 'AED', symbol: 'AED ' },
  { code: 'SGD', symbol: 'S$' },
];

export const DEFAULT_SETTINGS = {
  version: 1,
  tracking: {
    enabled: true,
    /** Seconds of no input before the clock stops. Short on purpose: honest hours. */
    idleSeconds: 120,
    /** Visits shorter than this are noise, not work. */
    minSegmentSeconds: 30,
    /** Same client within this gap becomes one timesheet line. */
    mergeGapSeconds: 300,
    /** Never store query strings. Opt-in only, and clearly labelled. */
    keepQuery: false,
    /** Titles carry ticket keys; a user can turn them off entirely. */
    storeTitles: true,
    pausedUntil: 0,
  },
  billing: {
    currency: 'USD',
    defaultRate: 0,
    rounding: {
      incrementMinutes: 0,
      direction: 'nearest',
      billMinimumIncrement: true,
    },
  },
  display: {
    weekStartsOn: 1,
    decimalHours: true,
    theme: 'system',
  },
  privacy: {
    blocklist: [...SUGGESTED_BLOCKLIST],
    retentionDays: 730,
  },
  reminders: {
    weeklyReview: false,
    dayOfWeek: 5,
    hour: 16,
  },
  onboarding: {
    completed: false,
    dismissedTips: [],
  },
};

let idCounter = 0;

/** Short, sortable, collision-resistant enough for a single-user local store. */
export function createId(prefix = 'id') {
  idCounter = (idCounter + 1) % 4096;
  const random = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${random}`;
}

export function createClient({ name, rate = 0, color, billable = true } = {}) {
  return {
    id: createId('cl'),
    name: String(name || '').trim() || 'New client',
    rate: Number(rate) || 0,
    color: color || CLIENT_COLORS[Math.floor(Math.random() * CLIENT_COLORS.length)],
    billable,
    projects: [],
    archived: false,
    createdAt: Date.now(),
  };
}

export function createRule({ clientId, kind = 'hostname', value, projectId = null, billable = true, priority = 0 } = {}) {
  return {
    id: createId('rl'),
    clientId,
    projectId,
    kind,
    value: String(value || '').trim().toLowerCase(),
    billable,
    priority,
    enabled: true,
    createdAt: Date.now(),
  };
}

export function createProject({ name } = {}) {
  return { id: createId('pj'), name: String(name || '').trim() || 'New project' };
}

/** Deep-merge stored settings over the defaults so upgrades never lose keys. */
export function withDefaults(stored = {}) {
  return mergeDeep(structuredCloneSafe(DEFAULT_SETTINGS), stored || {});
}

function structuredCloneSafe(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function mergeDeep(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = mergeDeep(target[key] && typeof target[key] === 'object' ? target[key] : {}, value);
    } else if (value !== undefined) {
      target[key] = value;
    }
  }
  return target;
}
