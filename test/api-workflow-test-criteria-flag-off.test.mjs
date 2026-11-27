// test/api-workflow-test-criteria-flag-off.test.mjs — with workflowTests off every Part 4 route answers 404 (D107).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let homeDir, prevHome, srv, base, routes;
before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftcoff-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  delete process.env.WORCA_FLAGS;
  const mod = await import('../ui/server.mjs');
  ({ CRITERIA_ROUTES: routes } = await import('../src/core/workflow-tests/criteria-routes.mjs'));
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('final review M4: CRITERIA_ROUTES lists every route registerCriteriaRoutes registers', async () => {
  const { registerCriteriaRoutes } = await import('../src/core/workflow-tests/criteria-routes.mjs');
  const seen = [];
  const app = Object.fromEntries(['get', 'post', 'put', 'delete'].map((m) => [m, (path) => seen.push(`${m.toUpperCase()} ${path}`)]));
  registerCriteriaRoutes(app, {});
  assert.deepEqual(routes.map((r) => `${r.method} ${r.path}`).sort(), seen.sort());
});

test('every Part 4 route is 404 while the flag is off', async () => {
  assert.ok(routes.length >= 1);
  assert.ok(routes.some((r) => r.method === 'GET' && r.path.endsWith('/judge-models')), 'the judge-models route is listed');
  for (const { method, path } of routes) {
    const url = path.replace(':id', 'wf_x').replace(':ex', '1').replace(':run', '1').replace(':j', '1').replace(':round', '1');
    const r = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) });
    assert.equal(r.status, 404, `${method} ${path}`);
  }
});
