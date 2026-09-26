/**
 * Upgrade and licence handling.
 *
 * The pitch is arithmetic, not adjectives: consultants lose 15–20% of billable
 * time to memory, so the panel shows what the user's own unassigned time is
 * worth at their own rate. If that number is small, they should not upgrade, and
 * the panel says so.
 */

import { el, modal, toast } from '../../shared/dom.js';
import { APP, LINKS, PLAN_TERMS, REGION_NOTES, pricingForLocale } from '../../../config.js';
import { MSG, send } from '../../../platform/messages.js';
import { formatMoney } from '../../../core/format.js';
import { licenseNotice, PLAN_LIMITS } from '../../../core/plan.js';

const FEATURES = [
  'Every week of history, not just the last seven days',
  'Unlimited clients and projects',
  'CSV, invoice lines and weekly summaries out of the browser',
  'Billing increments — 6, 10, 15, 30 minutes, up or nearest',
  'Friday review reminder before the week closes',
  'Status-update mode for salaried work',
];

export function openUpgrade(ctx) {
  const pricing = pricingForLocale();
  const recovery = estimateWeeklyLoss(ctx);

  const isIndia = pricing.currency === 'INR';

  const priceCard = (plan, amount, extra, link, best = false) => el(`div.price${best ? '.price-best' : ''}`, {
    on: { click: () => openCheckout(link) },
  }, [
    el('div.price-name', { text: PLAN_TERMS[plan].label }),
    el('div.price-amount', { text: `${pricing.symbol}${amount.toLocaleString()}` }),
    el('div.price-note', { text: PLAN_TERMS[plan].note }),
    extra ? el('div.price-note.strong', { text: extra }) : null,
  ]);

  const { close } = modal({
    title: 'Billed Pro',
    body: [
      recovery
        ? el('div.banner.banner-accent', {}, [
          el('div.strong', { text: `You have ${recovery.hours} h unassigned this week.` }),
          el('div.small', { text: `At your own rates that is about ${recovery.money}. Pro costs ${pricing.symbol}${pricing.monthly} a month.` }),
        ])
        : el('div.banner.banner-accent', {}, [
          el('div.strong', { text: 'Consultants forget 15–20% of their billable time.' }),
          el('div.small', { text: 'At $100/h that is over $20,000 a year. Billed exists to stop that leak.' }),
        ]),

      el('div.price-grid', {}, [
        priceCard('monthly', pricing.monthly, '', LINKS.checkoutMonthly),
        priceCard('yearly', pricing.yearly, `save ${pricing.yearlySavingPercent}%`, LINKS.checkoutYearly, true),
        priceCard('lifetime', pricing.lifetime, isIndia ? 'UPI works here' : '', LINKS.checkoutLifetime),
      ]),

      el('ul.feature-list', {}, FEATURES.map((feature) => el('li', { text: feature }))),

      el('div.tiny.subtle', { text: isIndia ? REGION_NOTES.india : REGION_NOTES.default }),

      el('hr.divider'),
      el('div.field', {}, [
        el('span.label', { text: 'Already bought it?' }),
        // Deferred: `close` is still in its temporal dead zone while this body
        // array is being built, so it has to be reached through a closure.
        activateRow(ctx, () => close()),
      ]),
    ],
    actions: [
      el('button.btn', { text: 'Not now', on: { click: () => close() } }),
      el('button.btn.btn-primary', { text: 'See plans', on: { click: () => openCheckout(LINKS.checkoutYearly) } }),
    ],
  });
}

function openCheckout(url) {
  if (url.includes('PLACEHOLDER')) {
    toast('Checkout link is not configured yet — see docs/PAYMENTS_SETUP.md.', 'warn');
    return;
  }
  chrome.tabs.create({ url });
}

/** What the user's own unassigned time is worth, at their own rates. */
function estimateWeeklyLoss(ctx) {
  const { app } = ctx;
  const seconds = app.sheet?.totals?.unassignedSeconds || 0;
  if (seconds < 20 * 60) return null;

  const rates = app.state.clients.map((client) => Number(client.rate) || 0).filter(Boolean);
  const rate = rates.length
    ? rates.reduce((total, value) => total + value, 0) / rates.length
    : Number(app.state.settings.billing.defaultRate) || 0;
  if (!rate) return null;

  const hours = seconds / 3600;
  return {
    hours: hours.toFixed(1),
    money: formatMoney(hours * rate, app.state.settings.billing.currency),
  };
}

