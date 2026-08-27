# PR-361 Chat-Connectivity Review Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 15 reported + 7 overflow confirmed findings from the adversarial review of PR #361 (chat connectivity), on branch `feat/chat-connectivity`, without changing the feature's external contracts.

**Architecture:** Fixes cluster into 5 phases: (1) channel-supervisor/child lifecycle semantics, (2) vendored plugin lib + mention-injection hardening, (3) command-router/server correctness, (4) Teams JWT + gateway + CLI, (5) full verification. Every fix is TDD'd into the existing `node:test` suites; vendored-lib edits go through the telegram-chat canon and are recopied byte-identically (drift test enforces).

**Tech Stack:** Node ≥22 ESM, `node:test` + `node:assert/strict`, express+ws only (no new deps), vanilla DOM UI.

## Agent-model strategy (user requirement)

Dispatch each task to a fresh subagent via the Agent tool with an explicit model override. The session runs at **max effort**, which subagents inherit — so `model: "fable"` ⇒ Fable 5 max, `model: "opus"` ⇒ Opus 5 max.

| Model | Tasks | Why |
|---|---|---|
| **fable-5 (max)** | T1, T2, T3, T4, T14, T15, T16, T17, T18 | Cross-cutting semantics (supervisor lifecycle, serialization, core artifacts, resume guard-chain extraction, /answer contract design, JWT security) — judgment-heavy, regression-prone |
| **opus-5 (max)** | T5–T13, T19–T22 | Fully specified mechanical fixes with exact code in this plan |

**Per-task review gate:** after each task's subagent finishes, dispatch a reviewer subagent (spec + diff): `model: "opus"` for Phase 2/3 mechanical tasks, `model: "fable"` for Phase 1/4 lifecycle+security tasks and for the end-of-phase reviews. (This is the two-stage review from superpowers:subagent-driven-development, with the model pinned.)

**Parallelism map** (only with worktree isolation; otherwise run in numeric order):
- Phase 1 (T1→T2→T3→T4) serial — all touch `channel-host.mjs`/worker starts.
- Phase 2 (T5→T6→T7→T8) serial — shared vendored lib canon.
- Phase 3 (T9→T13 serial: same router/server files; then T14→T17 serial).
- Phase 4 {T18, T19} (teams), {T21} (gateway) independent of Phases 1–3 → may run in parallel worktrees; T20 depends on Phase 1 (touches `channel-host.mjs`).
- T22 strictly last, on the merged tree.

## Global Constraints

- Runtime deps stay **express + ws only** — add no packages.
- Vendored-lib rule: edit the canon `examples/plugins/telegram-chat/lib/*.mjs`, then recopy byte-identically to `slack-chat`, `discord-chat`, `teams-chat`; `test/chat-lib-drift.test.mjs` must pass in every commit. Recopy command (run from repo root):
  `for p in slack-chat discord-chat teams-chat; do cp examples/plugins/telegram-chat/lib/*.mjs examples/plugins/$p/lib/; done`
