// test/model-uses.test.mjs — who uses a model (U2b, PAN-6) and the clear a delete runs (PAN-7): every user-level
// job that names a model id, project picks with their project's name, and clearModelUses keeping what is not the pick.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Sandbox BEFORE src/core loads: settings.json lives under HOME, the DB under WORCA_HOME.
const home = mkdtempSync(join(tmpdir(), 'worca-cc-model-uses-home-'));
const whome = mkdtempSync(join(tmpdir(), 'worca-cc-model-uses-whome-'));
const dirs = [home, whome];
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};
process.env.HOME = home; process.env.USERPROFILE = home;
process.env.WORCA_HOME = whome;
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';

const { modelUses, clearModelUses } = await import('../src/core/model-uses.mjs');
const { projectModelPicks, setStep, setNodeModel } = await import('../src/core/config.mjs');
const { settingsFile, addGlobalModel } = await import('../src/core/settings.mjs');
const { addProject } = await import('../src/core/projects.mjs');
const { getDb, _resetForTests } = await import('../src/core/db.mjs');
const { projectKey } = await import('../src/core/store.mjs');
const { HELPER_JOBS, DESIGN_JOBS } = await import('../src/shared/model-jobs.mjs');
const { roleOfJob } = await import('../src/shared/model-roles.mjs');
const { JOB_LABELS, DESIGN_ROW_LABELS, utilityId } = await import('../ui/public/engine-settings-view.mjs');

