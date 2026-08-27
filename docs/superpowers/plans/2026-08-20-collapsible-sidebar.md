# Collapsible Sidebar (Icon Rail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Worca sidebar a second state — a 76px icon rail with the favicon on top, icon-only nav, per-run initials tiles, and a circular budget indicator at the bottom — toggled by a chevron button and remembered across reloads.

**Architecture:** One DOM tree, not two. The existing `<nav>` is restyled by a single `.sidebar.collapsed` class, so every existing selector, count updater and routing test keeps working. JavaScript only swaps the two pieces whose *content* genuinely differs: the child run rows become square initials tiles, and the spend block becomes a conic-gradient ring. State lives in one module-level boolean persisted to `localStorage`.

**Tech Stack:** Vanilla ES modules, no build step, no framework. `node:test` + `jsdom` for tests. CSS custom properties from the `:root` palette in `ui/public/style.css`.

**Spec:** `docs/superpowers/specs/2026-08-20-collapsible-sidebar-design.md`

## Global Constraints

- **Node ≥ 22.13.0**, ESM only, no build step, no new dependencies.
- **Full-suite command:** `npm test` → `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/*.mjs`
- **Single-file command:** `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/<file>.mjs`
- **Baseline: the suite is fully green.** It must still be green at the end of every task. A red test that you did not write is a regression, not a pre-existing failure.
- **Colours come from the `:root` palette** (`ui/public/style.css:11-46`). No new hex literals outside it.
- **`docs/superpowers/**` is never committed.** Write it, read it, leave it untracked.
- **`localStorage` key:** `worca-cc.sidebar.collapsed`, values `'1'` / `'0'`, default expanded.
- **The `@media (max-width:1080px)` rule is out of bounds.** The sidebar still `display:none`s there and `.topnav` still takes over. Do not touch `.topnav`.
- **Settings stays inside `<nav class="nav">`.** `test/ui-nav-sections.test.mjs:57-60` locks this; moving it kills nav routing, because `navLinks` (`app.js:13648`) only snapshots `.nav button[data-nav]` and `.topnav button[data-nav]`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `ui/public/index.html` | Modify `.brand` (`:15-17`) and `<nav class="nav">` (`:19`) | The two new brand nodes (favicon + toggle) and the `aria-controls` target. Nothing else in the sidebar moves. |
| `ui/public/style.css` | Edit `.sidebar` (`:68-76`) and `.brand` (`:77`) in place; append a new block at EOF | The collapsed rail is one appended block scoped entirely under `.sidebar.collapsed`, so the expanded state cannot regress. EOF placement is required: the ring rules must lose no source-order tie against `.spend-ind` (`:1596`). |
| `ui/public/app.js` | Insert a state block before `:339`; fork `renderPipelineTabs` (`:13507`); one line in `paintBudget` (`:370`); one line in `updateNavCounts` (`:13601`) | Owns the boolean, its persistence, and which of the two renderers runs. |
| `ui/public/stats-view.mjs` | Append `compactUsd` + `renderBudgetRing` after `:219` | Pure detached-DOM renderer, same contract as its `renderBudgetIndicator` sibling. |
| `test/ui-sidebar-collapse.test.mjs` | Create | Everything about the two states: CSS contract + jsdom behaviour. |
| `test/ui-budget-indicator.test.mjs` | Append | `renderBudgetRing` unit tests, beside the indicator they mirror. |

---

## Verified Facts (do not re-derive)

These were probed against the real toolchain while writing this plan. They are load-bearing.

1. **jsdom stores CSS custom properties but drops `conic-gradient`.**
   `el.style.setProperty('--ring-pct','63')` → `getPropertyValue('--ring-pct')` is `"63"`.
   `el.style.background = 'conic-gradient(red 0 63%, blue 0)'` → `el.style.background` is `""`.
   This is why the percentage travels as a custom property and the gradient is composed in the stylesheet.
2. **jsdom's `localStorage` is a Proxy.** A per-instance `Object.defineProperty(window.localStorage,'getItem',…)` is silently ignored. To simulate private mode you must patch `window.Storage.prototype.getItem` / `.setItem` *before* importing `app.js`.
3. **A single `await new Promise(r => setTimeout(r, 0))` after the `app.js` import is enough for the boot budget paint** — `test/ui-budget-indicator.test.mjs:107-112` asserts the mounted indicator immediately after exactly that.
4. **`test/ui-nav-sections.test.mjs:19`** matches `/<nav class="nav"[\s\S]*?<\/nav>/` — a prefix match, so adding `id="side-nav"` to that tag is safe.
5. **Default dev server port is `4317`** (`ui/server.mjs:120`).

---

## Task 1: Collapse state, toggle button, favicon swap

**Files:**
- Modify: `ui/public/index.html:14-19`
- Modify: `ui/public/style.css:68-77` (in place) and EOF (append)
- Modify: `ui/public/app.js` — insert immediately before the `// Spend indicator.` comment block at `:339`
- Create: `test/ui-sidebar-collapse.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (module-private to `app.js`, used by Tasks 3 and 4):
  - `let sidebarCollapsed` — boolean
  - `function setSidebarCollapsed(v: boolean): void`
  - `function applySidebarCollapsed(): void`
- Produces (DOM contract, used by Tasks 2–4): `.sidebar.collapsed` on `<aside class="sidebar">`, and `#side-toggle`.

- [ ] **Step 1: Branch off `dev`**

```bash
git checkout dev
git checkout -b feat/collapsible-sidebar
```

- [ ] **Step 2: Write the failing test file**

Create `test/ui-sidebar-collapse.test.mjs`:

