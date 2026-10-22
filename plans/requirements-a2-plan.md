# Requirements (A2: Ready, then Start in Worca) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A feature reaches a run only once its spec is Ready (six rule checks), or with a recorded reason; Start creates a normal run with the frozen spec as its task, linked both ways and shown live; the Requirements page is rebuilt to the agreed mock.

**Architecture:** Pure readiness / state / diff logic in `src/core/requirements/ready.mjs`; starts stored in a new `req_starts` table; `start.mjs` builds the run body and calls the run handler through an injected `startRun` dep (the PR-watch wiring of `invokeStartRun` in `ui/server.mjs`); a run-event hook in `wireRun` fills the pipeline id and notifies the page. The page module `ui/public/requirements-view.mjs` is rebuilt to the mock.

**Tech Stack:** Node ESM, `node:sqlite`, `node:test`, jsdom, Express (`ui/server.mjs`), vanilla DOM (`ui/public/*.mjs`).

**Spec:** `plans/requirements-a2-design.md` (decisions D1–D14 win where this plan is unclear). A1's design is `plans/requirements-design.md` (A1-D<n>).

**Visual reference (UI tasks):** the approved mock's source files, one per board (their folder is given with each UI task's dispatch; they are not part of the repository): `Main.dc.html` (list), `NewFeature.dc.html`, `Interview.dc.html` (feature page, your turn), `Decisions.dc.html` (Decide), `Ready.dc.html`, `StartAnyway.dc.html` (start-before-Ready dialog), `Started.dc.html`, `Stats.dc.html`, `Sidebar.dc.html`. They use upstream's own classes (`card`, `badge`, `chip`, `seg`, `qpanel`, `qopt`, `btn`, `btn-go`, `btn-mini`, `pill-run`, `stat-tile`, `hint`, `code`) and tokens; the inline styles in them are layout hints, not code to copy. Where the design doc deviates from a board (D1 label, D11 no "Keep" button) the doc wins.

## Global Constraints

- One commit per task; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit subjects start `Requirements:` (as A1).
- Readiness is computed in code from stored data, never by a model (D1).
- A not-Ready start without a reason is refused **by the server** (409 `NOT_READY`, `{ error, failing }`), not only by the page (D5). Busy, archived and a missing target are refused even with a reason.
- A start goes through the run handler (`startRun` dep → `invokeStartRun`), never around it (D6). Body: `promptMarkdown`, `title` `FEAT-<n>: <title>`, `projectDir` XOR `workspaceId`, `workflowId` default `wf_auto`, `guardrailsId: 'normal'`, `sourceBranch` only when given.
- The spec a start used is frozen in `req_starts.spec_json` and never changed afterwards (D8).
- Ids never go backwards: a revert restores the spec, never the `criteria_seq` / `assumption_seq` counters (A1-D3).
- Every `/api/requirements*` route is in `REQUIREMENTS_ROUTES` behind `requireFlag('requirements')`; no `requirements-changed` frame while the flag is off (D14).
- No import from Shaper code (`src/core/shape/*`, `ui/public/shape/*`). Core modules never import `ui/server.mjs`.
- `style.css`: tokens only, never a hex colour.
- Errors from routes: `{ error }` (plus `failing` for `NOT_READY`) with 400 / 404 / 409 / 500.
- One test file: `node tools/test.mjs test/<file>.test.mjs`. Full suite: `npm test`.

## Review Focus

1. **A not-Ready feature, started through the API directly with no reason.** Expect 409 `NOT_READY` with the failing check keys, no `startRun` call, no row (Task 4).
2. **The run handler refuses** (spending limit 403, bad branch 400, engine refused 409). Expect the handler's message, mapped code, nothing stored, version not consumed (Task 4).
3. **A rejected assumption.** Expect "Every assumption decided" to fail until a round after the rejection exists, the follow-up round to run past the 6-round cap, and the round after its answers to be final (Tasks 2, 3).
4. **Editing after a start.** Expect the frozen spec untouched, `changedSinceStart` listing the edit, revert restoring the frozen spec with counters kept, scope change refused (Tasks 2, 4).
5. **Flag off.** Expect every new route 404, no frame from the run hook (Tasks 4, 5).

---

### Task 1: Schema v58 and the starts store

> Renumbered on the merge with `dev`: `req_starts` is **v72** and its test `test/db-migrate-v72.test.mjs`
> (Shaper took 57/58 upstream; see the A2 design §3). The steps below are the original record.

**Files:**
- Modify: `src/core/db.mjs` (`SCHEMA_VERSION` 57 → 58; a `REQUIREMENTS_STARTS_DDL` next to `REQUIREMENTS_DDL` ~line 1039; `INCREMENTAL_TABLES` entry `req_starts`; ladder rung `if (current < 58) db.exec(REQUIREMENTS_STARTS_DDL);` after the v57 rung ~line 2200)
- Modify: `src/core/requirements/store.mjs`
- Modify: `src/core/requirements/spec.mjs`
- Create: `test/db-migrate-v58.test.mjs`
- Modify: `test/db-migrate-v57.test.mjs` (stop pinning the exact version, as A1 did for v56)
- Modify: `test/requirements-store.test.mjs`

