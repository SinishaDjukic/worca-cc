# Worca Rail: Pulse, the notification hub

Status: concept, prototype only (`prototype/pulse.html`). No product code. Date: 2026-10-30.
Builds on [`plans/notification-hub-design.md`](../notification-hub-design.md) (Pulse Center, 22 Oct): its rule, event
catalogue, data model and phases stand. This spec redraws it in the Rail rules
([`docs/rail/`](../../docs/rail/README.md)) and adds **usage limits**: session and weekly
limit notifications, the usage rings on the avatar, the account menu's **Usage and costs** side menu, and what Worca
does when a run would start near a limit, for every harness and provider Worca runs on (Claude, OpenAI and Gemini
among them).

## 1. What changes for a person

| Today | With Pulse |
|---|---|
| Activity popover (live state), Schedules' notification log, desktop alerts, chat notices and toasts, each with its own switches | One hub, **Pulse**: the panel under one top-bar button, with no page of its own: **Now** (live state, today's Activity) and **Updates** (what happened, stored, read and cleared) |
| Desktop switches in Settings › General › Alerts, resume after a limit in Settings › Runs, chat switches in Settings › Chat | One tab, **Settings › Notifications** (after General): every notification setting and what a start does near a limit, one sentence per row |
| A usage limit is known only when a run hits it and pauses | Usage is visible before it stops anything: **rings on the avatar**, a **Limits** row in Now when one is near, and an update when it crosses the warning line, is reached or resets |
| The avatar ring shows spend against a budget | The avatar shows live usage only: **session** and the **long window** (week, day or month) of connected providers, refreshed every minute; each ring shades along its arc. A budget is set in Settings › Runs and read in Usage and costs |
| The account menu opens on the spend card | The menu keeps its rows; the spend card moves into its last row, **Usage and costs ›**, a side menu with every harness's limits and the spend |
| A run starts and pauses at the limit | Before it starts, Pulse checks the run's **estimate** (its size, and what runs like it used) against what is left: New run warns only when it will not fit and offers a harness with room or a start after the reset; slices, queued and scheduled runs move, wait, or let a smaller start that fits go first |

## 2. The rule that places everything

> **Now is a state. Updates is an event.** If it stops being true by itself, it is Now. If it happened at a time and
> stays happened, it is Updates. (Pulse Center §3, unchanged.)

Usage follows the same rule:
- "Claude's session is at 86%" stops being true when the session resets, so it is a **Now** row (group Limits).
- "Claude's session passed 80% at 14:20" happened, so it is an **Updates** row, and the event that can reach Desktop
  and Chat.

## 3. Anatomy

### 3.1 The top-bar button
- Label **Pulse**, the signal icon. One badge, in this order: amber = how many need you; else blue = unread updates;
  else nothing. Running runs do not badge it (they are not news); the button's tooltip says "2 running".
- Tooltip: what the badge counts, in words ("2 need you · 5 unread · 2 running").
- This badge is the one needs-you count: the Runs row in the sidebar carries none.

### 3.2 The Pulse panel (all of Pulse)
Pulse is the panel under its button, over whatever page is open; there is no Pulse page (a page would hold the same
two lists twice). On a narrow screen the panel is the window's width.
- Head: tabs **Now** and **Updates**, each with its count as a caption (Rail: a count is a caption, never a chip), and
  ⋯ at the right: Mark all read, Clear read, Notification settings. The body scrolls; the head stays.
- **Now**: the groups that have rows, in this order: Needs you (amber dot), Limits (amber or red), Running (peach,
  pulses), Scheduled (hollow; a slice, queued or scheduled run says what it will do near a limit, §4.5). Above them,
  the same sentence as every list: `Showing [everything ▾] from [all projects ▾]`, each choice with its count. Shows:
  Everything, Needs you, Running, Scheduled, Limits. From: all projects or one project; a limit belongs to a harness,
  so it ignores the project and goes only with Everything or Limits. The Now tab's count follows the sentence; the
  Pulse button's badge does not, so a filter never hides a run that waits. A run's section follows its state
  (`runState`, `sectionOf` in the library): Paused, Failed and Ready sort under Needs you, Waiting under Scheduled.
  Scheduled groups its rows: Missed, Today, Tomorrow, This week, Later, After a run. No selection: Now's rows are states and
  leave by themselves, so there is nothing to mark read or clear. Empty: "Nothing needs you. Nothing is running.";
  narrowed: "Nothing here right now."
- **Updates**: a divided list grouped by day (Today, Yesterday, Earlier), on the 20px rail: the unread dot, a title
  line, a meta line (group · project · detail), the time at the right. A `needs` row still open has the amber dot; once
  answered it reads Resolved.
