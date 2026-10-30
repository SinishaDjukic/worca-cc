// test/exec-env-registry.test.mjs — the execution-backend registry (plans/e2b-execution-design.md §17).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXEC_ENVS, selectExecEnv, isExecEnvName, describeExecEnvs, getExecBackend } from '../src/core/exec-env/index.mjs';
import { _registerExecBackendForTests } from '../src/core/exec-env/registry.mjs';
import { assertBackend } from '../src/core/exec-env/backend.mjs';
import { stripHostCredentials } from '../src/core/host-credentials.mjs';
import { createLoopbackBackend } from './helpers/loopback-backend.mjs';

const root = mkdtempSync(join(tmpdir(), 'worca-registry-')); after(() => rmSync(root, { recursive: true, force: true }));

test('EXEC_ENVS is derived from the registry: local first, then e2b', () => {
  assert.deepEqual(EXEC_ENVS, ['local', 'e2b']);
  assert.equal(getExecBackend('e2b').label, 'E2B sandbox');
  assert.throws(() => getExecBackend('docker'), /unknown execution environment "docker" \(known: local, e2b\)/);
});

test('a registered backend is selectable, listed with its label, and its secrets are stripped from host children', () => {
  const lb = createLoopbackBackend({ root });
  const unregister = _registerExecBackendForTests(lb.backend);
  try {
    assert.equal(selectExecEnv('loopback'), 'loopback');
    assert.equal(isExecEnvName('loopback'), true);
    assert.deepEqual(describeExecEnvs().map((e) => [e.name, e.label]), [['local', 'Local'], ['e2b', 'E2B sandbox'], ['loopback', 'Loopback box']]);
    assert.deepEqual(stripHostCredentials({ LOOPBACK_SECRET_TOKEN: 'x', KEEP: '1' }), { KEEP: '1' });
  } finally { unregister(); }
  assert.throws(() => selectExecEnv('loopback'), /unknown execution environment/);
});

test('E2B keys never reach a host child (stripHostCredentials, fed by the e2b backend)', () => {
  const out = stripHostCredentials({ E2B_API_KEY: 'k', E2B_API_URL: 'u', WORCA_E2B_TEMPLATE: 't', GH_TOKEN: 'g', PATH: '/bin' });
  assert.deepEqual(out, { PATH: '/bin' });
});

test('assertBackend refuses a malformed definition', () => {
  const ok = createLoopbackBackend({ root }).backend;
  assert.doesNotThrow(() => assertBackend(ok));
  assert.throws(() => assertBackend({ ...ok, name: 'local' }), /other than "local"/);
  assert.throws(() => assertBackend({ ...ok, open: undefined }), /open\(\) is required/);
  assert.throws(() => assertBackend({ ...ok, secretEnv: /^X_/g }), /without g\/y/);
});
