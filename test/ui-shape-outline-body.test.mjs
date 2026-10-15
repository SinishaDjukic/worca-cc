// test/ui-shape-outline-body.test.mjs — the slice outline ask's body (spec §3.8, screen 8): slices, local merge/remove
// preview, Undo edits, the approve-each switch, Don't slice, Fix, typed revise, Stop, and the gate-off fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderOutlineBody } from '../ui/public/shape/outline-body.mjs';
import { SEND_FAILED } from '../ui/public/shape/plan-body.mjs';
import { checkSlices, outlineFixFeedback } from '../src/shared/shape/slices.mjs';

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

function setup({ pq = ask(), extras = true, submit, confirm } = {}) {
  const panel = doc.createElement('div');
  panel.className = 'qpanel';
  const calls = { submit: [], confirm: [] };
  const deps = {
    doc, extras,
    submit: submit ? (p) => { calls.submit.push(p); return submit(p, panel); } : async (p) => { calls.submit.push(p); return true; },
    confirm: confirm ? (o) => { calls.confirm.push(o); return confirm(o); } : async (o) => { calls.confirm.push(o); return true; },
  };
  renderOutlineBody(panel, pq, deps);
  return { panel, calls, $: (s) => panel.querySelector(s), $$: (s) => [...panel.querySelectorAll(s)] };
}

const titles = ($$) => $$('.outline-slice-title').map((n) => n.textContent);

test('the slices, goals, acceptance and estimates render; the meta reads the count, round and check', () => {
  const { $, $$ } = setup();
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
  const { $, $$ } = setup({ pq: ask({ outline: lean }) });
  const li = $$('.outline-slice')[0];
  assert.ok(!li.querySelector('.outline-goal'));
  assert.ok(!li.querySelector('.outline-acceptance'));
  assert.ok(!li.querySelector('.outline-est'));
  assert.ok($('.outline-why').hidden);
});

test('Merge with next previews one slice, reads "Plan it as one", and approve posts the edit with approveEach', () => {
  const { $, $$, calls } = setup();
  assert.equal($$('.outline-merge').length, 1, 'never on the last slice');
  $$('.outline-merge')[0].click();
  assert.equal($('.plan-meta').textContent, '1 slice · v1 · Outline 4/5', 'one slice fails only the count check');
  assert.deepEqual(titles($$), ['Slice s1 + Slice s2']);
  assert.equal($('.outline-approve').textContent, 'Plan it as one');
  assert.equal($$('.outline-remove').length, 0, 'never on the only slice');
  assert.equal($$('.outline-merge').length, 0);
  $('.outline-approve').click();
  assert.deepEqual(calls.submit, [{ decision: 'approve', edits: [{ op: 'merge', id: 's1' }], approveEach: false }]);
});

test('Remove previews it and approve posts the removal', () => {
  const { $, $$, calls } = setup();
  $$('.outline-remove')[0].click();
  assert.deepEqual(titles($$), ['Slice s2']);
  assert.match($('.plan-meta').textContent, /^1 slice · v1 · Outline \d\/5$/);
  $('.outline-approve').click();
  assert.deepEqual(calls.submit, [{ decision: 'approve', edits: [{ op: 'remove', id: 's1' }], approveEach: false }]);
});

test('Undo edits is hidden with no edits, shows after one, and restores', () => {
  const { $, $$, calls } = setup();
  assert.ok($('.outline-undo').hidden);
  $$('.outline-remove')[0].click();
  assert.ok(!$('.outline-undo').hidden);
  $('.outline-undo').click();
  assert.ok($('.outline-undo').hidden);
  assert.deepEqual(titles($$), ['Slice s1', 'Slice s2']);
  assert.equal($('.plan-meta').textContent, '2 slices · v1 · Outline 5/5');
  assert.equal(calls.submit.length, 0, 'undo posts nothing');
  $('.outline-approve').click();
  assert.deepEqual(calls.submit, [{ decision: 'approve', approveEach: false }]);
});

test('plan.edits on a re-ask starts the preview from them; edits that no longer apply are ignored', () => {
  const carried = setup({ pq: ask({ edits: [{ op: 'remove', id: 's1' }] }) });
  assert.deepEqual(titles(carried.$$), ['Slice s2']);
  assert.ok(!carried.$('.outline-undo').hidden);
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

test('Don\'t slice posts flat', () => {
  const { $, calls } = setup();
  assert.equal($('.outline-flat').textContent, 'Don\'t slice');
  $('.outline-flat').click();
  assert.deepEqual(calls.submit, [{ decision: 'flat' }]);
});

test('Fix posts a revise whose feedback is outlineFixFeedback of the failing check', () => {
  const { $, $$, calls } = setup({ pq: ask({ outline: TINY }) });
  assert.match($('.plan-meta').textContent, /Outline 4\/5$/);
  assert.equal($$('.plan-fix').length, 1);
  assert.equal($('.outline-approve').textContent, 'Plan slice 1 anyway');
  $('.plan-fix').click();
  const item = checkSlices(TINY).items.find((i) => i.id === 'notTiny');
  assert.deepEqual(calls.submit, [{ decision: 'revise', feedback: outlineFixFeedback(item) }]);
  assert.match(calls.submit[0].feedback, /Rewrite the outline/);
  assert.doesNotMatch(calls.submit[0].feedback, /Fix the plan/);
});

test('the typed revise works, and an empty one shows the field error', () => {
  const { $, calls } = setup();
  $('.plan-revise').click();
  assert.equal(calls.submit.length, 0);
  assert.equal($('.plan-err').hidden, false);
  assert.equal($('.plan-err').textContent, 'Write what should change first');
  $('.plan-feedback').value = '  split the export out  ';
  $('.plan-revise').click();
  assert.deepEqual(calls.submit, [{ decision: 'revise', feedback: 'split the export out' }]);
});

test('Stop asks for confirmation, and posts only when confirmed', async () => {
  const yes = setup();
  yes.$('.plan-stop').click();
  await flush();
  assert.equal(yes.calls.confirm.length, 1);
  assert.equal(yes.calls.confirm[0].danger, true);
  assert.deepEqual(yes.calls.submit, [{ decision: 'stop' }]);
  const no = setup({ confirm: async () => false });
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
  no.$('.outline-flat').click();
  await flush();
  assert.equal(no.$('.plan-err').textContent, SEND_FAILED);
  assert.equal(no.$('.plan-err').hidden, false);
  const boom = setup({ submit: async () => { throw new Error('x'); } });
  boom.$('.outline-flat').click();
  await flush();
  assert.equal(boom.$('.plan-err').textContent, SEND_FAILED);
});

test('a second click while a post is in flight posts nothing more', async () => {
  let release;
  const { $, calls } = setup({ submit: () => new Promise((r) => { release = r; }) });
  $('.outline-flat').click();
  $('.outline-flat').click();
  assert.equal(calls.submit.length, 1);
  release(true);
  await flush();
  $('.outline-flat').click();
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
});

test('a plan with no outline renders an empty list without throwing', () => {
  const { $, $$ } = setup({ pq: { id: 'q', kind: 'plan', plan: {} } });
  assert.equal($$('.outline-slice').length, 0);
  assert.ok($('.outline-approve'));
});
