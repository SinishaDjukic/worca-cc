// test/executor-k8s-api.test.mjs — the kubernetes backend against a fake API server: the pod
// create/watch/delete sequence, the fast rejections (image pull, exit before running, pending
// timeout), the token re-read on 401, the watch-to-polling fallback, listing by instance and the
// 409 rename.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKubernetesBackend } from '../src/core/executor/backends/kubernetes.mjs';
import { createK8sApi, K8sApiError } from '../src/core/executor/backends/k8s-api.mjs';

const dir = mkdtempSync(join(tmpdir(), 'worca-k8s-'));
const tokenFile = join(dir, 'token');
const templateFile = join(dir, 'worker-pod.json');
writeFileSync(tokenFile, 'tok\n');
writeFileSync(templateFile, JSON.stringify({
  apiVersion: 'v1', kind: 'Pod', metadata: { labels: { team: 'x' } },
  spec: { nodeSelector: { pool: 'agents' }, containers: [{ name: 'worker', image: 'placeholder', volumeMounts: [{ name: 'home', mountPath: '/worca' }] }], volumes: [{ name: 'home', emptyDir: {} }] },
}));
after(() => rmSync(dir, { recursive: true, force: true }));

const status = (res, code, reason, message) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ kind: 'Status', apiVersion: 'v1', status: 'Failure', message, reason, code }));
};
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

