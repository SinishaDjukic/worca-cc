// test/cost-settings.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  pipelineCostLimitUsd, totalCostLimitUsd, costLimitResetPeriod,
  setPipelineCostLimitUsd, setTotalCostLimitUsd, setCostLimitResetPeriod,
  COST_RESET_PERIODS, DEFAULT_COST_RESET_PERIOD, settingsFile,
} from '../src/core/settings.mjs';

// settings sandbox: settingsFile() resolves under HOME, not WORCA_HOME.
// WORCA_HOME (set by useTempHome / npm test) is deliberately left untouched
// so the DB stays pinned to the temp home for the whole suite.
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cost-'));
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

test('unset limits read as null; period defaults to monthly', () => {
  assert.equal(pipelineCostLimitUsd(), null);
  assert.equal(totalCostLimitUsd(), null);
  assert.equal(costLimitResetPeriod(), 'monthly');
  assert.equal(DEFAULT_COST_RESET_PERIOD, 'monthly');
  assert.deepEqual(COST_RESET_PERIODS, ['weekly', 'monthly']);
});

test('set/read roundtrip: fractional USD allowed; period enum', async () => {
  assert.deepEqual(await setPipelineCostLimitUsd(2.5), { pipelineCostLimitUsd: 2.5 });
  assert.deepEqual(await setTotalCostLimitUsd(100), { totalCostLimitUsd: 100 });
  assert.deepEqual(await setCostLimitResetPeriod('weekly'), { costLimitResetPeriod: 'weekly' });
  assert.equal(pipelineCostLimitUsd(), 2.5);
  assert.equal(totalCostLimitUsd(), 100);
  assert.equal(costLimitResetPeriod(), 'weekly');
});

test('setters throw on invalid input; readers never throw', async () => {
  await assert.rejects(() => setPipelineCostLimitUsd(0), /positive number/);
  await assert.rejects(() => setPipelineCostLimitUsd(-1), /positive number/);
  await assert.rejects(() => setPipelineCostLimitUsd('5'), /positive number/);
  await assert.rejects(() => setPipelineCostLimitUsd(NaN), /positive number/);
  await assert.rejects(() => setCostLimitResetPeriod('daily'), /weekly \| monthly/);
});

test('empty input clears the key (back to unlimited / default)', async () => {
  await setTotalCostLimitUsd(9);
  assert.deepEqual(await setTotalCostLimitUsd(''), { totalCostLimitUsd: null });
  assert.equal(totalCostLimitUsd(), null);
  await setCostLimitResetPeriod('weekly');
  await setCostLimitResetPeriod('');
  assert.equal(costLimitResetPeriod(), 'monthly');
});

test('corrupt stored values fall back loudly (null / default), never throw', () => {
  const file = settingsFile();
  mkdirSync(dirname(file), { recursive: true });   // .worca-cc/ absent in a fresh sandbox
  writeFileSync(file, JSON.stringify({
    pipelineCostLimitUsd: 'ten', totalCostLimitUsd: -4, costLimitResetPeriod: 'biweekly',
  }));
  assert.equal(pipelineCostLimitUsd(), null);
  assert.equal(totalCostLimitUsd(), null);
  assert.equal(costLimitResetPeriod(), 'monthly');
});

test('unknown keys survive a setter write (read-modify-write)', async () => {
  const file = settingsFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ someFutureKey: 42 }));
  await setTotalCostLimitUsd(7);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(raw.someFutureKey, 42);
  assert.equal(raw.totalCostLimitUsd, 7);
});
