# Worca design system

The one reference for how Worca looks. Every screen follows it; `test/ui-design-language.test.mjs` and
`tools/button-audit.mjs` enforce the rules marked (checked). When the guide and the code disagree, fix one of them in
the same commit.

## Foundations

### Colour (checked)
Every colour is a token in `:root` of `ui/public/shell/self-hosted.css` (served as `/style.css`), written as `light-dark(light, dark)`. Never restate a hex;
a `color-mix()` recipe used twice is a named token (`--btn-hover`, `--red-tint`, …).
| Colour | Tokens | Means | Never |
|---|---|---|---|
| ink | `--ink`, `--ink-2`, `--ink-3` | primary and neutral text; a checked box, a checked radio, an on switch | — |
| green | `--green*` | done, OK, ready, in review | a checked box, an on switch, decoration |
| amber | `--amber*` | needs you, attention, waiting; a PR problem | a brand mark, "not installed", "built-in" |
| red | `--red*` | failed, destructive | a warning that needs no action |
| blue | `--blue*` | information (the Beta chip), in-progress text, links | a status dot (except the route's with-reviewers circle `.rd-route-dot.is-review`), a bar, team policy |
| violet | `--violet*` | Labs only (the merged status dot, the merged run orb and the run page route's merged circle `.rd-route-dot.is-merged` and merged words `.rd-fact-tx.is-merged` are the named exceptions, as is workflow tests' "Can be checked exactly" line under a criterion `.wft-crit-meta.is-exact` and the "Worca suggests" box `.wft-sugg` with its tag `.wft-sugg-tag`, and the "Can be checked exactly" pill `.wft-exact` in Compare by criterion (an exact check, without AI); the Marketplace chat kind tile and dot follow its kind colours, › Marketplace exceptions) | sources, "Official", policy, a badge, a chart series |
| slate | `--slate*` | neutral metadata: a source, "Official", policy (`.badge.slate`) | a state |
Status-dot exceptions: peach = working (it pulses), violet = merged. They are the dots only, never a badge.
Working and needs you must read as two states at dot size; `--peach` stays one orange.
Surfaces: `--panel` page, `--surface` raised, `--field` field and tint fill; `--line` dividers, `--line-2` control borders.
`--row-selected` is `--ink` at 8% over transparent (no new hue): the selected Runs row, one ink step over whatever it
sits on, so it reads on the panel and on the Needs-you amber tint alike. Its PR chips take the `-ink-strong` shades to
stay at 4.5:1. `--row-open` is 50% of `--row-selected`: the
lighter row highlight of a collapsed Runs group whose run is open.

Known drift (left for a later run): amber `badge waiting` on Guardrails' "built-in"
label; blue engine and credential badges. The interface
mode cards (`.lv-card-icon`) tint their icon per level (an illustration, not a state).

### Type (checked)
One scale, no half sizes. Use the tokens; never type a px size that is not a step.
| Token | Size | Line height | For |
|---|---|---|---|
| `--fs-caption` | 11px | 1.5 | chips, badges, counts, captions; the floor (nothing smaller) |
| `--fs-meta` | 12px | 1.5 | secondary text, meta lines, help, table headers, legends, small controls |
| `--fs-body` | 13px | 1.5 | body, rows, fields, buttons, tabs, the page intro |
| `--fs-section` | 15px | 1.25 | section titles (`.section-title`, `.card h2`), 600 |
| `--fs-subpage` | 18px | 1.25 | sub-page titles (`.subpage-title`), 600 |
| `--fs-page` | 22px | 1.25 | page titles (`.page-title`, the run and group page title), 700, -0.02em; the run and group page title is one line, cut with "…" |
| `--fs-stat` | 22px | 1.25 | stat tile values |
| `--fs-hero` | 32px | 1.25 | the Chat home hero only (22px under 760px) |
`--lh-body` is 1.5 and `--lh-title` is 1.25. A subsection or field label is 13px / 600. Relative sizes are allowed
only for code inside text (`.92em`) and the workflow graph's zoom (`calc(… * var(--gv-scale))`). Drift that later
slices remove is listed in `test/fixtures/design-debt.json` under `typeScale`; that list only shrinks.
Sentence case everywhere: no UPPERCASE kickers (checked). Mono only for code, branches and diffs (ids only in
tooltips), never for plain values such as "On · 356 runs" or "Synced 9 min ago".

### Spacing
A 4px grid: 4, 8, 12, 16, 24, 32. Rows pad 8–12px vertically. Phones (under 600px) use one 16px gutter.
`--pad-card` (24px) pads every card and dialog; `--pad-tile` (16px) pads stat tiles, run tiles and
list cards. Chat message cards keep their own.

### Corners (checked)
| Token | Value | For |
|---|---|---|
| `--r-xs` | 4px | chips, badges, tags, inner segments |
| `--r-sm` | 6px | buttons, fields, segmented controls, filter chips, menu items, highlighted list rows |
| `--r-md` | 8px | cards, dialogs, menus, popovers |
| `--r-lg` | 12px | the chat composer only |
Dots, avatars, spinners, radios and switch knobs may be round; the switch track is the one pill. A highlighted list row
(selected, Needs you) takes the 6px corner and drops its own divider, like a sidebar nav item.

### Sizes (checked)
| Size | Height | For |
|---|---|---|
| small | 28px | `.btn-sm`, `.input-sm`, `.select-sm`, segmented buttons, filter chips, list-row actions |
| medium | 32px | `.btn`, fields, tabs, page and dialog actions |
| large | 40px | `.btn-lg`: at most one per view (Start run) |
Touch screens raise every button to 40px. Fields stay 32px on touch screens; Settings stacks them under 560px of container width.

### Shadows (checked)
None at rest. Only floating surfaces (menus, popovers, dialogs, the dock) use `--shadow-menu`, `--shadow-pop`,
`--shadow-sheet` and `--shadow-dock`.

### Focus
`outline:2px solid var(--ink); outline-offset:2px` on `:focus-visible`; tabs and rows use an inset `-2px` offset. A
script-focused control (a page that focuses its way back on open, a menu handing focus back to its trigger) hides the
ring for every button, link, summary, tab, switch and `[tabindex]` while `data-input="pointer"`; a keydown brings it
back. Only a key that moves or acts on focus counts (Tab, the arrows, Enter, Space or Escape outside a field): typing,
Enter in a field and a modifier alone keep the pointer mode (`ui/public/input-mode.mjs`). Fields keep their ink border
on focus. Rings sit on `:focus-visible`, never on `:focus`.
A divided list with list keys (`ui/public/list-keys.mjs`, the Runs list and the Chats column) is one Tab stop with a
moving focus (`ui/public/list-dom.mjs`, the one module both lists use): rows and foldable section heads take ↑ ↓ / J K,
their ⌄, ⋯ and checkbox are `tabindex="-1"`.

### Motion
Motion shows a change of state and never decorates: short fades, no slide, bounce, count-up, spinner or skeleton, and
nothing that runs without a state change; under reduced motion it stops. The named exceptions are the away screensaver (it starts after the idle time chosen in Settings › Appearance (off by default) and is off under reduced motion) and the Design stage (› Design stage exceptions).

## Components
### Button (checked)
`.btn` + one size (`.btn-sm`, `.btn-lg`) + one variant (`.btn-primary`, `.btn-quiet`, `.btn-danger`); `.btn-icon` is
square. One primary per group. Labels of 1–3 words, verb first. Icons come from `icon(doc, 'plus')`
(`ui/public/icons.mjs`), never a typed "+", "×" or "▾" (checked). The `eye` glyph is used only by the View PR ▾ menu's
Watch item and the route's idle `Watching` button. `.info-tip` is a 28px square like `.btn-sm.btn-icon`; a
button outside `.btn` must be a shared control or a row a person opens (checked by the stray audit). The composer's
disabled Save keeps its ink fill at 70% opacity, not the 45% grey of other disabled buttons, so it still reads as the
primary.
### Copy button (checked)
Every button that puts text on the clipboard is the one copy button, built by `copyButton(doc, { name, label?, title?,
cls? })` in `ui/public/copy-button.mjs` (static markup: `.btn.btn-sm.btn-quiet.copy-btn` with `copyIconsHtml()`'s three
glyphs). The branch name in the run head is the model.
1. Look. A quiet 28px button with a 14px `copy` glyph. When the copied text is shown and is the thing to copy (a
   branch name, a worktree path, the Copilot device code), it is the label, in mono beside the glyph, and the text
   itself is the button. Otherwise the button is an icon square (`.btn-icon`), never a typed "Copy"/"copy" label, and
   it sits next to what it copies.
2. Name. `aria-label` says what it does, verb first, sentence case: `Copy branch name`, `Copy the visible log lines`,
   `Copy path`, `Copy command`. The title is the same, or the full text when the label is shortened.
3. Feedback. Through `copyFromButton(btn, text)` only, the same on every copy button: for 1200 ms the glyph turns into
   a `--green-ink` tick followed by a green `Copied` caption (12px sans, `.copy-btn-msg`, inside the button), and the
   title says `Copied` (`.copied`). A failed write or empty text shows a `--red-ink-strong` × and the reason as the
   caption and title (`Copy failed`, `Nothing to copy`; `.copy-miss`). An icon square widens to hold its caption for
   that window. The outcome is also said to screen readers through one polite `#copy-live` status region (the
   caption is not read: the aria-label names the button). The label never changes and no toast is raised for success.
4. A failure the person must act on (the text is needed elsewhere: a command to run, a path, a sign-in code) also goes
   to the surface's status line, which outlasts the 1200 ms flash, and says what to do instead ("Type ABCD-1234 on
   GitHub instead", "select it and copy it by hand"). A failure with nothing to do (the Logs bar) needs only the flash.
5. Labelled actions. A copy that is one of a row of worded actions keeps its words: `copyButton(doc, { name,
   action: true })` is a secondary `.btn-sm` reading glyph + name (Run Actions' `Copy command`, beside Check out,
   VS Code, Terminal), and while the tick shows, `Copied` takes the words' place; the feedback and failure rules above
   are unchanged. Not copy buttons at all: menu items ("Copy Markdown", "Copy PR link") and a dialog's footer actions
   (the report dialog's `Copy JSON`, the team policy's `Copy for PR`), which keep their words, in sentence case.
A copy-labelled `.btn` that is not a `.copy-btn`, or a `.copied` toggled outside `copy-button.mjs`, fails
`test/ui-copy-button.test.mjs`.
### PR controls (checked)
Every pull request button and link looks the same everywhere (`test/ui-pr-controls.test.mjs`).
1. Variant. Create PR and Push are the ship actions: `.btn.btn-primary`. View PR is navigation: a plain secondary
   `.btn`, for an open PR and a merged one alike. Nothing is a custom pill.
2. Size by context. On a page (the run page's card head, the History Details header, the Create PR dialog) `.btn`, 32px.
   Inside a card or bar (the Chat run card, the Chat pull request card, the run and group page bar buttons that
   `syncActions` makes) `.btn.btn-sm`, 28px. Never full width (`.btn-block`).
3. Icon. Every PR button leads with one glyph from `icon(doc, name, size)` (`ui/public/icons.mjs`): 16px on `.btn`,
   14px on `.btn-sm`. Create PR `pr-create`; View PR `pull-request` while the PR is open, `merge` once merged; Push
   `arrow-up`.
4. Labels. The words come from `ui/public/ship-words.mjs`. "Create PR" makes PRs everywhere; "View PR" goes to one PR
   (a menu item names it: "View PR #812"); "View PRs ▾" lists several; "Ship" is a status word ("Ready to ship"), never
   a button. Push says the header's `Push main` (the source branch). Buttons, menu items, aria-labels and dialog titles
   say "PR"; "pull request" only in headings and sentences; "open" is not a PR verb. The Create PR dialog's title equals
   its confirm ("Create PR", "Create 2 PRs"). Its zones, in order: Into (remote and branch on one row, the branch alone
   with one remote), Pull requests (a feature, a chain or a user group only: One / N stacked, or N separate for a user group, the suggestion under them;
   a disabled One has its reason beside it in `.shipit-prs-one-why`, which for a feature names the run and PR, as in
   "Run 2 already has pull request #40 open", while N stacked stays enabled; a feature's carried runs are `.hint` lines
   in `.shipit-prs-carried`, then `.shipit-prs-kept` ("#40 is not counted."), both shown only while N stacked is picked;
   the Ship card lists the same lines in `.ask-shipcard-carried` under its state line, and its "Create N PRs" counts
   only the PRs Ship will create; after a feature ships as one PR, its
   Shipped Ship card counts that PR once: "1 PR open", one row),
   Title and description (with Draft), After it opens (Watch PR, Release). Its footer: a divider,
   then Cancel and the primary on the right; "Try it first" is a secondary `.btn` on the left; one primary. Field
   labels in it are nouns ("Into", "Push remote", "Draft").
5. Links. A PR text link (`.rd-prs-link`, the route's PR link `.rd-fact-link`, `.chat-rc-watch-pr`, `.ask-prcard-link`, `.ask-shipcard-pr`,
   `.hd-pr-repo-link`) is `--blue-ink-strong`, weight 600.
Placement: on the run page the PR control sits in the card's head at every level (`.rd-sheet-head > .rd-head-acts`, the
`.rd-pr-slot` among the head buttons: Try it, Create PR, Push, Fix conflicts, Ask for changes, Discard / Apply, How to
merge, Report), centred on the status line, with at most one primary; under 420px of head width the buttons wrap onto
their own row below the status, on the left edge. View PR is a split button `View PR │ ▾`
(`.btn-split.mini.rd-pr-split`): the main half opens the PR, the ▾ (PR scope) holds Watch (Advanced and above), Copy PR
link and Fix conflicts (while the PR conflicts). A workspace run has one `View PRs ▾` button that lists each member's PR.
The group page has the same head: Create PR, View PR ▾ or View PRs ▾ on the status line; View PRs ▾ holds each PR, then
Watch PRs and Copy PR links.
A user group's dialog offers One / N separate; One waits on the combine check (`The 3 runs combine without conflicts`,
or why it is off) and ships from a new branch named after the group. Its ship line reads `Any order`.
Nothing PR-related sits in the bar or in a PR bar; the PR's checks and Watch words are the route's pull request row. Runs list PR
chips (`.runs-pr`) are chips, not PR controls.
### Field
`.input` / `.select` / text, number and select elements: 32px, 13px, `--field` fill, 6px corner, ink border on focus.
`.input-sm` / `.select-sm`: 28px, 12px. `.select-fit` on a `.select` inside a `.drow-control` sizes it to its content
instead of 240px, for short fixed choices such as "Start after"; it stays right-aligned with the switches and segmented
controls above it. A textarea grows; it keeps the same fill, corner and padding sides. Search, url, email,
password and date inputs follow the same field; each joins the base rule when its screen moves.
A chat card's form (the run proposal) uses the same `.input` / `.select`; its fields sit on one auto-fit grid
(`.ask-rp-grid`), a switch field takes a whole row, labels stay on one line, and a long value ellipsizes with its whole
text as the tooltip.
### Switch (checked)
One switch, `.switch`: a 32×18 `--r-pill` track and a 14px round knob that is always visible. Off is `--switch-off` with
the `--knob` knob; on is `--ink` with the `--on-ink` knob, never green. Disabled or locked: no opacity fade; the track
turns `--field` with a 1px `--line-2` ring and an `--ink-3` knob (off), or `--ink-3` with a `--panel` knob (on). A locked
switch shows its reason as a 12px `--ink-2` line (`.switch-why`) and in the row's tooltip. Two drivers paint the same
pixels: a real checkbox built by `makeSwitch` (`ui/public/switch.mjs`: `input.sw-input[role="switch"]` + `span.switch`),
and a `role="switch"` element that carries `.on` / `aria-checked`. Labels are 13px / 500 sans (`.switch-label`), help
12px. A setting or option that is on or off is a switch; a checkbox only picks items from a list, is a "No cap" /
"Never" / "No away hours" / "Only between" opt-out or opt-in next to a field, or is a one-time consent. Known drift: the
extension sidebar's own settings checkbox (`.wx-settings-check`) keeps its native look until the sidebar run.
### Checkbox and radio (checked)
A checked checkbox and a checked radio fill `--ink`, never green; the tick is the page colour (`--tick`, `--tick-dash`).
A disabled checked box fills `--seq`. A selected option row (`.opt-row`, `.chip-select label`) takes the `--field` fill and
an ink border.
Requirements' pressed toggles are the one green on/off: a pressed Confirm on an assumption (`.req-confirm`) takes a green
outline and green text, and a Files for the run chip that goes with the run (`.req-fpick.on`) a green outline and a check
on `--panel`; neither is ever green-filled.
### Segmented control
`.seg`: one `--field` container, 28px / 13px buttons, the selected one `--surface`. `.seg-sm` is the same size.
The run log's Summaries / Raw switch (`.log-view-seg`, flag `commandSummaries`) is a `.seg-sm` in the Logs bar and the step
log drawer head. A summarised line's `title` shows the command on hover; that is a mouse convenience, and Raw is the
accessible path to the command. With the switch, Open in Logs and × in the drawer head never shrink; the title ellipsizes.
At 480px and below, the drawer head puts the step title on its own row and keeps the switch, Open in Logs and × together
on the row below, with 7px switch padding (a 311px History drawer leaves 283px). The Logs bar wraps while the switch
shows, so its selects keep their content width and search shares the switch row with copy.
### Tabs
`.tabs` / `.tab`: underline tabs, 32px, never boxed (checked).
Overflow under "More" is opt-in per row (`initDetailTabs` `overflow`); only the run pages use it. Their row holds the
reading tabs, in table order: Overview, Task, Diff / Changes, Artifacts, Q&A and Logs. The
other tabs go under "More": a `.tab`-styled button (`.tab-more`, never `role=tab`) with a 12px `chevron-down` and
`aria-haspopup="menu"`, opening the shared menu (`toggleMenu`): one row per tab with its icon, its name, its count as
the hint and the open one checked. An open overflow tab joins the row, lit, just before "More", and leaves it when
another tab opens. With fewer than two shown tabs to hold, a row that fits has no "More" and the tab keeps its usual
place. The label is "More", never "…", which is the run's ⋯ menu.
A row that does not fit its width folds into "More" by itself (`tab-fold.mjs`; no setting and no level rule): a lone
other tab first, then the row tabs one at a time from the right end, until it fits. They come back in reverse order as
the width grows, up to the default row and never past it. Overview, the open tab and "More" are never folded.
### Filter chip
`.filter-chip` (`aria-pressed`): 28px, 12px / 500, 1px `--line-2` border, 6px corner. Selected: `--field` fill, ink
border, ink text. Never a solid ink fill. A count sits in `.n`. It is the only filter chip: `mv-filter`, `wfl-chip`,
`proj-fchip` and `mcp-chip` are gone (checked).
### Chips and badges
One chip: 18px, 11px / 500 sans, 4px corner, filled, no border (checked). The Labs (violet) and Beta (blue) flag chips are
the reference size. Colour carries meaning only. The "Suggested" chip on the New run form's title and branch (`.sn-chip`, Smart run naming) is a permitted Labs-violet use: the whole feature is a Labs feature. Cost-tag chips (`.tag-chip`), the Projects sync pill (`.ps-pill`), the
Chat command card's state (`.ask-cmd-pill`), the Team policy tab count (`.tp-tab-badge`) and a small-runs feature's need count (`.kind-chip[data-need]`, neutral, after the kind chip in the Chat card and feature page heads, only while it is above zero) are the same chip; on the
active tab the count turns neutral (`--line-2` fill, ink text). A chat command in summary mode (flag `commandSummaries`) shows the runs status dot and no state chip; a lone command is a line like that head (its summary · time ›, no card, no dot) that opens to its detail; consecutive commands share one card under a quiet disclosure head (`--ink-2`, `--hover`, › turning down), folded until the person opens it (a failure shows only as the red `N failed`; a running group puts Stop beside the head), with the rows split by one `--line`; an opened command uses `--field` boxes (command, folder chip, output panel); the full card keeps `.ask-cmd-pill`. The missing-key slot is the one outlined chip: a 1px dashed
`--amber` outline on a transparent fill. A removable chip's × is a 14px quiet button inside the chip. A source, "Official"
or a policy origin is `.badge.slate`; "not installed" and "built-in" are grey.
Agent readiness (`ui/public/readiness-chip.mjs`) uses the same chip: the project row and page header chip (`.badge.pl-rd`:
"Agent-ready" green, "Partly ready" amber, "Not agent-ready" red) and the popover's level labels (`.badge.rd-lbl`, grey for
"Not used"). Amber and red take the `-ink-strong` text shade, and a not-ready chip ends in a solid count of open problems
(`.rd-n`). A failing check leads with `.issue-sev` (Must fix red, Should fix amber, Advice blue), never a dot: a dot is a
state. The passed and ignored boxes are `.disclosure` with the `check` and `none` icons.
### Status dot and symbols (checked)
A dot is the state: peach working (pulses), grey paused or waiting, green ready, violet merged. Needs you is an amber
"?" only when Worca asks; a PR problem is a plain amber dot with the reason in the PR chip; failed is a red "!".
An idle chat shows the chat bubble line icon in the dot's place. A Shaper small-runs row maps its run status mark to a
dot through `markDot` (`ui/public/status-dot.mjs`). This table lists every `.status-dot.is-*` modifier, and
`test/ui-design-language.test.mjs` fails when the CSS has one without a row.

