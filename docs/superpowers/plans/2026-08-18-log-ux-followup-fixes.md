# Log-UX Follow-up Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 15 confirmed code-review findings of commit 5a6d1df2 (log-UX review fixes) with red-first regression tests.

**Architecture:** Four back-end clusters (stderr classification pipeline, abort/pause semantics, phase sibling-cancellation, stream-provenance tagging) plus one UI/test cluster. Shared primitives move to leaf module `src/core/recoverable-error.mjs` (`isAbort`, `strongestClass`) and `src/core/worktree.mjs` (`gitFailure`); everything else is site-local fixes with pinned tests.

**Tech Stack:** Node ESM (.mjs), `node:test` + `node:assert/strict`, jsdom for UI suites, no fake timers (repo convention — zero backoff via env instead).

**Spec:** `docs/superpowers/specs/2026-08-18-log-ux-followup-fixes-spec.md` (severity table + acceptance criteria live there).

## Global Constraints

- This plan and its spec stay **untracked**. Never `git add docs/` (repo policy).
- All line numbers refer to commit **5a6d1df2**. Earlier tasks shift later line numbers in the same file — always locate edit sites by the quoted code, not the number.
- Red-first TDD every task (except Task 10, a pure extraction): write the test, run it, see the exact expected failure, then implement.
- Run per-file tests with `node --test test/<file>.mjs`. Full `npm test` only in Task 15 (2619 tests; needs `npm ci` first in a fresh worktree — else bogus express failures).
- Pause semantics must stay byte-identical (pauseAbort already kills in-flight siblings today; pause outranks failure).
- Thrown message formats pinned by existing tests must not change: `step failed: ` prefix + `^claude exited with code 1` head, `Decomposed implement failed in phase N: task "T": ...`, `git worktree add failed: ...`.
- `test/decomposed-error-line.test.mjs` pins: a genuine decomposed failure logs exactly ONE error line; a sibling-cancel abort logs NONE. Both must survive every task.
- New exports introduced here: `isAbort`, `strongestClass` (recoverable-error.mjs), `gitFailure` (worktree.mjs), `bootLive`/`SEEDED_LOG_NDJSON` (test/helpers/boot-live.mjs). No other public-surface additions (T1 also deletes orchestrator's `isAbort` export — its only importer is the test, which moves).

## Task order & dependencies

Severity-first within dependencies: T1→T2→T3 (abort foundations, F11/F4/F3), T4 (F7), T5 (F1+F10), T6 (F5), T7 (F2), T8 (F8a), T9 (F8b+F12, needs T8), T10 (F15), T11 (F13), T12 (F6), T13 (F9, needs T10), T14 (F14, needs T10), T15 verification. T1 must precede T2/T3 (shared `isAbort` import). T4 (stdout handler :407-409) and T5 (stderr handler :466-472 + close :492) touch disjoint regions of claude-runner.mjs and are order-independent; the stderr abort-gate inside T5's snippet is the PRE-EXISTING one (HEAD :469-471), not T4's — T4 only adds its stdout mirror. Keep the gate.

**Validation status:** two independent reviewers verified this plan empirically at 5a6d1df2: every red-first test in T2–T9 and T11–T14 was run RED on HEAD and GREEN against scratchpad copies with the exact patches applied (T7's test file works verbatim; neighbor suites re-run green against patched copies; timing-sensitive tests stable 3×). T10 is a byte-preserving extraction guarded by its three suites; T15 is the only whole-suite gate.

---

### Task 1: Single `isAbort` home in `recoverable-error.mjs` (F11)

**Files:**
- Modify: `src/core/recoverable-error.mjs` (append export)
- Modify: `src/core/orchestrator.mjs:83` (import), `:3891-3897` (delete local)
- Modify: `src/core/workspace-scan.mjs:401-407` (delete local, add import)
- Modify: `src/core/agent-gen.mjs:200-206` (delete local, add import)
- Test: `test/abort-classify.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function isAbort(err): boolean` from `src/core/recoverable-error.mjs` — used by Task 2's test and Task 3's code; orchestrator continues to reference `isAbort` unqualified.

Verified import graph (no cycle possible): `recoverable-error.mjs` imports nothing; nothing under `src/` imports `agent-gen.mjs` or `workspace-scan.mjs` except `ui/server.mjs`; orchestrator already imports `recoverable-error.mjs` at line 83.

- [ ] **Step 1: Repoint the test + add the worktree-shape case (red)**

In `test/abort-classify.test.mjs`, change the import to `import { isAbort } from '../src/core/recoverable-error.mjs';` (keep the three existing tests unchanged) and append:

```js
test('the worktree abort shape: only the STAMPED name classifies, never the message', () => {
  // createWorktree's spawn-abort path produces exactly this message; unstamped
  // it must NOT classify (that is why worktree.mjs stamps the name — the plain
  // form would silently degrade a scan member on Stop).
  assert.equal(isAbort(new Error('git worktree add failed: The operation was aborted')), false);
  const stamped = new Error('git worktree add failed: The operation was aborted');
  stamped.name = 'AbortError';
  assert.equal(isAbort(stamped), true);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/abort-classify.test.mjs`
Expected: FAIL — `recoverable-error.mjs` has no export `isAbort`.

- [ ] **Step 3: Implement**

Append to `src/core/recoverable-error.mjs`:

```js
/**
 * Abort classification by NAME only. Every abort/stop throw in this codebase
 * stamps name='AbortError' (orchestrator stop()/_checkAbort, claude-runner,
 * workspace-scan/agent-gen _checkAbort, worktree createWorktree); sniffing the
 * message also matched real failures containing "aborted"/"stopped" and
 * swallowed their terminal error line, recovery, and decomposed failure
 * detection.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isAbort(err) {
  return !!err && err.name === 'AbortError';
}
```

Then, in each of the three modules, delete the local `isAbort` function AND its false "importing it would create an import cycle" comment, and import instead:
- `src/core/orchestrator.mjs`: line 83 becomes `import { classifyError, isAbort } from './recoverable-error.mjs';`; delete the local `export function isAbort` block at 3891-3897. (No back-compat re-export — the only importer of `orchestrator.isAbort` is the test, which moved.)
- `src/core/workspace-scan.mjs`: add `import { isAbort } from './recoverable-error.mjs';` to the import block; delete lines 401-407.
- `src/core/agent-gen.mjs`: add the same import; delete lines 200-206.

- [ ] **Step 4: Run — expect PASS**

Run: `node --test test/abort-classify.test.mjs test/decomposed-error-line.test.mjs test/recoverable-error.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/recoverable-error.mjs src/core/orchestrator.mjs src/core/workspace-scan.mjs src/core/agent-gen.mjs test/abort-classify.test.mjs
git commit -m "refactor(core): single isAbort home in recoverable-error.mjs"
```

---

### Task 2: Stamp AbortError on aborted `git worktree add` (F4)

**Files:**
- Modify: `src/core/worktree.mjs:272-275` (createWorktree throw)
- Test: `test/worktree.test.mjs`

**Interfaces:**
- Consumes: Task 1's shared `isAbort` (test semantics only).
- Produces: `createWorktree` rejects with `err.name === 'AbortError'` whenever its `signal` was aborted (message unchanged). Fixes `workspace-scan.mjs:261`'s `if (isAbort(e)) throw e;` with no change to workspace-scan itself.

- [ ] **Step 1: Write the failing test**

Append to `test/worktree.test.mjs` (uses the file's existing `freshRepo` helper):

```js
test('createWorktree names an aborted `git worktree add` AbortError (a stop is not a git failure)', async () => {
  const repo = await freshRepo();
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => createWorktree({ projectDir: repo, pipelineId: 'ab1', sourceBranch: 'main', featureBranch: 'worca-cc/ab1', signal: ac.signal }),
    (err) => {
      assert.equal(err.name, 'AbortError');
      assert.match(err.message, /git worktree add failed/);
      return true;
    },
  );
});
```

Note: match the file's actual `createWorktree` call signature from its existing tests (options-object vs positional) and `freshRepo`'s actual name/branch; the assertion body is the contract.

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/worktree.test.mjs`
Expected: FAIL — `err.name` is `'Error'`.

- [ ] **Step 3: Implement**

In `src/core/worktree.mjs`, replace the throw at the `git worktree add` result check (lines 272-275):

```js
  const r = await git(projectDir, args, { signal, timeout: SLOW_GIT_TIMEOUT_MS });
  if (!r.ok) {
    const err = new Error(`git worktree add failed: ${r.stderr.trim() || `exit ${r.code}`}`);
    // The ONE abort path that surfaced as a PLAIN error: on signal abort Node
    // kills the spawned git and git() resolves ok:false (spawn's 'error' yields
    // "The operation was aborted" — or whatever git wrote before dying, which
    // may not mention the abort at all). Stamp the name every other abort/stop
    // site sets so isAbort callers classify the stop as a stop, not a failure.
    if (signal?.aborted) err.name = 'AbortError';
    throw err;
  }
```

Why here, not in `git()`'s `'error'` handler: `git()` never throws (resolves `{ok:false}`), and the abort can also surface through the close-after-kill race — `signal?.aborted` at the throw covers both; this is the only throwing `git()` call in the module.

- [ ] **Step 4: Run — expect PASS (all 28 existing + 1 new)**

Run: `node --test test/worktree.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/worktree.mjs test/worktree.test.mjs
git commit -m "fix(worktree): stamp AbortError on aborted git worktree add"
```

---

### Task 3: Decomposed-task pause marks 'paused', not 'error' (F3)

**Files:**
- Modify: `src/core/orchestrator.mjs:2264-2278` (`_runDecomposedTask` catch/finally) + its docblock line "updateTaskStatus tracks running/done/error" → ".../paused"
- Test: `test/decomposed-error-line.test.mjs`

**Interfaces:**
- Consumes: `isAbort` (Task 1), existing `isPause`, `pauseErr`, `this.pauseRequested`, `this.pauseAbort`.
- Produces: on pause, task row status `'paused'` (no `finished_at`), stepper cell `'paused'`. `_nodeStep` and `updateTaskStatus` already accept `'paused'` (verified: `_nodeStep` treats it as first-class terminal at orchestrator.mjs:2958; `updateTaskStatus` sets neither timestamp for it; app.js:1393-1400 renders it).

- [ ] **Step 1: Write the failing test**

In `test/decomposed-error-line.test.mjs`, extend the file's imports so all of these are present (keep whatever it already imports):

```js
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, _resetForTests } from '../src/core/db.mjs';
import { writeDecomposition, listTasks } from '../src/core/artifacts.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
```

Append the hermetic-DB block and the test (this exact code was run by the empirical reviewer: RED on HEAD at `'error' !== 'paused'`, GREEN with Step 3's body, merged file 5/5 — the `beforeEach` is harmless for the four existing tests, whose DB calls are best-effort no-ops under the temp home):

```js
let home;
beforeEach(async () => {
  _resetForTests();
  home = await mkdtemp(join(tmpdir(), 'worca-cc-decomp-'));
  process.env.WORCA_HOME = home;
  // A pipeline row must exist (FK target for the decomposition rows).
  getDb().prepare(
    "INSERT INTO pipelines (id, project_key, started_at) VALUES ('p-red','proj-1', '2026-06-09')"
  ).run();
  writeDecomposition('p-red', [
    { ordinal: 1, tasks: [{ id: 'p1t1', title: 'Slice A', file: 'tasks/p1-t1.md', nodeId: 's_impl_p1_t1' }] },
  ]);
});
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  if (home) await rm(home, { recursive: true, force: true });
});

