# Pipeline Composer — canvas card over an always-expanded Agents section

Date: 2026-08-11
Status: approved (design), ready for implementation planning

## Problem

The agent palette is a collapsible top drawer (commit `24af8183`): a 44px bar in flow
above `.gv-body`, plus a 240px panel that absolutely overlays the canvas's top band
when open. Three costs fall out of that shape:

1. The palette hides itself. A stored `worca-cc.composer.drawer = 'closed'`, an
   Escape, or any canvas pointerdown collapses it, and the agents a user came to
   drag are gone until they find the chevron again.
2. Because the panel overlays the canvas, `centerWorld()` and `fit()` need a
   `canvasInsetTop()` correction threaded from the chrome module through
   `composer-editor.mjs` and both `createComposerEditor` call sites in `app.js`.
3. The composer's cards touch. No gap rule exists anywhere — `.view{display:block}`
   (style.css:249) and `.card` (style.css:265) carries no margin — so
   `.builder-card` and `.saved-card` share a seam with doubled borders.

## Goal

Canvas on top with its collapsible inspector on the right; a separate,
always-expanded Agents section below it; visible breathing room between every
section.

## Layout

Three stacked cards inside `<section class="view" data-view="composer">`, 22px apart:

```
┌ .card .builder-card ───────────────────┬───────┐
│ .gv-body: .gv-canvas + .gv-ins-rail    │  ins  │  640px
└────────────────────────────────────────┴───────┘
                    22px
┌ .card .gv-palette-card ────────────────────────┐
│ .gv-palette-head:  Agents      [Filter agents…]│   52px
├────────────────────────────────────────────────┤
│ .gv-palette-scroll  chips / groups / FLOW·PIN ▓│  300px
└────────────────────────────────────────────────┘
                    22px
┌ .card .saved-card — Saved pipelines ───────────┐
```

`#composer-dialog` (an empty host div) sits between the palette card and the saved
card in source order, so the spacing rule uses the **general** sibling combinator:

```css
.view[data-view="composer"] > .card ~ .card { margin-top: 22px; }
```

`.builder-card` is the first `.card` and therefore unmatched — no margin under the
topbar, which already owns that spacing.

### Naming

`.pal-head` is already claimed at style.css:1409 by an unrelated palette, so the new
classes stay in the composer's `gv-` family: `.gv-palette-card`,
`.gv-palette-head`, `.gv-palette-title`. `.gv-palette-scroll` keeps its name and its
role as the scroll host; only its positioning changes.

## Geometry

| | before | after |
|---|---|---|
| `.builder-card` min-height | 685 (2 borders + 45 drawer + 638) | **640** (2 borders + 638) |
| `.gv-body` min-height | 638; 878 while the drawer is open | 638, always |
| visible canvas height | 638 | 638 — unchanged |
| `.gv-palette-scroll` | `position:absolute`, `height:240px`, overlays canvas | in flow, `height:300px`, own scrollbar |
| `.gv-empty` top | 24; 264 under an open drawer | 24, always |
| palette card total | — | 2 + 52 + 300 = **354px** |

New rules, mirroring `.builder-card`'s column-flex shape so the head stays fixed and
the scroll host owns the overflow:

```css
.gv-palette-card{padding:0;overflow:hidden;display:flex;flex-direction:column;}
.gv-palette-head{flex:0 0 52px;height:52px;display:flex;align-items:center;gap:12px;
  padding:0 18px;border-bottom:1px solid var(--line);}
.gv-palette-title{font-size:12.5px;font-weight:600;color:var(--ink-2);}
.gv-palette-scroll{height:300px;overflow-y:auto;padding:14px 18px 8px;}
```

`.gv-palette-card{padding:0}` beats `.card{padding:24px}` on source order, the same
way `.builder-card` already does. `height`, not `max-height`: the section stays 300px
however many custom agents a user registers, so the page never reflows underneath the
canvas.

Deleted rules: every `.gv-drawer*` and `.gv-drawer-bar*` selector,
`.gv-drawer[data-open="true"] ~ .gv-body{min-height:878px}`, and
`.gv-drawer[data-open="true"] ~ .gv-body .gv-empty{top:264px}`.

Carried over verbatim: the `.pal-filter` block moves from `.gv-drawer-bar .pal-filter`
to `.gv-palette-head .pal-filter` with every declaration, its `::placeholder` rule and
its `:focus-visible` ring intact (`input[type=search]` is not matched by the generic
control rules at style.css:278-299, so the ring must stay declared locally).

Adjusted: `.pal-pinned`'s negative bleed goes `-16px` → `-18px` to match the scroll
box's new 18px gutter. The sticky `.pal-chips` rule is untouched — `top:-14px` only
ever depended on the scroll box's 14px top padding, which is unchanged.

`.gv-drawer`'s `z-index:7` disappears with it. Nothing overlays the canvas from above
anymore, so `.gv-chip` and `.gv-ins-rail` (both 6) are the composer's ceiling again.

## Markup

`.builder-card` keeps `.gv-body` as its only child. The palette moves into its own card:

