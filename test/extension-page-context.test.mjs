// test/extension-page-context.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageContextMarkdown, pageAttachments, quoteMarkdown, utf8Base64, SELECTION_MAX, PAGE_TEXT_MAX } from '../extension/src/page-context.mjs';

const dec = (b64) => Buffer.from(b64, 'base64').toString('utf8');
test('URL + title + selection always; page text only when toggled on', () => {
  const ctx = { url: 'http://fixture.test/page.html', title: 'Rate limits — ACME docs', selection: 'token bucket', text: '# Rate limits\n\nBody' };
  const off = pageAttachments(ctx, { withText: false });
  assert.deepEqual(off.map((a) => a.name), ['page-context.md']);
  const md = dec(off[0].dataBase64);
  assert.match(md, /url: http:\/\/fixture\.test\/page\.html/);
  assert.match(md, /token bucket/);
  assert.deepEqual(pageAttachments(ctx, { withText: true }).map((a) => a.name), ['page-context.md', 'page-text.md']);
});
test('a quote becomes page-quote.md even when the page could not be read', () => {
  const atts = pageAttachments(null, { withText: true, quote: { text: 'holds at most 100 tokens', src: 'fixture.test' } });
  assert.deepEqual(atts.map((a) => a.name), ['page-quote.md']);
  assert.match(dec(atts[0].dataBase64), /from: fixture\.test[\s\S]*holds at most 100 tokens/);
  assert.match(quoteMarkdown({ text: 'x' }), /^# Text the user quoted from a web page/);
});
test('caps, NUL stripping, unicode round trip, nothing readable → no attachment', () => {
  const big = pageContextMarkdown({ url: 'http://x.test/', title: 'é', selection: 'x'.repeat(SELECTION_MAX + 10) });
  assert.ok(big.length < SELECTION_MAX + 400);
  assert.ok(!dec(utf8Base64('a\u0000b')).includes('\u0000'));
  assert.equal(dec(utf8Base64('Grüße — 東京')), 'Grüße — 東京');
  assert.deepEqual(pageAttachments({ url: null, title: null, selection: '' }, { withText: true }), []);
  assert.ok(PAGE_TEXT_MAX >= 100_000);
});
