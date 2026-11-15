// test/stillhet-chat-prompt-check-chip.test.mjs — the prompt check chip in Stillhet's Chat composer, live kind (jsdom app
// host; test/helpers/stillhet-chat-prompt-check.mjs). The chip is dev's grader through createComposerCheck, drawn with the
// library's SentencePicker and Chip in the sentence row after the intent chip. It never holds Send.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { closeHosts, settle, go } from './helpers/stillhet-chat-live-host.mjs';
import { pcHost, pcNode, picker, gradeText, reply, TASK, PC } from './helpers/stillhet-chat-prompt-check.mjs';
import { PROMPT_KINDS, KIND_LABELS } from '../src/shared/prompt-check/assessment.mjs';

afterEach(closeHosts);
const LONGER = `${TASK} It must also export the monthly totals for every team.`;

test('setting off: 200 typed characters make no prompt check call, and no chip is drawn (R-qa-1, R-ux-5)', async () => {
  const s = await pcHost({ on: false });
  let text = '';
  for (let i = 0; i < 20; i++) { text += 'Add a CSV '; await s.type(text); }
  assert.equal(text.length, 200);
  await s.quiet(); await s.quiet();
  assert.deepEqual(s.pcCalls(), []);
  assert.equal(pcNode(s), null);
  assert.equal(s.q('[data-pc-improve]'), null);
});

test('one /grade after 1500 ms of quiet, still one after another 1500 ms; the chip sits after the intent chip in the sentence (R-qa-2, R-ux-1)', async () => {
  const s = await pcHost();
  s.d.querySelector('#route-chat [data-starter="pin:Shaper"]').click(); await settle(10);   // an intent chip leads the row
  await s.type(TASK);
  s.timers.advance(1499); await settle(10);
  assert.equal(s.grades().length, 0);
  s.timers.advance(1); await settle(10);
  assert.equal(s.grades().length, 1);
  s.grades()[0].answer(reply(s.grades()[0], { kind: 'bug', grade: 'needs-detail' }));
  await settle(20);
  await s.quiet();
  assert.equal(s.grades().length, 1);
  const pc = pcNode(s);
  assert.equal(picker(s).textContent, KIND_LABELS.bug);
  assert.equal(picker(s).getAttribute('aria-label'), 'Prompt kind: Bug report, Needs detail');
  assert.equal(gradeText(s), 'Needs detail');
  assert.equal(s.q('[data-pc] [data-pc-say]').getAttribute('aria-live'), 'polite');
  assert.equal(pc.getAttribute('aria-live'), null, 'only the grade announces');
  assert.ok(s.q('[data-pc] [data-pc-improve-open]'), 'Needs detail offers Improve');
  const sentence = pc.parentElement;
  const kids = [...sentence.children], intent = kids.findIndex((k) => k.matches('.composer-intent'));
  assert.ok(intent >= 0, 'the Shaper intent is armed');
  assert.equal(kids.indexOf(pc), intent + 1, 'right after the intent chip');
  assert.equal(pc.closest('.composer-send, [data-cp-send]'), null, 'never in the send group');
  assert.ok(sentence.contains(s.q('[data-menu="cp-project"]')), 'in the sentence with the other pickers');
});

test('a re-grade keeps the same [data-pc] node, and a focused picker keeps the focus (R-ux-2)', async () => {
  const s = await pcHost();
  await s.graded(TASK, { grade: 'needs-detail' });
  const node = pcNode(s);
  picker(s).focus();
  s.box().value = LONGER;
  s.box().dispatchEvent(new s.w.Event('input', { bubbles: true }));
  await s.quiet();
  const call = s.grades().at(-1);
  call.answer(reply(call, { grade: 'clear' }));
  await settle(20);
  assert.equal(pcNode(s), node, 'patched in place');
  assert.equal(gradeText(s), 'Clear');
  assert.equal(s.d.activeElement, picker(s));
});

test('a late grade for older text leaves the chip as is (R-qa-2)', async () => {
  const s = await pcHost();
  await s.graded(TASK, { grade: 'clear' });
  await s.type(LONGER); await s.quiet();
  const older = s.grades().at(-1);
  await s.type(`${LONGER} And a footer with the export date.`);
  older.answer(reply(older, { kind: 'bug', grade: 'needs-detail' }));
  await settle(20);
  assert.equal(picker(s).textContent, KIND_LABELS.implementation);
  assert.equal(gradeText(s), 'Clear');
});

