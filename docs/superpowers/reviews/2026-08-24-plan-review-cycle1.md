# Plan review — Internal Diff Comments review fixes (cycle 1)

**Plan:** `docs/superpowers/plans/2026-08-24-internal-diff-comments-review-fixes.md`
**Source review:** `docs/superpowers/reviews/2026-08-24-internal-diff-comments-code-review.md` (0 critical · 5 major · 19 minor)
**Original request:** "create an implementation plan for the findings in the review. The implementation plan should be polished, not over-engineered, clean code."
**Date:** 2026-08-24

**Verdict:** BLOCKING — 0 critical, 2 major, 8 minor, 3 suggestions.

---

## How this was verified

Not read-only. I built a throwaway copy of the working tree (`node_modules` symlinked), applied the plan's
production edits and its own proposed tests **verbatim**, and ran them:

| Task | Applied | Result |
|---|---|---|
| 1 (M1, m2, m12a) | orchestrator `_buildResults({stage})`, `_stageWorkingTree({ignoreAbort})`, 4 call sites, empty-patch guard, all 3 tests | **3 fail before, 9/9 after**; full suite 3539 |
| 2 (M5) | `unreadablePath` + `resolveAnchor` refusal + `guardedPath`/`commentBlocked` in `tools.mjs`, both tests | **fails before, 11/11 + 11/11 after** |
| 3 (M3, m12b) | `missingColumns()` split + `repairSchemaGaps` reorder, both tests | stamps 19/20/21 go FALSE→TRUE; **16/16** |
| 4 (M2) | `childTools` name + `pokeCommentWrite` on both branches, the test | **19/19** |
| 5 (M4, m1) | `delete_diff_comment` guard + author check, the test | **11/11** |
| 6 (m4, m5) | scoped `stampSentRunId` + `propose_run` guard | **2 EXISTING tests break** (see M-1); `propose_run` half **43/43** |
| 7 (m6) | `keep` predicate through `comment-deps`, the test | **11/11** |
| 9 (m14/15/17/18) | `pick()`, index hoist, holders filter, cap message, `Number()`, all 3 tests | **14/14** |
| 11 (m7 debounce, m8) | `coalesce()` + both call sites + `onHello` replay, both tests | **both fail before, 27/27 after** (all 5 pre-existing poke tests stay green) |

Aggregate full suite with Tasks 1, 2, 3, 4, 5, 6, 7, 9, 11-coalescer applied: **3551 tests, 3546 pass, 5 fail** —
3 are the known `.git`-absent marketplace failures of a copied tree, and **2 are the real Task 6 breakage**.

Tasks 8, 10, 12, 13, 14 were verified by reading the real code and confirming every anchor, selector, helper and
CSS variable the plan names actually exists (details inline below).

## What is strong

- **Every one of the 24 findings maps to a task**, and the map is honest. I checked each one against the review; the
  coverage table is complete and the fix order matches the review's own recommended order (M1, M5, M3, M2, M4, then minors).
- **It corrects the review where the review was wrong, and proves it.** M3 also breaks at stamp **19** (I reproduced
  `stamp=19 -> uv=21 comment_ids=false`, exactly as the plan claims and the review missed). M5's "the browser cannot
  reach it" mitigation really is false for the rename shape. M3's stated fix ("a pure reorder") really is insufficient
  without the re-probe — `gaps.columns` is computed before the pass.
- **Task 1's ordering argument is right and load-bearing.** Staging before the empty-patch guard is not a style
  preference: reversing them deletes the artifact M1 exists to create. The three tests fail with exactly the messages
  the plan predicts, and the "persists nothing" test confirms no worca-injected file leaks into the newly staged diff —
  the one thing that could have silently broken M1's fix.
- **The `_reportToSource` / `applySchemaV21` doc rewrites are factually correct post-fix.** I instrumented the ladder:
  on a fresh DB `ASK_DDL`, `DIFF_COMMENTS_DDL` and the `comment_ids` ALTER all fire in the **first** `repairSchemaGaps`
  pass (applySchemaV12) once the reorder lands — which is precisely what the plan's replacement text asserts. Replacing
  one wrong comment with another would have been the easy failure here; it did not happen.
