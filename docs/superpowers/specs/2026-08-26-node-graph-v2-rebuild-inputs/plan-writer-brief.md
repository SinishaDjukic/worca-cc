# Common brief for the eight plan writers (node-graph v2 rebuild)

You are writing ONE implementation plan of an eight-plan series. The plan will be executed by a zero-context implementer agent (worca orchestrate pipeline: worca-cc-planner → refiner → implementer → reviewer) in a fresh git worktree of this repo, AND possibly by hand. It must be SELF-CONTAINED: the worktree has no `docs/superpowers/` and no scratchpad — every rule, port table, message text, DDL, formula or contract the implementer needs must be IN the plan (copy from the spec; do not say "see spec").

Repo: /Users/denislavprinov/Develop/worca-cc (dev @ e6968e15). STRICTLY READ-ONLY on the repo. You may clone into your scratch dir (`git clone -q --no-hardlinks <repo> <scratch>/clone`, `npm ci` there) to run targeted tests / probe behavior (`WORCA_HOME=<scratch>/home node --test test/<file>.test.mjs`; never `npm test` in the repo; wrap in `timeout`).

READ FIRST: the rebuild spec `docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-design.md` (THIS WINS), then the base concept spec `docs/superpowers/specs/2026-08-10-node-graph-pipelines-design.md` (Amendment f at the end overrides earlier text; use it for V1–V21 rule semantics, firing rules, A1–A4, flow-card semantics), then the adjudication file(s) named in your per-plan section (dir `docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-inputs/`). Old branch source is borrowable: `git show origin/worca-cc/v2-orchestrator-bfb6a0ed:<path>`; adapt against dev anchors and the spec §6 drift list; the plan must state exactly what changes vs the borrowed file (and may embed the adapted code).

FORMAT (house style — mirror `docs/superpowers/plans/2026-08-24-ask-worca-worktrees-v2.md` lines 1–70 for tone/structure):
```
# Node-Graph v2 — P<n>: <Title> Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** …
**Architecture:** … (one paragraph)
**Series position:** P<n> of 8; requires P<n-1> landed (sentinel: `<export or file that must exist>`); leaves dev green and shippable; v1 engine stays live.
**Tech Stack:** Node ≥ 22 (`node:sqlite`, `node:test`), Express server `ui/server.mjs`, vanilla ESM UI `ui/public/*.mjs` (no build step), jsdom 29 for UI tests, offline fake-claude mocks (`WORCA_MOCK=1`).
**Spec:** `docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-design.md` (UNTRACKED — absent in a pipeline worktree; this plan is self-contained and repeats everything it needs).

## Global Constraints
- NEVER `git add` anything under `docs/superpowers/**`. Never `git push`. Product name in user-facing strings: "worca".
- Commits: `worca: Node-graph v2 P<n> — <task title>`.
- Run tests as `npm test` (full) or `node --test test/<file>.test.mjs` (one file); baseline recorded in Task 0; final total recorded in the last task.
- <plan-specific invariants>

---

### Task 0: Branch check, deps, baseline, predecessor sentinel
- [ ] Step 1: `git rev-parse --abbrev-ref HEAD` — you are on the pipeline's branch (or, by hand, create `worca-cc/node-graph-v2-p<n>` off dev). NEVER `git checkout dev`, never create a branch inside a pipeline run.
- [ ] Step 2: `[ -d node_modules ] || npm ci`
- [ ] Step 3: predecessor sentinel(s): `<grep/ls commands that prove P<n-1> landed>`; if absent STOP.
- [ ] Step 4: `npm test 2>&1 | tail -5` — record the pass count as BASELINE (must be green).

### Task 1 … Task N
Each task: **Files:** (create/modify/delete with `path:line` anchors on dev), **Interfaces:** (produces / consumes — exact signatures + return shapes), then TDD steps: `- [ ] Step k: Write the failing test` (full test code, file path above the block) → `Expected: <exact failure text>` → `- [ ] Step k+1: Implement` (full code) → `Expected: <pass output>` → `- [ ] Step k+2: Commit` (message). Edge cases + error handling stated. NO placeholders, no "…TODO…", no "adapt as needed" without the concrete adaptation.

Last task: full-suite run, expected total, a manual/CDP verification checklist where the spec calls for one, and the handoff line naming the plan's absolute path.

## Clarifications (Q&A)
- one line per decision the plan relies on (from the spec's D1–D8 + the adjudications): `- **<id>** — <question> → **<answer (user decision 2026-08-26)>**`
```

RULES:
- Ground every anchor in the real dev tree (open the file, quote the line); anchors from the spec were verified 2026-08-26 but re-check what you use.
- Interfaces are CONTRACTS across plans: use the exact module paths, export names, function signatures, event/state field names, DDL, message strings given in the spec. Do not rename. If the spec is silent, pick a name, state it, and add it to the Q&A as "planner default".
- Tests: offline only; jsdom for DOM (`PointerEvent` exists; `setPointerCapture`/`ResizeObserver` do not — guard; inject `raf`/`viewport`); use `test/helpers/*` where the spec names one; every guard/rule gets a test that fails when the rule is removed (mutation-proof); never `assert.doesNotThrow` around a jsdom `dispatchEvent` (vacuous — jsdom reports listener errors as window `error` events).
- Size: 8–15 tasks; ~500–1100 lines. Dense, no narrative filler.
- Borrowed code: cite `old:<path>` + list of edits; never rely on the old branch being present at execution time — embed the adapted code in the plan (large pure modules may be embedded in full: that is expected, not a smell).
- Write the plan with the Write tool in ≤ 6k-char chunks: first Write creates the file (header + Task 0), then Edit-append before an `<!--END-->` sentinel; remove the sentinel at the end. Never one giant write.
- Output path: `docs/superpowers/plans/2026-08-26-node-graph-v2-P<n>-<slug>.md` (write directly in the repo's docs dir — it is untracked). Final message: the absolute path + task count + one paragraph of risks/assumptions.
