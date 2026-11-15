// test/design-system-prose.test.mjs — Prose (ui/public/design-system/components/prose.mjs, panel.rendered-prose): Worca's
// finished words drawn by dev's markdown renderer and sanitiser (ui/public/ask-markdown.mjs), with the real marked and
// dompurify packages under jsdom, a fresh window per case (the renderer is kept per document).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import { prose, loadProse } from '../ui/public/design-system/components/index.mjs';

const CSS = readFileSync(new URL('../ui/public/stillhet/css/rail.css', import.meta.url), 'utf8');
const fresh = () => new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' }).window.document;
const realLoad = () => Promise.resolve({ marked, createDOMPurify });
async function ready(load = realLoad) {
  const doc = fresh();
  assert.equal(await loadProse({ doc, load }), true);
  return doc;
}
// the returned HTML as an element of `doc`
const el = (doc, html) => { const t = doc.createElement('template'); t.innerHTML = html; return t.content.firstElementChild; };
// a run ref part as chat-turns.mjs partsOf gives it, for every 8-hex id in the text
const RUN_RE = /\b[0-9a-f]{8}\b/g;
function refs(text) {
  const parts = []; let at = 0;
  for (const m of String(text).matchAll(RUN_RE)) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index) });
    parts.push({ text: m[0], ref: { kind: 'run', key: `run:${m[0]}`, id: m[0], url: '', label: '' } });
    at = m.index + m[0].length;
  }
  if (!parts.length) return null;
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}
const chip = (p) => `<button class="ref-chip" data-ref-run="${p.ref.id}">Run ${p.ref.id}</button>`;

test('Prose: **bold** is a strong inside div.prose', async () => {
  const doc = await ready();
  const out = el(doc, prose({ text: 'It is **done**.', doc }));
  assert.ok(out.matches('div.prose:not(.is-plain)'));
  assert.equal(out.querySelector('strong').textContent, 'done');
});

test('Prose: a - list is a ul with 2 li, a 1. list an ol', async () => {
  const doc = await ready();
  const out = el(doc, prose({ text: '- one\n- two', doc }));
  assert.equal(out.querySelectorAll('ul > li').length, 2);
  assert.ok(el(doc, prose({ text: '1. one\n2. two', doc })).querySelector('ol > li'));
});

test('Prose: a fenced block is a focusable pre > code, never highlighted (no span, no hljs class)', async () => {
  const doc = await ready();
  const out = el(doc, prose({ text: '```js\nconst a = 1;\n```', doc }));
  const pre = out.querySelector('pre[tabindex="0"][aria-label="Code"]');
  assert.ok(pre);
  assert.equal(pre.querySelector('code').textContent, 'const a = 1;\n');
  assert.equal(out.querySelectorAll('span').length, 0);
  assert.doesNotMatch(out.outerHTML, /hljs/);
});

test('Prose: a link opens in a new tab, without the opener', async () => {
  const doc = await ready();
  const a = el(doc, prose({ text: '[a](https://example.com)', doc })).querySelector('a');
  assert.equal(a.getAttribute('href'), 'https://example.com');
  assert.equal(a.getAttribute('target'), '_blank');
  assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
});

