import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomainPattern, normalizeDomainList, hostAllowed, mergeDomainLists, capDomainList, domainError } from '../src/core/web-allowlist.mjs';

test('normalizes hosts and *. patterns, rejects junk', () => {
  assert.equal(normalizeDomainPattern(' Docs.Python.org. '), 'docs.python.org');
  assert.equal(normalizeDomainPattern('*.MDN.io'), '*.mdn.io');
  assert.equal(normalizeDomainPattern('bücher.de'), 'xn--bcher-kva.de');
  for (const bad of ['', 'com', '*.com', '127.0.0.1', '[::1]', 'a..b', '-a.com', 'https://x.com', 'x.com/path', '*', '*.*.x.com', 42, null]) {
    assert.equal(normalizeDomainPattern(bad), null, String(bad));
  }
});

test('hostAllowed: exact host, wildcard = subdomains only', () => {
  const p = ['docs.example.com', '*.mozilla.org'];
  assert.equal(hostAllowed('docs.example.com', p), true);
  assert.equal(hostAllowed('DOCS.example.com.', p), true);
  assert.equal(hostAllowed('example.com', p), false);
  assert.equal(hostAllowed('evil-docs.example.com', p), false);
  assert.equal(hostAllowed('developer.mozilla.org', p), true);
  assert.equal(hostAllowed('a.b.mozilla.org', p), true);
  assert.equal(hostAllowed('mozilla.org', p), false);
  assert.equal(hostAllowed('mozilla.org.evil.com', p), false);
});

test('normalizeDomainList reports invalid entries and dedupes; merge unions', () => {
  assert.deepEqual(normalizeDomainList(['a.com', 'A.com', 'bad', '*.b.org']), { domains: ['a.com', '*.b.org'], invalid: ['bad'] });
  assert.deepEqual(mergeDomainLists(['a.com'], ['b.com', 'a.com']), ['a.com', 'b.com']);
  assert.deepEqual(mergeDomainLists(['a.com'], null), ['a.com']);
});

test('wildcards over a public or shared-hosting suffix are refused; exact hosts under them are fine', () => {
  for (const bad of ['*.co.uk', '*.com.au', '*.github.io', '*.vercel.app', '*.ngrok-free.app', '*.pages.dev', '*.s3.amazonaws.com']) {
    assert.equal(normalizeDomainPattern(bad), null, bad);
    assert.match(domainError(bad), /anyone can host/, bad);
  }
  assert.equal(normalizeDomainPattern('*.bbc.co.uk'), '*.bbc.co.uk');
  assert.equal(normalizeDomainPattern('docs.github.io'), 'docs.github.io');
  assert.equal(normalizeDomainPattern('*.example.io'), '*.example.io');
  assert.match(domainError('not a host'), /not a host name/);
  assert.equal(domainError('docs.example.com'), null);
});

test('capDomainList keeps only what the cap covers; no cap = unchanged', () => {
  const mine = ['docs.a.com', '*.b.org', '*.x.b.org', 'c.net', '*.a.com'];
  assert.deepEqual(capDomainList(mine, null), mine);
  assert.deepEqual(capDomainList(mine, ['*.a.com', '*.b.org']), ['docs.a.com', '*.b.org', '*.x.b.org', '*.a.com']);
  assert.deepEqual(capDomainList(mine, ['docs.a.com', 'b.org']), ['docs.a.com'], 'an exact cap never covers a wildcard');
  assert.deepEqual(capDomainList(mine, []), []);
});

test('"*" (the any-host switch) allows every host and is capped by a team list', () => {
  assert.equal(hostAllowed('anything.example', ['*']), true);
  assert.deepEqual(capDomainList(['*'], null), ['*']);
  assert.deepEqual(capDomainList(['*', 'a.com'], ['*.team.com', 'x.org']), ['*.team.com', 'x.org']);
  assert.equal(normalizeDomainPattern('*'), null, 'never typed into a list');
});
