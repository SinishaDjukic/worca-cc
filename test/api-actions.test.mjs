// test/api-actions.test.mjs — the Actions server surface (issue #529, plan Step 10), local mode.
// Check out a finished run, run its setup once, start/stop a service on an allocated port,
// the action-* WS frames with replay, the raw-command and agent-isolation refusals (D4/D5),
// the project config PUT, queued starts behind setup (D25), setup failure, stop by instance
// id (D28), discard, and a workspace stack step that runs its member's pending setup (D29).
// The tests share one checkout and run in file order; discard comes after every test that
// needs a live checkout. Commands are "<execPath>" "<script>", so nothing depends on a shell tool.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

const prev = { WORCA_HOME: process.env.WORCA_HOME, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
const created = [];
let homeDir, srv, base, wsBase, repo, key, id, id2, id3, id4, SRV;
let factsWs, factsMs, factsRun;            // the change-facts workspace run; the 409 guard test reuses it
const JSONH = { 'Content-Type': 'application/json' };
const NODE = `"${process.execPath}"`;
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function freshRepo(prefix = 'worca-cc-apiact-') {
  const dir = templateRepo('apiact', { branch: 'main', user: true, files: { 'README.md': '# hi\n' }, prefix });
  created.push(dir);
  return dir;
}

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const put = (p, body) => fetch(`${base}${p}`, { method: 'PUT', headers: JSONH, body: JSON.stringify(body) });
const getJson = async (p) => (await fetch(`${base}${p}`)).json();
let RUN;
const configure = (setup) => put(`/api/projects/${key}/actions`, { setup, actions: [RUN] });

function openWs(query = '') {
  const ws = new WebSocket(`${wsBase}${query}`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, opened };
}
async function waitFor(pred, timeoutMs = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apiact-home-'));
  process.env.WORCA_HOME = homeDir;
  process.env.HOME = homeDir;               // settingsFile() lives under HOME: defaults, never the developer's
  process.env.USERPROFILE = homeDir;
  _resetForTests();
  SRV = join(homeDir, 'srv.mjs');
  await writeFile(SRV, `import http from 'node:http';
http.createServer((q, s) => s.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');
console.log('listening on ' + process.env.PORT);
`);
  RUN = { id: 'run', label: 'Run', kind: 'service', cmd: `${NODE} "${SRV}"`,
    env: [{ name: 'PORT', type: 'port', value: 'auto' }], openUrl: 'http://localhost:{PORT}', ready: { kind: 'port' } };

  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  const { addProject, worcaHome } = await import('../src/core/projects.mjs');
  repo = await realpath(await freshRepo());   // the store records the realpath (macOS /var -> /private/var)
  await addProject({ name: basename(repo), path: repo });
  const seed = async (feature) => {
    git(repo, ['branch', feature]);
    const s = await seedPipeline(repo, { status: 'done',
      branch: { source: 'main', feature, runRootMode: 'detached', worktreeRemoved: true, branchKept: true } });
    getDb().prepare(`UPDATE pipelines SET branch = json_set(branch, '$.worktreeDir', ?) WHERE id = ?`)
      .run(join(worcaHome(), 'runs', s.id, 'repos', s.key), s.id);
    return s;
  };
  ({ id, key } = await seed('worca-cc/x'));
  ({ id: id2 } = await seed('worca-cc/x2'));
  ({ id: id3 } = await seed('worca-cc/x3'));
  ({ id: id4 } = await seed('worca-cc/x4'));

  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
  assert.equal((await configure(`${NODE} -e "console.log('installing')"`)).status, 200);
});

after(async () => {
  delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME;
  if (base) {
    for (const s of await getJson('/api/actions/running').catch(() => [])) {
      await post(`/api/actions/instances/${encodeURIComponent(s.instanceId)}/stop`, {}).catch(() => {});
    }
  }
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await Promise.all([homeDir, ...created].filter(Boolean).map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 })));
});

test('GET /api/runs/:id/actions shows not-checked-out with copy command', async () => {
  const r = await getJson(`/api/runs/${id}/actions?projectKey=${key}`);
  assert.equal(r.enabled, true);
  assert.equal(r.members[0].state, 'not-checked-out');
  assert.equal(r.members[0].copyCommand, `cd "${repo}"\ngit switch worca-cc/x`);
});

