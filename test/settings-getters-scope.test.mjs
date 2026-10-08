// test/settings-getters-scope.test.mjs — getters take a project scope (plans/cascading-settings-design.md §4.4,
// §8 test 2): the same answer as before without one, the project's override with one, none for a workspace run.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  pipelineCostLimitUsd, humanRateUsdPerHour, askMaxTurns, askMaxBudgetUsd, askWeb, memoryCaps,
  contextMaxBytesPerFile, contextMaxBytesTotal, skillMount,
} from '../src/core/settings.mjs';
import { writeProjectSettings, hasProjectSetting } from '../src/core/settings-cascade.mjs';
import { effectiveHumanRateUsd } from '../src/core/human-rate.mjs';
import { askLimits } from '../src/core/ask/limits.mjs';
import { askWebAccess } from '../src/core/ask/web-access.mjs';
import { budgetStatus } from '../src/core/cost-budget.mjs';
import { localSnapshot } from '../src/core/policy/local.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { projectKey } from '../src/core/store.mjs';
import { getDb, prepare } from '../src/core/db.mjs';

useTempHome(after);
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const home = mkdtempSync(join(tmpdir(), 'worca-getters-home-'));
process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
const dir = mkdtempSync(join(tmpdir(), 'worca-getters-proj-'));
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});
const writeUser = (obj) => {
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify(obj));
};

beforeEach(() => {
  writeUser({
    pipelineCostLimitUsd: 5, askMaxTurns: 30, askMaxBudgetUsd: 2, contextMaxBytesTotal: 1000, skillMount: 'symlink',
    memory: { softBytesPerFile: 100, defrag: { files: 40 } }, askWeb: { enabled: true, allowedDomains: ['a.com'] },
  });
  getDb();
  prepare('DELETE FROM project_config WHERE project_key = ?').run(projectKey(dir));
  writeProjectSettings({ projectDir: dir }, {
    pipelineCostLimitUsd: 2, humanRateUsdPerHour: 99, askMaxTurns: 9, askMaxBudgetUsd: 0.5, contextMaxBytesTotal: 500,
    skillMount: 'copy', 'memory.softBytesPerFile': 50, 'memory.defrag.files': 12, askWeb: { enabled: false, allowedDomains: [] },
  });
});

test('without a scope every getter answers as before (§8 test 2 regression)', () => {
  assert.equal(pipelineCostLimitUsd(), 5);
  assert.equal(humanRateUsdPerHour(), null);
  assert.equal(askMaxTurns(), 30);
  assert.equal(askMaxBudgetUsd(), 2);
  assert.equal(contextMaxBytesPerFile(), 20480);
  assert.equal(contextMaxBytesTotal(), 1000);
  assert.equal(skillMount(), 'symlink');
  assert.equal(memoryCaps().softBytesPerFile, 100);
  assert.equal(memoryCaps().defrag.files, 40);
  assert.equal(askWeb().enabled, true);
  assert.equal(effectiveHumanRateUsd(), 35);
  assert.equal(budgetStatus().pipelineLimitUsd, 5);
});

test('with a project the project override applies; a workspace scope ignores it', () => {
  const key = projectKey(dir);
  assert.equal(pipelineCostLimitUsd(dir), 2);
  assert.equal(pipelineCostLimitUsd({ projectDir: dir, workspace: true }), 5);
  assert.equal(humanRateUsdPerHour(dir), 99);
  assert.equal(askMaxTurns({ projectKey: key }), 9);
  assert.equal(askMaxBudgetUsd(dir), 0.5);
  assert.equal(contextMaxBytesTotal(dir), 500);
  assert.equal(contextMaxBytesPerFile(dir), 20480, 'no override: the user/default value');
  assert.equal(skillMount(dir), 'copy');
  assert.deepEqual([memoryCaps(dir).softBytesPerFile, memoryCaps(dir).defrag.files, memoryCaps(dir).hardBytesPerFile], [50, 12, 32768]);
  assert.equal(askWeb(dir).enabled, false);
  assert.equal(effectiveHumanRateUsd(dir), 99);
  assert.deepEqual(askLimits({ projectKey: key }), { maxTurns: 9, maxBudgetUsd: 0.5 });
  assert.deepEqual(askLimits(), { maxTurns: 30, maxBudgetUsd: 2 });
  assert.equal(askWebAccess({ projectKey: key }).enabled, false, 'the project switched web access off');
  assert.equal(askWebAccess({}).enabled, true);
  assert.equal(budgetStatus(new Date(), { scope: dir }).pipelineLimitUsd, 2);
  assert.equal(hasProjectSetting('askMaxTurns', dir), true);
  assert.equal(hasProjectSetting('contextMaxBytesPerFile', dir), false);
  const snap = localSnapshot(dir);
  assert.deepEqual(snap['ask.maxTurns'], { value: 9, set: true });
  assert.deepEqual(snap['cost.pipelineLimitUsd'], { value: 2, set: true });
  assert.deepEqual(snap['cost.humanRateUsd'], { value: 99, set: true });
});

test('a run knows its scope and carries the project cap only when the project sets one', () => {
  const o = createOrchestrator({ projectDir: dir, claude: { mock: true } });
  assert.equal(o._settingsScope(), dir);
  assert.equal(o._projectPipelineCap(), 2);
  writeProjectSettings({ projectDir: dir }, { pipelineCostLimitUsd: null });
  assert.equal(o._projectPipelineCap(), undefined, 'the user cap is the budget snapshot\'s, not a project fact');
});
