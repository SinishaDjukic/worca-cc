// test/claude-harness-guards.test.mjs — the Claude-harness fixes the live suite (test/live) found
// after the multi-harness merge: another engine's model never reaches a Claude run or a Claude
// chat's workflow card, and a gateway's 403 reads as an auth failure with its own text.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { foreignRunModel, engineOfModel } from '../src/core/config.mjs';
import { modelsOfEngine } from '../src/core/ask/workflow-deps.mjs';
import { classifyError } from '../src/core/recoverable-error.mjs';
import { isBenignStderrLine } from '../src/core/engines/claude.mjs';

const dirs = [];
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), 'worca-harness-guards-'));
  dirs.push(home);
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

test('foreignRunModel: a Codex built-in on a Claude run is refused with a way out; Claude and unowned ids pass', () => {
  assert.equal(engineOfModel('gpt-5.5'), 'codex');
  const why = foreignRunModel('gpt-5.5', 'claude');
  assert.match(why, /"gpt-5\.5" runs on codex, not on claude/);
  assert.match(why, /--engine codex/);
  for (const id of ['claude-haiku-4-5', 'opus', 'sonnet', 'claude-opus-4-8[1m]', 'us.anthropic.claude-sonnet-x', '', null, undefined]) {
    assert.equal(foreignRunModel(id, 'claude'), null, String(id));
  }
  assert.equal(foreignRunModel('gpt-5.5', 'codex'), null, 'its own engine');
});

test('modelsOfEngine: a Claude chat (engine null) sees only Claude rows; a row without engine is Claude', () => {
  const rows = [{ id: 'claude-haiku-4-5', engine: 'claude' }, { id: 'legacy' }, { id: 'gpt-5.5', engine: 'codex' }, null];
  assert.deepEqual(modelsOfEngine(rows, null).map((m) => m.id), ['claude-haiku-4-5', 'legacy']);
  assert.deepEqual(modelsOfEngine(rows, 'claude').map((m) => m.id), ['claude-haiku-4-5', 'legacy']);
  assert.deepEqual(modelsOfEngine(rows, 'codex').map((m) => m.id), ['gpt-5.5']);
  assert.deepEqual(modelsOfEngine(undefined, null), []);
});

test("a gateway's 403 (\"Failed to authenticate. API Error: 403 …\") classifies as auth", () => {
  assert.equal(classifyError(new Error('Failed to authenticate. API Error: 403 my gateway: credential refused')), 'auth');
  assert.equal(classifyError(new Error('the model returned an empty reply')), null);
});

test('the claude.ai connectors notice is benign stderr (it fires on every custom-endpoint spawn)', () => {
  assert.equal(isBenignStderrLine("⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors"), true);
  assert.equal(isBenignStderrLine('Error: something real'), false);
});
