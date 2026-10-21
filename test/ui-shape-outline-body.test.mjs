// test/ui-shape-outline-body.test.mjs — the outline ask, the Split step card (spec §3.8, screen 8; D30–D32;
// shaper-cards D1, D8, D9, D11, D14). One layout with the gate on and off: head, summary, compact runs with a per-run ⋯
// (Merge with next / Remove), Undo edits, the Ask-me-before-each-run switch, the folded check line, Ask for changes /
// Approve N runs / ⋯ (Fix all, Don't split, Stop). The UI says "run".
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
    doc, run, extras, title: 'Your turn: approve the runs', chip: 'Runs',
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
// Opens run i's ⋯ and returns its item labels; pick(label) clicks one.
function rowMenu($$, i) {
  $$('.outline-row-more')[i].click();
  const items = [...doc.querySelectorAll('.wfv-menu .wfv-menu-item')];
  return { labels: items.map((b) => b.textContent), pick: (l) => items.find((b) => b.textContent === l).click() };
}
// The text a person sees: hidden regions and the runs' own titles (fixture data) left out.
function visibleText(panel) {
  const copy = panel.cloneNode(true);
  for (const n of copy.querySelectorAll('[hidden], .outline-slice-title')) n.remove();
  return copy.textContent;
}

test('gate on and off: the same card — head, runs, goals and estimates, one number per row (the CSS counter)', () => {
  const on = setup();
  const off = setup({ extras: false });
  const shape = ({ $, $$ }) => [$('.ask-mcard-title').textContent, $('.ask-mcard-kind').textContent, $('.outline-summary').textContent,
    ...titles($$), ...$$('.plan-actions > button').map((b) => b.textContent), $$('.outline-row-more').length];
  assert.deepEqual(shape(off), shape(on));
  const { $, $$ } = off;
  assert.equal($('.ask-mcard-title').textContent, 'Your turn: approve the runs');
  assert.equal($('.ask-mcard-kind').textContent, 'Runs');
  assert.deepEqual(titles($$), ['Slice s1', 'Slice s2']);
  assert.equal($$('.outline-slice')[1].dataset.slice, 's2');
  assert.equal($$('.outline-goal')[0].textContent, 'Make s1 possible for people');
  assert.equal($$('.outline-acceptance').length, 0, 'the list is compact');
  assert.deepEqual($$('.outline-est').map((n) => n.textContent), ['medium', 'large']);
  assert.deepEqual($$('.outline-est').map((n) => n.className), ['badge grey outline-est', 'badge grey outline-est'], 'run 4 D9: a size is neither amber nor green');
  assert.equal($$('.outline-slice-n').length, 0, 'no second number in the markup');
  assert.equal($('.outline-approve').textContent, 'Approve 2 runs');
  assert.ok($('.outline-undo').hidden);
  assert.deepEqual($$('.plan-actions > button').map((b) => b.textContent || b.getAttribute('aria-label')), ['Ask for changes', 'Approve 2 runs', 'More for these runs']);
});

test('a slice with no goal, estimate or acceptance renders none of those parts', () => {
  const lean = { why: '', slices: [slice('s1', { goal: '', acceptance: [], estimate: null }), slice('s2')] };
  const card = setup({ pq: ask({ outline: lean }) });
  const row = card.$$('.outline-slice')[0];
  assert.ok(!row.querySelector('.outline-goal'));
  assert.ok(!row.querySelector('.outline-est'));
  assert.equal(card.$('.outline-summary').textContent, '2 runs');
});

test('closed: summary, compact runs, folded check line, Stop only in ⋯, box closed, no "slice" in sight', () => {
  const { $, $$, panel } = setup();
  assert.ok(panel.querySelector('.plan-body.plan-card.outline-body'));
  assert.equal($('.outline-summary').textContent, '2 runs · The change is large and cuts across three subsystems.');
  assert.equal($('.plan-check-line .plan-fold-text').textContent, 'Outline 5/5');
  assert.equal($('.plan-check-line').getAttribute('aria-expanded'), 'false');
  assert.ok($('.plan-checks').hidden, 'checks folded');
  assert.equal($('.plan-stop'), null);
  assert.ok($('.plan-feedback').closest('[hidden]'), 'the text box is closed');
  assert.equal($$('.outline-merge').length + $$('.outline-remove').length, 0, 'Merge and Remove live in the per-run ⋯');
  assert.equal($('.outline-flat'), null, 'Don\'t split lives in ⋯');
  assert.equal($$('.btn-primary').length, 1);
  assert.deepEqual(reachable($$).map((n) => n.className.replace(/^btn /, '').split(' ').pop() || n.type),
    ['outline-row-more', 'outline-row-more', 'sw-input', 'plan-ask-changes', 'outline-approve', 'plan-more']);
  assert.equal($$('.outline-row-more')[1].getAttribute('aria-label'), 'More for run 2');
  assert.equal($('.outline-approve-each').textContent.trim(), 'Ask me before each run');
  assert.doesNotMatch(visibleText(panel), /slice/i);
});

