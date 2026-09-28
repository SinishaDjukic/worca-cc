// test/cli-metrics.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { useGitSandbox, makeOrigin, cloneAs, branchFiles } from './helpers/metrics-git.mjs';
import { addProject } from '../src/core/projects.mjs';
import { enableTeamMetrics, writeOutbox } from '../src/core/metrics/sync.mjs';
import { makeRecord } from './fixtures/team-metrics/records.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');

// useGitSandbox pins HOME/USERPROFILE/GIT_CONFIG_GLOBAL and useTempHome pins WORCA_HOME,
// both by mutating process.env — the spawned CLI child inherits process.env, so it sees
// the same project store, outbox and git identity as this test process.
useGitSandbox(before, after);
useTempHome(after);

function runCli(args) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}

test('worca metrics help / push with nothing pending / unknown verb', async () => {
  let r = await runCli(['metrics', 'help']);
  assert.equal(r.code, 0); assert.match(r.stdout, /worca metrics push/);
  r = await runCli(['metrics', 'push']);
  assert.equal(r.code, 0); assert.match(r.stdout, /nothing pending/);
  r = await runCli(['metrics', 'bogus']);
  assert.equal(r.code, 2); assert.match(r.stderr, /unknown metrics verb/);
  r = await runCli(['help']);
  assert.match(r.stdout, /metrics push/);
});

test('worca metrics push flushes a real outbox against a bare origin', { skip: process.platform === 'win32' }, async () => {
  // Same WORCA_HOME as the child process, so the CLI sees this outbox and this project row.
  const root = mkdtempSync(join(tmpdir(), 'worca-cli-metrics-root-'));
  const bare = makeOrigin(root, 'billing-api');
  const dir = cloneAs(root, 'machineA', bare, 'billing-api');
  await addProject({ name: 'billing-api', path: dir });
  await enableTeamMetrics(dir, { mode: 'here', attribution: 'git-user' });
  await writeOutbox('billing-api', makeRecord({ id: 'runA0001' }));
  const r = await runCli(['metrics', 'push']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /✓ billing-api: pushed 1 run\(s\)/);
  assert.equal(branchFiles(bare).filter((f) => f.endsWith('.jsonl')).length, 1);
  const p = await runCli(['metrics', 'push', '--project', dir]);
  assert.equal(p.code, 0, p.stderr);
  assert.match(p.stdout, /billing-api: nothing pending/);
  rmSync(root, { recursive: true, force: true });
});
