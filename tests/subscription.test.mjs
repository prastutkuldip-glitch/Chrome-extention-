import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  licenseNotice,
  needsReverify,
  PAST_DUE_GRACE_MS,
  planFor,
  REVERIFY_GRACE_MS,
} from '../extension/src/core/plan.js';

const now = Date.parse('2026-09-26T12:00:00.000Z');
const days = (n) => n * 86_400_000;

// --- an American customer on card autopay ---------------------------------

test('an active subscription is Pro', () => {
  const license = { key: 'uuid', status: 'active', source: 'gumroad', recurrence: 'monthly', verifiedAt: now };
  assert.equal(planFor(license, now), 'pro');
  assert.equal(licenseNotice(license, now), null);
});

test('a failed renewal keeps Pro on and explains itself', () => {
  // The bank declined. The provider is still retrying. Cutting them off now
  // would punish a paying customer for their bank's behaviour.
  const license = { key: 'uuid', status: 'past_due', source: 'gumroad', pastDueSince: now - days(2) };
  assert.equal(planFor(license, now), 'pro');

  const notice = licenseNotice(license, now);
  assert.equal(notice.level, 'warn');
  assert.match(notice.message, /5 more days/);
  assert.equal(notice.action, 'manage');
});

test('the grace period counts down and then ends', () => {
  const almost = { key: 'uuid', status: 'past_due', pastDueSince: now - PAST_DUE_GRACE_MS + 1000 };
  assert.equal(planFor(almost, now), 'pro');

  const over = { key: 'uuid', status: 'past_due', pastDueSince: now - PAST_DUE_GRACE_MS - 1000 };
  assert.equal(planFor(over, now), 'free');
  assert.equal(licenseNotice(over, now).level, 'error');
});

test('a past-due licence is re-checked eagerly, not weekly', () => {
  // They may have fixed their card ten minutes ago; they should not wait a week.
  const license = { key: 'uuid', status: 'past_due', source: 'gumroad', verifiedAt: now, pastDueSince: now };
  assert.equal(needsReverify(license, now), true);
});

test('singular wording when only one day of grace is left', () => {
  const license = { key: 'uuid', status: 'past_due', pastDueSince: now - PAST_DUE_GRACE_MS + days(1) - 1000 };
  assert.match(licenseNotice(license, now).message, /1 more day\b/);
});

test('a cancelled subscription that has run its term goes free, with a reason', () => {
  const license = { key: 'uuid', status: 'expired', source: 'gumroad', verifiedAt: now, expiresAt: now - 1000 };
  assert.equal(planFor(license, now), 'free');
  const notice = licenseNotice(license, now);
  assert.equal(notice.level, 'error');
  assert.match(notice.message, /nothing was deleted/i);
});

test('cancelling mid-term keeps Pro until the paid period ends', () => {
  const license = { key: 'uuid', status: 'active', source: 'gumroad', verifiedAt: now, expiresAt: now + days(20) };
  assert.equal(planFor(license, now), 'pro');
});

test('a refund switches Pro off and says so without blame', () => {
  const license = { key: 'uuid', status: 'refunded', source: 'gumroad', verifiedAt: now };
  assert.equal(planFor(license, now), 'free');
  assert.equal(licenseNotice(license, now).level, 'info');
});

// --- an Indian customer paying once by UPI --------------------------------

test('a one-time UPI key is Pro forever, with nothing to renew', () => {
  const license = { key: 'BILLED-X', status: 'active', source: 'offline', verifiedAt: now - days(900) };
  assert.equal(planFor(license, now), 'pro');
  assert.equal(licenseNotice(license, now), null);
  assert.equal(needsReverify(license, now), false);
});

// --- being offline should never cost anyone their Pro ---------------------

test('a long offline stretch warns before it downgrades', () => {
  const stale = { key: 'uuid', status: 'active', source: 'gumroad', verifiedAt: now - REVERIFY_GRACE_MS - 1000 };
  assert.equal(planFor(stale, now), 'free');
  const notice = licenseNotice(stale, now);
  assert.equal(notice.level, 'warn');
  assert.equal(notice.action, 'recheck');
});

test('no licence produces no noise', () => {
  assert.equal(licenseNotice(null, now), null);
  assert.equal(licenseNotice({}, now), null);
  assert.equal(licenseNotice({ key: '' }, now), null);
});

test('every state that costs someone Pro also explains why', () => {
  const states = [
    { key: 'k', status: 'expired', verifiedAt: now },
    { key: 'k', status: 'refunded', verifiedAt: now },
    { key: 'k', status: 'past_due', pastDueSince: now - PAST_DUE_GRACE_MS - 1 },
    { key: 'k', status: 'active', source: 'gumroad', verifiedAt: now - REVERIFY_GRACE_MS - 1 },
  ];
  for (const license of states) {
    assert.equal(planFor(license, now), 'free', JSON.stringify(license));
    assert.ok(licenseNotice(license, now), `silent downgrade for ${license.status}`);
  }
});
