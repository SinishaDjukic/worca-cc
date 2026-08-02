// test/api-guardrails.test.mjs
// /api/guardrails CRUD (mirrors test/api-workflows.test.mjs): app imported (no
// port bind), ephemeral http server, real fetch, WORCA_MOCK=1, temp WORCA_HOME.
// The server and this test share one in-process DB singleton, so tests may seed
// pipelines rows directly (the resume-pin 409 fixture).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';

// Outer isolation that outlives the per-suite before/after (async orchestrator
// writes after /api/run must land in temp, not ~) — the api-workflows pattern.
// Keep this FIRST in the file: Task 7 appends /api/run tests whose mock
// pipelines finish asynchronously.
useTempHome(after);

let homeDir, srv, base, prevHome;
const JSONH = { 'Content-Type': 'application/json' };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-grapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const { app } = await import('../ui/server.mjs'); // imported => no port bind
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
});

test('GET /api/guardrails lists built-ins FIRST (Permissive/Normal/Strict)', async () => {
  const r = await fetch(`${base}/api/guardrails`);
  assert.equal(r.status, 200);
  const { guardrails } = await r.json();
  assert.deepEqual(guardrails.slice(0, 3).map((g) => [g.id, g.name, g.origin]),
    [['permissive', 'Permissive', 'builtin'], ['normal', 'Normal', 'builtin'], ['secure', 'Strict', 'builtin']]);
  assert.ok(Array.isArray(guardrails[2].settings.deny) && guardrails[2].settings.deny.length > 0,
    'built-in settings resolve from the preset table');
  assert.deepEqual(guardrails[0].settings,
    { honorProjectSettings: true, envScrub: false, envAllowlist: [], protectedPaths: [], deny: [] },
    'Permissive is the empty policy');
});

test('POST /api/guardrails creates a set -> 201 {guardrails}, then it lists after the built-ins', async () => {
  const r = await fetch(`${base}/api/guardrails`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ name: 'Org Policy', settings: { envScrub: true, deny: ['Bash(curl:*)'] } }),
  });
  assert.equal(r.status, 201);
  const { guardrails: set } = await r.json();
  assert.equal(set.id, 'gr_org-policy');
  assert.equal(set.name, 'Org Policy');
  assert.ok(set.createdAt && set.updatedAt, 'stamped on write');
  const list = (await (await fetch(`${base}/api/guardrails`)).json()).guardrails;
  assert.ok(list.findIndex((g) => g.id === set.id) >= 3, 'user set listed after the 3 built-ins');
});

test('POST /api/guardrails: missing name -> 400; oversized name -> 400; invalid settings -> 400 {errors}', async () => {
  const noName = await fetch(`${base}/api/guardrails`, {
    method: 'POST', headers: JSONH, body: JSON.stringify({ settings: {} }),
  });
  assert.equal(noName.status, 400);
  const longName = await fetch(`${base}/api/guardrails`, {
    method: 'POST', headers: JSONH, body: JSON.stringify({ name: 'x'.repeat(201), settings: {} }),
  });
  assert.equal(longName.status, 400, 'name length cap');
  const bad = await fetch(`${base}/api/guardrails`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ name: 'Bad', settings: { deny: ['rm -rf /'] } }),
  });
  assert.equal(bad.status, 400);
  const body = await bad.json();
  assert.equal(body.error, 'invalid guardrails');
  assert.ok(body.errors.some((e) => e.includes('rm -rf /')));
});

test('POST /api/guardrails is CREATE, not upsert: a same-slug name -> 409, the existing set untouched', async () => {
  const dup = await fetch(`${base}/api/guardrails`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ name: 'ORG-policy', settings: { envScrub: false } }), // slugs to gr_org-policy too
  });
  assert.equal(dup.status, 409);
  assert.match((await dup.json()).error, /already exists/);
  const intact = await (await fetch(`${base}/api/guardrails/gr_org-policy`)).json();
  assert.equal(intact.name, 'Org Policy', 'original name untouched');
  assert.equal(intact.settings.envScrub, true, 'original settings untouched');
});

