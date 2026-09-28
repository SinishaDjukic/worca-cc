// test/graph-script-gate.test.mjs
// The worked example (spec §13) end to end, offline: implement -> run tests
// (a REAL node script) -> fix loop -> review, with the hold at cycle 3. The agents
// are custom mock keys (no builtin name appears); the script fails until the cycle
// its `passAt` param names, so both the loop and the gate are exercised.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { runGraphOffline } from './helpers/graph-run.mjs';
import { loadScriptRegistry } from '../src/core/script-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';

useTempHome(after);
const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

/** Custom mock agents: a worker with the fix loop, a finisher that seals the run. */
const AGENTS = {
  worker: { key: 'worker', metaVersion: 2, displayName: 'Worker', runnerType: 'producer', sideEffect: 'code',
    inputs: [{ id: 'fix', type: 'md', required: false, loop: true, as: 'fix-review' }, { id: 'task', type: 'md', required: true, as: 'file' }],
    outputs: [{ id: 'done', type: 'void', when: 'always' }] },
  finisher: { key: 'finisher', metaVersion: 2, displayName: 'Finisher', runnerType: 'producer',
    inputs: [{ id: 'go', type: 'void', required: false }],
    outputs: [{ id: 'done', type: 'void', when: 'always' }] },
};

function scriptLayer(extra = () => {}) {
  const dir = tmp('worca-gate-scripts-');
  extra(dir);
  writeFileSync(join(dir, 'runTests.mjs'), `import { writeFileSync } from 'node:fs';
export default async function ({ outputs, params, execution }) {
  const passAt = Number(params.passAt || 0);
  const failing = !passAt || execution.ordinal < passAt;
  writeFileSync(outputs.log.path, '# tests cycle ' + execution.ordinal + '\\n\\n' + (failing ? '3 failing' : 'all passing') + '\\n');
  return { summary: failing ? '3 failing' : 'all passing',
    verdict: failing ? { issues: [{ severity: 'major', title: '3 tests failed', detail: 'see log', location: 'test/x.test.mjs' }] } : { issues: [] } };
}\n`);
  writeFileSync(join(dir, 'runTests.meta.json'), JSON.stringify({
    key: 'runTests', metaVersion: 2, displayName: 'Run tests', runtime: 'node', file: 'runTests.mjs',
    params: [{ id: 'passAt', type: 'number', default: 0 }],
    inputs: [{ id: 'done', type: 'void', required: false }],
    outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'tests-cycle{cycle}.md' },
      { id: 'fail', type: 'md', when: 'blocking', filename: 'tests-cycle{cycle}.md' }, { id: 'pass', type: 'void', when: 'clean' }],
    verdict: { filename: 'tests-cycle{cycle}.json' },
  }));
  return loadScriptRegistry({ scriptsDir: dir, userScriptsDir: null, includePlugins: false, agentKeys: null });
}

/** task -> worker -> runTests -> finisher -> end; runTests.fail -> worker.fix (maxCycles 3). */
const GATE = (params) => ({
  id: 'wf_gate', name: 'Gate', version: 2, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'worker', x: 300, y: 0, config: {} },
    { id: 'n_tests', kind: 'script', key: 'runTests', x: 600, y: 0, config: { params } },
    { id: 'n_fin', kind: 'agent', key: 'finisher', x: 900, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 1200, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'task' } },
    { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_tests', port: 'done' } },
    { id: 'w3', from: { node: 'n_tests', port: 'fail' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w4', from: { node: 'n_tests', port: 'pass' }, to: { node: 'n_fin', port: 'go' } },
    { id: 'w5', from: { node: 'n_fin', port: 'done' }, to: { node: 'n_end', port: 'result' } }],
});

