// test/run-model.test.mjs — the one run model over every row of spec §2.1 (single and group), PR state and count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runModel, groupModel, prState, RUN_STATES, ACTION_LABEL, finishedNeedsYou, memberPrState } from '../src/shared/run-model.mjs';
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
  ['working', R(inBuild), 'peach', true, 'Build · step · Implementation', ['pause', 'stop'], null],
  ['needs-you', R({ steps: [row('n_clarify', 'start')], active: [live('n_clarify')],
    pendingQuestion: { kind: 'clarify', questions: [{}, {}] } }), 'amber', false, 'Plan · needs you · 2 questions', ['answer', 'stop'], 'question'],
  ['paused', R({ ...inBuild, status: 'paused', steps: [row('n_clarify'), row('n_plan'), row('n_impl', 'paused')], active: [],
    pauseReason: 'usage_limit' }), 'grey', false, 'Build · paused · usage limit', ['resume', 'stop'], null],
  ['waiting', { ticket: { status: 'scheduled', runAt: '2026-10-18T21:00:00Z' } }, 'grey-ring', false, 'Waiting · starts 21:00', ['start-now', 'cancel'], null],
  ['failed', R({ status: 'error', steps: [row('n_clarify'), row('n_plan'), row('n_impl'), row('n_review', 'error')] }),
    'red', false, 'Review · failed · Review Implementation', ['retry', 'report'], 'alert'],
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
    { name: 'drain', run: () => assert.equal(paused({ pauseReason: 'drain' }), 'Build · paused · restart') },
    { name: 'interrupted', run: () => assert.equal(runModel(R({ status: 'interrupted', steps: [row('n_impl', 'start')] }), OPTS).line, 'Build · paused · interrupted') },
    { name: 'manual pause', run: () => assert.equal(paused({ pauseReason: null }), 'Build · paused') },
    { name: 'error pause reads plain paused', run: () => assert.equal(paused({ pauseReason: 'error' }), 'Build · paused') },
    { name: 'cost pause', run: () => assert.equal(paused({ pauseReason: 'cost_pipeline' }), 'Build · paused · cost limit') },
    { name: 'planner "Plan"', run: () => assert.equal(runModel(R({ steps: [row('n_plan', 'start')], active: [live('n_plan')] }), OPTS).line, 'Plan') },
    { name: 'no stage', run: () => {
      const stepper = { version: 2, graph: { wires: [], nodes: [{ id: 'n_defrag', kind: 'agent', key: 'memoryDefragmenter', label: 'Memory defragment', ports: { inputs: [], outputs: [] } }] } };
      assert.equal(runModel(R({ stepper, steps: [row('n_defrag', 'start')], active: [live('n_defrag')] }), OPTS).line, 'Step · Memory defragment');
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
    assert.deepEqual(prState(pr), { id, word, icon, tone, number: 759, url: PR.url, title: 'PR #759 · open on GitHub', needsYou: false });
    assert.ok(Object.hasOwn(ICONS, icon), `${icon} is in the icon set`);
  } })));
  assert.equal(prState(null), null);
});

test('waiting line: "starts after run N" for an after-ticket, the clock for a timed one (D29)', () => {
  assert.equal(runModel({ ticket: { status: 'scheduled', runAt: null, after: { index: 1 } } }).line, 'Waiting · starts after run 1');
  assert.equal(runModel({ ticket: { status: 'scheduled', runAt: null, after: null } }).line, 'Waiting');
});

const ghPr = (extra = {}) => ({ url: 'https://github.com/o/r/pull/781', number: 781, state: 'OPEN', ...extra });
const FAIL = { state: 'failing', total: 12, failed: 3, pending: 0 };
const RUN = { state: 'pending', total: 12, failed: 0, pending: 4 };

test('PR chip: one word per state (§2.1a)', () => {
  const word = (pr) => prState(pr).word;
  assert.equal(word(ghPr({ state: 'MERGED', checks: FAIL })), 'Merged');
  assert.equal(word(ghPr({ state: 'CLOSED', mergeable: 'CONFLICTING' })), 'Closed');
  assert.equal(word(ghPr({ mergeable: 'CONFLICTING', checks: FAIL })), 'Conflicts');
  assert.equal(word(ghPr({ checks: FAIL, reviewDecision: 'CHANGES_REQUESTED' })), 'Checks failing');
  assert.equal(word(ghPr({ reviewDecision: 'CHANGES_REQUESTED', checks: RUN })), 'Changes requested');
  assert.equal(word(ghPr({ checks: RUN, draft: true })), 'Checks running');
  assert.equal(word(ghPr({ fixing: true, draft: true })), 'Fixing');
  assert.equal(word(ghPr({ draft: true })), 'Draft');
  assert.equal(word(ghPr({ checks: { state: 'passing', total: 12, failed: 0, pending: 0 } })), 'Ready');
});

