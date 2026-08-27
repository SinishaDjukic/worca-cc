# PR-361 Chat-Connectivity Review Fixes — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **v2 provenance:** refined from v1 by five independent max-effort review agents (anchor fact-check; executed TDD dry-runs of every snippet on live clones, core + plugins; design adjudication; finding re-verification). Every test snippet below was executed red→green against clones of `feat/chat-connectivity` across two waves (initial dry-run, then a re-execution of every v2-revised snippet with its corrections folded back in); the mutation table in Task 22 lists the deliberate-break checks that were run, and the two clone suites finished `npm test` with zero failures beyond the 4 pre-existing imagegen ones (2390/2386/4 core half, 2385/2381/4 plugins half). All 23 findings were re-confirmed against the working tree (none refuted); six had their scope corrected in place (T3, T7, T8, T11, T15, T18).

**Goal:** Fix all 15 reported + 7 overflow confirmed findings from the adversarial review of PR #361 (chat connectivity), on branch `feat/chat-connectivity`, without changing the feature's external contracts.

**Architecture:** Fixes cluster into 5 phases: (1) channel-supervisor/child lifecycle semantics, (2) vendored plugin lib + mention-injection hardening, (3) command-router/server correctness, (4) Teams JWT + gateway + CLI, (5) full verification. Every fix is TDD'd into the existing `node:test` suites; vendored-lib edits go through the telegram-chat canon and are recopied byte-identically (drift test enforces).

**Tech Stack:** Node ≥22 ESM, `node:test` + `node:assert/strict`, express+ws only (no new deps), vanilla DOM UI.

## Agent-model strategy (user requirement)

Dispatch each task to a fresh subagent via the Agent tool with an explicit model override. The session runs at **max effort**, which subagents inherit — so `model: "fable"` ⇒ Fable 5 max, `model: "opus"` ⇒ Opus 5 max.

| Model | Tasks | Why |
|---|---|---|
| **fable-5 (max)** | T1, T2, T3, T4, T14, T15, T16, T17, T18, T21 | Cross-cutting semantics (supervisor lifecycle, serialization, core artifacts, resume guard-chain extraction, /answer contract design, JWT security) — judgment-heavy, regression-prone (T21: the `owner`-socket closure subtlety is judgment-tier — the dry-run proved the naive version insufficient) |
| **opus-5 (max)** | T5–T13, T19, T20, T22 | Fully specified mechanical fixes with exact code in this plan |

**Per-task review gate:** after each task's subagent finishes, dispatch a reviewer subagent (spec + diff). **Reviewer tier follows implementer tier**: fable-implemented tasks (T1–T4, T14–T18, T21) get a fable reviewer; opus-implemented tasks get an opus reviewer. End-of-phase reviews are fable.

**Parallelism map** (only with worktree isolation; otherwise run in numeric order):
- Phase 1 (T1→T2→T3→T4) serial — all touch `channel-host.mjs`/worker starts.
- Phase 2 (T5→T6→T7→T8) serial — shared vendored lib canon.
- Phase 3 (T9→T13 serial: same router/server files; then T14→T17 serial).
- Phase 4: {T18→T19} serial in ONE worktree (both append to `test/teams-chat-worker.test.mjs`, and T18 edits its shared `jwksFetch` fixture). T20 depends on Phase 1 (touches `channel-host.mjs`). **T21 is NOT parallel-safe**: it appends to `test/discord-chat-worker.test.mjs`, which T3 and T5 also append to — run it after T5 in numeric order (or accept a manual test-file merge).
- T22 strictly last, on the merged tree.
- **Every fresh worktree runs `npm ci` before any `node --test`** — without it the suite fails bogusly on missing `express` and the failures are meaningless.

## Global Constraints

- Runtime deps stay **express + ws only** — add no packages.
- Vendored-lib rule: edit the canon `examples/plugins/telegram-chat/lib/*.mjs`, then recopy byte-identically to `slack-chat`, `discord-chat`, `teams-chat`; `test/chat-lib-drift.test.mjs` must pass in every commit. Recopy command (run from repo root):
  `for p in slack-chat discord-chat teams-chat; do cp examples/plugins/telegram-chat/lib/*.mjs examples/plugins/$p/lib/; done`
