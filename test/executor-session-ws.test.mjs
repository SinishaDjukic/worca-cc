// test/executor-session-ws.test.mjs — the worker registry and a worker over a real local
// WebSocket: token handshake, exec through the supervisor seam, flow control, signals,
// release, idle reclaim, loss, and boot-time reaping. The worker runs in this process
// (backends/in-process.mjs); its children are real.
import { test, after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { createWorkerRegistry } from '../src/core/executor/registry.mjs';
import { createWorkerSession } from '../src/core/executor/session.mjs';
import { EventEmitter } from 'node:events';
import { createInProcessBackend } from '../src/core/executor/backends/in-process.mjs';
import { installExecutor } from '../src/core/executor/index.mjs';
import { withExecutorScope } from '../src/core/executor/scope.mjs';
import { superviseSpawn } from '../src/core/engines/spawn.mjs';
import { encodeFrame, PROTOCOL_VERSION } from '../src/core/executor/protocol.mjs';
import { startWorker } from '../src/worker/client.mjs';
import { worcaHome } from '../src/core/projects.mjs';

const home = useTempHome(after);
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-ws-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
function script(body) { const f = join(tmp(), 'bin.sh'); writeFileSync(f, `#!/bin/sh\n${body}\n`); chmodSync(f, 0o755); return f; }
const base = (over = {}) => ({
  displayBin: 'fake', cwd: tmpdir(), env: { PATH: process.env.PATH }, stdin: null, signal: undefined, asAgent: false,
  stagedDir: null, cleanup: () => {}, onEvent: () => {}, onStdoutLine: () => {}, stdoutErrorDetail: () => '', classify: () => null,
  spawnError: (err, prefix) => Object.assign(new Error(`${prefix}: ${err.message}`), err.code ? { code: err.code } : {}),
  onDone: (code) => ({ code }), ...over,
});
const RUN = { kind: 'run', id: 'r-ws' };
const CHAT = { kind: 'chat', id: 't-ws' };
const CAPS = { engines: { claude: null }, platform: process.platform, node: process.version, user: null };

let registry; let backend; const logs = [];
before(async () => {
  backend = createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS, log: (m) => logs.push(m) });
  registry = createWorkerRegistry({ backend, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, chatIdleMs: 300, pingMs: 200, log: (m) => logs.push(m) });
  await registry.listen();
  installExecutor({ kind: 'docker', registry });
});
after(async () => { installExecutor(null); await registry.closeAll('test over'); });
afterEach(async () => { await registry.release(RUN, { reason: 'test' }); await registry.release(CHAT, { reason: 'test' }); });

const inRun = (fn) => withExecutorScope(RUN, fn);

test('acquire starts a worker that connects with its token; the same scope reuses it', async () => {
  const s1 = await registry.acquire(RUN);
  assert.equal(s1.scope.kind, 'run');
  assert.deepEqual(s1.capabilities, CAPS);
  assert.ok(s1.pid > 0);
  const s2 = await registry.acquire(RUN);
  assert.equal(s2, s1, 'one worker per scope');
  assert.equal(backend.started.length, 1);
  assert.deepEqual(registry.snapshot().map((e) => [e.scope.id, e.state, e.liveExecs]), [['r-ws', 'ready', 0]]);
  assert.match(registry.controllerUrl, /^ws:\/\/127\.0\.0\.1:\d+$/);
});

test('a spawn inside the scope runs on the worker: lines, stdin, exit code, HOME and the host-guard pid are the worker\'s', POSIX, async () => {
  const seen = [];
  const r = await inRun(() => superviseSpawn(base({ file: script('read x; echo "in:$x"; echo "home:$HOME"; echo "pid:$WORCA_HOST_PID"; echo "tok:${WORCA_WORKER_TOKEN:-none}"; echo e 1>&2; exit 0'), args: [], stdin: 'hi', env: { PATH: process.env.PATH, WORCA_WORKER_TOKEN: 'leak?', WORCA_HOST_PID: '1' }, onStdoutLine: (l) => seen.push(l) })));
  assert.deepEqual(r, { code: 0 });
  const expectHome = join(worcaHome(), 'worker-homes', 'run', 'r-ws');
  assert.deepEqual(seen, ['in:hi', `home:${expectHome}`, `pid:${process.pid}`, 'tok:none']);
  assert.ok(seen[1].startsWith(`home:${home}`));
  // A spawn the controller sent no host-guard pid with (a script node) gets none from the worker either.
  const bare = [];
  await inRun(() => superviseSpawn(base({ file: script('echo "pid:${WORCA_HOST_PID:-none}"'), args: [], env: { PATH: process.env.PATH }, onStdoutLine: (l) => bare.push(l) })));
  assert.deepEqual(bare, ['pid:none']);
});

test("a run's worker for another engine than its own leaves when idle and comes back on demand; the run's own stays", async () => {
  const b = createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS });
  const r = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, pingMs: 200, helperIdleMs: 150, log: () => {} });
  await r.listen();
  try {
    const scope = { kind: 'run', id: 'mixed', engine: 'codex' };
    const own = await r.acquire(scope, { engine: 'codex' });
    const helper = await r.acquire(scope, { engine: 'claude' });   // the run's title, on Claude
    assert.notEqual(helper, own);
    assert.deepEqual(b.started.map((h) => h.engine), ['codex', 'claude']);
    for (let i = 0; i < 200 && b.live.length > 1; i++) await new Promise((res) => setTimeout(res, 20));
    assert.deepEqual(b.live.map((h) => h.engine), ['codex'], "the helper left; the run's own worker has no idle timeout");
    for (let i = 0; i < 200 && !helper.closed; i++) await new Promise((res) => setTimeout(res, 10));   // the controller has seen the close too
    assert.equal(helper.closed, true);
    assert.equal(await r.acquire(scope, { engine: 'codex' }), own);
    const again = await r.acquire(scope, { engine: 'claude' });
    assert.notEqual(again, helper, 'a fresh one when the run needs that engine again');
    assert.equal(b.started.length, 3);
  } finally { await r.closeAll(); }
});

