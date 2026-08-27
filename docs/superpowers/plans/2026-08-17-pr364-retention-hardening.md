# PR #364 Retention Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 15 review findings + 1 design gap in PR #364 (`4f2901a2`, branch `fix/retain-worktree-on-commit-failure`) so the retained-worktree feature's own no-data-loss promise holds on every path.

**Architecture:** Keep PR #364's architecture unchanged (retain checkout on teardown commit failure; manifest + DB retention records; sweep keep; archive block; discard-with-patch exit). This plan only hardens it: every guard reads BOTH retention representations, retention is persisted immediately and always machine-readable, discard reports the truth, a durable patch is written at retention time, and the UI copy stops lying.

**Tech Stack:** Node ESM (`.mjs`), better-sqlite3, node:test, JSDOM UI tests, Express, vanilla-JS UI.

**Spec:** `docs/superpowers/specs/2026-08-17-pr364-retained-worktree-review.md` (findings F1–F15, D1, C1–C3 referenced below).

## Global Constraints

- Work on branch `fix/retain-worktree-on-commit-failure`; commits go on top of `4f2901a2`. Never commit `docs/` (plans/specs stay untracked — repo rule).
- Test command pattern: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/<file>.mjs`
- Full-suite pass bar: `npm test` = only the 4 pre-existing imagegen-skill failures (baseline), nothing else red.
- All UI strings assigned via `textContent` (git stderr and paths are data, never markup) — the PR's convention, keep it.
- `retainedWorkFor` stays existsSync-self-clearing; retention stays orthogonal to run `status`. Do not change either contract.
- Before editing any function, re-read it first — line numbers below are from `4f2901a2` and drift as tasks land.

---

### Task 1: Fix the `ui-history.test.mjs` badge regression (F1)

**Files:**
- Modify: `test/ui-history.test.mjs:122-126`

The template legitimately gained a second, hidden `.badge` per card (`hist-retained-badge`). Fix the old test's selector to target status badges only. Test-only change — run it red first to see the current failure, then green after the edit.

- [ ] **Step 1: Run the failing test**

Run: `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history.test.mjs`
Expected: FAIL `history renders 2 .hist-card divs…` — `badges[1]` is `'Work retained'`, expected `'STOPPED'`.

- [ ] **Step 2: Fix the selector**

In `test/ui-history.test.mjs` replace:

```js
  const badges = [...doc.querySelectorAll('#history .badge')];
```

with:

```js
  // Status badges only: each card also carries a hidden .hist-retained-badge.
  const badges = [...doc.querySelectorAll('#history .badge:not(.hist-retained-badge)')];
```

- [ ] **Step 3: Re-run — PASS (15/15).**

- [ ] **Step 4: Commit**

```bash
git add test/ui-history.test.mjs
git commit -m "test(ui): scope history badge assertions past the hidden retained badge"
```

---

### Task 2: Stop swallowing `retainOf` throws in the sweep (F5)

**Files:**
- Modify: `src/core/worktree.mjs:446-448` (inside `sweepRunRoots`)
- Test: `test/run-root-layout.test.mjs`

**Interfaces:**
- Consumes: existing `sweepRunRoots` per-root try/catch (a thrown lookup already lands in `out.failed` and skips the root — same handling `statusOf` gets).

- [ ] **Step 1: Write the failing test** (append to `test/run-root-layout.test.mjs` next to the other `sweep: …retain…` tests)

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
});
```

- [ ] **Step 2: Run it — FAIL** (today the catch swallows the throw and the `done` root is removed).

- [ ] **Step 3: Remove the swallow.** In `sweepRunRoots`, replace:

```js
    if (!retained && typeof retainOf === 'function') {
      try { retained = await retainOf(id); } catch { /* status lookup already classified the row */ }
    }
```

with (the surrounding per-root handling already treats a lookup throw as "skip untouched, log loudly" — same as `statusOf`):

```js
    // No catch, by the same three-state doctrine as statusOf/membersOf:
    // "retention unknown" must never collapse into "remove".
    if (!retained && typeof retainOf === 'function') {
      retained = await retainOf(id);
    }
```

Then verify the enclosing loop really has the per-root try/catch that `statusOf` throws rely on (`runRootSweepLookups` doc: "the throw reaches sweepRunRoots, which skips that run root untouched and logs loudly"). If the `retainOf` call site is OUTSIDE that try block, wrap it so the throw lands in the same skip-and-log path (pushing the dir to `out.failed`), NOT so it aborts the whole sweep.

- [ ] **Step 4: Run `test/run-root-layout.test.mjs` — all PASS.**

- [ ] **Step 5: Commit** — `fix(sweep): retention-unknown skips the run root instead of removing it`

---

### Task 3: Map `SNAPSHOT_FAILED` to 409 (F12)

**Files:**
- Modify: `ui/server.mjs:1368-1372` (discard route catch)
- Test: `test/delete-pipeline-api.test.mjs`