/** A tiny API server: pods in a namespace, a watch that streams on demand, a log endpoint, and hooks for the failure paths. */
async function fakeApi() {
  const pods = new Map();
  const watchers = new Map();   // name -> Set<res>
  const calls = [];
  const deletes = [];
  const hooks = { token: 'tok', createStatus: null, watchFail: 0, logStatus: null, log: 'worker log line 1\nworker log line 2' };
  let rv = 10;
  let created = deferred();
  let watched = deferred();
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const body = await readBody(req);
    calls.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization || null, body: body ? JSON.parse(body) : null });
    if (req.headers.authorization !== `Bearer ${hooks.token}`) return status(res, 401, 'Unauthorized', 'Unauthorized');
    const m = /^\/api\/v1\/namespaces\/([^/]+)\/pods(?:\/([^/]+)(\/log)?)?$/.exec(u.pathname);
    if (!m) return status(res, 404, 'NotFound', `no route ${u.pathname}`);
    const [, ns, name, isLog] = m;
    if (ns !== 'agents') return status(res, 404, 'NotFound', `namespace ${ns} not found`);
    if (req.method === 'POST' && !name) {
      const manifest = calls.at(-1).body;
      if (hooks.createStatus) { const s = hooks.createStatus; hooks.createStatus = null; return status(res, s.code, s.reason, s.message); }
      if (pods.has(manifest.metadata.name)) return status(res, 409, 'AlreadyExists', `pods "${manifest.metadata.name}" already exists`);
      const pod = { ...manifest, metadata: { ...manifest.metadata, namespace: ns, uid: `uid-${rv}`, resourceVersion: String(++rv), creationTimestamp: new Date().toISOString() }, status: { phase: 'Pending' } };
      pods.set(pod.metadata.name, pod);
      json(res, 201, pod);
      const d = created; created = deferred(); d.resolve(pod);
      return;
    }
    if (req.method === 'GET' && !name && u.searchParams.get('watch') === '1') {
      if (hooks.watchFail !== 0) { if (hooks.watchFail > 0) hooks.watchFail -= 1; req.socket.destroy(); return; }
      if (hooks.watchError) {   // the API server answers the watch with an ERROR status, every time
        hooks.watchErrors = (hooks.watchErrors || 0) + 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(`${JSON.stringify({ type: 'ERROR', object: { kind: 'Status', code: 500, message: 'etcdserver: request timed out' } })}\n`);
      }
      const target = /^metadata\.name=(.+)$/.exec(u.searchParams.get('fieldSelector') || '')?.[1];
      res.writeHead(200, { 'content-type': 'application/json', 'transfer-encoding': 'chunked' });
      const pod = pods.get(target);
      const since = u.searchParams.get('resourceVersion');
      // Like the API server: no resourceVersion -> the current state as ADDED; an older one -> replay what changed since.
      if (pod && !since) res.write(`${JSON.stringify({ type: 'ADDED', object: pod })}\n`);
      else if (pod && Number(pod.metadata.resourceVersion) > Number(since)) res.write(`${JSON.stringify({ type: 'MODIFIED', object: pod })}\n`);
      if (!watchers.has(target)) watchers.set(target, new Set());
      watchers.get(target).add(res);
      req.on('close', () => watchers.get(target)?.delete(res));
      const d = watched; watched = deferred(); d.resolve(target);
      return;
    }
    if (req.method === 'GET' && !name) {
      const sel = (u.searchParams.get('labelSelector') || '').split(',').filter(Boolean).map((kv) => kv.split('='));
      const items = [...pods.values()].filter((p) => sel.every(([k, v]) => p.metadata.labels?.[k] === v));
      return json(res, 200, { kind: 'PodList', apiVersion: 'v1', items });
    }
    const pod = pods.get(name);
    if (req.method === 'GET' && isLog) {
      if (hooks.logStatus) return status(res, hooks.logStatus, 'Forbidden', 'pods/log is forbidden');
      if (!pod) return status(res, 404, 'NotFound', `pods "${name}" not found`);
      res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(hooks.log);
    }
    if (req.method === 'GET') return pod ? json(res, 200, pod) : status(res, 404, 'NotFound', `pods "${name}" not found`);
    if (req.method === 'DELETE') {
      deletes.push({ name, grace: u.searchParams.get('gracePeriodSeconds'), body: calls.at(-1).body });
      if (!pod) return status(res, 404, 'NotFound', `pods "${name}" not found`);
      pods.delete(name);
      for (const w of watchers.get(name) || []) w.write(`${JSON.stringify({ type: 'DELETED', object: pod })}\n`);
      return json(res, 200, pod);
    }
    return status(res, 405, 'MethodNotAllowed', req.method);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const api = {
    url: `http://127.0.0.1:${server.address().port}`, pods, calls, deletes, hooks,
    nextCreated: () => created.promise,
    /** Resolves once a watch on some pod is open (so an update is guaranteed to stream). */
    nextWatch: () => watched.promise,
    /** Change a pod and stream the MODIFIED event to its watchers. */
    update(name, patch) {
      const pod = pods.get(name);
      Object.assign(pod.status, patch);
      pod.metadata.resourceVersion = String(++rv);
      for (const w of watchers.get(name) || []) w.write(`${JSON.stringify({ type: 'MODIFIED', object: pod })}\n`);
    },
    watcherCount: (name) => watchers.get(name)?.size || 0,
    endWatches(name) { for (const w of watchers.get(name) || []) w.end(); watchers.get(name)?.clear(); },
    seed(name, { instance = 'worca', workerId = `w-${name}`, scope = `run:${name}` } = {}) {
      pods.set(name, {
        metadata: { name, namespace: 'agents', uid: `uid-${name}`, resourceVersion: String(++rv), creationTimestamp: '2026-11-07T10:00:00Z',
          labels: { 'app.kubernetes.io/managed-by': 'worca', 'app.kubernetes.io/component': 'worker', 'app.kubernetes.io/instance': 'some-release', 'worca.dev/instance': instance, 'worca.dev/engine': 'claude' },
          annotations: { 'worca.dev/scope': scope } },
        spec: { containers: [{ name: 'worker', image: 'img', env: [{ name: 'WORCA_WORKER_ID', value: workerId }] }] }, status: { phase: 'Running' },
      });
    },
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
  return api;
}