- Test runner: `node --test <files>`; full suite `npm test`.
- Suite baseline: 2288 tests, exactly 4 pre-existing failures allowed (`skills-bundle` / `skills-gate-wiring` expecting `skills/imagegen/`). **Zero new failures.**
- All 4 plugins must pass `node src/cli/worca-cc.mjs plugin validate ./examples/plugins/<p> --strict` at the end of any task touching `examples/plugins/`.
- **Never `console.log` in worker/child code paths** — stdout is protocol-reserved; use `ctx.log`.
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
- Produces: `createChannelHost({logger, onInbound, onStatus, _spawn, _backoffMs})` — `_spawn(cmd, args, opts)` defaults to `node:child_process.spawn`; `_backoffMs` defaults to `RESTART_BACKOFF_MS` (used by T2's test too). Exit handling extracted as a per-spawn `onExit(code, signal)` closure that is idempotent (`if (w.proc !== proc) return`).

- [ ] **Step 1: Write the failing test** — append to `test/channel-host.test.mjs`:

```js
test('a spawn "error" event never throws out of the host and schedules recovery', async () => {
  const { EventEmitter } = await import('node:events');
  const makeFakeProc = () => {
    const p = new EventEmitter();
    p.pid = undefined; // spawn failed: no pid
    p.killed = false;
    p.exitCode = null;
    p.kill = () => { p.killed = true; };
    p.stdin = new EventEmitter();
    p.stdin.write = () => { throw new Error('EPIPE'); };
    p.stdin.once = p.stdin.on.bind(p.stdin);
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.stderr.setEncoding = () => {};
    return p;
  };
  const spawned = [];
  const host = createChannelHost({
    logger: () => {},
    _backoffMs: [10, 10, 10, 10],
    _spawn: () => { const p = makeFakeProc(); spawned.push(p); return p; },
  });
  // Reuse the discovery-fixture idiom already used in this file to register one
  // channel entry (temp WORCA_HOME plugin with a chatChannels manifest), then:
  host.start();
  assert.equal(spawned.length, 1);
  spawned[0].emit('error', Object.assign(new Error('spawn EMFILE'), { code: 'EMFILE' }));
  await new Promise((r) => setTimeout(r, 50)); // > backoff 10ms
  assert.ok(spawned.length >= 2, 'error event routed into the restart path');
  const row = host.status()[0];
  assert.notEqual(row.state, 'connected');
  await host.stop();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/channel-host.test.mjs`
Expected: FAIL — unhandled `'error'` event (node:events throw) or `spawned.length === 1`.

- [ ] **Step 3: Implement** in `src/core/chat/channel-host.mjs`:

```js
// signature + defaults
export function createChannelHost({ logger, onInbound, onStatus, _spawn = spawn, _backoffMs = RESTART_BACKOFF_MS } = {}) {
```

Replace both `spawn(` call sites with `_spawn(`; replace both `RESTART_BACKOFF_MS[` reads with `_backoffMs[` (and `RESTART_BACKOFF_MS.length` with `_backoffMs.length`). Then in `spawnWorker`, extract the current `proc.on('exit', …)` body into a named closure and add the error listener:

```js
    const onExit = (code, signal) => {
      if (w.proc !== proc) return;            // already handled (error path ran first)
      clearInterval(w.pingTimer);
      w.proc = null;
      /* …existing exit-handler body unchanged from here down… */
    };
    proc.on('exit', onExit);
    // Async spawn/pipe failures (EMFILE, EAGAIN, EPIPE) must never become an
    // unhandled 'error' on the child: log, kill if half-alive, and if spawn
    // failed outright ('exit' will never fire) route into the same recovery.
    proc.on('error', (err) => {
      log('error', `[chat:${w.key}] worker process error: ${w.redact(err?.message || err)}`);
      if (proc.pid) { try { proc.kill('SIGKILL'); } catch { /* gone */ } }
      else onExit(-1, null);
    });
```

In `checkChannel`, add the same guards around the one-shot child:

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
- Modify: `src/core/chat/channel-host.mjs` (`handleFrame` 'ready'/'status' cases ~line 181–191; `spawnWorker` ~line 227; `makeRecord` ~line 303)
- Test: `test/channel-host.test.mjs` (append; uses T1's `_spawn`/`_backoffMs` injection)

**Interfaces:**
- Consumes: T1's `_spawn`, `_backoffMs`, `onExit` idempotence.
- Produces: worker record gains `statusSinceSpawn: boolean` (reset false in `spawnWorker`, set true on any worker `status` frame). Protocol unchanged.

- [ ] **Step 1: Write the failing tests** — append to `test/channel-host.test.mjs` (fake-proc helper from T1, extended so the test can push frames: give the fake `p.stdout` readline-compatible line emission via `p.stdout.emit('data', …)` is NOT how the host reads — the host wraps `proc.stdout` in readline, so make `p.stdout` a `new PassThrough()` from `node:stream` instead of an EventEmitter, and write protocol lines to it):

```js
test('ready after a worker "disconnected" status keeps the channel disconnected', async () => {
  // fake proc with PassThrough stdout; host under _spawn injection (T1)
  const w = spawnFakeWorker(host); // helper: returns { stdout } of the fake proc
  w.stdout.write(JSON.stringify({ type: 'status', state: 'disconnected', detail: 'auth failed — check botToken' }) + '\n');
  w.stdout.write(JSON.stringify({ type: 'ready', identity: null }) + '\n');
  await new Promise((r) => setTimeout(r, 20));
  const row = host.status()[0];
  assert.equal(row.state, 'disconnected');
  assert.match(row.detail, /auth failed/);
});

test('ready alone still flips a fresh worker to connected', async () => {
  const w = spawnFakeWorker(host);
  w.stdout.write(JSON.stringify({ type: 'ready', identity: '@bot' }) + '\n');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(host.status()[0].state, 'connected');
});

test('a connect-then-crash worker escalates backoff instead of looping at the floor', async () => {
  // _backoffMs: [10, 40, 40, 40]; fake worker emits ready then exits each spawn
  const delays = [];
  // capture via logger: 'restart in Xms' lines, or assert spawn timestamps spread
  // spawn #2 must come ~10ms after crash #1, spawn #3 must come ≥40ms after crash #2.
});
```

- [ ] **Step 2: Run to verify both behaviors fail** (`state === 'connected'` after auth-fail; all restarts at floor delay).

Run: `node --test test/channel-host.test.mjs`

- [ ] **Step 3: Implement** in `handleFrame` / `spawnWorker`:

```js
      case 'ready':
        w.identity = frame.identity ?? null;
        w.healthySince = Date.now();
        // NOT w.consecutiveFailures = 0 — the exit handler already forgives a
        // crash after HEALTHY_AFTER_MS of health; zeroing here let a
        // connect-then-crash worker restart at the 1s floor forever.
        // 'ready' is optimistic: it only claims 'connected' when the worker has
        // not already reported its own state this spawn (e.g. the documented
        // no-throw auth-failure pattern emits 'disconnected' BEFORE ready).
        if (!w.statusSinceSpawn) setStatus(w, 'connected', null);
        break;
      case 'status':
        w.statusSinceSpawn = true;
        setStatus(w, frame.state, frame.detail ?? null);
        break;
```

In `spawnWorker` (right after `w.spawnedAt = Date.now();`): `w.statusSinceSpawn = false;`
In `makeRecord`: add `statusSinceSpawn: false,`.

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

**Finding:** #6 (slack `auth.test` / discord `/users/@me` + `/gateway/bot` transient 429/5xx treated as permanent).

**Files:**
- Modify: `examples/plugins/slack-chat/channel/worker.mjs:132-142`
- Modify: `examples/plugins/discord-chat/channel/worker.mjs:33-57`
- Test: `test/slack-chat-worker.test.mjs`, `test/discord-chat-worker.test.mjs` (append)

**Interfaces:**
- Consumes: child contract — `start()` throw ⇒ child exit 1 ⇒ supervisor backoff restart (channel-worker-child.mjs:127-133); no-throw + `setStatus('disconnected')` ⇒ permanent until config reload (reserved for definitive auth failures).
- Produces: unchanged worker API.

- [ ] **Step 1: Write the failing tests:**

```js
// slack-chat-worker.test.mjs
test('start(): transient auth.test failure (5xx/429) throws so the supervisor restarts', async () => {
  const ctx = makeCtx(); // existing helper in this file
  const w = createSlackWorker(ctx, { fetchFn: async () => ({ status: 503, ok: false, headers: { get: () => null }, json: async () => ({}) }) });
  await assert.rejects(() => w.start(), /auth\.test failed/);
});
test('start(): definitive invalid_auth still degrades without throwing', async () => {
  const ctx = makeCtx();
  const w = createSlackWorker(ctx, { fetchFn: async () => ({ status: 200, ok: true, json: async () => ({ ok: false, error: 'invalid_auth' }) }) });
  const r = await w.start();
  assert.equal(r.identity, null);
  assert.equal(ctx.statuses.at(-1).state, 'disconnected');
});

// discord-chat-worker.test.mjs
test('start(): /gateway/bot 502 throws (supervisor retries); 401 on /users/@me does not', async () => {
  const seq = [
    { url: /users\/@me/, res: { status: 200, ok: true, json: async () => ({ id: '1', username: 'bot' }) } },
    { url: /gateway\/bot/, res: { status: 502, ok: false, json: async () => ({}) } },
  ];
  const w = createDiscordWorker(makeCtx(), { fetchFn: fetchFromSeq(seq), WebSocketImpl: FakeWS });
  await assert.rejects(() => w.start(), /gateway\/bot failed/);
});
```

- [ ] **Step 2: Run to verify they fail** (`start()` currently resolves).

- [ ] **Step 3: Implement.** Slack `start()`:

```js
    async start() {
      running = true;
      const auth = await slackApi(fetchFn, 'auth.test', botToken, null, ctx.shutdownSignal);
      if (!auth.ok) {
        const fatal = ['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked'].includes(auth.error);
        const detail = `auth.test failed: ${auth.error || `HTTP ${auth.httpStatus}`}`;
        if (fatal) { setStatus('disconnected', `${detail} — check botToken`); return { identity: null }; }
        // Transient (429/5xx/network-ish): crash so the supervisor restarts with backoff.
        throw Object.assign(new Error(detail), { kind: auth.httpStatus === 429 ? 'rate-limit' : 'network' });
      }
      /* …rest unchanged… */
```

Discord `start()` — keep the 401 no-throw path; make every other failure throw:

```js
      const res = await fetchFn(`${DISCORD_API}/users/@me`, { headers: authHeaders, signal: ctx.shutdownSignal });
      if (res.status === 401) {
        ctx.setStatus('disconnected', 'Discord rejected the bot token — check botToken');
        return { identity: null };
      }
      me = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(`GET /users/@me failed: HTTP ${res.status}`), { kind: res.status === 429 ? 'rate-limit' : 'network' });
      // (drop the outer try/catch's swallow: keep the catch that re-throws after setStatus)
      …
      const gw = await fetchFn(`${DISCORD_API}/gateway/bot`, { headers: authHeaders, signal: ctx.shutdownSignal });
      const gwData = await gw.json().catch(() => ({}));
      if (!gw.ok || !gwData.url) {
        ctx.setStatus('disconnected', `GET /gateway/bot failed: HTTP ${gw.status}`);
        throw Object.assign(new Error(`GET /gateway/bot failed: HTTP ${gw.status}`), { kind: gw.status === 429 ? 'rate-limit' : 'network' });
      }
      if (gwData.session_start_limit?.remaining === 0) {
        const detail = `gateway session limit exhausted — resets in ${Math.ceil((gwData.session_start_limit.reset_after || 0) / 60000)}min`;
        ctx.setStatus('disconnected', detail);
        throw Object.assign(new Error(detail), { kind: 'rate-limit' });
      }
```

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
- Test: `test/channel-host.test.mjs`, `test/channel-protocol.test.mjs` (append)

**Interfaces:** none new; behavior only.

- [ ] **Step 1: Failing test** (host): fake worker (T1/T2 helper) that never answers; fill the queue while backpressured; assert after `sendMessage` timeout the frame id is no longer in flight — observable via a second send succeeding without the first's frame being written. Simpler observable: expose nothing — instead assert timing: with `timeoutMs: 30`, `sendMessage` rejects with kind `timeout`, and the fake proc's written frames (capture `p.stdin.write`) do NOT later include the timed-out id when the queue flushes (trigger flush by emitting `drain`).

- [ ] **Step 2: Run to verify it fails** (frame still flushed after timeout).

- [ ] **Step 3: Implement.** Host `rpc` timeout callback:

```js
    const timer = setTimeout(() => {
      w.pending.delete(frame.id);
      const qi = w.outQueue.findIndex((f) => f && f.id === frame.id);
      if (qi >= 0) { w.outQueue.splice(qi, 1); w.dropped += 1; }
      rejectRpc(new PluginOpError(kindOnTimeout, `worker did not answer within ${timeoutMs}ms`));
    }, timeoutMs);
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
git add src/core/chat/channel-host.mjs src/core/chat/channel-worker-child.mjs test/channel-host.test.mjs test/channel-protocol.test.mjs
git commit -m "fix(chat): timed-out RPC frames leave the outbound queue; oversize state-deltas warn

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
  const w = createDiscordWorker(makeCtx(), {
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

In `toSlackMrkdwn` (line ~143), run `escapeSlackText` on the three transform channels of `processWithCodeProtection` — i.e. wrap the existing `transformText` result and apply it to the code-block/inline-code contents too (code spans still render `&lt;` literally in Slack, which is the safe direction). In canon `segments.mjs` replace `SLACK_STYLE` with:

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
  const s = 'a'.repeat(9) + '\n' + 'b'.repeat(9); // newline at index 9 with limit 10
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
  const w = createTelegramWorker(makeCtx(), { fetchFn, _sleep: async () => {} });
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
    // Never cut between a surrogate pair.
    const cc = rest.charCodeAt(cut - 1);
    if (cc >= 0xd800 && cc <= 0xdbff) cut -= 1;
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

and rework the per-chunk send:

```js
    async send(chatId, msg) {
      const chunks = splitText(renderToHtml(msg), MAX_MESSAGE_CHARS);
      for (const text of chunks) {
        let asPlain = false; // flips when Telegram rejects the HTML (tag split across a chunk boundary)
        await withRetryLadder(async () => {
          let res;
          try {
            res = await fetchFn(api('sendMessage'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(asPlain
                ? { chat_id: chatId, text: htmlToPlain(text) }
                : { chat_id: chatId, text, parse_mode: 'HTML' }),
            });
          } catch (err) {
            throw sendError('network', err?.message || String(err));
          }
          if (res.status === 429) { /* …unchanged… */ }
          if (res.status === 401) throw sendError('auth', 'auth failed — check botToken');
          if (res.status === 403) throw sendError('plugin', 'bot is blocked by this chat or was never started — open the chat and /start it');
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const desc = data.description || `HTTP ${res.status}`;
            if (!asPlain && res.status === 400 && /can't parse entities/i.test(desc)) {
              asPlain = true;
              return { retryAfterMs: 1 }; // reuse the ladder for one immediate plain retry
            }
            throw sendError('plugin', `sendMessage failed: ${desc}`);
          }
          return undefined;
        }, _sleep);
      }
      return { ok: true, chunks: chunks.length };
    },
```

- [ ] **Step 4: Recopy + run**

```bash
for p in slack-chat discord-chat teams-chat; do cp examples/plugins/telegram-chat/lib/*.mjs examples/plugins/$p/lib/; done
node --test test/telegram-chat-worker.test.mjs test/chat-lib-drift.test.mjs test/slack-chat-worker.test.mjs test/discord-chat-worker.test.mjs test/teams-chat-worker.test.mjs
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
test('code spans containing $-replacement patterns survive markdown conversion verbatim', () => {
  const out = toTelegramHtml('run `sed s/a/$&/` now');
  assert.match(out, /sed s\/a\/\$&(amp;)?\//); // the $& must not duplicate surrounding text
  const out2 = toSlackMrkdwn("pattern `$'` and ```$`\n``` end");
  assert.ok(out2.includes("$'"), 'inline $-pattern survives');
});
```

- [ ] **Step 2: Run to verify it fails** (value's `$&` interpreted by `String.replace`).
- [ ] **Step 3: Implement** — in `processWithCodeProtection`'s restore loop, replace every `result = result.replace(key, value)`-shaped restore with the function form (a function replacement never interprets `$` patterns):

```js
  for (const { key, value } of placeholders) {
    result = result.replace(key, () => value);
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

- [ ] **Step 1: Failing test** — replace every history-row stub in `test/chat-command-router.test.mjs` shaped `{ total_cost_usd, total_active_ms, pause_reason }` with the real camelCase shape, and add:

```js
test('/cost and /last read the real camelCase history-entry fields', async () => {
  const router = makeRouter({ history: async () => [{ id: 'p-1234', title: 'T', status: 'done', totalCostUsd: 2.5, totalActiveMs: 61000, pauseReason: null }] });
  const cost = await handle(router, '/cost *1234');
  assert.match(cost.body[0].value, /\$2\.50/);
  const last = await handle(router, '/last');
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
  const router = makeRouter({ listRuns: () => [{ runId: 'r-2951', title: 'Done run', status: 'done' }] });
  const out = await handle(router, '/stop *2951');
  assert.match(out.body[0].value, /No live run matches/);
  const out2 = await handle(router, '/stop');
  assert.match(out2.body[0].value, /No live runs/);
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
  for (const cmd of ['/constructor', '/__proto__', '/hasownproperty', '/tostring']) {
    const out = await handle(router, cmd);
    assert.match(out.body[0].value, /Unknown command/, cmd);
  }
});
```

- [ ] **Step 2: Run to verify `/constructor` fails the assertion.**
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
  const router = makeRouter({ history: async () => rows });
  const out = await handle(router, '/resume');
  assert.match(out.body[0].value, /Ambiguous/);
  assert.match(out.body[0].value, /\*aaaa/);
  assert.match(out.body[0].value, /\*bbbb/);
});
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** — in the resume handler's error branch, insert the >1 case first:

```js
      if (t.error) {
        if (!args[0] && rows.length > 1) {
          return disambiguate(rows.map((r) => ({ id: r.id, title: r.title, status: r.status })));
        }
        if (!args[0] && rows.length === 1) return handlers.resume({ chatKey, args: [`*${rows[0].id.slice(-4)}`] });
        if (!args[0] && !rows.length) return reply('Nothing is paused.', 'warning');
        return t.error;
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
- Modify: `ui/server.mjs` (`pauseRun` ~line 1065-1070; `/api/pause` route ~line 1117)
- Test: `test/chat-inbound-e2e.test.mjs` or the server-route test that covers /api/pause (append where /api/pause is already exercised)

- [ ] **Step 1: Failing test** — assert the thrown error carries `code`:

```js
test('pauseRun signals CANNOT_PAUSE via err.code, not message text', async () => {
  const { chatActions } = _testing;
  // seed a runs-map entry whose orch.pause() returns false (fixture idiom used by the gate e2e test)
  await assert.rejects(() => Promise.resolve(chatActions.pause(runId)), (err) => err.code === 'CANNOT_PAUSE');
});
```

- [ ] **Step 2: Run to verify it fails** (`code` undefined).
- [ ] **Step 3: Implement:**

```js
function pauseRun(runId) {
  const entry = runs.get(runId);
  if (!entry) throw new Error('unknown runId');
  const ok = typeof entry.orch?.pause === 'function' && entry.orch.pause();
  if (!ok) throw Object.assign(new Error('cannot pause in the current state'), { code: 'CANNOT_PAUSE' });
}
```

Route:

```js
  } catch (err) {
    if (err?.code === 'CANNOT_PAUSE') return badRequest(res, err.message);
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
```

- [ ] **Step 4:** `node --test test/chat-inbound-e2e.test.mjs` (plus the file the new test landed in) → PASS.
- [ ] **Step 5: Commit**

```bash
git add ui/server.mjs test/chat-inbound-e2e.test.mjs
git commit -m "fix(chat): pauseRun throws err.code CANNOT_PAUSE — route stops sniffing message text

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 14: Per-chat serialization of inbound commands (fable-5 max)

**Finding:** #9 (batched same-chat commands interleave: stale reads, out-of-order replies).

**Files:**
- Modify: `ui/server.mjs` (`channelHost` onInbound wiring ~line 1025-1029; add queue helper above `handleChatInbound`)
- Test: `test/chat-inbound-e2e.test.mjs` (append)

**Interfaces:**
- Produces: `enqueueChatWork(key, fn)` module-level helper (exported via `_testing` for the test); onInbound key = `${plugin}/${channelId}/${msg.chatId}`.

- [ ] **Step 1: Failing test:**

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
  } finally { _testing.chatActions.listProjects = orig; }
});
```

- [ ] **Step 2: Run to verify it fails** (`/runs` reply arrives first).
- [ ] **Step 3: Implement** in `ui/server.mjs`:

```js
// Same-chat commands must run strictly in order: a batched ['/use beta','/runs']
// from one getUpdates poll otherwise interleaves (stale reads, replies out of
// order). One promise chain per (plugin, channel, chat); dropped when idle.
const chatQueues = new Map();
function enqueueChatWork(key, fn) {
  const prev = chatQueues.get(key) || Promise.resolve();
  const tail = prev.then(fn, fn); // run even after a prior failure
  const tracked = tail.finally(() => { if (chatQueues.get(key) === tracked) chatQueues.delete(key); });
  chatQueues.set(key, tracked);
  return tracked;
}
```

Wire it:

```js
const channelHost = createChannelHost({
  logger: (level, msg) => console.error(`[worca-ui] ${msg}`),
  onInbound: (ev) => { enqueueChatWork(`${ev.plugin}/${ev.channelId}/${ev.msg.chatId}`, () => handleChatInbound(ev)); },
  onStatus: (ev) => { try { broadcast({ type: 'channel-status', ...ev }); } catch { /* pre-listen */ } },
});
```

Add `enqueueChatWork` to the `_testing` export at the bottom of the file.

- [ ] **Step 4:** `node --test test/chat-inbound-e2e.test.mjs` → PASS (all existing e2e tests too — they use `injectInboundMessage` which now rides the queue; add a short settle-wait where needed).
- [ ] **Step 5: Commit**

```bash
git add ui/server.mjs test/chat-inbound-e2e.test.mjs
git commit -m "fix(chat): serialize inbound command handling per chat

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 15: Cheap chat history — `listAllPipelines({limit, lite})` (fable-5 max)

