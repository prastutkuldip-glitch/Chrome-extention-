/**
 * Attribution — deciding which client a visit belongs to.
 *
 * Rules are deliberately dumb and inspectable: no model, no guessing. The user
 * can always answer "why is this time on Acme?" by pointing at one rule. When
 * two rules could match, the more specific one wins, which is what people
 * expect: `github.com/acme` should beat a blanket `github.com`.
 */

import { deriveWorkspace } from './workspaces.js';
import { mergeRefs } from './refs.js';

/** @typedef {'path'|'hostname'|'title'|'regex'} RuleKind */

export const RULE_KINDS = /** @type {RuleKind[]} */ (['path', 'hostname', 'title', 'regex']);

export const RULE_KIND_LABELS = {
  path: 'URL starts with',
  hostname: 'Domain is',
  title: 'Page title contains',
  regex: 'Matches pattern',
};

/**
 * Does a rule match a visit?
 * @param {{ kind: RuleKind, value: string, enabled?: boolean }} rule
 * @param {{ hostname: string, path?: string, title?: string }} visit
 */
export function matchRule(rule, visit) {
  if (!rule || rule.enabled === false) return false;
  const value = String(rule.value || '').trim().toLowerCase();
  if (!value) return false;

  const hostname = String(visit.hostname || '').toLowerCase();
  const path = String(visit.path || '/');
  const title = String(visit.title || '');

  switch (rule.kind) {
    case 'hostname':
      return hostname === value || hostname.endsWith(`.${value}`);
    case 'path': {
      const target = `${hostname}${path}`.toLowerCase();
      const prefix = value.replace(/\/+$/, '');
      return target === prefix || target.startsWith(`${prefix}/`) || target.startsWith(prefix);
    }
    case 'title':
      return title.toLowerCase().includes(value);
    case 'regex':
      try {
        return new RegExp(rule.value, 'i').test(`${hostname}${path} ${title}`);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/**
 * Higher wins. A longer pattern of the same kind is treated as more specific,
 * so `github.com/acme/billing` beats `github.com/acme`.
 */
export function ruleSpecificity(rule) {
  const length = String(rule?.value || '').length;
  const base = { path: 4000, regex: 3000, hostname: 2000, title: 1000 }[rule?.kind] ?? 0;
  return base + length + (Number(rule?.priority) || 0) * 10_000;
}

/** Sort enabled rules so the first match is the best match. */
export function compileRules(rules = []) {
  return rules
    .filter((rule) => rule && rule.enabled !== false && rule.value)
    .slice()
    .sort((a, b) => ruleSpecificity(b) - ruleSpecificity(a));
}

/**
 * @param {{ hostname: string, path?: string, title?: string }} visit
 * @param {Array} compiledRules output of {@link compileRules}
 * @returns {{ clientId: string, projectId: string|null, billable: boolean, ruleId: string }|null}
 */
export function attribute(visit, compiledRules) {
  for (const rule of compiledRules) {
    if (matchRule(rule, visit)) {
      return {
        clientId: rule.clientId,
        projectId: rule.projectId || null,
        billable: rule.billable !== false,
        ruleId: rule.id,
      };
    }
  }
  return null;
}

/**
 * Group everything that matched no rule, by the workspace that identifies a
 * client, biggest first. This is the dashboard's "Needs review" queue and the
 * only recurring chore the product asks of anyone.
 *
 * @param {Array<{hostname:string, path?:string, title?:string, seconds:number}>} visits
 * @returns {Array<{key:string,label:string,seconds:number,visits:number,ruleKind:string,ruleValue:string,tool:string|null,sampleTitles:string[],refs:string[]}>}
 */
export function collectUnassigned(visits = []) {
  const groups = new Map();
  for (const visit of visits) {
    const workspace = deriveWorkspace(visit);
    let group = groups.get(workspace.key);
    if (!group) {
      group = {
        key: workspace.key,
        label: workspace.label,
        ruleKind: workspace.ruleKind,
        ruleValue: workspace.ruleValue,
        tool: workspace.tool,
        seconds: 0,
        visits: 0,
        sampleTitles: [],
        refLists: [],
      };
      groups.set(workspace.key, group);
    }
    group.seconds += visit.seconds || 0;
    group.visits += 1;
    if (visit.title && group.sampleTitles.length < 4 && !group.sampleTitles.includes(visit.title)) {
      group.sampleTitles.push(visit.title);
    }
    if (visit.refs?.length) group.refLists.push(visit.refs);
  }

  return [...groups.values()]
    .map(({ refLists, ...group }) => ({ ...group, refs: mergeRefs(refLists, 6) }))
    .sort((a, b) => b.seconds - a.seconds);
}
