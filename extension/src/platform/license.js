/**
 * Licence activation and re-verification.
 *
 * Deliberate choices:
 *  - Network access is an *optional* permission, requested the moment someone
 *    activates a licence and never before. A fresh install of Billed cannot make
 *    a network request at all.
 *  - Verification results are cached. Re-checks happen weekly; a failed re-check
 *    while offline changes nothing for 45 days. Paying users do not get locked
 *    out of their own timesheet because a flight had no wifi.
 *  - The provider lives behind one function, so swapping Gumroad for a merchant
 *    of record later touches this file only.
 */

import { LICENSING } from '../config.js';
import { getLicense, setLicense } from './store.js';
import { needsReverify } from '../core/plan.js';
import { looksLikeOfflineKey, verifyOfflineKey } from '../core/offline-keys.js';

export const LICENSE_STATUS = {
  none: 'none',
  active: 'active',
  invalid: 'invalid',
  refunded: 'refunded',
  expired: 'expired',
  unreachable: 'unreachable',
};

export function hasNetworkPermission() {
  return chrome.permissions.contains({ origins: [LICENSING.originPermission] });
}

export function requestNetworkPermission() {
  return chrome.permissions.request({ origins: [LICENSING.originPermission] });
}

/**
 * Ask the provider about a key.
 * @returns {Promise<{status: string, expiresAt: number|null, email?: string, tier?: string, raw?: object}>}
 */
async function askProvider(key) {
  const body = new URLSearchParams({
    product_permalink: LICENSING.productPermalink,
    license_key: key,
    increment_uses_count: 'false',
  });

  let response;
  try {
    response = await fetch(LICENSING.verifyEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    return { status: LICENSE_STATUS.unreachable, expiresAt: null };
  }

  if (response.status === 404) return { status: LICENSE_STATUS.invalid, expiresAt: null };
  if (!response.ok) return { status: LICENSE_STATUS.unreachable, expiresAt: null };

  let json;
  try {
    json = await response.json();
  } catch {
    return { status: LICENSE_STATUS.unreachable, expiresAt: null };
  }

  if (!json?.success) return { status: LICENSE_STATUS.invalid, expiresAt: null };

  const purchase = json.purchase || {};
  if (purchase.refunded || purchase.disputed || purchase.chargebacked) {
    return { status: LICENSE_STATUS.refunded, expiresAt: null };
  }

  const ended = purchase.subscription_ended_at || purchase.subscription_failed_at || purchase.subscription_cancelled_at;
  if (ended) {
    const endedAt = Date.parse(ended);
    if (Number.isFinite(endedAt) && endedAt <= Date.now()) {
      return { status: LICENSE_STATUS.expired, expiresAt: endedAt };
    }
  }

  return {
    status: LICENSE_STATUS.active,
    expiresAt: null,
    email: purchase.email,
    tier: purchase.variants || purchase.recurrence || 'pro',
  };
}

/**
 * Activate a key entered by the user.
 * @param {string} rawKey
 * @param {{ interactive?: boolean }} [options] interactive activations may prompt
 *   for the network permission; background re-checks may not.
 */
export async function activateLicense(rawKey, options = {}) {
  const { interactive = true } = options;
  const key = String(rawKey || '').trim();
  if (!key) return { ok: false, status: LICENSE_STATUS.invalid, message: 'Enter your licence key.' };

  // Keys sold directly are checked against hashes that ship with the extension.
  // No network, no permission prompt, no waiting — and they never expire.
  if (looksLikeOfflineKey(key)) {
    if (await verifyOfflineKey(key)) {
      const license = {
        key,
        status: LICENSE_STATUS.active,
        source: 'offline',
        verifiedAt: Date.now(),
        expiresAt: null,
        email: '',
        tier: 'direct',
      };
      await setLicense(license);
      return { ok: true, status: LICENSE_STATUS.active, license, message: messageFor(LICENSE_STATUS.active) };
    }
    return {
      ok: false,
      status: LICENSE_STATUS.invalid,
      message: 'That key was not recognised. Check for a typo — the letters O, I and L are never used.',
    };
  }

  let granted = await hasNetworkPermission();
  if (!granted) {
    if (!interactive) {
      return { ok: false, status: LICENSE_STATUS.unreachable, message: 'Network permission not granted yet.' };
    }
    granted = await requestNetworkPermission();
  }
  if (!granted) {
    return {
      ok: false,
      status: LICENSE_STATUS.unreachable,
      message: 'Billed needs one-off access to api.gumroad.com to check your key. Nothing else is sent.',
    };
  }

  const result = await askProvider(key);
  const previous = await getLicense();

  if (result.status === LICENSE_STATUS.unreachable) {
    // Never downgrade a working licence because the check failed.
    return {
      ok: false,
      status: LICENSE_STATUS.unreachable,
      message: 'Could not reach the licence server. Check your connection and try again.',
      license: previous,
    };
  }

  const license = {
    key,
    status: result.status,
    source: LICENSING.provider,
    verifiedAt: Date.now(),
    expiresAt: result.expiresAt,
    email: result.email || previous.email || '',
    tier: result.tier || '',
  };
  await setLicense(license);

  return {
    ok: result.status === LICENSE_STATUS.active,
    status: result.status,
    license,
    message: messageFor(result.status),
  };
}

function messageFor(status) {
  switch (status) {
    case LICENSE_STATUS.active: return 'Pro unlocked. Thank you — genuinely.';
    case LICENSE_STATUS.invalid: return 'That key was not recognised. Check for a stray space, or paste it again.';
    case LICENSE_STATUS.refunded: return 'This purchase was refunded, so Pro is switched off.';
    case LICENSE_STATUS.expired: return 'This subscription has ended. Renew to switch Pro back on.';
    default: return 'Could not verify right now.';
  }
}

/** Weekly background re-check. Silent, and never prompts for permissions. */
export async function reverifyIfDue(now = Date.now()) {
  const license = await getLicense();
  if (!needsReverify(license, now)) return null;
  if (!(await hasNetworkPermission())) return null;

  const result = await askProvider(license.key);
  if (result.status === LICENSE_STATUS.unreachable) return null;

  const updated = {
    ...license,
    status: result.status,
    verifiedAt: now,
    expiresAt: result.expiresAt ?? license.expiresAt,
  };
  await setLicense(updated);
  return updated;
}

export async function deactivateLicense() {
  return setLicense({ key: '', status: LICENSE_STATUS.none, verifiedAt: 0, expiresAt: null });
}
