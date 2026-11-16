// test/stillhet-chat-repaint-host.test.mjs — comp.live-paint and comp.keyed-patch in the Chat host (jsdom): a live frame
// paints only what changed, once per animation frame, never while Chat is hidden; the thinking orb keeps its canvas; the
// composer, focus and scroll stay put; a run's done frame shows on its card before any read. Frames are a stubbed
// requestAnimationFrame; paints are counted by wrapping window.RailUI.patchKeyed (conversation.js calls it through R).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, clone, THREAD, NOW, SOURCES, withRun } from './helpers/stillhet-chat-live-host.mjs';

const iso = (ms) => new Date(ms).toISOString();
/** A thread of `pairs` you/words pairs and a reply being written (its working row): 2 × pairs + 1 turns. */
function threadOf({ pairs = 52, streaming = true, base = THREAD } = {}) {
  const th = clone(base);
  th.messages = [];
  for (let i = 0; i < pairs; i++) {
    th.messages.push({ id: `u${i}`, role: 'user', text: `Question ${i}`, status: 'done', createdAt: iso(NOW - 3600e3 + i * 2000), blocks: [] });
    th.messages.push({ id: `a${i}`, role: 'assistant', text: `Answer ${i}`, status: 'done', createdAt: iso(NOW - 3600e3 + i * 2000 + 1000), blocks: [] });
  }
  if (streaming) th.messages.push({ id: 'mS', role: 'assistant', text: '', status: 'streaming', createdAt: iso(NOW - 100), blocks: [] });
  th.runLinks = []; th.inFlight = streaming ? { messageId: 'mS' } : null;
  return th;
}

async function open(t, { thread = threadOf(), hash = '#chat/ask_1', ...o } = {}) {
  const raf = new Map(); let ids = 0;
  const h = await liveHost({ thread: () => [200, clone(thread)], ...o, beforeScripts: (win) => {
    win.requestAnimationFrame = (f) => { raf.set(++ids, f); return ids; };
    win.cancelAnimationFrame = (i) => { raf.delete(i); };
  } });
  t.after(() => h.w.close());
  const { w, d } = h;
  const paints = [];
  const orig = w.RailUI.patchKeyed;
  w.RailUI.patchKeyed = (c, items, opt) => { const r = orig(c, items, opt); paints.push({ c, r }); return r; };
  /** Runs the animation frames asked for so far. */
  const frame = () => { const l = [...raf.values()]; raf.clear(); for (const f of l) f(0); };
  const pending = () => raf.size;
  const q = (s) => d.querySelector(`#route-chat ${s}`);
  const colPaints = () => paints.filter((p) => p.c.matches('#route-chat .convo-col'));
  let seq = 0;
  /** A streamed frame of the reply being written: a tool step lands, which changes its working row (the last turn). */
  const stream = (i) => h.sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'ask-block', threadId: 'ask_1', messageId: 'mS', seq: ++seq, block: { kind: 'tool', id: `tb${i}`, name: `Tool ${i}`, status: 'running' } }) });
  const send = (f) => h.sockets.at(-1).onmessage({ data: JSON.stringify(f) });
  await go(w, hash);
  const id = hash.split('/')[1];   // the thread's first read has landed and is drawn (a slow machine takes longer than one settle)
  for (let k = 0; k < 100 && !(w.RailChatLive?.state?.(id) === 'ready' && d.querySelector('#route-chat .convo-col')?.children.length > 3); k++) { frame(); await settle(20); }
  frame();
  return { ...h, paints, frame, pending, q, colPaints, stream, send };
}
const observe = (w, el) => { const recs = []; const mo = new w.MutationObserver((l) => recs.push(...l)); mo.observe(el, { childList: true, characterData: true, attributes: true, subtree: true }); return { recs, flush: () => { recs.push(...mo.takeRecords()); mo.disconnect(); return recs; } }; };

