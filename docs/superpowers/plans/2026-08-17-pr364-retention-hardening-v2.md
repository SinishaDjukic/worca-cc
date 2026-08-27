# PR #364 Retention Hardening Implementation Plan — v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 15 review findings + 1 design gap in PR #364 (`4f2901a2`, branch `fix/retain-worktree-on-commit-failure`) so the retained-worktree feature's own no-data-loss promise holds on every path.

**Architecture:** Keep PR #364's architecture unchanged (retain checkout on teardown commit failure; manifest + DB retention records; sweep keep; archive block; discard-with-patch exit). This plan only hardens it: every destructive guard reads BOTH retention representations (and fails closed only while something destroyable still exists), retention is persisted immediately and always machine-readable, discard reports the truth and honors the manifest ledger, a durable crash-safe patch is written at retention time, and the UI copy stops lying.

**Tech Stack:** Node ESM (`.mjs`), built-in `node:sqlite` (NOT better-sqlite3 — package deps are only `express` + `ws`), node:test, JSDOM UI tests, Express, vanilla-JS UI.

**Spec:** `docs/superpowers/specs/2026-08-17-pr364-retained-worktree-review.md` (findings F1–F15, D1, C1–C3 referenced below).

**Provenance:** v2 of `2026-08-17-pr364-retention-hardening.md`, revised after an anchor fact-check, two executed TDD dry-runs of v1, a mutation audit, a spec-coverage audit, and an adversarial design review — then THIS plan was itself executed end to end on a clone of `4f2901a2` (17 commits, full red→green per task, `npm test` at the exact 4-name baseline, mutation spot-checks run) and the six defects that execution found are already folded in. Every "verified:" note below is an empirical result, not a prediction. Two snippets were revised after that final execution and verified by inspection only: Task 7's JSON-string-tolerant `unreadable()` (a pure loosening; the three archive tests still exercise both sides) and Task 10's null-column warning guards (pure narrowing; Task 11's test pins the silent path).

## Task order (deliberate — do not resequence)

`1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18`

- Task 4 (vanished worktree, F15) lands before anything else that stamps or snapshots retention — retention *semantics* settle first.
- Task 8 (snapshot-to-file, F8) lands before the other `discardRetainedWorktrees` edits: the structural rewrite goes first, then Task 9 edits the report literal + else-branch + gate derivation, then Task 10 swaps persistence (and the success branch of the removal loop), then Task 11 rewrites the function head (and deletes the duplicate `runRoot` declaration). This ordering avoids the `patches`-declaration collision the reverse order invites.
- Tasks 15 + 16 are adjacent and last on `app.js`; Task 17 runs after 3 and 12 because it refactors the very route bodies they edit.

## Global Constraints

- Work on branch `fix/retain-worktree-on-commit-failure`; commits go on top of `4f2901a2`. Never commit `docs/` (plans/specs stay untracked — repo rule).
- **In a fresh checkout/worktree, run `npm ci` before any tests.** Without it, `npm test` reports bogus `express`-resolution failures that look like real regressions.
- Test command pattern: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/<file>.mjs`. Never run the suite with a stray `WORCA_HOME` exported in your shell — the pattern sets it per-invocation for a reason.
- Full-suite pass bar: `npm test` = only the 4 pre-existing failures, **judged by NAME, not by count** (counts drift as suites grow): `imagegen skill is bundled with SKILL.md and script`, `bundled generate_image.py uses python3, never bare python`, `detached + declared skills forwards the validated resolutions and mounts them`, `legacy (pinned) + declared skills: NO assembleRunContext, today's worktree injection and audit line`. Additionally, `test/api-sources.test.mjs` has a known full-run `ENOTEMPTY` temp-dir flake — re-run it in isolation before treating it as a real failure.
- There is **no lint script** — do not invent one; match surrounding style by hand.
- **Per-suite fixture idiom is mandatory, not stylistic.** New tests in `test/pipeline-delete.test.mjs` use the `const prev = process.env.WORCA_HOME` / `finally`-restore dance and let `freshStore`/`freshWorkspaceStore` own `_resetForTests()`. New tests in `test/pipeline-archive.test.mjs` inherit `useTempHome(after)` and must not touch `WORCA_HOME`. Mixing the idioms silently cross-contaminates the DB singleton.
- **`worktree.mjs`'s local `git()` helper takes an options OBJECT**: `git(cwd, args, { timeout: SLOW_GIT_TIMEOUT_MS })` (`worktree.mjs:53`, default `timeout = 30_000`). Passing a bare number compiles, runs, and silently keeps the 30 s deadline.
- Orchestrator-driven tests must point at throwaway repos under `tmpdir()` only — `test/orchestrator-workspace.test.mjs:52-61` carries a product-repo leak guard for a reason.
- All retention-UI strings are assigned via `textContent` (git stderr and paths are data, never markup). This is the *retention feature's* convention — app.js at large has legit `innerHTML` sites; do not "fix" other views.
- `retainedWorkFor` stays existsSync-self-clearing; retention stays orthogonal to run `status`. Do not change either contract.
- Before editing any function, re-read it first — line numbers below are from `4f2901a2` and drift as tasks land.

---

### Task 1: Fix the `ui-history.test.mjs` badge regression (F1)

**Files:**
- Modify: `test/ui-history.test.mjs:122` (the selector line; the assertions at `:123-126` stay)

The template legitimately gained a second, hidden `.badge` per card (`hist-retained-badge`, `ui/public/index.html:422`; the status badge is `:421`). Fix the old test's selector to target status badges only. Test-only change.

- [ ] **Step 1: Run the failing test**

Run: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history.test.mjs`
Verified: FAIL `history renders 2 .hist-card divs (no <li>), badges DONE/STOPPED, nav count=2` — `badges[1]` is `'Work retained'`, expected `'STOPPED'` (14 pass / 1 fail).

- [ ] **Step 2: Fix the selector.** In `test/ui-history.test.mjs:122` replace:

```js
  const badges = [...doc.querySelectorAll('#history .badge')];
```

with:

```js
  // Status badges only: each card also carries a hidden .hist-retained-badge.
  const badges = [...doc.querySelectorAll('#history .badge:not(.hist-retained-badge)')];
```

- [ ] **Step 3: Re-run — PASS (15/15).** (Verified.)

- [ ] **Step 4: Commit**

```bash
git add test/ui-history.test.mjs
git commit -m "test(ui): scope history badge assertions past the hidden retained badge"
```

---

### Task 2: A throwing `retainOf` skips the root — it must NOT abort the sweep (F5)

**Files:**
- Modify: `src/core/worktree.mjs:446-448` (inside `sweepRunRoots`), `src/core/artifacts.mjs:1763-1764` (`retainOf` JSDoc)
- Test: `test/run-root-layout.test.mjs`

**Reality check (verified):** `sweepRunRoots` has **no enclosing per-root try/catch**. `statusOf` (`:421-430`) and `membersOf` (`:501-511`) each carry their **own inline** try/catch that pushes to `out.failed`, warns, and `continue`s. The `retainOf` call sits in neither. Simply deleting its `catch` makes the throw escape `sweepRunRoots` entirely — the boot caller (`ui/server.mjs:3073-3087`) then abandons every remaining run root, and `worca doctor` is hit identically. The dry run confirmed it: with a bare `retained = await retainOf(id)`, the new test errors with `Error: db exploded` instead of passing.

- [ ] **Step 1: Write the failing test** (append to `test/run-root-layout.test.mjs`, after the existing `retainOf keeps a terminal root` test; `tmp`/`freshRepo`/`seedRunRoot`/`sweepRunRoots`/`existsSync` are all already in scope)

```js
test('sweep: a throwing retainOf skips the root untouched (three-state doctrine)', async () => {
  const home = await tmp('worca-cc-rr-retain-throw-');
  const repo = await freshRepo();
  const e = await seedRunRoot(home, 'retain04', repo);
  const res = await sweepRunRoots({
    worcaHome: home, statusOf: () => 'done',
    retainOf: () => { throw new Error('db exploded'); }, log: () => {},
  });
  assert.ok(!res.removed.includes(e.runRoot), 'retention-unknown must never mean remove');
  assert.ok(existsSync(e.runRoot), 'run root untouched');
  assert.ok(res.failed.includes(e.runRoot), 'reported as SKIPPED, not silently ignored');
});
```

- [ ] **Step 2: Run — FAIL.** Verified failure shape: `AssertionError: retention-unknown must never mean remove` (the swallow lets the `done` root reach the reclaim path).

- [ ] **Step 3: Implement.** In `sweepRunRoots`, replace:

```js
    if (!retained && typeof retainOf === 'function') {
      try { retained = await retainOf(id); } catch { /* status lookup already classified the row */ }
    }
```

with (modelled on the `statusOf`/`membersOf` handlers — this is THE implementation, not a fallback):

```js
    // Same three-state doctrine as statusOf/membersOf: "retention unknown" must
    // never collapse into "remove", so a lookup throw skips this root untouched
    // and is reported in `failed` + logged loudly (it must NOT abort the sweep —
    // this call site is outside the statusOf try/catch).
    if (!retained && typeof retainOf === 'function') {
      try {
        retained = await retainOf(id);
      } catch (err) {
        const reason = `skip ${dir}: retention lookup FAILED (${err?.message || err}) — leaving it untouched`;
        out.failed.push(dir);
        out.warnings.push(reason);
        say('warn', reason);
        continue;
      }
    }
```

- [ ] **Step 4: Update the contract docs.** (a) In `src/core/artifacts.mjs:1763-1764`, the `runRootSweepLookups` `retainOf` JSDoc line lacks the "THROWS when the lookup fails" sentence its `statusOf`/`membersOf` siblings carry (`:1756`/`:1761`). Add the equivalent sentence to `retainOf`'s line. (b) The boot sweep's per-failure log at `ui/server.mjs:3082` says "pipelines-row lookup failed"; `failed[]` entries can now also be retention-lookup failures — generalize the wording (e.g. "run-root lookup failed; nothing was removed").

- [ ] **Step 5: Run `test/run-root-layout.test.mjs` — all PASS.** (Verified: 38/38.)

- [ ] **Step 6: Commit** — `fix(sweep): retention-unknown skips the run root instead of removing it`

---

### Task 3: Map `SNAPSHOT_FAILED` to 409 (F12)

**Files:**
- Modify: `ui/server.mjs:1368-1372` (discard route catch)
- Test: `test/delete-pipeline-api.test.mjs`

The route change is one line. The v1 test deleted the suite's only pipeline dir (`04-06-26-my-feature-pp`), which silently vacuified the final `200 removes the pipeline dir…` test's `existsSync === false` assertion. Use a **dedicated row with no run dir** instead: `discardRetainedWorktrees` throws `SNAPSHOT_FAILED` whenever `findRunDir` returns null (`pipeline-delete.mjs:251-254`), and that check runs before the member-resolution throw, so the message still matches `/recovery patch/`.

- [ ] **Step 1: Failing test** (insert immediately after the `recovery-patch route downloads the fixed pipeline diff artifact` test; `seedPipelineRow` is already imported at `:12` and JSON-stringifies its `branch` option; `mkdir`/`join`/`home`/`KEY`/`discard` are all in scope)

```js
test('discard-worktree maps SNAPSHOT_FAILED to 409 with the actionable message', async () => {
  // A row with NO on-disk run dir: findRunDir returns null -> SNAPSHOT_FAILED.
  // Deliberately its own id so the suite's shared 04-06-26-my-feature-pp fixture
  // (and the final archive test's assertions) stays intact.
  const retained = join(home, 'retained-snapfail');
  await mkdir(retained, { recursive: true });
  seedPipelineRow({
    id: 'sf', projectKey: KEY, title: 'Snapshot fail', status: 'stopped',
    baseName: 'snapfail', datePrefix: '04-06-26',
    branch: {
      worktreeDir: retained, feature: 'worca/x',
      commitFailed: { code: 'commit_failed', step: 'commit', message: 'hook failed' },
    },
  });
  const res = await discard('sf', `projectKey=${KEY}`);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /recovery patch/);
});
```

(Verified: `seedPipelineRow` needs NO adaptation — `id/projectKey/title/status/baseName/datePrefix/branch` are all real destructured options and the helper JSON-stringifies `branch`.)

- [ ] **Step 2: Run — FAIL (500 today, expected 409).**

- [ ] **Step 3: Add the mapping.** In the discard route's catch (`ui/server.mjs:1368-1372`), after the `RUNNING` line:

```js
    if (e && e.code === 'SNAPSHOT_FAILED') return res.status(409).json({ error: e.message });