test('checkout runs setup once and streams action-* frames with replay', async () => {
  const { ws, msgs, opened } = openWs(); await opened;
  const res = await post(`/api/runs/${id}/checkout?projectKey=${key}`, {});
  assert.equal(res.status, 200);
  await waitFor(() => msgs.some((m) => m.type === 'actions-changed'));   // the strips refetch (audit F-2)
  await waitFor(() => msgs.some((m) => m.type === 'action-status' && m.snapshot.actionId === '__setup' && m.snapshot.status === 'exited'));
  await waitFor(async () => (await getJson(`/api/runs/${id}/actions?projectKey=${key}`)).members[0].checkout?.setup?.status === 'ok');
  const model = await getJson(`/api/runs/${id}/actions?projectKey=${key}`);
  assert.equal(model.members[0].checkout.setup.status, 'ok');
  assert.equal(model.members[0].state, 'checked-out');
  // second checkout: idempotent, setup NOT re-run
  const before = msgs.filter((m) => m.type === 'action-status' && m.snapshot.actionId === '__setup').length;
  assert.equal((await post(`/api/runs/${id}/checkout?projectKey=${key}`, {})).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(msgs.filter((m) => m.type === 'action-status' && m.snapshot.actionId === '__setup').length, before);
  // replay on reconnect
  const setupId = `act:${id}:${key}:__setup`;
  const again = openWs(); await again.opened;
  again.ws.send(JSON.stringify({ type: 'subscribe', instanceId: setupId }));
  await waitFor(() => again.msgs.some((m) => m.type === 'action-line' && m.instanceId === setupId));
  // ?instanceId= on connect replays as well
  const third = openWs(`?instanceId=${encodeURIComponent(setupId)}`); await third.opened;
  await waitFor(() => third.msgs.some((m) => m.type === 'action-line' && m.instanceId === setupId && /installing/.test(m.text)));
  ws.close(); again.ws.close(); third.ws.close();
});

test('service starts on an allocated port, appears in /api/actions/running, stops', async () => {
  const s = await (await post(`/api/runs/${id}/actions/run/start?projectKey=${key}`, {})).json();
  assert.ok(s.ports.PORT >= 4400 && s.ports.PORT <= 4499);
  await waitFor(async () => (await getJson('/api/actions/running')).some((x) => x.instanceId === s.instanceId && x.status === 'ready'));
  const setupAgain = await post(`/api/runs/${id}/setup?projectKey=${key}`, {});
  assert.equal(setupAgain.status, 409);
  assert.equal((await setupAgain.json()).code, 'SERVICES_RUNNING');
  assert.equal((await post(`/api/runs/${id}/actions/run/stop?projectKey=${key}`, {})).status, 200);
  assert.equal((await getJson('/api/actions/running')).some((x) => x.instanceId === s.instanceId), false);
});

test('raw command bodies are rejected', async () => {
  const r = await post(`/api/runs/${id}/actions/run/start?projectKey=${key}`, { cmd: 'rm -rf /' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'RAW_COMMAND');
});

test('agent isolation: a loopback caller cannot start actions or set the actions settings (D4)', async () => {
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(homeDir, 'agent');
  try {
    const r = await post(`/api/runs/${id}/actions/run/start?projectKey=${key}`, {});
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, 'AGENT_CALLER_BLOCKED');
    const p = await put(`/api/projects/${key}/actions`, { setup: 'true', actions: [] });
    assert.equal(p.status, 403);
    assert.equal((await p.json()).code, 'AGENT_CALLER_BLOCKED');
    const s = await post('/api/settings', { actions: { editor: '/tmp/x.sh' } });
    assert.equal(s.status, 403);
    assert.equal((await s.json()).code, 'AGENT_CALLER_BLOCKED');
    // G1: no part of the API answers a possible agent, other settings included
    assert.equal((await post('/api/settings', { schedule: {} })).status, 403);
    const t = await post('/api/actions/launchers/try', { kind: 'editor', line: 'true' });
    assert.equal(t.status, 403, 'Try runs a command line: the same guard as saving one');
    assert.equal((await t.json()).code, 'AGENT_CALLER_BLOCKED');
  } finally {
    delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME;
  }
  assert.equal((await getJson('/api/settings')).actions.editor, '');
  assert.equal((await getJson(`/api/projects/${key}/actions`)).config.actions[0].id, 'run');
});

test('running rows carry histKey; a service stops by instance id without a run scope (D28)', async () => {
  const s = await (await post(`/api/runs/${id}/actions/run/start?projectKey=${key}`, {})).json();
  const rows = await getJson('/api/actions/running');
  const row = rows.find((x) => x.instanceId === s.instanceId);
  assert.equal(row.histKey, key);
  assert.equal(row.workspaceId, null);
  const r = await post(`/api/actions/instances/${encodeURIComponent(s.instanceId)}/stop`, {});
  assert.equal(r.status, 200);
  assert.equal((await post(`/api/actions/instances/${encodeURIComponent('act:nope:x:y')}/stop`, {})).status, 404);
  assert.equal((await post(`/api/actions/instances/${encodeURIComponent(s.instanceId)}/stop`, { cmd: 'x' })).status, 400);
});

test('action entries never appear as live runs', async () => {
  // runs BEFORE the discard test: it needs a live checkout to start a service in
  const s = await (await post(`/api/runs/${id}/actions/run/start?projectKey=${key}`, {})).json();
  assert.ok(s.instanceId);
  const { ws, msgs, opened } = openWs(); await opened;
  await waitFor(() => msgs.some((m) => m.type === 'hello'));
  assert.equal(msgs.find((m) => m.type === 'hello').runs.some((r) => String(r.runId).startsWith('act:')), false);
  ws.close();
});

test('discard stops services first then removes the worktree', async () => {
  await post(`/api/runs/${id}/actions/run/start?projectKey=${key}`, {});
  const { ws, msgs, opened } = openWs(); await opened;
  const r = await fetch(`${base}/api/runs/${id}/checkout?projectKey=${key}`, { method: 'DELETE', headers: JSONH, body: '{}' });
  assert.equal(r.status, 200);
  await waitFor(() => msgs.some((m) => m.type === 'actions-changed' && m.action === 'checkout'));
  ws.close();
  assert.equal((await getJson('/api/actions/running')).length, 0);
  assert.equal((await getJson(`/api/runs/${id}/actions?projectKey=${key}`)).members[0].state, 'not-checked-out');
});

test('PUT /api/projects/:key/actions validates and stores; a javascript: open link is refused', async () => {
  const bad = await put(`/api/projects/${key}/actions`, { actions: [{ id: 'x', kind: 'daemon', cmd: 'a' }] });
  assert.equal(bad.status, 400);
  const xss = await put(`/api/projects/${key}/actions`, { actions: [{ id: 'x', kind: 'task', cmd: 'a', openUrl: 'javascript:alert(1)' }] });
  assert.equal(xss.status, 400);
  assert.equal((await xss.json()).field, 'actions[0].openUrl');
  const ok = await put(`/api/projects/${key}/actions`, { setup: 'true', actions: [] });
  assert.equal(ok.status, 200);
  assert.deepEqual((await getJson(`/api/projects/${key}/actions`)).config.actions, []);
});

test('start while setup is still running is queued (202) and runs after setup (D25)', async () => {
  await configure(`${NODE} -e "setTimeout(() => {}, 800)"`);          // the PUT test above left actions: []
  await post(`/api/runs/${id2}/checkout?projectKey=${key}`, {});      // id2: a second done run of the same project
  const r = await post(`/api/runs/${id2}/actions/run/start?projectKey=${key}`, {});
  assert.equal(r.status, 202);
  const { queued, instanceId } = await r.json();
  assert.equal(queued, true);
  await waitFor(async () => (await getJson('/api/actions/running')).some((x) => x.instanceId === instanceId));
  const model = await getJson(`/api/runs/${id2}/actions?projectKey=${key}`);
  assert.equal(model.members[0].checkout.setup.status, 'ok');                // setup finished BEFORE the start
  await post(`/api/runs/${id2}/actions/run/stop?projectKey=${key}`, {});
});

test('setup failure blocks start with 409 SETUP_FAILED; POST /setup re-runs it', async () => {
  await configure(`${NODE} -e "process.exit(3)"`);
  await post(`/api/runs/${id3}/checkout?projectKey=${key}`, {});      // id3: a third done run
  await waitFor(async () => (await getJson(`/api/runs/${id3}/actions?projectKey=${key}`)).members[0].checkout?.setup?.status === 'failed');
  const r = await post(`/api/runs/${id3}/actions/run/start?projectKey=${key}`, {});
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'SETUP_FAILED');
  assert.equal((await post(`/api/runs/${id3}/setup?projectKey=${key}`, {})).status, 202);
  await waitFor(async () => (await getJson(`/api/runs/${id3}/actions?projectKey=${key}`)).members[0].setupQueued === false);
});

