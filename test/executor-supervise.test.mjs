// test/executor-supervise.test.mjs — the executor seam in superviseSpawn and spawnScript: a spawn
// inside a run scope under an installed remote executor runs on the scope's worker session (here
// a loopback session in this process), and behaves exactly like a local spawn to its caller.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createLoopbackRegistry, createLoopbackSession } from './helpers/loopback-worker-session.mjs';
import { superviseSpawn, missingOnWorker, tooOldOnWorker, olderThan, versionAtLeast, engineOfSpawn, guardPid } from '../src/core/engines/spawn.mjs';
import { versionAtLeast as familyVersionAtLeast } from '../src/core/engines/gemini-family.mjs';
import { engineOnWorker } from '../src/core/executor/index.mjs';
import { CODEX_CLI } from '../src/core/engines/cli-specs.mjs';
import { installExecutorFromEnv, keepsWorkerHome, reapWorkersAtBoot, askRelayUrl, WORKER_RELAY_PORT, relayAskLine, bindAskRelays } from '../src/core/executor/controller.mjs';
import { composeSpawnEnv, scrubKeepList, ENV_KEEP_VAR } from '../src/core/engines/spawn.mjs';
import { scriptBaseEnv, envForShell } from '../src/core/graph/script-runner.mjs';
import { releaseWorker, workerHomeDir, spawnHomeDir, helperEngineHere, discardDir, sweepWorkerHomes } from '../src/core/executor/index.mjs';
import { createBackend } from '../src/core/executor/backends/index.mjs';
import { createWorkerRegistry } from '../src/core/executor/registry.mjs';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { scriptSpawnError } from '../src/core/graph/script-runner.mjs';
import { overlayEnv, workerInstanceOf, workerImageGlob } from '../src/cli/container.mjs';
import { FULL_VARIANT_ENGINES, fullVariantEngines } from '../src/core/executor/shared.mjs';
import { spawnScript } from '../src/core/graph/script-runner.mjs';
import { installExecutor, isRemoteExecutor, stagingBase, executorKind, executorConfigError, spawnsRemotely, sweepStaged } from '../src/core/executor/index.mjs';
import { hostOfUrl, isLoopbackUrl, passThroughEnv, defaultWorkerEngine, startFailure, WORKER_PASS_THROUGH } from '../src/core/executor/shared.mjs';
import { workerEnvFor as dockerWorkerEnv } from '../src/core/executor/backends/docker.mjs';
import { workerEnvFor as k8sWorkerEnv } from '../src/core/executor/backends/kubernetes.mjs';
import { mkdirSync, utimesSync, readdirSync } from 'node:fs';
import { withExecutorScope, currentExecutorScope, scopeKey, parseScopeKey, normalizeScope } from '../src/core/executor/scope.mjs';
import { isValidScope } from '../src/core/executor/protocol.mjs';
import { withheldNames } from '../src/core/executor/remote-child.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after);
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-exec-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
afterEach(() => installExecutor(null));

function script(body) {
  const d = tmp();
  const f = join(d, 'bin.sh');
  writeFileSync(f, `#!/bin/sh\n${body}\n`);
  chmodSync(f, 0o755);
  return f;
}
const base = (over = {}) => ({
  displayBin: 'fake', cwd: tmpdir(), env: undefined, stdin: null, signal: undefined, asAgent: false,
  stagedDir: null, cleanup: () => {}, onEvent: () => {}, onStdoutLine: () => {},
  stdoutErrorDetail: () => '', classify: () => null,
  spawnError: (err, prefix) => Object.assign(new Error(`${prefix}: ${err.message}`), err.code ? { code: err.code } : {}),
  onDone: (code) => ({ code }), ...over,
});
const RUN = { kind: 'run', id: 'r-1' };
const remote = (registry, fn) => { installExecutor({ kind: 'docker', registry }); return withExecutorScope(RUN, fn); };

test('an engine binary the worker image lacks is refused before the exec, naming the image to fix', POSIX, async () => {
  const caps = { engines: { claude: { bin: '/usr/local/bin/claude', version: 'x' }, codex: null, gemini: null } };
  // What the worker reports is the whole truth: absent engine → a message with the fix; present → nothing to say.
  assert.equal(missingOnWorker({ workerId: 'w-1', capabilities: caps }, '/opt/claude'), null);
  assert.match(missingOnWorker({ workerId: 'w-1', capabilities: caps }, 'codex'), /worker w-1 has no codex: the codex engine is not in its image \(it has claude\)\. Point the codex worker image .*WORCA_WORKER_IMAGE .*worker\.engines\.codex\.image/);
  assert.match(missingOnWorker({ workerId: 'w-1', capabilities: caps }, 'C:\\tools\\gemini.cmd'), /has no gemini/);
  assert.equal(missingOnWorker({ workerId: 'w-1', capabilities: caps }, '/bin/sh'), null, 'not an engine binary: the worker decides');
  assert.equal(missingOnWorker({ workerId: 'w-1', capabilities: null }, 'codex'), null, 'no capabilities reported: nothing to judge');
  assert.equal(missingOnWorker(null, 'codex'), null);
  // Through the seam: the spawn fails at once, cleanup runs, nothing reaches the worker.
  const session = createLoopbackSession({ workerId: 'w-caps', capabilities: caps });
  const registry = createLoopbackRegistry({ session });
  let cleaned = 0;
  await assert.rejects(
    () => remote(registry, () => superviseSpawn(base({ file: 'codex', args: ['--version'], displayBin: 'codex', cleanup: () => { cleaned++; } }))),
    (err) => { assert.match(err.message, /Failed to spawn codex: worker w-caps has no codex/); assert.equal(err.code, 'EWORKERNOBIN'); return true; });
  assert.equal(cleaned, 1);
  assert.equal(session.specs.length, 0, 'no exec was sent');
  // The binary the image has runs as before.
  const sh = script('echo from-worker');
  const lines = [];
  const r = await remote(registry, () => superviseSpawn(base({ file: sh, args: [], displayBin: 'sh', onStdoutLine: (l) => lines.push(l) })));
  assert.deepEqual([r.code, lines], [0, ['from-worker']]);
});

