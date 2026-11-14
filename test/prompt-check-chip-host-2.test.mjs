// test/prompt-check-chip-host-2.test.mjs — the prompt check chip's controller (ui/public/prompt-check/chip-host.mjs),
// part 2: kind picks, corrections, announcements, stale replies, markup. Shared setup: test/helpers/prompt-check-chip-host.mjs.
// A bare JSDOM per test, closed when the test ends; fake timers and a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { textHash, PROMPT_CHECK_DEBOUNCE_MS } from '../src/shared/prompt-check/filter.mjs';
import { TASK, THIRD, OTHER, flush, reply, setup, chips, badge, picker } from './helpers/prompt-check-chip-host.mjs';

test('a deferred correction: no POST at the pick; the last pick is flushed once with the run id; it survives sent()', async (t) => {
  const s = setup(t, { mount: { surface: { kind: 'new-run', id: 'form' }, ids: {}, deferCorrection: true } });
  assert.equal(await s.m.flushCorrection({ runId: 'run_1' }), undefined);
  assert.equal(s.posts.length, 0, 'no pick, no POST');
  await s.graded();
  picker(s.m.el).click();
  [...s.doc.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === 'Idea').click();
  picker(s.m.el).click();
  [...s.doc.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === 'Plan').click();
  await flush();
  assert.equal(s.posts.length, 0);
  assert.deepEqual(s.m.pendingCorrection(), { proposedKind: 'implementation', chosenKind: 'plan' });
  s.m.sent(TASK);
  assert.equal(chips(s).length, 0);
  await s.m.flushCorrection({ runId: 'run_1' });
  assert.deepEqual(s.posts, [{ surface: 'new-run', runId: 'run_1', proposedKind: 'implementation', chosenKind: 'plan' }]);
  assert.equal(s.m.pendingCorrection(), null);
  await s.m.flushCorrection({ runId: 'run_2' });
  assert.equal(s.posts.length, 1);
});

test('a deferred correction dies with its draft: clearing and retyping, or disposing, leaves 0 corrections to flush', async (t) => {
  const s = setup(t, { mount: { surface: { kind: 'new-run', id: 'form' }, ids: {}, deferCorrection: true } });
  await s.graded();
  picker(s.m.el).click();
  [...s.doc.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === 'Plan').click();
  await flush();
  assert.ok(s.m.pendingCorrection());
  s.m.input('');
  assert.equal(s.m.pendingCorrection(), null, 'a cleared draft drops it');
  await s.graded(OTHER);
  await s.m.flushCorrection({ runId: 'run_1' });
  assert.deepEqual(s.posts, []);
  picker(s.m.el).click();
  [...s.doc.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === 'Idea').click();
  await flush();
  s.m.dispose();
  await s.m.flushCorrection({ runId: 'run_2' });
  assert.deepEqual(s.posts, [], 'a disposed chip drops it');
});

test('announce: once per changed kind or grade, politely, focus untouched; a silent mount-time result and a hidden chip say nothing', async (t) => {
  const s = setup(t);
  s.m.input(TASK, { silent: true });
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  s.grades.at(-1).reply(reply(s.grades.at(-1)));
  await flush();
  assert.equal(chips(s).length, 1);
  assert.deepEqual(s.said, [], 'the mount-time grade is silent');
  await s.graded(OTHER);
  assert.deepEqual(s.said, [], 'same kind and grade: nothing new to say');
  await s.graded(`${OTHER} With a CSV export and a chart for the finance team.`, { grade: 'clear' });
  assert.deepEqual(s.said, ['Prompt check: Implementation task, clear']);
  assert.equal(s.doc.activeElement, s.field);
  await s.graded(TASK, { isTask: false, kind: 'question' });
  assert.equal(s.said.length, 1, 'hidden: nothing said');
});

test('typing aborts the in-flight check (its signal aborted)', async (t) => {
  const s = setup(t);
  s.m.input(TASK);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  const first = s.grades.at(-1);
  s.m.input(OTHER);
  assert.equal(first.aborted, true);
});

test('a stale reply (an older request, or another text) is dropped: node, label, data-grade and badge unchanged', async (t) => {
  const s = setup(t);
  await s.graded();
  const node = s.m.el;
  s.m.input(OTHER);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  const call = s.grades.at(-1);
  call.reply({ ...reply(call, { kind: 'bug', grade: 'clear' }), requestId: 'chat-0' });
  await flush();
  s.m.input(THIRD);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  const c2 = s.grades.at(-1);
  c2.reply({ ...reply(c2, { kind: 'bug', grade: 'clear' }), textHash: textHash(OTHER) });
  await flush();
  assert.equal(chips(s)[0], node);
  assert.equal(picker(node).textContent, 'Implementation task');
  assert.equal(node.dataset.grade, 'needs-detail');
  assert.equal(badge(node).textContent, 'Needs detail');
});