**Finding:** #10 (every /status spawns ~2 git subprocesses per pipeline, full history for limit:1).

**Files:**
- Modify: `src/core/artifacts.mjs` (`listAllPipelines` ~line 1481; `rowToHistoryEntry` callers inside it)
- Modify: `ui/server.mjs` (`chatActions.history` ~line 993)
- Test: `test/chat-command-router.test.mjs` untouched; add to the artifacts test file that already covers `listAllPipelines` (locate via `grep -rn "listAllPipelines" test/`), plus an assertion in `test/chat-inbound-e2e.test.mjs` that history flows still work.

**Interfaces:**
- Produces: `listAllPipelines(opts)` gains `opts.limit` (integer — SQL `LIMIT ?`) and `opts.lite` (boolean — skip ALL git work: pass `repoDir = null` into `rowToHistoryEntry`, so `survived:false, added:0, removed:0`, and never `withPr`). Both default off — existing callers unchanged.
- Consumes: `chatActions.history` becomes `({ limit = 50 } = {}) => listAllPipelines({ limit, lite: true })`.

- [ ] **Step 1: Failing test** (artifacts test file):

```js
test('listAllPipelines lite+limit: bounded rows, zero git enrichment', async () => {
  // seed 3 pipelines via the file's existing DB fixture helper
  const rows = await listAllPipelines({ limit: 2, lite: true });
  assert.equal(rows.length, 2);
  for (const r of rows) { assert.equal(r.survived, false); assert.equal(r.added, 0); }
});
```

