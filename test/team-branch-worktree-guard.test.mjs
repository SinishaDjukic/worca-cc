// test/team-branch-worktree-guard.test.mjs — security G2 on the team-metrics and team-policy checkouts. Their
// `worktree add` runs with no person acting (a metrics read, flush or policy sync) in the project's shared .git,
// where an agent can plant a filter driver behind a conditional include that matches only inside a linked
// worktree. Neither checkout may run it (git-guard guardedWorktreeAdd).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { git, makeOrigin, cloneAs, useGitSandbox } from './helpers/metrics-git.mjs';
import { addProject } from '../src/core/projects.mjs';
import { enableTeamMetrics, ensureWorktree as ensureMetricsWorktree, worktreePath as metricsWorktreePath } from '../src/core/metrics/sync.mjs';
import { enableTeamPolicy, ensureWorktree as ensurePolicyWorktree, worktreePath as policyWorktreePath } from '../src/core/policy/sync.mjs';

const skip = process.platform === 'win32' ? 'the planted filter is POSIX shell' : false;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'worca-team-wt-guard-')));
useGitSandbox(before, after);
useTempHome(after);
after(() => rmSync(root, { recursive: true, force: true }));

function plantConditional(repo, marks) {
  const inc = join(root, 'evil.cfg');
  writeFileSync(inc, `[filter "pwn"]\n\tsmudge = "touch '${marks}/smudge' && cat"\n\tclean = cat\n`);
  git(repo, 'config', '--add', 'includeIf.gitdir:**/.git/worktrees/**.path', inc);
  mkdirSync(join(repo, '.git', 'info'), { recursive: true });
  writeFileSync(join(repo, '.git', 'info', 'attributes'), '* filter=pwn\n');
}

test('the metrics and policy checkouts run no filter from a conditional include', { skip }, async () => {
  const bare = makeOrigin(root, 'gateway');
  const proj = cloneAs(root, 'm', bare, 'gateway');
  await addProject({ name: 'gateway', path: proj });
  await enableTeamMetrics(proj, { mode: 'here' });
  await enableTeamPolicy(proj, { mode: 'here' });
  const marks = join(root, 'marks'); mkdirSync(marks);
  plantConditional(proj, marks);
  for (const [name, path, ensure] of [['metrics', metricsWorktreePath, ensureMetricsWorktree], ['policy', policyWorktreePath, ensurePolicyWorktree]]) {
    rmSync(path('gateway'), { recursive: true, force: true });
    const dir = await ensure('gateway', proj);
    assert.ok(existsSync(join(dir, 'README.md')), `${name}: the branch is checked out`);
    assert.deepEqual(readdirSync(marks), [], `${name}: the planted smudge ran`);
  }
});
