// test/ask-html-text.test.mjs
// Untrusted HTML → readable text for web_fetch (docs/guardrails.md "Web access").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText } from '../src/core/ask/html-text.mjs';

test('hostile nesting/flooding is bounded by the time budget', async () => {
  for (const html of ['<li>x'.repeat(300000), '<div>'.repeat(200000) + '</div>'.repeat(200000)]) {
    const t0 = performance.now();
    const r = await htmlToText(html, null, { budgetMs: 300 });
    assert.ok(performance.now() - t0 < 3000, 'must not stall');
    assert.equal(typeof r.text, 'string');
  }
});

test('svg <title> never leaks into the page title; truncated is reliable', async () => {
  assert.equal((await htmlToText('<title>T</title><body><svg><title>icon</title></svg><p>x</p></body>')).title, 'T');
  assert.equal((await htmlToText(`<pre>a${' '.repeat(200)}\n</pre>`, null, { maxChars: 100 })).truncated, true);
});

test('drops script/style/nav/footer, keeps headings, lists, links', async () => {
  const html = `<html><head><title>T &amp; Co</title><style>x{}</style></head><body>
    <nav><a href="/home">Home</a></nav><h1>Hello</h1><p>One &lt;two&gt; <a href="/x">link</a></p>
    <ul><li>a</li><li>b<ol><li>c</li></ol></li></ul><script>alert(1)</script><footer>foot</footer></body></html>`;
  const r = await htmlToText(html, 'https://docs.example.com/p');
  assert.equal(r.title, 'T & Co');
  assert.match(r.text, /^# Hello$/m);
  assert.match(r.text, /One <two> link \(https:\/\/docs\.example\.com\/x\)/);
  assert.match(r.text, /^- a$/m); assert.match(r.text, /^\s+1\. c$/m);
  for (const gone of ['alert', 'Home', 'foot', 'x{}']) assert.ok(!r.text.includes(gone), gone);
});

test('narrows to <main> when present, falls back when main is empty', async () => {
  assert.equal((await htmlToText('<div>chrome</div><main><p>body</p></main>')).text, 'body');
  assert.equal((await htmlToText('<div>chrome</div><main></main>')).text, 'chrome');
});

test('javascript:/data: links carry no URL; unclosed tags in nav do not leak', async () => {
  assert.equal((await htmlToText('<p><a href="javascript:alert(1)">x</a></p>')).text, 'x');
  assert.equal((await htmlToText('<nav><a href="/a">n<span>m</nav><p>after</p>')).text, 'after');
});

test('pre keeps whitespace; caps output', async () => {
  assert.match((await htmlToText('<pre>a\n  b</pre>')).text, /```\na\n  b\n```/);
  const r = await htmlToText(`<p>${'x'.repeat(500)}</p>`, null, { maxChars: 100 });
  assert.equal(r.text.length, 100); assert.equal(r.truncated, true);
});

test('yields to the event loop during a large conversion, with the same output', async () => {
  const html = `<main>${'<p>para <a href="/x">link</a></p>'.repeat(20000)}</main>`;
  let immediates = 0; let done = false;
  const spin = () => { immediates += 1; if (!done) setImmediate(spin); };
  setImmediate(spin);
  const r = await htmlToText(html, 'https://docs.example.com/p', { maxChars: 10_000_000 });
  done = true;
  assert.ok(immediates > 10, `other work ran ${immediates} times during the conversion`);
  assert.equal(r.truncated, false);
  assert.equal(r.text, Array(20000).fill('para link (https://docs.example.com/x)').join('\n\n'));
});
