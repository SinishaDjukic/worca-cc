// test/run-model.test.mjs — the one run model over every row of spec §2.1 (single and group), PR state and count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runModel, groupModel, prState, RUN_STATES, ACTION_LABEL } from '../src/shared/run-model.mjs';
import { ICONS } from '../ui/public/icons.mjs';
import { checkRows } from './helpers/rows.mjs';

const agent = (id, key, stage, label) => ({ id, kind: 'agent', key, label, progressStage: stage,
  ports: { inputs: [], outputs: [{ id: 'out', when: 'always' }] } });
const STEPPER = { version: 2, template: { id: 'wf_t' }, graph: { wires: [], nodes: [
  agent('n_clarify', 'clarify', 'plan', 'Clarify'), agent('n_plan', 'planner', 'plan', 'Plan'),
  agent('n_impl', 'implementer', 'build', 'Implementation'), agent('n_review', 'reviewer', 'review', 'Review Implementation'),
  { id: 'n_end', kind: 'end', key: null, label: 'End', ports: { inputs: [], outputs: [] } }] } };
const row = (nodeId, status = 'done', o = 1) => ({ executionId: `x:${nodeId}:${o}`, nodeId, ordinal: o, cycle: o, kind: 'cycle',
  status, startedAt: '2026-10-18T09:00:00.000Z' });
const live = (nodeId) => ({ nodeId, executionId: `x:${nodeId}:1` });
const R = (o = {}) => ({ stepper: STEPPER, status: 'running', steps: [], active: [], endReached: false, tokens: {},
  progressFacts: { tasks: {}, reviews: {} }, pendingQuestion: null, ...o });
const OPTS = { now: Date.parse('2026-10-18T12:00:00Z'), timeZone: 'UTC' };
const inBuild = { steps: [row('n_clarify'), row('n_plan'), row('n_impl', 'start')], active: [live('n_impl')] };
const PR = { url: 'https://github.com/acme/app/pull/759', number: 759, state: 'OPEN' };

const SINGLE = [
  ['starting', R({ status: 'starting' }), 'peach', true, 'Starting', ['stop'], null],
  ['working', R(inBuild), 'peach', true, 'Build · step: Implementation', ['pause', 'stop'], null],
  ['needs-you', R({ steps: [row('n_clarify', 'start')], active: [live('n_clarify')],
    pendingQuestion: { kind: 'clarify', questions: [{}, {}] } }), 'amber', false, 'Plan · needs you: 2 questions', ['answer', 'stop'], 'question'],
  ['paused', R({ ...inBuild, status: 'paused', steps: [row('n_clarify'), row('n_plan'), row('n_impl', 'paused')], active: [],
    pauseReason: 'usage_limit' }), 'grey', false, 'Build · paused: usage limit', ['resume', 'stop'], null],
  ['waiting', { ticket: { status: 'scheduled', runAt: '2026-10-18T21:00:00Z' } }, 'grey-ring', false, 'Waiting · starts 21:00', ['start-now', 'cancel'], null],
  ['failed', R({ status: 'error', steps: [row('n_clarify'), row('n_plan'), row('n_impl'), row('n_review', 'error')] }),
    'red', false, 'Review · failed: Review Implementation', ['retry', 'report'], 'alert'],
  ['stopped', R({ status: 'stopped', steps: [row('n_clarify'), row('n_plan'), row('n_impl', 'stopped')] }),
    'dark-grey', false, 'Stopped at Build', ['archive'], null],
  ['ready', R({ status: 'done', endReached: true, steps: [row('n_plan'), row('n_impl'), row('n_review')] }), 'green', false, 'Ready to ship', ['ship'], null],
  ['in-review', R({ status: 'done', endReached: true, pr: PR }), 'green', false, 'In review · PR #759', ['open-pr'], null],
  ['merged', R({ status: 'done', endReached: true, pr: { ...PR, state: 'MERGED' } }), 'violet', false, 'Merged', ['archive'], null],
];

