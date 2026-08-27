# Log-UX Review Findings (spec for the fix plan)

Source: adversarially-verified code review of `git diff origin/dev...HEAD` on
`feat/log-ux` (2026-08-17). Scope of the reviewed feature: stderr-as-log-stream
in claude-runner/orchestrator; log search / copy / cycle picker / cycle
separators in the UI. All 15 findings below were confirmed by code-trace or
empirically (fake-bin runs against the real `runClaude`).

Requirement: fix ALL 15. Severity order as listed.

## F1 — `ui/public/app.js:7817` (correctness)
`seedResumedLog`'s NDJSON re-hydration projects only
source/level/text/ts/sub/stepIndex and drops `cycle` (and `stream`) — the same
projection gap this diff fixed in `loadLiveLogs` but missed in this third
projection site. Scenario: run reaches cycle 2 → pause → page reload → Resume
from History: cycle picker omits pre-pause cycles, separators dead in the
seeded head, stderr provenance stripped.

## F2 — `src/core/orchestrator.mjs:2250` (correctness)
Decomposed-implement failures bypass `_runNode` entirely (`_runStep:2118`
returns `_runDecomposedImplement` directly; `_runDecomposedTask`'s catch just
rethrows), so the new terminal `step failed` error line (2289) is unreachable:
a decomposed failure produces ZERO error-level log lines. The same bypass also
skips `_recover`'s retry loop.

## F3 — `ui/public/log-line.mjs:52` (correctness)
`cycleSeparatorBefore` returns null whenever the previously RENDERED record is
cycle-less, and cycle-less lines (artifact events, git/orchestrator notices)
land exactly at cycle boundaries — the flagship "Cycle N" rule is suppressed in
its primary live scenario. History replay of the same run DOES draw it
(artifact events are never persisted), so live and replay diverge.

## F4 — `src/core/claude-runner.mjs:471` (correctness)
stderr chunks are decoded independently with `d.toString()` (no
StringDecoder), so a multi-byte UTF-8 character split across pipe-chunk
boundaries becomes U+FFFD in the user-visible warn lines, the NDJSON, and the
exit-code detail. stdout is immune because readline decodes with an internal
StringDecoder — `createInterface({ input: child.stderr })` fixes this
(verified empirically).

## F5 — `src/core/orchestrator.mjs:2288` (correctness)
The terminal-error-line guard reuses `isAbort()`, which sniffs
`/aborted|stopped/i` on `err.message` (3862), so a genuine CLI failure whose
stderr merely contains "aborted" or "stopped" (e.g. "FetchError: the operation
was aborted", "MCP server stopped unexpectedly") logs NO error line.

## F6 — `src/core/orchestrator.mjs:2494` (correctness)
`stream:'err'` provenance is hand-applied and inconsistent: five
stderr-derived `_log` sites lack the tag (`_recover:2494`, `_runOnce:2344`,
`_recordCommitFailure:1713`, `_snapshotRetained:1673`, `_recordRunWarning`
path), while teardown/commit sites (1424/1471/1579/1764/1776/1810/1826/3322)
tag `ERR_STREAM` unconditionally even when the `|| 'exit N'` fallback produced
non-stderr text ("the tag becomes a lie"). Fix at one seam: derive the tag
from the actual stderr / `err.stream`.

## F7 — `src/core/claude-runner.mjs:474` (correctness)
The stderr framer splits only on `\n`, so CR-rewriting progress output
(spinner/download chatter) emits nothing during the run, grows `stderrCarry`
unbounded with quadratic re-splitting, and is flushed at close as ONE giant
line with embedded `\r`, timestamped at exit. readline's treatment of a lone
`\r` as a line terminator fixes this too (verified empirically).

## F8 — `ui/public/app.js:3725` (correctness)
`onLog`'s DOM trim counts the new `.log-sep` divs in `childElementCount` while
the model cap counts only records and `repaintFilteredLog` applies no DOM cap:
three divergent caps, over-eviction (visible lines silently vanish), and a
possible orphan LEADING "Cycle N" rule after eviction.

## F9 — `src/core/orchestrator.mjs:2289` (correctness)
The terminal error line embeds `err.message` unclipped; for CLI failures that
message contains the ENTIRE accumulated stderrBuf (claude-runner caps
nothing) — arbitrarily huge single log lines into NDJSON/WS/DOM, duplicating
the per-line warns already streamed.

## F10 — `src/core/claude-runner.mjs:485` (correctness)
stderr emission has no abort gate and `flushStderr()` runs before the
`signal?.aborted` early-return in `close`, so a pause/stop logs SIGTERM-time
chatter and a torn mid-write fragment as warn lines into a PAUSED run's log.

## F11 — `ui/public/log-line.mjs:33` (correctness)
`serializeLog` serializes only records, omitting the "── Cycle N ──"
separators the pane visibly renders — copied text loses the one marker
distinguishing a re-run from its first pass.

## F12 — `ui/public/app.js:3616` (correctness)
`copyLogToClipboard` returns silently when serialization yields empty text —
no "copied"/"copy failed" flash on a filtered-empty pane; stale clipboard
content survives and can be mistaken for the filtered log.

## F13 — `test/agent-log.test.mjs:372` (test-coverage)
"a stderr event never touches the tool/init/result branches" is vacuous: it
greps its own single warn line ('plain noise') for arrow/`[init]` prefixes that
can never match under ANY implementation. Deleting the whole stderr branch
still passes it.

## F14 — `ui/public/app.js:7988` (efficiency)
Each debounced search tick wipes and rebuilds the entire pane one node at a
time — up to 4000 lines live and an UNCAPPED record set in History — while
`logLineVisible` re-lowercases the constant term per record. Fix:
DocumentFragment batching, hoist the lowered term per repaint, cap/tail-render
History.

## F15 — `ui/public/app.js:9383` (simplification)
The log filter bar exists twice (declarative in `#run-card-tpl`, imperatively
string-rebuilt in `loadLiveLogs`) with two debounce implementations and three
copies of the filter-reading logic (`paintLogFilters` effective,
`readCardLogFilter`, History's change handler). One shared bar source + one
filter reader.
