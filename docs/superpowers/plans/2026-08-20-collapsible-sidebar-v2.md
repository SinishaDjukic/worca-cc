# Collapsible Sidebar (Icon Rail) — Implementation Plan **v2**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Worca sidebar a second state — a 76px icon rail with the favicon on top, icon-only nav, per-run initials tiles, and a circular budget indicator at the bottom — toggled by a chevron button and remembered across reloads.

**Architecture:** One DOM tree, not two. The existing `<nav>` is restyled by a single `.sidebar.collapsed` class, so every existing selector, count updater and routing test keeps working. JavaScript only swaps the two pieces whose *content* genuinely differs: the child run rows become square initials tiles, and the spend block becomes a conic-gradient ring. State lives in one module-level boolean persisted to `localStorage`.

**Tech Stack:** Vanilla ES modules, no build step, no framework. `node:test` + `jsdom` for tests. CSS custom properties from the `:root` palette in `ui/public/style.css`.

**Spec:** `docs/superpowers/specs/2026-08-20-collapsible-sidebar-design.md` — but see **Spec corrections** below: several of its statements are wrong and this plan supersedes them.

---

## What changed from v1 (and why you must not re-derive it)

v1 was executed end-to-end in two throwaway clones, mutation-audited (93 deliberate breakages), measured in real headless Chrome (layout, cascade winners, and the accessibility tree), and fact-checked anchor-by-anchor against the working tree. Everything below is the result, not a guess.

**Three defects that stopped or silently damaged the build:**

1. **`compactUsd` already exists** in `ui/public/stats-view.mjs:330` (`compactUsd(fmt, v)`, the spend-chart y-axis formatter). v1's Task 4 added a second top-level `function compactUsd` in the same module — in an ES module that is `SyntaxError: Identifier 'compactUsd' has already been declared`, which kills `stats-view.mjs`, therefore `app.js`, therefore the entire UI and 15 tests. Observed, not theorised. The new helper is named **`ringAmount`**.
2. **`.spend-ind:hover{background:var(--line);}`** (`style.css:1598`) is **(0,2,0)** and out-specifies a bare `.spend-ring` **(0,1,0)**. Measured in Chrome: hovering the ring sets `background-image: none` and `background-color: rgb(236,236,234)` — the arc, the whole point of the ring, is destroyed on every hover. Source order cannot fix a specificity gap. Fixed with an equal-specificity `.spend-ring:hover`.
3. **`display:none` on the label spans strips every collapsed button's accessible name.** Measured via `Accessibility.getFullAXTree`: eleven buttons announced as bare `button` with no name, and Running announced as **`"4"`** (the count span survives, so name-from-contents wins and the `title` is demoted to a description). Fixed with the sheet's own visually-hidden recipe; the labels leave the rail, not the accessibility tree.

**Two anchors that damage the file if followed literally:**

4. **`.brand` is `style.css:76`, not `:77`.** Line 77 is `.brand .logo{height:36px;width:auto;display:block;}`. Replacing line 77 deletes the *expanded* wordmark's sizing — and **no test covers `.brand .logo`**, so the suite stays green and the regression ships. A guard test is now included.
5. **`renderPipelineTabs` is `app.js:13498`, not `:13507`** (`:13507` is `const host = $('#nav-running-children');`). All line references in this document were re-derived against HEAD `411a1db0`.

**One test that asserted the opposite of reality:**

6. `cmpTabRuns` sorts **newest-`orderKey` first** (`app.js:12377-12381`), so a `hello` carrying `[r1, r2]` renders `[r2, r1]`. v1's tile test indexed positionally and failed. All tile assertions now address rows by `[data-child-run-id]`, the idiom every existing `ui-pipeline-tabs` test already uses.

**Seven vacuous assertions** (each proven vacuous by breaking the thing it claims to pin and watching it stay green): the boot a11y assertions (`index.html` already ships `aria-expanded="true"` / `aria-label="Collapse menu"` / `title="Collapse menu"`, so reading them after an *expanded* boot proves nothing — deleting the entire `if (btn) {…}` branch left the suite green); the grouped `.n-grey,` selector-text match; `railInitials`' `|| '?'` fallback; both `Math.max`/`Math.min` clamps; the tile's `aria-label`; the tile's `lingering` class. Each now has a real assertion.

**Everything v1 got right and this plan keeps:** the one-DOM architecture, the state block's placement and TDZ reasoning, `sidebarCollapsed` in `tabsSig` (the headline claim — verified: removing it turns the signature-regression test red), the `:not(.rail-tile)` guards (verified live: an injected tile keeps its padding and its dot), the `--ring-pct` mechanism, `transition:flex-basis` (measured 298 → 270.8 → 125.1 → 76 over 200 ms), every palette token, and all five compact-amount boundaries.

---

## Global Constraints

- **Node ≥ 22.13.0**, ESM only, no build step, no new dependencies.
- **Full-suite command:** `npm test` → `rm -rf .worca-cc-test && WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/*.mjs`
- **Single-file command:** `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/<file>.mjs`
- **Baseline: `npm test` at `411a1db0` is 2872 pass / 0 fail** (measured, ~81 s). It must still be zero-fail at the end of every task. A red test you did not write is a regression, not a pre-existing failure.
- **Colours come from the `:root` palette** (`ui/public/style.css:10-49`). No new hex literals outside it; `#fff` is the one pre-existing exception and is already pervasive. There is **no dark theme** anywhere in this codebase (zero hits for `prefers-color-scheme`, `[data-theme]`, `color-scheme`), so no rule below needs a dark variant.
- **`docs/superpowers/**` is never committed.** Write it, read it, leave it untracked.
- **`localStorage` key:** `worca-cc.sidebar.collapsed`, values `'1'` / `'0'`, default expanded.
- **The `@media (max-width:1080px)` rule is out of bounds.** `.sidebar{display:none;}` at `style.css:911` (block `:909-912`) still hides the sidebar there and `.topnav` still takes over. `.sidebar.collapsed` never declares `display`, so the media rule keeps winning; collapse-at-1400px → narrow-to-900px → widen-back was traced and restores the rail correctly. Do not touch `.topnav`.
- **Settings stays inside `<nav class="nav">`.** `test/ui-nav-sections.test.mjs:57-60` locks this; moving it kills nav routing, because `navLinks` (`app.js:13648`) only snapshots `.nav button[data-nav]` and `.topnav button[data-nav]`.
- **Explanatory comments go ABOVE a rule, never inside its body.** `ruleBody()` captures with `\{([^}]*)\}`: it stops at the first closing brace and cannot tell prose from a declaration, so a `}` inside a body truncates the capture, and a word like `overflow` or `display` inside one satisfies a `doesNotMatch` grep. Nine existing test files share that helper, so the constraint is on the stylesheet, not the helper. Both traps were hit and fixed while writing this plan; every comment below now sits outside its rule.
- **Do not name a raw hex in a stylesheet comment.** `style.css:37-39` states the convention and the reason: `test/ui-theme.test.mjs` asserts certain literals appear exactly once and its regex reads the raw file, so a mention inside a comment counts. Write `var(--line) on var(--panel)`, not the hex values.
- **Every `file:line` in this document is relative to HEAD `411a1db0`**, not to the tree as it stands mid-plan. Task 1 shifts `app.js` by +77 lines, so by Task 2 `let runningCollapsed` is really at `:13558` and the `sig` line at `:13583`. **Navigate by the quoted text, which is byte-exact, and treat the numbers as a starting point.**
- **No static `title=` or `aria-label=` in `index.html` on any nav button.** Two existing tests match button open-tags byte-for-byte and would go red: `test/ui-nav-sections.test.mjs:48` (`/<button type="button" class="active nav-cta" data-nav="new">/`) and `:57` (`/data-nav="settings">\s*<svg/`). Tooltips are written by JS instead — see Task 1 Step 9.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `ui/public/index.html` | Modify `<aside>` (`:14`) and `.brand` (`:15-17`) | An `id` on the aside (the `aria-controls` target) plus the two new brand nodes (favicon + toggle). **Nothing else in the sidebar moves** — `<nav class="nav">` (`:19`) is byte-identical to today. |
| `ui/public/style.css` | Edit `.sidebar` (`:68-75`) and `.brand` (`:76`) in place; insert one new block **before `:2507`** | The collapsed rail is one block scoped almost entirely under `.sidebar.collapsed`, so the expanded state cannot regress. **Placement is load-bearing in both directions** — see the box below. |
| `ui/public/app.js` | Insert a state block before `:340`; one line at `:1868`; fork `renderPipelineTabs` (`:13498`); one line in `paintBudget` (`:370-373`); the tooltip block in `updateNavCounts` (`:13601-13620`) | Owns the boolean, its persistence, the per-button tooltips, and which of the two renderers runs. |
| `ui/public/stats-view.mjs` | Append `ringAmount` + `renderBudgetRing` after `:219` | Pure detached-DOM renderer, same contract as its `renderBudgetIndicator` sibling (`:197-219`). |
| `test/ui-sidebar-collapse.test.mjs` | Create | Everything about the two states: CSS contract + jsdom behaviour. |
| `test/ui-budget-indicator.test.mjs` | Insert **before the `// The two tick suites run last:` comment at `:206`** | `renderBudgetRing` unit tests, beside the indicator they mirror. |
| `README.md` | One bullet after `:104` (the list is `:94-104`) | The Web UI feature list is user-facing. |

> ### Where the CSS block goes — and why not EOF
>
> v1 said "append at EOF, that is required." Half right. The requirement is only that the ring rules land **after `.spend-ind` (`:1596`)**, which anything past `:1611` satisfies. EOF is actively wrong: `style.css:2507-2511` carries this, in the file —
>
> > `/* ---------- reduced motion for the Running redesign ---------- */`
> > `/* MUST be the LAST block in the file: @media contributes no specificity, so a (0,1,0) 'animation:none' here would LOSE the source-order tie against any 'animation:wr-*' rule appended after it — exactly the trap documented at :748-763 … and at :1927-1940 … */`
>
> Appending past it declares no `animation` today, so nothing breaks — it just silently disarms a guard the file asks you to keep. **Insert the new block after `:2505` (`.stop-cancel:focus-visible,.stop-confirm:focus-visible{…}`) and before the `:2507` comment.** The `*{transition:none !important}` at `:905` that neutralises the new transition is `!important`, so it wins from anywhere.

---

## Verified Facts (do not re-derive)

Probed against the real toolchain — jsdom **29.1.1**, Node **25.6.1**, Chrome **151** — while writing this plan. They are load-bearing.

1. **jsdom stores CSS custom properties.** `el.style.setProperty('--ring-pct','63')` → `getPropertyValue('--ring-pct')` is `"63"`.
2. **jsdom drops a *literal* `conic-gradient` but keeps a `var()`-flavoured one.** `el.style.background = 'conic-gradient(red 0 63%, blue 0)'` → `""`. But `el.style.background = 'conic-gradient(var(--ring-fill) 0 calc(var(--ring-pct) * 1%), var(--ring-track) 0)'` **round-trips verbatim** — cssstyle bails to raw-text passthrough as soon as a value contains `var()`. So an inline gradient is *not* reliably unassertable. **The percentage still travels as a custom property, but for the real reason:** one definition of the gradient, in the stylesheet, where the cascade can swap the band colours by class. (v1 stated the wrong reason under a "do not re-derive" heading. This is the correction.)
3. **jsdom's `localStorage` is a Proxy.** A per-instance `Object.defineProperty(window.localStorage,'getItem',…)` is silently ignored. To simulate private mode you must patch `window.Storage.prototype.getItem` / `.setItem` *before* importing `app.js`, and narrow the patch to the one key — `app.js` reads `LAST_PROJECT_KEY` (`:5255`), `LAST_TARGET_KEY` (`:13834`) and `LAST_WORKSPACE_KEY` outside any `try`, so a blanket throw fails the boot for unrelated reasons.
4. **A single `await new Promise(r => setTimeout(r, 0))` after the `app.js` import is enough for the boot budget paint** — `test/ui-budget-indicator.test.mjs:107-112` asserts the mounted indicator immediately after exactly that.
5. **`index.html` already ships the toggle's resting a11y attributes** in this plan's markup: `aria-expanded="true"`, `title="Collapse menu"`, `aria-label="Collapse menu"`. Asserting them after an *expanded* boot is therefore **vacuous** — proven by deleting `applySidebarCollapsed`'s entire `if (btn) {…}` branch and watching the suite stay green. The `boot({ poisonToggle: true })` option in Task 1 strips them from the markup so only a real write can satisfy the assertion.
6. **`cmpTabRuns` sorts newest-first** (`app.js:12377-12381`: `(b.orderKey || 0) - (a.orderKey || 0)`; `orderKeyFor` at `:1073-1077` mints a monotonically increasing key on first sight). Never index tab rows positionally.
7. **`stats-view.mjs` already owns `compactUsd(fmt, v)`** (`:330`, used at `:409`). Grep any new private helper name against that file before adding it. `DEFAULT_FMT` (`:20`, exported, carries `.usd` and `.usd4`), `h(doc, tag, cls, text)` (`:33`), `fmtResetAt` (`:64`), `periodWord` (`:76`) and `BUDGET_WARN_AT = 0.8` (`:15`) are all in scope for a function appended at `:219`.
8. **`*{box-sizing:border-box}`** is set at `style.css:52`, and **`::-webkit-scrollbar{width:10px;height:10px;}`** at `:887`. Styling `::-webkit-scrollbar` forces Chrome into classic, *space-consuming* scrollbars. `.sidebar` is `overflow-y:auto` and the collapsed rail's own scroll height was measured at **967px with four runs** — it overflows a 900px window, claims the gutter, and (with the 1px `border-right` at `:73`) leaves a **29px** content box in which 40px squares sit 5px left of centre. Task 1 Step 6 suppresses the gutter on the rail only.
9. **`runDotClass`** (`app.js:12388-12404`) returns `grey-pulse` (`starting`|`pausing`), `paused`, `green`/`red` (finished/terminal), then by phase: `plan`→`violet`, `refine`→`peach`, `implement`→`blue`, `review`→`peach`, `clarify`→`red`, **default `peach`**. A running run with no phase really is `peach`.
10. **`test/ui-nav-sections.test.mjs:19`** matches `/<nav class="nav"[\s\S]*?<\/nav>/` and `:39` counts exactly **12** `<button type="button"` inside it. The toggle lives in `.brand`, outside `<nav>`, so the count holds. (v1 needed this fact to justify `id="side-nav"`; this plan puts the `id` on the `<aside>` instead, so no `<nav>` edit happens at all.)
11. **`app.js` is `<script src="/app.js" type="module">` at `index.html:1373`**, i.e. deferred — module-scope `$('.sidebar')` / `$('#side-toggle')` resolve. `app.js:435` already does an unguarded `document.getElementById('side-spend').addEventListener(...)` at module scope, so this is the established idiom. `renderPipelineTabs` (`:13498`) and `paintBudget` (`:365`) are hoisted **function declarations**; `setSidebarCollapsed` only calls them at click time. No TDZ.
12. **Default dev server port is `4317`** (`ui/server.mjs:120`, host `127.0.0.1` at `:124`).

