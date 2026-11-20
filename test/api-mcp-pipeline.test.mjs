// test/api-mcp-pipeline.test.mjs — MCP registry design §6.2, §12: POST /api/mcp/preview, the
// `mcpOptOut` of POST /api/run (validation, unknown memberships dropped, schedules replay it) and
// of GET /api/policy/notes. App imported (no port bind), real fetch, WORCA_MOCK=1, temp WORCA_HOME,
// a registry built through the real store API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { rm } from 'node:fs/promises';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { withGw } from './helpers/with-env.mjs';
import { addProject } from '../src/core/projects.mjs';
import { createWorkspace } from '../src/core/workspaces.mjs';
import { projectKey } from '../src/core/store.mjs';
import { addManualServer, createSet, putMember, deleteMember, setProjectAssignment } from '../src/core/mcp/store.mjs';

const home = useTempHome(after);
let srv, base, runs, dir, key, billing;
const tempDirs = [];   // workspace members, removed once the runs on them have stopped
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
const inFuture = (ms) => new Date(Date.now() + ms).toISOString();

before(async () => {
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  runs = mod.runs;
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  dir = gitDir('mcp-api');
  await addProject({ name: 'mcp-api', path: dir });
  key = projectKey(dir);
  const pg = await addManualServer('pg', {
    type: 'stdio', command: 'node', args: ['/srv/pg.js'], env: { PGPASSWORD: { field: 'password' } },
    fields: [{ key: 'password', label: 'Password', secret: true, required: true }], description: 'Read-only replica',
  });
  const sentry = await addManualServer('sentry', {
    type: 'http', url: 'https://mcp.sentry.dev/mcp', headers: { Authorization: { field: 'token', prefix: 'Bearer ' } },
    fields: [{ key: 'token', label: 'Sentry token', secret: true, required: true }], description: 'Sentry issues',
  });
  billing = await createSet('Billing');
  await putMember(billing.id, 'manual:pg', { enabled: true, values: {}, secrets: { password: 'pg-secret-value-1' } }, { def: pg });
  await putMember(billing.id, 'manual:sentry', { enabled: true, values: {} }, { def: sentry });   // token not set
  await setProjectAssignment(key, { sets: [billing.id], includeGeneral: false });
});
after(async () => {
  // The mock runs these tests start keep going in the background (worktree, branch, mock steps):
  // stop each and wait for it to unwind, or its git writes race the rm below (ENOTEMPTY on .git/logs).
  for (const e of runs?.values() ?? []) { try { e.orch.stop(); } catch { /* already over */ } }
  await Promise.all([...(runs?.values() ?? [])].map((e) => e.launch?.catch(() => {})));
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  await Promise.all([dir, ...tempDirs].map((d) => rm(d, { recursive: true, force: true })));
});

test('POST /api/mcp/preview: the resolver arrays for a project target, skips worded, no secret in the answer', async () => {
  const r = await post('/api/mcp/preview', { target: { projectKey: key } });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.copies.map((c) => c.name), [`pg_${billing.slug}`]);
  assert.equal(body.started, 1);
  assert.deepEqual(body.skipped.map((s) => [s.serverId, s.reason]), [['manual:sentry', 'missing:token']]);
  assert.deepEqual([body.skipped[0].message, body.skipped[0].why], ['sentry in Billing skipped: Sentry token not set', 'Sentry token not set']);
  assert.deepEqual(body.sets.map((s) => s.id), [billing.id]);
  assert.deepEqual(body.deviations, []);
  assert.deepEqual(body.skippedTools, [], '§5.6: per-tool skips ride along (none here: no Test result yet)');
  assert.equal(body.newer, false, '§4.5: true when the store needs a newer Worca (everything then resolves to nothing)');
  assert.ok(!JSON.stringify(body).includes('pg-secret-value-1'));

  const opted = await (await post('/api/mcp/preview', { target: { projectKey: key }, mcpOptOut: [`${billing.id}|manual:pg`] })).json();
  assert.equal(opted.started, 0);
  assert.ok(opted.skipped.some((s) => s.serverId === 'manual:pg' && s.reason === 'opted-out'));
});

test('POST /api/mcp/preview: a workspace target unions its members\' own sets', async () => {
  const other = gitDir('mcp-api-ws');
  const ws = await createWorkspace({ name: 'mcp preview', projectPaths: [dir, other] });
  const body = await (await post('/api/mcp/preview', { target: { workspaceId: ws.id } })).json();
  assert.deepEqual(body.copies.map((c) => [c.name, c.projects]), [[`pg_${billing.slug}`, [key]]]);
  await rm(other, { recursive: true, force: true });
});

