// test/ui-shape-outline-body.test.mjs — the outline ask, the Split step card (spec §3.8, screen 8; D30–D32;
// shaper-cards D1, D8, D9, D11, D14). One layout with the gate on and off: head, summary, compact runs with a per-run ⋯
// (Merge with next / Remove), Undo edits, the Ask-me-before-each-run switch, the folded check line, Ask for changes /
// Approve N runs / ⋯ (Fix all, Don't split, Stop). The UI says "run".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderOutlineBody, outlineSummary } from '../ui/public/shape/outline-body.mjs';
import { stepTitle } from '../ui/public/shape/step-card.mjs';
import { applyFlags } from '../ui/public/flags.mjs';
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

test('Satisfies line per slice, Left out line, the requirements check row; Merge unions, Remove moves ids to Left out', () => {
  const agreed = ['R-po-1', 'R-ux-1', 'R-qa-1', 'R-ops-1', 'R-sec-1'].map((id) => ({ id, text: id }));
  const outline = { ...OUTLINE, agreed,
    slices: [slice('s1', { requirements: ['R-po-1', 'R-ux-1'] }), slice('s2', { dependsOn: ['s1'], requirements: ['R-qa-1'] }), slice('s3', { requirements: [] })],
    leftOut: [{ id: 'R-sec-1', reason: 'Moved to a later feature' }, { id: 'R-ops-1', reason: '' }] };
  const { $, $$ } = setup({ pq: ask({ outline }) });
  const sat = () => $$('[data-kind="satisfies"]').map((n) => [n.closest('.outline-slice').dataset.slice, n.textContent, n.className]);
  assert.deepEqual(sat(), [['s1', 'Satisfies: R-po-1, R-ux-1', 'outline-goal'], ['s2', 'Satisfies: R-qa-1', 'outline-goal']]);
  const left = $('[data-kind="left-out"]');
  assert.equal(left.className, 'outline-goal');
  assert.equal(left.textContent, 'Left out: R-sec-1 — Moved to a later feature', 'an id not placed is the check row\'s');
  const row = $$('.plan-check-row').at(-1);
  assert.equal(row.classList.contains('ok'), false);
  assert.equal(row.querySelector('.plan-check-detail').textContent, 'R-ops-1 is in no run');
  assert.match($('.plan-check-line').textContent, /^Outline \d\/6 · \d to fix/);
  rowMenu($$, 0).pick('Merge with next');
  assert.deepEqual(sat(), [['s1', 'Satisfies: R-po-1, R-ux-1, R-qa-1', 'outline-goal']]);
  rowMenu($$, 0).pick('Remove');
  assert.deepEqual(sat(), []);
  assert.equal($('[data-kind="left-out"]').textContent,
    'Left out: R-sec-1 — Moved to a later feature; R-po-1 — Removed from the outline; R-ux-1 — Removed from the outline; R-qa-1 — Removed from the outline');
  const plain = setup();
  assert.equal(plain.$$('[data-kind="satisfies"]').length, 0);
  assert.equal(plain.$('[data-kind="left-out"]').hidden, true);
  assert.equal(plain.$$('.plan-check-row').length, 5);
});

// ── Small runs B4: the Split step (plan.smallRuns) ───────────────────────────────────────────────────────────────────
const srSlice = (id, requirements, o = {}) => slice(id, { requirements, ...o });
const SR_AGREED = ['R-po-1', 'R-po-2', 'R-qa-1', 'R-sec-1'].map((id) => ({ id, text: `text of ${id}` }));
const SR_REQS = SR_AGREED.map((a) => ({ id: a.id, text: a.text, example: `example of ${a.id}`, role: a.id.startsWith('R-qa') ? 'QA' : a.id.startsWith('R-sec') ? 'Security' : 'Product' }));
const SR_PASS = { why: 'w', slices: [srSlice('s1', ['R-po-1', 'R-po-2']), srSlice('s2', ['R-qa-1'], { dependsOn: ['s1'] })], agreed: SR_AGREED, leftOut: [],
  confirmed: [{ id: 'R-sec-1', role: 'Security' }] };
