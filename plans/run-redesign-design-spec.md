# Runs redesign — design spec (draft for review, 2026-10-18)

Design first: this spec and the mock are agreed before any implementation. The Shaper refactor has its own spec and
starts after this design's foundation slice lands. Items marked **(rec.)** are my recommendation for a point the
brief left open — confirm or change them.

## 0. Scope

**In:** the run model (single and group), the Runs list, run cards, run and group pages, progress, status dots, the
buttons and corners app-wide, filters, selection actions (stop, archive, delete), adding a run to a group.

**Out (this spec):** Shaper's flow and cards (own spec), Statistics, Settings, the workflow builder.

**Groups covered (rec.):** Shaper features and "Run after" chains — both exist on `dev` and share the chain code.
Workspace runs stay single runs for now.

## 0a. Principle: Worca's engine, chat and cards (decided 2026-10-18)

The redesign changes how things look and where they appear, not what the engine does. Every step a person acts on is
a **card in the chat**, and the page shows the same card.

- **Reuse, don't add:** the chat card anatomy (`.ask-mcard-*`: head with title and kind chip, body, actions), its
  states (proposed → applied / declined, as the pull-request card in `chat/action-cards.mjs`), `Not now`
  (`.ask-card-not-now`), the run card with the question inline (`chat/run-card.mjs`), `/api/answer`, `runProgress` /
  `chainProgress`, Shaper features as groups (`src/core/shape/features.mjs`).
- **No new engine state** unless a section here says so and names it. Named so far: the release (3.5) and a
  run → group membership record with user-created groups, for Add to group (3.3; decided 2026-10-18), carrying the
  "round of run X" marker (3.6); and a feature's next run merging the base branch first (3.6).
- **Ordinary stays ordinary (decided 2026-10-18):** everything a person does outside Shaper keeps the existing
  approach: every chat message goes to Ask Worca as today (no composer interception, no keyword routing); new card
  behaviour reaches a chat only through Ask Worca's own tools or an explicit button on a card. Shaper's own logic
  (asks, gate, feature, slices, ship) is never broken; anything new for Shaper sits behind the `shapeFirst` flag.
- A card renders the same in the chat thread and on the run or group page. One renderer, no page-only copies.

## 1. Visual language (applies to the whole app)

The brief asks for modern buttons and no rounded corners. That changes Worca's design language, so it is done once,
app-wide, as the first slice — every other screen keeps matching.

### 1.1 Corners (decided 2026-10-19, replaces 4px/2px)

Between today's 4px and Claude Code's rounder look (so Worca sits naturally next to it), never pill buttons:

| Token | Value | Used for |
|---|---|---|
| `--r-xs` | 4px | chips (kind, state, flag), progress bar ends (2px allowed for 4px-high bars) |
| `--r-sm` | 6px | controls: buttons, inputs, selects, segmented controls, menu items, tooltips |
| `--r-md` | 8px | cards, dialogs, popovers, panels, the step card inside a card |
| `--r-lg` | 12px | the chat composer |
| round | 50% / pill | status dots, avatars, switch knobs and switch tracks (the only pills) |

Match Claude Code's shapes, not Anthropic's brand: Worca keeps its own colours, type and logo.

### 1.2 Buttons (rec.)

One component, three sizes, four variants. No pills, no gradients, no lift on hover, no shadow at rest.

| Size | Height | Use |
|---|---|---|
| small | 28px | list rows, card footers, chips' actions |
| medium (default) | 32px | page and dialog actions, toolbars |
| large | 40px | one per view at most (Start run) |

| Variant | Look |
|---|---|
| primary | ink fill, light text, weight 600 |
| secondary | 1px border (`--line-2`), panel fill, weight 500 |
| quiet | no border, ink-2 text; tint on hover |
| danger | red text on a light red fill; solid red only in a confirm dialog |

Hover = a 6–8% ink tint; focus = 2px outline; disabled = 45% opacity. Touch (coarse pointer): 40px minimum.

### 1.3 What "not AI-looking" means here (testable)

