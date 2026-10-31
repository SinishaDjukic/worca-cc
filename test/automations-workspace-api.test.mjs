// test/automations-workspace-api.test.mjs — workspace Git event automations over HTTP: a workspace's rules and
// switches (its members' repositories, the workspace limits), the project tab's "the workspace wins" note, and a
// GitHub webhook for an issue in a member repository starting a real mock WORKSPACE run (the member project's own
// rule for the same event starts nothing).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { stopAndSettle } from './helpers/stop-and-settle.mjs';

useTempHome(after, 'automations-ws-api-');
process.env.WORCA_MOCK = '1';
process.env.WORCA_AUTOMATIONS_POLL = '0';

const JSONH = { 'Content-Type': 'application/json' };
let srv, base, repoA, repoB, lone, server, gitInfo, db, ws;
const prevFlags = process.env.WORCA_FLAGS;
const call = (method, p, body) => fetch(`${base}${p}`, { method, headers: JSONH, ...(body ? { body: JSON.stringify(body) } : {}) });

async function gitRepo(prefix, remote) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  if (remote) git('remote', 'add', 'origin', remote);
  return dir;
}

before(async () => {
  repoA = await gitRepo('worca-cc-autws-a-', 'https://github.com/o/a.git');
  repoB = await gitRepo('worca-cc-autws-b-', 'https://github.com/o/b.git');
  lone = await gitRepo('worca-cc-autws-none-', null);
  const { addProject } = await import('../src/core/projects.mjs');
  const { writeSyncPrefs } = await import('../src/core/config.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  for (const [name, dir] of [['autws-a', repoA], ['autws-b', repoB], ['autws-none', lone]]) {
    await addProject({ name, path: dir });
    writeSyncPrefs(projectKey(dir), { beforeRun: false });   // the remotes are not reachable here
  }
  const { createWorkspace } = await import('../src/core/workspaces.mjs');
  ws = await createWorkspace({ name: 'Shop', projectPaths: [repoA, repoB] });
  server = await import('../ui/server.mjs');
  ({ _testing: gitInfo } = await import('../src/core/git-info.mjs'));
  db = await import('../src/core/db.mjs');
  srv = http.createServer(server.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  await stopAndSettle(server.runs, () => true).catch(() => {});
  if (srv) await new Promise((r) => srv.close(r));
  gitInfo.reset();
  if (prevFlags === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prevFlags;
  for (const d of [repoA, repoB, lone]) await rm(d, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.WORCA_FLAGS = 'gitAutomations';
  db.getDb().exec('DELETE FROM automation_rules; DELETE FROM automation_events; DELETE FROM automation_cursors; DELETE FROM automation_deliveries');
  gitInfo.setRunner((cmd, args, o) => (cmd === 'gh' ? Promise.resolve({ ok: false, stdout: '', stderr: 'offline', code: 1 }) : gitInfo.defaultRun(cmd, args, o)));
});

test('with the flag off the workspace routes answer 404', async () => {
  delete process.env.WORCA_FLAGS;
  assert.equal((await call('GET', `/api/automations?workspaceId=${ws.id}`)).status, 404);
});

test('a workspace\'s rules: its members\' repositories, the workspace limits, its own switches', async () => {
  assert.equal((await call('POST', '/api/automations/rules', { workspaceId: 'wks-nope-00000000', event: 'issue.opened', action: 'fix' })).status, 400);
  assert.equal((await call('POST', '/api/automations/rules', { workspaceId: ws.id, projectDir: repoA, event: 'issue.opened', action: 'fix' })).status, 400);
  const c = await call('POST', '/api/automations/rules', { workspaceId: ws.id, event: 'issue.opened', action: 'fix' });
  assert.equal(c.status, 201);
  const { rule } = await c.json();
  assert.deepEqual([rule.scope, rule.workspaceId, rule.projectKey, rule.repo], ['workspace', ws.id, `workspaces/${ws.id}`, null]);
  assert.deepEqual(rule.limits, { dailyRuns: 5, maxCostUsd: 15, maxConcurrent: 1 });
  // A partial change keeps the workspace defaults for the rest.
  const p = await call('PATCH', `/api/automations/rules/${rule.id}`, { limits: { dailyRuns: 3 } });
  assert.deepEqual((await p.json()).rule.limits, { dailyRuns: 3, maxCostUsd: 15, maxConcurrent: 1 });
  // A value outside its range is refused, never silently replaced by the default; the auto-handle rule is editable too.
  const bad = await call('PATCH', `/api/automations/rules/${rule.id}`, { limits: { dailyRuns: 500 } });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /Runs per day must be between 1 and 200/);
  const badNew = await call('POST', '/api/automations/rules', { workspaceId: ws.id, event: 'pr.opened', action: 'review', limits: { maxConcurrent: 0 } });
  assert.equal(badNew.status, 400);
  assert.match((await badNew.json()).error, /Runs at a time must be between 1 and 10/);
  const g = await (await call('GET', `/api/automations?workspaceId=${ws.id}`)).json();
  assert.equal(g.scope, 'workspace');
  assert.deepEqual(g.repos.map((r) => r.repo).sort(), ['o/a', 'o/b']);
  assert.deepEqual(g.defaultLimits, { dailyRuns: 5, maxCostUsd: 15, maxConcurrent: 1 });
  assert.deepEqual(g.rules.map((r) => r.id), [rule.id]);
  const put = await call('PUT', '/api/automations/auto-handle', { workspaceId: ws.id, key: 'review', on: true });
  assert.deepEqual((await put.json()).autoHandle, { propose: false, fix: false, review: true });
  const sw = (await (await call('GET', `/api/automations?workspaceId=${ws.id}`)).json()).rules.find((r) => r.origin === 'auto-handle');
  const edited = await call('PATCH', `/api/automations/rules/${sw.id}`, { limits: { dailyRuns: '2', maxCostUsd: '7.5', maxConcurrent: '2' } });
  assert.deepEqual((await edited.json()).rule.limits, { dailyRuns: 2, maxCostUsd: 7.5, maxConcurrent: 2 });
  // The overview lists the workspace's rules under its key.
  const all = await (await call('GET', '/api/automations')).json();
  assert.ok(all.rules.every((r) => r.projectKey === `workspaces/${ws.id}`));
});

test('a workspace whose members have no GitHub or Azure DevOps remote cannot automate', async () => {
  const { createWorkspace } = await import('../src/core/workspaces.mjs');
  const lone2 = await gitRepo('worca-cc-autws-none2-', null);
  const bare = await createWorkspace({ name: 'Bare', projectPaths: [lone, lone2] });
  const r = await call('POST', '/api/automations/rules', { workspaceId: bare.id, event: 'issue.opened', action: 'fix' });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /no project in this workspace/);
  await rm(lone2, { recursive: true, force: true });
});

test('the project tab names the workspace that takes its events over', async () => {
  await call('POST', '/api/automations/rules', { projectDir: repoA, event: 'issue.opened', action: 'fix' });
  const before = await (await call('GET', `/api/automations?projectDir=${encodeURIComponent(repoA)}`)).json();
  assert.deepEqual(before.overriddenBy, []);
  await call('POST', '/api/automations/rules', { workspaceId: ws.id, event: 'issue.opened', action: 'propose' });
  const p = await (await call('GET', `/api/automations?projectDir=${encodeURIComponent(repoA)}`)).json();
  assert.equal(p.scope, 'project');
  assert.deepEqual(p.overriddenBy, [{ workspaceId: ws.id, name: 'Shop', events: ['issue.opened'] }]);
});

test('an issue in a member repository starts one workspace run; the member project\'s own rule starts nothing', async () => {
  await call('POST', '/api/automations/rules', { projectDir: repoB, event: 'issue.opened', action: 'run', workflowId: 'wf_default' });
  const c = await call('POST', '/api/automations/rules', { workspaceId: ws.id, event: 'issue.opened', action: 'run', workflowId: 'wf_default' });
  assert.equal(c.status, 201);
  const at = new Date(Date.now() + 1000).toISOString();
  const issue = { number: 7, html_url: 'https://github.com/o/b/issues/7', title: 'Checkout crashes', body: 'Steps…', state: 'open',
    user: { login: 'alice' }, author_association: 'COLLABORATOR', labels: [], created_at: at, updated_at: at };
  const { automations } = server._testing;
  const { runs } = server;
  assert.equal(await automations.handleWebhook('issues', { action: 'opened', repository: { full_name: 'o/b' }, issue }), 1);
  const { events } = await (await call('GET', `/api/automations?workspaceId=${ws.id}`)).json();
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'starting', JSON.stringify(events[0]));
  assert.equal(events[0].repo, 'o/b');
  const projectEvents = (await (await call('GET', `/api/automations?projectDir=${encodeURIComponent(repoB)}`)).json()).events;
  assert.deepEqual(projectEvents, []);
  const entry = runs.get(events[0].runId);
  assert.ok(entry, 'the run is live');
  assert.equal(entry.workspaceId, ws.id);
  assert.equal(entry.kind, 'workspace-run');
  assert.equal(entry.startedBy, 'github:alice');
  // The run row carries the issue as its source once the pipeline exists.
  const t0 = Date.now();
  while (!entry.pipelineId && Date.now() - t0 < 20_000) await new Promise((r) => setTimeout(r, 50));
  let row = null;
  while (Date.now() - t0 < 20_000) {
    row = db.getDb().prepare('SELECT source_type, source_ref, guardrails_id FROM pipelines WHERE id = ?').get(entry.pipelineId);
    if (row) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(row.source_type, 'github');
  assert.equal(JSON.parse(row.source_ref).url, 'https://github.com/o/b/issues/7');
  assert.equal(row.guardrails_id, 'secure');
  await stopAndSettle(runs, (e) => e === entry);
});

test('over a limit an issue waits in the queue (listed oldest first) and Remove takes it out', async () => {
  await call('POST', '/api/automations/rules', { workspaceId: ws.id, event: 'issue.opened', action: 'run', workflowId: 'wf_default', limits: { maxConcurrent: 1 } });
  const at = new Date(Date.now() + 1000).toISOString();
  const issue = (n) => ({ number: n, html_url: `https://github.com/o/a/issues/${n}`, title: `Bug ${n}`, body: 'x', state: 'open',
    user: { login: 'alice' }, author_association: 'COLLABORATOR', labels: [], created_at: at, updated_at: at });
  const { automations } = server._testing;
  for (const n of [21, 22, 23]) await automations.handleWebhook('issues', { action: 'opened', repository: { full_name: 'o/a' }, issue: issue(n) });
  const g = await (await call('GET', `/api/automations?workspaceId=${ws.id}`)).json();
  assert.deepEqual(g.queue.map((e) => [e.number, e.reason]), [[22, 'concurrency'], [23, 'concurrency']]);
  const all = await (await call('GET', '/api/automations')).json();
  assert.deepEqual(all.queue.map((e) => e.number), [22, 23], 'the overview lists the queue too');
  const rm1 = await call('POST', `/api/automations/events/${g.queue[1].id}/remove`, {});
  assert.equal(rm1.status, 200);
  assert.equal((await rm1.json()).event.reason, 'removed');
  assert.equal((await call('POST', `/api/automations/events/${g.queue[1].id}/remove`, {})).status, 409);
  assert.equal((await call('POST', `/api/automations/events/${g.queue[1].id}/start`, {})).status, 409);
  assert.equal((await call('POST', '/api/automations/events/aev_nope/remove', {})).status, 404);
  const after = await (await call('GET', `/api/automations?workspaceId=${ws.id}`)).json();
  assert.deepEqual(after.queue.map((e) => e.number), [22]);
  const live = g.events.find((e) => e.number === 21) || (await (await call('GET', `/api/automations?workspaceId=${ws.id}`)).json()).events.find((e) => e.number === 21);
  await stopAndSettle(server.runs, (e) => e === server.runs.get(live.runId));
});
