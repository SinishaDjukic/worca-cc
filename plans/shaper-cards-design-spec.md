# Shaper as chat cards — design spec (draft for review, 2026-10-18)

Builds on `plans/run-redesign-design-spec.md` (the runs redesign): its visual language (§1), run model (§2), status
line, progress, PR state and the Ship card (§3.5) apply here unchanged. This spec only says how Shaper's steps become
chat cards. Mock: canvas "Runs redesign + Shaper as cards", page 2.

## 0. Scope and principle

- **The engine stays.** Same workflows (`wf_shape`, `wf_shape_ux`), same asks (`questions`, `plan`, `plan` with
  `outline`, `gate`, recovery), same endpoints (`/api/answer`, `/api/runs/:id/answer`, `/api/shape/features/:id/*`),
  same feature tables. Nothing here changes what Shaper decides or runs.
- **Every Shaper step a person acts on is a card in the chat**, built on the existing card anatomy (`.ask-mcard-*`:
  head = title + kind chip, body, actions) and the existing question renderers (`.qpanel` kinds). The page shows the
  same card through the same renderer.
- **In the UI, a slice is a "run".** "Split into 3 runs", "Run 2 of 3". The engine and code keep "slice".
- **Engine order (found by run 1's plan, 2026-10-18):** today's engine asks Clarify → Split → Plan (the split comes
  before any plan; `orchestrator.mjs` `_outlineLoop`), so every plan approval starts a build and its button reads
  `Approve and build`; the planning run's own plan after the split is `Plan · run 1`. The mock's frame order (Plan
  before Split) is illustrative only.
- **Ordinary stays ordinary (decided 2026-10-18):** everything a person does outside Shaper keeps the existing
  approach: every chat message goes to Ask Worca as today (no composer interception, no keyword routing); new card
  behaviour reaches a chat only through Ask Worca's own tools or an explicit button on a card. Shaper's own logic
  (asks, gate, feature, slices, ship) is never broken; anything new for Shaper sits behind the `shapeFirst` flag.
- **Out:** perspectives logic, the planner and reviewer prompts, estimates, the gate flag (`shapeFirst`).

## 1. What is wrong today (from the code)

1. **Two layouts per step.** `plan-body` and `outline-body` each have a card layout (gate on) and a held layout
   (gate off) with different buttons ("Approve and build" vs "Run this plan").
2. **Check rows drawn three ways** (`plan-body` held, `check-row.mjs`, `paintChecks` copied in plan and outline);
   `fold()` copied.
3. **Feature view in three modes** (summary, full, page) with different actions in each.
4. **Receipts lie.** Plan and outline buttons call `deps.submit` directly, so the run card records "Answered", not
   "Plan approved".
5. **Later runs have no chat card.** Runs 2..N fire from tickets; only run 1's card carries the feature summary.
   Their questions show on the feature page, not in the chat where the feature started.
6. **Page-only steps.** Ship, Resume, Re-plan the rest, Cancel the rest and "ask before each run" live only on the
   Plans tab or the feature page.

## 2. The thread

A Shaper feature lives in **one chat thread**. Top to bottom:

1. The person's message.
2. **Proposal card** (exists: run proposal + `shapeCardExtras`): task, project, perspectives chips, "Split into runs:
   auto / off". Actions: `Not now` · `Start planning`.
3. **The feature card**, one card for the whole feature from start to ship (2.1). It grows; it is never replaced.
4. **Ship card** when every run is done (runs spec §3.5).

The person never needs the run panel, the run page or the feature page to answer; they are optional views of the
same cards.

### 2.1 The feature card

The existing chat run card (`run-card.mjs`) for the planning run, extended into the group card of the runs spec:

- **Head:** dot · title · kind chip (`Shaping` until the runs are approved, then `Feature · 2/3`).
- **Status line** (runs spec 3.3a): `Needs you · Plan` → `Running · Run 2 · Build`.
- **Progress:** while shaping, the planning run's 4-section bar. After the runs are approved: the continuous group bar
  (planning counted) and the current run's 4-section bar under it.
- **Step log:** each answered step as **one line** with a check and a `Show` link that unfolds what was answered:
  `Clarify · 2 answers`, `Plan approved · after 1 round of changes`, `Split into 3 runs`. This is the decision log.
- **The open step** expanded below the log, as a **step card** (2.2). One open step at a time; it belongs to the
  current run (planning run, or run k).
- **Runs** (after the split): member rows as on the group page — `n · title · state or PR state`. Clicking opens the run.
- **Actions:** `Open` · `Pause` · `Stop`; ⋯ = Re-plan the rest · Cancel the rest · Ask before each run (toggle) ·
  Open the plan. `Resume` replaces `Pause` when halted.

Later runs **report into this card**: their questions open as its step card, their progress drives its bars. No new
card per run in the thread. (Uses what the feature page does today: it mounts the live run's ask inline.)

### 2.2 Step cards (one per ask kind, one layout each)

Same chrome everywhere: head (title + kind chip), body, actions. Primary is the default answer; quiet is the way out.

| Step | Kind chip | Body | Actions | Engine |
|---|---|---|---|---|
| Clarify | `Clarify` | up to 3 questions, options + free text | `Use defaults` · `Answer` | `questions` → `/api/answer` |
| Plan | `Plan` | summary; perspective checks (met / unmet, one row component); issues with severity; `Full plan` link | `Ask for changes` · `Approve and build` (single) / `Approve the plan` (shaping); ⋯ Fix all · Save to plans/ · Open in New run · Stop | `plan` → `/api/runs/:id/answer` |
| Split | `Runs` | the runs as an editable list: n · title · goal · estimate; per row ⋯ Merge with next · Remove; Undo edits; toggle **Ask me before each run** | `Ask for changes` · `Approve 3 runs`; ⋯ Don't split (plan it as one) · Stop | `plan.outline` → `/api/runs/:id/answer` |
| Run k plan (only when approve-each is on, a check fails, or the plan changes the split) | `Plan · run 2` | as Plan, plus the split change note | as Plan | `plan` |
| Cycle limit | `Gate` | finding with severity | `Accept as is` · `Run another cycle` | `gate` → `/api/answer` |
| Recovery | `Recovery` | what failed, the error | `Pause` · `Abort` · `Retry` | recovery |

- **One layout per kind.** The held layout goes; when the gate flag is off the same card shows (with the gate flag's
  wording where it differs). Check rows: one component (`check-row.mjs`), one `fold()`.
- **Receipts:** every step card answers through the run card's answer path, so the log line names the decision
  (`Plan approved`, `Split into 3 runs`, `Another cycle approved`), never "Answered".
- **Tint** only on the open step card (amber wash, runs spec §1.3). Answered steps are plain one-line rows.

### 2.3 After the split

- **Run k starting / running:** status line `Running · Run 2 · Build`; member row shows its state.
- **Run k needs you:** the step card opens in the feature card, status `Needs you · Run 2 · Plan`; the Runs list row
  and the group page show the same card.
- **Halted** (a run failed or was stopped): status `Failed · Run 2 · Review`; actions `Resume` · `Re-plan the rest`;
  the waiting runs show as waiting.
- **Re-plan the rest:** the feature card logs `Re-planning runs 3–4`; the new split opens as its Split step card in the
  same feature card (today's `replaces` chain). The old feature's link keeps working.
- **All done:** status `Ready to ship · 3/3`; the Ship card follows (runs spec §3.5).

### 2.4 Ask for changes and the "Where does this go?" card (decided 2026-10-18)

Runs spec §3.6 defines the behaviour; this feature owns the two cards:

- **Ask for changes** — a one-line field in the actions of finished run cards, the Ship card and the PR card; sending it
  posts a proposal card "Changes to <run> · same branch, same PR" (or the row of the §3.6 table that applies) with
  `Not now` · `Start round 2`. Built on the run proposal card and Ask Worca's `propose_run` with `sourceBranch` +
  `sameAsSource`.
- **Where does this go?** — kind chip `Route`; body: the message quoted, Worca's guess with a one-line reason; three
  options as one choice: `Add to <feature>` · `Own run now` · `Save for later`; primary button names the choice
  ("Add to Runs redesign"). Saved items list on the feature card under the log ("1 idea saved for the next
  checkpoint"), and open as notes on the next run's Plan step card.
- The feature card shows `dev moved · run 3 starts from it` as a log line when the base moved.

## 3. Same card on the page

- **Run page** of any run in the feature: status card shows the same open step card (runs spec 3.4); Group row "Part
  of <feature> · run 2 of 3".
- **Group page** (today's feature page, URL kept): header, group status card with the open step card, Runs tab
  (members), Ship card when ready. Its ⋯ has the feature card's ⋯.
- **Plans tab:** a list of features as feature cards, collapsed.
- **Checklist / definition of done:** the run card's result line ("Checklist 12/14") unfolds to the existing checklist
  groups; the run page Overview keeps them.

## 4. Parallel runs (phase 2, own feature)

The split card gets a "runs after" column: each run either `after run k` or `can run alongside`. The Architect
proposes it; the person edits it on the Split card. Engine: `dependsOn` in the outline (empty or one run); independent
runs wait on the planning run and start together; a dependent run chains after its run. Status line with several
running: `Running · Runs 1, 3 · Build`; the group bar stays one bar; each running run shows its own bar. Ship: one PR
merges the branches (with a resolve step); stacked becomes one PR per branch, in order where runs depend. Fan-in (a run
waiting on two) later; until then Shaper chains such a run after the last of them.

## 5. Tests (extend the existing suites)

1. **One renderer:** for each ask kind, the step card rendered in the chat run card, the run page and the group page
   gives the same title, body text and buttons (extends `ui-shape-plan-body`, `ui-shape-outline-body`,
   `ui-question-shaping`, `ui-chat-run-card`).
2. **Receipts:** answering each step from each host logs the named decision (new cases in `ui-chat-run-card`).
3. **Shaper replay:** a recorded 3-run feature (mock planner `MOCK_SLICES`) replayed frame by frame through
   `event-golden-replay`: proposal → clarify → plan → split → run 1..3 → gate → ship; assert the feature card's status
   line, bars, log lines and open step on every frame. First Shaper fixture in that suite.
4. **Later runs in the chat:** run 2's question opens in the feature card of the original thread
   (`orchestrator-slices-chain` + `ui-chat-run-card`).
5. **Ship card:** the server accepts `ship` verbs on the new card type and refuses the rest (`api-shape-first`,
   `shape-ship`).
6. **Removed duplicates:** a scan test fails if a second check-row renderer or held layout comes back.
7. **Layout suite** (runs spec §5) covers the feature card at 375px.

## 5a. Known UI/UX bugs to not repeat

The list and the quality bar in the runs spec apply here in full; items 2, 4, 6, 7 and 9 are Shaper bugs.

Customer perspective (runs spec §5a) applies too. Shaper-specific:
- Features started before the upgrade, and their old chat threads, show the feature card when opened; their open asks
  are answerable from it.
- Reloading the page or opening the thread on another device shows the same open step and log (state comes from the
  engine, never from the browser).
- A step card that fails to answer keeps the person's input and says why.

## 6. Delivery

Three Worca features, each sliced by Shaper, stacked PRs into `dev`, each slice with its tests:

1. **Runs redesign** (runs spec): foundation first (tokens, corners, one button), then run model and progress, Runs
   list and selection, cards and pages, Ship card.
2. **Shaper as cards** (this spec), after 1 is merged: one renderer per step, the feature card, receipts, page reuse,
   replay fixture.
3. **Parallel runs** (§4), after 2.

## 7. Decisions (2026-10-18)

1. Kind chip while planning: `Shaping`; `Feature · n/N` once the runs are approved.
2. Ask me before each run starts: off by default.
3. `Show` on an answered step unfolds it in place in the card.
4. The planning run is listed as "Planning" with no number; runs are numbered from 1 (runs spec §6.4).