- No pill buttons, no pill search fields, no rounded cards over 4px.
- No coloured left-border accent cards; severity is a small chip.
- No gradients, glows or drop shadows on resting elements (shadow only on floating menus/dialogs).
- Lists are rows separated by 1px dividers, never a stack of rounded boxes.
- One primary button per group of actions.
- No all-caps micro-labels with wide letter spacing: section and field labels are sentence case, 12px, weight 600,
  `--ink-2` (decided 2026-10-18).
- No text characters as icons (⌄ ⌃ ⋯ ▾ ✓ × ▷): one stroke icon set, 2px stroke, sized 12–16px with the text.
- Tinted backgrounds only where a person must act: the Needs you row and the question panel; everything else plain.
- No monospace type/kind chips: kind and state chips are the same small sans chip (11px, weight 500, 2px corners);
  monospace only for code, branches, ids and numbers like time and cost.

### 1.4 Dividers

- Between list rows: 1px `--line`, full width of the list, no per-row border or radius.
- Between sections of a list (Needs you / Running / Recent): the section header plus a 1px line.
- Inside cards: between the header area and member rows; between member rows.

## 2. The run model

A **run** is either a **single run** or a **group** (members are runs). Every surface draws both from one rule.

### 2.1 States (identical for single and group)

| State | Dot | Pulses | Status line (single) | Status line (group) | Actions |
|---|---|---|---|---|---|
| Starting | peach | yes | Starting | Run 1 of 3 · starting | Stop |
| Working | peach | yes | Build · step: Implementation | Run 2 of 3 · Build | Pause, Stop |
| Needs you | amber **?** icon (asking) or amber dot (PR) | no | Plan · needs you: 2 questions | Run 3 of 3 · needs you | Answer, Stop |
| Paused | grey | no | Build · paused: usage limit | Run 2 of 3 · paused | Resume, Stop |
| Waiting (scheduled / after another run) | grey ring | no | Waiting · starts 21:00 | Run 2 of 3 · waiting for run 1 | Start now, Cancel |
| Failed | red **!** icon | no | Review · failed: Review Implementation | Run 2 of 3 · failed | Retry, Report |
| Stopped | dark grey | no | Stopped at Build | Stopped at run 2 of 3 | Archive (the server refuses Resume on a stopped run; slice 2 D11) |
| Ready (done, no PR yet) | green | no | Ready to ship | 3 of 3 done · ready to ship | Ship it |
| In review (PR open) | green | no | In review · PR #759 | In review · 3 PRs / 1 PR | Open PR |
| Merged | violet | no | Merged | Merged | Archive |

- A group's state is its **current member's** state; finished groups use the group's own (ready / in review /
  merged). A group with a failed member is "failed" until retried or the member is stopped.
- Pulsing stops under `prefers-reduced-motion`.
- **Action states carry a symbol (decided 2026-10-18):** the two states that need the person — Needs you and
  Failed — show a 12px filled circle with a stroke **?** (amber) or **!** (red) instead of the plain dot, so the
  state never relies on colour alone. Same place, same size on every surface: list rows, group members, chat cards,
  run and group pages, the Add to group picker. The icon has `aria-label` "Needs you" / "Failed". Other states keep
  the plain dot. **"?" only while Worca asks (bundle QA, 2026-10-20):** a question, a plan approval, a gate or a
  recovery. A PR-driven Needs you is the plain amber dot (still `aria-label` "Needs you"), with the chip giving the
  reason. The symbol sits only in the status-dot position (row start, card head, status sheet), never inside text. The
  sidebar's Runs count is the amber number alone, `aria-label` "N need you", and the browser tab title reads
  "(2) Worca".
- **Colours (decided 2026-10-18, common practice):** few and meaningful. Peach = working, amber = needs you,
  red = failed, green = done from Worca's side (ready or in review), violet = merged (GitHub's colour, so people know
  it), grey = paused, stopped, waiting. No blue status; the word and the PR state tell ready from in review.

### 2.1a Pull request state (decided 2026-10-18)

