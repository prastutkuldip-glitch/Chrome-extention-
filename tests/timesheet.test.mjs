import { test } from 'node:test';
import assert from 'node:assert/strict';

import { amountFor, buildTimesheet, roundSeconds } from '../extension/src/core/timesheet.js';
import { dayStart, MINUTE_MS, weekRange } from '../extension/src/core/time.js';

const IST = 330;
const at = (day, minutes) => dayStart(day, IST) + minutes * MINUTE_MS;

test('no increment means no rounding', () => {
  assert.equal(roundSeconds(1234, { incrementMinutes: 0 }), 1234);
});

test('nearest rounding goes both ways', () => {
  assert.equal(roundSeconds(7 * 60, { incrementMinutes: 15 }), 0 + 900); // 7m -> 15m
  assert.equal(roundSeconds(6 * 60, { incrementMinutes: 15 }), 900); // minimum increment
  assert.equal(roundSeconds(22 * 60, { incrementMinutes: 15 }), 900); // 22m -> 15m
  assert.equal(roundSeconds(23 * 60, { incrementMinutes: 15 }), 1800); // 23m -> 30m
});

test('up rounding always favours the invoice', () => {
  assert.equal(roundSeconds(61, { incrementMinutes: 6, direction: 'up' }), 360);
  assert.equal(roundSeconds(360, { incrementMinutes: 6, direction: 'up' }), 360);
});

test('down rounding is allowed to reach zero', () => {
  assert.equal(roundSeconds(5 * 60, { incrementMinutes: 15, direction: 'down' }), 0);
  assert.equal(roundSeconds(20 * 60, { incrementMinutes: 15, direction: 'down' }), 900);
});

test('real work never rounds away to nothing', () => {
  assert.equal(roundSeconds(40, { incrementMinutes: 15 }), 900);
  assert.equal(roundSeconds(0, { incrementMinutes: 15 }), 0);
});

test('minimum increment can be switched off', () => {
  assert.equal(roundSeconds(40, { incrementMinutes: 15, billMinimumIncrement: false }), 0);
});

test('money is hours times rate, to the cent', () => {
  assert.equal(amountFor(3600, 120), 120);
  assert.equal(amountFor(1800, 125), 62.5);
  assert.equal(amountFor(2700, 133.33), 100);
});

const clients = [
  { id: 'acme', name: 'Acme Corp', rate: 120, projects: [] },
  { id: 'globex', name: 'Globex', rate: 90, projects: [{ id: 'p1', name: 'Website' }] },
];

const rules = [
  { id: 'r1', kind: 'hostname', value: 'acme.atlassian.net', clientId: 'acme', billable: true, enabled: true },
  { id: 'r2', kind: 'path', value: 'github.com/globex', clientId: 'globex', projectId: 'p1', billable: true, enabled: true },
  { id: 'r3', kind: 'hostname', value: 'linkedin.com', clientId: 'acme', billable: false, enabled: true },
];

function fixture() {
  return [
    // Monday: 2 hours on Acme, in two chunks 1 minute apart
    { start: at('2026-09-21', 600), end: at('2026-09-21', 690), hostname: 'acme.atlassian.net', path: '/browse/PAY-2214', title: 'PAY-2214 refund retries' },
    { start: at('2026-09-21', 691), end: at('2026-09-21', 721), hostname: 'acme.atlassian.net', path: '/browse/PAY-2231', title: 'PAY-2231 webhook' },
    // Monday: 50 minutes on Globex
    { start: at('2026-09-21', 780), end: at('2026-09-21', 830), hostname: 'github.com', path: '/globex/site/pull/12', title: 'Nav fix (#12)' },
    // Tuesday: 25 minutes unassigned
    { start: at('2026-09-22', 600), end: at('2026-09-22', 625), hostname: 'app.hey-tool.io', path: '/board/7', title: 'Sprint board' },
    // Tuesday: 20 minutes non-billable admin
    { start: at('2026-09-22', 700), end: at('2026-09-22', 720), hostname: 'linkedin.com', path: '/feed', title: 'Feed' },
    // Noise that must be dropped
    { start: at('2026-09-22', 730), end: at('2026-09-22', 730) + 4000, hostname: 'acme.atlassian.net', path: '/x', title: 'flicker' },
  ];
}

const range = weekRange(at('2026-09-25', 600), { weekStartsOn: 1, offsetMin: IST });
const settings = {
  minSegmentSeconds: 30,
  mergeGapSeconds: 300,
  rounding: { incrementMinutes: 0, direction: 'nearest' },
};