test('ten thousand lines arrive complete and in order through the send window', POSIX, async () => {
  const seen = [];
  const r = await inRun(() => superviseSpawn(base({ file: script('i=0; while [ $i -lt 10000 ]; do echo "line $i"; i=$((i+1)); done'), args: [], onStdoutLine: (l) => seen.push(l) })));
  assert.deepEqual(r, { code: 0 });
  assert.equal(seen.length, 10000);
  assert.equal(seen[0], 'line 0');
  assert.equal(seen[9999], 'line 9999');
  assert.ok(seen.every((l, i) => l === `line ${i}`), 'in order');
});

test('two execs on one worker run concurrently', POSIX, async () => {
  const t0 = Date.now();
  const [a, b] = await inRun(() => Promise.all([
    superviseSpawn(base({ file: script('sleep 0.4; echo a'), args: [] })),
    superviseSpawn(base({ file: script('sleep 0.4; echo b'), args: [] })),
  ]));
  assert.deepEqual([a, b], [{ code: 0 }, { code: 0 }]);
  assert.ok(Date.now() - t0 < 1500, 'not serialized');
});

test('a fatal stdout line escalates SIGTERM -> SIGKILL on the worker; the exit carries the signal', POSIX, async () => {
  const fatal = new Error('stop');
  const prev = process.env.WORCA_SIGKILL_GRACE_MS;
  process.env.WORCA_SIGKILL_GRACE_MS = '100';
  try {
    const t0 = Date.now();
    const err = await inRun(() => superviseSpawn(base({ file: script("trap '' TERM; echo go; exec sleep 30"), args: [], onStdoutLine: (l) => (l === 'go' ? fatal : undefined) }))).then(() => null, (e) => e);
    assert.equal(err, fatal);
    assert.ok(Date.now() - t0 < 5000);
  } finally { if (prev === undefined) delete process.env.WORCA_SIGKILL_GRACE_MS; else process.env.WORCA_SIGKILL_GRACE_MS = prev; }
});

test('release sends shutdown: the worker ends its children, says bye and exits 0; the backend removes it', POSIX, async () => {
  const s = await registry.acquire(RUN);
  const p = inRun(() => superviseSpawn(base({ file: script('echo up; sleep 30'), args: [] }))).then(() => null, (e) => e);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(s.liveExecCount, 1);
  await registry.release(RUN, { reason: 'done', graceMs: 300 });
  const handle = backend.started.at(-1);
  assert.equal(await handle.done, 0, 'the worker chose to leave');
  assert.equal(s.closed, true);
  assert.equal(s.closeReason, 'bye');
  const err = await p;
  assert.ok(err, 'the in-flight spawn failed');
  assert.deepEqual(registry.snapshot(), []);
  assert.deepEqual(await backend.listWorkers(), []);
});

test('a chat worker is reclaimed after the idle timeout; the next turn gets a fresh one', async () => {
  const s = await registry.acquire(CHAT);
  await withExecutorScope(CHAT, () => superviseSpawn(base({ file: 'true', args: [] })));
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(s.closed, true, `idle worker left (${s.closeReason})`);
  assert.deepEqual(registry.snapshot(), []);
  const s2 = await registry.acquire(CHAT);
  assert.notEqual(s2, s);
});

test('when the socket drops, the worker kills its children and exits 1; the controller side reports a lost worker', POSIX, async () => {
  const s = await registry.acquire(RUN);
  const handle = backend.started.at(-1);
  const p = inRun(() => superviseSpawn(base({ file: script('echo up; sleep 30'), args: [] }))).then(() => null, (e) => e);
  await new Promise((r) => setTimeout(r, 150));
  s.terminate('cable pulled');
  const err = await p;
  assert.equal(err.code, 'EWORKERLOST');
  assert.equal(err.errorClass, 'network');
  assert.match(err.message, /lost: cable pulled/);
  assert.equal(await handle.done, 1);
  for (let i = 0; i < 60 && handle.worker.liveCount > 0; i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.equal(handle.worker.liveCount, 0, 'the worker killed its children');
  assert.deepEqual(registry.snapshot(), [], 'the entry is gone, so the next acquire starts a new worker');
});

test('tokens: unknown, reused, and a hello for another scope are refused', async () => {
  const url = `${registry.controllerUrl}/worker`;
  const status = (headers) => new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.on('unexpected-response', (_req, res) => { resolve(res.statusCode); ws.terminate(); });
    ws.on('open', () => resolve('open'));
    ws.on('error', () => {});
  });
  assert.equal(await status({}), 401);
  assert.equal(await status({ authorization: 'Bearer nope' }), 401);

  // A token the registry minted: grab it from the backend's start call, connect with the wrong scope.
  const captured = [];
  const spyBackend = {
    async start(o) { captured.push(o); return { workerId: o.workerId }; },
    async remove() {}, async listWorkers() { return []; }, describe() { return {}; },
  };
  const reg2 = createWorkerRegistry({ backend: spyBackend, host: '127.0.0.1', port: 0, startTimeoutMs: 1500, log: () => {} });
  await reg2.listen();
  try {
    const pending = reg2.acquire({ kind: 'run', id: 'other' }).then(() => 'connected', (e) => e.message);
    await new Promise((r) => setTimeout(r, 50));
    const { token, workerId } = captured[0];
    const refusal = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${reg2.port}/worker`, { headers: { authorization: `Bearer ${token}` } });
      ws.on('open', () => ws.send(encodeFrame({ type: 'hello', apiVersion: PROTOCOL_VERSION, workerId, scope: { kind: 'chat', id: 'other' }, pid: 1, capabilities: CAPS })));
      ws.on('message', (d) => resolve(JSON.parse(String(d))));
      ws.on('close', () => resolve(null));
      ws.on('error', () => resolve(null));
    });
    assert.equal(refusal?.type, 'refuse');
    assert.match(refusal.reason, /scope or worker id/);
    assert.match(await pending, /did not connect within/);
  } finally { await reg2.closeAll(); }
});

test('a hello with the right token and scope is accepted once; a second connection with the same token is refused', async () => {
  const captured = [];
  const spyBackend = { async start(o) { captured.push(o); return { workerId: o.workerId }; }, async remove() {}, async listWorkers() { return []; }, describe() { return {}; } };
  const reg2 = createWorkerRegistry({ backend: spyBackend, host: '127.0.0.1', port: 0, startTimeoutMs: 3000, log: () => {} });
  await reg2.listen();
  try {
    const pending = reg2.acquire({ kind: 'run', id: 'one' });
    await new Promise((r) => setTimeout(r, 50));
    const { token, workerId, controllerUrl } = captured[0];
    const w = startWorker({ url: controllerUrl, token, scope: { kind: 'run', id: 'one' }, workerId, home: tmp(), capabilities: CAPS });
    const session = await pending;
    assert.equal(session.workerId, workerId);
    const again = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${reg2.port}/worker`, { headers: { authorization: `Bearer ${token}` } });
      ws.on('unexpected-response', (_req, res) => { resolve(res.statusCode); ws.terminate(); });
      ws.on('open', () => resolve('open'));
      ws.on('error', () => {});
    });
    assert.equal(again, 401, 'a token is single-use');
    await reg2.release({ kind: 'run', id: 'one' });
    assert.equal(await w.done, 0);
  } finally { await reg2.closeAll(); }
});

