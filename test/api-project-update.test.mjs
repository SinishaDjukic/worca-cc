// PATCH /api/projects/:key {name?, path?} (Stillhet slice 9 D9): a rename keeps the key; a relocate re-keys the project
// in one transaction, moving its configuration and future work (RELOCATE_MOVES) and keeping its history under the old key
// (RELOCATE_KEEPS), with a project_moves alias so a pre-move run still resolves to the new folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after, 'worca-cc-projupd-');
const prevEnv = {};
let sandboxHome, srv, base, mod, P, store, db, seedPipeline, frames = [], sock;
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: JSONH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const listText = async () => JSON.stringify((await call('GET', '/api/projects')).body.projects.map(({ readiness, ...p }) => p));
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-projupd-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  P = await import('../src/core/projects.mjs');
  store = await import('../src/core/store.mjs');
  db = (await import('../src/core/db.mjs')).getDb();
  ({ seedPipeline } = await import('./helpers/db-seed.mjs'));
  sock = new WebSocket(`ws://127.0.0.1:${srv.address().port}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  sock.on('message', (m) => { try { frames.push(JSON.parse(String(m))); } catch { /* not JSON */ } });
  await new Promise((r, j) => { sock.once('open', r); sock.once('error', j); });
});
after(async () => {
  sock?.close();
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(sandboxHome, { recursive: true, force: true });
});

async function addRepo(name) {
  const dir = realpathSync(gitDir(name));
  await P.addProject({ name, path: dir });
  return { dir, key: store.projectKey(dir) };
}
async function newFolder(name) {
  const dir = join(realpathSync(sandboxHome), 'moved', `${name}-${Math.random().toString(16).slice(2, 8)}`);
  await mkdir(dir, { recursive: true });
  return realpathSync(dir);
}

test('rename: keeps the key, emits one projects-changed updated, and history names a run seeded before by the new name', async () => {
  const { dir, key } = await addRepo('rn-one');
  const run = await seedPipeline(dir, { title: 'before the rename', status: 'done' });
  frames = [];
  const r = await call('PATCH', `/api/projects/${key}`, { name: '  Renamed One ' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.project.key, key);
  assert.equal(r.body.project.name, 'Renamed One');
  assert.equal(r.body.previousKey, undefined);
  assert.ok(r.body.projects.some((p) => p.key === key && p.name === 'Renamed One'));
  await settle();
  assert.equal(frames.filter((f) => f.type === 'projects-changed' && f.action === 'updated').length, 1);
  const h = await call('GET', '/api/history');
  assert.equal(h.body.pipelines.find((p) => p.id === run.id)?.projectName, 'Renamed One');
});

test('rename refusals: a duplicate name in any case, an empty or too long name, no field, an unknown key; the list stays byte-equal', async () => {
  const a = await addRepo('rn-a');
  await addRepo('rn-b');
  const before = await listText();
  const dup = await call('PATCH', `/api/projects/${a.key}`, { name: 'RN-B' });
  assert.equal(dup.status, 400);
  assert.equal(dup.body.error, 'a project named "RN-B" already exists');
  assert.equal((await call('PATCH', `/api/projects/${a.key}`, { name: '   ' })).status, 400);
  assert.equal((await call('PATCH', `/api/projects/${a.key}`, { name: 'x'.repeat(81) })).status, 400);
  const none = await call('PATCH', `/api/projects/${a.key}`, {});
  assert.deepEqual([none.status, none.body.error], [400, 'name or path is required']);
  assert.equal((await call('PATCH', '/api/projects/nope-0000abcd', { name: 'x' })).status, 404);
  assert.equal(await listText(), before);
});

test('relocate: re-keys the project, moves RELOCATE_MOVES rows to the new key and folder, keeps history under the old key', async () => {
  const { dir, key } = await addRepo('mv-one');
  const other = await addRepo('mv-peer');
  const to = await newFolder('mv-one-new');
  const newKey = store.projectKey(to);
  const run = await seedPipeline(dir, { title: 'before the move', status: 'done' });
  const t = now();
  db.prepare(`INSERT INTO project_config (project_key, extra) VALUES (?, '{"x":1}') ON CONFLICT(project_key) DO NOTHING`).run(key);
  db.prepare(`INSERT INTO config_workflow_nodes (project_key, workflow_id, node_id) VALUES (?, 'wf', 'n')`).run(key);
  db.prepare(`INSERT INTO schedules (id, project_key, project_dir, request, rule, created_at, updated_at) VALUES ('sch_mv1', ?, ?, ?, '{}', ?, ?)`).run(key, dir, JSON.stringify({ projectDir: dir, prompt: 'p' }), t, t);
  db.prepare(`INSERT INTO scheduled_runs (id, project_key, project_dir, run_at, request, status, created_at, updated_at) VALUES ('tk-due', ?, ?, ?, ?, 'scheduled', ?, ?)`).run(key, dir, t, JSON.stringify({ projectDir: dir, prompt: 'p' }), t, t);
  db.prepare(`INSERT INTO scheduled_runs (id, project_key, project_dir, run_at, request, status, created_at, updated_at) VALUES ('tk-fired', ?, ?, ?, ?, 'fired', ?, ?)`).run(key, dir, t, JSON.stringify({ projectDir: dir, prompt: 'p' }), t, t);
  db.prepare(`INSERT INTO automation_rules (id, project_key, project_dir, event, action, enabled_at, created_at, updated_at) VALUES ('ar-mv', ?, ?, 'issue.opened', 'run', ?, ?, ?)`).run(key, dir, t, t, t);
  const ws = await call('POST', '/api/workspaces', { name: 'Mv pair', projectPaths: [dir, other.dir] });
  assert.equal(ws.status, 201, JSON.stringify(ws.body));
  db.prepare('UPDATE workspaces SET metrics_project = ? WHERE id = ?').run(dir, ws.body.workspace.id);

  const r = await call('PATCH', `/api/projects/${key}`, { path: to });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.previousKey, key);
  assert.equal(r.body.project.key, newKey);
  assert.equal(r.body.project.path, to);
  assert.equal(r.body.project.name, 'mv-one');
  assert.ok(!r.body.projects.some((p) => p.key === key));

  const one = (sql, ...a) => db.prepare(sql).get(...a);
  assert.ok(one('SELECT 1 AS y FROM project_config WHERE project_key = ?', newKey));
  assert.ok(!one('SELECT 1 AS y FROM project_config WHERE project_key = ?', key));
  assert.ok(one('SELECT 1 AS y FROM config_workflow_nodes WHERE project_key = ?', newKey));
  assert.deepEqual({ ...one("SELECT project_key, project_dir, json_extract(request, '$.projectDir') AS rq FROM schedules WHERE id = 'sch_mv1'") }, { project_key: newKey, project_dir: to, rq: to });
  assert.deepEqual({ ...one("SELECT project_key, project_dir, json_extract(request, '$.projectDir') AS rq FROM scheduled_runs WHERE id = 'tk-due'") }, { project_key: newKey, project_dir: to, rq: to });
  assert.deepEqual({ ...one("SELECT project_key, project_dir, json_extract(request, '$.projectDir') AS rq FROM scheduled_runs WHERE id = 'tk-fired'") }, { project_key: key, project_dir: dir, rq: dir });
  assert.deepEqual({ ...one("SELECT project_key, project_dir FROM automation_rules WHERE id = 'ar-mv'") }, { project_key: newKey, project_dir: to });
  assert.equal(one('SELECT metrics_project AS m FROM workspaces WHERE id = ?', ws.body.workspace.id).m, to);
  const members = db.prepare('SELECT project_key AS p FROM workspace_projects WHERE workspace_id = ? ORDER BY ordinal').all(ws.body.workspace.id).map((x) => x.p);
  assert.ok(members.includes(to) && !members.includes(dir));
  assert.equal(one('SELECT project_key AS k FROM pipelines WHERE id = ?', run.id).k, key, 'the run stays under its old key');

  // the alias: a finished pre-move run is onboarded and resolves to the new folder
  assert.equal(P.currentKey(key), newKey);
  assert.equal(P.runOnboarded(one('SELECT id, project_key, target FROM pipelines WHERE id = ?', run.id)), true);
  assert.equal(await mod.projectDirForKey(key), to);

  // a second relocate follows the chain
  const again = await newFolder('mv-one-again');
  const r2 = await call('PATCH', `/api/projects/${newKey}`, { path: again });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal(P.currentKey(key), store.projectKey(again));
  assert.equal(await mod.projectDirForKey(key), again);
});

test('relocate: project-scoped task-source bindings, run presets and requirements follow; workspace-scoped rows with the same key stay', async () => {
  const { key } = await addRepo('mv-scope');
  const to = await newFolder('mv-scope-new');
  const newKey = store.projectKey(to);
  const t = now();
  for (const scope of ['project', 'workspace']) {
    db.prepare(`INSERT INTO source_bindings (scope_type, scope_key, plugin, source_id, profile, updated_at) VALUES (?, ?, 'pl', 'src', 'default', ?)`).run(scope, key, t);
    db.prepare(`INSERT INTO run_presets (id, name, scope_kind, scope_ref, setup, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', ?, ?)`).run(`rp_mv_${scope}`, `mv ${scope}`, scope, key, t, t);
    db.prepare(`INSERT INTO req_features (scope_type, scope_key, title, description, status, spec_json, created_at, updated_at) VALUES (?, ?, ?, '', 'draft', '{}', ?, ?)`).run(scope, key, `mv ${scope}`, t, t);
    db.prepare(`INSERT INTO req_contexts (scope_type, scope_key, body, updated_at) VALUES (?, ?, 'ctx', ?)`).run(scope, key, t);
  }
  const r = await call('PATCH', `/api/projects/${key}`, { path: to });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const scopeOf = (sql, scope) => db.prepare(sql).all(scope).map((x) => x.k);
  for (const [table, type, col] of [['source_bindings', 'scope_type', 'scope_key'], ['run_presets', 'scope_kind', 'scope_ref'], ['req_features', 'scope_type', 'scope_key'], ['req_contexts', 'scope_type', 'scope_key']]) {
    const sql = `SELECT ${col} AS k FROM ${table} WHERE ${type} = ? AND ${col} IN ('${key}', '${newKey}')`;
    assert.deepEqual(scopeOf(sql, 'project'), [newKey], `${table}: the project row follows`);
    assert.deepEqual(scopeOf(sql, 'workspace'), [key], `${table}: a workspace row is not touched`);
  }
});