```js
// test/ui-sidebar-collapse.test.mjs — the sidebar's two states: the 298px
// labelled column and the 76px icon rail. Markup + CSS contract, plus jsdom
// behaviour driven through the REAL app.js against the REAL index.html
// (harness lifted from test/ui-pipeline-tabs.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..', 'ui', 'public');
const htmlPath = join(root, 'index.html');
const appPath = join(root, 'app.js');
const html = readFileSync(htmlPath, 'utf8');
const css = readFileSync(join(root, 'style.css'), 'utf8');
const PROJECT = '/tmp/proj';
const KEY = 'worca-cc.sidebar.collapsed';
const DAY = 86400000;

// Same anchored helper as test/ui-pinned-sidebar.test.mjs: pull a flat rule
// body, anchored on a non-word char (or start) so a longer selector that merely
// ends with the same suffix cannot match.
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

const budgetFixture = () => ({
  pipelineLimitUsd: null, totalLimitUsd: 50, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 20, allTimeSpendUsd: 20,
  remainingUsd: 30, blocked: false,
});

async function boot({ seed = null, breakStorage = false } = {}) {
  const dom = new JSDOM(html, { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/budget')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => budgetFixture() });
    }
    if (u.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({
      config: { steps: {}, customModels: [] }, models: [], efforts: [],
      pipelines: 0, projects: 0, workspaces: 0 }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  if (seed) for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
  // jsdom's localStorage is a Proxy — a per-instance defineProperty is silently
  // ignored, so private mode has to be simulated on the prototype. Narrowed to
  // OUR key: app.js reads LAST_PROJECT_KEY etc. outside any try/catch, and a
  // blanket throw would fail the boot for unrelated reasons.
  if (breakStorage) {
    const g = window.Storage.prototype.getItem;
    const s = window.Storage.prototype.setItem;
    window.Storage.prototype.getItem = function (k) {
      if (k === KEY) throw new Error('denied'); return g.call(this, k);
    };
    window.Storage.prototype.setItem = function (k, v) {
      if (k === KEY) throw new Error('denied'); return s.call(this, k, v);
    };
  }
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  lastWs._l.open?.forEach((fn) => fn());
  const click = (sel) => window.document.querySelector(sel)
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { window, recv, click, tick };
}

// ---- Task 1: shell, toggle, persistence ----

test('.sidebar animates its width; the collapsed rail is 76px', () => {
  const base = ruleBody('.sidebar');
  assert.ok(base, '.sidebar rule must exist');
  assert.match(base, /width:\s*298px/, 'the expanded column is unchanged');
  assert.match(base, /transition:\s*flex-basis/, 'the width change must be animated');
  const rail = ruleBody('.sidebar.collapsed');
  assert.ok(rail, '.sidebar.collapsed rule must exist');
  assert.match(rail, /width:\s*76px/);
  assert.match(rail, /flex:\s*0 0 76px/);
});

test('the favicon replaces the wordmark on the rail', () => {
  assert.match(ruleBody('.brand .logo-mark'), /display:\s*none/, 'hidden while expanded');
  assert.match(ruleBody('.sidebar.collapsed .logo'), /display:\s*none/);
  assert.match(ruleBody('.sidebar.collapsed .logo-mark'), /display:\s*block/);
  assert.match(html, /class="logo-mark"[^>]*src="\/assets\/worca-favicon\.png"/);
});

test('one chevron glyph, mirrored by CSS when collapsed', () => {
  const brand = html.match(/<div class="brand">[\s\S]*?<\/div>/)[0];
  assert.equal((brand.match(/<svg/g) || []).length, 1,
    'exactly one chevron SVG — the collapsed glyph is the same path, mirrored');
  assert.match(ruleBody('.sidebar.collapsed .side-toggle svg'), /transform:\s*scaleX\(-1\)/);
});

test('boots expanded when nothing is stored', async () => {
  const { window } = await boot();
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), false);
  const btn = window.document.querySelector('#side-toggle');
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(btn.getAttribute('aria-label'), 'Collapse menu');
});

test('clicking the toggle collapses, relabels and persists', async () => {
  const { window, click } = await boot();
  click('#side-toggle');
  const btn = window.document.querySelector('#side-toggle');
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(btn.getAttribute('aria-label'), 'Expand menu');
  assert.equal(btn.title, 'Expand menu');
  assert.equal(window.localStorage.getItem(KEY), '1');
});

test('clicking again expands and persists the expanded state', async () => {
  const { window, click } = await boot();
  click('#side-toggle');
  click('#side-toggle');
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), false);
  assert.equal(window.document.querySelector('#side-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(window.localStorage.getItem(KEY), '0');
});

test('a stored "1" restores the rail at boot', async () => {
  const { window } = await boot({ seed: { [KEY]: '1' } });
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), true);
  assert.equal(window.document.querySelector('#side-toggle').getAttribute('aria-expanded'), 'false');
});

test('a garbage stored value falls back to expanded', async () => {
  const { window } = await boot({ seed: { [KEY]: 'yes' } });
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), false);
});

test('storage that throws (private mode) boots expanded and still toggles', async () => {
  const { window, click } = await boot({ breakStorage: true });
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), false);
  click('#side-toggle');
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), true,
    'a write that throws must not stop the in-memory state from flipping');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-sidebar-collapse.test.mjs`
Expected: FAIL — `ruleBody('.sidebar.collapsed')` returns `null` (so `assert.ok` fails), and `#side-toggle` is `null` (`TypeError: Cannot read properties of null`).

- [ ] **Step 4: Add the two brand nodes to `ui/public/index.html`**

Replace lines 15-17 (the `.brand` div) with:

```html
        <div class="brand">
          <img class="logo" src="/assets/worca-logo.png" alt="Worca" />
          <img class="logo-mark" src="/assets/worca-favicon.png" alt="Worca" />
          <button type="button" class="side-toggle" id="side-toggle"
                  aria-expanded="true" aria-controls="side-nav"
                  title="Collapse menu" aria-label="Collapse menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-5 6 5 6M7 5v14"></path></svg>
          </button>
        </div>
```

Then give the nav the `aria-controls` target — change line 19 from
`<nav class="nav" aria-label="Primary">` to:

```html
        <nav class="nav" id="side-nav" aria-label="Primary">
```

`ui/public/assets/worca-favicon.png` already exists (it is the page favicon, `index.html:9`). Do not add an asset.

- [ ] **Step 5: Edit the two existing rules in `ui/public/style.css`**

`.sidebar` (`:68-76`) gains one declaration — add `transition:flex-basis .2s cubic-bezier(.65,.02,.28,1);` as the last line inside the block:

```css
.sidebar{
  width:298px;flex:0 0 298px;
  background:var(--panel);
  padding:26px 18px 22px;
  display:flex;flex-direction:column;
  border-right:1px solid var(--line);
  overflow-y:auto;
  transition:flex-basis .2s cubic-bezier(.65,.02,.28,1);
}
```

`.brand` (`:77`) becomes:

```css
.brand{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 8px;margin-bottom:24px;}
```

- [ ] **Step 6: Append the shell rules to the END of `ui/public/style.css`**

EOF placement is required, not stylistic: later tasks append the ring rules to this same block, and they must win the source-order tie against `.spend-ind` (`:1596`).

```css

/* ---------- Collapsible sidebar: the 76px icon rail ---------- */
/* Everything here is scoped under `.sidebar.collapsed`, so the expanded
   298px column is untouched. The <1080px breakpoint (:911) still hides the
   sidebar outright and hands over to .topnav — collapse is a preference that
   only exists above it, and the two mechanisms never overlap. */
.brand .logo-mark{display:none;width:32px;height:32px;border-radius:50%;}
.side-toggle{display:flex;align-items:center;justify-content:center;
  width:30px;height:30px;flex:0 0 auto;border:0;border-radius:9px;
  background:transparent;color:var(--ink-3);cursor:pointer;}
.side-toggle svg{width:17px;height:17px;}
.side-toggle:hover{background:var(--field);color:var(--ink);}
.side-toggle:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}

.sidebar.collapsed{width:76px;flex:0 0 76px;padding:22px 18px 18px;}
.sidebar.collapsed .brand{flex-direction:column;gap:0;margin-bottom:8px;padding:0;}
.sidebar.collapsed .logo{display:none;}
.sidebar.collapsed .logo-mark{display:block;}
.sidebar.collapsed .side-toggle{width:40px;height:40px;margin:10px 0 8px;}
/* The mock's two chevrons are exact mirror images of one path, so one glyph
   plus a flip keeps the states from ever drifting apart. */
.sidebar.collapsed .side-toggle svg{transform:scaleX(-1);}
```

