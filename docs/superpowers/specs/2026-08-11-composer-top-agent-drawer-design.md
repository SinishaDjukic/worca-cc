# Composer Top Agent Drawer — Design Spec

Date: 2026-08-11
Status: Approved (design presented and approved in-session)
Scope: Pipeline Composer chrome only. The agent palette moves from a fixed 264px left rail to a full-width collapsible drawer at the top of the builder card, and the inspector rail gains a collapse handle. No change to the graph model, the execution engine, agent metadata, wiring legality, or validation.

> NEVER git-commit this file (untracked working artifact by project convention).

---

## 0. Problem and goals

The composer's builder card is a three-column flex row: palette rail (264px) · canvas (flex) · inspector rail (280px). On a 1440px viewport the main column is ~1078px wide (1440 − 298px sidebar − 64px `.main` padding), so the canvas gets **~532px**. A node card is `NODE_W = 220` (`graph-geometry.mjs:13`), which fits roughly two columns of nodes. Building anything past a three-node chain means constant panning.

Goal: give the canvas materially more horizontal room without losing at-a-glance agent browsing.

**Result: canvas 532px → ~796px with the drawer, → ~1048px with the inspector also collapsed.**

Non-goals: touching node geometry, zoom/pan behaviour, the save flow, or the saved-pipelines list.

---

## 1. Locked decisions

Decided in-session, do not re-litigate:

| # | Decision |
|---|---|
| D1 | Palette becomes a **collapsible drawer** at the top of `.builder-card`, spanning the full card width (above both canvas and inspector). |
| D2 | Expanded drawer shows a **wrapped grid grouped by domain** — existing group headings, pills wrapping across the width. Not lanes, not a compact no-port-line variant: the mono port line stays. |
| D3 | The expanded panel has a **fixed height with internal vertical scroll** (user instruction), not `max-height`, not content-sized. |
| D4 | Open panel **overlays** the canvas — the card body does not reflow when the drawer opens or closes. |
| D5 | Drawer state is **sticky**: default open while the graph has no agent nodes yet, collapsed once it does; any manual toggle persists to `localStorage` and wins from then on. Clicking a pill does **not** close it. |
| D6 | The **inspector rail also becomes collapsible**, by an explicit handle (not auto-hide on deselect — auto-hide reflows the canvas under the cursor on every select/deselect). |

---

## 2. Current structure (what is being replaced)

Markup, `ui/public/index.html:793-810`:

```html
<section class="card builder-card">
  <aside class="gv-palette">
    <div class="gv-palette-top"><input id="composer-agent-filter" class="pal-filter" …></div>
    <div id="composer-palette" class="gv-palette-scroll"></div>
  </aside>
  <div class="gv-canvas" id="composer-canvas"></div>
  <aside class="gv-inspector" id="composer-inspector"></aside>
</section>
```

Relevant facts established by reading the code:

- The palette is **click-to-spawn**, not drag-and-drop (`onPaletteClick` → `spawn()`, `composer-editor.mjs:701-713`). Moving it is a layout change; no drop-target or pointer-gesture rewiring.
- `renderPalette()` (`composer-editor.mjs:261-300`) builds, inside `#composer-palette`: one `.pal-chips` row of domain toggles, then one `<section class="pal-group">` per domain, each with a `.grp` heading and a `.pills` container of `.ap` buttons, with the Flow group last carrying `.pal-pinned`.
- The editor is constructed once, in `initComposer()` (`app.js:1655-1690`), from `#composer-*` ids.
- `Escape` is already bound by the editor's document-level `onKeyDown` to deselect (`composer-editor.mjs:686`), and `isTyping(ev.target)` makes it a no-op while the filter input has focus.
- There is no `ResizeObserver` on the canvas. The stage is `position:absolute;inset:0` and every pointer handler reads `getBoundingClientRect()` at event time, so widening the canvas needs no re-render — only `fit()` would recompute, and only if invoked.
- `.pal-chips` is declared **twice** in `style.css` — line 764 and line 1267 — and the later declaration wins.

---

## 3. Target DOM

