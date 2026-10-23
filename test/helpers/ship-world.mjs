// test/helpers/ship-world.mjs — Ship as (D24, D25) and the Ship card (Shaper s4) fixtures, shared by
// test/shape-server-slices.test.mjs and test/api-shape-first.test.mjs: a real repo with three done stacked slices, each
// with a PR, and the gh/git stub the ship runs against. The caller passes its own id minter (ids must not collide
// with the file's other rows) and its outline builder.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedPipelineRow } from './db-seed.mjs';
import { withEnv } from './with-env.mjs';
import { getDb } from '../../src/core/db.mjs';
import { projectKey } from '../../src/core/store.mjs';
import { writeStoreMeta } from '../../src/core/artifacts.mjs';
import { createSliceFeature, recordSliceDraft } from '../../src/core/shape/features.mjs';
import { _testing as gitInfo } from '../../src/core/git-info.mjs';

export const NO_ADO = { WORCA_ADO_TOKEN: undefined, WORCA_ADO_READ_TOKEN: undefined, WORCA_ADO_WRITE_TOKEN: undefined, AZURE_DEVOPS_EXT_PAT: undefined };
export const REMOTES_V = 'origin\thttps://github.com/me/repo.git (fetch)\norigin\thttps://github.com/me/repo.git (push)\n';
export const okRun = (stdout) => Promise.resolve({ ok: true, stdout, stderr: '', code: 0 });
export const failRun = (stderr) => Promise.resolve({ ok: false, stdout: '', stderr, code: 1 });
export const argOf = (argv, flag) => argv[argv.indexOf(flag) + 1];
export const ghCalls = (seen, sub) => seen.filter((a) => a[0] === 'gh' && a[1] === 'pr' && a[2] === sub);
export const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };

/** Gate on (WORCA_FLAGS locks it), no Azure token, and the git-info runner reset after `fn`. */
export async function withShip(fn) {
  const saved = process.env.WORCA_FLAGS;
  process.env.WORCA_FLAGS = 'shapeFirst';
  try { return await withEnv(NO_ADO, fn); } finally {
    gitInfo.reset();
    process.env.WORCA_FLAGS = saved === undefined ? '-shapeFirst' : saved;
  }
}

/** gh/git stub for the ship: `gh pr create` answers `create`, `git describe --tags` answers `describe`, every argv is
 *  recorded. Anything it does not know answers '' (so the world repo's real tags are never seen). */
export function stubShip(seen, { create = () => okRun('https://github.com/me/repo/pull/9\n'), ready = () => okRun(''), describe = null } = {}) {
  gitInfo.setRunner((cmd, args) => {
    seen.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === '--version') return okRun('gh 2.x');
    if (cmd === 'git' && args[0] === 'remote') return okRun(REMOTES_V);
    if (cmd === 'git' && args[0] === 'describe') return describe ? okRun(`${describe}\n`) : failRun('fatal: No names found');
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') return create(args);
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'ready') return ready(args);
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view' && args.includes('body')) return okRun('Some body');
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') return okRun('https://github.com/me/repo/pull/3\n');
    return okRun('');
  });
}

/** → { shipWorld, cleanup }. `nextId()` mints pipeline ids; `outlineOf(n)` builds an n-slice outline. */
export function shipKit({ nextId, outlineOf }) {
  const dirs = [];
  /** A real repo (the changelog commit is real git) with slices 1..3 done on stacked branches, each with a draft PR
   *  (an in-flight feature's: the one ship flow opens none per slice). `drafts: false` leaves them ready PRs (as a partly
   *  finished stacked ship leaves them); `prs: false` gives no slice a PR. */
  function shipWorld({ prs = true, drafts = true } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'worca-ship-'));
    dirs.push(dir);
    git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
    git(dir, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(dir, 'f.txt'), 'x\n'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init');
    const key = projectKey(dir);
    writeStoreMeta(key, 'project', { key, name: 'S', path: dir });
    const pids = [];
    let source = 'main';
    for (let i = 1; i <= 3; i++) {
      const id = nextId();
      git(dir, 'branch', `feat/${id}`, source);
      seedPipelineRow({ id, projectKey: key, status: 'done', title: `Charts · ${i}/3: Slice ${i}`, branch: { source, feature: `feat/${id}` } });
      pids.push(id);
      source = `feat/${id}`;
    }
    const f = createSliceFeature({ pipelineId: pids[0], projectDir: dir, title: 'Charts', outline: outlineOf(3), perspectives: ['product'],
      workflowId: 'wf_shape', base: { mock: true } });
    for (let i = 2; i <= 3; i++) {
      const t = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(f.id, i).ticket_id;
      getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(pids[i - 1], t);
    }
    if (prs) {
      pids.forEach((p, i) => getDb().prepare("UPDATE pipelines SET pr_url = ?, pr_number = ?, pr_state = 'OPEN' WHERE id = ?").run(`https://github.com/me/repo/pull/${i + 1}`, i + 1, p));
      if (drafts) pids.forEach((p, i) => recordSliceDraft(p, `https://github.com/me/repo/pull/${i + 1}`));
    }
    return { dir, f, pids, last: `feat/${pids[2]}` };
  }
  return { shipWorld, cleanup: () => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); } };
}
