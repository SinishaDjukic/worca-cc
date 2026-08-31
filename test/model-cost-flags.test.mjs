// test/model-cost-flags.test.mjs
// §4.6 cost-reliability observations: only env-routed models are observed,
// flagged on zero/absent cost WITH token usage, auto-cleared on a positive
// cost, surfaced through the catalog (costUnreliable) and GET /api/models.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  listModels, observeModelCost, modelHasBaseUrlRouting, costUnreliableModelIds,
} from '../src/core/config.mjs';
import { addGlobalModel } from '../src/core/settings.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';

const dirs = [];
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};
beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-mcf-home-'));
  const whome = await mkdtemp(join(tmpdir(), 'worca-cc-mcf-whome-'));
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

const USAGE = { input_tokens: 1200, output_tokens: 300 };

test('modelHasBaseUrlRouting: only global entries with an ANTHROPIC_BASE_URL key (direct or ${VAR})', async () => {
  await addGlobalModel({ id: 'routed', env: { ANTHROPIC_BASE_URL: 'https://p' } });
  await addGlobalModel({ id: 'routed-ref', env: { ANTHROPIC_BASE_URL: '${MY_URL}' } });
  await addGlobalModel({ id: 'token-only', env: { ANTHROPIC_AUTH_TOKEN: 'sk-x' } });
  await addGlobalModel({ id: 'plain' });
  assert.equal(modelHasBaseUrlRouting('ROUTED'), true, 'case-insensitive');
  assert.equal(modelHasBaseUrlRouting('routed-ref'), true, 'a ref still routes');
  assert.equal(modelHasBaseUrlRouting('token-only'), false);
  assert.equal(modelHasBaseUrlRouting('plain'), false);
  assert.equal(modelHasBaseUrlRouting('claude-opus-5'), false, 'unshadowed predefined never routes');
  assert.equal(modelHasBaseUrlRouting(''), false);
});

test('observe: unrouted models are never observed, whatever they report', async () => {
  await addGlobalModel({ id: 'plain' });
  assert.equal(observeModelCost('plain', 0, USAGE), null);
  assert.equal(observeModelCost('claude-opus-5', null, USAGE), null);
  assert.equal(costUnreliableModelIds().size, 0);
});

test('observe: routed + zero/absent cost + tokens -> flagged; positive cost auto-clears', async () => {
  await addGlobalModel({ id: 'routed', env: { ANTHROPIC_BASE_URL: 'https://p' } });

  // No tokens (e.g. an errored run) -> no signal either way.
  assert.equal(observeModelCost('routed', 0, {}), null);
  assert.equal(observeModelCost('routed', null, undefined), null);
  assert.equal(costUnreliableModelIds().size, 0);

  assert.equal(observeModelCost('routed', 0, USAGE), 'flagged');
  assert.deepEqual([...costUnreliableModelIds()], ['routed']);
  // Re-flagging is idempotent (still reported so the caller's per-run warn set decides).
  assert.equal(observeModelCost('routed', null, USAGE), 'flagged');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM model_cost_flags').get().n, 1);

  // The catalog surfaces the observation...
  const entry = (await listModels('')).find((m) => m.id === 'routed');
  assert.equal(entry.costUnreliable, true);
  assert.equal((await listModels('')).find((m) => m.id === 'claude-opus-5').costUnreliable, undefined);

  // ...and a later positive-cost run clears it.
  assert.equal(observeModelCost('ROUTED', 1.23, USAGE), 'cleared', 'case-insensitive clear');
  assert.equal(costUnreliableModelIds().size, 0);
  assert.equal((await listModels('')).find((m) => m.id === 'routed').costUnreliable, undefined);
  assert.equal(observeModelCost('routed', 0.5, USAGE), null, 'clearing an unflagged model is a no-op');
});

test('catalog: every entry carries routed = ANTHROPIC_BASE_URL key presence', async () => {
  await addGlobalModel({ id: 'ds-stable', env: { ANTHROPIC_BASE_URL: 'https://gw' } });
  await addGlobalModel({ id: 'ds-ref', env: { ANTHROPIC_BASE_URL: '${MY_GW}' } });
  await addGlobalModel({ id: 'token-only', env: { ANTHROPIC_AUTH_TOKEN: 'sk-x' } });
  await addGlobalModel({ id: 'plain' });
  const models = await listModels('');
  const byId = new Map(models.map((m) => [m.id, m]));
  assert.equal(byId.get('ds-stable').routed, true);
  assert.equal(byId.get('ds-ref').routed, true, 'a ${VAR} ref still routes — key presence is the signal');
  assert.equal(byId.get('token-only').routed, false, 'hasEnv true, routed false — the flags are not the same');
  assert.equal(byId.get('plain').routed, false);
  for (const m of models) assert.equal(typeof m.routed, 'boolean', `${m.id} carries the flag`);
  assert.equal(byId.get('claude-opus-5').routed, false, 'unshadowed predefined never routes');
});

test('catalog: a global shadow of a predefined id carries the shadow env routing', async () => {
  await addGlobalModel({ id: 'claude-opus-5', env: { ANTHROPIC_BASE_URL: 'https://gw' } });
  const models = await listModels('');
  assert.equal(models.find((m) => m.id === 'claude-opus-5').routed, true);
});
