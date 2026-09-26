/**
 * The week view — the screen the product lives or dies by.
 *
 * Its job on a Friday afternoon: show the hours, show what is still unassigned,
 * make assigning it a single click, and get the result out of the browser.
 */

import { el, copyText, downloadText, modal, render, toast } from '../../shared/dom.js';
import { createClient, createManualEntry, createRule, CLIENT_COLORS } from '../../../core/defaults.js';
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
import { deleteVisit, deleteVisitsBetween, deleteVisitsByHostname, putVisit } from '../../../platform/db.js';
import { DAY_MS, HOUR_MS, dayKey, monthLabel, shiftMonths } from '../../../core/time.js';

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
  const isMonth = app.rangeMode === 'month';

  const shift = (steps) => {
    if (steps < 0 && !canGoBack) {
      ctx.openUpgrade();
      return;
    }
    if (isMonth) {
      const shifted = shiftMonths({ from: app.sheet.range.from }, steps, app.sheet.offsetMin);
      app.anchor = shifted.from + HOUR_MS;
    } else {
      app.anchor += steps * 7 * DAY_MS;
    }
    ctx.refresh();
  };

  const modeButton = (mode, label) => el(`button.btn.btn-sm${app.rangeMode === mode ? '.btn-dark' : '.btn-ghost'}`, {
    text: label,
    on: {
      click: () => {
        if (mode === 'month' && !can(app.plan, 'monthView')) {
          ctx.openUpgrade();
          return;
        }
        ctx.setRangeMode(mode);
      },
    },
  });

  return el('div.week-nav', {}, [
    el('button.btn.btn-sm', {
      text: '‹',
      title: canGoBack ? 'Previous' : 'Looking further back is a Pro feature',
      on: { click: () => shift(-1) },
    }),
    el('div.week-label', {
      text: isMonth ? monthLabel(app.sheet.range.from, app.sheet.offsetMin) : formatRangeLabel(days),
    }),
    el('button.btn.btn-sm', { text: '›', title: 'Next', on: { click: () => shift(1) } }),
    el('button.btn.btn-sm.btn-ghost', {
      text: isMonth ? 'This month' : 'This week',
      on: {
        click: () => {
          app.anchor = Date.now();
          ctx.refresh();
        },
      },
    }),
    el('span.grow'),
    roundingNote(ctx),
    el('div.row', { style: { gap: '2px' } }, [modeButton('week', 'Week'), modeButton('month', 'Month')]),
    el('button.btn.btn-sm.btn-primary', {
      text: '+ Add time',
      title: 'A call, a meeting, anything that happened away from the browser',
      on: { click: () => addManualEntry(ctx) },
    }),
  ]);
}

/**
 * Manual entry.
 *
 * Billed refuses to guess at time spent away from the browser — but the honest
 * number is also an incomplete one until a call can be added. This is the other
 * half of that promise.
 */
