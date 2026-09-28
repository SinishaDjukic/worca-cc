// test/workspace-map-api.test.mjs
// The workspace map routes in ui/server.mjs: GET /map (payload + effective edges), PUT / POST /
// DELETE on edges (status mapping, x_/m_ id rules, validation), POST /map/render, the
// workspaces-changed{map} broadcasts (every change, never a duplicate add), and the list payload
// (mapSummary, never the map).
// No run is started, so no cwd sandbox is needed. WORCA_HOME is a temp dir.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { WebSocket } from 'ws';

import { useTempHome } from './helpers/temp-home.mjs';
import { sampleMap, DISPLAYS } from './helpers/wsmap-stored.mjs';
import { saveWorkspaceScanResult } from '../src/core/workspaces.mjs';

useTempHome(after);

let srv, base, wsBase, prevMock;
const JSONH = { 'Content-Type': 'application/json' };
const created = [];

before(async () => {
  prevMock = process.env.WORCA_MOCK;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
});
after(async () => {
  if (srv) await new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); });
  if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 })));
});

async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wsmap-'));
  created.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}
const call = (method, p, body) => fetch(`${base}${p}`, { method, headers: JSONH, body: body === undefined ? undefined : JSON.stringify(body) });
let seq = 0;
/** A workspace created over HTTP whose scan result (sample map) is stored. */
async function scanned() {
  const a = await freshRepo();
  const b = await freshRepo();
  const cr = await call('POST', '/api/workspaces', { name: `Api Map ${++seq}`, projectPaths: [a, b] });
  assert.equal(cr.status, 201);
  const { workspace } = await cr.json();
  const sample = sampleMap({ keys: workspace.projectKeys, names: workspace.projectPaths.map((p) => basename(p)), name: workspace.name });
  await saveWorkspaceScanResult(workspace.id, { map: sample.map, synthesis: sample.synthesis });
  return { ws: workspace, ...sample, from: workspace.projectKeys[0], to: workspace.projectKeys[1] };
}
function openWs() {
  const ws = new WebSocket(wsBase, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, opened };
}
function waitFor(pred, timeoutMs = 10000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => {
      const v = pred();
      if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

test('GET /map: 404 for a malformed or unknown id; the payload carries map, synthesis, overrides, edges, origin', async () => {
  for (const p of ['/api/workspaces/..%2F..%2Fetc/map', '/api/workspaces/wks-nope-00000000/map']) {
    const r404 = await call('GET', p);
    assert.equal(r404.status, 404, p);
    // The route's own JSON answer — Express's HTML 404 page (no route at all) must not pass.
    assert.deepEqual(await r404.json(), { error: 'workspace not found' }, p);
  }
  const { ws, map, ids } = await scanned();
  const r = await call('GET', `/api/workspaces/${ws.id}/map`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.map, map);
  assert.equal(body.synthesis.overview, 'Two services share invoices.');
  assert.deepEqual(body.overrides, { version: 1, edges: {}, manual: [] });
  assert.equal(body.descriptionOrigin, 'generated');
  assert.deepEqual(body.edges.map((e) => e.id).sort(), Object.values(ids).sort());
  assert.ok(body.edges.every((e) => e.state === 'auto'));
});

test('GET /api/workspaces lists mapSummary + descriptionOrigin and never the map', async () => {
  const { ws } = await scanned();
  const { workspaces } = await (await call('GET', '/api/workspaces')).json();
  const listed = workspaces.find((w) => w.id === ws.id);
  assert.equal(listed.mapSummary.edges, 3);
  assert.equal(listed.descriptionOrigin, 'generated');
  for (const k of ['map', 'map_json', 'synthesis', 'overrides']) assert.ok(!(k in listed), k);
});

test('PUT an edge: reject re-renders the description and broadcasts workspaces-changed{map}; null clears', async () => {
  const { ws, ids } = await scanned();
  const sock = openWs();
  await sock.opened;
  const r = await call('PUT', `/api/workspaces/${ws.id}/map/edges/${ids.http}`, { state: 'rejected' });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.edge.state, 'rejected');
  assert.equal(body.rerendered, true);
  assert.ok(!body.workspace.description.includes(DISPLAYS.http));
  await waitFor(() => sock.msgs.some((m) => m.type === 'workspaces-changed' && m.action === 'map'));
  const map = await (await call('GET', `/api/workspaces/${ws.id}/map`)).json();
  assert.equal(map.edges.find((e) => e.id === ids.http).state, 'rejected');
  const cleared = await call('PUT', `/api/workspaces/${ws.id}/map/edges/${ids.http}`, { state: null });
  assert.equal((await cleared.json()).edge.state, 'auto');
  sock.ws.close();
});

test('PUT validation: 400 without state / bad state / bad or manual id; 404 unknown edge or workspace', async () => {
  const { ws, ids } = await scanned();
  const put = (edge, body) => call('PUT', `/api/workspaces/${ws.id}/map/edges/${edge}`, body);
  assert.equal((await put(ids.http, {})).status, 400);
  assert.equal((await put(ids.http, { state: 'maybe' })).status, 400);
  assert.equal((await put('x_zz', { state: 'confirmed' })).status, 400);
  assert.equal((await put('m_0123456789ab', { state: 'confirmed' })).status, 400);
  assert.equal((await put('x_0123456789ab', { state: 'confirmed' })).status, 404);
  assert.equal((await call('PUT', `/api/workspaces/wks-nope-00000000/map/edges/${ids.http}`, { state: 'confirmed' })).status, 404);
});

test('POST a manual edge: 201 with the edge, 200 for the same edge again, 400 for bad input', async () => {
  const { ws, from, to } = await scanned();
  const add = (body) => call('POST', `/api/workspaces/${ws.id}/map/edges`, body);
  const input = { from: to, to: from, kind: 'topic', display: 'zz.refunds' };
  const r = await add(input);
  assert.equal(r.status, 201);
  const { edge, workspace } = await r.json();
  assert.match(edge.id, /^m_[0-9a-f]{12}$/);
  assert.equal(edge.state, 'manual');
  assert.match(workspace.description, /zz\.refunds.*\(manual\)/);
  assert.equal((await add(input)).status, 200);
  assert.equal((await add({ ...input, from: 'not-a-member-00000000' })).status, 400);
  assert.equal((await add({ ...input, to: input.from })).status, 400);
  assert.equal((await add({ ...input, kind: 'carrier-pigeon' })).status, 400);
  assert.equal((await add({ ...input, display: 'x'.repeat(201) })).status, 400);
  assert.equal((await add({ ...input, display: 'y', detail: 'd'.repeat(201) })).status, 400);
  assert.equal((await call('POST', '/api/workspaces/wks-nope-00000000/map/edges', input)).status, 404);

  // No stored map yet: the Map tab could neither show nor delete the edge.
  const a = await freshRepo();
  const b = await freshRepo();
  const bare = (await (await call('POST', '/api/workspaces', { name: 'Api No Map', projectPaths: [a, b] })).json()).workspace;
  const refused = await call('POST', `/api/workspaces/${bare.id}/map/edges`, { ...input, from: bare.projectKeys[0], to: bare.projectKeys[1] });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /no map yet/);
});

