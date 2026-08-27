# Composer Agents Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Pipeline Composer's agent palette out of the collapsible top drawer that overlays the canvas and into its own always-expanded card below the canvas card, with 22px between every section.

**Architecture:** Three changes, in dependency order, each independently testable. First the editor stops correcting for a top overlay (`canvasInsetTop` is deleted from `composer-editor.mjs` and both `app.js` call sites). Then `composer-chrome.mjs` sheds every piece of drawer state, keeping only the inspector rail and an Escape-clears-the-filter shortcut. Last, `index.html` and `style.css` restructure: `.builder-card` becomes the canvas row alone, a new `.gv-palette-card` holds the head and the in-flow scroll host, and a `~ .card` rule puts 22px between the three cards.

**Tech Stack:** Vanilla ES modules, no build step. Tests are `node:test` + `assert/strict` + `jsdom`, run with `npm test`. Rules that jsdom cannot exercise (it applies no stylesheet) are asserted by reading `style.css` as text — the house pattern, see `test/ui-run-flow-css.test.mjs`.

## Global Constants

- Inter-card gap: **22px** — the house value (`.col{gap:22px}`, style.css:264; `.topbar{margin-bottom:22px}`, style.css:221).
- Canvas card min-height: **640px** = 638px canvas + `.card`'s two 1px borders. The visible canvas height (638) is unchanged from today.
- Agents card: head **52px**, scroll host **300px**, total 354px including the card's two borders.
- Agents card gutter: **18px** (the drawer's was 16px).
- Class names must be `.gv-palette-card`, `.gv-palette-head`, `.gv-palette-title`. **`.pal-head` is already taken** by an unrelated palette at style.css:1409 — do not reuse it.
- `#composer-palette` keeps its id, its `gv-palette-scroll` class, and its role as the exact subtree `renderPalette()` hands to `replaceChildren()`.
- `#composer-agent-filter` keeps its id and stays **outside** `#composer-palette`.
- `worca-cc.composer.drawer` becomes a dead localStorage key. Nothing reads it, nothing migrates it, nothing deletes it.
- Baseline: `npm test` currently has **4 pre-existing failures in the imagegen-skill suite**. Judge every run modulo those four; any other failure is yours.

**Spec:** `docs/superpowers/specs/2026-08-11-composer-agents-section-design.md`

**Files touched, and by which task:**

| File | T1 | T2 | T3 |
|---|---|---|---|
| `ui/public/graph/composer-editor.mjs` | ✓ | | |
| `ui/public/graph/composer-chrome.mjs` | | ✓ | |
| `ui/public/app.js` | ✓ | ✓ | |
| `ui/public/index.html` | | | ✓ |
| `ui/public/style.css` | | | ✓ |
| `test/ui-composer-editor.test.mjs` | ✓ | | |
| `test/ui-composer-chrome.test.mjs` | | ✓ | ✓ |
| `test/ui-composer-chrome-app.test.mjs` | ✓ | ✓ | ✓ |

`test/ui-composer-save.test.mjs` and `test/ui-composer-wires.test.mjs` were swept and contain **no** drawer references — leave them alone.

**Order is load-bearing.** Task 2 deletes `chrome.canvasInsetTop()`, and `app.js` calls it unguarded (`composer.chrome ? composer.chrome.canvasInsetTop() : 0` — the chrome is truthy, so a missing method throws on every spawn and every fit). Task 1 removes those call sites first.

---

### Task 1: The editor stops correcting for a top overlay

Nothing will overlay the canvas from above once the palette moves, so `canvasInsetTop` and its two consumers go. `canvasInsetRight` stays — the inspector rail still floats over the canvas's right edge.

**Files:**
- Modify: `ui/public/graph/composer-editor.mjs:95` (jsdoc), `:111` (param), `:473-485` (`centerWorld`), `:537-553` (`fit`)
- Modify: `ui/public/app.js:1707`, `:1759`
- Test: `test/ui-composer-editor.test.mjs:38-62` (`boot`), `:745-792` (two tests)
- Test: `test/ui-composer-chrome-app.test.mjs:167-188`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createComposerEditor({ ..., canvasInsetRight })` — the `canvasInsetTop` option no longer exists. Task 2 relies on `chrome.canvasInsetTop()` having no remaining callers.

- [ ] **Step 1: Rewrite the two failing editor tests**

In `test/ui-composer-editor.test.mjs`, replace the whole block from the `// --- the top drawer overlays the canvas ---` banner comment (line 745) through the end of the `fit() fits into the band the drawer leaves visible` test (line 792) with:

```js
// --- nothing overlays the canvas from above -----------------------------------
// The agent palette lives in its own card BELOW the canvas card, so the canvas
// rect IS the visible region again and spawn/fit need no top correction. These
// pin the arithmetic that used to be the `inset === 0` branch, so a
// re-introduced top inset would fail them. jsdom zeroes every rect, so each
// case stubs a real box.

test('a palette spawn centres on the full canvas height', () => {
  // A new canvas has no persisted view state, so the transform is identity and
  // client coords are world coords. snap() is the 11px half-grid: centre y 300,
  // minus the 60px header lead, snapped -> 242.
  const ctx = boot();
  ctx.els.canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600,
  });
  assert.equal(ctx.editor.spawn({ key: 'planner' }).y, 242);
});

test('fit() fits into the whole canvas box', () => {
  // These are the numbers fit() produces for a fresh Task+End canvas in an
  // 800x640 rect — b = {x:0, y:140, w:1240, h:230.5}, so
  // zoom = round(min(800/1240, 640/230.5) * 100) / 100 = 0.65 and y = -140*0.65.
  // `x` is -0 (`-b.x * zoom` with b.x === 0) and deepEqual is SameValue on
  // zeros, so write it as -0.
  const ctx = boot();
  ctx.els.canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 800, height: 640, right: 800, bottom: 640,
  });
  ctx.editor.fit();
  assert.deepEqual(ctx.editor.transform(), { x: -0, y: -91, zoom: 0.65 });
});
```

Then drop `canvasInsetTop` from the harness. At line 38 the signature becomes:

```js
function boot({ template = null, onSave = () => {}, agents = palette, canvasInsetRight } = {}) {
```

and at line 62 delete the lone `canvasInsetTop,` line from the `createComposerEditor({...})` literal, leaving `canvasInsetRight,`.

- [ ] **Step 2: Rewrite the two failing app-wiring tests**

In `test/ui-composer-chrome-app.test.mjs`, replace both tests at lines 167-188 with:

```js
test('app.js hands canvasInsetRight to BOTH createComposerEditor call sites', () => {
  // composerLoadTemplate() destroys the editor and builds a fresh one on every
  // "New canvas" and every saved-pipeline open. Miss it and the fix silently
  // stops applying — and no DOM assertion can see it, because jsdom reports a
  // zero-width rail, which clamps the inset to 0. Source text is the house
  // pattern for exactly this (test/ui-run-flow-css.test.mjs).
  const APP = readFileSync(appPath, 'utf8');
  const sites = APP.match(/createComposerEditor\(\{/g) || [];
  assert.equal(sites.length, 2, 'initComposer() and composerLoadTemplate()');
  const wired = APP.match(/canvasInsetRight: \(\) => \(composer\.chrome \? composer\.chrome\.canvasInsetRight\(\) : 0\)/g) || [];
  assert.equal(wired.length, 2, 'both sites, or the fix stops applying after a template load');
  assert.match(APP, /import \{ createComposerChrome \} from '\.\/graph\/composer-chrome\.mjs';/);
  assert.match(APP, /insRail: composer\.els\.insRail/, 'and the chrome can measure the rail');
});

test('app.js no longer corrects for a top overlay', () => {
  // The palette moved into its own in-flow card, so there is no overlay left to
  // clear. A returning `canvasInsetTop:` here would mean the drawer came back.
  const APP = readFileSync(appPath, 'utf8');
  assert.equal(/canvasInsetTop/.test(APP), false, 'nothing covers the canvas from above');
});
```

- [ ] **Step 3: Run the tests and watch them fail**

```bash
node --test test/ui-composer-editor.test.mjs test/ui-composer-chrome-app.test.mjs
```

Expected: `a palette spawn centres on the full canvas height` and `fit() fits into the whole canvas box` PASS already (they assert the inset-0 branch, which is what a stubbed-out `canvasInsetTop` produces), and `app.js no longer corrects for a top overlay` FAILS with `Expected values to be strictly equal: true !== false`. That one failure is the red.

- [ ] **Step 4: Delete the option from the editor**

In `ui/public/graph/composer-editor.mjs`, delete the jsdoc line at 95:

```js
 * @param {Function} [opts.canvasInsetTop] px of canvas hidden under open chrome (the top drawer)
```

and the parameter at 111:

```js
  canvasInsetTop = () => 0,
```

- [ ] **Step 5: Rewrite `centerWorld()`**

Replace the comment and function at `composer-editor.mjs:473-485` with:

```js
  // The palette lives in its own card BELOW the canvas card, so nothing covers
  // the canvas from above and the rect's vertical centre IS the visible centre.
  // The inspector rail still floats over the RIGHT edge, so that inset stays.
  function centerWorld() {
    const r = canvas.getBoundingClientRect();
    const h = r.height || 0;
    const w = r.width || 0;
    const insetR = Math.min(Math.max(canvasInsetRight() || 0, 0), w);
    const c = toWorld(r.left + (w - insetR) / 2, r.top + h / 2);
    return { x: c.x - NODE_W / 2, y: c.y - 60 };
  }
```

- [ ] **Step 6: Rewrite `fit()`**

Replace `composer-editor.mjs:537-553` (the `fit()` body, from `function fit() {` through its `setTransform(...)` line) with:

```js
  function fit() {
    const boxes = tpl.nodes.map((n) => ({ x: n.x, y: n.y, ...sizeOf(n) }));
    const b = fitBounds(boxes, 60);
    if (!b || !b.w || !b.h) return;
    const r = canvas.getBoundingClientRect();
    // Only the right edge is covered now — the floating inspector rail. Fit into
    // the band it leaves, then park the graph at the true top of the canvas.
    // Under jsdom r.width is 0, so the clamp yields 0 and the `|| 960` fallback
    // is the old arithmetic.
    const insetR = Math.min(Math.max(canvasInsetRight() || 0, 0), r.width || 0);
    const vw = (r.width || 960) - insetR;
    const vh = r.height || 600;
    const zoom = clamp(Math.round(Math.min(vw / b.w, vh / b.h) * 100) / 100, ZOOM_MIN, ZOOM_MAX);
    setTransform({ x: -b.x * zoom, y: -b.y * zoom, zoom });
  }
```

- [ ] **Step 7: Unwire it in `app.js`**

Delete line 1707 and line 1759 — the identical line at both `createComposerEditor` call sites:

```js
    canvasInsetTop: () => (composer.chrome ? composer.chrome.canvasInsetTop() : 0),
```

Leave the `canvasInsetRight:` line directly beneath each one untouched.

- [ ] **Step 8: Run the tests and watch them pass**

```bash
node --test test/ui-composer-editor.test.mjs test/ui-composer-chrome-app.test.mjs test/ui-composer-chrome.test.mjs
```

Expected: all PASS. `test/ui-composer-chrome.test.mjs` still exercises `chrome.canvasInsetTop()` directly and still passes — the module is untouched in this task.

- [ ] **Step 9: Commit**

```bash
git add ui/public/graph/composer-editor.mjs ui/public/app.js \
        test/ui-composer-editor.test.mjs test/ui-composer-chrome-app.test.mjs
git commit -m "$(cat <<'EOF'
refactor(composer): drop the canvas top inset ahead of the palette move

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The chrome sheds every piece of drawer state

`composer-chrome.mjs` keeps the inspector rail and one survivor from the drawer: Escape clears the filter. Everything else — the disclosure state, the stored preference, the template-derived default, the light dismiss, the auto-open — goes.

**Files:**
- Modify: `ui/public/graph/composer-chrome.mjs` (near-total rewrite)
- Modify: `ui/public/app.js:1668-1669`, `:1680-1694`, `:1723`, `:1771`
- Test: `test/ui-composer-chrome.test.mjs:1-336` (header, SHELL, `boot`, the drawer suite), `:456-484`
- Test: `test/ui-composer-chrome-app.test.mjs:1-8` (header), `:85-165`

**Interfaces:**
- Consumes: Task 1's guarantee that nothing calls `chrome.canvasInsetTop()`.
- Produces:
  ```js
  createComposerChrome({ body, insToggle, insRail, filter, storage })
    -> { canvasInsetRight(): number, destroy(): void }
  ```
  Named export `INSPECTOR_KEY = 'worca-cc.composer.inspector'` survives. `DRAWER_KEY` is deleted — a `import { DRAWER_KEY }` anywhere after this task is a bug.

- [ ] **Step 1: Rewrite the chrome unit tests**

Replace `test/ui-composer-chrome.test.mjs` from line 1 through line 336 (the end of the `destroy() unbinds the toggle, Escape, the canvas and the filter` test, i.e. everything above the `// --- the real index.html and style.css ---` banner) with:

```js
// test/ui-composer-chrome.test.mjs
// Composer chrome: the inspector rail's disclosure state and its persistence,
// plus the one shortcut left over from the old agent drawer — Escape clears the
// filter.
//
// The module owns NO graph state — it never reads or writes a template — so it
// survives the editor teardown/rebuild that composerLoadTemplate() performs.
//
// The SHELL below seeds `data-inspector="collapsed"`, the OPPOSITE of the
// default, on purpose. If it shipped "open", the "defaults to open" case would
// pass against an empty setInspector() and prove nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createComposerChrome, INSPECTOR_KEY } from '../ui/public/graph/composer-chrome.mjs';

const SHELL = `<!doctype html><body>
  <section class="card builder-card">
    <div class="gv-body" id="body" data-inspector="collapsed">
      <div id="canvas" class="gv-canvas"></div>
      <div class="gv-ins-rail" id="rail">
        <button id="ins-toggle" type="button" aria-expanded="false"
                aria-controls="inspector" aria-label="Expand inspector"></button>
        <aside id="inspector" class="gv-inspector"></aside>
      </div>
    </div>
  </section>
  <section class="card gv-palette-card">
    <div class="gv-palette-head">
      <b class="gv-palette-title">Agents</b>
      <input id="filter" type="search">
    </div>
    <div id="palette" class="gv-palette-scroll">
      <button id="pill" class="ap" type="button" data-key="planner">Plan</button>
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

function boot({ storage = memStorage(), railWidth = 280 } = {}) {
  const dom = new JSDOM(SHELL, { url: 'http://localhost:4317/' });
  const { window } = dom;
  const doc = window.document;
  const els = {
    filter: doc.getElementById('filter'),
    palette: doc.getElementById('palette'),
    canvas: doc.getElementById('canvas'),
    pill: doc.getElementById('pill'),
    body: doc.getElementById('body'),
    insToggle: doc.getElementById('ins-toggle'),
    inspector: doc.getElementById('inspector'),
    rail: doc.getElementById('rail'),
  };
  // jsdom answers zeros for every rect, so the floating rail's width is stubbed.
  els.rail.getBoundingClientRect = () => ({
    width: railWidth, height: 638, top: 0, left: 1046 - railWidth, right: 1046, bottom: 638,
  });
  const chrome = createComposerChrome({
    body: els.body, insToggle: els.insToggle, insRail: els.rail,
    filter: els.filter, storage,
  });
  return { window, doc, els, chrome, storage };
}

const click = (window, el) =>
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
// Returns the event so a case can assert defaultPrevented — cancelable:true is
// what makes preventDefault() observable, and the filter clear relies on it to
// defeat the UA's own input[type=search] clear.
const esc = (window, el) => {
  const ev = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
};

test('Escape clears a non-empty filter and goes no further', () => {
  const { window, els } = boot();
  els.filter.value = 'plan';
  let reachedDocument = 0;
  els.filter.ownerDocument.addEventListener('keydown', () => { reachedDocument += 1; });

  const ev = esc(window, els.filter);
  assert.equal(els.filter.value, '', 'the field is cleared');
  assert.equal(ev.defaultPrevented, true,
    'preventDefault stops the UA clearing input[type=search] a second time');
  assert.equal(reachedDocument, 0,
    'and it does not also reach the editor document-level deselect');
});

test('the clear fires a synthetic input so the editor re-filters', () => {
  const { window, els } = boot();
  els.filter.value = 'plan';
  let inputs = 0;
  els.filter.addEventListener('input', () => { inputs += 1; });
  esc(window, els.filter);
  assert.equal(inputs, 1, 'applyFilter() re-runs exactly once');
});

test('Escape in an EMPTY filter passes straight through to the editor', () => {
  // The editor owns a document-level Escape (deselect). Swallowing it here
  // whenever the field has focus would break deselect for anyone who tabbed
  // into the filter and back out of their selection.
  const { window, els } = boot();
  els.filter.value = '';
  let reachedDocument = 0;
  els.filter.ownerDocument.addEventListener('keydown', () => { reachedDocument += 1; });

  const ev = esc(window, els.filter);
  assert.equal(ev.defaultPrevented, false);
  assert.equal(reachedDocument, 1, 'the editor still gets its deselect');
});

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
  // direction proves the module wrote anything.
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

test('the palette has no disclosure state left to read or write', () => {
  // The whole point of the change: there is no code path that can hide the
  // agents. A returning drawer would need a stored key, and there is none.
  const { window, els, storage } = boot();
  click(window, els.insToggle);
  assert.equal(storage.read('worca-cc.composer.drawer'), null,
    'the dead key is never written, even by an inspector toggle');
  assert.equal(els.palette.hasAttribute('hidden'), false);
});

test('a throwing Storage (private mode) degrades to the defaults', () => {
  // jsdom does NOT rethrow out of dispatchEvent — it reports listener exceptions
  // as a window 'error' event — so assert.doesNotThrow around a click would be
  // vacuous here. Count the reported errors instead.
  const boom = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('SecurityError'); },
  };
  const { window, els } = boot({ storage: boom });
  assert.equal(els.body.dataset.inspector, 'open',
    'an unreadable key falls through to the default');

  let reported = 0;
  window.addEventListener('error', () => { reported += 1; });
  click(window, els.insToggle);
  assert.equal(reported, 0, 'the unwritable key was swallowed, not thrown at the page');
  assert.equal(els.body.dataset.inspector, 'collapsed', 'the in-memory state still flips');
});