test('a hidden Chat records 0 mutations for a world move, a streamed frame and 2 thinking ticks; showing it paints once with current content', async (t) => {
  const h = await open(t);
  await go(h.w, '#tasks'); h.frame();
  const route = h.d.getElementById('route-chat');
  assert.equal(route.hidden, true);
  const n = h.colPaints().length;
  const mo = observe(h.w, route);
  h.w.RailWorld.setState({});
  h.send({ type: 'state', runId: 'run-b', status: 'running' });
  h.stream(1);
  h.frame();
  await settle(560);   // 2 ticks of the 250 ms thinking clock
  h.send({ type: 'ask-done', threadId: 'ask_1', messageId: 'mS', seq: 2, text: 'The final answer.', status: 'done' });
  await settle(400);   // its reads (threads, run links, spend) land while Chat is hidden
  h.frame();
  assert.deepEqual(mo.flush().length, 0, 'nothing written while hidden');
  assert.equal(h.colPaints().length, n);
  await go(h.w, '#chat/ask_1');
  assert.equal(h.colPaints().length, n + 1, 'one paint when shown (opening it then clears its dot: a store load, drawn at the next frame)');
  assert.match(h.q('.convo-col').textContent, /The final answer\./, 'with the frames it missed');
  assert.equal(h.q('[data-think-at]'), null);
});

test('the Ask worca side panel paints on open what changed while it was closed', async (t) => {
  const h = await open(t);
  await go(h.w, '#tasks'); h.frame();
  h.d.getElementById('topnav-ask').click(); h.frame();
  await settle(350);   // the shell's opening class comes off
  h.d.querySelector('[data-ask-close]').click(); h.frame();
  const side = h.d.getElementById('ask-side');
  assert.equal(side.hidden, true);
  const mo = observe(h.w, h.d.getElementById('ask-convo'));
  h.send({ type: 'state', runId: 'run-b', status: 'running' }); h.w.RailWorld.setState({});
  h.frame(); await settle(30); h.frame();
  assert.equal(mo.flush().length, 0, 'closed: nothing painted');
  const shown = observe(h.w, h.d.getElementById('ask-convo'));
  h.d.getElementById('topnav-ask').click();
  assert.equal(side.hidden, false);
  assert.ok(shown.flush().some((r) => r.type === 'childList'), 'painted on open');
});

test('5 streamed frames in one animation frame give 1 paint, and flushPaints runs it at once', async (t) => {
  const h = await open(t);
  const n = h.colPaints().length;
  for (let i = 1; i <= 5; i++) h.stream(i);
  assert.equal(h.colPaints().length, n, 'nothing painted before the frame');
  assert.equal(h.pending() >= 1, true);
  h.frame();
  assert.equal(h.colPaints().length, n + 1);
  h.stream(6);
  h.w.RailConversation.flushPaints();
  assert.equal(h.colPaints().length, n + 2, 'flushPaints paints the pending frame now');
  h.frame();
  assert.equal(h.colPaints().length, n + 2, 'and its frame does nothing more');
});

test('on a 105-turn chat a frame that changes the last turn replaces at most 1 and keeps the first turn\'s node', async (t) => {
  const h = await open(t);
  const first = h.q('[data-anchor="u0"]');
  assert.ok(first, 'the first turn is drawn');
  assert.ok(h.q('[data-think-at]'), 'the reply being written is the last turn');
  h.stream(1); h.frame();
  const p = h.colPaints().at(-1).r;
  assert.ok(p.replaced <= 1, `replaced ${p.replaced}`);
  assert.equal(p.added + p.removed, 0);
  assert.ok(p.kept >= 104, `kept ${p.kept}`);
  assert.equal(h.q('[data-anchor="u0"]'), first, 'the same node');
});

