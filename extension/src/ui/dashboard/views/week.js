/**
 * The week view — the screen the product lives or dies by.
 *
 * Its job on a Friday afternoon: show the hours, show what is still unassigned,
 * make assigning it a single click, and get the result out of the browser.
 */

import { el, copyText, downloadText, modal, toast } from '../../shared/dom.js';
import { createClient, createRule, CLIENT_COLORS } from '../../../core/defaults.js';
import { canAddClient, can } from '../../../core/plan.js';
import {
  formatDayLabel,
  formatDecimalHours,
  formatDuration,
  formatMoney,
  formatRangeLabel,
  pluralize,
} from '../../../core/format.js';
import { filenameFor, toCSV, toInvoiceText, toMarkdown, toStatusUpdate } from '../../../core/exporters.js';
import { deleteVisitsBetween, deleteVisitsByHostname } from '../../../platform/db.js';
import { DAY_MS } from '../../../core/time.js';

export function renderWeek(ctx) {
  const { app } = ctx;
  const sheet = app.sheet;
  const nodes = [weekNav(ctx), statGrid(ctx)];

  if (app.limited) {
    nodes.push(el('div.banner.section', {}, [
      el('span', { text: 'The free plan shows the last 7 days. Older weeks are still being recorded on this device — upgrading reveals them. ' }),
      el('a', { href: '#', text: 'See Pro', on: { click: (event) => { event.preventDefault(); ctx.openUpgrade(); } } }),
    ]));
  }

  if (sheet.unassigned.length) nodes.push(reviewSection(ctx));
  nodes.push(timesheetSection(ctx));
  if (sheet.lines.length) nodes.push(exportSection(ctx));
  return nodes;
}

// ------------------------------------------------------------------ header

function weekNav(ctx) {
  const { app } = ctx;
  const days = app.sheet.days.map((day) => day.dayKey);
  const canGoBack = can(app.plan, 'multiWeek');

  const shift = (weeks) => {
    if (weeks < 0 && !canGoBack) {
      ctx.openUpgrade();
      return;
    }
    app.anchor += weeks * 7 * DAY_MS;
    ctx.refresh();
  };

  return el('div.week-nav', {}, [
    el('button.btn.btn-sm', {
      text: '‹',
      title: canGoBack ? 'Previous week' : 'Previous weeks are a Pro feature',
      on: { click: () => shift(-1) },
    }),
    el('div.week-label', { text: formatRangeLabel(days) }),
    el('button.btn.btn-sm', { text: '›', title: 'Next week', on: { click: () => shift(1) } }),
    el('button.btn.btn-sm.btn-ghost', {
      text: 'This week',
      on: {
        click: () => {
          app.anchor = Date.now();
          ctx.refresh();
        },
      },
    }),
    el('span.grow'),
    roundingNote(ctx),
  ]);
}

function roundingNote(ctx) {
  const { app } = ctx;
  const rounding = app.state.settings.billing.rounding;
  if (app.plan !== 'pro' || !rounding.incrementMinutes) return null;
  return el('span.rounding-note', {
    text: `Rounded ${rounding.direction} to ${rounding.incrementMinutes} min`,
  });
}