- **The log's rules.** Updates are kept 90 days. Info rows arrive read; only what needs you and problems count as
  unread. A problem clears when it is acted on: its step (Run now, Resume, Try again) sits on the row, and taking it
  marks the row Resolved. On a shared sign-in, read and cleared belong to each person.
- The list's sentence picks what it shows: `Showing [unread ▾] from [all groups ▾]`. Shows: Unread, All, Needs you,
  Problems, Cleared. Empty: "You are up to date."
- Selection works exactly as in Runs and Chats: ⋯ › Select, ⌘ or Ctrl-click, Shift-click for a range, Space on a
  focused row, ⌘A, or a long-press on touch. Only then do tick boxes take the marks' place, and `Select all` sits at
  the sentence's right. The sentence stays. The Runs bar (`.runs-bulk`) sits at the panel's foot:
  `2 selected · Mark read 1 · Clear 2 · Cancel`. Each action shows how many updates it applies to and is disabled
  at 0. Cancel or Esc stops selecting, and so does unticking the last row. Clear is a soft dismiss with Undo in the toast; it does not confirm (it can be taken back).
  Clearing an open `needs` row leaves the run waiting; the bar's tooltip says so.
- A row opens its one target (Pulse Center §6.5) and marks it read; a Limits row opens Usage and costs. A desktop or
  chat notice opens the panel at its row.

### 3.3 Settings › Notifications
A tab of its own in Settings, after General, at every interface level. It holds every setting about what reaches you
and what a start does near a limit, so nothing about notifications stays elsewhere:
- **Alerts** leaves Settings › General: its Desktop notifications and Badge switches and Send test become the Desktop
  and Badge rows below (the same `alerts.mjs` values, per browser).
- **Resume runs automatically when a usage limit resets** stays in Settings › Runs, as its Paused runs row (it is how
  runs behave, not what reaches you); Notifications has a link row to it. The cost limits stay in Runs too.