test('every project key, dir and member-path column of the schema is in exactly one of RELOCATE_MOVES and RELOCATE_KEEPS; the on-disk list is pinned', () => {
  const MEMBER_PATHS = new Set(['workspaces.metrics_project', 'workspaces.policy_project', 'workspace_projects.project_key']);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  const cols = [];
  for (const t of tables) {
    for (const c of db.prepare(`PRAGMA table_info(${t})`).all()) {
      if (/^(project_key|project_dir|.+_project_key|scope_key|scope_ref)$/.test(c.name) || MEMBER_PATHS.has(`${t}.${c.name}`)) cols.push(`${t}.${c.name}`);
    }
  }
  const colsOf = (spec) => [spec.key, spec.dir, spec.request, ...(spec.paths || [])].filter(Boolean);
  const moved = Object.entries(P.RELOCATE_MOVES).flatMap(([t, s]) => colsOf(s).filter((c) => c !== s.request).map((c) => `${t}.${c}`));
  const kept = Object.entries(P.RELOCATE_KEEPS).flatMap(([t, cs]) => cs.map((c) => `${t}.${c}`));
  for (const c of cols) assert.equal(moved.filter((x) => x === c).length + kept.filter((x) => x === c).length, 1, `${c} is in exactly one list`);
  for (const c of [...moved, ...kept]) assert.ok(cols.includes(c), `${c} is a real column`);
  assert.deepEqual([...P.RELOCATE_DISK_KEEPS], ['store/KEY', 'memory/projects/KEY', 'team-memory/projects/KEY', 'ask/memory/KEY', 'runs/RUN/repos/KEY', 'branch worktrees/KEY']);
});