```html
<section class="card builder-card">

  <!-- Full-width drawer: bar always in flow, panel overlays when open -->
  <div class="gv-drawer" id="composer-drawer" data-open="true">
    <div class="gv-drawer-bar">
      <button type="button" class="gv-drawer-toggle" id="composer-drawer-toggle"
              aria-expanded="true" aria-controls="composer-palette">
        <svg class="chev" …></svg>
        Agents
      </button>
      <input id="composer-agent-filter" class="pal-filter" type="search"
             placeholder="Filter agents…" aria-label="Filter agents by name or ports">
    </div>
    <div id="composer-palette" class="gv-palette-scroll"></div>
  </div>

  <!-- Canvas + inspector row -->
  <div class="gv-body" id="composer-body" data-inspector="open">
    <div class="gv-canvas" id="composer-canvas"></div>

    <!-- The handle is a SIBLING of the inspector host, never a child: see §4.5 -->
    <div class="gv-ins-rail" id="composer-ins-rail">
      <button type="button" class="gv-ins-handle" id="composer-inspector-toggle"
              aria-expanded="true" aria-controls="composer-inspector"
              aria-label="Collapse inspector"></button>
      <aside class="gv-inspector" id="composer-inspector"></aside>
    </div>
  </div>

</section>
```

`.gv-palette` and `.gv-palette-top` are deleted. The filter input keeps its `id`, moves into the bar.

### The compatibility invariant

`#composer-palette` keeps its id, keeps being the element passed as `opts.palette`, and keeps the exact `.pal-chips` / `.pal-group` / `.pills` / `.ap` subtree that `renderPalette()` already produces. Consequence: `renderPalette()`, `applyFilter()` and `onPaletteClick` are **not modified**, and these existing tests keep passing with no edits:

- `test/ui-composer-editor.test.mjs` (boots a synthetic shell of bare divs — layout-agnostic by construction)
- `test/ui-composer-wires.test.mjs`, `test/ui-composer-save.test.mjs`
- `test/ui-agent-xss.test.mjs:104` — queries `#composer-palette .ap[data-key="evil"]` against the real `index.html`
- `test/ui-boot.test.mjs`

The `#composer-inspector` element likewise keeps its id and stays the `opts.inspector` host; a collapse handle placed inside it would be an extra child that `renderInspector()`'s `replaceChildren` wipes on the next repaint — **so the handle lives in a wrapper alongside the inspector host, never inside it.** See §4.5.

---

## 4. CSS

All edits land in the `Pipeline Composer v2` block of `ui/public/style.css` (starts line 750). The block's header comment already warns that node geometry belongs to `graph-geometry.mjs`, not CSS — nothing here touches node or port sizing.

### 4.1 Card and body

```css
/* 44px bar is new chrome — grow the card so the canvas keeps its 640px. */
.builder-card{padding:0;overflow:hidden;display:flex;flex-direction:column;min-height:684px;}
.gv-body{flex:1 1 auto;display:flex;min-height:0;}
```

`.gv-canvas` (line 793) and `.gv-inspector` (line 878) keep their `flex` declarations verbatim — they are now children of `.gv-body` instead of `.builder-card`, and the row layout they were written for is preserved.

### 4.2 Drawer

```css
.gv-drawer{position:relative;z-index:5;border-bottom:1px solid var(--line);}
.gv-drawer-bar{height:44px;display:flex;align-items:center;gap:12px;padding:0 16px;}
.gv-drawer-toggle{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;
  color:var(--ink-2);background:none;border:0;padding:4px 6px;border-radius:9px;cursor:pointer;}
.gv-drawer-toggle:hover{background:var(--field);color:var(--ink);}
.gv-drawer-toggle .chev{width:14px;height:14px;transition:transform var(--t-fast,120ms);}
.gv-drawer[data-open="false"] .gv-drawer-toggle .chev{transform:rotate(-90deg);}
/* Line 761's `.gv-palette-top .pal-filter` is re-homed and re-sized; every other
   declaration (and the ::placeholder rule at 762) carries over verbatim. */
.gv-drawer-bar .pal-filter{flex:1 1 auto;max-width:320px;height:32px;border:none;
  border-radius:11px;background:var(--field);padding:0 12px;font-size:12.5px;
  font-weight:500;color:var(--ink);font-family:inherit;}
.gv-drawer-bar .pal-filter::placeholder{color:var(--ink-3);}

/* Overlay panel: fixed height, internal scroll (D3), no reflow (D4). */
.gv-palette-scroll{position:absolute;top:100%;left:0;right:0;height:240px;overflow-y:auto;
  padding:14px 16px 8px;background:var(--panel);border-bottom:1px solid var(--line);
  box-shadow:var(--shadow);}
.gv-drawer[data-open="false"] .gv-palette-scroll{display:none;}
```

