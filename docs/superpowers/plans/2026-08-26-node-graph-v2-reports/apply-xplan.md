# Apply report — cross-plan contract manifest → the 8 node-graph v2 plans

Applied 2026-08-27 by the edit-manifest applier (Opus).
Source: `scratchpad/reports/xplan-manifest.md` §B — 84 edits / 136 old→new replacements.
Targets: the 8 untracked plan files under `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/`.
Pristine v1 copies: `scratchpad/v1-snapshots/` (read-only reference, untouched).

## Result

- **136/136 replacements applied. 0 SKIPPED.**
- Every `old_string` was re-verified against the LIVE file immediately before its own replacement, with all earlier edits to that file already in place (progressive application in manifest order). Match count was exactly 1 for all 136.
- Every `new_string` was re-grepped after the write: present, exactly once, in all 136 cases.
- No repo file other than the 8 plan files was written. No git command other than read-only `git status --porcelain` was run; `git status` is byte-identical to the session-start snapshot (`?? PR_DESCRIPTION.md`, `?? docs/superpowers/`, `?? marketing/`, `?? worca-showcase.html`).

## Method note (exactness)

Replacements were made as exact literal string substitutions (verbatim `old_string` → `new_string`, indentation/backticks/markdown preserved byte-for-byte, `count=1`), driven from a parser over §B rather than by hand. The parser was validated before any write: it recovered exactly 84 edit labels and 136 old/new pairs (matching the manifest's own counts), handled the 6 blocks that contain nested ```` ```js ```` fences (`P2-E5` old+new, `P4-E20` new, `P5-E3` new, `P5-E5` new, `P7-E2` old) by closing each block at the LAST fence before the next structural marker, and reported balanced fences and no marker/label leakage in every one of the 272 blocks. This is functionally identical to the Edit tool's exact-match semantics and avoided pulling 1.5 MB of plan text through the reader.

## First-line uniqueness

The manifest's `grep -c -F '<first line>'` precheck was run for all 136. It returned exactly 1 for 133. Three needed the disambiguation the procedure calls for — their first line repeats in the file, but the FULL multi-line `old_string` the manifest quotes occurs exactly once, so the target was unambiguous and the edit was applied:

| edit | first-line hits in file | full `old_string` hits |
|---|---|---|
| P2-E8 | 2 | 1 |
| P4-E6 | 35 | 1 |
| P4-E12 | 33 | 1 |

## Skipped

None.

## Ledger

`n` = position in manifest order. `fl` = first-line grep hits at apply time. All rows applied.

| n | edit | plan | status | fl | note |
|---|---|---|---|---|---|
| 1 | P1-E1 | P1 | applied | 1 | (A27 — `BOOKEND_EXECUTION_IDS` lands in the shared constants) |
| 2 | P1-E2 | P1 | applied | 1 | (A27 — test import) |
| 3 | P1-E3 | P1 | applied | 1 | (A27 — one pin; the suite count in this task becomes 10) |
| 4 | P1-E4 | P1 | applied | 1 | (A27 — expected count) |
| 5 | P1-E5 | P1 | applied | 1 | (A27 — Interfaces list of Task 5) |
| 6 | P1-E6 | P1 | applied | 1 | (A28 — pin the `wf_clarify-implement` pairing statically) |
| 7 | P1-E7 | P1 | applied | 1 | (A28 — mutation audit (c) no longer claims a dynamic V24) |
| 8 | P1-E8 | P1 | applied | 1 | (A28 + A18 — Q&A) |
| 9 | P2-E1 | P2 | applied | 1 | (A30 — `KINDS` is an array) |
| 10 | P2-E2 | P2 | applied | 1 | (A20 — V4 texts, table row) |
| 11 | P2-E3 | P2 | applied | 1 | (A20 — V4 code) |
| 12 | P2-E4 | P2 | applied | 1 | (A20 — V4 tests) |
| 13 | P2-E5 | P2 | applied | 1 | (A1 — the `resolveGraph` contract block) |
| 14 | P2-E6 | P2 | applied | 1 | (A1/A16 — read + clone) |
| 15 | P2-E7 | P2 | applied | 1 | (A1/A20 — substitution on the template + unknown-key text) |
| 16 | P2-E8 | P2 | applied | 2 | (A1 — entry fields) |
| 17 | P2-E9 | P2 | applied | 1 | (A1 — entry `config`) |
| 18 | P2-E10 | P2 | applied | 1 | (A1 — duplicateKey, ports/loops computed once) |
| 19 | P2-E11 | P2 | applied | 1 | (A1 — return) |
| 20 | P2-E12 | P2 | applied | 1 | (A1 — tests: the resolver returns ports/loops) |
| 21 | P2-E13 | P2 | applied | 1 | (A1 — tests: workspace substitution reaches the template) |
| 22 | P2-E14 | P2 | applied | 1 | (A20 — refusal test regex) |
| 23 | P2-E15 | P2 | applied | 1 | (A20 — refusals prose) |
| 24 | P2-E16 | P2 | applied | 1 | (A16 — B7 bullet) |
| 25 | P2-E17 | P2 | applied | 1 | (A16 — B7 test names/asserts) |
| 26 | P2-E17 | P2 | applied | 1 | (A16 — B7 test names/asserts) |
| 27 | P2-E17 | P2 | applied | 1 | (A16 — B7 test names/asserts) |
| 28 | P2-E17 | P2 | applied | 1 | (A16 — B7 test names/asserts) |
| 29 | P2-E17 | P2 | applied | 1 | (A16 — B7 test names/asserts) |
| 30 | P2-E18 | P2 | applied | 1 | (A16 — B7 server code) |
| 31 | P2-E19 | P2 | applied | 1 | (A19 — B8 prose) |
| 32 | P2-E20 | P2 | applied | 1 | (A16 — handoff sentence) |
| 33 | P2-E21 | P2 | applied | 1 | (A16/A19/A1 — Q&A) |
| 34 | P2-E21 | P2 | applied | 1 | (A16/A19/A1 — Q&A) |
| 35 | P2-E21 | P2 | applied | 1 | (A16/A19/A1 — Q&A) |
| 36 | P3-E0 | P3 | applied | 1 | (status banner — insert directly under the title line) |
| 37 | P3-E1 | P3 | applied | 1 | (A30 — `FLOW_KINDS` is an array) |
| 38 | P3-E2 | P3 | applied | 1 | (A10 — settled `firedOutputs` signature) |
| 39 | P3-E3 | P3 | applied | 1 | (A9 — slice record carries its number) |
| 40 | P3-E4 | P3 | applied | 1 | (A9 + A34 — the slice's execute args carry the lineage the adapter writes on the ledger row) |
| 41 | P3-E5 | P3 | applied | 1 | (A9 — the `exec` event) |
| 42 | P3-E6 | P3 | applied | 1 | (A9 — snapshot shape doc) |
| 43 | P3-E7 | P3 | applied | 1 | (A9 — Q&A) |
| 44 | P4-E0 | P4 | applied | 1 | (status banner) |
| 45 | P4-E1 | P4 | applied | 1 | (A1 — the `resolveGraph` contract P4 consumes) |
| 46 | P4-E2 | P4 | applied | 1 | (A8 — `QUIESCENCE_WARNING` is P3's export) |
| 47 | P4-E3 | P4 | applied | 1 | (A8 — delete the local constant) |
| 48 | P4-E4 | P4 | applied | 1 | (A17 — `_initRunners` is the constructor seam; A1 — comment) |
| 49 | P4-E4 | P4 | applied | 1 | (A17 — `_initRunners` is the constructor seam; A1 — comment) |
| 50 | P4-E5 | P4 | applied | 1 | (A1/A2/A17/A36 — `_resolveTopology` + adoption; `_overlays`/`_agentKeys` deleted) |
| 51 | P4-E6 | P4 | applied | 35 | (A1/A36 — adoption is an alias; forcing and Tarjan are the resolver's) |
| 52 | P4-E7 | P4 | applied | 1 | (A1 — rehydrate uses the resolver's key set) |
| 53 | P4-E8 | P4 | applied | 1 | (A17 — `_engineRun` signature/JSDoc; A6 — the task document) |
| 54 | P4-E8 | P4 | applied | 1 | (A17 — `_engineRun` signature/JSDoc; A6 — the task document) |
| 55 | P4-E8 | P4 | applied | 1 | (A17 — `_engineRun` signature/JSDoc; A6 — the task document) |
| 56 | P4-E9 | P4 | applied | 1 | (A3 — the two scheduler callbacks) |
| 57 | P4-E10 | P4 | applied | 1 | (A8 — warnings come from the scheduler) |
| 58 | P4-E11 | P4 | applied | 1 | (A7 — `_syncSchedulerState` reads P3's `getState()` shape) |
| 59 | P4-E11 | P4 | applied | 1 | (A7 — `_syncSchedulerState` reads P3's `getState()` shape) |
| 60 | P4-E12 | P4 | applied | 33 | (A3 — the ask adapter replaces `_gateAsk`) |
| 61 | P4-E13 | P4 | applied | 1 | (A5 — pause answer) |
| 62 | P4-E14 | P4 | applied | 1 | (A9/A34 — ctx carries the slice lineage) |
| 63 | P4-E15 | P4 | applied | 1 | (A34 — ledger row) |
| 64 | P4-E16 | P4 | applied | 1 | (A34 — `exec_meta` write + read) |
| 65 | P4-E16 | P4 | applied | 1 | (A34 — `exec_meta` write + read) |
| 66 | P4-E17 | P4 | applied | 1 | (A1 — `resolvedFromManifest` returns the resolver shape) |
| 67 | P4-E17 | P4 | applied | 1 | (A1 — `resolvedFromManifest` returns the resolver shape) |
| 68 | P4-E17 | P4 | applied | 1 | (A1 — `resolvedFromManifest` returns the resolver shape) |
| 69 | P4-E18 | P4 | applied | 1 | (A17/A37 — the v2 resume audit line) |
| 70 | P4-E19 | P4 | applied | 1 | (A29 — the alias row has the standard template shape) |
| 71 | P4-E20 | P4 | applied | 1 | (A4 — `question` events name the wire and the execution; insert as Step 3b of Task 1) |
| 72 | P4-E21 | P4 | applied | 1 | (Q&A — A5, A8, A2, A3) |
| 73 | P4-E21 | P4 | applied | 1 | (Q&A — A5, A8, A2, A3) |
| 74 | P4-E21 | P4 | applied | 1 | (Q&A — A5, A8, A2, A3) |
| 75 | P4-E21 | P4 | applied | 1 | (Q&A — A5, A8, A2, A3) |
| 76 | P5-E0 | P5 | applied | 1 | (status banner) |
| 77 | P5-E1 | P5 | applied | 1 | (A14 — Task 1 Interfaces: the view consumes the shared bounds/fit) |
| 78 | P5-E2 | P5 | applied | 1 | (A11 — `render` takes no decor; the view has no `applyDecor`) |
| 79 | P5-E2 | P5 | applied | 1 | (A11 — `render` takes no decor; the view has no `applyDecor`) |
| 80 | P5-E2 | P5 | applied | 1 | (A11 — `render` takes no decor; the view has no `applyDecor`) |
| 81 | P5-E2 | P5 | applied | 1 | (A11 — `render` takes no decor; the view has no `applyDecor`) |
| 82 | P5-E3 | P5 | applied | 1 | (A11 — Task 2 Interfaces) |
| 83 | P5-E4 | P5 | applied | 1 | (A11 — Task 2 test: bands, plus the two chrome/badge pins; insert the new tests BEFORE the existing one) |
| 84 | P5-E4 | P5 | applied | 1 | (A11 — Task 2 test: bands, plus the two chrome/badge pins; insert the new tests BEFORE the existing one) |
| 85 | P5-E5 | P5 | applied | 1 | (A11 — Task 2 code: the band footer + chrome + badge fast paths) |
| 86 | P5-E6 | P5 | applied | 1 | (A14 — Task 3: bounds/fit through the shared geometry) |
| 87 | P5-E6 | P5 | applied | 1 | (A14 — Task 3: bounds/fit through the shared geometry) |
| 88 | P5-E6 | P5 | applied | 1 | (A14 — Task 3: bounds/fit through the shared geometry) |
| 89 | P5-E7 | P5 | applied | 1 | (A12 — `createNav` reports engagement) |
| 90 | P5-E7 | P5 | applied | 1 | (A12 — `createNav` reports engagement) |
| 91 | P5-E8 | P5 | applied | 1 | (A11/A12 — handoff) |
| 92 | P5-E9 | P5 | applied | 1 | (Q&A) |
| 93 | P5-E9 | P5 | applied | 1 | (Q&A) |
| 94 | P6-E0 | P6 | applied | 1 | (status banner) |
| 95 | P6-E1 | P6 | applied | 1 | (A27 — bookend ids from the shared constants; `formatExecLine` skips them) |
| 96 | P6-E1 | P6 | applied | 1 | (A27 — bookend ids from the shared constants; `formatExecLine` skips them) |
| 97 | P6-E1 | P6 | applied | 1 | (A27 — bookend ids from the shared constants; `formatExecLine` skips them) |
| 98 | P6-E2 | P6 | applied | 1 | (A11 — Task 3 consumes P5's fast paths; no `view.mjs` edit here) |
| 99 | P6-E2 | P6 | applied | 1 | (A11 — Task 3 consumes P5's fast paths; no `view.mjs` edit here) |
| 100 | P6-E2 | P6 | applied | 1 | (A11 — Task 3 consumes P5's fast paths; no `view.mjs` edit here) |
| 101 | P6-E2 | P6 | applied | 1 | (A11 — Task 3 consumes P5's fast paths; no `view.mjs` edit here) |
| 102 | P6-E3 | P6 | applied | 1 | (A14 — run-hosts use the shared bounds/fit) |
| 103 | P6-E3 | P6 | applied | 1 | (A14 — run-hosts use the shared bounds/fit) |
| 104 | P6-E3 | P6 | applied | 1 | (A14 — run-hosts use the shared bounds/fit) |
| 105 | P6-E4 | P6 | applied | 1 | (A12 — monitor hosts bind the nav and get engagement from it) |
| 106 | P6-E4 | P6 | applied | 1 | (A12 — monitor hosts bind the nav and get engagement from it) |
| 107 | P6-E4 | P6 | applied | 1 | (A12 — monitor hosts bind the nav and get engagement from it) |
| 108 | P6-E5 | P6 | applied | 1 | (A3 — the gate ask carries no `deliveryNo`; the CLI derives it from the id) |
| 109 | P6-E5 | P6 | applied | 1 | (A3 — the gate ask carries no `deliveryNo`; the CLI derives it from the id) |
| 110 | P6-E6 | P6 | applied | 1 | (Q&A) |
| 111 | P6-E6 | P6 | applied | 1 | (Q&A) |
| 112 | P6-E6 | P6 | applied | 1 | (Q&A) |
| 113 | P6-E6 | P6 | applied | 1 | (Q&A) |
| 114 | P7-E0 | P7 | applied | 1 | (status banner) |
| 115 | P7-E1 | P7 | applied | 1 | (A22 — one message, one formatter, server-side) |
| 116 | P7-E1 | P7 | applied | 1 | (A22 — one message, one formatter, server-side) |
| 117 | P7-E1 | P7 | applied | 1 | (A22 — one message, one formatter, server-side) |
| 118 | P7-E2 | P7 | applied | 1 | (A22 — Task 6: no browser formatter) |
| 119 | P7-E2 | P7 | applied | 1 | (A22 — Task 6: no browser formatter) |
| 120 | P7-E2 | P7 | applied | 1 | (A22 — Task 6: no browser formatter) |
| 121 | P7-E2 | P7 | applied | 1 | (A22 — Task 6: no browser formatter) |
| 122 | P7-E2 | P7 | applied | 1 | (A22 — Task 6: no browser formatter) |
| 123 | P7-E2 | P7 | applied | 1 | (A22 — Task 6: no browser formatter) |
| 124 | P7-E2 | P7 | applied | 1 | (A22 — Task 6: no browser formatter) |
| 125 | P7-E2 | P7 | applied | 1 | (A22 — Task 6: no browser formatter) |
| 126 | P7-E2 | P7 | applied | 1 | (A22 — Task 6: no browser formatter) |
| 127 | P7-E2 | P7 | applied | 1 | (A22 — Task 6: no browser formatter) |
| 128 | P7-E3 | P7 | applied | 1 | (Q&A) |
| 129 | P8-E0 | P8 | applied | 1 | (status banner) |
| 130 | P8-E1 | P8 | applied | 1 | (A26 — `phases.mjs` survivors include the executor's imports) |
| 131 | P8-E1 | P8 | applied | 1 | (A26 — `phases.mjs` survivors include the executor's imports) |
| 132 | P8-E2 | P8 | applied | 1 | (A27 — the bookend ids are P1's shared constant) |
| 133 | P8-E2 | P8 | applied | 1 | (A27 — the bookend ids are P1's shared constant) |
| 134 | P8-E2 | P8 | applied | 1 | (A27 — the bookend ids are P1's shared constant) |
| 135 | P8-E3 | P8 | applied | 1 | (Q&A) |
| 136 | P8-E3 | P8 | applied | 1 | (Q&A) |

## Banned-string verification (post-edit)

`grep -n -E 'TBD|TODO|see spec|see the spec|adapt as needed|similar to Task|<!--END-->' <file>`

| plan file | hits |
|---|---|
| 2026-08-26-node-graph-v2-P1-harness-split-foundations.md | 0 |
| 2026-08-26-node-graph-v2-P2-shared-core-sidecars-schema-store.md | 0 |
| 2026-08-26-node-graph-v2-P3-engine-no-callers.md | 0 |
| 2026-08-26-node-graph-v2-P4-graph-orchestrator-dispatch.md | 0 |
| 2026-08-26-node-graph-v2-P5-composer-v2.md | 0 |
| 2026-08-26-node-graph-v2-P6-run-monitor-v2-cli.md | 0 |
| 2026-08-26-node-graph-v2-P7-agents-view-agent-gen-plugin-api-3.md | 0 |
| 2026-08-26-node-graph-v2-P8-break-kill-list-docs.md | 0 |

**Zero hits across all eight files** (also zero in the v1 snapshots — the pass introduced none and had none to clear).

## Status-banner check (P3–P8)

`grep -n "Status: v1 draft" <file>` → **line 3 in all six** (line 1 = title, line 2 = blank, line 3 = the banner, line 4 = blank, line 5 = the pre-existing "For agentic workers / REQUIRED SUB-SKILL" line, which each `P<n>-E0` pushed down rather than replacing — its single occurrence survives in all eight files).

| plan | banner line |
|---|---|
| P3 | 3 |
| P4 | 3 |
| P5 | 3 |
| P6 | 3 |
| P7 | 3 |
| P8 | 3 |

P1 and P2 get no banner — §B states their edits stay at the contract level because both receive full refinement next, and the manifest ships no `P1-E0`/`P2-E0`.

Banner text (identical in all six):

> **Status: v1 draft (contract-aligned 2026-08-27). Re-anchor + refine per the house recipe before execution — anchors valid for dev @ e6968e15 only.**

## Line counts and diff size

`diff <(v1-snapshot) <(now) | grep -c '^[<>]'`

| plan | pairs applied | lines v1 | lines now | diff lines |
|---|---|---|---|---|
| P1 harness split + foundations | 8 | 2458 | 2481 | 31 |
| P2 shared core + sidecars + schema + store | 27 | 5226 | 5252 | 102 |
| P3 engine, no callers | 8 | 4626 | 4636 | 18 |
| P4 GraphOrchestrator + dispatch | 32 | 2505 | 2522 | 229 |
| P5 composer v2 | 18 | 3998 | 4128 | 212 |
| P6 run monitor v2 + CLI | 20 | 2394 | 2394 | 84 |
| P7 agents view + agent-gen + plugin API 3 | 15 | 2581 | 2582 | 71 |
| P8 the break + kill list + docs | 8 | 1361 | 1363 | 16 |
| **total** | **136** | **25149** | **25358** | **763** |

P6's line total is unchanged by coincidence: its banner insert (+2) is offset by net deletions elsewhere (Task 3 becoming consume-only). The 25,149 v1 total matches the figure the manifest quotes for the eight plans.

## Structural sanity

Fenced-code-block parity (count of lines starting with ```` ``` ````) is EVEN in all eight files before and after, so no edit left a code block unterminated:

| plan | fences v1 | fences now |
|---|---|---|
| P1 | 72 | 72 |
| P2 | 210 | 210 |
| P3 | 132 | 132 |
| P4 | 78 | 80 |
| P5 | 112 | 116 |
| P6 | 74 | 74 |
| P7 | 148 | 146 |
| P8 | 104 | 104 |

Spot checks that the contract names landed where §A says they must: `BOOKEND_EXECUTION_IDS` now appears in P1 (7), P6 (4) and P8 (5); `QUIESCENCE_WARNING` in P4 (5); `setFooter(nodeId, bands)` in P5 (6) and P6 (5); `apiMismatchMessage` in P7 (6); `taskTotal` in P3 (5).
