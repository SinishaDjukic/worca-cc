// test/api-executor.test.mjs — the server under a remote executor (docs/workers.md), with the
// in-process backend: the executor is installed from the environment, /api/health says so, a
// mock run completes, and no worker is started for a run that never needed a process.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { installExecutor, isRemoteExecutor } from '../src/core/executor/index.mjs';

useTempHome(after);

let homeDir, srv, base, runs, registry;
const saved = {};
const ENV = { WORCA_MOCK: '1', WORCA_EXECUTOR: 'docker', WORCA_EXECUTOR_BACKEND: 'in-process' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function untilLanded(runId, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = runs.get(runId);
    if (e && e.settled) return e;
    const pq = e && e.pendingQuestion;
    if (pq) await post('/api/answer', { runId, id: pq.id, payload: { decision: 'continue' } });
    await sleep(50);
  }
  throw new Error(`run ${runId} never settled`);
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-exec-api-'));
  for (const k of ['WORCA_HOME', ...Object.keys(ENV)]) saved[k] = process.env[k];
  process.env.WORCA_HOME = homeDir;
  Object.assign(process.env, ENV);
  const mod = await import('../ui/server.mjs');   // imported ⇒ no port bind, no boot block
  ({ runs } = mod);
  ({ registry } = await mod.installExecutorFromEnv({ log: () => {}, host: '127.0.0.1', port: 0 }));
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  await registry?.closeAll('test over');
  installExecutor(null);
  if (srv) await new Promise((r) => srv.close(r));
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('the executor is installed from the environment and /api/health reports it', async () => {
  assert.equal(isRemoteExecutor(), true);
  const h = await (await fetch(`${base}/api/health`)).json();
  assert.equal(h.executor.kind, 'docker');
  assert.equal(h.executor.backend, 'in-process');
  assert.equal(h.executor.workers, 0);
  assert.equal(h.executor.port, registry.port);
  assert.ok(registry.port > 0);
});

test('a mock run completes under the remote executor; no worker is started for a run that spawns nothing', { timeout: 180000 }, async () => {
  const r = await post('/api/run', { noProject: true, prompt: 'Make a hello page', workflowId: 'wf_default', mock: true, humanInLoop: false });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  const { runId } = JSON.parse(text);
  const done = await untilLanded(runId);
  assert.equal(done.status, 'done', JSON.stringify({ status: done.status, reason: done.pauseReason, detail: done.pauseDetail }));
  assert.deepEqual(registry.snapshot(), [], 'nothing acquired: the mock engine spawns no process (acquisition is lazy)');
  const h = await (await fetch(`${base}/api/health`)).json();
  assert.equal(h.executor.workers, 0);
});