| Dot | Class | Means |
|---|---|---|
| peach | `.status-dot.is-peach` | working or starting; a live Shaper run |
| pulse | `.status-dot.is-pulse` | the only motion: a live run (none under reduced motion) |
| amber | `.status-dot.is-amber` | needs you: the "?" while Worca asks, a plain dot for a PR problem |
| red | `.status-dot.is-red` | failed, with the "!" |
| green | `.status-dot.is-green` | ready, in review or done |
| violet | `.status-dot.is-violet` | merged |
| grey | `.status-dot.is-grey` | paused; an idle chat |
| dark grey | `.status-dot.is-dark-grey` | stopped |
| grey ring | `.status-dot.is-grey-ring` | waiting; a Shaper run that waits for runs, cannot start, or is free without the turn, or is held on a clash, also one found as it sets up |
| ink ring | `.status-dot.is-ink-ring` | the Shaper run with the next turn (`next`) |
| dashed ring | `.status-dot.is-dashed-ring` | a Shaper stop answer held for its turn (`after run 3`), 12px, `--ink-3`, no glyph |
### Run row link marks (checked)
A Shaper small-runs run row on the Chat card and the feature page's Runs tab shows its links when you point at it
(hover or keyboard focus): a 3px ink bar left of each row it builds on, and a dashed one left of each row that builds on
it. Click, Enter or Space keeps the marks; Esc lets go. The bar is a `::before` out of the layout, so nothing moves and
nothing dims; a hovered row that is not kept takes the `--row-open` fill. `ui/public/run-links.mjs` sets the attributes, and `test/ui-design-language.test.mjs` fails when the CSS
has a `[data-link…]` attribute without a row here.

