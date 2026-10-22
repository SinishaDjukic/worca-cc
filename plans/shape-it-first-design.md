# Shape it first: plan a task with Worca before it builds, in Chat

Date: 2026-10-14. Base branch: `dev` (761452f9, 1.11.0). Branches: `feat/shape-it-first-<n>-<slice>`, one PR per slice, stacked.
Mock (approved): the "Specs in Chat" design canvas, https://claude.ai/artifact/MJk8bfs2cK4YsKTBta5Z2q
(screens 1–7).
**Revised 2026-10-15** after the first real sliced feature (#718, run tags): §11 records what it showed and the
decisions D16–D35, which take precedence over §2–§3 where they differ. Replaces Spec Builder (#678, closed as not planned; PR #679 closed). Some
Spec Builder code on `feat/spec-builder-v2` is reused (§4.6).

## 1. Goal

**When a task is thin or large, Worca offers to shape it first: it asks what it can't answer
from the repo, writes the plan with the right perspectives, and the person approves the plan
before anything is built.** The run then only builds. Reviews check what the plan promised.

It must not feel like "write a spec". The person describes the problem as they would anyway.
Worca does the shaping, using the same Clarify, Planner and Refine agents a run uses, so there is
one planner, not a second one in Chat.

**Plan in slices.** For a very large feature, Worca can first cut it into a few sequential
slices, each shipped and reviewed on its own, and plan each slice. It must not cut more than
needed (§3.8).

**Success:**
1. **About 3 minutes of the person's attention** from a thin request to an approved plan: at most
   3 questions, then reading the plan card.
2. **The plan card passes the shape check on first draft in at least 80% of cases**, and the rest
   after one **Fix**.
3. **Fewer review cycles:** shaped runs average fewer implement ⇄ review cycles than comparable
   unshaped runs (measured, §7).
4. **Every perspective checklist item ends the run met with evidence, or marked not applicable.**
   The run page and the PR show it.
5. **Slicing stays rare and coarse:** at most 5 slices by default, and fewer than 10% of slice
   outlines get a slice merged by the person (a sign of over-splitting, §7).

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **Shaping is a run, shown in Chat.** "Shape it first" starts a normal run on the new built-in workflow **Shape it first** (`wf_shape`): Task → Clarify → Plan → Refine → **approval stop** → Implement ⇄ Review (plus the manual-test stages when UX is a perspective). Chat shows the run's questions and its plan as cards (screens 3–5). Approving the plan lets the same run continue. Nothing in Chat drafts a plan itself. This is what the mock's pros/cons promise ("one planner, the refine review is kept"). |
| D2 | **A generic approval stop on a node.** A graph node can carry `config.approve: { kind: 'plan', port: '<output port>' }`. When the node finishes, the executor holds the run with an ask `{ kind: 'plan', node, file }` (the same `_ask` path Auto's workflow review uses, `src/core/orchestrator.mjs:529`) before any downstream node starts. Answers: `approve`, `revise` (with feedback text: the planner node re-runs with it, then Refine, then the stop again), `stop`. Away mode never answers a `plan` ask (it needs a person, like system-package installs). `wf_shape` puts it on Refine's `plan` output. |
| D3 | **At most 3 questions while shaping.** In `wf_shape`, Clarify is capped at 3 questions (the agent allows 8 today, `agents/worca-cc-clarify.md:35`) through the node's `promptHints`: "only decisions that change what gets built and that the repo can't answer". The question card offers **Answer and draft** and **Skip, draft with defaults** (skipping answers every question with its recommended option, or the first). |
| D4 | **Perspectives, not roles.** The person-facing name is *perspective*. The list (Product, Architect, QA, UX, Security, DevOps & infrastructure, Release) and the sections each owns come from Spec Builder's `roles.mjs`, renamed to `src/shared/shape/perspectives.mjs`. Product is always on. Worca suggests 2–4 more from the request (the utility model, as for titles; fallback Architect and QA). They show as chips on the run proposal (screen 2) and on the plan card (screen 4). Changing them on the plan card and pressing **Update plan** is a `revise` answer that names the change. |
| D5 | **The planner writes for the perspectives.** The run request carries `shape: { perspectives: [...] }`. The planner's prompt (`buildAgentPrompt`, `src/core/graph/executor.mjs:482`) gains a **Perspectives** block: the sections each picked perspective owns, and "end each section that makes claims with a `### Checklist` of 1–8 `- [ ] R-<p>-<n>` items, one verifiable statement each". Refine checks them too. Runs without `shape` are unchanged. |
| D6 | **Shape check and grounding marks, deterministic.** Ported from Spec Builder (`shape.mjs`, `grounding.mjs`): sections present, testable criteria, decisions decided, repo paths found or marked `(new)`, tests named, no placeholders, checklists present, grounded (at least 3 found paths for a medium or large task). It runs on the plan before the approval stop and its result rides on the `plan` ask. The plan card shows it (screen 4). **Fix** is a `revise` answer naming the failing checks. A failing check doesn't block **Run this plan**; the button reads **Run anyway**. |
| D7 | **Checklists travel into review.** Spec Builder's V14–V16, unchanged in substance: the reviewer's task header lists every `R-…` item. The reviewer's JSON gains `checklist: [{ id, status: met \| unmet \| na, evidence }]`. An `unmet` item, or a `met` one without evidence, becomes a **major** issue through the existing `hasBlocking` path. A review that omits `checklist` when the plan had items counts as one major issue. The run page shows a **Perspective checklists** group per review cycle. The PR description Worca writes ends with the ticked list and its evidence. |
| D8 | **When Chat offers it.** Three ways in, one flow: <ul><li>**The intent chip "Shaper"** in the Chat composer (screen 1), next to New run;</li><li>**the nudge on a run proposal** (screen 2): when `propose_run` would start a task that is thin (the Auto classifier's `taskKind` is `prompt` and it finds open decisions) or large (`size: large`), the card shows **Shape it first** next to **Run as is**, with each one's estimate from the existing estimator;</li><li>**New run** (screen 6): one link under the Markdown source, "Not sure what to build yet? Shaper in Chat →". New run gets no new task source.</li></ul>A small, clear task gets the normal run card with no nudge. |
| D9 | **`propose_run` gains `shape`.** `shape: { perspectives?: string[], slices?: 'auto' \| 'off' }`. When present, the card proposes `wf_shape` (the workflow choice is fixed). `validateProposal` checks the perspective keys. Without `shape`, `propose_run` is unchanged. |
| D10 | **The plan card's actions** (screen 4): <ul><li>**Run this plan**: `approve`;</li><li>**Update plan** (after a perspective change), **Fix**, or a typed message: `revise`;</li><li>**Save to plans/**: writes the approved Markdown to `plans/<slug>-design.md` in the project's checkout. It never overwrites without asking and never commits;</li><li>**Open in New run**: prefills New run's Markdown source with the plan, Workflow Auto. A complete plan then skips Clarify, Plan and Refine through the existing `plan-complete-*` recipes;</li><li>**Stop**: stops the run.</li></ul>Each revise posts a new version of the card (v1, v2, …); older versions collapse. |
| D11 | **Run this plan continues the same run** (screen 5). The run card shows Clarify, Plan and Refine as done ("while shaping") and continues into Implement ⇄ Review. The plan file is the run's plan of record. There is no second run and no re-planning. |
| D12 | **Behind the `shapeFirst` flag, built so it works before #675 lands.** The flag system (#675, `feat/feature-flags`) is still open, so this branch is cut from `dev` and every check goes through **one gate**, never a flag API directly: <ul><li>**Server:** `src/core/shape/gate.mjs` exports `shapeFirstEnabled()` and `requireShapeFirst(req, res)` (answers 404 when off).</li><li>**Client:** `ui/public/chat/shape-gate.mjs` exports `shapeFirstOn()`, read from the WebSocket `hello` frame, which gains `features: { shapeFirst }` (the way it already carries `serverMock`, `ui/server.mjs:748`).</li><li>**Until #675 merges:** the gate reads one temporary switch, the env var `WORCA_SHAPE_FIRST=1` (off when unset). No settings UI and no persisted state, so there is nothing to migrate.</li><li>**When #675 merges:** a follow-up commit adds the registry entry (stage `experimental`, default off, owner, `since`, `reviewBy` ≤ 90 days, docs) and changes only the two gate bodies to `flagEnabled('shapeFirst')` / `flagOn('shapeFirst')`. It also moves the client gates to `data-flag="shapeFirst"` and drops the env var. No call site changes. The `flags-usage` scan then covers the gates.</li></ul>What the gate hides when off: <ul><li>**server:** `POST /api/run` and `propose_run` reject `shape`, the nudge fields are not computed, `wf_shape` is hidden from workflow lists, and the new routes (plan answers, plan save, slice-outline edits) answer 404;</li><li>**client:** the intent chip, the New run link, the nudge and the Plans tab are hidden, and the new chat cards are not registered.</li></ul>**Plan in slices** is behind the same gate, not a flag of its own. The node approval stop (D2) and the checklist review (D7) are generic engine code and need no gate: they only activate for a run that carries `shape`, which only exists when the gate is on. With the gate off, nothing in this spec shows and existing runs behave exactly as today. A run started with it on that is still waiting when it is turned off can still be approved or stopped, so it is never stranded. |
| D13 | **Plan in slices: sequential runs.** See §3.8. A sliced feature becomes a chain of runs with the existing "Run after" chains (`after` + `sourceFromPrevious`, `src/core/scheduler.mjs:212`): slice 2 starts from slice 1's branch when slice 1 finishes `done`, and so on. This is not the Decomposer: the Decomposer splits **one** plan into parallel tasks inside **one** run. Slices are planned, built, reviewed and shipped one after another. |
| D14 | **Slices are planned just in time.** The outline is approved once. Slice 1's plan is written and approved before it runs. Each later slice is planned when its predecessor finishes, against the code as it is then, and stops for approval like slice 1 (a per-feature switch, **Approve each slice's plan**, on by default, can turn the later stops off). **Revised by D19:** later slices skip Clarify and stop only when their plan departs from the outline. |
| D15 | **A guard against over-splitting** (§3.8): the planner's slicing rules plus a deterministic outline check, and the person can merge slices on the card before approving. |

## 3. Design

### 3.1 Chat home (screen 1)

The composer gets the **Shaper** intent (`ui/public/chat/intent.mjs`), with the help
line "Agree on what gets built before anything runs · ~3 min" and the **New** badge while the
flag is in beta. Its lead tells the model: "Shape this task first: propose a run with `shape`". The lead is never
shown in the person's message: the bubble shows the chip and their text only (D21).
The home's tabs gain **Plans**: the Chat threads with a plan card, newest first, each with its
state (shaping, waiting for approval, running, done).

### 3.2 Run proposal and nudge (screen 2)

When the nudge applies (D8), the run card shows:
- "This task leaves N decisions open", listing the open decisions the classifier found;
- the suggested perspectives as chips, plus "+ N more";
- two choices, each with its estimate: **Run as is** ("the run decides these itself and may stop
  to ask you mid-run") and **Shape it first** ("settle them now; you approve the plan, the run
  only builds");
- buttons **Shape it first** (primary), **Run anyway**, and **Open in New run**.

### 3.3 Questions (screen 3)

Chat renders the run's Clarify ask as a **question card** (new card type `run-questions`):
- up to 3 questions, each with its options as buttons and a free-text field;
- **Answer and draft**, which answers through the run's existing question endpoint;
- **Skip, draft with defaults**.

The card renders any `questions` ask of a run linked to the thread, not only in shaping. The run
page's own question panel keeps working. Answering in either place resolves both.

### 3.4 The plan card (screen 4)

A new card type `plan`, built from the `plan` ask:
- **Header:** the title, section count, picked perspectives, word count and the shape score
  ("Shape 7/8").
- **"What shaping settled":** N open decisions settled, and the estimate for the build.
- **Perspective chips** (D4) with **Update plan**.
- **Shape check row** (D6): passing checks as chips, each failing check with **Fix**.
- **The plan:** rendered Markdown, collapsed to about 40%, with perspective tags on the sections
  each owns and grounding marks on repo paths ("✓ exists", or `new`). **Open full plan** opens it
  in the run's artifact viewer.
- **Actions** (D10).

### 3.5 Run this plan (screen 5)

The card turns into Chat's existing live run card. Clarify, Plan and Refine show as done "while
shaping"; Implement is current. A line names the plan file. If it was saved to `plans/`, the
saved path is shown with **Open**.

### 3.6 New run (screen 6)

There is no new task source. The only change is the link from §D8. A pasted Markdown task goes
through the same nudge when it is thin or large: the run starts with the toggle "Shape it first",
which runs `wf_shape` with the pasted text as the task.

### 3.7 Pros and cons (screen 7)

This is copy for the team, not product UI. The verdict holds: this is worth building because the
perspectives carry through to review (D7). That is why D7 is in scope and not a follow-up.

### 3.8 Plan in slices

**When.** Shaping offers slicing only when the task is large: the classifier's `size: large`, or
the planner's first pass touches 3 or more subsystems. The person can also ask for it in their
own words ("plan this in slices") or turn it off with `shape.slices: 'off'`. The default is
`auto`.

**The outline.** In slicing mode the Planner first writes `slices.json`, before any plan:

```json
{ "why": "two independent user-facing steps; the second needs the first's storage",
  "slices": [
    { "id": "s1", "title": "Store chart definitions", "goal": "…", "inScope": ["…"], "outOfScope": ["…"],
      "acceptance": ["…"], "dependsOn": [], "estimate": "medium" },
    { "id": "s2", "title": "Ask for a chart in Chat", "goal": "…", "acceptance": ["…"], "dependsOn": ["s1"], "estimate": "medium" } ] }
```

The approval stop shows it as a **slices card**. Each slice shows its title, goal, acceptance
and estimate, plus **Merge with next** and **Remove**. Then **Plan slice 1**, or **Don't slice**,
which plans the whole thing as one.

**Rules for the Planner** (the slicing block of its prompt):
- Slice only where a reviewer would want a separate pull request. One slice means no slicing,
  and that is a good answer.
- Slice by behaviour, never by layer. "The API", "the UI" and "the tests" are not slices.
- Every slice leaves the product working and shippable on its own (behind the feature flag when
  the feature is half-built) and has at least one acceptance check it can pass alone.
- Prefer 2–3 slices. More than 5 needs a written reason in `why`.
- No slice that only adds tests, docs, refactoring or setup, unless a later slice names it in
  `dependsOn` and it is at least medium-sized.

**The outline check** (`checkSlices`, deterministic, beside the shape check):

| id | Passes when |
|---|---|
| `count` | 2–5 slices. 6–8 only with a `why` of at least one sentence. More than 8 never passes. |
| `acceptance` | Every slice has 1–6 acceptance checks, each passing the shape check's `testable` rule. |
| `notLayered` | No slice title or goal is only a layer ("backend", "frontend", "API", "UI", "tests", "docs"). |
| `notTiny` | No slice is `small` while its neighbour is also `small`: the card suggests merging them. |
| `order` | `dependsOn` only names earlier slices (no cycles, no forward references). |

A failing outline check offers **Fix** (a `revise`) and the person can still approve.

**After approval:**
- Slice 1 is planned and approved like any shaped task (§3.3–3.5) and runs.
- Slices 2…N are created as chained tickets (`after` = the previous slice, `afterPolicy: 'done'`,
  `sourceFromPrevious: true`) running `wf_shape` with the brief "slice k of N" plus the outline.
  Their Planner gets the outline and a summary of what the earlier slices changed (their result
  summaries and diffs' file lists).
- **One PR per slice** (decided 2026-10-14): each slice is its own branch and its own PR, stacked on the previous
  one (slice 2's PR targets slice 1's branch until slice 1 merges, then retargets). Smaller reviews, and each
  slice ships on its own.
- A slice that ends `stopped` or `error` halts the chain. The Chat thread shows "Slice 2 stopped
  · slices 3–4 waiting" with **Resume slice 2**, **Re-plan the rest**, and **Cancel the rest**.

The thread's plan card becomes a **feature card**: the outline with each slice's state (planned,
waiting for approval, running, done, PR) and its link. **Revised by D16–D17:** the feature has its own
page, and the Chat card, the run page and the Runs list link to it.

## 4. Code changes

### 4.1 Engine (`src/core`)
- `graph/builtin-workflows.mjs`: `wf_shape` (D1), reserved id.
- `graph/executor.mjs` / `graph/scheduler.mjs`: the node approval stop (D2). The hold after the
  node completes uses the orchestrator's `_ask` with `kind: 'plan'`. `revise` re-queues the
  approved-from node's producer (Planner) with the feedback as a direction, then Refine.
- `orchestrator.mjs`: `plan` asks in the pending-question state, answers, Away mode excluded.
- `graph/executor.mjs` `buildAgentPrompt`: the Perspectives block (D5) and, in slicing mode, the
  slicing block (§3.8).
- `shape/check.mjs` (new): runs `checkShape` and `checkSlices` on the plan or outline and attaches
  the result to the ask.
- `protocol.mjs` `readReview` plus the code reviewer agent: the checklist field (D7).
- `scheduler.mjs`: slice tickets (§3.8), linked by a `shape.feature` id so the thread can list
  them.

### 4.2 Server (`ui/server.mjs`)
- `POST /api/run` accepts `shape` (D9) when the flag is on, and validates the perspective keys.
- `POST /api/runs/:id/answer` accepts `plan` answers (approve, revise, stop) and slice-outline
  edits (merge, remove).
- `POST /api/runs/:id/plan/save`: writes `plans/<slug>-design.md` into the project checkout,
  refusing to overwrite unless `{ overwrite: true }`.

### 4.3 Ask (`src/core/ask`)
- `tools.mjs` `propose_run`: `shape` (D9). The model is told when to use it (D8).
- `proposal.mjs`: validation, plus the nudge fields on the card (open decisions and both
  estimates) from the classifier.

### 4.4 Chat UI (`ui/public/chat`)
- `intent.mjs`: the **Shaper** intent.
- New cards via `registerChatCard`: `run-questions` (§3.3), `plan` (§3.4), `slices` and `feature`
  (§3.8).
- `ask-panel.mjs` run card: the nudge (§3.2) and the `shape` field in `collectCardBody`.
- Chat home: the **Plans** tab.

### 4.5 New run (`ui/public/index.html`, `app.js`)
- The link (§3.6) and the "Shape it first" toggle on the nudge.

### 4.6 Reused from `feat/spec-builder-v2`
`src/shared/spec-builder/{roles,shape,checklist,front-matter}.mjs` (renamed to
`src/shared/shape/`, with "role" renamed to "perspective" in user-facing text),
`src/core/spec-builder/{grounding,estimate,suggest}.mjs`, and the Auto guard
(`src/core/auto/spec-guard.mjs`) for **Open in New run**. The wizard UI, `propose_spec` and the
Spec Builder task source are not reused.

### 4.7 Agents
- `agents/worca-cc-clarify.md`: no change. The 3-question cap comes from the node's
  `promptHints`.
- `agents/worca-cc-planner.md`: a short section on perspectives and checklists. A slicing section
  applies only when the prompt asks for slices.
- `agents/worca-cc-code-reviewer.md`: the checklist field (D7).
- `agents/worca-cc-decomposer.md`: no change in this spec. Its "prefer many thin slices" is about
  parallel tasks within one run, a different thing (D13).

## 5. Out of scope
- Chat drafting a plan without a run (D1 rules it out).
- Editing the plan as text in the card. Ask for changes in words, or Save and edit the file.
- Parallel slices. Slices are sequential in this spec. A follow-up can run slices whose `dependsOn` is
  empty side by side, since the outline already records it (§11.4).
- One PR for all slices (decided against: one PR per slice, §3.8).
- Changes to the Decomposer.

## 6. Testing
- **Engine:**
  - the approval stop holds before downstream nodes; approve continues; revise re-runs Planner
    and Refine with the feedback and stops again; stop ends the run;
  - Away mode never answers a `plan` ask;
  - resume while held keeps the hold.
- **Clarify cap:** a mock Clarify that writes 5 questions under `wf_shape` is cut to 3, keeping
  the first 3.
- **Prompt:** the Perspectives block lists exactly the picked perspectives' sections; runs without
  `shape` have byte-identical prompts.
- **Shape and slice checks:** table tests for every check, including each over-splitting rule.
- **Review checklists:** port Spec Builder's V15 tests: an unmet item, and a met item without
  evidence, each become a major issue; a missing checklist when items exist is one major issue.
- **API:** with the gate off, `shape` is rejected and the new routes answer 404 (`requireShapeFirst`). Plan save never
  overwrites without `overwrite: true` and never writes outside the project. A run waiting for plan approval can still
  be answered after the flag is turned off.
- **Gate:** every call site goes through `shapeFirstEnabled` / `shapeFirstOn` (a test greps for `shape` routes and cards
  outside the gate). With `WORCA_SHAPE_FIRST` unset, the default, nothing shows; with it set, everything does. After #675:
  `flags-usage` finds the gates and `index-html` lists `shapeFirst` in `data-flags`.
- **Chat UI (jsdom):**
  - the intent;
  - the nudge shows only for thin or large tasks;
  - the question card answers through the run;
  - the plan card's actions map to the right answers;
  - the slices card's merge and remove;
  - the feature card's states.
- **End to end (mock mode):**
  - a shaped run: questions → plan → approve → implement → review with checklists → PR body
    with the ticked list;
  - a sliced feature with 2 slices: the second starts from the first's branch after it finishes,
    stopping for its plan approval.
- **Real-browser check** of the plan card and the question card (the review of #692 showed jsdom
  misses layout bugs).

## 7. Measuring it (while in beta)
Per shaped run, recorded on the run:
- the questions asked and skipped;
- the revise count before approval;
- the shape score at approval;
- the review cycles;
- the checklist items met, unmet and n.a.;
- the cost of shaping vs building.

Per sliced feature:
- the slice count proposed and approved;
- the merges and removals the person made (the over-splitting signal);
- the slices that finished.

These are compared on the Statistics page against unshaped runs of the same size.

## 8. Mock changes before build
- **Screens 3–5:** the header chip "Shaping" stays. The copy "draft" means the run's Planner, not
  Chat.
- **Screen 5:** the stages read "Clarify ✓ · Plan ✓ · Refine ✓ while shaping", not "skipped".
- **§3.8 boards:** done: screen 8 (the slices card) and screen 9 (the feature card), added 2026-10-14.

## 9. Open questions (defaults taken until someone objects)
1. **Per-slice plan approval:** default on (D14). Scheduled and Away runs can't turn it off; a
   `plan` ask always waits for a person.
2. **Save to plans/:** writes into the checkout only (D10). It doesn't commit.
3. **The nudge's thresholds:** start with the classifier's `size: large` or open decisions ≥ 2,
   then tune them from §7.

## 10. What slice 1 built (PR 1, `feat/shape-it-first-1-engine`)

Slices 2–4 build on this, not on the earlier assumptions in §2–§4. The full record is the slice 1
plan's "Decisions (taken while refining)" R1–R17. The ones later slices depend on:

- **Gate:** `src/core/shape/gate.mjs` and `ui/public/chat/shape-gate.mjs`, as D12. The `hello` frame
  carries `features: { shapeFirst }`. Nothing on screen reads the client gate yet (slice 2).
- **The approval stop is a scheduler hold** (`route()`), armed only for runs that carry `shape`
  (`createScheduler({ approvalStops })`). A saved copy of `wf_shape` without `shape` runs straight
  through.
- **The `plan` ask:** `{ id:'plan-<node>-<round>', kind:'plan', nodeId, executionId, plan:{ nodeId,
  port, file, round, revisable, check } }`. Answers `approve`, `revise` (feedback reaches the
  Planner as `plan-feedback-<round>.md` on its `revise` port), `stop` (the run ends `stopped`).
  `--yes`, Away mode and the night decider never answer it. A CLI process that meets it pauses the
  run. **The run page has no renderer for it yet**: slice 2 adds the plan card and a run-page view.
- **`POST /api/runs/:id/answer`** (gated) answers it.
- **Clarify cap** is engine-enforced (`config.maxQuestions`), with `config.promptHints`. The agent
  files are unchanged.
- **Workflows:** `wf_shape`, plus `wf_shape_ux` (never listed) picked by `resolveShapeRequest` when UX
  is a perspective. The CLI refuses to start either.
- **The `shape` run option** is `runShape` on the harness (`shape` is Auto's) and survives resume.
  Without perspectives it uses Product, Architect and QA.
- **Shared modules:** `src/shared/shape/{perspectives,shape,checklist}.mjs`,
  `src/core/shape/{check,grounding,run}.mjs`. Grounding is skipped on workspace runs.
- **Known follow-ups (minor, from slice 1's review):** a `revise` doesn't reset Refine's self-loop
  budget; a pause that lands while a `revise` answer is saved drops its feedback. Slice 2 fixes both.

## 11. Revision after the first real sliced feature (2026-10-15)

Issue #718 (run tags and cost allocation) was planned with **Shaper** on the test bundle
`test/shape-it-first-and-run-progress` (slices 1–4 plus run progress, #732). It was cut into 3 slices.
Slice 1 finished ($87, of which $62 was shaping), and slice 2 started on its own from slice 1's branch.
The engine worked. The way it is shown and started did not.

### 11.1 What the run showed

| # | Where | What we saw |
|---|---|---|
| F1 | Runs list | The feature is one row ("Run 1 of 3 · Build"), **collapsed**, opened only by a 12 px chevron. Expanded, each member is an underlined link repeating the full feature title. A waiting slice links to `#schedules/once`. |
| F2 | Runs list | The group is #732's generic "Run after" chain. It never reads `shape_features`, so it knows no slice names and no feature. |
| F3 | Runs list | When slice 2 started, the run renamed itself ("Implement Statistics Filtering, Grouping, and CSV Export", `generateTitle` in `run-harness.mjs` `_kickoffTitleGeneration`). It then showed **twice**: as its own row under Needs you and as "Run 2 of 3 · Plan" in the group, while it was waiting on a Clarify question. |
| F4 | Everywhere | One feature, four views, each different: the Runs list group, the run page ("Run 1 of 3" plus a second bar with no slice names), the Chat home Running card (only the workflow graph) and the Chat thread card. Only the last one lists the slices with **Re-plan the rest** and **Cancel the rest**, between the stats and the graph. |
| F5 | Wording | Five names: "Plan it with me" (tile), "Shape it first" (workflow, start button), "Run 2 of 3" (group), "· 2/3:" (slice titles), "slice 2 of 3 —" (slice brief). |
| F6 | Chat | The intent's lead shows in the person's message: "Shape this task first: propose a run with `shape`." |
| F7 | Chat | The proposal card is the whole New run form: about 40 branches, engine, guardrails, and model, fan-out and questions for each of 7 agents. |
| F8 | Gates | Every slice repeats Clarify, Plan and Refine, and stops again: slice 2 asked a Clarify question on start. A 3-slice feature means 6–9 stops for the person, spread over Chat, Needs you and run pages. |
| F9 | Run page | A finished slice says "Ready to ship" with no "slice 1 of 3", and nothing says slice 2 builds on its branch, so the merge order is invisible. |
| F10 | Run page | Perspective checklists list every item of every review cycle, expanded (23 items × 2 cycles, each with its evidence). |

### 11.2 Decisions

| # | Decision |
|---|---|
| D16 | **A feature page.** `#feature/<id>` is the one place a sliced feature is shown in full: the title, "1 of 3 slices done", the slices in order (short name, state, PR, "merge after slice 1"), the current slice's progress bar and text from `runProgress`, its open question or plan approval inline, and the actions (**Re-plan the rest**, **Cancel the rest**, **Approve each slice's plan**). It renders the existing `ui/public/shape/feature-view.mjs`. Every other place links to it: the Chat feature card shrinks to one summary line with **Open**, the run page of a slice gets a line "Part of *feature* · slice 2 of 3 →" above the progress bar (replacing the unnamed chain bar), and the Chat home Running card reads "Slice 2 of 3 · *slice title*". |
| D17 | **Runs list: a feature is one row.** The chain item uses the feature when the chain's first run has one (`featureOfPipeline`): the feature title, "Slice 2 of 3 · Build" (or "Needs you" in amber), open by default while a slice is live or waiting for a person. Members show "1 · Run tags" with the state glyph and PR, never the feature title again. A plain click anywhere on the row opens or closes it (no chevron to find; a modifier click opens the feature page in a new tab), and the first item inside is **Open feature**. A waiting member opens the feature page, not Schedules. A slice run is never also a row of its own; its "Needs you" lands on the feature row. The server's chain summary (#732, `ui/server.mjs`) gains `feature: { id, title, slices[] }`. |
| D18 | **Stable slice names.** A run that carries a slice (`shape.feature`) keeps its title: `_kickoffTitleGeneration` skips `generateTitle` for it. The slice's own title is the name shown under the feature; the long "*feature* · k/N: *slice*" form stays only where there is no feature context (Schedules, notifications). |
| D19 | **Plan once, confirm later.** Replaces D14's per-slice stops. Slices 2…N skip Clarify: the brief carries the feature's answers (slice 1's `clarify.json` answers). Planner and Refine still run against the code as it is. The plan stop holds only when the shape check fails, or when the Planner writes `outline-change.md` because the slice can't be built as outlined. **Approve each slice's plan** stays as a switch, now **off** by default; on, every slice stops as before. A `plan` ask still always waits for a person (§9.1). |
| D20 | **A small proposal card.** A shaped proposal shows the task brief, project, base branch, perspective chips and the estimate, with one primary button, **Start planning**, plus **Not now**. Engine, guardrails, workflow and the per-agent rows sit under a collapsed **Advanced**. The run-as-is card is unchanged. |
| D21 | **One vocabulary.** "Plan it with me" is the flow (tile, workflow display name, start button, docs headings). "Plan" is the plan card, "slices" the parts, "feature" the whole. "Shape it first" leaves the UI; internal ids (`wf_shape`, `shape`, `shapeFirst`) stay. The intent's lead is sent to the model but never shown in the bubble, which shows the chip and the person's text. Renamed to "Shaper" by D29. |
| D22 | **A finished slice knows its place.** Its run page says "Slice 1 of 3 · next: *slice 2* (planning)". Ship it says "Slice 2 builds on this branch: merge this PR first", and the PR body starts with "Part of *feature*: slice 1 of 3" and links to the other slices' PRs. |
| D23 | **Checklists read at a glance.** The run page shows the latest review cycle only, as one line ("23 met · 0 unmet · 0 n/a"); unmet items are expanded, met items collapsed with their evidence on demand. Earlier cycles sit behind **Earlier cycles**. |
| D24 | **Ship as stacked PRs or one PR, chosen at the end.** The slice branches are one line (each starts from the previous one), so both need no re-run. Each slice opens a **draft** PR when it finishes, for early review. When the last slice is done, the feature page asks **Ship as: stacked PRs / one PR**. Stacked: the drafts become ready in merge order. One PR: the last slice's branch into the base branch, its body one section per slice (summary, checklist, link to the slice's closed draft); the drafts are closed with a link to it. The default is one PR when the feature adds fewer than ~1,500 lines, stacked above. |
| D25 | **One changelog entry per feature.** When a feature ships, Worca writes one entry for it (from the slices' PR bodies) into the project's unreleased changelog, the way `worca-changelog` writes one per run. Versions and release tags stay project-level and are out of scope here (a separate "Prepare release" issue). |
| D26 | **The chip says "Experimental".** The tile's badge and every other place that marks the feature use the flag's stage name, "Experimental", the same word as Settings › Experimental. "New" is dropped. |
| D27 | **Mechanical shape-check failures fix themselves.** A failing check that needs no judgement (`grounded`: a path missing its `(new)` mark; `noPlaceholders` on an empty heading) is fixed deterministically on the plan file before the approval stop, and the card says what was fixed. Only checks that need judgement (`testable`, `decisions`) offer **Fix**, which still re-runs the Planner. On #718 the mechanical case cost one extra Plan and Refine (about $30). |
| D28 | **Measure it from day one (§7).** Each shaped run records, on the run: questions asked and skipped, revise count and why (person or check), shape score at approval, review cycles, checklist met/unmet/n.a., shaping cost vs building cost, and for a feature the slices proposed, merged and removed. `GET /api/runs/:id` returns it as `shapeStats`; Statistics gets a "Shaper" row group comparing shaped runs with unshaped runs of the same size. The nudge's estimate includes the shaping cost (Plan and Refine dominate: $62 of $87 on #718), calibrated from these records once 5 shaped runs exist. |
| D29 | **Shaper.** The flow is called "Shaper" (2026-10-16): the flag title, the Chat tile and intent chip, the start button, the workflow display name, the proposal kicker, the feature-page line, the Statistics card and the docs. Shorter than "Plan it with me", and it matches the code (`shape`, `wf_shape`, shaped runs). The New run link reads "Not sure what to build yet? Try Shaper in Chat →". Internal ids stay; the vocabulary scan refuses both old names. |
| D30 | **One decision card, at the top** (second review, 2026-10-16). When a shaped run or a feature waits on the person, the first thing under the header is one card: "Slice 1 of 2 · Store chart definitions · **Your turn: approve the plan**", a 2–3 line summary, one check line ("Shape 5/8 · 3 to fix ›", expands to the rows), and the buttons **Approve and build** (primary), **Ask for changes** (opens its text box on click), **Full plan** and **⋯** (Save to plans/, Open in New run). On the run page, Results and How it ran fold into one "Run details ›" while it waits; they open again when it works. |
| D31 | **Fewer buttons.** One primary per screen; one Stop (the top bar's; the card has none); rare actions in ⋯; inputs closed until used. The perspective chips show as a text line "Product · Architect · QA · UX — edit" and open on edit; the per-row Fix buttons become one "Fix all" when D27 leaves any; Pause hides while the run waits on the person. For a shaped run the top bar keeps Pause and Stop and moves the answer mode, Run after and the terminal into ⋯. Target: ≤ 6 controls in the run page's waiting state, ≤ 5 on the feature page (today 43 and 23). |
| D32 | **Every button says what happens; a failed check informs, it does not alarm.** "Run anyway" confused the person (run anyway *what*?), so no label says "anyway". The plan card's primary is "Approve and build" (an outline: "Approve the slices"), the same with unmet checks, plus one line naming what is unmet. The Chat nudge's "Run anyway" becomes "Run as is", the words of its choice card. No wall of red rows: rows are neutral with a small ✓ / ✕ mark, folded behind the check line. |
| D33 | **Where am I.** The feature page shows one line "Slice 1 of 2 › Plan › your approval" and one segmented bar (not a feature bar plus a stage bar). Status words name the wait: "approve the plan", "approve the slices", "answer 2 questions" — never "answer a question" for a plan approval. In the Runs list, a slice that needs the person has an amber dot; a working one pulses blue; a paused one is grey. |
| D34 | **Dark-mode colour.** Amber means "needs you" and nothing else; check rows neutral; selected chips filled, unselected outlined; a disabled button looks disabled. |
| D35 | **Mock runs keep their title.** Title generation never replaces a run's title with a mock engine marker ("[mock] … no MOCK_OUT given"); a mock run keeps the title it was started with. |

### 11.3 Code changes

- `ui/public/app.js`: the `#feature/<id>` route and view (D16); `runsChainItem` reads `feature` (D17); the slice line on the run page and the Chat home card (D16, D22).
- `ui/server.mjs`: `feature` on the runs-list chain summary (D17); the existing `GET /api/shape/features/:id` serves the page.
- `src/core/run-harness.mjs`: no title generation for slice runs (D18).
- `src/core/shape/features.mjs`: the slice brief carries the feature's Clarify answers; slice tickets start at Plan (D19). `approve_each` defaults to 0.
- `src/core/shape/check.mjs` and the Planner's slicing block: `outline-change.md` (D19).
- `ui/public/chat/ask-panel.mjs` / `ui/public/shape/proposal.mjs`: the small card and **Advanced** (D20); the hidden lead (D21).
- `ui/public/shape/checklist-view.mjs`: latest cycle, collapsed (D23).
- Ship it and the PR body writer: the slice line and merge order (D22).
- Wording sweep (D21): `intent.mjs`, the `wf_shape` display name, card buttons, `docs/shape-it-first.md`.

### 11.4 Parallel slices (later, not in this revision)

The outline already records `dependsOn`. A follow-up can start every slice whose `dependsOn` is
empty at once, each from the base branch with its own PR, and the feature page (D16) shows them side
by side. It needs a ticket that waits for more than one run (today `after` names one), and the
Planner told to prefer independent slices where the code allows. Most features, like #718, are
chains and stay sequential.

### 11.5 Tests

- Runs list: a 3-slice feature is one row, open while live, members named "1 · …"; a started slice is not a second row; its question marks the feature row "Needs you".
- A slice run keeps its title after start.
- Slice 2 under D19: no Clarify; no plan stop when the check passes and there is no `outline-change.md`; a stop when either is present; with **Approve each slice's plan** on, a stop always.
- The proposal card shows **Advanced** collapsed; the sent message shows no lead text.
- Feature page: states, PR links, merge order, actions; the Chat card and the run page link to it.
- Checklists: only the latest cycle is open; unmet items are expanded.
- Real-browser check of the Runs list group and the feature page.

### 11.6 Order of work

The fixes go onto the open branches, so each PR carries its own fix. `feat/run-progress` (#732) is merged into
`feat/shape-it-first-4-slices` (#730), because D17 builds on its chain view: **#732 merges before #730.**

| Branch (PR) | Decisions |
|---|---|
| `feat/shape-it-first-1-engine` (#708) | D27, D28 (recording, `shapeStats` and the Statistics group), D29 |
| `feat/shape-it-first-2-chat` (#728) | D20, D21, D26, the nudge estimate (D28), D29, D30–D32 and D34 (the plan card and the run page) |
| `feat/shape-it-first-3-checklists` (#729) | D23, D29 |
| `feat/shape-it-first-4-slices` (#730) | D16, D17, D18, D19, D22, D24, D25, D29, D30–D31 (the feature page), D33, D35 |

Each lower branch is merged forward after its fix (1 → 2 → 3 → 4), and the test bundle
`test/shape-it-first-and-run-progress` is rebuilt from slice 4 when all four are green.
