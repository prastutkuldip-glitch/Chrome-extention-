import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  attribute,
  collectUnassigned,
  compileRules,
  matchRule,
  ruleSpecificity,
} from '../extension/src/core/attribution.js';
import { deriveWorkspace, prettifyLabel } from '../extension/src/core/workspaces.js';
import { extractRefs, mergeRefs } from '../extension/src/core/refs.js';

const visit = (hostname, path = '/', title = '') => ({ hostname, path, title });

test('hostname rules match subdomains', () => {
  const rule = { kind: 'hostname', value: 'atlassian.net', clientId: 'a' };
  assert.equal(matchRule(rule, visit('acme.atlassian.net', '/browse/PAY-1')), true);
  assert.equal(matchRule(rule, visit('atlassian.net', '/')), true);
  assert.equal(matchRule(rule, visit('notatlassian.net', '/')), false);
});

test('path rules match the prefix and everything under it', () => {
  const rule = { kind: 'path', value: 'github.com/acme-corp', clientId: 'a' };
  assert.equal(matchRule(rule, visit('github.com', '/acme-corp')), true);
  assert.equal(matchRule(rule, visit('github.com', '/acme-corp/api/pull/812')), true);
  assert.equal(matchRule(rule, visit('github.com', '/other-org/api')), false);
});

test('title rules are case-insensitive', () => {
  const rule = { kind: 'title', value: 'acme', clientId: 'a' };
  assert.equal(matchRule(rule, visit('docs.google.com', '/document/d/1', 'ACME Q3 runbook')), true);
  assert.equal(matchRule(rule, visit('docs.google.com', '/document/d/1', 'Internal notes')), false);
});

test('a broken regex rule fails closed instead of throwing', () => {
  const rule = { kind: 'regex', value: '([unclosed', clientId: 'a' };
  assert.equal(matchRule(rule, visit('acme.com')), false);
});

test('disabled and empty rules never match', () => {
  assert.equal(matchRule({ kind: 'hostname', value: 'acme.com', enabled: false }, visit('acme.com')), false);
  assert.equal(matchRule({ kind: 'hostname', value: '   ' }, visit('acme.com')), false);
});

test('the more specific rule wins', () => {
  const broad = { id: 'broad', kind: 'hostname', value: 'github.com', clientId: 'internal' };
  const narrow = { id: 'narrow', kind: 'path', value: 'github.com/acme-corp', clientId: 'acme' };
  assert.ok(ruleSpecificity(narrow) > ruleSpecificity(broad));

  const compiled = compileRules([broad, narrow]);
  assert.equal(attribute(visit('github.com', '/acme-corp/api'), compiled).clientId, 'acme');
  assert.equal(attribute(visit('github.com', '/my-notes'), compiled).clientId, 'internal');
});

test('a longer path rule beats a shorter one', () => {
  const compiled = compileRules([
    { id: 'a', kind: 'path', value: 'github.com/acme', clientId: 'acme' },
    { id: 'b', kind: 'path', value: 'github.com/acme/billing-service', clientId: 'acme-billing' },
  ]);
  assert.equal(attribute(visit('github.com', '/acme/billing-service/pull/1'), compiled).clientId, 'acme-billing');
  assert.equal(attribute(visit('github.com', '/acme/website'), compiled).clientId, 'acme');
});

test('priority can override specificity for a pinned rule', () => {
  const compiled = compileRules([
    { id: 'a', kind: 'path', value: 'github.com/acme/very/long/path', clientId: 'acme' },
    { id: 'b', kind: 'title', value: 'urgent', clientId: 'escalation', priority: 1 },
  ]);
  assert.equal(attribute(visit('github.com', '/acme/very/long/path', 'urgent fix'), compiled).clientId, 'escalation');
});

test('non-billable rules are honoured', () => {
  const compiled = compileRules([{ id: 'a', kind: 'hostname', value: 'linkedin.com', clientId: 'admin', billable: false }]);
  assert.equal(attribute(visit('linkedin.com'), compiled).billable, false);
});

test('unmatched visits return null', () => {
  assert.equal(attribute(visit('random.com'), compileRules([])), null);
});

test('workspace detection finds the tenant, not the tool', () => {
  assert.equal(deriveWorkspace({ hostname: 'acme.atlassian.net', path: '/browse/PAY-1' }).key, 'acme.atlassian.net');
  assert.equal(deriveWorkspace({ hostname: 'acme.atlassian.net', path: '/browse/PAY-1' }).label, 'Acme');

  const gh = deriveWorkspace({ hostname: 'github.com', path: '/acme-corp/api/pull/812' });
  assert.equal(gh.key, 'github.com/acme-corp');
  assert.equal(gh.ruleKind, 'path');
  assert.equal(gh.label, 'Acme Corp');

  const asana = deriveWorkspace({ hostname: 'app.asana.com', path: '/0/1201/9987' });
  assert.equal(asana.key, 'app.asana.com/0/1201');
});

test('github utility paths are not mistaken for clients', () => {
  const result = deriveWorkspace({ hostname: 'github.com', path: '/notifications' });
  assert.equal(result.key, 'github.com');
  assert.equal(result.ruleKind, 'hostname');
});

test('notion personal pages are not mistaken for a client workspace', () => {
  const pageId = 'a'.repeat(32);
  const personal = deriveWorkspace({ hostname: 'www.notion.so', path: `/Q3-Runbook-${pageId}` });
  assert.equal(personal.key, 'www.notion.so');

  const team = deriveWorkspace({ hostname: 'www.notion.so', path: `/acme-team/Q3-Runbook-${pageId}` });
  assert.equal(team.key, 'www.notion.so/acme-team');
  assert.equal(team.label, 'Acme Team');
});

test('unknown hosts fall back to the hostname itself', () => {
  const result = deriveWorkspace({ hostname: 'app.hey-tool.io', path: '/x' });
  assert.equal(result.key, 'app.hey-tool.io');
  assert.equal(result.ruleKind, 'hostname');
});

test('prettifyLabel makes a label a human would accept', () => {
  assert.equal(prettifyLabel('acme-corp'), 'Acme Corp');
  assert.equal(prettifyLabel('northStarLabs'), 'North Star Labs');
});

test('the review queue groups by tenant and sorts by time', () => {
  const queue = collectUnassigned([
    { hostname: 'github.com', path: '/acme-corp/api', title: 'PR #812', seconds: 600, refs: ['#812'] },
    { hostname: 'github.com', path: '/acme-corp/web', title: 'PR #813', seconds: 300, refs: ['#813'] },
    { hostname: 'notion.so', path: '/notes', title: 'Notes', seconds: 1200 },
  ]);
  assert.equal(queue.length, 2);
  assert.equal(queue[0].key, 'notion.so');
  assert.equal(queue[0].seconds, 1200);
  assert.equal(queue[1].key, 'github.com/acme-corp');
  assert.equal(queue[1].seconds, 900);
  assert.equal(queue[1].visits, 2);
  assert.deepEqual(queue[1].refs, ['#812', '#813']);
});

test('task references are pulled out of titles', () => {
  assert.deepEqual(extractRefs('PAY-2214 refund retries'), ['PAY-2214']);
  assert.deepEqual(extractRefs('INC0012345 escalation'), ['INC0012345']);
  assert.deepEqual(extractRefs('Fix login (#812)'), ['#812']);
  assert.deepEqual(extractRefs('no refs here'), []);
  assert.deepEqual(extractRefs(''), []);
});

test('reference lists de-duplicate and cap', () => {
  assert.deepEqual(mergeRefs([['A-1', 'A-2'], ['A-2', 'A-3']], 2), ['A-1', 'A-2']);
});