test('a queued start whose setup fails sends a snapshot-less action-status with the reason', async () => {
  await configure(`${NODE} -e "setTimeout(() => process.exit(3), 400)"`);
  const { ws, msgs, opened } = openWs(); await opened;
  await post(`/api/runs/${id4}/checkout?projectKey=${key}`, {});      // id4: a fourth done run
  const r = await post(`/api/runs/${id4}/actions/run/start?projectKey=${key}`, {});
  assert.equal(r.status, 202);
  const { instanceId } = await r.json();
  ws.send(JSON.stringify({ type: 'subscribe', instanceId }));
  const frame = await waitFor(() => msgs.find((m) => m.type === 'action-status' && m.instanceId === instanceId));
  assert.equal(frame.snapshot, null);
  assert.match(frame.error, /^Not started: the setup command did not finish/);
  ws.close();
});

// ── workspace section ───────────────────────────────────────────────────────────────────
test('a stack step on a member whose setup is pending runs that setup first (D29)', async () => {
  const { createWorkspace, workspaceMembers } = await import('../src/core/workspaces.mjs');
  const { addProject, worcaHome } = await import('../src/core/projects.mjs');
  const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
  const { setSetupState } = await import('../src/core/checkout.mjs');
  const a = await freshRepo('worca-cc-apiact-wa-');
  const b = await freshRepo('worca-cc-apiact-wb-');
  for (const d of [a, b]) await addProject({ name: basename(d), path: d });
  const ws = await createWorkspace({ name: 'Actions WS', projectPaths: [a, b] });
  const members = await workspaceMembers(ws.id);
  const wsId = randomUUID().slice(0, 8);
  const branches = {};
  for (const [i, m] of members.entries()) {
    const feature = `worca-cc/ws${i}`;
    git(m.projectDir, ['branch', feature]);
    branches[m.projectKey] = { source: 'main', feature, runRootMode: 'detached', worktreeRemoved: true, branchKept: true,
      worktreeDir: join(worcaHome(), 'runs', wsId, 'repos', m.projectKey) };
  }
  seedPipelineRow({ id: wsId, projectKey: members[0].projectKey, workspaceKey: ws.id, target: 'workspace', status: 'done',
    workspaceMeta: { runRootMode: 'detached', projects: members.map((m) => ({ projectKey: m.projectKey, projectDir: m.projectDir, projectName: m.name })), branches } });
  const pk = members[0].projectKey;
  const setupSrc = join(homeDir, 'ws-setup.mjs');
  await writeFile(setupSrc, `setTimeout(() => console.log('installed'), 300);\n`);
  for (const m of members) {
    const r = await put(`/api/projects/${m.projectKey}/actions`, { setup: `${NODE} "${setupSrc}"`, actions: [RUN] });
    assert.equal(r.status, 200);
  }
  const st = await put(`/api/workspaces/${ws.id}/actions`, { stacks: [{ id: 'dev', label: 'Dev', kind: 'service', steps: [{ member: pk, action: 'run', env: [] }] }] });
  assert.equal(st.status, 200);
  const wsModel = await getJson(`/api/workspaces/${ws.id}/actions`);
  assert.equal(wsModel.stacks[0].id, 'dev');
  assert.ok(wsModel.members.every((m) => typeof m.alias === 'string'));

  const scope = `workspaceId=${ws.id}`;
  // Check out (setup runs once), then mark one member `pending`, as a kept-by-policy checkout is.
  assert.equal((await post(`/api/runs/${wsId}/checkout?${scope}`, {})).status, 200);
  await waitFor(async () => (await getJson(`/api/runs/${wsId}/actions?${scope}`)).members.every((m) => m.checkout?.setup?.status === 'ok'));
  setSetupState(wsId, pk, { status: 'pending' });

  const r = await post(`/api/runs/${wsId}/stacks/dev/start?${scope}`, {});
  assert.equal(r.status, 200);
  await waitFor(async () => (await getJson(`/api/runs/${wsId}/actions?${scope}`)).stackStates.some((s) => s.stackId === 'dev' && s.status === 'running'));
  const model = await getJson(`/api/runs/${wsId}/actions?${scope}`);
  assert.equal(model.members.find((m) => m.projectKey === pk).checkout.setup.status, 'ok');
  const setupInst = model.instances.find((x) => x.member === pk && x.actionId === '__setup');
  const runInst = model.instances.find((x) => x.member === pk && x.actionId === 'run');
  assert.ok(setupInst.endedAt <= runInst.startedAt, 'setup ended before the step started');
  assert.equal((await post(`/api/runs/${wsId}/stacks/dev/stop?${scope}`, {})).status, 200);
  assert.equal((await getJson('/api/actions/running')).some((x) => x.runId === wsId), false);
  assert.equal((await fetch(`${base}/api/runs/${wsId}/checkout?${scope}`, { method: 'DELETE', headers: JSONH, body: '{}' })).status, 200);
});

