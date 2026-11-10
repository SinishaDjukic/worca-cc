// test/api-workspace-settings.test.mjs — GET/PATCH /api/workspaces/:id/settings: the workspace layer of "open a PR when a
// run finishes" (pr.open), with the team policy's workspaceRuns block over its fields, and nothing written on a refusal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);
let sandboxHome, srv, base, wsId, home, other, K;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: JSONH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const policy = (fields, workspaceRuns = {}) => K.writeTeamPolicyPrefs(K.projectKey(home), {
  present: true, docKnown: true, slug: 'acme/ws-home', headSha: 'abc1234', delegateTo: null,
  doc: { schema: 1, fields, workspaceRuns, catalogs: { guardrailSets: [], models: [] } },
});
const D = (value) => ({ kind: 'default', value });

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-wsset-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  K = { ...(await import('../src/core/config.mjs')), ...(await import('../src/core/store.mjs')), ...(await import('../src/core/workspaces.mjs')), ...(await import('../src/core/db.mjs')) };
  home = gitDir('wsset-a'); other = gitDir('wsset-b');
  wsId = (await K.createWorkspace({ name: 'Settings ws', projectPaths: [home, other], policyProject: home })).id;
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

test('GET: none from the Worca default, team default from the policy home\'s workspaceRuns block, else its fields', async () => {
  const url = `/api/workspaces/${wsId}/settings`;
  assert.deepEqual((await call('GET', url)).body, { own: {}, effective: { 'pr.open': { value: 'none', source: 'default' } }, team: { 'pr.open': null } });
  policy({ 'pr.open': D('ready') });
  assert.deepEqual((await call('GET', url)).body, { own: {}, effective: { 'pr.open': { value: 'ready', source: 'team' } }, team: { 'pr.open': 'ready' } }, 'fields apply when workspaceRuns is silent');
  policy({ 'pr.open': D('ready') }, { 'pr.open': D('draft') });
  assert.equal((await call('GET', url)).body.team['pr.open'], 'draft', 'workspaceRuns replaces fields');
  const set = await call('PATCH', url, { 'pr.open': 'none' });
  assert.deepEqual([set.status, set.body.own, set.body.effective['pr.open'], set.body.team['pr.open']], [200, { 'pr.open': 'none' }, { value: 'none', source: 'workspace' }, 'draft'], 'its own value wins over the team');
  const cleared = await call('PATCH', url, { 'pr.open': null });
  assert.deepEqual(cleared.body.effective['pr.open'], { value: 'draft', source: 'team' });
  K.writeTeamPolicyPrefs(K.projectKey(home), { present: false });
});

test('PATCH sets, null clears, unknown key 400, pr.slices 400, unknown workspace 404, a refusal writes nothing', async () => {
  const url = `/api/workspaces/${wsId}/settings`;
  const stored = () => K.getDb().prepare('SELECT settings_json AS s FROM workspaces WHERE id = ?').get(wsId).s;
  assert.equal(stored(), null);
  assert.equal((await call('PATCH', url, { 'pr.open': 'draft' })).status, 200);
  assert.equal(stored(), '{"pr.open":"draft"}');
  for (const [body, status, error] of [
    [{ 'pr.slices': 'one' }, 400, 'pr.slices is set per project (workspace runs are never sliced)'],
    [{ nope: 'x' }, 400, 'unknown workspace setting "nope"'],
    [{ 'pr.open': 'sometimes' }, 400, 'pr.open must be one of none | draft | ready'],
    [{ 'pr.open': 'none', nope: 1 }, 400, 'unknown workspace setting "nope"'],
    [['pr.open'], 400, 'workspace settings must be an object of setting id → value (null clears it)'],
  ]) {
    const r = await call('PATCH', url, body);
    assert.deepEqual([r.status, r.body.error], [status, error], JSON.stringify(body));
  }
  assert.equal(stored(), '{"pr.open":"draft"}', 'every refusal left the stored value alone');
  const gone = await call('PATCH', '/api/workspaces/wks-nope-00000000/settings', { 'pr.open': 'none' });
  assert.equal(gone.status, 404);
  assert.equal(gone.body?.code, 'NOT_FOUND');
  assert.equal((await call('GET', '/api/workspaces/not-a-key/settings')).status, 404);
  assert.equal((await call('PATCH', url, { 'pr.open': null })).status, 200);
  assert.equal(stored(), null, 'an empty store is NULL again');
});
