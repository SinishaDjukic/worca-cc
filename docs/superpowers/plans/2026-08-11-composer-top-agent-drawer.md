# Composer Top Agent Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Pipeline Composer's agent palette from a fixed 264px left rail to a collapsible full-width drawer at the top of the builder card, and make the inspector rail collapsible — taking the canvas from ~532px to ~796px, or ~1048px with the inspector closed.

**Architecture:** Pure UI-chrome change. A new `composer-chrome.mjs` module owns drawer and inspector disclosure state plus its `localStorage` persistence, and nothing else — it never touches the graph template, so it survives the editor teardown/rebuild that `composerLoadTemplate()` performs. `composer-editor.mjs` gains exactly one new optional dependency (`canvasInsetTop`) so a pill-spawned node is not placed underneath the open overlay. `#composer-palette` and `#composer-inspector` keep their ids and their exact rendered subtrees, so `renderPalette()`, `applyFilter()`, `onPaletteClick` and `renderInspector()` are not modified and every existing composer test passes untouched.

**Tech Stack:** Vanilla ES modules, no framework, no build step. `ui/public/index.html` + `ui/public/style.css` + `ui/public/graph/*.mjs`. Tests are `node:test` + `assert/strict` + `jsdom`, run with `npm test`.

**Design spec:** `docs/superpowers/specs/2026-08-11-composer-top-agent-drawer-design.md`

## Global Constraints

- **Never `git commit` the spec or this plan.** `docs/` is untracked by project convention. Commit only source and test files.
- **Test baseline:** `npm test` currently has **4 pre-existing failures in the imagegen-skill suite**. A run is green if and only if those 4 are the only failures. Never "fix" them as part of this work.
- **The compatibility invariant:** `#composer-palette` keeps its id, keeps being the element passed as the editor's `opts.palette`, and keeps the exact `.pal-chips` / `.pal-group` / `.pills` / `.ap` subtree that `renderPalette()` produces. `#composer-inspector` keeps its id and stays `opts.inspector`. These tests must pass **with no edits**: `test/ui-composer-editor.test.mjs` (except the one case added in Task 2), `test/ui-composer-wires.test.mjs`, `test/ui-composer-save.test.mjs`, `test/ui-agent-xss.test.mjs`, `test/ui-boot.test.mjs`. If one of them needs changing, the markup is wrong — fix the markup, not the test.
- **Do not touch:** `graph-model.mjs`, `graph-geometry.mjs`, `graph-layout.mjs`, `graph-view.mjs`, `inspector.mjs`, `agents-meta.mjs`, `run-decor.mjs`, `thumbnail.mjs`, `save-dialog.mjs`, or any server-side module. Node and port sizing lives in `graph-geometry.mjs`; changing a size in CSS would desync wiring from pixels.
- **`localStorage` keys** follow the existing `worca-cc.*` convention (see `app.js:3532`): `worca-cc.composer.drawer` (`'open' | 'closed'`) and `worca-cc.composer.inspector` (`'open' | 'collapsed'`). Every read and write is wrapped in `try/catch` — private browsing mode throws, exactly as guarded at `app.js:3548`.
- **CSS custom properties** already defined by the stylesheet and used below: `--line`, `--line-2`, `--ink`, `--ink-2`, `--ink-3`, `--field`, `--panel`, `--shadow`, `--shadow-soft`, `--t-fast`. Do not invent new ones.
- Run the full suite (`npm test`) before every commit, not just the file you touched.

---

## File Structure

| File | Responsibility |
|---|---|
| `ui/public/graph/composer-chrome.mjs` | **New.** Drawer + inspector disclosure state, persistence, scoped Escape, `canvasInsetTop()`. Owns no graph state. |
| `test/ui-composer-chrome.test.mjs` | **New.** Unit tests for the above, plus markup assertions against the real `index.html`. |
| `ui/public/graph/composer-editor.mjs` | Modified in **one place only**: the `canvasInsetTop` opt and `centerWorld()`. |
| `ui/public/index.html` | `.builder-card` subtree restructured from a 3-column row to drawer-over-body. |
| `ui/public/style.css` | The `Pipeline Composer v2` block (from line 750) — rail rules replaced by drawer rules; inspector collapse rules. |
| `ui/public/app.js` | `initComposer()` element lookups + chrome construction; `canvasInsetTop` at both `createComposerEditor` call sites; `syncDefault()` in `composerLoadTemplate()`. |
| `test/ui-composer-editor.test.mjs` | One added case (Task 2). Nothing else. |