test('destroy() unbinds the inspector handle and the filter Escape', () => {
  const { window, els, chrome } = boot();
  chrome.destroy();

  click(window, els.insToggle);
  assert.equal(els.body.dataset.inspector, 'open', 'the handle is inert after destroy');

  els.filter.value = 'plan';
  esc(window, els.filter);
  assert.equal(els.filter.value, 'plan', 'the Escape clear is inert after destroy');
});
```

Then delete two now-meaningless tests further down the same file: `the inspector rail is independent of the drawer` (lines 456-466 of the original) and `syncDefault() never touches the inspector` (468-477). Also delete `destroy() unbinds the inspector handle too` (479-484) — it is subsumed by the new combined `destroy()` test above.

- [ ] **Step 2: Rewrite the app-level chrome tests**

In `test/ui-composer-chrome-app.test.mjs`, replace the header comment (lines 1-8) with:

```js
// test/ui-composer-chrome-app.test.mjs — the composer chrome against the REAL
// index.html and the REAL app.js. The chrome's unit tests drive the factory
// directly, so they cannot see a wiring mistake: a missing
// createComposerChrome() call, or a chrome that gets constructed twice and
// double-binds its inspector handle.
//
// The harness is the one test/ui-agent-xss.test.mjs uses (jsdom + a stubbed
// fetch + a WebSocket stub), trimmed to what the composer needs.
```

and replace all four tests at lines 85-165 with:

```js
test('the chrome is constructed and the inspector opens by default', async () => {
  const window = await boot();
  await goComposer(window);
  const doc = window.document;

  assert.ok(doc.querySelector('#composer-palette .ap'),
    'guard: the palette actually rendered, so the composer really booted');
  assert.equal(doc.querySelector('#composer-body').dataset.inspector, 'open');
  assert.equal(doc.querySelector('#composer-inspector-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(window.localStorage.getItem('worca-cc.composer.inspector'), null,
    'a first-visit default is not a stored preference');
});

test('the chrome outlives the editor swap and is bound exactly once', async () => {
  const window = await boot();
  await goComposer(window);
  const doc = window.document;
  const body = doc.querySelector('#composer-body');

  click(window, doc.querySelector('#composer-saved-list .pl-open'));
  for (let i = 0; i < 4; i += 1) await tick();
  assert.ok(doc.querySelector('#composer-canvas .node[data-node-id="n_plan"]'),
    'guard: the template really loaded, so the editor was destroyed and rebuilt');

  // ONE construction means ONE listener: a single click must flip the state
  // exactly once. A second binding would flip it twice and leave it open.
  click(window, doc.querySelector('#composer-inspector-toggle'));
  assert.equal(body.dataset.inspector, 'collapsed',
    'the handle still works after the editor was rebuilt');
  assert.equal(window.localStorage.getItem('worca-cc.composer.inspector'), 'collapsed',
    'and a manual toggle persists');
});

test('loading a template never touches the palette', async () => {
  // The old drawer collapsed itself whenever the loaded graph already had an
  // agent. Nothing may do that any more.
  const window = await boot();
  await goComposer(window);
  const doc = window.document;

  click(window, doc.querySelector('#composer-saved-list .pl-open'));
  for (let i = 0; i < 4; i += 1) await tick();

  assert.ok(doc.querySelector('#composer-canvas .node[data-node-id="n_plan"]'),
    'guard: an agent-bearing template really loaded');
  assert.ok(doc.querySelector('#composer-palette .ap'), 'the pills are still on screen');
  assert.equal(window.localStorage.getItem('worca-cc.composer.drawer'), null,
    'and no disclosure preference was written');
});

test('app.js no longer owns a drawer', () => {
  const APP = readFileSync(appPath, 'utf8');
  assert.equal(/syncDefault/.test(APP), false, 'the template-derived default is gone');
  assert.equal(/composer-drawer/.test(APP), false, 'and every drawer element lookup with it');
  assert.equal(/hasAgents/.test(APP), false, 'and the predicate that fed the default');
});
```

Also delete the now-unused `SAVED_TEMPLATE` doc comment at line 26 (`/** A saved pipeline that PLACES an agent — the state D5 collapses the drawer on. */`) and replace it with:

```js
/** A saved pipeline that PLACES an agent, so an editor rebuild is observable. */
```

- [ ] **Step 3: Run the tests and watch them fail**

```bash
node --test test/ui-composer-chrome.test.mjs test/ui-composer-chrome-app.test.mjs
```

Expected: `Escape clears a non-empty filter and goes no further` and `the clear fires a synthetic input so the editor re-filters` FAIL — the old module binds Escape on the `drawer` element, which the rewritten SHELL does not contain, so nothing clears the field. `app.js no longer owns a drawer` FAILS on `syncDefault`. Everything else PASSES: the inspector half of the module is unchanged, and `Escape in an EMPTY filter passes straight through` is green against both versions (that is the branch the old module also declined to handle). Three reds is the signal to proceed.

- [ ] **Step 4: Rewrite `composer-chrome.mjs`**

Replace the whole file with:

```js
// ui/public/graph/composer-chrome.mjs
// Composer chrome: the inspector rail's disclosure state and its persistence.
//
// This module deliberately owns NO graph state. It never reads or writes a
// template, so it is constructed once and survives the editor teardown/rebuild
// that composerLoadTemplate() performs on every "New canvas" and every saved-
// pipeline open.
//
// The agent palette used to be a collapsible top drawer and this module owned
// its disclosure. The palette now lives in its own always-expanded card below
// the canvas, so the only thing left of that here is the Escape-clears-the-
// filter shortcut. `worca-cc.composer.drawer` is a dead localStorage key:
// nothing reads it, nothing writes it, and nothing migrates it away.

/** 'open' | 'collapsed' — the right rail's disclosure. A rail the user
 *  collapsed stays collapsed, across reloads and across template loads. */
export const INSPECTOR_KEY = 'worca-cc.composer.inspector';

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
 * @param {Element}  [opts.body]      #composer-body — carries data-inspector
 * @param {Element}  [opts.insToggle] #composer-inspector-toggle
 * @param {Element}  [opts.insRail]   #composer-ins-rail — measured for the right inset
 * @param {Element}  [opts.filter]    #composer-agent-filter — Escape clears it
 * @param {Storage}  [opts.storage]   defaults to globalThis.localStorage
 * @returns {{ canvasInsetRight(): number, destroy(): void }}
 */
export function createComposerChrome({
  body = null,
  insToggle = null,
  insRail = null,
  filter = null,
  storage = defaultStorage(),
} = {}) {
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

  /** Escape inside a non-empty filter clears it and stops there.
   *
   *  Bound on the FILTER, not the document: the editor already owns a
   *  document-level Escape (deselect, composer-editor.mjs:686), and a second
   *  document listener would fire both. stopPropagation runs ONLY when this
   *  handler actually consumed the key, so an Escape in an empty field still
   *  reaches the editor and still deselects.
   *
   *  preventDefault is load-bearing: the field is input[type=search], which
   *  Blink and WebKit clear on Escape themselves. Suppressing that keeps the
   *  clear happening exactly once here, and the synthetic `input` is what
   *  re-runs the editor's applyFilter(). */
  function onFilterKeyDown(ev) {
    if (ev.key !== 'Escape' || !filter || !filter.value) return;
    ev.preventDefault();
    ev.stopPropagation();
    filter.value = '';
    const doc = filter.ownerDocument;
    const view = doc ? doc.defaultView : null;
    if (view) filter.dispatchEvent(new view.Event('input', { bubbles: true }));
  }

  if (insToggle) insToggle.addEventListener('click', onInsToggleClick);
  if (filter) filter.addEventListener('keydown', onFilterKeyDown);
  setInspector(readKey(storage, INSPECTOR_KEY) !== 'collapsed');

  return {
    /** The rail FLOATS over the canvas's right edge (style.css), so the canvas
     *  rect is wider than the visible band. No isOpen()-style guard: the rail is
     *  always present, and its collapsed 28px is a real inset. jsdom answers 0,
     *  which is the pre-inset arithmetic. */
    canvasInsetRight() {
      if (!insRail || !insRail.getBoundingClientRect) return 0;
      return insRail.getBoundingClientRect().width || 0;
    },
    destroy() {
      if (insToggle) insToggle.removeEventListener('click', onInsToggleClick);
      if (filter) filter.removeEventListener('keydown', onFilterKeyDown);
    },
  };
}
```

- [ ] **Step 5: Trim the wiring in `app.js`**

Delete the two element lookups at 1668-1669:

```js
  composer.els.drawer    = $('#composer-drawer');
  composer.els.drawerTog = $('#composer-drawer-toggle');
```

Replace the construction block at 1674-1694 with:

```js
  // Constructed ONCE, and BEFORE the palette await: a stored inspector
  // preference has to be applied on the first paint, not after a network
  // round-trip. The `!composer.chrome` guard is its own idempotence — unlike
  // _composerReady it is set before any await, so a fast double view-entry
  // cannot double-bind the handle. The chrome owns no graph state, so it is
  // never destroyed and it survives every editor swap composerLoadTemplate()
  // performs.
  if (!composer.chrome) {
    composer.chrome = createComposerChrome({
      body: composer.els.body,
      insToggle: composer.els.insTog,
      insRail: composer.els.insRail,
      filter: composer.els.filter,
    });
  }
```

Delete line 1723 and its trailing comment:

```js
  composer.chrome.syncDefault();   // the editor exists now, so D5's default is real
```

Delete line 1771 and its trailing comment:

```js
  composer.chrome?.syncDefault();   // first-visit default only; a stored key wins
```

- [ ] **Step 6: Run the tests and watch them pass**

```bash
node --test test/ui-composer-chrome.test.mjs test/ui-composer-chrome-app.test.mjs test/ui-composer-editor.test.mjs
```

Expected: all PASS. `index.html` still ships the drawer markup at this point, so the real-file assertions further down `ui-composer-chrome.test.mjs` still pass — the visible result is a chevron that does nothing, which Task 3 removes.

- [ ] **Step 7: Commit**

```bash
git add ui/public/graph/composer-chrome.mjs ui/public/app.js \
        test/ui-composer-chrome.test.mjs test/ui-composer-chrome-app.test.mjs
git commit -m "$(cat <<'EOF'
refactor(composer): retire the agent drawer's disclosure state

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The palette becomes its own always-expanded card

The visible change. `.builder-card` shrinks to the canvas row, the palette gets a card of its own, and the three composer cards are spaced 22px apart.

**Files:**
- Modify: `ui/public/index.html:793-843`
- Modify: `ui/public/style.css:756-840` (the column + drawer block), `:850` (`.pal-pinned`), `:977-982` (a stale comment)
- Test: `test/ui-composer-chrome.test.mjs` — the real-file section
- Test: `test/ui-composer-chrome-app.test.mjs` — one new case

**Interfaces:**
- Consumes: Task 2's `createComposerChrome({ body, insToggle, insRail, filter, storage })`.
- Produces: the final DOM contract — `#composer-palette` inside `.gv-palette-card`, `#composer-agent-filter` inside `.gv-palette-head`, `#composer-body` as `.builder-card`'s only child.

- [ ] **Step 1: Rewrite the real-file assertions**

In `test/ui-composer-chrome.test.mjs`, replace the banner comment and the six tests spanning the original lines 338-417 (from `// --- the real index.html and style.css ---` through the end of `style.css: the two rules the whole goal rests on`) with:

```js
// --- the real index.html and style.css --------------------------------------
// The palette is only a layout change: #composer-palette keeps its id and its
// rendered subtree, so renderPalette/applyFilter/onPaletteClick are untouched
// and ui-agent-xss's `#composer-palette .ap[data-key]` query still resolves.
//
// Several of these read style.css as text. That is the house pattern for rules
// that cannot be exercised under jsdom (see test/ui-run-flow-css.test.mjs,
// test/ui-pinned-sidebar.test.mjs) — jsdom applies no stylesheet, so a DOM
// assertion here would be a tautology.

const REAL_HTML = readFileSync(
  fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8',
);
const REAL_CSS = readFileSync(
  fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8',
);
const realDoc = new JSDOM(REAL_HTML).window.document;

test('index.html: the palette lives in its own card, right below the canvas card', () => {
  const panel = realDoc.querySelector('#composer-palette');
  assert.ok(panel, '#composer-palette still exists');
  assert.ok(panel.classList.contains('gv-palette-scroll'));
  const card = panel.closest('.gv-palette-card');
  assert.ok(card, 'it sits inside the agents card');
  assert.ok(card.classList.contains('card'), 'which is a real .card surface');
  assert.equal(realDoc.querySelector('.builder-card').nextElementSibling, card,
    'the canvas card comes first, the agents card immediately after');
});

test('index.html: nothing can hide the agents any more', () => {
  assert.equal(realDoc.querySelector('#composer-drawer'), null, 'the drawer is gone');
  assert.equal(realDoc.querySelector('#composer-drawer-toggle'), null, 'and its toggle');
  assert.equal(realDoc.querySelector('.gv-drawer-bar'), null, 'and its bar');
  assert.ok(!realDoc.querySelector('.gv-palette'), '.gv-palette, the 264px rail, is still gone');
  assert.ok(!realDoc.querySelector('.gv-palette-top'), 'and so is .gv-palette-top');
});

test('index.html: the filter is in the head, OUTSIDE the panel renderPalette() replaces', () => {
  const filter = realDoc.querySelector('#composer-agent-filter');
  assert.ok(filter, '#composer-agent-filter still exists');
  assert.ok(filter.closest('.gv-palette-head'), 'it is in the card head');
  assert.equal(filter.closest('#composer-palette'), null,
    'renderPalette() calls replaceChildren() on #composer-palette on every repaint');
});

test('index.html: canvas and inspector are siblings inside the body row', () => {
  const body = realDoc.querySelector('#composer-body');
  assert.ok(body, '#composer-body exists');
  assert.ok(realDoc.querySelector('#composer-canvas').closest('#composer-body'));
  assert.ok(realDoc.querySelector('#composer-inspector').closest('#composer-body'));
});

test('index.html: the body row is the canvas card\'s only child', () => {
  const body = realDoc.querySelector('#composer-body');
  assert.equal(body.parentElement.className, 'card builder-card');
  assert.equal(body.parentElement.children.length, 1,
    'nothing sits above the canvas inside its card any more');
});

test('style.css: the palette is in flow, fixed height, with its own scrollbar', () => {
  assert.equal(/\.gv-drawer/.test(REAL_CSS), false, 'every drawer rule is gone');
  assert.match(REAL_CSS, /\.gv-palette-card\{padding:0;overflow:hidden;display:flex;flex-direction:column;\}/,
    'same column-flex shape as .builder-card, and padding:0 beats .card{padding:24px}');
  assert.match(REAL_CSS, /\.gv-palette-scroll\{height:300px;overflow-y:auto;padding:14px 18px 8px;\}/,
    'height, NOT max-height, and no position/top/left/right/shadow — it overlays nothing');
});

test('style.css: the three composer cards are 22px apart', () => {
  assert.match(REAL_CSS, /\.view\[data-view="composer"\] > \.card ~ \.card\{margin-top:22px;\}/,
    '`~` not `+`: the empty #composer-dialog host sits between two of them');
});

test('style.css: the canvas keeps exactly the height it had', () => {
  // Neither is observable at runtime — jsdom has no layout — and both are the
  // difference between "the canvas moved" and "only the chrome around it did".
  assert.match(REAL_CSS, /\.builder-card\{[^}]*flex-direction:column[^}]*min-height:640px/,
    '640 = the 638px canvas + .card\'s two borders; the old 685 carried the 45px bar');
  assert.match(REAL_CSS, /\.gv-body\{[^}]*min-height:638px/,
    'the body row, not the card, owns the height');
  assert.match(REAL_CSS, /\.pills\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(min\(196px,100%\),1fr\)\)/,
    'the pills still wrap across the width instead of stacking in a column');
});