test('PR chip: a live fix run turns Conflicts / Checks failing into Fixing; tones and tooltips', () => {
  assert.equal(prState(ghPr({ checks: FAIL, fixing: true })).id, 'fixing');
  assert.equal(prState(ghPr({ mergeable: 'CONFLICTING', fixing: true })).id, 'fixing');
  assert.equal(prState(ghPr({ checks: FAIL })).tone, 'red-ink');
  assert.equal(prState(ghPr({ mergeable: 'CONFLICTING' })).tone, 'red-ink');
  assert.equal(prState(ghPr({ checks: RUN })).tone, 'ink-2');
  assert.equal(prState(ghPr({ fixing: true })).tone, 'ink-2');
  assert.equal(prState(ghPr({ checks: FAIL })).title, '3 of 12 checks failed · PR #781');
  assert.equal(prState(ghPr({ checks: RUN })).title, '4 of 12 checks running · PR #781');
  assert.equal(prState(ghPr({ mergeable: 'CONFLICTING' })).title, 'Conflicts with the base branch · PR #781');
});

test('Checks failing or Conflicts make a finished run Needs you ("?"), unless a fix run is live', () => {
  for (const pr of [ghPr({ checks: FAIL }), ghPr({ mergeable: 'CONFLICTING' })]) {
    const m = runModel({ status: 'done', pr });
    assert.deepEqual([m.state, m.symbol, m.prNeeds, m.actions, m.line], ['needs-you', 'question', true, ['open-pr'], 'In review · PR #781']);
  }
  const fixing = runModel({ status: 'done', pr: ghPr({ checks: FAIL, fixing: true }) });
  assert.deepEqual([fixing.state, fixing.prNeeds, fixing.pr.word], ['in-review', false, 'Fixing']);
  assert.equal(runModel({ status: 'done', pr: ghPr({ checks: RUN }) }).state, 'in-review');
  assert.equal(runModel({ status: 'running', steps: [{ nodeId: 'n' }], pr: ghPr({ checks: FAIL }) }).state, 'working', 'a live run is not raised');
});

test('a slice whose PR fails checks raises the group to Needs you but still counts as done (D31)', () => {
  const g = groupModel({ kind: 'feature', members: [
    { status: 'done', pr: ghPr({ state: 'MERGED' }) },
    { status: 'done', pr: ghPr({ checks: FAIL }) },
    { ticket: { status: 'scheduled', runAt: null, after: { index: 2 } } }] });
  assert.equal(g.count.text, '2/3');
  assert.equal(g.state, 'needs-you');
  assert.equal(g.line, 'Run 2 of 3 · needs you');
  assert.deepEqual(g.actions, ['open-pr'], 'no question to answer, nothing to stop');
  assert.equal(g.prNeeds, false, 'slice 3 still waits: the group is not finished');
});

test('D22 rounds: "Running · Round 2 · STAGE", the request for a Watch PR round; round 1 and finished runs unchanged', () => {
  const r2 = runModel(R({ ...inBuild, round: { n: 2, request: 'add a tag filter', by: 'person' } }), OPTS);
  assert.deepEqual([r2.state, r2.line, r2.lineSaysState, r2.actions], ['working', 'Running · Round 2 · Build', true, ['pause', 'stop']]);
  // The raw marker the Shaper feature writes (branch.roundOf) reads the same.
  const w = runModel(R({ ...inBuild, branch: { feature: 'feat/x', roundOf: { pipelineId: 'p1', round: 2, request: 'fix failing checks', by: 'watch' } } }), OPTS);
  assert.equal(w.line, 'Running · Round 2 · fix failing checks');
  assert.equal(runModel(R({ ...inBuild, round: { n: 1, request: 'x' } }), OPTS).line, 'Build · step · Implementation', 'round 1 is the run itself');
  const ask = runModel(R({ steps: [row('n_clarify', 'start')], active: [live('n_clarify')], round: { n: 3 },
    pendingQuestion: { kind: 'clarify', questions: [{}, {}] } }), OPTS);
  assert.equal(ask.line, 'Round 3 · Plan · needs you · 2 questions');
  assert.equal(runModel(R({ status: 'done', endReached: true, pr: PR, round: { n: 2 } }), OPTS).line, 'In review · PR #759');
  const g = groupModel({ kind: 'feature', members: [{ status: 'done' }, R({ ...inBuild, round: { n: 2 } }), { ticket: { status: 'scheduled', after: { index: 2 } } }] }, OPTS);
  assert.equal(g.line, 'Run 2 of 3 · round 2 · Build');
  assert.equal(g.members.length, 3, 'a round adds no member');
  assert.equal(g.count.text, '1/3');
});