`height`, not `max-height` — D3 asks for a fixed panel. With the 11 embedded agents plus the 5 pinned Flow pills the natural content is ~310px, so the panel scrolls from day one, and it stays exactly 240px however many custom agents a user registers.

### 4.3 Pills grid

```css
.pills{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:8px;}
```

Single-line change from `flex-direction:column`. `.ap` is already `width:100%`, so pills fill their grid cell unchanged. At 1078px card width minus 32px panel padding = 1046px usable: `minmax(196px,1fr)` with an 8px gap yields **5 columns** (5×196 + 4×8 = 1012 ≤ 1046; 6 would need 1216).

`.pal-group`, `.grp`, `.pal-pinned` (including its `margin:0 -16px` full-bleed treatment) and `.ap` are untouched.

### 4.4 Sticky domain chips

The chips row is `renderPalette()`'s first child inside the scroll container, so it would scroll away. Pin it:

```css
.gv-palette-scroll .pal-chips{position:sticky;top:-14px;z-index:1;
  background:var(--panel);padding-top:14px;margin-top:-14px;}
```

The negative `top`/`margin` cancel the container's `14px` top padding so the chips sit flush when pinned. This rule must be placed **after** line 1267 (the second `.pal-chips` declaration) or carry the shown descendant specificity — the duplicate declaration is a live footgun.

### 4.5 Inspector collapse

The handle cannot be a child of `#composer-inspector`: `renderInspector()` calls `inspectorHost.replaceChildren(...)` on every repaint and would delete it. Make the rail a wrapper instead:

```html
<div class="gv-ins-rail" id="composer-ins-rail">
  <button class="gv-ins-handle" id="composer-inspector-toggle" …></button>
  <aside class="gv-inspector" id="composer-inspector"></aside>
</div>
```

```css
.gv-ins-rail{position:relative;flex:0 0 280px;width:280px;border-left:1px solid var(--line);
  display:flex;flex-direction:column;min-height:0;transition:flex-basis var(--t-fast,120ms);}
.gv-inspector{flex:1 1 auto;min-height:0;overflow:auto;border-left:0;width:auto;}
.gv-ins-handle{position:absolute;top:10px;left:-1px;width:22px;height:30px;z-index:2;
  border:1px solid var(--line);border-left:0;border-radius:0 9px 9px 0;background:var(--panel);
  color:var(--ink-3);display:grid;place-items:center;cursor:pointer;}
.gv-ins-handle:hover{color:var(--ink);background:var(--field);}

.gv-body[data-inspector="collapsed"] .gv-ins-rail{flex:0 0 28px;width:28px;}
.gv-body[data-inspector="collapsed"] .gv-inspector{display:none;}
```

The `.gv-inspector` line-878 declaration is rewritten as shown — its `width`/`flex`/`border-left` move up to the wrapper. **`#composer-inspector` keeps its id and remains the `opts.inspector` host**, so the compatibility invariant of §3 holds.

Canvas width by state, at a 1078px card:

| drawer | inspector | canvas |
|---|---|---|
| — (today) | open | ~532px |
| any | open | ~796px |
| any | collapsed | ~1048px |

---

## 5. New module: `ui/public/graph/composer-chrome.mjs`

`composer-editor.mjs` is already ~800 lines and owns the graph: model, gestures, wiring legality, undo, save. Drawer and rail chrome is a separate concern with its own persisted state, so it gets its own module and its own test file.