/** A backend on the fake, with fast watch retries/polls; `logs` collects its log lines. */
async function setup(t, envExtra = {}) {
  const fake = await fakeApi();
  const logs = [];
  const log = (m) => logs.push(m);
  const env = {
    WORCA_K8S_API_URL: fake.url, WORCA_K8S_TOKEN_FILE: tokenFile, WORCA_K8S_NAMESPACE: 'agents', WORCA_K8S_POD_TEMPLATE: templateFile,
    WORCA_K8S_DEFAULT_ENGINE: 'claude', WORCA_K8S_WORKER_TAG: '9.9.9', WORCA_INSTANCE_ID: 'worca', WORCA_BROKER_URL: 'http://worca-broker:4320', ...envExtra,
  };
  const backend = createKubernetesBackend({ env, log, bootId: 'ctl-test', api: createK8sApi({ env, log, pollMs: 40, retryMs: 10 }) });
  t.after(async () => { await backend.close(); await fake.close(); });
  return { fake, backend, logs, env };
}

const startArgs = (over = {}) => ({ scope: { kind: 'run', id: 'r1' }, scopeKey: 'run:r1', workerId: 'w-run-0001', token: 'one-time', controllerUrl: 'ws://worca-controller:4319', idleMs: null, env: {}, ...over });

test('happy path: the pod is created from the template, resolves on Running, and remove deletes it with a 30 s grace', async (t) => {
  const { fake, backend, logs } = await setup(t);
  const watchOpened = fake.nextWatch();
  const p = backend.start(startArgs());
  const pod = await fake.nextCreated();
  const rv0 = pod.metadata.resourceVersion;
  assert.match(pod.metadata.name, /^worca-w-run-r1-[a-z0-9]+$/);
  const w = pod.spec.containers[0];
  assert.equal(w.image, 'ghcr.io/sinishadjukic/worca-worker:9.9.9-claude');
  const env = Object.fromEntries(w.env.map((e) => [e.name, e.value]));
  assert.equal(env.WORCA_WORKER_TOKEN, 'one-time');
  assert.equal(env.WORCA_CONTROLLER_URL, 'ws://worca-controller:4319');
  assert.equal(env.WORCA_WORKER_SCOPE, 'run:r1');
  assert.equal(env.WORCA_WORKER_ID, 'w-run-0001');
  assert.equal(env.WORCA_HOME, '/worca');
  assert.equal(env.WORCA_PROJECTS_ROOT, '/projects');
  assert.equal(env.WORCA_BROKER_URL, 'http://worca-broker:4320');
  assert.deepEqual(w.volumeMounts, [{ name: 'home', mountPath: '/worca' }], 'template fields reach the API');
  assert.deepEqual(pod.spec.nodeSelector, { pool: 'agents' });
  assert.equal(pod.spec.restartPolicy, 'Never');
  assert.equal(pod.spec.activeDeadlineSeconds, 86400);
  assert.equal(pod.metadata.labels['worca.dev/instance'], 'worca');
  assert.equal(pod.metadata.labels['worca.dev/boot'], 'ctl-test');
  assert.equal(pod.metadata.annotations['worca.dev/scope'], 'run:r1');
  // still pending: the watch is open and nothing resolved
  assert.equal(await watchOpened, pod.metadata.name);
  assert.equal(fake.watcherCount(pod.metadata.name), 1);
  fake.update(pod.metadata.name, { phase: 'Pending', containerStatuses: [{ name: 'worker', state: { waiting: { reason: 'ContainerCreating' } } }] });
  fake.update(pod.metadata.name, { phase: 'Running', containerStatuses: [{ name: 'worker', state: { running: {} } }] });
  const handle = await p;
  assert.equal(handle.name, pod.metadata.name);
  assert.equal(handle.uid, pod.metadata.uid);
  assert.equal(handle.workerId, 'w-run-0001');
  assert.equal(handle.scopeKey, 'run:r1');
  assert.equal(handle.engine, 'claude');
  assert.ok(handle.startedAt > 0);
  assert.equal(backend.describe().live, 1);
  assert.deepEqual(backend.describe(), { kind: 'kubernetes', namespace: 'agents', instanceId: 'worca', template: templateFile, image: 'ghcr.io/sinishadjukic/worca-worker:{version}-{engine}{variant}', variant: 'slim', version: '9.9.9', live: 1 });
  await backend.remove(handle, { reason: 'released' });
  assert.deepEqual(fake.deletes.map((d) => [d.name, d.grace]), [[pod.metadata.name, '30']]);
  assert.equal(fake.deletes[0].body.gracePeriodSeconds, 30);
  assert.equal(backend.describe().live, 0);
  await backend.remove(handle, { reason: 'again' });   // 404 is fine
  assert.ok(logs.some((l) => l.includes('created for run:r1')));
  const watch = fake.calls.find((c) => c.query.watch === '1');
  assert.equal(watch.query.fieldSelector, `metadata.name=${pod.metadata.name}`);
  assert.equal(watch.query.timeoutSeconds, '300');
  assert.equal(watch.query.resourceVersion, rv0);
});

