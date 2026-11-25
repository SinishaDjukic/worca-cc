// test/api-workflow-test-project-restart.test.mjs — workflow tests 3a (D61): what a restart leaves of a project try is
// removed at boot: its run folder (the run-root sweep, once the row is stopped) and its branch in Worca's copy (the copy sweep).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { templateRepo } from './helpers/git-dir.mjs';
import { repoSnapshot } from './helpers/repo-snapshot.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
let homeDir, prevHome, real;
before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftrestart-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  real = templateRepo('wftrestart', { branch: 'main', user: true, files: { 'README.md': '# r\n' } });
});
after(async () => {
  // Close the store first: on Windows an open SQLite file makes rm retry for minutes.
  const { _resetForTests } = await import('../src/core/db.mjs');
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const d of [homeDir, real]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('boot: an interrupted project try loses its run folder and its branch', { timeout: 120000 }, async () => {
  const { projectKey } = await import('../src/core/store.mjs');
  const key = projectKey(real);
  const was = repoSnapshot(real);
  const { pinStart } = await import('../src/core/workflow-tests/project-copy.mjs');
  const p = await pinStart({ key, name: 'r', projectDir: real });
  const { worcaHome } = await import('../src/core/projects.mjs');
  // worcaHome() is <WORCA_HOME>/.worca-cc: the copy and the run root live there.
  const copy = join(worcaHome(), 'workflow-tests', 'repos', key);
  const runRoot = join(worcaHome(), 'runs', 'feed0009');
  mkdirSync(join(runRoot, 'repos'), { recursive: true });
  git(copy, 'worktree', 'add', '-q', '-b', 'worca-cc/left-feed0009', '--', join(runRoot, 'repos', key), p.startCommit);
  const { getDb } = await import('../src/core/db.mjs');
  // A crashed server's row: its last heartbeat is old, so the boot reconcile takes it as interrupted (isDeadOwner).
  getDb().prepare(`INSERT INTO pipelines (id, project_key, status, is_test, resume_point, heartbeat_at)
    VALUES ('feed0009', ?, 'running', 1, NULL, '2026-01-01T00:00:00.000Z')`).run(key);
  const { bootMaintenance } = await import('../ui/server.mjs');
  const summary = await bootMaintenance();
  assert.equal(getDb().prepare("SELECT status FROM pipelines WHERE id = 'feed0009'").get().status, 'stopped');
  assert.equal(existsSync(runRoot), false, 'the run-root sweep took it');
  assert.throws(() => git(copy, 'rev-parse', '--verify', '--quiet', 'refs/heads/worca-cc/left-feed0009'));
  assert.deepEqual(summary.testCopies, { copies: 1, branches: 1, beforeRuns: { runs: 0, kept: 0 } });
  assert.equal(repoSnapshot(real), was, "the boot sweep only touched Worca's copy: the person's repository is as it was");
});