test('the check line expands to neutral ✓ / ✕ rows; Fix all in ⋯ posts the outline fix', () => {
  const { $, $$, calls } = setup({ pq: ask({ outline: TINY }) });
  assert.equal($('.plan-check-line .plan-fold-text').textContent, 'Outline 4/5 · 1 to fix');
  assert.equal($('.outline-approve').textContent, 'Approve 2 runs', 'never "anyway" (D32)');
  $('.plan-check-line').click();
  assert.equal($('.plan-checks').hidden, false);
  assert.equal($('.plan-check-line').getAttribute('aria-expanded'), 'true');
  assert.deepEqual($$('.plan-check-mark').map((m) => m.getAttribute('aria-label')), ['met', 'met', 'met', 'unmet', 'met']);
  assert.ok($$('.plan-check-mark').every((m) => m.querySelector('svg') && m.textContent === ''), 'the marks are icons, not ✓ / ✕ characters');
  assert.equal($$('.plan-check-row.ok').length, 4);
  assert.equal($$('.plan-fix').length + $$('.plan-fix-all').length, 0, 'no Fix button in the body');
  menu($).pick('Fix all');
  const item = checkSlices(TINY).items.find((i) => i.id === 'notTiny');
  assert.deepEqual(calls.submit, [{ decision: 'revise', feedback: outlineFixFeedback(item) }], 'one failure: today\'s Fix answer');
  assert.equal(outlineFixAllFeedback(checkSlices(TINY).items), outlineFixFeedback(item));
  assert.match(calls.submit[0].feedback, /Rewrite the outline/);
  assert.doesNotMatch(calls.submit[0].feedback, /Fix the plan/);
  assert.equal(setup({ pq: ask({ outline: TINY }), extras: false }).$('.outline-approve').textContent, 'Approve 2 runs');
});

test('the open check rows say "run", never "slice"; one run left points at Don\'t split', () => {
  const { $, $$, panel } = setup({ pq: ask({ outline: TINY }) });
  $('.plan-check-line').click();
  assert.deepEqual($$('.plan-check-label').map((n) => n.textContent), [
    'Two to five runs (six to eight need a reason)',
    'Every run has 1–6 testable acceptance checks',
    'Runs are behaviours, not layers',
    'No two small runs side by side',
    'Each run depends only on earlier runs',
  ]);
  assert.equal($('.plan-check-detail').textContent, 'Runs 1 and 2 are both small: merge them');
  rowMenu($$, 0).pick('Merge with next');
  assert.equal($('.plan-check-detail').textContent, 'One run is no split: choose Don\'t split');
  assert.doesNotMatch(visibleText(panel), /slic/i);
  assert.match(checkSlices(TINY).items[0].label, /slices/, 'the Planner\'s check text is unchanged');
  const quoted = setup({ pq: ask({ outline: { ...OUTLINE, slices: [slice('s1', { title: 'Slice export', acceptance: [] }), slice('s2')] } }) });
  quoted.$('.plan-check-line').click();
  assert.equal(quoted.$('.plan-check-detail').textContent, '"Slice export" has no acceptance check', 'a quoted title stays as written');
});

