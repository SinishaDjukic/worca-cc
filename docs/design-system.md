# Worca design system

The one reference for how Worca looks. Every screen follows it; `test/ui-design-language.test.mjs` and
`tools/button-audit.mjs` enforce the rules marked (checked). When the guide and the code disagree, fix one of them in
the same commit.

## Worca Rail

Worca Rail is the redesign of every Worca page, one page at a time, on the rules below. A Rail page is specified in
`plans/rail/` (one spec per page) and built first in the prototype (`plans/rail/prototype/`); until it ships, the app's
current pages keep the rules further down. Where a Rail page and a current rule differ, the Rail page's spec says so.

**When the app and Rail differ** (the app ships something Rail does not have, or does it another way), one rule
decides, never case by case: 1. Rail is preferred. 2. If the app's way meets a real need, find how Rail takes it in.
3. The result is Rail, upgraded where needed, written here. `plans/rail/dev-alignment.md` records each case.

### One Rail: the philosophy
Every screen reads down one rail, and everything has one place on it.
1. **One rail.** Everything aligns to a single 20px rail and one text edge (rail + 12px gap); a dot, a step, a member
   run or a PR is a row on it. Nothing floats.
2. **State is the headline.** The first thing read is what is happening (a word and a colour that only ever mean a
   state), the second is what you can do about it.
3. **One place per fact.** A count, time, cost, PR number or question appears once; everything else links to it.
4. **One action, the rest behind ⋯.** Each state offers the one critical control; alternatives sit in its ▾, supporting
   actions in ⋯ next to it, danger last after a rule.
5. **Quiet until needed.** Labels, tags, banners and help appear when there is something to say; help lives in
   tooltips, not lines.
6. **Nothing moves by itself.** No jumps, no reflow on hover, no animation that is not a state change (Motion); a click, a
   repaint or a menu never scrolls the page.

### Type roles
The type scale below, named by what it does on a Rail page.
| Role | Token | Weight | For |
|---|---|---|---|
| Headline | `--fs-page` 22 | 600, tracking −0.02em | the state word: what is read first |
| Title | `--fs-subpage` 18 | 600, tracking −0.02em | the page title, one line with an ellipsis (a tap shows it whole); a page with no state word (a list, Settings) keeps it at `--fs-page` 22 |
| Heading | `--fs-section` 15 | 600, tracking −0.01em | a section's head on a page (a settings section, a tab's section); a step above the rows it heads, never the same size |
| Value | `--fs-section` 15 | 600 | figures: time, cost, changes |
| Body | `--fs-body` 13 | 400 (the live or asking row 600) | rows, questions, text |
| Meta | `--fs-meta` 12 | 400, `--ink-2` | the metadata line, times, figure labels, details |
| Caption | `--fs-caption` 11 | 400 | chips, hints; `--ink-3` only for marks and separators |

