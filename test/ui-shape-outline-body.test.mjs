// test/ui-shape-outline-body.test.mjs — the slice outline ask's body (spec §3.8, screen 8; D30–D32). Gate on, it is
// one decision card: a summary, compact slices, Edit slices (merge/remove preview, Undo edits), the folded check line
// with one Fix all, the approve-each switch, Plan slice 1 / Ask for changes / ⋯ (Don't slice). Gate off, today's held
// body: Don't slice, typed revise, Stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderOutlineBody, outlineSummary } from '../ui/public/shape/outline-body.mjs';
import { SEND_FAILED } from '../ui/public/shape/plan-body.mjs';
import { checkSlices, outlineFixFeedback, outlineFixAllFeedback } from '../src/shared/shape/slices.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const flush = () => new Promise((r) => setTimeout(r, 0));

const slice = (id, o = {}) => ({
  id, title: `Slice ${id}`, goal: `Make ${id} possible for people`, inScope: ['a'], outOfScope: ['b'],
  acceptance: ['GET /api/x returns 200'], dependsOn: [], estimate: 'medium', ...o,
});
const OUTLINE = {
  why: 'The change is large and cuts across three subsystems.',
  slices: [slice('s1'), slice('s2', { dependsOn: ['s1'], acceptance: ['The page shows a chart', 'A PNG file is written'], estimate: 'large' })],
};
const TINY = { ...OUTLINE, slices: [slice('s1', { estimate: 'small' }), slice('s2', { dependsOn: ['s1'], estimate: 'small' })] };

const ask = (o = {}) => ({ id: 'q1', kind: 'plan', nodeId: 'plan', executionId: 'e1',
  plan: { port: 'plan', round: 1, revisable: true, nodeId: 'plan', outline: OUTLINE, ...o } });

function setup({ pq = ask(), extras = true, run = {}, submit, confirm } = {}) {
  const panel = doc.createElement('div');
  panel.className = 'qpanel';
  const calls = { submit: [], confirm: [] };
  const deps = {
    doc, run, extras,
    submit: submit ? (p) => { calls.submit.push(p); return submit(p, panel); } : async (p) => { calls.submit.push(p); return true; },
    confirm: confirm ? (o) => { calls.confirm.push(o); return confirm(o); } : async (o) => { calls.confirm.push(o); return true; },
  };
  renderOutlineBody(panel, pq, deps);
  return { panel, calls, $: (s) => panel.querySelector(s), $$: (s) => [...panel.querySelectorAll(s)] };
}

const titles = ($$) => $$('.outline-slice-title').map((n) => n.textContent);
// The card's controls a person can reach now: not inside a folded/hidden region. The check line is a status
// disclosure (clarify answer), not a control.
const reachable = ($$) => $$('button, input, textarea, select')
  .filter((n) => !n.closest('[hidden]') && !n.classList.contains('plan-check-line'));
// Opens the card's ⋯ and returns its item labels; pick(label) clicks one (as ui-shape-plan-body.test.mjs does).
function menu($) {
  $('.plan-more').click();
  const items = [...doc.querySelectorAll('.wfv-menu .wfv-menu-item')];
  return { labels: items.map((b) => b.textContent), pick: (l) => items.find((b) => b.textContent === l).click() };
}
const editMode = ($) => $('.outline-edit').click();

test('gate off: the slices, goals, acceptance and estimates render; the meta reads the count, round and check', () => {
  const { $, $$ } = setup({ extras: false });
  assert.equal($('.plan-meta').textContent, '2 slices · v1 · Outline 5/5');
  assert.equal($('.outline-why').textContent, OUTLINE.why);
  assert.deepEqual(titles($$), ['Slice s1', 'Slice s2']);
  assert.equal($$('.outline-slice')[1].dataset.slice, 's2');
  assert.equal($$('.outline-goal')[0].textContent, 'Make s1 possible for people');
  assert.deepEqual($$('.outline-slice')[1].querySelectorAll('.outline-acceptance li').length, 2);
  assert.deepEqual($$('.outline-est').map((n) => n.textContent), ['medium', 'large']);
  assert.ok($$('.outline-est')[1].classList.contains('large'));
  assert.equal($$('.plan-check-ok').length, 5);
  assert.equal($('.outline-approve').textContent, 'Plan slice 1');
  assert.ok($('.outline-undo').hidden);
});

