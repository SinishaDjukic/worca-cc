// test/ui-run-glance.test.mjs — the Running detail glance helpers (ui/public/run-glance.mjs):
// the trail (one dot per execution, loops add dots, overlaps stack), the Now/Earlier rows,
// and the status copy for every state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  trailColumns, nowRows, earlierRows, glanceState, glanceCopy, renderTrail, renderOrb, nodeLabel, TRAIL_STACK_CAP,
} from '../ui/public/run-glance.mjs';
import { histRowState } from '../ui/public/runs-list.mjs';

const stepper = {
  version: 2,
  graph: {
    nodes: [
      { id: 'n_clarify', kind: 'agent', key: 'clarify', label: 'Clarify' },
      { id: 'n_plan', kind: 'agent', key: 'planner', label: 'Plan' },
      { id: 'n_refine', kind: 'agent', key: 'refiner', label: 'Refine' },
      { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implement', model: 'sonnet' },
      { id: 'n_docs', kind: 'agent', key: 'docs', label: 'Docs' },
      { id: 'n_or', kind: 'or', key: 'or', label: 'Or' },
      { id: 'n_end', kind: 'end', key: 'end', label: 'End' },
    ],
    wires: [],
  },
};
const at = (m) => new Date(Date.UTC(2026, 8, 29, 10, m)).toISOString();
const row = (nodeId, ord, start, end, status = 'done', extra = {}) => ({
  executionId: `x:${nodeId}:${ord}`, nodeId, ordinal: ord, cycle: ord, kind: 'cycle',
  status, startedAt: at(start), endedAt: end == null ? null : at(end), ...extra,
});

const loopedBranched = {
  status: 'running',
  stepper,
  steps: [
    { key: 'preflight', phase: 'preflight', cycle: 0 },          // bookend: dropped
    row('n_clarify', 1, 0, 1),
    row('n_plan', 1, 1, 3),
    row('n_refine', 1, 3, 4),
    row('n_refine', 2, 4, 5),                                   // loop re-fire: its own dot
    row('n_or', 1, 5, 5),                                       // flow node: not drawn
    row('n_impl', 1, 5, null, 'start', { runningSince: at(5) }),
    row('n_docs', 1, 5, null, 'start'),                         // parallel with impl
  ],
  active: [{ nodeId: 'n_impl' }, { nodeId: 'n_docs' }],
};

test('trail: one dot per execution in start order, loops add dots, overlaps stack, flow nodes skipped', () => {
  const t = trailColumns(loopedBranched);
  assert.equal(t.count, 6);
  assert.deepEqual(t.columns.map((c) => c.dots.map((d) => d.nodeId)),
    [['n_clarify'], ['n_plan'], ['n_refine'], ['n_refine'], ['n_impl', 'n_docs']]);
  assert.equal(t.columns[3].dots[0].label, 'Refine · cycle 2');
  assert.deepEqual(t.columns[4].dots.map((d) => d.state), ['act', 'act']);
  assert.deepEqual(t.columns[0].dots.map((d) => d.state), ['done']);
});

test('trail: a wide fan-out caps the stack and counts the rest', () => {
  const steps = [];
  for (let i = 1; i <= 5; i++) {
    steps.push({ ...row('n_impl', i, 0, 3), executionId: `x:n_impl:1:p1t${i}`, kind: 'task', title: `Task ${i}`, parentExecutionId: 'x:n_impl:1' });
  }
  const t = trailColumns({ status: 'running', stepper, steps });
  assert.equal(t.columns.length, 1);
  assert.equal(t.columns[0].dots.length, TRAIL_STACK_CAP);
  assert.equal(t.columns[0].more, 5 - TRAIL_STACK_CAP);
  assert.equal(t.columns[0].dots[0].label, 'Implement · Task 1');
});

test('trail: sequential executions that touch end-to-start do not stack', () => {
  const t = trailColumns({ stepper, steps: [row('n_plan', 1, 0, 2), row('n_refine', 1, 2, 3)] });
  assert.equal(t.columns.length, 2);
});

test('trail: the execution parked on a question is amber, errors are red', () => {
  const run = { status: 'running', stepper, steps: [row('n_clarify', 1, 0, null, 'start')], pendingQuestion: { id: 'q', kind: 'questions', nodeId: 'n_clarify', questions: [{}, {}] }, active: [{ nodeId: 'n_clarify' }] };
  assert.equal(trailColumns(run).columns[0].dots[0].state, 'ask');
  const failed = { status: 'error', stepper, steps: [row('n_plan', 1, 0, 1, 'error')] };
  assert.equal(trailColumns(failed).columns[0].dots[0].state, 'fail');
});

test('now and earlier rows', () => {
  assert.deepEqual(nowRows(loopedBranched).map((r) => [r.label, r.model]), [['Implement', 'sonnet'], ['Docs', '']]);
  assert.deepEqual(earlierRows(loopedBranched).map((r) => [r.label, r.times]), [['Clarify', 1], ['Plan', 1], ['Refine', 2]]);
  assert.equal(nodeLabel(stepper, 'n_docs'), 'Docs');
  assert.equal(nodeLabel(stepper, 'n_missing'), 'n_missing');
});

test('status copy: an open preflight names itself and its stage, never "Between steps"', () => {
  const pre = (status, extra = {}) => ({ key: 'x:preflight:1', executionId: 'x:preflight:1', nodeId: 'preflight', status, startedAt: at(0), ...extra });
  const setting = { status: 'running', stepper, steps: [pre('start')], setupStage: 'Building the knowledge graph' };
  assert.deepEqual([glanceCopy(setting).title, glanceCopy(setting).sub], ['Running', 'Preflight · Building the knowledge graph']);
  assert.equal(glanceCopy({ ...setting, setupStage: null }).sub, 'Preflight', 'no stage known: the bookend alone');
  assert.equal(glanceCopy({ ...setting, steps: [pre('done')] }).sub, 'Between steps', 'a closed preflight is not setup');
  assert.deepEqual(nowRows(setting), [], 'preflight is not a workflow step: no Now row, no trail dot');
  const both = { ...setting, steps: [pre('start'), row('n_plan', 1, 1, null, 'start')] };
  assert.equal(glanceCopy(both).sub, 'Step: Plan', 'a running step outranks the bookend');
});

test('glance state and copy for every status', () => {
  assert.equal(glanceState({ status: 'starting' }), 'start');
  assert.equal(glanceState({ status: 'pausing' }), 'paused');
  assert.equal(glanceState({ status: 'running', pendingQuestion: {} }), 'ask');
  assert.equal(glanceState({ status: 'stopped' }), 'stop');
  assert.equal(glanceState({ status: 'error' }), 'fail');

  // Line 1 is the state word alone; line 2 names the step (or the reason).
  const two = glanceCopy(loopedBranched);
  assert.deepEqual([two.title, two.lead, two.sub], ['Running', 'Running', 'Steps: Implement and Docs']);
  const one = glanceCopy({ ...loopedBranched, steps: loopedBranched.steps.slice(0, 7) }, { lastLine: 'Edited src/a.js' });
  assert.deepEqual([one.title, one.sub], ['Running', 'Step: Implement'], 'no log line, no time: the step alone');

  const ask = glanceCopy({ status: 'running', stepper, steps: [], pendingQuestion: { kind: 'questions', nodeId: 'n_clarify', questions: [{}, {}] } });
  assert.deepEqual([ask.state, ask.title, ask.sub], ['ask', 'Waiting for you', 'Step: Clarify'], 'the panel below counts the questions');
  const gate = glanceCopy({ status: 'running', stepper, steps: [], pendingQuestion: { kind: 'gate', nodeId: 'n_refine' } });
  assert.deepEqual([gate.title, gate.sub], ['Waiting for you', 'Step: Refine']);
  const form = glanceCopy({ status: 'running', stepper, steps: [], pendingQuestion: { kind: 'form', nodeId: 'n_docs', title: 'What should this run produce?' } });
  assert.deepEqual([form.title, form.sub], ['Waiting for you', 'Step: Docs']);
  assert.equal(glanceCopy({ status: 'running', stepper, steps: [], pendingQuestion: { kind: 'workflow' } }).sub, 'Review the workflow');
  assert.equal(glanceCopy({ status: 'running', stepper, steps: [], pendingQuestion: { kind: 'gate' } }).sub, 'A decision', 'no step known: what is asked');

  assert.deepEqual([glanceCopy({ status: 'paused' }, { pill: { text: 'Paused · cost limit' } }).title,
    glanceCopy({ status: 'paused' }, { pill: { text: 'Paused · cost limit' } }).sub], ['Paused', 'Cost limit · resume to continue']);
  assert.equal(glanceCopy({ status: 'paused' }, { pill: { text: 'Paused' } }).sub, 'Resume to continue where it left off');
  assert.equal(glanceCopy({ status: 'paused' }, { pill: { text: 'Paused · usage limit' }, limitNote: 'resets 18:00' }).sub, 'Usage limit · resets 18:00', 'a usage-limit pause names its reset instead of "resume to continue"');
  assert.equal(glanceCopy({ status: 'paused' }, { pill: { text: 'Paused · usage limit' } }).sub, 'Usage limit · resume to continue', 'no note: unchanged');
  assert.equal(glanceCopy({ status: 'pausing' }).title, 'Pausing');
  assert.equal(glanceCopy({ status: 'paused', resumePending: true }, { pill: { text: 'Resuming…' } }).title, 'Resuming', 'a Resume in flight');
  assert.equal(glanceCopy({ status: 'interrupted', resumePending: true }).title, 'Resuming', 'an interrupted copy too');
  assert.equal(earlierRows({ stepper, steps: [row('n_plan', 1, 0, 1, 'paused')] }).length, 0, 'a paused step did not complete');
  const failed = glanceCopy({ status: 'error', stepper, pauseDetail: 'ENOENT: no such file\n  at x', steps: [row('n_impl', 1, 0, 1, 'error')] });
  assert.deepEqual([failed.title, failed.sub], ['Failed', 'Step: Implement · ENOENT: no such file'], 'one line of the error');
  assert.equal(glanceCopy({ status: 'stopped' }).title, 'Stopped');

  // A finished run: where the work stands NOW (the pull request outranks the review), one glyph each.
  const fin = (o) => { const c = glanceCopy({ status: 'done' }, o); return [c.title, c.icon]; };
  assert.deepEqual(fin({ pr: 'MERGED' }), ['Merged', 'merged']);
  assert.equal(glanceCopy({ status: 'done' }, { pr: 'IN_BASE' }).sub, 'Its work is already in the base branch', 'D8: no PR of its own, already in its base');
  assert.deepEqual(fin({ pr: 'IN_BASE' }), ['Merged', 'merged']);
  assert.deepEqual(fin({ pr: 'OPEN', checks: 3 }), ['In review', 'pr-open']);
  assert.deepEqual(fin({ pr: 'CLOSED' }), ['PR closed', 'pr-closed']);
  assert.deepEqual(fin({ pr: 'NONE', checks: 0, files: 2 }), ['Ready to ship', 'ship']);
  assert.deepEqual(fin({ pr: 'NONE', checks: 2, files: 2 }), ['Ready to review', 'review']);
  assert.equal(glanceCopy({ status: 'done' }, { checks: 2 }).sub, '2 things to check before you create a PR');
  assert.deepEqual(fin({ files: 0, checks: 0 }), ['Finished', 'finished'], 'nothing changed: nothing to ship');
  assert.equal(glanceCopy({ status: 'done' }, { pr: 'PENDING', checks: 0 }).sub, 'Checking for a pull request…', 'never guesses while the lookup runs');
  assert.deepEqual(fin({ pr: 'UNAVAILABLE', checks: 0, files: 2 }), ['Finished', 'finished'], 'no gh: never "Ready to ship"');
  assert.equal(glanceCopy({ status: 'done' }).title, 'Finished');
});

test('a finished row in the Runs list says what the glance headline says (D12): same inputs, same word', () => {
  // The inputs a History row carries into the list: the glance's PR input (glancePrInput), the
  // review's `checks` and the changed `files` (both from the server row).
  const cases = [
    { pr: 'MERGED' }, { pr: 'OPEN', checks: 3 }, { pr: 'CLOSED' },
    { pr: 'NONE', checks: 0, files: 2 }, { pr: 'NONE', checks: 2, files: 2 },
    { files: 0, checks: 0 }, { pr: 'PENDING', checks: 0 }, { pr: 'UNAVAILABLE', checks: 0, files: 2 },
    { pr: 'NONE' }, {},
  ];
  const leads = [];
  for (const o of cases) {
    const lead = glanceCopy({ status: 'done' }, o).lead;
    const st = histRowState({ status: 'done', ...o });
    assert.equal(st.word, lead, `row word vs glance lead for ${JSON.stringify(o)}`);
    assert.equal(st.icon, 'done');
    leads.push(lead);
  }
  // Every headline of the done branch is reached, so this is not one word compared ten times.
  assert.deepEqual([...new Set(leads)].sort(), ['Finished', 'In review', 'Merged', 'PR closed', 'Ready to review', 'Ready to ship']);
  // History's synonyms for done read the same headline.
  assert.equal(histRowState({ status: 'completed', pr: 'MERGED' }).word, glanceCopy({ status: 'done' }, { pr: 'MERGED' }).lead);
});

test('S2: an unsuccessful done headline is "Unsuccessful" with its reason, via opts or the run object', () => {
  const viaOpts = glanceCopy({ status: 'done' }, { successful: false, outcomeReason: 'Implement produced no changes to the worktree.' });
  assert.deepEqual([viaOpts.lead, viaOpts.icon, viaOpts.sub],
    ['Unsuccessful', 'unsuccessful', 'Implement produced no changes to the worktree.']);
  // The live run page passes its run object, not these opts: the run-object fallback reads the same.
  const viaRun = glanceCopy({ status: 'done', successful: false, outcomeReason: 'Implement produced no changes to the worktree.' });
  assert.deepEqual([viaRun.lead, viaRun.icon, viaRun.sub],
    ['Unsuccessful', 'unsuccessful', 'Implement produced no changes to the worktree.']);
  // No reason: a quiet fallback sub.
  assert.equal(glanceCopy({ status: 'done' }, { successful: false }).sub, 'Finished without delivering the work');
  // Row/glance parity: the History list row word matches the glance lead.
  assert.equal(histRowState({ status: 'done', successful: false, outcomeReason: 'r' }).word, 'Unsuccessful');
});

test('DOM: trail stacks and the orb carries its state class', () => {
  const { document } = new JSDOM('').window;
  const node = renderTrail(document, trailColumns(loopedBranched));
  assert.equal(node.querySelectorAll('.rg-td').length, 6);
  assert.equal(node.querySelectorAll('.rg-tstack .rg-td-act').length, 2);
  assert.equal(node.querySelector('.rg-td').title, 'Clarify');
  const orb = renderOrb(document, 'ask');
  assert.match(orb.getAttribute('class'), /rg-orb-ask/);
  assert.ok(orb.querySelector('path.rg-orb-mark') && orb.querySelector('circle.rg-orb-dot'), 'a drawn hook and dot, not a font glyph');
  assert.equal(orb.querySelector('text'), null);
});

test('glanceCopy: the progress option replaces the step line while running or waiting (P5)', () => {
  const progress = { text: 'Build · task 2 of 4' };
  const run = glanceCopy(loopedBranched, { progress });
  assert.deepEqual([run.title, run.sub], ['Running', 'Build · task 2 of 4'], 'the P5 line beats "Steps: …"');
  const ask = glanceCopy({ status: 'running', stepper, steps: [], pendingQuestion: { kind: 'questions', nodeId: 'n_clarify' } }, { progress });
  assert.deepEqual([ask.state, ask.title, ask.sub], ['ask', 'Waiting for you', 'Build · task 2 of 4']);
  const wf = glanceCopy({ status: 'running', stepper, steps: [], pendingQuestion: { kind: 'workflow' } }, { progress });
  assert.equal(wf.sub, 'Build · task 2 of 4');
  // Nothing runs and the preflight is open: setting up outranks the progress line.
  const pre = glanceCopy({ status: 'running', stepper, steps: [{ executionId: 'x:preflight:1', status: 'start' }], setupStage: 'worktree' }, { progress });
  assert.equal(pre.sub, 'Preflight · worktree');
  // No text, no change; terminal states are untouched.
  assert.equal(glanceCopy(loopedBranched, { progress: { text: '' } }).sub, 'Steps: Implement and Docs');
  assert.equal(glanceCopy({ status: 'error', stepper, steps: [] }, { progress }).title, 'Failed');
  assert.equal(glanceCopy({ status: 'paused' }, { progress, pill: { text: 'Paused' } }).sub, 'Resume to continue where it left off');
});

test('glanceCopy: role reviews read "Running" over "Plan · role reviews" (spec §4a)', () => {
  const g = glanceCopy(loopedBranched, { progress: { text: 'Plan · role reviews' } });
  assert.deepEqual([g.title, g.sub], ['Running', 'Plan · role reviews']);
});

test('glanceCopy: a stopped or done run ignores the progress option (P5)', () => {
  const progress = { text: 'Build · task 2 of 4' };
  for (const status of ['stopped', 'done']) {
    const without = glanceCopy({ status, stepper, steps: [] });
    const withProg = glanceCopy({ status, stepper, steps: [] }, { progress });
    assert.deepEqual([withProg.state, withProg.title, withProg.sub], [without.state, without.title, without.sub], status);
  }
});
