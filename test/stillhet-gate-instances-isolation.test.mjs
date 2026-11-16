// test/stillhet-gate-instances-isolation.test.mjs — PLAN-Gc C1 (impl review cycles 1–3): a copied gate instance (A real-old,
// B real-new) can never change the owner's real repos. A fake "real" home holds a main repo, a project that is a linked
// worktree of it, and a store whose two finished runs own a worktree and a branch each. After prepareHome the server's own
// archive and delete (src/core/pipeline-delete.mjs, as the runs routes call them) run on the copy: they remove the copy's
// branches and worktrees, and the real repo's refs, worktree list, admin files and every byte of its files stay the same.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs, planInstances, buildInstanceEnv, prepareHome, verifyIsolation, main } from '../tools/stillhet-gate-instances.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { writeStoreMeta, readPipelineByKey } from '../src/core/artifacts.mjs';
import { archivePipeline, purgePipeline } from '../src/core/pipeline-delete.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';

const posixOnly = process.platform === 'win32' ? 'APFS/cp clone and POSIX git paths' : false;
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worca-gate-iso-test-')));
const prevHome = process.env.WORCA_HOME;
after(() => {
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  rmSync(scratch, { recursive: true, force: true });
});
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: GIT_ENV }).trim();

/** Every file under `dir` → { rel: sha256 + mtime }. */
function snapshot(dir, rel = '') {
  const out = {};
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = join(rel, e.name);
    if (e.isDirectory()) Object.assign(out, snapshot(dir, r));
    else out[r] = `${createHash('sha256').update(readFileSync(join(dir, r))).digest('hex')} ${statSync(join(dir, r)).mtimeMs}`;
  }
  return out;
}

/** The fake owner: main repo M, project P (a linked worktree of M, like ~/src/worka-cc-rail-agreed), and a store whose
 *  runs r1 (feat/x) and r2 (feat/y) each own a worktree under the store and a branch in M. */