test('a slice with no goal, estimate or acceptance renders none of those parts', () => {
  const lean = { why: '', slices: [slice('s1', { goal: '', acceptance: [], estimate: null }), slice('s2')] };
  const { $, $$ } = setup({ pq: ask({ outline: lean }), extras: false });
  const li = $$('.outline-slice')[0];
  assert.ok(!li.querySelector('.outline-goal'));
  assert.ok(!li.querySelector('.outline-acceptance'));
  assert.ok(!li.querySelector('.outline-est'));
  assert.ok($('.outline-why').hidden);

  const card = setup({ pq: ask({ outline: lean }) });
  const row = card.$$('.outline-slice')[0];
  assert.ok(!row.querySelector('.outline-goal'));
  assert.ok(!row.querySelector('.outline-est'));
  assert.equal(card.$('.outline-summary').textContent, '2 slices');
});

test('gate on, closed: summary, compact slices, folded check line, at most 5 controls, no Stop, box closed', () => {
  const { $, $$, panel } = setup();
  assert.ok(panel.querySelector('.plan-body.plan-card.outline-body'));
  assert.equal($('.outline-summary').textContent, '2 slices · The change is large and cuts across three subsystems.');
  assert.deepEqual(titles($$), ['Slice s1', 'Slice s2']);
  assert.deepEqual($$('.outline-est').map((n) => n.textContent), ['medium', 'large']);
  assert.equal($$('.outline-goal')[0].textContent, 'Make s1 possible for people');
  assert.equal($$('.outline-acceptance').length, 0, 'no acceptance lists on the card');
  assert.equal($('.plan-check-line .plan-fold-text').textContent, 'Outline 5/5');
  assert.equal($('.plan-check-line').getAttribute('aria-expanded'), 'false');
  assert.ok($('.plan-checks').hidden, 'checks folded');
  assert.equal($$('.plan-check-ok').length, 0, 'no green chips');
  assert.equal($('.plan-stop'), null, 'the top bar has Stop (D31)');
  assert.ok($('.plan-feedback').closest('[hidden]'), 'the text box is closed');
  assert.equal($$('.outline-merge').length + $$('.outline-remove').length, 0, 'no per-slice controls until Edit slices');
  assert.equal($('.outline-flat'), null, 'Don\'t slice lives in ⋯');
  assert.equal($$('.btn-primary').length, 1);
  assert.equal($('.outline-approve').textContent, 'Plan slice 1');
  assert.deepEqual(reachable($$).map((n) => n.className.replace(/^btn /, '').split(' ').pop() || n.type),
    ['outline-edit', 'checkbox', 'outline-approve', 'plan-ask-changes', 'plan-more']);
  assert.ok(reachable($$).length <= 5);
});

test('gate on: the check line expands to neutral ✓ / ✕ rows; one Fix all posts the outline fix', () => {
  const { $, $$, calls } = setup({ pq: ask({ outline: TINY }) });
  assert.equal($('.plan-check-line .plan-fold-text').textContent, 'Outline 4/5 · 1 to fix');
  assert.equal($('.outline-approve').textContent, 'Plan slice 1', 'never "anyway" (D32)');
  $('.plan-check-line').click();
  assert.equal($('.plan-checks').hidden, false);
  assert.equal($('.plan-check-line').getAttribute('aria-expanded'), 'true');
  assert.deepEqual($$('.plan-check-mark').map((m) => m.textContent), ['✓', '✓', '✓', '✕', '✓']);
  assert.equal($$('.plan-check-row.ok').length, 4);
  assert.equal($$('.plan-fix').length, 0, 'no per-row Fix');
  assert.equal($$('.plan-fix-all').length, 1);
  $('.plan-fix-all').click();
  const item = checkSlices(TINY).items.find((i) => i.id === 'notTiny');
  assert.deepEqual(calls.submit, [{ decision: 'revise', feedback: outlineFixFeedback(item) }], 'one failure: today\'s Fix answer');
  assert.equal(outlineFixAllFeedback(checkSlices(TINY).items), outlineFixFeedback(item));
  assert.match(calls.submit[0].feedback, /Rewrite the outline/);
  assert.doesNotMatch(calls.submit[0].feedback, /Fix the plan/);
  assert.equal(setup({ pq: ask({ outline: TINY }), extras: false }).$('.outline-approve').textContent, 'Plan slice 1 anyway');
});

