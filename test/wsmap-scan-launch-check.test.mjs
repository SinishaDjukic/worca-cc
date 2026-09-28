// test/wsmap-scan-launch-check.test.mjs
// Both Workspace scan routes — POST /api/workspaces/scan (first scan) and POST /api/workspaces/:id/scan
// (re-scan) — refuse, before any run starts, every member a read-only scan cannot run over: a folder
// inside another git repository, a repository with no commit. The 400 names each such member and why,
// and every tree stays byte-identical. Plain POST /api/workspaces keeps its contract (any git work
// tree). scanMemberProblems is the check both routes share.
// Mock-driven (WORCA_MOCK=1), chdir-sandboxed, temp WORCA_HOME.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import * as workspaces from '../src/core/workspaces.mjs';

useTempHome(after);

const origCwd = process.cwd();
let cwdSandbox = null;
let homeDir, srv, base, runs, prevHome;
const created = [];

before(async () => {
  cwdSandbox = mkdtempSync(join(tmpdir(), 'worca-cc-wslaunch-cwd-'));
  const g = (a) => spawnSync('git', a, { cwd: cwdSandbox });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(cwdSandbox, 'README.md'), '# sandbox\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  process.chdir(cwdSandbox);
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wslaunch-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  runs = mod.runs;
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const r of runs.values()) {
    try { r.orch && typeof r.orch.stop === 'function' && r.orch.stop(); } catch { /* best-effort */ }
  }
  runs.clear();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  process.chdir(origCwd);
  const RM = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };
  if (cwdSandbox) await rm(cwdSandbox, RM);
  await rm(homeDir, RM);
  await Promise.all(created.map((d) => rm(d, RM)));
});

const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
/** A throwaway repo holding `files` (posix relative paths), committed unless `commit` is false. */
async function repo(label, files, { commit = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), `worca-cc-wslaunch-${label}-`));
  created.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, ...rel.split('/'));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, text);
  }
  if (commit) { git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init'); }
  return dir;
}
/** A monorepo and the folder inside it a user might onboard as a member. */
async function monorepo(label) {
  const mono = await repo(label, { 'README.md': '# mono\n', 'packages/api/package.json': '{"name":"@acme/api"}\n', 'packages/api/src/server.js': "app.get('/users/:id', h);\n" });
  return { mono, sub: join(mono, 'packages', 'api') };
}
/** Everything a scan could change in a tree: each file's bytes (a `.git` only as present), the
 *  status, every commit on every ref, every ref. `.git` internals are not hashed: git status may
 *  refresh the index's stat cache. */
function treeState(dir) {
  const files = [];
  const walk = (abs, rel) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name === '.git') { files.push(`${rel}.git`); continue; }
      if (e.isDirectory()) walk(join(abs, e.name), `${rel}${e.name}/`);
      else files.push(`${rel}${e.name} ${createHash('sha1').update(readFileSync(join(abs, e.name))).digest('hex')}`);
    }
  };
  walk(dir, '');
  const out = (...args) => git(dir, ...args).stdout;
  return { files: files.sort(), status: out('status', '--porcelain=v1', '--untracked-files=all'),
    log: out('log', '--all', '--format=%H %s'), refs: out('for-each-ref', '--format=%(refname) %(objectname)') };
}
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
/** Scan runs registered for these workspace names (a scan's title is `Workspace scan: <name>`). */
const scanRuns = (names) => [...runs.values()].filter((r) => names.some((n) => r.title === `Workspace scan: ${n}`));

test('scanMemberProblems: nothing for repositories with a commit; one line per member that is not its own repository, has no commit or is missing', async () => {
  const { scanMemberProblems } = workspaces;
  assert.equal(typeof scanMemberProblems, 'function', 'workspaces.mjs exports scanMemberProblems');
  const ok = await repo('ok', { 'a.txt': 'a\n' });
  const { sub } = await monorepo('mono');
  const fresh = await repo('fresh', { 'a.txt': 'a\n' }, { commit: false });
  const plain = await mkdtemp(join(tmpdir(), 'worca-cc-wslaunch-plain-'));
  created.push(plain);
  const missing = join(ok, 'missing');
  assert.deepEqual(scanMemberProblems([ok]), []);
  assert.deepEqual(scanMemberProblems([ok, sub, fresh, plain, missing]), [
    `${sub} is not its own git repository`, `${fresh} has no commit`, `${plain} is not its own git repository`, `${missing} does not exist`,
  ]);
});

test('POST /api/workspaces/scan: 400 naming each member inside another repository or without a commit; no run starts, every tree byte-identical', async () => {
  const { mono, sub } = await monorepo('mono');
  const fresh = await repo('fresh', { 'package.json': '{"name":"fresh"}\n', 'notes/private-todo.txt': 'my notes\n' }, { commit: false });
  const ok = await repo('ok', { 'package.json': '{"name":"ok"}\n' });
  const before_ = [treeState(mono), treeState(fresh), treeState(ok)];
  for (const [name, paths, bad, why] of [
    ['Nested', [sub, ok], [sub], /is not its own git repository/],
    ['Fresh', [fresh, ok], [fresh], /has no commit/],
    ['Both', [sub, fresh], [sub, fresh], /is not its own git repository.*has no commit|has no commit.*is not its own git repository/],
  ]) {
    const res = await post('/api/workspaces/scan', { name, projectPaths: paths });
    const body = await res.json();
    assert.equal(res.status, 400, `${name}: ${JSON.stringify(body)}`);
    for (const p of bad) assert.ok(body.error.includes(p), `${name}: names ${p}: ${body.error}`);
    assert.ok(!body.error.includes(ok), `${name}: a good member is not named`);
    assert.match(body.error, why);
  }
  assert.deepEqual(scanRuns(['Nested', 'Fresh', 'Both']), [], 'no scan run started');
  assert.ok(!existsSync(join(sub, '.git')), 'no repository created inside the monorepo');
  assert.deepEqual([treeState(mono), treeState(fresh), treeState(ok)], before_, 'every tree byte-identical');
});

test('POST /api/workspaces/:id/scan: 400 for a workspace whose members a scan cannot run over — plain create keeps accepting them', async () => {
  const { mono, sub } = await monorepo('mono');
  const fresh = await repo('fresh', { 'package.json': '{"name":"fresh"}\n' }, { commit: false });
  const ok1 = await repo('ok', { 'a.txt': 'a\n' });
  const ok2 = await repo('ok', { 'b.txt': 'b\n' });
  for (const [name, paths, bad, why] of [['Plain Nested', [sub, ok1], sub, /is not its own git repository/], ['Plain Fresh', [fresh, ok2], fresh, /has no commit/]]) {
    const cr = await post('/api/workspaces', { name, projectPaths: paths });
    assert.equal(cr.status, 201, `${name}: plain create keeps its contract (any git work tree)`);
    const { workspace } = await cr.json();
    const before_ = paths.map((p) => treeState(p === sub ? mono : p));
    const res = await post(`/api/workspaces/${workspace.id}/scan`, {});
    const body = await res.json();
    assert.equal(res.status, 400, `${name}: ${JSON.stringify(body)}`);
    assert.ok(body.error.includes(bad), `${name}: names ${bad}: ${body.error}`);
    assert.match(body.error, why);
    assert.deepEqual(paths.map((p) => treeState(p === sub ? mono : p)), before_, `${name}: every tree byte-identical`);
  }
  assert.deepEqual(scanRuns(['Plain Nested', 'Plain Fresh']), [], 'no scan run started');
  assert.ok(!existsSync(join(sub, '.git')));
});