test('style.css: nothing pushes the canvas empty state down any more', () => {
  assert.match(REAL_CSS, /\.gv-empty\{[^}]*top:24px/);
  assert.equal(/top:264px/.test(REAL_CSS), false, 'the drawer clearance override is gone');
});
```

Then, further down the same file, replace the two remaining drawer-shaped tests. Delete `style.css: an open palette grows the card instead of eating the canvas` wholesale — the new height test covers it. And replace `style.css: both seams read as deliberate 2px edges` with:

```js
test('style.css: the inspector seam reads as a deliberate 2px edge', () => {
  // The palette's own 2px border-bottom went with the overlay — the card's
  // border and the 22px gap separate it now.
  assert.match(REAL_CSS, /\.gv-ins-rail\{[^}]*border-left:2px solid var\(--line-2\)/);
});
```

Finally, in `style.css: the inspector floats over the canvas instead of shrinking it`, replace the comment's last sentence — `while staying under the drawer (7), so the open palette still covers the rail's top 240px` — with `and nothing paints above it now that the drawer is gone`. The assertions in that test are unchanged and must stay.

- [ ] **Step 2: Add the app-level always-expanded case**

Append to `test/ui-composer-chrome-app.test.mjs`:

```js
test('the agent palette is on screen with no gesture at all', async () => {
  const window = await boot();
  await goComposer(window);
  const doc = window.document;

  assert.equal(doc.querySelector('#composer-drawer'), null);
  assert.equal(doc.querySelector('#composer-drawer-toggle'), null);
  assert.ok(doc.querySelector('#composer-palette .ap'), 'the pills rendered');
  assert.ok(doc.querySelector('#composer-palette').closest('.gv-palette-card'),
    'into the always-expanded card, not an overlay');
});
```

