# Lists

| Rule | What | Why | Held by |
|---|---|---|---|
| `list.bar-model` | Every place's bar is one model: its head, its one filter line, then sections; each row is a kind mark, a title and one end | Learn one bar, know them all | design-system-components |
| `list.bar-head` | A bar's head is the W, the place button (`nav.place-button`), a + only where the place makes things by hand (Chat's New chat, Workflows, Projects, Marketplace), and Hide the bar. Tasks and Schedules have no + (`stillhet.chat-first`), and an action is never a row | The head says where you are and what the place can make, nothing else | design-system-shell-redesign |
| `list.bar-tree` | A thing that holds things is a tree under its row, starting folded when healthy; each thing under it is one line (`list.child-row`) | What depends on what is seen without leaving the bar | design-system-components |
| `list.filters` | What a list shows is set on one FilterRow of about 32px: small text tabs with counts for its few fixed views, then on a page pickers with the label inside (Order: Most urgent), in a bar a chip for each filter off its default and one Filter control holding every part; its `end` slot holds the page's small tools (Figures). Never a label row above it, never two rows (from classic's tabs and dropdown filters) | Narrowed the same way everywhere, on one line that is scanned, not read | design-system-shell-redesign |
| `list.filters-narrow` | In a bar under 340px the Filter control is its icon and two tabs show; while a chip shows, only the current tab stays | A chip is never cut to a letter | by hand |
| `list.narrowed-visit` | A filter set by a link narrows the list for that visit only and is never stored: a NarrowedLine under the filters says `Narrowed to web-app` with Clear; leaving the place or Clear restores your view, and picking a filter yourself makes it yours | A link can show you a part without changing how your list is set | design-system-shell-redesign |
| `list.sentence-person` | The filter's Of picker lists people under the header person only when the numbers come from 2 or more; ticking people narrows every number on the page to what they started | Your own numbers and a colleague's read the same way, without a second page | stillhet-insights-model |
| `list.sentence-scope` | On a team's page the Of picker lists the teams that share their numbers under the header team, only when 2 or more do; it is a single choice and the page names it (the billing-api team) | You see one team's numbers at a time and always know whose | stillhet-insights-host-1 |
| `list.reset-view` | Reset view comes from resetViewTool: changed, it names the default it returns to; at the default it is off and says why | A disabled control's tooltip is its reason, never its action | design-system-components |
| `list.sections` | Sections come in a fixed order; an empty one is not drawn; a long one shows less behind Show N more, and never folds away what needs you | Nothing hides | design-system-components |
| `list.one-unit` | A section's count, its heading and a tab's count count one unit; where a section mixes kinds it counts the unit the place lists, through the section's `count` | "5 need you" means the same 5 everywhere | design-system-components |
| `list.fold-keeps-current` | The row you are on never folds behind Show N more; a group that holds it starts open | You never lose your place | worca-sweep |
| `list.fold-by-mark` | A row with rows under it (a chat's tasks, a group's chats) folds and opens from its mark; its name still opens it | One trigger for folding in every bar, where the eye already is | design-system-components |
| `list.sections-start-folded` | In a bar's list every period but Today starts folded; Needs you never folds, a period holding the row you are on starts open, and a period you open or fold stays so for that list | The bar shows today's work first; the rest is one click away | design-system-components |
| `list.ways-in` | A bar whose items can grow without end (plugins, a catalogue) lists only ways in, each with its count; each opens on the page, six at a time with Show N more. Lists you work through one by one (chats, tasks, schedules) stay lists | A bar stays the same size at ten items or a thousand | by hand |
| `list.row-one-target` | The whole row highlights on hover and a click opens its default action, the thing's own page; a fact in it is text (from classic's rows that open on click) | You click what you see, and there are no second links in a row | design-system-shell-redesign |
| `list.row-opens-in-place` | A figure row that has something to open is a button with a chevron and may open its detail in place, one at a time, full width under the row with a head and Hide; a row with nothing to open is plain text that says why | A person's own work is read where the person is, and nothing looks pressable that is not | design-system-components |
| `list.row-facts` | A bar row says what it is without a tooltip, on two lines: its title, then a quiet `project · state` (for a row that needs you, why), with its time at the end; a tooltip shows only when the title is cut, and cost never shows in the bar. A row under another row is one line instead (`list.child-row`) | Three rows with the same title can be told apart at a glance | by hand |
| `list.row-mark` | A round state mark is centred against a row or card of two lines | The mark belongs to the whole row, not to its first line | by hand |
| `list.row-more` | A row's ⋯ holds its full list of actions in a target of at least 28px: visible at rest on a list page; in a bar on hover, on focus, on touch and always on the current row. Its menu floats over the rows after it, and the keyboard reaches it from its row (`keys.list-stops`) | Hover is one way in, never the only one | by hand |
| `list.named-list` | A list is `role=list` with a name and its rows are list items; a bar's list is a named region | A screen reader says which list it is in and how long it is | design-system-shell-redesign |
| `list.select` | Selecting works one way in every list that has it; a list with no bulk action has no selecting. Only Cancel, Esc or a finished action end it: unticking the last row keeps selecting | One habit; nothing vanishes under the pointer | design-system-logic |
| `list.select-bar` | While selecting, one bar sticks to the top of the list: Select all, how many are selected, Cancel, then the actions, each with how many it applies to and off at 0 with its reason | How to act on several, and how to stop, is never below the fold | design-system-components |
| `list.select-unit` | Selected and the actions count one unit: a row that stands for several says so through the spec's `count`, and what hangs under a row and is not acted on in bulk has no box | A count is what will happen | design-system-components |
| `list.one-code` | A list calls the library for its filters (FilterRow), selecting, keys and states, and `listController` draws it from the rows a page names | A list cannot drift | stillhet-library-gate |
| `list.state-source` | A row's state and section come from runState and sectionOf on its real case | A list can never call Paused or Stopped Ready | design-system-logic |
| `list.opens-page` | A row opens a full page, and the bar stays where it was: its filters, its scroll and its selection, with the row you are on marked | One way to move, and the list is still there when you look back | worca-sweep |
| `list.kind-mark` | A row has one mark that says what it is and how it stands: the type's icon in a ring in its level's colour (`look.alert-ladder`), never a dot beside an icon; the glyphs are the table below | One thing to read, for every kind of row | design-system-components |
| `list.needs-wash` | A row that needs you carries its level's wash across the whole row, with the row's own corners (`--r-sm`) and a soft fade at each side; Caution's wash is lighter than Warning's | It reads as one object, and the column stays straight | stillhet-css-fit |
| `list.calm-motion` | One breath per tree, three per list: in a row with work under it only the deepest live thing breathes, and only the first three live marks of a list (`calmMarks`); the rest hold still | Motion points at the one thing working, not at every row | design-system-components |
| `list.bar-row-size` | A bar row's rail is 28px on a fine pointer and 40px on touch, its end on the title's line; an unread row leads its title with a 6px dot in Advisory's ink | Every bar reads at one rhythm, and a finger still gets its target | stillhet-css-fit |
| `list.news` | A chat with something you have not seen carries a small light dot on its icon, also on Chat in the place menu; it clears when the chat is opened. A row whose state changes pulses its mark once | You notice news without a badge to clear | design-system-components |
| `list.tree` | What hangs under a row (a chat's tasks, a task that waits on another) is a rounded tree: at every level an elbow runs from the bottom of the parent's mark to the child's mark, with no gap, and no line runs past the last child | You see what depends on what | design-system-components |
| `list.child-row` | A row under another row (a chat's task, schedule or slice; a feature's task) is one line: its title, cut with an ellipsis, and at its end one word in the secondary style that its mark cannot say (`rowEndWord`: Failed, Asks, Approve, Ready, Merge, the stage of a working task such as Build, `after it` for one that waits on the task before it, a schedule's time). Never a phrase. The detail a second line would hold is the row's tooltip, with the full title, and stays in the name a screen reader hears. A row with nothing to say at its end keeps its two lines | The bar stays short and even, and the word is always in the same place | design-system-logic |
| `list.group-row` | A group row (a feature, a chain, a chat group) wears its most urgent member's mark and ends in its count (2/3) and a fold; a member that needs you raises the group into Needs you, and its second line says why | A group reads as one row until something in it wants you | design-system-components |
| `list.chat-row` | An idle chat shows its kind's icon as its mark (`chatState`, `CHAT_KINDS`), a chat that a chat integration opened wears that service's logo (`originMark`), and a pinned chat leads its section | A chat's row says how it began and whether it works, in one mark | design-system-components |
| `list.bulk` | Bulk actions read the shared table (`planBulk`, `skipText`): a count is what will happen and its tooltip names what it skips; what can be taken back offers Undo in its Toast, what cannot asks in the strip | The same answer for one row and for fifty | design-system-logic |
| `list.states` | A list's states come from `listState`: nothing for 300ms, then loading; offline and could not load with Try again; empty in the filter's own words or, with nothing at all, its one way on. Rows on screen stay when a refresh fails, and one Toast says so | A list never flashes and never reads as empty when it failed | design-system-components |

## A task's mark, by state

| State | Glyph |
|---|---|
| Running | Play, in a ring that breathes (`look.running-sign`) |
| Waiting to start | Three dots |
| Paused | Two bars |
| A question | ? |
| Needs approval (a plan or a gate) | Pencil |
| Ready | A check in a ring |
| Finished | A plain check, no ring |
| Failed | A filled ! |
| Stopped | Square |
| Merged | A branch in full ink, no ring |

A chat keeps its bubble and a schedule its clock, in the ring's colour; a project or workspace that stopped shows the
Warning's !. A plugin's mark is the plug or its service's mark in one ink, and its word is Update available, Needs
set-up, Installed or Not installed.

## Grouping, in this order and these words

From the library (`byPart`, `BY_CHOICES`, `dateSections`): by date by default, then state, project, topic and AI topics
where a list has them.

| By date | Sections |
|---|---|
| What has happened | Needs you (never folds), Today, Yesterday, Previous 7 days, Previous 30 days, Older |
| What is still to come | Today, Tomorrow, This week, Later |

## Selecting

| Start it | End it |
|---|---|
| Select in the list's ⋯, ⌘ or Ctrl-click, Shift-click for a range, Space, ⌘A, a long-press on touch | Cancel, Esc, or an action that finished |

A list that has selecting calls `selectionAction` and `selectApply` (`selection.mjs`) for what a click, a long-press or
a key means, and `selectionBar`, `selectAllBox` and `bindLongPress` (`selection-bar.mjs`) for its parts. On touch the
tick boxes take the mark's place only while selecting. The keys are in [keyboard.md](keyboard.md).

## Bulk actions

| Action | Asks or Undo | Needs |
|---|---|---|
| Archive (`act.archive`), Restore, Label, Add to group, Pin | Undo in its Toast | Label needs `runLabels`; the group actions need Advanced |
| Stop, Delete | Asks in the strip | Delete needs Advanced |
