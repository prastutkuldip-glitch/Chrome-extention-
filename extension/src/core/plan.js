/**
 * Plan limits and licence evaluation.
 *
 * Two principles here, both deliberate:
 *  1. The free plan is genuinely useful — it tracks everything and shows you the
 *     money. What you pay for is history, scale and getting data *out*.
 *  2. A paid user is never locked out because they were offline. Verification is
 *     cached and given a long grace period; only a licence that is explicitly
 *     refunded or expired downgrades.
 */

export const PLANS = ['free', 'pro'];

export const PLAN_LIMITS = {
  free: {
    label: 'Free',
    historyDays: 7,
    maxClients: 3,
    features: {
      export: false,
      rounding: false,
      rates: true,
      multiWeek: false,
      reports: false,
      reminders: false,
      nonBillable: true,
    },
  },
  pro: {
    label: 'Pro',
    historyDays: Infinity,
    maxClients: Infinity,
    features: {
      export: true,
      rounding: true,
      rates: true,
      multiWeek: true,
      reports: true,
      reminders: true,
      nonBillable: true,
    },
  },
};

/** How long a cached "active" verification is trusted without re-checking. */
export const REVERIFY_GRACE_MS = 45 * 24 * 60 * 60 * 1000;
/** How often the background worker tries to re-verify. */
export const VERIFY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @param {{ key?: string, status?: string, verifiedAt?: number, expiresAt?: number|null }|null} license
 * @param {number} [now]
 * @returns {'free'|'pro'}
 */
export function planFor(license, now = Date.now()) {
  if (!license || !license.key || license.status !== 'active') return 'free';
  if (license.expiresAt && license.expiresAt <= now) return 'free';
  if (license.verifiedAt && now - license.verifiedAt > REVERIFY_GRACE_MS) return 'free';
  return 'pro';
}

export function limits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

/** Feature gate used everywhere in the UI. */
export function can(plan, feature) {
  return Boolean(limits(plan).features[feature]);
}

export function maxClients(plan) {
  return limits(plan).maxClients;
}

export function canAddClient(plan, currentCount) {
  return currentCount < maxClients(plan);
}

/**
 * Oldest instant a plan may read. Free users keep collecting data beyond this —
 * it is simply hidden until they upgrade, so nobody loses history by waiting.
 */
export function historyCutoff(plan, now = Date.now()) {
  const days = limits(plan).historyDays;
  if (!Number.isFinite(days)) return 0;
  return now - days * 24 * 60 * 60 * 1000;
}

/** Should the background worker try to re-verify right now? */
export function needsReverify(license, now = Date.now()) {
  if (!license?.key || license.status !== 'active') return false;
  return !license.verifiedAt || now - license.verifiedAt > VERIFY_INTERVAL_MS;
}
