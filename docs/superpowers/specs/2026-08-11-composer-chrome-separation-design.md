# Composer Chrome — Separation, Constant Canvas Height, Floating Inspector

Date: 2026-08-11
Status: Approved (design presented and approved in-session)
Scope: Pipeline Composer chrome only — `ui/public/index.html` (composer card markup), `ui/public/style.css` (composer block), `ui/public/graph/composer-chrome.mjs`, `ui/public/graph/composer-editor.mjs` (viewport insets only), `ui/public/app.js` (two `createComposerEditor` call sites). No change to the graph model, the execution engine, agent metadata, wiring legality, validation, node geometry, or the save flow.

> NEVER git-commit this file (untracked working artifact by project convention).

---

## 0. Problem

Four complaints against the composer as shipped by `68908ae7`:

1. The open agent palette and the canvas below it read as one continuous surface — the seam is a 1px `var(--line)` hairline against a dotted canvas that is nearly the same value.
2. Same for the inspector rail's 1px `border-left` against the canvas.
3. The open palette **eats** the canvas. The panel is `position:absolute` so the canvas *box* is a constant 638px, but the panel covers its top 240px, leaving ~398px of usable graph while browsing agents — the exact moment you are about to place a node.
4. The inspector's collapse arrow points the wrong way: left chevron while expanded, right chevron while collapsed. It reads as "this panel is over there", not "clicking me moves it".

---

## 1. Locked decisions

Decided in-session, do not re-litigate:

| # | Decision |
|---|---|
| E1 | The palette **stays on top** of the canvas (`position:absolute`, overlay). Confirmed by the user: "the agents can be on top above the canvas". |
| E2 | The **card grows** when the drawer opens — 685px → 925px — so the *visible* canvas band is always 638px, identical to the collapsed state. This is what "the canvas should always be the same height as if the agent panel is collapsed" means given E1. |
| E3 | The inspector **floats on top** of the canvas from the right, flush to its edge. The canvas is full-width underneath and never reflows when the rail collapses. |
| E4 | Separation treatment is **flush + heavy rules**: no gutters, no rounded floating cards. 2px `var(--line-2)` seams, `var(--panel)` surfaces against the dotted canvas, deeper shadows. |
| E5 | The inspector arrow is **inverted**: expanded → right chevron (click collapses rightward), collapsed → left chevron (click expands leftward). |
| E6 | The top drawer's chevron is **untouched** — it keeps the tree-disclosure convention (open → `⌄`, closed → `›`). |

Non-goals: gutters between panels, rounded panel corners, drawer chevron changes, auto-hide behaviour, any change to drawer/inspector persistence semantics.

---

## 2. Current structure (what is being changed)

Markup, `ui/public/index.html:793-834`:

```html
<section class="card builder-card">
  <div class="gv-drawer" id="composer-drawer" data-open="true">
    <div class="gv-drawer-bar"> …toggle… <input id="composer-agent-filter" class="pal-filter"> </div>
    <div id="composer-palette" class="gv-palette-scroll"></div>
  </div>
  <div class="gv-body" id="composer-body" data-inspector="open">
    <div class="gv-canvas" id="composer-canvas"></div>
    <div class="gv-ins-rail" id="composer-ins-rail">
      <button id="composer-inspector-toggle" class="gv-ins-handle">…</button>
      <aside class="gv-inspector" id="composer-inspector"></aside>
    </div>
  </div>
</section>
```

Facts established by reading the code:

- `.builder-card{padding:0;overflow:hidden;display:flex;flex-direction:column;min-height:685px}` (`style.css:766`). 685 = 2px card borders + 45px drawer (44 bar + 1px border-bottom) + 638px body.
- `.gv-body{flex:1 1 auto;display:flex;min-height:0}` (`style.css:767`) — a **row** of canvas + rail.
- `.gv-palette-scroll{position:absolute;top:100%;left:0;right:0;height:240px;…}` (`style.css:803`). `top:100%` resolves against the drawer's padding box (44px), so the panel spans card y 44..284 and covers canvas y 0..239.
- `.gv-ins-rail{position:relative;flex:0 0 280px;width:280px;border-left:1px solid var(--line);…;transition:flex-basis …}` (`style.css:962`), collapsing to `flex:0 0 28px;width:28px` (`style.css:982`).
- `.gv-ins-handle` is `position:absolute;top:10px;left:-12px;z-index:5` — it straddles the rail's left edge and overhangs the canvas (`style.css:974`).
- The collapsed rail rotates the handle's SVG 180° (`style.css:987`). The base path is `M15 6l-6 6 6 6` — a **left** chevron (`index.html:829`). So: expanded = left, collapsed = right. Backwards per E5.
- `.gv-zoom{position:absolute;right:20px;bottom:20px}` and `.gv-empty{position:absolute;left:50%;top:24px}` live **inside** `.gv-canvas` (`style.css:881`, `:871`).
- `canvasInsetTop()` (`composer-chrome.mjs:148`) returns the panel's `getBoundingClientRect().height` when open, 0 when closed. Consumed by `centerWorld()` (`composer-editor.mjs:475`) and `fit()` (`:534`), and wired at **both** `createComposerEditor` call sites (`app.js:1705`, `app.js:1756`) — `test/ui-composer-chrome-app.test.mjs:167` asserts both.
- `toWorld()` (`composer-editor.mjs:350`) reads `getBoundingClientRect()` at event time; there is no `ResizeObserver` and the stage is `position:absolute;inset:0`, so resizing the canvas needs no re-render.