test('a usage-limit pause reaching _runDecomposedTask marks the task + step paused, not error', async () => {
  const { orch, logs } = loggedOrch();
  orch.pipeline = { id: 'p-red', dir: home };
  orch._nodeCtx = () => ({});
  orch._bindNodeIo = () => ({});
  orch.pauseRequested = true;                       // _pauseForLimit already fired
  orch._runNodeAttempts = async () => {             // attempt loop unwinds as a pause
    const e = new Error('paused'); e.name = 'PauseError'; throw e;
  };
  const taskNode = { key: 'implementer', nodeId: 's_impl_p1_t1', runnerType: 'producer' };
  await assert.rejects(
    () => orch._runDecomposedTask(taskNode, { id: 'p1t1', title: 'Slice A' }, 2, 1, {}, new AbortController()),
    (err) => err?.name === 'PauseError',
  );
  const step = orch.state.steps.find((s) => s.nodeId === 's_impl_p1_t1');
  assert.equal(step?.status, 'paused', 'stepper cell must be paused, not error');
  assert.equal(listTasks('p-red')[0].status, 'paused', 'task row must be paused');
  assert.equal(listTasks('p-red')[0].finishedAt, null, 'a paused task has not finished');
  assert.equal(logs.filter((l) => l.level === 'error').length, 0, 'a pause is not a failure');
});
```

Do NOT stub `_nodeStep` — the test reads `orch.state.steps`, and the real `_nodeStep` works on a bare orchestrator. Verified facts behind the assertions (`src/core/artifacts.mjs:496-529`): `updateTaskStatus` sets `finished_at` only for `'done'|'error'` — `'paused'` leaves it NULL; `listTasks` returns camelCase `finishedAt`/`status`.

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/decomposed-error-line.test.mjs`
Expected: FAIL — step status `'error'`, task status `'error'`.

- [ ] **Step 3: Implement**

Replace `_runDecomposedTask`'s try/catch/finally tail (orchestrator.mjs:2264-2278):

```js
    let status = 'done';
    try {
      // Through _runNodeAttempts, not a bare runner call: a decomposed task gets
      // the SAME recovery/usage-limit treatment as a normal node (the bare call
      // also bypassed the terminal error line entirely — a failed decomposed run
      // used to produce zero error-level lines).
      await this._runNodeAttempts(taskNode, stepIndex, cycle, ctx);
    } catch (err) {
      // Same conversion _runNode applies (2317-2319): a usage-limit/user pause
      // unwinds through _runNodeAttempts as a pause, and a pause is NOT this
      // task's failure — without it the finally stamps the task row and the
      // stepper cell 'error' on a merely paused, resumable run, and
      // _buildResumePoint sees no 'paused' step.
      if (this.pauseRequested && (isAbort(err) || isPause(err) || this.pauseAbort.signal.aborted)) {
        status = 'paused';
        throw pauseErr();
      }
      status = 'error';
      this._logStepFailure(taskNode, stepIndex, cycle, err);
      throw err;
    } finally {
      updateTaskStatus(this.pipeline.id, task.id, status, new Date().toISOString());
      this._nodeStep(taskNode, stepIndex, cycle, status);
    }
```

(The `status === 'error' ? 'error' : 'done'` ternary goes away — `status` carries the exact mark. Preserve whatever real body sits inside the current `try` besides the attempts call; only the catch/finally logic changes.)

- [ ] **Step 4: Run — expect PASS (including the two pre-existing pins in this file)**

Run: `node --test test/decomposed-error-line.test.mjs test/orchestrator-pause.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator.mjs test/decomposed-error-line.test.mjs
git commit -m "fix(pipeline): decomposed task pause marks paused, not error"
```

---

### Task 4: Suppress post-abort stdout stream-json (F7)

**Files:**
- Modify: `src/core/claude-runner.mjs:407-409` (stdout `rl.on('line')` head)
- Test: `test/runner-error-surface.test.mjs`

**Interfaces:**
- Consumes: existing `signal`, existing stderr gate at :471 as the pattern.
- Produces: no `safeEmit` and no accumulator writes from stdout lines once `signal.aborted` (all provably dead: `runReal` always rejects AbortError at `close` post-abort; pause flow never awaits a post-abort `result` event).

- [ ] **Step 1: Write the failing test**

Append to `test/runner-error-surface.test.mjs` (uses the file's `makeTmpDir`/`fakeShell` helpers). The naive torn-half-line recipe is flaky (measured 1-in-5 false pass); use the deterministic handshake — the child prints the line *because of* the SIGTERM:

```js
test('stdout stream-json emitted by the dying child after an abort is suppressed', async () => {
  const dir = await makeTmpDir();
  const late = '{"type":"assistant","message":{"content":[{"type":"text","text":"late tool chatter"}]}}';
  // The TERM trap prints a COMPLETE stream-json line only when the abort's
  // SIGTERM lands — strictly after signal.aborted. The background sleep's
  // stdio is detached so the pipe closes the moment the shell exits.
  const bin = await fakeShell(dir, [
    `trap 'printf "%s\\n" "${late.replace(/"/g, '\\"')}"; exit 143' TERM`,
    `printf 'ready\\n' 1>&2`,           // handshake: the trap is installed
    'sleep 5 >/dev/null 2>&1 &',
    'wait $!',
  ]);
  const ac = new AbortController();
  const events = [];
  const p = runClaude({
    bin, prompt: 'hi', cwd: dir, signal: ac.signal,
    onEvent: (e) => {
      events.push(e);
      if (e.type === 'stderr' && e.text === 'ready') ac.abort(); // abort AFTER the trap exists
    },
  });
  await assert.rejects(p, (err) => { assert.equal(err.name, 'AbortError'); return true; });
  assert.deepEqual(events, [{ type: 'stderr', stream: 'err', text: 'ready' }],
    `only the pre-abort handshake may surface (got ${JSON.stringify(events.map((e) => e.type))})`);
});
```

- [ ] **Step 2: Run — expect FAIL (deterministically: consultant measured red 6/6 on HEAD)**

Run: `node --test test/runner-error-surface.test.mjs`
Expected: FAIL — an `assistant` event leaks after abort.

- [ ] **Step 3: Implement**

Insert a blanket gate at the very top of the stdout handler (claude-runner.mjs:407-409):

```js
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      // Post-abort gate — the stdout mirror of the stderr gate below: a
      // pause/stop SIGTERMs the child, and whatever its dying stdout still
      // flushes (assistant/tool_use stream-json, the readline carry) is not run
      // output — unsuppressed it keeps painting lines into a paused run. The
      // promise rejects AbortError at close regardless, so nothing downstream
      // ever reads what this drops.
      if (signal?.aborted) return;
      const trimmed = line.trim();
      // …existing body unchanged…
```

- [ ] **Step 4: Run — expect PASS (all 12 existing + 1 new; plus session suite)**

Run: `node --test test/runner-error-surface.test.mjs test/claude-runner-session.test.mjs`
Expected: PASS (consultant verified both suites green against a patched copy; green 3/3 repeat runs for the new test).

- [ ] **Step 5: Commit**

```bash
git add src/core/claude-runner.mjs test/runner-error-surface.test.mjs
git commit -m "fix(runner): suppress post-abort stdout stream-json"
```

---

### Task 5: Classify recovery markers from the full stderr stream; bound stderrBuf (F1 + F10)

**Files:**
- Modify: `src/core/recoverable-error.mjs` (stamp check in `classifyError`, new `strongestClass`, module-top CAVEAT comment)
- Modify: `src/core/claude-runner.mjs` (import; STDERR_DETAIL_MAX comment :44-47; `stderrClass` decl :372; `rlErr` line handler :466-472; close-handler stamp after :492)
- Test: `test/runner-error-surface.test.mjs`

**Interfaces:**
- Consumes: existing `classifyError` regex chain (order: auth → usage_limit → rate_limit → quota → network); existing `STDERR_DETAIL_MAX = 2000`.
- Produces: `err.errorClass` stamped on every non-zero-exit error (`'auth'|'usage_limit'|'rate_limit'|'quota'|'network'|null`); `classifyError(err)` returns a present stamp verbatim (including explicit `null` — re-sniffing the capped message can only lose an early marker or mint a fake one at the slice boundary, empirically shown: `'…1401…'` cut at the boundary classifies `auth`); `export function strongestClass(a, b)`.

Design invariant (why per-line == pre-diff full-text): every classifyError regex is unanchored, so any per-line match is a whole-text match; every marker is single-line CLI output; fold order mirrors the regex chain, so first-regex-on-full-text == strongest-class-over-lines. Empirically verified on both reproduced defect cases.

- [ ] **Step 1: Write the failing tests**

Append to `test/runner-error-surface.test.mjs`; add `import { classifyError } from '../src/core/recoverable-error.mjs';` at top:

```js
// ── recovery classification must see the WHOLE stderr stream, not the capped tail ──
// classifyError is message-based; the tail cap above means a recovery marker
// printed before hundreds of chatter lines vanishes from err.message. The runner
// therefore classifies line-by-line as stderr streams (surviving the rolling
// buffer trim) and stamps err.errorClass; classifyError() returns the stamp.

test('a usage-limit marker that scrolled past the tail cap still classifies', async () => {
  const dir = await makeTmpDir();
  const bin = await fakeShell(dir, [
    `printf '%s\\n' "You've hit your session limit · resets 6pm (Europe/Sofia)" 1>&2`,
    `i=0; while [ $i -lt 300 ]; do printf 'chatter line %s padded padded padded padded\\n' $i 1>&2; i=$((i+1)); done`,
    'exit 1',
  ]);
  await assert.rejects(() => runClaude({ bin, prompt: 'hi', cwd: dir }), (err) => {
    assert.ok(err.message.length < 2200, `message stays bounded (got ${err.message.length})`);
    assert.doesNotMatch(err.message, /session limit/, 'precondition: the marker really scrolled past the cap');
    assert.equal(err.errorClass, 'usage_limit', 'class stamped from the full stream');
    assert.equal(classifyError(err), 'usage_limit', 'the orchestrator route pauses instead of hard-failing');
    return true;
  });
});

