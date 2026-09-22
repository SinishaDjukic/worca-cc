// test/ui-ask-widgets-files.test.mjs — the widgets that read the ask's snapshot
// manifest (ask-forms design §7). Files are addressed by INDEX, never by path;
// SVG only ever reaches the DOM as an <img>; nothing here fetches — the host's
// loadText seam is injected (W5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderAskForm } from '../ui/public/ask/form-renderer.mjs';

const win = new JSDOM('<!doctype html><body></body>').window;
const doc = win.document;
const input = (n) => n.dispatchEvent(new win.Event('input', { bubbles: true }));

const FILES = [
  { index: 0, rel: 'shots/a.png', name: 'a.png', mime: 'image/png', bytes: 3072, sha256: 'p' },
  { index: 1, rel: 'shots/b.svg', name: 'b.svg', mime: 'image/svg+xml', bytes: 900, sha256: 'q' },
  { index: 2, rel: 'out/report.pdf', name: 'report.pdf', mime: 'application/pdf', bytes: 524288, sha256: 'r' },
  { index: 3, rel: 'clip.mp4', name: 'clip.mp4', mime: 'video/mp4', bytes: 10485760, sha256: 's' },
  { index: 4, rel: 'notes.md', name: 'notes.md', mime: 'text/markdown', bytes: 64, sha256: 't' },
  { index: 5, rel: 'tone.mp3', name: 'tone.mp3', mime: 'audio/mpeg', bytes: 2048, sha256: 'u' },
];
// X16: fileRefs[i] <-> files[i], in document order. It is what tells the renderer a
// bound value is a FILE — the scalar widgets never guess from the string.
const REFS = [
  { path: 'data.hero', rel: 'shots/a.png' }, { path: 'data.vector', rel: 'shots/b.svg' },
  { path: 'data.p', rel: 'out/report.pdf' }, { path: 'data.v', rel: 'clip.mp4' },
  { path: 'data.doc', rel: 'notes.md' }, { path: 'data.a', rel: 'tone.mp3' },
  { path: 'data.x', rel: 'shots/a.png' }, { path: 'data.y', rel: 'shots/b.svg' },
  { path: 'data.known', rel: 'shots/a.png' }, { path: 'data.missing', rel: 'shots/gone.png' },
];
const askOf = (layout, data = {}, fileRefs = REFS) => ({
  id: 'questions-x:1-r1', askId: 'questions-x_1-r1', kind: 'form', form: 'f', version: 1,
  title: 'T', surface: 'any',
  data, files: FILES, fileRefs, layout,
  answerSchema: { type: 'object', required: [], properties: {} },
});
// The route takes askId, NOT id (X1 / P2 E1).
const URLS = (i) => `/api/runs/r1/ask-files/questions-x_1-r1/${i}`;
const mount = (ask, opts = {}) => renderAskForm(ask, { doc, fileUrl: URLS, ...opts });

test('image: <img> by index with the caption as alt, and an SVG stays an <img>', () => {
  const f = mount(askOf([
    { widget: 'image', bind: 'data.hero', caption: 'The hero' },
    { widget: 'image', bind: 'data.vector' },
  ], { hero: 'shots/a.png', vector: 'shots/b.svg' }));
  const imgs = [...f.el.querySelectorAll('.af-img img')];
  assert.deepEqual(imgs.map((i) => i.getAttribute('src')), [URLS(0), URLS(1)]);
  assert.equal(imgs[0].getAttribute('alt'), 'The hero');
  assert.equal(imgs[1].getAttribute('alt'), 'b.svg', 'no caption -> the file name');
  assert.equal(f.el.querySelector('svg'), null, 'an SVG file is never inlined as markup');
  assert.match(f.el.querySelector('figcaption').textContent, /3 KB/);
});

test('gallery without a field is display-only and contributes nothing', () => {
  const f = mount(askOf([{ widget: 'gallery', bind: 'data.shots', captionKey: 'caption', fileKey: 'file' }],
    { shots: [{ id: 'a', caption: 'A', file: 'shots/a.png' }, { id: 'b', caption: 'B', file: 'shots/b.svg' }] }));
  const cards = [...f.el.querySelectorAll('.af-gal-card')];
  assert.deepEqual(cards.map((c) => c.tagName), ['DIV', 'DIV'], 'no buttons without a field');
  assert.equal(f.el.querySelectorAll('[aria-pressed]').length, 0);
  assert.deepEqual(f.collect(), { values: {}, errors: [] });
});

