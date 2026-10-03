// test/ask-engine-settings.test.mjs — askEngine and models.<engine>.ask are user-only (cascading-settings-design.md D17).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let sandboxHome, srv, base;
const prevEnv = {};
const post = async (p, b) => { const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) }); return { status: r.status, body: await r.json() }; };
const get = async (p) => { const r = await fetch(`${base}${p}`); return { status: r.status, body: await r.json() }; };

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-ask-engset-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  srv = (await import('../ui/server.mjs')).server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

test('defaults: askEngine claude, no Ask slots; the ids resolve but the project settings list does not carry them', async () => {
  const { resolveSetting, settingIds, settingEntry } = await import('../src/core/settings-cascade.mjs');
  assert.deepEqual(resolveSetting('askEngine'), { value: 'claude', source: 'default', layers: { project: undefined, user: undefined, team: undefined, default: 'claude' } });
  assert.equal(resolveSetting('models.codex.ask').value, undefined);
  assert.equal(settingEntry('models.claude.ask').userOnly, true);
  assert.equal(settingIds({ roles: ['planner'] }).some((id) => id === 'askEngine' || id.endsWith('.ask')), false);
});

test('a project cannot set them', async () => {
  const { assertProjectSettingsPatch } = await import('../src/core/settings-cascade.mjs');
  assert.throws(() => assertProjectSettingsPatch({ askEngine: 'codex' }), /askEngine is set per user, not per project/);
  assert.throws(() => assertProjectSettingsPatch({ 'models.codex.ask': { model: 'gpt-5.5' } }), /models\.codex\.ask is set per user, not per project/);
});

test('POST /api/settings: askEngine and askModels round-trip; null clears; the user layer resolves', async () => {
  const r = await post('/api/settings', { askEngine: 'codex', askModels: { codex: { model: 'gpt-5.5', effort: 'low' } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.askEngine, 'codex');
  assert.deepEqual(r.body.askModels, { codex: { model: 'gpt-5.5', effort: 'low' } });
  const { resolveSetting } = await import('../src/core/settings-cascade.mjs');
  assert.equal(resolveSetting('askEngine').source, 'user');
  assert.deepEqual(resolveSetting('models.codex.ask').value, { model: 'gpt-5.5', effort: 'low' });
  const c = await post('/api/settings', { askEngine: null, askModels: { codex: null } });
  assert.equal(c.body.askEngine, null);
  assert.deepEqual(c.body.askModels, {});
  assert.deepEqual((await get('/api/settings')).body.askModels, {});
});

test('a model of the other engine, a bad effort or an unknown engine is refused; nothing is written', async () => {
  const wrong = await post('/api/settings', { askModels: { codex: { model: 'claude-opus-5-5' } } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, '“Chat model”: "claude-opus-5-5" is a Claude model — this slot picks a Codex model.');
  assert.equal(wrong.body.field, 'askModels.codex');
  const effort = await post('/api/settings', { askModels: { claude: { model: 'claude-opus-5-5', effort: 'low' } } });
  assert.equal(effort.status, 400);
  assert.equal(effort.body.error, '“Chat model” must be one of medium, high, xhigh, max.');
  assert.equal(effort.body.field, 'askModels.claude.effort');
  assert.equal((await post('/api/settings', { askEngine: 'gpt' })).status, 400);
  assert.deepEqual((await get('/api/settings')).body.askModels, {});
});