test('DELETE: manual edges only (x_ -> 400), unknown manual id -> 404', async () => {
  const { ws, ids, from, to } = await scanned();
  const { edge } = await (await call('POST', `/api/workspaces/${ws.id}/map/edges`, { from, to, kind: 'db', display: 'table zz_x' })).json();
  assert.equal((await call('DELETE', `/api/workspaces/${ws.id}/map/edges/${ids.http}`)).status, 400);
  assert.equal((await call('DELETE', `/api/workspaces/${ws.id}/map/edges/nonsense`)).status, 400);
  const del = await call('DELETE', `/api/workspaces/${ws.id}/map/edges/${edge.id}`);
  assert.equal(del.status, 200);
  assert.equal((await del.json()).overrides.manual.length, 0);
  assert.equal((await call('DELETE', `/api/workspaces/${ws.id}/map/edges/${edge.id}`)).status, 404);
});

test('POST /map/render: regenerates a hand-edited description; 400 without a map; 404 unknown', async () => {
  const { ws, ids } = await scanned();
  await call('PUT', `/api/workspaces/${ws.id}/map/edges/${ids.topic}`, { state: 'rejected' });
  const edited = await (await call('PATCH', `/api/workspaces/${ws.id}`, { description: 'my own words' })).json();
  assert.equal(edited.workspace.descriptionOrigin, 'edited');
  const r = await call('POST', `/api/workspaces/${ws.id}/map/render`);
  assert.equal(r.status, 200);
  const { workspace } = await r.json();
  assert.equal(workspace.descriptionOrigin, 'generated');
  assert.ok(workspace.description.includes(DISPLAYS.http));
  assert.ok(!workspace.description.includes(DISPLAYS.topic), 'the rejection applies');

  const a = await freshRepo();
  const b = await freshRepo();
  const bare = (await (await call('POST', '/api/workspaces', { name: 'Api Bare', projectPaths: [a, b] })).json()).workspace;
  assert.equal((await call('POST', `/api/workspaces/${bare.id}/map/render`)).status, 400);
  assert.equal((await call('POST', '/api/workspaces/wks-nope-00000000/map/render')).status, 404);
});

