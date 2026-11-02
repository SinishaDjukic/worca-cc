// test/api-run-groups.test.mjs — the run-group routes (runs redesign §3.3): GET / POST /api/run-groups,
// POST /api/run-groups/:id/members, DELETE /api/run-groups/members/:pipelineId. Booted like test/api-runs-bulk.test.mjs.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, runs } from '../ui/server.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

let srv, base, home, prevHome, PROJECT;

async function call(method, path, body) {
  const r = await fetch(`${base}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const post = (path, body) => call('POST', path, body);
const get = (path) => call('GET', path);
const del = (path) => call('DELETE', path);

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-groups-api-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  PROJECT = await mkdtemp(join(tmpdir(), 'worca-cc-groups-proj-'));
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
afterEach(() => runs.clear());
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  runs.clear();
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
  if (PROJECT) await rm(PROJECT, { recursive: true, force: true });
});

test('API: group routes answer 201 / 400 / 200 / 409 / 404 and GET lists the group with its members and cost', async () => {
  const a = (await seedPipeline(PROJECT, { status: 'done', title: 'A' })).id;
  const b = (await seedPipeline(PROJECT, { status: 'done', title: 'B' })).id;
  getDb().prepare('UPDATE pipelines SET total_cost_usd = 1 WHERE id IN (?, ?)').run(a, b);
  const g = await post('/api/run-groups', { title: 'Billing', pipelineId: a });
  assert.equal(g.status, 201);
  assert.equal((await post('/api/run-groups', { title: ' ', pipelineId: b })).status, 400);
  assert.equal((await post(`/api/run-groups/${g.body.group.id}/members`, { pipelineId: b })).status, 200);
  assert.equal((await post(`/api/run-groups/${g.body.group.id}/members`, { pipelineId: b })).status, 409);
  assert.equal((await post('/api/run-groups/grp_000000000000/members', { pipelineId: a })).status, 404);
  const got = (await get('/api/run-groups')).body.groups.find((x) => x.id === g.body.group.id);
  assert.deepEqual(got.members.map((m) => m.pipelineId), [a, b]);
  assert.equal(got.cost.usd, 2, 'the group total (D32)');
  assert.equal(got.planning, null, 'a user group has no planning run (slice 4, D8)');
  assert.equal((await del(`/api/run-groups/members/${b}`)).status, 200);
  assert.equal((await del(`/api/run-groups/members/${b}`)).status, 404);
  assert.equal((await get('/api/run-groups')).body.groups.find((x) => x.id === g.body.group.id).members.length, 1);
});

test('API: a new group takes several runs and a name source, moves a grouped run, and Undo puts it back once', async () => {
  const a = (await seedPipeline(PROJECT, { status: 'done', title: 'A' })).id;
  const b = (await seedPipeline(PROJECT, { status: 'done', title: 'B' })).id;
  const one = await post('/api/run-groups', { title: 'One', pipelineId: a });
  const two = await post('/api/run-groups', { title: 'Two', nameSource: 'suggested', pipelineIds: [b] });
  assert.equal(two.status, 201);
  assert.equal(two.body.group.nameSource, 'suggested');
  const moved = await post(`/api/run-groups/${two.body.group.id}/members`, { pipelineIds: [a] });
  assert.equal(moved.status, 200);
  assert.deepEqual(moved.body.added, [a]);
  assert.equal(moved.body.group.title, 'Two');
  assert.equal((await get('/api/run-groups')).body.groups.find((g) => g.id === one.body.group.id), undefined, 'One emptied');
  assert.equal((await post('/api/run-groups/undo', { token: moved.body.undo })).status, 200);
  assert.deepEqual((await get('/api/run-groups')).body.groups.find((g) => g.id === one.body.group.id).members.map((m) => m.pipelineId), [a]);
  assert.equal((await post('/api/run-groups/undo', { token: moved.body.undo })).status, 410);
  assert.equal((await post('/api/run-groups', { title: 'X', pipelineIds: [] })).status, 400);
});

test('API: run-group suggest-name answers 404 while smartRunNaming is off; on (mock): the fixed name', async () => {
  const prev = { mock: process.env.WORCA_MOCK, flags: process.env.WORCA_FLAGS };
  try {
    process.env.WORCA_MOCK = '1';
    const a = (await seedPipeline(PROJECT, { status: 'done', title: 'A' })).id;
    process.env.WORCA_FLAGS = '-smartRunNaming';
    assert.equal((await post('/api/run-groups/suggest-name', { pipelineIds: [a] })).status, 404);
    process.env.WORCA_FLAGS = 'smartRunNaming';
    const r = await post('/api/run-groups/suggest-name', { pipelineIds: [a] });
    assert.deepEqual([r.status, r.body], [200, { source: 'model', name: 'Mock group' }]);
    assert.equal((await post('/api/run-groups/suggest-name', { pipelineIds: ['nope'] })).status, 404);
    assert.equal((await post('/api/run-groups/suggest-name', {})).status, 400);
  } finally {
    for (const [k, v] of [['WORCA_MOCK', prev.mock], ['WORCA_FLAGS', prev.flags]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