function statGrid(ctx) {
  const { app } = ctx;
  const totals = app.sheet.totals;
  const rounded = totals.roundedBillableSeconds;
  const diff = rounded - totals.billableSeconds;

  return el('div.stat-grid', {}, [
    el('div.card.stat.stat-accent', {}, [
      el('div.stat-label', { text: 'Billable this week' }),
      el('div.stat-value', { text: formatDecimalHours(rounded) }),
      el('div.stat-note', {
        text: diff > 30
          ? `${formatDecimalHours(totals.billableSeconds)} h tracked, ${formatDecimalHours(diff)} h added by rounding`
          : `${formatDuration(totals.trackedSeconds)} tracked in total`,
      }),
    ]),
    el('div.card.stat', {}, [
      el('div.stat-label', { text: 'Ready to invoice' }),
      el('div.stat-value', { text: totals.amount ? formatMoney(totals.amount, app.currency) : '—' }),
      el('div.stat-note', {
        text: totals.amount
          ? `across ${pluralize(totals.clientCount, 'client')}`
          : 'Add an hourly rate to a client',
      }),
    ]),
    totals.unassignedSeconds >= 60
      ? el('div.card.stat.stat-warn', {}, [
        el('div.stat-label', { text: 'Unassigned' }),
        el('div.stat-value', { text: formatDecimalHours(totals.unassignedSeconds) }),
        el('div.stat-note', { text: `${pluralize(app.sheet.unassigned.length, 'site')} waiting — this is the time you lose` }),
      ])
      : el('div.card.stat', {}, [
        el('div.stat-label', { text: 'Unassigned' }),
        el('div.stat-value', { text: '0.00' }),
        el('div.stat-note', { text: 'Nothing waiting. Nice.' }),
      ]),
    el('div.card.stat', {}, [
      el('div.stat-label', { text: 'Non-billable' }),
      el('div.stat-value', { text: formatDecimalHours(totals.nonBillableSeconds) }),
      el('div.stat-note', { text: 'Admin, sales, your own business' }),
    ]),
  ]);
}

// ------------------------------------------------------------------ review queue

function reviewSection(ctx) {
  const { app } = ctx;
  const groups = app.sheet.unassigned;

  return el('section.section', {}, [
    el('div.section-head', {}, [
      el('h2', { text: 'Needs review' }),
      el('span.pill.pill-warn', { text: formatDuration(app.sheet.totals.unassignedSeconds) }),
      el('span.grow'),
      el('span.tiny.subtle', { text: 'Assign once — the rule applies to every future visit.' }),
    ]),
    el('div.card', {}, groups.map((group) => reviewItem(ctx, group))),
  ]);
}

function reviewItem(ctx, group) {
  const { app } = ctx;
  const clients = app.state.clients.filter((client) => !client.archived);

  const select = el('select.select.input-sm', {}, [
    el('option', { value: '', text: 'Assign to…' }),
    ...clients.map((client) => el('option', { value: client.id, text: client.name })),
    el('option', { value: '__new__', text: `+ New client "${group.label}"` }),
    el('option', { value: '__nonbillable__', text: 'Not billable (track only)' }),
  ]);

  return el('div.review-item', {}, [
    el('div.review-main', {}, [
      el('div.review-title', {}, [
        el('span', { text: group.label }),
        el('span.tiny.subtle.mono', { text: group.ruleValue }),
        ...(group.refs || []).slice(0, 3).map((ref) => el('span.ref', { text: ref })),
      ]),
      group.sampleTitles.length
        ? el('div.review-sample.truncate', { text: group.sampleTitles.slice(0, 2).join(' · ') })
        : null,
      el('div.tiny.subtle', { text: `${pluralize(group.visits, 'visit')}` }),
    ]),
    el('div.review-hours', { text: formatDuration(group.seconds) }),
    el('div.review-actions', {}, [
      select,
      el('button.btn.btn-sm.btn-primary', {
        text: 'Assign',
        on: { click: () => assignGroup(ctx, group, select.value) },
      }),
      el('button.btn.btn-sm.btn-ghost', {
        text: 'Ignore',
        title: 'Never track this site again, and delete what was recorded',
        on: { click: () => ignoreGroup(ctx, group) },
      }),
    ]),
  ]);
}

