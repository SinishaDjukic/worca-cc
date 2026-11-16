// test/stillhet-gate-instances-isolation.test.mjs — PLAN-Gc C1 (impl review cycles 1–3): a copied gate instance (A real-old,
// B real-new) can never change the owner's real repos. A fake "real" home holds a main repo, a project that is a linked
// worktree of it, and a store whose two finished runs own a worktree and a branch each. After prepareHome the server's own
// archive and delete (src/core/pipeline-delete.mjs, as the runs routes call them) run on the copy: they remove the copy's
// branches and worktrees, and the real repo's refs, worktree list, admin files and every byte of its files stay the same.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs, planInstances, buildInstanceEnv, prepareHome, verifyIsolation, startInstance, envProblems, writeGitBlockers, main } from '../tools/stillhet-gate-instances.mjs';
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
// a free port per start, so a gate instance already running on its protocol port does not decide the test
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
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
  git(main, 'remote', 'add', 'origin', 'git@github.com:owner/real.git');   // what a real clone has: a GitHub remote
  process.env.WORCA_HOME = realHome;
  _resetForTests();
  const key = projectKey(proj);
  writeStoreMeta(key, 'project', { key, name: 'Proj', path: proj });
  seedPipelineRow({ id: 'r1', projectKey: key, title: 'one', status: 'done', baseName: 'one', datePrefix: '16-11-26', branch: { source: 'dev', feature: 'feat/x', worktreeDir: w1 } });
  seedPipelineRow({ id: 'r2', projectKey: key, title: 'two', status: 'done', baseName: 'two', datePrefix: '16-11-26', branch: { source: 'dev', feature: 'feat/y', worktreeDir: w2 } });
  _resetForTests();
  // an active series with its next occurrence, a paused one, and a one-off run waiting for its time
  const db = new DatabaseSync(join(realStore, 'worca-cc.db'));
  const now = new Date().toISOString(), soon = new Date(Date.now() + 60000).toISOString();
  const sch = db.prepare("INSERT INTO schedules (id, title, project_key, project_dir, request, rule, status, next_run_at, created_at, updated_at) VALUES (?, 't', ?, ?, '{}', '{}', ?, ?, ?, ?)");
  sch.run('sch_on', key, proj, 'active', soon, now, now);
  sch.run('sch_off', key, proj, 'paused', null, now, now);
  const tk = db.prepare("INSERT INTO scheduled_runs (id, schedule_id, project_key, project_dir, run_at, request, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '{}', 'scheduled', ?, ?)");
  tk.run('t_series', 'sch_on', key, proj, soon, now, now);
  tk.run('t_once', null, key, proj, soon, now, now);
  db.close();
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
  assert.equal(await main(['start', 'A', '--root', root, '--port', `A=${await freePort()}`], { out: (l) => out.push(l), err: (l) => err.push(l), realHome: o.realHome, tmp: scratch, serverPath: '/nonexistent' }), 2);
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

const pushUrls = (repo) => git(repo, 'config', '--get-all', 'remote.origin.pushurl').split('\n');
const sqlite = (home) => new DatabaseSync(join(home, '.worca-cc', 'worca-cc.db'));

