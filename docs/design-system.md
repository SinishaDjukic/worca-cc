# Worca design system

The one reference for how Worca looks. Every screen follows it; `test/ui-design-language.test.mjs` and
`tools/button-audit.mjs` enforce the rules marked (checked). When the guide and the code disagree, fix one of them in
the same commit.

## Foundations

### Colour
Every colour is a token in `:root` of `ui/public/style.css`, written as `light-dark(light, dark)`. Never restate a hex.
| Token | Meaning |
|---|---|
| `--ink`, `--ink-2`, `--ink-3` | text: primary, secondary, tertiary |
| `--line`, `--line-2` | dividers; control borders |
| `--panel`, `--surface`, `--field` | page; raised surface; field and tint fill |
| `--amber*` | needs you (a person must act) |
| `--red*` | failed, destructive |
| `--peach*` | working |
| `--green*` | ready, in review, done well |
| `--violet*` | merged; the Labs chip |
| `--blue*` | information only (the Beta chip); never a status, never a bar |
Amber means "needs attention" and nothing else: not a brand mark, not "not installed".

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
`outline:2px solid var(--ink); outline-offset:2px` on `:focus-visible`; tabs and rows use an inset `-2px` offset. A page
that focuses its way back on open hides the ring while `data-input="pointer"`.

## Components
### Button (checked)
`.btn` + one size (`.btn-sm`, `.btn-lg`) + one variant (`.btn-primary`, `.btn-quiet`, `.btn-danger`); `.btn-icon` is
square. One primary per group. Labels of 1–3 words, verb first. Icons come from `icon(doc, 'plus')`
(`ui/public/icons.mjs`), never a typed "+", "×" or "▾" (checked). `.info-tip` is a 28px square like `.btn-sm.btn-icon`; a
button outside `.btn` must be a shared control or a row a person opens (checked by the stray audit). The composer's
disabled Save keeps its ink fill at 70% opacity, not the 45% grey of other disabled buttons, so it still reads as the
primary.
### Field
`.input` / `.select` / text, number and select elements: 32px, 13px, `--field` fill, 6px corner, ink border on focus.
`.input-sm` / `.select-sm`: 28px, 12px. A textarea grows; it keeps the same fill, corner and padding sides. Search, url, email,
password and date inputs follow the same field; each joins the base rule when its screen moves.
### Segmented control
`.seg`: one `--field` container, 28px / 13px buttons, the selected one `--surface`. `.seg-sm` is the same size.
### Tabs
`.tabs` / `.tab`: underline tabs, 32px, never boxed (checked).
### Filter chip
`.filter-chip` (`aria-pressed`): 28px, 12px / 500, 1px `--line-2` border, 6px corner. Selected: `--field` fill, ink
border, ink text. Never a solid ink fill. A count sits in `.n`. It is the only filter chip: `mv-filter`, `wfl-chip`,
`proj-fchip` and `mcp-chip` are gone (checked).
### Chips and badges
One chip: 18px, 11px / 500, 4px corner, filled, no border (checked). The Labs (violet) and Beta (blue) flag chips are the
reference size. Colour carries meaning only.
### Status dot and symbols
A dot is the state: peach working (pulses), grey paused or waiting, green ready, violet merged. Needs you is an amber
"?" only when Worca asks; a PR problem is a plain amber dot with the reason in the PR chip; failed is a red "!".
### Menus
`openMenu({ doc, anchor, items, align, side, label })` (`ui/public/workflows/menu.mjs`). No hand-built dropdowns.
### Cards versus divided rows
Prefer divided rows (`.drows` / `.drow`): rows split by one `--line`, no box per item. A card (`.card`, 8px corner,
24px padding) frames one thing you act on; never a card inside a card (checked). `.drow-wide` puts a wide control
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
- Stat tiles hold numbers only (time, cost, files changed). A list of chips goes in its own labelled row under the
  tiles, for example the run page's "Cost tags" row, never stacked inside a tile. The value is sans with tabular figures.
- Search is the top bar's "Search or ask" only. A list filter is chosen there ("Runs labelled hotfix", `label:hotfix`),
  not from a filter button in the list's header. The Marketplace's Browse search is the one exception
  (Marketplace exceptions).
- Phones: one 16px gutter; nothing scrolls sideways at 290px.

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