| Mark | Attribute | Means |
|---|---|---|
| solid bar | `data-link="on"` | the pointed run builds on this run (done runs included) |
| dashed bar | `data-link="by"` | this run builds on the pointed run |
| kept row | `data-link-kept` | the kept run, with `aria-current="true"` and the `--row-selected` fill |

### Run order map (checked)
The still order of a branching small-runs feature: one status dot per run, each in a column right of every run it
builds on (rows in run-number order), and only the links that still hold a run back, routed through the gaps between
columns and the lanes between rows so no link crosses a dot or a number. The module is `ui/public/shape/run-order-map.mjs`
(`runOrderLayout` is the pure layout, `renderRunOrderMap` the painter), tested by `test/ui-shape-run-order-map.test.mjs`.
Geometry is fixed px (§Charts, no `viewBox` scaling). A dot is the shared status dot through `markDot`, never a class of
its own, and the only motion is the live dot's pulse. The map is `aria-hidden` and never a tab stop: the run rows beside
it are its legend and its accessible source, so it has no caption or legend of its own. Two links that share no run
never run together: in each gap, exits take tracks from the left and entries from the right, and tracks sit 4px apart.
A run waiting at a stop held for another run counts as not started, so its link stays.

| Part | Class | Means |
|---|---|---|
| root | `.rom` | the map and its sideways scroll box (`aria-hidden`, `tabindex="-1"`) |
| plot | `.rom-plot` | the drawing, sized in px by the layout |
| links | `.rom-links` | the SVG behind the dots that holds the links |
| link | `.rom-link` | one link that still holds a run back, 1.5px `--ink-3`, straight segments only |
| run | `.rom-run` | one run, its status dot centred on the layout point |
| number | `.rom-n` | the run's number above right of its dot, 11px `--ink-2` (§Charts) |