test('GET /actions carries per-member change facts and a totals object', async () => {
  // Build a 2-member workspace run, freeze results.json so one member changed and one did not.
  const { createWorkspace, workspaceMembers } = await import('../src/core/workspaces.mjs');
  const { addProject } = await import('../src/core/projects.mjs');
  const { seedWorkspacePipeline } = await import('./helpers/db-seed.mjs');
  const a = await freshRepo('worca-cc-apiact-fa-');
  const b = await freshRepo('worca-cc-apiact-fb-');
  for (const d of [a, b]) await addProject({ name: basename(d), path: d });
  factsWs = await createWorkspace({ name: 'Facts WS', projectPaths: [a, b] });
  factsMs = await workspaceMembers(factsWs.id);
  const branches = {};
  for (const [i, m] of factsMs.entries()) { git(m.projectDir, ['branch', `worca-cc/f${i}`]); branches[m.projectKey] = { source: 'main', feature: `worca-cc/f${i}`, runRootMode: 'detached', worktreeRemoved: true, branchKept: true }; }
  const projects = factsMs.map((m) => ({ projectKey: m.projectKey, projectDir: m.projectDir, projectName: m.name }));
  factsRun = await seedWorkspacePipeline(factsMs[0].projectDir, factsWs.id, { title: 'facts', status: 'done',
    projects, projectKeys: factsMs.map((m) => m.projectKey), branches, branch: {} }, projects);
  const sum = (n, add) => ({ filesNew: n, filesChanged: 0, filesDeleted: 0, linesAdded: add, linesRemoved: 0 });
  await writeFile(join(factsRun.dir, 'results.json'), JSON.stringify({ summary: sum(3, 30),
    perProject: { [factsMs[0].projectKey]: { summary: sum(3, 30) }, [factsMs[1].projectKey]: { summary: sum(0, 0) } } }));

  const r = await getJson(`/api/runs/${factsRun.id}/actions?workspaceId=${factsWs.id}`);
  const byKey = Object.fromEntries(r.members.map((m) => [m.projectKey, m]));
  assert.equal(byKey[factsMs[0].projectKey].affected, true);
  assert.equal(byKey[factsMs[0].projectKey].files, 3);
  assert.equal(byKey[factsMs[0].projectKey].added, 30);
  assert.equal(byKey[factsMs[1].projectKey].affected, false, 'an all-zero frozen summary proves unchanged');
  assert.deepEqual(r.totals, { members: 2, changed: 1, files: 3, added: 30, removed: 0 });
});

