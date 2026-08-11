// test/model-env-dispatch.test.mjs
// Phase 3 dispatch wiring: runOpts (phases.mjs) resolves the model's routing
// env at the ONE funnel every dispatched node/role passes through, so
// _phaseCtx/_nodeCtx and the workspace-scan path inherit it with no
// per-caller edits (design §4.4/§4.8).
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _runOptsForTests as runOpts } from '../src/core/phases.mjs';
import { addGlobalModel } from '../src/core/settings.mjs';
import { _resetForTests } from '../src/core/db.mjs';

const dirs = [];
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};
beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-med-home-'));
  const whome = await mkdtemp(join(tmpdir(), 'worca-cc-med-whome-'));
  dirs.push(home, whome);
  _resetForTests();
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_HOME = whome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1'; // catalog guard: HOME is sandboxed above
});
after(async () => {
  _resetForTests();
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const CTX_BASE = { projectDir: '/tmp/p', claudeOpts: {} };
const CALL = { role: 'implementer', prompt: 'p', systemPrompt: 's', allowedTools: ['Read'] };

test('runOpts resolves modelEnv from the dispatched model id', async () => {
  await addGlobalModel({ id: 'routed-model', env: { ANTHROPIC_BASE_URL: 'https://proxy.test/v1' } });
  const opts = runOpts({ ...CTX_BASE, claudeOpts: { model: 'routed-model' } }, CALL);
  assert.equal(opts.model, 'routed-model');
  assert.deepEqual(opts.modelEnv, { ANTHROPIC_BASE_URL: 'https://proxy.test/v1' });
});

test('runOpts leaves modelEnv undefined for env-less and unconfigured models', async () => {
  await addGlobalModel({ id: 'plain-model' });
  assert.equal(runOpts({ ...CTX_BASE, claudeOpts: { model: 'plain-model' } }, CALL).modelEnv, undefined);
  assert.equal(runOpts({ ...CTX_BASE, claudeOpts: { model: 'claude-opus-5' } }, CALL).modelEnv, undefined);
  assert.equal(runOpts({ ...CTX_BASE, claudeOpts: {} }, CALL).modelEnv, undefined, 'no model -> no env');
});
