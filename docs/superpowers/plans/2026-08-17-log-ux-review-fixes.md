# Log-UX Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 15 verified findings from the `feat/log-ux` code review — stderr framing correctness in claude-runner, error-visibility gaps in the orchestrator, `stream:'err'` provenance honesty, and the UI's projection/separator/copy/trim/perf/duplication defects.

**Architecture:** Backend first (claude-runner reuses the stdout readline for stderr; orchestrator gets a strict `isAbort`, one shared terminal-error helper used by both the normal and decomposed paths, and one provenance seam `errStreamAttr`). Then the UI (one shared NDJSON projection, look-through cycle-separator semantics carried by a `prevCycle` value, serializer/copy/trim fixes, compiled filters + fragment batching, and a single template-sourced filter bar).

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert/strict`, jsdom for UI tests (real `app.js` booted against real `index.html`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-17-log-ux-review-findings.md` (findings F1–F15; each task names the findings it fixes).

## Global Constraints

- Test runner: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/<file>.mjs` for single files; full suite `npm test` (recreates `.worca-cc-test`). The suite is fully green at baseline — keep it that way after every task.
- All code is plain ESM JavaScript; UI modules under `ui/public/*.mjs` must stay browser-loadable (no Node imports).
- `ui/public/log-line.mjs` and `ui/public/log-filter.mjs` are PURE and DOM-free by contract — keep them that way.
- Match existing comment style: comments state constraints/rationale, never narrate the change.
- Conventional commits (`fix(runner):`, `fix(pipeline):`, `fix(ui):`, `perf(ui):`, `refactor(ui):`, `test(pipeline):`). End every commit message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- NEVER `git add docs/` — plan + spec stay untracked (standing project rule).
- Existing fake-bin helpers in `test/runner-error-surface.test.mjs` (`fakeBin`, `fakeShell`, `stderrEvents`) are the harness for runner tests; `boot()` in `test/ui-history-logs.test.mjs` and `bootLive()` in `test/ui-running-resume.test.mjs` are the jsdom harnesses; `window.__np` is the app-internals test hook.

## File Structure

- `src/core/claude-runner.mjs` — stderr framing (Tasks 1–3). All edits inside `runReal`.
- `src/core/orchestrator.mjs` — `isAbort`, `_logStepFailure`, decomposed wiring, `errStreamAttr` + provenance call sites (Tasks 4–6).
- `src/core/agent-gen.mjs`, `src/core/workspace-scan.mjs` — local `isAbort` copies, same one-line tightening (Task 4).
- `src/core/worktree.mjs` — additive `fromStderr` on failure results (Task 6).
- `test/agent-log.test.mjs` — de-vacuous the stderr-branch test (Task 7).
- `ui/public/log-line.mjs` — `projectLogRecord`, new `cycleSeparatorBefore` semantics, separator-aware `serializeLog` (Tasks 8–10).
- `ui/public/log-filter.mjs` — `compileLogFilter` (Task 13).
- `ui/public/app.js` — seed projection, `appendLogRec`/`prevCycle`, copy feedback, `trimLogDom`, fragment repaints + History cap, shared filter bar/reader/debounce (Tasks 8–14).
- Tests: `test/runner-error-surface.test.mjs`, new `test/abort-classify.test.mjs`, new `test/decomposed-error-line.test.mjs`, new `test/log-provenance.test.mjs`, `test/log-line.test.mjs`, `test/log-filter.test.mjs`, `test/ui-history-logs.test.mjs`, `test/ui-running-resume.test.mjs`, new `test/ui-live-log-dom.test.mjs`.

---

### Task 1: Runner stderr framing via readline (F4 UTF-8 tearing, F7 CR progress)

**Files:**
- Modify: `src/core/claude-runner.mjs:448-477` (the carry-buffer framer) and `:483-485` (close handler)
- Test: `test/runner-error-surface.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: unchanged event shape `{ type:'stderr', stream:'err', text }`; `stderrBuf` still accumulates the full decoded stderr for the exit-code path. Task 2 edits the same emit line; Task 3 edits the close handler's detail.

- [ ] **Step 1: Write the failing tests** — append to `test/runner-error-surface.test.mjs`:

```js
test('a multi-byte UTF-8 character split across write boundaries is not torn into U+FFFD', async () => {
  const dir = await makeTmpDir();
  // '…' is E2 80 A6: write E2 80, then A6 + newline in a second write.
  const bin = await fakeShell(dir, [
    `printf '\\342\\200' 1>&2`,
    'sleep 0.2',
    `printf '\\246\\n' 1>&2`,
    'exit 0',
  ]);
  const events = [];
  await runClaude({ bin, prompt: 'hi', cwd: dir, onEvent: (e) => events.push(e) });
  assert.deepEqual(stderrEvents(events).map((e) => e.text), ['…']);
});

test('CR-rewriting progress output is framed live, one event per update', async () => {
  const dir = await makeTmpDir();
  const bin = await fakeShell(dir, [`printf '10%%\\r20%%\\r30%%\\n' 1>&2`, 'exit 0']);
  const events = [];
  await runClaude({ bin, prompt: 'hi', cwd: dir, onEvent: (e) => events.push(e) });
  assert.deepEqual(stderrEvents(events).map((e) => e.text), ['10%', '20%', '30%']);
});

test('the exit-code stderr detail also survives chunk-split multi-byte characters', async () => {
  const dir = await makeTmpDir();
  const bin = await fakeShell(dir, [
    `printf '\\342\\200' 1>&2`, 'sleep 0.2', `printf '\\246\\n' 1>&2`, 'exit 1',
  ]);
  await assert.rejects(() => runClaude({ bin, prompt: 'hi', cwd: dir }), (err) => {
    assert.match(err.message, /…/);
    assert.doesNotMatch(err.message, /�/);
    return true;
  });
});
```

- [ ] **Step 2: Run, verify they fail**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/runner-error-surface.test.mjs`
Expected: the 3 new tests FAIL (`'��'` instead of `'…'`; one `'10%\r20%\r30%'` event instead of three).

- [ ] **Step 3: Replace the hand-rolled framer with readline**

In `src/core/claude-runner.mjs`, delete the whole `stderrCarry`/`emitStderrLine`/`flushStderr`/`child.stderr.on('data', …)` block (lines 459–477) — keep the intent comment above it, amended — and replace with:

```js
    // stderr is a FIRST-CLASS log stream, not just failure evidence. The CLI puts
    // retry/throttle notices (429/529), MCP server chatter, and runtime warnings
    // here on runs that go on to succeed — all of it was previously discarded,
    // since stderrBuf is only read on the non-zero-exit path below.
    //
    // Framed with the SAME readline as stdout: readline decodes through an
    // internal StringDecoder (a multi-byte character split across pipe chunks
    // survives) and treats a lone \r as a line break, so CR-rewriting progress
    // output surfaces live instead of accumulating until exit. Each line is
    // emitted at receive time — the closest available proxy for event time.
    // `stream:'err'` tags the origin channel; the orchestrator decides the level.
    const rlErr = createInterface({ input: child.stderr });
    rlErr.on('line', (line) => {
      stderrBuf += line + '\n';        // still the source of the exit-code detail
      const text = line.trim();
      if (text) safeEmit(onEvent, { type: 'stderr', stream: 'err', text });
    });
```

In the `child.on('close', …)` handler replace `rl.close(); flushStderr();` with:

```js
      rl.close();
      rlErr.close(); // readline already flushed its final unterminated line when the stream ended
```

Note: `stderrBuf` is now rebuilt from decoded lines (`line + '\n'`); its only consumer trims it, so trailing-newline fidelity is irrelevant, and the UTF-8 fix applies to the exit detail too.

- [ ] **Step 4: Run the file, verify all pass**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/runner-error-surface.test.mjs`
Expected: PASS — including the pre-existing "final stderr line with NO trailing newline" and "split across write boundaries is reassembled" tests, which now prove readline's flush ordering empirically.

- [ ] **Step 5: Commit**

```bash
git add src/core/claude-runner.mjs test/runner-error-surface.test.mjs
git commit -m "fix(runner): frame stderr with readline — no UTF-8 tearing, live CR progress

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Gate stderr emission on abort (F10)

**Files:**
- Modify: `src/core/claude-runner.mjs` (the `rlErr.on('line', …)` handler from Task 1)
- Test: `test/runner-error-surface.test.mjs`

**Interfaces:**
- Consumes: `signal` (already in `runReal`'s scope), the Task-1 `rlErr` handler.
- Produces: no stderr events once `signal.aborted` — including readline's final flush of a torn fragment.

- [ ] **Step 1: Write the failing test**

```js
test('stderr chatter after an abort is not logged into a paused run', async () => {
  const dir = await makeTmpDir();
  const bin = await fakeShell(dir, [
    `printf '%s' 'torn half-line' 1>&2`,   // no newline: only flushed when the stream ends
    'sleep 5',
  ]);
  const ac = new AbortController();
  const events = [];
  const p = runClaude({ bin, prompt: 'hi', cwd: dir, signal: ac.signal, onEvent: (e) => events.push(e) });
  setTimeout(() => ac.abort(), 250);
  await assert.rejects(p, (err) => { assert.equal(err.name, 'AbortError'); return true; });
  assert.deepEqual(stderrEvents(events), [], 'the torn fragment must not surface as a warn line');
});
```

- [ ] **Step 2: Run, verify it fails** — expected: one `'torn half-line'` event leaks.

- [ ] **Step 3: Add the gate** — in the Task-1 handler change the emit line to:

```js
      const text = line.trim();
      // A pause/stop SIGTERMs the child: whatever it writes while dying (and the
      // torn fragment readline flushes at stream end) is not run output.
      if (text && !signal?.aborted) safeEmit(onEvent, { type: 'stderr', stream: 'err', text });
```

- [ ] **Step 4: Run the file, verify all pass.**

- [ ] **Step 5: Commit**

```bash
git add src/core/claude-runner.mjs test/runner-error-surface.test.mjs
git commit -m "fix(runner): do not emit stderr events after abort

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Tail-cap the non-zero-exit detail (F9, runner half)

**Files:**
- Modify: `src/core/claude-runner.mjs` (module const + `child.on('close')` non-zero path, currently lines 492-501)
- Test: `test/runner-error-surface.test.mjs`

**Interfaces:**
- Produces: `err.message` bounded to ~`STDERR_DETAIL_MAX` chars; `err.stream === 'err'` decided on the UNTRUNCATED stderr as today. Task 5 clips the orchestrator's log line on top of this.

- [ ] **Step 1: Write the failing test**

```js
test('the non-zero-exit detail is tail-capped so err.message stays bounded', async () => {
  const dir = await makeTmpDir();
  const bin = await fakeShell(dir, [
    `i=0; while [ $i -lt 300 ]; do printf 'chatter line %s padded padded padded padded\\n' $i 1>&2; i=$((i+1)); done`,
    `printf '%s\\n' 'FINAL CAUSE: boom' 1>&2`,
    'exit 1',
  ]);
  await assert.rejects(() => runClaude({ bin, prompt: 'hi', cwd: dir }), (err) => {
    assert.ok(err.message.length < 2200, `message stays bounded (got ${err.message.length})`);
    assert.match(err.message, /FINAL CAUSE: boom/, 'the tail — the actual cause — survives');
    assert.equal(err.stream, 'err');
    return true;
  });
});
```

- [ ] **Step 2: Run, verify it fails** — expected: message length ≈ 12KB.

- [ ] **Step 3: Implement** — near `DEFAULT_BIN` add:

```js
// Cap for the stderr detail embedded in a non-zero-exit Error message. The
// audit trail, the UI error banner, and classifyError all consume that message;
// an uncapped stderrBuf (hundreds of KB of MCP/retry chatter) must not ride
// into them when every stderr line was already streamed as its own warn event.
const STDERR_DETAIL_MAX = 2000;
```

and change the non-zero path:

```js
      if (code !== 0) {
        const fromStderr = stderrBuf.trim();
        const raw = fromStderr || errorDetail || 'no stderr';
        // Tail, not head: the terminal cause sits at the END of a long stderr.
        const detail = raw.length > STDERR_DETAIL_MAX ? `… ${raw.slice(-STDERR_DETAIL_MAX)}` : raw;
        const err = new Error(`${bin} exited with code ${code}: ${detail}`);
```

(the `if (fromStderr) err.stream = 'err';` line below stays exactly as-is).

- [ ] **Step 4: Run the file, verify all pass** (the existing "Not logged in" / "boom from stderr" tests are short and unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/core/claude-runner.mjs test/runner-error-surface.test.mjs
git commit -m "fix(runner): tail-cap the exit-code stderr detail

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Strict `isAbort` — name, not message sniff (F5)

**Files:**
- Modify: `src/core/orchestrator.mjs:3861-3863`, `src/core/agent-gen.mjs:200-202`, `src/core/workspace-scan.mjs:401-403`
- Create: `test/abort-classify.test.mjs`

**Interfaces:**
- Produces: `export function isAbort(err)` from `orchestrator.mjs` (newly exported for tests; previously file-local). Every internal abort/stop throw already sets `err.name = 'AbortError'` (verified: orchestrator:418-419/3573-3574, claude-runner:245-246/487-488/663-664, agent-gen:193-194, workspace-scan:394-395), so name-only is behavior-preserving for genuine aborts.

- [ ] **Step 1: Write the failing test** — create `test/abort-classify.test.mjs`:

```js
// test/abort-classify.test.mjs
// isAbort must classify by the AbortError NAME every abort/stop site sets —
// never by sniffing the message, or a genuine CLI failure that merely MENTIONS
// "aborted"/"stopped" is silently treated as a user stop (no terminal error
// line, no recovery, wrong decomposed abort-on-first-failure detection).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAbort } from '../src/core/orchestrator.mjs';

test('an AbortError-named error is an abort', () => {
  const e = new Error('aborted');
  e.name = 'AbortError';
  assert.equal(isAbort(e), true);
});

test('a real failure that merely mentions "aborted"/"stopped" is NOT an abort', () => {
  assert.equal(isAbort(new Error('claude exited with code 1: FetchError: the operation was aborted')), false);
  assert.equal(isAbort(new Error('MCP server stopped unexpectedly')), false);
});

test('null/undefined are not aborts', () => {
  assert.equal(isAbort(null), false);
  assert.equal(isAbort(undefined), false);
});
```

- [ ] **Step 2: Run, verify it fails** — expected: FAIL — `isAbort` is not exported yet (and the sniff test would fail once it is).

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/abort-classify.test.mjs`

- [ ] **Step 3: Implement** — in `src/core/orchestrator.mjs` replace:

```js
export function isAbort(err) {
  // NAME only. Every abort/stop throw in this codebase stamps name='AbortError'
  // (see stop()/_checkAbort/claude-runner); sniffing the message here also
  // matched real CLI failures containing "aborted"/"stopped" and swallowed
  // their terminal error line, recovery, and decomposed failure detection.
  return !!err && err.name === 'AbortError';
}
```

Apply the same body (unexported, keep local) to the private `isAbort` copies in `src/core/agent-gen.mjs:200` and `src/core/workspace-scan.mjs:402` — their stop paths set the name too, and the same misclassification would end a scan/agent-gen silently.

- [ ] **Step 4: Run the new file, then the full suite**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/abort-classify.test.mjs` → PASS.
Run: `npm test` → all green (this change touches control flow at 9 orchestrator call sites; the suite is the regression net — investigate ANY failure before proceeding, do not paper over).

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator.mjs src/core/agent-gen.mjs src/core/workspace-scan.mjs test/abort-classify.test.mjs
git commit -m "fix(pipeline): classify aborts by AbortError name, not message sniff

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: One terminal-error helper; decomposed tasks use it + get recovery (F2, F9 orchestrator half)

**Files:**
- Modify: `src/core/orchestrator.mjs` (`_runNode` catch at 2283-2293, `_runDecomposedTask` at 2240-2257, new `_logStepFailure` next to `_runNode`)
- Create: `test/decomposed-error-line.test.mjs`

**Interfaces:**
- Consumes: `isAbort` (Task 4), `isPause`, `clip` (orchestrator:4151), `_stepKeyFor` (pure: `"<stepIndex>:<nodeId>#<cycle>"`), `_runNodeAttempts` (recovery loop, orchestrator:2307).
- Produces: `_logStepFailure(node, stepIndex, cycle, err)` — the ONE error-level line for a failed node/task, clipped to 500 chars, `stream` passed through from `err.stream`.

- [ ] **Step 1: Write the failing tests** — create `test/decomposed-error-line.test.mjs`:

```js
// test/decomposed-error-line.test.mjs
// A decomposed task failure must log the SAME terminal error line a normal
// node failure logs — previously the decomposed path bypassed _runNode's catch
// and a failed run produced ZERO error-level lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

function loggedOrch() {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  return { orch, logs };
}

test('_logStepFailure logs one clipped error line with attribution + stream passthrough', () => {
  const { orch, logs } = loggedOrch();
  const err = Object.assign(new Error(`claude exited with code 1: ${'x'.repeat(5000)}`), { stream: 'err' });
  orch._logStepFailure({ key: 'implementer', nodeId: 'n7' }, 3, 2, err);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, 'error');
  assert.match(logs[0].text, /^step failed: claude exited with code 1/);
  assert.ok(logs[0].text.length <= 520, `clipped (got ${logs[0].text.length})`);
  assert.equal(logs[0].stream, 'err');
  assert.equal(logs[0].nodeId, 'n7');
  assert.equal(logs[0].stepIndex, 3);
  assert.equal(logs[0].cycle, 2);
});

test('_logStepFailure stays silent for aborts and pauses', () => {
  const { orch, logs } = loggedOrch();
  const ab = new Error('aborted'); ab.name = 'AbortError';
  const pa = new Error('paused'); pa.name = 'PauseError';
  orch._logStepFailure({ key: 'implementer', nodeId: 'n1' }, 0, 1, ab);
  orch._logStepFailure({ key: 'implementer', nodeId: 'n1' }, 0, 1, pa);
  assert.equal(logs.length, 0);
});

test('a decomposed task failure logs the ONE terminal error line', async () => {
  const { orch, logs } = loggedOrch();
  orch.pipeline = { id: 'p-test-decomp', dir: '/tmp/proj' };
  orch.abort ||= new AbortController();
  orch.pauseAbort ||= new AbortController();
  // Stub the node machinery: this test pins the catch's logging contract only.
  orch._nodeStep = () => {};
  orch._nodeCtx = () => ({});
  orch._bindNodeIo = () => ({});
  orch._runNodeAttempts = async () => {
    throw Object.assign(new Error('claude exited with code 1: kaboom'), { stream: 'err' });
  };
  const taskNode = { key: 'implementer', nodeId: 's_impl_p1_t1', runnerType: 'producer' };
  await assert.rejects(() =>
    orch._runDecomposedTask(taskNode, { id: 'p1t1', title: 'Slice one' }, 2, 1, {}, new AbortController()));
  const errLines = logs.filter((l) => l.level === 'error');
  assert.equal(errLines.length, 1, 'exactly one terminal error line');
  assert.match(errLines[0].text, /step failed: .*kaboom/);
  assert.equal(errLines[0].stream, 'err');
  assert.equal(errLines[0].nodeId, 's_impl_p1_t1');
});

test('an aborted decomposed task (sibling failure cancel) logs no error line', async () => {
  const { orch, logs } = loggedOrch();
  orch.pipeline = { id: 'p-test-decomp', dir: '/tmp/proj' };
  orch.abort ||= new AbortController();
  orch.pauseAbort ||= new AbortController();
  orch._nodeStep = () => {};
  orch._nodeCtx = () => ({});
  orch._bindNodeIo = () => ({});
  orch._runNodeAttempts = async () => {
    const e = new Error('aborted'); e.name = 'AbortError'; throw e;
  };
  await assert.rejects(() =>
    orch._runDecomposedTask({ key: 'implementer', nodeId: 's_impl_p1_t2', runnerType: 'producer' },
      { id: 'p1t2', title: 'Slice two' }, 2, 1, {}, new AbortController()));
  assert.equal(logs.filter((l) => l.level === 'error').length, 0);
});
```

If `createOrchestrator` initializes `abort`/`pauseAbort` in its constructor the `||=` lines are harmless; if `updateTaskStatus` throws on the unknown pipeline id (it should no-op — SQLite UPDATE on a missing row), surface that in the test output and stub it via `orch` only if it genuinely throws — do NOT weaken the assertions.

- [ ] **Step 2: Run, verify failures** — `_logStepFailure` doesn't exist; the decomposed test logs zero error lines.

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/decomposed-error-line.test.mjs`

- [ ] **Step 3: Implement the helper + rewire both paths**

Add above `_runNode` (near orchestrator:2259):

```js
  /**
   * The ONE `error`-level line for a terminally failed node or decomposed task.
   * A pause/abort is not a failure, and a recoverable error that retried logged
   * its own `warn` in _recover — both stay silent. `err.stream` is set by the
   * runner only when the detail actually came from the CLI's stderr. Clipped:
   * the runner's exit detail is already tail-capped, and every stderr line was
   * streamed as its own warn — this line is the verdict, not the transcript.
   */
  _logStepFailure(node, stepIndex, cycle, err) {
    if (isAbort(err) || isPause(err)) return;
    this._log(node.key, 'error', `step failed: ${clip(err?.message || err, 500)}`, {
      nodeId: node.nodeId, stepIndex, cycle, stepKey: this._stepKeyFor(node, stepIndex, cycle),
      ...(err?.stream ? { stream: err.stream } : {}),
    });
  }