test('Ask for changes opens the box and focuses it; Send changes posts the revise', () => {
  const { $, calls } = setup();
  const askBtn = $('.plan-ask-changes');
  assert.equal(askBtn.getAttribute('aria-expanded'), 'false');
  askBtn.click();
  assert.equal(askBtn.getAttribute('aria-expanded'), 'true');
  assert.equal(askBtn.hidden, true, 'run 4 D8: the button gives way to the field');
  assert.equal($('.plan-feedback').closest('[hidden]'), null);
  assert.deepEqual([...$('.plan-typed').querySelectorAll('button')].map((b) => b.textContent), ['Cancel', 'Send changes']);
  $('.plan-typed-cancel').click();
  assert.equal($('.plan-typed').hidden, true);
  assert.equal(askBtn.hidden, false);
  askBtn.click();
  $('.plan-revise').click();
  assert.equal($('.plan-err').textContent, 'Write what should change first');
  $('.plan-feedback').value = '  split the export out  ';
  $('.plan-revise').click();
  assert.deepEqual(calls.submit, [{ decision: 'revise', feedback: 'split the export out' }]);
});

test('⋯ holds Don\'t split (plan it as one), which posts flat, and Stop; Fix all only with an unmet check', async () => {
  for (const extras of [true, false]) {
    const { $, calls } = setup({ extras });
    const m = menu($);
    assert.deepEqual(m.labels, ['Don\'t split (plan it as one)', 'Stop']);
    m.pick('Don\'t split (plan it as one)');
    assert.deepEqual(calls.submit, [{ decision: 'flat' }]);
  }
  assert.deepEqual(menu(setup({ pq: ask({ outline: TINY }) }).$).labels, ['Fix all', 'Don\'t split (plan it as one)', 'Stop']);
  assert.ok(setup({ pq: ask(), run: { workspaceId: 'w1' } }).$('.plan-more'), 'a workspace run keeps ⋯');
});

test('Stop in ⋯ asks for confirmation, and posts only when confirmed', async () => {
  const yes = setup({ extras: false });
  menu(yes.$).pick('Stop');
  await flush();
  assert.equal(yes.calls.confirm.length, 1);
  assert.equal(yes.calls.confirm[0].danger, true);
  assert.deepEqual(yes.calls.submit, [{ decision: 'stop' }]);
  const no = setup({ confirm: async () => false });
  menu(no.$).pick('Stop');
  await flush();
  assert.deepEqual(no.calls.submit, []);
});

test('the per-run ⋯: Merge with next (never on the last run) / Remove; the primary follows the count', () => {
  const three = { ...OUTLINE, slices: [slice('s1'), slice('s2'), slice('s3')] };
  const m = setup({ pq: ask({ outline: three }) });
  assert.equal(m.$('.outline-approve').textContent, 'Approve 3 runs');
  assert.deepEqual(rowMenu(m.$$, 0).labels, ['Merge with next', 'Remove']);
  assert.deepEqual(rowMenu(m.$$, 2).labels, ['Remove'], 'the last run has no Merge with next');
  assert.ok(m.$('.outline-undo').hidden, 'Undo only after an edit');
  rowMenu(m.$$, 0).pick('Merge with next');
  assert.deepEqual(titles(m.$$), ['Slice s1 + Slice s2', 'Slice s3']);
  assert.equal(m.$('.outline-approve').textContent, 'Approve 2 runs');
  assert.equal(m.$('.outline-summary').textContent, '2 runs · The change is large and cuts across three subsystems.');
  assert.equal(m.$('.outline-undo').hidden, false);
  rowMenu(m.$$, 0).pick('Merge with next');
  assert.equal(m.$('.outline-approve').textContent, 'Plan it as one');
  assert.equal(m.$('.outline-summary').textContent, '1 run · The change is large and cuts across three subsystems.');
  assert.equal(m.$$('.outline-row-more').length, 0, 'one run left: no Remove, no Merge with next');
  m.$('.outline-approve').click();
  assert.deepEqual(m.calls.submit, [{ decision: 'approve', edits: [{ op: 'merge', id: 's1' }, { op: 'merge', id: 's1' }], approveEach: false }]);

  const removed = setup();
  rowMenu(removed.$$, 0).pick('Remove');
  assert.deepEqual(titles(removed.$$), ['Slice s2']);
  removed.$('.outline-approve').click();
  assert.deepEqual(removed.calls.submit, [{ decision: 'approve', edits: [{ op: 'remove', id: 's1' }], approveEach: false }]);
});

test('Undo edits restores and posts nothing', () => {
  const { $, $$, calls } = setup();
  rowMenu($$, 0).pick('Remove');
  assert.equal($('.outline-undo').hidden, false);
  $('.outline-undo').click();
  assert.deepEqual(titles($$), ['Slice s1', 'Slice s2']);
  assert.ok($('.outline-undo').hidden);
  assert.equal(calls.submit.length, 0);
});

