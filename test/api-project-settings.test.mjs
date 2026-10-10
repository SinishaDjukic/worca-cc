// test/api-project-settings.test.mjs — GET/PATCH /api/projects/:key/settings (plans/cascading-settings-design.md §5,
// §8 test 10): round trip, 400 naming the key with nothing written, null back to inherit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);
let sandboxHome, srv, base, key, projectDir, readConfig;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: JSONH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-projset-home-'));
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
  ({ readConfig } = await import('../src/core/config.mjs'));
  projectDir = gitDir('projset');
  await addProject({ name: 'projset', path: projectDir });
  key = projectKey(projectDir);
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

test('GET: every cascadable key, what applies and where it comes from', async () => {
  const r = await call('GET', `/api/projects/${key}/settings`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.own, {});
  assert.deepEqual(r.body.effective.askMaxTurns, { value: 400, source: 'default' });
  assert.deepEqual(r.body.effective['run.engine'], { value: 'claude', source: 'default' });
  assert.ok(r.body.roles.some((s) => s.key === 'planner'), 'the step roles ride along');
  assert.ok('models.codex.steps.planner' in r.body.effective);
  assert.equal('totalCostLimitUsd' in r.body.effective, false, 'user-only keys are not listed');
});

test('PATCH round trip: a value overrides, null clears back to inherit (Review Focus 5)', async () => {
  const set = await call('PATCH', `/api/projects/${key}/settings`, { askMaxTurns: 20, 'run.engine': 'codex', 'models.codex.steps.planner': { model: 'gpt-5.5', effort: 'low' }, 'models.claude.steps.planner': { model: 'claude-opus-5-5', effort: 'max' } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.deepEqual(set.body.own.askMaxTurns, 20);
  assert.deepEqual(set.body.effective['run.engine'], { value: 'codex', source: 'project' });
  assert.deepEqual(set.body.effective['models.codex.steps.planner'], { value: { model: 'gpt-5.5', effort: 'low' }, source: 'project' });
  assert.deepEqual((await readConfig(projectDir)).steps.planner, { model: 'claude-opus-5-5', effort: 'max' }, 'Claude step models use the existing column');
  const clear = await call('PATCH', `/api/projects/${key}/settings`, { askMaxTurns: null, 'run.engine': null, 'models.codex.steps.planner': null, 'models.claude.steps.planner': null });
  assert.equal(clear.status, 200);
  assert.deepEqual(clear.body.own, {});
  assert.deepEqual(clear.body.effective.askMaxTurns, { value: 400, source: 'default' });
});

test('one invalid key writes nothing; the 400 names it (Review Focus 5)', async () => {
  const cases = [
    [{ bogus: 1 }, /unknown setting "bogus"/],
    [{ askMaxTurns: 9999 }, /^askMaxTurns must be an integer between 1 and 500$/],
    [{ askMaxTurns: 5, pipelineCostLimitUsd: -1 }, /^pipelineCostLimitUsd must be a positive number of USD$/],
    [{ askMaxTurns: 5, 'models.codex.steps.planner': { model: 'claude-opus-5-5' } }, /models\.codex\.steps\.planner: "claude-opus-5-5" runs on Claude — this slot picks a model Codex can run/],
    [{ 'models.codex.workspaceScan': { model: 'gpt-5.5' } }, /is set per user, not per project/],
    [{ 'models.claude.steps.ghost': { model: 'claude-opus-5-5' } }, /unknown step "ghost"/],
  ];
  for (const [body, re] of cases) {
    const r = await call('PATCH', `/api/projects/${key}/settings`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, re);
  }
  assert.deepEqual((await call('GET', `/api/projects/${key}/settings`)).body.own, {}, 'askMaxTurns was not written');
  assert.equal((await call('PATCH', `/api/projects/${key}/settings`, [1])).status, 400);
  assert.equal((await call('GET', '/api/projects/nope-deadbeef/settings')).status, 404);
});

test('PATCH /api/config keeps accepting nightMode (compatibility)', async () => {
  const r = await call('PATCH', '/api/config', { projectDir, nightMode: { strategy: 'weights' } });
  assert.equal(r.status, 200);
  const g = await call('GET', `/api/projects/${key}/settings`);
  assert.deepEqual(g.body.effective['nightMode.strategy'], { value: 'weights', source: 'project' });
  await call('PATCH', '/api/config', { projectDir, nightMode: null });
});
