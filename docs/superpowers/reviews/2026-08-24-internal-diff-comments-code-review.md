# Code review — Internal Diff Comments in History

**Branch:** `worca-cc/internal-diff-comments-in-history-ask-5901a168`
**Scope:** commit `1fad8b80` ("worca: Internal Diff Comments in History") + the uncommitted working tree (orchestrator partial-diff build, partial-run banner, test updates).
**Date:** 2026-08-24

**Verification basis:** full suite `npm test` → **3536/3536 pass**. The 10 new/changed test files for this feature → **162/162 pass**. Every finding below was reproduced by reading the code and, where marked, by running the real modules or real `git`.

**Ranking:** 0 critical · 5 major · 19 minor.

---

## Summary table

| # | Sev | Area | One line |
|---|-----|------|----------|
| M1 | MAJOR | orchestrator | Stopped/error runs lose every untracked file from the persisted diff |
| M2 | MAJOR | ask/events | Sub-agent comment writes never poke the UI |
| M3 | MAJOR | db | `repairSchemaGaps` ALTERs before CREATEs → `ask_run_links.comment_ids` missing on a v21-stamped DB |
| M4 | MAJOR | ask/tools | `delete_diff_comment` is irreversible, unconfirmed, and reachable from untrusted text |
| M5 | MAJOR | diff-anchor | Protected-path floor fails **open** for C-quoted paths (guardrail bypass) |
| m1 | minor | ask/tools | `delete_diff_comment` skips the protected-path guard `resolve_diff_comment` applies |
| m2 | minor | orchestrator / server | `/diff` now 200-empty where it used to 404 |
| m3 | minor | db / server | `ask_card_comments` rows leak for cards never started |
| m4 | minor | ask/turn | `commentIds` never scoped to the proposed target |
| m5 | minor | diff-comments | `sent_run_id` never repaints a live Diff tab |
| m6 | minor | comment-deps | `hunkContext` computed before the protected filter |
| m7 | minor | ui | No debounce on the poke; unbounded counts endpoint |
| m8 | minor | ui | `diff-comments-changed` not replayed on reconnect |
| m9 | minor | ui | One failed comment fetch disables creation until the next `select()` |
| m10 | minor | ui | `attachComments` dedups blocks by line only, not side |
| m11 | minor | ui | A poke that adds a synthetic row collapses manual tree state |
| m12 | minor | orchestrator / db | Two stale doc comments (`_reportToSource`, `applySchemaV21`) |
| m13 | minor | ui | `askAboutDiffComment` omits `lineText`; silent no-op when `askPanel` is null |
| m14 | minor | diff-anchor | Cap-parity claim holds against the renderer, not against `get_run_diff` |
| m15 | minor | diff-anchor | "holders" hint is not guardrail-filtered (existence oracle) |
| m16 | minor | ui | `+` gutter arms on files the floor always rejects |
| m17 | minor | diff-anchor | Fractional `line` silently truncated |
| m18 | minor | diff-anchor | O(M·N) re-parse on the not-found path |
| m19 | minor | ask/prompt | `diffPath` context line carries no member key for workspace runs |

---

## CRITICAL

None.

---

## MAJOR

### M1 — Stopped/error runs lose every untracked file from the diff

**Where:** `src/core/orchestrator.mjs:753`, `:776`, `:1020`, `:1043` (the four new `await this._buildResults()` calls)

`_buildResults()` runs `git diff <checkpoint>` against the live worktree. On the **done** path the review loop has already run `_stageWorkingTree()` (`git add -A -N`, called at `:2204` and `:2311`), so newly created files are intent-to-added and appear in the diff. On the new **stopped/error** path nothing has staged them, and `git diff` does not see untracked files.

Reproduced (agent writes one brand-new file into the worktree, then Stop):

```
branch diff:      diff --git a/brand-new.txt b/brand-new.txt … +agent created this
persisted patch:  ""            (0 bytes)

control, done path:  patch has brand-new.txt: true   (949 bytes)
```

Consequences — the branch carries the work, but:

- History Diff tab renders "(no files changed)".
- `GET …/comments` reports `patchAvailable: false`, so the `+` gutter is never armed.
- `POST …/comments` returns 409 "this run has no stored diff".

That is exactly the scenario the uncommitted change exists to serve. The new test (`test/orchestrator-partial-diff.test.mjs`) sidesteps it deliberately — its helper comment says it edits a **tracked** file "so the assertions do not depend on which dispatch step the run was stopped in".

