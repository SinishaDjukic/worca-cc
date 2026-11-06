# Worca Rail: aligning with dev after the #919 split (4 Nov 2026)

What landed on dev since `c5c3fee69` (about 40 UI changes), checked against `docs/rail/. The
branch is merged with dev (`0d7cafe6d`); the prototype draws on the app's CSS parts (`prototype/app.css`); every gate
passes. Rail rules hold for Rail pages; the app keeps its rules until each page moves to Rail, so a conflict below is
fixed when that page moves, unless Rail decides to adopt the app's way.

## Decisions

Decided by one rule (docs/rail/, "When the app and Rail differ"): Rail is preferred; if the
app's way meets a real need, Rail takes it in; the result is Rail, upgraded. **Rail** below means the app changes when
the page moves; **Upgraded** means the Rail rules changed to take the app's point in.

| # | App now | Rail rule | Outcome |
|---|---|---|---|
| 1 | Runs and Chats filter through a **View menu** button, Ready to ship among its options (#970, #1001) | "What the list shows is a sentence above it, not a filter button" | **Decided 4 Nov: the sentence, one shared way for every list.** When Runs and Chats move to Rail, the View menu's Show and Group by become words in the sentence, with counts; mock `mocks/runs-list-filter-*.png` |
| 2 | **Day sections fold** by hand; Older starts folded (#1036, `runs-list.mjs`) | "Sections never collapse; one that is too long shows less" | **Decided 4 Nov: show less, never fold.** Older shows its 3 newest, then `Show 21 more` opens the rest in place; mock `mocks/runs-list-sections-*.png` |
| 3 | A **failed command group stays folded** in Chat, only a red `N failed` (#998) | "What has a problem opens by itself" | **Decided 4 Nov: the failure opens itself, once.** The group and the failed row open with the output; folded by the person, it stays folded; mock `mocks/chat-failed-command-*.png` |
| 4 | The **side chat dock** slides in over .32s (#954) and chat cards rise 10px (#972) | Motion: fade, never slide; 150ms | **Rail.** The column fades in over `quick` while the page narrows; chat cards fade, never rise; mock `mocks/side-chat-motion-*.gif` |
| 5 | **Radio cards** in the rescan choice, `confirmModal` choices and Jira Export again (#733, #1010) | "A choice is never a full-width toggle or radio cards" | **Upgraded.** A choice inside a confirm is a real need: lookup row "A choice inside a confirm" → OptionList inside the ConfirmStrip or Dialog; never radio cards |
| 6 | **Search lands** on a setting with an amber wash and ring for 3s (#1034); lists land with a still 1.5s fill (`.is-landed`) | "The target lights once and fades over `flash`" (1.2s), neutral | **Rail.** One landing everywhere: the 1.2s neutral flash, focus on the target; search's amber ring and the lists' still fill go; lookup row "Finding anything" |
| 7 | An idle chat shows its **kind icon** in the status dot's place (#1053) | The rail mark is the state | **Upgraded.** An idle row has no state to show, so its kind helps: "a row with no state may show its kind's line icon in the dot's place, in `--ink-2`" (Small rules) |
| 8 | The **Sessions tab**: a bordered card per session, a 10-column table, warm `--sess-*` greys (#1067) | No box per item; one cool neutral family | **Upgraded.** Comparing figures across rows is a real need: a Table (divided rows, tabular figures, no box per row, narrow columns move to the row's detail); the `--sess-*` greys give way to the family's neutrals |
| 9 | **Automations**: a help paragraph under each switch, an Approve button on each event row (#1057) | Help in tooltips; a row's actions in its ⋯ | **Upgraded.** Help goes to tooltips (Rail); an event that asks keeps its one answer: "a row that asks shows its one answer as a quiet button at its right, the rest in its ⋯" (Small rules); rules, log and queue become list sections of the tab |
| 10 | The **copy button** widens to fit "Copied" (#980) | No reflow | **Upgraded.** The one shared copy button is right; Rail fixes the reflow: CopyButton shows a tick for 1.2s, `Copied` in its tooltip and live region, its width never changes (lookup row "Copying text") |
| 11 | The **group page title** keeps its kind chip (#967) | The title holds no chips | **Rail.** The group's kind moves into the metadata line, as the run page did |
| 12 | The Ask worca button drops its label at 1200px or with the terminal open (#954) | Labels drop at 480px | **Upgraded.** Dropping a label for room is right: "at 480px and below, or whenever the bar runs out of room (a side column takes the space)" (Narrow screens) |
| 13 | Picking another chat engine while a reply runs raises an **error toast** (#982) | A disabled control says why in its tooltip | **Rail.** The other engines are disabled while a reply runs, their tooltip says why; no toast |
| 14 | The **away screensaver** drifts and types (#1019) | Motion never runs without a state change | **Upgraded.** The one named exception in Motion: it starts after 5 idle minutes and is off under reduced motion |
| 15 | Requirements (Labs): 700 headings, pressed toggles for on and off, sheets at 900px (#989, #975, #1010) | No 700; Switch or Checkbox; 760px | **Rail**, when Requirements moves: 600, not 700; Switch for on and off, Checkbox for picking; a Dialog takes the window at 760px |

## New needs: what Rail takes in

All upgrades; each is now in docs/rail/.

| Need | In the app | In Rail now |
|---|---|---|
| A docked, resizable side column | the side chat (`aside#ask-side`): pushes the page above 1080px, covers it to 761px, full width below; 360–680px | Pattern "A side column"; the Feature chat uses it too |
| A conversation | the Chat transcript: cards on a 760px column, folded command rows, graph wells | Pattern "A conversation" |
| Copying text | `copyButton()`, one everywhere (#980) | Lookup row "Copying text" → CopyButton |
| One pick from a long list, or create | Add to group (#1004) | Lookup row "One pick from a long list, or a new one" → ListEditor, single pick |
| Finding anything | the top-bar search, now also settings and plugins (#1034) | Lookup row "Finding anything"; a result lands with the flash |
| A removable context chip | the composer's page chips (#954) | Lookup row "Context sent with a message" → ListEditor's removable item |
| A table or a log | Sessions, the Automations event log | Lookup row "The same figures across many rows" → Table; a log is a List |
| A list inside a settings tab | Automations' rules, log and queue | "A settings tab": records as list sections after its rows |
| A workflow graph overlay | the run card's Expand (#999) | "A form": a view that only shows is a Dialog without a form |
| A stepped setup | the setup assistant (#965) | "A form": one Dialog with the Stepper at its head, Back and Next in its foot |

## Settings: names that differ, Rail's stay

| In the app | In Rail |
|---|---|
| Developer rate | Hourly rate |
| Per-pipeline cost limit | Per run |
| Machine load | Capacity |
| Sync before run | Sync |
| Wait for the network | Offline |
| Spawn diagnostics | Diagnostics |
| Worca root, Projects root | Folders |
| My credentials | Credentials |
| Scheduled runs | Schedules |
| Smart run naming (its Settings card) | Naming |
| Workspaces | Scans |
| Limits & access | Abilities |
| Network proxy | Network › Proxy |
| Chat notifications › Channels | Chat › Channels |
| Engine for new chats | Chat › Engine |
| Team memory's Share existing notes | Share notes |

The Labs row keeps the registry's name, Git event automations.

## Already covered

Pausing… and Resuming… at the click (#969); the one-line run title (#967); a closed shell says why (#977); ⌘ and
Shift-click selection (#970); "Added to …" with Undo (#1004); credential slots as Chips (#1065, #1066).

## Merged after Agreed caught up (6 Nov)

| PR | In Rail |
|---|---|
| #1125 Try it's next step | The app's head buttons are not taken: Try it stays in ⋯ and says what is happening, then offers its next step (`tryStep`) |
| #1121 Actions progress | Changes › Actions: a service's button says `Starting…` while it works |
| #1123 Waiting on an interrupted run | Case `waiting-interrupted`: it keeps waiting while the run can resume |
| #1122 A missed start that came right | Pulse's row reads Resolved, with its run |
| #1149 Slack and Teams chat | Settings › Chat and Plugins; Pulse's channels |
| #1174 First-run fixes | Cases `no-remote` (Link remote, How to merge; Create PR needs a remote) and `mock-run`; New run says nothing that can run is signed in; setup's Review says not signed in. Its Settings › Runs filter box is not taken: Rail's search finds every row |
| #1168, #1162 and #1175 | No Rail page holds them |

## Usage and budget (6 Nov)

The rings show live usage of connected providers only, refreshed every minute; money is not a ring. The app's budget resets weekly or monthly (`costLimitResetPeriod`); Rail adds a daily reset, which needs its backend in Wave 1. So does a usage feed: the app has none today.

## Shared pieces that changed

`--sess-fill`, `--sess-head`, `--sess-line` and `--peach-ink-strong` were added to the tokens (no value changed);
`.status-dot` can hold an icon; the View menu gained segmented and radio-count items, and Requirements builds a second
menu (`.menu.hd-menu`); `confirmModal` takes `choices`; `.copy-btn` joins `.btn`; `.rd-route-*` uses the shared copy
button; `.tabs` did not change.
