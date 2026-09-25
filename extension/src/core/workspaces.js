/**
 * Workspace detection — the part that makes attribution feel like magic.
 *
 * Knowing someone was on `atlassian.net` is useless: everybody is. Knowing they
 * were on `acme.atlassian.net`, or under `github.com/acme-corp`, identifies the
 * *client*. So before we ever ask the user to assign anything, we collapse
 * visits to the tenant that actually carries the client signal, and we propose
 * the narrowest rule that captures it.
 */

/** Tools where the tenant lives in the subdomain. */
const SUBDOMAIN_TENANT_SUFFIXES = [
  'atlassian.net', 'slack.com', 'zendesk.com', 'freshdesk.com', 'freshservice.com',
  'myshopify.com', 'my.salesforce.com', 'lightning.force.com', 'sharepoint.com',
  'service-now.com', 'workday.com', 'zohodesk.com', 'helpscout.net',
  'intercom.com', 'statuspage.io', 'bamboohr.com', 'greenhouse.io',
  'teamwork.com', 'basecamp.com', 'wrike.com', 'smartsheet.com',
];

/** Tools where the tenant is the first path segment. */
const PATH_TENANT_HOSTS = {
  'github.com': { skip: new Set(['settings', 'notifications', 'pulls', 'issues', 'explore', 'marketplace', 'codespaces', 'orgs', 'apps', 'search', 'topics', 'sponsors', 'features', 'about', 'login', 'new']) },
  'gitlab.com': { skip: new Set(['dashboard', 'explore', 'help', 'projects', 'groups', '-', 'users', 'search']) },
  'bitbucket.org': { skip: new Set(['dashboard', 'account', 'repo', 'product']) },
  'linear.app': { skip: new Set(['settings', 'join', 'login']) },
  'app.clickup.com': { skip: new Set(['login', 'settings']) },
  'app.shortcut.com': { skip: new Set(['settings']) },
  'vercel.com': { skip: new Set(['dashboard', 'docs', 'account', 'new', 'templates', 'login']) },
  'app.netlify.com': { skip: new Set(['sites', 'user', 'signup', 'login']) },
  // Notion is ambiguous: a team URL is /workspace/Page-<id> but a personal one is
  // just /Page-<id>. So only treat the first segment as a tenant when a second
  // segment exists and the first isn't itself a page slug.
  'www.notion.so': { skip: new Set(['login', 'product', 'templates']), requireNested: true },
  'notion.so': { skip: new Set(['login', 'product', 'templates']), requireNested: true },
};

/** Notion/Confluence style slug ending in a 32-character hex id. */
const PAGE_SLUG = /-?[0-9a-f]{32}$/i;

/** Multi-tenant hosts where the tenant is the second path segment. */
const NESTED_PATH_TENANT_HOSTS = {
  // app.asana.com/0/<projectId>/...
  'app.asana.com': { prefix: '0' },
};

function subdomainTenant(hostname) {
  for (const suffix of SUBDOMAIN_TENANT_SUFFIXES) {
    if (hostname.endsWith(`.${suffix}`)) {
      const tenant = hostname.slice(0, -(suffix.length + 1)).split('.').pop();
      if (tenant && tenant !== 'www' && tenant !== 'app') {
        return { tenant, tool: suffix };
      }
      return { tenant: null, tool: suffix };
    }
  }
  return null;
}

function segments(path) {
  return String(path || '/').split('/').filter(Boolean);
}

/** `acme-corp` → `Acme Corp`, `acmeCorp` → `Acme Corp`. */
export function prettifyLabel(value) {
  return String(value || '')
    .replace(/[-_.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => (word.length <= 3 && word === word.toUpperCase() ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

/**
 * Collapse a visit to the tenant that identifies a client, plus the narrowest
 * rule that would capture it.
 *
 * @param {{ hostname: string, path?: string }} visit
 * @returns {{ key: string, label: string, ruleKind: 'hostname'|'path', ruleValue: string, tool: string|null, tenant: string|null }}
 */
export function deriveWorkspace(visit) {
  const hostname = String(visit.hostname || '').toLowerCase();
  const path = visit.path || '/';

  const sub = subdomainTenant(hostname);
  if (sub && sub.tenant) {
    return {
      key: hostname,
      label: prettifyLabel(sub.tenant),
      ruleKind: 'hostname',
      ruleValue: hostname,
      tool: sub.tool,
      tenant: sub.tenant,
    };
  }

  const nested = NESTED_PATH_TENANT_HOSTS[hostname];
  if (nested) {
    const parts = segments(path);
    if (parts[0] === nested.prefix && parts[1]) {
      const value = `${hostname}/${parts[0]}/${parts[1]}`;
      return {
        key: value,
        label: `${prettifyLabel(hostname.split('.')[1] || hostname)} ${parts[1]}`,
        ruleKind: 'path',
        ruleValue: value,
        tool: hostname,
        tenant: parts[1],
      };
    }
  }

  const pathTenant = PATH_TENANT_HOSTS[hostname];
  if (pathTenant) {
    const parts = segments(path);
    const first = parts[0];
    const nestedOk = !pathTenant.requireNested || (parts.length >= 2 && !PAGE_SLUG.test(first || ''));
    if (first && nestedOk && !pathTenant.skip.has(first.toLowerCase())) {
      const value = `${hostname}/${first}`;
      return {
        key: value,
        label: prettifyLabel(first),
        ruleKind: 'path',
        ruleValue: value,
        tool: hostname,
        tenant: first,
      };
    }
  }

  return {
    key: hostname,
    label: prettifyLabel(hostname.replace(/\.(com|net|org|io|co|app|dev|ai|in)$/, '')),
    ruleKind: 'hostname',
    ruleValue: hostname,
    tool: sub ? sub.tool : null,
    tenant: null,
  };
}
