# Composer Chrome Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Pipeline Composer a visible seam between the agent palette, the canvas and the inspector; keep the visible canvas height constant whether the palette is open or collapsed; float the inspector over the canvas; and invert its collapse arrow.

**Architecture:** Four independent slices of the composer's chrome. The palette keeps overlaying the canvas, but the body row grows by the panel's height so the uncovered band never shrinks. The inspector rail leaves the flex row and becomes an absolutely-positioned panel over the canvas's right edge, which makes the canvas full-width and gives the viewport maths a *right* inset to mirror the existing `canvasInsetTop`. Both seams become 2px `var(--line-2)` rules against `var(--panel)` surfaces.

**Tech Stack:** Vanilla ES modules + plain CSS in `ui/public/`. Tests are `node:test` + `jsdom`, run by `npm test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-11-composer-chrome-separation-design.md`. Never git-commit that file or this plan — `docs/superpowers/` is an untracked working artifact by project convention.
- `npm test` is the whole suite; it is judged **modulo 4 pre-existing `imagegen-skill` failures**. Any other failure is yours.
- Card geometry that the renderer and hit-tester share lives in `ui/public/graph/graph-geometry.mjs`, not CSS. Do not change node width/height or port-row heights.
- jsdom applies no stylesheet and answers zeros for every `getBoundingClientRect()`. CSS is therefore asserted as **source text** against `ui/public/style.css`, and any layout-dependent behaviour test must stub a rect. This is the house pattern (`test/ui-composer-chrome.test.mjs:340`, `test/ui-composer-editor.test.mjs:747`).
- Only these shadow tokens exist: `--shadow:0 6px 28px rgba(25,25,27,.05), 0 1px 2px rgba(25,25,27,.04)` and `--shadow-soft:0 2px 12px rgba(25,25,27,.04)` (`style.css:30-31`). Do not invent a third.
- Colour tokens used here: `--panel:#FFFFFF`, `--line-2:#E3E3E0`, `--t-fast:120ms`.
- `@media (prefers-reduced-motion: reduce){*{transition:none !important}}` at `style.css:654` already neutralises every transition added below. Do not add a second guard.
- Locked decisions (do not re-litigate): palette stays an overlay; card grows 685→925 when it opens; inspector floats flush right; separation is flush + heavy rules, **no gutters and no rounded floating panels**; the top drawer's own chevron is untouched.

---

### Task 1: Invert the inspector collapse arrow

The handle's base SVG is a **left** chevron and the collapsed state rotates it 180° to a right chevron — backwards. Swapping the base path to a right chevron fixes both states at once and keeps the existing "collapsed is the rotated state" invariant, the existing `transition:transform`, and the `aria-label` logic in `composer-chrome.mjs:130`.

