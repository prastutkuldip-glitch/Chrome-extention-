/**
 * chrome.storage.local wrapper for everything that is small: settings, clients,
 * rules, the licence and the tracker's open segment.
 *
 * Pages write here directly and the service worker reacts through
 * `chrome.storage.onChanged`, which keeps the UI free of message-passing
 * ceremony for what is really just shared state.
 */

import { withDefaults } from '../core/defaults.js';

export const KEYS = {
  settings: 'settings',
  clients: 'clients',
  rules: 'rules',
  license: 'license',
  current: 'current',
  install: 'install',
  pending: 'pending',
};

async function readRaw(keys) {
  return chrome.storage.local.get(keys);
}

export async function getSettings() {
  const raw = await readRaw(KEYS.settings);
  return withDefaults(raw[KEYS.settings] || {});
}

export async function setSettings(settings) {
  await chrome.storage.local.set({ [KEYS.settings]: settings });
  return settings;
}

/** Shallow-merge a patch into one settings section. */
export async function patchSettings(section, patch) {
  const settings = await getSettings();
  settings[section] = { ...settings[section], ...patch };
  return setSettings(settings);
}

export async function getClients() {
  const raw = await readRaw(KEYS.clients);
  return Array.isArray(raw[KEYS.clients]) ? raw[KEYS.clients] : [];
}

export async function setClients(clients) {
  await chrome.storage.local.set({ [KEYS.clients]: clients });
  return clients;
}

export async function getRules() {
  const raw = await readRaw(KEYS.rules);
  return Array.isArray(raw[KEYS.rules]) ? raw[KEYS.rules] : [];
}

export async function setRules(rules) {
  await chrome.storage.local.set({ [KEYS.rules]: rules });
  return rules;
}

export async function getLicense() {
  const raw = await readRaw(KEYS.license);
  return raw[KEYS.license] || { key: '', status: 'none', verifiedAt: 0, expiresAt: null };
}

export async function setLicense(license) {
  await chrome.storage.local.set({ [KEYS.license]: license });
  return license;
}

export async function getCurrent() {
  const raw = await readRaw(KEYS.current);
  return raw[KEYS.current] || null;
}

export async function setCurrent(current) {
  await chrome.storage.local.set({ [KEYS.current]: current });
  return current;
}

export async function clearCurrent() {
  await chrome.storage.local.remove(KEYS.current);
}

/**
 * A licence key handed over by the activation page that still needs a network
 * check. Held here so the dashboard can finish the job with one click, because
 * `chrome.permissions.request` only works from a gesture inside our own UI.
 */
export async function getPendingActivation() {
  const raw = await readRaw(KEYS.pending);
  return raw[KEYS.pending] || null;
}

export async function setPendingActivation(pending) {
  await chrome.storage.local.set({ [KEYS.pending]: pending });
  return pending;
}

export async function clearPendingActivation() {
  await chrome.storage.local.remove(KEYS.pending);
}

export async function getInstall() {
  const raw = await readRaw(KEYS.install);
  return raw[KEYS.install] || null;
}

export async function setInstall(install) {
  await chrome.storage.local.set({ [KEYS.install]: install });
  return install;
}

/** Everything the UI needs in one round trip. */
export async function loadState() {
  const [settings, clients, rules, license, current, install, pending] = await Promise.all([
    getSettings(), getClients(), getRules(), getLicense(), getCurrent(), getInstall(), getPendingActivation(),
  ]);
  return { settings, clients, rules, license, current, install, pending };
}

/**
 * Subscribe to changes in the keys we care about.
 * @param {(changed: Record<string, chrome.storage.StorageChange>) => void} handler
 */
export function onStateChanged(handler) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const relevant = Object.fromEntries(
      Object.entries(changes).filter(([key]) => Object.values(KEYS).includes(key)),
    );
    if (Object.keys(relevant).length) handler(relevant);
  });
}
