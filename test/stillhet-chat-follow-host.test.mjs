// test/stillhet-chat-follow-host.test.mjs — motion.follow-end in the Chat host (jsdom, #1381): a chat within 80px of its
// end before a repaint is at its end after it; scrolled further up it holds its place and Latest shows; opening a chat
// lands on its newest turn; a follow is a scrollTop assignment, never a redraw or an animation. jsdom has no layout, so
// the scroll box's geometry is stubbed; frames are a stubbed requestAnimationFrame (as stillhet-chat-repaint-host).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, clone, THREAD, NOW } from './helpers/stillhet-chat-live-host.mjs';

const iso = (ms) => new Date(ms).toISOString();
/** A thread of `pairs` you/words pairs and a reply being written (its working row). */
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

async function open(t, { thread = threadOf(), hash = '#chat/ask_1', beforeScripts = () => {}, ...o } = {}) {
  const raf = new Map(); let ids = 0;
  const h = await liveHost({ thread: () => [200, clone(thread)], ...o, beforeScripts: (win) => {
    win.requestAnimationFrame = (f) => { raf.set(++ids, f); return ids; };
    win.cancelAnimationFrame = (i) => { raf.delete(i); };
    beforeScripts(win);
  } });
  t.after(() => h.w.close());
  const { w, d } = h;
  // jsdom has no layout: a test's `grow` runs when the turns are patched, as a browser's scrollHeight grows with the patch
  const hooks = { grow: () => {} };
  const orig = w.RailUI.patchKeyed;
  w.RailUI.patchKeyed = (c, items, opt) => { const r = orig(c, items, opt); if (c.matches('#route-chat .convo-col')) hooks.grow(); return r; };
  /** Runs the animation frames asked for so far. */
  const frame = () => { const l = [...raf.values()]; raf.clear(); for (const f of l) f(0); };
  const q = (s) => d.querySelector(`#route-chat ${s}`);
  let seq = 0;
  /** A streamed frame of the reply being written: a tool step lands on its working row (the last turn). */
  const stream = (i) => h.sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'ask-block', threadId: 'ask_1', messageId: 'mS', seq: ++seq, block: { kind: 'tool', id: `tb${i}`, name: `Tool ${i}`, status: 'running' } }) });
  const ready = async (id) => { for (let k = 0; k < 100 && !(w.RailChatLive?.state?.(id) === 'ready' && d.querySelector('#route-chat .convo-col')?.children.length > 3); k++) { frame(); await settle(20); } frame(); };
  await go(w, hash);
  await ready(hash.split('/')[1]);
  return { ...h, frame, q, stream, ready, hooks };
}

/** Scroll geometry on one element: a mutable height, a fixed view and a stored scrollTop. */
function geometry(el, g) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => g.height });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => g.view });
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => g.top, set: (v) => { g.top = v; } });
  return g;
}

test('#1381 at the end, a streamed reply that grows keeps the chat at its end on every frame', async (t) => {
  const h = await open(t);
  const g = geometry(h.q('.convo-scroll'), { height: 2000, view: 400, top: 1600 });
  h.hooks.grow = () => { g.height += 120; };   // more than 80px per frame: the pin is read before the patch, so it still follows
  for (let i = 1; i <= 3; i++) {
    h.stream(i); h.frame();
    assert.equal(g.top, g.height, `frame ${i}: at the end`);
  }
});

test('#1381 80px from the end is the end; 81px holds its place (owner rule)', async (t) => {
  const h = await open(t);
  const g = geometry(h.q('.convo-scroll'), { height: 2000, view: 400, top: 2000 - 400 - 80 });
  h.hooks.grow = () => { g.height += 120; };
  h.stream(1); h.frame();
  assert.equal(g.top, g.height, '80px from the end follows');
  g.top = g.height - 400 - 81;
  const at = g.top;
  h.stream(2); h.frame();
  assert.equal(g.top, at, '81px from the end holds');
});

test('#1381 scrolled up, a growing reply keeps the place and Latest shows', async (t) => {
  const h = await open(t);
  const sc = h.q('.convo-scroll');
  const g = geometry(sc, { height: 2000, view: 400, top: 120 });
  h.hooks.grow = () => { g.height += 120; };
  h.stream(1); h.frame(); h.stream(2); h.frame();
  assert.equal(h.q('.convo-scroll'), sc);
  assert.equal(g.top, 120);
  sc.dispatchEvent(new h.w.Event('scroll'));
  assert.ok(sc.hasAttribute('data-far-below'), 'Latest shows (rail.css: .convo-scroll[data-far-below] .jump-latest)');
  assert.ok(h.q('.convo-dock [data-jump-latest]'));
});

test('#1381 opening a chat lands at its latest turn', async (t) => {
  const tops = new WeakMap();
  const h = await open(t, { beforeScripts: (win) => {
    // a box with its turns drawn is tall; a loading or empty one fits
    Object.defineProperty(win.HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return this.classList.contains('convo-scroll') && this.querySelector('.convo-col')?.children.length > 3 ? 3000 : 0; } });
    Object.defineProperty(win.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
    Object.defineProperty(win.HTMLElement.prototype, 'scrollTop', { configurable: true, get() { return tops.get(this) || 0; }, set(v) { tops.set(this, v); } });
  } });
  assert.equal(h.q('.convo-scroll').scrollTop, 3000, 'the first open lands at the end, not at 0');
  await go(h.w, '#chat/new'); h.frame();
  await go(h.w, '#chat/ask_1');
  await h.ready('ask_1');
  assert.equal(h.q('.convo-scroll').scrollTop, 3000, 'opening it again lands at the end too');
});

test('#1381 a follow is a scroll, never a redraw or an animation', async (t) => {
  const h = await open(t);
  const sc = h.q('.convo-scroll'), first = h.q('[data-anchor="u0"]');
  const g = geometry(sc, { height: 2000, view: 400, top: 1600 });
  const box = h.q('[data-composer-t]');
  box.focus(); box.value = 'half a thought'; box.setSelectionRange(3, 7);
  let moves = 0;
  const spy = () => { moves++; };
  h.w.Element.prototype.scrollTo = spy; h.w.Element.prototype.scrollIntoView = spy; sc.scrollTo = spy; sc.scrollIntoView = spy;
  h.hooks.grow = () => { g.height += 120; };
  h.stream(1); h.frame();
  assert.equal(g.top, g.height, 'it followed');
  assert.equal(h.q('.convo-scroll'), sc, 'the same scroll box');
  assert.equal(h.q('[data-anchor="u0"]'), first, 'the first turn\'s node kept');
  const now = h.q('[data-composer-t]');
  assert.equal(h.d.activeElement, now);
  assert.equal(now.value, 'half a thought');
  assert.deepEqual([now.selectionStart, now.selectionEnd], [3, 7]);
  assert.equal(moves, 0, 'no scrollTo or scrollIntoView');
});