- Chat channels stay in Settings › Chat (they are chat's own setup); the Chat row links there.

Three sections, one rail. Every choice is a **picker in its sentence** (Rail: never a toggle row or radio cards).

**How Worca reaches you** (the channels)
| Row | Sentence | Notes |
|---|---|---|
| Desktop | Switch · `Desktop notifications in this browser` · Send test | only on or off, so a Switch (a settings tab); permission is per browser; when blocked, the row says so and how to allow it; a browser without them, or an address that is not https:// or localhost, says that instead |
| Badge | `The tab title shows [what needs you ▾]` | choices: what needs you, what needs you and problems, nothing |
| Chat | `Sent to 2 channels: Telegram, Discord` · Manage | channels stay in Settings › Chat; Manage opens it |

**What reaches you** (the groups): one row per group, one sentence:
`Runs · tell me about [needs you and problems ▾] on [desktop and chat ▾]` · **Customise**
- Level: Needs you · Needs you and problems · Everything (an event qualifies by its severity).
- Where: Pulse only · Desktop · Chat · Desktop and chat. **Pulse always gets everything** (it is the record, and Clear
  is for noise); needs-you always reaches Pulse and the badge.
- **Customise** opens the group's events under it as divided rows, each with its own `on [desktop and chat ▾]`; a row
  that differs from its group says **Changed**. Back to group resets that group's exceptions.
- **Reset to defaults** sits at the top of the section and confirms in the strip (it changes every group).
- Groups and defaults:

| Group | Events (Pulse Center §4 ids) | Level | Where |
|---|---|---|---|
| Runs | questions, gate, recovery, workflow, cost_cap; failed; paused_limit, paused_error, paused_night, paused_time, paused_stopped; done, resumed | Needs you and problems | Desktop and chat |
| Schedules | missed, failed (could not start), run_error, run_paused, self_paused; late, retrying, skipped, canceled, ended, completed | Needs you and problems | Desktop and chat |
| Automations (follows the Labs feature Git automations) | approval; failed; started, skipped, queued, done | Needs you and problems | Desktop and chat |
| Chat (approvals) | run, web, workflow, schedule | Needs you | Desktop and chat |
| Pull requests | needs_person (watched PRs); open_failed (could not open a PR); fix_started, published | Needs you | Desktop and chat |
| **Usage** (new; usage limits and spend) | usage.near, usage.reached, usage.reset, usage.moved, usage.held, budget.threshold, budget.exceeded | Needs you and problems | Desktop and chat |
| Away mode | started, ended | Everything | Chat |
| Projects | clone, sync, scan | Needs you and problems | Pulse only |

- **Each kind has its own title.** Runs' needs-you kinds: Questions waiting, Approval needed, Recovery decision needed,
  Workflow to review, Cost cap reached. A pause says why: Usage limit reached (a harness that reports no window; one that
  does raises `usage.reached` instead, §4.4), Paused on error, Cost cap reached (the same event as the needs-you kind),
  Night guardrail reached, Time limit reached, Worca was stopped. Your own Pause and a drain (the server stopping) wait
  on nobody and never notify.
- Usage has one more picker in its sentence: `warn at [80% ▾]` (70, 80, 90%). It sets the line for the
  rings' amber, the Limits row in Now, the `usage.near` update and what "near" means below.

**When a limit is near** (the last section): what a start does when the run will not fit in what is left (§4.5).
| Row | Sentence | Choices (default first) |
|---|---|---|
| You start it | `New run and Resume near a limit [suggest one with room ▾]` | suggest one with room · pick one with room · start after the reset · start as chosen |
| Worca starts it | `A slice or scheduled run near a limit [moves to one with room ▾]` | moves to one with room (else waits) · waits for the reset · starts anyway |
| Paused runs | `Set in Runs` · Open Runs | a link row: the choice lives in Settings › Runs › Paused runs (5 minutes after the reset, `limit-resume.mjs`), and the link lands on that row |

## 4. Usage: any harness, any window

### 4.1 The windows
Usage is read for anything a run can spend against: a harness's own sign-in, or a provider through the bridge
(`docs/models.md`). Each has at most two windows: a **short** one (the session) and a **long** one (a week, or a day or
a month where that is the only one).

| Harness or provider | Short window | Long window | Where Worca reads it |
|---|---|---|---|
| Claude Code (Claude) | 5-hour session; **none on Ultra** once the account is verified (Anthropic, 30 Oct 2026) | week (all models; Opus week when the plan has one); Ultra keeps it | the rate-limit figures Claude Code reports with each turn |
| Codex (OpenAI) | 5-hour | week | the rate-limit figures Codex reports with each turn |
| Copilot (GitHub) | none | month: premium requests | read from the provider (used of entitlement) |
| Cursor | none | month: requests, where the plan has a cap | not reported today: "Not reported by Cursor" |
| Gemini (Google) | none | day: requests | reports nothing: the person sets its daily quota in Settings › Providers and Worca counts against it; with none set, no ring and a link to set it |
| OpenRouter free models | none | day: free requests | the count the spend card shows today ("Free requests today") |
| An API key (any vendor) | none | none: billed per token | the spend and its budget are its limit |

Plans are named as their vendor names them: Claude's Pro, Max (was Max 5x) and Ultra (was Max 20x). A plan with no
short window shows only its long one, and its block says why in one line (`No session limit on Ultra`); the session
ring then shows the tightest harness that has one, or is not drawn.

To check before building: which harness versions report the figures (Claude Code, Codex), and each quota Worca has to
count itself. Where nothing is reported, the side menu says so and draws no ring (never a made-up figure). Figures are
as fresh as the last turn that used the harness (`as of 14:28`). A harness no run has used in its window is not shown
(quiet until needed); there is no fixed list of three.

### 4.2 The rings on the avatar
- The account corner keeps its place (sidebar foot; the rail shows the avatar alone). Around the avatar, concentric
  rings, outside in: **Session** and the **long window**. At most two.
- The rings hug the avatar: 1px lines, 1.5px apart, the innermost 1.5px off the 24px avatar (38px in all). In the menu
  row and the side menu the small ring is 1.25px and 1.5px.
- Each ring shows its **tightest harness** (the highest share): with Claude Code at 48% and Codex at 12%, the session
  ring shows 48%.
- **Each ring shades along its arc**: `--ink-2` at the start, `--amber` at the warning line, `--red` at the limit. It
  shows how far it has filled, so the colours it reaches say how close it is; a ring under the line never reaches
  amber. Used up, it is full and solid red (a reached limit is never hidden). The track is `--line-2`. Never green
  (green is done) and never violet. The same ring, smaller, leads each row of the side menu and the menu row.
- A ring no harness in use reports is not drawn (with only Gemini in use there is no session ring).
- The avatar's tooltip says it in words, two lines per ring: `Weekly · Claude Code: 55%`, then `Resets Wed 5:00 PM`.

### 4.3 The account menu and its Usage and costs side menu
The account menu keeps today's rows (`#acct-menu`) and becomes a panel in the Rail sense (it opens over any page from
its corner). Its rows are grouped by what they are about and ordered by how often they are used, rarest at the top,
since the menu opens up from the avatar and the bottom is nearest the hand:
1. **Worca**: Interface mode ›, Appearance (System, Light, Dark), Settings. How Worca looks, and the door to
   everything else; changed rarely. Appearance moves up beside Interface mode (both are how Worca looks).