test('an early auth error is not misrouted to network by connection chatter in the tail', async () => {
  const dir = await makeTmpDir();
  const bin = await fakeShell(dir, [
    `printf '%s\\n' 'API Error: 401 Invalid authentication credentials' 1>&2`,
    `i=0; while [ $i -lt 300 ]; do printf 'MCP chatter %s: connection reset by peer, retrying\\n' $i 1>&2; i=$((i+1)); done`,
    'exit 1',
  ]);
  await assert.rejects(() => runClaude({ bin, prompt: 'hi', cwd: dir }), (err) => {
    assert.equal(err.errorClass, 'auth', 'auth outranks the network chatter that filled the tail');
    assert.equal(classifyError(err), 'auth');
    return true;
  });
});

test('a long stdout is_error detail keeps its class when the marker is capped away', async () => {
  const dir = await makeTmpDir();
  const detail = 'Not logged in · Please run /login. ' + 'chatter '.repeat(400); // marker at HEAD, > cap
  const bin = await fakeBin(dir, {
    code: 1,
    stdout: JSON.stringify({ type: 'result', is_error: true, result: detail }),
  });
  await assert.rejects(() => runClaude({ bin, prompt: 'hi', cwd: dir }), (err) => {
    assert.doesNotMatch(err.message, /Not logged in/, 'precondition: marker capped out of the message');
    assert.equal(err.errorClass, 'auth', 'classified against the full errorDetail, not the capped message');
    assert.equal(err.stream, undefined, 'stdout-borne failure is still not stream:err');
    return true;
  });
});
```

(Match `fakeBin`'s actual option shape to the file's existing usages.) The first test's 13 KB of stderr also exercises the rolling trim — it is the interaction pin for F10: classification evidence must survive trimming. Do NOT export a buffer knob; the bound is not directly observable and correctness (ellipsis + tail survival) is what matters.

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/runner-error-surface.test.mjs`
Expected: 3 new tests FAIL — `err.errorClass` is `undefined`; test 2 additionally documents the live auth→network misroute.

- [ ] **Step 3: Implement — `recoverable-error.mjs`**

At the top of `classifyError`, before the message extraction:

```js
  // A producer that saw MORE evidence than the message carries stamps the
  // verdict directly: claude-runner classifies the FULL stderr stream line-by-
  // line, then tail-caps the message. Re-sniffing the capped message here could
  // only lose an early marker (or mint a fake one at the slice boundary), so a
  // stamp — including an explicit null — is authoritative.
  if (err && typeof err === 'object' && err.errorClass !== undefined) return err.errorClass;
```

Append after `classifyError`:

```js
// Precedence for folding per-line classes into the one whole-text class — the
// SAME order as the regex chain above. First-match-wins there equals
// strongest-class-wins here, because every per-line match (the patterns are
// unanchored) is also a whole-text match.
const CLASS_ORDER = ['auth', 'usage_limit', 'rate_limit', 'quota', 'network'];

/** Fold two classification results, keeping the higher-precedence class. */
export function strongestClass(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return CLASS_ORDER.indexOf(a) <= CLASS_ORDER.indexOf(b) ? a : b;
}
```

Amend the module-top CAVEAT comment: detection is message-based *unless the producer stamped `errorClass`*. Do not overclaim: the stamp lands only on the non-zero-exit path — spawn-failure errors (`${bin} error: …`, `Failed to spawn …`) stay unstamped and keep message-sniff classification, same as today.

- [ ] **Step 4: Implement — `claude-runner.mjs`**

Import: extend the existing import from `./recoverable-error.mjs` (or add one): `import { classifyError, strongestClass } from './recoverable-error.mjs';`

Replace the STDERR_DETAIL_MAX comment (:44-47) — it currently claims classifyError consumes the message:

```js
// Cap for the stderr detail embedded in a non-zero-exit Error message. The
// audit trail and the UI error banner consume that message; an uncapped
// stderrBuf (hundreds of KB of MCP/retry chatter) must not ride into them when
// every stderr line was already streamed as its own warn event. Classification
// does NOT ride on the capped message: recovery markers are classified line-by-
// line as stderr streams (see rlErr) and stamped on the error as `errorClass`.
const STDERR_DETAIL_MAX = 2000;
```

Declaration (:372):

```js
    let stderrBuf = '';
    // Strongest recovery class seen across ALL stderr lines — classified at
    // receive time, so it survives both the rolling trim and the tail cap.
    let stderrClass = null;
```