- [ ] **Step 1: Failing test** (append; reuse the suite's `discard` helper and DB handle)

```js
test('discard-worktree maps SNAPSHOT_FAILED to 409 with the actionable message', async () => {
  const retained = join(home, 'retained-snapfail');
  await mkdir(retained, { recursive: true });
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify({
    worktreeDir: retained, feature: 'worca/x',
    commitFailed: { code: 'commit_failed', step: 'commit', message: 'hook failed' },
  }), 'pp');
  // Remove the run dir so findRunDir returns null -> discard throws SNAPSHOT_FAILED.
  await rm(join(home, '.worca-cc', 'store', KEY, 'pipelines', '04-06-26-my-feature-pp'),
    { recursive: true, force: true });
  const res = await discard('pp', `projectKey=${KEY}`);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /recovery patch/);
  getDb().prepare('UPDATE pipelines SET branch = NULL WHERE id = ?').run('pp');
});
```

NOTE: this test deletes the suite's shared pipeline dir — place it AFTER the `recovery-patch route downloads…` test and BEFORE the final `200 removes the pipeline dir…` test, and re-create the dir + `prompt.md` + `diff-patch.patch` after the assertion if any later test needs them (check neighbors; re-create with the same `mkdir`/`writeFile` calls the suite's `before` hook uses if so).

- [ ] **Step 2: Run — FAIL (500 today).**

- [ ] **Step 3: Add the mapping.** In the discard route's catch, after the `RUNNING` line:

```js
    if (e && e.code === 'SNAPSHOT_FAILED') return res.status(409).json({ error: e.message });
```

- [ ] **Step 4: Run `test/delete-pipeline-api.test.mjs` — all PASS.**
- [ ] **Step 5: Commit** — `fix(api): surface discard snapshot failures as 409, not 500`

---

### Task 4: Retention is always machine-readable and durable immediately (F6 + persist half of F2)

**Files:**
- Modify: `src/core/orchestrator.mjs:1622-1650` (`_recordCommitFailure`)
- Test: `test/run-root-teardown.test.mjs`

**Interfaces:**
- Produces: `_recordCommitFailure` still returns `Promise<boolean>`; NEW guarantees: (a) a branch record carrying `commitFailed` ALWAYS exists afterwards (synthesized if missing), (b) the DB row is persisted before it returns (loud log on failure, still returns `true`).

- [ ] **Step 1: Failing test** (append to `test/run-root-teardown.test.mjs`)

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
```

- [ ] **Step 2: Run — FAIL** (`orch.state.branch` stays null today).

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
      target = { feature: info?.branch || null, worktreeDir: info?.worktreeDir || null };
      if (this.isWorkspace && key != null) {
        this.state.branches = this.state.branches || {};
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
    // retention stamp must not ride on it (F2's crash window).
    try {
      await this._persist();
    } catch (e) {
      this._log('git', 'error',
        `retention stamp could not be persisted (${e?.message || e}); ` +
        'the run.json retain record is the only durable copy');
    }
    return true;
  }
```

Notes for the implementer: `this.isWorkspace` is the orchestrator's existing workspace flag (used by `_teardownRunRoot`'s branchRecord selection — verify the exact property name there and reuse it verbatim). The synthesized single-project record intentionally REPLACES a null `state.branch` only — never overwrite a non-null one.

- [ ] **Step 4: Run `test/run-root-teardown.test.mjs` — all PASS** (both existing commit-failure tests still green: they assert the persisted DB row, which the new immediate persist only strengthens).

- [ ] **Step 5: Commit** — `fix(pipeline): synthesize + immediately persist the retention record`

---

### Task 5: Guard the legacy-workspace scalar mirror (F13)

**Files:**
- Modify: `src/core/orchestrator.mjs:1416-1457` (`_teardownWorktreeAll`)
- Test: `test/run-root-teardown.test.mjs`

- [ ] **Step 1: Failing test**

```js
test('legacy workspace: the scalar mirror is NOT stamped removed while a member is retained', async () => {
  const repo = await freshRepo();
  await withMode('legacy', async () => {
    const orch = createOrchestrator({
      projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    const realGit = orch._git.bind(orch);
    orch._git = (args, opts) => {
      const msgAt = args.indexOf('-m');
      if (args.includes('commit') && msgAt >= 0 && String(args[msgAt + 1] || '').startsWith('worca:')) {
        return Promise.resolve({ ok: false, code: 1, stdout: '', stderr: 'legacy commit failure' });
      }
      return realGit(args, opts);
    };
    await orch.run();
    const st = orch.getState();
    // Single-project legacy runs route through _teardownWorktree; force the
    // workspace path shape instead: state.branch mirrors the primary member.
    // If constructing a real legacy WORKSPACE run is impractical with the mock
    // harness, unit-test the invariant directly (see note below).
    assert.notEqual(st.branch.worktreeRemoved, true,
      'a retained checkout must never be recorded as removed');
  });
});
```

Note: if the mock harness cannot produce a legacy *workspace* run end-to-end, test the invariant at the unit level instead — call `_teardownWorktreeAll` on an orchestrator with `branchInfos` seeded for one member whose `_commitWork` is stubbed to `{ ok: false, step: 'commit', message: 'x' }`, and assert `state.branch.worktreeRemoved !== true`. Either shape is acceptable; the assertion is the deliverable.

- [ ] **Step 2: Run — FAIL** (unconditional stamp at `:1450`).

- [ ] **Step 3: Implement.** In `_teardownWorktreeAll`, track retention and guard the mirror (mirror of the detached twin at `:1555`):