function addManualEntry(ctx) {
  const { app } = ctx;
  const clients = app.state.clients.filter((client) => !client.archived);

  if (!clients.length) {
    toast('Add a client first, then you can log time against it.', 'warn');
    ctx.setView('clients');
    return;
  }

  const today = dayKey(Date.now(), app.sheet.offsetMin);
  const clientSelect = el('select.select', {}, clients.map((client) => el('option', { value: client.id, text: client.name })));
  const projectSelect = el('select.select', {});
  const dateInput = el('input.input', { type: 'date', value: today });
  const hoursInput = el('input.input', { type: 'number', min: '0.05', step: '0.25', placeholder: '1.5' });
  const noteInput = el('input.input', { placeholder: 'Kick-off call with Dana' });
  const billableInput = el('input', { type: 'checkbox', checked: true });

  const paintProjects = () => {
    const client = clients.find((entry) => entry.id === clientSelect.value);
    const projects = client?.projects || [];
    render(projectSelect, [
      el('option', { value: '', text: projects.length ? 'No project' : 'No projects for this client' }),
      ...projects.map((project) => el('option', { value: project.id, text: project.name })),
    ]);
    projectSelect.disabled = !projects.length;
  };
  clientSelect.addEventListener('change', paintProjects);
  paintProjects();

  const { close } = modal({
    title: 'Add time by hand',
    body: [
      el('p.small.muted', {
        text: 'For work that did not happen in a browser tab — calls, meetings, whiteboards. It appears on your timesheet exactly like tracked time.',
      }),
      el('div.field', {}, [el('span.label', { text: 'Client' }), clientSelect]),
      el('div.field', {}, [el('span.label', { text: 'Project' }), projectSelect]),
      el('div.row', {}, [
        el('div.field.grow', {}, [el('span.label', { text: 'Date' }), dateInput]),
        el('div.field.grow', {}, [el('span.label', { text: 'Hours' }), hoursInput]),
      ]),
      el('div.field', {}, [
        el('span.label', { text: 'What was it?' }),
        noteInput,
        el('span.hint', { text: 'This becomes the description on the invoice line.' }),
      ]),
      el('label.switch', {}, [billableInput, el('span', { text: 'Billable' })]),
    ],
    actions: [
      el('button.btn', { text: 'Cancel', on: { click: () => close() } }),
      el('button.btn.btn-primary', {
        text: 'Add to timesheet',
        on: {
          click: async () => {
            const hours = Number(hoursInput.value);
            if (!Number.isFinite(hours) || hours <= 0) {
              toast('Enter how many hours it took.', 'warn');
              return;
            }
            if (!dateInput.value) {
              toast('Pick a date.', 'warn');
              return;
            }
            await putVisit(createManualEntry({
              clientId: clientSelect.value,
              projectId: projectSelect.value || null,
              dayKey: dateInput.value,
              minutes: hours * 60,
              note: noteInput.value,
              billable: billableInput.checked,
              offsetMin: app.sheet.offsetMin,
            }));
            close();
            await ctx.reload();
            toast(`${hours} h added.`);
          },
        },
      }),
    ],
  });

  hoursInput.focus();
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
  // Task refs get their own chips, so repeating them in the description just
  // pushed the readable part of the row off the end.
  const titles = (line.titles || []).filter(Boolean);
  const onScreenDescription = titles.length ? titles.join('; ') : line.description;

  return el(`div.line${line.billable ? '' : '.line-nonbillable'}`, {}, [
    el('div.line-client', {}, [
      el('span.dot', { style: { background: line.clientColor || 'var(--accent)' } }),
      el('span.truncate', { text: line.clientName }),
    ]),
    el('div.line-desc', {}, [
      el('div.truncate', { text: onScreenDescription || '—' }),
      el('div.row', { style: { gap: '6px' } }, [
        line.projectName ? el('span.tiny.subtle', { text: line.projectName }) : null,
        line.manual ? el('span.pill.tiny', { text: 'added by hand' }) : null,
      ]),
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
        line.manual
          ? el('div', { text: 'Added by hand.' })
          : el('div', { text: `Sites: ${(line.hostnames || []).join(', ') || '—'}` }),
        el('div', { text: `Built from ${pluralize(line.visitCount, line.manual ? 'entry' : 'visit', line.manual ? 'entries' : 'visits')}.` }),
      ]),
      el('p.tiny.subtle', {
        text: line.manual
          ? 'Manual entries stand on their own — delete this one and add it again to change it.'
          : 'Lines are derived from your rules, so the way to change one permanently is to change the rule. Deleting removes the underlying recorded time from this device.',
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
            // Prefer deleting exactly the records behind this line; fall back to
            // the time span only if ids are somehow missing.
            if (line.visitIds?.length) {
              await Promise.all(line.visitIds.map((id) => deleteVisit(id)));
            } else {
              await deleteVisitsBetween(line.start, line.end + 1);
            }
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