---

## 3. Target state

### 3.1 Card growth (E2)

The fixed height moves off the card and onto the body row, keyed on the drawer's state:

```css
.gv-body{position:relative;flex:1 1 auto;display:flex;min-height:638px;--ins-w:280px;}
/* The panel overlays the body's top 240px, so the body has to be 240 TALLER for
   the uncovered band to stay 638 — the collapsed height exactly. 45 + 878 + 2
   card borders = 925. */
.gv-drawer[data-open="true"] ~ .gv-body{min-height:878px;}
.gv-body[data-inspector="collapsed"]{--ins-w:28px;}
```

`.builder-card{min-height:685px}` is **kept verbatim** — collapsed, it forces the body to exactly 638; open, the body's own 878 drives the card past it. (`test/ui-composer-chrome.test.mjs:405` asserts that literal.)

`min-height:0` on `.gv-body` is replaced by `min-height:638px`. That flag exists to let a flex child shrink below content size; the canvas is `overflow:hidden` and the rail is about to leave the flow, so nothing here needs to shrink below 638 anyway.

**The canvas's top edge does not move** in either state — it is always 45px below the card top. So `toWorld()`, `showChip()` and every pointer handler that reads `rect.top`/`rect.left` are unaffected by the growth, including during a light dismiss that collapses the drawer mid-`pointerdown`. Only the bottom edge travels. The stale comment at `composer-chrome.mjs:107` ("Closing does not reflow") must be corrected: closing *does* reflow the body's height, but not the canvas origin, which is what the editor's `onPointerDown` actually reads.

### 3.2 Floating inspector (E3, E4)

```css
/* Absolute, not a flex item: the canvas keeps its full width and collapsing the
   rail never reflows it. width, not flex-basis, is now what animates. */
.gv-ins-rail{position:absolute;top:0;right:0;bottom:0;width:280px;z-index:6;
  background:var(--panel);border-left:2px solid var(--line-2);box-shadow:var(--shadow);
  display:flex;flex-direction:column;min-height:0;transition:width var(--t-fast,120ms);}
.gv-body[data-inspector="collapsed"] .gv-ins-rail{width:28px;}
```

`flex:0 0 280px` and `border-left:1px solid var(--line)` are dropped. `display:flex;flex-direction:column;min-height:0` carry over verbatim — `.gv-inspector{flex:1 1 auto;…;overflow:auto}` is written as a column-flex child.

z-index 6, not 5: the rail must paint over `.gv-empty` / `.gv-legend` / `.gv-zoom` (all 4) and over the wires and node cards it now covers. It ties with `.gv-chip` (6) and wins on source order, which is correct — the rail is a persistent surface, the chip a transient cursor-follower. It stays below the drawer (7), so the open palette still covers the rail's top 240px exactly as it does today.