test('gate on: Ask for changes opens the box and focuses it; Send changes posts the revise', () => {
  const { $, calls } = setup();
  const askBtn = $('.plan-ask-changes');
  assert.equal(askBtn.getAttribute('aria-expanded'), 'false');
  askBtn.click();
  assert.equal(askBtn.getAttribute('aria-expanded'), 'true');
  assert.equal($('.plan-feedback').closest('[hidden]'), null);
  $('.plan-revise').click();
  assert.equal($('.plan-err').textContent, 'Write what should change first');
  $('.plan-feedback').value = '  split the export out  ';
  $('.plan-revise').click();
  assert.deepEqual(calls.submit, [{ decision: 'revise', feedback: 'split the export out' }]);
});

test('gate on: ⋯ holds Don\'t slice, which posts flat', () => {
  const { $, calls } = setup();
  const m = menu($);
  assert.deepEqual(m.labels, ['Don\'t slice']);
  m.pick('Don\'t slice');
  assert.deepEqual(calls.submit, [{ decision: 'flat' }]);
  assert.ok(setup({ pq: ask(), run: { workspaceId: 'w1' } }).$('.plan-more'), 'a workspace run keeps ⋯');
});

test('gate on: Edit slices reveals Merge with next / Remove; they post the same answers as today', () => {
  const merged = setup();
  assert.equal(merged.$('.outline-edit').getAttribute('aria-expanded'), 'false');
  editMode(merged.$);
  assert.equal(merged.$('.outline-edit').getAttribute('aria-expanded'), 'true');
  assert.equal(merged.$('.outline-edit').textContent, 'Done editing');
  assert.equal(merged.$$('.outline-merge').length, 1, 'never on the last slice');
  assert.equal(merged.$$('.outline-remove').length, 2);
  assert.ok(merged.$('.outline-undo').hidden, 'Undo only after an edit');
  merged.$$('.outline-merge')[0].click();
  assert.deepEqual(titles(merged.$$), ['Slice s1 + Slice s2']);
  assert.equal(merged.$('.outline-summary').textContent, '1 slice · The change is large and cuts across three subsystems.');
  assert.equal(merged.$('.plan-check-line .plan-fold-text').textContent, 'Outline 4/5 · 1 to fix');
  assert.equal(merged.$('.outline-approve').textContent, 'Plan it as one');
  assert.equal(merged.$('.outline-undo').hidden, false);
  merged.$('.outline-approve').click();
  assert.deepEqual(merged.calls.submit, [{ decision: 'approve', edits: [{ op: 'merge', id: 's1' }], approveEach: false }]);

  const removed = setup();
  editMode(removed.$);
  removed.$$('.outline-remove')[0].click();
  assert.deepEqual(titles(removed.$$), ['Slice s2']);
  removed.$('.outline-approve').click();
  assert.deepEqual(removed.calls.submit, [{ decision: 'approve', edits: [{ op: 'remove', id: 's1' }], approveEach: false }]);
});

test('gate on: Undo edits restores and posts nothing; Done editing hides the tools again, edits kept', () => {
  const { $, $$, calls } = setup();
  editMode($);
  $$('.outline-remove')[0].click();
  $('.outline-undo').click();
  assert.deepEqual(titles($$), ['Slice s1', 'Slice s2']);
  assert.ok($('.outline-undo').hidden);
  assert.equal(calls.submit.length, 0);
  $$('.outline-remove')[0].click();
  editMode($);                                           // Done editing
  assert.equal($$('.outline-remove').length, 0);
  assert.ok($('.outline-undo').hidden);
  assert.deepEqual(titles($$), ['Slice s2'], 'the edit stays in the preview');
  $('.outline-approve').click();
  assert.deepEqual(calls.submit, [{ decision: 'approve', edits: [{ op: 'remove', id: 's1' }], approveEach: false }]);
});