test('D23 Watch PR: a live fix round reads Fixing and never Needs you; a stopped watch is Needs you with its own line and actions', () => {
  const fixing = runModel({ status: 'done', pr: ghPr({ checks: FAIL }), watch: { status: 'fixing', reason: null, fixRuns: 1 } });
  assert.deepEqual([fixing.state, fixing.symbol, fixing.pr.word, fixing.prNeeds, fixing.actions], ['in-review', null, 'Fixing', false, ['open-pr']]);
  for (const status of ['starting', 'publishing']) assert.equal(runModel({ status: 'done', pr: ghPr({ checks: FAIL }), watch: { status } }).pr.word, 'Fixing');
  const stopped = runModel({ status: 'done', pr: ghPr({ checks: FAIL }), watch: { status: 'needs-person', reason: 'cap', fixRuns: 3 } });
  assert.deepEqual([stopped.state, stopped.symbol, stopped.prNeeds, stopped.line, stopped.actions],
    ['needs-you', 'question', true, 'Needs you · Watch stopped · 3 fix runs, checks still failing', ['open-pr', 'ask-changes']]);
  assert.equal(ACTION_LABEL['ask-changes'], 'Ask for changes');
  assert.equal(runModel({ status: 'done', pr: ghPr(), watch: { status: 'needs-person', reason: 'fix-failed', fixRuns: 1 } }).line,
    'Needs you · Watch stopped · 1 fix run, the last fix run failed');
  assert.equal(runModel({ status: 'done', pr: ghPr({ state: 'MERGED' }), watch: { status: 'needs-person', reason: 'cap', fixRuns: 3 } }).state, 'merged');
  assert.equal(runModel({ status: 'done', pr: ghPr(), watch: { status: 'watching' } }).state, 'in-review', 'a quiet watch changes nothing');
  assert.equal(runModel(R({ ...inBuild, watch: { status: 'needs-person', reason: 'cap', fixRuns: 3 } }), OPTS).state, 'working', 'a live run is never raised');
  // The list reads the same rule (its Needs you section and the sidebar count).
  assert.equal(finishedNeedsYou({ status: 'done', pr: ghPr(), watch: { status: 'needs-person', reason: 'cap', fixRuns: 3 } }), true);
  assert.equal(finishedNeedsYou({ status: 'done', pr: ghPr({ checks: FAIL }), watch: { status: 'fixing' } }), false);
  assert.equal(finishedNeedsYou({ status: 'done', pr: ghPr({ checks: FAIL }) }), true);
  // A group whose current member stopped its watch offers that member's actions and still counts it as done.
  const g = groupModel({ kind: 'feature', members: [{ status: 'done', pr: ghPr({ state: 'MERGED' }) },
    { status: 'done', pr: ghPr(), watch: { status: 'needs-person', reason: 'cap', fixRuns: 3 } }] });
  assert.deepEqual([g.state, g.count.text, g.actions], ['needs-you', '2/2', ['open-pr', 'ask-changes']]);
});

test('one wording per state: no status line has a colon form; a paused-after-restart run reads "Paused · interrupted"', () => {
  const noStage = { version: 2, graph: { wires: [], nodes: [{ id: 'n_x', kind: 'agent', key: 'x', label: 'Defrag', ports: { inputs: [], outputs: [] } }] } };
  const runs = [
    ...SINGLE.map((r) => r[1]),
    ...['usage_limit', 'cost_pipeline', 'cost_total', 'cost_pipeline_policy', 'cost_total_policy', 'drain', 'error', null]
      .map((pauseReason) => R({ status: 'paused', steps: [row('n_impl', 'paused')], pauseReason })),
    R({ status: 'interrupted', steps: [row('n_impl', 'start')] }),
    R({ status: 'pausing', steps: [row('n_impl', 'start')], active: [live('n_impl')] }),
    R({ stepper: noStage, status: 'interrupted', steps: [row('n_x', 'start')] }),
    R({ stepper: noStage, steps: [row('n_x', 'start')], active: [live('n_x')] }),
    R({ stepper: noStage, steps: [row('n_x', 'start')], active: [live('n_x')], pendingQuestion: { kind: 'gate' } }),
    R({ stepper: noStage, status: 'error', steps: [row('n_x', 'error')] }),
  ];
  for (const run of runs) {
    const { line } = runModel(run, OPTS);
    assert.ok(!line.includes(': '), `colon form: ${line}`);
  }
  assert.equal(runModel(R({ stepper: noStage, status: 'interrupted', steps: [row('n_x', 'start')] }), OPTS).line, 'Paused · interrupted');
});