const SR_ROLE = { ...SR_PASS, confirmed: [{ id: 'R-sec-1', role: 'Legal' }] };
const SR_BROKEN = { ...SR_PASS, slices: [srSlice('s1', ['R-po-1', 'R-po-2']), srSlice('s2', ['R-po-2'], { dependsOn: ['s1'] })], confirmed: [{ id: 'R-sec-1', role: 'Legal' }] };
const CHALLENGE = (o = {}) => ({ roles: [
  { key: 'product', label: 'Product', findings: [{ id: 'f1', severity: 'major', section: 'split', fix: 'Merge runs 1 and 2', status: 'fixed', ids: [] }] },
  { key: 'qa', label: 'QA', findings: [] },
  { key: 'devil', label: 'Challenger', findings: [{ id: 'f2', severity: 'major', section: 'split', fix: 'Too many runs for one export', status: 'open', ids: [] }] },
], challenger: true, rounds: 1, open: 1, ...o });
const srAsk = (outline, care = 'balanced', o = {}) => ask({ outline, smallRuns: true, care, runSize: care === 'thorough' ? 2 : 3,
  requirements: SR_REQS, challenge: CHALLENGE({ open: 0, roles: CHALLENGE().roles.map((r) => ({ ...r, findings: r.findings.filter((f) => f.status !== 'open') })) }), ...o });

test('B4 refused, per Care: K checks failed, one row per (rule, id), no primary, no error text, fix-the-split head, focus on the row action', () => {
  for (const care of ['lean', 'balanced', 'thorough']) {
    const host = doc.createElement('div'); doc.body.appendChild(host);
    const panel = doc.createElement('div'); panel.className = 'qpanel'; host.appendChild(panel);
    const calls = [];
    renderOutlineBody(panel, srAsk(SR_BROKEN, care), { doc, title: 'Your turn: approve the runs', chip: 'Runs', submit: async (p) => { calls.push(p); return true; }, confirm: async () => true });
    const $ = (s) => panel.querySelector(s); const $$ = (s) => [...panel.querySelectorAll(s)];
    const failing = $$('.plan-checks .plan-check-row:not(.ok)');
    assert.deepEqual(failing.map((r) => r.querySelector('.plan-check-id').textContent), ['R-po-2', 'R-qa-1', 'R-sec-1'], care);
    assert.equal($('.plan-check-line .plan-fold-text').textContent, '3 checks failed');
    assert.equal($('.plan-checks').hidden, false, 'the checks fold opens');
    assert.equal($$('.btn-primary').length, 0, care);
    assert.equal($('.plan-err').textContent, '');
    assert.equal($('.ask-mcard-title').textContent, 'Your turn: fix the split');
    assert.ok($('.plan-ask-changes'));
    assert.deepEqual(failing.map((r) => r.querySelector('.split-confirm')?.textContent || null), [null, null, 'Ask the role to confirm']);
    assert.equal(doc.activeElement, failing[0].querySelector('button') || $('.plan-ask-changes'), 'focus on the first failing row\'s action');
    panel.__plan.setErrors([{ path: 'decision', code: 'split-not-approvable', message: 'The split cannot be approved: …' }]);
    assert.equal($('.plan-err').hidden, true, 'the refusal message is for API callers');
    host.remove();
  }
});

test('B4 confirm picked: "Security will confirm", the one Approve primary returns, the polite region announces once; Undo clears it', () => {
  const host = doc.createElement('div'); doc.body.appendChild(host);
  const panel = doc.createElement('div'); panel.className = 'qpanel'; host.appendChild(panel);
  const calls = [];
  let primaries = 0;
  panel.addEventListener('step-primary', () => { primaries += 1; });
  renderOutlineBody(panel, srAsk(SR_ROLE), { doc, title: 'Your turn: approve the runs', chip: 'Runs', submit: async (p) => { calls.push(p); return true; }, confirm: async () => true });
  const $ = (s) => panel.querySelector(s); const $$ = (s) => [...panel.querySelectorAll(s)];
  assert.equal(doc.activeElement, $('.split-confirm'));
  $('.split-confirm').click();
  const items = [...doc.querySelectorAll('.wfv-menu .wfv-menu-item')];
  assert.deepEqual(items.map((b) => b.textContent), ['Product', 'Engineering', 'Design', 'DevOps', 'Security', 'Compliance', 'QA']);
  items.find((b) => b.textContent === 'Security').click();
  const row = $$('.plan-checks .plan-check-row').find((r) => r.textContent.includes('Security will confirm'));
  assert.ok(row?.classList.contains('ok'));
  assert.equal(row.querySelector('.plan-check-id').textContent, 'R-sec-1');
  assert.equal($$('.btn-primary').length, 1);
  assert.equal($('.btn-primary').textContent, 'Approve 2 runs');
  assert.equal($('.split-live').getAttribute('aria-live'), 'polite');
  assert.equal($('.split-live').textContent, 'The split can be approved now');
  assert.equal($('.ask-mcard-title').textContent, 'Your turn: approve the runs');
  assert.ok(primaries >= 2);
  $('.btn-primary').click();
  assert.deepEqual(calls[0], { decision: 'approve', edits: [{ op: 'confirm', id: 'R-sec-1', role: 'Security' }] });
  $('.outline-undo').click();
  assert.equal($$('.btn-primary').length, 0);
  assert.equal($('.split-live').textContent, '');
  host.remove();
});