test('gate on: a re-ask\'s carried edits preview with the mode closed', () => {
  const { $, $$, calls } = setup({ pq: ask({ edits: [{ op: 'remove', id: 's1' }] }) });
  assert.deepEqual(titles($$), ['Slice s2']);
  assert.equal($('.outline-edit').getAttribute('aria-expanded'), 'false');
  assert.ok($('.outline-undo').hidden);
  $('.outline-approve').click();
  assert.deepEqual(calls.submit, [{ decision: 'approve', edits: [{ op: 'remove', id: 's1' }], approveEach: false }]);
});

test('outlineSummary: count, a round after the first, and the why', () => {
  assert.equal(outlineSummary({ why: 'Two steps.', slices: [{}, {}] }, 1), '2 slices · Two steps.');
  assert.equal(outlineSummary({ why: '', slices: [{}] }, 2), '1 slice · v2');
  assert.equal(outlineSummary({ slices: [] }), '0 slices');
});

test('plan.edits on a re-ask starts the preview from them; edits that no longer apply are ignored', () => {
  const carried = setup({ pq: ask({ edits: [{ op: 'remove', id: 's1' }] }) });
  assert.deepEqual(titles(carried.$$), ['Slice s2']);
  assert.equal(carried.$('.outline-edit').getAttribute('aria-expanded'), 'false');
  assert.ok(carried.$('.outline-undo').hidden);
  carried.$('.outline-approve').click();
  assert.deepEqual(carried.calls.submit, [{ decision: 'approve', edits: [{ op: 'remove', id: 's1' }], approveEach: false }]);

  const stale = setup({ pq: ask({ edits: [{ op: 'remove', id: 'gone' }] }) });
  assert.deepEqual(titles(stale.$$), ['Slice s1', 'Slice s2']);
  assert.ok(stale.$('.outline-undo').hidden);

  const junk = setup({ pq: ask({ edits: [{ op: 'rename', id: 's1' }, null, { op: 'merge' }] }) });
  assert.deepEqual(titles(junk.$$), ['Slice s1', 'Slice s2']);

  const gateOff = setup({ pq: ask({ edits: [{ op: 'remove', id: 's1' }] }), extras: false });
  assert.deepEqual(titles(gateOff.$$), ['Slice s1', 'Slice s2'], 'edits are a gated feature');
});

test('the switch starts unticked (D19); ticking it posts approveEach:true; plan.approveEach:true starts it ticked', () => {
  const { $, calls } = setup();
  assert.equal($('.outline-approve-each input').checked, false);
  $('.outline-approve-each input').checked = true;
  $('.outline-approve').click();
  assert.deepEqual(calls.submit, [{ decision: 'approve', approveEach: true }]);

  const reask = setup({ pq: ask({ approveEach: true }) });
  assert.equal(reask.$('.outline-approve-each input').checked, true);
  const off = setup({ pq: ask({ approveEach: false }) });
  assert.equal(off.$('.outline-approve-each input').checked, false);
});

test('gate off: Don\'t slice posts flat', () => {
  const { $, calls } = setup({ extras: false });
  assert.equal($('.outline-flat').textContent, 'Don\'t slice');
  $('.outline-flat').click();
  assert.deepEqual(calls.submit, [{ decision: 'flat' }]);
});

test('gate off: the typed revise works, and an empty one shows the field error', () => {
  const { $, calls } = setup({ extras: false });
  $('.plan-revise').click();
  assert.equal(calls.submit.length, 0);
  assert.equal($('.plan-err').hidden, false);
  assert.equal($('.plan-err').textContent, 'Write what should change first');
  $('.plan-feedback').value = '  split the export out  ';
  $('.plan-revise').click();
  assert.deepEqual(calls.submit, [{ decision: 'revise', feedback: 'split the export out' }]);
});