---

## Spec corrections

The spec (`docs/superpowers/specs/2026-08-20-collapsible-sidebar-design.md`) is otherwise sound, but **this plan wins** on these points:

| Spec says | Reality | Where |
|---|---|---|
| §5's CSS block (verbatim) | Carries the hover bug, `display:none` labels, missing tile `padding`, the `content-box` dot, a hover-dead CTA and an invisible no-limit ring | Fixed in Tasks 1 and 3 |
| §7's helper is called `compactUsd` | Name is taken in that module — fatal | Renamed `ringAmount` |
| D5: `font-size:0` "keeps Activity/Build/Manage in the accessibility tree" | Measured: those `<div>`s are exposed as named nodes in **neither** state. The real (and sufficient) reason to keep the text nodes is `test/ui-nav-sections.test.mjs:26-35`, which asserts their source order | Rationale only; CSS unchanged |
| D7: the paused count "survives in the tooltip" | A `title` is a *description*, not a name, and name-from-contents already yields `"Running 4"`. `updateNavCounts` now writes `aria-label` too | Task 1 Step 10 |
| §8 test 16 expects centre text `"63%"` | The plan's fixture is `$20 / $50` → `40%`. The mock's 63% is not this fixture | Cosmetic |
| §5 declares `.nav .rail-tile.active` before `.lingering` | Both are (0,3,0), so source order decides — `.lingering` would beat `.active` and paint `--ink-3` text on the `--ink` fill | Order reversed, Task 2 Step 6, with a `css.indexOf` guard |
| §4 puts `id="side-nav"` on `<nav>` and `aria-controls="side-nav"` | The button reshapes the whole `<aside>`, and targeting `<nav>` forces a `<nav>` edit for nothing | `id="side-rail"` on the `<aside>`, Task 1 Step 4 |
| §5 uses unitless `0` colour stops in the `conic-gradient` | Conic stops are `<angle-percentage>`; Blink accepts the unitless zero, but `0%` is free and unambiguous | `0%` throughout, Task 3 Step 6 |
| §5 declares `.spend-ring:focus-visible` | `.spend-ind:focus-visible` (`:1599`) is byte-identical and already applies | Rule not written |
| §6.2 cites `renderPipelineTabs` (`:13507`) | `:13507` is `const host = $('#nav-running-children');` | `:13498` |
| §5 `.brand{gap:0}` and `.side-toggle{margin:10px 0 8px}` when collapsed | The mock says `gap:6px` and `margin:10px 0 8px` | `gap:6px` (mock) and `margin:4px 0 8px` — the tighter margin is a deliberate choice, the favicon already carries 6px of brand gap above it |

---

## Task 1: Shell, toggle, favicon swap, and the icon-rail nav

> **Why this is one task and not two.** v1 split the shell (state + `.sidebar.collapsed{width:76px}`) from the nav rules that make the rail *fit*. Between those two commits, collapsing produced a 76px column containing `width:100%; padding:11px 13px` labelled rows — and because `.sidebar` is `overflow-y:auto`, CSS computes `overflow-x` to `auto`, so it grew a horizontal scrollbar. Both commits were green; the *feature* was unshippable in between. They touch the same three files. Merged.

**Files:**
- Modify: `ui/public/index.html:14-17`
- Modify: `ui/public/style.css:68-76` (in place) and a new block inserted after `:2505`, i.e. between `.stop-cancel:focus-visible,.stop-confirm:focus-visible{…}` and the blank line before the `:2507` reduced-motion comment
- Modify: `ui/public/app.js` — a state block before `:340`, one line at `:1868`, the tooltip block in `updateNavCounts` (`:13601-13620`)
- Modify: `README.md` (one line, after `:104`)
- Create: `test/ui-sidebar-collapse.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (module-private to `app.js`, used by Tasks 2 and 3):
  - `let sidebarCollapsed` — boolean
  - `function setSidebarCollapsed(v: boolean): void`
  - `function applySidebarCollapsed(): void`
- Produces (DOM contract, used by Tasks 2-3): `.sidebar.collapsed` on `<aside class="sidebar" id="side-rail">`, and `#side-toggle`.
- Produces (CSS contract, used by Task 2): the `:not(.rail-tile)` guards. **Verified live**: with only this task's CSS applied, an injected `.rail-tile` keeps `padding:11px 13px`, is *not* forced to 40×40, and its `.child-dot`/`.child-q` stay `display:block`. The guards work. **But** a `.rail-tile` styled by nothing is ~92px wide and would overflow the rail — so if Task 2 slips, do not ship Task 1 alone either.

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
// body, anchored on a non-word char (or start) so a selector ending in the same
// WORD cannot match. Note the anchor class includes whitespace, so a DESCENDANT
// selector ending in the same compound (`.sidebar.collapsed .side-foot` vs
// `.side-foot`) still can — which is why every base rule must stay ahead of the
// appended block, and why the guards below check what they matched.
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

async function boot({ seed = null, breakStorage = false, poisonToggle = false,
                      noBudget = false, budgetLatch = false } = {}) {
  // index.html SHIPS aria-expanded="true" / title="Collapse menu" /
  // aria-label="Collapse menu" on #side-toggle, so asserting those after an
  // EXPANDED boot passes even when applySidebarCollapsed() never ran — proven by
  // deleting its whole `if (btn)` branch and watching the suite stay green.
  // poisonToggle strips them, so only a real write can satisfy the assertion.
  // Each string occurs exactly once in the file (checked).
  let markup = html;
  if (poisonToggle) {
    markup = markup.replace(
      / aria-expanded="true"| title="Collapse menu"| aria-label="Collapse menu"/g, '');
  }
  const dom = new JSDOM(markup, { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  let releaseBudget = null;
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/budget')) {
      // noBudget: a promise that never settles, so paintBudget runs with
      // budgetState.budget === null (the pre-first-response state).
      if (noBudget) return new Promise(() => {});
      // budgetLatch: settles only when the test calls releaseBudget(), so the
      // FIRST budget paint of a session can be made to land AFTER a toggle.
      if (budgetLatch) {
        return new Promise((r) => { releaseBudget = () => r(
          { ok: true, status: 200, json: async () => budgetFixture() }); });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => budgetFixture() });
    }
    // The ring's click routes to #stats, which paints the stats view. Without a
    // body the paint throws AFTER the test ends ("Cannot read properties of
    // undefined (reading 'spentUsd')") and node:test fails the whole FILE on the
    // stray async activity, while the test itself reports as passing.
    if (u.includes('/api/stats')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        range: 'month', bucket: 'day',
        windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
        totals: { spentUsd: 20, workedMs: 0, runs: 0, finished: 0, stopped: 0,
          failed: 0, paused: 0, running: 0, prsOpened: 0, prsMerged: 0 },
        prev: null, budget: budgetFixture(), series: [] }) });
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
  return { window, recv, click, tick, releaseBudget: () => releaseBudget?.() };
}

// ---- CSS contract: the shell ----

test('.sidebar animates its width; the collapsed rail is 76px', () => {
  const base = ruleBody('.sidebar');
  assert.ok(base, '.sidebar rule must exist');
  // ruleBody() is NOT @media-aware: with the base rule deleted it silently
  // returns the <1080px `.sidebar{display:none}` body (style.css:911), so the
  // assert.ok above would pass on a file that lost the rule entirely.
  assert.doesNotMatch(base, /display:\s*none/,
    'ruleBody() matched the @media(max-width:1080px) body, not the base rule');
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
  // Attribute ORDER must not matter: `<img src=… class="logo-mark">` is the same
  // element. Match the tag, then assert inside it.
  const mark = html.match(/<img[^>]*class="logo-mark"[^>]*>/);
  assert.ok(mark, 'the rail wordmark <img class="logo-mark"> must exist');
  assert.match(mark[0], /src="\/assets\/worca-favicon\.png"/);
});

test('the expanded wordmark keeps its own sizing rule', () => {
  // `.brand` (style.css:76) and `.brand .logo` (:77) are ADJACENT lines. Editing
  // the wrong one silently unsizes the expanded wordmark, and nothing else in
  // the suite covers `.brand .logo`.
  const logo = ruleBody('.brand .logo');
  assert.ok(logo, '.brand .logo must survive the .brand edit');
  assert.match(logo, /height:\s*36px/);
});

test('one chevron glyph, mirrored by CSS when collapsed', () => {
  const brand = html.match(/<div class="brand">[\s\S]*?<\/button>\s*<\/div>/);
  assert.ok(brand, '.brand must close after the toggle button');
  assert.equal((brand[0].match(/<svg/g) || []).length, 1,
    'exactly one chevron SVG — the collapsed glyph is the same path, mirrored');
  assert.match(ruleBody('.sidebar.collapsed .side-toggle svg'), /transform:\s*scaleX\(-1\)/);
});

// ---- CSS contract: the icon-rail nav ----

test('collapsed nav buttons become 40px squares and drop their labels', () => {
  const btn = ruleBody('.sidebar.collapsed .nav button:not(.rail-tile)');
  assert.ok(btn, 'the generic collapsed button rule must exclude .rail-tile');
  assert.match(btn, /width:\s*40px/);
  assert.match(btn, /height:\s*40px/);
  assert.match(btn, /justify-content:\s*center/);
  assert.match(btn, /border-radius:\s*12px/, 'the base .nav button is 13px; the rail is 12px');
});

test('label spans are visually hidden but KEEP their accessible name', () => {
  const rule = '.sidebar.collapsed .nav button:not(.rail-tile) > span:not(.nav-count):not(.nav-rollup)';
  const body = ruleBody(rule);
  assert.ok(body, 'the label rule must carry the :not(.rail-tile) guard — '
    + 'without it a run tile loses its status dot and its "?" badge');
  // display:none removes the node from the accessibility tree, and this span is
  // the ONLY source of an accessible name for every nav button (index.html
  // carries no aria-label and the SVGs no <title>). Measured in Chrome: eleven
  // buttons announced with no name at all, and Running announced as "4".
  assert.doesNotMatch(body, /display:\s*none/,
    'display:none strips the only accessible name these buttons have');
  assert.match(body, /position:\s*absolute/);
  assert.match(body, /clip(-path)?:/);
});

test('section headers collapse to hairlines but keep their text nodes', () => {
  const sect = ruleBody('.sidebar.collapsed .nav-sect');
  assert.ok(sect);
  assert.match(sect, /width:\s*26px/);
  assert.match(sect, /height:\s*1px/);
  assert.match(sect, /font-size:\s*0/);
  // The labels stay in the DOM because ui-nav-sections asserts their source
  // order (:26-35). They are NOT exposed as named a11y nodes in either state —
  // measured — so do not claim that as the reason.
  assert.match(html, /class="nav-sect">Activity</);
  assert.match(html, /class="nav-sect">Build</);
  assert.match(html, /class="nav-sect">Manage</);
});

test('counts become corner badges; inert grey ones and the paused pill drop out', () => {
  const badge = ruleBody('.sidebar.collapsed .nav-count');
  assert.ok(badge);
  assert.match(badge, /position:\s*absolute/);
  // Two SEPARATE rules, not one grouped selector. Grouped, the only thing a test
  // can reach is the selector TEXT — and a grouped-selector assertion was proven
  // vacuous: regrouping `.n-grey` with a no-op declaration and hiding the badge
  // elsewhere kept the test green while grey badges stopped hiding.
  const grey = ruleBody('.sidebar.collapsed .nav-count.n-grey');
  assert.ok(grey, 'zero/inert grey badges drop out on the rail');
  assert.match(grey, /display:\s*none/);
  const hidden = ruleBody('.sidebar.collapsed #nav-paused-badge');
  assert.ok(hidden, 'the paused pill would collide with the live count in the same corner');
  assert.match(hidden, /display:\s*none/);
});