test('a scope gets one worker per engine; a spawn that names none uses the one the scope has; release ends them all', async () => {
  const before = backend.started.length;
  const claude = await registry.acquire({ ...RUN, engine: 'claude' });
  const codex = await registry.acquire(RUN, { engine: 'codex' });
  assert.notEqual(codex, claude, "another engine is another worker (its own image under a container backend)");
  assert.equal(await registry.acquire(RUN, { engine: 'claude' }), claude);
  assert.equal(await registry.acquire(RUN, { engine: 'codex' }), codex);
  assert.equal(await registry.acquire(RUN), claude, 'no engine named (a script node): the worker the scope already has');
  assert.deepEqual(backend.started.slice(before).map((h) => h.engine), ['claude', 'codex'], 'the backend is told which engine to start');
  assert.deepEqual(registry.snapshot().map((e) => [e.scope.id, e.engine, e.state]).sort(), [['r-ws', 'claude', 'ready'], ['r-ws', 'codex', 'ready']]);
  assert.equal(await registry.release(RUN, { reason: 'test' }), true);
  assert.deepEqual(registry.snapshot(), [], 'both are gone');
});

test('a backend whose engines share one image keeps one worker per scope', async () => {
  const b2 = createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS });
  b2.classFor = () => 'registry.example/worca-worker:1-all';
  const reg2 = createWorkerRegistry({ backend: b2, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, pingMs: 200, log: () => {} });
  await reg2.listen();
  try {
    const a = await reg2.acquire({ kind: 'run', id: 'm' }, { engine: 'claude' });
    const c = await reg2.acquire({ kind: 'run', id: 'm' }, { engine: 'codex' });
    assert.equal(c, a);
    assert.equal(b2.started.length, 1);
  } finally { await reg2.closeAll(); }
});

test('every caller waiting on a start that fails is rejected, not only the first', async () => {
  let fire; const gate = new Promise((r) => { fire = r; });
  const b = { async start() { await gate; throw new Error('no image'); }, async remove() {}, async listWorkers() { return []; }, describe() { return {}; } };
  const reg2 = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, log: () => {} });
  await reg2.listen();
  try {
    const first = reg2.acquire({ kind: 'run', id: 'x' }).then(() => null, (e) => e);
    const second = reg2.acquire({ kind: 'run', id: 'x' }).then(() => null, (e) => e);   // a parallel node of the same run
    await new Promise((r) => setTimeout(r, 20));
    fire();
    for (const e of await Promise.all([first, second])) {
      assert.match(e?.message || '', /cannot start a worker for run:x: no image/);
      assert.equal(e.errorClass, 'network');
    }
    assert.deepEqual(reg2.snapshot(), []);
  } finally { await reg2.closeAll(); }
});

test('a stop while the worker is still starting ends the wait at once; the start goes on only while someone else waits', async () => {
  const starts = [];      // one per backend.start: { signal, finish }
  const removed = [];
  const b = {
    start({ workerId, signal }) { return new Promise((resolve) => starts.push({ signal, finish: () => resolve({ workerId }) })); },
    async remove(h, o) { removed.push([h.workerId, o.reason]); }, async listWorkers() { return []; }, describe() { return {}; },
  };
  const reg2 = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, log: () => {} });
  await reg2.listen();
  const tick = () => new Promise((r) => setTimeout(r, 20));
  try {
    // The only caller stops: an AbortError now, the backend's own wait is told to stop, and a container that still
    // arrives is removed.
    const ctl = new AbortController();
    const p = reg2.acquire({ kind: 'run', id: 'y' }, { signal: ctl.signal }).then(() => null, (e) => e);
    await tick();
    ctl.abort();
    assert.equal((await p).name, 'AbortError');
    assert.equal(starts[0].signal.aborted, true);
    assert.deepEqual(reg2.snapshot(), []);
    starts[0].finish();
    await tick();
    assert.equal(removed.length, 1);
    assert.equal(removed[0][1], 'start abandoned');
    // Already stopped: nothing is started at all.
    await assert.rejects(reg2.acquire({ kind: 'run', id: 'z' }, { signal: ctl.signal }), { name: 'AbortError' });
    assert.equal(starts.length, 1);
    // Two callers, one stops: its wait ends, the other's start goes on.
    const ctl2 = new AbortController();
    const stopper = reg2.acquire({ kind: 'run', id: 'w' }, { signal: ctl2.signal }).then(() => null, (e) => e);
    const waiter = reg2.acquire({ kind: 'run', id: 'w' }).then(() => null, (e) => e);
    await tick();
    ctl2.abort();
    assert.equal((await stopper).name, 'AbortError');
    assert.equal(starts[1].signal.aborted, false, 'someone still waits for this worker');
    assert.deepEqual(reg2.snapshot().map((e) => e.state), ['starting']);
    await reg2.release({ kind: 'run', id: 'w' }, { reason: 'test' });
    assert.match((await waiter).message, /released before it connected/);
    assert.equal(starts[1].signal.aborted, true, 'a released start stops the backend too');
  } finally { await reg2.closeAll(); }
});

