import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildFilesCard, filesForViewer, fileViewerUrls, registerBuiltinFileRenderers } from '../ui/public/chat/files-card.mjs';
import { _resetFileRenderers, registerFileRenderer } from '../ui/public/chat/file-renderers.mjs';

const windows = [];
afterEach(() => { while (windows.length) windows.pop().close(); });
function ctxOf(over = {}) {
  const { window } = new JSDOM('<!doctype html><body></body>');
  windows.push(window);
  const opened = [];
  return { opened, ctx: { doc: window.document, win: window, threadId: () => 'ask_aaaaaaaa', openFiles: (o) => opened.push(o), ...over } };
}
const ITEMS = [
  { attId: 'att_00000001', name: 'home.png', kind: 'image', mime: 'image/png', bytes: 2048, width: 640, height: 480 },
  { attId: 'att_00000002', name: 'logo.svg', kind: 'svg', mime: 'image/svg+xml', bytes: 300 },
  { attId: 'att_00000003', name: 'page.html', kind: 'html', mime: 'text/html', bytes: 90 },
  { attId: 'att_00000004', name: 'data.bin', kind: 'mystery', mime: null, bytes: 10 },
];

beforeEach(() => { _resetFileRenderers(); registerBuiltinFileRenderers(); });

test('files card: images and svg as <img> tiles, others as rows with Download; no iframe, no inline svg; a click opens the viewer at that file', () => {
  const { ctx, opened } = ctxOf();
  const { el } = buildFilesCard({ id: 'card_00000001', state: 'shown', card: { type: 'files', title: 'Screens', caption: 'Screens', items: ITEMS, skipped: [{ name: '.env', reason: 'credential' }] } }, ctx);
  const imgs = [...el.querySelectorAll('.ask-filescard-thumb img')];
  assert.deepEqual(imgs.map((i) => i.getAttribute('src')), ['/api/ask/threads/ask_aaaaaaaa/attachments/att_00000001', '/api/ask/threads/ask_aaaaaaaa/attachments/att_00000002']);
  assert.equal(imgs[0].getAttribute('width'), '640');
  assert.equal(el.querySelector('iframe, embed, object, script'), null, 'nothing framed');
  assert.ok([...el.querySelectorAll('svg')].every((g) => g.closest('.ask-filescard-ib')), 'the only inline svg is a repo glyph on an icon button');
  const rows = [...el.querySelectorAll('.ask-filescard-file')];
  assert.deepEqual(rows.map((r) => r.querySelector('.ask-filescard-meta').textContent.split(' · ')[0]), ['HTML source', 'File']);
  const dl = rows[1].querySelector('a.ask-filescard-ib');
  assert.deepEqual([dl.getAttribute('download'), dl.title, dl.getAttribute('aria-label'), dl.textContent], ['data.bin', 'Download', 'Download data.bin', ''], 'an icon button, not a text link');
  assert.equal(el.querySelectorAll('.ask-filescard-tile a.ask-filescard-dl').length, 2, 'image tiles have Download too');
  assert.equal(el.querySelector('.ask-filescard-reveal'), null, 'no item has a source: no Show in folder');
  assert.match(el.querySelector('.ask-filescard-skipped').textContent, /\.env/);
  rows[0].querySelector('button').click();
  assert.deepEqual(opened[0], { threadId: 'ask_aaaaaaaa', items: ITEMS, index: 2 });
});

test('files card helpers: viewer list pins the sniffed kind (html -> code, unknown -> none); urls read the id back', () => {
  assert.deepEqual(filesForViewer(ITEMS).map((a) => [a.relPath, a.previewKind]),
    [['att_00000001/home.png', 'image'], ['att_00000002/logo.svg', 'image'], ['att_00000003/page.html', 'code'], ['att_00000004/data.bin', 'none']]);
  const u = fileViewerUrls('ask_aaaaaaaa');
  assert.equal(u.raw('att_00000003/page.html'), '/api/ask/threads/ask_aaaaaaaa/attachments/att_00000003');
  assert.equal(u.text('att_00000003/page.html'), '/api/ask/threads/ask_aaaaaaaa/attachments/att_00000003?as=text');
});

