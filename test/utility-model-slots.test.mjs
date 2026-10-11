// test/utility-model-slots.test.mjs — helper jobs read the slot of the RUN's engine (plans/cascading-settings-design.md
// §4.3, §8 test 7): Codex uses models.codex.utility.<job>; Claude keeps today's keys and takes only a project override;
// a changed default never reaches an older run.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { writeProjectSettings, utilityModelFor, scopeForRunKey } from '../src/core/settings-cascade.mjs';
import { generateOverview } from '../src/core/overview-agent.mjs';
import { generatePrDescription } from '../src/core/pr-description.mjs';
import { resolveAutoModel } from '../src/core/auto/model.mjs';
import { generateTitle } from '../src/core/title.mjs';
import { mockSpawnLog } from '../src/core/claude-runner.mjs';
import { listModels } from '../src/core/config.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

const whome = useTempHome(after);
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK, TITLE: process.env.WORCA_TITLE_MODEL };
const home = mkdtempSync(join(tmpdir(), 'worca-util-home-'));
process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
delete process.env.WORCA_TITLE_MODEL;
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW], ['WORCA_TITLE_MODEL', prev.TITLE]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true });
});
const writeUser = (obj) => { mkdirSync(join(home, '.worca-cc'), { recursive: true }); writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify(obj)); };
const spy = (seen, text = '{"narrative":"x","diffFindings":[],"diffCheckTruncated":false}') => async (o) => { seen.push(o); return { text }; };
beforeEach(() => writeUser({}));

test('overview: a Codex run uses Codex\'s overview slot, read-only; a later default change does not reach it', async () => {
  const { id, dir, key } = await seedPipeline(join(whome, 'p-ov-cx'), { engine: 2, runEngine: 'codex', status: 'done' });
  mkdirSync(dir, { recursive: true });
  writeUser({ runEngine: 'claude', utilityModels: { codex: { overview: { model: 'gpt-5.5', effort: 'low' } } } });
  const seen = [];
  await generateOverview(key, id, { force: true, runClaudeImpl: spy(seen) });
  assert.equal(seen[0].model, 'gpt-5.5');
  assert.equal(seen[0].effort, 'low');
  assert.equal(seen[0].engine, 'codex');
  assert.equal(seen[0].sandbox, 'read-only');
});

test('overview: a Claude run is unchanged unless the project overrides its slot', async () => {
  const projectDir = join(whome, 'p-ov-cl');
  const { id, dir, key } = await seedPipeline(projectDir, { engine: 2, status: 'done' });
  mkdirSync(dir, { recursive: true });
  const seen = [];
  await generateOverview(key, id, { force: true, runClaudeImpl: spy(seen) });
  assert.equal(seen[0].model, undefined, 'today: the CLI default');
  assert.equal('engine' in seen[0], false, 'a Claude spawn carries no engine option');
  writeProjectSettings({ projectKey: key }, { 'models.claude.utility.overview': { model: 'claude-haiku-4-5' } });
  await generateOverview(key, id, { force: true, runClaudeImpl: spy(seen) });
  assert.equal(seen[1].model, 'claude-haiku-4-5');
});


test('PR description: Codex takes its slot; Claude takes a project override in place of the Settings pick', async () => {
  const cx = await seedPipeline(join(whome, 'p-pr-cx'), { engine: 2, runEngine: 'codex', status: 'done', title: 't' });
  writeUser({ utilityModels: { codex: { prDescription: { model: 'gpt-5.5' } } }, prDescriptionModel: 'claude-sonnet-5' });
  const seen = [];
  await generatePrDescription(cx.key, cx.id, { runClaudeImpl: spy(seen, '## Summary\nx') });
  assert.equal(seen[0].model, 'gpt-5.5');
  assert.equal(seen[0].engine, 'codex');
  const cl = await seedPipeline(join(whome, 'p-pr-cl'), { engine: 2, status: 'done', title: 't' });
  await generatePrDescription(cl.key, cl.id, { runClaudeImpl: spy(seen, '## Summary\nx') });
  assert.equal(seen[1].model, 'claude-sonnet-5', 'your Settings pick, as today');
  writeProjectSettings({ projectKey: cl.key }, { 'models.claude.utility.prDescription': { model: 'claude-opus-5-5' } });
  await generatePrDescription(cl.key, cl.id, { runClaudeImpl: spy(seen, '## Summary\nx') });
  assert.equal(seen[2].model, 'claude-opus-5-5');
});

