# The look: type, colour, surfaces

| Rule | What | Why | Held by |
|---|---|---|---|
| `look.type-roles` | Every text takes a role from the type scale (the table below): a size is always a token, nothing is under 12px, and a head is never smaller or weaker than what it heads | The hierarchy reads the same everywhere, and nothing is too small to read | ds-check |
| `look.text-size` | Settings › Appearance › Text size (Small, Default, Large) moves the whole scale by one step, for the whole product (`data-text` on the page's root) | People's eyes and screens differ | design-system-settings-redesign |
| `look.weights` | Type is 400, 500 and 600, never 700: titles and the state word are 600, buttons 500. Code and ids are monospace; a branch on a card is in the text face | One calm face; weight is a signal, not decoration | ds-check |
| `look.tokens` | Colours, sizes and corners come from tokens: one family of neutrals, and one value per theme for each state colour (`--amber`, `--red`, `--green`, `--violet`), which is its ring, its word and its fill alike | A page has no look of its own, and one colour never drifts into two | ds-check |
| `look.one-surface` | The page and a card share one background (`--bg` is `--panel`); a card keeps its 1px `--line`. In dark, what floats (a menu, a panel, a popover) is a step lighter with a hairline (`--float`, `--float-line`) | Depth comes from one line, in both themes | ds-check |
| `look.alert-ladder` | Every signal has one of four levels, ranked the same on every page, and each step down drops a channel (the table below). Needs you lists the highest level first, and every Needs you count equals its rows | Normal is off, only what needs you is lit; the same word means the same urgency everywhere | design-system-components |
| `look.running-needs-apart` | Running is ink, never a colour; done is ink too. Colour is kept for what asks for you (`--amber`), what went wrong (`--red`) and what just landed (`--green`, until you have seen it) | Running and needs-you ask opposite things; a page where everything is fine reads near monochrome | by hand |
| `look.running-sign` | Running has one sign everywhere: one slow breath of 4s (`sl-breath`) on the mark, the stage's knot, the step's dot, a busy button's knot and git's watch. A running mark is full ink and never under 16px; under reduced motion it stands still | One sign learned once, calm enough to sit on every row | design-system-task-redesign |
| `look.state-contrast` | Every state a mark, a ring or a step shows holds 3:1 on the page and the surface, and every state colour holds 4.5:1 as text, in both themes. Placeholder and hint text is `--ink-hint` (4.5:1); `--ink-3` is only for marks and separators | Muted colours that no theme lets fade, so one value serves a ring and a word | stillhet-state-contrast |
| `look.violet-apart` | Violet means one thing: Worca writing in a field (the sparkle, the Suggested chip, the shimmer). Merged is full ink with no ring | A colour stands for one thing; a dot never means AI | by hand |
| `look.one-icon` | One icon, one meaning (the table below): a mark never borrows another's sign, and × is only close or remove | An icon you learned once stays true everywhere | by hand |
| `look.backgrounds` | The page's background (Dots by default; Settings › Appearance) is the same on every page: two soft corners, top right and bottom left, each as wide as the margin beside the reading column. Where the margins are too thin (1180px and below) there is none | Character everywhere, and one picture to learn | by hand |
| `look.background-clear` | The background fades out before it reaches the reading column and never sits under words, rows or the bar; it never moves | Words never sit on dots; the page stays calm where you read | by hand |
| `look.background-breathes` | A background can breathe: the same picture, slowly brighter and quieter over ten seconds. Still is the default, Breathing background is one switch, and it is still under reduced motion | A calm page that can feel alive, never a second set of pictures | by hand |
| `look.away-screen` | The away screen, which has nothing to read, is the one page a background fills | The picture has room only where no work is | by hand |
| `look.figures-on-demand` | Counts and costs come on demand: Figures, a bordered button at the end of a page's filter line (FiguresButton), opens the page's totals on a line under it, and Figures on a task card opens its cost, time, agents and files. A sidebar section keeps its count | A calm page has nothing to read but what matters; the numbers are one click away | design-system-places-redesign |
| `look.cost-never-hidden` | A cost that stops work is never behind Figures: it is a Warning with its figure in the words. The context meter shows from 70% | What stops you is said, not found | design-system-components |
| `look.chart` | A number over time is a BarChart unless you ask otherwise: one question, one series, thin ink bars on the baseline, the current period darkest, a number only on the highest and the current. No grid, stat tile, second axis or colour; each bar's value is on hover and focus, and in a table for a screen reader | A chart answers one question and reads in both themes without colour | design-system-components |
| `look.chart-axis` | More than eight bars on a narrow screen name every second (or third) on the axis, evenly from the first | No two axis words touch | design-system-components |
| `look.chart-play` | Other forms (lines with a dashed comparison, a running total against its budget, a stacked mix, a table) appear only when you ask, and only those that fit the number. Two numbers of different kinds are two charts, never a second axis | You look at a number as you need without the page deciding it for you | design-system-components |
| `look.chart-shades` | A comparison or a mix may have a small legend; a mix is ink shades, never hues, and a name keeps its shade however the view changes | It stays one calm chart, and a shade means one thing | design-system-components |
| `look.chart-read` | Hover or focus reads a point with its difference (+$27, +41%) in the band above the plot, never over the line. A click or Enter opens its tasks, and a point with nothing to open says why (`off`) | A chart is read and opened like a row | design-system-components |
| `look.chart-drag` | A drag across a chart narrows every number on the page to those days; it is said under the chart until your first drag, then in the chart's tooltip | One gesture, taught once | design-system-components |
| `look.chart-caption` | When the rows under a chart are by something other than time, a small caption says what the chart shows (Per day, by project); bars then stack by that dimension's top rows in ink shades, still summing to each period's total. When a period's parts are not known the bars stay whole and the caption says so | You always know what a bar counts | design-system-components |
| `look.chart-by` | A chart follows the filter's By: by week or month a bar for each; lines and a running total draw one line per top row; a rate, which cannot be cut, has a bar per row. A budget's daily pace is one thin line, named once, and no bar's number sits on it | The chart and the rows under it always say the same | design-system-components |
| `look.figure-rows` | In FigureRows a row that opens its tasks is a button with a chevron; one that cannot is plain text and says why. On a narrow screen the rows scroll sideways in their own box and drop no column | What can be pressed looks it, and a phone loses no figure | design-system-components |
| `look.heat-grid` | Who spends where is a HeatGrid: people down the side, the top values of one dimension across, each cell a person's part of its column in ink shades scaled to the largest cell, with a Less to More legend. A cell's number shows on hover, focus and tap; the cells open nothing, and one line under the grid says why | Where a team's money goes reads at a glance, and the shade means only more or less | design-system-heat-grid |
| `look.time-track` | A person's work over time is a TimeTrack: a day axis from the page's own range, one row per task (its KindMark, title and project · #PR in the row's one button), a solid ink span while the agent works and a dashed `--ink-3` tail while the pull request waits for review. A MarkLegend names the marks; there is no hue | Who shipped what and what waits reads at a glance, on the same days as the chart above it | design-system-time-track |
| `look.time-track-mark` | A TimeTrack row's GitMark sits at the PR's time and is the row's only second target: it opens the pull request in a new tab, the one exception to `list.row-one-target`. Hover or focus shows its TimelineCard, and Esc dismisses that first | The PR is one click from where it happened | design-system-time-track |
| `look.scrollbars` | Scrollbars are thin, in `--line-2`, drawn by the library (`watchScrollbars`): they show as the mouse moves or while something scrolls, fade 0.8s after, take no room and can be dragged. Strips with their own controls (Tabs) have none | A quiet page; nothing shifts when they show | design-system-components |
| `look.inter-at-graduation` | Inter replaces Poppins at graduation, one switch for everyone | Two faces on screen at once reads as a mistake | by hand |

## The type scale

| Role | Token | Default | Small | Large | Weight | For |
|---|---|---|---|---|---|---|
| Headline | `--fs-page` | 24 | 22 | 26 | 600, tracking −0.02em | the state word; the title of a page with no state word (a list, Settings) |
| Title | `--fs-subpage` | 20 | 18 | 22 | 600, tracking −0.02em | the page title beside a state word, one line with an ellipsis |
| Heading, Value | `--fs-section` | 17 | 15 | 18 | 600 | a section's head on a page; figures (time, cost, changes) |
| Body | `--fs-body` | 14 | 13 | 15 | 400 (the live or asking row 600) | rows, values, questions, text |
| Meta | `--fs-meta` | 13 | 12 | 14 | 400, `--ink-2` (a button's words 500) | the metadata line, supporting lines, times, figure labels |
| Caption | `--fs-caption` | 12 | 12 | 13 | 400 | chips, hints |

A head over its items is a step larger (a page's sections, a side menu's groups), or the same size, heavier and in
`--ink` (a list's groups). `ds-check` compares every head with its items.

## The alert ladder

| Level | When | Mark | Word | Breath | Counted | Its button |
|---|---|---|---|---|---|---|
| 3 Warning | It stopped and will not continue without you: failed, checks failing with no fix left, interrupted, a cost or usage cap that stops work, a lost sign-in or connection | filled red | red | red | yes | filled: the only primary |
| 2 Caution | Work waits on you, nothing is broken: a question, needs approval, a merge conflict, a schedule missed, a stalled task | amber ring | amber | amber | yes | outlined |
| 1 Advisory | Worth a look when you have a moment: ready to merge (last in Needs you, with Merge); in place and uncounted elsewhere: a plugin update, an unsaved draft, near budget, a reply in a chat you left, just landed (green until seen) | full-ink ring (`--advisory`) | ink | none | only ready to merge | outlined |
| 0 Normal | Off: running, checking, waiting, scheduled, paused by you, stopped, finished, merged, a past failure a later task fixed | `--ink-2` ring; finished a plain check; merged full ink, no ring | `--ink-2` | only running (`look.running-sign`) | no | none of its own |

## The palette

| Token | Light | Dark |
|---|---|---|
| `--bg`, `--panel` | #FFFFFF | #141416 |
| `--canvas-2`, `--side-bg` | #FAFAFA | #18181B |
| `--field`, `--surface` | #F4F4F5 | #1F1F23 |
| `--hover`, `--side-sel-bg` | #F0F0F2 | #222227 / #26262B |
| `--ink` | #18181B | #EDEDEF |
| `--ink-2` | #63636B | #A1A1A9 |
| `--ink-3` (marks and separators only) | #A1A1A9 | #6E6E76 |
| `--ink-hint` (placeholder and hint text) | #6F6F78 | #8D8D96 |
| `--line` | #EEEEF0 | #26262B |
| `--line-2` | #E2E2E6 | #35353B |
| `--float`, `--float-line` (menus, panels, popovers) | #FFFFFF, `--line` | #1D1D21, #323238 |
| `--amber` | #94640F | #CFA265 |
| `--red` | #A9463C | #DB8378 |
| `--green` | #3F7349 | #86B38C |
| `--violet` | #6F60BE | #A99FE0 |

Backgrounds: Dots, Aurora dots, Dusk dots, Mist, None.

## One icon, one meaning

| Icon | Means only |
|---|---|
| Play | A task, running |
| ! | Failed |
| ? | A question to you |
| Pencil | Your approval |
| Check | Ready (in a ring) or finished (plain) |
| Flag, magnifier, pin, inbox, box | An Insights page's own mark; never a state's sign |
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
| Gear (`gear`) | Settings only: toothed, never `sun`'s rays; `nav-settings` and `set-general` are the same drawing |
| Sun on water (`stillhet-ui`) | The UI choice: the Stillhet icon in the top bar (`nav.design-switch`) |
| Signal (`signal`) | Pulse, and an event row's mark (Updates, Limits), smaller, in its row's tone |