test('on a 105-turn chat a streamed frame builds no unchanged turn\'s string again; a change to one still draws it', async (t) => {
  const h = await open(t);
  let you = 0;
  const orig = h.w.RailUI.youTurn;
  h.w.RailUI.youTurn = (o) => { you++; return orig(o); };
  h.stream(1); h.frame();
  assert.equal(you, 0, 'the 52 you turns are not built again');
  h.w.RailWorld.setState({}); h.frame();
  assert.equal(you, 0);
  h.q('[data-anchor="u3"]').click();   // panel.turn-time: a tap shows its time (its class only, no paint)
  h.w.RailWorld.setState({}); h.frame();
  assert.equal(you, 1, 'only the turn whose drawing changed is built again');
  assert.ok(h.q('[data-anchor="u3"]').classList.contains('is-time-shown'));
});

test('the thinking orb\'s canvas is the same node across 3 frames and its data-orb follows the phase', async (t) => {
  const h = await open(t);
  const cv = h.q('[data-think-at] canvas[data-orb]');
  assert.ok(cv);
  assert.equal(cv.dataset.orb, 'think');
  const phases = [];
  for (const [i, at] of [[1, 700], [2, 1300], [3, 1900]]) {   // its steps move on with the time: Thinking, Searching (a tool), Writing
    h.w.Date.now = () => NOW + at;
    h.w.RailWorld.setState({}); h.frame();
    const now = h.q('[data-think-at] canvas[data-orb]');
    assert.equal(now, cv, `frame ${i}: the same canvas`);
    phases.push(now.dataset.orb);
  }
  assert.deepEqual(phases, ['think', 'tool', 'write']);
});

test('the composer keeps its text, caret and focus during a streamed frame and across a busy flip', async (t) => {
  const h = await open(t);
  const box = h.q('[data-composer-t]');
  box.focus(); box.value = 'half a thought'; box.setSelectionRange(3, 3);   // the caret mid-text, not at the end
  h.stream(1); h.frame();
  let now = h.q('[data-composer-t]');
  assert.equal(h.d.activeElement, now, 'the box keeps the focus');
  assert.equal(now.value, 'half a thought');
  assert.deepEqual([now.selectionStart, now.selectionEnd], [3, 3], 'a streamed frame leaves the caret where it was put');
  const kept = now;
  kept.setSelectionRange(5, 9);   // a selection, too
  h.stream(2); h.frame();
  assert.equal(h.q('[data-composer-t]'), kept, 'a frame that does not change the box keeps its node');
  assert.deepEqual([kept.selectionStart, kept.selectionEnd], [5, 9], 'the selection survives a frame');
  h.send({ type: 'ask-done', threadId: 'ask_1', messageId: 'mS', seq: 3, text: 'Done.', status: 'done' }); h.frame();
  now = h.q('[data-composer-t]');
  assert.notEqual(now, kept, 'the busy flip redraws the box');
  assert.equal(h.d.activeElement, now, 'focus back in the box');
  assert.equal(now.value, 'half a thought');
  assert.deepEqual([now.selectionStart, now.selectionEnd], [5, 9], 'a redrawn box gets the selection back');
});

test('a reader scrolled up keeps the same scrollTop across streamed frames', async (t) => {
  const h = await open(t);
  const sc = h.q('.convo-scroll');
  let top = 120;
  Object.defineProperty(sc, 'scrollTop', { configurable: true, get: () => top, set: (v) => { top = v; } });
  Object.defineProperty(sc, 'scrollHeight', { configurable: true, get: () => 2000 });   // real geometry: jsdom's 0 heights read as at the end (motion.follow-end)
  Object.defineProperty(sc, 'clientHeight', { configurable: true, get: () => 400 });
  h.stream(1); h.frame(); h.stream(2); h.frame();
  assert.equal(h.q('.convo-scroll'), sc);
  assert.equal(top, 120);
});

