import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyKey,
  isTrustedOrigin,
  KEY_KIND,
  maskKey,
  parseActivationParams,
} from '../extension/src/core/activation.js';

test('reads the provider spelling of the key parameter', () => {
  const result = parseActivationParams('?license_key=ABCD-1234&email=a%40b.com&sale_id=99');
  assert.equal(result.key, 'ABCD-1234');
  assert.equal(result.email, 'a@b.com');
  assert.equal(result.saleId, '99');
});

test('accepts the other spellings a provider might use', () => {
  for (const name of ['license_key', 'licence_key', 'license', 'licence', 'key']) {
    assert.equal(parseActivationParams(`?${name}=XYZ-123`).key, 'XYZ-123', name);
  }
});

test('works from a hash as well as a query string', () => {
  assert.equal(parseActivationParams('#key=ABCD-1234').key, 'ABCD-1234');
});

test('missing or empty parameters do not throw', () => {
  for (const input of ['', '?', '?key=', '?other=1', null, undefined]) {
    const result = parseActivationParams(input);
    assert.equal(result.key, '');
    assert.equal(result.kind, KEY_KIND.unknown);
  }
});

test('whitespace around a key is trimmed', () => {
  assert.equal(parseActivationParams('?key=%20%20ABCD-1234%20').key, 'ABCD-1234');
});

test('our own batch keys are routed to the offline path', () => {
  assert.equal(classifyKey('BILLED-JNGJG-G87NQ-JTHNN'), KEY_KIND.offline);
  assert.equal(classifyKey('billed-jngjg-g87nq-jthnn'), KEY_KIND.offline);
  assert.equal(classifyKey('BILLEDJNGJGG87NQJTHNN'), KEY_KIND.offline);
});

test('provider keys are routed to the network path', () => {
  assert.equal(classifyKey('B8F1C2D3-4E5A-6B7C-8D9E-0F1A2B3C4D5E'), KEY_KIND.provider);
  assert.equal(classifyKey('abc12345'), KEY_KIND.provider);
});

test('nonsense is classified as unknown, not guessed at', () => {
  for (const value of ['', '   ', 'ab', 'has spaces in it', '<script>', null]) {
    assert.equal(classifyKey(value), KEY_KIND.unknown, String(value));
  }
});

test('a truncated BILLED key is not treated as one of ours', () => {
  // It would fail the hash lookup anyway, but routing it correctly gives the
  // buyer the right error message instead of a network attempt.
  assert.equal(classifyKey('BILLED-SHORT'), KEY_KIND.provider);
});

test('keys are masked before they reach the UI', () => {
  assert.equal(maskKey('BILLED-JNGJG-G87NQ-JTHNN'), `${'•'.repeat(18)}-JTHNN`);
  assert.equal(maskKey('short'), 'short');
  assert.equal(maskKey(''), '');
});

test('only the allowlisted origin may activate', () => {
  const allowed = ['https://prastutkuldip-glitch.github.io/*'];
  assert.equal(isTrustedOrigin('https://prastutkuldip-glitch.github.io', allowed), true);
  assert.equal(isTrustedOrigin('https://evil.example.com', allowed), false);
  assert.equal(isTrustedOrigin('http://prastutkuldip-glitch.github.io', allowed), false, 'http must not pass');
  assert.equal(isTrustedOrigin('', allowed), false);
  assert.equal(isTrustedOrigin(undefined, allowed), false);
});

test('an empty allowlist trusts nobody', () => {
  assert.equal(isTrustedOrigin('https://anything.com', []), false);
});
