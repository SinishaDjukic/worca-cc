// test/ui-levels-server.test.mjs — the interface mode over HTTP (docs/ui-levels.md): a fresh install
// serves the shell in simple mode, the first thing a new user does pins that choice (so it does not
// jump to expert once the install stops being "fresh"), and POST /api/settings stores and validates it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home, srv, base, prev, settingsFile, projDir;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-uilevel-'));
  projDir = join(home, 'proj');
  await mkdir(projDir, { recursive: true });
  prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME };
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = join(home, '.worca-cc');
  ({ settingsFile } = await import('../src/core/settings.mjs'));
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true });
});
const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const stored = async () => { try { return JSON.parse(await readFile(settingsFile(), 'utf8')).uiLevel; } catch { return undefined; } };
const shellLevel = async () => ((await (await fetch(`${base}/`)).text()).match(/<html lang="en" data-theme="\w+" data-level="(\w+)">/) || [])[1];

test('fresh install: the shell and GET /api/settings say simple, nothing stored yet', async () => {
  assert.equal(await shellLevel(), 'simple');
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).uiLevel, 'simple');
  assert.equal(await stored(), undefined, 'a GET never writes');
});

test('adding the first project pins simple, so the new user stays in simple mode', async () => {
  const r = await post('/api/projects', { name: 'p', path: projDir });
  assert.equal(r.status, 200);
  assert.equal(await stored(), 'simple');
  assert.equal(await shellLevel(), 'simple', 'not "expert" now that a project exists');
});

test('POST /api/settings {uiLevel} stores a choice and rejects anything else', async () => {
  const ok = await post('/api/settings', { uiLevel: 'advanced' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).uiLevel, 'advanced');
  assert.equal(await shellLevel(), 'advanced');
  const bad = await post('/api/settings', { uiLevel: 'wizard' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /uiLevel must be simple, advanced or expert/);
  assert.equal(await stored(), 'advanced', 'a refused POST changes nothing');
});

test('dismissing the welcome never overwrites a stored choice', async () => {
  assert.equal((await post('/api/onboarding', { welcomeSeen: true })).status, 200);
  assert.equal(await stored(), 'advanced');
});