test('the rail stops reserving a scrollbar gutter it cannot afford', () => {
  const rail = ruleBody('.sidebar.collapsed');
  // ::-webkit-scrollbar{width:10px} (style.css:887) forces CLASSIC, space-
  // consuming scrollbars. The rail's own scroll height was measured at 967px
  // with four runs, so on a 900px window the gutter is claimed: 76 - 1 border
  // - 36 padding - 10 gutter = a 29px content box, and the 40px squares sit 5px
  // left of centre. This is NOT horizontal overflow, so a scrollWidth probe
  // cannot see it.
  assert.match(rail, /scrollbar-width:\s*none/);
  assert.ok(ruleBody('.sidebar.collapsed::-webkit-scrollbar'),
    'Chrome ignores scrollbar-width while ::-webkit-scrollbar is styled');
  assert.doesNotMatch(rail, /overflow/,
    'the base overflow-y:auto must survive — the rail still scrolls, it just '
    + 'stops reserving the gutter');
  const foot = ruleBody('.sidebar.collapsed .side-foot');
  assert.ok(foot, 'the collapsed foot needs its own centring rule');
  assert.match(foot, /align-items:\s*center/);
});

test('the width transition is neutralised under reduced motion', () => {
  assert.ok(/@media \(prefers-reduced-motion: reduce\)\{[\s\S]*?\*\{transition:none !important;\}/
    .test(css), 'a blanket transition kill must exist, or .sidebar animates for '
    + 'users who opted out');
});

test('the rail never declares display, so <1080px still hides the sidebar', () => {
  // @media contributes NO specificity: `.sidebar{display:none}` at style.css:911
  // is (0,1,0) and `.sidebar.collapsed` is (0,2,0), so ANY `display` here would
  // beat the media rule and float a 76px rail on top of .topnav. D2 rests
  // entirely on this rule staying display-silent, so pin it.
  assert.doesNotMatch(ruleBody('.sidebar.collapsed'), /(^|;|\s)display\s*:/,
    '.sidebar.collapsed must never declare display');
  assert.match(css, /@media \(max-width:1080px\)\{[\s\S]*?\.sidebar\{display:none;\}/,
    'the breakpoint rule this depends on must still exist');
});

test('the rail CTA is filled AND still reacts to hover', () => {
  const cta = ruleBody('.sidebar.collapsed .nav button.nav-cta');
  assert.ok(cta, 'the rail CTA must be filled — outlined-at-rest only reads next to labels');
  assert.match(cta, /background:\s*var\(--ink\)/);
  // That rule is (0,4,1) and out-specifies BOTH `.nav button:hover` (0,2,1) and
  // `.nav button.nav-cta:hover` (0,3,1), so without its own hover the rail's only
  // filled control is hover-dead. Deleting the hover rule otherwise reds nothing.
  const hov = ruleBody('.sidebar.collapsed .nav button.nav-cta:hover');
  assert.ok(hov, 'the filled CTA needs its own hover or it is inert on the rail');
  assert.match(hov, /filter:\s*brightness/);
});

test('the rail keeps its tail separator, its roll-up dot and a 40px toggle', () => {
  const sep = ruleBody('.sidebar.collapsed .nav-sep');
  assert.ok(sep, 'the divider that pins Settings must survive the rail');
  assert.match(sep, /width:\s*26px/);
  assert.match(sep, /margin-top:\s*auto/, 'without this Settings unpins from the bottom');
  // Deviation from the mock: the rail KEEPS the "a run needs you" roll-up. It sits
  // bottom-right (y 33..41 on a 40px square) while the count sits top-right
  // (y -2..15), so the two cannot collide.
  const roll = ruleBody('.sidebar.collapsed .nav-rollup');
  assert.ok(roll, "the roll-up is the rail's only \"needs your input\" signal");
  assert.match(roll, /position:\s*absolute/);
  assert.match(roll, /bottom:\s*-1px/);
  const tog = ruleBody('.sidebar.collapsed .side-toggle');
  assert.ok(tog);
  assert.match(tog, /width:\s*40px/, 'the toggle joins the 40px icon column');
});

test('the toggle is a real button with a focus ring, reachable before the nav', () => {
  const brand = html.match(/<div class="brand">[\s\S]*?<\/button>\s*<\/div>/)[0];
  assert.match(brand, /<button type="button"[^>]*id="side-toggle"/,
    'a real <button> — Enter/Space and tab order come free');
  assert.ok(html.indexOf('id="side-toggle"') < html.indexOf('<nav class="nav"'),
    'the toggle must precede the nav in source order, so it is the first tab stop');
  assert.match(ruleBody('.side-toggle:focus-visible'), /outline:\s*2px solid var\(--ink\)/);
});

// ---- Behaviour: state, toggle, persistence ----

test('boots expanded when nothing is stored', async () => {
  const { window } = await boot({ poisonToggle: true });
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), false);
  const btn = window.document.querySelector('#side-toggle');
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(btn.getAttribute('aria-label'), 'Collapse menu');
  assert.equal(btn.title, 'Collapse menu');
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
  const { window, click } = await boot({ poisonToggle: true });
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

// ---- Behaviour: tooltips, counts, routing ----

test('every collapsed nav button gains a tooltip, and loses it on expand', async () => {
  const { window, click } = await boot();
  const doc = window.document;
  const rows = () => [...doc.querySelectorAll('.nav button[data-nav]')]
    .map((b) => [b.dataset.nav, b.title]);
  assert.deepEqual(rows().filter(([n, t]) => n !== 'running' && t), [],
    'expanded rows must not grow redundant tooltips — the label is right there');
  click('#side-toggle');
  for (const [nav, title] of rows()) assert.ok(title, `collapsed ${nav} must carry a tooltip`);
  assert.equal(doc.querySelector('.nav button[data-nav="composer"]').title, 'Workflow Composer');
  assert.match(doc.querySelector('.nav button[data-nav="running"]').title, /^Running/,
    'Running keeps the count tooltip updateNavCounts owns');
  click('#side-toggle');
  assert.equal(doc.querySelector('.nav button[data-nav="composer"]').hasAttribute('title'), false);
});

test('the live count still updates on the rail (n-grey hides only the inert ones)', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [
    { runId: 'a', title: 'a', projectDir: PROJECT, status: 'running', kind: 'run',
      startedAt: '10:00:00', pendingQuestion: null }] });
  const c = window.document.querySelector('#nav-running-count');
  assert.equal(c.textContent, '1');
  assert.ok(c.classList.contains('n-run'), 'the live badge survives; only .n-grey drops out');
  assert.equal(c.classList.contains('n-grey'), false);
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
  assert.equal(btn.getAttribute('aria-label'), 'Running — 1 live, 1 paused',
    'a title is a DESCRIPTION; name-from-contents would otherwise announce "1"');
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

test('with nothing running at all the tooltip degrades to the bare label', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [] });
  // "Running — 0 live" on a resting sidebar is noise, and zero is the state most
  // users are in most of the time.
  assert.equal(window.document.querySelector('.nav button[data-nav="running"]').title,
    'Running');
});

test('paused-only names the paused count without a phantom live one', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [
    { runId: 'p', title: 'p', projectDir: PROJECT, status: 'paused', kind: 'run',
      startedAt: '10:00:00', pendingQuestion: null }] });
  assert.equal(window.document.querySelector('.nav button[data-nav="running"]').title,
    'Running — 0 live, 1 paused');
});

test('a collapsed nav button still routes', async () => {
  const { window, click, tick } = await boot({ seed: { [KEY]: '1' } });
  click('.nav button[data-nav="history"]');
  await tick();
  assert.equal(window.location.hash, '#history');
  assert.ok(window.document.querySelector('.nav button[data-nav="history"]')
    .classList.contains('active'));
});

test('the toggle still works after a view switch and a repaint', async () => {
  const { window, click, tick } = await boot();
  click('.nav button[data-nav="history"]');
  await tick();
  click('#side-toggle');
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), true,
    'the boot-time listener must survive a view switch');
});

test('toggling before the first hello or budget response does not throw', async () => {
  const { window, click } = await boot({ noBudget: true });
  click('#side-toggle');   // renderPipelineTabs + paintBudget over empty state
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), true);
  assert.equal(window.document.querySelector('#side-spend').children.length, 0);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-sidebar-collapse.test.mjs`

Expected: **FAIL — 6 pass / 23 fail.** Two things to know so you do not chase ghosts:
- The **first** failure is `.sidebar animates its width` on `/transition:\s*flex-basis/`, with the current `.sidebar` body printed as `actual`. The `ruleBody(...) === null` and `TypeError: Cannot read properties of null` failures come later.
- **Exactly five tests pass at red, and all five are correct to pass.** Do not "fix" them: `the expanded wordmark keeps its own sizing rule` (that rule already exists), `the width transition is neutralised under reduced motion` (that `@media` block already exists), `the rail never declares display, so <1080px still hides the sidebar` (half of it — the `@media` half — already holds, and `ruleBody` returns `null` for the missing rule, which `doesNotMatch` tolerates), `a garbage stored value falls back to expanded` (nothing is stored and there is no class to add), `the live count still updates on the rail` (the badge already works; only the rail styling is new) and `a collapsed nav button still routes` (routing already works; only the collapse does not).

- [ ] **Step 4: Add the id and the two brand nodes to `ui/public/index.html`**

Change line 14 from `<aside class="sidebar">` to:

```html
      <aside class="sidebar" id="side-rail">
```

Replace lines 15-17 (the `.brand` div) with:

```html
        <div class="brand">
          <img class="logo" src="/assets/worca-logo.png" alt="Worca" />
          <img class="logo-mark" src="/assets/worca-favicon.png" alt="Worca" />
          <button type="button" class="side-toggle" id="side-toggle"
                  aria-expanded="true" aria-controls="side-rail"
                  title="Collapse menu" aria-label="Collapse menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-5 6 5 6M7 5v14"></path></svg>
          </button>
        </div>
```

`<nav class="nav" aria-label="Primary">` (`:19`) is **not** touched. v1 gave it `id="side-nav"` to serve as the `aria-controls` target; the button reshapes the whole `<aside>` — brand, nav *and* the spend foot — so the aside is the correct target, and pointing there removes both the `<nav>` edit and any need to reason about `test/ui-nav-sections.test.mjs:19`'s regex.

`ui/public/assets/worca-favicon.png` already exists (it is the page favicon, `index.html:9`). Do not add an asset.

- [ ] **Step 5: Edit the two existing rules in `ui/public/style.css`**

**`.sidebar` is `:68-75`** (line 75 is the closing `}`). Add the transition as the last declaration:

```css
.sidebar{
  width:298px;flex:0 0 298px;
  background:var(--panel);
  padding:26px 18px 22px;
  display:flex;flex-direction:column;
  border-right:1px solid var(--line);
  overflow-y:auto;
  transition:flex-basis .2s cubic-bezier(.65,.02,.28,1),
             width .2s cubic-bezier(.65,.02,.28,1);
}
/* `width` is inert while .app is a flex row — flex-basis determines the used main
   size, and that is what actually animates (measured: 298 -> 270.8 -> 125.1 -> 76
   over 200ms). `width` is listed too so the fallback path animates if the flex
   context ever changes. The blanket reduced-motion transition kill at :905 is
   !important, so it neutralises both from anywhere.
   THIS COMMENT SITS OUTSIDE THE RULE ON PURPOSE — see the rule-body comment
   constraint in Global Constraints. */
```

**`.brand` is `:76`.** Replace exactly this line —

```css
.brand{display:flex;align-items:center;padding:0 8px;margin-bottom:24px;}
```

— with:

```css
.brand{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 8px;margin-bottom:24px;}
```

> **Line 77 is `.brand .logo{height:36px;width:auto;display:block;}` and must survive untouched.** v1 said "`.brand` (`:77`)"; following that deletes the expanded wordmark's sizing, and no test would have caught it. Step 2's `the expanded wordmark keeps its own sizing rule` test now does.

- [ ] **Step 6: Insert the collapsible block into `ui/public/style.css` — after `:2505`, before the `:2507` reduced-motion comment**

Find it with `grep -n 'reduced motion for the Running redesign' ui/public/style.css` rather than by line number. Not at EOF: `style.css:2508-2511` states that the reduced-motion block **must remain the last block in the file**; the only ordering this new block actually needs is *after `.spend-ind` (`:1596`)*, which this position satisfies with 900 lines to spare.

```css

/* ---------- Collapsible sidebar: the 76px icon rail ---------- */
/* Everything here is scoped under `.sidebar.collapsed` (the two exceptions,
   `.brand .logo-mark` and `.side-toggle`, style nodes that only exist for this
   feature), so the expanded 298px column is untouched. The <1080px breakpoint
   (:911) still hides the sidebar outright and hands over to .topnav — collapse
   is a preference that only exists above it, and the two never overlap. */
.brand .logo-mark{display:none;width:32px;height:32px;border-radius:50%;}
.side-toggle{display:flex;align-items:center;justify-content:center;
  width:30px;height:30px;flex:0 0 auto;padding:0;border:0;border-radius:9px;
  background:transparent;color:var(--ink-3);cursor:pointer;}
.side-toggle svg{width:17px;height:17px;}
.side-toggle:hover{background:var(--field);color:var(--ink);}
.side-toggle:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}