test('Prose: javascript: links, script, img onerror, iframe and planted data-*/aria-* hooks leave nothing that runs; an emptied line leaves no empty paragraph', async () => {
  const doc = await ready();
  const out = el(doc, prose({ text: '[x](javascript:alert(1)) <script>alert(1)</script> <img src=x onerror="alert(1)"> <iframe src="https://e.com"></iframe>\n\n[d](data:text/html,hi)\n\n<a href="https://x" data-live=\'delete|{}\' aria-label="y">go</a> <span data-ref-url="https://evil" id="i" style="color:red">s</span>', doc }));
  assert.equal(out.querySelectorAll('script, img, iframe').length, 0);
  assert.ok(![...out.querySelectorAll('*')].some((n) => [...n.attributes].some((a) => /^on/i.test(a.name))), 'no on* attribute');
  assert.ok(![...out.querySelectorAll('[href]')].some((n) => /^\s*(?:javascript|data):/i.test(n.getAttribute('href'))), 'no javascript: or data: href');
  assert.equal(out.querySelectorAll('a:not([href])').length, 0, 'a link stripped of its href is its words, never a dead link');
  assert.match(out.textContent, /\bx\b/, 'its words stay');
  const ALLOWED = new Set(['href', 'class', 'type', 'checked', 'disabled', 'align', 'target', 'rel']);
  const extra = [...out.querySelectorAll('*')].flatMap((n) => [...n.attributes].map((a) => a.name)).filter((name) => !ALLOWED.has(name));
  assert.deepEqual(extra, [], 'only the allowed attributes: no data-*, aria-*, id or style from the reply');
  assert.equal(out.querySelector('a[href="https://x"]').textContent, 'go', 'the link itself stays');
  const empty = el(doc, prose({ text: 'One.\n\n![logo](https://example.com/logo.png)\n\nTwo.', doc }));
  assert.deepEqual([...empty.querySelectorAll('p')].map((p) => p.textContent), ['One.', 'Two.'], 'a dropped image leaves no empty paragraph');
});

test('Prose: a # heading is an h1, calm by rail.css (body size, 600); a scroll box has a 2px ink ring on focus', async () => {
  const doc = await ready();
  assert.ok(el(doc, prose({ text: '# Title', doc })).querySelector('h1'));
  const rule = (sel) => { const at = CSS.indexOf(`${sel}{`); assert.ok(at >= 0, `${sel} is in rail.css`); return CSS.slice(at, CSS.indexOf('}', at)); };
  const h = rule('.prose :is(h1,h2,h3,h4,h5,h6)');
  assert.match(h, /font-size:inherit/); assert.match(h, /font-weight:600/);
  assert.match(rule('.prose :is(pre,.rt-wrap):focus-visible'), /outline:2px solid var\(--ink\)/);
  for (const box of ['.prose pre', '.prose .rt-wrap']) assert.match(rule(box), /overflow-wrap:normal/, `${box} overflows and scrolls, never breaks words mid-character (.convo-col sets anywhere)`);
});

test('Prose: a pipe table is the Rail Table in a focusable scroll box', async () => {
  const doc = await ready();
  const out = el(doc, prose({ text: '| a | b |\n|---|---|\n| 1 | 2 |', doc }));
  const wrap = out.querySelector('div.rt-wrap[tabindex="0"][aria-label="Table"]');
  assert.ok(wrap);
  assert.ok(wrap.querySelector(':scope > table.rt'));
  assert.equal(out.querySelectorAll('.rt-c').length, 4);
  assert.equal(out.querySelectorAll('th:not(.rt-c), td:not(.rt-c)').length, 0);
});

test('Prose: a ref in a list item is the chip() HTML inside that li; refs gets the text node\'s data', async () => {
  const doc = await ready();
  const seen = [];
  const out = el(doc, prose({ text: '- see 0a1b2c3d now\n- nothing', doc, refs: (s) => { seen.push(s); return refs(s); }, chip }));
  const li = out.querySelectorAll('li')[0];
  assert.equal(li.querySelector('[data-ref-run]').getAttribute('data-ref-run'), '0a1b2c3d');
  assert.equal(li.textContent, 'see Run 0a1b2c3d now');
  assert.ok(seen.includes('see 0a1b2c3d now'));
});

test('Prose: a ref inside inline code or a fenced block stays text, chip() never sees it', async () => {
  const doc = await ready();
  const calls = [];
  const out = el(doc, prose({ text: 'Look at `0a1b2c3d`.\n\n```\n0a1b2c3d\n```', doc, refs, chip: (p) => { calls.push(p); return chip(p); } }));
  assert.equal(calls.length, 0);
  assert.equal(out.querySelectorAll('[data-ref-run]').length, 0);
  assert.equal(out.querySelector('p code').textContent, '0a1b2c3d');
  assert.equal(out.querySelector('pre code').textContent, '0a1b2c3d\n');
});