test('an exec that cannot be sent says why: a malformed request is EPROTO, a worker that is gone is a lost worker', async () => {
  const s = await registry.acquire(RUN);
  const outcome = (spec) => new Promise((resolve) => s.exec(spec, { onStarted() {}, onLines() {}, onExit() {}, onLost() {}, onSpawnError: resolve }));
  // What an adapter may put in an env (a number, an unset optional) is sent as spawn itself would take it.
  const lines = [];
  const ran = await new Promise((resolve) => s.exec({ file: '/bin/sh', args: ['-c', 'echo "$N:${UNSET-none}:$NIL"'], cwd: tmpdir(), env: { PATH: process.env.PATH, N: 5, UNSET: undefined, NIL: null }, stdin: null },
    { onStarted() {}, onLines: (f) => lines.push(...f.lines), onExit: resolve, onLost() {}, onSpawnError: resolve }));
  assert.deepEqual([ran.code, lines], [0, ['5:none:']]);
  const bad = await outcome({ file: '', args: [], cwd: tmpdir(), env: {}, stdin: null });
  assert.deepEqual([bad.code, bad.errorClass], ['EPROTO', undefined], 'not E2BIG: nothing about this request is too large');
  assert.match(bad.message, /invalid exec frame/);
  const big = await outcome({ file: '/bin/sh', args: [], cwd: tmpdir(), env: {}, stdin: 'x'.repeat(8 * 1024 * 1024 + 1) });
  assert.equal(big.code, 'E2BIG');
  await registry.release(RUN, { reason: 'test' });
  const gone = await outcome({ file: '/bin/sh', args: ['-c', 'true'], cwd: tmpdir(), env: {}, stdin: null });
  assert.deepEqual([gone.code, gone.errorClass], ['EWORKERLOST', 'network'], 'retried on a fresh worker by the failure policy');
});

test('reapAtBoot removes every worker the backend still lists, except the ones this controller started', async () => {
  const removed = [];
  const listed = [{ workerId: 'old-1', bootId: 'ctl-previous' }, { workerId: 'old-2' }, { workerId: 'mine-1', bootId: 'ctl-now' }, { workerId: 'mine-2', own: true }];
  const b = { async start() { throw new Error('unused'); }, async remove(h, o) { removed.push([h.workerId, o.reason]); }, async listWorkers() { return listed; }, describe() { return {}; } };
  const reg2 = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, bootId: 'ctl-now', log: () => {} });
  assert.deepEqual(await reg2.reapAtBoot(), { removed: 2 }, 'maintenance runs while the server serves: a worker of this boot is not an orphan');
  assert.deepEqual(removed, [['old-1', 'orphan at boot'], ['old-2', 'orphan at boot']]);
});

test('a worker whose container takes longer to come up than the token lives still gets in; the time to live counts from the container', async () => {
  // A cold node pulling the image: the backend needs far longer than tokenTtlMs before the worker process even exists.
  const b2 = createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS, beforeStart: () => new Promise((r) => setTimeout(r, 200)) });
  const reg2 = createWorkerRegistry({ backend: b2, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, tokenTtlMs: 40, pingMs: 200, log: () => {} });
  await reg2.listen();
  try {
    const s = await reg2.acquire({ kind: 'run', id: 'slow' });
    assert.equal(s.scope.id, 'slow');
  } finally { await reg2.closeAll(); }
});

test('at the worker cap: a scope\'s second worker never waits, an idle chat worker gives way, and a full house fails the start instead of hanging', async () => {
  const mk = async (o = {}) => {
    const b = createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS });
    const r = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, pingMs: 200, chatIdleMs: 60_000, maxWorkers: 1, capWaitMs: 150, capPollMs: 20, log: (m) => o.logs?.push(m), ...o.opts });
    await r.listen();
    return { b, r };
  };
  const logs = [];
  const { b, r } = await mk({ logs });
  try {
    assert.equal(b.started.length, 0);
    const first = await r.acquire({ kind: 'run', id: 'a' }, { engine: 'codex' });
    // A helper job of the same run on another engine: over the cap, but never made to wait for it (that wait holds a slot).
    const second = await r.acquire({ kind: 'run', id: 'a' }, { engine: 'claude' });
    assert.notEqual(second, first);
    assert.equal(b.started.at(-1).own, true, 'an in-process worker is always this process\'s own');
    // Another run finds every slot taken by working runs: it waits, says so, and fails as a start failure.
    const err = await r.acquire({ kind: 'run', id: 'b' }, { engine: 'claude' }).then(() => null, (e) => e);
    assert.match(err.message, /no free worker for run:b after 0 s: all 1 \(WORCA_WORKER_MAX\) are in use/);
    assert.deepEqual([err.code, err.errorClass], ['EWORKERSTART', 'network'], 'the run pauses or retries; it does not hang');
    assert.ok(logs.some((l) => /run:b waits for a free worker/.test(l)), logs.join('\n'));
  } finally { await r.closeAll(); }
  // A chat worker with nothing running gives way to a run — unless it was handed out a moment ago (its exec follows
  // a few ticks after acquire): then the run waits for it like for any busy worker.
  const two = await mk({ logs, opts: { claimGraceMs: 400 } });   // longer than capWaitMs (150): the first ask fails, a later one evicts
  try {
    await two.r.acquire({ kind: 'chat', id: 'idle-thread' }, { engine: 'claude' });
    const tooSoon = await two.r.acquire({ kind: 'run', id: 'c' }, { engine: 'claude' }).then(() => null, (e) => e);
    assert.match(tooSoon.message, /no free worker for run:c/, 'a worker just handed to a chat turn is not evicted under it');
    assert.deepEqual(two.r.snapshot().map((e) => e.scope.id), ['idle-thread']);
    await new Promise((res) => setTimeout(res, 450));
    const run = await two.r.acquire({ kind: 'run', id: 'c' }, { engine: 'claude' });
    assert.equal(run.scope.id, 'c');
    assert.deepEqual(two.r.snapshot().map((e) => e.scope.id), ['c'], 'the idle chat worker was released for it');
    assert.ok(logs.some((l) => /worker cap \(1\) reached: releasing idle chat:idle-thread for run:c/.test(l)));
  } finally { await two.r.closeAll(); }
});

