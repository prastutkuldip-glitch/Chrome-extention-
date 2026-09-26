/**
 * The message contract between pages and the service worker.
 *
 * Shared state travels through chrome.storage and the visit database directly;
 * messages are reserved for things only the worker may do — driving the tracker,
 * talking to the licence server, and housekeeping.
 */

export const MSG = {
  flush: 'billed:flush',
  reconcile: 'billed:reconcile',
  status: 'billed:status',
  activateLicense: 'billed:license:activate',
  deactivateLicense: 'billed:license:deactivate',
  pause: 'billed:pause',
  resume: 'billed:resume',
  refreshBadge: 'billed:badge',
  enableReminders: 'billed:reminders:enable',
  wipe: 'billed:wipe',
};

/**
 * Send a message and get a plain result back.
 * Never throws: a sleeping or reloading worker resolves to `{ ok: false }`
 * instead of exploding inside a click handler.
 */
export async function send(type, payload = {}) {
  try {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    return response ?? { ok: false, error: 'no-response' };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}