test('the gate validates; a script that passes at cycle 2 closes the loop through pass', { timeout: 60000 }, async () => {
  const scripts = scriptLayer();
  const portsFn = registryPortsFn(AGENTS, scripts);
  const tpl = GATE({ passAt: 2 });
  const v = validateGraph(tpl, portsFn);
  assert.deepEqual(v.errors, []);
  const pipelineDir = tmp('worca-gate-pipe-');
  const r = await runGraphOffline({ template: tpl, portsFn, registry: AGENTS, scripts, projectDir: tmp('worca-gate-proj-'), pipelineDir });
  assert.equal(r.result, 'done');
  assert.equal(r.state.endReached, true);
  assert.deepEqual(r.execSeq, ['n_task c1', 'n_impl c1', 'n_tests c1', 'n_impl c2', 'n_tests c2', 'n_fin c1', 'n_end c1']);
  assert.deepEqual(r.state.warnings, []);
  assert.equal(readFileSync(join(pipelineDir, 'tests-cycle1.md'), 'utf8'), '# tests cycle 1\n\n3 failing\n');
  assert.deepEqual(JSON.parse(readFileSync(join(pipelineDir, 'tests-cycle2.json'), 'utf8')).issues, []);
  const impl2 = r.calls.find((c) => c.nodeId === 'n_impl' && c.ordinal === 2);
  assert.ok(impl2, 'the worker re-ran on the fix cycle');
  const fixToken = r.events.find((e) => e.name === 'token' && e.from.node === 'n_tests' && e.from.port === 'fail');
  assert.equal(fixToken.path, join(pipelineDir, 'tests-cycle1.md'), 'the failing log rides the fix wire');
  assert.deepEqual(r.events.filter((e) => e.name === 'exec' && e.nodeId === 'n_tests' && e.status === 'done').map((e) => e.verdict.hasBlocking), [true, false]);
  assert.ok(r.events.filter((e) => e.name === 'exec' && e.nodeId === 'n_tests').every((e) => e.key === 'runTests' && e.agentKey === null));
  assert.ok(existsSync(join(pipelineDir, 'scripts', 'n_tests-c1.envelope.json')));
});

test('a script that never passes holds the wire at cycle 3; "continue" force-fires pass and the run seals', { timeout: 60000 }, async () => {
  const scripts = scriptLayer();
  const portsFn = registryPortsFn(AGENTS, scripts);
  const asks = [];
  const r = await runGraphOffline({ template: GATE({}), portsFn, registry: AGENTS, scripts, projectDir: tmp('worca-gate-proj-'), pipelineDir: tmp('worca-gate-pipe-'),
    answer: (a) => { asks.push(a); return a.kind === 'gate' ? 'continue' : { answers: [] }; } });
  assert.equal(r.result, 'done');
  assert.deepEqual(r.execSeq, ['n_task c1', 'n_impl c1', 'n_tests c1', 'n_impl c2', 'n_tests c2', 'n_impl c3', 'n_tests c3', 'n_fin c1', 'n_end c1']);
  assert.equal(asks.length, 1);
  assert.equal(asks[0].wireId, 'w3');
  assert.equal(asks[0].deliveryNo, 3);
  assert.equal(asks[0].issues[0].title, '3 tests failed');
  const forced = r.events.find((e) => e.name === 'token' && e.from.node === 'n_tests' && e.from.port === 'pass');
  assert.equal(forced.forced, true, 'A4: the clean side force-fires on continue');
});

test('wired params end to end: an upstream script picks passAt over a json wire, through the real scheduler and runner', { timeout: 60000 }, async () => {
  const scripts = scriptLayer((dir) => {
    writeFileSync(join(dir, 'pick.mjs'), 'export default async function () { return { outputs: { out: { value: { passAt: 1 } } } }; }\n');
    writeFileSync(join(dir, 'pick.meta.json'), JSON.stringify({ key: 'pick', metaVersion: 2, displayName: 'Pick', runtime: 'node', file: 'pick.mjs',
      inputs: [], outputs: [{ id: 'out', type: 'json', when: 'always', filename: 'pick-cycle{cycle}.json' }] }));
  });
  const portsFn = registryPortsFn(AGENTS, scripts);
  const tpl = GATE({});                                            // the card sets no passAt: alone it fails every cycle (the hold test above)
  tpl.nodes.find((n) => n.id === 'n_tests').config.paramsPort = true;
  tpl.nodes.push({ id: 'n_pick', kind: 'script', key: 'pick', x: 300, y: 200, config: {} });
  tpl.wires.push({ id: 'w6', from: { node: 'n_task', port: 'task' }, to: { node: 'n_pick', port: 'await' } },
    { id: 'w7', from: { node: 'n_pick', port: 'out' }, to: { node: 'n_tests', port: 'params' } });
  assert.deepEqual(validateGraph(tpl, portsFn).errors, []);
  const pipelineDir = tmp('worca-gate-pipe-');
  const r = await runGraphOffline({ template: tpl, portsFn, registry: AGENTS, scripts, projectDir: tmp('worca-gate-proj-'), pipelineDir });
  assert.equal(r.result, 'done');
  assert.deepEqual(r.execSeq.filter((x) => x.startsWith('n_tests')), ['n_tests c1'], 'the wire said passAt 1: clean on the first cycle, after BOTH inputs arrived');
  assert.deepEqual(r.state.warnings, []);
  const audit = JSON.parse(readFileSync(join(pipelineDir, 'scripts', 'n_tests-c1.envelope.json'), 'utf8'));
  assert.deepEqual([audit.params, audit.wiredParams, Object.keys(audit.inputs)], [{ passAt: 1 }, ['passAt'], ['done']]);
});
