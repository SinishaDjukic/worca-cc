// test/seed-traces.test.mjs
// The golden EXECUTION TRACE of every shipped graph — the v2 replacement for the
// dual-engine parity suite P8 deleted (test/saved-pipeline-parity.test.mjs, commit
// 11c7b7ee). Nothing else at HEAD asserts anything about a seed run beyond "it
// finished done, bound End and wrote no error row"
// (test/orchestrator-graph.test.mjs:89-110), so a scheduler/executor/registry-ports
// change that drops one seed's refiner, reorders two launches, re-fires a node an
// extra time inside its budget, renames an allocated artifact or raises the loop
// gate on the wrong wire ships green.
//
// Per graph, under the offline mock and answering interactively:
//   launches   the agent-start sequence, composite PARENTS excluded (a fan-out's
//              shell start is not a launch; its slices are)
//   perKey     how many times each agent key ran
//   artifacts  sorted `${kind}:${relPath}` of everything the run recorded
//   gates      `${wireId}#${deliveryNo}` per loop gate raised, in order
//   wireDeliveries  the per-wire delivery counts the loop budgets are spent from
// plus the outcome triple (status / endReached / warnings).
//
// `budget1` re-runs the same graph with EVERY loop wire's maxCycles forced to 1.
// Measured: with the shipped budgets no seed ever raises a gate under the mock
// (the mock verifiers turn clean at ordinal 2), so `gates` is [] for all eight and
// the gate half of the trace would be vacuous. Budget 1 = allowance 0, so the FIRST
// blocking delivery is held and the gate lineage is pinned for real. Recorded on
// purpose: in that leg `wireDeliveries` stays 0 on every loop wire although the run
// continued — A4's `continue` DISCARDS the held token and force-fires the clean
// outputs, so the loop wire never delivers.
//
// Regenerating (after a DELIBERATE engine change — always review the diff):
//   UPDATE_SEED_TRACES=1 WORCA_HOME=$(mktemp -d) node --test test/seed-traces.test.mjs
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { listArtifacts } from '../src/core/artifacts.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';

useTempHome(after);

// settings/agent lookups resolve under HOME, not WORCA_HOME (the isolation
// test/orchestrator-graph.test.mjs:22-36 uses).
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-seedtrace-home-'));
  for (const k of ['HOME', 'USERPROFILE']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  // V24 does this for real; readWorkflow must be able to serve the seven seeds.
  for (const t of SEED_TEMPLATES) {
    await writeGraphWorkflow({ id: t.id, name: t.name, domain: t.domain, nodes: t.nodes, wires: t.wires });
  }
  // …and one budget-1 copy of each, including the graph default (which ships as a
  // built-in behind the `wf_default` alias, not as a row).
  for (const t of [...SEED_TEMPLATES, GRAPH_DEFAULT_WORKFLOW]) {
    await writeGraphWorkflow({
      id: budget1Id(t.id), name: `${t.name} (budget 1)`, domain: t.domain, nodes: t.nodes,
      wires: t.wires.map((w) => (w.config?.maxCycles ? { ...w, config: { ...w.config, maxCycles: 1 } } : w)),
    });
  }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true });
});

/** Every runnable graph id: the 7 saved seeds + the graph default's alias. */
const GRAPH_IDS = [...SEED_TEMPLATES.map((t) => t.id), 'wf_default'];
const budget1Id = (id) => `${id.replace(/^wf_/, 'wf_b1')}`;
const TRACE_DIR = fileURLToPath(new URL('./fixtures/seed-traces/', import.meta.url));
const PROMPT = 'seed trace probe';

/**
 * The gate key, keyed off the ASK PAYLOAD: `wireId` is on it (scheduler.mjs:670)
 * and `deliveryNo` rides the ask payload since MAJ-11 (Task 16); the id-parse
 * below is a loud fallback for a payload from an older resume point and must
 * never be the primary key.
 */
