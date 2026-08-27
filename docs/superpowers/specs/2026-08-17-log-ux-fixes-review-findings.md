# Log-UX Fixes Review Findings (spec for the follow-up plan)

Source: four-reviewer parallel code review of `git diff dee0cf39..5a6d1df2` on
`worca-cc/log-ux-review-fixes-implementation-plan-fcec04e8` (2026-08-17). The
reviewed commit implements the 15 findings of
`2026-08-17-log-ux-review-findings.md` per
`plans/2026-08-17-log-ux-review-fixes.md`.

Reviewer split: (A) `claude-runner.mjs` / F4·F7·F10, (B) `orchestrator.mjs` /
F2·F5·F6·F9, (C) UI correctness / F1·F3·F8·F11·F12, (D) perf + dedup + test
audit / F13·F14·F15.

Every finding below is marked CONFIRMED (reproduced or code-traced) or
PLAUSIBLE (reasoned only). Full suite `npm test` → **2619 pass / 0 fail**,
verified independently by three reviewers. No Critical issues. Working tree,
index and HEAD untouched by the review; all mutation experiments ran on
`git archive` extracts in a scratchpad.

## Verdict on the 15 original findings

FIXED: F1, F2, F3, F4, F5, F7, F8, F10, F11, F12, F13, F14, F15.
FIXED with one straggler: F6 (see R8).
PARTIALLY FIXED: F9 (see R1, R4, R5).

Notable: each UI fix landed at a *single shared seam* rather than by patching
call sites, so live and History replay are now identical by construction, not
by two implementations agreeing. F2 was fixed architecturally (shared
`_logStepFailure` called from both catches) rather than forcing decomposed work
back through `_runNode`, avoiding double-recorded steps. The implementer also
caught a consequence the plan missed: routing decomposed tasks through
`_runNodeAttempts` changes what a paused task rejects with, so `!isPause`
was added to the first-genuine-failure scan (`orchestrator.mjs:2222`) —
without it a usage-limit pause would be recorded as the phase's failure.

## Important

### R1 — `src/core/orchestrator.mjs:2291` (correctness) — CONFIRMED
`clip(err.message, 500)` is a **head** clip (`:4188` = `slice(0, n-1) + '…'`)
over a string the runner **tail**-capped on purpose
(`claude-runner.mjs:490`: "Tail, not head: the terminal cause sits at the END").
Head-clipping a tail-capped string discards exactly the half that was kept.
Reproduced: 60 chatter lines + `FINAL CAUSE: boom`, tail-capped at 2000 →
`log line contains FINAL CAUSE? false`; the verdict line reports
"chatter line 18". Aggravating factor: `ui/public/app.js:4361`
(`function onError(r) { finishRun(r, 'error'); }`) discards `msg.message`
entirely, so the log pane is the only live surface for the cause. Unrecoverable
when `stderrBuf` was empty and the detail came from the stdout `is_error`
envelope (`claude-runner.mjs:489`) — that text was never streamed as warns.
Fix: clip from both ends, e.g. `${m.slice(0,120)} … ${m.slice(-370)}`.

### R2 — `ui/public/app.js:9359-9363`, `9403-9420` (correctness) — CONFIRMED
The cloned History filter bar is mounted **before** its listeners are attached,
and on a `/log` fetch failure it is **never** wired. Reproduced with `/log`
returning 500: `Could not load logs: HTTP 500` renders *plus* a complete filter
bar — `SELECT OPTION COUNTS: 0,0,0,0`, and a copy click leaves the label at
`"copy"` with no state change. This is the dead-control anti-pattern F12 was
filed to eliminate, reintroduced elsewhere, and a regression from base (base
left an empty `.log-filters` with nothing to click). Also visible transiently
while a large NDJSON downloads.
Fix: `panel.append(bar, box)` only after wiring, or `bar.hidden = true` until
wired and leave it hidden in the `catch`.

