// test/executor-docker-backend.test.mjs — the docker executor backend against a fake Docker Engine
// API on a unix socket: the controller's own container is the template for every worker (mounts
// minus the socket, the login volume as a read-only seed, network, user), the container spec, the
// labels the boot reap lists by, fast failure when a container dies at once, and removal.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDockerBackend, createDockerApi, dockerEndpoint, parseBytes, workerMountsFrom, workerImageFor, workerEnvFor, demuxLogs, CONTROLLER_LABEL, SCOPE_LABEL, WORKER_LABEL, pickWorkerNetwork, containerIdFrom, selfContainerId, seedsClaudeLogin } from '../src/core/executor/backends/docker.mjs';
import { seedClaudeLogin } from '../src/worker/main.mjs';

const SELF = 'abc123';
const selfMounts = [
  { Type: 'volume', Name: 'worca_worca-home', Source: '/var/lib/docker/volumes/worca_worca-home/_data', Destination: '/worca', RW: true },
  { Type: 'volume', Name: 'worca_claude-config', Source: '/var/lib/docker/volumes/worca_claude-config/_data', Destination: '/home/worca/.claude', RW: true },
  { Type: 'bind', Source: '/Users/me/dev', Destination: '/Users/me/dev', RW: true },
  { Type: 'bind', Source: '/etc/ssl/corp.pem', Destination: '/etc/worca/ca.pem', RW: false },
  { Type: 'bind', Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock', RW: false },
];

/** A fake Engine on a unix socket. `dieAtOnce` makes started containers exit immediately. */
function fakeDocker({ dieAtOnce = false, imageMissing = false, selfUser = '1000:1000' } = {}) {
  const dir = mkdtempSync(join('/tmp', 'wd-'));
  const socketPath = join(dir, 's.sock');
  const containers = new Map();   // id -> { spec, name, running, labels }
  let n = 0;
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      const url = new URL(req.url, 'http://docker');
      const path = url.pathname.replace(/^\/v[\d.]+/, '');
      calls.push([req.method, path]);
      const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (req.method === 'GET' && path === '/version') return json(200, { Version: '27.0.0' });
      if (req.method === 'GET' && path === `/containers/${SELF}/json`) {
        return json(200, { Id: SELF, Name: '/worca-worca-1', Mounts: selfMounts, Config: { Image: 'ghcr.io/sinishadjukic/worca:1.20.0', User: selfUser }, NetworkSettings: { Networks: { worca_default: {}, worca_docker_proxy: {} } } });
      }
      if (req.method === 'POST' && path === '/containers/create') {
        if (imageMissing) return json(404, { message: `No such image: ${body.Image}` });
        const id = `c${++n}`.padEnd(12, '0');
        containers.set(id, { spec: body, name: url.searchParams.get('name'), running: false, exited: false });
        return json(201, { Id: id });
      }
      const m = /^\/containers\/([^/]+)(?:\/(\w+))?$/.exec(path);
      if (m && containers.has(m[1])) {
        const c = containers.get(m[1]);
        if (req.method === 'POST' && m[2] === 'start') { if (dieAtOnce) c.exited = true; else c.running = true; return json(204); }
        if (req.method === 'GET' && m[2] === 'json') return json(200, { Id: m[1], State: { Running: c.running, Status: c.exited ? 'exited' : c.running ? 'running' : 'created', ExitCode: c.exited ? 78 : 0 } });
        if (req.method === 'GET' && m[2] === 'logs') { const line = Buffer.from('worca worker: WORCA_CONTROLLER_URL is not set\n'); const head = Buffer.alloc(8); head[0] = 2; head.writeUInt32BE(line.length, 4); res.writeHead(200); return res.end(Buffer.concat([head, line])); }
        if (req.method === 'DELETE' && !m[2]) { containers.delete(m[1]); return json(204); }
      }
      if (req.method === 'GET' && path === '/containers/json') {
        const want = JSON.parse(url.searchParams.get('filters')).label;
        const rows = [...containers.entries()].filter(([, c]) => want.every((l) => { const [k, v] = l.split(/=(.*)/s); return c.spec.Labels && k in c.spec.Labels && (v === undefined || c.spec.Labels[k] === v); })).map(([id, c]) => ({ Id: id, Names: [`/${c.name}`], Image: c.spec.Image, Labels: c.spec.Labels }));
        return json(200, rows);
      }
      json(404, { message: `no such route ${req.method} ${path}` });
    });
  });
  return new Promise((resolve) => server.listen(socketPath, () => resolve({
    socketPath, containers, calls,
    close: () => new Promise((r) => { server.close(() => { rmSync(dir, { recursive: true, force: true }); r(); }); server.closeAllConnections?.(); }),
  })));
}

