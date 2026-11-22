// test/branches-api-fresh.test.mjs — GET /api/branches?fresh=1 (#527, plan §5.1): a registered
// project is fetched and gains remote branches + a SyncBlock; an unregistered folder is never
// fetched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';

const home = useTempHome(after, 'worca-cc-branches-fresh-');
const saved = {};
for (const k of ['HOME', 'USERPROFILE', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) saved[k] = process.env[k];
process.env.HOME = home; process.env.USERPROFILE = home;

let srv, base, root, addProject, gitSync;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'branches-fresh-'));
  process.env.GIT_CONFIG_GLOBAL = join(root, 'gitconfig'); process.env.GIT_CONFIG_NOSYSTEM = '1';
  await writeFile(process.env.GIT_CONFIG_GLOBAL, '[user]\n\tname = t\n\temail = t@t\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = dev\n');
  const { app } = await import('../ui/server.mjs');
  ({ addProject } = await import('../src/core/projects.mjs'));
  ({ _testing: gitSync } = await import('../src/core/git-sync.mjs'));
  srv = appServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  gitSync.reset();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true });
});

const g = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
let n = 0;
/** bare origin + clone A (the project) whose teammate pushed a new dev commit and a branch. */
async function world({ register = true } = {}) {
  const dir = join(root, `w${++n}`);
  g(root, 'init', '-q', '--bare', `${dir}-origin.git`);
  g(root, 'clone', '-q', `${dir}-origin.git`, `${dir}-a`);
  await writeFile(join(`${dir}-a`, 'f.txt'), 'one\n');
  g(`${dir}-a`, 'add', '-A'); g(`${dir}-a`, 'commit', '-qm', 'init'); g(`${dir}-a`, 'push', '-q', 'origin', 'dev');
  g(root, 'clone', '-q', `${dir}-origin.git`, `${dir}-b`);
  const b = `${dir}-b`;
  await writeFile(join(b, 't.txt'), 'teammate\n'); g(b, 'add', '-A'); g(b, 'commit', '-qm', 'teammate'); g(b, 'push', '-q', 'origin', 'dev');
  g(b, 'push', '-q', 'origin', 'dev:teammate-only');
  if (register) await addProject({ name: `p${n}`, path: `${dir}-a` });
  return { a: `${dir}-a` };
}
const branches = async (dir, q = '') => (await fetch(`${base}/api/branches?projectDir=${encodeURIComponent(dir)}${q}`)).json();
const fetchHeadMtime = (dir) => stat(join(dir, '.git', 'FETCH_HEAD')).then((s) => s.mtimeMs, () => null);

test('fresh=1 on a registered clone fetches: teammate branch listed, sync behind with incoming commits', async () => {
  const w = await world();
  const j = await branches(w.a, '&fresh=1');
  assert.equal(j.remote.name, 'origin');
  assert.ok(j.remote.branches.includes('teammate-only'));
  assert.ok(j.fetchedAt);
  assert.equal(j.stale, false);
  assert.equal(j.sync.state, 'behind');
  assert.ok(j.sync.incoming.length > 0);
  assert.equal(j.behind, 1);
});

test('fresh=1 on a project with no remote → remote:null', async () => {
  const dir = await mkdtemp(join(root, 'noremote-'));
  g(dir, 'init', '-q'); await writeFile(join(dir, 'a'), 'a'); g(dir, 'add', '-A'); g(dir, 'commit', '-qm', 'init');
  await addProject({ name: `nr${++n}`, path: dir });
  const j = await branches(dir, '&fresh=1');
  assert.equal(j.remote, null);
  assert.equal(j.stale, false);
});

test('fresh=1 on an UNREGISTERED clone never fetches → remote:null, FETCH_HEAD untouched', async () => {
  const w = await world({ register: false });
  const before = await fetchHeadMtime(w.a);
  const j = await branches(w.a, '&fresh=1');
  assert.equal(j.remote, null);
  assert.equal(await fetchHeadMtime(w.a), before);
});

test('fresh=1 when the project registry cannot be read → 200 with local refs and remote:null (never a 500)', async () => {
  const w = await world();
  const prev = process.env.WORCA_HOME;
  const { _resetForTests } = await import('../src/core/db.mjs');
  const bad = join(root, `not-a-dir-${++n}`);
  await writeFile(bad, 'x');                       // WORCA_HOME is a FILE: the DB cannot open
  process.env.WORCA_HOME = bad; _resetForTests();
  try {
    const r = await fetch(`${base}/api/branches?projectDir=${encodeURIComponent(w.a)}&fresh=1`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(j.branches.includes('dev'));
    assert.equal(j.remote, null);
  } finally {
    process.env.WORCA_HOME = prev; _resetForTests();
  }
});
