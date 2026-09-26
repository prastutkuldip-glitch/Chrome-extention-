/**
 * Exporters. The whole point of the product is getting data *out* on Friday,
 * so these are first-class, pure and tested.
 */

import { formatDayLabel, formatDecimalHours, formatMoney, formatRangeLabel } from './format.js';

const FREE_FOOTER = 'Reconstructed with Billed — billed.app';

function escapeCsv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A CSV that imports cleanly into Harvest, Toggl, FreshBooks, Xero, QuickBooks
 * and, above all, a spreadsheet.
 */
export function toCSV(timesheet, options = {}) {
  const { currency = 'USD' } = options;
  const header = [
    'Date', 'Client', 'Project', 'Billable', 'Hours', 'Billed Hours',
    'Rate', 'Amount', 'Currency', 'References', 'Description',
  ];
  const rows = timesheet.lines
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((line) => [
      line.dayKey,
      line.clientName,
      line.projectName || '',
      line.billable ? 'yes' : 'no',
      formatDecimalHours(line.seconds),
      formatDecimalHours(line.roundedSeconds),
      line.rate ? line.rate.toFixed(2) : '',
      line.amount ? line.amount.toFixed(2) : '',
      line.amount ? currency : '',
      (line.refs || []).join(' '),
      line.description || '',
    ]);

  return [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n');
}

/** A weekly summary you can paste into a client email or a Slack thread. */
export function toMarkdown(timesheet, options = {}) {
  const { currency = 'USD', pro = true } = options;
  const days = timesheet.days.map((day) => day.dayKey);
  const out = [];

  out.push(`## Timesheet — ${formatRangeLabel(days)}`, '');
  out.push(`**${formatDecimalHours(timesheet.totals.roundedBillableSeconds)} billable hours**`
    + (timesheet.totals.amount ? ` · ${formatMoney(timesheet.totals.amount, currency)}` : ''));
  out.push('');

  if (timesheet.byClient.length) {
    out.push('| Client | Hours | Amount |', '| --- | --- | --- |');
    for (const client of timesheet.byClient) {
      out.push(`| ${client.name} | ${formatDecimalHours(client.roundedSeconds)} | ${client.amount ? formatMoney(client.amount, currency) : '—'} |`);
    }
    out.push('');
  }

  for (const client of timesheet.byClient) {
    out.push(`### ${client.name} — ${formatDecimalHours(client.roundedSeconds)} h`);
    const clientLines = timesheet.lines
      .filter((line) => line.clientId === client.clientId)
      .sort((a, b) => a.start - b.start);
    for (const line of clientLines) {
      out.push(`- **${formatDayLabel(line.dayKey)}** · ${formatDecimalHours(line.roundedSeconds)} h — ${line.description || 'work'}`);
    }
    out.push('');
  }

  if (timesheet.totals.unassignedSeconds > 60) {
    out.push(`_${formatDecimalHours(timesheet.totals.unassignedSeconds)} h tracked but not assigned to a client._`, '');
  }

  if (!pro) out.push('', `_${FREE_FOOTER}_`);
  return out.join('\n').trim();
}

/** Plain-text invoice lines for one client — ready to paste into any invoice. */
export function toInvoiceText(timesheet, clientId, options = {}) {
  const { currency = 'USD' } = options;
  const client = timesheet.byClient.find((entry) => entry.clientId === clientId);
  if (!client) return '';

  const lines = timesheet.lines
    .filter((line) => line.clientId === clientId && line.billable)
    .sort((a, b) => a.start - b.start);

  const out = [
    `${client.name} — ${formatRangeLabel(timesheet.days.map((day) => day.dayKey))}`,
    '',
  ];
  for (const line of lines) {
    out.push(`${line.dayKey}  ${formatDecimalHours(line.roundedSeconds).padStart(6)} h  ${line.description || 'work'}`);
  }
  out.push('');
  out.push(`Total: ${formatDecimalHours(client.roundedSeconds)} h`
    + (client.rate ? ` × ${formatMoney(client.rate, currency)}/h = ${formatMoney(client.amount, currency)}` : ''));
  return out.join('\n');
}

/**
 * The bonus mode for salaried users: the same data as a status update or a
 * performance-review bullet list, grouped by project rather than by money.
 */
export function toStatusUpdate(timesheet, options = {}) {
  const { heading = 'Status update' } = options;
  const out = [`${heading} — ${formatRangeLabel(timesheet.days.map((day) => day.dayKey))}`, ''];

  for (const client of timesheet.byClient) {
    const clientLines = timesheet.lines.filter((line) => line.clientId === client.clientId);
    const refs = [...new Set(clientLines.flatMap((line) => line.refs || []))].slice(0, 8);
    const titles = [...new Set(clientLines.flatMap((line) => line.titles || []))].slice(0, 5);
    out.push(`• ${client.name} — ${formatDecimalHours(client.roundedSeconds)} h`);
    if (refs.length) out.push(`    Worked: ${refs.join(', ')}`);
    for (const title of titles) out.push(`    – ${title}`);
    out.push('');
  }

  return out.join('\n').trim();
}

/** Full local backup, so nobody is ever locked inside the extension. */
export function toBackupJSON({ visits, clients, rules, settings }) {
  return JSON.stringify(
    {
      format: 'billed.backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      clients,
      rules,
      settings,
      visits,
    },
    null,
    2,
  );
}

export function filenameFor(prefix, timesheet, extension) {
  const days = timesheet.days.map((day) => day.dayKey);
  const first = days[0] || 'export';
  const last = days[days.length - 1] || first;
  return `${prefix}-${first}_to_${last}.${extension}`;
}
