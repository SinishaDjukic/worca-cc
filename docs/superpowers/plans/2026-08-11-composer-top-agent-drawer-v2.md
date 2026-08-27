# Composer Top Agent Drawer — Implementation Plan v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Pipeline Composer's agent palette from a fixed 264px left rail to a collapsible full-width drawer at the top of the builder card, and make the inspector rail collapsible — taking the canvas from ~532px to ~796px, or ~1048px with the inspector closed.

**Architecture:** A new `composer-chrome.mjs` module owns drawer and inspector disclosure state plus its `localStorage` persistence, and nothing else — it never touches the graph template, so it survives the editor teardown/rebuild that `composerLoadTemplate()` performs. `composer-editor.mjs` learns one new optional dependency, `canvasInsetTop`, and applies it in the three places that assume the whole canvas is visible (`centerWorld`, `fit`) or that the palette is a tall rail (`renderPalette`'s scroll position); it also gains a spawn-slot cascade, because the drawer turns "add several agents in a row" into the primary gesture. `#composer-palette` and `#composer-inspector` keep their ids and their exact rendered subtrees, so `renderPalette()`'s **output**, `applyFilter()`, `onPaletteClick` and `renderInspector()` are unchanged and every existing composer test passes untouched.

**Tech Stack:** Vanilla ES modules, no framework, no build step. `ui/public/index.html` + `ui/public/style.css` + `ui/public/graph/*.mjs`. Tests are `node:test` + `assert/strict` + `jsdom`, run with `npm test`.

**Design spec:** `docs/superpowers/specs/2026-08-11-composer-top-agent-drawer-design.md`

---

## What changed from v1, and why

v1 was fact-checked line by line, executed end-to-end on a scratch copy of the repo, and adversarially reviewed. Its predictions all held — `snap(240) = 242`, `snap(340) = 341`, 11/11, and the four known suite failures — but four classes of defect were found. Every correction below is already folded into the tasks; this section exists so a reader who saw v1 knows what moved.

**Shipped-broken behaviour (found by review, not by v1's own tests — v1 had no coverage for any of it):**

| # | Defect | Fix, and where |
|---|---|---|
| B1 | `syncDefault()` never ran against a real editor. `composerLoadTemplate()` has exactly two callers (`app.js:1687`, `app.js:1807`), both bound *inside* the `if (!_composerReady)` block, so it is never on the initial-entry path; and the factory calls `syncDefault()` in its own body, before `composer.editor` exists. The first-visit default was right **by accident**. | Task 3 Step 5 rewires `initComposer()` |
| B2 | The canvas empty-state banner is `position:absolute;top:24px;z-index:4` (`style.css:799`) and the drawer is `z-index:5`, so the onboarding copy is invisible on 100% of first visits — exactly the agent-free canvas D5 opens the drawer on. | Task 3 Step 4 (`z-index:7` + a `top:264px` rule) |
| B3 | The open panel makes the canvas's top 240px unable to **start** a gesture (`pointerdown` is bound on `.gv-canvas`, `composer-editor.mjs:745`; the panel is a sibling subtree), and Escape cannot reach the drawer after a mouse pill click because `renderPalette()`'s `replaceChildren` (`:298`) destroys the clicked button and focus falls to `<body>`. | Task 1: canvas light dismiss |
| B4 | `fit()` (`composer-editor.mjs:494`) parks the graph at the raw canvas origin, so the zoom-fit button — bottom-right, therefore clickable while the drawer is open — hides the top of the user's own graph. | Task 2 Step 5 |
| B5 | `centerWorld()` is a pure function of the rect and the transform and `spawn()` changes neither, so every pill click lands on the identical pixel. `hitTest` walks topmost-first (`:351`), so buried cards are unreachable. This is pre-existing, but the drawer makes multi-add the primary gesture. | Task 2 Step 6 |
| B6 | `renderPalette()` calls `replaceChildren` on `#composer-palette`, which **is** the 240px scroll container now — `scrollHeight` collapses, `scrollTop` clamps to 0, and the pinned Flow group bounces out of reach after every spawn. | Task 2 Step 7 |
| B7 | The filter is `input[type="search"]`; Blink and WebKit clear a non-empty search field on Escape natively. v1's binding made one keypress both clear the query **and** hide the result. | Task 1: two-stage Escape |
| B8 | `.gv-ins-handle{left:-1px;width:22px}` occupies border-box `x 0..22`, and `.ins-head`'s 18px inset plus the rail's 1px border puts the inspector title at `x=19` — the handle covers the first 3px of every selected node's name. | Task 4 Step 5 |
| B9 | Found late, in v2's own draft, by both verification passes: `input[type=search]` also fires `input` with an **empty** value when Blink and WebKit clear it themselves. With a naive `if (!isOpen()) setDrawer(true)`, Escape aimed at a *collapsed* drawer's non-empty filter would **open** it — a disclosure control running backwards. Reachable in three plan-sanctioned steps: type (auto-opens) → click the canvas (light dismiss; the text survives) → Escape. jsdom has no native search-clear, so no DOM test could have found it. | Task 1: the `filter.value` guard in `onFilterInput` |

**CSS correctness:**

- `min-height` is **685px**, not 684. `.gv-canvas` declares no height anywhere in the stylesheet — its 640px comes purely from `align-items:stretch`, and `.gv-drawer`'s own `border-bottom` is additive to the 44px bar because the drawer's height is `auto` (`*{box-sizing:border-box}` at `style.css:43` only governs *specified* heights). This deliberately corrects spec §4.1.
- `.gv-inspector` keeps `display:flex;flex-direction:column` — `.ins-panel` (`style.css:879`) is written as a column-flex child of a column-flex parent. v1 dropped both silently.
- `.gv-ins-rail` keeps the spec's `transition:flex-basis`. v1 dropped it. (It was argued that a mid-transition `getBoundingClientRect()` would skew pointer→world math; it does not — the canvas is left-anchored, so `r.left` is invariant under a right-edge resize and `toWorld` is accurate at every instant. The reduced-motion block at `style.css:655-658` already neutralises the animation for users who ask.)
- The sticky-chips rule moves **into** the drawer block. v1's "append after line 1267" would land it inside the Projects-view block, because v1's own three earlier edits shift the file by +19 lines before the implementer gets there. `.gv-palette-scroll .pal-chips` is specificity (0,2,0) against both bare `.pal-chips` declarations' (0,1,0), so it wins wherever it sits — the "must come after line 1267" reasoning was never load-bearing.

**Test integrity:**

- v1's throwing-`Storage` case could not fail. jsdom reports listener exceptions as a window `error` event instead of rethrowing out of `dispatchEvent`, so `assert.doesNotThrow(() => click(...))` is vacuous — verified: 11/11 green even with the write guard deleted. Task 1 counts reported errors instead (verified: 22/22 with the guard, 21/22 without).
- Two cases asserted only what the fixture already seeded. The `SHELL` now seeds the **opposite** state, so the defaults are real assertions.
- Task 4's stated red was wrong: a missing named export is a **link-time `SyntaxError`** that aborts the whole file, not `undefined`. Corrected, with a two-phase re-run so the six new cases can be seen failing on their own assertions.
- A new app-level integration test (`test/ui-composer-chrome-app.test.mjs`) pins the wiring — v1 had nothing proving `createComposerChrome` was ever called.
- **Every assertion in this plan was audited for vacuity by mutation**: each snippet was broken deliberately, one change at a time, and any case that stayed green was rewritten. Eight did, in v2's own first draft — including the one meant to pin B1, the plan's headline fix, which passed even with `syncDefault()` deleted from `initComposer()` for exactly the accidental reason B1 describes. The surviving fixes are the two source-text assertions (B1's re-entry case and the `canvasInsetTop` call-site count), the opposite-seeded `SHELL`, the `panelHeight: 173` stub, the both-directions inspector case, and the `defaultPrevented` assertions.

**Stale anchors corrected:** `filter = null,` is at `composer-editor.mjs:108` (not 101) · `template()` is at `:764` (not 763) · `onPaletteClick` is `:701-712` · `boot()` is `test/ui-composer-editor.test.mjs:38` (not 37) · `initComposer()` is declared at `app.js:1654` (not 1655) · the `Pipeline Composer v2` banner opens at `style.css:749` · the palette-rail CSS replacement starts at **758**, not 759, so the stale section comment goes with it.

---

## Global Constraints

- **Never `git commit` the spec or this plan.** `docs/` is untracked by project convention. Commit only source and test files.
- **Test baseline — verified by a full run on a clean copy: `npm test` is `2482 tests / 2478 pass / 4 fail`.** The four are `test/skills-bundle.test.mjs:10`, `:19` and `test/skills-gate-wiring.test.mjs:136`, `:190`; all four trace to `skills/imagegen/SKILL.md` being absent from the repo. A run is green if and only if those four are the only failures. Never "fix" them as part of this work.
- **Apply each task's CSS edits BOTTOM-UP.** Task 3 edits `775` → `758-763` → `756` → `750`, **in that order**; Task 4 then edits the old line `878`, which Task 3's insertions have already pushed down by ~76 lines. Every replacement in this plan is longer than what it replaces, so applying them top-down invalidates each later line number — and Task 4's number is stale before it is ever reached. Each edit below quotes the **verbatim current text** of its target; if the line at the stated number is not that text, stop and re-locate by text.
- **The same applies to `app.js`.** Adding the import at line 71 shifts `1654 / 1671 / 1717 / 1720` by +1, and Task 3's insertions push the two `createComposerEditor(` sites down by roughly 22 more. Every `app.js` instruction here is anchored to quoted text, not to a number; use the numbers only to find the right neighbourhood.
- **The compatibility invariant:** `#composer-palette` keeps its id, keeps being the element passed as the editor's `opts.palette`, and keeps the exact `.pal-chips` / `.pal-group` / `.pills` / `.ap` subtree that `renderPalette()` produces. `#composer-inspector` keeps its id and stays `opts.inspector`. The invariant is about the **rendered subtree**, not about the file being untouched: Task 2 does edit `renderPalette()`, but only to save and restore `paletteHost.scrollTop` around the existing `replaceChildren` — the markup it emits is byte-identical. These tests must pass **with no edits**: `test/ui-composer-wires.test.mjs`, `test/ui-composer-save.test.mjs`, `test/ui-agent-xss.test.mjs`, `test/ui-boot.test.mjs`, and every pre-existing case in `test/ui-composer-editor.test.mjs`. If one of them needs changing, the markup is wrong — fix the markup, not the test.
- **Do not touch:** `graph-model.mjs`, `graph-geometry.mjs`, `graph-layout.mjs`, `graph-view.mjs`, `inspector.mjs`, `agents-meta.mjs`, `run-decor.mjs`, `thumbnail.mjs`, `save-dialog.mjs`, or any server-side module. Node and port sizing lives in `graph-geometry.mjs`; changing a size in CSS would desync wiring from pixels.
- **`localStorage` keys** follow the existing `worca-cc.*` convention (`LAST_PROJECT_KEY`, `app.js:3532`): `worca-cc.composer.drawer` (`'open' | 'closed'`) and `worca-cc.composer.inspector` (`'open' | 'collapsed'`). Every read and write is wrapped in `try/catch` — private browsing mode throws, exactly as guarded at `app.js:3548`.
- **CSS custom properties** already defined by the stylesheet and used below: `--line`, `--line-2`, `--ink`, `--ink-2`, `--ink-3`, `--field`, `--panel`, `--shadow`, `--shadow-soft`, `--t-fast`. Do not invent new ones.
- **There is no global `button {}` reset in this stylesheet.** Most button rules declare `font-family:inherit` for themselves (`.btn-stop` 231, `.seg button` 346, `.topnav button` 694, `.run-flow .xtoggle` 1081, …) — but not all: `.ap` (776), `.pal-chip` (765/1268) and `.gv-zoom button` (811) omit it, see "Deliberately excluded". The new controls declare it. Likewise `:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}` is the house keyboard-focus idiom. The new controls follow both. `input[type="search"]` is **not** matched by the generic control rules at `style.css:278-299`, so the filter's focus ring has to be declared explicitly.
- Run the full suite (`npm test`) before every commit, not just the file you touched.

---

## File Structure

| File | Responsibility |
|---|---|
| `ui/public/graph/composer-chrome.mjs` | **New.** Drawer + inspector disclosure state, persistence, scoped two-stage Escape, canvas light dismiss, filter auto-open, `canvasInsetTop()`. Owns no graph state. |
| `test/ui-composer-chrome.test.mjs` | **New.** Unit tests for the above, plus markup and stylesheet assertions against the real `index.html` / `style.css`. |
| `test/ui-composer-chrome-app.test.mjs` | **New.** Real `index.html` + real `app.js` in jsdom: proves the chrome is actually wired, re-syncs after a template load, and is constructed exactly once. |
| `ui/public/graph/composer-editor.mjs` | `canvasInsetTop` opt; `centerWorld()`; `fit()`; a spawn-slot cascade; `renderPalette()` scroll preservation. Nothing else. |
| `ui/public/index.html` | `.builder-card` subtree restructured from a 3-column row to drawer-over-body. |
| `ui/public/style.css` | The `Pipeline Composer v2` block (banner at 749) — rail rules replaced by drawer rules; inspector collapse rules. |
| `ui/public/app.js` | `initComposer()` element lookups, chrome construction and `syncDefault()`; `canvasInsetTop` at both `createComposerEditor` call sites; `syncDefault()` in `composerLoadTemplate()`. |
| `test/ui-composer-editor.test.mjs` | Three added cases plus one `boot()` option (Task 2). Nothing else. |

**Task order and why:** Task 1 builds the chrome module in isolation (nothing wired, nothing visible). Task 2 teaches the editor about an inset, with a no-op default, plus the two spawn-ergonomics fixes the drawer makes load-bearing. Task 3 restructures the markup, ships the drawer CSS and wires it — at the end of Task 3 the drawer works end to end. Task 4 does the same vertical slice for the inspector. Tasks 3 and 4 each leave the app in a working, shippable state.

---

## Task 1: The chrome module — drawer half

Builds `composer-chrome.mjs` with the drawer's state machine, persistence, two-stage Escape, canvas light dismiss, filter auto-open and `canvasInsetTop()`. Nothing in the app calls it yet; this task's deliverable is a tested module.

**Files:**
- Create: `ui/public/graph/composer-chrome.mjs`
- Test: `test/ui-composer-chrome.test.mjs` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const DRAWER_KEY = 'worca-cc.composer.drawer'`
  - `export function createComposerChrome({ drawer, toggle, panel, canvas, filter, storage, hasAgents }) → { canvasInsetTop(): number, syncDefault(): void, destroy(): void }`
  - No `doc` param: the module only ever touches elements it is handed, and never creates one. Where it needs a `Document` or a `Window` (for `activeElement` and for constructing the synthetic `input` event) it reads `drawer.ownerDocument`.
  - Task 3 calls `createComposerChrome` from `app.js`; Task 3 and Task 4 rely on the returned `canvasInsetTop` / `syncDefault` names. `destroy()` is exported and tested for symmetry only — nothing in `app.js` calls it, because the chrome is constructed once and never torn down.
  - Task 4 extends the same factory with `body` and `insToggle` params and an `INSPECTOR_KEY` export.

**Behaviour decided for this task (do not re-litigate):**

1. **Two-stage Escape.** The filter is `type="search"`, which Blink and WebKit clear on Escape natively. A single keypress must not both clear the query and hide the panel showing the result. Stage 1: a non-empty filter clears (with `preventDefault()` so the UA's own clear cannot double-fire, and a synthetic bubbling `input` event so the editor's `applyFilter()` re-runs), and the drawer stays open. Stage 2: collapse, and **persist** — Escape is a deliberate manual toggle, so D5's "any manual toggle persists and wins from then on" applies. This deliberately diverges from the spec §5.3 snippet, which does not persist.
2. **Focus is rescued only when it is about to be orphaned** — i.e. only when `document.activeElement` is inside the panel. The bar, and therefore the filter, stays visible when the drawer is collapsed; yanking focus out of a visible input is user-hostile and unnecessary. (v1 rescued unconditionally.)
3. **A `pointerdown` on the canvas collapses the drawer, without persisting.** The editor binds `pointerdown` on `.gv-canvas` only (`composer-editor.mjs:745`) and the panel is a sibling subtree, so while the drawer is open the canvas's top 240px cannot *start* a gesture. A canvas press is a statement about the graph, not a disclosure decision — the same reasoning the spec already applies to pill clicks, which stay exempt because they land inside the drawer, not on the canvas. Closing does not reflow (D4), so the editor's own `onPointerDown`, which runs immediately after on the same event, reads an unchanged rect.
4. **Typing in the filter opens a collapsed drawer, without persisting.** The bar is always visible, so a collapsed drawer would otherwise filter a list nobody can see.
5. **Escape uses `stopPropagation`, not `stopImmediatePropagation`.** The editor's deselect is a document-level bubble-phase listener (`doc.addEventListener('keydown', onKeyDown)`, `composer-editor.mjs:749`, no capture flag), so `stopPropagation` at the drawer suppresses it. Note that it also silences the six other permanent document-level Escape handlers in `app.js` (`:3850`, `:4452`, `:5413`, `:5909`, `:6530`, `:8176`) plus `confirmModal`'s transient one (`:5297`) — none of which can be open over the composer.
6. **The handler bails before `stopPropagation()` when the drawer is already collapsed.** The bar stays visible, so Escape can still be aimed at the drawer subtree while nothing is disclosed; swallowing the event there would cost the editor its deselect for as long as the drawer is shut.

---

- [ ] **Step 1: Write the failing test file**

Create `test/ui-composer-chrome.test.mjs`:

```js
// test/ui-composer-chrome.test.mjs
// Composer chrome: the top agent drawer's disclosure state and its persistence.
//
// The module owns NO graph state — it never reads or writes a template — so it
// survives the editor teardown/rebuild that composerLoadTemplate() performs.
// The `hasAgents` predicate is deliberately NOT a node count: newCanvas()
// (composer-editor.mjs:134) preloads a Task and an End node, so a node-count
// default would collapse the drawer on exactly the blank canvas it is supposed
// to open on.
//
// The SHELL below seeds the OPPOSITE of every default on purpose. If it shipped
// data-open="true", the "an agent-free canvas opens the drawer" case would pass
// against an empty syncDefault() and prove nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createComposerChrome, DRAWER_KEY } from '../ui/public/graph/composer-chrome.mjs';

const SHELL = `<!doctype html><body>
  <section class="card builder-card">
    <div class="gv-drawer" id="drawer" data-open="false">
      <div class="gv-drawer-bar">
        <button id="toggle" type="button" aria-expanded="false" aria-controls="palette">Agents</button>
        <input id="filter" type="search">
      </div>
      <div id="palette" class="gv-palette-scroll">
        <button id="pill" class="ap" type="button" data-key="planner">Plan</button>
      </div>
    </div>
    <div class="gv-body" id="body" data-inspector="open">
      <div id="canvas" class="gv-canvas"></div>
    </div>
  </section>
</body>`;

/** An in-memory Storage stand-in. jsdom ships localStorage, but an explicit
 *  stub keeps each test's persisted state isolated and inspectable. */
function memStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    read: (k) => (map.has(k) ? map.get(k) : null),
  };
}

function boot({ storage = memStorage(), hasAgents = () => false, panelHeight = 240 } = {}) {
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
  };
  // jsdom answers zeros for every rect, so the panel's height is stubbed.
  els.panel.getBoundingClientRect = () => ({
    height: panelHeight, width: 1046, top: 44, left: 0, right: 1046, bottom: 44 + panelHeight,
  });
  const chrome = createComposerChrome({
    drawer: els.drawer, toggle: els.toggle, panel: els.panel,
    canvas: els.canvas, filter: els.filter, storage, hasAgents,
  });
  return { window, doc, els, chrome, storage };
}

