// test/prompt-check-chip-host-1.test.mjs — the prompt check chip's controller (ui/public/prompt-check/chip-host.mjs),
// part 1: one node patched in place, hiding, the setting. Shared setup: test/helpers/prompt-check-chip-host.mjs.
// A bare JSDOM per test, closed when the test ends; fake timers and a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setPromptCheckPref, promptCheckOn } from '../ui/public/prompt-check/chip-host.mjs';
import { PROMPT_CHECK_DEBOUNCE_MS } from '../src/shared/prompt-check/filter.mjs';
import { TASK, OTHER, flush, reply, setup, chips, badge, picker } from './helpers/prompt-check-chip-host.mjs';

test('a graded task shows one chip: the kind picker (named Prompt kind: …) and the grade badge; the node is created at mount', async (t) => {
  const s = setup(t);
  assert.equal(s.m.el.isConnected, false, 'nothing shows before a result');
  await s.graded();
  assert.equal(chips(s).length, 1);
  assert.equal(chips(s)[0], s.m.el);
  assert.equal(s.m.el.dataset.kind, 'implementation');
  assert.equal(s.m.el.dataset.grade, 'needs-detail');
  assert.equal(picker(s.m.el).textContent, 'Implementation task');
  assert.equal(picker(s.m.el).getAttribute('aria-label'), 'Prompt kind: Implementation task');
  assert.equal(badge(s.m.el).textContent, 'Needs detail');
  assert.ok(badge(s.m.el).classList.contains('is-needs-detail'));
  assert.equal(s.m.el.querySelectorAll('button').length, 1, 'no Improve button on a mount without a field');
});

test('a re-check keeps the same node, label and badge while it is pending and in flight; the reply patches in place', async (t) => {
  const s = setup(t);
  await s.graded();
  const node = s.m.el;
  const b = badge(node);
  s.m.input(OTHER);
  assert.equal(chips(s)[0], node);
  assert.equal(b.textContent, 'Needs detail');
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(chips(s)[0], node, 'in flight: same node');
  assert.equal(picker(node).textContent, 'Implementation task');
  s.grades.at(-1).reply(reply(s.grades.at(-1), { kind: 'bug', grade: 'clear' }));
  await flush();
  assert.equal(chips(s)[0], node);
  assert.equal(badge(node), b, 'the badge node is patched, not replaced');
  assert.equal(picker(node).textContent, 'Bug report');
  assert.equal(b.textContent, 'Clear');
  assert.ok(b.classList.contains('is-clear') && !b.classList.contains('is-needs-detail'));
});

test('a deterministic reply (model unavailable, grade null) shows the picker and 0 badges', async (t) => {
  const s = setup(t);
  await s.graded(TASK, { grade: null, source: 'deterministic' }, { source: 'deterministic', error: 'model unavailable' });
  assert.equal(chips(s).length, 1);
  assert.equal(picker(s.m.el).textContent, 'Implementation task');
  assert.equal(badge(s.m.el), null);
  assert.equal(s.m.el.dataset.grade, '');
});

test('a skip or a non-task hides the chip (node detached, kept); the next task shows the same node at the same spot', async (t) => {
  const s = setup(t);
  await s.graded();
  const node = s.m.el;
  s.m.input('What does the review step do?');
  assert.equal(chips(s).length, 0);
  await s.graded(OTHER, { isTask: false, kind: 'conversation' });
  assert.equal(chips(s).length, 0);
  await s.graded(TASK, { kind: 'bug' });
  assert.equal(chips(s)[0], node);
  assert.equal(node.parentNode, s.host);
});

test('off: no fetch at all, and turning the setting off hides a shown chip and cancels its check', async (t) => {
  const s = setup(t, { on: false });
  assert.equal(promptCheckOn(), false);
  s.m.input(TASK);
  s.timers.advance(10_000);
  assert.equal(s.grades.length, 0);
  setPromptCheckPref(true);
  await s.graded();
  assert.equal(chips(s).length, 1);
  s.m.input(OTHER);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  const inflight = s.grades.at(-1);
  setPromptCheckPref(false);
  assert.equal(chips(s).length, 0);
  assert.equal(inflight.aborted, true);
});

test('turning the setting on re-checks a field already filled while it was off, silently (a card mounted before the pref)', async (t) => {
  const s = setup(t, { on: false });
  s.m.input(TASK, { silent: true });
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(s.grades.length, 0);
  setPromptCheckPref(true);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(s.grades.length, 1);
  assert.equal(s.grades[0].body.text, TASK);
  s.grades[0].reply(reply(s.grades[0]));
  await flush();
  assert.equal(chips(s).length, 1);
  assert.deepEqual(s.said, [], 'the re-check is a mount-time check: shown, not announced');
  setPromptCheckPref(true);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(s.grades.length, 1, 'on while already on: nothing re-checked');
});

test('the same text after a hidden chip is checked again: a short question, a clear, or the setting off and on', async (t) => {
  const s = setup(t);
  await s.graded();
  s.m.input('What does the review step do?');
  assert.equal(chips(s).length, 0);
  await s.graded(TASK);
  assert.equal(chips(s).length, 1, 'after a short question');
  s.m.input('');
  assert.equal(chips(s).length, 0);
  await s.graded(TASK);
  assert.equal(chips(s).length, 1, 'after a clear');
  setPromptCheckPref(false);
  setPromptCheckPref(true);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  s.grades.at(-1).reply(reply(s.grades.at(-1)));
  await flush();
  assert.equal(chips(s).length, 1, 'after off and on');
  const n = s.grades.length;
  s.m.input(TASK);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(s.grades.length, n, 'a shown chip still skips the same text');
});

test('a kind pick: the new label at once, the badge removed, a regrade with the kind, and one POST of ids only', async (t) => {
  const s = setup(t);
  await s.graded();
  const node = s.m.el;
  picker(node).click();
  const menu = s.doc.querySelector('[role="menu"]');
  assert.equal(menu.getAttribute('aria-label'), 'Prompt kind');
  const items = [...menu.querySelectorAll('[role="menuitemradio"]')];
  assert.equal(items.length, 7);
  assert.equal(items.find((i) => i.getAttribute('aria-checked') === 'true').textContent, 'Implementation task');
  items.find((i) => i.textContent === 'Bug report').click();
  assert.equal(chips(s)[0], node);
  assert.equal(picker(node).textContent, 'Bug report');
  assert.equal(badge(node), null);
  assert.equal(s.grades.at(-1).body.kind, 'bug');
  await flush();
  assert.deepEqual(s.posts, [{ surface: 'chat', threadId: 'ask_1', proposedKind: 'implementation', chosenKind: 'bug' }]);
  s.grades.at(-1).reply(reply(s.grades.at(-1), { kind: 'bug', grade: 'clear' }));
  await flush();
  assert.equal(badge(node).textContent, 'Clear');
  picker(node).click();
  [...s.doc.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === 'Bug report').click();
  await flush();
  assert.equal(s.posts.length, 1, 'picking the same kind does nothing');
});