```html
<section class="card gv-palette-card" aria-label="Agents">
  <div class="gv-palette-head">
    <b class="gv-palette-title">Agents</b>
    <input id="composer-agent-filter" class="pal-filter" type="search"
           placeholder="Filter agents…" aria-label="Filter agents by name or ports">
  </div>
  <div id="composer-palette" class="gv-palette-scroll"></div>
</section>
```

Two invariants the editor depends on and this preserves:

- `#composer-palette` keeps its id and remains the exact subtree `renderPalette()`
  hands to `replaceChildren()` — the domain chips, the per-domain `.pal-group`
  sections and the pinned Flow group.
- `#composer-agent-filter` stays **outside** that subtree, so a repaint never
  destroys the field the user is typing into.

The `<b>` is deliberate: `.card h2` (style.css:269) carries `margin:0 0 18px`, which
would fight the 52px flex head.

## Module changes

### `ui/public/graph/composer-chrome.mjs`

Loses `DRAWER_KEY`, `setDrawer()`, `syncDefault()`, `onToggleClick()`,
`onDrawerKeyDown()`, `onCanvasPointerDown()`, `onFilterInput()`, `canvasInsetTop()`,
and the `drawer` / `toggle` / `panel` / `canvas` / `hasAgents` options.

Keeps `INSPECTOR_KEY`, `setInspector()`, `canvasInsetRight()` and `destroy()`. New
signature:

```js
createComposerChrome({ body, insToggle, insRail, filter, storage })
  -> { canvasInsetRight(), destroy() }
```

Escape survives in reduced form, bound on the **filter** element (the drawer that
used to carry the listener is gone):

- filter non-empty → `preventDefault()`, clear, dispatch a synthetic bubbling
  `input` so the editor's `applyFilter()` re-runs, then `stopPropagation()` so the
  editor's document-level Escape deselect does not also fire.
- filter empty → pass straight through to the editor.

`preventDefault()` is load-bearing: Blink and WebKit clear `input[type=search]`
themselves on Escape, and without it the clear would happen twice.

### `ui/public/graph/composer-editor.mjs`

The `canvasInsetTop` option and both consumers go:

- `centerWorld()` → `toWorld(r.left + (w - insetR) / 2, r.top + h / 2)`
- `fit()` → `zoom = clamp(min(vw / b.w, vh / b.h))`, `y = -b.y * zoom`

`canvasInsetRight` stays — the inspector rail still floats over the canvas's right
edge, so spawn and fit still have to clear it.

### `ui/public/app.js`

- `initComposer()`: drop `els.drawer` and `els.drawerTog`; drop `drawer`, `toggle`,
  `panel`, `canvas` and `hasAgents` from the `createComposerChrome()` call.
- Drop `canvasInsetTop:` from **both** `createComposerEditor` call sites
  (`initComposer` and `composerLoadTemplate`).
- Drop both `syncDefault()` calls — the one after the editor is constructed and the
  one at the end of `composerLoadTemplate()`.

`composer.chrome` keeps its construct-once / never-destroyed lifecycle: it still owns
no graph state and still survives every editor swap.

## Behaviour deltas

| | before | after |
|---|---|---|
| palette visibility | collapsible, sticky in localStorage | always expanded |
| first-visit default | open only on an agent-free canvas | always open |
| Escape in filter | clears, then collapses on a second press | clears only |
| canvas pointerdown | light-dismisses the palette | nothing |
| spawn / fit | correct for a 240px top overlay | no top overlay to correct for |
| inspector rail | floating, collapsible, sticky | unchanged |

`worca-cc.composer.drawer` becomes a dead key. It is left in place rather than
migrated — reading it is what stops, and an orphan string in localStorage costs
nothing.

## Testing

- `test/ui-composer-chrome.test.mjs` — delete the drawer suite (default resolution,
  toggle, persistence, `syncDefault`, Escape staging, light dismiss, filter re-open,
  `canvasInsetTop`, `destroy` unbinding of drawer listeners, and the drawer-shaped
  `index.html` / `style.css` assertions). Keep all inspector tests verbatim. Add:
  palette host lives in its own card below the canvas card; no `#composer-drawer` or
  `#composer-drawer-toggle` survives; the filter sits in the head, outside the
  replaced subtree; the scroll host is in flow with a fixed height; the canvas card
  is 640; the `~ .card` 22px rule exists.
- `test/ui-composer-chrome-app.test.mjs` — delete the `canvasInsetTop` wiring test and
  the four `syncDefault` / drawer-default tests. Keep the `canvasInsetRight` twin. Add
  a negative source assertion that `app.js` no longer names the drawer or
  `syncDefault`.
- `test/ui-composer-editor.test.mjs` — drop `canvasInsetTop` from `boot()`; rewrite
  the two spawn/fit tests at :750-780 to assert centring on the full canvas height.
- Sweep `test/ui-composer-save.test.mjs` and `test/ui-composer-wires.test.mjs` for
  drawer references before editing anything else.

Baseline: `npm test` is judged modulo the four pre-existing imagegen-skill failures.

## Out of scope

Inspector rail behaviour, node/wire rendering, palette content and grouping, the
saved-pipelines card's internals, and any responsive/mobile breakpoint work.