test('GET /api/guardrails/:id: built-in, user set, and 404', async () => {
  const builtin = await fetch(`${base}/api/guardrails/secure`);
  assert.equal(builtin.status, 200);
  assert.equal((await builtin.json()).name, 'Strict');
  const user = await fetch(`${base}/api/guardrails/gr_org-policy`);
  assert.equal(user.status, 200);
  assert.equal((await user.json()).settings.envScrub, true);
  assert.equal((await fetch(`${base}/api/guardrails/gr_missing`)).status, 404);
});

test('PUT /api/guardrails/:id updates name+settings; built-in 400; unknown 404; invalid 400', async () => {
  const ok = await fetch(`${base}/api/guardrails/gr_org-policy`, {
    method: 'PUT', headers: JSONH,
    body: JSON.stringify({ name: 'Org Policy v2', settings: { envScrub: true, deny: ['Bash(curl:*)', 'Bash(nc:*)'] } }),
  });
  assert.equal(ok.status, 200);
  const { guardrails: set } = await ok.json();
  assert.equal(set.name, 'Org Policy v2');
  assert.deepEqual(set.settings.deny, ['Bash(curl:*)', 'Bash(nc:*)']);
  assert.equal((await fetch(`${base}/api/guardrails/secure`, {
    method: 'PUT', headers: JSONH, body: JSON.stringify({ name: 'X' }),
  })).status, 400, 'built-ins cannot be edited');
  assert.equal((await fetch(`${base}/api/guardrails/gr_missing`, {
    method: 'PUT', headers: JSONH, body: JSON.stringify({ name: 'X' }),
  })).status, 404);
  assert.equal((await fetch(`${base}/api/guardrails/gr_org-policy`, {
    method: 'PUT', headers: JSONH, body: JSON.stringify({ settings: { deny: ['rm -rf /'] } }),
  })).status, 400);
});

test('PUT /api/guardrails/:id with {settings: null} keeps the stored settings (no silent wipe to the empty policy)', async () => {
  const r = await fetch(`${base}/api/guardrails/gr_org-policy`, {
    method: 'PUT', headers: JSONH, body: JSON.stringify({ settings: null }),
  });
  assert.equal(r.status, 200);
  const { guardrails: set } = await r.json();
  assert.equal(set.name, 'Org Policy v2', 'name kept');
  assert.equal(set.settings.envScrub, true, 'settings kept — null means "not provided", never "empty policy"');
  assert.deepEqual(set.settings.deny, ['Bash(curl:*)', 'Bash(nc:*)'], 'deny list kept');
});

test('DELETE /api/guardrails/:id: pinned by a paused run -> 409 {error, references}; unpinned -> 200 {ok}', async () => {
  // Seed the pin directly: the server and this test share the process-wide DB
  // singleton (same WORCA_HOME), so a raw pipelines row is visible to the route.
  const { getDb } = await import('../src/core/db.mjs');
  getDb().prepare(
    "INSERT INTO pipelines (id, project_key, status, resume_point) VALUES ('gr-pin-1', 'k1', 'paused', ?)"
  ).run(JSON.stringify({ version: 1, guardrailsId: 'gr_org-policy' }));
  const blocked = await fetch(`${base}/api/guardrails/gr_org-policy`, { method: 'DELETE' });
  assert.equal(blocked.status, 409);
  const body = await blocked.json();
  assert.match(body.error, /still referenced/);
  assert.deepEqual(body.references, [{ id: 'gr_org-policy', referencedBy: ['pipeline gr-pin-1'] }]);
  // The pinned run finishes (resume point nulled): the delete goes through.
  getDb().prepare("UPDATE pipelines SET resume_point = NULL, status = 'done' WHERE id = 'gr-pin-1'").run();
  const ok = await fetch(`${base}/api/guardrails/gr_org-policy`, { method: 'DELETE' });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true });
});

test('DELETE /api/guardrails/:id: built-in -> 400, unknown -> 404', async () => {
  assert.equal((await fetch(`${base}/api/guardrails/secure`, { method: 'DELETE' })).status, 400);
  assert.equal((await fetch(`${base}/api/guardrails/gr_missing`, { method: 'DELETE' })).status, 404);
});
