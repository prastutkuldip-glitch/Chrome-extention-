import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  canonicaliseKey,
  looksLikeOfflineKey,
  OFFLINE_KEY_BATCH,
  verifyOfflineKey,
} from '../extension/src/core/offline-keys.js';
import { needsReverify, planFor, REVERIFY_GRACE_MS } from '../extension/src/core/plan.js';

const now = Date.parse('2026-09-26T10:00:00.000Z');

/**
 * A real key from the private batch. Read at test time rather than hard-coded,
 * so the plaintext list never ends up in a committed file.
 */
function sampleKey() {
  const ledger = readFileSync(new URL('../keys/billed-keys-batch-1.txt', import.meta.url), 'utf8');
  const match = ledger.match(/(BILLED-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5})/);
  assert.ok(match, 'key ledger should exist — run: node tools/make-keys.mjs');
  return match[1];
}

test('a batch is present in the shipped module', () => {
  assert.equal(typeof OFFLINE_KEY_BATCH, 'number');
});

test('an issued key verifies', async () => {
  assert.equal(await verifyOfflineKey(sampleKey()), true);
});

test('a key verifies however the customer pasted it', async () => {
  const key = sampleKey();
  for (const variant of [
    key.toLowerCase(),
    key.replace(/-/g, ''),
    key.replace(/-/g, ' '),
    `  ${key}  `,
    key.split('-').join('–'), // en-dashes, which phones love to insert
  ]) {
    assert.equal(await verifyOfflineKey(variant), true, variant);
  }
});

test('a key that was never issued is rejected', async () => {
  assert.equal(await verifyOfflineKey('BILLED-AAAAA-BBBBB-CCCCC'), false);
  assert.equal(await verifyOfflineKey('BILLED-22222-33333-44444'), false);
});

test('one wrong character is rejected', async () => {
  const key = sampleKey();
  const broken = `${key.slice(0, -1)}${key.endsWith('2') ? '3' : '2'}`;
  assert.equal(await verifyOfflineKey(broken), false);
});

test('rubbish input is rejected without throwing', async () => {
  for (const value of ['', null, undefined, 'hello', 'BILLED', 'BILLED-123', {}, 42]) {
    assert.equal(await verifyOfflineKey(value), false, String(value));
  }
});

test('shape check separates offline keys from provider keys', () => {
  assert.equal(looksLikeOfflineKey('BILLED-AAAAA-BBBBB-CCCCC'), true);
  // A Gumroad key is a UUID, and must fall through to the network path.
  assert.equal(looksLikeOfflineKey('B8F1C2D3-4E5A-6B7C-8D9E-0F1A2B3C4D5E'), false);
  assert.equal(looksLikeOfflineKey('BILLED-TOOSHORT'), false);
});

test('canonicalisation drops everything that is not a key character', () => {
  assert.equal(canonicaliseKey(' billed-ab cd2-3456x-7y89z '), 'BILLEDABCD23456X7Y89Z');
});

test('the alphabet avoids the characters people mistype', async () => {
  const key = sampleKey();
  assert.doesNotMatch(key.replace('BILLED-', ''), /[01OIL]/, 'keys must avoid 0 O 1 I L');
});

// --- the reason this matters for a UPI sale -------------------------------

test('an offline licence never goes stale', () => {
  // There is no server to re-check against. If this downgraded, a customer who
  // paid by UPI would silently lose Pro six weeks later.
  const license = { key: 'BILLED-X', status: 'active', source: 'offline', verifiedAt: now - REVERIFY_GRACE_MS * 10 };
  assert.equal(planFor(license, now), 'pro');
  assert.equal(needsReverify(license, now), false);
});

test('a provider licence still goes stale, as before', () => {
  const license = { key: 'uuid', status: 'active', source: 'gumroad', verifiedAt: now - REVERIFY_GRACE_MS - 1 };
  assert.equal(planFor(license, now), 'free');
});

test('a refunded offline key can still be switched off', () => {
  const license = { key: 'BILLED-X', status: 'refunded', source: 'offline', verifiedAt: now };
  assert.equal(planFor(license, now), 'free');
});