The map is placed on the feature page's Runs tab only, behind a Show order / Hide order toggle (the run page's
`.rd-route-toggle` pattern: a quiet small button with a chevron, `aria-expanded`, `aria-controls`). It is closed each time
the page opens and offered only from 5 runs whose links branch or join (`showOrderOffered`), never for a plain chain. The
Chat card and the Runs sidebar never show it. `ui/public/group-page.mjs` `syncShowOrder` creates and removes the node.

| Part | Class | Means |
|---|---|---|
| block | `.gpage-order` | the Show order block, first in the Runs panel, above the rows; absent when not offered |
| bar | `.gpage-order-bar` | right-aligns the toggle |
| toggle | `.gpage-order-toggle` | `button.btn.btn-sm.btn-quiet`: Show order / Hide order with a 12px chevron |
| body | `.gpage-order-body` | the part the toggle controls, `hidden` while closed |
| hint | `.gpage-order-hint` | the one readable line under the toggle, `--fs-caption` in `--ink-2` |

### Open stop list (checked)
A marked Shaper feature's Chat card lists what holds it up: one line per open stop or failed run, in run order. The
module is `ui/public/shape/stop-list.mjs` (`stopLinesOf` is the model, `paintStopList` the keyed painter), tested by
`test/ui-shape-stop-list.test.mjs`. Its only host is the Chat card, `ui/public/chat/run-card.mjs`; the feature page and the
Runs sidebar never show the list. A line's dot is the shared status dot through `markDot` (§Status dot and symbols), never a class of
its own. The text is one line with an ellipsis, and the full text sits in `title`. Lines are divided by one `--line`.
An open line's step card sits in `div.chat-rc-q.chat-rc-stop-q` and is drawn by the card question's own rules, with its
step head hidden. A failed line has a Resume `button.btn.btn-sm` (§Button) and a `role="status"` error in `--red-ink`.
There are no pills and no motion. `test/ui-design-language.test.mjs` paints the real list and fails when it emits a class
without a row here, or when the CSS has a `.chat-rc-stop*` class without one.