- Test runner: `node --test <files>`; full suite `npm test`.
- Suite baseline: 2288 tests, exactly 4 pre-existing failures allowed (`skills-bundle` / `skills-gate-wiring` expecting `skills/imagegen/`). **Zero new failures.**
- Fresh checkout/worktree: run `npm ci` first (see parallelism note) — missing dev deps produce fake failures unrelated to your change.
- All 4 plugins must pass `node src/cli/worca-cc.mjs plugin validate ./examples/plugins/<p> --strict` at the end of any task touching `examples/plugins/`.
- **Never `console.log` in worker/child code paths** — stdout is protocol-reserved; use `ctx.log`.
  T22 verifies this with `grep -rn "console\.log(" src/core/chat examples/plugins/*/channel examples/plugins/*/lib` (expected: no hits — the paren form deliberately excludes the child's intentional `console.log = to('info')` shim at `channel-worker-child.mjs:39`).
- Branch `feat/chat-connectivity`. Conventional commits `fix(chat): …`, each ending with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Do NOT `git add docs/` — plans stay untracked.
- Wire-protocol frames (`hello/send/webhook/config/ping/shutdown` ↔ `ready/status/inbound/send-result/webhook-result/state-delta/pong/log`) must stay backward compatible — additive changes only.

---

## Phase 1 — Supervisor & child lifecycle (fable-5 max)

### Task 1: Injectable spawn + `proc.on('error')` recovery in channel-host

**Findings:** #1 (missing error listener can crash the whole server; `checkChannel` stdin EPIPE).

**Files:**
- Modify: `src/core/chat/channel-host.mjs` (spawnWorker ~line 221–301, checkChannel ~line 475–505, createChannelHost signature ~line 111)
- Test: `test/channel-host.test.mjs` (append)

**Interfaces:**
- Consumes: existing `createChannelHost({logger, onInbound, onStatus})`.
- Produces: `createChannelHost({logger, onInbound, onStatus, _spawn, _backoffMs, _healthyAfterMs})` — `_spawn(cmd, args, opts)` defaults to `node:child_process.spawn`; `_backoffMs` defaults to `RESTART_BACKOFF_MS`; `_healthyAfterMs` defaults to `HEALTHY_AFTER_MS` (T2's forgiveness tests need it). Exit handling extracted as a per-spawn `onExit(code, signal)` closure that is idempotent (`if (w.proc !== proc) return`) — the guard MUST be the first statement: everything it would touch (pingTimer, outQueue, pending, consecutiveFailures) lives on the worker RECORD, and a stale duplicate run would clobber the replacement proc's state.

- [ ] **Step 1: Write the failing test** — append to `test/channel-host.test.mjs`:

```js
// Shared fake-proc harness — T2 and T4 reuse it; define ONCE at the top of the
// new test section. The host wraps proc.stdout in readline (createInterface at
// channel-host.mjs:236), so stdout/stderr MUST be real streams (PassThrough) —
// a bare EventEmitter throws `input.resume is not a function`. kill() must emit
// 'exit', or host.stop() waits the full 5 s SHUTDOWN_GRACE_MS per worker.
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

function makeFakeProc({ backpressure = false, spawnFailed = false } = {}) {
  const p = new EventEmitter();
  p.pid = spawnFailed ? undefined : 12345;
  p.killed = false;
  p.exitCode = null;
  p.stdout = new PassThrough();
  p.stderr = new PassThrough();
  p.stdin = Object.assign(new EventEmitter(), {
    written: [],
    write(chunk) { this.written.push(String(chunk)); return !backpressure; },
  });
  p.kill = (sig) => {
    if (p.killed) return true;
    p.killed = true;
    p.exitCode = 0;
    queueMicrotask(() => p.emit('exit', 0, sig || 'SIGKILL'));
    return true;
  };
  return p;
}

/** Fake-spawn host over the discovery fixture (installFixture() registers
 *  fixture-chat/main). Returns {host, spawned, logs}. */
function makeFakeHost({ backoffMs = [10, 10, 10, 10], healthyAfterMs, procOpts } = {}) {
  installFixture();
  const spawned = [];
  const logs = [];
  const host = createChannelHost({
    logger: (level, msg) => logs.push({ level, msg }),
    _backoffMs: backoffMs,
    ...(healthyAfterMs ? { _healthyAfterMs: healthyAfterMs } : {}),
    _spawn: () => { const p = makeFakeProc(procOpts); spawned.push(p); return p; },
  });
  return { host, spawned, logs };
}
const endWorkers = (spawned) => { for (const p of spawned) if (!p.killed && p.exitCode === null) p.emit('exit', 0, null); };
const MSG = { title: null, body: [], severity: 'info' }; // minimal valid NormalizedMessage (T4 reuses it)

test('a spawn "error" event never throws out of the host and schedules recovery', async () => {
  const { host, spawned } = makeFakeHost({ procOpts: { spawnFailed: true } });
  host.start();
  assert.equal(spawned.length, 1);
  spawned[0].emit('error', Object.assign(new Error('spawn EMFILE'), { code: 'EMFILE' }));
  // Read the badge SYNCHRONOUSLY: the 10ms-backoff respawn calls
  // setStatus('connecting', null), which wipes the detail again.
  assert.match(host.status()[0].detail || '', /EMFILE/, 'spawn error text reaches the badge detail');
  await new Promise((r) => setTimeout(r, 50)); // > 10ms backoff → respawn happened
  assert.ok(spawned.length >= 2, 'error event routed into the restart path');
  assert.notEqual(host.status()[0].state, 'connected');
  endWorkers(spawned);
  await host.stop();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/channel-host.test.mjs`
Expected: FAIL — without `_spawn` support the host spawns a REAL child (`spawned.length` stays 0); once injection exists but the error listener does not, the `'error'` emit is an unhandled EventEmitter throw. Either failure is the red phase.

- [ ] **Step 3: Implement** in `src/core/chat/channel-host.mjs`:

```js
// signature + defaults
export function createChannelHost({ logger, onInbound, onStatus, _spawn = spawn, _backoffMs = RESTART_BACKOFF_MS, _healthyAfterMs = HEALTHY_AFTER_MS } = {}) {
```

Replace both `spawn(` call sites with `_spawn(` (spawnWorker + checkChannel); replace the single indexing read `RESTART_BACKOFF_MS[Math.min(...)]` (line 278) with `_backoffMs[...]` and its `.length` in the same expression with `_backoffMs.length`; replace the `HEALTHY_AFTER_MS` read in the exit handler with `_healthyAfterMs`. Then in `spawnWorker`, extract the current `proc.on('exit', …)` body into a named closure and add the error listener (the guard is FIRST — see Interfaces):

```js
    const onExit = (code, signal) => {
      if (w.proc !== proc) return;            // stale duplicate: error path ran, or a respawn happened
      clearInterval(w.pingTimer);
      w.proc = null;
      /* …existing exit-handler body unchanged from here down, with TWO edits:
         (1) the detail line becomes:
             const detail = w.spawnErrorDetail || stderrTail.trim().split('\n').pop() || `exit ${signal || code}`;
             w.spawnErrorDetail = null;
         (2) HEALTHY_AFTER_MS → _healthyAfterMs … */
    };
    proc.on('exit', onExit);
    // Async spawn/pipe failures (EMFILE, EAGAIN) must never become an unhandled
    // 'error' on the child. If spawn failed outright (no pid), 'exit' will never
    // fire — stash the real error text (stderrTail is empty on this path, so the
    // badge would otherwise show a useless "exit -1") and route into recovery.
    proc.on('error', (err) => {
      const msg = w.redact(err?.message || String(err));
      log('error', `[chat:${w.key}] worker process error: ${msg}`);
      if (proc.pid) { try { proc.kill('SIGKILL'); } catch { /* gone */ } }
      else { w.spawnErrorDetail = msg; onExit(-1, null); }
    });
```

Add `spawnErrorDetail: null,` to `makeRecord`. In `checkChannel`, add the same guards around the one-shot child (this child has NO stdin error listener today and its stdin.write at line 494 is un-try'd):

```js
        proc.on('error', (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          rejectCheck(new PluginOpError('plugin', `validateConfig child failed: ${err?.message || err}`));
        });
        proc.stdin.on('error', () => { /* EPIPE on dying child: exit/error handlers own it */ });
        try {
          proc.stdin.write(encodeFrame({ /* …existing hello object unchanged… */ }));
        } catch { /* dying child: handlers above settle the promise */ }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/channel-host.test.mjs`
Expected: PASS (all existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/core/chat/channel-host.mjs test/channel-host.test.mjs
git commit -m "fix(chat): handle child 'error' events in the channel supervisor

An async spawn failure (EMFILE/EAGAIN) emitted an unhandled 'error' and
killed the whole UI server; checkChannel's stdin.write could EPIPE the
same way. spawn/backoff are now injectable for tests.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2: `ready` must not mask worker status, must not reset backoff

**Findings:** #2 (auth-failed channel shown green "connected"), #5 (ready zeroes consecutiveFailures → eternal 1s restart loop).

**Files:**
- Modify: `src/core/chat/channel-host.mjs` (`handleFrame` 'ready'/'status' cases ~line 181–191; `spawnWorker` ~line 229; `makeRecord` ~line 303)
- Test: `test/channel-host.test.mjs` (append; uses T1's `_spawn`/`_backoffMs` injection)

**Interfaces:**
- Consumes: T1's `_spawn`/`_backoffMs`/`_healthyAfterMs` + fake-proc harness, `onExit` idempotence.
- Produces: worker record gains `statusSinceSpawn: boolean` (reset false in `spawnWorker`, set true on any worker `status` frame). `healthySince` moves INTO `setStatus`, stamped only on a transition to `connected`. Protocol unchanged. **Contract note (document in the channel-worker doc comment):** a worker that emits any `status` frame before `ready` will NOT be flipped to `connected` by that `ready` — the documented no-throw auth-failure pattern relies on this; third-party workers that self-report `connected` are unaffected (their own status frame does it).

- [ ] **Step 1: Write the failing tests** — append to `test/channel-host.test.mjs`, reusing T1's `makeFakeHost`/`makeFakeProc` harness (its `p.stdout` is already a `PassThrough`, which is exactly what the host's readline wrapper needs — write protocol lines straight to it):

```js
// Uses T1's makeFakeHost/makeFakeProc. Worker frames go in via p.stdout.write(line).
const frameLine = (obj) => JSON.stringify(obj) + '\n';

test('ready after a worker "disconnected" status keeps the channel disconnected', async () => {
  const { host, spawned } = makeFakeHost();
  host.start();
  const p = spawned[0];
  p.stdout.write(frameLine({ type: 'status', state: 'disconnected', detail: 'auth failed — check botToken' }));
  p.stdout.write(frameLine({ type: 'ready', identity: null }));
  await new Promise((r) => setTimeout(r, 20));
  const row = host.status()[0];
  assert.equal(row.state, 'disconnected');
  assert.match(row.detail, /auth failed/);
  endWorkers(spawned);
  await host.stop();
});

test('ready alone still flips a fresh worker to connected', async () => {
  const { host, spawned } = makeFakeHost();
  host.start();
  spawned[0].stdout.write(frameLine({ type: 'ready', identity: '@bot' }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(host.status()[0].state, 'connected');
  endWorkers(spawned);
  await host.stop();
});

test('a connect-then-crash worker escalates backoff instead of looping at the floor', async () => {
  // Assert on the logged restart delays — deterministic; timestamp spreads are flaky.
  const { host, spawned, logs } = makeFakeHost({ backoffMs: [10, 40, 40, 40] });
  host.start();
  for (let i = 0; i < 3; i++) {
    const p = spawned[i];
    p.stdout.write(frameLine({ type: 'ready', identity: '@bot' }));
    await new Promise((r) => setTimeout(r, 5));
    p.emit('exit', 1, null);
    await new Promise((r) => setTimeout(r, 60)); // let the restart timer fire
  }
  const delays = logs.map((l) => /restart in (\d+)ms/.exec(l.msg)).filter(Boolean).map((m) => Number(m[1]));
  assert.deepEqual(delays.slice(0, 3), [10, 40, 40], 'ready must not reset the failure counter');
  endWorkers(spawned);
  await host.stop();
});

test('a masked ready must not buy HEALTHY_AFTER_MS forgiveness', async () => {
  // status:disconnected → ready (masked) → outlive _healthyAfterMs → crash twice:
  // the second restart must escalate (forgiveness would keep it at the floor).
  const { host, spawned, logs } = makeFakeHost({ backoffMs: [10, 40, 40, 40], healthyAfterMs: 15 });
  host.start();
  for (let i = 0; i < 2; i++) {
    const p = spawned[i];
    p.stdout.write(frameLine({ type: 'status', state: 'disconnected', detail: 'auth failed' }));
    p.stdout.write(frameLine({ type: 'ready', identity: null }));
    await new Promise((r) => setTimeout(r, 30)); // > healthyAfterMs while "masked"
    p.emit('exit', 1, null);
    await new Promise((r) => setTimeout(r, 60));
  }
  const delays = logs.map((l) => /restart in (\d+)ms/.exec(l.msg)).filter(Boolean).map((m) => Number(m[1]));
  assert.deepEqual(delays.slice(0, 2), [10, 40], 'masked ready stamped healthySince — finding #5 is back');
  endWorkers(spawned);
  await host.stop();
});
```

- [ ] **Step 2: Run to verify both behaviors fail** (`state === 'connected'` after auth-fail; all restarts at floor delay).

Run: `node --test test/channel-host.test.mjs`

- [ ] **Step 3: Implement.** In `setStatus` (stamp on the transition — covers ready-driven AND worker-self-reported `connected` in one place):

```js
  const setStatus = (w, state, detail = null) => {
    const red = detail == null ? null : w.redact(detail);
    if (w.state === state && w.detail === red) return;
    // healthySince = when we last BELIEVED this worker connected. Stamped on the
    // transition only, so a masked 'ready' (worker already said disconnected)
    // can never buy the exit handler's forgiveness.
    if (state === 'connected' && w.state !== 'connected') w.healthySince = Date.now();
    w.state = state;
    w.detail = red;
    try { onStatus?.({ plugin: w.entry.plugin, channelId: w.entry.channelId, platform: w.entry.platform, state, detail: red }); }
    catch { /* listener faults never reach the supervisor */ }
  };
```

In `handleFrame`:

```js
      case 'ready':
        w.identity = frame.identity ?? null;
        // NOT w.consecutiveFailures = 0 — the exit handler already forgives a
        // crash after _healthyAfterMs of health; zeroing here let a
        // connect-then-crash worker restart at the 1s floor forever (finding #5).
        // NOT w.healthySince here either — setStatus stamps it on the real
        // transition, so a masked ready cannot buy forgiveness.
        // 'ready' is optimistic: it only claims 'connected' when the worker has
        // not already reported its own state this spawn (the documented no-throw
        // auth-failure pattern emits 'disconnected' BEFORE ready — finding #2).
        if (!w.statusSinceSpawn) setStatus(w, 'connected', null);
        break;
      case 'status':
        w.statusSinceSpawn = true;
        setStatus(w, frame.state, frame.detail ?? null);
        break;
```

In `spawnWorker` (right after `w.spawnedAt = Date.now();`, line 229): `w.statusSinceSpawn = false;`
In `makeRecord`: add `statusSinceSpawn: false,`.
Before implementing, `grep -rn "'connected'" test/` for existing assertions that expect a worker to be green immediately after `ready` — the mock-mode e2e path sets state directly and is unaffected, but any future fixture emitting `status` before `ready` changes behavior by design.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/channel-host.test.mjs && node --test test/chat-inbound-e2e.test.mjs`
Expected: PASS (mock-mode path in e2e sets state directly, unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/core/chat/channel-host.mjs test/channel-host.test.mjs
git commit -m "fix(chat): ready frame no longer masks worker status or resets backoff

A worker that reported 'disconnected: auth failed' before ready was
flipped to green 'connected' forever; ready also zeroed the failure
counter so connect-then-crash workers restarted at the 1s floor
indefinitely and could never reach the 'failed' state.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3: Transient start() failures must crash-restart, not permanently kill the channel

**Findings:** #6 (slack `auth.test` transient 429/5xx treated as a permanent "check botToken" degrade; discord `/gateway/bot` transient failures permanent). Re-verified nuance: a non-401 `/users/@me` failure today is *silently ignored* — `me = {}` ⇒ `selfId = null` ⇒ the worker reports **connected** and stops filtering its own messages (`worker.mjs:69`) → echo-loop risk. The fix must close that too.

**Files:**
- Modify: `examples/plugins/slack-chat/channel/worker.mjs:132-142`
- Modify: `examples/plugins/discord-chat/channel/worker.mjs:33-57`
- Test: `test/slack-chat-worker.test.mjs`, `test/discord-chat-worker.test.mjs` (append)

**Interfaces:**
- Consumes: child contract — `start()` throw ⇒ child exit 1 ⇒ supervisor backoff restart (channel-worker-child.mjs:127-133); no-throw + `setStatus('disconnected')` ⇒ permanent until config reload (reserved for definitive auth failures).
- Produces: unchanged worker API.

- [ ] **Step 1: Write the failing tests:**

```js
// slack-chat-worker.test.mjs — fixture: fakeCtx(config) → { ctx, events }; statuses land in events.status
test('start(): transient auth.test failure (5xx/429) throws so the supervisor restarts', async () => {
  const { ctx } = fakeCtx();
  const w = createSlackWorker(ctx, { fetchFn: async () => ({ status: 503, ok: false, headers: { get: () => null }, json: async () => ({}) }) });
  await assert.rejects(() => w.start(), /auth\.test failed/);
});
test('start(): definitive invalid_auth still degrades without throwing', async () => {
  const { ctx, events } = fakeCtx();
  const w = createSlackWorker(ctx, { fetchFn: async () => ({ status: 200, ok: true, json: async () => ({ ok: false, error: 'invalid_auth' }) }) });
  const r = await w.start();
  assert.equal(r.identity, null);
  assert.equal(events.status.at(-1).state, 'disconnected');
});

// discord-chat-worker.test.mjs — fixture: workerCtx(config) → { ctx, events }
test('start(): /gateway/bot 502 throws (supervisor retries)', async () => {
  const fetchFn = async (url) => {
    if (/users\/@me/.test(url)) return { status: 200, ok: true, json: async () => ({ id: '1', username: 'bot' }) };
    if (/gateway\/bot/.test(url)) return { status: 502, ok: false, json: async () => ({}) };
    throw new Error(`unexpected ${url}`);
  };
  const w = createDiscordWorker(workerCtx().ctx, { fetchFn, WebSocketImpl: FakeWebSocket });
  await assert.rejects(() => w.start(), /gateway\/bot failed/);
});
test('start(): 401 on /users/@me does NOT throw (definitive degrade)', async () => {
  const { ctx, events } = workerCtx();
  const w = createDiscordWorker(ctx, { fetchFn: async () => ({ status: 401, ok: false, json: async () => ({}) }), WebSocketImpl: FakeWebSocket });
  const r = await w.start();
  assert.equal(r.identity, null);
  assert.equal(events.status.at(-1).state, 'disconnected');
});
test('start(): a non-401 /users/@me failure throws and is not relabelled "network error"', async () => {
  const { ctx, events } = workerCtx();
  const w = createDiscordWorker(ctx, { fetchFn: async () => ({ status: 503, ok: false, json: async () => ({}) }), WebSocketImpl: FakeWebSocket });
  await assert.rejects(() => w.start(), /users\/@me failed: HTTP 503/);
  assert.ok(!/network error/.test(events.status.at(-1)?.detail || ''), 'HTTP failure must not be relabelled "network error"');
});
```

- [ ] **Step 2: Run to verify they fail** (`start()` currently resolves).

- [ ] **Step 3: Implement.** Slack `start()`:

```js
    async start() {
      running = true;
      const auth = await slackApi(fetchFn, 'auth.test', botToken, null, ctx.shutdownSignal);
      if (!auth.ok) {
        // Definitive, restart-cannot-help auth.test errors (matches + extends the send() list):
        const FATAL_AUTH = new Set(['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked',
          'token_expired', 'not_allowed_token_type', 'no_permission', 'org_login_required',
          'ekm_access_denied', 'two_factor_setup_required', 'enterprise_is_restricted']);
        const fatal = FATAL_AUTH.has(auth.error);
        const detail = `auth.test failed: ${auth.error || `HTTP ${auth.httpStatus}`}`;
        if (fatal) { setStatus('disconnected', `${detail} — check botToken`); return { identity: null }; }
        // Transient (429/5xx/network-ish): crash so the supervisor restarts with backoff.
        throw Object.assign(new Error(detail), { kind: auth.httpStatus === 429 ? 'rate-limit' : 'network' });
      }
      /* …rest unchanged… */
```

Discord `start()` — the existing try/catch wraps the `/users/@me` fetch AND its json parse, and its catch already rethrows after `setStatus` (there is no "swallow" to drop — but a non-ok response never reaches it). Restructure: narrow the try to the `fetchFn` call only, hoist `let res;` above it, and move the 401 branch, the `res.json()`, and a new `!res.ok` throw BELOW the catch so HTTP failures are not relabelled `network error: …`:

```js
      let res;
      try {
        res = await fetchFn(`${DISCORD_API}/users/@me`, { headers: authHeaders, signal: ctx.shutdownSignal });
      } catch (err) {
        ctx.setStatus('disconnected', `network error: ${err?.message || err}`);
        throw err; // supervisor restarts with backoff
      }
      if (res.status === 401) {
        ctx.setStatus('disconnected', 'Discord rejected the bot token — check botToken');
        return { identity: null };
      }
      const me = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = `GET /users/@me failed: HTTP ${res.status}`;
        ctx.setStatus('disconnected', detail);
        throw Object.assign(new Error(detail), { kind: res.status === 429 ? 'rate-limit' : 'network' });
      }
      …
      const gw = await fetchFn(`${DISCORD_API}/gateway/bot`, { headers: authHeaders, signal: ctx.shutdownSignal });
      const gwData = await gw.json().catch(() => ({}));
      if (!gw.ok || !gwData.url) {
        const detail = `GET /gateway/bot failed: HTTP ${gw.status}`;
        ctx.setStatus('disconnected', detail);
        throw Object.assign(new Error(detail), { kind: gw.status === 429 ? 'rate-limit' : 'network' });
      }
      if (gwData.session_start_limit?.remaining === 0) {
        const detail = `gateway session limit exhausted — resets in ${Math.ceil((gwData.session_start_limit.reset_after || 0) / 60000)}min`;
        ctx.setStatus('disconnected', detail);
        throw Object.assign(new Error(detail), { kind: 'rate-limit' });
      }
```

Note (do not "fix" this): on throwing paths the worker's `ctx.setStatus` detail is best-effort — the child exits 1 and the supervisor's exit handler immediately supersedes the badge detail with the last stderr line (`worker start failed: …`, near-identical text). The pair is kept because it matches the existing idiom at `worker.mjs:43-44`. The `setStatus`+`return` (no-throw) paths are the load-bearing ones — that is where T2's `statusSinceSpawn` keeps the badge honest.

- [ ] **Step 4: Run tests**

Run: `node --test test/slack-chat-worker.test.mjs test/discord-chat-worker.test.mjs`
Expected: PASS.

- [ ] **Step 5: Validate plugins + commit**

```bash
for p in slack-chat discord-chat; do node src/cli/worca-cc.mjs plugin validate ./examples/plugins/$p --strict; done
git add examples/plugins/slack-chat/channel/worker.mjs examples/plugins/discord-chat/channel/worker.mjs test/slack-chat-worker.test.mjs test/discord-chat-worker.test.mjs
git commit -m "fix(chat): slack/discord transient start failures crash-restart instead of dying silently

One 502/429 at worker start permanently killed the channel (no connect
loop, no retry) with a misleading auth detail. Only definitive auth
failures keep the documented no-throw degrade path.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4: RPC-timeout dequeues the frame; child logs dropped oversize state-deltas

**Findings:** overflow (rpc timeout leaves frame queued → "failed" send can still deliver later; child `writeFrame` drops oversize state-delta silently).

**Files:**
- Modify: `src/core/chat/channel-host.mjs` (`rpc` ~line 360–372)
- Modify: `src/core/chat/channel-worker-child.mjs` (`writeFrame` ~line 27–29, `ctx.state.set` ~line 76)
- Test: `test/channel-host.test.mjs` (BOTH halves — `test/channel-protocol.test.mjs` is a pure unit test of the protocol module with no child spawning; the child-side test uses the real-spawn fixture worker with a magic chatId that writes an oversize state value)

**Interfaces:** none new; behavior only.

- [ ] **Step 1: Failing tests.**

Host half (T1 harness, permanent backpressure so frames queue):

```js
test('a timed-out RPC frame is dequeued — a later drain cannot deliver it', async () => {
  const { host, spawned } = makeFakeHost({ procOpts: { backpressure: true } });
  host.start();
  const p = spawned[0];
  p.stdout.write(JSON.stringify({ type: 'ready', identity: '@bot' }) + '\n');
  await new Promise((r) => setTimeout(r, 20));
  const before = p.stdin.written.length; // hello (+ possibly a ping) already queued/written
  await assert.rejects(
    () => host.sendMessage({ plugin: 'fixture-chat', channelId: 'main', chatId: 'A', message: MSG, timeoutMs: 30 }),
    (e) => e.kind === 'timeout');
  const second = host.sendMessage({ plugin: 'fixture-chat', channelId: 'main', chatId: 'B', message: MSG, timeoutMs: 5000 });
  p.stdin.write = function (chunk) { this.written.push(String(chunk)); return true; }; // lift backpressure
  p.stdin.emit('drain');
  await new Promise((r) => setTimeout(r, 20));
  const flushed = p.stdin.written.slice(before).join('');
  assert.ok(!flushed.includes('"chatId":"A"'), 'timed-out frame must not be delivered later');
  assert.ok(flushed.includes('"chatId":"B"'), 'live frames still flush');
  p.stdout.write(JSON.stringify({ type: 'send-result', id: JSON.parse(flushed.trim().split('\n').pop()).id, ok: true }) + '\n');
  await second;
  endWorkers(spawned);
  await host.stop();
});
```

Child half (append to the real-spawn fixture section of `test/channel-host.test.mjs`): extend the fixture WORKER source with a magic chatId —

```js
    if (chatId === 'BIGSTATE') { await ctx.state.set('big', 'x'.repeat(2 * 1024 * 1024)); return { ok: true }; }
```

then, using the real-spawn fixture's log-capturing host, `await host.sendMessage({ …, chatId: 'BIGSTATE', message: MSG })` and (a) `waitFor` a captured log line with level `warn` matching `/exceeds the 1 MiB frame cap/`, (b) assert `readPluginState(NAME).big === undefined` — the oversize delta must warn AND stay unpersisted (today it vanishes silently: `encodeFrame` throws at `channel-protocol.mjs:103-109` and the child's bare catch drops it).

- [ ] **Step 2: Run to verify it fails** (frame still flushed after timeout).

- [ ] **Step 3: Implement.** Host `rpc` timeout callback:

```js
    const timer = setTimeout(() => {
      w.pending.delete(frame.id);
      const qi = w.outQueue.findIndex((f) => f && f.id === frame.id);
      if (qi >= 0) w.outQueue.splice(qi, 1);   // NOT counted in w.dropped (that means queue overflow)
      rejectRpc(new PluginOpError(kindOnTimeout, `worker did not answer within ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
```

Child — make the drop visible:

```js
function writeFrame(frame) {
  try { process.stdout.write(encodeFrame(frame)); return true; }
  catch { return false; /* oversize/broken pipe */ }
}
```

and in `ctx.state.set`:

```js
      set: async (k, v) => {
        stateSnapshot[k] = v;
        if (!writeFrame({ type: 'state-delta', delta: { [k]: v } })) {
          writeFrame({ type: 'log', level: 'warn', msg: `state-delta for "${k}" exceeds the 1 MiB frame cap — not persisted` });
        }
      },
```

- [ ] **Step 4: Run tests**

Run: `node --test test/channel-host.test.mjs test/channel-protocol.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add src/core/chat/channel-host.mjs src/core/chat/channel-worker-child.mjs test/channel-host.test.mjs
git commit -m "fix(chat): timed-out RPC frames leave the outbound queue; oversize state-deltas warn

Scope note: the dequeue only helps while the frame is still QUEUED — a
frame already written to the pipe can still be delivered after the host
gave up. A late send-result for a deleted id is already a silent no-op
in handleFrame.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Phase 2 — Vendored lib & mention-injection hardening (opus-5 max)

### Task 5: Discord `allowed_mentions: {parse: []}`

**Finding:** #4 (@everyone/@here/user pings from run titles, errors, echoed input).

**Files:**
- Modify: `examples/plugins/discord-chat/channel/worker.mjs:101-103`
- Test: `test/discord-chat-worker.test.mjs` (append)

- [ ] **Step 1: Failing test:**

```js
test('send(): every message body disables mention parsing', async () => {
  const bodies = [];
  const w = createDiscordWorker(workerCtx().ctx, {
    fetchFn: async (url, opts) => { if (opts?.method === 'POST') bodies.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({}) }; },
  });
  await w.send('123', { title: null, body: [{ kind: 'text', value: 'hi @everyone <@42>' }], severity: 'info' });
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].allowed_mentions, { parse: [] });
});
```

- [ ] **Step 2: Run to verify it fails** (`allowed_mentions` undefined).
- [ ] **Step 3: Implement:**

```js
            res = await fetchFn(`${DISCORD_API}/channels/${chatId}/messages`, {
              method: 'POST', headers: authHeaders,
              // Notification/reply text embeds run titles, error strings and
              // echoed user input — never let Discord parse mentions out of it.
              body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
            });
```

- [ ] **Step 4:** `node --test test/discord-chat-worker.test.mjs` → PASS.
- [ ] **Step 5: Commit**

```bash
git add examples/plugins/discord-chat/channel/worker.mjs test/discord-chat-worker.test.mjs
git commit -m "fix(chat): discord sends disable mention parsing (allowed_mentions parse:[])

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 6: Slack output escaping (`&`, `<`, `>`)

**Finding:** #3 (`<!channel>` injection; `<...>` consumed by Slack).

**Files:**
- Modify (canon): `examples/plugins/telegram-chat/lib/markdown.mjs` (add + use `escapeSlackText`, export it), `examples/plugins/telegram-chat/lib/segments.mjs` (SLACK_STYLE)
- Recopy: same two files into slack/discord/teams `lib/`
- Test: `test/slack-chat-worker.test.mjs`, `test/chat-lib-drift.test.mjs`

**Interfaces:**
- Produces: `markdown.mjs` exports `escapeSlackText(text)`; `segments.mjs` imports it. (`segments.mjs` already imports from `./markdown.mjs` — same direction, no cycle.)

- [ ] **Step 1: Failing tests** (append to `test/slack-chat-worker.test.mjs`):

```js
test('mrkdwn render escapes Slack control sequences in every segment kind', () => {
  const msg = { title: 'a <!channel> title', severity: 'info', body: [
    { kind: 'text', value: '<!here> & <void>' },
    { kind: 'bold', value: '<b>' },
    { kind: 'code', value: 'x < y' },
    { kind: 'code_block', value: 'a & b' },
    { kind: 'link', value: '<label>', href: 'https://x.test/?a=1&b=2' },
    { kind: 'markdown', value: 'plain <!channel> and `code <kept>`' },
  ]};
  const out = renderToMrkdwn(msg);
  assert.ok(!/<!channel>/.test(out), 'raw <!channel> must not survive');
  assert.match(out, /&lt;!here&gt; &amp; &lt;void&gt;/);
  assert.match(out, /\*&lt;b&gt;\*/);
  assert.match(out, /`x &lt; y`/);
  assert.match(out, /a &amp; b/);
  assert.match(out, /<https:\/\/x\.test\/\?a=1&amp;b=2\|&lt;label&gt;>/);
});
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement.** In canon `markdown.mjs` add near the top and export:

```js
/**
 * Slack mrkdwn requires &, <, > escaped in ALL text (they delimit links and
 * control sequences like <!channel>); everything else passes through.
 */
export function escapeSlackText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
```

In `toSlackMrkdwn` (~line 143), apply `escapeSlackText` inside `processWithCodeProtection`'s three channels — but on the transformText **input**, as the FIRST statement of the callback, before link/bold/italic/strike conversion. The transform *produces* Slack control syntax (`[text](url)` → `<url|label>`); escaping its result would corrupt every link the function just emitted (this exact mistake turns `<https://x|pr>` into `&lt;https://x|pr&gt;` and breaks the pre-existing assertion at `test/slack-chat-worker.test.mjs:164`):

```js
    (text) => {
      // Escape FIRST: &,<,> are Slack control characters. This must happen
      // before we emit <url|label>, or we would escape our own link syntax.
      text = escapeSlackText(text);
      // Links: [text](url) → <url|text>   …existing transforms unchanged from here…
      return text;
    },
    (code) => `\`\`\`${escapeSlackText(code)}\`\`\``,
    (code) => `\`${escapeSlackText(code)}\``,
```

The `\x00PH…\x00` / `\x01B…\x01` protection markers contain no `&<>`, so escaping cannot corrupt them; `&` inside markdown-link hrefs becomes `&amp;`, matching the SLACK_STYLE.link rule.

In canon `segments.mjs` replace `SLACK_STYLE` with:

```js
import { toSlackMrkdwn, toTelegramHtml, escapeSlackText } from './markdown.mjs';

/** @type {SegmentStyle} Slack mrkdwn (all text escaped — <!channel> etc. are control sequences). */
export const SLACK_STYLE = {
  title: (t) => `*${escapeSlackText(t)}*\n`,
  markdown: (v) => toSlackMrkdwn(v),
  bold: (v) => `*${escapeSlackText(v)}*`,
  code: (v) => `\`${escapeSlackText(v)}\``,
  code_block: (v) => `\`\`\`\n${escapeSlackText(v)}\n\`\`\``,
  link: (v, seg) => `<${String(seg.href ?? '').replace(/&/g, '&amp;')}|${escapeSlackText(v)}>`,
  text: (v) => escapeSlackText(v),
};
```

- [ ] **Step 4: Recopy + run**

```bash
for p in slack-chat discord-chat teams-chat; do cp examples/plugins/telegram-chat/lib/*.mjs examples/plugins/$p/lib/; done
node --test test/slack-chat-worker.test.mjs test/chat-lib-drift.test.mjs test/telegram-chat-worker.test.mjs test/teams-chat-worker.test.mjs test/discord-chat-worker.test.mjs
for p in telegram-chat slack-chat discord-chat teams-chat; do node src/cli/worca-cc.mjs plugin validate ./examples/plugins/$p --strict; done
```

Expected: PASS. (Teams uses `toPlainText`, telegram uses `toTelegramHtml` — verify their tests still pass untouched.)

- [ ] **Step 5: Commit**

```bash
git add examples/plugins/*/lib/markdown.mjs examples/plugins/*/lib/segments.mjs test/slack-chat-worker.test.mjs
git commit -m "fix(chat): escape &,<,> in all Slack mrkdwn output — blocks <!channel> injection

Run titles, error text and echoed user input reached chat.postMessage raw,
so an allowlisted user could launder @channel/@here through the bot.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 7: `splitText` off-by-one + surrogate safety; Telegram plain-text fallback for split HTML

**Finding:** #12.

**Files:**
- Modify (canon): `examples/plugins/telegram-chat/lib/send-util.mjs:18-34` + recopy
- Modify: `examples/plugins/telegram-chat/channel/worker.mjs` (`send()` ~line 141–169)
- Test: `test/telegram-chat-worker.test.mjs` (append)

- [ ] **Step 1: Failing tests:**

```js
test('splitText never emits a chunk longer than limit (newline-at-limit off-by-one)', () => {
  const s = 'a'.repeat(10) + '\n' + 'b'.repeat(9); // newline at index 10 === limit → today [11, 9]
  for (const c of splitText(s, 10)) assert.ok(c.length <= 10, `chunk ${c.length} > 10`);
});
test('splitText never splits a surrogate pair', () => {
  const s = 'x'.repeat(9) + '😀' + 'y'.repeat(9); // pair straddles limit 10
  for (const c of splitText(s, 10)) assert.ok(c.isWellFormed(), 'ill-formed chunk');
});
test('send(): a "can\'t parse entities" 400 falls back to plain text instead of losing the message', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    if (!opts?.method) return { ok: true, status: 200, json: async () => ({ ok: true, result: { username: 'b' } }) };
    const body = JSON.parse(opts.body);
    calls.push(body);
    if (body.parse_mode === 'HTML') return { ok: false, status: 400, json: async () => ({ description: "Bad Request: can't parse entities" }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const w = createTelegramWorker(fakeCtx().ctx, { fetchFn, _sleep: async () => {} });
  const r = await w.send('7', { title: null, body: [{ kind: 'code_block', value: 'x' }], severity: 'info' });
  assert.equal(r.ok, true);
  assert.equal(calls.at(-1).parse_mode, undefined, 'fallback resend is plain text');
});
```

- [ ] **Step 2: Run to verify all three fail.**
- [ ] **Step 3: Implement.** Canon `send-util.mjs`:

```js
export function splitText(text, limit, { preferNewline = true } = {}) {
  const s = String(text ?? '');
  if (s.length <= limit) return [s];
  const chunks = [];
  let rest = s;
  while (rest.length > limit) {
    let cut = limit;
    if (preferNewline) {
      // limit-1: a newline AT index limit would make a limit+1-char chunk.
      const nl = rest.lastIndexOf('\n', limit - 1);
      if (nl > limit / 2) cut = nl + 1;
    }
    // Never cut between a surrogate pair (skip at cut===1: a 1-char budget
    // cannot hold a pair, and decrementing to 0 would loop forever).
    const cc = rest.charCodeAt(cut - 1);
    if (cc >= 0xd800 && cc <= 0xdbff && cut > 1) cut -= 1;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  chunks.push(rest);
  return chunks;
}
```

Telegram `worker.mjs` — add above `createTelegramWorker`:

```js
/** Rendered-HTML chunk -> plain text (fallback when a chunk boundary broke a tag). */
export function htmlToPlain(html) {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
```

and rework `send()` to try HTML per chunk and fall back to plain text ONCE, on a fresh retry ladder. Do NOT loop the fallback through `withRetryLadder`'s `{retryAfterMs}` mechanism — that burns a shared 429 slot and, if the parse error lands on the ladder's last attempt, misreports a formatting bug as kind `rate-limit` (which the notifier treats as retryable):

```js
    async send(chatId, msg) {
      // One chunk-send through the 429 ladder; `extra` carries {text[, parse_mode]}.
      const sendChunk = (target, extra) => withRetryLadder(async () => {
        let res;
        try {
          res = await fetchFn(api('sendMessage'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: target, ...extra }),
          });
        } catch (err) {
          throw sendError('network', err?.message || String(err));
        }
        if (res.status === 429) { /* …existing 429 branch unchanged… */ }
        if (res.status === 401) throw sendError('auth', 'auth failed — check botToken');
        if (res.status === 403) throw sendError('plugin', 'bot is blocked by this chat or was never started — open the chat and /start it');
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw sendError('plugin', `sendMessage failed: ${data.description || `HTTP ${res.status}`}`);
        }
        return undefined;
      }, _sleep);

      const chunks = splitText(renderToHtml(msg), MAX_MESSAGE_CHARS);
      for (const text of chunks) {
        try {
          await sendChunk(chatId, { text, parse_mode: 'HTML' });
        } catch (err) {
          // A chunk boundary inside an HTML tag loses the whole notification:
          // strip tags and resend ONCE as plain text, on a fresh ladder.
          if (err?.kind !== 'plugin' || !/can't parse entities/i.test(err?.message || '')) throw err;
          await sendChunk(chatId, { text: htmlToPlain(text) });
        }
      }
      return { ok: true, chunks: chunks.length };
    },
```

This is a refactor of the EXISTING send body into `sendChunk` — the 429/401/403/`!res.ok` branches move verbatim; only the JSON body line changes to `{ chat_id: target, ...extra }` and the parse-entities catch is added. `htmlToPlain` goes immediately BEFORE `createTelegramWorker`'s JSDoc block (not between the JSDoc and the factory). The entity unescape order in `htmlToPlain` is deliberate: `&amp;` must be LAST or `&amp;lt;` double-unescapes.

- [ ] **Step 4: Recopy + run**

```bash
for p in slack-chat discord-chat teams-chat; do cp examples/plugins/telegram-chat/lib/*.mjs examples/plugins/$p/lib/; done
node --test test/telegram-chat-worker.test.mjs test/chat-lib-drift.test.mjs test/slack-chat-worker.test.mjs test/discord-chat-worker.test.mjs test/teams-chat-worker.test.mjs
for p in telegram-chat slack-chat discord-chat teams-chat; do node src/cli/worca-cc.mjs plugin validate ./examples/plugins/$p --strict; done
```

- [ ] **Step 5: Commit**

```bash
git add examples/plugins/*/lib/send-util.mjs examples/plugins/telegram-chat/channel/worker.mjs test/telegram-chat-worker.test.mjs
git commit -m "fix(chat): splitText off-by-one + surrogate safety; telegram plain-text fallback for split HTML

A newline at exactly the limit produced a limit+1 chunk (Telegram 400);
a chunk boundary inside an HTML tag lost the whole notification. The
fallback strips tags and resends plain.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 8: markdown placeholder restore must not interpret `$`-patterns

**Finding:** overflow (restore step corrupts values containing `$&`, `` $` ``, `$'`).

**Files:**
- Modify (canon): `examples/plugins/telegram-chat/lib/markdown.mjs` (the placeholder-restore loop inside `processWithCodeProtection`) + recopy
- Test: `test/telegram-chat-worker.test.mjs` (append — the lib test block at the bottom)

- [ ] **Step 1: Failing test:**

```js
// NEW imports at the top of test/telegram-chat-worker.test.mjs:
//   import { toTelegramHtml, toSlackMrkdwn } from '../examples/plugins/telegram-chat/lib/markdown.mjs';
test('code spans containing $-replacement patterns survive markdown conversion verbatim', () => {
  const out = toTelegramHtml('run `sed s/a/$&/` now');
  assert.match(out, /sed s\/a\/\$(&|&amp;)\//); // $& must not duplicate text or leak a \x00PH marker
  assert.ok(!/\x00/.test(out), 'no placeholder marker leaks');
  const out2 = toSlackMrkdwn("pattern `$'` and ```$`\n``` end");
  assert.ok(out2.includes("$'"), 'inline $-pattern survives');
});
test('bold content with $-patterns survives toSlackMrkdwn (second restore site)', () => {
  const out = toSlackMrkdwn('a **b$&c** d');
  assert.match(out, /\*b\$(&|&amp;)c\*/); // T6 escapes & → &amp; in Slack output; both spellings prove no $-interpretation
  assert.ok(!/\x01/.test(out), 'no bold marker leaks');
});
```

- [ ] **Step 2: Run to verify it fails** (value's `$&` interpreted by `String.replace`).
- [ ] **Step 3: Implement** — in `processWithCodeProtection`'s restore loop, replace every `result = result.replace(key, value)`-shaped restore with the function form (a function replacement never interprets `$` patterns):

```js
  for (const { key, value } of placeholders) {
    result = result.replace(key, () => value);
  }
```

`toSlackMrkdwn` has a SECOND `$`-interpreting restore of its own — the bold-marker round trip. Fix it the same way:

```js
      for (const { key, content } of boldParts) {
        text = text.replace(key, () => `*${content}*`); // function form: never interprets $ patterns
      }
```

- [ ] **Step 4: Recopy + run**

```bash
for p in slack-chat discord-chat teams-chat; do cp examples/plugins/telegram-chat/lib/*.mjs examples/plugins/$p/lib/; done
node --test test/telegram-chat-worker.test.mjs test/chat-lib-drift.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add examples/plugins/*/lib/markdown.mjs test/telegram-chat-worker.test.mjs
git commit -m "fix(chat): placeholder restore uses function replacement — \$-patterns in code survive

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Phase 3 — Command router & server (T9–T13 opus-5 max; T14–T17 fable-5 max)

### Task 9: History rows are camelCase — fix `/cost`, `/last`, `/status`

**Finding:** #7.

**Files:**
- Modify: `src/core/chat/command-router.mjs:151-154, 163-166, 185`
- Test: `test/chat-command-router.test.mjs` (change stubs + add a shape-guard test)

**Interfaces:**
- Consumes: `rowToHistoryEntry` fields (src/core/artifacts.mjs:1397-1412): `id, title, status, startedAt, pauseReason, totalCostUsd, totalActiveMs` — camelCase.

- [ ] **Step 1: Failing test.** `test/chat-command-router.test.mjs` has NO `makeRouter`/`handle` — its idiom is `fixture()` → `{ send, calls, state, chatContext }` with `send(text, chatId = '42')`. `fixture()` takes no arguments today; exactly TWO edits make it accept overrides (verified sufficient — nothing else needed): change its signature to `function fixture(overrideActions = {}) {` and add `...overrideActions,` as the LAST property of its `actions` object literal. Then add this glue ONCE near the top (T10–T12 and T17 reuse it):

```js
const makeRouter = (overrideActions = {}) => fixture(overrideActions);
const handle = (f, text, chatId = '42') => f.send(text, chatId);
```

Then replace the snake_case history stubs at lines 24-25 (`total_cost_usd`, `total_active_ms`, `pause_reason`) with the REAL camelCase shape `rowToHistoryEntry` emits (`totalCostUsd`, `totalActiveMs`, `pauseReason` — src/core/artifacts.mjs:1397-1412), fix every existing assertion that depended on them, and add:

```js
test('/cost and /last read the real camelCase history-entry fields', async () => {
  const f = makeRouter({ history: async () => [{ id: 'p-1234', title: 'T', status: 'done', totalCostUsd: 2.5, totalActiveMs: 61000, pauseReason: null }] });
  const cost = await handle(f, '/cost *1234');
  assert.match(cost.body[0].value, /\$2\.50/);
  const last = await handle(f, '/last');
  assert.match(last.body[0].value, /\$2\.50/);
  assert.match(last.body[0].value, /1m01s/);
});
```

- [ ] **Step 2: Run to verify it fails** ($0.00 / missing lines).
- [ ] **Step 3: Implement** — in `command-router.mjs` replace all snake_case reads:
  - `/last` (~151-154): `r.total_cost_usd` → `r.totalCostUsd`; `r.total_active_ms` → `r.totalActiveMs`
  - `/status` row branch (~163-166): `r.total_cost_usd` → `r.totalCostUsd`; `r.pause_reason` → `r.pauseReason`
  - `/cost` (~185): `t.row.total_cost_usd` → `t.row.totalCostUsd`

- [ ] **Step 4:** `node --test test/chat-command-router.test.mjs` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/core/chat/command-router.mjs test/chat-command-router.test.mjs
git commit -m "fix(chat): read camelCase history-entry fields — /cost //last no longer report \$0.00

Production history rows come from rowToHistoryEntry (camelCase); the
router read snake_case and its tests stubbed the wrong shape.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 10: `wantLive` filters to actually-live runs — `/stop` can't hit finished runs

**Finding:** #8.

**Files:**
- Modify: `src/core/chat/command-router.mjs:62-79` (resolveTarget)
- Test: `test/chat-command-router.test.mjs` (append)

- [ ] **Step 1: Failing test:**

```js
test('/stop and /pause refuse runs that are already finished', async () => {
  const f = makeRouter({ listRuns: () => [{ runId: 'r-2951', title: 'Done run', status: 'done' }] });
  const out = await handle(f, '/stop *2951');
  assert.match(out.body[0].value, /No live run matches/);
  const out2 = await handle(f, '/stop');
  assert.match(out2.body[0].value, /No live runs/);
});
test('a run parked on a gate is still resolvable by /approve and /answer after the filter', async () => {
  // wantLive now filters on LIVE = {running, starting, pausing}; a gated run's
  // entry.status stays 'running' (ui/server.mjs:436-441) — prove it stays reachable.
  const pq = { id: 'q1', kind: 'gate' };
  const answered = [];
  const f = makeRouter({
    listRuns: () => [{ runId: 'r-77aa', title: 'Gated', status: 'running' }],
    pendingQuestion: () => pq,
    answer: (runId, id, payload) => answered.push(payload),
  });
  const out = await handle(f, '/approve *77aa');
  assert.match(out.body[0].value, /approved — continuing/);
  assert.deepEqual(answered, [{ decision: 'continue' }]);
});
```

- [ ] **Step 2: Run to verify it fails** (currently replies "⏹ Stopping…").
- [ ] **Step 3: Implement** — first line of `resolveTarget`:

```js
function resolveTarget(arg, live, rows, { wantLive = false } = {}) {
  // wantLive commands (/pause /stop /approve /answer…) must never bind to a
  // finished entry still parked in the runs Map.
  if (wantLive) live = live.filter((r) => LIVE.has(String(r.status || '')));
  const suffix = String(arg || '').replace(/^\*/, '').trim();
  /* …rest unchanged… */
```

- [ ] **Step 4:** `node --test test/chat-command-router.test.mjs test/chat-inbound-e2e.test.mjs` → PASS (e2e gate test uses a `running` fixture — unaffected).
- [ ] **Step 5: Commit**

```bash
git add src/core/chat/command-router.mjs test/chat-command-router.test.mjs
git commit -m "fix(chat): wantLive resolution excludes finished runs — /stop can't clobber a done run

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 11: Command lookup uses `Object.hasOwn`

**Finding:** overflow (`/constructor`, `/__proto__` resolve through the prototype chain).

**Files:**
- Modify: `src/core/chat/command-router.mjs:300-302`
- Test: `test/chat-command-router.test.mjs` (append)

- [ ] **Step 1: Failing test:**

```js
test('prototype members are not commands', async () => {
  const f = makeRouter();
  // The live bugs (parser lowercases, so only all-lowercase prototype members
  // resolve): /constructor → handler = Object, returns the env object → the
  // reply send fails isValidMessage → user gets NOTHING; /__proto__ → "Command
  // failed: handler is not a function". The camelCase ones below already answer
  // "Unknown command" and are regression guards only.
  for (const cmd of ['/constructor', '/__proto__', '/hasownproperty', '/tostring']) {
    const out = await handle(f, cmd);
    assert.match(out.body[0].value, /Unknown command/, cmd);
  }
});
```

- [ ] **Step 2: Run to verify the red phase** — `/constructor` fails the assertion with a TypeError (`out.body` is undefined — the handler returned the env object), `/__proto__` fails on "Command failed" text.
- [ ] **Step 3: Implement:**

```js
      const handler = Object.hasOwn(handlers, parsed.command) ? handlers[parsed.command] : null;
```

(Note: parser lowercases, so `__proto__` — lowercase — is the live risk; `Object.hasOwn` closes all of them.)

- [ ] **Step 4:** `node --test test/chat-command-router.test.mjs` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/core/chat/command-router.mjs test/chat-command-router.test.mjs
git commit -m "fix(chat): command lookup uses Object.hasOwn — /constructor is not a command

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 12: Bare `/resume` with ≥2 paused rows disambiguates

**Finding:** overflow (replies "No live runs" instead of listing candidates).

**Files:**
- Modify: `src/core/chat/command-router.mjs:204-217` (resume handler)
- Test: `test/chat-command-router.test.mjs` (append)

- [ ] **Step 1: Failing test:**

```js
test('bare /resume with two paused pipelines lists them instead of "No live runs"', async () => {
  const rows = [
    { id: 'p-aaaa', title: 'One', status: 'paused' },
    { id: 'p-bbbb', title: 'Two', status: 'interrupted' },
  ];
  const f = makeRouter({ history: async () => rows });
  const out = await handle(f, '/resume');
  assert.match(out.body[0].value, /Ambiguous/);
  assert.match(out.body[0].value, /\*aaaa/);
  assert.match(out.body[0].value, /\*bbbb/);
});
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** — in the resume handler, declare `let t = resolveTarget(...)` (was `const`) and replace the error branch. Do NOT recurse into `handlers.resume` (v1's shape) — it re-runs the full history read just to re-derive a row the handler already holds:

```js
      if (t.error) {
        if (!args[0] && rows.length > 1) {
          return disambiguate(rows.map((r) => ({ id: r.id, title: r.title, status: r.status })));
        }
        if (!args[0] && !rows.length) return reply('Nothing is paused.', 'warning');
        if (args[0] || rows.length !== 1) return t.error;
        t = { row: rows[0] };            // exactly one paused row, bare /resume: take it
      }
```

- [ ] **Step 4:** `node --test test/chat-command-router.test.mjs` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/core/chat/command-router.mjs test/chat-command-router.test.mjs
git commit -m "fix(chat): bare /resume with several paused pipelines disambiguates

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 13: `pauseRun` throws a typed error — no message sniffing in the route

**Finding:** overflow (400-vs-500 decided by `/cannot pause/.test(err.message)`).

**Files:**
- Modify: `ui/server.mjs` (`pauseRun` 1069-1076; `/api/pause` route 1114, message sniff at 1121)
- Test: `test/server-pause-resume.test.mjs` (already exercises /api/pause with run fixtures)

- [ ] **Step 1: Failing tests** — two wiring facts first:
  - `test/server-pause-resume.test.mjs` imports the server DYNAMICALLY inside `before()` (env must be set before the import) — extend that existing destructure, never add a top-level static import: `let runs, _testing; ({ runs, _testing } = mod);` (`runs` is a NAMED export of `ui/server.mjs`, not part of `_testing` — see `ui/server.mjs:3314`).
  - The file has no live runs-map fixture (it only seeds DB rows + HTTP posts). Seed directly — idiom as in `test/chat-inbound-e2e.test.mjs:82`: `const pauseEntry = (id, pauseResult) => { runs.set(id, { id, orch: { pause: () => pauseResult }, status: 'running', events: [], pendingQuestion: null }); return id; };`
  - `pauseRun` is SYNCHRONOUS; wrap the call in an async arrow or `assert.rejects` never sees the throw (v1's `() => Promise.resolve(chatActions.pause(id))` stays red forever — the throw happens while BUILDING the promise argument):

```js
test('pauseRun signals CANNOT_PAUSE via err.code, not message text', async () => {
  const runId = pauseEntry('r-cannot', false);
  await assert.rejects(async () => _testing.chatActions.pause(runId), (err) => err.code === 'CANNOT_PAUSE');
});
test('pauseRun happy path still marks the entry pausing and resolves the pending question', async () => {
  const okRunId = pauseEntry('r-ok', true);
  _testing.chatActions.pause(okRunId);
  assert.equal(runs.get(okRunId).status, 'pausing');
});
```

- [ ] **Step 2: Run to verify red** (`err.code` undefined; second test guards the two lines v1's snippet silently deleted).

- [ ] **Step 3: Implement** — the throw gains a `code`; the two existing statements after it MUST STAY (deleting them breaks pause status + question resolution):

```js
function pauseRun(runId) {
  const entry = runs.get(runId);
  if (!entry) throw new Error('unknown runId');
  const ok = typeof entry.orch?.pause === 'function' && entry.orch.pause();
  if (!ok) throw Object.assign(new Error('cannot pause in the current state'), { code: 'CANNOT_PAUSE' });
  entry.status = 'pausing';
  resolvePending(entry, { reason: 'paused' });
}
```

Route (sniff at line 1121):

```js
  } catch (err) {
    if (err?.code === 'CANNOT_PAUSE') return badRequest(res, err.message);
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
```

(The chat path is untouched: the router's catch still replies `Command failed: cannot pause in the current state` — same message text as before.)

- [ ] **Step 4:** `node --test test/server-pause-resume.test.mjs test/chat-inbound-e2e.test.mjs` → PASS.
- [ ] **Step 5: Commit**

```bash
git add ui/server.mjs test/server-pause-resume.test.mjs
git commit -m "fix(chat): pauseRun throws err.code CANNOT_PAUSE — route stops sniffing message text

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 14: Per-chat serialization of inbound commands (fable-5 max)

**Finding:** #9 (batched same-chat commands interleave: stale reads, out-of-order replies).

**Files:**
- Modify: `ui/server.mjs` (`channelHost` onInbound wiring ~line 1029-1033; add queue helper above `handleChatInbound`)
- Test: `test/chat-inbound-e2e.test.mjs` (append)

**Interfaces:**
- Produces: `enqueueChatWork(key, fn)` module-level helper (exported via `_testing`); onInbound key = `${ev.platform}:${ev.msg.chatId}` — the SAME key domain as `chatContext`'s `chatKey` (command-router.mjs:301), which is the state the serialization protects. Not per-user (two users racing `/use` in one group chat is exactly the interleaving to prevent) and not per-channel (two channels of one platform serving the same chat share one chatKey — they must share one queue).

- [ ] **Step 1: Failing test.** Binding note: `test/chat-inbound-e2e.test.mjs` currently destructures ONLY `channelHost` out of `server._testing` (line ~44) — extend that existing dynamic-import destructure to also pull `chatActions` and (after Step 3) `enqueueChatWork`; never add a top-level static import (env setup must precede the server import).

```js
test('same-chat commands execute strictly in order (batched /use then /runs)', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  // monkey-patch listProjects to hold /use mid-flight (restore in finally)
  const orig = _testing.chatActions.listProjects;
  _testing.chatActions.listProjects = async () => { await gate; return [{ name: 'beta', path: '/tmp/beta' }]; };
  try {
    clearMockSentMessages();
    _testing.channelHost.injectInboundMessage(NAME, 'main', { chatId: '42', userId: 'u', text: '/use beta', meta: {} });
    _testing.channelHost.injectInboundMessage(NAME, 'main', { chatId: '42', userId: 'u', text: '/runs', meta: {} });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(mockSentMessages().length, 0, '/runs must wait behind /use');
    release();
    await new Promise((r) => setTimeout(r, 50));
    const texts = mockSentMessages().map((m) => m.message.body[0].value);
    assert.match(texts[0], /Active project: \*\*beta\*\*/);
  } finally {
    _testing.chatActions.listProjects = orig;
    _testing.channelHost.injectInboundMessage(NAME, 'main', { chatId: '42', userId: 'u', text: '/use -', meta: {} });
    await new Promise((r) => setTimeout(r, 30));
  }
});

test('a throwing handler neither kills the queue nor leaks an unhandled rejection', async () => {
  const rejections = [];
  const onUR = (err) => rejections.push(err);
  process.on('unhandledRejection', onUR);
  try {
    await _testing.enqueueChatWork('probe:1', () => { throw new Error('probe-boom'); });
    let ran = false;
    await _testing.enqueueChatWork('probe:1', () => { ran = true; });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(ran, true, 'queue keeps draining after a failure');
    assert.equal(rejections.length, 0, 'no unhandled rejection escaped');
  } finally { process.off('unhandledRejection', onUR); }
});
```

- [ ] **Step 2: Run to verify it fails** (`/runs` reply arrives first).
- [ ] **Step 3: Implement** in `ui/server.mjs`:

```js
// Same-chat commands must run strictly in order: a batched ['/use beta','/runs']
// from one getUpdates poll otherwise interleaves (stale reads, replies out of
// order). One promise chain per chatKey; depth-capped (there is NO host-side
// inbound bound — a Telegram poll can hand over 100 updates at once, and the
// allowlist is only applied inside the router, after enqueue); the catch is
// mandatory — nobody awaits this chain, so a rejected tail is an unhandled
// rejection that kills the process under Node's default flag.
const CHAT_QUEUE_MAX = 50;          // per chat; a flood past this is dropped, not buffered
const chatQueues = new Map();       // key -> { tail, depth }
function enqueueChatWork(key, fn) {
  const q = chatQueues.get(key) || { tail: Promise.resolve(), depth: 0 };
  if (q.depth >= CHAT_QUEUE_MAX) {
    console.error(`[worca-ui] chat queue for ${key} is full (${CHAT_QUEUE_MAX}) — dropping inbound work`);
    return q.tail;
  }
  q.depth += 1;
  // prev.then(fn, fn): run even after a prior failure (fn takes no arguments,
  // so the previous error is discarded — do not give fn a parameter).
  const tail = q.tail.then(fn, fn).catch((err) => {
    console.error(`[worca-ui] chat work failed: ${err && err.message ? err.message : err}`);
  }).finally(() => {
    q.depth -= 1;
    if (chatQueues.get(key) === q && q.depth === 0) chatQueues.delete(key);
  });
  q.tail = tail;
  chatQueues.set(key, q);
  return tail;
}
```

Wire it:

```js
const channelHost = createChannelHost({
  logger: (level, msg) => console.error(`[worca-ui] ${msg}`),
  onInbound: (ev) => { enqueueChatWork(`${ev.platform}:${ev.msg.chatId}`, () => handleChatInbound(ev)); },
  onStatus: (ev) => { try { broadcast({ type: 'channel-status', ...ev }); } catch { /* pre-listen */ } },
});
```

Add `enqueueChatWork` to the `_testing` export at the bottom of the file.

- [ ] **Step 4:** `node --test test/chat-inbound-e2e.test.mjs` → PASS (dry-run verified: all existing e2e tests stay green with the queue — `inject()` already settles 25ms — no added waits needed).
- [ ] **Step 5: Commit**

```bash
git add ui/server.mjs test/chat-inbound-e2e.test.mjs
git commit -m "fix(chat): serialize inbound command handling per chat

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 15: Cheap chat history — `listAllPipelines({limit, lite})` (fable-5 max)

**Finding:** #10 (every /status spawns ~2 git subprocesses per pipeline, full history for limit:1).

**Files:**
- Modify: `src/core/artifacts.mjs` (`listAllPipelines` ~line 1481 (SELECT at 1482-1489, mapping return at 1521, re-sort at 1540-1543); `rowToHistoryEntry` callers inside it)
- Modify: `ui/server.mjs` (`chatActions.history` ~line 997)
- Test: `test/chat-command-router.test.mjs` untouched; add to the artifacts test file that already covers `listAllPipelines` (locate via `grep -rn "listAllPipelines" test/`), plus an assertion in `test/chat-inbound-e2e.test.mjs` that history flows still work.

**Interfaces:**
- Produces: `listAllPipelines(opts)` gains `opts.limit` (integer — SQL `LIMIT ?`) and `opts.lite` (boolean — skip ALL git work: pass `repoDir = null` into `rowToHistoryEntry`, so `survived:false, added:0, removed:0`, and never `withPr`). Both default off — existing callers unchanged.
- Consumes: `chatActions.history` becomes `({ limit = 50 } = {}) => listAllPipelines({ limit, lite: true })`.

- [ ] **Step 1: Failing tests.** Two files — the plan-v1 single test was PROVEN VACUOUS in `test/list-all-pipelines.test.mjs` (its fixtures are not git repos and have no `branch`, so `survived:false, added:0` with or without `lite`).

In `test/list-all-pipelines.test.mjs` (limit + ordering; use the file's temp-WORCA_HOME + `seed()` idiom, and force DISTINCT timestamps — equal `started_at` makes which rows survive the LIMIT tie-order-dependent):

```js
test('listAllPipelines limit: bounded rows, ordered by recency of update', async () => {
  // seed 3 pipelines with the file's seed() helper, then stamp explicit times so
  // pipeline A is the OLDEST-started but NEWEST-updated:
  //   getDb().prepare('UPDATE pipelines SET started_at = ?, updated_at = ? WHERE id = ?').run(...)
  //   A: started t0,   updated t9   · B: started t5, updated t5 · C: started t8, updated t8
  const rows = await listAllPipelines({ limit: 2, lite: true });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, aId,
    'SQL LIMIT must agree with the mtime (updated_at) sort the callers see — LIMIT on started_at would drop this row');
});
```

In `test/artifacts-branch-stats.test.mjs` (the only suite whose fixtures make git enrichment real — pin the row that IS enriched):

```js
test('lite skips git enrichment on a row that would otherwise be enriched', async () => {
  const full = await listAllPipelines();
  assert.equal(full.find((r) => r.id === pp1Id).survived, true, 'fixture sanity: enrichment is real here');
  const lite = await listAllPipelines({ lite: true });
  const r = lite.find((x) => x.id === pp1Id);
  assert.equal(r.survived, false);
  assert.equal(r.added, 0);
});
```

- [ ] **Step 2: Run to verify red** (no `limit` support → 3 rows; `lite` unknown → enrichment still runs).

- [ ] **Step 3: Implement.** In `listAllPipelines` (src/core/artifacts.mjs:1482-1489) — this is the REAL query; the ONLY changes are the ORDER BY tail and the LIMIT parameter. Do not touch the `pause_reason` alias:

```js
  const rows = getDb().prepare(`
    SELECT id, project_key, workspace_key, target, title, status, started_at, updated_at,
           total_cost_usd, total_active_ms, branch, workspace_meta, guardrails_id,
           json_extract(CASE WHEN json_valid(resume_point) THEN resume_point END, '$.pauseReason') AS pause_reason
    FROM pipelines
    WHERE archived_at IS NULL
    ORDER BY COALESCE(updated_at, started_at) DESC, project_key, id
    LIMIT ?
  `).all(Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : -1); // -1 = unlimited (SQLite)
```

Why the ORDER BY changes: the function re-sorts its output by `mtime` (= `updated_at`) with a projectKey/id tiebreaker (lines 1540-1543). v1's `ORDER BY started_at DESC LIMIT n` selects a DIFFERENT top-n whenever an old pipeline was recently resumed/updated — `/last` would silently change meaning. Ordering the SQL by the same key the JS sorts by makes the limit exact. (Callers without `limit` see the same rows as before — the JS sort still runs.)

Then in the phase-1 mapping, the ONE clean lite hook is the returned literal (line 1521) — `t.tag.projectDir` is intentionally untouched (chat's `/resume` may need it):

```js
    return { row, tag, repoDir: opts.lite ? null : repoDir, pipelinesDir };
```

`opts.lite` forces `rowToHistoryEntry` to skip `branchExists`/`diffShortstat` (its `if (repoDir && feature)` guard); `withPr` was ALREADY dead in the chat path (`chatActions.history` passes no opts), so `lite`'s only observable effect on chat output is speed — verified: `/last`/`/status`/`/cost`/`/resume` read only `id/title/status/totalCostUsd/totalActiveMs/pauseReason`, none of the git fields.

In `ui/server.mjs` (line 997):

```js
  history: async ({ limit = 50 } = {}) => (await listAllPipelines({ limit, lite: true })) || [],
```

- [ ] **Step 4:** `node --test test/list-all-pipelines.test.mjs test/artifacts-branch-stats.test.mjs test/chat-inbound-e2e.test.mjs test/chat-command-router.test.mjs` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/core/artifacts.mjs ui/server.mjs test/list-all-pipelines.test.mjs test/artifacts-branch-stats.test.mjs
git commit -m "fix(chat): chat history uses lite+limited listAllPipelines — no git storm per /status

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 16: Extract `resumeRun()` — chat resume stops self-fetching (fable-5 max)

**Finding:** #14 (loopback self-fetch breaks under WORCA_HOST / can hit a different instance).

**Files:**
- Modify: `ui/server.mjs` (`/api/resume` route ~line 1131-1250; `chatActions.resume` ~line 985-996)
- Test: `test/server-pause-resume.test.mjs` (append — it has the paused-row fixtures; extend its dynamic-import destructure to pull `_testing`, and never add a top-level static import). Existing /api/resume suites (`test/server-pause-resume.test.mjs`, `test/budget-api.test.mjs`) must stay green.

**Interfaces:**
- Produces: `async function resumeRun(pipelineId, { ignoreCostCap = false, mock = false } = {})` → resolves `{ ok: true, runId, pipelineId }` (the route returns all three today — ui/server.mjs:1246 — and dropping one is a wire change this PR must not make); throws `ResumeError` with `.status` (HTTP code) and `.body` (JSON payload) for every guard rejection. Route becomes a thin mapper; `chatActions.resume` calls it directly.

- [ ] **Step 1: Failing test:**

```js
// test/server-pause-resume.test.mjs — the file's paused-without-worktree fixture is `pausedNoWtId`
test('chat /resume works without a loopback self-fetch (direct helper call)', async () => {
  // Red phase (pre-fix): nothing listens on PORT under test, so the loopback
  // fetch fails and this returns { ok:false, error:'fetch failed' }.
  // Green phase: the direct call reaches the REAL guard chain — a paused row
  // whose worktree is gone must produce the worktree guard's message.
  const out = await _testing.chatActions.resume(pausedNoWtId);
  assert.equal(out.ok, false);
  assert.match(out.error, /worktree missing/);
});
test('resumeRun maps guard failures to typed errors', async () => {
  await assert.rejects(() => _testing.resumeRun('nope'), (e) => e.status === 404);
});
test('/api/resume still answers { ok, runId, pipelineId }', async () => {
  // Happy path needs a RESUMABLE fixture: seed a paused pipeline whose worktree
  // dir EXISTS, and register its project via addProject({ name, path }) — it
  // takes an object, not a bare path. POST /api/resume, then:
  //   assert.equal(body.ok, true); assert.ok(body.runId); assert.equal(body.pipelineId, pid);
});
```

- [ ] **Step 2: Run to verify it fails** (`resumeRun` not exported / chatActions still fetches).
- [ ] **Step 3: Implement.** Mechanical extraction — move the ENTIRE route body between the `pipelineId` validation and the final `res.json(...)` into:

```js
class ResumeError extends Error {
  constructor(status, body) { super(body.error || 'resume failed'); this.status = status; this.body = body; }
}
async function resumeRun(pipelineId, { ignoreCostCap = false, mock = false } = {}) {
  if (!pipelineId || typeof pipelineId !== 'string') throw new ResumeError(400, { error: 'pipelineId is required' });
  const saved = readPipelineForResume(pipelineId);
  if (!saved) throw new ResumeError(404, { error: 'pipeline not found' });
  /* …every guard verbatim, each `return res.status(S).json(B)` becomes `throw new ResumeError(S, B)`,
     each `badRequest(res, msg)` becomes `throw new ResumeError(400, { error: msg })`,
     the mock flag stays INSIDE resumeRun — the WORCA_MOCK e2e path depends on the env fallback living here:
     const effMock = mock || isTruthy(process.env.WORCA_MOCK ?? process.env.ORCH_MOCK); … */
  return { ok: true, runId, pipelineId };
}
```

Route:

```js
app.post('/api/resume', async (req, res) => {
  try {
    const out = await resumeRun(req.body?.pipelineId, {
      ignoreCostCap: req.body?.ignoreCostCap === true,
      mock: !!(req.body && req.body.mock),
    });
    res.json(out);
  } catch (err) {
    if (err instanceof ResumeError) return res.status(err.status).json(err.body);
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});
```

chatActions:

```js
  resume: async (pipelineId) => {
    try { return await resumeRun(pipelineId); }
    catch (err) { return { ok: false, error: err?.body?.error || err?.message || String(err) }; }
  },
```

Add `resumeRun` to `_testing`. **Behavior must be byte-identical for every guard — diff the moved block against the original during review.** Dry-run verified the extraction: every guard maps 1:1 (badRequest(res,m) ≡ res.status(400).json({error:m})), the setCostCapOverride side effect keeps its position BEFORE the pipeline-cap check, and the existing /api/resume suites (test/server-pause-resume.test.mjs, test/budget-api.test.mjs) stay green.

- [ ] **Step 4:** `node --test test/server-pause-resume.test.mjs test/budget-api.test.mjs test/chat-inbound-e2e.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/server.mjs test/server-pause-resume.test.mjs
git commit -m "fix(chat): extract resumeRun() — chat resume no longer self-fetches 127.0.0.1

The loopback fetch broke under WORCA_HOST and could target a different
instance on 4317. Route and chat share one guard chain now.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 17: `/answer` free-text support (fable-5 max)

**Finding:** #13 (zero-option clarify questions unanswerable from chat).

**Files:**
- Modify: `src/core/chat/command-router.mjs:223-248` (answer handler; DELETE the now-dead `const ordinals = …` line above the pq-kind checks), `command-router.mjs:47` (HELP_TEXT `/answer` line), `src/core/chat/renderers.mjs:116-125` (instruction line)
- Test: `test/chat-command-router.test.mjs` (new tests + UPDATE the two existing assertions at ~lines 146-147 that pin the old usage string `Need exactly N option numbers`), `test/chat-core.test.mjs` (line ~193 pins the old renderer instruction `/answer *2951 1 1  (one choice per question, in order)` — update it; `test/chat-notifier.test.mjs` never imports `renderQuestion`, v1 pointed at the wrong file)

**Interfaces:**
- Consumes: clarify answer payload `{answers: [{id, choice}]}` where free text is also a `choice` string (ui/public/app.js:3543 (allowFreeText gate), :3717 (choice payload), :8499 (shape comment), orchestrator.mjs:368); question shape `{id, question, options, allowFreeText}` — `allowFreeText !== false` means free text allowed.
- Produces: chat syntax — pure-ordinal form unchanged; NEW pipe form `/answer [*ref] a1 | a2 | …` where each `aN` is an ordinal (options exist and it parses in-range) or free text otherwise. Single-question rule: when `questions.length === 1` the whole remainder is THE answer — never split on `|` (a lone free-text answer containing a pipe — regexes, shell, alternations — must be submittable; dry-run proved v1's grammar rejected it).

- [ ] **Step 1: Failing tests:**

```js
test('/answer answers a zero-option free-text question', async () => {
  const pq = { id: 'q1', kind: 'clarify', questions: [{ id: 'k', question: 'Name?', options: [] }] };
  const answered = [];
  const f = makeRouter({ pendingQuestion: () => pq, answer: (r, id, p) => answered.push(p), listRuns: liveOne });
  const out = await handle(f, '/answer call it worca');
  assert.deepEqual(answered, [{ answers: [{ id: 'k', choice: 'call it worca' }] }]);
  assert.match(out.body[0].value, /Answered 1 question/);
});
test('/answer mixes ordinals and free text with the pipe separator', async () => {
  const pq = { id: 'q1', kind: 'clarify', questions: [
    { id: 'a', question: 'Pick', options: ['x', 'y'] },
    { id: 'b', question: 'Describe', options: [] },
  ]};
  const answered = [];
  const f = makeRouter({ pendingQuestion: () => pq, answer: (r, id, p) => answered.push(p), listRuns: liveOne });
  await handle(f, '/answer 2 | free text here');
  assert.deepEqual(answered[0].answers, [{ id: 'a', choice: 'y' }, { id: 'b', choice: 'free text here' }]);
});
test('a single free-text answer containing a literal | is taken verbatim', async () => {
  const pq = { id: 'q1', kind: 'clarify', questions: [{ id: 'k', question: 'Pattern?', options: [] }] };
  const answered = [];
  const f = makeRouter({ pendingQuestion: () => pq, answer: (r, id, p) => answered.push(p), listRuns: liveOne });
  await handle(f, '/answer use a|b as the pattern');
  assert.deepEqual(answered, [{ answers: [{ id: 'k', choice: 'use a|b as the pattern' }] }]);
});
// This one lives in test/chat-core.test.mjs (renderQuestion's real assertion
// file — v1 pointed at test/chat-notifier.test.mjs, which never imports it):
test('renderQuestion instructs the pipe form when a question is free-text', () => {
  const msg = renderQuestion({ runId: 'r-ab12' }, { kind: 'clarify', questions: [{ id: 'k', question: 'Name?', options: [] }] });
  assert.match(msg.body[0].value, /\/answer \*ab12 <your answer>/);
});
```

(with `const liveOne = () => [{ runId: 'r-ab12', title: 'Live', status: 'running' }];` in the glue block)

- [ ] **Step 2: Run to verify all three fail.**
- [ ] **Step 3: Implement.** Replace the `answer` handler body after the pq-kind checks:

```js
      const questions = Array.isArray(pq.questions) ? pq.questions : [];
      const hasRef = !!(args[0] && args[0].startsWith('*'));
      const rest = (hasRef ? args.slice(1) : args).join(' ').trim();
      const ref = runRef(t.run.runId);
      const usage = () => reply(
        `Need ${questions.length} answer${questions.length === 1 ? '' : 's'} — option numbers, or text for free-text questions, separated by \`|\`.\nExample: \`/answer ${ref} ${questions.map((q) => (q.options?.length ? '1' : '<your answer>')).join(' | ')}\``,
        'warning');
      if (!rest) return usage();
      // Parsing spec:
      // 1-question: the whole rest IS the answer — never split (pipes are data).
      // Pure-ordinal back-compat: "1 2 3" iff every question has options and no '|'.
      // Otherwise: pipe-separated, one part per question, in order.
      let parts;
      if (questions.length === 1) {
        parts = [rest];
      } else {
        const tokens = rest.split(/\s+/);
        const allOrdinals = tokens.every((tk) => /^\d+$/.test(tk));
        const everyHasOptions = questions.every((q) => (q.options || []).length > 0);
        parts = allOrdinals && everyHasOptions && !rest.includes('|')
          ? tokens
          : rest.split('|').map((s) => s.trim());
      }
      if (parts.length !== questions.length) return usage();
      const answers = [];
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const opts = Array.isArray(q.options) ? q.options : [];
        const part = parts[i];
        const n = /^\d+$/.test(part) ? Number(part) : null;
        if (opts.length && n !== null) {
          if (n < 1 || n > opts.length) return reply(`Q${i + 1} has options 1–${opts.length}; got ${n}.`, 'warning');
          answers.push({ id: q.id, choice: opts[n - 1] });
        } else if (q.allowFreeText !== false && part) {
          answers.push({ id: q.id, choice: part });   // free text is a choice string (app.js:3717)
        } else if (!opts.length) {
          return reply(`Q${i + 1} needs a written answer — got nothing.`, 'warning');
        } else {
          return reply(`Q${i + 1} takes an option number (1–${opts.length}), not text.`, 'warning');
        }
      }
      await actions.answer(t.run.runId, pq.id, { answers });
      return reply(`✅ Answered ${questions.length} question${questions.length === 1 ? '' : 's'} on \`${ref}\`.`, 'success');
```

Renderer (`renderQuestion`, clarify branch) — build the example per question:

```js
  const example = questions.map((q) => ((Array.isArray(q.options) && q.options.length) ? '1' : '<your answer>')).join(' | ') || '1';
  parts.push(`   Reply: /answer ${ref} ${example}${questions.length > 1 ? '  (one answer per question, in order, separated by |)' : ''}`);
```

Update HELP_TEXT (command-router.mjs:47): '`/answer [*ref] <n|text> [| …]` — answer clarify questions (option number, or text for free-text)'. Update the two existing usage-string assertions and the chat-core renderer assertion to the new formats.

- [ ] **Step 4:** `node --test test/chat-command-router.test.mjs test/chat-core.test.mjs test/chat-inbound-e2e.test.mjs` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/core/chat/command-router.mjs src/core/chat/renderers.mjs test/chat-command-router.test.mjs test/chat-core.test.mjs
git commit -m "fix(chat): /answer supports free-text clarify answers (pipe-separated)

Zero-option questions were unanswerable from chat while the notification
instructed an unsatisfiable '/answer <ref> 1'.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Phase 4 — Teams, gateway, CLI

### Task 18: Teams JWT — require `exp`, survive JWKS failures as 401 (fable-5 max)

**Finding:** #15 — re-verified: (a) the exp/nbf checks are `Number.isFinite(p.exp) && …`-guarded, so a signed token with a missing or string `exp` validates FOREVER on the public ingress (probe-confirmed); (b) `loadKeys` never checks `res.ok` and a rejecting fetch/HTML error page THROWS out of `validate()` — caught by the child's webhook dispatcher (`channel-worker-child.mjs:171-174`) which answers HTTP 500; Bot Framework retries non-2xx, so a Microsoft metadata outage becomes a 500-retry storm.

**Files:**
- Modify: `examples/plugins/teams-chat/channel/jwt.mjs:45-57, 72-93`
- Test: `test/teams-chat-worker.test.mjs` (append — reuse its self-minted RS256 helper)

- [ ] **Step 0: Fix the shared JWKS fixture FIRST** — `test/teams-chat-worker.test.mjs:36-41`'s `jwksFetch` returns `{ json }` with no `ok`/`status`; after this task's `if (!metaRes.ok) throw`, every existing JWT test would take the outage path and the file goes red (dry-run: 6/11 failed). Update both returns to `{ ok: true, status: 200, json: … }` (`tokenRoutes()` delegates to it, so this one edit covers the webhook/send suites too).

- [ ] **Step 1: Write the failing tests** (helpers: `mint({...claims})` — NOT `mintToken`; it injects valid defaults for `iss/aud/exp/nbf/serviceurl`, so a "missing" claim must be explicitly `undefined`; constants are `APP_ID` / `SERVICE_URL`):

```js
test('a signed token WITHOUT exp is rejected (fail closed)', async () => {
  const token = mint({ exp: undefined }); // JSON.stringify drops the key entirely
  assert.equal(decodeJwt(token).payload.exp, undefined, 'fixture guard: token really has no exp');
  const v = createJwtValidator({ appId: APP_ID, fetchFn: jwksFetch });
  const r = await v.validate(`Bearer ${token}`, SERVICE_URL);
  assert.equal(r.ok, false);
  assert.match(r.reason, /exp/);
});
test('a string exp is rejected', async () => {
  const v = createJwtValidator({ appId: APP_ID, fetchFn: jwksFetch });
  const r = await v.validate(`Bearer ${mint({ exp: 'never' })}`, SERVICE_URL);
  assert.equal(r.ok, false);
});
test('a JWKS outage with no cache yields ok:false (→401), not an escaped throw', async () => {
  const v = createJwtValidator({ appId: APP_ID, fetchFn: async () => { throw new Error('ECONNREFUSED'); } });
  const r = await v.validate(`Bearer ${mint({})}`, SERVICE_URL);
  assert.equal(r.ok, false);
  assert.match(r.reason, /jwks unavailable/i);
});
test('a JWKS outage with a warm cache serves stale keys (bounded)', async () => {
  let clock = Date.now();
  let up = true;
  const v = createJwtValidator({ appId: APP_ID, now: () => clock,
    fetchFn: (u) => (up ? jwksFetch(u) : Promise.reject(new Error('ECONNREFUSED'))) });
  assert.equal((await v.validate(`Bearer ${mint({})}`, SERVICE_URL)).ok, true); // warms the cache
  up = false;
  clock += 25 * 60 * 60 * 1000; // past JWKS_TTL_MS → forced refetch → outage
  const sec = Math.floor(clock / 1000);
  const fresh = mint({ exp: sec + 600, nbf: sec - 60 }); // re-mint against the advanced clock
  assert.equal((await v.validate(`Bearer ${fresh}`, SERVICE_URL)).ok, true, 'stale cache still validates');
});
```

- [ ] **Step 2: Run to verify they fail** (no-exp token currently ok:true; JWKS outage throws).
- [ ] **Step 3: Implement.** `loadKeys` — check both fetches:

```js
  async function loadKeys(force = false) {
    if (!force && keys && now() - fetchedAt < JWKS_TTL_MS) return keys;
    const metaRes = await fetchFn(OPENID_METADATA_URL);
    if (!metaRes.ok) throw new Error(`openid metadata fetch failed: HTTP ${metaRes.status}`);
    const meta = await metaRes.json();
    const jwksRes = await fetchFn(meta.jwks_uri);
    if (!jwksRes.ok) throw new Error(`jwks fetch failed: HTTP ${jwksRes.status}`);
    const jwks = await jwksRes.json();
    /* …rest unchanged… */
```

Add `const JWKS_STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000;` next to `JWKS_TTL_MS`. Build the key map into a LOCAL and swap only on success, so a malformed/empty JWKS response can never poison the cache:

```js
    const next = new Map();
    for (const jwk of jwks.keys || []) {
      if (!jwk.kid) continue;
      try { next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })); } catch { /* unsupported alg */ }
    }
    if (!next.size) throw new Error('jwks contained no usable keys');
    keys = next;
    fetchedAt = now();
    return keys;
```

`validate` — wrap key loading (stale cache beats an outage; outage with no cache = clean reject) and harden the time checks:

```js
      let byKid;
      try { byKid = await loadKeys(); } catch (err) {
        // Outage: a stale cache (bounded) beats rejecting all valid traffic;
        // no cache (or too stale) → clean 401, never an escaped throw.
        if (!keys || now() - fetchedAt > JWKS_STALE_MAX_MS) return { ok: false, reason: `jwks unavailable: ${err.message}` };
        byKid = keys;
      }
      let key = byKid.get(jwt.header.kid);
      if (!key && now() - lastMissFetch > KID_REFRESH_MIN_MS) {
        lastMissFetch = now();
        try { byKid = await loadKeys(true); } catch { /* keep the cache */ }
        key = byKid.get(jwt.header.kid);
      }
      /* …signature/iss/aud unchanged… */
      // exp is MANDATORY: a signed token without a numeric exp must not become
      // a non-expiring credential on the public webhook.
      if (!Number.isFinite(p.exp)) return { ok: false, reason: 'missing or non-numeric exp' };
      if (nowSec > p.exp + CLOCK_SKEW_SEC) return { ok: false, reason: 'token expired' };
      if (p.nbf !== undefined && (!Number.isFinite(p.nbf) || nowSec < p.nbf - CLOCK_SKEW_SEC)) {
        return { ok: false, reason: 'token not yet valid' };
      }
```

- [ ] **Step 4:** `node --test test/teams-chat-worker.test.mjs` → PASS; `node src/cli/worca-cc.mjs plugin validate ./examples/plugins/teams-chat --strict` → OK.
- [ ] **Step 5: Commit**

```bash
git add examples/plugins/teams-chat/channel/jwt.mjs test/teams-chat-worker.test.mjs
git commit -m "fix(chat): teams JWT requires numeric exp; JWKS outages reject as 401 with stale-cache fallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 19: Teams conversation store — bounded + serialized (opus-5 max)

**Finding:** overflow (unbounded map, whole-map state frames, RMW race).

**Files:**
- Modify: `examples/plugins/teams-chat/channel/worker.mjs:23, 69-85`
- Test: `test/teams-chat-worker.test.mjs` (append)

- [ ] **Step 1: Write the failing tests.** No `makeWorker`/`activityFrame` helpers exist — build a small `convFixture()` over the file's real builders (`fakeCtx()`, `ACTIVITY(over)`, `frame(activity, auth)`, `tokenRoutes()`), with THREE properties the red phase NEEDS: (a) `ctx.state.get` returns a **fresh copy per call** (`JSON.parse(JSON.stringify(...))` after an `await`) — the real host round-trips state through JSON protocol frames, and a shared-reference stub makes the RMW race unobservable for a non-empty store; (b) inject a **monotonic `now`** into `createTeamsWorker` — `lastSeen` comes from the worker's clock (an activity `ts` field is inert), and distinct timestamps make eviction deterministic instead of leaning on V8's stable sort; (c) **every activity needs a UNIQUE `id`** — `handleWebhook` dedupes on `activity.id` (worker.mjs:150-154) BEFORE `rememberConversation`, and `ACTIVITY()` hardcodes `id: 'act-1'`, so without this both tests short-circuit on the dedupe and prove nothing:

```js
  let actSeq = 0;
  const webhookFor = (a) => frame({ ...a, id: `act-${++actSeq}` }, 'Bearer mock');
```

```js
test('conversation store caps at 200, evicting oldest lastSeen (LRU, not insertion order)', async () => {
  const { worker, state } = convFixture(); // fixture as described above; ctx.mock skips JWT
  for (let i = 0; i < 200; i++) {
    await worker.handleWebhook(webhookFor(ACTIVITY({ conversation: { id: `c${i}` } })));
  }
  // Re-see c0 BEFORE overflowing: a correct LRU keeps it and evicts c1 instead.
  // (Without this re-touch, insertion order and lastSeen order coincide and a
  // broken comparator is undetectable — verified by mutation.)
  await worker.handleWebhook(webhookFor(ACTIVITY({ conversation: { id: 'c0' } })));
  for (let i = 200; i < 205; i++) {
    await worker.handleWebhook(webhookFor(ACTIVITY({ conversation: { id: `c${i}` } })));
  }
  const all = state.get('conversations');
  assert.equal(Object.keys(all).length, 200);
  assert.ok(all.c0, 're-seen conversation survives');
  assert.equal(all.c1, undefined, 'least-recently-SEEN evicted, not first-inserted');
  assert.ok(all.c204);
});
test('concurrent inbound activities do not lose conversation refs (RMW serialized)', async () => {
  const { worker, state } = convFixture();
  await Promise.all([
    worker.handleWebhook(webhookFor(ACTIVITY({ conversation: { id: 'x' } }))),
    worker.handleWebhook(webhookFor(ACTIVITY({ conversation: { id: 'y' } }))),
  ]);
  const all = state.get('conversations');
  assert.ok(all.x && all.y, `lost a ref: ${JSON.stringify(Object.keys(all))}`);
});
```

- [ ] **Step 2: Run to verify they fail** (205 kept; concurrent write loses one ref with an async-gap state stub).
- [ ] **Step 3: Implement:**

```js
const MAX_CONVERSATIONS = 200; // unrelated to SEEN_LRU_MAX (activity-id dedupe), which already exists at line 23
```

```js
  let convChain = Promise.resolve(); // serialize read-modify-write on the conversations bag
  function rememberConversation(activity) {
    const work = async () => {
      const conv = activity.conversation;
      if (!conv?.id || !activity.serviceUrl) return;
      const all = await conversations();
      all[conv.id] = { /* …existing record unchanged… */ };
      const ids = Object.keys(all);
      if (ids.length > MAX_CONVERSATIONS) {
        // Numeric compare on Date.parse — total, tolerant of missing/garbage
        // lastSeen (sorts oldest), with an id tiebreaker for determinism.
        const ts = (id) => Date.parse(all[id]?.lastSeen ?? '') || 0;
        ids.sort((a, b) => ts(a) - ts(b) || (a < b ? -1 : a > b ? 1 : 0));
        const evicted = ids.slice(0, ids.length - MAX_CONVERSATIONS);
        for (const id of evicted) delete all[id];
        ctx.log('warn', `conversation store capped at ${MAX_CONVERSATIONS}; evicted ${evicted.length} least-recently-seen (proactive notify to an evicted chat needs the user to message the bot once)`);
      }
      await ctx.state.set('conversations', all);
    };
    convChain = convChain.then(work, work);
    return convChain;
  }
```

- [ ] **Step 4:** `node --test test/teams-chat-worker.test.mjs` → PASS; validate teams-chat `--strict`.
- [ ] **Step 5: Commit**

```bash
git add examples/plugins/teams-chat/channel/worker.mjs test/teams-chat-worker.test.mjs
git commit -m "fix(chat): teams conversation store bounded (200, LRU by lastSeen) and RMW-serialized

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 20: `channelHost.start(filter)` — CLI debugs ONE channel (opus-5 max)

**Finding:** #11 (foreground debug spawns every channel → Telegram 409 vs the live server).

**Files:**
- Modify: `src/core/chat/channel-host.mjs` (`start()` ~line 378-380)
- Modify: `src/cli/worca-cc.mjs` (channel subcommand ~line 1279-1315)
- Test: `test/channel-host.test.mjs` (append)

**Interfaces:**
- Produces: `start(filter?)` — `filter = {plugin, channelId}` starts only the matching entry; no filter = all (server unchanged at `channelHost.start()`).

- [ ] **Step 1: Failing test.** The existing `installFixture()` registers ONE plugin with ONE channel (`fixture-chat/main`), and `writePluginsLock` OVERWRITES the lock — so a second PLUGIN would evict the first. Extend the fixture (or add a variant) to register one plugin with TWO `chatChannels` entries (`main` + `alt`), and set mock mode so no children spawn:

```js
test('start({plugin, channelId}) spawns only the requested channel', async () => {
  installFixtureTwoChannels(); // fixture-chat with chatChannels ids 'main' and 'alt'
  process.env.WORCA_MOCK = '1';
  try {
    const host = createChannelHost({ logger: () => {} });
    host.start({ plugin: 'fixture-chat', channelId: 'main' });
    const rows = host.status();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].channelId, 'main');
    await host.stop();
  } finally { delete process.env.WORCA_MOCK; }
});
```

(CLI side: no test file covers `plugin channel` today and building one is out of proportion — the change is the single call-site `host.start({ plugin: name, channelId })` in the foreground branch (src/cli/worca-cc.mjs:1298); the task reviewer verifies it by eye, and `--check` (already scoped, :1286-1291) needs no change.)

- [ ] **Step 2: Run to verify it fails** (start takes no filter → 2 rows).
- [ ] **Step 3: Implement:**

```js
    /** Discover + start workers. With a filter, start ONLY that channel —
     *  `worca plugin channel` must not spawn every configured channel (a second
     *  telegram long-poller 409s the live server's worker). */
    start(filter) {
      for (const entry of discoverChannels()) {
        if (filter && (entry.plugin !== filter.plugin || entry.channelId !== filter.channelId)) continue;
        startEntry(entry);
      }
    },
```

CLI (`case 'channel'`, foreground branch): `host.start({ plugin: name, channelId });`

- [ ] **Step 4:** `node --test test/channel-host.test.mjs` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/core/chat/channel-host.mjs src/cli/worca-cc.mjs test/channel-host.test.mjs
git commit -m "fix(chat): worca plugin channel starts only the requested worker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 21: Discord gateway — stale INVALID_SESSION timer + jitter-then-interval heartbeat (fable-5 max)

**Finding:** overflow (stale timer closes the replacement socket; jitter beat racing the interval).

**Files:**
- Modify: `examples/plugins/discord-chat/channel/gateway.mjs:52-67, 97-103` (+ the `message` listener ~line 134)
- Test: `test/discord-chat-worker.test.mjs` (append; `FakeWebSocket` fixture exists — it records neither close codes nor beats, so add the two subclasses below)

- [ ] **Step 1: Write the failing tests.** REAL timers (node:test mock timers deadlock against the gateway's promise-driven connect loop); with `random: () => 0` the INVALID_SESSION floor makes the stale-timer test ~1.3s. Support classes (`FakeWebSocket.instances.push(this)` is in the base constructor, so subclass instances still register):

```js
class RecordingWS extends FakeWebSocket {
  close(code) { this.closedWith = code ?? 1000; super.close(code); }
}
class BeatWS extends FakeWebSocket {
  constructor(url) { super(url); this.beats = []; }
  send(data) {
    super.send(data);
    const f = JSON.parse(data);
    if (f.op === 1) { this.beats.push(Date.now()); this.frame({ op: 11 }); } // auto-ACK
  }
}

// gatewayFixture() hardcodes FakeWebSocket and random:()=>0.5 — add a variant
// that forwards overrides last into createGatewayClient:
//   function gatewayFixtureWith(over = {}) { … createGatewayClient({ …existing opts…, ...over }) … }

test('INVALID_SESSION close timer never fires on a replacement socket', async () => {
  // random:()=>0 → the delayed close lands at exactly 1000ms.
  const { client } = gatewayFixtureWith({ WebSocketImpl: RecordingWS, random: () => 0 });
  client.start();
  const s1 = await waitFor(() => FakeWebSocket.instances[0]);
  s1.frame({ op: 10, d: { heartbeat_interval: 100000 } });
  s1.frame({ op: 0, t: 'READY', s: 1, d: { session_id: 'sess', user: { username: 'bot' } } });
  s1.frame({ op: 9, d: true });          // INVALID_SESSION arms the delayed close on s1
  s1.close(4900);                        // client reconnects → s2
  const s2 = await waitFor(() => FakeWebSocket.instances[1]);
  await new Promise((r) => setTimeout(r, 1300)); // past the 1000ms timer
  assert.equal(s2.closedWith, undefined, 'stale timer must not kill the replacement');
  await client.stop();
});
test('INVALID_SESSION still closes the socket that received it (positive case)', async () => {
  const { client } = gatewayFixtureWith({ WebSocketImpl: RecordingWS, random: () => 0 });
  client.start();
  const s1 = await waitFor(() => FakeWebSocket.instances[0]);
  s1.frame({ op: 10, d: { heartbeat_interval: 100000 } });
  s1.frame({ op: 9, d: true });
  await waitFor(() => s1.closedWith !== undefined);
  assert.equal(s1.closedWith, 4901);     // green before AND after — guards the fix from over-reaching
  await client.stop();
});
test('heartbeat interval starts AFTER the jittered first beat, not in parallel', async () => {
  const { client } = gatewayFixtureWith({ WebSocketImpl: BeatWS, random: () => 0.5 });
  client.start();
  const s1 = await waitFor(() => FakeWebSocket.instances[0]);
  s1.frame({ op: 10, d: { heartbeat_interval: 100 } });
  await waitFor(() => s1.beats.length >= 4, 2000);
  const gaps = s1.beats.slice(1).map((t, i) => t - s1.beats[i]);
  for (const g of gaps) assert.ok(g >= 85, `beat gap ${g}ms < 85ms — the interval raced the jittered first beat (gaps: ${gaps})`);
  assert.equal(FakeWebSocket.instances.length, 1, 'no spurious ackPending self-kill / reconnect');
  await client.stop();
});
```

(REAL timers throughout — mock timers deadlock against the gateway's promise-driven connect loop. RED signatures before the fix, verified: test 1 `s2.closedWith === 4901`; test 3 gaps `[51, 101, 101]`. The v1 sketch asserted "#2 undefined AND #1 got 4901" in ONE test — unpassable after the fix: with the timer bound to the closed s1, it closes NOTHING. Keep the cases separate as above; adapt `waitFor`/`client` names to the file's actual fixture helpers if they differ.)

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** Thread the receiving socket into `handleFrame` — `ws` is module-level and may already point at a REPLACEMENT socket by the time a buffered frame is processed, so `const target = ws` inside the case is not enough:

```js
  function handleFrame(raw, owner) {          // owner = the socket this frame arrived on
```

```js
      case OP.INVALID_SESSION: {
        const resumable = frame.d === true;
        if (!resumable) { sessionId = null; resumeUrl = null; }
        log('warn', `gateway invalid session (resumable=${resumable})`);
        const target = owner ?? ws;           // never close a REPLACEMENT socket from this stale timer
        setTimeout(() => { if (ws === target) { try { target?.close(4901); } catch { /* noop */ } } },
          1000 + Math.floor(random() * 4000));
        break;
      }
```

and in the connect loop's message listener (~line 134):

```js
      socket.addEventListener('message', (e) => handleFrame(typeof e.data === 'string' ? e.data : String(e.data), socket));
```

Do NOT change `_debug.handleFrame`'s exported shape — the `owner ?? ws` fallback keeps single-argument callers working.

`startHeartbeat` — chain instead of racing:

```js
  const startHeartbeat = (intervalMs) => {
    stopHeartbeat();
    const beat = () => {
      if (ackPending) {
        log('warn', 'gateway heartbeat ACK missed — resuming');
        try { ws?.close(4009); } catch { /* already closed */ }
        return;
      }
      ackPending = true;
      send(OP.HEARTBEAT, seq);
    };
    // First beat after interval*jitter (gateway spec); the steady interval
    // starts only AFTER that first beat so the two never race.
    jitterTimer = setTimeout(() => {
      if (!running || !ws) return;
      beat();
      heartbeatTimer = setInterval(() => { if (running && ws) beat(); }, intervalMs);
    }, Math.floor(intervalMs * random()));
  };
```

- [ ] **Step 4:** `node --test test/discord-chat-worker.test.mjs` → PASS (existing heartbeat-loss/resume/4004/4014 tests must stay green); validate discord-chat `--strict`.
- [ ] **Step 5: Commit**

```bash
git add examples/plugins/discord-chat/channel/gateway.mjs test/discord-chat-worker.test.mjs
git commit -m "fix(chat): discord gateway — INVALID_SESSION timer can't close a replacement socket; heartbeat interval chains after the jittered first beat

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Phase 5 — Verification (opus-5 max)

### Task 22: README correction + full verification sweep

**Finding:** doc drift (telegram README claims commands are host-rate-limited; only notifications are).

**Files:**
- Modify: `examples/plugins/telegram-chat/README.md` (Security section)
- Verify: everything.

- [ ] **Step 1: Fix the README line** — replace:

`- Notifications and commands are rate-limited host-side (default 20 msg/min).`

with:

`- Notifications are rate-limited host-side (default 20 msg/min). Command
  replies are not rate-limited by the host — inbound is bounded by the
  allowlist; the worker's retry ladder absorbs platform 429s.`

- [ ] **Step 2: Full suite**

Run: `npm test`
Expected: pass count grows well past the 2288 baseline (dry-run clones landed ~2385+ with only half the new tests each); failures = EXACTLY the 4 pre-existing imagegen ones. Paste the `ℹ pass` / `ℹ fail` lines into the task report.

- [ ] **Step 3: Plugin validation + drift**

```bash
for p in telegram-chat slack-chat discord-chat teams-chat; do node src/cli/worca-cc.mjs plugin validate ./examples/plugins/$p --strict; done
node --test test/chat-lib-drift.test.mjs
```

Expected: 4× `OK`, drift PASS.

- [ ] **Step 3b: stdout-protocol lint** — `grep -rn "console\.log(" src/core/chat examples/plugins/*/channel examples/plugins/*/lib` → expected NO hits (worker/child stdout is protocol-reserved; T7's `htmlToPlain` and T19's eviction logging are the likely places a stray debug line hides. The paren form excludes the child's intentional `console.log = to('info')` shim at `channel-worker-child.mjs:39` — the assignment is the fix, not a violation).

- [ ] **Step 3c: mutation spot-audit** — re-run the deliberate-break checks and confirm each goes RED (this table was executed during plan refinement; re-running the plugin half is ~2 min):

| task | mutation | expected |
|---|---|---|
| T3 | discord: `return {identity}` instead of throwing on `/gateway/bot` failure | RED |
| T3 | slack: remove the transient throw (always degrade) | RED |
| T5 | drop `allowed_mentions` from the POST body | RED |
| T6 | un-escape one SLACK_STYLE channel (`text: (v) => v`) | RED |
| T7 | restore `lastIndexOf('\n', limit)` | RED |
| T8 | restore `result.replace(key, value)` | RED |
| T18 | restore optional exp (`Number.isFinite(p.exp) && …`) | RED (×2 tests) |
| T19 | remove the LRU cap | RED |
| T19 | remove the convChain | RED |
| T21 | unbind the INVALID_SESSION target (`ws?.close(4901)`) | RED |
| T21 | restore parallel jitter + interval | RED |
| T1 | remove `proc.on('error')` | RED |
| T2 | restore `w.consecutiveFailures = 0` in ready | RED |
| T2 | drop the `statusSinceSpawn` guard | RED |
| T9 | restore one snake_case read | RED |
| T10 | remove the wantLive filter | RED |
| T11 | restore bare `handlers[cmd]` lookup | RED |
| T14 | remove the queue (direct call) | RED |
| T15 | drop the SQL LIMIT | RED |
| T17 | reject free-text parts again | RED |

- [ ] **Step 4: Mock smoke** — `WORCA_MOCK=1 node --test test/chat-inbound-e2e.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/plugins/telegram-chat/README.md
git commit -m "docs(chat): telegram README — only notifications are host-rate-limited

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Deliberately NOT fixed (out of scope, note for the PR description)

- **Reserved config keys** (`notifyChatIds`/`allowedChatIds` read host-side from plugin config) — works as designed; formalizing them as manifest-level declarations is an API-3 discussion.
- **Hardcoded `teams` ingress path segment** — single-webhook-platform reality; generalize when a second webhook platform lands.
- **Badge state-map copy-paste (3×, one already drifted)** — `ui/public/app.js:6081`, `chat-settings-view.mjs:64`, and `plugins-view.mjs:80`; the plugins-view copy is missing `unconfigured`, so an unconfigured channel renders red there and amber elsewhere. Real (small) inconsistency, still deferred to a separate UI cleanup PR.
- **Per-message sync config re-reads** — correct (fresh allowlist per message) and cheap at chat rates.
- **`errKind` list duplicating ERROR_KINDS** — trivial to fix (the child already imports from `channel-protocol.mjs`), deferred only to avoid touching the protocol module in this PR.
- **Plugin-wide state.json key collisions between contributions** — real but needs a namespacing design (`state[channelId]`), API-level change.

## v2 verification record

- Finding re-verification: 23/23 confirmed against the working tree (0 refuted). Six re-scoped in place: T3 (discord `/users/@me` failure is silently *ignored* — `selfId=null`, worker reports connected, own-message filter dies), T7 (v1's newline fixture was green pre-fix), T8 (second `$`-interpreting restore site), T11 (impact = unknown-command bypass, not crash), T15 (`withPr` never ran in the chat path), T18 (v1's JWKS stub never threw).
- Executed dry-run: every Step-1/Step-3 snippet in this plan ran red→green on clones of this branch; plugin suites finished 53 pass / 0 fail with drift green and 4× `plugin validate --strict` OK.
- Mutation audit (plugins half): 11/11 deliberate fix-reversals went RED (table in Task 22). Core-half mutations recorded in Task 22 as well.
- Spec coverage: T1(#1), T2(#2,#5), T3(#6), T4(rpc/state overflow), T5(#4), T6(#3), T7(#12), T8($-restore overflow), T9(#7), T10(#8), T11(proto overflow), T12(resume overflow), T13(pause-sniff overflow), T14(#9), T15(#10), T16(#14), T17(#13), T18(#15), T19(teams-store overflow), T20(#11), T21(gateway overflow), T22(doc drift).