test('a failed image pull gets the kubelet\'s retries: one that recovers starts, one that does not fails after the grace', async (t) => {
  const { fake, backend, logs } = await setup(t, { WORCA_K8S_PULL_GRACE_MS: '200' });
  const pulling = (reason) => ({ phase: 'Pending', containerStatuses: [{ name: 'worker', image: 'ghcr.io/x/worker:1', state: { waiting: { reason, message: 'toomanyrequests' } } }] });
  // A cold node gets one 429 from the registry; the kubelet pulls again and the pod runs.
  const p = backend.start(startArgs());
  const pod = await fake.nextCreated();
  await fake.nextWatch();
  fake.update(pod.metadata.name, pulling('ErrImagePull'));
  await new Promise((r) => setTimeout(r, 60));
  fake.update(pod.metadata.name, { phase: 'Running' });
  assert.equal((await p).name, pod.metadata.name, 'not failed at the first sight of ErrImagePull');
  assert.ok(logs.some((l) => /ErrImagePull for .*; the kubelet retries, waiting up to 0 s/.test(l)), logs.join('\n'));
  // An image that is really not there: still failing when the grace is over.
  const t0 = Date.now();
  const q = backend.start(startArgs({ workerId: 'w-run-0002' })).then(() => null, (e) => e);
  const pod2 = await fake.nextCreated();
  await fake.nextWatch();
  fake.update(pod2.metadata.name, pulling('ErrImagePull'));
  fake.update(pod2.metadata.name, pulling('ImagePullBackOff'));
  const err = await q;
  assert.match(err.message, /cannot start: ImagePullBackOff for image ghcr\.io\/x\/worker:1 \(toomanyrequests\)/);
  assert.ok(Date.now() - t0 >= 180, 'after the grace, not before');
});

test('ImagePullBackOff rejects on the first event, naming the image, and deletes the pod', async (t) => {
  const { fake, backend } = await setup(t, { WORCA_K8S_PULL_GRACE_MS: '0', WORCA_K8S_WORKER_IMAGES: JSON.stringify({ claude: 'reg.local/worker:missing' }) });
  const p = backend.start(startArgs());
  const pod = await fake.nextCreated();
  assert.equal(pod.spec.containers[0].image, 'reg.local/worker:missing');
  await fake.nextWatch();
  fake.update(pod.metadata.name, { phase: 'Pending', containerStatuses: [{ name: 'worker', image: 'reg.local/worker:missing', state: { waiting: { reason: 'ImagePullBackOff', message: 'Back-off pulling image "reg.local/worker:missing"' } } }] });
  const err = await p.then(() => null, (e) => e);
  assert.ok(err, 'rejected');
  assert.match(err.message, /ImagePullBackOff/);
  assert.match(err.message, /reg\.local\/worker:missing/);
  assert.equal(err.errorClass, 'network');
  assert.equal(err.code, 'EWORKERSTART');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(fake.deletes.map((d) => d.name), [pod.metadata.name], 'the pod is cleaned up');
});

