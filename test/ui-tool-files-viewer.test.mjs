// test/ui-tool-files-viewer.test.mjs — the Files tab's file view is the shared viewer (artifacts/stage.mjs): one row
// per kind, the raw route's URL shape, markdown Preview / Source remembered per tab, and the Office fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readStyleCss } from '../src/core/read-style-css.mjs';
import { createFilesKind, toolFileUrls } from '../ui/public/tool-files.mjs';

const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const P = { type: 'project', id: 'app-0000aaaa' };
const SEG = encodeURIComponent('scope=project&projectKey=app-0000aaaa');
const MD = { marked: (await import('marked')).marked, createDOMPurify: (await import('dompurify')).default };
const realLoad = async () => MD;
await import('../ui/public/c4/c4-view.mjs');   // cached, so ensureC4Viewer settles in microtasks
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hljsLoader = { forLanguage: async (lang) => ({ highlight: (t) => t.split('\n').map((l) => (l ? `<span class="hljs-keyword">${esc(l)}</span>` : '')).join('\n'), lang }) };

/** file: the /api/tools/file answer; heads: url → HEAD status (default 200). */
function harness({ file, heads = {} }) {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { url: 'http://localhost:4317/' });
  const doc = dom.window.document;
  const calls = [];
  const fetch = async (u, o = {}) => {
    const method = o.method || 'GET';
    calls.push([method, u]);
    if (method === 'HEAD') {
      const status = heads[u] ?? 200;
      return { ok: status < 400, status, headers: { get: (k) => (k === 'content-length' ? '10' : null) } };
    }
    if (u.startsWith('/api/tools/file?')) return { ok: true, status: 200, json: async () => ({ root: { scope: 'project', label: 'app' }, ...file }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const tabs = new Map();
  const api = {
    tab: (id) => tabs.get(id), isMounted: (id) => tabs.has(id), scopeFor: (t) => t.scope,
    setTabState: (id, p) => { const t = tabs.get(id); for (const [k, v] of Object.entries(p)) { if (v === undefined) delete t.state[k]; else t.state[k] = v; } },
    openTab: () => null, close: (id) => tabs.delete(id), view: () => ({}),
  };
  return { win: dom.window, doc, host: doc.getElementById('host'), fetch, calls, tabs, api };
}
async function openFile(h, path, extraState = {}) {
  const kind = createFilesKind({ doc: h.doc, fetch: h.fetch, previewDeps: () => ({ loadMarkdown: realLoad, hljsLoader }) });
  const tab = { id: 'tab_v', kind: 'files', scope: P, state: { file: path, ...extraState } };
  h.tabs.set(tab.id, tab);
  await kind.mount(tab, h.host, h.api);
  await settle(h);
  return { kind, tab, stage: h.host.querySelector('.tool-file-stage') };
}
/** mount no longer waits for the preview (a slow Office conversion must not hold the panel's focus): wait until the
 *  stage has left "Loading…". */
async function settle(h) {
  for (let i = 0; i < 400; i++) {
    const s = h.host.querySelector('.tool-file-stage');
    if (s && s.textContent !== 'Loading…') { await tick(1); return; }   // a sync render leaves Loading… before paint settles
    await tick(1);
  }
  throw new Error('the file view never left Loading…');
}
const textFile = (path, text) => ({ path, size: text.length, shown: text.length, truncated: false, binary: false, text });

test('toolFileUrls: the scope rides in ONE path segment; download and the Office PDF are query flags', () => {
  const u = toolFileUrls(P, '');
  assert.equal(u.raw('deck/deck.html'), `/api/tools/raw/${SEG}/deck/deck.html`);
  assert.equal(u.download('a b.png'), `/api/tools/raw/${SEG}/a%20b.png?download=1`);
  assert.equal(u.pdf('r.docx'), `/api/tools/raw/${SEG}/r.docx?as=pdf`);
  assert.equal(u.text('a.md'), '/api/tools/file?scope=project&projectKey=app-0000aaaa&path=a.md');
});

test('markdown: rendered and sanitised by default; Source shows highlighted source; the choice is kept per tab', async () => {
  const h = harness({ file: textFile('docs/readme.md', '# Title\n\n<img src=x onerror="alert(1)">\n\n**bold**') });
  const { tab, stage } = await openFile(h, 'docs/readme.md');
  assert.ok(stage.classList.contains('kind-markdown'));
  assert.equal(stage.querySelector('.artifact-markdown h1').textContent, 'Title');
  assert.equal(stage.querySelector('strong').textContent, 'bold');
  assert.equal(stage.querySelector('[onerror]'), null, 'DOMPurify ran');
  const [prev, src] = h.host.querySelectorAll('.tool-file-mode button');
  assert.deepEqual([prev.textContent, prev.getAttribute('aria-pressed'), src.getAttribute('aria-pressed')], ['Preview', 'true', 'false']);
  src.click();
  await settle(h);
  assert.equal(tab.state.mdView, 'source');
  const s2 = h.host.querySelector('.tool-file-stage');
  assert.ok(s2.classList.contains('kind-code'));
  assert.equal(s2.querySelector('pre').textContent, '# Title\n\n<img src=x onerror="alert(1)">\n\n**bold**');
  assert.ok(s2.querySelectorAll('span.hljs-keyword').length > 0);
  assert.equal(h.doc.activeElement, h.host.querySelectorAll('.tool-file-mode button')[1], 'focus stays on the toggle');
  // Another file in the same tab keeps Source; a fresh tab starts on Preview.
  const again = await openFile(harness({ file: textFile('b.md', '# B') }), 'b.md', { mdView: 'source' });
  assert.ok(again.stage.classList.contains('kind-code'));
  assert.equal(h.calls.filter(([m, u]) => m === 'GET' && u.startsWith('/api/tools/file?')).length, 1, 'the toggle re-renders the text it holds: no refetch');
});

test('a slow Preview never overwrites a later Source: each paint renders into its own stage', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const h = harness({ file: textFile('slow.md', '# Slow') });
  const kind = createFilesKind({ doc: h.doc, fetch: h.fetch, previewDeps: () => ({ loadMarkdown: async () => { await held; return MD; }, hljsLoader }) });
  const tab = { id: 'tab_s', kind: 'files', scope: P, state: { file: 'slow.md' } };
  h.tabs.set(tab.id, tab);
  await kind.mount(tab, h.host, h.api);
  await tick();
  h.host.querySelectorAll('.tool-file-mode button')[1].click();
  await settle(h);
  assert.ok(h.host.querySelector('.tool-file-stage').classList.contains('kind-code'));
  release();
  await tick();
  const s = h.host.querySelector('.tool-file-stage');
  assert.ok(s.classList.contains('kind-code'), 'the late markdown rendered into a detached stage');
  assert.equal(h.host.querySelector('.artifact-markdown'), null);
});

test('code is highlighted; csv/tsv are tables; a non-markdown file has no Preview / Source toggle', async () => {
  const code = await openFile(harness({ file: textFile('src/app.py', 'def f():\n  return 1') }), 'src/app.py');
  assert.ok(code.stage.classList.contains('kind-code'));
  assert.equal(code.stage.querySelectorAll('span.hljs-keyword').length, 2);
  const csv = await openFile(harness({ file: textFile('d.csv', 'a,b\n1,"x, y"') }), 'd.csv');
  assert.deepEqual([...csv.stage.querySelectorAll('table.apv-csv th')].map((t) => t.textContent), ['a', 'b']);
  assert.equal(csv.stage.querySelector('tbody td:last-child').textContent, 'x, y');
  const tsv = await openFile(harness({ file: textFile('d.tsv', 'a\tb\n1\t2') }), 'd.tsv');
  assert.ok(tsv.stage.querySelector('table.apv-csv'));
  assert.equal(csv.stage.closest('.tool-file').querySelector('.tool-file-mode'), null);
});

test('raw kinds come from the raw route after a HEAD: image, svg, pdf, audio, video, and html in a script-only sandbox', async () => {
  const raw = (p) => `/api/tools/raw/${SEG}/${p}`;
  const bin = (path) => ({ path, size: 10, shown: 10, truncated: false, binary: true, text: '' });
  const img = await openFile(harness({ file: bin('shot.png') }), 'shot.png');
  assert.equal(img.stage.querySelector('img').getAttribute('src'), raw('shot.png'));
  const svg = await openFile(harness({ file: textFile('logo.svg', '<svg/>') }), 'logo.svg');
  assert.equal(svg.stage.querySelector('img').getAttribute('src'), raw('logo.svg'), 'SVG only ever through <img>');
  const pdf = await openFile(harness({ file: bin('out.pdf') }), 'out.pdf');
  assert.equal(pdf.stage.querySelector('embed[type="application/pdf"]').getAttribute('src'), raw('out.pdf'));
  const audio = await openFile(harness({ file: bin('n.mp3') }), 'n.mp3');
  assert.equal(audio.stage.querySelector('audio[controls]').getAttribute('src'), raw('n.mp3'));
  const video = await openFile(harness({ file: bin('c.mp4') }), 'c.mp4');
  assert.equal(video.stage.querySelector('video[controls]').getAttribute('src'), raw('c.mp4'));
  const html = await openFile(harness({ file: textFile('deck/deck.html', '<deck-stage>') }), 'deck/deck.html');
  const frame = html.stage.querySelector('iframe');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(frame.getAttribute('src'), raw('deck/deck.html'));
});

test('LikeC4 sources open the C4 viewer', async () => {
  const h = harness({ file: textFile('model.c4', 'specification {}') });
  h.win.dagre = {};                         // else ensureC4Viewer injects /c4/dagre.min.js, whose load jsdom never fires
  if (!h.win.customElements.get('worca-c4')) h.win.customElements.define('worca-c4', class extends h.win.HTMLElement { load() {} });
  const { stage } = await openFile(h, 'model.c4');
  assert.ok(stage.classList.contains('kind-c4'));
  assert.equal(stage.querySelector('worca-c4').getAttribute('aria-label'), 'C4 diagram: model.c4');
});

test('office: the PDF when the server converts; "Install LibreOffice" + Download when it cannot; unknown and too-large binaries keep the fallback', async () => {
  const bin = (path, size = 10) => ({ path, size, shown: Math.min(size, 10), truncated: size > 10, binary: true, text: '' });
  const ok = await openFile(harness({ file: bin('r.docx') }), 'r.docx');
  assert.equal(ok.stage.querySelector('embed[type="application/pdf"]').getAttribute('src'), `/api/tools/raw/${SEG}/r.docx?as=pdf`);
  const none = harness({ file: bin('r.xlsx'), heads: { [`/api/tools/raw/${SEG}/r.xlsx?as=pdf`]: 501 } });
  const n = await openFile(none, 'r.xlsx');
  assert.equal(n.stage.querySelector('.tool-file-info .tool-note').textContent, 'Install LibreOffice to preview Office files');
  assert.equal(n.stage.querySelector('.tool-file-info button').textContent, 'Download');
  const unk = await openFile(harness({ file: bin('blob.bin') }), 'blob.bin');
  assert.equal(unk.stage.querySelector('.tool-file-info .tool-note').textContent, 'No preview for this file type');
  const big = harness({ file: bin('huge.png'), heads: { [`/api/tools/raw/${SEG}/huge.png`]: 413 } });
  assert.equal((await openFile(big, 'huge.png')).stage.querySelector('.tool-file-info .tool-note').textContent, 'Too large to preview');
});

// ── in the real app (app.js + index.html): the Files kind gets the app's preview deps ─────────────────────────────────
async function bootFilesTab(file, { arms: extraArms = null, hooks = null, jsdom = null } = {}) {
  const { bootChat, ok } = await import('./helpers/chat-panel-boot.mjs');
  const tools = { v: 1, tabs: [{ id: 'tab_f1', kind: 'files', scope: P, state: { file: file.path }, at: 1 }], active: { [`${P.id}|`]: 'tab_f1' }, prefs: { width: 460 }, open: [`project:${P.id}`] };
  const ctx = await bootChat({ url: `http://localhost:4317/#projects/${P.id}`, local: { 'worca-cc.tools': JSON.stringify(tools) },
    hooks: { askMarkdown: realLoad, hljsLoader, ...(hooks || {}) }, jsdom,
    arms: (url, opts) => {
      const own = extraArms && extraArms(url, opts || {});
      if (own) return own;
      const path = url.split('?')[0];
      if (path.endsWith('/api/projects')) return ok({ projects: [{ key: P.id, name: 'app', path: '/tmp/app' }] });
      if (path.endsWith('/api/tools/file')) return ok({ root: { scope: 'project', label: 'app' }, ...file });
      return null;
    } });
  const doc = ctx.window.document;
  for (let i = 0; i < 400; i++) {
    const s = doc.querySelector('.tool-panel .tool-file-stage');
    if (s && s.textContent !== 'Loading…') break;
    await tick(1);
  }
  await tick(4);
  return doc.querySelector('.tool-panel .tool-file-stage');
}

test('in the real app: a Files tab renders markdown (not a <pre>) and highlights code, through the app\'s preview deps', async () => {
  const md = await bootFilesTab(textFile('docs/readme.md', '# Title\n\n**bold**'));
  assert.ok(md, 'the Files tab shows its file');
  assert.equal(md.querySelector('.artifact-markdown h1')?.textContent, 'Title', 'rendered through the app\'s markdown loader');
  const code = await bootFilesTab(textFile('src/a.mjs', 'const x = 1;'));
  assert.ok(code.querySelector('.hljs-keyword'), 'highlighted through the app\'s hljs loader');
});

test('T-R5 in the real app: an .odt with no converter shows the simplified preview in the Files tab, with its own Download', async () => {
  const { officeVendor } = await import('./helpers/office-vendor.mjs');
  const { fixture, respond } = await import('./helpers/office-lite-fixtures.mjs');
  const { fail } = await import('./helpers/chat-panel-boot.mjs');
  const base = `/api/tools/raw/${SEG}/docs/notes.odt`;
  let vendor = null;
  const stage = await bootFilesTab({ path: 'docs/notes.odt', size: 1114, shown: 10, truncated: true, binary: true, text: '' }, {
    jsdom: { runScripts: 'outside-only', beforeParse: (w) => { vendor = officeVendor(w); } },
    hooks: { officeImport: (u) => vendor.importer(u) },
    arms: (url, opts) => (url === `${base}?as=pdf` && opts.method === 'HEAD' ? fail(501, {})
      : url === `${base}?download=1` && (opts.method || 'GET') === 'GET' ? Promise.resolve(respond(fixture('notes.odt'))) : null),
  });
  for (let i = 0; i < 300 && !stage.ownerDocument.querySelector('.tool-panel .tool-file-stage .olp'); i++) await tick(1);
  const root = stage.ownerDocument.querySelector('.tool-panel .tool-file-stage .olp[data-office-path="text"]');
  assert.ok(root, stage.ownerDocument.querySelector('.tool-panel .tool-file-stage')?.textContent.slice(0, 300));
  assert.ok(root.querySelector('button.olp-dl'));
  assert.equal(root.querySelector('.olp-text h1').textContent, 'Release notes');
  assert.deepEqual(vendor.calls, ['/vendor/jszip/jszip.min.js']);
});

// ── chat links (issue 1064 final slice): lines, run roots, chat copies ───────────────────────────────────────────
const TEN = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
test('a line marks the code view; past the end marks the last line; a range gets a band', async () => {
  const h = harness({ file: textFile('src/x.js', TEN) });
  const { stage } = await openFile(h, 'src/x.js', { line: 3 });
  const m = stage.querySelector('.tool-line-mark[data-line="3"]');
  assert.ok(m, 'marked');
  const pre = stage.querySelector('pre');
  const range = h.doc.createRange(); range.setStart(pre, 0); range.setEndBefore(m);
  assert.match(range.toString(), /line 2\n$/);
  assert.match(h.host.querySelector('.tool-file-line').textContent, /Line 3/);
  const p = await openFile(harness({ file: textFile('src/x.js', TEN) }), 'src/x.js', { line: 99 });
  assert.ok(p.stage.querySelector('.tool-line-mark[data-line="10"]'));
  const r = await openFile(harness({ file: textFile('src/x.js', TEN) }), 'src/x.js', { line: 3, endLine: 5 });
  assert.ok(r.stage.querySelector('.tool-line-band[data-start="3"][data-end="5"]'));
});
test('a markdown file with a line opens in Source; a run root rides on the file request', async () => {
  const h = harness({ file: textFile('a.md', '# A\n\nb\n') });
  await openFile(h, 'a.md', { line: 2 });
  assert.ok(h.host.querySelector('[data-mode="source"][aria-pressed="true"]'));
  // Preview chosen, then a line link: rendered markdown has no line map, so nothing is marked (never a fenced block's <pre>)
  const hp = harness({ file: textFile('a.md', '# A\n\n```js\nconst x = 1;\n```\n\npara\n') });
  const pv = await openFile(hp, 'a.md', { line: 7, mdView: 'preview' });
  assert.ok(hp.host.querySelector('[data-mode="preview"][aria-pressed="true"]'));
  assert.ok(pv.stage.querySelector('pre'), 'the fence renders a <pre>');
  assert.equal(pv.stage.querySelector('.tool-line-mark, .tool-line-band'), null);
  const h2 = harness({ file: textFile('src/x.js', TEN) });
  await openFile(h2, 'src/x.js', { root: 'run:abcd1234' });
  assert.ok(h2.calls.some(([, u]) => u.startsWith('/api/tools/file?') && u.includes('root=run%3Aabcd1234')), JSON.stringify(h2.calls));
});
test('a chat copy (att) reads the attachment route, says Chat copy; a 413 image copy shows Download', async () => {
  const TIDC = 'ask_0000ca11';
  const run = async (state, heads = {}) => {
    const h = harness({ file: textFile('x', '') , heads });
    const inner = h.fetch;
    h.fetch = async (u, o = {}) => (String(u).includes('/attachments/') && (o.method || 'GET') === 'GET' ? (h.calls.push(['GET', u]), { ok: true, status: 200, json: async () => ({ text: 'copy\n' }) }) : inner(u, o));
    const kind = createFilesKind({ doc: h.doc, fetch: h.fetch, previewDeps: () => ({ loadMarkdown: realLoad, hljsLoader }) });
    const tab = { id: 'tab_c', kind: 'files', scope: { type: 'chat', id: TIDC }, state };
    h.tabs.set(tab.id, tab);
    await kind.mount(tab, h.host, h.api);
    await settle(h);
    return h;
  };
  const h = await run({ att: 'att_00000001', attName: 'notes.txt', attBytes: 5, attKind: 'text' });
  assert.match(h.host.textContent, /Chat copy/);
  assert.ok(h.calls.some(([m, u]) => m === 'GET' && u === `/api/ask/threads/${TIDC}/attachments/att_00000001?as=text`), JSON.stringify(h.calls));
  const img = await run({ att: 'att_00000002', attName: 'big.png', attBytes: 9e7, attKind: 'image' }, { [`/api/ask/threads/${TIDC}/attachments/att_00000002`]: 413 });
  assert.equal(img.host.querySelector('.tool-file-info button')?.textContent, 'Download');
});
test('markLine: an hljs-split <pre> gets the anchor at the right offset', async () => {
  const { markLine } = await import('../ui/public/tool-files.mjs');
  const dom = new JSDOM('<div><pre><span>line 1\nli</span><span>ne 2\nline</span> 3\n</pre></div>');
  const host = dom.window.document.querySelector('div');
  const m = markLine(host, 3);
  const r = dom.window.document.createRange(); r.setStart(host.querySelector('pre'), 0); r.setEndBefore(m);
  assert.equal(r.toString(), 'line 1\nline 2\n');
});
test('markLine: the band paints under the text (its own stacking context on the <pre>, z-index -1 in style.css)', async () => {
  const { markLine } = await import('../ui/public/tool-files.mjs');
  const dom = new JSDOM('<div><pre>a\nb\nc\n</pre></div>');
  const host = dom.window.document.querySelector('div');
  markLine(host, 2);
  assert.equal(host.querySelector('pre').style.isolation, 'isolate');
  const css = readStyleCss();
  assert.match(css, /\.tool-line-band\{[^}]*z-index:-1;/);
  // the marked <pre> is positioned, so it would paint over the sticky file head once the stage scrolls (live walk, step 6)
  assert.match(css, /\.tool-file-head\{[^}]*position:sticky;[^}]*z-index:1;/);
});