test('POST /api/mcp/preview: validation — target shape, unknown target, mcpOptOut and models', async () => {
  const bad = async (b, re, status = 400) => {
    const r = await post('/api/mcp/preview', b);
    assert.equal(r.status, status, JSON.stringify(b));
    assert.match((await r.json()).error, re);
  };
  await bad({}, /target must be/);
  await bad({ target: { projectKey: key, workspaceId: 'wks-a-00000000' } }, /target must be/);
  await bad({ target: { projectKey: '../etc' } }, /target must be/);
  await bad({ target: { projectKey: 'ghost-00000000' } }, /target not found/, 404);
  await bad({ target: { projectKey: key }, mcpOptOut: 'billing|manual:pg' }, /mcpOptOut must be/);
  await bad({ target: { projectKey: key }, mcpOptOut: ['billing|pg'] }, /mcpOptOut must be/);
  await bad({ target: { projectKey: key }, mcpOptOut: Array.from({ length: 101 }, (_, i) => `s${i}|manual:pg`) }, /mcpOptOut must be/);
  await bad({ target: { projectKey: key }, models: 'claude-opus-5-5' }, /models must be/);
});

test('POST /api/mcp/preview: the form\'s models set the tool-name limit (a translated one skips untested copies)', () => withGw(async () => {
  const preview = async (models) => (await post('/api/mcp/preview', { target: { projectKey: key }, models })).json();
  assert.deepEqual((await preview(['claude-opus-5-5'])).copies.map((c) => c.serverId), ['manual:pg'], 'first-party: the untested copy starts');
  const body = await preview(['claude-opus-5-5', 'gw-gpt']);
  assert.equal(body.started, 0);
  assert.ok(body.skipped.some((s) => s.serverId === 'manual:pg' && s.reason === 'untested'));
}));

test('POST /api/run: mcpOptOut is shape-checked, unknown memberships are dropped, the rest reaches the run', async () => {
  const r400 = await post('/api/run', { projectDir: dir, prompt: 'x', mock: true, mcpOptOut: [42] });
  assert.equal(r400.status, 400);
  assert.match((await r400.json()).error, /mcpOptOut must be/);
  const r = await post('/api/run', { projectDir: dir, prompt: 'x', mock: true, mcpOptOut: [`${billing.id}|manual:pg`, 'gone|manual:pg', `${billing.id}|manual:nope`] });
  assert.equal(r.status, 200);
  const { runId } = await r.json();
  assert.deepEqual(runs.get(runId).orch.mcpOptOut, [`${billing.id}|manual:pg`]);
  const plain = await (await post('/api/run', { projectDir: dir, prompt: 'x', mock: true })).json();
  assert.deepEqual(runs.get(plain.runId).orch.mcpOptOut, [], 'a body without it opts out of nothing');
});

test('schedules store mcpOptOut with the request and the firing drops memberships unknown by then', async () => {
  const r = await post('/api/run', { projectDir: dir, prompt: 'later', mock: true, scheduledFor: inFuture(3600_000), mcpOptOut: [`${billing.id}|manual:pg`, `${billing.id}|manual:sentry`] });
  assert.equal(r.status, 202);
  const { runId } = await r.json();
  await deleteMember(billing.id, 'manual:sentry');                                    // gone before it fires
  const now = await post(`/api/schedules/${runId}/run-now`, {});
  assert.equal(now.status, 200);
  assert.deepEqual(runs.get(runId).orch.mcpOptOut, [`${billing.id}|manual:pg`]);
});

test('POST /api/run on a workspace: mcpOptOut reaches the run (unknown dropped) and the workspace schedule replays it', async () => {
  const other = gitDir('mcp-api-ws-run');
  tempDirs.push(other);
  const ws = await createWorkspace({ name: 'mcp run ws', projectPaths: [dir, other] });
  const r = await post('/api/run', { workspaceId: ws.id, prompt: 'x', mock: true, mcpOptOut: [`${billing.id}|manual:pg`, 'gone|manual:pg'] });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(runs.get((await r.json()).runId).orch.mcpOptOut, [`${billing.id}|manual:pg`]);
  const s = await post('/api/run', { workspaceId: ws.id, prompt: 'later', mock: true, scheduledFor: inFuture(3600_000), mcpOptOut: [`${billing.id}|manual:pg`, 'gone|manual:pg'] });   // stored as sent, dropped at fire
  assert.equal(s.status, 202, await s.clone().text());
  const { runId } = await s.json();
  assert.equal((await post(`/api/schedules/${runId}/run-now`, {})).status, 200);
  assert.deepEqual(runs.get(runId).orch.mcpOptOut, [`${billing.id}|manual:pg`]);
});

test('GET /api/policy/notes: mcpOptOut is validated like the run body (no policy ⇒ no notes)', async () => {
  const q = (v) => fetch(`${base}/api/policy/notes?${new URLSearchParams({ scope: `project:${key}`, mcpOptOut: v })}`);
  assert.equal((await q('not-an-entry')).status, 400);
  const twice = new URLSearchParams([['scope', `project:${key}`], ['mcpOptOut', 'bad'], ['mcpOptOut', 'bad2']]);
  assert.equal((await fetch(`${base}/api/policy/notes?${twice}`)).status, 400, 'a repeated parameter is checked, never ignored');
  const ok = await q(`${billing.id}|manual:pg`);
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).notes, []);
});
