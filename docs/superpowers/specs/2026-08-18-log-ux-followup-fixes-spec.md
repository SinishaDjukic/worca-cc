# Log-UX Follow-up Fixes — Spec (review findings of commit 5a6d1df2)

**Source:** /code-review of branch `worca-cc/log-ux-review-fixes-implementation-plan-fcec04e8`, diff `HEAD~1` (5a6d1df2 vs dee0cf39). All 15 findings CONFIRMED against source; F1/F4 empirically reproduced. Full suite (2619 tests) is green on the branch — none of these are CI-visible today.

**Policy:** this spec and its plan stay untracked. Never `git add docs/`.

## Findings, by severity (most → least severe)

| # | Severity | Location | Defect |
|---|----------|----------|--------|
| F1 | **critical** | `src/core/claude-runner.mjs:491` | 2000-char tail-cap on non-zero-exit detail starves message-based `classifyError`: recovery marker (session-limit / 401 / 429 / ECONNRESET) >2000 chars before end of stderr no longer triggers recovery — run hard-fails instead of pausing/retrying; early auth error misroutes to 'network'. |
| F2 | **major** | `src/core/orchestrator.mjs:2224` | `phaseAbort.abort()` runs only AFTER `await Promise.allSettled`, so "abort-immediately on first genuine failure" can never cancel a running sibling — a 30-min implementer burns full runtime/tokens under a doomed phase; new docstring (2254-2255) repeats the false claim. PR amplified latency via recovery retries + interactive prompts. |
| F3 | **major** | `src/core/orchestrator.mjs:2272` | `_runDecomposedTask` catch lacks the pauseRequested→'paused' conversion `_runNode` has (2317-2319): usage-limit pause stamps task row + stepper cell 'error' on a merely paused, resumable run; `_buildResumePoint` sees no 'paused' step; `finished_at` falsely stamped. |
| F4 | **major** | `src/core/workspace-scan.mjs:261` | Name-only `isAbort` misses the one abort path yielding an unnamed error: `createWorktree` rethrows spawn-abort as PLAIN Error ('git worktree add failed: The operation was aborted', worktree.mjs:274). Stop during member worktree creation → member 'degraded' + spurious note + delayed stop. |
| F5 | **major** | `src/core/orchestrator.mjs:2291` | `_logStepFailure` head-clips `err.message` with `clip(...,500)` (keeps HEAD), discarding the tail the runner's cap preserved because "the terminal cause sits at the END" — the ONE error-level line loses the cause whenever message >500 chars. New test uses symmetric input, can't catch it. |
| F6 | **major** | `ui/public/app.js:3795` | `paintLogFilters` reads search from a DOM box nothing ever writes; on card rebuild the cloned box is empty and `r.logFilter = effective` wipes the stored search term when a dropdown facet vanished — silently shows lines the user had hidden. |
| F7 | minor | `src/core/claude-runner.mjs:408` | Post-abort suppression covers only stderr; stdout readline handler still `safeEmit`s stream-json after `signal.aborted` — dying child keeps painting tool_use/assistant lines into a paused run. |
| F8 | minor | `src/core/orchestrator.mjs:1355` (+1832) | `stream:'err'` provenance contract violated both ways: graphify warns tagged though preflight fills `stderr` with SYNTHETIC text (timeout: preflight.mjs:250 — also discards real partial bytes; spawn-fail: :231); hooks-failure warning at 1832 embeds real stderr untagged. |
| F9 | minor | `ui/public/app.js:9359` | `loadLiveLogs` appends populated filter bar BEFORE fetch but wires selects/listeners only after success — failed fetch leaves four dead dropdowns, dead search box, copy button with no listener under "Could not load logs". |
| F10 | minor | `src/core/claude-runner.mjs:467` | `stderrBuf` accumulates unbounded for child lifetime; only consumer takes `raw.slice(-2000)` at close — hundreds of KB of MCP chatter held per concurrent child. |
| F11 | minor | `src/core/agent-gen.mjs:205` (+workspace-scan.mjs:406, orchestrator.mjs:3896) | `isAbort` copy-pasted in 3 modules, each with FALSE "import cycle" comment (nothing imports those modules but ui/server.mjs). Only orchestrator copy has a test. Drift proof: this PR needed 3 lockstep fixes. |
| F12 | minor | `src/core/orchestrator.mjs:1779` | `fromStderr`/message invariant hand-threaded: `{ok:false,step,message,fromStderr}` hand-built 5× (orch 1779/1791/1841, worktree 331/338), tagging concept spelled in 3 idioms (string / flag / err.stream). Diff itself shipped one desync (F8's untagged hookErr). |
| F13 | minor | `ui/public/log-filter.mjs:50` | `logLineVisible` = `compileLogFilter(filter)(rec)`: per-line fresh compile+closure on the streaming path; new "parity" test is circular (both sides run the same compiled code). |
| F14 | minor | `ui/public/app.js:7389` | `copyModelEnvValue`'s local flash lacks `flashCopyBtn`'s dataset.label + clearTimeout guards — rapid double-click permanently replaces the button label with '✓'. |
| F15 | suggestion | `test/ui-live-log-dom.test.mjs:13` | `bootLive` byte-identical 37-line copy of `test/ui-running-resume.test.mjs` helper (drift already bit: /log stub added to BOTH this commit); `test/ui-history-logs.test.mjs:197-227` duplicates its own `openLogsPanel`. |

## Acceptance criteria

1. Every finding fixed by a red-first test that fails on 5a6d1df2 for the finding's exact mechanism (asymmetric inputs where symmetry hid the bug), except F15 (pure extraction, guarded by existing suites).
2. Full `npm test` green (2619 existing + new tests).
3. No behavior changes beyond the findings: pause semantics byte-identical, thrown message formats preserved where tests pin them, classification identical to pre-diff full-stderr behavior.
4. Severity order drives fix order within dependency constraints.
