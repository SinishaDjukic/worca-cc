# Small rules

| Rule | What | Why | Held by |
|---|---|---|---|
| `small.names` | A name is the thing, 1–3 words, a plain noun; one thing, one name | The same word everywhere | ds-check |
| `small.disabled-why` | A disabled control says why in its tooltip | It teaches what is coming and where | click-check |
| `small.no-emoji` | No emoji and no exclamation marks | Calm | by hand |
| `small.usage-rings` | Usage is rings around the avatar; its figures live in the Usage and costs side menu | One place for figures | pulse-sweep |

- **Names** (a page, a menu item, a section head, a settings row): the thing itself, as the people who use it call it,
  in 1–3 words, a plain noun first (`Budget`, `Labels`, `Away mode`, `Team policy`). One thing, one name: never two
  things joined by `&` or `and` (two things get two names); never `Your …`, `My …` or `This …`; never a phrase or a
  question (`What it may do`, `Up to date`); never a word made up for the screen. The same thing keeps its name
  everywhere: a menu item's name is its page's title. `ds-check` reads every name on a Rail page by this rule.
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
- Usage is rings around the avatar, outside in: session, the long window (week, day or month), spend (when a budget
  has a limit). Each ring shows its tightest harness and shades along its arc: `--ink-2` at the start, `--amber` at
  the warning line, `--red` at the limit; used up, full and solid red. Never green, never violet. Its figures live in
  one place, the account menu's Usage and costs side menu; a limit warns before it is spent only in New run, Resume
  and the confirm of a step that starts agent work, and only when the run's estimate does not fit in what is left
  (with no estimate, at the warning line).
- The needs-you count lives on Pulse's badge alone; the Runs row stays a place.
- Pulse is the panel under its top-bar button, with no page of its own. Every notification setting lives in one
  Settings tab, Notifications.
