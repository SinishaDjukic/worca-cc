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