- [ ] **Step 2: Run to verify it fails** (no `limit` support — returns 3).
- [ ] **Step 3: Implement.** In `listAllPipelines`:

```js
export async function listAllPipelines(opts = {}, { batchSize = 16 } = {}) {
  const limitSql = Number.isInteger(opts.limit) && opts.limit > 0 ? ` LIMIT ${opts.limit}` : '';
  const rows = getDb().prepare(`
    SELECT id, project_key, workspace_key, target, title, status, started_at, updated_at,
           total_cost_usd, total_active_ms, branch, workspace_meta, guardrails_id,
           json_extract(CASE WHEN json_valid(resume_point) THEN resume_point END, '$.pauseReason') AS pause_pause_reason_placeholder -- keep original alias
    FROM pipelines
    WHERE archived_at IS NULL
    ORDER BY started_at DESC${limitSql}
  `).all();
```

(Keep the original `AS pause_reason` alias — the placeholder note above is only to flag: change NOTHING but the appended `${limitSql}`.) Then in phase 1's task mapping, when `opts.lite` force `repoDir` to null so `rowToHistoryEntry` skips `branchExists`/`diffShortstat` (find the line assigning the row's repoDir in the `tasks = rows.map(...)` block and wrap: `repoDir: opts.lite ? null : resolvedRepoDir`).

