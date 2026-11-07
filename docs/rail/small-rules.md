# Small rules

| Rule | What | Why | Held by |
|---|---|---|---|
| `small.names` | A name is the thing, 1–3 words, a plain noun; one thing, one name | The same word everywhere | ds-check |
| `small.disabled-why` | A disabled control says why in its tooltip | It teaches what is coming and where | click-check |
| `small.no-emoji` | No emoji and no exclamation marks | Calm | by hand |
| `small.sound` | A new event plays one soft chime for what the person chose; info never, a burst once, never in away hours | Hearing it is for what needs you; a sound that cries wolf gets turned off | design-system-logic |
| `small.usage-rings` | Rings around the avatar show live usage of connected providers only, refreshed every minute; figures and money live in Usage and costs | What is drawn is what can stop a run now | worca-sweep |
| `small.tooltip` | Every `title` is the library's Tooltip: quick on hover and on keyboard focus, a long-press on touch, inside the window | Help lives in tooltips, so they must be there when you look | design-system-components |

- **Names** (a page, a menu item, a section head, a settings row): the thing itself, as the people who use it call it,
  in 1–3 words, a plain noun first (`Budget`, `Labels`, `Away mode`, `Team policy`). One thing, one name: never two
  things joined by `&` or `and` (two things get two names); never `Your …`, `My …` or `This …`; never a phrase or a
  question (`What it may do`, `Up to date`); never a word made up for the screen. The same thing keeps its name
  everywhere: a menu item's name is its page's title. `ds-check` reads every name on a Rail page by this rule. Two
  exceptions: `Vitals`, the Pulse tab, a made-up word which only makes sense under Pulse; and `Usage and costs`, which is one thing.
- Money is a **budget**, a window is a **limit**: `Budget`, `Raise budget`, `Limit settings`, the Limits of Usage and costs.
  A run's own ceiling is its `Cost cap`.
- Hover is a tint, never a lift.
- A row with no state to show (an idle chat) may show its kind's line icon in the dot's place, in `--ink-2`; a row with
  a state shows its dot.
- A row that asks the person something shows its one answer as a quiet button at its right (`Approve`); the rest is in
  its ⋯.
- A disabled control says why in its tooltip. What the build cannot do yet stays visible and off, with the reason on a
  second line: it teaches what is coming and where.
- Progress cells stay neutral; colour sits only on the dot and the state word.
- No emoji and no exclamation marks in the interface.
- In a list you can select, the tick box takes the mark's place on the rail only while selecting, so the list keeps
  one text edge.
- Usage is rings around the avatar, outside in: session and the long window (week, day or month). They show live usage
  and nothing else: only providers connected right now (signing one out removes it at once), refreshed every minute; offline,
  the last figures stay with their time. Money is never a ring: a budget is set in Settings › Runs › Budget (a day, a week or
  a month) and read in Usage and costs. A ring's tooltip says what it shows, on two lines: `Weekly · Claude Code: 55%`, then
  `Resets Wed 5:00 PM`. With nothing connected no ring is drawn and Usage and costs says so, with its link. Each ring shows
  its tightest harness and shades along its arc: `--ink-2` at the start, `--amber` at
  the warning line, `--red` at the limit; used up, full and solid red. Never green, never violet. Its figures live in
  one place, the profile menu's Usage and costs flyout; a limit interrupts a start only in New run, Resume
  and the confirm of a step that starts agent work, and only when the provider is at or past the warning line.
- The needs-you count lives on Pulse's badge alone; the Runs row stays a place.
- Pulse is the panel under its top-bar button, with no page of its own. Every notification setting lives in one
  Settings tab, Notifications.
- Sound: `Play a sound for [what needs you ▾]` in Notifications › Channels; choices what needs you (the default), also
  problems, nothing. Only those play; info never does. A burst plays one sound. No sound during away hours. The chime is
  two soft notes generated in the browser (`playChime`), no audio file, and no error when the browser blocks it before
  the first click.
