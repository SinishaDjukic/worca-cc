// test/api-settings-apply.test.mjs — worca Chat P2 Task 1: POST /api/settings and PATCH /api/projects/:key/settings
// share their bodies with Ask's change_setting (applySettingsPatch / applyProjectSettingsPatch).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);
let sandboxHome, mod, srv, base, wsBase, project;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: JSONH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-setapply-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;
  const { addProject } = await import('../src/core/projects.mjs');
  project = (await addProject({ name: 'setapply', path: gitDir('setapply') })).find((p) => p.name === 'setapply');
});

after(async () => {
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

/** The frames one action broadcasts to an open socket (the hello excluded): polled until a `want` frame arrives or
 *  1 s passes — never a fixed sleep (review P2-6). */
async function framesOf(fn, want = 'settings-changed') {
  const ws = new WebSocket(wsBase);
  const frames = [];
  await new Promise((r) => ws.once('open', r));
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d))); } catch { /* not JSON */ } });
  await fn();
  for (const t0 = Date.now(); !frames.some((f) => f.type === want) && Date.now() - t0 < 1000;) await new Promise((r) => setTimeout(r, 10));
  ws.close();
  return frames.filter((f) => f.type !== 'hello');
}

test('applySettingsPatch: the route body without the request — one key writes it, a bad value throws with its field', async () => {
  const { applySettingsPatch } = mod._testing;
  assert.deepEqual(await applySettingsPatch({ theme: 'dark' }), { actionsWarnings: null });
  assert.equal((await call('GET', '/api/settings')).body.theme, 'dark');
  await assert.rejects(applySettingsPatch({ theme: 'neon' }), (e) => e.settingsCtx === 'theme' && /theme must be system, light or dark/.test(e.message));
  assert.equal((await call('GET', '/api/settings')).body.theme, 'dark', 'nothing written on a refusal');
  const bad = await call('POST', '/api/settings', { theme: 'neon' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, 'theme', 'the route still names the field (#555)');
  await applySettingsPatch({ theme: '' });
  assert.equal((await call('GET', '/api/settings')).body.theme, 'system');
});

test('a chat-prefs write now tells the open Settings tabs (settings-changed), like every other Settings card', async () => {
  const frames = await framesOf(async () => {
    const r = await call('POST', '/api/settings', { chat: { notify: { done: false } } });
    assert.equal(r.status, 200);
    assert.equal(r.body.chat.notify.done, false);
  });
  assert.ok(frames.some((f) => f.type === 'settings-changed'), JSON.stringify(frames.map((f) => f.type)));
  await call('POST', '/api/settings', { chat: { notify: { done: true } } });
});

test('applyProjectSettingsPatch: the PATCH body for one project — writes, broadcasts, returns the new state; refusals throw', async () => {
  const { applyProjectSettingsPatch } = mod._testing;
  let state;
  const frames = await framesOf(async () => { state = await applyProjectSettingsPatch(project, { askMaxTurns: 20 }); });
  assert.equal(state.own.askMaxTurns, 20);
  assert.ok(frames.some((f) => f.type === 'settings-changed'));
  assert.equal((await call('GET', `/api/projects/${project.key}/settings`)).body.own.askMaxTurns, 20);
  await assert.rejects(applyProjectSettingsPatch(project, { askMaxTurns: 9999 }), /askMaxTurns must be an integer between 1 and 500/);
  const cleared = await applyProjectSettingsPatch(project, { askMaxTurns: null });
  assert.equal(cleared.own.askMaxTurns, undefined);
  const viaRoute = await call('PATCH', `/api/projects/${project.key}/settings`, { bogus: 1 });
  assert.equal(viaRoute.status, 400);
  assert.match(viaRoute.body.error, /unknown setting "bogus"/);
});

test('a chat engine write tells the open Settings tabs too (the chat changes it: change_setting askEngine)', async () => {
  const { applySettingsPatch } = mod._testing;
  const frames = await framesOf(() => applySettingsPatch({ askEngine: 'claude' }));
  assert.ok(frames.some((f) => f.type === 'settings-changed'), JSON.stringify(frames.map((f) => f.type)));
  await applySettingsPatch({ askEngine: null });
});

test('a chat model write tells the open Settings tabs too (change_setting models.<engine>.ask) (refine cycle 2 mutation killer)', async () => {
  const { applySettingsPatch } = mod._testing;
  const frames = await framesOf(() => applySettingsPatch({ askModels: { claude: null } }));
  assert.ok(frames.some((f) => f.type === 'settings-changed'), JSON.stringify(frames.map((f) => f.type)));
});