test('gate off: Stop asks for confirmation, and posts only when confirmed', async () => {
  const yes = setup({ extras: false });
  yes.$('.plan-stop').click();
  await flush();
  assert.equal(yes.calls.confirm.length, 1);
  assert.equal(yes.calls.confirm[0].danger, true);
  assert.deepEqual(yes.calls.submit, [{ decision: 'stop' }]);
  const no = setup({ extras: false, confirm: async () => false });
  no.$('.plan-stop').click();
  await flush();
  assert.deepEqual(no.calls.submit, []);
});

test('plan.error shows in the alert', () => {
  const { $ } = setup({ pq: ask({ error: 'Could not set up the later slices: boom' }) });
  assert.equal($('.plan-err').hidden, false);
  assert.equal($('.plan-err').getAttribute('role'), 'alert');
  assert.equal($('.plan-err').textContent, 'Could not set up the later slices: boom');
});

test('a submit resolving false shows SEND_FAILED; a rejecting one too', async () => {
  const no = setup({ submit: async () => false });
  no.$('.outline-approve').click();
  await flush();
  assert.equal(no.$('.plan-err').textContent, SEND_FAILED);
  assert.equal(no.$('.plan-err').hidden, false);
  const boom = setup({ submit: async () => { throw new Error('x'); } });
  boom.$('.outline-approve').click();
  await flush();
  assert.equal(boom.$('.plan-err').textContent, SEND_FAILED);
});

test('a second click while a post is in flight posts nothing more', async () => {
  let release;
  const { $, calls } = setup({ submit: () => new Promise((r) => { release = r; }) });
  $('.outline-approve').click();
  $('.outline-approve').click();
  assert.equal(calls.submit.length, 1);
  release(true);
  await flush();
  $('.outline-approve').click();
  assert.equal(calls.submit.length, 2);
});

test('panel.__plan.setErrors paints and clears the alert', () => {
  const { panel, $ } = setup();
  panel.__plan.setErrors([{ message: 'one' }, { code: 'two' }, {}]);
  assert.equal($('.plan-err').textContent, 'one · two · invalid');
  assert.equal($('.plan-err').hidden, false);
  panel.__plan.setErrors([]);
  assert.equal($('.plan-err').hidden, true);
});

test('gate off: no merge/remove/switch/Fix, but Plan slice 1, Don\'t slice, Send changes and Stop are there', () => {
  const { $, $$, calls } = setup({ pq: ask({ outline: TINY }), extras: false });
  assert.equal($$('.outline-merge').length, 0);
  assert.equal($$('.outline-remove').length, 0);
  assert.equal($$('.outline-approve-each').length, 0);
  assert.equal($$('.plan-fix').length, 0);
  assert.ok($('.outline-undo').hidden);
  assert.ok($('.outline-approve'));
  assert.ok($('.outline-flat'));
  assert.ok($('.plan-revise'));
  assert.ok($('.plan-stop'));
  assert.deepEqual(titles($$), ['Slice s1', 'Slice s2'], 'the slices still show, read-only');
  $('.outline-approve').click();
  assert.deepEqual(calls.submit, [{ decision: 'approve' }]);
});

test('a plan that is not revisable has no typed box and no Fix', () => {
  const { $, $$ } = setup({ pq: ask({ revisable: false, outline: TINY }) });
  assert.ok(!$('.plan-feedback'));
  assert.ok(!$('.plan-revise'));
  assert.equal($$('.plan-fix').length, 0);
  assert.equal($('.plan-ask-changes'), null);
  assert.equal($$('.plan-fix-all').length, 0);
});

test('a plan with no outline renders an empty list without throwing', () => {
  const { $, $$ } = setup({ pq: { id: 'q', kind: 'plan', plan: {} } });
  assert.equal($$('.outline-slice').length, 0);
  assert.ok($('.outline-approve'));
});

test('button scale: outline-approve is a primary .btn, ⋯ a quiet icon .btn, every footer control a .btn', () => {
  const { $, $$ } = setup();
  for (const b of $$('.plan-actions > button')) assert.ok(b.classList.contains('btn'), b.className);
  assert.ok($('.outline-approve').classList.contains('btn-primary'));
  assert.ok($('.plan-more').classList.contains('btn-quiet') && $('.plan-more').classList.contains('btn-icon'));
});
