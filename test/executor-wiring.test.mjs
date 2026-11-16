// test/executor-wiring.test.mjs — the pieces around the seam: worker homes, the no-op release
// and touch under the local executor, the bridged-model gate, the deployment facts, and the
// chat relay path (worker relay shim -> worker socket -> controller answerer).
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { installExecutor, workerHomeDir, removeWorkerHome, releaseWorker, touchWorker, sweepWorkerHomes } from '../src/core/executor/index.mjs';
import { bridgedModelRefusal, bridgedModelsFor } from '../src/core/executor/gates.mjs';
import { deploymentFacts } from '../src/core/deployment.mjs';
import { createWorkerRegistry } from '../src/core/executor/registry.mjs';
import { createInProcessBackend } from '../src/core/executor/backends/in-process.mjs';
import { createBackend } from '../src/core/executor/backends/index.mjs';
import { startRelayShim } from '../src/worker/relay-shim.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after);
afterEach(() => installExecutor(null));
const CAPS = { engines: {}, platform: process.platform, node: process.version, user: null };

test('worker homes live under <worcaHome>/worker-homes/<kind>/<id>; the sweep keeps what it is told to', () => {
  const run = workerHomeDir({ kind: 'run', id: 'r1' });
  assert.equal(run, join(worcaHome(), 'worker-homes', 'run', 'r1'));
  assert.equal(workerHomeDir({ kind: 'job', id: 'x' }), null);
  for (const d of [run, workerHomeDir({ kind: 'run', id: 'r2' }), workerHomeDir({ kind: 'chat', id: 't1' })]) { mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'f'), 'x'); }
  const removed = sweepWorkerHomes({ keep: ({ kind, id }) => kind === 'chat' || id === 'r2' });
  assert.deepEqual(removed, ['run:r1']);
  assert.equal(existsSync(run), false);
  assert.ok(existsSync(workerHomeDir({ kind: 'run', id: 'r2' })));
  assert.ok(existsSync(workerHomeDir({ kind: 'chat', id: 't1' })));
  removeWorkerHome({ kind: 'chat', id: 't1' });
  assert.equal(existsSync(workerHomeDir({ kind: 'chat', id: 't1' })), false);
});

test('under the local executor releaseWorker and touchWorker are no-ops', async () => {
  assert.equal(await releaseWorker({ kind: 'run', id: 'r1' }), false);
  touchWorker({ kind: 'run', id: 'r1' });
});

test('releaseWorker releases the scope on the registry and removes its HOME unless keepHome', async () => {
  const calls = [];
  const registry = { async release(scope, o) { calls.push([scope, o.reason]); return true; }, touch() {} };
  installExecutor({ kind: 'docker', registry });
  const dir = workerHomeDir({ kind: 'run', id: 'r9' });
  mkdirSync(dir, { recursive: true });
  assert.equal(await releaseWorker({ kind: 'run', id: 'r9' }, { reason: 'paused', keepHome: true }), true);
  assert.ok(existsSync(dir), 'kept across a pause');
  await releaseWorker({ kind: 'run', id: 'r9' }, { reason: 'done' });
  assert.equal(existsSync(dir), false);
  assert.deepEqual(calls.map(([s, r]) => [s.id, r]), [['r9', 'paused'], ['r9', 'done']]);
});

test('the bridged-model gate is silent locally and names the model under a remote executor', () => {
  assert.equal(bridgedModelRefusal(['claude-sonnet-5', 'anything']), null);
  installExecutor({ kind: 'kubernetes', registry: {} });
  assert.deepEqual(bridgedModelsFor(['claude-sonnet-5', '']), [], 'a plain catalog model is not bridged');
  assert.equal(bridgedModelRefusal(['claude-sonnet-5']), null);
});

test("deploymentFacts names the executor on a container; a local install's chat header stays as before", () => {
  assert.equal(deploymentFacts({}), null);
  assert.equal(deploymentFacts({ WORCA_EXECUTOR: 'docker' }), null, 'a native install trying workers gets no deployment line');
  assert.equal(deploymentFacts({ WORCA_EXECUTOR: 'local' }), null);
  assert.equal(deploymentFacts({ WORCA_CONTAINER: '1', WORCA_EXECUTOR: 'kubernetes' })?.executor, 'kubernetes');
  assert.equal(deploymentFacts({ WORCA_CONTAINER: '1' })?.executor, undefined);
});

test('createBackend: the in-process override, and a clear refusal for a backend that is not shipped', async () => {
  const b = await createBackend('docker', { env: { WORCA_EXECUTOR_BACKEND: 'in-process' }, homeRoot: worcaHome() });
  assert.equal(b.kind, 'in-process');
  await assert.rejects(createBackend('docker', { env: { WORCA_EXECUTOR_BACKEND: 'swarm' } }), /not a backend/);
  await assert.rejects(createBackend('nope', { env: {} }), /no backend for executor kind nope/);
});

test('a chat relay line goes from the worker\'s loopback shim over the socket to the controller\'s answerer and back', async () => {
  const seen = [];
  const backend = createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS });
  const registry = createWorkerRegistry({ backend, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, log: () => {},
    onRelay: async (f) => { seen.push([f.token, f.line]); return f.token === 'good' ? { lines: [`answer:${f.line}`], error: null } : { lines: null, error: 'relay: unknown or finished turn' }; } });
  await registry.listen();
  try {
    await registry.acquire({ kind: 'chat', id: 't-relay' });
    const handle = backend.started[0];
    const shim = await startRelayShim({ relay: handle.worker.relay, port: 0 });
    try {
      const post = async (token, body) => {
        const res = await fetch(shim.url, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-worca-relay': token } : {}) }, body: JSON.stringify(body) });
        return { status: res.status, json: await res.json() };
      };
      assert.deepEqual(await post('good', { line: '{"jsonrpc":"2.0","id":1}' }), { status: 200, json: { out: ['answer:{"jsonrpc":"2.0","id":1}'] } });
      assert.deepEqual(await post('bad', { line: 'x' }), { status: 502, json: { error: 'relay: unknown or finished turn' } });
      assert.equal((await post(null, { line: 'x' })).status, 401);
      assert.equal((await post('good', { nope: 1 })).status, 400);
      assert.deepEqual(seen, [['good', '{"jsonrpc":"2.0","id":1}'], ['bad', 'x']]);
    } finally { await shim.close(); }
  } finally { await registry.closeAll(); }
});
