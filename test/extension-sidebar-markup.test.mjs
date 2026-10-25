// test/extension-sidebar-markup.test.mjs — the sidebar's rows/chip/composer have the Ask panel's exact skeleton.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePanel } from './helpers/ask-panel-harness.mjs';
import { buildQuoteChip, buildRow, buildComposer, buildNewChatButton, buildFileChip, buildDropOverlay, SEND_ICON_PATH, NEW_CHAT_ICON_PATH, ICON } from '../extension/src/sidebar/sidebar-view.mjs';
import { ATTACH_ACCEPT } from '../ui/public/attach-files.mjs';
import { formatQuotedMessage } from '../ui/public/pinpoint-model.mjs';

const TID = 'askt_00000001';
const QUOTED = formatQuotedMessage({ text: 'token bucket', src: 'docs.example.com' }, 'Why?');
const ROWS = [
  { id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: QUOTED, blocks: [{ kind: 'attachment', id: 'att_1', name: 'page-context.md', bytes: 120, attKind: 'text', mime: 'text/markdown' }], status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' },
  { id: 'askm_00000002', threadId: TID, seq: 2, role: 'assistant', text: 'A plain answer.', blocks: [], status: 'done', reason: null, createdAt: 't' },
  { id: 'askm_00000003', threadId: TID, seq: 3, role: 'assistant', text: '', blocks: [], status: 'error', errorMessage: 'The turn failed.', reason: null, createdAt: 't' },
];
const SNAP = { thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} }, messages: ROWS, attachments: [], runLinks: [], inFlight: null, worktrees: [] };
const handler = (url, opts) => {
  const method = ((opts && opts.method) || 'GET').toUpperCase();
  if (url === `/api/ask/threads/${TID}` && method === 'GET') return { ok: true, status: 200, json: async () => SNAP };
  return { ok: true, status: 200, json: async () => ({ threads: [] }) };
};
async function loaded() {
  const ctx = makePanel({ fetchHandler: handler });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick(); ctx.flush();
  return ctx;
}
const skeleton = (el) => ({ t: el.tagName, c: [...el.classList].sort().join(' '), k: [...el.children].map(skeleton) });
const plainRenderer = { render: () => ({ kind: 'plain' }) };   // the harness disables markdown → ask-answer-plain
const opts = (row) => ({ text: (r) => r.text || '', live: () => false, renderer: plainRenderer, openInWorca: () => {}, row });

test('user row (quote card + bubble + attachment pills) has the Ask panel skeleton', async () => {
  const h = await loaded();
  const ref = h.doc.querySelector('.ask-msg-user');
  assert.ok(ref, 'the Ask panel rendered the user row');
  const mine = buildRow(h.doc, ROWS[0], opts(ROWS[0])).el;
  assert.deepEqual(skeleton(mine), skeleton(ref));
  assert.equal(mine.querySelector('.ask-user-bubble').textContent, ref.querySelector('.ask-user-bubble').textContent);
});

test('assistant answer and error line have the Ask panel skeleton and classes', async () => {
  const h = await loaded();
  const refs = [...h.doc.querySelectorAll('.ask-msg-assistant')];
  const refAnswer = refs[0].querySelector('.ask-answer');
  const mineAnswer = buildRow(h.doc, ROWS[1], opts(ROWS[1])).answer;
  assert.deepEqual(skeleton(mineAnswer), skeleton(refAnswer));
  assert.equal(mineAnswer.textContent, refAnswer.textContent);
  const refErr = refs[1].querySelector('.ask-error-line');
  const mineErr = buildRow(h.doc, ROWS[2], opts(ROWS[2])).el.querySelector('.ask-error-line');
  assert.deepEqual(skeleton(mineErr), skeleton(refErr));
  assert.equal(mineErr.textContent, refErr.textContent);
});

test('the quote chip has the Ask panel quote chip skeleton', async () => {
  const h = await loaded();
  h.panel.setQuote({ text: 'token bucket', src: 'docs.example.com' });
  h.flush();
  const ref = h.doc.querySelector('.ask-chip-quote');
  assert.ok(ref);
  assert.deepEqual(skeleton(buildQuoteChip(h.doc, { text: 'token bucket', src: 'docs.example.com' }, () => {})), skeleton(ref));
});

test('the head\'s New chat button is the Chat head\'s + (ask-panel.mjs newChatPlus): classes, glyph; named New chat', async () => {
  const h = await loaded();
  const ref = h.doc.querySelector('.chat-head [data-ask-new-btn]');
  assert.ok(ref, 'the Ask panel rendered its New chat button');
  const mine = buildNewChatButton(h.doc, 'chat-head-btn', () => {});
  // The panel's title adds its ⌥⌘N hint; the sidebar has no such key, so its name is just "New chat".
  assert.equal(mine.title, 'New chat');
  assert.equal(mine.getAttribute('aria-label'), 'New chat');
  assert.match(ref.title, /^New chat /);
  const attrs = (b) => ({ cls: b.className, type: b.type, skel: skeleton(b), text: b.textContent,
    attrs: [...b.attributes].map((a) => a.name).sort(),
    svg: [...b.querySelector('svg').attributes].map((a) => `${a.name}=${a.value}`).sort(), d: [...b.querySelectorAll('path')].map((p) => p.getAttribute('d')) });
  assert.deepEqual(attrs(mine), attrs(ref));
  assert.equal(/\bplus: '([^']+)'/.exec(readFileSync('ui/public/ask-panel.mjs', 'utf8'))[1], NEW_CHAT_ICON_PATH);
});

