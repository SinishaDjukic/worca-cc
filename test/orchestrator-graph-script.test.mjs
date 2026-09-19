// test/orchestrator-graph-script.test.mjs
// A script card inside a real (mock-agent) graph run: dispatch through the node
// site, the $0 agent-shaped ledger row (D17), the envelope artifact, the review
// row, a failure that PAUSES the run (D9) and a resume that re-runs the script
// from scratch (D22). The script is a real `node` program; the agents are mock.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { readPipelineForResume, listArtifacts, readPipelineExtras } from '../src/core/artifacts.mjs';

useTempHome(after);
const scratch = [];
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

/** A script layer with one node program: passes unless a `failUntilMarker` file is absent — it creates the
 *  marker and throws, so the SECOND run (the resume) passes. Safe to run twice against the same paths (D22). */
function scriptLayer() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-og-scripts-'));
  scratch.push(dir);
  writeFileSync(join(dir, 'runTests.mjs'), `import { writeFileSync, existsSync } from 'node:fs';
export default async function ({ outputs, params, execution, log }) {
  if (params.failUntilMarker && !existsSync(params.failUntilMarker)) {
    writeFileSync(params.failUntilMarker, '1');
    throw new Error('simulated harness crash');
  }
  log('info', 'cycle ' + execution.ordinal);
  writeFileSync(outputs.log.path, '# tests cycle ' + execution.ordinal + '\\n\\nall passing\\n');
  return { summary: 'all passing', verdict: { issues: [] } };
}\n`);
  writeFileSync(join(dir, 'runTests.meta.json'), JSON.stringify({
    key: 'runTests', metaVersion: 2, displayName: 'Run tests', runtime: 'node', file: 'runTests.mjs',
    params: [{ id: 'failUntilMarker', type: 'string' }],
    inputs: [{ id: 'done', type: 'void', required: false }],
    outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'tests-cycle{cycle}.md' },
      { id: 'fail', type: 'md', when: 'blocking', filename: 'tests-cycle{cycle}.md' }, { id: 'pass', type: 'void', when: 'clean' }],
    verdict: { filename: 'tests-cycle{cycle}.json' },
  }));
  return dir;
}

/** task -> planner -> implementer -> runTests -> reviewer -> end; reviewer.review -> implementer.fix (the mock
 *  reviewer blocks at cycle 1 and passes at cycle 2, so the script runs twice on a clean run). */
