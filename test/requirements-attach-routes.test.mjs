// test/requirements-attach-routes.test.mjs — GET /api/requirements/search and POST /api/requirements/attach/resolve (FEAT-21 routes)
// on a bare express app with the requirements routes, behind the `requirements` flag.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { useTempHome } from './helpers/temp-home.mjs';
import { emptySpec } from '../src/core/requirements/spec.mjs';
import { createFeature, updateFeature, createStart } from '../src/core/requirements/store.mjs';
import { registerRequirementsRoutes, REQUIREMENTS_ROUTES } from '../src/core/requirements/routes.mjs';

useTempHome(after, 'worca-req-attach-routes-');
const prev = { flags: process.env.WORCA_FLAGS, mock: process.env.WORCA_MOCK };
process.env.WORCA_FLAGS = 'requirements';
process.env.WORCA_MOCK = '1';
let srv; let base; let n = 0;

before(async () => {
  const app = express();
  app.use(express.json());
  registerRequirementsRoutes(app, { broadcast: () => {}, deps: {} });
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  for (const [k, v] of [['WORCA_FLAGS', prev.flags], ['WORCA_MOCK', prev.mock]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const make = (title, scopeType = 'project', scopeKey = 'shop') => createFeature({ scopeType, scopeKey, title, description: `d ${title}` });
const specWith = (...texts) => ({ ...emptySpec(), goal: { text: 'G', measure: '' }, criteria: texts.map((t, i) => ({ id: `R-po-${i + 1}`, text: t })) });
const start = (f, { version = 1, ready = true, spec = specWith('a', 'b') } = {}) =>
  createStart({ featureSeq: f.seq, version, runId: `run-${f.seq}-${version}-${n++}`, spec, title: f.title, ready });
const search = (q) => `/api/requirements/search?${new URLSearchParams(q)}`;

test('both routes are in the table, before GET /:seq', () => {
  const keys = REQUIREMENTS_ROUTES.map((r) => `${r.method} ${r.path}`);
  const seqAt = keys.indexOf('GET /api/requirements/:seq');
  assert.ok(keys.indexOf('GET /api/requirements/search') >= 0 && keys.indexOf('GET /api/requirements/search') < seqAt);
  assert.ok(keys.includes('POST /api/requirements/attach/resolve'));
});

test('search scope: only features of that scope type and key', async () => {
  const p = make('Scoped proj', 'project', 'scope-a'); start(p);
  make('Other proj', 'project', 'scope-b');
  const w = make('Scoped ws', 'workspace', 'scope-a');
  const r = await call('GET', search({ scopeType: 'workspace', scopeKey: 'scope-a' }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.features.map((f) => f.seq), [w.seq]);
  const pr = await call('GET', search({ scopeType: 'project', scopeKey: 'scope-a' }));
  assert.deepEqual(pr.json.features.map((f) => f.seq), [p.seq]);
});

test('search order and filter: archived hidden, Ready first, exclude and q honoured', async () => {
  const unstarted = make('Zeta plain', 'project', 'ord');
  const started = make('Beta started', 'project', 'ord'); start(started, { ready: false });
  const ready = make('Alpha ready', 'project', 'ord'); start(ready, { ready: true });
  const arch = make('Gone', 'project', 'ord'); start(arch); updateFeature(arch.seq, { status: 'archived' });
  const base_ = { scopeType: 'project', scopeKey: 'ord' };
  const all = await call('GET', search(base_));
  assert.deepEqual(all.json.features.map((f) => f.seq), [ready.seq, started.seq, unstarted.seq]);
  assert.equal(all.json.features[2].startable, false);
  assert.equal(all.json.features[2].label, 'Not Ready yet');
  const ex = await call('GET', search({ ...base_, exclude: `${ready.seq},FEAT-${started.seq}` }));
  assert.deepEqual(ex.json.features.map((f) => f.seq), [unstarted.seq]);
  const q = await call('GET', search({ ...base_, q: 'beta' }));
  assert.deepEqual(q.json.features.map((f) => f.seq), [started.seq]);
});

test('search limit is clamped to 1..50 and a bad scope is 400', async () => {
  for (let i = 0; i < 3; i += 1) make(`Lim ${i}`, 'project', 'lim');
  const base_ = { scopeType: 'project', scopeKey: 'lim' };
  assert.equal((await call('GET', search({ ...base_, limit: '2' }))).json.features.length, 2);
  assert.equal((await call('GET', search({ ...base_, limit: '0' }))).json.features.length, 1);
  assert.equal((await call('GET', search({ ...base_, limit: '-5' }))).json.features.length, 1);
  assert.equal((await call('GET', search({ ...base_, limit: '9999' }))).json.features.length, 3);
  assert.equal((await call('GET', search({ ...base_, limit: 'abc' }))).json.features.length, 3);
  assert.equal((await call('GET', search({ scopeType: 'nope', scopeKey: 'lim' }))).status, 400);
  assert.equal((await call('GET', search({ scopeType: 'project' }))).status, 400);
});

test('resolve: the latest started spec, no markdown key, statuses only', async () => {
  const f = make('Resolve me', 'project', 'res');
  start(f, { version: 1, spec: specWith('old') });
  start(f, { version: 2, spec: specWith('x', 'y', 'z'), ready: false });
  updateFeature(f.seq, { spec: { ...emptySpec(), criteria: [{ id: 'R-po-1', text: 'DRAFT ONLY' }] } });
  const un = make('Unstarted', 'project', 'res');
  const r = await call('POST', '/api/requirements/attach/resolve', { seqs: [f.seq, `FEAT-${un.seq}`, 99999] });
  assert.equal(r.status, 200);
  const [a, b, c] = r.json.items;
  assert.deepEqual([a.status, a.version, a.ready, a.criteriaCount], ['ok', 2, false, 3]);
  assert.equal(b.status, 'not_ready');
  assert.equal(c.status, 'missing');
  for (const i of r.json.items) assert.ok(!('markdown' in i), 'no markdown key');
  assert.ok(!JSON.stringify(r.json).includes('DRAFT ONLY'));
});

test('resolve: scope fields mark a feature of another scope wrong_scope', async () => {
  const f = make('Scoped', 'project', 'res-scope'); start(f);
  const ok = await call('POST', '/api/requirements/attach/resolve', { seqs: [f.seq], scopeType: 'project', scopeKey: 'res-scope' });
  assert.equal(ok.json.items[0].status, 'ok');
  const bad = await call('POST', '/api/requirements/attach/resolve', { seqs: [f.seq], scopeType: 'project', scopeKey: 'else' });
  assert.equal(bad.json.items[0].status, 'wrong_scope');
  const ws = await call('POST', '/api/requirements/attach/resolve', { seqs: [f.seq], scopeType: 'workspace', scopeKey: 'res-scope' });
  assert.equal(ws.json.items[0].status, 'wrong_scope');
});

test('resolve: a bad scope is 400, not 200 with every item wrong_scope', async () => {
  const f = make('BadScope', 'project', 'res-scope'); start(f);
  for (const scope of [{ scopeType: 'folder', scopeKey: 'x' }, { scopeType: 'project' }, { scopeType: 'project', scopeKey: '  ' }, { scopeKey: 'x' }]) {
    const r = await call('POST', '/api/requirements/attach/resolve', { seqs: [f.seq], ...scope });
    assert.equal(r.status, 400, JSON.stringify(scope));
  }
});

test('resolve: limit 400 with REQUIREMENTS_LIMIT, bad seqs 400', async () => {
  const many = Array.from({ length: 11 }, (_, i) => i + 1);
  const r = await call('POST', '/api/requirements/attach/resolve', { seqs: many });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'REQUIREMENTS_LIMIT');
  assert.match(r.json.error, /up to 10/);
  assert.equal((await call('POST', '/api/requirements/attach/resolve', { seqs: ['nope'] })).status, 400);
  assert.equal((await call('POST', '/api/requirements/attach/resolve', {})).status, 400);
});

test('flag off: both routes answer 404', async () => {
  const saved = process.env.WORCA_FLAGS;
  delete process.env.WORCA_FLAGS;
  try {
    const s = await call('GET', search({ scopeType: 'project', scopeKey: 'shop' }));
    const r = await call('POST', '/api/requirements/attach/resolve', { seqs: [1] });
    assert.deepEqual([s.status, s.json], [404, { error: 'not found' }]);
    assert.deepEqual([r.status, r.json], [404, { error: 'not found' }]);
  } finally { process.env.WORCA_FLAGS = saved; }
});