```js
/**
 * Composer chrome: the top agent drawer and the inspector collapse handle.
 * Owns only disclosure state and its persistence — it never reads or writes
 * the graph template.
 *
 * @param {Element}  opts.drawer      #composer-drawer  (carries data-open)
 * @param {Element}  opts.toggle      #composer-drawer-toggle
 * @param {Element}  opts.panel       #composer-palette (measured for the canvas inset)
 * @param {Element}  opts.body        #composer-body    (carries data-inspector)
 * @param {Element}  opts.insToggle   #composer-inspector-toggle
 * @param {Storage}  [opts.storage]   defaults to globalThis.localStorage
 * @param {Function} [opts.hasAgents] () => boolean — the first-visit default only
 * @returns {{ canvasInsetTop(): number, syncDefault(): void, destroy(): void }}
 */
export function createComposerChrome({ … }) { … }
```

### 5.1 Persistence

Keys follow the `worca-cc.*` convention already used in `app.js` (`LAST_PROJECT_KEY = 'worca-cc.lastProject'`, `app.js:3532`):

```js
const DRAWER_KEY    = 'worca-cc.composer.drawer';     // 'open' | 'closed'
const INSPECTOR_KEY = 'worca-cc.composer.inspector';  // 'open' | 'collapsed'
```

Every read and write is wrapped in `try/catch` — the same private-mode guard as `app.js:3548`.

### 5.2 State rules (D5)

- **Drawer, no stored value:** open when `hasAgents()` is false, collapsed when true. Evaluated on construction and on `syncDefault()` (called by `app.js` after a template load), and only ever while the key is absent.

  **`hasAgents`, not `hasNodes`.** `newCanvas()` (`composer-editor.mjs:134-138`) preloads a Task and an End node, so a brand-new canvas already has `nodes.length === 2`. A node-count test would collapse the drawer on exactly the canvas D5 wants it open on. The predicate is `nodes.some((n) => n.kind === 'agent')` — "no agents picked yet" is the state that should show the agent browser.
- **Drawer, stored value present:** it wins, unconditionally, from then on.
- Any click on `#composer-drawer-toggle` flips `data-open`, mirrors it to `aria-expanded`, and writes the key.
- Clicking a pill does **not** close the drawer. Nothing in this module listens for pill clicks — stated so the property is deliberate, not accidental.
- **Inspector:** stored value, else `open`. Toggle flips `body[data-inspector]`, mirrors `aria-expanded`, updates the handle's `aria-label` (`Collapse inspector` / `Expand inspector`), and writes the key.

### 5.3 Scoped Escape

`Escape` is already the editor's deselect (`composer-editor.mjs:686`) on a document-level listener, so a second document-level binding would fire both. Instead the drawer element carries its own listener:

```js
drawer.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || drawer.dataset.open !== 'true') return;
  ev.stopPropagation();      // the editor's deselect must not also fire
  setDrawer(false);
  toggle.focus();            // focus must not be orphaned in a display:none subtree
});
```

Listening on the drawer means it only fires when focus is inside the drawer — including the filter input, where `Escape` currently does nothing at all (`isTyping` bails first). Focus is returned to the toggle before the panel is hidden.

### 5.4 `canvasInsetTop()`

Returns the height of the panel's overlap with the canvas: the panel's `getBoundingClientRect().height` when `data-open === 'true'`, else `0`. Used by §6.

---

## 6. Spawn placement fix

`centerWorld()` (`composer-editor.mjs:437-441`) centres a new node on the raw canvas rect. With the drawer overlaying the canvas's top 240px, `spawn()` from a pill can drop a node partly underneath the panel that was just clicked.

The editor takes one new optional dependency and centres on the **visible** region:

```js
// createComposerEditor opts, alongside `filter`:
//   @param {Function} [opts.canvasInsetTop]  px of canvas hidden under open chrome
canvasInsetTop = () => 0,

function centerWorld() {
  const r = canvas.getBoundingClientRect();
  const inset = Math.min(canvasInsetTop() || 0, r.height || 0);
  const c = toWorld(r.left + (r.width || 0) / 2, r.top + inset + ((r.height || 0) - inset) / 2);
  return { x: c.x - NODE_W / 2, y: c.y - 60 };
}
```

