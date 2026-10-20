// test/requirements-api.test.mjs — the HTTP API in mock mode, behind the flag (design §5, D12, D13).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

let home; let srv; let base; let prev; let projKey; let projDir;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-req-api-'));
  prev = {};
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_FLAGS', 'WORCA_MOCK', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = join(home, 'worca-home');
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'requirements';
  (await import('../src/core/db.mjs'))._resetForTests();
  projDir = await mkdtemp(join(home, 'shop-'));
  const { addProject } = await import('../src/core/projects.mjs');
  projKey = (await addProject({ name: 'shop', path: projDir })).find((p) => p.name === 'shop').key;
  srv = (await import('../ui/server.mjs')).server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  (await import('../src/core/db.mjs'))._resetForTests();   // release the sqlite handle (Windows cannot unlink an open file)
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* markdown */ }
  return { status: r.status, json, text, headers: r.headers };
};
const waitFor = async (pred, ms = 5000) => { const t0 = Date.now(); while (!(await pred())) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); } };

test('the whole flow in mock mode, with frames', async () => {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const frames = [];
  ws.on('message', (d) => { try { const m = JSON.parse(String(d)); if (m.type === 'requirements-changed') frames.push(m); } catch {} });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  try {
    assert.equal((await call('POST', '/api/requirements', { scopeType: 'project', scopeKey: 'nope-1234abcd', title: 't', description: 'd' })).status, 400);
    const c = await call('POST', '/api/requirements', { scopeType: 'project', scopeKey: projKey, title: 'Cancel order', description: 'Before it ships' });
    assert.equal(c.status, 201);
    const seq = c.json.feature.seq;
    await waitFor(async () => (await call('GET', `/api/requirements/${seq}`)).json.feature.status === 'your_turn');
    let v = (await call('GET', `/api/requirements/FEAT-${seq}`)).json;
    assert.match(v.feature.orientation.summary, /\[mock\]/);
    assert.equal(v.feature.pending.questions.length, 2);
    assert.ok(frames.some((f) => f.seq === seq));
    const a = await call('POST', `/api/requirements/${seq}/answers`, { roundTurnId: v.feature.pending.turnId, useRecommended: true });
    assert.equal(a.status, 202);
    await waitFor(async () => (await call('GET', `/api/requirements/${seq}`)).json.feature.status === 'done');
    v = (await call('GET', `/api/requirements/${seq}`)).json;
    assert.equal(v.feature.spec.criteria[0].id, 'R-po-1');
    assert.equal((await call('PUT', `/api/requirements/${seq}/spec/actors`, { value: ['Buyer'] })).json.feature.spec.edited.actors, true);
    assert.equal((await call('DELETE', `/api/requirements/${seq}/spec/actors/edited`)).status, 200);
    assert.equal((await call('POST', `/api/requirements/${seq}/criteria`, { text: 'Refund in 3 days' })).json.feature.spec.criteria.at(-1).id, 'R-po-2');
    assert.equal((await call('POST', `/api/requirements/${seq}/assumptions/A-1`, { status: 'confirmed' })).json.feature.spec.assumptions[0].status, 'confirmed');
    const md = await call('GET', `/api/requirements/${seq}/markdown?download=1`);
    assert.match(md.text, /^# FEAT-\d+: Cancel order/);
    assert.match(md.headers.get('content-disposition'), /attachment; filename="FEAT-\d+-cancel-order\.md"/);
    const s = await call('POST', `/api/requirements/${seq}/save`, {});
    assert.equal(s.status, 200);
    assert.match(await readFile(join(projDir, s.json.path), 'utf8'), /Refund in 3 days/);
    assert.equal((await call('POST', `/api/requirements/${seq}/save`, {})).status, 409);
    const ctx = await call('PUT', `/api/requirements/context/project/${projKey}`, { body: 'Actors: buyer', lookAtCode: false });
    assert.deepEqual([ctx.json.body, ctx.json.lookAtCode], ['Actors: buyer', false]);
    const listed = (await call('GET', '/api/requirements')).json;
    const list = listed.features;
    assert.ok(list.some((f) => f.seq === seq && f.id === `FEAT-${seq}` && f.spec === undefined));
    const row = list.find((f) => f.seq === seq);
    assert.ok(['decide', 'ready'].includes(row.state), row.state);
    assert.equal(typeof row.ready, 'number');
    assert.equal(row.latestRun, null);
    assert.ok(listed.lookCostUsd === null || typeof listed.lookCostUsd === 'number');
    assert.equal(typeof listed.spend.windowUsd, 'number');
    assert.ok('totalLimitUsd' in listed.spend);
    v = (await call('GET', `/api/requirements/${seq}`)).json;
    assert.equal(v.feature.readiness.total, 6);
    assert.deepEqual(v.feature.starts, []);
    assert.equal((await call('POST', `/api/requirements/${seq}/revert`, { version: 1 })).status, 404);
    assert.equal((await call('POST', `/api/requirements/${seq}/revert`, {})).status, 400);
    assert.equal((await call('POST', `/api/requirements/${seq}/archive`, {})).json.feature.status, 'archived');
    assert.equal((await call('POST', `/api/requirements/${seq}/criteria`, { text: 'x' })).status, 409);
    assert.equal((await call('GET', '/api/requirements/999999')).status, 404);
    assert.equal((await call('GET', '/api/requirements/abc')).status, 404);
  } finally { ws.close(); }
});

// The route table is the one list both the registration and this test use, so a new route cannot be
// added without the flag-off check covering it.
const fill = (path) => path.replace(':scopeType/:scopeKey', `project/${projKey}`).replace(':seq', '1')
  .replace('/criteria/:id', '/criteria/R-po-1').replace('/assumptions/:id', '/assumptions/A-1').replace(':section', 'actors');

test('the route table is exactly what gets registered', async () => {
  const { REQUIREMENTS_ROUTES, registerRequirementsRoutes } = await import('../src/core/requirements/routes.mjs');
  const seen = [];
  const fake = {};
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) fake[m] = (path) => { seen.push(`${m.toUpperCase()} ${path}`); };
  registerRequirementsRoutes(fake, { broadcast: () => {} });
  assert.deepEqual(seen, REQUIREMENTS_ROUTES.map((r) => `${r.method} ${r.path}`));
  assert.ok(REQUIREMENTS_ROUTES.length >= 19);
  for (const p of ['/:seq/start', '/:seq/revert']) assert.ok(REQUIREMENTS_ROUTES.some((r) => r.method === 'POST' && r.path.endsWith(p)), p);
  for (const r of REQUIREMENTS_ROUTES) assert.doesNotMatch(fill(r.path), /:/, `every param is substituted: ${r.path}`);
});