```

- [ ] **Step 4: Run `test/delete-pipeline-api.test.mjs` — all PASS.**
- [ ] **Step 5: Commit** — `fix(api): surface discard snapshot failures as 409, not 500`

---

### Task 4: A vanished worktree is not a commit failure (F15)

**Files:**
- Modify: `src/core/orchestrator.mjs` (`_commitWork` status step, `:1674-1679`)
- Test: `test/run-root-teardown.test.mjs`

- [ ] **Step 1: Failing test** (append)

```js
test('a worktree that vanished mid-run is not retained (nothing to retain)', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  const res = await orch._commitWork({ worktreeDir: join(repo, 'no-such-dir'), branch: 'worca/x' });
  assert.equal(res.ok, true, 'missing checkout is the clean no-op, not a retention trigger');
  assert.equal(res.committed, false);
});
```

- [ ] **Step 2: Run — FAIL.** Verified: `_git` resolves `{ok:false, code:-1, stderr:'…ENOENT…'}` on a missing cwd, so today this returns `{ok:false, step:'status'}`.

- [ ] **Step 3: Implement.** In `_commitWork` (the variable is named exactly `cwd`, `:1669`; `existsSync` is already imported at `orchestrator.mjs:21`), extend the status-failure branch:

```js
    const status = await this._git(['status', '--porcelain'], gitOpts);
    if (!status.ok) {
      if (!existsSync(cwd)) {
        // The checkout is gone: there is no work to retain, and stamping
        // commitFailed would create an unclearable phantom retention (F15).
        this._log('git', 'warn', `commit skipped: worktree missing at ${cwd}`);
        return { ok: true, committed: false, sha: null };
      }
      const message = status.stderr.trim() || `exit ${status.code}`;
      this._log('git', 'warn', `commit skipped: git status failed: ${message}`);
      return { ok: false, step: 'status', message };
    }
```

`{ok:true, committed:false, sha:null}` is exactly the shape the no-`cwd` guard at `:1670` already returns, so all three teardown call sites are proven to treat it as a clean no-op. After this change, a vanished worktree produces `teardown … failed` step warnings plus a `git worktree prune` from `removeWorktree` — that is the desired cleanup, not a new bug.

- [ ] **Step 4: Run `test/run-root-teardown.test.mjs` — all PASS.** (Verified: 15/15 at this point in the sequence; the count grows as later tasks add tests.)
- [ ] **Step 5: Commit** — `fix(pipeline): a vanished worktree is a no-op, not a phantom retention`

---

### Task 5: Retention is always machine-readable and durable immediately (F6 + persist half of F2)

**Files:**
- Modify: `src/core/orchestrator.mjs:1622-1650` (`_recordCommitFailure`)
- Test: `test/run-root-teardown.test.mjs`

**Interfaces:**
- Produces: `_recordCommitFailure` still returns `Promise<boolean>`; NEW guarantees: (a) a branch record carrying `commitFailed` ALWAYS exists afterwards (synthesized if missing), (b) the DB row is written via `writeState` before it returns, with a real (reachable) error log on failure.
- **Why not `this._persist()`:** verified — `_persist` swallows internally (`orchestrator.mjs:3660-3667`, `catch { /* best-effort */ }`), so a try/catch around it is dead code. Call `writeState` directly (`writeState` is already imported at `orchestrator.mjs:29`; it no-ops harmlessly when `state.id` is unset, and its `pipelineDir` argument only seeds a cache, so `this.pipeline?.dir ?? null` is safe).

- [ ] **Step 1: Failing tests** (append both to `test/run-root-teardown.test.mjs`. Verified: this suite ALREADY imports both symbols — `readPipelineByKey` from `../src/core/artifacts.mjs` and `projectKey` from `../src/core/store.mjs`. Note `projectKey` lives in `store.mjs`, NOT `projects.mjs` — `projects.mjs` does not export it.)

```js
test('a commit failure with no branch record synthesizes one so retention is machine-readable', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  orch.state.branch = null; // the abnormal row shape F6 describes
  const kept = await orch._recordCommitFailure(
    { ok: false, step: 'commit', message: 'hook failed' },
    { info: { worktreeDir: join(repo, 'wt'), branch: 'worca/x' }, branchRecord: null },
  );
  assert.equal(kept, true);
  assert.equal(orch.state.branch.commitFailed.code, 'commit_failed');
  assert.equal(orch.state.branch.worktreeDir, join(repo, 'wt'));
  assert.equal(orch.state.branch.worktreeRemoved, false);
});

test('the retention stamp is durable in the DB before _recordCommitFailure returns', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  orch.state.id = 'rcf00001'; // writeState keys its UPSERT on state.id
  orch.state.branch = { feature: 'worca/x', worktreeDir: join(repo, 'wt') };
  const kept = await orch._recordCommitFailure(
    { ok: false, step: 'commit', message: 'hook failed' },
    { info: { worktreeDir: join(repo, 'wt'), branch: 'worca/x' }, branchRecord: orch.state.branch },
  );
  assert.equal(kept, true);
  const persisted = await readPipelineByKey(projectKey(repo), 'rcf00001');
  assert.equal(persisted.state.branch.commitFailed.code, 'commit_failed',
    'the row is durable before any caller-side persist runs');
});
```

- [ ] **Step 2: Run — both FAIL.** Verified failures: first `TypeError: Cannot read properties of null (reading 'commitFailed')`; second `TypeError: Cannot read properties of null (reading 'state')` (`readPipelineByKey` returns null — nothing persisted yet).

- [ ] **Step 3: Implement.** Replace the body of `_recordCommitFailure` with:

```js
  async _recordCommitFailure(result, { key = null, info, branchRecord } = {}) {
    if (result?.ok !== false) return false;
    const message = result.message || `git ${result.step || 'commit'} failed`;
    const record = {
      code: RETAIN_REASONS.COMMIT_FAILED,
      step: result.step,
      message,
      at: new Date().toISOString(),
    };
    let target = branchRecord;
    if (!target) {
      // Synthesize the record: retention must ALWAYS be visible to
      // retainedWorkFor/archive/discard, not only to a human reading warnings.
      // branchRecord came FROM state.branches[key] / state.branch, so a null one
      // means that slot is empty — this never overwrites a non-null record.
      target = { feature: info?.branch || null, worktreeDir: info?.worktreeDir || null };
      if (this.isWorkspace && key != null) {
        this.state.branches[key] = target;
      } else {
        this.state.branch = target;
      }
      await this._recordRunWarning(
        `${key ? `${key}: ` : ''}commit failed at git ${result.step} (${message}) with no branch record; ` +
        `synthesized one for the retained worktree at ${info?.worktreeDir || '(unknown)'}`,
      );
    }
    target.commitFailed = record;
    target.worktreeRemoved = false;
    target.branchKept = true;
    const prefix = key ? `${key}: ` : '';
    this._log('git', 'warn',
      `${prefix}commit failed at git ${result.step} (${message}) — KEEPING the worktree at ${info?.worktreeDir}`);
    if (this.pipeline) {
      await appendAudit(this.pipeline.dir,
        `Commit FAILED for \`${info?.branch || '(unknown)'}\` at git ${result.step}: ${message}. ` +
        `Worktree RETAINED at \`${info?.worktreeDir || '(unknown)'}\`.`).catch(() => {});
    }
    // Persist NOW. The callers' later _persist() is best-effort/swallowed; the
    // retention stamp must not ride on it (F2's crash window). _persist() also
    // swallows internally, so call the writer directly to observe a real failure.
    try {
      await writeState(this.pipeline?.dir ?? null, this.state);
    } catch (e) {
      this._log('git', 'error',
        `retention stamp could not be persisted (${e?.message || e}); ` +
        'the run.json retain record is the only durable copy');
    }
    return true;
  }
```

Notes (all verified): `RETAIN_REASONS` comes from `./run-manifest.mjs` (orchestrator import at `:59-66`) — no import edit needed. `this.isWorkspace` is the real flag (`:211`, and the one `_teardownRunRoot` uses at `:1510-1512`). `this.state.branches` is initialized at construction (`:349`) — no `|| {}` needed. No test asserts the old warning strings. Workspace synthesis is persisted because `toPipelineRow` folds `state.branches` into `workspace_meta` whenever `state.target === 'workspace'` (set at `:551`).

- [ ] **Step 4: Run `test/run-root-teardown.test.mjs` — all PASS** (both pre-existing commit-failure tests — `detached: a failed teardown commit retains…` and `legacy: …survives a DB round trip…` — stay green; the immediate persist only strengthens what they assert). Heads-up: the extra write measurably slows this suite (≈12 s → ≈13 s in the verification run; one earlier run saw ~2×) — expected, not a hang.
- [ ] **Step 5: Commit** — `fix(pipeline): synthesize + immediately persist the retention record`

---

### Task 6: Guard the legacy-workspace scalar mirror (F13)

**Files:**
- Modify: `src/core/orchestrator.mjs:1416-1457` (`_teardownWorktreeAll`)
- Test: `test/run-root-teardown.test.mjs`

**Do NOT rewrite the method** (v1's elided rewrite, pasted literally, deletes the whole removal path). Make **three surgical edits**. Also: v1's end-to-end test was proven vacuous — a single-project legacy run routes through `_teardownWorktree` (`:1479-1480`), never `_teardownWorktreeAll`, so it passed pre-fix (16/16). Ship the unit-level test below (verified red pre-impl, green post-impl). Context for reviewers: `worktreeRemoved` has no production reader — this is a durable-record-coherence fix, not a behavior fix; do not expand its scope.

- [ ] **Step 1: Failing test** (append)

```js
test('legacy workspace: the scalar mirror is NOT stamped removed while a member is retained', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  const info = { worktreeDir: join(repo, 'wt-a'), branch: 'worca/x' };
  orch.branchInfos = new Map([['proj-a', info]]);
  orch.state.branches = { 'proj-a': { feature: 'worca/x', worktreeDir: info.worktreeDir } };
  orch.state.branch = { feature: 'worca/x', worktreeDir: info.worktreeDir }; // the scalar mirror
  orch._commitWork = async () => ({ ok: false, step: 'commit', message: 'x' });
  await orch._teardownWorktreeAll();
  assert.notEqual(orch.state.branch.worktreeRemoved, true,
    'a retained checkout must never be recorded as removed');
  assert.equal(orch.state.branches['proj-a'].commitFailed.code, 'commit_failed');
  assert.equal(orch.state.branches['proj-a'].worktreeRemoved, false);
});
```

- [ ] **Step 2: Run — FAIL.** Verified: `a retained checkout must never be recorded as removed` (`actual: true` — the unconditional stamp at `:1450`).

- [ ] **Step 3: Implement — three surgical edits** (the rest of the method stays byte-identical):

1. In `_teardownWorktreeAll` (`:1419` — the same comment also appears in `_teardownRunRoot` at `:1485`; do not edit that one), after `this.branchInfos = new Map(); // guard against a double teardown` insert:

```js
    let anyRetained = false;
```

2. In the retained branch, add the flag (the branch keeps its existing `this.workDirs.delete(projectKey_); continue;`):

```js
      if (await this._recordCommitFailure(commit, { key: projectKey_, info, branchRecord })) {
        anyRetained = true;
        this.workDirs.delete(projectKey_);
        continue;
      }
```

3. Change the trailing scalar-mirror stamp (`:1450`) to match the detached twin (`:1555`):

```js
    // Keep the scalar mirror coherent for late observers — but never claim a
    // retained checkout was removed (the detached twin has the same guard).
    if (this.state.branch && !anyRetained) {
      this.state.branch.worktreeRemoved = true;
      this.state.branch.branchKept = true;
    }
```

- [ ] **Step 4: Run `test/run-root-teardown.test.mjs` — all PASS.**
- [ ] **Step 5: Commit** — `fix(pipeline): don't stamp the scalar mirror removed while a member is retained`

---

### Task 7: Archive trusts both retention representations; fails closed only while the run root exists (guard half of F2 + F10)

**Files:**
- Modify: `src/core/pipeline-delete.mjs:103-108` (guard block in `archivePipeline`) + the duplicate `const runRoot` at `:201`
- Test: `test/pipeline-archive.test.mjs`

**Interfaces:**
- Consumes: `readRunManifest`, `worcaHome`, `join`, `existsSync` (verified: all already imported in `pipeline-delete.mjs`).
- Design (adjudicated): an **unconditional** fail-closed on unreadable metadata would wedge rows forever — archive would 409, discard would no-op (`retainedWorkFor` returns null on corrupt meta), and the UI hides the Discard button. But once the run root is gone, archive's per-member cleanup is a no-op for unreadable metadata (`rowToState` yields `branches:{}` / null branch), so the **only** destructive path is `rmGuarded(runRoot)`. Therefore: fail closed **only while `<worcaHome>/runs/<id>` exists**, name that path in the error so the state is hand-clearable, and check BOTH columns (`workspace_meta` for workspace rows, `branch` for single-project rows — both fail open in `retainedWorkFor` the same way).

