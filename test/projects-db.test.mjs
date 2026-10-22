// test/projects-db.test.mjs
// projects.mjs persists the named-project registry in SQLite (table: projects).
// Signatures are unchanged (listProjects/addProject/removeProject stay async and
// return the SAME annotated shapes). Each test gets a throwaway WORCA_HOME and
// resets the DB singleton so getDb() reopens against it.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { addProject, removeProject, listProjects, insertProject, getProjectByPath, displayPath,
  getProjectByName, ownsProjectFolder, removeProjectAndFolder, enclosingRepoOf, worcaNestedRepoOf, nestedInRepoMessage,
  worcaNestedRepoHint } from '../src/core/projects.mjs';
import { createProject } from '../src/core/project-create.mjs';
import { checkRows } from './helpers/rows.mjs';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, writeFileSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { templateRepo } from './helpers/git-dir.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';

const homes = [];
async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-projdb-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
  return dir;
}
beforeEach(freshHome);
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

test('listProjects returns [] when the projects table is empty', async () => {
  assert.deepEqual(await listProjects(), []);
});

test('listProjects reads rows from the DB and recomputes exists on read', async () => {
  const home = homes[homes.length - 1];
  // Insert a row directly (real dir => exists:true) to prove listProjects reads the DB.
  const db = getDb();
  db.prepare('INSERT INTO projects (key, name, path, created_at) VALUES (?, ?, ?, ?)')
    .run('k1', 'demo', home, '2026-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO projects (key, name, path, created_at) VALUES (?, ?, ?, ?)')
    .run('k2', 'ghost', '/no/such/dir/here', '2026-01-02T00:00:00.000Z');
  const list = await listProjects();
  const byName = Object.fromEntries(list.map((p) => [p.name, p]));
  assert.equal(byName.demo.path, home);
  assert.equal(byName.demo.exists, true, 'real dir => exists true (recomputed)');
  assert.equal(byName.ghost.exists, false, 'missing dir => exists false (recomputed)');
  // The returned shape is exactly {key, name, path, exists} — `key` is the registry
  // key (Ask Worca needs it); no other DB-only field leaks.
  assert.deepEqual(Object.keys(byName.demo).sort(), ['exists', 'key', 'name', 'path', 'vcs']);
  assert.equal(byName.demo.vcs, 'git', 'a row inserted without vcs (NULL) reads as git');
});

test('addProject inserts a row keyed by projectKey, returns the annotated list', async () => {
  const home = homes[homes.length - 1];
  const list = await addProject({ name: 'demo', path: home });
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'demo');
  assert.equal(list[0].path, home);
  assert.equal(list[0].exists, true);
  // Persisted in the DB with a non-empty key + created_at.
  const row = getDb().prepare('SELECT key, name, created_at FROM projects').get();
  assert.ok(row.key && typeof row.key === 'string', 'a projectKey was stored');
  assert.ok(row.created_at, 'created_at stamped');
});

test('addProject rejects a duplicate name case-insensitively', async () => {
  const home = homes[homes.length - 1];
  await addProject({ name: 'Demo', path: home });
  await assert.rejects(() => addProject({ name: 'demo', path: home }), /already exists/);
  // Only one row persisted.
  const { n } = getDb().prepare('SELECT COUNT(*) AS n FROM projects').get();
  assert.equal(n, 1);
});

test('addProject requires name + path and rejects a file path', async () => {
  const home = homes[homes.length - 1];
  await assert.rejects(() => addProject({ name: '', path: home }), /name is required/);
  await assert.rejects(() => addProject({ name: 'x', path: '' }), /path is required/);
  const file = join(home, 'afile.txt');
  await writeFile(file, 'x', 'utf8');
  await assert.rejects(() => addProject({ name: 'f', path: file }), /not a directory/);
});