function gateKey(q) {
  const wireId = q.wireId ?? /^gate-(.+)-\d+$/.exec(String(q.id))?.[1];
  if (q.deliveryNo != null) return `${wireId}#${q.deliveryNo}`;
  // No payload field: the id must still be exactly `gate-<wireId>-<deliveryNo>`.
  // A blind trailing-number parse would silently key on a per-hold nonce — Task 16
  // already appends `-h<holdNo>` to a re-held ask — so this fails loudly instead.
  const m = new RegExp(`^gate-${String(wireId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`)
    .exec(String(q.id));
  assert.ok(m, `gate ask "${q.id}" carries no deliveryNo and its id is no longer `
    + 'gate-<wireId>-<deliveryNo>: put deliveryNo on the ask payload and read it here.');
  return `${wireId}#${m[1]}`;
}

/** Names carry the run's date prefix (DD-MM-YY) — the only volatile part of a
 *  relPath. Nothing else in a trace is machine- or clock-dependent: the prompt,
 *  the graphs and the mock are all fixed. */
const undate = (s) => String(s).replace(/\b\d{2}-\d{2}-\d{2}\b/g, '<DATE>');

const counts = (seq) => seq.reduce((m, k) => ({ ...m, [k]: (m[k] || 0) + 1 }), {});

/** Drive one graph to completion, gates answered `continue` and clarify answered
 *  empty — dev's `drive()` from the deleted parity suite, v2 leg only. */
async function trace(workflowId, tag) {
  const orch = createOrchestrator({
    projectDir: gitDir(tag), workflowId, prompt: PROMPT, claude: { mock: true }, auto: false,
  });
  const starts = [];
  const parents = new Set();
  const gates = [];
  orch.on('exec', (e) => {
    if (e.kind === 'task' && e.parentExecutionId) parents.add(e.parentExecutionId);
    if (e.status === 'start' && e.agentKey) starts.push({ key: e.agentKey, executionId: e.executionId });
  });
  orch.on('question', (q) => {
    if (q.kind === 'gate') gates.push(gateKey(q));
    // `question` is emitted BEFORE pendingQuestion is installed: answer next tick.
    setImmediate(() => orch.answer(q.id, q.kind === 'gate' ? { decision: 'continue' } : { answers: [] }));
  });
  const res = await orch.run();
  const st = orch.getState();
  const launches = starts.filter((s) => !parents.has(s.executionId)).map((s) => s.key);
  const artifacts = (await listArtifacts(st.id))
    .map((a) => `${a.kind}:${undate(a.relPath)}`).sort();
  return {
    status: res.status,
    endReached: st.endReached,
    warnings: st.warnings,
    launches,
    perKey: counts(launches),
    artifacts,
    wireDeliveries: st.wireDeliveries,
    gates,
  };
}

for (const workflowId of GRAPH_IDS) {
  test(`${workflowId}: the execution trace matches its golden`, { timeout: 300000 }, async () => {
    const shipped = await trace(workflowId, 'seedtrace');
    const b1 = await trace(budget1Id(workflowId), 'seedgate');
    const actual = {
      workflowId,
      ...shipped,
      budget1: { launches: b1.launches, perKey: b1.perKey, gates: b1.gates, wireDeliveries: b1.wireDeliveries },
    };
    const file = join(TRACE_DIR, `${workflowId}.json`);
    const text = `${JSON.stringify(actual, null, 2)}\n`;
    if (process.env.UPDATE_SEED_TRACES === '1') {
      mkdirSync(TRACE_DIR, { recursive: true });
      writeFileSync(file, text, 'utf8');
      return;
    }
    assert.deepEqual(actual, JSON.parse(readFileSync(file, 'utf8')),
      `${workflowId}: the execution trace drifted from test/fixtures/seed-traces/${workflowId}.json. `
      + 'If the change is deliberate, review the diff and regenerate with UPDATE_SEED_TRACES=1 '
      + "(see this file's header).");
  });
}

test('the golden set covers every shipped graph', () => {
  assert.equal(GRAPH_IDS.length, 8, 'seven seeds + the graph default alias');
  assert.deepEqual(GRAPH_IDS, [
    'wf_full', 'wf_no-clarify', 'wf_provided-plan', 'wf_full-no-decompose',
    'wf_quick-fix', 'wf_clarify-implement', 'wf_clarify-quick-fix', 'wf_default',
  ]);
});
