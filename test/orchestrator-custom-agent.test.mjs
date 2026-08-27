// test/orchestrator-custom-agent.test.mjs
// End-to-end (mock): a USER-added producer with a custom channel + a USER-added
// verifier run inside a saved workflow with ZERO core edits. Pins: channelDefs
// threading (allocate mints <pipelineDir>/api-spec.md), generic publish, the
// meta uiPhase fallback, the custom verifier's own review basenames, and the
// generic feedback-loop rewind (blocked cycle 1 -> -cycle2 suffixed artifacts).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { _resetForTests } from '../src/core/db.mjs';
import { writeWorkflow, resolveWorkflow } from '../src/core/workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

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
    key: 'specWriter', displayName: 'Spec Writer', description: 'writes the API spec',
    color: 'green', icon: '<p/>', agentFile: 'specWriter.md', runnerType: 'producer',
    loopSource: false, order: 20, uiPhase: 'spec', promptHints: 'Keep the spec terse.',
    consumes: ['plan'], produces: ['spec'], optionalConsumes: [], connectsTo: '*',
    channelDefs: [{ id: 'spec', kind: 'md', filename: 'api-spec.md' }],
  }));
  await writeFile(join(agents, 'specAuditor.md'), '# Spec Auditor\n\nYou audit API specs.\n');
  await writeFile(join(agents, 'specAuditor.meta.json'), JSON.stringify({
    key: 'specAuditor', displayName: 'Spec Auditor', description: 'audits the API spec',
    color: 'red', icon: '<p/>', agentFile: 'specAuditor.md', runnerType: 'verifier',
    loopSource: true, order: 21,
    consumes: ['spec'], produces: ['review'], optionalConsumes: [], connectsTo: '*',
  }));
});
afterEach(async () => {
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME;
  else process.env.WORCA_HOME = prevHome;
  for (const d of [home, proj]) if (d) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('resolveWorkflow stamps meta uiPhase + promptHints on a user-agent node', async () => {
  const wf = await writeWorkflow({ name: 'Spec', steps: [[{ id: 's0', key: 'specWriter' }]], feedbacks: [] });
  const plan = await resolveWorkflow(proj, wf.id, loadAgentRegistry());
  const node = plan.steps[0][0];
  assert.equal(node.uiPhase, 'spec', 'meta.uiPhase fallback (not in the built-in UI_PHASE map)');
  assert.equal(node.promptHints, 'Keep the spec terse.');
  assert.match(node.agentPrompt, /You write API specs/);
});

test('full mock run with a generic feedback loop: blocked cycle 1 rewinds, cycle 2 passes', async () => {
  // The verifier mock blocks at cycle 1 (one major) and passes at cycle >= 2, so a
  // specAuditor -> specWriter feedback edge exercises the GENERIC loop path:
  // rewind, cycle-suffixed custom artifact, per-key review basenames per cycle.
  // (Without the edge the run would also end 'done' — a blocked verifier with no
  // feedback simply advances, orchestrator dispatch ends `if (!rewound) i += 1` —
  // but then neither the rewind nor the -cycle2 suffix would be covered.)
  const wf = await writeWorkflow({
    name: 'Custom Agents',
    steps: [
      [{ id: 's0', key: 'planner' }],
      [{ id: 's1', key: 'specWriter' }],
      [{ id: 's2', key: 'specAuditor' }],
    ],
    feedbacks: [{ id: 'fb1', from: 's2', to: 's1', maxCycles: 2 }],
  });
  const orch = createOrchestrator({ projectDir: proj, prompt: 'demo custom agents', workflowId: wf.id, auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  const dir = orch.getState().pipelineDir;
  await access(join(dir, 'api-spec.md'));                       // cycle 1: channelDef filename honored
  await access(join(dir, 'api-spec-cycle2.md'));                // cycle 2: stem + -cycle2 suffix
  await access(join(dir, 'specAuditor-review-cycle1.json'));    // custom verifier basenames (blocked)
  await access(join(dir, 'specAuditor-review-cycle2.json'));    // ... and the passing cycle-2 verdict
  const uiPhases = orch.getState().stepper.steps
    .flatMap((s) => s.nodes || []).map((n) => n.uiPhase).filter(Boolean);
  assert.ok(uiPhases.includes('spec'), 'stepper manifest carries the meta uiPhase');
});
