/**
 * Popup.
 *
 * Two jobs, in priority order:
 *  1. Show today's billable hours, so the product is visible every day rather
 *     than only on Friday.
 *  2. Let someone assign the site they are on *right now* to a client in one
 *     click. Assigning in the moment is the cheapest possible version of the
 *     only chore Billed asks for.
 */

import { el, qs, render, toast } from '../shared/dom.js';
import { MSG, send } from '../../platform/messages.js';
import {
  getClients,
  getCurrent,
  getLicense,
  getRules,
  getSettings,
  setClients,
  setRules,
} from '../../platform/store.js';
import { todaySummary } from '../../platform/queries.js';
import { deriveWorkspace } from '../../core/workspaces.js';
import { attribute, compileRules } from '../../core/attribution.js';
import { createClient, createRule } from '../../core/defaults.js';
import { formatDecimalHours, formatDuration, formatMoney } from '../../core/format.js';
import { canAddClient, planFor } from '../../core/plan.js';

const DASHBOARD = chrome.runtime.getURL('src/ui/dashboard/dashboard.html');

let view = {
  summary: null,
  current: null,
  clients: [],
  rules: [],
  settings: null,
  plan: 'free',
};

async function load() {
  // Flush first so the numbers include the minute in progress.
  await send(MSG.flush);

  const [settings, clients, rules, license, current] = await Promise.all([
    getSettings(), getClients(), getRules(), getLicense(), getCurrent(),
  ]);
  const summary = await todaySummary(Date.now(), { state: { settings, clients, rules, license } });

  view = { summary, current, clients, rules, settings, plan: planFor(license) };
  paint();
}

function paint() {
  const { summary, settings, plan } = view;

  qs('#plan-pill').textContent = plan === 'pro' ? 'Pro' : 'Free';
  qs('#plan-pill').className = `pill ${plan === 'pro' ? 'pill-pro' : ''}`;

  qs('#today-hours').textContent = formatDecimalHours(summary.billedSeconds || summary.billableSeconds);

  const meta = [];
  if (summary.amount > 0) meta.push(el('span.strong', { text: formatMoney(summary.amount, summary.currency) }));
  meta.push(el('span', { text: `${formatDuration(summary.trackedSeconds)} tracked` }));
  if (summary.unassignedSeconds >= 60) {
    meta.push(el('span.pill.pill-warn', { text: `${formatDuration(summary.unassignedSeconds)} unassigned` }));
  }
  render(qs('#today-meta'), interleave(meta, () => el('span.subtle', { text: '·' })));

  paintReviewBanner();
  paintNow();
  paintClients();
  paintFooter(settings);
}

function interleave(nodes, separator) {
  const out = [];
  nodes.forEach((node, index) => {
    if (index) out.push(separator());
    out.push(node);
  });
  return out;
}

function paintReviewBanner() {
  const banner = qs('#review-banner');
  const groups = view.summary.unassigned || [];
  if (!groups.length || view.summary.unassignedSeconds < 5 * 60) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
  render(banner, [
    el('div.strong', { text: `${formatDuration(view.summary.unassignedSeconds)} not assigned to a client yet.` }),
    el('div.tiny', { text: 'Unassigned time is the time you lose when you invoice from memory.' }),
  ]);
}

function paintNow() {
  const { current, rules, clients, settings } = view;
  const body = qs('#now-body');
  const slot = qs('#assign-slot');

  if (!current) {
    render(body, el('span.muted', { text: pausedLabel(settings) || 'Not tracking right now.' }));
    render(slot, []);
    return;
  }

  const workspace = deriveWorkspace(current);
  const matched = matchingClient(current, rules, clients);

  render(body, [
    el('span.dot', { style: { background: matched?.color || 'var(--border-strong)' } }),
    el('div.grow.truncate', {}, [
      el('div.now-host.truncate', { text: current.hostname }),
      current.title ? el('div.now-title.tiny.truncate', { text: current.title }) : null,
    ]),
    matched
      ? el('span.pill.pill-pro', { text: matched.name })
      : el('span.pill.pill-warn', { text: 'Unassigned' }),
  ]);

  if (matched) {
    render(slot, el('div.tiny.subtle', { style: { marginTop: '7px' }, text: `Counting towards ${matched.name}.` }));
    return;
  }

  const select = el('select.select.input-sm', {}, [
    el('option', { value: '', text: `Assign ${workspace.label} to…` }),
    ...clients.filter((client) => !client.archived).map((client) => el('option', { value: client.id, text: client.name })),
    el('option', { value: '__new__', text: `+ New client "${workspace.label}"` }),
  ]);

  render(slot, el('div.assign-row', {}, [
    select,
    el('button.btn.btn-sm.btn-primary', {
      text: 'Assign',
      on: { click: () => assign(workspace, select.value) },
    }),
  ]));
}

