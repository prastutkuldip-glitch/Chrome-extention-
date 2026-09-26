import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clampToRange, mergeBlocks, normalizeVisits, splitAtMidnight } from '../extension/src/core/segments.js';
import { dayStart, MINUTE_MS } from '../extension/src/core/time.js';

const IST = 330;
const at = (day, minutes) => dayStart(day, IST) + minutes * MINUTE_MS;

test('a visit crossing local midnight is split across both days', () => {
  const segment = { start: at('2026-09-25', 23 * 60 + 40), end: at('2026-09-26', 20), hostname: 'acme.com', path: '/' };
  const pieces = splitAtMidnight(segment, IST);
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0].dayKey, '2026-09-25');
  assert.equal(pieces[1].dayKey, '2026-09-26');
  assert.equal((pieces[0].end - pieces[0].start) / MINUTE_MS, 20);
  assert.equal((pieces[1].end - pieces[1].start) / MINUTE_MS, 20);
});

test('splitting never changes the total duration', () => {
  const segment = { start: at('2026-09-25', 10), end: at('2026-09-28', 30) };
  const pieces = splitAtMidnight(segment, IST);
  const total = pieces.reduce((sum, piece) => sum + (piece.end - piece.start), 0);
  assert.equal(total, segment.end - segment.start);
  assert.equal(pieces.length, 4);
});

test('clampToRange trims and rejects', () => {
  const segment = { start: at('2026-09-25', 0), end: at('2026-09-25', 120) };
  const clipped = clampToRange(segment, at('2026-09-25', 30), at('2026-09-25', 60));
  assert.equal((clipped.end - clipped.start) / MINUTE_MS, 30);
  assert.equal(clampToRange(segment, at('2026-09-26', 0), at('2026-09-26', 60)), null);
});

test('sub-threshold visits are discarded as noise', () => {
  const visits = [
    { start: at('2026-09-25', 10), end: at('2026-09-25', 10) + 5_000, hostname: 'a.com', path: '/' },
    { start: at('2026-09-25', 20), end: at('2026-09-25', 25), hostname: 'b.com', path: '/' },
  ];
  const normalized = normalizeVisits(visits, { minSegmentSeconds: 30, offsetMin: IST });
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].hostname, 'b.com');
  assert.equal(normalized[0].seconds, 300);
});

test('the minimum-duration filter judges the whole visit, not its midnight halves', () => {
  // 40 seconds of work that happens to straddle midnight must survive.
  const visits = [{ start: at('2026-09-25', 24 * 60) - 20_000, end: at('2026-09-26', 0) + 20_000, hostname: 'a.com', path: '/' }];
  const normalized = normalizeVisits(visits, { minSegmentSeconds: 30, offsetMin: IST });
  assert.equal(normalized.length, 2);
  assert.equal(normalized.reduce((sum, seg) => sum + seg.seconds, 0), 40);
});

test('zero and negative durations are dropped', () => {
  const normalized = normalizeVisits([
    { start: 1000, end: 1000 },
    { start: 5000, end: 1000 },
    { start: null, end: 1 },
  ], { minSegmentSeconds: 0, offsetMin: IST });
  assert.equal(normalized.length, 0);
});

test('refs are derived from the title when not stored', () => {
  const normalized = normalizeVisits([
    { start: at('2026-09-25', 10), end: at('2026-09-25', 20), hostname: 'a.com', path: '/', title: 'PAY-2214 retries' },
  ], { offsetMin: IST });
  assert.deepEqual(normalized[0].refs, ['PAY-2214']);
});

test('adjacent blocks for one client merge into a single line', () => {
  const blocks = [
    { dayKey: '2026-09-25', clientId: 'acme', projectId: null, billable: true, start: at('2026-09-25', 600), end: at('2026-09-25', 630), seconds: 1800, title: 'PAY-1', refs: ['PAY-1'], hostname: 'acme.atlassian.net' },
    { dayKey: '2026-09-25', clientId: 'acme', projectId: null, billable: true, start: at('2026-09-25', 632), end: at('2026-09-25', 650), seconds: 1080, title: 'PAY-2', refs: ['PAY-2'], hostname: 'acme.atlassian.net' },
  ];
  const merged = mergeBlocks(blocks, { mergeGapSeconds: 300 });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].visitCount, 2);
  assert.deepEqual(merged[0].refs, ['PAY-1', 'PAY-2']);
});

test('merging sums the parts and never bills the gap', () => {
  // 30 min, a 2 min gap, then 18 min. Honest total is 48 min, not 50.
  const blocks = [
    { dayKey: '2026-09-25', clientId: 'acme', projectId: null, billable: true, start: at('2026-09-25', 600), end: at('2026-09-25', 630), seconds: 1800 },
    { dayKey: '2026-09-25', clientId: 'acme', projectId: null, billable: true, start: at('2026-09-25', 632), end: at('2026-09-25', 650), seconds: 1080 },
  ];
  const merged = mergeBlocks(blocks, { mergeGapSeconds: 300 });
  assert.equal(merged[0].seconds, 2880);
  assert.ok(merged[0].seconds < (merged[0].end - merged[0].start) / 1000);
});

test('a gap wider than the threshold stays two lines', () => {
  const blocks = [
    { dayKey: '2026-09-25', clientId: 'acme', projectId: null, billable: true, start: at('2026-09-25', 540), end: at('2026-09-25', 570), seconds: 1800 },
    { dayKey: '2026-09-25', clientId: 'acme', projectId: null, billable: true, start: at('2026-09-25', 900), end: at('2026-09-25', 930), seconds: 1800 },
  ];
  assert.equal(mergeBlocks(blocks, { mergeGapSeconds: 300 }).length, 2);
});

test('different clients, projects, days and billable flags never merge', () => {
  const base = { start: at('2026-09-25', 600), end: at('2026-09-25', 610), seconds: 600, projectId: null, billable: true };
  const blocks = [
    { ...base, dayKey: '2026-09-25', clientId: 'a' },
    { ...base, dayKey: '2026-09-25', clientId: 'b' },
    { ...base, dayKey: '2026-09-25', clientId: 'a', projectId: 'p1' },
    { ...base, dayKey: '2026-09-25', clientId: 'a', billable: false },
    { ...base, dayKey: '2026-09-26', clientId: 'a' },
  ];
  assert.equal(mergeBlocks(blocks, { mergeGapSeconds: 3600 }).length, 5);
});
