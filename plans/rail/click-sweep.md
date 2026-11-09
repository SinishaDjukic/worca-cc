# Click sweep, round 1 (8 Nov)

Ten agents, one area each, every control and dropdown option, each result checked. A line leaves this list only when fixed and
re-checked. Scripts: scratchpad `sweep/<area>/`.

Three rules for fixing: a toast says only what happened; a control acts, or is disabled and says why; a design finding that no
rule covers gets its rule (docs, catalog, component, test, gallery).

Mock limits: nothing real exists behind GitHub, files, the terminal or the clipboard. A control that would open one may say
what it would do ("Would open #1180 on GitHub"), never that it did. Reload losing mock state is accepted.

## Shared and shell

- S1 Every toast Undo throws `u.run is not a function` (pulse.js:725,:820,:948 want `{tip, run}`; schedules.js:65, workflows.js:241,245, projects.js:162,167, workspaces.js:92 pass a function)
- S2 By, Then, Of menus (`pz-menu is-two-cols`) flow into 3 columns, 620px, heads split from options, past the page edge, over the chart (Rail has no rule for keeping a head with its options: add it)
- S3 sentencePicker's `<div class="menu">` inside `<p class="convo-head">`: the parser ejects it; Marketplace sort opens below the viewport, "first" stranded (marketplace.js wayHtml); c6 "as one PR" menu at y=-23 (conversation.js:336,:588). Check every sentencePicker inside a `<p>`
- S4 ▾ quick nav ignores Esc (shell.js:377-380)
- S5 Cold load in Simple and Advanced: nav and quick nav lack Workflows, Projects, Manage until a mode or flag changes (shell.js:56-58; first applyPrefs at :514 runs before place scripts)
- S6 Dark theme does not survive reload
- S7 ⌘K "Ask Chat: x": Chat opens with no chip, no text, toast claims it asked (pulse.js:589)
- S8 ⌘K locked result lands on #runs, no line (should reach the lock line, nav.locked)
- S9 ⌘K: "insights" and "tasks" find no place; one thing listed 2-3 times; feature titles not found; "requirements" returns Plugins › Jira
- S10 Ctrl+K on #chat focuses the composer, not search
- S11 Simple: Insights, Workflows, Projects open fully while the menu hides or locks them; decide one truth per place and apply to nav, quick nav and locks (`#insights` has no bar in Simple). The sidebar data says workflows and projects are Simple
- S12 nav.labs: places menu has no Labs word on Requirements; word falls short of the row end; "Turn on Labs" gives no way back
- S13 "Shared session" and "Requirements first" flags change nothing (set.flags); Run telemetry locked
- S14 Bad addresses (`projects/nope`, `requirements/NOPE`, deleted schedule) silently show something else: say not found, with a way on
- S15 Reset view is disabled with a tooltip describing the action, and on Tasks a tooltip contradicting the sentence

## Chat home and cards (chat/)

- C1 @ mention: pick writes into Schedule's time (`cp-at|` vs `cp-mention`, conversation.js:127,593,617); list never narrows (:785)
- C2 c7 Workspace card Remove throws toLowerCase (conversation.js:718, workspaces.js:100)
- C3 ⋯ Ask about it puts plain text, no chip (c0,c5,c6,c7,c9,c10,c12; conversation.js:388,581)
- C4 Long unbroken text runs off the window (message bubble; a 150-char label pushes the chat head past 1440)
- C5 Send with empty box: no reason shown
- C6 + Ticket or Shape in Schedule mode silently switches to Task
- C7 Pin toasts Pinned, row neither moves nor marks
- C8 Voice: Mic only toasts; Hands-free item reads as state
- C9 Follow a task only opens the chat; capped at 6 (:600)
- C10 Schedule send ignores typed time and says the picker's
- C11 Menu items that only echo their label: Label…; c5 Re-plan the rest, Cancel the rest, Ask before each task, Open the plan; c6 Fix all, Update for other perspectives, Save to plans/, Open in the composer, Stop; split Fix all, Undo edits, Ask me before each task, Stop
- C12 Toasts claiming what did not happen: Opens the changes (c2,c9), Opens/Downloaded invoice (c14), Opens #1180 (c19), terminal pane (c2), c1 Run now, c5 Stop
- C13 c5 Open its full page dead; + Reuse last task and Docs only dead; c6 last slice Merge with next dead; "Approve 1 tasks"
- C14 c14 chip opens a new chat, not c1
- C15 rail.stay-in-chat in Simple and Advanced: c1 facts leave for pages ($1.84, 5 files, 2 artifacts, Open, export.mjs:41); 5 files and 2 artifacts go to the same place
- C16 "1 rounds"; c9 Make 0 tasks disabled, no reason; every-list has no weekend, "every hour … at"; stage knots focusable and dead (T2)
- Design: c9 grid edges differ (rail.one-rail); c7 Remove 10px off the text edge; c1 same fact three times (rail.one-place); c7 Delete schedule no confirm (act.confirm); ticks with no tooltip; More menu covers Continue; "from" orphaned at a line end; + menu flat with no heads; Files always attaches a fixed chip