### R3 — `ui/public/app.js:3675-3676` (efficiency) — CONFIRMED, magnitude disputed
`trimLogDom` reads a **live** `HTMLCollection`'s `.length` on every streamed
line; each append invalidates the collection, so the next read re-walks up to
4000 children — per incoming line, per visible run card.
Measured by (D) on `test/ui-live-log-dom.test.mjs`, 3 runs each: as committed
`9033/9214/9844 ms`, with the guard `1422/1431/1450 ms` → **6.4x**, all tests
still passing. (C) measured only ~10% against base's `childElementCount`
(6.0–6.3 s vs 5.46 s for 4000 appends) and withdrew a larger outlier that did
not reproduce. The two harnesses disagree on how much *worse than base* HEAD
is; both agree the guard is a strict improvement. Land it — this commit's own
mandate was log-pane efficiency.
Fix (safe: `lines ⊆ children`, so `lines.length <= childElementCount`; keep the
leading-separator strip *outside* the guard):
```js
if (logEl.childElementCount > MAX_LOG_LINES) {
  const lines = logEl.getElementsByClassName('log-line');
  while (lines.length > MAX_LOG_LINES) logEl.removeChild(logEl.firstElementChild);
}
```
Side effect: `ui-live-log-dom.test.mjs` drops from 9.4 s to ~1.4 s (13.5% of
the 69 s suite).

### R4 — `src/core/claude-runner.mjs:466-472` (correctness) — CONFIRMED
The per-line stderr event text is uncapped, and readline's line buffer is
unbounded, so progress renderers built on ANSI cursor escapes
(`log-update`/`ansi-escapes`, redrawing with `\x1b[2K\x1b[1A`) emit **neither
`\n` nor `\r`** — readline never sees a terminator, the whole run's stderr
accumulates, and it surfaces as ONE event at stream end. `orchestrator.mjs:3005`
logs it verbatim; `_log` truncates nothing. Reproduced: a child writing 8 MB
with zero newlines → `events=1 longest text=8388608 chars`. This is F9's exact
harm ("arbitrarily huge single log lines into NDJSON/WS/DOM") reached through
the per-line path, and the UI's F8/F14 caps count *lines*, not bytes, so they
give no protection. **Plan gap** — neither Task 1 nor Task 3 caps the emitted
line.
Fix: clamp before emitting, e.g.
`raw.length > LINE_MAX ? raw.slice(0, LINE_MAX) + ` …[+${raw.length - LINE_MAX} chars]` : raw`.

### R5 — `src/core/claude-runner.mjs:372`, `:467` (efficiency) — CONFIRMED
`stderrBuf` is unbounded and, past its last ~2000 chars, provably dead weight:
its only read is `:488`, inside `if (code !== 0)`; the abort path returns at
`:481` and the success path never touches it (`:501`). With Task 3's tail cap
at most `STDERR_DETAIL_MAX` chars can reach any consumer. Reproduced: 24 MB of
newline-terminated stderr on an **exit-0** run → heap `4.9 MB → 23.6 MB`, never
read. Unbounded per-run growth in a long-lived server process, for data
unreadable by construction. Residual of F9's own parenthetical ("claude-runner
caps nothing") — the plan capped the message, not the buffer.
Fix (idiom already in the codebase at `src/core/chat/channel-host.mjs:254`),
keeping margin above the cap so the `…` marker still triggers:
`stderrBuf = (stderrBuf + line + '\n').slice(-(STDERR_DETAIL_MAX + 512));`

### R6 — F6 site applications have NO regression lock — CONFIRMED (twice)
`test/log-provenance.test.mjs` tests only the pure `errStreamAttr` helper.
(B) grepped every test: zero assertions on `stream` at any converted site —
teardown (`:1433/1480/1588`), `_commitWork` (`:1778/1790/1824/1840`), graphify
(`:1355/1394`), initial checkpoint (`:3352`). (D) reverted **all 15** call sites
to the unconditional `ERR_STREAM` and ran the full suite on the copy: **zero**
new failures (the 3 deltas fail on the pristine copy too — `git archive`
extracts have no `.git`). F6's whole content is "the tag must stop lying at
these sites"; that is exactly what is unlocked. This is the F13 failure mode
recurring: the test locks the helper the fix introduced, not the behavior the
finding described.
Fix: drive `_commitWork` against a repo where `git commit` fails with **empty**
stderr (so `message` is the `exit N` fallback) and assert the warn has **no**
`stream`; mirror case with real stderr asserting `stream === 'err'`.
`test/run-root-teardown.test.mjs`'s `freshRepo()` harness already provides the
repo.

