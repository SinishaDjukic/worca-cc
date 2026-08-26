// test/ask-markdown.test.mjs — the sandboxed markdown pipeline (spec §10.7)
// against the REAL pinned marked@18.0.10 + dompurify@3.4.14 under jsdom.
// npm ci is a prerequisite — without it both imports fail for reasons
// unrelated to this module.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { createMarkdownRenderer } from '../ui/public/ask-markdown.mjs';

let dom;
before(() => { dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/' }); });

const realLoad = async () => ({
  marked: (await import('marked')).marked,
  createDOMPurify: (await import('dompurify')).default,
});

async function makeReady({ hljsLoader = { forLanguage: async () => null }, load = realLoad } = {}) {
  const r = createMarkdownRenderer({ doc: dom.window.document, load, hljsLoader });
  assert.equal(await r.ensure(), true);
  return r;
}

function htmlOf(result) {
  assert.equal(result.kind, 'md');
  const div = dom.window.document.createElement('div');
  div.appendChild(result.frag);
  return div;
}

test('ask-markdown: renders basic gfm (heading, list, table, code fence, breaks)', async () => {
  const r = await makeReady();
  const out = htmlOf(r.render('# Hi\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n```js\nconst a = 1;\n```\nline1\nline2'));
  assert.ok(out.querySelector('h1'));
  assert.equal(out.querySelectorAll('li').length, 2);
  assert.ok(out.querySelector('table thead th'));
  const code = out.querySelector('pre > code');
  assert.ok(code);
  assert.ok([...code.classList].some((c) => c === 'language-js'));
  assert.ok(out.querySelectorAll('br').length >= 1, 'breaks:true turns the newline into <br>');
});

test('ask-markdown: the §12 hostile matrix is neutralised', async () => {
  const r = await makeReady();
  const hostile = [
    '<script>window.__pwned = 1</script>',
    '<img src=x onerror="window.__pwned=2">',
    '[x](javascript:alert(1))',
    '[y](data:text/html,<script>1</script>)',
    '<iframe src="https://evil"></iframe>',
    '<form action="/api/run"><input name="ok"></form>',
    '<a id="confirm-ok" name="runs">clobber</a>',
    '<style>body{display:none}</style>',
    '<b onclick="1">b</b>',
    '<svg onload="window.__pwned=3"><circle r="1"/></svg>',
  ].join('\n\n');
  const out = htmlOf(r.render(hostile));
  assert.equal(out.querySelector('script,iframe,form,style,svg,img'), null);
  assert.equal(out.querySelector('[onerror],[onclick],[onload],[id],[name],[action],[src]'), null);
  for (const a of out.querySelectorAll('a[href]')) {
    assert.match(a.getAttribute('href'), /^(?:https?:|mailto:|#)/i);
  }
  assert.equal(dom.window.__pwned, undefined);
});

test('ask-markdown: https/mailto links get _blank + noopener noreferrer; #hash links stay in-app', async () => {
  const r = await makeReady();
  const out = htmlOf(r.render('[ext](https://example.com) [mail](mailto:a@b.c) [in](#history/p/1)'));
  const [ext, mail, hash] = [...out.querySelectorAll('a')];
  assert.equal(ext.getAttribute('target'), '_blank');
  assert.equal(ext.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(mail.getAttribute('target'), '_blank');
  assert.equal(hash.getAttribute('href'), '#history/p/1');
  assert.equal(hash.getAttribute('target'), null, 'in-app hash links do not open a new tab');
});

test('ask-markdown: foreign classes are stripped, language-*/hljs-* survive on the right tags', async () => {
  const r = await makeReady();
  const out = htmlOf(r.render('```python\nx = 1\n```\n\n<p class="steal-layout">p</p>'));
  const code = out.querySelector('code');
  assert.deepEqual([...code.classList], ['language-python']);
  assert.ok(!out.innerHTML.includes('steal-layout'));
});

test('ask-markdown: task-list checkboxes are inert; non-checkbox inputs are removed', async () => {
  const r = await makeReady();
  const out = htmlOf(r.render('- [x] done item\n- [ ] open item\n\n<input type="text" value="steal">'));
  const boxes = [...out.querySelectorAll('input')];
  assert.ok(boxes.length >= 2);
  for (const b of boxes) {
    assert.equal(b.getAttribute('type'), 'checkbox');
    assert.ok(b.hasAttribute('disabled'));
  }
});

test('ask-markdown: over 200 000 chars renders plain', async () => {
  const r = await makeReady();
  assert.deepEqual(r.render('a'.repeat(200_001)), { kind: 'plain' });
  assert.equal(r.render('a'.repeat(1000)).kind, 'md');
});

test('ask-markdown: not ready → plain; ready flips to md', async () => {
  const r = createMarkdownRenderer({ doc: dom.window.document, load: realLoad, hljsLoader: { forLanguage: async () => null } });
  assert.deepEqual(r.render('**bold**'), { kind: 'plain' });
  assert.equal(r.isReady(), false);
  await r.ensure();
  assert.equal(r.isReady(), true);
  assert.equal(r.render('**bold**').kind, 'md');
});

test('ask-markdown: a failing load latches to plain after 3 attempts, never retries endlessly', async () => {
  let calls = 0;
  const r = createMarkdownRenderer({ doc: dom.window.document, load: async () => { calls += 1; throw new Error('offline'); }, hljsLoader: null });
  assert.equal(await r.ensure(), false);
  assert.equal(await r.ensure(), false);
  assert.equal(await r.ensure(), false);
  assert.equal(r.isFailed(), true);
  assert.equal(await r.ensure(), false);
  assert.equal(calls, 3, 'exactly three attempts, then the permanent latch');
  assert.deepEqual(r.render('# x'), { kind: 'plain' });
});

test('ask-markdown: highlight() applies span-only hljs markup on ask-done', async () => {
  const hljsLoader = {
    forLanguage: async (lang) => (lang === 'javascript'
      ? { lang, highlight: (text) => text.replace('const', '<span class="hljs-keyword">const</span>') }
      : null),
  };
  const r = await makeReady({ hljsLoader });
  const host = dom.window.document.createElement('div');
  host.appendChild(r.render('```js\nconst a = 1;\n```').frag);
  await r.highlight(host);
  assert.ok(host.querySelector('code .hljs-keyword'));
  assert.equal(host.querySelector('code').textContent, 'const a = 1;\n');
});

test('ask-markdown: hostile hljs output is rejected — code stays plain', async () => {
  const hljsLoader = {
    forLanguage: async (lang) => ({ lang, highlight: () => '<img src=x onerror=1><span class="hljs-keyword">const</span> a = 1;\n' }),
  };
  const r = await makeReady({ hljsLoader });
  const host = dom.window.document.createElement('div');
  host.appendChild(r.render('```js\nconst a = 1;\n```').frag);
  await r.highlight(host);
  assert.equal(host.querySelector('img'), null);
  assert.equal(host.querySelector('.hljs-keyword'), null, 'the whole block is rejected, not partially applied');
  assert.equal(host.querySelector('code').textContent, 'const a = 1;\n');
});

test('ask-markdown: unknown fence languages and alias mapping', async () => {
  const seen = [];
  const hljsLoader = { forLanguage: async (lang) => { seen.push(lang); return null; } };
  const r = await makeReady({ hljsLoader });
  const host = dom.window.document.createElement('div');
  host.appendChild(r.render('```ts\nlet x\n```\n\n```made-up-lang\nzzz\n```').frag);
  await r.highlight(host);
  assert.deepEqual(seen, ['typescript'], 'ts aliases to typescript; unknown languages never reach the loader');
});

test('ask-markdown: render() never throws on garbage', async () => {
  const r = await makeReady();
  for (const bad of [null, undefined, 42, '\u0000', '<'.repeat(500)]) {
    const out = r.render(bad);
    assert.ok(out.kind === 'md' || out.kind === 'plain');
  }
});

test('ask-markdown: hljs output that changes the text is rejected', async () => {
  const hljsLoader = { forLanguage: async (lang) => ({ lang, highlight: () => '<span class="hljs-keyword">const</span> a = 2;\n' }) };
  const r = await makeReady({ hljsLoader });
  const host = dom.window.document.createElement('div');
  host.appendChild(r.render('```js\nconst a = 1;\n```').frag);
  await r.highlight(host);
  assert.equal(host.querySelector('.hljs-keyword'), null, 'text must round-trip byte-for-byte');
  assert.equal(host.querySelector('code').textContent, 'const a = 1;\n');
});