test('compare: two images, a labelled range, and the clip follows it', () => {
  const f = mount(askOf([{ widget: 'compare', before: 'data.x', after: 'data.y',
    beforeLabel: 'Was', afterLabel: 'Now', label: 'Change' }], { x: 'shots/a.png', y: 'shots/b.svg' }));
  const view = f.el.querySelector('.af-cmp-view');
  assert.deepEqual([...view.querySelectorAll('img')].map((i) => i.getAttribute('src')), [URLS(1), URLS(0)]);
  assert.deepEqual([...f.el.querySelectorAll('.af-cmp-tag')].map((t) => t.textContent), ['Was', 'Now']);
  const r = f.el.querySelector('input[type="range"]');
  assert.equal(r.getAttribute('aria-label'), 'Swipe between Was and Now');
  assert.equal(r.value, '50');
  const top = view.querySelector('.af-cmp-top');
  assert.equal(top.style.clipPath, 'inset(0 50% 0 0)');
  r.value = '80'; input(r);
  assert.equal(top.style.clipPath, 'inset(0 20% 0 0)');
});

test('media: <video> for mp4 and <audio> for mp3, controls on, autoplay never', () => {
  const f = mount(askOf([{ widget: 'media', bind: 'data.v' }, { widget: 'media', bind: 'data.a' }],
    { v: 'clip.mp4', a: 'tone.mp3' }));
  const v = f.el.querySelector('video');
  const a = f.el.querySelector('audio');
  assert.equal(v.getAttribute('src'), URLS(3));
  assert.equal(a.getAttribute('src'), URLS(5));
  for (const n of [v, a]) {
    assert.equal(n.hasAttribute('controls'), true);
    assert.equal(n.getAttribute('preload'), 'metadata');
    assert.equal(n.hasAttribute('autoplay'), false);
  }
});

test('pdf: an unsandboxed titled frame plus a permanent Open link', () => {
  const f = mount(askOf([{ widget: 'pdf', bind: 'data.p' }], { p: 'out/report.pdf' }));
  const frame = f.el.querySelector('iframe');
  assert.equal(frame.dataset.afPdf, 'frame');
  assert.equal(frame.getAttribute('src'), URLS(2));
  assert.equal(frame.getAttribute('title'), 'PDF preview: report.pdf');
  assert.equal(frame.getAttribute('loading'), 'lazy');
  assert.equal(frame.hasAttribute('sandbox'), false,
    'W14: Chromium refuses to run its PDF viewer inside a sandboxed frame');
  const open = f.el.querySelector('.af-open');
  assert.equal(open.getAttribute('href'), URLS(2));
  assert.equal(open.getAttribute('target'), '_blank');
  assert.equal(open.getAttribute('rel'), 'noopener noreferrer');
  assert.match(f.el.querySelector('.af-pdf-bar').textContent, /report\.pdf/);
  assert.match(f.el.querySelector('.af-pdf-bar').textContent, /512 KB/);
});

test('a text-class file binds through ctx.loadText, never through a fetch here', async () => {
  const asked = [];
  const f = mount(askOf([{ widget: 'markdown', bind: 'data.doc' }], { doc: 'notes.md' }), {
    loadText: (i) => { asked.push(i); return Promise.resolve('# From the file'); },
    markdown: (t) => {
      const frag = doc.createDocumentFragment();
      frag.appendChild(Object.assign(doc.createElement('h1'), { textContent: t.replace('# ', '') }));
      return { kind: 'md', frag };
    },
  });
  assert.deepEqual(asked, [4], 'asked for the manifest INDEX, not the path');
  assert.ok(f.el.querySelector('.af-open'), 'the Open link is there before the body arrives');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(f.el.querySelector('.af-md h1').textContent, 'From the file');
});

test('with no loadText the chrome and the link stay and no body is drawn', () => {
  const f = mount(askOf([{ widget: 'code', bind: 'data.doc', name: 'notes.md', lang: 'markdown' }],
    { doc: 'notes.md' }));
  assert.equal(f.el.querySelector('.af-code-bar').textContent.includes('notes.md'), true);
  assert.equal(f.el.querySelector('pre > code').textContent, '');
  assert.equal(f.el.querySelector('.af-open').getAttribute('href'), URLS(4));
});

