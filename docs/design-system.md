# Worca design system

The one reference for how Worca looks. Every screen follows it; `test/ui-design-language.test.mjs` and
`tools/button-audit.mjs` enforce the rules marked (checked). When the guide and the code disagree, fix one of them in
the same commit.

## Foundations

### Colour (checked)
Every colour is a token in `:root` of `ui/public/style.css`, written as `light-dark(light, dark)`. Never restate a hex;
a `color-mix()` recipe used twice is a named token (`--btn-hover`, `--red-tint`, …).
| Colour | Tokens | Means | Never |
|---|---|---|---|
| ink | `--ink`, `--ink-2`, `--ink-3` | primary and neutral text; a checked box, a checked radio, an on switch | — |
| green | `--green*` | done, OK, ready, in review | a checked box, an on switch, decoration |
| amber | `--amber*` | needs you, attention, waiting; a PR problem | a brand mark, "not installed", "built-in" |
| red | `--red*` | failed, destructive | a warning that needs no action |
| blue | `--blue*` | information (the Beta chip), in-progress text, links | a status dot (except the route's with-reviewers circle `.rd-route-dot.is-review`), a bar, team policy |
| violet | `--violet*` | Labs only (the merged status dot, the merged run orb and the run page route's merged circle `.rd-route-dot.is-merged` and merged words `.rd-fact-tx.is-merged` are the named exceptions; the Marketplace chat kind tile and dot follow its kind colours, › Marketplace exceptions) | sources, "Official", policy, a badge, a chart series |
| slate | `--slate*` | neutral metadata: a source, "Official", policy (`.badge.slate`) | a state |
Status-dot exceptions: peach = working (it pulses), violet = merged. They are the dots only, never a badge.
Surfaces: `--panel` page, `--surface` raised, `--field` field and tint fill; `--line` dividers, `--line-2` control borders.
`--row-selected` is `--ink` at 8% over transparent (no new hue): the selected Runs row, one ink step over whatever it
sits on, so it reads on the panel and on the Needs-you amber tint alike. Its PR chips take the `-ink-strong` shades to
stay at 4.5:1. `--row-open` is 50% of `--row-selected`: the
lighter row highlight of a collapsed Runs group whose run is open.

Known drift (left for a later run): amber `badge waiting` on Guardrails' "built-in"
and Models' "endpoint-routed", "project (legacy)" and "plugin:" labels; blue engine and credential badges. The interface
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

## Components
### Button (checked)
`.btn` + one size (`.btn-sm`, `.btn-lg`) + one variant (`.btn-primary`, `.btn-quiet`, `.btn-danger`); `.btn-icon` is
square. One primary per group. Labels of 1–3 words, verb first. Icons come from `icon(doc, 'plus')`
(`ui/public/icons.mjs`), never a typed "+", "×" or "▾" (checked). The `eye` glyph is used only by the View PR ▾ menu's
Watch item and the route's idle `Watching` button. `.info-tip` is a 28px square like `.btn-sm.btn-icon`; a
button outside `.btn` must be a shared control or a row a person opens (checked by the stray audit). The composer's
disabled Save keeps its ink fill at 70% opacity, not the 45% grey of other disabled buttons, so it still reads as the
primary.
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
   with one remote), Pull requests (a feature, a chain or a user group only: One / N stacked, or N separate for a user group, the suggestion under them),
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
`.input-sm` / `.select-sm`: 28px, 12px. A textarea grows; it keeps the same fill, corner and padding sides. Search, url, email,
password and date inputs follow the same field; each joins the base rule when its screen moves.
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
### Filter chip
`.filter-chip` (`aria-pressed`): 28px, 12px / 500, 1px `--line-2` border, 6px corner. Selected: `--field` fill, ink
border, ink text. Never a solid ink fill. A count sits in `.n`. It is the only filter chip: `mv-filter`, `wfl-chip`,
`proj-fchip` and `mcp-chip` are gone (checked).
### Chips and badges
One chip: 18px, 11px / 500 sans, 4px corner, filled, no border (checked). The Labs (violet) and Beta (blue) flag chips are
the reference size. Colour carries meaning only. The "Suggested" chip on the New run form's title and branch (`.sn-chip`, Smart run naming) is a permitted Labs-violet use: the whole feature is a Labs feature. Cost-tag chips (`.tag-chip`), the Projects sync pill (`.ps-pill`), the
Chat command card's state (`.ask-cmd-pill`) and the Team policy tab count (`.tp-tab-badge`) are the same chip; on the
active tab the count turns neutral (`--line-2` fill, ink text). A chat command in summary mode (flag `commandSummaries`) shows the runs status dot and no state chip; the full card keeps `.ask-cmd-pill`. The missing-key slot is the one outlined chip: a 1px dashed
`--amber` outline on a transparent fill. A removable chip's × is a 14px quiet button inside the chip. A source, "Official"
or a policy origin is `.badge.slate`; "not installed" and "built-in" are grey.
### Status dot and symbols
A dot is the state: peach working (pulses), grey paused or waiting, green ready, violet merged. Needs you is an amber
"?" only when Worca asks; a PR problem is a plain amber dot with the reason in the PR chip; failed is a red "!".
An idle chat shows the chat bubble line icon in the dot's place.
### Card head
The first line of a card is its headline. When the page title sits above the card (the run page, the group page),
the state is the headline: `.run-status-word`, 1–3 words at `--fs-section` / 600 / `--lh-title`, never truncated, the
status dot centred on it and the head buttons and the Live switch centred on its line (`.rd-sheet-head`,
`--rd-word-line`). Under it, `.run-status-detail`: 12px `--ink-2`, at most 2 lines (the whole text as its tooltip),
and only what no row below says ("not in dev yet", "Failed · Build · Implementation" → "Build · Implementation",
"14 files changed in a copy", "conflicts with dev", GitHub's verdict); absent otherwise. A card with its own title
(the chat run card) keeps the state at 13px / 600 under it. Titles are static or short ("Change Away mode?"); dynamic
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
### Menu (checked)
One menu skin. The box is `.menu`: 4px padding, `--panel`, 1px `--line`, `--r-md` (8px), `--shadow-menu`, 13px. A row is
`.menu-item`: at least 30px, `--r-sm` (6px), `--hover` on hover and keyboard focus; `.menu-sep` and `.menu-h` (12px /
600 `--ink-2`) divide and head. A disabled row is `--ink-3` with no hover; a destructive row is `.menu-item.is-danger`
(red ink, `--red-bg` on hover) and nothing else in a menu is red or amber. `openMenu({ doc, anchor, items, align, side,
label, host, className })` (`ui/public/workflows/menu.mjs`) emits it, and its items take `danger`. With `host` the menu
is appended inside it (a `.btn-split.mini`) and placed by its CSS; a `{ switch: true }` item is a `menuitemcheckbox`
switch row (help line, `.switch`) whose toggle keeps the menu open. The run page's View PR ▾ is built with it. The sidebar flyouts (`.nav-fly`), the
composer pickers (`.ask-pop`) and the split-button menus (`.btn-split-menu`) keep their
own builders and positions and add `.menu` / `.menu-item`; they carry no box or row skin of their own. No hand-built
dropdowns. An item that has a key shows it as its `hint` (the 11px `--ink-2` count slot): the Runs row ⋯ reads `S`, `E`, `⌫`.
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
Empty: one `.empty-line` (13px `--ink-2`) plus one quiet action. Loading: `aria-busy="true"` on the list, no spinner
under 300ms. Error: a plain sentence plus a "Details" quiet button, never the raw error.
### Toasts
`notify({ tone, title, detail, action, key })` (`ui/public/feedback.mjs`): ok and info close after 5s, warn and err
stay, never move focus.
The title is at most 6 static words ("Could not open the workflow"). Names, ids and paths go in `detail`; a raw error
goes in `detail` too, never in the title, and behind a Details action when it is long.
### Modals
`confirmModal({ title, message, confirmLabel, danger })` (`ui/public/app.js`): a destructive confirm names what goes;
only inside a confirm is `.btn-danger` solid red. Footer actions and the head Close are 32px `.btn`; inline field
buttons stay 28px; the card keeps the shared 24px padding (checked by the theme proof's `dialog-sizes`).

Dialog anatomy (`ui/public/dialog-layout.mjs`): a `.viewer-modal` card that can outgrow the window carries `.dlg` and
three direct children. `.dlg-head` holds the hero, title and subtitle (and head actions such as Close); `.dlg-body` is
the only scroller; `.dlg-foot` holds the status line and the action row. Head and foot never scroll away, and a 1px
divider appears only while content sits under them. Static dialogs write the wrappers in `index.html`; a JS builder
calls `layoutDialog(card, { head, foot })`. Keep the card's 24px padding (the regions bleed over it). Seams are the
body's padding, `--dlg-gap-head` / `--dlg-gap-foot` (default 18px / 14px): set those, never a margin. Never add a sticky
header with negative margins, and keep a nested scroller only for a bordered box (a list or a preview) that is bounded
on purpose. Under 640px of height the head compacts (smaller hero, tighter gap) but stays. The Marketplace's
`.mk-dialog` / `.mk-sheet` follow the same model with their own class names.

Keyboard shortcuts sheet (`ui/public/keys-sheet.mjs`): the one sheet listing the list keys, opened by `?` on a list page
or View › Keyboard shortcuts. A 760px `.card` dialog in the shared anatomy: two columns of divided rows (label left, key
chips right, "or" between alternatives), stacked under 640px, and a foot with a 12px note and Close. Its `kbd.kbd`
chips share the top search's `.tsearch-kbd` rule; there is no second key-chip style. Esc, Close or the backdrop close it
and hand the focus back to the opener.

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
  no page header; the Marketplace's tabs are its header (Marketplace exceptions).
- Stat tiles hold numbers only (time, cost, files changed). A list of chips goes in its own labelled row, for example
  the Cost tags row in the run page's facts block, never stacked inside a tile. The value is sans with tabular figures.
- Run and group pages share one head: the bar (Back, a 28px chevron `Back to Runs`, in every layout; the breadcrumb
  `Runs › Run tags › Run 2` beside it when the list stands beside the page; Run after; on the right the one primary
  action, Stop, ⋯), the title (one line, cut with "…" where the column ends; the cut is CSS only, the stored name is
  whole, its tooltip holds it, and the bar repeats it once the title scrolls away). A run page's title has no kind chip:
  a run in a group has no group row in its facts block, and the breadcrumb names and links its group. A group page's
  title keeps its kind chip (`Feature` / `Chain` / `Group`). Then the card: the status block (the state word as the card's headline with its detail under it, the head buttons at its right,
  centred on the word's line, with the PR control among them; see Card head and PR controls. Beside the stage bar the
  detail names only the step (`Working` / `Refine Plan`); the stage is on the bar), the route ("Where the work is") under a `--line` divider, the facts block (`.rd-kv`: Project, Labels, Cost tags and Group, in that order; 12px
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
  Rows inside a group draw no dividers; the group keeps its own divider before the next row.
- Two row levels in the Runs list and the Chats column. A top-level row (a single run, Needs you, a group row) has a
  13px / 500 title over a 12px status line; a group row's title is 600. A row inside a group is one line, 26px (40px on
  touch screens): a 12px / 400 title, then its status at the right (it drops the Working / Starting word its dot says
  and ellipsises first), then its PR chip; no label chips and no Independent tag. A live member's 3px line sits under
  its title. Its ⋯ stays 28px, centred.
- Search is the top bar's "Search or ask" only. A list filter is chosen there ("Runs labelled hotfix", `label:hotfix`),
  not from a filter button in the list's header. The Marketplace's Browse search is the one exception
  (Marketplace exceptions).
- Phones: one 16px gutter; nothing scrolls sideways at 290px.
- Runs list order: Needs you (most urgent first), Running, Waiting, Recent. Each section is newest dispatch first (a
  run's start, a waiting ticket's creation); a section with no rows is not drawn.
- Chats list: the Runs list anatomy in the Chat page's column; the open chat's figures sit once in the conversation
  head as a readout control (`button.chat-head-meter`, 11px mono, like the cost breakdown's `.cost-bd-btn`), not a
  §1.2 button; sections Pinned · Today · Recent
  (the 10 latest before today) · Older (folded); Archive is disabled while a chat replies, runs a command or follows a
  live run; an archived chat reads Restore, as a run does; New chat is the one + after the list toggle; a topic group is
  a Runs group row (count, ⌄, members indented 16px, no dividers) placed by its newest chat; its sub line names its
  project or `N projects`; Group by Project files a group spanning projects under Several projects, never No project;
  Group by Topic shows one section per group, then Ungrouped; the group dialog's name field
  uses Smart run naming's Suggested chip only while that flag is on.
- Waiting says what it waits for: `Waiting · starts after Complete Design Language Rollout · run 3`,
  `Waiting · starts 14:00`. A group in Needs you leads with the reason: `Run 1 needs you · Checks failing`.
- Question options are divided rows: one --line between rows, no box per option; the picked row takes the --field fill
  and the 6px corner. Recommended is the neutral chip; a confidence is a 12px figure, never a bar.
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