test('a patched thread serialises like a full redraw of the same state (the frame built again, nothing kept)', async (t) => {
  const h = await open(t, { thread: threadOf({ pairs: 6, streaming: false }) });
  h.send({ type: 'state', runId: 'run-b', status: 'running' }); h.frame();
  h.w.RailWorld.setState({}); h.frame();
  const patched = h.d.getElementById('route-chat').innerHTML;
  assert.ok(h.colPaints().length >= 2, 'patched at least once after the first paint');
  const route = h.d.getElementById('route-chat');
  route.replaceChildren();   // the root no longer holds the frame: the next paint builds it, and every turn, from nothing
  const n = h.colPaints().length;
  h.w.RailWorld.setState({}); h.frame();
  assert.equal(h.colPaints().at(-1).r.kept, 0, 'a full redraw');
  assert.equal(h.colPaints().length, n + 1);
  assert.equal(route.innerHTML, patched);
});

test('a click paints at once and drops the pending frame', async (t) => {
  const h = await open(t, { thread: threadOf({ pairs: 3, streaming: true }) });
  h.stream(1);
  const n = h.colPaints().length;
  h.q('[data-anchor-open]').click();
  assert.equal(h.colPaints().length, n + 1, 'painted at once');
  assert.ok(h.q('[data-anchor-menu] .menu, [data-anchor-menu] [role="menu"]'), 'the menu is drawn in the head');
  assert.match(h.q('[data-think-at]').textContent, /Tool 1/, 'with the pending frame in it');
  h.frame();
  assert.equal(h.colPaints().length, n + 1, 'the pending frame paints nothing more');
});

test('a busy control is enabled again after busy clears on a kept turn', async (t) => {
  let release;
  const held = new Promise((r) => { release = r; });
  const base = clone(THREAD);
  const h = await open(t, { thread: { ...base, inFlight: null }, sources: withRun({ pendingQuestion: null }), write: async () => { await held; return [200, {}]; } });
  const sel = '[data-anchor="card_run"] [data-card-act$="|Pause"]';
  const btn = h.q(sel);
  assert.ok(btn, 'the card offers Pause');
  btn.click();
  assert.equal(h.q(sel).disabled, true, 'disabled while its action is out');
  h.w.RailWorld.setState({}); h.frame();
  assert.equal(h.q(sel).disabled, true, 'still, across a paint');
  release(); await settle(30); h.frame();
  assert.equal(h.q(sel).disabled, false, 'enabled once answered');
});

test('switching chats builds the frame again', async (t) => {
  const h = await open(t, { thread: threadOf({ pairs: 2, streaming: false }) });
  const convo = h.q('.convo');
  h.w.RailWorld.setState({}); h.frame();
  assert.equal(h.q('.convo'), convo, 'a live frame keeps the frame');
  await go(h.w, '#chat/ask_2'); h.frame(); await settle(20); h.frame();
  assert.notEqual(h.q('.convo'), convo);
});

test('a done frame turns the chat card\'s state mark to done before any read returns, and a following run-links load keeps it', async (t) => {
  let block = false;
  const gate = new Promise(() => {});
  const h = await open(t, { thread: { ...clone(THREAD), inFlight: null }, sources: withRun({ pendingQuestion: null }), hold: (u) => (block && u !== '/api/ask/run-links' ? gate : null) });
  const mark = () => h.q('[data-anchor="card_run"] .tp-kicker .kind-mark');
  assert.ok(mark());
  assert.notEqual(mark().getAttribute('aria-label'), 'Finished · Finished');
  block = true;
  h.send({ type: 'done', runId: 'run-a', seq: 99, status: 'done' });
  h.w.RailConversation.flushPaints();
  assert.equal(mark().getAttribute('aria-label'), 'Finished · Finished', 'done on its own frame');
  h.send({ type: 'ask-run-status', threadId: 'ask_1', runId: 'run-a' });
  await settle(400); h.frame();
  assert.equal(mark().getAttribute('aria-label'), 'Finished · Finished', 'the run-links load keeps it');
});