In `ui/server.mjs`:

```js
  history: async ({ limit = 50 } = {}) => (await listAllPipelines({ limit, lite: true })) || [],
```

- [ ] **Step 4:** `node --test <artifacts test file> test/chat-inbound-e2e.test.mjs test/chat-command-router.test.mjs` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/core/artifacts.mjs ui/server.mjs <artifacts test file>
git commit -m "fix(chat): chat history uses lite+limited listAllPipelines — no git storm per /status

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 16: Extract `resumeRun()` — chat resume stops self-fetching (fable-5 max)

**Finding:** #14 (loopback self-fetch breaks under WORCA_HOST / can hit a different instance).

**Files:**
- Modify: `ui/server.mjs` (`/api/resume` route ~line 1127-1240; `chatActions.resume` ~line 981-992)
- Test: `test/chat-inbound-e2e.test.mjs` (append) + whatever existing test exercises POST /api/resume (must stay green)

**Interfaces:**
- Produces: `async function resumeRun(pipelineId, { ignoreCostCap = false, mock = false } = {})` → resolves `{ ok: true, runId }`; throws `ResumeError` with `.status` (HTTP code) and `.body` (JSON payload) for every guard rejection. Route becomes a thin mapper; `chatActions.resume` calls it directly.

- [ ] **Step 1: Failing test:**