test('checkout refuses a member the run did not change (409), but not a stack or an all-members call', async () => {
  const scope = `workspaceId=${factsWs.id}`;
  const refused = await post(`/api/runs/${factsRun.id}/checkout?${scope}`, { members: [factsMs[1].projectKey] });
  assert.equal(refused.status, 409);
  const body = await refused.json();
  assert.equal(body.code, 'NOT_AFFECTED');
  assert.equal(body.error, 'No changes in this project');
  assert.deepEqual(body.members, [factsMs[1].projectKey]);
  // the changed member still checks out
  assert.equal((await post(`/api/runs/${factsRun.id}/checkout?${scope}`, { members: [factsMs[0].projectKey] })).status, 200);
  // an all-members call is NOT guarded (Ship It's "Try it first" sends {})
  assert.equal((await post(`/api/runs/${factsRun.id}/checkout?${scope}`, {})).status, 200);
  await fetch(`${base}/api/runs/${factsRun.id}/checkout?${scope}`, { method: 'DELETE', headers: JSONH, body: JSON.stringify({ force: true }) });
});

test('a stack step on a member the run did not change checks it out itself, so the 409 guard is not a dead end', async () => {
  const scope = `workspaceId=${factsWs.id}`;
  const cold = factsMs[1].projectKey;                        // the member whose frozen summary is all zeros
  // No setup command: the fresh checkout's `pending` stamp settles as `none`, and the step starts.
  assert.equal((await put(`/api/projects/${cold}/actions`, { setup: '', actions: [RUN] })).status, 200);
  assert.equal((await put(`/api/workspaces/${factsWs.id}/actions`,
    { stacks: [{ id: 'cold', label: 'Cold', kind: 'service', steps: [{ member: cold, action: 'run', env: [] }] }] })).status, 200);
  const before = await getJson(`/api/runs/${factsRun.id}/actions?${scope}`);
  assert.equal(before.members.find((m) => m.projectKey === cold).checkout, null, 'it starts out not checked out');
  // The tab offers no checkout for it and the route refuses one, so the stack is the only way in.
  assert.equal((await post(`/api/runs/${factsRun.id}/checkout?${scope}`, { members: [cold] })).status, 409);

  assert.equal((await post(`/api/runs/${factsRun.id}/stacks/cold/start?${scope}`, {})).status, 200);
  const model = await waitFor(async () => {
    const m = await getJson(`/api/runs/${factsRun.id}/actions?${scope}`);
    const s = m.stackStates.find((x) => x.stackId === 'cold');
    return s && s.status !== 'starting' ? m : null;
  });
  const state = model.stackStates.find((x) => x.stackId === 'cold');
  assert.equal(state.error, null, 'not "<name> is not checked out"');
  assert.equal(state.status, 'running');
  const rec = model.members.find((m) => m.projectKey === cold);
  assert.ok(rec.checkout?.worktreeDir, 'stack start checked the unchanged member out');
  assert.equal(rec.affected, false, 'and it is still reported as unchanged');
  assert.ok(model.instances.some((x) => x.member === cold && x.actionId === 'run'), 'its step really started');
  assert.equal((await post(`/api/runs/${factsRun.id}/stacks/cold/stop?${scope}`, {})).status, 200);
  await fetch(`${base}/api/runs/${factsRun.id}/checkout?${scope}`, { method: 'DELETE', headers: JSONH, body: JSON.stringify({ force: true }) });
});

