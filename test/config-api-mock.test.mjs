// test/config-api-mock.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';

let proj, srv, base, homeDir, prevHome;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-cfgapi-home-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  proj = await mkdtemp(join(tmpdir(), 'worca-cc-cfgapi-'));
  const { app } = await import('../ui/server.mjs'); // imported => does not bind a port
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(proj, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
});

test('GET /api/config returns mock: false when WORCA_MOCK and ORCH_MOCK are unset', async () => {
  // Ensure env vars are unset
  delete process.env.WORCA_MOCK;
  delete process.env.ORCH_MOCK;

  const r = await fetch(`${base}/api/config?projectDir=${encodeURIComponent(proj)}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.mock, false, 'mock flag should be false when neither env var is set');
});

test('GET /api/config returns mock: true when WORCA_MOCK=1', async () => {
  process.env.WORCA_MOCK = '1';

  const r = await fetch(`${base}/api/config?projectDir=${encodeURIComponent(proj)}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.mock, true, 'mock flag should be true when WORCA_MOCK=1');
});

test('GET /api/config returns mock: true when ORCH_MOCK=1', async () => {
  delete process.env.WORCA_MOCK;
  process.env.ORCH_MOCK = '1';

  const r = await fetch(`${base}/api/config?projectDir=${encodeURIComponent(proj)}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.mock, true, 'mock flag should be true when ORCH_MOCK=1');
});

test('GET /api/config returns mock: false when WORCA_MOCK=0 and ORCH_MOCK=0', async () => {
  process.env.WORCA_MOCK = '0';
  process.env.ORCH_MOCK = '0';

  const r = await fetch(`${base}/api/config?projectDir=${encodeURIComponent(proj)}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.mock, false, 'mock flag should be false when both env vars are 0');
});