# The look: type, colour, surfaces

| Rule | What | Why | Held by |
|---|---|---|---|
| `look.type-roles` | Every text takes a role from the scale; a head is never weaker than what it heads | The hierarchy reads the same everywhere | ds-check |
| `look.tokens` | Colours, sizes and corners come from tokens, one family of neutrals, one surface; each state colour is one value per theme: `--amber`, `--red`, `--green` and `--violet` are the ring, the word and the fill alike, and their `-ink` names only point at them; rings and done squares are `--ink-2` | A page has no look of its own, and one colour never drifts into two | ds-check |
| `look.stage-line` | A thing's stages on a card are one line, Rail's own (StageBar): a knot at each stage, filled when done; the stage it is on holds its steps as short notches between its knot and the next, done ones solid, the one now breathing slowly and faintly (progress, not a call), and its name carries the count (Review 2 of 3); the state's colour marks only the stage it is on; done stages and a finished or merged line are ink (`--ink-2`), never green or violet; with reduced motion the step stands still | The card shows where a task is and how far into its stage, at a glance, in one line | design-system-components |
| `look.chart` | A number over time is a BarChart unless you ask otherwise: one question, one series, thin ink bars on the baseline, the current period darkest, a number only on the highest and the current, each bar's value on hover and focus and in a table for a screen reader; by default no legend for one series, never a grid, a stat tile, a second axis or a colour | A chart answers one question and reads in both themes without colour | design-system-components |
| `look.chart-play` | Bars stay the default for one number over time; other forms (lines with a dashed comparison, a running total against its budget, a stacked mix, a table) appear only when you ask, and only those that fit the number. A comparison or a mix may have a small legend; a mix is ink shades, never hues; never a second axis: two numbers of different kinds are two charts. Hover or focus reads a point with its difference (+$27, +41%) in the band above the plot, never over the line; a click or Enter opens its tasks; a drag across narrows every number on the page. A table says the same to a screen reader. When the rows under it are by something other than time, a small caption above the plot says what the chart shows (Per day). Bars by something other than time stack by that dimension's top rows, in ink shades with a small legend, still summing to each period's total, and the caption says so (Per day, by project). A budget's daily pace is one thin line, named once; a bar's number never sits on it, it moves beside its bar under the line. The chart follows the sentence's By: by week or month a bar for each; lines and a running total draw one line for each top row, in ink shades (`part`); a table has a column for each with All at its end; a rate, which cannot be cut, has a bar for each row and a table with a row for each; set against something it is the whole over time and the caption says so. The drag is said under the chart only until your first drag; after that, in the chart's tooltip. Nothing in it moves | You can look at a number as you need without the page deciding it for you, and it stays one calm chart | design-system-components |
| `look.background-breathes` | The page's background (Dots, Aurora dots, Dusk dots, Mist, None) can breathe: the same picture, slowly brighter and quieter over ten seconds. Still is the default; Appearance lists each background on its own line with its picture and name, then Breathing as one switch; still when the system reduces motion | A calm page that can feel alive, never a second set of pictures | by hand |
| `look.background-clear` | One background everywhere, and it keeps clear of the content: the column you read (its width, the cards' rail and some air) is plain, and the background comes in softly beyond it, on every page and at every width | Words never sit on dots; the page stays calm where you read
| `look.running-needs-apart` | Running is ink, not a colour: a mark's ring, the stepper's live cell, the stage bar and the timeline's tick for running work are `--ink-2`, and their ring and breath say it works. Done goes ink too. Colour is kept for what asks for you (`--amber`), what went wrong (`--red`), and what just landed (`--green`, until you have seen it, then ink), so in both themes the loudest thing is what waits on you | Running and needs-you ask opposite things; a page where everything is fine reads near monochrome | by hand |
| `look.state-contrast` | Every state a mark, a ring or a step shows holds 3:1 or more on the page and the surface, and every state colour holds 4.5:1 as text, in light and in dark: `--amber` #94640F / #CFA265, `--red` #A9463C / #DB8378, `--green` #3F7349 / #86B38C, `--violet` #6F60BE / #A99FE0; rings and run squares `--ink-2` (6.0:1 / 7.2:1) | Muted colours that no theme lets fade, so one value serves a ring and a word | rail-state-contrast |
| `look.inter-at-graduation` | Inter replaces Poppins at graduation, one switch for everyone | Two faces on screen at once reads as a mistake | by hand |
| `look.scrollbars` | Scrollbars are thin and appear as the mouse moves or while something scrolls, then go | A quiet page; nothing shifts when they show | design-system-components |
| `look.violet-apart` | Violet means one thing: Worca writing in a field (the sparkle, the Suggested chip, the shimmer). Merged is full ink, no ring | A colour stands for one thing; a dot never means AI | by hand |
| `look.alert-ladder` | Every signal has a level, ranked the same on every page; each step down drops a channel. **3 Warning** (it stopped and will not continue without you: failed, checks failing with no fix left, interrupted, a cost or usage cap that stops work, lost sign-in or connection): filled red mark, red word, breath in red, counted, the only primary button. **2 Caution** (work waits on you, nothing is broken: a question, needs approval, a merge conflict, a schedule missed, a stalled task): amber ring, amber word, breath in amber, counted, outlined button. **1 Advisory** (worth a look when you have a moment: ready to merge, last in Needs you, counted, with Merge; elsewhere in place and uncounted: a plugin update, an unsaved draft, near budget, a reply in a chat you left, just landed in green until seen): full-ink ring, ink word, no breath. **0 Normal** (off: running, loop, checking, waiting, scheduled, paused by you, stopped, finished, merged, a past failure a later run fixed): `--ink-2` ring, glyph and word; finished is a plain check with no ring; merged is full ink, no ring. Needs you lists highest level first, and every Needs you count equals its rows | Normal is off, only what needs you is lit; the same word means the same urgency everywhere | design-system-components |
| `look.one-icon` | One icon, one meaning (the table below): a mark never borrows another's sign, and × is only close or remove | An icon you learned once stays true everywhere | by hand |
| `look.figures-on-demand` | A page's and a task's counts and costs come on demand: Figures at the end of a page's sentence opens its totals on a line under it; Figures beside Show its stages opens a task's cost, time, agents and files; a schedule's cost per run is in the card's tooltip; the context meter returns from 70%; a sidebar section keeps its count; a cost that stops work is never hidden, it is a Warning with its figure in the words | A calm page has nothing to read but what matters; the numbers are one click away | design-system-components |
| `look.backgrounds` | A background, Dots by default, chosen under Appearance, fills the away screen, which has nothing to read; on every other page (Chat home, a chat, a task, the Tasks and Schedules homes, Settings) it fills the margins and fades into the reading column, from one shared mask: its last faint dots end at the column's rail (a chat's marks), never under the text; a home with its composer in the middle (Chat, Tasks, Schedules) has it on every side, fading in toward the composer and joining at the centre; it never moves. Never under rows or in the bar | Character everywhere, and nothing under work | by hand |

