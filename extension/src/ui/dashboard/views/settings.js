/**
 * Settings, including the privacy controls that have to be real rather than
 * reassuring: an editable blocklist, a retention window, a full local backup and
 * a working delete-everything button.
 */

import { el, downloadText, modal, pickFile, toast } from '../../shared/dom.js';
import { CURRENCIES } from '../../../core/defaults.js';
import { SUGGESTED_BLOCKLIST } from '../../../core/privacy.js';
import { ROUNDING_INCREMENTS } from '../../../core/timesheet.js';
import { can } from '../../../core/plan.js';
import { toBackupJSON } from '../../../core/exporters.js';
import { MSG, send } from '../../../platform/messages.js';
import { getAllVisits, countVisits, getBounds, putVisits } from '../../../platform/db.js';
import { formatShortDate, pluralize } from '../../../core/format.js';
import { dayKey } from '../../../core/time.js';
import { licensePanel } from './upgrade.js';
import { pendingBanner } from './activation.js';

export function renderSettings(ctx) {
  return [
    el('div.section-head', {}, [el('h2', { text: 'Settings' })]),
    pendingBanner(ctx, ctx.app.state.pending),
    trackingCard(ctx),
    billingCard(ctx),
    displayCard(ctx),
    privacyCard(ctx),
    remindersCard(ctx),
    licensePanel(ctx),
    dataCard(ctx),
  ];
}

/** One settings row: label, description, control. */
function setting(name, desc, control) {
  return el('div.setting', {}, [
    el('div.setting-text', {}, [
      el('div.setting-name', { text: name }),
      desc ? el('div.setting-desc', { text: desc }) : null,
    ]),
    el('div.setting-control', {}, control),
  ]);
}

function card(title, note, rows) {
  return el('section.section', {}, [
    el('div.section-head', {}, [el('h3', { text: title }), note ? el('span.tiny.subtle', { text: note }) : null]),
    el('div.card', {}, rows.filter(Boolean)),
  ]);
}

function patch(ctx, section, values) {
  const settings = structuredClone(ctx.app.state.settings);
  settings[section] = { ...settings[section], ...values };
  return ctx.saveSettings(settings);
}

// ------------------------------------------------------------------ tracking

function trackingCard(ctx) {
  const tracking = ctx.app.state.settings.tracking;

  const toggle = el('input', {
    type: 'checkbox',
    checked: tracking.enabled,
    on: { change: (event) => patch(ctx, 'tracking', { enabled: event.target.checked, pausedUntil: 0 }) },
  });

  const idleSelect = el('select.select', {}, [60, 120, 300, 600].map((seconds) => el('option', {
    value: seconds,
    text: seconds < 60 ? `${seconds} seconds` : `${seconds / 60} minutes`,
    selected: Number(tracking.idleSeconds) === seconds,
  })));
  idleSelect.addEventListener('change', () => patch(ctx, 'tracking', { idleSeconds: Number(idleSelect.value) }));

  const minSelect = el('select.select', {}, [10, 30, 60, 120].map((seconds) => el('option', {
    value: seconds,
    text: `${seconds} seconds`,
    selected: Number(tracking.minSegmentSeconds) === seconds,
  })));
  minSelect.addEventListener('change', () => patch(ctx, 'tracking', { minSegmentSeconds: Number(minSelect.value) }));

  const mergeSelect = el('select.select', {}, [60, 300, 600, 1800].map((seconds) => el('option', {
    value: seconds,
    text: `${seconds / 60} minutes`,
    selected: Number(tracking.mergeGapSeconds) === seconds,
  })));
  mergeSelect.addEventListener('change', () => patch(ctx, 'tracking', { mergeGapSeconds: Number(mergeSelect.value) }));

  const titlesToggle = el('input', {
    type: 'checkbox',
    checked: tracking.storeTitles,
    on: { change: (event) => patch(ctx, 'tracking', { storeTitles: event.target.checked }) },
  });

  return card('Tracking', 'Nothing here leaves your device.', [
    setting('Track my activity', 'Turn this off and Billed records nothing at all.',
      el('label.switch', {}, [toggle, el('span', { text: tracking.enabled ? 'On' : 'Off' })])),

    setting('Stop the clock after', 'Time away from the keyboard is never billed. Shorter is more honest.', idleSelect),

    setting('Ignore visits shorter than', 'Filters out tab-flicking so it does not become a timesheet line.', minSelect),

    setting('Merge gaps up to', 'Two blocks of work for the same client within this gap become one line. The gap itself is never billed.', mergeSelect),

    setting('Remember page titles', 'Titles are where ticket keys like PAY-2214 come from. Turn off to keep timings only.',
      el('label.switch', {}, [titlesToggle, el('span', { text: tracking.storeTitles ? 'On' : 'Off' })])),

    setting('Pause tracking', 'A quick break without changing any settings.',
      el('div.row', {}, [
        el('button.btn.btn-sm', {
          text: 'Pause 1 hour',
          on: {
            click: async () => {
              await send(MSG.pause, { minutes: 60 });
              await ctx.reload();
              toast('Paused for an hour.');
            },
          },
        }),
        Number(tracking.pausedUntil) > Date.now()
          ? el('button.btn.btn-sm.btn-primary', {
            text: 'Resume now',
            on: {
              click: async () => {
                await send(MSG.resume);
                await ctx.reload();
                toast('Tracking resumed.');
              },
            },
          })
          : null,
      ])),
  ]);
}