- [ ] **Step 1:** DDL exactly as design §3 (`req_starts` with `UNIQUE (feature_seq, version)`, `run_id TEXT NOT NULL UNIQUE`, index `req_starts_feature`). `IF NOT EXISTS` only, registered in `INCREMENTAL_TABLES` (reconcile-safe like A1's tables).
- [ ] **Step 2:** `spec.mjs`: `TURN_KINDS` gains `'followup'` and `'start'`; `RequirementsError` code union gains `'NOT_READY'`, and the constructor takes an optional third argument `data` (object) stored on `err.data`.
- [ ] **Step 3:** `store.mjs`, new exports:
  - `createStart({ featureSeq, version, runId, spec, title, ready, failing = [], reason = null, workflowId = null, sourceBranch = null }, { by = null } = {})` → the start (shape below). Inserts one row; `started_at` = now.
  - `listStarts(seq)` → starts of a feature, newest first (`version DESC`).
  - `latestStart(seq)` → newest start or `null`.
  - `startByRunId(runId)` → the start or `null`.
  - `linkPipeline(runId, pipelineId)` → `true` only when it filled a `NULL` `pipeline_id` (`UPDATE … WHERE run_id = ? AND pipeline_id IS NULL`), else `false`.
  - `recentLookCosts(limit = 10)` → numbers: `cost_usd` of the newest `orientation` turns with `cost_usd > 0`.
  - Start shape: `{ id, featureSeq, version, runId, pipelineId, spec, title, ready: boolean, failing: string[], reason, workflowId, sourceBranch, startedBy, startedAt }`.
- [ ] **Step 4: Tests.** v58 creates `req_starts` on a fresh db and on a db stamped 57; the v57 test no longer pins 58. Store: versions per feature; `UNIQUE (feature_seq, version)` and `UNIQUE run_id` enforced (insert throws); `linkPipeline` fills once (second call `false`, value unchanged); `startByRunId` unknown → `null`; `listStarts` order; `recentLookCosts` ignores rounds and zero costs.
- [ ] **Step 5:** Run `node tools/test.mjs test/db-migrate-v58.test.mjs test/db-migrate-v57.test.mjs test/requirements-store.test.mjs`; commit `Requirements: starts table (v58) and store`.

---

### Task 2: Readiness, displayed state, changes since a start (pure)

**Files:**
- Create: `src/core/requirements/ready.mjs` (no I/O, imports only from `spec.mjs`)
- Create: `test/requirements-ready.test.mjs`

- [ ] **Step 1:** `unaskedRejections(spec, turns)` → ids of assumptions whose `status` is `rejected` and for which no `round` turn has an `id` greater than the id of the latest `assumption` turn rejecting it (a turn `{ id, status: 'rejected' }` for that id). An assumption rejected with no matching turn (older data) counts as unasked.
- [ ] **Step 2:** `readiness(feature, { turns = [], target = { ok: true } } = {})` → `{ ok, passed, total: 6, checks }`, `checks` in this order, each `{ key, ok, label, hint }`:

  | key | ok when | label | hint when failing |
  |---|---|---|---|
  | `goal` | `spec.goal.text` and `spec.goal.measure` non-empty | `Goal with a success measure` | `add a success measure` / `no goal yet` |
  | `criteria` | `spec.criteria.length >= 1` | `N acceptance criterion/criteria` (N = count; `No acceptance criteria` when 0) | `add at least one` |
  | `interview` | latest `round` turn has `payload.done === true` | `Interview finished` | `N question(s) waiting` when `feature.pending` is set, else `not finished` |
  | `openQuestions` | `spec.openQuestions.length === 0` | `No open questions` | `N open` |
  | `assumptions` | no `open` assumption and `unaskedRejections` empty | `Every assumption decided` | `N to decide` (open), else `A-4 rejected: ask about it` (first unasked; `A-4, A-7 rejected: ask about them` for more) |
  | `target` | `target.ok` | `Project <name> is registered` / `Workspace <name> exists` (`target.label` supplies the name text; default `Project or workspace exists`) | `target.hint` or `the project or workspace is missing` |

  `ok` = every check passes; `passed` = number passing. The `target` check is the only one that cannot be overridden (design D5): export `OVERRIDABLE = Object.freeze(['goal', 'criteria', 'interview', 'openQuestions', 'assumptions'])`, and the result carries `overridable` = not `ok` and every failing key is in `OVERRIDABLE`.
- [ ] **Step 3:** `displayState(feature, { ready, starts = [] } = {})` → one of `'archived' | 'looking' | 'thinking' | 'started' | 'your_turn' | 'decide' | 'ready'`, in that precedence: archived status; `looking` / `thinking` status or `feature.busy` (busy with status `looking` → `looking`, else `thinking`); `starts.length > 0` → `started`; `your_turn` → `your_turn`; `done` → `ready.ok ? 'ready' : 'decide'`.
- [ ] **Step 4:** `changedSince(before, after)` → array of changes, `[]` when equal. Kinds:
  - `{ kind: 'goal', field: 'text'|'measure', before, after }`
  - `{ kind: 'section', section, added: [..], removed: [..] }` per list section in `LIST_SECTIONS` with a difference (case-sensitive text compare)
  - `{ kind: 'criterion', id, change: 'added'|'removed'|'edited', before?, after? }` by id
  - `{ kind: 'assumption', id, change: 'added'|'status', before?, after? }` (status: before/after are the statuses; added carries `after` text)
  Order: goal, sections in `LIST_SECTIONS` order, criteria by id order of `after` then removed ones, assumptions likewise. `edited` flags are not compared.
- [ ] **Step 5: Tests.** Every check passing and failing with its hint (including singular/plural labels and the two assumption hints); rejected-then-round-after → passes; rejected-after-latest-round → fails; target missing → `ok:false` and `target` failing; `displayState` for all seven states incl. precedence (archived beats started, busy beats started, started beats your_turn); `changedSince` for each kind and for identical specs.
- [ ] **Step 6:** Run `node tools/test.mjs test/requirements-ready.test.mjs`; commit `Requirements: readiness, displayed state and changes since a start`.

---

### Task 3: Follow-up rounds and bulk confirm

**Files:**
- Modify: `src/core/requirements/round.mjs` (thread lines, prompt, `pendingRound`, mock reply)
- Modify: `src/core/requirements/interview.mjs` (`followUp`, cap bypass)
- Modify: `src/core/requirements/edits.mjs` (`confirmOpenAssumptions`)
- Modify: `src/core/requirements/routes.mjs` (two routes)
- Modify: `test/requirements-round.test.mjs`, `test/requirements-interview.test.mjs`, `test/requirements-edits.test.mjs`, `test/requirements-api.test.mjs`

- [ ] **Step 1: Bulk confirm.** `confirmOpenAssumptions(seq, { by })` in `edits.mjs`: `editable(seq)`; ids = open assumptions; none → `RequirementsError('CONFLICT', 'no open assumptions')`; one `assumption` turn `{ ids, status: 'confirmed' }` and the spec update in one `tx`. Route `POST /api/requirements/:seq/assumptions` with body `{ confirmOpen: true }` (anything else → 400), added to `REQUIREMENTS_ROUTES` before the `/:id` route, answers the feature view.
- [ ] **Step 2: Thread text** (`threadText` in `round.mjs`): an `assumption` turn with `ids` → `The product owner confirmed assumptions A-1, A-2.`; a `followup` turn → `The product owner rejected A-4 and asked Worca to ask about it.` (plural: `rejected A-4 and A-7 and asked Worca to ask about them.`); a `start` turn → `The product owner started build v<version>.`; an `edit` turn with `reverted` → `The product owner undid their changes since build v<version>.` (Task 4 writes that turn; the line lives here with the others).
- [ ] **Step 3: `pendingRound`** returns `null` when it meets a `followup` turn before a round (a round is on its way), like `answers`.
- [ ] **Step 4: The follow-up round.** `buildRoundPrompt` takes `followUp = null` (array of `{ id, text }`); when set, the last instruction line before the reply line is: `This is a follow-up round. The product owner rejected these assumptions: <id>: <text>; …. Ask only what you need to replace them (at most ${MAX_QUESTIONS} questions). Keep them as rejected; never propose them again with the same meaning. Do not set "done" unless nothing is left to ask about them.` (texts through `asData`). `mockRoundReply(feature, final, { followUp })`: with `followUp` and not final, one question per rejected id (at most 3), id `replace-<id>`, two options, recommended the first; otherwise the existing behaviour.
- [ ] **Step 5: `followUp(seq, { by }, deps)`** in `interview.mjs`: `guard(seq)`; `unaskedRejections(f.spec, turns)` (from `ready.mjs`) empty → `RequirementsError('CONFLICT', 'no rejected assumption is waiting for a follow-up')`; append `followup` turn `{ assumptions: ids }`; `startJob(seq, d, () => runRound(seq, d, by, { followUp: ids }), by)`. `runRound` takes `followUp` (ids): `isFinal = final || (!followUp && f.rounds + 1 >= MAX_ROUNDS)`; passes `followUp` items (`{ id, text }` of those assumptions) to `buildRoundPrompt` / the mock; the stored round payload gets `followUp: ids`. A follow-up round still increments `rounds`, books its cost and checks the budget like any round.
- [ ] **Step 6:** Route `POST /api/requirements/:seq/follow-up` (202, feature view), in `REQUIREMENTS_ROUTES`.
- [ ] **Step 7: Tests.** Round: the three new thread lines and the reverted line; `pendingRound` with a trailing `followup`; prompt contains the follow-up block with the rejected ids and texts; mock follow-up questions. Interview (mock): after 6 rounds and `done`, rejecting A-1 then `followUp` runs a round **with questions** (cap bypassed) and status `your_turn`; answering it runs a final round (`done`, no questions); `followUp` with no unasked rejection → CONFLICT; busy → BUSY; a follow-up refused at the spending limit becomes a `BUDGET` error turn (as rounds). Edits: bulk confirm confirms only open ones, one turn with `ids`, CONFLICT when none, refused while busy/archived. API: both routes behind the flag (the flag-off walk picks them up from the table), happy paths answer 200/202.
- [ ] **Step 8:** Run the four test files; commit `Requirements: follow-up round for rejected assumptions, confirm all`.

---

### Task 4: Start, revert, scope lock, and the richer views

**Files:**
- Create: `src/core/requirements/start.mjs`
- Modify: `src/core/requirements/markdown.mjs` (`renderTaskMarkdown`)
- Modify: `src/core/requirements/edits.mjs` (`revertToStart`, scope lock in `updateHeader`)
- Modify: `src/core/requirements/routes.mjs` (routes, `featureView` / list additions, error data, deps)
- Create: `test/requirements-start.test.mjs`
- Modify: `test/requirements-edits.test.mjs`, `test/requirements-markdown-save.test.mjs`, `test/requirements-api.test.mjs`

- [ ] **Step 1: `renderTaskMarkdown(feature, { spec, targetName, version })`**: the preamble of design D7 as its first paragraph, then `renderSpecMarkdown({ ...feature, spec }, { targetName })` with the heading line showing `FEAT-<n> v<version>`. Test: preamble, version in heading, criteria ids present, uses the passed spec, not `feature.spec`.
- [ ] **Step 2: `startFeature(seq, { reason, workflowId, sourceBranch } = {}, { by = null } = {}, deps)`** in `start.mjs`, `deps = { startRun, target, newRunId = randomUUID }` where `target` is what the route's `checkTarget` returned plus `{ ok, label }` (see Step 5):
  1. `f = requireFeature(seq)`; archived → `CONFLICT`; `isBusy(seq)` or a start already in flight for `seq` (module `Set`) → `BUSY`.
  2. `r = readiness(f, { turns: listTurns(seq), target })`; target failing → `CONFLICT` with the target hint.
  3. `failing = r.checks.filter(c => !c.ok).map(c => c.key)`; if any: `reason` trimmed must be 1–500 chars, else `new RequirementsError('NOT_READY', 'This feature is not Ready. Give a reason to start it anyway.', { failing })`; longer than 500 → `BAD_REQUEST`.
  4. `version = (latestStart(seq)?.version || 0) + 1`; `spec = f.spec` (deep copy); body per Global Constraints (`projectDir: target.path` for a project, `workspaceId: f.scopeKey` for a workspace; `sourceBranch` only when a non-empty string; `workflowId` only `/^wf_[a-z0-9_-]+$/i`, else `BAD_REQUEST`).
  5. `runId = deps.newRunId()`; `res = await deps.startRun(body, { runId, startedBy: by })`. Status outside 200–299 → map (design D6) `403` → `BUDGET`, `400` → `BAD_REQUEST`, other `4xx` → `CONFLICT`, else a plain `Error` (500); message `res.body?.error` or `the run could not start (HTTP <status>)`; nothing stored.
  6. In one `tx`: `createStart({ featureSeq: seq, version, runId: res.body?.runId || runId, spec, title: f.title, ready: r.ok, failing, reason: failing.length ? reason : null, workflowId: body.workflowId, sourceBranch: body.sourceBranch || null }, { by })` and a `start` turn `{ version, runId, override: failing.length > 0 }`.
  7. Release the in-flight mark in `finally`; return `{ runId, version }`.
- [ ] **Step 3: Revert and scope lock** (`edits.mjs`). `revertToStart(seq, version, { by })`: `editable(seq)`; start of that version missing → `NOT_FOUND`; spec ← the start's frozen spec (counters untouched); `edit` turn `{ reverted: version }`; one `tx`. `updateHeader`: a scope change (`scopeType`/`scopeKey` given and different) when `latestStart(seq)` exists → `CONFLICT` "this feature has been started; its project or workspace can no longer change".
- [ ] **Step 4: Run summary.** `deps.runSummary({ runId, pipelineId })` (injected; default returns `null`) → `{ status, phase, costUsd, pipelineId } | null`. In `start.mjs`, `startView(start, runSummary)` → `{ version, runId, pipelineId, startedBy, startedAt, ready, failing, reason, workflowId, sourceBranch, run }` where `run` is `null` or `{ status, phase, costUsd, href: '#running/<runId>' }`; when `runSummary` reports a `pipelineId` the row lacks, call `linkPipeline` (belt and braces for D9).
- [ ] **Step 5: Routes** (`routes.mjs`):
  - `checkTarget` also returns `{ ok: true, label }` (`Project <name> is registered` / `Workspace <name> exists`); a target that is unknown or whose folder is missing resolves (for readiness only) to `{ ok: false, hint }` via a `targetFor(f)` helper that never throws.
  - `featureView(seq, d)` becomes async and adds to `feature`: `readiness`, `state` (`displayState`), `unaskedRejections` (ids), `starts` (`listStarts` → `startView`; the newest one also carries its frozen `spec`, for the page's version switch), `changedSinceStart` (`changedSince(latest.spec, f.spec)` or `[]`). Every caller awaits it.
  - List: each summary adds `state`, `ready` (`passed`), `latestRun` (`startView(latest).run` or `null`); the response adds `lookCostUsd` (median of `recentLookCosts(10)`, `null` when empty) and `spend` `{ windowUsd, totalLimitUsd }` (requirements spend in the current budget window, from the helpers in `src/core/cost-budget.mjs` that `budgetStatus()` uses for its window; `totalLimitUsd` from `budgetStatus()`, `null` when there is no limit).
  - `POST /:seq/start` → `startFeature(…, { startRun: d.startRun, target })`; 201 `{ runId, version, ...await featureView(seq, d) }`; no `startRun` dep → 500 `starting runs is not available`.
  - `POST /:seq/revert` `{ version }` (integer ≥ 1 else 400) → feature view.
  - `handle()` maps `NOT_READY` → 409 and spreads `err.data` into the JSON (`{ error, failing }`).
  - `registerRequirementsRoutes(app, { broadcast, deps })`: `deps.startRun`, `deps.runSummary` reach the handlers.
- [ ] **Step 6: Tests** (`test/requirements-start.test.mjs`, a bare express app via `registerRequirementsRoutes` with fake `startRun` / `runSummary`, mock mode, flag on — or direct `startFeature` calls, whichever the existing tests' setup makes simpler):
  - Ready project feature → `startRun` called once with `{ promptMarkdown (contains the preamble and R-po ids), title 'FEAT-n: …', projectDir, workflowId: 'wf_auto', guardrailsId: 'normal' }` and no `workspaceId`, no `sourceBranch`; stored version 1, `ready: true`, a `start` turn.
  - Workspace feature → `workspaceId`, no `projectDir`.
  - `sourceBranch: 'main'`, `workflowId: 'wf_full'` passed through; `workflowId: 'x;rm'` → 400 and no call.
  - Not Ready without reason → 409 `NOT_READY`, `failing` lists the keys, no call, no row; with reason → stored `failing` and `reason`; reason 501 chars → 400.
  - Busy, archived, target missing → refused even with a reason, no call.
  - `startRun` answers 403 / 400 / 409 / 500 → BUDGET(409) / 400 / 409 / 500 with the handler's message; no row; the next successful start is still version 1.
  - Second start → version 2; two concurrent starts → one succeeds, one BUSY.
  - Scope change after a start → 409; before → allowed (existing test still passes).
  - Revert: edit a criterion after start, `changedSinceStart` shows it, revert → spec equals the frozen spec, `criteriaSeq` unchanged, an `edit` turn `{ reverted: 1 }`; unknown version → 404.
  - Feature view: `readiness` (incl. `overridable`), `state`, `unaskedRejections`, `starts[0].spec` (newest only), `starts[0].run.href === '#running/<runId>'`, `linkPipeline` called when `runSummary` reports a pipeline id.
  - API test (`test/requirements-api.test.mjs`): the flag-off walk covers `start` and `revert`; list carries `state`, `ready`, `latestRun`, `lookCostUsd`, `spend`.
- [ ] **Step 7:** Run the four test files; commit `Requirements: Start in Worca, revert, and readiness on the views`.

---

### Task 5: Server wiring — start through the run handler, run events

**Files:**
- Modify: `src/core/requirements/start.mjs` (`createRunEventHook`)
- Modify: `ui/server.mjs` (deps at `registerRequirementsRoutes(app, { broadcast })` ~line 8296; the hook in `wireRun` ~line 1214)
- Create: `test/requirements-run-link.test.mjs`

- [ ] **Step 1: `createRunEventHook({ notify })`** → `(runId, name, payload) => void`, never throws (try/catch, `console.error` with the `[worca-ui]` prefix as neighbours do). Only `name` `state`, `done`, `error` do work. `start = startByRunId(runId)`; none → return. On `state` with a string `payload.id`: `linkPipeline(runId, payload.id)`. Notify `notify(start.featureSeq)` when the run's status changed since the last event for that run (in-memory `Map runId → status`; `state` uses `payload.status`, `done` uses `payload.status || 'done'`, `error` uses `'error'`), or when the pipeline id was just linked. Delete the map entry on `done` / `error`.
- [ ] **Step 2: `ui/server.mjs`.**
  - `registerRequirementsRoutes(app, { broadcast, deps: { startRun: (body, opts) => invokeStartRun(body, null, opts), runSummary } })` where `runSummary({ runId, pipelineId })`: `live = liveRunEntry(runId)`; `id = pipelineId || live?.pipelineId`; `state = id ? readPipelineStateById(id) : null` (catch → null); nothing → `null`; else `{ status: live?.status || state?.status || null, phase: state?.phase || null, costUsd: state?.totalCostUsd ?? null, pipelineId: id || null }`.
  - In `wireRun`'s event forwarder, next to the ticket link, call the hook for every event: `requirementsRunEvent(entry.runId, name, payload)` where `requirementsRunEvent = createRunEventHook({ notify: requirementsChangeNotifier(broadcast) })` is created once at module level (the notifier already checks the flag at send time). Use the run's UUID field name `wireRun` already uses for `run-created` / frames.
- [ ] **Step 3: Tests** (`test/requirements-run-link.test.mjs`): the hook — unknown run ignored (no notify); first `state` with `id` links and notifies once; the same status again does not notify; a status change notifies; `done` notifies and clears; a throwing `notify` does not throw out. Server (in-process `ui/server.mjs`, `WORCA_MOCK=1`, flag on, a project that is a git repo with one commit — `git init`, `git commit --allow-empty`): a Ready mock feature (create → answer with `useRecommended` → interview done in mock → confirm all open assumptions) → `POST …/start` → 201 with a `runId`; `GET …/:seq` shows `starts[0].runId` and, within 10 s, a `pipelineId` and a `requirements-changed` frame for that seq. If the mock run cannot start in the test environment, report it (DONE_WITH_CONCERNS) rather than weakening the assertion.
- [ ] **Step 4:** Run `node tools/test.mjs test/requirements-run-link.test.mjs test/requirements-api.test.mjs test/requirements-start.test.mjs`; commit `Requirements: starts go through the run handler; run events reach the feature`.

---

### Task 6: The list, New feature, and the sidebar chip

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`paintList`, `paintNew`, shared helpers)
- Modify: `ui/public/style.css` (`req-*` rules; tokens only)
- Modify: `ui/public/index.html` and/or the code that renders `data-flag-chip` (find it: `grep -rn "flag-chip" ui/public`)
- Modify: `test/requirements-view.test.mjs`, the test covering the flag chip (find with the same grep in `test/`)

- [ ] **Step 1: State helpers** at the top of the module: `STATE` map from the seven `displayState` values to `{ label, cls }`: `looking` "Looking" `running`, `thinking` "Thinking" `running`, `your_turn` "Your turn" `amber`, `decide` "Decide" `amber`, `ready` "Ready" `green`, `started` (rendered as a run pill, Step 3), `archived` "Archived" plain. `badge(state)` uses it. The page never derives the state itself: it uses `f.state` from the server.
- [ ] **Step 2: List** (board `Main.dc.html`): subtitle line ("Define a feature with Worca before anything is built. Nothing runs until you start it.") and **New feature** (`btn-go`, routes `new`); a `seg` filter with `role="tablist"`, buttons `role="tab"` + `aria-selected`, labels with counts: **All open · N** (everything but archived), **Needs you · N** (`your_turn` + `decide`), **Ready · N**, **Started · N**, **Archived** (fetches with `archived=1`; replaces the old "Show archived" toggle). The selected filter survives repaints (module state). Groups by project / workspace (`h2` "Project · <name>"), each a `card` of rows; a row is a `button` (`req-row`, `data-feature="<seq>"`) with: id (`code`), title, a meta line (below), the state badge or run pill, the requirements cost. Meta line by state: `your_turn` → `Round <n> of 6 · <k> question(s) for you` (k from `pendingCount` if the list carries it, else `Your turn`); `decide` → `Interview done · Ready <ready> of 6`; `ready` → `Ready 6 of 6`; `started` → `Started · run <status>` + ` · <phase>` when known; `looking` / `thinking` → `Worca is looking at the code…` / `Worca is thinking…`. Footer: `Spent on requirements this month: $X` + ` of your $L limit` when `spend.totalLimitUsd` is set (`hint`). No `null` / `false` child ever reaches `replaceChildren` (fix: filter the children, or build through `h()`); test asserts the host's text never contains `null`.
- [ ] **Step 3: Run pill**: `pill-run` with the status colour (`peach` while `created/starting/running/pausing`, `green` done, `red` error/stopped, plain otherwise; check `style.css` for the existing `pill-run` variants and use only those), text = phase (title-cased) while running, else the status label; `pdot` child.
- [ ] **Step 4: New feature** (board `NewFeature.dc.html`): back link **← All features**; heading and subtitle; `card` form with `field` blocks: **Title**, **Describe it** (`opt` "who needs it, what they want to do, and why"), **For** (`select-wrap` select with Projects / Workspaces optgroups), the code-look hint; actions: cost hint `About $X for the code look, then cents per round.` only when `lookCostUsd` is a number (fetched with the list call, `GET /api/requirements`), **Cancel**, **Start the interview**. Keep the existing element ids (`req-new-title`, `req-new-desc`, `req-new-target`) for the tests and the CDP proof.
- [ ] **Step 5: Sidebar chip:** the experimental chip renders inline after the label on the Requirements nav entry (board `Sidebar.dc.html`). Find why it wraps (markup vs CSS); make the smallest fix; if the cause is shared by every flagged nav entry, fix it for all and say so in the report.
- [ ] **Step 6: Tests** (jsdom, existing harness in `test/requirements-view.test.mjs`): filters and counts; Archived fetches `archived=1`; each state's badge and meta line; run pill classes; no `null` text; New feature cost hint shown / hidden; the chip test.
- [ ] **Step 7:** `node tools/test.mjs test/requirements-view.test.mjs <chip test>`; commit `Requirements: list and new-feature screens to the agreed design`.

---

### Task 7: The feature page — header, menus, Ready panel, spec, earlier rounds

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`paintFeature`, `conversation`, `earlierRounds`, `sectionBlock`, `criteriaBlock`, `assumptionsBlock`, `orientationBox`, `contextPanel`)
- Modify: `ui/public/style.css`
- Modify: `test/requirements-view.test.mjs`

Board `Interview.dc.html` is the layout; keep the A1 behaviours that tests cover (unsaved input kept across live updates, focus restore, context panel loading, locked while busy/archived).

- [ ] **Step 1: Header:** back link **← All features**; `FEAT-<n>` (`code`), title (`h2`), state badge (or run pill when `started`); chips: target, `Round <n> of 6` (or `Interview done · <n> rounds` when the interview is finished), `$<cost> so far`, `Saved as <path>` when saved; right: **Export ▾** and a **⋯** icon button (`aria-label="More actions"`). Menus: reuse an existing upstream popover/menu pattern if `style.css`/`ui/public` has one (search `menu`), else a `details.req-menu` > `summary` + list of buttons, closing on choice and on Escape. Export: **Save to specs/** (project features only), **Copy Markdown**, **Download .md**. ⋯: **Project context** (opens the context panel), **Look again**, **Archive** / **Restore**. Disabled entries follow the A1 lock rules.
- [ ] **Step 2: Two columns:** left (`req-left`): the current card (Task 8 adds Decide/Ready/Started; this task keeps the question card, the error + **Try again**, the working line), then **Earlier rounds** as one `card` listing each answered question with its latest answer (`→ answer`, `recommended` marker) and a **Change** link per round, then **What Worca found in the code** as a folded `details` (summary also shows `looked once · <n> files · $<cost>` when known). Right (`req-right`): **Ready to start?** panel, then the **Spec** card.
- [ ] **Step 3: Ready panel** (right column, every state except archived): heading, `<passed> of 6` (`code`), the six checks from `f.readiness.checks` as a list — passing: a check icon (`role="img" aria-label="Passed"`), failing: an empty circle (`aria-label="Not yet"`) plus the hint at the right; then a footer with "Nothing is built until you start it." and **Start in worca** (`data-ui="start"`), `disabled` unless `f.readiness.ok`; when `f.readiness.overridable`, a link-button **Start before it's Ready…** (`data-ui="start-anyway"`). Clicking either is wired in Task 8; in this task they call a `startFlow(f, { override })` stub that Task 8 fills.
- [ ] **Step 4: Spec card:** sections as now, but the Edit pill becomes a small icon button (pencil SVG, `class="req-ico"`, `aria-label="Edit <Section>"`), "edited by you" inline in the heading, **Let Worca rewrite this** stays a text button when edited. Criteria: id + text; add (plus icon → the existing input row), remove (icon, `aria-label="Remove R-po-n"`). Assumptions keep Confirm/Reject. Long lists (flow, edge cases, rules, out of scope) are folded behind one link "Show flow, edge cases, rules and out of scope (<n> items)" that toggles them (state kept in `ui`).
- [ ] **Step 5: Change on an earlier round** (design D12): **Change** sets `revising = <round turn id>` and renders that round's question card in the left column (above Earlier rounds), prefilled from its latest answers, with **Cancel** and **Submit changes**; submit posts `/answers` with that `roundTurnId` (the server records a revision and runs the next round). Not offered while locked.
- [ ] **Step 6: Tests:** header chips and both menus (entries, project-only Save, Escape closes); Ready panel renders the six checks from a fixture, Start disabled / enabled, start-anyway link only when overridable; pencil buttons with labels; folded sections toggle; Change → prefilled card → POST body; all existing view tests updated to the new markup, none deleted without a replacement asserting the same behaviour.
- [ ] **Step 7:** `node tools/test.mjs test/requirements-view.test.mjs`; commit `Requirements: feature page header, Ready panel and spec to the agreed design`.

---

### Task 8: Decide, Ready to build, Start, Started

**Files:**
- Modify: `ui/public/requirements-view.mjs`
- Modify: `ui/public/style.css`
- Modify: `test/requirements-view.test.mjs`

Boards `Decisions.dc.html`, `Ready.dc.html`, `StartAnyway.dc.html`, `Started.dc.html`.

- [ ] **Step 1: Decide card** (left column when `f.state === 'decide'` and not locked): `qpanel` headed **Decide the assumptions** with `<open> of <total> left`; a line explaining Confirm / Reject; one row per assumption (open ones first, then rejected-unasked, then the rest folded behind "Show the other N"): id, text, a two-button toggle group (`role="group"`, `aria-pressed`) Confirm / Reject that posts the single-assumption route (pressing the pressed one reopens, as A1). Footer: `<decided> decided · <rejected> rejected`; **Confirm the N left** (`data-ui="confirm-all"`, `POST …/assumptions {confirmOpen:true}`, shown when N > 0); primary **Done, ask about A-4** (`data-ui="follow-up"`, `POST …/follow-up`) shown when `f.unaskedRejections.length` (label names the first id, `… ask about A-4 and 1 more` for more).
- [ ] **Step 2: Ready to build card** (left column, top, when `f.state === 'ready'`): heading, the D6 sentence with the target name, chips `Workflow · <name>` and `Branch from · <branch or "default">` with **Change**, and **Start in worca** (`btn-go`). **Change** reveals a workflow `select` (Auto first, `wf_auto`, then `GET /api/workflows` entries) and, for a project, a branch `select` from `GET /api/branches?projectDir=<path>` (default option "Project default (<current>)", value empty); for a workspace a text input "Branch for every project (empty: each project's default)". Choices live in module state per feature.
- [ ] **Step 3: Start:** `startFlow(f, { override:false })` → `POST …/start { workflowId?, sourceBranch? }`; on success repaint (the feature is now `started`) and say `Started build v<version>.` with a link to `#running/<runId>`; on `NOT_READY` open the dialog (Step 4); other errors via `fail`. Double clicks: the button disables while the call is in flight.
- [ ] **Step 4: Start-before-Ready dialog** (`role="dialog" aria-modal="true" aria-labelledby`): reuse an upstream modal/sheet pattern if one exists (search `style.css` for `modal`, `sheet`, `scrim`), else a fixed overlay using `--scrim` / `--shadow-sheet`. Title `Start FEAT-<n> before it's Ready?`; the failing checks (label + hint) in an amber box with the consequence line for assumptions ("The run treats open assumptions as confirmed: the build follows them as written.") when `assumptions` fails; textarea **Why start now?** (required, max 500, counter); "Recorded as: <you> · started before Ready"; buttons **Keep deciding** (closes) and **Start with <n> open** / **Start anyway** (`btn-primary`, disabled until the reason is non-empty) → `POST …/start { reason, … }`. Escape closes; focus goes to the textarea on open and back to the trigger on close.
- [ ] **Step 5: Started view** (when `f.starts.length`): left column top: **Runs from this feature** `card` — one row per start (newest first): run pill, `Run · spec v<version>` (+ ` · started before Ready` when it had failing checks, with the reason in a `title`), the run's cost, a link to `run.href` (or "Run not found" when `run` is null); **Start again with v<n+1>** (enabled when `changedSinceStart.length`, Ready rules apply as for the first start); total line `Total for FEAT-<n> so far: $X (requirements $A + build $B)`. Then, when `changedSinceStart.length`, the amber **Changed since the run started** notice: one line per change (criterion id + before struck / after, section added/removed items, goal, assumption status), "The running build still works from v<n>; it does not see this change.", **Undo my changes** (`POST …/revert {version}` after a `confirm()`). In the spec card a `seg` switch **v<n+1> draft / v<n> started** when there are changes: the started tab shows the frozen spec (`f.starts[0].spec`) read-only.
- [ ] **Step 6: Live:** the view already refetches on `requirements-changed`; nothing else needed (Task 5 notifies on run status changes).
- [ ] **Step 7: Tests:** Decide card rows, toggles, confirm-all and follow-up calls, hidden buttons; Ready card and Change selects (fetch mocks); Start success repaint and message; `NOT_READY` opens the dialog; dialog requires a reason, sends it, Escape closes and focus returns; Started runs card, total line, changed notice lines, Undo call, version switch shows the frozen spec.
- [ ] **Step 8:** `node tools/test.mjs test/requirements-view.test.mjs`; commit `Requirements: decide, start and started views`.

---

### Task 9: Statistics — the Requirements tile

**Files:**
- Modify: `ui/public/stats-view.mjs` (`renderKpiRow`, the `ICONS` map)
- Modify: `ui/public/style.css` (a 4-column `stat-row` when it has 7 tiles, if not already covered)
- Modify: the stats view tests (find: `grep -ln "renderKpiRow" test`)

- [ ] **Step 1:** In `renderKpiRow`, after the Ask Worca tile, a **Requirements** tile when the model says the flag is on (find how stats-view learns about flags or other optional tiles; if nothing exists, take a `flags` / `requirementsEnabled` option from the caller and pass it from where `renderKpiRow` is called): value `fmt.usd(totals.requirements.spendUsd)`, sub `<b>N</b> feature(s)` from `totals.requirements.features`, the icon path of the Requirements nav entry (`ui/public/index.html`), the whole tile a link to `#requirements` (as other clickable tiles do, if any; else wrap the label in an `a`). Absent `totals.requirements` → no tile.
- [ ] **Step 2:** Seven tiles lay out in four columns (`.stat-row:has(> .stat-tile:nth-child(7))` exists for `tm-kpis` only; generalise it or add the row class), six stay three.
- [ ] **Step 3: Tests:** tile present with the flag and data, absent without either; values formatted; link target.
- [ ] **Step 4:** Run the stats view tests; commit `Requirements: Statistics tile`.

---

### Task 10: Real-browser proof and docs

**Files:**
- Modify: `tools/verify-requirements-cdp.mjs`
- Modify: `docs/requirements.md`, `docs/feature-flags.md` (only if the flag row's wording changes)

- [ ] **Step 1: Proof:** after the existing checks (flag off hides the entry; mock feature → answer → spec), in mock mode: finish the interview, see the Decide state in the list, **Confirm the N left**, see **Ready** and the Ready panel at 6 of 6; start-before-Ready path on a second feature opens the dialog and requires a reason (assert the button is disabled with an empty reason; do not start it); **Start in worca** on the Ready feature → the Runs card shows a run row with a `#running/` link. The test project must be a git repository with one commit (create it in the proof's temp dir). Keep the proof's existing structure and output style (numbered checks, non-zero exit on failure).
- [ ] **Step 2: Docs:** `docs/requirements.md` gains sections **Ready** (the six checks, what overriding records), **Start in Worca** (what the run gets, workflow and branch defaults, only runs started here are gated), **Follow-up rounds**, **After starting** (frozen versions, changed since, undo, start again). Product language, short.
- [ ] **Step 3:** Run `npm run verify:requirements`; commit `Requirements: real-browser proof for Ready and Start; docs`.

---

### Task 11: Whole-branch check

- [ ] **Step 1:** `npm test` on the branch. For every failing file, run the same file on `feat/req-a1-feature-spec` (`git stash -u; git switch feat/req-a1-feature-spec; node tools/test.mjs <files>; git switch -; git stash pop`); only failures that pass on the base branch are this branch's to fix. Record the counts.
- [ ] **Step 2:** `npm run verify:requirements` green.
- [ ] **Step 3:** Fix what is this branch's; commit `Requirements: whole-branch fixes` if anything changed.
