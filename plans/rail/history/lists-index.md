History. Superseded by implementation-prompt.md; do not build from it.

# The Runs list and the Chats column: what dev has, and where it goes in Rail

**Reference only.** These lists are in the prototype so Wave 2 starts from everything dev has; their design is decided in Wave 2 Shaping, not here.

Written before building, from `ui/public/runs-list.mjs`, `chats-column.mjs`, `chats-list.mjs`, `runs-selection.mjs`,
`list-keys.mjs`, `list-dom.mjs`, `group-picker.mjs`, `group-add.mjs`, `chat-group-dialog.mjs`, `keys-sheet.mjs`,
`runs-view-menu.mjs`, app.js's `runsRowMenuItems`, and `docs/ui-levels.md`. The library holds what both lists share
(`list-page.mjs`, `list-parts.mjs`); the pages are `runs/runs-list.js`, `chat/chats-column.js`, with `*-model.js`.

`[x]` built and clicked · `[-]` left out on purpose, with the reason · `[ ]` not done.

## What a list shows

| | Dev | Rail |
|---|---|---|
| [x] | View menu: Show with counts | `Showing [what ▾]`, each choice with its count |
| [x] | Show: All, Needs you, Running, Waiting, Finished, Ready to ship, Archived (Runs) | the same choices |
| [x] | Show: All, Needs you, Archived (Chats) | the same choices, plus Running: C1 makes it a section |
| [x] | View menu: Group by, None, Project, Date (Runs) | `by [state ▾ / project / day]` |
| [x] | Group by, Date, Project, Topic, None (Chats) | `by [state / day / project / topic]`; None is `state`, since C1 orders Needs you, Running, Recent |
| [x] | Started by, on a shared deployment | `started by [everyone ▾]`, only on a shared sign-in |
| [x] | Project filter (dev only groups by it) | `from [all projects ▾]`, the decided sentence |
| [x] | The view chip and its reset × | gone: the sentence says it; each word is changed in its menu |
| [x] | Label filter from search, its chips with × | `labelled [hotfix ▾]`, only while one is chosen; the menu ticks several, `any label` clears; the shell's result lands on it |
| [x] | The view kept per browser | kept in `localStorage`, guarded; without it, for the session |
| [x] | Sort by: Recent, Created, A–Z, Cost (Chats) | the list's ⋯, as choices: an order is not what the list shows |
| [x] | Keyboard shortcuts in the View menu | the list's ⋯, and `?` |
| [x] | Select in the View menu | the list's ⋯ |
| [-] | Sections folding by hand, `Older` starts folded | decided: never fold; a long section shows its newest rows, then `Show N more` |
| [-] | The resizable detail pane of the Runs list | decided: a row opens a full page |
| [x] | `collapsed` per section, `← →` on a section head | gone with folding; `← →` stay for group rows |

## Sections

| | Dev | Rail |
|---|---|---|
| [x] | Needs you, Running, Waiting, Recent | the same, from `R.sectionOf(R.runState(id).word)` |
| [x] | One section per Show filter | one section, named by the choice |
| [x] | One per project, kind chip Git, Folder, No project | one per project, the kind as Chip |
| [x] | Upcoming, Today, Yesterday, Previous 7 days, Previous 30 days, Older | the same, Older shows 3 |
| [x] | Recent paged, `Show older` | `Show N more` opens the rest in place |
| [x] | Chats: Pinned, day sections | Needs you, Running, Recent (C1); pinned chats lead their section, and say Pinned |
| [x] | Chats by topic: one section per group, then Ungrouped | `by topic` |
| [x] | Chats by project: Several projects | one section per project; a group across projects under Several projects |
| [x] | Chats paging with a cursor | the mock has all rows; `Show N more` |

## Rows

| | Dev | Rail |
|---|---|---|
| [x] | Live, History rows | `listRow`: mark from `runState`, opens `#run/<case>` |
| [x] | Scheduled rows: Missed, Starting, Waiting, Queued, Retrying, Scheduled | rows under Waiting, each a real case (Missed and Starting their own, Queued and Retrying on `scheduled`); detail in the meta |
| [x] | Waiting (run after) | `Starts when …` in the meta |
| [x] | Group row: feature, chain, user group | `groupRow`: count, ⌄, members; opens its page at `#run/<case>` |
| [x] | Group open while not finished; the person's ⌄ wins for the session | same |
| [x] | Members: position, one line, own PR word | member rows in the row, position in the title |
| [x] | Group's needs-why line (`Run 1 needs you · Checks failing`) | in the group's meta, from the member's word |
| [x] | PR fix rounds stacked under their run | `roundRows`: the newest round's line, `7 rounds` opens them, 5 then `+n earlier`; each opens its case |
| [x] | A round with no run listed: `… · Round n` | an orphan row |
| [x] | PR chip on a row | the end column: `#959` as text; the row has one target |
| [x] | Time | the end column |
| [x] | Cost on hover | the row's tooltip; group total too |
| [x] | Label chips, +N | the meta line as text, behind `runLabels`: a fact in a row is text |
| [x] | Project on the line when the list spans several | the meta line, not when `by project` |
| [x] | Mock run says so | its state's word |
| [x] | Archived row says Archived | its state's word |
| [x] | Unread (a failed run nobody opened; a reply in a chat) | `listRow`'s unread: bold title and tooltip; opening reads it |
| [x] | Origin logos on chats | `listRow`'s `lead`: `originMark` |
| [x] | Idle chat: kind icon in the dot's place (started, follows, proposed, chat) | `chatKindIcon` on the rail |
| [x] | Chat states: Needs you, Replying, Running a command, Following a run, Idle | `chatState(id)` in the library, beside `runState` |
| [x] | Chat group row: state of its most urgent chat, count, project or `N projects`; no page, the row expands | `groupRow`, the row toggles |
| [x] | Chat line: project, state, cost, time | meta and end |
| [x] | Current chat marked; a folded group holding it is lit lighter | `aria-current`, is-current; `is-holds` |
| [-] | Progress bar on a row, the stage block | the meta says it in words (`Build · task 2 of 4`): progress cells live on the run page, and a bar per row is a second mark. See Questions |
| [-] | One open PR raises one Needs you (dedupe), cost memos, round folding from raw rows, `groupOf` | data rules of the real model, not of a mock: rows arrive folded |

