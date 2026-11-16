// test/cli-worker.test.mjs — `worca worker`: the assignment comes from the environment, and an
// incomplete one is a configuration error (exit 78) that names what is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readWorkerConfig, EX_CONFIG } from '../src/worker/main.mjs';

const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));

test('readWorkerConfig names every missing variable', () => {
  const r = readWorkerConfig({});
  assert.deepEqual(r.errors, [
    'WORCA_CONTROLLER_URL is not set',
    'WORCA_WORKER_SCOPE is not set',
    'WORCA_WORKER_TOKEN (or WORCA_WORKER_TOKEN_FILE) is not set',
    'WORCA_WORKER_ID is not set',
  ]);
  const bad = readWorkerConfig({ WORCA_CONTROLLER_URL: 'http://x', WORCA_WORKER_SCOPE: 'job:1', WORCA_WORKER_TOKEN: 't', WORCA_WORKER_ID: 'w' });
  assert.match(bad.errors[0], /must be a ws:\/\/ or wss:\/\/ URL/);
  assert.match(bad.errors[1], /must be run:<id> or chat:<id>/);
});

test('a complete assignment resolves the scope, the home and the idle timeout', () => {
  const r = readWorkerConfig({ WORCA_CONTROLLER_URL: 'ws://worca:4319', WORCA_WORKER_SCOPE: 'chat:t-1', WORCA_WORKER_TOKEN: 'tok', WORCA_WORKER_ID: 'w-1', WORCA_HOME: '/tmp/h', WORCA_WORKER_IDLE_MS: '60000' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.scope, { kind: 'chat', id: 't-1' });
  assert.equal(r.home, '/tmp/h/.worca-cc/worker-homes/chat/t-1', "the controller's own layout (executor/index.mjs workerHomeDir): nothing overrides it");
  assert.equal(r.idleMs, 60000);
  assert.equal(r.token, 'tok');
});

test('`worca worker` with no assignment exits 78 and says what is missing', () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('WORCA_WORKER') || k === 'WORCA_CONTROLLER_URL') delete env[k];
  const r = spawnSync(process.execPath, [CLI, 'worker'], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, EX_CONFIG, r.stderr);
  assert.match(r.stderr, /worca worker: WORCA_CONTROLLER_URL is not set/);
  assert.match(r.stderr, /WORCA_WORKER_TOKEN/);
});