test('a branch checked out in the project folder: the model names it (heldBy), Check out answers 409 with the holder, useExisting links it', async () => {
  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  const { worcaHome } = await import('../src/core/projects.mjs');
  git(repo, ['switch', '-q', '-c', 'worca-cc/held']);                 // the person works on the run's branch in the project folder
  try {
    const s = await seedPipeline(repo, { status: 'done',
      branch: { source: 'main', feature: 'worca-cc/held', runRootMode: 'detached', worktreeRemoved: true, branchKept: true } });
    getDb().prepare(`UPDATE pipelines SET branch = json_set(branch, '$.worktreeDir', ?) WHERE id = ?`).run(join(worcaHome(), 'runs', s.id, 'repos', s.key), s.id);
    const q = `projectKey=${key}`;
    const m0 = (await getJson(`/api/runs/${s.id}/actions?${q}`)).members[0];
    assert.equal(m0.state, 'not-checked-out');
    assert.equal(await realpath(m0.heldBy), repo);
    const refused = await post(`/api/runs/${s.id}/checkout?${q}`, {});
    assert.equal(refused.status, 409);
    const body = await refused.json();
    assert.equal(body.code, 'BRANCH_CHECKED_OUT');
    assert.equal(await realpath(body.holder), repo);
    const linked = await post(`/api/runs/${s.id}/checkout?${q}`, { useExisting: true });
    assert.equal(linked.status, 200, await linked.clone().text());
    const m1 = (await getJson(`/api/runs/${s.id}/actions?${q}`)).members[0];
    assert.equal(m1.state, 'checked-out');
    assert.equal(m1.checkout.external, true);
    assert.equal(await realpath(m1.checkout.worktreeDir), repo);
    assert.equal(m1.checkout.setup.status, 'skipped', 'setup never runs by itself in the person\'s folder');
    // The Editor built-in runs the saved command line through the shell; a failure at once says why.
    assert.equal((await post('/api/settings', { actions: { editor: `${NODE} -e "process.exit(3)"` } })).status, 200);
    const failed = await post(`/api/runs/${s.id}/builtins/editor?${q}`, { member: key });
    assert.equal(failed.status, 409);
    assert.deepEqual(await failed.json(), { error: 'Editor did not open: the command exited with code 3', code: 'LAUNCH_FAILED' });
    assert.equal((await post('/api/settings', { actions: { editor: `${NODE} -e 0 {folder} {branch}` } })).status, 200);
    assert.equal((await post(`/api/runs/${s.id}/builtins/editor?${q}`, { member: key })).status, 200);
    assert.equal((await post('/api/settings', { actions: { editor: '' } })).status, 200);
    const unlink = await fetch(`${base}/api/runs/${s.id}/checkout?${q}`, { method: 'DELETE', headers: JSONH, body: '{}' });
    assert.equal(unlink.status, 200);
    assert.ok((await realpath(repo)) && git(repo, ['branch', '--show-current']).stdout.trim() === 'worca-cc/held', 'the folder is left as it was');
  } finally { git(repo, ['switch', '-q', 'main']); }
});