- [ ] **Step 3: Run the tests and watch them fail**

```bash
node --test test/ui-composer-chrome.test.mjs test/ui-composer-chrome-app.test.mjs
```

Expected: every new markup and CSS assertion FAILS — `#composer-drawer` still exists, `.gv-palette-card` does not, `min-height:685px` is still there.

- [ ] **Step 4: Restructure the markup**

In `ui/public/index.html`, replace lines 793-843 (from `<section class="card builder-card">` through the closing `</section>` of the saved-pipelines card) with:

```html
          <!-- Canvas card: the graph row and nothing else. Its height is
               constant — nothing overlays it and nothing above it collapses. -->
          <section class="card builder-card">
            <div class="gv-body" id="composer-body" data-inspector="open">
              <!-- The canvas host. composer-editor.mjs owns everything inside it:
                   the graph-view stage, the empty state, the reason chip, the
                   legend and the zoom / auto-layout cluster. -->
              <div class="gv-canvas" id="composer-canvas"></div>

              <!-- Right rail: the selected node's / wire's inspector. The handle is
                   a SIBLING of the host, never a child — renderInspector() calls
                   replaceChildren() on #composer-inspector on every repaint. -->
              <div class="gv-ins-rail" id="composer-ins-rail">
                <button type="button" class="gv-ins-handle" id="composer-inspector-toggle"
                        aria-expanded="true" aria-controls="composer-inspector"
                        aria-label="Collapse inspector">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" stroke-width="2.6" stroke-linecap="round"
                       stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"></path></svg>
                </button>
                <aside class="gv-inspector" id="composer-inspector"></aside>
              </div>
            </div>
          </section>

          <!-- Agents: always expanded, never a disclosure. #composer-palette keeps
               its id and the exact subtree renderPalette() builds — the domain
               chips, the per-domain .pal-group sections and the pinned Flow group
               — and the filter stays OUTSIDE it, because every repaint calls
               replaceChildren() on that host. -->
          <section class="card gv-palette-card" aria-label="Agents">
            <div class="gv-palette-head">
              <b class="gv-palette-title">Agents</b>
              <input id="composer-agent-filter" class="pal-filter" type="search"
                     placeholder="Filter agents&hellip;" aria-label="Filter agents by name or ports">
            </div>
            <div id="composer-palette" class="gv-palette-scroll"></div>
          </section>

          <div id="composer-dialog"></div>

          <section class="card saved-card">
            <div class="saved-head">
              <div><b>Saved pipelines</b><span class="cnt" id="composer-saved-count"></span></div>
            </div>
            <div class="saved-list" id="composer-saved-list"></div>
          </section>
```

