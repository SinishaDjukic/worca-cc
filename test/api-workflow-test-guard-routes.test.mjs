// test/api-workflow-test-guard-routes.test.mjs — workflow tests 3a (D45): a test try never ships. Every push, pull request,
// publish and issue route answers 409 for its run; a normal run is not refused for that reason.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

useTempHome(after);
const TEXT = 'A test try stays in Worca: it is never pushed and gets no pull request or issue.';
let homeDir, prevHome, srv, base, project, tryId, normalId;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b || {}) });

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftship-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_FLAGS = 'workflowTests';
  const mod = await import('../ui/server.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  project = templateRepo('wftship', { branch: 'main', user: true, files: { 'README.md': '# s\n' } });
  const { createPipeline, writeState } = await import('../src/core/artifacts.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const now = new Date().toISOString();
  const seed = async (isTest) => {
    const { id, dir } = await createPipeline(project, { prompt: 'p', title: isTest ? 'Test: x · try 1' : 'normal', isTest });
    await writeState(dir, { projectKey: projectKey(project), id, status: 'done', startedAt: now, updatedAt: now, steps: [],
      branch: { source: 'main', feature: `worca-cc/x-${id}`, baseSha: 'a'.repeat(40) } });
    return id;
  };
  tryId = await seed(true);
  normalId = await seed(false);
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_FLAGS;
  for (const d of [homeDir, project]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('push, pull request, publish and issue: 409 for a test try', async () => {
  for (const [path, body] of [
    ['/api/pr', { id: tryId, projectDir: project, title: 'x' }],
    [`/api/runs/${tryId}/publish`, { projectDir: project }],
    ['/api/push', { id: tryId, projectDir: project }],
    ['/api/pr/describe', { id: tryId, projectDir: project }],
    [`/api/pipelines/${tryId}/report-issue`, {}],
  ]) {
    const r = await post(path, body);
    assert.equal(r.status, 409, path);
    assert.equal((await r.json()).error, TEXT, path);
  }
  const remotes = await fetch(`${base}/api/pr/remotes?id=${tryId}&projectDir=${encodeURIComponent(project)}`);
  assert.equal(remotes.status, 409);
});

test('a normal run is not refused for that reason', async () => {
  for (const [path, body] of [['/api/pr', { id: normalId, projectDir: project, title: 'x' }], ['/api/push', { id: normalId, projectDir: project }]]) {
    const r = await post(path, body);
    const j = await r.json();
    assert.notEqual(j.error, TEXT, path);
  }
});