- **The two-coalescer decision is the right one and I confirmed why.** A single shared window would have broken
  `test/ui-diff-comments.test.mjs:522` (another run's frame arrives first, then this run's): with two coalescers the
  open-tab poke is still leading-edge and the test stays green. It does. `.unref()` is also correct — `boot()` copies
  only `window/document/location/localStorage/WebSocket/fetch/navigator` onto `globalThis`, so app.js's bare
  `setTimeout` is Node's and does return a `Timeout`.
- **M4 implements the user's locked decision faithfully**: author restriction, no confirmation card, no soft delete,
  tool retained. The guard order (blocked-check first, author-check second) is right — the protected-path refusal stays
  word-for-word the not-found one, so it cannot become an existence oracle.
- **Constraints are respected**: no new imports in `tools.mjs`, no `src/ → ui/public` inversion, the glob preset never
  crosses the wire, nothing under `docs/superpowers/**` is staged.

---

## MAJOR

### M-1 — Task 6 breaks two existing tests it explicitly claims are unaffected

**Where:** Task 6, "Interfaces" block and Step 7.

The plan states: *"`stampSentRunId(commentIds, pipelineId) -> number` — signature and return type unchanged
(`ui/server.mjs:1189` and `diff-comments-store.test.mjs:134` are **unaffected**)."*

That is false. Both existing fixtures stamp against `'abcd1234'`, which is **not a row in `pipelines`**, so the new
`SELECT … FROM pipelines WHERE id = ?` returns undefined and the function returns 0 without writing:

- `test/diff-comments-store.test.mjs:131-139` — `assert.equal(stampSentRunId([...], 'abcd1234'), 1)` and
  `assert.equal(stamped.sentRunId, 'abcd1234')`.
- `test/ask-diff-comment-launch.test.mjs:65-71` — same shape; **the plan does not mention this test at all**, even
  though Task 6 edits that very file in Steps 1–2 and runs it in Step 7.

Reproduced with the plan's exact `stampSentRunId` body:

```
✖ stampSentRunId writes the 8-hex pipeline id and never resolves
  AssertionError: null !== 'abcd1234'
✖ stampSentRunId: sets the 8-hex pipeline id and NEVER resolves
  AssertionError: unknown and malformed ids are ignored
```

This collides head-on with two of the plan's own rules — Global Constraints ("every later task must leave the suite
green") and Task 15 Step 1 ("do not adjust a test to match") — leaving an implementer with a contradiction and no
stated resolution. It also makes every expected count from Task 6 onward (3546 → 3564) wrong by 0 unless the fixtures
are changed, or wrong by −2 if they are left red.

The good news: the production path is fine. `test/ask-api-cards.test.mjs:204` — the real
propose → launch → first-state-event → `stampSentRunId` chain — **passes** under the new scoping, so the `pipelines`
row genuinely exists by the time the stamp fires. The scoping is correct; only the plan's bookkeeping is wrong.

**Fix:** add an explicit step to Task 6 that re-points both fixtures at a real seeded run
(`const target = await seedPipeline(dir, …)` in the same project, then stamp `target.id`), assert the new
"a non-existent run stamps nothing" semantics where `'abcd1234'` used to assert the old ones, correct the
"unaffected" claim, and re-derive the expected counts.

### M-2 — Task 11 Step 6 adds an untested production query change plus an option nothing calls

**Where:** Task 11, Step 6 (`src/core/diff-comments.mjs`, `unresolvedCounts`).

For a finding whose whole content is "the counts endpoint has no limit", the plan ships:

- a new exported constant `UNRESOLVED_COUNTS_MAX` that **nothing imports**;
- a new optional `{ limit }` parameter that **no caller passes** (`ui/server.mjs:1972` and
  `test/diff-comments-store.test.mjs:141` both call `unresolvedCounts()`);
