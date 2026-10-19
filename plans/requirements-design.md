# Requirements: define a feature with Worca before anything is built

Date: 2026-10-18. Base branch: `dev` (33fb9283, 1.11.0). Branch: `feat/req-a1-feature-spec`.
Part 1 (A1) of a larger requirements-engineering track; later parts are listed in §9 and are not in this PR.

## 1. Goal

**A product owner turns an idea into a clear, testable feature spec through a short interview with
Worca, before any run starts and before any build money is spent.** The spec is what a run, Shaper
(#707) or Jira gets later.

Shaper shapes a task *inside a run*, for the person about to build it, in about three minutes. This is
the step before: deciding *what* to build and *why*, by someone who may never read the code, possibly
days before a developer is involved. Requirements never start a run in this PR.

**Success:**
1. A product owner gets from two sentences to a spec with testable acceptance criteria in at most
   6 interview rounds, each with at most 3 questions.
2. Every gap the interview could not close is visible as an assumption to confirm or reject, never a
   silent guess.
3. No worktree, branch, run or container is created for a requirement. The only spend is model calls,
   shown per feature and counted toward the spending limit.
4. With the `requirements` flag off, nothing in this spec shows or answers.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **A requirement is a document, not a run.** No worktree, branch, pipeline row or container. Interview rounds are single model calls (the `generateOverview` pattern, `src/core/overview-agent.mjs`). |
| D2 | **A feature belongs to a project or a workspace**, stored as `scope_type` + `scope_key` (the `source_bindings` convention, `src/core/source-bindings.mjs`). Chosen at creation and changeable until the feature is started (A2; always, in this PR). |
| D3 | **IDs.** Features are `FEAT-<n>`, one sequence per Worca install (`AUTOINCREMENT`: a deleted number is never handed out again). Acceptance criteria are `R-po-<n>` and assumptions `A-<n>`, per feature, **assigned by Worca, never by the model, never reused**: if `R-po-3` is removed the next one is `R-po-5`, so plans, reviews and Jira links never silently point at a different criterion. `R-po-<n>` matches the `R-<prefix>-<n>` shape Shaper's checklists use, so a later PR can carry them into review. |
| D4 | **The interview is one thread, and the stored thread is the source of truth.** Every round sends the whole thread (description, every question and answer, manual edits, the current spec) to a fresh call. No CLI session resume: an edited answer must not be contradicted by a session that remembers the old one, and a product owner may come back days later. |
| D5 | **Rounds of 1 to 3 questions.** Each question has 2 to 4 options, a recommended pick, free text and one line on why it is asked. A contradiction with an earlier answer becomes a question, never a silent pick. The model sets `done` when nothing important is left. At most 6 rounds; **Finish now** ends early. Whatever is still open becomes an assumption. |
| D6 | **The product owner's edits are ground truth.** A section the product owner edited is marked; Worca keeps their text and ignores model changes to it (the model may ask about it instead). **Let Worca rewrite this** clears the mark. **Only the product owner removes** a criterion or assumption; a model round never deletes one. |
| D7 | **Look once, then ask.** When a feature is created, one orientation pass reads the code through the Auto classifier's repo look (`src/core/auto/repo-look.mjs`): a temporary read-only detached checkout, tools `Read`, `Grep`, `Glob` only (`REPO_LOOK_TOOLS`), removed after the call. It writes a short summary **in product language** (what exists in this area, existing concepts and their names, what partly exists), stored on the feature and shown to the product owner. Interview rounds have no tools and read the summary. **Look again** refreshes it. A per-project/workspace switch turns it off; with no repository it is skipped. |
| D8 | **One model for the orientation pass and the rounds.** In this PR it is the newest Opus in the model catalog (`listModels`, `src/core/config.mjs`), so a catalog update moves it. Making it configurable like the other helper models (a `requirementsInterview` utility job through `utilityModelFor`, and a Claude key `requirementsModel` like `prDescriptionModel`) touches about ten files of settings plumbing and is a follow-up (A1.1). |
| D9 | **Spend counts toward the limit.** Each orientation and round appends its cost to `req_cost_ledger` (millisecond timestamps, the shape of `ask_cost_ledger`). `totalWindowSpendUsd` (`src/core/cost-budget.mjs`) adds requirements spend to pipeline and Ask spend, and every round and orientation checks `budgetStatus` first: at the limit it is refused with the reason, and nothing is lost. |
| D10 | **Project context lives in a table of its own** (`req_contexts`: actors, terminology, standing business rules, the code switch), one row per project or workspace, shared by its features. Not project memory: memory files are mounted into every run and Ask chat of the project and count toward its caps, and memory has no workspace scope. |
| D11 | **The database holds the spec; the repo gets it on demand.** **Save to specs/** writes `specs/FEAT-<n>-<slug>.md` into the project checkout and never commits (the model of Shaper's "Save to plans/"). In this PR it is offered for project features only: a workspace has no single checkout. **Copy Markdown** and **Download .md** work for both. |
| D12 | **Behind the `requirements` flag**, experimental, default off. The page is visible in **Simple** mode: product owners are its users. |
| D13 | **Mock mode is explicit.** With `WORCA_MOCK=1` the orientation and rounds return canned, deterministic results before any spawn (the pattern of `src/core/auto/classify.mjs`), never through the generic `runMock` role inference, which can write files into its working directory. Calls run in a scratch directory under `<worcaHome>/tmp/requirements`, never in a project. |
| D14 | **No dependency on Shaper.** The question card reuses the run page's question classes (`.qpanel`, `.qopt`, `.qfree`, …), so it looks the same without importing Shaper code. The save checks are a copy of Shaper's `save.mjs` checks, to be shared once both have merged. |

## 3. Data

One migration, registered in `INCREMENTAL_TABLES` so it is reconcile-safe: `dev`'s next free version is
57, which Shaper also takes; whichever merges second takes the next number, and `repairSchemaGaps`
creates the tables on a database stamped past it by the other branch.

```sql
CREATE TABLE IF NOT EXISTS req_features (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,   -- FEAT-<seq>
  scope_type     TEXT NOT NULL,                       -- 'project' | 'workspace'
  scope_key      TEXT NOT NULL,                       -- projects.key | workspaces.id
  epic_seq       INTEGER,                             -- reserved for epics (§9)
  title          TEXT NOT NULL,
  description    TEXT NOT NULL,
  status         TEXT NOT NULL,                       -- looking | thinking | your_turn | done | archived
  spec_json      TEXT NOT NULL,
  orientation_json TEXT,                              -- { summary, files[], skipped, at } | null
  criteria_seq   INTEGER NOT NULL DEFAULT 0,
  assumption_seq INTEGER NOT NULL DEFAULT 0,
  rounds         INTEGER NOT NULL DEFAULT 0,
  cost_usd       REAL    NOT NULL DEFAULT 0,
  saved_path     TEXT,
  created_by TEXT, created_at TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS req_features_scope ON req_features(scope_type, scope_key);

CREATE TABLE IF NOT EXISTS req_turns (                -- the thread, append-only
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_seq  INTEGER NOT NULL,
  kind         TEXT NOT NULL,     -- orientation | round | answers | edit | assumption | finish | error
  payload_json TEXT NOT NULL,
  model TEXT, cost_usd REAL, created_by TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS req_turns_feature ON req_turns(feature_seq, id);

CREATE TABLE IF NOT EXISTS req_cost_ledger (          -- spend window (D9), as ask_cost_ledger
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_seq INTEGER NOT NULL, turn_id INTEGER, amount_usd REAL NOT NULL, model TEXT, ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS req_cost_ledger_ts ON req_cost_ledger(ts);

CREATE TABLE IF NOT EXISTS req_contexts (
  scope_type TEXT NOT NULL, scope_key TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '', look_at_code INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_key)
);
```

**The spec** (`spec_json`), functional only; technical requirements stay with Shaper's perspectives:

```json
{ "goal": { "text": "", "measure": "" },
  "actors": [], "flow": [], "edgeCases": [], "rules": [], "outOfScope": [],
  "criteria":    [{ "id": "R-po-1", "text": "" }],
  "assumptions": [{ "id": "A-1", "text": "", "status": "open" }],
  "openQuestions": [],
  "edited": { "goal": true } }
```

An assumption's `status` is `open`, `confirmed` or `rejected`. `created_by` and `updated_by` hold `actorOf(req)`
(`src/core/identity.mjs`).

## 4. The interview

Both calls run on Claude in this PR; other engines (Codex, through the files MCP the classifier uses)
come later.

**Orientation** (once per feature, again on **Look again**). For a project: `openRepoLook(project.path,
<worcaHome>/tmp/requirements)`; for a workspace: `openWorkspaceRepoLook(members, …)`, one checkout per
member (at most 8) under one root. The call gets the description and project context, tools
`REPO_LOOK_TOOLS`, `REPO_LOOK_MAX_TURNS` and `REPO_LOOK_TIMEOUT_MS`, and returns
`{ summary, files[] }`. `summary` is at most ~250 words of product language with no paths or
identifiers; `files` is the list it read, shown folded at Advanced level. Every checkout is closed in
`finally`. A failed or skipped look leaves the interview running without code, with a line saying so.

**A round** has no tools (`tools: []`, `strictMcpConfig: true`). Input: description, project context,
orientation summary, the thread, the current spec, the list of product-owner-edited sections, the
round number and the remaining budget of rounds. The system prompt marks the description and answers as
data, not instructions (the `pr-description.mjs` convention). Output, strict JSON:

```json
{ "spec": { "goal": {}, "actors": [], "flow": [], "edgeCases": [], "rules": [], "outOfScope": [], "openQuestions": [] },
  "criteria":    [{ "id": "R-po-1", "text": "…" }, { "id": null, "text": "new one" }],
  "assumptions": [{ "id": null, "text": "…" }],
  "questions":   [{ "id": "refund-kind", "question": "…", "options": ["…", "…"], "recommended": "…", "why": "…" }],
  "done": false,
  "note": "one line for the product owner" }
```

**What Worca enforces in code** after every round, whatever the model returned:
- unparsable output → one retry, then an `error` turn and **Try again**; the spec is unchanged;
- at most 3 questions (the first 3 kept), 2 to 4 options each, `recommended` one of the options;
- new criteria and assumptions get the next `R-po-<n>` / `A-<n>`; unknown ids are treated as new;
  existing items missing from the output are kept;
- edited sections keep the product owner's text;
- round 6, or **Finish now**, asks for `done: true` with no questions; anything still open moves to
  assumptions.

**Concurrency.** One orientation or round at a time per feature (an in-memory set plus the `looking` /
`thinking` status). Answering or editing meanwhile answers 409 "busy". On server start, a feature left
`looking` or `thinking` goes back to `your_turn` with an `error` turn ("the last round did not finish").

## 5. API

All under `requireFlag('requirements')` (`src/core/flags.mjs`): 404 while the flag is off. Errors are
`{ error }` with 400 / 404 / 409 / 422, as in the rest of `ui/server.mjs`.

| Route | Does |
|---|---|
| `GET /api/requirements?scopeType&scopeKey` | list (without thread) |
| `POST /api/requirements` `{ title, description, scopeType, scopeKey }` | create; starts orientation, then round 1 |
| `GET /api/requirements/:seq` | feature, spec, orientation, thread |
| `PATCH /api/requirements/:seq` `{ title?, description?, scopeType?, scopeKey? }` | edit header (scope: until the feature is started, A2) |
| `POST /api/requirements/:seq/answers` `{ answers: [{ id, option? , text? }] }` | record answers, start the next round |
| `POST /api/requirements/:seq/finish` | final round, no questions |
| `POST /api/requirements/:seq/look` | refresh orientation |
| `PUT /api/requirements/:seq/spec/:section` `{ value }` / `DELETE …/edited` | product-owner edit / let Worca rewrite |
| `POST /api/requirements/:seq/criteria` · `DELETE …/criteria/:id` | add / remove a criterion |
| `POST /api/requirements/:seq/assumptions/:id` `{ status }` | confirm / reject |
| `GET /api/requirements/:seq/markdown` | rendered spec |
| `POST /api/requirements/:seq/save` `{ overwrite? }` | `specs/FEAT-<n>-<slug>.md`, project features only |
| `POST /api/requirements/:seq/archive` | archive (unarchive with `{ restore: true }`) |
| `GET` / `PUT /api/requirements/context/:scopeType/:scopeKey` | project context and code switch |

WebSocket: `broadcast({ type: 'requirements-changed', seq })` after every change, only while
`flagEnabled('requirements')`; open views refetch (the `memory-changed` pattern).

## 6. Screens

**Sidebar:** **Requirements** in the Build group, `data-nav="requirements" data-min-level="simple"
data-flag="requirements" data-flag-chip`.

**List** (`#requirements`): features grouped by project or workspace, newest first; each row `FEAT-<n>`,
title and state: **Your turn** (amber), **Looking at the code** / **Thinking** (blue), **Interview done**
(green), and the cost so far. **New feature**: title, description, project or workspace.

**Feature** (`#requirements/feature/<n>`):
- *Left, the conversation.* The current round as the run page's question card (`.qpanel` …): options
  with **Recommended**, free text, **Submit**, **Skip, use recommended**, and **Finish now**. The model's
  `note` above it. Earlier rounds folded; reopening one lets the product owner change an answer, which
  starts a new round from the corrected thread.
- *Right, the spec.* Each section editable in place (edited sections carry a small "edited by you" mark
  and **Let Worca rewrite this**); criteria as `R-po-<n>` (add, edit, remove); assumptions with
  **Confirm** / **Reject**; open questions.
- *Top:* title, project/workspace, state, cost, **What Worca found in the code** (the orientation summary,
  **Look again**; files read folded, Advanced level), **Save to specs/**, **Copy Markdown**,
  **Download .md**, **Archive**, and **Project context** (a panel with the shared text and the code switch).

## 7. Code changes

- `src/core/requirements/` (new): `spec.mjs` (shapes, ids, section normalizing, errors; pure), `store.mjs`
  (tables, turns, contexts), `round.mjs` (prompts and reply validation; pure), `interview.mjs` (orientation
  and round runners, jobs, mock), `edits.mjs` (the product owner's edits), `markdown.mjs`, `save.mjs`, `routes.mjs` (`registerRequirementsRoutes(app, deps)`: one call in `ui/server.mjs` instead of
  ~300 more lines in that file).
- `src/core/db.mjs`: the four tables, `INCREMENTAL_TABLES`, the ladder rung, `SCHEMA_VERSION`;
  `test/db-migrate-v57.test.mjs`, and `test/db-migrate-v56.test.mjs` stops pinning the exact version.
- `src/core/cost-budget.mjs`: `recordRequirementsCostDelta`, `requirementsWindowedSpendUsd`, and
  requirements spend in `totalWindowSpendUsd`.
- `src/shared/flags/registry.mjs`: the `requirements` flag.
- `ui/server.mjs`: the routes, the startup sweep, the frame.
- `ui/public/requirements-view.mjs` (new, the `schedules-view.mjs` factory pattern), `ui/public/app.js`
  (`VIEW_NAMES`, `VIEW_TITLES`, `showView` arm with the flag guard, the frame), `ui/public/topnav.mjs`
  (`PAGE_TITLES`), `ui/public/index.html` (nav button, section), `ui/public/style.css`.
- Docs: `docs/requirements.md` (new), rows in `docs/feature-flags.md` and `docs/ui-levels.md`.

## 8. Testing

- **Store:** ids never reused (features after delete, criteria after remove); scope validation;
  turns append-only; spend window sums.
- **Round validation:** question cap and option rules; new/unknown/missing criteria and assumptions;
  edited sections kept; round 6 and Finish force `done`; unparsable output retried once, then an error turn
  with the spec unchanged.
- **Orientation:** checkouts always closed (also on failure and abort); skipped without a repository or
  with the switch off; workspace members as roots; tools limited to `REPO_LOOK_TOOLS`.
- **Calls:** every round passes `tools: []` and no MCP config (asserted through `runClaudeImpl`, as
  `test/overview-agent.test.mjs`); mock mode never spawns and never writes outside the scratch directory.
- **Spend:** a round at the limit is refused with the reason; requirements spend appears in
  `totalWindowSpendUsd`.
- **Save:** outside-project and symlink refusals, no overwrite without `overwrite: true`, never commits;
  the symlink cases skip where the OS refuses to create symlinks.
- **API:** flag off → 404 on every route; busy → 409; the full flow (create → orientation → rounds →
  edit → assumption → finish → save) with a fake runner; the startup sweep.
- **UI (jsdom):** list grouping and states; the question card (pick, free text, recommended,
  Finish now); edit and "edited by you"; assumptions; the frame refetch. Updated: the nav-count tests
  (13 → 14), `test/ui-topnav.test.mjs`, `test/ui-levels.test.mjs` catalogue, the flag lists in
  `test/index-html.test.mjs` and `test/flags-api.test.mjs`.
- **Real browser:** `tools/verify-requirements-cdp.mjs` (`npm run verify:requirements`, added to CI's
  proofs): with the flag on, create a mock feature, answer a round, see the spec update; flag off hides
  the nav entry.

## 9. Out of scope (later parts)

- **A1.1** The model as a configurable helper job (D8).
- **A2** Ready gate and **Start in Worca** (a run with the spec as its task).
- **A3** Ask Worca next to the spec (`propose_spec_change`).
- **A4** Feasibility on demand: per-requirement evidence from the code.
- **A5** Epics: breaking a large feature into features with dependencies, waves and sprints.
- **A6** Jira export.
- **B** With Shaper merged: start through Shaper; `R-po` items carried into the plan and checked in review.
- Saving workspace features into a repository; two-way sync of `specs/` files.
- Requirements calls on engines other than Claude.

## 10. Open questions (defaults taken until someone objects)

1. **Default model:** the newest Opus (D8). Rounds resend the thread, so cost grows a little with each
   round; the limit (D9) caps it.
2. **Round cap:** 6 (D5).
3. **Numbering:** one `FEAT-<n>` sequence per install (D3). Jira-style per-project keys can come with A6.