test('launchers: what Choose… lists and the examples for this OS; Try runs a line on the home folder; a save warns about a missing program', async () => {
  const l = await getJson('/api/actions/launchers');
  assert.equal(l.platform, process.platform);
  assert.ok(Array.isArray(l.editor) && Array.isArray(l.terminal));
  assert.ok(l.examples.editor.length && l.examples.terminal.length);
  assert.deepEqual(Object.keys(l.detected).sort(), ['editor', 'terminal']);
  if (process.platform === 'darwin') assert.ok(l.terminal.some((t) => t.label === 'Terminal'));

  assert.equal((await post('/api/actions/launchers/try', { kind: 'browser', line: 'x' })).status, 400);
  // Browse… with no app picker on this machine answers unsupported (the page then lists what it found).
  process.env.WORCA_NO_NATIVE_DIALOG = '1';
  try {
    assert.deepEqual(await (await post('/api/actions/launchers/browse', { kind: 'editor' })).json(), { status: 'unsupported' });
    assert.equal((await post('/api/actions/launchers/browse', { kind: 'x' })).status, 400);
  } finally { delete process.env.WORCA_NO_NATIVE_DIALOG; }
  const ok = await post('/api/actions/launchers/try', { kind: 'editor', line: `${NODE} -e 0` });
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.equal((await ok.json()).ok, true);
  if (process.platform !== 'win32') {
    const bad = await post('/api/actions/launchers/try', { kind: 'editor', line: 'worca-no-such-editor-xyz' });
    assert.equal(bad.status, 409);
    assert.match((await bad.json()).error, /worca-no-such-editor-xyz/);
  }

  const saved = await (await post('/api/settings', { actions: { editor: 'worca-no-such-editor-xyz {folder}', terminal: '' } })).json();
  assert.equal(saved.actions.editor, 'worca-no-such-editor-xyz {folder}', 'saved as typed');
  assert.match(saved.actionsWarnings.editor, /^worca-no-such-editor-xyz was not found on this machine/);
  assert.equal(saved.actionsWarnings.terminal, undefined);
  const cleared = await (await post('/api/settings', { actions: { editor: '' } })).json();
  assert.deepEqual(cleared.actionsWarnings, {});
  assert.equal((await post('/api/settings', { actions: { editor: 'x'.repeat(2001) } })).status, 400);
});