test('B4 runs: fold rows with Owns, Starts from and Checked by, the ⋯ outside the fold button, no approveEach switch, the Care row', () => {
  const { $, $$, calls } = setup({ pq: srAsk(SR_PASS) });
  const toggles = $$('.outline-run-fold');
  assert.equal(toggles.length, 2);
  assert.equal(toggles[0].getAttribute('aria-expanded'), 'false');
  toggles[0].click();
  assert.equal(toggles[0].getAttribute('aria-expanded'), 'true');
  const facts = $$('.outline-slice')[0].querySelector('.outline-run-facts');
  assert.equal(facts.hidden, false);
  assert.deepEqual([...facts.querySelectorAll('.rd-kv-k')].map((k) => k.textContent), ['Owns', 'Starts from', 'Checked by']);
  // R-fit-3: B3's and the prototype's wording, "R-x · text e.g. …" on one line per requirement.
  assert.deepEqual([...facts.querySelectorAll('.outline-own')].map((o) => o.textContent),
    ['R-po-1 · text of R-po-1 e.g. example of R-po-1', 'R-po-2 · text of R-po-2 e.g. example of R-po-2']);
  assert.match(facts.textContent, /the feature branch: it starts first/);
  assert.match($$('.outline-run-facts')[1].textContent, /the latest finished run · waits for 1 run/);
  assert.match($$('.outline-run-facts')[1].textContent, /Checked byQA/);
  // R-fit-3: the row reads its number (the id column) and its R-ids comma-joined, as the prototype's splitRow.
  assert.deepEqual($$('.outline-run-fold .outline-run-num').map((n) => n.textContent), ['1', '2']);
  assert.deepEqual($$('.outline-run-fold .outline-run-ids').map((n) => n.textContent), ['R-po-1, R-po-2', 'R-qa-1']);
  for (const m of $$('.outline-row-more')) assert.equal(m.closest('.outline-run-fold'), null);
  assert.equal($('.outline-approve-each'), null);
  assert.equal($('.sw-input'), null);
  assert.equal($('.split-care .rd-kv-v').textContent, 'Balanced · chosen at the start');
  assert.equal($('.outline-summary').textContent, '2 runs proposed, one after another');
  assert.equal($('.plan-check-line .plan-fold-text').textContent, '9 checks passed');
  assert.equal($('.btn-primary').getAttribute('title'), 'Starts run 1; the rest follow one after another');
  $('.btn-primary').click();
  assert.deepEqual(calls.submit[0], { decision: 'approve' }, 'no approveEach');
});

test('B4 objections: one question with Keep the split preset, each open objection once, Ask for changes makes Send changes; one challenge fold', () => {
  const { $, $$, panel, calls } = setup({ pq: srAsk(SR_PASS, 'balanced', { challenge: CHALLENGE() }) });
  assert.equal($$('.chat-q').length, 1);
  assert.equal($('.qopt[data-preset="1"]').textContent.includes('Keep the split'), true);
  assert.equal(panel.textContent.split('Too many runs for one export').length - 1, 1, 'the open objection appears once');
  assert.equal($$('.split-challenge-line').length, 1);
  assert.equal($('.split-challenge-line .plan-fold-text').textContent, 'Challenged by 2 roles and the Challenger · 1 change');
  $('.split-challenge-line').click();
  assert.match($('.split-challenge-line').nextElementSibling.textContent, /Merge runs 1 and 2/);
  assert.match($('.split-challenge-line').nextElementSibling.textContent, /QA: no objection/);
  assert.equal($('.btn-primary').textContent, 'Approve 2 runs');
  [...panel.querySelectorAll('.qopt')].find((b) => b.textContent.includes('Ask for changes')).click();
  assert.equal($$('.btn-primary').length, 1);
  assert.equal($('.btn-primary').textContent, 'Send changes');
  $('.btn-primary').click();
  assert.equal(calls.submit[0].decision, 'revise');
  assert.match(calls.submit[0].feedback, /- Challenger: Too many runs for one export/);
  const keep = setup({ pq: srAsk(SR_PASS, 'balanced', { challenge: CHALLENGE() }) });
  keep.$('.btn-primary').click();
  assert.deepEqual(keep.calls.submit[0], { decision: 'approve', openObjections: 'kept' });
});