```js
  async _teardownWorktreeAll() {
    if (this.branchInfos.size === 0) return;
    const entries = [...this.branchInfos.entries()]; // [projectKey, info]
    this.branchInfos = new Map(); // guard against a double teardown
    let anyRetained = false;
    for (const [projectKey_, info] of entries) {
      if (!info || !info.worktreeDir) continue;
      const branchRecord = (this.state.branches && this.state.branches[projectKey_]) || null;
      const commit = await this._commitWork(info, branchRecord);
      if (await this._recordCommitFailure(commit, { key: projectKey_, info, branchRecord })) {
        anyRetained = true;
        this.workDirs.delete(projectKey_);
        continue;
      }
      // … (rest of the loop unchanged) …
    }
    // Keep the scalar mirror coherent for late observers — but never claim a
    // retained checkout was removed (the detached twin has the same guard).
    if (this.state.branch && !anyRetained) {
      this.state.branch.worktreeRemoved = true;
      this.state.branch.branchKept = true;
    }
    this.branchInfo = null;
    this.workDir = this.projectDir;
    await this._persist().catch(() => {});
  }
```

- [ ] **Step 4: Run `test/run-root-teardown.test.mjs` — PASS.**
- [ ] **Step 5: Commit** — `fix(pipeline): don't stamp the scalar mirror removed while a member is retained`

---

### Task 6: Archive guard reads the manifest too; corrupt meta fails closed (guard half of F2 + F10)

**Files:**
- Modify: `src/core/pipeline-delete.mjs:103-108` (guard block in `archivePipeline`)
- Test: `test/pipeline-archive.test.mjs`

**Interfaces:**
- Consumes: `readRunManifest`, `worcaHome`, `join`, `existsSync` (all already imported in `pipeline-delete.mjs` post-#364).

- [ ] **Step 1: Failing tests** (append to `test/pipeline-archive.test.mjs`; add imports `mkdir` from `node:fs/promises`, `writeRunManifest, updateRunManifest` from `../src/core/run-manifest.mjs`, `worcaHome` from `../src/core/projects.mjs`)

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

test('archive refuses a workspace row whose workspace_meta is unreadable (fail closed)', async () => {
  const { id } = await seedPipeline('/tmp/proj-a', { status: 'done' });
  getDb().prepare("UPDATE pipelines SET target = 'workspace', workspace_meta = '{broken' WHERE id = ?").run(id);
  await assert.rejects(() => archivePipeline({ projectDir: '/tmp/proj-a', id }),
    (e) => e.code === 'RETAINED_WORKTREE');
});
```

- [ ] **Step 2: Run — both FAIL** (archive passes today).

- [ ] **Step 3: Implement.** Replace the guard block in `archivePipeline` with:

```js
  // UI state is advisory. Enforce the no-data-loss rule here as well, because a
  // stale client or a direct API caller could otherwise force-remove the very
  // checkout that was retained after its commit failed.
  if (retainedWorkFor(row)) {
    throw err('cannot archive while retained uncommitted work exists; recover it or discard the worktree first', 'RETAINED_WORKTREE');
  }
  // Fail CLOSED on unreadable workspace metadata: retention cannot be ruled out.
  if (row.target === 'workspace' && typeof row.workspace_meta === 'string' && row.workspace_meta.trim()) {
    let parsed = null;
    try { parsed = JSON.parse(row.workspace_meta); } catch { /* unreadable */ }
    if (parsed === null) {
      throw err('cannot archive: workspace metadata is unreadable, so retained uncommitted work cannot be ruled out', 'RETAINED_WORKTREE');
    }
  }
  // The DB stamp is teardown's LAST best-effort write; the run.json retain block
  // is written earlier. Trust either representation (the sweep already does).
  const guardRunRoot = join(worcaHome(), 'runs', row.id);
  if (existsSync(guardRunRoot)) {
    const guardManifest = await readRunManifest(guardRunRoot);
    const members = Array.isArray(guardManifest?.retain?.members) ? guardManifest.retain.members : [];
    if (members.some((m) => m?.worktreeDir && existsSync(m.worktreeDir))) {
      throw err('cannot archive while retained uncommitted work exists; recover it or discard the worktree first', 'RETAINED_WORKTREE');
    }
  }
```

- [ ] **Step 4: Run `test/pipeline-archive.test.mjs` + `test/delete-pipeline-api.test.mjs` — all PASS.**
- [ ] **Step 5: Commit** — `fix(archive): trust the manifest retain record and fail closed on unreadable meta`

---

### Task 7: Discard reports the truth (server half of F3)

**Files:**
- Modify: `src/core/pipeline-delete.mjs` (`discardRetainedWorktrees`)
- Test: `test/delete-pipeline-api.test.mjs`, `test/pipeline-delete.test.mjs`

**Interfaces:**
- Produces: discard report gains `remaining: number` (count of retained worktrees still on disk after the attempt) and `discarded` is now `true` ONLY when every retained member's checkout is gone. No-op keeps `{discarded:false, remaining:0}`. HTTP status unchanged (200).

- [ ] **Step 1: Failing tests**

Append to `test/pipeline-delete.test.mjs` (inside the existing single-project discard test, after the current assertions):

```js
    assert.equal(report.remaining, 0, 'nothing left retained after a full discard');
```

Append to `test/delete-pipeline-api.test.mjs` (in the idempotent-200 discard test, after `body.discarded === false`):

```js
  assert.equal(body.remaining, 0, 'a no-op discard leaves nothing retained');
```

- [ ] **Step 2: Run — FAIL** (`remaining` is undefined).

- [ ] **Step 3: Implement.** In `discardRetainedWorktrees`:

1. Change the no-op short-circuit object to include `remaining: 0`:

```js
    return { ok: true, id: row.id, discarded: false, remaining: 0, worktrees: [], patches: [], runRoot: null, warnings: [] };
```

2. Change the report construction — build it without `discarded`, count failures, and derive `discarded` at the end:

```js
  const report = {
    ok: true, id: row.id, discarded: false, remaining: 0, worktrees: [], patches,
    runRoot: null, warnings: [],
  };
```

3. In the removal loop's else-branch (worktree still exists), also increment:

```js
    } else {
      report.remaining += 1;
      report.warnings.push(`${target.projectKey || 'project'}: worktree still exists at ${target.worktreeDir}`);
    }
