// test/cli-config.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');

// The ledger/DB side of `worca config` lives under WORCA_HOME.
const home = useTempHome(after);

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

/** Spawn the CLI with BOTH sandboxes pinned: WORCA_HOME (db) + HOME (settings). */
function runCli(args) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, WORCA_HOME: home, HOME: sandboxHome, USERPROFILE: sandboxHome },
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}

test('config list prints the three keys with effective values (tab-separated)', async () => {
  const r = await runCli(['config']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /pipelineCostLimitUsd\t\(unset\)/);
  assert.match(r.stdout, /totalCostLimitUsd\t\(unset\)/);
  assert.match(r.stdout, /costLimitResetPeriod\tmonthly/);
});

test('config set/get/unset roundtrip incl. kebab aliases', async () => {
  assert.equal((await runCli(['config', 'set', 'total-cost-limit', '50'])).code, 0);
  let r = await runCli(['config', 'get', 'totalCostLimitUsd']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^50\s*$/m);
  assert.equal((await runCli(['config', 'set', 'cost-reset-period', 'weekly'])).code, 0);
  assert.match((await runCli(['config', 'get', 'costLimitResetPeriod'])).stdout, /weekly/);
  assert.equal((await runCli(['config', 'unset', 'total-cost-limit'])).code, 0);
  assert.match((await runCli(['config', 'get', 'totalCostLimitUsd'])).stdout, /\(unset\)/);
});

test('config list shows the window line once a total limit is set', async () => {
  await runCli(['config', 'set', 'totalCostLimitUsd', '100']);
  const r = await runCli(['config']);
  assert.match(r.stdout, /window\t\$0\.00 of \$100/);
  assert.match(r.stdout, /resets .* \(in /);
  await runCli(['config', 'unset', 'totalCostLimitUsd']);
});

test('validation: NaN and bad enum fail with exit 2; unknown key names the allowed keys', async () => {
  let r = await runCli(['config', 'set', 'totalCostLimitUsd', 'ten']);
  assert.equal(r.code, 2);
  r = await runCli(['config', 'set', 'costLimitResetPeriod', 'daily']);
  assert.equal(r.code, 2);
  r = await runCli(['config', 'get', 'nope']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /pipelineCostLimitUsd/);
});