Single runs and the runs inside a group follow the same rule: any run with a pull request shows its PR state; a run
without one shows nothing. Wherever a run's pull request appears (list rows, expanded group runs, cards, the group
page's Runs tab), show the
PR's **state as an icon + word**, not its number; the number is in the tooltip and link ("PR #759 · open on GitHub").
Rows show nothing else about the PR (decided 2026-10-18): no merge order and no merge button in a row — the run
number ("1 ·") already gives the order. Clicking a row opens the run (its card in Chat, the run or group page), where
Merge, Ship it and Open PR live; the row's ⋯ offers Open PR, never Merge. The merge order appears once, on the group
page's ship line: "Merge in order 1 → 2 → 3, or ship as one PR". A user group's runs are independent, so its ship
line reads "Any order, or as one PR when the runs combine" when ready, and "Any order" in review.

| PR state | Icon | Colour |
|---|---|---|
| Draft | pull request, dashed | `--ink-2` |
| Ready (open, waiting for review) | pull request | `--green-ink` |
| Changes requested | pull request | `--amber-ink` |
| Merged | merge | `--violet-ink` |
| Closed (not merged) | pull request, crossed | `--red-ink` |

**CI folds into the same chip (decided 2026-10-18), still one word.** Worca already reads the checks rollup and
mergeability (`src/core/git-info.mjs` `rollupChecks`, tones ok / run / wait / bad / none). The chip shows the most
important of: Merged · Closed · **Conflicts** (red) · **Checks failing** (red) · Changes requested · **Checks running**
(grey) · Draft · Ready. Passing checks add nothing ("Ready"). Checks failing or Conflicts make the run **Needs you**
(a plain amber dot), with the action on the run (Fix or Open PR). The icon is the git state (draft, open, merged,
closed / abandoned) and the word the most important problem, so a draft with conflicts shows the dashed draft icon and
"Conflicts". In-row status text never repeats the chip (a merged member reads "Done" beside "Merged"). The tooltip has the detail: "3 of 12 checks failed ·
PR #781". No separate CI icon.

### 2.2 Count

A group always shows its size and progress: **"3 runs · 2 done"** (list row and card), "Run 2 of 3" in the status
line. Ad-hoc members count like the others.

### 2.3 Progress

- **Rule (decided 2026-10-18): a section always means a stage, never a run.** A run's bar — standalone or the
  current run of a group — is drawn in **four sections** (Plan · Build · Review · Ready). A group's bar is **one
  continuous bar** (overall progress) on every surface. So a standalone run and a run inside a group look the same;
  a group only adds its continuous bar above.
- **Colour (decided 2026-10-18): colour means state, and only on the dot and the status word.** Every bar is
  neutral. A run's four sections are **steps of one ink, darker by stage** (decided 2026-10-18): Plan 40% · Build
  60% · Review 80% · Ready 100% of `--ink` mixed into `--line-2` (dark mode: dim to bright); upcoming sections are
  `--line-2`; the current stage's label under the bar is bold. No hue per stage and no smooth gradient (a partial
  section is a hard stop). The group's continuous bar is `--ink-2`. A needs-you run and a working run in the same stage have identical bars; the dot, the
  word ("Plan · needs you") and the Needs you row wash tell them apart. The group bar is neutral too.