- [ ] **Step 7: Add the state block to `ui/public/app.js`**

Insert immediately **before** the `// ------` comment banner that opens the Spend-indicator section at `:339`.

Placement matters: `paintBudget` (`:366`) reads `sidebarCollapsed` in Task 4, and a `let` declared further down the file would be in its temporal dead zone for a synchronous boot paint. Everything this block calls is a hoisted function declaration, so sitting early costs nothing.

```js
// ---------------------------------------------------------------------------
// Sidebar collapse (icon rail). One boolean, one class. The collapsed state is
// a user PREFERENCE, unrelated to the <1080px breakpoint where the sidebar is
// hidden outright in favour of .topnav — the two never overlap.
// ---------------------------------------------------------------------------
const SIDEBAR_KEY = 'worca-cc.sidebar.collapsed';

function readSidebarCollapsed() {
  try { return localStorage.getItem(SIDEBAR_KEY) === '1'; }
  catch { return false; }                    // private mode / storage disabled
}

let sidebarCollapsed = readSidebarCollapsed();

function applySidebarCollapsed() {
  const aside = $('.sidebar');
  if (aside) aside.classList.toggle('collapsed', sidebarCollapsed);
  const btn = $('#side-toggle');
  if (btn) {
    btn.setAttribute('aria-expanded', String(!sidebarCollapsed));
    const label = sidebarCollapsed ? 'Expand menu' : 'Collapse menu';
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
}

function setSidebarCollapsed(v) {
  sidebarCollapsed = !!v;
  // A write that throws (private mode) must not stop the in-memory flip.
  try { localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? '1' : '0'); }
  catch { /* private mode */ }
  applySidebarCollapsed();
  renderPipelineTabs();          // child rows <-> initials tiles (Task 3)
  paintBudget();                 // spend block <-> budget ring (Task 4)
}

$('#side-toggle')?.addEventListener('click', () => setSidebarCollapsed(!sidebarCollapsed));
applySidebarCollapsed();         // restore before the first paint
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-sidebar-collapse.test.mjs`
Expected: PASS — 9 tests.

- [ ] **Step 9: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS, zero failures. Pay attention to `ui-nav-sections`, `ui-pinned-sidebar`, `ui-settings-icon` and `ui-budget-indicator` — they read the same markup you just edited.

- [ ] **Step 10: Commit**

```bash
git add ui/public/index.html ui/public/style.css ui/public/app.js test/ui-sidebar-collapse.test.mjs
git commit -m "$(cat <<'EOF'
Sidebar: collapsible rail — state, toggle and favicon swap

One boolean persisted to localStorage flips `.sidebar.collapsed`; the
wordmark swaps to the favicon and a single mirrored chevron toggles it.
The <1080px breakpoint is untouched — collapse is a preference above it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Icon-rail nav CSS + the paused count in the Running tooltip

**Files:**
- Modify: `ui/public/style.css` (append to the block from Task 1)
- Modify: `ui/public/app.js:13601-13620` (`updateNavCounts`)
- Modify: `test/ui-sidebar-collapse.test.mjs` (append)

**Interfaces:**
- Consumes: `.sidebar.collapsed` from Task 1.
- Produces: nothing new for later tasks. Task 3's tiles rely on the `:not(.rail-tile)` guards written here.

- [ ] **Step 1: Write the failing tests**

Append to `test/ui-sidebar-collapse.test.mjs`:

```js
// ---- Task 2: icon-rail nav ----

test('collapsed nav buttons become 40px squares and drop their labels', () => {
  const btn = ruleBody('.sidebar.collapsed .nav button:not(.rail-tile)');
  assert.ok(btn, 'the generic collapsed button rule must exclude .rail-tile');
  assert.match(btn, /width:\s*40px/);
  assert.match(btn, /height:\s*40px/);
  assert.match(btn, /justify-content:\s*center/);
});

test('label spans are hidden, badges are not, and run tiles are exempt', () => {
  const rule = '.sidebar.collapsed .nav button:not(.rail-tile) > span:not(.nav-count):not(.nav-rollup)';
  const body = ruleBody(rule);
  assert.ok(body, 'the label-hiding rule must carry the :not(.rail-tile) guard — '
    + 'without it a run tile loses its status dot and its "?" badge');
  assert.match(body, /display:\s*none/);
});

test('section headers collapse to hairlines but keep their text in the a11y tree', () => {
  const sect = ruleBody('.sidebar.collapsed .nav-sect');
  assert.ok(sect);
  assert.match(sect, /width:\s*26px/);
  assert.match(sect, /height:\s*1px/);
  assert.match(sect, /font-size:\s*0/);
  // The labels stay in the DOM — ui-nav-sections asserts their source order.
  assert.match(html, /class="nav-sect">Activity</);
  assert.match(html, /class="nav-sect">Build</);
  assert.match(html, /class="nav-sect">Manage</);
});

test('counts become corner badges; inert grey ones and the paused pill drop out', () => {
  const badge = ruleBody('.sidebar.collapsed .nav-count');
  assert.ok(badge);
  assert.match(badge, /position:\s*absolute/);
  // ruleBody() anchors on `selector{`, so the grouped selector's first half is
  // checked as text and the second (which owns the brace) through ruleBody.
  assert.match(css, /\.sidebar\.collapsed \.nav-count\.n-grey,/,
    'zero/inert grey badges drop out on the rail');
  const hidden = ruleBody('.sidebar.collapsed #nav-paused-badge');
  assert.ok(hidden, 'the paused pill would collide with the live count in the same corner');
  assert.match(hidden, /display:\s*none/);
});

test('the Running tooltip carries the live and paused counts', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [
    { runId: 'a', title: 'a', projectDir: PROJECT, status: 'running', kind: 'run',
      startedAt: '10:00:00', pendingQuestion: null },
    { runId: 'b', title: 'b', projectDir: PROJECT, status: 'paused', kind: 'run',
      startedAt: '10:00:00', pendingQuestion: null },
  ] });
  const btn = window.document.querySelector('.nav button[data-nav="running"]');
  assert.equal(btn.title, 'Running — 1 live, 1 paused',
    'the paused badge is hidden on the rail, so its count has to survive here');
});