test('the composer box keeps the Ask order: lead, chips, input, message, row; send glyph matches', async () => {
  const h = await loaded();
  const refBox = h.doc.querySelector('.ask-composer-box');
  const mine = buildComposer(h.doc, { placeholder: 'x', onInput() {}, onSend() {}, onStop() {} });
  const top = (box) => [...box.children].map((c) => [...c.classList].sort().join(' '));
  assert.deepEqual(top(mine.el.querySelector('.ask-composer-box')), top(refBox));
  const askPanelSrc = readFileSync('ui/public/ask-panel.mjs', 'utf8');
  assert.equal(/\bsend: '([^']+)'/.exec(askPanelSrc)[1], SEND_ICON_PATH);
  for (const cls of ['ask-send', 'ask-stop']) assert.ok(refBox.querySelector(`.${cls}`) && mine.el.querySelector(`.${cls}`), cls);
});

const ASK_SRC = readFileSync('ui/public/ask-panel.mjs', 'utf8');
test('the shared icons are ask-panel.mjs ICONS, path for path', () => {
  for (const k of ['plus', 'chevronDown', 'send']) assert.equal(new RegExp(`\\b${k}: '([^']+)'`).exec(ASK_SRC)[1], ICON[k], k);
});

test('the composer row keeps Ask\'s order and controls, minus voice and Sets, plus the capture button', async () => {
  const h = await loaded();
  const key = (c) => (c.tagName === 'INPUT' ? `input[${c.type}]` : [...c.classList].sort().join(' '));
  const ref = [...h.doc.querySelector('.ask-composer-row').children].filter((c) => !c.matches('.ask-sets-btn, .ask-voice')).map(key);
  const mine = buildComposer(h.doc, { placeholder: 'x', onInput() {}, onSend() {}, onStop() {} });
  const row = mine.el.querySelector('.ask-composer-row');
  assert.deepEqual([...row.children].filter((c) => !c.matches('[data-wx-capture-btn]')).map(key), ref);
  assert.equal(row.querySelector('[data-wx-capture-btn]').previousElementSibling, row.querySelector('[data-ask-attach-btn]'), 'capture sits right after +');
  assert.equal(mine.file.accept, ATTACH_ACCEPT);
  assert.equal(mine.file.accept, h.doc.querySelector('.ask-composer-row input[type=file]').accept);
  // The ring, the model button and the stop glyph match Ask's markup.
  const attrs = (n) => [...n.attributes].map((a) => `${a.name}=${a.value}`).sort();
  for (const sel of ['.ask-ctx-ring svg', '.ask-ctx-ring-track', '.ask-ctx-ring-arc', '.ask-stop svg', '.ask-stop rect', '.ask-send svg', '.ask-model-btn svg']) {
    assert.deepEqual(attrs(row.querySelector(sel)), attrs(h.doc.querySelector(`.ask-composer-row ${sel}`)), sel);
  }
  // Projects, any way P4 (SEAMS S44): Ask's scope pill leads with its scope icon; the extension's pill changes only its words.
  const noLeadIcon = (s) => (s.k.length && s.k[0].t === 'svg' ? { ...s, k: s.k.slice(1) } : s);
  for (const sel of ['[data-ask-meter]', '[data-ask-ctx-btn]', '[data-ask-model-btn]', '[data-ask-scope-btn]', '[data-ask-attach-btn]']) {
    const ask = skeleton(h.doc.querySelector(`.ask-composer-row ${sel}`));
    assert.deepEqual(skeleton(row.querySelector(sel)), sel === '[data-ask-scope-btn]' ? noLeadIcon(ask) : ask, sel);
  }
});

test('the file chip and the drop overlay have Ask\'s skeleton', async () => {
  const h = await loaded();
  const chip = buildFileChip(h.doc, { name: 'shot.png', attKind: 'image', mime: 'image/png', dataBase64: 'iVBORw==' }, () => {});
  assert.deepEqual([...chip.children].map((c) => c.className), ['ask-chip-thumb', 'ask-chip-name', 'ask-chip-x']);
  assert.equal(chip.querySelector('.ask-chip-x').getAttribute('aria-label'), 'Remove shot.png');
  const refDrop = h.doc.querySelector('[data-ask-drop]');
  assert.ok(refDrop, 'the Ask panel rendered its drop overlay');
  assert.deepEqual(skeleton(buildDropOverlay(h.doc)), skeleton(refDrop));
  assert.equal(buildDropOverlay(h.doc).textContent, refDrop.textContent);
});