**Fix:** call `await this._stageWorkingTree()` immediately before `_buildResults()` at all four sites. `_stageWorkingTree` must also pass `ignoreAbort: true` — `src/core/orchestrator.mjs:3586` uses the default, and `_git` sets `signal: this.abort.signal` unless `ignoreAbort` (`:3616-3626`), so on a stopped run the already-tripped signal kills the `git add`. Compare `_commitWork`'s `const gitOpts = { cwd, ignoreAbort: true }` at `:1804`.

---

### M2 — Sub-agent comment writes never poke the UI

**Where:** `src/core/ask/events.mjs:303-315` (`onUser`), hook at `:354`

`onUser` returns early for `!isMain` — it only appends a child-activity log line — so the `COMMENT_WRITE_TOOLS` hook never runs for a tool result produced inside a `Task`.

Sub-agents hold the full MCP surface: `ASK_MCP_GRANTS = ['mcp__worca']` (`src/core/ask/spawn.mjs:22`), and `SANDBOX_NOTE` (`:64-68`) explicitly tells them the worca MCP tools are available. `test/ask-events.test.mjs` already models a child calling `mcp__worca__*`.

So a comment written by a sub-agent lands in the DB with **no** `diff-comments-changed` broadcast. There is no polling fallback — `refreshCommentCounts` runs only from `loadHistoryView` and from the poke itself (`ui/public/app.js:633`, `:9103`) — so an open Diff tab stays stale until the user navigates away and back.

**Fix:** run the hook for child results too. The `!isMain` branch already has `text` in scope.

---

### M3 — `repairSchemaGaps` ALTERs before CREATEs → `comment_ids` silently missing, stamped as v21

**Where:** `src/core/db.mjs:780` (loop order), `:730` (`if (have.size === 0) continue`), `:788` (`ASK_DDL`), `:715` (`ask_run_links: { comment_ids: 'TEXT' }`)

`comment_ids` is the first `INCREMENTAL_COLUMNS` entry whose host table is itself created by a gap-repair DDL block. Within one `repairSchemaGaps` pass the column ALTER is skipped (`PRAGMA table_info(ask_run_links)` is empty), then `ASK_DDL` creates `ask_run_links` **without** the column. Nothing re-probes afterwards, and `user_version` is stamped 21 regardless.

Reproduced (seed = `pipelines` + `workflows` only):

```
stamp=17 -> uv=21  diff_comments:true  ask_card_comments:true  comment_ids:true
stamp=20 -> uv=21  diff_comments:true  ask_card_comments:true  comment_ids:FALSE
stamp=21 -> uv=21  diff_comments:true  ask_card_comments:true  comment_ids:FALSE
   (both heal only on the NEXT migrate())
```

For the rest of that process `updateRunLink(threadId, runId, { commentIds })` throws `no such column: comment_ids`. That throw is swallowed by the log-only catch at `ui/server.mjs:1157`, so the whole `propose_run` → `sent_run_id` chain silently no-ops with no user-visible error.

`test/ask-db-schema.test.mjs:45-53` constructs precisely this DB ("a DB already stamped 21 WITHOUT the ask tables") and passes only because it never asserts on `ask_run_links`' columns.

Generic: **any** future `INCREMENTAL_COLUMNS` entry on a gap-repaired table inherits this hole.

**Fix:** create tables before ALTERing columns in `repairSchemaGaps`, or loop until `schemaGaps` returns empty.

---

### M4 — `delete_diff_comment` is destructive, irreversible, unconfirmed, and reachable from untrusted text

**Where:** `src/core/ask/tools.mjs:602-610`

Hard `DELETE`, no undo, no user gate. The only guard is a system-prompt sentence (`src/core/ask/prompt.mjs` rule 9: "deleting is permanent, so confirm first").

Rule 2 declares only `[worca context]` blocks untrusted; it does **not** tell the model to ignore instructions embedded in diffs, run prompts or attachments — contrary to the PR description's claim that "run prompts, diffs and attachments are declared untrusted in the system rules". Comment ids are enumerable via `list_diff_comments`.

Every other Ask capability is propose-only (`propose_run` never starts anything) or read-only (worktrees are detached and read-only; the git tool cannot mutate). This is the first capability that destroys user data on the model's word alone.

**Fix:** route deletion through a confirmation card like `propose_run`, or restrict the tool to comments with `author: 'ask'`.

---

### M5 — Protected-path floor fails **open** for C-quoted paths (guardrail bypass)

