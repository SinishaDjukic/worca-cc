# Which component: one per need

| Rule | What | Why | Held by |
|---|---|---|---|
| `comp.one-per-need` | Each need has one component; a page and a spec name needs and components, never a size, a colour or a look | One fix reaches every page | ds-check |
| `comp.no-hand-markup` | A component in code (a `code` entry in the catalog) is called, never rewritten by hand: it returns an HTML string from plain options (`toElement` for a page that builds elements) and brings its look and its states | Copies drift | stillhet-library-gate |
| `comp.markup-options` | Options named `body`, `end`, `actions` and `close` take markup from other library calls, never a person's text; a person's text goes through the library's own components, which escape it | No page escapes text by hand, and none forgets to | by hand |
| `comp.look-options` | No component takes a size, colour or class of its own: called with its required options it draws its full look; the few that still do are listed in the catalog and only go down | One look per role, never a page's | stillhet-look-options |
| `comp.no-radio-cards` | A choice is never a full-width toggle or radio cards, and a yes or no never covers the page | It stays in the place it changes | by hand |
| `comp.strip-link` | A ConfirmStrip may carry one text link after its sentence, to read more outside the app. A quiet side that is itself an answer (No thanks) has its own working label, and Esc then takes the strip back without an answer | A question stays one line, and Esc never answers for you | design-system-confirm-strip |
| `comp.row` | Every row on a Stillhet page is `row()`: its mark on the rail, its text, its end, its ⋯. ListRow, StepRow, SettingsRow, PulseRow and stack rows are built on it; a changed file and a stacked PR are their own rows | One rail and one end on every list | stillhet-library-gate |
| `comp.end-column` | A list's ends share one column, as wide as the widest end and capped at 45% of the list, and the title gives way first. Inside an end there are four columns in order: facts, actions, a Switch, the ⋯ | Figures and buttons line up down a list | ds-check |
| `comp.button-words` | A button's label is a short verb plus its detail (Save, Merge PR, Copy branch), three words at most, on one line: it never overflows or wraps | A label that wraps cannot be read at a glance | button-audit |
| `comp.button-busy` | A busy button (`act.busy`) is drawn by `button({ busy: { label } })` or set by `busy(el, { label, until })`, its words from `busyWord`: its width is held, it is `disabled` and `aria-busy`, and the label is said politely. Settled, it is back at rest with its own words, the disabled state it had, and the focus if the person did not move it | A press shows it was heard without the button jumping or the focus being lost | design-system-components |
| `comp.click-guard` | A second click within 400ms at the same spot is ignored when what is under the pointer is no longer the button just pressed (`watchClickGuard`). The same button, even redrawn, can be pressed twice, and a keyboard's click always passes | A double click must never fire what swaps in under the pointer, such as Approve then Merge | design-system-components |
| `comp.toast-clamp` | A toast has its own corner: the bottom left of the page column, just above the composer in a conversation, and over a Dialog when one is up. It is at most 360px wide and two lines, with the whole text in its tooltip (`toastText`) | A notice never covers a title, a filter line or the composer, and a long name never runs across the page | design-system-components |
| `comp.sentence-block` | A line that holds a picker or a menu is a block (`div`), never a `<p>`: the parser throws a menu out of a paragraph | The menu opens where its control is, and floats | stillhet-library-gate |
| `comp.menu-place` | A menu floats over the page and never pushes it: it opens under what opened it, above when there is more room there, slides sideways to stay inside the window and every box that clips it, and scrolls inside when taller than its room (`watchMenus`, `fitMenu`) | Nothing moves under the pointer, and no menu is cut | design-system-components |
| `comp.menu-groups` | A menu's head stays with its options: CompactMenu makes them one block, two columns at most, and a scrolling menu never ends on a head alone and fades where there is more | A head alone at a column's foot names nothing | design-system-components |
| `comp.menu-edge` | A menu with any toggle keeps the toggle's room on every item, so its words start on one edge. While a menu is open over the page, nothing outside it shows a tooltip | One text edge inside a menu, and no tip over it | design-system-components |
| `comp.menu-tick` | A choice whose item carries a mark shows its tick at the row's end | Where you are must be visible, not only announced | design-system-components |
| `comp.menu-off` | A disabled menu item never acts: the menu stays open, the item shows no pointer or hover, and it says why | A control acts, or is disabled and says why | design-system-components |
| `comp.menu-line` | A menu item is one line (`list.one-line`): its `line` is its hint, the tooltip and the description. It is drawn under the words only with `keepLine` naming the fact it holds, as each mode does in the profile menu (`keepLine: 'what the mode adds'`) | A choice that cannot be made without a sentence gets one, in place, and no other item does | design-system-settings-redesign |
| `comp.menu-sub` | A menu that holds groups of choices (the model picker's makers) opens a group in place: its items replace the list under a ‹ back row named for the group, and the opener of the group holding the choice carries the tick. → Enter Space open it; ← Esc and the back row return (`openSub`, `menuKeys`) | One layout fits every width and never leaves the window | design-system-components |
| `comp.keyed-patch` | A page that redraws a list on live data patches it by key (`patchKeyed`): an item whose drawing did not change keeps its node, and an orb in a redrawn item keeps its canvas (`carry`). Live redraws wait for the next frame (`frameBatch`) | A live frame must not cost the whole page, reset focus, caret or scroll, or restart the orb | design-system-keyed-list |
| `comp.patch-parts` | A region drawn from named parts (the shell's `#app`, a slot, a page's column) patches by part (`patchParts`): a part whose string did not change keeps its nodes, and a redraw that changes nothing writes nothing (a list's `paint({ ifChanged })` too). Part names are never integer-like | A redraw must not cost an unchanged part its focus, caret, scroll or open menu | design-system-keyed-list |
| `comp.patch-menus` | A kept open menu is fitted from where it would sit, so its shift never builds on the last; menus are fitted only after a part changed or the window's width did | A redraw never walks an open menu across the page | design-system-keyed-list |
| `comp.keep-open` | An open menu, inline field or dialog whose control is marked `data-keep` keeps its value, caret, selection and focus across any redraw of its page (`watchKeepOpen`, once for the page) | A live frame must never take what you are typing | design-system-keep-open |
| `comp.keep-open-route` | A route change (`keptRoute`: the place and its item) closes a kept control and never carries its text. What the page means wins: it resets a kept field by closing it, changing its key, clearing it before the redraw, or drawing a new value | Kept text never follows you to another thing | design-system-keep-open |
| `comp.live-paint` | A hidden place does not paint on live changes; it paints once when shown | A change nobody can see must not cost the page that is in view | stillhet-chat-repaint-host |

## The lookup: which component meets which need

Find the need and use its component as the gallery (`plans/stillhet/prototype/components.html`) shows it; sizes, colours
and spacing come with it. A need with no row in either table is a question for a person, then `build.teach`.

| Need | Component | For example |
|---|---|---|
| **Acting** | | |
| The one next step of a state | the split button in the StatusLine: Button primary, its ▾ the alternatives | Merge PR ▾, Resume now ▾ |
| Supporting actions | ⋯ next to it (`moreMenu`), a CompactMenu, danger last after a rule | Terminal, Copy link, Archive |
| A yes or no, or a one-line answer | ConfirmStrip, at the control that asked (`act.confirm-in-place`) | Merge #959 into dev? |
| A step that needs fields first | Dialog, the only one for a form | Create PR |
| Acting on several rows of a list | SelectionBar at the top of the list, while selecting (`list.select-bar`) | 2 selected · Archive 2 · Cancel |
| Going to another page or place | Text link, or a ListRow you open | Changes +358 −144, a file, a step |
| Copying text | CopyButton: a real, quiet 28px icon button whose label names what it copies (`Copy`, `Copy as markdown`, `Copy code`); it copies the source exactly as passed: markdown as written, code without its prompt or line numbers. `copyFrom` writes the clipboard; a tick for 1.2s and `Copied` in its tooltip and the live region, or `Could not copy` when the clipboard refuses; focus stays on it and its width never changes | a branch, a command, an id, a reply as markdown |
| A line icon | `icon` from the library's one set, at its one weight (1.8px); no page draws a path or picks a weight, and the sidebar's places are `nav-<view>` | ✓ on a menu item, Tasks in the bar |
| A place in the bar's places | NavItem, under Settings-like group heads | Chat, Tasks, Schedules |
| The head of the one bar | BarPlaceHead: Worca's W (home), the PlaceButton (the place's name and chevron, one button that opens the places from `placeItems`), the place's + where it makes things by hand, Hide (`nav.place-button`) | W · Tasks ⌄ |
| Getting past the bars by keyboard | SkipLink, the first Tab stop (`keys.skip-link`) | Skip to content |
| The hidden bar | BarStrip: one icon per kind of work, its CountBadge; opens its place | Chats 4, Tasks 7 |
| What you keep an eye on | InView: a mark and a short name in the top bar only, like tabs; a card on hover with × for Out of view; +N opens a menu | Fix the flaky login, Working |
| How many, on the corner of what it counts | CountBadge, `need` when any waits on you | Pulse 3 |
| The sidebar's foot, the door to the profile menu | AccountButton, then AccountItem rows in its flyout; on a live page its name and initials are `describeAccount` of GET /api/whoami (dev's rule): a shared sign-in names the person and has the identity card, otherwise Profile and P, never a demo name | Interface mode, Away |
| An action in the top bar | TopBarAction, a 20px icon with its CountBadge and its name in the tooltip; it holds still unless Pulse icon motion is on (`motion.pulse-icon`) | Ask worca, Pulse |
| Ask worca in the top bar | AskWorcaMark: a boxy chat bubble with the W for its text; three dots while Worca writes, filled with the W cut out while its column is open; an unread reply is its dot | Ask worca |
| Starting anything | Composer, on Chat only: the words, then one line with +, the Ask, Task or Schedule mode and its pickers, voice and send | Start task |
| A way to start, on Chat home | StarterGrid of StarterCards: an icon, a name, one line; the whole card one button (`panel.starters`) | New task · One job on a project |
| A message waiting for the reply to end | ComposerQueue: Queued rows with Remove, and one line | Sends when the reply finishes |
| **Choosing** | | |
| A choice in the composer's line | SentencePicker, opening a CompactMenu (in the app wired to `toggleMenu`, so the menu has keys); groups of choices open as sub-menus (`comp.menu-sub`); the model picker's items come from `makerItems`, its closed chip's words from `modelText` | on `web-app ▾` with `the Default workflow ▾` |
| A choice in a form | PickField: a label over a field-shaped button that fills its place; FieldPair when two fields are one choice (`form.fields`) | Workflow, Engine and model |
| A choice in a settings row | RowPicker: a labelled field of fixed width, at the row's end or in a line under it (`set.one-choice`) | Archive: Never |
| A choice among a form's or a panel's words | WordPicker, opening a CompactMenu | `dev ▾` base branch, `One PR ▾` |
| Answering Worca's question | OptionList: one line per answer, a radio dot, Worca's pick marked, your own answer under it (in the app, `buildChatQuestion` takes `preset` for Worca's pick and `recommended` on an option) | the asking step's answers |
| How much of a limit is used | UsageRing, its tooltip on what holds it | the rings around the avatar |
| A panel under a top-bar button | PanelFrame: head, a body that scrolls, its foot | Pulse |
| A value off its default | ChangedDot on the SettingsRow (`changed`): a dot after the name, the defaults in its tooltip | Budget · |
| A setting that is on or off | Switch: takes effect at once, no confirm; a failed change flips back and a toast says why | Watch on a PR |
| Picking items from a list, an opt-out, a consent | Checkbox, with one line of help when it needs it | the checklist, No cap, Draft |
| Two or three views of the same thing | Segmented | Light and Dark, Summaries and Raw |
| Sections of a page | Tabs; a task's page has none: its parts are folds under its train (`thing.parts-under-train`) | a project's Overview, Tasks, Memory |
| Narrowing a list | FilterRow, one line: text tabs with counts, then pickers with the label inside; in a bar chips and one Filter control; PageFilters adds a page's small tools at its end (`list.filters`) | All 12 · Needs you 3 · Order: Most urgent |
| A list narrowed by a link, for this visit | NarrowedLine (`list.narrowed-visit`) | Narrowed to web-app · Clear |
| Picking and adding names | ListEditor | labels and cost tags, groups |
| A choice inside a confirm | OptionList inside the ConfirmStrip or the Dialog; never radio cards | Rescan now, Rescan after the next task |
| One pick from a long list, or a new one | ListEditor, single pick: find or create, recent first | Add to group |
| **Entering** | | |
| Text, a number, a date or a time in a form | Field; fields sit in a FormGrid, rarer ones in a FieldFold, and one FormReadback line reads the choice back (`form.fields`) | Branch, At 07:45 |
| A fact on an inspect view | FieldValue: a label over its value, nothing to press (`form.inspect-value`) | Repeats · Every day |
| Picking folders on this computer | FolderBrowser, in a Dialog (single, or multi with checkboxes) | Choose folder…, Several folders… |
| Text Worca writes for you | SuggestionField | PR title and description, a drafted answer |
| A field or menu that stays open while its page redraws | `data-keep` on its control, `watchKeepOpen` once for the page | Rename, Move to group…, Label |
| A whole-text rewrite Worca suggests | RewriteSuggestion | Prompt check Improve |
| Finding anything | Search, the top bar's one combobox (`keys.search`; `searchResults` with areas): settings, chats, tasks, schedules, places, each under its area's head with its own mark; a result lands with the flash | Search or ask |
| Context sent with a message | ListEditor's removable item, in the composer | This page × |
| **Showing** | | |
| What is happening | StatusLine: its KindMark and the state word | Ready to merge, Paused |
| What a row is and how it stands | KindMark: the type's icon, a smooth ring by main stage in the state's colour, a question, problem, pause or stop in its centre; running is ink, not a colour; it breathes while work happens (one per tree, three per list) and pulses once when its state changes | a task at Review |
| Git's status at a row's end | GitMark, git's own icon; it pulses while Watch fixes | PR #1180, checks failing |
| A task or a schedule in a conversation | TaskCard: its page's anatomy, compact before it starts | Add CSV export |
| A thing on a center or a shelf | PluginCard: its title a link, the whole card opens its page, one bordered action (`panel.card-opens`) | jira-source · Set it up |
| A stage of a task, read down | StageLine, its parts at its end | Plan · Decisions 3 |
| A part of a task, under its train | StagePart, the open-line fold: what is inside, said before it opens; a hairline from its words to its chevron (`thing.open-line`) | Changes 5 files +358 −144 |
| A task's stages, on its page and its card | StageBar, the train: a knot a stage with its name under it, the current one with its step, each knot a button (`thing.stage-train`); `bare`, the line alone, where a list under it names the stages | Plan · Build · Review 2 of 3 |
| What Worca did in a conversation | TurnRow: folds; a failure opens itself | Ran 4 commands |
| Worca thinking in a conversation | ThinkingRow: one line, what it does now, its seconds; done, Thought for 8s, its steps folded | Searching the code · 4s |
| A starter armed in the composer | IntentChip: its icon, its name, ✕ | Build workflow ✕ |
| The head of every chat card | CardHead: kicker (mark and one word), title, one line, facts, ⋯ at its right | Asks you below · Add CSV export |
| A task Worca proposes | TaskProposal: Proposed, the title, labelled rows (Project, Workflow, Model, Starts, Then), one supporting line, a changed row marked; Start, Not now (`panel.proposal-keeps-picks`) | Add a CSV export |
| Any other change Worca proposes | ChangeProposal: before → after or a WorkflowGraph; Apply, Not now; applied, a receipt with Revert | Quiet on weekends |
| Where a conversation's ground changes | TurnDivider: a rule with a few words | Switched to worca-cc |
| The Shaper's plan, stopped for you | PlanCard: version, Reviewed by N roles · M open, one row per role; Approve and build | CSV export: columns and rollout |
| Files Worca shows you | FilesCard: pictures as tiles, files as rows, Download | invoice-4411.png |
| What you said | YouTurn: your words, the quote you answered, your files | This is what the customer sent |
| When a turn was said | TurnTime: under the turn at its right edge, on hover, focus or a tap; today a time, then Yesterday and a time, older a date and a time | 14:32, Yesterday 14:32, Nov 3, 14:32 |
| Worca's finished words, with their formatting | Prose: dev's markdown rendered calm; lists, code, links, tables, ref chips in the words | Two changes fix it, a list and a code block |
| Worca at work | OrbMark: the app's sphere of dots with Worca's W facing you, a hairline ring around it in light, lit while the sphere turns under it; still at rest; think, tool and write move it; `watchOrbs` brings every one to life | Thinking |
| Moving through a long conversation | Timeline, a slim track on the reading column's right edge, its TimelineCard on hover or focus (`panel.timeline`) | You · 14:32 (its time is TurnTime's) |
| A person's tasks over the page's days | TimeTrack (its axis from `dayTicks`, each time placed by `trackX`), a WorkBar in each row's lane, a MarkLegend under it | Retry failed webhook deliveries · billing-api · #1418 |
| A teammate's task, read only | TaskView: head, metadata, StatusLine with no action, Figures, runs, PR | Failed · The last attempt failed. |
| What hangs under a row | the rounded tree under it (`tree` on a list's row), each row one line ending in `rowEndWord`'s word (`list.child-row`) | a chat's tasks: Add CSV export to billing · Asks |
| How far along, and its steps | Stepper, then StepRow on the rail | Plan · Build · Review |
| One line that opens its detail in place | LineRow | Did all 3 parts you asked |
| A changed file | FileRow, opening its DiffView: side by side where it fits, else unified (`thing.diff`) | app.js +12 −3 |
| A PR of a stack in Create PR | StackedPrRow, opening its fields | PR 1 |
| Time, cost, changes | Figures; a page's totals come from a FiguresButton at its filter line's end, opening a FiguresLine (`look.figures-on-demand`) | Cost $84.10 of $120 |
| Labels and cost tags | TagGroup | ui, team: web, +2 |
| Things that belong together, in a list | GroupRow: its count and ⌄, its members under it | Unified page navigation 2/3 |
| A task's PR fix rounds | RoundRows, under its row | Round 7 · merge dev in, 7 rounds |
| A list with no rows | ListState: loading, offline, could not load, empty | Loading tasks… |
| What a chat is or did, on the rail | ChatKindIcon in the dot's place; OriginMark before its title | Slack |
| A list of things | ListRow on the rail, the whole row opens, never a box per item. Rows are split by space; a list grouped by something (status, day, section) draws one `--line` where each group after the first starts, from the text edge, and none between rows. | tasks, files, decisions, Pulse's Now, a settings tab |
| An update or a thing in Pulse | PulseRow, built on `row()`; while selecting, its tick box on the rail | Plan asks 2 questions |
| What keeps running after a task | A PulseRow in Pulse's Now, under `Running actions`, with its Stop; never in the sidebar, which holds places only, and never in Pulse's badge, since it needs nobody | Dev server :4417 |
| A short fact: a stage, a source, a slot to set up | Chip | Beta, Official, No API key |
| Why a control is off, a cut-off text, an id, a row's facts | Tooltip (`watchTooltips`): every `title`, quick, on hover, focus and long-press | web-app · Replying · 14:30 |
| A workflow at full size | WorkflowGraph, the view in a Dialog without a form: a lane per stage, a node per step in its colour, a node opens its log under it | Open the graph |
| A step's or a task's log | LogLines: time, where from, words; its filters are a FilterRow above it | Activity's Logs |
| The same figures across many rows | Table: divided rows, tabular figures, no box per row, the name first; on a narrow screen the least needed columns go to the row's detail | sessions, cost by step |
| **Telling** | | |
| Something done, nothing to answer | Toast, in its own corner (`comp.toast-clamp`) | PR merged |
| A problem with a choice, its rows and its ways out | ChoiceNote, on the rail before the choice is made: amber needs you, grey only tells; its text is body size (`form.one-note`) | This preset needs attention · Reset to default |
| Something failed | where you acted: the strip, the dialog's alert, the field's error line, the suggestion's grey line; a Toast only when there is no such place | Could not merge #959 |
| Nothing here, loading, could not load | EmptyState: one line on the text edge; loading shows nothing for 300ms, then one line, never a spinner or skeleton | No tasks yet |
| A part of the page cannot be drawn | EmptyState's error, in that part only, with Reload this part | Could not show the changes |
| A place that is not in Stillhet yet | NotInStillhet: says so, names where it lives today in words, and offers Back to Chat; never "No … yet" | Insights is not in Stillhet yet |
| A Settings row or section still sample on a live Stillhet | NotLiveRow: its name, or the section's one line, and the words; nothing to click | Not in Stillhet yet: turn Stillhet off from the top-bar switch to use it |
| Something broke that nothing handles | Toast, error: stays until closed, a repeat counts on it | Something went wrong |
| The connection dropped | a quiet line at the end of the top bar, grey dot, until it reconnects | Offline · retrying |

## Elements, found by need

A part of a component that a page calls on its own is found here by its need, under its family's entry in the catalog (`also`).

| Need | Element | Family |
|---|---|---|
| A limit's tooltip: what, whose, how much, when it resets | `usageTip` | UsageRing |
| A limit's window in words: Session, Weekly | `usageWindow` | UsageRing |
| A live Settings control not wired yet: its reason | `NOT_LIVE_SENTENCE` | NotLiveRow |
| Only the providers that count: one signed out has no ring | `connectedUsage` | UsageRing |
| What holds the rows of the profile menu | `navFlyout` | AccountItem |
| One of Appearance's choices: light, dark, system | `themeChoice` | AccountItem |
| A card's title that opens what it sums up | `cardTitleLink` | AccountItem |
| Whether the away screen shows now | `awayShows` | AwayScreen |
| A state's dot on the rail, without its words | `statusDot` | StatusLine |
| One main action with alternatives under ▾ | `splitButton` | Button |
| A button whose action is out | `busy` | Button |
| A line icon from the library's one set, at its one weight | `icon` | Button |
| One item of a menu: its name, its tick or its reason when off | `menuItem` | CompactMenu |
| Supporting actions behind ⋯, danger last | `moreMenu` | CompactMenu |
| A one-step confirm that holds a short form | `confirmForm` | ConfirmStrip |
| The confirm's two buttons: yes and no | `confirmActions` | ConfirmStrip |
| One picker of a filter line, with its menu | `listWord` | FilterRow |
| Select every row shown, or none | `selectAllBox` | SelectionBar |
| A long press on a row starts selecting, on touch | `bindLongPress` | SelectionBar |
| A view in a Dialog without a form: its head, its body | `dialogFrame` | Dialog |
| A folder's name from its path | `folderName` | FolderBrowser |
| What a typed folder is, under its field: Git, Folder, Not found | `folderProbe` | FolderBrowser |
| Picked folders reviewed before they are added: a name each, Added or why skipped | `folderReview` | FolderBrowser |
| An add way's own controls on the form: Choose folder…, Browse folders…, Use git | `folderWay` | FolderBrowser |
| What a bulk add did, in one line | `reviewSummary` | FolderBrowser |
| A document's name that opens it | `documentLink` | Text link |
| The tick after something was copied | `copied` | CopyButton |
| Writing a copy to the clipboard and saying Copied or Could not copy | `copyFrom` | CopyButton |
| Finding a control with two tips | `doubleTips` | Tooltip |
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
| Search results under their area's head: each one line, its name, then where it lives at its end; a long where folds to … and its tooltip has it whole (`list.one-line`) | `searchResults` | Search |
| A failure that can be read whole, until it is closed | `errorToast` | Toast |
| Undo right after a step | `toastUndo` | Toast |
| What a toast says, two lines at most, the whole text in its tooltip | `toastText` | Toast |
| The head of a group of commands: how many, how many failed, how long | `commandHead` | CommandGroup |
| A chat at its end follows what arrives; scrolled up, it holds | `pinnedToEnd` | ScrollFade |
| A redraw that moves what changed instead of jumping | `morph` | What a toggle opens, moving |
| The flash on what you just went to | `land` | What a toggle opens, moving |
| Esc or a click outside takes a strip back | `watchStrips` | Closing what lies over a page |
| A tool beside the page that closes nothing when clicked | `neverOutside` | Closing what lies over a page |
| The Stillhet icon's menu opens, a pick goes busy and shows its outcome | `watchStillhetSwitch` | StillhetSwitch |
| A menu kept inside the window | `fitMenu` | A list page's behaviour |
| A state's words filled with the task's facts | `fill` | States |
| Every state there is | `stateIds` | States |
| The section of a list a state goes in | `sectionOf` | States |
| Whether a task is still going, as a schedule's skip if still going counts it | `stillGoing` | States |
| Whether a step is done | `isDone` | States |
| A stage's state from its steps: live, done or next | `stageState` | States |
| The one state that speaks for a stage's steps | `subState` | States |
| A step as StepRow draws it | `stepLook` | States |
| The stage a task opens on | `defaultStage` | States |
| How long a stage took, said under it | `stageMeta` | States |
| A duration in words as minutes | `toMin` | States |
| Minutes as a duration in words | `fmtMin` | States |
| A turn's time in words, without its element | `turnTimeText` | TurnTime |
| Load the renderer once, then redraw | `loadProse` | Prose |
| One line on what an action does, in its tooltip | `actionHelp` | Actions |
| The interface mode an action needs | `actionLevel` | Actions |
| An action as a state offers it | `makeAction` | Actions |
| Whether a group member keeps an action on its own page | `memberKeeps` | Actions |
| What Pause, Stop and the like lead to on a live task | `runFlow` | Actions |
| The Try it step's items in a task's ⋯ | `tryStep` | Actions |
| The strip's words for a step that asks first | `confirmOf` | Step flow |
| A failure in Stillhet's words: Could not …, the reason, Nothing changed | `failureOf` | Step flow |
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
| Which task a Stop or an Archive applies to, from a task's state word | `bulkStateOf` | Selection |
| What a bulk action does to each selected row, and what it skips | `planBulk` | Selection |
| The line that says which selected rows a bulk action skips | `skipText` | Selection |
| The confirm's words for a bulk action | `bulkConfirm` | Selection |
| A shortcut in a line of text: ⌘K on a Mac, Ctrl+K elsewhere | `keyHint` | Shortcuts |
| What a key press says, for shortcutAction | `keyFacts` | Shortcuts |
| The next or previous row of a list, by arrow keys | `listMove` | Shortcuts |
| Whether keys read ⌘ ⌥ ⇧ or Ctrl, Alt, Shift | `isMac` | Shortcuts |
| Open the shortcuts sheet with this page's keys | `openShortcutsSheet` | Shortcuts |