test('with nothing paused the tooltip names only the live count', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [
    { runId: 'a', title: 'a', projectDir: PROJECT, status: 'running', kind: 'run',
      startedAt: '10:00:00', pendingQuestion: null },
  ] });
  assert.equal(window.document.querySelector('.nav button[data-nav="running"]').title,
    'Running — 1 live');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-sidebar-collapse.test.mjs`
Expected: FAIL — the six new tests fail (`ruleBody(...)` is `null`; the Running button's `title` is `''`).

- [ ] **Step 3: Append the nav rules to the collapsible block in `ui/public/style.css`**

```css
/* `:not(.rail-tile)` is LOAD-BEARING on both rules below. Run tiles are
   <button>s inside .nav, so without the guard the first rule would force them
   to 40x40 and the second would `display:none` their .child-dot and .child-q —
   the two things a tile exists to show. */
.sidebar.collapsed .nav{align-items:center;}
.sidebar.collapsed .nav button:not(.rail-tile){position:relative;
  width:40px;height:40px;padding:0;gap:0;justify-content:center;}
.sidebar.collapsed .nav button:not(.rail-tile) > span:not(.nav-count):not(.nav-rollup){display:none;}
/* New pipeline is the one filled control on the rail; outlined-at-rest only
   makes sense next to labels. */
