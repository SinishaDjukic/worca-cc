# Worca Rail: Pulse, the notification hub

Status: concept, prototype only (`prototype/pulse.html`). No product code. Date: 2026-10-30.
Builds on [`plans/notification-hub-design.md`](../notification-hub-design.md) (Pulse Center, 22 Oct): its rule, event
catalogue, data model and phases stand. This spec redraws it in the Rail rules
([`docs/design-system.md`](../../docs/design-system.md) › Worca Rail) and adds **usage limits**: session and weekly
limit notifications, and the usage rings on the avatar, for Claude, OpenAI and Gemini.

## 1. What changes for a person

| Today | With Pulse |
|---|---|
| Activity popover (live state), Schedules' notification log, desktop alerts, chat notices and toasts, each with its own switches | One hub, **Pulse**, under one top-bar button: **Now** (live state, today's Activity) and **Updates** (what happened, stored, read and cleared) |
| Desktop switches in Settings › General › Alerts, chat switches in Settings › Chat | One page, **Settings › Notifications**: one row per group, one sentence per row |
| A usage limit is known only when a run hits it and pauses | Usage is visible before it stops anything: **rings on the avatar**, a **Limits** row in Now when one is near, and an update when it crosses the warning line, is reached or resets |
| The avatar ring shows spend against a budget | The avatar shows every window that can stop a run: **session**, **week**, and **spend** when a budget is set |

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

### 3.2 The popover (a glance)
- Tabs **Now** and **Updates**, each with its count as a caption (Rail: a count is a caption, never a chip).
- **Now**: the groups that have rows, in this order: Needs you (amber dot), Limits (amber or red), Running (peach,
  pulses), Scheduled (hollow). Empty: "Nothing needs you. Nothing is running."
- **Updates**: the latest unread rows, newest first. Empty: "You are up to date."
- Foot: **Open Pulse** on the left; **Mark all read** on Updates, on the right.
- A row opens its one target (Pulse Center §6.5) and marks it read. The popover is a view; it holds no fact of its own.

### 3.3 The Pulse page
One rail, as every Rail page:
- Title **Pulse**; the metadata line `2 need you · 1 limit near · 2 running · 5 unread` (each figure once; the
  popover links here).
- One action: **Mark all read**; ⋯ holds Clear read, Notification settings.
- Tabs **Now** and **Updates**.
- **Updates** is a divided list grouped by day (Today, Yesterday, Earlier), on the 20px rail: the unread dot, a title
  line, a meta line (group · project · detail), the time at the right. A `needs` row still open has the amber dot; once
  answered it reads Resolved.
- The list's sentence picks what it shows: `Showing [unread ▾] from [all groups ▾]`. Shows: Unread, All, Needs you,
  Problems, Cleared.
- Selection as the Runs list: tick boxes; the bar `2 selected · Mark read · Clear · ✕` replaces the sentence while
  anything is ticked. Clear is a soft dismiss with Undo in the toast; it does not confirm (it can be taken back).
  Clearing an open `needs` row leaves the run waiting; the bar's tooltip says so.

### 3.4 Settings › Notifications
Two sections, one rail. Every choice is a **picker in its sentence** (Rail: never a toggle row or radio cards).

**How Worca reaches you** (the channels)
| Row | Sentence | Notes |
|---|---|---|
| Desktop | `Desktop notifications are [on ▾] in this browser` · Send test | permission is per browser; when blocked, the row says so and how to allow it |
| Badge | `The tab title shows [what needs you ▾]` | choices: what needs you, what needs you and problems, nothing |
| Chat | `Sent to 2 channels: Telegram, Slack` · Manage | channels stay in Settings › Chat |

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
| Runs | needs_you, cost_cap, failed, paused, done, resumed | Needs you and problems | Desktop and chat |
| Schedules | missed, late, skipped, self_paused, ended, completed | Needs you and problems | Desktop and chat |
| Pull requests | fix_started, published, needs_person (watched PRs) | Needs you | Desktop and chat |
| **Usage and spend** (new) | usage.near, usage.reached, usage.reset, budget.threshold, budget.exceeded | Needs you and problems | Desktop and chat |
| Away mode | started, ended | Everything | Chat |
| Projects | clone, sync, scan | Needs you and problems | Pulse only |

- Usage and spend has one more picker in its sentence: `warn at [80% ▾]` (70, 80, 90%). It sets the line for the
  rings' amber, the Limits row in Now and the `usage.near` update.