test('continuesRequirement false empties the window of the next check', async (t) => {
  const s = setup(t);
  await s.graded();
  s.m.sent(TASK);
  await s.graded(OTHER, { continuesRequirement: false });
  s.m.input(`${TASK} And a PDF too, for the board.`);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.deepEqual(s.grades.at(-1).body.window, []);
});

test('the chip markup comes from the library and dispose removes the node and stops the grader', async (t) => {
  const s = setup(t, { mount: { forceTask: true, surface: { kind: 'run-card', id: 'card_1' }, ids: { threadId: 'ask_1', cardId: 'card_1' } } });
  s.m.input('Fix it?');
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(s.grades.at(-1).body.forceTask, true, 'a forced surface grades a short question');
  s.grades.at(-1).reply(reply(s.grades.at(-1)));
  await flush();
  assert.ok(s.m.el.querySelector('.spick > .spick-b[data-menu]'));
  assert.ok(s.m.el.querySelector('.kind-chip.pcheck-grade'));
  assert.ok(s.m.el.classList.contains('pcheck'));
  s.m.input(TASK);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  const live = s.grades.at(-1);
  s.m.dispose();
  assert.equal(live.aborted, true);
  assert.equal(chips(s).length, 0);
});

test('narrow widths: no .pcheck rule clips or ellipsizes a label or fixes a width, and both host rows keep flex-wrap: wrap', async () => {
  const { readFileSync } = await import('node:fs');
  const css = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const ds = css('ui/public/design-system/design-system.css');
  const rules = [...ds.matchAll(/([^{}]*\.pcheck[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 2, 'the .pcheck rules exist');
  for (const [, sel, body] of rules) {
    assert.doesNotMatch(body, /text-overflow|overflow\s*:\s*hidden|(?:^|;)\s*width\s*:|(?:min|max)-width\s*:\s*\d+(?:px|em|rem|ch)/, sel);
  }
  assert.match(rules.find(([, sel]) => /(?:^|\s)\.pcheck$/.test(sel.trim()))[2], /flex-wrap:\s*wrap/);
  for (const [file, sel] of [['ui/public/chat/chat-shell.css', 'chat-composer-lead'], ['ui/public/chat/run-proposal.css', 'ask-rp-brief-foot']]) {
    const body = new RegExp(`\\.${sel}\\{([^}]*)\\}`).exec(css(file))[1];
    assert.match(body, /flex-wrap:\s*wrap/, sel);
    assert.doesNotMatch(body, /overflow\s*:\s*hidden/, sel);
  }
  // Chat's lead row orders the chip after the intent chips; the Improve view follows it, on its own full-width line.
  const lead = css('ui/public/chat/chat-shell.css');
  const order = (sel) => Number(new RegExp(`\\.chat-composer-lead > \\.${sel}\\{[^}]*order:\\s*(\\d+)`).exec(lead)?.[1]);
  assert.ok(order('pcheck-improve') > order('pcheck'), 'the view comes after the chip');
  assert.match(/\.chat-composer-lead > \.pcheck-improve\{([^}]*)\}/.exec(lead)[1], /flex:\s*1 0 100%/);
});

test('Improve: a mount without a field never shows it; with one it follows needs-detail, and the chip stays the same node', async (t) => {
  const bare = setup(t);
  await bare.graded();
  await bare.graded(OTHER, { grade: 'needs-detail', kind: 'bug' });
  assert.equal(bare.m.el.querySelector('[data-prompt-improve-open]'), null);
  const s = setup(t, { mount: { field: { read: () => '', write: () => {} } } });
  await s.graded();
  const node = s.m.el;
  const btn = node.querySelector('[data-prompt-improve-open]');
  assert.ok(btn, 'shown for needs-detail');
  assert.equal(btn.textContent.trim(), 'Improve');
  assert.equal(btn.previousElementSibling, badge(node), 'after the badge');
  await s.graded(THIRD, { grade: 'clear' });
  assert.equal(node.querySelector('[data-prompt-improve-open]'), null, 'gone on a clear regrade');
  assert.equal(chips(s)[0], node);
  await s.graded(OTHER, { grade: null });
  assert.equal(node.querySelector('[data-prompt-improve-open]'), null, 'none without a grade');
});