test('outlineSummary: count, a round after the first, and the why', () => {
  assert.equal(outlineSummary({ why: 'why', slices: [{}, {}, {}] }, 2), '3 runs · v2 · why');
  assert.equal(outlineSummary({ why: 'Two steps.', slices: [{}, {}] }, 1), '2 runs · Two steps.');
  assert.equal(outlineSummary({ why: '', slices: [{}] }, 2), '1 run · v2');
  assert.equal(outlineSummary({ slices: [] }), '0 runs');
});

test('plan.edits on a re-ask starts the preview from them, gate on and off; edits that no longer apply are ignored', () => {
  for (const extras of [true, false]) {
    const carried = setup({ extras, pq: ask({ edits: [{ op: 'remove', id: 's1' }] }) });
    assert.deepEqual(titles(carried.$$), ['Slice s2']);
    assert.equal(carried.$('.outline-undo').hidden, false, 'the carried edit can be undone');
    carried.$('.outline-approve').click();
    assert.deepEqual(carried.calls.submit, [{ decision: 'approve', edits: [{ op: 'remove', id: 's1' }], approveEach: false }]);
  }

  const stale = setup({ pq: ask({ edits: [{ op: 'remove', id: 'gone' }] }) });
  assert.deepEqual(titles(stale.$$), ['Slice s1', 'Slice s2']);
  assert.ok(stale.$('.outline-undo').hidden);

  const junk = setup({ pq: ask({ edits: [{ op: 'rename', id: 's1' }, null, { op: 'merge' }] }) });
  assert.deepEqual(titles(junk.$$), ['Slice s1', 'Slice s2']);
});

test('the switch starts unticked (D19), gate on and off; the approve posts approveEach false or true', () => {
  const off = setup({ extras: false });
  assert.equal(off.$('.outline-approve-each input').checked, false);
  off.$('.outline-approve').click();
  assert.deepEqual(off.calls.submit, [{ decision: 'approve', approveEach: false }]);
  const { $, calls } = setup();
  assert.equal($('.outline-approve-each input').checked, false);
  $('.outline-approve-each input').checked = true;
  $('.outline-approve').click();
  assert.deepEqual(calls.submit, [{ decision: 'approve', approveEach: true }]);

  const reask = setup({ pq: ask({ approveEach: true }) });
  assert.equal(reask.$('.outline-approve-each input').checked, true);
  const unticked = setup({ pq: ask({ approveEach: false }) });
  assert.equal(unticked.$('.outline-approve-each input').checked, false);
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

test('plan.error shows in the alert', () => {
  const { $ } = setup({ pq: ask({ error: 'Could not set up the later slices: boom' }) });
  assert.equal($('.plan-err').hidden, false);
  assert.equal($('.plan-err').getAttribute('role'), 'alert');
  assert.equal($('.plan-err').textContent, 'Could not set up the later slices: boom');
});

test('a submit resolving the server\'s reason keeps the typed text and says "Not sent: …"', async () => {
  const { $ } = setup({ submit: async () => 'this question is no longer pending' });
  $('.plan-ask-changes').click();
  $('.plan-feedback').value = 'fewer runs';
  $('.plan-revise').click();
  await flush();
  assert.equal($('.plan-err').textContent, 'Not sent: this question is no longer pending');
  assert.equal($('.plan-feedback').value, 'fewer runs');
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

test('a plan that is not revisable has no typed box and no Fix', () => {
  const { $, $$ } = setup({ pq: ask({ revisable: false, outline: TINY }) });
  assert.ok(!$('.plan-feedback'));
  assert.ok(!$('.plan-revise'));
  assert.equal($$('.plan-fix').length, 0);
  assert.equal($('.plan-ask-changes'), null);
  assert.equal($$('.plan-fix-all').length, 0);
  assert.ok(!menu($).labels.includes('Fix all'), 'no Fix all on the last round');
});

test('a plan with no outline renders an empty list without throwing', () => {
  const { $, $$ } = setup({ pq: { id: 'q', kind: 'plan', plan: {} } });
  assert.equal($$('.outline-slice').length, 0);
  assert.ok($('.outline-approve'));
});

test('run 4 D9: the approve-each switch is the shared switch', () => {
  const { $ } = setup();
  assert.equal($('.outline-approve-each input').getAttribute('role'), 'switch');
});
