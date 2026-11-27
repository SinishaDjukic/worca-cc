# Usage limits

Claude Code, Codex and Gemini each cap how much you can use them in a window of time. Worca shows how close each
provider is to its cap, so you can see it coming, and when a run hits one, it pauses and offers to pick the run back
up the moment the limit resets. This page covers the rings around your avatar, the **Usage** list in the account
menu, and what a run that hits a limit shows.

These are the limits of your plan with the provider, not what you spend. For money, see [Costs](costs.md).

## Where to find it

Click your avatar at the foot of the sidebar to open the account menu, then choose **Usage**. Its submenu is headed
**Limits**. **Usage** and the rings show only once a provider has reported a reading; until then there is nothing to
see.

## The rings around your avatar

The two rings around your avatar fill as a provider's limit is used up:

- The outer ring is the **Session** window.
- The inner ring is the **Week** window, or the **Day** window for a provider that has no week.

Each ring shows the provider that is closest to its limit. A ring is neutral until it reaches 80%, turns amber at
80% and red at 100%. A window that has reset is dropped, and a ring with nothing to show is not drawn.
A screen reader reads each ring as, for example, "Session · Codex: 86%, resets 14:50".

## Limits, per provider

**Usage** in the account menu shows the window closest to its limit, for example "Codex 86%", beside a small ring in
the same colours. Open it to see **Limits**: one block per provider, in the order Claude Code, Codex, Gemini, headed
by the provider's name and "as of" the time of its last reading. Each block has one row per window it reports:

| Window | Shows |
| --- | --- |
| **Session** | The share of the current session used, and when it resets. |
| **Week** | The share of the week used, and when it resets. |
| **Day** | The share of the day used, and when it resets. |

A row reads like "86%" and "resets 14:50". A reset today shows the time alone; a later one shows the day, such as
"resets Thu 09:00". At 100% the row says **Reached**. Hover a row to see which provider reported it.

The figures are whatever each provider last told Worca, while a run or chat was using it. They are not fetched on
demand, so a block can be a little behind; its "as of" time says how much. The exception is Gemini with a
Login-with-Google sign-in: its quota is read every 60 seconds while a Worca page is open.

## When a limit is hit

A run that reaches a provider's limit pauses and keeps its worktree and progress. Its page says
"Paused: Claude Code's session limit.", or "weekly limit" or "usage limit", depending on what the provider reported. The
Runs list shows "resets 18:00" next to it.

When the reset time is known, the page also says "It resets at 18:00, in 2h 14m." and offers a button,
**Resume at 18:05**. The time is five minutes after the reset, so the limit is surely clear. The same
**Resume at 18:05** appears in the **Resume** menu.

- **Resume at 18:05** schedules the resume. The page then says "Resumes automatically at 18:05" with a countdown,
  the Runs list shows "resumes 18:05", and at that time the run picks up on its own, with nobody there. Click
  **Cancel** to take the schedule back.
- If that time has passed with the run still paused, the page says "It reset at 18:00. Resume to continue." and you
  resume it yourself.
- If the scheduled resume was missed, for instance because Worca was not running, the page says "The scheduled
  resume at 18:05 was missed" and offers **Cancel**; resume it yourself, or choose **Resume at…** to pick another time.
- While it fires, the page says "Paused: resuming…".

Unless you turn on **Resume runs automatically when a usage limit resets** (Settings › Runs › Budget & cost limits,
off by default), nothing resumes by itself until you click **Resume at**. With it on, any usage-limit pause whose reset time is known
is scheduled for you, 5 minutes after the reset, on the same engine, at most 3 times in a row.
Cost caps still pause for you. For a time of your own, choose **Resume at…** in the
**Resume** menu instead. To carry on right away on another provider, see **Usage limits** in [Models](models.md).

## Related

- [Costs](costs.md): what you spend, and the limits on it.
- [Runs](runs.md): pausing, **Resume** and **Resume at…**.
- [Scheduled runs](scheduled-runs.md): runs and resumes at a time you pick.
- [Models](models.md): providers, and what to do when one runs out.
