# Worca Rail: the run page

The run and group page on Worca Rail. The rules every Rail page follows (One Rail, type roles, the shared components,
suggestions, steps that change state, the gate) are in `docs/design-system.md` › Worca Rail; this spec is only what
is particular to this page. A change is made here first, then in the prototype (`plans/rail/prototype/`). The review
history is `plans/rail/review.md`; the way to ship it is `plans/rail/enrollment.md`.

## Anatomy, top to bottom

| Zone | Holds | Never holds |
|---|---|---|
| Top bar | The trail `Runs › place › group` (the page is never a crumb; `‹ Parent` at 760px and below) and, on a run inside a group, the pager `‹ 2 of 3 ›` at the right | Buttons for the run |
| Title | The title, one line with an ellipsis; a tap shows it whole | Chips, buttons |
| Metadata line | In this order: the kind (group pages only), where the code lives as a phrase (`#959 merges branch into dev`, `branch into dev`, `merged into`, `main to origin/main`, `into ~/folder`; the branch copies itself), then the tag group: a tag mark, labels, then cost tags (`key: value`), a label as an outline with a small dot, a cost tag as a soft fill, no colour; a small × on the chip under the pointer (or with keyboard focus) removes it; one line, the rest folds into `+N`, the full list in its tooltip. With nothing set, the mark alone | The project (in the trail), the start time (in the Time figure), counts the card already shows, colour |
| Status line | The state word with one detail line; at its right the run's controls together: the action (main + ▾), then ⋯ | — |
| Stepper | One segment per stage (per run on a group page); cells are steps; the label under a segment is its time | — |
| Open stage | The selected stage's steps (circle · name · time · loops), the live line; a question is answered here, under its step; on a group, the selected run with its cost and Open run (a run that has not started: Re-plan from here), then the next run as `Then Run 3 · title starts by itself ▾`; the Plan segment holds Open the plan; the PR stage holds the PRs, in merge order | — |
| Figures | Time (start in its tooltip) · Cost of budget (opens the breakdown) · Changes (opens the tab) | — |
| Tabs | Overview · Changes · Activity · Decisions (a group: Overview · Activity · Decisions) | A second list of a group's runs |

## Where an action goes

| Kind | Place |
|---|---|
| The run's one critical control | The action slot: the next step, or Pause while the run works. Alternatives in its ▾; Stop the run is the last item, after a rule |
| Supporting actions | ⋯ next to the action: Away mode (a choice), Run after, Save as preset, Terminal, Copy link; then Report, Archive or Restore. On groups only the tools: Terminal, Copy link (Next run sits under the run it follows, the plan in its segment, Cancel the rest in the action's ▾ after Stop) |
| A fact's detail | Its figure (Cost opens the breakdown, Changes its tab) |
| The code's own actions | The Changes head: Check out ▾ (Download patch, Copy git commands, Refresh) |
| A yes or no, or a one-line answer | The strip under the top bar: confirms, Run after |
| A form | The app's dialog. Create PR opens with one sentence, `branch into dev ▾`; for a group it starts with how many, as a picker in the same sentence (`3 stacked PRs ▾ from branch into dev ▾`, the suggestion checked, its reason under it), never a toggle. One PR: Title and Description. A stack is reviewed by exception: one closed row per PR (title, a one-line summary or why it is worth a look, size, base), which is the stack shown once; a row opens to the same Title and Description fields, and Create works without opening any. Each stacked description has a Stack section in merge order; only the last PR closes the issue. Then Draft and Watch with the issue it closes. Title and description are suggested as on the New run form: a sparkle inside the field, a Suggested chip, the shimmer while it writes; an eye shows the description rendered |
| Checking out the code | Check out, in the Changes head (a group: Check out the whole feature, in its action's ▾); nowhere else |
| Labels and cost tags | The tag group is one button: it (or `L`) opens one editor with a field (a word adds a label, `key: value` a cost tag) and two checked lists, Labels and Cost tags; removing also works there, and on touch screens only there |
| Merging a stack | One PR at a time, in order: the action is `Merge #959` once it is ready (it confirms first); when it merges, Worca moves the next PR onto dev, where its checks run again; failing checks come first (`Fix checks on #961`) |
| Group membership | ⋯: Move to group…, which opens the same list editor as labels and cost tags (find or create; one group, so a single choice), or Leave it |

## Page rules

- Buttons in the card and its tabs are 28px. Below the card everything starts on the tab text edge.
- Actions today's app does not have are listed, with why, in a note in the prototype's intro ("N actions are proposed,
  not in today's app"); the buttons themselves carry no mark, here or in the build.
