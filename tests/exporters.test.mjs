import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  filenameFor,
  toBackupJSON,
  toCSV,
  toInvoiceText,
  toMarkdown,
  toStatusUpdate,
} from '../extension/src/core/exporters.js';
import { buildTimesheet } from '../extension/src/core/timesheet.js';
import { dayStart, MINUTE_MS, weekRange } from '../extension/src/core/time.js';
import { formatDayLabel, formatDuration, formatMoney, formatRangeLabel } from '../extension/src/core/format.js';

const IST = 330;
const at = (day, minutes) => dayStart(day, IST) + minutes * MINUTE_MS;
const range = weekRange(at('2026-09-25', 600), { weekStartsOn: 1, offsetMin: IST });

const clients = [{ id: 'acme', name: 'Acme, Corp "HQ"', rate: 120, projects: [] }];
const rules = [{ id: 'r1', kind: 'hostname', value: 'acme.atlassian.net', clientId: 'acme', billable: true, enabled: true }];
const visits = [
  { start: at('2026-09-21', 600), end: at('2026-09-21', 690), hostname: 'acme.atlassian.net', path: '/browse/PAY-2214', title: 'PAY-2214 refund, retries' },
  { start: at('2026-09-23', 540), end: at('2026-09-23', 585), hostname: 'acme.atlassian.net', path: '/browse/PAY-2231', title: 'PAY-2231 webhook' },
];

const sheet = buildTimesheet({
  visits,
  rules,
  clients,
  settings: { minSegmentSeconds: 30, mergeGapSeconds: 300, rounding: { incrementMinutes: 0 } },
  range,
  offsetMin: IST,
});

test('CSV has a stable header and one row per line', () => {
  const csv = toCSV(sheet, { currency: 'USD' });
  const rows = csv.split('\r\n');
  assert.equal(rows.length, 3);
  assert.equal(rows[0], 'Date,Client,Project,Billable,Hours,Billed Hours,Rate,Amount,Currency,References,Description');
  assert.ok(rows[1].startsWith('2026-09-21,'));
});

test('CSV quotes commas and doubles quotation marks', () => {
  const csv = toCSV(sheet, { currency: 'USD' });
  assert.ok(csv.includes('"Acme, Corp ""HQ"""'), 'client name must survive a spreadsheet round trip');
  assert.ok(csv.includes('"PAY-2214 — PAY-2214 refund, retries"'));
});

test('CSV hours are decimal, which is what invoicing tools import', () => {
  const csv = toCSV(sheet, { currency: 'USD' });
  assert.ok(csv.includes(',1.50,1.50,120.00,180.00,USD,'));
});

test('markdown carries the headline number a client will read first', () => {
  const md = toMarkdown(sheet, { currency: 'USD' });
  assert.ok(md.includes('## Timesheet — 21 Sep – 27 Sep 2026'));
  assert.ok(md.includes('**2.25 billable hours**'));
  assert.ok(md.includes('$270.00'));
  assert.ok(md.includes('| Client | Hours | Amount |'));
});

test('the free export is attributed, the paid one is not', () => {
  assert.ok(toMarkdown(sheet, { pro: false }).includes('Reconstructed with Billed'));
  assert.ok(!toMarkdown(sheet, { pro: true }).includes('Reconstructed with Billed'));
});

test('markdown warns about unassigned time instead of hiding it', () => {
  const withGap = buildTimesheet({
    visits: [...visits, { start: at('2026-09-22', 600), end: at('2026-09-22', 640), hostname: 'mystery.io', path: '/', title: 'Board' }],
    rules,
    clients,
    settings: { minSegmentSeconds: 30, mergeGapSeconds: 300, rounding: {} },
    range,
    offsetMin: IST,
  });
  assert.ok(toMarkdown(withGap).includes('tracked but not assigned'));
});

test('invoice text totals hours and money for one client', () => {
  const text = toInvoiceText(sheet, 'acme', { currency: 'USD' });
  assert.ok(text.startsWith('Acme, Corp "HQ" — 21 Sep – 27 Sep 2026'));
  assert.ok(text.includes('Total: 2.25 h × $120.00/h = $270.00'));
});

test('invoice text for an unknown client is empty, not a crash', () => {
  assert.equal(toInvoiceText(sheet, 'nobody'), '');
});

test('status update mode groups the same data without money', () => {
  const text = toStatusUpdate(sheet, { heading: 'Weekly update' });
  assert.ok(text.startsWith('Weekly update — 21 Sep – 27 Sep 2026'));
  assert.ok(text.includes('• Acme, Corp "HQ" — 2.25 h'));
  assert.ok(text.includes('Worked: PAY-2214, PAY-2231'));
  assert.ok(!text.includes('$'));
});

test('backup JSON round-trips', () => {
  const json = toBackupJSON({ visits, clients, rules, settings: { a: 1 } });
  const parsed = JSON.parse(json);
  assert.equal(parsed.format, 'billed.backup');
  assert.equal(parsed.visits.length, 2);
  assert.equal(parsed.clients[0].name, 'Acme, Corp "HQ"');
});

test('filenames describe the range', () => {
  assert.equal(filenameFor('timesheet', sheet, 'csv'), 'timesheet-2026-09-21_to_2026-09-27.csv');
});

test('formatting helpers are readable and locale-proof', () => {
  assert.equal(formatDuration(0), '—');
  assert.equal(formatDuration(45 * 60), '45m');
  assert.equal(formatDuration(3600), '1h');
  assert.equal(formatDuration(3600 + 25 * 60), '1h 25m');
  assert.equal(formatDayLabel('2026-09-25'), 'Fri 25 Sep');
  assert.equal(formatRangeLabel(['2026-09-21', '2026-09-27']), '21 Sep – 27 Sep 2026');
  assert.equal(formatMoney(1234.5, 'INR'), '₹1,234.50');
  assert.equal(formatMoney(12, 'USD'), '$12.00');
});