Default `() => 0` reproduces today's arithmetic exactly. jsdom reports zeroed rects, so every existing spawn-position assertion is unaffected either way.

---

## 7. Wiring in `app.js`

In `initComposer()` (`app.js:1655`), alongside the existing `composer.els.*` lookups:

```js
composer.els.drawer      = $('#composer-drawer');
composer.els.drawerTog   = $('#composer-drawer-toggle');
composer.els.body        = $('#composer-body');
composer.els.insTog      = $('#composer-inspector-toggle');
```

Inside the `if (!_composerReady)` block, **before** `createComposerEditor(...)` — the editor needs `canvasInsetTop` at construction:

```js
composer.chrome = createComposerChrome({
  drawer: composer.els.drawer,
  toggle: composer.els.drawerTog,
  panel: composer.els.palette,
  body: composer.els.body,
  insToggle: composer.els.insTog,
  hasAgents: () => Boolean(composer.editor?.template?.()?.nodes?.some((n) => n.kind === 'agent')),
});
```

`composer.editor.template()` is a real accessor on the editor's public object (`composer-editor.mjs:763`). `hasAgents` is a late-bound closure, so it is safe to read `composer.editor` before it is assigned — it is only invoked on the first-visit default path.

### 7.1 Both editor call sites

`createComposerEditor` is called in **two** places, and `canvasInsetTop` must be added to both:

- `initComposer()`, `app.js:1671` — the first construction.
- `composerLoadTemplate()`, `app.js:1720` — which calls `composer.editor.destroy()` and constructs a **fresh** editor on every `New canvas` and every saved-pipeline open. Miss this one and the spawn fix silently stops applying the moment the user loads a template.

```js
// added to the opts object at BOTH sites
canvasInsetTop: () => (composer.chrome ? composer.chrome.canvasInsetTop() : 0),
```

The chrome itself is constructed once and is never destroyed by `composerLoadTemplate` — it owns no graph state, so it survives editor swaps untouched.

### 7.2 First-visit default after a load

At the end of `composerLoadTemplate()`, next to the existing `composerPaintDirty()`:

```js
composer.chrome?.syncDefault();
```

So on a first visit (no stored key) opening a saved pipeline lands collapsed while `New canvas` lands open. Once the key exists, `syncDefault()` is a no-op. Guarded with `?.` because `initComposer` returns early when `#composer-canvas` is absent (partial DOM in tests) and leaves `composer.chrome` undefined.

---

## 8. Tests

### 8.1 New — `test/ui-composer-chrome.test.mjs`

jsdom, driving `composer-chrome.mjs` directly against a small fixture shell plus a stub `Storage`:

1. No stored value, `hasAgents() === false` → `data-open="true"`, `aria-expanded="true"`.
2. No stored value, `hasAgents() === true` → `data-open="false"`.
3. Stored `'closed'` beats an agent-free canvas; stored `'open'` beats a populated one.
3b. A fresh `newCanvas()` template (Task + End, no agents) defaults to **open** — the regression guard for the preloaded-nodes trap.
4. Clicking the toggle flips `data-open`, mirrors `aria-expanded`, and writes `worca-cc.composer.drawer`.
5. `Escape` dispatched from inside the drawer collapses it, calls `stopPropagation` (asserted via a document-level spy that must **not** fire), and moves focus to the toggle.
6. `Escape` dispatched from the canvas leaves the drawer open and does **not** stop propagation.
7. A `.ap` click inside the panel leaves `data-open="true"`.
8. Inspector toggle flips `body[data-inspector]`, updates `aria-label`, writes `worca-cc.composer.inspector`, and restores from the key on re-construction.
9. `canvasInsetTop()` returns the panel height when open and `0` when closed (panel height stubbed via `getBoundingClientRect`).
10. A throwing `Storage` (private mode) degrades to defaults instead of raising.

