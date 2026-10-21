# Requirements (A7: the Product brief) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One optional Product brief per project or workspace, made in one deeper read-only look at the code, edited by the product owner, read by every interview round of that scope; with a brief a new feature skips its own look and offers **Look closer** on demand; the brief records the commit and branch it came from and says when the code moved on.

**Architecture:** Pure brief logic (prompt, normalisation, merge, rendering, staleness intersection) in `src/core/requirements/brief.mjs`; the job (checkout, call, costs, recovery, staleness git calls) in `brief-job.mjs`, reusing A1's `callModel` and repo look; one row per scope in a new `req_briefs` table; spend in `req_cost_ledger` with a new `brief_id`. The interview gains one prompt block and the orientation skip in small, separate hunks of `round.mjs` / `interview.mjs`. The page module `ui/public/requirements-view.mjs` gains the brief page and the two feature-side changes.

**Tech Stack:** Node ESM, `node:sqlite`, `node:test`, jsdom, Express (`ui/server.mjs`), vanilla DOM (`ui/public/*.mjs`).

**Spec:** `plans/requirements-a7-design.md` (decisions D1–D17 win where this plan is unclear). A1: `plans/requirements-design.md` (A1-D<n>); A2: `plans/requirements-a2-design.md` (A2-D<n>).

**Visual reference (UI tasks):** the approved mock's source files, one per board (their folder is given with each UI task's dispatch; they are not part of the repository): `BriefEmpty.dc.html` (board 11, no brief yet, notes card, list header), `Brief.dc.html` (board 12, made, code moved on), `NewFeatureBrief.dc.html` (board 13), `LookCloser.dc.html` (board 14, What Worca knows, both states). They use upstream's classes (`card`, `badge`, `chip`, `btn`, `btn-mini`, `btn-go`, `hint`, `code`, `field`, `select-wrap`, `subtitle`) and tokens; inline styles are layout hints. Where the design doc deviates from a board (D7: one Refresh button) the doc wins; what no board shows is listed in design §6 "Not on the boards" — build exactly that, nothing more.

## Global Constraints

- One commit per task; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Subjects start `Requirements:`.
- **Lane rules.** Edits to `src/core/requirements/round.mjs` and `interview.mjs` are only the hunks named in Task 5 (lane 1 rewrites the system prompts, the prompt order and the model choice in parallel). Never touch `node_modules` (a junction), never run `npm install`, never push or touch remotes. No local machine paths in shipped files.
- No model call in the brief job before the refusals of design §5 (switch off, no repository, busy, `MAX_BRIEF_JOBS`, budget) have passed; a refusal writes nothing.
- The brief look uses `REPO_LOOK_TOOLS` only, `BRIEF_MAX_TURNS = 40`, `BRIEF_TIMEOUT_MS = 600_000`, an aux spawn through `callModel`; every checkout is closed in `finally`.
- Every stored path is relative to the checkout (workspace: `repos/<key>/…`), with `/` separators.
- The product owner's edited sections are never overwritten by a look (D6); areas with `added` survive a refresh.
- Every `/api/requirements*` route is in `REQUIREMENTS_ROUTES` behind `requireFlag('requirements')`; brief frames go through `requirementsBriefNotifier` (silent while the flag is off).
- Mock mode (`WORCA_MOCK=1`) never spawns a model and never writes outside `<worcaHome>/tmp/requirements`.
- No import from Shaper code. Core modules never import `ui/server.mjs`. `style.css`: tokens only.
- Errors from routes: `{ error }` with 400 / 404 / 409 / 500 (A1 §5).
- One test file: `node tools/test.mjs test/<file>.test.mjs`. Full suite: `npm test` (compare failures with the base branch before blaming this one: this laptop has known baseline failures).

## Review Focus

1. **A feature created while its project has a brief.** Expect an `orientation` turn `{ skipped: 'brief' }`, no `runClaudeImpl` call for a look, no budget check for it, round 1's prompt containing `<product_brief`, and the round payload's `brief` (Task 5).
2. **Refresh with edits.** Edit "Who uses it", add an area from a closer look, refresh: expect the edited section and the added area unchanged, the other sections replaced, `sources` / `files` / `made_at` new (Tasks 2, 4).
3. **Staleness.** Make a brief on a test repository, commit a change to a file an area lists and one to an unrelated file: expect `commits: 2`, `touching: 1`, that area named; rewrite history so the brief's commit is gone: expect `known: false` (Tasks 3, 4, 6).
4. **Spend.** A brief look at the spending limit is refused 409 `BUDGET` with nothing written; a good one books one ledger row with `brief_id` and `feature_seq = 0`; Statistics' feature count does not grow (Tasks 1, 4).
5. **Flag off.** Every new route 404; no frame (Task 6).

---

### Task 1: Schema v59, the briefs store, brief spend