test('X14: with no snapshot at all, every file widget draws the .af-nofile tile', () => {
  // P5's Agents-view preview renders a declaration's `example`: files were never
  // snapshotted, so it passes files: [] and fileUrl: () => null.
  const ask = { ...askOf([
    { widget: 'image', bind: 'data.hero' },
    { widget: 'pdf', bind: 'data.p' },
    { widget: 'media', bind: 'data.v' },
    { widget: 'compare', before: 'data.hero', after: 'data.p' },
    { widget: 'markdown', bind: 'data.doc' },
    { widget: 'code', bind: 'data.doc', name: 'notes.md' },
    { widget: 'gallery', bind: 'data.shots', captionKey: 'caption', fileKey: 'file' },
  ], { hero: 'shots/a.png', p: 'out/report.pdf', v: 'clip.mp4', doc: 'notes.md',
    shots: [{ id: 'a', caption: 'A', file: 'shots/a.png' }] }), files: [] };
  // fileRefs survives; only the snapshot is absent — exactly P5's preview shape.
  const asked = [];
  const f = renderAskForm(ask, { doc, fileUrl: () => null, loadText: (i) => { asked.push(i); return Promise.resolve(''); } });
  assert.equal(f.el.querySelector('img'), null, 'no broken image anywhere');
  assert.equal(f.el.querySelector('iframe'), null, 'no frame for an unsnapshotted PDF');
  assert.equal(f.el.querySelector('video'), null);
  assert.equal(f.el.querySelector('audio'), null);
  assert.deepEqual(asked, [], 'and nothing was asked of the host');
  const tiles = [...f.el.querySelectorAll('.af-nofile')];
  assert.equal(tiles.length, 8, 'image, pdf, media, compare x2, markdown, code, gallery row');
  assert.match(f.el.textContent, /shots\/a\.png/);
  assert.match(f.el.textContent, /out\/report\.pdf/);
  const pdfTile = tiles.find((t) => t.textContent.includes('report.pdf'));
  assert.equal(pdfTile.querySelector('.af-file-badge').textContent, 'PDF');
  assert.ok(f.el.querySelector('.af-gal-nofile'), 'a gallery row tiles in place');
});

test('X14: a rel the manifest lacks tiles too, even when other files resolve', () => {
  const f = mount(askOf([
    { widget: 'image', bind: 'data.known' },
    { widget: 'image', bind: 'data.missing' },
  ], { known: 'shots/a.png', missing: 'shots/gone.png' }));
  assert.equal(f.el.querySelectorAll('.af-img img').length, 1);
  const tile = f.el.querySelector('.af-nofile');
  assert.equal(tile.querySelector('.af-file-name').textContent, 'shots/gone.png');
  assert.equal(tile.querySelector('.af-file-badge').textContent, 'PNG');
});

test('X16: a path-like BODY with no fileRefs entry renders as text, not a tile', () => {
  // `data.summary` is not a type:'file' field, so it is absent from fileRefs. Its
  // value looks exactly like a relative path — and is still a document body.
  const f = mount(askOf([{ widget: 'markdown', bind: 'data.summary' },
    { widget: 'code', bind: 'data.snippet', name: 's' }],
  { summary: 'README.md', snippet: 'docs/guide.md' }));
  assert.equal(f.el.querySelector('.af-nofile'), null, 'never guessed from the string');
  assert.equal(f.el.querySelector('.af-md').textContent, 'README.md');
  assert.equal(f.el.querySelector('pre > code').textContent, 'docs/guide.md');
});

test('X16: a file-typed bind with an empty manifest renders the tile, whatever it holds', () => {
  // In fileRefs, so it IS a file — even though the value reads like prose and the
  // snapshot is missing (P5's preview passes files: [] and fileUrl: () => null).
  const ask = { ...askOf([{ widget: 'markdown', bind: 'data.doc' }, { widget: 'pdf', bind: 'data.p' }],
    { doc: 'Two directions. Pick one.', p: 'out/report.pdf' },
    [{ path: 'data.doc', rel: 'Two directions. Pick one.' }, { path: 'data.p', rel: 'out/report.pdf' }]),
  files: [] };
  const asked = [];
  const f = renderAskForm(ask, { doc, fileUrl: () => null, loadText: (i) => { asked.push(i); return Promise.resolve(''); } });
  assert.equal(f.el.querySelector('.af-md'), null, 'a file field is never rendered as content');
  assert.equal(f.el.querySelector('iframe'), null);
  assert.equal(f.el.querySelectorAll('.af-nofile').length, 2);
  assert.deepEqual(asked, [], 'nothing was fetched');
});

test('a disposed form never paints a late loadText result', async () => {
  let resolveIt = null;
  const f = mount(askOf([{ widget: 'markdown', bind: 'data.doc' }], { doc: 'notes.md' }),
    { loadText: () => new Promise((r) => { resolveIt = r; }), markdown: null });
  f.dispose();
  resolveIt('late content');
  await new Promise((r) => setTimeout(r, 0));
  assert.doesNotMatch(f.el.textContent, /late content/);
});
