// test/settings-cascade.test.mjs — the cascade resolver (plans/cascading-settings-design.md §4.1, §8 test 1):
// project > user > team default > built-in per key, sparse inherit, an invalid layer skipped with one
// warning, and no project (or a workspace run) skipping the project layer.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { resolveSetting, resolveAll, settingIds, settingEntry, utilityModelFor } from '../src/core/settings-cascade.mjs';
import { writeTeamPolicyPrefs } from '../src/core/config.mjs';
import { getDb, prepare } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';

useTempHome(after);
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const home = mkdtempSync(join(tmpdir(), 'worca-cascade-home-'));
process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
const dir = mkdtempSync(join(tmpdir(), 'worca-cascade-proj-'));
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

/** settings.json as the user (or an older worca) left it — no validation on the way in. */
const writeUser = (obj) => {
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify(obj));
};
/** The project row as a hand edit left it: raw JSON in project_config (replaces extra wholesale). */
const writeProjectRow = ({ steps = {}, extra = {} } = {}) => {
  getDb();
  prepare(`INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra) VALUES (?, ?, '[]', NULL, ?)
    ON CONFLICT(project_key) DO UPDATE SET steps = excluded.steps, extra = excluded.extra`).run(projectKey(dir), JSON.stringify(steps), JSON.stringify(extra));
};
const TEAM_DOC = {
  schema: 1,
  fields: {
    'ask.maxTurns': { kind: 'default', value: 12 },
    'cost.humanRateUsd': { kind: 'default', value: 80 },
    'models.steps': { kind: 'default', value: { planner: { model: 'claude-opus-5-5', effort: 'high' } } },
  },
  workspaceRuns: {},
  catalogs: { guardrailSets: [], models: [] },
};
const withTeam = () => writeTeamPolicyPrefs(projectKey(dir), { present: true, docKnown: true, slug: 'acme/cascade', headSha: 'abc1234', delegateTo: null, doc: TEAM_DOC });
const pick = (r) => ({ value: r.value, source: r.source });

beforeEach(() => { writeUser({}); writeProjectRow({}); });

test('layer order: project > user > team default > built-in, per key', () => {
  assert.deepEqual(pick(resolveSetting('askMaxTurns', { projectDir: dir })), { value: 400, source: 'default' });
  withTeam();
  assert.deepEqual(pick(resolveSetting('askMaxTurns', { projectDir: dir })), { value: 12, source: 'team' });
  writeUser({ askMaxTurns: 30 });
  assert.deepEqual(pick(resolveSetting('askMaxTurns', { projectDir: dir })), { value: 30, source: 'user' });
  writeProjectRow({ extra: { settings: { askMaxTurns: 7 } } });
  withTeam();
  const r = resolveSetting('askMaxTurns', { projectDir: dir });
  assert.deepEqual(pick(r), { value: 7, source: 'project' });
  assert.deepEqual(r.layers, { project: 7, user: 30, team: 12, default: 400 });
  assert.deepEqual(pick(resolveSetting('askMaxTurns', { projectKey: projectKey(dir) })), { value: 7, source: 'project' }, 'by key too (Ask chats carry only the key)');
  assert.deepEqual(pick(resolveSetting('humanRateUsdPerHour', { projectDir: dir })), { value: 80, source: 'team' });
  assert.deepEqual(pick(resolveSetting('pipelineCostLimitUsd', { projectDir: dir })), { value: null, source: 'default' }, 'caps have no team layer: effectiveCap folds them');
});

test('no project, or a workspace run, skips the project layer (Review Focus 4)', () => {
  writeUser({ askMaxTurns: 30, runEngine: 'claude' });
  writeProjectRow({ extra: { settings: { askMaxTurns: 7, runEngine: 'codex' } } });
  withTeam();
  assert.deepEqual(pick(resolveSetting('askMaxTurns')), { value: 30, source: 'user' });
  assert.deepEqual(pick(resolveSetting('askMaxTurns', { projectDir: dir, workspace: true })), { value: 30, source: 'user' });
  assert.deepEqual(pick(resolveSetting('run.engine', { projectDir: dir, workspace: true })), { value: 'claude', source: 'user' });
  assert.deepEqual(pick(resolveSetting('run.engine', dir)), { value: 'codex', source: 'project' }, 'a bare string is a projectDir');
});

