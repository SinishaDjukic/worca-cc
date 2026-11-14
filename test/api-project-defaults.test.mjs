// Design-introduced New run defaults (Stillhet slice 9 D19): a project's default Labels beside its default tags
// (GET/PUT /api/projects/:key/tags/defaults gain an optional `labels`), and a workspace's own cost tags and Labels
// (GET/PUT /api/workspaces/:id/defaults). A body with only `tags` behaves as before.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after, 'worca-cc-projdef-');
const prevEnv = {};
let sandboxHome, srv, base, key, ws;
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: JSONH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-projdef-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const one = realpathSync(gitDir('projdef-a')), two = realpathSync(gitDir('projdef-b'));
  await addProject({ name: 'projdef-a', path: one });
  await addProject({ name: 'projdef-b', path: two });
  key = projectKey(one);
  const made = await call('POST', '/api/workspaces', { name: 'Defaults pair', projectPaths: [one, two] });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  ws = made.body.workspace;
});
after(async () => {
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(sandboxHome, { recursive: true, force: true });
});

test('project defaults: PUT {tags, labels} then GET answers both; a PUT with only tags keeps the labels', async () => {
  assert.deepEqual((await call('GET', `/api/projects/${key}/tags/defaults`)).body, { tags: [], labels: [] });
  const put = await call('PUT', `/api/projects/${key}/tags/defaults`, { tags: ['client:acme'], labels: ['Billing', 'urgent'] });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual(put.body, { tags: ['client:acme'], labels: ['billing', 'urgent'] });
  assert.deepEqual((await call('GET', `/api/projects/${key}/tags/defaults`)).body, { tags: ['client:acme'], labels: ['billing', 'urgent'] });
  const tagsOnly = await call('PUT', `/api/projects/${key}/tags/defaults`, { tags: ['client:globex'] });
  assert.deepEqual(tagsOnly.body, { tags: ['client:globex'], labels: ['billing', 'urgent'] });
});

test('project defaults: a project settings PATCH keeps the labels; a bad tag or label is 400 and stores nothing', async () => {
  assert.equal((await call('PATCH', `/api/projects/${key}/settings`, { 'pr.open': 'draft' })).status, 200);
  assert.deepEqual((await call('GET', `/api/projects/${key}/tags/defaults`)).body.labels, ['billing', 'urgent']);
  const before = (await call('GET', `/api/projects/${key}/tags/defaults`)).body;
  assert.equal((await call('PUT', `/api/projects/${key}/tags/defaults`, { tags: ['no colon here'], labels: ['x'] })).status, 400);
  assert.equal((await call('PUT', `/api/projects/${key}/tags/defaults`, { tags: [], labels: 'not a list' })).status, 400);
  assert.deepEqual((await call('GET', `/api/projects/${key}/tags/defaults`)).body, before);
});

test('workspace defaults: GET/PUT /api/workspaces/:id/defaults round-trips {tags, labels}; a bad tag is 400 and stores nothing', async () => {
  assert.deepEqual((await call('GET', `/api/workspaces/${ws.id}/defaults`)).body, { tags: [], labels: [] });
  const put = await call('PUT', `/api/workspaces/${ws.id}/defaults`, { tags: ['team:web'], labels: ['shop'] });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual(put.body, { tags: ['team:web'], labels: ['shop'] });
  assert.deepEqual((await call('GET', `/api/workspaces/${ws.id}/defaults`)).body, { tags: ['team:web'], labels: ['shop'] });
  assert.equal((await call('PUT', `/api/workspaces/${ws.id}/defaults`, { tags: ['no colon here'], labels: [] })).status, 400);
  assert.deepEqual((await call('GET', `/api/workspaces/${ws.id}/defaults`)).body, { tags: ['team:web'], labels: ['shop'] });
  assert.equal((await call('GET', '/api/workspaces/wks-nope-0000abcd/defaults')).status, 404);
});

test('workspace defaults: a PUT with only tags keeps the labels; labels:null is 400 and stores nothing', async () => {
  await call('PUT', `/api/workspaces/${ws.id}/defaults`, { tags: ['team:web'], labels: ['shop'] });
  const tagsOnly = await call('PUT', `/api/workspaces/${ws.id}/defaults`, { tags: ['team:app'] });
  assert.equal(tagsOnly.status, 200, JSON.stringify(tagsOnly.body));
  assert.deepEqual(tagsOnly.body, { tags: ['team:app'], labels: ['shop'] });
  const nul = await call('PUT', `/api/workspaces/${ws.id}/defaults`, { tags: ['team:x'], labels: null });
  assert.deepEqual([nul.status, nul.body.code], [400, 'INVALID']);
  assert.deepEqual((await call('GET', `/api/workspaces/${ws.id}/defaults`)).body, { tags: ['team:app'], labels: ['shop'] });
});
