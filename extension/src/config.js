/**
 * Every business-level constant lives here, so pricing, product IDs, links and
 * even the product name can change without touching a line of feature code.
 *
 * TODO before launch: replace the three PLACEHOLDER values (see
 * docs/PAYMENTS_SETUP.md for exactly where each one comes from).
 */

export const APP = {
  name: 'Billed',
  tagline: 'Your week, reconstructed.',
  site: 'https://billed.app',
  supportEmail: 'support@billed.app',
};

export const LINKS = {
  checkoutMonthly: 'https://PLACEHOLDER.gumroad.com/l/billed-pro?variant=Monthly',
  checkoutYearly: 'https://PLACEHOLDER.gumroad.com/l/billed-pro?variant=Yearly',
  checkoutLifetime: 'https://PLACEHOLDER.gumroad.com/l/billed-lifetime',
  checkoutIndia: 'https://PLACEHOLDER.gumroad.com/l/billed-pro?variant=India',
  privacy: 'https://billed.app/privacy',
  help: 'https://billed.app/help',
};

/**
 * Automatic activation after payment.
 *
 * The checkout redirects to `page`, which hands the licence key to the extension
 * so nobody has to copy and paste anything. `trustedOrigins` must match the
 * `externally_connectable` entry in the manifest — both are checked.
 */
export const ACTIVATION = {
  page: 'https://prastutkuldip-glitch.github.io/Chrome-extention-/activate.html',
  trustedOrigins: ['https://prastutkuldip-glitch.github.io'],
};

/** Gumroad product permalink used for licence verification. */
export const LICENSING = {
  provider: 'gumroad',
  /** The part after /l/ in your Gumroad product URL. */
  productPermalink: 'PLACEHOLDER',
  verifyEndpoint: 'https://api.gumroad.com/v2/licenses/verify',
  /**
   * Requested at runtime, only when someone actually activates a licence — a
   * fresh install of Billed holds no network permissions at all.
   */
  originPermission: 'https://api.gumroad.com/*',
};

/** Shown in the upgrade panel. Keep in sync with the landing page. */
export const PRICING = {
  default: {
    currency: 'USD',
    symbol: '$',
    monthly: 15,
    yearly: 99,
    lifetime: 149,
    yearlySavingPercent: 45,
  },
  india: {
    currency: 'INR',
    symbol: '₹',
    monthly: 499,
    yearly: 3499,
    lifetime: 6999,
    yearlySavingPercent: 42,
  },
};

/** Regional pricing is picked from the browser locale, never from an IP lookup. */
export function pricingForLocale(locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US') {
  return /-IN\b/i.test(locale || '') ? PRICING.india : PRICING.default;
}

export const TRACKING = {
  /** How often the worker persists progress and reconciles its own state. */
  heartbeatMinutes: 1,
  /** A stored segment older than this is assumed to have died with the worker. */
  staleSegmentMs: 3 * 60 * 1000,
  /** Housekeeping cadence for retention pruning and licence re-checks. */
  maintenanceMinutes: 60,
};

export const ALARMS = {
  heartbeat: 'billed:heartbeat',
  maintenance: 'billed:maintenance',
  weeklyReview: 'billed:weekly-review',
};