test('the kind menu lists the 7 kinds with the current one ticked; Escape closes it with the draft unchanged (R-ux-3)', async () => {
  const s = await pcHost();
  await s.graded();
  picker(s).click(); await settle(10);
  const items = [...s.d.querySelectorAll('#route-chat [data-menu-pick^="cp-pcheck|"]')];
  assert.deepEqual(items.map((e) => e.dataset.menuPick.split('|')[1]), [...PROMPT_KINDS]);
  // dev's labels in Stillhet's words (a run is a task here)
  assert.deepEqual(items.map((e) => e.textContent.trim()), PROMPT_KINDS.map((k) => KIND_LABELS[k].replace(/\ba run\b/, 'a task')));
  assert.deepEqual(items.filter((e) => e.getAttribute('aria-checked') === 'true').map((e) => e.dataset.menuPick), ['cp-pcheck|implementation']);
  s.d.dispatchEvent(new s.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle(10);
  assert.equal(s.d.querySelector('#route-chat [data-menu-pick^="cp-pcheck|"]'), null);
  assert.equal(s.box().value, TASK);
});

test('a pick re-grades at once, posts ids and kinds only, and keeps the draft and the caret (R-qa-3, R-ux-3)', async () => {
  const s = await pcHost();
  await go(s.w, '#chat/ask_1');
  await s.graded();
  s.box().focus(); s.box().setSelectionRange(7, 7);   // mid-draft: the end would hide a caret moved there by a repaint
  const caret = 7;
  const n = s.grades().length;
  picker(s).click(); await settle(10);
  assert.equal(s.box().selectionStart, caret, 'opening the menu keeps the caret');
  const item = s.d.querySelector('#route-chat [data-menu-pick="cp-pcheck|bug"]');
  item.focus(); item.click(); await settle(20);   // a real click focuses the item first: the re-grade's patch then finds the focus inside [data-pc]
  assert.equal(s.grades().length, n + 1, 're-graded without the debounce');
  assert.equal(s.grades().at(-1).body.kind, 'bug');
  const posts = s.held.filter((c) => c.url === `${PC}kind-correction`);
  assert.equal(posts.length, 1);
  assert.deepEqual(Object.keys(posts[0].body).sort(), ['chosenKind', 'proposedKind', 'surface', 'threadId']);
  assert.deepEqual(posts[0].body, { surface: 'chat', threadId: 'ask_1', proposedKind: 'implementation', chosenKind: 'bug' });
  assert.equal(picker(s).textContent, KIND_LABELS.bug);
  assert.equal(s.box().value, TASK);
  assert.equal(s.box().selectionStart, caret);
});

test('a new chat\'s correction is posted once after the first send; a refused send posts none (R-qa-3)', async () => {
  let refuse = true;
  const s = await pcHost({ ask: (url) => (url.endsWith('/messages') && refuse ? [409, { error: 'turn in flight' }] : null) });
  await s.graded();
  s.box().focus(); s.box().setSelectionRange(7, 7);
  picker(s).click(); await settle(10);
  const item = s.d.querySelector('#route-chat [data-menu-pick="cp-pcheck|plan"]');
  item.focus(); item.click(); await settle(20);
  assert.equal(s.box().selectionStart, 7, 'a pick in a new chat keeps the caret too');
  const corrections = () => s.held.filter((c) => c.url === `${PC}kind-correction`);
  assert.equal(corrections().length, 0, 'held: no thread yet');
  s.q('[data-cp-send]').click(); await settle(80);
  assert.equal(corrections().length, 0, 'a refused send posts nothing');
  refuse = false;
  s.q('[data-cp-send]').click(); await settle(80);
  assert.equal(s.w.location.hash, '#chat/ask_new');
  assert.deepEqual(corrections().map((c) => c.body), [{ surface: 'chat', threadId: 'ask_new', proposedKind: 'implementation', chosenKind: 'plan' }]);
  await s.type(LONGER); await s.quiet();
  assert.equal(corrections().length, 1, 'once');
});

test('Send works with a grade pending and after a 500 (R-qa-4, R-ux-6)', async () => {
  const s = await pcHost();
  await go(s.w, '#chat/ask_1');
  await s.type(TASK); await s.quiet();
  assert.equal(s.grades().length, 1);
  assert.equal(s.q('[data-cp-send]').disabled, false);
  s.q('[data-cp-send]').click(); await settle(60);
  assert.ok(s.calls.some((c) => c.url === '/api/ask/threads/ask_1/messages' && c.body.text === TASK), 'sent while the grade was out');
  await s.type(LONGER); await s.quiet();
  s.grades().at(-1).answer({ error: 'boom' }, 500); await settle(20);
  assert.equal(pcNode(s).children.length, 0, 'a 500 shows nothing');
  assert.equal(s.q('[data-cp-send]').disabled, false);
  s.q('[data-cp-send]').click(); await settle(60);
  assert.ok(s.calls.some((c) => c.url === '/api/ask/threads/ask_1/messages' && c.body.text === LONGER));
});

test('turning the setting off removes the chip and the suggestion', async () => {
  const s = await pcHost();
  await s.graded(TASK, { grade: 'needs-detail' });
  s.q('[data-pc-improve-open]').click(); await settle(10);
  assert.ok(s.q('[data-pc-improve] [data-prompt-improve]'));
  await s.setOn(false);
  assert.equal(pcNode(s), null);
  assert.equal(s.q('[data-pc-improve]'), null);
  assert.equal(s.d.querySelector('[data-prompt-improve]')?.isConnected ? 1 : 0, 0);
  const before = s.pcCalls().length;
  await s.type(LONGER); await s.quiet();
  assert.equal(s.pcCalls().length, before, 'no call once off');
});

test('Needs detail is the amber grade chip; Clear is the plain one', async () => {
  const s = await pcHost();
  await go(s.w, '#chat/ask_1');
  await s.graded(TASK, { grade: 'needs-detail' });
  assert.ok(s.q('[data-pc-say] .pcheck-grade').classList.contains('is-needs-detail'));
  await s.graded(LONGER, { grade: 'clear' });
  assert.equal(gradeText(s).trim(), 'Clear');
  assert.equal(s.q('[data-pc-say] .pcheck-grade').classList.contains('is-needs-detail'), false);
});
