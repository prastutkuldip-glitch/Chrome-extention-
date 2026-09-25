import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanTitle,
  compileBlocklist,
  isBlocked,
  normalizeHostname,
  prepareVisit,
  sanitizeUrl,
  SUGGESTED_BLOCKLIST,
} from '../extension/src/core/privacy.js';

test('query strings and fragments are always dropped', () => {
  const result = sanitizeUrl('https://acme.atlassian.net/browse/PAY-2214?token=secret#comment-9');
  assert.equal(result.ok, true);
  assert.equal(result.hostname, 'acme.atlassian.net');
  assert.equal(result.path, '/browse/PAY-2214');
});

test('query strings can be kept only when explicitly asked for', () => {
  const result = sanitizeUrl('https://example.com/search?q=hello', { keepQuery: true });
  assert.equal(result.path, '/search?q=hello');
});

test('non-web schemes are never recorded', () => {
  for (const url of ['chrome://extensions', 'about:blank', 'file:///Users/me/taxes.pdf', 'chrome-extension://abc/page.html']) {
    assert.equal(sanitizeUrl(url).ok, false, url);
  }
});

test('garbage input fails closed', () => {
  assert.equal(sanitizeUrl('not a url').ok, false);
  assert.equal(sanitizeUrl('').ok, false);
  assert.equal(sanitizeUrl(undefined).ok, false);
});

test('www is stripped so one site is one site', () => {
  assert.equal(normalizeHostname('WWW.Acme.COM'), 'acme.com');
  assert.equal(sanitizeUrl('https://www.acme.com/about/').hostname, 'acme.com');
  assert.equal(sanitizeUrl('https://www.acme.com/about/').path, '/about');
});

test('localhost is kept — developers bill real time there', () => {
  const result = sanitizeUrl('http://localhost:3000/admin');
  assert.equal(result.ok, true);
  assert.equal(result.hostname, 'localhost');
});

test('blocklist entries match a domain and its subdomains', () => {
  const blocked = compileBlocklist(['acme.com']);
  assert.equal(blocked('acme.com', '/'), true);
  assert.equal(blocked('mail.acme.com', '/'), true);
  assert.equal(blocked('notacme.com', '/'), false);
});

test('wildcard blocklist entries match anywhere in the hostname', () => {
  assert.equal(isBlocked('hdfcbank.com', '/login', SUGGESTED_BLOCKLIST), true);
  assert.equal(isBlocked('mybankofamerica.com', '/', ['*bank*']), true);
  assert.equal(isBlocked('acme.atlassian.net', '/browse/PAY-1', SUGGESTED_BLOCKLIST), false);
});

test('path-scoped blocklist entries only block that path', () => {
  const blocked = compileBlocklist(['github.com/personal-side-project']);
  assert.equal(blocked('github.com', '/personal-side-project/readme'), true);
  assert.equal(blocked('github.com', '/acme-corp/api'), false);
});

test('ambiguous work domains are deliberately absent from the suggested list', () => {
  for (const host of ['youtube.com', 'reddit.com', 'linkedin.com', 'web.whatsapp.com', 'mail.google.com']) {
    assert.equal(isBlocked(host, '/', SUGGESTED_BLOCKLIST), false, host);
  }
});

test('titles lose unread counters and app-name suffixes', () => {
  assert.equal(cleanTitle('(12) PAY-2214 Refund retries - Jira'), 'PAY-2214 Refund retries');
  assert.equal(cleanTitle('Q3 migration runbook - Google Docs'), 'Q3 migration runbook');
  assert.equal(cleanTitle('  spaced    out  '), 'spaced out');
});

test('prepareVisit is the single gate before anything is stored', () => {
  const settings = { blocklist: ['*bank*'], storeTitles: true };
  assert.equal(prepareVisit({ url: 'https://icicibank.com/', title: 'Bank' }, settings).ok, false);

  const ok = prepareVisit({ url: 'https://acme.atlassian.net/browse/PAY-9?x=1', title: '(3) PAY-9 Fix - Jira' }, settings);
  assert.deepEqual(ok, { ok: true, hostname: 'acme.atlassian.net', path: '/browse/PAY-9', title: 'PAY-9 Fix' });
});

test('storeTitles:false keeps the timing but drops the text', () => {
  const result = prepareVisit({ url: 'https://acme.com/x', title: 'Secret project' }, { storeTitles: false });
  assert.equal(result.ok, true);
  assert.equal(result.title, '');
});
