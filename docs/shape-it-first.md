# Shaper

Plan a task with Worca before it builds, in Chat, and cut a large one into slices.
Nothing here changes a run that does not ask for it: a run without `shape` in its
request behaves exactly as before.

## What it is

Worca shapes a thin or large task first. It asks at most 3 questions, writes a plan
for the perspectives you pick, waits for your approval, and only then does the run
build. The decisions are settled before the first line of code, so the run has
nothing left to guess.

The plan is checked by rules, not by a model: the shape check reads the plan text
and tells you what is missing. The approved plan is what the build follows, and the
review later checks the code against the checklists the plan ended with.

## Three ways in

- **Shaper.** The default pin on the Chat home; it can be unpinned (see
  [Chat home](chat-home.md)). Describe the task; Worca proposes a shaped run on a card.
- **The nudge.** When Chat judges a task to have open decisions, the run card
  offers **Shaper** next to **Run as is**, with an estimate of each.
- **New run.** The New run page links to the same flow.

## Questions

A shaping run starts with Clarify. It asks at most 3 questions, each with lettered
options and a recommended pick.

- **Answer** sends your answers; Worca drafts the plan.
- **Use defaults** gives every question its recommended option, or the
  first when none is marked, and drafts the plan at once.

## The plan card

When the plan is drafted the run stops and the plan appears as a card, in Chat and
on the run page.

**Perspectives.** The chips choose who the plan is written for: Product (always on),
Architect, QA, UX, Security, DevOps and infrastructure, and Release. Change them and
choose **Update plan** to have the plan rewritten for the new set. **Devil's advocate**
is a reviewer only: picked, it argues the strongest case that the plan's core approach is
wrong and names the simpler alternative. It adds no plan section and no checklist, and it is
not picked by default.

**The shape check.** Eight deterministic checks run on the plan text:

| Check | Passes when |
| --- | --- |
| Every section its perspectives need is present | each chosen perspective's section has a heading |
| Success criteria must be testable | no criterion is only "works" or "is fast" with nothing measurable |
| Every decision states one choice | the decisions table has one option per row, not "maybe" or "consider" |
| Every repo path exists or is marked (new) | each backticked `src/…`, `ui/…`, `test/…` or `docs/…` path is real, or carries `(new)` |
| Testing covers the new code | the plan names tests for the code it adds |
| No placeholders left | no `TODO`, `TBD`, lorem ipsum or `<…>` marker remains |
| Every perspective ends with a checklist | each perspective has 1–8 checklist items; this check cannot be waived |
| Decisions are grounded in the repo | the plan cites at least 3 real paths |

A failing check shows what is wrong. **Fix all** (in ⋯) sends the failures back to the Planner as
a revision request.