A head is never smaller or weaker than what it heads: a step larger (a page's sections: Heading over Body rows), or the
same size, heavier and in `--ink` (a list's or a menu's groups: Body 600 over Body 400 or 500 rows). Never a caption
over the items it names. `ds-check` compares every head with its items.

### The Rail look
Calm and state-first: the look refines the current one and never adds a character of its own (no display faces, no
drawn rails, no new hues). Mocks: `plans/rail/mocks/visual-language-refined-*.png`. The prototype and the app keep
today's look until the Rail ships; these values replace it then. The Pulse prototype (`pulse.html`) already shows
the Rail look, so it can be judged in use.
- **Type:** Inter, bundled (400, 500, 600), in place of Poppins; JetBrains Mono stays for code, branches and ids. No
  700: titles and the state word are 600 with −0.02em tracking, buttons 500.
- **One surface:** the page and the card share one background (`--bg` = `--panel`); the card keeps its 1px `--line`.
  The card has one divider, above the Figures; its other zones are split by space.
- **One family of neutrals,** slightly cool, for every grey, line and fill:

| Token | Light | Dark |
|---|---|---|
| `--bg`, `--panel` | #FFFFFF | #141416 |
| `--canvas-2`, `--side-bg` | #FAFAFA | #18181B |
| `--field`, `--surface` | #F4F4F5 | #1F1F23 |
| `--hover`, `--side-sel-bg` | #F0F0F2 | #222227 / #26262B |
| `--ink` | #18181B | #EDEDEF |
| `--ink-2` | #63636B | #A1A1A9 |
| `--ink-3` | #A1A1A9 | #6E6E76 |
| `--line` | #EEEEF0 | #26262B |
| `--line-2` | #E2E2E6 | #35353B |
| `--float`, `--float-line` (menus, panels, popovers) | #FFFFFF, `--line` | #1D1D21, #323238 |

- **Running and needs-you stay apart:** `--peach` #B39A0E / #ECD86A (lighter, lemon) and `--amber` #E07A1F / #EE8A2C
  (deeper orange). The two dots must read as two colours at 8px, side by side in Pulse, in both themes.
- **The step bar is quiet:** 4px; a step to come is `--line`, a finished one #C9C9CF / #4A4A52; only the live, asking
  or failed cell has colour.
- **The metadata line:** the branch is `--ink-2`, so the PR number and the phrase read first.
- **Depth in dark:** a floating surface is a step lighter than the page (`--float`) with a hairline (`--float-line`);
  the shadow alone does not show on dark.

### Motion
Motion shows what changed, never decorates. Every change of state on the screen eases in, quickly and with one
curve; everything else is still. Filmed from the run page: `plans/rail/mocks/motion-*.gif`.
- **Three timings, one curve:** `--motion-quick` 150ms (something appears, opens or goes), `--motion-change` 200ms
  (something that was there becomes something else), `--motion-flash` 1.2s (the one flash after a jump); all on
  `--ease` `cubic-bezier(.2, 0, 0, 1)`. Nothing is slower; nothing bounces.
- **Fade, never slide.** What appears fades in and what goes fades out; what is around it moves to its new place at the
  same pace, so nothing jumps. Nothing travels across the screen.

| Moment | Motion |
|---|---|
| A row opens or closes its detail | the detail fades over `quick`; the › turns; what is below moves with it |
| A row arrives or leaves (Pulse, Runs, a cleared update) | fades in or out over `quick`; the rows around it move to their place |
| A state changes (the word, the dot, a step's mark, a progress cell) | the old fades out, the new fades in, over `change`; a colour changes over `change` |
| A text replaces another in place (`Merging…` for `Merge PR`) | crossfade over `quick` |
| A menu, popover, tooltip or panel opens | fades in over `quick` (a tooltip after its usual delay); closes at once |
| A Dialog or the ConfirmStrip opens | fades in over `quick`; the strip's space opens with it |
| A Switch changes | the thumb moves over `quick`; the track's colour over `change` |
| A tick box is ticked | the tick fades in over `quick` |
| Hover and press | the tint over 100ms, never a lift or a size change |
| A Toast | fades in over `quick`, out over `change` |
| A link or a search lands on a fact's home | the target comes into view, lights once and fades over `flash`; focus moves to it (`land()` in motion.mjs) |
| The sidebar becomes another menu (Settings) | its content fades over `change`; the page changes at once |
| Working | the live dot and the live cell breathe: the one thing that moves on its own, because it means work is happening |
| Worca writes in a field | the violet shimmer, while it writes |

- **Never:** a transition between pages or tabs (they change at once), a slide, a spring, a bounce, a count-up, a
  spinner, a skeleton shimmer, a parallax, motion on scroll, or anything that runs without a state change.
  The one named exception is the away screensaver: it starts after 5 idle minutes and is off under reduced motion.
- **Reduced motion** (`prefers-reduced-motion`): every timing is 0; the breathing is a still colour, the shimmer a still
  wash, the flash a still outline that fades with the next click.
- **In code:** a page that draws itself again after a change draws with `morph(target, html)` from
  `ui/public/design-system/components/motion.mjs`, never innerHTML: what is still there stays the same element, so its
  colour eases by its CSS transition, and only what is new or changed moves. A component says how it moves with
  `data-motion`: `in` (a menu, a popover, a dialog), `open` (the ConfirmStrip, a row's detail: its space opens too),
  `change` (the state word and dot), `swap` (a label replaced in place). Going to another page or run passes
  `{ motion: false }`. A page never animates by hand; reduced motion is handled there.
- A live update never moves what you are reading: what arrives above it holds its place until you scroll there (Pulse
  and the group page already keep this).

### Which component: one per need
A Rail page is built by naming needs, not looks. Find the need, use its component as its page in the Design System
shows it; sizes, colours and spacing come with the component. Names are the Design System's pages.
| Need | Component | For example |
|---|---|---|
| **Acting** | | |
| The one next step of a state | the split button in the StatusLine: Button primary, its ▾ the alternatives | Merge PR ▾, Resume now ▾ |
| Supporting actions | ⋯ next to it, a CompactMenu, danger last after a rule | Terminal, Copy link, Archive |
| A yes or no, or a one-line answer | ConfirmStrip, in place under the top bar | Merge #959 into dev?, Run after |
| A step that needs fields first | Dialog, the only one for a form | Create PR |
| Going to another page or place | Text link, or a ListRow you open | Changes +358 −144, a file, a step |
| Copying text | CopyButton: a quiet 28px icon button; a tick for 1.2s and `Copied` in its tooltip and the live region; its width never changes | a branch, a command, an id |
| **Choosing** | | |
| A choice that changes a step | SentencePicker: a picker in the sentence it changes, opening a CompactMenu | `dev ▾`, `3 stacked PRs ▾` |
| Answering Worca's question | OptionList: one line per answer, a radio dot, Worca's pick marked, your own answer under it | the asking step's answers |
| A setting that is on or off | Switch: takes effect at once, no confirm; a failed change flips back and a toast says why | Watch on a PR |
| Picking items from a list, an opt-out, a consent | Checkbox | the checklist, No cap, Draft |
| Two or three views of the same thing | Segmented | Light and Dark, Summaries and Raw |
| Sections of a page | Tabs | Overview, Changes, Decisions |
| Narrowing a list | the list's sentence: SentencePicker words above the list, each choice with its count; never a filter button or a View menu | `Showing [ready to ship ▾] from [all projects ▾] by [day ▾]` |
| Picking and adding names | ListEditor | labels and cost tags, groups |
| A choice inside a confirm | OptionList inside the ConfirmStrip or the Dialog; never radio cards | Rescan now, Rescan after the next run |
| One pick from a long list, or a new one | ListEditor, single pick: find or create, recent first | Add to group |
| **Entering** | | |
| Text, a number, a pick from a long list in a form | Field | Branch, Budget, Base branch |
| Text Worca writes for you | SuggestionField | PR title and description, a drafted answer |
| Finding anything | the top bar's search: runs, chats, settings, plugins; a result lands with the flash | Search or ask |
| Context sent with a message | ListEditor's removable item, in the composer | This page × |
| **Showing** | | |
| What is happening | StatusLine: the status dot and the state word | Ready to merge, Paused |
| How far along, and its steps | Stepper, then StepRow on the rail | Plan · Build · Review |
| Time, cost, changes | Figures | Cost $84.10 of $120 |
| Labels and cost tags | TagGroup | ui, team: web, +2 |
| A list of things | ListRow on the rail, the whole row opens, never a box per item. Rows are split by space; a list grouped by something (status, day, section) draws one `--line` where each group after the first starts, from the text edge, and none between rows. Mock `plans/rail/mocks/now-dividers-compare-*.png` (option 4) | runs, files, decisions, Pulse's Now, a settings tab |
| A short fact: a stage, a source, a slot to set up | Chip | Beta, Official, No API key |
| Why a control is off, a cut-off text, an id | Tooltip | Checks are still running on #959 |
| The same figures across many rows | Table: divided rows, tabular figures, no box per row, the name first; on a narrow screen the least needed columns go to the row's detail | sessions, cost by step |
| **Telling** | | |
| Something done, nothing to answer | Toast | PR merged |
| Something failed | where you acted: the strip, the dialog's alert, the field's error line, the suggestion's grey line; a Toast only when there is no such place | Could not merge #959 |
| Nothing here, loading, could not load | EmptyState: one line on the text edge; loading shows nothing for 300ms, then one line, never a spinner or skeleton | No runs yet |
| A part of the page cannot be drawn | EmptyState's error, in that part only, with Reload this part | Could not show the changes |
| Something broke that nothing handles | Toast, error: stays until closed, a repeat counts on it | Something went wrong |
| The connection dropped | a quiet line at the end of the top bar, grey dot, until it reconnects | Offline · retrying |

Building from it:
- A page sets no look of its own: no colour, type size, corner or shadow that is not a token, no inline style but
  layout and data, no control that is not in the table. `plans/rail/prototype/gates/ds-check.mjs` checks it.
- A spec names the need and the component (`the step's primary in the strip, destructive`), never a size or a colour.
- When no row fits, stop and propose the addition here (a row, then its Design System page) before building it.
- A choice is never a full-width toggle or radio cards, and a yes or no never covers the page.
- The prototype's one-line ink toast (`.rc-toast`) is a stand-in for the shared Toast.

### Where things go: the patterns
The lookup says which component meets a need; a pattern says where it sits. A page is one of these patterns, or a
pattern of each part; a spec names the pattern and the needs, and the place follows. When a part fits no pattern,
propose one here before building it.

**Building a page from a spec.** 1. Pick the page's pattern below. 2. For each thing the person must see or do, find
its need in the lookup and its slot in the pattern. 3. Write its words by the rules (Small rules, Steps that change
state, and Patterns further down: labels of 1–3 words, plain words, the status line); a state's dot and colour are
Status dot and symbols. 4. Draw every state: empty, loading, could not load, a failed step, an unexpected break, a
lost connection, and 375px (Narrow screens). 5. Pass the gate. The catalog of needs, components and patterns, as data
for a tool or an agent, is `docs/design-system-catalog.json`; this section and the lookup win when the two differ.

**What a page teaches becomes the design system's.** A pattern, a level, a rule, a motion or a control that a page
needed and the design system did not have is added to it before the page ships: the rule here, its catalog entry, and
its component in `ui/public/design-system/components/` with its test and its gallery example. A page never keeps a
hand-built version of something the design system should own; `ds-check` lists the pages built from the components
(BUILT) and fails on component markup written by hand there.

**The components in code.** A component with a `code` entry in the catalog is built in code, in
`ui/public/design-system/components/` (`index.mjs` exports them all): call it, never write its markup. Each returns
an HTML string from plain options (`button({ label, kind })`, `confirmStrip({ text, yes })`), so a page that renders
with innerHTML uses it as is and a page that builds elements takes it through `toElement`. A component brings its look
and its states (working, failed, disabled, the count by exception), so a fix or an upgrade reaches every page at once.
A need with no component in code yet: add the component there first, with its test (`test/design-system-components.test.mjs`)
and its `code` entry, then use it. The gallery (`plans/rail/prototype/components.html`) draws each one from the code;
`ds-check` fails a page in its BUILT list that writes a component's markup by hand.

**A thing's page** (a run, a group; the pattern for any page about one thing with a state), top to bottom:
| Slot | Holds | Never holds |
|---|---|---|
| Top bar | The trail to the parent (the page itself is never a crumb; `‹ Parent` at 760px and below); at its right only quiet lines that are about the window, not the thing: the pager, `Offline · retrying` | Buttons for the thing |
| Title | The name, one line with an ellipsis | Chips, buttons |
| Metadata line | Facts as short phrases (where it lives, its kind, when it runs), then its TagGroup; one line, the rest folds into `+N`. A fact that is also a setting is a SentencePicker in its phrase (`Runs [every weekday ▾] at [09:00 ▾]`) | Facts another slot shows, colour, a setting the page does not show |
| StatusLine | The state word and one detail line; at its right the action slot: the one next step (main ▾), then ⋯. A state that calls for no step leaves the slot empty; ⋯ stays | A second primary |
| The thing's progress | Stepper and the open stage's StepRows; a question is answered under its step, as an OptionList | — |
| Figures | Its numbers; each opens its own detail: its tab when it has one (Changes), else a breakdown under it (Cost) | Chips, lists |
| Tabs | Sections of the thing; each tab's content starts on the tab text edge | A second list of what the page already lists |

**Where a list goes on a thing's page** (checks, a plan's steps, files, decisions): each list has one home, chosen by
what it belongs to.
- **Part of a step** (the checks of the PR stage, the plan of the Plan stage): its StepRow says it in one line, a count
  and the names that matter (`2 failed · unit, e2e`); the whole list is Overview's first section, the state's focus,
  named by what it is (`What broke`, `The plan`, `To check`), and the card's action lands there.
- **About the thing as a whole** (files, decisions, activity): its own tab, its count a caption on the tab; a Figure
  may open it (Changes).
- Never both: a list in the focus section has no tab, and a tab's list is not repeated in the card.
- **A tab reports by exception:** what needs the person is drawn in full; what went fine is one line with › to its
  detail, and opens by itself only when something in it did not pass.
- **A list of what a run produced groups by what each item is** (Code, Tests, Not in the code), not by folder;
  largest first, the folder after the name, each group's head with its count.

**What opens, and what does not** (mocks: `plans/rail/mocks/run-expand-rules-*.png`):
- **A row opens its own detail, in place:** the ask's parts, a file's diff, a step's rounds. Its › points right while
  closed and down while open; focus stays on the row.
- **What has a problem opens by itself** (a failing test, a part of the ask not done, a failed command in Chat: its
  group and its row, with the output); what went fine stays one line. It opens once: folded by the person, it stays
  folded.
- **A fact that has a home elsewhere links there instead of opening a copy:** the evidence line goes to Activity.
- **Sections never collapse:** a section or group is always drawn; one that is too long shows less, it does not fold.
- **Opening never moves what is above it.** Several rows may be open at once, except one detail of a kind at a time
  (one diff).

**Where an action goes** (on every page):
| Kind of action | Slot |
|---|---|
| The one step the state calls for | The action slot's main; alternatives in its ▾; the one that ends the thing (Stop, Cancel) last, after a rule |
| Supporting actions on the whole thing | ⋯ next to the action slot; tools first, then Report, then Archive or Delete after a rule |
| Actions on one section | That section's head, at its right (Check out in the Changes head, Reset to defaults in its section) |
| A fact's detail, or going to the place a fact names | The fact itself, as a Figure or Text link (`#959` opens the PR); ⋯ only when no fact on the page names it |
| A yes or no, or a one-line answer | ConfirmStrip under the top bar, opening on the safe choice |
| A step that needs fields | Dialog |
| A choice that changes a step | SentencePicker, inside the sentence it changes |
| A thing's own setting (a schedule's times, a run's budget) | The fact itself, where the page shows it, as a SentencePicker; a setting the page does not show is not added to be editable. Settings that must change together: a Dialog from ⋯ (`Edit schedule…`). Where it belongs (its group): ⋯ |
| Anything about how Worca behaves everywhere | Settings, never on a thing's page |

**A list page** (Runs, Schedules): the top bar's trail, then the title row with the page's one action at its right
(`New schedule`), then a list. **A list** (runs, updates, files, PRs): divided ListRows on the rail. A row is its state mark on the rail (a status
dot, or a tick box while selecting), a title line, a meta line, its time or figure at the right; the whole row opens
its one target, so a fact in the row is text, never a second link. The row's own actions are a ⋯ at its right end
(the Runs list's row ⋯), the same CompactMenu as on its page. Rows sit in sections in a fixed order (by urgency, or by day), newest first in each; a section with
no rows is not drawn; the page's spec names the sections. A long section is never folded: it shows its newest rows,
then one quiet row, `Show 21 more`, opens the rest in place (Older shows 3). What the list shows is a sentence above it (`Showing [unread ▾] from [all groups ▾]`), not a
filter button; grouping is one more word in it (`by [day ▾]`), each choice in its menu with its count. Every
list (Runs, Chats, Pulse's Now and Updates, Schedules) uses this one sentence, so a list is narrowed the same way everywhere. Selecting is only for a list whose rows a person can act on together (Runs, Chats, Pulse's Updates); a list of states that leave by themselves (Pulse's Now) has the sentence and no selection. Selecting works the same in every list that has it. You start it from the list's menu
(`Select`), with ⌘ or Ctrl-click, with Shift-click for a range, with Space or ⌘A, or with a long-press on touch.
`Select all` joins the head and the sentence stays. The selection bar (`.runs-bulk`) sits at the list's foot:
`2 selected · Archive 2 · Cancel`. Each action shows how many rows it applies to and is disabled at 0. Cancel or Esc
ends selecting. An action that can be taken back does not confirm and offers Undo in its Toast; one that cannot confirms in the strip.
Empty is EmptyState's one sentence and, when there is one, the way forward as its one quiet action (`No schedules
yet.` · New schedule).

**A panel** (Pulse, the account menu): opens under its top-bar button over any page, never as a page of its own.
Its head holds Tabs with each count as a caption and ⋯ at the right; the body scrolls and the head stays. On a narrow
screen it is the window's width.

**A side column** (Ask worca, a Feature chat): a column beside the page, opened from its top-bar button. Above 1080px
it pushes the page; from 761 to 1080px it covers the page's right side; at 760px and below it takes the window. Its
width is dragged between 360 and 680px and kept. It opens with Motion's fade, the page narrowing with it, and closes
at once. One side column at a time.

**A conversation** (Chat, a side column): the person's messages on the right on `--field`, Worca's text on the page,
its work as cards on a 760px text column under the shared card head: a run card, a command group (folded to its head;
a failure opens itself), a graph in its well.

**Settings**: one place, opened from the profile menu (the sidebar holds places in Worca, never Settings; Interface
mode, Appearance and going away live in the profile menu only). Opening it turns the sidebar into its menu, its content
fading over `change` while the page changes at once: `‹ Back to Worca`, then the sections under four group heads
(Worca: General, Notifications, Team policy, Labs · Work: Runs, Presets, Labels, Automations · AI: Models, Providers,
Chat, Guardrails, Memory · Add-ons: Plugins, Connectors). **A setting or a place:** a setting is a choice about how
Worca behaves, set rarely, taking effect at once; a place is where you do work and come back to. So the Marketplace
*store* is a place in the sidebar, while what you installed (Plugins), Connectors, Models, Providers and Team policy are
settings. On a narrow screen Worca's sidebar stays, Settings opens
on its menu as a list, and a section has `‹ Settings` above its title. The top bar's search finds every row, folded
row and record by its name or its words, and lands on it with the flash, opening its Customise. Mocks:
`plans/rail/mocks/settings-*.png`, `settings-open-light.gif`.

**A settings tab** (a section of Settings): its title, then one meta line saying what it decides, then its sections
(SettingsSection). A row (SettingsRow) is its name on the left and one sentence beside it, the choice a SentencePicker in
it (`Tell me about [needs you ▾] on [desktop ▾]`), and at its right end a Switch when it is only on or off, then its
buttons; it takes effect at once. More detail
folds under the row behind Customise, and a row that differs from its group says Changed. A reset of many rows sits in
its section's head and confirms in the strip; nothing else confirms. **One row per decision a person makes**, saying the
current state in words (`Runs pause at $1,000 a month; one run has no limit`); its fine-tuning folds under Customise,
never a row of its own on the page. A folded row belongs to its row: it sits in the sentence's column, its name a small
label (Meta size, `--ink`) over its sentence, never the page's name column again. A row's actions are quiet buttons,
one besides Customise; a bordered or red button lives only in a Dialog or the ConfirmStrip (a step that cannot be
taken back, such as deleting every chat, is the section head's action and asks first). A value that is a path, a list or a text shows as words with `Change…`, which opens
a Dialog with its Fields. **A record is not a setting**: a tab that keeps records (presets, labels, models, plugins,
rules, an event log) puts them as a List of ListRows after its rows, under its own head; the row opens the thing, its
own actions are in its ⋯, never a SettingsRow per record.

**A form** (New run, Create PR): a Dialog. It opens with the one sentence that frames the step, its choices as
SentencePickers (`A [large ▾] task`, `branch into dev ▾`), then its Fields. Text Worca can write is a SuggestionField.
A problem with the choice shows before it is made, on the rail with an amber dot: one note, what it means, and
the ways out as buttons. The start button names what will happen (`Start at 16:40`); Cancel is quiet, before it.
A setup of several steps is one Dialog with the Stepper at its head, one step per screen, Back and Next in its foot.
A view that only shows (a workflow graph at full size) is a Dialog without a form: its head, the view, Close.

### Navigation: one model
How you move through Worca, the same everywhere. Mocks: `plans/rail/mocks/nav-*.png`.

**Four depths, always in this order.** A **place** (Chat, Runs, Schedules, Statistics…: the sidebar) holds **things** (a
run, a group, a schedule, a chat: its list's rows); a thing has **parts** (its tabs: Overview, Changes, Activity); a
part holds **facts** (a file, a decision, a question, a setting). Everything else lays over a page without changing
where you are: a panel (Pulse, the profile menu), a side column (Ask worca), a Dialog, the ConfirmStrip.

**Five ways to move, each with one job.**
| Way | Goes | Component |
|---|---|---|
| The sidebar | to a place | the sidebar; a place with its own sections (Settings) turns it into its SideMenu |
| A row | to a thing, as a full page: a thing takes the page, never a pane beside its list (the run page needs its width) | ListRow |
| The trail | one depth up: a thing to its place, a run to its group | Trail, in the top bar |
| The pager | sideways, to a sibling: the next run in a group | Pager, at the top bar's right |
| A link, a search result, a Pulse row, a notification | straight to a fact, in any place | Text link, Search, ListRow; `land()` |

**One way back on screen.** The trail is it: never a second `‹ Back to …` beside it. Where you came from is the
browser's back, which always works, after a jump too (a Pulse row from Settings: the trail goes up to Runs, the
browser's back returns to Settings). On a narrow screen the trail is its parent alone, `‹ Parent`.

**Where you land.** A thing opens on its state (the status line), never scrolled; a part opens at its top; a fact
comes into view, lights once over `flash` and takes the focus (`land()`). Coming back to a place restores what you
left there: its scroll, the list's sentence, the selection.

**The address is the page.** The place, the thing, its part and the fact are in the URL (`#runs/r-412/changes/file:3`),
so a link, a notification or a bookmark lands exactly there, and the browser's back walks the same steps.

**The words.** A link names where it goes (`Open Models`, `Runs`, `‹ worca-cc`), never `Click here` or a bare `More`;
a link that leaves Worca says so (`View PR ↗`). A page changes at once (Motion: no page transition).

### Violet, kept apart
Violet has two meanings that never meet: the merged status dot (a state), and Worca writing for you inside a field
(the sparkle, the Suggested chip, the shimmer). A dot never means AI, and a suggestion is never a dot or a badge.

### Suggestions
- The violet shimmer means Worca is writing text you will review. It never means loading or a run state.
- Every suggestion runs on a helper job's model (Models › Helper jobs) and its sparkle's tooltip names it: PR titles
  and descriptions (stacked ones too) on PR description; run title and branch on Run naming; drafted answers and
  change requests on Drafts.
- If Worca cannot write it (an error, or no answer in 20s), nothing changes: the field keeps the text it had, says so
  in grey (`Couldn't write it … The text is as it was.`) with Try again, and the form still submits.

### Steps that change state
A SentencePicker or Switch on a page takes effect at once, like a setting, and a failed change flips back with a Toast
saying why; inside a Dialog it applies when the dialog is submitted. A step that changes what other people see (a PR,
a branch, a merge, a comment) or cannot be taken back (Create PR, Merge, Fix checks, Stop, Cancel the rest, Re-plan,
Archive, Discard) confirms first, in the dialog or the strip. Spending alone never confirms: starting agent work is
not a reason to ask, and Stop stays at hand while it works. Near a limit, the confirm of a step that starts agent work
carries the limit note in one line (`Needs about 12% of Claude Code’s session; 9% is left.`). Its button then says
what is happening (`Creating…`, `Merging…`) and is disabled until Worca has taken the step on; a step that keeps
working (a fix, a re-plan) then becomes the state, and the state word says it (`Fixing checks`). On success the page
moves on and a toast says what happened. On failure nothing changes: the place you acted says what failed and why
(`Could not merge #959`, the reason, `Nothing changed.`) with Try again, and what already succeeded stays (a stack
that fails part-way keeps the PRs it opened; a retry opens the rest). Pause, Resume, Re-run checks, Copy link and
Terminal do not confirm.

### When something breaks unexpectedly
An error nobody planned for still has one place and one calm sentence. A crash in the interface never stops a run:
runs execute on their own, and the words say so.
- **A step you took:** the place you acted, like any failure (`Could not merge #959`), with the reason `Something went
  wrong on Worca's side. Nothing changed.`, Try again and a Details link.
- **A part that cannot be drawn:** that part only, as EmptyState's error (`Could not show the changes`, `Something went
  wrong here. The rest of the page still works.`, Reload this part, Details). Nothing typed elsewhere is lost.
- **In the background** (an uncaught error or a rejected promise, with no part to point at): one error Toast that stays
  until closed: `Something went wrong`, `Worca hit an error it did not expect. Your runs keep going.`, Reload and Copy
  details. A repeat adds a count to it, never a second toast; it never moves focus.
- **Never the raw error in visible text:** the message, the stack and an error id go behind Details or Copy details,
  ready to paste into an issue or Chat.
- **A lost connection is a state, not an error:** `Offline · retrying` with a grey dot at the end of the top bar, gone
  when it reconnects (a toast says `Back online`). Nothing you typed is lost and nothing is retried twice.

The prototype's Break picker plays each case.

### Small rules that hold everywhere
- **Names** (a page, a menu item, a section head, a settings row): the thing itself, as the people who use it call it,
  in 1–3 words, a plain noun first (`Budget`, `Labels`, `Away mode`, `Team policy`). One thing, one name: never two
  things joined by `&` or `and` (two things get two names); never `Your …`, `My …` or `This …`; never a phrase or a
  question (`What it may do`, `Up to date`); never a word made up for the screen. The same thing keeps its name
  everywhere: a menu item's name is its page's title. `ds-check` reads every name on a Rail page by this rule.
- Hover is a tint, never a lift.
- A row with no state to show (an idle chat) may show its kind's line icon in the dot's place, in `--ink-2`; a row with
  a state shows its dot.
- A row that asks the person something shows its one answer as a quiet button at its right (`Approve`); the rest is in
  its ⋯.
- A disabled control says why in its tooltip.
- Progress cells stay neutral; colour sits only on the dot and the state word.
- No emoji and no exclamation marks in the interface.
- In a list you can select, the tick box takes the mark's place on the rail only while selecting, so the list keeps
  one text edge.
- Usage is rings around the avatar, outside in: session, the long window (week, day or month), spend (when a budget
  has a limit). Each ring shows its tightest harness and shades along its arc: `--ink-2` at the start, `--amber` at
  the warning line, `--red` at the limit; used up, full and solid red. Never green, never violet. Its figures live in
  one place, the account menu's Usage and costs side menu; a limit warns before it is spent only in New run, Resume
  and the confirm of a step that starts agent work, and only when the run's estimate does not fit in what is left
  (with no estimate, at the warning line).
- Pulse is the panel under its top-bar button, with no page of its own. Every notification setting lives in one
  Settings tab, Notifications.

### Narrow screens
A narrow page holds everything the wide one does: things move, they are never dropped. Two widths decide it, and the
prototype does both at 375px.
- **760px of window and below:** the trail becomes one link, `‹ Parent`; the sidebar becomes its rail of icons and the
  avatar; a panel or Dialog takes the window's width; a menu stays 16px inside it.
- **520px of content and below** (the card or panel's own width): side by side becomes one above the other, on the
  same text edge:
  - the StatusLine's action slot moves under the state word and its detail; the main step and its ▾ stay whole, and
    the action slot's other buttons (Pause, Run after) fold into ⋯ as items of their own;
  - a settings row's name goes above its sentence, and the row's button under the sentence;
  - a ListRow keeps its mark on the rail, its title and its time or figure at the right; its other columns wrap to a
    second line under the title;
  - Figures and a section head's actions wrap to the next line; Tabs keep one line and scroll sideways inside their
    strip, the page never does.
- **480px of window and below,** or whenever the bar runs out of room (a side column takes the space): a top-bar
  button with a label keeps only its icon, and its tooltip names it.
- **One line or wrap:** a name (the title, a stage label, a row's meta) keeps one line and ends in an ellipsis, with
  the whole text in its tooltip; a sentence wraps.
- **A branch or a path loses its middle,** never its end: its start and its last part stay (`feat/unifi…-breadcrumb`,
  `ui/…/run-head.mjs`), since the end is what tells two apart. The full name is in its tooltip and a click copies it.
  The short name beside it (`dev`, the PR number) never shortens.
- **Touch:** what shows on hover is there from the start (a list's tick boxes); what needs a pointer moves to its
  editor (a tag's ×).

### The gate
Every Rail page passes its gate (`plans/rail/prototype/gates/run-page-sweep.mjs` for the run page, `gates/pulse-sweep.mjs` for Pulse) in every case, at 900 and 375px, in both themes: no sideways
scroll, no clipped text without a tooltip, no overlaps, every section on the text edge, contrast 4.5:1, every menu and
dialog inside the window, no page jump on any click, the top bar one row, one way back at a time (`‹ Settings` only
while the side menu is hidden); and every control does something. Every Rail page also passes
`plans/rail/prototype/gates/ds-check.mjs`: everything on it comes from the design system. A settings tab also passes its
alignment (`align-check.mjs`, in ds-check, at 900 and 400px): one left edge for every head, name and divider, one right
edge where every row's end stops (a quiet button by its text), and each row's name, sentence and end on one baseline.
The alignment is SettingsRow's and SettingsSection's, never a page's; `align-proof.mjs` shows the check catches each
fault.

## Foundations

### Colour (checked)
Every colour is a token in `:root` of `ui/public/shell/self-hosted.css` (served as `/style.css`), written as `light-dark(light, dark)`. Never restate a hex;
a `color-mix()` recipe used twice is a named token (`--btn-hover`, `--red-tint`, …).
| Colour | Tokens | Means | Never |
|---|---|---|---|
| ink | `--ink`, `--ink-2`, `--ink-3` | primary and neutral text; a checked box, a checked radio, an on switch | — |
| green | `--green*` | done, OK, ready, in review | a checked box, an on switch, decoration |
| amber | `--amber*` | needs you, attention, waiting; a PR problem | a brand mark, "not installed", "built-in" |
| red | `--red*` | failed, destructive | a warning that needs no action |
| blue | `--blue*` | information (the Beta chip), in-progress text, links | a status dot (except the route's with-reviewers circle `.rd-route-dot.is-review`), a bar, team policy |
| violet | `--violet*` | Labs only (the merged status dot, the merged run orb and the run page route's merged circle `.rd-route-dot.is-merged` and merged words `.rd-fact-tx.is-merged` are the named exceptions; the Marketplace chat kind tile and dot follow its kind colours, › Marketplace exceptions) | sources, "Official", policy, a badge, a chart series |
| slate | `--slate*` | neutral metadata: a source, "Official", policy (`.badge.slate`) | a state |
Status-dot exceptions: peach = working (it pulses), violet = merged. They are the dots only, never a badge.
Working and needs you must read as two states at dot size, so `--peach` is a warm yellow, not a second orange: a deep
gold on light (`#A88A14`, 3.3:1 on `--panel`) and a sun yellow on dark (`#F2C94C`). It is the one status base with two
arms; the others stay one plain hex in both themes. Colours that must be told apart differ by at least 0.1 in OKLab
in both arms: peach against amber, green and red (checked by `test/ui-theme-tokens.test.mjs`).
Surfaces: `--panel` page, `--surface` raised, `--field` field and tint fill; `--line` dividers, `--line-2` control borders.
`--row-selected` is `--ink` at 8% over transparent (no new hue): the selected Runs row, one ink step over whatever it
sits on, so it reads on the panel and on the Needs-you amber tint alike. Its PR chips take the `-ink-strong` shades to
stay at 4.5:1. `--row-open` is 50% of `--row-selected`: the
lighter row highlight of a collapsed Runs group whose run is open.

Known drift (left for a later run): amber `badge waiting` on Guardrails' "built-in"
and Models' "endpoint-routed", "project (legacy)" and "plugin:" labels; blue engine and credential badges. The interface
mode cards (`.lv-card-icon`) tint their icon per level (an illustration, not a state).

### Type (checked)
One scale, no half sizes. Use the tokens; never type a px size that is not a step.
| Token | Size | Line height | For |
|---|---|---|---|
| `--fs-caption` | 11px | 1.5 | chips, badges, counts, captions; the floor (nothing smaller) |
| `--fs-meta` | 12px | 1.5 | secondary text, meta lines, help, table headers, legends, small controls |
| `--fs-body` | 13px | 1.5 | body, rows, fields, buttons, tabs, the page intro |
| `--fs-section` | 15px | 1.25 | section titles (`.section-title`, `.card h2`), 600 |
| `--fs-subpage` | 18px | 1.25 | sub-page titles (`.subpage-title`), 600 |
| `--fs-page` | 22px | 1.25 | page titles (`.page-title`, the run and group page title), 700, -0.02em; the run and group page title is one line, cut with "…" |
| `--fs-stat` | 22px | 1.25 | stat tile values |
| `--fs-hero` | 32px | 1.25 | the Chat home hero only (22px under 760px) |
`--lh-body` is 1.5 and `--lh-title` is 1.25. A subsection or field label is 13px / 600. Relative sizes are allowed
only for code inside text (`.92em`) and the workflow graph's zoom (`calc(… * var(--gv-scale))`). Drift that later
slices remove is listed in `test/fixtures/design-debt.json` under `typeScale`; that list only shrinks.
Sentence case everywhere: no UPPERCASE kickers (checked). Mono only for code, branches and diffs (ids only in
tooltips), never for plain values such as "On · 356 runs" or "Synced 9 min ago".

### Spacing
A 4px grid: 4, 8, 12, 16, 24, 32. Rows pad 8–12px vertically. Phones (under 600px) use one 16px gutter.
`--pad-card` (24px) pads every card and dialog; `--pad-tile` (16px) pads stat tiles, run tiles and
list cards. Chat message cards keep their own.

### Corners (checked)
| Token | Value | For |
|---|---|---|
| `--r-xs` | 4px | chips, badges, tags, inner segments |
| `--r-sm` | 6px | buttons, fields, segmented controls, filter chips, menu items, highlighted list rows |
| `--r-md` | 8px | cards, dialogs, menus, popovers |
| `--r-lg` | 12px | the chat composer only |
Dots, avatars, spinners, radios and switch knobs may be round; the switch track is the one pill. A highlighted list row
(selected, Needs you) takes the 6px corner and drops its own divider, like a sidebar nav item.

### Sizes (checked)
| Size | Height | For |
|---|---|---|
| small | 28px | `.btn-sm`, `.input-sm`, `.select-sm`, segmented buttons, filter chips, list-row actions |
| medium | 32px | `.btn`, fields, tabs, page and dialog actions |
| large | 40px | `.btn-lg`: at most one per view (Start run) |
Touch screens raise every button to 40px. Fields stay 32px on touch screens; Settings stacks them under 560px of container width.

### Shadows (checked)
None at rest. Only floating surfaces (menus, popovers, dialogs, the dock) use `--shadow-menu`, `--shadow-pop`,
`--shadow-sheet` and `--shadow-dock`.

### Focus
`outline:2px solid var(--ink); outline-offset:2px` on `:focus-visible`; tabs and rows use an inset `-2px` offset. A
script-focused control (a page that focuses its way back on open, a menu handing focus back to its trigger) hides the
ring for every button, link, summary, tab, switch and `[tabindex]` while `data-input="pointer"`; a keydown brings it
back. Only a key that moves or acts on focus counts (Tab, the arrows, Enter, Space or Escape outside a field): typing,
Enter in a field and a modifier alone keep the pointer mode (`ui/public/input-mode.mjs`). Fields keep their ink border
on focus. Rings sit on `:focus-visible`, never on `:focus`.
A divided list with list keys (`ui/public/list-keys.mjs`, the Runs list and the Chats column) is one Tab stop with a
moving focus (`ui/public/list-dom.mjs`, the one module both lists use): rows and foldable section heads take ↑ ↓ / J K,
their ⌄, ⋯ and checkbox are `tabindex="-1"`.

## Components
### Button (checked)
`.btn` + one size (`.btn-sm`, `.btn-lg`) + one variant (`.btn-primary`, `.btn-quiet`, `.btn-danger`); `.btn-icon` is
square. One primary per group. Labels of 1–3 words, verb first. Icons come from `icon(doc, 'plus')`
(`ui/public/icons.mjs`), never a typed "+", "×" or "▾" (checked). The `eye` glyph is used only by the View PR ▾ menu's
Watch item and the route's idle `Watching` button. `.info-tip` is a 28px square like `.btn-sm.btn-icon`; a
button outside `.btn` must be a shared control or a row a person opens (checked by the stray audit). The composer's
disabled Save keeps its ink fill at 70% opacity, not the 45% grey of other disabled buttons, so it still reads as the
primary.
### Copy button (checked)
Every button that puts text on the clipboard is the one copy button, built by `copyButton(doc, { name, label?, title?,
cls? })` in `ui/public/copy-button.mjs` (static markup: `.btn.btn-sm.btn-quiet.copy-btn` with `copyIconsHtml()`'s three
glyphs). The branch name in the run head is the model.
1. Look. A quiet 28px button with a 14px `copy` glyph. When the copied text is shown and is the thing to copy (a
   branch name, a worktree path, the Copilot device code), it is the label, in mono beside the glyph, and the text
   itself is the button. Otherwise the button is an icon square (`.btn-icon`), never a typed "Copy"/"copy" label, and
   it sits next to what it copies.
2. Name. `aria-label` says what it does, verb first, sentence case: `Copy branch name`, `Copy the visible log lines`,
   `Copy path`, `Copy command`. The title is the same, or the full text when the label is shortened.
3. Feedback. Through `copyFromButton(btn, text)` only, the same on every copy button: for 1200 ms the glyph turns into
   a `--green-ink` tick followed by a green `Copied` caption (12px sans, `.copy-btn-msg`, inside the button), and the
   title says `Copied` (`.copied`). A failed write or empty text shows a `--red-ink-strong` × and the reason as the
   caption and title (`Copy failed`, `Nothing to copy`; `.copy-miss`). An icon square widens to hold its caption for
   that window. The outcome is also said to screen readers through one polite `#copy-live` status region (the
   caption is not read: the aria-label names the button). The label never changes and no toast is raised for success.
4. A failure the person must act on (the text is needed elsewhere: a command to run, a path, a sign-in code) also goes
   to the surface's status line, which outlasts the 1200 ms flash, and says what to do instead ("Type ABCD-1234 on
   GitHub instead", "select it and copy it by hand"). A failure with nothing to do (the Logs bar) needs only the flash.
5. Labelled actions. A copy that is one of a row of worded actions keeps its words: `copyButton(doc, { name,
   action: true })` is a secondary `.btn-sm` reading glyph + name (Run Actions' `Copy command`, beside Check out,
   VS Code, Terminal), and while the tick shows, `Copied` takes the words' place; the feedback and failure rules above
   are unchanged. Not copy buttons at all: menu items ("Copy Markdown", "Copy PR link") and a dialog's footer actions
   (the report dialog's `Copy JSON`, the team policy's `Copy for PR`), which keep their words, in sentence case.
A copy-labelled `.btn` that is not a `.copy-btn`, or a `.copied` toggled outside `copy-button.mjs`, fails
`test/ui-copy-button.test.mjs`.
### PR controls (checked)
Every pull request button and link looks the same everywhere (`test/ui-pr-controls.test.mjs`).
1. Variant. Create PR and Push are the ship actions: `.btn.btn-primary`. View PR is navigation: a plain secondary
   `.btn`, for an open PR and a merged one alike. Nothing is a custom pill.
2. Size by context. On a page (the run page's card head, the History Details header, the Create PR dialog) `.btn`, 32px.
   Inside a card or bar (the Chat run card, the Chat pull request card, the run and group page bar buttons that
   `syncActions` makes) `.btn.btn-sm`, 28px. Never full width (`.btn-block`).
3. Icon. Every PR button leads with one glyph from `icon(doc, name, size)` (`ui/public/icons.mjs`): 16px on `.btn`,
   14px on `.btn-sm`. Create PR `pr-create`; View PR `pull-request` while the PR is open, `merge` once merged; Push
   `arrow-up`.
4. Labels. The words come from `ui/public/ship-words.mjs`. "Create PR" makes PRs everywhere; "View PR" goes to one PR
   (a menu item names it: "View PR #812"); "View PRs ▾" lists several; "Ship" is a status word ("Ready to ship"), never
   a button. Push says the header's `Push main` (the source branch). Buttons, menu items, aria-labels and dialog titles
   say "PR"; "pull request" only in headings and sentences; "open" is not a PR verb. The Create PR dialog's title equals
   its confirm ("Create PR", "Create 2 PRs"). Its zones, in order: Into (remote and branch on one row, the branch alone
   with one remote), Pull requests (a feature, a chain or a user group only: One / N stacked, or N separate for a user group, the suggestion under them),
   Title and description (with Draft), After it opens (Watch PR, Release). Its footer: a divider,
   then Cancel and the primary on the right; "Try it first" is a secondary `.btn` on the left; one primary. Field
   labels in it are nouns ("Into", "Push remote", "Draft").
5. Links. A PR text link (`.rd-prs-link`, the route's PR link `.rd-fact-link`, `.chat-rc-watch-pr`, `.ask-prcard-link`, `.ask-shipcard-pr`,
   `.hd-pr-repo-link`) is `--blue-ink-strong`, weight 600.
Placement: on the run page the PR control sits in the card's head at every level (`.rd-sheet-head > .rd-head-acts`, the
`.rd-pr-slot` among the head buttons: Try it, Create PR, Push, Fix conflicts, Ask for changes, Discard / Apply, How to
merge, Report), centred on the status line, with at most one primary; under 420px of head width the buttons wrap onto
their own row below the status, on the left edge. View PR is a split button `View PR │ ▾`
(`.btn-split.mini.rd-pr-split`): the main half opens the PR, the ▾ (PR scope) holds Watch (Advanced and above), Copy PR
link and Fix conflicts (while the PR conflicts). A workspace run has one `View PRs ▾` button that lists each member's PR.
The group page has the same head: Create PR, View PR ▾ or View PRs ▾ on the status line; View PRs ▾ holds each PR, then
Watch PRs and Copy PR links.
A user group's dialog offers One / N separate; One waits on the combine check (`The 3 runs combine without conflicts`,
or why it is off) and ships from a new branch named after the group. Its ship line reads `Any order`.
Nothing PR-related sits in the bar or in a PR bar; the PR's checks and Watch words are the route's pull request row. Runs list PR
chips (`.runs-pr`) are chips, not PR controls.
### Field
`.input` / `.select` / text, number and select elements: 32px, 13px, `--field` fill, 6px corner, ink border on focus.
`.input-sm` / `.select-sm`: 28px, 12px. A textarea grows; it keeps the same fill, corner and padding sides. Search, url, email,
password and date inputs follow the same field; each joins the base rule when its screen moves.
A chat card's form (the run proposal) uses the same `.input` / `.select`; its fields sit on one auto-fit grid
(`.ask-rp-grid`), a switch field takes a whole row, labels stay on one line, and a long value ellipsizes with its whole
text as the tooltip.
### Switch (checked)
One switch, `.switch`: a 32×18 `--r-pill` track and a 14px round knob that is always visible. Off is `--switch-off` with
the `--knob` knob; on is `--ink` with the `--on-ink` knob, never green. Disabled or locked: no opacity fade; the track
turns `--field` with a 1px `--line-2` ring and an `--ink-3` knob (off), or `--ink-3` with a `--panel` knob (on). A locked
switch shows its reason as a 12px `--ink-2` line (`.switch-why`) and in the row's tooltip. Two drivers paint the same
pixels: a real checkbox built by `makeSwitch` (`ui/public/switch.mjs`: `input.sw-input[role="switch"]` + `span.switch`),
and a `role="switch"` element that carries `.on` / `aria-checked`. Labels are 13px / 500 sans (`.switch-label`), help
12px. A setting or option that is on or off is a switch; a checkbox only picks items from a list, is a "No cap" /
"Never" / "No away hours" / "Only between" opt-out or opt-in next to a field, or is a one-time consent. Known drift: the
extension sidebar's own settings checkbox (`.wx-settings-check`) keeps its native look until the sidebar run.
### Checkbox and radio (checked)
A checked checkbox and a checked radio fill `--ink`, never green; the tick is the page colour (`--tick`, `--tick-dash`).
A disabled checked box fills `--seq`. A selected option row (`.opt-row`, `.chip-select label`) takes the `--field` fill and
an ink border.
Requirements' pressed toggles are the one green on/off: a pressed Confirm on an assumption (`.req-confirm`) takes a green
outline and green text, and a Files for the run chip that goes with the run (`.req-fpick.on`) a green outline and a check
on `--panel`; neither is ever green-filled.
### Segmented control
`.seg`: one `--field` container, 28px / 13px buttons, the selected one `--surface`. `.seg-sm` is the same size.
The run log's Summaries / Raw switch (`.log-view-seg`, flag `commandSummaries`) is a `.seg-sm` in the Logs bar and the step
log drawer head. A summarised line's `title` shows the command on hover; that is a mouse convenience, and Raw is the
accessible path to the command. With the switch, Open in Logs and × in the drawer head never shrink; the title ellipsizes.
At 480px and below, the drawer head puts the step title on its own row and keeps the switch, Open in Logs and × together
on the row below, with 7px switch padding (a 311px History drawer leaves 283px). The Logs bar wraps while the switch
shows, so its selects keep their content width and search shares the switch row with copy.
### Tabs
`.tabs` / `.tab`: underline tabs, 32px, never boxed (checked).
### Filter chip
`.filter-chip` (`aria-pressed`): 28px, 12px / 500, 1px `--line-2` border, 6px corner. Selected: `--field` fill, ink
border, ink text. Never a solid ink fill. A count sits in `.n`. It is the only filter chip: `mv-filter`, `wfl-chip`,
`proj-fchip` and `mcp-chip` are gone (checked).
### Chips and badges
One chip: 18px, 11px / 500 sans, 4px corner, filled, no border (checked). The Labs (violet) and Beta (blue) flag chips are
the reference size. Colour carries meaning only. The "Suggested" chip on the New run form's title and branch (`.sn-chip`, Smart run naming) is a permitted Labs-violet use: the whole feature is a Labs feature. Cost-tag chips (`.tag-chip`), the Projects sync pill (`.ps-pill`), the
Chat command card's state (`.ask-cmd-pill`) and the Team policy tab count (`.tp-tab-badge`) are the same chip; on the
active tab the count turns neutral (`--line-2` fill, ink text). A chat command in summary mode (flag `commandSummaries`) shows the runs status dot and no state chip; a lone command is a line like that head (its summary · time ›, no card, no dot) that opens to its detail; consecutive commands share one card under a quiet disclosure head (`--ink-2`, `--hover`, › turning down), folded until the person opens it (a failure shows only as the red `N failed`; a running group puts Stop beside the head), with the rows split by one `--line`; an opened command uses `--field` boxes (command, folder chip, output panel); the full card keeps `.ask-cmd-pill`. The missing-key slot is the one outlined chip: a 1px dashed
`--amber` outline on a transparent fill. A removable chip's × is a 14px quiet button inside the chip. A source, "Official"
or a policy origin is `.badge.slate`; "not installed" and "built-in" are grey.
### Status dot and symbols
A dot is the state: peach working (pulses), grey paused or waiting, green ready, violet merged. Needs you is an amber
"?" only when Worca asks; a PR problem is a plain amber dot with the reason in the PR chip; failed is a red "!".
An idle chat shows the chat bubble line icon in the dot's place.
### Card head
The first line of a card is its headline. When the page title sits above the card (the run page, the group page),
the state is the headline: `.run-status-word`, 1–3 words at `--fs-section` / 600 / `--lh-title`, never truncated, the
status dot centred on it and the head buttons and the Live switch centred on its line (`.rd-sheet-head`,
`--rd-word-line`). Under it, `.run-status-detail`: 12px `--ink-2`, at most 2 lines (the whole text as its tooltip),
and only what no row below says ("not in dev yet", "Failed · Build · Implementation" → "Build · Implementation",
"14 files changed in a copy", "conflicts with dev", GitHub's verdict); absent otherwise. A card with its own title
(the chat run card) keeps the state at 13px / 600 under it. Its head is one row centred on the title's line box (no
margin on the title, no nudge on the dot), the project is the meta line right under it, and a single run has no kind
chip, as the run page title (a PR fix run's fix line leads with "PR fix run"); a group keeps its chip
(`Feature · 3 runs`, `Shaping`), as the group page title. Titles are static or short ("Change Away mode?"); dynamic
names go in the target or meta line (`.ask-mcard-target`); a title that can still grow (a run or feature name) gets
an ellipsis and its text as a tooltip. Chips say the kind or state once; the line after a chip never repeats its word.
### Route
The run page card's read-only "Where the work is" route (`.rd-route`, `ui/public/run-head.mjs` `routeModel` /
`renderRoute`), under the status line after a `--line` divider, at every level from the start of the run. The label
"Where the work is" is sentence case, 12px `--ink-2` (`.rd-route-label`, the facts labels' style), and names the `ol`
(`aria-labelledby`). One row per place the work passes through, in order: the PR path (the run's branch → Pull request →
where it lands), the Push path (the source branch, after the run's own branch when it was not merged back → the remote,
`remote/source`), a Folder run (The run's copy → the project folder) and a workspace (one row per member: its name, then
`branch → target` in mono; an unchanged member reads "No changes in this repository"). Where a feature's or chain's run
lands is the feature's base (`landingOf`), never the previous run's branch; while the group lists load it reads "The
base branch". Each row is a 20px circle (`.rd-route-dot`: an 11px `icons.mjs` icon for the kind of place, `git`,
`pull-request`, `merge`, `remote` or `folder`; a 1.5px ring in the state's colour, its `aria-label` the state word), the
place (mono names truncate with an ellipsis, the full name in `title`) and one quiet 12px `--ink-2` status line
(`.rd-route-second`, it wraps). States: working peach (pulses), done green, problem amber, review blue (with reviewers),
failed red, merged violet, closed slate, future a hollow `--line-2` ring. A 1px connector runs under each circle but the
last, `--green` between two done or merged rows (`.is-linked`), `--line-2` otherwise. The current row
(`aria-current="step"`) is the first row in progress, needing someone or failed, else the last row that is not future.
The run's own branch row carries the copy button (`.rd-route-copy`, `.btn.btn-sm.btn-quiet`, never shrinks; `margin-block:-4px`
keeps the place line 20px so the name centres on its circle; the copied tick as `.hd-branch-copy`). The status lines hold what the facts rows used to: the checks line in its colour
(`--green-ink` passed, `--blue-ink` running, `--amber-ink` failed; GitHub's verdict stays in the head status line),
Download patch, `Commit it yourself` and `Watching` (a ▾ opener at Advanced and up) as `button.rd-fact-act`, View fix
run, and the Watch-stopped hint and a failed Resolve's error each on their own line. The route's PR is a plain
`owner/repo#N` link (`.rd-fact-link`): the circle and the status line carry its state, so it has no `prChip`; the Runs
list keeps the `prChip` with its state word, since a list row has no circle. At an end state (merged, PR closed,
pushed, applied or discarded, every changed workspace member merged) the route folds to one line (`.rd-route-fold`,
for example "Merged into dev · worca/worka-cc#905") with a `Show route` / `Hide route` toggle (`.rd-route-toggle`,
`aria-expanded`); the choice is remembered once for every run page (`worca-cc.run.showRoute`).
### Workflow canvas: session tray
One session (2–4 consecutive agent steps run together) is drawn as a tray behind its member cards, in the
`.gv-sessions` layer (z 0, before the wire SVG, so wires and the glass cards stay on top). Anatomy: the tray
(`.gv-sess`, `var(--r-md)` corners, `--sess-fill`, a 1px `--sess-line` border, 12px padding past the outermost box), its
24px header strip (`.gv-sess-head`, `--sess-head`, 11px / 500 `--ink-2` text: the session's name, the engine and
"N sub-agents", or "<Engine>: separate sessions"), and the member chip in each member's label row (`.nsess`, slate:
`--slate-bg` / `--slate-ink`, `var(--r-xs)`, glyph plus "sub-agent"; only the glyph beside run totals). Use it for a
session only, never for any other grouping. The tray has no hue: violet is Labs, amber loops and needs-you, blue md
wires and info, green and red status. Selected is the `.node.sel` ring (`0 0 0 1.5px var(--ink)`); an error is a
`--red` border with `--red-ink-strong` header text; a session that runs as separate sessions (the Labs flag off, or the engine
has no sub-agents yet) and a lone member are dashed. On run hosts the header's status dot is peach only while
working (it pulses; reduced motion stops it), amber paused, green done, red error, stopped or interrupted. The edit
host's strip is a button (click, Enter or Space selects; drag moves every member; an issue's pip sits first in it);
static hosts, the chat run card and the chat proposal well keep the strip so routes match, but show only the dot and no chip. Trays are
placed in model px from `sessionRects` (`src/shared/graph/sessions.mjs`), never measured, and the strip is an
obstacle the lanes router clears.
### Menu (checked)
One menu skin. The box is `.menu`: 4px padding, `--panel`, 1px `--line`, `--r-md` (8px), `--shadow-menu`, 13px. A row is
`.menu-item`: at least 30px, `--r-sm` (6px), `--hover` on hover and keyboard focus; `.menu-sep` and `.menu-h` (12px /
600 `--ink-2`) divide and head. A disabled row is `--ink-3` with no hover; a destructive row is `.menu-item.is-danger`
(red ink, `--red-bg` on hover) and nothing else in a menu is red or amber. `openMenu({ doc, anchor, items, align, side,
label, host, className })` (`ui/public/workflows/menu.mjs`) emits it, and its items take `danger`. With `host` the menu
is appended inside it (a `.btn-split.mini`) and placed by its CSS; a `{ switch: true }` item is a `menuitemcheckbox`
switch row (help line, `.switch`) whose toggle keeps the menu open. A radio row (`menuitemradio`) is one grid: a 12px ✓
slot first (painted only when picked), the label, then the count or kind chip at the right edge in tabular figures, so
every label starts and every number ends at one x; a count of 0 is `--ink-3`. A `{ segmented: true, label, options,
value, onSelect }` item is a `.menu-h` head over one full-width `.seg` (role group of `menuitemradio`): ←/→ move inside
it, ↑/↓ move on, and a pick keeps the menu open. The View menus (Runs, Chats; `viewMenuItems`, 256px) use it for Sort by
and Group by. The run page's View PR ▾ is built with it. The sidebar flyouts (`.nav-fly`), the
composer pickers (`.ask-pop`) and the split-button menus (`.btn-split-menu`) keep their
own builders and positions and add `.menu` / `.menu-item`; they carry no box or row skin of their own. No hand-built
dropdowns. An item that has a key shows it as its `hint` (the 11px `--ink-2` count slot): the Runs row ⋯ reads `S`, `E`, `⌫`.
The Requirements pages build their header and file menus as `.menu.hd-menu` and place them through their own
`.req-menu` wrapper (the open list floats under its trigger, right-aligned); their danger row (Remove) takes
`--red-ink-strong`, which keeps AA on `--panel` and on the `--red-bg` hover.
### Row button
`.row-btn`: a whole divided-list row that a person opens (a Library folder, a Memory row, a keyed project row): full
width, `--hover` fill and `--r-sm` corner on hover, an inset ring on keyboard focus. Each list keeps its own grid and
padding. A chevron inside a row is a `.btn-icon` quiet button, not a row.
### Cards versus divided rows
Prefer divided rows (`.drows` / `.drow`): rows split by one `--line`, no box per item. A card (`.card`, 8px corner,
24px padding) frames one thing you act on; never a card inside a card (checked). A page list may sit on one card
that holds its `.drows` (`.card.drows`: Marketplace, Providers, Project settings): the card frames the list, the rows
keep their divider, and an empty list draws no card. Each Settings section is one such card (`.card.settings-card`,
760px, centred), and so are the Guardrails and Memory lists. `.drow-wide` puts a wide control
(a textarea, a table, a path row) under its label at full width; `.drow-stack` holds rich block content (a schedule,
a preset, a guardrail) with the same divider and padding.
### Chat cards
In the Chat conversation every card (run, files, applied change, command, run proposal, workflow, stubs) sits on the
text column: `.ask-transcript-col` caps it at `--chat-text-max` (760px) and no card kind sets its own width. No part of
a chat card leaves the text column (checked): a graph well (`.gv-well`: the workflow card's, the Auto card's and the
run card's graph) is exactly as wide as its card and lines up with the card's other content; it is 1px `--line`, a 6px
corner and the canvas fill, and its host fits the graph into it (≤ 1×, down to 0.3×; only a wider graph pans, and it opens at its start edge
with the first node in view, never centred with both ends cut). The well is as tall as the graph at that zoom (220–480px),
set once, so it never jumps on a resize and a shrunk graph never sits in an empty box. The run card's Expand opens the
same live graph in the shared `.wf-pop` overlay (a run-hosts `monitor` host fitted to the box) and never navigates; the
overlay's Open run is the way to the run's Workflow tab. The transcript reserves its
scrollbar gutter on both edges (`scrollbar-gutter:stable both-edges`), so the column, the composer and Jump to latest
share one centre. The dock is opaque from its top edge down after a 32px fade band (`--chat-dock-fade`); Jump to latest
sits in that band, right above the dock, and the transcript's bottom clearance includes it, so nothing reads under
the composer. A row rises in (`data-ask-enter`) only the first time the page shows it, in any chat; the card inside it
never rises on its own. No part of a chat card is a pill; inner corners stay at or under the card's 8px.
### Table
`.table-wrap` > `.table`: 12px / 600 `--ink-2` headers, 13px cells, 8px 12px 8px 0 cell padding, one `--line` under
each row, no outer box. Under 560px it stacks one block per row using each cell's `data-label`; it never scrolls sideways.
### Charts
A chart has a fixed height that does not grow with its width: the Cost and value chart about 260px, the overview
charts (Statistics, Team metrics) about 180px. Axis labels are 11px `--ink-3` and legends 12px `--ink-2` at every
width, so chart text is never drawn in a fixed viewBox that is scaled to the card (that is how a 560 × 240 viewBox
became 461px tall with 20px axis text). Tooltips are 12px. Bars and areas use the status and neutral tokens; blue is
never a bar. Every chart card has a legend; a one-series chart's legend names the series and its total.
### Empty, loading, error
Empty: one `.empty-line` (13px `--ink-2`) plus one quiet action. Loading: `aria-busy="true"` on the list, nothing for
300ms, then one `--ink-2` line (`Loading runs…`); no spinner and no skeleton. Error: `Could not load …` in
`--red-ink-strong`, the reason and `Nothing changed.`, then Try again and a quiet Details; never the raw error.
### Toasts
`notify({ tone, title, detail, action, key })` (`ui/public/feedback.mjs`): ok and info close after 5s, warn and err
stay, never move focus.
The title is at most 6 static words ("Could not open the workflow"). Names, ids and paths go in `detail`; a raw error
goes in `detail` too, never in the title, and behind a Details action when it is long. The one named exception is Add
to group's "Added to Auth rework": the group's name is the title, the item (or "3 runs") the detail (Group picker).
### Modals
`confirmModal({ title, message, confirmLabel, danger })` (`ui/public/app.js`): a destructive confirm names what goes;
only inside a confirm is `.btn-danger` solid red. Footer actions and the head Close are 32px `.btn`; inline field
buttons stay 28px; the card keeps the shared 24px padding (checked by the theme proof's `dialog-sizes`).

Dialog anatomy (`ui/public/dialog-layout.mjs`): a `.viewer-modal` card that can outgrow the window carries `.dlg` and
three direct children. `.dlg-head` holds the hero, title and subtitle (and head actions such as Close); `.dlg-body` is
the only scroller; `.dlg-foot` holds the status line and the action row. Head and foot never scroll away, and a 1px
divider appears only while content sits under them. Static dialogs write the wrappers in their feature's markup part
(`ui/public/FEATURE/*.html`); a JS builder calls `layoutDialog(card, { head, foot })`. Keep the card's 24px padding
(the regions bleed over it). Seams are the body's padding, `--dlg-gap-head` / `--dlg-gap-foot` (default 18px / 14px):
set those, never a margin. Never add a sticky header with negative margins, and keep a nested scroller only for a
bordered box (a list or a preview) that is bounded on purpose. Under 640px of height the head compacts (smaller hero,
tighter gap) but stays. The Marketplace's `.mk-dialog` / `.mk-sheet` follow the same model with their own class names.

Keyboard shortcuts sheet (`ui/public/keys-sheet.mjs`): the one sheet listing the list keys, opened by `?` on a list page
or View › Keyboard shortcuts. A 760px `.card` dialog in the shared anatomy: two columns of divided rows (label left, key
chips right, "or" between alternatives), stacked under 640px, and a foot with a 12px note and Close. Its `kbd.kbd`
chips share the top search's `.tsearch-kbd` rule; there is no second key-chip style. Esc, Close or the backdrop close it
and hand the focus back to the opener.

## Patterns
- Status line: "State · detail", for example "Failed · Review · Review Implementation". No colon forms. In a card head
  the two parts split: the state is the headline and the detail is the line under it (Card head).
- Say each thing once. When a row, chip or route row in the card says a fact, the head does not: the row wins over
  the head. The checks line, the base branch, Watch stopped and where the work is are the route's (Route); a result block never repeats the status line's state word.
- "?" only means Worca is asking. An amber dot without "?" is a PR problem. "!" means failed.
- Labels are 1–3 words. Plain words: never ids (`run:cc3b6fce`), raw timestamps or raw errors in visible text; ids
  belong in a tooltip.
- The feature is "Chat", not "Ask Worca".
- Page header: title, then one short intro sentence (`.page-intro`), then content. A full-bleed editor (Workflows) has
  no page header; the Marketplace's tabs are its header (Marketplace exceptions).
- Stat tiles hold numbers only (time, cost, files changed). A list of chips goes in its own labelled row, for example
  the Cost tags row in the run page's facts block, never stacked inside a tile. The value is sans with tabular figures.
- Run and group pages share one head: the bar (Back, a 28px chevron `Back to Runs`, in every layout; the breadcrumb
  `Runs › Run tags › Run 2` beside it when the list stands beside the page; Run after; on the right the one primary
  action, Stop, ⋯), the title (one line, cut with "…" where the column ends; the cut is CSS only, the stored name is
  whole, its tooltip holds it, and the bar repeats it once the title scrolls away). A run page's title has no kind chip:
  a run in a group has no group row in its facts block, and the breadcrumb names and links its group. A group page's
  title keeps its kind chip (`Feature` / `Chain` / `Group`). Then the card: the status block (the state word as the card's headline with its detail under it, the head buttons at its right,
  centred on the word's line, with the PR control among them; see Card head and PR controls. Beside the stage bar the
  detail names only the step (`Working` / `Refine Plan`); the stage is on the bar), the route ("Where the work is") under a `--line` divider, the facts block (`.rd-kv`: Project, Labels, Cost tags and Group, in that order; 12px
  `--ink-2` labels, 13px values, one row per fact and one place to edit it; a quiet button that leads a value pulls back
  by its padding so its text sits on the value column), then the tiles (`--fs-stat` sans values with tabular figures,
  `--pad-tile` padding). No PR bar, no kept-work, merge-back or Apply box: their actions are head buttons.
  On the group page a live update never moves the card. Once a stage bar has painted, between two runs or before a
  run's stages are known, it keeps its last paint (its edge still) until the next run has a bar. It hides only when a
  run needs you through its PR, or the group fails, stops or ends. This is the group page's one exception to "waiting
  runs have no bar"; list rows and the run page keep that rule.
- The run page's ⋯ holds run-scope actions, the same on the live and saved pages at every level: Away mode (while
  live), Save as preset, Terminal (Ctrl+`), then Report this run and Archive (Restore once archived). Archive asks
  "Archive this run?" and is disabled, with the reason as its tooltip, while a local copy is open or kept work waits.
  The bar never makes an Archive or Report button: a failed run's Report this run is in ⋯ and in the card head.
  ⋯ = this run; ▾ = this pull request.
- Runs navigation: every row opens its own page in the right pane and the list stays. A group row opens the group
  page; the ⌄ only expands. One row is highlighted at a time, the one whose page is open: a collapsed group whose run
  is open shows the lighter `--row-open` fill over its whole row; expanded, only the open run's row is highlighted.
  Rows inside a group draw no dividers; the group keeps its own divider before the next row. After Add to group the
  moved row takes the focus and the same `--row-open` fill for 1.5 s (`.is-landed`, static, so nothing to reduce): the
  one moment two rows are lit.
- Two row levels in the Runs list and the Chats column. A top-level row (a single run, Needs you, a group row) has a
  13px / 500 title over a 12px status line; a group row's title is 600. A row inside a group is one line, 26px (40px on
  touch screens): a 12px / 400 title, then its status at the right (it drops the Working / Starting word its dot says
  and ellipsises first), then its PR chip; no label chips and no Independent tag. A live member's 3px line sits under
  its title; a live member with stages draws the four-section block instead (a 2px bar, one step below the group
  row's 3px line, then the 11px Plan / Build / Review / Ready with its stage bold); its status names no step, only a
  state its dot does not say (needs you, paused). A member dispatched but not started yet (Starting) draws no progress. Its ⋯ stays 28px, centred.
- Search is the top bar's "Search or ask" only. A list filter is chosen there ("Runs labelled hotfix", `label:hotfix`),
  not from a filter button in the list's header. The Marketplace's Browse search is the one exception
  (Marketplace exceptions).
- Phones: one 16px gutter; nothing scrolls sideways at 290px.
- Runs list order: Needs you (most urgent first), Running, Waiting, Recent. Each section is newest dispatch first (a
  run's start, a waiting ticket's creation); a section with no rows is not drawn.
- Day sections (Group by Date, Runs and Chats alike, `runs-list.mjs` `DAY_BUCKETS`): Today · Yesterday · Previous 7
  days · Previous 30 days · Older, by last activity, split at local midnights. Runs puts Upcoming above them, Chats puts
  Pinned. Every day section folds by hand; Older starts folded. A section head in either list is a meta label:
  12px / 600 / `--ink-2`, its count an 11px caption at the line's right end. Both View menus list Group by in one order (Date ·
  Project · Topic (Chats only) · None) with the day sections as Date's title, and the view chip names filters and a
  non-default sort, never the grouping.
- Chats list: the Runs list anatomy in the Chat page's column; the open chat's figures sit once in the conversation
  head as a readout control (`button.chat-head-meter`, 11px mono, like the cost breakdown's `.cost-bd-btn`), not a
  §1.2 button; sections Pinned, then the day sections; Archive is disabled while a chat replies, runs a command or follows a
  live run; an archived chat reads Restore, as a run does; New chat is the one + after the list toggle; a topic group is
  a Runs group row (count, ⌄, members indented 16px, no dividers) placed by its newest chat; its sub line names its
  project or `N projects`; Group by Project files a group spanning projects under Several projects, never No project;
  Group by Topic shows one section per group, then Ungrouped; the group dialog's name field
  uses Smart run naming's Suggested chip only while that flag is on.
- Group picker (Add to group…, the Runs list and the Chats column, `ui/public/group-picker.mjs`): a combobox over one
  listbox. The focus stays in "Find or create a group"; ↑/↓ move the `.is-active` option and wrap, Enter takes it, Esc
  closes and hands the focus back. The order is New group… (the `plus` icon), then Recent (up to 3, this person's last
  used groups) and All groups (the rest, once), under sentence-case `.menu-h` heads. Typing drops the heads and New
  group… and lists the matches, then Create “release notes” unless the text is an existing name. Nothing is highlighted
  on open. The footer names the keys with `.kbd` chips. New group… opens the shared group dialog
  (`ui/public/group-dialog.mjs`, Smart naming in both lists). An add answers "Added to …" with Undo; a run already in a
  group moves, a Shaper slice is skipped and the toast says so.
- Waiting says what it waits for: `Waiting · starts after Complete Design Language Rollout · run 3`,
  `Waiting · starts 14:00`. A group in Needs you leads with the reason: `Run 1 needs you · Checks failing`.
- Question options are divided rows: one --line between rows, no box per option; the picked row takes the --field fill
  and the 6px corner. Recommended is the neutral chip; a confidence is a 12px figure, never a bar.
- "Ask for changes" gives way to the field with Cancel and Send changes; Cancel gives the button back.
- The bar's primary names the waiting card's primary ("Approve 2 runs"), and a click on it is that click.
- A destructive confirm says what goes in plain words ("Stop this run?", "Stop run") and opens on the safe choice.

### Marketplace exceptions
The Marketplace page (`ui/public/marketplace/`, design `docs/superpowers/specs/2026-10-19-marketplace-redesign/`) keeps the
catalogue structure that was approved, drawn with this system's tokens:
- Browse is a tile grid: one bordered `.mk-tile` button per plugin, 270px minimum, 16px padding, no shadow at rest or on
  hover. Every other list on the page stays divided rows, except the Marketplaces tab: one `.card.mk-mkt` per
  marketplace (board 4.1), with 16px 20px padding.
- A page-scoped "Search plugins" field and a facet rail sit beside the grid. Rail rows (`.mk-facet`) are 32px rows with a
  count and `aria-pressed`, the selected one on the `--panel` fill; they are not filter chips.
- No page intro: the tabs (Browse · Installed · Marketplaces, each with a count) are the header.
- Centred empty states: a 56px tile, a 15px title, at most one meta line and one action (or the inline add field).
- Kind colours (`.mk-t-*` on the hue families, glyphs on the `-ink-strong` shades) appear only in a plugin's monogram tile
  and as the rail's small kind dots. The update chip ("Update 0.3.0", "2 updates") is the page's blue status chip.
  Status chips there use `.badge.mk-chip-*` on the `-ink-strong` shades (4.5:1 or more); the global `.badge` tones do not change.

## Do and don't
| Do | Don't | Why |
|---|---|---|
| Divided rows for lists | A rounded box per item | Boxes stack visual weight and read as unfinished |
| One 32px field | 48px full-width grey inputs | Height must match the buttons beside them |
| Tinted selected filter chip | A solid black selected chip | Solid ink is the primary button; a filter is not an action |
| Sentence-case labels | UPPERCASE kickers | They shout and break the type scale |
| A size from the scale (11, 12, 13, 15, 18, 22; 26 on the Chat home hero) | Half sizes (12.5, 13.5) or one-off sizes | Eighteen near-equal sizes read as noise; seven steps read as hierarchy |
| A fixed chart height | A chart that grows with its width | A 461px chart pushes the numbers off the screen and scales its own labels |
| The plus icon | A typed "+" | Glyphs render at the font's whim and are not one icon set |
| Ids in a tooltip | Ids in visible text | People read names, not engine ids |
| Shadows on menus only | Resting shadows | Shadow means "floats above"; at rest it is noise |
| Amber for needs-you | Amber as decoration | Colour must keep one meaning |