The `<b>` is deliberate rather than an `<h2>`: `.card h2` (style.css:269) carries `margin:0 0 18px`, which would fight the 52px flex head.

- [ ] **Step 5: Rewrite the CSS column and drawer block**

In `ui/public/style.css`, replace lines 756-840 — everything from the `/* Column: the drawer bar sits above… */` comment through `.gv-drawer[data-open="true"] ~ .gv-body .gv-empty{top:264px;}`, stopping just before `.pal-chips{display:flex;…}` — with:

```css
/* Column: the card is the canvas row and nothing else now. 640 = the 638px
   canvas plus .card's two 1px borders — min-height is a BORDER box under
   *{box-sizing:border-box} (style.css:43), and .gv-canvas declares no height
   anywhere in this stylesheet, so its size is pure align-items:stretch.
   .builder-card{padding:0} already beats .card{padding:24px} on source order.
   It was 685 = 2 + 45 (the old drawer bar and its border) + 638; the palette
   moved into its own card and took the bar with it, so the visible canvas
   height is unchanged and only the chrome around it moved. */
.builder-card{padding:0;overflow:hidden;display:flex;flex-direction:column;min-height:640px;}
/* The composer stacks three cards — canvas, agents, saved pipelines — and .card
   carries no margin of its own (.view is display:block, style.css:249), so
   before this rule they shared a seam with doubled borders. 22px is the house
   gap (.col, style.css:264) and .topbar already owns the 22px above the first
   card, so the FIRST .card must stay unmatched — hence `~ .card` rather than a
   blanket `.card`. General sibling and not `+` because the empty
   #composer-dialog host sits between the agents card and the saved card. */
.view[data-view="composer"] > .card ~ .card{margin-top:22px;}
/* The row owns the height, not the card. min-height:0 is absent on purpose:
   that flag exists to let a flex child shrink below its content, and nothing in
   this row wants to — the canvas is overflow:hidden and the rail is absolutely
   positioned (see the inspector block below). The canvas's top edge no longer
   moves in any state, so every pointer handler that reads rect.top/rect.left is
   invariant. */
.gv-body{position:relative;flex:1 1 auto;display:flex;min-height:638px;--ins-w:280px;}
/* --ins-w is how much of the canvas's right edge the floating rail covers. It
   inherits into .gv-canvas, so the decorations inside it can offset themselves
   without any JS. */
.gv-body[data-inspector="collapsed"]{--ins-w:28px;}

/* ---------- agents card ---------- */
/* Always expanded. There is no disclosure state, no stored preference and no
   gesture that hides the palette. Same column-flex shape as .builder-card so the
   head stays put and the scroll host owns the overflow, and the same padding:0
   override against .card{padding:24px}.
   The card is IN FLOW — it overlays nothing — which is why composer-editor.mjs
   no longer carries a canvasInsetTop correction. `height`, not `max-height`, on
   the scroll host: the section stays 300px however many custom agents a user
   registers, so the saved-pipelines card below it never moves. */
.gv-palette-card{padding:0;overflow:hidden;display:flex;flex-direction:column;}
.gv-palette-head{flex:0 0 52px;height:52px;display:flex;align-items:center;gap:12px;
  padding:0 18px;border-bottom:1px solid var(--line);}
.gv-palette-title{font-size:12.5px;font-weight:600;color:var(--ink-2);}
/* Carried over verbatim from `.gv-drawer-bar .pal-filter`. input[type=search] is
   NOT matched by the generic control rules at 278-299, so the focus ring has to
   be declared here. min-width:0 lets the field shrink instead of pushing the
   head past the card's overflow:hidden. */
.gv-palette-head .pal-filter{flex:1 1 auto;min-width:0;max-width:320px;height:32px;border:none;
  border-radius:11px;background:var(--field);padding:0 12px;font-size:12.5px;font-weight:500;
  color:var(--ink);font-family:inherit;}
.gv-palette-head .pal-filter::placeholder{color:var(--ink-3);}
.gv-palette-head .pal-filter:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.gv-palette-scroll{height:300px;overflow-y:auto;padding:14px 18px 8px;}
/* The chips are renderPalette()'s first child inside the scroll box, so they
   would scroll away. Pin them, cancelling the container's 14px top padding so
   they sit flush once stuck.
   PLACEMENT: `.gv-palette-scroll .pal-chips` is specificity (0,2,0) and BOTH
   bare `.pal-chips` declarations — the one directly below and the duplicate near
   the bottom of the file — are (0,1,0), so this wins wherever it sits and
   belongs here. It sets margin-top, never the margin shorthand, so the
   duplicate's margin-bottom survives untouched. */
.gv-palette-scroll .pal-chips{position:sticky;top:-14px;z-index:1;
  background:var(--panel);padding-top:14px;margin-top:-14px;}
```

