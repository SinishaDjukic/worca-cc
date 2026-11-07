# Which component: one per need

| Rule | What | Why | Held by |
|---|---|---|---|
| `comp.one-per-need` | Each need has one component; a page names needs, not looks | One fix reaches every page | ds-check |
| `comp.no-hand-markup` | A component in code is called, never rewritten by hand | Copies drift | rail-gate |
| `comp.no-radio-cards` | A choice is never a full-width toggle or radio cards; a yes or no never covers the page | It stays in the sentence or place it changes | by hand |
| `comp.row` | A row in a list is row(): rail, text, end, ⋯; a changed file and a stacked PR are their own rows | One rail and one end on every list | rail-gate |
| `comp.end-column` | A list's ends share one column, as wide as the widest, capped; the title gives way first | Figures and buttons line up down a list | ds-check |

A Rail page is built by naming needs, not looks. Find the need, use its component as the gallery
(`plans/rail/prototype/components.html`) shows it; sizes, colours and spacing come with the component.
| Need | Component | For example |
|---|---|---|
| **Acting** | | |
| The one next step of a state | the split button in the StatusLine: Button primary, its ▾ the alternatives | Merge PR ▾, Resume now ▾ |
| Supporting actions | ⋯ next to it (`moreMenu`), a CompactMenu, danger last after a rule | Terminal, Copy link, Archive |
| A yes or no, or a one-line answer | ConfirmStrip, in place under the top bar | Merge #959 into dev?, Run after |
| A step that needs fields first | Dialog, the only one for a form | Create PR |
| Acting on several rows of a list | SelectionBar at the list's foot, while selecting | 2 selected · Clear 2 · Cancel |
| Going to another page or place | Text link, or a ListRow you open | Changes +358 −144, a file, a step |
| Copying text | CopyButton: a quiet 28px icon button; a tick for 1.2s and `Copied` in its tooltip and the live region; its width never changes | a branch, a command, an id |
| A line icon | `icon` from the library's one set, at its one weight (1.8px); no page draws a path or picks a weight, and the sidebar's places are `nav-<view>` | ✓ on a menu item, Runs in the sidebar |
| A place in the bar's places | NavItem, under Settings-like group heads; a Work place's + starts its own thing | Chat, Tasks, Schedules |
| The head of the one bar | BarHead: Worca's W (the way to the places), its title, its one action, Hide | Chat + |
| The hidden bar | BarStrip: one icon per kind of work, its CountBadge; opens its place | Chats 4, Tasks 7 |
| What you keep an eye on | InView: a mark and a short name in the top bar only, like tabs; a card on hover with × for Out of view; +N opens a menu | Fix the flaky login, Working |
| How many, on the corner of what it counts | CountBadge, `need` when any waits on you | Pulse 3 |
| The sidebar's foot, the door to the profile menu | AccountButton, then AccountItem rows in its flyout | Interface mode, Away |
| An action in the top bar | TopBarAction, a 20px icon with its CountBadge; its name in the tooltip; with news (its count grew) the icon shakes once, never under reduced motion | Ask worca, Pulse |
| Starting anything | Composer: the words, then one line with +, the Ask/Task/Schedule sentence, voice and send | Start task |
| **Choosing** | | |
| A choice that changes a step | SentencePicker: a picker in the sentence it changes, opening a CompactMenu (in the app, wired to `toggleMenu`, so the menu has keys) | `Send [what needs you ▾] to [desktop ▾]` |
| A choice among a form's or a panel's words | WordPicker, opening a CompactMenu | `dev ▾` base branch, `One PR ▾` |
| Answering Worca's question | OptionList: one line per answer, a radio dot, Worca's pick marked, your own answer under it (in the app, `buildChatQuestion` takes `preset` for Worca's pick and `recommended` on an option) | the asking step's answers |
| How much of a limit is used | UsageRing, its tooltip on what holds it | the rings around the avatar |
| A panel under a top-bar button | PanelFrame: head, a body that scrolls, its foot | Pulse |
| A value off its default | ChangedDot on the SettingsRow (`changed`): a dot after the name, the defaults in its tooltip | Budget · |
| A setting that is on or off | Switch: takes effect at once, no confirm; a failed change flips back and a toast says why | Watch on a PR |
| Picking items from a list, an opt-out, a consent | Checkbox | the checklist, No cap, Draft |
| Two or three views of the same thing | Segmented | Light and Dark, Summaries and Raw |
| Sections of a page | Tabs; on a task in the one Worca, none: each part opens under its StageLine | Overview, Changes, Activity, Decisions |
| Narrowing a list | the list's sentence: SentencePicker words above the list, each choice with its count; never a filter button or a View menu | `Showing [ready to ship ▾] from [all projects ▾] by [day ▾]` |
| Picking and adding names | ListEditor | labels and cost tags, groups |
| A choice inside a confirm | OptionList inside the ConfirmStrip or the Dialog; never radio cards | Rescan now, Rescan after the next run |
| One pick from a long list, or a new one | ListEditor, single pick: find or create, recent first | Add to group |
| **Entering** | | |
| Text or a number in a form | Field | Branch, Budget |
| Text Worca writes for you | SuggestionField | PR title and description, a drafted answer |
| Finding anything | the top bar's search (`searchResults` with areas): settings, chats, tasks, schedules, places, each under its area's head with its own mark; a result lands with the flash | Search or ask |
| Context sent with a message | ListEditor's removable item, in the composer | This page × |
| **Showing** | | |
| What is happening | StatusLine: its KindMark and the state word | Ready to merge, Paused |
| What a row is and how it stands | KindMark: the type's icon, a smooth ring by main stage in the state's colour, a question, problem, pause or stop in its centre; it breathes while work happens and pulses once when its state changes | a task at Review |
| Git's status at a row's end | GitMark, git's own icon; it pulses while Watch fixes | PR #1180, checks failing |
| A task or a schedule in a conversation | TaskCard: its page's anatomy, compact before it starts | Add CSV export |
| A stage of a task, read down | StageLine, its parts at its end | Plan · Decisions 3 |
| A part of a task at its stage | StagePart: what is inside, said before it opens; its chevron turns open | Changes 5 files +358 −144 |
| A task's stages on a card | StageBar, each deepening into the state's colour | Plan · Build · Review |
| What Worca did in a conversation | TurnRow: folds; a failure opens itself | Ran 4 commands |
| Moving through a long conversation or a task | Timeline on the right edge, its TimelineCard on hover | Which date format? |
| What hangs under a row | the rounded tree under it (`tree` on a list's row) | a chat's tasks |
| How far along, and its steps | Stepper, then StepRow on the rail | Plan · Build · Review |
| One line that opens its detail in place | LineRow | Did all 3 parts you asked |
| A changed file | FileRow, opening its diff | app.js +12 −3 |
| A PR of a stack in Create PR | StackedPrRow, opening its fields | PR 1 |
| Time, cost, changes | Figures | Cost $84.10 of $120 |
| Labels and cost tags | TagGroup | ui, team: web, +2 |
| What a list shows | ListSentence: SentencePicker words, each choice with its count | `Showing [all ▾] from [all projects ▾] by [state ▾]` |
| Things that belong together, in a list | GroupRow: its count and ⌄, its members under it | Unified page navigation 2/3 |
| A run's PR fix rounds | RoundRows, under its row | Round 7 · merge dev in, 7 rounds |
| A list with no rows | ListState: loading, offline, could not load, empty | Loading runs… |
| What a chat is or did, on the rail | ChatKindIcon in the dot's place; OriginMark before its title | Started a run; Slack |
| A list of things | ListRow on the rail, the whole row opens, never a box per item. Rows are split by space; a list grouped by something (status, day, section) draws one `--line` where each group after the first starts, from the text edge, and none between rows. Mock `plans/rail/mocks/now-dividers-compare-*.png` (option 4) | runs, files, decisions, Pulse's Vitals, a settings tab |
| An update or a thing in Pulse | PulseRow, built on `row()`; while selecting, its tick box on the rail | Plan asks 2 questions |
| What keeps running after a run | A PulseRow in Pulse's Vitals, under `Running actions`, with its Stop; never in the sidebar, which holds places only, and never in Pulse's badge, since it needs nobody | Dev server :4417 |
| A short fact: a stage, a source, a slot to set up | Chip | Beta, Official, No API key |
| Why a control is off, a cut-off text, an id, a row's facts | Tooltip (`watchTooltips`): every `title`, quick, on hover, focus and long-press | web-app · Replying · 14:30 |
| A workflow at full size | WorkflowGraph, the view in a Dialog without a form: a lane per stage, a node per step in its colour, a node opens its log under it | Open the graph |
| A step's or a run's log | LogLines: time, where from, words; its filters are a sentence of SentencePickers above it | Activity's Logs |
| The same figures across many rows | Table: divided rows, tabular figures, no box per row, the name first; on a narrow screen the least needed columns go to the row's detail | sessions, cost by step |
| **Telling** | | |
| Something done, nothing to answer | Toast | PR merged |
| Something failed | where you acted: the strip, the dialog's alert, the field's error line, the suggestion's grey line; a Toast only when there is no such place | Could not merge #959 |
| Nothing here, loading, could not load | EmptyState: one line on the text edge; loading shows nothing for 300ms, then one line, never a spinner or skeleton | No runs yet |
| A part of the page cannot be drawn | EmptyState's error, in that part only, with Reload this part | Could not show the changes |
| Something broke that nothing handles | Toast, error: stays until closed, a repeat counts on it | Something went wrong |
| The connection dropped | a quiet line at the end of the top bar, grey dot, until it reconnects | Offline · retrying |

**Rows.** Every row on a Rail page is `row()`: its mark on the rail, its text, its end, its ⋯. A list lays its rows on one grid, so every end shares one left and one right edge, as wide as the widest end (capped at 45% of the list) and the title gives way first. Inside a list's end there are four columns, in order: facts (a figure, a chip), actions, a Switch, the ⋯, each on one edge whichever a row has. ListRow, StepRow, SettingsRow, Pulse rows and stack rows are built on it; a page never sets a row's columns.

Building from it:
- A page sets no look of its own: no colour, type size, corner or shadow that is not a token, no inline style but
  layout and data, no control that is not in the table. `plans/rail/prototype/gates/ds-check.mjs` checks it.
- A spec names the need and the component (`the step's primary in the strip, destructive`), never a size or a colour.
- When no row fits, stop and propose the addition here (a row, then its gallery example) before building it.
- A choice is never a full-width toggle or radio cards, and a yes or no never covers the page.