test('spec §2.1, single run: dot, pulse, status line, actions and symbol for every state', async () => {
  assert.equal(SINGLE.length, 10);
  await checkRows(SINGLE.map(([state, run, dot, pulse, line, actions, symbol]) => ({ name: state, run: () => {
    const m = runModel(run, OPTS);
    assert.deepEqual({ state: m.state, dot: m.dot, pulse: m.pulse, line: m.line, actions: m.actions, symbol: m.symbol },
      { state, dot, pulse, line, actions, symbol });
    assert.equal(m.word, RUN_STATES[state].word);
    for (const a of m.actions) assert.ok(ACTION_LABEL[a], `${a} has a label`);
  } })));
});

test('symbol: question for Needs you, alert for Failed, null for the other 8, with their aria words', () => {
  const sym = Object.entries(RUN_STATES).filter(([, s]) => s.symbol);
  assert.deepEqual(sym.map(([id, s]) => [id, s.symbol, s.word]), [['needs-you', 'question', 'Needs you'], ['failed', 'alert', 'Failed']]);
  assert.equal(Object.values(RUN_STATES).filter((s) => s.symbol === null).length, 8);
});

const member = (run, extra = {}) => ({ ...run, ...extra });
const DONE = R({ status: 'done', endReached: true });
const GROUP = [
  ['starting', [R({ status: 'starting' }), { ticket: { status: 'scheduled', after: { index: 1 } } }, { ticket: { status: 'scheduled', after: { index: 2 } } }], 'Run 1 of 3 · starting'],
  ['working', [DONE, R(inBuild), { ticket: { status: 'scheduled', after: { index: 2 } } }], 'Run 2 of 3 · Build'],
  ['needs-you', [DONE, DONE, R({ pendingQuestion: { kind: 'plan', plan: {} }, steps: [row('n_plan', 'start')], active: [live('n_plan')] })], 'Run 3 of 3 · needs you'],
  ['paused', [DONE, R({ status: 'paused', steps: [row('n_impl', 'paused')] }), { ticket: { status: 'scheduled', after: { index: 2 } } }], 'Run 2 of 3 · paused'],
  ['waiting', [DONE, { ticket: { status: 'scheduled', after: { index: 1 } } }, { ticket: { status: 'scheduled', after: { index: 2 } } }], 'Run 2 of 3 · waiting for run 1'],
  ['failed', [DONE, R({ status: 'error', steps: [row('n_review', 'error')] }), { ticket: { status: 'missed' } }], 'Run 2 of 3 · failed'],
  ['stopped', [DONE, R({ status: 'stopped', steps: [row('n_impl', 'stopped')] }), { ticket: { status: 'canceled' } }], 'Stopped at run 2 of 3'],
  ['ready', [DONE, DONE, DONE], '3 of 3 done · ready to ship'],
  ['in-review', [member(DONE, { pr: PR }), member(DONE, { pr: { ...PR, number: 760 } }), member(DONE, { pr: { ...PR, number: 761 } })], 'In review · 3 PRs'],
  ['merged', [member(DONE, { pr: { ...PR, state: 'MERGED' } }), member(DONE, { pr: { ...PR, state: 'MERGED' } }), member(DONE, { pr: { ...PR, state: 'MERGED' } })], 'Merged'],
];

test('spec §2.1, group: the current member decides; finished groups use their own state', async () => {
  assert.equal(GROUP.length, 10);
  await checkRows(GROUP.map(([state, members, line]) => ({ name: state, run: () => {
    const g = groupModel({ kind: 'chain', title: 'Dark mode', members }, OPTS);
    assert.equal(g.state, state);
    assert.equal(g.line, line);
    assert.deepEqual(g.actions, runModel(SINGLE.find((r) => r[0] === state)[1], OPTS).actions);
    assert.equal(g.symbol, RUN_STATES[state].symbol);
  } })));
});