test('Unschedulable is logged and waited out until the pending timeout, whose error carries the last condition', async (t) => {
  const { fake, backend, logs } = await setup(t, { WORCA_K8S_PENDING_TIMEOUT_MS: '200' });
  const t0 = Date.now();
  const p = backend.start(startArgs());
  const pod = await fake.nextCreated();
  await fake.nextWatch();
  fake.update(pod.metadata.name, { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable', message: '0/3 nodes are available: insufficient cpu' }] });
  const err = await p.then(() => null, (e) => e);
  assert.ok(Date.now() - t0 >= 180, 'waited for the timeout');
  assert.match(err.message, /did not start within 0 s/);
  assert.match(err.message, /Unschedulable: 0\/3 nodes are available: insufficient cpu/);
  assert.ok(logs.some((l) => /unschedulable: 0\/3 nodes are available/.test(l)), logs.join('\n'));
  for (let i = 0; i < 200 && !fake.deletes.length; i++) await new Promise((r) => setTimeout(r, 10));   // the cleanup DELETE is not awaited by start()
  assert.deepEqual(fake.deletes.map((d) => d.name), [pod.metadata.name]);
});

test('a pod that fails before running rejects with its reason and the log tail', async (t) => {
  const { fake, backend } = await setup(t);
  fake.hooks.log = 'worca worker: WORCA_WORKER_ID is not set\n';
  const p = backend.start(startArgs());
  const pod = await fake.nextCreated();
  await fake.nextWatch();
  fake.update(pod.metadata.name, { phase: 'Failed', containerStatuses: [{ name: 'worker', state: { terminated: { reason: 'Error', exitCode: 78 } } }] });
  const err = await p.then(() => null, (e) => e);
  assert.match(err.message, /^worker pod exited before connecting: Error \(exit code 78\)\nworca worker: WORCA_WORKER_ID is not set$/);
  const logCall = fake.calls.find((c) => c.path.endsWith('/log'));
  assert.equal(logCall.query.tailLines, '50');
  assert.equal(logCall.query.container, 'worker');
});

test('a 403 on the log still rejects, without a tail', async (t) => {
  const { fake, backend } = await setup(t);
  fake.hooks.logStatus = 403;
  const p = backend.start(startArgs());
  const pod = await fake.nextCreated();
  await fake.nextWatch();
  fake.update(pod.metadata.name, { phase: 'Succeeded', containerStatuses: [{ name: 'worker', state: { terminated: { reason: 'Completed', exitCode: 0 } } }] });
  const err = await p.then(() => null, (e) => e);
  assert.equal(err.message, 'worker pod exited before connecting: Completed (exit code 0)');
  assert.equal(err.errorClass, 'network');
});

test('a 401 re-reads the token file and retries once', async (t) => {
  const { fake, backend } = await setup(t);
  assert.deepEqual(await backend.listWorkers(), []);   // the client has read "tok"
  writeFileSync(tokenFile, 'tok2\n');
  fake.hooks.token = 'tok2';
  t.after(() => { writeFileSync(tokenFile, 'tok\n'); });
  const p = backend.start(startArgs());
  const pod = await fake.nextCreated();
  const posts = fake.calls.filter((c) => c.method === 'POST');
  assert.deepEqual(posts.map((c) => c.auth), ['Bearer tok', 'Bearer tok2']);
  fake.update(pod.metadata.name, { phase: 'Running' });
  assert.equal((await p).name, pod.metadata.name);
});

test('a bad token that stays bad surfaces as a K8sApiError 401, not a loop', async (t) => {
  const { fake, backend } = await setup(t);
  fake.hooks.token = 'other';
  const err = await backend.listWorkers().then(() => null, (e) => e);
  assert.ok(err instanceof K8sApiError);
  assert.equal(err.status, 401);
  assert.equal(fake.calls.length, 2, 'one retry');
});

test('a dropped watch falls back to polling, which sees the phase', async (t) => {
  const { fake, backend, logs } = await setup(t);
  fake.hooks.watchFail = -1;
  const p = backend.start(startArgs());
  const pod = await fake.nextCreated();
  await new Promise((r) => setTimeout(r, 120));
  fake.update(pod.metadata.name, { phase: 'Running' });   // no watcher is listening: only a poll can see this
  const handle = await p;
  assert.equal(handle.name, pod.metadata.name);
  assert.ok(fake.calls.filter((c) => c.query.watch === '1').length >= 3, 'three watch attempts');
  assert.ok(fake.calls.some((c) => c.method === 'GET' && c.path.endsWith(`/pods/${pod.metadata.name}`)), 'polled the pod');
  assert.ok(logs.some((l) => /connect failed \(3\)/.test(l)));
});

test('a watch the server ends (its timeoutSeconds) reconnects from the last resourceVersion and keeps following', async (t) => {
  const { fake, backend } = await setup(t);
  const p = backend.start(startArgs());
  const pod = await fake.nextCreated();
  const rv0 = pod.metadata.resourceVersion;
  await fake.nextWatch();
  fake.update(pod.metadata.name, { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'True' }] });
  const rv1 = fake.pods.get(pod.metadata.name).metadata.resourceVersion;
  await new Promise((r) => setTimeout(r, 60));   // the client reads the MODIFIED event: its resourceVersion is rv1 now
  const again = fake.nextWatch();                // (not a fixed wait for the reconnect: a loaded machine makes that flaky)
  fake.endWatches(pod.metadata.name);
  await again;
  const watches = fake.calls.filter((c) => c.query.watch === '1');
  assert.equal(watches.length, 2, 'reconnected once');
  assert.deepEqual(watches.map((w) => w.query.resourceVersion), [rv0, rv1]);
  assert.equal(fake.watcherCount(pod.metadata.name), 1);
  fake.update(pod.metadata.name, { phase: 'Running' });
  assert.equal((await p).name, pod.metadata.name);
});