**Decide.** **Approve and build** approves it and starts the build; while a waivable
check fails, approving records the waiver. **Ask for changes** opens a box, and
**Send changes** sends your note back for a new version. In ⋯, **Save to plans/**
writes the plan into the project's `plans/` folder, **Open in New run** (Advanced)
carries the plan to the New run page, and **Stop** ends the run.

**Versions.** Every revision is kept as its own version of the plan; the card shows
the newest and the earlier ones stay readable.

**Role reviews.** Before you see the plan, one independent reviewer per picked perspective
reads it, each as its own role only, and Refine Plan fixes what they found. This is the
engine's role-review step (any workflow can declare one, see
[Per-role models](models.md#per-role-models)): Shaper's Plan Review node declares the
perspectives as its roles, runs the ones you picked, and judges each on its own checklist
items.

**Counts per role.** The card's folded line reads `Reviewed by 5 roles · 1 open`; unfolded, each
role has one row with its counts, for example `Security · 2 fixed · 1 disputed · 1 open`, and
**Show** lists its findings. Refine Plan answers every finding: **fixed**, or **disputed** with a
one-line reason that Show prints under it. A finding it does not answer stays **open**.
The totals per role over finished runs are in the [review quality API](statistics.md#review-quality).

**Decisions.** When two roles ask for opposite changes to the same section, Refine Plan leaves
it to you: the card shows one decision card per pair ("Security and UX disagree on Rollout")
with the options to pick from. **Approve and build** asks you to answer each one first, and your
pick is written into the plan's Clarifications. An approval without you (auto-approve) never
waits on it.

**A model per reviewer.** Product reviews on a different model (Opus 5.5) from the other
reviewers (Sonnet 5.5) by default, so at least one reviewer judges the plan independently.
On an engine that does not run it (Codex, for example), Product runs on the node's model
like the others; the run records the default it could not use, with no warning, since nobody
picked it. In the Chat run card, Advanced › Agents lists one row per reviewer
(`Plan Review · Architect` and so on), each with a model and an effort; a pick on a reviewer
you did not tick is kept but never runs. A model you pick for the Plan Review node itself
does not change Product's own pick.

**Code role reviews.** Review Implementation reviews the diff the same way, as three
independent roles: `correctness`, `security` and `fit` (Project fit). It is the same engine step
on the `diff` target, declared in Shaper's workflow config. Their merged findings go to Build's
fix, and Build answers each one (fixed or disputed). While Review runs, the run status card
lists one row per role (reviewing, then its worst finding, then "Fixing 2 findings from
Correctness and Security" while Build fixes them). A role that was clean is skipped in the
next fix cycle, so a fix cycle reviews only the roles still open. When the review loop runs
out of cycles, its decision card lists the same role rows, and their **Show** lists the
findings. Cost: the first review cycle runs 3 reviewer agents where it ran 1, so it costs
about 3 times as much; each fix cycle runs 1 to 3.

## Checklists in review

Each perspective's checklist ends the plan as `R-…` items. The code review marks
every item **met**, **unmet** or **n/a**, with evidence for the call.

On the run page Overview, the **Perspective checklists** group shows one section per
review cycle: the newest open, older ones folded. On a finished shaped run the Chat
card carries the tally ("Checklist: 3 met · 1 unmet · 1 n/a"), and the pull request
description gets a section with the same items.

## Plan concerns

The implementer of a Shaper run can say that the approved plan would work but its design is wrong. It then writes a
plan concern (`{ "title", "detail", "section" }`, one file per implementer step in the run's folder, called
`plan-concern.json` in the audit) instead of building the part it disagrees with, and builds the rest. Bugs and
missing details stay deviations, as before.

- The plan approval is asked again, for the same plan round, with the concern above the Approve button.
- **Ask for changes** (with your own text) accepts the concern: the plan goes back to the planner with your text and
  the concern. The planner runs again and the plan approval comes back as the next round.
- **Approve** overrides the concern: the implementer runs once more, builds the held-back part as the plan says, and
  the run goes on. It cannot raise a second concern in that step.
- Under `--yes` no one is asked: the concern is overridden, and the audit log reads
  "Plan concern overridden automatically (--yes)".
- Away mode waits for you: a concern is a plan approval, and Away mode never decides one.
- A concern stops the run even when "Approve each slice's plan" is off.
- Only workflows with a plan approval stop offer a concern. Default's implementer is never offered one.

## Plan in slices

A large task is easier to review as a short chain of small changes than as one
large one. Plan in slices cuts the task into slices that each build, review and
ship on their own.

**When it is offered.** After Clarify, the Planner may offer an outline instead of a
plan, only for a task that changes 3 or more subsystems or whose request asks for
slices ("plan this in slices"). A task the Ask model judged large leans toward it.
Say "don't split it", or have the proposal carry `slices: 'off'`, and it is never
offered. Single-project runs only; see [Limits](#limits).

**The outline card.** The Planner's outline stops the run on a card that lists the
slices: each one's goal, scope, acceptance checks and size. A deterministic outline
check runs on it:

| Check | Passes when |
| --- | --- |
| Two to five slices (six to eight need a reason) | the count fits; six to eight come with a reason of at least one sentence; never more than eight |
| Every slice has 1–6 testable acceptance checks | no slice is without checks, over six, or vague |
| Slices are behaviours, not layers | no slice is only "the backend" or "the UI" |
| No two small slices side by side | neighbouring small slices are merged |
| Each slice depends only on earlier slices | every dependency is an earlier slice in the outline |

None of the checks blocks approval. On the card:

- **Approve N runs** approves the outline and plans the first run.
- **Merge with next** and **Remove**, in each run's ⋯, edit the outline on the card.
  They are applied when you approve; an edit that leaves one run reads **Plan it as
  one** and plans the whole task. **Undo edits** puts the outline back.
- **Don't split (plan it as one)**, in ⋯, plans the whole task as one run, as if
  slicing had not been offered.
- **Send changes** asks the Planner to rewrite the outline, and **Fix all** (in ⋯)
  does so for the failing checks. The outline is revised at most 3 times.
- **Stop**, in ⋯, ends the run.

**One run, branch and PR per slice.** Approving the outline creates the feature and
one scheduled run for each later slice. Each slice runs the same shaped workflow on
its own: plan, your approval, build, review. Slice k starts from slice k-1's branch
once that slice is done, so the branches stack and each pull request holds only its
own slice. The PR dialog proposes the previous slice's branch as the base until that
slice's PR is merged. Turn on "Automatically delete head branches" in the GitHub
repository so that GitHub retargets the next PR when one merges.

**Pull requests when a run finishes.** The `pr.slices` setting (Settings › Project › Pull requests, or
the team policy's default) says what a sliced feature does when its runs finish; it works together with
`pr.open` ("Don't create a PR", "Create a draft PR", "Create a PR ready for review"). The values are saved on the feature
when you approve the outline, and every slice reads them from there:

- **A PR per slice, stacked** (`each`): each slice that finishes with work committed opens its own PR on the
  previous slice's branch, as a draft or ready for review.
- **One PR for the whole feature** (`one`): a slice opens nothing. When the last run is done, Worca opens one PR from
  the last slice's branch into the feature's base, with the feature's changelog entry, like **Ship as one PR**. A
  follow-up run (it starts from the base, so the last branch does not hold every run's work) stops it: Worca tells you
  in the thread and you ship from the Ship card. With **Requirements** on, it waits until every agreed requirement is
  marked, tells you once, and opens the PR when the last one is marked.

A re-planned feature keeps the setting it had. A person's own Create PR and Ship as are unchanged. Each PR is opened as the
person who started the run, and a run that errored or stopped opens nothing (its log says why; a resume that ends done
decides again). The setting also applies to runs that are not sliced; see
[Pull requests when a run finishes](#pull-requests-when-a-run-finishes).

**Plan once.** Slices 2 and later skip Clarify: they use the answers you gave for
slice 1. Their planner still writes a plan for its own slice.

**Ask before each run** (on the outline card: **Ask me before each run**). Off by default: a later slice's plan stops for you
only when its shape check fails or the planner says the slice can't be built as
outlined (it then tells you why on the plan card). Turn it on to review every
slice's plan. Either way an audit line records what happened, and in Away mode a
plan always waits for a person. Only a person can change the switch; a proposal
from Ask cannot.

**The feature card.** The planning run's card in Chat becomes the card for the whole
feature, in the thread that started it. Its head reads `Shaping` until the outline is
approved, then `Feature · n/N`. Below the stats:

- a status line for the whole feature, such as `Needs you · Run 2 · Plan`,
  `Running · Run 2 · Build`, `Failed · Run 2 · Review` or `Ready to ship · 3/3`;
- the group bar, one part for planning and one per run, and the current run's bar;
- the step log: each answered step as a named decision (`Clarify · 2 answers`,
  `Split into 3 runs`, `Run 1 · Plan approved`), each with **Show**, which unfolds
  what was answered in place. Once its row is in the log, the step's answer receipt
  is not shown as well, so the card names each answered step once;
- the open step, whichever run asks it: run 2's plan approval is answered in this
  card too;
- a row per run (`Planning · Done`, then `n · title · state`, or its pull request's
  state once it has one); a row opens that run in Chat's panel.

A later run's **Answer** in Chat home opens the feature's thread. A slice is planned,
starting, shaping, waiting for your answers, waiting for approval, running, paused,
done, stopped, error, failed, missed or canceled.

**Feature controls.** The feature card carries the feature's controls, the same on
every host. Beside the ⋯ button:

- while a run of the feature is running: **Pause** and **Stop**, which act on that
  run (Pause reads **Pausing…** until the pause lands);
- once the feature halts (`Failed · Run 2 · Review`, `Paused · Run 2 · Build`):
  **Resume**, which resumes a paused run and restarts a stopped one as a new run, then
  re-chains the runs after it, and **Re-plan the rest**. The runs that wait read
  `Waiting · starts after run 2`;
- while re-planning, ready to ship, shipped or canceled: no buttons.

The ⋯ menu lists, in this order:

- **Re-plan the rest**, which cancels the runs that have not started and plans the
  remainder again from the last done run's branch. The re-plan's outline opens as
  the Split step card in the same feature card, and the log says
  `Re-planning runs 3–4`;
- **Cancel the rest**, which cancels the runs that have not started;
- **Ask before each run**, the switch above (checked when on);
- **Open the plan**, the approved plan, or the planning run's Artifacts.

Resume, Re-plan the rest and Cancel the rest act on an active feature. Re-plan the
rest also needs every run to be idle: stop a running one first. A refused action
shows the server's reason on the card.

**One card, three hosts.** The same card shows in the Chat thread, on the Plans tab
and on the feature's group page (`#feature/…`). The Plans tab shows its log and
actions with no step; its runs are on the group page. The group page has Runs,
Overview, Decisions and Logs tabs; the feature's log, actions and Ship block sit
under Overview, and the open step's card sits in the page's status card. Saved
notes show on the feature's chat card. The step card itself is the same on the run
page, in Chat and on the group page. A feature that was re-planned keeps its old
link: it shows the newer feature with "Re-planned: the runs below replace the
earlier outline". The Runs list shows a feature as one row ("Slice 2 of 3 · Build",
or "Needs you"), and a slice's run page says which feature it belongs to and, once
done, which slice comes next.

**Checklist score.** A shaped run's result reads `Checklist 12/14`: met out of the
items that apply (n/a left out, not reported counts against). Pressing it unfolds
the run's Perspective checklists in place.

**Ship card.** Slices no longer open draft pull requests: a finished slice opens no
PR of its own. When the last run is done, a **Ship card** appears once in the chat
that started the feature, and the same card shows on the group page and the Plans
tab. It reads `Ready to ship · 3 runs · 12 files · +840 −120` with the reason for its
suggestion, and has one **Create PR** button. The button opens the **Create PR**
dialog, the same one a single run uses; the group page's status line has the same
Create PR. The dialog's **Pull requests** zone offers **One** (one PR from the last
run's branch into the feature's base) or **N stacked** (one PR per run, each on the
run before it; merge them in order), with the suggested choice selected (one PR for
a feature under about 1,500 added lines) and its reason under the choice. Once a run
already has its own PR, One is disabled and N counts only the runs still without
one. Features started before this change keep their slice drafts: stacked marks them
ready for review, One closes them with a link to the one PR. Shipped as One, the one
PR counts as every run's PR, so the group page reads `In review · 1 PR`. In the chat, **Not now**
puts the card away; the feature still ships from its page. Until every run is done,
the group page says when the card will come. Either way, one entry for the feature
goes into the project's `CHANGELOG.md` under `## Unreleased`, committed on the last
slice's branch, so it ships with the feature.

A Run-after chain ships the same way, without Shaper: once every run in it is done,
its group page reads `Ready to ship · 2 of 2 done` with **Create PR** on the status
line, and the dialog offers One (the last run's branch into the chain's root, with a
title and description) or N stacked (the default). One needs each run to start from the
previous run's branch, in one project; otherwise only N stacked is offered. A run with no
branch of its own (a workspace or Folder run) ships from its own page. A finished chain
stays in the Runs list while one of its PRs is open; with a run still without a PR, for
14 days after its last run, when every run can have one. Archiving a run retires it.

**Release.** A single run's and a feature's **Create PR** dialog carry an optional
release row, under After it opens. **+ Add a release** suggests the next version: the last tag plus a
minor (`v1.11.0` → `v1.12.0`), else the version in `package.json`, else you type
one. Worca records the choice and, once the ship pull request merges (the one PR, or
the last slice's PR when stacked), creates a **draft** GitHub release for that tag
with generated notes. It never publishes the release. The check runs at start-up and
hourly, so the draft can take up to an hour to appear; a failure shows on the card
and is not retried.

**The Plans tab.** The Chat home lists shaped plans on a **Plans** tab, newest first,
with their state. A sliced feature's row opens its card underneath. The tab shows
only while Shaper is on.

### Slices and code reviews carry the requirements

Labs flag `shapeRequirements`. When a sliced run agreed its requirements first (the
`R-po-1`, `R-ux-1`, … criteria), the outline cuts the runs by them:

- **Satisfies.** Each run on the Split card lists the ids it delivers under its goal
  (`Satisfies: R-po-1, R-ux-1`). The same line opens the run's task and its PR body,
  under `Part of …`, and the one PR's body lists it under each run.
- **Left out.** An id the Planner moved out of this feature shows on a `Left out:` line
  with its reason. An id no run took fails the outline check's last row,
  **Every agreed requirement is in one run or left out with a reason**. Approving anyway
  is allowed: the id is then recorded as left out, "Not placed in a slice when the
  outline was approved".
- **The code review checks them.** The code review gains a **Requirements** role that
  checks only that run's ids against the diff. An id the diff does not deliver is a
  major finding (`R-ops-1 · not covered by the diff`), so the run goes back to the
  implementer before you are asked to ship it. Once a run is reviewed, its row on the
  feature card unfolds **Requirements 2/3 · 1 to fix**.

Rollback: turn the flag off. Later runs of a feature then fire as plain Shaper runs;
the Satisfies text in their task is only prose.

### Requirement concerns

Agreed requirements stay agreed. A plan reviewer that thinks one of them is itself wrong or cannot be met names it in
its finding (`"requirement": "R-po-1"`). That finding does not send the plan back to the planner: no extra refine round
runs for it. It rides the plan approval card as one note, **A reviewer says an agreed requirement is wrong or cannot be
met:**, with one line per id and the role that raised it.

- **Approve** keeps the requirement as agreed and builds the plan. The audit log reads
  "Requirement concern overridden: R-po-1 kept as agreed."
- **Ask for changes** sends your answer, with the concern, to the planner.
- The concern stops the run even when "Approve each slice's plan" is off. Under `--yes` and in Away mode the plan is
  approved and the requirement is kept.
- Only a review of the plan raises a concern. A code review's or a requirements review's finding that names an id
  blocks as before. Any workflow with a role review, a requirements input and a plan approval stop gets the same card.

### Mark the requirements before the PR

The Ship card lists every agreed requirement under **Requirements 3/4 · 1 to fix**, each with a **Met**, **Not met**
and **Dropped** picker. Not met asks where it moved, Dropped asks why; a row counts as marked once its text is saved
(Enter, or leaving the field). Nothing is marked for you: a row whose code review covered it says "covered by the
diff". The chat card and the feature page save the same marks.

While a row is unmarked, **Create PR** is not the main button and is disabled, and the card reads "Mark every
requirement before you create the PR · 1 left". Worca checks the marks again when the PR is created, so a stale card
is refused too. Once shipped, the card shows each requirement with its mark in words. A re-plan starts a new feature,
and its marks start empty.

### Changes after ship

On a shipped feature with agreed requirements, **Ask for changes** updates the requirements first. The Changes card
says so: "Requirements first: the 4 agreed requirements are updated before the plan." After Start, the run's first
card is the requirements hold, with the agreed requirements and how each was marked; the plan approval comes after it.
This holds for a round on the same PR and for a follow-up run after the PR merged.

Rollback for all three: turn the flag off. Findings then block as before, the Ship card has no ledger and ships
unmarked, and a Changes request runs as a plain round or follow-up. Saved marks stay stored, unread.

## Iterate in the chat (s5)

Iterating is one action: say it in the chat. Every finished run card, finished feature card, Ship card (ready or
shipped) and opened pull-request card carries an **Ask for changes** field. Sending it posts one proposal card,
**Changes**, into the same thread. Worca decides where the change goes (`src/shared/shape/landing.mjs`):

| The run or feature | Card title | Primary |
|---|---|---|
| A run is done, its PR not merged | `Changes to Run 2 · same branch, same PR` | `Start round 2` |
| A feature with runs still to go | `Changes to Charts · into Run 3's plan` | `Add to Run 3's plan` |
| A feature whose last run is still building | `Changes to Charts · as Run 4 after Run 3` | `Add Run 4` |
| A feature that is done, not merged | `Changes to Run 3 · same branch, before Ship` | `Start round 2` |
| Already merged | `Follow-up to Charts · Run 4 from dev, own PR` | `Start Run 4` |

A feature with a stopped or failed run has no landing: resume or re-plan it first. Workspace runs get no field.

**Rounds.** A round runs on the origin run's PR head branch with "Run on the source branch" (`sameAsSource`), so
its work lands on that branch. It adds no member row and no card of its own: the origin's card reads
`Running · Round 2 · Build` while it runs, and its log keeps `Round 1 · …` above `Round 2 · <request>`. The round
is marked on its own `pipelines.branch` record as `branch.roundOf = {pipelineId, round, request}`. `pipelineId`
always names round 1, so "the rounds of run X" is one lookup on the `idx_pipelines_round_of` index. The marker is
set in-process only, never from an HTTP body. A later group-membership record can absorb it as
`{member, of: roundOf.pipelineId, role: 'round', n: roundOf.round}`. A round's number is taken when it starts.
Rounds run the project's default workflow: a round never re-shapes a decided run. They carry the origin's tags.
While a round of a feature's run is live, Ship waits (`a round of run 3 is still going`).

**Rounds in the Runs list.** A round is never a row of its own. Watch PR fix runs, Resolve and Ask for changes all
stack under the run that opened the PR, or under its member row inside a feature group. The row's line is the newest
round's (`Round 8 · merge dev in · pushed 3e4f5a6 · Thu`), and the `7 rounds` toggle at the line's end opens the trail: the
newest 5, then `+2 earlier`. Each line opens that round's page. While a round runs, the row takes its state
(`Running · Round 9 · merge dev in`, chip `Fixing`), and it lists under Running, not Needs you. One open PR raises at
most one Needs-you item: a round never needs you through its PR (only through its own question, pause or unread
failure), and of two runs on the same open PR only the newest counts. The badge, Activity and the Needs-you section
count the same way. A round whose run is gone or filtered out heads its own stack (`… · Round 8`). The rounds of an
archived run leave the active list with it.

**Pushing a round.** Nothing is pushed by itself. A plain run's round updates its PR through the run's Push action
(`POST /api/push`); a feature's goes out with Ship.

**Notes.** "Add to the feature" stores a `plan` note for the next run not started yet, in `shape_feature_notes`. That
run's Planner reads it, and its Plan step always stops for you, even with Ask before each run off; the step card
lists it under **From the chat**. "Save for later" stores an `idea` note: it is shown (`1 idea saved for the next
checkpoint` on the feature card, and on the next Plan step card) but not fed to the Planner. A note made when no
run is left goes to the next run added to the feature.

**Chat and the Route card.** Every message in a chat goes to Chat, as in any other chat: worca never
reroutes it. In a chat that follows a run or a feature, with Shaper on, Chat sees the run's state and PR, or the
feature's runs, its next run and its open step, and it has two tools it calls when your message asks for a change:
- **propose_changes** posts the Changes card (where it lands follows the table above). It fits a finished plain run
  or a finished feature.
- **route_message** posts a **Where does this go?** card (chip `Route`) while the feature has runs to go: Add to the
  feature (into the next run's plan, or as an extra run), Own run now (from the base, its own PR), or Save for later.
  The preselected choice and its one-line reason are Chat's guess; you can pick another.

worca refuses a call that does not fit the chat (the wrong tool for the feature's state, a run that is still going,
an open step), and Chat answers in words instead. A Plan, Split, Clarify or Gate step is answered on its step
card only, never from a chat message.

**Base merge before the next run.** When `dev` (the feature's base) moved while a run was building, run 3 merges it
into its fresh branch before its first agent. A clean merge moves the run's diff base to the merge commit, so the
base's commits never count as the run's changes. The audit line `` Base `dev` moved: merged into `branch` (3 commits). ``
shows on the feature card as `dev moved · run 3 starts from it`. On conflicts nothing is merged and the card says
`dev moved · run 3 has conflicts with it in 2 files`.

**Watch PR fixes are rounds.** A Watch PR fix run is a round of the run whose PR it fixes. Its marker also carries
`by: 'watch'`, the trigger `kinds`, and once the watch lets go of it, its `outcome`. While it runs, the run's card
reads `Running · Round 2 · fix failing checks` (the trigger words: `fix failing checks`, `fix review comments`,
`address changes requested`, `resolve conflicts`, `merge dev in`). Its log line ends with the outcome:
`Round 2 · fix failing checks · pushed a1b2c3d`, or `· nothing pushed: conflict markers left`. With Shaper on, no
card is posted per fix run. When the watch gives up, the run card says so under its log
(`Watch stopped · 3 fix runs, checks still failing`) with **View PR** and **Ask for changes**. On the pull-request
card the watch is only the PR link's tooltip (`PR #781 · watched`). With Shaper off, each fix run still gets its own
`PR fix run` card.

## Requirements first (Labs)

Labs flag `shapeRequirements`. A medium or large Shaper task agrees its requirements before the plan is written. The
Shaper's Requirements step is a hold, like the plan approval, and it has its own card. Three cards change:

- **The Shaper card.** One facts line (`Large task · ≈ $31 · ~84 min`), then one sentence: `You lead as [Product ▾],
  supported by [QA and Security ▾].` Each picker opens a menu: the lead is one of Product, Engineering, Design, QA,
  Security and DevOps, and the supporters are switches (Product always reviews and is not listed). The first time, the
  lead reads `pick a role` and **Shape requirements** stays off until you pick one; your pick is remembered for next
  time. **Shape requirements** is the primary button and **Run as is** steps back. A small task keeps **Shaper** and
  **Run as is**, with the facts line and the perspective chips. A card proposed directly as Shaper gets the same
  sentence and **Shape requirements** when medium or large, and it has no **Run as is**; a small or unsized one keeps
  its fields and **Start planning**, with the facts line.
- **The Requirements card.** `3 decisions need you · as Product`, then the decisions the perspectives could not settle,
  then the agreed requirements folded away, then the foot. Each decision is one question with its answers stacked under
  it, Worca's pick already chosen and marked `recommended`; change any of them. An answer a perspective asked for says who
  wants it and why, for example `Security: emails are personal data, and exports get forwarded`; an answer nobody asked for
  stays one line. Questions, answers and reasons are worded for the lead you picked: a Product or Design lead never sees
  code terms such as `project:read`; a scope token with no plain wording reads `read access`. The fold reads
  `8 agreed · Product 2 · Engineering 1 · Design 1 · QA 1 · Security 2 · DevOps 1` and opens to the requirements grouped
  by perspective, your own first; a requirement's id is in its tooltip and read out by screen readers. A prefix Worca does
  not know goes under `Other`. **Agree and plan** is the only primary.
  **Ask for changes** opens a field that sends your words and your picks back; the foot steps aside while it is open, so
  **Send changes** is the only primary, and Cancel brings the foot back. When a requirement fails its check the fold reads
  `7 agreed · 1 to fix · …` and opens by itself with the failing row first and its problem beside it, **Ask for changes**
  becomes the primary, and **Agree and plan** is a plain, blocked button. If the requirements cannot be changed any more,
  there is no primary and the foot says `1 to fix`. Agree and plan is also off, with the reason beside it, when no
  requirement was written. If the requirements could not be loaded the card says so and **Try again** is the primary.
- **The plan card.** A **Requirements 7/8 · 1 to fix** fold sits above **Shape** and opens when a requirement has no
  step that delivers it; the row reads `R-ops-1 · <the requirement>` and `not covered by any step`. While any row fails,
  **Fix all** is the primary and **Approve and build** is a plain button; when everything is covered, **Approve and
  build** is the primary again. The Chat run card says `Requirements 7/8 · 1 to fix · Plan ✓ · Refine ✓ while planning`
  in place of `Clarify ✓` for such a run.

Rollback: turn the flag off. New runs ask the old questions and show the old cards. A run already held at its
requirements keeps asking, and its card stays answerable until it finishes.

## Pull requests when a run finishes

`pr.open` decides whether a finished run opens a PR: **Don't create a PR** (the default), **Create a draft PR** or **Open a PR
ready for review**. A run takes the first value it finds, in this order:

1. the run's own choice (the **Pull request when done** field in New run's Advanced section, or a Chat card or preset
   that sets it; only a value you changed is saved as the run's);
2. the project's setting, or the workspace's (Settings › Project › Pull requests; the Workspace page);
3. the team policy (`fields`, or `workspaceRuns` for a workspace run);
4. **Don't create a PR**.

The value is decided once, when the run starts, and saved with it: a later change to a setting never changes a run that
has started. The run's page shows it under **Pull request**, with where it came from and what happened. A run opens a PR
only when it ended done with its work committed and has no live PR yet. An error or a stop, uncommitted work, no commits
and a failed push are all written to the run's log. Runs of the Git automation, Watch PR fixes, rounds, conflict
resolutions, scans, memory runs, runs on the source branch and runs with no project never open one this way. A run
started from the CLI (`worca run`) does not either: there is no server to do it.

When this deployment sends PRs as the person who started the run (`WORCA_GH_AS_PERSON`), a starter with no connected
GitHub account opens nothing: the outcome says why and you get a notification. Worca's own credential is never used for it.

API: `pr: { open?, slices? }` in the `POST /api/run` body (a bad value is a 400 and starts nothing), `pr` in
`GET /api/run-defaults` (the setting with its source; `?workspaceId=` for a workspace), `GET /api/pipelines/:id/pr-auto`
(the run's saved value and outcome, read-only) and `GET`/`PATCH /api/workspaces/:id/settings` (`{ "pr.open": value | null }`).

## Limits

- Workspace runs are not sliced, and their checklists are not merged: a shaped
  workspace run gets a plain plan.
- A workspace run's `pr.open` applies to every member whose branch has commits; `pr.slices` does not apply.
- A manual **Ship as one PR** of a re-planned feature still starts from the last run's base; only the automatic one
  uses the feature's first base.
- Worca does not retarget a stacked PR when an earlier one merges. Use
  "Automatically delete head branches" on GitHub; automatic retargeting is a
  follow-up.
- A slice is a scheduled run. If its ticket fires while Shaper is off, the
  slice fails ("shape is not available on this server") and can be resumed once the
  switch is back on.
- Cancel the rest does not stop a slice that is already starting. Stop it from its
  own card.
- Slices run at the default effort, like any scheduled run; the effort of the run
  that was sliced is not carried to them.