/* 76 - 1px border-right - 36px padding = 39px of content box. But
   ::-webkit-scrollbar (:887) makes the base rule's auto scroll gutter
   SPACE-CONSUMING, and the rail's own scroll height is ~967px with four runs — on
   a 900px window that gutter takes another 10px and shoves the icon column 5px
   off centre. Suppress it here only; the rail still scrolls by wheel and keyboard,
   and the base scrolling declaration at :74 is deliberately NOT restated.
   THIS COMMENT SITS OUTSIDE THE RULE ON PURPOSE: the test asserts this rule body
   declares no scroll-clipping and no `display`, and ruleBody() cannot tell prose
   from CSS. */
.sidebar.collapsed{width:76px;flex:0 0 76px;padding:22px 18px 18px;
  scrollbar-width:none;}
.sidebar.collapsed::-webkit-scrollbar{width:0;height:0;}
.sidebar.collapsed .brand{flex-direction:column;gap:6px;margin-bottom:8px;padding:0;}
.sidebar.collapsed .logo{display:none;}
.sidebar.collapsed .logo-mark{display:block;}
.sidebar.collapsed .side-toggle{width:40px;height:40px;margin:4px 0 8px;border-radius:12px;}
/* The mock's two chevrons are exact mirror images of one path (verified:
   reflecting M15 6l-5 6 5 6M7 5v14 about x=12 gives M9 6l5 6-5 6M17 5v14), so
   one glyph plus a flip keeps the states from ever drifting apart. */
.sidebar.collapsed .side-toggle svg{width:18px;height:18px;transform:scaleX(-1);}

/* `:not(.rail-tile)` is LOAD-BEARING on both rules below. Run tiles are
   <button>s inside .nav, so without the guard the first rule would force them
   to 40x40 and the second would hide their .child-dot and .child-q — the two
   things a tile exists to show. Verified live with a tile injected under
   Task 1's CSS alone. */
.sidebar.collapsed .nav{align-items:center;gap:6px;}
.sidebar.collapsed .nav button:not(.rail-tile){position:relative;
  width:40px;height:40px;padding:0;gap:0;justify-content:center;border-radius:12px;}
/* NOT display:none. This span is the ONLY source of an accessible name for
   every nav button — index.html carries no aria-label and the SVGs no <title> —
   and display:none removes it from the accessibility tree. Measured in Chrome:
   eleven buttons announced with no name, and Running announced as "4" (the
   count span survives, so name-from-contents wins). Same visually-hidden recipe
   as .sr-only (:1592); position:absolute takes it out of flow, so the 40px
   square still centres its glyph, and the button above is position:relative. This
   is the .sr-only recipe (:1592) plus a modern clip-path — `clip` is deprecated. */
.sidebar.collapsed .nav button:not(.rail-tile) > span:not(.nav-count):not(.nav-rollup){
  position:absolute;width:1px;height:1px;padding:0;margin:-1px;
  overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;}
/* New pipeline is the one filled control on the rail; outlined-at-rest only
   makes sense next to labels. This rule is (0,4,1) and outranks BOTH
   `.nav button:hover` (0,2,1) and `.nav button.nav-cta:hover` (0,3,1), so
   without its own hover the rail's only filled control is hover-dead. The mock
   goes to #000; brightness() keeps that intent inside the palette. */
.sidebar.collapsed .nav button.nav-cta{background:var(--ink);color:#fff;}
.sidebar.collapsed .nav button.nav-cta svg{stroke:#fff;}
.sidebar.collapsed .nav button.nav-cta:hover{filter:brightness(.55);}

/* Section headers keep their text node — test/ui-nav-sections.test.mjs:27-34
   asserts the source order (:26-35). (They are not exposed as named a11y nodes in either
   state, so that is NOT the reason.) 26px hairline, per the mock. */
.sidebar.collapsed .nav-sect{width:26px;height:1px;margin:10px auto;padding:0;
  font-size:0;letter-spacing:0;background:var(--line);overflow:hidden;}
.sidebar.collapsed .nav-sep{width:26px;margin-top:auto;}

.sidebar.collapsed .nav-count{position:absolute;top:-2px;right:-2px;margin:0;
  min-width:17px;height:17px;padding:0 4px;font-size:10px;
  border:2px solid var(--panel);}
/* Two rules, not one grouped selector: grouped, the only thing a test can reach
   is the selector TEXT, and that assertion was proven vacuous. A grey "0"
   pinned to a 40px square is noise, and the paused pill would land in the same
   corner as the live count. The paused signal is not lost — every paused run
   still shows its amber dot on its own tile, and updateNavCounts puts the
   number in the button's title AND aria-label. */
.sidebar.collapsed .nav-count.n-grey{display:none;}
.sidebar.collapsed #nav-paused-badge{display:none;}
.sidebar.collapsed .nav-rollup{position:absolute;right:-1px;bottom:-1px;margin:0;}

.sidebar.collapsed .side-foot{align-items:center;gap:8px;
  padding-top:12px;border-top:1px solid var(--line);}
```

- [ ] **Step 7: Add the state block to `ui/public/app.js`**

Insert immediately **before** the `// ------` comment banner that opens the Spend-indicator section at **`:340`** (`:339` is blank; the banner runs `:340-344`). In other words, right after the closing `}` of `scheduleReconnect` at `:338`.

Placement matters: `paintBudget` (`:365`) reads `sidebarCollapsed` in Task 3, and a `let` declared further down the file would be in its temporal dead zone for a synchronous boot paint. Everything this block calls is a hoisted function declaration, so sitting early costs nothing.

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
  // The rail has no visible labels, so mirror each button's label into a native
  // tooltip while collapsed (the mock does this on all twelve). Written by JS,
  // never as markup: a static title= on the CTA or on Settings reds
  // ui-nav-sections:48 / :57, whose regexes pin those open-tags verbatim.
  // `data-rail-title` marks the ones WE wrote, so expanding removes only those.
  // Running is excluded — updateNavCounts owns its title (the live/paused counts).
  for (const b of $$('.nav button[data-nav]:not([data-nav="running"])')) {
    if (sidebarCollapsed) {
      if (!b.dataset.railTitle) {
        const t = b.querySelector('span:not(.nav-count):not(.nav-rollup)');
        b.title = (t && t.textContent.trim()) || '';
        b.dataset.railTitle = '1';
      }
    } else if (b.dataset.railTitle) {
      b.removeAttribute('title');
      delete b.dataset.railTitle;
    }
  }
}

function setSidebarCollapsed(v) {
  sidebarCollapsed = !!v;
  // A write that throws (private mode) must not stop the in-memory flip.
  try { localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? '1' : '0'); }
  catch { /* private mode */ }
  applySidebarCollapsed();
  renderPipelineTabs();          // child rows <-> initials tiles (Task 2)
  paintBudget();                 // spend block <-> budget ring (Task 3)
}

$('#side-toggle')?.addEventListener('click', () => setSidebarCollapsed(!sidebarCollapsed));
applySidebarCollapsed();         // restore before the first paint
```

- [ ] **Step 8: Debounce the Composer's ResizeObserver (`ui/public/app.js:1868`)**

The new 200 ms `flex-basis` transition makes `.main` resize every frame for the length of one toggle. `app.js:1868` observes the composer flow with an **undebounced** callback — unlike the window-resize path directly above it — so one toggle now triggers ~12 full wire rebuilds, each doing a `getBoundingClientRect()` per node plus an SVG rebuild. It is bounded (`composerPaintWires` early-returns when `offsetParent === null`, so it only costs when the Composer is the visible view), but it is jank this feature introduces.

Change `:1868` from:

```js
  if (window.ResizeObserver) new window.ResizeObserver(() => composerDrawWires()).observe(composer.els.flow);
```

to:

```js
  // Debounced like the window-resize path above: the sidebar's 200ms collapse
  // transition resizes .main every frame, and an undebounced observer rebuilds
  // every wire ~12 times per toggle.
  if (window.ResizeObserver) new window.ResizeObserver(() => {
    clearTimeout(rt); rt = setTimeout(composerDrawWires, 80);
  }).observe(composer.els.flow);
```

`rt` is already declared at `:1866` and is in scope (verified). There is no test for this, and there cannot be: jsdom does not implement `ResizeObserver` (verified — `new JSDOM(...).window.ResizeObserver` is `undefined`), so the `if (window.ResizeObserver)` branch is unreachable under `node --test`. That is also why no composer test can regress on it. It is a perf mitigation, verified by reading; the composer suites must stay green.

- [ ] **Step 9: Add the tooltip lines to `updateNavCounts` in `ui/public/app.js`**

`updateNavCounts` (`:13601-13620`) already computes `live` and `paused`. Add this at the very end of the function, after `if (pb) pb.hidden = paused === 0;` (`:13619`):

```js
  // The rail hides #nav-paused-badge (it would collide with the live count in
  // the same corner) and shows no label, so the button's own name has to carry
  // both numbers. aria-label as well as title: a title is a DESCRIPTION, and
  // name-from-contents would otherwise announce this button as bare "4".
  // Written in BOTH states so the two can never drift apart — but at zero it
  // degrades to the plain label, because "Running — 0 live" is noise on a
  // resting sidebar, and zero is where most users are most of the time.
  const rb = $('.nav button[data-nav="running"]');
  if (rb) {
    const t = paused ? `Running — ${live} live, ${paused} paused`
      : live ? `Running — ${live} live`
      : 'Running';
    rb.title = t;
    rb.setAttribute('aria-label', t);
  }
```

- [ ] **Step 10: Add the README line**

`README.md:94-104` is the user-facing Web UI feature list (`:93` is blank). `:104` is its last bullet — `- browse **history** of past pipelines and read their saved markdown.` — and it ends with the list's terminal period while every earlier bullet ends in `;`. Change that trailing `.` to `;`, then append:

```md
- **collapse the sidebar** to a 76px icon rail (chevron at the top; the choice is remembered).
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-sidebar-collapse.test.mjs`
Expected: PASS — **29 tests**.

- [ ] **Step 12: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS, zero failures, **2901** total (2872 baseline + 29).
Pay attention to `ui-nav-sections` (16 tests), `ui-nav-buttons`, `ui-pinned-sidebar` (4), `ui-settings-icon` (2) and `ui-budget-indicator` (8) — they read the same markup and rules you just edited. All were traced and none should move.

- [ ] **Step 13: Commit**

```bash
git add ui/public/index.html ui/public/style.css ui/public/app.js README.md test/ui-sidebar-collapse.test.mjs
git commit -m "$(cat <<'EOF'
Sidebar: collapsible 76px icon rail

One boolean persisted to localStorage flips `.sidebar.collapsed`; the
wordmark swaps to the favicon and a single mirrored chevron toggles it.
Labels leave the rail visually but stay in the accessibility tree, and the
rail mirrors each label into a native tooltip. Section text collapses to
hairlines, inert badges drop out, and the hidden paused pill's number moves
into the Running button's name. The <1080px breakpoint is untouched —
collapse is a preference above it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Per-run initials tiles on the rail

**Files:**
- Modify: `ui/public/app.js:13496-13599` (`renderPipelineTabs` and the line above it)
- Modify: `ui/public/style.css` (append to the collapsible block from Task 1)
- Modify: `test/ui-sidebar-collapse.test.mjs` (append)

**Interfaces:**
- Consumes: `sidebarCollapsed` (Task 1); the `:not(.rail-tile)` guards (Task 1).
- Produces (module-private to `app.js`):
  - `function railInitials(title: string): string` — `'Fix auth bug'` → `'FA'`, `'   '` → `'?'`
  - `function tabStatusWord(r): string` — one of `'Waiting for your input' | 'Paused' | 'Starting' | 'Pausing' | 'Completed' | 'Did not complete' | 'Running'`
  - `function railTileEl(r): HTMLButtonElement` — a detached `.rail-tile`
- Produces (DOM contract): `.rail-tile[data-child-run-id]` inside `#nav-running-children`.

- [ ] **Step 1: Write the failing tests**

Append to `test/ui-sidebar-collapse.test.mjs`:

```js
// ---- Task 2: per-run initials tiles ----

const liveRun = (runId, title, extra = {}) => ({
  runId, title, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});

test('rail tiles are 36px and out-specify the generic collapsed button rule', () => {
  const tile = ruleBody('.nav .rail-tile');
  assert.ok(tile, 'scoped `.nav .rail-tile` so it outranks `.nav button` (same idiom as .nav .nav-child)');
  assert.match(tile, /width:\s*36px/);
  assert.match(tile, /height:\s*36px/);
  // `.nav button` sets gap:13px (:81) and padding:11px 13px (:82). The
  // collapsed `padding:0` lives on `…button:not(.rail-tile)`, which excludes
  // tiles BY DESIGN — so the tile must zero them itself. Measured without this:
  // a 36px border-box tile has a 7px content box holding 13.9px of text.
  assert.match(tile, /padding:\s*0/,
    'without this the tile inherits padding:11px 13px and its content box is 7px');
  assert.match(tile, /font-weight:\s*400/, 'the base .nav button is 500; the mock is 400');
  const dot = ruleBody('.nav .rail-tile .child-dot');
  assert.match(dot, /position:\s*absolute/);
  assert.doesNotMatch(dot, /box-sizing/,
    'box-sizing:content-box would make the 9px dot a 13px box (15.3px mid-pulse) '
    + 'on a 36px tile; the global border-box gives the mock its 9px total');
  const q = ruleBody('.nav .rail-tile .child-q');
  assert.match(q, /position:\s*absolute/);
  assert.match(q, /margin:\s*0/,
    'the base .child-q carries margin-left:6px (:197), which would shove the badge off the corner');
  // Both are (0,3,0), so ORDER decides — and the expanded row deliberately lets
  // `.active` win (`.nav .nav-child.active` :166 is (0,3,0) vs
  // `.nav-child.lingering` :167 at (0,2,0)). A selected lingering tile must not
  // render --ink-3 text on an --ink fill.
  assert.ok(css.indexOf('.nav .rail-tile.lingering') < css.indexOf('.nav .rail-tile.active'),
    '.active must be declared after .lingering, as the expanded row effectively is');
  const hov = ruleBody('.nav .rail-tile:hover');
  assert.ok(hov, '.nav .rail-tile:hover must exist');
  assert.match(hov, /background:\s*var\(--panel\)/,
    '.nav button:hover (:89) is (0,2,1) and out-specifies .nav .rail-tile (0,2,0), '
    + 'so a hovered tile would flip to var(--field)/var(--ink) — the expanded row '
    + 'restates them at :163 for the same reason');
});

test('collapsed, child rows render as initials tiles instead', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [liveRun('r1', 'Fix auth bug'), liveRun('r2', 'seo')] });
  const doc = window.document;
  const tiles = doc.querySelectorAll('#nav-running-children .rail-tile');
  assert.equal(tiles.length, 2);
  assert.equal(doc.querySelectorAll('#nav-running-children .nav-child').length, 0);
  // Address by run id, NEVER by index: cmpTabRuns sorts newest-orderKey first
  // (app.js:12377-12381), so this payload renders [r2, r1]. Every existing
  // ui-pipeline-tabs test uses the same idiom.
  const t1 = doc.querySelector('.rail-tile[data-child-run-id="r1"]');
  const t2 = doc.querySelector('.rail-tile[data-child-run-id="r2"]');
  assert.equal(t1.textContent.trim(), 'FA', 'first letters of the first two words');
  assert.equal(t2.textContent.trim(), 'S', 'a one-word title yields one letter');
  assert.match(t1.title, /^Fix auth bug · Running$/);
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

test('a blank title still yields a readable tile, never an empty square', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [liveRun('r1', '   ')] });
  const tile = window.document.querySelector('.rail-tile[data-child-run-id="r1"]');
  // Proven vacuous in v1: deleting the `|| '?'` fallback kept every test green.
  assert.equal(tile.textContent.trim(), '?',
    'a titleless run must not render a blank tile');
  assert.match(tile.title, /^Untitled run · /,
    'and its tooltip must not open with a bare separator');
});

test('initials survive emoji, CJK and sharp-s', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [
    liveRun('e', '🎉 launch'), liveRun('c', '修复 登录'), liveRun('s', 'ß sharp'),
  ] });
  const t = (id) => window.document
    .querySelector(`.rail-tile[data-child-run-id="${id}"]`).textContent.trim();
  // `w[0]` is a UTF-16 CODE UNIT: '🎉 launch' would yield a lone high surrogate
  // ("\ud83cL") and render as "?L". Run titles are free text.
  assert.equal([...t('e')].length, 2, 'one emoji + one letter, not a lone surrogate');
  assert.equal(t('e'), '🎉L');
  assert.equal(t('c'), '修登');
  // 'ß'.toUpperCase() is 'SS' — two glyphs from one letter would make three on
  // a two-glyph tile.
  assert.equal(t('s'), 'SS', 'S from ß, S from sharp — never SSS');
});

test('a starting or pausing run says so, matching its grey-pulse dot', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [
    liveRun('s1', 'Boot up', { status: 'starting' }),
    liveRun('p1', 'Wind down', { status: 'pausing' }),
  ] });
  const doc = window.document;
  // runDotClass gives BOTH of these their own grey-pulse dot (app.js:12388-12389).
  // A grey-pulsing dot next to the word "Running" is the dot and the label
  // disagreeing on one 36px square. Without this test, deleting either branch of
  // tabStatusWord leaves the whole suite green.
  assert.ok(doc.querySelector('.rail-tile[data-child-run-id="s1"] .child-dot.grey-pulse'));
  assert.ok(doc.querySelector('.rail-tile[data-child-run-id="p1"] .child-dot.grey-pulse'));
  assert.match(doc.querySelector('.rail-tile[data-child-run-id="s1"]').title, /· Starting$/);
  assert.match(doc.querySelector('.rail-tile[data-child-run-id="p1"]').title, /· Pausing$/);
});

test('a tile is labelled for screen readers, and greys out once it lingers', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  const doc = window.document;
  recv({ type: 'hello', runs: [liveRun('r1', 'Fix auth bug')] });
  let tile = doc.querySelector('.rail-tile[data-child-run-id="r1"]');
  assert.equal(tile.getAttribute('aria-label'), 'Fix auth bug · Running',
    'the initials alone are meaningless to a screen reader');
  assert.equal(tile.classList.contains('lingering'), false);
  recv({ type: 'done', runId: 'r1', status: 'done' });   // finishes live -> lingers
  tile = doc.querySelector('.rail-tile[data-child-run-id="r1"]');
  assert.ok(tile.classList.contains('lingering'),
    'a finished-unseen run is greyed on the rail exactly as its expanded row is');
  assert.equal(tile.getAttribute('aria-label'), 'Fix auth bug · Completed');
});

test('an empty run list renders an empty rail without throwing', async () => {
  const { window, recv } = await boot({ seed: { [KEY]: '1' } });
  recv({ type: 'hello', runs: [] });
  const host = window.document.querySelector('#nav-running-children');
  assert.equal(host.querySelectorAll('.rail-tile').length, 0);
  assert.equal(window.document.querySelector('#nav-running-rollup').hidden, true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-sidebar-collapse.test.mjs`
Expected: **FAIL — 30 pass / 10 fail.** No `.rail-tile` exists, so `ruleBody('.nav .rail-tile')` is `null`. All 29 Task 1 tests stay green, and `an empty run list renders an empty rail without throwing` passes at red — correct, there is nothing to render either way.

- [ ] **Step 3: Add the three helpers to `ui/public/app.js`**

Insert between `let runningCollapsed = false;` (**`:13496`**) and `function renderPipelineTabs() {` (**`:13498`**). v1 said `:13507`; that line is `const host = $('#nav-running-children');`, inside the function.

