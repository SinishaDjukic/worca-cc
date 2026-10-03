// test/orchestrator-auto-engine.test.mjs — Auto on Codex (cascading-settings-design.md §4.5): the
// classifier sees only Codex models, names no model, and the Claude sign-in is never probed —
// codex's own readiness (codexPreflight) is checked at run start by the engine gate.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { normalizeShape } from '../src/shared/graph/assemble.mjs';

useTempHome(after);

const QUICK = { name: 'Quick fix', taskKind: 'prompt', stages: [{ agent: 'planner' }, { agent: 'implementer' }, { agent: 'reviewer' }] };

test('Auto on codex: no Claude sign-in probe, Codex models only, no classifier model', { timeout: 120000 }, async () => {
  let probed = 0;
  const inputs = [];
  const orch = createOrchestrator({
    projectDir: gitDir('auto-codex'), workflowId: 'wf_auto', prompt: 'Build the thing.', humanInLoop: false,
    claude: { mock: true, engine: 'codex' },
    claudeAuth: async () => { probed += 1; return { state: 'signed-out', source: 'cli', detail: null }; },
    classify: async (input) => { inputs.push(input); return { shape: normalizeShape(QUICK), warnings: [], costUsd: 0, attempts: 1, model: input.model || null }; },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(probed, 0);
  assert.equal(inputs[0].engine, 'codex');
  assert.equal(inputs[0].model, '');
  assert.equal(inputs[0].requireModel, false);
  assert.ok(inputs[0].models.length > 0 && inputs[0].models.every((m) => m.engine === 'codex'), JSON.stringify(inputs[0].models.map((m) => m.id)));
});

test('Auto on Claude is unchanged: the sign-in is probed and only Claude models are offered', { timeout: 120000 }, async () => {
  let probed = 0;
  const inputs = [];
  const orch = createOrchestrator({
    projectDir: gitDir('auto-claude'), workflowId: 'wf_auto', prompt: 'Build the thing.', humanInLoop: false,
    claude: { mock: true },
    claudeAuth: async () => { probed += 1; return { state: 'signed-in', source: 'cli', detail: null }; },
    classify: async (input) => { inputs.push(input); return { shape: normalizeShape(QUICK), warnings: [], costUsd: 0, attempts: 1, model: input.model || null }; },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(probed, 1);
  assert.equal(inputs[0].engine, 'claude');
  assert.ok(inputs[0].models.length > 0 && inputs[0].models.every((m) => m.engine === 'claude'));
});
