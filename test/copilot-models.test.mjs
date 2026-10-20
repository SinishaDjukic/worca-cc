// test/copilot-models.test.mjs — Copilot's catalog models: the copilot/<id> built-ins, the sign-in rows a user adds,
// and the wire id copilot is given.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { COPILOT_BUILTIN_MODELS, CODEX_BUILTIN_MODELS, listModels, enginesOfModel, modelRunsOn } from '../src/core/config.mjs';
import { addGlobalModel } from '../src/core/settings.mjs';
import { COPILOT_EFFORTS, MODEL_ENGINES, copilotWireModel, effortsForEngine } from '../src/core/model-env.mjs';
import { COPILOT_EFFORTS as ADAPTER_EFFORTS } from '../src/core/engines/copilot.mjs';
import { HARNESS_EFFORTS, connectionLabel, effortOn } from '../src/shared/connections.mjs';

useTempHome(after);
// settings.json lives under $HOME/.worca-cc: the catalog writes below go to a sandboxed HOME, never the real one.
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-copilot-models-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

test('Copilot owns catalog models: one effort vocabulary everywhere', () => {
  assert.ok(MODEL_ENGINES.includes('copilot'));
  assert.deepEqual([...ADAPTER_EFFORTS], COPILOT_EFFORTS);
  assert.deepEqual([...HARNESS_EFFORTS.copilot], COPILOT_EFFORTS);
  assert.equal(effortsForEngine('copilot'), COPILOT_EFFORTS);
  assert.equal(effortOn('max', 'copilot'), 'max');
  assert.equal(effortOn('none', 'claude'), 'medium', 'none maps to the nearest effort elsewhere');
});

test('the built-ins are copilot/<id>, never an id another engine owns, and copilot is handed its own id', () => {
  assert.ok(COPILOT_BUILTIN_MODELS.length > 0);
  const codex = new Set(CODEX_BUILTIN_MODELS.map((m) => m.id));
  for (const m of COPILOT_BUILTIN_MODELS) {
    assert.match(m.id, /^copilot\/[a-z0-9.-]+$/);
    assert.ok(!codex.has(m.id));
    assert.ok(m.efforts.every((e) => COPILOT_EFFORTS.includes(e)));
  }
  assert.equal(copilotWireModel('copilot/gpt-5.5'), 'gpt-5.5');
  assert.equal(copilotWireModel('Copilot/gpt-5.5'), 'gpt-5.5');
  assert.equal(copilotWireModel('gpt-5.4'), 'gpt-5.4', 'any other id as it is');
});

test('a built-in is a Copilot sign-in row that runs on Copilot only', async () => {
  const rows = await listModels('');
  const row = rows.find((m) => m.id === 'copilot/gpt-5.5');
  assert.equal(row.engine, 'copilot');
  assert.equal(row.builtin, true);
  assert.equal(connectionLabel(row), 'Copilot sign-in');
  assert.deepEqual(enginesOfModel('copilot/gpt-5.5'), ['copilot']);
  assert.equal(modelRunsOn('copilot/gpt-5.5', 'claude'), false);
  assert.equal(rows.find((m) => m.id === 'gpt-5.5').engine, 'codex', 'the bare id stays Codex\'s');
});

test('a Copilot model takes no env and no upstream; copilot/ ids are for Copilot rows', async () => {
  await assert.rejects(() => addGlobalModel({ id: 'cp-x', engine: 'copilot', env: { ANTHROPIC_MODEL: 'x' } }), /a copilot model takes no env/);
  await assert.rejects(() => addGlobalModel({ id: 'cp-y', engine: 'copilot', upstream: { provider: 'openai', api: 'openai-responses', model: 'x', baseUrl: 'http://127.0.0.1:1/v1' } }), /takes no upstream/);
  await assert.rejects(() => addGlobalModel({ id: 'gpt-5.5', engine: 'copilot' }), /built-in model id — Copilot's own models are copilot\/<id>/);
  await assert.rejects(() => addGlobalModel({ id: 'copilot/mine', engine: 'claude', env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' } }), /a copilot\/ id is for the Copilot engine/);
  await addGlobalModel({ id: 'copilot/kimi-k3-preview', label: 'Kimi K3 Preview', engine: 'copilot', efforts: ['low', 'high'] });
  assert.deepEqual(enginesOfModel('copilot/kimi-k3-preview'), ['copilot']);
});
