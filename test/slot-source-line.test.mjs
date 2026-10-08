// test/slot-source-line.test.mjs — cascading settings §7: at run start a node model that came from its
// engine's step slot is named with where it was set, so a model the engine rejects is traceable.
// Isolates HOME: settings.json lives under $HOME/.worca-cc, never the developer's.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { setStepModels } from '../src/core/settings.mjs';

useTempHome(after);
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const home = mkdtempSync(join(tmpdir(), 'worca-slot-source-home-'));
process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true });
});

test('a slot-sourced node model is named at run start with where it was set (review I5)', { timeout: 120000 }, async () => {
  await setStepModels({ codex: { planner: { model: 'gpt-5.5', effort: 'low' } } });
  const orch = createOrchestrator({ projectDir: gitDir('codex-slot-source'), workflowId: 'wf_default', prompt: 'Add a settings page', auto: true, claude: { mock: true, engine: 'codex' } });
  const logs = [];
  orch.on('log', (l) => logs.push(JSON.stringify(l)));
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.ok(logs.some((l) => l.includes('codex model \\"gpt-5.5\\" for planner from your settings (models.codex.steps.planner)')), logs.filter((l) => /model/.test(l)).join('\n'));
});
