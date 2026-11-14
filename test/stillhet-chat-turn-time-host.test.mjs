// test/stillhet-chat-turn-time-host.test.mjs — panel.turn-time in the Chat host (jsdom): every you and words turn carries its
// time from dev's createdAt, revealed by hover, focus or a tap with only a class (nothing moves), kept across a live repaint;
// a local echo shows no time until its row lands. Window.Date.now is the fixture's NOW (Nov 12, 15:00, local), so the
// times read the same on any real date and in any time zone. jsdom has no layout: the no-shift proof in px is the slice's
// browser measure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, clone, THREAD } from './helpers/stillhet-chat-live-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

const today = (h, m) => new Date(2026, 10, 12, h, m).toISOString();
const MSGS = [
  { id: 'u1', role: 'user', text: 'Add a CSV export', status: 'done', createdAt: today(13, 0), blocks: [] },
  { id: 'a1', role: 'assistant', text: 'I will add it.', status: 'done', createdAt: today(13, 0), blocks: [] },
  { id: 'u2', role: 'user', text: 'And the totals?', status: 'done', createdAt: today(13, 0), blocks: [] },
  { id: 'a2', role: 'assistant', text: 'They match.', status: 'done', createdAt: today(13, 0), blocks: [] },
];
const threadOf = (messages = MSGS) => { const th = clone(THREAD); th.messages = clone(messages); th.runLinks = []; th.inFlight = null; return () => [200, th]; };
async function open(t, o = {}) {
  const h = await liveHost({ thread: threadOf(o.messages), ...o });
  t.after(() => h.w.close());
  await go(h.w, '#chat/ask_1');
  return { ...h, q: (s) => h.d.querySelector(`#route-chat ${s}`), qa: (s) => [...h.d.querySelectorAll(`#route-chat ${s}`)] };
}
const frame = (h, message) => { h.sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'ask-message', threadId: 'ask_1', message }) }); return settle(40); };
const bare = (el) => el.outerHTML.replace(/ class="[^"]*"/g, '');

test('a live you turn and a live words turn each show their time from createdAt', async (t) => {
  const { q } = await open(t);
  for (const sel of ['.convo-you', '.convo-words']) {
    const time = q(`${sel} time.turn-time`);
    assert.ok(time, sel);
    assert.equal(time.textContent, '13:00');
    assert.equal(time.getAttribute('datetime'), new Date(today(13, 0)).toISOString());
  }
});

test('a message from yesterday reads Yesterday and its time', async (t) => {
  const { q } = await open(t, { messages: [{ ...MSGS[0], createdAt: new Date(2026, 10, 11, 9, 5).toISOString() }] });
  assert.equal(q('.convo-you time.turn-time').textContent, 'Yesterday 09:05');
});

test('both turn kinds take the focus, and a focused turn matches :focus-within', async (t) => {
  const { q } = await open(t);
  for (const sel of ['.convo-you', '.convo-words']) {
    const el = q(sel);
    assert.equal(el.getAttribute('tabindex'), '0', sel);
    el.focus();
    assert.ok(el.matches(':focus-within'), sel);
  }
  assert.equal(q('.convo-words').hasAttribute('data-anchor'), false, 'a words turn is no timeline anchor');
  assert.equal([...q('.convo-words').attributes].find((a) => a.name.startsWith('data-')).name, 'data-words-turn');
  assert.equal(q('.convo-words').dataset.wordsTurn, 'a1:0', 'keyed by its message');
});

test('a tap on a turn shows its time on that turn only; another turn takes it; a tap outside any turn hides it', async (t) => {
  const { q, qa } = await open(t);
  q('.convo-you').click(); await settle(5);
  assert.deepEqual(qa('.is-time-shown').map((e) => e.dataset.anchor), ['u1']);
  q('.convo-words').click(); await settle(5);
  assert.deepEqual(qa('.is-time-shown').map((e) => e.dataset.wordsTurn), ['a1:0']);
  q('.convo-words').click(); await settle(5);
  assert.equal(qa('.is-time-shown').length, 0, 'a second tap on the same turn hides it');
  q('.convo-you').click(); await settle(5);
  q('.convo-scroll').click(); await settle(5);
  assert.equal(qa('.is-time-shown').length, 0);
});

