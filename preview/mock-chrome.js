/**
 * A minimal `chrome.*` stand-in, so the real extension pages can be opened in an
 * ordinary browser tab for review and screenshots.
 *
 * This is a development-only harness. It is never packaged: `tools/package.mjs`
 * excludes it, and the generated preview pages are gitignored. Nothing in
 * `extension/` imports it — the extension pages are loaded unmodified, which is
 * the point. If the preview renders, the real UI renders.
 *
 * IndexedDB is genuine in a browser tab, so `platform/db.js` runs untouched. Only
 * the `chrome` namespace is faked.
 */

(() => {
  const store = new Map();
  const changeListeners = [];

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function readKeys(keys) {
    if (keys === null || keys === undefined) {
      return Object.fromEntries([...store.entries()].map(([key, value]) => [key, clone(value)]));
    }
    const list = Array.isArray(keys) ? keys : [keys];
    const out = {};
    for (const key of list) {
      if (store.has(key)) out[key] = clone(store.get(key));
    }
    return out;
  }

  const local = {
    async get(keys) {
      return readKeys(keys);
    },
    async set(items) {
      const changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: clone(store.get(key)), newValue: clone(value) };
        store.set(key, clone(value));
      }
      notify(changes);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const changes = {};
      for (const key of list) {
        if (!store.has(key)) continue;
        changes[key] = { oldValue: clone(store.get(key)), newValue: undefined };
        store.delete(key);
      }
      notify(changes);
    },
    async clear() {
      store.clear();
    },
  };

  function notify(changes) {
    if (!Object.keys(changes).length) return;
    // Asynchronous, like the real event, so callers finish their own work first.
    setTimeout(() => {
      for (const listener of changeListeners) {
        try {
          listener(changes, 'local');
        } catch (error) {
          console.warn('[preview] storage listener threw', error);
        }
      }
    }, 0);
  }

  /** Messages the service worker would normally answer. */
  async function sendMessage(message) {
    switch (message?.type) {
      case 'billed:flush':
      case 'billed:reconcile':
      case 'billed:badge':
        return { ok: true };

      case 'billed:pause': {
        const settings = (await local.get('settings')).settings || {};
        settings.tracking = { ...settings.tracking, pausedUntil: Date.now() + (message.minutes || 60) * 60_000 };
        await local.set({ settings });
        return { ok: true };
      }

      case 'billed:resume': {
        const settings = (await local.get('settings')).settings || {};
        settings.tracking = { ...settings.tracking, pausedUntil: 0 };
        await local.set({ settings });
        return { ok: true };
      }

      case 'billed:license:activate':
        return {
          ok: false,
          status: 'unreachable',
          message: 'Preview mode: the licence server is not contacted here.',
        };

      case 'billed:license:deactivate':
        await local.set({ license: { key: '', status: 'none', verifiedAt: 0, expiresAt: null } });
        return { ok: true };

      case 'billed:reminders:enable':
        return { ok: true, granted: false };

      case 'billed:wipe':
        return { ok: true };

      default:
        return { ok: false, error: `preview: unhandled ${message?.type}` };
    }
  }

  globalThis.chrome = {
    runtime: {
      id: 'preview',
      getManifest: () => ({ version: '1.0.0', name: 'Billed' }),
      /** Map extension-relative paths onto the paths this preview is served from. */
      getURL: (path) => {
        const mapped = String(path).replace('dashboard.html', 'preview.html');
        return new URL(`/extension/${mapped}`, location.origin).href;
      },
      sendMessage,
      onMessage: { addListener() {} },
    },

    storage: {
      local,
      session: local,
      onChanged: { addListener: (fn) => changeListeners.push(fn) },
    },

    tabs: {
      async query() { return []; },
      async create({ url }) { console.log('[preview] would open', url); return { id: 1 }; },
      async update() { return { id: 1 }; },
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
    },

    windows: {
      WINDOW_ID_NONE: -1,
      async get() { return { focused: true }; },
      async update() {},
      onFocusChanged: { addListener() {} },
    },

    permissions: {
      async contains() { return false; },
      async request() { return false; },
      onAdded: { addListener() {} },
    },

    idle: {
      queryState: (_seconds, callback) => callback('active'),
      setDetectionInterval() {},
      onStateChanged: { addListener() {} },
    },

    alarms: {
      async create() {},
      async clear() {},
      onAlarm: { addListener() {} },
    },

    action: {
      setBadgeText() {},
      setBadgeBackgroundColor() {},
    },

    notifications: undefined,
  };

  globalThis.__BILLED_PREVIEW__ = { store, local };
})();