**Task order and why:** Task 1 builds the chrome module in isolation (nothing wired, nothing visible). Task 2 makes the editor accept an inset with a no-op default. Task 3 restructures the markup, ships the drawer CSS and wires it — at the end of Task 3 the drawer works end to end. Task 4 does the same vertical slice for the inspector. Tasks 3 and 4 each leave the app in a working, shippable state.

---

## Task 1: The chrome module — drawer half

Builds `composer-chrome.mjs` with the drawer's state machine, persistence, scoped Escape and `canvasInsetTop()`. Nothing in the app calls it yet; this task's deliverable is a tested module.

**Files:**
- Create: `ui/public/graph/composer-chrome.mjs`
- Test: `test/ui-composer-chrome.test.mjs` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const DRAWER_KEY = 'worca-cc.composer.drawer'`
  - `export function createComposerChrome({ drawer, toggle, panel, storage, hasAgents }) → { canvasInsetTop(): number, syncDefault(): void, destroy(): void }`
  - No `doc` param: the module only ever touches elements it is handed, and never creates one.
  - Task 3 calls `createComposerChrome` from `app.js`; Task 3 and Task 4 both rely on the returned `canvasInsetTop` / `syncDefault` / `destroy` names.
  - Task 4 extends the same factory with `body` and `insToggle` params and an `INSPECTOR_KEY` export.

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
// preloads a Task and an End node, so a node-count default would collapse the
// drawer on exactly the blank canvas it is supposed to open on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createComposerChrome, DRAWER_KEY } from '../ui/public/graph/composer-chrome.mjs';

const SHELL = `<!doctype html><body>
  <section class="card builder-card">
    <div class="gv-drawer" id="drawer" data-open="true">
      <div class="gv-drawer-bar">
        <button id="toggle" type="button" aria-expanded="true" aria-controls="palette">Agents</button>
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
  };
  // jsdom answers zeros for every rect, so the panel's height is stubbed.
  els.panel.getBoundingClientRect = () => ({
    height: panelHeight, width: 1046, top: 44, left: 0, right: 1046, bottom: 44 + panelHeight,
  });
  const chrome = createComposerChrome({
    drawer: els.drawer, toggle: els.toggle, panel: els.panel, storage, hasAgents,
  });
  return { window, doc, els, chrome, storage };
}

const click = (window, el) =>
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const esc = (window, el) =>
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

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
  // default would read that as "populated" and wrongly collapse.
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

test('Escape inside the drawer collapses it, stops propagating, and rescues focus', () => {
  const { window, doc, els, storage } = boot({ hasAgents: () => false });
  // The editor binds Escape on the DOCUMENT to deselect (composer-editor.mjs:686).
  // The drawer's own Escape must not also trigger that.
  let reachedDocument = false;
  doc.addEventListener('keydown', () => { reachedDocument = true; });

  els.filter.focus();
  esc(window, els.filter);

  assert.equal(isOpen(els), false);
  assert.equal(reachedDocument, false, 'stopPropagation kept it off the document');
  assert.equal(doc.activeElement, els.toggle, 'focus is not stranded in the hidden panel');
  assert.equal(storage.read(DRAWER_KEY), 'closed');
});

test('Escape from the canvas leaves the drawer alone and reaches the document', () => {
  const { window, doc, els } = boot({ hasAgents: () => false });
  let reachedDocument = false;
  doc.addEventListener('keydown', () => { reachedDocument = true; });

  esc(window, els.canvas);

  assert.equal(isOpen(els), true, 'the drawer only answers Escape from inside itself');
  assert.equal(reachedDocument, true, 'the editor still gets its deselect');
});

