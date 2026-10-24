---
name: rerun-finished-run-on-its-branch
description: Read before planning anything that starts a new run "with the same settings" or on a finished run's branch (fix runs, reruns, follow-ups), or that reads what a
paths: ui/server.mjs, src/core/run-harness.mjs, src/core/checkout.mjs, src/core/artifacts.mjs, src/core/pr-description.mjs, src/core/overview-agent.mjs
updated: 2026-10-19T00:14:39.274Z
author: Bulibas
---

**A finished run keeps almost none of its start request.** There is no rerun/clone helper and no stored start body
for hand-started runs (only scheduler tickets keep `request`). `resume_point` (workflowId, run-level claude model,
mock, night, mcpOptOut) is NULLed when the run ends. What survives on the `pipelines` row:
- workflow id = `stepper.template.id` (JSON column; there is no workflow_id column);
- `guardrails_id`, `prompt`, `title`, `started_by`, `branch.{source,feature}` (workspace: `workspace_meta.branches[k]`).
A normal `POST /api/run` takes no engine or run-level model anyway (models are per agent node in project config),
so "copy the settings" really means workflowId + guardrailsId + target + featureBranch.

**Starting a run on an existing branch:** pass `featureBranch` (run-harness `willReuse` = the local branch exists).
It never fetches or fast-forwards that branch first, so fetch + `fastForward` (git-sync.mjs) before the start.
Pass `syncBeforeStart: false`, or the base-sync precheck may answer 409 `sync-diverged` for an unattended start.

**Trap: the branch is often still checked out.** `createWorktree` throws "already checked out in worktree …" when
any worktree holds the branch, and the `until-pr` / `on-success` keep policy leaves exactly such a checkout on a
finished run. Release it with `discardCheckout({ id, members, force:false })` (saves dirty work as a patch, keeps the
branch) unless the run is in `busyRunIds()`.

**In-process start:** `invokeStartRun(body, internal)` requires `internal.ticket` when internal is set (`runId =
internal.ticket.id`); a non-ticket caller must pass a null internal and a fake req with `headers: {}`.
startRunHandler answers 200 before `orch.run()`; later failures arrive as the run's `error` event.