Replace the `rlErr.on('line')` body (:466-472) — note it PRESERVES the pre-existing stderr abort-gate (HEAD :469-471; Task 4's stdout gate is its mirror in a different handler):

```js
    rlErr.on('line', (line) => {
      // Classify BEFORE buffering: the class must see every line ever printed —
      // an early 401 or session-limit notice followed by hundreds of KB of MCP
      // chatter would otherwise scroll past both the trim and the tail cap.
      stderrClass = strongestClass(stderrClass, classifyError(line));
      stderrBuf += line + '\n';        // still the source of the exit-code detail
      // Rolling tail: bound memory against chatty MCP servers. Trim at 4x the
      // cap down to 2x — amortized, and the kept tail always exceeds
      // STDERR_DETAIL_MAX so the close handler's `… ` marker still fires.
      if (stderrBuf.length > STDERR_DETAIL_MAX * 4) stderrBuf = stderrBuf.slice(-STDERR_DETAIL_MAX * 2);
      const text = line.trim();
      // A pause/stop SIGTERMs the child: whatever it writes while dying (and the
      // torn fragment readline flushes at stream end) is not run output.
      if (text && !signal?.aborted) safeEmit(onEvent, { type: 'stderr', stream: 'err', text });
    });
```

Close handler — insert directly after `const err = new Error(...)` (:492):

```js
        // The recovery class, judged on the FULL evidence: the per-line stream
        // class when stderr fed the detail, else the (already fully in-memory)
        // stdout errorDetail. classifyError() returns this stamp verbatim, so
        // the tail cap above can never starve recovery — or flip an early auth
        // failure into 'network' because connection chatter filled the tail.
        err.errorClass = fromStderr ? stderrClass : classifyError(raw);
```

(`classifyError('no stderr')` is null — the fallback path stamps null, identical to pre-diff sniffing. The abort branch precedes this and stamps nothing.)

- [ ] **Step 5: Run — expect PASS**

Run: `node --test test/runner-error-surface.test.mjs test/recoverable-error.test.mjs test/orchestrator-recovery.test.mjs test/claude-runner-session.test.mjs`
Expected: PASS. (All recovery fixtures are plain Errors without `errorClass` — the stamp check falls through; the existing tail-cap test's 13 KB input now takes the trim path, verified: ellipsis fires, FINAL CAUSE survives.)

- [ ] **Step 6: Commit**

```bash
git add src/core/recoverable-error.mjs src/core/claude-runner.mjs test/runner-error-surface.test.mjs
git commit -m "fix(runner): classify recovery from full stderr stream; bound stderrBuf" \
  -m "Known limit: a recovery marker split across two stderr lines no longer matches (the old full-text sniff could, via [^.] spanning newlines); every known CLI marker is single-line."
```

---

### Task 6: `clipMiddle` for `_logStepFailure` (F5)

**Files:**
- Modify: `src/core/orchestrator.mjs:2291` (call site + docblock "Clipped:" sentence), `:4189` area (new helper next to `clip`)
- Test: `test/decomposed-error-line.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: module-local `clipMiddle(text, n)` — head ⅓, tail ⅔. `clip` keeps its 8 other call sites untouched.

Why head+tail, not pure tail: the pinned test `'_logStepFailure logs one clipped error line...'` asserts `/^step failed: claude exited with code 1/` — the frame must survive at the head; the runner's cap puts the cause at the END. Verified numerically: the symmetric 5000-x pinned test stays green (513 ≤ 520).

- [ ] **Step 1: Write the failing test**

Append to `test/decomposed-error-line.test.mjs` (uses the file's existing `loggedOrch`-style spy):

```js
test('_logStepFailure keeps the TAIL of a long message — the terminal cause — not just the head', () => {
  const { orch, logs } = loggedOrch();
  // Asymmetric on purpose: the symmetric 'x'.repeat(5000) test above cannot
  // tell a head clip from a tail clip, which is how the head-clip regression
  // shipped. The runner tail-caps because the cause sits at the END.
  const err = new Error(`claude exited with code 1: ${'x'.repeat(600)} ROOT CAUSE: repo not clean`);
  orch._logStepFailure({ key: 'implementer', nodeId: 'n7' }, 3, 2, err);
  assert.equal(logs.length, 1);
  assert.match(logs[0].text, /^step failed: claude exited with code 1/, 'frame (head) survives');
  assert.match(logs[0].text, /ROOT CAUSE: repo not clean$/, 'the cause (tail) survives');
  assert.ok(logs[0].text.length <= 520, `still clipped (got ${logs[0].text.length})`);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/decomposed-error-line.test.mjs`
Expected: FAIL — `clip` keeps the first ~499 chars; `ROOT CAUSE` gone (empirically pre-verified).

- [ ] **Step 3: Implement**

At :2291 swap `clip` → `clipMiddle` (and update the docblock's "Clipped:" sentence to say head+tail):

```js
    this._log(node.key, 'error', `step failed: ${clipMiddle(err?.message || err, 500)}`, {
```

Add next to `clip` (after :4189):

```js
/** clip(), but keeping HEAD and TAIL with an ellipsis between when over budget.
 *  For runner exit details the frame ("claude exited with code N") leads and
 *  the terminal cause sits at the END — the runner tail-caps for that reason —
 *  so a head-only clip discards exactly the cause. Tail gets the larger share. */
function clipMiddle(text, n) {
  if (!text) return '';
  const s = String(text).replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const head = Math.floor((n - 1) / 3);
  return s.slice(0, head) + '…' + s.slice(-(n - 1 - head));
}
```

- [ ] **Step 4: Run — expect PASS (incl. the symmetric pinned test)**

Run: `node --test test/decomposed-error-line.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator.mjs test/decomposed-error-line.test.mjs
git commit -m "fix(pipeline): keep the tail of long step-failure messages"
```

---

### Task 7: First genuine task failure cancels in-flight siblings (F2)

**Files:**
- Modify: `src/core/orchestrator.mjs:2200-2234` (phase loop body), `:2183-2190` + `:2249-2257` (both docstrings)
- Create: `test/decomposed-phase-abort.test.mjs`

**Interfaces:**
- Consumes: `isAbort` (Task 1), existing `isPause`/`pauseErr`, `this.pendingQuestion` single-slot prompt system, `decomposedTaskNode`, `updatePhaseStatus`, `appendAudit`.
- Produces: no signature changes. New semantics: per-task rejection observer fires `phaseAbort.abort()` on the FIRST genuine (non-abort, non-pause) failure while siblings still run, and rejects an open `kind === 'recovery'` prompt with an AbortError (mirroring `pause()`/`stop()`); thrown phase-error message byte-identical.

Verified guarantees: observer's `.catch` handler runs before `allSettled`'s own for the same promise, so `firstError` is set before the `await` resumes — a cancelled sibling's AbortError can never win selection; zero unhandled rejections (empirically checked, including double-genuine-failure: `aborts === 1`). Pause byte-identical: `pauseAbort` already kills siblings today; the `pauseRequested` check keeps priority over `firstError`. Accepted residuals (documented, not fixed): sibling mid-backoff settles ≤ one backoff window late; a queued second recovery prompt of a different class can open once (needs 3+ tasks, two classes, simultaneous failure).

- [ ] **Step 1: Write the failing tests (new file)**

Create `test/decomposed-phase-abort.test.mjs`:

```js
// test/decomposed-phase-abort.test.mjs — the FIRST genuine task failure must
// cancel still-running siblings IMMEDIATELY. Regression: phaseAbort.abort()
// used to run only in the post-allSettled forEach, so it could never cancel a
// running sibling — a 30-minute implementer burned its full runtime (plus
// recovery retries / a human-held recovery prompt) before the phase error threw.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

useTempHome(after);

const abortErr = () => { const e = new Error('aborted'); e.name = 'AbortError'; return e; };

// Node machinery stubbed at the decomposed-error-line.test.mjs seam:
// _runDecomposedImplement + _runDecomposedTask run REAL (observer, signal fold,
// selection); only _runNodeAttempts (the runner loop) is scripted per task node.
function decomposedOrch(attemptsByNode) {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch.pipeline = { id: 'p-phase-abort', dir: '/tmp/proj' };
  orch._nodeStep = () => {};
  orch._nodeCtx = () => ({});
  orch._bindNodeIo = () => ({});
  orch._persist = async () => {};
  orch._stageWorkingTree = async () => {};
  orch._runNodeAttempts = (node, stepIndex, cycle, ctx) => attemptsByNode[node.nodeId](ctx);
  return orch;
}

const IMPL = { key: 'implementer', model: 'sonnet', tools: ['Read'] };
const BUS = (tasks) => ({ decomposition: { phases: [{ ordinal: 1, tasks }] } });

// With the pre-fix code the never-settling sibling deadlocks allSettled, so the
// method under test would hang: race it against a watchdog that only elapses on
// failure (the fixed path settles in microtasks; the timer is cleared after).
async function raceWatchdog(p, ms = 2000) {
  let t;
  const guard = new Promise((res) => { t = setTimeout(() => res('HUNG'), ms); });
  try { return await Promise.race([p.then(() => 'resolved', (e) => e), guard]); }
  finally { clearTimeout(t); }
}

test('first genuine failure cancels a still-running sibling before allSettled; first failure wins over a later one', async () => {
  const tasks = [
    { id: 'p1t1', nodeId: 's_impl_p1_t1', title: 'Slice one', file: 'tasks/p1-t1.md' },
    { id: 'p1t2', nodeId: 's_impl_p1_t2', title: 'Slice two', file: 'tasks/p1-t2.md' },
    { id: 'p1t3', nodeId: 's_impl_p1_t3', title: 'Slice three', file: 'tasks/p1-t3.md' },
  ];
  let siblingCancelled = false;
  const orch = decomposedOrch({
    // t1: terminal failure on a microtask (the FIRST genuine failure).
    s_impl_p1_t1: async () => { await Promise.resolve(); throw new Error('claude exited with code 1: kaboom'); },
    // t2: the "30-minute implementer" — settles ONLY when its folded ctx.signal
    // aborts (claude-runner's contract: SIGTERM -> AbortError). Pre-fix this
    // promise never settles and the phase deadlocks on allSettled.
    s_impl_p1_t2: (ctx) => new Promise((_, rej) => {
      ctx.signal.addEventListener('abort', () => { siblingCancelled = true; rej(abortErr()); }, { once: true });
    }),
    // t3: a SECOND genuine failure, later (macrotask) — must not win selection.
    s_impl_p1_t3: () => new Promise((_, rej) => setTimeout(() => rej(new Error('second failure')), 20)),
  });

  const outcome = await raceWatchdog(orch._runDecomposedImplement(IMPL, 2, 1, BUS(tasks)));
  assert.notEqual(outcome, 'HUNG', 'sibling was never cancelled — phaseAbort fired only after allSettled');
  assert.match(outcome.message, /Decomposed implement failed in phase 1: task "Slice one": .*kaboom/);
  assert.equal(siblingCancelled, true, 'phaseAbort must reach the in-flight sibling via ctx.signal');
});

test('a sibling parked on an interactive recovery prompt is released — the doomed phase must not wait on a human', async () => {
  const tasks = [
    { id: 'p1t1', nodeId: 's_impl_p1_t1', title: 'Fails', file: 'tasks/p1-t1.md' },
    { id: 'p1t2', nodeId: 's_impl_p1_t2', title: 'In recovery', file: 'tasks/p1-t2.md' },
  ];
  let promptRejected = null;
  const orch = decomposedOrch({
    s_impl_p1_t1: async () => { await Promise.resolve(); throw new Error('claude exited with code 1: kaboom'); },
    // Parks exactly as _ask does: a bare promise settled only through
    // this.pendingQuestion (no AbortSignal can reach it).
    s_impl_p1_t2: () => new Promise((resolve, reject) => {
      orch.pendingQuestion = { id: 'recovery-auth-1', kind: 'recovery', resolve, reject };
    }).catch((e) => { promptRejected = e; throw e; }),
  });
  const outcome = await raceWatchdog(orch._runDecomposedImplement(IMPL, 2, 1, BUS(tasks)));
  assert.notEqual(outcome, 'HUNG', 'phase error must not wait for a human to answer a meaningless recovery prompt');
  assert.match(outcome.message, /task "Fails": .*kaboom/);
  assert.equal(promptRejected?.name, 'AbortError');
  assert.equal(orch.pendingQuestion, null, 'the rejected prompt slot must be cleared');
});

test('pause keeps its own unwind: the observer stays silent and no phase error is thrown', async () => {
  const tasks = [
    { id: 'p1t1', nodeId: 's_impl_p1_t1', title: 'Limit hit', file: 'tasks/p1-t1.md' },
    { id: 'p1t2', nodeId: 's_impl_p1_t2', title: 'Running', file: 'tasks/p1-t2.md' },
  ];
  const orch = decomposedOrch({
    // t1 hits a usage cap: _runNodeAttempts pauses the RUN and unwinds as a
    // PauseError (mirrors _pauseForLimit + throw pauseErr()).
    s_impl_p1_t1: async () => {
      await Promise.resolve();
      orch.state.status = 'running';
      orch.pause(); // fires pauseAbort -> kills siblings, sets pauseRequested
      const e = new Error('paused'); e.name = 'PauseError'; throw e;
    },
    // t2 is killed by pauseAbort (folded into ctx.signal) — as today; under
    // pauseRequested the attempts loop re-throws it as a PauseError.
    s_impl_p1_t2: (ctx) => new Promise((_, rej) => {
      ctx.signal.addEventListener('abort', () => { const e = new Error('paused'); e.name = 'PauseError'; rej(e); }, { once: true });
    }),
  });
  const outcome = await raceWatchdog(orch._runDecomposedImplement(IMPL, 2, 1, BUS(tasks)));
  assert.equal(outcome?.name, 'PauseError', `pause must unwind as a pause, got: ${outcome?.message || outcome}`);
});
```

(Signatures verified against the real file — `_runDecomposedImplement(implNode, stepIndex, cycle, bus)` at :2191, `_runDecomposedTask(taskNode, task, stepIndex, cycle, snapshot, phaseAbort)` at :2258; the empirical reviewer ran this test file VERBATIM: red on HEAD = HUNG/HUNG/pass exactly as predicted, green with Step 3's implementation. `pause()` works because `_setStatus` is memory-only; `decomposedTaskNode`/`rewriteStepperForDecomposition(null, phases)` tolerate the stubs; `updatePhaseStatus`/`appendAudit` are best-effort no-ops for the unseeded pipeline id.)

- [ ] **Step 2: Run — expect tests 1-2 FAIL via watchdog ('HUNG'), test 3 PASS**

Run: `node --test test/decomposed-phase-abort.test.mjs`

- [ ] **Step 3: Implement**

Replace the phase loop body (orchestrator.mjs:2200-2234):

```js
    // 2) Run each phase in order.
    for (const ph of phases) {
      const tasks = Array.isArray(ph.tasks) ? ph.tasks : [];
      updatePhaseStatus(this.pipeline.id, ph.ordinal, 'running', new Date().toISOString());
      await appendAudit(this.pipeline.dir, `Phase ${ph.ordinal}: ${tasks.length} task(s) starting.`);

      // Abort-immediately on the FIRST genuine (non-abort, non-pause) failure.
      // The per-task rejection observer below fires phaseAbort WHILE siblings are
      // still running — before Promise.allSettled resolves — so one failed task
      // cancels its in-flight siblings (SIGTERM via ctx.signal) instead of letting
      // them burn their full runtime under a doomed phase. AbortErrors (this very
      // cancel cascade, or stop()) and PauseErrors never trigger it: the first
      // cancellation must not mask the real cause, and pause keeps its own unwind
      // below. A sibling parked on an interactive recovery prompt is not
      // signal-reachable (_ask settles only via answer()/pause()/stop()), so the
      // trigger also rejects an open recovery prompt exactly the way pause() does —
      // the phase is failing and must not wait on a now-meaningless human answer.
      const phaseAbort = new AbortController();
      let firstError = null;
      const noteFailure = (task, reason) => {
        if (firstError || isAbort(reason) || isPause(reason)) return;
        firstError = { task, reason };
        phaseAbort.abort();
        if (this.pendingQuestion?.kind === 'recovery') {
          const pq = this.pendingQuestion;
          this.pendingQuestion = null;
          const e = new Error('aborted');
          e.name = 'AbortError';
          pq.reject(e);
        }
      };
      const settled = await Promise.allSettled(tasks.map((task) => {
        const taskNode = decomposedTaskNode(implNode, task, tasks, this.pipeline.dir);
        const p = this._runDecomposedTask(taskNode, task, stepIndex, cycle, snapshot, phaseAbort);
        // Side observer only: the raw promise still flows into allSettled (which
        // attaches its own handlers, so no unhandled-rejection either way), and
        // the .catch derivative resolves after noteFailure swallows the reason.
        p.catch((reason) => noteFailure(task, reason));
        return p;
      }));

      // Pause lands between decomposed phases (coarse but safe): aborted tasks of
      // this phase re-run on resume as part of the whole decomposed step. Pause
      // outranks a recorded failure, exactly as before the observer existed.
      if (this.pauseRequested) throw pauseErr();

      // Selection: noteFailure recorded the FIRST genuine failure in settle order
      // (its handler runs before allSettled's own for the same promise), so a
      // cancelled sibling's AbortError can never become the phase error. The scan
      // is a pure backstop preserving the old task-order selection if the observer
      // somehow saw nothing genuine.
      if (!firstError) {
        settled.forEach((r, k) => {
          if (r.status === 'rejected' && !isAbort(r.reason) && !isPause(r.reason) && !firstError) {
            firstError = { task: tasks[k], reason: r.reason };
          }
        });
      }
      if (firstError) {
        updatePhaseStatus(this.pipeline.id, ph.ordinal, 'error', new Date().toISOString());
        await appendAudit(this.pipeline.dir,
          `Phase ${ph.ordinal}: task "${firstError.task.title || firstError.task.id}" failed — aborting run.`);
        throw new Error(`Decomposed implement failed in phase ${ph.ordinal}: task "${firstError.task.title || firstError.task.id}": ${firstError.reason?.message || firstError.reason}`);
      }
      updatePhaseStatus(this.pipeline.id, ph.ordinal, 'done', new Date().toISOString());
    }
```

Replace the `_runDecomposedImplement` header (:2183-2190):

```js
  /**
   * Run the decomposed implement stage. Rewrite + persist the UI stepper into per-phase
   * / per-task cells, then run each phase IN ORDER (tasks within a phase in PARALLEL,
   * shared working tree). The FIRST genuine task failure aborts the phase IMMEDIATELY:
   * a per-task rejection observer fires the phase-local AbortController while siblings
   * are still running (allSettled alone reports failures only after every sibling has
   * finished), and the thrown phase error is that first failure — never a cancelled
   * sibling's AbortError. Stages the combined tree itself (the guard returns early from
   * _runStep, skipping its tail stage). Returns the dispatcher's [{node,result,ctx}]
   * shape with ONE synthetic implementer result so the reviewer step sees a settled
   * 'code' producer.
   */
```

Replace the `_runDecomposedTask` header (:2249-2257):

```js
  /**
   * Run one decomposed task through the standard node machinery: _nodeStep records its
   * own pipeline step (distinct nodeId), _nodeCtx wires its own onEvent (so sub-agents
   * are attributed to this task), and the standard attempt loop (`_runNodeAttempts`:
   * recovery + usage-limit pause) runs the implementer with the self-contained TASK
   * file authoritative (ctx.node.taskPath). The phase-local abort is folded with the
   * run-wide signals into ctx.signal; _runDecomposedImplement's rejection observer
   * fires it on the first genuine sibling failure, killing this task's runner
   * mid-flight (it then settles as an AbortError — recorded 'error', logged silently,
   * same as stop()). updateTaskStatus tracks running/done/error/paused. Errors propagate.
   */
```

No new imports (`isPause`, `isAbort`, `pauseErr` in scope; floating `.catch` is house style, cf. :2749).

- [ ] **Step 4: Run — expect PASS (new file + neighbors)**

Run: `node --test test/decomposed-phase-abort.test.mjs test/decomposed-error-line.test.mjs test/orchestrator-decompose.test.mjs test/orchestrator-recovery.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator.mjs test/decomposed-phase-abort.test.mjs
git commit -m "fix(pipeline): first genuine task failure cancels in-flight siblings"
```

---

### Task 8: Preflight keeps real stderr; synthetic diagnosis moves to `message` (F8a)

**Files:**
- Modify: `src/core/preflight.mjs:223` (jsdoc), `:231`, `:250`, `:256` (three synthesis sites)
- Modify: `src/core/orchestrator.mjs:163-170` (`errDetail` gains untagged `message` fallback)
- Test: `test/graph-build.test.mjs`, `test/log-provenance.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `runGraphifyUpdate` resolves `{ ok, code, timedOut, stderr, message? }` — `stderr` holds ONLY bytes the child wrote (possibly partial on timeout); `message` is the runner's own diagnosis (spawn failure). Task 9's `errStreamAttr(res)` object branch relies on this.
- Known residual (out of scope, note in the PR): `runGraphifyUpdate` still accepts no AbortSignal — a Stop during a graph build (single-project `_buildWorktreeGraph`, workspace member builds at workspace-scan.mjs:249-251) waits out the build or its timeout. The `{stderr, message?}` split does not change that.

- [ ] **Step 1: Write the failing tests**

Append to `test/graph-build.test.mjs` (mirror the file's existing fake-graphify + PATH idiom):

```js
test('runGraphifyUpdate: timeout keeps the real partial stderr, synthesizes nothing into it', async () => {
  const binDir = await makeTmpDir('worca-cc-bin-');
  const work = await makeTmpDir('worca-cc-work-');
  await fakeGraphify(binDir, '#!/bin/sh\necho "partial diagnostics" 1>&2\nsleep 5\n');
  const prevPath = process.env.PATH;
  process.env.PATH = binDir + ':' + prevPath;
  try {
    const res = await runGraphifyUpdate({ dir: work, cwd: work, timeoutMs: 500 });
    assert.equal(res.timedOut, true);
    assert.match(res.stderr, /partial diagnostics/, 'real bytes survive the kill');
    assert.doesNotMatch(res.stderr, /timed out/, 'stderr holds only what the child wrote');
  } finally { process.env.PATH = prevPath; }
});

test('runGraphifyUpdate: spawn failure reports via message; stderr stays empty', async () => {
  const work = await makeTmpDir('worca-cc-work-');
  const prevPath = process.env.PATH;
  process.env.PATH = '';
  try {
    const res = await runGraphifyUpdate({ dir: work, cwd: work, timeoutMs: 10000 });
    assert.equal(res.ok, false);
    assert.equal(res.stderr, '', 'no subprocess wrote these bytes');
    assert.match(String(res.message), /graphify|ENOENT/i, 'the cause is still reported');
  } finally { process.env.PATH = prevPath; }
});
```

And in `test/log-provenance.test.mjs` (which today imports only `test`/`assert`/`errStreamAttr`), first extend the imports:

```js
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errStreamAttr, createOrchestrator } from '../src/core/orchestrator.mjs';  // replaces the errStreamAttr-only import
```

Then append the tagging-direction test (fake slow graphify on PATH; `_log` spy):

```js
test('F8a direction: a graphify TIMEOUT warn is not stream-tagged (no stderr bytes), but still says why', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-prov-'));
  const binDir = await mkdtemp(join(tmpdir(), 'worca-prov-bin-'));
  await writeFile(join(binDir, 'graphify'), '#!/bin/sh\nsleep 5\n'); await chmod(join(binDir, 'graphify'), 0o755);
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: false }, graphBuildTimeoutMs: 300 });
  orch.workDir = await mkdtemp(join(tmpdir(), 'worca-prov-wt-'));
  orch.state.tools = { kind: 'cli' }; orch.pipeline = { dir };
  const logs = [];
  orch._log = (source, level, text, attr = null) => logs.push({ level, text, attr });
  const prevPath = process.env.PATH;
  process.env.PATH = binDir + ':' + prevPath;
  try { await orch._buildWorktreeGraph(); } finally { process.env.PATH = prevPath; }
  const warn = logs.find((l) => l.level === 'warn');
  assert.match(warn.text, /timed out/, 'the cause still reads in the line');
  assert.equal(warn.attr?.stream, undefined, 'synthetic diagnosis must not wear the stderr tag');
  await rm(dir, { recursive: true, force: true }); await rm(binDir, { recursive: true, force: true });
});
```

(Adopt whatever option name `_buildWorktreeGraph`'s timeout actually reads — mirror the existing graph-build timeout test's setup; keep the fake-bin sleep comfortably longer than the timeout, and assert on presence of stderr content, not completeness — CI-load safety.)

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/graph-build.test.mjs test/log-provenance.test.mjs`
Expected: new tests FAIL — `res.stderr` is `'graphify update timed out'` / `err.message`; the warn carries `stream:'err'`.

- [ ] **Step 3: Implement — `preflight.mjs`**

Jsdoc tail (:223 area):

```js
 * Never throws. Resolves { ok, code, timedOut, stderr, message? }: `stderr` holds
 * ONLY bytes the child actually wrote (possibly partial on timeout — the kill
 * races the last reads); `message` is the runner's own diagnosis of a spawn
 * failure. Kept separate so callers can tag stderr-derived log text truthfully
 * (orchestrator errStreamAttr). A timeout sets only `timedOut` — the flag IS the
 * diagnosis; synthesizing it into `stderr` would make the field a lie.
 */
```

Spawn-throw (:231):

```js
    } catch (err) {
      resolveP({ ok: false, code: -1, timedOut: false, stderr: '', message: err.message });
      return;
    }
```

Timeout (:250):

```js
      done({ ok: false, code: -1, timedOut: true, stderr }); // keep the real partial bytes
```

`'error'` event (:256):

```js
    child.on('error', (err) => done({ ok: false, code: -1, timedOut, stderr, message: err.message }));
```

- [ ] **Step 4: Implement — `orchestrator.mjs` `errDetail`**

Replace :163-170:

```js
/** The `: <detail>` suffix for a failed subprocess result: the child's real
 *  stderr when it wrote any, else the runner's own diagnosis (`message`, e.g. a
 *  spawn failure — synthetic, so never stream-tagged). runGraphifyUpdate returns
 *  both and the log line used to drop them — tagging a line as stderr-derived
 *  while discarding the stderr would make the tag a lie. Clipped: verbose builds. */
function errDetail(res, max = 200) {
  const text = ((res?.stderr || '').trim() || (res?.message || '').trim()).replace(/\s+/g, ' ');
  return text ? `: ${clip(text, max)}` : '';
}
```

Graphify sites :1355/:1394 keep `errStreamAttr(res?.stderr)` for now — truthful once stderr is real (Task 9 converts them to `errStreamAttr(res)`).

- [ ] **Step 5: Run — expect PASS**

Run: `node --test test/graph-build.test.mjs test/log-provenance.test.mjs test/workspace-scan.test.mjs`
Expected: PASS (graph-build's existing tests assert only `.ok/.timedOut/.code`; workspace-scan reads `.ok` only).

- [ ] **Step 6: Commit**

```bash
git add src/core/preflight.mjs src/core/orchestrator.mjs test/graph-build.test.mjs test/log-provenance.test.mjs
git commit -m "fix(preflight): keep real stderr separate from synthetic diagnosis"
```

---

### Task 9: `gitFailure` owns the fromStderr invariant; tag the hook-failure warning (F8b + F12)

**Files:**
- Modify: `src/core/worktree.mjs` (new export `gitFailure`; literals :331/:338; `rm-dir` step :302), `src/core/orchestrator.mjs` (`errStreamAttr` :172-179; sites 1355/1394/1433/1480/1588/1684/1717/1726/1777-1779/1789-1791/1823-1841/2374/2524; `_commitWork` jsdoc :1760-1761; import :89-92)
- Test: `test/log-provenance.test.mjs`

**Interfaces:**
- Consumes: Task 8's `{stderr, message?}` split (land Task 8 first — else `errStreamAttr(res)`'s stderr-bytes branch would still tag synthetic timeout text).
- Produces: `export function gitFailure(step, res)` from `worktree.mjs` → `{ ok:false, step, message: stderr||`exit N`, fromStderr }` (byte-identical messages to today); `errStreamAttr(evidence, extra)` accepting string | boolean | object (object: `fromStderr` flag wins, else `stream === 'err'`, else raw `stderr` bytes). Helper home is worktree.mjs because orchestrator already imports from it — the reverse would cycle.

- [ ] **Step 1: Write the failing tests**

Append to `test/log-provenance.test.mjs` (import `gitFailure` from `../src/core/worktree.mjs`):

```js
test('a boolean fromStderr drives the tag directly', () => {
  assert.deepEqual(errStreamAttr(true), { stream: 'err' });
  assert.equal(errStreamAttr(false), null);
  assert.deepEqual(errStreamAttr(false, { nodeId: 'n1' }), { nodeId: 'n1' });
});

test('a result/error object is judged by its own provenance, not by having text', () => {
  assert.deepEqual(errStreamAttr(gitFailure('commit', { stderr: 'hook blew up\n', code: 1 })), { stream: 'err' });
  assert.equal(errStreamAttr(gitFailure('commit', { stderr: '', code: 1 })), null, 'exit-N fallback message is not stderr');
  const err = new Error('x'); err.stream = 'err';
  assert.deepEqual(errStreamAttr(err), { stream: 'err' });
  assert.equal(errStreamAttr(new Error('x')), null);
  assert.deepEqual(errStreamAttr({ ok: false, stderr: 'boom' }), { stream: 'err' });
  assert.equal(errStreamAttr({ ok: false, stderr: '', message: 'spawn graphify ENOENT' }), null);
});

test('gitFailure owns the message/fromStderr invariant', () => {
  assert.deepEqual(gitFailure('add', { stderr: ' fatal: bad\n', code: 128 }),
    { ok: false, step: 'add', message: 'fatal: bad', fromStderr: true });
  assert.deepEqual(gitFailure('status', { stderr: '', code: 1 }),
    { ok: false, step: 'status', message: 'exit 1', fromStderr: false });
});

test('F8b direction: the hook-bypass durable warning embeds real stderr and carries the tag', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-prov-'));
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true } });
  orch._git = async (args) => {
    if (args.includes('status')) return { ok: true, code: 0, stdout: ' M f.txt\n', stderr: '' };
    if (args.includes('add')) return { ok: true, code: 0, stdout: '', stderr: '' };
    if (args.includes('diff')) return { ok: false, code: 1, stdout: '', stderr: '' }; // something IS staged
    if (args.includes('rev-parse')) return { ok: true, code: 0, stdout: 'deadbeef\n', stderr: '' };
    if (args.includes('core.hooksPath=')) return { ok: true, code: 0, stdout: '', stderr: '' }; // bypass retry wins
    return { ok: false, code: 1, stdout: '', stderr: 'husky: pre-commit blew up\n' };          // hooks-on commits fail
  };
  const logs = [];
  orch._log = (source, level, text, attr = null) => logs.push({ text, attr });
  const res = await orch._commitWork({ worktreeDir: join(dir, 'wt'), branch: 'worca/x' }, null,
    { excludePathspecs: [':(exclude)mounted.md'] });   // the retry arm is hook-bypass-scoped
  assert.equal(res.ok, true, JSON.stringify(res));
  const recorded = logs.find((l) => l.text.startsWith('commit hooks failed'));
  assert.match(recorded.text, /husky: pre-commit blew up/);
  assert.equal(recorded.attr?.stream, 'err', 'embedded real stderr must carry the provenance tag');
  await rm(dir, { recursive: true, force: true });
});

test('F8b counter-case: an exit-N hook failure records an UNtagged warning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-prov-'));
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true } });
  orch._git = async (args) => {
    if (args.includes('status')) return { ok: true, code: 0, stdout: ' M f.txt\n', stderr: '' };
    if (args.includes('add')) return { ok: true, code: 0, stdout: '', stderr: '' };
    if (args.includes('diff')) return { ok: false, code: 1, stdout: '', stderr: '' }; // something IS staged
    if (args.includes('rev-parse')) return { ok: true, code: 0, stdout: 'deadbeef\n', stderr: '' };
    if (args.includes('core.hooksPath=')) return { ok: true, code: 0, stdout: '', stderr: '' }; // bypass retry wins
    return { ok: false, code: 1, stdout: '', stderr: '' };   // hooks-on commits fail with NO stderr
  };
  const logs = [];
  orch._log = (source, level, text, attr = null) => logs.push({ text, attr });
  const res = await orch._commitWork({ worktreeDir: join(dir, 'wt'), branch: 'worca/x' }, null,
    { excludePathspecs: [':(exclude)mounted.md'] });
  assert.equal(res.ok, true, JSON.stringify(res));
  const recorded = logs.find((l) => l.text.startsWith('commit hooks failed'));
  assert.match(recorded.text, /exit 1/);
  assert.equal(recorded.attr?.stream, undefined, 'an exit-N fallback carries no stderr bytes');
  await rm(dir, { recursive: true, force: true });
});
```

`_commitWork`'s real signature (verified): `_commitWork(info, branchRecord = this.state.branch, { excludePathspecs = [] } = {})` at :1763. The stub covers the complete hook-retry git sequence (status → add → `diff --cached --quiet` where ok:false means staged → commit → identity-commit → `core.hooksPath=` retry → rev-parse) — proven end-to-end by the empirical reviewer (res.ok true; RED on HEAD exactly at the attr assertion of the tagged-direction test; this counter-case is a pin that also holds green post-fix).

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/log-provenance.test.mjs`
Expected: FAIL — `gitFailure` doesn't exist; `errStreamAttr({fromStderr:false})` stringifies to `'[object Object]'` and tags; the hook warning records `attr` null.

