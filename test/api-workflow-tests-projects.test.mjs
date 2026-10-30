// test/api-workflow-tests-projects.test.mjs — workflow tests 3a, Task 8 (mock engine): the routes for examples that work on
// a project. Projects and branches to pick from; save with a start point (and the uncommitted changes); drift and Start from
// the latest; the overview's readiness; the plan's disk; a whole project test to its side-by-side page; past project runs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { writeFileSync, renameSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { repoSnapshot } from './helpers/repo-snapshot.mjs';
import { runSettled } from './helpers/run-settled.mjs';

useTempHome(after);
let homeDir, prevHome, prevEnv, srv, base, real, key, folderKey, runs, settled;
const extra = [];
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: JSONH, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() };
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const WF = '/api/workflows/wf_pt/tests';
const GRAPH = {
  version: 2, id: 'wf_pt', name: 'Fix a bug from a ticket', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_impl', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } }],
};

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftpapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'workflowTests';
  const mod = await import('../ui/server.mjs');
  runs = mod.runs;
  settled = runSettled({ runs, answerRun: mod._testing.answerRun });
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  real = templateRepo('wftpapi', { branch: 'main', user: true, files: { 'README.md': '# t\n', 'CHANGELOG.md': '# Changelog\n' } });
  const folder = await mkdtemp(join(tmpdir(), 'worca-cc-wftpfolder-'));
  extra.push(real, folder);
  const { insertProject } = await import('../src/core/projects.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  insertProject({ name: 'tickets', path: real });
  insertProject({ name: 'docs-site', path: folder });
  key = projectKey(real);
  folderKey = projectKey(folder);
  const { writeProjectActions } = await import('../src/core/config.mjs');
  writeProjectActions(key, { setup: 'node -e "0"' });
  assert.equal((await call('POST', '/api/workflows', GRAPH)).status, 201);
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const [k, v] of Object.entries(prevEnv || {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete process.env.WORCA_MOCK; delete process.env.WORCA_FLAGS;
  for (const d of [homeDir, ...extra]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('the projects to pick from, with the branch each folder is on and its setup; a project\'s branches', async () => {
  const p = await call('GET', '/api/workflow-tests/projects');
  const tickets = p.body.projects.find((x) => x.key === key);
  assert.deepEqual([tickets.name, tickets.vcs, tickets.current.branch, tickets.current.short.length, tickets.setupCmd], ['tickets', 'git', 'main', 7, 'node -e "0"']);
  assert.equal(p.body.projects.find((x) => x.key === folderKey).vcs, 'none');
  const b = await call('GET', `/api/workflow-tests/projects/${key}/branches`);
  assert.deepEqual(b.body.branches.map((x) => [x.name, x.current]), [['main', true]]);
  assert.equal((await call('GET', '/api/workflow-tests/projects/nope-00000000/branches')).status, 404);
});

test('an example with a project: the overview says where it starts; drift; Start from the latest; the person\'s repository only read', { timeout: 120000 }, async () => {
  const was = repoSnapshot(real);
  const head = git(real, 'rev-parse', 'HEAD');
  const c = await call('POST', `${WF}/examples`, { name: 'Ticket 482', request: 'Fix the rounding.', project: { key, setupCmd: 'node -e "0"' },
    checks: [{ kind: 'command', cmd: 'node -e "process.exit(0)"' }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const ex = c.body.example;
  assert.deepEqual([ex.project.key, ex.project.startSha, ex.project.startRef, ex.project.setupCmd], [key, head, 'main', 'node -e "0"']);
  let o = (await call('GET', WF)).body;
  assert.equal(o.needsProject, false, 'the implementer alone needs no repo (brief 1.1)');
  let row = o.examples.find((e) => e.id === ex.id);
  assert.deepEqual([row.project.name, row.project.short, row.project.behind, row.project.state, row.ready], ['tickets', head.slice(0, 7), 0, 'ok', true]);
  assert.equal(repoSnapshot(real), was, 'saving only read the project');
  writeFileSync(join(real, 'README.md'), '# t2\n');
  git(real, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-am', 'later');
  row = (await call('GET', WF)).body.examples.find((e) => e.id === ex.id);
  assert.equal(row.project.behind, 1);
  const latest = await call('POST', `${WF}/examples/${ex.id}/project/latest`);
  assert.equal(latest.status, 200, JSON.stringify(latest.body));
  assert.equal(latest.body.example.project.startSha, git(real, 'rev-parse', 'HEAD'));
  assert.notEqual(latest.body.example.fingerprint, ex.fingerprint, 'a new start point: older results stop being reused (D48)');
  const kept = await call('PUT', `${WF}/examples/${ex.id}`, { note: 'n', project: { key } });
  assert.equal(kept.body.example.project.startSha, latest.body.example.project.startSha, 'same project, no repin: the start stays');
  writeFileSync(join(real, 'README.md'), '# t3\n');
  git(real, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-am', 'later again');
  const nullRef = await call('PUT', `${WF}/examples/${ex.id}`, { project: { key, ref: null } });
  assert.equal(nullRef.status, 200, JSON.stringify(nullRef.body));
  assert.equal(nullRef.body.example.project.startSha, latest.body.example.project.startSha, 'ref: null is "no change", not "the newest commit"');
  assert.equal(nullRef.body.example.fingerprint, kept.body.example.fingerprint);
  const repinned = await call('PUT', `${WF}/examples/${ex.id}`, { project: { key, ref: null, repin: true } });
  assert.equal(repinned.body.example.project.startSha, git(real, 'rev-parse', 'HEAD'), 'repin is the explicit "change the start" action');
  // Review fix 3: the name is stored with the pin and shown when the project is no longer registered, never the key.
  assert.equal(repinned.body.example.project.name, 'tickets');
  const service = await import('../src/core/workflow-tests/service.mjs');
  const gone = await service.projectView(repinned.body.example.project, { projects: [] });
  assert.deepEqual([gone.state, gone.name, gone.behind], ['not-registered', 'tickets', null]);
  // Review fix 2: one drift count per start point in one page read.
  const memo = new Map();
  const [x1, x2] = await Promise.all([1, 2].map(() => service.projectView(repinned.body.example.project, { behindMemo: memo })));
  assert.deepEqual([x1.behind, x2.behind, memo.size], [0, 0, 1]);
  const listed = await service.projectsForTests();
  const ps = (await import('../src/core/projects.mjs'));
  assert.deepEqual(listed.projects.map((x) => x.key), (await ps.listProjects()).map((x) => x.key), 'read 4 at a time, in the registry\'s order');
});

test('uncommitted changes are kept with the example; a Folder project and a missing folder are refused with board 39\'s words', async () => {
  writeFileSync(join(real, 'CHANGELOG.md'), '# Changelog\n\n## Fixed\n');
  const c = await call('POST', `${WF}/examples`, { name: 'With changes', request: 'r', project: { key, includeChanges: true } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.ok(c.body.example.project.changesBytes > 0);
  assert.notEqual(c.body.example.project.startCommit, c.body.example.project.startSha);
  git(real, 'checkout', '-q', '--', 'CHANGELOG.md');
  const folder = await call('POST', `${WF}/examples`, { name: 'Docs', request: 'r', project: { key: folderKey } });
  assert.equal(folder.status, 422);
  assert.match(folder.body.error, /is a Folder project\. Worca can test examples on Git projects for now\. Pick a Git project\.$/);
});

test('Task 10 review: the setup is cleared with "", kept with null or left out; a kept pin saves while its folder is missing', async () => {
  const moved = templateRepo('wftpmove', { branch: 'main', user: true, files: { 'README.md': '# m\n' } });
  const { insertProject } = await import('../src/core/projects.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  insertProject({ name: 'moving', path: moved });
  const mk = projectKey(moved);
  const c = await call('POST', `${WF}/examples`, { name: 'Moves', request: 'r', project: { key: mk, setupCmd: 'npm ci' } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const id = c.body.example.id;
  const put = async (project, extraFields = {}) => call('PUT', `${WF}/examples/${id}`, { ...extraFields, project });
  assert.equal((await put({ key: mk })).body.example.project.setupCmd, 'npm ci', 'left out: kept');
  assert.equal((await put({ key: mk, setupCmd: null })).body.example.project.setupCmd, 'npm ci', 'null: kept');
  assert.equal((await put({ key: mk, setupCmd: '' })).body.example.project.setupCmd, null, "'': no setup");
  assert.equal((await put({ key: mk })).body.example.project.setupCmd, null, 'cleared stays cleared, not the project\'s own');
  const pinned = (await put({ key: mk, setupCmd: 'npm ci' })).body.example.project;
  const away = `${moved}-away`;
  renameSync(moved, away);
  extra.push(away);
  const edit = await put({ key: mk }, { request: 'edited while the folder is away' });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.deepEqual([edit.body.example.request, edit.body.example.project.startSha, edit.body.example.project.setupCmd],
    ['edited while the folder is away', pinned.startSha, 'npm ci']);
  const cleared = await put({ key: mk, setupCmd: '' });
  assert.equal(cleared.body.example.project.setupCmd, null, 'the setup is cleared without the folder too');
  const repin = await put({ key: mk, repin: true });
  assert.equal(repin.status, 422, 'a new start point needs the folder');
  assert.match(repin.body.error, /^Worca can't find moving in /);
  const changes = await put({ key: mk, includeChanges: true });
  assert.equal(changes.status, 422, 'switching the changes on pins again: checked');
  // A pinned project that left the registry: the kept pin saves under its stored name.
  const service = await import('../src/core/workflow-tests/service.mjs');
  const was = { id, project: { ...pinned, key: 'gone-00000000', name: 'moving' } };
  const kept = await service.resolveProjectInput(was, { key: 'gone-00000000' });
  assert.deepEqual([kept.key, kept.name, kept.startSha], ['gone-00000000', 'moving', pinned.startSha]);
  await assert.rejects(service.resolveProjectInput(was, { key: 'gone-00000000', repin: true }), /pick a project/);
  await call('DELETE', `${WF}/examples/${id}`);
});

test('a workflow that needs a project: its example without one is left out, and the start says so', async () => {
  const service = await import('../src/core/workflow-tests/service.mjs');
  const none = await call('POST', `${WF}/examples`, { name: 'Ticket 497', request: 'r' });
  const o = await service.testsOverview('wf_pt', { registry: { implementer: { needsRepo: true } } });
  assert.deepEqual([o.testable, o.needsProject], [true, true]);
  const row = o.examples.find((e) => e.id === none.body.example.id);
  assert.deepEqual([row.ready, row.reason, row.readyText], [false, 'pick-project', 'Ticket 497 is left out: pick its project first.']);
  await call('DELETE', `${WF}/examples/${none.body.example.id}`);
});

test('a whole project test: the plan\'s disk, the progress phases, then what changed and what would have been sent', { timeout: 240000 }, async () => {
  const ex = (await call('POST', `${WF}/examples`, { name: 'Ticket 455', request: 'Fix the CSV export.', project: { key },
    checks: [{ kind: 'command', cmd: 'node -e "console.log(\'# pass 4\');console.log(\'# fail 0\')"' }] })).body.example;
  const plan = (await call('GET', `${WF}/plan?b=draft&examples=${ex.id}&tries=1`)).body;
  assert.ok(plan.project.disk.needBytes > 0 && plan.project.disk.freeBytes > 0 && plan.project.disk.enough);
  assert.deepEqual(plan.project.names, ['tickets']);
  const r = await call('POST', `${WF}/examples/${ex.id}/try-once`);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const runId = r.body.run.id;
  let p;
  for (let i = 0; i < 2000; i += 1) {
    p = (await call('GET', `${WF}/runs/${runId}`)).body;
    if (p.run.status !== 'running') break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.equal(p.run.status, 'done', JSON.stringify(p.run));
  const s = (await call('GET', `${WF}/runs/${runId}/examples/${ex.id}`)).body;
  const v = s.tries[0].b;
  assert.equal(v.status, 'passed');
  assert.ok(v.project.changes.files.some((f) => f.path === 'src/feature.mjs' && f.status === 'added'), 'the mock implementer\'s file');
  assert.deepEqual(v.verdict.checks.map((c) => [c.met, c.value]), [[true, '4 passed']]);
  assert.deepEqual(v.wouldHaveSent, [], 'the mock pushed nothing');
  assert.equal(s.nothingPushed, true);
  assert.equal(s.start.ref, 'main');
  const ch = await call('GET', `${WF}/runs/${runId}/tries/${v.tryId}/changes`);
  assert.match(ch.body.patch, /src\/feature\.mjs/);
  assert.equal(ch.body.cut, false);
  const service = await import('../src/core/workflow-tests/service.mjs');
  const small = await service.tryChanges('wf_pt', runId, v.tryId, { maxBytes: 60 });
  assert.equal(small.cut, true);
  assert.ok(Buffer.byteLength(small.patch) <= 60 && ch.body.patch.startsWith(small.patch) && (small.patch === '' || small.patch.endsWith('\n')),
    'at most the limit, cut at a whole line');
  const t = (await import('../src/core/workflow-tests/store.mjs')).readTry(v.tryId);
  const { existsSync } = await import('node:fs');
  // worcaHome() is <WORCA_HOME>/.worca-cc (src/core/projects.mjs)
  assert.equal(existsSync(join(homeDir, '.worca-cc', 'runs', t.pipelineId)), false, 'the checkout and run folder are gone after the checks');
});

test('a past project run: it starts where the run started; a Folder run is refused with board 39\'s sentence', { timeout: 240000 }, async () => {
  const { _testing } = await import('../ui/server.mjs');
  const out = await _testing.invokeStartRun({ projectDir: real, workflowId: 'wf_pt', prompt: 'Fix: invoice totals', title: 'Fix: invoice totals round wrong' }, null, {});
  assert.equal(out.status, 200, JSON.stringify(out.body));
  // invokeStartRun answers { runId }: the pipeline id is on the run entry (wf_pt has no clarify gate; runSettled answers any).
  const { pipelineId } = await settled(out.body.runId);
  const past = (await call('GET', `/api/workflow-tests/past-run/${pipelineId}`)).body;
  assert.deepEqual([past.testable, past.project.key, past.project.startRef, past.project.name, past.project.setupCmd], [true, key, 'main', 'tickets', 'node -e "0"']);
  const o = (await call('GET', WF)).body;
  const listed = o.pastRuns.find((x) => x.pipelineId === pipelineId);
  assert.deepEqual([listed.project, listed.refusal], ['tickets', null]);
  const made = await call('POST', `${WF}/examples/from-run`, { pipelineId, setupCmd: 'npm ci' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.deepEqual([made.body.example.project.startSha, made.body.example.project.changesBytes, made.body.example.project.setupCmd],
    [past.project.startSha, 0, 'npm ci']);
  const { getDb } = await import('../src/core/db.mjs');
  const branchWas = getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(pipelineId).branch;
  getDb().prepare("UPDATE pipelines SET branch = json_remove(branch, '$.baseSha', '$.diffBase') WHERE id = ?").run(pipelineId);
  const noStart = (await call('GET', WF)).body.pastRuns.find((x) => x.pipelineId === pipelineId);
  assert.deepEqual([noStart.refusal, noStart.refusalText], ['no-start', 'Worca did not record where this run started.'], 'not selectable');
  assert.equal((await call('GET', `/api/workflow-tests/past-run/${pipelineId}`)).body.reason, 'no-start');
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(branchWas, pipelineId);
  getDb().prepare("UPDATE pipelines SET branch = json_set(branch, '$.workMode', 'folder') WHERE id = ?").run(pipelineId);
  const folderRun = (await call('GET', `/api/workflow-tests/past-run/${pipelineId}`)).body;
  assert.deepEqual([folderRun.testable, folderRun.reason, folderRun.reasonText],
    [false, 'folder-run', "This run worked on a Folder project. Folder projects can't be tested yet."]);
});

test('progress (board 35): a running project try shows its phase; an example without a project has none; a setup stop keeps its output', async () => {
  const store = await import('../src/core/workflow-tests/store.mjs');
  const service = await import('../src/core/workflow-tests/service.mjs');
  const withP = (await call('POST', `${WF}/examples`, { name: 'Ticket 600', request: 'r', project: { key, setupCmd: 'npm ci' } })).body.example;
  const without = (await call('POST', `${WF}/examples`, { name: 'Plain', request: 'r' })).body.example;
  const run = store.createTestRun({ workflowId: 'wf_pt', kind: 'once', b: 'draft', bFp: 'fp', exampleIds: [withP.id, without.id], tries: 1 });
  const mk = (ex) => { const t = store.insertTry({ runId: run.id, workflowId: 'wf_pt', exampleId: ex.id, use: 'draft', fp: 'fp', exampleFp: ex.fingerprint, tryNo: 1 });
    store.linkTry(run.id, t.id, 'b'); return store.updateTry(t.id, { status: 'running' }); };
  const tp = mk(withP);
  mk(without);
  const asked = [];
  const phaseOf = (runId, tryId) => { asked.push(tryId); return { phase: 'setup', checking: null, startedMs: 5 }; };
  const p = service.progressOf('wf_pt', run.id, { phaseOf });
  assert.deepEqual(p.rows.map((r) => r.now), [{ tryNo: 1, phase: 'setup', checking: null, setupCmd: 'npm ci', startedMs: 5 }, null]);
  assert.deepEqual(asked, [tp.id], 'an example without a project is never asked for its phase');
  assert.deepEqual([p.project.phases.exampleName, p.project.phases.phase, p.project.phases.start.ref, p.project.phases.start.short.length,
    p.project.phases.setupCmd, p.project.disk, p.project.setupStop], ['Ticket 600', 'setup', 'main', 7, 'npm ci', null, null]);
  const disk = await service.progressDisk('wf_pt', run, { diskOf: () => ({ freeAtStart: null }) });
  assert.ok(disk.needBytes > 0 && disk.inUseBytes === null);
  store.updateTry(tp.id, { status: 'stopped', setup: { cmd: 'npm ci', ok: false, exitCode: 1, timedOut: false, ms: 10, tail: 'npm ERR! missing' } });
  store.updateTestRun(run.id, { status: 'stopped', stopReason: 'setup', finishedAt: new Date().toISOString() });
  const q = service.progressOf('wf_pt', run.id);
  assert.deepEqual(q.project.setupStop, { cmd: 'npm ci', tail: 'npm ERR! missing', exampleId: withP.id, exampleName: 'Ticket 600', label: 'Your draft', tryNo: 1 });
  const none = store.createTestRun({ workflowId: 'wf_pt', kind: 'once', b: 'draft', bFp: 'fp', exampleIds: [without.id], tries: 1 });
  store.updateTestRun(none.id, { status: 'stopped', finishedAt: new Date().toISOString() });
  assert.equal(service.progressOf('wf_pt', none.id).project, null, 'Part 2: no project block');
  assert.equal(await service.progressDisk('wf_pt', none), null);
});

test('review fixes: the disk need is worked out once per running test; the forge of a guarded push\'s remote is read with remote get-url', async () => {
  const store = await import('../src/core/workflow-tests/store.mjs');
  const service = await import('../src/core/workflow-tests/service.mjs');
  const ex = (await call('POST', `${WF}/examples`, { name: 'Ticket 700', request: 'r', project: { key } })).body.example;
  const run = store.createTestRun({ workflowId: 'wf_pt', kind: 'once', b: 'draft', bFp: 'fp', exampleIds: [ex.id], tries: 1 });
  let plans = 0;
  let frees = 0;
  const seams = { planOf: async () => { plans += 1; return { needBytes: 1000, freeBytes: 9000 }; }, freeDisk: async () => { frees += 1; return 8500; },
    diskOf: () => ({ freeAtStart: 9000 }) };
  const first = await service.progressDisk('wf_pt', run, seams);
  const second = await service.progressDisk('wf_pt', run, seams);
  assert.deepEqual([first, second, plans, frees], [{ inUseBytes: 0, needBytes: 1000, freeBytes: 9000 },
    { inUseBytes: 500, needBytes: 1000, freeBytes: 8500 }, 1, 1], 'polls re-read free space only');
  const done = store.updateTestRun(run.id, { status: 'stopped', finishedAt: new Date().toISOString() });
  await service.progressDisk('wf_pt', done, seams);
  assert.equal(plans, 2, 'a finished test is worked out again');
  git(real, 'remote', 'add', 'origin', 'https://github.com/acme/tickets.git');
  const forge = await service.forgeNamer(key, ['origin', 'nope', '--upload-pack=touch x']);
  assert.deepEqual([forge('origin'), forge('nope'), forge('--upload-pack=touch x'), forge('other')], ['GitHub', null, null, null]);
  git(real, 'remote', 'remove', 'origin');
});