## Tasks and Schedules (runs/, schedules/)

- T1 Resume and Restart land on another task (run-page-model.js FLOW, ~:903)
- T2 Stage labels and What you asked, What broke, The plan blocks focusable and dead
- T3 Create PR with empty title: nothing, no message; Stop writing while nothing writes
- T4 Empty sections drawn (list.sections); group-by counts mix units (date 5, state 51, project 6)
- Design: track and stage list carry the same stages (rail.one-place); waiting vs Upcoming (small.names); Show 1 more has no way back
- H1 Run now from row menu and chat card starts nothing; page's Run now only adds a local card; twice adds two (schedules.js:26, conversation.js:654)
- H2 Deleted schedule stays in RailWorld, so Pulse lists it (schedules.js:11)
- H3 After Delete: chat card still has Run now and Open; page stays on its URL with a blank composer
- H4 Time or repeat change leaves bar and chat row stale, wrong section (schedules.js:75-77)
- H5 "Next on hour 07:30", "Next on month on the 1st 07:30"; every hour keeps "at"
- H6 s3's missed reason overwritten by any pick; toast on paused says "Runs"; Skip repeatable, task vs run; hover-only ⋯
- Design: paused head offers Run now, not Resume (rail.one-action)

## Workflows, Marketplace, Requirements

- W1 Auto-align Undo does not restore (shared `ed.g`, workflows.js:130,209)
- W2 Use as a template twice: same id (:172)
- W3 Pin to Chat: starter never appears
- W4 Your team's says 5, shows 2 (TEAM constant); Marketplace workflows 24 hardcoded (:37)
- W5 Canvas edits built-ins, against "a built-in reads as it is"
- W6 Canvas Fit only sets 100%, graph clipped under the inspector, starts tiny
- W7 Try it on a task no toast; Flow rows say drop, nothing drags; Ask worca names a stale task
- W8 Model change leaves $ unchanged; same value counts as a change ("Draft 36 changes"); "Codex high high"
- W9 No rename on canvas; script "Runs" reads "Tasks Node.js"
- Design: step facts three times on a page (rail.one-place, no rule for pages); card actions do not line up across a row; graph nodes tabbable and static
- M1 Add source claims plugins; none added, name cut, duplicates, 300 chars overflow
- M2 Sync says 6 plugins, list has 8
- M3 Settings › Plugins is separate seed data, disagrees with Marketplace (installed set, 12 vs 8)
- M4 "newest" compares version strings
- Design: Install offered twice on a plugin page; source stated twice
- R1 FEAT-1 Answer, row menu and Send open unrelated c5 (requirements.js:17); dock loses the project
- R2 Undo leaves head stale; FEAT-5 restored as Ready with checks Not yet
- R3 Copy as Markdown, Save to specs/ claim what did not happen
- R4 Decide below on the list does nothing; archived menu has Restore twice, head no action
- R5 Double click on Start building hits Open its task; "1 questions"
- Design: FEAT-2 fact three times; head primary only scrolls (rail.one-action); locked card off the text edge