- a `-1` "unlimited" sentinel branch that is therefore **unreachable** (the default is a positive integer);
- a changed SQL shape (`max(rowid) AS last` + `ORDER BY last DESC LIMIT ?`).

And **no test at all**. Task 11's two new tests cover the coalescer and the hello replay; Step 7 runs
`test/diff-comments-store.test.mjs` but the plan adds nothing to it, so the new ordering and the cap are shipped
unexercised — in a plan whose stated discipline is a failing test first for every change, and against a brief that
says "polished, not over-engineered".

**Fix:** either (a) collapse Step 6 to a hardcoded `ORDER BY max(rowid) DESC LIMIT 5000` with the rationale in the
existing doc comment — no export, no parameter, no sentinel — or (b) keep the parameter and add the failing test that
justifies it (seed N+1 commented runs, assert the cap drops the oldest-commented run and keeps the newest). (a) is the
better fit for the brief.

---

## MINOR

### m-1 — Task 1 Step 4 stages outside `_buildResults`' try, contradicting the doc line above it

The snippet puts `if (stage) await this._stageWorkingTree({ ignoreAbort: true });` **before** `try {`, two lines under
`* Best-effort: never throws into run().` On the stopped path `_buildResults()` is called from inside `run()`'s
`catch` (`orchestrator.mjs:753`), so anything that escaped would reject `run()` instead of being swallowed.
`_stageWorkingTree` is documented "never throws" and in practice cannot (only `_git`, which always resolves, and
`_log`), so this is theory — but it silently weakens a stated invariant for no gain.
**Fix:** move the call inside the `try`, or add one sentence saying why outside is deliberate.

### m-2 — Task 9 Step 4's deletion of the old `const guarded` is implicit; missing it is a hard SyntaxError

Step 4 says *"Replace `:86-94`. The `guarded`/`blocked` definitions move **above** `section`; the existing
`guarded(...)` throw stays where it is."* The replacement block re-declares `const guarded`, but the edit range
`:86-94` does **not** include the original declaration at `:101`. Leaving it produces
`SyntaxError: Identifier 'guarded' has already been declared`, which fails the import of `diff-anchor.mjs` and
therefore of `diff-comments.mjs` and `ui/server.mjs` — every DB and route test at once. (I hit this while applying the
task and had to delete `:101` by hand; with the deletion, 14/14 pass.)
**Fix:** state it explicitly — "delete the now-duplicate `const guarded = …` line at `:101`; only the
`if (guarded(...)) throw` stays."

### m-3 — `ui/public/app.js` and `ui/server.mjs` line anchors in the later tasks are pre-edit and will have drifted

Every app.js citation is measured against the Task-0 tree, but Task 10 (Steps 5–6) and Task 11 (Step 3, ~25 inserted
lines at `:9816`) both edit app.js **before** Tasks 12/13/14 run. So `:11871-11881` (Task 12), `:11848-11854`
(Task 13) and `:14923-14924` / `:14891-14894` (Task 14) will all be off by roughly +30 by the time they are reached.
`ui/server.mjs` drifts the same way across Tasks 1, 8 and 10. Separately, the `ui/public/file-tree.mjs` anchors are
simply wrong today: the options destructure is at **:176** (plan says :172), the dir initial state at **:245-253**
(plan says :244-252), the toggle at **:261-267** (plan says :260-266).
**Fix:** one line in Global Constraints — "line numbers are as of the Task 0 commit; locate by the quoted anchor text,
not by number" — and correct the three file-tree numbers.

### m-4 — Task 10 declares `cstate.collapsed` for Task 13, so Task 10's commit ships an unused field

Step 5 adds `collapsed: new Set()` to `cstate` with the note "(`collapsed` is Task 13's; declaring it here keeps
`cstate` in one edit)". Task 10's commit is then not independently reviewable: it introduces state nothing reads, and
Task 13's commit introduces a consumer for state it does not declare.
**Fix:** declare `collapsed` in Task 13 alongside its only consumer; the two-line `cstate` edit is not worth the
cross-task coupling.

### m-5 — Task 14's m13 half is declined in full, and its one code change is untested defensive code