.sidebar.collapsed .nav button.nav-cta{background:var(--ink);color:#fff;}
.sidebar.collapsed .nav button.nav-cta svg{stroke:#fff;}

/* Section headers keep their text node (ui-nav-sections asserts the source
   order, and screen readers still announce them) and collapse to the mock's
   26px hairline. */
.sidebar.collapsed .nav-sect{width:26px;height:1px;margin:10px auto;padding:0;
  font-size:0;letter-spacing:0;background:var(--line);overflow:hidden;}
.sidebar.collapsed .nav-sep{width:26px;margin-top:auto;}

.sidebar.collapsed .nav-count{position:absolute;top:-2px;right:-2px;margin:0;
  min-width:17px;height:17px;padding:0 4px;font-size:10px;
  border:2px solid var(--panel);}
/* A grey "0" pinned to a 40px square is noise, and the paused pill would land
   in the same corner as the live count. The paused signal is not lost: every
   paused run still shows its static amber dot on its own tile, and
   updateNavCounts puts the number in the button's tooltip. */
.sidebar.collapsed .nav-count.n-grey,
.sidebar.collapsed #nav-paused-badge{display:none;}
.sidebar.collapsed .nav-rollup{position:absolute;right:-1px;bottom:-1px;margin:0;}
```

- [ ] **Step 4: Add the tooltip line to `updateNavCounts` in `ui/public/app.js`**

`updateNavCounts` (`:13601`) already computes `live` and `paused`. Add the tooltip write at the very end of the function, after the `if (pb) pb.hidden = paused === 0;` line:

```js
  // The rail hides #nav-paused-badge (it would collide with the live count in
  // the same corner), so the number has to survive somewhere. Written in BOTH
  // states so the two can never drift apart.
  const rb = $('.nav button[data-nav="running"]');
  if (rb) rb.title = paused ? `Running — ${live} live, ${paused} paused` : `Running — ${live} live`;
```

- [ ] **Step 5: Run to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-sidebar-collapse.test.mjs`
Expected: PASS — 15 tests.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, zero failures.

- [ ] **Step 7: Commit**

```bash
git add ui/public/style.css ui/public/app.js test/ui-sidebar-collapse.test.mjs
git commit -m "$(cat <<'EOF'
Sidebar: icon-rail nav CSS + paused count in the Running tooltip

Labels, section text and inert badges drop out at 76px; counts become
corner badges. The hidden paused pill's number moves into the Running
button's title so the rail loses no signal.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Per-run initials tiles on the rail

**Files:**
- Modify: `ui/public/app.js:13507-13600` (`renderPipelineTabs`)
- Modify: `ui/public/style.css` (append to the collapsible block)
- Modify: `test/ui-sidebar-collapse.test.mjs` (append)

**Interfaces:**
- Consumes: `sidebarCollapsed` (Task 1); the `:not(.rail-tile)` guards (Task 2).
- Produces (module-private to `app.js`):
  - `function railInitials(title: string): string` — `'Fix auth bug'` → `'FA'`, `''` → `'?'`
  - `function tabStatusWord(r): string` — one of `'Waiting for your input' | 'Paused' | 'Completed' | 'Did not complete' | 'Running'`
  - `function railTileEl(r): HTMLButtonElement` — a detached `.rail-tile`
- Produces (DOM contract): `.rail-tile[data-child-run-id]` inside `#nav-running-children`.

- [ ] **Step 1: Write the failing tests**

Append to `test/ui-sidebar-collapse.test.mjs`:

```js
// ---- Task 3: per-run initials tiles ----

const liveRun = (runId, title, extra = {}) => ({
  runId, title, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});

test('rail tiles are 36px and out-specify the generic collapsed button rule', () => {
  const tile = ruleBody('.nav .rail-tile');
  assert.ok(tile, 'scoped `.nav .rail-tile` so it outranks `.nav button` (same idiom as .nav .nav-child)');
  assert.match(tile, /width:\s*36px/);
  assert.match(tile, /height:\s*36px/);
  const dot = ruleBody('.nav .rail-tile .child-dot');
  assert.match(dot, /position:\s*absolute/);
  const q = ruleBody('.nav .rail-tile .child-q');
  assert.match(q, /position:\s*absolute/);
  assert.match(q, /margin:\s*0/,
    'the base .child-q carries margin-left:6px, which would shove the badge off the corner');
});

test('collapsed, child rows render as initials tiles instead', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [liveRun('r1', 'Fix auth bug'), liveRun('r2', 'seo')] });
  const doc = window.document;
  const tiles = doc.querySelectorAll('#nav-running-children .rail-tile');
  assert.equal(tiles.length, 2);
  assert.equal(doc.querySelectorAll('#nav-running-children .nav-child').length, 0);
  assert.equal(tiles[0].textContent.trim(), 'FA', 'first letters of the first two words');
  assert.equal(tiles[1].textContent.trim(), 'S', 'a one-word title yields one letter');
  assert.equal(tiles[0].dataset.childRunId, 'r1');
  assert.match(tiles[0].title, /^Fix auth bug · Running$/);
});

test('each tile carries the same status dot family the expanded row uses', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [
    liveRun('r1', 'One'),
    liveRun('r2', 'Two', { status: 'paused' }),
  ] });
  const doc = window.document;
  assert.ok(doc.querySelector('.rail-tile[data-child-run-id="r1"] .child-dot.peach'),
    'a running run with no phase is peach, exactly as runDotClass says');
  assert.ok(doc.querySelector('.rail-tile[data-child-run-id="r2"] .child-dot.paused'));
  assert.match(doc.querySelector('.rail-tile[data-child-run-id="r2"]').title, /· Paused$/);
});

test('a run awaiting input gets a "?" badge and still raises the roll-up dot', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [liveRun('r1', 'Needs me', { pendingQuestion: { id: 'q1', text: 'go?' } })] });
  const doc = window.document;
  const q = doc.querySelector('.rail-tile[data-child-run-id="r1"] .child-q');
  assert.ok(q, 'the tile carries its own "?" marker');
  assert.equal(q.textContent, '?');
  assert.equal(doc.querySelector('#nav-running-rollup').hidden, false);
  assert.match(doc.querySelector('.rail-tile[data-child-run-id="r1"]').title,
    /· Waiting for your input$/);
});

test('clicking a tile opens that run and marks it active', async () => {
  const { window, recv, tick } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [liveRun('r1', 'One'), liveRun('r2', 'Two')] });
  window.document.querySelector('.rail-tile[data-child-run-id="r2"]')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick();
  await tick();
  assert.equal(window.location.hash, '#running/r2');
  assert.equal(window.document.querySelector('.rail-tile.active')?.dataset.childRunId, 'r2');
});

test('toggling with runs on screen repaints rows into tiles (signature regression)', async () => {
  const { window, recv, click } = await boot();
  recv({ type: 'hello', runs: [liveRun('r1', 'One'), liveRun('r2', 'Two')] });
  const doc = window.document;
  assert.equal(doc.querySelectorAll('#nav-running-children .nav-child').length, 2);
  click('#side-toggle');
  assert.equal(doc.querySelectorAll('#nav-running-children .rail-tile').length, 2,
    'sidebarCollapsed must be part of the tabsSig, or the rebuild gate suppresses this');
  assert.equal(doc.querySelectorAll('#nav-running-children .nav-child').length, 0);
  click('#side-toggle');
  assert.equal(doc.querySelectorAll('#nav-running-children .nav-child').length, 2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-sidebar-collapse.test.mjs`
Expected: FAIL — no `.rail-tile` exists; `ruleBody('.nav .rail-tile')` is `null`.

- [ ] **Step 3: Add the three helpers to `ui/public/app.js`**

Insert directly **above** `function renderPipelineTabs()` (`:13507`), after the `let runningCollapsed = false;` line:

```js
// The rail shows a 36px square per run instead of a titled row. Initials are
// the mock's algorithm: first letter of the first two whitespace-separated
// words, uppercased.
function railInitials(title) {
  return String(title || '').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0].toUpperCase()).join('') || '?';
}

// The word the tile's tooltip ends with. Mirrors the same four-way branch the
// expanded row uses for its end-marker, so the two states cannot disagree.
function tabStatusWord(r) {
  if (r.pendingQuestion != null) return 'Waiting for your input';
  if (isPaused(r)) return 'Paused';
  if (r._finished || isTerminalStatus(r.status)) {
    return r.status === 'done' ? 'Completed' : 'Did not complete';
  }
  return 'Running';
}

function railTileEl(r) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'rail-tile';
  // Same distinct dataset key the expanded row uses — NOT data-run-id, which is
  // the run-card's identifier and is queried unscoped across the suite.
  tile.dataset.childRunId = r.runId;
  tile.classList.toggle('active', r.runId === state.selectedRunId);
  if (isLingering(r)) tile.classList.add('lingering');
  const label = `${r.title} · ${tabStatusWord(r)}`;
  tile.title = label;
  tile.setAttribute('aria-label', label);
  tile.appendChild(document.createTextNode(railInitials(r.title)));

  const dot = document.createElement('span');
  dot.className = `child-dot ${runDotClass(r)}`;
  tile.appendChild(dot);

  // Only the pending-input marker is carried over. The expanded row also shows a
  // green/red finished-unseen "●", but the tile's corner dot ALREADY carries
  // green/red from runDotClass — a second marker on a 36px square is unreadable.
  if (r.pendingQuestion != null) {
    const q = document.createElement('span');
    q.className = 'child-q';
    q.textContent = '?';
    tile.appendChild(q);
  }

  tile.addEventListener('click', () => { location.hash = `running/${r.runId}`; });
  return tile;
}
```

- [ ] **Step 4: Put `sidebarCollapsed` in the rebuild signature**

In `renderPipelineTabs` (`:13522`), change the first line of the `sig` array from

```js
  const sig = JSON.stringify([runningCollapsed, rows.map((r) => [
```

to

```js
  // sidebarCollapsed is FIRST and load-bearing: this function early-returns on an
  // unchanged signature, so without it a collapse/expand leaves the previous
  // mode's markup on screen until the next server event happens to arrive.
  const sig = JSON.stringify([sidebarCollapsed, runningCollapsed, rows.map((r) => [
```

- [ ] **Step 5: Fork the row loop**

In the same function, the loop currently opens with:

```js
  for (const r of rows) {
    const row = document.createElement('button');
```

Insert one guard as the first statement of the loop body, leaving every existing line below it untouched:

```js
  for (const r of rows) {
    if (sidebarCollapsed) { host.appendChild(railTileEl(r)); continue; }
    const row = document.createElement('button');
```

- [ ] **Step 6: Append the tile rules to the collapsible block in `ui/public/style.css`**

```css
/* ---- rail run tiles ---- */
/* Scoped `.nav .rail-tile` for the same reason `.nav .nav-child` is scoped
   (:148-152): it has to outrank the generic `.nav button` rule. */
.sidebar.collapsed .nav-children{align-items:center;gap:5px;margin-top:5px;}
.nav .rail-tile{position:relative;display:flex;align-items:center;justify-content:center;
  width:36px;height:36px;border:1.5px solid var(--line-2);border-radius:11px;
  background:var(--panel);color:var(--ink-2);
  font-family:var(--mono);font-size:11.5px;cursor:pointer;}
.nav .rail-tile:hover{border-color:var(--ink);}
.nav .rail-tile:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.nav .rail-tile.active{background:var(--ink);border-color:var(--ink);color:#fff;}
.nav .rail-tile.lingering{color:var(--ink-3);}
.nav .rail-tile .child-dot{position:absolute;right:-2px;bottom:-2px;margin:0;
  width:9px;height:9px;border:2px solid var(--panel);box-sizing:content-box;}
/* `margin:0` overrides the base .child-q's margin-left:6px (:196), which would
   otherwise shove this absolutely-positioned badge off the corner. The base
   `animation:pulse` is kept on purpose — a run waiting on you should pulse, and
   the reduced-motion block at :904 already names .child-q. */
.nav .rail-tile .child-q{position:absolute;top:-5px;right:-5px;margin:0;
  display:flex;align-items:center;justify-content:center;
  width:15px;height:15px;border:2px solid var(--panel);border-radius:50%;
  background:var(--amber);color:#fff;font-size:9px;font-weight:700;}
```

- [ ] **Step 7: Run to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-sidebar-collapse.test.mjs`
Expected: PASS — 21 tests.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS. `ui-pipeline-tabs` is the one to watch — it exercises the expanded branch you forked, and every one of its 17 tests must still pass unchanged.

- [ ] **Step 9: Commit**

```bash
git add ui/public/app.js ui/public/style.css test/ui-sidebar-collapse.test.mjs
git commit -m "$(cat <<'EOF'
Sidebar: per-run initials tiles on the collapsed rail

renderPipelineTabs forks on sidebarCollapsed — same run list, same order,
same click target, rendered as 36px squares with initials, the existing
status dot and the pending-input badge. sidebarCollapsed joins tabsSig so
a toggle actually repaints.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Circular budget indicator

**Files:**
- Modify: `ui/public/stats-view.mjs` — append after `renderBudgetIndicator` (`:219`)
- Modify: `ui/public/app.js:79` (import) and `:370-372` (`paintBudget`)
- Modify: `ui/public/style.css` (append to the collapsible block)
- Modify: `test/ui-budget-indicator.test.mjs` (append)
- Modify: `test/ui-sidebar-collapse.test.mjs` (append)

**Interfaces:**
- Consumes: `sidebarCollapsed` (Task 1).
- Produces: `export function renderBudgetRing(budget, { doc, fmt }): HTMLButtonElement` — a detached `button.spend-ind.spend-ring` carrying `data-nav="stats"`, the inline custom property `--ring-pct`, and one `span.spend-ring-val` child.

- [ ] **Step 1: Write the failing unit tests**

Append to `test/ui-budget-indicator.test.mjs`. The file already imports `JSDOM` and defines `DAY`; add the renderer import beside the existing imports at the top:

```js
import { renderBudgetRing } from '../ui/public/stats-view.mjs';
```

Then append at the end of the file:

```js
// ---- collapsed-rail budget ring ----
// Pure renderer: its own bare document, no app.js boot.
const pureDoc = () => new JSDOM('<!doctype html><body></body>').window.document;
const ringBudget = (over) => ({
  totalLimitUsd: 50, resetPeriod: 'monthly', windowEndMs: Date.now() + 4 * DAY,
  blocked: false, ...over,
});

test('the ring meters spend against the total limit', () => {
  const el = renderBudgetRing(ringBudget({ windowSpendUsd: 20 }), { doc: pureDoc() });
  assert.equal(el.style.getPropertyValue('--ring-pct'), '40');
  assert.equal(el.querySelector('.spend-ring-val').textContent, '40%');
  assert.equal(el.classList.contains('warn'), false);
  assert.equal(el.classList.contains('over'), false);
});

test('the ring keeps .spend-ind and data-nav so the click still routes to #stats', () => {
  const el = renderBudgetRing(ringBudget({ windowSpendUsd: 20 }), { doc: pureDoc() });
  assert.ok(el.classList.contains('spend-ind'),
    'app.js:435 routes the sidebar spend click via closest(".spend-ind")');
  assert.ok(el.classList.contains('spend-ring'));
  assert.equal(el.dataset.nav, 'stats');
  assert.equal(el.tagName, 'BUTTON');
});

test('the ring turns amber at the warn threshold and red when blocked', () => {
  const warn = renderBudgetRing(ringBudget({ windowSpendUsd: 41.23 }), { doc: pureDoc() });
  assert.ok(warn.classList.contains('warn'), '82% of the cap is the warn band');
  const over = renderBudgetRing(ringBudget({ windowSpendUsd: 61, blocked: true }), { doc: pureDoc() });
  assert.ok(over.classList.contains('over'));
  assert.equal(over.style.getPropertyValue('--ring-pct'), '100');
  assert.equal(over.querySelector('.spend-ring-val').textContent, '100%');
});

test('no total limit renders a neutral ring showing the amount, not a fake percentage', () => {
  const el = renderBudgetRing(
    { totalLimitUsd: null, windowSpendUsd: 3168.85, resetPeriod: 'monthly',
      windowEndMs: Date.now() + 4 * DAY, blocked: false }, { doc: pureDoc() });
  assert.ok(el.classList.contains('no-limit'));
  assert.equal(el.style.getPropertyValue('--ring-pct'), '0');
  assert.equal(el.querySelector('.spend-ring-val').textContent, '$3.2k');
  assert.match(el.title, /no total limit/);
});

test('compact amounts stay within four glyphs', () => {
  const val = (n) => renderBudgetRing(
    { totalLimitUsd: null, windowSpendUsd: n, resetPeriod: 'monthly',
      windowEndMs: Date.now(), blocked: false }, { doc: pureDoc() })
    .querySelector('.spend-ring-val').textContent;
  assert.equal(val(4.21), '$4');
  assert.equal(val(317.4), '$317');
  assert.equal(val(3168.85), '$3.2k');
  assert.equal(val(9949), '$9.9k');
  assert.equal(val(12400), '$12k');
});
```

- [ ] **Step 2: Write the failing integration test**

Append to `test/ui-sidebar-collapse.test.mjs`:

```js
// ---- Task 4: circular budget indicator ----

test('the ring is 38px, composes its arc from --ring-pct, and recolours by band', () => {
  const ring = ruleBody('.spend-ring');
  assert.ok(ring, '.spend-ring rule must exist');
  assert.match(ring, /width:\s*38px/);
  assert.match(ring, /border-radius:\s*50%/);
  assert.match(ring, /conic-gradient/, 'the arc is drawn in CSS, not as an inline background');
  assert.match(ring, /var\(--ring-pct\)/, 'jsdom drops an inline conic-gradient; a custom property survives');
  assert.match(ruleBody('.spend-ring.warn'), /--ring-fill:\s*var\(--amber-ink\)/);
  assert.match(ruleBody('.spend-ring.over'), /--ring-fill:\s*var\(--red-ink\)/);
  assert.ok(ruleBody('.spend-ring.no-limit'), 'the no-limit ring gets a flat neutral track');
});

test('the foot swaps the spend block for the ring and back', async () => {
  const { window, click } = await boot({ seed: { [KEY]: '1' } });
  const doc = window.document;
  assert.ok(doc.querySelector('#side-spend .spend-ring'), 'collapsed boot mounts the ring');
  assert.equal(doc.querySelector('#side-spend .spend-ind-row'), null,
    'the labelled block must not also be mounted');
  assert.equal(doc.querySelector('#side-spend .spend-ring-val').textContent, '40%');

  click('#side-toggle');
  assert.equal(doc.querySelector('#side-spend .spend-ring'), null);
  assert.ok(doc.querySelector('#side-spend .spend-ind-row'), 'expanding restores the block');
});
```

- [ ] **Step 3: Run both files to verify they fail**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-sidebar-collapse.test.mjs test/ui-budget-indicator.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../ui/public/stats-view.mjs' does not provide an export named 'renderBudgetRing'`.

- [ ] **Step 4: Add the renderer to `ui/public/stats-view.mjs`**

Insert directly after `renderBudgetIndicator` ends at `:219`, before the `/** Settings budget readout … */` comment. It reuses the file's existing `h`, `periodWord`, `fmtResetAt` and `BUDGET_WARN_AT`.

```js
/** Compact centre label for the ring: $4 · $317 · $3.2k · $12k. Four glyphs is
 *  what fits inside a 28px disc at 9.5px mono. */
function compactUsd(n) {
  const v = n || 0;
  if (v >= 9950) return `$${Math.round(v / 1000)}k`;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

/** Collapsed-rail budget ring — the sidebar indicator's 38px twin.
 *  Keeps the `spend-ind` class because app.js routes the sidebar spend click
 *  through `closest('.spend-ind')`. The arc percentage travels as the custom
 *  property `--ring-pct` and the gradient is composed in the stylesheet: an
 *  inline `conic-gradient` string is dropped by jsdom, so it could never be
 *  asserted. With no total limit there is no denominator, so the ring shows a
 *  flat neutral track and the amount rather than a fabricated percentage. */
export function renderBudgetRing(budget, { doc = globalThis.document, fmt = DEFAULT_FMT } = {}) {
  const b = budget || {};
  const btn = h(doc, 'button', 'spend-ind spend-ring');
  btn.type = 'button';
  btn.dataset.nav = 'stats';
  const hasLimit = b.totalLimitUsd != null;
  const ratio = hasLimit ? b.windowSpendUsd / b.totalLimitUsd : 0;
  const pct = b.blocked ? 100 : Math.max(0, Math.min(100, Math.round(ratio * 100)));

  if (!hasLimit) btn.classList.add('no-limit');
  else if (b.blocked) btn.classList.add('over');
  else if (ratio >= BUDGET_WARN_AT) btn.classList.add('warn');

  btn.style.setProperty('--ring-pct', String(hasLimit ? pct : 0));
  btn.title = `Estimated spend this ${periodWord(b)}: ${fmt.usd4(b.windowSpendUsd)}` +
    (hasLimit ? ` of ${fmt.usd(b.totalLimitUsd)}` : ' — no total limit') +
    ` · resets ${fmtResetAt(b.windowEndMs)} — Claude Code client-side estimate ` +
    `(total_cost_usd), not authoritative billing`;
  btn.appendChild(h(doc, 'span', 'spend-ring-val',
    hasLimit ? `${pct}%` : compactUsd(b.windowSpendUsd)));
  return btn;
}
```

- [ ] **Step 5: Wire it into `paintBudget`**

In `ui/public/app.js:79`, add `renderBudgetRing` to the existing import:

```js
import { renderStatsBody, renderBudgetIndicator, renderBudgetRing, renderBudgetReadout, renderCostPauseBanner, BUDGET_WARN_AT } from './stats-view.mjs';
```

In `paintBudget` (`:370-372`), replace:

```js
  if (mount) {
    mount.replaceChildren(renderBudgetIndicator(b,
      { fmt: { usd: fmtUsd, usd4: fmtUsd4, duration: fmtDuration, estTitle } }));
  }
```

with:

```js
  if (mount) {
    // The rail has room for a 38px ring, not a labelled block with a meter.
    const render = sidebarCollapsed ? renderBudgetRing : renderBudgetIndicator;
    mount.replaceChildren(render(b,
      { fmt: { usd: fmtUsd, usd4: fmtUsd4, duration: fmtDuration, estTitle } }));
  }
```

Nothing else in `paintBudget` changes — `#topnav-spend`, the New-view gate and `repaintCostBanners()` are mode-independent.

- [ ] **Step 6: Append the ring rules to the collapsible block in `ui/public/style.css`**

These must sit after `.spend-ind` (`:1596`) — appending at EOF, as every rule in this block does, satisfies that. `.spend-ring` ties with `.spend-ind` on specificity, so source order is what lets it override the border, padding and radius.

```css
/* ---- rail budget ring ---- */
.sidebar.collapsed .side-foot{align-items:center;gap:8px;
  padding-top:12px;border-top:1px solid var(--line);}
.spend-ring{--ring-pct:0;--ring-fill:var(--blue-ink);--ring-track:var(--blue-bg);
  display:flex;align-items:center;justify-content:center;
  width:38px;height:38px;padding:0;border:0;border-radius:50%;cursor:pointer;
  background:conic-gradient(var(--ring-fill) 0 calc(var(--ring-pct) * 1%),
                            var(--ring-track) 0);}
.spend-ring.warn{--ring-fill:var(--amber-ink);--ring-track:var(--amber-bg);}
.spend-ring.over{--ring-fill:var(--red-ink);--ring-track:var(--red-bg);}
/* No total limit means no denominator: a flat neutral track, and the centre
   shows the amount instead of a percentage nothing backs. */
.spend-ring.no-limit{--ring-fill:var(--line);--ring-track:var(--line);}
.spend-ring-val{display:flex;align-items:center;justify-content:center;
  width:28px;height:28px;border-radius:50%;background:var(--panel);
  font-family:var(--mono);font-size:9.5px;color:var(--ink-2);}
.spend-ring:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
```

- [ ] **Step 7: Run both files to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-sidebar-collapse.test.mjs test/ui-budget-indicator.test.mjs`
Expected: PASS — 23 tests in `ui-sidebar-collapse`, and `ui-budget-indicator` gains 5.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS, zero failures.

- [ ] **Step 9: Commit**

```bash
git add ui/public/stats-view.mjs ui/public/app.js ui/public/style.css test/ui-budget-indicator.test.mjs test/ui-sidebar-collapse.test.mjs
git commit -m "$(cat <<'EOF'
Sidebar: circular budget indicator on the collapsed rail

renderBudgetRing is the 38px twin of the spend block: same warn/over
bands, same click-through to #stats. The arc percentage travels as
--ring-pct so the gradient can live in CSS. With no total limit the ring
goes neutral and shows the amount rather than a fabricated percentage.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Real-browser verification

Every preceding task proved behaviour under jsdom, which does not lay anything out. This task proves the rail is actually 76px wide in a real engine and that nothing overflows — the class of bug jsdom structurally cannot catch.

**Files:**
- Create: `/private/tmp/claude-501/-Users-denislavprinov-Develop-worca-cc/f5dcc2ed-21bd-4524-877e-a05cb142f137/scratchpad/verify-rail.mjs` (throwaway — never committed)

- [ ] **Step 1: Start the dev server**

```bash
WORCA_HOME=.worca-cc-verify npm start
```

Run it in the background. It listens on `http://127.0.0.1:4317` (`ui/server.mjs:120`). Wait for the `[worca-ui]` line before continuing.

- [ ] **Step 2: Write the CDP probe**

Create the scratchpad file `verify-rail.mjs`. It drives headless Chrome over the DevTools protocol with the platform's native `WebSocket` — no puppeteer, no new dependency.

```js
// Throwaway layout probe. Measures the sidebar in both states in a real engine.
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { spawn } = await import('node:child_process');

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9222',
  '--user-data-dir=/tmp/worca-rail-probe', '--window-size=1440,900',
  'http://127.0.0.1:4317',
], { stdio: 'ignore' });

await new Promise((r) => setTimeout(r, 2500));

const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('4317'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const send = (method, params = {}) => new Promise((res) => {
  const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result.value;
};

// Reload rather than navigate — a fresh navigation swaps the target out from
// under this socket.
await send('Page.enable');
await send('Page.reload', { ignoreCache: true });
await new Promise((r) => setTimeout(r, 1800));

const measure = `(() => {
  const a = document.querySelector('.sidebar');
  const r = a.getBoundingClientRect();
  const foot = document.querySelector('#side-spend > *');
  return {
    width: Math.round(r.width),
    collapsed: a.classList.contains('collapsed'),
    overflowsX: a.scrollWidth > a.clientWidth + 1,
    overflowsY: a.scrollHeight > a.clientHeight + 1,
    labelVisible: getComputedStyle(
      document.querySelector('.nav button[data-nav="running"] > span')).display !== 'none',
    footClass: foot ? foot.className : null,
    mainLeft: Math.round(document.querySelector('.main').getBoundingClientRect().left),
  };
})()`;

console.log('expanded :', await evaluate(measure));
await evaluate(`document.querySelector('#side-toggle').click()`);
await new Promise((r) => setTimeout(r, 400));   // let the .2s transition settle
console.log('collapsed:', await evaluate(measure));
await evaluate(`location.reload()`);
await new Promise((r) => setTimeout(r, 1800));
console.log('reloaded :', await evaluate(measure));

ws.close();
chrome.kill();
```

- [ ] **Step 3: Run the probe**

```bash
node /private/tmp/claude-501/-Users-denislavprinov-Develop-worca-cc/f5dcc2ed-21bd-4524-877e-a05cb142f137/scratchpad/verify-rail.mjs
```

Expected output, all three lines:

```
expanded : { width: 298, collapsed: false, overflowsX: false, overflowsY: false,
             labelVisible: true,  footClass: 'spend-ind', mainLeft: 299 }
collapsed: { width: 76,  collapsed: true,  overflowsX: false, overflowsY: false,
             labelVisible: false, footClass: 'spend-ind spend-ring', mainLeft: 77 }
reloaded : { width: 76,  collapsed: true,  … }                 ← persistence survives a real reload
```

**If `overflowsX` is true when collapsed:** something in the rail is wider than `76px - 36px` of padding. The usual culprit is a nav button that did not pick up the `:not(.rail-tile)` rule — check the selector, not the width.

**If `overflowsY` is true on a short viewport,** that is acceptable: `.sidebar` is `overflow-y:auto` by design (`:75`) and the mock's rail scrolls too. Note it and move on.

- [ ] **Step 4: Eyeball it**

```bash
open http://127.0.0.1:4317
```

Click the chevron. Confirm against the mock (`~/Downloads/colapsable area/Worca Running.dc.html`, lines 133-231): favicon on top, dark filled `+`, hairline separators between groups, green count on Running, one 36px square per live run with its dot, ring above `Settings`… **except** that the gear sits *above* the ring rather than below it. That inversion is the one deliberate deviation (spec §9) — Settings cannot leave `.nav` without breaking nav routing, which `test/ui-nav-sections.test.mjs:57-60` locks.

- [ ] **Step 5: Stop the server and clean up**

```bash
rm -rf .worca-cc-verify /tmp/worca-rail-probe
```

Kill the background `npm start`. The scratchpad probe is throwaway — do not commit it.

- [ ] **Step 6: Final full-suite run**

Run: `npm test`
Expected: PASS, zero failures.

- [ ] **Step 7: Report**

State the final suite count, the three measured widths, and the gear/ring inversion. Do not claim the mock was matched pixel-for-pixel — it was matched with one documented deviation.

---

## Self-Review

**Spec coverage:**

| Spec | Task |
|---|---|
| §2 D1 one DOM, CSS-driven | 1 (shell), 2 (nav), structure of every task |
| §2 D2 preference, not breakpoint | Global Constraints; no task touches `@media` |
| §2 D3 key + default | 1 Step 7, tested Step 2 |
| §2 D4 Settings stays put | Global Constraints; verified in 5 Step 4 |
| §2 D5 hairline sections | 2 Step 3, tested Step 1 |
| §2 D6 grey badges hidden | 2 Step 3, tested Step 1 |
| §2 D7 paused count in tooltip | 2 Step 4, tested Step 1 |
| §2 D8 same run source | 3 Step 5 (`continue` guard leaves `rows` untouched) |
| §2 D9 initials algorithm | 3 Step 3, tested Step 1 |
| §2 D10 sig includes the flag | 3 Step 4, tested by the signature-regression test |
| §2 D11 ring keeps `.spend-ind` | 4 Step 4, tested Step 1 |
| §2 D12 no-limit ring | 4 Step 4, tested Step 1 |
| §2 D13 `--ring-pct` not inline gradient | 4 Steps 4+6; Verified Fact 1 |
| §2 D14 one mirrored chevron | 1 Steps 4+6, tested Step 2 |
| §4 markup | 1 Step 4 |
| §5 CSS | 1 Step 6, 2 Step 3, 3 Step 6, 4 Step 6 |
| §6 app.js | 1 Step 7, 2 Step 4, 3 Steps 3-5, 4 Step 5 |
| §7 stats-view.mjs | 4 Step 4 |
| §8 tests 1-19 | Tasks 1-4; the D13 pre-flight is resolved in Verified Facts |
| §9 deviation | 5 Step 4, 5 Step 7 |
| §10 out of scope | No task adds a shortcut, flyout, auto-collapse or topnav change |

No gaps.

**Placeholder scan:** none — every code step carries the literal text to write, and every run step names the exact command and the exact expected outcome.

**Type consistency:** `sidebarCollapsed` / `setSidebarCollapsed` / `applySidebarCollapsed` (Task 1) are used verbatim in Tasks 3 and 4. `railInitials` / `tabStatusWord` / `railTileEl` (Task 3) are used only inside Task 3. `renderBudgetRing` (Task 4) matches its import in `app.js:79`, its export in `stats-view.mjs`, and both test files. The class names `rail-tile`, `spend-ring`, `spend-ring-val`, `no-limit` and the property `--ring-pct` are spelled identically in every CSS rule, renderer and assertion.
