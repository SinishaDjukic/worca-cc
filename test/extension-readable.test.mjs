// test/extension-readable.test.mjs — the reader view behind page-text.md (jsdom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractReadable } from '../extension/src/readable.mjs';

const doc = (body) => new JSDOM(`<!doctype html><body>${body}</body>`).window.document;
test('prefers <main>, drops nav/scripts/hidden, keeps headings and lists', () => {
  const { text } = extractReadable(doc('<nav>Menu</nav><main><h1>Rate limits</h1><p>Each   token bucket\nrefills.</p><ul><li>one</li><li>two</li></ul><script>evil()</script><div hidden>secret</div></main><footer>©</footer>'));
  assert.equal(text, '# Rate limits\n\nEach token bucket refills.\n\n- one\n- two');
});
test('a list of three or more items has no blank lines inside (v6)', () => {
  assert.equal(extractReadable(doc('<main><ul><li>a</li><li>b</li><li>c</li></ul></main>')).text, '- a\n- b\n- c');
});
test('main wins over an earlier article; <pre> keeps its line breaks in a fence (v8)', () => {
  const { text } = extractReadable(doc('<article>teaser</article><main><p>body</p><pre><code>const a = 1;\n  if (a) {\n    go();\n  }\n</code></pre></main>'));
  assert.equal(text, 'body\n\n```\nconst a = 1;\n  if (a) {\n    go();\n  }\n```');
});
test('caps and flags truncation', () => {
  const r = extractReadable(doc(`<p>${'word '.repeat(1000)}</p>`), { max: 100 });
  assert.ok(r.truncated);
  assert.ok(r.text.length <= 100 + 20);
});
