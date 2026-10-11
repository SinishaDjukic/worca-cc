// test/checkout-free-branch.test.mjs — freeBranchCheckout (#619): before a PR fix run, Worca
// releases a branch checkout only when it provably owns the one holder and nothing uses it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline, seedPipelineRow } from './helpers/db-seed.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { getDb } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { checkoutRecordsFor, lookupPipelineRow } from '../src/core/artifacts.mjs';
import { checkoutRun, freeBranchCheckout } from '../src/core/checkout.mjs';

useTempHome(after, 'worca-cc-free-branch-');

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const created = [];
function freshRepo() {
  const dir = templateRepo('fb', { branch: 'main', user: true, files: { 'README.md': '# hi\n' } });
  created.push(dir);
  return dir;
}
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

async function seedDoneRun(repo, feature) {
  const { id, key } = await seedPipeline(repo, { status: 'done',
    branch: { source: 'main', feature, runRootMode: 'detached', worktreeRemoved: true, branchKept: true } });
  getDb().prepare(`UPDATE pipelines SET branch = json_set(branch, '$.worktreeDir', ?) WHERE id = ?`)
    .run(join(worcaHome(), 'runs', id, 'repos', key), id);
  return { id, key };
}

async function seedWorkspaceDoneRun(n) {
  const id = randomUUID().slice(0, 8);
  const members = [];
  for (let i = 0; i < n; i++) {
    const repo = freshRepo(); const feature = `worca-cc/fbw${i}`; git(repo, ['branch', feature]);
    const pk = projectKey(repo);
    members.push({ projectKey: pk, projectDir: repo, projectName: basename(repo),
      br: { source: 'main', feature, runRootMode: 'detached', worktreeRemoved: true, branchKept: true,
            worktreeDir: join(worcaHome(), 'runs', id, 'repos', pk) } });
  }
  seedPipelineRow({ id, projectKey: members[0].projectKey, workspaceKey: 'wks-test-0cea65fb', target: 'workspace', status: 'done',
    workspaceMeta: { runRootMode: 'detached', projects: members.map(({ projectKey: pk, projectDir, projectName }) => ({ projectKey: pk, projectDir, projectName })),
                     branches: Object.fromEntries(members.map((m) => [m.projectKey, m.br])) } });
  return { id, members };
}

test('no holder: nothing to release', async () => {
  const repo = freshRepo(); git(repo, ['branch', 'worca-cc/none']);
  assert.deepEqual(await freeBranchCheckout({ projectDir: repo, branch: 'worca-cc/none' }), { released: false });
});

test('an idle kept project checkout is released, dirty work patched, the branch kept', async () => {
  const repo = freshRepo(); git(repo, ['branch', 'worca-cc/idle']);
  const { id } = await seedDoneRun(repo, 'worca-cc/idle');
  const { members: [m] } = await checkoutRun({ id });
  await writeFile(join(m.worktreeDir, 'edit.txt'), 'x');
  const stopped = [];
  const out = await freeBranchCheckout({ projectDir: repo, branch: 'worca-cc/idle', stopServices: async (pk) => { stopped.push(pk); } });
  assert.deepEqual(out, { released: true, runId: id, projectKey: m.projectKey });
  assert.deepEqual(stopped, [m.projectKey]);
  assert.equal(existsSync(m.worktreeDir), false);
  assert.equal(checkoutRecordsFor(lookupPipelineRow(m.projectKey, id)), null);
  assert.equal(git(repo, ['rev-parse', '--verify', 'worca-cc/idle']).status, 0);
});

test('workspace: only the matched member is released, its sibling stays', async () => {
  const { id, members } = await seedWorkspaceDoneRun(2);
  const r = await checkoutRun({ id });
  const [a, b] = r.members;
  const out = await freeBranchCheckout({ projectDir: members[0].projectDir, branch: members[0].br.feature });
  assert.equal(out.released, true);
  assert.equal(out.projectKey, members[0].projectKey);
  assert.equal(existsSync(a.worktreeDir), false);
  assert.equal(existsSync(b.worktreeDir), true);
});

test('a busy (live or finishing) holder is refused', async () => {
  const repo = freshRepo(); git(repo, ['branch', 'worca-cc/busy']);
  const { id } = await seedDoneRun(repo, 'worca-cc/busy');
  const { members: [m] } = await checkoutRun({ id });
  await assert.rejects(freeBranchCheckout({ projectDir: repo, branch: 'worca-cc/busy', busy: new Set([id]) }), { code: 'BUSY' });
  assert.equal(existsSync(m.worktreeDir), true);
});

test('main, a foreign worktree, and an external (linked) holder are refused', async () => {
  const repo = freshRepo(); git(repo, ['branch', 'worca-cc/foreign']);
  await assert.rejects(freeBranchCheckout({ projectDir: repo, branch: 'main' }), { code: 'MAIN_BRANCH' });
  const wt = await mkdtemp(join(tmpdir(), 'worca-cc-fb-foreign-')); created.push(wt);
  await rm(wt, { recursive: true, force: true });
  assert.equal(git(repo, ['worktree', 'add', wt, 'worca-cc/foreign']).status, 0);
  await assert.rejects(freeBranchCheckout({ projectDir: repo, branch: 'worca-cc/foreign' }), { code: 'FOREIGN_HOLDER' });
  assert.equal(existsSync(wt), true);

  // useExisting links the person's own folder: external, never released.
  const repo2 = freshRepo(); git(repo2, ['branch', 'worca-cc/ext']);
  const { id } = await seedDoneRun(repo2, 'worca-cc/ext');
  const wt2 = await mkdtemp(join(tmpdir(), 'worca-cc-fb-ext-')); created.push(wt2);
  await rm(wt2, { recursive: true, force: true });
  assert.equal(git(repo2, ['worktree', 'add', wt2, 'worca-cc/ext']).status, 0);
  await checkoutRun({ id, useExisting: true });
  await assert.rejects(freeBranchCheckout({ projectDir: repo2, branch: 'worca-cc/ext' }), { code: 'FOREIGN_HOLDER' });
  assert.equal(existsSync(wt2), true);
});

test('two Worca rows claiming the same holder are ambiguous', async () => {
  const repo = freshRepo(); git(repo, ['branch', 'worca-cc/amb']);
  const { id } = await seedDoneRun(repo, 'worca-cc/amb');
  const { members: [m] } = await checkoutRun({ id });
  const { id: id2 } = await seedDoneRun(repo, 'worca-cc/amb');
  const row = lookupPipelineRow(m.projectKey, id);
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(row.branch, id2);
  await assert.rejects(freeBranchCheckout({ projectDir: repo, branch: 'worca-cc/amb' }), { code: 'AMBIGUOUS_HOLDER' });
  assert.equal(existsSync(m.worktreeDir), true);
});