test('a tap on a ref chip inside a you turn does not show its time (demo)', async (t) => {
  const w = stillhetHost({ hash: '#chat/c14', after: (fn) => t.after(fn) });
  await settle(40);
  const chip = w.document.querySelector('#route-chat .convo-you .you-ref');
  assert.ok(chip, 'c14 names a task in what you said');
  chip.click(); await settle(5);
  assert.equal(w.document.querySelectorAll('#route-chat .is-time-shown').length, 0);
});

test('a click that ends a text selection does not toggle the time', async (t) => {
  const { w, q, qa } = await open(t);
  w.getSelection = () => ({ toString: () => 'Add a' });
  q('.convo-you').click(); await settle(5);
  assert.equal(qa('.is-time-shown').length, 0);
});

test('the reveal adds only a class: the same children and markup (I1)', async (t) => {
  const { q } = await open(t);
  for (const [sel, key] of [['.convo-you', '[data-anchor="u1"]'], ['.convo-words', '[data-words-turn="a1:0"]']]) {
    const was = q(key), n = was.childElementCount, html = bare(was);
    q(key).click(); await settle(5);
    const now = q(key);
    assert.ok(now.classList.contains('is-time-shown'), sel);
    assert.equal(now.childElementCount, n, sel);
    assert.equal(bare(now), html, sel);
  }
});

test('a shown time stays on its turn after a live frame repaints the thread', async (t) => {
  const h = await open(t);
  h.q('[data-words-turn="a2:0"]').click(); await settle(5);
  await frame(h, { id: 'a3', role: 'assistant', text: 'One more thing.', status: 'done', createdAt: today(14, 0), blocks: [] });
  assert.ok(h.q('[data-words-turn="a3:0"]'), 'the frame was drawn');
  assert.deepEqual(h.qa('.is-time-shown').map((e) => e.dataset.wordsTurn), ['a2:0']);
});

test('a local echo shows no time; once dev\'s row lands it does (I2)', async (t) => {
  const h = await open(t, { write: (url) => (url.endsWith('/messages') ? [202, { userMessageId: 'u9' }] : [200, {}]) });
  h.q('[data-composer-t]').value = 'Hello';
  h.q('[data-cp-send]').click(); await settle(80);
  const echo = h.qa('.convo-you').find((e) => e.textContent.includes('Hello'));
  assert.ok(echo, 'the echo is drawn');
  assert.equal(echo.querySelector('time.turn-time'), null);
  await frame(h, { id: 'u9', role: 'user', text: 'Hello', status: 'done', createdAt: today(14, 30), blocks: [] });
  const row = h.qa('.convo-you').find((e) => e.textContent.includes('Hello'));
  assert.equal(row.querySelector('time.turn-time')?.textContent, '14:30');
});

test('a focused words turn and a focused you turn keep the focus across a live repaint (I5)', async (t) => {
  const h = await open(t);
  let n = 3;
  for (const key of ['[data-words-turn="a1:0"]', '[data-anchor="u2"]']) {
    h.q(key).focus();
    await frame(h, { id: `a${++n}`, role: 'assistant', text: `Frame ${n}.`, status: 'done', createdAt: today(14, 0), blocks: [] });
    assert.ok(h.q(`[data-words-turn="a${n}:0"]`), 'repainted');
    assert.equal(h.d.activeElement, h.q(key), key);
  }
});

test('the timeline has one tick per you turn, reading You · 13:00, and none for a words turn', async (t) => {
  const { qa } = await open(t);
  const ticks = qa('[data-timeline] [data-tick]');
  assert.deepEqual(ticks.map((e) => e.dataset.tick), ['u1', 'u2']);
  for (const e of ticks) assert.match(e.getAttribute('aria-label'), /, You · 13:00$/);
});

test('the demo threads carry times too: the first you turn of Billing CSV export reads 14:02', async (t) => {
  const w = stillhetHost({ hash: '#chat/c1', after: (fn) => t.after(fn), beforeScripts: (win) => { win.Date.now = () => new Date(2026, 10, 12, 15, 0).getTime(); } });
  await settle(40);
  const time = w.document.querySelector('#route-chat .convo-you time.turn-time');
  assert.equal(time?.textContent, '14:02');
  assert.ok(w.document.querySelector('#route-chat .convo-words time.turn-time'), 'and Worca\'s words');
});