- [ ] **Step 3: Implement — `worktree.mjs`**

After the `git()` helper:

```js
/**
 * The ONE builder of a git-failure result: `message` prefers the child's real
 * stderr, falling back to `exit N`; `fromStderr` records which of the two the
 * message embeds, so warn lines can tag stream:'err' truthfully (the
 * orchestrator's errStreamAttr accepts this object directly).
 * @param {string} step  'status'|'add'|'diff'|'commit'|...
 * @param {{stderr?:string, code?:number}} res a never-throw git result
 */
export function gitFailure(step, res) {
  const stderr = (res?.stderr || '').trim();
  return { ok: false, step, message: stderr || `exit ${res?.code}`, fromStderr: !!stderr };
}
```

Literals :331 → `if (!add.ok) return gitFailure('add', add);` and :338 → `if (!diff.ok) { await rm(part, { force: true }).catch(() => {}); return gitFailure('diff', diff); }` (keep the existing cleanup line exactly as it is in the file). Adjacent same-class defect at :302 — `rm-dir` stores an **fs** error message in `stderr`: `steps.push({ step: 'rm-dir', ok: false, stderr: fsRes, fromStderr: false });`

- [ ] **Step 4: Implement — `orchestrator.mjs`**

Replace `errStreamAttr` (:172-179; keep the export):

