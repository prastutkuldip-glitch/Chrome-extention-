import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ACTIONS, REASONS, decide } from '../extension/src/core/tracking-policy.js';

const NOW = Date.parse('2026-09-25T12:00:00.000Z');
const open = (overrides = {}) => ({
  start: NOW - 30 * 60_000,
  lastSeenAt: NOW - 30_000,
  hostname: 'acme.atlassian.net',
  path: '/browse/PAY-1',
  ...overrides,
});
const visit = (overrides = {}) => ({
  ok: true,
  hostname: 'acme.atlassian.net',
  path: '/browse/PAY-1',
  title: 'PAY-1',
  ...overrides,
});

test('nothing open and nothing trackable does nothing', () => {
  const verdict = decide({ current: null, now: NOW, visit: { ok: false, reason: 'protocol' } });
  assert.equal(verdict.action, ACTIONS.none);
});

test('nothing open and a trackable page starts a segment', () => {
  assert.equal(decide({ current: null, now: NOW, visit: visit() }).action, ACTIONS.start);
});

test('the same page extends the open segment', () => {
  const verdict = decide({ current: open(), now: NOW, visit: visit() });
  assert.equal(verdict.action, ACTIONS.extend);
  assert.equal(verdict.closeAt, NOW);
});

test('a different path switches segments', () => {
  const verdict = decide({ current: open(), now: NOW, visit: visit({ path: '/browse/PAY-2' }) });
  assert.equal(verdict.action, ACTIONS.switch);
  assert.equal(verdict.closeAt, NOW);
});

test('a different host switches segments', () => {
  assert.equal(decide({ current: open(), now: NOW, visit: visit({ hostname: 'github.com' }) }).action, ACTIONS.switch);
});

// --- the reason this file exists -------------------------------------------

test('a segment abandoned by a dead worker closes at its last heartbeat, not now', () => {
  // The worker died 40 minutes ago. Closing at `now` would bill those 40 minutes.
  const current = open({ lastSeenAt: NOW - 40 * 60_000 });
  const verdict = decide({ current, now: NOW, visit: visit(), staleMs: 180_000 });
  assert.equal(verdict.action, ACTIONS.closeStale);
  assert.equal(verdict.closeAt, current.lastSeenAt);
  assert.equal(verdict.reason, REASONS.stale);
});

test('staleness is checked before anything else, even when tracking is off', () => {
  const current = open({ lastSeenAt: NOW - 10 * 60_000 });
  const verdict = decide({ current, now: NOW, trackingEnabled: false, visit: null });
  assert.equal(verdict.action, ACTIONS.closeStale);
  assert.equal(verdict.closeAt, current.lastSeenAt);
});

test('a heartbeat inside the stale window is not treated as a crash', () => {
  const current = open({ lastSeenAt: NOW - 60_000 });
  assert.equal(decide({ current, now: NOW, visit: visit(), staleMs: 180_000 }).action, ACTIONS.extend);
});

test('going idle closes at the last confirmed heartbeat', () => {
  // Chrome tells us the user *has* gone idle, not when they went.
  const current = open({ lastSeenAt: NOW - 45_000 });
  const verdict = decide({ current, now: NOW, idleState: 'idle', visit: visit() });
  assert.equal(verdict.action, ACTIONS.stop);
  assert.equal(verdict.reason, REASONS.idle);
  assert.equal(verdict.closeAt, current.lastSeenAt);
});

test('a locked screen is treated exactly like idle', () => {
  assert.equal(decide({ current: open(), now: NOW, idleState: 'locked', visit: visit() }).reason, REASONS.idle);
});

test('an end is never allowed to precede its start', () => {
  const current = open({ start: NOW, lastSeenAt: NOW - 10_000 });
  const verdict = decide({ current, now: NOW, idleState: 'idle', visit: visit() });
  assert.ok(verdict.closeAt >= current.start);
});

test('tracking switched off stops the clock', () => {
  const verdict = decide({ current: open(), now: NOW, trackingEnabled: false, visit: visit() });
  assert.equal(verdict.action, ACTIONS.stop);
  assert.equal(verdict.reason, REASONS.disabled);
});

test('a pause stops the clock until it expires', () => {
  const paused = decide({ current: open(), now: NOW, pausedUntil: NOW + 60_000, visit: visit() });
  assert.equal(paused.reason, REASONS.paused);

  const expired = decide({ current: open(), now: NOW, pausedUntil: NOW - 1, visit: visit() });
  assert.equal(expired.action, ACTIONS.extend);
});

test('a blocklisted page stops the clock and says why', () => {
  const verdict = decide({ current: open(), now: NOW, visit: { ok: false, reason: 'blocked' } });
  assert.equal(verdict.action, ACTIONS.stop);
  assert.equal(verdict.reason, REASONS.blocked);
});

test('an unfocused window stops the clock', () => {
  const verdict = decide({ current: open(), now: NOW, visit: { ok: false, reason: 'unfocused' } });
  assert.equal(verdict.reason, REASONS.unfocused);
});

test('a chrome:// page stops the clock as untrackable', () => {
  const verdict = decide({ current: open(), now: NOW, visit: { ok: false, reason: 'protocol' } });
  assert.equal(verdict.reason, REASONS.untrackable);
});

test('stopping with nothing open is a no-op, not an error', () => {
  for (const input of [
    { trackingEnabled: false },
    { pausedUntil: NOW + 1000 },
    { idleState: 'idle' },
    { visit: { ok: false, reason: 'blocked' } },
  ]) {
    const verdict = decide({ current: null, now: NOW, visit: visit(), ...input });
    assert.equal(verdict.action, ACTIONS.none, JSON.stringify(input));
  }
});

test('no branch ever returns a closeAt in the future', () => {
  const cases = [
    { current: open(), idleState: 'idle' },
    { current: open(), trackingEnabled: false },
    { current: open(), pausedUntil: NOW + 5000 },
    { current: open(), visit: { ok: false, reason: 'blocked' } },
    { current: open({ lastSeenAt: NOW - 10 * 60_000 }) },
    { current: open(), visit: visit({ path: '/other' }) },
    { current: open() },
  ];
  for (const input of cases) {
    const verdict = decide({ now: NOW, visit: visit(), ...input });
    if (verdict.closeAt !== undefined) {
      assert.ok(verdict.closeAt <= NOW, `${verdict.action} returned a future closeAt`);
    }
  }
});
