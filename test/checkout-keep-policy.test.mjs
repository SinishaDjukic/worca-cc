// test/checkout-keep-policy.test.mjs — keep a finished run's checkout by policy (issue #529, D10/D11).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { withEnv } from './helpers/with-env.mjs';

const NO_ADO = { WORCA_ADO_TOKEN: undefined, WORCA_ADO_READ_TOKEN: undefined, WORCA_ADO_WRITE_TOKEN: undefined, AZURE_DEVOPS_EXT_PAT: undefined };

// settingsFile() lives under HOME, not WORCA_HOME: repoint both BEFORE any src/core import,
// or this test rewrites the developer's real settings.json (keep policy, cap).
const home = useTempHome(after, 'worca-cc-keep-');
const prevHome = process.env.HOME;
const prevProfile = process.env.USERPROFILE;
process.env.HOME = process.env.USERPROFILE = home;
after(() => {
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  if (prevProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevProfile;
});

const { seedPipeline } = await import('./helpers/db-seed.mjs');
const { getDb } = await import('../src/core/db.mjs');
const { worcaHome } = await import('../src/core/projects.mjs');
const { setActionsSettings } = await import('../src/core/settings.mjs');
const { checkoutRecordsFor, findPipelineRowById, persistPrState } = await import('../src/core/artifacts.mjs');
const { keepAfterRun, releaseKeptCheckouts } = await import('../src/core/checkout.mjs');
const azurePr = await import('../src/core/pr/azure.mjs');

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const created = [];
function freshRepo() {
  const dir = realpathSync(templateRepo('keep-repo', { branch: 'main', user: true, files: { 'README.md': '# hi\n' } }));
  created.push(dir);
  return dir;
}
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

async function seedDoneRun(repo, feature, { status = 'done' } = {}) {
  const { id, dir, key } = await seedPipeline(repo, { status,
    branch: { source: 'main', feature, runRootMode: 'detached', worktreeRemoved: true, branchKept: true } });
  const worktreeDir = join(worcaHome(), 'runs', id, 'repos', key);
  getDb().prepare(`UPDATE pipelines SET branch = json_set(branch, '$.worktreeDir', ?) WHERE id = ?`).run(worktreeDir, id);
  return { id, dir, key };
}

test('keep policy: on-success keeps a done run with setup pending, not an error run; never is a no-op', async () => {
  // One on-success checkout serves the setup-pending row too, and the never row reuses its repo.
  await setActionsSettings({ keep: 'on-success' });
  const repo = await freshRepo(); git(repo, ['branch', 'worca-cc/k']);
  const { id } = await seedDoneRun(repo, 'worca-cc/k');
  const r = await keepAfterRun({ pipelineId: id });
  await checkRows([
    { name: 'on-success: a done run keeps a checkout after teardown; an error run does not', run: async () => {
      assert.equal(r.members[0].state, 'checked-out');
      assert.equal(checkoutRecordsFor(findPipelineRowById(id)).members[0].policy, 'on-success');
      const { id: bad } = await seedDoneRun(await freshRepo(), 'worca-cc/e', { status: 'error' });
      assert.equal(await keepAfterRun({ pipelineId: bad }), null);
    } },
    { name: 'never (default) is a no-op', run: async () => {
      await setActionsSettings({ keep: null });
      const { id: never } = await seedDoneRun(repo, 'worca-cc/n');
      assert.equal(await keepAfterRun({ pipelineId: never }), null);
    } },
    { name: 'a kept checkout has setup pending, and nothing runs until the first action (D10, D25)', run: () => {
      assert.equal(checkoutRecordsFor(findPipelineRowById(id)).members[0].setup.status, 'pending');
    } },
  ]);
});

test('until-pr: released when the PR is MERGED or CLOSED, kept while OPEN or absent', async () => {
  await setActionsSettings({ keep: 'until-pr' });
  const ids = {};
  for (const s of ['OPEN', 'MERGED', 'CLOSED', 'NONE']) {
    // Feature branches are always sanitized to lowercase (worktree.mjs sanitizeBranchName).
    const feature = `worca-cc/${s.toLowerCase()}`;
    const repo = await freshRepo(); git(repo, ['branch', feature]);
    const { id } = await seedDoneRun(repo, feature);
    await keepAfterRun({ pipelineId: id });
    if (s !== 'NONE') persistPrState(id, { url: `https://github.com/o/r/pull/${s}`, number: 1, state: 'OPEN' });
    ids[s] = id;
  }
  const states = { [`https://github.com/o/r/pull/MERGED`]: 'MERGED', [`https://github.com/o/r/pull/CLOSED`]: 'CLOSED' };
  const { released } = await releaseKeptCheckouts({ prState: async ({ prUrl }) => states[prUrl] || 'OPEN' });
  assert.deepEqual(released.sort(), [ids.MERGED, ids.CLOSED].sort());
});

test('until-pr: an Azure DevOps PR URL is released when its PR is MERGED', async () => {
  await setActionsSettings({ keep: 'until-pr' });
  await releaseKeptCheckouts({ prState: async () => 'MERGED' });           // clear earlier rows' checkouts
  const feature = 'worca-cc/azure-merged';
  const repo = await freshRepo(); git(repo, ['branch', feature]);
  const { id } = await seedDoneRun(repo, feature);
  await keepAfterRun({ pipelineId: id });
  const url = 'https://dev.azure.com/acme/Shop/_git/api/pullrequest/7';
  persistPrState(id, { url, number: 7, state: 'OPEN' });
  const { released } = await releaseKeptCheckouts({ prState: async ({ prUrl }) => (prUrl === url ? 'MERGED' : 'OPEN') });
  assert.deepEqual(released, [id]);
});

test('until-pr: the default prState releases a checkout whose Azure DevOps PR completed', async () => {
  await setActionsSettings({ keep: 'until-pr' });
  await releaseKeptCheckouts({ prState: async () => 'MERGED' });           // clear earlier rows' GitHub-URL checkouts, no gh
  const feature = 'worca-cc/azure-done';
  const repo = await freshRepo(); git(repo, ['branch', feature]);
  const { id } = await seedDoneRun(repo, feature);
  await keepAfterRun({ pipelineId: id });
  persistPrState(id, { url: 'https://dev.azure.com/acme/Shop/_git/api/pullrequest/3', number: 3, state: 'OPEN' });
  azurePr._testing.setFetch(async () => ({ status: 200, ok: true, json: async () => ({ pullRequestId: 3, status: 'completed' }) }));
  try {
    const { released } = await withEnv({ ...NO_ADO, WORCA_ADO_TOKEN: 'pat' }, () => releaseKeptCheckouts());
    assert.ok(released.includes(id), JSON.stringify(released));
  } finally { azurePr._testing.reset(); }
});