```js
/** attr for a log line whose text embeds subprocess output: ERR_STREAM only when
 *  that text actually carries stderr bytes. Evidence is the stderr text itself,
 *  a boolean (a failure result's `fromStderr`), or a result/error object — its
 *  `fromStderr` flag when present (gitFailure results), else a claude-runner
 *  error's `stream` marker, else its raw `stderr` bytes. A `|| 'exit N'`
 *  fallback carries no stderr bytes — tagging it would make the tag a lie
 *  (the same rule errDetail documents for the text itself). */
export function errStreamAttr(evidence, extra = null) {
  let fromStderr;
  if (typeof evidence === 'boolean') {
    fromStderr = evidence;
  } else if (evidence && typeof evidence === 'object') {
    fromStderr = 'fromStderr' in evidence
      ? evidence.fromStderr === true
      : evidence.stream === 'err' || !!String(evidence.stderr ?? '').trim();
  } else {
    fromStderr = !!(evidence && String(evidence).trim());
  }
  return fromStderr ? (extra ? { ...extra, ...ERR_STREAM } : ERR_STREAM) : extra;
}
```

Site conversions (keep every log message text byte-identical; only the message-source expression, attr argument, and returned literal change):

| Site | Change |
|---|---|
| import :89-92 | add `gitFailure` to the worktree import list |
| :1777-1779 (status arm) | `const failure = gitFailure('status', status);` then existing `_log` line with its exact current text but `${failure.message}` + `errStreamAttr(failure)`; `return failure;` |
| :1789-1791 (add arm) | same pattern with `gitFailure('add', add)` |
| :1823-1836 (hook arm) | `const hookFailure = gitFailure('commit', commit);` — the `_log` at :1824 uses `${hookFailure.message}` + `errStreamAttr(hookFailure)`; the `_recordRunWarning` at :1832 becomes two-arg: `` await this._recordRunWarning(`commit hooks failed (${hookFailure.message}); retried with hooks bypassed so the work was not lost.`, errStreamAttr(hookFailure)); `` (keep the existing sentence text exactly as in the file; `_recordRunWarning` already accepts and forwards `attr`) |
| :1838-1841 (commit arm) | same pattern with `gitFailure('commit', commit)` |
| :1684 | `snap.fromStderr ? ERR_STREAM : null` → `errStreamAttr(snap)` |
| :1717 | `result.fromStderr ? ERR_STREAM : null,` → `errStreamAttr(result),` |
| :1726 | `result.fromStderr ? ERR_STREAM : null` → `errStreamAttr(result)` |
| :2374, :2524 | `err?.stream ? ERR_STREAM : null` → `errStreamAttr(err)` |
| :2291-2294 (`_logStepFailure`) | **unchanged** — its attr literal composes nodeId/stepIndex/cycle and passes `err.stream` through directly (already truthful); Task 6 edits this statement's first line (`clip`→`clipMiddle`), so leave the attr alone to avoid a cross-task collision |
| :1355, :1394 | `errStreamAttr(res?.stderr)` → `errStreamAttr(res)` |
| :1433, :1480, :1588 | `errStreamAttr(s.stderr)` → `errStreamAttr(s)` (teardown steps; combined with the :302 fix this untags rm-dir fs errors) |
| :3352 | unchanged (`errStreamAttr(commit.stderr)` — message embeds raw stderr, not a gitFailure message) |
| :3502 | unchanged (bare `ERR_STREAM`, guarded truthful) |
| `_commitWork` jsdoc :1760-1761 | "…`fromStderr` (via worktree.gitFailure) records…" |

