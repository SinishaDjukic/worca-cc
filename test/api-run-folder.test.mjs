// test/api-run-folder.test.mjs — starts from a copy of test/api-run-auto.test.mjs's boot preamble (WORCA_MOCK=1, the
// in-process server, `runs` from the module, its `api(method, path, body)` helper). Then:
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { setHumanInLoop } from '../src/core/config.mjs';
import { projectKey } from '../src/core/store.mjs';
import { gitState, _testing as gitTesting } from '../src/core/git-available.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

useTempHome(after);
let homeDir, srv, base, prevHome, runs, T;
before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-runauto-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  runs = mod.runs;
  T = mod._testing;
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
const projects = [];
const runDir = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-runauto-proj-')); projects.push(d); return d; };
function gitInit(dir) {
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'README.md'), '# x\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
}
after(() => Promise.all(projects.map((d) => rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }))));
const api = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const dirs = []; after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const plain = (files) => { const d = mkdtempSync(join(tmpdir(), 'worca-runfolder-')); dirs.push(d);
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(d, rel), text); return d; };
const stopRun = async (runId) => { await api('POST', '/api/stop', { runId }); await runs.get(runId).launch; };

test('a registered Folder project starts a folder run; branch fields are ignored; projectDir stays the real folder', async () => {
  const dir = plain({ 'a.txt': 'a\n' });
  await api('POST', '/api/projects', { name: 'site', path: dir });
  const r = await api('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true, sourceBranch: 'main', syncBeforeStart: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const entry = runs.get(r.body.runId);
  assert.deepEqual([entry.orch.workMode, entry.projectDir], ['folder', dir]);
  assert.equal(T.summarizeRuns().find((x) => x.runId === r.body.runId).workMode, 'folder', 'hello runs[] name the mode (P1b S1)');
  await stopRun(r.body.runId);
  assert.equal(existsSync(join(dir, '.git')), false);
});

test('S52: with git missing, a project registered at a nested path keeps its stored key for a run', async () => {
  const outer = plain({ 'o.txt': 'o\n' }); mkdirSync(join(outer, '.git')); writeFileSync(join(outer, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const inner = join(outer, 'inner'); mkdirSync(inner); writeFileSync(join(inner, 'n.txt'), 'n\n');
  getDb().prepare("INSERT INTO projects (key, name, path, created_at, vcs) VALUES ('inner-0000abcd', 'inner', ?, ?, 'none')").run(inner, new Date().toISOString());
  process.env.WORCA_GIT = '0';
  try {
    await gitState({ fresh: true });
    const r = await api('POST', '/api/run', { projectDir: inner, prompt: 'x', mock: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const entry = runs.get(r.body.runId);
    await stopRun(r.body.runId);
    assert.equal(getDb().prepare('SELECT project_key FROM pipelines WHERE id = ?').get(entry.orch.state.id).project_key, 'inner-0000abcd');
  } finally { process.env.WORCA_GIT = '1'; gitTesting.reset(); }
});

test('L4 / S68: an unregistered plain dir keeps git mode while git is installed, and its run keeps projectKey(dir)', async () => {
  const dir = plain({ 'b.txt': 'b\n' });
  const r = await api('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true });
  const entry = runs.get(r.body.runId);
  assert.equal(entry.orch.workMode, 'git');
  await stopRun(r.body.runId);
  assert.equal(getDb().prepare('SELECT project_key FROM pipelines WHERE id = ?').get(entry.orch.state.id).project_key, projectKey(dir));
});

test('S68: a registered Git project\'s run keeps projectKey(dir), never its stored key, and its state carries no Folder-run keys', async () => {
  const dir = await runDir(); gitInit(dir);
  getDb().prepare("INSERT INTO projects (key, name, path, created_at, vcs) VALUES ('gitreg-0000abcd', 'gitreg', ?, ?, 'git')").run(dir, new Date().toISOString());
  const r = await api('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const entry = runs.get(r.body.runId);
  assert.equal(entry.orch.workMode, 'git');
  assert.deepEqual(['projectKey' in entry.orch.state, 'workMode' in entry.orch.state], [false, false]);
  await stopRun(r.body.runId);
  assert.equal(getDb().prepare('SELECT project_key FROM pipelines WHERE id = ?').get(entry.orch.state.id).project_key, projectKey(dir));
});

test('A-m5: a registered Folder project whose folder is gone is refused, never recreated empty', async () => {
  const dir = plain({ 'e.txt': 'e\n' });
  await api('POST', '/api/projects', { name: 'gone', path: dir });
  rmSync(dir, { recursive: true, force: true });
  const r = await api('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true });
  assert.deepEqual([r.status, r.body.error], [400, `The folder is missing: ${dir}`]);
  assert.equal(existsSync(dir), false);
});

test('U3: an orphan Git project and a workspace of Folder projects run as folders while git is missing', async () => {
  const dir = plain({ 'c.txt': 'c\n' }); mkdirSync(join(dir, '.git')); writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await api('POST', '/api/projects', { name: 'orphan', path: dir });
  const f1 = plain({ 'n1.txt': 'n\n' }); const f2 = plain({ 'n2.txt': 'n\n' });
  await api('POST', '/api/projects', { name: 'u3-notes-1', path: f1 });
  await api('POST', '/api/projects', { name: 'u3-notes-2', path: f2 });
  process.env.WORCA_GIT = '0';
  try {
    await gitState({ fresh: true });
    const r = await api('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true });
    assert.equal(r.status, 200); assert.equal(runs.get(r.body.runId).orch.workMode, 'folder');
    await stopRun(r.body.runId);
    const made = await api('POST', '/api/workspaces', { name: 'U3 Folders', projectPaths: [f1, f2] });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const w = await api('POST', '/api/run', { workspaceId: made.body.workspace.id, prompt: 'x', mock: true });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.deepEqual(runs.get(w.body.runId).orch.workspace.projects.map((p) => p.workMode), ['folder', 'folder']);
    await stopRun(w.body.runId);
  } finally { process.env.WORCA_GIT = '1'; gitTesting.reset(); }
});

test('R6: a folder over the limit is refused with 413 before anything is created', async () => {
  const dir = plain({ a: 'x\n', b: 'x\n', c: 'x\n' });
  await api('POST', '/api/projects', { name: 'big', path: dir });
  const rows = () => getDb().prepare('SELECT COUNT(*) n FROM pipelines').get().n;
  const before = rows();
  process.env.WORCA_FOLDER_MAX_FILES = '2';
  try {
    const r = await api('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true });
    assert.equal(r.status, 413);
    assert.deepEqual(r.body, { error: 'big has 3 files. The limit is 2.', code: 'FOLDER_TOO_BIG', files: 3, bytes: 6,
      limit: { files: 2, bytes: 1_000_000_000 }, limitBytes: 1_000_000_000, over: 'files' });
    assert.equal(rows(), before);
  } finally { delete process.env.WORCA_FOLDER_MAX_FILES; }
});

test('a Folder project run cannot continue from the previous run\'s branch', async () => {
  const dir = plain({ d: 'd\n' }); await api('POST', '/api/projects', { name: 'chain', path: dir });
  const r = await api('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true, after: { kind: 'pipeline', id: 'abcdef12' }, sourceFromPrevious: true });
  assert.deepEqual([r.status, r.body.error], [400, "a Folder project run cannot start from the previous run's branch"]);
});

test('P5: a workspace with a registered Folder member (nested in a repository) starts; that member runs on a copy', async () => {
  const a = templateRepo('ws-a', { branch: 'main', user: true, files: { 'a.txt': 'a\n' } });
  const outer = templateRepo('ws-b', { branch: 'main', user: true, files: { 'b.txt': 'b\n' } });
  dirs.push(a, outer);                                                   // templateRepo copies are the caller's to remove
  const inner = join(outer, 'inner'); mkdirSync(inner); writeFileSync(join(inner, 'n.txt'), 'n\n');
  const now = new Date().toISOString();
  // 'ws-inner': the S52 row above already registered a project named 'inner' (idx_projects_name is UNIQUE, NOCASE)
  getDb().prepare("INSERT INTO projects (key, name, path, created_at, vcs) VALUES ('inner-00000001', 'ws-inner', ?, ?, 'none')").run(inner, now);
  getDb().prepare("INSERT INTO workspaces (id, name, description, created_at, updated_at) VALUES ('wks-mixed-0000000a', 'mixed', '', ?, ?)").run(now, now);
  const m = getDb().prepare('INSERT INTO workspace_projects (workspace_id, project_key, ordinal) VALUES (?, ?, ?)');
  m.run('wks-mixed-0000000a', a, 0); m.run('wks-mixed-0000000a', inner, 1);
  const r = await api('POST', '/api/run', { workspaceId: 'wks-mixed-0000000a', prompt: 'x', mock: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(runs.get(r.body.runId).orch.workspace.projects.map((p) => `${p.projectDir}=${p.workMode ?? 'git'}`).sort(), [`${a}=git`, `${inner}=folder`].sort());
  await stopRun(r.body.runId);
  assert.equal(existsSync(join(inner, '.git')), false);
});

test('a chained ticket after a run on a copy is refused when it fires (Shape-it-first slices, edited schedules)', async () => {
  const dir = plain({ s: 's\n' });
  const { id } = await seedPipeline(dir, { status: 'done', branch: { workMode: 'folder', runRootMode: 'detached' } });
  assert.deepEqual(await T.fireTicket({ after: { kind: 'pipeline', id }, sourceFromPrevious: true, projectDir: dir, request: { projectDir: dir, prompt: 'x', mock: true } }),
    { ok: false, error: "a Folder project run cannot start from the previous run's branch", transient: false });
});

// v5 row: a git-spawn census of the start path. POSIX: a logging `git` first on PATH execs the real one.
test('POSIX: a registered Folder project\'s start runs no git in its folder (sync asked, the members1 gate)', { skip: process.platform === 'win32' }, async () => {
  const real = spawnSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const shim = mkdtempSync(join(tmpdir(), 'worca-runfolder-gitlog-')); dirs.push(shim);
  const log = join(shim, 'calls.tsv');
  writeFileSync(join(shim, 'git'), `#!/bin/sh\nprintf '%s\\t%s\\n' "$PWD" "$*" >> '${log}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const dir = plain({ 'g.txt': 'g\n' });
  await api('POST', '/api/projects', { name: 'census', path: dir });
  const rp = (p) => { try { return realpathSync(p); } catch { return p; } };
  let copy = null;
  const prevPath = process.env.PATH; process.env.PATH = `${shim}:${prevPath}`;
  try {
    const r = await api('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true, syncBeforeStart: true, syncPolicy: 'origin' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    copy = rp(runs.get(r.body.runId).orch.runCwd);
    await stopRun(r.body.runId);
  } finally { process.env.PATH = prevPath; }
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split('\t')) : [];
  const mine = (cwd) => { const c = rp(cwd); return c === rp(dir) || c === copy || c.startsWith(copy + '/'); };
  // canonicalProjectRoot's read-only probe (P0-gated) is the one call allowed there
  assert.deepEqual(calls.filter(([cwd, args]) => mine(cwd) && args !== 'rev-parse --git-common-dir'), [], 'no git in the folder or its copy');
});

test('run-created names the mode of a folder run (P1b S1)', async () => {
  const { WebSocket } = await import('ws');
  const mod = await import('../ui/server.mjs');                   // the WebSocket endpoint lives on the module's own server
  if (!mod.server.listening) await new Promise((r) => mod.server.listen(0, '127.0.0.1', r));
  const ws = new WebSocket(`ws://127.0.0.1:${mod.server.address().port}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const got = []; ws.on('message', (d) => got.push(JSON.parse(String(d))));
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  try {
    const dir = plain({ 'w.txt': 'w\n' });
    await api('POST', '/api/projects', { name: 'announce', path: dir });
    const r = await api('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true });
    const frame = () => got.find((f) => f.type === 'run-created' && f.runId === r.body.runId);
    for (let i = 0; i < 100 && !frame(); i++) await new Promise((res) => setTimeout(res, 20));
    assert.equal(frame()?.workMode, 'folder');
    await stopRun(r.body.runId);
  } finally { ws.close(); await new Promise((r) => mod.server.close(r)); }
});

test('A-m5 by the effective mode: a Git project\'s gone folder is refused while git is missing (never recreated and copied empty)', async () => {
  const dir = plain({ 'h.txt': 'h\n' }); mkdirSync(join(dir, '.git')); writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await api('POST', '/api/projects', { name: 'gone-git', path: dir });
  rmSync(dir, { recursive: true, force: true });
  process.env.WORCA_GIT = '0';
  try {
    await gitState({ fresh: true });
    const r = await api('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true });
    assert.deepEqual([r.status, r.body.error], [400, `The folder is missing: ${dir}`]);
    assert.equal(existsSync(dir), false);
  } finally { process.env.WORCA_GIT = '1'; gitTesting.reset(); }
});
test('#693: a git-mode run in a sub-folder of a repository is refused before any row, with nothing created or git-inited', async () => {
  const outer = templateRepo('nested-run', { branch: 'main', user: true, files: { 'o.txt': 'o\n' } }); dirs.push(outer);
  const inner = join(outer, 'svc'); mkdirSync(inner); writeFileSync(join(inner, 'a.txt'), 'a\n');
  const count = () => getDb().prepare('SELECT COUNT(*) AS n FROM pipelines').get().n;
  const before = count();
  const r = await api('POST', '/api/run', { projectDir: inner, prompt: 'x', mock: true, sourceBranch: 'main' });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, 'NESTED_IN_REPO');
  assert.equal(r.body.repoRoot, realpathSync(outer));
  assert.equal(r.body.error, `${inner} is inside the git repository at ${realpathSync(outer)}. Worca runs only on the top folder of a git repository. Add ${realpathSync(outer)} as a project and run there.`);
  assert.equal(existsSync(join(inner, '.git')), false);
  // A path that does not exist yet inside the repository: refused, and NOT created (the mkdir comes after).
  const later = join(outer, 'later');
  const r2 = await api('POST', '/api/run', { projectDir: later, prompt: 'x', mock: true });
  assert.deepEqual([r2.status, r2.body.code], [400, 'NESTED_IN_REPO']);
  assert.equal(existsSync(later), false);
  assert.equal(count(), before, 'no pipelines row');
});

test('#693: a worca-made nested repository: the unknown-branch 400 says how to fix it, and nothing changes', async () => {
  const outer = templateRepo('nested-made', { branch: 'main', user: true, files: { 'o.txt': 'o\n' } }); dirs.push(outer);
  const inner = join(outer, 'svc'); mkdirSync(inner); writeFileSync(join(inner, 'a.txt'), 'a\n');
  const g = (a) => spawnSync('git', a, { cwd: inner });
  g(['init', '-q', '-b', 'master']); g(['config', 'user.email', 'orchestrator@local']); g(['config', 'user.name', 'orchestrator']);
  g(['add', '-A']); g(['commit', '-qm', 'orchestrator: initial checkpoint']);
  spawnSync('git', ['branch', 'feature-x'], { cwd: outer });         // the user's branch lives only in the outer repo
  const r = await api('POST', '/api/run', { projectDir: inner, prompt: 'x', mock: true, sourceBranch: 'feature-x' });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /^unknown or invalid sourceBranch: feature-x .*An older Worca created it\..*then add /s);
  assert.ok(existsSync(join(inner, '.git')), 'nothing removed');
});

test('#693: a workspace with an unregistered (git-mode) member nested in a repository is refused at start', async () => {
  const a = templateRepo('ws693-a', { branch: 'main', user: true, files: { 'a.txt': 'a\n' } });
  const outer = templateRepo('ws693-b', { branch: 'main', user: true, files: { 'b.txt': 'b\n' } });
  dirs.push(a, outer);                                                   // templateRepo copies are the caller's to remove
  const inner = join(outer, 'svc'); mkdirSync(inner); writeFileSync(join(inner, 'n.txt'), 'n\n');
  const now = new Date().toISOString();
  // Seeded directly, as P5 does: createWorkspace now refuses this member (§4.6). No projects row → git mode.
  getDb().prepare("INSERT INTO workspaces (id, name, description, created_at, updated_at) VALUES ('wks-nested-00000693', 'nested693', '', ?, ?)").run(now, now);
  const m = getDb().prepare('INSERT INTO workspace_projects (workspace_id, project_key, ordinal) VALUES (?, ?, ?)');
  m.run('wks-nested-00000693', a, 0); m.run('wks-nested-00000693', inner, 1);
  const r = await api('POST', '/api/run', { workspaceId: 'wks-nested-00000693', prompt: 'x', mock: true });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, 'NESTED_IN_REPO');
  assert.ok(r.body.error.startsWith(`workspace member ${inner} is inside the git repository at `), r.body.error);
  assert.equal(existsSync(join(inner, '.git')), false);
});
