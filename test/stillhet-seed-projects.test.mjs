// test/stillhet-seed-projects.test.mjs — tools/stillhet-seed-projects.mjs (Stillhet slice 9 D20): after seeding, each of
// the seven projects and the one workspace are in their state through dev's own GET routes. An in-process server over
// real local git folders and bare remotes (offline); HOME and WORCA_HOME (which holds Worca's projects folder) are temp folders.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after, 'worca-seed-pj-');
const prevEnv = {};
let srv, base, seeded, seed, home;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-seed-pj-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_PROJECTS_ROOT', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  Object.assign(process.env, { HOME: home, USERPROFILE: home, WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_MOCK: '1' });
  delete process.env.WORCA_PROJECTS_ROOT;   // seed-owned goes to Worca's own projects folder, under the temp WORCA_HOME (a custom root is never Worca's)
  seed = await import('../tools/stillhet-seed-projects.mjs');
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  await seed.sandboxOnly(base);
  seeded = await seed.seedProjects({ base });
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (seeded?.root) await rm(seeded.root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

const get = async (p) => { const r = await fetch(`${base}${p}`); assert.equal(r.status, 200, p); return r.json(); };

test('SEEDED_PROJECTS lists the 7 states; each holds through dev\'s GET routes', async () => {
  assert.deepEqual(seed.SEEDED_PROJECTS.map((x) => [x.name, x.state]), [['seed-ok', 'up-to-date'], ['seed-behind', 'behind'], ['seed-diverged', 'diverged'], ['seed-local', 'no-upstream'], ['seed-folder', 'folder'], ['seed-moved', 'missing'], ['seed-owned', 'owned']]);
  const rows = Object.fromEntries((await get('/api/projects')).projects.map((p) => [p.name, p]));
  assert.deepEqual(Object.keys(rows).sort(), seed.SEEDED_PROJECTS.map((x) => x.name).sort());
  assert.equal(rows['seed-moved'].exists, false);
  assert.equal(rows['seed-folder'].vcs, 'none');
  assert.equal(rows['seed-owned'].ownedFolder, true);
  const sync = (await get('/api/sync/projects')).projects;
  assert.equal(sync[rows['seed-behind'].key]?.state, 'behind');
  assert.equal(sync[rows['seed-diverged'].key]?.state, 'diverged');
});

test('Seed shop holds seed-ok and seed-local, with one heuristic edge carrying evidence', async () => {
  const ws = (await get('/api/workspaces')).workspaces.find((w) => w.name === 'Seed shop');
  assert.ok(ws);
  assert.equal(ws.projectKeys.length, 2);
  const map = await get(`/api/workspaces/${ws.id}/map`);
  assert.equal(map.edges.length, 1);
  assert.equal(map.edges[0].confidence, 'heuristic');
  assert.deepEqual(map.edges[0].evidence.from[0], { file: 'src/client.js', line: 3, match: 'GET /invoices/{id}' });
});

test('sandboxOnly refuses a server that already has projects', async () => {
  await assert.rejects(seed.sandboxOnly(base), /not a blank sandbox/);
});