## Projects, Workspaces, Insights, Settings

- P1 Sync says Synced, project stays behind; IoT says 1 and skips the diverged (workspaces.js:25,44)
- P2 Remove project leaves it in its workspace
- P3 Edit by hand, Save: editor stays open
- P4 Show its tasks not filtered (with I1: Tasks must accept a filter)
- P5 Source links on questions dead (workspaces.js:62)
- P6 Long names and tags overflow; Esc does not close by-hand form; Enter or Esc dead in Cost tags
- P7 Simple leaks workspaces: Also in, inherited tags, `@legacy`
- P8 Duplicate cost tags; toast when nothing changed; existing workspace name silently opens it; Scan again on a missing folder; "1 commits"
- Design: Memory picker and Team memory contradict; "1 question" means two things (list.one-end); Discard vs Discard it (rail.drafts); map clips "Also in Web shop"; 420px map clipped; Yes or No has no Undo
- I1 Rows, bars, Tag: "narrowed" lands unnarrowed (insights.js:131,187-190)
- I2 When › custom does nothing visible (:167-168)
- I3 Chart and table always by day while By says stage or week; make chart and table follow, or say so
- I4 "with no comparison" still shows The period before and Difference
- E1 Budget $1,000 in Settings, $2,000 in Insights
- E2 Budget Change… on bad input: no message, Save enabled
- E3 Plugins Open in Chat goes to Settings › Chat
- Design: Settings Change… column misaligned (set.one-row); Chat names two rows (small.names)

## Coverage still owed (second pass)

Tasks about 110 states and Retry, Stop, viewers, tabs; Marketplace Expert; Settings non-dropdown controls; Insights' other 15 pages in Simple and Advanced; Requirements full click-all in each mode; Chat's folds and Show more; Schedules' row menus outside Expert.

# Click sweep, round 2 (9 Nov)

Round 1's lines were re-tested; those not repeated below held. Same rules as above. "Would…" for anything real behind it.

## Shared and shell (A)

- A1 By, Then, Of with 33 options: fixed height makes extra columns, 3 of 7 groups unreachable (rail.css:1821); groups whole, inside the page, scroll inside (S2)
- A2 Workflows and Marketplace both listen on the shared bar: click a row after visiting both throws `_way`/`_lib` (marketplace.js:106, workflows.js:203)
- A3 `?` opens nothing on Tasks, Chat, Schedules (pulse.js:905)
- A4 ⌘K Ask Chat attaches "Page · Tidy the migrations": pageContext takes the first `[data-title]` (shell.js)
- A5 Task counts: bar, top bar and In view never follow an action on a task page
- A6 Keep in view acts on the wrong task (`#run/working`)
- A7 Hide the bar: no way back but ⌘\; pointer doesn't open the strip; Chats strip icon dead (shell.css:191)
- A8 Long text in toasts runs full width over the composer; clamp in the library. Search rows repeat "Place"; "dark" finds nothing
- A9 Row ⋯ only by hover: no touch, no visible focus (shell.css:106, was H6)
- A10 Esc does not close confirm strips or forms (Remove, Delete, Edit by hand, Install): keyboard.md, in the library if possible
- A11 Disabled menu items still act (`aria-disabled` in the composer menu, C6); disabled rows show a pointer
- A12 Simple: `#schedules` bar works beside its lock; `#schedule/s2` opens; Advanced `#insights/team`, `untagged` show Spend with no lock line

## Chat (B)

- B1 Schedule send leaves the text in the box
- B2 @ mention puts the caret at 0; second @ does not open (conversation.js:646)
- B3 150-char label: menu to x=1431, scroller gains a bar, toast prints it all
- B4 "Move through this chat" menu stays open after a pick (:495)
- B5 Schedule starter's proposal says Task; "Schedule a task" vs "Schedule a run"
- B6 Rename: empty does nothing, no message; Label on a task labels the chat, toast says task
- B7 Toasts: "Changes: changed", "Workflow: changed", "Agent: changed", "Away: changed", "Settings: changed"; "Opened PR #1104", "Ran scripts/…", "Applied 3 files"
- B8 c1 "4 artifacts" opens "Artifacts3"; Latest is invisible and focusable; disabled Move up/down, Undo edits, Merge with next give no reason; "Update for other perspectives" same as "Open in the composer"
- B9 Chat "Make a workspace": ignores what you typed, names Billing with a non-project, Create says changed, nothing appears

