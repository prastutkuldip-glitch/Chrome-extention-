/**
 * Parsing the hand-off from the payment page.
 *
 * After a successful purchase the checkout redirects to our activation page,
 * which passes the licence key on to the extension. The exact query parameter
 * name depends on the provider and can change, so this reads several spellings
 * rather than betting on one — a buyer who has paid must never be met with a
 * blank screen because a parameter got renamed.
 *
 * Pure and Chrome-free, so every branch is testable.
 */

/** Accepted spellings, in order of preference. */
const KEY_PARAMS = ['license_key', 'licence_key', 'license', 'licence', 'key'];
const EMAIL_PARAMS = ['email', 'buyer_email', 'purchaser_email'];
const SALE_PARAMS = ['sale_id', 'order_number', 'sale', 'order'];

export const KEY_KIND = {
  /** Issued by us in a batch; verified locally against a hash. */
  offline: 'offline',
  /** Issued by the payment provider; needs a network check. */
  provider: 'provider',
  unknown: 'unknown',
};

function firstOf(params, names) {
  for (const name of names) {
    const value = params.get(name);
    if (value && value.trim()) return value.trim();
  }
  return '';
}

/**
 * @param {string} search a `location.search` or `location.hash` fragment
 * @returns {{ key: string, email: string, saleId: string, kind: string }}
 */
export function parseActivationParams(search) {
  const text = String(search || '').replace(/^[?#]/, '');
  const params = new URLSearchParams(text);
  const key = firstOf(params, KEY_PARAMS);
  return {
    key,
    email: firstOf(params, EMAIL_PARAMS),
    saleId: firstOf(params, SALE_PARAMS),
    kind: classifyKey(key),
  };
}

/**
 * Which verification path does this key need?
 *
 * Offline keys are ours: `BILLED-` plus 15 characters. Anything else that looks
 * substantial is assumed to be a provider key and gets verified over the network.
 */
export function classifyKey(key) {
  const value = String(key || '').trim();
  if (!value) return KEY_KIND.unknown;

  const canonical = value.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (canonical.startsWith('BILLED') && canonical.length === 21) return KEY_KIND.offline;

  // Provider keys are typically UUID-shaped, but stay permissive: length and a
  // plausible charset are enough to decide *which path* to try.
  if (/^[0-9A-Za-z-]{8,64}$/.test(value)) return KEY_KIND.provider;
  return KEY_KIND.unknown;
}

/** Only ever hand a key back to the UI partially masked. */
export function maskKey(key) {
  const value = String(key || '').trim();
  if (value.length <= 6) return value;
  return `${'•'.repeat(Math.max(4, value.length - 6))}${value.slice(-6)}`;
}

/**
 * Is this message allowed to activate anything?
 * The manifest already restricts which origins may connect; this is the second
 * check, because a single allowlist entry is one typo away from being wrong.
 */
export function isTrustedOrigin(origin, allowed = []) {
  if (!origin) return false;
  return allowed.some((entry) => {
    const pattern = String(entry).replace(/\/\*$/, '');
    return origin === pattern;
  });
}
