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
- In Away mode the concern is approved for you: the plan is built as written, and the answer is flagged *please check*.
- A concern stops a later slice's plan even when its checks pass.
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

**The Split step, with small runs on.** A run started with the `shaperSmallRuns` flag asks three times before it
builds: Start (Care), Requirements, and the Split; the Prototype may also ask, before the Split.
Before the Split is shown, the roles challenge the cut once per run:
the run's roles and, at Balanced and Thorough, the **Challenger** (the Devil's advocate perspective). Each round is
one spawn of the plan review step's agent. The objections go back to the Planner's own session, which refines the
outline once per round that raised any. Care sets the rounds and the run size:

| Care | Challenge rounds | Challenger | Requirements per run |
| --- | --- | --- | --- |
| Lean | 1 | no | 1 to 3 |
| Balanced | 1 | yes | 1 to 3 |
| Thorough | up to 3, stopping on a round with no objection | yes | 1 to 2 |

A workflow with no plan review step is not challenged, and the card says `Not challenged: no review step in this
workflow`. The card shows each run as one fold row: its title and requirement ids, then **Owns**, **Starts from** and
**Checked by** when unfolded. With the flag on, Starts from names the runs a run builds on (`waits for runs 4, 6`,
`waits for no run`). The checks fold and one challenge fold follow (`Challenged by 3 roles and the Challenger ·
1 change`), then the Care chosen at the start. There is no "Ask me before each run" switch: runs follow one after
another. Objections still open after the last round are one question, **Keep the split** or **Ask for changes**, and
approving over them is recorded as `Runs approved · 2 objections kept`.

Three rules cannot be waived: every requirement owned by one run only (ownership), owned or confirmed by a person
(coverage), and every confirmation naming an allowed role (confirmRole). When one fails, the card reads `Your turn: fix
the split`, the failing rows (one per rule and requirement) lead the open checks fold, and there is no Approve, on the
card or in the bar. A confirmRole row offers **Ask the role to confirm**, a menu of the roles that confirm at Ship.
Coverage and ownership clear only through **Ask for changes**. The server refuses such an approve too, from the card,
Away mode or the API: `422` with `errors[0].code` `split-not-approvable` and a message naming the rules and ids. A
refused split stays revisable for 5 rounds; after that the card says `Too many rounds: plan it as one or stop`. Away mode
waits while objections are open. Once the Split is approved, run 1 continues with no plan approval unless its plan
check fails, the chat added notes, or a reviewer raised a requirement concern.

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
  marked, tells you once, and opens the PR when the last one is marked. A small-runs feature does the same with the
  `shaperSmallRuns` flag on; with it off, it opens nothing this way and ships stacked from its Ship card.