const env = (socketPath, extra = {}) => ({ WORCA_DOCKER_HOST: `unix://${socketPath}`, WORCA_CONTROLLER_CONTAINER: SELF, HOME: '/home/worca', SSH_AUTH_SOCK: '/ssh-agent.sock', TZ: 'Europe/Sofia', WORCA_BROKER_URL: 'http://broker:8080', HTTPS_PROXY: 'http://127.0.0.1:3128', GH_TOKEN: 'ghp_secret', ANTHROPIC_API_KEY: 'sk-secret', ...extra });

test('pure helpers: bytes, endpoints, mounts, images, env', () => {
  assert.equal(parseBytes('4g'), 4 * 1024 ** 3);
  assert.equal(parseBytes('512m'), 512 * 1024 ** 2);
  assert.equal(parseBytes('1024'), 1024);
  assert.equal(parseBytes('lots'), null);
  assert.deepEqual(dockerEndpoint({}), { socketPath: '/var/run/docker.sock' });
  assert.deepEqual(dockerEndpoint({ WORCA_DOCKER_HOST: 'tcp://docker-proxy:2375' }), { host: 'docker-proxy', port: 2375 });
  assert.deepEqual(dockerEndpoint({ WORCA_DOCKER_HOST: 'unix:///run/podman/podman.sock' }), { socketPath: '/run/podman/podman.sock' });
  assert.throws(() => dockerEndpoint({ WORCA_DOCKER_HOST: 'ssh://x' }), /expected tcp:\/\/host:port/);
  assert.deepEqual(workerMountsFrom(selfMounts), [
    { Type: 'volume', Source: 'worca_worca-home', Target: '/worca', ReadOnly: false },
    { Type: 'volume', Source: 'worca_claude-config', Target: '/seed/claude', ReadOnly: true },
    { Type: 'bind', Source: '/Users/me/dev', Target: '/Users/me/dev', ReadOnly: false },
    { Type: 'bind', Source: '/etc/ssl/corp.pem', Target: '/etc/worca/ca.pem', ReadOnly: true },
  ], 'the socket never reaches a worker; the login volume rides read-only as the seed');
  assert.equal(workerImageFor('codex', { pattern: null, controllerImage: 'ghcr.io/sinishadjukic/worca:1.20.0' }), 'ghcr.io/sinishadjukic/worca-worker:1.20.0-codex');
  assert.equal(workerImageFor('codex', { pattern: null, controllerImage: 'registry:5000/worca' }), 'registry:5000/worca-worker:latest-codex');
  assert.equal(workerImageFor('codex', { pattern: 'my/worker:{engine}-x', controllerImage: 'a:b' }), 'my/worker:codex-x');
  assert.equal(workerImageFor('codex', { pattern: 'self', controllerImage: 'a:b' }), 'a:b');
  // WORCA_TAG=1.3.0-full: the variant goes AFTER the engine, as the images are published, and only for the engines
  // that have a full worker image; the others run their slim one.
  assert.equal(workerImageFor('claude', { pattern: 'ghcr.io/x/worca-worker:1.3.0-full-{engine}', controllerImage: 'a:b' }), 'ghcr.io/x/worca-worker:1.3.0-claude-full');
  assert.equal(workerImageFor('codex', { pattern: 'ghcr.io/x/worca-worker:1.3.0-full-{engine}', controllerImage: 'a:b' }), 'ghcr.io/x/worca-worker:1.3.0-codex');
  assert.equal(workerImageFor('all', { pattern: null, controllerImage: 'ghcr.io/x/worca:1.3.0-full' }), 'ghcr.io/x/worca-worker:1.3.0-all-full');
  assert.equal(workerImageFor('gemini', { pattern: null, controllerImage: 'ghcr.io/x/worca:1.3.0-full' }), 'ghcr.io/x/worca-worker:1.3.0-gemini');
  assert.equal(workerImageFor('codex', { pattern: null, controllerImage: 'ghcr.io/x/worca:1.3.0-full', fullEngines: ['codex'] }), 'ghcr.io/x/worca-worker:1.3.0-codex-full', 'WORCA_WORKER_FULL_ENGINES');
  assert.equal(workerImageFor('codex', { pattern: 'my/worker-full:{engine}', controllerImage: 'a:b' }), 'my/worker-full:codex', 'only a tag that ends in -full-<engine> is reordered');
  // A digest-pinned controller: the tag before the digest is what the worker images share; a digest alone names none.
  const digest = `sha256:${'c'.repeat(64)}`;
  assert.equal(workerImageFor('claude', { pattern: null, controllerImage: `ghcr.io/x/worca:1.3.0@${digest}` }), 'ghcr.io/x/worca-worker:1.3.0-claude');
  assert.equal(workerImageFor('claude', { pattern: null, controllerImage: `registry:5000/x/worca@${digest}` }), null, 'nothing to derive from: WORCA_WORKER_IMAGE must say');
  assert.equal(workerImageFor('claude', { pattern: 'my/worker:{engine}', controllerImage: `ghcr.io/x/worca@${digest}` }), 'my/worker:claude');
  const e = workerEnvFor({ scopeKey: 'run:r1', workerId: 'w1', token: 't', controllerUrl: 'ws://worca:4319', idleMs: null, engine: 'claude', env: env('/x') });
  assert.equal(e.WORCA_WORKER_SCOPE, 'run:r1');
  assert.equal(e.WORCA_NO_DB, '1');
  assert.equal(e.TZ, 'Europe/Sofia');
  assert.equal(e.WORCA_BROKER_URL, 'http://broker:8080');
  assert.equal(e.HTTPS_PROXY, undefined, 'a loopback proxy is dropped');
  assert.equal(e.GH_TOKEN, undefined);
  assert.equal(e.ANTHROPIC_API_KEY, undefined, 'credentials never ride the container env');
  assert.equal(e.WORCA_WORKER_SEED_CLAUDE, '/seed/claude');
  assert.equal(demuxLogs(Buffer.from('plain')), 'plain');
});