const click = (window, el) =>
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
// Returns the event so a case can assert defaultPrevented — cancelable:true is
// what makes preventDefault() observable, and stage 1 relies on it to defeat the
// UA's own input[type=search] clear.
const esc = (window, el) => {
  const ev = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
};
// `new window.PointerEvent(...)` IS constructible under jsdom — the editor's own
// suite relies on it (test/ui-composer-editor.test.mjs:15).
const down = (window, el) =>
  el.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));

const isOpen = (els) => els.drawer.dataset.open === 'true';

test('with nothing stored, an agent-free canvas opens the drawer', () => {
  const { els } = boot({ hasAgents: () => false });
  assert.equal(isOpen(els), true);
  assert.equal(els.toggle.getAttribute('aria-expanded'), 'true');
});

test('with nothing stored, a canvas that already has agents collapses it', () => {
  const { els } = boot({ hasAgents: () => true });
  assert.equal(isOpen(els), false);
  assert.equal(els.toggle.getAttribute('aria-expanded'), 'false');
});

test("a fresh newCanvas() shape — Task + End, no agents — still opens", () => {
  // newCanvas() (composer-editor.mjs:134) preloads two nodes. A node-COUNT
  // default would read that as "populated" and wrongly collapse. The real kind
  // set is {agent, task, end, and, or, combine} (graph-model.mjs:441).
  const nodes = [{ id: 'n_task', kind: 'task' }, { id: 'n_end', kind: 'end' }];
  const { els } = boot({ hasAgents: () => nodes.some((n) => n.kind === 'agent') });
  assert.equal(isOpen(els), true);
});

test('a stored value beats the default in both directions', () => {
  const closed = boot({ storage: memStorage({ [DRAWER_KEY]: 'closed' }), hasAgents: () => false });
  assert.equal(isOpen(closed.els), false, 'stored closed beats an agent-free canvas');

  const open = boot({ storage: memStorage({ [DRAWER_KEY]: 'open' }), hasAgents: () => true });
  assert.equal(isOpen(open.els), true, 'stored open beats a populated canvas');
});

