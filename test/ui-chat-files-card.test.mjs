import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
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
  assert.equal(el.querySelector('iframe, embed, object, svg, script'), null, 'nothing framed, no inline svg');
  const rows = [...el.querySelectorAll('.ask-filescard-file')];
  assert.deepEqual(rows.map((r) => r.querySelector('.ask-filescard-meta').textContent.split(' · ')[0]), ['HTML source', 'File']);
  assert.equal(rows[1].querySelector('a').getAttribute('download'), 'data.bin');
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
