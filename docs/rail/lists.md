# Lists

| Rule | What | Why | Held by |
|---|---|---|---|
| `list.sentence` | What a list shows is a sentence above it, never a filter button | Narrowed the same way everywhere | by hand |
| `list.sections` | Sections in a fixed order; empty ones not drawn; a long one shows less, never folds | Nothing hides | design-system-components |
| `list.row-one-target` | The whole row opens one target; a fact in it is text | No second links in a row | by hand |
| `list.select` | Selecting works one way in every list that has it | One habit | design-system-logic |
| `list.one-code` | Every list's sentence, selecting, keys and states are the library's | A list cannot drift | rail-gate |
| `list.state-source` | A row's state and section come from runState and sectionOf on its real case | A list can never call Paused or Stopped Ready | design-system-logic |
| `list.opens-page` | A row opens a full page; coming back restores the sentence, the scroll and the selection | One way to move | worca-sweep |

**A list page** (Runs, Schedules): the top bar's trail, then the title row with the page's one action at its right
(`New schedule`), then a list. **A list** (runs, updates, files, PRs): divided ListRows on the rail. A row is its state mark on the rail (a status
dot, or a tick box while selecting), a title line, a meta line, its time or figure at the right; the whole row opens
its one target, so a fact in the row is text, never a second link. The row's own actions are a ⋯ at its right end
(the Runs list's row ⋯), the same CompactMenu as on its page. Rows sit in sections in a fixed order (by urgency, or by day), newest first in each; a section with
no rows is not drawn; the page's spec names the sections. A long section is never folded: it shows its newest rows,
then one quiet row, `Show 21 more`, opens the rest in place (Older shows 3). What the list shows is a sentence above it (`Showing [unread ▾] from [all groups ▾]`), not a
filter button; grouping is one more word in it (`by [day ▾]`), each choice in its menu with its count. Every
list (Runs, Chats, Pulse's Vitals and Updates, Schedules) uses this one sentence, so a list is narrowed the same way everywhere. Selecting is only for a list whose rows a person can act on together (Runs, Chats, Pulse's Updates); a list of states that leave by themselves (Pulse's Vitals) has the sentence and no selection. Selecting works the same in every list that has it. You start it from the list's menu
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

**The one code.** `listSentence` draws the sentence for Pulse's Vitals and Updates, the Runs list and the Chats column;
`listController` (`list-page.mjs`) is what a list page does: it draws the list from the rows a page names, and owns its
menus, selecting, keys, `Show N more`, a group's ⌄, the strip, a Dialog and its editor. A page only names its rows, its
sentence and what an action does. A row's end column holds its PR, its time or its count; its labels are text in its meta.

**The sentence's words.** `Showing [what ▾]`, then `started by [everyone ▾]` on a shared sign-in, `from [where ▾]`,
`by [grouping ▾]`, and `labelled [hotfix ▾]` while a label narrows it: the top bar's search sets it (`label:hotfix`), and
that menu's `any label` lifts it. An order is not what a list shows, so Sort is a choice in the list's ⋯, with `Select`
and `Keyboard shortcuts`.

**A group row** (a feature, a chain, a person's group, a chat group): its mark is its most urgent run's or chat's, its
end its count (`2/3`) and ⌄. It is open while it is not finished, and the person's ⌄ wins for the session. A section
never folds; a group's members do, since they are a row's parts. A chat group has no page, so its row folds too. A member
that needs you raises its group into Needs you, and the group's meta says why (`Run 3 needs you · Checks failing`).

**A run's PR fix rounds** stack under it: the newest round's line and `7 rounds`; open, each is a row to its page, 5, then
`+n earlier`. A round whose run has gone lists alone as `… · Round 3`.

**Bulk actions** read the shared table (`planBulk`, `skipText`), so a count is what will happen and its tooltip names
what it skips. Archive, Restore, Label, Add to group and Pin take Undo; Stop and Delete ask in the strip. Delete and the
group actions need Advanced; Label needs `runLabels`.

**States.** `listState`: nothing for 300ms, then `Loading runs…`; offline and could not load with Try again; empty in
the filter's own words, or, with nothing at all, its one way on. Rows on screen stay when a refresh fails, and one Toast says so.

**Chats** are this list in a side column ([panels.md](panels.md)): Needs you first, then Running, then Recent; an idle
chat shows its kind's icon in the dot's place (`chatState`, `CHAT_KINDS`), a chat a chat integration opened wears its logo
(`originMark`). A pinned chat leads its section.