test('overview and PR description of a Cursor run run on Claude, with Claude\'s slot', async () => {
  const ov = await seedPipeline(join(whome, 'p-ov-cu'), { engine: 2, runEngine: 'cursor', status: 'done' });
  mkdirSync(ov.dir, { recursive: true });
  writeUser({ prDescriptionModel: 'claude-sonnet-5' });
  const seen = [];
  await generateOverview(ov.key, ov.id, { force: true, runClaudeImpl: spy(seen) });
  assert.equal('engine' in seen[0], false, 'no engine: Claude');
  assert.equal('sandbox' in seen[0], false);
  const pr = await seedPipeline(join(whome, 'p-pr-cu'), { engine: 2, runEngine: 'cursor', status: 'done', title: 't' });
  await generatePrDescription(pr.key, pr.id, { runClaudeImpl: spy(seen, '## Summary\nx') });
  assert.equal('engine' in seen[1], false, 'no engine: Claude');
  assert.equal(seen[1].model, 'claude-sonnet-5', 'Claude\'s Settings pick');
});

test('classifier: off Claude the slot names a catalog model of the run engine, else no -m', async () => {
  const models = await listModels('');
  assert.equal(resolveAutoModel(models, { engine: 'codex', setting: 'gpt-5.5' }), 'gpt-5.5');
  assert.equal(resolveAutoModel(models, { engine: 'codex', setting: '' }), '');
  assert.equal(resolveAutoModel(models, { engine: 'codex', setting: 'claude-sonnet-5' }), '', 'never a Claude id on Codex');
  assert.equal(resolveAutoModel(models, { engine: 'codex' }), '', 'the Claude Settings pick is not Codex\'s');
});

test('title: Codex takes its slot; a Claude project override replaces the Settings pick; Claude without one is unchanged', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'worca-util-title-'));
  mockSpawnLog.length = 0;
  await generateTitle('Fix the login bug', { cwd, mock: true, engine: 'codex', model: 'gpt-5.5', effort: 'low' });
  assert.deepEqual(mockSpawnLog.at(-1), { engine: 'codex', sandbox: 'read-only', model: 'gpt-5.5' });
  await generateTitle('Fix the login bug', { cwd, mock: true, storedTitle: 'claude-sonnet-5' });
  assert.equal(mockSpawnLog.at(-1).model, 'claude-sonnet-5');
  await generateTitle('Fix the login bug', { cwd, mock: true });
  assert.equal(mockSpawnLog.at(-1).model, 'claude-haiku-4-5', 'no setting, no run model: the built-in title model');
  rmSync(cwd, { recursive: true, force: true });

  const projectDir = mkdtempSync(join(tmpdir(), 'worca-util-run-'));
  writeUser({ utilityModels: { codex: { title: { model: 'gpt-5.5', effort: 'low' }, memoryDefrag: { model: 'gpt-5.5', effort: 'medium' }, workspaceScan: { model: 'gpt-5.6-luna' } } } });
  const codexRun = createOrchestrator({ projectDir, claude: { mock: true, engine: 'codex' } });
  assert.equal(codexRun._titleGenOpts().model, 'gpt-5.5');
  assert.equal(codexRun._titleGenOpts().effort, 'low');
  const claudeRun = createOrchestrator({ projectDir, claude: { mock: true } });
  assert.equal('storedTitle' in claudeRun._titleGenOpts(), false, 'byte-identical without a project override');
  writeProjectSettings({ projectDir }, { 'models.claude.utility.title': { model: 'claude-haiku-4-5' } });
  assert.equal(claudeRun._titleGenOpts().storedTitle, 'claude-haiku-4-5');
  rmSync(projectDir, { recursive: true, force: true });
});

test('memory defragment and workspace scan follow their own run\'s engine', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'worca-util-defrag-'));
  writeUser({ utilityModels: { codex: { memoryDefrag: { model: 'gpt-5.5', effort: 'medium' }, workspaceScan: { model: 'gpt-5.6-luna' } } }, memory: { defrag: { model: 'claude-sonnet-5', effort: 'high' } } });
  const codexDefrag = createOrchestrator({ projectDir, workflowId: 'wf_memory_defrag', memoryScope: 'project', claude: { mock: true, engine: 'codex' } });
  assert.deepEqual((await codexDefrag._defragAgentPair()).pair, { model: 'gpt-5.5', effort: 'medium' });
  const claudeDefrag = createOrchestrator({ projectDir, workflowId: 'wf_memory_defrag', memoryScope: 'project', claude: { mock: true } });
  assert.deepEqual((await claudeDefrag._defragAgentPair()).pair, { model: 'claude-sonnet-5', effort: 'high' }, 'Settings › Memory, as today');
  const scan = createOrchestrator({ projectDir, claude: { mock: true, engine: 'codex' } });
  scan._isWorkspaceScan = () => true;
  scan.opts.scanModels = { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' };
  assert.deepEqual(scan._scanModelPins(), { agentPair: { model: 'gpt-5.6-luna', effort: null }, subagentPin: null });
  assert.deepEqual(utilityModelFor('codex', 'workspaceScan', scopeForRunKey('workspaces/wks-x-deadbeef')), { model: 'gpt-5.6-luna', effort: null, source: 'user' });
  rmSync(projectDir, { recursive: true, force: true });
});