Safety notes (verified by the design consultant): claude-runner errors carry only `err.stream = 'err'`, no `.stderr` field — object branch unambiguous even with Task 5's added `errorClass`; test stubs passing `{ok:false, step:'commit', message:'x'}` (run-root-teardown.test.mjs:704/721/740) have no `fromStderr`/`stream`/`stderr` → untagged, same as today. Known residual (note in PR, don't fix): `_git`/`git()` `'error'`-event handlers still fold spawn-error messages into `stderr`.

- [ ] **Step 5: Run — expect PASS**

Run: `node --test test/log-provenance.test.mjs test/run-root-teardown.test.mjs test/pipeline-delete.test.mjs test/worktree.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/worktree.mjs src/core/orchestrator.mjs test/log-provenance.test.mjs
git commit -m "refactor(core): gitFailure owns fromStderr invariant; tag hook-failure warning"
```

---

### Task 10: Shared `bootLive` helper; `openLogsPanel` dedup (F15)

**Files:**
- Create: `test/helpers/boot-live.mjs`
- Modify: `test/ui-live-log-dom.test.mjs:6-48`, `test/ui-running-resume.test.mjs:6-48` (delete local copies + fix header comments), `test/ui-history-logs.test.mjs` (`openLogsPanel` gains `logHandler`; replay test :197-227 → one call; fix stale comment :97-98)

**Interfaces:**
- Consumes: nothing.
- Produces: `export async function bootLive({ resumeFails = false } = {})` → `{ window, fetchCalls }`; `export const SEEDED_LOG_NDJSON` (byte-identical to today's canned /log NDJSON — `test/ui-running-resume.test.mjs` "seedResumedLog re-hydrates cycle and stream" depends on it); `openLogsPanel(NDJSON, { logHandler })` in ui-history-logs (consumed by Task 13's test). Task 14's new file imports `bootLive`.
- Excluded by design: `test/ui-pause-resume.test.mjs`'s different `bootLive` variant (non-empty projects, no /log stub) — folding it in would change its fixtures.

