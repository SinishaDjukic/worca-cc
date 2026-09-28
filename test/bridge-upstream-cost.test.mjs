// test/bridge-upstream-cost.test.mjs
// A bridged node's spend (docs/models.md › Cost and quota): the CLI prices a
// bridged id it does not know at $0, so when the upstream reported the USD cost
// of the node's calls itself (OpenRouter's usage.cost, booked by the bridge under
// the execution id), that figure is recorded for the step instead — and a node
// whose upstream reported nothing keeps today's behaviour.
// Sandboxing mirrors test/model-cost-override.test.mjs.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addGlobalModel } from '../src/core/settings.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { recordBridgeCall, recordBridgeCost, bridgeCostFor, _resetBridgeTelemetry } from '../src/core/bridge/telemetry.mjs';

const dirs = [];
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};
beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-buc-home-'));
  const whome = await mkdtemp(join(tmpdir(), 'worca-cc-buc-whome-'));
  dirs.push(home, whome);
  _resetForTests();
  _resetBridgeTelemetry();
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_HOME = whome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  _resetForTests();
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const UPSTREAM = { provider: 'openai', api: 'openai-chat', model: 'qwen/qwen3.8-27b', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-x' };
const USAGE = { input_tokens: 100, output_tokens: 10 };

test('a node whose upstream reported its cost records that figure, not the CLI\'s $0, and the tag is forgotten', async () => {
  await addGlobalModel({ id: 'or-qwen', upstream: UPSTREAM });
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'buc-proj') });
  orch._phase('plan', 0, 'start');
  recordBridgeCall({ tag: 'x:plan:1', catalogId: 'or-qwen', provider: 'openai', api: 'openai-chat', initiator: 'user' });
  recordBridgeCost({ tag: 'x:plan:1', costUsd: 0.0012 });
  recordBridgeCost({ tag: 'x:plan:1', costUsd: 0.0003 });
  orch._onAgentEvent('planner',
    { type: 'result', costUsd: 0, raw: { type: 'result', total_cost_usd: 0, usage: USAGE } },
    { model: 'or-qwen', stepKey: 'plan', executionId: 'x:plan:1' });
  const st = orch.getState();
  assert.equal(st.steps.find((s) => s.key === 'plan').costUsd, 0.0015);
  assert.equal(st.totalCostUsd, 0.0015);
  assert.equal(bridgeCostFor('x:plan:1'), null, 'consumed with the call counters');
});

test('the upstream figure also wins over a pinned price: it is what the call actually cost', async () => {
  await addGlobalModel({ id: 'or-priced', upstream: UPSTREAM, cost: { perMtok: { input: 100, output: 100 } } });
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'buc-proj2') });
  orch._phase('plan', 0, 'start');
  recordBridgeCall({ tag: 'y:plan:1', catalogId: 'or-priced', provider: 'openai', api: 'openai-chat', initiator: 'user' });
  recordBridgeCost({ tag: 'y:plan:1', costUsd: 0.25 });
  orch._onAgentEvent('planner',
    { type: 'result', costUsd: 0, raw: { type: 'result', usage: USAGE } },
    { model: 'or-priced', stepKey: 'plan', executionId: 'y:plan:1' });
  assert.equal(orch.getState().totalCostUsd, 0.25);
});

test('no upstream cost reported: the CLI figure (or a pinned price) is used as before', async () => {
  await addGlobalModel({ id: 'or-free', upstream: UPSTREAM, cost: { free: true } });
  const orch = createOrchestrator({ projectDir: join(tmpdir(), 'buc-proj3') });
  orch._phase('plan', 0, 'start');
  recordBridgeCall({ tag: 'z:plan:1', catalogId: 'or-free', provider: 'openai', api: 'openai-chat', initiator: 'user' });
  orch._onAgentEvent('planner',
    { type: 'result', costUsd: 0.5, raw: { type: 'result', usage: USAGE } },
    { model: 'or-free', stepKey: 'plan', executionId: 'z:plan:1' });
  assert.equal(orch.getState().totalCostUsd, 0, '{free} pin still discards the CLI figure');
});
