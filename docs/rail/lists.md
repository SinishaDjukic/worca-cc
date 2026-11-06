# Lists

| Rule | What | Why | Held by |
|---|---|---|---|
| `list.sentence` | What a list shows is a sentence above it, never a filter button | Narrowed the same way everywhere | by hand |
| `list.sections` | Sections in a fixed order; empty ones not drawn; a long one shows less, never folds | Nothing hides | design-system-components |
| `list.row-one-target` | The whole row opens one target; a fact in it is text | No second links in a row | by hand |
| `list.select` | Selecting works one way in every list that has it | One habit | by hand |

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