- [ ] **Step 1: Create the helper (byte-preserving semantics of today's copies)**

```js
// test/helpers/boot-live.mjs
// Shared jsdom boot for run-card suites: load the real index.html, stub
// WebSocket/fetch, import the real app.js with a cache-buster, reach internals
// via window.__np. The fetch stub answers:
//   */log            → two canned NDJSON lines (cycle 2 + stream:'err' present,
//                      so seedResumedLog projections are assertable),
//   /api/resume      → ok (or 404 'pipeline not found' with resumeFails:true),
//   /api/projects    → empty list,
//   anything else    → benign /api/config shape.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../../ui/public/app.js', import.meta.url));

export const SEEDED_LOG_NDJSON =
  '{"source":"planner","level":"info","text":"pass one","ts":"2026-08-17T00:00:01Z","stepIndex":0,"cycle":1}\n' +
  '{"source":"implementer","level":"warn","text":"429, retrying","ts":"2026-08-17T00:00:02Z","stepIndex":1,"cycle":2,"stream":"err"}\n';

/**
 * @param {{ resumeFails?: boolean }} [opts]  resumeFails: /api/resume answers 404.
 * @returns {Promise<{ window: import('jsdom').DOMWindow, fetchCalls: {url:string,opts:any}[] }>}
 */
export async function bootLive({ resumeFails = false } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  };
  const fetchCalls = [];
  window.fetch = (url, opts) => {
    fetchCalls.push({ url: String(url), opts });
    if (String(url).includes('/log')) {
      return Promise.resolve({ ok: true, status: 200, text: async () => SEEDED_LOG_NDJSON });
    }
    if (String(url).includes('/api/resume')) {
      if (resumeFails) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'pipeline not found' }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, runId: 'r-new', pipelineId: 'p1' }) });
    }
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window, fetchCalls };
}
```

IMPORTANT: before saving, diff this against the actual copy at `test/ui-live-log-dom.test.mjs:13-48` and keep the ACTUAL bytes wherever they differ (the two copies are byte-identical to each other; the helper must preserve their exact stub semantics).

- [ ] **Step 2: Point both suites at it**

In `test/ui-live-log-dom.test.mjs` and `test/ui-running-resume.test.mjs`: delete the local `bootLive` (lines 6-48, keeping `test`/`assert` imports), add `import { bootLive } from './helpers/boot-live.mjs';`, fix the header comment ("verbatim copy … file-private" no longer true).

- [ ] **Step 3: `ui-history-logs` internal dedup**

Extend `openLogsPanel` (defined ~:99) with an options bag:

```js
// Boot, load History serving the given NDJSON, expand the one card, open the
// Live-logs panel. Shared by the replay/copy/cap/parity/failure tests.
// `logHandler` overrides the /log response (failed-fetch/retry test).
async function openLogsPanel(NDJSON, { logHandler } = {}) {
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.includes('/api/history/') && url.endsWith('/log')) {
        return logHandler ? logHandler()
          : Promise.resolve({ ok: true, status: 200, text: async () => NDJSON });
      }
      // …the two /api/history handlers exactly as today (:105-115) — copy verbatim…
    },
  });
  // …clicks exactly as today (:119-127) — copy verbatim…
  return { ctx, card, panel: logsBar.querySelector('.logs-panel') };
}
```

Then replace the replay test's inline boot/expand/open block **(:197-227 — from `const ctx = await boot({` through `const panel = logsBar.querySelector('.logs-panel');`)** with `const { ctx, panel } = await openLogsPanel(NDJSON);` (rest of that test from :228 unchanged; the `doc`/`card`/`logsBar` locals were only used to reach `panel` — replacing only through :226 would leave :227 referencing the deleted `logsBar` AND redeclaring `panel`). Update the stale comment at :97-98. The first test (:130) keeps its inline boot — its detail payload differs (clarify Q&A + bar-ordering). `openLogsPanel`'s 3 existing callers (:275/:288/:309) are single-arg — compatible with the options bag.

- [ ] **Step 4: Run the three suites (the safety net for this pure extraction)**

Run: `node --test test/ui-live-log-dom.test.mjs test/ui-running-resume.test.mjs test/ui-history-logs.test.mjs`
Expected: PASS, same counts as before.

- [ ] **Step 5: Commit**

```bash
git add test/helpers/boot-live.mjs test/ui-live-log-dom.test.mjs test/ui-running-resume.test.mjs test/ui-history-logs.test.mjs
git commit -m "test(ui): shared boot-live helper; dedup openLogsPanel"
```

---

### Task 11: Cache the compiled log-filter predicate; replace the circular parity test (F13)

**Files:**
- Modify: `ui/public/log-filter.mjs:50-52`
- Modify: `test/log-filter.test.mjs` (:118-132 parity test deleted; new cache test)

**Interfaces:**
- Consumes: verified invariant — `r.logFilter` is never mutated in place anywhere (created at app.js:1098, replaced wholesale at 3800/7994/8008; History's `Object.assign`-mutated panel filter only ever calls `compileLogFilter` directly).
- Produces: `logLineVisible(rec, filter)` — same signature/behavior, WeakMap-cached per filter object identity. app.js:3746 unchanged.

- [ ] **Step 1: Write the failing cache test; delete the circular parity test**

Delete `'compileLogFilter matches logLineVisible on every axis'` (:118-132) — tautological: both sides execute the same compiled code. Its only non-redundant pins (null filter, combined axes) move into the new test. Add (mirrors the getter-count idiom at :134):

```js
test('logLineVisible compiles once per filter object identity', () => {
  let reads = 0;
  const filter = { get search() { reads++; return 'GRAPH'; } };
  assert.equal(logLineVisible(L({ text: 'building the graph' }), filter), true);
  const after = reads;
  assert.equal(logLineVisible(L({ text: 'no match' }), filter), false);
  assert.equal(logLineVisible(L({ text: 'graph again' }), filter), true);
  assert.equal(reads, after, 'same filter object → cached predicate, no recompile');
  // A REPLACED object compiles fresh; null/undefined always pass; combined axes
  // still AND (all previously pinned by the deleted parity test).
  assert.equal(logLineVisible(L({ text: 'x' }), { search: 'nomatch' }), false);
  assert.equal(logLineVisible(
    L({ source: 'implementer', level: 'debug', stepIndex: 1, cycle: 2, text: '→ Read a.js' }),
    { source: 'implementer', level: 'debug', step: '1', cycle: '2', search: 'read' }), true);
  assert.equal(logLineVisible(L({}), null), true);
  assert.equal(logLineVisible(L({}), undefined), true);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/log-filter.test.mjs`
Expected: FAIL — every call recompiles, re-reading the getter.

- [ ] **Step 3: Implement**

Replace :50-52:

```js
// Per-record wrapper for streaming callers (one line arrives, one verdict
// needed — app.js onLog). Compiling per call would pay a fresh closure per
// live line, so the compiled predicate is cached per filter OBJECT identity.
// Contract: treat filter objects as immutable — replace, never mutate (app.js
// swaps r.logFilter wholesale; History's Object.assign-mutated panel filter
// must keep calling compileLogFilter directly, as it does).
const compiled = new WeakMap();
export function logLineVisible(rec, filter) {
  if (!filter) return true; // compileLogFilter(null) is () => true
  let pred = compiled.get(filter);
  if (!pred) { pred = compileLogFilter(filter); compiled.set(filter, pred); }
  return pred(rec);
}
```

- [ ] **Step 4: Run — expect PASS (all remaining behavioral tests are cache-miss-per-literal, identical results)**

Run: `node --test test/log-filter.test.mjs test/ui-live-log-dom.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/public/log-filter.mjs test/log-filter.test.mjs
git commit -m "perf(ui): cache compiled log-filter predicate per filter identity"
```

---

### Task 12: Preserve the log search term across card rebuilds (F6)

**Files:**
- Modify: `ui/public/app.js:3795` (paintLogFilters), `:9801-9806` area (buildRunCard, before `repaintFilteredLog(r, node)`)
- Test: `test/ui-live-log-dom.test.mjs`

**Interfaces:**
- Consumes: Task 10's shared `bootLive`; `readLogFilterFrom` (app.js:8033-8042) unchanged — its box-wins presence-read is REQUIRED by the change/input handlers ("cleared box beats stored term").
- Produces: model owns `search` during facet reconciliation; box hydrated only at build time (never mid-keystroke — `maybePaintLogFilters` runs on live lines while a debounce may be pending). The spread creates a fresh object, preserving Task 11's replace-don't-mutate invariant.

- [ ] **Step 1: Write the failing test**

Append to `test/ui-live-log-dom.test.mjs`:

```js
test('card rebuild keeps the search term when a dropdown selection vanishes', async () => {
  const { window } = await bootLive();
  const { upsertRun, buildRunCard, onLog } = window.__np;
  const r = upsertRun({ runId: 'r-search', title: 't', projectDir: '/tmp/proj', status: 'running' });
  r.el = buildRunCard(r);
  onLog(r, { source: 'planner', level: 'info', text: 'an error appeared', ts: 0, stepIndex: 0, cycle: 1 });
  onLog(r, { source: 'planner', level: 'info', text: 'all good', ts: 0, stepIndex: 0, cycle: 1 });
  // User had cycle '7' + search 'error'; the cycle rotated out of the facets.
  r.logFilter = { source: '', level: '', step: '', cycle: '7', search: 'error' };
  // Finish/resume rebuilds the card: the stale cycle falls back to "all"…
  r.el = buildRunCard(r);
  assert.equal(r.logFilter.cycle, '', 'vanished cycle falls back to all');
  assert.equal(r.logFilter.search, 'error', 'free text has no facet to vanish — must survive');
  assert.equal(r.el.querySelector('.log-search').value, 'error', 'rebuilt box shows the active term');
  const lines = r.el.querySelectorAll('.log .log-line');
  assert.equal(lines.length, 1, 'pane still narrowed by the term');
  assert.match(lines[0].textContent, /an error appeared/);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/ui-live-log-dom.test.mjs`
Expected: FAIL — `r.logFilter.search` becomes `''`; 2 lines render.

- [ ] **Step 3: Implement (both halves)**

app.js:3795 — replace `const effective = readLogFilterFrom(root, r.logFilter.search);` with:

```js
  // Search is free text — no facet can vanish from it, so reconciliation must
  // never touch it. The DOM box may be a fresh empty clone (rebuild) or
  // mid-keystroke ahead of the debounce; the model owns the term here.
  const effective = { ...readLogFilterFrom(root), search: r.logFilter.search };
```

buildRunCard (:9801-9806) — insert before `repaintFilteredLog(r, node);`:

```js
  // The clone's search box is born empty; mirror the run's stored term so the
  // visible bar matches the filter the repaint below actually applies.
  const searchBox = node.querySelector('.log-search');
  if (searchBox) searchBox.value = r.logFilter.search || '';
```

- [ ] **Step 4: Run — expect PASS (incl. cap/separator tests: default `search:''` unaffected)**

Run: `node --test test/ui-live-log-dom.test.mjs test/ui-running-resume.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/public/app.js test/ui-live-log-dom.test.mjs
git commit -m "fix(ui): preserve log search term across card rebuilds"
```

---

### Task 13: Remove the dead filter bar when the History log fetch fails (F9)

**Files:**
- Modify: `ui/public/app.js:9417-9420` (loadLiveLogs catch)
- Test: `test/ui-history-logs.test.mjs`

**Interfaces:**
- Consumes: Task 10's `openLogsPanel(NDJSON, { logHandler })`.
- Produces: on failed fetch, panel shows only the error (pre-commit UX); `panel.dataset.loaded = ''` re-arms and the next open rebuilds the whole panel (fresh bar) via the existing `panel.innerHTML = ''` path.

- [ ] **Step 1: Write the failing test**

Append to `test/ui-history-logs.test.mjs`:

```js
test('failed log fetch removes the filter bar; the next open retries and rebuilds it', async () => {
  let fail = true;
  const NDJSON = '{"source":"planner","level":"info","text":"Planning…","ts":"2026-06-20T00:00:01Z","stepIndex":0,"cycle":1}\n';
  const { ctx, card, panel } = await openLogsPanel(NDJSON, {
    logHandler: () => fail
      ? Promise.resolve({ ok: false, status: 500 })
      : Promise.resolve({ ok: true, status: 200, text: async () => NDJSON }),
  });
  assert.match(panel.querySelector('.log').textContent, /Could not load logs: HTTP 500/);
  assert.equal(panel.querySelector('.log-filters'), null, 'no functional-looking dead bar above the error');
  assert.equal(panel.dataset.loaded, '', 'retry stays armed');
  // Reopen (close + open) → refetch succeeds → bar and lines are back, wired.
  fail = false;
  const btn = card.querySelector('.hist-detail .logs-bar .btn-subs');
  btn.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));   // close
  btn.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));   // open → reload
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(panel.querySelector('.log-filters'), 'retry rebuilds the bar');
  assert.equal(panel.querySelectorAll('.log .log-line').length, 1);
});
```

(Match the error-text assertion to the file's actual thrown message for a non-ok response, and the toggle-button selector to the file's existing click idiom.)

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/ui-history-logs.test.mjs`
Expected: FAIL — `.log-filters` present under the error.

- [ ] **Step 3: Implement**

Replace the catch (:9417-9420):

```js
  } catch (e) {
    // No data → no controls. Listeners are only wired after a successful fetch,
    // so leaving the bar would show four dead dropdowns and a dead copy button
    // above the error. The next open rebuilds the whole panel (loaded '' below).
    bar.remove();
    box.textContent = `Could not load logs: ${e.message}`;
    panel.dataset.loaded = ''; // allow a retry on the next open
  }
```

(Keep the existing catch's exact error-message composition and dataset line if they differ textually — only `bar.remove()` and the comment are new.)

- [ ] **Step 4: Run — expect PASS (incl. "History filter bar is the run-card template bar" — success path untouched)**

Run: `node --test test/ui-history-logs.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/public/app.js test/ui-history-logs.test.mjs
git commit -m "fix(ui): remove dead filter bar when history log fetch fails"
```

---

### Task 14: Guard the env copy-button flash via `flashCopyBtn` (F14)

**Files:**
- Modify: `ui/public/app.js:7389-7393` (copyModelEnvValue)
- Create: `test/ui-model-env-copy.test.mjs`

**Interfaces:**
- Consumes: Task 10's `bootLive`; existing `flashCopyBtn(btn, msg)` (app.js:3635-3641 — dataset.label + clearTimeout guards, 1200ms, restores `dataset.label || 'copy'`; captures the real '⧉' label on first flash); `renderModelEditor(model, efforts, { doc })` at models-view.mjs:182 — env rows with the `.mv-env-copy` '⧉' button come from `envRow` (models-view.mjs:154-175, button at :166), emitted only for stored keys (`model.env` entries); delegated `#models-list` click routes `.mv-env-copy` → `copyModelEnvValue` (app.js:7511-7548, hit at :7541).
- Produces: no new API.

- [ ] **Step 1: Write the failing test (new file; real timers — repo convention)**

```js
// test/ui-model-env-copy.test.mjs — the env-value copy button's flash must
// survive rapid clicks (same dataset.label + clearTimeout guard as .log-copy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootLive } from './helpers/boot-live.mjs';
import { renderModelEditor } from '../ui/public/models-view.mjs';

test('rapid double-click on the env copy button never leaves the flash as the label', async () => {
  const { window } = await bootLive();
  Object.defineProperty(window.navigator, 'clipboard',
    { configurable: true, value: { writeText: async () => {} } });
  const editor = renderModelEditor(
    { id: 'm1', label: 'M', efforts: [], env: { API_KEY: '••••1234' } },
    [], { doc: window.document });
  window.document.getElementById('models-list').appendChild(editor);
  const btn = editor.querySelector('.mv-env-copy');
  assert.equal(btn.textContent, '⧉');
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));   // inside the first 1200ms flash
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1700));  // past the second flash window
  assert.equal(btn.textContent, '⧉', 'second click must not capture "✓" as the label to restore');
});
```

(This test was run VERBATIM by the empirical reviewer: RED on HEAD — first timer restores '⧉' at 1200ms, second restores '✓' at 1500ms, label stuck — GREEN with Step 3. bootLive's default fetch stub answers the env-value GET with benign `ok:true` json — no `/log` substring match — so the '✓' path runs without extra stubbing; the clipboard `defineProperty` works under jsdom.)

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/ui-model-env-copy.test.mjs`
Expected: FAIL — button textContent stuck at `'✓'`.

- [ ] **Step 3: Implement**

Replace the local `flash` closure in `copyModelEnvValue` (:7389-7393) with `flashCopyBtn` calls:

```js
async function copyModelEnvValue(btn) {
  const row = btn.closest('.mv-env-row');
  const editor = btn.closest('.mv-editor');
  const id = editor && editor.dataset.id;
  const key = row && row.dataset.key;
  if (!id || !key) return;
  try {
    const res = await fetch(`/api/models/${encodeURIComponent(id)}/env-value?key=${encodeURIComponent(key)}`);
    const data = await safeJson(res);
    if (!res.ok) return flashCopyBtn(btn, '!');
    await navigator.clipboard.writeText(data.value);
    flashCopyBtn(btn, '✓');
  } catch {
    flashCopyBtn(btn, '!');
  }
}
```

(Preserve the function's existing fetch/guard lines verbatim; only the flash mechanism changes.)

- [ ] **Step 4: Run — expect PASS (incl. the existing 1.3s `.log-copy` flash test — flashCopyBtn itself untouched)**

Run: `node --test test/ui-model-env-copy.test.mjs test/ui-history-logs.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/public/app.js test/ui-model-env-copy.test.mjs
git commit -m "fix(ui): guard env copy-button flash via flashCopyBtn"
```

---

### Task 15: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all 2619 pre-existing tests + all new tests PASS (new: 1 abort-classify, 1 worktree, 2 decomposed-error-line, 4 runner-error-surface, 3 decomposed-phase-abort, 2 graph-build, ~6 log-provenance, 1 log-filter, 1 ui-live-log-dom, 1 ui-history-logs, 1 ui-model-env-copy).

- [ ] **Step 2: Flake check on the timing-sensitive tests (3 repeats)**

Run: `for i in 1 2 3; do node --test test/runner-error-surface.test.mjs test/decomposed-phase-abort.test.mjs test/graph-build.test.mjs test/ui-model-env-copy.test.mjs || break; done`
Expected: green 3/3.

- [ ] **Step 3: Confirm plan/spec stay untracked**

Run: `git status --short docs/`
Expected: `?? docs/` only — nothing staged.

## Self-Review (completed at write time)

- Spec coverage: F1→T5, F2→T7, F3→T3, F4→T2, F5→T6, F6→T12, F7→T4, F8→T8+T9, F9→T13, F10→T5, F11→T1, F12→T9, F13→T11, F14→T14, F15→T10. No gaps.
- Type consistency: `isAbort`/`strongestClass`/`gitFailure`/`bootLive` signatures match across producing and consuming tasks.
- Former soft spots, all resolved by the empirical review (v2): T3's hermetic-DB block is written out and was run red/green; T7's signatures verified (`_runDecomposedImplement(implNode, stepIndex, cycle, bus)`) and its test file ran verbatim; T9's `_commitWork` stub proven to cover the full hook-retry git sequence; T13's error text (`Could not load logs: HTTP 500`) and re-entry gate (`dataset.loaded !== '1'`, :9347) confirmed; T14's `renderModelEditor(model, efforts, {doc})` anchor corrected to :182 and its test ran verbatim. Remaining executor duty: anchors drift as earlier tasks land — always locate by quoted code.