test("the engine a start names picks the image; an abandoned start stops watching and deletes its pod", async (t) => {
  const { fake, backend } = await setup(t);
  assert.equal(await backend.classFor('codex'), 'ghcr.io/sinishadjukic/worca-worker:9.9.9-codex');
  assert.equal(await backend.classFor(null), 'ghcr.io/sinishadjukic/worca-worker:9.9.9-claude', 'no engine named: the install default');
  const p = backend.start(startArgs({ engine: 'codex' }));
  const pod = await fake.nextCreated();
  assert.equal(pod.spec.containers[0].image, 'ghcr.io/sinishadjukic/worca-worker:9.9.9-codex', "the run's engine, not the install default");
  assert.equal(pod.metadata.labels['worca.dev/engine'], 'codex');
  fake.update(pod.metadata.name, { phase: 'Running' });
  assert.equal((await p).engine, 'codex');
  // The registry gave up on a start (the run was stopped while the pod was Pending).
  const ctl = new AbortController();
  const q = backend.start(startArgs({ workerId: 'w-run-0002', signal: ctl.signal })).then(() => null, (e) => e);
  const pending = await fake.nextCreated();
  ctl.abort();
  assert.equal((await q).name, 'AbortError');
  for (let i = 0; i < 100 && !fake.deletes.some((d) => d.name === pending.metadata.name); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(fake.deletes.some((d) => d.name === pending.metadata.name), 'the pod nobody waits for is deleted');
});

test('the install-wide full variant applies only to engines that have a full worker image', async (t) => {
  const { backend } = await setup(t, { WORCA_K8S_WORKER_VARIANT: 'full', WORCA_K8S_ENGINES: JSON.stringify({ gemini: { variant: 'full' } }) });
  assert.equal(await backend.classFor('claude'), 'ghcr.io/sinishadjukic/worca-worker:9.9.9-claude-full');
  assert.equal(await backend.classFor('all'), 'ghcr.io/sinishadjukic/worca-worker:9.9.9-all-full');
  assert.equal(await backend.classFor('codex'), 'ghcr.io/sinishadjukic/worca-worker:9.9.9-codex', 'no codex-full image is published: its slim one');
  assert.equal(await backend.classFor('gemini'), 'ghcr.io/sinishadjukic/worca-worker:9.9.9-gemini-full', "an engine's own setting is taken as given");
});

test('a watch the API server keeps answering with an error is retried with a growing pause, not in a tight loop', async (t) => {
  const { fake, backend } = await setup(t);
  fake.hooks.watchError = true;
  const p = backend.start(startArgs());
  const pod = await fake.nextCreated();
  await new Promise((r) => setTimeout(r, 400));
  // retryMs is 10 in this setup: pauses of 10, 20, 30… ms fit about eight tries in 400 ms; a tight loop makes hundreds.
  assert.ok(fake.hooks.watchErrors >= 2 && fake.hooks.watchErrors <= 14, `watch requests in 400 ms: ${fake.hooks.watchErrors}`);
  fake.hooks.watchError = false;
  fake.update(pod.metadata.name, { phase: 'Running' });
  assert.equal((await p).name, pod.metadata.name, 'and the start still succeeds once the API recovers');
});

test('listWorkers returns handles for this instance only', async (t) => {
  const { fake, backend } = await setup(t);
  fake.seed('worca-w-run-a-1', { workerId: 'w-run-aaaa', scope: 'run:a' });
  fake.seed('worca-w-chat-b-1', { workerId: 'w-chat-bbbb', scope: 'chat:b' });
  fake.seed('worca-w-run-c-1', { instance: 'other', workerId: 'w-run-cccc', scope: 'run:c' });
  const handles = await backend.listWorkers();
  assert.deepEqual(handles.map((h) => [h.workerId, h.name, h.scopeKey, h.engine, h.uid]).sort(), [
    ['w-chat-bbbb', 'worca-w-chat-b-1', 'chat:b', 'claude', 'uid-worca-w-chat-b-1'],
    ['w-run-aaaa', 'worca-w-run-a-1', 'run:a', 'claude', 'uid-worca-w-run-a-1'],
  ]);
  assert.equal(fake.calls.at(-1).query.labelSelector, 'app.kubernetes.io/managed-by=worca,app.kubernetes.io/component=worker,worca.dev/instance=worca');
  await backend.remove(handles[0], { reason: 'orphan at boot' });
  assert.equal(fake.deletes[0].grace, '30');
});

test('409 on create regenerates the name once', async (t) => {
  const { fake, backend, logs } = await setup(t);
  fake.hooks.createStatus = { code: 409, reason: 'AlreadyExists', message: 'pods "x" already exists' };
  const p = backend.start(startArgs());
  const pod = await fake.nextCreated();
  const posts = fake.calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 2);
  assert.notEqual(posts[0].body.metadata.name, posts[1].body.metadata.name);
  assert.equal(pod.metadata.name, posts[1].body.metadata.name);
  assert.ok(logs.some((l) => /already exists; retrying/.test(l)));
  fake.update(pod.metadata.name, { phase: 'Running' });
  await p;
});