`.gv-ins-handle` keeps its `left:-12px` overhang and its own `z-index:5` (now scoped inside the rail's stacking context, purely local ordering).

### 3.3 Canvas decorations that now sit under the rail

```css
.gv-zoom{right:calc(var(--ins-w) + 20px);}
.gv-empty{left:calc(50% - var(--ins-w) / 2);}
```

`--ins-w` is declared on `.gv-body` (§3.1) and inherits into `.gv-canvas`. Without the first rule the zoom/auto-layout cluster — the control a lost user reaches for — would be buried under the rail. The second keeps the empty-state pill centred in the *visible* band. `.gv-legend` is bottom-left and needs nothing.

### 3.4 Palette seam (E4)

```css
.gv-palette-scroll{…;border-bottom:2px solid var(--line-2);
  box-shadow:0 10px 32px rgba(25,25,27,.10);}
```

The stylesheet defines exactly two shadow tokens — `--shadow` and `--shadow-soft` (`style.css:30-31`) — and the panel already uses `--shadow`. A deeper drop needs a literal; do **not** invent a third token for one call site. The rail (§3.2) does gain a real shadow by moving from none to `var(--shadow)`, so it needs no literal.

Only the border weight/colour and the shadow change; `position:absolute`, `top:100%`, `height:240px`, `overflow-y:auto`, the padding and `background:var(--panel)` all carry over. The drawer bar ↔ palette hairline (`.gv-drawer{border-bottom:1px solid var(--line)}`) is **not** touched — bar and palette are one surface, not a seam.

### 3.5 Arrow inversion (E5)

`index.html:829` — base path becomes a **right** chevron:

```html
<path d="M9 6l6 6-6 6"></path>
```

`style.css:987` is unchanged: `[data-inspector="collapsed"] .gv-ins-handle svg{transform:rotate(180deg)}` now yields a left chevron when collapsed. This preserves the existing invariant ("collapsed is the rotated state") and the existing `transition:transform`. `aria-label` is already correct ("Collapse inspector" when expanded) and `setInspector()` (`composer-chrome.mjs:130`) keeps writing it.

### 3.6 Right inset for viewport maths

The canvas is now full-width, so `fit()` and pill-spawn can park a node under the rail. Mirror the `canvasInsetTop` mechanism.

`composer-chrome.mjs` — new optional element and accessor:

```js
/** @param {Element} [opts.insRail] #composer-ins-rail — measured for the right inset */
canvasInsetRight() {
  if (!insRail || !insRail.getBoundingClientRect) return 0;
  return insRail.getBoundingClientRect().width || 0;
}
```

No `isOpen()` guard: unlike the palette the rail is always present, and its collapsed width (28px) is a real inset. Under jsdom the width is 0, so every existing test keeps the pre-inset arithmetic.

`composer-editor.mjs` — new `canvasInsetRight = () => 0` option, consumed in exactly the two places `canvasInsetTop` already is:

```js
// centerWorld()
const insetR = Math.min(Math.max(canvasInsetRight() || 0, 0), r.width || 0);
const c = toWorld(r.left + (( (r.width || 0) - insetR) / 2), r.top + inset + (h - inset) / 2);

// fit()
const insetR = Math.min(Math.max(canvasInsetRight() || 0, 0), r.width || 0);
const vw = (r.width || 960) - insetR;
```

`fit()`'s origin needs no x-shift: the visible band is LEFT-anchored at x=0, unlike the top band which starts below the panel and therefore keeps `y: -b.y*zoom + inset`.

`app.js` — `composer.els.insRail = $('#composer-ins-rail')`, passed to `createComposerChrome`, plus `canvasInsetRight: () => (composer.chrome ? composer.chrome.canvasInsetRight() : 0)` at **both** call sites (`:1705` and `:1756`).

---

## 4. Accepted risks

- **A node can be parked under the floating rail** and become unreachable by pointer until the rail is collapsed. `fit()` and pill-spawn insets cover the common paths; free panning can still bury one. Accepted — the same class of risk the top palette already carries, and collapsing the rail is one click.
- **The card grows by 240px when the drawer opens**, pushing the saved-pipelines list down the page. Accepted as the direct consequence of E2.
- **The rail's top 240px is hidden while the palette is open** (palette z-7 over rail z-6). Unchanged from today.

---

## 5. Test plan

`npm test` is judged modulo the 4 pre-existing imagegen-skill failures.

**Update:**
- `test/ui-composer-chrome.test.mjs:405` — keep the `.builder-card` assertion verbatim (685 is unchanged); add the body-row height pair alongside it.
- Nothing else needs updating. Verified by grep: no test asserts `flex:0 0 28px`, `.gv-ins-rail`'s CSS, or `min-height:0`. Every inspector test drives `data-inspector` through the module and asserts DOM state, which is unchanged. `test/ui-composer-editor.test.mjs:543` reaches for `.gv-zoom` inside the canvas — still true.

**Add (CSS-literal assertions, in the same style as the existing block — jsdom applies no stylesheet):**
- `.gv-body` carries `min-height:638px` and `position:relative`; `.gv-drawer[data-open="true"] ~ .gv-body` carries `min-height:878px`.
- `.gv-ins-rail` is `position:absolute` with `right:0` and a 2px left border; the collapsed rule sets `width:28px`.
- `.gv-zoom`'s `right` is expressed in `--ins-w`.
- `.gv-palette-scroll`'s `border-bottom` is 2px.

**Add (DOM):**
- `index.html`: the handle's path is `M9 6l6 6-6 6` (expanded = right chevron).

**Add (behavioural, jsdom):**
- `canvasInsetRight()` returns the rail's measured width and 0 when no rail is passed.
- `app.js` hands `canvasInsetRight` to **both** `createComposerEditor` call sites — mirror `test/ui-composer-chrome-app.test.mjs:167`.
- `centerWorld()` / `fit()` subtract the right inset. Under jsdom all rects are 0, so these need the same stubbed-rect technique the existing inset tests use, or they are vacuous.

**Manual (real browser, per the CDP-layout-verification approach):**
- Card is 685px collapsed, 925px open; the uncovered canvas band measures 638px in both states.
- The zoom cluster clears the rail in both rail states.
- Both seams read as deliberate edges at 100% zoom.
