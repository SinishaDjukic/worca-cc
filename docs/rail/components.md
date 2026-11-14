# Which component: one per need

| Rule | What | Why | Held by |
|---|---|---|---|
| `comp.one-per-need` | Each need has one component; a page names needs, not looks | One fix reaches every page | ds-check |
| `comp.no-hand-markup` | A component in code is called, never rewritten by hand | Copies drift | rail-gate |
| `comp.no-radio-cards` | A choice is never a full-width toggle or radio cards; a yes or no never covers the page | It stays in the sentence or place it changes | by hand |
| `comp.menu-groups` | A menu's head stays with its options: CompactMenu makes them one block, so columns never part them, and a scrolling menu never ends on a head alone (`watchMenus`) and fades where there is more (`watchScrollFades`); two columns at most, it takes the free height before it scrolls, and a menu stays inside the window, scrolling inside it (the columns sit inside what scrolls: a height on a columned box only makes more columns) | A head alone at a column's foot names nothing | design-system-components |
| `comp.click-guard` | A second click within 400 ms at the same spot is ignored when what is under the pointer is no longer the button just pressed (`watchClickGuard`, once for the page); the same button, even redrawn, can be pressed twice, and a keyboard's click always passes | A double click must never fire what swaps or moves under the pointer, such as Approve then Merge | design-system-components |
| `comp.menu-off` | A disabled menu item never acts, in any menu: it stays open, shows no pointer or hover, and says why (`watchMenus`) | A control acts, or is disabled and says why | design-system-components |
| `comp.menu-tick` | A choice whose item carries a mark shows its tick at the row's end (CompactMenu), in any menu: the mark holds the place a tick has elsewhere | Where you are must be visible, not only announced | design-system-components |
| `comp.toast-clamp` | A toast is at most 480px wide and two lines; the whole text is in its tooltip (`toastText`) | A long name never runs over the composer | design-system-components |
| `comp.sentence-block` | A sentence that holds a picker is a block (`div`), never a `<p>`: a menu cannot live in a paragraph, and the parser throws it out of place | The menu opens where the sentence is | rail-gate |
| `comp.row` | A row in a list is row(): rail, text, end, ⋯; a changed file and a stacked PR are their own rows | One rail and one end on every list | rail-gate |
| `comp.end-column` | A list's ends share one column, as wide as the widest, capped; the title gives way first | Figures and buttons line up down a list | ds-check |
| `comp.look-options` | No component takes a size, colour or class of its own: called with its required options it draws its full look; the few that still do are listed in the catalog and only go down | One look per role, never a page's | rail-look-options |

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
| An action in the top bar | TopBarAction, a 20px icon with its CountBadge; its name in the tooltip; with news (its count grew) the icon shakes, again every 3.5 s, for as long as Settings › Notifications › Pulse icon says (until you read or act on it by default); never under reduced motion | Ask worca, Pulse |
| Ask worca in the top bar | AskWorcaMark: a boxy chat bubble with the W for its text; three dots while Worca writes, filled with the W cut out while its column is open; an unread reply is its dot | Ask worca |
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
| What a row is and how it stands | KindMark: the type's icon, a smooth ring by main stage in the state's colour, a question, problem, pause or stop in its centre; running is ink, not a colour; it breathes while work happens (one per tree, three per list) and pulses once when its state changes | a task at Review |
| Git's status at a row's end | GitMark, git's own icon; it pulses while Watch fixes | PR #1180, checks failing |
| A task or a schedule in a conversation | TaskCard: its page's anatomy, compact before it starts | Add CSV export |
| A stage of a task, read down | StageLine, its parts at its end | Plan · Decisions 3 |
| A part of a task at its stage | StagePart: what is inside, said before it opens; its chevron turns open | Changes 5 files +358 −144 |
| A task's stages on a card | StageBar: one line, a knot a stage, the stage it is on holding its steps, the one now breathing (look.stage-line); `bare`, the line alone, where a stage list under it names the stages (rail.one-place) | Plan · Build · Review 2 of 3 |
| What Worca did in a conversation | TurnRow: folds; a failure opens itself | Ran 4 commands |
| Worca thinking in a conversation | ThinkingRow: one line, what it does now, its seconds; done, Thought for 8s, its steps folded | Searching the code · 4s |
| A starter armed in the composer | IntentChip: its icon, its name, ✕ | Build workflow ✕ |
| The head of every chat card | CardHead: kicker (mark and one word), title, one line, facts, ⋯ at its right | Asks you below · Add CSV export |
| A task Worca proposes | TaskProposal: Proposed, the title in place, why; the composer's sentence and Customise; Start, Not now; Start becomes the running card | Add a CSV export |
| Any other change Worca proposes | ChangeProposal: before → after or a WorkflowGraph; Apply, Not now; applied, a receipt with Revert | Quiet on weekends |
| Where a conversation's ground changes | TurnDivider: a rule with a few words | Switched to worca-cc |
| The Shaper's plan, stopped for you | PlanCard: version, Reviewed by N roles · M open, one row per role; Approve and build | CSV export: columns and rollout |
| Files Worca shows you | FilesCard: pictures as tiles, files as rows, Download | invoice-4411.png |
| What you said | YouTurn: your words, the quote you answered, your files | This is what the customer sent |
| When a turn was said | TurnTime: under the turn at its right edge, on hover, focus or a tap; today a time, then Yesterday and a time, older a date and a time | 14:32, Yesterday 14:32, Nov 3, 14:32 |
| Worca at work | OrbMark: the app's sphere of dots with Worca's W facing you, a hairline ring around it in light, lit while the sphere turns under it; still at rest; think, tool and write move it; `watchOrbs` brings every one to life | Thinking |
| Moving through a long conversation or a task | Timeline on the right edge, its TimelineCard on hover | You · 14:32 (its time is TurnTime's) |
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
| A list of things | ListRow on the rail, the whole row opens, never a box per item. Rows are split by space; a list grouped by something (status, day, section) draws one `--line` where each group after the first starts, from the text edge, and none between rows. Mock `plans/rail/mocks/now-dividers-compare-*.png` (option 4) | runs, files, decisions, Pulse's Now, a settings tab |
| An update or a thing in Pulse | PulseRow, built on `row()`; while selecting, its tick box on the rail | Plan asks 2 questions |
| What keeps running after a run | A PulseRow in Pulse's Now, under `Running actions`, with its Stop; never in the sidebar, which holds places only, and never in Pulse's badge, since it needs nobody | Dev server :4417 |
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

**Elements, found by need.** A part of a component that a page calls on its own (an action in ⋯, a confirm with a
form, an undo, a figure) is not a component of its own: it is found here by its need, under its family's entry in the
catalog (`also`), and it arrives with its look, words, states and behaviour. A need with no row in either table is a
question for a person, then `build.teach`. Options named `body`, `end`, `actions` and `close` take markup from
other library calls, never a person's text: a person's text goes through the library's own components, which escape it.
| Need | Element | Family |
|---|---|---|
| A limit's tooltip: what, whose, how much, when it resets | `usageTip` | UsageRing |
| A limit's window in words: Session, Weekly | `usageWindow` | UsageRing |
| Only the providers that count: one signed out has no ring | `connectedUsage` | UsageRing |
| What holds the rows of the profile menu | `navFlyout` | AccountItem |
| One of Appearance's choices: light, dark, system | `themeChoice` | AccountItem |
| A card's title that opens what it sums up | `cardTitleLink` | AccountItem |
| Whether the away screen shows now | `awayShows` | AwayScreen |
| A state's dot on the rail, without its words | `statusDot` | StatusLine |
| One main action with alternatives under ▾ | `splitButton` | Button |
| A line icon from the library's one set, at its one weight | `icon` | Button |
| One item of a menu: its name, its tick or its reason when off | `menuItem` | CompactMenu |
| Supporting actions behind ⋯, danger last | `moreMenu` | CompactMenu |
| A one-step confirm that holds a short form | `confirmForm` | ConfirmStrip |
| The confirm's two buttons: yes and no | `confirmActions` | ConfirmStrip |
| One picker word of a list's sentence, with its menu | `listWord` | ListSentence |
| Select every row shown, or none | `selectAllBox` | SelectionBar |
| A long press on a row starts selecting, on touch | `bindLongPress` | SelectionBar |
| A view in a Dialog without a form: its head, its body | `dialogFrame` | Dialog |
| A document's name that opens it | `documentLink` | Text link |
| The tick after something was copied | `copied` | CopyButton |
| Ask Worca to write a field | `suggestButton` | SuggestionField |
| Text Worca wrote, not yet yours | `suggestedChip` | SuggestionField |
| Worca could not write it: the text stays, Try again | `suggestionFail` | SuggestionField |
| Stop Worca while it writes | `stopWriting` | SuggestionField |
| The way on from a failure's line: Try again, Details | `failureLink` | SuggestionField |
| Write or preview a description | `previewToggle` | SuggestionField |
| A field's text as it will read | `suggestionPreview` | SuggestionField |
| A step's mark on the rail and the word a screen reader hears | `stepDot` | Stepper |
| A PR or a slice of a stack, in a list of its stack | `stackRow` | Stepper |
| One figure: its name, its value, of what | `figure` | Figures |
| What a figure is made of, opened from it | `figureBreakdown` | Figures |
| Labels that fit their line, the rest folded into +N | `fitTags` | TagGroup |
| Search results under their area's head | `searchResults` | Search |
| A failure that can be read whole, until it is closed | `errorToast` | Toast |
| Undo right after a step | `toastUndo` | Toast |
| What a toast says, two lines at most, the whole text in its tooltip | `toastText` | Toast |
| The head of a group of commands: how many, how many failed, how long | `commandHead` | CommandGroup |
| A redraw that moves what changed instead of jumping | `morph` | What a toggle opens, moving |
| The flash on what you just went to | `land` | What a toggle opens, moving |
| Esc or a click outside takes a strip back | `watchStrips` | Closing what lies over a page |
| A tool beside the page that closes nothing when clicked | `neverOutside` | Closing what lies over a page |
| A menu kept inside the window | `fitMenu` | A list page's behaviour |
| A state's words filled with the task's facts | `fill` | States |
| Every state there is | `stateIds` | States |
| The section of a list a state goes in | `sectionOf` | States |
| Whether a step is done | `isDone` | States |
| A stage's state from its steps: live, done or next | `stageState` | States |
| The one state that speaks for a stage's steps | `subState` | States |
| A step as StepRow draws it | `stepLook` | States |
| The stage a task opens on | `defaultStage` | States |
| How long a stage took, said under it | `stageMeta` | States |
| A duration in words as minutes | `toMin` | States |
| Minutes as a duration in words | `fmtMin` | States |
| A turn's time in words, without its element | `turnTimeText` | TurnTime |
| One line on what an action does, in its tooltip | `actionHelp` | Actions |
| The interface mode an action needs | `actionLevel` | Actions |
| An action as a state offers it | `makeAction` | Actions |
| Whether a group member keeps an action on its own page | `memberKeeps` | Actions |
| What Pause, Stop and the like lead to on a live task | `runFlow` | Actions |
| The Try it step's items in a task's ⋯ | `tryStep` | Actions |
| The strip's words for a step that asks first | `confirmOf` | Step flow |
| A failure in Rail's words: Could not …, the reason, Nothing changed | `failureOf` | Step flow |
| What a step's button says while it works | `workingWord` | Step flow |
| The person's interface mode, read and set | `prefs` | Interface modes |
| Whether a part shows in the current interface mode | `shows` | Interface modes |
| Whether a part of the task page shows in a mode | `runPartShows` | Interface modes |
| Stop selecting: nothing ticked | `selectClear` | Selection |
| Start selecting from a list's menu | `selectStart` | Selection |
| Tick or untick one row | `selectToggle` | Selection |
| Tick every row from the last one ticked | `selectRange` | Selection |
| Tick every row shown | `selectAll` | Selection |
| Keep only the ticked rows still shown | `selectPrune` | Selection |
| How many of the rows shown are ticked | `selectCount` | Selection |
| The Select all box: none, some or all | `selectAllState` | Selection |
| Shift and an arrow add the next row | `selectExtend` | Selection |
| Apply a toggle, a range, all or clear | `selectApply` | Selection |
| A key or a click on a selecting list: the selection and where the focus goes | `selectStep` | Selection |
| Where the focus goes after a redraw | `keepFocus` | Selection |
| Which run a Stop or an Archive applies to, from a task's state word | `bulkStateOf` | Selection |
| What a bulk action does to each selected row, and what it skips | `planBulk` | Selection |
| The line that says which selected rows a bulk action skips | `skipText` | Selection |
| The confirm's words for a bulk action | `bulkConfirm` | Selection |
| A shortcut in a line of text: ⌘K on a Mac, Ctrl+K elsewhere | `keyHint` | Shortcuts |
| What a key press says, for shortcutAction | `keyFacts` | Shortcuts |
| The next or previous row of a list, by arrow keys | `listMove` | Shortcuts |
| Whether keys read ⌘ ⌥ ⇧ or Ctrl, Alt, Shift | `isMac` | Shortcuts |
| Open the shortcuts sheet with this page's keys | `openShortcutsSheet` | Shortcuts |

**Rows.** Every row on a Rail page is `row()`: its mark on the rail, its text, its end, its ⋯. A list lays its rows on one grid, so every end shares one left and one right edge, as wide as the widest end (capped at 45% of the list) and the title gives way first. Inside a list's end there are four columns, in order: facts (a figure, a chip), actions, a Switch, the ⋯, each on one edge whichever a row has. ListRow, StepRow, SettingsRow, Pulse rows and stack rows are built on it; a page never sets a row's columns.

Building from it:
- A page sets no look of its own: no colour, type size, corner or shadow that is not a token, no inline style but
  layout and data, no control that is not in the table. `plans/rail/prototype/gates/ds-check.mjs` checks it.
- A spec names the need and the component (`the step's primary in the strip, destructive`), never a size or a colour.
- When no row fits, stop and propose the addition here (a row, then its gallery example) before building it.
- A choice is never a full-width toggle or radio cards, and a yes or no never covers the page.
- A ConfirmStrip may carry one text link after its sentence, to read more outside the app; a quiet side that is itself an answer (No thanks) has its own working label, and Esc then takes the strip back without an answer.