test('a week is assembled into days, clients and totals', () => {
  const sheet = buildTimesheet({ visits: fixture(), rules, clients, settings, range, offsetMin: IST });

  assert.equal(sheet.days.length, 7);
  assert.equal(sheet.totals.clientCount, 2);

  // Acme 90 + 30 = 120 billable, Globex 50 billable, LinkedIn 20 non-billable.
  assert.equal(sheet.totals.assignedSeconds / 60, 190);
  assert.equal(sheet.totals.billableSeconds / 60, 170);
  assert.equal(sheet.totals.nonBillableSeconds / 60, 20);
  assert.equal(sheet.totals.unassignedSeconds / 60, 25);
});

test('two chunks one minute apart become one timesheet line with both refs', () => {
  const sheet = buildTimesheet({ visits: fixture(), rules, clients, settings, range, offsetMin: IST });
  const monday = sheet.days.find((day) => day.dayKey === '2026-09-21');
  const acmeLine = monday.lines.find((line) => line.clientId === 'acme');
  assert.equal(acmeLine.visitCount, 2);
  assert.equal(acmeLine.seconds / 60, 120);
  assert.deepEqual(acmeLine.refs, ['PAY-2214', 'PAY-2231']);
  assert.match(acmeLine.description, /PAY-2214, PAY-2231/);
});

test('money only counts billable time', () => {
  const sheet = buildTimesheet({ visits: fixture(), rules, clients, settings, range, offsetMin: IST });
  const acme = sheet.byClient.find((client) => client.clientId === 'acme');
  assert.equal(acme.billableSeconds / 60, 120);
  assert.equal(acme.seconds / 60, 140); // includes the non-billable 20m
  assert.equal(acme.amount, 240); // 2h x 120, admin time excluded
});

test('projects flow through to the line', () => {
  const sheet = buildTimesheet({ visits: fixture(), rules, clients, settings, range, offsetMin: IST });
  const globexLine = sheet.lines.find((line) => line.clientId === 'globex');
  assert.equal(globexLine.projectName, 'Website');
  assert.equal(globexLine.amount, 75); // 50m x 90/h
});

test('rounding is applied per line and lifts the billed total', () => {
  const sheet = buildTimesheet({
    visits: fixture(),
    rules,
    clients,
    settings: { ...settings, rounding: { incrementMinutes: 15, direction: 'up' } },
    range,
    offsetMin: IST,
  });
  // Acme 120m stays 120m; Globex 50m -> 60m.
  assert.equal(sheet.totals.roundedBillableSeconds / 60, 180);
  const globex = sheet.byClient.find((client) => client.clientId === 'globex');
  assert.equal(globex.roundedSeconds / 60, 60);
  assert.equal(globex.amount, 90);
});

test('unassigned time is surfaced as a review queue, not billed', () => {
  const sheet = buildTimesheet({ visits: fixture(), rules, clients, settings, range, offsetMin: IST });
  assert.equal(sheet.unassigned.length, 1);
  assert.equal(sheet.unassigned[0].key, 'app.hey-tool.io');
  assert.equal(sheet.unassigned[0].ruleValue, 'app.hey-tool.io');
  assert.ok(sheet.totals.amount > 0);
  assert.ok(!sheet.lines.some((line) => line.hostnames?.includes('app.hey-tool.io')));
});

test('visits outside the range are excluded', () => {
  const visits = [
    ...fixture(),
    { start: at('2026-09-14', 600), end: at('2026-09-14', 700), hostname: 'acme.atlassian.net', path: '/browse/OLD-1', title: 'OLD-1' },
  ];
  const sheet = buildTimesheet({ visits, rules, clients, settings, range, offsetMin: IST });
  assert.equal(sheet.totals.billableSeconds / 60, 170);
});

test('a visit straddling the range boundary is clipped, not dropped', () => {
  const visits = [{
    start: range.from - 30 * MINUTE_MS,
    end: range.from + 30 * MINUTE_MS,
    hostname: 'acme.atlassian.net',
    path: '/browse/PAY-1',
    title: 'PAY-1',
  }];
  const sheet = buildTimesheet({ visits, rules, clients, settings, range, offsetMin: IST });
  assert.equal(sheet.totals.billableSeconds / 60, 30);
});

test('rules pointing at a deleted client fall back to unassigned', () => {
  const sheet = buildTimesheet({
    visits: fixture(),
    rules: [{ id: 'x', kind: 'hostname', value: 'acme.atlassian.net', clientId: 'ghost', enabled: true }],
    clients,
    settings,
    range,
    offsetMin: IST,
  });
  assert.ok(sheet.unassigned.some((group) => group.key === 'acme.atlassian.net'));
});

test('an empty week produces a valid, empty sheet', () => {
  const sheet = buildTimesheet({ visits: [], rules, clients, settings, range, offsetMin: IST });
  assert.equal(sheet.days.length, 7);
  assert.equal(sheet.lines.length, 0);
  assert.equal(sheet.totals.amount, 0);
  assert.equal(sheet.totals.trackedSeconds, 0);
});