```

4. After the loop (before the runRoot cleanup), derive the verdict:

```js
  report.discarded = report.remaining === 0;
```

The existing `commitFailed`-clearing stays inside the `existsSync === false` branch (already correct: a surviving checkout keeps its DB stamp).

- [ ] **Step 4: Run both suites — PASS.**
- [ ] **Step 5: Commit** — `fix(discard): discarded=true only when every retained checkout is actually gone`

---

### Task 8: UI respects a failed discard and stops lying (UI half of F3 + F7)

**Files:**
- Modify: `ui/public/app.js` (`setupDiscardWorktreeButton`, `renderRetainedWork`)
- Test: `test/ui-history-delete.test.mjs`

- [ ] **Step 1: Failing tests** (append to `test/ui-history-delete.test.mjs`)

```js
test('a failed discard keeps the banner, the badge, and the Archive block', async () => {
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

- [ ] **Step 3: Implement.** In `setupDiscardWorktreeButton`'s click handler, replace the success tail:

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
        : 'The retained worktree no longer existed; nothing needed to be removed.');
```

In the same handler, replace the confirm message (F7 — remove the unconditional lie):

```js
    const msg = 'Discard the retained worktree?\n\nAny work NOT yet committed exists only in the retained worktree; a recovery patch of uncommitted changes will be saved in the pipeline directory before anything is removed. If you already committed the work manually, discarding just removes the now-redundant checkout and clears the warning. The pipeline history and feature branch are kept.\n\nContinue?';
```

In `renderRetainedWork`, after the `archiveNote` paragraph, add the post-commit guidance:

```js
  const clearNote = document.createElement('p');
  clearNote.textContent = 'After committing manually, use "Discard worktree" to remove the now-redundant checkout and clear this warning (a patch of anything still uncommitted is saved first).';
  banner.append(title, intro, list, archiveNote, clearNote);
```

(i.e. extend the existing final `banner.append(...)` call with `clearNote` — do not append twice.)

- [ ] **Step 4: Adjust the two existing regexes** in `test/ui-history-delete.test.mjs` (`/exists only in the retained worktree/` → `/NOT yet committed exists only in the retained worktree/`; keep `/recovery patch will be saved/` working by asserting `/recovery patch of uncommitted changes will be saved/`).

- [ ] **Step 5: Run `test/ui-history-delete.test.mjs` — all PASS.**
- [ ] **Step 6: Commit** — `fix(ui): truthful discard outcome + post-manual-commit guidance`

---

### Task 9: Discard persists via a targeted column update, not `writeState` (F14)

**Files:**
- Modify: `src/core/pipeline-delete.mjs` (`discardRetainedWorktrees`)
- Test: `test/pipeline-delete.test.mjs`

**Interfaces:**
- Consumes: `getDb`, `tx` (already imported). Drops the `writeState` import if now unused.

- [ ] **Step 1: Failing test** (append inside the existing single-project discard test, before the `finally`; requires reading the row before/after)

```js
    const before = getDb().prepare('SELECT updated_at, resume_point FROM pipelines WHERE id = ?').get('retain11');
    // (move this SELECT to just BEFORE the discardRetainedWorktrees call)
    const afterRow = getDb().prepare('SELECT updated_at, resume_point FROM pipelines WHERE id = ?').get('retain11');
    assert.equal(afterRow.updated_at, before.updated_at, 'discard must not restamp updated_at (stats proxy)');
    assert.equal(afterRow.resume_point, before.resume_point, 'discard must not clobber resume_point');
```

- [ ] **Step 2: Run — FAIL** (`updated_at` restamped by `writeState`).

- [ ] **Step 3: Implement.** In `discardRetainedWorktrees`:

1. In the removal loop, REPLACE the in-`state` branchRecord mutation with collecting cleared keys:

```js
    if (!existsSync(target.worktreeDir)) {
      report.worktrees.push(target.worktreeDir);
      clearedKeys.push(target.projectKey ?? null);
    } else {
      report.remaining += 1;
      report.warnings.push(`${target.projectKey || 'project'}: worktree still exists at ${target.worktreeDir}`);
    }
```

with `const clearedKeys = [];` declared before the loop.

2. REPLACE `await writeState(runDir, state);` with a targeted, parse-mutate-write update of ONLY the retention columns:

```js
  // Targeted update: clear ONLY the retention stamps. A full writeState would
  // restamp updated_at (the stats terminal-write proxy), NULL resume_point, and
  // rewrite pipeline_steps — none of which a checkout reclaim may touch.
  if (clearedKeys.length) {
    const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };
    tx(() => {
      const fresh = getDb().prepare('SELECT branch, workspace_meta FROM pipelines WHERE id = ?').get(row.id);
      if (state.target === 'workspace') {
        const wm = (typeof fresh?.workspace_meta === 'string' ? parse(fresh.workspace_meta) : fresh?.workspace_meta) || {};
        for (const k of clearedKeys) {
          const br = wm.branches && wm.branches[k];
          if (!br) continue;
          delete br.commitFailed;
          br.worktreeRemoved = true;
          br.branchKept = true;
        }
        getDb().prepare('UPDATE pipelines SET workspace_meta = ? WHERE id = ?')
          .run(JSON.stringify(wm), row.id);
      } else {
        const br = (typeof fresh?.branch === 'string' ? parse(fresh.branch) : fresh?.branch) || {};
        delete br.commitFailed;
        br.worktreeRemoved = true;
        br.branchKept = true;
        getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?')
          .run(JSON.stringify(br), row.id);
      }
    });
  }
