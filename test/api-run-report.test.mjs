// test/api-run-report.test.mjs
// POST /api/pipelines/:id/report — the metadata-only run report and its prefilled
// GitHub issue URL — plus the bugsUrl that GET /api/settings hands the About card.
// Server-test shape (api-guardrails.test.mjs): useTempHome at module top level, the
// app imported INSIDE before() so WORCA_HOME is already set (importing binds no
// port), an ephemeral http server and real fetch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { seedPipeline } from './helpers/db-seed.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

const home = useTempHome(after);   // module top level: WORCA_HOME before any getDb()
const PKG = createRequire(import.meta.url)('../package.json');

let srv, base, id;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });

before(async () => {
  process.env.WORCA_MOCK = '1';   // keep every run path offline
  ({ id } = await seedPipeline(join(home, 'proj'), {
    title: 'Alpha', status: 'done', prompt: 'do the thing',
    totalCostUsd: 2.5, totalActiveMs: 300000,
  }));
  const { app } = await import('../ui/server.mjs');  // imported => no port bind
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
});

test('POST returns the payload, a prefilled issue URL and a download filename', async () => {
  const r = await post(`/api/pipelines/${id}/report`, { reason: 'too-slow' });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.payload.schemaVersion, 1);
  assert.equal(body.payload.reason, 'too-slow');
  assert.equal(body.payload.run.id, id);
  assert.deepEqual(body.payload.included, { paths: false, prompt: false, names: false },
    'the endpoint defaults to metadata only');
  assert.match(body.issue.url, /github\.com\/SinishaDjukic\/worca-cc\/issues\/new\?/,
    'the issue link targets package.json bugs.url');
  assert.equal(body.issue.truncated, false);
  assert.equal(body.issue.filename, `worca-run-report-${id}-too-slow.json`,
    'the server names the download so the UI need not re-derive it');
});

test('the opt-in flags ride the body and are honoured', async () => {
  const r = await post(`/api/pipelines/${id}/report`, {
    reason: 'poor-quality', expectation: 'better tests', include: { prompt: true },
  });
  const body = await r.json();
  assert.equal(body.payload.included.prompt, true);
  assert.equal(body.payload.run.prompt, 'do the thing');
  assert.equal(body.payload.expectation, 'better tests');
  assert.equal('title' in body.payload.run, false, 'names stayed off');
});

test('a bad or missing reason is a 400 with the usual { error } envelope', async () => {
  for (const bad of [{}, { reason: '' }, { reason: 'nope' }, { reason: 42 }]) {
    const r = await post(`/api/pipelines/${id}/report`, bad);
    assert.equal(r.status, 400, `${JSON.stringify(bad)} must be rejected`);
    assert.match((await r.json()).error, /reason/, 'the message names the offending field');
  }
});

test('an unknown or malformed id is a 404, never a 400', async () => {
  for (const bad of ['deadbeef', 'nope', '..%2f..%2fetc']) {
    const r = await post(`/api/pipelines/${bad}/report`, { reason: 'too-slow' });
    assert.equal(r.status, 404, `${bad} must read as not-found`);
    assert.deepEqual(await r.json(), { error: 'pipeline not found' });
  }
});

test('GET /api/settings exposes bugsUrl for the Settings links', async () => {
  const r = await fetch(`${base}/api/settings`);
  assert.equal(r.status, 200);
  const { app: info } = await r.json();
  assert.equal(info.bugsUrl, PKG.bugs.url, 'straight from package.json bugs.url');
  assert.equal(info.version, PKG.version, 'the existing About fields still ship');
  assert.ok(info.repoUrl, 'and so does the repo link');
});