test('B4: no challenge round draws one "Not challenged" line; Lean says "Challenged by N roles"; the refused cap shows its head line', () => {
  const none = setup({ pq: srAsk(SR_PASS, 'balanced', { challenge: { roles: [], challenger: true, rounds: 0, open: 0 } }) });
  assert.equal(none.$('.split-challenge-line'), null);
  assert.equal(none.$('.split-not-challenged').textContent, 'Not challenged: no review step in this workflow');
  const lean = setup({ pq: srAsk(SR_PASS, 'lean', { challenge: { roles: [{ key: 'product', label: 'Product', findings: [] }, { key: 'security', label: 'Security', findings: [] }], challenger: false, rounds: 1, open: 0 } }) });
  assert.equal(lean.$('.split-challenge-line .plan-fold-text').textContent, 'Challenged by 2 roles');
  const capped = setup({ pq: srAsk(SR_BROKEN, 'balanced', { revisable: false, round: 5 }) });
  assert.equal(capped.$('.plan-ask-changes'), null);
  assert.equal(capped.$('.split-cap').hidden, false);
  assert.equal(capped.$('.split-cap').textContent, 'Too many rounds: plan it as one or stop');
  assert.equal(setup({ pq: srAsk(SR_PASS) }).$('.split-cap').hidden, true);
});

test('B4 keyboard: picking "Ask for changes" by key repaints the primary as Send changes (no click)', () => {
  const { $, panel, calls } = setup({ pq: srAsk(SR_PASS, 'balanced', { challenge: CHALLENGE() }) });
  const tiles = [...panel.querySelectorAll('.qopt')];
  const keep = tiles.find((b) => b.textContent.includes('Keep the split'));
  keep.focus();
  keep.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal($('.btn-primary').textContent, 'Send changes');
  $('.btn-primary').click();
  assert.equal(calls.submit[0].decision, 'revise');
  keep.focus();
  keep.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal($('.btn-primary').textContent, 'Approve 2 runs');
});

test('B4 title: a split asked refused (stepTitle) reads "fix the split" until a role pick fixes it, then "approve the runs"', () => {
  const pq = srAsk(SR_ROLE);
  const title = stepTitle({ ...pq, kind: 'plan' });
  assert.equal(title, 'Your turn: fix the split');
  const panel = doc.createElement('div'); panel.className = 'qpanel'; doc.body.appendChild(panel);
  renderOutlineBody(panel, pq, { doc, title, chip: 'Runs', submit: async () => true, confirm: async () => true });
  assert.equal(panel.querySelector('.ask-mcard-title').textContent, 'Your turn: fix the split');
  panel.querySelector('.split-confirm').click();
  [...doc.querySelectorAll('.wfv-menu .wfv-menu-item')].find((b) => b.textContent === 'Security').click();
  assert.equal(panel.querySelector('.ask-mcard-title').textContent, 'Your turn: approve the runs');
  // fit-1-3: the picked row is rebuilt; focus moves on to the Approve primary that is back.
  assert.equal(doc.activeElement, panel.querySelector('.btn-primary'));
  panel.remove();
});

test('B4 repaint (fit-1-3): an unfolded run stays open after an edit', () => {
  const three = { ...SR_PASS, slices: [srSlice('s1', ['R-po-1']), srSlice('s2', ['R-po-2'], { dependsOn: ['s1'] }), srSlice('s3', ['R-qa-1'], { dependsOn: ['s2'] })] };
  const panel = doc.createElement('div'); panel.className = 'qpanel'; doc.body.appendChild(panel);
  renderOutlineBody(panel, srAsk(three), { doc, title: 'Your turn: approve the runs', chip: 'Runs', submit: async () => true, confirm: async () => true });
  const fold = (id) => panel.querySelector(`[data-slice="${id}"] .outline-run-fold`);
  fold('s3').click();
  panel.querySelector('[data-slice="s1"] .outline-row-more').click();
  [...doc.querySelectorAll('.wfv-menu .wfv-menu-item')].find((b) => b.textContent === 'Merge with next').click();
  assert.equal(fold('s3').getAttribute('aria-expanded'), 'true');
  assert.equal(panel.querySelector('[data-slice="s3"] .outline-run-facts').hidden, false);
  assert.equal(fold('s1').getAttribute('aria-expanded'), 'false');
  panel.remove();
});