```js
test('chat /resume works without a loopback self-fetch (direct helper call)', async () => {
  // Fixture: seed one paused pipeline in the temp DB (reuse the resume fixture
  // idiom from the existing /api/resume test), then:
  const out = await _testing.chatActions.resume(pipelineId);
  assert.equal(out.ok, true);
});
test('resumeRun maps guard failures to typed errors', async () => {
  await assert.rejects(() => _testing.resumeRun('nope'), (e) => e.status === 404);
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
     the mock flag: const effMock = mock || isTruthy(process.env.WORCA_MOCK ?? process.env.ORCH_MOCK); … */
  return { ok: true, runId };
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

Add `resumeRun` to `_testing`. **Behavior must be byte-identical for every guard — diff the moved block against the original during review.**

- [ ] **Step 4:** `node --test test/chat-inbound-e2e.test.mjs` + the existing /api/resume suite + `npm test` spot: `node --test $(grep -rln "api/resume" test/)` → PASS.
- [ ] **Step 5: Commit**

```bash
git add ui/server.mjs test/chat-inbound-e2e.test.mjs
git commit -m "fix(chat): extract resumeRun() — chat resume no longer self-fetches 127.0.0.1

The loopback fetch broke under WORCA_HOST and could target a different
instance on 4317. Route and chat share one guard chain now.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 17: `/answer` free-text support (fable-5 max)

**Finding:** #13 (zero-option clarify questions unanswerable from chat).