**Files:**
- Modify: `src/core/db.mjs` (`SCHEMA_VERSION` 58 → 59; `REQUIREMENTS_BRIEFS_DDL` after `REQUIREMENTS_STARTS_DDL` ~line 1112; `INCREMENTAL_TABLES` entry `req_briefs`; `INCREMENTAL_COLUMNS` entry `req_cost_ledger: { brief_id: 'INTEGER' }`; rung `if (current < 59) { db.exec(REQUIREMENTS_BRIEFS_DDL); repairSchemaGaps(db, schemaGaps(db)); }` after the v58 rung ~line 2229)
- Modify: `src/core/requirements/store.mjs`
- Modify: `src/core/cost-budget.mjs` (`recordRequirementsCostDelta`)
- Modify: `src/core/stats.mjs` (`requirementsTotals`)
- Create: `test/db-migrate-v59.test.mjs`
- Modify: `test/db-migrate-v58.test.mjs` (stop pinning the exact version), `test/requirements-store.test.mjs`, `test/cost-budget-requirements.test.mjs`, `test/stats-api.test.mjs`

- [ ] **Step 1:** DDL exactly as design §3 (`UNIQUE (scope_type, scope_key)`), `IF NOT EXISTS` only.
- [ ] **Step 2:** `recordRequirementsCostDelta({ featureSeq = 0, briefId = null, turnId = null, amountUsd, model = null, tsMs })`: no-op unless `featureSeq` or `briefId` is set and `amountUsd > 0`; inserts `feature_seq` (0 for a brief) and `brief_id`. `requirementsTotals`: `COUNT(DISTINCT NULLIF(feature_seq, 0)) AS features`.
- [ ] **Step 3:** `store.mjs`, new exports (brief shape: `{ id, scopeType, scopeKey, status, sections, edited, sources, files, seed, model, costUsd, error, madeBy, madeAt, createdAt, updatedBy, updatedAt }`, `sections` defaulting to `{ product: '', users: [], terms: [], areas: [] }`):
  - `getBrief(scopeType, scopeKey)` → brief or `null`; `usableBrief(scopeType, scopeKey)` → the brief when `madeAt` is set, else `null`.
  - `listBriefs()` → `[{ scopeType, scopeKey, status, madeAt }]`.
  - `beginBrief(scopeType, scopeKey, { by })` → upsert: a new row `status 'making'` (sections empty), or the existing row set to `making` with `error_json = NULL`. Throws `RequirementsError('BUSY', 'Worca is already making this brief.')` when the row is `making` (checked and set in one `UPDATE … WHERE status != 'making'`).
  - `saveBriefResult(id, { sections, edited, sources, files, seed, model }, { by })` → `status 'ready'`, `made_by`, `made_at` = now, `error_json` NULL.
  - `failBrief(id, { code, message })` → `error_json` `{ code, message, at }`, `status` = `'ready'` when `made_at` is set, else `'empty'`.
  - `setBriefSections(id, { sections, edited }, { by })` (edits; never touches status or sources).
  - `addBriefCost(id, usd)`; `deleteBrief(scopeType, scopeKey)`; `listMakingBriefs()`.
  - `briefUsers(scopeType, scopeKey)` → `[{ seq, id }]` ascending: features of the scope, not archived, with a `round` turn whose `json_extract(payload_json, '$.brief') IS NOT NULL`.
  - `recentBriefCosts(limit = 10)` → `amount_usd` of the newest ledger rows with `brief_id IS NOT NULL`.
- [ ] **Step 4: Tests.** v59 creates `req_briefs` and `req_cost_ledger.brief_id` on a fresh db and on one stamped 58 (where the ledger exists without the column); v58 no longer pins 59. Store: one row per scope; `beginBrief` twice → BUSY; `failBrief` with and without `made_at`; JSON round trips; `usableBrief` null until saved; `briefUsers` (only rounds with `brief`, archived left out); `recentBriefCosts`. Ledger: a brief row has `feature_seq` 0 and counts in `requirementsWindowedSpendUsd`; Statistics' `totals.requirements.features` ignores it, `spendUsd` includes it.
- [ ] **Step 5:** Run `node tools/test.mjs test/db-migrate-v59.test.mjs test/db-migrate-v58.test.mjs test/requirements-store.test.mjs test/cost-budget-requirements.test.mjs test/stats-api.test.mjs`; commit `Requirements: briefs table (v59), store and brief spend`.

---

### Task 2: The brief, pure (`brief.mjs`)

