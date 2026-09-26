/**
 * Dashboard shell: state, routing and the one reload path every view uses.
 */

import { el, qs, qsa, render, toast } from '../shared/dom.js';
import { MSG, send } from '../../platform/messages.js';
import { loadState, setClients, setRules, setSettings } from '../../platform/store.js';
import { buildSheetFor } from '../../platform/queries.js';
import { can, planFor } from '../../core/plan.js';
import { monthRange, tzOffsetMinutes, weekRange } from '../../core/time.js';
import { renderWeek } from './views/week.js';
import { renderClients } from './views/clients.js';
import { renderSettings } from './views/settings.js';
import { openUpgrade } from './views/upgrade.js';
import { maybeShowOnboarding } from './views/onboarding.js';
import { maybeFinishActivation } from './views/activation.js';

const VIEWS = { week: renderWeek, clients: renderClients, settings: renderSettings };

export const app = {
  view: 'week',
  rangeMode: 'week',
  anchor: Date.now(),
  state: null,
  plan: 'free',
  sheet: null,
  limited: false,
  currency: 'USD',
};

/**
 * Our own writes come back through `chrome.storage.onChanged`. Without this the
 * dashboard would reload itself after every save and re-render twice.
 */
let lastSelfWrite = 0;
function markSelfWrite() {
  lastSelfWrite = Date.now();
}

/** Everything a view is allowed to do, in one object. */
export const ctx = {
  app,
  reload,
  refresh,
  setView,
  setRangeMode,
  openUpgrade: () => openUpgrade(ctx),
  async saveSettings(settings) {
    app.state.settings = settings;
    markSelfWrite();
    await setSettings(settings);
    await refresh();
  },
  async saveClients(clients) {
    app.state.clients = clients;
    markSelfWrite();
    await setClients(clients);
    await refresh();
  },
  async saveRules(rules) {
    app.state.rules = rules;
    markSelfWrite();
    await setRules(rules);
    await send(MSG.reconcile);
    await refresh();
  },
  toast,
};

/**
 * The range currently on screen. Month is what "unlimited history" is actually
 * for — retainers and invoices are monthly — so it is a Pro gate rather than a
 * hidden feature.
 */
function currentRange() {
  const offsetMin = tzOffsetMinutes(app.anchor);
  if (app.rangeMode === 'month' && can(app.plan, 'monthView')) {
    return monthRange(app.anchor, offsetMin);
  }
  return weekRange(app.anchor, {
    weekStartsOn: app.state?.settings?.display?.weekStartsOn ?? 1,
    offsetMin,
  });
}

export function setRangeMode(mode) {
  app.rangeMode = mode;
  return refresh();
}

/** Full reload: storage + database. */
async function reload() {
  await send(MSG.flush);
  app.state = await loadState();
  app.plan = planFor(app.state.license);
  const result = await buildSheetFor(currentRange(), { state: app.state });
  app.sheet = result.sheet;
  app.limited = result.limited;
  app.currency = result.currency;
  paint();
}

/** Same as reload, but assumes storage is already in hand. */
async function refresh() {
  app.plan = planFor(app.state.license);
  const result = await buildSheetFor(currentRange(), { state: app.state });
  app.sheet = result.sheet;
  app.limited = result.limited;
  app.currency = result.currency;
  paint();
}

function setView(view) {
  if (!VIEWS[view]) return;
  app.view = view;
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  paint();
}

function paint() {
  for (const tab of qsa('.tab')) {
    tab.classList.toggle('active', tab.dataset.view === app.view);
  }

  const plan = qs('#plan-pill');
  plan.textContent = app.plan === 'pro' ? 'Pro' : 'Free';
  plan.className = `pill ${app.plan === 'pro' ? 'pill-pro' : ''}`;

  qs('#upgrade-button').classList.toggle('hidden', app.plan === 'pro');
  paintTrackingState();

  render(qs('#view'), VIEWS[app.view](ctx));
}

function paintTrackingState() {
  const pill = qs('#tracking-state');
  const tracking = app.state?.settings?.tracking || {};
  const paused = Number(tracking.pausedUntil || 0) > Date.now();

  if (!tracking.enabled) {
    pill.textContent = 'Tracking off';
    pill.className = 'pill pill-warn';
  } else if (paused) {
    pill.textContent = 'Paused';
    pill.className = 'pill pill-warn';
  } else {
    pill.textContent = 'Tracking';
    pill.className = 'pill pill-pro';
  }
}

// ------------------------------------------------------------------ wiring

qs('#tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (tab) setView(tab.dataset.view);
});

qs('#upgrade-button').addEventListener('click', () => openUpgrade(ctx));

window.addEventListener('hashchange', () => {
  const hash = location.hash.replace('#', '');
  if (VIEWS[hash]) setView(hash);
});

// Another surface (the popup, or the worker) changed something: stay in sync.
// The worker's own heartbeat writes `current` every minute, which is not worth a
// re-render on its own.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || document.hidden) return;
  if (Date.now() - lastSelfWrite < 600) return;
  const keys = Object.keys(changes);
  if (keys.length === 1 && keys[0] === 'current') return;
  await reload();
});

async function boot() {
  const hash = location.hash.replace('#', '');
  if (VIEWS[hash]) app.view = hash;
  if (hash === 'review') app.view = 'week';
  if (hash === 'activate') app.view = 'settings';

  await reload();

  // Someone who has just paid gets dealt with before anything else.
  if (await maybeFinishActivation(ctx)) return;

  if (hash === 'welcome' || !app.state.settings.onboarding.completed) {
    maybeShowOnboarding(ctx);
  }
}

boot().catch((error) => {
  console.error('[billed] dashboard failed to start', error);
  render(qs('#view'), el('div.card.card-pad', {}, [
    el('h2', { text: 'Billed could not start' }),
    el('p.muted', { text: String(error?.message || error) }),
    el('button.btn', { text: 'Reload', on: { click: () => location.reload() } }),
  ]));
});
