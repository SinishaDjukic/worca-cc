// test/stillhet-keep-open-task-chat-host.test.mjs — comp.keep-open on the task page and in Chat (B2.6): Move to group…
// (F-a4-10), the tag editor, the terminal input, the Chat Label menu (F-a2-06) and a chat card's form field (F-a4-02) keep
// what you typed, its caret and its focus through a live redraw; a route change closes the menu; Pulse's holdFocus leaves
// a kept field alone. The host is test/helpers/stillhet-chat-live-host.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES, menuPick } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const card = (d) => d.querySelector('#card');
/** Types `text` as a person does, the caret left at 1. */
const type = (w, el, text) => { el.focus(); el.value = text; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.setSelectionRange(1, 1); };
/** Asserts `sel` kept its text, caret and focus through `redraw`, whether the redraw rebuilt it (a full paint) or patched it in place (morph, patchKeyed). */
async function keeps(h, sel, redraw) {
  const before = h.d.querySelector(sel);
  assert.ok(before, `${sel} is open`);
  assert.ok(before.hasAttribute('data-keep'), `${sel} is marked data-keep`);
  type(h.w, before, 'abc');
  const typed = h.d.querySelector(sel);   // a page may paint on the keystroke itself (the Label menu filters as you type)
  typed.setSelectionRange(1, 1);
  await redraw(); await settle(0);
  const after = h.d.querySelector(sel);
  assert.ok(after, `${sel} is still open`);
  assert.equal(after.value, 'abc');
  assert.deepEqual([after.selectionStart, after.selectionEnd], [1, 1]);
  assert.equal(h.d.activeElement, after);
}
async function taskPage() {
  const s = clone(SOURCES); for (const p of s.history.pipelines) p.projectKey = 'web-1';
  const h = await liveHost({ sources: s });
  await go(h.w, '#run/run-a', 200); await settle(400);
  return h;
}
/** The task page's live redraw: what RailTaskLive.onChange does for a frame about this task. */
const liveRedraw = (h) => () => h.w.RailRunPage.openLive('run-a', true);
const openGroups = async (h) => { card(h.d).querySelector('[data-menu="more"]').click(); await settle(20); card(h.d).querySelector('[data-menu-pick="more:group"]').click(); await settle(20); };
async function chat() {
  const h = await liveHost({ sources: clone(SOURCES) });
  await go(h.w, '#chat/ask_1', 200);
  return h;
}
const chatPaint = (h) => () => { h.w.RailConversation.refresh(); h.w.RailConversation.flushPaints(); };

test('F-a4-10: Move to group…\'s #group-input keeps its value, caret and focus through a live redraw', async () => {
  const h = await taskPage();
  await openGroups(h);
  await keeps(h, '#card #group-input', liveRedraw(h));
});

test('F-a4-02: the tag editor\'s #tag-input keeps its text through a live redraw', async () => {
  const h = await taskPage();
  card(h.d).querySelector('[data-tagzone]').click(); await settle(20);
  await keeps(h, '#card #tag-input', liveRedraw(h));
});

test('F-a4-02: the tag editor is empty after Enter adds a label', async () => {
  const h = await taskPage();
  card(h.d).querySelector('[data-tagzone]').click(); await settle(20);
  const input = h.d.querySelector('#card #tag-input');
  type(h.w, input, 'bugfix');
  input.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await settle(40);
  const after = h.d.querySelector('#card #tag-input');
  assert.ok(after, 'the editor stays open for the next one');
  assert.equal(after.value, '');
});

test('F-a4-02: the terminal input keeps its text through a frame of the shell', async () => {
  const h = await taskPage();
  let frame = () => {};
  const session = { closed: false, lines: [], tip: '', onChange: (fn) => { frame = fn; }, send() {}, stop: async () => ({ ok: true }), close() {} };
  h.w.RailTaskLive.act = async () => ({ ok: true, session: 's1' });
  h.w.RailChatLive.terminal = async () => session;
  const pick = h.d.createElement('button'); pick.dataset.menuPick = 'more:terminal'; card(h.d).append(pick); pick.click(); await settle(40);
  await keeps(h, '[data-term-input]', () => { session.lines.push({ t: '', text: 'a line' }); frame(); });
});

test('F-a2-06: the Chat Label menu\'s #cl-label-q keeps its text and focus through a chat paint', async () => {
  const h = await chat();
  h.d.querySelector('#route-chat [data-menu="cl-label"]').click(); await settle(30);
  await keeps(h, '#route-chat #cl-label-q', chatPaint(h));
});

test('F-a4-02: a chat card\'s form field (Label…) keeps its text through a chat paint', async () => {
  const h = await chat();
  await menuPick(h.d, 'card:run-a', 'Label…');
  await keeps(h, '#route-chat [data-cf-field]', chatPaint(h));
});

test('a side panel is not a route change: a chat card\'s form field keeps its text when the run panel opens', async () => {
  const h = await chat();
  await menuPick(h.d, 'card:run-a', 'Label…');
  const f = h.d.querySelector('#route-chat [data-cf-field]');
  type(h.w, f, 'abc');
  h.w.location.hash = '#chat/ask_1/run/run-a/logs'; await settle(200);
  chatPaint(h)(); await settle(0);
  const after = h.d.querySelector('#route-chat [data-cf-field]');
  assert.ok(after, 'the form is still open');
  assert.equal(after.value, 'abc');
});

test('route change closes Move to group… and the Label menu: back on the page, both are closed', async () => {
  const h = await taskPage();
  await openGroups(h);
  type(h.w, h.d.querySelector('#group-input'), 'abc');
  await go(h.w, '#chat/ask_1', 200);
  h.d.querySelector('#route-chat [data-menu="cl-label"]').click(); await settle(30);
  type(h.w, h.d.querySelector('#cl-label-q'), 'abc');
  await go(h.w, '#run/run-a', 200); await settle(200);
  assert.equal(h.d.querySelector('#group-input'), null, 'Move to group… closed');
  await go(h.w, '#chat/ask_1', 200);
  assert.equal(h.d.querySelector('#cl-label-q'), null, 'the Label menu closed');
});

test('pulse: holdFocus leaves a focused kept field alone during a render()', async () => {
  const h = await chat();
  h.d.querySelector('#route-chat [data-menu="cl-label"]').click(); await settle(30);
  const q = h.d.querySelector('#cl-label-q');
  type(h.w, q, 'abc');
  h.w.dispatchEvent(new h.w.Event('rail-settings'));   // Pulse's render(), through holdFocus
  await settle(0);
  const now = h.d.querySelector('#cl-label-q');
  assert.equal(h.d.activeElement, now, 'the focus stays in the kept field');
  assert.equal(now.value, 'abc');
});