// ------------------------------------------------------------------ billing

function billingCard(ctx) {
  const billing = ctx.app.state.settings.billing;
  const pro = can(ctx.app.plan, 'rounding');

  const currencySelect = el('select.select', {}, CURRENCIES.map((currency) => el('option', {
    value: currency.code,
    text: `${currency.code} (${currency.symbol.trim()})`,
    selected: billing.currency === currency.code,
  })));
  currencySelect.addEventListener('change', () => patch(ctx, 'billing', { currency: currencySelect.value }));

  const rateInput = el('input.input', { type: 'number', min: '0', step: '1', value: billing.defaultRate || '' });
  rateInput.addEventListener('change', () => patch(ctx, 'billing', { defaultRate: Number(rateInput.value) || 0 }));

  const incrementSelect = el('select.select', { disabled: !pro }, ROUNDING_INCREMENTS.map((option) => el('option', {
    value: option.value,
    text: option.label,
    selected: Number(billing.rounding.incrementMinutes) === option.value,
  })));
  const directionSelect = el('select.select', { disabled: !pro }, [
    { value: 'nearest', label: 'to the nearest' },
    { value: 'up', label: 'always up' },
    { value: 'down', label: 'always down' },
  ].map((option) => el('option', {
    value: option.value,
    text: option.label,
    selected: billing.rounding.direction === option.value,
  })));

  const saveRounding = () => patch(ctx, 'billing', {
    rounding: {
      ...billing.rounding,
      incrementMinutes: Number(incrementSelect.value),
      direction: directionSelect.value,
    },
  });
  incrementSelect.addEventListener('change', saveRounding);
  directionSelect.addEventListener('change', saveRounding);

  return card('Billing', null, [
    setting('Currency', null, currencySelect),
    setting('Default hourly rate', 'Used when you add a new client.', rateInput),
    setting(
      'Round billed time',
      pro
        ? 'Applied per timesheet line, the way invoices actually work.'
        : 'Pro. The free plan always shows exact time.',
      el('div.col', { style: { gap: '6px' } }, [
        incrementSelect,
        directionSelect,
        pro ? null : el('button.btn.btn-sm.btn-primary', { text: 'Unlock with Pro', on: { click: () => ctx.openUpgrade() } }),
      ]),
    ),
  ]);
}

// ------------------------------------------------------------------ display

function displayCard(ctx) {
  const display = ctx.app.state.settings.display;

  const weekSelect = el('select.select', {}, [
    { value: 1, label: 'Monday' },
    { value: 0, label: 'Sunday' },
    { value: 6, label: 'Saturday' },
  ].map((option) => el('option', {
    value: option.value,
    text: option.label,
    selected: Number(display.weekStartsOn) === option.value,
  })));
  weekSelect.addEventListener('change', () => patch(ctx, 'display', { weekStartsOn: Number(weekSelect.value) }));

  const hoursSelect = el('select.select', {}, [
    { value: 'decimal', label: '3.42 h — for invoicing' },
    { value: 'clock', label: '3h 25m — easier to read' },
  ].map((option) => el('option', {
    value: option.value,
    text: option.label,
    selected: (display.decimalHours ? 'decimal' : 'clock') === option.value,
  })));
  hoursSelect.addEventListener('change', () => patch(ctx, 'display', { decimalHours: hoursSelect.value === 'decimal' }));

  return card('Display', null, [
    setting('Week starts on', null, weekSelect),
    setting('Show hours as', 'Exports always use decimal hours, whatever you pick here.', hoursSelect),
  ]);
}