- [ ] **Step 6: Widen the pinned group's bleed to the new gutter**

The scroll host's gutter went 16px → 18px, so `.pal-pinned`'s negative bleed has to follow or the pinned Flow band stops reaching the card edges. Replace the `.pal-pinned` rule (originally style.css:850):

```css
.pal-pinned{border-top:1px solid var(--line);background:var(--field);margin:0 -18px;padding:13px 18px 15px;}
```

- [ ] **Step 7: Fix the stale drawer reference in the inspector comment**

In the `.gv-ins-rail` block comment (originally style.css:977-982), the sentence

```
   It stays under the drawer (7), so the open palette still covers the rail's
   top 240px, exactly as it did when the rail was in flow.
```

is now false — there is no drawer. Replace those two lines with:

```
   Nothing paints above it any more: the drawer that used to own z-index 7 went
   with the palette, so the rail and .gv-chip (both 6) are the ceiling.
```

- [ ] **Step 8: Run the tests and watch them pass**

```bash
node --test test/ui-composer-chrome.test.mjs test/ui-composer-chrome-app.test.mjs \
            test/ui-composer-editor.test.mjs test/ui-composer-save.test.mjs \
            test/ui-composer-wires.test.mjs
```

Expected: all PASS.

- [ ] **Step 9: Run the full suite**