test('clicking a pill leaves the drawer open — several agents in a row', () => {
  const { window, els, storage } = boot({ hasAgents: () => false });
  click(window, els.pill);
  assert.equal(isOpen(els), true);
  assert.equal(storage.read(DRAWER_KEY), null, 'a pill click is not a disclosure decision');
});

test('canvasInsetTop() is the panel height when open and 0 when closed', () => {
  const { window, els, chrome } = boot({ hasAgents: () => false, panelHeight: 240 });
  assert.equal(chrome.canvasInsetTop(), 240);
  click(window, els.toggle);
  assert.equal(chrome.canvasInsetTop(), 0);
});

test('a throwing Storage (private mode) degrades to the defaults', () => {
  const boom = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('SecurityError'); },
    read: () => null,
  };
  const { window, els } = boot({ storage: boom, hasAgents: () => false });
  assert.equal(isOpen(els), true, 'an unreadable key falls through to the default');
  assert.doesNotThrow(() => click(window, els.toggle), 'an unwritable key does not break the toggle');
  assert.equal(isOpen(els), false, 'the in-memory state still flips');
});

test('destroy() unbinds the toggle and the scoped Escape', () => {
  const { window, els, chrome } = boot({ hasAgents: () => false });
  chrome.destroy();
  click(window, els.toggle);
  assert.equal(isOpen(els), true, 'the toggle is inert after destroy');
  els.filter.focus();
  esc(window, els.filter);
  assert.equal(isOpen(els), true, 'Escape is inert after destroy');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --test test/ui-composer-chrome.test.mjs`

Expected: FAIL — `Cannot find module '.../ui/public/graph/composer-chrome.mjs'`.

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
// owns a document-level Escape (deselect, composer-editor.mjs:686). A second
// document listener would fire both.

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
 * @param {Storage}  [opts.storage]   defaults to globalThis.localStorage
 * @param {Function} [opts.hasAgents] () => boolean, consulted ONLY while no key is stored
 * @returns {{ canvasInsetTop(): number, syncDefault(): void, destroy(): void }}
 */
export function createComposerChrome({
  drawer = null,
  toggle = null,
  panel = null,
  storage = defaultStorage(),
  hasAgents = () => false,
} = {}) {
  const isOpen = () => Boolean(drawer) && drawer.dataset.open === 'true';

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
    ev.stopPropagation();                       // the editor's deselect must not also fire
    if (toggle && toggle.focus) toggle.focus(); // never strand focus in a hidden subtree
    setDrawer(false, { persist: true });
  }

  if (toggle) toggle.addEventListener('click', onToggleClick);
  if (drawer) drawer.addEventListener('keydown', onDrawerKeyDown);
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
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --test test/ui-composer-chrome.test.mjs`

Expected: PASS, 11/11.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: only the 4 known imagegen-skill failures.

- [ ] **Step 6: Commit**

```bash
git add ui/public/graph/composer-chrome.mjs test/ui-composer-chrome.test.mjs
git commit -m "feat(composer): add chrome module for the agent drawer's disclosure state"
```

---

## Task 2: Editor accepts a canvas top inset

With the drawer overlaying the canvas's top ~240px, `centerWorld()` — which centres a pill-spawned node on the *raw* canvas rect — can drop a node underneath the panel the user just clicked. The editor takes one optional callback and centres on the visible region instead. The default `() => 0` reproduces today's arithmetic exactly.

**Files:**
- Modify: `ui/public/graph/composer-editor.mjs` — JSDoc block near line 94, the destructuring at line 101, and `centerWorld()` at lines 437-441
- Test: `test/ui-composer-editor.test.mjs` — extend the `boot()` helper (line 37) and add one case

**Interfaces:**
- Consumes: nothing from Task 1 (this task is independent of it).
- Produces: `createComposerEditor` accepts `opts.canvasInsetTop?: () => number`, default `() => 0`. Task 3 passes `() => composer.chrome ? composer.chrome.canvasInsetTop() : 0` at both call sites.

---

- [ ] **Step 1: Extend the test helper**

In `test/ui-composer-editor.test.mjs`, the `boot()` helper currently destructures `{ template = null, onSave = () => {}, agents = palette }`. Add the new option and forward it:

```js
function boot({ template = null, onSave = () => {}, agents = palette, canvasInsetTop } = {}) {
```

and in the `createComposerEditor({ ... })` call inside `boot`, add one line alongside `template,` and `onSave,`:

```js
    canvasInsetTop,
```

Passing `undefined` when the option is absent leaves every existing test on the editor's own `() => 0` default, so no existing case changes behaviour.

- [ ] **Step 2: Write the failing test**

Append to `test/ui-composer-editor.test.mjs`:

```js
test('a palette spawn clears the drawer overlay when canvasInsetTop reports one', () => {
  // jsdom zeroes every rect, so the canvas rect is stubbed to a real 800x600 box.
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --test test/ui-composer-editor.test.mjs`

Expected: FAIL — the `() => 200` case returns `242`, because the option is ignored.

- [ ] **Step 4: Implement**

In `ui/public/graph/composer-editor.mjs`, add the JSDoc line after the `@param {HTMLInputElement} [opts.filter]` line (~line 94):

```js
 * @param {Function} [opts.canvasInsetTop] px of canvas hidden under open chrome (the top drawer)
```

Add to the destructured options, immediately after `filter = null,` (~line 101):

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

- [ ] **Step 5: Run the test to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --test test/ui-composer-editor.test.mjs`

Expected: PASS, including every pre-existing case.

- [ ] **Step 6: Run the full suite**

Run: `npm test`

Expected: only the 4 known imagegen-skill failures.

- [ ] **Step 7: Commit**

```bash
git add ui/public/graph/composer-editor.mjs test/ui-composer-editor.test.mjs
git commit -m "feat(composer): centre pill spawns on the canvas band the drawer leaves visible"
```

---

## Task 3: Ship the drawer — markup, CSS, wiring

The vertical slice that makes the drawer real. At the end of this task the palette is a working top drawer and the canvas is ~796px wide. The inspector rail is untouched and still 280px.

**Files:**
- Modify: `ui/public/index.html:793-810`
- Modify: `ui/public/style.css` — lines 756, 759-763, 775; add a sticky-chips rule after line 1267
- Modify: `ui/public/app.js` — `initComposer()` at 1655, `composerLoadTemplate()` at 1717
- Test: `test/ui-composer-chrome.test.mjs` — append a markup-assertion block

**Interfaces:**
- Consumes: `createComposerChrome` and its `{ canvasInsetTop, syncDefault, destroy }` return from Task 1; `opts.canvasInsetTop` from Task 2.
- Produces: the ids `#composer-drawer`, `#composer-drawer-toggle`, `#composer-body`, and `composer.chrome` on the app's composer state object. Task 4 adds `#composer-ins-rail` and `#composer-inspector-toggle` next to them.

---

- [ ] **Step 1: Write the failing markup test**

Append to `test/ui-composer-chrome.test.mjs`. Add these two imports at the top of the file, alongside the existing ones:

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
```

and append at the end of the file:

```js
// --- the real index.html ----------------------------------------------------
// The drawer is only a layout change: #composer-palette keeps its id and its
// rendered subtree, so renderPalette/applyFilter/onPaletteClick are untouched
// and ui-agent-xss's `#composer-palette .ap[data-key]` query still resolves.

const REAL_HTML = readFileSync(
  fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8',
);
const realDoc = new JSDOM(REAL_HTML).window.document;

test('index.html: the 264px palette rail is gone', () => {
  assert.equal(realDoc.querySelector('.gv-palette'), null);
  assert.equal(realDoc.querySelector('.gv-palette-top'), null);
});

test('index.html: the palette host lives inside the drawer, with its id intact', () => {
  const panel = realDoc.querySelector('#composer-palette');
  assert.ok(panel, '#composer-palette still exists');
  assert.ok(panel.closest('#composer-drawer'), 'it is inside the drawer');
  assert.ok(panel.classList.contains('gv-palette-scroll'));
});

test('index.html: the filter moved into the drawer bar and kept its id', () => {
  const filter = realDoc.querySelector('#composer-agent-filter');
  assert.ok(filter, '#composer-agent-filter still exists');
  assert.ok(filter.closest('.gv-drawer-bar'), 'it is in the bar');
});

test('index.html: the toggle is wired to the panel for assistive tech', () => {
  const toggle = realDoc.querySelector('#composer-drawer-toggle');
  assert.ok(toggle);
  assert.equal(toggle.getAttribute('aria-controls'), 'composer-palette');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
});

test('index.html: canvas and inspector are siblings inside the body row', () => {
  const body = realDoc.querySelector('#composer-body');
  assert.ok(body, '#composer-body exists');
  assert.ok(realDoc.querySelector('#composer-canvas').closest('#composer-body'));
  assert.ok(realDoc.querySelector('#composer-inspector').closest('#composer-body'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --test test/ui-composer-chrome.test.mjs`

Expected: FAIL on all 5 new cases — `.gv-palette` still exists, `#composer-drawer` does not.

- [ ] **Step 3: Restructure the markup**

In `ui/public/index.html`, replace lines 793-810 (the `<section class="card builder-card">` block) with:

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
                       stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>
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

- [ ] **Step 4: Replace the rail CSS with drawer CSS**

In `ui/public/style.css`:

Replace line 756 with:

```css
/* Column: the drawer bar sits above the canvas + inspector row. 684 = the old
   640px canvas plus the 44px bar, so the canvas keeps every pixel it had. */
.builder-card{padding:0;overflow:hidden;display:flex;flex-direction:column;min-height:684px;}
.gv-body{flex:1 1 auto;display:flex;min-height:0;}
```

Replace lines 759-763 (`.gv-palette`, `.gv-palette-top`, its two `.pal-filter` rules, and `.gv-palette-scroll`) with:

```css
/* ---------- top agent drawer ---------- */
.gv-drawer{position:relative;z-index:5;border-bottom:1px solid var(--line);}
.gv-drawer-bar{height:44px;display:flex;align-items:center;gap:12px;padding:0 16px;}
.gv-drawer-toggle{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;
  color:var(--ink-2);background:none;border:0;padding:4px 6px;border-radius:9px;cursor:pointer;
  font-family:inherit;}
.gv-drawer-toggle:hover{background:var(--field);color:var(--ink);}
.gv-drawer-toggle:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.gv-drawer-toggle .chev{flex:0 0 14px;transition:transform var(--t-fast,120ms);}
.gv-drawer[data-open="false"] .gv-drawer-toggle .chev{transform:rotate(-90deg);}
.gv-drawer-bar .pal-filter{flex:1 1 auto;max-width:320px;height:32px;border:none;
  border-radius:11px;background:var(--field);padding:0 12px;font-size:12.5px;font-weight:500;
  color:var(--ink);font-family:inherit;}
.gv-drawer-bar .pal-filter::placeholder{color:var(--ink-3);}
/* Fixed height + internal scroll, and absolute so it overlays rather than
   reflows. The height is deliberate, not max-height: the panel stays 240px
   however many custom agents a user registers. */
.gv-palette-scroll{position:absolute;top:100%;left:0;right:0;height:240px;overflow-y:auto;
  padding:14px 16px 8px;background:var(--panel);border-bottom:1px solid var(--line);
  box-shadow:var(--shadow);}
.gv-drawer[data-open="false"] .gv-palette-scroll{display:none;}
```

Replace line 775 (`.pills`) with:

```css
/* Was a single column in the 264px rail; now wraps across the card width.
   1046px usable / minmax(196px) with an 8px gap = 5 pills per row at 1440. */
.pills{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:8px;}
```

Append **after line 1267** — the second, winning `.pal-chips` declaration — this rule:

```css
/* The chips are renderPalette()'s first child inside the scroll box, so they
   would scroll away. Pin them, cancelling the container's 14px top padding.
   This MUST sit after the .pal-chips declaration above, which overrides the
   one at line 764. */
.gv-palette-scroll .pal-chips{position:sticky;top:-14px;z-index:1;
  background:var(--panel);padding-top:14px;margin-top:-14px;}
```

- [ ] **Step 5: Wire it up in app.js**

In `initComposer()` (`app.js:1655`), add after the existing `composer.els.savedCount` lookup:

```js
  composer.els.drawer    = $('#composer-drawer');
  composer.els.drawerTog = $('#composer-drawer-toggle');
  composer.els.body      = $('#composer-body');
```

Inside the `if (!_composerReady) {` block, **before** the `composer.editor = createComposerEditor({` call — the editor needs `canvasInsetTop` at construction:

```js
    // Chrome is constructed ONCE and never destroyed: it owns no graph state, so
    // it survives the editor swaps composerLoadTemplate() performs. `hasAgents`
    // is a late-bound closure, safe to read composer.editor before it is set.
    composer.chrome = createComposerChrome({
      drawer: composer.els.drawer,
      toggle: composer.els.drawerTog,
      panel: composer.els.palette,
      hasAgents: () => Boolean(
        composer.editor?.template?.()?.nodes?.some((n) => n.kind === 'agent'),
      ),
    });
```

Add the import next to the existing `createComposerEditor` import (`app.js:71`):

```js
import { createComposerChrome } from './graph/composer-chrome.mjs';
```

Add this line to the options object of **both** `createComposerEditor(...)` calls — the one in `initComposer()` at line 1671 and the one in `composerLoadTemplate()` at line 1720. `composerLoadTemplate` destroys the editor and builds a fresh one on every "New canvas" and every saved-pipeline open; miss it and the spawn fix silently stops applying:

```js
      canvasInsetTop: () => (composer.chrome ? composer.chrome.canvasInsetTop() : 0),
```

At the end of `composerLoadTemplate()`, next to the existing `composerPaintDirty();`:

```js
  composer.chrome?.syncDefault();   // first-visit default only; a stored key wins
```

The `?.` is required: `initComposer` returns early when `#composer-canvas` is absent (partial DOM in tests) and leaves `composer.chrome` undefined.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --test test/ui-composer-chrome.test.mjs test/ui-composer-editor.test.mjs test/ui-agent-xss.test.mjs test/ui-boot.test.mjs`

Expected: PASS. `ui-agent-xss` and `ui-boot` boot the real `index.html`; they are the proof that the compatibility invariant held.

- [ ] **Step 7: Run the full suite**

Run: `npm test`

Expected: only the 4 known imagegen-skill failures. If `ui-composer-wires` or `ui-composer-save` broke, the markup violated the invariant — fix the markup.

- [ ] **Step 8: Verify in the real app**

Start the app and open the Composer view. Confirm, at a ~1440px window:
- The drawer bar spans the card; the panel below it is 240px tall and scrolls internally to reach the pinned Flow group.
- Pills wrap 5-across, each still showing its mono port line.
- Domain chips stay pinned at the top of the panel while it scrolls, and still toggle their section.
- The canvas is visibly wider than one node-pair; the zoom cluster and legend still sit at its corners.
- Clicking a pill places a node **below** the open panel, and the panel stays open.
- The toggle collapses the drawer; a reload restores the collapsed state.

- [ ] **Step 9: Commit**

```bash
git add ui/public/index.html ui/public/style.css ui/public/app.js test/ui-composer-chrome.test.mjs
git commit -m "feat(composer): move the agent palette into a collapsible top drawer"
```

---

## Task 4: Ship the inspector collapse

Same vertical slice for the right rail. The handle **cannot** be a child of `#composer-inspector`: `renderInspector()` calls `inspectorHost.replaceChildren(...)` on every repaint and would delete it. So the rail becomes a wrapper holding the handle and the untouched inspector host side by side.

**Files:**
- Modify: `ui/public/graph/composer-chrome.mjs` — add the inspector half
- Modify: `ui/public/index.html` — wrap the inspector
- Modify: `ui/public/style.css` — line 878 (`.gv-inspector`) plus new rail rules
- Modify: `ui/public/app.js` — two element lookups, two chrome params
- Test: `test/ui-composer-chrome.test.mjs` — append

**Interfaces:**
- Consumes: `createComposerChrome` from Task 1; `#composer-body` from Task 3.
- Produces: `export const INSPECTOR_KEY = 'worca-cc.composer.inspector'`; `createComposerChrome` additionally accepts `body` and `insToggle`.

---

- [ ] **Step 1: Write the failing tests**

In `test/ui-composer-chrome.test.mjs`, extend the import to pull in the new key:

```js
import { createComposerChrome, DRAWER_KEY, INSPECTOR_KEY } from '../ui/public/graph/composer-chrome.mjs';
```

Add the rail to `SHELL`, replacing the `<div class="gv-body" ...>` block:

```js
    <div class="gv-body" id="body" data-inspector="open">
      <div id="canvas" class="gv-canvas"></div>
      <div class="gv-ins-rail" id="rail">
        <button id="ins-toggle" type="button" aria-expanded="true"
                aria-controls="inspector" aria-label="Collapse inspector"></button>
        <aside id="inspector" class="gv-inspector"></aside>
      </div>
    </div>
```

Add the two new elements to `boot()`'s `els` object and pass them to the factory:

```js
    body: doc.getElementById('body'),
    insToggle: doc.getElementById('ins-toggle'),
    inspector: doc.getElementById('inspector'),
```

```js
  const chrome = createComposerChrome({
    drawer: els.drawer, toggle: els.toggle, panel: els.panel,
    body: els.body, insToggle: els.insToggle, storage, hasAgents,
  });
```

Append these cases:

```js
test('the inspector defaults to open when nothing is stored', () => {
  const { els } = boot();
  assert.equal(els.body.dataset.inspector, 'open');
  assert.equal(els.insToggle.getAttribute('aria-expanded'), 'true');
});

test('a stored inspector preference is restored', () => {
  const { els } = boot({ storage: memStorage({ [INSPECTOR_KEY]: 'collapsed' }) });
  assert.equal(els.body.dataset.inspector, 'collapsed');
  assert.equal(els.insToggle.getAttribute('aria-expanded'), 'false');
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
  click(window, els.insToggle);
  assert.equal(els.body.dataset.inspector, 'collapsed');
  assert.equal(isOpen(els), true, 'collapsing the rail did not touch the drawer');
  click(window, els.toggle);
  assert.equal(els.body.dataset.inspector, 'collapsed', 'and vice versa');
});

test('destroy() unbinds the inspector handle too', () => {
  const { window, els, chrome } = boot();
  chrome.destroy();
  click(window, els.insToggle);
  assert.equal(els.body.dataset.inspector, 'open');
});

test('index.html: the collapse handle is a SIBLING of the inspector host', () => {
  // renderInspector() calls replaceChildren() on #composer-inspector every
  // repaint — a handle inside it would be deleted on the first selection.
  const rail = realDoc.querySelector('#composer-ins-rail');
  assert.ok(rail, '#composer-ins-rail exists');
  const handle = realDoc.querySelector('#composer-inspector-toggle');
  assert.ok(handle, '#composer-inspector-toggle exists');
  assert.equal(handle.parentElement, rail, 'the handle hangs off the rail wrapper');
  assert.equal(realDoc.querySelector('#composer-inspector').children.length, 0,
    'the inspector host ships empty — the editor owns its contents');
  assert.equal(handle.getAttribute('aria-controls'), 'composer-inspector');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `WORCA_HOME=.worca-cc-test node --test test/ui-composer-chrome.test.mjs`

Expected: FAIL — `INSPECTOR_KEY` is `undefined` and `#composer-ins-rail` does not exist.

- [ ] **Step 3: Extend the chrome module**

In `ui/public/graph/composer-chrome.mjs`, add the key export below `DRAWER_KEY`:

```js
/** 'open' | 'collapsed' — the right rail's disclosure, same sticky contract. */
export const INSPECTOR_KEY = 'worca-cc.composer.inspector';
```

Add two params to the factory's destructuring, after `panel = null,`:

```js
  body = null,
  insToggle = null,
```

and document them in the JSDoc block:

```js
 * @param {Element}  [opts.body]      #composer-body — carries data-inspector
 * @param {Element}  [opts.insToggle] #composer-inspector-toggle
```

Add the inspector half, immediately before the `if (toggle) toggle.addEventListener(...)` lines:

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

Bind and initialise it alongside the drawer's, replacing the three lines that currently end the setup:

```js
  if (toggle) toggle.addEventListener('click', onToggleClick);
  if (drawer) drawer.addEventListener('keydown', onDrawerKeyDown);
  if (insToggle) insToggle.addEventListener('click', onInsToggleClick);
  syncDefault();
  setInspector(readKey(storage, INSPECTOR_KEY) !== 'collapsed');
```

and unbind it in `destroy()`:

```js
      if (insToggle) insToggle.removeEventListener('click', onInsToggleClick);
```

- [ ] **Step 4: Wrap the inspector in the markup**

In `ui/public/index.html`, replace the single inspector line inside `#composer-body`:

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
                       stroke-linejoin="round"><path d="M15 6l-6 6 6 6"></path></svg>
                </button>
                <aside class="gv-inspector" id="composer-inspector"></aside>
              </div>
```

- [ ] **Step 5: Add the rail CSS**

In `ui/public/style.css`, replace line 878 (`.gv-inspector`) with:

```css
/* The rail owns the width and the border; #composer-inspector stays the pure
   scroll host the editor replaceChildren()es, so it keeps its id and role. */
.gv-ins-rail{position:relative;flex:0 0 280px;width:280px;border-left:1px solid var(--line);
  display:flex;flex-direction:column;min-height:0;}
.gv-inspector{flex:1 1 auto;min-height:0;overflow:auto;}
.gv-ins-handle{position:absolute;top:10px;left:-1px;width:22px;height:30px;z-index:2;
  border:1px solid var(--line);border-left:0;border-radius:0 9px 9px 0;background:var(--panel);
  color:var(--ink-3);display:grid;place-items:center;cursor:pointer;padding:0;}
.gv-ins-handle:hover{color:var(--ink);background:var(--field);}
.gv-ins-handle:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.gv-ins-handle svg{transition:transform var(--t-fast,120ms);}

.gv-body[data-inspector="collapsed"] .gv-ins-rail{flex:0 0 28px;width:28px;}
.gv-body[data-inspector="collapsed"] .gv-inspector{display:none;}
.gv-body[data-inspector="collapsed"] .gv-ins-handle svg{transform:rotate(180deg);}
```

- [ ] **Step 6: Wire it up in app.js**

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

Run: `WORCA_HOME=.worca-cc-test node --test test/ui-composer-chrome.test.mjs test/ui-composer-editor.test.mjs test/ui-agent-xss.test.mjs test/ui-boot.test.mjs`

Expected: PASS.

- [ ] **Step 8: Run the full suite**

Run: `npm test`

Expected: only the 4 known imagegen-skill failures.

- [ ] **Step 9: Verify in the real app**

Open the Composer view and confirm:
- The `‹` handle sits at the rail's top-left; clicking it shrinks the rail to a 28px strip and the chevron flips to `›`.
- The canvas grows to roughly the full card width.
- Selecting a node while collapsed does **not** force the rail open; expanding it shows that node's inspector, correctly rendered.
- A reload restores the collapsed rail.
- Collapsing the drawer and the rail together gives the maximum canvas, and the graph is still pannable and zoomable in that state.

- [ ] **Step 10: Commit**

```bash
git add ui/public/graph/composer-chrome.mjs ui/public/index.html ui/public/style.css ui/public/app.js test/ui-composer-chrome.test.mjs
git commit -m "feat(composer): make the inspector rail collapsible"
```

---

## Done when

- `npm test` shows only the 4 known imagegen-skill failures.
- `test/ui-composer-editor.test.mjs`, `ui-composer-wires`, `ui-composer-save`, `ui-agent-xss` and `ui-boot` pass with no edits beyond Task 2's single added case.
- At a 1440px window the composer canvas measures ~796px with the inspector open and ~1048px with it collapsed, against ~532px before.
- Drawer and inspector states both survive a page reload.