test('403/422 on create reject with the API message; a missing template rejects naming the path', async (t) => {
  const { fake, backend } = await setup(t);
  fake.hooks.createStatus = { code: 422, reason: 'Invalid', message: 'Pod "x" is invalid: spec.containers[0].image: Required value' };
  let err = await backend.start(startArgs()).then(() => null, (e) => e);
  assert.equal(err.message, 'cannot create worker pod: Pod "x" is invalid: spec.containers[0].image: Required value');
  assert.equal(err.errorClass, 'network');
  assert.equal(err.status, 422);
  fake.hooks.createStatus = { code: 403, reason: 'Forbidden', message: 'pods is forbidden: User "system:serviceaccount:agents:worca" cannot create resource "pods"' };
  err = await backend.start(startArgs()).then(() => null, (e) => e);
  assert.match(err.message, /^cannot create worker pod: pods is forbidden/);
  const missing = createKubernetesBackend({ env: { ...process.env, WORCA_K8S_API_URL: fake.url, WORCA_K8S_TOKEN_FILE: tokenFile, WORCA_K8S_NAMESPACE: 'agents', WORCA_K8S_POD_TEMPLATE: join(dir, 'nope.json'), WORCA_K8S_DEFAULT_ENGINE: 'claude' }, log: () => {} });
  t.after(() => missing.close());
  err = await missing.start(startArgs()).then(() => null, (e) => e);
  assert.match(err.message, /worker pod template .*nope\.json: ENOENT/);
  writeFileSync(join(dir, 'bad.json'), '{ not json');
  const bad = createKubernetesBackend({ env: { WORCA_K8S_API_URL: fake.url, WORCA_K8S_TOKEN_FILE: tokenFile, WORCA_K8S_NAMESPACE: 'agents', WORCA_K8S_POD_TEMPLATE: join(dir, 'bad.json'), WORCA_K8S_DEFAULT_ENGINE: 'claude' }, log: () => {} });
  t.after(() => bad.close());
  err = await bad.start(startArgs()).then(() => null, (e) => e);
  assert.match(err.message, /worker pod template .*bad\.json is not valid JSON: /);
  assert.equal(fake.calls.filter((c) => c.method === 'POST').length, 2, 'no pod was attempted without a template');
});

