// test/ask-web-search.test.mjs
// web_search against a user-configured GET JSON endpoint (docs/guardrails.md "Web access").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebSearcher, normalizeSearchResults } from '../src/core/ask/web-fetch.mjs';

const json = (o) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: (async function* () { yield Buffer.from(JSON.stringify(o)); })(), destroy() {} });

test('normalizes Brave, SearXNG, Google CSE, Kagi, Bing shapes', () => {
  const want = [{ title: 'T', url: 'https://a.com/', snippet: 'S' }];
  assert.deepEqual(normalizeSearchResults({ web: { results: [{ title: 'T', url: 'https://a.com/', description: 'S' }] } }, 5), want);
  assert.deepEqual(normalizeSearchResults({ results: [{ title: 'T', url: 'https://a.com/', content: 'S' }] }, 5), want);
  assert.deepEqual(normalizeSearchResults({ items: [{ title: 'T', link: 'https://a.com/', snippet: 'S' }] }, 5), want);
  assert.deepEqual(normalizeSearchResults({ data: [{ title: 'T', url: 'https://a.com/', snippet: 'S' }] }, 5), want);
  assert.deepEqual(normalizeSearchResults({ webPages: { value: [{ name: 'T', url: 'https://a.com/', snippet: 'S' }] } }, 5), want);
  assert.deepEqual(normalizeSearchResults({ results: [{ title: 'x', url: 'javascript:1' }] }, 5), []);
});

test('builds the request from the template, sends the key header, marks fetchable', async () => {
  let seen;
  const s = createWebSearcher({ search: { url: 'https://search.example/api?q={query}', keyHeader: 'X-Subscription-Token', keyPrefix: '' }, key: 'k1',
    allowedDomains: ['a.com'], transport: async (req) => (seen = req, json({ results: [{ title: 'T', url: 'https://a.com/', content: 'S' }, { title: 'U', url: 'https://b.com/', content: '' }] })) });
  const r = await s.search('node fetch', 5);
  assert.equal(seen.url.href, 'https://search.example/api?q=node%20fetch');
  assert.equal(seen.headers['x-subscription-token'], 'k1');
  assert.deepEqual(r.results.map((x) => x.fetchable), [true, false]);
});

test('query caps and data rule; missing key; endpoint SSRF rules', async () => {
  const base = { search: { url: 'https://search.example/?q={query}', keyHeader: '', keyPrefix: '' }, key: '', allowedDomains: [], transport: async () => json({ results: [] }) };
  await assert.rejects(createWebSearcher(base).search('x'.repeat(201)), /longer than 200/);
  await assert.rejects(createWebSearcher(base).search(`find ${'QUJD'.repeat(16)}`), /encoded data/);
  await assert.rejects(createWebSearcher({ ...base, search: { ...base.search, keyHeader: 'X-K' } }).search('q'), /key is not set/);
  await assert.rejects(createWebSearcher({ ...base, search: { ...base.search, url: 'https://10.0.0.1/?q={query}' } }).search('q'), /IP-address/);
  await assert.rejects(createWebSearcher({ ...base, transport: async () => ({ status: 302, headers: { location: 'https://x/' }, body: (async function* () {})(), destroy() {} }) }).search('q'), /redirected/);
});
