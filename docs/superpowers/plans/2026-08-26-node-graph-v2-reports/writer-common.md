# Common instructions for the node-graph v2 plan writers (Session A, 2026-08-26)

You are ONE of eight parallel Opus writer agents; each writes one plan of the eight-plan node-graph v2 REBUILD series for worca. Read, in this order, BEFORE writing anything:

1. `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-inputs/plan-writer-brief.md` — the common brief (FORMAT + RULES; binding).
2. `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-design.md` — the REBUILD spec (WINS on every conflict). Read all 16 sections; your plan's sections with maximum care. §2 = the plan series table; §3 = shared module/export contract table; §16 = plan-writing conventions incl. the NEVER-BORROW list.
3. `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/specs/2026-08-10-node-graph-pipelines-design.md` — base concept spec; "Amendment f — full text" at the end OVERRIDES earlier text (V1–V21 semantics, firing rules, A1–A4, flow cards).
4. The adjudication files named in your per-plan section, in `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-inputs/` (adj-a … adj-f2).
5. `dev-map.md` and `pr359-postmortem.md` (same dir) for orientation; `decisions.md` for the locked user decisions.
6. House style: `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-24-ask-worca-worktrees-v2.md` lines 1–70 (tone/structure only).

## Hard rules (a violation = plan failure)

- The repo `/Users/denislavprinov/Develop/worca-cc` (dev @ e6968e15) is READ-ONLY except for writing YOUR plan file under `docs/superpowers/plans/`. Never `git add/commit/push/stash/clean/checkout/reset` in the repo. Never run `npm test` or `npm ci` in the repo. Never edit any repo file.
- Scratch dir: the `<SCRATCH>` path given in your prompt. If you need to run or probe tests: `git clone -q --no-hardlinks /Users/denislavprinov/Develop/worca-cc <SCRATCH>/clone && cd <SCRATCH>/clone && npm ci`, then `WORCA_HOME=<SCRATCH>/home timeout 300 node --test test/<file>.test.mjs`. Wrap EVERY test/node command in `timeout`. Cloning is optional — reading files in the repo is usually enough.
- Old branch (borrowable source): `git -C /Users/denislavprinov/Develop/worca-cc show origin/worca-cc/v2-orchestrator-bfb6a0ed:<path>` (branch head 0e6cee6f). Adapt against dev anchors + the spec §16 never-borrow list + adj-f1 §0 drift list; the plan states exactly what changed vs the borrowed file and EMBEDS the adapted code (the executor may not have the old branch).
- Bans: no servers, no browsers, no screenshots, no `open`, no `npm start`, no non-exiting process. Files + `node --test` + `node -e` only.
- Product name in every user-facing string: "worca" (never "worca-cc"; the repo dir/slug is fine in paths).
- SELF-CONTAINED: the executor has NO `docs/superpowers/` and NO scratch dir. Copy every rule text, port table, DDL, formula, event/state shape, message string and constant the implementer needs INTO the plan. Never write "see spec"/"per the spec". A one-line reference to the spec path in the header is the only allowed pointer.
- CONTRACTS ARE FIXED by the spec (§3 module/export table, §4 storage/API, §5.x engine/events/manifest, §6 meta v2 + the 11-builtin table, §7.4 geometry, §8 monitor, §9, §10 migration, §12.3 test-file names, and your per-plan sentinels). Use the EXACT module paths, export names, function signatures, event/state field names, DDL, message strings. Do not rename. Where the spec is silent, choose a name, state it in the plan, list it in `## Clarifications (Q&A)` as "planner default", AND list it in your final message under OPEN CONTRACT POINTS.
- Anchors: `path:line` on dev — open the file and quote the line; the spec's anchors were verified on e6968e15 but re-check every one you use.
- TDD per task: failing test (FULL code, file path above the block) → `Expected:` exact failure text → implementation (FULL code) → `Expected:` pass text → commit. Tests offline only (`WORCA_MOCK=1` / fake bins; never live claude). jsdom 29: `PointerEvent`/`WheelEvent` exist; `setPointerCapture`/`hasPointerCapture`/`ResizeObserver` do NOT (guard); `requestAnimationFrame` only with `pretendToBeVisual` (inject `raf`); `getBoundingClientRect` returns zeros (inject `viewport`). Never `assert.doesNotThrow` around a jsdom `dispatchEvent` (vacuous — listener errors surface as window `error` events). Every rule/guard gets a test that FAILS when the rule is removed (mutation-proof).
- No placeholders: never TBD / TODO / "adapt as needed" / "similar to Task N" (repeat the code) / "add error handling" / references to symbols no task defines.
- Size: 8–15 tasks per plan (per HALF for a split plan); dense; no narrative filler. Large pure modules embedded in full are expected, not a smell.
- Split plans (P2, P5, P6, P8 only): ONE document; halves separated by the literal heading `### — split point: P<n>b starts here —`. Each half ends with a full-suite task (`npm test`, expected total, commit). The b-half's first task is its own entry check (branch/HEAD, `[ -d node_modules ] || npm ci`, grep for the a-half's sentinel, baseline) so a half can be executed as its own pipeline run.
- Task 0 per the brief: never `git checkout dev`, never create a branch inside a pipeline run; by hand: `git checkout -b worca-cc/node-graph-v2-p<n>` off dev. `[ -d node_modules ] || npm ci`. When the plan borrows old-branch code: `git rev-parse --verify origin/worca-cc/v2-orchestrator-bfb6a0ed || git fetch origin worca-cc/v2-orchestrator-bfb6a0ed`. Predecessor sentinel grep (STOP if absent). Baseline: `npm test 2>&1 | tail -5` — the count is UNKNOWN to you: write "record the printed pass count as BASELINE; must be green" (never invent a number).
- Commit messages: `worca: Node-graph v2 P<n> — <task title>`.
- Last task of the plan (and of each half): full-suite run with the expected total expressed as "BASELINE + <N> new tests" (count N from your own plan), a manual/CDP verification checklist where the spec calls for one, and the handoff line naming the plan's absolute path.
- End with `## Clarifications (Q&A)`: one line per decision the plan relies on — `- **<id>** — <question> → **<answer (user decision 2026-08-26 | agent adjudication adj-x §n | planner default)>**`. Never invent user answers.

## Writing mechanics (MANDATORY — one giant write dies at the output cap and loses everything)

- After reading, your FIRST write is `Write` of chunk 1 = header + Global Constraints + Task 0, ending with a line containing only `<!--END-->`.
- Append every further chunk (≤ 6000 characters each; roughly one task per chunk, split a big task into two chunks) with `Edit`: `old_string` = `<!--END-->`, `new_string` = `<chunk text>\n<!--END-->`.
- The final chunk (Clarifications Q&A) replaces `<!--END-->` with the Q&A text and NO sentinel. Never rewrite the whole file. Run `wc -l <plan>` every few chunks. If an Edit fails because the sentinel is missing, `tail -5` the file and re-add the sentinel — never re-Write the file.
- Keep thinking terse; spend the budget on the plan text.

## Final message (return exactly this structure, nothing else)

1. Absolute path · task count (per half if split) · `wc -l`.
2. Sentinel consumed (predecessor) / sentinel produced (successor): exact export names + files.
3. OPEN CONTRACT POINTS — exhaustive: every name/shape/message/DDL you chose where the spec was silent or ambiguous; every place you deviated from or doubted the spec (cite the §); every cross-plan assumption about a neighbour plan's exports. A Fable adjudicator resolves these in the cross-plan pass.
4. One paragraph of risks/assumptions.