test('group: shipped as one PR reads "In review · 1 PR"; count "2/3" leaves Planning out; the bar counts Planning', () => {
  const one = groupModel({ kind: 'feature', members: [DONE, DONE, DONE], pr: PR }, OPTS);
  assert.equal(one.line, 'In review · 1 PR');
  const g = groupModel({ kind: 'feature', planning: DONE, members: [DONE, DONE, R(inBuild)] }, OPTS);
  assert.equal(g.count.text, '2/3');
  assert.ok(Math.abs(g.progress.fraction - (3 + g.current.progress.fraction) / 4) < 1e-9);
  const p = groupModel({ kind: 'feature', planning: R({ pendingQuestion: { kind: 'plan', plan: { outline: true } },
    steps: [row('n_plan', 'start')], active: [live('n_plan')] }), members: [{ ticket: { status: 'scheduled' } }] }, OPTS);
  assert.equal(p.line, 'Planning · needs you');
  assert.equal(p.count.text, '0/1');
});

test('edge rows: restart, interruption, step named like its stage, no-stage workflow, closed PR, tomorrow', async () => {
  const paused = (o) => runModel(R({ status: 'paused', steps: [row('n_impl', 'paused')], ...o }), OPTS).line;
  await checkRows([
    { name: 'drain', run: () => assert.equal(paused({ pauseReason: 'drain' }), 'Build · paused: restart') },
    { name: 'interrupted', run: () => assert.equal(runModel(R({ status: 'interrupted', steps: [row('n_impl', 'start')] }), OPTS).line, 'Build · paused: interrupted') },
    { name: 'manual pause', run: () => assert.equal(paused({ pauseReason: null }), 'Build · paused') },
    { name: 'error pause reads plain paused', run: () => assert.equal(paused({ pauseReason: 'error' }), 'Build · paused') },
    { name: 'cost pause', run: () => assert.equal(paused({ pauseReason: 'cost_pipeline' }), 'Build · paused: cost limit') },
    { name: 'planner "Plan"', run: () => assert.equal(runModel(R({ steps: [row('n_plan', 'start')], active: [live('n_plan')] }), OPTS).line, 'Plan') },
    { name: 'no stage', run: () => {
      const stepper = { version: 2, graph: { wires: [], nodes: [{ id: 'n_defrag', kind: 'agent', key: 'memoryDefragmenter', label: 'Memory defragment', ports: { inputs: [], outputs: [] } }] } };
      assert.equal(runModel(R({ stepper, steps: [row('n_defrag', 'start')], active: [live('n_defrag')] }), OPTS).line, 'Step: Memory defragment');
    } },
    { name: 'closed PR', run: () => {
      const m = runModel(R({ status: 'done', endReached: true, pr: { ...PR, state: 'CLOSED' } }), OPTS);
      assert.equal(m.state, 'ready');
      assert.equal(m.pr.word, 'Closed');
    } },
    { name: 'tomorrow', run: () => assert.equal(runModel({ ticket: { status: 'scheduled', runAt: '2026-10-19T03:00:00Z' } }, OPTS).line, 'Waiting · starts Mon 03:00') },
  ]);
});

test('prState: five states, icon + word + colour, the number in the title only', async () => {
  await checkRows([
    [{ ...PR, draft: true }, 'draft', 'Draft', 'pull-request-draft', 'ink-2'],
    [PR, 'ready', 'Ready', 'pull-request', 'green-ink'],
    [{ ...PR, reviewDecision: 'CHANGES_REQUESTED' }, 'changes', 'Changes requested', 'pull-request', 'amber-ink'],
    [{ ...PR, state: 'MERGED' }, 'merged', 'Merged', 'merge', 'violet-ink'],
    [{ ...PR, state: 'CLOSED' }, 'closed', 'Closed', 'pull-request-closed', 'red-ink'],
  ].map(([pr, id, word, icon, tone]) => ({ name: id, run: () => {
    assert.deepEqual(prState(pr), { id, word, icon, tone, number: 759, url: PR.url, title: 'PR #759 · open on GitHub' });
    assert.ok(Object.hasOwn(ICONS, icon), `${icon} is in the icon set`);
  } })));
  assert.equal(prState(null), null);
});
