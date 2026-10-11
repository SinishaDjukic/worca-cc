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

test('Auto on cursor: Claude classifies (Claude\'s sign-in, no cursor-agent bin); the nodes pick from Cursor\'s catalog', { timeout: 120000 }, async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { addGlobalModel } = await import('../src/core/settings.mjs');
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  const home = mkdtempSync(join(tmpdir(), 'worca-auto-cursor-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try {
    mkdirSync(join(home, '.worca-cc'), { recursive: true });
    writeFileSync(join(home, '.worca-cc', 'settings.json'), '{}');
    await addGlobalModel({ id: 'my-cursor-m', engine: 'cursor' });
    const run = async (state) => {
      let probed = 0;
      const inputs = [];
      const logs = [];
      const orch = createOrchestrator({
        projectDir: gitDir('auto-cursor'), workflowId: 'wf_auto', prompt: 'Build the thing.', humanInLoop: false,
        claude: { mock: true, engine: 'cursor', bin: '/nonexistent/cursor-agent' },
        claudeAuth: async () => { probed += 1; return { state, source: 'cli', detail: null }; },
        classify: async (input) => { inputs.push(input); return { shape: normalizeShape(QUICK), warnings: [], costUsd: 0, attempts: 1, model: input.model || null }; },
      });
      orch.on('log', (l) => logs.push(String(l.text)));
      const res = await orch.run();
      return { res, probed, inputs, logs };
    };
    const a = await run('signed-in');
    assert.equal(a.res.status, 'done', a.res.error);
    assert.equal(a.probed, 1);
    assert.equal(a.inputs[0].engine, 'claude');
    assert.equal('bin' in a.inputs[0], false, 'cursor-agent\'s bin never reaches the Claude classifier');
    assert.deepEqual(a.inputs[0].models.map((m) => m.id), ['my-cursor-m'], 'node models: the Cursor catalog only');
    assert.notEqual(a.inputs[0].model, 'my-cursor-m');
    const b = await run('signed-out');
    assert.equal(b.res.status, 'done', b.res.error);
    assert.ok(b.logs.some((t) => /^auto: /.test(t)), b.logs.join('\n'));
  } finally {
    for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
  }
});
