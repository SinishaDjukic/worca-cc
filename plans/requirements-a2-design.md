# Requirements A2: Ready, then Start in Worca

Date: 2026-10-20. Base: `feat/req-a1-feature-spec` (20bddcac). Branch: `feat/req-a2-ready-start`.
Part 2 of the requirements track. Part 1 (A1) is `plans/requirements-design.md`; its decisions are referred
to as A1-D<n>. The screens were agreed as a mock first (Claude Design canvas "Requirements — design round 1",
boards 1–9); this document is the build contract for them.

## 1. Goal

**A feature reaches a run only once its spec is Ready, and the product owner can see why it is or is not.**
Starting is one click from the spec; starting earlier is possible but needs a recorded reason. A2 gates only
runs started from Requirements: **New run**, Chat, schedules and the CLI are unchanged.

**Success:**
1. Readiness is six checks computed in code from the stored spec and thread, never by a model, visible on the
   feature page from the first round.
2. A not-Ready feature cannot start a run without a reason: the server refuses it, not only the button.
3. A run started from a feature gets the spec as its task, is linked both ways, and its status and cost show
   on the feature and in the list, live.
4. The spec a run was started with is frozen. Later edits are shown as "changed since started" and can be
   undone; the run keeps working from the frozen version.
5. The A1 page is rebuilt to the agreed mock (list, new feature, feature page, Statistics tile), and the A1
   page defects are gone (the stray "null" in the list, the experimental chip on its own line).

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **Ready is six rule checks**, one pure function `readiness(feature, { turns, target })` in `src/core/requirements/ready.mjs`: (1) **goal** has text and a success measure; (2) **criteria**: at least one acceptance criterion; (3) **interview finished**: the latest round said `done`; (4) **no open questions**; (5) **every assumption decided**: none `open`, and every `rejected` one has been asked about (D4); (6) **target exists**: the project is registered and its folder exists, or the workspace exists. Each check returns `{ key, ok, label, hint }` (hint: "2 questions above", "1 to decide", "A-4 rejected: ask about it"). Ready = all six pass. Whether a criterion is *testable* is not judged by rules: the interview's system prompt already demands observable statements, and a model-judged check belongs to feasibility (A4). The mock's label "all testable" becomes "N acceptance criteria". |
| D2 | **The feature's state on screen is derived, not stored.** The stored `status` (A1: `looking`, `thinking`, `your_turn`, `done`, `archived`) stays as it is; no status migration. Shown state: **Looking** / **Thinking** (running badge), **Your turn** (amber), **Decide** (amber: interview done, not Ready), **Ready** (green), **Started** (peach run pill: the feature has at least one start), **Archived**. One function, `displayState(feature, readiness, starts)`, used by the list and the page. List filters: **All open**, **Needs you** (Your turn + Decide), **Ready**, **Started**, **Archived**. |
| D3 | **Bulk confirm.** **Confirm the N left** confirms every open assumption in one call (`POST …/assumptions` `{ confirmOpen: true }`), recorded as one `assumption` turn listing the ids. Single Confirm / Reject / reopen are unchanged (A1). |
| D4 | **Rejecting an assumption leads to one short follow-up round.** A rejection is recorded at once, as in A1. A rejected assumption counts as *asked about* once a round turn exists after its latest rejection. While some are not, the Decide panel's primary action is **Done, ask about A-4** (`POST …/follow-up`): it appends a `followup` turn `{ assumptions: [ids] }` and runs a round whose prompt asks only what is needed to replace those assumptions (at most 3 questions; the rejected ones stay rejected and are never re-proposed with the same meaning). Follow-up rounds are started only by the product owner and are not limited by the 6-round cap: the cap ends the *interview*, not the product owner's right to correct it. The answers to a follow-up start the next round as usual, which, past the cap, is final (no questions, `done`). Spend is limited by the spending limit (A1-D9), as every round is. |
| D5 | **Start is server-side gated.** `POST /api/requirements/:seq/start` `{ reason?, workflowId?, sourceBranch? }`. Always refused (409): while busy, when archived, when the target check fails (nothing to run on). When any other check fails, the start needs `reason` (1–500 characters, trimmed); without it the answer is 409 `NOT_READY` with the failing check keys. An override is stored with the start: reason, failing checks, who, when. The page offers it as the small link **Start before it's Ready…**, which opens a dialog naming the failing checks and stating the consequence (open assumptions are built as written). |
| D6 | **A start is a normal run, through the run handler.** `ui/server.mjs` passes `startRun: (body, opts) => invokeStartRun(body, null, opts)` into `registerRequirementsRoutes` deps (the PR-watch wiring), so the run goes through every check **New run** has (budget, team cap, engine, credentials, branch validation). Body: `promptMarkdown` = the frozen spec rendered by `renderTaskMarkdown` (D7), `title` = `FEAT-<n>: <title>`, `projectDir` (project features, from `listProjects`) or `workspaceId` (workspace features), `workflowId` (default `wf_auto`, the mock's "Auto"), `guardrailsId: 'normal'` (as the New-run form), `sourceBranch` when given (else the handler's own default). The run UUID is reserved before the call (`opts.runId`), `startedBy` is `actorOf(req)`. A non-2xx answer becomes a `RequirementsError` carrying the handler's message: 403 budget → `BUDGET`, 400 → `BAD_REQUEST`, other 4xx → `CONFLICT`, else 500; nothing is stored. A team-cap acknowledgement (`needsPolicyAck`) is reported, not offered: the product owner can start from **New run** with the spec, or ask a lead (a later part can add the acknowledgement). |
| D7 | **The task text.** `renderTaskMarkdown(feature, snapshot, { targetName, version })` in `markdown.mjs`: a short preamble ("Build this feature. The acceptance criteria `R-po-<n>` are the definition of done; keep their ids in the plan and the review. Confirmed assumptions are decisions; open ones are guesses the product owner accepted when starting."), then the spec Markdown as A1 renders it, with the version (`FEAT-7 v2`). |
| D8 | **Starts are stored, the spec is frozen.** Table `req_starts` (§3), one row per start: version (1, 2, … per feature), the run UUID, the pipeline id once known, the frozen spec, the readiness at start, the override. A `start` turn `{ version, runId, override }` goes on the thread, so later rounds know a build is under way. Once a feature has a start, its project or workspace can no longer change (A1-D2's "until started": `PATCH` answers 409). |
| D9 | **Pipeline id link.** The run UUID is known at start; the 8-hex pipeline id arrives with the run's first `state` event. `wireRun` in `ui/server.mjs` (where Ask and tickets link the same way) calls one hook, `requirementsRunState(runId, payload)`: it fills `pipeline_id` once and, when the status changed, notifies `requirements-changed` for that feature (only while the flag is on). No hook work for runs not in `req_starts` (one indexed lookup). |
| D10 | **Run status on the feature.** `featureView` adds `starts: [{ version, runId, pipelineId, startedBy, startedAt, override, run: { status, phase, costUsd, href } }]`, newest first, read through an injected `deps.runSummary({ runId, pipelineId })` (the server wires `liveRunEntry` for live runs and `readPipelineStateById` after a restart). `href` is `#running/<runId>`. The list row shows the latest start's run as a pill (phase, status colour). Cost on the feature: requirements spend (A1) and the runs' total, shown apart and summed. |
| D11 | **Changed since started.** `changedSince(snapshot, spec)` (pure, `ready.mjs`) lists differences between the latest start's frozen spec and the current one: goal (text, measure), each list section (added, removed items), criteria by id (added, removed, text changed), assumptions by id (status changed, added). The page shows them in an amber notice with **Undo my changes** (`POST …/revert` `{ version }`: the spec goes back to that start's frozen spec; id counters never go backwards, A1-D3; an `edit` turn `{ reverted: version }` records it) and the runs card offers **Start again with v<n+1>**. The mock's **Keep for the next run** button is dropped: keeping is what happens when nothing is pressed. Editing, answering and follow-ups stay possible after a start: the spec is a living document; the run works from its frozen copy. |
| D12 | **Earlier answers can be changed from the page** (A1.2's first item, which the mock shows as **Change**). The server already records answers to an earlier round as a revision and starts a new round from the corrected thread (A1 §5); the page reopens that round's question card filled with the latest answers. |
| D13 | **Statistics tile.** A **Requirements** tile in the KPI row (spend in the range, `totals.requirements.spendUsd`; sub-line the distinct features worked on, `totals.requirements.features`), shown only while the flag is on; clicking it opens `#requirements`. With seven tiles the row uses four columns. |
| D14 | **Everything stays behind the `requirements` flag.** New routes join `REQUIREMENTS_ROUTES`, so the flag-off test walks them; the run-state hook sends nothing while the flag is off. |

## 3. Data

Migration v72 (v71 is A1's; both were v57/v58 before the merge with `dev`, where Shaper had taken 57/58 — see
A1 §3), in `INCREMENTAL_TABLES`:

```sql
CREATE TABLE IF NOT EXISTS req_starts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_seq   INTEGER NOT NULL,
  version       INTEGER NOT NULL,              -- 1, 2, … per feature
  run_id        TEXT NOT NULL UNIQUE,          -- the live run UUID (#running/<run_id>)
  pipeline_id   TEXT,                          -- 8-hex, filled by the first state event (D9)
  spec_json     TEXT NOT NULL,                 -- the frozen spec (D8)
  title         TEXT NOT NULL,
  ready         INTEGER NOT NULL,              -- 1 when all checks passed
  failing_json  TEXT NOT NULL DEFAULT '[]',    -- check keys that failed (override)
  reason        TEXT,                          -- the override reason
  workflow_id   TEXT, source_branch TEXT,
  started_by    TEXT, started_at TEXT NOT NULL,
  UNIQUE (feature_seq, version)
);
CREATE INDEX IF NOT EXISTS req_starts_feature ON req_starts(feature_seq, version);
```

Turn kinds gain `followup` `{ assumptions: [ids] }` and `start` `{ version, runId, override: bool }`.
An `assumption` turn may carry `{ ids, status }` (bulk) besides `{ id, status }`. `pendingRound` treats a
`followup` like `answers` (a round is on its way). The round thread text names them ("The product owner
rejected A-4 and asked Worca to ask about it", "The product owner started build v1").

## 4. API (new and changed)

| Route | Does |
|---|---|
| `GET /api/requirements` | each feature also carries `state` (D2), `ready` (count of passing checks) and `latestRun` (`{ status, phase, href }` or null) |
| `GET /api/requirements/:seq` | `feature` also carries `readiness` (the six checks), `state`, `starts` (D10), `changedSinceStart` (D11) |
| `PATCH /api/requirements/:seq` | scope change after a start → 409 |
| `POST /api/requirements/:seq/assumptions` `{ confirmOpen: true }` | confirm every open assumption (D3) |
| `POST /api/requirements/:seq/follow-up` | follow-up round on the rejected, not yet asked about, assumptions (202; 409 when there are none) |
| `POST /api/requirements/:seq/start` `{ reason?, workflowId?, sourceBranch? }` | start a run (201 `{ runId, version }` plus the feature view); D5, D6 |
| `POST /api/requirements/:seq/revert` `{ version }` | undo changes made since that start (D11) |

Errors as A1 §5, plus `NOT_READY` (409, `{ error, failing: [keys] }`).

## 5. Screens (the mock, boards 1–9)

- **List** (`#requirements`): subtitle and **New feature**; the filter (D2) with counts; per project or
  workspace a card of rows: `FEAT-<n>`, title, one meta line (round, Ready count and decisions left, or the
  run's phase), the state badge or run pill, the requirements cost. Below: requirements spend this budget
  window against the limit. The stray "null" (a `null` child in `paintList`) is gone.
- **New feature** (`#requirements/new`): title, description, project or workspace, the code-look line, and
  the typical cost of the look (median of the last 10 orientation turns' cost; hidden when there are none).
- **Feature** (`#requirements/feature/<n>`):
  - *Header:* id, title, state; chips (target, round or "Interview done · N rounds", cost); **Export ▾**
    (Save to specs/, Copy Markdown, Download .md) and **⋯** (Project context, Look again, Archive/Restore).
  - *Left:* the current card. **Your turn**: the question card (A1). **Decide**: the assumptions as
    Confirm/Reject toggles, **Confirm the N left**, and **Done, ask about A-n** when a rejection waits (D4).
    **Ready**: the **Ready to build** card (what Start does, workflow and base branch with **Change**,
    **Start in worca**). **Started**: the runs card, the changed-since notice (D11). Below: earlier rounds
    with **Change** (D12) and **What Worca found in the code**, folded.
  - *Right:* **Ready to start?** (the six checks, the count, **Start in worca**, disabled until Ready, and
    **Start before it's Ready…** when only overridable checks fail); then the spec, sections with a pencil
    icon instead of an Edit pill; once started, a **v2 draft / v1 started** switch shows the frozen spec
    read-only.
- **Sidebar:** the experimental chip inline after "Requirements".
- **Statistics:** the Requirements tile (D13).

The Start dialog for **Change** reuses the New-run pieces it needs: the workflow list (`/api/workflows` plus
Auto) and the branches (`/api/branches?projectDir=`; for a workspace, one default for all members).

## 6. Code changes

- `src/core/requirements/ready.mjs` (new, pure): `readiness`, `displayState`, `changedSince`,
  `unaskedRejections`.
- `spec.mjs`: turn kinds `followup`, `start`; `NOT_READY` error code.
- `store.mjs`: `createStart`, `listStarts`, `latestStart`, `linkPipeline(runId, pipelineId)`,
  `startByRunId`.
- `round.mjs`: thread lines for `followup` / `start` / bulk assumption turns; follow-up instructions in
  the round prompt; `pendingRound` and `followup`.
- `interview.mjs`: `followUp(seq, …)`; follow-up rounds bypass the cap (D4).
- `edits.mjs`: `confirmOpenAssumptions`, `revertToStart`; `updateHeader` refuses a scope change after a
  start.
- `start.mjs` (new): `startFeature(seq, input, { by }, deps)`, `runStateHook(deps)`.
- `markdown.mjs`: `renderTaskMarkdown`.
- `routes.mjs`: the routes of §4, `featureView`/`summary` additions, deps `startRun`, `runSummary`.
- `src/core/db.mjs`: `req_starts`, v72 (was v58 before the merge with `dev`).
- `ui/server.mjs`: deps wiring (`startRun`, `runSummary`), the hook in `wireRun`.
- `ui/public/requirements-view.mjs`: the screens of §5; `ui/public/style.css`; `ui/public/index.html` (the
  inline chip); `ui/public/stats-view.mjs` (the tile).
- `tools/verify-requirements-cdp.mjs`: the Ready → Start path in mock mode.
- Docs: `docs/requirements.md` (Ready, Start, follow-ups, changed since).

## 7. Testing

- **ready.mjs:** each check passing and failing; rejected-and-asked vs rejected-not-asked; target missing;
  `displayState` for every combination the list shows; `changedSince` for goal, list sections, criteria
  (added / removed / text), assumptions (status), and none.
- **Store / migration:** `test/db-migrate-v72.test.mjs`; versions per feature; `linkPipeline` fills once;
  `startByRunId`.
- **Follow-up:** refused without unasked rejections; runs past the cap with questions; the prompt names the
  rejected assumptions; the next round past the cap is final; thread lines.
- **Start:** Ready start calls `startRun` with the body of D6 (project and workspace) and stores version 1;
  not Ready without a reason → 409 `NOT_READY` and no call; with a reason → stored override; busy, archived
  and missing target refused even with a reason; handler 403 / 400 / 409 mapped, nothing stored; second
  start → version 2; scope change after start → 409; `revert` restores the frozen spec and keeps counters.
- **Hook:** first `state` fills `pipeline_id` and notifies; repeated same status does not notify; unknown
  runs ignored; nothing sent with the flag off.
- **API:** the flag-off walk covers the new routes; the full flow in mock mode (create → rounds → finish →
  decide → follow-up → start → state hook → changed since → revert).
- **UI (jsdom):** list filters, states, run pill and no "null" node; the Ready panel; Decide panel (bulk,
  toggles, follow-up button); Start (enabled only when Ready; the dialog requires a reason); the started view
  (runs card, changed-since notice, version switch); Change on an earlier round; Statistics tile only with
  the flag on; inline chip.
- **Real browser:** `npm run verify:requirements` extended: Ready → Start in mock mode opens the run;
  start-before-Ready asks for a reason.

## 8. Out of scope

- A team policy "every run needs a Ready spec" (would gate New run, Ask, schedules): a later opt-in.
- Team-cap acknowledgement from the Start dialog (D6).
- A model-judged "testable" check and per-requirement evidence: A4.
- Starting through Shaper with the PO's answers as Clarify answers: B1.
- The interview model as a setting and a dedicated system prompt: A1.1.