after(() => {
  _resetForTests();
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const writeSettings = (s) => {
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(s));
};
const readBack = () => JSON.parse(readFileSync(settingsFile(), 'utf8'));
const seed = () => writeSettings({
  modelRoles: { claude: { deep: { model: 'M1', effort: 'xhigh' } }, codex: { quick: { model: 'm2' } } },
  stepModels: { claude: { planner: { model: 'm1' } }, codex: { implementer: { effort: 'high' } } },
  utilityModels: { codex: { overview: { model: 'm2' } } },
  titleModel: 'm3',
  agentGenModel: { model: 'm1', effort: '' },
  memory: { defrag: { model: 'm3', effort: 'high', writes: 5 }, softBytesPerFile: 4096 },
  designModels: { claude: { lead: { model: 'm1' } } },
});
const triples = (uses) => (uses || []).map((u) => `${u.kind}·${u.engine}·${u.key}`).sort();

test('model-jobs: the helper and Design job tables match the Settings rows they copy (labels, setting ids, roles)', () => {
  for (const [engine, jobs] of Object.entries(HELPER_JOBS)) {
    for (const j of jobs) {
      assert.equal(j.label, JOB_LABELS[j.key], `${engine}.${j.key} label`);
      assert.equal(j.settingId, utilityId(engine, j.key), `${engine}.${j.key} settingId`);
      assert.equal(j.role, roleOfJob(engine, j.key), `${engine}.${j.key} role`);
    }
  }
  assert.deepEqual(HELPER_JOBS.codex.map((j) => j.key), ['title', 'classifier', 'overview', 'prDescription', 'memoryDefrag', 'workspaceScan', 'secondOpinion']);
  assert.deepEqual(DESIGN_JOBS.map((j) => [j.key, j.label]), Object.entries(DESIGN_ROW_LABELS));
});

test('modelUses: every user-level job naming a model, keyed by the lower-cased id, with its label', () => {
  seed();
  const uses = modelUses();
  assert.deepEqual(triples(uses.m1), ['design·claude·lead', 'helper·claude·agentGen', 'role·claude·deep', 'step·claude·planner']);
  assert.deepEqual(triples(uses.m2), ['helper·codex·overview', 'role·codex·quick']);
  assert.deepEqual(uses.m3.map((u) => u.label).sort(), ['Memory defragment', 'Titles']);
  assert.equal(uses.m1.find((u) => u.kind === 'role').label, 'Deep thinking');
  assert.equal(uses.m1.find((u) => u.kind === 'step').label, 'Plan');
  assert.equal(uses.m2.find((u) => u.kind === 'helper').label, 'Run overview');
  assert.equal(uses.m1.find((u) => u.kind === 'design').label, 'Design lead');
  assert.equal('' in uses, false, 'an effort-only pick names no model');
  assert.equal(Object.values(uses).flat().some((u) => u.key === 'implementer'), false, 'the effort-only step is no use');
  assert.equal('M1' in uses, false, 'keys are lower-cased');
});

test('clearModelUses: clears every pick naming the id (any case), keeps the rest, drops emptied blocks', async () => {
  seed();
  assert.equal(await clearModelUses('M1'), 4);
  const s = readBack();
  assert.equal(s.modelRoles.claude, undefined, 'the emptied engine block goes');
  assert.deepEqual(s.modelRoles.codex, { quick: { model: 'm2' } });
  assert.deepEqual(s.stepModels, { codex: { implementer: { effort: 'high' } } });
  assert.equal('agentGenModel' in s, false);
  assert.equal('designModels' in s, false, 'an emptied top-level map goes');
  assert.equal(s.titleModel, 'm3');
  assert.deepEqual(s.utilityModels, { codex: { overview: { model: 'm2' } } });
  assert.equal(await clearModelUses('m1'), 0, 'nothing left to clear');
});

test('clearModelUses: the defrag pick goes, the defragment thresholds and other memory keys stay', async () => {
  seed();
  assert.equal(await clearModelUses('m3'), 2);
  const s = readBack();
  assert.equal('titleModel' in s, false);
  assert.deepEqual(s.memory.defrag, { writes: 5 });
  assert.equal(s.memory.softBytesPerFile, 4096);
});

test('modelUses / clearModelUses: a key or id named after an Object.prototype member is a plain key', async () => {
  // A hand edit (the validators refuse it), or an id the add route takes (`constructor` on Codex).
  writeSettings({
    utilityModels: { constructor: { title: { model: 'm9' } }, codex: { toString: { model: 'm9' } } },
    modelRoles: { claude: { constructor: { model: 'm9' } } },
    titleModel: 'constructor',
    agentGenModel: { model: '__proto__' },
  });
  const uses = modelUses();
  assert.deepEqual(uses.m9.map((u) => [u.kind, u.engine, u.key, u.label]).sort(), [
    ['helper', 'codex', 'toString', 'toString'], ['helper', 'constructor', 'title', 'title'], ['role', 'claude', 'constructor', 'constructor'],
  ]);
  assert.deepEqual(uses.constructor.map((u) => u.label), ['Titles']);
  assert.ok(Object.hasOwn(uses, '__proto__'), 'an id `__proto__` is an own key');
  assert.deepEqual(uses['__proto__'].map((u) => u.key), ['agentGen']);
  assert.equal(Object.getPrototypeOf(uses), Object.prototype);
  assert.equal(await clearModelUses('m9'), 3);
  assert.equal(await clearModelUses('constructor'), 1);
  assert.deepEqual(readBack(), { agentGenModel: { model: '__proto__' } });
});

test('modelUses / clearModelUses: under node:test without the sandbox opt-in, nothing is read and nothing is written', async () => {
  seed();
  const prevCtx = process.env.NODE_TEST_CONTEXT;
  process.env.NODE_TEST_CONTEXT = prevCtx || 'child-v8';
  delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
  try {
    assert.deepEqual(modelUses(), {});
    await assert.rejects(clearModelUses('m1'), /node:test/);
  } finally {
    process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
    if (prevCtx === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = prevCtx;
  }
  assert.ok(readBack().agentGenModel, 'the refused clear wrote nothing');
});

test('projectModelPicks: step and node picks of every project, minus a project whose legacy customModels carry the id', async () => {
  writeSettings({});
  await addGlobalModel({ id: 'pm-1' });
  const pA = mkdtempSync(join(tmpdir(), 'worca-cc-model-uses-pa-'));
  const pB = mkdtempSync(join(tmpdir(), 'worca-cc-model-uses-pb-'));
  dirs.push(pA, pB);
  await addProject({ name: 'demo', path: pA });
  await setStep(pA, 'implementer', { model: 'pm-1' });
  await setNodeModel(pA, 'wf_x', 's2_0', { model: 'pm-1' });
  getDb().prepare(`
    INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra)
    VALUES (?, '{}', ?, NULL, '{}')
  `).run(projectKey(pB), JSON.stringify([{ id: 'PM-1', label: 'kept' }]));
  await setNodeModel(pB, 'wf_y', 's1_0', { model: 'pm-1' });
  await setStep(pB, 'planner', { model: 'pm-1' });

  const picks = projectModelPicks().filter((p) => p.model.toLowerCase() === 'pm-1');
  assert.deepEqual(picks, [
    { kind: 'project-step', projectKey: projectKey(pA), step: 'implementer', model: 'pm-1' },
    { kind: 'project-node', projectKey: projectKey(pA), workflowId: 'wf_x', nodeId: 's2_0', model: 'pm-1' },
  ]);

  const uses = modelUses()['pm-1'];
  assert.deepEqual(uses.map((u) => [u.kind, u.engine, u.label, u.project]), [
    ['project-step', 'claude', 'Implement', 'demo'],
    ['project-node', 'claude', 'wf_x › s2_0', 'demo'],
  ]);
  assert.deepEqual(modelUses({ projects: false })['pm-1'], undefined, 'projects:false = user level only');

  // A node may name a Codex model: its use is on the model's harness.
  await setNodeModel(pA, 'wf_x', 's3_0', { model: 'gpt-6-luna' });
  assert.deepEqual(modelUses()['gpt-6-luna'].map((u) => [u.kind, u.engine, u.key]), [['project-node', 'codex', 's3_0']]);
});

test('a cliDecides role names no model: it is never listed as a use (#1450)', () => {
  writeSettings({ modelRoles: { claude: { deep: { cliDecides: true }, quick: { model: 'claude-haiku-5-5' } } } });
  const uses = modelUses({ projects: false });
  assert.doesNotMatch(JSON.stringify(uses), /cliDecides|undefined/);
  assert.ok(JSON.stringify(uses).includes('claude-haiku-5-5'));
});