```

In `_runNode`'s catch replace the whole `if (!isAbort(err) && !isPause(err)) { this._log(...) }` block (keep its comment trimmed to a pointer) with:

```js
      this._logStepFailure(node, stepIndex, cycle, err);
```

In `_runDecomposedTask` replace:

```js
    try {
      const runner = this._runners[taskNode.runnerType];
      await runner(ctx); // producer -> runImplementer({ ..., taskPath: ctx.node.taskPath })
    } catch (err) {
      status = 'error';
      throw err;
    } finally {
```

with:

```js
    try {
      // Through _runNodeAttempts, not a bare runner call: a decomposed task gets
      // the SAME recovery/usage-limit treatment as a normal node (the bare call
      // also bypassed the terminal error line entirely — a failed decomposed run
      // used to produce zero error-level lines).
      await this._runNodeAttempts(taskNode, stepIndex, cycle, ctx);
    } catch (err) {
      status = 'error';
      this._logStepFailure(taskNode, stepIndex, cycle, err);
      throw err;
    } finally {
```

Also update `_runDecomposedTask`'s doc comment: "the producer runner runs" → "the standard attempt loop (`_runNodeAttempts`: recovery + usage-limit pause) runs".

- [ ] **Step 4: Run the new file + neighbors, then full suite**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/decomposed-error-line.test.mjs test/agent-log.test.mjs` → PASS.
Run: `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator.mjs test/decomposed-error-line.test.mjs
git commit -m "fix(pipeline): terminal error line + recovery for decomposed tasks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `stream:'err'` provenance from one seam (F6)

**Files:**
- Modify: `src/core/orchestrator.mjs` (new exported `errStreamAttr` beside `ERR_STREAM`:161; call sites 1341-1347, 1382-1385, 1424, 1471, 1579, 1646-1647, 1673, 1713, 1764, 1776, 1810, 1826, 2344, 2494, 3322)
- Modify: `src/core/worktree.mjs` (`snapshotWorktreePatch` failure returns)
- Create: `test/log-provenance.test.mjs`

**Interfaces:**
- Produces: `export function errStreamAttr(stderrText, extra = null)` — returns `ERR_STREAM` (merged over `extra`) only when the subprocess actually wrote stderr; otherwise `extra` (or null). Additive `fromStderr: boolean` on `_commitWork`'s three `{ok:false}` returns and `snapshotWorktreePatch`'s two failure returns. `_recordRunWarning(text, attr = null)` gains a pass-through attr param.

- [ ] **Step 1: Write the failing tests** — create `test/log-provenance.test.mjs`:

```js
// test/log-provenance.test.mjs
// stream:'err' records the origin CHANNEL. It must be derived from whether the
// subprocess actually wrote stderr — a `|| 'exit 1'` fallback carries no stderr
// bytes, and tagging it makes the tag a lie; conversely a warn line that embeds
// real stderr must carry it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errStreamAttr } from '../src/core/orchestrator.mjs';

test('non-empty stderr yields the stream tag', () => {
  assert.deepEqual(errStreamAttr('boom'), { stream: 'err' });
});

test('empty/whitespace/absent stderr yields NO tag', () => {
  assert.equal(errStreamAttr(''), null);
  assert.equal(errStreamAttr('   '), null);
  assert.equal(errStreamAttr(undefined), null);
});

test('extra attrs merge under the tag and survive without it', () => {
  assert.deepEqual(errStreamAttr('boom', { nodeId: 'n1' }), { nodeId: 'n1', stream: 'err' });
  assert.deepEqual(errStreamAttr('', { nodeId: 'n1' }), { nodeId: 'n1' });
});
```

- [ ] **Step 2: Run, verify it fails** (no such export).

- [ ] **Step 3: Implement the seam** — below `errDetail` (orchestrator:170) add:

```js
/** attr for a log line whose text embeds subprocess output: ERR_STREAM only
 *  when the subprocess actually said something on stderr. A `|| 'exit N'`
 *  fallback carries no stderr bytes — tagging it would make the tag a lie
 *  (the same rule errDetail documents for the text itself). */
export function errStreamAttr(stderrText, extra = null) {
  if (!(stderrText && String(stderrText).trim())) return extra;
  return extra ? { ...extra, ...ERR_STREAM } : ERR_STREAM;
}
```

- [ ] **Step 4: Convert the call sites (each keeps its level and text; only the attr changes)**

1. Graph builds — `_buildWorktreeGraph` (1341-1347) and `_buildWorktreeGraphAll` (1382-1385): replace the trailing `ERR_STREAM` argument with `errStreamAttr(res?.stderr)`.
2. Teardown step loops (1424, 1471, 1579): `... failed: ${s.stderr || 'unknown error'}`, attr → `errStreamAttr(s.stderr)`.
3. `_commitWork`: attrs → `errStreamAttr(status.stderr)` (1764), `errStreamAttr(add.stderr)` (1776), `errStreamAttr(commit.stderr)` (1810 and 1826). Add `fromStderr` to its failure returns:
   - `return { ok: false, step: 'status', message, fromStderr: !!status.stderr.trim() };`
   - `return { ok: false, step: 'add', message, fromStderr: !!add.stderr.trim() };`
   - `return { ok: false, step: 'commit', message, fromStderr: !!commit.stderr.trim() };`
4. `_recordCommitFailure` (1713): attr → `result.fromStderr ? ERR_STREAM : null`. Its `_recordRunWarning` call at 1704 passes the same: `await this._recordRunWarning(\`...\`, result.fromStderr ? ERR_STREAM : null);`
5. `_recordRunWarning` (1646): signature `async _recordRunWarning(text, attr = null)`, body `this._log('worktree', 'warn', text, attr);` — every other existing caller stays attr-less (their texts are worca's own summaries).
6. `_snapshotRetained` (1673): attr → `snap.fromStderr ? ERR_STREAM : null`. In `src/core/worktree.mjs` `snapshotWorktreePatch`, extend the two failure returns:
   - `return { ok: false, step: 'add', message: add.stderr.trim() || \`exit ${add.code}\`, fromStderr: !!add.stderr.trim() };`
   - `return { ok: false, step: 'diff', message: diff.stderr.trim() || \`exit ${diff.code}\`, fromStderr: !!diff.stderr.trim() };`
7. Initial-checkpoint commit warn (3322): attr → `errStreamAttr(commit.stderr)`.
8. `_recover` (2494): `this._log(node.key, 'warn', \`recoverable ${cls} error: ${err.message}\`, err?.stream ? ERR_STREAM : null);` — the retry warn now carries the same provenance the give-up line gets from `_logStepFailure`.
9. `_runOnce` resume-fallback warn (2344): same `err?.stream ? ERR_STREAM : null` attr.

- [ ] **Step 5: Run new file + neighbors, then full suite**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/log-provenance.test.mjs test/agent-log.test.mjs test/run-root-teardown.test.mjs` → PASS.
Run: `npm test` → green (teardown/commit tests are the regression net for the attr changes).

- [ ] **Step 6: Commit**

```bash
git add src/core/orchestrator.mjs src/core/worktree.mjs test/log-provenance.test.mjs
git commit -m "fix(pipeline): derive stream:'err' provenance from actual stderr

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: De-vacuous the stderr-branch test (F13)

**Files:**
- Modify: `test/agent-log.test.mjs:372-375`

**Interfaces:**
- Consumes: `_onAgentEvent`'s stderr early-return (orchestrator:2975-2979) and the reducer pipeline below it.

- [ ] **Step 1: Replace the vacuous test** with one that plants a poison `raw` — if the stderr branch's early return is ever removed, the event falls through to the reducers and the tool_use payload WOULD log an arrow line:

```js
test('a stderr event never touches the tool/init/result branches', () => {
  // Poison raw: if the stderr early-return vanished, this tool_use payload
  // would fall through to the reducers and log '→ Read x.js'.
  const logs = capture('planner', {
    type: 'stderr', stream: 'err', text: 'plain noise',
    raw: { type: 'assistant', message: { content: [
      { type: 'tool_use', id: 't9', name: 'Read', input: { file_path: '/tmp/proj/x.js' } },
    ] } },
  });
  assert.equal(logs.length, 1, 'exactly the warn line, nothing from the reducers');
  assert.equal(logs[0].level, 'warn');
  assert.equal(logs[0].text, 'plain noise');
  assert.ok(!logs.some((l) => /^[←→]|\[init\]/.test(l.text)), 'no arrow/init line');
});
```

- [ ] **Step 2: Prove it bites** — temporarily comment out the `if (e.type === 'stderr') { … return; }` block in `_onAgentEvent`, run the file, confirm THIS test now FAILS (an arrow line appears / count ≠ 1). Restore the block.

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/agent-log.test.mjs`

- [ ] **Step 3: Run the file green, commit**

```bash
git add test/agent-log.test.mjs
git commit -m "test(pipeline): make the stderr-branch isolation test falsifiable

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: One NDJSON projection — resume seed keeps cycle/stream (F1)

**Files:**
- Modify: `ui/public/log-line.mjs` (new `projectLogRecord`), `ui/public/app.js` (import at :57; `seedResumedLog` at 7811-7820; `loadLiveLogs` at 9338-9346)
- Test: `test/log-line.test.mjs`, `test/ui-running-resume.test.mjs`

**Interfaces:**
- Produces: `export function projectLogRecord(rec)` in `log-line.mjs` → `{ source, level, text, ts, sub, stepIndex?, cycle?, stream? }` (absent fields stay ABSENT — the filters test `!= null` / truthiness). `nodeId` is deliberately not projected: no persisted-log consumer reads it.

- [ ] **Step 1: Write the failing pure tests** — append to `test/log-line.test.mjs` (extend the import with `projectLogRecord`):

```js
// ── NDJSON projection ───────────────────────────────────────────────────────

test('projectLogRecord keeps cycle and stream — the axes the pickers/separators need', () => {
  const rec = projectLogRecord({
    source: 'implementer', level: 'warn', text: '429, retrying', ts: TS,
    sub: false, stepIndex: 3, cycle: 2, stream: 'err', nodeId: 'n1',
  });
  assert.deepEqual(rec, {
    source: 'implementer', level: 'warn', text: '429, retrying', ts: TS,
    sub: false, stepIndex: 3, cycle: 2, stream: 'err',
  });
});

test('projectLogRecord leaves absent attribution absent (no undefined keys)', () => {
  const rec = projectLogRecord({ source: 'git', level: 'info', text: 'x', ts: TS });
  assert.deepEqual(Object.keys(rec).sort(), ['level', 'source', 'sub', 'text', 'ts']);
});
```

- [ ] **Step 2: Write the failing jsdom test** — in `test/ui-running-resume.test.mjs`, extend `bootLive`'s fetch with an NDJSON branch and add:

```js
// In bootLive's window.fetch, BEFORE the /api/resume branch:
    if (String(url).includes('/log')) {
      return Promise.resolve({ ok: true, status: 200, text: async () =>
        '{"source":"planner","level":"info","text":"pass one","ts":"2026-08-17T00:00:01Z","stepIndex":0,"cycle":1}\n' +
        '{"source":"implementer","level":"warn","text":"429, retrying","ts":"2026-08-17T00:00:02Z","stepIndex":1,"cycle":2,"stream":"err"}\n' });
    }
```

```js
test('seedResumedLog re-hydrates cycle and stream from the persisted NDJSON', async () => {
  const { window } = await bootLive();
  const { upsertRun, seedResumedLog, getRun } = window.__np;
  upsertRun({ runId: 'r-new', title: 't', projectDir: '/tmp/proj', status: 'starting' });
  await seedResumedLog('r-new', null, '/api/history/p1/log');
  const lines = getRun('r-new').logLines;
  assert.ok(lines.some((l) => l.cycle === 2), 'cycle survives the seed projection');
  assert.ok(lines.some((l) => l.stream === 'err'), 'stderr provenance survives the seed projection');
});
```

Expose `seedResumedLog` on the `window.__np` hook (add it to the `Object.assign(window.__np …)` block that already exposes `upsertRun`/`onLog`/`resumeRunFromCard`).

- [ ] **Step 3: Run both files, verify the new tests fail** (`projectLogRecord` missing; seed drops cycle/stream).

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/log-line.test.mjs test/ui-running-resume.test.mjs`

- [ ] **Step 4: Implement** — in `ui/public/log-line.mjs`:

```js
/** One persisted NDJSON record projected to the UI log-record shape. EVERY
 *  consumer of the persisted log goes through here — the live-card resume seed
 *  and the History replay must agree on which fields survive, or an axis works
 *  in one pane while silently dead in the other (`cycle` was dropped by one of
 *  three hand-rolled copies of this projection). `cycle` drives the cycle
 *  picker AND the "── Cycle N ──" separators; `stream` is stderr provenance.
 *  Absent attribution stays ABSENT (the filters test `!= null`). */
export function projectLogRecord(rec) {
  return {
    source: rec.source, level: rec.level, text: rec.text, ts: rec.ts, sub: !!rec.sub,
    ...(rec.stepIndex != null ? { stepIndex: rec.stepIndex } : {}),
    ...(rec.cycle != null ? { cycle: rec.cycle } : {}),
    ...(rec.stream ? { stream: rec.stream } : {}),
  };
}
```

In `app.js` add `projectLogRecord` to the `./log-line.mjs` import; in `seedResumedLog` replace the inline `head.push({ … })` object with `head.push(projectLogRecord(rec));`; in `loadLiveLogs` replace the inline `recs.push({ … })` object (and its `cycle` comment, now living on the helper) with `recs.push(projectLogRecord(rec));`.

- [ ] **Step 5: Run both files + `test/ui-history-logs.test.mjs`, verify green. Commit**

```bash
git add ui/public/log-line.mjs ui/public/app.js test/log-line.test.mjs test/ui-running-resume.test.mjs
git commit -m "fix(ui): share one NDJSON projection so resume seeding keeps cycle/stream

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Cycle separators look through cycle-less records (F3)

**Files:**
- Modify: `ui/public/log-line.mjs` (`cycleSeparatorBefore`), `ui/public/app.js` (`appendLogRec`:3661-3665, `onLog`:3721-3727, `repaintFilteredLog`:3831-3841, `loadLiveLogs` paint loop:9349-9360; `_lastRenderedLog` → `_lastRenderedCycle`)
- Test: `test/log-line.test.mjs`, `test/ui-history-logs.test.mjs`, new `test/ui-live-log-dom.test.mjs`

**Interfaces:**
- Produces: `cycleSeparatorBefore(prevCycle, rec)` — first argument is now the CYCLE VALUE of the last rendered record that carried one (null when none yet), not the previous record. `appendLogRec(logEl, rec, prevCycle)` returns the value the next append must pass (`rec.cycle ?? prevCycle`). Run objects carry `r._lastRenderedCycle` (replaces `r._lastRenderedLog`, whose only consumer was the separator).

- [ ] **Step 1: Rewrite the pure tests** — in `test/log-line.test.mjs` replace the whole `cycleSeparatorBefore` block (the five tests at the bottom) with:

```js
// ── cycle separators ────────────────────────────────────────────────────────
// `prevCycle` is the cycle of the last RENDERED record that HAD one — callers
// carry it past cycle-less notices (artifact events, git/orchestrator lines)
// that land exactly at rewind boundaries and must not mask them.

test('cycleSeparatorBefore labels a cycle boundary', () => {
  assert.equal(cycleSeparatorBefore(1, { cycle: 2 }), 'Cycle 2');
});
test('cycleSeparatorBefore returns null within one cycle', () => {
  assert.equal(cycleSeparatorBefore(2, { cycle: 2 }), null);
});
test('no leading header: null prevCycle (nothing cycled rendered yet) yields null', () => {
  assert.equal(cycleSeparatorBefore(null, { cycle: 1 }), null);
  assert.equal(cycleSeparatorBefore(null, { cycle: 2 }), null);
});
test('a cycle-less record never triggers a separator', () => {
  assert.equal(cycleSeparatorBefore(1, { text: 'artifact: review.md' }), null);
  assert.equal(cycleSeparatorBefore(1, null), null);
});
test('a cycle-less notice AT the boundary does not mask the separator', () => {
  let prev = null;
  const seq = [{ cycle: 1, text: 'work' }, { text: 'artifact: review.md' }, { cycle: 2, text: 're-run' }];
  const seps = seq.map((rec) => {
    const s = cycleSeparatorBefore(prev, rec);
    if (rec.cycle != null) prev = rec.cycle;
    return s;
  });
  assert.deepEqual(seps, [null, null, 'Cycle 2']);
});
test('cycleSeparatorBefore compares as strings so 2 and "2" agree', () => {
  assert.equal(cycleSeparatorBefore(2, { cycle: '2' }), null);
  assert.equal(cycleSeparatorBefore('1', { cycle: 2 }), 'Cycle 2');
});
```

- [ ] **Step 2: Add the failing jsdom tests**

(a) History: in `test/ui-history-logs.test.mjs`, in the "replayed logs keep their cycle" test, insert a cycle-less line into `NDJSON` between the cycle-1 and cycle-2 lines:

```js
    '{"source":"git","level":"info","text":"staged working tree","ts":"2026-06-20T00:00:02.5Z"}\n' +
```

and update the assertions: 4 `.log-line`s, still exactly one `.log-sep` labeled `Cycle 2` (this FAILS today — the cycle-less neighbor suppresses it), and the cycle-2 narrowing assertions keep passing.

(b) Live card: create `test/ui-live-log-dom.test.mjs` with a copy of `bootLive` from `test/ui-running-resume.test.mjs` (that harness's boot is private; same verbatim-copy convention as `test/ui-history-logs.test.mjs`), plus:

```js
test('live pane draws the Cycle rule even when an artifact line sits at the boundary', async () => {
  const { window } = await bootLive();
  const { upsertRun, buildRunCard, onLog } = window.__np;
  const r = upsertRun({ runId: 'r1', title: 't', projectDir: '/tmp/proj', status: 'running' });
  r.el = buildRunCard(r);
  onLog(r, { source: 'reviewer', level: 'info', text: 'blocking issue', ts: Date.now(), stepIndex: 1, cycle: 1 });
  onLog(r, { source: 'artifact', level: 'artifact', text: 'review: r.md', ts: Date.now() });   // cycle-less
  onLog(r, { source: 'implementer', level: 'info', text: 'fixing', ts: Date.now(), stepIndex: 1, cycle: 2 });
  const pane = r.el.querySelector('.log');
  const seps = pane.querySelectorAll('.log-sep');
  assert.equal(seps.length, 1, 'boundary survives the cycle-less neighbor');
  assert.equal(seps[0].textContent, 'Cycle 2');
  assert.equal(pane.querySelectorAll('.log-line').length, 3);
});
```

- [ ] **Step 3: Run all three files, verify the new/changed tests fail.**

- [ ] **Step 4: Implement**

`ui/public/log-line.mjs` — replace `cycleSeparatorBefore`:

```js
/**
 * The separator label to draw BEFORE `rec`, or null for none.
 *
 * `cycle` is the feedback-loop rewind counter: when a reviewer returns blocking
 * issues the pipeline rewinds and re-runs the same steps with cycle+1, so a
 * re-run is otherwise indistinguishable from its first pass. A rule drawn at the
 * boundary makes that legible without the reader having to filter for it.
 *
 * `prevCycle` is the cycle of the last RENDERED record that HAD one — the
 * caller carries it past cycle-less notices (artifact events, git/orchestrator
 * lines), which land exactly at rewind boundaries and must not mask them. It
 * must come from rendered records, not the model, so a filter that hides an
 * entire cycle cannot orphan a separator. null (no cycled record rendered yet)
 * yields null: no leading "Cycle 1" header.
 */
export function cycleSeparatorBefore(prevCycle, rec) {
  if (!rec || rec.cycle == null) return null;
  if (prevCycle == null) return null;
  if (String(prevCycle) === String(rec.cycle)) return null;
  return `Cycle ${rec.cycle}`;
}
```

`ui/public/app.js` — `appendLogRec`:

```js
// Append `rec` to a log pane, preceded by a cycle separator when it opens a new
// cycle. `prevCycle` is the last RENDERED cycle value (see cycleSeparatorBefore);
// returns the value the NEXT append must pass.
function appendLogRec(logEl, rec, prevCycle) {
  const sep = cycleSeparatorBefore(prevCycle, rec);
  if (sep) logEl.appendChild(buildLogSeparator(sep));
  logEl.appendChild(buildLogLine(rec));
  return rec.cycle != null ? rec.cycle : prevCycle;
}
```

`onLog` (the mounted-card branch):

```js
      clearLogPlaceholder(logEl);
      r._lastRenderedCycle = appendLogRec(logEl, rec, r._lastRenderedCycle ?? null);
      while (logEl.childElementCount > MAX_LOG_LINES) logEl.removeChild(logEl.firstChild);
      maybeAutoscrollLog(r);
```

`repaintFilteredLog` — replace the `prevRec` walk:

```js
  let shown = 0;
  let prevCycle = null;
  for (const rec of r.logLines) {
    if (!logLineVisible(rec, r.logFilter)) continue;
    prevCycle = appendLogRec(logEl, rec, prevCycle);
    shown++;
  }
  // Hand the streaming path in onLog the cycle the next separator must compare
  // against, so a live append after a repaint agrees with the repaint.
  r._lastRenderedCycle = prevCycle;
```

`loadLiveLogs`'s `paint` — same shape: `let prevCycle = null; … prevCycle = appendLogRec(box, rec, prevCycle);`. Delete every remaining `_lastRenderedLog` reference (grep: 3723, 3724, 3841 only).

- [ ] **Step 5: Run the three test files + `test/ui-log-filters-row.test.mjs`, verify green. Commit**

```bash
git add ui/public/log-line.mjs ui/public/app.js test/log-line.test.mjs test/ui-history-logs.test.mjs test/ui-live-log-dom.test.mjs
git commit -m "fix(ui): cycle separators look through cycle-less boundary records

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Serialize cycle separators into copied text (F11)

**Files:**
- Modify: `ui/public/log-line.mjs` (`serializeLog`)
- Test: `test/log-line.test.mjs`

**Interfaces:**
- Produces: `serializeLog(recs)` emits a `── Cycle N ──` line at exactly the boundaries the pane draws (same `cycleSeparatorBefore` walk). Signature unchanged; recs without cycles serialize byte-identically to today (existing test stays green).

- [ ] **Step 1: Write the failing tests**:

```js
test('serializeLog draws the same cycle rules the pane renders', () => {
  const text = serializeLog([
    { ts: TS, source: 'reviewer', text: 'blocking issue', cycle: 1 },
    { ts: TS, source: 'artifact', text: 'review: r.md' },            // cycle-less boundary notice
    { ts: TS, source: 'implementer', text: 'fixing', cycle: 2 },
  ]);
  assert.deepEqual(text.split('\n'), [
    '14:05:09 [reviewer] blocking issue',
    '14:05:09 [artifact] review: r.md',
    '── Cycle 2 ──',
    '14:05:09 [implementer] fixing',
  ]);
});

test('serializeLog emits no separator for a single-cycle or cycle-less sequence', () => {
  assert.doesNotMatch(serializeLog([{ ts: TS, text: 'a', cycle: 2 }, { ts: TS, text: 'b', cycle: 2 }]), /Cycle/);
  assert.doesNotMatch(serializeLog([{ ts: TS, text: 'a' }, { ts: TS, text: 'b' }]), /Cycle/);
});
```

- [ ] **Step 2: Run, verify they fail.**

- [ ] **Step 3: Implement**:

```js
/** A whole (already filtered) sequence of records as newline-joined text, with
 *  the SAME "Cycle N" rules the pane draws (one cycleSeparatorBefore walk) —
 *  without them a copied re-run repeats its steps with no visible boundary.
 *  Rendered as `── Cycle N ──`: the pane's rule lines are CSS, plain text
 *  needs the dashes. */
export function serializeLog(recs) {
  const out = [];
  let prevCycle = null;
  for (const rec of recs || []) {
    if (!rec) continue;
    const sep = cycleSeparatorBefore(prevCycle, rec);
    if (sep) out.push(`── ${sep} ──`);
    if (rec.cycle != null) prevCycle = rec.cycle;
    out.push(logLineText(rec));
  }
  return out.join('\n');
}
```

- [ ] **Step 4: Run `test/log-line.test.mjs`, verify green (including the pre-existing "joins records with newlines and skips holes"). Commit**

```bash
git add ui/public/log-line.mjs test/log-line.test.mjs
git commit -m "fix(ui): copy serializes the cycle rules the pane shows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Copy feedback on an empty filter result (F12)

**Files:**
- Modify: `ui/public/app.js` (`copyLogToClipboard`:3614-3629, new `flashCopyBtn`)
- Test: `test/ui-history-logs.test.mjs`

**Interfaces:**
- Produces: `flashCopyBtn(btn, msg)` — the label-save/restore flash extracted from `copyLogToClipboard`; empty serialization flashes `nothing to copy` and leaves the clipboard untouched.

- [ ] **Step 1: Write the failing jsdom test** — first add this helper to `test/ui-history-logs.test.mjs` (below `boot()`; Tasks 13 and 14 reuse it):

```js
// Boot, load History serving the given NDJSON, expand the one card, open the
// Live-logs panel. Shared by the copy/cap/parity tests (the replay test above
// predates it and keeps its inline flow).
async function openLogsPanel(NDJSON) {
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history/') && url.endsWith('/log')) {
        return Promise.resolve({ ok: true, status: 200, text: async () => NDJSON });
      }
      if (url.includes('/api/history/')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({
          state: { phase: 'done', status: 'done', cycle: 2, subAgents: [], steps: [], stepper: null },
          auditMarkdown: '', clarify: null, reviews: [],
          artifacts: [{ kind: 'live-log', relPath: 'live-log.ndjson' }],
        }) });
      }
      if (url.includes('/api/history')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({
          pipelines: [{ id: 'p-1', projectKey: 'proj-00000001', title: 'Run', status: 'done', startedAt: '2026-06-20T00:00:00Z' }] }) });
      }
      return null;
    },
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = ctx.window.document.querySelector('#history .hist-card');
  card.querySelector('.hist-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const logsBar = card.querySelector('.hist-detail .logs-bar');
  logsBar.querySelector('.btn-subs').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  return { ctx, card, panel: logsBar.querySelector('.logs-panel') };
}
```

then the test:

```js
test('copy on a filtered-empty pane flashes "nothing to copy" and leaves the clipboard alone', async () => {
  const { ctx, panel } = await openLogsPanel(
    '{"source":"planner","level":"info","text":"Planning…","ts":"2026-06-20T00:00:01Z","stepIndex":0,"cycle":1}\n');
  const writes = [];
  Object.defineProperty(ctx.window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (t) => { writes.push(t); } },
  });
  const search = panel.querySelector('.log-search');
  search.value = 'zz-no-match-zz';
  search.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));   // > LOG_SEARCH_DEBOUNCE_MS
  const copyBtn = panel.querySelector('.log-copy');
  copyBtn.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(copyBtn.textContent, 'nothing to copy');
  assert.deepEqual(writes, [], 'clipboard untouched');
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(copyBtn.textContent, 'copy', 'label restored after the flash');
});
```

- [ ] **Step 2: Run, verify it fails** (button text stays `copy`, no flash).

- [ ] **Step 3: Implement**:

```js
// Save/flash/restore a copy button's label. `dataset.label` survives repeated
// clicks so a flash can never become the button's permanent label.
function flashCopyBtn(btn, msg) {
  const prev = btn.dataset.label || btn.textContent;
  btn.dataset.label = prev;
  btn.textContent = msg;
  clearTimeout(btn._copyTimer);
  btn._copyTimer = setTimeout(() => { btn.textContent = btn.dataset.label || 'copy'; }, 1200);
}

async function copyLogToClipboard(btn, recs) {
  const text = serializeLog(recs);
  if (!text) {
    // A filtered-empty pane: silence looks like a dead button, and the STALE
    // clipboard content would pass for the filtered log on the next paste.
    flashCopyBtn(btn, 'nothing to copy');
    return;
  }
  let ok = true;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else ok = legacyCopy(text);
  } catch {
    ok = legacyCopy(text);
  }
  flashCopyBtn(btn, ok ? 'copied' : 'copy failed');
}
```

- [ ] **Step 4: Run `test/ui-history-logs.test.mjs`, verify green. Commit**

```bash
git add ui/public/app.js test/ui-history-logs.test.mjs
git commit -m "fix(ui): flash 'nothing to copy' instead of silently keeping stale clipboard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: One DOM cap that counts records, not separators (F8)

**Files:**
- Modify: `ui/public/app.js` (new `trimLogDom`; `onLog` trim line; `repaintFilteredLog`)
- Test: `test/ui-live-log-dom.test.mjs`

**Interfaces:**
- Consumes: `MAX_LOG_LINES` (4000), `.log-line`/`.log-sep` class contract from `buildLogLine`/`buildLogSeparator`.
- Produces: `trimLogDom(logEl)` — evicts oldest children until ≤ `MAX_LOG_LINES` RECORD lines remain, then drops any separator left leading the pane. Called by `onLog` (replacing the `childElementCount` loop) and `repaintFilteredLog`.

- [ ] **Step 1: Write the failing jsdom tests** — append to `test/ui-live-log-dom.test.mjs`:

```js
test('the DOM cap counts record lines — separators do not cause over-eviction', async () => {
  const { window } = await bootLive();
  const { upsertRun, buildRunCard, onLog } = window.__np;
  const r = upsertRun({ runId: 'r-cap', title: 't', projectDir: '/tmp/proj', status: 'running' });
  r.el = buildRunCard(r);
  for (let i = 0; i < 4000; i++) {
    onLog(r, { source: 'planner', level: 'info', text: `l${i}`, ts: 0, stepIndex: 0, cycle: 1 });
  }
  onLog(r, { source: 'implementer', level: 'info', text: 'first of cycle 2', ts: 0, stepIndex: 0, cycle: 2 });
  const pane = r.el.querySelector('.log');
  // 4001 records + 1 separator entered; the cap must evict exactly ONE record.
  assert.equal(pane.querySelectorAll('.log-line').length, 4000, 'record cap, not childElementCount');
  assert.equal(pane.querySelectorAll('.log-sep').length, 1, 'the mid-pane separator survives');
  assert.match(pane.querySelector('.log-line').textContent, /l1$/, 'only the oldest record evicted');
});

test('eviction never leaves a separator leading the pane', async () => {
  const { window } = await bootLive();
  const { upsertRun, buildRunCard, onLog } = window.__np;
  const r = upsertRun({ runId: 'r-lead', title: 't', projectDir: '/tmp/proj', status: 'running' });
  r.el = buildRunCard(r);
  onLog(r, { source: 'planner', level: 'info', text: 'only cycle-1 line', ts: 0, stepIndex: 0, cycle: 1 });
  for (let i = 0; i < 4000; i++) {
    onLog(r, { source: 'implementer', level: 'info', text: `c2-${i}`, ts: 0, stepIndex: 0, cycle: 2 });
  }
  const pane = r.el.querySelector('.log');
  assert.equal(pane.querySelectorAll('.log-line').length, 4000);
  assert.ok(pane.firstElementChild.classList.contains('log-line'),
    'the now-boundary-less "Cycle 2" rule was dropped with its predecessor');
  assert.equal(pane.querySelectorAll('.log-sep').length, 0);
});
```

(~8k `onLog` calls total; the facet check is incremental after the first paint, so this stays a few seconds.)

- [ ] **Step 2: Run, verify both fail** (first: 3999 lines; second: `.log-sep` leads the pane).

- [ ] **Step 3: Implement** — below `buildLogSeparator`:

```js
// ONE DOM cap for the streaming append and the filter repaint. Counts RECORD
// lines only (the model cap counts records too — counting separators made the
// two caps diverge and over-evict), evicts oldest-first, and drops a separator
// left leading the pane: a rule above the first line labels nothing.
function trimLogDom(logEl) {
  const lines = logEl.getElementsByClassName('log-line'); // live collection
  while (lines.length > MAX_LOG_LINES) logEl.removeChild(logEl.firstElementChild);
  while (logEl.firstElementChild && logEl.firstElementChild.classList.contains('log-sep')) {
    logEl.removeChild(logEl.firstElementChild);
  }
}
```

In `onLog` replace `while (logEl.childElementCount > MAX_LOG_LINES) logEl.removeChild(logEl.firstChild);` with `trimLogDom(logEl);`. In `repaintFilteredLog` add `trimLogDom(logEl);` right after the render loop (the model is capped, so this is a same-invariant guard, not a behavior change).

- [ ] **Step 4: Run `test/ui-live-log-dom.test.mjs` + `test/ui-history-logs.test.mjs`, verify green. Commit**

```bash
git add ui/public/app.js test/ui-live-log-dom.test.mjs
git commit -m "fix(ui): trim the log DOM by record count, drop orphan leading rules

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Compiled filters, fragment repaints, History tail cap (F14)

**Files:**
- Modify: `ui/public/log-filter.mjs` (`compileLogFilter`), `ui/public/app.js` (import at :58; `repaintFilteredLog`; `loadLiveLogs` `paint` + copy handlers at 8001/9403)
- Test: `test/log-filter.test.mjs`, `test/ui-history-logs.test.mjs`

**Interfaces:**
- Produces: `export function compileLogFilter(filter)` → predicate with all per-axis normalization (notably `search.toLowerCase()`) hoisted; `logLineVisible(rec, filter)` becomes a thin wrapper (public API unchanged). History renders at most `MAX_LOG_LINES` tail lines plus a notice; copy still takes ALL matches.

- [ ] **Step 1: Write the failing tests**

`test/log-filter.test.mjs` (extend the import with `compileLogFilter`):

```js
// ── compiled filters ────────────────────────────────────────────────────────

test('compileLogFilter matches logLineVisible on every axis', () => {
  const recs = [
    L({ source: 'implementer', level: 'debug', stepIndex: 1, cycle: 2, text: '→ Read a.js' }),
    L({ source: 'planner', text: 'hello' }),
    L({ cycle: 1 }), L({}),
  ];
  const filters = [
    null, {}, { search: 'READ' }, { level: 'debug' }, { source: 'implementer' },
    { step: '1' }, { cycle: '2' }, { source: 'implementer', level: 'debug', step: '1', cycle: '2', search: 'read' },
  ];
  for (const f of filters) {
    const pred = compileLogFilter(f);
    for (const rec of recs) assert.equal(pred(rec), logLineVisible(rec, f), JSON.stringify({ f, rec }));
  }
});

test('compileLogFilter lowercases the term once, at compile time', () => {
  let reads = 0;
  const filter = { get search() { reads++; return 'GRAPH'; } };
  const pred = compileLogFilter(filter);
  const before = reads;
  pred(L({ text: 'building the graph' }));
  pred(L({ text: 'no match here' }));
  assert.equal(reads, before, 'the filter object is not re-read per record');
});
```

`test/ui-history-logs.test.mjs`:

```js
test('History tail-renders huge logs and says so; copy still takes everything', async () => {
  const N = 4005;
  let NDJSON = '';
  for (let i = 0; i < N; i++) {
    NDJSON += `{"source":"planner","level":"info","text":"line ${i}","ts":"2026-06-20T00:00:01Z","stepIndex":0,"cycle":1}\n`;
  }
  const { ctx, panel } = await openLogsPanel(NDJSON);   // helper from Task 11
  assert.equal(panel.querySelectorAll('.log .log-line').length, 4000, 'DOM bounded like the live card');
  assert.match(panel.querySelector('.log').textContent, /showing the last 4000 of 4005 matching lines/);
  const writes = [];
  Object.defineProperty(ctx.window.navigator, 'clipboard',
    { configurable: true, value: { writeText: async (t) => { writes.push(t); } } });
  panel.querySelector('.log-copy').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].split('\n').length, N, 'copy is the FULL filtered set, not the tail render');
});
```

- [ ] **Step 2: Run both files, verify the new tests fail.**

- [ ] **Step 3: Implement `compileLogFilter`** — in `ui/public/log-filter.mjs`, move the axis logic into the compiled form and delegate:

```js
/** Compile a filter into a predicate. Per-axis normalization (notably the
 *  search term's toLowerCase) happens ONCE here instead of once per record —
 *  a repaint runs the predicate over up to MAX_LOG_LINES records per
 *  keystroke tick. Same semantics as logLineVisible by construction. */
export function compileLogFilter(filter) {
  if (!filter) return () => true;
  const level = filter.level || '';
  const source = filter.source || '';
  const hasStep = filter.step !== undefined && filter.step !== '';
  const step = hasStep ? String(filter.step) : '';
  const hasCycle = filter.cycle !== undefined && filter.cycle !== '';
  const cycle = hasCycle ? String(filter.cycle) : '';
  const term = filter.search ? String(filter.search).toLowerCase() : '';
  return (rec) => {
    if (level && (rec.level || 'info') !== level) return false;
    if (source) {
      const src = rec.source || '';
      if (src !== source && !src.startsWith(source + SUB_SEP)) return false;
    }
    if (hasStep && (rec.stepIndex == null || String(rec.stepIndex) !== step)) return false;
    if (hasCycle && (rec.cycle == null || String(rec.cycle) !== cycle)) return false;
    if (term && !String(rec.text || '').toLowerCase().includes(term)) return false;
    return true;
  };
}

export function logLineVisible(rec, filter) {
  return compileLogFilter(filter)(rec);
}
```

(Keep the module's header comment; delete the old inline body of `logLineVisible`.)

- [ ] **Step 4: Use it + batch the repaints** — in `app.js` add `compileLogFilter` to the `./log-filter.mjs` import.

`repaintFilteredLog` render section becomes:

```js
  const savedTop = logEl.scrollTop;
  logEl.innerHTML = '';
  delete logEl.dataset.empty;
  const visible = compileLogFilter(r.logFilter);
  // One fragment, one reflow — appending 4000 nodes into the live document
  // per debounce tick is where search jank came from.
  const frag = document.createDocumentFragment();
  let shown = 0;
  let prevCycle = null;
  for (const rec of r.logLines) {
    if (!visible(rec)) continue;
    prevCycle = appendLogRec(frag, rec, prevCycle);
    shown++;
  }
  logEl.appendChild(frag);
  r._lastRenderedCycle = prevCycle;
  trimLogDom(logEl);
```

`loadLiveLogs`'s `paint` becomes:

```js
    const paint = () => {
      box.innerHTML = '';
      const visible = compileLogFilter(filter);
      const matches = recs.filter(visible);
      // Tail-render: the History NDJSON is uncapped and every debounce tick
      // repaints — bound the DOM like the live card. Copy keeps ALL matches.
      const shown = matches.length > MAX_LOG_LINES ? matches.slice(-MAX_LOG_LINES) : matches;
      const frag = document.createDocumentFragment();
      if (shown.length < matches.length) {
        const note = document.createElement('div');
        note.className = 'hint';
        note.textContent = `(showing the last ${shown.length} of ${matches.length} matching lines — copy takes all ${matches.length})`;
        frag.appendChild(note);
      }
      let prevCycle = null;
      for (const rec of shown) prevCycle = appendLogRec(frag, rec, prevCycle);
      box.appendChild(frag);
      if (matches.length === 0) box.textContent = recs.length ? '(no lines match the filter)' : '(no log lines)';
    };
```

Both copy call sites switch to the compiled form: `r.logLines.filter(compileLogFilter(r.logFilter))` (live, :8001) and `recs.filter(compileLogFilter(filter))` (History, :9403).

- [ ] **Step 5: Run `test/log-filter.test.mjs`, `test/ui-history-logs.test.mjs`, `test/ui-live-log-dom.test.mjs`, verify green. Commit**

```bash
git add ui/public/log-filter.mjs ui/public/app.js test/log-filter.test.mjs test/ui-history-logs.test.mjs
git commit -m "perf(ui): compile log filters, batch repaints, tail-render History logs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: One filter bar, one reader, one debounce (F15) + final verification

**Files:**
- Modify: `ui/public/app.js` (new `buildLogFilterBar`, `readLogFilterFrom`, `scheduleLogSearch`; `readCardLogFilter`; `paintLogFilters` `effective`; the live `input` handler at 7981-7992; `loadLiveLogs` bar construction at 9361-9405)
- Test: `test/ui-history-logs.test.mjs`

**Interfaces:**
- Produces: `buildLogFilterBar()` — clones `.log-filters` out of `#run-card-tpl` (the template becomes the ONE source of the bar's markup); `readLogFilterFrom(root, prevSearch)` — the ONE filter reader (search read by presence, `prevSearch` when the box is absent); `scheduleLogSearch(holder, fn)` — the ONE debounce (state on `holder._logSearchTimer`, delay `LOG_SEARCH_DEBOUNCE_MS`).

- [ ] **Step 1: Write the parity test** — append to `test/ui-history-logs.test.mjs`. This is a refactor guard; it may already pass against the string-built bar — acceptable for this one task, the existing History behavior tests (picker options, search, copy) are the red-detector if the refactor breaks anything:

```js
test('the History filter bar is the run-card template bar — one markup source', async () => {
  const { ctx, panel } = await openLogsPanel(
    '{"source":"planner","level":"info","text":"Planning…","ts":"2026-06-20T00:00:01Z","stepIndex":0,"cycle":1}\n');
  const doc = ctx.window.document;
  const tplBar = doc.getElementById('run-card-tpl').content.querySelector('.log-filters');
  const histBar = panel.querySelector('.log-filters');
  assert.deepEqual(
    [...histBar.children].map((el) => el.className),
    [...tplBar.children].map((el) => el.className),
    'History bar matches the template bar — no drift');
  assert.ok(histBar.querySelector('.log-search').getAttribute('aria-label'), 'a11y rides along');
  assert.equal(histBar.querySelector('.log-copy').getAttribute('type'), 'button');
});
```

- [ ] **Step 2: Implement the shared trio** — near `readCardLogFilter`:

```js
// The ONE source of the filter bar's markup is the run-card template; History
// clones it so the two bars can never drift (control order, classes, a11y).
function buildLogFilterBar() {
  return document.getElementById('run-card-tpl').content.querySelector('.log-filters').cloneNode(true);
}

// The ONE filter reader for both bars. The search box is read by PRESENCE, not
// truthiness: an empty box means the user cleared the term, which must win over
// the stored value; `prevSearch` only applies when the box is absent.
function readLogFilterFrom(root, prevSearch = '') {
  const searchEl = root.querySelector('.log-search');
  return {
    source: root.querySelector('.log-f-source')?.value || '',
    level: root.querySelector('.log-f-level')?.value || '',
    step: root.querySelector('.log-f-step')?.value || '',
    cycle: root.querySelector('.log-f-cycle')?.value || '',
    search: searchEl ? searchEl.value : prevSearch,
  };
}

// The ONE search debounce: state rides on `holder` so the delegated live-card
// path (per-run timer) and History's closure share the implementation.
function scheduleLogSearch(holder, fn) {
  clearTimeout(holder._logSearchTimer);
  holder._logSearchTimer = setTimeout(fn, LOG_SEARCH_DEBOUNCE_MS);
}
```

Then:
1. `readCardLogFilter` body becomes `return readLogFilterFrom(card, r.logFilter.search || '');` (keep the function — it carries the per-run `prevSearch` default).
2. `paintLogFilters`: replace the hand-built `effective` object with `const effective = readLogFilterFrom(root, r.logFilter.search);` (the comparison/repaint block below stays).
3. The live `input` handler: replace the `clearTimeout(r._logSearchTimer); r._logSearchTimer = setTimeout(…)` pair with `scheduleLogSearch(r, () => { r.logFilter = readCardLogFilter(card, r); repaintFilteredLog(r); });`.
4. `loadLiveLogs`: replace `const bar = document.createElement('div'); bar.className = 'log-filters';` with `const bar = buildLogFilterBar();`, delete the whole select-building loop and the hand-built search/copy elements, and wire the cloned controls:

```js
    const facets = logFacets(recs);
    fillFilterSelect(bar.querySelector('.log-f-source'), 'all sources', facets.sources, '');
    fillFilterSelect(bar.querySelector('.log-f-level'), 'all levels', facets.levels, '');
    fillFilterSelect(bar.querySelector('.log-f-step'), 'all steps', facets.steps, '', (i) => `step ${i + 1}`);
    fillFilterSelect(bar.querySelector('.log-f-cycle'), 'all cycles', facets.cycles, '', (c) => `cycle ${c}`);
    bar.addEventListener('change', (e) => {
      if (!(e.target.closest && e.target.closest('select.log-f'))) return;
      Object.assign(filter, readLogFilterFrom(bar, filter.search));
      paint();
    });
    const searchHolder = {};
    bar.querySelector('.log-search').addEventListener('input', () => {
      scheduleLogSearch(searchHolder, () => { Object.assign(filter, readLogFilterFrom(bar, filter.search)); paint(); });
    });
    bar.querySelector('.log-copy').addEventListener('click', (e) => {
      copyLogToClipboard(e.target.closest('.log-copy'), recs.filter(compileLogFilter(filter)));
    });
```

- [ ] **Step 3: Run the UI test files**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history-logs.test.mjs test/ui-log-filters-row.test.mjs test/ui-running-resume.test.mjs test/ui-live-log-dom.test.mjs`
Expected: PASS (History picker/search/copy behavior tests prove the cloned bar works end to end).

- [ ] **Step 4: Full-suite + whole-plan verification**

Run: `npm test`
Expected: the ENTIRE suite green. Then re-read the spec's 15 findings and confirm each maps to a landed commit: F1→T8, F2→T5, F3→T9, F4→T1, F5→T4, F6→T6, F7→T1, F8→T12, F9→T3+T5, F10→T2, F11→T10, F12→T11, F13→T7, F14→T13, F15→T14.

- [ ] **Step 5: Commit**

```bash
git add ui/public/app.js test/ui-history-logs.test.mjs
git commit -m "refactor(ui): one log filter bar source, one reader, one debounce

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
