// test/projects-api.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';

let homeDir, srv, base, prevHome;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apihome-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  // /api/projects drives addProject/listProjects/removeProject (now DB-backed).
  // Reset the db.mjs singleton so it reopens against THIS home before the first
  // request, and again in teardown, isolating these writes from neighbours in
  // the shared `node --test` run.
  _resetForTests();
  // Imported (not run as main) -> the module must NOT bind its own port.
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true });
});

test('projects API: list empty, add, reject duplicate, delete', async () => {
  let r = await fetch(`${base}/api/projects`);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).projects, []);

  r = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'demo', path: homeDir }),
  });
  assert.equal(r.status, 200);
  let j = await r.json();
  assert.equal(j.projects.length, 1);
  assert.equal(j.projects[0].name, 'demo');
  assert.equal(j.projects[0].exists, true);

  r = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'demo', path: homeDir }),
  });
  assert.equal(r.status, 400);

  r = await fetch(`${base}/api/projects?name=${encodeURIComponent('demo')}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).projects, []);
});

test('POST /api/projects with no name is a 400', async () => {
  const r = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: homeDir }),
  });
  assert.equal(r.status, 400);
});