test('a token lives as long as the registry waits for the hello, unless told otherwise', async () => {
  const captured = [];
  const b = { async start(o) { captured.push(o); return { workerId: o.workerId }; }, async remove() {}, async listWorkers() { return []; }, describe() { return {}; } };
  const status = (reg, token) => new Promise((resolve) => {
    const ws = new WebSocket(`${reg.controllerUrl}/worker`, { headers: { authorization: `Bearer ${token}` } });
    ws.on('unexpected-response', (_req, res) => { resolve(res.statusCode); ws.terminate(); });
    ws.on('open', () => { resolve('open'); ws.terminate(); });
    ws.on('error', () => {});
  });
  // An explicit, short time to live: a worker that shows up after it is refused.
  const short = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, startTimeoutMs: 2000, tokenTtlMs: 40, log: () => {} });
  await short.listen();
  try {
    short.acquire({ kind: 'run', id: 's' }).catch(() => {});
    for (let i = 0; i < 100 && captured.length < 1; i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(await status(short, captured[0].token), 401);
  } finally { await short.closeAll(); }
  // The default: as long as the start timeout — raising WORCA_WORKER_START_TIMEOUT_MS gives a slow worker that long.
  const long = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, startTimeoutMs: 2000, log: () => {} });
  await long.listen();
  try {
    long.acquire({ kind: 'run', id: 'l' }).catch(() => {});
    for (let i = 0; i < 100 && captured.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(await status(long, captured[1].token), 'open');
  } finally { await long.closeAll(); }
});

test('a worker that runs another worca version than the controller is named in the log, and still served', async () => {
  const logs = [];
  const b2 = createInProcessBackend({ homeRoot: worcaHome(), capabilities: { ...CAPS, worca: '1.2.0' } });
  const reg2 = createWorkerRegistry({ backend: b2, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, pingMs: 200, version: '1.3.0', log: (m) => logs.push(m) });
  await reg2.listen();
  try {
    const s = await reg2.acquire({ kind: 'run', id: 'old-image' });
    assert.equal(s.capabilities.worca, '1.2.0');
    assert.ok(logs.some((l) => /worker w-run-[0-9a-f]+ runs worca 1\.2\.0, this controller 1\.3\.0: pull the worker image/.test(l)), logs.join('\n'));
  } finally { await reg2.closeAll(); }
  const same = [];
  const b3 = createInProcessBackend({ homeRoot: worcaHome(), capabilities: { ...CAPS, worca: '1.3.0' } });
  const reg3 = createWorkerRegistry({ backend: b3, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, pingMs: 200, version: '1.3.0', log: (m) => same.push(m) });
  await reg3.listen();
  try { await reg3.acquire({ kind: 'run', id: 'same-image' }); assert.ok(!same.some((l) => /pull the worker image/.test(l))); }
  finally { await reg3.closeAll(); }
});

test('a relay answer too large to send comes back as an error at once, not as silence', async () => {
  const b2 = createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS });
  const reg2 = createWorkerRegistry({ backend: b2, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, pingMs: 200, log: () => {},
    onRelay: async (f) => (f.line === 'big' ? { lines: ['x'.repeat(9 * 1024 * 1024)], error: null } : { lines: ['ok'], error: null }) });
  await reg2.listen();
  try {
    await reg2.acquire({ kind: 'chat', id: 'relay' });
    const worker = b2.started.at(-1).worker;
    assert.deepEqual(await worker.relay('tok', 'small'), { lines: ['ok'], error: null });
    const t0 = Date.now();
    const r = await worker.relay('tok', 'big');
    assert.equal(r.lines, null);
    assert.match(r.error, /relay: the answer could not be sent \(frame exceeds MAX_FRAME_BYTES/);
    assert.ok(Date.now() - t0 < 5000, 'answered at once');
  } finally { await reg2.closeAll(); }
});

test('a scope released, or a registry closed, while an acquire is still working out its worker starts nothing', async () => {
  let open; const gate = new Promise((r) => { open = r; });
  const started = [];
  const b = { async classFor() { await gate; return 'img'; }, start(o) { started.push(o.scopeKey); return new Promise(() => {}); }, async remove() {}, async listWorkers() { return []; }, describe() { return {}; } };
  const reg2 = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, log: () => {} });
  await reg2.listen();
  try {
    const scope = { kind: 'run', id: 'ending' };
    const late = reg2.acquire(scope, { engine: 'claude' }).then(() => null, (e) => e);   // a spawn in the same tick as the run's finally
    await reg2.release(scope, { reason: 'done' });                                        // finds no worker yet, returns
    open();
    const err = await late;
    assert.match(err.message, /the worker for run:ending was released while this spawn was starting/);
    assert.equal(err.errorClass, 'network');
    assert.deepEqual(started, [], 'no container was started for a run that is over');
    // A later segment of the same run (a resume) is a new acquire and is served.
    const again = reg2.acquire(scope, { engine: 'claude' }).catch(() => {});
    for (let i = 0; i < 100 && !started.length; i++) await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(started, ['run:ending']);
    await reg2.release(scope, { reason: 'test' }); await again;
  } finally { await reg2.closeAll(); }
});