- [ ] **Step 1: Tests** (append to `test/pipeline-archive.test.mjs`; add imports `mkdir` from `node:fs/promises`, `writeRunManifest, updateRunManifest` from `../src/core/run-manifest.mjs`, `worcaHome` from `../src/core/projects.mjs` — verified necessary and sufficient; `mkdtemp`/`tmpdir`/`rm`/`join`/`getDb`/`archivePipeline`/`seedPipeline` are already imported)

Red-first tests (fail today):

```js
test('archive refuses manifest-only retention (DB stamp lost)', async () => {
  const retainedDir = await mkdtemp(join(tmpdir(), 'worca-retained-manifest-'));
  try {
    const { id } = await seedPipeline('/tmp/proj-a', { status: 'done' }); // NO commitFailed in DB
    const runRoot = join(worcaHome(), 'runs', id);
    await mkdir(runRoot, { recursive: true });
    await writeRunManifest(runRoot, { pipelineId: id, runRootMode: 'detached', isWorkspace: false, members: [] });
    await updateRunManifest(runRoot, {
      retain: { reason: 'commit_failed', members: [{ worktreeDir: retainedDir }] },
    });
    await assert.rejects(() => archivePipeline({ projectDir: '/tmp/proj-a', id }),
      (e) => e.code === 'RETAINED_WORKTREE');
  } finally {
    await rm(retainedDir, { recursive: true, force: true });
  }
});

test('archive refuses a workspace row whose workspace_meta is unreadable while its run root survives (fail closed)', async () => {
  const { id } = await seedPipeline('/tmp/proj-a', { status: 'done' });
  // workspace_key MUST be set: a workspace-target row without it makes
  // readPipelineByKey -> runDirForRow die on workspaceStorePath(null) before
  // any guard runs (verified).
  getDb().prepare("UPDATE pipelines SET target = 'workspace', workspace_key = 'wks-arch-0000abcd', workspace_meta = '{broken' WHERE id = ?").run(id);
  await mkdir(join(worcaHome(), 'runs', id), { recursive: true }); // something archive would rm -rf
  await assert.rejects(() => archivePipeline({ projectDir: '/tmp/proj-a', id }),
    (e) => e.code === 'RETAINED_WORKTREE');
});

test('archive refuses a single-project row whose branch column is unreadable while its run root survives', async () => {
  const { id } = await seedPipeline('/tmp/proj-a', { status: 'done' });
  getDb().prepare("UPDATE pipelines SET branch = '{broken' WHERE id = ?").run(id);
  await mkdir(join(worcaHome(), 'runs', id), { recursive: true });
  await assert.rejects(() => archivePipeline({ projectDir: '/tmp/proj-a', id }),
    (e) => e.code === 'RETAINED_WORKTREE');
});
```

Constraint tests — **green before AND after** (they pin the fail-open edges so the guard cannot over-reach; a regression here means the guard got too strict):

```js
test('archive PROCEEDS on unreadable workspace_meta once the run root is gone (no permanent wedge)', async () => {
  const { id } = await seedPipeline('/tmp/proj-a', { status: 'done' });
  getDb().prepare("UPDATE pipelines SET target = 'workspace', workspace_key = 'wks-arch-0000dcba', workspace_meta = '{broken' WHERE id = ?").run(id);
  const report = await archivePipeline({ projectDir: '/tmp/proj-a', id });
  assert.equal(report.archived, true, 'a corrupt-meta row must never become un-archivable forever');
});

test('archive clears itself once a manifest-retained checkout is gone (self-clearing)', async () => {
  const { id } = await seedPipeline('/tmp/proj-a', { status: 'done' });
  const runRoot = join(worcaHome(), 'runs', id);
  await mkdir(runRoot, { recursive: true });
  await writeRunManifest(runRoot, { pipelineId: id, runRootMode: 'detached', isWorkspace: false, members: [] });
  await updateRunManifest(runRoot, {
    retain: { reason: 'commit_failed', members: [{ worktreeDir: join(tmpdir(), `worca-gone-${id}`) }] }, // never created
  });
  const report = await archivePipeline({ projectDir: '/tmp/proj-a', id });
  assert.equal(report.archived, true, 'a retain record whose checkout is gone must not block archive');
});
```

- [ ] **Step 2: Run — the three red-first tests FAIL (archive passes today); the two constraint tests already pass.**

- [ ] **Step 3: Implement.** Replace the guard block at `pipeline-delete.mjs:103-108` with:

```js
  // UI state is advisory. Enforce the no-data-loss rule here as well, because a
  // stale client or a direct API caller could otherwise force-remove the very
  // checkout that was retained after its commit failed.
  if (retainedWorkFor(row)) {
    throw err('cannot archive while retained uncommitted work exists; recover it or discard the worktree first', 'RETAINED_WORKTREE');
  }
  // The run root is the one thing archive destroys that can still hold retained
  // checkouts (detached members live at runs/<id>/repos/<key>). Resolve it ONCE,
  // here, for the guards below AND the 2b) removal further down.
  const runRoot = join(worcaHome(), 'runs', row.id);
  // Fail CLOSED on unreadable retention metadata — but ONLY while the run root
  // still exists. With it gone, archive's per-member cleanup is already a no-op
  // for an unparseable column (rowToState yields branches:{} / a null branch), so
  // refusing forever would only wedge the row: discard cannot clear it
  // (retainedWorkFor returns null) and the UI hides the Discard button. Naming
  // the path keeps the refusal hand-clearable.
  const unreadable = (col) => {
    if (typeof col !== 'string' || !col.trim()) return false;
    // A JSON *string* branch ("worca/foo") is a SUPPORTED legacy shape
    // (rowToHistoryEntry reads it) — it carries no retention, so it is readable.
    try { const p = JSON.parse(col); return p === null || (typeof p !== 'object' && typeof p !== 'string'); }
    catch { return true; }
  };
  const metaUnreadable = row.target === 'workspace' ? unreadable(row.workspace_meta) : unreadable(row.branch);
  if (metaUnreadable && existsSync(runRoot)) {
    throw err(
      `cannot archive: retention metadata is unreadable, so retained uncommitted work inside ${runRoot} cannot be ruled out — inspect and remove that run root, then archive again`,
      'RETAINED_WORKTREE',
    );
  }
  // The DB stamp is teardown's LAST best-effort write; the run.json retain block
  // is written earlier. Trust either representation (the sweep already does).
  if (existsSync(runRoot)) {
    const guardManifest = await readRunManifest(runRoot);
    const members = Array.isArray(guardManifest?.retain?.members) ? guardManifest.retain.members : [];
    if (members.some((m) => m?.worktreeDir && existsSync(m.worktreeDir))) {
      throw err('cannot archive while retained uncommitted work exists; recover it or discard the worktree first', 'RETAINED_WORKTREE');
    }
  }
```

Then two mechanical follow-ups in the same function:
1. **Delete** the now-duplicate `const runRoot = join(worcaHome(), 'runs', row.id);` at `:201` (the 2b) block keeps using the hoisted one).
2. After the `const report = {…}` construction, surface the skipped cleanup:

```js
  if (metaUnreadable) {
    report.warnings.push('retention metadata was unreadable; per-member branch/worktree cleanup was skipped');
  }
```

- [ ] **Step 4: Run `test/pipeline-archive.test.mjs` + `test/delete-pipeline-api.test.mjs` — all PASS.**
- [ ] **Step 5: Commit** — `fix(archive): trust the manifest retain record; fail closed only while the run root exists`

---

### Task 8: Snapshot streams to a file, crash-safe, with the slow git timeout (F8)

**Files:**
- Modify: `src/core/worktree.mjs:320-331` (`snapshotWorktreePatch`; `:333` is already the next function — do not clip it), `src/core/results.mjs` (new filename helper), `src/core/pipeline-delete.mjs` (snapshot loop)
- Test: `test/pipeline-delete.test.mjs`