### R7 — `test/ui-live-log-dom.test.mjs:81` is vacuous — CONFIRMED (twice)
"eviction never leaves a separator leading the pane" passes verbatim against a
full revert of `ui/public/*` to `dee0cf39`. With 1 cycle-1 line + *exactly*
4000 cycle-2 lines, base's `while (childElementCount > MAX)` coincidentally
evicts both the record and the separator and lands on an identical end state;
the orphan exists transiently at 3999 lines but the test asserts only the end
state. F8's orphan-leading-separator half therefore ships unguarded.
Fix: use **3999** cycle-2 lines. Verified both ways — fails on base
(`AssertionError: exactly 4000 records entered — nothing to evict`;
`.log-line` = 3999, `firstElementChild` is `.log-sep`), passes on HEAD.

### R8 — `src/core/orchestrator.mjs:1832` (correctness) — CONFIRMED
An stderr-derived `_recordRunWarning` still carries no provenance, eight lines
below its own tagged twin. `hookErr` is computed at `:1823` from
`commit.stderr.trim() || \`exit ${commit.code}\``; `:1824` logs it **with**
`errStreamAttr(commit.stderr)`, `:1832` embeds the same `hookErr` with no attr.
The plan's Task 6 Step 4.5 claims "every other existing caller stays attr-less
(their texts are worca's own summaries)" — false for this one caller; the other
five (`:947`, `:1279`, `:1542`, `:1617`, `:1620`) are genuinely worca's own
summaries and correctly untagged. **Plan defect faithfully reproduced.** The
original F6 wording ("`_recordRunWarning` path") covered this site; the plan
read it narrowly.
Fix: pass `errStreamAttr(commit.stderr)` as the second argument.

### R9 — F15 has no "one source" lock; reader and debounce have no test at all — CONFIRMED
`test/ui-history-logs.test.mjs:308` ("the History filter bar is the run-card
template bar") passes against a `dee0cf39` checkout — the deleted string
builder produced a byte-identical class list in the same order and already set
`aria-label` on the search and `type="button"` on copy. It *is* a drift guard
(mutating `buildLogFilterBar` into a hand-built bar with the copy button first
does fail it), but the duplication it is named after was never detectable. The
plan sanctioned this at line 1314 ("acceptable for this one task"), so it is a
known gap, not drift — recorded so it stops reading as covered.
Fix: compare markup, not class lists —
`buildLogFilterBar().outerHTML === tplBar.outerHTML` before `fillFilterSelect`
populates options.

## Minor

### M1 — surrogate splitting at both new truncation seams — CONFIRMED
`claude-runner.mjs:491` `raw.slice(-STDERR_DETAIL_MAX)` and
`orchestrator.mjs:4188` `clip` both count UTF-16 code units, so a cut inside an
emoji leaves a lone surrogate: `lone-surrogate-present=true`, message head
`code 1: … \ude80🚀`; UTF-8 bytes at the boundary `ef bf bd` = U+FFFD.
`JSON.stringify` keeps the NDJSON valid, but the UI renders `�` — the exact
symptom F4 removed, reappearing one char after the `…`. `clip` is pre-existing,
but F9 newly routes raw CLI stderr (the likeliest source of astral chars)
through it. BMP box-drawing (U+2500) is one code unit and safe.
Fix: strip a leading lone low surrogate after the tail slice; back the head cut
off by one when `s.charCodeAt(n-2)` is a high surrogate.

### M2 — `src/core/orchestrator.mjs:2524`, `:2373` (consistency) — CONFIRMED
`_recover`'s `recoverable ${cls} error: ${err.message}` and `_runOnce`'s
`session resume failed (${err?.message || err})` are still unclipped. F9's
"arbitrarily huge" is genuinely gone (the runner's cap bounds them to ~2050),
but the largest single record from a CLI failure is now a *warn* at four times
the cap applied to the *error* line, and both keep raw newlines (`clip`
collapses whitespace; these don't). `run-log.mjs:34` `JSON.stringify` keeps
NDJSON framing safe. Fix: route both through `clip(..., 500)`.

### M3 — `src/core/claude-runner.mjs:407`, `:465` — CONFIRMED harmless today
Neither `createInterface` passes `crlfDelay: Infinity`, unlike the codebase's
other two readline-over-pipe sites (`chat/channel-host.mjs:256`,
`chat/channel-worker-child.mjs:53`). With the default 100 ms a `\r\n` whose
halves straddle a slow chunk counts as two breaks; the `if (text)` guard drops
the resulting empty event, but a stray blank line still enters `stderrBuf` and
the exit detail. `crlfDelay: Infinity` does not affect lone-`\r` framing, which
is what F7 needs.

### M4 — `ui/public/app.js:3795` — shared reader silently changed `paintLogFilters` — CONFIRMED
Old: `search: r.logFilter.search` (model wins — "free text: no facet to vanish
from"). New: `readLogFilterFrom` reads the DOM box, and `buildRunCard` clones a
template whose `.log-search` is empty, so when a dropdown facet *also* vanishes
the comparison at `:3796-3799` trips and commits `search: ''`. Probed both
trees: HEAD → `{"search":""}`, base → `{"search":"pass"}`. Plan-prescribed, so
a plan issue as much as an implementation one; arguably the better outcome, but
untested and it self-heals only when a dropdown axis differs. Root cause is
pre-existing and one line from fixed: nothing ever rehydrates the box
(`log-search` appears at `8002`, `8034`, `9409`, never as `.value =`).
Fix: `node.querySelector('.log-search').value = r.logFilter.search || '';`
before `paintLogFilters(r, node)` in `buildRunCard` (`app.js:9805`).

### M5 — F12's feedback is sighted-only — CONFIRMED
`ui/public/index.html:377` gives the copy button
`aria-label="Copy the visible log lines"`, which wins over element contents in
the accessible-name computation, so swapping `textContent` to `copied` /
`copy failed` / `nothing to copy` announces nothing to a screen reader.
Fix: have `flashCopyBtn` (`app.js:3635`) also set `aria-label` to `msg` and
restore it on the same timer.

### M6 — `src/core/agent-gen.mjs:201`, `src/core/workspace-scan.mjs:402` — CONFIRMED
The "import cycle" justification for the local `isAbort` copies is factually
wrong: `orchestrator.mjs` imports neither module and neither imports it (only
`ui/server.mjs:72-73` does). Keeping the copies is still defensible — importing
a 4200-line module with import-time DB/FS side effects for a one-line predicate
is worse — but the stated reason will mislead the next editor.

### M7 — `src/core/orchestrator.mjs:2292` — dead `stepKey` — CONFIRMED
`_log` (`:3728-3739`) reads only `nodeId`, `stepIndex`, `cycle`, `sub`,
`stream`; the emitted record shows `stepKey: undefined`. Carried over verbatim,
so not a regression, but `_logStepFailure` now computes `this._stepKeyFor(...)`
on every terminal failure for nothing. Drop it or wire it into `_log`.

### M8 — F4's root cause survives outside the spec's scope — CONFIRMED
The per-chunk `d.toString()` decode F4 condemns still lives at
`src/core/worktree.mjs:76-77`, `src/core/git-info.mjs:21-22`,
`src/core/orchestrator.mjs:3548-3549`, `src/core/folder-dialog.mjs:51-52`.
Those strings feed `errStreamAttr`-tagged warns, so a git error with a
chunk-split multi-byte char shows `�`. One-line fix already used at
`src/core/plugin-shim.mjs:166-167`: `child.stderr.setEncoding('utf8')`.

### M9 — `stream` is plumbed end-to-end with zero readers — CONFIRMED
`stream` appears only at `app.js:3736` and `log-line.mjs:62`: no render, no CSS
class, no facet (`logFacets` has no stream axis; `buildLogLine` destructures
only `{source, level, text, ts, sub}`). F1's "provenance survives the seed" is
satisfied as *data* and `test/ui-running-resume.test.mjs:104` locks a field
with no reader. Fine as forward plumbing; will rot without a follow-up badge or
facet.

### M10 — recovery classification now sees only the stderr tail — mechanism CONFIRMED, frequency PLAUSIBLE
`src/core/recoverable-error.mjs:17` `classifyError` reads `err.message`, which
is now the tail 2000 chars. A recoverable keyword appearing early in a long
stderr (a 429 notice, then 300 lines of chatter) is no longer visible, so that
failure will not retry. The premise of the tail cap is that the terminal cause
*is* at the tail, so practical frequency is likely low.

### M11 — the F10 abort gate silences more than pause/stop — CONFIRMED, confirm intent
For decomposed tasks the signal is
`AbortSignal.any([abort, pauseAbort, phaseAbort])` (`orchestrator.mjs:2263`),
and a *sibling task's genuine failure* calls `phaseAbort.abort()` (`:2224`), so
one task failing also stops logging the surviving siblings' stderr. Defensible
(the phase is being torn down) but broader than F10's stated scope.

### M12 — `test/log-filter.test.mjs:118` is tautological — CONFIRMED
"compileLogFilter matches logLineVisible on every axis" cannot fail:
`logLineVisible` now *delegates* to `compileLogFilter` (`log-filter.mjs:50-52`),
so both sides run the same code. Proven by deleting the search axis from the
compiled predicate — the parity test stayed green while four pre-existing
search tests went red (those are the real guard). Harmless; either delete it or
comment it as a delegation smoke test, not a semantics guard.

### M13 — residual duplication and dead code (F14/F15 tail) — CONFIRMED
`readCardLogFilter` / `prevSearch` are now unreachable (`.log-search` lives in
the template, so `searchEl` is never null). Two paint loops remain —
`repaintFilteredLog` (`app.js:3839`) and `loadLiveLogs`'s `paint` (`:9377`) —
with `'(no lines match the filter)'` duplicated at `:3866` and `:9394`, and
only History tail-capping/announcing. Out of the plan's scope (F15 unified the
bar, not the loop); next duplication to collapse.

### M14 — `src/core/orchestrator.mjs:3502` — CONFIRMED honest but off-seam
The one remaining unconditional `ERR_STREAM`. Its guard
(`if (!res.ok && res.stderr && res.stderr.trim())`) proves stderr is non-empty,
so the tag cannot lie. `errStreamAttr(res.stderr)` would make the seam
exhaustive. Related: `:1684/1717/1726` use the `x ? ERR_STREAM : null` idiom,
so there are two provenance idioms rather than the one F6 asked for — all
truthful (each boolean derives from the real source), and
`errStreamAttr(snap.fromStderr)` already works as-is (`String(true).trim()` is
truthy), so unifying is a zero-risk edit.

### M15 — `test/runner-error-surface.test.mjs:161-167` does not test liveness — CONFIRMED
The "framed live" test writes `10%\r20%\r30%\n` in a single `printf`, so all
three frames arrive in one chunk and only the split is asserted. Still
non-vacuous (base yields one `'10%\r20%\r30%'` event) but F7's *live* half
rests on nothing in the suite; liveness was verified separately by probe
(events at 363/670/977 ms of a 1286 ms run).

## Findings with no regression lock

Recorded so they stop reading as covered:

- **F6** — helper locked, all 15 site applications unlocked (R6).
- **F15** — the only new test passes on the pre-fix tree; reader and debounce
  unification have no test at all (R9).
- **F14, DocumentFragment half** — reverting both fragment loops leaves
  `ui-history-logs`, `ui-live-log-dom` and `log-filter` green. jsdom cannot
  measure reflows; cheap proxy is spying on `appendChild` and asserting one
  call per record batch. The hoisted-term and History-cap halves *are* locked
  (mutation-proven).
- **F2, recovery half** — `test/decomposed-error-line.test.mjs` test 3 stubs
  `_runNodeAttempts`, the very method whose insertion is the fix, so it locks
  "one error line via the attempt loop" but not that recovery / usage-limit
  pause actually runs for a decomposed task.
- **F8, leading-separator eviction** — R7. The sibling record-cap test is a
  real lock, so F8 is covered overall.
- **F12, failure branches** — no test covers `copy failed` (no `execCommand` or
  `copy failed` assertions exist anywhere in `test/`), nor the History `/log`
  failure path (R2).

F1, F3, F4, F5, F7, F9, F10, F11, F13 each have at least one demonstrated real
lock. `test/runner-error-surface.test.mjs` is exemplary: real `spawn` against
generated `/bin/sh` fakes, genuine byte-level chunk splits
(`printf '\342\200'` / `sleep 0.2` / `printf '\246\n'`), and `exec sleep 5` so
SIGTERM reaches the process holding the stderr pipe. 5 of its 12 tests fail
against `dee0cf39`.

## Observations (no action requested)

- `orchestrator.mjs:2207-2226` — "Abort-immediately on the FIRST genuine
  failure" does not do that: `await Promise.allSettled(...)` returns only after
  every task settles, so `phaseAbort.abort()` at `:2224` can never cancel a
  sibling. Pre-existing at `dee0cf39`, unchanged here. N genuinely-failing
  tasks in one phase each emit their own error line, which matches
  `_logStepFailure`'s documented contract.
- `orchestrator.mjs:2277` — a paused decomposed task is marked `'error'`, never
  `'paused'`, so `_buildResumePoint` (`:2093`) always yields `kind:'boundary'`
  and resume re-runs the whole decomposed step. Identical in the pre-change
  `finally`; the commit strictly improves this path by making usage-limit pause
  reachable at all.
- Decomposed retry re-runs the implementer over a tree carrying its own partial
  files plus concurrent sibling writes — identical to a retried normal
  implementer node, and per-task commits don't exist (commit happens once at
  teardown), so there is no partial-commit hazard.
- `claude-runner.mjs:474-476` wraps a child `'error'` event in a plain `Error`
  with no name stamp; if it fired during an abort the new `isAbort` would miss
  it and emit a spurious `step failed` line. Very likely unreachable (`'error'`
  fires only on spawn failure; kill failures are caught synchronously at
  `:381-385`; stdin is `'ignore'`). PLAUSIBLE. Cheap hardening: stamp
  `name='AbortError'` when `signal?.aborted`.
- Backward compatibility verified: `fromStderr` is never persisted, so old rows
  and old NDJSON read identically; old NDJSON without `cycle`/`stream` still
  renders (`projectLogRecord` omits absent keys, `logFacets` offers no cycle
  values, `cycleSeparatorBefore` returns `null`).
- XSS clean: every new text sink is `textContent`; `innerHTML` is only ever
  assigned `''`. No listener leaks (live handlers are delegated on `runListEl`;
  History's three ride a bar rebuilt after `panel.innerHTML = ''`).
- Unplanned a11y win: cloning `.log-filters` from `#run-card-tpl` gives
  History's four `<select>`s the `title`/`aria-label` the deleted string
  builder never set.
- The suite uses `node --test` (`package.json:25`), not vitest.

## Suggested fix order

1. R1, R8 (one-line each, `orchestrator.mjs`) + R3 (one-line guard) + R7
   (4000 → 3999) — smallest edits, largest correctness/perf return.
2. R2 (wire-before-mount) and R4, R5 (runner byte caps) — bounded, each
   closes a stated goal of the original spec that currently regresses or
   escapes.
3. R6, R9 — test debt; land as follow-ups but record them.
4. M1, M2 as a single truncation-hygiene pass; the rest at leisure.