- **Sub-steps are not drawn in the bar** (decided 2026-10-18): the step is text where there is room ("Build · step:
  Implementation" on the card and page), the full step list is the bar's hover popover on the page, and the Workflow
  tab has the graph. The list shows the stage only.
- **Single run:** one bar in four stages — Plan · Build · Review · Ready. Fills only on real events, never on time,
  never backwards. A begun stage shows a start share (10% of its quarter). The working fill's edge pulses.
  The status line names the stage and, on the page and card only, the step: "Build · step: Implementation"; a step
  named like its stage reads only the stage ("Plan").
- **Group:** two bars:
  1. **Group bar** — continuous; overall = (finished members + the current member's own fill) ÷ members, with the
     planning run counted as a member for a Shaper feature (decided 2026-10-18). It is listed as **Planning** with no
     number; the runs it planned keep Shaper's slice numbers 1, 2, 3 (no "0"). The count shows the planned runs
     ("2/3"); the bar includes planning.
  2. **Current run bar** — directly under it: the current member's bar in four sections with its stage marks.
- **Runs list row:** every **live run row** (working, needs you, paused, failed) — standalone or the current run of a
  group — has the **same block**: status line ("Plan · needs you"), the four-section bar, and the Plan · Build ·
  Review · Ready labels under it with the current stage bold (decided 2026-10-18). No status repeated on the right.
  A group row's bar is continuous. Finished and waiting runs have no bar. Same math on every surface.

### 2.4 Cost and time (decided 2026-10-18)

- **A group's total is everything spent on the work:** planning run, every run, rounds, follow-ups, re-plan runs, and
  failed or stopped attempts. Time is active time, summed the same way.
- **Shown once per surface:** group card and group page "3 runs · 2h 40m · $96.10"; a run's card and page its own;
  the Runs list shows a run's cost on its row and a group's total in the group row's tooltip.
- **Estimate vs actual** where Shaper estimated (existing `estimate.mjs`): the Split step card shows the estimate;
  the group page reads "$96.10 of ~$80 estimated". The Ship card's body includes the total.
- **Live and monotonic:** updates while runs run; never decreases.
- **One number everywhere:** the group page, the Ship card and Statistics filtered by the group (or its tag) agree;
  a test asserts it on a recorded feature.

## 3. Surfaces

### 3.1 Runs list

- **Header:** "Runs" · **View ▾** · select-all checkbox. No filter row, no search field or icon, no Select button.
- **Search** (decided 2026-10-18): only the top bar's "Search or ask" (⌘K). It already finds runs by title; it learns
  to match their **tags** (`client:acme`, `client:`, `acme`) and shows tag matches in the Runs group of its results.
- **View menu** (decided 2026-10-18: the filter lives in View, not as tabs):
  - *Show* (one choice, with counts): **All · Needs you · Running · Finished · Archived**.
  - *Group by:* **None · Project · Date**.
  - A non-default view shows a chip under the header ("Running ×", "2 of 41 runs"); × resets to All. The choice is
    remembered per browser.
- **Sections** under All: Needs you, Running, Recent (Show older). Each run appears once.
- **Say each thing once** (decided 2026-10-18):
  - Count: a compact **"2/3"** (runs done of total) on the right of a group's title; no "Run 3 of 3", no "3 runs · 2
    done".
  - Status line = **where it is** only: "Run 3 · Plan" (group), "Plan" / "Build" (single). The state is not repeated
    where the section (Needs you, Running), the dot and the tint already say it; in mixed sections (Recent) the state
    word leads: "Merged · Fri", "Failed at Review · Fri", "Waiting · starts 03:00".
  - Project: shown only when the listed runs span more than one project; never when grouped by project.
- **Row (single):** dot · title · status line · stage block if live · ⋯.
- **Row (group):** dot · title + "2/3" · status line · one continuous overall bar · ⌄ to expand; expanded members are
  indented rows of the same pattern with their PR and merge order. The **current member** (working, needs you,
  paused, failed) also shows its own stage line ("Plan · needs you") and its four-stage bar with Plan · Build ·
  Review · Ready marks under its row (decided 2026-10-18), so the list carries both levels like the card and page.
- Dividers between rows (1.4).

### 3.2 Selection actions

- **Selection without hover (decided 2026-10-19, replaces the 2026-10-18 hover rule):** rows never show a checkbox on
  hover. Selection starts with ⌘-click (Ctrl-click) on a row, Shift-click for a range, a long-press on touch, or
  **Select** in the View menu and in a row's ⋯. In selection mode every row shows its checkbox in place of the status
  dot, the header shows "☐ Select all" (indeterminate when some are), and the bottom bar appears; Esc or Cancel ends it.
  Outside selection mode the header is only "Runs · View ▾" (no bare checkbox). A group's checkbox selects the group.
- A bar at the bottom: **"N selected · Stop · Archive · Delete · Cancel"**; each action shows how many it applies to
  and names the ones it skips.
- **Stop:** live and paused runs; stopping a group stops its running member and **cancels its waiting (scheduled)
  members** (decided 2026-10-18: a group stops everything). One confirm: "Stop 4 runs? 2 waiting runs are
  cancelled."
- **Archive:** finished runs (ready, in review, merged, stopped, failed). Live runs are skipped and named.
- **Delete (permanent):** straight from the list (decided 2026-10-18), any finished, stopped or waiting run; live
  runs are skipped and named ("stop them first"). Deletes the run record, its files and local branch; **keeps** remote branches, PRs and the cost in Statistics
  (anonymised to "deleted run"). Confirm names the count; no undo.
- Same actions in each row's ⋯ for one run.

### 3.3 Add a run to a group (rec.)

- Row ⋯ → **Add to group…** → pick a group (search by name) or **New group**.
- The run joins as the last member; it counts in the group's size and progress; its PR is listed with merge order
  "independent" (it was not built on the group's branches). It can be removed again (⋯ → Remove from group).
- A run can be in one group at a time. Live runs can be added.

### 3.3a One status-line pattern (decided 2026-10-18)

`<state> · <where> · <detail>` — e.g. "Needs you · Run 3 · Plan", "Running · Build · step: Implementation",
"Failed · Review · Review Implementation", "In review · pull request ready". The state word is dropped only where a
section heading already says it (the Runs list's Needs you and Running). The count is always "2/3" (runs done of
total; the planning run is not counted). A run with a PR shows the PR state instead of a separate state column.

**Alignment (checked by measuring the rendered mock):** in the Runs list every bar and every right-hand item (count,
PR state) ends at one column just before the ⋯ / ⌄ column; runs inside a group use the same columns as top-level
rows; right-hand items are vertically centred on the title line. On the group page, title, status card, tabs and the
Runs table share left and right edges, and the Status column and Open buttons line up on every row. The layout test
suite checks these.

### 3.4 Run card (chat) and run page

- **Card:** title · kind chip (`Run` / `Feature · 3 runs` / `Chain · 2 runs`) · status line · progress (2.3) ·
  the question inline when it needs you · footer actions from 2.1.
- **Page:** same layout for single and group: header actions · title + kind · meta · status card (dot, state,
  status line, progress, the question inline, time and cost) · tabs. Group tabs: **Runs** (members, as rows) ·
  Overview · Decisions · Logs. Single tabs as today.
- Today's Feature page becomes the group page (its URL keeps working) (rec.).
- **Run table on the group page (decided 2026-10-19):** the same row order as the Runs list — what it is → state →
  facts → go. Left: dot, title, and the status line under it ("Ready to ship", "Needs you · Plan"). Right, right-aligned
  fixed columns: PR chip · cost (tabular numbers) · "›". Header "Run · PR · Cost". The whole row opens the run; no
  per-row Open button; state never sits in a middle column.

### 3.5 Ship a group (card, decided 2026-10-18)

Built on Shaper's existing Ship as (`featureView().ship`, `featureShipSuggestion`, `recordShip`, `recordSliceDraft`).

- **Before every run is done:** no buttons. The group page shows one line: "Ship card comes when all N runs are done,
  here and in the chat." No early choice (the engine has none).
- **Ready:** a **Ship** card in the group's thread and on the group page. Body: `N runs · files · +added −deleted`, then
  the existing reason ("This feature adds 1,186 lines: one PR is easier to review."). Actions: `Not now` · `Stacked
  PRs` · `Ship as one PR`; the suggested mode is the primary, one click ships (as today, no radios, no Cancel).
  Superseded by the one ship flow (`docs/design-system.md`, "PR controls"): the card's buttons are replaced by one
  Create PR that opens the Create PR dialog, where One / N stacked is picked.
- **After:** the card turns applied: "Shipped as one PR", `View pull request`, and the closed drafts.
- **Release (new, optional):** collapsed to `+ Add a release`. Expanded: `Release v1.12.0 · draft after merge · Edit`,
  with the source under it ("After tag v1.11.0 · minor · notes from the N runs"). Version from the last git tag, else
  `package.json`, else typed. It creates a **draft** GitHub release after the merge; nothing else is published.
  A single run gets the same row in its Ship it dialog.
- **Single run:** its page's Group row reads "Part of <group> · run 3 of 3", or `Add to group…` when it has none.

### 3.6 Changes, ideas and hotfixes (decided 2026-10-18)

From the customer's side, iterating is **one action: say it in the chat**. Worca keeps it the same work where it is,
and never asks the person to manage branches, PRs or chains.

- **Ask for changes** (field on a finished run's card, its page, the PR card and the Ship card; or simply replying
  in the thread):

  | State | What happens |
  |---|---|
  | Run done, PR not merged | **Round 2** of the same run: same branch, same PR (`sourceBranch` + `sameAsSource`) |
  | Feature with runs still to go | into the next run's plan; Re-plan the rest if it changes the split |
  | Feature done, not shipped | a round on the last run's branch, before Ship |
  | Already merged | a follow-up run from `dev`, added to the same group as "Run 4 · follow-up", own PR |

- **Rounds:** shown as rounds of the same run, never as new rows: status line `Running · Round 2 · Build`; the card's
  log and the run page's Rounds list keep each round's diff, cost and the request that started it. The one new piece
  of state: a "round of run X" marker on the follow-up (in the group membership record, 0a).
- **Mid-feature idea or hotfix:** a message in any thread (or in the feature's thread) that is not an answer to an
  open step gets a **Where does this go?** card: `Add to <feature>` (next run's plan, or an extra run in the group) ·
  `Own run now` (starts from `dev` at once, runs alongside, own PR) · `Save for later` (kept on the feature, shown at
  its next checkpoint). Worca preselects its guess and says why in one line ("touches the Runs list, which run 3
  changes").
- **Hotfix landing under a running feature:** when `dev` moves under a feature, its card says
  `dev moved · run 3 starts from it` and the next run starts from the updated base, so a clash shows at that run, not
  at Ship. (New engine behaviour: the next run of a feature merges the base branch first; named here per 0a.)
- **New scope** is not a change: the proposal card says so and offers a new run or feature instead.

### 3.6a Watch PR: fixes are rounds (decided 2026-10-18)

Watch PR (on `dev` since #773) starts fix runs for failing checks, review comments, changes requested and conflicts.
They follow the same rules as everything else here; #773's separate "PR fix run" chat card becomes a round.

- **A fix run is a round of the run whose PR it fixes** (§3.6): same row, same card, same page. Status line
  (§3.3a): `Running · Round 2 · fix failing checks` (the trigger words are #773's `fixTrigger` labels, lower case:
  fix failing checks, fix review comments, address changes requested, resolve conflicts, merge dev in). The dot is
  Working (peach, pulsing); no new state.
- **PR chip while watching (§2.1a, still one word):** `Fixing` (grey) while a fix run is live, instead of
  `Checks failing`, and the run is **not** Needs you: Worca is on it. When no fix run is live, the chip shows the PR
  state as usual.
- **Outcome on the round's log line, never a new card:** `Round 2 · fix failing checks · pushed a1b2c3d`;
  `Round 2 · nothing pushed: conflict markers left`; the watch giving up (3 fix runs, or a person needed) makes the
  run **Needs you (?)** with the status line `Needs you · Watch stopped · 3 fix runs, checks still failing` and the
  actions `Open PR` · `Ask for changes`.
- **Watching itself:** shown once, as the detail of the PR's tooltip ("PR #781 · watched"); the on/off switch stays
  in the run page's ⋯ (as #773). No watch line on cards when nothing is happening.
- **Chats:** the chat that opened the PR keeps the run's card; rounds report into it (the same rule as later runs of
  a feature). #773's per-fix-run card and watch line are replaced by this; its `fixTrigger` / `fixOutcome` and
  `findPullRequestCards` stay as the data source.
- Tests: a fix run renders as Round n in the list row, the chat card and the page with the same status line; the
  chip reads `Fixing` and the run is not Needs you during it; the give-up renders Needs you with the reason; no
  second card is posted to the chat.

## 4. Accessibility, levels, devices

- Dots never carry meaning alone: the state word is always next to or in the row text.
- Contrast 4.5:1 for text (verify:theme), 3:1 for dots against the row.
- UI levels: Select, Stop, Archive at every level; Delete and Add to group from Advanced (rec.).
- Phone: filters scroll horizontally; the bulk bar stacks; rows keep dot · title · ⋯.
- Light and dark both checked.

## 5. Acceptance (design)

1. Every radius in `style.css` is a token from 1.1 (test).
2. **One button style across all of Worca** (decided 2026-10-18): a browser test walks every view (Chat, Runs, run
   and group pages, New run, Schedules, Statistics, Workflows, Marketplace, Connectors, Providers, Models, Projects,
   Workspaces, Team, Settings tabs, dialogs) and fails on any button that is not one of the 3 sizes and 4 variants of
   1.2 — including today's pills and one-off button classes (`.btn-go`, `.btn-ghost`, `.rd-cta`, `.ask-card-start`,
   …), which are folded into the one component.
3. The same run state produces the same dot, word, status line and actions in the list row, the card and the page
   (one-model test over the table in 2.1).
4. Group progress = parts + current run bar on the card and page; parts bar in the list (replay test).
5. Search field gone; ⌘K finds runs by tag.
6. Select → Stop/Archive/Delete behave as 3.2, including group stop cancelling waiting members (API + UI tests).
7. Add to group / Remove from group update size, count and progress (tests).
8. Before/after screenshots of the Runs list, a run page, a group page and the chat card, light and dark, desktop
   and phone.

## 5a. Customer perspective (added 2026-10-18)

1. **Nothing of theirs breaks on upgrade:** existing runs, features, chains, archived runs and schedules show in the
   new model; old links (`#feature/:id`, run links in chat history) open the new pages; runs live during the upgrade
   keep going. Test: a DB snapshot from `dev` with features, chains and archived runs renders without loss.
2. **Empty, loading, offline and error states** for the list, cards and pages (no runs yet; server unreachable, using
   the existing auto-resume when the network returns; a failed action says what failed and what to do).
3. **Safe destructive actions:** Delete is permanent, so its confirm names what goes and what stays; Archive and Stop
   show a short "Undo" where the engine can undo (archive: yes; stop: no, say so).
4. **Keyboard:** select with Space, select all with ⌘A in the list, Esc clears; the open step card's primary button is
   reachable with Tab in order; ⌘K finds runs by title and tag.
5. **Notifications agree with the UI:** a browser alert or tab badge for Needs you uses the same status line and opens
   the same card.
6. **Cost and time stay visible** on cards and pages (group total and per run), as today.
7. **Wording is the same everywhere:** the status line words are the same in the UI, the CLI's run status output and
   Ask Worca's answers about a run.
8. **Large lists stay fast:** 300 runs with 20 groups scroll and update without jank (layout suite timing check).
9. **Tell people what changed:** a changelog entry with before/after screenshots and a one-time "What's new" note on
   the Runs list, dismissible.

## Known UI/UX bugs to not repeat (from the 17 Oct work, all reproduced on real runs)

Each needs a test that fails on it, in the suite named:

1. **"Plan · Plan":** a step named like its stage repeated the stage (status-line unit tests, real built-in workflows).
2. **Bar stuck on Plan while the run was in Build:** a step was mapped to the wrong stage (progress tests on every
   built-in workflow's step list).
3. **Bar moving on time or backwards** (replay tests: fill never decreases frame to frame).
4. **Buttons too big and of mixed sizes**, worst in Shaper (one-button-style scan across every view).
5. **Right-hand items not aligned:** bars, PR chips and actions ended at different edges (layout suite measures the
   right edge of every row's last column).
6. **Runs started by Shaper not grouped** in the list (#770) (list grouping test from a real feature fixture).
7. **A plan or cycle gate that could not be approved from the UI** (answer path test from every host: chat card,
   run page, group page).
8. **Popover placed off-screen** (layout suite at 375px and 1440px).
9. **The same fact said twice** (status in the line and again on the right; count in two places) (one-model tests
   assert each fact appears once per surface).
10. **Old rules coming back after a merge** (scan test for removed selectors and layouts).
11. **A server restart stopped a live run instead of pausing it** (restart test: stop and start the server, the run
    is paused and resumes).

**Quality bar:** every visible change ships with a test that shows it on real data (built-in workflows, recorded
run states), not only on hand-made objects. The UX perspective's manual web check runs on the branch before review.

## 6. Decisions (2026-10-18, were open points)

1. Corners: 4px on controls and cards, 2px on chips. Not fully square.
2. Delete: straight from the list, with one confirm. No Archived step first.
3. Stopping a group stops everything: the running run stops, waiting runs are cancelled.
4. Planning counts in a Shaper group's bar, listed as "Planning" with no number; runs are numbered from 1.
5. Status colours: no blue; green for ready and in review, violet for merged (2.1).
6. Release: a draft GitHub release only (no npm or Docker). Offered on the group's Ship card and on a single run's
   Ship it dialog, same `+ Add a release` row.

## 7. Follow-ups after dispatch (2026-10-18)

- **§2.1a CI in the PR chip** was decided after the Runs redesign feature started; same route as cost below.
- **§2.4 Cost and time** was decided after the Runs redesign feature started, under Away mode (no plan checkpoint).
  It ships as a follow-up round on that feature after its 5 runs, via Ask for changes (§3.6) — or earlier if a later
  plan stop is answered by a person.
- **Chains are groups, flag or not (bug from dev, reported 2026-10-18):** a "Run after" chain lists its members like
  any group (the waiting ones as `Waiting · starts after run 1`), open by default in Needs you / Running, and nothing
  about it depends on the Shaper flag. Today (`dev`, since 123e4e25 / 77334fa0) a plain chain folds its scheduled
  runs into one row that starts collapsed, and only a feature chain opens, only with `shapeFirst` on, so with the
  flag off scheduled runs look gone. Test: a chain of 3 scheduled runs shows all 3 with `shapeFirst` off and on.
- **§3.6a Watch PR as rounds** was decided after dispatch: goes into run 4 (cards and pages) at its plan stop; run 3
  gets the chain-visibility fix, CI in the PR chip and the cost total.
- **Bundle wiring:** run 4 draws "Ask for changes" on the Watch-stopped card disabled ("not available yet") because the
  changes path lives in the Shaper feature; enable it to call that path when both are merged in the bundle.

## 8. Oct 19 additions (board N)

In the bundle:
- Chat card member rows use the group page's table row (one renderer): title in ink over the status line, PR chip, cost, › on hover; cost drops under 480px card width.
- One wording per state, always "State · detail" ("Paused · interrupted", "Plan · needs you · approve the plan", "Build · step · Implementation"). No colon forms. The group page head keeps "Run 5 of 5 · paused".
- Run page head: "Save as preset" (was "Save setup as preset"); "Add tags" is a quiet button like "Add to group…".
- Keep awake: beta flag, on by default locally, its own section in Settings › Runs right after Away mode, Beta chip in the label.

Landing now (runs in progress):
- PR chip absorbs #784's states: Draft, Closed, Abandoned (Azure DevOps); a workspace run shows its most urgent member PR plus a count ("Conflicts · 3 PRs"). No separate PR glyph. Conflicts and Checks failing win over Draft; a workspace run with a conflicting member PR is Needs you.
- Pinned workflows on the Chat home: any workflow can be pinned (⋯ › Pin to Chat home); Shaper is a default pin, not hard-coded; a pinned tile arms the composer with that workflow; extra pins go into More.
- Stacked PR base for every chain: a run started from a previous run's branch proposes that branch as its PR base until the previous PR merges, Shaper or not. The "one PR or stacked PRs" ship choice stays Shaper's until the generic workflow-card decision.