The plan proves `askPanel` is never nulled (`app.js:15033`, `destroy()` never called), so the null-panel branch is
unreachable — then adds a `console.warn` for it anyway ("a tripwire for a future regression, not a live path"), with
no test. The `lineText` half is deliberately declined. Net: m13 produces no tested behaviour change, while adding
exactly the kind of no-caller defensive code the brief asks to avoid. The `lineText` decline itself is well argued and
I would keep it.
**Fix:** either drop the warn (and record m13 as consciously declined, with the reasoning already written), or keep it
and add the one-line test that exercises it via a stubbed `appendToComposer` returning `false`.

### m-6 — Task 7's key assertion tests the implementation, and the double filter is redundant

`assert.equal(typeof opts.keep, 'function', 'the guard reaches the bundle…')` spies on the dep call rather than
asserting behaviour, and Step 4 keeps `raw.filter((c) => !commentBlocked(c))` in `tools.mjs` on top of the new `keep`
predicate — the same rows filtered twice. For a finding that is purely about ordering and cost, the honest behavioural
assertion is the one the plan already has in the second half of the test (a dropped row never gets a `context`); the
spy adds coupling without adding proof.
**Fix:** drop the `typeof opts.keep` assertion (or replace it with a `hunkContext` call counter), and either drop the
now-redundant `tools.mjs` filter or say in one line why belt-and-braces is wanted here specifically.

### m-7 — Three edit instructions leave their replacement text unspecified in an otherwise byte-exact plan

- Task 10 Step 4: *"(The fixture patch for that suite must contain a `.env` section; if it does not, extend the
  suite's `PATCH` constant …)"* — it does: `test/diff-comments-api.test.mjs:57` writes `PATCH + SECRET_PATCH` and
  `SECRET_PATCH` is a `.env` section. The conditional should just be resolved.
- Task 10 Step 6: *"Update the now-wrong comment at `:11729-11733`"* — no replacement text given, for a comment the
  fix makes actively false.
- Task 7 Step 4: *"Add one line to the comment above it saying so."* — no text given.

**Fix:** resolve the first, and write out the two comment replacements the way every other doc edit in this plan is
written out.

### m-8 — Two unremarked side effects of Task 10

- The `.hd-diff-guarded` chip is appended to `.hd-diff-pane-head`, which is `display:flex; justify-content:
  space-between` (`style.css:1886`). Adding a third child re-spaces the existing path/counts pair; the plan supplies
  a chip rule but no layout note and no `margin-left:auto`-style anchor.
- Adding `armCommentGutter(body, lastMeta)` to `repaintCards()` means the gutter is now armed on the two
  early-return bodies (`select()` `:12037` and `:12051`, the "(no textual diff for this file)" notes), which
  `select()` deliberately never arms. Harmless (no `.hd-dl-row` to hover) but it is a real behaviour change the plan
  does not mention.

**Fix:** one sentence each, or gate the `repaintCards` re-arm on the body actually having rows.

---

## SUGGESTIONS

### s-1 — Task 10 is the one task big enough to split

Four production files, a new exported function, a new API response field, a new UI element with CSS, and 5 tests, for
two findings whose only shared surface is `armCommentGutter`. m9 (the re-arm, ~4 lines) and m16 (the server-computed
key list + chip) would each be a small, independently reviewable commit. Not blocking — the task is coherent as
written — but it is the outlier against the plan's own "independently reviewable" standard.

### s-2 — `pokeCommentCounts()` in `onHello` is partly redundant

`onHello` already reaches `loadHistoryView()` at `:801` whenever `currentView() === 'history'`, and that path calls
`refreshCommentCounts()`. The added call is only load-bearing on other views. Worth one clause in the comment so a
future reader does not delete the "duplicate".

### s-3 — `stampSentRunId` reads back `store_key` it already pinned

The `UPDATE … WHERE id = ? AND store_key = ?` guarantees `r.store_key === storeKey`, so the read-back
`SELECT store_key, pipeline_id` and the composite `Map` key are one field wider than they need to be. `SELECT
pipeline_id` keyed on `pipelineId` alone is the same behaviour in fewer moving parts.