**Engine and mock of a finished run (checked 2026-10-09, #619 follow-up).** The engine survives: `runEngineOfRow(row)`
(outcome.runEngine, else resume_point.claude.engine, else 'claude'), and `POST /api/run` takes `engine` (runEngineOpts).
The per-request `mock` flag does NOT survive a finished run: it rides only `resume_point.mock`, NULLed at the end, and
there is no column. Only a paused origin (or a server in mock mode) can hand mock on.

**`guardrails_id` is set at creation only:** `writeState`/`seedPipeline({ guardrailsId })` does not write it. A test
that needs it on a seeded row must `UPDATE pipelines SET guardrails_id=…`.

**Seeded workflows are absent in a test home:** `wf_quick-fix` etc. answer 400 "unknown workflowId" in a fresh
WORCA_HOME; use `wf_default` for an in-process start. `wf_implement-review` is a USER-saved workflow (owner's DB),
not a built-in seed. PR-watch fix runs therefore use the reserved built-in `wf_pr_fix` (builtin-workflows.mjs);
any workflow a server-side feature starts must be a reserved constant, never a saved row, or other homes 400.
A new reserved id also needs: `readWorkflow`, `deleteWorkflow`, the DELETE route's 400, and the exact
`RESERVED_WORKFLOW_IDS` pin in test/workflows-memory-defrag.test.mjs.

**Where a finished run's documents live (checked 2026-10-19, PR-description inputs).** Not in the run dir:
- Plans: `<store>/plans/<date>-<base>[-vN].md`; review markdown: `<store>/reviews/<date>-<base>-impl-review.md`
  (also `-plan-review`, `-ws-review`). Both are indexed in `artifacts` (kind `plan` / `review`, rel_path
  store-root-relative). Read them with `listRunArtifacts(id, { kind })` + `resolveIndexedArtifactForRow(row, rel)`;
  `readRunArtifactText` reads only the run dir and misses them. The review file has no cycle in its name: each
  cycle overwrites it, so only the last cycle's markdown survives (per-cycle verdicts stay in the `reviews` table).
  A later same-day run with the same base overwrites it too, while the older run's row still points at it (2 files
  shared by 2 PR-watch fix runs each): check that no later pipeline indexes the same rel_path.
  The final plan is the first existing file of `plansNewestFirst(id)` (artifacts.mjs: createdAt, then the -vN
  suffix; `.md` rows only, since kind `plan` also covers the toolchain plugin's run-dir `toolchain-plan.json`).
  Away mode's `_nightPlanPaths` uses it too. A run without a planner has no `plan` row; its `task.md` (not indexed)
  only restates the prompt.
- Trap when reading issue state from the `reviews` table: a `refine` verdict lists the issues of its INPUT plan,
  which its own -vN output already fixed (`agents/worca-cc-plan-refiner.md`). Its latest cycle's issues are NOT
  open. "Latest cycle = open, earlier = fixed" holds only for a reviewer of the whole work that is the run's LAST
  loop (impl, ws, webui). NOT `plan`: Auto's `prompt+risky` runs a refiner after plan review, so its last cycle is a
  plan draft too. Plugin `video-review`, `promo-review` and some `readiness-*` kinds are fix loops; `toolchain-*` are
  checks. The real DB has no plan/ws/webui rows (2026-10-19). results.json `keyThingsToCheck`/`nitpicks` and
  `summary.blockingIssues` carry the refine flaw (b91270e6: all 10 "blocking" are refine): never show them as open.
- Capping such inputs: rank before you cap. `readPipelineExtras` returns reviews ORDER BY kind, cycle, so a cap that
  keeps from the start cuts exactly the latest cycle's open issues (review 2026-10-19). Keep the top item even when
  it alone is over the cap (cut it); a greedy skip-what-does-not-fit drops a long newest report for an older one.
  A `break` at the first misfit has the mirror flaw: a long SECOND item goes whole, with all after it (3c0cc653: a
  15k implementer text left only the reviewer's note). Cut the misfit to the room left. Wake-up turns can repeat
  the report with a new first sentence each time (4 copies there): exact-match dedupe misses them; compare tails.
- No raw test output is kept anywhere (tool results are logged as `← result ok toolu_01`). The agents' own final
  notes, which name the commands and results, are role-source `info` lines in `live-log.ndjson`. Traps (2026-10-19):
  - Each `[init] model=` debug line starts a TURN. A step that waits on background work is woken again, so its
    first turn can end on "waiting on the agents" and a later one on "nothing changed, my report stands": neither
    the first nor the last turn is reliably the report. Keep every turn's last line (`stepReportsFromLog`).
  - The final line is logged twice, but a step that called `Agent`/`Task` gets ALL its turns' result lines in one
    batch at its end, in turn order: never pair a message with an adjacent duplicate.
  - Decomposed slices share step and cycle and interleave; only `executionId` `x:<node>:<n>:<taskId>` splits them.
  - User-frame text (Skill bodies, usage-limit notes) is logged as role `info` too. Codex: one `[init]` per spawn,
    its result is all messages joined, report last. Sub-agent (`<role> ▸ <label>`) and `memory` lines carry other
    sources.
- To see what a helper job sends for a REAL run without touching the real DB: `sqlite3 "file:$HOME/.worca-cc/worca-cc.db?mode=ro" ".backup '$X/.worca-cc/worca-cc.db'"`,
  symlink `$X/.worca-cc/store` to the real store, run with `WORCA_HOME=$X` and a fake `runClaudeImpl`.
  `worcaHome()` is `$WORCA_HOME/.worca-cc`: a DB placed at `$X/worca-cc.db` is never opened ("pipeline not found").

**Broadcast identity for History:** a workspace run's History record has `projectKey = workspaces/<wk>`, but
`rowToState(...).projectKey` and `row.project_key` are the PRIMARY MEMBER's key. A frame filtered on
`record.projectKey` must carry the store key (`row.workspace_key ? 'workspaces/'+wk : row.project_key`), as
`emitDiffCommentsChanged` and `prWatchFrame` do.
