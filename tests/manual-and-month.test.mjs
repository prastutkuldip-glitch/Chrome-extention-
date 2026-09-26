import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createManualEntry } from '../extension/src/core/defaults.js';
import { buildTimesheet } from '../extension/src/core/timesheet.js';
import { toCSV, toInvoiceText } from '../extension/src/core/exporters.js';
import { can, PLAN_LIMITS } from '../extension/src/core/plan.js';
import {
  DAY_MS,
  dayStart,
  MINUTE_MS,
  monthLabel,
  monthRange,
  shiftMonths,
  weekRange,
} from '../extension/src/core/time.js';

const IST = 330;
const at = (day, minutes) => dayStart(day, IST) + minutes * MINUTE_MS;

const clients = [{
  id: 'acme',
  name: 'Acme Corp',
  rate: 120,
  projects: [{ id: 'pj1', name: 'Migration' }],
}];
const rules = [{ id: 'r1', kind: 'hostname', value: 'acme.atlassian.net', clientId: 'acme', enabled: true, billable: true }];
const settings = { minSegmentSeconds: 30, mergeGapSeconds: 300, rounding: { incrementMinutes: 0 } };
const week = weekRange(at('2026-09-23', 600), { weekStartsOn: 1, offsetMin: IST });

// --- manual entry: the other half of "we never invent time" ----------------

test('a manual entry lands on the timesheet without any rule', () => {
  const entry = createManualEntry({
    clientId: 'acme',
    dayKey: '2026-09-23',
    minutes: 90,
    note: 'Kick-off call with Dana',
    offsetMin: IST,
  });

  const sheet = buildTimesheet({ visits: [entry], rules: [], clients, settings, range: week, offsetMin: IST });
  assert.equal(sheet.lines.length, 1);
  assert.equal(sheet.lines[0].clientName, 'Acme Corp');
  assert.equal(sheet.lines[0].seconds, 5400);
  assert.equal(sheet.lines[0].amount, 180);
  assert.equal(sheet.lines[0].manual, true);
  assert.equal(sheet.totals.unassignedSeconds, 0, 'a manual entry must never look unassigned');
});

test('the note becomes the invoice description', () => {
  const entry = createManualEntry({ clientId: 'acme', dayKey: '2026-09-23', minutes: 60, note: 'Quarterly review call', offsetMin: IST });
  const sheet = buildTimesheet({ visits: [entry], rules: [], clients, settings, range: week, offsetMin: IST });
  assert.match(sheet.lines[0].description, /Quarterly review call/);
  assert.match(toInvoiceText(sheet, 'acme', { currency: 'USD' }), /Quarterly review call/);
});

test('a manual entry can be non-billable', () => {
  const entry = createManualEntry({ clientId: 'acme', dayKey: '2026-09-23', minutes: 45, note: 'Internal sync', billable: false, offsetMin: IST });
  const sheet = buildTimesheet({ visits: [entry], rules: [], clients, settings, range: week, offsetMin: IST });
  assert.equal(sheet.totals.billableSeconds, 0);
  assert.equal(sheet.totals.nonBillableSeconds, 2700);
  assert.equal(sheet.lines[0].amount, 0);
});

test('a manual entry can carry a project', () => {
  const entry = createManualEntry({ clientId: 'acme', projectId: 'pj1', dayKey: '2026-09-23', minutes: 30, note: 'Cutover planning', offsetMin: IST });
  const sheet = buildTimesheet({ visits: [entry], rules: [], clients, settings, range: week, offsetMin: IST });
  assert.equal(sheet.lines[0].projectName, 'Migration');
});

test('an explicit client wins over any rule that might also match', () => {
  const entry = {
    ...createManualEntry({ clientId: 'acme', dayKey: '2026-09-23', minutes: 60, note: 'Call', offsetMin: IST }),
    hostname: 'somewhere-else.com',
  };
  const sheet = buildTimesheet({
    visits: [entry],
    rules: [{ id: 'x', kind: 'hostname', value: 'somewhere-else.com', clientId: 'ghost', enabled: true }],
    clients,
    settings,
    range: week,
    offsetMin: IST,
  });
  assert.equal(sheet.lines[0].clientId, 'acme');
});

test('a manual entry pointing at a deleted client does not crash the sheet', () => {
  const entry = createManualEntry({ clientId: 'gone', dayKey: '2026-09-23', minutes: 60, note: 'Call', offsetMin: IST });
  const sheet = buildTimesheet({ visits: [entry], rules: [], clients, settings, range: week, offsetMin: IST });
  assert.equal(sheet.lines.length, 0);
  assert.equal(sheet.totals.unassignedSeconds, 3600, 'it falls back to the review queue');
});