test('relocate refusals leave GET /api/projects byte-equal and move no row', async () => {
  const { dir, key } = await addRepo('mv-ref');
  const taken = await addRepo('mv-taken');
  const t = now();
  db.prepare(`INSERT INTO project_config (project_key, extra) VALUES (?, '{}') ON CONFLICT(project_key) DO NOTHING`).run(key);
  const before = await listText();
  const cases = [
    [{ path: join(sandboxHome, 'no-such-folder') }, 400, 'path is not a directory'],
    [{ path: taken.dir }, 400, 'this project path is already registered'],
    [{ path: dir }, 400, 'this project path is already registered'],
  ];
  for (const [body, status, error] of cases) {
    const r = await call('PATCH', `/api/projects/${key}`, body);
    assert.deepEqual([r.status, r.body.error], [status, error], JSON.stringify(body));
  }
  const to = await newFolder('mv-ref-new');
  for (const status of ['running', 'paused', 'interrupted']) {
    db.prepare(`INSERT INTO pipelines (id, project_key, status, phase) VALUES (?, ?, ?, 'x')`).run(`busy-${status}`, key, status);
    const r = await call('PATCH', `/api/projects/${key}`, { path: to });
    assert.deepEqual([r.status, r.body.code, r.body.error], [409, 'PROJECT_BUSY', 'finish or stop its tasks first'], status);
    db.prepare('DELETE FROM pipelines WHERE id = ?').run(`busy-${status}`);
  }
  db.prepare(`INSERT INTO scheduled_runs (id, project_key, project_dir, run_at, request, status, resume_pipeline_id, created_at, updated_at) VALUES ('tk-resume', ?, ?, ?, '{}', 'scheduled', 'abcd1234', ?, ?)`).run(key, dir, t, t, t);
  const resume = await call('PATCH', `/api/projects/${key}`, { path: to });
  assert.deepEqual([resume.status, resume.body.code], [409, 'PROJECT_BUSY']);
  db.prepare("DELETE FROM scheduled_runs WHERE id = 'tk-resume'").run();
  assert.equal(await listText(), before);
  assert.ok(db.prepare('SELECT 1 AS y FROM project_config WHERE project_key = ?').get(key));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_moves WHERE old_key = ?').get(key).n, 0);
});

