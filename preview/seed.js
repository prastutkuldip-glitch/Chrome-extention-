/**
 * Seeds a realistic week into the preview harness, then hands control to the
 * real extension page.
 *
 * The data is shaped like an actual consulting week: four clients, a couple of
 * non-billable habits, two sites nobody has assigned yet, and titles carrying the
 * ticket keys the extension is meant to pick up. Nothing here is special-cased —
 * the page runs the same attribution, merging and rounding code that ships.
 *
 * Query parameters:
 *   ?plan=free      render the free plan instead of Pro
 *   ?now=1          leave an in-progress session on an unassigned site
 */

(async () => {
  const params = new URLSearchParams(location.search);
  const { local } = globalThis.__BILLED_PREVIEW__;

  // ---------------------------------------------------------------- calendar

  const today = new Date();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const daysSoFar = (today.getDay() + 6) % 7; // 0 = Monday

  const at = (day, hour, minute) => new Date(
    monday.getFullYear(), monday.getMonth(), monday.getDate() + day, hour, minute,
  ).getTime();

  // ---------------------------------------------------------------- clients

  const clients = [
    { id: 'cl_acme', name: 'Acme Corp', rate: 120, color: '#2563eb', billable: true, projects: [], archived: false, createdAt: Date.now() },
    { id: 'cl_globex', name: 'Globex', rate: 90, color: '#059669', billable: true, projects: [{ id: 'pj_site', name: 'Website redesign' }], archived: false, createdAt: Date.now() },
    { id: 'cl_initech', name: 'Initech', rate: 150, color: '#d97706', billable: true, projects: [], archived: false, createdAt: Date.now() },
    { id: 'cl_admin', name: 'Non-billable', rate: 0, color: '#8892a0', billable: false, projects: [], archived: false, createdAt: Date.now() },
  ];

  const rule = (id, clientId, kind, value, extra = {}) => ({
    id, clientId, kind, value, projectId: null, billable: true, priority: 0, enabled: true, createdAt: Date.now(), ...extra,
  });

  const rules = [
    rule('rl_1', 'cl_acme', 'hostname', 'acme.atlassian.net'),
    rule('rl_2', 'cl_acme', 'path', 'github.com/acme-corp'),
    rule('rl_3', 'cl_globex', 'path', 'github.com/globex-io', { projectId: 'pj_site' }),
    rule('rl_4', 'cl_globex', 'hostname', 'globex.slack.com'),
    rule('rl_5', 'cl_initech', 'hostname', 'initech.zendesk.com'),
    // A title rule: shared tools like Google Docs carry the client in the name.
    rule('rl_6', 'cl_initech', 'title', 'initech'),
    rule('rl_7', 'cl_admin', 'hostname', 'linkedin.com', { billable: false }),
    rule('rl_8', 'cl_admin', 'hostname', 'mail.google.com', { billable: false }),
  ];

  // ---------------------------------------------------------------- the week

  /** [startHour, startMinute, minutes, hostname, path, title] */
  const template = [
    [9, 5, 22, 'mail.google.com', '/mail/u/0', 'Inbox (14)'],
    [9, 32, 58, 'acme.atlassian.net', '/browse/PAY-2214', 'PAY-2214 Refund retries fail on 3DS challenge - Jira'],
    [10, 34, 41, 'github.com', '/acme-corp/payments/pull/812', 'Fix refund retry backoff (#812) · acme-corp/payments · GitHub'],
    [11, 18, 28, 'app.hey-tool.io', '/board/7', 'Sprint board — week 39'],
    [11, 52, 44, 'globex.slack.com', '/client/T01/C02', 'Globex · #website-redesign'],
    [13, 26, 68, 'github.com', '/globex-io/site/pull/44', 'Nav accessibility fixes (#44) · globex-io/site · GitHub'],
    [14, 41, 37, 'initech.zendesk.com', '/agent/tickets/8821', 'Ticket #8821 — SSO login loop after migration - Zendesk'],
    [15, 22, 19, 'linkedin.com', '/feed', 'Feed | LinkedIn'],
    [15, 48, 52, 'docs.google.com', '/document/d/1a2b3c', 'Initech Q3 migration runbook - Google Docs'],
    [16, 46, 39, 'acme.atlassian.net', '/browse/PAY-2231', 'PAY-2231 Webhook replay tool - Jira'],
  ];

  // Deterministic per-day variation, so the week looks lived-in rather than copied.
  const variation = [
    { skip: [], stretch: 1.0 },
    { skip: [3, 7], stretch: 1.15 },
    { skip: [0], stretch: 0.85 },
    { skip: [6], stretch: 1.05 },
    { skip: [1, 4], stretch: 0.7 },
    { skip: [0, 1, 2, 5, 7, 9], stretch: 0.5 },
    { skip: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], stretch: 0 },
  ];

  const NOTION = ['app.notion.so', '/plans/Roadmap-aaaa1111bbbb2222cccc3333dddd4444', 'Roadmap — Q4 planning'];

  const visits = [];
  let counter = 0;
  const push = (start, minutes, [hostname, path, title]) => visits.push({
    id: `v_${counter += 1}`,
    start,
    end: start + minutes * 60_000,
    hostname,
    path,
    title,
  });

  for (let day = 0; day < daysSoFar; day += 1) {
    const { skip, stretch } = variation[day] || variation[0];
    template.forEach(([hour, minute, minutes, ...site], index) => {
      if (skip.includes(index)) return;
      push(at(day, hour, minute), Math.max(2, Math.round(minutes * stretch)), site);
    });
    // A second unassigned site, so the review queue shows more than one row.
    if (day <= 3) push(at(day, 12, 40), 21, NOTION);
  }

  // Today is laid out backwards from the current moment instead of from fixed
  // clock times, so the preview shows a plausible day whatever time it is run.
  const todayBlocks = template
    .filter((_, index) => !(variation[daysSoFar] || variation[0]).skip.includes(index))
    .map(([, , minutes, ...site]) => ({ minutes: Math.max(8, Math.round(minutes * 0.9)), site }));
  todayBlocks.splice(3, 0, { minutes: 18, site: NOTION });

  const GAP = 4;
  const span = todayBlocks.reduce((total, block) => total + block.minutes + GAP, 0);
  let cursor = Date.now() - (span + 9) * 60_000;
  for (const block of todayBlocks) {
    push(cursor, block.minutes, block.site);
    cursor += (block.minutes + GAP) * 60_000;
  }

  // ---------------------------------------------------------------- write it

  const pro = params.get('plan') !== 'free';

  await local.set({
    clients,
    rules,
    license: pro
      ? { key: 'PREVIEW-XXXX-XXXX-9K42QF', status: 'active', verifiedAt: Date.now() - 2 * 86_400_000, expiresAt: null, email: 'you@example.com', tier: 'Yearly' }
      : { key: '', status: 'none', verifiedAt: 0, expiresAt: null },
    settings: {
      version: 1,
      tracking: { enabled: true, idleSeconds: 120, minSegmentSeconds: 30, mergeGapSeconds: 300, keepQuery: false, storeTitles: true, pausedUntil: 0 },
      billing: {
        currency: 'USD',
        defaultRate: 120,
        rounding: { incrementMinutes: 15, direction: 'up', billMinimumIncrement: true },
      },
      display: { weekStartsOn: 1, decimalHours: true, theme: 'system' },
      privacy: {
        blocklist: ['*bank*', '*paypal*', 'wise.com', '*health*', '*clinic*', '*porn*', 'facebook.com', 'instagram.com', 'netflix.com', 'tinder.com'],
        retentionDays: 730,
      },
      reminders: { weeklyReview: pro, dayOfWeek: 5, hour: 16 },
      onboarding: { completed: true, dismissedTips: [] },
    },
    // ?pending=1 — a licence handed over by the checkout, awaiting confirmation.
    ...(params.get('pending') === '1'
      ? { pending: { key: 'B8F1C2D3-4E5A-6B7C-8D9E-0F1A2B3C4D5E', email: 'buyer@example.com', receivedAt: Date.now() } }
      : {}),
    ...(params.get('now') === '1'
      ? {
        current: {
          id: 'v_current',
          start: Date.now() - 14 * 60_000,
          lastSeenAt: Date.now(),
          hostname: 'app.hey-tool.io',
          path: '/board/7',
          title: 'Sprint board — week 39',
          refs: [],
        },
      }
      : {}),
  });

  // Visits go into the real IndexedDB the extension uses.
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('billed', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('visits')) {
        db.createObjectStore('visits', { keyPath: 'id' }).createIndex('by-start', 'start');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('visits', 'readwrite');
      const objectStore = tx.objectStore('visits');
      objectStore.clear();
      for (const visit of visits) objectStore.put(visit);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });

  console.log(`[preview] seeded ${visits.length} sessions across ${daysSoFar + 1} day(s), plan=${pro ? 'pro' : 'free'}`);

  // Only now hand over to the real page module.
  await import(new URL(globalThis.__BILLED_PREVIEW_ENTRY__, location.href).href);
})().catch((error) => {
  console.error('[preview] seeding failed', error);
  document.body.innerHTML = `<pre style="padding:20px;color:#b91c1c">Preview seeding failed:\n${error?.stack || error}</pre>`;
});