2. **You**: Away, Keep awake. Flipped daily, when you step away.
3. **Usage**: Usage and costs ›, right above the avatar whose rings it explains: the rings and their figures are one
   move apart. The spend card becomes this one row.
- **Usage and costs ›**: the small ring of the tightest window, the label, its share as the value (`86%`, or `Reached`;
  the spend when no limit is reported), the chevron. Tooltip: `Closest to its limit: Session 86% · Claude Code · resets 16:40`.
- It opens a **side menu** beside the menu, as Interface mode does (`side-flyout.mjs`, mode `beside`). On a narrow
  screen it opens in the menu's place, with a row back (`‹ Account`).
- The side menu, top to bottom:
  - **Limits**: one block per harness in use: its name, then vendor and plan (`Claude · Max`), and `as of 14:28`; one
    row per window: the small ring, the window (Session, Week, Day, Month), the share or the count (`48%`,
    `212 of 300`, amber or red text with the `-strong` inks), and `resets 16:40`. An API key reads `Billed per token: no
    session or weekly limit`. Each row's tooltip names its source (`Reported by Claude Code at 14:28`).
  - **The spend card** (`renderSpendCard`): Spent and Saved, or Limit and Spent with its ring. Its title, `Spend this
    week`, is the link to Statistics (a text link, `--blue-ink-strong`, 600); the Details button goes. OpenRouter's free-request row leaves the card: it is a block in Limits now.
  - **Limit settings**: opens Settings › Notifications.

### 4.4 Usage notifications
| Event | When | Severity | Pulse row | Now |
|---|---|---|---|---|
| `usage.near` | a harness's window crosses the warning line (once per window) | problem | `Claude Code session at 80% · resets 16:40` | Limits row while it stays over |
| `usage.reached` | a window is used up; runs on that harness pause | problem | `Codex weekly limit reached · 2 runs paused · resets Mon 09:00` | Limits row, red, until reset |
| `usage.reset` | a window resets after it was reached | info | `Codex week reset · 2 runs resumed` | the Limits row goes |
| `usage.moved` | a slice or scheduled run started on another harness because of a limit (§4.5) | info | `Slice 2 of 4 moved to Codex · Rate limiting` | — |
| `usage.held` | a slice or scheduled run waits for a reset (§4.5) | problem | `Slice 3 of 4 waits for 16:40 · Rate limiting` | Scheduled row says so |
| `budget.threshold` / `exceeded` | spend crosses the warning line / 100% of a budget | problem | `Spend at 92% of $100 in October` | Limits row |

`usage.reached` is the one notice for the harness; each paused run keeps its own pause notice on its page
(`limit-notice.mjs`, unchanged) and does not raise its own `run.paused` update for the same limit.

### 4.5 When a limit is near: check the estimate, warn before it starts, give the run to a harness with room
A run that starts on a harness without room for it may pause halfway; the time to say so is before it starts. Pulse
does not guess from the share alone: a small run at 86% still fits, a large one at 70% may not.

**The estimate.** Each run has one before it starts, from two things Worca already has:
- its **size**: Shaper's assessment (`small`, `medium`, `large`; `shape/nudge.mjs`), shown in New run as a picker in
  its sentence (`A [large ▾] task`) so a wrong size is corrected where it is read;
- **what runs like it used**: the median, per window, of done runs with the same agents and size in the last 60 days
  (`shape/estimate.mjs` medians, split by size), read from the harness's usage before and after each run. A harness's
  own figures, since a Codex session is not a Claude session. Fewer than 3 such runs: no estimate.

**Near** is then: the run's share plus what is used is over 100% in any window of the harness (`needs about 28% of
Claude Code's session; 14% is left`). With no estimate, it falls back to the warning line (at or over it). A harness
with room is one where the run fits.

**A harness with room**: set up, able to run every agent of the run's workflow (the engine locks of
`engine-locks.mjs` hold), and the run fits there (with no estimate: every window under the warning line); the one with
the most room first. Each agent runs the same tier on it (`model-tiers.mjs`), so the switch keeps the run's shape.
With none, the only offer is the reset.