A re-planned feature keeps the setting it had. A person's own Create PR and Ship as are unchanged. Each PR is opened as the
person who started the run, and a run that errored or stopped opens nothing (its log says why; a resume that ends done
decides again). The setting also applies to runs that are not sliced; see
[Pull requests when a run finishes](#pull-requests-when-a-run-finishes).

**Plan once.** Slices 2 and later skip Clarify: they use the answers you gave for
slice 1. Their planner still writes a plan for its own slice.

**Ask before each run** (on the outline card: **Ask me before each run**). Off by default: each run starts when the
one before it is done, as before. On: each later run waits, not started, and the feature card shows **Needs you**,
"Run 2 waits for you to start" and **Start now**. It starts when you press **Start now**, press **Resume**, or turn the
switch off. Either way a later slice's plan stops for you only when its shape check fails or the planner says the
slice can't be built as outlined (it then tells you why on the plan card); a plan whose checks pass continues by
itself. An audit line records what happened. Only a person can change the switch; a proposal from Ask cannot. Away
mode approves the outline with the switch as shown, and never presses **Start now**.

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
- while a run waits for you (**Ask me before each run** on): **Needs you** ·
  "Run 2 waits for you to start" · **Start now**;
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
page, in Chat and on the group page. With small runs on, a marked feature's page has
Runs, Requirements, Decisions, Cost and Log tabs instead (see "The feature page" below).
With small runs on, a run's stop (Plan approval,
a failed plan check, Split, Verifier gaps) draws the same card, with the same
actions, on the feature's card in Chat, on the group page, on the run page and in
the Chat run side panel. With small runs on, the stop's card lists its findings
under its question (the open issues, the failing checks, the Verifier's gaps or the
concern's detail) on every surface. Answering it on one surface repaints the others (to the
held line, or clears the question). A second answer is refused: the card reads
"Not sent: this stop is already answered". A feature that was re-planned keeps its old
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
slice's branch, so it ships with the feature. With the flag on, a small-runs feature ships the whole feature as one
PR, or stacked; with it off, only stacked: see [Small runs](#small-runs-shapersmallruns).

If every PR of a shipped feature is closed without merging, the ship is withdrawn: the
feature reads as not shipped again, and its Ship card and **Create PR** come back, so you
can ship it again.

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
with their state. A sliced feature's row opens its card underneath.

### Slices and code reviews carry the requirements

When a sliced run agreed its requirements first (the
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

### Requirement concerns

Agreed requirements stay agreed. A plan reviewer that thinks one of them is itself wrong or cannot be met names it in
its finding (`"requirement": "R-po-1"`). That finding does not send the plan back to the planner: no extra refine round
runs for it. It rides the plan approval card as one note, **A reviewer says an agreed requirement is wrong or cannot be
met:**, with one line per id and the role that raised it.

- **Approve** keeps the requirement as agreed and builds the plan. The audit log reads
  "Requirement concern overridden: R-po-1 kept as agreed."
- **Ask for changes** sends your answer, with the concern, to the planner.
- The concern stops a later slice's plan even when its checks pass. Away mode approves it, keeps the requirement
  and flags the answer *please check*, as long as the plan's check passed. Under `--yes` the plan approval waits for a person.
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
and its marks start empty. With small runs, only the requirements a person confirms are marked: see
[Small runs](#small-runs-shapersmallruns).

### Changes after ship

On a shipped feature with agreed requirements, **Ask for changes** updates the requirements first. The Changes card
says so: "Requirements first: the 4 agreed requirements are updated before the plan." After Start, the run's first
card is the requirements hold, with the agreed requirements and how each was marked; the plan approval comes after it.
This holds for a round on the same PR and for a follow-up run after the PR merged.

## Away mode on a Shaper run

When you're away, you're away: Away mode answers every question a Shaper run asks, the way you could, and flags each
answer that decides what to build *please check*. While Away is active on a Shaper run:

| Stop | What happens |
|---|---|
| Clarify | Away answers, as on any run |
| Requirements hold (first run, or a requirements-first Changes run) whose check passed | Away agrees to the requirements as written; each decision takes its recommended option. Flagged *please check* |
| Requirements hold whose check failed | Away asks for changes once, with the check's findings. If the check still fails, it waits for you: a failing Requirements check cannot be approved |
| Attached requirements to agree to | Away agrees to them as written, flagged *please check* |
| Agents' questions, review gates, failed steps | Away answers, as on any run |
| Slice outline whose check passed | Away approves it, with **Ask me before each run** as shown. If it leaves an agreed requirement out of every slice, Away flags it *please check* and names the requirement |
| Slice outline whose check failed | Away asks for changes once, with the check's findings. If the check still fails, it approves the outline, flagged |
| Plan approval whose checks passed, slice 1 included | Away approves it |
| Plan whose shape check or coverage failed, or could not be read | Away asks for changes once, with the checks' findings. If they still fail, it approves the plan, flagged |
| Later slice's plan | Continues by itself when its check passed; otherwise as above |
| The planner's outline change, or notes from the chat | Away approves the plan as written, flagged. The planner already had the notes |
| Requirement concern or plan concern | Away approves it, keeps the requirement or plan as written, and flags it *please check* |
| Verifier gap (Small runs) | Only for a question that opens while Away is active, and at once (no delay). Each plain gap gets **Add a fix run**; a gap the Verifier calls a judgement call, one whose fix adds a screen or scope, or one whose fix changes the requirement waits for you. Its fix runs are added once you answer the held gaps, together with yours. Away never ships with a gap or changes a requirement. One answer counts against the limits per question |
| A card showing an error | Away tries again, flagged |
| Later run held by **Ask me before each run** | Stays held; the card shows Needs you and Start now until you press it. You set that hold yourself |

Reviewer conflicts left open do not stop Away: it approves with no picks, as you may, and flags the answer.

Away's usual rules apply to every answer: which runs, away hours, delay and limits. Each Shaper stop is a rule, so it
costs nothing. Every answer is on record in the run's **Q&A** tab: the stop it answered, what Away did, why, and a row
per decision it took; the feature's log says `by Away mode`. A question that waits shows no countdown and does not count
against the limits. *Always wait for me on…* keeps Clarify for you; the other Shaper stops have no tick there, so to keep
them, set *Never on this run* or pause Away mode.

Only a Shaper run works this way. On any other run, Away answers a plan approval only when its checks passed, as before.

**Which runs.** Marking a run reaches its later slices, as long as you mark it before the outline is approved: a slice
already planned to start keeps what it was given, and waits for you. *Never on this run* stays on that one run, because
a later slice is a new run. If you want the whole feature to wait, set it on each run, or pause Away mode. Settings, away
hours and the "I'm away" switch are read fresh by every run.

**Set a spend cap.** With Away active, a feature can be built from start to finish with no plan seen by anyone. A spend
cap in **Settings › Runs › Away mode** is the way to bound what that costs. Approving a concern also runs the implementer
once more, which the limits cover but the answer's own cost does not show.

`--yes` is different and unchanged: it never approves a plan, so a plan approval pauses or waits for a person.

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
reroutes it. In a chat that follows a run or a feature, Chat sees the run's state and PR, or the
feature's runs, its next run and its open step, and it has two tools it calls when your message asks for a change:
- **propose_changes** posts the Changes card (where it lands follows the table above). It fits a finished plain run
  or a finished feature.
- **route_message** posts a **Where does this go?** card (chip `Route`) while the feature has runs to go: Add to the
  feature (into the next run's plan, or as an extra run), Own run now (from the base, its own PR), or Save for later.
  The preselected choice and its one-line reason are Chat's guess; you can pick another.

A run either card starts (a round, a follow-up, an added run, Own run now) uses the guardrail set of the run or feature
it changes, never the install's default; one that would land on Permissive starts on Normal and says so in its log.

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
`Round 2 · fix failing checks · pushed a1b2c3d`, or `· nothing pushed: conflict markers left`. No
card is posted per fix run. When the watch gives up, the run card says so under its log
(`Watch stopped · 3 fix runs, checks still failing`) with **View PR** and **Ask for changes**. On the pull-request
card the watch is only the PR link's tooltip (`PR #781 · watched`).

## Requirements first

A medium or large Shaper task agrees its requirements before the plan is written. The
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

  With small runs on (the `shaperSmallRuns` flag, decided when the run starts), the card differs. One fold per role
  replaces the single fold, in a fixed order: Product, Engineering, Design, DevOps, Security, Compliance, QA, then
  Release when it wrote requirements. Each fold head reads ✓ or `?`, the role (`(you ask as)` on your lead), what the
  role did (`wrote 4`, `added 2 · 1 fixed`, `nothing added`), and the chevron. A clean role is closed; a role with a
  question, an open objection or a requirement with no example is open. Every requirement has an example, shown as
  `e.g. …`; one without reads `no example yet`, **Agree requirements** is blocked with `1 requirement has no example
  yet: ask for changes`, and the server refuses the approval too. A disagreement between two roles is one question,
  and the requirements it is about read `in question: the decision above`. Care sets the review rounds: Lean one round
  by your lead's role and Product, Balanced one round by every picked role, Thorough up to 3 rounds, stopping early on a
  clean round. Compliance can be picked as a perspective and as your lead. A run started without a lead (the API or
  the CLI) leads as your saved lead, else Product.
- **The plan card.** A **Requirements 7/8 · 1 to fix** fold sits above **Shape** and opens when a requirement has no
  step that delivers it; the row reads `R-ops-1 · <the requirement>` and `not covered by any step`. While any row fails,
  **Fix all** is the primary and **Approve and build** is a plain button; when everything is covered, **Approve and
  build** is the primary again. The Chat run card says `Requirements 7/8 · 1 to fix · Plan ✓ · Refine ✓ while planning`
  in place of `Clarify ✓` for such a run.

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

## Small runs (`shaperSmallRuns`)

With the `shaperSmallRuns` flag on, a Shaper feature is built as small runs: each run owns at most a few requirements,
and the feature ships as one PR or as one PR per run, stacked ([Ship](#ship)). The flag is read when the planning run starts, and that run carries a
small-runs marker. The Split and its Care table are in [Plan in slices](#plan-in-slices), and the role folds of the
Requirements card in [Requirements first](#requirements-first).

### The card's steps

The feature has one card, and its step heads read as the card shows them:

1. **Start**: the Care position.
2. **Requirements**: the roles agree the requirements.
3. **Prototype**: asked when a requirement is about a screen and Design is on. Lean picks **Skip the
   prototype**, Balanced and Thorough **Build prototype**; the other choice is in ⋯. With no screen requirement, or with
   Design off, the step is skipped without asking. A skipped step says why (`Prototype skipped · Design is turned off`).
4. **Runs**: the Split step; its chip reads "Runs".
5. **Ship**.

Between Runs and Ship the card shows two states, not steps. **Build** goes run by run: the Planner, the role plan
review, a Test writer separate from the Implementer when Care asks for one, the Implementer and the reviewers. The
**Verifier** then checks the feature as a whole. While a gap it found is being built, the card reads "Working"; once a
check is clean, or you choose to ship with the gap, it reads "Ready to ship".

### When the runs it builds on clash

A run starts with the work of every run it builds on. When their work changes the same lines, the run does not start:
it is held, and the card's held row names the runs that clash and the files, as in `Run 4 is held: runs 2 and 3 clash
in src/a.mjs`. Nothing is merged and no branch moves. Settle the clash on one of those runs' branches (merge the other
run's branch into it and commit the fix), then press **Start now**: while the clash is unsettled, Start now refuses with
the same reason and starts nothing. **Re-plan the rest** and **Cancel the rest** stay in ⋯. The hold lives only while
Worca runs: after a restart, the next check finds the clash again and holds the run again. A run it builds on can
also get new work after that check: the run then finds the clash as it sets up, before its first agent, and is held the
same way, with Start now. That attempt is not kept as a failed run: it is archived and leaves History.

**Work taken in after a wait.** When a run that waited at a stop goes on, or a paused run is resumed, it first takes in
the work of every run of its feature that finished meanwhile, from any base, whatever base that run started from, in finish order, and
the log shows `feat/run-9 moved · run 2 starts from it`; its pull request is based on that branch. An answer waits
(`after run 3`) while such a run is still saving its work. On a clash the answer is not sent: the stop stays open and
says why, and nothing moves. Settle it on the waiting run's branch (merge the other run's branch into it in its checkout
and commit), then answer again. A resume whose take-in clashes does not start: the run stays paused, Resume is refused
with the clash reason, and the audit names the clash. An automatic resume (scheduled or network) is refused the same way
and is not retried until you Resume. Settle it the same way, on the paused run's branch, then Resume again.

### Care and its record

Start offers Lean, Balanced and Thorough, with Worca's pick and its reason. A position other than the pick is recorded as
your choice ("Worca recommended …"). Care is fixed after Start: pausing and resuming keep it. It is recorded as one line,
`Care: Balanced · Worca's pick`, shown on the Ship card, in each PR body and in the feature page's Decisions. Once the
feature is finished, the line adds the outcome (requirements met, gaps found at the end, changes after ship). Without a
finished outcome, no figures are shown.

### Owned and confirmed requirements

Each requirement is owned by exactly one run, or confirmed by a person in a named role: Product, Engineering, Design,
DevOps, Security, Compliance or QA. A run-owned requirement is checked by its run and the Verifier. A confirmed one gets
one of three marks: Met, Not met or Dropped. Not met and Dropped need a one-line reason of at most 300 characters. Only
Met counts as met. The mark is stored with the role the server records, never one the client sends. The role says
who should confirm; Worca does not check that the person marking holds it. It records who marked and when.

The approved split is what decides: a requirement it confirms is stored with its role, after the person's edits on the
Split card. **Re-plan the rest** (with the flag on) carries every agreed requirement no finished run owns into the new
feature's split, as its agreed list. One a person confirms keeps its role, unless the person changes it on the Split
card. Its mark is not carried: the role marks it again, and Ship waits for it. A requirement a finished run owns stays
with that run, also while a gap or change run of it is still waiting (Re-plan cancels that run). A re-plan that ends
with Don't slice carries nothing into a feature: it is planned and reviewed without the list, as before.

With the flag on, the words say that you confirm and name the role as a detail: a waiting row reads
"waiting for you to confirm · Design", a met one "confirmed by you · Design", and the Requirements caption counts
"1 you confirm". With the flag off the rows read as before ("confirmed by a person · Design").

### Ship

With the flag on, One ships the whole feature as one PR, from the latest finished run's branch. One is disabled while a
run has a pull request of its own, and the dialog and the server name it: "Run 2 already has pull request #40 open" (or
"Run 2's pull request #40 is already merged"); N stacked stays offered. When that branch lacks a finished run's work
(runs that finished out of order), One is refused with `HEAD_MISSING_WORK`: create one PR per run. The one PR opens with
the feature's Care line and its Not met / Dropped lines, once, then a section per run with its `Satisfies:` line,
carried runs included; a carried run's draft is closed. With the PR setting "One PR for the whole feature", the PR
auto-finisher opens that one PR once every run is done, and no run opens one of its own. With the flag off, One stays
refused with `STACKED_ONLY` ("small runs ship a PR per run"), as before.

Each gap you shipped from the Verifier's question is one line on the Ship card, with its reason: "R-po-2 ships with a
gap: covered by a later feature". The requirement's own row still reads "gap accepted".

The Verifier can also leave notes that are not verdicts, such as "the import test takes 40 s". The Ship card lists each
note of the check that rules Ship (a clean check, or one whose gaps you shipped) with its own **Acknowledge** button, and
Ship stays disabled until every note is acknowledged: "Acknowledge the Verifier's note to ship" (`FINDINGS_UNACKNOWLEDGED`).
An acknowledged note reads "acknowledged · 14:02". Only a person acknowledges a note. Away mode never acknowledges, and
neither do `--yes` or the PR auto-finisher: with "One PR for the whole feature" the one PR waits for you and opens once
you acknowledge. Until then the feature reads the note's reason under Needs you on the Runs list, and the Runs badge
counts it. A new check needs its own acknowledgement, even for the same note text. A clean result with no notes adds
nothing, and Ship opens as before.

Stacked, with the flag on, opens one PR per run along
the real branches: from the head back along each run's recorded base; each PR is based on the branch of the one before
it, the first on the feature's base (or on the feature's base when the PR before it is merged or its branch still merges
back). A run whose work a listed PR already carries (taken in or combined) gets no pull request of its own. A run's work
also counts as carried when a listed or carried run started from its branch, so after take-ins from other bases each
commit ships in one pull request. Before you ship, the Ship card and the Ship dialog name each carried run, as in
"Run 2's work ships in run 3's pull request (#40 is open)". While Stacked is picked the dialog adds "The open pull
request is not counted."; with One picked it shows neither. Each pull request is named once: when that carried line
already names the PR that turns One off, One's reason reads "Run 2 already has a pull request open", without the number. The button's count is the number of new PRs Ship creates: the listed runs
without a PR or with a closed one ("Create 4 PRs"). When Worca
cannot follow every finished run's work into the list, it falls back to the order the runs finished, and the Shipped
card says so: "stacked in the order runs finished".

With the flag off (and in that fallback) it opens one PR per run, run 1 (the planning run) included, in the order the
runs finished. Each PR is based on the branch of the run that finished before it, or on the feature's base when it is
first or that run's PR is merged. With `pr.slices` `each` and `pr.open` on, a run still opens
its own PR when it finishes, before these blocks. Ship is blocked:

- with `ACCEPTANCE_INCOMPLETE` while a confirmed requirement is unmarked; with the flag on the Ship card reads
  "Waiting for you to confirm R-comp-4" (with the flag off it names the role, as before). With the flag on, once every
  run is done, the feature reads "Needs your confirmation: R-ux-2" in the needs-you tone (up to three ids, then
  "and 2 more") on its page head, its Runs list row and its Chat card, never "Ready to ship". The Runs list lists it
  under Needs you, and the Runs badge counts it. On the page head the reason is a link to
  `#feature/ID/requirements/ship`: it opens Requirements, scrolls the Ship card to the top and focuses it, and the
  address then ends in `/requirements`. The disabled **Create N PRs** says the same in a tip drawn above it, never over
  the status line;
- with `ACCEPTANCE_INCOMPLETE` while an agreed requirement is owned by no run and confirmed by no person (with the flag
  on). The reason names it ("R-ops-1 is owned by no run and confirmed by no person"), no mark opens Ship, and the feature
  reads "Waiting" instead of "Ready to ship" everywhere. Re-plan the rest is the way out;
- with `NOT_READY` until the rule below holds. It is checked again when you press Ship, before anything is pushed.

With the flag on, one rule decides: a small-runs feature is ready to ship only when a Verifier check with a clean result is
on record for the exact head it would ship, and nothing of the feature is live, finishing, interrupted or pending. The
exact head is the commit of the latest finished run's branch, and it must be the commit the Verifier read. Choosing to ship
with the gap counts as clean. What follows from it:

- With no check on record, Ship is not ready. If the last run finished while the flag was off, or Worca was stopped
  during its cleanup, the card reads "Stopped" ten minutes after the run's last write, and its **Resume** starts the check.
- A round that ended (done, stopped or failed) is over: the check still starts when the last run or round settles. A
  round that is interrupted or has not ended holds both the check and Ship, until you resume or archive it.
- A commit after the check, by a run or a round, needs a new check on the new head: a new series, round 1. It starts when
  that run or round settles, or, for a commit made while a check was verifying, when that check is done. The other runs'
  branches ship too, so a commit on one of them also needs a new check. The Verifier reads the head's branch, so it does
  not see a round on an earlier run's branch until that work is in the head. For a commit made outside Worca the card
  reads "Stopped" and **Resume** starts the check.
- The changelog commit Ship itself makes keeps the check, so a Ship that failed part-way can go on.
- While the feature is shipping, nothing of it starts: a round, an appended run, a requirement change, a re-plan,
  **Resume** and a run's own **Create PR** are refused with `SHIPPING`. A run's own **Create PR** that is still opening
  when **One** ships refuses that ship with `HAS_SLICE_PR` instead. The rule is asked again before each pull request Ship opens and after the
  changelog commit, and once more when the feature would be recorded as shipped. If it no longer holds, Ship stops with
  `NOT_READY`, names the pull requests made so far and pushes nothing more. Ship again once the Verifier has checked the
  work, or **Resume** on the feature page, if it reads "Stopped".

Each PR body has exactly one `Care: …` line, then one line per requirement marked Not met or Dropped
(`Not met: R-comp-4 · the reason`).

### Runs stop, change and the Verifier

A run stops for one of three reasons: a check failed, a role objects, or a requirement would have to change. Finished
work is never rewritten: when a changed requirement's owner has finished, the change arrives as a new small run. When
the Verifier finds a gap, it asks you before any run is added, from round 1 on, on every round with an open gap. Each gap
gets one of three answers, and **Send answers** stays off until every gap has one:

- **Add a fix run**: one more run closes the gap, then the Verifier checks again.
- **Ship with the gap**: a reason is required ("R-po-2: a reason is required to ship with the gap" without one). The gap
  is not asked again in the same series, and the Ship card lists it with its reason.
- **Change the requirement**: you write the new text (1 to 300 characters). It goes through the same change path as a
  change from chat: the text changes, a change run builds it, and the next Verifier round checks the new text. The run
  that owns it must still be finished.

Each fix run and change run added this way builds on the last run before it, so it starts with all the work so far.
When every gap is shipped, the check reads "Ready to ship". When the requirement changed since the question, or its run
is no longer finished, nothing is added and the check reads Stopped: Resume runs the Verifier again and asks again.
Anything else the Verifier noticed goes in its result file's optional `findings` list, one line each (at most 8); see Ship.

The Verifier also names each gap's kind: plain (one more run closes it), a judgement call, a fix that adds a screen or
scope, or a fix that changes the requirement. With Away mode active when the question opens, Away answers each plain gap
with a fix run and the question asks you only for the rest. Each held gap says why under its title: "Held for you: the
Verifier calls this a judgement call", "Held for you: the fix adds a screen or scope" or "Held for you: the fix changes a
requirement". The gaps Away answered are listed above the questions, for example "R-po-1 → fix · decided by Away mode".
Once every gap is answered, the feature's log adds one line per gap after the Verifier's line, saying who answered it:
"Gap R-po-1 → fix, run 6 added · decided by Away mode", "Gap R-po-2 → ships with the gap · decided by you". A check
recorded before this shows its Verifier line only.

From Telegram or Discord, the gate message lists each gap. `/retry` answers every gap it lists with a fix run. `/approve`
is refused: shipping with a gap needs a reason, so that and changing a requirement are answered on the feature card.

### The four places

- **The Runs list group row**: one group per feature, the planning run as run 1, the state word, the runs done of N and
  the cost, once. The Verifier's rounds are check rows after the runs (`Verifier · round 2 · 1 gap`), never standalone
  rows and never counted in the runs done of N; their cost was already counted. A newest round that checks, is paused,
  waits for you, failed or stopped is said on the group row (`Verifier round 2 failed · 1 gap`), so the feature is not
  ready yet: while a listed round checks, waits or failed, the group row says it instead of `Ready to ship`, which is
  said once, on the group row. A Verifier run started now
  is titled `Verifier · Sign-up · round 2` wherever it shows alone.
- **The run panel and the Expert run page**: what the run owns, what it starts from, and one Agents place. With the flag
  off, the Agents tab and Overview stay as today. The facts add **Waits for** (left out when the run waits for nothing)
  and **Needed by** (`nothing` when no run builds on it). These facts show on a started run's page only: a run that has
  not started has no run page, and its row opens the feature page, where the row's word names the runs it still waits
  for and pointing at the row puts a dashed bar on the runs that build on it. A stopped run's page names the stop and
  links where it is answered (the feature's card in Chat, or the feature page for a feature no chat started); it has no
  answer controls. With the flag on, a feature no chat started gets no chat card: its waiting line reads "Ship card
  comes when all 5 runs are done, on this page.", Chat home's Answer on one of its runs opens its feature page, and the
  run panel's Prototype stop links "Answer it on the feature page".
- **The feature page**: Runs, Requirements (each with its owner run or confirming role, and its status) and Decisions
  with the Care line, and Show order on its Runs tab. Its run rows are one line with the same short words as the card and the Runs list ("waiting for
  you", "waits for run 8", "done"). Its head button reads "Create N PRs" and follows the Ship card: until the
  feature is ready to ship (the Verifier still checks, or waits for your answer) and while the ledger blocks it, it is
  off and the status line says why. An open stop shows its own head and primary, and the page offers no Re-plan beside
  it; the Verifier's stop is asked here too.
  Its tabs read Runs, Requirements, Decisions, Cost, Log, at every UI level. The Ship card sits at the top of
  Requirements, above the requirement folds, with the feature's actions under them; the old `#feature/…/overview`
  address opens Requirements. While a mark is open (the feature is ready to ship and a confirmed requirement still waits
  for its mark or a reason), the page bar shows **Mark and ship**: it opens Requirements, scrolls to the Ship card and
  focuses it. Log holds the per-run "Open logs" rows (Expert only) and then the step log, the lines the card's log
  shows ("No steps yet." before the first). The Cost tab lists each run with its cost: Planning, each numbered run,
  each Verifier round, and one "Earlier tries and fix runs" row when those cost anything, then the Total, the same
  number as the group row. Verifier rounds count once each in the feature's cost, re-planned rounds included. A round
  that reads "· failed" or "· stopped" is one whose Verifier run failed or was stopped and was run again under the
  same round number.

### The run words

With the flag on, each run of a marked feature reads one word and one mark, the same on every surface:

| Word | Mark | When |
|---|---|---|
| `done` | green dot | The run finished. |
| `planning`, `reviewing plan`, `writing tests`, `building`, `reviewing` | peach, pulsing | The run is going: the step it is on. |
| `waiting for you` | amber "?" | The run is at a stop or asks you something. |
| `after run 3` | dashed ring | You answered its stop; the answer waits for its turn. |
| `failed` | red "!" | The run failed. |
| `waits for run 2, 6` | grey ring | It has not started; it builds on runs that are not done. |
| `next` (`next · small change run` for a change run) | ink ring | It has not started and goes on next. |
| no word | grey ring | It has not started, builds on nothing unfinished, and it is not its turn. |

A waiting run names only the unfinished runs nothing else in its list leads to: run 7 builds on runs 2 to 6, but 6
builds on 3, 4 and 5, so it reads `waits for run 2, 6`. A named run at a stop says so inside the word
(`waits for run 2 (needs you), 6`), and a named run that failed adds `(failed)` (`waits for run 5 (failed)`).
`next` comes only from the server's turn: an answer or a resume held for its turn first, lowest run number first (the order held answers are delivered in),
then a change run, then the lowest free run.
A free run without the turn shows no word.

The Chat card's run rows, the feature page's Runs tab, the Runs list's member rows and the run page head draw these
marks (`markDot` in `ui/public/status-dot.mjs`).
The `waiting for you` word reads in amber ink and `failed` in red ink; every other word keeps the row's grey.
A done run's page keeps its ship line (Ready to ship, Merged) instead of `done`.

Point at a run row on the Chat card or the feature page's Runs tab (hover, or keyboard focus) to see its links: a solid
bar left of each run it builds on, done runs included, and a dashed bar left of each run that builds on it. A click on
the row, or Enter or Space, keeps the marks after you move away; Esc lets go, wherever the focus is. The title still
opens the run. Nothing dims and no row moves.

### Open stops on the card

With the flag on, the Chat card of an active marked feature lists every open stop and every failed run, one line each,
in run order. A line reads `Run 2 · plan approval · holds up 7, 8, 12, 15, 16` for a stop, or
`Run 5 failed · holds up 6, 7, 12, 16` for a failed run, with the run's own mark (amber "?" or red "!"). A line that
holds up nothing has no `holds up` part (`Run 9 · gate`).

"holds up" names the runs that are not done or canceled and build on that run, directly or through others: they cannot
finish while it is open.

The feature page shows the same list, first on its Runs tab; its other tabs show none.

Every stop line is closed when it first shows, so the list shows no step card. You answer a stop by opening its line:
that mounts one step card, the same one the run page shows, for that run only. Opening another line closes the first,
and closing the open line removes its card. A paused run is not a stop, so it gets no line. A failed line has its own
Resume, which restarts that run only; the card's footer and ⋯ then show no second Resume. An answer held for its turn
(`after run 3`) is not a line. Pause on that run drops the held answer, as before, and after Resume you answer the stop
again. The bar's Answer is not shown while lines are listed: you open a line to answer it. With the flag off the card
shows one open step, as before.

The state line on the card and the feature page names the working run, or each working run once in run order, and the
run with the next turn: `Run 6 reviewing · next: run 9`. It shows only the half that applies (`next: run 9`). When
neither does, it says who must act: `Nothing can go on until you act` while a stop, a failed, paused or stopped run, or a
run that cannot start waits on you. The card keeps its `2 of 16 runs done` after the line. The head shows `4 need you`
once (the stop lines, failed runs included), and nothing at zero. A second answer to a listed stop, from another open
view, is refused as before.

### Held resumes

With the flag on, a Resume of a paused run of a marked feature while another run of the feature is going is held: the
run stays paused and goes on at its turn, together with held answers. This holds for the run's own Resume and the
feature card's Resume. A held resume holds nothing, so it never keeps another run from its
turn, but it goes before the free runs. Pause or Stop on the held run drops the hold, and so does a restart: the run
is then simply paused. Stopping a run that a restart is about to resume frees its turn at once, and the next held run
goes on. Of several runs of one feature resumed at a restart, only the lowest goes on; the others are
held behind it. A held resume reads `after run N` on its row and on its run page head, and its Resume then reads plain
`Resume`. Before it is pressed, a paused run's Resume reads `Resume after run N` while another run of the feature is
going, and `Resume` otherwise; the server still decides at the press. The same wording shows on the Resume in the
feature page's footer and in the Chat feature card's footer, taken from the run that Resume acts on. A restart of a stopped or failed run is still
refused while another run of the feature is going. While a finished run of the feature is still saving its work, a
resume waits (`after run N`), as an answer does, and goes on once that work is saved, so the resumed run starts with
it. A held resume refused at its turn (for example on cost) leaves the run paused, and a run paused on the network is
then taken up again by the network watch once its endpoint answers inside the wait window.

### Show order

With the flag on, the feature page's Runs tab of a marked feature offers a `Show order` button above the run rows when
the feature has 5 runs or more and their links branch or join: some run builds on two or more runs, or two or more runs
build on one. A plain chain, separate chains or runs without links get no button: each row's own `waits for run N`
already says it. The button is closed each time the page opens, on another feature and when you come back from another
view; switching the page's tabs keeps it as you left it.

`Show order` opens a still drawing of the order, and `Hide order` closes it. Each run is a dot with the row's own marks,
placed right of every run it builds on. While a run is held back, only the links that hold it are drawn: a line joins a
run that is not done to the runs it holds back. Once none holds a run back, every link is drawn faint. Links another link
already implies are never drawn. A link to the next column is one curve. A link that skips columns curves into the lane
midway under its upper row, runs along it and curves out to its run; no link passes within 7px of a dot it does not
join. Pointing at a run's row (hover or focus) or keeping it (click, Enter or Space) lights that run's dot and the links
drawn to and from it, and the other links dim; Esc lets go. A paused or stopped run shows the row's
dot, not the hollow ring of a run not started. A run the Verifier adds (a fix run or a change run) builds on the last run
before it and stands right of it; a change run from the chat card or a run's stop builds on nothing yet, and still stands
right of the last run before it, never in the first column. Nothing moves
but the existing pulse of a working run. The drawing is hidden from screen readers: the rows say the same in words.
The drawing is never on the Chat card or the Runs sidebar.

### Off

Some parts follow the marker and stay with the feature; the rest follow the flag as it is now.

**The flag, read live.** While it is on, these apply to every sliced feature, also for a feature with no marker: a run
waits only for the runs it builds on, so an independent run starts while an earlier one is stopped, failed, waiting
or paused (one run of a feature at a time), an answer or a resume held for its turn waits until no other run is going and held answers go on one at a time, lowest run first, and among
the free runs a change run starts first, then the lowest run number; a run starts from the feature's latest finished run and, on a marked feature, merges in every run it builds on that this branch lacks; a resumed run first merges the
latest finished work (on a marked feature, every finished run it lacks, whatever its base, and it records the branch it now
builds on as its base, and on a clash it stays paused); a run that waited at a stop takes in every finished run it lacks, whatever its base, before its answer goes on; a finished feature's figures are recorded on this machine; and one PR ships the latest finished
run's branch, or is refused with `HEAD_MISSING_WORK` when that branch does not hold every run's work.

**A feature with the marker, flag off.** It keeps its one card, its Care and the Care row on its Ship card, its run
stops, the stacked-only Ship and the marks that block it. It loses what the flag drives:

- no Verifier check starts, neither when a run finishes nor from **Resume** (a stopped or failed check offers none), and
  no check's result is recorded. A feature with no check is ready once its runs are done, so its Ship opens with no
  Verifier check, and a commit after a clean check is not checked. A check already open, or with a gap, keeps Ship at `NOT_READY`. If the check, or the last run for its
  gap, finished while the flag was off, turning the flag on again starts nothing by itself: ten minutes after that run's
  last write the card reads "Stopped", never while Worca is still committing or cleaning up after a run, and its
  **Resume** starts a fresh check. A check that had stopped or failed offers **Resume** at once;
- no figures are recorded, so there is no new Care outcome;
- a requirement owned by no run and confirmed by no person does not block Ship, and a re-plan pressed with the flag off
  carries no requirements;
- the Runs list group row, what a run owns and starts from, a stopped run's head and link, and the feature page's
  Requirements tab, Care line, one-line rows and head button go back to the classic ones.

**Every feature, flag off.** A run started with the flag off gets no marker, except one that re-plans a marked feature.
Existing features continue by the linear chain (each run after the one before it), no figures are recorded, figures
already recorded are kept and stay readable, and nothing is migrated. One PR ships the last run's branch of an unmarked
feature: one whose runs went out of order while the flag was on is not checked, so ship it as one PR per run.

The Requirements page is not changed, on or off.

## Limits

- Workspace runs are not sliced, and their checklists are not merged: a shaped
  workspace run gets a plain plan.
- A workspace run's `pr.open` applies to every member whose branch has commits; `pr.slices` does not apply.
- A manual **Ship as one PR** of a re-planned feature still starts from the last run's base; only the automatic one
  uses the feature's first base.
- Worca does not retarget a stacked PR when an earlier one merges. Use
  "Automatically delete head branches" on GitHub; automatic retargeting is a
  follow-up.
- Cancel the rest does not stop a slice that is already starting. Stop it from its
  own card.
- Slices run at the default effort, like any scheduled run; the effort of the run
  that was sliced is not carried to them.
