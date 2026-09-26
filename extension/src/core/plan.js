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
    /**
     * Only gates that are actually enforced live here. A flag nobody checks is
     * worse than no flag: it reads like a limit while doing nothing.
     *
     * Rates, money totals, non-billable time and manual entries are deliberately
     * free — seeing what the time is worth is the whole argument for upgrading.
     */
    features: {
      export: false,
      rounding: false,
      multiWeek: false,
      monthView: false,
      reminders: false,
    },
  },
  pro: {
    label: 'Pro',
    historyDays: Infinity,
    maxClients: Infinity,
    features: {
      export: true,
      rounding: true,
      multiWeek: true,
      monthView: true,
      reminders: true,
    },
  },
};

/** How long a cached "active" verification is trusted without re-checking. */
export const REVERIFY_GRACE_MS = 45 * 24 * 60 * 60 * 1000;
/** How often the background worker tries to re-verify. */
export const VERIFY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * How long Pro keeps working after a recurring payment fails.
 *
 * Cards expire, banks decline, and the provider retries for days. Cutting someone
 * off the moment the first charge bounces punishes a paying customer for their
 * bank's behaviour — so they keep working, and get told what to fix.
 */
export const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @param {{ key?: string, status?: string, verifiedAt?: number, expiresAt?: number|null }|null} license
 * @param {number} [now]
 * @returns {'free'|'pro'}
 */
export function planFor(license, now = Date.now()) {
  if (!license || !license.key) return 'free';

  // A recurring payment that failed: keep Pro on while the provider retries.
  if (license.status === 'past_due') {
    const since = Number(license.pastDueSince) || now;
    return now - since <= PAST_DUE_GRACE_MS ? 'pro' : 'free';
  }

  if (license.status !== 'active') return 'free';
  if (license.expiresAt && license.expiresAt <= now) return 'free';

  // An offline key was verified against a hash that ships inside the extension.
  // There is no server to re-check it against, so it must never go stale —
  // otherwise someone who paid by UPI would silently lose Pro after 45 days.
  if (license.source === 'offline') return 'pro';

  if (license.verifiedAt && now - license.verifiedAt > REVERIFY_GRACE_MS) return 'free';
  return 'pro';
}

/**
 * What, if anything, should the user be told about their licence?
 *
 * Kept here rather than in the UI so the wording is tested, and so a silent
 * downgrade is impossible: every state that costs someone their Pro features has
 * to produce a message explaining it.
 *
 * @returns {{ level: 'warn'|'error'|'info', title: string, message: string, action?: string }|null}
 */
export function licenseNotice(license, now = Date.now()) {
  if (!license?.key) return null;

  if (license.status === 'past_due') {
    const since = Number(license.pastDueSince) || now;
    const daysLeft = Math.max(0, Math.ceil((PAST_DUE_GRACE_MS - (now - since)) / 86_400_000));
    return daysLeft > 0
      ? {
        level: 'warn',
        title: 'Your last payment did not go through',
        message: `Pro keeps working for ${daysLeft} more day${daysLeft === 1 ? '' : 's'}. Updating your card with the payment provider fixes it — nothing here needs changing.`,
        action: 'manage',
      }
      : {
        level: 'error',
        title: 'Subscription unpaid',
        message: 'Pro is switched off because the renewal never completed. Your recorded hours are all still here and come back the moment payment succeeds.',
        action: 'manage',
      };
  }

  if (license.status === 'expired') {
    return {
      level: 'error',
      title: 'Subscription ended',
      message: 'Pro is off, but nothing was deleted. Your full history is still on this device and returns when you renew.',
      action: 'renew',
    };
  }

  if (license.status === 'refunded') {
    return {
      level: 'info',
      title: 'Purchase refunded',
      message: 'Pro is switched off. Your recorded hours are untouched, and the free plan keeps tracking everything.',
      action: 'renew',
    };
  }

  if (license.status === 'active' && license.source !== 'offline'
      && license.verifiedAt && now - license.verifiedAt > REVERIFY_GRACE_MS) {
    return {
      level: 'warn',
      title: 'Could not re-check your licence',
      message: 'Billed has not reached the licence server in a long while. Reconnect once and Pro comes straight back.',
      action: 'recheck',
    };
  }

  return null;
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
  if (!license?.key) return false;
  if (license.source === 'offline') return false; // nothing to re-check
  // A past-due licence is re-checked more eagerly: the customer may have already
  // fixed their card, and they should not wait a week to get Pro back.
  if (license.status === 'past_due') return true;
  if (license.status !== 'active') return false;
  return !license.verifiedAt || now - license.verifiedAt > VERIFY_INTERVAL_MS;
}