test('thousands of other scopes ending never disturb an acquire in flight, and never start a worker for a released one', async () => {
  let open; const gate = new Promise((r) => { open = r; });
  const started = [];
  const b = { async classFor() { await gate; return 'img'; }, start(o) { started.push(o.scopeKey); return new Promise(() => {}); }, async remove() {}, async listWorkers() { return []; }, describe() { return {}; } };
  const reg2 = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, log: () => {} });
  await reg2.listen();
  try {
    const kept = { kind: 'run', id: 'kept' }; const ended = { kind: 'run', id: 'ended' };
    const a = reg2.acquire(kept, { engine: 'claude' }).then(() => null, (e) => e);
    const z = reg2.acquire(ended, { engine: 'claude' }).then(() => null, (e) => e);
    await reg2.release(ended, { reason: 'done' });
    for (let i = 0; i < 6000; i++) await reg2.release({ kind: 'chat', id: `t${i}` }, { reason: 'idle' });   // a busy day of chats ending
    open();
    assert.match((await z).message, /the worker for run:ended was released while this spawn was starting/, 'its release is still remembered');
    for (let i = 0; i < 100 && !started.length; i++) await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(started, ['run:kept'], 'the untouched scope got its worker');
    await reg2.release(kept, { reason: 'test' }); await a;
  } finally { await reg2.closeAll(); }
});

test('a worker that exits before it connects fails the start at once with its reason, not after the whole timeout', async () => {
  let exited = false; const removed = [];
  const b = {
    async start(o) { return { workerId: o.workerId }; },
    async probe() { return exited ? 'its container exited (code 78):\nworca-worker-entrypoint: /worca is not writable by uid 1000' : null; },
    async remove(h, o) { removed.push(o.reason); }, async listWorkers() { return []; }, describe() { return {}; },
  };
  const reg2 = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, startTimeoutMs: 60_000, probeMs: 20, log: () => {} });
  await reg2.listen();
  try {
    const t0 = Date.now();
    const p = reg2.acquire({ kind: 'run', id: 'dies' }).then(() => null, (e) => e);
    await new Promise((r) => setTimeout(r, 60));
    exited = true;
    const err = await p;
    assert.match(err.message, /worker w-run-[0-9a-f]+ for run:dies will not connect: its container exited \(code 78\):\nworca-worker-entrypoint: \/worca is not writable/);
    assert.equal(err.errorClass, 'network');
    assert.ok(Date.now() - t0 < 5000, 'long before the 60 s start timeout');
    assert.deepEqual(reg2.snapshot(), []);
    assert.deepEqual(removed, ['did not connect']);
  } finally { await reg2.closeAll(); }
});

test('a malformed WebSocket frame before the hello closes that socket and nothing else', async () => {
  const captured = [];
  const b = { start(o) { captured.push(o); return new Promise(() => {}); }, async remove() {}, async listWorkers() { return []; }, describe() { return {}; } };
  const reg2 = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, log: () => {} });
  await reg2.listen();
  try {
    const waiting = reg2.acquire({ kind: 'run', id: 'bad' }).then(() => null, (e) => e);
    for (let i = 0; i < 100 && !captured.length; i++) await new Promise((r) => setTimeout(r, 5));
    const ws = new WebSocket(`${reg2.controllerUrl}/worker`, { headers: { authorization: `Bearer ${captured[0].token}` } });
    await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
    const closed = new Promise((resolve) => ws.on('close', resolve));
    ws.on('error', () => {});
    // FIN + RSV1..3 set, a masked empty text frame: the server's receiver rejects it ("RSV2 and RSV3 must be clear").
    // Without an 'error' listener on the server's socket that is an uncaught exception in the controller process —
    // which would fail this whole test file.
    ws._socket.write(Buffer.from([0xF1, 0x80, 0x00, 0x00, 0x00, 0x00]));
    await closed;
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(reg2.snapshot().map((e) => e.state), ['starting'], 'the registry is alive and the start goes on');
    await reg2.release({ kind: 'run', id: 'bad' }, { reason: 'test' });
    assert.match((await waiting).message, /released before it connected/);
  } finally { await reg2.closeAll(); }
});

test('a hello that arrives after its start was released is refused: a release is never undone by a late worker', async () => {
  const captured = [];
  const removed = [];
  const b = { start(o) { captured.push(o); return new Promise(() => {}); }, async remove(h) { removed.push(h); }, async listWorkers() { return []; }, describe() { return {}; } };
  const reg2 = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, log: () => {} });
  await reg2.listen();
  try {
    const scope = { kind: 'run', id: 'late' };
    const waiting = reg2.acquire(scope).then(() => null, (e) => e);
    for (let i = 0; i < 100 && !captured.length; i++) await new Promise((r) => setTimeout(r, 5));
    const { token, workerId } = captured[0];
    // The worker's socket is up (the upgrade passed while the start was live)…
    const ws = new WebSocket(`${reg2.controllerUrl}/worker`, { headers: { authorization: `Bearer ${token}` } });
    await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
    // …the run is released before its hello…
    await reg2.release(scope, { reason: 'paused' });
    assert.match((await waiting).message, /released before it connected/);
    // …and the hello comes late.
    const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
    const frames = [];
    ws.on('message', (d) => frames.push(JSON.parse(String(d))));
    ws.send(encodeFrame({ type: 'hello', apiVersion: PROTOCOL_VERSION, workerId, scope, pid: 1, capabilities: CAPS }));
    assert.equal(await closed, 4001);
    assert.deepEqual(frames.map((f) => f.type), ['refuse']);
    assert.deepEqual(reg2.snapshot(), [], 'the released worker did not come back as ready');
  } finally { await reg2.closeAll(); }
});