test('B4 challenge fold: a disputed objection reason appears once', () => {
  const challenge = CHALLENGE({ open: 0, roles: [{ key: 'qa', label: 'QA', findings: [{ id: 'f9', severity: 'major', section: 'split', fix: 'Split run 2', status: 'disputed', reason: 'Run 2 is one behaviour', ids: [] }] }] });
  const { $, panel } = setup({ pq: srAsk(SR_PASS, 'balanced', { challenge }) });
  $('.split-challenge-line').click();
  assert.equal(panel.textContent.split('Run 2 is one behaviour').length - 1, 1);
});

test('B4 after a send-back: the round-2 question says the objections were raised before the changes', () => {
  const { $ } = setup({ pq: srAsk(SR_PASS, 'balanced', { challenge: CHALLENGE(), round: 2 }) });
  assert.match($('.split-objections').textContent, /1 objection was raised before your changes/);
});

test('owner direction d5c0afe48: every Split list draws in the one shared row layout', () => {
  const { $, $$ } = setup({ pq: srAsk(SR_BROKEN) });
  assert.ok($('.split-body').classList.contains('srows'));
  // check rows: the 16px mark box first; the id column only on a row with an id (its texts line up with the other id
  // rows), a rule row without one puts its label right after the mark (owner walk, finding 7)
  const checkRows = [...$('.split-body > .plan-check-line:not(.split-challenge-line) + .plan-checks').querySelectorAll('.plan-check-row')];
  const withId = checkRows.filter((row) => row.querySelector(':scope > .plan-check-id'));
  const withoutId = checkRows.filter((row) => !row.querySelector(':scope > .plan-check-id'));
  assert.ok(withId.length > 0 && withoutId.length > 0, 'the fixture mixes id rows and rule rows');
  for (const row of checkRows) assert.ok(row.firstElementChild.classList.contains('plan-check-mark'), row.textContent);
  for (const row of withId) {
    assert.ok(row.querySelector(':scope > .plan-check-id + .plan-check-text'), row.textContent);
    assert.notEqual(row.querySelector(':scope > .plan-check-id').textContent, '', row.textContent);
  }
  for (const row of withoutId) assert.ok(row.firstElementChild.nextElementSibling.classList.contains('plan-check-label'), row.textContent);
  // run rows: the wait mark, then the fold button holding the id column and the text, the ⋯ beside it
  for (const row of $$('.outline-run-row')) {
    assert.ok(row.firstElementChild.classList.contains('plan-check-mark'));
    assert.ok(row.firstElementChild.classList.contains('is-wait'));
    assert.ok(row.querySelector(':scope > .outline-run-fold > .plan-check-id + .plan-check-text'));
  }
});

test('owner d3ef1cb79 #1: a check list with no ids draws no id column; the challenge rows put their text after the mark', () => {
  const { $, $$ } = setup({ pq: srAsk(SR_PASS) });
  const rows = $$('.plan-checks .plan-check-row');
  assert.ok(rows.length > 0);
  for (const row of rows) assert.equal(row.querySelector('.plan-check-id'), null, row.textContent);
  $('.split-challenge-line').click();
  const challengeRows = [...$('.split-challenge-line').nextElementSibling.querySelectorAll('.plan-check-row')];
  assert.ok(challengeRows.length > 0);
  for (const row of challengeRows) assert.equal(row.querySelector('.plan-check-id'), null, row.textContent);
});

test('owner d3ef1cb79 #2: Split check sentences are regular weight in ink; role and run names keep 600', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../ui/public/shape/shape-it.css', import.meta.url), 'utf8');
  assert.match(css, /\.srows \.plan-check-label\{[^}]*font-weight:400[^}]*color:var\(--ink\)/);
  assert.match(css, /\.srows \.outline-run-fold \.outline-slice-title\{[^}]*font-weight:600/);
});

test('owner d3ef1cb79 #3: each open objection is a shared row: ? mark, the role in the id column, the fix, the state right-aligned', () => {
  const { $ } = setup({ pq: srAsk(SR_PASS, 'balanced', { challenge: CHALLENGE() }) });
  const rows = [...$('.split-objections').querySelectorAll('.plan-check-row')];
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.firstElementChild.classList.contains('plan-check-mark'), true);
  assert.equal(row.firstElementChild.textContent, '?');
  assert.equal(row.querySelector(':scope > .plan-check-id').textContent, 'Challenger');
  assert.equal(row.querySelector(':scope > .plan-check-text .plan-check-label').textContent, 'Too many runs for one export');
  assert.equal(row.lastElementChild.classList.contains('split-objection-state'), true);
  assert.equal(row.lastElementChild.textContent, 'major · open');
  assert.equal($('.split-objections .plan-findings'), null, 'no second, differently drawn list');
});