**Interfaces:**
- Produces (BREAKING for callers, update them in this task): `snapshotWorktreePatch(worktreeDir, outFile) -> {ok:true, file:string, bytes:number} | {ok:true, file:null, bytes:0} | {ok:false, step:'path'|'add'|'diff', message:string}`. The patch streams to `<outFile>.part` and is renamed only on success — a SIGKILL/timeout/disk-full can never leave a truncated patch under the final name. A **clean tree is SUCCESS with `file:null`** — discard-after-manual-commit (F7's clear path) must not fail, and a 0-byte "recovery patch" must never exist on disk.
- Produces: `export function retainedWorkPatchName(projectKey = null)` in `src/core/results.mjs` — the single source of the `retained-work[-<key>].patch` naming (used here and by Task 12; prevents the writer and readers from drifting apart).
- **CRITICAL, verified:** `worktree.mjs`'s local `git()` is `git(cwd, args, { signal, timeout = 30_000 } = {})` (`:53`; `SLOW_GIT_TIMEOUT_MS = 120_000` at `:50`). v1 passed the timeout positionally — it compiles, every test stays green, and the 30 s SIGKILL silently remains (F8 unfixed). Use the options object, like `:272`/`:296` do. No cheap test can pin the timeout value — this is an accepted-untestable line; get it right by reading.

- [ ] **Step 1: Failing tests** (append to `test/pipeline-delete.test.mjs`; add `snapshotWorktreePatch` to the test's `worktree.mjs` import, and `existsSync` from `node:fs` if absent)

```js
test('snapshotWorktreePatch writes the patch to the given file (no in-memory string)', async () => {
  const repo = await freshRepo();
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'snapfile1', sourceBranch: 'main', featureBranch: 'worca-cc/snapfile1',
  });
  await writeFile(join(wt.worktreeDir, 'x.bin'), 'binary-ish\n');
  const out = join(tmpdir(), `worca-snap-${Date.now()}.patch`);
  const res = await snapshotWorktreePatch(wt.worktreeDir, out);
  assert.equal(res.ok, true);
  assert.equal(res.file, out);
  assert.ok(res.bytes > 0);
  assert.match(await readFile(out, 'utf8'), /x\.bin/);
  assert.equal(existsSync(`${out}.part`), false, 'no temp file left behind');
  await rm(out, { force: true });
});

test('snapshotWorktreePatch on a clean tree is success with no file (discard-after-manual-commit must not fail)', async () => {
  const repo = await freshRepo();
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'snapclean1', sourceBranch: 'main', featureBranch: 'worca-cc/snapclean1',
  });
  const out = join(tmpdir(), `worca-snap-clean-${Date.now()}.patch`);
  const res = await snapshotWorktreePatch(wt.worktreeDir, out);
  assert.equal(res.ok, true);
  assert.equal(res.file, null);
  assert.equal(existsSync(out), false, 'no 0-byte patch is left behind');
});
```

- [ ] **Step 2: Run — FAIL.** Verified: `res.file` is undefined (today's signature is `(worktreeDir)` returning `{patch}`).

- [ ] **Step 3: Implement the snapshot.** Replace `snapshotWorktreePatch` (add `stat` to the existing `rm`/`rename` import from `node:fs/promises` at `worktree.mjs:18`):

```js
/**
 * Stage every remaining change and render a binary-capable patch against HEAD
 * DIRECTLY INTO outFile (no in-memory patch string — agent-created artifacts can
 * be huge). Staging is intentional: it makes untracked files part of the patch.
 * Uses the slow git timeout: big binary diffs legitimately take time.
 * Crash-safe: streams to `<outFile>.part` and renames on success, so a
 * SIGKILL/timeout/full disk can never leave a TRUNCATED patch under the final
 * name. A clean tree is SUCCESS with `file: null` (nothing to save is not a
 * failure — discard after a manual commit relies on it). A git failure returns
 * without removing anything so the checkout stays authoritative.
 */
export async function snapshotWorktreePatch(worktreeDir, outFile) {
  if (!worktreeDir || !outFile) {
    return { ok: false, step: 'path', message: 'worktreeDir and outFile are required' };
  }
  const add = await git(worktreeDir, ['add', '-A'], { timeout: SLOW_GIT_TIMEOUT_MS });
  if (!add.ok) {
    return { ok: false, step: 'add', message: add.stderr.trim() || `exit ${add.code}` };
  }
  const part = `${outFile}.part`;
  const diff = await git(worktreeDir, ['diff', '--binary', `--output=${part}`, 'HEAD', '--'],
    { timeout: SLOW_GIT_TIMEOUT_MS });
  if (!diff.ok) {
    await rm(part, { force: true }).catch(() => {});
    return { ok: false, step: 'diff', message: diff.stderr.trim() || `exit ${diff.code}` };
  }
  let bytes = 0;
  try { bytes = (await stat(part)).size; } catch { /* treated as empty below */ }
  if (!bytes) {
    // Nothing uncommitted: a 0-byte "recovery patch" on disk would be a lie.
    await rm(part, { force: true }).catch(() => {});
    return { ok: true, file: null, bytes: 0 };
  }
  await rename(part, outFile);
  return { ok: true, file: outFile, bytes };
}
```

- [ ] **Step 4: Add the filename helper** to `src/core/results.mjs` (next to `DIFF_PATCH_FILE` at `:12`; cycle-safe — `results.mjs` already imports from `artifacts.mjs`, never from `pipeline-delete.mjs`/`orchestrator.mjs`):

```js
/** Canonical retained-work patch filename; a null/empty key yields the bare name. */
export function retainedWorkPatchName(projectKey = null) {
  const suffix = projectKey ? `-${String(projectKey).replace(/[^a-zA-Z0-9._-]+/g, '-')}` : '';
  return `retained-work${suffix}.patch`;
}
```

- [ ] **Step 5: Update the caller.** In `discardRetainedWorktrees`, replace the WHOLE region from `const snapshots = [];` (`:270`) through the end of the patch-write loop (`:293`) — one contiguous replacement, so the old `const patches = []` cannot survive and collide:

```js
  // Snapshot ALL members before deleting ANY member, straight to their final
  // files. This prevents a later snapshot failure from leaving a half-discarded
  // workspace, without ever holding a whole patch in memory.
  await mkdir(runDir, { recursive: true });
  const patches = [];
  for (const target of targets) {
    const name = retainedWorkPatchName(state.target === 'workspace' ? (target.projectKey || 'member') : null);
    const snap = await snapshotWorktreePatch(target.worktreeDir, join(runDir, name));
    if (!snap.ok) {
      throw err(
        `cannot save recovery patch for ${target.projectKey || target.worktreeDir}: git ${snap.step} failed: ${snap.message}`,
        'SNAPSHOT_FAILED',
      );
    }
    if (snap.file) { // a clean tree yields no patch — nothing to record
      recordArtifact(row.id, 'retained-work-patch', name);
      patches.push(snap.file);
    }
  }
```

Add `import { retainedWorkPatchName } from './results.mjs';` to `pipeline-delete.mjs` (verified: no `./results.mjs` import exists there — this is a new line). `writeFile` IS now unused in `pipeline-delete.mjs` — drop it from the imports.

- [ ] **Step 6: Run `test/pipeline-delete.test.mjs` — all PASS** (both existing discard tests still assert patch CONTENT from the file — their worktrees are dirty, so `snap.file` is always set there).
- [ ] **Step 7: Commit** — `fix(worktree): stream the retained-work patch to disk, crash-safe, with the slow git timeout`

---

### Task 9: Discard reports the truth (server half of F3)

**Files:**
- Modify: `src/core/pipeline-delete.mjs` (`discardRetainedWorktrees`)
- Test: `test/pipeline-delete.test.mjs`, `test/delete-pipeline-api.test.mjs`

**Interfaces:**
- Produces: discard report gains `remaining: number` (count of retained worktrees still on disk after the attempt) and `discarded` is `true` ONLY when every retained member's checkout is gone. No-op keeps `{discarded:false, remaining:0}`. HTTP status unchanged (200; the route spreads the report at `ui/server.mjs:1367`).
- **Coverage gap this task must close (found by mutation audit):** with only v1's assertions, hardcoding `report.discarded = true` AND deleting `report.remaining += 1` both kept every suite green — the entire deliverable was untested. The surviving-checkout test below is the real pin (and also pins the run-root keep gate Task 10 rewrites).

- [ ] **Step 1: Failing tests**

(a) Append to the existing single-project discard test in `test/pipeline-delete.test.mjs` (its report variable is named `report`), after the current assertions:

```js
    assert.equal(report.remaining, 0, 'nothing left retained after a full discard');
```

(b) Append to `test/delete-pipeline-api.test.mjs`, in the `discard-worktree route returns 400 / 404 / 409 and an idempotent 200` test, right after the `body.discarded === false` assertion:

```js
  assert.equal(body.remaining, 0, 'a no-op discard leaves nothing retained');
```

(c) NEW test in `test/pipeline-delete.test.mjs` — force a checkout that SURVIVES removal (add `chmod` to the `node:fs/promises` imports, `worcaHome` from `../src/core/projects.mjs`, and `retainedWorkFor` to the artifacts import, if absent):

```js
test('discard reports the truth when a checkout survives removal (and keeps its stamp + run root)', async () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return; // chmod is inert under root
  const repo = await freshRepo();
  const prev = process.env.WORCA_HOME;
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'retainkeep', sourceBranch: 'main', featureBranch: 'worca-cc/retainkeep',
  });
  await writeFile(join(wt.worktreeDir, 'kept.txt'), 'uncommitted\n');
  await freshStore(repo, {
    id: 'retainkp1', base: 'retain-keep', datePrefix: '04-06-26', status: 'done',
    branch: {
      source: 'main', feature: wt.branch, worktreeDir: wt.worktreeDir,
      commitFailed: { code: 'commit_failed', step: 'commit', message: 'hook', at: new Date().toISOString() },
    },
  });
  const runRoot = join(worcaHome(), 'runs', 'retainkp1');
  await mkdir(runRoot, { recursive: true });
  // Make removal fail while the snapshot still works: the worktree DIR is made
  // read-only, so `git add -A` / `git diff` still READ it (the index lives in the
  // main repo's .git), but neither `git worktree remove --force` nor the rm
  // backstop can unlink its contents. (Assumes a non-root test user, like the
  // rest of the suite.)
  await chmod(wt.worktreeDir, 0o555);
  try {
    // freshStore hardcodes store key 'proj-00000001' (NOT projectKey(repo)), so
    // the discard must address the row by key — projectDir would miss it.
    const report = await discardRetainedWorktrees({ key: 'proj-00000001', id: 'retainkp1' });
    assert.equal(report.remaining, 1, 'the surviving checkout is counted');
    assert.equal(report.discarded, false, 'discarded must not claim success');
    assert.ok(report.warnings.some((w) => /worktree still exists/.test(w)));
    assert.ok(existsSync(runRoot), 'the run root is kept while a checkout survives');
    const row = getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get('retainkp1');
    assert.ok(retainedWorkFor(row), 'the DB retention stamp survives a failed removal');
  } finally {
    await chmod(wt.worktreeDir, 0o755);
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});
```

(Verified end to end: `freshStore(repoDir, { id, base, datePrefix, status, branch })` is the real signature; `git add`/`git diff --output=<store path>` succeed against the 0o555 tree — the index lives in the main repo's `.git` — while both `git worktree remove --force` and the `rm` backstop fail with EACCES, so the dir survives and `remaining` increments.)

- [ ] **Step 2: Run — FAIL** (`remaining` is undefined everywhere).

- [ ] **Step 3: Implement.** In `discardRetainedWorktrees` (post-Task-8 shape):

1. The no-op short-circuit object gains `remaining: 0`:

```js
    return { ok: true, id: row.id, discarded: false, remaining: 0, worktrees: [], patches: [], runRoot: null, warnings: [] };
```

2. The report construction (its snippet is correct as-is — `discarded` starts `false` and is DERIVED later):

```js
  const report = {
    ok: true, id: row.id, discarded: false, remaining: 0, worktrees: [], patches,
    runRoot: null, warnings: [],
  };
```

3. In the removal loop's else-branch (worktree still exists), add the counter:

```js
    } else {
      report.remaining += 1;
      report.warnings.push(`${target.projectKey || 'project'}: worktree still exists at ${target.worktreeDir}`);
    }
```

4. Immediately after the removal loop and **before** `await writeState(runDir, state);` (the runRoot rescue/manifest-copy block sits before the loop; only the `rmGuarded` block comes after):

```js
  report.discarded = report.remaining === 0;
```

The existing `commitFailed`-clearing stays inside the `existsSync === false` branch for now — Task 10 replaces that whole persistence mechanism.

- [ ] **Step 4: Run both suites — PASS.**
- [ ] **Step 5: Commit** — `fix(discard): discarded=true only when every retained checkout is actually gone`

---

### Task 10: Discard persists via a targeted column update, not `writeState` (F14)

**Files:**
- Modify: `src/core/pipeline-delete.mjs` (`discardRetainedWorktrees`)
- Test: `test/pipeline-delete.test.mjs`

**Interfaces:**
- Consumes: `getDb`, `tx` (already imported). Drops the `writeState` import (verified: `:337` is its only use in the module).
- **Data-safety rule (adjudicated):** the targeted update must NEVER rebuild a missing/unparseable column from `{}` — `workspace_meta` carries the whole §5.2 superset (`projects`, `projectKeys`, `checkpointRefs`, `runRootMode`), and writing a rebuilt `{}` over it would permanently break archive/resume for that row. Unreadable metadata is *reported*, not overwritten.

- [ ] **Step 1: Failing test — two anchored edits to the existing single-project discard test** (do NOT paste as one block; the SELECT must run BEFORE the discard call or the assertions are vacuous):

Edit A — immediately BEFORE the `discardRetainedWorktrees(...)` call (`resume_point` is NULL in the fixture, so seed it first — otherwise that assertion is `null === null` and proves nothing; `updated_at` is NULL from `seedPipelineRow`, so the pre-fix `writeState` ISO restamp is the load-bearing red):

```js
    getDb().prepare('UPDATE pipelines SET resume_point = ? WHERE id = ?')
      .run(JSON.stringify({ version: 1 }), 'retain11');
    const before = getDb().prepare('SELECT updated_at, resume_point FROM pipelines WHERE id = ?').get('retain11');
```

Edit B — after the discard call (next to the existing assertions):

```js
    const afterRow = getDb().prepare('SELECT updated_at, resume_point FROM pipelines WHERE id = ?').get('retain11');
    assert.equal(afterRow.updated_at, before.updated_at, 'discard must not restamp updated_at (stats proxy)');
    assert.equal(afterRow.resume_point, before.resume_point, 'discard must not clobber resume_point');
```

- [ ] **Step 2: Run — FAIL.** Verified: `updated_at` restamped (`null` → ISO timestamp) by `writeState`.

- [ ] **Step 3: Implement.** In `discardRetainedWorktrees`:

1. In the removal loop, REPLACE the in-`state` branchRecord mutation (the `const branchRecord = …; if (branchRecord) { delete …commitFailed; … }` block inside the `existsSync === false` branch) with collecting cleared keys — so the success branch becomes:

```js
    if (!existsSync(target.worktreeDir)) {
      report.worktrees.push(target.worktreeDir);
      clearedKeys.push(target.projectKey ?? null);
    } else {
      report.remaining += 1;
      report.warnings.push(`${target.projectKey || 'project'}: worktree still exists at ${target.worktreeDir}`);
    }
```

and declare `const clearedKeys = [];` on the line directly above the removal loop (in the snippet you commit, not as an afterthought).

2. REPLACE `await writeState(runDir, state);` with the targeted, guarded update:

```js
  // Targeted update: clear ONLY the retention stamps. A full writeState would
  // restamp updated_at (the stats terminal-write proxy), NULL resume_point, and
  // rewrite pipeline_steps — none of which a checkout reclaim may touch.
  if (clearedKeys.length) {
    const parse = (t) => { try { return JSON.parse(t); } catch { return undefined; } };
    const clear = (br) => { delete br.commitFailed; br.worktreeRemoved = true; br.branchKept = true; };
    tx(() => {
      const fresh = getDb().prepare('SELECT branch, workspace_meta FROM pipelines WHERE id = ?').get(row.id);
      if (state.target === 'workspace') {
        const wm = typeof fresh?.workspace_meta === 'string' ? parse(fresh.workspace_meta) : fresh?.workspace_meta;
        // NEVER write a rebuilt {} here: workspace_meta carries the whole §5.2
        // superset (projects/projectKeys/checkpointRefs/runRootMode). Unreadable
        // or branch-less meta is reported, not overwritten.
        if (!wm || typeof wm !== 'object' || !wm.branches || typeof wm.branches !== 'object') {
          // A NULL column is the manifest-only case (Task 11) — nothing to clear,
          // nothing to warn about. Warn only when a non-null column is corrupt.
          if (fresh?.workspace_meta != null) {
            report.warnings.push('retention stamp not cleared: workspace metadata is unreadable');
          }
          return;
        }
        let touched = false;
        for (const k of clearedKeys) { const br = wm.branches[k]; if (br) { clear(br); touched = true; } }
        if (touched) {
          getDb().prepare('UPDATE pipelines SET workspace_meta = ? WHERE id = ?')
            .run(JSON.stringify(wm), row.id);
        }
      } else {
        const br = typeof fresh?.branch === 'string' ? parse(fresh.branch) : fresh?.branch;
        if (!br || typeof br !== 'object') {
          if (fresh?.branch != null) { // NULL column = manifest-only discard: silent skip
            report.warnings.push('retention stamp not cleared: branch metadata is unreadable');
          }
          return;
        }
        clear(br);
        getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify(br), row.id);
      }
    });
  }
```

3. The later run-root gate read the MUTATED `state`; replace it with the outcome-based equivalent:

```js
  if (existsSync(runRoot) && report.remaining === 0) {
```

4. Remove `writeState` from the `artifacts.mjs` import (verified droppable).

Known accepted side effect: dropping `writeState` also drops its `rememberDir` cache seeding, so the trailing `appendAudit(runDir, …)` relies on `resolvePipelineId`'s 8-hex-basename fallback. Production ids are 8-hex, so it still works; only non-hex TEST fixtures (`retain11`) lose the audit line, and no test asserts it.

Reviewer note: the Task 9 surviving-checkout test's `retainedWorkFor(row)` assertion stays green across this task for a DIFFERENT reason than before — at Task-9 state the surviving `writeState` re-persisted an uncleared `state.branch`; from this task on, `clearedKeys` is empty so no write happens at all. Same invariant, new mechanism.

- [ ] **Step 4: Run `test/pipeline-delete.test.mjs` — all PASS** (the existing `saved.state.branch.commitFailed === undefined` / `worktreeRemoved === true` assertions now verify the targeted update round-trips through `readPipelineByKey`, and the Task 9 surviving-checkout test keeps pinning the `remaining === 0` gate).
- [ ] **Step 5: Commit** — `fix(discard): clear retention via targeted column update (keep updated_at/resume_point/steps)`

---

### Task 11: Discard honors the manifest ledger (closes the F2 wedge the archive guard would otherwise create)

**Files:**
- Modify: `src/core/pipeline-delete.mjs` (`discardRetainedWorktrees` head)
- Test: `test/pipeline-delete.test.mjs`

**Why:** After Task 7, a manifest-only retention (the DB stamp was lost in F2's crash window) makes archive refuse — but v1 left discard blind to it: `retainedWorkFor(row)` returns null, so discard no-ops forever and the row is wedged with no exit. Honor the same manifest ledger the sweep and archive read, gated per member on `existsSync` (self-clearing, same contract as `retainedWorkFor`). **Accepted residual:** the history row (and therefore the badge/banner/Discard button) still derives only from the DB — a manifest-only retention is discoverable via archive's 409 message and dischargeable via this API, not via the UI. Enriching the list path with an async manifest read is out of scope.

- [ ] **Step 1: Failing test** (append to `test/pipeline-delete.test.mjs`; add `writeRunManifest, updateRunManifest` from `../src/core/run-manifest.mjs` to the imports if absent)

```js
test('discard honors a manifest-only retention (DB stamp lost in the F2 crash window)', async () => {
  const repo = await freshRepo();
  const prev = process.env.WORCA_HOME;
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'manifonly', sourceBranch: 'main', featureBranch: 'worca-cc/manifonly',
  });
  await writeFile(join(wt.worktreeDir, 'm.txt'), 'kept\n');
  await freshStore(repo, { id: 'manifly01', base: 'manif-only', datePrefix: '04-06-26', status: 'error' });
  const runRoot = join(worcaHome(), 'runs', 'manifly01');
  await mkdir(runRoot, { recursive: true });
  await writeRunManifest(runRoot, { pipelineId: 'manifly01', runRootMode: 'detached', isWorkspace: false, members: [] });
  await updateRunManifest(runRoot, {
    retain: { reason: 'commit_failed', members: [{ projectKey: null, worktreeDir: wt.worktreeDir, branch: wt.branch }] },
  });
  try {
    // Address by store key: freshStore hardcodes 'proj-00000001' (see Task 9).
    const report = await discardRetainedWorktrees({ key: 'proj-00000001', id: 'manifly01' });
    assert.equal(report.discarded, true, 'manifest-only retention is discardable, not a permanent wedge');
    assert.equal(existsSync(wt.worktreeDir), false, 'the checkout is reclaimed');
    assert.equal(report.patches.length, 1, 'a recovery patch was saved first');
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});
```

- [ ] **Step 2: Run — FAIL** (today the no-op path returns `{discarded:false}`).

- [ ] **Step 3: Implement.** At the head of `discardRetainedWorktrees`, replace

```js
  const retained = retainedWorkFor(row);
  if (!retained) {
```

with:

```js
  const runRoot = join(worcaHome(), 'runs', row.id);
  let retained = retainedWorkFor(row);
  if (!retained && existsSync(runRoot)) {
    // The DB stamp is teardown's LAST best-effort write and can be lost (F2's
    // crash window). The run.json retain ledger is written earlier — honor it so
    // manifest-only retention is still discardable instead of a permanent wedge
    // (archive refuses it; this is the only exit). existsSync keeps it
    // self-clearing, same contract as retainedWorkFor.
    const manifest = await readRunManifest(runRoot);
    const live = (Array.isArray(manifest?.retain?.members) ? manifest.retain.members : [])
      .filter((m) => m?.worktreeDir && existsSync(m.worktreeDir));
    if (live.length) retained = { reason: manifest.retain.reason || 'unknown', members: live };
  }
  if (!retained) {
```

and DELETE the later duplicate `const runRoot = join(worcaHome(), 'runs', row.id);` (it sat just before the mount-rescue block) — the rest of the function keeps using the hoisted one. `readRunManifest` is already imported. On this path the row's `branch` column is NULL, so Task 10's targeted update silently skips (no stamp to clear, no false "unreadable" warning — its guards warn only on a NON-null corrupt column).

- [ ] **Step 4: Run `test/pipeline-delete.test.mjs` + `test/delete-pipeline-api.test.mjs` — all PASS** (the API no-op test still no-ops: its row has no manifest).
- [ ] **Step 5: Commit** — `fix(discard): honor the manifest retain ledger when the DB stamp was lost`

---

### Task 12: Durable patch at retention time; recovery route serves it honestly (D1)

**Files:**
- Modify: `src/core/orchestrator.mjs` (new `_snapshotRetained` + all 3 retention sites), `ui/server.mjs:1138-1163` (recovery-patch route), `ui/public/app.js` (`addRecoveryPatchLink`)
- Test: `test/run-root-teardown.test.mjs`, `test/delete-pipeline-api.test.mjs`

**Interfaces:**
- Consumes: `snapshotWorktreePatch(worktreeDir, outFile)` + `retainedWorkPatchName` from Task 8; `recordArtifact` (verified: already in the orchestrator's `./artifacts.mjs` import at `:34`); `listArtifacts` (exported from `artifacts.mjs:109` but NOT yet imported in `ui/server.mjs` — add it); `DIFF_PATCH_FILE` (NEW import line in `ui/server.mjs` — there is no existing `results.mjs` import there).
- Produces: on every retention, best-effort `<pipelineDir>/retained-work[-<key>].patch` + artifact kind `retained-work-patch`. `GET /api/runs/:id/recovery-patch` prefers the retained-work patch **via the artifacts index** (which only gains a row on a successful snapshot — a truncated or missing file can never shadow the fallback, and workspace-suffixed names resolve too), else falls back to `DIFF_PATCH_FILE`.
- Design notes (adjudicated): `git add -A` at retention time is CORRECT — `_commitWork` already ran `add -A` before any commit-step failure, so the index is already staged on the main retention path, and the banner's own instructions say `git add -A`; the alternatives (`add -N`, `stash create`) capture untracked/binary work unreliably. Discard later overwrites the same filename with a fresher snapshot — intended (`recordArtifact` is INSERT-OR-IGNORE, no dupes). The retention-time patch can be stale if the user keeps editing; the UI link discloses that (Step 6).

- [ ] **Step 1: Failing tests**

(a) Extend the EXISTING `detached: a failed teardown commit retains…` test in `test/run-root-teardown.test.mjs`: insert at the END of the `withMode` callback body, right after the test's `durableManifest` assertion and immediately before the callback's closing `});` — `st` is scoped inside it; `st.pipelineDir` exists; `readFile`/`join` are imported. (Why this goes green: `removeInjectedPaths` skips `claudeMdSection` entries and every other injected path was excluded from the commit, so the dirty content that made the commit fail survives into the snapshot.)

```js
    const patchText = await readFile(join(st.pipelineDir, 'retained-work.patch'), 'utf8');
    assert.match(patchText, /diff --git/, 'a durable patch exists the moment work is retained');
```

(b) NEW workspace-suffix unit test (append to `test/run-root-teardown.test.mjs`; verified: `createWorktree` must be ADDED to the suite's worktree imports, `mkdtemp`/`tmpdir` are already present; `recordArtifact` inside the helper is best-effort and swallows the missing-row FK — verified):

```js
test('workspace members snapshot to distinct retained-work-<key>.patch files', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  const wt = await createWorktree({
    projectDir: repo, pipelineId: 'snapkey01', sourceBranch: 'main', featureBranch: 'worca-cc/snapkey01',
  });
  await writeFile(join(wt.worktreeDir, 'w.txt'), 'x\n');
  const dir = await mkdtemp(join(tmpdir(), 'worca-snapkey-'));
  orch.pipeline = { id: 'snapkey01', dir };
  orch.isWorkspace = true;
  await orch._snapshotRetained({ worktreeDir: wt.worktreeDir }, 'proj-0000abcd');
  assert.ok(existsSync(join(dir, 'retained-work-proj-0000abcd.patch')),
    'member patches must not collide on one filename');
});
```

(c) NEW route-preference test — **insert IMMEDIATELY after** the existing `recovery-patch route downloads…` test in `test/delete-pipeline-api.test.mjs` (NOT appended to the file end: the final `200 removes the pipeline dir…` test deletes `pdir`, so a late placement dies with ENOENT; Task 3's `sf` test sits in the same window — either side of it is fine). Add `recordArtifact` to the imports:

```js
test('recovery-patch route prefers the retained-work snapshot when one is indexed', async () => {
  const pdir = join(home, '.worca-cc', 'store', KEY, 'pipelines', '04-06-26-my-feature-pp');
  await writeFile(join(pdir, 'retained-work.patch'), 'diff --git a/kept b/kept\n', 'utf8');
  recordArtifact('pp', 'retained-work-patch', 'retained-work.patch');
  const res = await fetch(`${base}/api/runs/pp/recovery-patch?projectKey=${KEY}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /retained-work-pp\.patch/);
  assert.match(await res.text(), /kept/);
  // Restore the fixture: later tests rely on the diff-patch fallback identity.
  getDb().prepare("DELETE FROM artifacts WHERE pipeline_id = 'pp' AND kind = 'retained-work-patch'").run();
  await rm(join(pdir, 'retained-work.patch'), { force: true });
});
```

(Verified: the neighboring recovery-patch test uses a raw `fetch` with a module-scope `base`; the store path literal matches the suite's `before` hook.)

- [ ] **Step 2: Run — all three FAIL.** Verified for (a): `ENOENT … retained-work.patch`.

- [ ] **Step 3: Implement the orchestrator helper** (near `_recordCommitFailure`; add `snapshotWorktreePatch` to the `./worktree.mjs` import at `:86-89`, and `retainedWorkPatchName` to the orchestrator's EXISTING `./results.mjs` import at `:51` — verified it exists):

```js
  /**
   * Best-effort durable copy of the retained work, written the moment retention
   * is decided — a crash or manual deletion before an explicit discard must not
   * leave the checkout as the only copy. Failure (or a clean tree) keeps the
   * worktree as the source of truth (same failure class as the commit itself).
   */
  async _snapshotRetained(info, key = null) {
    const pipelineDir = this.pipeline?.dir;
    if (!pipelineDir || !info?.worktreeDir) return;
    const name = retainedWorkPatchName(this.isWorkspace ? key : null);
    const snap = await snapshotWorktreePatch(info.worktreeDir, join(pipelineDir, name));
    if (snap.ok && snap.file) {
      recordArtifact(this.pipeline.id, 'retained-work-patch', name);
      this._log('git', 'info', `Retained-work recovery patch saved: ${name}`);
    } else if (snap.ok) {
      this._log('git', 'info', 'Retained-work snapshot skipped: nothing uncommitted to save.');
    } else {
      this._log('git', 'warn',
        `retained-work patch not saved (git ${snap.step}: ${snap.message}); the worktree is the only copy`);
    }
  }
```

Call sites — one per retention site, each INSIDE the retained branch:
- `_teardownWorktree`: first statement inside `if (retained) {` (`:1377`): `await this._snapshotRetained(info);`
- `_teardownWorktreeAll`: inside the `_recordCommitFailure(...)`-true block, after `anyRetained = true;`: `await this._snapshotRetained(info, projectKey_);`
- `_teardownRunRoot`: **first statement inside the `if (retained) {` block** (`:1520`) — NOT directly after the `_recordCommitFailure` call at `:1516`, because `removeInjectedPaths(wt, injected)` runs between them (`:1519`) and MUST come first: it has no restore, and snapshotting before it would embed mounted skill bodies and linked `.env` contents into a patch inside the store. Call: `await this._snapshotRetained(info, key);`

- [ ] **Step 4: Rewrite the route's read+send** (`ui/server.mjs:1156-1159`; `key` is in scope from `:1152-1154`):

```js
    // Prefer a retained-work snapshot (any member's, incl. workspace-suffixed
    // names) over the done-path diff. Resolved through the artifacts INDEX, which
    // only gains a row on a SUCCESSFUL snapshot — a truncated or missing file can
    // never shadow the diff-patch fallback.
    const arts = await listArtifacts(id).catch(() => []);
    const retainedRel = arts.find((a) => a && a.kind === 'retained-work-patch')?.relPath || null;
    let filename = null;
    let patch = retainedRel == null ? null : await readRunArtifactText(key, id, retainedRel);
    if (patch != null && patch.length) {
      filename = `retained-work-${String(id).replace(/[^a-zA-Z0-9._-]/g, '-')}.patch`;
    } else {
      patch = await readRunArtifactText(key, id, DIFF_PATCH_FILE);
      filename = `diff-patch-${String(id).replace(/[^a-zA-Z0-9._-]/g, '-')}.patch`;
    }
    if (patch == null) return res.status(404).json({ error: 'recovery patch not found' });
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.type('text/x-diff').send(patch);
```

Imports: add `listArtifacts` to the MAIN `artifacts.mjs` import list at `ui/server.mjs:21-25` (there is a second, smaller one at `:65` — not that one), and a new line `import { DIFF_PATCH_FILE } from '../src/core/results.mjs';` (this also completes C3 — note it when you reach Task 17).

- [ ] **Step 5: Rewrite `addRecoveryPatchLink`** (`app.js:7937-7952`) — the gate widens AND the label/`download` stop lying (the anchor `download` attribute WINS over the server's `Content-Disposition`, so it must match what the route actually prefers):

```js
function addRecoveryPatchLink(node, projectDir, p, artifacts) {
  const banner = node.querySelector('.retained-banner');
  if (!banner || banner.hidden || !Array.isArray(artifacts)) return;
  const retained = artifacts.some((a) => a && a.kind === 'retained-work-patch');
  const diff = artifacts.some((a) => a && a.kind === 'diff-patch');
  if (!retained && !diff) return;
  if (banner.querySelector('.retained-patch-link')) return;
  const line = document.createElement('p');
  line.className = 'retained-patch-link';
  line.appendChild(document.createTextNode('Alternate recovery: '));
  const link = document.createElement('a');
  link.href = `/api/runs/${encodeURIComponent(p.id)}/recovery-patch?${runActionQuery(projectDir, p)}`;
  link.download = retained ? `retained-work-${p.id}.patch` : `diff-patch-${p.id}.patch`;
  link.textContent = retained
    ? 'download the recovery patch (snapshot taken when the work was retained)'
    : 'download the pipeline diff patch';
  link.addEventListener('click', (e) => e.stopPropagation());
  line.appendChild(link);
  banner.appendChild(line);
}
```

- [ ] **Step 6: Pin the rewritten link with a UI test** (the `addRecoveryPatchLink` rewrite is otherwise the plan's only untested behavior change). Append to `test/ui-history-diff-overview.test.mjs` — that suite owns the card-EXPAND plumbing (`openCard` clicks `.hist-head` and serves the `/api/history/<id>` detail; the banner lives inside `.hist-detail`). Verified empirically: green against the rewritten `app.js`, red (link absent) against the pre-plan one:

```js
test('retained banner links the recovery patch honestly (retained-work name + label)', async () => {
  const retainedRow = {
    id: 'p-1', projectKey: 'proj-00000001', title: 'Run', status: 'error', startedAt: '2026-06-20T00:00:00Z',
    retainedWork: { reason: 'commit_failed', members: [{ worktreeDir: '/tmp/x', step: 'commit', message: 'hook' }] },
  };
  const { detail } = await openCard((url) => {
    if (url.includes('/api/history/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({
      state: { phase: 'error', status: 'error', cycle: 1, subAgents: [], steps: [], stepper: null },
      auditMarkdown: '', clarify: { questions: [], answers: [] }, reviews: [],
      results: null, overview: null,
      artifacts: [{ kind: 'retained-work-patch', relPath: 'retained-work.patch' }],
    }) });
    if (url.includes('/api/history')) return Promise.resolve({ ok: true, status: 200, json: async () => ({
      pipelines: [retainedRow],
    }) });
    return null;
  });
  const link = detail.querySelector('.retained-patch-link a');
  assert.ok(link, 'the alternate-recovery link renders for a retained-work-patch artifact');
  assert.equal(link.download, 'retained-work-p-1.patch', 'download name matches what the route prefers');
  assert.match(link.textContent, /recovery patch \(snapshot taken when the work was retained\)/);
});
```

- [ ] **Step 7: Run `test/run-root-teardown.test.mjs`, `test/delete-pipeline-api.test.mjs`, `test/ui-history-delete.test.mjs`, `test/ui-history-diff-overview.test.mjs` — all PASS** (the pre-existing recovery-patch test keeps passing: fixture `pp` has no `retained-work-patch` index row at that point, so the fallback serves `diff-patch-pp.patch` exactly as it asserts).
- [ ] **Step 8: Commit** — `feat(pipeline): durable retained-work patch at retention time; serve it honestly for recovery`

---

### Task 13: `runDirForRow` reuses the archive resolver's matcher (F11)

**Files:**
- Modify: `src/core/artifacts.mjs` (`runDirForRow` + new exported `findRunDir`), `src/core/pipeline-delete.mjs` (delete its local `findRunDir`, import instead)
- Test: `test/pipeline-delete.test.mjs` (`freshStore` lives there — the other suite lacks it)

**Interfaces:**
- Produces: `export async function findRunDir(pipelinesDir, id)` in `artifacts.mjs` — `pipeline-delete.mjs:356-363`'s behavior (case-insensitive `-<id>$` regex pass, THEN exact-basename pass) plus regex-escaping of `id`. Note: `runDirForRow`'s current fallback is a SINGLE interleaved case-sensitive pass (`e.name === row.id || e.name.endsWith(suffix)`); adopting `findRunDir`'s two-pass precedence is **intentional — that unification IS the F11 fix**, not a side effect.
- Import direction (verified): `pipeline-delete.mjs` already imports from `artifacts.mjs`; `artifacts.mjs` imports no `pipeline-delete.mjs`. `readdir`/`join` already imported in `artifacts.mjs`.

- [ ] **Step 1: Failing test** (append to `test/pipeline-delete.test.mjs`; add `rename` to the `node:fs/promises` import and `runDirForRow` to the artifacts import; keep the suite's WORCA_HOME save/restore idiom)

```js
test('runDirForRow matches the archive resolver: case-insensitive -<id> suffix', async () => {
  const prev = process.env.WORCA_HOME;
  try {
    await freshStore(await freshRepo(), {
      id: 'casemix', base: 'x', datePrefix: '04-06-26', status: 'done',
    });
    // Rename the run dir to an upper-cased suffix the current readdir fallback misses.
    const pipelinesDir = join(process.env.WORCA_HOME, '.worca-cc', 'store', 'proj-00000001', 'pipelines');
    const [dir] = (await readdir(pipelinesDir)).filter((d) => d.endsWith('-casemix'));
    await rename(join(pipelinesDir, dir), join(pipelinesDir, dir.toUpperCase()));
    const row = getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get('casemix');
    const resolved = await runDirForRow(row);
    assert.match(resolved, /-CASEMIX$/, 'resolves case-insensitively, like findRunDir');
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});
```

(`'casemix'` is deliberately non-8-hex so `runDirIndex` — keyed by `DIR_ID_RE = /-([0-9a-f]{8})$/i` — never indexes it and the fallback is exercised in both directions. Verified red: today's case-sensitive `endsWith` misses and the function returns the nonexistent `join(pipelinesDir, 'casemix')`.)

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement.**

1. Add to `artifacts.mjs` as an export:

```js
/** Find the on-disk run dir for an id under pipelinesDir (basename ends in -<id>).
 *  Case-insensitive suffix pass first, exact-basename pass second — the archive
 *  resolver's historical behavior. */
export async function findRunDir(pipelinesDir, id) {
  let entries;
  try { entries = await readdir(pipelinesDir, { withFileTypes: true }); } catch { return null; }
  const esc = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const e of entries) if (e.isDirectory() && new RegExp(`-${esc}$`, 'i').test(e.name)) return join(pipelinesDir, e.name);
  for (const e of entries) if (e.isDirectory() && e.name === id) return join(pipelinesDir, e.name);
  return null;
}
```

2. In `runDirForRow`, replace the SPAN from `const indexed = dirById.get(row.id);` through the final `return join(pipelinesDir, row.id);` (`artifacts.mjs:1954-1965` — replacing only the try/catch would re-declare `const indexed` and SyntaxError) with:

```js
  const indexed = dirById.get(row.id);
  if (indexed) return indexed;
  // Production ids are 8-hex and always covered by runDirIndex; this fallback
  // serves older/manual rows via the SAME matcher archive uses (findRunDir),
  // adopting its case-insensitive suffix-first precedence deliberately (F11).
  const hit = await findRunDir(pipelinesDir, row.id);
  if (hit) return hit;
  return join(pipelinesDir, row.id);
```

3. In `pipeline-delete.mjs`: delete the local `findRunDir` (`:355-363`), add `findRunDir` to its `./artifacts.mjs` import, and drop `readdir` from its imports if that was its last use (verified it was).

- [ ] **Step 4: Run `test/pipeline-delete.test.mjs`, `test/delete-pipeline-api.test.mjs`, `test/pipeline-archive.test.mjs`, plus `test/read-pipeline-by-key.test.mjs` and `test/persist-roundtrip.test.mjs` (both funnel through `runDirForRow` / the `deletePipeline` alias) — all PASS** (the non-8-hex fixture `pp` → `04-06-26-my-feature-pp` still resolves under the new matcher).
- [ ] **Step 5: Commit** — `refactor(artifacts): one run-dir matcher — runDirForRow reuses findRunDir`

---

### Task 14: Workspace deletion refuses live retained work (F4)

**Files:**
- Modify: `src/core/workspaces.mjs` (`deleteWorkspace`), `ui/server.mjs:561-566` (`workspaceErrorStatus`)
- Test: `test/pipeline-delete.test.mjs` (core), `test/delete-pipeline-api.test.mjs` (route)

**Fixture reality (verified — v1's test could NEVER pass):** (a) `deleteWorkspace` rejects any id failing `WORKSPACE_KEY_RE = /^wks-[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/` — `'wks-retain-del'` has no 8-hex tail → `NOT_FOUND` before the new guard. (b) `freshWorkspaceStore` seeds ONLY the `pipelines` row; `deleteWorkspace`'s membership check needs a `workspaces` registry row → INSERT it directly (and AFTER `freshWorkspaceStore`, whose `_resetForTests()` wipes earlier rows; `createWorkspace` is no substitute — it demands ≥2 onboarded repos and mints its own key). Also: v1's import-cycle claim was wrong — `artifacts.mjs:633` DOES `await import('./workspaces.mjs')`, but it is a call-time dynamic import, not a load-order cycle; the static edge `workspaces → artifacts` already exists (`workspaces.mjs:29` imports `slugify`) — **extend that line** rather than adding a second import.

- [ ] **Step 1: Failing tests**

(a) Core (append to `test/pipeline-delete.test.mjs`; add `deleteWorkspace` from `../src/core/workspaces.mjs` to the imports):

```js
test('deleteWorkspace refuses while a member pipeline has retained uncommitted work', async () => {
  const WKEY = 'wks-retain-0000abcd'; // MUST satisfy WORKSPACE_KEY_RE (8-hex tail)
  const repoA = await freshRepo();
  const wtA = await createWorktree({ projectDir: repoA, pipelineId: 'retainwd', sourceBranch: 'main', featureBranch: 'worca-cc/retainwd-a' });
  await writeFile(join(wtA.worktreeDir, 'a.txt'), 'kept\n');
  const prev = process.env.WORCA_HOME;
  await freshWorkspaceStore({
    wkey: WKEY, id: 'retainwd', base: 'retained-del', datePrefix: '04-06-26', status: 'done',
    members: [{ projectDir: repoA, branch: { source: 'main', feature: wtA.branch, worktreeDir: wtA.worktreeDir, commitFailed: { code: 'commit_failed', step: 'commit', message: 'hook', at: new Date().toISOString() } } }],
  });
  // freshWorkspaceStore seeds only the pipelines row; deleteWorkspace's
  // membership-first check needs the registry row too. Insert AFTER
  // freshWorkspaceStore (its _resetForTests() wipes anything earlier).
  const now = new Date().toISOString();
  getDb().prepare('INSERT INTO workspaces (id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(WKEY, 'Retain Del WS', '', now, now);
  try {
    await assert.rejects(() => deleteWorkspace(WKEY), (e) => e.code === 'RETAINED_WORKTREE');
    await discardRetainedWorktrees({ workspaceKey: WKEY, id: 'retainwd' });
    const after = await deleteWorkspace(WKEY);
    assert.equal(after.ok, true, 'delete succeeds once the retention is resolved');
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});
```

(Match `freshWorkspaceStore`'s real option shape to the existing workspace discard test in this suite.)

(b) Route (append to `test/delete-pipeline-api.test.mjs`; pins the 409 mapping — a mutation audit showed removing it kept every suite green. `retainedWorkFor` only needs the worktree dir to EXIST, so no git fixture is required. Verified: `seedPipelineRow` HAS workspace options — `workspaceKey`, `target`, `workspaceMeta` — and the suite uses raw `fetch` with a module-scope `base`):

```js
test('DELETE /api/workspaces/:id returns 409 while a member has retained uncommitted work', async () => {
  const WKEY = 'wks-apidel-0000ab12';
  const wt = join(home, 'retained-apidel');
  await mkdir(wt, { recursive: true });
  const now = new Date().toISOString();
  getDb().prepare('INSERT INTO workspaces (id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(WKEY, 'Api Del', '', now, now);
  seedPipelineRow({
    id: 'wd', projectKey: KEY, workspaceKey: WKEY, target: 'workspace', title: 'WS del',
    status: 'done', baseName: 'ws-del', datePrefix: '04-06-26',
    workspaceMeta: { branches: { 'proj-0000aaaa': {
      feature: 'worca/x', worktreeDir: wt,
      commitFailed: { code: 'commit_failed', step: 'commit', message: 'hook' },
    } } },
  });
  const res = await fetch(`${base}/api/workspaces/${WKEY}`, { method: 'DELETE' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /retained uncommitted work/);
});
```

- [ ] **Step 2: Run — (a) FAILS with `RETAINED_WORKTREE` unmet (delete succeeds today once the fixture is valid); (b) FAILS (200/500 today).**

- [ ] **Step 3: Implement.**

1. In `deleteWorkspace`, after the membership check (`:318-320`) and before the `rm(workspaceStorePath(id), …)` at `:324`:

```js
  // Never orphan retained uncommitted work: deleting the store removes the
  // pipeline dir the discard flow needs for its recovery patch, wedging the run.
  const memberRows = prepare(
    'SELECT * FROM pipelines WHERE workspace_key = ? AND archived_at IS NULL',
  ).all(id);
  for (const memberRow of memberRows) {
    if (retainedWorkFor(memberRow)) {
      throw err(
        `workspace has retained uncommitted work (pipeline ${memberRow.id}); recover or discard it first — ` +
        'and copy any retained-work*.patch out of the workspace store before deleting, deletion removes it',
        'RETAINED_WORKTREE',
      );
    }
  }
```

(`prepare` is the module's cached-statement helper from `./db.mjs` — the correct in-file idiom. Add `retainedWorkFor` to the EXISTING `./artifacts.mjs` import at `workspaces.mjs:29`. `retainedWorkFor` works on raw DB rows and is existsSync-self-clearing, so delete-after-manual-cleanup works even without discard.)

2. In `ui/server.mjs`, extend `workspaceErrorStatus` (ONE line — both workspace routes then agree; no per-route catch):

```js
function workspaceErrorStatus(code) {
  if (code === 'DUPLICATE_NAME' || code === 'DUPLICATE_SET') return 409;
  if (code === 'RETAINED_WORKTREE') return 409;   // retained uncommitted work blocks deletion
  if (code === 'NOT_FOUND') return 404;
  if (code === 'BAD_REQUEST') return 400;
  return 500;
}
```

- [ ] **Step 4: Run `test/pipeline-delete.test.mjs`, `test/delete-pipeline-api.test.mjs`, `test/workspaces.test.mjs`, `test/workspaces-db.test.mjs`, `test/workspaces-api.test.mjs` — all PASS** (verified: the pre-existing `deleteWorkspace` fixtures — including `workspaces-api`'s, the only suite driving the DELETE route — have no member pipelines, so the new loop is a no-op there).
- [ ] **Step 5: Commit** — `fix(workspaces): refuse deletion while retained uncommitted work exists`

---

### Task 15: UI respects a failed discard and stops lying (UI half of F3 + F7)

**Files:**
- Modify: `ui/public/app.js` (`setupDiscardWorktreeButton`, `renderRetainedWork`)
- Test: `test/ui-history-delete.test.mjs`

The partial-failure card stays correct **by construction**: on `remaining > 0` the handler returns before `p.retainedWork = null`, nothing repaints, and `writeHistoryCache` is never called — badge, banner, and the disabled Archive button were all painted from `p.retainedWork`. A WS-driven refresh repaints from fresh server data, where the live checkout still shows as retained. `showViewer(title, text)` hard-prefixes titles with `"Saved: "` — accept it (the shipped success message has the same quirk); do NOT refactor `showViewer` in this plan.

- [ ] **Step 1: Failing tests** (append to `test/ui-history-delete.test.mjs`)

```js
test('a failed discard keeps the banner, the badge, the Archive block — and lets the user retry', async () => {
  const row = { ...FIN, retainedWork: RETAINED };
  const { window, showHistory } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/discard-worktree')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({ ok: true, discarded: false, remaining: 1,
            patches: ['/store/p1/retained-work.patch'],
            warnings: ['proj-0000abcd: worktree still exists at /tmp/retained-p1'] }),
        });
      }
      if (url.includes('/api/history')) return runs([row], false);
      return null;
    },
  });
  window.confirm = () => true;
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  window.document.querySelector('.hist-discard').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  assert.equal(card.querySelector('.hist-retained-badge').hidden, false, 'badge stays');
  assert.equal(card.querySelector('.hist-delete').disabled, true, 'Archive stays blocked');
  const discardBtn = card.querySelector('.hist-discard');
  assert.equal(discardBtn.disabled, false, 'the user can retry');
  assert.match(discardBtn.textContent, /Discard/);
  assert.match(window.document.querySelector('#viewer').textContent, /worktree still exists/);
});

test('the banner explains how to clear the warning after a manual commit', async () => {
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? runs([{ ...FIN, retainedWork: RETAINED }], false) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const banner = window.document.querySelector('#history .retained-banner');
  assert.match(banner.textContent, /After committing manually, use .*Discard worktree/i);
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement.** In `setupDiscardWorktreeButton`'s click handler, replace the success tail (from the `fetch` line at `:7970` through the `showViewer(...)` call; the button-restore uses the handler's existing `previous` variable, `:7966`):

```js
      const res = await fetch(`/api/runs/${encodeURIComponent(p.id)}/discard-worktree?${qs}`, { method: 'POST' });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
      if (data.remaining > 0) {
        // Partial failure: the checkout is still on disk, so the retained state
        // is still true — repaint nothing away, tell the user what happened.
        btn.disabled = false;
        btn.textContent = previous;
        showViewer('Discard incomplete',
          'The retained worktree could not be fully removed:\n\n' +
          `${Array.isArray(data.warnings) && data.warnings.length ? data.warnings.join('\n') : 'unknown error'}\n\n` +
          'The retained-work warning stays until the checkout is gone.');
        return;
      }
      p.retainedWork = null;
      writeHistoryCache(state.historyAll, state.ghAvailable);
      paintHistory();
      const paths = Array.isArray(data.patches) ? data.patches : [];
      showViewer('Retained worktree discarded', paths.length
        ? `Recovery patch${paths.length === 1 ? '' : 'es'} saved before removal:\n\n${paths.join('\n')}`
        : 'No recovery patch was needed (nothing uncommitted remained to save); the retained checkout is gone.');
```

In the same handler, replace the confirm message (F7 — remove the unconditional lie):

```js
    const msg = 'Discard the retained worktree?\n\nAny work NOT yet committed exists only in the retained worktree; a recovery patch of uncommitted changes will be saved in the pipeline directory before anything is removed. If you already committed the work manually, discarding just removes the now-redundant checkout and clears the warning. The pipeline history and feature branch are kept.\n\nContinue?';
```

In `renderRetainedWork`, add the post-commit guidance and extend the ONE existing final `banner.append(...)` call (do not append twice). The staged-index sentence is required — Task 12's snapshot makes the staging certain rather than incidental:

```js
  const clearNote = document.createElement('p');
  clearNote.textContent = 'After committing manually, use "Discard worktree" to remove the now-redundant checkout and clear this warning (a patch of anything still uncommitted is saved first). Your changes are already staged in that checkout, so git status will list them under "Changes to be committed".';
  banner.append(title, intro, list, archiveNote, clearNote);
```

- [ ] **Step 4: Update the pre-existing fixtures/regexes in `test/ui-history-delete.test.mjs`:**

1. In the `discard saves a patch, clears the warning, and re-enables Archive` test, update the mocked discard response to the post-Task-9 contract: `{ ok: true, discarded: true, remaining: 0, patches: [...] }`. (Without `remaining` in the fixture, an off-by-one `>= 0` guard passes the suite while breaking every real discard — mutation-audit finding.)
2. Regex edits, literal before → after:
   - `/recovery patch will be saved/` → `/recovery patch of uncommitted changes will be saved/` (**mandatory** — the old regex no longer matches).
   - `/exists only in the retained worktree/` → may stay (the substring survives in the new copy); tighten to `/NOT yet committed exists only in the retained worktree/` only if you re-run the suite after.

- [ ] **Step 5: Run `test/ui-history-delete.test.mjs` — all PASS.**
- [ ] **Step 6: Commit** — `fix(ui): truthful discard outcome + post-manual-commit guidance`

---

### Task 16: Never cache the live retention fact; revert the cache bump (F9)

**Files:**
- Modify: `ui/public/app.js:7393-7394` (`HISTORY_CACHE_KEY`/`VER`), `:7412` (`writeHistoryCache`)
- Modify: `test/ui-history-cache.test.mjs` (revert the v2 edits from `4f2901a2`)
- Test: `test/ui-history-cache.test.mjs`

Safety (verified): the v2 cache key was BORN in this unmerged commit — no deployed user ever wrote a v2 blob, so reverting re-adopts the pre-PR v1 blob instead of orphaning it (the point of F9). Pre-PR v1 rows simply lack `retainedWork`, and every consumer is falsy-safe.

- [ ] **Step 1: Failing test** (append; mirror the structure of the `writeHistoryCache strips the live \`pr\` field before persisting` test — it settles via `ctx.tick()`; `ctx.settle()` also works)

```js
test('writeHistoryCache strips the live retainedWork field before persisting', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.endsWith('/api/history')
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: [
          { id: 'r1', projectKey: 'k1', title: 'R', status: 'done', startedAt: '2026-01-01T00:00:00Z',
            retainedWork: { reason: 'commit_failed', members: [{ worktreeDir: '/tmp/x' }] } },
        ], ghAvailable: false }) })
      : null),
  });
  ctx.showHistory();
  await ctx.settle();
  const parsed = JSON.parse(ctx.window.localStorage.getItem(CACHE_KEY));
  assert.ok(parsed.pipelines.every((row) => !('retainedWork' in row)),
    'retainedWork is a live existsSync-derived fact; caching it paints stale banners');
});
```

- [ ] **Step 2: Run — FAIL** (`retainedWork` persisted today).

- [ ] **Step 3: Implement.**

In `app.js`, revert the bump (no persisted shape change remains once the field is stripped):

```js
const HISTORY_CACHE_KEY = 'worca-cc.history.cache.v1';
const HISTORY_CACHE_VER = 1;
```

and strip the live field:

```js
    const slim = pipelines.slice(0, HISTORY_CACHE_MAX)
      .map(({ pr, retainedWork, ...rest }) => rest); // never persist live PR or retention facts
```

In `test/ui-history-cache.test.mjs`, revert `4f2901a2`'s four edits exactly (verified complete list): `CACHE_KEY` back to `'worca-cc.history.cache.v1'` (`:15`), the comment back to `Pre-seed a valid v1 cache` (`:68`), the seeded blob back to `v: 1` (`:70`), the assertion back to `parsed.v === 1` (`:131`). Do NOT touch the OTHER seeded blob (`:101`, `v: 0`) — that is the deliberate version-bust fixture and needs no edit for the VER=1 revert.

- [ ] **Step 4: Run `test/ui-history-cache.test.mjs` + `test/ui-history-delete.test.mjs` — all PASS.**
- [ ] **Step 5: Commit** — `fix(ui): keep retention out of the history cache; revert the needless v2 bump`

---

### Task 17: Cleanups C1 + C2 (C3 already done in Task 12)

**Files:**
- Modify: `ui/server.mjs` (shared scope resolver for the two NEW routes), `src/core/artifacts.mjs` (`listWorkspacePipelines` delegation)
- Test: `test/delete-pipeline-api.test.mjs` (+ the suites in Step 5)

Scope decision (deliberate): the preamble is TRIPLICATED (`DELETE /api/runs/:id` at `:1297-1311`, recovery-patch, discard). The resolver covers the two NEW routes only. The DELETE route keeps its inline copy as an **accepted residual against C1**: it shadows the imported `projectKey()` with a local const, never derives a store key, and maps `RETAINED_WORKTREE` — folding it in would change behavior for a P-low cleanup.

- [ ] **Step 1: Failing test — pin the resolver's guards first** (append to `test/delete-pipeline-api.test.mjs`; a mutation audit showed the projectKey shape check — a path-traversal guard — and the missing-scope 400 could both be dropped silently across this refactor):

```js
test('run-scope guards: bad projectKey shape is 404 and missing scope is 400 on both retained-work routes', async () => {
  for (const [method, path] of [['GET', 'recovery-patch'], ['POST', 'discard-worktree']]) {
    const bad = await fetch(`${base}/api/runs/pp/${path}?projectKey=..%2Fevil`, { method });
    assert.equal(bad.status, 404, `${path}: malformed projectKey must 404`);
    const none = await fetch(`${base}/api/runs/pp/${path}`, { method });
    assert.equal(none.status, 400, `${path}: missing scope must 400`);
  }
  // Pin the shape guard ITSELF: with a row whose project_key IS the traversal
  // string, the lookup SUCCEEDS, so only the guard can stop the request. Without
  // it the POST returns 200 and the GET's 404 message degrades to
  // 'recovery patch not found' — the bare status does NOT distinguish the two.
  seedPipelineRow({ id: 'trav', projectKey: '../evil', title: 'Traversal',
    status: 'stopped', baseName: 'trav', datePrefix: '04-06-26' });
  for (const [method, path] of [['GET', 'recovery-patch'], ['POST', 'discard-worktree']]) {
    const res = await fetch(`${base}/api/runs/trav/${path}?projectKey=..%2Fevil`, { method });
    assert.equal(res.status, 404, `${path}: a traversal projectKey must never resolve`);
    assert.match((await res.json()).error, /pipeline not found/,
      `${path}: rejected by the shape guard, not incidentally by a lookup miss`);
  }
});
```

(The first loop is a characterization pass and PASSES already — if it fails today, stop and read the routes. The traversal block is the real pin: verified green with the guard and red without it, in both directions.)

- [ ] **Step 2: Extract the resolver** (module scope, near the routes; helpers verified in scope: `resolveProjectDir`, `WORKSPACE_KEY_RE`, `badRequest`, `projectKey`):

```js
// Shared query-scope resolver for the retained-work routes (recovery-patch GET +
// discard POST). Returns null after writing the error response itself. The older
// DELETE /api/runs/:id route keeps its inline copy DELIBERATELY (it shadows the
// imported projectKey(), derives no store key, and maps RETAINED_WORKTREE).
function resolveRunScope(req, res) {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId.trim() : '';
  const projectKey_ = typeof req.query.projectKey === 'string' ? req.query.projectKey.trim() : '';
  const projectDir = resolveProjectDir(req.query.projectDir);
  if (workspaceId && !WORKSPACE_KEY_RE.test(workspaceId)) {
    res.status(404).json({ error: 'pipeline not found' });
    return null;
  }
  if (projectKey_ && !/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(projectKey_)) {
    res.status(404).json({ error: 'pipeline not found' });
    return null;
  }
  if (!workspaceId && !projectKey_ && !projectDir) {
    badRequest(res, 'workspaceId, projectKey or projectDir is required');
    return null;
  }
  const key = workspaceId ? `workspaces/${workspaceId}` : (projectKey_ || projectKey(projectDir));
  return { workspaceId, projectKey: projectKey_, projectDir, key };
}
```

Both routes then start with `const scope = resolveRunScope(req, res); if (!scope) return;`. In the recovery-patch route, the old inline `key` derivation dies but its body (installed by Task 12) still reads a local `key` — so the route's preamble becomes exactly:

```js
  const scope = resolveRunScope(req, res);
  if (!scope) return;
  const key = scope.key; // the body's readRunArtifactText(key, …) calls stay unchanged
```

The discard route maps `workspaceKey: scope.workspaceId || null`, `key: scope.workspaceId ? null : (scope.projectKey || null)`, `projectDir: (scope.workspaceId || scope.projectKey) ? null : scope.projectDir` exactly as before.

- [ ] **Step 3: C2 — delegate `listWorkspacePipelines`.** Verified safe and byte-equivalent: `artifactPaths(null, workspaceKey)` short-circuits to `workspaceStorePath(workspaceKey)` without touching `projectDir`; same SELECT, binding, enrichment, and sort. Replace `listWorkspacePipelines`'s body with:

```js
  return listPipelines(primaryDir, opts, workspaceKey);
```

(keeping its signature `(workspaceKey, primaryDir = null, opts = {})` and JSDoc).

- [ ] **Step 4: C3 check** — Task 12 already imports and uses `DIFF_PATCH_FILE` in the recovery-patch route. Verify no `'diff-patch.patch'` string literal remains in `ui/server.mjs` (`grep -n "'diff-patch.patch'" ui/server.mjs` → no hits).

- [ ] **Step 5: Run `test/delete-pipeline-api.test.mjs`, `test/ui-history-delete.test.mjs`, the workspace list suites, AND `test/read-pipeline-by-key.test.mjs` — all PASS.** (`read-pipeline-by-key` is the only suite that catches a botched C2 delegation — verified by mutation.)
- [ ] **Step 6: Commit** — `refactor(server): shared run-scope resolver; listWorkspacePipelines delegates to listPipelines`

---

### Task 18: Full-suite gate + PR update

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Pass bar: only the 4 baseline failures, judged by NAME (see Global Constraints), plus the `api-sources` flake rule. Dry-run verified: the corrected plan lands at exactly the 4 baseline failures. Note: `test/run-root-teardown.test.mjs` runs ~2× longer than before (Task 5's immediate persist) — expected.

- [ ] **Step 2: Mutation spot-checks (Appendix A).** Run the table below — every listed mutation must now make the named suite go RED. This is the plan's own review armor; a GREEN row means a test from this plan regressed.

- [ ] **Step 3: Push and update the PR description** — append the note below to PR #364's description WITHOUT clobbering it:

```bash
gh pr view 364 --json body -q .body > /tmp/pr364-body.md
printf '\n\n%s\n' "<the note below>" >> /tmp/pr364-body.md
gh pr edit 364 --body-file /tmp/pr364-body.md
```

> Hardening pass from review: archive and workspace-delete guards now trust both retention representations, failing closed only while something destroyable still exists (no permanent wedges); discard reports partial failures truthfully, honors the manifest ledger when the DB stamp was lost, and clears retention via a targeted column update instead of rewriting the row; a durable crash-safe recovery patch is written the moment work is retained and served honestly (including for error/stopped and workspace runs); a vanished worktree is a clean no-op instead of a phantom retention; snapshot streams to disk with the slow git timeout; retention state is synthesized and persisted immediately even without a branch record; plus the ui-history badge test fix and the cache-bump revert.

- [ ] **Step 4: Do NOT merge** — leave the branch for review. Known accepted follow-up (out of scope, noted in the spec): Archive still deletes the feature branch (N1, pre-existing semantics).

---

## Appendix A — Mutation spot-checks (each must be RED)

| Mutation (revert/one-line break) | Suite that must fail |
|---|---|
| Task 2: restore the swallowing `catch { }` in the sweep | `run-root-layout` |
| Task 3: delete the `SNAPSHOT_FAILED → 409` line | `delete-pipeline-api` |
| Task 4: `if (!existsSync(cwd))` → `if (false)` | `run-root-teardown` |
| Task 5: delete the direct-`writeState` persist block | `run-root-teardown` (immediate-persist test) |
| Task 5: synthesize `target` but don't attach it to state | `run-root-teardown` |
| Task 6: drop the `!anyRetained` mirror guard | `run-root-teardown` |
| Task 7: delete the manifest-retain guard block | `pipeline-archive` |
| Task 7: drop `existsSync(m.worktreeDir)` from the manifest guard | `pipeline-archive` (self-clearing test) |
| Task 8: revert `snapshotWorktreePatch` to the old `(worktreeDir)` in-memory signature | `pipeline-delete` (both snapshot tests) |
| Task 9: `report.discarded = true` hardcode | `pipeline-delete` (surviving-checkout test) |
| Task 9: delete `report.remaining += 1` | `pipeline-delete` (surviving-checkout test) |
| Task 10: restamp `updated_at` in the targeted tx | `pipeline-delete` |
| Task 11: remove the manifest fallback in discard | `pipeline-delete` (manifest-only test) |
| Task 12: remove `_snapshotRetained` from `_teardownRunRoot` | `run-root-teardown` |
| Task 12: route ignores the retained-work index row | `delete-pipeline-api` (preference test) |
| Task 12: `_snapshotRetained` drops the workspace key suffix | `run-root-teardown` (suffix test) |
| Task 12: revert the `addRecoveryPatchLink` rewrite | `ui-history-diff-overview` (banner-link test) |
| Task 13: `findRunDir` regex loses the `'i'` flag | `pipeline-delete` |
| Task 14: remove the `retainedWorkFor(memberRow)` guard | `pipeline-delete` |
| Task 14: remove `RETAINED_WORKTREE` from `workspaceErrorStatus` | `delete-pipeline-api` (workspace 409 test) |
| Task 15: `if (data.remaining > 0)` → `if (data.remaining >= 0)` | `ui-history-delete` (post-fixture-update) |
| Task 15: drop the button restore in the partial-failure branch | `ui-history-delete` |
| Task 15: drop `clearNote` from the banner append | `ui-history-delete` (banner-copy test) |
| Task 16: stop stripping `retainedWork` | `ui-history-cache` |
| Task 17: resolver drops the projectKey shape check | `delete-pipeline-api` (guards test — its TRAVERSAL block; the characterization loop alone cannot catch this) |

## Appendix B — Accepted residuals (documented, deliberate)

1. **Task 8:** the `{ timeout: SLOW_GIT_TIMEOUT_MS }` value itself is untestable without stubbing `git()` — pinned by code review + this plan only.
2. **Task 11:** manifest-only retention stays invisible to the history UI (badge/banner/Discard button); it is reachable via archive's 409 message and the discard API. Enriching the sync list path with async manifest reads is out of scope.
3. **Task 17:** the DELETE route's third copy of the scope preamble remains (behavior differences documented in the task).
4. **Task 10:** non-8-hex TEST fixtures lose discard's trailing audit line (`rememberDir` no longer seeded by `writeState`); production ids are 8-hex and unaffected.
5. **Task 9:** the chmod-based surviving-checkout test self-skips under root (chmod is inert there — Docker/CI-as-root would otherwise invert it).
6. **F7 residual:** after a manual commit, the badge/banner/Archive-block persist until the user clicks Discard (`retainedWorkFor` still sees `commitFailed` + a live checkout). The copy now explains the exit and the clean-tree discard succeeds (Task 8), but the state does not clear itself.
7. **Task 17:** dropping the resolver's missing-scope `badRequest` makes requests HANG rather than fail (a null return with no response written) — the resolver must always write a response before returning null; the comment says so.
8. **N1** (spec): Archive still deletes the feature branch — pre-existing semantics, decide separately.