```js
// The rail shows a 36px square per run instead of a titled row. Initials are
// the mock's algorithm (Worca Running.dc.html:1076) with two corrections it
// does not make: `w[0]` is a UTF-16 CODE UNIT, so an emoji title yields a lone
// high surrogate ('🎉 launch' -> "\ud83cL" -> "?L"); and 'ß'.toUpperCase() is
// 'SS', so a two-glyph tile would render three.
function railInitials(title) {
  const firstGlyph = (w) => {
    const c = [...w][0] || '';
    return [...c.toUpperCase()][0] || c;
  };
  return String(title || '').split(/\s+/).filter(Boolean).slice(0, 2)
    .map(firstGlyph).join('') || '?';
}

// The word the tile's tooltip ends with. Mirrors the same branch the expanded
// row uses for its end-marker, so the two states cannot disagree. `starting`
// and `pausing` are named explicitly because runDotClass gives them their own
// grey-pulse dot (:12389) — a grey-pulsing dot next to the word "Running" is
// the dot and the label disagreeing on one 36px square.
function tabStatusWord(r) {
  if (r.pendingQuestion != null) return 'Waiting for your input';
  if (isPaused(r)) return 'Paused';
  if (r._finished || isTerminalStatus(r.status)) {
    return r.status === 'done' ? 'Completed' : 'Did not complete';
  }
  if (r.status === 'starting') return 'Starting';
  if (r.status === 'pausing') return 'Pausing';
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
  // `r.title` is free text and '   ' is TRUTHY, so `||` alone yields
  // "    · Running". railInitials already trims via split(/\s+/).filter(Boolean);
  // the label has to as well, and Step 1's test pins it.
  const label = `${String(r.title || '').trim() || 'Untitled run'} · ${tabStatusWord(r)}`;
  tile.title = label;
  // The initials are meaningless to a screen reader, so the tile needs a real
  // name; `aria-label` also beats name-from-contents, which would read "FA".
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

In `renderPipelineTabs`, at **`:13521`** (v1 said `:13522`), change the first line of the `sig` array from

```js
  const sig = JSON.stringify([runningCollapsed, rows.map((r) => [
```

to

```js
  // sidebarCollapsed is FIRST and load-bearing: this function early-returns on an
  // unchanged signature (:13534), so without it a collapse/expand leaves the
  // previous mode's markup on screen until the next server event happens to arrive.
  const sig = JSON.stringify([sidebarCollapsed, runningCollapsed, rows.map((r) => [
```

- [ ] **Step 5: Fork the row loop**

Same function, **`:13540-13541`**. `host.innerHTML = ''` already ran at `:13539`, and nothing follows the loop (the function ends at `:13599`), so a `continue` as the loop's first statement is safe. The loop currently opens with:

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

Append **immediately after the `.sidebar.collapsed .side-foot{…}` rule that currently ends the block from Task 1 Step 6**, and before the `/* ---------- reduced motion for the Running redesign ---------- */` comment (`grep -n 'reduced motion for the Running redesign' ui/public/style.css`). Order inside the block is load-bearing: `.lingering` must be declared before `.active`, and the test asserts it with `css.indexOf`.

```css
/* ---- rail run tiles ---- */
/* Scoped `.nav .rail-tile` (0,2,0) for the same reason `.nav .nav-child` is
   scoped (:135-144): it has to outrank the generic `.nav button` (0,1,1).
   `padding` and `gap` must be restated — the collapsed `padding:0` rule
   deliberately excludes `.rail-tile`, so a tile would otherwise inherit
   `padding:11px 13px` and hold its initials in an 8px content box. */
.sidebar.collapsed .nav-children{align-items:center;gap:5px;margin-top:5px;}
.nav .rail-tile{position:relative;display:flex;align-items:center;justify-content:center;
  width:36px;height:36px;padding:0;gap:0;
  border:1.5px solid var(--line-2);border-radius:11px;
  background:var(--panel);color:var(--ink-2);
  font-family:var(--mono);font-size:11.5px;font-weight:400;cursor:pointer;
  transition:border-color .15s,background .15s,color .15s;}
/* `.nav button:hover` (:89) is (0,2,1) and OUT-specifies `.nav .rail-tile`
   (0,2,0), so background and color must be restated here or a hovered tile flips
   to var(--field)/var(--ink). `.nav .nav-child:hover` (:163) restates them for
   exactly this reason. */
.nav .rail-tile:hover{background:var(--panel);color:var(--ink-2);border-color:var(--ink);}
.nav .rail-tile:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
/* `.lingering` BEFORE `.active`: both are (0,3,0), so source order decides, and
   a selected lingering tile must not render --ink-3 text on an --ink fill. The
   expanded row gets the same precedence for free, on specificity (:166-167). */
.nav .rail-tile.lingering{color:var(--ink-3);}
.nav .rail-tile.active{background:var(--ink);border-color:var(--ink);color:#fff;}
/* No `box-sizing:content-box`: the global border-box (:52) makes this a 9px
   total — a 5px core inside a 2px panel ring, exactly the mock. content-box
   would make it 13px, and 15.3px at the dotpulse peak (:671), on a 36px tile. */
.nav .rail-tile .child-dot{position:absolute;right:-2px;bottom:-2px;margin:0;
  width:9px;height:9px;border:2px solid var(--panel);}
/* `margin:0` overrides the base .child-q's margin-left:6px (:197), which would
   otherwise shove this absolutely-positioned badge off the corner. The base
   `animation:pulse` (:199) is kept on purpose — a run waiting on you should
   pulse — and the reduced-motion block at :904 already names .child-q. */
.nav .rail-tile .child-q{position:absolute;top:-5px;right:-5px;margin:0;
  display:flex;align-items:center;justify-content:center;
  width:15px;height:15px;border:2px solid var(--panel);border-radius:50%;
  background:var(--amber);color:#fff;font-size:9px;font-weight:700;}
```

- [ ] **Step 7: Run to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-sidebar-collapse.test.mjs`
Expected: PASS — **40 tests** (29 from Task 1 + 11).

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS, **2912**. `ui-pipeline-tabs` is the one to watch — it exercises the expanded branch you forked, and all **17** of its tests must still pass unchanged.

- [ ] **Step 9: Commit**

```bash
git add ui/public/app.js ui/public/style.css test/ui-sidebar-collapse.test.mjs
git commit -m "$(cat <<'EOF'
Sidebar: per-run initials tiles on the collapsed rail

renderPipelineTabs forks on sidebarCollapsed — same run list, same order,
same click target, rendered as 36px squares with initials, the existing
status dot and the pending-input badge. Initials are computed over code
points, so an emoji title cannot produce a lone surrogate. sidebarCollapsed
joins tabsSig so a toggle actually repaints.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Circular budget indicator

**Files:**
- Modify: `ui/public/stats-view.mjs` — append after `renderBudgetIndicator` (`:197-219`)
- Modify: `ui/public/app.js:79` (import) and `:370-373` (`paintBudget`)
- Modify: `ui/public/style.css` (append to the collapsible block)
- Modify: `test/ui-budget-indicator.test.mjs` (insert before `:206`)
- Modify: `test/ui-sidebar-collapse.test.mjs` (append)

**Interfaces:**
- Consumes: `sidebarCollapsed` (Task 1).
- Produces: `export function renderBudgetRing(budget, { doc, fmt }): HTMLButtonElement` — a detached `button.spend-ind.spend-ring` carrying `data-nav="stats"`, the inline custom property `--ring-pct`, and one `span.spend-ring-val` child.
- Private to `stats-view.mjs`: `function ringAmount(n): string`. **The name `compactUsd` is already taken in that module** (`:330`, the chart y-axis formatter) and a duplicate top-level declaration is a fatal `SyntaxError`.

- [ ] **Step 1: Write the failing unit tests**

`test/ui-budget-indicator.test.mjs` has **no** `stats-view.mjs` import today — this is its first direct use of the module. Add one new line after `import { JSDOM } from 'jsdom';` (`:12`):

```js
import { renderBudgetRing } from '../ui/public/stats-view.mjs';
```

Then insert the block below **after line 204** (the end of `'a run finishing refetches the budget…'`) and **before** the `// The two tick suites run last:` comment at `:206`. That ordering comment is a load-bearing invariant of the file — those two suites leak a 5 ms interval that repaints whatever document is global at the time — not decoration. Do not append at EOF.

The file already imports `JSDOM` (`:12`) and defines `DAY` (`:19`); it defines no local `fmt`, and it does not need one — `renderBudgetRing`'s `fmt` defaults to the exported `DEFAULT_FMT` (`stats-view.mjs:20`), which carries `.usd` and `.usd4`.

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
    'app.js:436 routes the sidebar spend click via closest(".spend-ind")');
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

test('the ring clamps its arc to 0-100 whatever the raw ratio is', () => {
  // Both clamps were proven vacuous in v1 — deleting either kept every test green.
  const hot = renderBudgetRing(ringBudget({ windowSpendUsd: 75 }), { doc: pureDoc() });
  assert.equal(hot.style.getPropertyValue('--ring-pct'), '100',
    '150% of the cap must not sweep the arc past a full circle');
  assert.equal(hot.querySelector('.spend-ring-val').textContent, '100%');
  const credit = renderBudgetRing(ringBudget({ windowSpendUsd: -5 }), { doc: pureDoc() });
  assert.equal(credit.style.getPropertyValue('--ring-pct'), '0',
    'a refund/credit must not sweep a negative arc');
  assert.equal(credit.querySelector('.spend-ring-val').textContent, '0%');
});

test('a zero limit with zero spend cannot emit NaN into the gradient', () => {
  // 0/0 is NaN, and calc(NaN * 1%) is invalid at computed-value time — it takes
  // the whole conic-gradient with it and the ring disappears.
  const el = renderBudgetRing(ringBudget({ totalLimitUsd: 0, windowSpendUsd: 0 }), { doc: pureDoc() });
  assert.equal(el.style.getPropertyValue('--ring-pct'), '0');
  assert.equal(el.querySelector('.spend-ring-val').textContent, '0%');
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
  // 999.5 rounds to 1000 — five glyphs unless the branch tests the ROUNDED value.
  assert.equal(val(999.5), '$1.0k');
  assert.equal(val(3168.85), '$3.2k');
  assert.equal(val(9949), '$9.9k');
  assert.equal(val(12400), '$12k');
});
```

- [ ] **Step 2: Write the failing integration tests**

Append to `test/ui-sidebar-collapse.test.mjs`:

```js
// ---- Task 3: circular budget indicator ----

test('the ring is 38px, composes its arc from --ring-pct, and recolours by band', () => {
  const ring = ruleBody('.spend-ring');
  assert.ok(ring, '.spend-ring rule must exist');
  assert.match(ring, /width:\s*38px/);
  assert.match(ring, /border-radius:\s*50%/);
  assert.match(ring, /conic-gradient/, 'the arc is drawn in CSS, not as an inline background');
  assert.match(ring, /var\(--ring-pct\)/, 'one definition of the gradient, swappable by class');
  assert.match(ruleBody('.spend-ring.warn'), /--ring-fill:\s*var\(--amber-ink\)/);
  assert.match(ruleBody('.spend-ring.over'), /--ring-fill:\s*var\(--red-ink\)/);
  const flat = ruleBody('.spend-ring.no-limit');
  assert.ok(flat, 'the no-limit ring gets a flat neutral track');
  assert.match(flat, /--ring-fill:\s*var\(--ink-3\)/,
    'var(--line) on var(--panel) is ~1.18:1 — a ring nobody can see is not "neutral"');
});

test('hovering the ring keeps its arc', () => {
  // `.spend-ind:hover` (style.css:1598) is (0,2,0) and a bare `.spend-ring` is
  // (0,1,0), so its flat `background:var(--line)` WINS on specificity — source
  // order never gets consulted. Measured in Chrome without this rule:
  // background-image goes to `none` and the disc turns solid #ECECEA.
  const hov = ruleBody('.spend-ring:hover');
  assert.ok(hov, '.spend-ring:hover must exist or the arc dies on every hover');
  assert.match(hov, /conic-gradient/);
  assert.match(hov, /var\(--ring-pct\)/);
  assert.ok(css.indexOf('.spend-ind:hover') < css.indexOf('.spend-ring:hover'),
    'equal specificity — it can only win on source order');
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

test('clicking the ring really routes to #stats, not just carrying the class', async () => {
  const { window } = await boot({ seed: { [KEY]: '1' } });
  window.location.hash = 'running';
  // Click the INNER span: app.js:436 resolves it via closest('.spend-ind'), so a
  // ring that merely looks right but drops the class fails here. Asserting the
  // classList alone asserts the PREMISE of the routing, never the routing.
  window.document.querySelector('#side-spend .spend-ring-val')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(window.location.hash, '#stats');
});

test('a budget that lands AFTER a collapse mounts the ring, not the block', async () => {
  // paintBudget early-returns while budgetState.budget is null (app.js:369), so on
  // a slow /api/budget the FIRST paint of the session happens after the user has
  // already toggled. The late paint must read the CURRENT sidebarCollapsed.
  const { window, click, releaseBudget, tick } = await boot({ budgetLatch: true });
  const doc = window.document;
  click('#side-toggle');
  assert.equal(doc.querySelector('#side-spend').children.length, 0, 'nothing painted yet');
  releaseBudget();
  await tick(); await tick();
  assert.ok(doc.querySelector('#side-spend .spend-ring'));
  assert.equal(doc.querySelector('#side-spend .spend-ind-row'), null);
});

test('#topnav-spend is mode-independent', async () => {
  const { window, click } = await boot({ seed: { [KEY]: '1' } });
  const top = window.document.querySelector('#topnav-spend');
  assert.equal(top.hidden, false);
  const before = top.textContent;
  click('#side-toggle');
  assert.equal(top.textContent, before, 'the topnav twin must not follow the rail');
  assert.equal(top.hidden, false);
});
```

- [ ] **Step 3: Run both files to verify they fail**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-sidebar-collapse.test.mjs test/ui-budget-indicator.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../ui/public/stats-view.mjs' does not provide an export named 'renderBudgetRing'`.

- [ ] **Step 4: Add the renderer to `ui/public/stats-view.mjs`**

Insert directly after `renderBudgetIndicator` ends at `:219`, before the `/** Settings budget readout … */` comment at `:221`. It reuses the file's existing `h` (`:33`), `periodWord` (`:76`), `fmtResetAt` (`:64`), `BUDGET_WARN_AT` (`:15`) and `DEFAULT_FMT` (`:20`).

```js
/** Compact centre label for the ring: $4 · $317 · $3.2k · $12k — never more than
 *  five characters, which is what fits inside a 28px disc at 9.5px mono.
 *  NAME: `ringAmount`, not `compactUsd` — this module ALREADY declares
 *  `compactUsd(fmt, v)` at :330 (the spend-chart y-axis formatter), and a second
 *  top-level function declaration in an ES module is a fatal SyntaxError, not a
 *  shadow: it takes down stats-view.mjs, app.js and the whole UI. */
function ringAmount(n) {
  const v = n || 0;
  if (v >= 9950) return `$${Math.round(v / 1000)}k`;
  // The ROUNDED value decides: 999.5 would otherwise fall through and render
  // "$1000", five glyphs in a four-glyph disc.
  if (Math.round(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

/** Collapsed-rail budget ring — the sidebar indicator's 38px twin.
 *  Keeps the `spend-ind` class because app.js routes the sidebar spend click
 *  through `closest('.spend-ind')` (:436). The arc percentage travels as the
 *  custom property `--ring-pct` and the gradient is composed in the stylesheet,
 *  so there is one definition of it and the cascade can swap the band colours by
 *  class. With no total limit there is no denominator, so the ring shows a flat
 *  neutral track and the amount rather than a fabricated percentage. */
export function renderBudgetRing(budget, { doc = globalThis.document, fmt = DEFAULT_FMT } = {}) {
  const b = budget || {};
  const btn = h(doc, 'button', 'spend-ind spend-ring');
  btn.type = 'button';
  btn.dataset.nav = 'stats';
  const hasLimit = b.totalLimitUsd != null;
  const ratio = hasLimit ? (b.windowSpendUsd || 0) / b.totalLimitUsd : 0;
  // Clamped both ways, and NaN-guarded: over-cap spend must not sweep past a full
  // circle, a refund must not sweep a negative arc, and `totalLimitUsd:0` with
  // zero spend is 0/0 -> NaN, which makes `calc(NaN * 1%)` invalid at
  // computed-value time and takes the whole conic-gradient down with it.
  const raw = Math.round(ratio * 100);
  const pct = b.blocked ? 100
    : (Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0);

  if (!hasLimit) btn.classList.add('no-limit');
  else if (b.blocked) btn.classList.add('over');
  else if (ratio >= BUDGET_WARN_AT) btn.classList.add('warn');

  btn.style.setProperty('--ring-pct', String(hasLimit ? pct : 0));
  btn.title = `Estimated spend this ${periodWord(b)}: ${fmt.usd4(b.windowSpendUsd)}` +
    (hasLimit ? ` of ${fmt.usd(b.totalLimitUsd)}` : ' — no total limit') +
    ` · resets ${fmtResetAt(b.windowEndMs)} — Claude Code client-side estimate ` +
    `(total_cost_usd), not authoritative billing`;
  btn.appendChild(h(doc, 'span', 'spend-ring-val',
    hasLimit ? `${pct}%` : ringAmount(b.windowSpendUsd)));
  return btn;
}
```

> **Two decided edge cases, so nobody re-opens them.** `totalLimitUsd: 0` with *nonzero* spend yields `ratio = Infinity` → `pct = 100`: exact parity with `renderBudgetIndicator` (`:202`), deliberate, do not "fix" it here alone. And `blocked: true` with `totalLimitUsd: null` renders `.no-limit` (grey), **not** `.over` (red): with no denominator there is no arc to redden, and the block in that case comes from a per-pipeline limit the ring never meters — again exact parity with `renderBudgetIndicator`, which also shows only "no total limit" there.

- [ ] **Step 5: Wire it into `paintBudget`**

In `ui/public/app.js:79`, add `renderBudgetRing` to the existing import:

```js
import { renderStatsBody, renderBudgetIndicator, renderBudgetRing, renderBudgetReadout, renderCostPauseBanner, BUDGET_WARN_AT } from './stats-view.mjs';
```

In `paintBudget`, at **`:370-373`** (the function itself opens at `:365`), replace:

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

Append **immediately after the `.nav .rail-tile .child-q{…}` rule that now ends the block**, still before the `/* ---------- reduced motion for the Running redesign ---------- */` comment. These must sit after `.spend-ind` (`:1596`) — this position is ~900 lines past it.

```css
/* ---- rail budget ring ---- */
/* `.spend-ring` (0,1,0) ties `.spend-ind` (0,1,0) and wins the tie on source
   order, which is what lets it override display / width / text-align / border /
   border-radius / background / padding. `.spend-ind:focus-visible` (:1599) is
   already identical to what a `.spend-ring:focus-visible` would say, so no such
   rule is written. `:hover` is the one case order cannot fix — see below. */
.spend-ring{--ring-pct:0;--ring-fill:var(--blue-ink);--ring-track:var(--blue-bg);
  display:flex;align-items:center;justify-content:center;text-align:center;
  width:38px;height:38px;padding:0;border:0;border-radius:50%;cursor:pointer;
  background:conic-gradient(var(--ring-fill) 0% calc(var(--ring-pct) * 1%),
                            var(--ring-track) 0%);}
/* `.spend-ind:hover{background:var(--line)}` (:1598) is (0,2,0) and OUT-SPECIFIES
   a bare `.spend-ring` (0,1,0) — measured in Chrome: hovering set
   background-image to `none` and the disc to solid #ECECEA, destroying the arc.
   Specificity is decided before source order, so the gradient has to be restated
   at (0,2,0). brightness() supplies the hover feedback that the flat fill used to. */
.spend-ring:hover{background:conic-gradient(var(--ring-fill) 0% calc(var(--ring-pct) * 1%),
                                            var(--ring-track) 0%);
  filter:brightness(.96);}
.spend-ring.warn{--ring-fill:var(--amber-ink);--ring-track:var(--amber-bg);}
.spend-ring.over{--ring-fill:var(--red-ink);--ring-track:var(--red-bg);}
/* No total limit means no denominator: a flat neutral ring, and the centre shows
   the amount instead of a percentage nothing backs. var(--ink-3), not var(--line)
   — var(--line) on var(--panel) is ~1.18:1 across a 5px annulus, i.e. an absent
   ring, which is not the same thing as a neutral one. */
.spend-ring.no-limit{--ring-fill:var(--ink-3);--ring-track:var(--ink-3);}
.spend-ring-val{display:flex;align-items:center;justify-content:center;
  width:28px;height:28px;border-radius:50%;background:var(--panel);
  font-family:var(--mono);font-size:9.5px;color:var(--ink-2);}
```

- [ ] **Step 7: Run both files to verify they pass**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-sidebar-collapse.test.mjs test/ui-budget-indicator.test.mjs`
Expected: PASS — **46 tests** in `ui-sidebar-collapse`, **15** in `ui-budget-indicator` (8 existing + 7).

> **If instead the whole run dies with `SyntaxError: Identifier 'compactUsd' has already been declared`**, you named the helper `compactUsd`. Rename it to `ringAmount`. That is the single most likely way to fail this task.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS, **2925** (2872 + 46 + 7), zero failures.

- [ ] **Step 9: Commit**

```bash
git add ui/public/stats-view.mjs ui/public/app.js ui/public/style.css test/ui-budget-indicator.test.mjs test/ui-sidebar-collapse.test.mjs
git commit -m "$(cat <<'EOF'
Sidebar: circular budget indicator on the collapsed rail

renderBudgetRing is the 38px twin of the spend block: same warn/over
bands, same click-through to #stats. The arc percentage travels as
--ring-pct so one gradient definition lives in CSS, and the rule is
restated at :hover because .spend-ind:hover out-specifies it and would
erase the arc. With no total limit the ring goes neutral and shows the
amount rather than a fabricated percentage.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Real-browser verification, then finish the branch

Every preceding task proved behaviour under jsdom, which lays nothing out and exposes no accessibility tree. This task proves the rail is actually 76px in a real engine, that nothing overflows, that the arc survives a hover, and that every rail button still has a name — the four classes of bug jsdom structurally cannot catch.

> **Why v1's probe is replaced wholesale.** It only `console.log`ged, so `node verify-rail.mjs` exited 0 whatever the numbers said. Its `labelVisible` field asserted `display !== 'none'` **is false** — i.e. it locked in the accessibility regression. It ran against a fresh `WORCA_HOME` with zero runs, so the rail tiles, the very thing most likely to overflow, were never laid out. It hard-coded a scratchpad path from a different session. And `evaluate('location.reload()')` races the execution-context teardown. All fixed below.

**Files:**
- Create: `<YOUR-SCRATCHPAD>/verify-rail.mjs` (throwaway — never committed). `<YOUR-SCRATCHPAD>` is the scratchpad directory named in your own system prompt; never hard-code a session id.

- [ ] **Step 1: Start the dev server on a throwaway home**

```bash
export WORCA_VERIFY_HOME="$(mktemp -d)"
WORCA_HOME="$WORCA_VERIFY_HOME" npm start > /tmp/worca-verify.log 2>&1 &
echo "$!" > /tmp/worca-verify.pid
until grep -q '\[worca-ui\]' /tmp/worca-verify.log; do sleep 0.5; done
```

It listens on `http://127.0.0.1:4317` (`ui/server.mjs:120`, host `:124`); the `until` loop is the "wait for the `[worca-ui]` line" step, and the PID file is what Step 5 kills. `mktemp -d` rather than `.worca-cc-verify`: `.gitignore` lists `.worca-cc/`, `.worca-cc-smoke/` and `.worca-cc-test/` but **not** `.worca-cc-verify/`, so a crash before cleanup would leave the tree dirty.

- [ ] **Step 2: Write the CDP probe**

Create `<YOUR-SCRATCHPAD>/verify-rail.mjs`. It drives headless Chrome over the DevTools protocol with the platform's native `WebSocket` — no puppeteer, no new dependency. The window is deliberately **short** (700px) and four tiles are injected, because the scrollbar-gutter bug only exists when the rail overflows vertically.

```js
// Throwaway layout probe. Measures the sidebar in both states in a real engine
// and EXITS NON-ZERO on any failure — this is a test, not a demo.
const CHROME = process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { spawn } = await import('node:child_process');
const { mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');

const profile = mkdtempSync(join(tmpdir(), 'worca-rail-'));
const chrome = spawn(CHROME, [
  '--headless', '--remote-debugging-port=9222',
  `--user-data-dir=${profile}`, '--window-size=1440,700',
  'http://127.0.0.1:4317',
], { stdio: 'ignore' });

// Poll for the target instead of a fixed sleep.
let page = null;
for (let i = 0; i < 40 && !page; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try {
    const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
    page = targets.find((t) => t.type === 'page' && t.url.includes('4317')) || null;
  } catch { /* not up yet */ }
}
if (!page) { console.error('FAIL: Chrome never exposed a page target on 4317'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (!m.id || !pending.has(m.id)) return;          // an event, not a reply
  const { res, rej } = pending.get(m.id);
  pending.delete(m.id);
  m.error ? rej(new Error(`${m.error.message} (${JSON.stringify(m.error)})`)) : res(m.result);
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  pending.set(n, { res, rej });
  ws.send(JSON.stringify({ id: n, method, params }));
  setTimeout(() => { if (pending.delete(n)) rej(new Error(`CDP timeout: ${method}`)); }, 15000);
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`page threw: ${r.exceptionDetails.text}`);
  return r.result.value;
};
const settle = async () => {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    // evaluate() rethrows CDP errors, and Page.reload tears the execution context
    // down and recreates it — the first poll can escape as "Cannot find context
    // with specified id" instead of simply retrying.
    try {
      if (await evaluate(`document.readyState === 'complete' && !!document.querySelector('#side-spend > *')`)) return;
    } catch { /* context swapped by the reload — retry */ }
  }
  throw new Error('page never finished booting');
};

await send('Page.enable');
await send('Accessibility.enable');
// Reload rather than navigate — a fresh navigation swaps the target out from
// under this socket.
await send('Page.reload', { ignoreCache: true });
await settle();

// Fresh WORCA_HOME means zero runs, so the rail tiles — the thing most likely to
// overflow, and the reason the rail scrolls at all — would never be laid out.
// Inject four, shaped exactly as railTileEl builds them.
const seedTiles = `(() => {
  const host = document.querySelector('#nav-running-children');
  host.classList.remove('hidden');
  host.querySelectorAll('.rail-tile').forEach((n) => n.remove());
  for (const [rid, ini] of [['a','FA'],['b','S'],['c','WK'],['d','ZZ']]) {
    const t = document.createElement('button');
    t.type = 'button'; t.className = 'rail-tile'; t.dataset.childRunId = rid;
    t.title = rid; t.setAttribute('aria-label', rid + ' · Running');
    t.appendChild(document.createTextNode(ini));
    const d = document.createElement('span'); d.className = 'child-dot peach'; t.appendChild(d);
    const q = document.createElement('span'); q.className = 'child-q'; q.textContent = '?'; t.appendChild(q);
    host.appendChild(t);
  }
  return host.querySelectorAll('.rail-tile').length;
})()`;

const measure = `(() => {
  const a = document.querySelector('.sidebar');
  const r = a.getBoundingClientRect();
  const foot = document.querySelector('#side-spend > *');
  const label = document.querySelector('.nav button[data-nav="running"] > span');
  const lc = getComputedStyle(label);
  const hist = document.querySelector('.nav button[data-nav="history"]').getBoundingClientRect();
  const tile = document.querySelector('#nav-running-children .rail-tile');
  const tr = tile ? tile.getBoundingClientRect() : null;
  const q = tile ? tile.querySelector('.child-q').getBoundingClientRect() : null;
  return {
    width: Math.round(r.width),
    clientW: a.clientWidth,
    collapsed: a.classList.contains('collapsed'),
    overflowsX: a.scrollWidth > a.clientWidth + 1,
    overflowsY: a.scrollHeight > a.clientHeight + 1,
    labelDisplay: lc.display,
    labelPosition: lc.position,
    footClass: foot ? foot.className : null,
    ringBg: foot ? getComputedStyle(foot).backgroundImage.slice(0, 14) : null,
    mainLeft: Math.round(document.querySelector('.main').getBoundingClientRect().left),
    navOffCentre: Math.abs(hist.left - (r.width - 1 - hist.width) / 2),
    tile: tr ? { w: Math.round(tr.width), h: Math.round(tr.height) } : null,
    qRight: q ? Math.round(q.right) : null,
  };
})()`;

const axButtonNames = async () => {
  const { nodes } = await send('Accessibility.getFullAXTree');
  return nodes.filter((n) => n.role?.value === 'button')
    .map((n) => (n.name?.value || '').trim());
};

const exp = await evaluate(measure);
await evaluate(`document.querySelector('#side-toggle').click()`);
await evaluate(seedTiles);
await new Promise((r) => setTimeout(r, 400));   // let the .2s transition settle
const col = await evaluate(measure);
const names = await axButtonNames();

// Hover the ring in the real engine: .spend-ind:hover is (0,2,0) and would erase
// the conic-gradient if .spend-ring:hover is missing.
const ringBox = await evaluate(
  `(() => { const r = document.querySelector('#side-spend .spend-ring').getBoundingClientRect();
     return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ringBox.x, y: ringBox.y });
await new Promise((r) => setTimeout(r, 120));
const ringHoverBg = await evaluate(
  `getComputedStyle(document.querySelector('#side-spend .spend-ring')).backgroundImage`);

await send('Page.reload', { ignoreCache: false });
await settle();
const re = await evaluate(measure);

console.log('expanded :', exp);
console.log('collapsed:', col);
console.log('reloaded :', re);
console.log('ax button names:', names);
console.log('ring bg on hover:', ringHoverBg.slice(0, 40));

let failed = 0;
const check = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); failed++; } };
check(exp.width === 298 && col.width === 76, `widths: ${exp.width} / ${col.width}`);
// *{box-sizing:border-box} (style.css:52) puts the sidebar's 1px border-right
// INSIDE its 298/76px box, and .app has no gap while .main has no left margin or
// border — so .main starts exactly at the sidebar's right edge, not one past it.
check(exp.mainLeft === exp.width && col.mainLeft === col.width,
  `.main must start at the sidebar's right edge: `
  + `${exp.mainLeft}/${exp.width} expanded, ${col.mainLeft}/${col.width} collapsed`);
check(!exp.overflowsX && !col.overflowsX, 'the rail must not overflow horizontally');
check(col.clientW === 75,
  `collapsed clientWidth is ${col.clientW}; 65 means the scrollbar gutter is still reserved`);
check(col.navOffCentre < 1, `icon column is ${col.navOffCentre.toFixed(1)}px off centre`);
check(exp.labelDisplay !== 'none' && col.labelDisplay !== 'none',
  'labels must be visually hidden, never display:none (it strips the a11y name)');
check(col.labelPosition === 'absolute', 'collapsed labels must be out of flow');
check(col.tile && col.tile.w === 36 && col.tile.h === 36, `tile box: ${JSON.stringify(col.tile)}`);
// Real geometry: content box x 18..57, a centred 36px tile ends at 55.5, and
// .child-q sits at right:-5px -> ~61. A `< col.width` bound would also pass with
// the badge 13px further out, so pin it where it actually lands.
check(col.qRight !== null && col.qRight < 66,
  `the "?" badge at ${col.qRight} must stay tight to the tile inside the ${col.width}px rail`);
check(String(exp.footClass).split(' ').includes('spend-ind')
  && !String(exp.footClass).includes('spend-ring'), `expanded foot: ${exp.footClass}`);
check(String(col.footClass).includes('spend-ring'), `collapsed foot: ${col.footClass}`);
check(col.ringBg === 'conic-gradient', `ring background: ${col.ringBg}`);
check(ringHoverBg.startsWith('conic-gradient'),
  'the arc must survive a hover — .spend-ring:hover is missing or lost the tie');
check(re.collapsed === true && re.width === 76, 'the preference must survive a real reload');
// getFullAXTree covers the WHOLE document (index.html has 93 buttons), so a bare
// count is guarded only by however many other buttons happen to be visible. Name
// the rail's own twelve. 'Statistics', not 'Stats' — that is the sidebar label.
const RAIL_NAMES = ['New pipeline', 'History', 'Statistics', 'Workflow Composer',
  'Agents', 'Guardrails', 'Models', 'Plugins', 'Projects', 'Workspaces',
  'Settings', 'Expand menu'];
const missing = RAIL_NAMES.filter((n) => !names.includes(n));
check(missing.length === 0, `rail buttons with no accessible name: ${JSON.stringify(missing)}`);
check(names.some((n) => /^Running/.test(n)), `the Running button lost its name: ${JSON.stringify(names)}`);
// Defensive only: Task 1 Step 9 writes aria-label unconditionally, so
// name-from-contents can no longer win and announce this button as a bare "4".
check(!names.some((n) => /^\d+$/.test(n)),
  'a button named by a bare number means its label left the a11y tree');

ws.close();
chrome.kill();
process.exitCode = failed ? 1 : 0;
console.log(failed ? `${failed} CHECK(S) FAILED` : 'all checks passed');
```

- [ ] **Step 3: Run the probe**

```bash
node <YOUR-SCRATCHPAD>/verify-rail.mjs; echo "exit=$?"
```

Expected: `all checks passed`, `exit=0`, and roughly:

```
expanded : { width: 298, clientW: 297, collapsed: false, overflowsX: false, …
             labelDisplay: 'block', footClass: 'spend-ind', mainLeft: 298 }
collapsed: { width: 76, clientW: 75, collapsed: true, overflowsX: false, overflowsY: true,
             labelDisplay: 'block', labelPosition: 'absolute',
             footClass: 'spend-ind spend-ring', ringBg: 'conic-gradient',
             mainLeft: 76, navOffCentre: 0, tile: { w: 36, h: 36 } }
reloaded : { width: 76, collapsed: true, … }        <- persistence survives a real reload
```

Failure guidance, all of it derived from what actually went wrong when v1 was measured:
- **`clientW` is 65, not 75** → the `scrollbar-width:none` / `::-webkit-scrollbar{width:0}` pair from Task 1 Step 6 is missing or mis-scoped. Do not widen the rail; suppress the gutter.
- **`ring bg on hover` is not a gradient** → `.spend-ring:hover` is missing, or something re-ordered it before `.spend-ind:hover`.
- **A button is named `"4"` or `""`** → the label rule reverted to `display:none`.
- **`overflowsY: true` when collapsed is EXPECTED and fine** — `.sidebar` is `overflow-y:auto` by design (`:74`) and four tiles genuinely exceed a 700px window. The rail scrolls; it just does not reserve a gutter.
- **`overflowsX: true`** → something in the rail is genuinely wider than 76px. Check `.nav-count`'s absolute offsets and the tile borders before suspecting a selector; the arithmetic itself (76 − 1 border − 36 padding = 39px, holding 40px squares whose 0.5px overhang is absorbed by the padding) was measured correct.

- [ ] **Step 4: Machine-check the rail tooltips**

v1 ended here with "open the app and eyeball it against the mock". An agentic executor cannot click, hover or see — and everything that step asked for is already asserted by Step 3 (`ringHoverBg` covers the hover-arc, `RAIL_NAMES` the labels, `col.footClass` the ring, `col.tile` the 36px squares). The one thing left uncovered is the tooltips, and that is one CDP call.

Add to `verify-rail.mjs`, immediately before the `let failed = 0;` line:

```js
const tips = await evaluate(
  `[...document.querySelectorAll('.sidebar.collapsed .nav button[data-nav]')]
     .map((b) => [b.dataset.nav, b.title, b.dataset.railTitle || ''])`);
console.log('rail tooltips:', tips);
```

and to the check list:

```js
check(tips.length === 12, `expected 12 rail nav buttons, saw ${tips.length}`);
check(tips.every(([, t]) => t), `a rail button has no tooltip: ${JSON.stringify(tips)}`);
check(tips.find(([n]) => n === 'composer')?.[1] === 'Workflow Composer',
  'the tooltip must be the label span text, not a placeholder');
```

The five deviations from the mock are **decisions, not observations** — they are listed in the Deviations table and deliberately not re-verified here. Opening the app by hand (`open http://127.0.0.1:4317`) is optional and proves nothing the checks above do not. Note also that the mock itself (`~/Downloads/colapsable area/Worca Running.dc.html`) lives **outside the repository**; a fresh clone will not have it, and nothing in this plan requires it at implementation time.

- [ ] **Step 5: Stop the server and clean up**

```bash
kill "$(cat /tmp/worca-verify.pid)" 2>/dev/null; rm -f /tmp/worca-verify.pid /tmp/worca-verify.log
rm -rf "${TMPDIR:-/tmp}"/worca-rail-*     # the throwaway Chrome profile(s)
rm -rf "$WORCA_VERIFY_HOME"
```

`${TMPDIR:-/tmp}`, not `/tmp`: the probe creates its profile with `mkdtempSync(join(os.tmpdir(), 'worca-rail-'))`, and on macOS `os.tmpdir()` is `$TMPDIR` (`/var/folders/…/T`), so a bare `rm -rf /tmp/worca-rail-*` silently cleans nothing and leaves a multi-megabyte Chrome profile behind every run. The scratchpad probe is throwaway — do not commit it.

- [ ] **Step 6: Final full-suite run**

Run: `npm test`
Expected: PASS, **2925**, zero failures.

- [ ] **Step 7: Report**

State: the final suite count; the three measured widths and the collapsed `clientWidth`; that the ring survived a hover, that every rail button kept an accessible name, and that all twelve carry a tooltip; and the five deviations from the mock. Do **not** claim the mock was matched pixel-for-pixel — it was matched with five documented deviations.

- [ ] **Step 8: Finish the branch**

Use `superpowers:finishing-a-development-branch`. Default here: the suite is green, the work is self-contained, and `dev` is the integration branch — rebase onto `dev`, re-run `npm test`, fast-forward merge. Do **not** merge to `master`. Do **not** commit anything under `docs/superpowers/**`.

---

## Deviations from the mock

| Mock | This plan | Why |
|---|---|---|
| Collapsed foot: budget ring above the Settings gear | Gear above ring | D4 — Settings cannot leave `.nav` (`test/ui-nav-sections.test.mjs:57-60`; `navLinks` at `app.js:13648` only snapshots `.nav`/`.topnav` buttons), and CSS `order` cannot reorder across two parents. Purely cosmetic. |
| Rail has no roll-up dot | `.sidebar.collapsed .nav-rollup` is repositioned onto the Running square | It is the "a run needs your input" signal, and D7 leans on that family surviving the rail. Measured: no collision — the count occupies y −2…15 top-right, the roll-up y 33…41 bottom-right. |
| Ring track `#F1F1EF` (= `var(--bg)`), a neutral | `var(--blue-bg)` / `--amber-bg` / `--red-bg`, banded | The ring is framed throughout as the *twin* of the expanded spend block, and `.spend-ind-meter` (`:1603-1610`) already pairs exactly these track/fill tokens per band. Matching the app's own shipped language beats matching the mock's. |
| Mock renders two separate `<sc-if>` subtrees | One tree + a class | D1. |
| Mock's collapsed nav buttons carry static `title` + `aria-label` in markup | `title` written by JS in `applySidebarCollapsed`; the accessible NAME comes from the visually-hidden label span, and only Running gets an `aria-label` (from `updateNavCounts`) | Static attributes on the CTA or Settings red `ui-nav-sections:48` / `:57`, whose regexes pin those open-tags verbatim. |

---

## Self-Review

### Spec coverage

| Spec | Task | Note |
|---|---|---|
| §2 D1 one DOM, CSS-driven | 1 (shell + nav), 2 (fork), 3 (fork) | structural throughout |
| §2 D2 preference, not breakpoint | Global Constraints | no task enters `:909` or `:938`; `.sidebar.collapsed` never declares `display` |
| §2 D3 key + default | 1 Step 7, tested Step 2 (×6) | mirrors `RUN_DENSITY_KEY` (`app.js:12283-12296`) |
| §2 D4 Settings stays put | Global Constraints; deviation logged | `ui-nav-sections:57-60` verified still green |
| §2 D5 hairline sections | 1 Step 6, tested Step 2 | **rationale corrected** — the text nodes are kept for `ui-nav-sections:26-35`, not for the a11y tree, where they were measured absent in both states |
| §2 D6 grey badges hidden | 1 Step 6 (two separate rules), tested Step 2 | the grouped-selector assertion was vacuous; split |
| §2 D7 paused count survives | 1 Step 9, tested Step 2 (×4) | **`aria-label` added** — a `title` is a description, and name-from-contents would announce `"4"` |
| §2 D8 same run source | 2 Step 5 | the `continue` guard leaves `rows` and `cmpTabRuns` untouched |
| §2 D9 initials algorithm | 2 Step 3, tested Step 1 (×3) | **extended past the mock**: code points, not UTF-16 units, plus the `'?'` fallback the mock lacks |
| §2 D10 sig includes the flag | 2 Step 4, signature-regression test | verified: removing it turns exactly that test red |
| §2 D11 ring keeps `.spend-ind` | 3 Step 4, tested by an actual click | classList-only assertion superseded |
| §2 D12 no-limit ring | 3 Steps 4+6, tested Step 1 | **colour corrected** to `--ink-3`; `--line` was invisible |
| §2 D13 `--ring-pct`, not inline gradient | 3 Steps 4+6 | **reason corrected** in Verified Fact 2 |
| §2 D14 one mirrored chevron | 1 Steps 4+6, tested Step 2 | mirror verified arithmetically |
| §3 structure | 1 Step 4 | plus `id="side-rail"` on the aside |
| §4 markup | 1 Step 4 | `aria-controls` retargeted to the aside; no `<nav>` edit |
| §5 CSS | 1 Step 6, 2 Step 6, 3 Step 6 | **spec's CSS is wrong** — see Spec corrections |
| §6 app.js | 1 Steps 7-9, 2 Steps 3-5, 3 Step 5 | plus the ResizeObserver debounce (1 Step 8) |
| §7 stats-view.mjs | 3 Step 4 | helper renamed `ringAmount` |
| §8 tests 1-19 | 1-3 | all covered; test 14's count half was missing in v1 and is now tested; test 16's `63%` is a spec typo |
| §9 deviations | Deviations table | grown from three rows to five |
| §10 out of scope | — | no shortcut, flyout, auto-collapse or `.topnav` change |

### Test-quality manifest

Every row below was re-verified by mutation against the finished tree: the named thing was broken, one at a time, and **exactly one** test went red each time. **These assertions exist because the thing they pin was proven breakable while every other test stayed green.** Do not simplify them away:

| Guard | What went green without it |
|---|---|
| `boot({ poisonToggle: true })` | deleting `applySidebarCollapsed`'s entire `if (btn) {…}` branch |
| `assert.doesNotMatch(base, /display:\s*none/)` on `.sidebar` | deleting the whole base `.sidebar` rule (`ruleBody` silently returned the `@media` body) |
| two separate `.n-grey` / `#nav-paused-badge` rules | regrouping `.n-grey` with a no-op while grey badges stopped hiding |
| the blank-title tile test | deleting `railInitials`' `|| '?'` |
| the clamp test | deleting either `Math.max(0, …)` or `Math.min(100, …)` |
| the tile a11y/lingering test | deleting the tile's `aria-label`, its `lingering` class, or `tabStatusWord`'s finished branch |
| the starting/pausing test | deleting either of `tabStatusWord`'s `starting` / `pausing` branches |
| the ring click-routing test | dropping `spend-ind` from the ring's class list |
| `<img[^>]*class="logo-mark"[^>]*>` | nothing — but the v1 form went red on a legal attribute reorder |
| `.brand .logo` sizing test | deleting `.brand .logo` outright |
| the `.spend-ring:hover` test | the arc dying on every hover, invisibly to jsdom |
| the label-rule a11y test | eleven buttons losing their accessible name, invisibly to jsdom |
| the `display`-silence test | a future `display` on `.sidebar.collapsed` beating the `<1080px` rule, floating a rail over `.topnav` |
| the CTA-hover test | deleting `.sidebar.collapsed .nav button.nav-cta:hover`, leaving the rail's one filled control inert |
| the tile-hover assertion | dropping `background`/`color` from `.nav .rail-tile:hover`, so a hovered tile flips to `var(--field)` |
| the late-budget ring test | `paintBudget`'s first paint reading the boot-time `sidebarCollapsed` instead of the current one |
| the NaN-guard test | `totalLimitUsd:0` + zero spend emitting `--ring-pct:NaN` and voiding the whole gradient |

### Numbers

| Point | `ui-sidebar-collapse` | `ui-budget-indicator` | `npm test` |
|---|---|---|---|
| baseline `411a1db0` | — | 8 | **2872** |
| after Task 1 | **29** | 8 | **2901** |
| after Task 2 | **40** | 8 | **2912** |
| after Task 3 | **46** | **15** | **2925** |

**Every row is measured, not derived.** The plan was executed end-to-end in a throwaway clone before being finalised, zero-fail at every commit (`ui-pipeline-tabs` stayed 17/17 throughout; the composer suites stayed green under Step 8's debounce). That pass measured 2872 / 2897 / 2907 / 2918 for a 25 / 35 / 40 + 14 test set. The seven tests written afterwards (`starting`/`pausing`; the `display`-silence, CTA-hover, separator/roll-up/toggle and keyboard guards; the late-budget ring; the NaN guard) and the two implementation changes they pin (the tile's hover `background`/`color`, the NaN clamp) were then applied to that same tree: the two new-test files came back **46 + 15 = 61 pass / 0 fail**, and `npm test` came back **2925 / 2925 / 0 fail**. If a run disagrees, trust the run and correct the count — never add or delete tests to hit a number.

### Placeholder scan

None. Every code step carries the literal text to write, every run step names the exact command and its exact expected outcome, and the one non-literal path (`<YOUR-SCRATCHPAD>`) is explicitly defined at its point of use.

### Type consistency

`sidebarCollapsed` / `setSidebarCollapsed` / `applySidebarCollapsed` / `SIDEBAR_KEY` (Task 1) are spelled identically in Tasks 2 and 3. `railInitials` / `tabStatusWord` / `railTileEl` (Task 2) are used only inside Task 2. `renderBudgetRing` (Task 3) matches its import in `app.js:79`, its export in `stats-view.mjs`, and both test files. `ringAmount` is private to `stats-view.mjs` and **was grepped against that file** — unlike `compactUsd`, which was not, and which is why v1 failed. The class names `rail-tile`, `spend-ring`, `spend-ring-val`, `no-limit`, `logo-mark`, `side-toggle`, the id `side-rail`, the dataset key `railTitle` and the property `--ring-pct` were each grepped across `ui/`, `test/` and `src/`: **zero pre-existing hits**, with one nuance — the substring `no-limit` appears inside a test *name* at `test/stats-view.test.mjs:91`. That is prose; no CSS or JS reads it.