test('manual and tracked time coexist and merge sensibly', () => {
  const tracked = { start: at('2026-09-23', 600), end: at('2026-09-23', 660), hostname: 'acme.atlassian.net', path: '/browse/PAY-1', title: 'PAY-1 fix' };
  const manual = createManualEntry({ clientId: 'acme', dayKey: '2026-09-23', minutes: 30, note: 'Call', startHour: 15, offsetMin: IST });
  const sheet = buildTimesheet({ visits: [tracked, manual], rules, clients, settings, range: week, offsetMin: IST });
  assert.equal(sheet.totals.billableSeconds, 90 * 60);
  assert.equal(sheet.lines.length, 2, 'far apart in the day, so two lines');
  assert.equal(sheet.lines.filter((line) => line.manual).length, 1);
});

test('manual entries carry ids so a single line can be deleted precisely', () => {
  const entry = createManualEntry({ clientId: 'acme', dayKey: '2026-09-23', minutes: 60, note: 'Call', offsetMin: IST });
  const sheet = buildTimesheet({ visits: [entry], rules: [], clients, settings, range: week, offsetMin: IST });
  assert.deepEqual(sheet.lines[0].visitIds, [entry.id]);
});

test('manual hours export like any other line', () => {
  const entry = createManualEntry({ clientId: 'acme', dayKey: '2026-09-23', minutes: 90, note: 'Kick-off call', offsetMin: IST });
  const sheet = buildTimesheet({ visits: [entry], rules: [], clients, settings, range: week, offsetMin: IST });
  const csv = toCSV(sheet, { currency: 'USD' });
  assert.match(csv, /2026-09-23,Acme Corp,,yes,1\.50,1\.50,120\.00,180\.00,USD,,Kick-off call/);
});

test('rounding minutes down to a minimum keeps a tiny entry real', () => {
  const entry = createManualEntry({ clientId: 'acme', dayKey: '2026-09-23', minutes: 0, note: 'x', offsetMin: IST });
  assert.ok(entry.end > entry.start, 'zero minutes still produces a positive duration');
});

// --- month view: what "unlimited history" is actually for ------------------

test('monthRange covers a whole calendar month', () => {
  const range = monthRange(at('2026-09-23', 600), IST);
  assert.equal(range.days[0], '2026-09-01');
  assert.equal(range.days[range.days.length - 1], '2026-09-30');
  assert.equal(range.days.length, 30);
});

test('monthRange handles February in a leap year', () => {
  const range = monthRange(dayStart('2028-02-15', IST), IST);
  assert.equal(range.days.length, 29);
  assert.equal(range.days[28], '2028-02-29');
});

test('shiftMonths crosses a year boundary correctly', () => {
  const january = monthRange(dayStart('2027-01-10', IST), IST);
  const december = shiftMonths(january, -1, IST);
  assert.equal(december.days[0], '2026-12-01');
  assert.equal(december.days.length, 31);

  const forward = shiftMonths(december, 2, IST);
  assert.equal(forward.days[0], '2027-02-01');
});

test('shifting from a 31-day month into a 30-day month does not overflow', () => {
  const may = monthRange(dayStart('2026-05-31', IST), IST);
  const june = shiftMonths(may, 1, IST);
  assert.equal(june.days[0], '2026-06-01');
  assert.equal(june.days.length, 30);
});

test('monthLabel reads like a heading', () => {
  assert.equal(monthLabel(dayStart('2026-09-23', IST) + 1000, IST), 'September 2026');
});

test('a month range aggregates every day in it', () => {
  const visits = ['2026-09-02', '2026-09-15', '2026-09-28'].map((day, index) => createManualEntry({
    clientId: 'acme', dayKey: day, minutes: 60 * (index + 1), note: `Call ${index}`, offsetMin: IST,
  }));
  const sheet = buildTimesheet({
    visits, rules: [], clients, settings, range: monthRange(at('2026-09-15', 600), IST), offsetMin: IST,
  });
  assert.equal(sheet.days.length, 30);
  assert.equal(sheet.totals.billableSeconds / 3600, 6);
  assert.equal(sheet.byClient[0].amount, 720);
});

// --- plan flags must be real ---------------------------------------------

test('every declared feature flag is actually different between plans', () => {
  for (const [feature, proValue] of Object.entries(PLAN_LIMITS.pro.features)) {
    assert.equal(proValue, true, `pro.${feature} should be enabled`);
    assert.notEqual(
      PLAN_LIMITS.free.features[feature],
      proValue,
      `${feature} is identical on both plans, so it is not a gate`,
    );
  }
});

test('the month view is a Pro gate', () => {
  assert.equal(can('free', 'monthView'), false);
  assert.equal(can('pro', 'monthView'), true);
});

test('a week is still a week', () => {
  assert.equal(week.to - week.from, 7 * DAY_MS);
});