test('addProject accepts a non-existent path and flags it missing', async () => {
  const list = await addProject({ name: 'ghost', path: '/no/such/dir/here' });
  assert.equal(list[0].exists, false);
});

test('removeProject deletes case-insensitively; an absent name is a no-op', async () => {
  const home = homes[homes.length - 1];
  await addProject({ name: 'Demo', path: home });
  let list = await removeProject('demo'); // case-insensitive match
  assert.deepEqual(list, []);
  list = await removeProject('nope'); // no-op
  assert.deepEqual(list, []);
});

test('two projects with the SAME path collapse to one key (PK), latest name wins on re-add', async () => {
  // projectKey(path) is deterministic, so re-adding the same path under a new name
  // would collide on the PK. addProject guards on name first; a same-name re-add is
  // a duplicate-name error, and a different-name same-path add must not crash.
  const home = homes[homes.length - 1];
  await addProject({ name: 'one', path: home });
  // Different name, same path -> same projectKey. The name check passes (different
  // name), so the INSERT would hit the PK. We expect a clean error, not a crash.
  await assert.rejects(() => addProject({ name: 'two', path: home }), /already (exists|registered)/i);
});

const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const mk = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); made.push(d); return d; };
const repoOf = (tag, o) => { const d = templateRepo(tag, o); made.push(d); return d; };

test('vcs is detected once at add time; getProjectByPath finds the stored row; an explicit vcs is validated', async () => {
  const plain = mk('worca-projdb-plain-');
  const repo = repoOf('projdb', { branch: 'main', user: true, files: { 'a.txt': 'a\n' } });
  await addProject({ name: 'plain', path: plain });
  await addProject({ name: 'repo', path: repo });
  assert.deepEqual(Object.fromEntries((await listProjects()).map((p) => [p.name, p.vcs])), { plain: 'none', repo: 'git' });
  assert.equal(getProjectByPath(plain).name, 'plain');
  assert.equal(getProjectByPath(join(plain, '.')).vcs, 'none');
  assert.equal(getProjectByPath(join(plain, 'nope')), null);
  mkdirSync(join(plain, '.git'));                                  // never re-inferred
  assert.equal(getProjectByPath(plain).vcs, 'none');
  const gitted = mk('worca-projdb-gitted-'); mkdirSync(join(gitted, '.git'));   // P2: git init, then register
  await addProject({ name: 'gitted', path: gitted });
  assert.equal(getProjectByPath(gitted).vcs, 'git');
  assert.equal(typeof displayPath(plain), 'string');
  assert.throws(() => insertProject({ name: 'bad', path: mk('worca-projdb-bad-'), vcs: 'svn' }), /vcs must be "git" or "none"/);
  const later = join(mk('worca-projdb-later-'), 'not-yet');      // registered before it exists
  assert.equal((await addProject({ name: 'later', path: later })).find((p) => p.name === 'later').vcs, 'git', 'its first run creates and git-inits it, as today');
});

test('POSIX: getProjectByPath matches through a symlinked path', { skip: process.platform === 'win32' }, async () => {
  const real = mk('worca-projdb-real-');
  const link = join(mk('worca-projdb-link-'), 'l'); symlinkSync(real, link);
  await addProject({ name: 'real', path: real });
  assert.equal(getProjectByPath(link)?.name, 'real');
});

