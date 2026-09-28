// test/orchestrator-auto-signed-out.test.mjs
// Signed out (worca-01, 2026-09-26): Auto offered claude-opus-5 / claude-fable-5-1 and the planner
// died on "Not logged in". Signed out, Auto designs only with endpoint-routed / provider models
// and names one on every stage; the fallback recipe runs on the classifier's own model.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { normalizeShape } from '../src/shared/graph/assemble.mjs';
import { ClassifierError } from '../src/core/auto/classify.mjs';
import { addGlobalModel } from '../src/core/settings.mjs';

useTempHome(after);
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-auto-signed-out-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  // The one model this "install" can run without a Claude sign-in: routed to an endpoint.
  await addGlobalModel({ id: 'gw-model', label: 'Gateway model', efforts: ['medium'], env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' } });
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

const S = (agent, extra = {}) => ({ agent, ...extra });
const QUICK = { name: 'Quick fix', taskKind: 'prompt', stages: [S('planner'), S('implementer'), S('reviewer')] };
const shapeOf = (s, costUsd = 0.01) => async (input) => ({ shape: normalizeShape(s), warnings: [], costUsd, attempts: 1, model: input.model || null });
const transient = (cls, msg) => new ClassifierError('CLASSIFIER_FAILED', msg, [], { costUsd: 0.001, errorClass: cls });
const POOL_429 = 'claude exited with code 1: API Error: Request rejected (429) · openai: rate limited (429)';
const orchFor = (dir, over = {}) => createOrchestrator({ projectDir: dir, workflowId: 'wf_auto', prompt: 'Build the thing.', claude: { mock: true }, humanInLoop: false, ...over });
const signedOut = async () => ({ state: 'signed-out', source: 'cli', detail: null });

test('signed out: Auto offers only routed models and requires one per stage; the fallback runs on the routed model', { timeout: 120000 }, async () => {
  process.env.WORCA_RECOVERY_BACKOFF_MS = '0';
  try {
    const inputs = [];
    const logs = [];
    const orch = orchFor(gitDir('auto-signed-out'), {
      claudeAuth: signedOut,
      classify: async (input) => { inputs.push(input); throw transient('rate_limit', POOL_429); },
    });
    orch.on('log', (l) => logs.push(l));
    const res = await orch.run();
    assert.equal(res.status, 'done', res.error);
    assert.deepEqual(inputs[0].models.map((m) => m.id), ['gw-model'], 'first-party models are not offered while signed out');
    assert.equal(inputs[0].requireModel, true);
    assert.equal(inputs[0].model, 'gw-model', 'the classifier itself runs on a routed model');
    assert.ok(logs.some((l) => /auto: Claude Code isn't signed in — Auto designs with the 1 model/.test(l.text || '')), 'the run log says why');
    const st = orch.getState();
    assert.equal(st.stepper.auto.via, 'fallback');
    const agentNodes = st.stepper.graph.nodes.filter((n) => n.kind === 'agent');
    assert.ok(agentNodes.length > 0);
    for (const n of agentNodes) assert.equal(n.model, 'gw-model', `fallback node ${n.key} runs on the routed model`);
  } finally { delete process.env.WORCA_RECOVERY_BACKOFF_MS; }
});

test('signed in: Auto offers the whole ready catalog and a stage may omit its model', { timeout: 120000 }, async () => {
  const inputs = [];
  const orch = orchFor(gitDir('auto-signed-in'), {
    claudeAuth: async () => ({ state: 'signed-in', source: 'cli', detail: null }),
    classify: async (input) => { inputs.push(input); return shapeOf(QUICK)(input); },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(inputs[0].requireModel, false);
  assert.ok(inputs[0].models.some((m) => /^claude-/.test(m.id)), 'first-party models are offered while signed in');
});