test('the backend replicates the controller container and runs a worker on the same network with the right spec', async () => {
  const d = await fakeDocker();
  try {
    const logs = [];
    const b = await createDockerBackend({ uid: 1000, gid: 1000, env: env(d.socketPath, { WORCA_WORKER_MEM: '2g', WORCA_WORKER_CPUS: '1.5' }), log: (l) => logs.push(l) });
    assert.equal(b.kind, 'docker');
    assert.equal(b.template.network, 'worca_default');
    assert.equal(b.template.user, '1000:1000');
    // With agent isolation the controller's CONTAINER starts as root and its entrypoint drops to `worca`: workers get
    // the uid the controller process runs as, not the container's configured user (a root worker with every capability
    // dropped could not write the volume `worca` owns). WORCA_WORKER_USER still names one outright.
    const asRoot = await fakeDocker({ selfUser: '0:0' });
    try {
      assert.equal((await createDockerBackend({ uid: 1000, gid: 1000, env: env(asRoot.socketPath), log: () => {} })).template.user, '1000:1000');
      assert.equal((await createDockerBackend({ uid: 1000, gid: 1000, env: env(asRoot.socketPath, { WORCA_WORKER_USER: '2000:2000' }), log: () => {} })).template.user, '2000:2000');
      assert.equal((await createDockerBackend({ uid: null, gid: null, env: env(asRoot.socketPath), log: () => {} })).template.user, '0:0', 'no uid to ask (Windows): the container\'s own');
    } finally { await asRoot.close(); }
    assert.match(logs[0], /docker 27\.0\.0 .* 4 mount\(s\) replicated/);
    const h = await b.start({ scope: { kind: 'run', id: 'r-1' }, scopeKey: 'run:r-1', workerId: 'w-run-abcd1234', token: 'tok', controllerUrl: 'ws://worca:4319', idleMs: null });
    assert.match(h.name, /^worca-worker-run-r-1-abcd1234$/);
    assert.equal(h.image, 'ghcr.io/sinishadjukic/worca-worker:1.20.0-claude');
    const [, c] = [...d.containers.entries()][0];
    assert.deepEqual(c.spec.Cmd, ['worca', 'worker']);
    assert.equal(c.spec.User, '1000:1000');
    assert.equal(c.spec.HostConfig.NetworkMode, 'worca_default');
    assert.deepEqual(c.spec.HostConfig.CapDrop, ['ALL']);
    assert.deepEqual(c.spec.HostConfig.RestartPolicy, { Name: 'no' });
    assert.equal(c.spec.HostConfig.Memory, 2 * 1024 ** 3);
    assert.equal(c.spec.HostConfig.NanoCpus, 1.5e9);
    assert.equal(c.spec.HostConfig.Init, true);
    assert.deepEqual(c.spec.HostConfig.Mounts.map((m) => m.Target), ['/worca', '/seed/claude', '/Users/me/dev', '/etc/worca/ca.pem']);
    assert.equal(c.spec.Labels[SCOPE_LABEL], 'run:r-1');
    assert.equal(c.spec.Labels['worca.instance'], 'worca-worca-1', 'which installation the worker belongs to (the Compose project, else the controller container)');
    assert.equal(c.spec.Labels[WORKER_LABEL], 'w-run-abcd1234');
    assert.ok(c.spec.Labels[CONTROLLER_LABEL]);
    assert.ok(c.spec.Env.includes('WORCA_WORKER_TOKEN=tok'));
    assert.ok(c.spec.Env.includes('WORCA_WORKER_SEED_CLAUDE=/seed/claude'), 'a Claude worker copies the login');
    assert.equal(c.spec.HostConfig.PidsLimit, 2048, "the one-container box's process limit");
    // A worker for an engine that never runs Claude Code gets neither the login volume nor the order to copy it.
    assert.deepEqual([seedsClaudeLogin('claude', null), seedsClaudeLogin('all', null), seedsClaudeLogin('codex', null)], [true, true, false]);
    assert.equal(seedsClaudeLogin('codex', 'reg/w:1-{engine}'), false);
    assert.equal(seedsClaudeLogin('codex', 'reg/one-image:1'), true, 'one image for every engine: Claude Code may run there too');
    assert.equal(seedsClaudeLogin('codex', 'self'), true);
    const hc = await b.start({ scope: { kind: 'run', id: 'r-cx' }, scopeKey: 'run:r-cx', workerId: 'w-run-cdef5678', token: 'tok2', controllerUrl: 'ws://worca:4319', idleMs: null, engine: 'codex' });
    const cx = [...d.containers.values()].find((x) => x.spec.Labels[WORKER_LABEL] === 'w-run-cdef5678');
    assert.equal(hc.image, 'ghcr.io/sinishadjukic/worca-worker:1.20.0-codex');
    assert.deepEqual(cx.spec.HostConfig.Mounts.map((m) => m.Target), ['/worca', '/Users/me/dev', '/etc/worca/ca.pem']);
    assert.ok(!cx.spec.Env.some((e) => e.startsWith('WORCA_WORKER_SEED_CLAUDE=')));
    await b.remove(hc, { reason: 'test' });
    // A start abandoned before anything was created (the run was stopped meanwhile) creates nothing.
    const stopped = new AbortController(); stopped.abort();
    const made = d.containers.size;
    await assert.rejects(b.start({ scope: { kind: 'run', id: 'r-ab' }, scopeKey: 'run:r-ab', workerId: 'w-run-abab0000', token: 't', controllerUrl: 'ws://worca:4319', idleMs: null, signal: stopped.signal }), (e) => e.name === 'AbortError');
    assert.equal(d.containers.size, made, 'no container for a run that is over');
    assert.ok(c.spec.Env.includes('WORCA_CONTROLLER_URL=ws://worca:4319'));
    assert.ok(!c.spec.Env.some((e) => e.startsWith('GH_TOKEN=')));
    const listed = await b.listWorkers();
    assert.deepEqual(listed.map((w) => [w.workerId, w.scopeKey]), [['w-run-abcd1234', 'run:r-1']]);
    assert.equal(listed[0].own, true, 'started by this controller process: boot maintenance must not reap it');
    // Another worca stack on the same Docker host: its workers are not ours to list, reap or remove.
    d.containers.set('foreign00000', { spec: { Image: 'x', Labels: { [CONTROLLER_LABEL]: 'ctl-other', 'worca.instance': 'other-stack', [WORKER_LABEL]: 'w-run-other', [SCOPE_LABEL]: 'run:o' } }, name: 'worca-worker-run-o', running: true, exited: false });
    assert.deepEqual((await b.listWorkers()).map((w) => w.workerId), ['w-run-abcd1234']);
    d.containers.delete('foreign00000');
    assert.equal(await b.probe(h), null, 'a running container may still connect');
    await b.remove(h, { reason: 'done' });
    assert.equal(d.containers.size, 0);
    assert.deepEqual(await b.listWorkers(), []);
    assert.equal(b.describe().image, 'ghcr.io/sinishadjukic/worca-worker:1.20.0-<engine>');
    // The engine a start names (the run's, the chat's) picks the image; the install default only when none is named.
    // While the registry waits for a worker's hello it asks whether the container is still there: this one was removed.
    assert.equal(await b.probe(h), 'its container is gone');
    const h2 = await b.start({ scope: { kind: 'run', id: 'r-2' }, scopeKey: 'run:r-2', workerId: 'w-run-ffff0002', token: 'tok2', controllerUrl: 'ws://worca:4319', idleMs: null, engine: 'codex' });
    assert.equal(h2.image, 'ghcr.io/sinishadjukic/worca-worker:1.20.0-codex');
    assert.equal(await b.classFor('codex'), h2.image, 'the class the registry tells workers apart by is the image');
    assert.equal(await b.classFor(null), 'ghcr.io/sinishadjukic/worca-worker:1.20.0-claude');
    await b.remove(h2, { reason: 'done' });
  } finally { await d.close(); }
});

