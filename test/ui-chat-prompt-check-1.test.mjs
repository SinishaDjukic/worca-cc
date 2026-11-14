// test/ui-chat-prompt-check-1.test.mjs — the prompt check chip in the Chat composer and the Shaper task
// (ui/public/chat/prompt-check.mjs through ui/public/prompt-check/chip-host.mjs) inside the real Ask panel, part 1: when it shows, and kind corrections.
// Shared setup: test/helpers/ui-chat-prompt-check.mjs. Each window is closed when its test ends.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { _resetChatExtensions } from '../ui/public/chat/extensions.mjs';
import { createPromptCheckAddon } from '../ui/public/chat/prompt-check.mjs';
import { JSDOM } from 'jsdom';
import { setPromptCheckPref } from '../ui/public/prompt-check/chip-host.mjs';
import { PROMPT_CHECK_DEBOUNCE_MS } from '../src/shared/prompt-check/filter.mjs';
import { TID, NEW_TID, TASK, OTHER, fakeTimers, api, open, chips, lead, promptCheckCalls, pickKind } from './helpers/ui-chat-prompt-check.mjs';

beforeEach(() => _resetChatExtensions());

test('on, a typed task: one chip in the lead row with the kind and the grade', async (t) => {
  const s = await open(t);
  await s.graded();
  assert.equal(chips(s).length, 1);
  assert.equal(chips(s)[0].parentNode, lead(s));
  assert.equal(chips(s)[0].querySelector('button').textContent, 'Implementation task');
  assert.equal(chips(s)[0].querySelector('.pcheck-grade').textContent, 'Needs detail');
  assert.deepEqual(s.rec.grades[0].body.surface, { kind: 'chat', id: TID });
});

test('off: 0 chips and 0 calls to either prompt-check route', async (t) => {
  const s = await open(t, { on: false });
  s.type(TASK);
  s.timers.advance(10_000);
  await s.settle();
  assert.equal(chips(s).length, 0);
  assert.deepEqual(promptCheckCalls(s), []);
});

test('a short question shows 0 chips with 0 calls; a model reply with isTask false shows 0 chips', async (t) => {
  const s = await open(t);
  s.type('What does the review step do?');
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  await s.settle();
  assert.equal(chips(s).length, 0);
  assert.deepEqual(promptCheckCalls(s), []);
  await s.graded(OTHER, { isTask: false, kind: 'conversation' });
  assert.equal(chips(s).length, 0);
});

test('the Shaper intent: surface shaper, forceTask, and a short prompt still shows its chip', async (t) => {
  const s = await open(t, { thread: false });
  s.intent.set('shape', { focus: false });
  await s.graded('Fix the login?');
  assert.deepEqual(s.rec.grades.at(-1).body.surface, { kind: 'shaper', id: 'new' });
  assert.equal(s.rec.grades.at(-1).body.forceTask, true);
  assert.equal(chips(s).length, 1);
});

test('in flight (the grade held): the chip is the same node and Send stays enabled', async (t) => {
  const s = await open(t);
  await s.graded();
  const before = chips(s)[0];
  s.type(OTHER);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  await s.settle();
  assert.equal(s.rec.grades.length, 2);
  assert.equal(chips(s)[0], before);
  assert.equal(s.doc.querySelector('.ask-send').disabled, false);
});

test('a kind correction in an open chat regrades and POSTs the thread id, with no text', async (t) => {
  const s = await open(t);
  await s.graded();
  await pickKind(s, 'Bug report');
  assert.equal(s.rec.grades.at(-1).body.kind, 'bug');
  assert.deepEqual(s.rec.corrections, [{ surface: 'chat', threadId: TID, proposedKind: 'implementation', chosenKind: 'bug' }]);
});

test('a correction in a new chat is held, then POSTed once with the thread id its first send creates', async (t) => {
  const s = await open(t, { thread: false });
  await s.graded();
  await pickKind(s, 'Plan');
  assert.deepEqual(s.rec.corrections, []);
  s.doc.querySelector('.ask-send').click();
  await s.settle();
  assert.ok(s.rec.calls.includes(`POST /api/ask/threads/${NEW_TID}/messages`));
  assert.deepEqual(s.rec.corrections, [{ surface: 'chat', threadId: NEW_TID, proposedKind: 'implementation', chosenKind: 'plan' }]);
  assert.equal(chips(s).length, 0, 'sent: the chip hides');
});

test('after the held correction of a new chat is recorded, a later pick in that same chat is POSTed at once', async (t) => {
  const s = await open(t, { thread: false });
  await s.graded();
  await pickKind(s, 'Plan');
  s.doc.querySelector('.ask-send').click();
  await s.settle();
  assert.equal(s.rec.corrections.length, 1);
  await s.graded(OTHER);
  await pickKind(s, 'Idea');
  assert.deepEqual(s.rec.corrections.at(-1), { surface: 'chat', threadId: NEW_TID, proposedKind: 'implementation', chosenKind: 'idea' });
  assert.equal(s.rec.corrections.length, 2);
});

test('a held correction carried onto the made thread (re-keyed before sent): once recorded, a later pick there is POSTed at once', async (t) => {
  const w = new JSDOM('<!doctype html><body><div id="lead"></div></body>');
  const timers = fakeTimers();
  const rec = {};
  const fetchImpl = api(rec);
  let tid = null;
  let made = null;
  setPromptCheckPref(true);
  const h = createPromptCheckAddon({ timers }).mount(w.window.document.getElementById('lead'), {
    threadId: () => tid, madeThread: () => made, fetch: fetchImpl, announce: () => {},
  });
  t.after(() => { h.destroy(); setPromptCheckPref(false); w.window.close(); });
  const flushAll = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
  const grade = async (text) => { h.input(text); timers.advance(PROMPT_CHECK_DEBOUNCE_MS); rec.grades.at(-1).reply(); await flushAll(); };
  const pick = async (label) => {
    w.window.document.querySelector('[data-prompt-check] button').click();
    [...w.window.document.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === label).click();
    await flushAll();
  };
  await grade(TASK);
  await pick('Plan');
  tid = NEW_TID; made = NEW_TID;
  h.update();
  assert.deepEqual(rec.corrections, [], 'carried, still held');
  h.sent(TASK);
  assert.deepEqual(rec.corrections, [{ surface: 'chat', threadId: NEW_TID, proposedKind: 'implementation', chosenKind: 'plan' }]);
  await grade(OTHER);
  await pick('Idea');
  assert.deepEqual(rec.corrections.at(-1), { surface: 'chat', threadId: NEW_TID, proposedKind: 'implementation', chosenKind: 'idea' });
  assert.equal(rec.corrections.length, 2);
});
