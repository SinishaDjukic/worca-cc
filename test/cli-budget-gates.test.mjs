// test/cli-budget-gates.test.mjs
// Budget gates on the CLI: the run path refuses when the windowed total limit is
// reached, `worca resume` refuses an archived pipeline and a pipeline over its
// per-pipeline cap, and `--ignore-cost-cap` persists the per-pipeline override.
//
// Harness mirrors test/cli-config.test.mjs: the CLI runs as a child process while
// the ledger/pipeline rows are seeded from THIS process. Both sides see the same
// DB only because the child inherits WORCA_HOME; settings live under HOME, so the
// child gets the sandboxed HOME/USERPROFILE too.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');

// The ledger/pipelines side of the gates lives under WORCA_HOME.
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

// Throwaway project dirs (only their projectKey matters — the gates fire before
// any worktree work, so these are never git repos).
const projDirs = [];
after(() => Promise.all(projDirs.map((d) => rm(d, { recursive: true, force: true }))));
async function freshProjectDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-budget-proj-'));
  projDirs.push(dir);
  return dir;
}

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

/** Append one ledger event inside the CURRENT window (ts = now). */
function seedLedgerRow(amountUsd) {
  getDb().prepare('INSERT INTO cost_ledger (pipeline_id, step_key, amount_usd, ts) VALUES (?,?,?,?)')
    .run('ledger-seed', null, amountUsd, Date.now());
}
function clearLedger() {
  getDb().prepare('DELETE FROM cost_ledger').run();
}

/** A paused pipeline with a resume point — passes both pre-budget resume guards. */
async function seedPausedPipeline({ totalCostUsd = 0 } = {}) {
  const projectDir = await freshProjectDir();
  const { id } = await seedPipeline(projectDir, {
    title: 'paused budget run',
    status: 'paused',
    totalCostUsd,
    branch: { source: 'main', feature: 'f', worktreeDir: join(projectDir, 'gone-wt'), reusedExisting: false },
    resumePoint: {
      version: 2, kind: 'boundary', stepIndex: 0, stepCycle: [], loopState: {},
      bus: null, stepModels: null, workflowId: 'wf_default', plan: null, nodes: [], gate: null,
      pipelineDir: projectDir, pausedAt: '2026-08-07T00:00:00Z',
    },
  });
  return id;
}

function readOverride(id) {
  return getDb().prepare('SELECT cost_cap_override FROM pipelines WHERE id = ?').get(id)?.cost_cap_override;
}
function archiveRow(id) {
  getDb().prepare('UPDATE pipelines SET archived_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

test('run path refuses when total-blocked: exit 1, message names limit + reset + raise hint', async () => {
  await runCli(['config', 'set', 'totalCostLimitUsd', '1']);
  seedLedgerRow(2);
  const seededProjectDir = await freshProjectDir();
  const r = await runCli(['--project', seededProjectDir, '--prompt', 'x', '--mock', '--yes']);
  assert.equal(r.code, 1, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.match(r.stderr, /worca: total cost limit reached: \$2\.00 of \$1\.00/);
  assert.match(r.stderr, /resets \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(in /);
  assert.match(r.stderr, /worca config set totalCostLimitUsd/);
  await runCli(['config', 'unset', 'totalCostLimitUsd']);
  clearLedger();
});

test('resume refuses per-pipeline cap without the flag; --ignore-cost-cap sets the override', async () => {
  await runCli(['config', 'set', 'pipelineCostLimitUsd', '1']);
  const id = await seedPausedPipeline({ totalCostUsd: 2 });
  let r = await runCli(['resume', id, '--mock', '--yes']);
  assert.equal(r.code, 1, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.match(r.stderr, /pipeline cost limit reached: \$2\.00 spent >= \$1\.00 cap/);
  assert.match(r.stderr, /--ignore-cost-cap/);
  r = await runCli(['resume', id, '--ignore-cost-cap', '--mock', '--yes']);
  // The column is set even though the resume itself then fails on the sandbox
  // worktree checks — the override is persisted before projectDir resolution.
  assert.equal(readOverride(id), 1, `stderr: ${r.stderr}`);
  await runCli(['config', 'unset', 'pipelineCostLimitUsd']);
});

// Ordering lock: the total gate is never bypassable, and it must run BEFORE
// --ignore-cost-cap persists anything — a fresh pipeline proves the column stays
// 0 (the per-pipeline test above reuses an already-overridden row, so it cannot).
test('resume --ignore-cost-cap still refuses when total-blocked, without arming the override', async () => {
  await runCli(['config', 'set', 'totalCostLimitUsd', '1']);
  seedLedgerRow(2);
  const id = await seedPausedPipeline({ totalCostUsd: 2 });
  const r = await runCli(['resume', id, '--ignore-cost-cap', '--mock', '--yes']);
  assert.equal(r.code, 1, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.match(r.stderr, /total cost limit reached: \$2\.00 of \$1\.00/);
  assert.equal(readOverride(id), 0, 'a refused resume must not arm the override');
  await runCli(['config', 'unset', 'totalCostLimitUsd']);
  clearLedger();
});

test('resume refuses archived pipelines', async () => {
  const id = await seedPausedPipeline({});
  archiveRow(id);
  const r = await runCli(['resume', id, '--mock', '--yes']);
  assert.equal(r.code, 1, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.match(r.stderr, /archived/);
});