test('Prose: a link whose href is one ref becomes the chip; when chip() says null the link stays (never chipped twice)', async () => {
  const doc = await ready();
  const PR = 'https://github.com/acme/web/pull/9';
  const urlRefs = (s) => (s === PR ? [{ text: s, ref: { kind: 'gh', key: 'gh:acme/web#9', id: '', url: s, label: 'acme/web#9' } }] : null);
  const got = [];
  const out = el(doc, prose({ text: `[the PR](${PR})`, doc, refs: urlRefs, chip: (p) => { got.push(p); return `<button data-ref-url="${p.ref.url}">PR</button>`; } }));
  assert.ok(out.querySelector('[data-ref-url]'));
  assert.equal(out.querySelectorAll('a').length, 0);
  assert.equal(got.length, 1, 'once: the anchor, not again its text');
  assert.equal(got[0].text, 'the PR');
  const kept = el(doc, prose({ text: `[the PR](${PR})`, doc, refs: urlRefs, chip: () => null }));
  assert.equal(kept.querySelector('a').getAttribute('href'), PR);
});

test('Prose: before loadProse it is the plain form (escaped, <br>, chips) and nothing is loaded', () => {
  const doc = fresh();
  let n = 0;
  doc.defaultView.__worcaTestHooks = { askMarkdown: () => { n++; return realLoad(); } };
  const html = prose({ text: '**a** <b>\nsee 0a1b2c3d', doc, refs, chip });
  const out = el(doc, html);
  assert.ok(out.matches('div.prose.is-plain'));
  assert.match(html, /\*\*a\*\* &lt;b&gt;<br>see <button class="ref-chip" data-ref-run="0a1b2c3d">/);
  assert.equal(n, 0, 'prose() loads nothing');
  assert.match(prose({ text: 'x', doc: null }), /^<div class="prose is-plain">x<\/div>$/);
});

test('Prose: past 200,000 characters it stays plain after loading; a blank text is nothing', async () => {
  const doc = await ready();
  assert.match(prose({ text: `**${'a'.repeat(200001)}**`, doc }), /^<div class="prose is-plain">\*\*/);
  assert.equal(prose({ text: '  \n ', doc }), '');
  assert.equal(prose({ text: null, doc }), '');
});

test('loadProse: a failing load resolves false, retries twice more, then latches; another document is its own', async () => {
  const doc = fresh();
  let n = 0;
  const bad = () => { n++; return Promise.reject(new Error('no')); };
  assert.equal(await loadProse({ doc, load: bad }), false);
  assert.equal(await loadProse({ doc, load: bad }), false);
  assert.equal(await loadProse({ doc, load: bad }), false);
  assert.equal(n, 3);
  assert.equal(await loadProse({ doc, load: bad }), false);
  assert.equal(n, 3, 'latched: load is not called again');
  const other = await ready();
  assert.match(prose({ text: '**x**', doc: other }), /^<div class="prose"><p><strong>x/);
  assert.match(prose({ text: '**x**', doc }), /^<div class="prose is-plain">/);
});

test('Prose: a throwing chip gives the plain form, never a throw; a cached text still shows the new chip HTML', async () => {
  let parses = 0;
  const doc = await ready(() => Promise.resolve({ marked: { parse: (...a) => { parses++; return marked.parse(...a); } }, createDOMPurify }));
  const html = prose({ text: 'see 0a1b2c3d', doc, refs, chip: () => { throw new Error('boom'); } });
  assert.match(html, /^<div class="prose is-plain">see 0a1b2c3d<\/div>$/);
  const before = parses;
  assert.match(prose({ text: 'run 0a1b2c3d', doc, refs, chip: () => '<i data-v="1"></i>' }), /data-v="1"/);
  assert.match(prose({ text: 'run 0a1b2c3d', doc, refs, chip: () => '<i data-v="2"></i>' }), /data-v="2"/);
  assert.equal(parses - before, 1, 'marked.parse ran once for the same text');
});
