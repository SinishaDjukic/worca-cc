// test/ui-ask-widgets-display.test.mjs — the inline display widgets (ask-forms
// §6.1). They add nothing to the answer, and every agent string reaches the DOM
// through textContent — markdown ONLY through the injected host pipeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderAskForm } from '../ui/public/ask/form-renderer.mjs';

const win = new JSDOM('<!doctype html><body></body>').window;
const doc = win.document;

const askOf = (layout, data = {}, files = []) => ({
  id: 'q:1', askId: 'q_1', kind: 'form', form: 'f', version: 1, title: 'T', surface: 'any',
  data, files, fileRefs: [], layout, answerSchema: { type: 'object', required: [], properties: {} },
});
const mount = (ask, opts = {}) => renderAskForm(ask, { doc, ...opts });

test('markdown renders plain until the host bundle is ready, then through it', () => {
  const ask = askOf([{ widget: 'markdown', bind: 'data.summary' }], { summary: '# Two <b>directions</b>' });
  const plain = mount(ask);
  const box = plain.el.querySelector('.af-md');
  assert.equal(box.textContent, '# Two <b>directions</b>');
  assert.equal(box.querySelector('b'), null, 'no markup before the pipeline exists');

  const calls = [];
  const rich = mount(ask, {
    markdown: (t) => {
      calls.push(t);
      const frag = doc.createDocumentFragment();
      frag.appendChild(Object.assign(doc.createElement('h1'), { textContent: 'Two directions' }));
      return { kind: 'md', frag };
    },
    highlight: async () => {},
  });
  rich.paintMarkdown();
  assert.deepEqual(calls, ['# Two <b>directions</b>']);
  assert.equal(rich.el.querySelector('.af-md h1').textContent, 'Two directions');
  assert.ok(rich.el.querySelector('.af-md').classList.contains('artifact-markdown'));
});

test('callout: tone class, agent title and body as text', () => {
  const f = mount(askOf([{ widget: 'callout', tone: 'warn', title: 'Heads up', text: 'The <script> is fine.' }]));
  const c = f.el.querySelector('.af-callout');
  assert.ok(c.classList.contains('af-warn'));
  assert.equal(c.querySelector('b').textContent, 'Heads up');
  assert.match(c.textContent, /The <script> is fine\./);
  assert.equal(c.querySelector('script'), null, 'never parsed as markup');
  const bound = mount(askOf([{ widget: 'callout', bind: 'data.msg' }], { msg: 'from data' }));
  assert.match(bound.el.querySelector('.af-callout').textContent, /from data/);
  assert.ok(bound.el.querySelector('.af-callout').classList.contains('af-info'), 'info is the default tone');
});

test('table: headers, alignment, delta and pill formats, an em dash for a hole', () => {
  const f = mount(askOf([{ widget: 'table', label: 'Budget', bind: 'data.rows', columns: [
    { key: 'name', label: 'Name' },
    { key: 'delta', label: 'Δ', align: 'right', format: 'delta', unit: '%' },
    { key: 'state', label: 'State', format: 'pill', tones: { ok: 'ok', bad: 'crimson' } },
    { key: 'gap', label: 'Gap' },
  ] }], { rows: [
    { name: 'alpha', delta: 4, state: 'ok' },
    { name: 'beta', delta: -2, state: 'bad', gap: 0 },
  ] }));
  assert.equal(f.el.querySelector('.af-label').textContent, 'Budget');
  assert.deepEqual([...f.el.querySelectorAll('th')].map((t) => t.textContent), ['Name', 'Δ', 'State', 'Gap']);
  const r0 = f.el.querySelectorAll('tbody tr')[0];
  assert.equal(r0.children[1].textContent, '+4%');
  assert.ok(r0.children[1].classList.contains('af-up'));
  assert.ok(r0.children[1].classList.contains('af-r'));
  assert.equal(r0.children[2].querySelector('.af-pill').dataset.tone, 'ok');
  assert.equal(f.el.querySelectorAll('tbody tr')[1].children[2].querySelector('.af-pill').dataset.tone, undefined,
    'a family outside the closed vocabulary (dom.mjs TONES) sets no tone');
  assert.equal(r0.children[3].textContent, '—', 'a missing cell is an em dash');
  assert.equal(f.el.querySelectorAll('tbody tr')[1].children[1].textContent, '-2%');
});