| Part | Class | Means |
|---|---|---|
| list | `.chat-rc-stops` | the list, an `ol` the card makes, `hidden` when there are no lines |
| line | `.chat-rc-stop` | the `li` of one line (`data-run`), divided by one `--line`; the card's Stop button (`button.chat-rc-stop`, §Button) shares the name |
| row | `.chat-rc-stop-line` | the one-line row: a 16px dot column, then the text, min 32px |
| text | `.chat-rc-stop-text` | "Run 2 · plan approval · holds up 7, 8, 12, 15, 16" in `--ink`, `--fs-body`, one line with an ellipsis and the full text in `title` |
| body | `.chat-rc-stop-body` | under the text, 24px in; empty, it takes no space |
| step card | `.chat-rc-stop-q` | an open stop's step card host, also `.chat-rc-q`, drawn by the card question's rules, step head hidden |
| Resume | `.chat-rc-stop-resume` | a failed run's Resume, the shared `.btn.btn-sm`, no rule of its own |
| error | `.chat-rc-stop-err` | Resume's error, `role="status"`, `--red-ink`, `--fs-meta` |
### Usage rings
The avatar draws only the session and long-window rings (`ui/public/usage-view.mjs`), each in one tone (`--ink-2`,
`--amber` at the warning line, `--red` full at the limit); spend is never a ring there, it lives in the account menu's
spend card.
### Card head
The first line of a card is its headline. When the page title sits above the card (the group page), the state is the
headline: `.run-status-word`, 1–3 words at `--fs-section` / 600 / `--lh-title`, never truncated, the status dot centred
on it and the head buttons and the Live switch centred on its line (`.rd-sheet-head`, `--rd-word-line`). Under it,
`.run-status-detail`: 12px `--ink-2`, at most 2 lines (the whole text as its tooltip), and only what no row below says
("not in dev yet", "Failed · Build · Implementation" → "Build · Implementation", "14 files changed in a copy",
"conflicts with dev", GitHub's verdict); absent otherwise.

On the run page the state is not the card's: the header's state line under the title says it on every tab
(`.run-state-line`: the dot or symbol, the state word at 13px / 600, then "· step or stage" in `--ink-2`, one line, the
step cut with "…"). The card's head shows only what that line does not say, a reason, a timing or a verdict ("cost
limit", "not in dev yet") on the head buttons' line, and nothing otherwise: the head buttons then take a row of their
own and the card starts at its progress bar. While a question waits, the state line and the card's status block both
lead to it. Both are painted from one model (`statusSplit`), so their words and colour cannot differ.

A card with its own title
(the chat run card) keeps the state at 13px / 600 under it. Its head is one row centred on the title's line box (no
margin on the title, no nudge on the dot), the project is the meta line right under it, and a single run has no kind
chip, as the run page title (a PR fix run's fix line leads with "PR fix run"); a group keeps its chip
(`Feature · 3 runs`, `Shaping`), as the group page title. Titles are static or short ("Change Away mode?"); dynamic
names go in the target or meta line (`.ask-mcard-target`); a title that can still grow (a run or feature name) gets
an ellipsis and its text as a tooltip. Chips say the kind or state once; the line after a chip never repeats its word.
### Route
The run page card's read-only "Where the work is" route (`.rd-route`, `ui/public/run-head.mjs` `routeModel` /
`renderRoute`), under the status line after a `--line` divider, at every level from the start of the run. The label
"Where the work is" is sentence case, 12px `--ink-2` (`.rd-route-label`, the facts labels' style), and names the `ol`
(`aria-labelledby`). One row per place the work passes through, in order: the PR path (the run's branch → Pull request →
where it lands), the Push path (the source branch, after the run's own branch when it was not merged back → the remote,
`remote/source`), a Folder run (The run's copy → the project folder) and a workspace (one row per member: its name, then
`branch → target` in mono; an unchanged member reads "No changes in this repository"). Where a feature's or chain's run
lands is the feature's base (`landingOf`), never the previous run's branch; while the group lists load it reads "The
base branch". Each row is a 20px circle (`.rd-route-dot`: an 11px `icons.mjs` icon for the kind of place, `git`,
`pull-request`, `merge`, `remote` or `folder`; a 1.5px ring in the state's colour, its `aria-label` the state word), the
place (mono names truncate with an ellipsis, the full name in `title`) and one quiet 12px `--ink-2` status line
(`.rd-route-second`, it wraps). States: working peach (pulses), done green, problem amber, review blue (with reviewers),
failed red, merged violet, closed slate, future a hollow `--line-2` ring. A 1px connector runs under each circle but the
last, `--green` between two done or merged rows (`.is-linked`), `--line-2` otherwise. The current row
(`aria-current="step"`) is the first row in progress, needing someone or failed, else the last row that is not future.
The run's own branch row carries the copy button (`.rd-route-copy`, `.btn.btn-sm.btn-quiet`, never shrinks; `margin-block:-4px`
keeps the place line 20px so the name centres on its circle; the copied tick as `.hd-branch-copy`). The status lines hold what the facts rows used to: the checks line in its colour
(`--green-ink` passed, `--blue-ink` running, `--amber-ink` failed; GitHub's verdict stays in the head status line),
Download patch, `Commit it yourself` and `Watching` (a ▾ opener at Advanced and up) as `button.rd-fact-act`, View fix
run, and the Watch-stopped hint and a failed Resolve's error each on their own line. The route's PR is a plain
`owner/repo#N` link (`.rd-fact-link`): the circle and the status line carry its state, so it has no `prChip`; the Runs
list keeps the `prChip` with its state word, since a list row has no circle. At an end state (merged, PR closed,
pushed, applied or discarded, every changed workspace member merged) the route folds to one line (`.rd-route-fold`,
for example "Merged into dev · worca/worka-cc#905") with a `Show route` / `Hide route` toggle (`.rd-route-toggle`,
`aria-expanded`); the choice is remembered once for every run page (`worca-cc.run.showRoute`).
### Workflow canvas: session tray
One session (2–4 consecutive agent steps run together) is drawn as a tray behind its member cards, in the
`.gv-sessions` layer (z 0, before the wire SVG, so wires and the glass cards stay on top). Anatomy: the tray
(`.gv-sess`, `var(--r-md)` corners, `--sess-fill`, a 1px `--sess-line` border, 12px padding past the outermost box), its
24px header strip (`.gv-sess-head`, `--sess-head`, 11px / 500 `--ink-2` text: the session's name, the engine and
"N sub-agents", or "<Engine>: separate sessions"), and the member chip in each member's label row (`.nsess`, slate:
`--slate-bg` / `--slate-ink`, `var(--r-xs)`, glyph plus "sub-agent"; only the glyph beside run totals). Use it for a
session only, never for any other grouping. The tray has no hue: violet is Labs, amber loops and needs-you, blue md
wires and info, green and red status. Selected is the `.node.sel` ring (`0 0 0 1.5px var(--ink)`); an error is a
`--red` border with `--red-ink-strong` header text; a session that runs as separate sessions (the Labs flag off, or the engine
has no sub-agents yet) and a lone member are dashed. On run hosts the header's status dot is peach only while
working (it pulses; reduced motion stops it), amber paused, green done, red error, stopped or interrupted. The edit
host's strip is a button (click, Enter or Space selects; drag moves every member; an issue's pip sits first in it);
static hosts, the chat run card and the chat proposal well keep the strip so routes match, but show only the dot and no chip. Trays are
placed in model px from `sessionRects` (`src/shared/graph/sessions.mjs`), never measured, and the strip is an
obstacle the lanes router clears.
### Menu (checked)
One menu skin. The box is `.menu`: 4px padding, `--panel`, 1px `--line`, `--r-md` (8px), `--shadow-menu`, 13px. A row is
`.menu-item`: at least 30px, `--r-sm` (6px), `--hover` on hover and keyboard focus; `.menu-sep` and `.menu-h` (12px /
600 `--ink-2`) divide and head. A disabled row is `--ink-3` with no hover; a destructive row is `.menu-item.is-danger`
(red ink, `--red-bg` on hover) and nothing else in a menu is red or amber. `openMenu({ doc, anchor, items, align, side,
label, host, className })` (`ui/public/workflows/menu.mjs`) emits it, and its items take `danger`. With `host` the menu
is appended inside it (a `.btn-split.mini`) and placed by its CSS; a `{ switch: true }` item is a `menuitemcheckbox`
switch row (help line, `.switch`) whose toggle keeps the menu open. A radio row (`menuitemradio`) is one grid: a 12px ✓
slot first (painted only when picked), the label, then the count or kind chip at the right edge in tabular figures, so
every label starts and every number ends at one x; a count of 0 is `--ink-3`. A radio row with an `icon` (the run
page's "More" menu) has the 16px icon between the ✓ slot and the label. A `{ segmented: true, label, options,
value, onSelect }` item is a `.menu-h` head over one full-width `.seg` (role group of `menuitemradio`): ←/→ move inside
it, ↑/↓ move on, and a pick keeps the menu open. The View menus (Runs, Chats; `viewMenuItems`, 256px) use it for Sort by
and Group by. The run page's View PR ▾ is built with it. The sidebar flyouts (`.nav-fly`), the
composer pickers (`.ask-pop`) and the split-button menus (`.btn-split-menu`) keep their
own builders and positions and add `.menu` / `.menu-item`; they carry no box or row skin of their own. No hand-built
dropdowns. A choice inside a sentence (the Shaper card's `You lead as [Engineering ▾], supported by [QA ▾].`) is a
`btn btn-sm btn-quiet` holding its words and a 12px ▾, with `aria-haspopup="menu"`, that opens its menu with `toggleMenu`. An item that has a key shows it as its `hint` (the 11px `--ink-2` count slot): the Runs row ⋯ reads `S`, `E`, `⌫`.
The Requirements pages build their header and file menus as `.menu.hd-menu` and place them through their own
`.req-menu` wrapper (the open list floats under its trigger, right-aligned); their danger row (Remove) takes
`--red-ink-strong`, which keeps AA on `--panel` and on the `--red-bg` hover.
### Row button
`.row-btn`: a whole divided-list row that a person opens (a Library folder, a Memory row, a keyed project row): full
width, `--hover` fill and `--r-sm` corner on hover, an inset ring on keyboard focus. Each list keeps its own grid and
padding. A chevron inside a row is a `.btn-icon` quiet button, not a row.
### Cards versus divided rows
Prefer divided rows (`.drows` / `.drow`): rows split by one `--line`, no box per item. A card (`.card`, 8px corner,
24px padding) frames one thing you act on; never a card inside a card (checked). A page list may sit on one card
that holds its `.drows` (`.card.drows`: Marketplace, Providers, Project settings): the card frames the list, the rows
keep their divider, and an empty list draws no card. Each Settings section is one such card (`.card.settings-card`,
760px, centred), and so are the Guardrails and Memory lists. `.drow-wide` puts a wide control
(a textarea, a table, a path row) under its label at full width; `.drow-stack` holds rich block content (a schedule,
a preset, a guardrail) with the same divider and padding.
### Chat cards
In the Chat conversation every card (run, files, applied change, command, run proposal, workflow, stubs) sits on the
text column: `.ask-transcript-col` caps it at `--chat-text-max` (760px) and no card kind sets its own width. No part of
a chat card leaves the text column (checked): a graph well (`.gv-well`: the workflow card's, the Auto card's and the
run card's graph) is exactly as wide as its card and lines up with the card's other content; it is 1px `--line`, a 6px
corner and the canvas fill, and its host fits the graph into it (≤ 1×, down to 0.3×; only a wider graph pans, and it opens at its start edge
with the first node in view, never centred with both ends cut). The well is as tall as the graph at that zoom (220–480px),
set once, so it never jumps on a resize and a shrunk graph never sits in an empty box. The run card's Expand opens the
same live graph in the shared `.wf-pop` overlay (a run-hosts `monitor` host fitted to the box) and never navigates; the
overlay's Open run is the way to the run's Workflow tab. The transcript reserves its
scrollbar gutter on both edges (`scrollbar-gutter:stable both-edges`), so the column, the composer and Jump to latest
share one centre. The dock is opaque from its top edge down after a 32px fade band (`--chat-dock-fade`); it stops at the transcript's
scrollbar gutter (`--chat-scrollbar-w`), so the scrollbar stays visible and draggable to its end. This transcript alone
draws its own scrollbar: a 14px gutter and a thumb never shorter than 48px (`--chat-thumb-min`), 6px wide at rest and
10px on hover while the gutter stays put (Firefox keeps its own bar in the token colours); every other scroller stays
native. The transcript never scrolls sideways: long words wrap, and a wide table or code block scrolls in its own box.
Jump to latest sits in that band, right above the dock, and the transcript's bottom clearance includes it, so nothing reads under
the composer. A row rises in (`data-ask-enter`) only the first time the page shows it, in any chat; the card inside it
never rises on its own. No part of a chat card is a pill; inner corners stay at or under the card's 8px.
### Composer bar
The chat composer's row is compact (`.ask-composer-row[data-bar="compact"]`): project, Requirements and Sets are
icon buttons, and each icon button names itself in a styled tooltip. The words sit in the button's `data-tip` (the
button keeps its `aria-label` and has no `title`, so the browser's own tooltip never doubles it); the tip is drawn
above the button on hover or keyboard focus after .3s, and never while a menu of the row is open. Only the
composer row draws it (the rule is scoped to that row). A tip is `display:none` at rest, never a box laid out at
opacity 0.
### Table
`.table-wrap` > `.table`: 12px / 600 `--ink-2` headers, 13px cells, 8px 12px 8px 0 cell padding, one `--line` under
each row, no outer box. Under 560px it stacks one block per row using each cell's `data-label`; it never scrolls sideways.
### Charts
A chart has a fixed height that does not grow with its width: the Cost and value chart about 260px, the overview
charts (Statistics, Team metrics) about 180px. Axis labels are 11px `--ink-3` and legends 12px `--ink-2` at every
width, so chart text is never drawn in a fixed viewBox that is scaled to the card (that is how a 560 × 240 viewBox
became 461px tall with 20px axis text). Tooltips are 12px. Bars and areas use the status and neutral tokens; blue is
never a bar. Every chart card has a legend; a one-series chart's legend names the series and its total.
### Empty, loading, error
Empty: one `.empty-line` (13px `--ink-2`) plus one quiet action. Loading: `aria-busy="true"` on the list, nothing for
300ms, then one `--ink-2` line (`Loading runs…`); no spinner and no skeleton. Error: `Could not load …` in
`--red-ink-strong`, the reason and `Nothing changed.`, then Try again and a quiet Details; never the raw error.
The line's first words are its `.el-t` span; an error line is `.empty-line.is-err` with `role="alert"`, its `.el-t` in
`--red-ink-strong` and the reason in a plain span under it (the Design library, the Shaper's Requirements card).
### Toasts
`notify({ tone, title, detail, action, key })` (`ui/public/feedback.mjs`): ok and info close after 5s, warn and err
stay, never move focus.
The title is at most 6 static words ("Could not open the workflow"). Names, ids and paths go in `detail`; a raw error
goes in `detail` too, never in the title, and behind a Details action when it is long. The one named exception is Add
to group's "Added to Auth rework": the group's name is the title, the item (or "3 runs") the detail (Group picker).
### Modals
`confirmModal({ title, message, confirmLabel, danger })` (`ui/public/app.js`): a destructive confirm names what goes;
only inside a confirm is `.btn-danger` solid red. Footer actions and the head Close are 32px `.btn`; inline field
buttons stay 28px; the card keeps the shared 24px padding (checked by the theme proof's `dialog-sizes`).

Dialog anatomy (`ui/public/dialog-layout.mjs`): a `.viewer-modal` card that can outgrow the window carries `.dlg` and
three direct children. `.dlg-head` holds the hero, title and subtitle (and head actions such as Close); `.dlg-body` is
the only scroller; `.dlg-foot` holds the status line and the action row. Head and foot never scroll away, and a 1px
divider appears only while content sits under them. Static dialogs write the wrappers in their feature's markup part
(`ui/public/FEATURE/*.html`); a JS builder calls `layoutDialog(card, { head, foot })`. Keep the card's 24px padding
(the regions bleed over it). Seams are the body's padding, `--dlg-gap-head` / `--dlg-gap-foot` (default 18px / 14px):
set those, never a margin. Never add a sticky header with negative margins, and keep a nested scroller only for a
bordered box (a list or a preview) that is bounded on purpose. Under 640px of height the head compacts (smaller hero,
tighter gap) but stays. The Marketplace's `.mk-dialog` / `.mk-sheet` follow the same model with their own class names.

Keyboard shortcuts sheet (`ui/public/keys-sheet.mjs`): the one sheet listing the list keys, opened by `?` on a list page
or View › Keyboard shortcuts. A 760px `.card` dialog in the shared anatomy: two columns of divided rows (label left, key
chips right, "or" between alternatives), stacked under 640px, and a foot with a 12px note and Close. Its `kbd.kbd`
chips share the top search's `.tsearch-kbd` rule; there is no second key-chip style. Esc, Close or the backdrop close it
and hand the focus back to the opener.
### Mark tile
`span.mdl-mark` (`markTile` and `modelMark` in `ui/public/models/brand-marks.mjs`, CSS in
`ui/public/models/models-page.css`): a model's, harness's or provider's brand mark on a tile that is white in both
themes (`--mark-tile`), 1px `--line` border. The default tile is 28px with a 6px corner and an 18px image (a Catalogue
row, a role tile); `.sm` is 18px with no tile, border or corner and a 16px image (facts, pickers, menu rows); `.lg` is
36px with an 8px corner and a 22px image (a group or fold row head, a harness tile, the side panel, the model form);
`.xl` is 48px with an 8px corner and a 30px image (Claude Code's harness tile, which grows it to 72px). `.blank` is a
service with no one vendor (Speech, Image generation, Sound) or an unknown key: a `--field` tile with an `--ink-2` line
glyph (`.sm.blank` keeps the fill). `.own` has no border and a white mark on a 135° gradient (the bag in `--on-mark`,
the worca mark's mask inverted to white): your own model wears the worca mark on `g-blue`, a plugin's model the
Marketplace bag on `g-indigo`, `g-teal`, `g-pink`, `g-blue`, `g-lime` or `g-slate`, picked from the plugin's name. The
worca mark is 20px (26px on `.lg`), the bag a 16px glyph (20px on `.lg`); `.sm.own` keeps an 18px tile with a 4px
corner and a 13px mark (a 12px bag). Use it wherever a model, harness or provider is named by sight. The tile is the
only place brand colour appears. Never tint a word, a chip or the page with a brand's colour, and never put a brand's
own mark on a coloured tile.
### Fold row
`section.drow.drow-stack.mv-pv-card[data-row]` holding `button.mdl-fold.row-btn` (`aria-expanded`, `aria-controls`) and
its `div.mdl-fold-body` (`ui/public/models/providers-tab.mjs`): one provider or service on the Models page's Providers
tab. The head is a Row button (no border, the `--hover` fill and 6px corner on hover, an inset ring on keyboard focus),
at least 48px with 8px above and below: a 28px caret (a 16px chevron in `--ink-2` that turns down while the row is
open), a 36px mark, the name (13px / 500, `--ink`) over one summary line (`.mdl-fold-sum`, 12px `--ink-2`, one line
with an ellipsis: `openrouter.ai · 8 requests at a time`), then the State word at the right. Closed, the body is
`hidden`; open, its fields sit under the name (88px in, 20px below). Several rows can be open at once; an address
(`#models/providers/openrouter`), an error on the row or a GitHub Copilot sign-in in progress opens its row. At 560px
of container width and below (`@container drows`) the State word takes its own line under the text and the body loses
its indent. Use it for one
thing whose settings fold under a one-line summary. Never a box per row (the `.drow` divider splits them), and never a
state colour in the summary.
### Side panel
`aside#model-panel.mdl-side` (`renderModelPanel` in `ui/public/models/catalogue-view.mjs`, in `#model-panel-host`):
the Catalogue's open model, over the page's right edge under the top bar at full height (`position:absolute`, z 30:
under Ask's column where it covers the page, at 1080px and below, and under the panel's own menus), `min(420px,100%)`
wide and the full width at 860px and below. `--panel`
fill, a 1px `--line` left edge, `--shadow-sheet`, 20px 24px 24px padding; it scrolls on its own, and with Ask's column
open above 1080px it stands left of the column. Its head: a 36px mark, the name (15px / 600) over its State word, and a
28px quiet Close (`.mdl-side-close`, `aria-label="Close"`). Then one row of actions, as the model's source allows (Test,
Edit, Duplicate, Edit a copy or Promote to global; ⋯ at the right end for your own models), and its sections (the facts
`dl.mdl-facts` with a 112px column of 12px `--ink-2` labels, Limits for a translated model only, Used by), each opened
by one `--line` with 20px of space above and below it. It is not modal: no `role="dialog"`, no backdrop, and the
list stays usable. The open row takes the `--row-selected` fill (`.mdl-sel`); a click on another row shows that one; a
click on the open row, Close or Escape closes it and gives the focus back to the row. Use it for a long list whose rows
are compared: the list keeps its place while one row's detail is open. Never a page of its own for one row, and never
a modal.
### Save bar
`div.mdl-savebar` (`ui/public/models/jobs-view.mjs`): one bar for the whole Jobs tab, drawn only while its picks differ
from what is saved (`hidden` otherwise). Sticky at the tab's bottom (z 2), `--panel` fill, a 1px `--line` border, 8px
corner, 10px 12px 10px 20px padding, no shadow. On the left a 12px `--ink-2` note, `1 unsaved change` or `N unsaved
changes`; on the right a 32px `Discard` (`.btn.mdl-discard`) and the primary `Save` (`.btn.btn-primary.mdl-save`),
which reads `Saving…` and is disabled while it saves. A save sends only what changed and says `Saved.` in a Toast; a
refusal goes on the tab's message line and keeps the picks. Use it for a tab whose picks are saved together. Never a
Save per row or per card, never a shadow, and never shown with nothing to save.
### Dialog step head
`ol.mdl-steps` (`aria-label="Steps"`; `ui/public/models/add-model-dialog.mjs`, and the model form's head in
`ui/public/models-view.mjs` when Add model leads to it): the step names in a Dialog's head, on the title's line before
Close: `1 Where it runs`, a 12px `--ink-3` rule, `2 The model`. 12px / 500 `--ink-2` on one line, no box, no border and
no number disc; the current step is `li[aria-current="step"]`, `--ink` at 600. Hidden at 860px and below, and left out
when there is one step to take (Change where it runs); the title and the foot (Next on the first step, Back on the
second) still say where you are. Use it
for a setup of two or three steps in one Dialog. Never a coloured step bar, never a step you click, and never the only
way back: Back sits in the foot.
### Harness tiles
`div.mdl-hx` (`role="group"`) of `button.mdl-hx-t` (`aria-pressed`; `ui/public/models/harness-tiles.mjs`): one tile per
harness, picked by sight, on the Jobs tab (Expert) and in Add model's sign-in step. A 6-column grid with 8px gaps, two
per row at 860px and below. A tile has 10px padding, a 1px `--line` border, an 8px corner and the `--panel` fill: its
36px mark, the name (12px / 600, one line) and its State word at 11px with a 6px dot (`Ready`, `Not ready`; on the Jobs
tab `Ready · Default for new runs`); a Beta chip sits in its top corner. `.best` (Claude Code) spans two columns and two
rows, with 16px padding, a 72px mark, a 15px name over a 12px State word, a 24px tick disc and the `Best performance`
chip (`.badge.mdl-best`, white on worca's blue gradient); at 860px and below it keeps the full row at one row's height.
`.on` (the pick, `aria-pressed="true"`) is a 1px ink edge and a 20px ink tick disc in the bottom corner
(`svg.mdl-hx-check`). `.off` (not ready) puts the name in `--ink-2` at 500 and the mark's image at half opacity (its
tile stays), still pickable, the reason in its tooltip; a locked tile is disabled, dimmed the same way, with the lock's
reason as its tooltip. Hover is the `--hover-outline` edge. Never an ink fill for the pick, and never a recoloured mark.
### Role tiles
`div.mdl-tiles` of `button.mdl-tile` (`aria-haspopup="menu"`, `aria-expanded`; `ui/public/models/jobs-view.mjs`): the
Jobs tab's three roles (Deep thinking, Everyday tasks, Quick jobs), each the button of its own model picker. Three equal
columns with 12px gaps, stacked at 860px and below. A tile has 16px padding (`--pad-tile`), a 1px `--line` border, an
8px corner and the `--panel` fill: the role (13px / 600) over what it does (12px `--ink-2`), then the model at 15px / 600
with its 28px mark and a chevron at the right, then its effort (`xhigh effort`, `Model default effort`). An unset role
reads `Each job's own default`. Hover is the `--hover-outline` edge; open (`aria-expanded="true"`), a 1px ink edge. A
pick goes into the tab's unsaved picks and shows the Save bar. Never an ink fill, and never a select inside the tile.
### State word
`span.mdl-st` + `.ok`, `.need`, `.fail` or `.off`: the Models page's one dot and one word, in Catalogue rows and group
heads, the Side panel, Fold rows, Harness tiles, Add model and the model form. 12px / 500 on one line, an 8px round dot
(`::before`) 7px before the word. `.ok`: a `--green` dot and an `--ink-2` word (`Ready`, `Connected`, `Key set`).
`.need`: an `--amber` dot and an `--ink` word (`Needs key`, `Needs sign-in`, `Needs setup`). `.fail`: a `--red` dot and
a `--red-ink-strong` word (`Key ${VAR} not set`). `.off`: a hollow 2px `--slate` ring and an `--ink-2` word (`Not
connected`, `No key`, `Not ready`). A Harness tile draws it at 11px (12px on Claude Code's) with a 6px dot 5px before
the word and a 1.5px ring. Use it for a thing's readiness on the Models page; the fix is a button of its own beside it.
Never a chip or a badge for a state, and never a state colour elsewhere in the row.
### Models tabs
`nav#models-tabs.tabs.mdl-tabs` (`aria-label="Models"`) of `a.tab.mdl-tab` (`ui/public/models/page-tabs.mjs`): the Models
page's header, Catalogue, Jobs and Providers (`#models`, `#models/jobs`, `#models/providers`), each a link with a 16px
line icon (`layers`, `briefcase`, `cloud`) before its name. The shared Tabs skin: 32px, 13px / 500 `--ink-2`, no box;
the open tab (`.on`, `aria-current="page"`) is `--ink` over a 2px ink underline. Catalogue carries its count,
`span.badge.mdl-tab-count`: the listed models (hidden built-ins are not counted), hidden until the list has loaded. The
`mdl-` hooks set layout only: the strip sits 4px down and the head's actions (⋯ and Add model, on the Catalogue) 4px
up, so the head keeps one height on every tab; at 760px and below the actions wrap under the strip. Never a page intro
above them, never a boxed tab, and never a colour of a tab's own.

## Patterns
- Status line: "State · detail", for example "Failed · Review · Review Implementation". No colon forms. In a card head
  the two parts split: the state is the headline and the detail is the line under it (Card head).
- Say each thing once. When a row, chip or route row in the card says a fact, the head does not: the row wins over
  the head. The checks line, the base branch, Watch stopped and where the work is are the route's (Route); a result block never repeats the status line's state word.
- "?" only means Worca is asking. An amber dot without "?" is a PR problem. "!" means failed.
- Labels are 1–3 words. Plain words: never ids (`run:cc3b6fce`), raw timestamps or raw errors in visible text; ids
  belong in a tooltip.
- The feature is "Chat", not "Ask Worca".
- Page header: title, then one short intro sentence (`.page-intro`), then content. A full-bleed editor (Workflows) has
  no page header; the Marketplace's tabs are its header (Marketplace exceptions). The Models page's tabs are its header
  too: no intro, a line icon before each tab's name (Models tabs).
- Stat tiles hold numbers only (time, cost, files changed). A list of chips goes in its own labelled row, for example
  the Cost tags row in the run page's facts block, never stacked inside a tile. The value is sans with tabular figures.
- Run and group pages share one head: the bar (Back, a 28px chevron `Back to Runs`, in every layout; the breadcrumb
  `Runs › Run tags › Run 2` beside it when the list stands beside the page; Run after; on the right the one primary
  action, Stop, ⋯), the title (one line, cut with "…" where the column ends; the cut is CSS only, the stored name is
  whole, its tooltip holds it, and the bar repeats it once the title scrolls away). A run page's title has no kind chip:
  a run in a group has no group row in its facts block, and the breadcrumb names and links its group. A group page's
  title keeps its kind chip (`Feature` / `Chain` / `Group`). The run page's header has no box: its edges are the tabs'
  and the content's, and under the title row it holds the state line (see Card head); `.pd-header` (project and
  workspace pages) keeps its box. Then the card: the status block (on the group page the state word as the card's
  headline with its detail under it; on the run page only the reason the state line leaves out), the head buttons at its
  right, centred on that line, with the PR control among them; see Card head and PR controls. Beside the stage bar the
  run page's state line names only the step (`Working · Refine Plan`); the stage is on the bar. Then the route ("Where the work is") under a `--line` divider, the facts block (`.rd-kv`: Project, Labels, Cost tags and Group, in that order; 12px
  `--ink-2` labels, 13px values, one row per fact and one place to edit it; a quiet button that leads a value pulls back
  by its padding so its text sits on the value column), then the tiles (`--fs-stat` sans values with tabular figures,
  `--pad-tile` padding). No PR bar, no kept-work, merge-back or Apply box: their actions are head buttons.
  On the group page a live update never moves the card. Once a stage bar has painted, between two runs or before a
  run's stages are known, it keeps its last paint (its edge still) until the next run has a bar. It hides only when a
  run needs you through its PR, or the group fails, stops or ends. This is the group page's one exception to "waiting
  runs have no bar"; list rows and the run page keep that rule.
- The run page's ⋯ holds run-scope actions, the same on the live and saved pages at every level: Away mode (while
  live), Save as preset, Terminal (Ctrl+`), then Report this run and Archive (Restore once archived). Archive asks
  "Archive this run?" and is disabled, with the reason as its tooltip, while a local copy is open or kept work waits.
  The bar never makes an Archive or Report button: a failed run's Report this run is in ⋯ and in the card head.
  ⋯ = this run; ▾ = this pull request.
- Runs navigation: every row opens its own page in the right pane and the list stays. A group row opens the group
  page; the ⌄ only expands. One row is highlighted at a time, the one whose page is open: a collapsed group whose run
  is open shows the lighter `--row-open` fill over its whole row; expanded, only the open run's row is highlighted.
  Rows inside a group draw no dividers; the group keeps its own divider before the next row. After Add to group the
  moved row takes the focus and the same `--row-open` fill for 1.5 s (`.is-landed`, static, so nothing to reduce): the
  one moment two rows are lit.
- Two row levels in the Runs list and the Chats column. A top-level row (a single run, Needs you, a group row) has a
  13px / 500 title over a 12px status line; a group row's title is 600. A row inside a group is one line, 26px (40px on
  touch screens): a 12px / 400 title, then its status at the right (it drops the Working / Starting word its dot says
  and ellipsises first), then its PR chip; no label chips and no Independent tag. A live member's 3px line sits under
  its title; a live member with stages draws the four-section block instead (a 2px bar, one step below the group
  row's 3px line, then the 11px Plan / Build / Review / Ready with its stage bold); its status names no step, only a
  state its dot does not say (needs you, paused). A member dispatched but not started yet (Starting) draws no progress. Its ⋯ stays 28px, centred.
- Search is the top bar's "Search or ask" only. A list filter is chosen there ("Runs labelled hotfix", `label:hotfix`),
  not from a filter button in the list's header. The Marketplace's Browse search is one exception
  (Marketplace exceptions); the Models Catalogue's own "Search models" field, with its All, In use and Needs setup
  filter chips (Just imported after an import) and its Source select, is the other, and Connectors' Servers and Skills toolbars use the Catalogue's grammar (search, filter chips, Source select), a third; the design start's "Search designs" field over its tiles is a fourth.
- Phones: one 16px gutter; nothing scrolls sideways at 290px.
- Runs list order: Needs you (most urgent first), Running, Waiting, Recent. Each section is newest dispatch first (a
  run's start, a waiting ticket's creation); a section with no rows is not drawn.
- Day sections (Group by Date, Runs and Chats alike, `runs-list.mjs` `DAY_BUCKETS`): Today · Yesterday · Previous 7
  days · Previous 30 days · Older, by last activity, split at local midnights. Runs puts Upcoming above them, Chats puts
  Pinned. Every day section folds by hand; Older starts folded. A section head in either list is a meta label:
  12px / 600 / `--ink-2`, its count an 11px caption at the line's right end. Both View menus list Group by in one order (Date ·
  Project · Topic (Chats only) · None) with the day sections as Date's title, and the view chip names filters and a
  non-default sort, never the grouping.
- Chats list: the Runs list anatomy in the Chat page's column; the open chat's figures sit once in the conversation
  head as a readout control (`button.chat-head-meter`, 11px mono, like the cost breakdown's `.cost-bd-btn`), not a
  §1.2 button; sections Pinned, then the day sections; Archive is disabled while a chat replies, runs a command or follows a
  live run; an archived chat reads Restore, as a run does; New chat is the one + after the list toggle; a topic group is
  a Runs group row (count, ⌄, members indented 16px, no dividers) placed by its newest chat; its sub line names its
  project or `N projects`; Group by Project files a group spanning projects under Several projects, never No project;
  Group by Topic shows one section per group, then Ungrouped; the group dialog's name field
  uses Smart run naming's Suggested chip only while that flag is on.
- Group picker (Add to group…, the Runs list and the Chats column, `ui/public/group-picker.mjs`): a combobox over one
  listbox. The focus stays in "Find or create a group"; ↑/↓ move the `.is-active` option and wrap, Enter takes it, Esc
  closes and hands the focus back. The order is New group… (the `plus` icon), then Recent (up to 3, this person's last
  used groups) and All groups (the rest, once), under sentence-case `.menu-h` heads. Typing drops the heads and New
  group… and lists the matches, then Create “release notes” unless the text is an existing name. Nothing is highlighted
  on open. The footer names the keys with `.kbd` chips. New group… opens the shared group dialog
  (`ui/public/group-dialog.mjs`, Smart naming in both lists). An add answers "Added to …" with Undo; a run already in a
  group moves, a Shaper slice is skipped and the toast says so.
- Waiting says what it waits for: `Waiting · starts after Complete Design Language Rollout · run 3`,
  `Waiting · starts 14:00`. A group in Needs you leads with the reason: `Run 1 needs you · Checks failing`.
- Question options are divided rows: one --line between rows, no box per option; the picked row takes the --field fill
  and the 6px corner. Recommended is the neutral chip; a confidence is a 12px figure, never a bar.
- A pick-one option carries a round mark (a 16px ring; picked, an ink ring with an ink dot); a square check is only for
  several picks.
- An agent's note in a card is a short question line plus a formatted body (paragraphs, `code`, divided list rows)
  that folds after about six lines and opens in place (`ui/public/shape/note-body.mjs`).
- "Ask for changes" gives way to the field with Cancel and Send changes; Cancel gives the button back.
- The bar's primary names the waiting card's primary ("Approve 2 runs"), and a click on it is that click.
- A destructive confirm says what goes in plain words ("Stop this run?", "Stop run") and opens on the safe choice.

### Marketplace exceptions
The Marketplace page (`ui/public/marketplace/`, design `docs/superpowers/specs/2026-10-19-marketplace-redesign/`) keeps the
catalogue structure that was approved, drawn with this system's tokens:
- Browse is a tile grid: one bordered `.mk-tile` button per plugin, 270px minimum, 16px padding, no shadow at rest or on
  hover. Every other list on the page stays divided rows, except the Marketplaces tab: one `.card.mk-mkt` per
  marketplace (board 4.1), with 16px 20px padding.
- A page-scoped "Search plugins" field and a facet rail sit beside the grid. Rail rows (`.mk-facet`) are 32px rows with a
  count and `aria-pressed`, the selected one on the `--panel` fill; they are not filter chips.
- No page intro: the tabs (Browse · Installed · Marketplaces, each with a count) are the header.
- Centred empty states: a 56px tile, a 15px title, at most one meta line and one action (or the inline add field).
- Kind colours (`.mk-t-*` on the hue families, glyphs on the `-ink-strong` shades) appear only in a plugin's monogram tile
  and as the rail's small kind dots. The update chip ("Update 0.3.0", "2 updates") is the page's blue status chip.
  Status chips there use `.badge.mk-chip-*` on the `-ink-strong` shades (4.5:1 or more); the global `.badge` tones do not change.

### Design stage exceptions
The Design page's stage (`ui/public/design/`) shows real agents at work, so it moves and colours what no other page does. These hold on the stage only.
- **Motion:** a cursor travels between the real elements its agent writes (up to 950 ms) and leaves when its process ends. Guides sweep. The camera zooms and scrolls by itself, at most 400 ms, only when the crew changes, until the person scrolls or zooms. Reduced motion: no travel, no sweep, no ease, no ghost, and the page never moves slower than a jump.
- **Crew colours:** agents wear the dark arms of the hue families (`--blue-ink`, `--teal-ink` …), with `--stage-lemon`, `--stage-coral` and `--stage-sky`, never violet. They identify, they do not mean a state, and they appear only on a cursor, its label, its HUD dot, its Agents row, its Plan row dot and, on a video, its scene's timeline block while the round builds. Waiting is `--amber`, as everywhere.
- **Grammar colours:** `--stage-blue`, `--stage-red`, `--stage-orange` mark what is being written, a guide or overflow, and what is being read.
- **HUD:** always dark, on any page or artifact. Its 2px line is `--blue`. A dot grows on hover.
- **Mono:** size tags (`p 500×58`) are mono: they name an element and its measure.
- **Decks and video:** while a deck or a video builds, every slide or scene is a tile carrying its number and job (`2 Problem`), its size tags read slide pixels, and a video also shows its timeline. A finished deck gets the rail and a finished video the transport.

## Do and don't
| Do | Don't | Why |
|---|---|---|
| Divided rows for lists | A rounded box per item | Boxes stack visual weight and read as unfinished |
| One 32px field | 48px full-width grey inputs | Height must match the buttons beside them |
| Tinted selected filter chip | A solid black selected chip | Solid ink is the primary button; a filter is not an action |
| Sentence-case labels | UPPERCASE kickers | They shout and break the type scale |
| A size from the scale (11, 12, 13, 15, 18, 22; 26 on the Chat home hero) | Half sizes (12.5, 13.5) or one-off sizes | Eighteen near-equal sizes read as noise; seven steps read as hierarchy |
| A fixed chart height | A chart that grows with its width | A 461px chart pushes the numbers off the screen and scales its own labels |
| The plus icon | A typed "+" | Glyphs render at the font's whim and are not one icon set |
| Ids in a tooltip | Ids in visible text | People read names, not engine ids |
| Shadows on menus only | Resting shadows | Shadow means "floats above"; at rest it is noise |
| Amber for needs-you | Amber as decoration | Colour must keep one meaning |