**Where:** `src/core/diff-anchor.mjs:101-104`, via `ui/public/diff-view.mjs:105-109` (`stripSide`)

`diff-anchor.mjs:95-100` claims it fails "closed exactly as get_run_diff does". It does not. The two paths use different parsers, and they disagree:

- `get_run_diff` uses `splitUnifiedDiff`, which **un-C-quotes** paths (`unquoteDiffPath`, `src/core/ask/tools.mjs:23-41`).
- `resolveAnchor` uses `splitPatchSections`, whose `stripSide` does not unquote, and whose `^[ab]\/` strip never fires past the leading `"`.

Reproduced against real `git diff` with today's pinned flags (`-c core.quotePath=false -M -l0 --no-color --no-ext-diff --submodule=short --src-prefix=a/ --dst-prefix=b/`), on a repo containing `tab<TAB>name.pem`:

```
diff --git "a/tab\tname.pem" "b/tab\tname.pem"

splitUnifiedDiff   -> "tab\tname.pem"            isProtectedBasename: true   -> DROPPED
splitPatchSections -> "\"b/tab\\tname.pem\""     isProtectedBasename: false  -> ALLOWED
resolveAnchor      -> { path: "\"b/tab\\tname.pem\"", lineText: "yy" }
hunkContext        -> [" x", "-y", "+yy", " z"]
```

The leak chain is complete: `add_diff_comment` echoes `lineText` straight back in its response, and `list_diff_comments` re-tests the *same* quoted string (`tools.mjs:553-554`), so `guarded === false` and it emits `line_text` **and** `context` for a file `get_run_diff` refuses to show.

`core.quotePath=false` does not prevent this — git C-quotes any path containing `"`, `\`, a tab or a control byte regardless, and patches persisted before the pin landed (`1b02d87b`) quote *any* non-ASCII path (`git-info.mjs` notes those cannot be regenerated).

Root cause is a mis-transplanted limitation: `ui/public/diff-view.mjs:187-191` explicitly descopes C-quoted paths as "graceful" — true for rendering, false once the same parser feeds a security decision.

**Not critical because:** the model cannot enumerate the quoted string (get_run_diff drops the section), so it must guess it or be handed it. The browser cannot reach it either — `git diff --name-status` quotes as `"tab\tname.pem"` while the patch section key is `"b/tab\tname.pem"`, so `sectionKey` never matches, `section` is null, and the gutter is never armed (`ui/public/app.js:12034`, `:12080`).

No test covers this; `test/diff-anchor.test.mjs:118` only covers the unquoted rename case.

**Fix:** unquote in `stripSide`/`pathFromHeader`, or — with no renderer change — make `resolveAnchor` refuse any section whose path still looks C-quoted, mirroring get_run_diff's `!s.path` drop.

---

## MINOR

### m1 — `delete_diff_comment` skips the protected-path guard `resolve_diff_comment` applies
`src/core/ask/tools.mjs:602-610` vs `:587-590`. Reproduced with a comment created before the pattern existed: `list` filters it, `resolve` refuses it, `delete` succeeds. Data loss only, no leak — the response echoes just `{runId, storeKey}`. Reachable only if the secure preset grows or an id arrives from outside the read surface. One line: reuse `blocked(before)`.

### m2 — `/diff` now returns 200-empty where it used to 404
`if (!members.length) return` (`src/core/orchestrator.mjs:3474`) checks that a checkpoint ref existed, not that the diff is non-empty. A run stopped right after the feature branch is registered now writes a 0-byte `diff-patch.patch` plus an all-zero `results.json`, both indexed. Because `text == null` is false for `''`, `ui/server.mjs:1994` no longer 404s. Knock-ons:
- Every early-stopped run's detail page now opens on the **Diff** tab (`ui/public/app.js:11110`, `initial: (d) => (d.results ? 'diff' : 'overview')`) showing "(no files changed)".
- `/api/runs/:id/recovery-patch` (`ui/server.mjs:1687-1690`) serves an empty `.patch` attachment instead of 404.
- The new route comment at `ui/server.mjs:1977-1981` only accounts for the pre-checkpoint 404 case, not this far more common 200-empty one.

**Fix:** skip `persistResults`/`persistDiffPatch` when the assembled patch is empty.

### m3 — `ask_card_comments` rows leak for cards that are never started
No FK on `card_id` (`src/core/db.mjs:683-688`); `clearPendingCardComments` has exactly one caller — the successful-launch path at `ui/server.mjs:1155`. Dismiss (`ui/server.mjs:3727-3745`) flips the block state and never clears; `deleteThread` (`src/core/ask/store.mjs:145-150`) cannot reach the table. Reproduced: after `deleteThread`, `ask_messages` = 0 and `ask_card_comments` = 1. Rows are reclaimed only via the `comment_id → diff_comments` cascade. Bounded but unbounded-growing; never read back (card ids are random 8-hex).

### m4 — `commentIds` are never scoped to the proposed run's target
`src/core/ask/turn.mjs:136` → `setPendingCardComments` (`src/core/diff-comments.mjs:206-222`) validates id shape + row existence only. `stampSentRunId` (`:173-184`) does not scope either, and `validateProposal` never sees `commentIds` (no reference in `src/core/ask/proposal.mjs`). So the model can cite run A's comments on a proposal for run B; they get `sent_run_id = <run B>`. Nothing ever writes `sent_run_id` back to NULL, so the wrong `sent to #<runId>` pill (`ui/public/app.js:11284-11289`) is permanent short of deleting the comment. The card block deliberately omits `commentIds` (`turn.mjs:131-134`), so the Start confirmation cannot show what will be stamped.

