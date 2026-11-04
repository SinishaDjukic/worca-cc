// test/ui-away-screensaver.test.mjs — the away screensaver easter egg (ui/public/away-screensaver.mjs): it shows only
// while Away mode, Keep awake, a focused window and 5 idle minutes all hold; the most pressing run or chat state
// picks its line; and the input that wakes the window never reaches the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  AWAY_SCREENSAVER, IDLE_MS, shouldShow, pickScene, createChatTracker, createAwayScreensaver,
} from '../ui/public/away-screensaver.mjs';

const ON = { away: true, keepAwake: true, focused: true, idleMs: IDLE_MS };

test('the easter egg is on by design, after 5 idle minutes', () => {
  assert.equal(AWAY_SCREENSAVER, true);
  assert.equal(IDLE_MS, 5 * 60 * 1000);
});

test('shouldShow needs away, keep awake, a focused window and the idle time, all at once', () => {
  assert.equal(shouldShow(ON), true);
  for (const k of ['away', 'keepAwake', 'focused']) assert.equal(shouldShow({ ...ON, [k]: false }), false, k);
  assert.equal(shouldShow({ ...ON, idleMs: IDLE_MS - 1 }), false);
  assert.equal(shouldShow({ ...ON, enabled: false }), false);
});

test('pickScene: a question wins over everything, and names the run, not its id', () => {
  const v = pickScene({ running: 2, questions: 1, askTitle: 'Fix login', failed: 1, done: 3, chatUnread: true });
  assert.equal(v.scene, 'ask');
  assert.equal(v.headline, 'We could use you for a moment.');
  assert.equal(v.bubble, 'When you have a moment, “Fix login” has a question');
  assert.deepEqual(v.items.map((i) => i.text), ['2 running', '1 has a question', '1 needs a look', 'New chat reply', '3 done']);
});

test('pickScene: a chat proposal asks too', () => {
  const v = pickScene({ chatProposals: 2 });
  assert.equal(v.scene, 'ask');
  assert.equal(v.bubble, 'When you have a moment, a chat has a proposal for you');
  assert.deepEqual(v.items.map((i) => i.text), ['2 chat proposals to review']);
});

test('pickScene: failed, then a chat reply, then work, then done, then quiet', () => {
  assert.equal(pickScene({ failed: 1, running: 1 }).headline, 'One run would like a look, no rush.');
  assert.equal(pickScene({ failed: 2 }).headline, '2 runs would like a look, no rush.');
  assert.equal(pickScene({ chatUnread: true, running: 1 }).scene, 'reply');
  assert.equal(pickScene({ running: 1 }).headline, 'Everything is under control.');
  assert.equal(pickScene({ chatsReplying: 1 }).scene, 'busy');
  assert.equal(pickScene({ paused: 1 }).scene, 'busy');
  assert.equal(pickScene({ done: 4 }).headline, 'All done. Nothing needs you right now.');
  assert.equal(pickScene({}).headline, 'All quiet. Enjoy the break.');
});

test('pickScene: items use the shared status dots', () => {
  const dots = pickScene({ running: 1, questions: 1, failed: 1, paused: 1, chatsReplying: 1, done: 1 }).items.map((i) => i.model.dot);
  assert.deepEqual(dots, ['peach', 'amber', 'red', 'grey', 'green', 'green']);
});

test('the chat tracker counts replying turns and cards waiting for an OK', () => {
  const t = createChatTracker();
  t.onFrame({ type: 'ask-start', threadId: 'ask_1' });
  t.onFrame({ type: 'ask-start', threadId: 'ask_2' });
  t.onFrame({ type: 'ask-card', threadId: 'ask_1', block: { kind: 'card', id: 'b1', state: 'building' } });
  assert.deepEqual(t.counts(), { chatsReplying: 2, chatProposals: 0 });
  t.onFrame({ type: 'ask-card', threadId: 'ask_1', block: { kind: 'card', id: 'b1', state: 'proposed' } });
  t.onFrame({ type: 'ask-done', threadId: 'ask_1' });
  t.onFrame({ type: 'ask-error', threadId: 'ask_2' });
  assert.deepEqual(t.counts(), { chatsReplying: 0, chatProposals: 1 });
  t.onFrame({ type: 'ask-message', threadId: 'ask_1', message: { blocks: [{ kind: 'card', id: 'b1', state: 'approved' }] } });
  assert.deepEqual(t.counts(), { chatsReplying: 0, chatProposals: 0 });
});

