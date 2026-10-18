import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_NETWORK_WAIT, networkWaitSettings, setNetworkWait, assertNetworkWaitInput, effectiveNetworkWait,
} from '../src/core/settings.mjs';

let home; const prev = {};
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-netwait-'));
  for (const k of ['HOME', 'USERPROFILE']) { prev[k] = process.env[k]; process.env[k] = home; }
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true });
});

test('networkWait: on by default with a 4 h cap; a partial patch stores only its keys; null resets', async () => {
  assert.deepEqual(networkWaitSettings(), { enabled: true, maxWaitMin: 240 });
  assert.deepEqual(DEFAULT_NETWORK_WAIT, { enabled: true, maxWaitMin: 240 });
  assert.deepEqual(await setNetworkWait({ maxWaitMin: 60 }), { enabled: true, maxWaitMin: 60 });
  assert.deepEqual(await setNetworkWait({ enabled: false }), { enabled: false, maxWaitMin: 60 });
  assert.deepEqual(await setNetworkWait(null), { enabled: true, maxWaitMin: 240 });
});

test('networkWait: bad input is refused with a field-shaped message', () => {
  assert.throws(() => assertNetworkWaitInput({ enabled: 'yes' }), /networkWait\.enabled must be true or false/);
  assert.throws(() => assertNetworkWaitInput({ maxWaitMin: 0 }), /networkWait\.maxWaitMin must be a whole number of minutes from 1 to 1440/);
  assert.throws(() => assertNetworkWaitInput({ maxWaitMin: 2.5 }), /networkWait\.maxWaitMin/);
  assert.throws(() => assertNetworkWaitInput({ other: 1 }), /unknown networkWait setting: other/);
  assert.doesNotThrow(() => assertNetworkWaitInput(null));
});

test('effectiveNetworkWait: a non-empty env pin wins over the stored value', async () => {
  await setNetworkWait({ enabled: true, maxWaitMin: 30 });
  assert.deepEqual(effectiveNetworkWait({}), { enabled: true, maxWaitMs: 30 * 60_000 });
  assert.deepEqual(effectiveNetworkWait({ WORCA_NETWORK_WAIT: '0' }), { enabled: false, maxWaitMs: 30 * 60_000 });
  assert.deepEqual(effectiveNetworkWait({ WORCA_NETWORK_WAIT: '' }), { enabled: true, maxWaitMs: 30 * 60_000 });
  assert.deepEqual(effectiveNetworkWait({ WORCA_NETWORK_WAIT_MAX_MS: '1500' }), { enabled: true, maxWaitMs: 1500 });
  assert.deepEqual(effectiveNetworkWait({ WORCA_NETWORK_WAIT_MAX_MS: 'junk' }), { enabled: true, maxWaitMs: 30 * 60_000 });
  await setNetworkWait(null);
});
