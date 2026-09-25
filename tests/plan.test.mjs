import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  can,
  canAddClient,
  historyCutoff,
  maxClients,
  needsReverify,
  planFor,
  REVERIFY_GRACE_MS,
  VERIFY_INTERVAL_MS,
} from '../extension/src/core/plan.js';
import { DEFAULT_SETTINGS, createClient, createRule, withDefaults } from '../extension/src/core/defaults.js';

const now = Date.parse('2026-09-25T12:00:00.000Z');

test('no licence means the free plan', () => {
  assert.equal(planFor(null, now), 'free');
  assert.equal(planFor({}, now), 'free');
  assert.equal(planFor({ key: 'ABC' }, now), 'free');
});

test('an active licence unlocks pro', () => {
  assert.equal(planFor({ key: 'ABC', status: 'active', verifiedAt: now }, now), 'pro');
});

test('a refunded or invalid licence drops to free', () => {
  assert.equal(planFor({ key: 'ABC', status: 'refunded', verifiedAt: now }, now), 'free');
  assert.equal(planFor({ key: 'ABC', status: 'invalid', verifiedAt: now }, now), 'free');
});

test('an expired subscription drops to free', () => {
  assert.equal(planFor({ key: 'ABC', status: 'active', verifiedAt: now, expiresAt: now - 1 }, now), 'free');
  assert.equal(planFor({ key: 'ABC', status: 'active', verifiedAt: now, expiresAt: now + 1000 }, now), 'pro');
});

test('being offline for weeks does not lock a paying user out', () => {
  const license = { key: 'ABC', status: 'active', verifiedAt: now - REVERIFY_GRACE_MS + 1000 };
  assert.equal(planFor(license, now), 'pro');
});

test('a verification that is stale beyond the grace period does downgrade', () => {
  const license = { key: 'ABC', status: 'active', verifiedAt: now - REVERIFY_GRACE_MS - 1000 };
  assert.equal(planFor(license, now), 'free');
});

test('re-verification is attempted weekly, not constantly', () => {
  assert.equal(needsReverify({ key: 'A', status: 'active', verifiedAt: now }, now), false);
  assert.equal(needsReverify({ key: 'A', status: 'active', verifiedAt: now - VERIFY_INTERVAL_MS - 1 }, now), true);
  assert.equal(needsReverify(null, now), false);
});

test('free limits are real but usable', () => {
  assert.equal(maxClients('free'), 3);
  assert.equal(canAddClient('free', 2), true);
  assert.equal(canAddClient('free', 3), false);
  assert.equal(can('free', 'export'), false);
  assert.equal(can('free', 'rounding'), false);
  assert.equal(can('free', 'rates'), true, 'free users must be able to see the money — that is the pitch');
});

test('pro is unlimited', () => {
  assert.equal(maxClients('pro'), Infinity);
  assert.equal(canAddClient('pro', 500), true);
  for (const feature of ['export', 'rounding', 'multiWeek', 'reports', 'reminders']) {
    assert.equal(can('pro', feature), true, feature);
  }
});

test('free history is a seven-day window; pro sees everything', () => {
  assert.equal(historyCutoff('free', now), now - 7 * 86_400_000);
  assert.equal(historyCutoff('pro', now), 0);
});

test('settings merge over defaults without losing untouched keys', () => {
  const merged = withDefaults({ billing: { currency: 'INR' }, tracking: { idleSeconds: 60 } });
  assert.equal(merged.billing.currency, 'INR');
  assert.equal(merged.tracking.idleSeconds, 60);
  assert.equal(merged.tracking.minSegmentSeconds, DEFAULT_SETTINGS.tracking.minSegmentSeconds);
  assert.ok(Array.isArray(merged.privacy.blocklist));
  assert.ok(merged.privacy.blocklist.length > 0);
});

test('withDefaults does not mutate the defaults object', () => {
  withDefaults({ billing: { currency: 'INR' } });
  assert.equal(DEFAULT_SETTINGS.billing.currency, 'USD');
});

test('factories produce distinct, well-formed records', () => {
  const client = createClient({ name: '  Acme  ', rate: '120' });
  assert.equal(client.name, 'Acme');
  assert.equal(client.rate, 120);
  assert.match(client.color, /^#[0-9a-f]{6}$/i);
  assert.notEqual(createClient({ name: 'A' }).id, createClient({ name: 'B' }).id);

  const rule = createRule({ clientId: client.id, kind: 'hostname', value: '  ACME.com ' });
  assert.equal(rule.value, 'acme.com');
  assert.equal(rule.enabled, true);
});

test('an unnamed client still gets a usable name', () => {
  assert.equal(createClient({}).name, 'New client');
});