test('owner d3ef1cb79 #4: Ask for changes is quiet; while the objections question shows, its pick is the one way to ask', () => {
  const plain = setup({ pq: srAsk(SR_PASS) });
  assert.ok(plain.$('.plan-ask-changes').classList.contains('btn-quiet'));
  assert.equal(plain.$('.plan-ask-changes').hidden, false);
  const { $, $$, panel } = setup({ pq: srAsk(SR_PASS, 'balanced', { challenge: CHALLENGE() }) });
  assert.equal($('.plan-ask-changes').hidden, true);
  assert.equal($$('.plan-actions .btn-primary').length, 1);
  [...panel.querySelectorAll('.qopt')].find((b) => b.textContent.includes('Ask for changes')).click();
  assert.equal($('.btn-primary').textContent, 'Send changes');
  // refused: the question hides, so the quiet Ask for changes is the way back again
  const refused = setup({ pq: srAsk(SR_ROLE, 'balanced', { challenge: CHALLENGE() }) });
  assert.equal(refused.$('.split-objections > :not(.split-objection-rows)').hidden, true);
  assert.equal(refused.$('.plan-ask-changes').hidden, false);
});

test('B4 refused, rendered before the host attaches it (fresh open, live arrival): the focus lands once it is shown', async () => {
  const panel = doc.createElement('div'); panel.className = 'qpanel';
  doc.activeElement?.blur?.();
  renderOutlineBody(panel, srAsk(SR_ROLE), { doc, title: 'Your turn: fix the split', chip: 'Runs', submit: async () => true, confirm: async () => true });
  doc.body.appendChild(panel);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(doc.activeElement, panel.querySelector('.split-confirm'));
  panel.remove();
});

test('B4 refused beats open objections: no Keep the split question while refused; it comes back with the primary', () => {
  const host = doc.createElement('div'); doc.body.appendChild(host);
  const panel = doc.createElement('div'); panel.className = 'qpanel'; host.appendChild(panel);
  renderOutlineBody(panel, srAsk(SR_ROLE, 'balanced', { challenge: CHALLENGE() }), { doc, title: 'Your turn: fix the split', chip: 'Runs', submit: async () => true, confirm: async () => true });
  const $ = (s) => panel.querySelector(s);
  assert.equal($('.split-objections > :not(.split-objection-rows)').hidden, true);
  assert.equal(reachable((s) => [...panel.querySelectorAll(s)]).filter((b) => b.textContent.includes('Keep the split')).length, 0);
  assert.equal(panel.querySelectorAll('.btn-primary').length, 0);
  $('.split-confirm').click();
  [...doc.querySelectorAll('.wfv-menu .wfv-menu-item')].find((b) => b.textContent === 'Security').click();
  assert.equal($('.split-objections > :not(.split-objection-rows)').hidden, false);
  assert.equal(panel.querySelectorAll('.btn-primary').length, 1, 'the primary follows the question again');
  // Undo edits hides itself: the focus goes back to the failing row's action, not to <body>.
  $('.outline-undo').focus();
  $('.outline-undo').click();
  assert.equal($('.split-objections > :not(.split-objection-rows)').hidden, true);
  assert.equal(doc.activeElement, $('.split-confirm'));
  host.remove();
});

test('B4 refused: the open objections stay on the card as rows (the ? mark, the role, the fix, open), with no Keep/approve choice', () => {
  const { $, panel } = setup({ pq: srAsk(SR_ROLE, 'balanced', { challenge: CHALLENGE() }) });
  const wrap = $('.split-objections');
  assert.equal(wrap.hidden, false);
  assert.equal(wrap.closest('[hidden]'), null);
  const rows = [...wrap.querySelectorAll('.split-objection-rows .plan-check-row')];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].closest('[hidden]'), null);
  assert.equal(rows[0].querySelector('.plan-check-mark').textContent, '?');
  assert.equal(rows[0].querySelector('.plan-check-id').textContent, 'Challenger');
  assert.match(rows[0].querySelector('.split-objection-state').textContent, /open$/);
  const visibleKeep = [...panel.querySelectorAll('.qopt')].filter((b) => b.textContent.includes('Keep the split') && !b.closest('[hidden]'));
  assert.equal(visibleKeep.length, 0);
});