async function gateWorkflow(id, params) {
  return writeGraphWorkflow({
    id, name: 'Script gate', domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
      { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 0, config: {} },
      { id: 'n_tests', kind: 'script', key: 'runTests', x: 900, y: 0, config: { params } },
      { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 1200, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 1500, y: 0, config: {} }],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
      { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
      { id: 'w4', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_tests', port: 'done' } },
      { id: 'w5', from: { node: 'n_tests', port: 'pass' }, to: { node: 'n_rev', port: 'done' } },
      { id: 'w6', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
      { id: 'w7', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }],
  });
}

test('a script card runs inside a mock graph: $0 agent-shaped rows, key on exec events, envelope + log artifacts, a review row', { timeout: 120000 }, async () => {
  const scriptsDir = scriptLayer();
  const { id: workflowId } = await gateWorkflow('wf_script_gate', {});
  const dir = gitDir('gscript');
  const orch = createOrchestrator({ projectDir: dir, workflowId, prompt: 'demo', claude: { mock: true }, auto: true, scriptsDir });
  const execs = [];
  const logs = [];
  orch.on('exec', (e) => execs.push(e));
  orch.on('log', (l) => logs.push(l));
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  const st = orch.getState();
  assert.equal(st.endReached, true);
  assert.deepEqual(st.warnings, []);
  const rows = st.steps.filter((s) => s.nodeId === 'n_tests');
  assert.deepEqual(rows.map((r) => r.ordinal), [1, 2], 'the script ran once per implementer cycle');
  for (const r of rows) {
    assert.equal(r.status, 'done');
    assert.equal(r.kind, 'cycle');
    assert.equal(r.agentKey, null, 'agentKey must not lie (D17)');
    assert.equal(r.nodeKey, 'runTests');
    assert.equal(r.costUsd, 0);
    assert.equal(r.sessionId ?? null, null);
    assert.equal(r.runtime, 'node');
    assert.equal(r.exitCode, 0);
  }
  const starts = execs.filter((e) => e.nodeId === 'n_tests' && e.status === 'start');
  assert.equal(starts.length, 2);
  assert.equal(starts[0].key, 'runTests');
  assert.equal(starts[0].agentKey, null);
  assert.deepEqual(execs.filter((e) => e.nodeId === 'n_tests' && e.status === 'done').map((e) => [e.runtime, e.exitCode]), [['node', 0], ['node', 0]], 'exec events carry the runtime facts');
  assert.equal(execs.some((e) => e.nodeId === 'n_plan' && ('runtime' in e || 'exitCode' in e)), false, 'agent events carry neither');
  assert.ok(execs.some((e) => e.nodeId === 'n_plan' && e.status === 'start' && e.key === 'planner' && e.agentKey === 'planner'), 'agent events carry both');
  assert.ok(logs.some((l) => l.source === 'runTests' && /^\[info\] cycle 1$/.test(l.text)), 'script logs land under the script key');
  const arts = await listArtifacts(st.id);                       // [{ kind, relPath }], relPath dir-relative with '/' separators
  assert.ok(arts.some((a) => a.kind === 'log' && a.relPath === 'tests-cycle1.md'), JSON.stringify(arts));
  assert.ok(arts.some((a) => a.kind === 'envelope' && a.relPath === 'scripts/n_tests-c1.envelope.json'));
  assert.ok(readPipelineExtras(st.id).reviews.some((r) => r.kind === 'tests' && r.cycle === 1), 'the script verdict is a review row');
  // Persisted: the exec_meta bag round-trips nodeKey/runtime/exitCode.
  const saved = readPipelineForResume(st.id).steps.find((s) => s.nodeId === 'n_tests');
  assert.equal(saved.nodeKey, 'runTests');
  assert.equal(saved.runtime, 'node');
  assert.equal(saved.exitCode, 0);
  assert.equal(saved.agentKey, undefined);
});

test('a script failure pauses the run as an error (never retried), and resume re-runs the script from scratch', { timeout: 120000 }, async () => {
  const scriptsDir = scriptLayer();
  const marker = join(scriptsDir, 'crashed-once');
  const { id: workflowId } = await gateWorkflow('wf_script_pause', { failUntilMarker: marker });
  const dir = gitDir('gscript-pause');
  const orch = createOrchestrator({ projectDir: dir, workflowId, prompt: 'demo', claude: { mock: true }, auto: true, scriptsDir });
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  const res = await orch.run();
  assert.equal(res.status, 'paused', res.error);
  assert.equal(orch.pauseReason, 'error');
  assert.match(String(orch.pauseDetail || ''), /simulated harness crash/);
  const st = orch.getState();
  const row = st.steps.find((s) => s.nodeId === 'n_tests');
  assert.equal(row.status, 'paused');
  assert.ok(!logs.some((l) => /recoverable/.test(l.text)), 'a script failure is never classified recoverable (D9)');
  assert.ok(existsSync(marker));
  const saved = readPipelineForResume(st.id);
  assert.ok(saved.resumePoint, 'the run is resumable');
  const orch2 = createOrchestrator({ projectDir: dir, workflowId, claude: { mock: true }, auto: true, scriptsDir, resume: saved });
  const second = await orch2.resume();
  assert.equal(second.status, 'done', second.error);
  const rows = orch2.getState().steps.filter((s) => s.nodeId === 'n_tests');
  assert.deepEqual(rows.map((r) => [r.ordinal, r.status, r.exitCode]), [[1, 'done', 0], [2, 'done', 0]], 'the interrupted execution re-ran in place, then the loop finished');
});

test('preflight: a script key missing from the registry refuses the run with the script sentence', { timeout: 60000 }, async () => {
  const { id: workflowId } = await gateWorkflow('wf_script_missing', {});
  const dir = gitDir('gscript-missing');
  const empty = mkdtempSync(join(tmpdir(), 'worca-og-empty-'));
  scratch.push(empty);
  const orch = createOrchestrator({ projectDir: dir, workflowId, prompt: 'demo', claude: { mock: true }, auto: true, scriptsDir: empty });
  const res = await orch.run();
  assert.equal(res.status, 'error');
  assert.match(String(res.error), /unknown script "runTests" — no such key in the registry/);
});