```bash
npm test 2>&1 | tail -40
```

Expected: PASS except the four pre-existing imagegen-skill failures. Any composer, agent-xss, or CSS failure is a regression from this task — fix it before committing.

- [ ] **Step 10: Look at it**

```bash
npm start
```

Open the Pipeline Composer and confirm, by eye:
1. The canvas is the same height it was, with the inspector floating on its right and its collapse handle working in both directions.
2. The Agents card sits below it with visible space between them, and again between Agents and Saved pipelines.
3. The agent list scrolls inside its own card, the domain chips stay pinned at its top while it scrolls, and the FLOW / PINNED band reaches both card edges.
4. Typing in the filter narrows the list; Escape clears it in one press.
5. Dragging a pill onto the canvas still spawns a node, and the fit button still frames the graph without parking it under anything.

- [ ] **Step 11: Commit**

```bash
git add ui/public/index.html ui/public/style.css \
        test/ui-composer-chrome.test.mjs test/ui-composer-chrome-app.test.mjs
git commit -m "$(cat <<'EOF'
feat(composer): give the agents their own always-expanded card

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: the layout and the 22px gap → T3 steps 4-5; the geometry table → T3 steps 4-6; the markup contract → T3 step 4; the chrome module rewrite → T2 step 4; the editor change → T1 steps 4-6; the `app.js` changes → T1 step 7 and T2 step 5; the behaviour-delta table → the tests in T2 steps 1-2 and T3 steps 1-2; the testing section → the test steps in all three tasks. The spec's "sweep `ui-composer-save` / `ui-composer-wires`" item was resolved during planning — both files are clean — and is recorded in the file table above instead of as a task.

**Placeholders.** None. Every code step carries the literal text to write.

**Type consistency.** `createComposerChrome` is defined once (T2 step 4) with `{ body, insToggle, insRail, filter, storage }` and called with exactly those keys in T2 step 5 and in the test harness in T2 step 1. `canvasInsetRight` keeps its name and its `() => number` shape across `composer-chrome.mjs`, `composer-editor.mjs` and both `app.js` call sites. `INSPECTOR_KEY` is imported by name in T2 step 1 and exported in T2 step 4. `.gv-palette-card` / `.gv-palette-head` / `.gv-palette-title` are spelled identically in the markup (T3 step 4), the CSS (T3 step 5), the unit-test SHELL (T2 step 1) and the real-file assertions (T3 step 1).

**Known intermediate state.** After Task 2 and before Task 3, `index.html` still ships the drawer bar and its chevron, and the chevron does nothing. Tests are green throughout — the button is simply unbound until Task 3 deletes it.