test('clicking the toggle flips the drawer, mirrors aria, and persists', () => {
  const { window, els, storage } = boot({ hasAgents: () => false });

  click(window, els.toggle);
  assert.equal(isOpen(els), false);
  assert.equal(els.toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(storage.read(DRAWER_KEY), 'closed');

  click(window, els.toggle);
  assert.equal(isOpen(els), true);
  assert.equal(els.toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(storage.read(DRAWER_KEY), 'open');
});

test('syncDefault() re-evaluates the default when the template changes', () => {
  // This is what composerLoadTemplate() and every composer view entry call.
  let agents = false;
  const { els, chrome } = boot({ hasAgents: () => agents });
  assert.equal(isOpen(els), true, 'the blank first-visit canvas opens');
  agents = true;
  chrome.syncDefault();
  assert.equal(isOpen(els), false, 'opening a pipeline that already has agents collapses it');
  agents = false;
  chrome.syncDefault();
  assert.equal(isOpen(els), true, '"New canvas" opens it again');
});

test('syncDefault() is inert once the user has toggled', () => {
  const { window, els, chrome, storage } = boot({ hasAgents: () => true });
  click(window, els.toggle);                       // collapsed -> open, persisted
  assert.equal(storage.read(DRAWER_KEY), 'open');
  chrome.syncDefault();
  assert.equal(isOpen(els), true, 'the stored preference survives a template load');
});

test('Escape clears a non-empty filter before it collapses the drawer', () => {
  // The filter is input[type=search]; Blink and WebKit clear it on Escape
  // natively. Without the two stages, one keypress would clear the query AND
  // hide the panel showing the result.
  const { window, doc, els, storage } = boot({ hasAgents: () => false });
  let applied = 0;
  els.filter.addEventListener('input', () => { applied += 1; });
  els.filter.value = 'plan';
  els.filter.focus();

  const first = esc(window, els.filter);
  assert.equal(els.filter.value, '', 'the first Escape clears the filter');
  assert.equal(applied, 1, 'and re-notifies the editor so applyFilter() re-runs');
  assert.equal(first.defaultPrevented, true,
    "preventDefault() suppressed the UA's own search-clear, so it cannot double-fire");
  assert.equal(isOpen(els), true, 'the drawer stays open');
  assert.equal(storage.read(DRAWER_KEY), null, 'clearing a filter is not a disclosure decision');
  assert.equal(doc.activeElement, els.filter, 'focus stays in the input');

  const second = esc(window, els.filter);
  assert.equal(isOpen(els), false, 'the second Escape collapses it');
  assert.equal(second.defaultPrevented, false, 'stage 2 has no UA default to suppress');
  assert.equal(storage.read(DRAWER_KEY), 'closed');
});

test('Escape in a COLLAPSED drawer passes straight through to the editor', () => {
  // The bar — and the filter in it — stay visible when collapsed, so Escape can
  // still be aimed at the drawer subtree. With nothing disclosed there is
  // nothing to dismiss: the handler must bail BEFORE stopPropagation(), or the
  // editor silently loses its deselect for as long as the drawer is shut.
  const { window, doc, els } = boot({ storage: memStorage({ [DRAWER_KEY]: 'closed' }) });
  let reachedDocument = false;
  doc.addEventListener('keydown', () => { reachedDocument = true; });
  els.filter.value = 'plan';
  els.filter.focus();

  esc(window, els.filter);

  assert.equal(isOpen(els), false, 'still collapsed — and NOT re-opened by a synthetic input');
  assert.equal(reachedDocument, true, 'the editor keeps its document-level deselect');
  assert.equal(els.filter.value, 'plan', 'the module does not clear a field it is not dismissing for');
});

test('a UA-cleared search field does not re-open a collapsed drawer', () => {
  // input[type=search] fires `input` with an EMPTY value when Blink and WebKit
  // clear it themselves — on Escape, and on the native ✕. A drawer the user just
  // dismissed must not spring back: a disclosure control may never run backwards.
  // Reachable path: type (auto-opens) -> click the canvas (light dismiss, the
  // text survives) -> Escape.
  const { window, els } = boot({ storage: memStorage({ [DRAWER_KEY]: 'closed' }) });
  assert.equal(isOpen(els), false);
  els.filter.value = '';
  els.filter.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(isOpen(els), false, 'an empty-value input is a clear, not a search');
});

test('Escape inside the drawer stops propagating so the editor does not also deselect', () => {
  // The editor binds Escape on the DOCUMENT to deselect (composer-editor.mjs:686,
  // registered at :749 with no capture flag), so a bubble-phase stopPropagation
  // at the drawer suppresses it.
  const { window, doc, els } = boot({ hasAgents: () => false });
  let reachedDocument = false;
  doc.addEventListener('keydown', () => { reachedDocument = true; });

  els.pill.focus();
  esc(window, els.pill);

  assert.equal(isOpen(els), false);
  assert.equal(reachedDocument, false, 'stopPropagation kept it off the document');
});

test('focus is rescued only from the subtree that is about to hide', () => {
  const a = boot({ hasAgents: () => false });
  a.els.pill.focus();
  esc(a.window, a.els.pill);
  assert.equal(a.doc.activeElement, a.els.toggle, 'focus left the panel before it hid');

  const b = boot({ hasAgents: () => false });
  b.els.filter.focus();                  // the BAR stays visible when collapsed
  esc(b.window, b.els.filter);
  assert.equal(isOpen(b.els), false);
  assert.equal(b.doc.activeElement, b.els.filter, 'focus in the still-visible bar is left alone');
});

test('Escape from the canvas leaves the drawer alone and reaches the document', () => {
  const { window, doc, els } = boot({ hasAgents: () => false });
  let reachedDocument = false;
  doc.addEventListener('keydown', () => { reachedDocument = true; });

  esc(window, els.canvas);

  assert.equal(isOpen(els), true, 'the drawer only answers Escape from inside itself');
  assert.equal(reachedDocument, true, 'the editor still gets its deselect');
});

test('a canvas pointerdown dismisses the drawer without persisting', () => {
  // The open panel overlays the canvas's top 240px and the editor binds
  // pointerdown on the canvas only, so without this a third of the canvas
  // cannot start a gesture.
  const { window, els, storage } = boot({ hasAgents: () => false });
  down(window, els.canvas);
  assert.equal(isOpen(els), false);
  assert.equal(storage.read(DRAWER_KEY), null, 'a transient dismissal is not a preference');
});

test('clicking a pill leaves the drawer open — several agents in a row', () => {
  const { window, els, storage } = boot({ hasAgents: () => false });
  down(window, els.pill);                // a press INSIDE the drawer is not an outside click
  click(window, els.pill);
  assert.equal(isOpen(els), true);
  assert.equal(storage.read(DRAWER_KEY), null, 'a pill click is not a disclosure decision');
});

test('typing in the filter re-opens a collapsed drawer, without persisting', () => {
  const { window, els, storage } = boot({ storage: memStorage({ [DRAWER_KEY]: 'closed' }) });
  assert.equal(isOpen(els), false);
  els.filter.value = 'plan';
  els.filter.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(isOpen(els), true, 'the bar is always visible — filtering an invisible list is a dead end');
  assert.equal(storage.read(DRAWER_KEY), 'closed', 'the stored preference is untouched');
});

test('canvasInsetTop() is the panel height when open and 0 when closed', () => {
  // 173, not the real 240: a hardcoded `return 240` would satisfy the round number.
  const { window, els, chrome } = boot({ hasAgents: () => false, panelHeight: 173 });
  assert.equal(chrome.canvasInsetTop(), 173, 'it MEASURES the panel, it does not assume 240');
  click(window, els.toggle);
  assert.equal(chrome.canvasInsetTop(), 0);
});

test('a throwing Storage (private mode) degrades to the defaults', () => {
  // jsdom does NOT rethrow out of dispatchEvent — it reports listener exceptions
  // as a window 'error' event — so assert.doesNotThrow around a click would be
  // vacuous here. Count the reported errors instead.
  const boom = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('SecurityError'); },
  };
  const { window, els } = boot({ storage: boom, hasAgents: () => false });
  assert.equal(isOpen(els), true, 'an unreadable key falls through to the default');

  let reported = 0;
  window.addEventListener('error', () => { reported += 1; });
  click(window, els.toggle);
  assert.equal(reported, 0, 'the unwritable key was swallowed, not thrown at the page');
  assert.equal(isOpen(els), false, 'the in-memory state still flips');
});