test('a relocate that fails mid-way moves no row (a test trigger aborts the last RELOCATE_MOVES table)', async () => {
  const { dir, key } = await addRepo('mv-abort');
  const other = await addRepo('mv-abort-peer');
  const ws = await call('POST', '/api/workspaces', { name: 'Abort pair', projectPaths: [dir, other.dir] });
  assert.equal(ws.status, 201);
  db.prepare('UPDATE workspaces SET metrics_project = ? WHERE id = ?').run(dir, ws.body.workspace.id);
  db.prepare(`INSERT INTO project_config (project_key, extra) VALUES (?, '{}') ON CONFLICT(project_key) DO NOTHING`).run(key);
  const last = Object.keys(P.RELOCATE_MOVES).at(-1);
  db.exec(`CREATE TRIGGER relocate_abort BEFORE UPDATE ON ${last} BEGIN SELECT RAISE(ABORT, 'test abort'); END`);
  const before = await listText();
  try {
    const r = await call('PATCH', `/api/projects/${key}`, { path: await newFolder('mv-abort-new') });
    assert.equal(r.status, 500);
  } finally { db.exec('DROP TRIGGER relocate_abort'); }
  assert.equal(await listText(), before);
  assert.ok(db.prepare('SELECT 1 AS y FROM project_config WHERE project_key = ?').get(key));
  assert.equal(db.prepare('SELECT metrics_project AS m FROM workspaces WHERE id = ?').get(ws.body.workspace.id).m, dir);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_moves WHERE old_key = ?').get(key).n, 0);
});