## Tasks and Schedules (C)

- C1 Stage rows on the task page have no handler (`data-turn-toggle`, kind-mark.mjs:150; about a quarter of a page's clicks). Open that stage's detail, or render as not focusable (confirmed by hand; T2)
- C2 Resume at…: button says "Cancel 14:00" after 17:45; accepts anything
- C3 Save as preset names another task; "A new task with the same task"; "Start a new task" vs "Start a new run"
- C4 task and run mixed on one surface and flips after an action (small.names; add the rule if missing)
- C5 Toasts: Terminal opened, Checked out, Install running, Downloading, Saved, Copied → "Would…"; Try it first leaves the dialog open
- C6 `#run/auto` Answer it in the card dead; delete of a group or feature no toast; Approve 3 runs changes the title; breadcrumb tooltip says Runs
- C7 Group-by counts mix units (sections vs tasks)
- C8 Tasks narrowed with no tasks says "Nothing here with these words", no way on
- C9 Schedules: Resume from row loses Cost report (no `day`); run card Open lands on a chat without it; "Ask about this schedule" Enter does not send, no chip, no project; Skip overwrites missed reason; paused chat card offers Run now; same-value toast; "Next at 09:00" with no day

## Workflows, Marketplace, Requirements (D)

- D1 Export's format picker closes the form (workflows.js:110, toggle ~:248); Export toasts → "Would export"
- D2 Copy keeps 41 tasks, 92% merged; canvas adds a same-named step; empty name reverts silently
- D3 Bad addresses in Workflows and Requirements still show another page (S14)
- D4 Canvas Fit is only 100%; zoom pushes nodes past the inspector; starts at 54%
- D5 Try it, AND, OR, Combine hand over a chip without the step or flow
- D6 Requirements: Open its task lands in an unrelated chat, no project, no chip
- D7 Install adds no agents or workflows to Workflows' lists and counts; Esc and Enter in forms; most used is really installed-first; sort on 0-1 items; head lists every source; local source has the GitHub mark
- Design: Use it twice on a workflow page (rail.one-action); Built-in twice

## Projects, Insights, Settings (E)

- E1 legacy-billing row menu: Remove… twice, first dead (projects.js ~:85)
- E2 Check origin says Checked with no folder or no git; Scan again starts nothing
- E3 "1 commits"; page and bar disagree in Simple; toast with no change, after clearing; "web-shop" silently opens Web shop; 768px map clips; "18 tasks" vs Tasks list 12, "3" vs 1; needs you 5 vs Needs you 4; workspace row menu lacks head's items; "3 more" has no way back
- E4 Drag-narrow lost on click-through; bars say Nov 1 but Tasks opens a bucket (insights.js:131)
- E5 Headline "Up 28% … period before" under "with no comparison"
- E6 Automations Approve starts nothing; Labels rename accepts empty and duplicates
- E7 General folders, Hourly rate, Budget per-run accept bad values; toasts → "Would…" (changelog, repo, bug, guide, test notification, test Telegram, copied)
- E8 "…until you act on it once you open it"; "1 task … finished runs"; Delete Strict and Frontend do not say what follows (act.confirm); Simple shows Proxy and per harness

## Still owed after these

Chat cards full click in Advanced and Expert; Dialogs in Simple and Advanced on Settings; Settings' Models, Memory, Guardrails, Connectors, Plugins judged; `~scripts`, `~team`, `~for-you`, `~drafts` crawl in Advanced and Simple; Marketplace's other plugin pages; narrow screens everywhere; Tasks persistence and repeated actions.