test('files card guards: no chat yet → no tiles, no links, a click opens nothing; junk items dropped; a throwing thumb falls back to a row', () => {
  const { ctx, opened } = ctxOf({ threadId: () => null });
  const { el } = buildFilesCard({ id: 'card_00000002', state: 'shown', card: { type: 'files', items: [ITEMS[0], null, { name: 'x' }, { attId: 'att_9' }] } }, ctx);
  assert.equal(el.querySelector('img'), null);
  assert.equal(el.querySelectorAll('.ask-filescard-file').length, 1);
  assert.equal(el.querySelector('a'), null);
  el.querySelector('.ask-filescard-name').click();
  assert.equal(opened.length, 0);
  registerFileRenderer('image', { preview: 'image', label: 'Image', thumb: () => { throw new Error('boom'); } });
  const ok = ctxOf();
  const built = buildFilesCard({ id: 'card_00000003', state: 'shown', card: { type: 'files', items: [ITEMS[0]] } }, ok.ctx);
  assert.equal(built.el.querySelector('img'), null);
  assert.equal(built.el.querySelector('.ask-filescard-name').textContent, 'home.png');
});

test('files card Show in folder: only on items with a source, hidden until revealInfo answers, labelled with the app; a click names the attachment, never a path', async () => {
  const revealed = [];
  let answer;
  const info = new Promise((r) => { answer = r; });
  const { ctx, opened } = ctxOf({ revealInfo: () => info, revealFile: (o) => revealed.push(o) });
  const items = [{ ...ITEMS[0], source: true }, { ...ITEMS[3], source: true }, ITEMS[2]];
  const { el } = buildFilesCard({ id: 'card_00000004', state: 'shown', card: { type: 'files', items } }, ctx);
  const btns = [...el.querySelectorAll('.ask-filescard-reveal')];
  assert.equal(btns.length, 2, 'the html item has no source');
  assert.ok(btns.every((b) => b.hidden), 'hidden until the server says a folder can open here');
  answer({ label: 'Finder' });
  await info; await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(btns.map((b) => [b.hidden, b.title, b.getAttribute('aria-label')]),
    [[false, 'Show in Finder', 'Show home.png in Finder'], [false, 'Show in Finder', 'Show data.bin in Finder']]);
  btns[1].click();
  assert.deepEqual(revealed, [{ threadId: 'ask_aaaaaaaa', attId: 'att_00000004', name: 'data.bin' }]);
  assert.equal(opened.length, 0, 'the icon button does not open the viewer');
});

test('files card Show in folder: a hosted worca (revealInfo null) never shows it; no revealFile dep, no button', async () => {
  const off = ctxOf({ revealInfo: async () => null, revealFile: () => {} });
  const { el } = buildFilesCard({ id: 'card_00000005', state: 'shown', card: { type: 'files', items: [{ ...ITEMS[3], source: true }] } }, off.ctx);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(el.querySelector('.ask-filescard-reveal').hidden, true);
  const none = ctxOf();
  const b = buildFilesCard({ id: 'card_00000006', state: 'shown', card: { type: 'files', items: [{ ...ITEMS[3], source: true }] } }, none.ctx);
  assert.equal(b.el.querySelector('.ask-filescard-reveal'), null);
});

test('files card: its icon buttons are the one button component; the card adds no resting shadow or literal radius', () => {
  const { ctx } = ctxOf({ revealInfo: () => ({ label: 'Finder' }), revealFile: () => {} });
  const items = [{ ...ITEMS[0], source: true }, { ...ITEMS[3], source: true }];
  const { el } = buildFilesCard({ id: 'card_00000002', state: 'shown', card: { type: 'files', title: 'Two', items } }, ctx);
  const ibs = [...el.querySelectorAll('.ask-filescard-ib')];
  assert.equal(ibs.length, 4, 'Show in folder and Download on each item');
  for (const ib of ibs) {
    assert.ok(['btn', 'btn-sm', 'btn-quiet', 'btn-icon'].every((c) => ib.classList.contains(c)), ib.className);
  }
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const card = [...css.matchAll(/([^{}]*\.ask-filescard[^{}]*)\{([^}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  assert.ok(card.length >= 10);
  for (const [sel, body] of card) {
    assert.doesNotMatch(body, /border-radius:\s*\d/, `${sel}: token radius only`);
    assert.doesNotMatch(body, /box-shadow|--shadow-card/, `${sel}: no resting shadow`);
  }
});