test('relocate back to a vacated folder: the alias for the live key is cleared, and a registered key wins over a stale alias', async () => {
  const { dir, key } = await addRepo('mv-back');
  const to = await newFolder('mv-back-away');
  const kB = store.projectKey(to);
  assert.equal((await call('PATCH', `/api/projects/${key}`, { path: to })).status, 200);
  const back = await call('PATCH', `/api/projects/${kB}`, { path: dir });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal(back.body.project.key, key);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_moves WHERE old_key = ?').get(key).n, 0);
  assert.equal(P.currentKey(key), key);
  assert.equal(P.currentKey(kB), key);
  assert.equal(await mod.projectDirForKey(key), dir);
});

test('re-add at the vacated folder: the new project owns its key; its runs resolve to it, not to the moved project', async () => {
  const { dir, key } = await addRepo('mv-readd');
  const to = await newFolder('mv-readd-away');
  assert.equal((await call('PATCH', `/api/projects/${key}`, { path: to })).status, 200);
  await P.addProject({ name: 'mv-readd-again', path: dir });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_moves WHERE old_key = ?').get(key).n, 0);
  assert.equal(P.currentKey(key), key);
  assert.equal(await mod.projectDirForKey(key), dir);
  // a stale alias row (written by an older build) still loses to the registered key
  db.prepare('INSERT INTO project_moves (old_key, new_key, moved_at) VALUES (?, ?, ?)').run(key, store.projectKey(to), now());
  assert.equal(P.currentKey(key), key);
  assert.equal(await mod.projectDirForKey(key), dir);
  db.prepare('DELETE FROM project_moves WHERE old_key = ?').run(key);
});

test('PATCH with both name and path is refused whole: 400, nothing renamed, the list byte-equal', async () => {
  const { key } = await addRepo('mv-both');
  const before = await listText();
  for (const path of [join(sandboxHome, 'no-such-folder'), await newFolder('mv-both-new')]) {
    const r = await call('PATCH', `/api/projects/${key}`, { name: 'mv-both-2', path });
    assert.deepEqual([r.status, r.body.code, r.body.error], [400, 'INVALID', 'rename and move one at a time']);
  }
  assert.equal(await listText(), before);
});

test('relocate is refused while a run of the project is still starting (reserved before its first await)', async () => {
  const { dir, key } = await addRepo('mv-starting');
  const to = await newFolder('mv-starting-new');
  const unhold = P.holdStart({ body: { projectDir: dir } });   // what startRunHandler takes on its first line
  const r = await call('PATCH', `/api/projects/${key}`, { path: to });
  assert.deepEqual([r.status, r.body.code], [409, 'PROJECT_BUSY']);
  unhold(); unhold();
  assert.equal(P.startingTargets().length, 0, 'released once the start answers');
  const ok = await call('PATCH', `/api/projects/${key}`, { path: to });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test('a workspace run still starting holds each member project', async () => {
  const a = await addRepo('mv-ws-start-a');
  const b = await addRepo('mv-ws-start-b');
  const ws = await call('POST', '/api/workspaces', { name: 'Starting pair', projectPaths: [a.dir, b.dir] });
  assert.equal(ws.status, 201);
  const unhold = P.holdStart({ body: { workspaceId: ws.body.workspace.id } });
  const r = await call('PATCH', `/api/projects/${b.key}`, { path: await newFolder('mv-ws-start-new') });
  assert.deepEqual([r.status, r.body.code], [409, 'PROJECT_BUSY']);
  unhold();
});

test('POST /api/run releases its hold when it answers, a refusal included', async () => {
  const { dir } = await addRepo('mv-run-refused');
  const r = await call('POST', '/api/run', { projectDir: dir, noProject: 'yes' });
  assert.equal(r.status, 400);
  assert.equal(P.startingTargets().length, 0);
});