## Actions

| | Dev | Rail |
|---|---|---|
| [x] | Row ⋯ Runs: Select, Stop, Archive or Restore, Delete, Add to group, Remove from group, View PR, Open feature | the same, each with its key as a hint |
| [x] | Eligibility, skip reasons (`run-bulk.mjs`) | the shared `planBulk`, `skipText`; counts and tooltips from them |
| [x] | Row ⋯ Chats: Select, Rename, Pin, Add to group, Remove from group, Archive or Restore, Delete | the same |
| [x] | Group ⋯ Chats: Rename, Ungroup, Archive group, Delete group | the same |
| [x] | Archive blocked while a chat is busy, the reason in the tooltip, a Toast from the key | same |
| [x] | Bulk bar Runs: Stop, Archive, Restore, Delete, Label, Group | `selectionBar`: each with its count, disabled at 0 and says why |
| [x] | Bulk bar Chats: Archive or Restore, Group | same |
| [x] | Stop | ConfirmStrip (`act.confirm`: cannot be taken back) |
| [x] | Archive, Restore, Label, Add to group, Remove, Ungroup, Pin | no confirm, Undo in the Toast |
| [x] | Delete, Delete group | ConfirmStrip, danger; says what goes; the count includes archived chats |
| [x] | Add to group: find or create, Recent (3, per list), All, New group, Create "…", keys | ListEditor single pick; New group opens a Dialog |
| [x] | Toast `Added to …`, Undo restores the selection | same; the moved row takes the focus and lights once |
| [x] | Rename a chat, rename a group, new group | Dialog with a Field |
| [x] | Suggest a group name (`smartRunNaming`) | the Dialog's field starts filled, marked suggested |
| [x] | New chat | `+` in the column's head, ⌥⌘N |
| [x] | Toggle the column; narrow takes the window | the head's Close, ⌘\\; the `Chats` link brings it back |
| [x] | Column width dragged, arrow keys, kept | `sideColumn` with `left`, 360 to 680 (docs/rail/panels.md; dev's 360 to 560 gives way) |
| [-] | Below 1100px an overlay with a scrim | panels.md's three tiers instead |
| [-] | A WS frame refreshes the list, another tab's change | no server in a mock |

## Selecting

| | Dev | Rail |
|---|---|---|
| [x] | ⌘-click, Shift-click, long-press, Space, ⌘A, Esc, ⇧↑ ⇧↓, row's Select | `selection.mjs` |
| [x] | Member rows have boxes | same |
| [x] | A selected group row stands for its members | same, deduped in the plans |
| [x] | While selecting a plain click ticks | `selectionAction` with `selecting` |
| [x] | Unticking the last ends selecting; Select all with mixed | same |
| [x] | Selection survives leaving and coming back | the controller keeps it |

## Keys

| | Dev | Rail |
|---|---|---|
| [x] | ↑ ↓ J K, Enter, `.`, → ←, S, E, Space, ⇧↑ ⇧↓, ⌘A, Esc, `?` | `shortcutAction`, `can` per list |
| [x] | R rename, P pin (Chats) | same |
| [x] | G, ⇧G, ⌫ | same, by level |
| [x] | One Tab stop in the list | the controller's roving stop |
| [x] | Keys sheet | `openShortcutsSheet` with the list's `can` |
| [x] | Chat page: ⌥⌘N, ⌘\\, ⌘⇧L, ⌥↑ ⌥↓ | new `chat` scope in `SHORTCUTS` |
| [x] | A key does exactly what its ⋯ item does | one lookup |

## Levels

| | Dev | Rail |
|---|---|---|
| [x] | Simple: the sentence, selecting, keys, Stop, Archive, View PR, Open feature | same |
| [x] | Advanced: Delete, Add to group, Remove from group, their keys, on Runs | same, and on Chats: decided by the person's brief, dev has them at every level |
| [x] | Label behind `runLabels` | same |
| [x] | Expert: nothing more on these lists | same |

## States

| | Dev | Rail |
|---|---|---|
| [x] | `Loading runs…`, nothing for 300ms first | `listState` |
| [x] | Offline note, `Try again` | `listState` |
| [x] | Could not load, with `Try again` | `listState`, EmptyState's error |
| [x] | Empty, per Show filter | `listState`, the filter's own words; the whole list adds its way on |
| [x] | Rows on screen and a refresh fails: they stay, one Toast | a case of the prototype's corner |

## Questions

- A bar per row is left out (see Rows). Dev's staged row draws one; say if a list must show it.
- Delete and group actions on Chats: dev has them at every level; here Advanced, as the brief says.
- Several labels: dev's `matchesLabels` means any of them; kept.