test("the controller finds its own container id in /proc, whatever the cgroup version, and falls back to the hostname", () => {
  const id = 'a'.repeat(40) + '0123456789abcdef01234567';
  assert.equal(id.length, 64);
  assert.equal(containerIdFrom(`12:memory:/docker/${id}\n11:cpu:/docker/${id}\n`), id, 'cgroup v1');
  assert.equal(containerIdFrom(`0::/system.slice/docker-${id}.scope\n`), id, 'the systemd cgroup driver');
  assert.equal(containerIdFrom('0::/\n', `705 573 0:52 / / rw - overlay overlay rw\n710 705 8:1 /var/lib/docker/containers/${id}/hostname /etc/hostname rw - ext4 /dev/sda1 rw\n`), id, 'cgroup v2: the id is in the mounts Docker makes');
  assert.equal(containerIdFrom('0::/\n', '705 573 0:52 / / rw - overlay overlay rw\n'), null);
  // As a real Docker 29 / overlay2 / cgroup v2 container has it: the root mount's upperdir and a volume carry 64-hex
  // ids of their own, BEFORE the container's files. Only the container's own folder names the container.
  const layer = 'b'.repeat(64); const vol = 'c'.repeat(64);
  const real = [
    `1479 1100 0:215 / / rw,relatime master:412 - overlay overlay rw,lowerdir=/var/lib/docker/overlay2/l/ABC,upperdir=/var/lib/docker/overlay2/${layer}/diff,workdir=/var/lib/docker/overlay2/${layer}/work`,
    `1492 1479 8:2 /var/lib/docker/volumes/${vol}/_data /worca rw,relatime - ext4 /dev/sda2 rw`,
    `1493 1479 8:2 /var/lib/docker/containers/${id}/resolv.conf /etc/resolv.conf rw,relatime - ext4 /dev/sda2 rw`,
    `1494 1479 8:2 /var/lib/docker/containers/${id}/hostname /etc/hostname rw,relatime - ext4 /dev/sda2 rw`, ''].join('\n');
  assert.equal(containerIdFrom('0::/\n', real), id, "not the image layer's id, not a volume's");
  assert.equal(containerIdFrom('0::/\n', real.split('\n').slice(0, 2).join('\n') + '\n'), null, 'no container file mounted: the hostname decides');
  assert.equal(containerIdFrom(`1:name=x:/docker/${id.slice(0, 63)}\n`), null, 'not 64 hex characters: not an id');
  const read = (files) => (f) => { if (f in files) return files[f]; throw new Error('ENOENT'); };
  assert.equal(selfContainerId({ HOSTNAME: 'my-host' }, { read: read({ '/proc/self/cgroup': `1:cpu:/docker/${id}\n` }) }), id, 'a controller with a hostname of its own is still found');
  assert.equal(selfContainerId({ HOSTNAME: 'abc123def456' }, { read: read({}) }), 'abc123def456');
  assert.equal(selfContainerId({ WORCA_CONTROLLER_CONTAINER: 'named', HOSTNAME: 'h' }, { read: read({ '/proc/self/cgroup': `1:cpu:/docker/${id}\n` }) }), 'named');
});