function setup(state = {}) {
  const dom = new JSDOM('<!doctype html><body><button id="under">under</button></body>', { url: 'http://localhost:4317/', pretendToBeVisual: true });
  const { window: win } = dom;
  win.HTMLCanvasElement.prototype.getContext = () => null;   // jsdom has no canvas; the network just does not draw
  const doc = win.document;
  let focused = true;
  doc.hasFocus = () => focused;
  let clock = 1_000_000;
  const st = { away: true, keepAwake: true, runs: { running: 1 }, ...state };
  const ss = createAwayScreensaver({ doc, win, getState: () => st, now: () => clock });
  return {
    win, doc, ss, st,
    wait: (ms) => { clock += ms; ss.tick(); },
    blur: () => { focused = false; },
    done: () => { ss.stop(); win.close(); },
  };
}

test('it shows after 5 idle minutes and says what is going on', () => {
  const s = setup({ runs: { running: 2, done: 1 } });
  s.wait(IDLE_MS - 1000);
  assert.equal(s.ss.isShown(), false);
  s.wait(1000);
  assert.equal(s.ss.isShown(), true);
  const root = s.doc.querySelector('.ss');
  assert.equal(root.dataset.scene, 'busy');
  assert.deepEqual([...root.querySelectorAll('.ss-items li')].map((li) => li.textContent), ['2 running', '1 done']);
  assert.equal(root.querySelector('.ss-bubble').classList.contains('is-on'), false);
  s.done();
});

test('it stays away when Away mode, Keep awake or the window focus is missing', () => {
  for (const off of [{ away: false }, { keepAwake: false }]) {
    const s = setup(off);
    s.wait(IDLE_MS);
    assert.equal(s.ss.isShown(), false, JSON.stringify(off));
    s.done();
  }
  const s = setup();
  s.blur();
  s.wait(IDLE_MS);
  assert.equal(s.ss.isShown(), false);
  s.done();
});

test('it hides when a condition ends, and when the window loses focus', () => {
  const s = setup();
  s.wait(IDLE_MS);
  s.st.away = false;
  s.wait(1000);
  assert.equal(s.ss.isShown(), false);
  s.st.away = true;
  s.wait(1000);
  assert.equal(s.ss.isShown(), true, 'still idle, so it comes back');
  s.blur();
  s.wait(1000);
  assert.equal(s.ss.isShown(), false);
  s.done();
});

test('the click that wakes the window does not reach the page', () => {
  const s = setup();
  s.wait(IDLE_MS);
  let clicks = 0;
  s.doc.getElementById('under').addEventListener('click', () => { clicks++; });
  const down = new s.win.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  s.doc.querySelector('.ss').dispatchEvent(down);
  assert.equal(s.ss.isShown(), false);
  assert.equal(down.defaultPrevented, true);
  s.doc.getElementById('under').dispatchEvent(new s.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(clicks, 0, 'the rest of the gesture is swallowed');
  s.done();
});

test('a key hides it without typing, and input restarts the idle clock', () => {
  const s = setup();
  s.wait(IDLE_MS);
  const key = new s.win.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
  s.doc.body.dispatchEvent(key);
  assert.equal(key.defaultPrevented, true);
  assert.equal(s.ss.isShown(), false);
  s.wait(IDLE_MS - 1000);
  assert.equal(s.ss.isShown(), false);
  s.doc.body.dispatchEvent(new s.win.MouseEvent('pointermove', { bubbles: true }));
  s.wait(IDLE_MS - 1000);
  assert.equal(s.ss.isShown(), false, 'a mouse move restarts the 5 minutes');
  s.done();
});

test('a pointermove without movement (Safari, when the page under a still cursor changes) is not input', () => {
  const s = setup();
  const move = (x, y) => s.doc.body.dispatchEvent(new s.win.MouseEvent('pointermove', { bubbles: true, screenX: x, screenY: y }));
  move(100, 100);
  s.wait(IDLE_MS);
  assert.equal(s.ss.isShown(), true);
  move(100, 100);
  move(101, 101);
  assert.equal(s.ss.isShown(), true, 'a still or 1px pointer keeps it on');
  s.wait(IDLE_MS);
  assert.equal(s.ss.isShown(), true, 'nor does it restart the idle clock');
  move(140, 120);
  assert.equal(s.ss.isShown(), false, 'a real move wakes the window');
  s.done();
});

test('a question shows the bubble; chat frames count', () => {
  const s = setup({ runs: {} });
  s.ss.onAskFrame({ type: 'ask-card', threadId: 'ask_1', block: { kind: 'card', id: 'b1', state: 'proposed' } });
  s.wait(IDLE_MS);
  const root = s.doc.querySelector('.ss');
  assert.equal(root.dataset.scene, 'ask');
  assert.equal(root.querySelector('.ss-bubble').classList.contains('is-on'), true);
  assert.match(root.querySelector('.ss-bubble-tx').textContent, /a chat has a proposal for you/);
  s.done();
});