test('destroy() unbinds the toggle, Escape, the canvas and the filter', () => {
  const { window, els, chrome } = boot({ hasAgents: () => false });
  chrome.destroy();

  click(window, els.toggle);
  assert.equal(isOpen(els), true, 'the toggle is inert after destroy');
  els.pill.focus();
  esc(window, els.pill);
  assert.equal(isOpen(els), true, 'Escape is inert after destroy');
  down(window, els.canvas);
  assert.equal(isOpen(els), true, 'light dismiss is inert after destroy');

  // The filter binding only ACTS on a collapsed drawer, so it has to be tested
  // from that state or the assertion is vacuous — verified: dropping the filter
  // removeEventListener left the naive version green. destroy() unbound the
  // toggle, so collapse it the way the module itself reads state.
  els.drawer.dataset.open = 'false';
  els.filter.value = 'plan';
  els.filter.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(isOpen(els), false, 'filter auto-open is inert after destroy');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --test test/ui-composer-chrome.test.mjs`

Expected: FAIL — `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../ui/public/graph/composer-chrome.mjs'`. The file cannot link, so no individual cases run.

- [ ] **Step 3: Write the module**

Create `ui/public/graph/composer-chrome.mjs`:

```js
// ui/public/graph/composer-chrome.mjs
// Composer chrome: the top agent drawer's disclosure state and its persistence.
//
// This module deliberately owns NO graph state. It never reads or writes a
// template, so it is constructed once and survives the editor teardown/rebuild
// that composerLoadTemplate() performs on every "New canvas" and every saved-
// pipeline open.
//
// Escape is bound on the DRAWER, not the document, because the editor already
// owns a document-level Escape (deselect, composer-editor.mjs:686, registered
// at :749 in the bubble phase). A second document listener would fire both.

/** 'open' | 'closed' — any manual toggle writes it, and it then wins forever. */
export const DRAWER_KEY = 'worca-cc.composer.drawer';

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }   // private mode throws
}

function readKey(storage, key) {
  try { return storage ? storage.getItem(key) : null; } catch { return null; }
}

function writeKey(storage, key, value) {
  try { if (storage) storage.setItem(key, value); } catch { /* private mode */ }
}

/**
 * @param {object}   opts
 * @param {Element}  opts.drawer      #composer-drawer — carries data-open
 * @param {Element}  opts.toggle      #composer-drawer-toggle
 * @param {Element}  opts.panel       #composer-palette — measured for the canvas inset
 * @param {Element}  [opts.canvas]    #composer-canvas — light dismiss target
 * @param {Element}  [opts.filter]    #composer-agent-filter — Escape stage 1, auto-open
 * @param {Storage}  [opts.storage]   defaults to globalThis.localStorage
 * @param {Function} [opts.hasAgents] () => boolean, consulted ONLY while no key is stored
 * @returns {{ canvasInsetTop(): number, syncDefault(): void, destroy(): void }}
 */
export function createComposerChrome({
  drawer = null,
  toggle = null,
  panel = null,
  canvas = null,
  filter = null,
  storage = defaultStorage(),
  hasAgents = () => false,
} = {}) {
  const isOpen = () => Boolean(drawer) && drawer.dataset.open === 'true';
  const ownerDoc = () => (drawer ? drawer.ownerDocument : null);

  function setDrawer(open, { persist = false } = {}) {
    if (!drawer) return;
    drawer.dataset.open = open ? 'true' : 'false';
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (persist) writeKey(storage, DRAWER_KEY, open ? 'open' : 'closed');
  }

  /** Apply the stored preference, or — only while none exists — the first-visit
   *  default. `hasAgents`, never a node count: newCanvas() preloads Task + End. */
  function syncDefault() {
    const stored = readKey(storage, DRAWER_KEY);
    if (stored === 'open' || stored === 'closed') return void setDrawer(stored === 'open');
    setDrawer(!hasAgents());
  }

  function onToggleClick() {
    setDrawer(!isOpen(), { persist: true });
  }

  function onDrawerKeyDown(ev) {
    if (ev.key !== 'Escape' || !isOpen()) return;
    ev.stopPropagation();               // the editor's deselect must not also fire
    // Stage 1: a non-empty filter is the innermost dismissable state. The field
    // is input[type=search], which Blink and WebKit clear on Escape themselves —
    // preventDefault suppresses that so the clear happens exactly once here, and
    // the synthetic `input` re-runs the editor's applyFilter().
    if (filter && filter.value) {
      ev.preventDefault();
      filter.value = '';
      const view = ownerDoc() ? ownerDoc().defaultView : null;
      if (view) filter.dispatchEvent(new view.Event('input', { bubbles: true }));
      return;
    }
    // Stage 2: collapse, and persist — Escape is a deliberate manual toggle.
    // Rescue focus ONLY out of the part about to be hidden: the bar, and the
    // filter in it, stay visible.
    const active = ownerDoc() ? ownerDoc().activeElement : null;
    if (panel && active && panel.contains(active) && toggle && toggle.focus) toggle.focus();
    setDrawer(false, { persist: true });
  }

  /** Light dismiss. The open panel overlays the canvas's top 240px, and the
   *  editor binds pointerdown on the canvas only (composer-editor.mjs:745), so
   *  without this a third of the canvas cannot start a gesture. Deliberately
   *  does NOT persist: a canvas press is a statement about the graph, not a
   *  disclosure decision — the same rule as a pill click. Closing does not
   *  reflow (the panel is absolutely positioned), so the editor's own
   *  onPointerDown, running next on this same event, reads an unchanged rect. */
  function onCanvasPointerDown() {
    if (isOpen()) setDrawer(false);
  }

  /** The bar is always visible, so typing into it while collapsed would filter
   *  a list nobody can see. Reveal, but do not persist — the intent was to
   *  search, not to change the disclosure preference. The `filter.value` test is
   *  load-bearing and jsdom cannot show why: while the drawer is collapsed the
   *  Escape handler bails early, so Blink/WebKit run their OWN
   *  input[type=search] clear and fire a real `input` — which without this guard
   *  would spring the drawer back open on a keystroke that meant "dismiss". */
  function onFilterInput() {
    if (!isOpen() && filter && filter.value) setDrawer(true);
  }

  if (toggle) toggle.addEventListener('click', onToggleClick);
  if (drawer) drawer.addEventListener('keydown', onDrawerKeyDown);
  if (canvas) canvas.addEventListener('pointerdown', onCanvasPointerDown);
  if (filter) filter.addEventListener('input', onFilterInput);
  syncDefault();

  return {
    canvasInsetTop() {
      if (!panel || !isOpen() || !panel.getBoundingClientRect) return 0;
      return panel.getBoundingClientRect().height || 0;
    },
    syncDefault,
    destroy() {
      if (toggle) toggle.removeEventListener('click', onToggleClick);
      if (drawer) drawer.removeEventListener('keydown', onDrawerKeyDown);
      if (canvas) canvas.removeEventListener('pointerdown', onCanvasPointerDown);
      if (filter) filter.removeEventListener('input', onFilterInput);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --test test/ui-composer-chrome.test.mjs`

Expected: PASS, 19/19.

- [ ] **Step 5: Prove the guards are not vacuous**

Several assertions in this file are easy to write in a form that can never fail — an earlier draft shipped six of them. Verify each guard by temporarily breaking the module, one change at a time, and confirming the *named* case goes red, then restore:

| Temporarily change | Case that must fail |
|---|---|
| delete `ev.stopPropagation()` | `Escape inside the drawer stops propagating…` |
| delete the `!isOpen()` bail from `onDrawerKeyDown` | `Escape in a COLLAPSED drawer passes straight through to the editor` |
| delete `ev.preventDefault()` from stage 1 | `Escape clears a non-empty filter before it collapses the drawer` |
| delete the `try/catch` inside `writeKey` | `a throwing Storage (private mode) degrades to the defaults` |
| make the focus rescue unconditional (drop `panel.contains(active) &&`) | `focus is rescued only from the subtree that is about to hide` |
| drop `&& filter && filter.value` from `onFilterInput` | `a UA-cleared search field does not re-open a collapsed drawer` |
| drop `filter.removeEventListener` from `destroy()` | `destroy() unbinds the toggle, Escape, the canvas and the filter` |
| make `canvasInsetTop()` `return 240` | `canvasInsetTop() is the panel height when open and 0 when closed` |

Expected: 18/19 in each case — **exactly the named one red** — then 19/19 again after restoring. If a mutation leaves 19/19, that assertion is vacuous: fix the test, not the module. Do not commit any of these mutations.

- [ ] **Step 6: Run the full suite**

Run: `npm test`

Expected: `2482 + 19` tests, and the same 4 known failures (`skills-bundle` ×2, `skills-gate-wiring` ×2) — nothing else.

- [ ] **Step 7: Commit**

```bash
git add ui/public/graph/composer-chrome.mjs test/ui-composer-chrome.test.mjs
git commit -m "feat(composer): add chrome module for the agent drawer's disclosure state"
```

---
## Task 2: The editor accommodates the overlay

Four changes, all in `composer-editor.mjs`, all consequences of the same two facts: the drawer **overlays** the canvas's top 240px, and the palette host is now a short scroll box rather than a tall rail.

1. `centerWorld()` centres a pill-spawned node on the *raw* canvas rect, so it can drop a node underneath the panel the user just clicked.
2. `fit()` parks the graph's bounding box at the raw canvas origin, so "fit to screen" — a bottom-right button, therefore clickable while the drawer is open — hides the top of the user's own graph.
3. `spawn()` reuses one deterministic slot, so adding several agents in a row stacks every card on one pixel. `hitTest` (`composer-editor.mjs:351`) walks topmost-first, so the buried cards cannot be reached without dragging the top one away.
4. `renderPalette()`'s `replaceChildren` collapses `scrollHeight`, which clamps `scrollTop` to 0. In a 640px rail that was invisible; in a 240px panel whose Flow group is pinned **last**, it throws the user back to the top after every spawn.

All four are additive: with the default `canvasInsetTop = () => 0` and an empty canvas, (1) and (2) reproduce today's arithmetic byte for byte, (3) only moves the *second* identical spawn, and (4) is a no-op when `scrollTop` is already 0 (which it always is under jsdom, since jsdom has no layout).

**Files:**
- Modify: `ui/public/graph/composer-editor.mjs` — the JSDoc block at line 94, the destructuring at line 108, `renderPalette()`'s tail at 298-299, `spawn()` at 425-435, `centerWorld()` at 437-441, `fit()` at 494-503
- Test: `test/ui-composer-editor.test.mjs` — extend the `boot()` helper (line 38) and add three cases

**Interfaces:**
- Consumes: nothing from Task 1 (this task is independent of it).
- Produces: `createComposerEditor` accepts `opts.canvasInsetTop?: () => number`, default `() => 0`. Task 3 passes `() => (composer.chrome ? composer.chrome.canvasInsetTop() : 0)` at both call sites.

---

- [ ] **Step 1: Extend the test helper**

In `test/ui-composer-editor.test.mjs`, line 38 currently reads:

```js
function boot({ template = null, onSave = () => {}, agents = palette } = {}) {
```

Add the new option:

```js
function boot({ template = null, onSave = () => {}, agents = palette, canvasInsetTop } = {}) {
```

and in the `createComposerEditor({ ... })` call inside `boot` (lines 50-62), add one line alongside `template,` and `onSave,`:

```js
    canvasInsetTop,
```

Passing `undefined` when the option is absent leaves every existing test on the editor's own `() => 0` default, so no existing case changes behaviour.

- [ ] **Step 2: Write the three failing tests**

Append to `test/ui-composer-editor.test.mjs`:

```js
// --- the top drawer overlays the canvas --------------------------------------
// The drawer added in this change is an OVERLAY (it does not reflow the card),
// so everything that assumed "the canvas rect is the visible region" needs the
// inset. jsdom zeroes every rect, so each case stubs a real box.

test('a palette spawn clears the drawer overlay when canvasInsetTop reports one', () => {
  // A new canvas has no persisted view state, so the transform is identity and
  // client coords are world coords. snap() is the 11px half-grid.
  const spawnY = (inset) => {
    const ctx = boot({ canvasInsetTop: inset });
    ctx.els.canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600,
    });
    return ctx.editor.spawn({ key: 'planner' }).y;
  };

  // inset 0  -> centre y 300, minus the 60px header lead -> snap(240) = 242
  assert.equal(spawnY(undefined), 242, 'the default is byte-for-byte the old behaviour');
  // inset 200 -> centre of the VISIBLE band is 200 + (600-200)/2 = 400 -> snap(340) = 341
  assert.equal(spawnY(() => 200), 341, 'the node lands below the open overlay');
});

test('fit() fits into the band the drawer leaves visible', () => {
  // Deliberately assertion-by-property, not by magic number: what matters is
  // that the topmost card paints BELOW the panel, whatever the zoom works out to.
  const rect = { left: 0, top: 0, width: 800, height: 640, right: 800, bottom: 640 };
  const fitted = (inset) => {
    const ctx = boot({ canvasInsetTop: inset });
    ctx.els.canvas.getBoundingClientRect = () => rect;
    ctx.editor.fit();
    const t = ctx.editor.transform();
    const topWorldY = Math.min(...ctx.editor.template().nodes.map((n) => n.y));
    return { t, screenTop: topWorldY * t.zoom + t.y };
  };

  // A literal, NOT fitted(() => 0): both of those run the NEW code with inset 0,
  // so comparing them to each other could never fail. These are the numbers
  // today's fit() produces for a fresh Task+End canvas in an 800x640 rect —
  // b = {x:0, y:140, w:1240, h:230.5}, zoom = round(min(800/1240, 640/230.5)*100)/100
  // = 0.65, y = -140*0.65. `x` is -0 (`-b.x * zoom` with b.x === 0) and deepEqual
  // is SameValue on zeros, so write it as -0.
  assert.deepEqual(fitted(undefined).t, { x: -0, y: -91, zoom: 0.65 },
    'no inset is byte-for-byte the pre-drawer fit');
  assert.ok(fitted(() => 0).screenTop < 240,
    'guard: without the inset the graph really does start under the panel');
  assert.ok(fitted(() => 240).screenTop >= 240,
    'with the inset the highest card paints below the 240px panel');
});

test('successive pill spawns cascade instead of stacking on one pixel', () => {
  // centerWorld() is a pure function of the rect and the transform, and spawn()
  // changes neither — so without a cascade the second card would fully cover the
  // first, and hitTest (topmost-first) would make the first unreachable.
  const ctx = boot();
  const a = ctx.editor.spawn({ key: 'planner' });
  const b = ctx.editor.spawn({ key: 'planner' });
  assert.notDeepEqual({ x: b.x, y: b.y }, { x: a.x, y: a.y },
    'the second card is not hidden underneath the first');

  // An explicit position is still honoured verbatim — the cascade is only for
  // the centre-of-canvas default.
  const c = ctx.editor.spawn({ key: 'planner' }, { x: a.x, y: a.y });
  assert.deepEqual({ x: c.x, y: c.y }, { x: a.x, y: a.y },
    'spawn(entry, at) still places exactly where it is told');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `WORCA_HOME=.worca-cc-test node --test test/ui-composer-editor.test.mjs`

Expected: FAIL, 3 of them, each for its own reason:
- `a palette spawn clears the drawer overlay…` → `242 !== 341` (the option is ignored)
- `fit() fits into the band…` → the `screenTop >= 240` assertion fails
- `successive pill spawns cascade…` → `notDeepEqual` fails, both cards at the same `{x, y}`

Every pre-existing case must still pass (34 before this task; the file goes to 37).

- [ ] **Step 4: Accept the inset and use it in `centerWorld()`**

In `ui/public/graph/composer-editor.mjs`, add the JSDoc line immediately after `@param {HTMLInputElement} [opts.filter]` (line 94):

```js
 * @param {Function} [opts.canvasInsetTop] px of canvas hidden under open chrome (the top drawer)
```

Add to the destructured options, immediately after `filter = null,` (**line 108**):

```js
  canvasInsetTop = () => 0,
```

Replace `centerWorld()` (lines 437-441) with:

```js
  // The top drawer OVERLAYS the canvas, so the raw rect's centre can sit behind
  // it — a pill-spawned node would land under the panel that was just clicked.
  // Centre on the VISIBLE band instead. The default inset is 0, which is the
  // pre-drawer arithmetic exactly.
  function centerWorld() {
    const r = canvas.getBoundingClientRect();
    const h = r.height || 0;
    const inset = Math.min(Math.max(canvasInsetTop() || 0, 0), h);
    const c = toWorld(r.left + (r.width || 0) / 2, r.top + inset + (h - inset) / 2);
    return { x: c.x - NODE_W / 2, y: c.y - 60 };
  }
```

- [ ] **Step 5: Fit into the visible band too**

Replace `fit()` (lines 494-503) with:

```js
  function fit() {
    const boxes = tpl.nodes.map((n) => ({ x: n.x, y: n.y, ...sizeOf(n) }));
    const b = fitBounds(boxes, 60);
    if (!b || !b.w || !b.h) return;
    const r = canvas.getBoundingClientRect();
    const vw = r.width || 960;
    const vh = r.height || 600;
    // Same overlay problem as centerWorld: without the inset, "fit to screen"
    // parks the top of the graph under the open panel — and the zoom cluster is
    // bottom-right, so it is exactly the button a stuck user reaches for. Fit
    // into the visible band, then push the origin below the panel. Under jsdom
    // r.height is 0, so the clamp yields 0 and this is the old arithmetic.
    const inset = Math.min(Math.max(canvasInsetTop() || 0, 0), r.height || 0);
    const zoom = clamp(Math.round(Math.min(vw / b.w, (vh - inset) / b.h) * 100) / 100, ZOOM_MIN, ZOOM_MAX);
    setTransform({ x: -b.x * zoom, y: -b.y * zoom + inset, zoom });
  }
```

- [ ] **Step 6: Cascade the spawn slot**

Add `freeSlot()` immediately above `spawn()` (before line 425):

```js
  /** Successive pill clicks would otherwise stack every card on one pixel —
   *  centerWorld() is a pure function of the rect and the transform, and spawn()
   *  changes neither. Step off anything already sitting on the slot — anything
   *  SNAPPED, that is: loaded templates, and newCanvas()'s own Task at x:60 and
   *  End at x:960, render at unsnapped authored coordinates
   *  (graph-geometry.mjs:107) and are invisible to this test. It de-stacks
   *  successive spawns, which is what it is for; it is not a general overlap
   *  avoider. The step is
   *  SNAP*2 so the snapped result moves by exactly one dot-grid cell each time.
   *  The 24-try ceiling keeps a pathological template from looping, and it IS
   *  reachable: 25 consecutive default spawns fill slots 0..24 and the 26th
   *  exhausts the loop and stacks on slot 24. Accepted — 25 cards spawned without
   *  ever moving one is not a real session, the alternative is an unbounded loop,
   *  and the step is diagonal, so slot 24 is already 528px down and right of
   *  centre and off-canvas anyway. */
  function freeSlot(p) {
    let { x, y } = p;
    for (let i = 0; i < 24; i += 1) {
      const taken = tpl.nodes.some((n) => n.x === snap(x) && n.y === snap(y));
      if (!taken) break;
      x += SNAP * 2;
      y += SNAP * 2;
    }
    return { x, y };
  }
```

and in `spawn()` (line 425), change only its first body line:

```js
  function spawn(entry, at) {
    const p = at || freeSlot(centerWorld());
```

`snap` and `SNAP` are already imported from `graph-geometry.mjs` (`SNAP` is used by the arrow-key nudge in `onKeyDown`). The explicit-position path (`at`) is untouched — callers that ask for a coordinate still get exactly it.

- [ ] **Step 7: Preserve the palette's scroll position**

In `renderPalette()`, replace lines 298-299:

```js
    paletteHost.replaceChildren(frag);
    applyFilter();
```

with:

```js
    // paletteHost IS the 240px drawer scroll container now. replaceChildren()
    // collapses scrollHeight, which clamps scrollTop to 0 — so a pill click
    // would bounce the panel to the top and throw the pinned Flow group out of
    // reach, after every single spawn. The emitted markup is unchanged.
    const keepScroll = paletteHost.scrollTop;
    paletteHost.replaceChildren(frag);
    if (keepScroll) paletteHost.scrollTop = keepScroll;
    applyFilter();
```

This is the one place Task 2 touches a `renderPalette` line. The subtree it produces is byte-identical, so the compatibility invariant holds. jsdom has no layout, so `scrollTop` is always 0 there and this cannot be unit-tested — it is on Task 3's manual checklist instead.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --test test/ui-composer-editor.test.mjs`

Expected: PASS, 37/37 — the 34 pre-existing cases plus the three new ones. If a pre-existing case moved, the cascade is the likely cause: check whether it spawns the same pill twice and asserts a coordinate. Report it rather than weakening the test.

- [ ] **Step 9: Run the full suite**

Run: `npm test`

Expected: only the 4 known failures.

- [ ] **Step 10: Commit**

```bash
git add ui/public/graph/composer-editor.mjs test/ui-composer-editor.test.mjs
git commit -m "feat(composer): make spawn, fit and the palette scroll survive a canvas overlay"
```

---
## Task 3: Ship the drawer — markup, CSS, wiring

The vertical slice that makes the drawer real. At the end of this task the palette is a working top drawer and the canvas is ~796px wide. The inspector rail is untouched and still 280px.

**Files:**
- Modify: `ui/public/index.html:793-810`
- Modify: `ui/public/style.css` — the block header comment at 750, then lines 775, 758-763 and 756 **in that order** (bottom-up; see Global Constraints)
- Modify: `ui/public/app.js` — the import at 71, `initComposer()` (declared at 1654), `composerLoadTemplate()` (1717)
- Test: `test/ui-composer-chrome.test.mjs` — append a markup + stylesheet assertion block
- Test: `test/ui-composer-chrome-app.test.mjs` — **new**

**Interfaces:**
- Consumes: `createComposerChrome` and its `{ canvasInsetTop, syncDefault, destroy }` return from Task 1; `opts.canvasInsetTop` from Task 2.
- Produces: the ids `#composer-drawer`, `#composer-drawer-toggle`, `#composer-body`, and `composer.chrome` on the app's composer state object. Task 4 adds `#composer-ins-rail` and `#composer-inspector-toggle` next to them.

---

- [ ] **Step 1: Write the failing markup and stylesheet tests**

In `test/ui-composer-chrome.test.mjs`, add these two imports at the top of the file, alongside the existing ones:

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
```

and append at the end of the file:

```js
// --- the real index.html and style.css --------------------------------------
// The drawer is only a layout change: #composer-palette keeps its id and its
// rendered subtree, so renderPalette/applyFilter/onPaletteClick are untouched
// and ui-agent-xss's `#composer-palette .ap[data-key]` query still resolves.
//
// Two of these read style.css as text. That is the house pattern for rules that
// cannot be exercised under jsdom (see test/ui-run-flow-css.test.mjs,
// test/ui-pinned-sidebar.test.mjs) — jsdom applies no stylesheet, so a DOM
// assertion here would be a tautology.

const REAL_HTML = readFileSync(
  fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8',
);
const REAL_CSS = readFileSync(
  fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8',
);
const realDoc = new JSDOM(REAL_HTML).window.document;

test('index.html: the 264px palette rail is gone', () => {
  assert.ok(!realDoc.querySelector('.gv-palette'), '.gv-palette is gone');
  assert.ok(!realDoc.querySelector('.gv-palette-top'), '.gv-palette-top is gone');
});

test('index.html: the palette host lives inside the drawer, with its id intact', () => {
  const panel = realDoc.querySelector('#composer-palette');
  assert.ok(panel, '#composer-palette still exists');
  assert.ok(panel.closest('#composer-drawer'), 'it is inside the drawer');
  assert.ok(panel.classList.contains('gv-palette-scroll'));
});

test('index.html: the filter is in the bar, OUTSIDE the panel renderPalette() replaces', () => {
  const filter = realDoc.querySelector('#composer-agent-filter');
  assert.ok(filter, '#composer-agent-filter still exists');
  assert.ok(filter.closest('.gv-drawer-bar'), 'it is in the bar');
  assert.equal(filter.closest('#composer-palette'), null,
    'renderPalette() calls replaceChildren() on #composer-palette on every repaint');
});

test('index.html: the toggle is wired to the panel for assistive tech', () => {
  const toggle = realDoc.querySelector('#composer-drawer-toggle');
  assert.ok(toggle);
  assert.equal(toggle.getAttribute('aria-controls'), 'composer-palette');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.querySelector('svg').getAttribute('aria-hidden'), 'true',
    'the chevron is decorative — the name comes from the button text');
});

test('index.html: canvas and inspector are siblings inside the body row', () => {
  const body = realDoc.querySelector('#composer-body');
  assert.ok(body, '#composer-body exists');
  assert.ok(realDoc.querySelector('#composer-canvas').closest('#composer-body'));
  assert.ok(realDoc.querySelector('#composer-inspector').closest('#composer-body'));
});

test('index.html: the drawer is the body row\'s previous sibling', () => {
  // The empty-state clearance rule below is a `~` sibling selector, so this
  // ordering is load-bearing, not cosmetic.
  assert.equal(realDoc.querySelector('#composer-drawer').nextElementSibling.id, 'composer-body');
});

test('style.css: the open panel does not bury the canvas empty state', () => {
  assert.match(REAL_CSS, /\.gv-drawer\[data-open="true"\]\s*~\s*\.gv-body\s+\.gv-empty\{[^}]*top:264px/,
    '.gv-empty sits at top:24px and the panel covers the canvas\'s top 239px');
});

test('style.css: the drawer outranks everything the canvas paints', () => {
  // .gv-chip is z-index:6 and NOTHING between it and the root creates a
  // stacking context, so the drawer has to be >= 7 or the reason chip paints
  // over the open palette.
  assert.match(REAL_CSS, /\.gv-drawer\{[^}]*z-index:7/, 'the drawer is z-index:7');
});

test('style.css: the two rules the whole goal rests on', () => {
  // Neither is observable at runtime — jsdom has no layout — and both are the
  // difference between "the canvas got wider" and "nothing visibly changed".
  assert.match(REAL_CSS, /\.builder-card\{[^}]*flex-direction:column[^}]*min-height:685px/,
    'the card is a column and grew by the drawer bar');
  assert.match(REAL_CSS, /\.pills\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(min\(196px,100%\),1fr\)\)/,
    'the pills wrap across the width instead of stacking in a column');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --test test/ui-composer-chrome.test.mjs`

Expected: FAIL on all 9 new cases — `.gv-palette` still exists, `#composer-drawer` / `#composer-body` do not, and none of the CSS rules are in the file. The 19 cases from Task 1 must still pass: the file links fine (only `createComposerChrome` and `DRAWER_KEY` are imported, both already exported) and the module-scope `new JSDOM(REAL_HTML)` cannot throw.

- [ ] **Step 3: Restructure the markup**

In `ui/public/index.html`, replace lines 793-810 — the whole `<section class="card builder-card">` block, from `<section …>` through `</section>`, 10 leading spaces of indentation — with:

```html
          <section class="card builder-card">
            <!-- Top drawer: the 44px bar is always in flow; the panel below it
                 OVERLAYS the canvas when open, so opening it never reflows the
                 graph. #composer-palette keeps its id and the exact subtree
                 renderPalette() builds — the domain chips, the per-domain
                 .pal-group sections and the pinned Flow group. -->
            <div class="gv-drawer" id="composer-drawer" data-open="true">
              <div class="gv-drawer-bar">
                <button type="button" class="gv-drawer-toggle" id="composer-drawer-toggle"
                        aria-expanded="true" aria-controls="composer-palette">
                  <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" stroke-width="2.4" stroke-linecap="round"
                       stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"></path></svg>
                  Agents
                </button>
                <input id="composer-agent-filter" class="pal-filter" type="search"
                       placeholder="Filter agents…" aria-label="Filter agents by name or ports">
              </div>
              <div id="composer-palette" class="gv-palette-scroll"></div>
            </div>

            <div class="gv-body" id="composer-body" data-inspector="open">
              <!-- The canvas host. composer-editor.mjs owns everything inside it:
                   the graph-view stage, the empty state, the reason chip, the
                   legend and the zoom / auto-layout cluster. -->
              <div class="gv-canvas" id="composer-canvas"></div>

              <!-- Right rail: the selected node's / wire's inspector. -->
              <aside class="gv-inspector" id="composer-inspector"></aside>
            </div>
          </section>
```

- [ ] **Step 4: Replace the rail CSS with drawer CSS — bottom-up**

In `ui/public/style.css`. **Apply these in the order given** (775 first, 756 last); each replacement is longer than what it replaces, so going top-down would invalidate the next line number.

**4a — replace line 775.** It currently reads exactly:

```css
.pills{display:flex;flex-direction:column;gap:8px;}
```

with:

```css
/* Was a single column in the 264px rail; now wraps across the card width.
   1046px usable / minmax(196px) with an 8px gap = 5 pills per row at 1440.
   auto-fill, NOT auto-fit: several domains hold only one or two agents, and
   auto-fit would collapse the empty tracks and stretch those pills to ~500px.
   min() guards the track floor so a narrow card can never force a horizontal
   scrollbar. Known cost: a 196px cell leaves `.ap .b` 154px against the rail's
   190px, so the mono port line (.ap .p, already ellipsised) truncates about 19%
   earlier. Accepted — D2 keeps the port line. */
.pills{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(196px,100%),1fr));gap:8px;}
```

**4b — replace lines 758-763.** Note **758**, not 759: the stale section comment goes with them. They currently read exactly:

```css
/* ---------- palette rail ---------- */
.gv-palette{width:264px;flex:0 0 264px;border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0;}
.gv-palette-top{padding:16px 16px 12px;border-bottom:1px solid var(--line);}
.gv-palette-top .pal-filter{width:100%;height:36px;border:none;border-radius:11px;background:var(--field);padding:0 12px;font-size:12.5px;font-weight:500;color:var(--ink);font-family:inherit;}
.gv-palette-top .pal-filter::placeholder{color:var(--ink-3);}
.gv-palette-scroll{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 16px 8px;}
```

with:

```css
/* ---------- top agent drawer ---------- */
/* z-index 7, not 5: .gv-chip is z-index:6 (style.css:803) and NOTHING between it
   and the root creates a stacking context — .gv-canvas is position:relative with
   z-index:auto, .gv-body is unpositioned, and .builder-card/.card set no
   position, transform, opacity or filter. At 5 the illegal-drop reason chip
   would paint over the open palette. Nothing else in the composer reaches 7. */
.gv-drawer{position:relative;z-index:7;flex:0 0 auto;border-bottom:1px solid var(--line);}
.gv-drawer-bar{height:44px;display:flex;align-items:center;gap:12px;padding:0 16px;}
.gv-drawer-toggle{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;
  color:var(--ink-2);background:none;border:0;padding:4px 6px;border-radius:9px;cursor:pointer;
  font-family:inherit;}
.gv-drawer-toggle:hover{background:var(--field);color:var(--ink);}
.gv-drawer-toggle:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.gv-drawer-toggle .chev{width:14px;height:14px;flex:0 0 auto;transition:transform var(--t-fast,120ms);}
.gv-drawer[data-open="false"] .gv-drawer-toggle .chev{transform:rotate(-90deg);}
/* Re-homed from `.gv-palette-top .pal-filter` (old line 761): width:100% becomes
   flex + max-width, and 36px becomes 32px to sit in the 44px bar. Every other
   declaration, and the ::placeholder rule, carry over verbatim.
   input[type=search] is NOT matched by the generic control rules at 278-299, so
   the focus ring has to be declared here. min-width:0 lets the field shrink
   instead of pushing the bar past .builder-card's overflow:hidden. */
.gv-drawer-bar .pal-filter{flex:1 1 auto;min-width:0;max-width:320px;height:32px;border:none;
  border-radius:11px;background:var(--field);padding:0 12px;font-size:12.5px;font-weight:500;
  color:var(--ink);font-family:inherit;}
.gv-drawer-bar .pal-filter::placeholder{color:var(--ink-3);}
.gv-drawer-bar .pal-filter:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
/* Fixed height + internal scroll, and absolute so it OVERLAYS rather than
   reflows. height, not max-height: the panel stays 240px however many custom
   agents a user registers. top:100% resolves against the drawer's PADDING box
   (44px — the border-bottom sits outside it), so the panel spans card y 44..284,
   well inside the 685px card: .builder-card's overflow:hidden never clips it.
   It covers canvas y 0..239. canvasInsetTop() reports the panel's own 240px box
   — one pixel more than the true overlap, which is one pixel of extra clearance,
   not a bug. */
.gv-palette-scroll{position:absolute;top:100%;left:0;right:0;height:240px;overflow-y:auto;
  padding:14px 16px 8px;background:var(--panel);border-bottom:1px solid var(--line);
  box-shadow:var(--shadow);}
.gv-drawer[data-open="false"] .gv-palette-scroll{display:none;}
/* The chips are renderPalette()'s first child inside the scroll box, so they
   would scroll away. Pin them, cancelling the container's 14px top padding so
   they sit flush once stuck.
   PLACEMENT: `.gv-palette-scroll .pal-chips` is specificity (0,2,0) and BOTH
   bare `.pal-chips` declarations — style.css:764 and the duplicate near the
   bottom of the file — are (0,1,0), so this wins wherever it sits and belongs
   here, in the composer block. It sets margin-top, never the margin shorthand,
   so the duplicate's margin-bottom survives untouched. */
.gv-palette-scroll .pal-chips{position:sticky;top:-14px;z-index:1;
  background:var(--panel);padding-top:14px;margin-top:-14px;}
/* The empty-state pill is position:absolute;top:24px inside the canvas
   (style.css:799) and D5 opens the drawer by default on exactly the agent-free
   canvas that shows it — without this, the onboarding copy is invisible on every
   first visit. 264 = the panel's 240px box (canvasInsetTop's number) plus the
   original 24px lead — a pixel more clearance than the true 239px overlap needs.
   The selector is (0,4,0) against the base rule's (0,1,0), so where it sits in
   the file does not matter. */
.gv-drawer[data-open="true"] ~ .gv-body .gv-empty{top:264px;}
```

**4c — replace line 756.** It currently reads exactly:

```css
.builder-card{padding:0;overflow:hidden;display:flex;min-height:640px;}
```

with:

```css
/* Column: the drawer bar sits above the canvas + inspector row. The bar is 44px
   of content PLUS .gv-drawer's own 1px border-bottom — the drawer's height is
   auto, so that border is additive (*{box-sizing:border-box} at style.css:43
   governs SPECIFIED heights only). 640 + 45 = 685 preserves the canvas height
   exactly: min-height is a BORDER box under that same rule, so .card's 1px
   borders make today's canvas 638px, and 685 - 2 - 45 is 638 again. .gv-canvas
   declares no height anywhere in this stylesheet — its size is pure
   align-items:stretch — and .builder-card{padding:0} already beats
   .card{padding:24px} on source order. NOTE: spec §4.1 says 684; it is off by
   the drawer's border. */
.builder-card{padding:0;overflow:hidden;display:flex;flex-direction:column;min-height:685px;}
.gv-body{flex:1 1 auto;display:flex;min-height:0;}
```

**4d — update the block header at line 750**, which currently reads:

```css
/* Pipeline Composer v2 — node graph canvas, palette rail, inspector          */
```

to:

```css
/* Pipeline Composer v2 — node graph canvas, top agent drawer, inspector      */
```

- [ ] **Step 5: Wire it up in `app.js`**

Add the import next to the existing `createComposerEditor` import (line 71):

```js
import { createComposerChrome } from './graph/composer-chrome.mjs';
```

In `initComposer()` (declared at line 1654 — remember the import above shifts every later number by +1), add after the existing `composer.els.savedCount` lookup:

```js
  composer.els.drawer    = $('#composer-drawer');
  composer.els.drawerTog = $('#composer-drawer-toggle');
  composer.els.body      = $('#composer-body');
```

Then insert this block **immediately after those lookups** and **before** the existing `if (!_composerReady || _composerPaletteDirty) await refreshComposerPalette();` line:

```js
  // Constructed ONCE, and BEFORE the palette await: a stored 'closed' preference
  // has to be applied on the first paint, not after a network round-trip. The
  // `!composer.chrome` guard is its own idempotence — unlike _composerReady it is
  // set before any await, so a fast double view-entry cannot double-bind the
  // toggle. The chrome owns no graph state, so it is never destroyed and it
  // survives every editor swap composerLoadTemplate() performs.
  if (!composer.chrome) {
    composer.chrome = createComposerChrome({
      drawer: composer.els.drawer,
      toggle: composer.els.drawerTog,
      panel: composer.els.palette,
      canvas: composer.els.canvas,
      filter: composer.els.filter,
      hasAgents: () => Boolean(
        composer.editor?.template?.()?.nodes?.some((n) => n.kind === 'agent'),
      ),
    });
  }
```

Add this line to the options object of **both** `createComposerEditor(...)` calls — the one inside `if (!_composerReady) {` and the one in `composerLoadTemplate()`. `composerLoadTemplate` destroys the editor and builds a fresh one on every "New canvas" and every saved-pipeline open; miss it and the spawn and fit fixes silently stop applying:

```js
      canvasInsetTop: () => (composer.chrome ? composer.chrome.canvasInsetTop() : 0),
```

(`composerLoadTemplate()`'s object literal is indented **four** spaces, not six — re-indent when you paste.)

While you are in the file, add the field to the `composer` state literal (`app.js:1606-1612`), next to `editor: null,`, so the object keeps documenting its own shape:

```js
  chrome: null,   // createComposerChrome() — constructed once, never destroyed
```

Finally, add the `syncDefault()` calls. In `initComposer()`, after the existing `composerPaintDirty();` and before `await composerLoadSaved();`:

```js
  composer.chrome.syncDefault();   // the editor exists now, so D5's default is real
```

and at the end of `composerLoadTemplate()`, next to the existing `composerPaintDirty();`:

```js
  composer.chrome?.syncDefault();   // first-visit default only; a stored key wins
```

**Why both, and why in that order.** `composerLoadTemplate` has exactly two callers (`app.js:1687`, the "New canvas" reset button, and `app.js:1807`, opening a saved pipeline) and both are bound inside the `if (!_composerReady)` block — so it never runs on the initial view entry. Without the `initComposer` call, `syncDefault()` would only ever run from inside the factory, where `composer.editor` does not exist yet and `hasAgents()` is false by accident rather than by fact. The `?.` in `composerLoadTemplate` is defensive only; `initComposer` returns early at line 1656 when `#composer-canvas` is absent (partial DOM in tests), and both callers are downstream of that.

Note that the editor does **not** need the chrome at construction: `canvasInsetTop` is a late-bound closure, and it is only ever invoked from `centerWorld()` and `fit()`. Any construction order works; the one above is chosen so the stored preference lands on the first paint.

- [ ] **Step 6: Write the app-level integration test**

Nothing in Task 1's unit tests proves `createComposerChrome` is ever called. Create `test/ui-composer-chrome-app.test.mjs`:

```js
// test/ui-composer-chrome-app.test.mjs — the drawer against the REAL index.html
// and the REAL app.js. The chrome's unit tests drive the factory directly, so
// they cannot see a wiring mistake: a missing createComposerChrome() call, a
// syncDefault() that never runs against a real template, or a chrome that gets
// constructed twice and double-binds its toggle.
//
// The harness is the one test/ui-agent-xss.test.mjs uses (jsdom + a stubbed
// fetch + a WebSocket stub), trimmed to what the composer needs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const AGENTS = [{
  key: 'planner', displayName: 'Plan', description: 'architecture', color: 'violet',
  runnerType: 'producer', order: 1, origin: 'builtin', icon: '<circle cx="4" cy="6" r="1.1"/>',
  metaVersion: 2, domain: 'coding',
  inputs: [{ id: 'task', type: 'md', required: true, as: 'file' }],
  outputs: [{ id: 'plan', type: 'md', when: 'always', filename: '{base}.md', store: 'project' }],
}];

/** A saved pipeline that PLACES an agent — the state D5 collapses the drawer on. */
const SAVED_TEMPLATE = {
  id: 'wf_demo', name: 'Demo', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 200, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 360, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 960, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } },
  ],
};

class WSStub {
  constructor() { this.readyState = 1; this.sent = []; this._listeners = {}; WSStub.last = this; }
  send() {}
  close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  _open() { (this._listeners.open || []).forEach((fn) => fn({})); }
}

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.confirm = () => true;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.fetch = (url, opts) => {
    const u = String(url);
    const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
    if (u.endsWith('/api/workflows') && (!opts || !opts.method || opts.method === 'GET')) {
      return json({ workflows: [SAVED_TEMPLATE] });
    }
    if (u.includes('/api/workflows/')) return json(SAVED_TEMPLATE);
    if (u.includes('/api/agents')) return json({ agents: AGENTS, channels: [], mockWriterRoles: [] });
    if (u.includes('/api/projects')) return json({ projects: [] });
    if (u.includes('/api/workspaces')) return json({ workspaces: [] });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* jsdom-only key */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  if (WSStub.last) WSStub.last._open();
  return window;
}

const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const tick = () => new Promise((r) => setTimeout(r, 0));
const goComposer = async (window) => {
  window.location.hash = 'composer';
  window.dispatchEvent(new window.Event('hashchange'));
  for (let i = 0; i < 4; i += 1) await tick();
};

test('the chrome is constructed and the blank first-visit canvas opens the drawer', async () => {
  const window = await boot();
  await goComposer(window);
  const doc = window.document;
  const drawer = doc.querySelector('#composer-drawer');

  assert.ok(doc.querySelector('#composer-palette .ap'),
    'guard: the palette actually rendered, so the composer really booted');
  assert.equal(drawer.dataset.open, 'true', 'a new canvas has no agents (D5)');
  assert.equal(doc.querySelector('#composer-drawer-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(window.localStorage.getItem('worca-cc.composer.drawer'), null,
    'a first-visit default is not a stored preference');
});

test('opening a saved pipeline re-runs the default against the loaded template', async () => {
  const window = await boot();
  await goComposer(window);
  const doc = window.document;

  click(window, doc.querySelector('#composer-saved-list .pl-open'));
  for (let i = 0; i < 4; i += 1) await tick();

  assert.ok(doc.querySelector('#composer-canvas .node[data-node-id="n_plan"]'),
    'guard: the template really loaded');
  assert.equal(doc.querySelector('#composer-drawer').dataset.open, 'false',
    'composerLoadTemplate() re-ran syncDefault() and the graph has an agent');
});

test('the chrome outlives the editor swap and is bound exactly once', async () => {
  const window = await boot();
  await goComposer(window);
  const doc = window.document;
  const drawer = doc.querySelector('#composer-drawer');

  click(window, doc.querySelector('#composer-saved-list .pl-open'));
  for (let i = 0; i < 4; i += 1) await tick();
  assert.equal(drawer.dataset.open, 'false');

  // ONE construction means ONE listener: a single click must flip the state
  // exactly once. A second binding would flip it twice and leave it collapsed.
  click(window, doc.querySelector('#composer-drawer-toggle'));
  assert.equal(drawer.dataset.open, 'true', 'the toggle still works after the editor was rebuilt');
  assert.equal(window.localStorage.getItem('worca-cc.composer.drawer'), 'open',
    'and a manual toggle persists');
});

test('re-entering the composer re-syncs the default against the LIVE editor', async () => {
  // The bug this pins is B1: composerLoadTemplate() has two callers, both bound
  // inside the `if (!_composerReady)` block, so it never runs on the initial view
  // entry; and the factory's own syncDefault() runs BEFORE composer.editor
  // exists, so hasAgents() is false by accident rather than by fact. Only the
  // syncDefault() call at the END of initComposer() ever reads a real template.
  //
  // The drawer is first re-opened by a NON-persisting gesture (the filter
  // auto-open) while the loaded graph HAS an agent, so a missing re-sync is
  // visible: with the call the re-entry collapses it, without it nothing moves.
  const window = await boot();
  const doc = window.document;
  await goComposer(window);

  click(window, doc.querySelector('#composer-saved-list .pl-open'));
  for (let i = 0; i < 4; i += 1) await tick();
  assert.equal(doc.querySelector('#composer-drawer').dataset.open, 'false',
    'guard: the agent-bearing template collapsed it');

  const filter = doc.querySelector('#composer-agent-filter');
  filter.value = 'pl';
  filter.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(doc.querySelector('#composer-drawer').dataset.open, 'true',
    'guard: the filter auto-open reveals it WITHOUT persisting');
  assert.equal(window.localStorage.getItem('worca-cc.composer.drawer'), null,
    'guard: still no stored preference, so the default is still live');

  window.location.hash = 'overview';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick();
  await goComposer(window);

  assert.equal(doc.querySelector('#composer-drawer').dataset.open, 'false',
    'initComposer() re-ran syncDefault() against the editor that is actually loaded');
});

test('app.js hands canvasInsetTop to BOTH createComposerEditor call sites', () => {
  // composerLoadTemplate() destroys the editor and builds a fresh one on every
  // "New canvas" and every saved-pipeline open. Miss it and the spawn and fit
  // fixes silently stop applying — and no DOM assertion can see it, because
  // jsdom reports a zero-height canvas rect, which clamps the inset to 0.
  // Source text is the house pattern for exactly this (test/ui-run-flow-css.test.mjs).
  const APP = readFileSync(appPath, 'utf8');
  const sites = APP.match(/createComposerEditor\(\{/g) || [];
  assert.equal(sites.length, 2, 'initComposer() and composerLoadTemplate()');
  const wired = APP.match(/canvasInsetTop: \(\) => \(composer\.chrome \? composer\.chrome\.canvasInsetTop\(\) : 0\)/g) || [];
  assert.equal(wired.length, 2, 'both sites, or the fix stops applying after a template load');
  assert.match(APP, /import \{ createComposerChrome \} from '\.\/graph\/composer-chrome\.mjs';/);
});
```

Two notes for whoever runs this file:

- It prints `worca [ui] guardrails: list failed` three times on stderr. That is **pre-existing harness noise** — `test/ui-agent-xss.test.mjs` emits the identical three lines against the pristine repo, because the stubbed `fetch` does not serve the guardrails endpoint. Not a regression.
- The `re-entering the composer…` case is the only thing in the whole plan that catches a missing `syncDefault()` in `initComposer()`. Deleting that one line otherwise leaves every other test green, for exactly the accidental reason B1 describes.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --test test/ui-composer-chrome.test.mjs test/ui-composer-chrome-app.test.mjs test/ui-composer-editor.test.mjs test/ui-agent-xss.test.mjs test/ui-boot.test.mjs`

Expected: PASS — 28 in the chrome file, 5 in the app file, 37 in the editor file, and `ui-agent-xss` (3) and `ui-boot` (1) unchanged (74 for this command). Those last two boot the real `index.html`; they are the proof that the compatibility invariant held.

- [ ] **Step 8: Run the full suite**

Run: `npm test`

Expected: only the 4 known failures. If `ui-composer-wires` or `ui-composer-save` broke, the markup violated the invariant — fix the markup.

- [ ] **Step 9: Verify in the real app**

Start the app and open the Composer view. Confirm, at a ~1440px window:
- The drawer bar spans the card; the panel below it is 240px tall and scrolls internally to reach the pinned Flow group.
- Pills wrap 5-across, each still showing its mono port line.
- Domain chips stay pinned at the top of the panel while it scrolls, and still toggle their section.
- The canvas is visibly wider than one node-pair; the zoom cluster and legend still sit at its bottom corners.
- **The empty-state hint ("Wire agents from the Task node…") is visible below the open panel, not hidden behind it.**
- Clicking a pill places a node **below** the open panel, and the panel stays open.
- **Scroll down to the pinned Flow group and click AND twice: the panel does not jump back to the top, and the two cards do not land on top of each other.**

The remaining checks are about persistence, so **order matters** — one of them writes the key that the others depend on being absent. Run them exactly in this sequence:

- **Clear the key first:** `localStorage.removeItem('worca-cc.composer.drawer')`, then reload. The drawer opens (no agents on a blank canvas).
- **Clicking anywhere on the visible canvas collapses the drawer.** Reopen it with the toggle, then clear the key again and reload: it comes back **open**, because a light dismiss is not a preference.
- **With the drawer open, clicking "fit to screen" leaves the whole graph below the panel.**
- **Collapse the drawer with the toggle and reload: it stays collapsed.** Clear the key and reload again.
- **With the drawer collapsed, typing in the filter re-opens it** — and the key stays absent, so a reload opens it too.
- **Last, because it persists:** with the drawer open and text in the filter, press Escape — the filter clears and the panel stays open. Press Escape again — the drawer collapses, and this one **does** write the key, so a reload keeps it collapsed. Clear the key when you are done.

- [ ] **Step 10: Commit**

```bash
git add ui/public/index.html ui/public/style.css ui/public/app.js \
        test/ui-composer-chrome.test.mjs test/ui-composer-chrome-app.test.mjs
git commit -m "feat(composer): move the agent palette into a collapsible top drawer"
```

---
## Task 4: Ship the inspector collapse

Same vertical slice for the right rail. The handle **cannot** be a child of `#composer-inspector`: `renderInspector()` calls `inspectorHost.replaceChildren(...)` on every one of its five exit paths (`composer-editor.mjs:324-339`) and would delete it. So the rail becomes a wrapper holding the handle and the untouched inspector host side by side.

**Files:**
- Modify: `ui/public/graph/composer-chrome.mjs` — add the inspector half
- Modify: `ui/public/index.html` — wrap the inspector
- Modify: `ui/public/style.css` — line 878 (`.gv-inspector`) replaced by the rail block
- Modify: `ui/public/app.js` — one element lookup, two chrome params
- Test: `test/ui-composer-chrome.test.mjs` — append

**Interfaces:**
- Consumes: `createComposerChrome` from Task 1; `#composer-body` from Task 3.
- Produces: `export const INSPECTOR_KEY = 'worca-cc.composer.inspector'`; `createComposerChrome` additionally accepts `body` and `insToggle`.

---

- [ ] **Step 1: Write the failing tests**

In `test/ui-composer-chrome.test.mjs`, extend the module import to pull in the new key:

```js
import { createComposerChrome, DRAWER_KEY, INSPECTOR_KEY } from '../ui/public/graph/composer-chrome.mjs';
```

Replace the `<div class="gv-body" ...>` block in `SHELL` with the rail — and note it seeds `collapsed`, the **opposite** of the default, for the same reason the drawer half seeds `data-open="false"`:

```js
    <div class="gv-body" id="body" data-inspector="collapsed">
      <div id="canvas" class="gv-canvas"></div>
      <div class="gv-ins-rail" id="rail">
        <button id="ins-toggle" type="button" aria-expanded="false"
                aria-controls="inspector" aria-label="Expand inspector"></button>
        <aside id="inspector" class="gv-inspector"></aside>
      </div>
    </div>
```

Add the two new elements to `boot()`'s `els` object (`body` is already there from Task 1):

```js
    insToggle: doc.getElementById('ins-toggle'),
    inspector: doc.getElementById('inspector'),
```

and pass them to the factory:

```js
  const chrome = createComposerChrome({
    drawer: els.drawer, toggle: els.toggle, panel: els.panel,
    canvas: els.canvas, filter: els.filter,
    body: els.body, insToggle: els.insToggle, storage, hasAgents,
  });
```

Append these cases:

```js
test('the inspector defaults to open when nothing is stored', () => {
  // SHELL seeds `collapsed`, so this asserts the module wrote the default.
  const { els } = boot();
  assert.equal(els.body.dataset.inspector, 'open');
  assert.equal(els.insToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(els.insToggle.getAttribute('aria-label'), 'Collapse inspector');
});

test('a stored inspector preference is restored, in both directions', () => {
  // SHELL seeds `collapsed`, so the 'collapsed' direction alone would pass
  // against an empty setInspector() — verified vacuous. Only the 'open'
  // direction proves the module wrote anything, exactly as for DRAWER_KEY above.
  const collapsed = boot({ storage: memStorage({ [INSPECTOR_KEY]: 'collapsed' }) });
  assert.equal(collapsed.els.body.dataset.inspector, 'collapsed');
  assert.equal(collapsed.els.insToggle.getAttribute('aria-expanded'), 'false');

  const open = boot({ storage: memStorage({ [INSPECTOR_KEY]: 'open' }) });
  assert.equal(open.els.body.dataset.inspector, 'open');
  assert.equal(open.els.insToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(open.els.insToggle.getAttribute('aria-label'), 'Collapse inspector');
});

test('the inspector handle flips the rail, relabels itself, and persists', () => {
  const { window, els, storage } = boot();

  click(window, els.insToggle);
  assert.equal(els.body.dataset.inspector, 'collapsed');
  assert.equal(els.insToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(els.insToggle.getAttribute('aria-label'), 'Expand inspector');
  assert.equal(storage.read(INSPECTOR_KEY), 'collapsed');

  click(window, els.insToggle);
  assert.equal(els.body.dataset.inspector, 'open');
  assert.equal(els.insToggle.getAttribute('aria-label'), 'Collapse inspector');
  assert.equal(storage.read(INSPECTOR_KEY), 'open');
});

test('the inspector rail is independent of the drawer', () => {
  const { window, els } = boot();
  // SHELL seeds `collapsed`, so without this guard the assertion below would
  // match the fixture rather than the module — verified vacuous.
  assert.equal(els.body.dataset.inspector, 'open', 'guard: the module applied its default');
  click(window, els.insToggle);
  assert.equal(els.body.dataset.inspector, 'collapsed');
  assert.equal(isOpen(els), true, 'collapsing the rail did not touch the drawer');
  click(window, els.toggle);
  assert.equal(els.body.dataset.inspector, 'collapsed', 'and vice versa');
});

test('syncDefault() never touches the inspector', () => {
  // The drawer's default is template-derived; the rail's is not. A shared
  // sync would silently re-open a rail the user collapsed.
  const { window, els, chrome } = boot();
  assert.equal(els.body.dataset.inspector, 'open', 'guard: SHELL seeds collapsed, the module opened it');
  click(window, els.insToggle);
  assert.equal(els.body.dataset.inspector, 'collapsed');
  chrome.syncDefault();
  assert.equal(els.body.dataset.inspector, 'collapsed');
});

test('destroy() unbinds the inspector handle too', () => {
  const { window, els, chrome } = boot();
  chrome.destroy();
  click(window, els.insToggle);
  assert.equal(els.body.dataset.inspector, 'open');
});

test('index.html: the collapse handle is a SIBLING of the inspector host', () => {
  // renderInspector() calls replaceChildren() on #composer-inspector on every
  // repaint — a handle inside it would be deleted on the first selection.
  const rail = realDoc.querySelector('#composer-ins-rail');
  assert.ok(rail, '#composer-ins-rail exists');
  const handle = realDoc.querySelector('#composer-inspector-toggle');
  assert.ok(handle, '#composer-inspector-toggle exists');
  const host = realDoc.querySelector('#composer-inspector');
  assert.equal(handle.parentElement, rail, 'the handle hangs off the rail wrapper');
  assert.equal(host.parentElement, rail, 'and the host is its SIBLING, not its child');
  assert.equal(rail.parentElement, realDoc.querySelector('#composer-body'),
    'the rail sits in the body row');
  assert.equal(realDoc.querySelector('#composer-canvas').parentElement, rail.parentElement,
    'canvas and rail share that row');
  assert.equal(host.children.length, 0,
    'the inspector host ships empty — the editor owns its contents');
  assert.equal(handle.getAttribute('aria-controls'), 'composer-inspector');
  assert.equal(handle.querySelector('svg').getAttribute('aria-hidden'), 'true',
    'the chevron is decorative — the name comes from aria-label');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `WORCA_HOME=.worca-cc-test node --test test/ui-composer-chrome.test.mjs`

Expected: FAIL — and note the **shape** of this failure. Named imports link before any test body runs, so the whole file aborts with:

```
SyntaxError: The requested module '../ui/public/graph/composer-chrome.mjs'
does not provide an export named 'INSPECTOR_KEY'
```

`tests 1 / pass 0 / fail 1`. That is the correct red for Step 3, but it **masks all 35 cases in the file**, so it proves only that the export is missing.

Then re-run this command after Step 3 and **before** touching the markup, and expect `tests 35 / pass 34 / fail 1`. Do not expect the six behaviour cases to fail there: Step 3 ships the whole inspector half in one go — the export, the params, `setInspector` and its binding — and Step 1 has already seeded the rail into this file's own `SHELL`, so they go green as soon as the module lands. The single case still red is `index.html: the collapse handle is a SIBLING of the inspector host`, because `#composer-ins-rail` does not exist in the real file yet. **That one failure is Step 4's red.** Only then proceed to Step 4.

- [ ] **Step 3: Extend the chrome module**

In `ui/public/graph/composer-chrome.mjs`, add the key export below `DRAWER_KEY`:

```js
/** 'open' | 'collapsed' — the right rail's disclosure, same sticky contract.
 *  Unlike the drawer it has NO template-derived default: a rail the user
 *  collapsed stays collapsed, and syncDefault() never touches it. */
export const INSPECTOR_KEY = 'worca-cc.composer.inspector';
```

Add two params to the factory's destructuring, after `filter = null,`:

```js
  body = null,
  insToggle = null,
```

and document them in the JSDoc block:

```js
 * @param {Element}  [opts.body]      #composer-body — carries data-inspector
 * @param {Element}  [opts.insToggle] #composer-inspector-toggle
```

Add the inspector half immediately before the block of `addEventListener` calls:

```js
  const insOpen = () => !body || body.dataset.inspector !== 'collapsed';

  function setInspector(open, { persist = false } = {}) {
    if (!body) return;
    body.dataset.inspector = open ? 'open' : 'collapsed';
    if (insToggle) {
      insToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      insToggle.setAttribute('aria-label', open ? 'Collapse inspector' : 'Expand inspector');
    }
    if (persist) writeKey(storage, INSPECTOR_KEY, open ? 'open' : 'collapsed');
  }

  function onInsToggleClick() {
    setInspector(!insOpen(), { persist: true });
  }
```

Bind and initialise it alongside the rest, so the tail of the setup reads:

```js
  if (toggle) toggle.addEventListener('click', onToggleClick);
  if (drawer) drawer.addEventListener('keydown', onDrawerKeyDown);
  if (canvas) canvas.addEventListener('pointerdown', onCanvasPointerDown);
  if (filter) filter.addEventListener('input', onFilterInput);
  if (insToggle) insToggle.addEventListener('click', onInsToggleClick);
  syncDefault();
  setInspector(readKey(storage, INSPECTOR_KEY) !== 'collapsed');
```

and unbind it in `destroy()`:

```js
      if (insToggle) insToggle.removeEventListener('click', onInsToggleClick);
```

- [ ] **Step 4: Wrap the inspector in the markup**

In `ui/public/index.html`, inside `#composer-body`, replace **both** the `<!-- Right rail: the selected node's / wire's inspector. -->` comment line **and** the `<aside class="gv-inspector" id="composer-inspector"></aside>` line below it with:

```html
              <!-- Right rail: the selected node's / wire's inspector. The handle is
                   a SIBLING of the host, never a child — renderInspector() calls
                   replaceChildren() on #composer-inspector on every repaint. -->
              <div class="gv-ins-rail" id="composer-ins-rail">
                <button type="button" class="gv-ins-handle" id="composer-inspector-toggle"
                        aria-expanded="true" aria-controls="composer-inspector"
                        aria-label="Collapse inspector">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" stroke-width="2.6" stroke-linecap="round"
                       stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 6l-6 6 6 6"></path></svg>
                </button>
                <aside class="gv-inspector" id="composer-inspector"></aside>
              </div>
```

(Following the instruction literally without removing the old comment would leave two "Right rail" comments.)

- [ ] **Step 5: Add the rail CSS**

In `ui/public/style.css`, replace the old line 878 — Task 3's edits have already pushed it down by about 76 lines, so look for it near **942**. It reads exactly:

```css
.gv-inspector{width:280px;flex:0 0 280px;border-left:1px solid var(--line);display:flex;flex-direction:column;min-height:0;overflow:auto;}
```

with:

```css
/* The rail owns the width, the border and the collapse transition;
   #composer-inspector stays the pure scroll host the editor replaceChildren()es,
   so it keeps its id and its role. Its display:flex / flex-direction:column /
   min-height:0 / overflow:auto carry over VERBATIM from the old rule — only
   width / flex / border-left move up to the wrapper. .ins-panel (the next rule
   down) is written as a column-flex child of a column-flex parent, so dropping
   display:flex here would be a silent regression.
   The transition is on flex-basis, which is what actually sizes a flex item
   whose basis is not auto. It is safe for pointer maths: the canvas is
   LEFT-anchored, so getBoundingClientRect().left is invariant while the right
   edge animates and toWorld() stays accurate at every frame. The reduced-motion
   block at style.css:655 already neutralises it for users who ask. */
.gv-ins-rail{position:relative;flex:0 0 280px;width:280px;border-left:1px solid var(--line);
  display:flex;flex-direction:column;min-height:0;transition:flex-basis var(--t-fast,120ms);}
.gv-inspector{flex:1 1 auto;display:flex;flex-direction:column;min-height:0;overflow:auto;}
/* The handle straddles the rail's left edge, OVERHANGING the canvas. It cannot
   sit flush: absolute offsets resolve against the rail's PADDING box, so
   left:-1px would put a 22px handle at border-box x 0..22, while .ins-head's
   18px inset plus the rail's 1px border puts the inspector title at x=19 — it
   would clip the first 3px of every selected node's name, and of .ins-body's
   fields at every other vertical band. z-index 5 keeps it above the canvas
   decorations (.gv-empty / .gv-legend / .gv-zoom are 4) and below the drawer (7).
   padding:0 is required: a UA <button>'s own padding would decentre the
   grid-centred SVG inside the fixed 22x30 box. */
.gv-ins-handle{position:absolute;top:10px;left:-12px;width:22px;height:30px;z-index:5;
  border:1px solid var(--line);border-radius:9px;background:var(--panel);
  color:var(--ink-3);display:grid;place-items:center;cursor:pointer;padding:0;
  box-shadow:var(--shadow-soft);}
.gv-ins-handle:hover{color:var(--ink);background:var(--field);}
.gv-ins-handle:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.gv-ins-handle svg{transition:transform var(--t-fast,120ms);}

.gv-body[data-inspector="collapsed"] .gv-ins-rail{flex:0 0 28px;width:28px;}
.gv-body[data-inspector="collapsed"] .gv-inspector{display:none;}
/* 3px each side inside the 28px strip: `left` resolves against the padding box,
   which starts 1px in, so 2px — not 3 — is the centred value. */
.gv-body[data-inspector="collapsed"] .gv-ins-handle{left:2px;}
.gv-body[data-inspector="collapsed"] .gv-ins-handle svg{transform:rotate(180deg);}
```

- [ ] **Step 6: Wire it up in `app.js`**

In `initComposer()`, next to the Task 3 lookups:

```js
  composer.els.insTog = $('#composer-inspector-toggle');
```

and add two params to the `createComposerChrome({ ... })` call:

```js
      body: composer.els.body,
      insToggle: composer.els.insTog,
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --test test/ui-composer-chrome.test.mjs test/ui-composer-chrome-app.test.mjs test/ui-composer-editor.test.mjs test/ui-agent-xss.test.mjs test/ui-boot.test.mjs`

Expected: PASS — **35** in the chrome file, and everything else unchanged (5 + 37 + 3 + 1 = 46; **81** total for this command).

- [ ] **Step 8: Run the full suite**

Run: `npm test`

Expected: `2482 + 35 + 5 + 3` = **2525 tests / 2521 pass / 4 fail**, and the failure list byte-identical to the baseline's.

- [ ] **Step 9: Verify in the real app**

Open the Composer view and confirm:
- The `‹` handle sits as a rounded tab straddling the rail's left edge, clear of the inspector title; clicking it shrinks the rail to a 28px strip, the tab re-centres in the strip and the chevron flips to `›`.
- **Selecting a node shows its name in full — the handle covers no text.**
- The canvas grows to roughly the full card width. Only the 280→28px strip animates: `.gv-inspector` gets `display:none` on the same frame, so the panel's *contents* vanish instantly. That is expected, not a failed transition.
- Selecting a node while collapsed does **not** force the rail open; expanding it shows that node's inspector, correctly rendered.
- A reload restores the collapsed rail.
- Collapsing the drawer and the rail together gives the maximum canvas, and the graph is still pannable and zoomable in that state.

- [ ] **Step 10: Commit**

```bash
git add ui/public/graph/composer-chrome.mjs ui/public/index.html ui/public/style.css \
        ui/public/app.js test/ui-composer-chrome.test.mjs
git commit -m "feat(composer): make the inspector rail collapsible"
```

---

## Done when

- `npm test` shows only the 4 known failures (`skills-bundle` ×2, `skills-gate-wiring` ×2).
- `ui-composer-wires`, `ui-composer-save`, `ui-agent-xss`, `ui-boot` and every pre-existing case in `ui-composer-editor` pass with no edits; `ui-composer-editor` gains exactly **three** cases (spawn inset, fit inset, spawn cascade).
- At a 1440px window the composer canvas measures ~796px with the inspector open and ~1048px with it collapsed, against ~532px before.
- The empty-state hint is visible on a blank canvas with the drawer open.
- Adding several agents in a row works without touching the toggle: the panel keeps its scroll position and the cards cascade instead of stacking.
- With the drawer open, "fit to screen" leaves no node under the panel.
- With no stored key, a click on the visible canvas dismisses the drawer and a reload brings it back **open** — a light dismiss is not a preference.
- Escape in a non-empty filter clears the filter; a second Escape collapses the drawer, and that **does** persist.
- The drawer survives "New canvas" and opening a saved pipeline, its toggle still works after both, and its default follows the loaded template until the user toggles once.
- Selecting a node with the inspector open shows the node name unclipped.
- Drawer and inspector states both survive a page reload.

---

## Deliberately excluded

Everything the design spec §11 excludes still stands (auto-hide on deselect, drag-and-drop from pill to canvas, a viewport-driven card height, moving the domain chips into the bar). In addition, these were found during review and are **not** fixed here — do not "helpfully" repair them:

- **`editor.destroy()` leaks two listeners.** It removes the canvas / document / palette / inspector listeners but not the `input` on `#composer-agent-filter` or the `click` on `#composer-save`, both bound to persistent `index.html` elements — so every `composerLoadTemplate()` stacks another pair. Pre-existing and benign (last-registered wins for both `replaceChildren` and `applyFilter`), and touching it risks `ui-composer-save`.
- **`filter.value` survives an editor rebuild** while the new editor starts at `query = ''`, so the field can show a query that is not applied. Same pre-existing wart, same reason.
- **`.ap` and `.pal-chip` have no `font-family:inherit`** (`style.css:776`, `765`/`1268`), so agent names and domain chips render in the UA button font rather than the app's. Pre-existing across the whole palette; the drawer makes it more visible but does not cause it. Worth a follow-up, not a smuggled-in change.
- **`.pal-chip` and `.pal-chip.off` are duplicated** at 765/1268 and 766/1269, the same footgun as `.pal-chips`; the 1268 copy is the one supplying `border`, `cursor` and `text-transform`. Noted so the next person is not surprised.
- **The reason chip is hidden under an open panel** now that the drawer is `z-index:7`. Accepted: any drop target under the panel is unseeable anyway, and canvas artifacts painting on top of opaque chrome reads as broken.
- **Collapsing the inspector does not auto-`fit()`**, and no `ResizeObserver` is added. The renderer never measures (`graph-view.mjs:11`) and every gesture reads the rect at event time, so a wider canvas needs no re-render — and moving the user's viewport as a side effect of a chrome toggle is exactly the defect D6 rejected auto-hide for.

---

## Decisions log

Settled during the v2 review. Each is a verdict, not an open question.

1. **The chrome is constructed before `await refreshComposerPalette()`, guarded by `if (!composer.chrome)`, and `syncDefault()` runs at the end of `initComposer()` as well as at the end of `composerLoadTemplate()`.** The editor never needs the chrome at construction — `canvasInsetTop` is a closure reached only from `centerWorld()`/`fit()` — so v1's stated ordering constraint was invented. The pre-await guard is set before any suspension point, which is what makes it real idempotence, and it applies a stored `'closed'` on the first paint instead of after a network round-trip.
2. **`syncDefault()` runs on every composer view entry, not only after a template load.** It is inert the moment a key exists, so re-evaluating is faithful to D5 and costs nothing.
3. **`hasAgents = nodes.some(n => n.kind === 'agent')` is correct as written.** `graph-model.mjs:441` fixes the kind set to `{agent, task, and, or, combine, end}` and `newNode` assigns `key` only to agents.
4. **The empty-state banner is cleared by CSS alone** — `.gv-drawer[data-open="true"] ~ .gv-body .gv-empty{top:264px}` — not by mirroring the drawer state onto `#composer-body` in JS. jsdom applies no stylesheet, so a `data-drawer` attribute test would assert the attribute, not the effect: a tautology. The stylesheet is asserted as text instead, which is the house pattern for exactly this.
5. **Escape is two-stage: a non-empty filter clears first (with `preventDefault`), and only a second Escape collapses the drawer.** Standard search-input convention, and it deterministically defeats the UA's own `input[type=search]` clear rather than racing it.
6. **The Escape collapse persists; the canvas light dismiss and the filter auto-open do not.** Escape aimed at the drawer is a manual toggle, which D5 says wins from then on. A canvas press and a keystroke in the filter are statements about the graph and about searching — the same reasoning that exempts pill clicks.
7. **`stopPropagation`, not `stopImmediatePropagation`.** The narrower call would not reach the editor's listener at all, and the five other document-level Escape handlers in `app.js` cannot be open over the composer.
8. **Focus is rescued to the toggle only when `document.activeElement` is inside the panel.** The bar stays visible when collapsed; pulling focus out of a still-visible input is user-hostile and unnecessary.
9. **`fit()` fits into the visible band and offsets the origin by the inset.** Zoom-fit is bottom-right and therefore clickable while the drawer is open; leaving it un-inset makes the obvious recovery action hide the graph.
10. **`spawn()` cascades off an occupied slot** by `SNAP * 2` per step, up to 24 tries; `spawn(entry, at)` is untouched.
11. **`renderPalette()` preserves `paletteHost.scrollTop`.** The palette host *is* the 240px scroll container now. Manual-verify only — jsdom has no layout.
12. **`.gv-drawer` is `z-index:7`.** `.gv-chip` is 6 and nothing between it and the root creates a stacking context.
13. **`min-height:685px`, correcting the spec's 684.** The drawer's `border-bottom` is additive to the 44px bar because its height is `auto`.
14. **`.gv-inspector` keeps `display:flex;flex-direction:column`**, and `.gv-ins-rail` keeps the spec's `transition:flex-basis`. The animation is safe for pointer maths because the canvas is left-anchored.
15. **The inspector handle overhangs the canvas at `left:-12px`.** Any handle wider than 18px sitting flush at `left:-1px` clips the inspector's 18px-inset content, at some vertical band or other — moving it vertically does not help.
16. **The sticky-chips rule lives in the composer block, not at the bottom of the file.** It wins on specificity, so the "must come after line 1267" reasoning was never load-bearing — and following it verbatim would have filed the rule inside the Projects-view block.
17. **Spec §2's "the editor is constructed once" is superseded** by §7.1 and by this plan: `composerLoadTemplate()` destroys and rebuilds it. Where the spec and this plan disagree, this plan wins; the divergences are listed in "What changed from v1".
18. **The `data-open` / `data-inspector` attribute pattern is a deliberate departure** from the app's usual `hidden` attribute + `[aria-expanded] .chev` idiom (`app.js:2431`, `style.css:508/607/1089`). It keeps JS from writing to a host the editor owns. Do not "align" it.
19. **`aria-controls` pointing at a `display:none` panel needs no `hidden` or `inert`.** `display:none` already removes the subtree from the accessibility tree and the tab order; `aria-expanded` carries the state.
20. **`.pills` uses `minmax(min(196px,100%),1fr)`**, not spec §4.3's bare `minmax(196px,1fr)`. The `min()` floor stops a narrow card from forcing a horizontal scrollbar inside `.builder-card{overflow:hidden}`. Column count at 1440 is unchanged: 5.
21. **`onFilterInput` guards on `filter.value`, not just `!isOpen()`.** See B9 — the empty-value `input` that Blink and WebKit emit when they clear the field is a *dismissal*, not a search, and must not open anything.
22. **`setInspector` does NOT mirror the drawer's focus rescue.** The drawer needs it because Escape can collapse the panel while focus is inside it; the rail can only be collapsed by activating its handle, which focuses the handle first, so there is no reachable path that strands focus in the hidden host. Untested code for an unreachable case is worse than the omission — if a keyboard shortcut for the rail is ever added, add the rescue and a case with it.
23. **The `-0` in the `fit()` regression literal is deliberate.** `-b.x * zoom` with `b.x === 0` is negative zero, and `assert/strict`'s deep equality is SameValue, which distinguishes it from `0`.