let owners = 0;
function fakeOwner() {
  const base = join(scratch, `o${++owners}`);
  const realHome = join(base, 'owner');
  const realStore = join(realHome, '.worca-cc');
  const main = join(base, 'src', 'main-repo');
  const proj = join(base, 'src', 'main-repo-proj');
  mkdirSync(main, { recursive: true });
  git(main, 'init', '-q', '-b', 'main');
  writeFileSync(join(main, 'README.md'), '# real\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'one');
  git(main, 'worktree', 'add', '-q', '-b', 'dev', proj);
  const wt = (id, branch) => {
    const dir = join(realStore, 'runs', id, 'repos', 'proj');
    mkdirSync(join(realStore, 'runs', id, 'repos'), { recursive: true });
    git(proj, 'worktree', 'add', '-q', '-b', branch, dir, 'dev');
    writeFileSync(join(realStore, 'runs', id, 'run.json'), JSON.stringify({ runRoot: join(realStore, 'runs', id), repos: [{ projectDir: proj, worktreeDir: dir }] }));
    return dir;
  };
  const w1 = wt('r1', 'feat/x');
  const w2 = wt('r2', 'feat/y');
  git(main, 'branch', 'keep/other');
  process.env.WORCA_HOME = realHome;
  _resetForTests();
  const key = projectKey(proj);
  writeStoreMeta(key, 'project', { key, name: 'Proj', path: proj });
  seedPipelineRow({ id: 'r1', projectKey: key, title: 'one', status: 'done', baseName: 'one', datePrefix: '16-11-26', branch: { source: 'dev', feature: 'feat/x', worktreeDir: w1 } });
  seedPipelineRow({ id: 'r2', projectKey: key, title: 'two', status: 'done', baseName: 'two', datePrefix: '16-11-26', branch: { source: 'dev', feature: 'feat/y', worktreeDir: w2 } });
  _resetForTests();
  delete process.env.WORCA_HOME;
  return { realHome, realStore, main, proj, key, w1, w2 };
}

/** Everything about the real repo a delete could change: refs, the worktree list, the admin files, every file's bytes. */
const realState = (o) => ({
  refs: git(o.main, 'for-each-ref'),
  worktrees: git(o.main, 'worktree', 'list', '--porcelain'),
  mainFiles: snapshot(o.main),
  projFiles: snapshot(o.proj),
  store: snapshot(o.realStore),
});

test('PLAN-Gc C1: archive and delete of copied runs on A act on the copy only; the owner\'s real repo, worktrees and store are unchanged', { skip: posixOnly, timeout: 120000 }, async () => {
  const o = fakeOwner();
  const before = realState(o);
  const [a] = planInstances(parseArgs(['start', 'A', '--root', join(scratch, 'gates')]), { realHome: o.realHome, tmp: scratch });
  await prepareHome(a, { realHome: o.realHome });
  assert.deepEqual(verifyIsolation(a.home), [], 'nothing the copy names leads outside its HOME');

  // the server's view of the copy: its env puts the store at HOME/.worca-cc (WORCA_HOME is the base, as the owner's is)
  process.env.WORCA_HOME = buildInstanceEnv(a, {}).WORCA_HOME;
  _resetForTests();
  try {
    assert.equal(worcaHome(), join(a.home, '.worca-cc'), 'the instance server opens the copied store');
    const s1 = (await readPipelineByKey(o.key, 'r1')).state;
    assert.ok(s1.projectDir.startsWith(a.home + '/'), `copied projectDir ${s1.projectDir} is inside the instance HOME`);
    assert.ok(s1.branch.worktreeDir.startsWith(a.home + '/'), `copied worktreeDir ${s1.branch.worktreeDir} is inside the instance HOME`);
    const copyProj = s1.projectDir;
    assert.match(git(copyProj, 'for-each-ref', '--format=%(refname:short)'), /feat\/x/);

    // what the runs routes call: archive (POST …/archive) and delete (purge)
    const archived = await archivePipeline({ key: o.key, id: 'r1' });
    assert.equal(archived.branch, 'feat/x', 'the archive really deleted a branch (in the copy)');
    assert.equal(archived.warnings.filter((w) => /branch|worktree/.test(w)).length, 0, archived.warnings.join('; '));
    const deleted = await purgePipeline({ key: o.key, id: 'r2' });
    assert.equal(deleted.deleted, true);
    const copyRefs = git(copyProj, 'for-each-ref', '--format=%(refname:short)');
    assert.doesNotMatch(copyRefs, /feat\/x|feat\/y/, 'both branches are gone from the copy');
    assert.match(copyRefs, /keep\/other/);
    assert.ok(!existsSync(s1.branch.worktreeDir), 'the copied worktree is gone');
  } finally {
    _resetForTests();
    delete process.env.WORCA_HOME;
  }

  const afterState = realState(o);
  assert.equal(afterState.refs, before.refs, 'the real repo\'s branches are untouched');
  assert.equal(afterState.worktrees, before.worktrees, 'the real repo\'s worktree list is untouched');
  assert.deepEqual(afterState.mainFiles, before.mainFiles, 'every file of the real main repo (.git included) is byte-identical with its mtime');
  assert.deepEqual(afterState.projFiles, before.projFiles, 'the real project worktree is byte-identical');
  assert.deepEqual(afterState.store, before.store, 'the real store is byte-identical');
  assert.ok(existsSync(o.w1) && existsSync(o.w2), 'the real run worktrees still exist');
});

test('PLAN-Gc C1: a copy that names a path outside its HOME is refused before anything starts, and says which', { skip: posixOnly, timeout: 120000 }, async () => {
  const o = fakeOwner();
  const root = join(scratch, 'gates-refuse');
  const [a] = planInstances(parseArgs(['start', 'A', '--root', root]), { realHome: o.realHome, tmp: scratch });
  await prepareHome(a, { realHome: o.realHome });

  // a record pointed back at the real project (as an unrewritten copy would be)
  const db = new DatabaseSync(join(a.home, '.worca-cc', 'worca-cc.db'));
  const meta = db.prepare('SELECT key, data FROM store_meta').get();
  db.prepare('UPDATE store_meta SET data = ? WHERE key = ?').run(JSON.stringify({ ...JSON.parse(meta.data), path: o.proj }), meta.key);
  db.close();
  assert.ok(verifyIsolation(a.home).some((v) => v.includes(o.proj)), verifyIsolation(a.home).join('\n'));
  await assert.rejects(prepareHome(a, { realHome: o.realHome }), (e) => e.code === 'copy-not-isolated' && e.message.includes(o.proj));
  const out = [], err = [];
  assert.equal(await main(['start', 'A', '--root', root], { out: (l) => out.push(l), err: (l) => err.push(l), realHome: o.realHome, tmp: scratch, serverPath: '/nonexistent' }), 2);
  assert.match(err.join('\n'), /^copy-not-isolated: .*outside/);
  assert.ok(!existsSync(join(a.home, 'gate-instance.json')), 'no server was started');

  // a copied worktree whose .git file leads into the real repo is refused too
  const [b] = planInstances(parseArgs(['start', 'B', '--root', root]), { realHome: o.realHome, tmp: scratch });
  await prepareHome(b, { realHome: o.realHome });
  const dotGit = join(b.home, '.worca-cc', 'runs', 'r1', 'repos', 'proj', '.git');
  assert.doesNotMatch(readFileSync(dotGit, 'utf8'), new RegExp(o.main), 'the copied worktree leads to the copied repo');
  writeFileSync(dotGit, readFileSync(join(o.w1, '.git'), 'utf8'));
  await assert.rejects(prepareHome(b, { realHome: o.realHome }), (e) => e.code === 'copy-not-isolated' && e.message.includes(o.main));
});