test("flag off: every route in the table answers the flag gate's 404", async () => {
  const { REQUIREMENTS_ROUTES } = await import('../src/core/requirements/routes.mjs');
  delete process.env.WORCA_FLAGS;
  try {
    for (const { method, path } of REQUIREMENTS_ROUTES) {
      const r = await call(method, fill(path), method === 'GET' ? undefined : {});
      assert.equal(r.status, 404, `${method} ${path}`);
      assert.deepEqual(r.json, { error: 'not found' }, `${method} ${path}: the flag gate, not a route-level 404`);
    }
  } finally { process.env.WORCA_FLAGS = 'requirements'; }
});

test('flag off: a change sends no requirements-changed frame; flag on: it does', async () => {
  const { requirementsChangeNotifier } = await import('../src/core/requirements/routes.mjs');
  const sent = [];
  const onChange = requirementsChangeNotifier((frame) => sent.push(frame));
  delete process.env.WORCA_FLAGS;
  try { onChange(7); } finally { process.env.WORCA_FLAGS = 'requirements'; }
  assert.deepEqual(sent, []);
  onChange('7');
  assert.deepEqual(sent, [{ type: 'requirements-changed', seq: 7 }]);
});

test('create: a valid scopeType with a missing or bad scopeKey says scopeKey is required', async () => {
  for (const scopeKey of [undefined, 5, '', '   ']) {
    const r = await call('POST', '/api/requirements', { scopeType: 'project', scopeKey, title: 't', description: 'd' });
    assert.equal(r.status, 400, String(scopeKey));
    assert.equal(r.json.error, 'scopeKey is required', String(scopeKey));
  }
  const bad = await call('POST', '/api/requirements', { scopeType: 'team', scopeKey: projKey, title: 't', description: 'd' });
  assert.equal(bad.json.error, 'scopeType must be "project" or "workspace"');
});