test('every successful map change broadcasts workspaces-changed{map}; a duplicate add (200) broadcasts nothing', async () => {
  const { ws, from, to } = await scanned();
  const sock = openWs();
  await sock.opened;
  const frames = () => sock.msgs.filter((m) => m.type === 'workspaces-changed' && m.action === 'map').length;
  // A frame of another action is the barrier: one socket delivers frames in send order.
  const barrier = async (n) => {
    await call('PATCH', `/api/workspaces/${ws.id}`, { metricsProject: null });
    await waitFor(() => sock.msgs.filter((m) => m.action === 'metrics-home').length === n);
  };
  const input = { from: to, to: from, kind: 'topic', display: 'zz.frames' };
  const add = await call('POST', `/api/workspaces/${ws.id}/map/edges`, input);
  assert.equal(add.status, 201);
  const { edge } = await add.json();
  await barrier(1);
  assert.equal(frames(), 1, 'POST 201');
  assert.equal((await call('POST', `/api/workspaces/${ws.id}/map/edges`, input)).status, 200);
  await barrier(2);
  assert.equal(frames(), 1, 'a duplicate add (200) broadcasts nothing');
  assert.equal((await call('DELETE', `/api/workspaces/${ws.id}/map/edges/${edge.id}`)).status, 200);
  await barrier(3);
  assert.equal(frames(), 2, 'DELETE');
  assert.equal((await call('POST', `/api/workspaces/${ws.id}/map/render`)).status, 200);
  await barrier(4);
  assert.equal(frames(), 3, 'render');
  // A rename re-renders a generated description (its title line): open tabs must re-read it.
  const renamed = await call('PATCH', `/api/workspaces/${ws.id}`, { name: `${ws.name} renamed` });
  assert.equal(renamed.status, 200);
  assert.match((await renamed.json()).workspace.description, new RegExp(`^# Workspace: ${ws.name} renamed\\n`));
  await barrier(5);
  assert.equal(frames(), 4, 'PATCH with a name');
  // A hand edit flips the origin to 'edited' (Regenerate appears, overrides stop re-rendering).
  assert.equal((await call('PATCH', `/api/workspaces/${ws.id}`, { description: 'hand' })).status, 200);
  await barrier(6);
  assert.equal(frames(), 5, 'PATCH with a description');
  sock.ws.close();
});
