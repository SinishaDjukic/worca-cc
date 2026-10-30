// test/orchestrator-auto-engine-gate.test.mjs — an Auto run's start gate reads the empty bootstrap graph, so the
// gate's node refusals run again once the run adopts its graph (_engineAdoptedGate): a step with no model on an
// engine that needs one (OpenCode), and a cost cap that cannot count a node's model.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { normalizeShape } from '../src/shared/graph/assemble.mjs';
import { runOpencodeProcess } from '../src/core/engines/opencode.mjs';

useTempHome(after);

const shape = (model) => normalizeShape({ name: 'Quick fix', taskKind: 'prompt',
  stages: [{ agent: 'planner', ...(model ? { model } : {}) }, { agent: 'implementer', ...(model ? { model } : {}) }] });

const auto = (dir, claude, model) => createOrchestrator({
  projectDir: gitDir(dir), workflowId: 'wf_auto', prompt: 'Build the thing.', humanInLoop: false, guardrailsId: 'permissive',
  claude,
  claudeAuth: async () => ({ state: 'signed-in', source: 'cli', detail: null }),
  classify: async () => ({ shape: shape(model), warnings: [], costUsd: 0, attempts: 1, model: null }),
});

test('Auto on OpenCode: an adopted step with no model is refused before it spawns', { timeout: 120000 }, async () => {
  const res = await auto('auto-opencode-nomodel', { mock: true, engine: 'opencode' }).run();
  assert.equal(res.status, 'error');
  assert.match(String(res.error), /OpenCode needs a model; pick one for this step/);
});

test('Auto under a cost cap: an adopted node model worca cannot price is refused', { timeout: 120000 }, async () => {
  // settings.json lives under $HOME/.worca-cc, not WORCA_HOME: a scratch HOME, never the real file.
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  const home = mkdtempSync(join(tmpdir(), 'worca-auto-cap-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try {
    mkdirSync(join(home, '.worca-cc'), { recursive: true });
    writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ pipelineCostLimitUsd: 5 }));
    const res = await auto('auto-cap-unpriced', { mock: true }, 'some-unpriced-model').run();
    assert.equal(res.status, 'error');
    assert.match(String(res.error), /cost|price/i);
  } finally {
    for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
  }
});

test('Auto on Claude without a cap still runs its adopted graph', { timeout: 120000 }, async () => {
  const res = await auto('auto-claude-ok', { mock: true }).run();
  assert.equal(res.status, 'done', res.error);
});

test('runOpencodeProcess refuses a run step with no model (never OpenCode\'s own default)', async () => {
  await assert.rejects(runOpencodeProcess({ cwd: process.cwd(), bin: '/nonexistent', prompt: 'x' }), /OpenCode needs a model/);
  await assert.rejects(runOpencodeProcess({ cwd: process.cwd(), bin: '/nonexistent', prompt: 'x', model: '  ' }), /OpenCode needs a model/);
});