test('prState: dev’s isDraft reads Draft; a draft that conflicts or fails checks shows that instead (#784)', () => {
  assert.equal(prState(ghPr({ isDraft: true, mergeable: 'UNKNOWN' })).word, 'Draft');
  assert.equal(prState(ghPr({ isDraft: false, mergeable: 'MERGEABLE' })).word, 'Ready');
  assert.equal(prState(ghPr({ isDraft: true, mergeable: 'CONFLICTING' })).word, 'Conflicts', 'the bundle’s order: what is wrong first');
  assert.equal(prState(ghPr({ isDraft: true, checks: FAIL })).word, 'Checks failing');
  assert.equal(prState(ghPr({ state: 'closed', isDraft: true, mergeable: 'CONFLICTING' })).word, 'Closed', 'how it ended outranks how it stood');
});

test('prState: a closed Azure DevOps PR reads Abandoned, colour and id stay closed (#784)', () => {
  const az = { state: 'CLOSED', url: 'https://dev.azure.com/acme/My%20Project/_git/api/pullrequest/5', number: 5, isDraft: false, mergeable: 'UNKNOWN' };
  assert.deepEqual(prState(az), { id: 'closed', word: 'Abandoned', icon: 'pull-request-closed', tone: 'red-ink',
    number: 5, url: az.url, title: 'PR #5', needsYou: false });
  assert.equal(prState({ ...az, url: 'https://acme.visualstudio.com/My%20Project/_git/api/pullrequest/5' }).word, 'Abandoned');
  assert.equal(prState({ ...az, state: 'MERGED' }).word, 'Merged', 'only a closed Azure PR is abandoned');
  assert.equal(prState({ ...PR, state: 'CLOSED' }).word, 'Closed', 'GitHub keeps Closed');
});

test('memberPrState: a workspace run’s most urgent member PR and their count (#784’s workspace glyph, as words)', () => {
  const pr = (n, more = {}) => ghPr({ number: n, url: `https://github.com/o/r/pull/${n}`, ...more });
  assert.equal(memberPrState([]), null);
  assert.equal(memberPrState(undefined), null, 'the lookups have not answered');
  assert.equal(memberPrState([null, { state: 'OPEN' }]), null, 'a member PR with no url or number is not counted');
  assert.equal(memberPrState([pr(1)]).word, 'Ready', 'one member PR: no count');
  const three = memberPrState([pr(1), pr(2, { mergeable: 'CONFLICTING' }), pr(3, { isDraft: true })]);
  assert.deepEqual([three.id, three.word, three.needsYou], ['conflicts', 'Conflicts · 3 PRs', true]);
  assert.equal(three.title, '3 pull requests · Conflicts with the base branch · PR #2');
  assert.equal(memberPrState([pr(1, { state: 'MERGED' }), pr(2)]).word, 'Ready · 2 PRs', 'open before merged');
  assert.equal(memberPrState([pr(1, { state: 'MERGED' }), pr(2, { isDraft: true })]).word, 'Draft · 2 PRs', 'a draft before a merged PR');
  assert.equal(memberPrState([pr(1, { state: 'CLOSED' }), pr(2, { state: 'MERGED' })]).word, 'Merged · 2 PRs', 'merged before closed');
  // runModel: member PRs win over the run's own rollup pr; a conflicting member raises the run to Needs you (D31).
  const m = runModel({ status: 'done', endReached: true, pr: pr(1), memberPrs: [pr(1), pr(2, { mergeable: 'CONFLICTING' })] }, OPTS);
  assert.deepEqual([m.state, m.pr.word], ['needs-you', 'Conflicts · 2 PRs']);
  assert.equal(runModel({ status: 'done', endReached: true, pr: pr(1), memberPrs: [] }, OPTS).pr.word, 'Ready', 'no member PRs: the run’s own');
  assert.equal(finishedNeedsYou({ pr: pr(1), memberPrs: [pr(1), pr(2, { mergeable: 'CONFLICTING' })] }), true, 'Needs you reads the same rollup');
  // A live Watch PR fix round on the run's own PR marks that member fixing, as prOf does for a single run.
  const fixing = runModel({ status: 'done', endReached: true, pr: pr(2), watch: { status: 'fixing', reason: null, fixRuns: 1 },
    memberPrs: [pr(1), pr(2, { mergeable: 'CONFLICTING' })] }, OPTS);
  assert.deepEqual([fixing.state, fixing.pr.word], ['in-review', 'Fixing · 2 PRs']);
  // A member PR the server marked fixing (its own Watch PR, artifacts.mjs withFixing) needs no run-level watch.
  const marked = [pr(1), pr(2, { mergeable: 'CONFLICTING', fixing: true }), pr(3)];
  assert.deepEqual([runModel({ status: 'done', endReached: true, pr: pr(1), memberPrs: marked }, OPTS).state, memberPrState(marked).word],
    ['in-review', 'Fixing · 3 PRs']);
  assert.equal(finishedNeedsYou({ pr: pr(1), memberPrs: marked }), false, 'a fix round on it: not Needs you');
});
