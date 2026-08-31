// test/ask-limits.test.mjs
// P1/T5: Ask Worca per-turn limits in settings.json (ask-worca-design.md §6.9, D12)
// and the frozen limits table. Settings sandbox: settingsFile() lives under HOME,
// not WORCA_HOME (same pattern as test/cost-settings.test.mjs).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  askMaxTurns, askMaxBudgetUsd, setAskMaxTurns, setAskMaxBudgetUsd, assertAskLimitInputs,
  DEFAULT_ASK_MAX_TURNS, DEFAULT_ASK_MAX_BUDGET_USD, settingsFile, readSettings,
} from '../src/core/settings.mjs';
import { ASK_LIMITS, askLimits } from '../src/core/ask/limits.mjs';

let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-ask-limits-'));
  for (const k of ['HOME', 'USERPROFILE']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true });
});
beforeEach(async () => {
  await mkdir(join(sandboxHome, '.worca-cc'), { recursive: true });
  await writeFile(settingsFile(), '{}\n', 'utf8');
});

test('defaults: 40 turns, $2 cap', () => {
  assert.equal(DEFAULT_ASK_MAX_TURNS, 40);
  assert.equal(DEFAULT_ASK_MAX_BUDGET_USD, 2);
  assert.equal(askMaxTurns(), 40);
  assert.equal(askMaxBudgetUsd(), 2);
});

test('set/read roundtrip; null stores "no cap"; "" clears to the default', async () => {
  assert.deepEqual(await setAskMaxTurns(120), { askMaxTurns: 120 });
  assert.equal(askMaxTurns(), 120);
  assert.deepEqual(await setAskMaxBudgetUsd(0.5), { askMaxBudgetUsd: 0.5 });
  assert.equal(askMaxBudgetUsd(), 0.5);
  assert.deepEqual(await setAskMaxBudgetUsd(null), { askMaxBudgetUsd: null });
  assert.equal(askMaxBudgetUsd(), null, 'null = no cap');
  assert.equal(readSettings().askMaxBudgetUsd, null, 'the literal null is persisted');
  await setAskMaxBudgetUsd('');
  assert.equal(askMaxBudgetUsd(), 2, '"" clears to the default');
  assert.ok(!('askMaxBudgetUsd' in readSettings()), 'cleared key is removed');
  await setAskMaxTurns('');
  assert.equal(askMaxTurns(), 40);
  await setAskMaxTurns(5);
  await setAskMaxTurns(null);
  assert.equal(askMaxTurns(), 40, 'null clears askMaxTurns (it has no "no cap" meaning)');
});

test('validation: ranges, integers, strings rejected, exact messages', async () => {
  for (const bad of [0, 501, 2.5, '40', -1, NaN, true, {}]) {
    await assert.rejects(() => setAskMaxTurns(bad), { message: 'askMaxTurns must be an integer between 1 and 500' });
  }
  for (const bad of [0, 0.05, 101, '2', -1, NaN, true, {}]) {
    await assert.rejects(() => setAskMaxBudgetUsd(bad), { message: 'askMaxBudgetUsd must be null (no cap) or a number between 0.1 and 100' });
  }
  await setAskMaxTurns(1); await setAskMaxTurns(500);
  await setAskMaxBudgetUsd(0.1); await setAskMaxBudgetUsd(100);
  assert.equal(askMaxBudgetUsd(), 100);
});

test('assertAskLimitInputs validates only the keys present, as a set, and throws the first error', () => {
  assert.doesNotThrow(() => assertAskLimitInputs({}));
  assert.doesNotThrow(() => assertAskLimitInputs({ askMaxTurns: 10, askMaxBudgetUsd: null }));
  assert.doesNotThrow(() => assertAskLimitInputs({ askMaxTurns: '', askMaxBudgetUsd: '' }));
  assert.throws(() => assertAskLimitInputs({ askMaxTurns: 0 }), /askMaxTurns must be an integer/);
  assert.throws(() => assertAskLimitInputs({ askMaxTurns: 10, askMaxBudgetUsd: 1000 }), /askMaxBudgetUsd must be null/);
  assert.doesNotThrow(() => assertAskLimitInputs({ pipelineCostLimitUsd: -1 }), 'foreign keys are not its business');
});

test('invalid persisted values fall back loudly to the defaults', async () => {
  await writeFile(settingsFile(), JSON.stringify({ askMaxTurns: 'lots', askMaxBudgetUsd: -3 }), 'utf8');
  const warnings = [];
  const orig = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    assert.equal(askMaxTurns(), 40);
    assert.equal(askMaxBudgetUsd(), 2);
  } finally { console.warn = orig; }
  assert.equal(warnings.filter((w) => /askMaxTurns|askMaxBudgetUsd/.test(w)).length, 2);
});

test('ASK_LIMITS is frozen and carries the spec figures', () => {
  assert.ok(Object.isFrozen(ASK_LIMITS) && Object.isFrozen(ASK_LIMITS.attachment));
  assert.equal(ASK_LIMITS.turnsPerThread, 1);
  assert.equal(ASK_LIMITS.turnsGlobal, 3);
  assert.equal(ASK_LIMITS.turnTimeoutMs, 30 * 60 * 1000);
  assert.equal(ASK_LIMITS.jobGraceMs, 30_000);
  assert.equal(ASK_LIMITS.emptyThreadSweepMs, 24 * 60 * 60 * 1000);
  assert.deepEqual(ASK_LIMITS.attachment, {
    maxFiles: 8, maxBytesPerFile: 512 * 1024, maxBytesPerThread: 4 * 1024 * 1024,
    extensions: ['.md', '.markdown', '.txt', '.json', '.csv', '.log'],
  });
  assert.equal(ASK_LIMITS.contextHeaderMaxChars, 1024);
  assert.equal(ASK_LIMITS.inlineAttachmentsMaxBytes, 24 * 1024);
  assert.equal(ASK_LIMITS.restoredMaxChars, 30_000);
  assert.equal(ASK_LIMITS.blockIoMaxChars, 2048);
  assert.equal(ASK_LIMITS.agentLogMaxLines, 50);
  assert.equal(ASK_LIMITS.listRunsMaxLimit, 100);
  assert.equal(ASK_LIMITS.diffMaxBytes, 200_000);
  assert.equal(ASK_LIMITS.briefMaxChars, 8000);
  assert.equal(ASK_LIMITS.defaultModel, 'claude-opus-5');
  assert.equal(ASK_LIMITS.defaultEffort, 'high');
});

test('askLimits() reads the settings fresh on every call (D12) and accepts injected readers', async () => {
  assert.deepEqual(askLimits(), { maxTurns: 40, maxBudgetUsd: 2 });
  await setAskMaxTurns(3);
  await setAskMaxBudgetUsd(null);
  assert.deepEqual(askLimits(), { maxTurns: 3, maxBudgetUsd: null }, 'no caching');
  assert.deepEqual(askLimits({ readMaxTurns: () => 9, readMaxBudgetUsd: () => 0.25 }), { maxTurns: 9, maxBudgetUsd: 0.25 });
});