```

3. The later `if (existsSync(runRoot) && !retainedWorkFor(state))` check read the MUTATED `state`; replace it with the outcome-based equivalent:

```js
  if (existsSync(runRoot) && report.remaining === 0) {
```

4. Remove `writeState` from the `artifacts.mjs` import if nothing else in the module uses it.

- [ ] **Step 4: Run `test/pipeline-delete.test.mjs` — all PASS** (the existing assertions `saved.state.branch.commitFailed === undefined` / `worktreeRemoved === true` now verify the targeted update round-trips through `readPipelineByKey`).

- [ ] **Step 5: Commit** — `fix(discard): clear retention via targeted column update (keep updated_at/resume_point/steps)`

---

### Task 10: Snapshot writes to a file with the slow git timeout (F8)

**Files:**
- Modify: `src/core/worktree.mjs:320-333` (`snapshotWorktreePatch`), `src/core/pipeline-delete.mjs` (snapshot loop)
- Test: `test/pipeline-delete.test.mjs` (existing discard tests keep passing — they read the patch FILE already)

**Interfaces:**
- Produces (BREAKING for callers, update them in this task): `snapshotWorktreePatch(worktreeDir, outFile) -> {ok:true, file:string} | {ok:false, step:'path'|'add'|'diff', message:string}`. The patch goes straight to `outFile`; no in-memory string.

- [ ] **Step 1: Write the failing test** (append to `test/pipeline-delete.test.mjs`)

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
  assert.match(await readFile(out, 'utf8'), /x\.bin/);
  await rm(out, { force: true });
});
```

Add `snapshotWorktreePatch` to the test's `worktree.mjs` import.

- [ ] **Step 2: Run — FAIL** (signature mismatch: today it returns `{patch}` and ignores `outFile`).

- [ ] **Step 3: Implement.** First check the local `git()` helper's signature at the top of `worktree.mjs` (~line 57) — it accepts a timeout (the module defines `SLOW_GIT_TIMEOUT_MS = 120000` for add/remove). Then:

```js
/**
 * Stage every remaining change and render a binary-capable patch against HEAD
 * DIRECTLY INTO outFile (no in-memory patch string — agent-created artifacts can
 * be huge). Staging is intentional: it makes untracked files part of the patch.
 * Uses the slow git timeout: big binary diffs legitimately take time.
 * A failure returns without removing anything so the checkout stays authoritative.
 */
export async function snapshotWorktreePatch(worktreeDir, outFile) {
  if (!worktreeDir || !outFile) {
    return { ok: false, step: 'path', message: 'worktreeDir and outFile are required' };
  }
  const add = await git(worktreeDir, ['add', '-A'], SLOW_GIT_TIMEOUT_MS);
  if (!add.ok) {
    return { ok: false, step: 'add', message: add.stderr.trim() || `exit ${add.code}` };
  }
  const diff = await git(worktreeDir, ['diff', '--binary', `--output=${outFile}`, 'HEAD', '--'], SLOW_GIT_TIMEOUT_MS);
  if (!diff.ok) {
    return { ok: false, step: 'diff', message: diff.stderr.trim() || `exit ${diff.code}` };
  }
  return { ok: true, file: outFile };
}
```

(If `git()`'s timeout is not the third positional parameter, match its real shape — read the helper first.)

- [ ] **Step 4: Update the caller.** In `discardRetainedWorktrees`, move `await mkdir(runDir, { recursive: true });` ABOVE the snapshot loop, then replace snapshot+write with:

```js
  // Snapshot ALL members before deleting ANY member, straight to their final
  // files. This prevents a later snapshot failure from leaving a half-discarded
  // workspace, without ever holding a whole patch in memory.
  await mkdir(runDir, { recursive: true });
  const patches = [];
  for (const target of targets) {
    const suffix = state.target === 'workspace'
      ? `-${String(target.projectKey || 'member').replace(/[^a-zA-Z0-9._-]+/g, '-')}`
      : '';
    const name = `retained-work${suffix}.patch`;
    const file = join(runDir, name);
    const snap = await snapshotWorktreePatch(target.worktreeDir, file);
    if (!snap.ok) {
      throw err(
        `cannot save recovery patch for ${target.projectKey || target.worktreeDir}: git ${snap.step} failed: ${snap.message}`,
        'SNAPSHOT_FAILED',
      );
    }
    recordArtifact(row.id, 'retained-work-patch', name);
    patches.push(file);
  }
```

and delete the now-dead second loop (`for (const { target, patch } of snapshots)`) and the `snapshots` array. `writeFile` may drop from the imports if unused.

- [ ] **Step 5: Run `test/pipeline-delete.test.mjs` — all PASS** (both discard tests still assert patch CONTENT from the file — unchanged behavior).

- [ ] **Step 6: Commit** — `fix(worktree): stream the retained-work patch to disk with the slow git timeout`

---

### Task 11: Durable patch at retention time; recovery route serves it (D1)

**Files:**
- Modify: `src/core/orchestrator.mjs` (all 3 teardown retention sites), `ui/server.mjs:1136-1166` (recovery-patch route), `ui/public/app.js` (`addRecoveryPatchLink` gate)
- Test: `test/run-root-teardown.test.mjs`, `test/delete-pipeline-api.test.mjs`

**Interfaces:**
- Consumes: `snapshotWorktreePatch(worktreeDir, outFile)` from Task 10; `recordArtifact` (already exported from `artifacts.mjs`; add to the orchestrator's import list from `./artifacts.mjs` if absent).
- Produces: on every retention, best-effort `<pipelineDir>/retained-work[-<key>].patch` + artifact kind `retained-work-patch`. `GET /api/runs/:id/recovery-patch` serves `retained-work.patch` when present, else falls back to `diff-patch.patch`.

- [ ] **Step 1: Failing test** (extend the EXISTING `detached: a failed teardown commit retains…` test in `test/run-root-teardown.test.mjs` with two assertions at the end)

```js
    const patchText = await readFile(join(st.pipelineDir, 'retained-work.patch'), 'utf8');
    assert.match(patchText, /diff --git/, 'a durable patch exists the moment work is retained');
```

- [ ] **Step 2: Run — FAIL** (no such file today).

- [ ] **Step 3: Implement a private helper** in `orchestrator.mjs` (near `_recordCommitFailure`) and call it from all three retention sites:

```js
  /**
   * Best-effort durable copy of the retained work, written the moment retention
   * is decided — a crash or manual deletion before an explicit discard must not
   * leave the checkout as the only copy. Failure keeps the worktree as the
   * source of truth (same failure class as the commit itself).
   */
  async _snapshotRetained(info, key = null) {
    const pipelineDir = this.pipeline?.dir;
    if (!pipelineDir || !info?.worktreeDir) return;
    const suffix = (this.isWorkspace && key)
      ? `-${String(key).replace(/[^a-zA-Z0-9._-]+/g, '-')}`
      : '';
    const name = `retained-work${suffix}.patch`;
    const snap = await snapshotWorktreePatch(info.worktreeDir, join(pipelineDir, name));
    if (snap.ok) {
      recordArtifact(this.pipeline.id, 'retained-work-patch', name);
      this._log('git', 'info', `Retained-work recovery patch saved: ${name}`);
    } else {
      this._log('git', 'warn',
        `retained-work patch not saved (git ${snap.step}: ${snap.message}); the worktree is the only copy`);
    }
  }
```

Call sites (each immediately after the `_recordCommitFailure(...)` returns true and before the `continue`/`return`):
- `_teardownWorktree` retained branch: `await this._snapshotRetained(info);`
- `_teardownWorktreeAll` retained branch: `await this._snapshotRetained(info, projectKey_);`
- `_teardownRunRoot` retained branch: `await this._snapshotRetained(info, key);` — place it AFTER `removeInjectedPaths(wt, injected)` so injected mounts never enter the patch.

Add `snapshotWorktreePatch` to the orchestrator's `./worktree.mjs` import and `recordArtifact` to its `./artifacts.mjs` import (verify both lists first).

- [ ] **Step 4: Prefer the retained patch in the route.** In `ui/server.mjs`'s recovery-patch handler replace the read+send with:

```js
    let filename = `retained-work-${String(id).replace(/[^a-zA-Z0-9._-]/g, '-')}.patch`;
    let patch = await readRunArtifactText(key, id, 'retained-work.patch');
    if (patch == null) {
      filename = `diff-patch-${String(id).replace(/[^a-zA-Z0-9._-]/g, '-')}.patch`;
      patch = await readRunArtifactText(key, id, 'diff-patch.patch');
    }
    if (patch == null) return res.status(404).json({ error: 'recovery patch not found' });
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.type('text/x-diff').send(patch);
```

- [ ] **Step 5: Widen the UI gate.** In `addRecoveryPatchLink` change the artifact check to:

```js
      !artifacts.some((a) => a && (a.kind === 'diff-patch' || a.kind === 'retained-work-patch'))) return;
```

(The existing `test/delete-pipeline-api.test.mjs` recovery-patch test still passes: its fixture has only `diff-patch.patch`, so the fallback serves it with the `diff-patch-…` filename it asserts.)

- [ ] **Step 6: Run `test/run-root-teardown.test.mjs`, `test/delete-pipeline-api.test.mjs`, `test/ui-history-delete.test.mjs` — all PASS.**
- [ ] **Step 7: Commit** — `feat(pipeline): durable retained-work patch at retention time; serve it for recovery`

---

### Task 12: Workspace deletion refuses live retained work (F4)

**Files:**
- Modify: `src/core/workspaces.mjs` (`deleteWorkspace`), `ui/server.mjs:1633-1650` (DELETE workspace route)
- Test: `test/pipeline-delete.test.mjs` (helpers `freshWorkspaceStore`/`freshRepo` live there)

- [ ] **Step 1: Failing test**

```js
test('deleteWorkspace refuses while a member pipeline has retained uncommitted work', async () => {
  const repoA = await freshRepo();
  const wtA = await createWorktree({ projectDir: repoA, pipelineId: 'retainwd', sourceBranch: 'main', featureBranch: 'worca-cc/retainwd-a' });
  await writeFile(join(wtA.worktreeDir, 'a.txt'), 'kept\n');
  const prev = process.env.WORCA_HOME;
  await freshWorkspaceStore({
    wkey: 'wks-retain-del', id: 'retainwd', base: 'retained-del', datePrefix: '04-06-26', status: 'done',
    members: [{ projectDir: repoA, branch: { source: 'main', feature: wtA.branch, worktreeDir: wtA.worktreeDir, commitFailed: { code: 'commit_failed', step: 'commit', message: 'hook', at: new Date().toISOString() } } }],
  });
  try {
    await assert.rejects(() => deleteWorkspace('wks-retain-del'), (e) => e.code === 'RETAINED_WORKTREE');
    await discardRetainedWorktrees({ workspaceKey: 'wks-retain-del', id: 'retainwd' });
    const after = await deleteWorkspace('wks-retain-del');
    assert.equal(after.ok, true, 'delete succeeds once the retention is resolved');
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});
```

Add `deleteWorkspace` to the test imports (`../src/core/workspaces.mjs`). Match `freshWorkspaceStore`'s real option shape to the existing workspace discard test in this suite.

- [ ] **Step 2: Run — FAIL** (delete succeeds today).

- [ ] **Step 3: Implement.** In `deleteWorkspace`, after the row-exists check and before the `rm`:

```js
  // Never orphan retained uncommitted work: deleting the store removes the
  // pipeline dir the discard flow needs for its recovery patch, wedging the run.
  const memberRows = prepare(
    'SELECT * FROM pipelines WHERE workspace_key = ? AND archived_at IS NULL',
  ).all(id);
  for (const memberRow of memberRows) {
    if (retainedWorkFor(memberRow)) {
      throw err(
        `workspace has retained uncommitted work (pipeline ${memberRow.id}); recover or discard it first`,
        'RETAINED_WORKTREE',
      );
    }
  }
```

Add `import { retainedWorkFor } from './artifacts.mjs';` to `workspaces.mjs` (verify no import cycle: `artifacts.mjs` must not import `workspaces.mjs` — it doesn't at `4f2901a2`; if that changed, move the check into the server route instead, reading the rows there).

In the server route's catch path, map the code before the generic `workspaceErrorStatus` mapping:

```js
  } catch (err) {
    if (err && err.code === 'RETAINED_WORKTREE') return res.status(409).json({ error: err.message });
    const status = workspaceErrorStatus(err && err.code);
    return res.status(status).json({ error: err && err.message ? err.message : String(err) });
  }
```

- [ ] **Step 4: Run `test/pipeline-delete.test.mjs` + any `test/workspaces*.test.mjs` suites — all PASS.**
- [ ] **Step 5: Commit** — `fix(workspaces): refuse deletion while retained uncommitted work exists`

---

### Task 13: A vanished worktree is not a commit failure (F15)

**Files:**
- Modify: `src/core/orchestrator.mjs` (`_commitWork` status step)
- Test: `test/run-root-teardown.test.mjs`

- [ ] **Step 1: Failing test**

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

- [ ] **Step 2: Run — FAIL** (`ok:false, step:'status'` today: `_git` spawn-fails with ENOENT/cwd-missing).

- [ ] **Step 3: Implement.** In `_commitWork`, extend the status-failure branch:

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

Verify `existsSync` is imported in `orchestrator.mjs` (add `import { existsSync } from 'node:fs';` if missing).

- [ ] **Step 4: Run `test/run-root-teardown.test.mjs` — all PASS.**
- [ ] **Step 5: Commit** — `fix(pipeline): a vanished worktree is a no-op, not a phantom retention`

---

### Task 14: Never cache the live retention fact; revert the cache bump (F9)

**Files:**
- Modify: `ui/public/app.js:7393-7394` (`HISTORY_CACHE_KEY`/`VER`), `:7412` (`writeHistoryCache`)
- Modify: `test/ui-history-cache.test.mjs` (revert the v2 edits from `4f2901a2`)
- Test: `test/ui-history-cache.test.mjs`

- [ ] **Step 1: Failing test** (append; mirrors the existing `pr`-strip test)

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

(Adapt the boot/response plumbing to the suite's existing helpers — copy the `pr`-strip test's structure exactly and only change the injected field + assertion.)

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

In `test/ui-history-cache.test.mjs`, revert `4f2901a2`'s edits: `CACHE_KEY` back to `'worca-cc.history.cache.v1'`, the seeded blob back to `v: 1`, the assertion back to `parsed.v === 1`, and the comment back to "Pre-seed a valid v1 cache".

- [ ] **Step 4: Run `test/ui-history-cache.test.mjs` + `test/ui-history-delete.test.mjs` — all PASS** (the discard test's `writeHistoryCache` call now simply persists rows without the field).

- [ ] **Step 5: Commit** — `fix(ui): keep retention out of the history cache; revert the needless v2 bump`

---

### Task 15: `runDirForRow` reuses the archive resolver's matcher (F11)

**Files:**
- Modify: `src/core/artifacts.mjs` (`runDirForRow` + new exported `findRunDir`), `src/core/pipeline-delete.mjs` (delete its local `findRunDir`, import instead)
- Test: `test/pipeline-delete.test.mjs` or `test/delete-pipeline-api.test.mjs`

**Interfaces:**
- Produces: `export async function findRunDir(pipelinesDir, id)` in `artifacts.mjs` — the EXACT current `pipeline-delete.mjs:356-363` behavior (case-insensitive `-<id>$` regex pass, then exact-basename pass) plus regex-escaping of `id`.
- Import direction: `pipeline-delete.mjs` already imports from `artifacts.mjs`; moving the helper INTO `artifacts.mjs` avoids a cycle. `artifacts.mjs` must NOT import from `pipeline-delete.mjs`.

- [ ] **Step 1: Failing test**

```js
test('runDirForRow matches the archive resolver: case-insensitive -<id> suffix', async () => {
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
});
```

(Adapt paths to `freshStore`'s real layout — read the helper first; the deliverable is the case-insensitivity assertion. Add `rename` to the fs imports and `runDirForRow` to the artifacts import.)

- [ ] **Step 2: Run — FAIL** (current fallback is case-sensitive `endsWith`).

- [ ] **Step 3: Implement.**

1. Move `findRunDir` into `artifacts.mjs` as an export, with the id escaped:

```js
/** Find the on-disk run dir for an id under pipelinesDir (basename ends in -<id>).
 *  Case-insensitive, matching the archive resolver's historical behavior. */
export async function findRunDir(pipelinesDir, id) {
  let entries;
  try { entries = await readdir(pipelinesDir, { withFileTypes: true }); } catch { return null; }
  const esc = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const e of entries) if (e.isDirectory() && new RegExp(`-${esc}$`, 'i').test(e.name)) return join(pipelinesDir, e.name);
  for (const e of entries) if (e.isDirectory() && e.name === id) return join(pipelinesDir, e.name);
  return null;
}
```

2. In `runDirForRow`, replace `4f2901a2`'s inline readdir fallback (the `const entries = await readdir…` block) with:

```js
  const indexed = dirById.get(row.id);
  if (indexed) return indexed;
  // Production ids are 8-hex and always covered by runDirIndex; this fallback
  // serves older/manual rows via the SAME matcher archive uses (findRunDir).
  const hit = await findRunDir(pipelinesDir, row.id);
  if (hit) return hit;
  return join(pipelinesDir, row.id);
```

3. In `pipeline-delete.mjs`: delete the local `findRunDir` and add `findRunDir` to its `./artifacts.mjs` import.

- [ ] **Step 4: Run `test/pipeline-delete.test.mjs`, `test/delete-pipeline-api.test.mjs`, `test/pipeline-archive.test.mjs` — all PASS.**
- [ ] **Step 5: Commit** — `refactor(artifacts): one run-dir matcher — runDirForRow reuses findRunDir`

---

### Task 16: Cleanups C1 + C3 (C2 optional)

**Files:**
- Modify: `ui/server.mjs` (shared scope resolver for the two NEW routes; `DIFF_PATCH_FILE` import)
- Test: `test/delete-pipeline-api.test.mjs` (existing coverage; no new tests — pure refactor, behavior identical)

- [ ] **Step 1: Extract the duplicated preamble** used by `GET /api/runs/:id/recovery-patch` and `POST /api/runs/:id/discard-worktree` (leave the older DELETE route untouched — do not risk behavior drift there):

```js
// Shared query-scope resolver for the retained-work routes. Returns null after
// writing the error response itself.
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
  return { workspaceId, projectKey: projectKey_, projectDir };
}
```

Both routes then start with `const scope = resolveRunScope(req, res); if (!scope) return;` and use `scope.workspaceId` etc.

- [ ] **Step 2: C3** — in the recovery-patch route, `import { DIFF_PATCH_FILE } from '../src/core/results.mjs';` (check the existing import block for `results.mjs`) and use it instead of the `'diff-patch.patch'` literal (Task 11 already introduced the retained-work preference; only the fallback literal changes).

- [ ] **Step 3: C2 (OPTIONAL — only if trivial after reading both):** make `listWorkspacePipelines(workspaceKey, primaryDir, opts)` delegate to `listPipelines(primaryDir, opts, workspaceKey)` IF AND ONLY IF a side-by-side read shows the bodies are behaviorally identical (same SELECT, same enrichment against `primaryDir`). If anything differs beyond the SELECT, skip C2 and note it.

- [ ] **Step 4: Run `test/delete-pipeline-api.test.mjs` + `test/ui-history-delete.test.mjs` (+ workspace list suites if C2 taken) — all PASS.**
- [ ] **Step 5: Commit** — `refactor(server): shared run-scope resolver; DIFF_PATCH_FILE constant`

---

### Task 17: Full-suite gate + PR update

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: only the 4 pre-existing imagegen-skill failures (`imagegen skill is bundled…`, `bundled generate_image.py…`, `detached + declared skills…`, `legacy (pinned) + declared skills…`). Anything else red = fix before proceeding.

- [ ] **Step 2: Push and update the PR description** — append to PR #364's description (via `gh pr edit 364 --body-file …`, preserving the existing body):

> Hardening pass from review: archive/delete guards now trust both retention representations and fail closed; discard reports partial failures truthfully and no longer rewrites the whole row; a durable recovery patch is written the moment work is retained (and served by the recovery endpoint, including for error/stopped runs); workspace deletion refuses live retained work; snapshot streams to disk with the slow git timeout; retention state is synthesized and persisted immediately even without a branch record; plus the ui-history badge test fix and cache-bump revert.

- [ ] **Step 3: Do NOT merge** — leave the branch for review. Known accepted follow-up (out of scope, noted in the spec): Archive still deletes the feature branch (N1, pre-existing semantics).
