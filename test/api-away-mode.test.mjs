// test/api-away-mode.test.mjs
// GET /api/away-mode: what Away mode will do, where each value comes from, what an empty field
// falls back to, the live status and the raw layers the forms edit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);
let homeDir, userHome, srv, base, mod;
const prev = {};
const projects = [];
before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-awayapi-'));
  userHome = await mkdtemp(join(tmpdir(), 'worca-cc-awayapi-home-'));
  prev.WORCA_HOME = process.env.WORCA_HOME;
  for (const k of ['HOME', 'USERPROFILE']) { prev[k] = process.env[k]; process.env[k] = userHome; }
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = appServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const k of ['WORCA_HOME', 'HOME', 'USERPROFILE']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  delete process.env.WORCA_MOCK;
  await Promise.all([homeDir, userHome, ...projects].map((d) => rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })));
});
const api = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const projectDir = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-awayapi-proj-')); projects.push(d); return d; };

test('GET /api/away-mode: effective config, sources, live status, raw layers, and the project layer with ?projectDir=', async () => {
  await checkRows([
    { name: 'GET /api/away-mode: effective config, sources, live status and the raw layers', run: async () => {
      await api('POST', '/api/settings', { nightMode: { window: '22:00-07:00', enabled: true }, nightModeToggle: 'on' });
      const r = await api('GET', '/api/away-mode');
      assert.equal(r.status, 200);
      assert.equal(r.body.toggle, 'on');
      assert.equal(r.body.config.window, '22:00-07:00');
      assert.equal(r.body.sources.window, 'user');
      assert.deepEqual(r.body.user, { window: '22:00-07:00', enabled: true });
      assert.equal(r.body.project, null);
      assert.equal(r.body.inherited.config.window, null, 'user level inherits the default');
      assert.equal(r.body.inherited.sources.window, 'default');
    } },
    { name: 'GET /api/away-mode?projectDir= adds the project layer and says what the user layer gives', run: async () => {
      await api('POST', '/api/settings', { nightMode: { window: '22:00-07:00', enabled: true } });   // self-contained: runs alone too
      const dir = await projectDir();
      await api('PATCH', '/api/config', { projectDir: dir, nightMode: { graceMinutes: 45, enabled: false } });
      const r = await api('GET', `/api/away-mode?projectDir=${encodeURIComponent(dir)}`);
      assert.equal(r.body.config.graceMinutes, 45);
      assert.equal(r.body.sources.graceMinutes, 'project');
      assert.deepEqual(r.body.project, { graceMinutes: 45, enabled: false });
      assert.equal(r.body.config.enabled, false);
      assert.equal(r.body.inherited.config.enabled, true, 'what "Same as my settings" means here');
      assert.equal(r.body.inherited.sources.enabled, 'user');
    } },
  ]);
});

test('POST nightModeToggle "here": stored as auto plus when it was said; GET /api/away-mode reports both', async () => {
  const before = Date.now();
  assert.equal((await api('POST', '/api/settings', { nightModeToggle: 'here' })).status, 200);
  const r = await api('GET', '/api/away-mode');
  assert.equal(r.body.toggle, 'auto');
  assert.ok(r.body.hereSince >= before && r.body.hereSince <= Date.now(), 'the server stamps the time');
  await api('POST', '/api/settings', { nightModeToggle: 'on' });
  assert.equal((await api('GET', '/api/away-mode')).body.hereSince, null);
  assert.equal((await api('POST', '/api/settings', { nightModeToggle: 'later' })).status, 400);
  await api('POST', '/api/settings', { nightModeToggle: 'auto' });
});