test('a backend that fails to start a worker makes acquire reject with a network-class error', async () => {
  const b = { async start() { throw new Error('no image'); }, async remove() {}, async listWorkers() { return []; }, describe() { return {}; } };
  const reg2 = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, log: () => {} });
  await reg2.listen();
  try {
    const err = await reg2.acquire({ kind: 'run', id: 'x' }).then(() => null, (e) => e);
    assert.match(err.message, /cannot start a worker for run:x: no image/);
    assert.equal(err.errorClass, 'network');
    assert.deepEqual(reg2.snapshot(), []);
  } finally { await reg2.closeAll(); }
});

test('a lost controller ends the children as a stop does: SIGTERM first, so an engine can finish its writes', POSIX, async () => {
  const marker = join(tmp(), 'got-term');
  const s = await registry.acquire(RUN);
  const handle = backend.started.at(-1);
  const p = inRun(() => superviseSpawn(base({ file: script(`trap 'echo term > "${marker}"; exit 0' TERM; echo up; while :; do sleep 0.05; done`), args: [] }))).then(() => null, (e) => e);
  await new Promise((r) => setTimeout(r, 250));
  s.terminate('controller gone');
  assert.equal((await p).code, 'EWORKERLOST');
  assert.equal(await handle.done, 1);
  assert.equal(existsSync(marker), true, 'the child saw SIGTERM and wrote before it went');
});

test("with one image for every engine the run's only worker is its own, whichever spawn started it", async () => {
  const b = createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS });
  b.classFor = async () => 'reg/worca-worker:1-all';
  const r = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, pingMs: 200, helperIdleMs: 100, log: () => {} });
  await r.listen();
  try {
    const scope = { kind: 'run', id: 'one-image', engine: 'codex' };
    const first = await r.acquire(scope, { engine: 'claude' });   // the run's title on Claude comes first
    await new Promise((res) => setTimeout(res, 500));
    assert.equal(b.live.length, 1, 'no helper timeout: the Codex steps that follow share this worker');
    assert.equal(await r.acquire(scope, { engine: 'codex' }), first);
    assert.equal(b.started.length, 1);
  } finally { await r.closeAll(); }
});

test('a worker whose start is reported late, after it connected, stays; a worker that said bye is not handed out again', async () => {
  const b = createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS });
  const inner = b.start.bind(b);
  // The backend's own wait for the container fails AFTER the worker has connected (a stalled watch, an Engine request
  // that timed out): the session is live and must not be torn down over it.
  b.start = async (o) => { const h = await inner(o); for (let i = 0; i < 200 && !o.connected(); i++) await new Promise((r) => setTimeout(r, 10)); throw new Error('watch stalled'); };
  const got = [];
  const r = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, pingMs: 200, chatIdleMs: 60_000, log: (m) => got.push(m) });
  await r.listen();
  try {
    const scope = { kind: 'chat', id: 'late-start' };
    const s = await r.acquire(scope);
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(s.closed, false, 'the live session survived the late error');
    assert.equal(r.snapshot().length, 1);
    assert.ok(got.some((l) => /is connected; its start reported late: watch stalled/.test(l)), got.join('\n'));
    assert.equal(await r.acquire(scope), s);
  } finally { await r.closeAll(); }
});

test("a worker that said bye is not handed out again: the next acquire waits for its close and starts afresh", async () => {
  const b = createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS });
  const r = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, pingMs: 200, chatIdleMs: 100, log: () => {} });
  await r.listen();
  try {
    const scope = { kind: 'chat', id: 'leaving' };
    const s = await r.acquire(scope);
    // The worker idles out by itself (bye, then close). Between the two the session is 'leaving'.
    for (let i = 0; i < 400 && !s.leaving && !s.closed; i++) await new Promise((res) => setTimeout(res, 2));
    assert.ok(s.leaving || s.closed, 'the worker left');
    const fresh = await r.acquire(scope);
    assert.notEqual(fresh, s, 'never the dying session');
    assert.equal(fresh.closed, false);
    assert.equal(b.started.length, 2);
  } finally { await r.closeAll(); }
});

test("a chat worker's own idle timer is a backstop: it fires well after the controller's moment, and its leave is logged as such", async () => {
  const b = createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS });
  const got = [];
  const r = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, pingMs: 200, chatIdleMs: 200, log: (m) => got.push(m) });
  await r.listen();
  try {
    const s = await r.acquire({ kind: 'chat', id: 'backstop' });
    const h = b.started.at(-1);
    await new Promise((res) => setTimeout(res, 250));
    assert.equal(s.closed, false, 'at the controller\'s idle moment the worker is still here: the controller releases, the worker does not race it');
    await h.done;
    for (let i = 0; i < 200 && !s.closed; i++) await new Promise((res) => setTimeout(res, 5));
    assert.equal(s.closeReason, 'bye');
    assert.ok(got.some((l) => /worker w-chat-\w+ for chat:backstop left: idle/.test(l)), got.join('\n'));
    assert.ok(!got.some((l) => /is gone: bye/.test(l)), 'a routine leave is not a loss');
  } finally { await r.closeAll(); }
});

test("an acquire parked on a leaving worker's close ends with the caller's abort", async () => {
  const b = createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS });
  const r = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, pingMs: 60_000, chatIdleMs: 60_000, log: () => {} });
  await r.listen();
  try {
    const scope = { kind: 'chat', id: 'half-open' };
    const s = await r.acquire(scope);
    // The worker says bye, but its close never arrives (a half-open socket): the session is 'leaving' for good.
    Object.defineProperty(s, 'leaving', { get: () => true });
    const ctl = new AbortController();
    const t0 = Date.now();
    const p = r.acquire(scope, { signal: ctl.signal }).then(() => null, (e) => e);
    setTimeout(() => ctl.abort(), 100);
    const err = await p;
    assert.equal(err?.name, 'AbortError');
    assert.ok(Date.now() - t0 < 5000, 'the stop was not held until the ping timeout');
  } finally { await r.closeAll(); }
});