// ------------------------------------------------------------------ privacy

function privacyCard(ctx) {
  const privacy = ctx.app.state.settings.privacy;

  const input = el('input.input', { placeholder: 'e.g. *bank*, mycompany.com, github.com/side-project' });
  const add = async () => {
    const value = input.value.trim().toLowerCase();
    if (!value) return;
    if (privacy.blocklist.includes(value)) {
      toast('Already on the list.');
      return;
    }
    await patch(ctx, 'privacy', { blocklist: [...privacy.blocklist, value] });
    toast(`${value} will not be tracked.`);
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') add();
  });

  const chips = el('div.blocklist-list', {}, privacy.blocklist.map((pattern) => el('span.rule-chip', {}, [
    el('span', { text: pattern }),
    el('button', {
      text: '\u00d7',
      title: 'Remove',
      on: {
        click: () => patch(ctx, 'privacy', { blocklist: privacy.blocklist.filter((entry) => entry !== pattern) }),
      },
    }),
  ])));

  const retentionSelect = el('select.select', {}, [90, 365, 730, 1825, 0].map((days) => el('option', {
    value: days,
    text: days === 0 ? 'Keep forever' : `${days} days`,
    selected: Number(privacy.retentionDays) === days,
  })));
  retentionSelect.addEventListener('change', () => patch(ctx, 'privacy', { retentionDays: Number(retentionSelect.value) }));

  return card('Privacy', 'Applied before anything is written to disk.', [
    el('div.setting', {}, [
      el('div.setting-text', {}, [
        el('div.setting-name', { text: 'Never track these' }),
        el('div.setting-desc', {
          text: 'Wildcards allowed. A bare domain also covers its subdomains. A pattern with a slash blocks just that path.',
        }),
        chips,
        el('div.row', { style: { marginTop: '9px' } }, [
          input,
          el('button.btn.btn-sm', { text: 'Add', on: { click: add } }),
        ]),
        el('div.row', { style: { marginTop: '7px' } }, [
          el('button.btn.btn-sm.btn-ghost', {
            text: 'Restore suggested list',
            on: {
              click: async () => {
                const merged = [...new Set([...privacy.blocklist, ...SUGGESTED_BLOCKLIST])];
                await patch(ctx, 'privacy', { blocklist: merged });
                toast('Suggested patterns restored.');
              },
            },
          }),
          el('button.btn.btn-sm.btn-ghost', {
            text: 'Clear list',
            on: { click: () => patch(ctx, 'privacy', { blocklist: [] }) },
          }),
        ]),
      ]),
    ]),
    setting('Keep recorded time for', 'Older activity is deleted automatically.', retentionSelect),
    setting('What Billed stores', null, el('div.tiny.subtle', {
      text: 'Domain, path, page title, start and end time. Never the query string, never page contents, never keystrokes.',
    })),
  ]);
}

// ------------------------------------------------------------------ reminders

function remindersCard(ctx) {
  const reminders = ctx.app.state.settings.reminders;
  const pro = can(ctx.app.plan, 'reminders');

  const toggle = el('input', {
    type: 'checkbox',
    checked: reminders.weeklyReview,
    disabled: !pro,
    on: {
      change: async (event) => {
        if (!event.target.checked) {
          await patch(ctx, 'reminders', { weeklyReview: false });
          return;
        }
        const response = await send(MSG.enableReminders);
        if (!response.granted) {
          event.target.checked = false;
          toast('Notification permission was declined.', 'warn');
          return;
        }
        await ctx.reload();
        toast('You will get a nudge before the week closes.');
      },
    },
  });

  const daySelect = el('select.select', { disabled: !pro }, [
    { value: 5, label: 'Friday' },
    { value: 4, label: 'Thursday' },
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
  ].map((option) => el('option', { value: option.value, text: option.label, selected: Number(reminders.dayOfWeek) === option.value })));

  const hourSelect = el('select.select', { disabled: !pro }, [12, 14, 16, 17, 18].map((hour) => el('option', {
    value: hour,
    text: `${hour % 12 || 12}:00 ${hour >= 12 ? 'pm' : 'am'}`,
    selected: Number(reminders.hour) === hour,
  })));

  const save = () => patch(ctx, 'reminders', { dayOfWeek: Number(daySelect.value), hour: Number(hourSelect.value) });
  daySelect.addEventListener('change', save);
  hourSelect.addEventListener('change', save);

  return card('Weekly review reminder', pro ? null : 'Pro', [
    setting('Remind me to review the week', 'Notification permission is requested only when you switch this on.',
      el('label.switch', {}, [toggle, el('span', { text: reminders.weeklyReview ? 'On' : 'Off' })])),
    setting('When', null, el('div.col', { style: { gap: '6px' } }, [daySelect, hourSelect])),
  ]);
}

