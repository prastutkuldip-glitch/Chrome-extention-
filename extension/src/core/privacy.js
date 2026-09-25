/**
 * Privacy layer.
 *
 * Billed never stores a full URL. Before anything is written to disk a visit is
 * reduced to `hostname` + `path`, query strings and fragments are dropped (they
 * are where tokens, search terms and record IDs live), and anything matching the
 * blocklist is discarded entirely.
 */

/** Only these schemes are ever recorded. */
const TRACKABLE_PROTOCOLS = new Set(['http:', 'https:']);

/** Hard cap so a pathological path can't bloat the database. */
const MAX_PATH_LENGTH = 180;
const MAX_TITLE_LENGTH = 160;

/**
 * Enabled on first run. Deliberately conservative: only categories that are
 * almost never billable client work. Ambiguous domains (youtube.com,
 * reddit.com, whatsapp.com, linkedin.com) are left out on purpose — plenty of
 * people genuinely bill time on those.
 */
export const SUGGESTED_BLOCKLIST = [
  // Money
  '*bank*', '*paypal*', 'wise.com', 'venmo.com', 'cash.app', 'revolut.com',
  'coinbase.com', 'binance.com', 'zerodha.com', 'groww.in', 'robinhood.com',
  // Health
  '*health*', '*hospital*', '*clinic*', '*patient*', '*pharmacy*', 'practo.com',
  // Adult / dating
  '*porn*', '*xxx*', 'onlyfans.com', 'tinder.com', 'bumble.com', 'hinge.co',
  // Personal social + streaming
  'facebook.com', 'instagram.com', 'tiktok.com', 'snapchat.com',
  'netflix.com', 'primevideo.com', 'hotstar.com', 'spotify.com', 'twitch.tv',
];

/**
 * Turn one blocklist entry into a matcher.
 *
 * - `*bank*`        → wildcard, tested against `hostname + path`
 * - `github.com/me` → prefix match on `hostname + path`
 * - `example.com`   → that domain and any subdomain of it
 */
export function patternToMatcher(pattern) {
  const raw = String(pattern || '').trim().toLowerCase();
  if (!raw) return () => false;

  if (raw.includes('*')) {
    const source = raw
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    const re = new RegExp(`^${source}$`, 'i');
    return (hostname, path) => re.test(hostname) || re.test(hostname + path);
  }

  if (raw.includes('/')) {
    const prefix = raw.replace(/\/+$/, '');
    return (hostname, path) => (hostname + path).toLowerCase().startsWith(prefix);
  }

  return (hostname) => hostname === raw || hostname.endsWith(`.${raw}`);
}

/** Compile a blocklist once, reuse for many events. */
export function compileBlocklist(patterns = []) {
  const matchers = patterns.map(patternToMatcher);
  return (hostname, path = '') => matchers.some((m) => m(hostname, path));
}

export function isBlocked(hostname, path, patterns = []) {
  return compileBlocklist(patterns)(hostname, path);
}

/** Drop `www.` and lowercase, so `WWW.Acme.com` and `acme.com` are one thing. */
export function normalizeHostname(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

/**
 * Reduce a raw URL to the minimum we are willing to store.
 * @returns {{ ok: boolean, reason?: string, hostname?: string, path?: string }}
 */
export function sanitizeUrl(rawUrl, opts = {}) {
  const { keepQuery = false } = opts;
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  if (!TRACKABLE_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: 'protocol' };
  }

  // localhost and bare IPs are kept on purpose: developers bill real time there.
  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) return { ok: false, reason: 'no-host' };

  let path = parsed.pathname || '/';
  if (keepQuery && parsed.search) path += parsed.search;
  if (path.length > 1) path = path.replace(/\/+$/, '');
  if (path.length > MAX_PATH_LENGTH) path = `${path.slice(0, MAX_PATH_LENGTH)}…`;

  return { ok: true, hostname, path: path || '/' };
}

/**
 * Tidy a tab title: drop unread counters and the app name most sites append.
 * Keeps ticket keys and document names, which is what a timesheet line needs.
 */
export function cleanTitle(title) {
  let out = String(title || '').replace(/\s+/g, ' ').trim();
  out = out.replace(/^\(\d+\)\s*/, '');
  const suffixes = [
    ' - Google Docs', ' - Google Sheets', ' - Google Slides', ' - Google Drive',
    ' - Jira', ' - Confluence', ' | Asana', ' - Asana', ' - Figma', ' – Figma',
    ' | Notion', ' - Notion', ' | Linear', ' - Zendesk', ' | Slack', ' - Slack',
    ' | Microsoft Teams', ' - Microsoft Teams', ' - Outlook', ' - Gmail',
    ' · GitHub', ' - GitHub', ' · GitLab', ' | ClickUp', ' - monday.com',
    ' | Salesforce', ' - Trello', ' | HubSpot',
  ];
  for (const suffix of suffixes) {
    if (out.toLowerCase().endsWith(suffix.toLowerCase())) {
      out = out.slice(0, -suffix.length).trim();
      break;
    }
  }
  if (out.length > MAX_TITLE_LENGTH) out = `${out.slice(0, MAX_TITLE_LENGTH)}…`;
  return out;
}

/**
 * The single gate every visit passes through before it can be stored.
 * @returns {{ ok: boolean, reason?: string, hostname?: string, path?: string, title?: string }}
 */
export function prepareVisit({ url, title }, settings = {}) {
  const { blocklist = [], storeTitles = true, keepQuery = false } = settings;
  const sanitized = sanitizeUrl(url, { keepQuery });
  if (!sanitized.ok) return sanitized;
  if (compileBlocklist(blocklist)(sanitized.hostname, sanitized.path)) {
    return { ok: false, reason: 'blocked' };
  }
  return {
    ok: true,
    hostname: sanitized.hostname,
    path: sanitized.path,
    title: storeTitles ? cleanTitle(title) : '',
  };
}
