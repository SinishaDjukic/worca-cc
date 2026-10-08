// test/run-engine-default.test.mjs — the run's engine when the request names none (plans/cascading-settings-design.md
// §4.2, D7, §8 test 3): run > project > user > claude; a workspace run has no project layer; resume never re-reads settings.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { resolveRunEngine, writeProjectSettings } from '../src/core/settings-cascade.mjs';
import { assertRunEngineInput } from '../src/core/settings.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

useTempHome(after);
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const home = mkdtempSync(join(tmpdir(), 'worca-engine-default-home-'));
process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
const dir = mkdtempSync(join(tmpdir(), 'worca-engine-default-proj-'));
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
});
const writeUser = (obj) => { mkdirSync(join(home, '.worca-cc'), { recursive: true }); writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify(obj)); };
beforeEach(() => { writeUser({}); writeProjectSettings({ projectDir: dir }, { 'run.engine': null }); });

test('engine order: the run names it > project > user > claude', () => {
  assert.deepEqual(resolveRunEngine({ projectDir: dir }), { engine: 'claude', source: 'default' });
  writeUser({ runEngine: 'codex' });
  assert.deepEqual(resolveRunEngine({ projectDir: dir }), { engine: 'codex', source: 'user' });
  writeProjectSettings({ projectDir: dir }, { 'run.engine': 'claude' });
  assert.deepEqual(resolveRunEngine({ projectDir: dir }), { engine: 'claude', source: 'project' });
  assert.deepEqual(resolveRunEngine({ explicit: ' codex ', projectDir: dir }), { engine: 'codex', source: 'run' });
  assert.deepEqual(resolveRunEngine({ explicit: 'codx', projectDir: dir }), { engine: 'codx', source: 'run' }, 'the harness still names a bad engine');
  assert.deepEqual(resolveRunEngine({ explicit: '', projectDir: dir }), { engine: 'claude', source: 'project' });
});

test('a workspace run ignores the project default (Review Focus 4)', () => {
  writeProjectSettings({ projectDir: dir }, { 'run.engine': 'codex' });
  assert.deepEqual(resolveRunEngine({ projectDir: dir, workspace: true }), { engine: 'claude', source: 'default' });
  assert.deepEqual(resolveRunEngine({}), { engine: 'claude', source: 'default' });
});

test('resume never re-reads settings: the saved engine wins (D7)', () => {
  writeUser({ runEngine: 'codex' });
  writeProjectSettings({ projectDir: dir }, { 'run.engine': 'codex' });
  const claudeRun = createOrchestrator({ projectDir: dir, claude: { mock: true }, resume: { row: null, resumePoint: { version: 2 }, steps: [] } });
  assert.equal(claudeRun.claude.engine, 'claude', 'a point without an engine is a Claude run');
  writeUser({ runEngine: 'claude' });
  writeProjectSettings({ projectDir: dir }, { 'run.engine': 'claude' });
  const codexRun = createOrchestrator({ projectDir: dir, claude: { mock: true }, resume: { row: null, resumePoint: { version: 2, claude: { engine: 'codex' } }, steps: [] } });
  assert.equal(codexRun.claude.engine, 'codex');
});

test('the user setting validates on write', () => {
  assert.equal(assertRunEngineInput('codex'), 'codex');
  assert.equal(assertRunEngineInput('copilot'), 'copilot');
  assert.equal(assertRunEngineInput(null), null);
  assert.equal(assertRunEngineInput(''), null);
  assert.throws(() => assertRunEngineInput('gpt'), /^Error: runEngine must be one of claude \| codex \| copilot \| cursor \| gemini \| qwen$/);
});
