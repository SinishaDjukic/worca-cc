# Lists

| Rule | What | Why | Held by |
|---|---|---|---|
| `list.bar-model` | Every place's bar is one model, Chat's: the head (W, the place, its +, hide), its sentence and then air, then sections: what needs you first and never folds, empty sections not drawn; a thing that holds things is a tree under its row, folding from its mark, starting folded when healthy; each row one line, kind mark, title, one end; under Needs you that end is one short reason. A place whose bar is ways in (Workflows, Marketplace) or a side menu (Settings, Insights) has no sentence; a section of ways in counts on its rows, not its head. The + is where the place makes things, a menu when there is more than one way (Ask in chat, By hand); an action is never a row | Learn one bar, know them all | design-system-components |
| `list.sentence` | What a list shows is a sentence above it, never a filter button | Narrowed the same way everywhere | by hand |
| `list.reset-view` | Reset view comes from resetViewTool: changed, it says the default in the sentence's own words; at the default it is off and says why | A disabled control's tooltip is its reason, never its action | design-system-components |
| `list.sections` | Sections in a fixed order; empty ones not drawn; a long one shows less, never folds | Nothing hides | design-system-components |
| `list.one-unit` | A section's count, its heading and the sentence's hint count one unit; where a section mixes kinds (a workspace and a project) it counts the unit the place lists, through the section's `count` | "5 need you" means the same 5 everywhere | design-system-components |
| `list.fold-keeps-current` | The row you are on never folds behind Show N more; a group that holds it starts open | You never lose your place | worca-sweep |
| `list.fold-by-mark` | A row with rows under it (a chat's tasks, a group's chats) folds and opens from its mark; its name still opens it | One trigger for folding in every bar, where the eye already is | design-system-components |
| `list.sections-start-folded` | In a bar's list every period but Today starts folded; Needs you never folds, and a period holding the row you are on starts open; a period you open or fold stays so for that list | The bar shows today's work first; the rest is one click away | design-system-components |
| `list.ways-in` | A bar whose items can grow without end (plugins, a catalogue) lists no items: only ways in, each with its count (Updates 12, Installed 40, a shelf, a source); each opens on the page, sorted, six at a time with Show N more. Lists you work through one by one (chats, tasks, schedules) stay lists | A bar stays the same size at ten items or a thousand | by hand |
| `list.row-one-target` | The whole row opens one target; a fact in it is text | No second links in a row | by hand |
| `list.row-more` | A bar row's ⋯ shows on hover and on focus, stays in the tab order with a visible focus, and is simply there on a touch screen; open, its menu stays over the rows after it | Hover is one way in, never the only one | by hand |
| `list.select` | Selecting works one way in every list that has it; a list with no bulk action has no selecting, by any way in. Only Cancel, Esc or a finished action end it: unticking the last row keeps selecting | One habit; nothing vanishes under the pointer | design-system-logic |
| `list.select-bar` | While selecting, one bar stays in sight at the top of the list, however far it scrolls: Select all, how many are selected, Cancel, then the actions, each with how many it applies to; what asks about them (the strip) stays with it. Select all takes a list's rows, a group's row standing for its members; what hangs under a row and is not acted on in bulk has no box | How to act on several, and how to stop, is never below the fold | design-system-components |
| `list.one-code` | A list calls the library for its sentence, selecting, keys and states; rail-gate sees its rows' markup only, the rest is by review | A list cannot drift | rail-gate |
| `list.state-source` | A row's state and section come from runState and sectionOf on its real case | A list can never call Paused or Stopped Ready | design-system-logic |
| `list.opens-page` | A row opens a full page; coming back restores the sentence, the scroll and the selection | One way to move | worca-sweep |
| `list.kind-mark` | A row's mark says what it is and how it stands, and there is one per row (a task's git mark is on its card): the type's icon in a ring in its level's colour (`look.alert-ladder`). A task's glyph shows its state: running play, waiting dots, paused, a question, an approval pencil, ready a check in a ring, finished a plain check with no ring, failed filled "!", stopped square, merged a branch in full ink with no ring; a project or workspace that stopped shows the Warning's "!"; a chat keeps its bubble and a schedule its clock, in the ring's colour; each task under a chat shows its own state, and a Shaper card's own head keeps its type until it needs you. What needs you breathes until you open it (motion.attention); never a dot beside an icon. A plugin's mark is the plug or its service's mark, in one ink. Every task stays its own row; how far a feature is lives in its card | One thing to read, for every kind of row | design-system-components |
| `list.needs-wash` | A row that needs you carries its level's wash across the whole row, one width on every row, with slightly curved ends (`--r-md`), never a feathered edge | It reads as one object, and the column stays straight | design-system-components |
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
section shows its newest rows, then one quiet row, `Show 21 more`, opens the rest in place (Older shows 3), and becomes `Show less`. The row you are on never folds behind it: it stays under the first rows, so a chat that moved (merged, answered) is still where you look (`list.fold-keeps-current`). What the list shows is a sentence above it (`Showing [unread ▾] from [all groups ▾]`), not a
filter button; grouping is one more word in it (`by [day ▾]`), each choice in its menu with its count. Every
list (Runs, Chats, Pulse's Now and Updates, Schedules) uses this one sentence, so a list is narrowed the same way everywhere. Selecting is only for a list whose rows a person can act on together (Runs, Chats, Pulse's Updates); a list of states that leave by themselves (Pulse's Now) has the sentence and no selection. Selecting works the same in every list that has it. You start it from the list's menu
(`Select`), with ⌘ or Ctrl-click, with Shift-click for a range, with Space or ⌘A, or with a long-press on touch.
The sentence stays. The selection bar (`.runs-bulk`, `list.select-bar`) sits under it and sticks to the top of the list while it scrolls:
`Select all · 2 selected · Cancel`, then `Archive 2 · Delete 2`. Each action shows how many rows it applies to and is disabled at 0, its tooltip saying why, so
what cannot apply to this selection cannot be pressed. Cancel or Esc ends selecting, wherever the focus is, and so does an action once it has finished; its Toast says how many it acted on. An action that can be taken back does not confirm and offers Undo in its Toast; one that cannot confirms in the strip.
A list that has selecting calls the library: `selectionAction` and `selectApply` (`selection.mjs`) for what a click, a
long-press or a key means, `selectionBar`, `selectAllBox` and `bindLongPress` (`selection-bar.mjs`) for its parts. On
touch a list shows its marks by default, since state comes first; the tick boxes take the mark's place only while selecting, started by a
long-press or `Select`, and while selecting a tap on a row ticks it instead of opening it. Unticking the last row keeps selecting, at `0 selected`. The keys are in [keyboard.md](keyboard.md).
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