**Files:**
- Modify: `ui/public/index.html:827-829`
- Test: `test/ui-composer-chrome.test.mjs` (append to the `index.html:` block that ends at the file's last test)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. `style.css:987` (`[data-inspector="collapsed"] … svg{transform:rotate(180deg)}`) stays exactly as it is.

- [ ] **Step 1: Write the failing test**

Append to `test/ui-composer-chrome.test.mjs`:

```js
test('index.html: the collapse arrow points the way the panel travels', () => {
  // Expanded, the click collapses the rail RIGHTWARD, so the base path is a
  // right chevron. style.css rotates it 180deg while collapsed, which yields the
  // left chevron that means "click me to bring the panel back". The old base
  // path, M15 6l-6 6 6 6, was the left chevron and had both states backwards.
  const path = realDoc.querySelector('#composer-inspector-toggle svg path');
  assert.ok(path, 'the handle still ships an inline chevron');
  assert.equal(path.getAttribute('d'), 'M9 6l6 6-6 6');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx node --test test/ui-composer-chrome.test.mjs`
Expected: FAIL — `Expected values to be strictly equal: 'M15 6l-6 6 6 6' !== 'M9 6l6 6-6 6'`

- [ ] **Step 3: Write minimal implementation**

In `ui/public/index.html`, inside `#composer-inspector-toggle`, change only the `d` attribute:

```html
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" stroke-width="2.6" stroke-linecap="round"
                       stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"></path></svg>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx node --test test/ui-composer-chrome.test.mjs`
Expected: PASS, whole file green.

- [ ] **Step 5: Commit**

```bash
git add ui/public/index.html test/ui-composer-chrome.test.mjs
git commit -m "fix(composer): point the inspector handle the way the rail travels"
```

---

### Task 2: Keep the visible canvas height constant

The palette is `position:absolute` and covers the body row's top 240px, so opening it leaves ~398px of usable canvas. Move the fixed height off the card and onto the body row, and add 240px to it while the drawer is open: the uncovered band is then always 638px — the collapsed height exactly — and the card grows 685 → 925.

`.builder-card{…min-height:685px}` is **kept verbatim**: collapsed it still forces the body to exactly 638, and `test/ui-composer-chrome.test.mjs:405` asserts that literal.

**Files:**
- Modify: `ui/public/style.css:767` (the `.gv-body` rule)
- Test: `test/ui-composer-chrome.test.mjs` (append after the existing `style.css:` tests)

**Interfaces:**
- Consumes: nothing.
- Produces: `.gv-body` becomes the height authority for the body row. Task 3 adds `position:relative` and a `--ins-w` custom property to this same rule.

- [ ] **Step 1: Write the failing test**

Append to `test/ui-composer-chrome.test.mjs`:

```js
test('style.css: an open palette grows the card instead of eating the canvas', () => {
  // The panel is position:absolute and covers the body row's top 240px. For the
  // UNCOVERED band to equal the collapsed height, the row itself has to be 240
  // taller: 638 + 240 = 878, and 45 (bar + its border) + 878 + 2 card borders
  // = 925. The `~` selector is why index.html's drawer-before-body ordering is
  // load-bearing — the test above pins that ordering.
  assert.match(REAL_CSS, /\.gv-body\{[^}]*min-height:638px/,
    'the body row, not the card, owns the collapsed height');
  assert.match(REAL_CSS, /\.gv-drawer\[data-open="true"\]\s*~\s*\.gv-body\{[^}]*min-height:878px/,
    'and it grows by exactly the panel height while the drawer is open');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx node --test test/ui-composer-chrome.test.mjs`
Expected: FAIL on the first assertion — the shipped rule is `.gv-body{flex:1 1 auto;display:flex;min-height:0;}`.

- [ ] **Step 3: Write minimal implementation**

In `ui/public/style.css`, replace line 767 (`.gv-body{flex:1 1 auto;display:flex;min-height:0;}`) with:

```css
/* The row owns the height, not the card. min-height:0 is gone on purpose: that
   flag exists to let a flex child shrink below its content, and nothing in this
   row wants to — the canvas is overflow:hidden and the rail is absolutely
   positioned (see the inspector block below).
   638 is the collapsed canvas height the card's 685px was built around
   (685 - 2 card borders - 45 drawer). The open panel is absolute and covers the
   row's top 240px, so the row grows by 240 for the UNCOVERED band to stay 638:
   the card then measures 2 + 45 + 878 = 925. The canvas's TOP edge never moves
   in either state — only its bottom — so every pointer handler that reads
   rect.top/rect.left is unaffected, including during a light dismiss that
   collapses the drawer mid-pointerdown. */
.gv-body{flex:1 1 auto;display:flex;min-height:638px;}
.gv-drawer[data-open="true"] ~ .gv-body{min-height:878px;}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -30`
Expected: PASS apart from the 4 known `imagegen-skill` failures. In particular `style.css: the two rules the whole goal rests on` must still pass — `min-height:685px` on `.builder-card` was not touched.

- [ ] **Step 5: Fix the stale comment the change invalidates**

`ui/public/graph/composer-chrome.mjs:107` claims "Closing does not reflow (the panel is absolutely positioned), so the editor's own onPointerDown, running next on this same event, reads an unchanged rect." Closing now *does* reflow the row's height. Replace that sentence with:

```js
   *  disclosure decision — the same rule as a pill click. Closing now DOES
   *  reflow (the body row is 240px shorter with the drawer shut,
   *  style.css:767), but only its BOTTOM edge moves: the canvas still starts
   *  45px below the card top, so the editor's own onPointerDown, running next
   *  on this same event, reads an unchanged rect.left/rect.top and toWorld()
   *  stays accurate. */
```

- [ ] **Step 6: Commit**

```bash
git add ui/public/style.css ui/public/graph/composer-chrome.mjs test/ui-composer-chrome.test.mjs
git commit -m "feat(composer): keep the visible canvas height constant across the drawer"
```

---

### Task 3: Float the inspector and harden both seams

The rail leaves the flex row for `position:absolute` over the canvas's right edge. The canvas becomes full-width and stops reflowing when the rail collapses. Both seams go to 2px `var(--line-2)`, and the canvas decorations that would now sit *under* the rail get offset by a `--ins-w` custom property.

No markup changes: `#composer-ins-rail` stays a DOM sibling of `#composer-canvas` inside `#composer-body`, which is what `test/ui-composer-chrome.test.mjs:481` pins.

**Files:**
- Modify: `ui/public/style.css` — `.gv-body` (Task 2's rule), `.gv-empty` (:871), `.gv-zoom` (:881), `.gv-palette-scroll` (:803), `.gv-ins-rail` (:962), the collapsed rail rule (:982)
- Test: `test/ui-composer-chrome.test.mjs` (append)

**Interfaces:**
- Consumes: Task 2's `.gv-body` rule (this task adds `position:relative` and `--ins-w` to it).
- Produces: `--ins-w` — a custom property on `.gv-body`, `280px` open and `28px` collapsed, inherited by everything inside the canvas. Task 4 measures the same widths off the live element rather than reading this property.

- [ ] **Step 1: Write the failing test**

Append to `test/ui-composer-chrome.test.mjs`:

```js
test('style.css: the inspector floats over the canvas instead of shrinking it', () => {
  // position:absolute, not a flex item: the canvas keeps its full width and
  // collapsing the rail never reflows it. z-index 6 puts the rail over the
  // canvas decorations (.gv-empty/.gv-legend/.gv-zoom are 4) while staying under
  // the drawer (7), so the open palette still covers the rail's top 240px.
  assert.match(REAL_CSS, /\.gv-ins-rail\{[^}]*position:absolute/, 'the rail is out of flow');
  assert.match(REAL_CSS, /\.gv-ins-rail\{[^}]*right:0/, 'flush to the canvas right edge');
  assert.match(REAL_CSS, /\.gv-ins-rail\{[^}]*z-index:6/, 'over the canvas, under the drawer');
  assert.match(REAL_CSS, /\.gv-ins-rail\{[^}]*width:280px/, 'width, not flex-basis, now sizes it');
  assert.match(REAL_CSS, /\.gv-body\{[^}]*position:relative/,
    'the row is the containing block the rail resolves against');
  assert.match(REAL_CSS, /\.gv-body\[data-inspector="collapsed"\] \.gv-ins-rail\{width:28px;\}/,
    'the collapsed rule sizes by width too — flex-basis no longer applies');
});

test('style.css: both seams read as deliberate 2px edges', () => {
  assert.match(REAL_CSS, /\.gv-ins-rail\{[^}]*border-left:2px solid var\(--line-2\)/);
  assert.match(REAL_CSS, /\.gv-palette-scroll\{[^}]*border-bottom:2px solid var\(--line-2\)/);
});

test('style.css: the canvas decorations clear the floating rail', () => {
  // .gv-zoom is the control a lost user reaches for; at right:20px it would sit
  // BEHIND the rail now that the canvas runs the full width.
  assert.match(REAL_CSS, /\.gv-body\{[^}]*--ins-w:280px/);
  assert.match(REAL_CSS, /\.gv-body\[data-inspector="collapsed"\]\{--ins-w:28px;\}/);
  assert.match(REAL_CSS, /\.gv-zoom\{[^}]*right:calc\(var\(--ins-w\) \+ 20px\)/);
  assert.match(REAL_CSS, /\.gv-empty\{[^}]*left:calc\(50% - var\(--ins-w\) \/ 2\)/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx node --test test/ui-composer-chrome.test.mjs`
Expected: FAIL — all three new cases; the shipped rail is `position:relative;flex:0 0 280px`.

- [ ] **Step 3: Add the custom property and the containing block**

Replace Task 2's `.gv-body` rule with:

```css
.gv-body{position:relative;flex:1 1 auto;display:flex;min-height:638px;--ins-w:280px;}
.gv-drawer[data-open="true"] ~ .gv-body{min-height:878px;}
/* --ins-w is how much of the canvas's right edge the floating rail covers. It
   inherits into .gv-canvas, so the decorations inside it can offset themselves
   without any JS. */
.gv-body[data-inspector="collapsed"]{--ins-w:28px;}
```

- [ ] **Step 4: Float the rail**

Replace `.gv-ins-rail` (`style.css:962-963`) with:

```css
/* Absolute, not a flex item: the canvas keeps its FULL width and collapsing the
   rail never reflows it — which also means toWorld() is invariant across a
   collapse, not merely safe. `width` is what animates now; the old transition
   was on flex-basis, which no longer sizes anything.
   z-index 6 paints the rail over the wires and cards it now covers, and over
   the canvas decorations (.gv-empty/.gv-legend/.gv-zoom are 4). It ties with
   .gv-chip (6) and wins on source order, which is right: the rail is a
   persistent surface, the chip a transient cursor-follower. It stays under the
   drawer (7), so the open palette still covers the rail's top 240px, exactly as
   it did when the rail was in flow.
   display:flex / flex-direction:column / min-height:0 carry over VERBATIM —
   .gv-inspector below is written as a column-flex child of a column-flex
   parent, and dropping them would be a silent regression. */
.gv-ins-rail{position:absolute;top:0;right:0;bottom:0;width:280px;z-index:6;
  background:var(--panel);border-left:2px solid var(--line-2);box-shadow:var(--shadow);
  display:flex;flex-direction:column;min-height:0;transition:width var(--t-fast,120ms);}
```

Then replace the collapsed rule (`style.css:982`, `…{flex:0 0 28px;width:28px;}`) with:

```css
.gv-body[data-inspector="collapsed"] .gv-ins-rail{width:28px;}
```

Leave `.gv-inspector`, `.gv-ins-handle`, its hover/focus rules, the `left:2px` collapsed-handle rule and the `rotate(180deg)` rule untouched. The handle keeps its own `z-index:5`, now purely local ordering inside the rail's stacking context.

- [ ] **Step 5: Offset the decorations and deepen the palette seam**

In `.gv-empty` (`style.css:871`) change `left:50%` to `left:calc(50% - var(--ins-w) / 2)` — the pill stays centred in the *visible* band. Keep `transform:translateX(-50%)`.

In `.gv-zoom` (`style.css:881`) change `right:20px` to `right:calc(var(--ins-w) + 20px)`.

In `.gv-palette-scroll` (`style.css:803-805`) change `border-bottom:1px solid var(--line)` to `border-bottom:2px solid var(--line-2)` and `box-shadow:var(--shadow)` to the literal below — the stylesheet has no deeper token and one call site does not justify inventing one:

```css
  box-shadow:0 10px 32px rgba(25,25,27,.10);
```

Do **not** touch `.gv-drawer{border-bottom:1px solid var(--line)}` — the bar and the panel are one surface, not a seam.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -30`
Expected: PASS apart from the 4 known `imagegen-skill` failures.

- [ ] **Step 7: Commit**

```bash
git add ui/public/style.css test/ui-composer-chrome.test.mjs
git commit -m "feat(composer): float the inspector over the canvas and harden both seams"
```

---

### Task 4: Give the viewport maths a right inset

The canvas is now full-width, so `fit()` and pill-spawn can park a card under the floating rail. Mirror the existing `canvasInsetTop` mechanism end to end: measure in the chrome, consume in the editor, wire at **both** editor construction sites.

**Files:**
- Modify: `ui/public/graph/composer-chrome.mjs` (new `insRail` option + `canvasInsetRight()`)
- Modify: `ui/public/graph/composer-editor.mjs:95-110` (option), `:475-481` (`centerWorld`), `:534-549` (`fit`)
- Modify: `ui/public/app.js:1657-1692` (element + chrome option), `:1698-1713` and `:1749-1765` (both editor call sites)
- Test: `test/ui-composer-chrome.test.mjs`, `test/ui-composer-editor.test.mjs`, `test/ui-composer-chrome-app.test.mjs`

**Interfaces:**
- Consumes: `#composer-ins-rail`, and Task 3's floating rail (280px open / 28px collapsed).
- Produces:
  - `createComposerChrome({ insRail })` — optional Element; when absent `canvasInsetRight()` returns 0.
  - `chrome.canvasInsetRight(): number` — the rail's measured `getBoundingClientRect().width`, **not** gated on a disclosure flag: unlike the palette the rail is always present, and its collapsed 28px is a real inset.
  - `createComposerEditor({ canvasInsetRight })` — optional `() => number`, defaulting to `() => 0`, which reproduces the pre-inset arithmetic byte for byte.

- [ ] **Step 1: Write the failing chrome test**

In `test/ui-composer-chrome.test.mjs`, extend the harness so the rail is passed and measurable. Change the `boot()` signature and body:

```js
function boot({ storage = memStorage(), hasAgents = () => false, panelHeight = 240, railWidth = 280 } = {}) {
  const dom = new JSDOM(SHELL, { url: 'http://localhost:4317/' });
  const { window } = dom;
  const doc = window.document;
  const els = {
    drawer: doc.getElementById('drawer'),
    toggle: doc.getElementById('toggle'),
    panel: doc.getElementById('palette'),
    filter: doc.getElementById('filter'),
    canvas: doc.getElementById('canvas'),
    pill: doc.getElementById('pill'),
    body: doc.getElementById('body'),
    insToggle: doc.getElementById('ins-toggle'),
    inspector: doc.getElementById('inspector'),
    rail: doc.getElementById('rail'),
  };
  // jsdom answers zeros for every rect, so the panel's height is stubbed.
  els.panel.getBoundingClientRect = () => ({
    height: panelHeight, width: 1046, top: 44, left: 0, right: 1046, bottom: 44 + panelHeight,
  });
  // …and so is the floating rail's width.
  els.rail.getBoundingClientRect = () => ({
    width: railWidth, height: 638, top: 0, left: 1046 - railWidth, right: 1046, bottom: 638,
  });
  const chrome = createComposerChrome({
    drawer: els.drawer, toggle: els.toggle, panel: els.panel,
    canvas: els.canvas, filter: els.filter,
    body: els.body, insToggle: els.insToggle, insRail: els.rail, storage, hasAgents,
  });
  return { window, doc, els, chrome, storage };
}
```

Then append:

```js
test('canvasInsetRight() reports the floating rail width, collapsed or not', () => {
  // Deliberately NOT gated on data-inspector: the rail is always present, and
  // its collapsed 28px still covers the canvas's right edge. The number comes
  // off the live element, so the two states need no duplicated constants here.
  const { chrome } = boot({ railWidth: 280 });
  assert.equal(chrome.canvasInsetRight(), 280);

  const narrow = boot({ railWidth: 28 });
  assert.equal(narrow.chrome.canvasInsetRight(), 28);
});

test('canvasInsetRight() is 0 when no rail is wired', () => {
  // app.js passes null for a partial DOM, and every pre-inset test constructs
  // the chrome without one — 0 has to mean "the old arithmetic".
  const chrome = createComposerChrome({ storage: memStorage() });
  assert.equal(chrome.canvasInsetRight(), 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx node --test test/ui-composer-chrome.test.mjs`
Expected: FAIL — `chrome.canvasInsetRight is not a function`.

- [ ] **Step 3: Implement `canvasInsetRight()`**

In `ui/public/graph/composer-chrome.mjs`, add the JSDoc line next to `insToggle`:

```js
 * @param {Element}  [opts.insRail]  #composer-ins-rail — measured for the right inset
```

Add `insRail = null,` to the destructured options (next to `insToggle = null,`), and add the accessor to the returned object, next to `canvasInsetTop`:

```js
    /** The rail FLOATS over the canvas's right edge (style.css:962), so the
     *  canvas rect is wider than the visible band. No isOpen()-style guard:
     *  unlike the palette the rail is always present, and its collapsed 28px is
     *  a real inset. jsdom answers 0, which is the pre-inset arithmetic. */
    canvasInsetRight() {
      if (!insRail || !insRail.getBoundingClientRect) return 0;
      return insRail.getBoundingClientRect().width || 0;
    },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx node --test test/ui-composer-chrome.test.mjs`
Expected: PASS, whole file green.

- [ ] **Step 5: Write the failing editor tests**

In `test/ui-composer-editor.test.mjs`, add `NODE_W` to the geometry import:

```js
import { portAnchor, SNAP, NODE_W } from '../ui/public/graph/graph-geometry.mjs';
```

Add `canvasInsetRight` to `boot()`'s options and pass it through:

```js
function boot({ template = null, onSave = () => {}, agents = palette, canvasInsetTop, canvasInsetRight } = {}) {
```

```js
    canvasInsetTop,
    canvasInsetRight,
```

Then append, next to the existing overlay block:

```js
// --- the inspector floats over the canvas ------------------------------------
// The rail is position:absolute (style.css:962), so the canvas rect is WIDER
// than the visible band by the rail's width. Same shape of fix as the drawer's
// top inset, and the same jsdom caveat: every rect is stubbed.

test('a palette spawn clears the floating rail when canvasInsetRight reports one', () => {
  // Identity transform on a fresh canvas, so client coords are world coords.
  // centerWorld() subtracts NODE_W/2 = 110, then spawn() snaps to the 11px
  // half-grid. freeSlot() cannot perturb these: it only steps off nodes sitting
  // on the EXACT snapped slot, and newCanvas()'s Task (x:60) and End (x:960)
  // are unsnapped authored coordinates.
  const spawnX = (insetR) => {
    const ctx = boot({ canvasInsetRight: insetR });
    ctx.els.canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600,
    });
    return ctx.editor.spawn({ key: 'planner' }).x;
  };

  // inset 0   -> centre x 400, minus 110 -> snap(290) = 286
  assert.equal(spawnX(undefined), 286, 'the default is byte-for-byte the old behaviour');
  // inset 200 -> centre of the VISIBLE band is (800-200)/2 = 300 -> snap(190) = 187
  assert.equal(spawnX(() => 200), 187, 'the node lands left of the floating rail');
});

test('fit() fits into the band the floating rail leaves visible', () => {
  // Assertion-by-property, not by magic number: what matters is that the
  // rightmost card paints CLEAR of the rail, whatever the zoom works out to.
  const rect = { left: 0, top: 0, width: 800, height: 640, right: 800, bottom: 640 };
  const fitted = (insetR) => {
    const ctx = boot({ canvasInsetRight: insetR });
    ctx.els.canvas.getBoundingClientRect = () => rect;
    ctx.editor.fit();
    const t = ctx.editor.transform();
    const right = Math.max(...ctx.editor.template().nodes.map((n) => n.x + NODE_W));
    return { t, screenRight: right * t.zoom + t.x };
  };

  // A literal, NOT fitted(() => 0): both of those run the NEW code with inset 0,
  // so comparing them to each other could never fail. This is the number
  // today's fit() produces for a fresh Task+End canvas in an 800x640 rect.
  assert.deepEqual(fitted(undefined).t, { x: -0, y: -91, zoom: 0.65 },
    'no inset is byte-for-byte the pre-rail fit');
  assert.ok(fitted(() => 0).screenRight > 600,
    'guard: without the inset the graph really does run under a 200px rail');
  assert.ok(fitted(() => 200).screenRight <= 600,
    'with the inset the rightmost card clears it');
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx node --test test/ui-composer-editor.test.mjs`
Expected: FAIL — `spawnX(() => 200)` returns 286 (the option is ignored), and the `fit()` guard's `<= 600` assertion fails.

- [ ] **Step 7: Consume the inset in the editor**

In `ui/public/graph/composer-editor.mjs`, add the JSDoc line under the existing `canvasInsetTop` one (`:95`):

```js
 * @param {Function} [opts.canvasInsetRight] px of canvas hidden under the floating inspector rail
```

Add the option next to `canvasInsetTop = () => 0,` (`:110`):

```js
  canvasInsetRight = () => 0,
```

Replace `centerWorld()` (`:475-481`) with:

```js
  function centerWorld() {
    const r = canvas.getBoundingClientRect();
    const h = r.height || 0;
    const w = r.width || 0;
    const inset = Math.min(Math.max(canvasInsetTop() || 0, 0), h);
    const insetR = Math.min(Math.max(canvasInsetRight() || 0, 0), w);
    const c = toWorld(r.left + (w - insetR) / 2, r.top + inset + (h - inset) / 2);
    return { x: c.x - NODE_W / 2, y: c.y - 60 };
  }
```

In `fit()` (`:538-548`), replace the `vw` line and add the right inset:

```js
    const r = canvas.getBoundingClientRect();
    const insetR = Math.min(Math.max(canvasInsetRight() || 0, 0), r.width || 0);
    const vw = (r.width || 960) - insetR;
    const vh = r.height || 600;
```

Leave `setTransform({ x: -b.x * zoom, … })` alone: the visible band is LEFT-anchored at x 0, unlike the top band which starts *below* the panel and therefore keeps its `+ inset` on y.

- [ ] **Step 8: Run them to verify they pass**

Run: `npx node --test test/ui-composer-editor.test.mjs`
Expected: PASS, whole file green — including `a palette spawn clears the drawer overlay…` and the original `fit() fits into the band the drawer leaves visible`, whose `inset 0` literals must be unchanged.

- [ ] **Step 9: Write the failing app-wiring test**

`composerLoadTemplate()` destroys the editor and builds a fresh one on every "New canvas" and every saved-pipeline open, so a single-site wiring silently stops applying. Append to `test/ui-composer-chrome-app.test.mjs`:

```js
test('app.js hands canvasInsetRight to BOTH createComposerEditor call sites', () => {
  // Same trap as canvasInsetTop above, and equally invisible to a DOM
  // assertion: jsdom reports a zero-width rail, which clamps the inset to 0.
  const APP = readFileSync(appPath, 'utf8');
  const wired = APP.match(/canvasInsetRight: \(\) => \(composer\.chrome \? composer\.chrome\.canvasInsetRight\(\) : 0\)/g) || [];
  assert.equal(wired.length, 2, 'both sites, or the fix stops applying after a template load');
  assert.match(APP, /insRail: composer\.els\.insRail/, 'and the chrome can measure the rail');
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `npx node --test test/ui-composer-chrome-app.test.mjs`
Expected: FAIL — `Expected values to be strictly equal: 0 !== 2`.

- [ ] **Step 11: Wire app.js**

In `ui/public/app.js`, add the element lookup next to `composer.els.insTog` (`:1671`):

```js
  composer.els.insRail = $('#composer-ins-rail');
```

Add it to the `createComposerChrome({…})` call (`:1680-1691`), next to `insToggle`:

```js
      insRail: composer.els.insRail,
```

Add the accessor to **both** `createComposerEditor({…})` calls, directly under each existing `canvasInsetTop` line (`:1705` and `:1756`):

```js
      canvasInsetRight: () => (composer.chrome ? composer.chrome.canvasInsetRight() : 0),
```

Note the second call site is indented 4 spaces, not 6 — match the surrounding lines at each site.

- [ ] **Step 12: Run the whole suite**

Run: `npm test 2>&1 | tail -30`
Expected: PASS apart from the 4 known `imagegen-skill` failures.

- [ ] **Step 13: Commit**

```bash
git add ui/public/graph/composer-chrome.mjs ui/public/graph/composer-editor.mjs ui/public/app.js test/ui-composer-chrome.test.mjs test/ui-composer-editor.test.mjs test/ui-composer-chrome-app.test.mjs
git commit -m "feat(composer): keep spawn and fit clear of the floating inspector"
```

---

### Task 5: Verify the real layout in a browser

jsdom applies no stylesheet, so every CSS assertion above is source text. The numbers this change turns on — 638 visible in both drawer states, 925 open, the zoom cluster clearing the rail — are only observable in a real engine.

**Files:**
- Create: none (scratch script only, under the session scratchpad)
- Modify: none

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: a pass/fail report. No code.

- [ ] **Step 1: Serve the UI and drive headless Chrome**

Use the project's own UI server, open the composer view, and measure via CDP over a native WebSocket. Two gotchas established previously: use `Page.reload` rather than `Page.navigate` after the first load, and when scoping selectors, skip past the *second* `.gv-world` — the thumbnail renderer emits one too.

- [ ] **Step 2: Measure and compare**

Assert, with the drawer open and then collapsed:

| Measure | Expected |
|---|---|
| `.builder-card` height, drawer open | 925 |
| `.builder-card` height, drawer collapsed | 685 |
| `.gv-canvas` bottom − `.gv-palette-scroll` bottom, drawer open | 638 |
| `.gv-canvas` height, drawer collapsed | 638 |
| `.gv-canvas` width | unchanged by `data-inspector` |
| `.gv-zoom` right edge | ≤ `.gv-ins-rail` left edge, in both rail states |

- [ ] **Step 3: Eyeball the two seams**

Screenshot at 100% zoom with the palette open and a node selected. Both seams must read as deliberate edges, not as a value shift. If either still disappears, the fix is the border colour (`--line-2` → a darker token), never a gutter — gutters are excluded by E4.

- [ ] **Step 4: Report**

State each measured number against the table. If any differ, stop and report rather than adjusting the CSS to match the measurement — a mismatch means one of the geometry assumptions in the spec is wrong.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3.1 Card growth (E2) | Task 2 |
| §3.2 Floating inspector (E3, E4) | Task 3 |
| §3.3 Decorations under the rail | Task 3, steps 3 and 5 |
| §3.4 Palette seam (E4) | Task 3, step 5 |
| §3.5 Arrow inversion (E5) | Task 1 |
| §3.6 Right inset | Task 4 |
| §5 Test plan — CSS literals | Tasks 2, 3 |
| §5 Test plan — DOM | Task 1 |
| §5 Test plan — behavioural | Task 4 |
| §5 Test plan — manual browser | Task 5 |
| E6 drawer chevron untouched | No task, by design — stated as a constraint |

**Placeholder scan:** none. Every code step ships literal code; every test step ships the assertion; every run step names the command and the expected outcome.

**Type consistency:** `canvasInsetRight` is spelled identically in the chrome's return object, the editor's option, both `app.js` call sites and all three test files. `insRail` is the chrome option name in `composer-chrome.mjs`, `app.js` and the chrome test's `boot()`. `--ins-w` is declared on `.gv-body` in Task 3 step 3 and consumed in Task 3 step 5 only.
