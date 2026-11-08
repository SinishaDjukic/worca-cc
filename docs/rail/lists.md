# Lists

| Rule | What | Why | Held by |
|---|---|---|---|
| `list.sentence` | What a list shows is a sentence above it, never a filter button | Narrowed the same way everywhere | by hand |
| `list.sections` | Sections in a fixed order; empty ones not drawn; a long one shows less, never folds | Nothing hides | design-system-components |
| `list.fold-keeps-current` | The row you are on never folds behind Show N more; a group that holds it starts open | You never lose your place | worca-sweep |
| `list.row-one-target` | The whole row opens one target; a fact in it is text | No second links in a row | by hand |
| `list.select` | Selecting works one way in every list that has it | One habit | design-system-logic |
| `list.one-code` | A list calls the library for its sentence, selecting, keys and states; rail-gate sees its rows' markup only, the rest is by review | A list cannot drift | rail-gate |
| `list.state-source` | A row's state and section come from runState and sectionOf on its real case | A list can never call Paused or Stopped Ready | design-system-logic |
| `list.opens-page` | A row opens a full page; coming back restores the sentence, the scroll and the selection | One way to move | worca-sweep |
| `list.kind-mark` | A row's mark says what it is and how it stands: the type's icon, a smooth ring by main stage in the state's colour; a question, a problem, a pause or a stop takes the centre; never a dot beside an icon. A row's centre says what a chat started: a Shaper task (each slice its own row), a workflow run, a plain task, a schedule; the type keeps the centre while it works, and only a question or a failure takes it. Every task stays its own row; how far a feature is lives in its card | One thing to read, for every kind of row; a chat says what it started without a level more | design-system-components |
| `list.calm-motion` | One breath per tree, three per list: in a row with work under it only the deepest live thing breathes (a chat running a task: the task), and only the first three live marks of a list breathe (`BREATHE`); the rest hold still, their ring still saying they run. The list controller does it (`calmMarks`), so no page counts | Motion points at the one thing working, not at every row | design-system-components |
| `list.one-end` | A row in the bar is one line: its mark, its title, one thing at its end (git's icon, or its time); the rest (project, labels, state, time) is its tooltip, one fact a line; cost never shows in the bar | Two facts side by side fight for one place | by hand |
| `list.news` | A row whose state changes pulses its mark once, and its title stays bold until you open it; no new symbol | You notice a change without a badge to clear | design-system-components |
| `list.tree` | What hangs under a row (a chat's tasks, a task that waits on another) is a rounded tree, always open | You see what depends on what without opening anything | design-system-components |

**Reference for Wave 2.** The Runs list and Chats below describe the prototype's reference pages, not Wave 1's work: Wave 2 Shaping decides them. A list's sentence, selecting and bulk hold now for what Pulse uses.

**A list page** (Runs, Schedules; reference for Wave 2): the top bar's trail, then the title row with the page's one action at its right
(`New schedule`), then a list. **A list** (runs, updates, files, PRs): divided ListRows on the rail. A row is its state mark on the rail (a status
dot, or a tick box while selecting), a title line, a meta line, its time or figure at the right; the whole row opens
its one target, so a fact in the row is text, never a second link. The row's own actions are a small ⋯ (22px, a 14px mark, centred on its title's line, inside the row) at its right end
(the Runs list's row ⋯), the same CompactMenu as on its page. Rows sit in sections in a fixed order, newest first in each; a section with no rows is not drawn. Every list groups
the same way, from the library (`byPart`, `BY_CHOICES`): **by date by default** (`dateSections`: what waits on you first,
then Today, Yesterday, Previous 7 days, Previous 30 days, Older; what is still to come by its next run: Today, Tomorrow,
This week, Later), then state, project, topic and AI topics where a list has them, always in that order and those words.
A date section folds from its head (a chevron turns) and stays folded for that list; What waits on you never folds. A long
section shows its newest rows, then one quiet row, `Show 21 more`, opens the rest in place (Older shows 3). The row you are on never folds behind it: it stays under the first rows, so a chat that moved (merged, answered) is still where you look (`list.fold-keeps-current`). What the list shows is a sentence above it (`Showing [unread ▾] from [all groups ▾]`), not a
filter button; grouping is one more word in it (`by [day ▾]`), each choice in its menu with its count. Every
list (Runs, Chats, Pulse's Now and Updates, Schedules) uses this one sentence, so a list is narrowed the same way everywhere. Selecting is only for a list whose rows a person can act on together (Runs, Chats, Pulse's Updates); a list of states that leave by themselves (Pulse's Now) has the sentence and no selection. Selecting works the same in every list that has it. You start it from the list's menu
(`Select`), with ⌘ or Ctrl-click, with Shift-click for a range, with Space or ⌘A, or with a long-press on touch.
`Select all` joins the head and the sentence stays. The selection bar (`.runs-bulk`) sits at the list's foot:
`2 selected · Archive 2 · Cancel`. Each action shows how many rows it applies to and is disabled at 0. Cancel or Esc
ends selecting. An action that can be taken back does not confirm and offers Undo in its Toast; one that cannot confirms in the strip.
A list that has selecting calls the library: `selectionAction` and `selectApply` (`selection.mjs`) for what a click, a
long-press or a key means, `selectionBar`, `selectAllBox` and `bindLongPress` (`selection-bar.mjs`) for its parts. On
touch a list shows its marks by default, since state comes first; the tick boxes take the mark's place only while selecting, started by a
long-press or `Select`, and while selecting a tap on a row ticks it instead of opening it. Unticking the last row ends selecting. The keys are in [keyboard.md](keyboard.md).
Empty is EmptyState's one sentence and, when there is one, the way forward as its one quiet action (`No schedules
yet.` · New schedule).

**The one code.** `listSentence` draws the sentence for Pulse's Now and Updates, the Tasks list and the Chat list in the bar;
`listController` (`list-page.mjs`) is what a list page does: it draws the list from the rows a page names, and owns its
menus, selecting, keys, `Show N more`, a group's ⌄, the strip, a Dialog and its editor. A page only names its rows, its
sentence and what an action does. A row's end column holds its PR, its time or its count; its labels are text in its meta.

**The sentence's words.** `Showing [what ▾]`, then `started by [everyone ▾]` on a shared sign-in, `from [where ▾]`,
`by [grouping ▾]`, and `labelled [hotfix ▾]` while a label narrows it: the top bar's search sets it (`label:hotfix`), and
that menu's `any label` lifts it. An order is not what a list shows, so Sort is a choice in the list's ⋯, with `Select`,
`Reset view` (off at the defaults) and `Keyboard shortcuts`.

**A group row** (a feature, a chain, a person's group, a chat group): its mark is its most urgent run's or chat's, its
end its count (`2/3`) and ⌄. It is open while it is not finished, and the person's ⌄ wins for the session. A section
never folds; a group's members do, since they are a row's parts. A chat group has no page, so its row folds too. A member
that needs you raises its group into Needs you, and the group's meta says why (`Run 3 needs you · Checks failing`).

**A run's PR fix rounds** stack under it: the newest round's line and `7 rounds`; open, each is a row to its page, 5, then
`+n earlier`. A round whose run has gone lists alone as `… · Round 3`.

**Bulk actions** read the shared table (`planBulk`, `skipText`), so a count is what will happen and its tooltip names
what it skips. Archive (`act.archive`), Restore, Label, Add to group and Pin take Undo; Stop and Delete ask in the strip. Delete and the
group actions need Advanced; Label needs `runLabels`.

**States.** `listState`: nothing for 300ms, then `Loading runs…`; offline and could not load with Try again; empty in
the filter's own words, or, with nothing at all, its one way on. Rows on screen stay when a refresh fails, and one Toast says so.

**Chats** (reference for Wave 2) are this list in a side column ([panels.md](panels.md)): Needs you first, then Running, then Recent; an idle
chat shows its kind's icon in the dot's place (`chatState`, `CHAT_KINDS`), a chat a chat integration opened wears its logo
(`originMark`). A pinned chat leads its section.