test('R8: a Folder inside a git work tree is refused — git on (rev-parse) and git missing (stat walk, S53)', async () => {
  const outer = repoOf('projdb-outer', { branch: 'main', user: true, files: { 'o.txt': 'o\n' } });
  const inner = join(outer, 'inner'); mkdirSync(inner);
  await assert.rejects(addProject({ name: 'inner', path: inner }),
    (e) => e.code === 'NESTED_IN_REPO' && e.message === 'Inside a git repository' && e.partOf === null && typeof e.repoRoot === 'string');
  await addProject({ name: 'outer', path: outer });
  await assert.rejects(addProject({ name: 'inner', path: inner }), (e) => e.code === 'NESTED_IN_REPO' && e.message === 'Part of outer' && e.partOf === 'outer');
  const restore = withNoGit();                                                   // P0 helper (S24): WORCA_GIT=0 + a stored "missing" state
  try {
    await assert.rejects(addProject({ name: 'inner2', path: inner }),          // S53: the nearest ancestor with .git decides
      (e) => e.code === 'NESTED_IN_REPO' && e.message === 'Part of outer' && e.partOf === 'outer');
    const loose = join(mk('worca-projdb-fake-'), 'sub'); mkdirSync(join(loose, '..', '.git')); mkdirSync(loose);
    await assert.rejects(addProject({ name: 'loose', path: loose }), (e) => e.code === 'NESTED_IN_REPO' && e.message === 'Inside a git repository');
    const free = mk('worca-projdb-free-');
    assert.equal((await addProject({ name: 'free', path: free })).find((p) => p.name === 'free').vcs, 'none');
  } finally { restore(); }
});

test('a nested path is refused whatever its kind: a missing path inside a repository, an explicit vcs git', async () => {
  const outer = repoOf('projdb-outer2', { branch: 'main', user: true, files: { 'o.txt': 'o\n' } });
  const later = join(outer, 'later');                       // does not exist yet
  await assert.rejects(addProject({ name: 'later', path: later }),
    (e) => e.code === 'NESTED_IN_REPO' && e.message === 'Inside a git repository' && e.repoRoot === realpathSync(outer));
  assert.equal(existsSync(later), false, 'nothing is created');
  const inner = join(outer, 'inner2'); mkdirSync(inner);
  await assert.rejects(addProject({ name: 'inner2', path: inner, vcs: 'git' }), (e) => e.code === 'NESTED_IN_REPO');
});

test('enclosingRepoOf / worcaNestedRepoOf / the two messages', async () => {
  const outer = repoOf('projdb-outer3', { branch: 'main', user: true, files: { 'o.txt': 'o\n' } });
  const root = realpathSync(outer);
  assert.deepEqual(enclosingRepoOf(join(outer, 'a', 'b')), { repoRoot: root, partOf: null }, 'a missing path: its nearest existing ancestor');
  assert.equal(enclosingRepoOf(outer), null, 'the repository top is not nested');
  // A folder an older worca git-inited inside the repository.
  const made = join(outer, 'made'); mkdirSync(made);
  const g = (args) => spawnSync('git', args, { cwd: made });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 'orchestrator@local']); g(['config', 'user.name', 'orchestrator']);
  g(['commit', '-q', '--allow-empty', '-m', 'orchestrator: initial checkpoint']);
  assert.deepEqual(worcaNestedRepoOf(made), { repoRoot: root, partOf: null });
  assert.equal(enclosingRepoOf(made), null, 'it is its own repository now');
  // The user's own nested repository (no worca identity) is not reported.
  const mine = join(outer, 'mine'); mkdirSync(mine);
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: mine });
  assert.equal(worcaNestedRepoOf(mine), null);
  // A worca-inited repository with no parent repository is not reported either.
  const lone = mkdtempSync(join(tmpdir(), 'projdb-lone-'));
  spawnSync('git', ['init', '-q'], { cwd: lone }); spawnSync('git', ['config', 'user.email', 'orchestrator@local'], { cwd: lone });
  assert.equal(worcaNestedRepoOf(lone), null);
  rmSync(lone, { recursive: true, force: true });
  assert.equal(nestedInRepoMessage('/w/r/svc', { repoRoot: '/w/r', partOf: null }),
    '/w/r/svc is inside the git repository at /w/r. Worca runs only on the top folder of a git repository. Add /w/r as a project and run there.');
  assert.equal(nestedInRepoMessage('/w/r/svc', { repoRoot: '/w/r', partOf: 'r' }),
    '/w/r/svc is inside the project "r" (/w/r). Worca runs only on the top folder of a git repository. Run on "r" instead.');
  assert.match(worcaNestedRepoHint(made, { repoRoot: root }), /An older Worca created it\..*delete it, remove this project from Worca, then add /s);
});