test('json: a collapsible tree, every scalar through textContent', () => {
  const f = mount(askOf([{ widget: 'json', label: 'Payload', bind: 'data.blob' }],
    { blob: { name: '<b>x</b>', n: 3, ok: true, list: [1, 2] } }));
  const tree = f.el.querySelector('.af-json');
  assert.ok(tree.querySelector('details'), 'objects are <details>');
  assert.match(tree.textContent, /"<b>x<\/b>"/);
  assert.equal(tree.querySelector('b'), null);
  assert.match(tree.textContent, /list/);
  assert.match(tree.textContent, /\[2\]/, 'an array summary names its length');
});

test('code: a named bar, a language class hljs can pick up, numbered lines', () => {
  const f = mount(askOf([{ widget: 'code', name: 'server.mjs', lang: 'javascript', bind: 'data.src' }],
    { src: 'const a = 1;\nconst b = 2;' }));
  assert.equal(f.el.querySelector('.af-code-bar').textContent, 'server.mjsjavascript');
  const code = f.el.querySelector('pre > code');
  assert.equal(code.className, 'language-javascript');
  assert.equal(code.textContent, 'const a = 1;\nconst b = 2;', 'byte-exact');
});

test('diff: +/- counted in the bar and classed per line, hunks marked', () => {
  const f = mount(askOf([{ widget: 'diff', name: 'patch', bind: 'data.d' }],
    { d: '@@ -1,2 +1,3 @@\n-old\n+new\n context' }));
  assert.equal(f.el.querySelector('.af-add').textContent, '+1');
  assert.equal(f.el.querySelector('.af-del').textContent, '−1');
  const lines = [...f.el.querySelectorAll('.af-ln')];
  assert.deepEqual(lines.map((l) => l.className),
    ['af-ln af-hunk', 'af-ln af-del', 'af-ln af-add', 'af-ln']);
  assert.equal(lines[2].textContent, '+new');
});

test('file-list: badge, name, note and size from the manifest', () => {
  const f = mount(askOf(
    [{ widget: 'file-list', label: 'Attached', bind: 'data.files', fileKey: 'file', noteKey: 'note' }],
    { files: [{ id: 'a', file: 'docs/spec.md', note: 'draft' }, { id: 'b', file: 'out/report.pdf' }] },
    [{ index: 0, rel: 'docs/spec.md', name: 'spec.md', mime: 'text/markdown', bytes: 4096, sha256: 'x' },
      { index: 1, rel: 'out/report.pdf', name: 'report.pdf', mime: 'application/pdf', bytes: 1048576, sha256: 'y' }],
  ));
  const rows = [...f.el.querySelectorAll('.af-files li')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.af-file-badge').textContent, 'MD');
  assert.equal(rows[0].querySelector('.af-file-name').textContent, 'docs/spec.md');
  assert.match(rows[0].textContent, /draft/);
  assert.match(rows[0].textContent, /4 KB/);
  assert.match(rows[1].textContent, /1\.0 MB/);
});

test('display widgets add nothing to the answer', () => {
  const f = mount(askOf([
    { widget: 'markdown', bind: 'data.summary' },
    { widget: 'table', bind: 'data.rows', columns: [{ key: 'name', label: 'N' }] },
  ], { summary: 'hi', rows: [{ name: 'a' }] }));
  assert.deepEqual(f.collect(), { values: {}, errors: [] });
  assert.deepEqual(f.progress(), { done: 0, total: 0 });
});
