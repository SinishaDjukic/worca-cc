import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';

useTempHome(after);
const REG = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });

test('humanInLoop: on by default, off when asked, and always off under --yes', () => {
  assert.equal(createOrchestrator({ projectDir: process.cwd(), claude: { mock: true } }).humanInLoop, true);
  assert.equal(createOrchestrator({ projectDir: process.cwd(), claude: { mock: true }, humanInLoop: false }).humanInLoop, false);
  assert.equal(createOrchestrator({ projectDir: process.cwd(), claude: { mock: true }, auto: true, humanInLoop: true }).humanInLoop, false);
});

test('wf_auto resolves to the bootstrap topology: an empty graph tagged deciding, no agent keys', async () => {
  const orch = createOrchestrator({ projectDir: process.cwd(), workflowId: 'wf_auto', claude: { mock: true } });
  const t = await orch._resolveTopology(REG);
  assert.deepEqual(t.workflow, { id: 'wf_auto', name: 'Auto' });
  assert.equal(t.agentKeys.size, 0);
  assert.equal(t.manifest.version, 2);
  assert.deepEqual(t.manifest.template, { id: 'wf_auto', name: 'Auto' });
  assert.deepEqual(t.manifest.graph, { nodes: [], wires: [] });
  assert.deepEqual(t.manifest.auto, { status: 'deciding', humanInLoop: true });
  assert.deepEqual(t.manifest.steps.map((s) => s.kind), ['preflight', 'done'], 'the bookends still render');
  const saved = createOrchestrator({ projectDir: process.cwd(), workflowId: 'wf_default', claude: { mock: true } });
  const s = await saved._resolveTopology(REG);
  assert.equal(s.manifest.auto, undefined, 'a saved workflow carries no auto block');
});

test('the resume point of an undecided Auto run carries the decision state; a decided/saved run carries null', async () => {
  const orch = createOrchestrator({ projectDir: process.cwd(), workflowId: 'wf_auto', claude: { mock: true }, humanInLoop: false });
  orch.pipeline = { id: 'p', dir: '/tmp/p', promptText: 'x' };
  orch.state.stepper = (await orch._resolveTopology(REG)).manifest;
  orch._auto.feedback.push('shorter');
  orch._auto.round = 2;
  const rp = orch._buildResumePoint(null);
  assert.equal(rp.version, 2);
  assert.equal(rp.workflowId, 'wf_auto');
  assert.deepEqual(rp.auto, { humanInLoop: false, feedback: ['shorter'], round: 2, prior: null, costUsd: 0, pending: null });
  assert.equal(rp.manifest.auto.status, 'deciding');
  const saved = createOrchestrator({ projectDir: process.cwd(), workflowId: 'wf_default', claude: { mock: true } });
  saved.pipeline = { id: 'p', dir: '/tmp/p', promptText: 'x' };
  assert.equal(saved._buildResumePoint(null).auto, null);
});

test('_ask: a workflow question is auto-accepted under --yes and the payload rides the question event otherwise', async () => {
  const auto = createOrchestrator({ projectDir: process.cwd(), workflowId: 'wf_auto', claude: { mock: true }, auto: true });
  auto.state.status = 'running';
  assert.deepEqual(await auto._ask({ id: 'auto-1', kind: 'workflow', workflow: { round: 1 } }), { decision: 'accept' });

  const orch = createOrchestrator({ projectDir: process.cwd(), workflowId: 'wf_auto', claude: { mock: true } });
  orch.state.status = 'running';
  const seen = [];
  orch.on('question', (q) => { seen.push(q); setImmediate(() => orch.answer(q.id, { decision: 'revise', text: 'no' })); });
  const answer = await orch._ask({ id: 'auto-1', kind: 'workflow', workflow: { round: 1, name: 'N' } });
  assert.deepEqual(answer, { decision: 'revise', text: 'no' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'workflow');
  assert.deepEqual(seen[0].workflow, { round: 1, name: 'N' });
  assert.equal(seen[0].questions, undefined);
});

test('_ask with a validate hook keeps the question PENDING on a malformed answer and resolves the CLEAN value', async () => {
  const orch = createOrchestrator({ projectDir: process.cwd(), workflowId: 'wf_auto', claude: { mock: true } });
  orch.state.status = 'running';
  const results = [];
  orch.on('question', (q) => setImmediate(() => {
    results.push(orch.answer(q.id, { decision: 'maybe' }));                       // malformed: ignored, the question stays open
    results.push(orch.answer(q.id, { decision: 'revise', text: '  shorter ' }));  // well-formed: resolved with the CLEAN value
  }));
  const validate = (raw) => (raw?.decision === 'revise' && typeof raw.text === 'string' && raw.text.trim() ? { decision: 'revise', text: raw.text.trim() } : null);
  const answer = await orch._ask({ id: 'auto-1', kind: 'workflow', workflow: { round: 1 }, validate });
  assert.deepEqual(answer, { decision: 'revise', text: 'shorter' });
  assert.deepEqual(results, [false, true], 'answer() reports the ignored payload, then the accepted one');
  assert.equal(orch.pendingQuestion, null);
});
