// test/cli-exec-render.test.mjs — the CLI's exec line formatter (pure, no IO).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatExecLine, formatGateHeader, formatResultLine, formatTotals, formatRunSummary, fmtDur } from '../src/cli/render.mjs';

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
});

// ── the CLI wiring ──────────────────────────────────────────────────────────
// Source pins: attachAndDrive is not exported and a CLI run needs a claude mock
// plus a git repo, so the BEHAVIOUR is pinned on the pure helpers above and the
// wiring on the source. `assert.ok(re.test(src), msg)` on purpose — assert.match
// would print the whole 55 KB file on a failure.

/** Blank out JS comments so a source grep cannot be satisfied — or defeated —
 *  by prose that merely names a symbol. */
function stripJsComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');
}

test('the CLI renders exec lines ONLY, drops stop noise, prints the pure summary, and names node-graph pipelines', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url)), 'utf8');
  assert.ok(/import \{ formatExecLine, formatGateHeader, formatRunSummary \} from '\.\/render\.mjs';/.test(src), 'the CLI imports the pure renderer');
  assert.ok(/orch\.on\('exec'/.test(src), 'exec lines are the CLI renderer');
  assert.equal(/orch\.on\('phase'/.test(src), false, 'the v1 phase listener is gone');
  assert.equal(/function (phaseLabel|statusMark)\(/.test(src), false, 'and so are its two renderers');
  // ...and nothing still CALLS the deleted phase-shim gate. `graphRun()` survived
  // the listener's deletion in one spot (the interactive gate header) where only a
  // real gate question would have thrown ReferenceError, which no test drives.
  assert.equal(/\bgraphRun\(\)/.test(stripJsComments(src)), false, 'no dangling graphRun() call');
  assert.ok(/ev\.status === 'error' && orch\.state && orch\.state\.status === 'stopped'/.test(src), "a user stop's `aborted` exec error is not rendered");
  assert.ok(/s\.executionId === ev\.executionId \|\| s\.parentExecutionId === ev\.executionId/.test(src), 'a terminal exec is enriched from its own ledger row (by executionId, never by key), a composite parent from its slices');
  assert.ok(/formatGateHeader\(payload, /.test(src), 'the gate header is built from the WHOLE question payload (wireId)');
  // MAJ-11 tripwire: render.mjs must never go back to reading the cycle out of the
  // ask id — the id now carries a hold suffix that is NOT a delivery number.
  const renderSrc = readFileSync(fileURLToPath(new URL('../src/cli/render.mjs', import.meta.url)), 'utf8');
  assert.equal(/\/-\(\\d\+\)\$\//.test(renderSrc), false, 'no trailing-number parse of the ask id survives');
  assert.ok(/formatRunSummary\(orch\.state\)/.test(src), 'the summary is the pure helper');
  assert.ok(/worca — node-graph multi-agent pipelines/.test(src), 'the HELP headline is updated');
  assert.ok(/--workflow <id>\s+Saved pipeline template to run \(default: wf_default — the built-in graph\)/.test(src), 'the --workflow HELP line names the built-in graph');
  assert.ok(/assertRunnableWorkflow/.test(src), 'the CLI validates --workflow through the shared guard');
});

// Pins the SHARED guard the CLI relies on (cmdRun already calls assertRunnableWorkflow
// and passes the returned row on as createOrchestratorFor's `template`).
test('the shared guard the CLI relies on refuses an archived workflow with the v2-upgrade message', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = await mkdtemp(join(tmpdir(), 'worca-p6-cli-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  const { _resetForTests, getDb } = await import('../src/core/db.mjs');
  _resetForTests();
  try {
    const { assertRunnableWorkflow, writeGraphWorkflow } = await import('../src/core/workflows.mjs');
    await writeGraphWorkflow({ id: 'wf_old', name: 'Old', domain: 'dev', nodes: [], wires: [] });
    getDb().prepare("UPDATE workflows SET version = 1, archived_at = '2026-08-26T00:00:00Z' WHERE id = 'wf_old'").run();
    await assert.rejects(() => assertRunnableWorkflow('wf_old'), (e) => {
      assert.equal(e.code, 'ARCHIVED');
      assert.equal(e.message, 'workflow "wf_old" was archived by the v2 upgrade (v1 template, not runnable) — pick a v2 pipeline or rebuild it in the Composer');
      return true;
    });
  } finally {
    _resetForTests();
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
    await rm(home, { recursive: true, force: true });
  }
});
