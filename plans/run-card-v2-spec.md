# Run card v2: the spec

One page that fixes the run page's structure. A change to it is made here first, on purpose, then in the prototype
(`plans/mocks/run-card-stepper.*`). Rationale and review history live in `plans/run-card-v2-review.md`.

## The philosophy: One Rail

Every screen reads down one rail, and everything has one place on it.

1. **One rail.** Everything aligns to a single 20px rail and one text edge; a dot, a step, a member run or a PR is a
   row on it. Nothing floats.
2. **State is the headline.** The first thing read is what is happening (a word and a colour that only ever mean a
   state), the second is what you can do about it.
3. **One place per fact.** A count, time, cost, PR number or question appears once; everything else links to it.
4. **One action, the rest behind ⋯.** Each state offers the one critical control; alternatives sit in its ▾, supporting
   actions in ⋯, danger last.
5. **Quiet until needed.** Labels, tags, banners and help appear when there is something to say; help lives in
   tooltips, not lines.
6. **Nothing moves by itself.** No jumps, no reflow on hover, no animation that is not a state change.

## Anatomy, top to bottom

| Zone | Holds | Never holds |
|---|---|---|
| Top bar | The trail `Runs › place › group` (the page is never a crumb; `‹ Parent` at 760px and below) and, on a run inside a group, the pager `‹ 2 of 3 ›` at the right | Buttons for the run |
| Title | The title, one line with an ellipsis; a tap shows it whole | Chips, buttons |
| Metadata line | In this order: the kind (group pages only), where the code lives as a phrase (`#959 merges branch into dev`, `branch into dev`, `merged into`, `main to origin/main`, `into ~/folder`; the branch copies itself), then the tag group: a tag mark, labels, then cost tags (`key: value`), a label as an outline with a small dot, a cost tag as a soft fill, no colour; a small × on the chip under the pointer (or with keyboard focus) removes it; one line, the rest folds into `+N`, the full list in its tooltip. With nothing set, the mark alone | The project (in the trail), the start time (in the Time figure), counts the card already shows, colour |
| Status line | The state word with one detail line; at its right the run's controls together: the action (main + ▾), then ⋯ | — |
| Stepper | One segment per stage (per run on a group page); cells are steps; the label under a segment is its time | — |
| Open stage | The selected stage's steps (circle · name · time · loops), the live line; a question is answered here, under its step; on a group, the selected run with its cost and Open run; the PR stage holds the PRs | — |
| Figures | Time (start in its tooltip) · Cost of budget (opens the breakdown) · Changes (opens the tab) | — |
| Tabs | Overview · Changes · Activity · Decisions (a group: Overview · Activity · Decisions) | A second list of a group's runs |

## Where an action goes

| Kind | Place |
|---|---|
| The run's one critical control | The action slot: the next step, or Pause while the run works. Alternatives in its ▾; Stop the run is the last item, after a rule |
| Supporting actions | ⋯ next to the action: Away mode (a choice), Run after, Save as preset, Terminal, Copy link; then Report, Archive or Restore. On groups: Next run (a choice), Re-plan the rest, Open the plan, Cancel the rest |
| A fact's detail | Its figure (Cost opens the breakdown, Changes its tab) |
| The code's own actions | The Changes head: Check out ▾ (Download patch, Copy git commands, Refresh) |
| A yes or no, or a one-line answer | The strip under the top bar: confirms, Run after |
| A form | The app's dialog. Create PR: (for a group, the PRs and stacked or one), Title, Description, the phrase `branch into dev ▾`, then Draft and Watch with the issue it closes. Title and description are suggested as on the New run form: a sparkle inside the field, a Suggested chip, the shimmer while it writes; an eye shows the description rendered |
| Checking out the code | Check out, in the Changes head (a group: Check out the whole feature, in its action's ▾); nowhere else |
| Labels and cost tags | The tag group is one button: it (or `L`) opens one editor with a field (a word adds a label, `key: value` a cost tag) and two checked lists, Labels and Cost tags; removing also works there, and on touch screens only there |
| Group membership | ⋯: Move to group…, or Leave it |

## Type roles

| Role | Size and weight | For |
|---|---|---|
| Page | 22, bold, ink | The title |
| Headline | 18, semibold, ink | The state word |
| Value | 15, semibold, ink | Time, cost, changes |
| Body | 13, regular, ink (the live or asking step semibold) | Step and stage names, questions, Overview text |
| Meta | 12, regular, grey | The metadata line, times, labels of figures, details |
| Caption | 11 | Chips, hints; faint grey only for marks and separators |

## Rules

- The violet shimmer means Worca is writing text for you, in a field you will review (run title and branch, PR title
  and description, a drafted answer, a change request). It never means loading or a run state.

- Each fact once. A count, time, cost, PR number or question appears in one place on the page.
- Menus are the app's compact menu: one line per item, a leading check for a choice, hints at the right, help in the
  tooltip, danger last after a rule.
- Buttons in the card and its tabs are 28px. Every row sits on the 20px rail + 12px gap; below the card everything
  starts on the tab text edge.
- Nothing moves the page by itself: a click, a repaint or a menu never scrolls it.
- An action today's app does not have carries a `New` mark in the prototype, so a review can tell proposal from parity.
- Every case passes the gate (`plans/mocks/run-card-sweep.mjs`): no sideways scroll, no clipped text without a
  tooltip, no overlaps, every section on the text edge, contrast 4.5:1, every menu and dialog inside the window, no
  page jump on any click.
