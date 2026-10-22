// test/api-house-brief.test.mjs — GET/PUT/POST /api/projects/:key/house-brief (slice 2): the brief with its word count
// and sources, pins persisted, an empty brief for a project with no sources.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);
let sandboxHome, srv, base, key, emptyKey, projectDir, emptyDir, projectStorePath;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: JSONH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-hbrief-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  const store = await import('../src/core/store.mjs');
  projectStorePath = store.projectStorePath;
  // git ls-files runs with --others, so the untracked CLAUDE.md and plans/ spec are listed without a commit.
  projectDir = gitDir('hbrief');
  writeFileSync(join(projectDir, 'CLAUDE.md'), '# Rules\n\nKeep corners at 4px.\n');
  mkdirSync(join(projectDir, 'plans'));
  writeFileSync(join(projectDir, 'plans', 'fit-design.md'), '# Fit\n\nStatus: draft\n\nChecks the plan.\n');
  await addProject({ name: 'hbrief', path: projectDir });
  key = store.projectKey(projectDir);
  emptyDir = gitDir('hbrief-empty');
  await addProject({ name: 'hbrief-empty', path: emptyDir });
  emptyKey = store.projectKey(emptyDir);
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

test('GET returns the brief, word count and sources with read times', async () => {
  const r = await call('GET', `/api/projects/${key}/house-brief`);
  assert.equal(r.status, 200);
  assert.match(r.body.brief, /- Keep corners at 4px\./);
  assert.match(r.body.brief, /- Fit — Checks the plan\. \(plans\/fit-design\.md\)/);
  assert.ok(r.body.words > 0 && r.body.words <= 2000);
  assert.equal(r.body.budget, 2000);
  assert.deepEqual(r.body.sources.map((s) => s.kind), ['claude-md', 'plans']);
  for (const s of r.body.sources) { assert.ok(s.label); assert.equal(typeof s.files, 'number'); assert.ok(!Number.isNaN(Date.parse(s.readAt))); }
  assert.deepEqual(r.body.pinned, []);
});

test('a second GET with nothing changed does not rebuild', async () => {
  const a = await call('GET', `/api/projects/${key}/house-brief`);
  const b = await call('GET', `/api/projects/${key}/house-brief`);
  assert.equal(b.body.rebuilt, false);
  assert.equal(b.body.builtAt, a.body.builtAt);
});

test('PUT of pinned lines persists and is merged into the brief', async () => {
  const put = await call('PUT', `/api/projects/${key}/house-brief/pinned`, { pinned: ['Never add a second check row.', ''] });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.pinned, ['Never add a second check row.']);
  assert.match(put.body.brief, /^# House brief\n\n## Pinned\n- Never add a second check row\./);
  const get = await call('GET', `/api/projects/${key}/house-brief`);
  assert.deepEqual(get.body.pinned, ['Never add a second check row.']);
  const onDisk = JSON.parse(readFileSync(join(projectStorePath(key), 'house-brief-pins.json'), 'utf8'));
  assert.deepEqual(onDisk.pinned, ['Never add a second check row.']);
});

test('PUT rejects a bad pin list with 400 and keeps the stored pins', async () => {
  const r = await call('PUT', `/api/projects/${key}/house-brief/pinned`, { pinned: ['x'.repeat(241)] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /240 characters/);
  assert.deepEqual((await call('GET', `/api/projects/${key}/house-brief`)).body.pinned, ['Never add a second check row.']);
});

test('POST refresh rebuilds now', async () => {
  const r = await call('POST', `/api/projects/${key}/house-brief/refresh`);
  assert.equal(r.status, 200);
  assert.equal(r.body.rebuilt, true);
});

test('a project with no sources returns an empty brief and no error; an unknown project is 404', async () => {
  const r = await call('GET', `/api/projects/${emptyKey}/house-brief`);
  assert.equal(r.status, 200);
  assert.equal(r.body.brief, '');
  assert.equal(r.body.words, 0);
  assert.deepEqual(r.body.sources, []);
  assert.equal((await call('GET', '/api/projects/nope-deadbeef/house-brief')).status, 404);
});