test('`worca worker --check` prints the engines found without connecting anywhere', () => {
  const r = spawnSync(process.execPath, [CLI, 'worker', '--check'], { env: { ...process.env, PATH: '/nonexistent' }, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  const caps = JSON.parse(r.stdout);
  assert.equal(caps.engines.claude, null);
  assert.equal(caps.node, process.version);
});

import { childEnv } from '../src/worker/exec.mjs';

test("a worker child's env is the controller's composed env with this container's own paths", () => {
  // What the controller sent: composed in ITS container, where the entrypoint built a CA bundle under its /tmp.
  const sent = {
    PATH: '/usr/local/bin:/usr/bin', HOME: '/home/worca', ANTHROPIC_API_KEY: 'k',
    SSL_CERT_FILE: '/tmp/worca-ca.AAAA/bundle.pem', GIT_SSL_CAINFO: '/tmp/worca-ca.AAAA/bundle.pem', CURL_CA_BUNDLE: '/tmp/worca-ca.AAAA/bundle.pem',
    NODE_EXTRA_CA_CERTS: '/etc/worca/ca.pem', npm_config_cache: '/home/worca/.npm',
    HTTPS_PROXY: 'http://127.0.0.1:3128', HTTP_PROXY: 'http://egress:3128', WORCA_WORKER_TOKEN: 't', WORCA_CONTROLLER_URL: 'ws://worca:4319',
  };
  // This worker: its entrypoint rebuilt the bundle under its own /tmp and pointed the caches at the shared volume.
  const workerEnv = { SSL_CERT_FILE: '/tmp/worca-ca.BBBB/bundle.pem', GIT_SSL_CAINFO: '/tmp/worca-ca.BBBB/bundle.pem',
    npm_config_cache: '/worca/.worca-cc/worker-cache/npm', UV_CACHE_DIR: '/worca/.worca-cc/worker-cache/uv' };
  const exists = (p) => p === '/tmp/worca-ca.BBBB/bundle.pem' || p === '/etc/worca/ca.pem';
  const e = childEnv(sent, { home: '/worca/.worca-cc/worker-homes/run/r1', workerPid: 4242, user: 'worca', workerEnv, exists });
  assert.equal(e.SSL_CERT_FILE, '/tmp/worca-ca.BBBB/bundle.pem', "this container's bundle, not the controller's path");
  assert.equal(e.GIT_SSL_CAINFO, '/tmp/worca-ca.BBBB/bundle.pem');
  assert.equal(e.CURL_CA_BUNDLE, undefined, 'a CA path that exists nowhere here is dropped rather than break every TLS call');
  assert.equal(e.NODE_EXTRA_CA_CERTS, '/etc/worca/ca.pem', 'a CA mounted at the same path in both containers stays');
  assert.equal(e.npm_config_cache, '/worca/.worca-cc/worker-cache/npm', "the worker entrypoint's shared caches reach children");
  assert.equal(e.UV_CACHE_DIR, '/worca/.worca-cc/worker-cache/uv');
  assert.equal(e.HTTPS_PROXY, undefined, "the controller's loopback proxy is unreachable here");
  assert.equal(e.HTTP_PROXY, 'http://egress:3128');
  assert.equal(e.WORCA_WORKER_TOKEN, undefined);
  assert.equal(e.WORCA_CONTROLLER_URL, undefined);
  assert.equal(e.ANTHROPIC_API_KEY, 'k', 'credentials the controller composed ride through');
  assert.deepEqual([e.HOME, e.USER, e.WORCA_HOST_PID], ['/worca/.worca-cc/worker-homes/run/r1', 'worca', undefined], 'no host-guard pid was sent (a script node, or the guard is off): none is added');
  const guarded = childEnv({ ...sent, WORCA_HOST_PID: '77' }, { home: '/h', workerPid: 4242, workerEnv, exists });
  assert.equal(guarded.WORCA_HOST_PID, '4242', "the controller's pid means nothing here: the process an agent must not kill is this worker");
  // A path the backend passed into this container that does not exist here either is no better: not used.
  assert.equal(childEnv({ SSL_CERT_FILE: '/tmp/x/bundle.pem' }, { workerEnv: { SSL_CERT_FILE: '/tmp/x/bundle.pem' }, exists: () => false }).SSL_CERT_FILE, undefined);
});

import { createExecRunner, lineSplitter } from '../src/worker/exec.mjs';
import { encodeFrame, MAX_FRAME_BYTES } from '../src/core/executor/protocol.mjs';
import { tmpdir } from 'node:os';

test('lineSplitter: lines as readline gives them, with a bounded buffer for a stream that has no newline', () => {
  const got = [];
  const push = (l, more) => got.push(more ? [l, 'more'] : l);
  const s = lineSplitter(push, { maxPartial: 8 });
  s.write(Buffer.from('one\ntw')); s.write('o\r\n\nlast');
  s.end();
  assert.deepEqual(got, ['one', 'two', '', 'last']);
  // A lone CR ends a line too (a progress bar rewriting itself), as with readline; CRLF split across chunks is one end.
  got.length = 0;
  const cr = lineSplitter(push);
  cr.write('10%\r50%\r'); cr.write('100%\r'); cr.write('\ndone\r'); cr.write('x'); cr.end();
  assert.deepEqual(got, ['10%', '50%', '100%', 'done', 'x']);
  // No line end at all: pieces of at most maxPartial, each but the last saying that more of the line follows.
  got.length = 0;
  const t = lineSplitter(push, { maxPartial: 8 });
  t.write('abcdefghijklmnopqrstu'); t.write('vwx\ny'); t.end();
  assert.deepEqual(got, [['abcdefgh', 'more'], ['ijklmnop', 'more'], 'qrstuvwx', 'y'], 'never more than maxPartial characters held');
  got.length = 0;
  const u = lineSplitter(push);
  const euro = Buffer.from('€uro\n');
  u.write(euro.subarray(0, 2)); u.write(euro.subarray(2)); u.end();
  assert.deepEqual(got, ['€uro'], 'a multi-byte character split across chunks is kept whole');
});

test('a worker survives output no frame can hold: long lines travel alone or in pieces, nothing throws', { timeout: 60000 }, async () => {
  const frames = [];
  // The real sender: a frame that does not encode throws, exactly as on the socket.
  const runner = createExecRunner({ send: (f) => { encodeFrame(f); frames.push(f); }, home: tmpdir(), log: () => {} });
  const program = [
    "process.stdout.write('small\\n');",
    "process.stdout.write('a'.repeat(6 * 1024 * 1024) + '\\n');",            // fits one frame: an engine's large JSON event
    "process.stdout.write('\\u0001'.repeat(3 * 1024 * 1024) + '\\n');",     // 6 bytes of JSON per character: fits none whole
    "process.stdout.write('tail\\n');",
    "process.stdout.write('z'.repeat(9 * 1024 * 1024));",                      // no newline at all
  ].join('');
  const done = new Promise((resolve) => runner.onIdle(resolve));
  runner.start({ type: 'exec', id: 'x1', file: process.execPath, args: ['-e', program], cwd: tmpdir(), env: { PATH: process.env.PATH }, stdin: null, detached: false });
  // Ack as the controller would, so the send window never holds the child back.
  const acker = setInterval(() => { const last = frames.filter((f) => f.type === 'out').at(-1); if (last) runner.ack('x1', last.seq); }, 5);
  await done;
  clearInterval(acker);
  const exit = frames.find((f) => f.type === 'exit');
  assert.deepEqual([exit?.code, exit?.signal], [0, null], 'the child ran to its end; the worker did not crash');
  const outFrames = frames.filter((f) => f.type === 'out' && f.stream === 'out');
  for (const f of outFrames) assert.ok(Buffer.byteLength(JSON.stringify(f), 'utf8') <= MAX_FRAME_BYTES);
  // Put back together the way the controller does (remote-child): lines joined by a newline, and no newline after a
  // frame that says its last line continues.
  const text = outFrames.map((f) => f.lines.join('\n') + (f.more ? '' : '\n')).join('');
  const lines = text.split('\n');
  assert.equal(lines[0], 'small');
  assert.equal(lines[1].length, 6 * 1024 * 1024, 'a long line that fits a frame arrives whole');
  assert.ok(outFrames.filter((f) => f.more).length >= 3, 'what no frame can hold travelled in pieces');
  assert.equal(lines[2], '\u0001'.repeat(3 * 1024 * 1024), 'and is the ONE line it was: nothing lost, no newline put inside it');
  assert.equal(lines[3], 'tail');
  assert.equal(lines[4], 'z'.repeat(9 * 1024 * 1024), 'the newline-free tail too');
  assert.deepEqual(outFrames.map((f) => f.seq), outFrames.map((_, i) => i), 'sequence numbers stay dense');
});

import { passesFromWorker } from '../src/worker/exec.mjs';
import { runWorkerCli, seedClaudeLogin } from '../src/worker/main.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';

test("the worker's own engine credentials reach its children when the controller sent none", () => {
  // Kubernetes: worker.credentialsSecret puts the model key in the WORKER pod; the controller may not have it at all.
  const workerEnv = { OPENAI_API_KEY: 'sk-worker', ANTHROPIC_API_KEY: 'sk-ant-worker', CLAUDE_CODE_OAUTH_TOKEN: 'oat', GEMINI_API_KEY: 'g', COPILOT_GITHUB_TOKEN: 'ghu', AWS_REGION: 'eu-west-1',
    MY_GATEWAY_KEY: 'gw', WORCA_WORKER_PASS_ENV: 'MY_GATEWAY_KEY, OTHER',
    WORCA_WORKER_TOKEN: 'one-time', WORCA_CONTROLLER_URL: 'ws://c:4319', GH_TOKEN: 'ghp', GITHUB_TOKEN: 'ghs', PATH: '/worker/bin', HOSTNAME: 'worca-w-run-1', KUBERNETES_SERVICE_HOST: '10.0.0.1' };
  const e = childEnv({ PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant-controller' }, { home: '/h', workerEnv, exists: () => true });
  assert.equal(e.OPENAI_API_KEY, 'sk-worker');
  assert.equal(e.CLAUDE_CODE_OAUTH_TOKEN, 'oat');
  assert.equal(e.GEMINI_API_KEY, 'g');
  assert.equal(e.COPILOT_GITHUB_TOKEN, 'ghu');
  assert.equal(e.AWS_REGION, 'eu-west-1');
  assert.equal(e.MY_GATEWAY_KEY, 'gw', 'a name the operator listed in WORCA_WORKER_PASS_ENV');
  assert.equal(e.ANTHROPIC_API_KEY, 'sk-ant-controller', "what the controller composed wins over the worker's own");
  assert.equal(e.PATH, '/usr/bin', "the worker's container baseline is not the child's");
  for (const name of ['WORCA_WORKER_TOKEN', 'WORCA_CONTROLLER_URL', 'WORCA_WORKER_PASS_ENV', 'GH_TOKEN', 'GITHUB_TOKEN', 'HOSTNAME', 'KUBERNETES_SERVICE_HOST']) assert.equal(e[name], undefined, name);
  assert.equal(passesFromWorker('WORCA_BROKER_SECRET', ['WORCA_BROKER_SECRET']), false, 'never, even when listed');
  assert.equal(passesFromWorker('GH_TOKEN', ['GH_TOKEN']), false, 'agents get no Git credential');
  // …of any Git host: `AZURE_DEVOPS_EXT_PAT` looks like an `AZURE_*` setting and is a push-capable token.
  for (const name of ['AZURE_DEVOPS_EXT_PAT', 'GITLAB_TOKEN', 'BITBUCKET_TOKEN', 'GITHUB_APP_PRIVATE_KEY', 'SYSTEM_ACCESSTOKEN', 'GIT_ASKPASS']) assert.equal(passesFromWorker(name, [name]), false, name);
  for (const name of ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'COPILOT_GITHUB_TOKEN']) assert.equal(passesFromWorker(name), true, name);
  const e2 = childEnv({}, { workerEnv: { AZURE_DEVOPS_EXT_PAT: 'pat', AZURE_OPENAI_API_KEY: 'k' }, exists: () => true });
  assert.deepEqual([e2.AZURE_DEVOPS_EXT_PAT, e2.AZURE_OPENAI_API_KEY], [undefined, 'k']);
});

test('a Claude login renewed on the controller replaces the one a long-lived worker HOME was seeded with', () => {
  const root = mkdtempSync(join(tmpdir(), 'worca-reseed-'));
  try {
    const seed = join(root, 'seed'); const home = join(root, 'home');
    mkdirSync(seed, { recursive: true }); mkdirSync(home, { recursive: true });
    writeFileSync(join(seed, '.credentials.json'), '{"tok":"old"}');
    assert.deepEqual(seedClaudeLogin(home, seed), ['.credentials.json']);
    assert.deepEqual(seedClaudeLogin(home, seed), [], 'same login: nothing copied again');
    // The operator logs in again on the controller: the seed is newer than what this HOME (a chat thread's) holds.
    writeFileSync(join(seed, '.credentials.json'), '{"tok":"new"}');
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(seed, '.credentials.json'), later, later);
    assert.deepEqual(seedClaudeLogin(home, seed), ['.credentials.json']);
    assert.equal(readFileSync(join(home, '.claude', '.credentials.json'), 'utf8'), '{"tok":"new"}');
    // A token this HOME's own claude refreshed is newer than the seed: it stays.
    writeFileSync(join(home, '.claude', '.credentials.json'), '{"tok":"refreshed-here"}');
    const evenLater = new Date(Date.now() + 120_000);
    utimesSync(join(home, '.claude', '.credentials.json'), evenLater, evenLater);
    assert.deepEqual(seedClaudeLogin(home, seed), []);
    assert.equal(readFileSync(join(home, '.claude', '.credentials.json'), 'utf8'), '{"tok":"refreshed-here"}');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a first connection that cannot be made is tried again; a refused or a dropped one is final', { timeout: 60000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'worca-retry-'));
  const env = () => ({ PATH: '', WORCA_CONTROLLER_URL: 'ws://worca-workers:4319', WORCA_WORKER_SCOPE: 'run:r1', WORCA_WORKER_TOKEN: 't', WORCA_WORKER_ID: 'w-run-1',
    WORCA_HOME: root, WORCA_WORKER_RELAY_PORT: String(40000 + Math.floor(Math.random() * 20000)), WORCA_WORKER_CONNECT_RETRY_MS: '20000' });
  const fake = (o) => ({ done: Promise.resolve(o.code), connected: !!o.connected, refusedStatus: o.refusedStatus ?? null, endedWith: o.why || 'x', relay: async () => ({ lines: null, error: 'n/a' }), leave() {} });
  try {
    // The controller's Service has no ready endpoint yet: refused twice, then it connects and later shuts down cleanly.
    const script = [{ code: 1, why: 'socket error: connect ECONNREFUSED' }, { code: 1, why: 'socket error: getaddrinfo EAI_AGAIN' }, { code: 0, connected: true, why: 'shutdown' }];
    let n = 0; const outs = [];
    assert.equal(await runWorkerCli([], { env: env(), out: (l) => outs.push(l), err: () => {}, start: () => fake(script[n++]) }), 0);
    assert.equal(n, 3);
    assert.equal(outs.filter((l) => /is not reachable yet \(socket error: .*\); trying again/.test(l)).length, 2);
    // A dead token (401) is an answer, not an absence: no second try.
    n = 0;
    assert.equal(await runWorkerCli([], { env: env(), out: () => {}, err: () => {}, start: () => { n++; return fake({ code: 1, refusedStatus: 401, why: 'controller answered 401' }); } }), 1);
    assert.equal(n, 1);
    // Connected, then the socket dropped: there is no reconnect.
    n = 0;
    assert.equal(await runWorkerCli([], { env: env(), out: () => {}, err: () => {}, start: () => { n++; return fake({ code: 1, connected: true, why: 'socket closed (1006)' }); } }), 1);
    assert.equal(n, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an engine's step takes what it left running with it; a script's children stay", { skip: process.platform === 'win32' ? 'POSIX process groups' : false, timeout: 30000 }, async () => {
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const runOnce = async (reap) => {
    const frames = [];
    const runner = createExecRunner({ send: (f) => frames.push(f), home: tmpdir(), log: () => {} });
    const done = new Promise((resolve) => runner.onIdle(resolve));
    // A step that forgets a background process (a dev server) and exits. Its output is detached so the pipes close.
    runner.start({ type: 'exec', id: 'x', file: '/bin/sh', args: ['-c', 'sleep 60 >/dev/null 2>&1 & echo $!'], cwd: tmpdir(), env: { PATH: process.env.PATH }, stdin: null, detached: true, ...(reap ? { reap: true } : {}) });
    await done;
    const pid = Number(frames.filter((f) => f.type === 'out').flatMap((f) => f.lines)[0]);
    assert.ok(pid > 0, JSON.stringify(frames));
    for (let i = 0; i < 50 && reap && alive(pid); i++) await new Promise((r) => setTimeout(r, 20));
    return pid;
  };
  const reaped = await runOnce(true);
  assert.equal(alive(reaped), false, 'the forgotten process went with the engine step, as on one machine');
  const kept = await runOnce(false);
  try { assert.equal(alive(kept), true, "a script node's background process is its own business, as locally"); }
  finally { try { process.kill(kept, 'SIGKILL'); } catch { /* gone */ } }
});

test('a signal while the worker waits to try its first connection again stops it: no new attempt', { timeout: 30000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'worca-sig-'));
  const signals = new EventEmitter();   // the CLI's signal source: never the test process's own
  try {
    let n = 0;
    const fake = () => { n += 1; return { done: Promise.resolve(1), connected: false, refusedStatus: null, endedWith: 'socket error: connect ECONNREFUSED', relay: async () => ({ lines: null, error: 'n/a' }), leave() {} }; };
    const env = { PATH: '', WORCA_CONTROLLER_URL: 'ws://worca-workers:4319', WORCA_WORKER_SCOPE: 'run:r1', WORCA_WORKER_TOKEN: 't', WORCA_WORKER_ID: 'w-run-1',
      WORCA_HOME: root, WORCA_WORKER_RELAY_PORT: String(40000 + Math.floor(Math.random() * 20000)), WORCA_WORKER_CONNECT_RETRY_MS: '20000' };
    const running = runWorkerCli([], { env, out: () => {}, err: () => {}, start: fake, signals });
    for (let i = 0; i < 300 && signals.listenerCount('SIGTERM') === 0; i++) await new Promise((r) => setTimeout(r, 10));
    for (let i = 0; i < 300 && n < 1; i++) await new Promise((r) => setTimeout(r, 10));
    signals.emit('SIGTERM');   // `docker stop` between two attempts
    assert.equal(await running, 1);
    assert.equal(n, 1, 'it did not start another worker after being told to stop');
    assert.equal(signals.listenerCount('SIGTERM'), 0, 'and left no signal handler behind');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a spawn error with a message longer than a frame allows is reported, not thrown', async () => {
  const frames = [];
  const runner = createExecRunner({ send: (f) => { encodeFrame(f); frames.push(f); }, home: tmpdir(), log: () => {} });
  const done = new Promise((resolve) => runner.onIdle(resolve));
  // A path this long cannot be spawned; the error's message embeds it and is longer than the 4096 a frame allows.
  runner.start({ type: 'exec', id: 'x9', file: '/' + 'd'.repeat(5000), args: [], cwd: tmpdir(), env: { PATH: process.env.PATH }, stdin: null, detached: false });
  await Promise.race([done, new Promise((r) => setTimeout(r, 3000))]);
  const err = frames.find((f) => f.type === 'spawn-error');
  assert.ok(err, JSON.stringify(frames.map((f) => f.type)));
  assert.ok(err.message.length <= 4000);
});

import { cutPoint, piecesOf } from '../src/worker/exec.mjs';

test("a worker never puts back a variable the controller left out on purpose", () => {
  const workerEnv = { PATH: '/usr/bin', OPENAI_API_KEY: 'sk-worker', ANTHROPIC_API_KEY: 'sk-ant-worker', GEMINI_API_KEY: 'g-worker' };
  const sent = { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-ant-controller' };
  const plain = childEnv(sent, { home: '/h', workerEnv, exists: () => true });
  assert.equal(plain.OPENAI_API_KEY, 'sk-worker', 'nothing withheld: the worker\'s own credential reaches the engine');
  assert.equal(plain.ANTHROPIC_API_KEY, 'sk-ant-controller', "the controller's value wins");
  // The run's env scrub removed OPENAI_API_KEY (the controller holds it too): the worker's copy must not undo that.
  const scrubbed = childEnv(sent, { home: '/h', workerEnv, exists: () => true, withheld: ['OPENAI_API_KEY', 'LANG'] });
  assert.equal('OPENAI_API_KEY' in scrubbed, false);
  assert.equal(scrubbed.GEMINI_API_KEY, 'g-worker', 'a name nobody removed is still the worker\'s to add');
  assert.equal(childEnv(sent, { home: '/h', workerEnv, exists: () => true, withheld: 'OPENAI_API_KEY' }).OPENAI_API_KEY, 'sk-worker', 'a malformed list is no list');
});

test('a long line is never cut between the two halves of a surrogate pair', () => {
  const face = '\u{1F600}';   // two UTF-16 units
  assert.equal(cutPoint('abcd', 2), 2);
  assert.equal(cutPoint('ab', 5), 2, 'shorter than the cut: all of it');
  assert.equal(cutPoint(`a${face}b`, 2), 1, 'the cut would fall inside the pair: one earlier');
  assert.equal(cutPoint(`a${face}b`, 3), 3, 'after the pair');
  assert.equal(cutPoint(face, 1), 1, 'a piece is never empty');
  const line = `${'x'.repeat(7)}${face}${'y'.repeat(6)}${face}`;
  for (const size of [1, 2, 3, 4, 8, 9, 100]) {
    const pieces = piecesOf(line, size);
    assert.equal(pieces.join(''), line, `size ${size}: nothing lost`);
    if (size > 1) for (const piece of pieces) assert.equal(Buffer.from(piece, 'utf8').toString('utf8'), piece, `size ${size}: every piece encodes on its own`);
  }
  // The splitter's own cut of a stream with no newline obeys the same rule.
  const got = [];
  const s = lineSplitter((text, more) => got.push([text, more]), { maxPartial: 8 });
  s.write(Buffer.from(line, 'utf8')); s.end();
  assert.equal(got.map(([t]) => t).join(''), line);
  for (const [t] of got) assert.equal(Buffer.from(t, 'utf8').toString('utf8'), t);
  assert.deepEqual(got.map(([, more]) => more).slice(-1), [false], 'the last piece ends the line');
});

test('output keeps the order it arrived in across stdout and stderr', { timeout: 30000 }, async () => {
  const frames = [];
  const runner = createExecRunner({ send: (f) => { encodeFrame(f); frames.push(f); }, home: tmpdir(), log: () => {} });
  const done = new Promise((resolve) => runner.onIdle(resolve));
  // Five lines, alternating streams, all inside one flush window or straddling two: either way the order must hold.
  const program = "const w=(s,t)=>new Promise((r)=>s.write(t+'\\n',()=>setTimeout(r,6)));(async()=>{await w(process.stdout,'A');await w(process.stderr,'B');await w(process.stdout,'C');await w(process.stderr,'D');await w(process.stdout,'E');})()";
  runner.start({ type: 'exec', id: 'x-order', file: process.execPath, args: ['-e', program], cwd: null, env: { PATH: process.env.PATH || '' }, stdin: null, detached: true });
  await done;
  const out = frames.filter((f) => f.type === 'out');
  assert.deepEqual(out.flatMap((f) => f.lines.map((l) => `${f.stream}:${l}`)), ['out:A', 'err:B', 'out:C', 'err:D', 'out:E'], 'an error line stays next to the output it belongs to');
  assert.deepEqual(out.map((f) => f.seq), out.map((_, i) => i), 'frames are numbered in the order they were sent');
});

test("a scrubbed spawn gets nothing of the worker's own beyond what its scrub lets through", () => {
  const workerEnv = { OPENAI_API_KEY: 'sk-worker', ANTHROPIC_API_KEY: 'sk-ant-worker', AWS_SECRET_ACCESS_KEY: 'aws', MY_TOOL_KEY: 'tool', WORCA_WORKER_PASS_ENV: 'MY_TOOL_KEY,OTHER_NAME', OTHER_NAME: 'x' };
  const scrubbed = childEnv({ PATH: '/bin', WORCA_ENV_KEEP: 'ANTHROPIC_*,CLAUDE_*,MY_TOOL_KEY' }, { home: '/h', workerEnv, exists: () => true });
  assert.equal(scrubbed.ANTHROPIC_API_KEY, 'sk-ant-worker', "the engine's own names pass the scrub");
  assert.equal(scrubbed.MY_TOOL_KEY, 'tool', 'so does an allowlisted name the worker passes on');
  assert.deepEqual(['OPENAI_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'OTHER_NAME', 'WORCA_ENV_KEEP'].map((k) => k in scrubbed), [false, false, false, false], 'the guardrail holds for keys only the worker has; the marker stops here');
  const open = childEnv({ PATH: '/bin' }, { home: '/h', workerEnv, exists: () => true });
  assert.deepEqual([open.OPENAI_API_KEY, open.AWS_SECRET_ACCESS_KEY, open.OTHER_NAME], ['sk-worker', 'aws', 'x'], 'no scrub: as before');
  assert.equal(childEnv({ PATH: '/bin', WORCA_ENV_KEEP: '' }, { home: '/h', workerEnv, exists: () => true }).OPENAI_API_KEY, undefined, 'a scrub that lets nothing through');
});

test('a spawn that fails at once leaves the worker as idle as before: the idle callbacks fire', async () => {
  const frames = []; let idle = 0;
  const runner = createExecRunner({ send: (f) => frames.push(f), home: tmpdir(), log: () => {} });
  runner.onIdle(() => { idle += 1; });
  runner.start({ type: 'exec', id: 'x-bad', file: '/nonexistent/worca-no-such-binary', args: [], cwd: null, env: {}, stdin: null, detached: true });
  for (let i = 0; i < 100 && !frames.some((f) => f.type === 'spawn-error'); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(frames.some((f) => f.type === 'spawn-error'), true);
  assert.equal(idle, 1, 'a chat worker whose exec failed at once still idles out by itself');
  assert.equal(runner.liveCount, 0);
});

import { startRelayShim } from '../src/worker/relay-shim.mjs';

test('a relayed line that times out frees its slot in the worker and answers 502; a late answer is dropped', async () => {
  const pending = new Map(); let seq = 0;
  // A relay with the worker client's contract: resolve on the controller's answer, or by its own timeout.
  const relays = new Map();
  const relay = (token, line, { timeoutMs = null } = {}) => new Promise((resolve) => {
    const id = `r${++seq}`; let timer = null;
    relays.set(id, { resolve: (r) => { clearTimeout(timer); resolve(r); } });
    if (timeoutMs > 0) timer = setTimeout(() => { relays.delete(id); resolve({ lines: null, error: 'relay timed out' }); }, timeoutMs);
    pending.set(id, line);
  });
  const shim = await startRelayShim({ relay, port: 0, timeoutMs: 80, log: () => {} });
  try {
    const res = await fetch(`http://127.0.0.1:${shim.port}/api/ask/relay`, { method: 'POST', headers: { 'x-worca-relay': 't', 'content-type': 'application/json' }, body: JSON.stringify({ line: '{"id":1}' }) });
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /relay timed out/);
    assert.equal(relays.size, 0, 'the slot (and the line it held) is gone');
  } finally { await shim.close(); }
});

import { findOnPath } from '../src/worker/capabilities.mjs';
import { envInt, sleep } from '../src/core/executor/shared.mjs';

test('env numbers are whole; a sleep on an aborted signal returns at once; a relative binary resolves against the cwd', async () => {
  assert.equal(envInt({ X: '900000.5' }, 'X', 1), 900000, 'the protocol carries integers');
  assert.equal(envInt({ X: '0' }, 'X', 7), 7);
  assert.equal(envInt({}, 'X', undefined), undefined);
  const ctl = new AbortController(); ctl.abort();
  const t0 = Date.now(); await sleep(5000, ctl.signal); assert.ok(Date.now() - t0 < 1000);
  assert.equal(findOnPath('test/cli-worker.test.mjs', ''), resolve('test/cli-worker.test.mjs'));
  assert.equal(findOnPath('test/no-such-file.mjs', ''), null);
});

import { resolveFile } from '../src/worker/exec.mjs';

test("a working directory the worker cannot see is named; a binary only the worker's PATH knows is found", async () => {
  const frames = [];
  const runner = createExecRunner({ send: (f) => frames.push(f), home: tmpdir(), log: () => {} });
  runner.start({ type: 'exec', id: 'x-cwd', file: process.execPath, args: ['-e', ''], cwd: '/nonexistent/worca-checkout', env: {}, stdin: null, detached: true });
  const e = frames.find((f) => f.type === 'spawn-error');
  assert.equal(e.code, 'ENOENT');
  assert.match(e.message, /the working directory \/nonexistent\/worca-checkout does not exist on this worker \(is the shared volume mounted at the same path/);
  // The spawn resolves a bare name on the child's PATH first (the controller's), then on this worker's own.
  const dir = mkdtempSync(join(tmpdir(), 'worca-bin-'));
  writeFileSync(join(dir, 'worca-only-here'), '#!/bin/sh\necho hi\n', { mode: 0o755 });
  assert.equal(resolveFile('worca-only-here', '/nowhere', dir), join(dir, 'worca-only-here'));
  assert.equal(resolveFile('worca-only-here', dir, '/nowhere'), join(dir, 'worca-only-here'));
  assert.equal(resolveFile('worca-never', '/nowhere', dir), 'worca-never', 'not found anywhere: spawn reports the ENOENT');
  assert.equal(resolveFile('/abs/path', '/nowhere', dir), '/abs/path');
  rmSync(dir, { recursive: true, force: true });
});

test('a relayed body over the limit gets a 413, not a dropped connection', async () => {
  const shim = await startRelayShim({ relay: async () => ({ lines: [], error: null }), port: 0, log: () => {} });
  try {
    const res = await fetch(`http://127.0.0.1:${shim.port}/api/ask/relay`, { method: 'POST', headers: { 'x-worca-relay': 't', 'content-type': 'application/json' }, body: JSON.stringify({ line: 'x'.repeat(4 * 1024 * 1024 + 10) }) }).catch((e) => e);
    assert.equal(res.status, 413, res?.message);
  } finally { await shim.close(); }
});

test("a run's own browsers path stays; the shared caches are the worker's; the version line is never an update notice", async () => {
  const workerEnv = { npm_config_cache: '/worca/.worca-cc/worker-cache/npm', UV_CACHE_DIR: '/worca/.worca-cc/worker-cache/uv', PLAYWRIGHT_BROWSERS_PATH: '/worca/.worca-cc/worker-cache/playwright' };
  const e = childEnv({ PATH: '/bin', npm_config_cache: '/home/worca/.npm', PLAYWRIGHT_BROWSERS_PATH: '0', SSH_AUTH_SOCK: '/ssh-agent.sock' }, { home: '/h', workerEnv, exists: () => true });
  assert.equal(e.npm_config_cache, '/worca/.worca-cc/worker-cache/npm', 'a cache is a cache: the shared one');
  assert.equal(e.PLAYWRIGHT_BROWSERS_PATH, '0', "the run pointed Playwright at the project's own browsers: kept");
  assert.equal(childEnv({ PATH: '/bin' }, { home: '/h', workerEnv, exists: () => true }).PLAYWRIGHT_BROWSERS_PATH, '/worca/.worca-cc/worker-cache/playwright', 'nothing set: the shared default');
  assert.equal('SSH_AUTH_SOCK' in e, false, "the controller's SSH agent is its push credential: never a child's");
  const { probeCapabilities } = await import('../src/worker/capabilities.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'worca-ver-'));
  writeFileSync(join(dir, 'codex'), '#!/bin/sh\necho "A new version 9.9.9 is available! Run npm i -g codex"\necho "codex-cli 0.162.0"\n', { mode: 0o755 });
  const caps = await probeCapabilities({ engines: ['codex'], env: { PATH: dir } });
  assert.equal(caps.engines.codex.version, 'codex-cli 0.162.0');
  rmSync(dir, { recursive: true, force: true });
});
