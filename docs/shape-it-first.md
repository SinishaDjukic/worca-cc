# Shaper

Plan a task with Worca before it builds, in Chat, and cut a large one into slices.
Nothing here changes a run that does not ask for it: a run without `shape` in its
request behaves exactly as before.

> **Experimental.** Shaper is behind a switch until the feature flag ships.
> See [Turning it on](#turning-it-on).

## What it is

Worca shapes a thin or large task first. It asks at most 3 questions, writes a plan
for the perspectives you pick, waits for your approval, and only then does the run
build. The decisions are settled before the first line of code, so the run has
nothing left to guess.

The plan is checked by rules, not by a model: the shape check reads the plan text
and tells you what is missing. The approved plan is what the build follows, and the
review later checks the code against the checklists the plan ended with.

## Turning it on

Shaper is an experimental feature, off by default. Turn on **Shaper** in
Settings › Experimental (the `shapeFirst` feature flag, see [Feature flags](feature-flags.md)),
or start Worca with `WORCA_FLAGS=shapeFirst`. It takes effect at once, without a restart.
While it is off, everything below is hidden or refused: the **Plan it
with me** tile, the nudge on a run card, the **Plans** tab, the `shape` field on
`POST /api/run` (it answers "shape is not available on this server") and every
`/api/shape/…` route (404).

A run that is already held at a plan or outline question is never stranded by the
switch. The plan card and the outline card are the same cards with the same buttons
(**Approve and build**, **Ask for changes**, **Full plan**, and on the outline
**Approve N runs**; **Fix all**, **Don't split** and **Stop** in ⋯). Only the extras
that read the plan text need the switch on: the summary, the inline plan, perspective
chips, **Save to plans/** and **Open in New run**.

## Three ways in

- **Shaper.** The tile on the Chat home. Describe the task; Worca
  proposes a shaped run on a card.
- **The nudge.** When Ask Worca judges a task to have open decisions, the run card
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
choose **Update plan** to have the plan rewritten for the new set.

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

## Checklists in review

Each perspective's checklist ends the plan as `R-…` items. The code review marks
every item **met**, **unmet** or **n/a**, with evidence for the call.

On the run page Overview, the **Perspective checklists** group shows one section per
review cycle: the newest open, older ones folded. On a finished shaped run the Chat
card carries the tally ("Checklist: 3 met · 1 unmet · 1 n/a"), and the pull request
description gets a section with the same items.

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

**Plan once.** Slices 2 and later skip Clarify: they use the answers you gave for
slice 1. Their planner still writes a plan for its own slice.

**Approve each slice's plan** (on the outline card: **Ask me before each run**). Off by default: a later slice's plan stops for you
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
  what was answered in place;
- the open step, whichever run asks it: run 2's plan approval is answered in this
  card too;
- a row per run (`Planning · Done`, then `n · title · state`, or its pull request's
  state once it has one); a row opens that run in Chat's panel.

A later run's **Answer** in Chat home opens the feature's thread. A slice is planned,
starting, shaping, waiting for your answers, waiting for approval, running, paused,
done, stopped, error, failed, missed or canceled. When a slice halts, the feature page
says "Slice k stopped · slices k+1–N waiting" and offers:

- **Review plan**, **Answer** or **Open**, which open that slice's run in Chat's panel;
- **Resume slice k**, which resumes a paused slice and restarts a stopped one as a
  new run, then re-chains the slices after it;
- **Re-plan the rest**, which cancels the slices that have not started and plans the
  remainder again from the last done slice's branch, with a new outline to approve;
- **Cancel the rest**, which cancels the slices that have not started;
- **Approve each slice's plan**, the switch above.

Resume, Re-plan the rest and Cancel the rest act on an active feature. Re-plan the
rest also needs every slice to be idle: stop a running one from its own card first.

**The feature page.** Each feature has its own page (`#feature/…`): the slices in
order with a bar part per slice, each slice's state and pull request, "merge first"
on the earliest open pull request, the slice in flight with its stage and any
question or plan approval it waits on, and the actions above. Chat's run card shows
a one-line summary with **Open feature**, the Runs list shows a feature as one row
("Slice 2 of 3 · Build", or "Needs you"), and a slice's run page says which feature
it belongs to and, once done, which slice comes next.

**Ship as.** Each slice opens a draft pull request when it finishes; merge them in
order, since each slice's branch starts from the one before. When every slice is
done, the feature page asks how to ship: **Stacked PRs** marks each draft ready for
review, **One PR** opens one pull request from the last slice's branch into the
feature's base and closes the slices' drafts with a link to it. The page suggests
one PR for a feature under about 1,500 added lines. Either way, one entry for the
feature goes into the project's `CHANGELOG.md` under `## Unreleased`, committed on
the last slice's branch, so it ships with the feature.

**The Plans tab.** The Chat home lists shaped plans on a **Plans** tab, newest first,
with their state. A sliced feature's row opens its card underneath. The tab shows
only while Shaper is on.

## Limits

- Workspace runs are not sliced, and their checklists are not merged: a shaped
  workspace run gets a plain plan.
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
