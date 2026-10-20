// test/projects-api.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { checkRows } from './helpers/rows.mjs';
import { displayPath } from '../src/core/projects.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

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

test('projects API: list empty, add, reject duplicate and no-name (400), delete', async () => {
  await checkRows([
    { name: 'projects API: list empty, add, reject duplicate, delete', run: async () => {
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
      assert.deepEqual([j.projects[0].vcs, j.projects[0].workMode], ['none', 'folder']);
      r = await fetch(`${base}/api/projects`); const row = (await r.json()).projects[0];
      assert.equal(row.workMode, 'folder');
      assert.equal(row.displayPath, process.platform === 'win32' ? homeDir : displayPath(homeDir));

      r = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'demo', path: homeDir }),
      });
      assert.equal(r.status, 400);

      r = await fetch(`${base}/api/projects?name=${encodeURIComponent('demo')}`, { method: 'DELETE' });
      assert.equal(r.status, 200);
      assert.deepEqual((await r.json()).projects, []);
    } },
    { name: 'POST of a folder inside a git repo → 400 NESTED_IN_REPO', run: async () => {
      const repo = templateRepo('projapi-nested', { branch: 'main', user: true, files: { 'a.txt': 'a\n' } });
      try {
        const inner = join(repo, 'inner'); await mkdir(inner);
        const r = await fetch(`${base}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'inner', path: inner }),
        });
        const body = await r.json();
        assert.equal(r.status, 400); assert.deepEqual(Object.keys(body).sort(), ['code', 'error', 'partOf', 'repoRoot']); assert.equal(body.error, 'Inside a git repository');
      } finally { await rm(repo, { recursive: true, force: true }); }
    } },
    { name: 'POST /api/projects with no name is a 400', run: async () => {
      const r = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: homeDir }),
      });
      assert.equal(r.status, 400);
    } },
  ]);
});

test('POST /api/projects/bulk: adds valid folders, reports skipped rows with reasons, 200 even when every row is skipped', async () => {
  await checkRows([
    { name: 'POST /api/projects/bulk adds the valid folders and reports the skipped ones', run: async () => {
      const a = join(homeDir, 'bulk-a');
      const b = join(homeDir, 'bulk-b');
      await mkdir(a); await mkdir(b);
      const r = await fetch(`${base}/api/projects/bulk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projects: [
          { name: 'bulk-a', path: a },
          { name: 'bulk-a', path: b },                          // duplicate name in the batch
          { name: 'ghost', path: join(homeDir, 'missing') },    // vanished
        ] }),
      });
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.deepEqual(j.results.map((x) => x.status), ['added', 'skipped', 'skipped']);
      assert.match(j.results[1].reason, /already exists/);
      assert.equal(j.results[2].reason, 'folder does not exist');
      assert.ok(j.projects.some((p) => p.name === 'bulk-a' && p.path === a));
      assert.ok(j.projects.every((p) => p.workMode && typeof p.displayPath === 'string'));
      // cleanup so the other tests in this file see their expected registry
      await fetch(`${base}/api/projects?name=bulk-a`, { method: 'DELETE' });
    } },
    { name: 'POST /api/projects/bulk answers 200 even when every row is skipped', run: async () => {
      const r = await fetch(`${base}/api/projects/bulk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projects: [{ name: '', path: homeDir }] }),
      });
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.equal(j.results[0].status, 'skipped');
      assert.equal(j.results[0].reason, 'project name is required');
    } },
  ]);
});

test('POST /api/projects/bulk rejects a missing, empty or oversized list with 400', async () => {
  for (const body of [{}, { projects: [] }, { projects: 'x' }, { projects: Array.from({ length: 101 }, (_, i) => ({ name: `p${i}`, path: homeDir })) }]) {
    const r = await fetch(`${base}/api/projects/bulk`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 40));
    assert.ok((await r.json()).error);
  }
});