**Files:**
- Modify: `src/core/chat/command-router.mjs:223-248` (answer handler), `src/core/chat/renderers.mjs:116-125` (instruction line)
- Test: `test/chat-command-router.test.mjs`, `test/chat-notifier.test.mjs` (renderer assertion)

**Interfaces:**
- Consumes: clarify answer payload `{answers: [{id, choice}]}` where free text is also a `choice` string (ui/public/app.js:8133, orchestrator.mjs:368); question shape `{id, question, options, allowFreeText}` — `allowFreeText !== false` means free text allowed.
- Produces: chat syntax — pure-ordinal form unchanged; NEW pipe form `/answer [*ref] a1 | a2 | …` where each `aN` is an ordinal (options exist and it parses in-range) or free text otherwise.

- [ ] **Step 1: Failing tests:**

```js
test('/answer answers a zero-option free-text question', async () => {
  const pq = { id: 'q1', kind: 'clarify', questions: [{ id: 'k', question: 'Name?', options: [] }] };
  const answered = [];
  const router = makeRouter({ pendingQuestion: () => pq, answer: (r, id, p) => answered.push(p), listRuns: liveOne });
  const out = await handle(router, '/answer call it worca');
  assert.deepEqual(answered, [{ answers: [{ id: 'k', choice: 'call it worca' }] }]);
  assert.match(out.body[0].value, /Answered 1 question/);
});
test('/answer mixes ordinals and free text with the pipe separator', async () => {
  const pq = { id: 'q1', kind: 'clarify', questions: [
    { id: 'a', question: 'Pick', options: ['x', 'y'] },
    { id: 'b', question: 'Describe', options: [] },
  ]};
  const answered = [];
  const router = makeRouter({ pendingQuestion: () => pq, answer: (r, id, p) => answered.push(p), listRuns: liveOne });
  await handle(router, '/answer 2 | free text here');
  assert.deepEqual(answered[0].answers, [{ id: 'a', choice: 'y' }, { id: 'b', choice: 'free text here' }]);
});
test('renderQuestion instructs the pipe form when a question is free-text', () => {
  const msg = renderQuestion({ runId: 'r-ab12' }, { kind: 'clarify', questions: [{ id: 'k', question: 'Name?', options: [] }] });
  assert.match(msg.body[0].value, /\/answer \*ab12 <your answer>/);
});
```

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
      // Pure-ordinal fast path (back-compat): "1 2 3" with every question offering options.
      const tokens = rest.split(/\s+/);
      const allOrdinals = tokens.every((tk) => /^\d+$/.test(tk));
      const everyHasOptions = questions.every((q) => (q.options || []).length > 0);
      const parts = allOrdinals && everyHasOptions && !rest.includes('|')
        ? tokens
        : rest.split('|').map((s) => s.trim());
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
          answers.push({ id: q.id, choice: part });   // free text is a choice string (app.js:8133)
        } else if (!opts.length) {
          return reply(`Q${i + 1} needs a free-text answer.`, 'warning');
        } else {
          return reply(`Q${i + 1} is options-only (1–${opts.length}).`, 'warning');
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

- [ ] **Step 4:** `node --test test/chat-command-router.test.mjs test/chat-notifier.test.mjs test/chat-inbound-e2e.test.mjs` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/core/chat/command-router.mjs src/core/chat/renderers.mjs test/chat-command-router.test.mjs test/chat-notifier.test.mjs
git commit -m "fix(chat): /answer supports free-text clarify answers (pipe-separated)

Zero-option questions were unanswerable from chat while the notification
instructed an unsatisfiable '/answer <ref> 1'.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Phase 4 — Teams, gateway, CLI

### Task 18: Teams JWT — require `exp`, survive JWKS failures as 401 (fable-5 max)

**Finding:** #15.

**Files:**
- Modify: `examples/plugins/teams-chat/channel/jwt.mjs:45-57, 72-93`
- Test: `test/teams-chat-worker.test.mjs` (append — reuse its self-minted RS256 helper)

- [ ] **Step 1: Failing tests:**

```js
test('a signed token WITHOUT exp is rejected (fail closed)', async () => {
  const token = mintToken({ iss: ISSUER, aud: APP_ID, serviceurl: SVC }); // no exp
  const v = createJwtValidator({ appId: APP_ID, fetchFn: jwksFetch, now: () => NOW });
  const r = await v.validate(`Bearer ${token}`, SVC);
  assert.equal(r.ok, false);
  assert.match(r.reason, /exp/);
});
test('a JWKS outage yields ok:false (→401), not a thrown 500', async () => {
  const v = createJwtValidator({ appId: APP_ID, fetchFn: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  const r = await v.validate(`Bearer ${mintToken(validClaims())}`, SVC);
  assert.equal(r.ok, false);
  assert.match(r.reason, /jwks/i);
});
test('a string exp is rejected', async () => {
  const token = mintToken({ ...validClaims(), exp: 'never' });
  const r = await validator.validate(`Bearer ${token}`, SVC);
  assert.equal(r.ok, false);
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

`validate` — wrap key loading (stale cache beats an outage; outage with no cache = clean reject) and harden the time checks:

```js
      let byKid;
      try { byKid = await loadKeys(); } catch (err) {
        if (!keys) return { ok: false, reason: `jwks unavailable: ${err.message}` };
        byKid = keys; // stale cache still beats rejecting valid traffic
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

- [ ] **Step 1: Failing tests:**

```js
test('conversation store caps at 200, evicting oldest lastSeen', async () => {
  const { worker, state } = makeWorker(); // existing fixture helper with mock ctx.state
  for (let i = 0; i < 205; i++) {
    await worker.handleWebhook(activityFrame({ conversationId: `c${i}`, ts: i })); // ctx.mock=true skips JWT
  }
  const all = state.conversations;
  assert.equal(Object.keys(all).length, 200);
  assert.equal(all.c0, undefined, 'oldest evicted');
  assert.ok(all.c204);
});
test('concurrent inbound activities do not lose conversation refs (RMW serialized)', async () => {
  await Promise.all([worker.handleWebhook(activityFrame({ conversationId: 'x' })), worker.handleWebhook(activityFrame({ conversationId: 'y' }))]);
  assert.ok(state.conversations.x && state.conversations.y);
});
```

- [ ] **Step 2: Run to verify they fail** (205 kept; concurrent write loses one ref with an async-gap state stub).
- [ ] **Step 3: Implement:**

```js
const SEEN_LRU_MAX = 200;
const MAX_CONVERSATIONS = 200;
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
        ids.sort((a, b) => String(all[a]?.lastSeen || '').localeCompare(String(all[b]?.lastSeen || '')));
        for (const id of ids.slice(0, ids.length - MAX_CONVERSATIONS)) delete all[id];
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

- [ ] **Step 1: Failing test:**

```js
test('start({plugin, channelId}) spawns only the requested channel', async () => {
  // fixture with TWO chatChannels registered (two plugins or two ids)
  const host = createChannelHost({ logger: () => {} });
  host.start({ plugin: 'chan-a', channelId: 'main' });   // WORCA_MOCK path: no real spawns
  const rows = host.status();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].plugin, 'chan-a');
  await host.stop();
});
```

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

### Task 21: Discord gateway — stale INVALID_SESSION timer + jitter-then-interval heartbeat (opus-5 max)

**Finding:** overflow (stale timer closes the replacement socket; jitter beat racing the interval).

**Files:**
- Modify: `examples/plugins/discord-chat/channel/gateway.mjs:52-67, 97-103`
- Test: `test/discord-chat-worker.test.mjs` (append, FakeWS fixture already exists)

- [ ] **Step 1: Failing tests:**

```js
test('INVALID_SESSION close targets the socket that received it, not a replacement', async () => {
  // connect FakeWS #1, deliver INVALID_SESSION (random()=0 → 1000ms delay),
  // close #1 immediately so the client reconnects to FakeWS #2,
  // advance past the delayed close, assert #2.closedWith is undefined and #1 got 4901.
});
test('heartbeat interval starts AFTER the jittered first beat, not in parallel', async () => {
  // HELLO with heartbeat_interval=100, random()=0.5 → first beat at ~50ms.
  // Collect beat timestamps from FakeWS.sent; assert gaps after the first beat
  // are ~100ms (no double-beat inside one interval, no ackPending self-kill).
});
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** INVALID_SESSION case — bind the socket:

