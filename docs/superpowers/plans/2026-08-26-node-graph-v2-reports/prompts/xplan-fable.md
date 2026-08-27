# Cross-plan contract-consistency pass (Fable 5, max effort) — node-graph v2 REBUILD, worca

You are the ADJUDICATOR. Eight Opus writers wrote plans P1–P8 IN PARALLEL from one spec; their contracts may disagree, and each writer listed "OPEN CONTRACT POINTS" it could not settle. Your job: find EVERY cross-plan inconsistency and every contract-level spec deviation, DECIDE each (the spec wins; where the spec is silent decide on engineering merit and explain), and emit a numbered EDIT MANIFEST that an Opus applier can apply mechanically. You never ask the user: engineering calls are yours; only a genuine product preference (UX/scope/data-loss) is flagged in §D for the user.

Read IN FULL, in this order:
1. `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-design.md` (authoritative; §3 export table, §4, §5.x, §6, §7, §8, §9, §10, §12 test names, §16 conventions + never-borrow list)
2. `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/specs/2026-08-10-node-graph-pipelines-design.md` — "Amendment f — full text" at the end wins over earlier text (V-rules, firing, A1–A4, flow cards)
3. `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-HANDOFF.md` (per-plan sections + sentinels)
4. `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-inputs/adj-{a,b,c,d,e,f1,f2}.md`, `decisions.md`, `dev-map.md`
5. The eight plans: `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P{1..8}-*.md` (use `ls` for the exact names)
6. The writers' open points: `<SCRATCH>/reports/open-points.md`

Repo `/Users/denislavprinov/Develop/worca-cc` (dev @ e6968e15) is READ-ONLY. When a conflict hinges on a dev fact (an anchor, an existing signature, a test file), open the real file and quote it. You may clone into `<SCRATCH>/xplan/clone` to probe (`npm ci` there; every command wrapped in `timeout`); never `npm test` in the repo; never edit repo files; never git add/commit/push/stash/clean.

Check, for every producer→consumer pair of plans (and against the spec):
- Module paths + export names (§3 table; engine-only `src/core/graph/*`, browser-only `ui/public/graph/*`): every symbol plan N imports that plan M creates must match M's export EXACTLY (name, named vs default, file, relative-import depth convention `..` count).
- Signatures + return shapes: `createScheduler(opts) → {run, pause, abort, reattach, getState}`, `execute(args)` contract + returns (P3 ↔ P4), the `_execute` ctx field set (P3 defines what the executor reads; P4 builds it), `resolveGraph(...)` return shape (P2 → P4), `buildGraphManifest` signature/shape incl. shim cells (P2 → P4/P6/P8), `createGraphView` options + fast paths (P5 → P6), `decorFromState` bag (P6), `validateMetaV2` signature incl. `mockWriterRoles` injection (P2 → P7), `assertRunnableWorkflow` error shape (P2 → P4/P6/P8), `createOrchestratorFor` (P1 → P4 → P8), the six `RunHarness` hooks (P1 → P4 → P8), `formatExecLine` (P6 → P8 bookend rows), `apiMismatch` shape (P7), `sweepV1Runs` (P8).
- Event/state shapes (§5.7): `exec`/`token`/`question`/`log`/`subagent`/`stepskills`/`stepgraphify` fields; `state` fields; ledger row fields; who adds `costUsd`; shim rules (P4 emits → P6 consumes → P8 deletes).
- DDL + schema versions (V23 in P2b, V24 in P8a; `INCREMENTAL_COLUMNS`/`INCREMENTAL_TABLES` entries; `EXPECTED_TABLES` counts), migration fixture shapes (`db-residue-v22`, `db-collision`), `store_meta` usage.
- Message strings — ONE canonical text each, byte-identical wherever quoted: the ARCHIVED message, the two V4 texts, every validator issue text (P2 defines; P5/P7 render), `template is a graph — runs on the graph engine`, the plugin API mismatch wording, the ignored-sidecar log line, `ENGINE_RETIRED` error text, the quiescence banner, the V24 audit lines, CLI line formats, the `not placeable` badge, the "legacy · runnable until the graph cut-over" label, "Default (graph)".
- Sentinels: each plan's Task 0 sentinel grep must match what its predecessor ACTUALLY writes (exact export statement text + file); successor sentinels the HANDOFF names.
- Test file names (spec §12 item 3), helper names (`test/helpers/graph-ports.mjs`, `db-residue-v22.mjs`, `db-collision.mjs`), fixture paths (`test/fixtures/workflows-v1/<seedId>.json`, plugin fixture).
- Ownership: the same edit claimed by two plans, or by none — e.g. `_log` executionId tagging (P4 vs P6), `subagent` executionId (P4 vs P6), the artifact route (P4 vs P6), `assertRunnableWorkflow` call sites (P2 vs P6 CLI), the Archived footer (P5 vs P8), `MOCK_WRITER_ROLES` (P2), `wf_default_v2` alias (P4 adds, P8 removes; P5/P6 list it), `phases.mjs` exports (P3), `readPipelineForResume` (P4), `EVENT_NAMES` (P4 adds, P8 removes `phase`), `paintLegacyStrip` (P8 only), `wheelPan` (P5 ships, P6 uses), `style.css` blocks (P5 deletes composer block; P6 extends run-graph block; P8 deletes v1 run-graph block). Assign ONE owner; make the other plan verify-not-implement.
- Deviations from the locked decisions D1–D8 (spec §1), the §16 never-borrow list, the constraints from other landed work (Running D1–D17/C1–C16, History D1–D8, product name "worca").
- Plan hygiene at the contract level: "see spec" pointers, placeholders, invented user answers in the Q&A, a task whose test imports a module a LATER task creates (ordering), a split plan whose b-half entry check greps a sentinel the a-half does not produce.

OUTPUT — write `<SCRATCH>/reports/xplan-manifest.md` (use a Bash heredoc with a quoted delimiter; build it incrementally with `cat >>` in ≤ 6k-char chunks; never one giant write), structured EXACTLY:
## A. Canonical contract sheet
One line per decided item: `A<k>` · item · decision (the exact name/shape/text) · rationale (one clause) · plans affected.
## B. Edit manifest
Per plan, numbered `P<n>-E<k>`: **file** (absolute path) · **old_string** (≥ 1 line of the plan's CURRENT text, quoted verbatim, unique in that file — verify uniqueness with `grep -c -F`) · **new_string** (the full replacement). Edits must be mechanically applicable. Include a P3–P8 header banner edit for each of those six plans inserting, directly under the title line: `> **Status: v1 draft (contract-aligned 2026-08-26). Re-anchor + refine per the house recipe before execution — anchors valid for dev @ e6968e15 only.**`
## C. Adjudicated open points
Every point from open-points.md: `C<k>` · plan · the point · verdict · implementing edit id(s) or "no change".
## D. Residual
Items the manifest cannot fix (a section needs a writer re-draft) with plan + reason; and any TRUE product question for the user (expected: none or very few).
Final message: the manifest path, edit counts per plan, the five highest-impact decisions, the §D list.