async function assignGroup(ctx, group, choice) {
  const { app } = ctx;
  if (!choice) {
    toast('Pick a client first.', 'warn');
    return;
  }

  let clientId = choice;
  let billable = true;

  if (choice === '__nonbillable__') {
    const existing = app.state.clients.find((client) => client.name === 'Non-billable');
    if (existing) {
      clientId = existing.id;
    } else {
      if (!canAddClient(app.plan, app.state.clients.filter((client) => !client.archived).length)) {
        ctx.openUpgrade();
        return;
      }
      const client = createClient({ name: 'Non-billable', rate: 0, color: '#8892a0', billable: false });
      await ctx.saveClients([...app.state.clients, client]);
      clientId = client.id;
    }
    billable = false;
  } else if (choice === '__new__') {
    if (!canAddClient(app.plan, app.state.clients.filter((client) => !client.archived).length)) {
      ctx.openUpgrade();
      return;
    }
    const client = createClient({
      name: group.label,
      rate: app.state.settings.billing.defaultRate,
      color: CLIENT_COLORS[app.state.clients.length % CLIENT_COLORS.length],
    });
    await ctx.saveClients([...app.state.clients, client]);
    clientId = client.id;
  }

  const rule = createRule({ clientId, kind: group.ruleKind, value: group.ruleValue, billable });
  await ctx.saveRules([...app.state.rules, rule]);

  const name = app.state.clients.find((client) => client.id === clientId)?.name || 'client';
  toast(`${group.label} \u203a ${name}`);
}

function ignoreGroup(ctx, group) {
  const { app } = ctx;
  const hostname = group.key.split('/')[0];

  const { close } = modal({
    title: `Stop tracking ${hostname}?`,
    body: [
      el('p', { text: `${hostname} will be added to your privacy blocklist, so Billed stops recording it from now on.` }),
      el('p.muted.small', { text: `The ${formatDuration(group.seconds)} already recorded for this site will be deleted from this device.` }),
    ],
    actions: [
      el('button.btn', { text: 'Cancel', on: { click: () => close() } }),
      el('button.btn.btn-danger', {
        text: 'Stop tracking and delete',
        on: {
          click: async () => {
            close();
            const settings = structuredClone(app.state.settings);
            if (!settings.privacy.blocklist.includes(hostname)) settings.privacy.blocklist.push(hostname);
            await ctx.saveSettings(settings);
            await deleteVisitsByHostname(hostname);
            await ctx.reload();
            toast(`${hostname} is no longer tracked.`);
          },
        },
      }),
    ],
  });
}

// ------------------------------------------------------------------ timesheet

function timesheetSection(ctx) {
  const { app } = ctx;
  const days = app.sheet.days.filter((day) => day.lines.length);

  if (!days.length) {
    return el('section.section', {}, [
      el('div.section-head', {}, [el('h2', { text: 'Timesheet' })]),
      el('div.empty', {}, [
        el('div.strong', { text: 'Nothing assigned to a client this week yet.' }),
        el('div.small', {
          text: app.sheet.totals.trackedSeconds > 0
            ? 'Your time is recorded — assign a site above and it will appear here.'
            : 'Keep working. Billed records quietly in the background and fills this in.',
        }),
      ]),
    ]);
  }

  return el('section.section', {}, [
    el('div.section-head', {}, [
      el('h2', { text: 'Timesheet' }),
      el('span.grow'),
      el('span.tiny.subtle', { text: 'Hours are summed from real activity. Gaps are never billed.' }),
    ]),
    ...days.map((day) => dayBlock(ctx, day)),
  ]);
}

function dayBlock(ctx, day) {
  const { app } = ctx;
  return el('div.day', {}, [
    el('div.day-head', {}, [
      el('span', { text: formatDayLabel(day.dayKey) }),
      el('span.grow'),
      day.amount ? el('span.muted', { text: formatMoney(day.amount, app.currency) }) : null,
      el('span', { text: `${formatDecimalHours(day.roundedSeconds)} h` }),
    ]),
    el('div.day-body', {}, day.lines.map((line) => lineRow(ctx, line))),
  ]);
}

