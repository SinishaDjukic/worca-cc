// test/config-models-global.test.mjs
// Phase 2 of configurable models (design §4.2/§4.4/§4.5): effective catalog
// composition (predefined ⊕ global ⊕ legacy project), resolveModelEnv, node
// validation parity with setStep, and global removal clearing cross-project
// refs with the shadow/legacy carve-outs.
//
// Sandboxes BOTH stores: WORCA_HOME (the DB) and HOME (settings.json, where
// the global catalog lives).
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  listModels, resolveModelEnv, setStep, setNodeModel, addCustomModel,
  resolveRunConfig, readConfig, globalModelRefs, removeGlobalModelAndRefs,
  PREDEFINED_MODELS,
} from '../src/core/config.mjs';
import { addGlobalModel, listGlobalModels } from '../src/core/settings.mjs';
import { EFFORTS, TIER_MODEL_ENV_KEYS } from '../src/core/model-env.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';

const dirs = [];
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};
async function freshStores() {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-gm-home-'));
  const whome = await mkdtemp(join(tmpdir(), 'worca-cc-gm-whome-'));
  dirs.push(home, whome);
  _resetForTests();
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_HOME = whome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1'; // catalog guard: HOME is sandboxed above
}
async function freshProject() {
  const d = await mkdtemp(join(tmpdir(), 'worca-cc-gm-proj-'));
  dirs.push(d);
  return d;
}
beforeEach(freshStores);
after(async () => {
  _resetForTests();
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

test('catalog: global entries appear for every project; legacy project entries rank lowest', async () => {
  const p = await freshProject();
  await addGlobalModel({ id: 'glm-4.7', label: 'GLM', efforts: ['medium'], env: { ANTHROPIC_BASE_URL: 'https://x' } });
  await addCustomModel(p, { id: 'proj-model' });

  const models = await listModels(p);
  const glm = models.find((m) => m.id === 'glm-4.7');
  assert.deepEqual(glm, { id: 'glm-4.7', label: 'GLM', efforts: ['medium'], custom: 'global', hasEnv: true, routed: true });
  const proj = models.find((m) => m.id === 'proj-model');
  assert.deepEqual(proj, { id: 'proj-model', label: 'proj-model', efforts: [...EFFORTS], custom: 'project', hasEnv: false, routed: false });
  // Env VALUES never leak into the catalog shape.
  assert.equal(Object.keys(glm).includes('env'), false);
  // Another project sees the global entry but not this project's legacy one.
  const p2 = await freshProject();
  const models2 = await listModels(p2);
  assert.ok(models2.some((m) => m.id === 'glm-4.7'));
  assert.ok(!models2.some((m) => m.id === 'proj-model'));
});

test('catalog: a global entry SHADOWS its predefined twin (id casing kept); legacy dup is dropped', async () => {
  const p = await freshProject();
  await addCustomModel(p, { id: 'glm-4.7' });                       // legacy first
  await addGlobalModel({ id: 'GLM-4.7', label: 'Routed GLM' });     // global wins over legacy
  await addGlobalModel({ id: 'claude-sonnet-4-6', label: 'Sonnet via proxy', efforts: ['medium', 'high'], env: { ANTHROPIC_BASE_URL: 'https://p' } });

  const models = await listModels(p);
  // Predefined shadow: same slot, predefined id casing, overridden metadata.
  const sonnet = models.find((m) => m.id === 'claude-sonnet-4-6');
  assert.deepEqual(sonnet, { id: 'claude-sonnet-4-6', label: 'Sonnet via proxy', efforts: ['medium', 'high'], custom: 'global', hasEnv: true, routed: true });
  assert.equal(models.filter((m) => m.id.toLowerCase() === 'claude-sonnet-4-6').length, 1);
  // Legacy dup of a global id is dropped from the composed view.
  assert.equal(models.filter((m) => m.id.toLowerCase() === 'glm-4.7').length, 1);
  assert.equal(models.find((m) => m.id.toLowerCase() === 'glm-4.7').custom, 'global');
  // Un-shadowed predefined entries are unchanged.
  const opus = models.find((m) => m.id === 'claude-opus-5');
  assert.deepEqual(opus, { ...PREDEFINED_MODELS[0], custom: false, hasEnv: false, routed: false });
});

test('addCustomModel rejects an id that already exists globally', async () => {
  const p = await freshProject();
  await addGlobalModel({ id: 'glm-4.7' });
  await assert.rejects(addCustomModel(p, { id: 'GLM-4.7' }), /already a global model/);
});

test('resolveModelEnv: global env only, ${VAR} expanded, case-insensitive id, undefined otherwise', async () => {
  const p = await freshProject();
  await addGlobalModel({ id: 'glm-4.7', env: { ANTHROPIC_BASE_URL: 'https://x', ANTHROPIC_AUTH_TOKEN: '${GM_TEST_TOKEN}' } });
  await addGlobalModel({ id: 'plain-model' });
  await addCustomModel(p, { id: 'proj-model' });

  process.env.GM_TEST_TOKEN = 'sk-42';
  try {
    // An endpoint-routed entry also carries the CLI tier keys = its own id (#422,
    // test/model-env-tier.test.mjs) — the canonical spelling, not the lookup's.
    const tier = Object.fromEntries(TIER_MODEL_ENV_KEYS.map((k) => [k, 'glm-4.7']));
    assert.deepEqual(resolveModelEnv('GLM-4.7'), { ANTHROPIC_BASE_URL: 'https://x', ANTHROPIC_AUTH_TOKEN: 'sk-42', ...tier });
  } finally {
    delete process.env.GM_TEST_TOKEN;
  }
  // Unset ref -> that key dropped, the rest survives.
  assert.deepEqual(resolveModelEnv('glm-4.7'), { ANTHROPIC_BASE_URL: 'https://x', ...Object.fromEntries(TIER_MODEL_ENV_KEYS.map((k) => [k, 'glm-4.7'])) });
  assert.equal(resolveModelEnv('plain-model'), undefined);   // global, no env
  assert.equal(resolveModelEnv('proj-model'), undefined);    // legacy: never env
  assert.equal(resolveModelEnv('claude-opus-5'), undefined); // predefined, unshadowed
  assert.equal(resolveModelEnv(''), undefined);
});

test('setNodeModel validates like setStep: unknown model/effort, unsupported effort, effort-without-model', async () => {
  const p = await freshProject();
  await addGlobalModel({ id: 'narrow', efforts: ['medium'] });

  await assert.rejects(setNodeModel(p, 'wf_x', 's0_0', { model: 'nope-9000' }), /unknown model "nope-9000"/);
  await assert.rejects(setNodeModel(p, 'wf_x', 's0_0', { model: 'narrow', effort: 'low' }), /unknown effort "low"/);
  await assert.rejects(setNodeModel(p, 'wf_x', 's0_0', { model: 'narrow', effort: 'max' }), /does not support effort/);
  await assert.rejects(setNodeModel(p, 'wf_x', 's0_0', { effort: 'high' }), /select a model before choosing an effort/);
  // Nothing was persisted by the failed writes.
  assert.deepEqual((await resolveRunConfig(p, 'wf_x')).nodes, {});
  // Valid writes still work, including toggle-only writes (no model/effort).
  await setNodeModel(p, 'wf_x', 's0_0', { model: 'narrow', effort: 'medium' });
  await setNodeModel(p, 'wf_x', 's1_0', { fanOut: true });
  const { nodes } = await resolveRunConfig(p, 'wf_x');
  assert.deepEqual(nodes.s0_0, { model: 'narrow', effort: 'medium' });
  assert.deepEqual(nodes.s1_0, { fanOut: true });
});

test('globalModelRefs + removeGlobalModelAndRefs: cross-project purge with carve-outs', async () => {
  const pA = await freshProject();
  const pB = await freshProject();
  const pC = await freshProject();
  await addGlobalModel({ id: 'glm-4.7' });
  // A: node + step refs (must be purged). B: node ref (must be purged).
  await setStep(pA, 'implementer', { model: 'glm-4.7' });
  await setNodeModel(pA, 'wf_x', 's2_0', { model: 'glm-4.7', effort: 'high' });
  await setNodeModel(pB, 'wf_y', 's1_0', { model: 'glm-4.7' });
  // C: carries a legacy custom model with the SAME id -> its refs survive.
  // (Add the legacy entry by writing it while the global exists is rejected, so
  // seed it via the DB row shape addCustomModel would have produced.)
  getDb().prepare(`
    INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra)
    VALUES (?, '{}', ?, NULL, '{}')
  `).run(projectKey(pC), JSON.stringify([{ id: 'glm-4.7', label: 'kept' }]));
  await setNodeModel(pC, 'wf_z', 's0_0', { model: 'glm-4.7' });

  const refs = globalModelRefs('glm-4.7');
  assert.equal(refs.predefinedShadow, false);
  assert.deepEqual(refs.steps, [{ projectKey: projectKey(pA), step: 'implementer' }]);
  assert.deepEqual(new Set(refs.nodes.map((n) => n.projectKey)), new Set([projectKey(pA), projectKey(pB)]));

  const result = await removeGlobalModelAndRefs('glm-4.7');
  assert.deepEqual(result, { clearedSteps: 1, clearedNodes: 2, predefinedShadow: false });
  assert.equal(listGlobalModels().length, 0);
  assert.deepEqual((await readConfig(pA)).steps, {});
  assert.deepEqual((await resolveRunConfig(pA, 'wf_x')).nodes, {});
  assert.deepEqual((await resolveRunConfig(pB, 'wf_y')).nodes, {});
  // The carve-out project keeps both its legacy entry and its node ref.
  assert.deepEqual((await resolveRunConfig(pC, 'wf_z')).nodes.s0_0, { model: 'glm-4.7' });
  assert.ok((await listModels(pC)).some((m) => m.id === 'glm-4.7' && m.custom === 'project'));
});

test('removing a predefined SHADOW reverts the override and purges nothing', async () => {
  const p = await freshProject();
  await addGlobalModel({ id: 'claude-sonnet-4-6', label: 'Proxied', env: { ANTHROPIC_BASE_URL: 'https://p' } });
  await setNodeModel(p, 'wf_x', 's0_0', { model: 'claude-sonnet-4-6', effort: 'high' });

  assert.deepEqual(globalModelRefs('claude-sonnet-4-6'), { predefinedShadow: true, steps: [], nodes: [] });
  const result = await removeGlobalModelAndRefs('claude-sonnet-4-6');
  assert.deepEqual(result, { clearedSteps: 0, clearedNodes: 0, predefinedShadow: true });
  // The ref survives — it now points at the built-in entry again.
  assert.deepEqual((await resolveRunConfig(p, 'wf_x')).nodes.s0_0, { model: 'claude-sonnet-4-6', effort: 'high' });
  const entry = (await listModels(p)).find((m) => m.id === 'claude-sonnet-4-6');
  assert.deepEqual(entry, { ...PREDEFINED_MODELS.find((m) => m.id === 'claude-sonnet-4-6'), custom: false, hasEnv: false, routed: false });
});

test('removeGlobalModelAndRefs on an unknown id throws WITHOUT purging same-string legacy refs', async () => {
  const p = await freshProject();
  await addCustomModel(p, { id: 'only-legacy' });
  await setNodeModel(p, 'wf_x', 's0_0', { model: 'only-legacy' });
  await assert.rejects(removeGlobalModelAndRefs('only-legacy'), /unknown model id/);
  assert.deepEqual((await resolveRunConfig(p, 'wf_x')).nodes.s0_0, { model: 'only-legacy' });
});

test('removing a global model keeps the row/step\'s OTHER tunables (only model+effort clear)', async () => {
  const p = await freshProject();
  await addGlobalModel({ id: 'glm-4.7' });
  await setStep(p, 'implementer', { model: 'glm-4.7', subagentModel: 'opus', fanOut: true });
  await setNodeModel(p, 'wf_x', 's2_0', { model: 'glm-4.7', effort: 'high', subagentModel: 'fable', askQuestions: true });

  const result = await removeGlobalModelAndRefs('glm-4.7');
  assert.deepEqual(result, { clearedSteps: 1, clearedNodes: 1, predefinedShadow: false });
  assert.deepEqual((await readConfig(p)).steps.implementer, { subagentModel: 'opus', fanOut: true },
    'the sub-agent policy and fan-out survive; only the dangling model ref clears');
  assert.deepEqual((await resolveRunConfig(p, 'wf_x')).nodes.s2_0, { subagentModel: 'fable', askQuestions: true },
    'the node row is UPDATED, not deleted — the effort goes with its model, the rest stays');
});

test('the built-in catalog offers Fable 5.1 and no longer Fable 5', () => {
  const fable = PREDEFINED_MODELS.find((m) => m.id === 'claude-fable-5-1');
  assert.deepEqual(fable, { id: 'claude-fable-5-1', label: 'Fable 5.1 (1M)', efforts: ['medium', 'high', 'xhigh', 'max'] });
  assert.equal(PREDEFINED_MODELS.some((m) => m.id === 'claude-fable-5'), false,
    'the retired id is gone from the catalog (db.mjs V26 moves the stored pins)');
});
