// test/orchestrator-custom-agent.test.mjs
// End-to-end (mock): a USER-added producer and a USER-added verifier run inside a
// saved GRAPH template with ZERO core edits. This is the genericity charter's
// end-to-end proof — the engine has no agent-key branch, so two agents it has
// never heard of must plan, loop and converge exactly like the built-ins.
//
// Pins: sidecar filename templates honored per execution ordinal, the verdict
// landing in the reviews table under the filename-derived kind, the generic
// review->revise loop (blocked ordinal 1 -> rewind -> clean ordinal 2), and the
// v2 manifest carrying the user agent's own label.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { _resetForTests } from '../src/core/db.mjs';
import { writeWorkflow, resolveGraph } from '../src/core/workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineExtras } from '../src/core/artifacts.mjs';

const prevHome = process.env.WORCA_HOME;
let home, proj;
beforeEach(async () => {
  _resetForTests();
  home = await mkdtemp(join(tmpdir(), 'worca-cc-custom-home-'));
  process.env.WORCA_HOME = home;
  proj = await mkdtemp(join(tmpdir(), 'worca-cc-custom-proj-'));
  await writeFile(join(proj, 'README.md'), '# demo\n', 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: proj });
  execFileSync('git', ['add', '-A'], { cwd: proj });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: proj });

  // User agents in <WORCA_HOME>/.worca-cc/agents (worcaHome() appends .worca-cc).
  const agents = join(home, '.worca-cc', 'agents');
  await mkdir(agents, { recursive: true });
  await writeFile(join(agents, 'specWriter.md'), '# Spec Writer\n\nYou write API specs.\n');
  await writeFile(join(agents, 'specWriter.meta.json'), JSON.stringify({
    metaVersion: 2,
    key: 'specWriter', displayName: 'Spec Writer', description: 'writes the API spec',
    color: 'green', icon: '<p/>', agentFile: 'specWriter.md', runnerType: 'producer',
    order: 20, promptHints: 'Keep the spec terse.',
    inputs: [
      { id: 'task', type: 'md' },
      { id: 'revise', type: 'md', required: false, loop: true, directive: 'Address the audit findings.' },
    ],
    outputs: [{ id: 'spec', type: 'md', filename: 'api-spec-c{cycle}.md' }],
  }));
  await writeFile(join(agents, 'specAuditor.md'), '# Spec Auditor\n\nYou audit API specs.\n');
  await writeFile(join(agents, 'specAuditor.meta.json'), JSON.stringify({
    metaVersion: 2,
    key: 'specAuditor', displayName: 'Spec Auditor', description: 'audits the API spec',
    color: 'red', icon: '<p/>', agentFile: 'specAuditor.md', runnerType: 'verifier',
    order: 21,
    verdict: { filename: 'spec-review-cycle{cycle}.json' },
    inputs: [{ id: 'spec', type: 'md' }],
    outputs: [
      { id: 'review', type: 'md', when: 'blocking', filename: 'spec-review-cycle{cycle}.md' },
      { id: 'pass', type: 'void', when: 'clean' },
    ],
  }));
});
afterEach(async () => {
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME;
  else process.env.WORCA_HOME = prevHome;
  for (const d of [home, proj]) if (d) await rm(d, { recursive: true, force: true });
});

/** Task -> specWriter -> specAuditor -> End, with the audit looping back. */
const CUSTOM_GRAPH = {
  name: 'Custom Agents',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0 },
    { id: 'n_spec', kind: 'agent', key: 'specWriter', x: 200, y: 0 },
    { id: 'n_audit', kind: 'agent', key: 'specAuditor', x: 400, y: 0 },
    { id: 'n_end', kind: 'end', x: 600, y: 0 },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_spec', port: 'task' } },
    { id: 'w2', from: { node: 'n_spec', port: 'spec' }, to: { node: 'n_audit', port: 'spec' } },
    { id: 'w3', from: { node: 'n_audit', port: 'review' }, to: { node: 'n_spec', port: 'revise' }, config: { maxCycles: 2 } },
    { id: 'w4', from: { node: 'n_audit', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};

test('resolveGraph stamps meta + promptHints + the loaded body on a user-agent node', async () => {
  const wf = await writeWorkflow(structuredClone(CUSTOM_GRAPH));
  const { nodeCtx } = await resolveGraph(proj, wf.id, loadAgentRegistry());
  const node = nodeCtx.n_spec;
  assert.equal(node.runnerType, 'producer');
  assert.equal(node.promptHints, 'Keep the spec terse.');
  assert.equal(node.meta.displayName, 'Spec Writer');
  assert.match(node.agentPrompt, /You write API specs/);
});

test('full mock run with a generic loop: blocked ordinal 1 rewinds, ordinal 2 passes', async () => {
  // The verifier mock blocks at cycle 1 (one major) and passes at cycle >= 2, so
  // the audit -> spec loop wire exercises the GENERIC loop path with agents the
  // engine has never seen: rewind, ordinal-suffixed artifacts, per-ordinal verdicts.
  const wf = await writeWorkflow(structuredClone(CUSTOM_GRAPH));
  const orch = createOrchestrator({
    projectDir: proj, prompt: 'demo custom agents', workflowId: wf.id, auto: true, claude: { mock: true },
  });
  const execs = [];
  orch.on('exec', (e) => { if (e.status === 'start') execs.push(e); });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  assert.equal(res.endReached, true, 'the custom graph converges through its own End');

  assert.deepEqual(
    execs.filter((e) => e.agentKey).map((e) => `${e.agentKey}:${e.ordinal}`),
    ['specWriter:1', 'specAuditor:1', 'specWriter:2', 'specAuditor:2'],
    'the loop fires exactly once, re-executing the SAME two nodes',
  );

  const dir = orch.getState().pipelineDir;
  await access(join(dir, 'api-spec-c1.md'));                  // {cycle} -> the execution ordinal
  await access(join(dir, 'api-spec-c2.md'));
  await access(join(dir, 'spec-review-cycle1.json'));         // the blocked verdict
  await access(join(dir, 'spec-review-cycle2.json'));         // ... and the passing one

  // The verdict kind is DERIVED from the filename template, with no key table:
  // `spec-review-cycle{cycle}.json` -> `spec`.
  const { reviews } = readPipelineExtras(orch.getState().id);
  assert.deepEqual(reviews.map((r) => `${r.kind}:${r.cycle}`).sort(), ['spec:1', 'spec:2']);

  const labels = orch.getState().stepper.graph.nodes.map((n) => n.label);
  assert.ok(labels.includes('Spec Writer'), 'the v2 manifest carries the user agent label');
  assert.ok(labels.includes('End'), 'and the End card is a real graph node');
});