test('an invalid layer is skipped once with a warning, never thrown (Review Focus 2)', () => {
  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(String(m));
  try {
    writeUser({ runEngine: 'gpt', pipelineCostLimitUsd: -3, stepModels: { codex: { planner: { model: 'gpt-5.5', effort: 'max' } } },
      utilityModels: { codex: { title: { model: 'claude-opus-5-5' } } } });
    writeProjectRow({ extra: { settings: { runEngine: 'codex', askMaxTurns: 'lots' } } });
    assert.deepEqual(pick(resolveSetting('run.engine', { projectDir: dir })), { value: 'codex', source: 'project' });
    assert.deepEqual(pick(resolveSetting('pipelineCostLimitUsd', { projectDir: dir })), { value: null, source: 'default' });
    assert.deepEqual(pick(resolveSetting('pipelineCostLimitUsd', { projectDir: dir })), { value: null, source: 'default' });
    assert.deepEqual(pick(resolveSetting('askMaxTurns', { projectDir: dir })), { value: 400, source: 'default' });
    assert.deepEqual(pick(resolveSetting('models.codex.steps.planner', { projectDir: dir })), { value: undefined, source: 'default' }, 'max is not a Codex effort');
    assert.deepEqual(pick(resolveSetting('models.codex.utility.title', { projectDir: dir })), { value: undefined, source: 'default' }, 'a known Claude model is invalid in a Codex slot');
    writeProjectRow({ extra: { settings: { runEngine: 'nope' } } });
    writeUser({ runEngine: 'codex' });
    assert.deepEqual(pick(resolveSetting('run.engine', { projectDir: dir })), { value: 'codex', source: 'user' });
  } finally { console.warn = orig; }
  const capWarns = warns.filter((w) => w.includes('pipelineCostLimitUsd'));
  assert.equal(capWarns.length, 1, warns.join('\n'));
  assert.match(capWarns[0], /^\[worca\] ignoring invalid pipelineCostLimitUsd -3 in settings\.json — the next layer applies$/);
  assert.ok(warns.some((w) => /askMaxTurns "lots" in project settings/.test(w)), warns.join('\n'));
});

test('step model slots: Claude project picks live in project_config.steps; Codex has no team layer', () => {
  writeUser({ stepModels: { codex: { planner: { model: 'gpt-5.5', effort: 'low' } } } });
  writeProjectRow({ steps: { planner: { model: 'claude-opus-5-5', effort: 'max', fanOut: true } }, extra: {} });
  withTeam();
  assert.deepEqual(pick(resolveSetting('models.claude.steps.planner', { projectDir: dir })),
    { value: { model: 'claude-opus-5-5', effort: 'max' }, source: 'project' }, 'only model and effort: fanOut is not a model slot');
  assert.deepEqual(resolveSetting('models.claude.steps.planner', { projectDir: dir }).layers.team, { model: 'claude-opus-5-5', effort: 'high' });
  assert.deepEqual(pick(resolveSetting('models.codex.steps.planner', { projectDir: dir })), { value: { model: 'gpt-5.5', effort: 'low' }, source: 'user' });
  assert.equal(resolveSetting('models.codex.steps.planner', { projectDir: dir }).layers.team, undefined, 'team step defaults are Claude only');
  writeProjectRow({ extra: { settings: { stepModels: { codex: { planner: { model: 'gpt-5.5', effort: 'high' } } } } } });
  assert.deepEqual(pick(resolveSetting('models.codex.steps.planner', { projectDir: dir })), { value: { model: 'gpt-5.5', effort: 'high' }, source: 'project' });
});

test('helper slots: Claude reads today\'s keys; Codex reads utilityModels.codex', () => {
  writeUser({
    titleModel: 'claude-haiku-4-5', autoWorkflowModel: 'claude-sonnet-5', prDescriptionModel: 'claude-opus-5-5',
    memory: { defrag: { model: 'claude-sonnet-5', effort: 'high' } },
    utilityModels: { codex: { title: { model: 'gpt-5.5' }, workspaceScan: { model: 'gpt-5.5', effort: 'low' } } },
  });
  const v = (id) => resolveSetting(id, { projectDir: dir }).value;
  assert.deepEqual(v('models.claude.utility.title'), { model: 'claude-haiku-4-5' });
  assert.deepEqual(v('models.claude.utility.classifier'), { model: 'claude-sonnet-5' });
  assert.deepEqual(v('models.claude.utility.prDescription'), { model: 'claude-opus-5-5' });
  assert.deepEqual(v('models.claude.memoryDefrag'), { model: 'claude-sonnet-5', effort: 'high' });
  assert.equal(v('models.claude.utility.overview'), undefined, 'a Claude overview has no setting today');
  assert.deepEqual(v('models.codex.utility.title'), { model: 'gpt-5.5' });
  assert.deepEqual(v('models.codex.workspaceScan'), { model: 'gpt-5.5', effort: 'low' });
  writeProjectRow({ extra: { settings: { utilityModels: { codex: { workspaceScan: { model: 'gpt-5.5', effort: 'high' } } } } } });
  assert.equal(resolveSetting('models.codex.workspaceScan', { projectDir: dir }).source, 'user', 'workspace scans are user-only: workspace runs have no project');
});