### 8.2 New — markup assertions on the real `index.html`

Same `readFileSync` + `JSDOM` pattern as `test/projects-ui.test.mjs`:

- `.gv-palette` and `.gv-palette-top` are gone from the file.
- `#composer-palette` is a descendant of `#composer-drawer`.
- `#composer-agent-filter` is inside `.gv-drawer-bar`.
- `#composer-canvas` and `#composer-ins-rail` are siblings inside `#composer-body`.
- `#composer-inspector` still exists, inside `#composer-ins-rail`.
- `#composer-drawer-toggle` carries `aria-controls="composer-palette"`.

### 8.3 Extended — `test/ui-composer-editor.test.mjs`

One case: with `canvasInsetTop: () => 100` and a stubbed 600px-tall canvas rect, a spawned node's `y` sits below what `() => 0` yields. Requires stubbing `getBoundingClientRect` since jsdom zeroes it.

### 8.4 Must keep passing unmodified

`ui-composer-editor`, `ui-composer-wires`, `ui-composer-save`, `ui-agent-xss`, `ui-boot`. Any edit needed in these beyond §8.3's addition means the compatibility invariant of §3 was broken — fix the markup, not the test.

Baseline: `npm test` is judged modulo the 4 known pre-existing imagegen-skill failures.

---

## 9. Files touched

| File | Change |
|---|---|
| `ui/public/index.html` | `.builder-card` subtree restructured (§3) |
| `ui/public/style.css` | composer block lines ~756-880 rewritten (§4); sticky-chips rule after line 1267 |
| `ui/public/graph/composer-chrome.mjs` | **new**, ~120 lines (§5) |
| `ui/public/graph/composer-editor.mjs` | `canvasInsetTop` opt + `centerWorld()` (§6). Nothing else. |
| `ui/public/app.js` | `initComposer()` element lookups + chrome construction; `canvasInsetTop` on **both** `createComposerEditor` sites (1671, 1720); `composerLoadTemplate()` `syncDefault()` call (§7) |
| `test/ui-composer-chrome.test.mjs` | **new** (§8.1, §8.2) |
| `test/ui-composer-editor.test.mjs` | one added case (§8.3) |

Untouched: `graph-model.mjs`, `graph-geometry.mjs`, `graph-layout.mjs`, `graph-view.mjs`, `inspector.mjs`, `agents-meta.mjs`, `run-decor.mjs`, `thumbnail.mjs`, `save-dialog.mjs`, and every server-side module.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| `renderInspector()`'s `replaceChildren` eating the collapse handle | Handle lives in the `.gv-ins-rail` wrapper, never inside `#composer-inspector` (§4.5) |
| A second document-level `Escape` racing the editor's deselect | Drawer-scoped listener + `stopPropagation()` (§5.3) |
| Node spawned under the open overlay | `canvasInsetTop()` (§6) |
| The duplicate `.pal-chips` declaration silently overriding the sticky rule | Rule placed after line 1267, descendant-scoped (§4.4) |
| Canvas widening without a re-render | Non-issue: the stage is `inset:0` and every gesture reads `getBoundingClientRect()` at event time; verified there is no `ResizeObserver` in the composer path |
| Focus stranded in a `display:none` panel on collapse | `toggle.focus()` before the state flip (§5.3) |
| `composerLoadTemplate()` rebuilding the editor and dropping `canvasInsetTop` | Both call sites listed explicitly (§7.1) |
| `newCanvas()`'s preloaded Task + End making a blank canvas look "populated" | Default keys off `hasAgents()`, not node count (§5.2), with a dedicated regression test (§8.1 case 3b) |

## 11. Deliberately excluded

- Auto-hiding the inspector on deselect — reflows the canvas under the cursor on every click.
- Drag-and-drop from pill to canvas — the palette is click-to-spawn today and stays so.
- A viewport-driven card height (`calc(100vh - …)`) — the fixed 684px is enough to reach the goal; revisit only if asked.
- Moving the domain chips out of `#composer-palette` into the bar — it would force a `renderPalette()` change for no gain, since the chips are meaningless while the panel is collapsed.
