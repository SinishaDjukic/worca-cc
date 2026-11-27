// test/api-workflow-tests-flag-off.test.mjs — with workflowTests off every Part 2 route answers 404 (D9, D30).
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
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftoff-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  delete process.env.WORCA_FLAGS;
  const mod = await import('../ui/server.mjs');
  ({ WORKFLOW_TEST_ROUTES: routes } = await import('../src/core/workflow-tests/routes.mjs'));
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('every workflow test route is 404 while the flag is off', async () => {
  assert.equal(routes.length, 23);
  for (const { method, path } of routes) {
    const url = path.replace(':id', 'wf_x').replace(':ex', '1').replace(':run', '1').replace(':try', '1').replace(':name', 'a.md').replace(':pipelineId', 'abcd1234').replace(':key', 'p-1a2b3c4d');
    const r = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) });
    assert.equal(r.status, 404, `${method} ${path}`);
  }
});