// ------------------------------------------------------------------ data

function dataCard(ctx) {
  const stats = el('div.tiny.subtle', { text: 'Counting…' });
  countVisits().then(async (count) => {
    const bounds = await getBounds();
    stats.textContent = bounds.first
      ? `${count.toLocaleString()} recorded sessions, from ${formatShortDate(dayKey(bounds.first))} onwards.`
      : 'Nothing recorded yet.';
  }).catch(() => { stats.textContent = ''; });

  return card('Your data', null, [
    el('div.setting', {}, [
      el('div.setting-text', {}, [
        el('div.setting-name', { text: 'Backup' }),
        el('div.setting-desc', { text: 'A single JSON file with your clients, rules, settings and every recorded session. Billed never holds your data hostage.' }),
        stats,
      ]),
      el('div.setting-control', {}, el('div.col', { style: { gap: '6px' } }, [
        el('button.btn.btn-sm', {
          text: 'Download backup',
          on: {
            click: async () => {
              const visits = await getAllVisits();
              downloadText(
                `billed-backup-${dayKey(Date.now())}.json`,
                toBackupJSON({
                  visits,
                  clients: ctx.app.state.clients,
                  rules: ctx.app.state.rules,
                  settings: ctx.app.state.settings,
                }),
                'application/json',
              );
              toast('Backup downloaded.');
            },
          },
        }),
        el('button.btn.btn-sm', { text: 'Restore from backup', on: { click: () => restore(ctx) } }),
      ])),
    ]),

    el('div.setting', {}, [
      el('div.setting-text', {}, [
        el('div.setting-name', { text: 'Delete everything' }),
        el('div.setting-desc', { text: 'Erases every recorded session on this device. Clients and rules are kept.' }),
      ]),
      el('div.setting-control', {}, el('button.btn.btn-sm.btn-danger', {
        text: 'Delete all recorded time',
        on: { click: () => confirmWipe(ctx) },
      })),
    ]),
  ]);
}

function confirmWipe(ctx) {
  const { close } = modal({
    title: 'Delete all recorded time?',
    body: [
      el('p', { text: 'Every session Billed has recorded on this device will be permanently deleted. This cannot be undone.' }),
      el('p.muted.small', { text: 'Your clients, rules and settings stay as they are. Consider downloading a backup first.' }),
    ],
    actions: [
      el('button.btn', { text: 'Cancel', on: { click: () => close() } }),
      el('button.btn.btn-danger', {
        text: 'Delete everything',
        on: {
          click: async () => {
            close();
            await send(MSG.wipe);
            await ctx.reload();
            toast('All recorded time deleted.');
          },
        },
      }),
    ],
  });
}

async function restore(ctx) {
  const file = await pickFile('.json');
  if (!file) return;

  let parsed;
  try {
    parsed = JSON.parse(file.text);
  } catch {
    toast('That file is not valid JSON.', 'warn');
    return;
  }
  if (parsed?.format !== 'billed.backup') {
    toast('That does not look like a Billed backup.', 'warn');
    return;
  }

  const visits = Array.isArray(parsed.visits) ? parsed.visits : [];
  const { close } = modal({
    title: 'Restore this backup?',
    body: [
      el('p', { text: `${file.name} contains ${pluralize(visits.length, 'session')}, ${pluralize((parsed.clients || []).length, 'client')} and ${pluralize((parsed.rules || []).length, 'rule')}.` }),
      el('p.muted.small', { text: 'Sessions are merged into what you already have. Clients, rules and settings from the backup replace your current ones.' }),
    ],
    actions: [
      el('button.btn', { text: 'Cancel', on: { click: () => close() } }),
      el('button.btn.btn-primary', {
        text: 'Restore',
        on: {
          click: async () => {
            close();
            if (visits.length) await putVisits(visits);
            if (Array.isArray(parsed.clients)) await ctx.saveClients(parsed.clients);
            if (Array.isArray(parsed.rules)) await ctx.saveRules(parsed.rules);
            if (parsed.settings) await ctx.saveSettings(parsed.settings);
            await ctx.reload();
            toast('Backup restored.');
          },
        },
      }),
    ],
  });
}