test("a spawn names its engine to the registry; a worker that cannot start keeps its recovery class; a stop stays an abort", POSIX, async () => {
  assert.equal(engineOfSpawn({ cli: CODEX_CLI, file: '/opt/anything' }), 'codex', "the adapter's CLI spec names the engine");
  assert.equal(engineOfSpawn({ file: '/usr/local/bin/cursor-agent' }), 'cursor', 'else the binary name does');
  assert.equal(engineOfSpawn({ file: '/bin/sh' }), null, 'a script is no engine');
  assert.equal(guardPid(), process.pid, 'a local spawn: the host guard names this server');
  assert.equal(await remote(createLoopbackRegistry(), () => guardPid()), null, 'a spawn on a worker: no pid of this container');
  const sh = script('echo hi');
  const registry = createLoopbackRegistry();
  await remote(registry, () => superviseSpawn(base({ file: sh, args: [], cli: CODEX_CLI })));
  await withExecutorScope({ ...RUN, engine: 'gemini' }, () => superviseSpawn(base({ file: sh, args: [] })));
  assert.deepEqual(registry.asked, [{ engine: 'codex' }, { engine: 'gemini' }], "the spawn's own engine, else the scope's");
  // Six of the seven adapters build a fresh Error in spawnError: the class and code of what it wraps must survive it.
  const dropping = (err, prefix) => new Error(`${prefix}: ${err.message}`);
  const failing = createLoopbackRegistry({ fail: Object.assign(new Error('cannot start a worker for run:r-1: no image'), { code: 'EWORKERSTART', errorClass: 'network' }) });
  await assert.rejects(() => remote(failing, () => superviseSpawn(base({ file: sh, args: [], spawnError: dropping }))), (e) => {
    assert.match(e.message, /Failed to start a worker for fake: cannot start a worker/);
    assert.equal(e.errorClass, 'network', 'retried or paused by the failure policy, not failed hard');
    assert.equal(e.code, 'EWORKERSTART');
    return true;
  });
  const caps = { engines: { claude: { bin: '/usr/local/bin/claude', version: 'x' }, codex: null } };
  const lacking = createLoopbackRegistry({ session: createLoopbackSession({ workerId: 'w-c', capabilities: caps }) });
  await assert.rejects(() => remote(lacking, () => superviseSpawn(base({ file: 'codex', args: [], displayBin: 'codex', spawnError: dropping }))), (e) => {
    assert.equal(e.errorClass, 'auth', 'a missing engine is something the person fixes: paused with the fix named');
    assert.equal(e.code, 'EWORKERNOBIN');
    return true;
  });
  // Stopped while the worker was starting: the registry's AbortError passes through unwrapped, cleanup still runs.
  const stopped = createLoopbackRegistry({ fail: Object.assign(new Error('aborted'), { name: 'AbortError' }) });
  let cleaned = 0;
  await assert.rejects(() => remote(stopped, () => superviseSpawn(base({ file: sh, args: [], spawnError: dropping, cleanup: () => { cleaned++; } }))), { name: 'AbortError', message: 'aborted' });
  assert.equal(cleaned, 1);
  await assert.rejects(() => remote(stopped, () => spawnScript({ file: sh, args: [], cwd: tmpdir(), env: process.env, timeoutMs: 5000, onLine: () => {} })), { name: 'AbortError' });
});