test('B1 one-line run rows are 32px: scoped under the chat member host, they outrank group-page.css and leave it dev\'s', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../ui/public/shape/shape-it.css', import.meta.url), 'utf8');
  const host = String.raw`\.chat-rc-members \.run-members`;
  // (0,5,0) beats `.run-members.is-table > .run-member{…padding:8px 0}` (0,3,0); 1px top border + 5 + 20 + 6 = 32.
  assert.match(css, new RegExp(String.raw`${host}\.is-table\.is-one-line > \.run-member\{[^}]*min-height:32px[^}]*padding:5px 0 6px[^}]*line-height:20px`));
  // 1280: the short state shares the title's 20px line box (a baseline row made it 21px, the row 33px).
  assert.match(css, new RegExp(String.raw`${host}\.is-one-line \.run-member-main\{[^}]*align-items:center`));
  // The 16px mark column and 8px gap, restated with dev's column list per width, in cascade order.
  const table = String.raw`${host}\.is-table\.is-one-line`;
  const cols = [
    String.raw`\n${table}\{grid-template-columns:16px 20px minmax\(0,1fr\) max-content 16px;column-gap:8px;\}`,
    String.raw`@container chat-rc-members \(width > 480px\)\{\s*${table}\{grid-template-columns:16px 20px minmax\(0,1fr\) max-content 64px 16px;\}`,
    String.raw`@media \(max-width:600px\)\{\s*${table}\{grid-template-columns:16px 20px minmax\(0,1fr\) max-content;\}`,
    String.raw`@container chat-rc-members \(width <= 360px\)\{\s*${table}\{grid-template-columns:16px 20px minmax\(0,1fr\) max-content;\}`,
  ].map((re) => { const m = css.match(new RegExp(re)); assert.ok(m, re); return m.index; });
  assert.deepEqual(cols, [...cols].sort((a, b) => a - b));
  // 375: a row with no PR chip and no cost keeps one grid row (the empty ". . pr cost" row plus its gap made it 41px),
  // at the phone width and in the chat card's narrow container alike.
  const empty = String.raw`${table} > \.run-member:has\(> \.run-member-pr:empty\):has\(> \.run-member-cost:empty\)`;
  assert.match(css, new RegExp(String.raw`@media \(max-width:600px\)\{[^}]*\}\s*${empty}\{grid-template-areas:"dot num main go";\}`));
  assert.match(css, new RegExp(String.raw`@container chat-rc-members \(width <= 360px\)\{[^}]*\}\s*${empty}\{grid-template-areas:"dot num main main";\}`));
  assert.match(css, new RegExp(String.raw`${empty} > :is\(\.run-member-pr, \.run-member-cost\)\{display:none;\}`));
  // C2: a narrow row WITH a PR chip or a cost stays one line too (the prototype's #build rows): the chip takes the last
  // column, the cost is dropped, at the phone width and in the narrow container alike.
  for (const at of [String.raw`@media \(max-width:600px\)`, String.raw`@container chat-rc-members \(width <= 360px\)`]) {
    const block = css.match(new RegExp(String.raw`${at}\{[^]*?\n\}`, 'g')).find((b) => b.includes('"dot num main pr"'));
    assert.ok(block, at);
    assert.match(block, new RegExp(String.raw`${table} > \.run-member\{grid-template-areas:"dot num main pr";\}`));
    assert.match(block, /\.run-member-cost\)\{display:none;\}/);
  }
  // No selector starts with .run-member (the split tool would hand it to runs/group-page), and the group table is dev's.
  assert.deepEqual(css.split('\n').filter((l) => /^\s*\.run-member/.test(l)), []);
  const groupCss = await readFile(new URL('../ui/public/runs/group-page.css', import.meta.url), 'utf8');
  for (const text of ['is-one-line', '--member-', '.run-member-state']) assert.ok(!groupCss.includes(text), text);
});