// Remove takes the folder only when worca owns it: a Folder project directly in <worcaHome>/projects.
const LINK = process.platform === 'win32' ? 'junction' : 'dir';
const named = async (name) => (await listProjects()).find((p) => p.name === name);

test('getProjectByName: the stored row, case-insensitive (the match removeProject deletes by); null when absent', async () => {
  const home = homes[homes.length - 1];
  await addProject({ name: 'Demo', path: home });
  const row = getProjectByName('  DEMO ');
  assert.deepEqual({ name: row.name, path: row.path, vcs: row.vcs }, { name: 'Demo', path: home, vcs: 'none' });
  assert.equal(typeof row.key, 'string');
  assert.equal(getProjectByName('nope'), null);
  assert.equal(getProjectByName(''), null);
});

test('removeProjectAndFolder: worca\'s own Folder projects go with their folder; every other folder stays', async () => {
  const home = homes[homes.length - 1];
  const pf = join(home, '.worca-cc', 'projects');                   // worcaProjectsFolder() under this WORCA_HOME
  mkdirSync(pf, { recursive: true });
  const dir = (n) => { const d = join(pf, n); mkdirSync(d); return d; };
  const outside = mkdtempSync(join(tmpdir(), 'worca-cc-projdb-out-')); homes.push(outside);
  writeFileSync(join(outside, 'keep.txt'), 'k');
  await checkRows([
    { name: 'eligible: the folder and every file in it are deleted after the row; a symlink inside is unlinked, never followed', run: async () => {
      const site = dir('site');
      writeFileSync(join(site, 'a.txt'), 'x'); mkdirSync(join(site, 'sub')); writeFileSync(join(site, 'sub', 'b.txt'), 'y');
      symlinkSync(outside, join(site, 'out-link'), LINK);
      await addProject({ name: 'Site', path: site });
      assert.equal(ownsProjectFolder(await named('Site')), true);
      const out = await removeProjectAndFolder('site');
      assert.deepEqual(out.folder, { path: site, deleted: true });
      assert.equal(out.removed.name, 'Site');
      assert.equal(existsSync(site), false);
      assert.equal(existsSync(join(outside, 'keep.txt')), true, 'the link target is untouched');
      assert.equal((await listProjects()).some((p) => p.name === 'Site'), false);
    } },
    { name: 'the row is gone before the folder is touched; a failed delete is reported and the folder left on disk', run: async () => {
      const kept = dir('kept'); writeFileSync(join(kept, 'a.txt'), 'x');
      await addProject({ name: 'kept', path: kept });
      let registeredAtDelete = 'not called';
      const out = await removeProjectAndFolder('kept', { removeFolder: async (d) => {
        registeredAtDelete = getProjectByPath(d);
        throw new Error('EBUSY: resource busy or locked');
      } });
      assert.equal(registeredAtDelete, null, 'unregistered first');
      assert.deepEqual(out.folder, { path: kept, deleted: false, error: 'EBUSY: resource busy or locked' });
      assert.equal(existsSync(join(kept, 'a.txt')), true);
      assert.equal((await listProjects()).some((p) => p.name === 'kept'), false, 'still unregistered');
    } },
    { name: 'kept: a Git project in the projects folder, a Folder project outside it, a folder that got a .git since', run: async () => {
      await addProject({ name: 'cloned', path: dir('cloned'), vcs: 'git' });
      await addProject({ name: 'outside', path: outside });
      const later = dir('later');
      await addProject({ name: 'later', path: later });
      mkdirSync(join(later, '.git'));                                 // git init by hand after it was added
      for (const name of ['cloned', 'outside', 'later']) {
        const p = await named(name);
        assert.equal(ownsProjectFolder(p), false, name);
        const out = await removeProjectAndFolder(name);
        assert.equal(out.folder, null, name);
        assert.equal(out.removed.name, name, `${name} is still unregistered`);
        assert.equal(existsSync(p.path), true, name);
      }
    } },
    { name: 'kept: a symlink (or junction) in the projects folder is never followed out', run: async () => {
      const target = mkdtempSync(join(tmpdir(), 'worca-cc-projdb-tgt-')); homes.push(target);
      writeFileSync(join(target, 'mine.txt'), 'm');
      const link = join(pf, 'linked');
      symlinkSync(target, link, LINK);
      await addProject({ name: 'linked', path: link, vcs: 'none' });
      assert.equal(ownsProjectFolder(await named('linked')), false);
      assert.equal((await removeProjectAndFolder('linked')).folder, null);
      assert.equal(existsSync(join(target, 'mine.txt')), true);
      assert.equal(lstatSync(link).isSymbolicLink(), true, 'the link itself stays too');
    } },
    { name: 'kept: a symlink (or junction) in the projects folder to a sibling folder there — real path a direct child, still a link', run: async () => {
      const real = dir('real'); writeFileSync(join(real, 'mine.txt'), 'm');
      const alias = join(pf, 'alias');
      symlinkSync(real, alias, LINK);
      await addProject({ name: 'alias', path: alias, vcs: 'none' });
      assert.equal(ownsProjectFolder(await named('alias')), false);
      assert.equal((await removeProjectAndFolder('alias')).folder, null);
      assert.equal(existsSync(join(real, 'mine.txt')), true);
      assert.equal(lstatSync(alias).isSymbolicLink(), true, 'the link itself stays too');
    } },
    { name: 'kept: the projects folder itself, the Worca home and the folder holding it', run: async () => {
      await addProject({ name: 'pf', path: pf, vcs: 'none' });
      await addProject({ name: 'wh', path: join(home, '.worca-cc'), vcs: 'none' });
      await addProject({ name: 'base', path: home, vcs: 'none' });
      for (const name of ['pf', 'wh', 'base']) {
        const p = await named(name);
        assert.equal(ownsProjectFolder(p), false, name);
        assert.equal((await removeProjectAndFolder(name)).folder, null, name);
        assert.equal(existsSync(p.path), true, name);
      }
    } },
    { name: 'kept: a project New made under a custom projects root (WORCA_PROJECTS_ROOT)', run: async () => {
      const custom = mkdtempSync(join(tmpdir(), 'worca-cc-projdb-root-')); homes.push(custom);
      const prev = process.env.WORCA_PROJECTS_ROOT;
      process.env.WORCA_PROJECTS_ROOT = custom;
      try {
        const { project } = await createProject({ name: 'Custom' });
        assert.equal(dirname(project.path), custom);
        assert.equal(project.vcs, 'none');
        assert.equal(ownsProjectFolder(project), false);
        assert.equal((await removeProjectAndFolder('custom')).folder, null);
        assert.equal(existsSync(project.path), true);
      } finally {
        if (prev === undefined) delete process.env.WORCA_PROJECTS_ROOT; else process.env.WORCA_PROJECTS_ROOT = prev;
      }
    } },
  ]);
});

test('ownsProjectFolder: never the Worca home, even when a projects-folder symlink makes it look like a direct child', async () => {
  const home = homes[homes.length - 1];
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  symlinkSync(home, join(home, '.worca-cc', 'projects'), LINK);      // <worcaHome>/projects → its own grandparent
  await addProject({ name: 'wh', path: join(home, '.worca-cc'), vcs: 'none' });
  assert.equal(ownsProjectFolder(await named('wh')), false);
  assert.equal((await removeProjectAndFolder('wh')).folder, null);
  assert.equal(existsSync(join(home, '.worca-cc')), true);
});
