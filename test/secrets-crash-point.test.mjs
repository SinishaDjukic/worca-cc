// test/secrets-crash-point.test.mjs — the migration's test-only crash hook: it SIGKILLs only under the node:test
// runner marker AND with WORCA_TEST_SECRETS_CRASH naming exactly `point@store` for the store the run set; production
// (no marker) ignores the variable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CRASH_POINTS } from '../src/core/secrets/crash-point.mjs';

const MODULE = new URL('../src/core/secrets/crash-point.mjs', import.meta.url).href;
const REPO = fileURLToPath(new URL('../', import.meta.url));

function child({ marker, crash, store = 'mcp', point = 'after-swap' }) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.WORCA_TEST_SECRETS_CRASH;
  if (marker) env.NODE_TEST_CONTEXT = 'child-v8';
  if (crash) env.WORCA_TEST_SECRETS_CRASH = crash;
  const code = `const m = await import(${JSON.stringify(MODULE)}); m.setCrashStore(${JSON.stringify(store)}); m.crashPoint(${JSON.stringify(point)}); console.log('alive');`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: REPO, env, encoding: 'utf8', timeout: 30_000 });
}

test('the crash points, in order', () => {
  assert.deepEqual(CRASH_POINTS, ['after-vault-write', 'after-read-back', 'before-config-rewrite', 'after-swap', 'between-stores', 'mid-vault-write',
    'after-restore', 'after-vault-unlink']);
});

test('without the node:test marker the crash variable is ignored and the child exits 0', () => {
  const r = child({ marker: false, crash: 'after-swap@mcp' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'alive');
});

test('with the marker and a matching point@store the child dies by SIGKILL', { skip: process.platform === 'win32' }, () => {
  const r = child({ marker: true, crash: 'after-swap@mcp' });
  assert.equal(r.signal, 'SIGKILL');
  assert.equal(r.stdout, '');
});

test('another point or another store is a no-op', () => {
  for (const crash of ['after-read-back@mcp', 'after-swap@settings', 'after-swap', '']) {
    const r = child({ marker: true, crash });
    assert.equal(r.status, 0, `${crash}: ${r.stderr}`);
    assert.equal(r.stdout.trim(), 'alive');
  }
});