test('the pre-warm hook watches an existing pod instead of creating one; forbidden env in start() is refused before any call', async (t) => {
  const { fake, backend } = await setup(t);
  fake.seed('worca-w-prewarmed', { workerId: 'w-run-0001', scope: 'run:r1' });
  fake.pods.get('worca-w-prewarmed').status = { phase: 'Pending' };
  const p = backend.start(startArgs({ prewarmed: { name: 'worca-w-prewarmed' } }));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fake.calls.filter((c) => c.method === 'POST').length, 0);
  fake.update('worca-w-prewarmed', { phase: 'Running' });
  const handle = await p;
  assert.equal(handle.name, 'worca-w-prewarmed');
  assert.equal(handle.workerId, 'w-run-0001');
  const before = fake.calls.length;
  const err = await backend.start(startArgs({ env: { GH_TOKEN: 'x' } })).then(() => null, (e) => e);
  assert.match(err.message, /refusing to pass GH_TOKEN/);
  assert.equal(fake.calls.length, before);
});

test('WORCA_K8S_ENGINES (the chart\'s per-engine overrides) sets the image, variant and resources for that engine only', async (t) => {
  const engines = { claude: { image: 'reg.local/claude-worker:pinned', resources: { limits: { memory: '8Gi' } } }, codex: { variant: 'full' } };
  const { fake, backend } = await setup(t, { WORCA_K8S_ENGINES: JSON.stringify(engines), WORCA_K8S_RESOURCES: JSON.stringify({ limits: { memory: '2Gi' } }) });
  const p = backend.start(startArgs());
  const pod = await fake.nextCreated();
  const w = pod.spec.containers[0];
  assert.equal(w.image, 'reg.local/claude-worker:pinned', 'the engine\'s own image wins over the pattern');
  assert.deepEqual(w.resources, { limits: { memory: '8Gi' } }, 'the engine\'s resources win over WORCA_K8S_RESOURCES');
  await fake.nextWatch();
  fake.update(pod.metadata.name, { phase: 'Running', containerStatuses: [{ name: 'worker', state: { running: {} } }] });
  const handle = await p;
  await backend.remove(handle, { reason: 'done' });
  // Another engine keeps the defaults — and a `full` variant lands in the image tag.
  const { fake: f2, backend: b2 } = await setup(t, { WORCA_K8S_ENGINES: JSON.stringify(engines), WORCA_K8S_DEFAULT_ENGINE: 'codex' });
  const p2 = b2.start(startArgs());
  const pod2 = await f2.nextCreated();
  assert.equal(pod2.spec.containers[0].image, 'ghcr.io/sinishadjukic/worca-worker:9.9.9-codex-full');
  await f2.nextWatch();
  f2.update(pod2.metadata.name, { phase: 'Running', containerStatuses: [{ name: 'worker', state: { running: {} } }] });
  await b2.remove(await p2, { reason: 'done' });
});

test('WORCA_K8S_ENGINES that is not an object is refused at boot', () => {
  // A stub api: the refusal happens while reading the configuration, before any call.
  assert.throws(() => createKubernetesBackend({ env: { WORCA_K8S_ENGINES: '[1]', WORCA_K8S_POD_TEMPLATE: '/nonexistent.json' }, api: { namespace: 'agents', close() {} }, log: () => {} }), /WORCA_K8S_ENGINES must be a JSON object/);
});