```js
      case OP.INVALID_SESSION: {
        const resumable = frame.d === true;
        if (!resumable) { sessionId = null; resumeUrl = null; }
        log('warn', `gateway invalid session (resumable=${resumable})`);
        const target = ws; // never close a REPLACEMENT socket from this stale timer
        setTimeout(() => { if (ws === target) { try { target?.close(4901); } catch { /* noop */ } } }, 1000 + Math.floor(random() * 4000));
        break;
      }
```

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
Expected: 2288+ tests (new ones added), failures = EXACTLY the 4 pre-existing imagegen ones. Paste the `ℹ pass` / `ℹ fail` lines into the task report.

- [ ] **Step 3: Plugin validation + drift**

```bash
for p in telegram-chat slack-chat discord-chat teams-chat; do node src/cli/worca-cc.mjs plugin validate ./examples/plugins/$p --strict; done
node --test test/chat-lib-drift.test.mjs
```

Expected: 4× `OK`, drift PASS.

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
- **Badge state-map copy-paste (3×)** — cosmetic UI dedup, separate cleanup PR.
- **Per-message sync config re-reads** — correct (fresh allowlist per message) and cheap at chat rates.
- **`errKind` list duplicating ERROR_KINDS** — child must stay dependency-light; acceptable duplication.
- **Plugin-wide state.json key collisions between contributions** — real but needs a namespacing design (`state[channelId]`), API-level change.

## Self-review checklist (ran at plan time)

- Spec coverage: 15/15 reported findings → T1(1), T2(2,5), T3(6), T5(4), T6(3), T7(12), T9(7), T10(8), T11–T13+T19+T21 (overflow), T14(9), T15(10), T16(14), T17(13), T18(15), T20(11), T4 (overflow rpc/state). Refuted items untouched. ✓
- Placeholder scan: the two `/* …unchanged… */` markers refer to code that must stay verbatim (they mark NO-change regions, not TODOs). ✓
- Type consistency: `_spawn`/`_backoffMs` (T1) consumed by T2/T4 tests; `statusSinceSpawn` (T2) internal; `start(filter)` (T20) matches CLI call; `escapeSlackText` export (T6) import direction markdown→segments matches existing. ✓
