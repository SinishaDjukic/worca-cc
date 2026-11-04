# Worca Rail: aligning with dev after the #919 split (4 Nov 2026)

What landed on dev since `c5c3fee69` (about 40 UI changes), checked against `docs/design-system.md` › Worca Rail. The
branch is merged with dev (`0d7cafe6d`); the prototype draws on the app's CSS parts (`prototype/app.css`); every gate
passes. Rail rules hold for Rail pages; the app keeps its rules until each page moves to Rail, so a conflict below is
fixed when that page moves, unless Rail decides to adopt the app's way.

## Decisions to make

Ordered by how much they matter to a person using Worca. Each: keep the Rail rule (the app changes when the page moves)
or adopt the app's way (the rule changes).

| # | App now | Rail rule | Question |
|---|---|---|---|
| 1 | Runs and Chats filter through a **View menu** button, Ready to ship among its options (#970, #1001) | "What the list shows is a sentence above it, not a filter button" | **Decided 4 Nov: the sentence, one shared way for every list.** When Runs and Chats move to Rail, the View menu's Show and Group by become words in the sentence, with counts; mock `mocks/runs-list-filter-*.png` |
| 2 | **Day sections fold** by hand; Older starts folded (#1036, `runs-list.mjs`) | "Sections never collapse; one that is too long shows less" | Keep (Older shows its first rows, then Show more), or allow a folded Older? |
| 3 | A **failed command group stays folded** in Chat, only a red `N failed` (#998) | "What has a problem opens by itself" | Keep (a failure opens itself once), or a Chat exception? |
| 4 | The **side chat dock** slides in over .32s (#954) and chat cards rise 10px (#972) | Motion: fade, never slide; 150ms | Keep (fade over `quick`)? |
| 5 | **Radio cards** in the rescan choice, `confirmModal` choices and Jira Export again (#733, #1010) | "A choice is never a full-width toggle or radio cards" | Keep (OptionList, or a picker in the confirm's sentence)? |
| 6 | **Search lands** on a setting with an amber wash and ring for 3s (#1034); lists land with a still 1.5s fill (`.is-landed`) | "The target lights once and fades over `flash`" (1.2s), neutral | Keep (one flash everywhere)? |
| 7 | An idle chat shows its **kind icon** in the status dot's place (#1053) | The rail mark is the state | Allow "an idle row may show its kind in the dot's place", or move the kind to the meta line? |
| 8 | The **Sessions tab**: a bordered card per session, a 10-column table, warm `--sess-*` greys (#1067) | No box per item; one cool neutral family | Keep (ListRows that open their detail, existing neutrals)? |
| 9 | **Automations**: a help paragraph under each switch, an Approve button on each event row (#1057) | Help in tooltips; a row's actions in its ⋯ | Keep? |
| 10 | The **copy button** widens to fit "Copied" (#980) | No reflow | Keep (reserve the width, or the tick alone with "Copied" in the tooltip)? |
| 11 | The **group page title** keeps its kind chip (#967) | The title holds no chips | Keep (kind in the metadata line)? |
| 12 | The Ask worca button drops its label at 1200px or with the terminal open (#954) | Labels drop at 480px | Keep, or allow "a label drops when its bar runs out of room"? |
| 13 | Picking another chat engine while a reply runs raises an **error toast** (#982) | A disabled control says why in its tooltip | Keep (disable, with why)? |
| 14 | The **away screensaver** drifts and types (#1019) | Motion never runs without a state change | A named exception (off under reduced motion), or reject? |
| 15 | Requirements (Labs): 700 headings, pressed toggles for on and off, sheets at 900px (#989, #975, #1010) | No 700; Switch or Checkbox; 760px | Keep, applied when Requirements moves to Rail? |

## New needs Rail does not cover yet

| Need | In the app | Proposal |
|---|---|---|
| A docked, resizable side column | the side chat (`aside#ask-side`): pushes the page above 1080px, covers it to 761px, full width below; 360–680px | A pattern, "A side column"; Requirements' Feature chat uses the same |
| A conversation | the Chat transcript: cards on a 760px column, folded command rows, graph wells | A pattern, "A conversation", its folded rows under What opens |
| Copying text | `copyButton()`, one everywhere (#980) | A lookup row, Copying text → CopyButton |
| One pick from a long list, or create | Add to group (#1004) | Say ListEditor covers a single pick, or a Picker row |
| Finding anything | the top-bar search, now also settings and plugins (#1034) | A lookup row; its landing is the flash |
| A removable context chip | the composer's page chips (#954) | ListEditor's removable item |
| A table or a log | Sessions, the Automations event log | A Table row, or "ListRow only" |
| A list inside a settings tab | Automations' rules, log and queue | The settings tab pattern gains a list section |
| A workflow graph overlay | the run card's Expand (#999) | Say it is a Dialog without a form |
| A stepped setup | the setup assistant (#965) | A stepped Dialog, or Rail rejects wizards |

## Already covered

Pausing… and Resuming… at the click (#969); the one-line run title (#967); a closed shell says why (#977); ⌘ and
Shift-click selection (#970); "Added to …" with Undo (#1004); credential slots as Chips (#1065, #1066).

## Shared pieces that changed

`--sess-fill`, `--sess-head`, `--sess-line` and `--peach-ink-strong` were added to the tokens (no value changed);
`.status-dot` can hold an icon; the View menu gained segmented and radio-count items, and Requirements builds a second
menu (`.menu.hd-menu`); `confirmModal` takes `choices`; `.copy-btn` joins `.btn`; `.rd-route-*` uses the shared copy
button; `.tabs` did not change.