test('a container executor without WORCA_CONTROLLER_URL refuses to install: workers cannot dial the controller on loopback', async () => {
  const saved = Object.fromEntries(['WORCA_EXECUTOR', 'WORCA_CONTROLLER_URL', 'WORCA_EXECUTOR_BACKEND'].map((k) => [k, process.env[k]]));
  process.env.WORCA_EXECUTOR = 'kubernetes';
  delete process.env.WORCA_CONTROLLER_URL; delete process.env.WORCA_EXECUTOR_BACKEND;
  try {
    await assert.rejects(() => installExecutorFromEnv({ log: () => {} }), /WORCA_CONTROLLER_URL is not set: with WORCA_EXECUTOR=kubernetes .* ws:\/\/worca:4319/);
    assert.equal(isRemoteExecutor(), false, 'nothing was installed');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('what a worker container inherits is one rule for every backend', async () => {
  assert.equal(hostOfUrl('http://proxy.corp:3128'), 'proxy.corp');
  assert.equal(hostOfUrl('proxy.corp:3128'), 'proxy.corp', 'a proxy written without a scheme is still read');
  assert.equal(hostOfUrl('http://[::1]:3128'), '::1');
  assert.equal(hostOfUrl(''), null);
  for (const v of ['http://127.0.0.1:3128', 'localhost:3128', 'http://[::1]:8080', 'http://0.0.0.0:1']) assert.equal(isLoopbackUrl(v), true, v);
  for (const v of ['http://egress:3128', 'proxy.corp:3128', '', undefined]) assert.equal(isLoopbackUrl(v), false, String(v));
  const controllerEnv = {
    TZ: 'Europe/Sofia', WORCA_BROKER_URL: 'http://broker:8080', WORCA_MOCK: '1', WORCA_CA_CERT_FILE: '/etc/worca/ca.pem', WORCA_SIGTERM_GRACE_MS: '9000', WORCA_CODEX_BIN: '/opt/codex',
    GIT_AUTHOR_NAME: 'W', GIT_COMMITTER_EMAIL: 'w@x', HTTPS_PROXY: 'proxy.corp:3128', HTTP_PROXY: 'http://127.0.0.1:3128', ALL_PROXY: '::::', NO_PROXY: 'localhost',
    SSL_CERT_FILE: '/tmp/worca-ca.AAAA/bundle.pem', GH_TOKEN: 'ghp', ANTHROPIC_API_KEY: 'sk', WORCA_BROKER_SECRET: 's', PATH: '/bin',
  };
  const inherited = passThroughEnv(controllerEnv, { controllerUrl: 'ws://worca:4319' });
  assert.deepEqual(inherited, {
    TZ: 'Europe/Sofia', WORCA_BROKER_URL: 'http://broker:8080', WORCA_MOCK: '1', WORCA_CA_CERT_FILE: '/etc/worca/ca.pem', WORCA_SIGTERM_GRACE_MS: '9000', WORCA_CODEX_BIN: '/opt/codex',
    GIT_AUTHOR_NAME: 'W', GIT_COMMITTER_EMAIL: 'w@x',
    HTTPS_PROXY: 'proxy.corp:3128',                      // reachable from another container: kept, scheme or not
    NO_PROXY: 'localhost,worca,broker',                  // the controller and the broker are never reached through the proxy
  }, "no credential, no loopback or unreadable proxy, and not the controller's own derived CA bundle path");
  assert.ok(!WORKER_PASS_THROUGH.some((n) => /TOKEN|SECRET|API_KEY/.test(n)));
  // The chat relay port is the controller's setting: workers are handed the same value, so the shim listens where the
  // controller told the chat's MCP child to post.
  assert.equal(passThroughEnv({ WORCA_WORKER_RELAY_PORT: '5318' }).WORCA_WORKER_RELAY_PORT, '5318');
  // Docker and Kubernetes hand a worker the same inherited set; each adds only its assignment and its paths.
  const assignment = { scopeKey: 'run:r1', workerId: 'w1', token: 't', controllerUrl: 'ws://worca:4319', idleMs: null };
  const d = dockerWorkerEnv({ ...assignment, engine: 'claude', env: controllerEnv });
  const k = k8sWorkerEnv({ ...assignment, controllerEnv });
  for (const [name, value] of Object.entries(inherited)) { assert.equal(d[name], value, `docker ${name}`); assert.equal(k[name], value, `kubernetes ${name}`); }
  for (const e of [d, k]) for (const name of ['GH_TOKEN', 'ANTHROPIC_API_KEY', 'WORCA_BROKER_SECRET', 'HTTP_PROXY', 'ALL_PROXY', 'SSL_CERT_FILE']) assert.equal(e[name], undefined, name);
  assert.equal(await defaultWorkerEngine({ WORCA_WORKER_ENGINE: ' codex ' }), 'codex');
  assert.equal(await defaultWorkerEngine({ WORCA_K8S_DEFAULT_ENGINE: 'gemini', WORCA_WORKER_ENGINE: 'codex' }, ['WORCA_K8S_DEFAULT_ENGINE', 'WORCA_WORKER_ENGINE']), 'gemini');
  assert.deepEqual([startFailure('x').code, startFailure('x').errorClass], ['EWORKERSTART', 'network']);
});

test("a run's worker HOME outlives a crash when a resume can still continue it", () => {
  assert.equal(keepsWorkerHome({ status: 'paused', resume_point: '{}' }), true);
  assert.equal(keepsWorkerHome({ status: 'pausing' }), true);
  assert.equal(keepsWorkerHome({ status: 'running' }), true);
  // Boot maintenance has already relabelled a crashed `running` run `interrupted` when the sweep asks.
  assert.equal(keepsWorkerHome({ status: 'interrupted', resume_point: '{"node":"n2"}' }), true, 'auto-resume will `--resume` its sessions');
  assert.equal(keepsWorkerHome({ status: 'interrupted', resume_point: null }), false, 'nothing can continue it');
  for (const status of ['done', 'stopped', 'error']) assert.equal(keepsWorkerHome({ status, resume_point: null }), false, status);
  assert.equal(keepsWorkerHome(null), false, 'no such run any more');
});

test("a chat's worker HOME goes with its thread, whichever way the thread went", async () => {
  // A thread deleted while no remote executor is installed (a server that ran without workers for a while).
  const gone = { kind: 'chat', id: 'deleted-locally' };
  mkdirSync(workerHomeDir(gone), { recursive: true });
  assert.equal(isRemoteExecutor(), false);
  assert.equal(await releaseWorker(gone, { reason: 'thread deleted' }), false);
  assert.equal(existsSync(workerHomeDir(gone)), false, 'removed even with workers off');
  // Boot: the HOME of a thread that no longer exists is swept; a live thread's and one whose lookup fails stay.
  const saved = Object.fromEntries(['WORCA_EXECUTOR', 'WORCA_EXECUTOR_BACKEND', 'WORCA_CONTROLLER_URL'].map((k) => [k, process.env[k]]));
  process.env.WORCA_EXECUTOR = 'docker'; process.env.WORCA_EXECUTOR_BACKEND = 'in-process';
  const { registry } = await installExecutorFromEnv({ log: () => {}, host: '127.0.0.1', port: 0 });
  try {
    for (const id of ['alive', 'orphan', 'unknown']) mkdirSync(workerHomeDir({ kind: 'chat', id }), { recursive: true });
    const threadOf = (id) => { if (id === 'unknown') throw new Error('db busy'); return id === 'alive' ? { id } : null; };
    await reapWorkersAtBoot({ rowOf: () => null, threadOf, log: () => {}, error: () => {} });
    assert.deepEqual(['alive', 'orphan', 'unknown'].map((id) => existsSync(workerHomeDir({ kind: 'chat', id }))), [true, false, true], 'never deleted on doubt');
    // Workers inside this process run no relay shim: a chat's MCP child posts to this server's own route.
    assert.notEqual(WORKER_RELAY_PORT, 4999);
    assert.equal(askRelayUrl(4999), 'http://127.0.0.1:4999/api/ask/relay');
  } finally {
    await registry.closeAll('test over'); installExecutor(null);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("a script's failed spawn keeps a worker's reason: an abort stays an abort, a lost worker stays retryable", () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  assert.equal(scriptSpawnError('lint', abort), abort, 'stopped while the worker was starting');
  const lost = scriptSpawnError('lint', Object.assign(new Error('cannot start a worker for run:r: no image'), { code: 'EWORKERSTART', errorClass: 'network' }));
  assert.match(lost.message, /script "lint": spawn failed — cannot start a worker/);
  assert.deepEqual([lost.errorClass, lost.code], ['network', 'EWORKERSTART'], 'retried like an agent step');
  const local = scriptSpawnError('lint', Object.assign(new Error('spawn sh ENOENT'), { code: 'ENOENT' }));
  assert.deepEqual([local.errorClass, local.code], [null, 'ENOENT'], 'a local spawn failure is still not recoverable');
});

test('`container down` names the installation the way the backend labelled its workers', () => {
  const dot = (vars) => (name) => vars[name] || null;
  assert.equal(workerInstanceOf({ dotEnv: dot({}), env: {} }), 'worca', "compose.yml's project name");
  assert.equal(workerInstanceOf({ dotEnv: dot({ COMPOSE_PROJECT_NAME: 'b' }), env: {} }), 'b', 'a project named in .env: Compose reads it there, so the backend labels with it');
  assert.equal(workerInstanceOf({ dotEnv: dot({ COMPOSE_PROJECT_NAME: 'b' }), env: { COMPOSE_PROJECT_NAME: 'shell' } }), 'shell', 'the process environment wins over .env, as in Compose');
  assert.equal(workerInstanceOf({ dotEnv: dot({ WORCA_INSTANCE_ID: 'team-a', COMPOSE_PROJECT_NAME: 'b' }), env: {} }), 'team-a', 'an explicit instance id wins (the overlay hands it to the controller)');
  assert.equal(workerInstanceOf({ dotEnv: dot({ WORCA_INSTANCE_ID: 'from-file' }), env: { WORCA_INSTANCE_ID: 'from-shell' } }), 'from-shell', 'the shell wins over .env for the instance id too: Compose hands the controller that one');
  assert.deepEqual(fullVariantEngines({}), [...FULL_VARIANT_ENGINES]);
  assert.deepEqual(fullVariantEngines({ WORCA_WORKER_FULL_ENGINES: 'claude, codex' }), ['claude', 'codex']);
});

test('`container pull` knows which worker images go with this stack', () => {
  const dot = (vars) => (name) => vars[name] || null;
  assert.equal(workerImageGlob({ dotEnv: dot({}), env: {} }), 'ghcr.io/sinishadjukic/worca-worker:latest-*');
  assert.equal(workerImageGlob({ dotEnv: dot({ WORCA_TAG: '1.3.0', WORCA_IMAGE: 'mirror.corp/worca' }), env: {} }), 'mirror.corp/worca-worker:1.3.0-*');
  assert.equal(workerImageGlob({ dotEnv: dot({ WORCA_TAG: '1.3.0-full' }), env: {} }), 'ghcr.io/sinishadjukic/worca-worker:1.3.0-*', 'a -full tag: the engine comes before the variant');
  assert.equal(workerImageGlob({ dotEnv: dot({ WORCA_WORKER_IMAGE: 'reg/w:9-{engine}' }), env: { WORCA_TAG: 'x' } }), 'reg/w:9-*');
  assert.equal(workerImageGlob({ dotEnv: dot({ WORCA_WORKER_IMAGE: 'self' }), env: {} }), null, 'workers run from the controller image: nothing more to pull');
  assert.equal(workerImageGlob({ dotEnv: dot({ WORCA_TAG: 'a' }), env: { WORCA_TAG: 'b' } }), 'ghcr.io/sinishadjukic/worca-worker:b-*', 'the process environment wins over .env');
});

test('egress and workers together put the controller on the internal network, not the open one', () => {
  assert.deepEqual(overlayEnv(['egress', 'workers']), { WORCA_UPLINK_NETWORK: 'internal' });
  assert.deepEqual(overlayEnv(['workers']), {});
  assert.deepEqual(overlayEnv(['egress']), {});
  assert.deepEqual(overlayEnv(['egress', 'workers'], { already: 'internal' }), {}, 'already right: nothing to set');
  assert.deepEqual(overlayEnv(['egress', 'workers'], { already: 'default' }), { WORCA_UPLINK_NETWORK: 'internal' }, 'any other persisted value would leave the controller on the open network');
  assert.deepEqual(overlayEnv(['egress', 'broker']), { WORCA_UPLINK_NETWORK: 'internal' }, 'the broker overlay names the uplink network too');
});

test('staged spawn folders older than this process are swept at boot; the ones a live spawn made are kept', () => {
  const stage = join(worcaHome(), 'tmp', 'stage');
  const old = join(stage, 'worca-claude-old1');
  const live = join(stage, 'worca-claude-live');
  mkdirSync(old, { recursive: true }); mkdirSync(live, { recursive: true });
  writeFileSync(join(old, 'prompt.txt'), 'left by a controller that crashed');
  const past = new Date(Date.now() - 3600_000);
  utimesSync(old, past, past);
  assert.equal(sweepStaged({ before: Date.now() - 60_000 }), 1);
  assert.deepEqual(readdirSync(stage), ['worca-claude-live']);
  assert.equal(sweepStaged({ before: Date.now() - 60_000 }), 0);
  assert.equal(sweepStaged({ home: join(worcaHome(), 'nowhere') }), 0, 'no staging folder at all: nothing to do');
  rmSync(stage, { recursive: true, force: true });   // other tests here assert that nothing is staged under this home
});

test('scope helpers: normalization, keys, and the async context', async () => {
  assert.equal(currentExecutorScope(), null);
  assert.equal(scopeKey({ kind: 'chat', id: ' t1 ' }), 'chat:t1');
  assert.equal(scopeKey({ kind: 'job', id: 'x' }), null);
  assert.deepEqual(parseScopeKey('run:abc:def'), { kind: 'run', id: 'abc:def' });
  assert.equal(scopeKey({ kind: 'run', id: 'r', engine: 'codex' }), 'run:r', "the scope's engine is a hint, not part of its identity");
  assert.deepEqual(await withExecutorScope({ kind: 'run', id: 'r', engine: ' codex ' }, () => currentExecutorScope()), { kind: 'run', id: 'r', engine: 'codex' });
  assert.equal(parseScopeKey('nope'), null);
  await withExecutorScope(RUN, async () => {
    await new Promise((r) => setTimeout(r, 1));
    assert.deepEqual(currentExecutorScope(), RUN);
  });
  assert.equal(await withExecutorScope({ kind: 'bogus' }, () => currentExecutorScope()), null, 'an unusable scope leaves the context unset');
});

test('executor kind: unset or unknown is local; the config error names a bad value', () => {
  assert.equal(executorKind({}), 'local');
  assert.equal(executorKind({ WORCA_EXECUTOR: 'Docker' }), 'docker');
  assert.equal(executorKind({ WORCA_EXECUTOR: 'swarm' }), 'local');
  assert.equal(executorConfigError({}), null);
  assert.match(executorConfigError({ WORCA_EXECUTOR: 'swarm' }), /WORCA_EXECUTOR=swarm is not one of local, docker, kubernetes/);
  assert.equal(isRemoteExecutor(), false);
  installExecutor({ kind: 'local', registry: {} });
  assert.equal(isRemoteExecutor(), false, 'installing local is a no-op');
});

test('stagingBase is the OS tmpdir locally and under worca home with a remote executor', () => {
  assert.equal(stagingBase(), tmpdir());
  installExecutor({ kind: 'kubernetes', registry: {} });
  assert.equal(stagingBase(), join(worcaHome(), 'tmp', 'stage'));
});

test('without a scope a spawn stays local even under a remote executor; the registry is never asked', POSIX, async () => {
  const registry = createLoopbackRegistry();
  installExecutor({ kind: 'docker', registry });
  assert.equal(spawnsRemotely(), false);
  const seen = [];
  const r = await superviseSpawn(base({ file: script('echo local'), args: [], onStdoutLine: (l) => seen.push(l) }));
  assert.deepEqual(r, { code: 0 });
  assert.deepEqual(seen, ['local']);
  assert.deepEqual(registry.acquired, []);
  assert.equal(registry.session.specs.length, 0);
});

test('inside a run scope the spawn runs on the worker session: lines, stderr events, exit code, cleanup once', POSIX, async () => {
  const registry = createLoopbackRegistry();
  const seen = []; const events = []; let cleaned = 0;
  const file = script('echo one; echo two; echo warn 1>&2; read x; echo "got $x"');
  const r = await remote(registry, () => superviseSpawn(base({
    file, args: ['a1'], stdin: 'from-stdin', env: { PATH: process.env.PATH, MARK: 'm' },
    cleanup: () => { cleaned += 1; }, onStdoutLine: (l) => seen.push(l), onEvent: (e) => events.push(e),
  })));
  assert.deepEqual(r, { code: 0 });
  assert.deepEqual(seen, ['one', 'two', 'got from-stdin']);
  assert.deepEqual(events, [{ type: 'stderr', stream: 'err', text: 'warn' }]);
  assert.equal(cleaned, 1);
  assert.deepEqual(registry.acquired, [RUN]);
  const [spec] = registry.session.specs;
  assert.equal(spec.file, file);
  assert.deepEqual(spec.args, ['a1']);
  assert.equal(spec.stdin, 'from-stdin');
  assert.equal(spec.env.MARK, 'm', 'the composed env rides the exec as given');
  assert.equal(spec.detached, true);
});

test('with no env the worker gets this process\'s environment explicitly (a remote exec never inherits)', POSIX, async () => {
  const registry = createLoopbackRegistry();
  process.env.WORCA_TEST_INHERIT_MARK = 'yes';
  try {
    const seen = [];
    await remote(registry, () => superviseSpawn(base({ file: script('echo "$WORCA_TEST_INHERIT_MARK"'), args: [], onStdoutLine: (l) => seen.push(l) })));
    assert.deepEqual(seen, ['yes']);
    assert.equal(registry.session.specs[0].env.WORCA_TEST_INHERIT_MARK, 'yes');
  } finally { delete process.env.WORCA_TEST_INHERIT_MARK; }
});

test('non-zero exit keeps the stderr detail and class; a fatal stdout line terminates through the session (SIGTERM, then SIGKILL)', POSIX, async () => {
  const registry = createLoopbackRegistry();
  const err1 = await remote(registry, () => superviseSpawn(base({ file: script('echo "429 slow down" 1>&2; exit 2'), args: [], classify: (m) => (/429/.test(m) ? 'rate_limit' : null) })))
    .then(() => null, (e) => e);
  assert.match(err1.message, /^fake exited with code 2: 429 slow down/);
  assert.equal(err1.errorClass, 'rate_limit');
  assert.equal(err1.stream, 'err');

  const expected = Object.assign(new Error('terminal stream event'), { errorClass: 'usage_limit' });
  const prev = process.env.WORCA_SIGKILL_GRACE_MS;
  process.env.WORCA_SIGKILL_GRACE_MS = '50';
  try {
    const started = Date.now();
    const err2 = await remote(registry, () => superviseSpawn(base({
      file: script("trap '' TERM; echo fatal; exec sleep 30"), args: [],
      onStdoutLine: (line) => (line === 'fatal' ? expected : undefined),
    }))).then(() => null, (e) => e);
    assert.equal(err2, expected);
    assert.ok(Date.now() - started < 5000, 'does not wait for the lingering child');
    const sigs = registry.session.signals.map(([, s]) => s);
    assert.deepEqual(sigs.slice(-2), ['SIGTERM', 'SIGKILL'], `escalation relayed through the session: ${sigs}`);
  } finally {
    if (prev === undefined) delete process.env.WORCA_SIGKILL_GRACE_MS; else process.env.WORCA_SIGKILL_GRACE_MS = prev;
  }
});

test('abort rejects with AbortError, signalled through the session, and runs cleanup once', POSIX, async () => {
  const registry = createLoopbackRegistry();
  const ac = new AbortController(); let cleaned = 0;
  const p = remote(registry, () => superviseSpawn(base({ file: script('echo started; sleep 30'), args: [], signal: ac.signal, cleanup: () => { cleaned += 1; }, onStdoutLine: (l) => { if (l === 'started') ac.abort(); } })));
  const err = await p.then(() => null, (e) => e);
  assert.equal(err.name, 'AbortError');
  assert.equal(cleaned, 1);
  assert.ok(registry.session.signals.some(([, s]) => s === 'SIGTERM'));
});

test('a worker that vanishes mid-run rejects with a network-class error naming the worker', POSIX, async () => {
  const session = createLoopbackSession({ workerId: 'w-gone' });
  const registry = createLoopbackRegistry({ session });
  const p = remote(registry, () => superviseSpawn(base({ file: script('echo up; sleep 30'), args: [], onStdoutLine: (l) => { if (l === 'up') setTimeout(() => session.lose('container exited'), 5); } })));
  const err = await p.then(() => null, (e) => e);
  assert.match(err.message, /fake error: worker w-gone lost: container exited/);
  assert.equal(err.errorClass, 'network');
  assert.equal(err.code, 'EWORKERLOST');
});

test('a registry that cannot provide a worker rejects before anything spawns, with cleanup', POSIX, async () => {
  const registry = createLoopbackRegistry({ fail: new Error('no worker image') });
  let cleaned = 0;
  const err = await remote(registry, () => superviseSpawn(base({ file: script('echo never'), args: [], cleanup: () => { cleaned += 1; } }))).then(() => null, (e) => e);
  assert.match(err.message, /Failed to start a worker for fake: no worker image/);
  assert.equal(cleaned, 1);
  assert.equal(registry.session.specs.length, 0);
});

test('asAgent is ignored on a worker: no sudo wrapper, the file itself is the exec', POSIX, async () => {
  const registry = createLoopbackRegistry();
  const file = script('echo as-me');
  const seen = [];
  await remote(registry, () => superviseSpawn(base({ file, args: [], asAgent: true, onStdoutLine: (l) => seen.push(l) })));
  assert.deepEqual(seen, ['as-me']);
  assert.equal(registry.session.specs[0].file, file);
});

test('spawnScript runs a script node on the worker session with capture, exit code and abort', POSIX, async () => {
  const registry = createLoopbackRegistry();
  const lines = [];
  const r = await remote(registry, () => spawnScript({ file: 'sh', args: ['-c', 'echo a; echo b 1>&2; exit 4'], cwd: tmpdir(), env: { PATH: process.env.PATH }, timeoutMs: 10_000, onLine: (l) => lines.push(l), stdoutMode: 'capture' }));
  assert.equal(r.exitCode, 4);
  assert.ok(lines.includes('a') && lines.includes('b'));
  assert.match(r.capture, /a/);
  assert.equal(registry.session.specs[0].file, 'sh');

  const ac = new AbortController();
  const p = remote(registry, () => spawnScript({ file: 'sh', args: ['-c', 'echo go; sleep 30'], cwd: tmpdir(), env: { PATH: process.env.PATH }, timeoutMs: 10_000, signal: ac.signal, onLine: (l) => { if (l === 'go') ac.abort(); }, stdoutMode: 'capture' }));
  const r2 = await p;
  assert.equal(r2.aborted, true);
  assert.ok(registry.session.signals.some(([, s]) => s === 'SIGKILL'), 'killTree relayed SIGKILL through the session');
});

test('spawnScript without a scope is unchanged (local child, registry untouched)', POSIX, async () => {
  const registry = createLoopbackRegistry();
  installExecutor({ kind: 'docker', registry });
  const r = await spawnScript({ file: 'sh', args: ['-c', 'echo local'], cwd: tmpdir(), env: { PATH: process.env.PATH }, timeoutMs: 10_000, onLine: () => {}, stdoutMode: 'capture' });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(registry.acquired, []);
  assert.equal(existsSync(join(worcaHome(), 'tmp', 'stage')), false, 'nothing staged under the home');
});

test("a chat's engine on a worker is held to the version its lockdown needs", POSIX, async () => {
  assert.equal(olderThan('codex-cli 0.150.2', '0.162'), true);
  assert.equal(olderThan('codex-cli 0.162.0', '0.162'), false);
  assert.equal(olderThan('1.20.0 (opencode)', '1.19.4'), false);
  assert.equal(olderThan('1.19.3', '1.19.4'), true);
  assert.equal(olderThan('2.0.0', '1.19.4'), false);
  assert.equal(olderThan(null, '1.0.0'), false, 'a version that could not be read is not judged');
  assert.equal(familyVersionAtLeast, versionAtLeast, 'the worker floor and the controller gate use the one compare');
  assert.equal(olderThan('dev build', '1.0.0'), true, 'no digits reads as 0.0.0, as the controller\'s own gate reads it (versionAtLeast)');
  const caps = { engines: { codex: { bin: '/usr/local/bin/codex', version: 'codex-cli 0.150.2' }, claude: { bin: '/usr/local/bin/claude', version: null } } };
  const s = { workerId: 'w-old', capabilities: caps };
  assert.match(tooOldOnWorker(s, 'codex', '0.162'), /worker w-old has codex codex-cli 0\.150\.2: a chat needs 0\.162 or newer\. Point the codex worker image at a newer one: WORCA_WORKER_IMAGE \(Compose\) or worker\.engines\.codex\.image \(Helm\)/);
  assert.equal(tooOldOnWorker(s, 'codex', '0.150'), null);
  assert.equal(tooOldOnWorker(s, 'codex', null), null, 'a run step names no floor');
  assert.equal(tooOldOnWorker(s, 'claude', '9.0.0'), null, 'unknown version');
  assert.equal(tooOldOnWorker({ workerId: 'w', capabilities: null }, 'codex', '0.162'), null);
  // A ceiling too: a major the controller's own gate refuses (its lockdown is unverified there).
  const oc = { workerId: 'w-oc', capabilities: { engines: { opencode: { bin: '/usr/local/bin/opencode', version: '2.1.0' } } } };
  assert.match(tooOldOnWorker(oc, 'opencode', '1.19.4', 'a chat', { below: '2.0.0' }), /has opencode 2\.1\.0: a chat is verified below 2\.0\.0 only\. Point the opencode worker image at one before 2\.0\.0/);
  oc.capabilities.engines.opencode.version = '1.20.0';
  assert.equal(tooOldOnWorker(oc, 'opencode', '1.19.4', 'a chat', { below: '2.0.0' }), null);
  // Through the seam: refused before any exec, as a setup problem (the run or turn pauses with the reason).
  const session = createLoopbackSession({ workerId: 'w-old', capabilities: caps });
  const registry = createLoopbackRegistry({ session });
  let cleaned = 0;
  await assert.rejects(
    () => remote(registry, () => superviseSpawn(base({ file: 'codex', args: ['exec'], displayBin: 'codex', workerMinVersion: '0.162', cleanup: () => { cleaned++; } }))),
    (err) => { assert.match(err.message, /Failed to spawn codex: worker w-old has codex codex-cli 0\.150\.2/); assert.deepEqual([err.code, err.errorClass], ['EWORKEROLDBIN', 'auth']); return true; });
  assert.deepEqual([cleaned, session.specs.length], [1, 0]);
  // Every engine that can run a chat hands its floor to the seam (the controller's own check is skipped under workers).
  const src = (f) => readFileSync(new URL(`../src/core/engines/${f}.mjs`, import.meta.url), 'utf8');
  for (const [f, re] of [['codex', /askLockdown \? \{ workerMinVersion: CODEX_ASK_MIN_VERSION \}/], ['copilot', /askLockdown \? \{ workerMinVersion: COPILOT_ASK_MIN_VERSION \}/],
    ['goose', /ask \? \{ workerMinVersion: GOOSE_ASK_MIN_VERSION \}/], ['opencode', /ask \? \{ workerMinVersion: OPENCODE_ASK_MIN_VERSION, workerBelowVersion: '2\.0\.0' \}/],
    ['gemini-family', /ask && spec\.askMinVersion \? \{ workerMinVersion: spec\.askMinVersion \}/], ['gemini', /askMinVersion: GEMINI_ASK_MIN_VERSION/], ['qwen', /askMinVersion: QWEN_ASK_MIN_VERSION/]]) {
    assert.match(src(f), re, f);
  }
});

test("a spawn's HOME is its worker's when it runs on one; the in-process backend reports this machine's engines", async () => {
  assert.equal(spawnHomeDir(), homedir(), 'no executor: this process');
  const session = createLoopbackSession({ workerId: 'w-home' });
  installExecutor({ kind: 'docker', registry: createLoopbackRegistry({ session }) });
  try {
    assert.equal(spawnHomeDir(), homedir(), 'no scope: the spawn stays here');
    const scope = { kind: 'run', id: 'r-home' };
    assert.equal(withExecutorScope(scope, () => spawnHomeDir()), workerHomeDir(scope), "codex's sessions are read where the worker's codex wrote them");
  } finally { installExecutor(null); }
  // WORCA_EXECUTOR_BACKEND=in-process is a real mode ("try the path on one machine"): its worker must say which
  // engines are here, or every engine spawn would be refused as missing from the image.
  const backend = await createBackend('docker', { env: { WORCA_EXECUTOR_BACKEND: 'in-process' }, homeRoot: worcaHome() });
  const reg = createWorkerRegistry({ backend, host: '127.0.0.1', port: 0, log: () => {} });
  await reg.listen();
  try {
    const s = await reg.acquire({ kind: 'run', id: 'r-probe' });
    assert.ok(Object.keys(s.capabilities.engines).includes('claude'), 'every engine worca knows was looked for');
  } finally { await reg.closeAll('test over'); }
});

test("a chat's relayed tool call runs in the chat's scope; a helper job outside any scope runs on the controller's engine", async () => {
  // What a chat tool spawns (a script the chat wrote and benches) must go to the chat's worker, not run beside the database.
  const seen = [];
  const rpc = { async feed(line) { seen.push([line, currentExecutorScope()]); }, async idle() {} };
  const relays = new Map([['tok-scoped', { out: [], billTo: null, owner: null, rpc, scope: { kind: 'chat', id: 'th-9', engine: 'codex' } }], ['tok-bare', { out: [], billTo: null, owner: null, rpc }]]);
  bindAskRelays(relays);
  try {
    assert.deepEqual(await relayAskLine('tok-scoped', '{"id":1}'), { lines: [], error: null });
    assert.deepEqual(await relayAskLine('tok-bare', '{"id":2}'), { lines: [], error: null });
    assert.deepEqual(seen, [['{"id":1}', { kind: 'chat', id: 'th-9', engine: 'codex' }], ['{"id":2}', null]]);
    assert.equal((await relayAskLine('nope', 'x')).error, 'relay: unknown or finished turn');
  } finally { bindAskRelays(new Map()); }
  // A PR description or an overview is asked for from a route, outside any scope: its spawn stays on the controller,
  // whose image has Claude Code only.
  assert.equal(helperEngineHere('codex'), 'codex', 'no worker containers: the run\'s own helper engine');
  installExecutor({ kind: 'docker', registry: createLoopbackRegistry({ session: createLoopbackSession({ workerId: 'w-h' }) }) });
  try {
    assert.equal(helperEngineHere('codex'), 'claude');
    assert.equal(helperEngineHere('claude'), 'claude');
    assert.equal(withExecutorScope({ kind: 'run', id: 'r-h', engine: 'codex' }, () => helperEngineHere('codex')), 'codex', 'inside the run it goes to the run\'s worker');
  } finally { installExecutor(null); }
});

test('a scrubbed spawn bound for a worker carries what its scrub lets through; a child never inherits the database folder', () => {
  assert.equal(scrubKeepList(['MY_TOOL_KEY', 'bad,name', ''], ['CURSOR_']), 'CURSOR_*,MY_TOOL_KEY');
  assert.equal(scrubKeepList(undefined), 'ANTHROPIC_*,CLAUDE_*');
  const opts = { envScrub: true, envAllowlist: ['MY_TOOL_KEY'], prefixes: ['ANTHROPIC_', 'CLAUDE_'] };
  assert.equal(ENV_KEEP_VAR in composeSpawnEnv(opts).env, false, 'a local spawn: nothing added');
  assert.equal(ENV_KEEP_VAR in scriptBaseEnv({ envScrub: true }), false);
  installExecutor({ kind: 'docker', registry: createLoopbackRegistry({ session: createLoopbackSession({ workerId: 'w-s' }) }) });
  try {
    const scope = { kind: 'run', id: 'r-scrub', engine: 'claude' };
    assert.equal(withExecutorScope(scope, () => composeSpawnEnv(opts).env[ENV_KEEP_VAR]), 'ANTHROPIC_*,CLAUDE_*,MY_TOOL_KEY');
    assert.equal(withExecutorScope(scope, () => ENV_KEEP_VAR in composeSpawnEnv({ ...opts, envScrub: false }).env), false, 'no scrub: the worker adds its own credentials as documented');
    assert.equal(withExecutorScope(scope, () => scriptBaseEnv({ envScrub: true, envAllowlist: ['MY_TOOL_KEY'] })[ENV_KEEP_VAR]), 'ANTHROPIC_*,CLAUDE_*,MY_TOOL_KEY');
    assert.equal(ENV_KEEP_VAR in composeSpawnEnv(opts).env, false, 'outside a scope the spawn stays here');
  } finally { installExecutor(null); }
  // The database follows WORCA_DB_DIR before the home: a script that runs worca code must not find the live one.
  const env = envForShell({ inputs: {}, outputs: {} }, { PATH: '/bin', WORCA_HOME: '/h', WORCA_DB_DIR: '/worca-db' });
  assert.deepEqual(['WORCA_HOME', 'WORCA_DB_DIR'].map((k) => k in env), [false, false]);
});

test('a relayed turn answers one line at a time: a slow call and the next line never share the output buffer', async () => {
  let release; const slow = new Promise((r) => { release = r; });
  const rpc = {
    async feed(line) { if (line === 'slow') { await slow; relays.get('tok').out.push('answer:slow'); } else relays.get('tok').out.push(`answer:${line}`); },
    async idle() {},
  };
  const relays = new Map([['tok', { out: [], billTo: null, owner: null, rpc }]]);
  bindAskRelays(relays);
  try {
    const first = relayAskLine('tok', 'slow');          // the shim gave up on this one and the child sent its next line…
    const second = relayAskLine('tok', 'next');         // …while the slow call still runs here
    await new Promise((r) => setTimeout(r, 30));
    release();
    assert.deepEqual(await first, { lines: ['answer:slow'], error: null });
    assert.deepEqual(await second, { lines: ['answer:next'], error: null }, 'the second line waited and got only its own answer');
  } finally { bindAskRelays(new Map()); }
});

test('a worker HOME is discarded without a blocking removal: renamed aside at once, deleted in the background, leftovers finished by the sweep', async () => {
  const root = mkdtempSync(join(tmpdir(), 'worca-discard-'));
  const homes = join(root, 'worker-homes', 'run');
  const dir = join(homes, 'r-gone');
  mkdirSync(join(dir, 'deep'), { recursive: true });
  writeFileSync(join(dir, 'deep', 'f.txt'), 'x');
  discardDir(dir);
  assert.equal(existsSync(dir), false, 'the path is free at once (a replacement worker can start)');
  for (let i = 0; i < 100 && readdirSync(homes).length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(readdirSync(homes), [], 'and the files went in the background');
  // A removal a previous process did not finish is completed by the boot sweep and not counted as a removal.
  mkdirSync(join(homes, 'r-old.discarded-abc', 'x'), { recursive: true });
  mkdirSync(join(homes, 'r-finished'), { recursive: true });
  const removed = sweepWorkerHomes({ keep: () => false, home: root });
  assert.deepEqual(removed, ['run:r-finished']);
  for (let i = 0; i < 100 && readdirSync(homes).length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(readdirSync(homes), []);
  rmSync(root, { recursive: true, force: true });
});

test('one predicate says which engines run on a worker image rather than here', () => {
  assert.deepEqual(['claude', 'codex', 'gemini'].map(engineOnWorker), [false, false, false], 'no worker containers: everything runs here');
  installExecutor({ kind: 'docker', registry: createLoopbackRegistry({ session: createLoopbackSession({ workerId: 'w-p' }) }) });
  try {
    assert.deepEqual(['claude', 'codex', 'gemini'].map(engineOnWorker), [false, true, true], 'Claude Code is in the controller image; every other engine is on its worker');
    const src = (f) => readFileSync(new URL(`../src/core/${f}`, import.meta.url), 'utf8');
    for (const [f, re] of [['engines/readiness.mjs', /engineOnWorker\(e\.name\)/], ['engines/chat-descriptor.mjs', /seams\.onWorker \?\? engineOnWorker\(d\.engine\)/], ['run-harness.mjs', /engineOnWorker\(name\)/]]) assert.match(src(f), re, f);
  } finally { installExecutor(null); }
});

test('an enforced in-process egress policy refuses to boot with workers unless their network is policed elsewhere', async () => {
  const saved = Object.fromEntries(['WORCA_EXECUTOR', 'WORCA_EXECUTOR_BACKEND', 'WORCA_CONTROLLER_URL', 'WORCA_EGRESS_MODE', 'WORCA_EGRESS_WORKERS'].map((k) => [k, process.env[k]]));
  process.env.WORCA_EXECUTOR = 'docker'; process.env.WORCA_CONTROLLER_URL = 'ws://worca:4319'; process.env.WORCA_EGRESS_MODE = 'allow'; delete process.env.WORCA_EXECUTOR_BACKEND; delete process.env.WORCA_EGRESS_WORKERS;
  try {
    await assert.rejects(() => installExecutorFromEnv({ log: () => {} }), /WORCA_EGRESS_MODE=allow is enforced by a proxy inside this process, which workers cannot reach: with WORCA_EXECUTOR=docker the agents would have open network access.*WORCA_EGRESS_WORKERS=external/);
    assert.equal(isRemoteExecutor(), false);
    // Said so: the boot goes on (into the docker backend, which has no Engine here — a different error).
    process.env.WORCA_EGRESS_WORKERS = 'external'; process.env.WORCA_DOCKER_HOST = 'unix:///nonexistent/worca.sock';
    await assert.rejects(() => installExecutorFromEnv({ log: () => {} }), (e) => !/WORCA_EGRESS_MODE/.test(e.message));
  } finally {
    delete process.env.WORCA_DOCKER_HOST;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("a spawn that names no env never ships this process's environment raw to a worker", POSIX, async () => {
  const session = createLoopbackSession({ workerId: 'w-raw' });
  const registry = createLoopbackRegistry({ session });
  const saved = { GH_TOKEN: process.env.GH_TOKEN, WORCA_BROKER_SECRET: process.env.WORCA_BROKER_SECRET };
  process.env.GH_TOKEN = 'ghp_controller'; process.env.WORCA_BROKER_SECRET = 'broker-secret';
  try {
    const sh = script('echo "gh:${GH_TOKEN:-none} broker:${WORCA_BROKER_SECRET:-none} path:${PATH:+set}"');
    const lines = [];
    await remote(registry, () => superviseSpawn(base({ file: sh, args: [], env: undefined, displayBin: 'sh', onStdoutLine: (l) => lines.push(l) })));
    assert.deepEqual(lines, ['gh:none broker:none path:set']);
    const sent = session.specs.at(-1).env;
    assert.equal('GH_TOKEN' in sent, false); assert.equal('WORCA_BROKER_SECRET' in sent, false);
    // A script node without an env either.
    const lines2 = [];
    await remote(registry, () => spawnScript({ file: sh, args: [], cwd: process.cwd(), env: undefined, onLine: (l) => lines2.push(l), stdoutMode: 'lines' }).catch(() => null));
    const sentScript = session.specs.at(-1).env;
    assert.equal('GH_TOKEN' in sentScript, false);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('a python node on a worker without python fails with the python sentence and the image to use, not a bare ENOENT', () => {
  const src = readFileSync(new URL('../src/core/graph/script-runner.mjs', import.meta.url), 'utf8');
  assert.match(src, /spawnsRemotely\(\) && !executorInProcess\(\) && err\?\.code === 'ENOENT' && !\/working directory .\* does not exist on this worker\/\.test\(String\(err\.message\)\)\)/, 'a working directory the worker cannot see is ENOENT too, and the worker names it; in-process workers run this machine\'s python');
  assert.match(src, /spawnsRemotely\(\) && !executorInProcess\(\) \? \{ ok: true, command: pythonCandidates\(\)\[0\]\.command \}/, 'the configured interpreter (WORCA_PYTHON, the pythonPath setting) by the one rule');
});

test('a scope id is one path segment; the scrub keep-list never carries a glob; a nulled variable counts as left out', () => {
  for (const id of ['../../projects', 'a/b', 'a\\b', '.', '..', 'x\0y']) assert.equal(normalizeScope({ kind: 'chat', id }), null, JSON.stringify(id));
  assert.deepEqual(normalizeScope({ kind: 'run', id: 'r.1-2_3' }), { kind: 'run', id: 'r.1-2_3' });
  assert.equal(isValidScope({ kind: 'chat', id: '../x' }), false);
  assert.equal(scrubKeepList(['AWS_*', 'MY_KEY'], ['CURSOR_']), 'CURSOR_*,MY_KEY', "an allowlist glob matches nothing on the controller and must not become a prefix on the worker");
  assert.deepEqual(withheldNames({ PATH: '/bin', GH_TOKEN: null }, { PATH: '/bin', GH_TOKEN: 'ghp' }), ['GH_TOKEN'], 'an adapter unset it: the frame drops it, the worker must not refill it');
});

test("a persisted internal uplink network without the egress overlay is corrected for the start, with a notice", () => {
  assert.deepEqual(overlayEnv(['egress', 'workers']), { WORCA_UPLINK_NETWORK: 'internal' });
  assert.deepEqual(overlayEnv(['egress', 'workers'], { already: 'internal' }), {});
  const fixed = overlayEnv(['workers'], { already: 'internal' });
  assert.equal(fixed.WORCA_UPLINK_NETWORK, 'default');
  assert.match(fixed.notice, /needs the egress overlay/);
  assert.deepEqual(overlayEnv(['workers'], { already: 'default' }), {});
  assert.deepEqual(overlayEnv(['workers']), {});
});
