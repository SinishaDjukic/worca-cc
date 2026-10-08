// test/settings-cascade-write.test.mjs — the project layer's write path (plans/cascading-settings-design.md §3.2, §5):
// sparse values in project_config.extra.settings, Claude step models in project_config.steps, Away mode in
// extra.nightMode, null back to inherit, a bad patch writing nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeProjectSettings, assertProjectSettingsPatch, resolveSetting } from '../src/core/settings-cascade.mjs';
import { readConfig, readRunConfig, readNightModePrefs, setStep, assertSlotModels } from '../src/core/config.mjs';
import { getDb, prepare } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';

useTempHome(after);
const dir = mkdtempSync(join(tmpdir(), 'worca-cascade-write-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const extraOf = () => { getDb(); return JSON.parse(prepare('SELECT extra FROM project_config WHERE project_key = ?').get(projectKey(dir)).extra); };

test('values land sparse in extra.settings; null clears back to inherit and prunes empty blocks', () => {
  writeProjectSettings({ projectDir: dir }, { 'run.engine': 'codex', askMaxTurns: 9, 'memory.defrag.files': 12, 'models.codex.steps.planner': { model: 'gpt-5.5', effort: 'low' } });
  assert.deepEqual(extraOf().settings, { runEngine: 'codex', askMaxTurns: 9, memory: { defrag: { files: 12 } }, stepModels: { codex: { planner: { model: 'gpt-5.5', effort: 'low' } } } });
  assert.equal(resolveSetting('askMaxTurns', { projectDir: dir }).source, 'project');
  writeProjectSettings({ projectDir: dir }, { askMaxTurns: null, 'memory.defrag.files': null, 'models.codex.steps.planner': null });
  assert.deepEqual(extraOf().settings, { runEngine: 'codex' });
  writeProjectSettings({ projectDir: dir }, { 'run.engine': null });
  assert.equal('settings' in extraOf(), false, 'an empty block is removed');
});

test('readRunConfig never forwards the project settings block', async () => {
  writeProjectSettings({ projectDir: dir }, { pipelineCostLimitUsd: 4 });
  assert.equal((await readRunConfig(dir)).settings, undefined);
  writeProjectSettings({ projectDir: dir }, { pipelineCostLimitUsd: null });
});

test('Claude step models write project_config.steps and keep the role\'s other tunables', async () => {
  await setStep(dir, 'planner', { fanOut: true });
  writeProjectSettings({ projectDir: dir }, { 'models.claude.steps.planner': { model: 'claude-opus-5-5', effort: 'max' } });
  assert.deepEqual((await readConfig(dir)).steps.planner, { model: 'claude-opus-5-5', effort: 'max', fanOut: true });
  writeProjectSettings({ projectDir: dir }, { 'models.claude.steps.planner': null });
  assert.deepEqual((await readConfig(dir)).steps.planner, { fanOut: true });
});

test('Away mode fields write extra.nightMode, the same layer PATCH /api/config writes', () => {
  writeProjectSettings({ projectDir: dir }, { 'nightMode.strategy': 'weights', 'nightMode.maxDecisions': 5 });
  assert.deepEqual(readNightModePrefs(projectKey(dir)), { strategy: 'weights', maxDecisions: 5 });
  writeProjectSettings({ projectDir: dir }, { 'nightMode.strategy': null, 'nightMode.maxDecisions': null });
  assert.equal(readNightModePrefs(projectKey(dir)), null);
});

test('strict on write: a bad key or value throws 400 naming it, and nothing is written', () => {
  const before = JSON.stringify(extraOf());
  const bad = (patch, re) => assert.throws(() => writeProjectSettings({ projectDir: dir }, patch), (err) => err.status === 400 && re.test(err.message));
  bad({ bogus: 1 }, /unknown setting "bogus"/);
  bad({ askMaxTurns: 5, pipelineCostLimitUsd: -1 }, /^pipelineCostLimitUsd must be a positive number of USD$/);
  bad({ totalCostLimitUsd: 5 }, /unknown setting "totalCostLimitUsd"/);
  bad({ 'models.codex.workspaceScan': { model: 'gpt-5.5' } }, /models\.codex\.workspaceScan is set per user, not per project/);
  bad({ 'models.codex.steps.planner': { model: 'gpt-5.5', effort: 'max' } }, /models\.codex\.steps\.planner\.effort must be one of minimal \| low \| medium \| high/);
  bad({ 'nightMode.spendCapUsd': 3 }, /spendCapUsd is set per user/);
  bad({ askWeb: { enabled: 'yes', allowedDomains: [] } }, /^askWeb: askWeb\.enabled must be true or false$/);
  assert.throws(() => assertProjectSettingsPatch({ 'models.claude.steps.ghost': { model: 'x' } }, { roles: ['planner'] }), /unknown step "ghost"/);
  assert.equal(JSON.stringify(extraOf()), before);
});

test('assertSlotModels: a slot takes only its engine\'s catalog models and their efforts', async () => {
  await assertSlotModels([{ id: 'models.codex.steps.planner', engine: 'codex', value: { model: 'gpt-5.5', effort: 'low' } }]);
  await assertSlotModels([{ id: 'models.claude.steps.planner', engine: 'claude', value: { effort: 'max' } }]);
  await assert.rejects(() => assertSlotModels([{ id: 'models.codex.steps.planner', engine: 'codex', value: { model: 'claude-opus-5-5' } }]),
    /^Error: models\.codex\.steps\.planner: "claude-opus-5-5" is a Claude model — this slot picks a Codex model$/);
  await assert.rejects(() => assertSlotModels([{ id: 'x', engine: 'claude', value: { model: 'no-such-model' } }]), /x: unknown model "no-such-model"/);
  await assert.rejects(() => assertSlotModels([{ id: 'y', engine: 'claude', value: { model: 'claude-haiku-4-5', effort: 'max' } }]), /y: claude-haiku-4-5 does not offer effort "max"/);
});
