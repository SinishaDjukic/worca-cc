// test/api-answerer.test.mjs — GET/PUT /api/answerer: the answerer profile (the lead perspective a person shapes as),
// one per person in settings.json, keyed like the Chat home pins (src/core/settings.mjs answererProfileFor).
//
// SANDBOX: HOME/USERPROFILE point at a temp dir, as in test/api-chat-home-pins.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';

let home, srv, base, prev;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-answererapi-'));
  prev = {};
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK',
    'WORCA_PROJECTS_ROOT', 'WORCA_IDENTITY_HEADER']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; delete process.env.WORCA_HOME;
  delete process.env.WORCA_PROJECTS_ROOT;
  delete process.env.WORCA_IDENTITY_HEADER;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  _resetForTests();
  const { app } = await import('../ui/server.mjs');
  srv = appServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await rm(home, { recursive: true, force: true, maxRetries: 5 });   // a stopped mock run's helpers may still write there
});

const get = (headers = {}) => fetch(`${base}/api/answerer`, { headers }).then((r) => r.json());
const put = (body, headers = {}) => fetch(`${base}/api/answerer`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const settingsBytes = () => { const f = join(home, '.worca-cc', 'settings.json'); return existsSync(f) ? readFileSync(f, 'utf8') : null; };

test('a fresh HOME: GET returns { lead: null }', async () => {
  assert.deepEqual(await get(), { lead: null });
});

test('PUT architect, then GET returns architect', async () => {
  const r = await put({ lead: 'architect' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { lead: 'architect' });
  assert.deepEqual(await get(), { lead: 'architect' });
});

test('PUT boss is refused with 400 BAD_LEAD and settings.json is unchanged', async () => {
  const before = settingsBytes();
  const r = await put({ lead: 'boss' });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: { code: 'BAD_LEAD', message: 'Pick one of: product, architect, ux, qa, security, devops' } });
  assert.equal(settingsBytes(), before);
  assert.deepEqual(await get(), { lead: 'architect' });
});

test('per person: two signed-in names keep two leads', async () => {
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';
  try {
    await put({ lead: 'product' }, { 'x-test-user': 'Ada@example.com' });
    await put({ lead: 'security' }, { 'x-test-user': 'bob@example.com' });
    assert.deepEqual(await get({ 'x-test-user': 'ada@example.com' }), { lead: 'product' }, 'keyed case-insensitively');
    assert.deepEqual(await get({ 'x-test-user': 'bob@example.com' }), { lead: 'security' });
  } finally { delete process.env.WORCA_IDENTITY_HEADER; }
  assert.deepEqual(await get(), { lead: 'architect' }, 'the local lead is untouched');
});

// Small runs B3 (D7): Compliance is a lead only while the shaperSmallRuns flag is on; off, a stored one reads null.
test('PUT compliance: 400 BAD_LEAD with the flag off, 200 on; after the flag goes off, GET reads lead null', async () => {
  const prevFlags = process.env.WORCA_FLAGS;
  try {
    delete process.env.WORCA_FLAGS;
    const off = await put({ lead: 'compliance' });
    assert.equal(off.status, 400);
    const offBody = await off.json();
    assert.equal(offBody.error.code, 'BAD_LEAD');
    assert.doesNotMatch(offBody.error.message, /compliance/);
    process.env.WORCA_FLAGS = 'shaperSmallRuns';
    const on = await put({ lead: 'compliance' });
    assert.equal(on.status, 200);
    assert.deepEqual(await on.json(), { lead: 'compliance' });
    assert.deepEqual(await get(), { lead: 'compliance' });
    const bad = await (await put({ lead: 'boss' })).json();
    assert.match(bad.error.message, /compliance/, 'the refusal lists the leads the flag allows');
    delete process.env.WORCA_FLAGS;
    assert.deepEqual(await get(), { lead: null });
  } finally {
    if (prevFlags === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prevFlags;
  }
});

// Small runs B3, owner direction: a shaped run started with no lead (the API, the CLI) leads as the starter's saved
// lead, else Product. Nothing is asked for it. With the flag off nothing is filled in.
test('POST /api/run with no shape.lead: the saved lead with the flag on, Product with none saved, nothing with the flag off', async () => {
  const { gitDir } = await import('./helpers/git-dir.mjs');
  const { runs } = await import('../ui/server.mjs');
  const prevFlags = process.env.WORCA_FLAGS;
  const startShaped = async () => {
    const r = await fetch(`${base}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Add a charts page.', projectDir: gitDir('answerer-run'), mock: true, shape: { size: 'large', perspectives: ['architect'] } }) });
    const text = await r.text();
    assert.equal(r.status, 200, text);
    const { runId } = JSON.parse(text);
    const shape = runs.get(runId).orch.runShape;
    await fetch(`${base}/api/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId }) });
    for (const t0 = Date.now(); Date.now() - t0 < 20000 && !['stopped', 'done', 'error'].includes(String(runs.get(runId)?.status));) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return shape;
  };
  try {
    process.env.WORCA_FLAGS = 'shaperSmallRuns';
    assert.equal((await put({ lead: 'qa' })).status, 200);
    const saved = await startShaped();
    assert.equal(saved.lead, 'qa');
    assert.deepEqual(saved.perspectives, ['product', 'architect', 'qa'], 'the lead joins the perspectives, as a card lead does');
    const map = JSON.parse(settingsBytes());
    delete map.answererProfiles;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify(map));
    assert.deepEqual(await get(), { lead: null });
    assert.equal((await startShaped()).lead, 'product');
    delete process.env.WORCA_FLAGS;
    assert.equal((await startShaped()).lead, undefined);
  } finally {
    if (prevFlags === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prevFlags;
  }
});