---

## Answers to the specific questions asked

**Completeness.** All 24 findings are covered; none is a silent no-op. Two are partially declined and both declines
are stated: m13's `lineText` half (sound — the composer already carries the comment id and
`list_diff_comments` returns `line_text`; quoting a 200-char source line per comment would make a stack of five
unreadable) and m7's `LIMIT` (included, but as belt-and-braces — see M-2, where the problem is the *shape* of the
inclusion, not the decision). m8's fix is genuine: `hello` really is per-connection (`ui/server.mjs:292`, inside the
`connection` handler), so replaying on it does close the reconnect gap.

**Over-engineering.** One clear instance (M-2) and three small ones (m-4, m-5, m-6/the double filter, s-3). Everything
else earns its keep: `commentBlocked`/`guardedPath` is one predicate replacing two near-duplicates;
`pokeCommentWrite` collapses a duplicated block; `missingColumns` is a genuine extraction the fix requires;
`unreadablePath` is four tokens. The `[ab]/`-prefix double test inside `guardedPath` looks defensive but is not — a
quoted `--- "a/old\tsecret.pem"` keeps its `a/` prefix through `stripSide`, so slash-containing patterns need both
forms. No fix is too clever to maintain; the plan errs, where it errs, toward extra rather than terse.

**Correctness of the fixes.** Every fix I could execute closes its finding and introduces no regression (table at the
top). Specifically on the five risk points asked about: the staging/empty-patch interaction is correct **and** the
"persists nothing" case really does stay empty after `git add -A -N` (no injected worca files leak in); the C-quoted
refusal does not disturb the existing rename test at `diff-anchor.test.mjs:118` (unquoted paths, `guarded` still
fires); the `repairSchemaGaps` reorder heals stamps 17–21 and a fresh DB with no ladder step depending on the old
order; `stampSentRunId`'s notify-outside-tx is right (the only production subscriber, `ui/server.mjs:398`, is a
synchronous `broadcast`, and `tx()` is non-re-entrant) and the store scoping is right — its only defect is the fixture
breakage in M-1; the coalescer behaves exactly as specified under `node:test` and leaves all 5 pre-existing poke tests
green.

**Task decomposition.** Order and dependencies are correct throughout: Task 2 precedes its four consumers, Task 1's
internal step order is load-bearing and stated, Task 10 precedes Task 13. No task is artificially split. Task 10 is
the only one that is arguably too big (s-1), and Task 10/13's shared `cstate` declaration is the only decomposition
defect (m-4).

**TDD discipline.** Strong. Every task but one leads with a failing test, and the predicted failure messages are
accurate — I confirmed Task 1's three (`did not match /^diff --git a\/brand-new\.txt…/`, `did not match
/\+errored new file/`, `no 0-byte diff-patch.patch`), Task 2's ("Missing expected exception" — `resolveAnchor` really
does return `lineText: 'SECRET=hunter2'`), Task 3's, and Task 11's both. The exceptions are M-2 (no test at all) and
m-5/m-6 (an untested warn; an implementation-shaped assertion).

**Clean code.** Snippets match house style — `node:test` + `node:assert/strict`, `useTempHome(after)`, duplicated
jsdom preambles rather than a shared harness, the `[diff-comments] …` `console.error` prefix already used at
`ui/server.mjs:1157`, error text in the codebase's second-person voice. No addition trips
`test/ask-diff-comment-tools.test.mjs:173`'s uppercase-SQL scan or `:175`'s import-free scan (verified by running that
file with the changes applied). Comment density is high but consistent with the surrounding files; the one place it
tips over is where a comment justifies code the plan should not add at all (M-2, m-5).

---

## Verdict

Blocking on **M-1** and **M-2**. Everything else is polish. This is an unusually well-grounded plan — nine of its
fourteen tasks reproduce exactly as written against the real codebase, and it corrects its own source review in three
places with evidence. Fix the two majors and it is ready to execute.
