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
| blue | `--blue*` | information (the Beta chip), in-progress text, links | a status dot, a bar, team policy |
| violet | `--violet*` | Labs only (the merged status dot, the merged run orb and the run page tracker's merged node `.rd-track-dot.is-merged` are the named exceptions; the Marketplace chat kind tile and dot follow its kind colours, › Marketplace exceptions) | sources, "Official", policy, a badge, a chart series |
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
| `--fs-page` | 22px | 1.25 | page titles (`.page-title`, the run and group page title), 700, -0.02em, at most 2 lines |
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

## Components
### Button (checked)
`.btn` + one size (`.btn-sm`, `.btn-lg`) + one variant (`.btn-primary`, `.btn-quiet`, `.btn-danger`); `.btn-icon` is
square. One primary per group. Labels of 1–3 words, verb first. Icons come from `icon(doc, 'plus')`
(`ui/public/icons.mjs`), never a typed "+", "×" or "▾" (checked). The `eye` glyph is used only by the View PR ▾ menu's
Watch item and the tracker's idle `Watching` button. `.info-tip` is a 28px square like `.btn-sm.btn-icon`; a
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
   with one remote), Title and description (with Draft), After it opens (Watch PR, Release). Its footer: a divider,
   then Cancel and the primary on the right; "Try it first" is a secondary `.btn` on the left; one primary. Field
   labels in it are nouns ("Into", "Push remote", "Draft").
5. Links. A PR text link (`.rd-prs-link`, `.rd-track-pr`, `.chat-rc-watch-pr`, `.ask-prcard-link`, `.ask-shipcard-pr`,
   `.hd-pr-repo-link`) is `--blue-ink-strong`, weight 600.
Placement: on the run page the PR control sits in the card's head at every level (`.rd-sheet-head > .rd-head-acts`, the
`.rd-pr-slot` among the head buttons: Try it, Create PR, Push, Fix conflicts, Ask for changes, Discard / Apply, How to
merge, Report), centred on the status line, with at most one primary; under 420px of head width the buttons wrap onto
their own row below the status, on the left edge. View PR is a split button `View PR │ ▾`
(`.btn-split.mini.rd-pr-split`): the main half opens the PR, the ▾ (PR scope) holds Watch (Advanced and above), Copy PR
link and Fix conflicts (while the PR conflicts). A workspace run has one `View PRs ▾` button that lists each member's PR.
Nothing PR-related sits in the bar or in a PR bar; the PR's checks and Watch words are the tracker's PR step. Runs list PR
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
active tab the count turns neutral (`--line-2` fill, ink text). The missing-key slot is the one outlined chip: a 1px dashed
`--amber` outline on a transparent fill. A removable chip's × is a 14px quiet button inside the chip. A source, "Official"
or a policy origin is `.badge.slate`; "not installed" and "built-in" are grey.
### Status dot and symbols
A dot is the state: peach working (pulses), grey paused or waiting, green ready, violet merged. Needs you is an amber
"?" only when Worca asks; a PR problem is a plain amber dot with the reason in the PR chip; failed is a red "!".
### Tracker
The run page card's read-only "where is the work" line (`.rd-track`, `ui/public/run-head.mjs` `renderTracker`), under
the status line after a `--line` divider, at every level. Three steps on one 3-column grid: the PR path (Changes ·
Pull request · Merged into the base), the Push path (Changes · In the source here · On the remote), a Folder run's two
steps (Changes · Applied to your folder), and one row per workspace member with its name in a 44px column. Each step is
a 16px node, a 12px label (600 when current, `--ink-3` when future) and a 1px connector, `--green` after a done node and
`--line-2` otherwise. Nodes reuse the status-dot colours: done is a green fill with ✓, current is a ring with a dot
(peach pulsing while working, green when ready, violet filled with ✓ once merged), a problem is an amber `!`, failed a
red `!`, closed an `--ink-3` × with a struck label, future a hollow `--line-2` ring. Glyphs come from `icons.mjs`
(`check`, `alert`, `x`). An optional 12px `--ink-2` second line holds the PR link (`#866`), GitHub's verdict, blue
(`--blue-ink`) in-progress words and amber (`--amber-ink`) problems. Its links and its two quiet buttons (`Watching`,
which opens the ▾ menu at Advanced, and kept work's `Commit it yourself`, `button.rd-track-act`) are its only controls.
Under 480px the labels wrap and the connectors shrink to 8px.
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
dropdowns.
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
### Modals
`confirmModal({ title, message, confirmLabel, danger })` (`ui/public/app.js`): a destructive confirm names what goes;
only inside a confirm is `.btn-danger` solid red. Footer actions and the head Close are 32px `.btn`; inline field
buttons stay 28px; the card keeps the shared 24px padding (checked by the theme proof's `dialog-sizes`).

## Patterns
- Status line: "State · detail", for example "Failed · Review · Review Implementation". No colon forms.
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
  action, Stop, ⋯), the title with its kind chip (`Run 2 of 3`, `Run`, or
  `Feature` / `Chain` / `Group`), then the card: the status block (the status line, the head buttons at its right, with
  the PR control among them; see PR controls), the tracker under a `--line` divider, the facts block (`.rd-kv`: 12px
  `--ink-2` labels, 13px values, one row per fact and one place to edit it; a quiet button that leads a value pulls back
  by its padding so its text sits on the value column), then the tiles (`--fs-stat` sans values with tabular figures,
  `--pad-tile` padding). No PR bar, no kept-work, merge-back or Apply box: their actions are head buttons.
- The run page's ⋯ holds run-scope actions, the same on the live and saved pages at every level: Away mode (while
  live), Save as preset, Terminal (Ctrl+`), then Report this run and Archive (Restore once archived). Archive asks
  "Archive this run?" and is disabled, with the reason as its tooltip, while a local copy is open or kept work waits.
  The bar never makes an Archive or Report button: a failed run's Report this run is in ⋯ and in the card head.
  ⋯ = this run; ▾ = this pull request.
- Runs navigation: every row opens its own page in the right pane and the list stays. A group row opens the group
  page; the ⌄ only expands. One row is highlighted at a time, the one whose page is open: a collapsed group whose run
  is open shows the lighter `--row-open` fill over its whole row; expanded, only the open run's row is highlighted.
  Rows inside a group draw no dividers; the group keeps its own divider before the next row.
- Search is the top bar's "Search or ask" only. A list filter is chosen there ("Runs labelled hotfix", `label:hotfix`),
  not from a filter button in the list's header. The Marketplace's Browse search is the one exception
  (Marketplace exceptions).
- Phones: one 16px gutter; nothing scrolls sideways at 290px.
- Runs list order: Needs you (most urgent first), Running, Waiting, Recent. Each section is newest dispatch first (a
  run's start, a waiting ticket's creation); a section with no rows is not drawn.
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