function activateRow(ctx, closeModal) {
  const input = el('input.input', { placeholder: 'Paste your licence key' });
  const status = el('div.tiny.subtle', {});

  const activate = async () => {
    status.textContent = 'Checking…';
    const response = await send(MSG.activateLicense, { key: input.value });
    status.textContent = response.message || (response.ok ? 'Activated.' : 'Could not activate.');
    if (response.ok) {
      toast('Pro unlocked. Thank you.');
      closeModal?.();
      await ctx.reload();
    }
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') activate();
  });

  return el('div.col', { style: { gap: '6px' } }, [
    el('div.row', {}, [input, el('button.btn.btn-sm', { text: 'Activate', on: { click: activate } })]),
    status,
    el('div.tiny.subtle', {
      text: 'Activating asks for one-off access to the licence server. That is the only network request Billed ever makes.',
    }),
  ]);
}

/** The licence card shown inside Settings. */
export function licensePanel(ctx) {
  const { app } = ctx;
  const license = app.state.license;
  const isPro = app.plan === 'pro';

  const rows = [];

  // Anything that has cost, or is about to cost, the user their Pro features gets
  // stated at the top. A silent downgrade is the one thing a paid tool must never do.
  const notice = licenseNotice(license);
  if (notice) {
    rows.push(el('div.setting', {}, [
      el(`div.banner${notice.level === 'warn' ? '' : notice.level === 'info' ? '.banner-accent' : ''}`, {
        style: { width: '100%' },
      }, [
        el('div.strong', { text: notice.title }),
        el('div.small', { text: notice.message }),
        notice.action === 'recheck'
          ? el('button.btn.btn-sm', {
            style: { marginTop: '8px' },
            text: 'Check again now',
            on: {
              click: async () => {
                const response = await send(MSG.activateLicense, { key: license.key });
                await ctx.reload();
                toast(response.message || 'Checked.');
              },
            },
          })
          : el('a.btn.btn-sm', {
            style: { marginTop: '8px' },
            href: '#',
            text: notice.action === 'manage' ? 'Update payment' : 'Renew Pro',
            on: {
              click: (event) => {
                event.preventDefault();
                openUpgrade(ctx);
              },
            },
          }),
      ]),
    ]));
  }

  rows.push(el('div.setting', {}, [
    el('div.setting-text', {}, [
      el('div.setting-name', { text: isPro ? 'Billed Pro is active' : `You are on the ${PLAN_LIMITS.free.label} plan` }),
      el('div.setting-desc', {
        text: isPro
          ? `Licence ending ${String(license.key).slice(-6)}${license.email ? ` · ${license.email}` : ''}`
          : `${PLAN_LIMITS.free.historyDays} days of history, ${PLAN_LIMITS.free.maxClients} clients, no exports.`,
      }),
      isPro && license.source === 'offline'
        ? el('div.tiny.subtle', { text: 'One-off licence. Works offline and never expires — nothing to renew.' })
        : isPro && license.verifiedAt
          ? el('div.tiny.subtle', {
            text: `${license.recurrence ? `Renews ${license.recurrence}. ` : ''}Last checked ${new Date(license.verifiedAt).toLocaleDateString()}. Works offline for 45 days.`,
          })
          : null,
    ]),
    el('div.setting-control', {}, isPro
      ? el('button.btn.btn-sm', {
        text: 'Remove licence',
        on: {
          click: async () => {
            await send(MSG.deactivateLicense);
            await ctx.reload();
            toast('Licence removed from this device.');
          },
        },
      })
      : el('button.btn.btn-sm.btn-primary', { text: 'See Pro', on: { click: () => openUpgrade(ctx) } })),
  ]));

  if (!isPro) {
    rows.push(el('div.setting', {}, [
      el('div.setting-text', {}, [
        el('div.setting-name', { text: 'Enter a licence key' }),
        el('div.setting-desc', { text: `Bought Pro from ${APP.site}? Paste the key here.` }),
      ]),
      el('div.setting-control', {}, activateRow(ctx, null)),
    ]));
  }

  return el('section.section', {}, [
    el('div.section-head', {}, [el('h3', { text: 'Plan' })]),
    el('div.card', {}, rows),
  ]);
}