test('a Docker Engine that accepts a request and never answers fails it after the time limit', async () => {
  const dir = mkdtempSync(join('/tmp', 'wd-hang-'));
  const socketPath = join(dir, 's.sock');
  const open = new Set();
  const server = http.createServer(() => { /* never answers */ });
  server.on('connection', (s) => { open.add(s); s.on('close', () => open.delete(s)); });
  await new Promise((r) => server.listen(socketPath, r));
  try {
    const api = createDockerApi({ socketPath }, { timeoutMs: 80 });
    const t0 = Date.now();
    await assert.rejects(api.version(), /docker GET \/version: no answer within 0 s/);
    assert.ok(Date.now() - t0 < 3000);
  } finally { for (const s of open) s.destroy(); await new Promise((r) => server.close(r)); rmSync(dir, { recursive: true, force: true }); }
});

test('the worker network: never the Docker API one, an internal one before an open one, or the one named', async () => {
  const nets = {
    worca_default: { Internal: false, Labels: {} },
    'worca_docker-proxy': { Internal: true, Labels: { 'worca.role': 'docker-api' } },
    worca_internal: { Internal: true, Labels: {} },
  };
  const inspect = async (n) => nets[n];
  const pick = (attached, o = {}) => pickWorkerNetwork({ attached, inspect, ...o });
  assert.equal(await pick(['worca_default', 'worca_docker-proxy']), 'worca_default', 'the workers overlay alone');
  assert.equal(await pick(['worca_docker-proxy', 'worca_internal']), 'worca_internal', 'with the egress allowlist: workers have no route but the proxy');
  // A controller that is (wrongly) on the open network too: workers still join only the internal one, and it says so.
  const logs = [];
  assert.equal(await pick(['worca_default', 'worca_docker-proxy', 'worca_internal'], { log: (l) => logs.push(l) }), 'worca_internal');
  assert.match(logs[0], /the controller is on worca_default as well as the internal network worca_internal: .*WORCA_UPLINK_NETWORK=internal/);
  await assert.rejects(pick(['worca_docker-proxy']), /only on sidecar link networks/);
  // The broker's link network (compose.broker.yml, labelled worca.role=broker-link) is never a worker's uplink, and no
  // sign that the controller's own traffic is unconfined.
  nets.worca_broker = { Internal: true, Labels: { 'worca.role': 'broker-link' } };
  const quiet = [];
  assert.equal(await pick(['worca_broker', 'worca_default', 'worca_docker-proxy']), 'worca_default');
  assert.equal(await pick(['worca_broker', 'worca_internal', 'worca_docker-proxy'], { log: (l) => quiet.push(l) }), 'worca_internal');
  assert.deepEqual(quiet, []);

  assert.equal(await pick(['a', 'worca_default'], { override: 'worca_default' }), 'worca_default');
  await assert.rejects(pick(['worca_default'], { override: 'nope' }), /WORCA_WORKER_NETWORK=nope is not a network of the controller's container/);
  assert.equal(await pick([]), 'bridge');
  // An Engine that does not answer about networks (a strict socket proxy): the names decide.
  const blind = (attached) => pickWorkerNetwork({ attached, inspect: async () => { throw new Error('403'); } });
  assert.equal(await blind(['x_broker', 'x_default']), 'x_default', 'a broker link network by name, when the Engine does not answer');
  assert.equal(await blind(['worca_default', 'worca_docker-proxy']), 'worca_default');
  assert.equal(await blind(['worca_default', 'worca_docker-proxy', 'worca_internal']), 'worca_internal');
});

test('a worker container that exits at once is reported with its log tail and removed; a missing image names itself', async () => {
  const d = await fakeDocker({ dieAtOnce: true });
  try {
    const b = await createDockerBackend({ uid: 1000, gid: 1000, env: env(d.socketPath), log: () => {} });
    const err = await b.start({ scope: { kind: 'chat', id: 't' }, scopeKey: 'chat:t', workerId: 'w-chat-1', token: 't', controllerUrl: 'ws://w:1', idleMs: 1000 }).then(() => null, (e) => e);
    assert.match(err.message, /exited at once \(code 78\)/);
    assert.match(err.message, /WORCA_CONTROLLER_URL is not set/, 'the log tail rides the error');
    assert.equal(d.containers.size, 0, 'removed');
  } finally { await d.close(); }
  const d2 = await fakeDocker({ imageMissing: true });
  try {
    const b = await createDockerBackend({ uid: 1000, gid: 1000, env: env(d2.socketPath, { WORCA_WORKER_IMAGE: 'nope/worker:{engine}' }), log: () => {} });
    const err = await b.start({ scope: { kind: 'run', id: 'r' }, scopeKey: 'run:r', workerId: 'w', token: 't', controllerUrl: 'ws://w:1', idleMs: null }).then(() => null, (e) => e);
    assert.match(err.message, /cannot create worker container from nope\/worker:claude: .*404 No such image.*a missing image is pulled .*a missing network is WORCA_WORKER_NETWORK/, "the Engine's own words: a 404 is also a network that is gone");
  } finally { await d2.close(); }
});

test('an unreachable engine or an uninspectable self are refused with a hint', async () => {
  await assert.rejects(createDockerBackend({ uid: 1000, gid: 1000, env: { WORCA_DOCKER_HOST: 'unix:///nonexistent/docker.sock' } }), /cannot reach the Docker Engine .* Mount the socket or set WORCA_DOCKER_HOST/);
  const d = await fakeDocker();
  try {
    await assert.rejects(createDockerBackend({ uid: 1000, gid: 1000, env: env(d.socketPath, { WORCA_CONTROLLER_CONTAINER: 'ghost' }) }), /cannot inspect the controller's own container "ghost"/);
  } finally { await d.close(); }
});

test('the worker seeds a Claude login from the read-only seed dir once, never sessions', () => {
  const root = mkdtempSync(join(tmpdir(), 'worca-seed-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  const seed = join(root, 'seed'); const home = join(root, 'home');
  mkdirSync(join(seed, 'projects'), { recursive: true }); mkdirSync(home, { recursive: true });
  writeFileSync(join(seed, '.credentials.json'), '{"tok":1}'); writeFileSync(join(seed, 'settings.json'), '{}'); writeFileSync(join(seed, 'projects', 'x.jsonl'), '');
  assert.deepEqual(seedClaudeLogin(home, seed), ['.credentials.json', 'settings.json']);
  assert.equal(readFileSync(join(home, '.claude', '.credentials.json'), 'utf8'), '{"tok":1}');
  assert.equal(existsSync(join(home, '.claude', 'projects')), false);
  assert.deepEqual(seedClaudeLogin(home, seed), [], 'already there: nothing copied again');
  assert.deepEqual(seedClaudeLogin(home, ''), []);
});

test('createDockerApi talks to the engine over the socket', async () => {
  const d = await fakeDocker();
  try {
    const api = createDockerApi(dockerEndpoint({ WORCA_DOCKER_HOST: `unix://${d.socketPath}` }));
    assert.equal((await api.version()).Version, '27.0.0');
    await assert.rejects(api.inspect('ghost'), /404/);
  } finally { await d.close(); }
});

test("the engine's own socket never reaches a worker, whatever it is called", () => {
  const mounts = [
    { Type: 'bind', Source: '/run/podman/podman.sock', Destination: '/run/podman/podman.sock', RW: true },
    { Type: 'bind', Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock', RW: true },
    { Type: 'volume', Name: 'worca_home', Source: '/var/lib/docker/volumes/worca_home/_data', Destination: '/worca', RW: true },
  ];
  assert.deepEqual(workerMountsFrom(mounts).map((m) => m.Target), ['/run/podman/podman.sock', '/worca'], 'by name only the docker socket is known');
  assert.deepEqual(workerMountsFrom(mounts, { enginePath: '/run/podman/podman.sock' }).map((m) => m.Target), ['/worca'], 'the configured engine socket is out too');
});

test("the controller's SSH agent socket and its login volume are told apart by this process's environment, not by fixed paths", () => {
  const mounts = [
    { Type: 'bind', Source: '/run/host-services/ssh-auth.sock', Destination: '/ssh-agent.sock', RW: true },
    { Type: 'bind', Source: '/tmp/agent.sock', Destination: '/keys/agent', RW: true },
    { Type: 'volume', Name: 'worca_claude-config', Source: '/var/lib/docker/volumes/worca_claude-config/_data', Destination: '/root/.claude', RW: true },
    { Type: 'volume', Name: 'worca_home', Source: '/var/lib/docker/volumes/worca_home/_data', Destination: '/worca', RW: true },
  ];
  const out = workerMountsFrom(mounts, { seedClaude: '/root/.claude', sshAgent: '/keys/agent' });
  assert.deepEqual(out.map((m) => [m.Target, m.ReadOnly]), [['/seed/claude', true], ['/worca', false]], 'the agent sockets (by name and by SSH_AUTH_SOCK) stay out; a login at another HOME is still the read-only seed');
});