test('item 7: the feature page\'s one-line rows have their own twins under .gpage-runs: 32px, one line at every width, group-page.css untouched', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../ui/public/shape/shape-it.css', import.meta.url), 'utf8');
  const host = String.raw`\.gpage-runs \.run-members`;
  const table = String.raw`${host}\.is-table\.is-one-line`;
  assert.match(css, new RegExp(String.raw`${table} > \.run-member\{[^}]*min-height:32px[^}]*padding:5px 0 6px[^}]*line-height:20px`));
  assert.match(css, new RegExp(String.raw`${host}\.is-one-line \.run-member-main\{[^}]*flex-direction:row[^}]*align-items:center`));
  assert.match(css, new RegExp(String.raw`${host}\.is-one-line \.run-member-title\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;\}`));
  assert.match(css, new RegExp(String.raw`\ndiv${table}\{grid-template-columns:16px 20px minmax\(0,1fr\) max-content 64px 16px;column-gap:8px;\}`));
  // Narrow: one line, the PR chip in the last column, no cost. The container query is a range form (the gates read
  // group-page.css's first max-width block by its text).
  for (const at of [String.raw`@media \(max-width:600px\)`, String.raw`@container gpage-runs \(width <= 480px\)`]) {
    const block = css.match(new RegExp(String.raw`${at}\{[^]*?\n\}`, 'g')).find((b) => b.includes('.gpage-runs .run-members'));
    assert.ok(block, at);
    assert.match(block, new RegExp(String.raw`${table}\{grid-template-columns:16px 20px minmax\(0,1fr\) max-content;`));
    assert.match(block, new RegExp(String.raw`${table} > \.run-member\{grid-template-areas:"dot num main pr";\}`));
    assert.match(block, /\.run-member-cost\)\{display:none;\}/);
  }
  assert.doesNotMatch(css, /@container gpage-runs \(max-width/);
  assert.deepEqual(css.split('\n').filter((l) => /^\s*\.gpage/.test(l)), [], 'a rule that starts with .gpage would move to runs/group-page');
});

test('B4 phone width: the Split\'s fold lines wrap inside the card (the challenge line overflowed at 375px)', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../ui/public/shape/shape-it.css', import.meta.url), 'utf8');
  assert.match(css, /\.srows > \.plan-check-line\{[^}]*max-width:100%[^}]*white-space:normal/);
  assert.match(css, /\.srows > \.plan-check-line \.plan-fold-text\{[^}]*min-width:0/);
  const { $ } = setup({ pq: srAsk(SR_PASS, 'balanced', { challenge: CHALLENGE() }) });
  assert.equal($('.split-challenge-line').parentElement, $('.split-body'));
});

// ── Slice 11 (R-po-6): the Split row's Starts from names the runs ────────────────────────────────────────────────────
const S11_IDS = ['R-po-1', 'R-po-2', 'R-po-3', 'R-po-4', 'R-po-5', 'R-po-6', 'R-po-7'];
const s11Outline = () => ({ why: 'w', agreed: S11_IDS.map((id) => ({ id, text: `text of ${id}` })), leftOut: [], confirmed: [],
  slices: S11_IDS.map((id, i) => srSlice(`s${i + 1}`, [id], { dependsOn: i === 6 ? ['s6', 's4'] : i === 1 ? ['s1'] : [] })) });
const startsOf = ($$) => $$('.outline-slice').map((s) => [...s.querySelectorAll('.outline-run-facts .rd-kv-row')]
  .find((r) => r.querySelector('.rd-kv-k').textContent === 'Starts from')?.querySelector('.rd-kv-v').textContent);
const openAll = ($$) => $$('.outline-run-fold').forEach((b) => { if (b.getAttribute('aria-expanded') !== 'true') b.click(); });

test('S11-T6 flag on: dependsOn s6, s4 reads "waits for runs 4, 6"; one dependency "run 1"; none "no run"; an edit renumbers live', () => {
  applyFlags({ shaperSmallRuns: true }, doc);
  try {
    const { $$ } = setup({ pq: srAsk(s11Outline()) });
    openAll($$);
    const t = startsOf($$);
    assert.equal(t[0], 'the feature branch: it starts first');
    assert.equal(t[1], 'the latest finished run · waits for run 1');
    assert.equal(t[2], 'the latest finished run · waits for no run');
    assert.equal(t[6], 'the latest finished run · waits for runs 4, 6');
    rowMenu($$, 4).pick('Remove');
    openAll($$);
    assert.equal(startsOf($$)[5], 'the latest finished run · waits for runs 4, 5');
  } finally { applyFlags({ shaperSmallRuns: false }, doc); }
});

test('S11-T7 flag off: run 3 still reads "waits for 2 runs"', () => {
  applyFlags({ shaperSmallRuns: false }, doc);
  const { $$ } = setup({ pq: srAsk(s11Outline()) });
  openAll($$);
  assert.equal(startsOf($$)[2], 'the latest finished run · waits for 2 runs');
  assert.equal(startsOf($$)[6], 'the latest finished run · waits for 6 runs');
});