## Type roles
The type scale below, named by what it does on a Rail page.
| Role | Token | Weight | For |
|---|---|---|---|
| Headline | `--fs-page` 22 | 600, tracking −0.02em | the state word: what is read first |
| Title | `--fs-subpage` 18 | 600, tracking −0.02em | the page title, one line with an ellipsis (a tap shows it whole); a page with no state word (a list, Settings) keeps it at `--fs-page` 22 |
| Heading | `--fs-section` 15 | 600, tracking −0.01em | a section's head on a page (a settings section, a tab's section); a step above the rows it heads, never the same size |
| Value | `--fs-section` 15 | 600 | figures: time, cost, changes |
| Body | `--fs-body` 13 | 400 (the live or asking row 600) | rows, questions, text |
| Meta | `--fs-meta` 12 | 400, `--ink-2` | the metadata line, times, figure labels, details |
| Caption | `--fs-caption` 11 | 400 | chips, hints; `--ink-3` only for marks and separators |

A head is never smaller or weaker than what it heads: a step larger (a page's sections, a side menu's groups: Heading
over Body rows), or the same size, heavier and in `--ink` (a list's groups: Body 600 over Body 400 or 500 rows). Never a caption
over the items it names. `ds-check` compares every head with its items.

## The Rail look
Calm and state-first: the look refines the current one and never adds a character of its own (no display faces, no
drawn rails, no new hues). Mocks: `plans/rail/mocks/visual-language-refined-*.png`. The prototype and the app keep
today's look until the Rail ships; these values replace it then. The Pulse prototype (`pulse.html`) already shows
the Rail look, so it can be judged in use.
- **Type:** Inter, bundled (400, 500, 600), in place of Poppins, at graduation, one switch for everyone (`look.inter-at-graduation`); JetBrains Mono stays for code, branches and ids. No
  700: titles and the state word are 600 with −0.02em tracking, buttons 500.
- **One surface:** the page and the card share one background (`--bg` = `--panel`); the card keeps its 1px `--line`.
  The card has one divider, above the Figures; its other zones are split by space.
- **One family of neutrals,** slightly cool, for every grey, line and fill:

| Token | Light | Dark |
|---|---|---|
| `--bg`, `--panel` | #FFFFFF | #141416 |
| `--canvas-2`, `--side-bg` | #FAFAFA | #18181B |
| `--field`, `--surface` | #F4F4F5 | #1F1F23 |
| `--hover`, `--side-sel-bg` | #F0F0F2 | #222227 / #26262B |
| `--ink` | #18181B | #EDEDEF |
| `--ink-2` | #63636B | #A1A1A9 |
| `--ink-3` | #A1A1A9 | #6E6E76 |
| `--line` | #EEEEF0 | #26262B |
| `--line-2` | #E2E2E6 | #35353B |
| `--float`, `--float-line` (menus, panels, popovers) | #FFFFFF, `--line` | #1D1D21, #323238 |

- **Running and needs-you stay apart:** running marks and bars are `--ink-2` #63636B / #A1A1A9; needs-you is `--amber`
  #94640F / #CFA265. `--peach` (#B39A0E / #ECD86A) stays only for the Working word's tint until it is reviewed.
- **The step bar is quiet:** 4px; a step to come is `--line`, a finished one #C9C9CF / #4A4A52; only the asking
  or failed cell has colour; the live cell is ink and breathes.
- **The metadata line:** the branch is `--ink-2`, so the PR number and the phrase read first.
- **Depth in dark:** a floating surface is a step lighter than the page (`--float`) with a hairline (`--float-line`);
  the shadow alone does not show on dark.

## Violet, kept apart
Violet is Worca writing for you inside a field (the sparkle, the Suggested chip, the shimmer), and nothing else. A
suggestion is never a dot or a badge. Merged is full ink, with no ring, so it and unmerged still differ at a glance.

## One icon, one meaning
| Icon | Means only |
|---|---|
| Play | A task, running |
| ! | Failed |
| ? | A question to you |
| Pencil | Your approval |
| Check | Ready (in a ring) or finished (plain) |
| Flag, magnifier, pin, inbox, box | An Insights page's own mark: how tasks end, review, where it fails, waiting on you, shipped; never a state's sign |
| Branch | Merged, full ink, no ring |
| Three dots | Waiting to start |
| Two bars | Paused |
| Square | Stop, stopped |
| Clock | A schedule |
| Hourglass | Time, duration |
| Dollar | Cost |
| Plug | A plugin, always; a service's mark in one ink where it has one |
| Globe | Web access |
| Service mark | Came from this service, one ink |
| × | Close or remove only, never a failed check |

## Scrollbars
Thin, in `--line-2`. They appear as the mouse moves, on the page and on any scroller under the pointer, and while something scrolls; 0.8s after it stops they fade out, unless the pointer is on one. They take no room, so nothing shifts, and they can be dragged. A bar stays under whatever opens over its page; a panel's, menu's or dialog's own bar sits on it. The library draws them (`watchScrollbars(document)`, `.rail-thumb` in `rail-look.css`), because an operating system's overlay bars take no styling and show only when it says so. Strips with their own controls (Tabs) have none.
