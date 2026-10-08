// test/cli-exec-render.test.mjs — the CLI's exec line formatter (pure, no IO).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatExecLine, formatGateHeader, formatResultLine, formatTotals, formatRunSummary, formatResumeHints, fmtDur } from '../src/cli/render.mjs';

// Every node kind the engine ships (task / agent / or / and / end); the OR
// valve's out-wire feeds a LOOP input, which is how a loop re-fires through a
// valve on the seeds (probe P13).
const M = { version: 2, template: { id: 'wf', name: 'W' }, graph: {
  nodes: [
    { id: 'n_task', kind: 'task', key: null, label: 'Task', ports: { inputs: [], outputs: [{ id: 'task', type: 'md' }] } },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', label: 'Reviewer', ports: { inputs: [], outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] } },
    { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implementer', ports: { inputs: [{ id: 'fix', type: 'md', loop: true }, { id: 'plan', type: 'md', loop: false }], outputs: [] } },
    { id: 'n_or', kind: 'or', key: null, label: 'OR', ports: { inputs: [{ id: 'in1', type: 'any' }], outputs: [{ id: 'out', type: 'md' }] } },
    { id: 'n_and', kind: 'and', key: null, label: 'AND', ports: { inputs: [], outputs: [{ id: 'out', type: 'void' }] } },
    { id: 'n_end', kind: 'end', key: null, label: 'End', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [] } },
    { id: 'n_tests', kind: 'script', key: 'runTests', label: 'Run tests', runtime: 'node', ports: { inputs: [{ id: 'done', type: 'void', loop: false }], outputs: [{ id: 'pass', type: 'void', when: 'clean' }] } },
  ],
  wires: [
    { id: 'w9', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, loop: true, maxCycles: 3 },
    { id: 'w10', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' }, loop: false },
    { id: 'w11', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' }, loop: false },
    { id: 'w12', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' }, loop: false },
  ] } };
const ev = (o) => ({ kind: 'cycle', agentKey: 'implementer', trigger: { wireIds: [], freshPorts: [] }, ...o });
const line = (o) => formatExecLine(ev(o), M);

test('start lines name the loop port and the node that published on the wire that delivered it', () => {
  assert.equal(line({ nodeId: 'n_impl', executionId: 'x:n_impl:2', ordinal: 2, status: 'start',
    trigger: { wireIds: ['w9'], freshPorts: ['fix'] } }), '▶ Implementer #2 · fix ← Reviewer');
  // Through an OR valve the delivering wire is the valve's out-wire: the source IS the valve (P13).
  assert.equal(line({ nodeId: 'n_impl', executionId: 'x:n_impl:2', ordinal: 2, status: 'start',
    trigger: { wireIds: ['w10'], freshPorts: ['fix'] } }), '▶ Implementer #2 · fix ← OR');
  // A loop port with no delivering wire in the trigger names the port alone.
  assert.equal(line({ nodeId: 'n_impl', executionId: 'x:n_impl:2', ordinal: 2, status: 'start',
    trigger: { wireIds: [], freshPorts: ['fix'] } }), '▶ Implementer #2 · fix');
  // A fresh NON-loop port is not a re-fire: no port segment at all.
  assert.equal(line({ nodeId: 'n_impl', executionId: 'x:n_impl:1', ordinal: 1, status: 'start',
    trigger: { wireIds: ['w12'], freshPorts: ['plan'] } }), '▶ Implementer #1');
  assert.equal(line({ nodeId: 'n_impl', executionId: 'x:n_impl:1', ordinal: 1, status: 'start' }), '▶ Implementer #1');
});

test('task slices are indented and numbered (index within the phase), and only their start renders', () => {
  assert.equal(line({ nodeId: 'n_impl', executionId: 'x:n_impl:1:p1t3', ordinal: 1, status: 'start',
    kind: 'task', phase: 1, taskIndex: 3, taskTotal: 7, title: 'Add schema' }), '  ▶ task 3/7 · Add schema');
  assert.equal(line({ nodeId: 'n_impl', executionId: 'x:n_impl:1:p1t3', ordinal: 1, status: 'start',
    kind: 'task', title: 'Add schema' }), '  ▶ task · Add schema', 'no index → no numbers');
  assert.equal(line({ nodeId: 'n_impl', executionId: 'x:n_impl:1:p1t3', ordinal: 1, status: 'done',
    kind: 'task', taskIndex: 3, taskTotal: 7, title: 'Add schema', costUsd: 0.1, durationMs: 100 }), '', 'a slice done renders nothing');
});

test('agent done lines carry duration · cost and the verdict word', () => {
  assert.equal(line({ nodeId: 'n_impl', executionId: 'x:n_impl:2', ordinal: 2, status: 'done', costUsd: 0.12, durationMs: 63000 }),
    '✓ Implementer #2  1m03s · $0.12');
  assert.equal(line({ nodeId: 'n_rev', agentKey: 'reviewer', executionId: 'x:n_rev:1', ordinal: 1, status: 'done',
    costUsd: 0.02, durationMs: 12000, verdict: { hasBlocking: true } }), '✓ Reviewer #1  12s · $0.02 — blocking');
  assert.equal(line({ nodeId: 'n_rev', agentKey: 'reviewer', executionId: 'x:n_rev:2', ordinal: 2, status: 'done',
    costUsd: 0.02, durationMs: 12000, verdict: { hasBlocking: false } }), '✓ Reviewer #2  12s · $0.02 — clean');
  // MAJ-10: a verdict file nobody wrote is treated as clean, but it must not READ as an approval.
  assert.match(line({ nodeId: 'n_rev', agentKey: 'reviewer', executionId: 'x:n_rev:1', ordinal: 1, status: 'done', verdict: { hasBlocking: false, missing: true } }),
    / — no verdict written \(treated as clean\)$/);
  assert.equal(line({ nodeId: 'n_impl', executionId: 'x:n_impl:1', ordinal: 1, status: 'done', costUsd: 0 }),
    '✓ Implementer #1 · $0.00', 'no durationMs (an un-enriched event) → no duration segment');
});

test('flow nodes print ONE dim done line — the marker only for AND/OR/COMBINE — and never a start, paused, error, ordinal, duration or cost', () => {
  assert.equal(line({ nodeId: 'n_or', agentKey: null, executionId: 'x:n_or:1', ordinal: 1, status: 'done' }), '✓ OR · OR → Implementer');
  // Real flow `done` events carry costUsd:0 (and the CLI enriches a durationMs): neither may print.
  assert.equal(line({ nodeId: 'n_or', agentKey: null, executionId: 'x:n_or:2', ordinal: 2, status: 'done', costUsd: 0, durationMs: 5 }), '✓ OR · OR → Implementer');
  assert.equal(line({ nodeId: 'n_and', agentKey: null, executionId: 'x:n_and:1', ordinal: 1, status: 'done', costUsd: 0 }), '✓ AND · AND', 'no out-wire → the bare kind');
  assert.equal(line({ nodeId: 'n_task', agentKey: null, executionId: 'x:n_task:1', ordinal: 1, status: 'done', costUsd: 0 }), '✓ Task', 'the Task card carries no marker even with an out-wire');
  for (const status of ['start', 'paused', 'error', 'skipped']) {
    assert.equal(line({ nodeId: 'n_or', agentKey: null, executionId: 'x:n_or:1', ordinal: 1, status, error: 'x' }), '', `flow ${status} renders nothing`);
    assert.equal(line({ nodeId: 'n_task', agentKey: null, executionId: 'x:n_task:1', ordinal: 1, status, error: 'x' }), '', `Task ${status} renders nothing`);
  }
});

test('error, paused, skipped, bookend and unattributed events', () => {
  assert.equal(line({ nodeId: 'n_rev', agentKey: 'reviewer', executionId: 'x:n_rev:1', ordinal: 1, status: 'error',
    durationMs: 12000, error: 'could not parse the verdict' }), '✗ Reviewer #1  12s — could not parse the verdict');
  assert.equal(line({ nodeId: 'n_rev', agentKey: 'reviewer', executionId: 'x:n_rev:1', ordinal: 1, status: 'error' }), '✗ Reviewer #1 — failed');
  assert.equal(line({ nodeId: 'n_impl', executionId: 'x:n_impl:1', ordinal: 1, status: 'paused' }), '⏸ Implementer #1  paused');
  assert.equal(line({ nodeId: 'n_impl', executionId: 'x:n_impl:1', status: 'skipped', ordinal: 1 }), '', 'skipped renders nothing');
  // P8's bookend executions (ids from the shared constant) render nothing on any status.
  assert.equal(line({ nodeId: 'preflight', agentKey: null, executionId: 'x:preflight:1', ordinal: 1, status: 'done' }), '');
  assert.equal(line({ nodeId: 'done', agentKey: null, executionId: 'x:done:1', ordinal: 1, status: 'start' }), '');
  assert.equal(formatExecLine(ev({ status: 'done' }), M), '', 'no nodeId → nothing');
  assert.equal(formatExecLine(null, M), '');
  // A node the manifest does not know renders as an agent with its raw id.
  assert.equal(line({ nodeId: 'n_ghost', executionId: 'x:n_ghost:1', ordinal: 1, status: 'start' }), '▶ n_ghost #1');
});

test('End renders exactly one line, on done: the bound wire and the basename', () => {
  assert.equal(line({ nodeId: 'n_end', agentKey: null, executionId: 'x:n_end:1', ordinal: 1, status: 'done',
    trigger: { wireIds: ['w11'], freshPorts: ['result'] }, result: { type: 'md', path: '/tmp/p/plan-review.md' } }),
    '■ End ← Reviewer.pass → plan-review.md');
  assert.equal(line({ nodeId: 'n_end', agentKey: null, executionId: 'x:n_end:1', ordinal: 1, status: 'done',
    trigger: { wireIds: ['w11'], freshPorts: ['result'] }, result: { type: 'void' } }), '■ End ← Reviewer.pass', 'a void result has no tail');
  assert.equal(line({ nodeId: 'n_end', agentKey: null, executionId: 'x:n_end:1', ordinal: 1, status: 'done', result: { type: 'void' } }),
    '■ End', 'no delivering wire in the trigger → no source');
  assert.equal(line({ nodeId: 'n_end', agentKey: null, executionId: 'x:n_end:1', ordinal: 1, status: 'start',
    trigger: { wireIds: ['w11'], freshPorts: ['result'] } }), '', 'End renders only its bound line');
  assert.equal(line({ nodeId: 'n_end', agentKey: null, executionId: 'x:n_end:1', ordinal: 1, status: 'error', error: 'x' }), '');
});

test('gate header, result line, totals and fmtDur', () => {
  // MAJ-11: the cycle number comes from the PAYLOAD (`deliveryNo`), never from the
  // id. A wire that holds more than once mints `gate-<wireId>-<deliveryNo>-h<holdNo>`,
  // so parsing the id's trailing number would print the HOLD ordinal as the cycle.
  assert.equal(formatGateHeader({ id: 'gate-w9-3', kind: 'gate', wireId: 'w9', deliveryNo: 3, holdNo: 1 }, M), '? Loop gate · Reviewer → Implementer  3/3 cycles used');
  assert.equal(formatGateHeader({ id: 'gate-w9-1', kind: 'gate', wireId: 'w9', deliveryNo: 1, holdNo: 1 }, M), '? Loop gate · Reviewer → Implementer  1/3 cycles used');
  assert.equal(formatGateHeader({ id: 'gate-w9-1-h2', kind: 'gate', wireId: 'w9', deliveryNo: 1, holdNo: 2 }, M), '? Loop gate · Reviewer → Implementer  1/3 cycles used', 'a re-hold is the SAME cycle');
  assert.equal(formatGateHeader({ id: 'gate-w9-1-h4', kind: 'gate', wireId: 'w9' }, M), '? Loop gate · Reviewer → Implementer  3/3 cycles used', 'no deliveryNo → the budget, never the id');
  assert.equal(formatGateHeader({ id: 'gate-wx-1', kind: 'gate', wireId: 'wx', deliveryNo: 1 }, M), '? Loop gate', 'an unknown wire → the bare header');
  assert.equal(formatResultLine({ type: 'md', path: '/tmp/p/plan.md' }), 'Result: /tmp/p/plan.md');
  assert.equal(formatResultLine({ type: 'void' }), 'Result: completed');
  assert.equal(formatResultLine(null), 'Result: completed');
  assert.equal(formatTotals({ executions: 9, activeMs: 720000, costUsd: 1.23 }), '9 executions · 12m00s active · $1.23');
  assert.equal(formatTotals({ executions: 1, activeMs: 0, costUsd: 0 }), '1 execution · 0s active · $0.00', 'singular');
  assert.equal(formatTotals({ executions: 2, activeMs: 0, costUsd: 0, engine: 'cursor' }), '2 executions · 0s active · cost unknown', 'Cursor: never $0.00');
  assert.equal(formatTotals({ executions: 2, activeMs: 0, costUsd: 0.1, engine: 'cursor' }), "2 executions · 0s active · cost unknown (worca's own calls: $0.10)");
  assert.match(formatRunSummary({ stepper: { version: 2 }, steps: [], runEngine: 'cursor', totalCostUsd: 0 })[1], /· cost unknown$/, 'the end-of-run summary reads the run engine');
  assert.deepEqual([fmtDur(12000), fmtDur(63000), fmtDur(3660000), fmtDur(0), fmtDur(-5)], ['12s', '1m03s', '1h01m', '0s', '0s']);
});

test('formatRunSummary: v1 renders nothing; v2 counts executions without the bookends and sums THEIR active time', () => {
  assert.deepEqual(formatRunSummary({ stepper: { version: 1 }, steps: [], totalActiveMs: 5 }), [], 'a v1 run has no v2 summary');
  assert.deepEqual(formatRunSummary(null), []);
  // Today's bookends: key 'preflight' / 'done' with NO executionId; P8's carry the
  // BOOKEND_EXECUTION_IDS. Neither is an execution, and neither's time counts.
  const steps = [
    { key: 'preflight', executionId: null, nodeId: null, activeMs: 209 },
    { key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', activeMs: 719999 },
    { key: 'x:n_end:1', executionId: 'x:n_end:1', nodeId: 'n_end', activeMs: 1 },
    { key: 'done', executionId: null, nodeId: null, activeMs: 0 },
    { key: 'x:preflight:1', executionId: 'x:preflight:1', nodeId: 'preflight', activeMs: 5000 },
    { key: 'x:done:1', executionId: 'x:done:1', nodeId: 'done', activeMs: 5000 },
  ];
  assert.deepEqual(
    formatRunSummary({ stepper: { version: 2 }, steps, endReached: true, result: { type: 'md', path: '/tmp/p/plan.md' },
      totalActiveMs: 999999, totalCostUsd: 1.23 }),
    ['Result: /tmp/p/plan.md', '2 executions · 12m00s active · $1.23'],
    'state.totalActiveMs (which includes preflight) is NOT what prints');
  // Quiescence is the reducer's rule: status 'done' AND endReached false.
  assert.deepEqual(
    formatRunSummary({ stepper: { version: 2 }, steps: [], status: 'done', endReached: false, totalActiveMs: 0, totalCostUsd: 0 }),
    ['Finished at quiescence — End not reached', '0 executions · 0s active · $0.00']);
  // A stopped (or errored) run also has endReached false — it must NOT be sold as
  // a quiescent finish; it falls through to the ordinary result line.
  assert.deepEqual(
    formatRunSummary({ stepper: { version: 2 }, steps: [], status: 'stopped', endReached: false, totalActiveMs: 0, totalCostUsd: 0 }),
    ['Result: completed', '0 executions · 0s active · $0.00']);
  // Unapplied directions add one trailing line; none present adds nothing.
  assert.deepEqual(
    formatRunSummary({ stepper: { version: 2 }, steps: [], endReached: true, result: { type: 'md', path: '/p.md' },
      totalActiveMs: 0, totalCostUsd: 0, directions: { posted: 2, applied: 1, pending: [{ id: 'd9', text: 'darker accent' }] } }),
    ['Result: /p.md', '0 executions · 0s active · $0.00', '1 direction(s) never applied: d9 "darker accent"']);
});

test('a script card renders like a keyed card, with the exit code where an agent shows cost', () => {
  const s = (o) => formatExecLine({ kind: 'cycle', agentKey: null, key: 'runTests', trigger: { wireIds: [], freshPorts: [] }, ...o }, M);
  assert.equal(s({ nodeId: 'n_tests', executionId: 'x:n_tests:1', ordinal: 1, status: 'start' }), '▶ Run tests #1');
  assert.equal(s({ nodeId: 'n_tests', executionId: 'x:n_tests:1', ordinal: 1, status: 'done', durationMs: 1200, costUsd: 0, exitCode: 0, verdict: { hasBlocking: false } }), '✓ Run tests #1  1s · exit 0 — clean');
  assert.equal(s({ nodeId: 'n_tests', executionId: 'x:n_tests:2', ordinal: 2, status: 'error', durationMs: 300, exitCode: 2, error: 'script "runTests" exited 2' }), '✗ Run tests #2  0s — script "runTests" exited 2');
});

test('formatRunSummary: the Away mode line, only when it answered', () => {
  const base = { stepper: { version: 2 }, steps: [], endReached: true, result: null, totalCostUsd: 0 };
  assert.ok(formatRunSummary({ ...base, night: { decisions: 3, flagged: 1 } }).includes('Away mode: 3 answers while you were away — 1 to check'));
  assert.ok(!formatRunSummary({ ...base, night: { decisions: 0, flagged: 0 } }).some((l) => /Away mode/.test(l)));
});

test('formatResumeHints: the resume command, plus each other engine after a usage limit an engine hit', () => {
  assert.deepEqual(formatResumeHints({ reason: 'error' }, 'ab12cd34'), ['Resume with: worca resume ab12cd34']);
  assert.deepEqual(formatResumeHints({ reason: 'usage_limit' }, 'ab12cd34'), ['Resume with: worca resume ab12cd34'], 'not an engine limit');
  assert.deepEqual(formatResumeHints({ reason: 'usage_limit', limitEngine: 'codex' }, 'ab12cd34'), [
    'Resume with: worca resume ab12cd34',
    'Or continue now on Claude: worca resume ab12cd34 --engine claude',
    'Or continue now on Cursor: worca resume ab12cd34 --engine cursor',
  ]);
  const bold = formatResumeHints({ reason: 'usage_limit', limitEngine: 'claude' }, 'x', { color: (n, s) => `<${n}>${s}` });
  assert.equal(bold[1], 'Or continue now on Codex: <bold>worca resume x --engine codex');
  assert.equal(bold[2], 'Or continue now on Cursor: <bold>worca resume x --engine cursor');
});