test('PLAN-Gc owner decision 1: every copied schedule is off in the copy, the real ones stay on, and a start with a copied schedule on is refused', { skip: posixOnly, timeout: 120000 }, async () => {
  const o = fakeOwner();
  const root = join(scratch, 'gates-sched');
  const [a] = planInstances(parseArgs(['start', 'A', '--root', root]), { realHome: o.realHome, tmp: scratch });
  await prepareHome(a, { realHome: o.realHome });
  let db = sqlite(a.home);
  const rows = db.prepare('SELECT id, status, next_run_at FROM schedules ORDER BY id').all().map((r) => ({ ...r }));
  const tickets = db.prepare('SELECT id, status FROM scheduled_runs ORDER BY id').all().map((r) => ({ ...r }));
  db.close();
  assert.deepEqual(rows, [{ id: 'sch_off', status: 'paused', next_run_at: null }, { id: 'sch_on', status: 'paused', next_run_at: null }]);
  assert.deepEqual(tickets, [{ id: 't_once', status: 'canceled' }, { id: 't_series', status: 'canceled' }]);
  const real = new DatabaseSync(join(o.realStore, 'worca-cc.db'), { readOnly: true });
  assert.equal(real.prepare("SELECT status FROM schedules WHERE id = 'sch_on'").get().status, 'active', 'the owner\'s schedule is untouched');
  real.close();
  assert.deepEqual(verifyIsolation(a.home), []);

  // a schedule made later inside the instance is its own business
  db = sqlite(a.home);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO schedules (id, request, rule, status, created_at, updated_at) VALUES ('sch_new', '{}', '{}', 'active', ?, ?)").run(now, now);
  db.prepare("INSERT INTO scheduled_runs (id, schedule_id, run_at, request, status, created_at, updated_at) VALUES ('t_new', 'sch_new', ?, '{}', 'scheduled', ?, ?)").run(now, now, now);
  db.close();
  assert.deepEqual(verifyIsolation(a.home), [], 'a schedule created in the instance does not refuse a start');

  // a copied schedule turned back on (or a copied run waiting again) refuses the next start
  db = sqlite(a.home);
  db.prepare("UPDATE schedules SET status = 'active' WHERE id = 'sch_on'").run();
  db.prepare("UPDATE scheduled_runs SET status = 'scheduled' WHERE id = 't_once'").run();
  db.close();
  const bad = verifyIsolation(a.home);
  assert.ok(bad.includes('schedule sch_on enabled'), bad.join('\n'));
  assert.ok(bad.includes('scheduled run t_once pending'), bad.join('\n'));
  await assert.rejects(prepareHome(a, { realHome: o.realHome }), (e) => e.code === 'copy-not-isolated' && e.message.includes('schedule sch_on enabled'));
  const err = [];
  assert.equal(await main(['start', 'A', '--root', root, '--port', `A=${await freePort()}`], { out: () => {}, err: (l) => err.push(l), realHome: o.realHome, tmp: scratch, serverPath: '/nonexistent' }), 2);
  assert.match(err.join('\n'), /^copy-not-isolated: .*schedule sch_on enabled/);
  assert.ok(!existsSync(join(a.home, 'gate-instance.json')), 'no server was started');
});

test('PLAN-Gc owner decision 2: every clone in the copy pushes to HOME/outside (fetch URL kept); a push URL outside HOME refuses the start', { skip: posixOnly, timeout: 120000 }, async () => {
  const o = fakeOwner();
  const root = join(scratch, 'gates-push');
  const [b] = planInstances(parseArgs(['start', 'B', '--root', root]), { realHome: o.realHome, tmp: scratch });
  await prepareHome(b, { realHome: o.realHome });
  const clones = readdirSync(join(b.home, 'repos')).flatMap((h) => readdirSync(join(b.home, 'repos', h)).map((n) => join(b.home, 'repos', h, n)));
  assert.ok(clones.length >= 1);
  const noPush = join(b.home, 'outside', 'no-push');
  for (const c of clones) {
    assert.equal(git(c, 'remote', 'get-url', 'origin'), 'git@github.com:owner/real.git', 'fetch still goes to the real remote');
    assert.equal(git(c, 'remote', 'get-url', '--push', 'origin'), noPush, 'a push can only go to a path that never exists');
    assert.deepEqual(pushUrls(c), [noPush]);
  }
  assert.ok(!existsSync(noPush));
  // a push from the copy fails and reaches nothing
  const wt = join(b.home, '.worca-cc', 'runs', 'r1', 'repos', 'proj');
  const r = spawnSync('git', ['-C', wt, 'push', 'origin', 'feat/x'], { encoding: 'utf8', env: buildInstanceEnv(b, GIT_ENV) });
  assert.notEqual(r.status, 0, 'git push from a copied worktree fails');
  // an explicit push to GitHub by URL fails over every transport, without the network: ssh is blocked, the URL is rewritten
  writeGitBlockers(b.home);
  const env = buildInstanceEnv(b, GIT_ENV);
  assert.deepEqual(envProblems(env, b.home), []);
  for (const url of ['git@github.com:x/y.git', 'https://github.com/x/y.git', 'ssh://git@github.com/x/y.git']) {
    const p = spawnSync('git', ['-C', wt, 'push', url, 'feat/x'], { encoding: 'utf8', env, timeout: 20000 });
    assert.notEqual(p.status, 0, `git push ${url} fails`);
    assert.match(p.stderr, /outside\/no-https/, `${url} was rewritten into HOME/outside: ${p.stderr}`);
  }
  const ssh = spawnSync('git', ['-C', wt, 'ls-remote', 'git@example.com:x/y.git'], { encoding: 'utf8', env, timeout: 20000 });
  assert.notEqual(ssh.status, 0);
  assert.match(ssh.stderr, /gate instance: ssh blocked/, 'any ssh transport hits the blocker');
  assert.equal(git(o.main, 'config', '--get-all', 'remote.origin.url'), 'git@github.com:owner/real.git', 'the real repo\'s remote is untouched');
  assert.throws(() => git(o.main, 'config', '--get', 'remote.origin.pushurl'), 'the real repo got no pushurl');
  assert.deepEqual(verifyIsolation(b.home), []);

  // a real-looking push URL on a clone refuses the start, naming it
  git(clones[0], 'remote', 'set-url', '--push', 'origin', 'https://github.com/owner/real.git');
  const bad = verifyIsolation(b.home);
  assert.ok(bad.some((v) => v.includes('push') && v.includes('https://github.com/owner/real.git')), bad.join('\n'));
  await assert.rejects(prepareHome(b, { realHome: o.realHome }), (e) => e.code === 'copy-not-isolated' && e.message.includes('https://github.com/owner/real.git'));
  // a second remote added with only a fetch URL pushes there too: refused
  git(clones[0], 'remote', 'set-url', '--push', 'origin', noPush);
  git(clones[0], 'remote', 'add', 'upstream', 'https://github.com/other/real.git');
  assert.ok(verifyIsolation(b.home).some((v) => v.includes('upstream') && v.includes('https://github.com/other/real.git')));
});