test("a close that cut a live step tells its listeners so: a bye then is a loss, not an idle leave", () => {
  // The session's own contract (the registry logs and removes by it): the execs are gone by the time the close
  // listeners run, so the fact that a step was live travels with the reason.
  const sock = Object.assign(new EventEmitter(), { send() {}, terminate() {}, close() {}, ping() {}, readyState: 1 });
  const s = createWorkerSession(sock, { workerId: 'w-unit', scope: { kind: 'run', id: 'u' }, capabilities: CAPS, pid: 1, pingMs: 60_000 });
  const seen = [];
  s.onClose((reason, info) => seen.push([reason, info]));
  let lost = null;
  s.exec({ file: 'sleep', args: ['30'], cwd: null, env: {}, stdin: null }, { onStarted() {}, onLines() {}, onSpawnError() {}, onExit() {}, onLost: (why) => { lost = why; } });
  sock.emit('message', JSON.stringify({ type: 'bye' }));
  sock.emit('close', 1000, Buffer.from('idle'));
  assert.equal(lost, 'bye');
  assert.deepEqual(seen, [['bye', { hadExecs: true }]]);
  const quiet = Object.assign(new EventEmitter(), { send() {}, terminate() {}, close() {}, ping() {}, readyState: 1 });
  const s2 = createWorkerSession(quiet, { workerId: 'w-unit2', scope: { kind: 'chat', id: 'u' }, capabilities: CAPS, pid: 1, pingMs: 60_000 });
  const seen2 = [];
  s2.onClose((reason, info) => seen2.push([reason, info]));
  quiet.emit('message', JSON.stringify({ type: 'bye' }));
  quiet.emit('close', 1000, Buffer.from('idle'));
  assert.deepEqual(seen2, [['bye', { hadExecs: false }]], 'an idle leave');
});

test('one release per entry; a welcome that cannot be sent fails the start at once; an IPv6 listener is bracketed', async () => {
  const b = createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS });
  const removed = [];
  const inner = b.remove.bind(b);
  b.remove = async (h, o) => { removed.push(h.workerId); return inner(h, o); };
  const r = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, pingMs: 200, chatIdleMs: 60_000, log: () => {} });
  await r.listen();
  try {
    const scope = { kind: 'chat', id: 'twice' };
    await r.acquire(scope);
    await Promise.all([r.release(scope, { reason: 'a' }), r.release(scope, { reason: 'b' }), r.sweep()]);
    assert.deepEqual(removed.length, 1, 'the sweep, an eviction and a release meeting on one entry remove it once');
  } finally { await r.closeAll(); }
  // A welcome the socket refuses (a pingMs no frame can carry): the token is spent, so the start fails now, not after the timeout.
  const r2 = createWorkerRegistry({ backend: createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS }), host: '127.0.0.1', port: 0, startTimeoutMs: 20_000, pingMs: 200.5, log: () => {} });
  await r2.listen();
  try {
    const t0 = Date.now();
    const err = await r2.acquire({ kind: 'run', id: 'bad-welcome' }).then(() => null, (e) => e);
    assert.match(err?.message || '', /the welcome could not be sent/);
    assert.ok(Date.now() - t0 < 10_000);
  } finally { await r2.closeAll(); }
  const r3 = createWorkerRegistry({ backend: createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS }), host: '::1', port: 0, log: () => {} });
  try { await r3.listen(); assert.match(r3.controllerUrl, /^ws:\/\/\[::1\]:\d+$/); } catch (e) { if (!/EADDRNOTAVAIL|EAFNOSUPPORT/.test(String(e?.code || e))) throw e; } finally { await r3.closeAll(); }
});

test('a worker stopped from outside while a step runs is a lost worker, so the run retries it; with nothing running it is a leave', POSIX, async () => {
  const b = createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS });
  const got = [];
  const r = createWorkerRegistry({ backend: b, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, pingMs: 200, log: (m) => got.push(m) });
  await r.listen();
  installExecutor({ kind: 'docker', registry: r });
  try {
    const scope = { kind: 'run', id: 'evicted' };
    await r.acquire(scope);
    const p = withExecutorScope(scope, () => superviseSpawn(base({ file: script('echo up; sleep 30'), args: [] }))).then(() => null, (e) => e);
    await new Promise((res) => setTimeout(res, 200));
    await b.live[0].worker.leave(300, { cut: true });   // the pod is evicted, `docker stop`: SIGTERM to the worker
    const err = await p;
    assert.equal(err?.code, 'EWORKERLOST', 'not "exited with SIGTERM": the failure policy retries on a fresh worker');
    for (let i = 0; i < 100 && !got.some((l) => /evicted is gone/.test(l)); i++) await new Promise((res) => setTimeout(res, 10));
    assert.ok(got.some((l) => /run:evicted is gone/.test(l)), got.join('\n'));
    // Nothing running: an orderly leave.
    const s2 = await r.acquire({ kind: 'run', id: 'quiet' });
    await b.live.find((h) => h.scopeKey === 'run:quiet').worker.leave(300, { cut: true });
    for (let i = 0; i < 100 && !s2.closed; i++) await new Promise((res) => setTimeout(res, 10));
    assert.equal(s2.closeReason, 'bye');
  } finally { installExecutor(registry ? { kind: 'docker', registry } : null); await r.closeAll(); }
});

test('a frame on a socket that is no longer open fails at once rather than being dropped', () => {
  const sock = Object.assign(new EventEmitter(), { send() {}, terminate() {}, close() {}, ping() {}, readyState: 2 });   // CLOSING
  const s = createWorkerSession(sock, { workerId: 'w-closing', scope: { kind: 'run', id: 'c' }, capabilities: CAPS, pid: 1, pingMs: 60_000 });
  let failed = null;
  s.exec({ file: 'sh', args: [], cwd: null, env: {}, stdin: null }, { onStarted() {}, onLines() {}, onSpawnError: (e) => { failed = e; }, onExit() {}, onLost() {} });
  return new Promise((resolve) => queueMicrotask(() => { assert.equal(failed?.code, 'EWORKERLOST'); assert.match(failed.message, /socket is not open/); resolve(); }));
});