function lineRow(ctx, line) {
  const { app } = ctx;
  return el(`div.line${line.billable ? '' : '.line-nonbillable'}`, {}, [
    el('div.line-client', {}, [
      el('span.dot', { style: { background: line.clientColor || 'var(--accent)' } }),
      el('span.truncate', { text: line.clientName }),
    ]),
    el('div.line-desc', {}, [
      el('div.truncate', { text: line.description || '—' }),
      line.projectName ? el('div.tiny.subtle', { text: line.projectName }) : null,
      (line.refs || []).length
        ? el('div.line-refs', {}, line.refs.slice(0, 6).map((ref) => el('span.ref', { text: ref })))
        : null,
    ]),
    el('div.line-time', { text: `${formatDecimalHours(line.roundedSeconds)} h` }),
    el('div.line-amount', { text: line.amount ? formatMoney(line.amount, app.currency) : (line.billable ? '—' : 'n/b') }),
    el('div.line-menu', {}, [
      el('button.btn.btn-sm.btn-ghost', {
        text: '\u00b7\u00b7\u00b7',
        title: 'Line options',
        on: { click: () => lineMenu(ctx, line) },
      }),
    ]),
  ]);
}

function lineMenu(ctx, line) {
  const { close } = modal({
    title: `${line.clientName} — ${formatDecimalHours(line.roundedSeconds)} h`,
    body: [
      el('p.small.muted', { text: line.description || 'No description captured.' }),
      el('div.small', {}, [
        el('div', { text: `Sites: ${(line.hostnames || []).join(', ') || '—'}` }),
        el('div', { text: `Built from ${pluralize(line.visitCount, 'visit')}.` }),
      ]),
      el('p.tiny.subtle', {
        text: 'Lines are derived from your rules, so the way to change one permanently is to change the rule. Deleting removes the underlying recorded time from this device.',
      }),
    ],
    actions: [
      el('button.btn', { text: 'Close', on: { click: () => close() } }),
      el('button.btn', {
        text: 'Edit rules',
        on: {
          click: () => {
            close();
            ctx.setView('clients');
          },
        },
      }),
      el('button.btn.btn-danger', {
        text: 'Delete this time',
        on: {
          click: async () => {
            close();
            await deleteVisitsBetween(line.start, line.end + 1);
            await ctx.reload();
            toast('Deleted from this device.');
          },
        },
      }),
    ],
  });
}

// ------------------------------------------------------------------ exports

function exportSection(ctx) {
  const { app } = ctx;
  const allowed = can(app.plan, 'export');

  const guard = (action) => () => {
    if (!allowed) {
      ctx.openUpgrade();
      return;
    }
    action();
  };

  const clientSelect = el('select.select.input-sm', { style: { width: '176px' } },
    app.sheet.byClient.map((client) => el('option', { value: client.clientId, text: client.name })));

  return el('section.section', {}, [
    el('div.section-head', {}, [
      el('h2', { text: 'Export' }),
      allowed ? null : el('span.locked', { text: 'Pro only' }),
    ]),
    el('div.card.card-pad', {}, [
      el('div.export-bar', {}, [
        el('button.btn.btn-primary', {
          text: 'Download CSV',
          on: {
            click: guard(() => {
              downloadText(
                filenameFor('billed-timesheet', app.sheet, 'csv'),
                toCSV(app.sheet, { currency: app.currency }),
                'text/csv',
              );
              toast('CSV downloaded.');
            }),
          },
        }),
        el('button.btn', {
          text: 'Copy summary',
          on: {
            click: guard(async () => {
              await copyText(toMarkdown(app.sheet, { currency: app.currency, pro: true }));
              toast('Weekly summary copied.');
            }),
          },
        }),
        el('button.btn', {
          text: 'Copy status update',
          title: 'Same data, written for a manager instead of a client',
          on: {
            click: guard(async () => {
              await copyText(toStatusUpdate(app.sheet));
              toast('Status update copied.');
            }),
          },
        }),
        el('span.grow'),
        app.sheet.byClient.length ? clientSelect : null,
        app.sheet.byClient.length
          ? el('button.btn', {
            text: 'Copy invoice lines',
            on: {
              click: guard(async () => {
                await copyText(toInvoiceText(app.sheet, clientSelect.value, { currency: app.currency }));
                toast('Invoice lines copied.');
              }),
            },
          })
          : null,
      ]),
      allowed
        ? null
        : el('div.tiny.subtle', { style: { marginTop: '9px' }, text: 'Exports are part of Pro. The free plan keeps tracking everything in the meantime.' }),
    ]),
  ]);
}