test('PLAN-Gc safety net: the spawned server env carries no GitHub token or SSH agent, and gh and git read their config inside the instance HOME', { skip: posixOnly }, async () => {
  const [a] = planInstances(parseArgs(['start', 'A', '--root', join(scratch, 'gates-env'), '--port', `A=${await freePort()}`]), { realHome: join(scratch, 'nobody'), tmp: scratch });
  const owner = { PATH: process.env.PATH, HOME: '/owner', GH_TOKEN: 'gho_x', GITHUB_TOKEN: 'ghp_x', GH_ENTERPRISE_TOKEN: 'x', SSH_AUTH_SOCK: '/tmp/agent.sock',
    WORCA_GH_WRITE_TOKEN: 'w', GH_CONFIG_DIR: '/owner/.config/gh', GIT_CONFIG_GLOBAL: '/owner/.gitconfig' };
  let spawned = null;
  const fakeSpawn = (_cmd, _args, opts) => { spawned = opts.env; return { pid: 999999, once() {}, unref() {} }; };
  await assert.rejects(startInstance(a, { spawn: fakeSpawn, fetch: async () => ({ ok: true }), ps: () => null, baseEnv: owner, waitMs: 50 }));
  assert.ok(spawned, 'the server was spawned with the instance env');
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'SSH_AUTH_SOCK', 'WORCA_GH_WRITE_TOKEN']) assert.ok(!(k in spawned), `${k} is not passed on`);
  assert.equal(spawned.GH_CONFIG_DIR, join(a.home, '.config', 'gh'));
  assert.equal(spawned.GIT_CONFIG_GLOBAL, join(a.home, '.gitconfig'));
  assert.equal(spawned.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(spawned.GIT_SSH_COMMAND, join(a.home, 'bin', 'no-ssh'));
  assert.equal(spawned.GIT_SSH, join(a.home, 'bin', 'no-ssh'));
  assert.deepEqual(envProblems(spawned, a.home), []);
  // a missing blocker is refused: env not set, script gone, insteadOf rules gone
  assert.ok(envProblems({ ...spawned, GIT_SSH_COMMAND: undefined }, a.home).some((v) => v.includes('GIT_SSH_COMMAND')));
  assert.ok(envProblems({ ...spawned, GIT_SSH: 'ssh' }, a.home).some((v) => v.includes('GIT_SSH ')));
  execFileSync('git', ['config', '--file', spawned.GIT_CONFIG_GLOBAL, '--remove-section', `url.${join(a.home, 'outside', 'no-https')}/`]);
  assert.ok(envProblems(spawned, a.home).some((v) => v.includes('insteadOf rule for git@github.com:')));
  rmSync(join(a.home, 'bin', 'no-ssh'));
  assert.ok(envProblems(spawned, a.home).some((v) => v.includes('ssh blocker') && v.includes('missing')));
  // the check itself refuses an env that still carries one
  assert.ok(envProblems({ ...spawned, GH_TOKEN: 'x' }, a.home).some((v) => v.includes('GH_TOKEN')));
  assert.ok(envProblems({ ...spawned, GH_CONFIG_DIR: '/owner/.config/gh' }, a.home).some((v) => v.includes('GH_CONFIG_DIR')));
  // gh, where installed, finds no login under that env
  const gh = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', env: spawned, timeout: 20000 });
  if (!gh.error) assert.notEqual(gh.status, 0, 'gh has no GitHub login in the instance');
});