**Files:**
- Create: `src/core/requirements/brief.mjs` (imports only `spec.mjs` and `round.mjs`'s `asData`)
- Create: `test/requirements-brief.test.mjs`

- [ ] **Step 1: Shape and caps.** `BRIEF_SECTIONS = ['product', 'users', 'terms', 'areas']`; `BRIEF_TITLES` (`What the product does`, `Who uses it`, `The words it uses`, `What exists today`); `BRIEF_LIMITS = { product: 1200, users: 12, terms: 30, areas: 20, name: 80, line: 300, areaText: 500, addedText: 1000, areaFiles: 40, files: 300, prompt: 12000 }`; `emptyBrief()`.
- [ ] **Step 2: `BRIEF_SYSTEM_PROMPT`** verbatim from design §4; `buildBriefPrompt({ scopeName, notes, workspaceDescription = '', current = null, edited = {}, members = null })` → the blocks of design §4 in that order, every value through `asData`, `<current_brief>` as `renderBriefForPrompt(current)` and `<edited_by_product_owner>` only when `current` is given.
- [ ] **Step 3: `relPath(p, { cwd, members })`**: `\` → `/`; strip a leading `cwd` (also with `/` separators, case-insensitive when `process.platform === 'win32'`) and `./`; reject `..` segments, an absolute path left after stripping, and empty; for a workspace keep only `repos/<member>/…` with a known member. `normalizeBrief(raw, { cwd, members = null })` → `{ sections, files }`: clip every field to the caps, drop items without a name/term, `status` only `exists` / `partly` else `null`, area `files` through `relPath`, de-duplicated; `files` = the reply's `files` plus every area file, through `relPath`, capped. Throws `RoundError('the reply has no product description and no area')` when both are empty.
- [ ] **Step 4: `mergeBrief(row, fresh)`** (`row` = `{ sections, edited }` as stored when the look ends): edited sections from `row`; the others from `fresh`; then every `row.sections.areas` item with `added` is appended to an unedited `areas` unless the section is edited, dropping a fresh area with the same name (case-insensitive). Returns `{ sections, edited }`.
- [ ] **Step 5: `parseSectionValue(section, value, current)`**: `product` → clipped string; arrays of objects accepted as `normalizeBrief` would; a string → one item per line, `users` `Name: can`, `terms` `Term: meaning`, `areas` `Name (exists|partly): text` (status optional, case-insensitive); an area keeps `files` and `added` of the `current` area with the same name. Unknown section → `RequirementsError('BAD_REQUEST', …)`; more items than the cap → `BAD_REQUEST`. `sectionText(section, value)` renders the same text format (the editor's initial value).
- [ ] **Step 6: Rendering.** `renderBriefForPrompt(sections)` → plain text: `What the product does:` + text, then `Who uses it:` / `The words it uses:` / `What exists today:` as `- Name: text` lines (areas `- Orders (partly): …`); no files; past `BRIEF_LIMITS.prompt` characters, drop trailing areas, then terms, adding `(… N more)`. `renderBriefMarkdown(brief, { scopeLabel })` → `# Product brief: <scopeLabel>`, a line `Made from <branch> @ <short sha> on <date>` per source, the four sections as `##` headings and lists, `## What Worca read` with the files. `briefFileName(scopeName)` → `product-brief-<slug>.md`.
- [ ] **Step 7: `briefMatches(sections, { title, description })`** → up to 3 lower-cased area names or terms (brief order: areas, then terms) found in the text as whole words, case-insensitive, a trailing `s` on either side ignored. `touchedAreas(sections, perSource)` where `perSource = [{ project, commits: [{ sha, files }] }]` and the brief is a project brief (`project` paths as stored) or a workspace brief (`repos/<project>/` + path) → `{ touching, areas }` (`areas` in brief order, unique).
- [ ] **Step 8: `mockBrief(scopeName)`**: a deterministic brief (`[mock]` product text, one user, one term, two areas `Orders` (partly, files `['README.md']`) and `Accounts` (exists, no files)).
- [ ] **Step 9: Tests.** Caps per field; absolute (`/tmp/x/auto-look-ab12/src/a.mjs`, `C:\\…\\auto-look-ab12\\src\\a.mjs`) and `./` paths made relative; `../a`, foreign absolute and unknown member dropped; workspace paths kept; empty reply throws; merge keeps edited and added, drops the duplicate; text formats round trip both ways and keep `files`/`added` by name; prompt cap with the "(… N more)" line; Markdown headings; matches (plural, whole word, max 3); touched areas for project and workspace; the system prompt names every data tag.
- [ ] **Step 10:** Run `node tools/test.mjs test/requirements-brief.test.mjs`; commit `Requirements: product brief shape, prompt, merge and rendering`.

---

### Task 3: Git facts for the brief

**Files:**
- Modify: `src/core/auto/repo-look.mjs` (`openRepoLook` returns `commit`; `openWorkspaceRepoLook` returns `commits: { [projectKey]: sha }`, from `createDetachedWorktree`'s `commit`)
- Modify: `src/core/git-info.mjs` (`commitFilesSince`)
- Modify: `test/auto-repo-look.test.mjs`, `test/git-info.test.mjs`

- [ ] **Step 1:** Additive return fields only; the Auto classifier's callers ignore them. No other change to `repo-look.mjs`.
- [ ] **Step 2:** `commitFilesSince(projectDir, fromSha, toRef, { max = 2000 } = {})` → `{ commits: [{ sha, files: [] }], partial }` or `null` on any failure. Validates `fromSha` `/^[0-9a-f]{7,64}$/i` and `toRef` not starting with `-`. Runs `git -c core.quotePath=false log --format=%x1e%H --name-only --no-renames -n <max> <fromSha>..<toRef> --` through `_run` (so `_testing.setRunner` intercepts it, with `DIFF_TIMEOUT_MS`); splits on `\x1e`; `partial` when `max` commits came back.
- [ ] **Step 3: Tests.** Repo look on a temp repository returns the `HEAD` sha; workspace look returns one sha per member checked out. `commitFilesSince` with a fake runner (parsing, `partial`, a bad sha → `null` with no call) and on a real temp repository (two commits since, files listed, a merge commit lists none).
- [ ] **Step 4:** Run `node tools/test.mjs test/auto-repo-look.test.mjs test/git-info.test.mjs`; commit `Requirements: the commit a repo look read, and files changed since a commit`.

---

### Task 4: The brief job (`brief-job.mjs`)

**Files:**
- Create: `src/core/requirements/brief-job.mjs`
- Modify: `src/core/requirements/interview.mjs` (only: `export` on `async function callModel`)
- Create: `test/requirements-brief-job.test.mjs`

- [ ] **Step 1: Constants.** `MAX_BRIEF_JOBS = 2`, `BRIEF_MAX_TURNS = 40`, `BRIEF_TIMEOUT_MS = 600_000`. An in-module `Map` of running jobs keyed `'<scopeType>:<scopeKey>'`; `isBriefBusy(scopeType, scopeKey)`; `briefSettled(scopeType, scopeKey)` (tests await it).
- [ ] **Step 2: `briefTarget(scopeType, scopeKey, d)`** → project: `{ name, dirs: [{ project: key, dir: path }] }` from `d.listProjects()` (`exists` required for a look); workspace: `{ name, description, seed, dirs: [{ project: projectKey, dir: projectDir }] }` from `d.workspaceTarget(id)` plus `d.readWorkspace(id)` for `descriptionOrigin` and `mapSummary.scannedAt` (D13). Members without a `.git` are left out of `dirs`.
- [ ] **Step 3: `makeBrief(scopeType, scopeKey, { by = null } = {}, deps = {})`**, `deps` defaulting to `{ runClaudeImpl, listModels, listProjects, workspaceTarget, readWorkspace, openLook: openRepoLook, openWorkspaceLook: openWorkspaceRepoLook, budget: () => budgetStatus(), onChange: () => {} }`. Synchronous refusals, in this order, before anything is written: `getContext(...).lookAtCode` false → `CONFLICT` "Looking at the code is off for this project. Turn it on under Your notes for Worca." (workspace: "…for this workspace…"); no `dirs` → `CONFLICT` "There is no repository to look at."; busy → `BUSY`; `jobs.size >= MAX_BRIEF_JOBS` → `BUSY` "Worca is making other briefs; try again in a moment."; `budget().blocked` → `BUDGET` (A1's wording, `assertBudget`). Then `beginBrief`, notify, and the job:
  1. `branches` = `currentBranch(dir)` per dir (before the checkout).
  2. Mock: `sections = mockBrief(name)`, `files = ['README.md']`, `sources` = `{ project, branch, sha: await worktreeHead(dir) }`; no model, cost 0.
  3. Else: open the look (`openLook(dir, scratch, { signal })` for a project; `openWorkspaceLook(members, scratch, { signal })` for a workspace, `members` as `workspaceTarget` gives them); none → `failBrief` `NO_REPO`. `model = await requirementsModel(d.listModels)`; check the budget again; `callModel(d, { cwd: look.cwd, systemPrompt: BRIEF_SYSTEM_PROMPT, prompt: buildBriefPrompt({ scopeName, notes: ctx.body, workspaceDescription, current: row.madeAt ? row.sections : null, edited: row.edited, members: look.members || null }), model, tools: REPO_LOOK_TOOLS, maxTurns: BRIEF_MAX_TURNS, timeoutMs: BRIEF_TIMEOUT_MS })`; `normalizeBrief(safeParseJson(text), { cwd: look.cwd, members: look.members || null })`. `sources` from `look.commit` / `look.commits` and `branches` (only the members actually checked out).
  4. Re-read the row; `mergeBrief(row, fresh)`; `saveBriefResult` with `seed` (workspace) and `model`.
  5. Costs: `addBriefCost(id, cost)` and `recordRequirementsCostDelta({ briefId: id, amountUsd: cost, model })` on success and on failure (the failed call's `err.costUsd`, as A1).
  6. Any error → `failBrief(id, { code: err.code || (RoundError ? 'BAD_REPLY' : 'FAILED'), message })`; `TIMEOUT` keeps A1's message with the seconds.
  7. `finally`: `look.close()`, delete the job, notify.
  Returns the job promise (routes do not await it).
- [ ] **Step 4: `recoverBriefs()`** → for each `listMakingBriefs()` row not busy: `failBrief(id, { code: 'INTERRUPTED', message: 'The look at the code did not finish because Worca restarted. Try again.' })`; returns the count.
- [ ] **Step 5: `briefStaleness(brief, { listProjects, workspaceTarget, commitsAhead, commitFilesSince } = defaults)`** → `null` when the brief was never made or has no source with a sha; per source resolve `dir` (project path, or the member's `projectDir` by key), `ref = branch ? 'refs/heads/' + branch : 'HEAD'`; `n = await commitsAhead(dir, sha, ref)`; `null` → return `{ known: false, branch, sha }`; else `commitFilesSince(dir, sha, ref)` (null → `known: false`). Result `{ known: true, commits: Σn, touching, areas, partial, sources: [{ project, branch, sha, commits: n }] }` with `touchedAreas`. Memo `Map` keyed `'<id>:<madeAt>'`, 30 s.
- [ ] **Step 6: `briefEstimate(d)`** → `{ costUsd: median of recentBriefCosts(10) rounded to cents or null, model: { id, label } | null }` (`label` from the `listModels(null)` entry with that id, else the id).
- [ ] **Step 7: Tests** (fake `runClaudeImpl` asserting `tools`/`allowedTools` equal `REPO_LOOK_TOOLS`, `maxTurns: 40`, `spawnKind: 'aux'`; fake looks recording `close()`): every refusal writes no row and makes no call; a good project look stores sections, sources (`branch`, `sha` from the fake look), relative files, model, cost, one ledger row with `brief_id`; a workspace look passes the description and stores `seed` (`workspace-map` with `scannedAt`, and `workspace-description` without a map); a refresh passes `<current_brief>` and the edited list; an edit made while the fake call is pending survives (merge at the end); a bad reply → `error.code === 'BAD_REPLY'`, the earlier brief kept, cost booked; a throwing call with `costUsd` books it; `close()` called on success, failure and abort; `recoverBriefs` on a `making` row; mock mode never calls `runClaudeImpl` and fills `sources` from a temp repository; staleness on a temp repository: no commits → `commits: 0`; one commit touching an area file and one not → `commits: 2, touching: 1, areas: ['Orders']`; a reset that drops the brief's commit → `known: false`; the memo returns the cached value within 30 s.
- [ ] **Step 8:** Run `node tools/test.mjs test/requirements-brief-job.test.mjs test/requirements-interview.test.mjs`; commit `Requirements: the product brief job, its costs, recovery and staleness`.

---

### Task 5: The interview reads the brief; Look closer; Add this to the brief

**Files:**
- Modify: `src/core/requirements/round.mjs` — only these hunks: the data-tag list line and the "Do not ask what…" line of `ROUND_SYSTEM_PROMPT`; the data line and the JSON line of `ORIENTATION_SYSTEM_PROMPT`; a `brief` parameter and one block in `buildRoundPrompt` and `buildOrientationPrompt`; `area` in `normalizeOrientation`.
- Modify: `src/core/requirements/interview.mjs` — only: `orient` / `runOrientation` (the skip and the brief), the `buildRoundPrompt` call and the round payload in `runRound`, the `useBrief` flag through `startOrientation`, the mock orientation with a brief.
- Modify: `src/core/requirements/edits.mjs` (`addToBrief`)
- Modify: `test/requirements-round.test.mjs`, `test/requirements-interview.test.mjs`, `test/requirements-edits.test.mjs`

- [ ] **Step 1: Prompts** (`round.mjs`). `ROUND_SYSTEM_PROMPT`: add `<product_brief>` to the data-tag list; the rule becomes `- Do not ask what the project context, the product brief or the code summary already answers.` `buildRoundPrompt({ …, brief = null })` where `brief` is `{ text, label }` (`label` like `main @ 3f9c2a1, 2026-10-19`): when set, insert ``<product_brief made="${asData(label)}">\n${asData(text)}\n</product_brief>`` directly before the `<what_worca_found_in_the_code>` block. `ORIENTATION_SYSTEM_PROMPT`: add `<product_brief>` to its data line; its JSON line becomes `{ "summary": "...", "files": ["each path you read"], "area": "only when asked: the product area" }`. `buildOrientationPrompt({ …, brief = null })`: when set, the same block after `<project_context>` and, before the reply line, `The product brief above already describes the product. Look only at what this feature needs that the brief does not say, and name the product area it belongs to in "area".` `normalizeOrientation` adds `area: clip(raw?.area, 80)`.
- [ ] **Step 2: The brief for a feature** (`interview.mjs`): a helper `briefFor(f)` → `usableBrief(f.scopeType, f.scopeKey)` mapped to `{ id, madeAt, text: renderBriefForPrompt(b.sections), label }` (label from the first source: `<branch or 'HEAD'> @ <sha 7>, <madeAt date>`; a workspace: `<n> projects, <date>`), or `null`.
- [ ] **Step 3: The skip.** `startOrientation(seq, { by, thenRound = true })` passes `useBrief: thenRound` to `runOrientation`. In `runOrientation`, when `useBrief` and `briefFor(f)`: skip the budget check and the look; append the `orientation` turn `{ summary: '', files: [], skipped: 'brief', error: null, briefMadeAt }` (no cost); store the orientation `{ summary: '', files: [], skipped: 'brief', briefMadeAt, at }`. The `look` route (`thenRound: false`) and Try again after a failed look never skip. Otherwise `orient` gets `brief` and passes it to `buildOrientationPrompt`; the stored orientation keeps `area`. Mock: with a brief, the closer look returns `{ summary: '[mock] A closer look: …', files: ['README.md'], area: '[mock] Orders' }`.
- [ ] **Step 4: Rounds.** `runRound` computes `brief = briefFor(f)` once; passes it to `buildRoundPrompt`; the round turn's payload gets `brief: { id, madeAt }` when set (mock rounds too, so "Used by" works in the proof).
- [ ] **Step 5: `addToBrief(seq, { by })`** (`edits.mjs`): `f = requireFeature(seq)`; archived → `CONFLICT`; `b = usableBrief(...)` none → `CONFLICT` "This project has no product brief."; `o = f.orientation`; no `o.summary` → `CONFLICT` "There is no closer look to add."; `o.addedToBrief` → `CONFLICT` "Already added to the brief."; in one `tx`: `setBriefSections(b.id, { sections: { ...b.sections, areas: [...b.sections.areas, { name: clip(o.area, 80) || clip(f.title, 80), text: clip(o.summary, 1000), status: null, files: o.files.slice(0, 40), added: { feature: f.id, at } }] }, edited: b.edited })` (refused with `CONFLICT` "The brief already has 20 areas." when full) and `updateFeature(seq, { orientation: { ...o, addedToBrief: at } })`. Returns `{ scopeType, scopeKey }` for the brief frame.
- [ ] **Step 6: Tests.** Round: the block present / absent and placed before `<what_worca_found_in_the_code>`; the system prompts name `<product_brief>`; orientation prompt with the brief line; `normalizeOrientation` keeps `area`. Interview (mock and with a fake `runClaudeImpl`): with a saved brief, create → no look call, `skipped: 'brief'`, round 1 payload has `brief`, the fake round call's prompt contains `<product_brief`; without one → A1 behaviour unchanged; `startOrientation(…, { thenRound: false })` with a brief calls the look with the brief block and stores `area`; Try again with no orientation skips again; a budget-blocked install still creates with a brief (no look to refuse) and the round is refused as A1. Edits: `addToBrief` happy path and each refusal; the area keeps the files; the brief section is not marked edited.
- [ ] **Step 7:** Run `node tools/test.mjs test/requirements-round.test.mjs test/requirements-interview.test.mjs test/requirements-edits.test.mjs`; commit `Requirements: interviews read the product brief; Look closer and Add this to the brief`.

---

### Task 6: Routes, views and server wiring

**Files:**
- Modify: `src/core/requirements/routes.mjs`
- Modify: `ui/server.mjs` (boot: `recoverBriefs()` beside `recoverRequirements()` ~line 14759; nothing else — the routes come through `registerRequirementsRoutes`)
- Create: `test/requirements-brief-api.test.mjs`
- Modify: `test/requirements-api.test.mjs`, `test/server-boot-sweeps.test.mjs` (or the test covering `recoverRequirements` at boot: find with `grep -ln recoverRequirements test`)

- [ ] **Step 1: Notifier.** `requirementsBriefNotifier(broadcast)` → `(scopeType, scopeKey) => { if (flagEnabled('requirements')) broadcast({ type: 'requirements-changed', brief: `${scopeType}:${scopeKey}` }); }`. `registerRequirementsRoutes` passes `onBriefChange` to `makeBrief` (as its `onChange`) and calls it after every brief route and after `brief-addition`.
- [ ] **Step 2: Table.** Add, before `['GET', P]`: `GET/POST/DELETE ${P}/brief/:scopeType/:scopeKey`, `GET ${P}/brief/:scopeType/:scopeKey/markdown`, `PUT ${P}/brief/:scopeType/:scopeKey/sections/:section`, `DELETE ${P}/brief/:scopeType/:scopeKey/sections/:section/edited`; and `POST ${P}/:seq/brief-addition` after `follow-up`.
- [ ] **Step 3: Handlers** (design §5), each starting with `checkTarget`:
  - `GET` → `briefPage(scopeType, scopeKey, d)`: `{ brief, target: { name, branch: project ? await currentBranch(path) : null }, notes: getContext(...), estimate: await briefEstimate(d), usedBy: briefUsers(...), staleness: brief ? await briefStaleness(brief) : null }`.
  - `POST` → `makeBrief(…, { by }, d)` (not awaited); 202 with `briefPage`.
  - `PUT …/sections/:section` → no made brief → `CONFLICT` "There is no brief yet."; `parseSectionValue`; `setBriefSections` with `edited[section] = true`; 200 `briefPage`.
  - `DELETE …/sections/:section/edited` → `edited[section]` removed; 200.
  - `DELETE` (brief) → busy → `BUSY`; `deleteBrief`; 200 `briefPage` (brief `null`).
  - `GET …/markdown` → `renderBriefMarkdown`; `download=1` → attachment `briefFileName(name)`; no made brief → 404.
  - `POST /:seq/brief-addition` → `addToBrief`; brief frame and feature frame; 200 feature view.
- [ ] **Step 4: Views.** List: `briefs` = `listBriefs()` with `lookAtCode` per row (from `getContext`). `featureView`: `feature.brief` = `{ status, madeAt, sources, matches: briefMatches(b.sections, f), lookAtCode }` from `usableBrief` (else `null`), and `feature.lookCostUsd` = the list's median look cost.
- [ ] **Step 5: Tests** (`test/requirements-brief-api.test.mjs`, mock mode, a project that is a git repository with one commit): flag off → 404 on every new route (the walk in `requirements-api.test.mjs` picks them up from the table) and no brief frame; create → 202, `briefSettled` → `GET` shows `ready`, sections, `sources[0].sha` = the repository's `HEAD`, `staleness.commits === 0`; a commit to `README.md` → `staleness.commits === 1, touching === 1, areas: ['Orders']`; switch off → 409; second create while making → 409; budget blocked → 409 `BUDGET`; `PUT` users as text → edited; release; markdown and download name; delete; `brief-addition` after a mock closer look adds the area and sets `addedToBrief`, a second call → 409; feature view carries `brief.matches` and `lookCostUsd`; frames carry `brief` and are silent with the flag off. Boot: a `making` brief becomes `INTERRUPTED` through the server's boot path.
- [ ] **Step 6:** Run `node tools/test.mjs test/requirements-brief-api.test.mjs test/requirements-api.test.mjs <boot test>`; commit `Requirements: product brief routes and views`.

---

### Task 7: The brief page, none yet; notes; the list header (board 11)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`show` parses `brief/<scopeType>/<encoded key>`; `paint`; new `paintBrief`; `paintList` group headers; `changed(seq, brief)`)
- Modify: `ui/public/app.js` (the `requirements-changed` arm passes `msg.brief`)
- Modify: `ui/public/style.css` (`req-brief-*` rules; tokens only)
- Modify: `test/requirements-view.test.mjs`, `test/requirements-app.test.mjs`

Board `BriefEmpty.dc.html`.

- [ ] **Step 1: Routing.** `show('brief/project/<key>')` → `briefShown = { scopeType, scopeKey: decodeURIComponent(key) }`; paint fetches `GET /api/requirements/brief/…`. `changed(seq, brief)`: on the brief page repaint when `brief` equals its key; on the list repaint on any frame; on a feature page repaint when `seq` matches or `brief` equals the feature's `scopeType:scopeKey`; never on `new`.
- [ ] **Step 2: Header** (both brief states): **← All features**, `h2` **Product brief**, the target chip (`targetLabel`), and (none yet) the subtitle "What the product does, in your words and Worca's. Every interview for <name> starts from it."
- [ ] **Step 3: Head-start card** (when `brief` is `null` or never made): heading **Give Worca a head start**, the board's paragraph, the four parts with the green check icon (`aria-hidden`), the hint line; the cost box: "One look, read-only"; `Branch <code>branch</code>` (workspace: "Each project's current branch"), ` · about <code>$X</code>` only with `estimate.costUsd`, ` · 3 to 5 minutes`; `<model label> · counts toward your limit` (only with `estimate.model`); **Create the brief** (`btn-go`, `data-ui="brief-create"`) → `POST`, repaint. States from design §6 "Not on the boards": making (disabled "Creating…" + hint), `brief.error` (message above, button **Try again**), switch off (disabled + hint).
- [ ] **Step 4: Notes card** (`section.card`, `aria-label="Your notes for Worca"`): heading **Your notes for Worca**, hint "was “Project context”", textarea (`aria-label`, `data-ui="notes-body"`), the switch (`data-ui="notes-look"`) with the board's label, **Save notes** (`btn btn-mini`) → `PUT /api/requirements/context/…` then repaint (the switch changes the Create button's state). Unsaved text survives live repaints (capture as `ui.ctx` does today).
- [ ] **Step 5: List header.** `paintList` reads `data.briefs`; each group `h2` row gets, right-aligned, `Product brief: none yet · ` + link **Create** (no row), `Product brief: being made…` (making), or the link `Product brief · <age> old` (made); every link routes `brief/<scopeType>/<encodeURIComponent(scopeKey)>`. An `age(iso)` helper: "today", "yesterday", "<n> days", "<n> weeks", "<n> months" (reuse an existing helper from `ui/public` if one returns these words; else this one, exported for tests).
- [ ] **Step 6: Tests:** route parsing with an encoded key; head-start card texts, estimate shown / hidden, model label; Create posts and repaints; making, error and switch-off states; notes save body and switch, unsaved text kept over a frame; list headers in all three states and their links; `changed` repaint rules; `app.js` passes `brief`.
- [ ] **Step 7:** `node tools/test.mjs test/requirements-view.test.mjs test/requirements-app.test.mjs`; commit `Requirements: product brief page (none yet), notes and list header`.

---

### Task 8: The brief page, made (board 12)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`paintBrief` made state, the section editor, menus)
- Modify: `ui/public/style.css`
- Modify: `test/requirements-view.test.mjs`

Board `Brief.dc.html`.

- [ ] **Step 1: Chips:** `Made from <code>branch @ sha7</code> · <age> ago` (workspace: `Made from <n> projects · <age> ago`), `usd(brief.costUsd)`, `Used by N feature(s)`; for a workspace with `seed.kind === 'workspace-map'` also `Built from the workspace map, scanned <date>`. Right: **Export ▾** (Copy Markdown, Download .md) and **⋯** (`Refresh the brief · about $X`, `Delete the brief` after `confirm()`), through the existing `menu()` helper.
- [ ] **Step 2: Notice** (`section`, `aria-label="The brief is behind the code"`, amber wash, warning icon) when `staleness?.commits > 0`: bold **The code moved on since this brief**; the sentence of design §6 (`m > 0` with the area names bold and joined "A, B and C"; `m = 0`); **Refresh · about $X** (`btn btn-mini`, the estimate part only with one) → `POST`. When `staleness?.known === false`: the same box with the "cannot tell" sentence and the same button.
- [ ] **Step 3: Brief card** (left, `section.card`, `aria-label="The brief"`): per section a head with `h4` title (`· edited by you` in amber when edited) and the pencil `req-ico` button (`aria-label="Edit <title>"`, `data-ui="brief-edit-<section>"`); bodies as design §6 (areas: `badge green` **Exists** / `badge amber` **Partly**). The pencil opens A1's inline editor for that section (textarea prefilled with `sectionText`, **Save** → `PUT`, **Cancel**), one at a time, unsaved text kept over live repaints; an edited section shows **Let Worca rewrite this** (text button → `DELETE …/edited`). While the brief is being refreshed the card stays editable and the chips row gets the "running" badge **Refreshing**.
- [ ] **Step 4: Right column:** **How Worca uses it** (board text with the scope name; `Used by FEAT-2, FEAT-3` as links to the features, hidden when none); **Your notes for Worca** (`details open`: the notes text or "No notes yet.", **Edit notes** → swaps in Task 7's notes editor); **What Worca read** (`details`, summary hint `<n> files`, the file list).
- [ ] **Step 5: Tests:** chips (project, workspace with seed), menus' entries and actions (delete asks first), notice for `m > 0`, `m = 0`, unknown, absent at 0 commits; each section's rendering; edit → PUT body as text; release; editor survives a frame; Refreshing badge; right column links and counts.
- [ ] **Step 6:** `node tools/test.mjs test/requirements-view.test.mjs`; commit `Requirements: product brief page (made), edits and the code-moved-on notice`.

---

### Task 9: New feature and the feature page with a brief (boards 13, 14)

**Files:**
- Modify: `ui/public/requirements-view.mjs` (`paintNew`, `orientationBox` → `knowsCard`, `header`'s ⋯ menu, remove `contextPanel` / `loadContext` and their `ui.ctx` state from the feature page)
- Modify: `ui/public/style.css`
- Modify: `test/requirements-view.test.mjs`

Boards `NewFeatureBrief.dc.html`, `LookCloser.dc.html`.

- [ ] **Step 1: New feature.** `paint('new')` keeps the list call and reads `briefs` too. When the selected target has a made brief: the hint under **For** becomes the green line (`req-brief-line`, check icon `aria-hidden`): `Worca knows <name> from its ` + link **product brief** (routes to the brief page) + ` (<age> old), so it starts asking right away.` + ` It looks closer at the code only if you ask.` (the last sentence only when that row's `lookAtCode` is true); and the "About $X for the code look…" hint is not rendered. It updates when the select changes. Without a brief: A2's page, except "Change that in Project context." / "…Workspace context." become "Change that in Your notes for Worca."
- [ ] **Step 2: What Worca knows** (left column, where A2 renders `orientationBox`), only when `f.brief`; otherwise A2's box unchanged. Head: **What Worca knows** + hint: before a closer look `from the ` link **product brief** ` · <age> old`; after `brief + a closer look · <n> files · $<cost>` (A2's look count and cost from the turns). Body before: `Worca works from the <name> brief: <matches joined "a, b and c"> are described there. It has not looked at the code for this feature.` (no matches: `Worca works from the <name> brief. It has not looked …`); a failed closer look adds the hint "Worca could not look at the code this time."; footer hint "Worth it when the feature touches something the brief only skims." and **Look closer · about $X** (`data-ui="look-closer"`, `POST …/look`; the price only with `f.lookCostUsd`; hidden when `f.brief.lookAtCode` is false). Body after: the summary; `Not in the brief yet. ` + link-button **Add this to the brief** (`data-ui="brief-add"`, `POST …/brief-addition`) unless `orientation.addedToBrief`; footer **Look again**. Busy / archived: buttons disabled (A1 lock rules).
- [ ] **Step 3: ⋯ menu.** The context entry becomes **Your notes for Worca** (`data-ui="mi-notes"`) → routes to the brief page; **Look again** reads **Look closer** while the orientation is `skipped: 'brief'`. Remove the context panel and its state; keep every other ⋯ behaviour.
- [ ] **Step 4: Tests:** New feature with and without a brief, switching the target, link route, switch-off variant, cost hint hidden; the card's two states, matches sentence variants, failed look line, Look closer hidden with the switch off and its POST, Add this POST and its absence once added, Look again; ⋯ entries; A2's box unchanged without a brief; the removed context panel's tests replaced by the brief page's notes tests (Task 7), none deleted without a replacement asserting the same behaviour.
- [ ] **Step 5:** `node tools/test.mjs test/requirements-view.test.mjs`; commit `Requirements: New feature and What Worca knows with a product brief`.

---

### Task 10: Real-browser proof and docs

**Files:**
- Modify: `tools/verify-requirements-cdp.mjs`
- Modify: `docs/requirements.md`

- [ ] **Step 1: Proof** (mock, after the existing checks; the test project is already a git repository with one commit): open the list, follow **Create** on the group header, **Create the brief**, wait for the sections (four headings, the `Made from` chip with the repository's short sha); New feature for that project shows the green line and no look-cost hint; create it → the feature page shows **What Worca knows** with **Look closer**; press it → the after state with **Add this to the brief**; press it → the brief page lists the `[mock] Orders` area added and "Used by 1 feature". Keep the proof's numbered-check style and non-zero exit on failure.
- [ ] **Step 2: Docs:** `docs/requirements.md` gains **Product brief**: what it holds, how it is made (one read-only look, the branch it reads, cost and limit), editing and what a refresh keeps, "the code moved on" (what is counted and how areas are matched), how interviews use it, Look closer and Add this to the brief, Your notes for Worca (formerly Project context), workspaces (starts from the workspace description). Product language, short.
- [ ] **Step 3:** Run `npm run verify:requirements`; commit `Requirements: real-browser proof and docs for the product brief`.

---

### Task 11: Whole-branch check

- [ ] **Step 1:** `npm test` on the branch. For every failing file, run the same file on `feat/req-a2-ready-start` (`git stash -u; git switch feat/req-a2-ready-start; node tools/test.mjs <files>; git switch -; git stash pop`); only failures that pass on the base branch are this branch's to fix. Record the counts.
- [ ] **Step 2:** `npm run verify:requirements` green.
- [ ] **Step 3:** Re-read design §9 and list, for the merge with lane 1, the exact lines of `round.mjs` / `interview.mjs` this branch changed (`git diff feat/req-a2-ready-start -- src/core/requirements/round.mjs src/core/requirements/interview.mjs`), in the final report.
- [ ] **Step 4:** Fix what is this branch's; commit `Requirements: whole-branch fixes` if anything changed.