function pausedLabel(settings) {
  const until = Number(settings?.tracking?.pausedUntil || 0);
  if (until > Date.now()) {
    const minutes = Math.ceil((until - Date.now()) / 60000);
    return `Paused for another ${minutes} min.`;
  }
  if (!settings?.tracking?.enabled) return 'Tracking is switched off.';
  return '';
}

/** Uses the same attribution engine as the timesheet, so the popup never lies. */
function matchingClient(visit, rules, clients) {
  const match = attribute(visit, compileRules(rules));
  if (!match) return null;
  return clients.find((client) => client.id === match.clientId) || null;
}

async function assign(workspace, choice) {
  if (!choice) {
    toast('Pick a client first.');
    return;
  }

  let clientId = choice;
  let clients = view.clients;

  if (choice === '__new__') {
    if (!canAddClient(view.plan, clients.filter((client) => !client.archived).length)) {
      toast('Free plan covers 3 clients. Upgrade for unlimited.', 'warn');
      return;
    }
    const client = createClient({ name: workspace.label, rate: view.settings.billing.defaultRate });
    clients = [...clients, client];
    await setClients(clients);
    clientId = client.id;
  }

  const rule = createRule({ clientId, kind: workspace.ruleKind, value: workspace.ruleValue });
  await setRules([...view.rules, rule]);

  toast(`${workspace.label} \u203a ${clients.find((client) => client.id === clientId)?.name}`);
  await send(MSG.reconcile);
  await load();
}

function paintClients() {
  const slot = qs('#clients-slot');
  const clients = view.summary.topClients || [];
  if (!clients.length) {
    render(slot, el('div.empty.tiny', { text: 'No client time today yet.' }));
    return;
  }

  const max = Math.max(...clients.map((client) => client.seconds), 1);
  render(slot, el('div.card.card-pad', {}, [
    el('div.label', { text: 'Today by client' }),
    ...clients.map((client) => el('div.client-line', {}, [
      el('span.dot', { style: { background: client.color || 'var(--accent)' } }),
      el('div.client-name.truncate', {}, [
        el('div.truncate', { text: client.name }),
        el('div.bar-track', { style: { marginTop: '3px' } }, [
          el('div.bar-fill', { style: { width: `${Math.max(4, (client.seconds / max) * 100)}%`, background: client.color || 'var(--accent)' } }),
        ]),
      ]),
      el('span.client-hours', { text: formatDuration(client.seconds) }),
    ])),
  ]));
}

function paintFooter(settings) {
  const button = qs('#toggle-pause');
  const paused = Number(settings?.tracking?.pausedUntil || 0) > Date.now();
  button.textContent = paused ? 'Resume tracking' : 'Pause 1 hour';
  button.onclick = async () => {
    const response = paused ? await send(MSG.resume) : await send(MSG.pause, { minutes: 60 });
    if (!response.ok) {
      toast('Could not reach the tracker.', 'warn');
      return;
    }
    toast(paused ? 'Tracking resumed.' : 'Paused for an hour.');
    await load();
  };
}

qs('#open-dashboard').addEventListener('click', () => openDashboard(''));
qs('#goto-review').addEventListener('click', () => openDashboard('#review'));

async function openDashboard(hash) {
  const url = `${DASHBOARD}${hash}`;
  const existing = await chrome.tabs.query({ url: `${DASHBOARD}*` });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true, url });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
}

load().catch((error) => {
  console.error('[billed] popup failed', error);
  render(qs('#now-body'), el('span.muted', { text: 'Something went wrong. Open the dashboard.' }));
});

// Keep the popup honest while it is open.
const refresh = setInterval(() => load().catch(() => {}), 20_000);
window.addEventListener('unload', () => clearInterval(refresh));