test('the registry: curated keys only, user-only keys refused, unknown ids throw', () => {
  const ids = settingIds({ roles: ['planner'] });
  for (const id of ['run.engine', 'pipelineCostLimitUsd', 'humanRateUsdPerHour', 'askMaxTurns', 'askMaxBudgetUsd', 'askWeb',
    'contextMaxBytesPerFile', 'contextMaxBytesTotal', 'skillMount', 'memory.softBytesPerFile', 'memory.defrag.bytesPct',
    'nightMode.strategy', 'models.claude.steps.planner', 'models.codex.steps.planner', 'models.claude.utility.title',
    'models.codex.utility.prDescription', 'models.claude.memoryDefrag', 'models.codex.memoryDefrag', 'models.codex.workspaceScan']) {
    assert.ok(ids.includes(id), id);
  }
  for (const id of ['totalCostLimitUsd', 'costLimitResetPeriod', 'theme', 'models.claude.workspaceScan']) {
    assert.ok(!ids.includes(id), id);
    assert.equal(settingEntry(id), null, id);
  }
  // Plan 2b (D17): Ask Worca's engine and model slots resolve by id, user-only, and are never listed.
  for (const id of ['askEngine', 'models.claude.ask', 'models.codex.ask']) {
    assert.ok(!ids.includes(id), id);
    assert.equal(settingEntry(id).userOnly, true, id);
  }
  assert.equal(settingEntry('models.codex.workspaceScan').userOnly, true);
  assert.equal(settingEntry('models.claude.steps.planner').store, 'steps');
  assert.equal(settingEntry('models.codex.steps.planner').store, 'settings');
  assert.equal(settingEntry('nightMode.window').store, 'nightMode');
  assert.throws(() => resolveSetting('nope'), /unknown setting "nope"/);
  const all = resolveAll({ projectDir: dir }, { roles: ['planner'] });
  assert.deepEqual(Object.keys(all).sort(), [...ids].sort());
  assert.deepEqual(pick(all['skillMount']), { value: 'copy', source: 'default' });
});

test('a workspace run skips only the project layer: the team default still applies, as it did before (review I1)', () => {
  writeProjectRow({ steps: { planner: { model: 'claude-sonnet-5', effort: 'medium' } }, extra: { settings: { askMaxTurns: 7 } } });
  withTeam();
  const ws = { projectDir: dir, workspace: true };
  assert.deepEqual(pick(resolveSetting('models.claude.steps.planner', ws)), { value: { model: 'claude-opus-5-5', effort: 'high' }, source: 'team' }, 'the project pick is skipped, the team default is not');
  assert.deepEqual(pick(resolveSetting('askMaxTurns', ws)), { value: 12, source: 'team' });
  assert.equal(resolveSetting('askMaxTurns', ws).layers.project, undefined);
});

test('Cursor: step slots only, and no helper slot borrowed from Claude', () => {
  const ids = settingIds({ roles: ['plan'] });
  assert.deepEqual(ids.filter((id) => id.startsWith('models.cursor.')), ['models.cursor.steps.plan']);
  writeUser({ titleModel: 'claude-haiku-4-5', utilityModels: { claude: { title: { model: 'claude-haiku-4-5' }, workspaceScan: { model: 'claude-haiku-4-5' } } } });
  assert.deepEqual(utilityModelFor('cursor', 'workspaceScan'), { model: null, effort: null, source: 'default' });
  assert.deepEqual(utilityModelFor('cursor', 'title'), { model: null, effort: null, source: 'default' });
  writeUser({});
});