**You start it** (New run, Resume). New run is a Dialog (a form): it opens with the one sentence that frames the step,
`A [large ▾] task on [Claude Code ▾] in web-app · about 12% of its session, 52% left` (the figures only while it fits;
the note says them when it does not, one place per fact), then the task Field. The harness picker shows each choice's
windows and what this run adds: `session 86% +28, week 52% +7`.
When it fits, nothing more (quiet until needed). When it does not, on the rail with an amber dot, one note, by the
setting:
- *suggest one with room* (default): `This run needs about 28% of Claude Code's session; 14% is left until 16:40. It
  may pause before it finishes. Codex has room.` · **Run on Codex** · **Start at 16:40**. Run on Codex changes the sentence; Start at turns
  the start button into **Start at 16:40** and the note says when, with **Start now instead**.
- *pick one with room*: the sentence opens on Codex, and a grey line says why: `Worca picked Codex: this run needs
  about 28% of Claude Code's session and 14% is left.` Changing it back is the sentence.
- *start after the reset*: the start button is **Start at 16:40** from the start, with Start now instead.
- *start as chosen*: the note alone, no buttons.
- Used up (red dot): `Codex's weekly limit is used up until Mon 09:00. It starts at Mon 09:00, when that resets.` A
  harness with room is still offered; Start now is not (it would only pause).

**Worca starts it** (a Shaper slice, a queued run, a scheduled run): nobody is there to ask, so each start is checked
against its own estimate when its turn comes, follows the setting, and says what it did:
- *moves to one with room* (default): it starts on the harness with the most room and **keeps it to the end** (a run
  never changes harness halfway); an update `usage.moved` says so. With none, it waits.
- *waits for the reset*: it starts when the window resets; `usage.held`.
- *starts anyway*: as today; it may pause and resumes by itself after the reset (`limit-resume.mjs`).
- **Reprioritise**: a start that waits does not hold up the line. The next start that fits goes ahead of it on that
  harness (`Rename the config flag · Goes ahead of slice 3 of 4 on Claude Code: it fits, about 4% of its session`), so
  the window left before the reset is used by work that can finish in it. Order is otherwise kept, and a slice still
  waits for the slice before it.
- **Slices**: slice k starts when slice k-1 is done (`shape-it-first.md`); the rule applies at that moment, per slice.
  Moving a slice does not touch its branch (it still starts from slice k-1's branch). Before it starts, its row in Now ›
  Scheduled says what it will do: `Will start on Codex: it needs about 28% of Claude Code's session, 14% is left`, or
  `Waits for 16:40: …`. With
  **Ask me before each run** on, the plan stop shows the same note as New run.
- A run already running is not moved; its Running row and the Limits row say it may pause.

### 4.6 The profile menu around it
Above the rows, only on a shared sign-in: the **Signed in as** card. In its first section, until looked at: **Your team
updated the recommended setup** · Review. In Usage, while a budget has stopped runs: **Raise limit**, which lands on
Settings › Runs › Budget. The avatar wears the away dot while you are away; the Away row's hint and tip say where you
stand (`away at 22:00`, `until 07:00`, `Away mode paused`), and it is disabled with why when away mode cannot be read.
Interface mode writes `prefs.setMode`; the sidebar and every page follow it.

## 5. Page rules
- Every row reads from one left edge on the 20px rail; the dot is the state (amber needs you or near, red reached,
  peach running, hollow scheduled, blue unread).
- Unread is a blue dot on the rail, never bold text.
- Usage rings shade along the arc (`--ink-2`, `--amber` at the warning line, `--red` at the limit); never green or violet.
- Every control has a tooltip; a disabled one says why.
- Clear, Mark read and pickers do not confirm; Reset to defaults does (the strip).
- A limit warns in one place before it is spent: New run and Resume (and the plan stop of a slice that asks first, and
  the confirm of a step that starts agent work, such as Fix checks).
  Nowhere else: not in the runs list, not on the run card (its own pause notice covers a run that stopped).
- The gate (`prototype/pulse-sweep.mjs`) holds for every case and view at 900 and 375px in both themes.

## 6. Decided
- Name: **Pulse** (from Pulse Center), not Hub (30 Oct).
- Gemini's daily window sits in the **Week** ring (the long window); the ring carries no label of its own, and the
  avatar's tooltip and the usage card call it **Day** (`Day 84% · Gemini · resets 02:00`) (30 Oct).
- One warning line for all providers: the `warn at [80% ▾]` picker in Usage, not one per provider (30 Oct).
- No Pulse page: the panel under the button is all of Pulse (30 Oct).
- Settings › Notifications is a tab of its own, after General; Alerts and resume after a limit move into it (30 Oct).
- A start near a limit is judged by its estimate (size and history), not the share alone; a start that waits lets the
  next one that fits go first (30 Oct).
