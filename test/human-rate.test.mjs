// The developer rate (money-saved design §8): setting → team-policy default → 35.
// settings.json lives under HOME (settings.mjs:66-68), so HOME is sandboxed and the modules are
// imported AFTER the env is set — the pattern of test/team-metrics-api.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let sandboxHome; const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-rate-'));
  for (const k of ['HOME', 'USERPROFILE']) { prevEnv[k] = process.env[k]; process.env[k] = sandboxHome; }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

test('unset → null stored, 35 effective; set → stored wins; clear → back to 35', async () => {
  const s = await import('../src/core/settings.mjs');
  const { effectiveHumanRateUsd } = await import('../src/core/human-rate.mjs');
  assert.equal(s.humanRateUsdPerHour(), null);
  assert.equal(effectiveHumanRateUsd(), 35);
  assert.deepEqual(await s.setHumanRateUsdPerHour(120), { humanRateUsdPerHour: 120 });
  assert.equal(effectiveHumanRateUsd(), 120);
  await s.setHumanRateUsdPerHour('');
  assert.equal(s.humanRateUsdPerHour(), null);
  assert.equal(effectiveHumanRateUsd(), 35);
});

test('invalid inputs throw and persist nothing', async () => {
  const s = await import('../src/core/settings.mjs');
  for (const bad of [0, -5, 'abc', NaN, Infinity, {}]) await assert.rejects(() => s.setHumanRateUsdPerHour(bad), /humanRateUsdPerHour/);
  assert.equal(s.humanRateUsdPerHour(), null);
});

test('humanEstimateOverrides returns the stored object or {}', async () => {
  const s = await import('../src/core/settings.mjs');
  assert.deepEqual(s.humanEstimateOverrides(), {});
});