## 4. Usage: session and week, three providers

### 4.1 The windows
| Provider (harness) | Short window, "Session" | Long window, "Week" | Where Worca reads it |
|---|---|---|---|
| Claude (Claude Code) | 5-hour session | weekly (all models; Opus weekly when the plan has one) | the rate-limit figures the harness reports with each turn |
| OpenAI (Codex) | 5-hour | weekly | the rate-limit figures Codex reports with each turn |
| Gemini (Gemini CLI) | none | **daily** requests (shown as "Day") | the requests Worca counted today against the plan's daily quota |

To check before building: which harness versions report the figures (Claude Code, Codex), and whether Gemini exposes
its quota or Worca must count. Where a provider reports nothing, its ring is not drawn and the card says
"Not reported by Gemini CLI" (never a made-up figure).

Figures are as fresh as the last turn that used the provider; the card says `as of 14:28`. A provider no run has used
in its window is not shown (quiet until needed).

### 4.2 The rings on the avatar
- The account corner keeps its place (sidebar foot; the rail shows the avatar alone). Around the avatar, concentric
  rings, outside in: **Session**, **Week**, **Spend** (only when a budget is set). At most three.
- Each ring shows its **tightest provider** (the highest share). Neutral `--ink-2` under the warning line, amber at or
  over it, red and full when reached (a reached limit is never hidden, as a blocked budget today).
- A ring a provider does not report (Gemini's session) is simply not drawn by that provider; if no provider in use has
  a session window, the session ring is not drawn.
- The avatar's tooltip says it in words, one line per ring:
  `Session 86% · Claude · resets 16:40` / `Week 41% · Claude · resets Mon 09:00` / `Spend $42 of $100 this month`.

### 4.3 The usage card (account menu)
The menu's first card, replacing the spend card and keeping its spend row:
- One block per provider in use: name and plan (`Claude · Max`), `as of 14:28`; then one row per window: a mini ring,
  the share (`86%`, amber or red text with the `-strong` inks when near or reached), and `resets 16:40`.
- Gemini's row reads `Day · 120 of 1,000 requests · resets 02:00`.
- Spend row as today (`$42 of $100 this month`).
- Every row's tooltip names its source (`Reported by Claude Code at 14:28`).

### 4.4 Usage notifications
| Event | When | Severity | Pulse row | Now |
|---|---|---|---|---|
| `usage.near` | a provider's session or week crosses the warning line (once per window) | problem | `Claude session at 80% · resets 16:40` | Limits row while it stays over |
| `usage.reached` | a window is used up; runs on that provider pause | problem | `OpenAI weekly limit reached · 2 runs paused · resets Mon 09:00` | Limits row, red, until reset |
| `usage.reset` | a window resets after it was reached | info | `OpenAI week reset · 2 runs resumed` | the Limits row goes |
| `budget.threshold` / `exceeded` | spend crosses the warning line / 100% of a budget | problem | `Spend at 92% of $100 this month` | Limits row |

`usage.reached` is the one notice for the provider; each paused run keeps its own pause notice on its page
(`limit-notice.mjs`, unchanged) and does not raise its own `run.paused` update for the same limit.

### 4.5 Where else a limit shows
Only where a person is about to spend: **New run** and **Resume** carry one grey line under the start button while
the provider is near or reached: `Claude's session is at 86% and resets 16:40. This run may pause and resume after.`
Nowhere else: not in the runs list, not on the run card (its own pause notice covers a run that stopped).

## 5. Page rules
- Every row reads from one left edge on the 20px rail; the dot is the state (amber needs you or near, red reached,
  peach running, hollow scheduled, blue unread).
- Unread is a blue dot on the rail, never bold text.
- Usage never uses violet (violet is merged and AI writing only).
- Every control has a tooltip; a disabled one says why.
- Clear, Mark read and pickers do not confirm; Reset to defaults does (the strip).
- The gate (`prototype/pulse-sweep.mjs`) holds for every case and view at 900 and 375px in both themes.

## 6. Decided
- Name: **Pulse** (from Pulse Center), not Hub (30 Oct).
- Gemini's daily window sits in the **Week** ring (the long window); the ring carries no label of its own, and the
  avatar's tooltip and the usage card call it **Day** (`Day 84% · Gemini · resets 02:00`) (30 Oct).

## 7. Open
1. Whether the warning line is one setting for all providers (proposed) or one per provider.
