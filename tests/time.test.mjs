import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DAY_MS,
  dayEnd,
  dayKey,
  dayKeysBetween,
  dayStart,
  localDayOfWeek,
  shiftWeeks,
  weekRange,
} from '../extension/src/core/time.js';

const IST = 330; // +05:30

test('dayKey respects the supplied timezone offset', () => {
  // 2026-09-25T19:00Z is already 26 Sep in India.
  const ts = Date.parse('2026-09-25T19:00:00.000Z');
  assert.equal(dayKey(ts, 0), '2026-09-25');
  assert.equal(dayKey(ts, IST), '2026-09-26');
});

test('dayStart and dayEnd bracket exactly one day', () => {
  const start = dayStart('2026-09-25', IST);
  assert.equal(new Date(start).toISOString(), '2026-09-24T18:30:00.000Z');
  assert.equal(dayEnd('2026-09-25', IST) - start, DAY_MS);
  assert.equal(dayKey(start, IST), '2026-09-25');
  assert.equal(dayKey(dayEnd('2026-09-25', IST) - 1, IST), '2026-09-25');
});

test('25 Sep 2026 is a Friday', () => {
  assert.equal(localDayOfWeek(dayStart('2026-09-25', IST) + 1000, IST), 5);
});

test('weekRange starting Monday covers Mon..Sun', () => {
  const range = weekRange(dayStart('2026-09-25', IST) + 1000, { weekStartsOn: 1, offsetMin: IST });
  assert.equal(range.days.length, 7);
  assert.equal(range.days[0], '2026-09-21');
  assert.equal(range.days[6], '2026-09-27');
  assert.equal(range.to - range.from, 7 * DAY_MS);
});

test('weekRange starting Sunday shifts the window', () => {
  const range = weekRange(dayStart('2026-09-25', IST) + 1000, { weekStartsOn: 0, offsetMin: IST });
  assert.equal(range.days[0], '2026-09-20');
  assert.equal(range.days[6], '2026-09-26');
});

test('dayKeysBetween lists every touched day once', () => {
  const from = dayStart('2026-02-27', IST);
  const keys = dayKeysBetween(from, from + 3 * DAY_MS, IST);
  assert.deepEqual(keys, ['2026-02-27', '2026-02-28', '2026-03-01']);
});

test('shiftWeeks moves a week backwards without changing its length', () => {
  const range = weekRange(dayStart('2026-09-25', IST) + 1000, { weekStartsOn: 1, offsetMin: IST });
  const previous = shiftWeeks(range, -1, IST);
  assert.equal(previous.days[0], '2026-09-14');
  assert.equal(previous.days.length, 7);
});