### m5 — `sent_run_id` never repaints a live Diff tab
`stampSentRunId` deliberately skips `notify()` (`src/core/diff-comments.mjs:176`), and no run event repaints the Diff tab's cards — only `diff-comments-changed` does. The marker needs a reopen to appear. The code comment's rationale ("the History view is already being repainted by the run's own events") is about the History *list*, not the cards.

### m6 — `hunkContext` computed before the protected filter
`src/core/ask/comment-deps.mjs:36-41` maps `hunkContext` over every row; `src/core/ask/tools.mjs:553-554` filters guarded rows afterwards. Not a leak — `shapeComment` carries no context and `tools.mjs:559` is the only emit site — but it costs a whole-patch parse per discarded row (compounding the module's own COST NOTE) and inverts the fail-closed order used everywhere else.

### m7 — No debounce on the poke; unbounded counts endpoint
Every mutation broadcasts, and each client then refetches `/api/diff-comments/counts` **and** runs a full `paintHistory()` (`ui/public/app.js:9806-9815`). An Ask turn writing 20 comments = 20 full History repaints per open tab. `/api/diff-comments/counts` also returns a row for every run with any unresolved comment, with no limit.

### m8 — `diff-comments-changed` is not replayed on reconnect
The frame is a plain global broadcast, outside the ask job-frame grace buffer, and nothing refetches the open Diff tab on socket recovery. A mutation during a socket drop is missed until the file is re-picked.

### m9 — One failed comment fetch disables creation until the next `select()`
`armCommentGutter` runs only from `select()` (`ui/public/app.js:12057`), and `reload()` deliberately does not re-arm. After one network blip `cstate.patchAvailable` is false, so pokes restore the cards but the `+` stays gone. Documented in the code; still a UX dead-end.

### m10 — `attachComments` dedups blocks by `data-line` only, not `data-side`
`ui/public/app.js` ~11870. A context row carries both an old-side and a new-side number, so two comments on the same row with different sides produce two sibling blocks, and `row.after(block)` puts the later (higher-numbered) one first. Cosmetic.

### m11 — A poke that adds a synthetic row collapses manual tree state
`paintFileList` re-renders via `renderFileTree` whenever the synthetic-row signature moves, and `renderFileTree` always starts every directory expanded (`ui/public/file-tree.mjs:246`, `aria-expanded="true"`, `group.hidden = false`).

### m12 — Two stale doc comments
- `src/core/orchestrator.mjs:3492-3502` still says the write-back runs "after persist on the stopped/error branches" and that "the summary is thinner because results.json may not exist". Both now false — `retryWriteback` reads `results.json` (`src/core/sources.mjs:215`), so `buildResultSummary` now emits the diffstat and "Key things to check" lines on stopped/error too. That is a real, undocumented payload change to the task-source write-back.
- `src/core/db.mjs:952-963` states the wrong mechanism for `applySchemaV21`: it claims v19 fires the ALTER and the DDL. Instrumentation shows `ASK_DDL` + `DIFF_COMMENTS_DDL` fire at ladder step 12 and the `comment_ids` ALTER at step 13, both only because a *later* pass re-probes — the exact invariant M3 breaks.

### m13 — `askAboutDiffComment` omits `lineText`; silent no-op without the panel
`ui/public/app.js:14890` sends path, line, side and body, but not `lineText` — while prompt rule 9 tells the model to quote `line_text` because line numbers may have shifted. And `askPanel?.appendToComposer(...)` silently does nothing when the panel is not mounted, so the card's "Ask Worca" button looks broken.

### m14 — Cap-parity claim holds against the renderer, not against `get_run_diff`
`src/core/diff-anchor.mjs:6-7` claims parity with "the browser". True — `parseFileSection` is shared with `app.js:12050`/`:12072`. But `get_run_diff` applies **no** cap (`src/core/ask/tools.mjs:528-532` pages the whole body). Measured: a section of 3,588,998 code units parses 14,194 rows; `resolveAnchor(…, {side:'new', line:14195})` throws *"has no new-side line 14195 in this run's diff"* — factually false, and the model that just read that row via `get_run_diff` cannot self-correct. Threshold: 500,000 UTF-16 code units of the section's raw text, snapped down to the last `\n` at or before index 500,000.

### m15 — The "holders" hint is not guardrail-filtered
`src/core/diff-anchor.mjs:90-93`. On a workspace patch where member `alpha-…` changed `.env`, `resolveAnchor({project:'beta-…', path:'.env', …})` answers *"…it is in: alpha-…"*, while `get_run_diff` never lists that file at all. Existence + owning member only, no content.

### m16 — The `+` gutter arms on files the floor always rejects
`ui/public/app.js:11950-11951` gates only on `ctx.canCreate()`. `.env`, `*.pem`, `*.key` and `**/secrets/**` sections render and arm, so the user composes a comment and only learns on submit (400, surfaced inline at `app.js:11360`). Note `*.key` and `**/secrets/**` also catch ordinary non-credential files (`src/secrets/README.md` is refused).

### m17 — Fractional `line` silently truncated
`src/core/diff-anchor.mjs:73-74`. `Math.trunc(Number(line))` accepts `3.9` as line 3 despite the error text "line must be a positive integer". `'2'` → 2; `1e21`, `0` and `-1` are correctly refused.

### m18 — O(M·N) re-parse on the not-found path
`src/core/diff-anchor.mjs:48-50`, `:90`. `findSection` re-runs a full `splitPatchSections` + `patchIndex` over the whole patch, and the not-found branch calls it once per member. Measured on a 671 KB / 20-member patch: 129 ms for a miss vs 14 ms for a hit (21 full parses).

### m19 — `diffPath` context line carries no member key for workspace runs
`ui/public/app.js:14884-14889` reads `.hd-diff-file.active`'s `dataset.path`, which for a workspace run is the bare path with no member project — so the model cannot use the context line directly for `add_diff_comment`, which requires `memberProjectKey`. It is also read from the cached Diff tab body even when the user is on another tab.

---

## Verified clean

Everything below was checked and found correct — several by running the real modules against real `git` output.

**Anchor ↔ renderer parity.** `patchMembers`' `/^# \S/` is byte-identical to `splitPatchSections`' own test (`diff-anchor.mjs:40` vs `diff-view.mjs:58`), and cannot be fooled by real patch text — every hunk-body line carries a `+`, `-`, ` ` or `\` prefix, so `+# some-key` and `-# some-key` both yield `[]`. The 500k cap refuses exactly the rows it fails to render. Rename+edit resolves on the new path with `oldPath` persisted, and the old path is rejected with an actionable message (probed against real `git diff -M`). The both-sides protected guard works via the mirroring at `diff-view.mjs:79-87`. `ui/public/diff-view.mjs` is genuinely DOM-free (0 `document`/`window` references), so importing it from `src/` under node cannot throw.

**Protected-path floors.** REST and MCP use the identical set: `addDiffComment` never passes `protectedPaths`, so both get `SECURE_PROTECTED_PATHS`; `tool-deps.mjs:59` passes the same preset for reads. Verified value-identical at runtime (23 entries, JSON-equal). Glob semantics confirmed: slash-less patterns match the basename at any depth, slash-containing ones match the full repo-relative path.

**Store-key consistency.** `storeKeyOf` (`tools.mjs:387-388`), `emitDiffCommentsChanged` (`ui/server.mjs:411-413`), `runDirForRow` (`artifacts.mjs:1974-1977`) and `hdStoreKey` (`app.js:9902`) all derive the same key, so MCP writes, REST writes and the WS frame can never disagree about which run a comment belongs to.

**Reducer.** `resultText` never truncates — `blockIoMaxChars` (2048) applies only to the persisted tool *input* (`clipJson`, `events.mjs:292`) and to `b.error` on error results. `JSON.parse(text)` at `:356` sees the untouched concatenation, so the poke parse is safe at any body size. All three write tools return `comment.runId`, so no success shape is missed, and `AskToolError` reaches the client as `isError: true` from `mcp-stdio.mjs:83`.

**Launch hand-off.** No race: the link write + clear run at `ui/server.mjs:1152-1155`, `attachRunFollower` at `:1164`, and `orch.run()` only at `:1224` inside a deferred `.then`. `updateRunLink` returns a fresh `getRunLink` read, and `rowToRunLink` normalizes `commentIds` to `[]`, so `row.commentIds.length` cannot throw. `follow.mjs:52-55` does latch first-truthy-sight only. Read → write → consume ordering is correct (no lost ids if the write throws).

**Dep bundles.** `toolDeps` (13 keys), `worktreeDeps` (`{worktrees}`) and `commentDeps` (`{comments}`) have zero key collisions, so the spread order in `mcp-stdio.mjs:117-119` clobbers nothing.

**Database.** `PRAGMA foreign_keys = 1` on real handles; WAL on; `busy_timeout = 5000`. No production `DELETE FROM pipelines`, so the declarative cascade is documented correctly and the archive path deletes explicitly (and does so inside the caller's transaction, correctly avoiding `tx()`'s non-re-entrancy). `tx()` is never nested — zero `tx(` in `ui/server.mjs`, `ask/follow.mjs`, `ask/turn.mjs`, `ask/events.mjs`. `listDiffComments`' `prepare()` cache is bounded to exactly **6** distinct SQL texts across 42 probed `(status, path)` combinations, with no caller value interpolated (probed with `"x' OR 1=1 --"`, which arrived as a bound parameter). The `diffCommentTables` single-flag-for-two-tables trick is idempotent and heals in both directions.

**Orchestrator.** `_buildResults` does **not** route through `this._git` — `diffNameStatus`/`diffNumstat`/`diffPatch` spawn without a `signal` (`git-info.mjs:11-26`), so a tripped abort cannot no-op them; this was the single biggest risk in the uncommitted change and it does not exist. All four insertion points are byte-identical and preserve the done path's ordering. Checkpoint "refs" are plain SHAs, and `removeWorktree` is always called with `branch: null`, so nothing can delete them. Timing is not a concern (a 7.6 MB patch took 82 ms; no stop timeout or SIGKILL escalation exists; `_stopHeartbeat` is in the `finally`, after the build). No double build — `resume()` refuses anything but `paused`/`interrupted`, and `recordArtifact` is `INSERT OR IGNORE`. The "best-effort by construction" claim is accurate: `_buildResults`' catch only calls `_log`, which cannot throw.

**Server routes.** The comments routes are traversal-safe (the relPath is the constant `DIFF_PATCH_FILE`; no user input reaches a path). The history-key regex is byte-identical to the `/log` and `/diff` routes'. Workspace runs are correctly forced onto the `/api/workspaces` arm. A comment reached through a run URL must belong to that run (`commentOfRun`). Existence is checked before body shape on PATCH. The `''`-vs-`null` patch distinction is handled correctly (409, not 400). The `/diff` route is genuinely status-agnostic and always has been (verified via `git log -L`).

**Frontend safety.** All comment content is rendered with `textContent`; `cssEscape` guards every selector interpolation (its `CSS.escape` output is valid inside a quoted attribute value for multi-digit line numbers). The Escape guard is correctly scoped and correctly capture-phase. `diffPath` cannot forge a trusted block — `flatten()` (`prompt.mjs:48`) strips C0/C1/U+2028/U+2029 **and** neutralises `[worca context]` tags, and the value is length-capped at 512 then clipped to 200.

**No ReDoS.** `HUNK_RANGE_RE` on 200k-char pathological inputs: 0.08–0.24 ms. `patchMembers` on a 400k-char `# a-a-a-…`: 0.07 ms. Glob patterns come from the frozen secure preset, never from input.

---

## Suggested fix order

1. **M1** — one call site pattern, blocks the uncommitted change's stated purpose.
2. **M5** — security; small, self-contained fix in `resolveAnchor` (fail closed on a still-quoted path).
3. **M3** — reorder `repairSchemaGaps`; also closes the hole for every future incremental column.
4. **M2** — one branch in `events.mjs`.
5. **M4** — design decision (confirmation card vs. author restriction); worth deciding before this ships.
6. **m1, m2, m3, m4** — small, each a few lines.
7. The rest are polish, docs and perf.
