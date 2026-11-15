// test/ui-chat-prompt-check-2.test.mjs — the prompt check chip in the Chat composer and the Shaper task
// (ui/public/chat/prompt-check.mjs through ui/public/prompt-check/chip-host.mjs) inside the real Ask panel, part 2: refused sends, held sends, keyboard, announcements, Improve.
// Shared setup: test/helpers/ui-chat-prompt-check.mjs. Each window is closed when its test ends.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { _resetChatExtensions } from '../ui/public/chat/extensions.mjs';
import { PROMPT_CHECK_DEBOUNCE_MS } from '../src/shared/prompt-check/filter.mjs';
import { TID, NEW_TID, TASK, REWRITE, OTHER, open, chips, lead, promptCheckCalls, pickKind } from './helpers/ui-chat-prompt-check.mjs';

beforeEach(() => _resetChatExtensions());

test('a correction held in a new chat is dropped when another chat is opened instead: 0 kind-correction POSTs', async (t) => {
  const s = await open(t, { thread: false });
  await s.graded();
  await pickKind(s, 'Plan');
  s.ctx.panel.open({ threadId: TID });
  await s.settle(); await s.settle();
  assert.ok(s.rec.calls.some((c) => c.startsWith(`GET /api/ask/threads/${TID}`)), 'the other chat loaded');
  s.type(TASK);
  await s.settle();
  assert.deepEqual(s.rec.corrections, []);
});

test('a refused first send keeps the held correction off the record; a later chat never receives it', async (t) => {
  const s = await open(t, { thread: false });
  await s.graded();
  await pickKind(s, 'Plan');
  s.rec.refuseCreate = true;
  s.doc.querySelector('.ask-send').click();
  await s.settle();
  assert.equal(chips(s).length, 1, 'the draft stays, and so does its chip');
  s.ctx.panel.open({ threadId: TID });
  await s.settle(); await s.settle();
  assert.deepEqual(s.rec.corrections, []);
});

test('a thread made but its first message refused (429): another chat opened then receives 0 kind-correction POSTs', async (t) => {
  const s = await open(t, { thread: false });
  await s.graded();
  await pickKind(s, 'Plan');
  s.rec.refuseMessage = true;
  s.doc.querySelector('.ask-send').click();
  await s.settle();
  assert.ok(s.rec.calls.includes(`POST /api/ask/threads/${NEW_TID}/messages`), 'the thread was made and the message refused');
  s.ctx.panel.open({ threadId: TID });
  await s.settle(); await s.settle();
  s.type(TASK);
  await s.settle();
  assert.deepEqual(s.rec.corrections, []);
});

test('a refused first message (429) then a retry in the same chat: the held correction is POSTed once, after the 202', async (t) => {
  const s = await open(t, { thread: false });
  await s.graded();
  await pickKind(s, 'Plan');
  s.rec.refuseMessage = true;
  s.doc.querySelector('.ask-send').click();
  await s.settle();
  assert.deepEqual(s.rec.corrections, [], 'refused: nothing recorded yet');
  s.rec.refuseMessage = false;
  s.doc.querySelector('.ask-send').click();
  await s.settle();
  assert.deepEqual(s.rec.corrections, [{ surface: 'chat', threadId: NEW_TID, proposedKind: 'implementation', chosenKind: 'plan' }]);
});

test('an add-on holding the send (as the direction chip does) makes the text an answer: 0 grade calls', async (t) => {
  const s = await open(t, { extra: { id: 'holder', mount: () => ({ holdsSend: () => true }) } });
  s.type(TASK);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  await s.settle();
  assert.deepEqual(promptCheckCalls(s), []);
  assert.equal(chips(s).length, 0);
});

test('keyboard: Enter opens the kind menu, ArrowDown and Enter pick, and focus returns to the picker', async (t) => {
  const s = await open(t);
  await s.graded();
  const pick = chips(s)[0].querySelector('button');
  assert.match(pick.getAttribute('aria-label'), /^Prompt kind: /);
  pick.focus();
  pick.click();                                     // Enter on a native button is its click
  const menu = s.doc.querySelector('[role="menu"][aria-label="Prompt kind"]');
  assert.ok(menu);
  assert.equal(s.doc.activeElement.textContent, 'Requirement', 'the first kind has the focus');
  menu.dispatchEvent(new s.ctx.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal(s.doc.activeElement.textContent, 'Implementation task');
  menu.dispatchEvent(new s.ctx.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  s.doc.activeElement.click();                      // Enter on the focused item
  await s.settle();
  assert.equal(s.doc.activeElement, pick);
  assert.equal(pick.textContent, 'Bug report');
});

test('a grade change is announced in the polite region, and focus stays on the text field', async (t) => {
  const s = await open(t);
  s.input.focus();
  await s.graded();
  const live = s.doc.querySelector('[aria-live="polite"]');
  assert.ok(live);
  assert.ok([...s.doc.querySelectorAll('[aria-live="polite"]')].some((n) => n.textContent === 'Prompt check: Implementation task, needs detail'));
  assert.equal(s.doc.activeElement, s.input);
});

test('the kind label appears only inside the chip', async (t) => {
  const s = await open(t);
  await s.graded();
  const outside = [...s.doc.body.querySelectorAll('*')].filter((n) => !n.closest('[data-prompt-check]') && !n.closest('[aria-live]')
    && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.includes('Implementation task')));
  assert.deepEqual(outside, []);
});

test('a re-check never empties the lead row: typing a new task keeps the chip until the reply lands', async (t) => {
  const s = await open(t);
  await s.graded();
  const node = chips(s)[0];
  s.type(OTHER);
  assert.equal(chips(s)[0], node);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  s.rec.grades.at(-1).reply({ kind: 'bug', grade: 'clear' });
  await s.settle();
  assert.equal(chips(s)[0], node);
  assert.equal(node.querySelector('.pcheck-grade').textContent, 'Clear');
});

test('Improve: Use this writes into the composer through its input path (re-check) with Undo shown; Undo restores it', async (t) => {
  const s = await open(t);
  await s.graded();
  s.doc.querySelector('[data-prompt-improve-open]').click();
  await s.settle();
  assert.equal(s.rec.improves.length, 1);
  assert.equal(s.rec.improves[0].text, TASK);
  s.doc.querySelector('[data-improve-act="use"]').click();
  await s.settle();
  assert.equal(s.input.value, REWRITE);
  assert.ok(s.input.style.height.endsWith('px'), 'fitInput ran');
  assert.equal(s.doc.activeElement, s.input);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(s.rec.grades.at(-1).body.text, REWRITE, 'the rewrite is re-checked');
  s.rec.grades.at(-1).reply();
  await s.settle();
  assert.ok(s.doc.querySelector('[data-improve-act="undo"]'), 'Undo still shown');
  s.doc.querySelector('[data-improve-act="undo"]').click();
  await s.settle();
  assert.equal(s.input.value, TASK);
});