test('bulk confirm and follow-up routes', async () => {
  const c = await call('POST', '/api/requirements', { scopeType: 'project', scopeKey: projKey, title: 'Bulk', description: 'd' });
  const seq = c.json.feature.seq;
  await waitFor(async () => (await call('GET', `/api/requirements/${seq}`)).json.feature.status === 'your_turn');
  let v = (await call('GET', `/api/requirements/${seq}`)).json;
  await call('POST', `/api/requirements/${seq}/answers`, { roundTurnId: v.feature.pending.turnId, useRecommended: true });
  await waitFor(async () => (await call('GET', `/api/requirements/${seq}`)).json.feature.status === 'done');
  assert.equal((await call('POST', `/api/requirements/${seq}/assumptions`, {})).status, 400);
  assert.equal((await call('POST', `/api/requirements/${seq}/follow-up`, {})).status, 409);
  const ok = await call('POST', `/api/requirements/${seq}/assumptions`, { confirmOpen: true });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.feature.spec.assumptions.every((a) => a.status === 'confirmed'));
  assert.equal((await call('POST', `/api/requirements/${seq}/assumptions`, { confirmOpen: true })).status, 409);
  await call('POST', `/api/requirements/${seq}/assumptions/A-1`, { status: 'rejected' });
  const fu = await call('POST', `/api/requirements/${seq}/follow-up`, {});
  assert.equal(fu.status, 202);
  await waitFor(async () => (await call('GET', `/api/requirements/${seq}`)).json.feature.status === 'your_turn');
  v = (await call('GET', `/api/requirements/${seq}`)).json;
  assert.equal(v.feature.pending.questions[0].id, 'replace-a-1');
});

test('list rows: pendingCount while it is your turn, openAssumptions to decide', async () => {
  const c = await call('POST', '/api/requirements', { scopeType: 'project', scopeKey: projKey, title: 'Counts', description: 'd' });
  const seq = c.json.feature.seq;
  await waitFor(async () => (await call('GET', `/api/requirements/${seq}`)).json.feature.status === 'your_turn');
  const rowOf = async () => (await call('GET', '/api/requirements')).json.features.find((f) => f.seq === seq);
  let row = await rowOf();
  const v = (await call('GET', `/api/requirements/${seq}`)).json;
  assert.equal(row.pendingCount, v.feature.pending.questions.length);
  assert.ok(row.pendingCount > 0);
  assert.equal(typeof row.openAssumptions, 'number');
  await call('POST', `/api/requirements/${seq}/answers`, { roundTurnId: v.feature.pending.turnId, useRecommended: true });
  await waitFor(async () => (await call('GET', `/api/requirements/${seq}`)).json.feature.status === 'done');
  const spec = (await call('GET', `/api/requirements/${seq}`)).json.feature.spec;
  const open = spec.assumptions.filter((a) => a.status === 'open');
  assert.ok(open.length > 0, 'the mock leaves an open assumption');
  row = await rowOf();
  assert.equal(row.pendingCount, 0);
  assert.equal(row.openAssumptions, open.length);
  await call('POST', `/api/requirements/${seq}/assumptions/${open[0].id}`, { status: 'confirmed' });
  assert.equal((await rowOf()).openAssumptions, open.length - 1);
});
