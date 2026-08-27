# Running Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Running view from a stack of full-height live cards into a list-plus-detail pair — redesigned run cards with a Compact/Detailed density toggle, and a `#running/<runId>` detail page carrying the live graph, questions, and three tabs (Live log / Overview / Agents).

**Architecture:** The Running view becomes a two-screen horizontal slide track that mirrors History's `.hist-shell` exactly, so the two areas read as one product. The detail page is a parallel `.rd-*` implementation rather than a refactor of History's `.hd-*` painters: it reuses only helpers that are already pure and already dual-source (the pipeline graph, the log modules, the sub-agent projections, the formatters), with one shared extraction — History's table-driven tab engine becomes a generic `initDetailTabs`. Everything the new screens display already arrives over the existing `/ws` broadcast, so there are no server changes.

**Tech Stack:** Vanilla ESM browser JS (no framework, no build step) in `ui/public/app.js`; hand-written HTML templates in `ui/public/index.html`; a single flat stylesheet `ui/public/style.css` driven by `:root` custom properties; Express + `ws` on the server (untouched); tests are `node:test` + `node:assert/strict` + jsdom 29.

**Spec:** `docs/superpowers/specs/2026-08-19-running-page-redesign-design.md`

## Global Constraints

- **No server changes.** `ui/server.mjs` is not modified by any task. No new endpoints, no new WS frame types.
- **No sidebar changes.** `renderPipelineTabs` (`app.js:11508`), the nav markup (`index.html:14-91`), and the count badges stay exactly as they are. Only the destination of a `.nav-child` click changes, and that happens because the route changes, not because the sidebar does.
- **No Diff tab** on the Running detail page. A live run has no persisted patch and no live-diff endpoint is added.
- **No dark mode**, no `prefers-color-scheme` rules, no `[data-theme]`.
- **Node `>=22.13.0`**; the only test-relevant devDependency is `jsdom ^29.1.1`. Add no dependencies.
- **Density key:** `localStorage['worca-cc.running.density']`, values `'compact' | 'detailed'`, default `'detailed'`.
- **Route grammar:** `#running` = list, `#running/<runId>` = detail. `parseHash()` splits on the first `/`; a `runId` contains no slash.
- **CSS namespaces:** `.rc-*` for the run card v2, `.rd-*` for the run detail. Never reuse History's `.hd-*` or `.hist-*` prefixes. Shared graph/log classes (`.run-flow`, `.log`, `.log-filters`) keep their names.
- **Design tokens** come from the `:root` block at `style.css:10-34`. New tokens are added only for the literals the spec names in §9.
- **`@media (prefers-reduced-motion: reduce)` blocks go AFTER the rules they neutralize** — source order, not specificity, is what makes them win in this stylesheet, and the file carries comments saying so.
- **The `−` in diff and count readouts is U+2212**, not an ASCII hyphen; existing tests assert this byte-for-byte.
- **Test convention:** each suite defines its own local `boot()/settle()/go()` helpers, copied verbatim from the nearest existing suite, with a top comment naming that source file. This duplication is deliberate house style — do not build a shared harness.
- **Baseline is green and must stay green:** `npm test`.

---

## Cross-Task Conventions

These resolve overlaps between tasks that were drafted in parallel. **Where a
task's own `> NOTE:` disagrees with this section, this section wins** — the
notes are preserved because their reasoning is useful, but the names and
ownership below are binding.

### C1 — `initDetailTabs` signature (Task 1 defines, Task 7 consumes)

Tasks 1 and 7 each proposed an `opts` shape and they differ. The binding shape is:

```javascript
initDetailTabs(screen, tabs, ctx, {
  tabsSel,     // e.g. '.hd-tabs'      | '.rd-tabs'
  secsSel,     // e.g. '.hd-sections'  | '.rd-sections'
  tabClass,    // e.g. 'hd-tab'        | 'rd-tab'
  secClass,    // e.g. 'hd-sec'        | 'rd-sec'
  badgeClass,  // e.g. 'hd-tab-badge'  | 'rd-tab-badge'
  idPrefix,    // e.g. 'hd'            | 'rd'   -> ids `<idPrefix>-tab-<key>` / `<idPrefix>-sec-<key>`
  initial,     // (ctx) -> key. History: ctx => ctx.results ? 'diff' : 'overview'. Running: () => 'logs'
  buildArgs,   // OPTIONAL (ctx) -> array of args passed after `sec`. Default: ctx => [ctx]
})
```

Each `tabs[]` entry is `{ key, label, icon, badge(ctx), visible(ctx), build(sec, ...buildArgs(ctx)) }`,
where `icon` is a trusted static SVG string. History passes `icon: HD_TAB_ICONS[key]`
when it builds its table; Running passes its own strings. There is no `icons` map
in `opts` and no `defaultKey` string — Task 1's note naming those is superseded.

`buildArgs` exists for one reason: `initHdTabs` re-resolves `hdCurrentRecord(record)`
at **click** time (`app.js:10131`), because `refreshHdFromRow` replaces
`histDetailState.record` on the deep-link path. History passes
`buildArgs: () => [hdCurrentRecord(histDetailState.record), histDetailState.data]`.
Running omits it and gets `build(sec, ctx)`, matching the contract.

No option may have a silent default for the class/selector names: falling back to
`hd-*` inside a Running screen would paint an unstyled bar that still satisfies
every structural assertion.

### C2 — Keyframes are declared exactly once, in Task 3

`wr-spin`, `wr-pulse`, `wr-rise`, `wr-blink` are all added to `ui/public/style.css`
by **Task 3**, which is the first task that needs one (the card's spinning status
avatar). Every later task that references a keyframe greps for it first:

```bash
grep -n "@keyframes wr-" ui/public/style.css
```

and adds nothing if present. Task 12 asserts each is declared exactly once. The
notes in Tasks 5, 6, 8 and 11 that say "Task 12 declares it" or "T3 may already
have added it" are superseded by this rule.

### C3 — New `:root` tokens: first need declares, Task 12 asserts

Exactly four literals are genuinely new (spec §9):

```css
--amber-wash:#FEF7EC;   /* card question panel, ask banner */
--amber-wash-2:#FEFAF3; /* detail question panel */
--amber-line:#F5D9A8;   /* detail question panel border + inner rules */
--radio-ring:#D6D6D2;   /* unpicked question-option radio */
```

The first task that needs a token declares it in the `:root` block
(`style.css:10-34`); in practice that is **Task 2** for `--amber-wash`. Task 12
asserts all four exist with these exact values using `ui-theme.test.mjs`'s
`tokenValue(name)` idiom.

`#8C7FD6` and `#B5751A` are **not** new — they are the existing `--violet` and
`--peach-ink`. Reuse them; do not re-declare.

### C4 — Run-model field widening has one owner per field

The live run model is missing fields the new screens need. To avoid three tasks
editing the same capture:

| Field | Owner | Source |
|---|---|---|
| `r.branch` (the whole `{source, feature, worktreeDir, …}` object, not just `.feature`) | **Task 5** | `onState` (`app.js:1525-1527`), which today keeps only `.feature` |
| `r.prompt` | **Task 5** | the `state` snapshot (`orchestrator.mjs:569`) |
| `r.artifacts` | **Task 6** | `onArtifact` (`app.js:3908`), which today only logs |
| `r.finishedAtMs` | **Task 9** | `onDone` |

Tasks 3, 6 and 7 all consume these. Each of those tasks must **check whether the
capture is already present and skip its own widening step if so** — the step is
written defensively in more than one task on purpose, but it must be applied once.

### C5 — Status word and family have a single source of truth

`statusPill(r)` (`app.js:10924`) is the only place that decides a run's status
word and colour family. The card's `runStatusMeta(r)` **must derive `family` and
`word` from `statusPill(r)`** and add only the `glyph` choice, so the card
(`.rc-sic` + `.rc-status-word`) and the detail (`.rd-status`) can never disagree.
The detail page calls `statusPill(r)` directly.

### C6 — `.rd-pause` is one toggling control

There is no `.rd-resume`. `.rd-pause` is a single button whose icon, label and
`title` swap between Pause and Resume, mirroring the card's `.btn-pause` /
`.btn-resume` pair only in behaviour, not in markup.

### C7 — `.rd-stop` handler handoff

Tasks 5 and 6 wire `.rd-stop` directly to `stopRun(runId, btn)`. **Task 10
replaces that one line with `openStopModal(runId)`** and updates the assertion
Task 5 wrote. This is a deliberate two-step: Tasks 5–9 stay independently
testable without depending on the modal existing.

### C8 — Test-file ownership

One task creates each file; later tasks append `test(...)` blocks to it and never
rewrite its header or its local `boot()` helper.

| File | Created by | Appended by |
|---|---|---|
| `test/ui-detail-tabs.test.mjs` | Task 1 | — |
| `test/ui-running-list.test.mjs` | Task 2 | — |
| `test/ui-running-card.test.mjs` | Task 3 | — |
| `test/ui-running-density.test.mjs` | Task 4 | — |
| `test/ui-running-routing.test.mjs` | Task 5 | — |
| `test/ui-running-detail.test.mjs` | Task 6 | Tasks 7, 8, 9 |
| `test/ui-running-stop-modal.test.mjs` | Task 10 | — |

Spec §10 named `ui-running-card.test.mjs` as also covering non-pipeline
exclusion; that assertion lives in Task 2's `ui-running-list.test.mjs` instead,
so two parallel tasks never write one file.

### C9 — Test-count baseline

`npm test` on `feat/pipeline-views` @ `a7e97ac5` is **2732 tests, 2732 pass, 0 fail**.
Task 12's final step reconciles against that baseline plus everything Tasks 1–11
add, minus the **21 tests Task 12 deliberately removes** with the `.subs-*` sweep.
Any task that changes the count states the delta in its commit message.

---
## File Structure

| File | Responsibility in this work |
|---|---|
| `ui/public/index.html` | The `data-view="running"` section becomes the two-screen shell (`#run-shell` > `.run-screen-list` + `.run-screen-detail`). `#run-card-tpl` is rewritten to the v2 card. `#run-detail-tpl` is added. `#stop-modal` is added beside `#shipit-modal`. |
| `ui/public/app.js` | All new painters and routing. New code lands next to its topical neighbours: routing beside `routeHistoryDetail`, card painters beside `paintRunCard`, tab builders beside the `hd*` builders, the density helpers beside the other `localStorage`-backed view state. `initDetailTabs` is extracted here from `initHdTabs` and History is migrated onto it. |
| `ui/public/style.css` | `.run-shell` / `.run-screen*` slide shell mirroring `.hist-*`; `.rc-*` card v2; `.rd-*` detail; `.run-density`; `.run-ask-banner`; `#stop-modal`; the four `wr-*` keyframes; the reduced-motion companions. Orphaned `.subs-bar` / `.run-foot` rules are removed. |
| `ui/public/stats-view.mjs`, `log-line.mjs`, `log-filter.mjs`, `results-view.mjs` | **Unchanged.** Consumed as-is. |
| `ui/server.mjs` | **Unchanged.** |
| `test/ui-detail-tabs.test.mjs` | New — the generic tab engine driven directly, including the two-screen isolation History's own suites structurally cannot cover. |
| `test/ui-running-list.test.mjs` | New — pipelines-only list membership (scans and agent-gen excluded) and the inert ask banner. |
| `test/ui-running-card.test.mjs` | New — card v2 anatomy per status, meta line, branch copy, action cluster, lingering rendering. |
| `test/ui-running-density.test.mjs` | New — toggle markup and `aria-pressed`, compact vs detailed bodies, persistence and default. |
| `test/ui-running-routing.test.mjs` | New — detail open/close, `.detail-open`, Back/Escape/browser-Back, deep link, unknown id bounce, leave-guard, focus and `inert` management. |
| `test/ui-running-detail.test.mjs` | New — header fields, live graph adapter, tab visibility and default, Overview's three stat cards, Agents grouping, live-log append and facet growth, terminal state and the History link. |
| `test/ui-running-stop-modal.test.mjs` | New — opens from both places, identity block, cancel, confirm calls `POST /api/stop`, Escape and backdrop close. |
| Existing `test/ui-*.test.mjs` suites | Updated where they assert the focus view, `.run-foot`, `.subs-bar`, or the old `.run-top` click target. Each task names the exact assertions it touches. |

---

### Task 1: Extract `initDetailTabs` from `initHdTabs`; migrate History onto it

**Files:**
- Modify: `ui/public/app.js:2743` (one line added to the `window.__np` export list, `app.js:2669-2744`)
- Modify: `ui/public/app.js:10054-10060` (delete the `hdTabCells` / `hdActivateTab` module globals)
- Modify: `ui/public/app.js:10062-10136` (`initHdTabs` → a thin wrapper; the extracted engine is inserted above it)
- Modify: `ui/public/app.js:10172-10174`, `ui/public/app.js:10197-10211` (`wireHdGraphLogLinks` reads the screen's cells)
- Modify: `ui/public/app.js:10241-10247` (`refreshHdOverviewTab` reads the screen's cells)
- Test: `test/ui-detail-tabs.test.mjs` (new)
- Regression gate (unchanged, must stay green): the 12 History jsdom suites `test/ui-history*.test.mjs` — 171 tests, verified green at HEAD `a7e97ac5`

**Interfaces:**
- Consumes: none.
- Produces:
  - `initDetailTabs(screen: Element, tabs: Tab[], ctx: object, opts: Opts) -> void`
    where `Tab = { key: string, label: string, badge(ctx): string|null, visible(ctx): boolean, build(sec: Element, ...args): void }`
    and `Opts = { tabsSel: string, secsSel: string, tabClass: string, secClass: string, badgeClass: string, idPrefix: string, icons?: Record<string,string>, defaultKey?: (ctx) => string, buildArgs?: () => any[] }`.
    No opt has a default — a missing `tabClass` must not silently fall back to History's.
  - `detailTabsOf(screen: Element) -> { cells: Map<string, {tab: Tab, btn: HTMLButtonElement, sec: HTMLDivElement}>, activate(key: string): void } | null`
  - Both exposed on `window.__np`.
  - Buttons get `id = \`${idPrefix}-tab-${key}\``, sections `id = \`${idPrefix}-sec-${key}\``, `data-sec=key`, `role=tab` / `role=tabpanel`, `sec.tabIndex = 0`, `sec.dataset.loaded === '1'` once built.
  - T7 calls it as `initDetailTabs(screen, RD_TABS, ctx, {tabsSel:'.rd-tabs', secsSel:'.rd-sections', tabClass:'rd-tab', secClass:'rd-sec', badgeClass:'rd-tab-badge', idPrefix:'rd'})`; with `buildArgs` omitted each builder is called as `build(sec, ctx)`, which is the `buildRdLogs(sec, ctx)` shape the contract fixes.

> NOTE: the task brief names `opts` as carrying only the five class/selector names. `idPrefix`, `icons`, `defaultKey` and `buildArgs` are added because `initHdTabs` also stamps `hd-tab-<key>` / `hd-sec-<key>` ids, injects `HD_TAB_ICONS[key]`, defaults to `diff`-when-results, and — load-bearing — re-resolves `hdCurrentRecord(record)` at CLICK time. Without those four the extraction could not be behavior-preserving. Running passes the five names plus `idPrefix:'rd'` and nothing else.

- [ ] **Step 1: Write the failing test**

Create `test/ui-detail-tabs.test.mjs`:

```javascript
// test/ui-detail-tabs.test.mjs — the generic detail-screen tab engine.
//
// initDetailTabs is the table-driven tab bar History's initHdTabs was built from
// and now delegates to; the Running detail screen (#running/<runId>) is its second
// consumer. These tests drive it DIRECTLY through window.__np against two
// throwaway screens — which is the one property History's own suites cannot
// cover: two detail screens initialised at once must not alias each other's
// state, the way the old hdTabCells/hdActivateTab module globals did.
//
// boot()/settle()/go() are a deliberate local copy of
// test/ui-history-detail.test.mjs:25-93 (itself a copy of
// test/ui-history-routing.test.mjs:25-96) — the suites do not import each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECT = '/tmp/proj';

async function boot({ fetchHandler, url = 'http://localhost:4317/' } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
  const { window } = dom;

  // jsdom doesn't implement scrollIntoView; the viewer modal calls it on open.
  window.Element.prototype.scrollIntoView = function () {};

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() {
      this.readyState = 1;
      this._listeners = {};
      wsBox.ws = this;
    }
    send() {}
    close() {}
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    }
    dispatch(type, evt) {
      (this._listeners[type] || []).forEach((fn) => fn(evt));
    }
  };

  const calls = [];
  window.fetch = (u, opts) => {
    calls.push({ url: String(u), opts: opts || {} });
    if (fetchHandler) {
      const r = fetchHandler(String(u), opts || {});
      if (r) return r;
    }
    if (String(u).includes('/api/projects')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }),
    });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch {
      /* read-only global already present — leave it */
    }
  }
  globalThis.window = window;
  globalThis.document = window.document;

  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0)); // let loadProjects/loadConfig settle

  return { window, calls, wsBox };
}

async function settle(window, n = 3) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

// A throwaway detail screen: the two hosts initDetailTabs writes into, nothing else.
function makeScreen(window, ns) {
  const screen = window.document.createElement('div');
  screen.innerHTML = `<div class="${ns}-tabs" role="tablist"></div><div class="${ns}-sections"></div>`;
  window.document.body.appendChild(screen);
  return screen;
}

const optsFor = (ns) => ({
  tabsSel: `.${ns}-tabs`, secsSel: `.${ns}-sections`,
  tabClass: `${ns}-tab`, secClass: `${ns}-sec`, badgeClass: `${ns}-tab-badge`,
  idPrefix: ns,
});

// Three tabs: one always on, one always on with no badge, one gated on ctx.
function tableWith(log) {
  return [
    { key: 'a', label: 'Alpha', badge: (c) => (c.n == null ? null : String(c.n)), visible: () => true,
      build: (sec, ...args) => { log.push(['a', ...args]); sec.textContent = 'A'; } },
    { key: 'b', label: 'Beta', badge: () => null, visible: () => true,
      build: (sec, ...args) => { log.push(['b', ...args]); sec.textContent = 'B'; } },
    { key: 'c', label: 'Gamma', badge: () => null, visible: (c) => !!c.showC,
      build: (sec) => { sec.textContent = 'C'; } },
  ];
}

test('one pill + one lazy section per VISIBLE tab; the default tab is built eagerly', async () => {
  const { window } = await boot();
  const { initDetailTabs } = window.__np;
  const screen = makeScreen(window, 'rd');
  const log = [];

  initDetailTabs(screen, tableWith(log), { n: 7, showC: false }, optsFor('rd'));

  assert.deepEqual([...screen.querySelectorAll('.rd-tab')].map((b) => b.dataset.sec), ['a', 'b'],
    'the ctx-gated tab renders no pill');
  assert.equal(screen.querySelector('.rd-sec[data-sec="c"]'), null, 'and no section either');

  const a = screen.querySelector('.rd-sec[data-sec="a"]');
  const b = screen.querySelector('.rd-sec[data-sec="b"]');
  assert.equal(a.hidden, false);
  assert.equal(b.hidden, true);
  assert.equal(a.dataset.loaded, '1', 'the default tab body is built at init');
  assert.equal(b.dataset.loaded, undefined, 'an unvisited tab is never built');
  assert.deepEqual(log.map((e) => e[0]), ['a']);
  assert.ok(screen.querySelector('.rd-tab[data-sec="a"]').classList.contains('active'));
});

test('badges render only when badge(ctx) returns a value', async () => {
  const { window } = await boot();
  const screen = makeScreen(window, 'rd');
  window.__np.initDetailTabs(screen, tableWith([]), { n: 7, showC: false }, optsFor('rd'));

  const badge = screen.querySelector('.rd-tab[data-sec="a"] .rd-tab-badge');
  assert.ok(badge, 'a non-null badge paints a span');
  assert.equal(badge.textContent, '7');
  assert.equal(screen.querySelector('.rd-tab[data-sec="b"] .rd-tab-badge'), null,
    'a null badge paints nothing');
  assert.match(screen.querySelector('.rd-tab[data-sec="a"]').textContent, /Alpha/);
});

test('tabs are wired for a11y and aria-selected TRACKS the active tab', async () => {
  const { window } = await boot();
  const screen = makeScreen(window, 'rd');
  window.__np.initDetailTabs(screen, tableWith([]), { n: null, showC: true }, optsFor('rd'));

  for (const btn of screen.querySelectorAll('.rd-tab')) {
    const key = btn.dataset.sec;
    const sec = screen.querySelector(`.rd-sec[data-sec="${key}"]`);
    assert.equal(btn.id, `rd-tab-${key}`);
    assert.equal(sec.id, `rd-sec-${key}`);
    assert.equal(btn.getAttribute('role'), 'tab');
    assert.equal(btn.getAttribute('aria-controls'), sec.id);
    assert.equal(sec.getAttribute('role'), 'tabpanel');
    assert.equal(sec.getAttribute('aria-labelledby'), btn.id);
    assert.equal(sec.tabIndex, 0, 'panels that scroll internally must be reachable by keyboard');
    assert.equal(btn.getAttribute('aria-selected'), key === 'a' ? 'true' : 'false');
  }

  click(window, screen.querySelector('.rd-tab[data-sec="c"]'));
  assert.equal(screen.querySelector('.rd-tab[data-sec="c"]').getAttribute('aria-selected'), 'true');
  assert.equal(screen.querySelector('.rd-tab[data-sec="a"]').getAttribute('aria-selected'), 'false');
  assert.equal(screen.querySelector('.rd-sec[data-sec="a"]').hidden, true);
});

test('a body is built once, on first activation, and the node is reused', async () => {
  const { window } = await boot();
  const screen = makeScreen(window, 'rd');
  const log = [];
  window.__np.initDetailTabs(screen, tableWith(log), { n: null, showC: false }, optsFor('rd'));

  const b = screen.querySelector('.rd-sec[data-sec="b"]');
  click(window, screen.querySelector('.rd-tab[data-sec="b"]'));
  assert.equal(b.dataset.loaded, '1');
  assert.deepEqual(log.map((e) => e[0]), ['a', 'b']);

  click(window, screen.querySelector('.rd-tab[data-sec="a"]'));
  click(window, screen.querySelector('.rd-tab[data-sec="b"]'));
  assert.equal(screen.querySelector('.rd-sec[data-sec="b"]'), b, 'the section node is never re-created');
  assert.deepEqual(log.map((e) => e[0]), ['a', 'b'], 'a second visit builds nothing new');
});

test('a builder that THROWS leaves the section un-stamped and re-arms the tab', async () => {
  const { window } = await boot();
  const screen = makeScreen(window, 'rd');
  let calls = 0;
  const tabs = [
    { key: 'a', label: 'Alpha', badge: () => null, visible: () => true, build: () => {} },
    { key: 'b', label: 'Beta', badge: () => null, visible: () => true,
      build: (sec) => { calls += 1; if (calls === 1) throw new Error('boom'); sec.textContent = 'ok'; } },
  ];
  window.__np.initDetailTabs(screen, tabs, {}, optsFor('rd'));
  const st = window.__np.detailTabsOf(screen);
  const b = screen.querySelector('.rd-sec[data-sec="b"]');

  assert.throws(() => st.activate('b'), /boom/);
  assert.equal(b.dataset.loaded, undefined, 'the stamp lands only AFTER the builder returns');
  // The toggle phase ran to completion despite the throw: exactly one lit pill.
  assert.equal(screen.querySelectorAll('.rd-tab.active').length, 1);
  assert.equal(screen.querySelectorAll('.rd-sec:not([hidden])').length, 1);

  st.activate('a');
  st.activate('b');
  assert.equal(calls, 2, 'the next activation retried the build');
  assert.equal(b.dataset.loaded, '1');
  assert.equal(b.textContent, 'ok');
});

test('defaultKey picks the initial tab, and an unknown key falls back to the first visible one', async () => {
  const { window } = await boot();
  const s1 = makeScreen(window, 'rd');
  window.__np.initDetailTabs(s1, tableWith([]), { n: null, showC: false },
    { ...optsFor('rd'), defaultKey: () => 'b' });
  assert.ok(s1.querySelector('.rd-tab[data-sec="b"]').classList.contains('active'));
  assert.equal(s1.querySelector('.rd-sec[data-sec="b"]').dataset.loaded, '1');

  const s2 = makeScreen(window, 'hd2');
  window.__np.initDetailTabs(s2, tableWith([]), { n: null, showC: false },
    { ...optsFor('hd2'), defaultKey: () => 'nope' });
  assert.ok(s2.querySelector('.hd2-tab[data-sec="a"]').classList.contains('active'),
    'an unresolvable default falls back to the first visible tab');
});

test('buildArgs() is evaluated at ACTIVATION time, not captured at init', async () => {
  const { window } = await boot();
  const screen = makeScreen(window, 'rd');
  const log = [];
  const box = { rec: 'stub' };
  window.__np.initDetailTabs(screen, tableWith(log), { n: null, showC: false },
    { ...optsFor('rd'), buildArgs: () => [box.rec, 'data'] });

  assert.deepEqual(log[0], ['a', 'stub', 'data']);
  box.rec = 'real';                                  // the row the deep link corrected
  click(window, screen.querySelector('.rd-tab[data-sec="b"]'));
  assert.deepEqual(log[1], ['b', 'real', 'data'],
    'a tab opened after the authoritative record landed sees the NEW record');
});

test('two screens keep independent tab state', async () => {
  const { window } = await boot();
  const hist = makeScreen(window, 'hd2');
  const run = makeScreen(window, 'rd');
  window.__np.initDetailTabs(hist, tableWith([]), { n: null, showC: false }, optsFor('hd2'));
  window.__np.initDetailTabs(run, tableWith([]), { n: null, showC: false }, optsFor('rd'));

  const a = window.__np.detailTabsOf(hist);
  const b = window.__np.detailTabsOf(run);
  assert.ok(a && b);
  assert.notEqual(a, b, 'each screen owns its own cells + activate');
  assert.ok(hist.contains(a.cells.get('a').sec), 'cells belong to their own screen');
  assert.ok(run.contains(b.cells.get('a').sec));

  b.activate('b');
  assert.ok(run.querySelector('.rd-tab[data-sec="b"]').classList.contains('active'));
  assert.ok(hist.querySelector('.hd2-tab[data-sec="a"]').classList.contains('active'),
    'the other screen is untouched');
  assert.equal(hist.querySelector('.hd2-sec[data-sec="b"]').dataset.loaded, undefined);
});

test('detailTabsOf returns null for a screen that was never initialised', async () => {
  const { window } = await boot();
  assert.equal(window.__np.detailTabsOf(makeScreen(window, 'rd')), null);
  assert.equal(window.__np.detailTabsOf(null), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-detail-tabs.test.mjs`
Expected: FAIL — every test errors with `TypeError: window.__np.initDetailTabs is not a function` (the first case destructures it: `const { initDetailTabs } = window.__np;` then calls it).

- [ ] **Step 3: Implement the extracted engine**

In `ui/public/app.js`, insert immediately after the `HD_TAB_ICONS` block (which ends at `app.js:10023`) and before `function hdClarifyCount` at `app.js:10025` — i.e. the extracted engine leads the tabs section it was taken from:

```javascript
// Per-screen tab state, keyed by the SCREEN element. The hdTabCells /
// hdActivateTab pair this replaces was a pair of module globals, so it could
// describe exactly ONE open detail; the Running detail is a second screen that
// can be initialised while History's is still mounted. Keeping the cells on the
// screen makes the engine reentrant and lets the state die with the node.
const detailTabState = new WeakMap();   // screen -> { cells, activate }

/** The tab cells + activate() of a screen initDetailTabs has run on, else null. */
function detailTabsOf(screen) {
  return (screen && detailTabState.get(screen)) || null;
}

// Table-driven pill row + lazily-built section bodies for a detail screen.
// `tabs` is a list of { key, label, badge(ctx), visible(ctx), build(sec, ...args) }.
// `opts` names the markup — { tabsSel, secsSel, tabClass, secClass, badgeClass,
// idPrefix, icons?, defaultKey?, buildArgs? } — and deliberately has NO defaults:
// falling back to History's class names inside the Running screen would paint an
// unstyled tab bar that still passes every structural check.
//   icons      — { key: staticSvgMarkup }, injected as innerHTML (no interpolation)
//   defaultKey — (ctx) => key for the initially active tab; first visible otherwise
//   buildArgs  — () => extra args appended after `sec`, evaluated at ACTIVATION
//                time so a builder sees late-corrected context (History's record)
function initDetailTabs(screen, tabs, ctx, opts) {
  const {
    tabsSel, secsSel, tabClass, secClass, badgeClass, idPrefix,
    icons = null, defaultKey = null, buildArgs = null,
  } = opts;
  const bar = screen.querySelector(tabsSel);
  const secs = screen.querySelector(secsSel);
  bar.innerHTML = '';
  secs.innerHTML = '';
  const shown = tabs.filter((t) => t.visible(ctx));
  const cells = new Map();
  for (const t of shown) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = tabClass;
    btn.dataset.sec = t.key;
    btn.id = `${idPrefix}-tab-${t.key}`;
    btn.setAttribute('role', 'tab');
    if (icons && icons[t.key]) btn.innerHTML = icons[t.key];   // static markup, no interpolation
    btn.appendChild(document.createTextNode(' ' + t.label));
    const badge = t.badge(ctx);
    if (badge != null) {
      const b = document.createElement('span');
      b.className = badgeClass;
      b.textContent = badge;
      btn.appendChild(b);
    }
    bar.appendChild(btn);
    const sec = document.createElement('div');
    sec.className = secClass;
    sec.dataset.sec = t.key;
    sec.id = `${idPrefix}-sec-${t.key}`;
    sec.setAttribute('role', 'tabpanel');
    sec.setAttribute('aria-labelledby', btn.id);
    btn.setAttribute('aria-controls', sec.id);
    // Panels that scroll internally (History's .hd-diff-rows and .hd-sec-logs .log,
    // Running's live log) are not reliably reachable by keyboard otherwise;
    // tabindex=0 on the panel is the standard tabs remedy and costs nothing on the
    // others.
    sec.tabIndex = 0;
    sec.hidden = true;
    secs.appendChild(sec);
    cells.set(t.key, { tab: t, btn, sec });
    btn.addEventListener('click', () => activate(t.key));
  }
  function activate(key) {
    // TWO PHASES on purpose. Building inside the toggle loop means a throwing
    // builder aborts the loop mid-iteration: every cell after the active one keeps
    // its previous `.active`/`hidden` state, so the user is left with two lit pills
    // and/or two visible sections — and builders are explicitly allowed to throw
    // (the retry contract below). Toggle everything first, then build exactly the
    // newly-activated section.
    let pending = null;
    for (const [k, { tab, btn, sec }] of cells) {
      const on = k === key;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      sec.hidden = !on;
      if (on && sec.dataset.loaded !== '1') pending = { tab, sec };
    }
    if (pending) {
      // Stamp AFTER the builder returns: a builder that throws leaves the tab
      // un-stamped and retries on the next activation instead of being stuck
      // permanently empty. History's Logs builder kicks off an async loadLiveLogs
      // and returns immediately, so its own `dataset.loaded = ''` error reset still
      // lands after this stamp — the retry contract holds.
      pending.tab.build(pending.sec, ...(buildArgs ? buildArgs() : [ctx]));
      pending.sec.dataset.loaded = '1';
    }
  }
  detailTabState.set(screen, { cells, activate });
  if (!cells.size) return;
  const want = defaultKey ? defaultKey(ctx) : null;
  activate(cells.has(want) ? want : cells.keys().next().value);
}
```

Then add both to the `window.__np` export list — replace `app.js:2743` (`    seedResumedLog,`) with:

```javascript
    seedResumedLog,
    initDetailTabs,
    detailTabsOf,
```

- [ ] **Step 4: Run the new suite green**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-detail-tabs.test.mjs`
Expected: PASS — `# pass 9`, `# fail 0`.

- [ ] **Step 5: Record the History green baseline BEFORE the migration**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history*.test.mjs`
Expected: PASS — `ℹ tests 171`, `ℹ pass 171`, `ℹ fail 0` (12 suites). This is the number Step 7 must reproduce exactly; the refactor's acceptance test is that these suites are not touched.

- [ ] **Step 6: Migrate History onto the extracted engine**

Four edits in `ui/public/app.js`. Line numbers are against HEAD `a7e97ac5` and shift as
the earlier edits land — match on content, not on offset.

(a) Delete the two module globals — replace `app.js:10054-10060` (the comment block plus `let hdTabCells = null;` … `let hdActivateTab = null;`) with nothing. Both are now per-screen state in `detailTabState`.

(b) Replace the whole body of `initHdTabs` (`app.js:10062-10136`) with:

```javascript
function initHdTabs(screen, record, data) {
  initDetailTabs(screen, HD_TABS, data, {
    tabsSel: '.hd-tabs', secsSel: '.hd-sections',
    tabClass: 'hd-tab', secClass: 'hd-sec', badgeClass: 'hd-tab-badge',
    idPrefix: 'hd', icons: HD_TAB_ICONS,
    // hdCurrentRecord(), NOT the captured `record`: build() runs at CLICK time,
    // and refreshHdFromRow REPLACES histDetailState.record (deep link, and every
    // pipelines-changed forced reload). Closing over the load-time object is
    // exactly what the record-identity rule forbids — a tab first opened after the
    // real row landed would otherwise still render the minimal stub. This is why
    // initDetailTabs takes buildArgs as a THUNK.
    buildArgs: () => [hdCurrentRecord(record), data],
    defaultKey: (d) => (d.results ? 'diff' : 'overview'),
  });
}
```

(c) `wireHdGraphLogLinks` — replace `app.js:10173-10174` with:

```javascript
  const graph = screen.querySelector('.hd-graph');
  const tabs = detailTabsOf(screen);
  if (!graph || !tabs || !tabs.cells.has('logs')) return;
```

and replace `app.js:10198-10202` (`const cell = hdTabCells && …` through `if (!cell || !hdActivateTab) return;`) with:

```javascript
    const cell = tabs.cells.get('logs');
    if (!cell) return;
```

and replace `app.js:10209` (`    hdActivateTab('logs');`) with:

```javascript
    tabs.activate('logs');
```

Also fix the two stale references in the comments above it: `app.js:10169-10170` reads "MUST run after initHdTabs (it reads `hdTabCells`/`hdActivateTab`)" → "MUST run after initHdTabs (it reads the screen's tab cells)", and the call site comment at `app.js:9383` reads `wireHdGraphLogLinks(screen);   // AFTER initHdTabs: it reads hdTabCells` → `// AFTER initHdTabs: it reads the screen's tab cells`.

(d) `refreshHdOverviewTab` — replace `app.js:10242-10246` with:

```javascript
  if (!histDetailState || !histDetailState.screen || !histDetailState.data) return;
  const tabs = detailTabsOf(histDetailState.screen);
  if (!tabs) return;
  const cell = tabs.cells.get('overview');
  if (!cell || cell.sec.dataset.loaded !== '1') return;
  // No "cells belong to a superseded screen" guard any more: the cells are read
  // from histDetailState.screen itself, so a stale screen's cells are structurally
  // unreachable rather than merely filtered out.
  buildHdOverview(cell.sec, hdCurrentRecord(), histDetailState.data);   // the accessor, like every other consumer
```

- [ ] **Step 7: Run the History suites and the new suite green**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-history*.test.mjs test/ui-detail-tabs.test.mjs`
Expected: PASS — `ℹ tests 180`, `ℹ pass 180`, `ℹ fail 0` (171 History + 9 new). Any History failure means the extraction changed behavior; fix the engine, never the History suite.

- [ ] **Step 8: Sanity-check that nothing still references the deleted globals**

Run: `grep -n "hdTabCells\|hdActivateTab" ui/public/app.js`
Expected: no output (the comment fixes in Step 6c removed the last two mentions).

- [ ] **Step 9: Commit**

```
git add ui/public/app.js test/ui-detail-tabs.test.mjs
git commit -m "refactor(ui): extract initDetailTabs from initHdTabs

The tab engine kept its cells and activate() in two module globals, so it
could describe exactly one open detail screen. Move that state onto the
screen element (a WeakMap) and take the markup names, icons, default tab
and build args as options, so the Running detail can mount a second tab
bar without aliasing History's. History is migrated onto the extracted
helper with its behavior held constant: its 12 jsdom suites (171 tests)
pass unchanged."
```

---

### Task 2: Running list — pipelines only + inert ask banner

**Files:**
- Modify: `ui/public/index.html:353-355` (insert `.run-ask-banner` between the `.topbar` and `#run-list`)
- Modify: `ui/public/style.css:558` (new rules directly after `.run-list{…}`)
- Modify: `ui/public/app.js:10856-10864` (`overviewRuns` gains the `isPipelineRun` filter)
- Modify: `ui/public/app.js:11411-11414` (`renderRunningView` calls `renderAskBanner`)
- Modify: `ui/public/app.js:11464-11480` (insert `renderAskBanner`; drop the now-redundant `livePipes`)
- Modify: `test/ui-pipeline-tabs.test.mjs:181-193` (the one existing test that locks the OLD "scan still renders as an Overview card" behavior)
- Test: `test/ui-running-list.test.mjs` (new)

**Interfaces:**
- Consumes: none (independent of Task 1).
- Produces:
  - `overviewRuns() -> Run[]` — unchanged signature, now **pipelines only**: `isPipelineRun(r) && (isLive(r) || isLingering(r) || isPaused(r))`, still sorted by `cmpTabRuns`. Membership is now identical to `pipelineTabRuns()`.
  - `renderAskBanner() -> void` — paints/hides `.run-ask-banner` from `overviewRuns().filter(r => r.pendingQuestion).length`.
  - DOM: `.run-ask-banner` (a `div`, `hidden` when idle) as the immediate previous sibling of `#run-list`, containing `.rab-mark` (the 26px `?` circle) and `.rab-text`. T4's density toggle and T5's `.run-screen-list` wrapper both keep this ordering.

Verified before writing: `isPipelineRun(r)` (`app.js:10826-10828`) tests `r.kind === 'run' || r.kind === 'workspace-run' || r.kind == null` — the `== null` arm matters because `makeRun` defaults `kind` to `'run'` but a locally-minted run can carry `undefined`. `overviewRuns()` has exactly one caller, `renderOverview()` at `app.js:11468` (`grep -n overviewRuns ui test` → declaration + that one call), so nothing outside the Running list depends on it returning scans.

Inside `renderOverview`, the derived counts do need the same treatment, and get it for free: `live` is now pipeline-only, which makes `livePipes = live.filter(isPipelineRun)` (`app.js:11476`) a no-op — it is deleted and `live.length` drives the "N pipelines executing" copy, which is exactly what it counted before. `needs` (`app.js:11477`) narrows from "live runs with a pending question" to "live *pipelines* with a pending question"; that is a no-op in practice (only the orchestrator emits `question` frames, and `onScanEvent`/`onAgentGenEvent` never set `pendingQuestion`) and is the correct reading of the pill either way. No test asserts `#running-sub` (`grep -rn "pipelines executing\|running-sub" test/*.mjs` → nothing).

> NOTE: spec §4.1 specifies the banner as "Amber family (`--amber-bg` fill, `--amber` border, `--amber-ink` text)", while the mockup (`Worca Running.dc.html:148-150`) paints a softer two-tone: `background:#FEF7EC` wash, `border:1px solid #FCE8C8`, and a `#FCE8C8` circle with `#A66510` glyph. Those two disagree: with the banner filled `--amber-bg` (`#FCE8C8`) the mockup's circle would be invisible against it. This task follows the spec prose (token-only, and the contract forbids new `:root` tokens) and inverts the circle to `--panel` on the amber field. Spec §9 explicitly sanctions `#FEF7EC` as a future token ("preferably as new tokens"), so if T12's polish pass adds `--amber-wash`, this banner is the first rule to move onto it.

> NOTE: spec §10 folds "non-pipeline exclusion" into `test/ui-running-card.test.mjs`, which T3 creates and owns. To keep two parallel tasks off one file, this task's suite is `test/ui-running-list.test.mjs` (list membership + the ask banner — both list chrome, neither card anatomy).

> NOTE: `.rab-mark` / `.rab-text` are new class names. The contract fixes only the root `.run-ask-banner`; these two are the banner's internals and are introduced here.

- [ ] **Step 1: Write the failing test**

Create `test/ui-running-list.test.mjs`:

```javascript
// test/ui-running-list.test.mjs — what the Running LIST contains, and the inert
// "waiting on your answers" banner above it. Card anatomy is not this suite's
// business (see test/ui-running-card.test.mjs); membership and chrome are.
//
// boot() is a deliberate local copy of test/ui-running-order.test.mjs:14-50 and
// go() of test/ui-history-routing.test.mjs:93-96; live() is copied from
// test/ui-pipeline-tabs.test.mjs:38-41. The suites do not import each other.
// ruleBody() is the CSS-as-text idiom from test/ui-run-flow-css.test.mjs:17-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath  = fileURLToPath(new URL('../ui/public/app.js',   import.meta.url));
const cssPath  = fileURLToPath(new URL('../ui/public/style.css', import.meta.url));
const PROJECT = '/tmp/proj';

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};   // jsdom has no layout
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    if (u.includes('/api/resume')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, runId: 'r-new', pipelineId: 'p1' }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);  // cache-bust: fresh module each test
  await new Promise((r) => setTimeout(r, 0));                    // let loadProjects/loadConfig settle
  const np = window.__np;
  // WS is created at import time (connectWS()) → lastWs is set now.
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  const selectProject = () => {
    const s = window.document.querySelector('#projectSelect');
    s.value = PROJECT;
    s.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { window, np, recv, selectProject, tick };
}

function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

const live = (runId, extra = {}) => ({
  runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});

const QUESTION = { id: 'q1', kind: 'clarify', questions: [{ question: 'which db?', options: ['pg'] }] };

const cardIds = (window) =>
  [...window.document.querySelectorAll('#run-list .run-card')].map((c) => c.dataset.runId);
const bannerOf = (window) => window.document.querySelector('.run-ask-banner');

test('workspace scans and agent generations no longer render as run cards', async () => {
  const { window, recv, tick } = await boot();
  go(window, 'running');
  recv({ type: 'hello', runs: [
    live('scan-1', { kind: 'scan' }),
    live('gen-1', { kind: 'agentgen' }),
    live('pipe-1'),
    live('ws-1', { kind: 'workspace-run' }),
  ] });
  await tick();
  assert.deepEqual(cardIds(window).sort(), ['pipe-1', 'ws-1'],
    'only kind run | workspace-run render — Running is pipelines only');
});

test('a lone scan leaves the running list on its empty state', async () => {
  const { window, recv, tick } = await boot();
  go(window, 'running');
  recv({ type: 'hello', runs: [live('scan-1', { kind: 'scan' })] });
  await tick();
  assert.equal(cardIds(window).length, 0);
  assert.ok(window.document.querySelector('#run-list .run-empty'), 'the empty state renders');
});

test('the ask banner stays hidden while nothing is waiting', async () => {
  const { window, recv, tick } = await boot();
  go(window, 'running');
  recv({ type: 'hello', runs: [live('pipe-1')] });
  await tick();
  const banner = bannerOf(window);
  assert.ok(banner, 'the Running view carries an ask banner');
  assert.equal(banner.hidden, true);
});

test('one waiting pipeline renders the singular banner directly above the list', async () => {
  const { window, recv, tick } = await boot();
  go(window, 'running');
  recv({ type: 'hello', runs: [live('pipe-1', { pendingQuestion: QUESTION }), live('pipe-2')] });
  await tick();
  const banner = bannerOf(window);
  assert.equal(banner.hidden, false);
  assert.equal(banner.querySelector('.rab-text').textContent, '1 pipeline is waiting on your answers');
  assert.equal(banner.querySelector('.rab-mark').textContent, '?');
  assert.equal(banner.nextElementSibling.id, 'run-list', 'the banner sits directly above #run-list');
});

test('two waiting pipelines render the plural banner, and it clears when they are answered', async () => {
  const { window, recv, tick } = await boot();
  go(window, 'running');
  recv({ type: 'hello', runs: [
    live('pipe-1', { pendingQuestion: QUESTION }),
    live('pipe-2', { pendingQuestion: { ...QUESTION, id: 'q2' } }),
  ] });
  await tick();
  assert.equal(bannerOf(window).querySelector('.rab-text').textContent,
    '2 pipelines are waiting on your answers');

  recv({ type: 'question-resolved', runId: 'pipe-1', id: 'q1' });
  await tick();
  assert.equal(bannerOf(window).querySelector('.rab-text').textContent,
    '1 pipeline is waiting on your answers');

  recv({ type: 'question-resolved', runId: 'pipe-2', id: 'q2' });
  await tick();
  assert.equal(bannerOf(window).hidden, true, 'the banner hides once nothing is waiting');
});

test('the ask banner is deliberately inert', async () => {
  const { window, recv, tick } = await boot();
  go(window, 'running');
  recv({ type: 'hello', runs: [live('pipe-1', { pendingQuestion: QUESTION })] });
  await tick();
  const banner = bannerOf(window);
  assert.equal(banner.getAttribute('role'), null, 'no role=button');
  assert.equal(banner.getAttribute('tabindex'), null, 'not focusable');
  const before = window.location.hash;
  banner.dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick();
  assert.equal(window.location.hash, before, 'clicking the banner navigates nowhere');
});

test('.run-ask-banner is an amber flex row whose [hidden] beats the author display rule', () => {
  const css = readFileSync(cssPath, 'utf8');
  const ruleBody = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    return m ? m[1] : null;
  };
  const body = ruleBody('.run-ask-banner');
  assert.ok(body, '.run-ask-banner rule missing');
  assert.match(body, /display:\s*flex/);
  assert.match(body, /background:\s*var\(--amber-bg\)/);
  assert.match(body, /border:\s*1px solid var\(--amber\)/);
  const hid = ruleBody('.run-ask-banner[hidden]');
  assert.ok(hid, '.run-ask-banner[hidden] rule missing');
  assert.match(hid, /display:\s*none/, 'author display:flex would otherwise beat the UA [hidden] rule');
  assert.match(ruleBody('.run-ask-banner .rab-mark'), /width:\s*26px/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-list.test.mjs`
Expected: FAIL — first case fails with `AssertionError [ERR_ASSERTION]: only kind run | workspace-run render — Running is pipelines only` and `Expected values to be strictly deep-equal: ['gen-1','pipe-1','scan-1','ws-1'] !== ['pipe-1','ws-1']`; the banner cases fail with `AssertionError: the Running view carries an ask banner` (`.run-ask-banner` is `null`); the CSS case fails with `AssertionError: .run-ask-banner rule missing`.

- [ ] **Step 3: Add the banner markup and its CSS**

In `ui/public/index.html`, replace lines 353-355 (the `</div>` closing the Running `.topbar`, the blank line, and the `#run-list` div) with:

```html
          </div>

          <!-- Inert status line (design D14): the per-card question pills are the
               affordance; this only says how many runs are parked. No listener,
               no role=button, no tabindex. -->
          <div class="run-ask-banner" hidden>
            <span class="rab-mark" aria-hidden="true">?</span>
            <span class="rab-text"></span>
          </div>

          <div class="run-list" id="run-list"></div>
```

In `ui/public/style.css`, insert directly after `.run-list{display:flex;flex-direction:column;gap:18px;}` (line 558):

```css
/* "N pipelines are waiting on your answers" — inert status line above the list
   (design D14). Amber family per spec §4.1; the circle inverts to --panel so it
   still reads against the amber field. */
.run-ask-banner{display:flex;align-items:center;gap:12px;margin:0 0 18px;padding:13px 18px;
  background:var(--amber-bg);border:1px solid var(--amber);border-radius:16px;}
.run-ask-banner[hidden]{display:none;}   /* author display:flex beats the UA [hidden] rule */
.run-ask-banner .rab-mark{flex:0 0 auto;display:flex;align-items:center;justify-content:center;
  width:26px;height:26px;border-radius:50%;background:var(--panel);
  color:var(--amber-ink);font-weight:700;font-size:14px;}
.run-ask-banner .rab-text{flex:1;font-weight:500;font-size:13px;color:var(--amber-ink);}
```

- [ ] **Step 4: Filter `overviewRuns` and paint the banner**

Four edits in `ui/public/app.js`. Line numbers are against HEAD `a7e97ac5` and shift as
the earlier edits land — match on content, not on offset.

Replace `app.js:10856-10864` with:

```javascript
// Drives the Overview #run-list. PIPELINES ONLY (design D7): workspace scans and
// agent-generation jobs are wizard-local progress, not runs the user can open, so
// they no longer render as cards — which makes this list identical in membership
// to pipelineTabRuns() (the sidebar), which always filtered this way. Live
// pipelines, PLUS lingering pipelines (the linger feature) and PAUSED runs
// (parked, resumable). Deduped via the Map values being unique objects; sorted by
// the same group ordering.
function overviewRuns() {
  return [...runs.values()]
    .filter((r) => isPipelineRun(r) && (isLive(r) || isLingering(r) || isPaused(r)))
    .sort(cmpTabRuns);
}
```

Replace `app.js:11411-11414` (`renderRunningView`) with:

```javascript
function renderRunningView() {
  // Painted for BOTH branches: the banner is list chrome living OUTSIDE #run-list,
  // so skipping it on the focus path would leave a resolved "waiting on your
  // answers" line on screen.
  renderAskBanner();
  if (state.selectedRunId) return renderFocusView(state.selectedRunId);
  renderOverview();
}
```

Insert `renderAskBanner` immediately before `function renderOverview()` (i.e. after `app.js:11464`):

```javascript
// The "N pipelines are waiting on your answers" line above the list. Deliberately
// INERT (design D14): a status line, not a control — no listener, no role, no
// tabindex. Reads the SAME set the list renders, so a run that is filtered out of
// the list can never be counted here.
function renderAskBanner() {
  const banner = $('.run-ask-banner');
  if (!banner) return;
  const n = overviewRuns().filter((r) => r.pendingQuestion).length;
  banner.hidden = n === 0;
  if (!n) return;
  const txt = banner.querySelector('.rab-text');
  if (txt) {
    txt.textContent = n === 1
      ? '1 pipeline is waiting on your answers'
      : `${n} pipelines are waiting on your answers`;
  }
}
```

Then replace `app.js:11469-11480` (the empty-copy comment through the `#running-sub` write) with:

```javascript
  // Pipelines only (D7) — but the empty copy stays "runs" per spec §4.2: it is
  // still true, and it is the wording the design keeps.
  paintRunList(list, rows, 'No active runs — start one from New.');

  // `rows` is already pipeline-only, so `live` IS the live-pipeline set the
  // "N pipelines executing" copy claims; "needs input" counts the ones asking.
  const live = rows.filter(isLive);
  const needs = live.filter((r) => r.pendingQuestion).length;
  const sub = $('#running-sub');
  if (sub) sub.textContent =
    `${live.length} pipeline${live.length === 1 ? '' : 's'} executing · ${needs} need${needs === 1 ? 's' : ''} your input`;
```

- [ ] **Step 5: Run the new suite green**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-list.test.mjs`
Expected: PASS — `# pass 7`, `# fail 0`.

- [ ] **Step 6: Update the one existing test that locks the old behavior**

`test/ui-pipeline-tabs.test.mjs:181-193` asserts "scan still renders as an Overview card" — the exact carve-out D7 reverses. Replace those lines with:

```javascript
// v2 + D7: a live NON-pipeline run (e.g. a scan) gets no child tab AND no
// Overview card — Running is pipelines only, and a scan's progress belongs to its
// wizard. This deliberately reverses the Q&A #3 carve-out the original of this
// test locked in.
test('a live non-pipeline run renders nowhere in Running', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [live('scan-1', { kind: 'scan' })] });
  const tabs = window.document.querySelectorAll('#nav-running-children .nav-child');
  assert.equal(tabs.length, 0, 'scan gets no pipeline tab');
  window.location.hash = 'running';   // Overview only paints #run-list while on the Running view
  window.dispatchEvent(new window.Event('hashchange'));
  const cards = window.document.querySelectorAll('#run-list .run-card');
  assert.equal(cards.length, 0, 'and no Overview card either');
  assert.ok(window.document.querySelector('#run-list .run-empty'), 'the list shows its empty state');
});
```

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-pipeline-tabs.test.mjs`
Expected: PASS — `# fail 0`.

- [ ] **Step 7: Run every other `#run-list` consumer suite**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-order.test.mjs test/ui-scroll.test.mjs test/ui-duration.test.mjs test/ui-question.test.mjs test/ui-cost-paused.test.mjs test/ui-stepper.test.mjs test/ui-sidebar-counts.test.mjs`
Expected: PASS — `ℹ fail 0`. These are every suite that queries `#run-list` (`grep -rln "#run-list" test/*.mjs`); each seeds runs with the default `kind:'run'`, so none should move.

- [ ] **Step 8: Commit**

```
git add ui/public/app.js ui/public/index.html ui/public/style.css test/ui-running-list.test.mjs test/ui-pipeline-tabs.test.mjs
git commit -m "feat(ui): show only pipelines in Running, plus an inert ask banner

overviewRuns() gains the isPipelineRun filter (D7), so workspace scans and
agent-generation jobs stop rendering as run cards and the list matches the
sidebar's membership exactly. Above it, a new .run-ask-banner says how many
pipelines are parked on a question — deliberately inert (D14): no listener,
no role, no tabindex."
```

---

### Task 3: New run-card header (avatar / title / meta / branch / action cluster); drop `.run-foot`

**Files:**
- Create: `test/ui-running-card.test.mjs`
- Modify: `ui/public/index.html:358-382` (rewrite `#run-card-tpl`'s head, delete `.run-foot`)
- Modify: `ui/public/app.js:1516-1531` (`onState` captures `branch.source`)
- Modify: `ui/public/app.js:2669-2745` (`window.__np` gains the new painters + `PHASE_LABEL`)
- Modify: `ui/public/app.js:10952-10959` (`renderRunMeta` — started-at only, plus the branch chip)
- Modify: `ui/public/app.js:10960-11002` (`buildRunCard` — bind header nav + chevron + branch copy)
- Modify: `ui/public/app.js:11290-11326` (`paintRunCard` — avatar + status word + question pill, chip gone)
- Modify: `ui/public/app.js:11765-11776` (delete the `.run-top` click-to-focus listener)
- Modify: `ui/public/style.css:560-566` (`.run-top` / `.run-meta` retired), `:587-593` (`.run-foot`, `.chip`, `.btn-*.sm`), `:192` (`#run-list .run-card .run-top` cursor), EOF (new `.rc-*` block)
- Test: `test/ui-running-card.test.mjs`
- Test (updated): `test/ui-cost-paused.test.mjs`, `test/ui-running-pause-fixes.test.mjs`, `test/ui-running-resume.test.mjs`, `test/ui-duration.test.mjs`

**Interfaces:**
- Consumes: `statusPill(r) -> {family,text}` (`app.js:10924`), `copyBranchToClipboard(btn, branch)` (`3658`), `flashCopyBtn(btn, msg)` (`3647`), `pauseRun(runId, btn)` (`7831`), `resumeRunFromCard(runId, btn, opts)` (`7908`), `stopRun(runId, btn)` (`7806`), `questionCount(pq) -> number` (`11404`), `startedLabel(startedAt) -> string` (`10912`), `histStatusMeta`/`paintHistStatusIcon` (`9417`/`9425`) as the shape to mirror.
- Produces:
  - `runStatusMeta(r) -> { family: 'blue'|'amber'|'green'|'red', word: string, glyph: 'spin'|'ask'|'pause'|'check'|'square'|'bang' }`
  - `paintRunStatusIcon(host: Element|null, r) -> void`
  - `renderRunMeta(r, root = r.el) -> void` (signature unchanged; now also paints `.rc-branch`)
  - DOM contract for T4/T5/T6: `.rc-head[role=button][tabindex=0]` > `.rc-sic` + `.rc-body`(`.rc-title.run-title`, `.rc-meta`(`.rc-status-word`, `.rm-text`, `.run-time`, `.run-cost`), `.rc-branch`(`.rc-base`, `.rc-branch-copy` > `.rc-branch-name`, `.rc-copied`)) + `.rc-acts`(`.rc-qpill`, `.btn-resume`, `.btn-pause`, `.btn-stop`, `.rc-open`)
  - `window.__np` additions: `runStatusMeta`, `paintRunStatusIcon`, `renderRunMeta`, `PHASE_LABEL`

> NOTE: The spec's `.rc-acts` line says "all `stopPropagation`". `.btn-pause` / `.btn-resume` / `.btn-stop` are driven by the **delegated** `#run-list` click listener (`app.js:7959-7981`); calling `stopPropagation` on them would stop the event before `#run-list` ever sees it and silently kill Pause/Resume/Stop. This plan therefore stops propagation only on `.rc-open` and `.rc-branch-copy` (which own per-card listeners, exactly as `.hist-open` / `.hist-branch-copy` do at `app.js:8904`, `8867-8870`), and relies on the header listener's `e.target.closest('button, a, input, textarea')` bail-out for the three action buttons. Step 1's "Pause and Stop still reach their endpoints" test is the regression guard.

> NOTE: Spec §4.3's `.rc-meta` is "accent dot · status word · `started HH:MM:SS` · elapsed · cost" — it has no project-name segment, so the project name leaves the run card. It is not lost from the product: the sidebar `.nav-child` rows still render it (`app.js:11557` signature), and T6 puts it on `.rd-meta` row 2. Following the spec literally here.

> NOTE: `currentNodeCycles(r)` (`app.js:11279`) has exactly one caller — the `.run-foot` chip this task deletes. It is left in place (unused) for T7's Overview "cycle N" copy; T12's dead-code sweep owns the decision. `PHASE_LABEL` keeps its `renderQpanel` caller (`app.js:4005`).

- [ ] **Step 1: Write the failing test**

Create `test/ui-running-card.test.mjs`:

```javascript
// test/ui-running-card.test.mjs — run-card v2 header: status avatar, title, meta
// line, branch chip, action cluster, and header-click navigation.
//
// boot()/dispatch()/showRunning()/helloRunning() are copied VERBATIM from
// test/ui-question.test.mjs (lines 19-96) — the nearest suite that both captures
// the WebSocket instance and lets a case intercept fetch, which the Pause/Stop
// POST assertions need.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() {
      this.readyState = 1;
      this._listeners = {};
      wsBox.ws = this;
    }
    send() {}
    close() {}
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    }
    dispatch(type, evt) {
      (this._listeners[type] || []).forEach((fn) => fn(evt));
    }
  };

  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) {
      const r = fetchHandler(String(url), opts || {});
      if (r) return r;
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] }),
    });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch {
      /* read-only global already present — leave it */
    }
  }
  globalThis.window = window;
  globalThis.document = window.document;

  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  function dispatch(msg) {
    wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
  }
  function showRunning() {
    window.location.hash = 'running';
    window.dispatchEvent(new window.Event('hashchange'));
  }
  return { window, dispatch, showRunning, calls, wsBox };
}

const RUN_ID = 'run-aaa';

function helloRunning(ctx, extra = {}) {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({
    type: 'hello',
    runs: [
      { runId: RUN_ID, title: 'Demo run', projectDir: '/tmp/p', status: 'running', startedAt: '2026-01-01T00:00:00Z', ...extra },
    ],
  });
}

const cardOf = (ctx) => ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);

test('header anatomy: avatar, ellipsised title, meta line, action cluster — and no .run-foot', async () => {
  const ctx = await boot();
  helloRunning(ctx);
  ctx.showRunning();

  const card = cardOf(ctx);
  assert.ok(card, 'run card built');
  const head = card.querySelector('.rc-head');
  assert.ok(head, '.rc-head present');
  assert.equal(head.getAttribute('role'), 'button', 'header is a button for AT');
  assert.equal(head.getAttribute('tabindex'), '0', 'header is focusable');

  assert.ok(head.querySelector('.rc-sic'), '.rc-sic status avatar present');
  assert.equal(head.querySelector('.rc-title').textContent, 'Demo run');
  assert.ok(head.querySelector('.rc-meta .rc-status-word'), 'status word lives in the meta line');
  assert.ok(head.querySelector('.rc-meta .rm-text'), 'started-at segment kept');
  assert.ok(head.querySelector('.rc-meta .run-time'), '.run-time kept (the 1s ticker writes it)');
  assert.ok(head.querySelector('.rc-meta .run-cost'), '.run-cost kept');
  assert.ok(head.querySelector('.rc-branch'), 'branch chip slot present');

  assert.ok(head.querySelector('.rc-acts .btn-pause'), 'Pause moved into the action cluster');
  assert.ok(head.querySelector('.rc-acts .btn-resume'), 'Resume moved into the action cluster');
  assert.ok(head.querySelector('.rc-acts .btn-stop'), 'Stop moved into the action cluster');
  assert.ok(head.querySelector('.rc-acts .rc-open'), 'chevron present');

  assert.equal(card.querySelector('.run-foot'), null, '.run-foot is gone');
  assert.equal(card.querySelector('.run-top'), null, '.run-top is gone');
  assert.equal(card.querySelector('.chip'), null, 'the phase chip is gone');
  assert.equal(card.querySelector('.pill-run'), null, 'the old status pill is gone from the card');
});

test('status avatar: family + single glyph per run state, word from statusPill', async () => {
  const ctx = await boot();
  const { upsertRun, buildRunCard, paintRunCard } = ctx.window.__np;
  const cases = [
    ['running',  { status: 'running' },  'st-blue',  'sic-spin',   'Running'],
    ['starting', { status: 'starting' }, 'st-blue',  'sic-spin',   'Starting'],
    ['ask',      { status: 'running', pendingQuestion: { id: 'q', questions: [{ question: 'x?' }] } },
                                          'st-amber', 'sic-ask',    'Paused · awaiting answers'],
    ['paused',   { status: 'paused' },   'st-amber', 'sic-pause',  'Paused'],
    ['pausing',  { status: 'pausing' },  'st-amber', 'sic-pause',  'Pausing…'],
    ['done',     { status: 'done' },     'st-green', 'sic-check',  'Done'],
    ['stopped',  { status: 'stopped' },  'st-red',   'sic-square', 'Stopped'],
    ['error',    { status: 'error' },    'st-red',   'sic-bang',   'Error'],
  ];
  for (const [id, patch, family, glyph, word] of cases) {
    const r = upsertRun({ runId: `s-${id}`, title: 't', projectDir: '/tmp/p', ...patch });
    r.el = buildRunCard(r);
    paintRunCard(r);
    const sic = r.el.querySelector('.rc-sic');
    assert.ok(sic.classList.contains(family), `${id}: avatar family ${family}`);
    const on = [...sic.querySelectorAll('.sic')].filter((s) => !s.hasAttribute('hidden'));
    assert.equal(on.length, 1, `${id}: exactly one glyph visible`);
    assert.ok(on[0].classList.contains(glyph), `${id}: glyph is ${glyph}`);
    assert.equal(sic.title, word, `${id}: avatar title is the status word`);
    assert.equal(sic.getAttribute('aria-label'), word, `${id}: avatar aria-label is the status word`);
    assert.equal(r.el.querySelector('.rc-status-word').textContent, word, `${id}: meta word`);
  }
});

test('meta line: status-word family follows statusPill, started-at renders, elapsed + cost paint', async () => {
  const ctx = await boot();
  const { upsertRun, buildRunCard, paintRunCard, onState } = ctx.window.__np;
  const r = upsertRun({ runId: 'm1', title: 't', projectDir: '/tmp/p', status: 'running', startedAt: '2026-01-01T09:30:15Z' });
  r.el = buildRunCard(r);
  onState(r, { status: 'running', phase: 'implement', totalCostUsd: 1.25 });
  const word = r.el.querySelector('.rc-status-word');
  assert.equal(word.textContent, 'Implementing');
  assert.ok(word.classList.contains('st-blue'), "statusPill's blue family lands on the word");
  assert.match(r.el.querySelector('.rm-text').textContent, /^started \d\d:\d\d:\d\d$/,
    'the meta segment is the started-at clock only (project moved to the sidebar/detail)');
  assert.equal(r.el.querySelector('.run-cost').textContent, '$1.25');
  assert.ok(r.el.querySelector('.run-time').textContent, 'elapsed painted');
});

test('branch chip: base → feature, copies on click, and never opens the run', async () => {
  const ctx = await boot();
  const { upsertRun, buildRunCard, onState } = ctx.window.__np;
  // Stub the clipboard AFTER boot, on the RETURNED window — copyBranchToClipboard
  // reads navigator.clipboard at CLICK time. Precedent: ui-history-detail.test.mjs:263-270.
  const writes = [];
  Object.defineProperty(ctx.window.navigator, 'clipboard', {
    value: { writeText: async (t) => { writes.push(t); } },
    configurable: true,
  });

  const r = upsertRun({ runId: 'br1', title: 't', projectDir: '/tmp/p', status: 'running' });
  r.el = buildRunCard(r);
  const chip = r.el.querySelector('.rc-branch');
  assert.equal(chip.hidden, true, 'no chip before a branch is known');

  onState(r, { branch: { feature: 'feat/x', source: 'main' } });
  assert.equal(chip.hidden, false, 'the chip appears when the branch lands on a later state event');
  assert.equal(r.el.querySelector('.rc-branch-name').textContent, 'feat/x');
  assert.equal(r.el.querySelector('.rc-base').textContent, 'main →');
  assert.equal(r.el.querySelector('.rc-base').hidden, false);

  const before = ctx.window.location.hash;
  r.el.querySelector('.rc-branch-copy').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(writes, ['feat/x'], 'the copy button copies the feature branch');
  assert.equal(ctx.window.location.hash, before, 'copying must not navigate');
});

test('a source-less branch hides only the "base →" prefix', async () => {
  const ctx = await boot();
  const { upsertRun, buildRunCard, onState } = ctx.window.__np;
  const r = upsertRun({ runId: 'br2', title: 't', projectDir: '/tmp/p', status: 'running' });
  r.el = buildRunCard(r);
  onState(r, { branch: { feature: 'feat/y' } });
  assert.equal(r.el.querySelector('.rc-branch').hidden, false);
  assert.equal(r.el.querySelector('.rc-base').hidden, true, 'no source branch -> no "base →" prefix');
});

test('clicking the card header opens #running/<runId>', async () => {
  const ctx = await boot();
  helloRunning(ctx);
  ctx.showRunning();
  cardOf(ctx).querySelector('.rc-head').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(ctx.window.location.hash, `#running/${RUN_ID}`);
});

test('Enter on the focused header opens #running/<runId>', async () => {
  const ctx = await boot();
  helloRunning(ctx);
  ctx.showRunning();
  cardOf(ctx).querySelector('.rc-head')
    .dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(ctx.window.location.hash, `#running/${RUN_ID}`);
});

test('Space on the focused header opens #running/<runId>', async () => {
  const ctx = await boot();
  helloRunning(ctx);
  ctx.showRunning();
  cardOf(ctx).querySelector('.rc-head')
    .dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  assert.equal(ctx.window.location.hash, `#running/${RUN_ID}`);
});

test('the chevron opens #running/<runId>', async () => {
  const ctx = await boot();
  helloRunning(ctx);
  ctx.showRunning();
  cardOf(ctx).querySelector('.rc-open').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(ctx.window.location.hash, `#running/${RUN_ID}`);
});

// REGRESSION GUARD: the action buttons ride the DELEGATED #run-list listener
// (app.js:7959). A stopPropagation on them would silently kill Pause/Stop.
test('Pause and Stop still reach their endpoints from the header cluster, without navigating', async () => {
  const posts = [];
  const ctx = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/pause') || url.includes('/api/stop')) {
        posts.push({ url, body: JSON.parse(opts.body) });
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      return null;
    },
  });
  helloRunning(ctx);
  ctx.showRunning();
  const card = cardOf(ctx);
  const before = ctx.window.location.hash;
  card.querySelector('.btn-pause').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  card.querySelector('.btn-stop').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posts.length, 2, 'both actions posted');
  assert.ok(posts[0].url.includes('/api/pause'));
  assert.deepEqual(posts[0].body, { runId: RUN_ID });
  assert.ok(posts[1].url.includes('/api/stop'));
  assert.deepEqual(posts[1].body, { runId: RUN_ID });
  assert.equal(ctx.window.location.hash, before, 'an action button must not open the run');
});

test('a paused run swaps Pause for Resume inside the cluster', async () => {
  const ctx = await boot();
  const { upsertRun, buildRunCard, paintRunCard, onState } = ctx.window.__np;
  const r = upsertRun({ runId: 'p9', title: 't', projectDir: '/tmp/p', status: 'running' });
  r.el = buildRunCard(r);
  paintRunCard(r);
  assert.equal(r.el.querySelector('.rc-acts .btn-pause').hidden, false);
  assert.equal(r.el.querySelector('.rc-acts .btn-resume').hidden, true);
  onState(r, { status: 'paused' });
  assert.equal(r.el.querySelector('.rc-acts .btn-pause').hidden, true);
  assert.equal(r.el.querySelector('.rc-acts .btn-resume').hidden, false);
});

test('a pending question shows the amber question-count pill in the action cluster', async () => {
  const ctx = await boot();
  helloRunning(ctx);
  ctx.showRunning();
  assert.equal(cardOf(ctx).querySelector('.rc-qpill').hidden, true, 'no pill without a question');
  ctx.dispatch({
    type: 'question', runId: RUN_ID, id: 'q1', kind: 'clarify',
    questions: [{ id: 'a', question: 'x?', options: ['1'] }, { id: 'b', question: 'y?', options: ['2'] }],
  });
  const pill = cardOf(ctx).querySelector('.rc-qpill');
  assert.equal(pill.hidden, false);
  assert.equal(pill.textContent, '2 questions');
  ctx.dispatch({ type: 'question-resolved', runId: RUN_ID, id: 'q1' });
  assert.equal(cardOf(ctx).querySelector('.rc-qpill').hidden, true, 'pill clears when the question resolves');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-card.test.mjs`
Expected: FAIL — first case errors with `AssertionError [ERR_ASSERTION]: .rc-head present` (`assert.ok(head, '.rc-head present')`), and the `__np`-driven cases throw `TypeError: Cannot read properties of null (reading 'classList')` from `r.el.querySelector('.rc-sic')`.

- [ ] **Step 3: Rewrite the `#run-card-tpl` head in `ui/public/index.html`**

Replace `ui/public/index.html:359-365` (the `<section class="card run-card">` opening tag, the whole `.run-top` block, and the `.run-foot` line) with:

```html
            <section class="card run-card" data-run-id="">
              <div class="rc-head" role="button" tabindex="0">
                <span class="rc-sic" role="img">
                  <svg class="sic sic-spin" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M12 3a9 9 0 1 0 9 9" stroke-linecap="round"></path></svg>
                  <svg class="sic sic-ask" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9.1 9a3 3 0 1 1 4.6 2.5c-.9.6-1.7 1.2-1.7 2.3"></path><path d="M12 17.4h.01"></path></svg>
                  <svg class="sic sic-pause" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5"></rect><rect x="14" y="5" width="4" height="14" rx="1.5"></rect></svg>
                  <svg class="sic sic-check" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                  <svg class="sic sic-square" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>
                  <svg class="sic sic-bang" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 6.5v7"></path><path d="M12 17.4h.01"></path></svg>
                </span>
                <div class="rc-body">
                  <div class="rc-title run-title"></div>
                  <div class="rc-meta">
                    <span class="rc-status-word"></span>
                    <span class="rc-seg"><span class="rc-dot">·</span><span class="rm-text"></span></span>
                    <span class="rc-seg"><span class="rc-dot">·</span><span class="run-time mono"></span></span>
                    <span class="rc-seg"><span class="rc-dot">·</span><span class="run-cost mono"></span></span>
                  </div>
                  <span class="rc-branch mono" hidden>
                    <span class="rc-base" hidden></span>
                    <button type="button" class="rc-branch-copy" title="Copy branch name" aria-label="Copy branch name">
                      <span class="rc-branch-name"></span>
                      <svg class="ico-copy" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2.5"></rect><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" stroke-linecap="round"></path></svg>
                      <svg class="ico-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 12.5l5.5 5.5L20 6.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                    </button>
                    <!-- "Copied" feedback with NO JS: the CSS sibling of copyBranchToClipboard's
                         own ~1200ms `.copied` window, exactly like .hd-copied / .hist-copied.
                         No `hidden` attribute — that would desync the a11y tree from the visual. -->
                    <span class="rc-copied">Copied</span>
                  </span>
                </div>
                <div class="rc-acts">
                  <span class="rc-qpill" hidden></span>
                  <button type="button" class="btn-resume" title="Resume — restart this paused pipeline where it left off" aria-label="Resume" hidden><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7z"></path></svg></button>
                  <button type="button" class="btn-pause" title="Pause — gracefully stop the session so it can be resumed" aria-label="Pause"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5"></rect><rect x="14" y="5" width="4" height="14" rx="1.5"></rect></svg></button>
                  <button type="button" class="btn-stop" title="Stop this pipeline" aria-label="Stop"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg></button>
                  <button type="button" class="rc-open" title="Open run" aria-label="Open run"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>
                </div>
              </div>
              <div class="run-flow-wrap"><div class="run-flow"></div></div>
```

Everything from `<div class="cost-banner" hidden></div>` (old `:366`) downward is untouched by this task.

`.btn-resume` keeps its exact stock `title` string — `stockResumeTitle()` (`app.js:11288`) reads it from the template and `test/ui-cost-paused.test.mjs:163-167,174-176` compares against it.
`.run-flow-wrap` keeps the exact `class="run-flow-wrap"><div class="run-flow"></div></div>` adjacency `test/ui-shell.test.mjs:35` regex-matches.

- [ ] **Step 4: Add `runStatusMeta` + `paintRunStatusIcon` to `ui/public/app.js`**

Insert directly after `statusPill` (i.e. after `app.js:10946`, before the `renderRunMeta` comment block):

```javascript
// Status AVATAR family + glyph for a live run. Mirrors histStatusMeta /
// paintHistStatusIcon (app.js:9417-9435) in shape, with one deliberate
// difference: paintHistStatusIcon toggles the .sic children on `family` because
// History's four families map 1:1 onto four glyphs. Running's amber family
// carries TWO glyphs (a pending question vs a pause), so the toggle keys on
// `glyph` and the family only drives the st-* colour class.
//
// Branch order mirrors statusPill exactly (pausing/paused BEFORE pendingQuestion),
// so the glyph and the word can never disagree about why a run is parked.
function runStatusMeta(r) {
  const { text: word } = statusPill(r);
  if (r.status === 'done') return { family: 'green', word, glyph: 'check' };
  if (r.status === 'stopped') return { family: 'red', word, glyph: 'square' };
  if (r.status === 'error') return { family: 'red', word, glyph: 'bang' };
  if (r.status === 'paused' || r.status === 'pausing' || r.status === 'interrupted') {
    return { family: 'amber', word, glyph: 'pause' };
  }
  if (r.pendingQuestion != null) return { family: 'amber', word, glyph: 'ask' };
  return { family: 'blue', word, glyph: 'spin' };   // running / starting / created
}

function paintRunStatusIcon(host, r) {
  if (!host) return;
  const { family, word, glyph } = runStatusMeta(r);
  host.className = host.className.replace(/\bst-\w+\b/g, '').replace(/\s+/g, ' ').trim() + ` st-${family}`;
  host.title = word;
  host.setAttribute('aria-label', word);
  for (const svg of host.querySelectorAll('.sic')) {
    svg.toggleAttribute('hidden', !svg.classList.contains(`sic-${glyph}`));
  }
}
```

Then extend the test hook — in the `window.__np` object (`app.js:2669-2745`), next to `statusPill,` (`:2729`) add:

```javascript
    runStatusMeta,
    paintRunStatusIcon,
    renderRunMeta,
    PHASE_LABEL,
```

- [ ] **Step 5: Rewire `renderRunMeta`, `buildRunCard`, `paintRunCard`; capture the source branch; delete the `.run-top` listener**

(a) `app.js:1526-1528` — `onState` also captures the source branch (the card's `base →` prefix needs it; today only `feature` is read):

```javascript
  if (msg && msg.branch && typeof msg.branch === 'object') {
    if (msg.branch.feature) r.branchFeature = msg.branch.feature;
    if (msg.branch.source) r.branchSource = msg.branch.source;
  }
```

(b) Replace `renderRunMeta` (`app.js:10948-10959`) with:

```javascript
// Render the run-card meta segment (started HH:MM:SS) and the branch chip.
// Called from buildRunCard (with the freshly built node, before r.el is
// assigned) AND from paintRunCard on every repaint, so a branch that arrives on
// a later `state` event (or a resume) refreshes instead of leaving a stale chip.
// The project name is NOT in the card meta any more (design §4.3) — the sidebar
// row and the detail header carry it.
function renderRunMeta(r, root = r.el) {
  if (!root) return;
  const metaEl = root.querySelector('.rm-text');
  if (metaEl) metaEl.textContent = `started ${startedLabel(r.startedAt)}`;

  const branchEl = root.querySelector('.rc-branch');
  if (!branchEl) return;
  const feature = r.branchFeature || '';
  const source = r.branchSource || '';
  branchEl.hidden = !feature;
  branchEl.querySelector('.rc-branch-name').textContent = feature;
  const baseEl = branchEl.querySelector('.rc-base');
  baseEl.textContent = source ? `${source} →` : '';
  baseEl.hidden = !source;
}
```

(c) In `buildRunCard`, after `renderRunMeta(r, node);` (`app.js:10975`), insert:

```javascript
  // Whole-header click -> the run's page. Same recipe as buildHistCard
  // (app.js:8888-8904): interactive descendants opt out via closest(), the
  // chevron fires the same go() with stopPropagation, and Enter/Space mirror
  // the click for the role="button" header.
  const go = () => { location.hash = `running/${r.runId}`; };
  const head = node.querySelector('.rc-head');
  head.addEventListener('click', (e) => {
    if (e.target.closest('button, a, input, textarea')) return;
    go();
  });
  head.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') && !e.target.closest('button, a, input, textarea')) {
      e.preventDefault();
      go();
    }
  });
  node.querySelector('.rc-open').addEventListener('click', (e) => { e.stopPropagation(); go(); });
  // NB: .btn-pause/.btn-resume/.btn-stop deliberately do NOT stopPropagation —
  // they are driven by the DELEGATED #run-list listener (app.js:7959) and would
  // go dead. The closest('button') bail-out above is what keeps them from navigating.
  const copyBtn = node.querySelector('.rc-branch-copy');
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();                                  // copying must not open the run
    // Read the CURRENTLY PAINTED name, never a load-time capture: this binder is
    // bound once while renderRunMeta rewrites .rc-branch-name on every later
    // state event (paintHdHeaderMeta:9682-9687 has the same stale-capture note).
    const name = node.querySelector('.rc-branch-name').textContent || '';
    if (name) copyBranchToClipboard(copyBtn, name);
  });
```

(d) In `paintRunCard`, replace the status-pill block (`app.js:11296-11304`) and the foot-chip block (`:11306-11317`) with:

```javascript
  // Status avatar + the meta line's status word. The avatar's 4-family scale
  // (runStatusMeta) and the word's 6-family scale (statusPill) are different on
  // purpose — see design §4.3.
  paintRunStatusIcon(r.el.querySelector('.rc-sic'), r);
  const wordEl = r.el.querySelector('.rc-status-word');
  if (wordEl) {
    const { family, text } = statusPill(r);
    wordEl.textContent = text;
    wordEl.className = `rc-status-word st-${family}`;
  }

  // Question-count pill in the action cluster (replaces the foot chip's
  // "<phase> paused · N questions" copy).
  const qpill = r.el.querySelector('.rc-qpill');
  if (qpill) {
    const n = r.pendingQuestion != null ? questionCount(r.pendingQuestion) : 0;
    qpill.hidden = n === 0;
    qpill.textContent = n ? `${n} question${n === 1 ? '' : 's'}` : '';
  }
```

(e) Replace `.run-title` with the dual-classed title in the two places that query it —
no change needed: `.rc-title run-title` keeps `.run-title` on the element, so
`buildRunCard:10969`, `paintRunCard:11341` and `onTitle:1562` all keep working unmodified.

(f) Delete `app.js:11765-11776` entirely (the comment + the `#run-list` `.run-top` delegated
click-to-focus listener). Navigation is per-card now.

- [ ] **Step 6: Add the `.rc-*` CSS**

Delete `ui/public/style.css:192` (`#run-list .run-card .run-top { cursor: pointer; }`),
`:560` (`.run-top{…}`), `:564` (`.run-meta{…}`), `:587` (`.run-foot{…}`), `:588-589`
(`.chip{…}` / `.chip.qcount{…}` — `.qcount` is re-styled inside `.qpanel-head` at `:636`),
and `:590-593` (`.btn-stop.sm` / `.btn-pause.sm` / `.btn-resume.sm` / `.btn-pause.sm + .btn-stop.sm`).

Append at the end of `ui/public/style.css`:

```css

/* ---------- Running list card v2 (.rc-*) ----------
   Appended at EOF, after every surviving `.run-*` / `.btn-*` rule — the Running
   block is not contiguous (it also lives at ~557-600 and ~1109) and .btn-pause /
   .btn-resume / .btn-stop have base rules at 237-254, so a mid-file append would
   lose the source-order tie. Same reasoning as the History list card v2 block. */
.rc-head{display:flex;align-items:flex-start;gap:13px;cursor:pointer;}
.rc-head:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.rc-sic{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;
  border-radius:50%;flex:0 0 auto;align-self:center;}
.rc-sic .sic[hidden]{display:none;}
.rc-sic.st-blue{background:var(--blue-bg);color:var(--blue-ink);}
.rc-sic.st-amber{background:var(--amber-bg);color:var(--amber-ink);}
.rc-sic.st-green{background:var(--green-bg);color:var(--green-ink);}
.rc-sic.st-red{background:var(--red-bg);color:var(--red-ink);}
.rc-sic .sic-spin{animation:wr-spin 1.15s linear infinite;transform-origin:50% 50%;}
.rc-body{flex:1;min-width:0;}
.rc-title{display:block;font-weight:600;font-size:14.5px;letter-spacing:-.01em;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rc-meta{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-top:5px;
  color:var(--ink-3);font-size:12.5px;}
.rc-meta .rc-seg{display:inline-flex;align-items:center;gap:7px;}
.rc-dot{font:700 16px/1 var(--mono);color:var(--ink);}
.rc-status-word{font:600 12px var(--sans);display:inline-flex;align-items:center;gap:7px;}
/* the 7px status accent dot before the word; currentColor = the family ink */
.rc-meta .rc-status-word::before{content:'';width:7px;height:7px;border-radius:50%;
  background:currentColor;flex:0 0 auto;}
.rc-status-word.st-peach{color:var(--peach-ink);}
.rc-status-word.st-blue{color:var(--blue-ink);}
.rc-status-word.st-violet{color:var(--violet-ink);}
.rc-status-word.st-amber{color:var(--amber-ink);}
.rc-status-word.st-green{color:var(--green-ink);}
.rc-status-word.st-red{color:var(--red-ink);}
.rc-meta .run-time,.rc-meta .run-cost{font-weight:700;color:var(--ink);}
.rc-branch{display:flex;align-items:center;gap:6px;margin-top:6px;min-width:0;
  font-family:var(--mono);font-size:12px;font-weight:600;color:var(--ink-2);}
.rc-branch[hidden]{display:none;}      /* author display:flex beats the UA [hidden] rule */
.rc-base{color:var(--ink-3);font-weight:500;white-space:nowrap;}
.rc-base[hidden]{display:none;}
.rc-branch-copy{display:inline-flex;align-items:center;gap:8px;min-width:12ch;
  padding:4px 10px;border:1px solid var(--line);border-radius:9px;background:var(--field);
  font:700 11.5px var(--mono);color:var(--ink);cursor:pointer;}
.rc-branch-copy:hover{border-color:var(--ink-3);background:var(--panel);}
.rc-branch-name{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rc-branch-copy .ico-check{display:none;}
.rc-branch-copy.copied .ico-copy{display:none;}
.rc-branch-copy.copied .ico-check{display:inline;color:var(--green-ink);}
/* "Copied" caption — the CSS-only mechanism .hd-copied / .hist-copied use, driven
   off copyBranchToClipboard's own ~1200ms `.copied` window. No extra JS. */
.rc-copied{display:none;font:500 11px var(--sans);color:var(--green-ink);}
.rc-branch-copy.copied + .rc-copied{display:inline;}
.rc-acts{display:flex;align-items:center;gap:8px;flex:0 0 auto;align-self:center;margin-left:auto;}
.rc-qpill{display:inline-flex;align-items:center;padding:5px 11px;border-radius:999px;
  background:var(--amber-bg);color:var(--amber-ink);font:700 11.5px var(--sans);white-space:nowrap;}
.rc-qpill[hidden]{display:none;}
/* the four 30px icon buttons; .rc-open mirrors .hist-open (1965-1967) exactly */
.rc-acts .btn-pause,.rc-acts .btn-resume,.rc-acts .btn-stop,.rc-open{
  display:inline-flex;align-items:center;justify-content:center;gap:0;
  width:30px;height:30px;padding:0;border-radius:9px;background:var(--panel);cursor:pointer;}
.rc-acts .btn-pause,.rc-acts .btn-resume{border:1px solid var(--amber);color:var(--amber-ink);}
.rc-acts .btn-pause:hover,.rc-acts .btn-resume:hover{background:var(--amber-bg);}
.rc-acts .btn-stop{border:1px solid var(--red);color:var(--red-ink);}
.rc-acts .btn-stop:hover{background:var(--red-bg);}
/* The base `.btn-pause[hidden],.btn-resume[hidden]` rule (254) ties on specificity
   with `.rc-acts .btn-pause` above and would LOSE on source order — a paused card
   would show both buttons. Re-state it at the cluster's specificity. */
.rc-acts .btn-pause[hidden],.rc-acts .btn-resume[hidden]{display:none;}
.rc-open{border:1px solid var(--line);color:var(--ink-2);}
.rc-open:hover{background:var(--ink);color:#fff;border-color:var(--ink);}
.rc-open:focus-visible,.rc-branch-copy:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
@keyframes wr-spin{to{transform:rotate(360deg);}}
/* Placed AFTER the rule it neutralizes — source order, not specificity, is what wins. */
@media (prefers-reduced-motion: reduce){
  .rc-sic .sic-spin{animation:none;}
}
```

- [ ] **Step 7: Run the new suite to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-card.test.mjs`
Expected: PASS — `# pass 12`, `# fail 0`.

- [ ] **Step 8: Update the existing suites this breaks**

`test/ui-cost-paused.test.mjs` — four assertions read the retired card pill:
- `:108` `assert.equal(card.querySelector('.pill-run .pill-text').textContent, 'Paused · cost limit');`
  → `assert.equal(card.querySelector('.rc-status-word').textContent, 'Paused · cost limit');`
- `:149` same swap, `'Paused · total budget'`.
- `:184` same swap, `'Paused'`.
- `:293` same swap, `'Paused · cost limit'`.
(`:107,146,155,160,165,173,175,185` all read `.btn-resume` / its `title` and stay as they are.)

`test/ui-running-pause-fixes.test.mjs`:
- `:41-46` test `(a)` — `.btn-resume.sm` is deleted. Replace the body with:
```javascript
test('(a) the header action cluster right-aligns via margin-left:auto', () => {
  const css = readFileSync(cssPath, 'utf8');
  const m = css.match(/\.rc-acts\s*\{([^}]*)\}/);
  assert.ok(m, '.rc-acts rule missing — the header action cluster has no layout');
  assert.match(m[1], /margin-left:\s*auto/, '.rc-acts must right-align Pause/Stop/chevron in the header');
  assert.match(css, /\.rc-acts \.btn-pause,[^{]*\.rc-open\{[^}]*width:\s*30px/, '30px icon buttons');
});
```
- `:60-71` test `(d)` — the branch left `.rm-text` for the chip. Replace lines `:66-70` with:
```javascript
  const chip = () => r.el.querySelector('.rc-branch');
  assert.equal(chip().hidden, true, 'no branch chip before it is known');
  // Branch arrives on a later state snapshot — the chip must refresh.
  onState(r, { branch: { feature: 'feat/x' } });
  assert.equal(chip().hidden, false, 'branch feature must appear in the chip after onState');
  assert.equal(r.el.querySelector('.rc-branch-name').textContent, 'feat/x');
```
- `:74-82` test `(e)` — the green pill became an amber icon button. Replace the body with:
```javascript
test('(e) Pause/Resume render as amber-outline icon buttons in the cluster', () => {
  const css = readFileSync(cssPath, 'utf8');
  const m = css.match(/\.rc-acts \.btn-pause,\.rc-acts \.btn-resume\{([^}]*)\}/);
  assert.ok(m, '.rc-acts .btn-pause,.rc-acts .btn-resume rule missing');
  assert.match(m[1], /border:\s*1px solid var\(--amber\)/);
  assert.match(m[1], /color:\s*var\(--amber-ink\)/);
});
```
- `:84-93` test `(f)` — keep verbatim (the base rule at `:254` stays) and append one line inside it:
```javascript
  assert.match(css, /\.rc-acts \.btn-pause\[hidden\],\.rc-acts \.btn-resume\[hidden\]\{[^}]*display:\s*none/,
    'the cluster must re-state [hidden] at its own specificity, or .rc-acts .btn-pause wins on source order');
```
- `:96-99` test `(g)` — unchanged, still passes (the `.sm` rules are deleted).

`test/ui-running-resume.test.mjs:95` — `assert.match(btn.textContent, /Resume/);` on an icon-only
button. Replace with `assert.match(btn.title, /Resume/, 'failure restores the stock tooltip too');`
(`:94`'s `assert.match(btn.innerHTML, /<svg/i, …)` already carries the "icon intact" intent).

`test/ui-duration.test.mjs` — `chipText()` (`:187`) reads the deleted `.chip`.
Delete the `chipText` helper from the boot return (`:187` and its mention in `:188`) and rewrite the
two assertions that used it:
- `:196` → `assert.equal(ctx.window.__np.getRun('r_mw').phaseKey, 'manual-web', 'manual-web normalizes to its own key');`
  plus `assert.equal(ctx.window.__np.PHASE_LABEL['manual-web'], 'Manual web UI', 'and maps to its own label, not the Preflight default');`
- `:206` → the same pair for `'r_mc'` / `'manual-checklist'` / `'Manual tests'`.

`test/ui-stepper.test.mjs:41` declares a `chipText` helper that no test calls — delete the line
(and its mention in the `:42` return) so the suite carries no reference to `.chip`.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS — no failures. If `ui-shell`, `ui-log-filters-row`, `ui-question`, `ui-scroll`,
`ui-live-log-dom`, `ui-pipeline-tabs` or `ui-running-order` fail, the template's
`.run-flow-wrap`/`.run-log`/`.qpanel`/`data-run-id` shape was altered — restore it, do not
edit those suites.

- [ ] **Step 10: Commit**

Run:
```
git add ui/public/index.html ui/public/app.js ui/public/style.css \
        test/ui-running-card.test.mjs test/ui-cost-paused.test.mjs \
        test/ui-running-pause-fixes.test.mjs test/ui-running-resume.test.mjs \
        test/ui-duration.test.mjs test/ui-stepper.test.mjs
git commit -m "feat(running): rebuild the run-card header and drop .run-foot

Status avatar (runStatusMeta/paintRunStatusIcon), title, meta line, branch copy
chip and a 30px action cluster replace the .run-top/.run-foot split. The header
navigates to #running/<runId>; the delegated .run-top listener is gone."
```

---

### Task 4: Density toggle + compact/detailed bodies; drop `.subs-bar` from the card

**Files:**
- Create: `test/ui-running-density.test.mjs`
- Modify: `ui/public/index.html:347-353` (density toggle in the running topbar)
- Modify: `ui/public/index.html` `#run-card-tpl` (add `data-density`, `.rc-compact`, wrap `.rc-detailed`, delete `.subs-bar`/`.subs-panel`)
- Modify: `ui/public/app.js:10860-10866` region (density constants + `readRunDensity`/`setRunDensity`/`renderDensityToggle` near the Running helpers)
- Modify: `ui/public/app.js:11025-11088` (delete `subsPillText`, `paintSubsBar`), `:11107-11108` (delete `SUBS_DOT_COLOR`), `:11111-11116` + `:11172-11227` (delete `renderSubsTree` + its orphaned comment)
- Modify: `ui/public/app.js:2719-2722` (drop `subsPillText`, `paintSubsBar`, `renderSubsTree` from `window.__np`; add the density trio + `runStepLabel`)
- Modify: `ui/public/app.js:11290-11360` (`paintRunCard` — stamp `data-density`, paint `.rc-compact`, delete the `.subs-bar` block)
- Modify: `ui/public/app.js:11411-11414` (`renderRunningView` paints the toggle)
- Modify: `ui/public/style.css:1167-1211`, `:1216`, `:1222`, `:1238` (delete the card-only `.subs-*` rules; trim the shared lists to their `.hd-ag-*` halves), EOF (density + compact CSS)
- Test: `test/ui-running-density.test.mjs`
- Test (updated): `test/ui-agents-dropdown.test.mjs`, `test/ui-subagent-tree.test.mjs`, `test/ui-subagent-cycle-split.test.mjs`, `test/ui-graphify-count-pill.test.mjs`, `test/ui-subagent-type-pill.test.mjs`, `test/ui-skill-pills.test.mjs`, `test/ui-subagent-pulse-scope.test.mjs`, `test/ui-run-flow-css.test.mjs`
- Test (deleted): `test/ui-subagent-pill.test.mjs`

**Interfaces:**
- Consumes (Task 3): `runStatusMeta(r) -> {family, word, glyph}`; the `.rc-head` / `.rc-acts` DOM contract.
- Consumes (existing): `manifestFor(stepper)` (`app.js:712`), `runGraphNodeIds(manifest)` (`897`), `locateInManifest(manifest, msg)` (`730`, indirectly — `advanceRun:767` is what keeps `maxCellIdx`/`nodeStatus` current), `nodeModelLine(node)` (`825`), `modelUsedByNode(steps)` (`1290`), `subsGroupsForRender` / `cycleAwareLabel` / `stepSkillsFromSteps` / `stepGraphifyFromSteps` (kept, untouched).
- Produces:
  - `RUN_DENSITY_KEY = 'worca-cc.running.density'`, `RUN_DENSITIES = ['compact','detailed']`
  - `let runDensity: 'compact' | 'detailed'` (module-level)
  - `readRunDensity() -> 'compact'|'detailed'`
  - `setRunDensity(v: string) -> void`
  - `renderDensityToggle() -> void`
  - `runStepLabel(r) -> { n: number, m: number, name: string, model: string }`
  - Card root carries `data-density="compact|detailed"`; bodies are `.rc-compact` and `.rc-detailed`
  - `window.__np` additions: `readRunDensity`, `setRunDensity`, `renderDensityToggle`, `runStepLabel`
  - `window.__np` REMOVALS (T5+ must not reference them): `subsPillText`, `paintSubsBar`, `renderSubsTree`

> NOTE: The task brief points at `style.css:1169-1184` for the sub-agent CSS. The real
> card-only span is wider: `:1167-1189` (comment + `.subs-bar` … `.subs-step-head b`),
> `:1199-1207` (`.subs-n` … `.subs-tree li .ag-name`) and `:1216`. `:1215`'s unscoped
> `.subs-skills{…}` must be KEPT — the comment at `:1217-1221` records that History's
> Agents tab renders through it — and `:1195-1198`, `:1208-1211`, `:1222`, `:1238` lose
> only their `.subs-*` halves, exactly as the brief says.

> NOTE: Density hides one body with `display:none`, and a browser resets a hidden
> scroller's `scrollTop`/`scrollLeft` to 0. So "switching density must not lose scroll
> position" is not free: `setRunDensity` stashes `.log` scrollTop and `.run-flow-wrap`
> scrollLeft on the card's dataset before the flip and writes them back after, the same
> save→swap→restore technique `insertCardPreservingScroll` (`app.js:11421`) uses. The
> compact body has no scrollers of its own, so nothing is lost in that direction either.

- [ ] **Step 1: Write the failing test**

Create `test/ui-running-density.test.mjs`:

```javascript
// test/ui-running-density.test.mjs — the Compact/Detailed density toggle, the two
// card bodies, and the removal of the card's Agents disclosure.
//
// boot() is copied VERBATIM from test/ui-pipeline-tabs.test.mjs (lines 15-35) —
// the nearest suite that captures the WebSocket and clears localStorage — with the
// two-line `local` pre-seed from test/ui-history-pills.test.mjs:26-27 added, since
// the persistence cases must write localStorage BEFORE app.js boots.
// instrumentScroll() is copied VERBATIM from test/ui-scroll.test.mjs:44-54.
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
const cssPath = join(root, 'style.css');
const PROJECT = '/tmp/proj';
const KEY = 'worca-cc.running.density';

async function boot({ local } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  window.fetch = (url) => String(url).includes('/api/projects')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  // Pre-seed localStorage BEFORE app.js boots so restore-on-load is exercised.
  if (local) for (const [k, v] of Object.entries(local)) window.localStorage.setItem(k, v);
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const open = () => lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  open();
  const showRunning = () => { window.location.hash = 'running'; window.dispatchEvent(new window.Event('hashchange')); };
  return { window, recv, showRunning };
}

// jsdom has no layout: make scroll geometry observable. scrollTop/scrollLeft become
// plain stored values; the *Height/*Width readbacks are fixed to the passed values.
function instrumentScroll(el, { scrollHeight = 1000, clientHeight = 200, scrollWidth = 1000, clientWidth = 200 } = {}) {
  let top = 0, left = 0;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(el, 'scrollWidth',  { configurable: true, get: () => scrollWidth });
  Object.defineProperty(el, 'clientWidth',  { configurable: true, get: () => clientWidth });
  Object.defineProperty(el, 'scrollTop',  { configurable: true, get: () => top,  set: (v) => { top  = v; } });
  Object.defineProperty(el, 'scrollLeft', { configurable: true, get: () => left, set: (v) => { left = v; } });
}

const RUN_ID = 'run-den';
const live = (runId, extra = {}) => ({
  runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});
const seg = (doc, v) => doc.querySelector(`.run-density .rd-seg[data-density="${v}"]`);
const card = (doc) => doc.querySelector(`#run-list .run-card[data-run-id="${RUN_ID}"]`);

const STEPPER = { version: 1, steps: [
  { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight' }] },
  { kind: 'agents', nodes: [{ id: 's1_0', key: 'planner', uiPhase: 'plan', label: 'Plan', model: 'sonnet', effort: 'high' }] },
  { kind: 'agents', nodes: [{ id: 's2_0', key: 'reviewer', uiPhase: 'review', label: 'Review' }] },
  { kind: 'done', nodes: [{ id: 'done', label: 'Done' }] },
], feedbacks: [] };

test('the running topbar carries a two-segment density toggle, Detailed pressed by default', async () => {
  const { window, showRunning } = await boot();
  showRunning();
  const doc = window.document;
  const group = doc.querySelector('[data-view="running"] .run-density');
  assert.ok(group, '.run-density group present in the running topbar');
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(group.getAttribute('aria-label'), 'List density');
  const segs = [...group.querySelectorAll('button.rd-seg')];
  assert.deepEqual(segs.map((b) => b.dataset.density), ['compact', 'detailed']);
  assert.deepEqual(segs.map((b) => b.getAttribute('aria-pressed')), ['false', 'true']);
  assert.match(segs[0].title, /Compact/);
  assert.match(segs[1].title, /Detailed/);
  assert.ok(segs[0].querySelector('svg') && segs[1].querySelector('svg'), 'both segments carry an icon');
  assert.equal(window.__np.readRunDensity(), 'detailed', 'default density is detailed');
});

test('an absent or invalid stored value falls back to detailed', async () => {
  const bad = await boot({ local: { [KEY]: 'ginormous' } });
  bad.showRunning();
  assert.equal(bad.window.__np.readRunDensity(), 'detailed');
  assert.equal(seg(bad.window.document, 'detailed').getAttribute('aria-pressed'), 'true');
});

test('a stored compact value is honoured at boot and stamped on the cards', async () => {
  const ctx = await boot({ local: { [KEY]: 'compact' } });
  ctx.recv({ type: 'hello', runs: [live(RUN_ID)] });
  ctx.showRunning();
  const doc = ctx.window.document;
  assert.equal(ctx.window.__np.readRunDensity(), 'compact');
  assert.equal(seg(doc, 'compact').getAttribute('aria-pressed'), 'true');
  assert.equal(seg(doc, 'detailed').getAttribute('aria-pressed'), 'false');
  assert.equal(card(doc).dataset.density, 'compact');
});

test('clicking a segment repaints the cards, flips aria-pressed and persists the choice', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live(RUN_ID)] });
  ctx.showRunning();
  const doc = ctx.window.document;
  assert.equal(card(doc).dataset.density, 'detailed');

  seg(doc, 'compact').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(card(doc).dataset.density, 'compact');
  assert.equal(seg(doc, 'compact').getAttribute('aria-pressed'), 'true');
  assert.equal(seg(doc, 'detailed').getAttribute('aria-pressed'), 'false');
  assert.equal(ctx.window.localStorage.getItem(KEY), 'compact', 'choice persisted');

  seg(doc, 'detailed').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(card(doc).dataset.density, 'detailed');
  assert.equal(ctx.window.localStorage.getItem(KEY), 'detailed');
});

test('both bodies ship on every card; CSS is what selects one per density', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live(RUN_ID)] });
  ctx.showRunning();
  const c = card(ctx.window.document);
  assert.ok(c.querySelector('.rc-compact'), '.rc-compact body present');
  assert.ok(c.querySelector('.rc-detailed'), '.rc-detailed body present');
  assert.ok(c.querySelector('.rc-detailed .run-flow-wrap .run-flow'), 'the graph lives in the detailed body');
  assert.ok(c.querySelector('.rc-detailed .run-log .log'), 'the live log lives in the detailed body');
  // .cost-banner and .qpanel are siblings of both bodies — they render at either density.
  assert.equal(c.querySelector('.rc-compact .cost-banner, .rc-detailed .cost-banner'), null);
  assert.equal(c.querySelector('.rc-compact .qpanel, .rc-detailed .qpanel'), null);

  const css = readFileSync(cssPath, 'utf8');
  assert.match(css, /\.run-card\[data-density="compact"\] \.rc-detailed\{[^}]*display:\s*none/);
  assert.match(css, /\.run-card\[data-density="detailed"\] \.rc-compact\{[^}]*display:\s*none/);
});

test('runStepLabel + the compact row: STEP n/m chip, step name, model — and no progress bar', async () => {
  const ctx = await boot();
  const { upsertRun, buildRunCard, paintRunCard, onState, runStepLabel } = ctx.window.__np;
  const r = upsertRun({ runId: 'c1', title: 't', projectDir: PROJECT, status: 'running' });
  r.el = buildRunCard(r);
  onState(r, { status: 'running', phase: 'plan', stepper: STEPPER, steps: [{ key: 'planner', nodeId: 's1_0', cycle: 1, status: 'start' }] });
  paintRunCard(r);

  assert.deepEqual(runStepLabel(r), { n: 2, m: 4, name: 'Plan', model: 'sonnet · high' });
  const row = r.el.querySelector('.rc-compact');
  assert.equal(row.querySelector('.rc-step-chip').textContent, 'STEP 2/4');
  assert.ok(row.querySelector('.rc-step-chip').classList.contains('st-blue'), 'chip tints with the status family');
  assert.equal(row.querySelector('.rc-step-name').textContent, 'Plan');
  assert.equal(row.querySelector('.rc-step-model').textContent, 'sonnet · high');
  assert.equal(row.querySelector('progress, .rc-progress, .progress'), null, 'D15: no progress bar');
});

test('runStepLabel on a run with no manifest and no advance falls back to the first node', async () => {
  const ctx = await boot();
  const { upsertRun, runStepLabel } = ctx.window.__np;
  const r = upsertRun({ runId: 'c2', title: 't', projectDir: PROJECT, status: 'starting' });
  const out = runStepLabel(r);
  assert.equal(out.n, 1);
  assert.equal(out.m, 7, 'CLIENT_DEFAULT_STEPPER has seven nodes');
  assert.equal(out.name, 'Preflight');
});

test('switching density preserves the log scroll position and the graph scroll offset', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live(RUN_ID)] });
  ctx.showRunning();
  const doc = ctx.window.document;
  const c = card(doc);
  const logEl = c.querySelector('.log');
  const flow = c.querySelector('.run-flow-wrap');
  instrumentScroll(logEl, { scrollHeight: 5000, clientHeight: 300 });
  instrumentScroll(flow, { scrollWidth: 4000, clientWidth: 600 });
  // Auto-scroll ON would re-pin the log to the bottom on every repaint.
  ctx.window.__np.setAutoscroll(ctx.window.__np.getRun(RUN_ID), false);
  logEl.scrollTop = 1234;
  flow.scrollLeft = 567;

  seg(doc, 'compact').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(card(doc).dataset.density, 'compact');
  seg(doc, 'detailed').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(card(doc), c, 'the card node is reused, not rebuilt');
  assert.equal(logEl.scrollTop, 1234, 'log position survives the round trip');
  assert.equal(flow.scrollLeft, 567, 'graph offset survives the round trip');
});

test('the card no longer carries the Agents disclosure, and its painters are gone', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live(RUN_ID)] });
  ctx.showRunning();
  const doc = ctx.window.document;
  const tpl = doc.getElementById('run-card-tpl').content.firstElementChild;
  assert.equal(tpl.querySelector('.subs-bar'), null, 'template carries no .subs-bar');
  assert.equal(tpl.querySelector('.subs-panel'), null, 'template carries no .subs-panel');
  assert.equal(card(doc).querySelector('.subs-bar'), null, 'a painted card carries no .subs-bar');

  assert.equal(ctx.window.__np.paintSubsBar, undefined, 'paintSubsBar removed from the test hook');
  assert.equal(ctx.window.__np.renderSubsTree, undefined, 'renderSubsTree removed');
  assert.equal(ctx.window.__np.subsPillText, undefined, 'subsPillText removed');
  // The pure projections History and the future Agents tab need are KEPT.
  assert.equal(typeof ctx.window.__np.subsGroupsForRender, 'function');
  assert.equal(typeof ctx.window.__np.cycleAwareLabel, 'function');
  assert.equal(typeof ctx.window.__np.stepSkillsFromSteps, 'function');
  assert.equal(typeof ctx.window.__np.stepGraphifyFromSteps, 'function');

  const css = readFileSync(cssPath, 'utf8');
  for (const dead of ['.subs-bar', '.btn-subs', '.subs-panel', '.subs-legend', '.subs-step', '.subs-tree']) {
    assert.doesNotMatch(css, new RegExp(dead.replace('.', '\\.') + '[\\s,{]'), `${dead} CSS removed`);
  }
  // The shared lists keep their History halves.
  assert.match(css, /\.hd-ag-head \.subs-stat\{/);
  assert.match(css, /\.hd-ag-row \.st\{/);
  assert.match(css, /\.subs-skills\{/, 'the unscoped .subs-skills base rule History renders through is kept');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-density.test.mjs`
Expected: FAIL — first case errors with `AssertionError [ERR_ASSERTION]: .run-density group present in the running topbar`; the `runStepLabel` cases throw `TypeError: runStepLabel is not a function`.

- [ ] **Step 3: `ui/public/index.html` — toggle, `data-density`, the two bodies, drop `.subs-bar`**

(a) Replace `index.html:352` (the status pill line) with the pill plus the toggle:

```html
            <span class="pill-run amber hidden" id="running-status-pill" style="box-shadow:var(--shadow-soft)"><span class="pdot"></span> 0 needs input</span>
            <div class="run-density" role="group" aria-label="List density">
              <button type="button" class="rd-seg" data-density="compact" aria-pressed="false" title="Compact — three runs per screen">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="5" width="18" height="3" rx="1.5"></rect><rect x="3" y="10.5" width="18" height="3" rx="1.5"></rect><rect x="3" y="16" width="18" height="3" rx="1.5"></rect></svg>
              </button>
              <button type="button" class="rd-seg" data-density="detailed" aria-pressed="true" title="Detailed — one run with graph and log">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"></rect><path d="M6.5 8.5h7" stroke-linecap="round"></path><path d="M6.5 12.5h11" stroke-linecap="round" opacity=".45"></path><path d="M6.5 16h8" stroke-linecap="round" opacity=".45"></path></svg>
              </button>
            </div>
```

(b) Root gets a default density: `<section class="card run-card" data-run-id="" data-density="detailed">`.

(c) Between `.rc-head`'s closing `</div>` and `<div class="run-flow-wrap">`, insert the compact body:

```html
              <div class="rc-compact">
                <span class="rc-step-chip"></span>
                <span class="rc-step-name"></span>
                <span class="rc-step-model mono" hidden></span>
              </div>
              <div class="rc-detailed">
```

(d) Close `.rc-detailed` after the `.run-log` block, and delete the `.subs-bar` block
(`index.html:367-375`) plus move `.cost-banner` out of the detailed wrapper. The tail of the
template becomes:

```html
              <div class="run-flow-wrap"><div class="run-flow"></div></div>
              <div class="run-log">
                <div class="run-log-head"><span class="ll-label">Live log</span><div class="log-filters">…unchanged…</div><div class="switch-row"><div class="switch on autoscroll" role="switch" aria-checked="true" tabindex="0"></div><span class="txt">Auto-scroll</span></div></div>
                <div class="log"></div>
              </div>
              </div><!-- /.rc-detailed -->
              <div class="cost-banner" hidden></div>
              <div class="qpanel hidden"></div>
            </section>
```

The `.log-filters` bar keeps its exact markup — `buildLogFilterBar()` (`app.js:8066`) clones it
for History and `test/ui-log-filters-row.test.mjs:57-75` asserts its sibling order.

- [ ] **Step 4: `ui/public/app.js` — density state, functions and wiring**

Insert immediately before `overviewRuns()` (`app.js:10855`, in the Running-helpers neighbourhood):

```javascript
// ── Running list density (design §4.1, D3) ──────────────────────────────────
// 'detailed' is the default and the choice persists. Read once at boot; the
// toggle writes it and repaints the list.
const RUN_DENSITY_KEY = 'worca-cc.running.density';
const RUN_DENSITIES = ['compact', 'detailed'];

function readRunDensity() {
  try {
    const v = localStorage.getItem(RUN_DENSITY_KEY);
    return RUN_DENSITIES.includes(v) ? v : 'detailed';
  } catch { return 'detailed'; }        // private mode / storage disabled
}

let runDensity = readRunDensity();

function renderDensityToggle() {
  for (const b of $$('.run-density .rd-seg')) {
    b.setAttribute('aria-pressed', String(b.dataset.density === runDensity));
  }
}

// Density hides one body with `display:none`, and a hidden scroller's
// scrollTop/scrollLeft are reset to 0 by the browser. Stash them on the card
// across the flip and write them back once the body is visible again — the same
// save→swap→restore technique as insertCardPreservingScroll (app.js:11421).
// The `if (…scrollTop)` guards are load-bearing: reading a HIDDEN scroller
// yields 0, which must not overwrite the stashed value.
function stashCardScroll(cardEl) {
  const logEl = cardEl.querySelector('.log');
  const flowEl = cardEl.querySelector('.run-flow-wrap');
  if (logEl && logEl.scrollTop) cardEl.dataset.logTop = String(logEl.scrollTop);
  if (flowEl && flowEl.scrollLeft) cardEl.dataset.flowLeft = String(flowEl.scrollLeft);
}
function applyCardScroll(cardEl) {
  const logEl = cardEl.querySelector('.log');
  const flowEl = cardEl.querySelector('.run-flow-wrap');
  const top = Number(cardEl.dataset.logTop || 0);
  const left = Number(cardEl.dataset.flowLeft || 0);
  if (logEl && top) logEl.scrollTop = top;
  if (flowEl && left) flowEl.scrollLeft = left;
}

function setRunDensity(v) {
  const next = RUN_DENSITIES.includes(v) ? v : 'detailed';
  if (next === runDensity) { renderDensityToggle(); return; }
  runDensity = next;
  try { localStorage.setItem(RUN_DENSITY_KEY, next); } catch { /* private mode */ }
  renderDensityToggle();
  const list = $('#run-list');
  const cards = list ? [...list.querySelectorAll('.run-card')] : [];
  cards.forEach(stashCardScroll);
  renderRunningView();                  // repaints in place; r.el nodes are reused
  cards.forEach(applyCardScroll);
}
```

Wire the click next to the other Running listeners — insert directly after the `runListEl`
block closes (`app.js:8062`):

```javascript
// Density toggle. Delegated on the group so both segments share one listener.
$('.run-density')?.addEventListener('click', (e) => {
  const segEl = e.target.closest && e.target.closest('.rd-seg');
  if (segEl) setRunDensity(segEl.dataset.density);
});
```

And in `renderRunningView` (`app.js:11411`), paint the toggle on every render so a deep-link
boot lands with the right segment pressed:

```javascript
function renderRunningView() {
  renderDensityToggle();
  if (state.selectedRunId) return renderFocusView(state.selectedRunId);
  renderOverview();
}
```

Add to `window.__np`: `readRunDensity, setRunDensity, renderDensityToggle, runStepLabel,`.

- [ ] **Step 5: `ui/public/app.js` — `runStepLabel` + the compact row paint**

Insert after `currentNodeCycles` (`app.js:11283`):

```javascript
// Frontier step for the compact card row (design §4.3): 1-based node index,
// total node count, node label, and the node's `model · effort` caption.
//
// Reads the run's OWN advance state (maxCellIdx + nodeStatus, maintained by
// advanceRun -> locateInManifest at app.js:763-771) rather than re-locating a
// phase, so the row can never disagree with the graph paintStepper draws.
// A settled or not-yet-started cell falls back to its first node, so the row
// still names WHERE the run is instead of blanking.
function runStepLabel(r) {
  const manifest = manifestFor(r && r.stepper);
  const ids = runGraphNodeIds(manifest);
  const maxIdx = r && Number.isInteger(r.maxCellIdx) ? r.maxCellIdx : -1;
  const cellIdx = maxIdx >= 0 && maxIdx < manifest.steps.length ? maxIdx : 0;
  const nodes = (manifest.steps[cellIdx] && manifest.steps[cellIdx].nodes) || [];
  const nodeStatus = (r && r.nodeStatus) || {};
  const node = nodes.find((nd) => nodeStatus[nd.id] === 'now' || nodeStatus[nd.id] === 'pause')
    || nodes[0] || null;
  const idx = node ? ids.indexOf(node.id) : -1;
  return {
    n: idx >= 0 ? idx + 1 : 1,
    m: ids.length,
    name: node ? (node.label || node.id) : '',
    model: node ? runStepModelLine(node, r) : '',
  };
}

// `model · effort` for the compact row. A node with NO configured model resolves
// "default" to the session's ACTUAL model exactly as paintRunGraph does for the
// graph caption (app.js:1006-1014), so the two captions read identically.
function runStepModelLine(node, r) {
  const line = nodeModelLine(node);
  if (!line || node.model) return line;
  const used = modelUsedByNode((r && r.steps) || [])[node.id];
  if (!used) return line;
  return `default (${used})` + (node.effort ? ` · ${node.effort}` : '');
}
```

In `paintRunCard`, add the density stamp + compact paint right after the question-pill block
from Task 3:

```javascript
  // Density: the root attribute selects which body the stylesheet shows.
  r.el.dataset.density = runDensity;

  const compact = r.el.querySelector('.rc-compact');
  if (compact) {
    const { n, m, name, model } = runStepLabel(r);
    const chip = compact.querySelector('.rc-step-chip');
    chip.textContent = `STEP ${n}/${m}`;
    chip.className = `rc-step-chip mono st-${runStatusMeta(r).family}`;
    compact.querySelector('.rc-step-name').textContent = name;
    const modelEl = compact.querySelector('.rc-step-model');
    modelEl.textContent = model;
    modelEl.hidden = !model;
  }
```

And in `buildRunCard`, right after `node.dataset.runId = r.runId;` (`app.js:10963`), add
`node.dataset.density = runDensity;` so a clone that is never painted still matches the toggle.

- [ ] **Step 6: Verify the sub-agent painters are callerless, then delete them**

Run: `grep -rn 'paintSubsBar\|renderSubsTree\|subsPillText\|SUBS_DOT_COLOR' ui/ test/`
Expected after Step 5's `.subs-bar` block is removed from `paintRunCard`: hits only in
`ui/public/app.js` (the definitions + the `window.__np` entries + the stale
`app.js:1348` comment) and in the test files Step 9 rewrites. **No production call site.**

Then delete, in `ui/public/app.js`:
- `:11025-11039` — the `subsPillText` comment + function.
- `:11041-11088` — the `paintSubsBar` comment + function.
- `:11107-11108` — the `SUBS_DOT_COLOR` comment + const (only `renderSubsTree` read it;
  `SUBS_STAT_TEXT` on `:11109` STAYS — `buildHdAgents:10627,10654` uses it).
- `:11111-11116` — the orphaned `renderSubsTree` comment block sitting above `skillPillsHtml`.
- `:11172-11227` — the `renderSubsTree` function.
- `:2719-2722` — the `subsPillText,` / `paintSubsBar,` / `renderSubsTree,` entries in `window.__np`
  (`subGroupStatus,` on `:2721` STAYS — `buildHdAgents:10615` uses it).
- `:1348` — retarget the stale comment "helpers (paintSubsBar/subsPillText/renderSubsTree) consume"
  to "the History Agents tab (buildHdAgents) consumes".

And in `paintRunCard`, delete the whole `.subs-bar` block (`app.js:11327-11344`):
```javascript
  // subsByNode returns Map<nodeId,{subs,spawned,active}>; paintSubsBar (and the …
  const subsBar = r.el.querySelector('.subs-bar');
  if (subsBar) { … }
```

`subGroupStatus`, `subRowStatus`, `SUBS_STAT_TEXT`, `skillPillsHtml`, `agentTypePillHtml`,
`graphifyCountPillHtml`, `nodeLabelLookup`, `subsGroupsForRender`, `cycleAwareLabel`,
`stepSkillsFromSteps`, `stepGraphifyFromSteps` all keep live callers — do not touch them.

- [ ] **Step 7: `ui/public/style.css` — density + compact rules; delete the card-only `.subs-*` CSS**

Delete `style.css:1167-1189` (the "Sub-agents disclosure pill + its tree panel" comment through
`.subs-step-head b`), `:1199-1207` (`.subs-step-head .subs-n` through `.subs-tree li .ag-name`)
and `:1216` (`.subs-tree li{flex-wrap:wrap;}`).

Trim the shared lists in place — each keeps its `.hd-ag-*` half:
- `:1195-1198` → `.hd-ag-head .subs-stat{…}` / `.hd-ag-head .subs-stat.run{…}` / `.done` / `.stop`
- `:1208-1211` → `.hd-ag-row .st{…}` / `.hd-ag-row .st.done{…}` / `.run` / `.stop`
- `:1222` → `.hd-ag-head .subs-skills,.hd-ag-row .subs-skills{flex:0 0 100%;margin-top:6px;}`
- `:1238` → `.hd-ag-row .agent-type-pill{…}`

Rewrite the comment at `:1190-1194` (it explains an ancestor-scope tie that no longer exists):
```css
/* Selector lists that used to pair the retired run-card tree with the History
   detail's Agents tab. `.subs-stat` is only ever styled here, so a bare appended
   `.subs-stat.stop{…}` would tie on specificity and still lose to this rule's
   ancestor scope — extend in place, never duplicate. Same for `.st`,
   `.agent-type-pill` and the full-row `.subs-skills` rule below. */
```
and at `:1217-1221` drop the sentence about `.subs-tree li`, keeping the `.hd-ag-meta` reasoning.

`:1215`'s `.subs-skills{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}` STAYS.

Append at the end of `ui/public/style.css`:

```css

/* ---------- Running list: density toggle + compact card body ---------- */
/* .topbar is `justify-content:space-between` with three children now; pushing the
   pill right keeps pill + toggle together as the right-hand group. */
#running-status-pill{margin-left:auto;}
.run-density{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:999px;
  background:var(--field);flex:0 0 auto;align-self:center;}
.run-density .rd-seg{display:inline-flex;align-items:center;justify-content:center;
  width:32px;height:28px;padding:0;border:0;border-radius:999px;background:transparent;
  color:var(--ink-2);cursor:pointer;transition:background .15s,color .15s;}
.run-density .rd-seg:hover{color:var(--ink);}
.run-density .rd-seg[aria-pressed="true"]{background:var(--ink);color:#fff;}
.run-density .rd-seg:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
/* One body per density. The other is display:none — which zeroes its scrollers, so
   setRunDensity stashes .log scrollTop + .run-flow-wrap scrollLeft across the flip. */
.run-card[data-density="compact"] .rc-detailed{display:none;}
.run-card[data-density="detailed"] .rc-compact{display:none;}
.rc-compact{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:14px;}
.rc-step-chip{padding:4px 10px;border-radius:999px;font:700 11px var(--mono);
  letter-spacing:.04em;background:var(--field);color:var(--ink-2);white-space:nowrap;}
.rc-step-chip.st-blue{background:var(--blue-bg);color:var(--blue-ink);}
.rc-step-chip.st-amber{background:var(--amber-bg);color:var(--amber-ink);}
.rc-step-chip.st-green{background:var(--green-bg);color:var(--green-ink);}
.rc-step-chip.st-red{background:var(--red-bg);color:var(--red-ink);}
.rc-step-name{min-width:0;font:600 14.5px var(--sans);color:var(--ink);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rc-step-model{font:400 12px var(--mono);color:var(--ink-3);margin-left:auto;white-space:nowrap;}
.rc-step-model[hidden]{display:none;}
/* .run-top's old 18px bottom margin used to open this gap. */
.rc-detailed{margin-top:18px;}
```

- [ ] **Step 8: Run the new suite to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-density.test.mjs`
Expected: PASS — `# pass 9`, `# fail 0`.

- [ ] **Step 9: Update the existing suites this breaks**

`test/ui-subagent-pill.test.mjs` — **delete the file**. All four tests (`:38 subsPillText`,
`:58`, `:87`, `:102 paintSubsBar`) are tests of the three deleted painters and have no surviving
subject.

`test/ui-subagent-tree.test.mjs` — delete the three `renderSubsTree` tests (`:48-91`, `:92-109`,
`:110-118`). Keep `:38-46` (`subGroupStatus`) — `buildHdAgents:10615` still calls it.

`test/ui-subagent-cycle-split.test.mjs` — delete the last test (`:67-78`,
`renderSubsTree renders one step per cycle group…`). Keep `:35`, `:47`, `:60`
(`subsByNodeCycleArrays` / `cycleAwareLabel`).

`test/ui-graphify-count-pill.test.mjs` — delete `:49-64`, `:66-84` and `:85-105` (the three
`renderSubsTree` badge tests). Keep `:39` (`graphifyCountPillHtml` unit), `:106`, `:114`, `:122`.
The rendered badge stays covered by `test/ui-history-detail.test.mjs:1330,1336,1382`.

`test/ui-subagent-type-pill.test.mjs` — delete `:39-55` and `:56-65` (both `renderSubsTree`).
Keep `:66` (`agentTypePillHtml`, which already asserts the escaping) and `:75` (`onSubagent`).
Rendered coverage stays at `test/ui-history-detail.test.mjs:1329,1337`.

`test/ui-skill-pills.test.mjs` — five tests use the deleted renderers purely as a host for
`skillPillsHtml`. Retarget them to the helper, which returns `<div class="subs-skills">…</div>`
so every `.subs-skills` / `.skill-pill` assertion survives verbatim:
- `:40-61` — replace `renderSubsTree(panel, byNode, (k) => 'Plan', stepSkills);` with
  `panel.innerHTML = skillPillsHtml(stepSkills['n1|1']);`, replace
  `panel.querySelector('.subs-step .subs-skills')` with `panel.querySelector('.subs-skills')`,
  and delete `:58-60` (the `.subs-tree li` row assertions — the per-row call site is
  `buildHdAgents:10657`, covered by `ui-history-detail.test.mjs:1342-1343`).
- `:65-87` — same two swaps; assertions `:78-86` unchanged.
- `:89-107` — same two swaps for the head; replace `:104-106` (the `.subs-tree li .subs-skills`
  row) with a second direct call:
  `const rowHtml = skillPillsHtml(['skill:x', 'overflow:2']); panel.innerHTML = rowHtml;`
  `assert.equal(panel.querySelector('.skill-pill.is-overflow').textContent, '+2 more');`
- `:109-115` — replace with
  `panel.innerHTML = skillPillsHtml(['overflow:0', 'overflow:nope']); assert.equal(panel.querySelector('.subs-skills'), null, 'no pills -> no container');`
- `:117-148` — the §7.5 reload test drives `paintSubsBar`. Rewrite it to keep the reload chain
  it exists for (`subsGroupsForRender` + `stepSkillsFromSteps` -> pills) without the retired bar:
```javascript
test('§7.5 reload: a persisted 64+overflow:6 step array paints 65 pills', async () => {
  const { window } = await bootLive();
  const { subsGroupsForRender, stepSkillsFromSteps, skillPillsHtml } = window.__np;
  const skills = [...Array.from({ length: 64 }, (_, i) => `mcp:srv:tool_${i}`), 'overflow:6'];
  const state = {
    steps: [{ key: '2:plan', nodeId: 'plan', stepIndex: 2, cycle: 0, status: 'done', skills }],
    subAgents: [{ id: 'a1', label: 'AR', nodeId: 'plan', cycle: 0, status: 'finished',
      skills: ['skill:brainstorming', 'mcp:playwright:browser_navigate'] }],
    stepper: { agents: [['plan']] },
  };
  const groups = subsGroupsForRender(state.subAgents, state.steps, state.stepper);
  const key = Object.keys(groups)[0];
  const host = window.document.createElement('div');
  host.innerHTML = skillPillsHtml(stepSkillsFromSteps(state.steps)[key]);
  assert.equal(host.querySelectorAll('.skill-pill').length, 65, '64 label pills + the sentinel');
  assert.equal(host.querySelector('.skill-pill.is-overflow').textContent, '+6 more');
  assert.equal(host.querySelectorAll('.skill-pill.is-mcp-tool').length, 64, 'all three-part labels survived');
  host.innerHTML = skillPillsHtml(groups[key][0].skills);
  assert.deepEqual([...host.querySelectorAll('.skill-pill')].map((e) => e.textContent),
    ['brainstorming', 'playwright · browser_navigate'], 'the sub-agent row reloads its pills too');
});
```
  Also delete `#run-card-tpl`/`.subs-bar` from the comment at `:117-122`.

`test/ui-subagent-pulse-scope.test.mjs` — the first test (`:87-114`) opens the tree panel.
Delete `:103-113` (from `// open the tree and assert NOTHING under it pulses` through the
`.fan .sq.on` count) and rename the test to
`'PULSE SCOPING: only the live graph square is in the pulsing scope'`; `:97-102` (the graph
square half) stays verbatim. The second test (`:116-142`) is History-only — untouched.

`test/ui-run-flow-css.test.mjs` — three tests read deleted rules:
- `:170-189` `'Sub-agents pill: rounded button, sb-count blue default + grey variant, chev rotate'`
  → delete the whole test.
- `:191-221` `'tree legend + step + connector-row CSS, and NO animation on tree squares'`
  → delete the whole test. Its sqPulse-scoping assertions (`:216-217`) duplicate the dedicated
  test at `:155-164`, which stays.
- `:223-228` `'skill pills: …'` → keep, with two swaps:
  `assert.match(css, /\.subs-tree li\{[^}]*flex-wrap:\s*wrap/, …)` → delete the line;
  `ruleBody('.subs-tree li .subs-skills')` → `ruleBody('.hd-ag-row .subs-skills')`.

`test/ui-agents-dropdown.test.mjs` — delete the six tests that drive the retired bar/tree:
`:50-62` (`dropdown header reads "Agents"…`), `:121-147`, `:148-159` (`renderSubsTree` groups),
`:160-174`, `:175-181` (`paintSubsBar`), `:183-213` (`live state frame: … expanded Agents dropdown`).
Keep `:64`, `:84`, `:96`, `:108` — the four `subsGroupsForRender`/`stepStatusByKey`/`cycleAwareLabel`
projection tests, which are exactly what the spec says to preserve.

- [ ] **Step 10: Run the full suite**

Run: `npm test`
Expected: PASS — no failures. `ui-history-detail`, `ui-history-graph-log-link` and the other
History suites must be untouched: if any of them fails, a `.hd-ag-*` half was trimmed away with
its `.subs-*` twin in Step 7 — restore that half.

- [ ] **Step 11: Commit**

Run:
```
git rm test/ui-subagent-pill.test.mjs
git add ui/public/index.html ui/public/app.js ui/public/style.css \
        test/ui-running-density.test.mjs test/ui-agents-dropdown.test.mjs \
        test/ui-subagent-tree.test.mjs test/ui-subagent-cycle-split.test.mjs \
        test/ui-graphify-count-pill.test.mjs test/ui-subagent-type-pill.test.mjs \
        test/ui-skill-pills.test.mjs test/ui-subagent-pulse-scope.test.mjs \
        test/ui-run-flow-css.test.mjs
git commit -m "feat(running): add the density toggle and compact/detailed card bodies

Compact shows STEP n/m, the step name and the model line (runStepLabel); detailed
keeps the pipeline graph and live log. The choice persists in localStorage under
worca-cc.running.density, defaulting to detailed. The card's Agents disclosure is
retired with paintSubsBar/renderSubsTree/subsPillText and their CSS; the pure
projections History and the coming Agents tab need are kept."
```

---

### Task 5: Two-screen shell + `#running/<runId>` routing; delete `renderFocusView`

**Files:**
- Modify: `ui/public/index.html:346-383` (wrap the Running view in `#run-shell`, add `#run-detail`, add `#run-detail-tpl`)
- Modify: `ui/public/style.css:1984` (append the Running shell + `.rd-*` header block at EOF, the established place for new blocks — see the "History list card v2" note at `style.css:1942-1946`)
- Modify: `ui/public/app.js:135-140` (`el` gains `runShell` / `runDetail`)
- Modify: `ui/public/app.js:1525-1528` (`onState` keeps the whole `msg.branch`)
- Modify: `ui/public/app.js:10735-10744` (Escape handler: add the Running twin after the History one)
- Modify: `ui/public/app.js:11411-11414` + `11497-11503` (`renderRunningView` rewritten; `renderFocusView` deleted; the `.rd-*` routing block lands here)
- Modify: `ui/public/app.js:11685-11692`, `11712`, `11713-11726` (`showView`: leave-guard, `body.view-running`, `routeRunDetail` call)
- Test: `test/ui-running-routing.test.mjs` (new)
- Test: `test/ui-pipeline-tabs.test.mjs:59-67` (the "focus route shows only the selected card" test is rewritten)
- Test: `test/ui-nav-buttons.test.mjs:109-115` (stale "bounce" comment corrected + a detail-open assertion)

**Interfaces:**
- Consumes (from T3): `runStepLabel(r) -> { n, m, name, model }` — the `step n/m · <name>` tail of `.rd-meta`.
- Consumes (from T3): `.run-card > .rc-head` carrying `role="button"` / `tabindex="0"` (spec §4.4) — the focus-restore target on close.
- Consumes (pre-existing): `statusPill(r) -> { family, text }` (`app.js:10924`), `projectName(dir)` (`10905`), `startedLabel(startedAt)` (`10913`), `liveTotalMs(steps, now)` (`1249`), `fmtDuration(ms)` (`1230`), `fmtUsd(n)` (`1204`), `estTitle(n)` (`1220`), `copyBranchToClipboard(btn, branch)` (`3658`), `pauseRun(runId, btn)` (`7831`), `resumeRunFromCard(runId, btn, opts)` (`7908`), `stopRun(runId, btn)` (`7806`), `isPaused(r)` (`10845`), `isTerminalStatus(status)` (`4288`), `cssEscape(s)` (`8284`), `rafSafe(fn)` (`9279`), `helloSeeded` (`4632`), `budgetState` (`342`), `fmtResetAtLocal` (used by `paintRunCard:11386`).
- Produces:
  - `runDetailState` — module-level `{ runId: '', screen: null }`; `screen` is the cloned `#run-detail-tpl` root while open, `null` when closed.
  - `routeRunDetail(param: string, opts?: {instant?: boolean}) -> void`
  - `openRunDetail(runId: string, opts?: {instant?: boolean}) -> void`
  - `closeRunDetail(opts?: {instant?: boolean}) -> void`
  - `paintRunDetail(r: Run) -> void` — full repaint of the open detail screen (header only at this task; T6 appends banners/graph/questions, T7 the tabs).
  - `paintRdHeader(screen: Element, r: Run) -> void`
  - `r.branch: {source?, feature?, worktreeDir?, commitFailed?} | undefined` on the run model (T6 reads `commitFailed`, T7 reads `worktreeDir`).
  - DOM: `#run-shell.run-shell`, `.run-screen.run-screen-list`, `.run-screen.run-screen-detail#run-detail`, `#run-detail-tpl`, `.rd-header .rd-row1 .rd-back .rd-title .rd-status .rd-meta .rd-row3 .rd-base .rd-branch-copy .rd-branch-name .rd-copied .rd-spacer .rd-pause .rd-stop .rd-error .rd-body`, `body.view-running`.

> NOTE: `parseHash()` (`app.js:660`) splits on the FIRST `/`, which is safe here — the server mints every runId with `randomUUID()` (`ui/server.mjs:797` and `:1228`), so a runId is `[0-9a-f-]{36}` and contains no slash. No `parseHistDetailParam` twin is needed, confirming spec §5.1.

> NOTE: the contract's `.rd-*` list has `.rd-pause` and `.rd-stop` but **no** `.rd-resume`. `.rd-pause` is therefore the single Pause/Resume pill (spec §5.2 row 3 words it as one control): it carries `data-action="pause"|"resume"` and a `.rd-btn-label` span, mirroring History's `.hd-btn-label` idiom (`app.js:9695`).

> NOTE: `.rd-status` uses `statusPill(r)` (`app.js:10924`), not T3's new `runStatusMeta(r)`. `statusPill` already returns `{family, text}` in the five families `.pill-run` is styled for (`style.css:568-573`) and spec §4.3 pins it as the source of the status word; `runStatusMeta`'s extra `glyph` field only matters for the card's avatar SVG.

> NOTE: `paintRdHeader` hides `.rd-pause`/`.rd-stop` on a terminal run. Strictly D8/T9 territory, but `paintRdHeader` is authored here and a `done` run must not offer Stop. T9 still owns `.rd-history-link`, the static (non-pulsing) status dot, and the terminal-state suite.

> NOTE: `.rd-stop` calls `stopRun(runId, btn)` directly at this task. T10 replaces that one line with `openStopModal(runId)` per D5; the test written here asserts `POST /api/stop` is reached, which T10's modal path still satisfies through `stopRun`.

> NOTE: `finishRun`'s drop-to-overview (`app.js:4361-4364`) contradicts D8 and is deliberately NOT touched here — removing it is T9's job. Consequence for this task: a run that finishes while its detail is open sets `location.hash = 'running'`, the hashchange closes the detail, and `test/ui-pipeline-tabs.test.mjs:266` ("finishing the focused run falls back to Overview") stays green unchanged.

> NOTE: `acknowledgeRun`'s `if (currentView() === 'running' && !state.selectedRunId) renderRunningView()` guard (`app.js:4647`) is left as-is. With the detail open `state.selectedRunId` is set, so the list is not repainted underneath the detail — the lingerer drops on Back, which is exactly what spec §4.4 asks for ("drops from the list on Back").

- [ ] **Step 1: Write the failing routing test**

Create `test/ui-running-routing.test.mjs`:

```javascript
// test/ui-running-routing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Behavior tests for the two-screen Running shell: `#running/<runId>` routes
// through the existing parseHash/showView machinery into the detail screen, and
// `#running` (or Back / Escape / leaving the view) returns to the list.
//
// boot() / settle() / go() are copied verbatim from test/ui-history-routing.test.mjs
// (:26-96, :86-90, :92-95), with the fetch handler collapsed to this suite's two
// arms; the open() / recv() WebSocket drivers are copied verbatim from
// test/ui-pipeline-tabs.test.mjs:31-33. No shared harness — the duplication is
// the house convention.

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const appSrc = readFileSync(appPath, 'utf8');
const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');

const PROJECT = '/tmp/proj';
const ID = 'auth-fix';
const OTHER = 'seo-pSEO';

// Same anchored helper idiom as test/ui-history-sticky-header.test.mjs:15-19.
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

async function boot({ url = 'http://localhost:4317/' } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};

  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {}
    close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };

  const calls = [];
  window.fetch = (u, opts) => {
    calls.push({ url: String(u), opts: opts || {} });
    if (String(u).includes('/api/projects')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }),
      });
    }
    return Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 }),
    });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch {
      /* read-only global already present — leave it */
    }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();   // T4's density key must not leak between cases

  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  const open = () => lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  open();
  return { window, calls, recv };
}

async function settle(window, n = 3) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

const live = (runId, extra = {}) => ({
  runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});

async function bootWithRuns() {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live(ID), live(OTHER)] });
  await settle(ctx.window);
  return ctx;
}

// ---------- structure ----------

test('the Running view is a two-screen shell around the existing list', async () => {
  const { window } = await boot();
  const doc = window.document;
  const shell = doc.querySelector('#run-shell');
  assert.ok(shell, '#run-shell must exist');
  assert.ok(shell.classList.contains('run-shell'));
  assert.equal(shell.closest('[data-view]').dataset.view, 'running');

  const list = shell.querySelector('.run-screen.run-screen-list');
  assert.ok(list, '.run-screen-list wraps the list screen');
  assert.ok(list.querySelector('#run-list'), 'the run list moved inside the list screen');
  assert.ok(list.querySelector('.topbar h1'), 'so did the topbar');

  const host = doc.querySelector('#run-detail');
  assert.ok(host, '#run-detail must exist');
  assert.ok(host.classList.contains('run-screen') && host.classList.contains('run-screen-detail'));
  assert.equal(host.getAttribute('aria-hidden'), 'true', 'closed detail is hidden from AT');
  assert.equal(host.hasAttribute('inert'), true, 'and untabbable — aria-hidden alone does not do that');
  assert.ok(doc.querySelector('#run-detail-tpl'), 'the detail screen template ships in the markup');
});

test('renderFocusView is gone from app.js', async () => {
  assert.equal(/function renderFocusView\b/.test(appSrc), false,
    'the single-card focus view is replaced by the detail screen');
});

// ---------- open / close ----------

test('#running/<id> opens the detail screen and paints its header', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const doc = window.document;
  const shell = doc.querySelector('#run-shell');
  assert.ok(shell.classList.contains('detail-open'), 'the shell slides to the detail screen');

  const host = doc.querySelector('#run-detail');
  assert.equal(host.getAttribute('aria-hidden'), 'false');
  assert.equal(host.hasAttribute('inert'), false, 'the open screen is interactive');
  const listScreen = shell.querySelector('.run-screen-list');
  assert.equal(listScreen.getAttribute('aria-hidden'), 'true');
  assert.equal(listScreen.hasAttribute('inert'), true, 'the off-screen list is untabbable');

  assert.equal(doc.querySelector('#run-detail .rd-title').textContent, ID);
  const status = doc.querySelector('#run-detail .rd-status');
  assert.ok(status.classList.contains('peach'), 'a running pipeline takes statusPill\'s peach family');
  assert.equal(status.querySelector('.rd-status-word').textContent, 'Running');
  assert.match(doc.querySelector('#run-detail .rd-meta').textContent, /proj/);
  assert.match(doc.querySelector('#run-detail .rd-meta').textContent, /10:00:00/);
  assert.equal(doc.querySelector('#run-detail .rd-pause').hidden, false, 'a live run offers Pause');
  assert.equal(doc.querySelector('#run-detail .rd-stop').hidden, false);
});

test('the list keeps every card while the detail is open (no focus view)', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const ids = [...window.document.querySelectorAll('#run-list .run-card')]
    .map((c) => c.dataset.runId).sort();
  assert.deepEqual(ids, [ID, OTHER].sort(),
    'the list screen still holds every run — the detail is a second screen, not a filter');
});

test('the Back button returns to #running and closes the screen', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const shell = window.document.querySelector('#run-shell');

  window.document.querySelector('#run-detail .rd-back')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'running');
  assert.equal(shell.classList.contains('detail-open'), false);
});

test('a state frame paints the branch row through the stored r.branch', async () => {
  const { window, recv } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  recv({
    type: 'state', runId: ID, status: 'running', steps: [], stepper: null,
    branch: { source: 'main', feature: 'worca-cc/auth-fix', worktreeDir: '/tmp/wt' },
  });
  await settle(window);
  const doc = window.document;
  assert.equal(doc.querySelector('#run-detail .rd-base').hidden, false);
  assert.equal(doc.querySelector('#run-detail .rd-base').textContent, 'main →');
  assert.equal(doc.querySelector('#run-detail .rd-branch-copy').hidden, false);
  assert.equal(doc.querySelector('#run-detail .rd-branch-name').textContent, 'worca-cc/auth-fix');
});

// ---------- Escape ----------

test('Escape with the detail open and no modal navigates back', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const shell = window.document.querySelector('#run-shell');

  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'running');
  assert.equal(shell.classList.contains('detail-open'), false);
});

test('Escape is swallowed while a modal owns it', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const shell = window.document.querySelector('#run-shell');
  window.document.querySelector('#confirm-modal').classList.remove('hidden');

  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), `running/${ID}`,
    'the modal owns Escape, not the router');
  assert.ok(shell.classList.contains('detail-open'));
});

test('Escape on another view never touches the Running track', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  // Force the shell to stay open while the hash points elsewhere: the guard is
  // currentView(), not the class, so a stale open shell must not swallow Escape.
  window.location.hash = 'new';
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'new');
});

// ---------- focus ----------

test('opening the detail moves focus to Back', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  assert.equal(window.document.activeElement,
    window.document.querySelector('#run-detail .rd-back'),
    'focus lands on the detail screen, not on whatever the list left behind');
});

test('closing the detail restores focus to the originating card', async () => {
  const { window } = await bootWithRuns();
  const head = window.document.querySelector(`#run-list .run-card[data-run-id="${ID}"] .rc-head`);
  assert.ok(head, 'T3 gives every card an .rc-head');
  assert.equal(head.getAttribute('tabindex'), '0', 'spec §4.4: the card header is focusable');

  go(window, `running/${ID}`);
  await settle(window);
  window.document.querySelector('#run-detail .rd-back')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window);

  const active = window.document.activeElement;
  assert.ok(active && active.classList.contains('rc-head'), 'focus returned to a card head, not <body>');
  assert.equal(active.closest('.run-card').dataset.runId, ID,
    'and to the card the detail was opened from (re-queried by data-run-id)');
});

// ---------- transitionend cleanup ----------

test('the closing detail stays mounted + inert until the guarded transitionend', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const host = window.document.querySelector('#run-detail');

  window.document.querySelector('#run-detail .rd-back')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window);
  assert.equal(host.getAttribute('aria-hidden'), 'true');
  assert.equal(host.hasAttribute('inert'), true, 'untabbable while it slides away');
  assert.ok(host.children.length > 0, 'with its content still mounted — that is the point');

  const fire = (target, propertyName) => {
    const e = new window.Event('transitionend', { bubbles: true });
    Object.defineProperty(e, 'propertyName', { value: propertyName });
    target.dispatchEvent(e);
  };
  // transitionend BUBBLES: a descendant's own transition must not clear the DOM.
  fire(host.querySelector('.rd-header'), 'transform');
  assert.ok(host.children.length > 0, 'a descendant transition is ignored');
  fire(host, 'opacity');
  assert.ok(host.children.length > 0, 'a non-transform property is ignored');
  fire(host, 'transform');
  assert.equal(host.children.length, 0, 'the host\'s own transform end clears the screen');
});

// ---------- detail -> detail ----------

test('a detail->detail hop rebuilds in place and never runs the close path', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const shell = window.document.querySelector('#run-shell');

  const removed = [];
  const origRemove = shell.classList.remove.bind(shell.classList);
  shell.classList.remove = (...a) => { removed.push(...a); return origRemove(...a); };

  go(window, `running/${OTHER}`);
  await settle(window);
  assert.equal(removed.includes('detail-open'), false, 'the track never slid back to the list');
  assert.ok(shell.classList.contains('detail-open'));
  assert.equal(window.document.querySelector('#run-detail .rd-title').textContent, OTHER,
    'the screen was rebuilt for the new run');
});

// ---------- animation gating ----------

test('entering from another view is instant; an in-view hop animates', async () => {
  const { window } = await bootWithRuns();
  const shell = window.document.querySelector('#run-shell');

  go(window, 'new');
  await settle(window);
  go(window, `running/${ID}`);
  assert.ok(shell.classList.contains('no-anim'), 'a cross-view entry must not slide');
  await settle(window);
  assert.equal(shell.classList.contains('no-anim'), false, 'the flag is dropped after a frame');

  go(window, 'running');
  await settle(window);
  go(window, `running/${ID}`);
  assert.equal(shell.classList.contains('no-anim'), false, 'a list->detail hop animates');
});

// ---------- deep link / unknown id ----------

test('deep-link boot opens the detail before hello, then upgrades from it', async () => {
  const { window, recv } = await boot({ url: `http://localhost:4317/#running/${ID}` });
  await settle(window);
  const doc = window.document;
  assert.ok(doc.querySelector('#run-shell').classList.contains('detail-open'),
    'the detail is open even though the runs Map is still empty');
  assert.equal(doc.querySelector('#run-detail .rd-title').textContent, ID,
    'the raw runId stands in until hello lands');

  recv({ type: 'hello', runs: [live(ID, { title: 'Fix the auth flow' })] });
  await settle(window);
  assert.equal(doc.querySelector('#run-detail .rd-title').textContent, 'Fix the auth flow');
  assert.equal(window.location.hash.replace(/^#/, ''), `running/${ID}`, 'no bounce');
});

test('a deep link to a run hello does not know bounces to #running', async () => {
  const { window, recv } = await boot({ url: 'http://localhost:4317/#running/ghost' });
  await settle(window);
  recv({ type: 'hello', runs: [live(ID)] });
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'running',
    'once hello has been processed an unknown id is genuinely bad');
});

test('an unknown id typed after hello bounces immediately', async () => {
  const { window } = await bootWithRuns();
  go(window, 'running/ghost');
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'running');
  assert.equal(window.document.querySelector('#run-shell').classList.contains('detail-open'), false);
});

test('a sidebar child row opens the detail', async () => {
  const { window } = await bootWithRuns();
  go(window, 'running');
  await settle(window);
  const row = window.document.querySelector(`#nav-running-children .nav-child[data-child-run-id="${ID}"]`);
  assert.ok(row, 'the sidebar row is painted');
  row.dispatchEvent(new window.Event('click', { bubbles: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), `running/${ID}`);
  assert.ok(window.document.querySelector('#run-shell').classList.contains('detail-open'));
});

// ---------- leave-guard ----------

test('leaving the running view resets the track synchronously', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const shell = window.document.querySelector('#run-shell');

  go(window, 'new');
  await settle(window);
  assert.equal(shell.classList.contains('detail-open'), false);
  assert.equal(window.document.querySelector('#run-detail').children.length, 0,
    'the instant close path empties the screen synchronously');
});

test('leaving the running view does not park focus on a hidden card', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  go(window, 'new');
  await settle(window);
  const active = window.document.activeElement;
  assert.equal(active ? active.closest('.run-card') : null, null,
    'focus is not restored into the list the view switch just hid');
});

// ---------- CSS ----------

test('showView stamps body.view-running', async () => {
  const { window } = await bootWithRuns();
  go(window, 'running');
  await settle(window);
  assert.ok(window.document.body.classList.contains('view-running'));
  go(window, 'new');
  await settle(window);
  assert.equal(window.document.body.classList.contains('view-running'), false);
});

test('the Running slide shell mirrors History\'s track', () => {
  const view = ruleBody('.view[data-view="running"]');
  assert.ok(view, '.view[data-view="running"] rule must exist');
  assert.match(view, /padding:\s*0/, 'the screens own their gutters');
  assert.match(view, /position:\s*relative/, 'the absolute screens need a containing block');

  const screen = ruleBody('.run-screen');
  assert.ok(screen, '.run-screen rule must exist');
  assert.match(screen, /position:\s*absolute/);
  assert.match(screen, /overflow-y:\s*auto/, 'each screen owns its scrollport');
  assert.match(screen, /padding:\s*0 32px/, 'zero TOP padding so T7\'s sticky tabs pin flush');
  assert.match(screen, /transition:\s*transform/);

  assert.match(ruleBody('.run-screen-detail'), /transform:\s*translateX\(100%\)/);
  assert.match(css, /\.run-shell\.detail-open\s+\.run-screen-list\s*\{[^}]*translateX\(-100%\)/);
  assert.match(css, /\.run-shell\.detail-open\s+\.run-screen-detail\s*\{[^}]*translateX\(0\)/);
  assert.match(css, /\.run-shell\.no-anim\s+\.run-screen\s*\{[^}]*transition:\s*none/);
  assert.match(css, /\.run-screen-list\s+\.topbar\s*\{[^}]*padding-top:\s*26px/,
    'the inset the screen dropped is re-applied on the topbar');

  const main = ruleBody('body.view-running .main');
  assert.ok(main, 'body.view-running .main rule must exist');
  assert.match(main, /overflow:\s*hidden/);
  assert.match(main, /padding:\s*0/);
  assert.ok(ruleBody('body.view-running .topnav'), 'the compact top-nav re-applies the gutter');
});

test('wr-pulse is defined exactly once and is neutralized under reduced motion', () => {
  assert.equal((css.match(/@keyframes wr-pulse/g) || []).length, 1,
    'the shared keyframe is declared once (contract §Keyframes)');
  assert.match(css, /\.rd-status\s+\.pdot\s*\{[^}]*animation:\s*wr-pulse/);
  assert.match(css, /\.rd-status\.parked\s+\.pdot\s*\{[^}]*animation:\s*none/);
  const at = css.indexOf('.rd-status .pdot');
  const kill = css.indexOf('.rd-status .pdot,.rd-status.parked .pdot{animation:none;}');
  assert.ok(kill > at, 'the reduced-motion block sits AFTER the rule it neutralizes');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-routing.test.mjs`
Expected: FAIL — first failure is `the Running view is a two-screen shell around the existing list` with `AssertionError [ERR_ASSERTION]: #run-shell must exist`.

- [ ] **Step 3: Wrap the Running view in the shell and add the detail template**

In `ui/public/index.html`, replace lines 346-383 with:

```html
        <section class="view hidden" data-view="running">
          <div class="run-shell" id="run-shell">
            <div class="run-screen run-screen-list">
          <div class="topbar">
            <div>
              <h1>Running</h1>
              <div class="sub" id="running-sub">0 pipelines executing · 0 need your input</div>
            </div>
            <span class="pill-run amber hidden" id="running-status-pill" style="box-shadow:var(--shadow-soft)"><span class="pdot"></span> 0 needs input</span>
          </div>

          <div class="run-list" id="run-list"></div>

          <!-- clone target for one run card -->
          <template id="run-card-tpl">
            <!-- UNCHANGED: keep every line of the existing #run-card-tpl body -->
          </template>
            </div>
            <div class="run-screen run-screen-detail" id="run-detail" aria-hidden="true" inert></div>
          </div>

          <!-- clone target for the Running detail screen (#running/<runId>) -->
          <template id="run-detail-tpl">
            <div class="rd">
              <header class="rd-header">
                <div class="rd-row1">
                  <button type="button" class="rd-back btn-ghost" aria-label="Back to running list">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                    Back
                  </button>
                  <h1 class="rd-title"></h1>
                  <span class="rd-status pill-run"><span class="pdot"></span><span class="rd-status-word"></span></span>
                </div>
                <div class="rd-meta mono"></div>
                <div class="rd-row3">
                  <span class="rd-base mono" hidden></span>
                  <button type="button" class="rd-branch-copy mono" hidden title="Copy branch name" aria-label="Copy branch name">
                    <span class="rd-branch-name"></span>
                    <svg class="ico-copy" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2.5"></rect><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" stroke-linecap="round"></path></svg>
                    <svg class="ico-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 12.5l5.5 5.5L20 6.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                  </button>
                  <!-- NO `hidden`: the caption is driven purely by the CSS sibling rule
                       off copyBranchToClipboard's own 1200ms `.copied` window, exactly
                       as .hd-copied does (index.html:494-498). -->
                  <span class="rd-copied">Copied</span>
                  <span class="rd-spacer"></span>
                  <!-- One control for Pause/Resume (spec §5.2 row 3). The label lives in
                       its own span so a busy state swaps only the word and the inline SVG
                       survives — the .hd-btn-label idiom (app.js:9695). -->
                  <button type="button" class="rd-pause" data-action="pause" hidden>
                    <svg class="ico-pause" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5"></rect><rect x="14" y="5" width="4" height="14" rx="1.5"></rect></svg>
                    <svg class="ico-play" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7z"></path></svg>
                    <span class="rd-btn-label">Pause</span>
                  </button>
                  <button type="button" class="rd-stop" hidden>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>
                    <span class="rd-btn-label">Stop</span>
                  </button>
                </div>
                <!-- Inline error slot for failed actions, on the HEADER so it is never
                     pushed below the fold by the graph or a tab body (mirrors .hd-error). -->
                <div class="rd-error" hidden></div>
              </header>
              <div class="rd-body"></div>
            </div>
          </template>
        </section>
        <!-- /view running -->
```

The `#run-card-tpl` body is re-parented verbatim — do not retype it. Whatever T2/T4 inserted between the topbar and `#run-list` (`.run-density`, `.run-ask-banner`) is inside the wrapped region automatically, so no adjustment is needed.

- [ ] **Step 4: Add the shell + header CSS**

Append at the end of `ui/public/style.css`:

```css
/* ---------- Running two-screen shell (twin of the History track, 1591-1603) ---------- */
.view[data-view="running"]{flex:1 1 auto;min-height:0;padding:0;position:relative;}
.run-shell{position:relative;height:100%;overflow:hidden;}
/* NO top padding on the scroller itself — T7's sticky .rd-tabs must pin flush to
   the scrollport top, exactly as .hist-screen does for .hd-tabs. */
.run-screen{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;padding:0 32px 40px;
  transition:transform .46s cubic-bezier(.65,.02,.28,1);}
.run-screen-list .topbar{padding-top:26px;}
.run-screen-list{transform:translateX(0);}
.run-screen-detail{transform:translateX(100%);padding:0;background:var(--bg);}
.run-shell.detail-open .run-screen-list{transform:translateX(-100%);}
.run-shell.detail-open .run-screen-detail{transform:translateX(0);}
.run-shell.no-anim .run-screen{transition:none;}
/* Same reasoning as body.view-history .main (222) and .topnav (227): .main stops
   scrolling and becomes the bounded column so each screen owns its scrollport,
   and the compact top-nav (<1080px, a SIBLING of the views) re-applies the gutter
   .main just dropped. */
body.view-running .main{display:flex;flex-direction:column;overflow:hidden;padding:0;}
body.view-running .topnav{margin:12px 32px 0;flex:0 0 auto;}
/* style.css has no base .mono rule (only ancestor-scoped ones) — scope one to the
   new subtree, exactly as :1606 does for .hd/.hist-card. */
.rd .mono{font-family:var(--mono);}

/* ---------- Running detail: header card ---------- */
/* Card, not a full-bleed band: .run-screen-detail keeps padding:0 so the sticky
   tabs can pin, and this margin box supplies the inset (mirrors .hd-header:1615). */
.rd-header{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-card);
  box-shadow:var(--shadow);margin:20px 32px 0;padding:20px 24px 18px;}
.rd-body{padding:0 32px 40px;}
.rd-row1{display:flex;align-items:center;gap:14px;}
.rd-title{margin:0;min-width:0;flex:1;font:700 22px/1.25 var(--sans);letter-spacing:-.02em;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rd-status{flex:0 0 auto;}
.rd-status[hidden]{display:none;}
/* The design's slower, softer pulse; .pill-run .pdot (567) supplies the 7px dot
   and the family fill, this only re-times it. `.parked` = nothing is running. */
.rd-status .pdot{animation:wr-pulse 1.6s ease-in-out infinite;}
.rd-status.parked .pdot{animation:none;}
.rd-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0;margin-top:12px;
  font:400 12.5px var(--mono);color:var(--ink-3);}
.rd-meta .strong{font-weight:700;color:var(--ink);}
.rd-dot{font-weight:700;color:var(--ink);}
.rd-row3{display:flex;align-items:center;gap:8px;margin-top:6px;min-width:0;}
.rd-base{color:var(--ink-3);font-size:12px;white-space:nowrap;}
.rd-base[hidden]{display:none;}
.rd-branch-copy{display:flex;align-items:center;gap:9px;min-width:16ch;padding:8px 12px;
  border:1px solid var(--line);border-radius:9px;background:var(--field);
  font:700 12px var(--mono);color:var(--ink);cursor:pointer;}
.rd-branch-copy[hidden]{display:none;}
.rd-branch-copy:hover{border-color:var(--ink-3);background:var(--panel);}
.rd-branch-name{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rd-branch-copy .ico-check{display:none;}
.rd-branch-copy.copied .ico-copy{display:none;}
.rd-branch-copy.copied .ico-check{display:inline;color:var(--green-ink);}
.rd-copied{display:none;font:500 11.5px var(--sans);color:var(--green-ink);}
.rd-branch-copy.copied + .rd-copied{display:inline;}
.rd-spacer{flex:1 1 24px;}
.rd-pause{display:flex;align-items:center;gap:8px;padding:9px 15px;border:1.5px solid var(--amber-bg);
  border-radius:999px;background:var(--panel);font:600 12.5px var(--sans);color:var(--amber-ink);cursor:pointer;}
.rd-pause[hidden]{display:none;}
.rd-pause:hover:not([disabled]){background:var(--amber-bg);border-color:var(--amber);}
.rd-pause[disabled]{opacity:.55;cursor:not-allowed;}
/* Only one of the two glyphs shows; data-action decides which. */
.rd-pause[data-action="pause"] .ico-play,.rd-pause[data-action="resume"] .ico-pause{display:none;}
.rd-stop{display:flex;align-items:center;gap:8px;padding:9px 15px;border:1.5px solid var(--red-bg);
  border-radius:999px;background:var(--panel);font:600 12.5px var(--sans);color:var(--red-ink);cursor:pointer;}
.rd-stop[hidden]{display:none;}
.rd-stop:hover:not([disabled]){background:var(--red-bg);border-color:var(--red);}
.rd-error{margin-top:24px;color:var(--red-ink);font-size:12.5px;}
.rd-error[hidden]{display:none;}
/* .btn-ghost (388-389) declares no focus ring and .rd-back is focused
   programmatically by openRunDetail — same reasoning as the .hd-back arm at EOF. */
.rd-back{display:inline-flex;align-items:center;gap:8px;padding:8px 15px;}
.rd-back:focus-visible,.rd-pause:focus-visible,.rd-stop:focus-visible,
.rd-branch-copy:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}

@keyframes wr-pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.45;transform:scale(.82);}}
/* MUST sit after the rules above: @media contributes no specificity, so an
   earlier placement would lose the source-order tie (see the note at :1927). */
@media (prefers-reduced-motion: reduce){
  .run-screen{transition:none;}
  .rd-status .pdot,.rd-status.parked .pdot{animation:none;}
}
```

> NOTE: `@keyframes wr-pulse` is one of the four shared keyframes the contract says to add once. T3 may already have added it for the card's status avatar — if `grep -c '@keyframes wr-pulse' ui/public/style.css` is already 1, drop the block above rather than duplicating it. The test in Step 1 asserts exactly one definition either way.

- [ ] **Step 5: Run the CSS + structure tests green, the routing tests still red**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-routing.test.mjs`
Expected: the three structure/CSS tests pass; the first remaining failure is `#running/<id> opens the detail screen and paints its header` with `AssertionError: the shell slides to the detail screen`.

- [ ] **Step 6: Add the routing + painting code and delete `renderFocusView`**

(a) In the `el` object, after `histDetail: $('#hist-detail'),` (`app.js:139`), add:

```js
  runShell: $('#run-shell'),
  runDetail: $('#run-detail'),
```

(b) In `onState` (`app.js:1525-1528`), replace the branch capture:

```js
  if (msg && msg.branch && typeof msg.branch === 'object') {
    // Keep the WHOLE branch record, not just .feature: the detail header's
    // `base →` row needs .source, and T6's retained-work banner needs
    // .worktreeDir / .commitFailed. r.branchFeature stays as the card's field.
    r.branch = msg.branch;
    if (msg.branch.feature) r.branchFeature = msg.branch.feature;
  }
```

(c) Replace `renderRunningView` (`app.js:11411-11414`) and DELETE `renderFocusView` (`11497-11503`) entirely, putting the detail block where `renderFocusView` was (between `renderOverview` and `renderPipelineTabs`):

```js
function renderRunningView() {
  renderOverview();
  const screen = runDetailState.screen;
  if (!screen) return;
  const r = runs.get(runDetailState.runId);
  if (r) { paintRunDetail(r); return; }
  // The detail is open on an id the runs Map does not know. BEFORE `hello` that
  // is just a deep-link boot mid-flight (showView runs at module load, the socket
  // greeting lands later); AFTER it the id is genuinely bad -> bounce, which is
  // renderFocusView's old behavior. The hash check keeps a navigation already in
  // flight (resumeRunFromCard writes `running/<newId>` then repaints) from being
  // clobbered by this bounce.
  const [view, param] = parseHash();
  if (helloSeeded && view === 'running' && param === runDetailState.runId) location.hash = 'running';
}
```

```js
// ---------------------------------------------------------------------------
// Running detail screen (#running/<runId>)
// ---------------------------------------------------------------------------
// Twin of the History track (openHistDetail 9232 / closeHistDetail 9284). The
// param is the runId verbatim: the server mints it with randomUUID (server.mjs
// :797, :1228), so it never contains '/' and parseHash's first-slash split is
// already unambiguous — no parseHistDetailParam equivalent is needed.
//
// State lives HERE rather than in per-painter module globals (spec §11): the
// screen element is the identity every painter keys on.
let runDetailState = { runId: '', screen: null };

function routeRunDetail(param, { instant = false } = {}) {
  const runId = String(param || '');
  if (!runId) { closeRunDetail({ instant }); return; }
  // Re-routing to the already-open run is a no-op (hashchange echo).
  if (runDetailState.screen && runDetailState.runId === runId) return;
  if (!runs.has(runId) && helloSeeded) { location.hash = 'running'; return; }
  openRunDetail(runId, { instant });
}

function openRunDetail(runId, { instant = false } = {}) {
  const host = el.runDetail;
  const shell = el.runShell;
  if (!host || !shell) return;

  host.innerHTML = '';
  host.scrollTop = 0;                       // a prior visit's scroll must not carry over
  const screen = $('#run-detail-tpl').content.firstElementChild.cloneNode(true);
  host.appendChild(screen);
  runDetailState = { runId, screen };

  screen.querySelector('.rd-back').addEventListener('click', () => { location.hash = 'running'; });
  screen.querySelector('.rd-branch-copy').addEventListener('click', () => {
    // Read the CURRENTLY PAINTED name at click time — this binder outlives every
    // repaint that rewrites .rd-branch-name (same stale-capture class the History
    // header kills at 9683).
    const name = screen.querySelector('.rd-branch-name').textContent || '';
    if (name) copyBranchToClipboard(screen.querySelector('.rd-branch-copy'), name);
  });
  screen.querySelector('.rd-pause').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.action === 'resume') resumeRunFromCard(runDetailState.runId, btn);
    else pauseRun(runDetailState.runId, btn);
  });
  // T10 swaps this line for openStopModal(runDetailState.runId) (D5).
  screen.querySelector('.rd-stop').addEventListener('click', (e) => {
    stopRun(runDetailState.runId, e.currentTarget);
  });

  const r = runs.get(runId);
  if (r) paintRunDetail(r);
  else screen.querySelector('.rd-title').textContent = runId;   // deep link before hello

  if (instant) shell.classList.add('no-anim');
  shell.classList.add('detail-open');
  host.setAttribute('aria-hidden', 'false');
  host.removeAttribute('inert');   // the previous close left it inert for the slide;
                                   // focus() below is a no-op inside an inert subtree
  // `aria-hidden` alone does NOT remove focusability — only `inert` does, so set BOTH.
  const list = shell.querySelector('.run-screen-list');
  if (list) { list.setAttribute('aria-hidden', 'true'); list.setAttribute('inert', ''); }
  // AFTER the mount and AFTER the list went inert: leaving document.activeElement
  // inside a subtree as it becomes inert is invalid, and `.rd-back` is the one
  // control always present on this screen.
  screen.querySelector('.rd-back').focus({ preventScroll: true });
  if (instant) rafSafe(() => shell.classList.remove('no-anim'));
}

function closeRunDetail({ instant = false } = {}) {
  const shell = el.runShell;
  const host = el.runDetail;
  if (!shell || !host) return;
  if (!shell.classList.contains('detail-open')) { runDetailState = { runId: '', screen: null }; return; }
  const runId = runDetailState.runId;
  runDetailState = { runId: '', screen: null };
  host.setAttribute('aria-hidden', 'true');
  // Un-inert the list FIRST — focus() is a no-op inside an inert subtree.
  const list = shell.querySelector('.run-screen-list');
  if (list) { list.removeAttribute('aria-hidden'); list.removeAttribute('inert'); }
  // Hand focus back to the card the detail was opened from, re-queried by
  // data-run-id: a repaint may have replaced the node while the detail was up.
  // NOT on the instant path — that one runs from showView, which hides this whole
  // section a few lines later, so focusing there just drops focus to <body>.
  if (runId && !instant) {
    const node = $(`#run-list .run-card[data-run-id="${cssEscape(runId)}"] .rc-head`);
    if (node) node.focus({ preventScroll: true });   // dropped from the list -> skip
  }
  // AFTER the focus hand-off: the screen stays MOUNTED until transitionend, so
  // `aria-hidden` alone would leave .rd-back and the action pills tabbable behind
  // the list for the whole slide. openRunDetail clears it.
  host.setAttribute('inert', '');
  if (instant) {
    shell.classList.add('no-anim');
    shell.classList.remove('detail-open');
    host.innerHTML = '';
    rafSafe(() => shell.classList.remove('no-anim'));
    return;
  }
  shell.classList.remove('detail-open');
  // Empty the screen after the slide (or via the timeout under reduced motion /
  // jsdom, where transitionend never fires natively). transitionend BUBBLES, so a
  // descendant's transition would otherwise clear the DOM mid-slide — hence the
  // target + propertyName guard.
  const clear = () => { if (!runDetailState.screen) host.innerHTML = ''; };
  const onEnd = (e) => {
    if (e.target !== host || e.propertyName !== 'transform') return;
    host.removeEventListener('transitionend', onEnd);
    clear();
  };
  host.addEventListener('transitionend', onEnd);
  const t = setTimeout(() => { host.removeEventListener('transitionend', onEnd); clear(); }, 600);
  if (t && typeof t.unref === 'function') t.unref();
}

// Full repaint of the open detail screen. T6 appends the banners, the graph and
// the question panel; T7 appends the active tab's update.
function paintRunDetail(r) {
  const screen = runDetailState.screen;
  if (!screen || !r) return;
  paintRdHeader(screen, r);
}

// A bold-mono '·' separator, the twin of hdDot() (9618).
function rdDot() {
  const s = document.createElement('span');
  s.className = 'rd-dot';
  s.textContent = '·';
  return s;
}

function paintRdHeader(screen, r) {
  screen.querySelector('.rd-title').textContent = r.title || r.runId;

  // Status pill: statusPill's family + word (spec §4.3 pins it as the source).
  const { family, text } = statusPill(r);
  const pill = screen.querySelector('.rd-status');
  const terminal = r._finished || isTerminalStatus(r.status);
  pill.className = `rd-status pill-run ${family}` + ((terminal || isPaused(r)) ? ' parked' : '');
  pill.querySelector('.rd-status-word').textContent = text;

  // Meta: project · started · elapsed · cost · step n/m · step name.
  const meta = screen.querySelector('.rd-meta');
  meta.innerHTML = '';
  const step = runStepLabel(r);
  const stepText = step && step.n ? `step ${step.n}/${step.m} · ${step.name}` : '';
  const segs = [
    ['rd-project', projectName(r.projectDir), false],
    ['rd-clock', r.startedAt ? `started ${startedLabel(r.startedAt)}` : '', false],
    ['rd-dur', fmtDuration(liveTotalMs(r.steps, Date.now())), true],
    ['rd-cost', fmtUsd(r.totalCostUsd || 0), true],
    ['rd-step', stepText, false],
  ];
  segs.forEach(([cls, txt, strong], i) => {
    if (!txt) return;
    if (meta.childNodes.length) meta.appendChild(rdDot());
    const seg = document.createElement('span');
    seg.className = cls + (strong ? ' strong' : '');
    seg.textContent = txt;
    if (cls === 'rd-cost') seg.title = estTitle(r.totalCostUsd || 0);
    meta.appendChild(seg);
  });

  // Branch row.
  const br = r.branch && typeof r.branch === 'object' ? r.branch : {};
  const feature = br.feature || r.branchFeature || '';
  const source = br.source || '';
  const base = screen.querySelector('.rd-base');
  base.textContent = source ? `${source} →` : '';
  base.hidden = !source;
  const copyBtn = screen.querySelector('.rd-branch-copy');
  copyBtn.hidden = !feature;
  if (feature) screen.querySelector('.rd-branch-name').textContent = feature;

  // Actions. A terminal run offers neither (D8); T9 adds the History link here.
  const paused = isPaused(r);
  const pauseBtn = screen.querySelector('.rd-pause');
  const stopBtn = screen.querySelector('.rd-stop');
  pauseBtn.hidden = terminal && !paused;
  stopBtn.hidden = terminal && !paused;
  pauseBtn.dataset.action = paused ? 'resume' : 'pause';
  pauseBtn.querySelector('.rd-btn-label').textContent = paused ? 'Resume' : 'Pause';
  // A total-budget pause is 403'd by the server until the window resets or the
  // limit is raised — the same gating paintRunCard applies at 11381-11389.
  const totalBlocked = paused && r.pauseReason === 'cost_total' && budgetState.budget?.blocked;
  pauseBtn.disabled = !!totalBlocked;
  pauseBtn.title = totalBlocked
    ? `Total budget reached — blocked until ${fmtResetAtLocal(budgetState.budget.windowEndMs)} or a higher total limit`
    : (paused ? 'Resume — restart this paused pipeline where it left off'
              : 'Pause — gracefully stop the session so it can be resumed');
}
```

(d) In `showView` (`app.js:11685-11692`), after the History leave-guard, add:

```js
  // Same for Running's two-screen track (spec §5.1): leaving must not park a
  // detail screen mid-slide behind the next view.
  if (currentShownView === 'running' && name !== 'running') closeRunDetail({ instant: true });
```

(e) At `app.js:11712`, after the `view-history` toggle, add:

```js
  document.body.classList.toggle('view-running', name === 'running');
```

(f) In `showView`'s running branch (`app.js:11713-11726`), insert `routeRunDetail` between the render and the acknowledge block:

```js
  if (name === 'running') {
    renderRunningView();
    routeRunDetail(param, { instant: prevView !== 'running' });
    // Opening a run's detail page acknowledges it (linger → drops on next render).
    if (state.selectedRunId) {
      const sr = runs.get(state.selectedRunId);
      if (sr && !isPaused(sr) && (sr._finished || isTerminalStatus(sr.status))) acknowledgeRun(state.selectedRunId);
    }
  }
```

(g) After the History Escape handler (`app.js:10744`), add the Running twin:

```js
// Escape on the Running detail screen navigates back to the list — but never
// while an overlay modal is open (those own Escape). Capture-phase, for the same
// reason the History arm above is: the guard must read each modal's PRE-close state.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (currentView() !== 'running') return;
  if (!el.runShell || !el.runShell.classList.contains('detail-open')) return;
  if (el.viewerCard && !el.viewerCard.classList.contains('hidden')) return;
  if (el.confirmModal && !el.confirmModal.classList.contains('hidden')) return;
  if (el.pluginModal && !el.pluginModal.classList.contains('hidden')) return;
  location.hash = 'running';
}, true);
```

> NOTE: T10 adds a `#stop-modal` arm to this guard, exactly as the History arm carries a `#shipit-modal` one (`app.js:10743`).

- [ ] **Step 7: Run the new suite green**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-routing.test.mjs`
Expected: PASS — all 23 tests.

- [ ] **Step 8: Fix the one existing suite the deletion breaks**

Only `test/ui-pipeline-tabs.test.mjs:59-67` asserts focus-view behavior. Replace that test with:

```javascript
test('#running/<id> opens the detail screen and leaves the list intact', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [live('auth-fix'), live('seo-pSEO')] });
  window.location.hash = 'running/auth-fix';
  window.dispatchEvent(new window.Event('hashchange'));
  // The single-card focus view is gone (spec §7): #running/<id> is a second
  // SCREEN now, so the list behind it still holds every run.
  const cards = window.document.querySelectorAll('#run-list .run-card');
  assert.equal(cards.length, 2);
  assert.ok(window.document.querySelector('#run-shell').classList.contains('detail-open'));
  assert.equal(window.document.querySelector('#run-detail .rd-title').textContent, 'auth-fix');
});
```

In `test/ui-nav-buttons.test.mjs:109-115`, the comment on line 112 is now wrong (there is no bounce before `hello`). Replace the body with:

```javascript
test('reload on #running/<id> keeps the Running view (no reset to New)', async () => {
  const { window } = await boot('http://localhost:4317/#running/auth-fix');
  const doc = window.document;
  await tick(); await tick();   // let boot's showView + the detail mount settle
  assert.equal(hidden(doc, 'new'), true, 'must not fall back to the New view');
  assert.equal(hidden(doc, 'running'), false, 'Running view restored from the deep link');
  assert.ok(doc.querySelector('#run-shell').classList.contains('detail-open'),
    'the deep link lands on the detail screen, not the list');
});
```

Verified as NOT needing changes (each grepped for `renderFocusView` / `selectedRunId` / `running/`):
- `test/ui-pipeline-tabs.test.mjs:77`, `:89`, `:121` open `#running/<id>` only to assert sidebar-row linger/acknowledge behavior — `renderPipelineTabs()` and `acknowledgeRun` are untouched.
- `test/ui-pipeline-tabs.test.mjs:268` ("finishing the focused run falls back to Overview") asserts only `location.hash === 'running'`, which `finishRun:4361-4364` still writes.
- `test/ui-running-nav.test.mjs` — its only hash assertions are `:56` and `:72` on bare `#running` / `#new`; no focus route.
- `test/ui-running-order.test.mjs:58,74,92,107,119,139` — every navigation is bare `running`.
- `test/ui-scroll.test.mjs:163,185,208,240` — bare `running`; `:118` appends a card into `#run-list` by id, which the re-parenting does not change.
- `test/ui-shell.test.mjs`, `test/ui-question*.test.mjs`, `test/ui-cost-paused.test.mjs`, `test/ui-live-log-dom.test.mjs`, `test/ui-log-filters-row.test.mjs` — no match for `renderFocusView` / `selectedRunId` / `running/`; all address `#run-list` by id.

- [ ] **Step 9: Run the touched suites, then the full suite**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-routing.test.mjs test/ui-pipeline-tabs.test.mjs test/ui-nav-buttons.test.mjs test/ui-running-order.test.mjs test/ui-running-nav.test.mjs test/ui-scroll.test.mjs`
Expected: PASS, 0 failures.

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 10: Commit**

```
git add ui/public/index.html ui/public/style.css ui/public/app.js \
        test/ui-running-routing.test.mjs test/ui-pipeline-tabs.test.mjs test/ui-nav-buttons.test.mjs
git commit -m "feat(running): route #running/<runId> to a two-screen detail shell

Mirror History's slide track: #run-shell wraps .run-screen-list (topbar,
banner, #run-list) and .run-screen-detail (#run-detail), with routeRunDetail /
openRunDetail / closeRunDetail / runDetailState and a #run-detail-tpl header
card. Delete renderFocusView — #running/<id> is a second screen now, not a
single-card filter."
```

---

### Task 6: Detail — graph, banners, question panel

**Files:**
- Modify: `ui/public/index.html` (`#run-detail-tpl` `.rd-body` gains `.rd-banners`, `.rd-graph`, `.rd-questions`)
- Modify: `ui/public/style.css:1984` (append the `.rd-graph` / `.rd-banners` / `.rd-questions` block at EOF)
- Modify: `ui/public/app.js:1104` (`makeRun` gains `artifacts: []`)
- Modify: `ui/public/app.js:3908-3915` (`onArtifact` records the artifact)
- Modify: `ui/public/app.js:3978-3982` (`renderQpanel` gains a host parameter)
- Modify: `ui/public/app.js:4036-4038` (`renderClarifyBody` stamps the slots on the panel)
- Modify: `ui/public/app.js:4238-4245` (`submitAnswer` reads the submitted panel's slots)
- Modify: `ui/public/app.js:4296-4325` (`setPanelBusy` / `clearQpanel` address every mounted panel)
- Modify: `ui/public/app.js:8009` (the `#run-list` submit call passes its panel)
- Modify: `ui/public/app.js:11240-11274` (`paintStepper` split into `runStepperView` + a thin wrapper)
- Modify: `ui/public/app.js` — the Task-5 detail block gains `paintRdBanners` / `paintRdGraph` / `paintRdQuestions` / `rdRetainedFor` / `qpanelsFor` / the `#run-detail` delegated listener, and `paintRunDetail` calls them
- Test: `test/ui-running-detail.test.mjs` (new)

**Interfaces:**
- Consumes (from T5): `runDetailState`, `openRunDetail(runId, opts)`, `paintRunDetail(r)`, `#run-detail`, `.rd-body`, `r.branch`.
- Consumes (pre-existing): `buildRunGraph(host, manifest)` (`907`), `paintRunGraph(host, manifest, view)` (`976`), `manifestFor` (`712`), `runStatusOf(r, id, cellIdx, terminalDone, halted)` (`11005`), `loopCounts` (`956`), `durByNode(steps, now, live)` (`1264`), `modelUsedByNode` (`1290`), `subAgentsForNode(r, id)` (`1320`), `renderCostPauseBanner(rec, opts)` (`ui/public/stats-view.mjs:244`), `confirmCostOverride(runId, btn)` (`7903`), `renderRetainedWork(node, p)` (`8611`), `addRecoveryPatchLink(node, projectDir, p, artifacts)` (`8656`), `setupDiscardWorktreeButton(node, projectDir, p)` (`8677`), `renderQpanel(r)` (`3978`), `renderClarifyBody` (`4033`) / `renderGateBody` (`4144`) / `renderRecoveryBody` (`4206`), `postAnswer(r, payload)` (`4249`), `budgetState` (`342`).
- Produces:
  - `runStepperView(r) -> { manifest, view }` — the live paintRunGraph adapter, extracted from `paintStepper`.
  - `paintRdGraph(screen, r) -> void`, `paintRdBanners(screen, r) -> void`, `paintRdQuestions(screen, r) -> void`
  - `rdRetainedFor(r) -> {reason, members[]} | null`
  - `qpanelsFor(r) -> Element[]` — every mounted `.qpanel` for a run (card + open detail)
  - `renderQpanel(r, root = r.el) -> void` (signature change)
  - `submitAnswer(r, panel = null) -> void` (signature change)
  - `r.artifacts: Array<{kind, path}>` on the run model
  - DOM: `.rd-banners`, `.rd-graph > .run-flow-wrap > .run-flow`, `.rd-questions > .qpanel`

> NOTE: **`paintStepper(r)`'s adapter is what the detail reuses, not `paintHistStepper`.** `paintStepper` (`11240`) computes a real frontier `activeId` from `r.maxCellIdx` + `r.nodeStatus`, passes `live: true`, and takes durations from `durByNode(r.steps, now, true)` — which is what makes the current node glow (`.run-node.is-active` + `nodeGlow`) and the wires march (`wireFlow`). `paintHistStepper` (`9127`) hardcodes `activeId: null, live: false` and `durByNode(st.steps, 0, false)` because it paints a SAVED run; reusing it here would render a live pipeline as a frozen, glow-less history graph. `paintStepper` addresses `r.el.querySelector('.run-flow')` — the CARD's host — so the adapter is extracted into `runStepperView(r)` and both painters feed it to `paintRunGraph` against their own host.

> NOTE: `runStepperView` is not in the contract's fixed-name list. It is a pure extraction with no behavior of its own; the contract's `paintRdGraph(screen, r)` is the public name and is honored.

> NOTE: spec §5.3's dot-grid panel already exists — `.run-flow-wrap` (`style.css:1109`) ships `radial-gradient(circle, var(--line-2) 1.1px, transparent 1.1px)` at `background-size:22px 22px` with `border-radius:18px` and `overflow-x:auto`. `.rd-graph` therefore only supplies the margin box; no new panel styling is invented.

> NOTE: `.run-flow-wrap` scrollLeft needs no new code. `paintRunGraph` mutates nodes in place (never re-parents), and the one destructive path — `buildRunGraph`'s structural rebuild on a manifest signature change — already saves and restores `closest('.run-flow-wrap').scrollLeft` (`app.js:912-919`, `:948-950`). Step 1 pins that with a recorded-writes test rather than a final-value assert, which would be false-green under jsdom's absent layout (the same reasoning as `test/ui-scroll.test.mjs:130-135`).

> NOTE: `setupDiscardWorktreeButton` (`8677`) calls `btn.addEventListener` unconditionally and returns no removal handle, so calling it on every repaint would fire N POSTs per click. `paintRdBanners` binds it at most once per `{screen, runId}` pair and drops any stale listener by replacing the button node first — the same recipe `paintHdBanners` uses at `9868-9874`, keyed on the run instead of the record.

> NOTE: discarding the worktree from the detail page clears the button and the local carrier, but `r.branch.commitFailed` is server state — the banner returns on the next `state` frame until the orchestrator stops stamping it. History has the same shape (its authoritative row corrects it one fetch later); Running has no equivalent re-fetch, so this is a known, accepted limitation of surfacing the banner on a live run (D11).

> NOTE: `renderClarifyBody` rebuilds `r._answers` on every call (`4038`), and the card's `.qpanel` and the detail's `.qpanel` are BOTH mounted for the same run at the same time (the list screen sits behind the detail). Whichever painted last would own `r._answers`, so option clicks on the other panel would post as empty. Fixed by stamping the slot array on the panel node and having `submitAnswer` read the submitted panel's. `setPanelBusy` and `clearQpanel` are widened for the same reason.

> NOTE: the panel's visual restyle (larger detail-page metrics, green-tinted picked options, the "N of M answered" footer, the "Open run" button) is **T11**, per the contract. T6 ships the container, the `wr-rise` entry animation and the wiring only.

- [ ] **Step 1: Write the failing graph test**

Create `test/ui-running-detail.test.mjs` (T7 extends this file with the tab cases):

```javascript
// test/ui-running-detail.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// The Running detail screen's body: live pipeline graph, banners, question panel.
//
// boot() / settle() / go() are copied verbatim from test/ui-running-routing.test.mjs
// (itself copied from test/ui-history-routing.test.mjs:26-96); the open() / recv()
// WebSocket drivers come from test/ui-pipeline-tabs.test.mjs:31-33.

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');

const PROJECT = '/tmp/proj';
const ID = 'auth-fix';

const STEPPER2 = { steps: [{ label: 'Plan', nodes: [{ id: 'a', label: 'Planner' }] },
                           { label: 'Build', nodes: [{ id: 'b', label: 'Implementer' }] }] };
const STEPPER3 = { steps: [{ label: 'Plan', nodes: [{ id: 'a', label: 'Planner' }] },
                           { label: 'Build', nodes: [{ id: 'b', label: 'Implementer' }] },
                           { label: 'Review', nodes: [{ id: 'c', label: 'Reviewer' }] }] };

async function boot({ url = 'http://localhost:4317/', fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};

  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {}
    close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };

  const calls = [];
  window.fetch = (u, opts) => {
    calls.push({ url: String(u), opts: opts || {} });
    if (fetchHandler) { const r = fetchHandler(String(u), opts || {}); if (r) return r; }
    if (String(u).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200,
        json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200,
      json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 }) });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch { /* read-only global already present */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();

  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  const open = () => lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  open();
  return { window, calls, recv };
}

async function settle(window, n = 3) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

const live = (runId, extra = {}) => ({
  runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});

// Boot -> hello -> open the detail on ID.
async function openDetail(extra = {}) {
  const ctx = await boot(extra.bootOpts || {});
  ctx.recv({ type: 'hello', runs: [live(ID, extra.run || {})] });
  await settle(ctx.window);
  go(ctx.window, `running/${ID}`);
  await settle(ctx.window);
  ctx.screen = ctx.window.document.querySelector('#run-detail');
  return ctx;
}

// ---------- graph ----------

test('the detail screen paints a LIVE pipeline graph', async () => {
  const { window, recv } = await openDetail();
  recv({
    type: 'state', runId: ID, status: 'running', stepper: STEPPER2,
    steps: [{ nodeId: 'a', activeMs: 4000, cycle: 1 }, { nodeId: 'b', activeMs: 1000, runningSince: Date.now() - 2000, cycle: 1 }],
  });
  recv({ type: 'phase', runId: ID, phase: 'implement', nodeId: 'b', cycle: 1 });
  await settle(window);

  const host = window.document.querySelector('#run-detail .rd-graph .run-flow');
  assert.ok(host, '.rd-graph > .run-flow-wrap > .run-flow is built');
  assert.ok(host.closest('.run-flow-wrap'), 'the graph sits inside the shared scroll wrap');
  assert.equal(host.querySelectorAll('.run-node[data-id]').length, 2, 'one node per manifest node');

  const b = host.querySelector('.run-node[data-id="b"]');
  assert.ok(b.classList.contains('is-active'),
    'the frontier node is ACTIVE — paintStepper\'s adapter, not paintHistStepper\'s activeId:null');
  assert.notEqual(b.querySelector('.dur').textContent, '',
    'durations come from durByNode(..., live=true), not History\'s live=false');
  assert.ok(host.querySelector('svg.wires'), 'the shared wire renderer ran');
});

test('the detail graph preserves horizontal scroll across a manifest rebuild', async () => {
  // jsdom has no layout, so a final-value assert on scrollLeft is false-green
  // (nothing ever clamps it back to 0). Record the WRITES instead — the same
  // technique as test/ui-scroll.test.mjs:130-135.
  const { window, recv } = await openDetail();
  recv({ type: 'state', runId: ID, status: 'running', stepper: STEPPER2, steps: [] });
  await settle(window);

  const wrap = window.document.querySelector('#run-detail .rd-graph .run-flow-wrap');
  let left = 0; const writes = [];
  Object.defineProperty(wrap, 'scrollLeft', {
    configurable: true, get: () => left, set: (v) => { left = v; writes.push(v); },
  });
  wrap.scrollLeft = 800;
  writes.length = 0;                       // watch only the rebuild

  recv({ type: 'state', runId: ID, status: 'running', stepper: STEPPER3, steps: [] });
  await settle(window);
  assert.deepEqual(writes, [800], 'buildRunGraph wrote the saved scrollLeft back after the wipe');
  assert.equal(window.document.querySelectorAll('#run-detail .rd-graph .run-node[data-id]').length, 3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs`
Expected: FAIL — `the detail screen paints a LIVE pipeline graph` with `AssertionError: .rd-graph > .run-flow-wrap > .run-flow is built`.

- [ ] **Step 3: Add the body containers, extract the adapter, paint the graph**

(a) In `ui/public/index.html`, replace `<div class="rd-body"></div>` in `#run-detail-tpl` with:

```html
              <div class="rd-body">
                <div class="rd-banners">
                  <div class="retained-banner" role="alert" hidden></div>
                  <button type="button" class="hist-discard btn-ghost" hidden>Discard worktree</button>
                </div>
                <div class="rd-graph"><div class="run-flow-wrap"><div class="run-flow"></div></div></div>
                <div class="rd-questions" hidden><div class="qpanel hidden"></div></div>
              </div>
```

> NOTE: `.retained-banner` and `.hist-discard` keep their History class names because `renderRetainedWork` (`8611`) and `setupDiscardWorktreeButton` (`8677`) query for exactly those. The `.hist-retained-badge` node History's template carries is deliberately absent — it is a list-card affordance, and `renderRetainedWork` guards with `if (badge)` (`8614`).

(b) Replace `paintStepper` (`app.js:11240-11274`) with the extraction:

```js
// The live view-adapter paintRunGraph consumes for a RUNNING run: a real frontier
// activeId, live:true, and durations with the running tail included. Extracted so
// the detail screen can paint the SAME live graph into its own host (spec §5.3).
// Deliberately NOT paintHistStepper's adapter (9127) — that one hardcodes
// activeId:null / live:false against a SAVED run, which would kill the current
// node's glow and the marching-ants wires on a pipeline that is still running.
function runStepperView(r) {
  const manifest = manifestFor(r.stepper);
  const terminalDone = r.status === 'done';
  const halted = ['stopped', 'error', 'aborted', 'failed'].includes(r.status);
  const now = Date.now();
  const durs = durByNode(r.steps, now, true);
  const costs = r.costByNode || {};
  const modelsUsed = modelUsedByNode(r.steps);

  // cellIdx per node id (for the frontier comparison).
  const cellOf = {};
  manifest.steps.forEach((cell, i) => cell.nodes.forEach((n) => { cellOf[n.id] = i; }));

  // The active node = the frontier node currently now/pause (drives the live loop).
  let activeId = null;
  const frontier = manifest.steps[r.maxCellIdx];
  if (frontier && !terminalDone) {
    for (const n of frontier.nodes) {
      const k = r.nodeStatus[n.id];
      if (k === 'now' || k === 'pause') { activeId = n.id; break; }
    }
  }

  return {
    manifest,
    view: {
      statusOf: (id) => runStatusOf(r, id, cellOf[id] != null ? cellOf[id] : -1, terminalDone, halted),
      activeId,
      cycles: loopCounts(manifest, r.nodeCycle),
      live: true,
      durText: (id) => { const d = durs[id]; return d != null ? fmtDuration(d) : ''; },
      costText: (id) => { const c = costs[id]; return c != null ? fmtUsd(c) : ''; },
      subsOf: (id) => subAgentsForNode(r, id),
      modelUsedOf: (id) => modelsUsed[id],
    },
  };
}

function paintStepper(r) {
  if (!r.el) return;
  const host = r.el.querySelector('.run-flow');
  if (!host) return;
  const { manifest, view } = runStepperView(r);
  paintRunGraph(host, manifest, view);
}
```

(c) In the Task-5 detail block, add `paintRdGraph` and call it from `paintRunDetail`:

```js
function paintRdGraph(screen, r) {
  const host = screen.querySelector('.rd-graph .run-flow');
  if (!host) return;
  // buildRunGraph is idempotent (it returns early on an unchanged node-id
  // signature, 907-911) and restores .run-flow-wrap scrollLeft across the one
  // destructive path, so calling it on every paint is both cheap and correct —
  // no rebuildStepperDom twin is needed.
  buildRunGraph(host, r.stepper);
  const { manifest, view } = runStepperView(r);
  paintRunGraph(host, manifest, view);
}
```

```js
function paintRunDetail(r) {
  const screen = runDetailState.screen;
  if (!screen || !r) return;
  paintRdHeader(screen, r);
  paintRdBanners(screen, r);
  paintRdGraph(screen, r);
  paintRdQuestions(screen, r);
}
```

(d) Append the graph CSS at the end of `ui/public/style.css`:

```css
/* ---------- Running detail: pipeline graph ---------- */
/* The dot-grid panel spec §5.3 asks for is already `.run-flow-wrap` (1109) —
   radial-gradient var(--line-2) 1.1px at 22px 22px, 18px radius, horizontal
   scroll. This only supplies the margin box; the wrap's own legacy
   `margin:0 0 18px` is zeroed so it does not double up with .rd-graph's. */
.rd-graph{margin-top:18px;}
.rd-graph .run-flow-wrap{margin:0;}
```

- [ ] **Step 4: Run the graph tests green**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs`
Expected: the two graph tests PASS (`paintRdBanners` / `paintRdQuestions` are still undefined — add temporary no-op stubs in Step 3 if the run throws `ReferenceError: paintRdBanners is not defined`; they are filled in Steps 6 and 10).

- [ ] **Step 5: Write the failing banner tests**

Append to `test/ui-running-detail.test.mjs`:

```javascript
// ---------- banners ----------

test('a cost-paused run renders the cost banner above the graph', async () => {
  const { window, recv } = await openDetail();
  recv({ type: 'done', runId: ID, status: 'paused', reason: 'cost_pipeline' }   // onDone reads msg.reason (4387));
  await settle(window);

  const banners = window.document.querySelector('#run-detail .rd-banners');
  const banner = banners.querySelector('.cost-banner');
  assert.ok(banner, 'the cost-pause banner renders on the detail page too (D11)');
  assert.ok(banner.classList.contains('cb-pipeline'));
  assert.match(banner.textContent, /pipeline cost limit reached/);
  const graph = window.document.querySelector('#run-detail .rd-graph');
  assert.equal(banners.compareDocumentPosition(graph) & window.Node.DOCUMENT_POSITION_FOLLOWING,
    window.Node.DOCUMENT_POSITION_FOLLOWING, 'banners sit ABOVE the graph (spec §5.2)');
});

test('"Continue without cap" confirms, then resumes with ignoreCostCap', async () => {
  const posts = [];
  const ctx = await openDetail({
    bootOpts: {
      fetchHandler: (u, opts) => {
        if (u.includes('/api/resume')) {
          posts.push(JSON.parse(opts.body));
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, runId: 'auth-fix-2', pipelineId: 'p1' }) });
        }
        return null;
      },
    },
  });
  const { window } = ctx;
  window.__np.getRun(ID).pipelineId = 'p1';
  ctx.recv({ type: 'done', runId: ID, status: 'paused', reason: 'cost_pipeline' }   // onDone reads msg.reason (4387));
  await settle(window);

  const override = window.document.querySelector('#run-detail .rd-banners .cb-override');
  assert.ok(override, 'the pipeline banner offers the override button');
  override.dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window);

  const modal = window.document.querySelector('#confirm-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'confirmModal (6030) asks first');
  assert.equal(window.document.querySelector('#confirm-title').textContent, 'Continue without cap?');
  window.document.querySelector('#confirm-ok').dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window, 5);

  assert.deepEqual(posts, [{ pipelineId: 'p1', ignoreCostCap: true }],
    'POST /api/resume carries the cap override');
});

test('the cost banner is rebuilt only when the reason changes', async () => {
  const { window, recv } = await openDetail();
  recv({ type: 'done', runId: ID, status: 'paused', reason: 'cost_pipeline' }   // onDone reads msg.reason (4387));
  await settle(window);
  const first = window.document.querySelector('#run-detail .rd-banners .cost-banner');
  recv({ type: 'state', runId: ID, status: 'paused', steps: [] });     // plain repaint
  await settle(window);
  assert.equal(window.document.querySelector('#run-detail .rd-banners .cost-banner'), first,
    'an unchanged reason must not detach the node the .cb-override click is mid-flight on');
});

test('retained work renders from branch.commitFailed and binds Discard exactly once', async () => {
  const posts = [];
  const ctx = await openDetail({
    bootOpts: {
      fetchHandler: (u, opts) => {
        if (u.includes('/discard-worktree')) {
          posts.push(u);
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ remaining: 0, patches: [] }) });
        }
        return null;
      },
    },
  });
  const { window, recv } = ctx;
  window.confirm = () => true;
  window.__np.getRun(ID).pipelineId = 'p1';
  const RETAINED = {
    type: 'state', runId: ID, status: 'running', steps: [],
    branch: { source: 'main', feature: 'worca-cc/auth', worktreeDir: '/tmp/wt',
              commitFailed: { code: 'dirty', step: 'commit', message: 'nothing staged' } },
  };
  recv(RETAINED);
  await settle(window);

  const banner = window.document.querySelector('#run-detail .retained-banner');
  assert.equal(banner.hidden, false, 'the retained-work banner renders on the detail page (D11)');
  assert.match(banner.textContent, /uncommitted work retained/);
  assert.match(banner.textContent, /\/tmp\/wt/);

  // Repaint several times — setupDiscardWorktreeButton (8677) adds a listener on
  // EVERY call and gives no removal handle, so an unguarded re-bind would fire
  // one POST per paint.
  recv(RETAINED);
  recv(RETAINED);
  await settle(window);

  const btn = window.document.querySelector('#run-detail .hist-discard');
  assert.equal(btn.hidden, false);
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window, 5);
  assert.equal(posts.length, 1, 'exactly one POST per click, after three paints');
});

test('a recovery-patch artifact adds the alternate-recovery link once', async () => {
  const { window, recv } = await openDetail();
  window.__np.getRun(ID).pipelineId = 'p1';
  recv({ type: 'artifact', runId: ID, kind: 'retained-work-patch', path: '/tmp/x.patch' });
  recv({
    type: 'state', runId: ID, status: 'running', steps: [],
    branch: { feature: 'worca-cc/auth', worktreeDir: '/tmp/wt',
              commitFailed: { code: 'dirty', step: 'commit', message: 'nope' } },
  });
  await settle(window);
  let links = window.document.querySelectorAll('#run-detail .retained-patch-link');
  assert.equal(links.length, 1, 'addRecoveryPatchLink ran off the recorded artifact');
  assert.match(links[0].querySelector('a').getAttribute('href'), /\/api\/runs\/p1\/recovery-patch/);

  recv({ type: 'state', runId: ID, status: 'running', steps: [],
         branch: { feature: 'worca-cc/auth', worktreeDir: '/tmp/wt',
                   commitFailed: { code: 'dirty', step: 'commit', message: 'nope' } } });
  await settle(window);
  links = window.document.querySelectorAll('#run-detail .retained-patch-link');
  assert.equal(links.length, 1, 'and self-guards against duplicates on repaint');
});
```

- [ ] **Step 6: Run the banner tests red, then implement the banners**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs`
Expected: FAIL — `a cost-paused run renders the cost banner above the graph` with `AssertionError: the cost-pause banner renders on the detail page too (D11)`.

(a) In `makeRun` (`app.js:1104`, next to `subAgents: []`), add:

```js
    artifacts: [],     // Array<{kind, path}> — what the run has written so far.
                       // The detail's retained-work banner needs it to offer the
                       // recovery-patch link (addRecoveryPatchLink, 8656).
```

(b) Replace `onArtifact` (`app.js:3908-3915`):

```js
function onArtifact(r, msg) {
  if (msg && msg.kind) {
    if (!Array.isArray(r.artifacts)) r.artifacts = [];
    r.artifacts.push({ kind: msg.kind, path: msg.path || '' });
  }
  onLog(r, {
    source: 'artifact',
    level: 'artifact',
    text: `${msg.kind || 'file'}: ${msg.path || ''}`,
    ts: Date.now(),
  });
}
```

(c) In the Task-5 detail block, add:

```js
// { screen, runId } the detail's Discard-worktree listener is currently bound to.
// setupDiscardWorktreeButton (8677) adds a listener on EVERY call and hands back no
// removal handle, so paintRdBanners re-binds only when either identity changes —
// the same guard paintHdBanners keeps at 9868-9874.
let rdDiscardBound = null;

// Live twin of hdRetainedFor (9791). A run model has no authoritative
// `retainedWork` field — that one is minted by /api/history from an existsSync
// gate — so derive it from the state snapshot's branch.commitFailed stamp, which
// is exactly the fallback History uses on a deep link.
function rdRetainedFor(r) {
  const br = r.branch && typeof r.branch === 'object' ? r.branch : {};
  if (!br.commitFailed || !br.worktreeDir || br.worktreeRemoved === true) return null;
  return {
    reason: br.commitFailed.code || 'unknown',
    members: [{
      projectKey: null,
      worktreeDir: br.worktreeDir,
      branch: br.feature || null,
      code: br.commitFailed.code || null,
      step: br.commitFailed.step || null,
      message: br.commitFailed.message || '',
      at: br.commitFailed.at || null,
    }],
  };
}

function paintRdBanners(screen, r) {
  const banners = screen.querySelector('.rd-banners');
  if (!banners) return;

  // ---- cost-pause banner (D11) ----
  // Rebuild ONLY when the reason actually changed. An unconditional
  // remove+rebuild would detach `.cb-override` mid-flight: its click awaits
  // confirmModal then resumeRunFromCard, and any repaint inside that window
  // (a `state` frame, a budget refresh) would replace the node the busy state
  // is being written to. Same reasoning as paintHdBanners:9818-9829.
  const costPaused = isPaused(r) && typeof r.pauseReason === 'string' && r.pauseReason.startsWith('cost_');
  const old = banners.querySelector('.cost-banner');
  if (old && (!costPaused || old.dataset.pauseReason !== r.pauseReason)) old.remove();
  if (costPaused && !banners.querySelector('.cost-banner')) {
    const fresh = renderCostPauseBanner(
      { pauseReason: r.pauseReason, pipelineId: r.pipelineId, totalCostUsd: r.totalCostUsd },
      { budget: budgetState.budget || {},
        fmt: { usd: fmtUsd, usd4: fmtUsd4, duration: fmtDuration, estTitle } });
    fresh.dataset.pauseReason = r.pauseReason;   // what the conditional rebuild keys on
    banners.prepend(fresh);                      // above the retained-work banner
  }

  // ---- retained work (D11) ----
  // renderRetainedWork only READS `p.retainedWork`, so a derived carrier is fine
  // for the paint; every MUTATING helper below gets the same carrier so the
  // discard handler's `p.retainedWork = null` lands somewhere harmless.
  const retained = rdRetainedFor(r);
  const carrier = { id: r.pipelineId || '', projectDir: r.projectDir || '', retainedWork: retained };
  renderRetainedWork(screen, carrier);
  let dbtn = screen.querySelector('.hist-discard');
  if (retained && r.pipelineId) {
    if (!rdDiscardBound || rdDiscardBound.screen !== screen || rdDiscardBound.runId !== r.runId) {
      // addEventListener leaves no removal handle — drop any stale listener by
      // replacing the node first.
      if (dbtn) { const swap = dbtn.cloneNode(true); dbtn.replaceWith(swap); dbtn = swap; }
      rdDiscardBound = { screen, runId: r.runId };
      setupDiscardWorktreeButton(screen, r.projectDir || null, carrier);
    }
  } else {
    rdDiscardBound = null;
    if (dbtn) dbtn.hidden = true;   // renderRetainedWork does not touch this button
  }
  // Must run AFTER renderRetainedWork unhides the banner: addRecoveryPatchLink
  // bails on a hidden banner and self-guards against duplicates. It needs a
  // pipeline id for the URL, so skip it until one is known.
  if (r.pipelineId) addRecoveryPatchLink(screen, r.projectDir || null, carrier, r.artifacts || []);
}
```

(d) Add the `#run-detail` delegated listener next to the block (the banner and the question panel are rebuilt on every paint, so their controls cannot be bound directly the way `.rd-back` is):

```js
// Delegated controls on the rebuilt parts of the detail screen. #run-detail is a
// static node, so one listener survives every repaint. The direct bindings in
// openRunDetail cover only the template's OWN, never-replaced controls.
el.runDetail?.addEventListener('click', (e) => {
  const r = runs.get(runDetailState.runId);
  if (!r) return;
  const override = e.target.closest && e.target.closest('.cb-override');
  if (override) { confirmCostOverride(r.runId, override); return; }   // async, fire-and-forget
  if (e.target.closest && e.target.closest('.cb-settings')) { location.hash = 'settings'; return; }
  const qbtn = e.target.closest && e.target.closest(
    '.qpanel .btn-go, .qpanel .gate-continue, .qpanel .gate-another, .qpanel .recovery-retry, .qpanel .recovery-abort');
  if (!qbtn) return;
  if (qbtn.classList.contains('gate-continue')) postAnswer(r, { decision: 'continue' });
  else if (qbtn.classList.contains('gate-another')) postAnswer(r, { decision: 'another' });
  else if (qbtn.classList.contains('recovery-retry')) postAnswer(r, { decision: 'retry' });
  else if (qbtn.classList.contains('recovery-abort')) postAnswer(r, { decision: 'abort' });
  else submitAnswer(r, qbtn.closest('.qpanel'));
});
```

(e) Append the banner CSS at the end of `ui/public/style.css`:

```css
/* ---------- Running detail: banners ---------- */
/* align-items:flex-start, NOT the default stretch: `.hist-discard` (856) is an
   inline-flex button with no width and a stretching column would blow it up to
   the full body width. Only the two BANNERS want the full row. Same shape as
   .hd-banners (1714). */
.rd-banners{display:flex;flex-direction:column;align-items:flex-start;gap:12px;}
/* Both reused banners carry legacy margins from their old hosts —
   `.retained-banner{margin:0 0 18px}` (714) and `.cost-banner{margin-top:12px}`
   (1505) — which double up with this column's own gap. */
.rd-banners .retained-banner,.rd-banners .cost-banner{align-self:stretch;margin:0;}
/* NOT `:empty` — the container always holds its two template children, just
   hidden. Key the margin off "has a visible child", as .hd-banners does. */
.rd-banners:has(> :not([hidden])){margin-top:18px;}
```

- [ ] **Step 7: Run the banner tests green**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs`
Expected: PASS — the graph and banner tests.

- [ ] **Step 8: Write the failing question-panel tests**

Append to `test/ui-running-detail.test.mjs`:

```javascript
// ---------- question panel ----------

const clarify = (id = 'q1') => ({
  id, kind: 'clarify',
  questions: [
    { id: 'q1a', question: 'Which auth flow?', options: ['OAuth', 'Magic link', ''] },
    { id: 'q1b', question: 'Anything else?', options: [] },
  ],
});

test('a clarify question renders the large panel on the detail page', async () => {
  const { window, recv } = await openDetail();
  recv({ type: 'question', runId: ID, ...clarify() });
  await settle(window);

  const host = window.document.querySelector('#run-detail .rd-questions');
  assert.equal(host.hidden, false, 'the panel container is revealed');
  const panel = host.querySelector('.qpanel');
  assert.equal(panel.classList.contains('hidden'), false);
  assert.equal(panel.querySelectorAll('.qblock').length, 2, 'renderClarifyBody ran into the detail host');
  assert.equal(panel.querySelectorAll('.qopt').length, 2, 'padding options are filtered out');
  assert.ok(panel.querySelector('.btn-go'), 'the submit button is present');
  // It sits between the graph and where T7 puts the tabs.
  const graph = window.document.querySelector('#run-detail .rd-graph');
  assert.equal(graph.compareDocumentPosition(host) & window.Node.DOCUMENT_POSITION_FOLLOWING,
    window.Node.DOCUMENT_POSITION_FOLLOWING, 'the panel follows the graph (spec §5.4)');
});

test('the gate and recovery bodies render on the detail page too (D6)', async () => {
  const gate = await openDetail();
  gate.recv({ type: 'question', runId: ID, id: 'g1', kind: 'gate',
              issues: [{ severity: 'major', title: 'Missing test', detail: 'x' }] });
  await settle(gate.window);
  const gpanel = gate.window.document.querySelector('#run-detail .rd-questions .qpanel');
  assert.ok(gpanel.querySelector('.gate-another'), 'the gate body renders');
  assert.equal(gpanel.querySelectorAll('.issues .issue').length, 1);

  const rec = await openDetail();
  rec.recv({ type: 'question', runId: ID, id: 'r1', kind: 'recovery',
             recovery: { cls: 'auth', message: 'token expired' } });
  await settle(rec.window);
  const rpanel = rec.window.document.querySelector('#run-detail .rd-questions .qpanel');
  assert.ok(rpanel.querySelector('.recovery-retry'), 'the recovery body renders');
  assert.match(rpanel.textContent, /token expired/);
});

test('answers posted from the DETAIL panel carry the detail panel\'s choices', async () => {
  const posts = [];
  const ctx = await openDetail({
    bootOpts: {
      fetchHandler: (u, opts) => {
        if (u.includes('/api/answer')) {
          posts.push(JSON.parse(opts.body));
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
        }
        return null;
      },
    },
  });
  const { window } = ctx;
  ctx.recv({ type: 'question', runId: ID, ...clarify() });
  await settle(window);

  const dpanel = window.document.querySelector('#run-detail .rd-questions .qpanel');
  dpanel.querySelectorAll('.qopt')[0].dispatchEvent(new window.Event('click', { bubbles: true }));
  dpanel.querySelector('.btn-go').dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window, 5);

  assert.equal(posts.length, 1);
  assert.equal(posts[0].payload.answers[0].choice, 'OAuth',
    'the DETAIL panel\'s slot won, not whichever panel painted last');
});

test('answers posted from the CARD panel still carry the card\'s choices', async () => {
  // THE dual-mount regression, and the one that is RED before the fix.
  // renderClarifyBody rebuilds r._answers on every call (4038); paintRunDetail
  // runs AFTER renderOverview, so the DETAIL panel always paints last and owns
  // that array. The card's option clicks mutate slots nobody reads, and its
  // Submit posts the detail panel's untouched (empty) choices.
  const posts = [];
  const ctx = await openDetail({
    bootOpts: {
      fetchHandler: (u, opts) => {
        if (u.includes('/api/answer')) {
          posts.push(JSON.parse(opts.body));
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
        }
        return null;
      },
    },
  });
  const { window } = ctx;
  ctx.recv({ type: 'question', runId: ID, ...clarify() });
  await settle(window);

  const cpanel = window.document.querySelector(`#run-list .run-card[data-run-id="${ID}"] .qpanel`);
  assert.ok(cpanel, 'the list card still carries its own panel (D6)');
  cpanel.querySelectorAll('.qopt')[1].dispatchEvent(new window.Event('click', { bubbles: true }));
  cpanel.querySelector('.btn-go').dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window, 5);

  assert.equal(posts.length, 1);
  assert.equal(posts[0].payload.answers[0].choice, 'Magic link');
});

test('submitting busies BOTH mounted panels and resolving clears both', async () => {
  const ctx = await openDetail({
    bootOpts: {
      fetchHandler: (u) => (u.includes('/api/answer')
        ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) })
        : null),
    },
  });
  const { window, recv } = ctx;
  recv({ type: 'question', runId: ID, ...clarify() });
  await settle(window);

  const dpanel = window.document.querySelector('#run-detail .rd-questions .qpanel');
  const cpanel = window.document.querySelector(`#run-list .run-card[data-run-id="${ID}"] .qpanel`);
  dpanel.querySelector('.btn-go').dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window, 5);
  assert.equal(dpanel.querySelector('.btn-go').disabled, true);
  assert.equal(cpanel.querySelector('.btn-go').disabled, true,
    'the card panel cannot stay clickable while an answer is in flight');

  recv({ type: 'question-resolved', runId: ID, id: 'q1' });
  await settle(window);
  assert.equal(window.document.querySelector('#run-detail .rd-questions').hidden, true);
  assert.equal(window.document.querySelector('#run-detail .rd-questions .qpanel').innerHTML, '');
  assert.equal(cpanel.innerHTML, '', 'and the card panel is emptied too');
});

test('the question panel rises in and is neutralized under reduced motion', () => {
  assert.equal((css.match(/@keyframes wr-rise/g) || []).length, 1,
    'the shared keyframe is declared once (contract §Keyframes)');
  assert.match(css, /\.rd-questions\s*\{[^}]*animation:\s*wr-rise/);
  assert.match(css, /\.rd-questions\[hidden\]\s*\{[^}]*display:\s*none/,
    'an explicit twin — the UA [hidden] rule loses to any author display');
  const at = css.indexOf('.rd-questions{');
  const kill = css.indexOf('.rd-questions{animation:none;}');
  assert.ok(kill > at, 'the reduced-motion block sits AFTER the rule it neutralizes');
});
```

- [ ] **Step 9: Run the question tests red**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs`
Expected: FAIL — `a clarify question renders the large panel on the detail page` with `AssertionError: the panel container is revealed` (`.rd-questions` stays `hidden`).

- [ ] **Step 10: Host-parameterize the question panel and paint it**

(a) `renderQpanel` needs a host parameter — it addresses `r.el` today (`app.js:3979-3981`). Replace its head:

```js
// Build the inline question/gate panel into `root`'s .qpanel from
// r.pendingQuestion, un-hide it, and wire its inputs. Idempotent: re-building
// replaces the content. `root` defaults to the list card, so the two existing
// call sites (onQuestion:3941, buildRunCard:10999) are unchanged; the detail
// screen passes its own subtree, and BOTH panels can be mounted at once.
function renderQpanel(r, root = r.el) {
  if (!root) return;
  const panel = root.querySelector('.qpanel');
  if (!panel) return;
```

The rest of the function body is unchanged. Existing call sites: `app.js:3941` (`if (r.el) renderQpanel(r);`) and `app.js:10999` (`renderQpanel(r);` inside `buildRunCard`, right after `r.el = node`). Both keep working on the default. The third call site is `paintRdQuestions` below.

(b) In `renderClarifyBody` (`app.js:4036-4038`), stamp the slots on the panel:

```js
  // r._answers maps a stable per-question key -> chosen value (option text or
  // free-text or ''). Rebuilt each render so it tracks the current markup.
  // ALSO stamped on the panel node: the list card and the open detail screen
  // mount a .qpanel for the same run at the same time, so the module-level
  // r._answers can only ever describe whichever painted LAST. submitAnswer reads
  // the SUBMITTED panel's copy; r._answers stays as the no-panel fallback.
  r._answers = [];
  panel.__answers = r._answers;
```

(c) Replace `submitAnswer` (`app.js:4238-4245`):

```js
// Gather the clarify answers from the slots of the panel that was submitted and
// POST them. `panel` is null only for a caller that has no panel node.
function submitAnswer(r, panel = null) {
  const slots = (panel && panel.__answers) || r._answers || [];
  const answers = slots.map((s) => ({
    id: s.id,
    question: s.question,
    choice: typeof s.choice === 'string' ? s.choice.trim() : '',
  }));
  postAnswer(r, { answers });
}
```

(d) In the `#run-list` delegated handler (`app.js:8009`), pass the panel:

```js
      else submitAnswer(r, qbtn.closest('.qpanel'));
```

(e) Replace `setPanelBusy` and `clearQpanel` (`app.js:4296-4325`) so they address every mounted panel:

```js
// Every mounted .qpanel for a run: the list card's, and the detail screen's when
// it is open on this run. Both are in the DOM at once (the list screen sits
// behind the detail), so busy-state and clearing must cover both or the card
// keeps an enabled Submit while an answer is in flight from the detail.
function qpanelsFor(r) {
  const out = [];
  const card = r.el && r.el.querySelector('.qpanel');
  if (card) out.push(card);
  const screen = runDetailState.screen;
  if (screen && runDetailState.runId === r.runId) {
    const detail = screen.querySelector('.qpanel');
    if (detail) out.push(detail);
  }
  return out;
}

// Disable/enable the panels' interactive controls and reflect a "Resuming…"
// state on the primary button while an answer is in flight / awaiting resume.
function setPanelBusy(r, busy) {
  for (const panel of qpanelsFor(r)) {
    panel.querySelectorAll('button, input').forEach((node) => { node.disabled = busy; });
    const primary = panel.querySelector('.btn-go, .gate-another');
    if (primary && busy && !primary.dataset.label) {
      primary.dataset.label = primary.textContent;
      primary.textContent = 'Resuming…';
    } else if (primary && !busy && primary.dataset.label) {
      primary.textContent = primary.dataset.label;
      delete primary.dataset.label;
    }
  }
}

// Empty + hide a run's qpanels and drop its attention ring. Used on resume and
// from finishRun's terminal path.
function clearQpanel(r) {
  for (const panel of qpanelsFor(r)) {
    panel.innerHTML = '';
    panel.classList.add('hidden');
  }
  if (r.el) r.el.classList.remove('attention');
  const screen = runDetailState.screen;
  if (screen && runDetailState.runId === r.runId) {
    const host = screen.querySelector('.rd-questions');
    if (host) host.hidden = true;
  }
}
```

> NOTE: `qpanelsFor` reads `runDetailState`, which T5 declares near `renderOverview` (~`app.js:11497`) while `setPanelBusy` lives at `4296`. That is a plain `let` at module scope read from a function that only runs after module init, so there is no TDZ hazard — the same shape as `helloSeeded` (`4632`) being read by `onHello` (`595`).

(f) In the Task-5 detail block, add:

```js
function paintRdQuestions(screen, r) {
  const host = screen.querySelector('.rd-questions');
  if (!host) return;
  renderQpanel(r, host);                       // host contains the .qpanel node
  host.hidden = r.pendingQuestion == null;     // drives the wr-rise entry
}
```

(g) `onQuestion` (`app.js:3937-3942`) paints the card directly and then falls through to `paintRunCard`; the detail is repainted by `handleServerMessage`'s tail (`app.js:584`) → `renderRunningView` → `paintRunDetail`. No change is needed there.

(h) Append the question CSS at the end of `ui/public/style.css`:

```css
/* ---------- Running detail: question panel ---------- */
/* Container only — the panel's own restyle (larger metrics, green-tinted picked
   options, the "N of M answered" footer, "Open run") is T11 for BOTH mounts. */
.rd-questions{margin-top:18px;animation:wr-rise .3s cubic-bezier(.2,.7,.3,1) both;}
/* Explicit twin: the UA [hidden] rule is (0,0,0) and loses to any author
   `display`, so without this the panel would render even while hidden. */
.rd-questions[hidden]{display:none;}
/* .qpanel ships `margin-top:18px` (632) which would double up with the wrapper's. */
.rd-questions .qpanel{margin-top:0;}

@keyframes wr-rise{from{transform:translateY(10px);opacity:0;}to{transform:translateY(0);opacity:1;}}
/* MUST sit after the rule it neutralizes — @media contributes no specificity. */
@media (prefers-reduced-motion: reduce){
  .rd-questions{animation:none;}
}
```

> NOTE: `@keyframes wr-rise` is one of the four shared keyframes the contract says to add once. If T5's stop-modal work or T3 already introduced it, drop the block above; the test asserts exactly one definition either way.

- [ ] **Step 11: Run the whole detail suite green**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs`
Expected: PASS — all 13 tests.

- [ ] **Step 12: Run the suites the shared-helper changes touch, then the full suite**

The `renderQpanel` / `submitAnswer` / `setPanelBusy` / `clearQpanel` / `paintStepper` edits are shared with the list card and the History detail:

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-question.test.mjs test/ui-question-agent.test.mjs test/ui-running-detail.test.mjs test/ui-running-routing.test.mjs test/ui-run-flow-css.test.mjs test/ui-scroll.test.mjs test/ui-cost-paused.test.mjs test/ui-history-detail.test.mjs`
Expected: PASS, 0 failures.

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 13: Commit**

```
git add ui/public/index.html ui/public/style.css ui/public/app.js \
        test/ui-running-detail.test.mjs
git commit -m "feat(running): add the detail graph, banners and question panel

Extract paintStepper's live view-adapter into runStepperView so the detail
screen paints the same glowing, marching-ants graph into .rd-graph (never
paintHistStepper's frozen activeId:null/live:false adapter). Add .rd-banners
with the cost-pause and retained-work banners, binding the non-idempotent
setupDiscardWorktreeButton once per screen+run. Host-parameterize renderQpanel
so the detail mounts the same three question bodies as the card, with the
answer slots stamped per panel so two mounted panels cannot clobber each
other's choices."
```

---

### Task 7: Detail tabs — Live log / Overview / Agents

**Files:**
- Modify: `ui/public/app.js:1525-1527` (`onState` — capture `branch.source`, `branch.worktreeDir`, `branch.worktreeRemoved`, `prompt`)
- Modify: `ui/public/app.js:10728-10729` (insert the whole `.rd-*` tab block between `buildHdLogs`'s closing `}` and the History Escape handler)
- Modify: `ui/public/app.js:2743-2744` (`window.__np` exports)
- Modify: `ui/public/style.css:1195-1198`, `:1222`, `:1238` (extend three shared pill selector lists with the `.rd-ag-*` halves)
- Modify: `ui/public/style.css:1984` (append the Running-detail tab-body block at end of file)
- Test: `test/ui-running-detail.test.mjs`

**Interfaces:**
- Consumes (from Task 1): `initDetailTabs(screen, tabs, ctx, opts) -> void`.
- Consumes (from Task 3): `runStatusMeta(r) -> {family:'blue'|'amber'|'green'|'red', word, glyph}`; `runStepLabel(r) -> {n, m, name, model}`.
- Consumes (from Task 5): `runDetailState = {runId, screen}`; `el.runShell` = `#run-shell`; `el.runDetail` = `#run-detail`.
- Consumes (from Task 6): `#run-detail-tpl` carries `.rd-tabs` (pill row) and `.rd-sections` (panel host); `paintRunDetail(r)`.
- Consumes (existing, verified): `buildLogFilterBar()` `app.js:8066`; `readLogFilterFrom(root, prevSearch)` `:8073`; `scheduleLogSearch(holder, fn)` `:8086`; `paintLogFilters(r, root)` `:3791`; `facetKeys(facets)` `:3845`; `appendLogRec(logEl, rec, prevCycle)` `:3717`; `trimLogDom(logEl)` `:3706`; `clearLogPlaceholder(logEl)` `:3865`; `syncAutoscrollSwitch(r, el)` `:3752`; `setAutoscroll(r, on)` `:3766`; `copyLogToClipboard(btn, recs)` `:3627`; `MAX_LOG_LINES = 4000` `:3593`; `hdStatCard(kind,label,value,sub)` `:10447`; `hdSubDuration(s)` `:10617`; `subsGroupsForRender(subAgents, steps, stepper)` `:1390`; `cycleAwareLabel(stepper, subAgents, groupKeys)` `:1487`; `stepSkillsFromSteps(steps)` `:1433`; `stepGraphifyFromSteps(steps)` `:1445`; `stepStatusByKey(steps, stepper)` `:1418`; `subGroupStatus(list)` `:11092`; `subRowStatus(status)` `:11101`; `SUBS_STAT_TEXT` `:11109`; `skillPillsHtml` `:11128`; `agentTypePillHtml` `:11158`; `graphifyCountPillHtml` `:11167`; `CYCLE_KEY_SEP = '|'` `:1358`; `budgetState.budget` `:339`; `HD_TAB_ICONS` `:10017`; `liveTotalMs` `:1249`; `fmtDuration` `:1230`; `fmtUsd` `:1204`; `fmtUsd4` `:1213`; `estTitle` `:1220`; `projectName` `:10904`; `startedLabel` `:10912`; `escapeHtml` `:1189`; `compileLogFilter`/`logLineVisible`/`logFacets` from `./log-filter.mjs` (already imported, `app.js:58`).
- Produces: `RD_TABS` (array of `{key,label,icon,badge(ctx),visible(ctx),build(sec,ctx)}`); `RD_TERMINAL = ['done','stopped','error']`; `rdCtx(r) -> {run, screen}`; `initRdTabs(screen, r) -> void`; `buildRdLogs(sec, ctx)`, `buildRdOverview(sec, ctx)`, `buildRdAgents(sec, ctx)` — each sets `sec.__update = (ctx) => void`; `rdLogBox(sec)`, `rdAutoscrollLog(sec, r)`, `rdRepaintLog(sec, r)`, `rdPaintLogFilters(sec, r) -> boolean`, `rdMaybePaintLogFilters(sec, r, rec) -> boolean` (Task 8 consumes all five); `rdWireLogControls(sec, r)`; `rdStateCopy(r, stepName) -> string`; `rdOvStateBanner(host, r)` / `rdOvStats(host, r)` / `rdOvTask(r)`; `rdAgentsBody(sec, r)`; `rdSubState(status) -> {word, family}`.

> NOTE: the contract fixes `initDetailTabs(screen, tabs, ctx, opts)` but not `opts`, and spec §5.5 mentions only `{tabClass, secClass}`. That is not enough to drive two different screens: `initHdTabs` hard-codes the bar/section selectors (`.hd-tabs` / `.hd-sections`, `app.js:10063-10064`), the id prefix (`hd-tab-<key>` / `hd-sec-<key>`, `:10075`/`:10091`), the badge class (`.hd-tab-badge`, `:10083`), the icon lookup (`HD_TAB_ICONS[t.key]`, `:10078`) and the initial key (`activate(data.results ? 'diff' : 'overview')`, `:10135`). Task 7 therefore requires Task 1 to expose exactly:
> `initDetailTabs(screen, tabs, ctx, {barSel, secsSel, tabClass, secClass, badgeClass, idPrefix, initial})`, where `initial(ctx) -> key`, and each `tabs[]` entry is `{key, label, icon, badge(ctx), visible(ctx), build(sec, ctx)}` with `icon` a trusted static SVG string (History passes `HD_TAB_ICONS[key]`, keeping its behavior identical). Everything below depends on this and on nothing else inside the engine — the section lookups here go through the DOM (`.rd-sec[data-sec=…]`, `hidden`, `dataset.loaded`), never through Task 1's per-screen state.

> NOTE: the run model does **not** carry the fields the Overview tab needs. `makeRun` (`app.js:1075-1119`) has no `prompt`, no `branchSource`, no `worktreeDir`, and `onState` (`:1525-1527`) keeps only `msg.branch.feature`. The orchestrator does emit all of them on the `state` snapshot (`this.state.prompt` `src/core/orchestrator.mjs:569`; `this.state.branch = {source, feature, worktreeDir, reusedExisting}` `:379`, `worktreeRemoved` `:1443/1498/1604/1721`), so Step 5 below widens that capture. Tasks 3 (card `base →` chip) and 6 (retained-work banner) need the same fields — **check whether the capture is already present before applying Step 5's edit and skip it if so.**

> NOTE: the three tab bodies reuse History's already-styled `.hd-ov-*` classes (`style.css:1804-1828`) rather than forking them, because `hdStatCard` (`app.js:10447`) hard-codes `hd-ov-card` / `hd-ov-label` / `hd-ov-value` / `hd-ov-sub` and spec §5.7 mandates that builder. Genuinely new markup (`.rd-ov-state`, the Agents grid, the log pane sizing) is namespaced `.rd-*` per spec §9.

- [ ] **Step 1: Write the failing test — tab bar shape, default tab, live log pane**

Create `test/ui-running-detail.test.mjs` with the block below. (If Task 6 already created this file, keep its existing header and append only the `test(...)` blocks from `// --- T7: tabs ---` onward.)

```javascript
// test/ui-running-detail.test.mjs — the Running DETAIL screen: its three tabs
// (Live log / Overview / Agents), the live repaint contract, and the terminal
// state + View-in-History link.
//
// boot()/settle()/go() are a deliberate verbatim copy of
// test/ui-history-detail.test.mjs:25-96 — the suites do not import each other.
//
// Each test gets a fresh DOM + a fresh module import (cache-busted) so module
// top-level state can't leak between cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECT = '/tmp/proj';
const KEY = 'proj-alpha-abcd1234';

async function boot({ fetchHandler, url = 'http://localhost:4317/' } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
  const { window } = dom;

  window.Element.prototype.scrollIntoView = function () {};

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() {
      this.readyState = 1;
      this._listeners = {};
      wsBox.ws = this;
    }
    send() {}
    close() {}
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    }
    dispatch(type, evt) {
      (this._listeners[type] || []).forEach((fn) => fn(evt));
    }
  };

  const calls = [];
  window.fetch = (u, opts) => {
    calls.push({ url: String(u), opts: opts || {} });
    if (fetchHandler) {
      const r = fetchHandler(String(u), opts || {});
      if (r) return r;
    }
    if (String(u).includes('/api/projects')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }),
    });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch {
      /* read-only global already present — leave it */
    }
  }
  globalThis.window = window;
  globalThis.document = window.document;

  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0)); // let loadProjects/loadConfig settle

  return { window, calls, wsBox };
}

async function settle(window, n = 3) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const DAY = 86400000;
const okBudget = (over = {}) => ({
  pipelineLimitUsd: 5, totalLimitUsd: 50, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 12.5, allTimeSpendUsd: 12.5,
  remainingUsd: 37.5, blocked: false, ...over,
});

// One History row for the SAME project, so the View-in-History link can resolve a
// projectKey for a live run (see historyKeyForRun in Task 9).
const HISTORY_ROW = {
  id: 'older1', projectKey: KEY, projectName: 'Alpha', projectDir: PROJECT,
  title: 'An older pipeline', status: 'done', startedAt: '2026-08-18T10:00:00Z',
  mtime: 1, totalCostUsd: 1, totalActiveMs: 1000,
};

async function bootRunning({ budget = okBudget(), rows = [HISTORY_ROW] } = {}) {
  const box = { budget, rows };
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.endsWith('/api/history/pr')) return ok({ ok: true });
      if (url.endsWith('/api/history')) return ok({ pipelines: box.rows, ghAvailable: false });
      if (url.endsWith('/api/budget')) return ok(box.budget);
      return null;
    },
  });
  ctx.box = box;
  frame(ctx, { type: 'hello', runs: [] });
  await settle(ctx.window, 6);
  return ctx;
}

function frame(ctx, msg) {
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
}

const STEPS = () => ([
  { key: 'plan#1', nodeId: 'plan', cycle: 1, status: 'done',
    activeMs: 65000, costUsd: 0.5, skills: ['skill:brainstorming'] },
  { key: 'implement#1', nodeId: 'implement', cycle: 1, status: 'start',
    activeMs: 30000, costUsd: 1.0, graphifyCount: 2 },
]);

const SUBS = () => ([
  { id: 'a1', label: 'Explore repo', nodeId: 'implement', cycle: 1,
    status: 'running', subagentType: 'Explore', startedAt: '2026-08-19T10:01:00Z' },
  { id: 'a2', label: 'Write tests', nodeId: 'implement', cycle: 1,
    status: 'finished', durationMs: 124000, costUsd: 0.0421 },
]);

// Seed one live pipeline and open its detail screen.
async function openRun(ctx, over = {}) {
  frame(ctx, {
    type: 'run-created', runId: 'r1', title: 'Add dark mode', projectDir: PROJECT,
    status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run',
  });
  frame(ctx, {
    type: 'state', runId: 'r1', id: 'p1', status: 'running',
    steps: STEPS(), subAgents: SUBS(), totalCostUsd: 1.5,
    branch: { source: 'main', feature: 'worca-cc/dark-p1', worktreeDir: '/tmp/wt' },
    prompt: 'Add a dark mode toggle to the settings page.',
    ...over,
  });
  frame(ctx, { type: 'phase', runId: 'r1', phase: 'implement', status: 'start', cycle: 1 });
  go(ctx.window, 'running/r1');
  await settle(ctx.window, 6);
  return ctx.window.document.querySelector('#run-detail .rd-header');
}

const secOf = (window, key) => window.document.querySelector(`#run-detail .rd-sec[data-sec="${key}"]`);
const tabOf = (window, key) => window.document.querySelector(`#run-detail .rd-tab[data-sec="${key}"]`);
const rdBox = (window) => window.document.querySelector('#run-detail .rd-sec[data-sec="logs"] .log');
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

// --- T7: tabs ---------------------------------------------------------------

test('the detail has exactly three tabs, Live log first and active by default', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  const tabs = [...window.document.querySelectorAll('#run-detail .rd-tab')];
  assert.deepEqual(tabs.map((b) => b.dataset.sec), ['logs', 'overview', 'agents']);
  assert.match(tabs[0].textContent, /Live log/);
  assert.match(tabs[1].textContent, /Overview/);
  assert.match(tabs[2].textContent, /Agents/);
  assert.ok(tabs[0].classList.contains('active'), 'Live log is the default tab');
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(secOf(window, 'logs').hidden, false);
  assert.equal(secOf(window, 'overview').hidden, true);
  assert.equal(secOf(window, 'agents').hidden, true);
  // D1: no Diff. And no Clarify — a live question is a panel, not a tab.
  assert.equal(window.document.querySelector('#run-detail .rd-tab[data-sec="diff"]'), null);
  assert.equal(window.document.querySelector('#run-detail .rd-tab[data-sec="clarify"]'), null);
  // The Agents pill carries the live sub-agent count.
  assert.equal(tabOf(window, 'agents').querySelector('.rd-tab-badge').textContent, '2');
});

test('the Live log tab is the CARD pipeline: bar, switch, hydrated lines, shared filter', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  frame(ctx, { type: 'log', runId: 'r1', source: 'planner', level: 'info', text: 'pass one', ts: 0, stepIndex: 0, cycle: 1 });
  frame(ctx, { type: 'log', runId: 'r1', source: 'implementer', level: 'warn', text: '429, retrying', ts: 0, stepIndex: 1, cycle: 1 });
  await settle(window);

  const sec = secOf(window, 'logs');
  assert.ok(sec.classList.contains('rd-sec-logs'));
  // D9: the shared bar, cloned from #run-card-tpl — same controls in the same order.
  const bar = sec.querySelector('.log-filters');
  assert.ok(bar, 'the detail carries the shared filter bar');
  assert.deepEqual(
    [...bar.querySelectorAll('.log-f')].map((n) => n.classList[1]),
    ['log-f-source', 'log-f-level', 'log-f-step', 'log-f-cycle', 'log-search', 'log-copy']);
  assert.ok(sec.querySelector('.switch.autoscroll'), 'the auto-scroll switch rides along');
  // Lines come from r.logLines, not from a fetch: no /log request was made.
  assert.equal(ctx.calls.filter((c) => c.url.endsWith('/log')).length, 0);
  assert.equal(sec.querySelectorAll('.log .log-line').length, 2);
  // Facets are populated from the lines seen so far.
  assert.deepEqual([...bar.querySelector('.log-f-source').options].map((o) => o.value),
    ['', 'implementer', 'planner']);

  // The filter is the RUN's own object, so the card and the detail share one.
  const source = bar.querySelector('.log-f-source');
  source.value = 'planner';
  source.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(window);
  const r = window.__np.getRun('r1');
  assert.equal(r.logFilter.source, 'planner');
  assert.equal(sec.querySelectorAll('.log .log-line').length, 1);
  assert.match(sec.querySelector('.log .log-line').textContent, /pass one/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs`
Expected: FAIL with `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal: [] !== [ 'logs', 'overview', 'agents' ]` — `#run-detail .rd-tab` matches nothing because `initRdTabs` does not exist yet.

- [ ] **Step 3: Implement the tab table, the context, and the Live log builder**

Insert this block into `ui/public/app.js` between line 10728 (`}` closing `buildHdLogs`) and line 10730 (`// Escape on the History detail screen navigates back…`).

```javascript
// ---------------------------------------------------------------------------
// Running detail: section tabs (spec §5.5-§5.8)
// ---------------------------------------------------------------------------

// The statuses that end a run for the detail screen. NOT isTerminalStatus
// (app.js:4290): that set also contains 'interrupted', which the Running view
// renders as a PAUSE (amber pause bars, resumable) — folding it in here would
// hide Pause/Stop on a run the user can still resume.
const RD_TERMINAL = ['done', 'stopped', 'error'];

// The one context object every RD_TABS callback receives. Deliberately just the
// run plus its screen: the table is re-consulted on every live frame, so anything
// cached in here would go stale between builds.
function rdCtx(r) {
  return { run: r, screen: (runDetailState && runDetailState.screen) || null };
}

// THREE tabs, Live log first and default (§5.5). No Diff (D1 — a live run has no
// persisted patch and no live-diff endpoint is added) and no Clarify (a live
// question renders as a panel above the tabs, not as a tab).
const RD_TABS = [
  {
    key: 'logs', label: 'Live log', icon: HD_TAB_ICONS.logs,
    badge: () => null, visible: () => true,
    build: (sec, ctx) => buildRdLogs(sec, ctx),
  },
  {
    key: 'overview', label: 'Overview', icon: HD_TAB_ICONS.overview,
    badge: () => null, visible: () => true,
    build: (sec, ctx) => buildRdOverview(sec, ctx),
  },
  {
    key: 'agents', label: 'Agents', icon: HD_TAB_ICONS.agents,
    badge: (ctx) => {
      const n = Array.isArray(ctx.run.subAgents) ? ctx.run.subAgents.length : 0;
      return n ? String(n) : null;
    },
    visible: () => true,
    build: (sec, ctx) => buildRdAgents(sec, ctx),
  },
];

// Build the pill row + the three lazy panels into an open detail screen. Called
// once per screen build; live frames go through rdUpdateSections (Task 8), never
// through a rebuild.
function initRdTabs(screen, r) {
  initDetailTabs(screen, RD_TABS, rdCtx(r), {
    barSel: '.rd-tabs',
    secsSel: '.rd-sections',
    tabClass: 'rd-tab',
    secClass: 'rd-sec',
    badgeClass: 'rd-tab-badge',
    idPrefix: 'rd',
    initial: () => 'logs',
  });
}

// ── Live log tab ────────────────────────────────────────────────────────────
// The CARD's live pipeline, not History's fetch-once loadLiveLogs (app.js:8997):
// lines already sit in r.logLines, new ones arrive through the log fast path
// (§5.9), and the filter state IS r.logFilter — the same object the card reads —
// so the two surfaces stay in lockstep and hopping between them never resets a
// filter. The card's helpers key their DOM off r.el, so these are rooted at the
// section instead and keep their own render cursor on it.

function rdLogBox(sec) { return sec ? sec.querySelector('.log') : null; }

// Pin to the bottom when auto-scroll is on. Twin of maybeAutoscrollLog (3745).
function rdAutoscrollLog(sec, r) {
  if (!r || r.autoscroll === false) return;
  const box = rdLogBox(sec);
  if (box) box.scrollTop = box.scrollHeight;
}

// Full re-render of the detail's pane from r.logLines through r.logFilter. Twin
// of repaintFilteredLog (3873) — same fragment, same DOM cap, same placeholder,
// same frozen-viewport rule when auto-scroll is off.
//
// The render cursor lives on the SECTION, not on r._lastRenderedCycle: onLog
// advances the run-level cursor for the CARD first, so a detail append reading it
// would find rec.cycle already "rendered" and silently drop the cycle separator.
function rdRepaintLog(sec, r) {
  const box = rdLogBox(sec);
  if (!box) return;
  const savedTop = box.scrollTop;
  box.innerHTML = '';
  delete box.dataset.empty;
  const visible = compileLogFilter(r.logFilter);
  const frag = document.createDocumentFragment();
  let shown = 0;
  let prevCycle = null;
  for (const rec of r.logLines) {
    if (!visible(rec)) continue;
    prevCycle = appendLogRec(frag, rec, prevCycle);
    shown++;
  }
  box.appendChild(frag);
  sec._lastCycle = prevCycle;
  trimLogDom(box);
  if (shown === 0 && r.logLines.length) {
    box.textContent = '(no lines match the filter)';
    box.dataset.empty = '1';
  }
  rdAutoscrollLog(sec, r);
  if (r.autoscroll === false && savedTop) box.scrollTop = savedTop;
}

// (Re)fill the detail's four dropdowns and memoize the facet key set ON THE
// SECTION. r._logFacetKeys belongs to the card's maybePaintLogFilters (3852) and
// is already up to date by the time a log frame reaches the detail, so sharing it
// would leave this bar permanently stale — History's build-once facet fill
// (loadLiveLogs:9034-9038) is the same bug from the other direction.
// Returns paintLogFilters' repaint flag (true when it repainted the pane itself).
function rdPaintLogFilters(sec, r) {
  const repainted = paintLogFilters(r, sec);
  sec._logFacetKeys = r._logFacetKeys;
  return repainted;
}

// Cheap per-line facet check (twin of maybePaintLogFilters, 3852): rebuild the
// dropdowns only when THIS record introduces a value they do not offer yet, so a
// 4000-line model is not re-scanned per arriving line.
function rdMaybePaintLogFilters(sec, r, rec) {
  const seen = sec._logFacetKeys;
  if (!seen) return rdPaintLogFilters(sec, r);
  for (const k of facetKeys(logFacets([rec]))) {
    if (!seen.has(k)) return rdPaintLogFilters(sec, r);
  }
  return false;
}

// The four control listeners, bound once per section element (see buildRdLogs).
function rdWireLogControls(sec, r) {
  sec.addEventListener('change', (e) => {
    if (!(e.target.closest && e.target.closest('select.log-f'))) return;
    r.logFilter = readLogFilterFrom(sec, r.logFilter.search || '');
    rdRepaintLog(sec, r);
  });
  // Debounced like the card's: `input` fires per keystroke and each repaint
  // rebuilds every visible line.
  sec.addEventListener('input', (e) => {
    if (!(e.target.closest && e.target.closest('.log-search'))) return;
    scheduleLogSearch(sec, () => {
      r.logFilter = readLogFilterFrom(sec, r.logFilter.search || '');
      rdRepaintLog(sec, r);
    });
  });
  const flip = () => {
    setAutoscroll(r, r.autoscroll === false);   // model + the card's switch
    syncAutoscrollSwitch(r, sec);               // …and this screen's switch
    rdAutoscrollLog(sec, r);
  };
  sec.addEventListener('click', (e) => {
    const copy = e.target.closest && e.target.closest('.log-copy');
    if (copy) { copyLogToClipboard(copy, r.logLines.filter(compileLogFilter(r.logFilter))); return; }
    if (e.target.closest && e.target.closest('.switch.autoscroll')) flip();
  });
  // a11y twin of the click path: the switch is role="switch" + tabindex="0".
  sec.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (!(e.target.closest && e.target.closest('.switch.autoscroll'))) return;
    e.preventDefault();
    flip();
  });
}

function buildRdLogs(sec, ctx) {
  const r = ctx.run;
  sec.innerHTML = '';
  sec.classList.add('rd-sec-logs');

  const block = document.createElement('div');
  block.className = 'run-log';
  const head = document.createElement('div');
  head.className = 'run-log-head';
  const label = document.createElement('span');
  label.className = 'll-label';
  label.textContent = 'Live log';
  // D9: the ONE filter-bar markup, cloned from #run-card-tpl, so the detail's
  // controls can never drift from the card's.
  const bar = buildLogFilterBar();
  // Same single-source rule for the switch: clone it rather than re-typing the
  // role/aria-checked/tabindex triple that makes it operable.
  const sw = document.getElementById('run-card-tpl').content
    .querySelector('.run-log-head .switch-row').cloneNode(true);
  head.append(label, bar, sw);
  const box = document.createElement('div');
  box.className = 'log';
  block.append(head, box);
  sec.appendChild(block);

  // The clone's search box is born empty; mirror the run's stored term so the
  // visible bar matches the filter the hydration below actually applies
  // (buildRunCard:10981 does exactly this for the card).
  const searchBox = bar.querySelector('.log-search');
  if (searchBox) searchBox.value = r.logFilter.search || '';
  syncAutoscrollSwitch(r, sec);
  rdRepaintLog(sec, r);
  rdPaintLogFilters(sec, r);

  // The card's log controls are DELEGATED on #run-list (app.js:7989-8064) and the
  // detail screen is not inside it, so this screen binds its own.
  //
  // ONCE per section ELEMENT, not once per build: rdUpdateSections re-arms a
  // hidden section by clearing dataset.loaded, so this builder runs again on every
  // tab re-activation — and `sec.innerHTML = ''` above wipes the CHILDREN, not the
  // listeners bound to `sec` itself. Without the guard each re-activation would add
  // another copy of all four and one keystroke would run N repaints.
  //
  // Closing over `r` is safe despite binding once: a section is only ever rebuilt
  // for the SAME run — a detail->detail hop rebuilds the whole screen from
  // #run-detail-tpl (§5.1), so the new run gets brand-new section nodes.
  if (sec.dataset.wired !== '1') {
    sec.dataset.wired = '1';
    rdWireLogControls(sec, r);
  }

  // Lines arrive through the log fast path (§5.9), never through __update:
  // re-rendering up to MAX_LOG_LINES nodes on every `state` frame is exactly the
  // jank the incremental append exists to avoid. All __update owes is the switch,
  // which setAutoscroll may have flipped from the card.
  sec.__update = (c) => { syncAutoscrollSwitch(c.run, sec); };
}
```

Then export the new seams — replace `ui/public/app.js:2743` (`    seedResumedLog,`) with:

```javascript
    seedResumedLog,
    RD_TABS,
    RD_TERMINAL,
    rdCtx,
    initRdTabs,
    buildRdLogs,
    buildRdOverview,
    buildRdAgents,
    rdRepaintLog,
    rdMaybePaintLogFilters,
```

Finally, call the engine from the screen build. Locate the call site with
`grep -n "function openRunDetail" -A 40 ui/public/app.js` and add `initRdTabs(screen, r);` immediately **before** Task 5's initial `paintRunDetail(r);` inside `openRunDetail`, so the section elements exist before anything tries to update them:

```javascript
  initRdTabs(screen, r);
  paintRunDetail(r);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs`
Expected: PASS — 2 tests.

- [ ] **Step 5: Write the failing Overview test**

Append to `test/ui-running-detail.test.mjs`:

```javascript
// --- T7: Overview -----------------------------------------------------------

test('Overview shows the current-state banner and exactly three stat cards', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  click(window, tabOf(window, 'overview'));
  await settle(window);
  const sec = secOf(window, 'overview');

  const banner = sec.querySelector('.rd-ov-state');
  assert.ok(banner, 'the current-state banner renders');
  assert.equal(banner.querySelector('.rd-ov-chip').textContent, 'Implement');
  assert.equal(banner.querySelector('.rd-ov-copy').textContent, 'Implement is running.');

  const cards = [...sec.querySelectorAll('.hd-ov-grid .hd-ov-card')];
  assert.equal(cards.length, 3, 'D10: three cards, no MODEL card');
  assert.deepEqual(cards.map((c) => c.querySelector('.hd-ov-label').textContent),
    ['ELAPSED', 'COST SO FAR', 'WORKTREE']);
  // liveTotalMs sums the two steps' activeMs (65000 + 30000).
  assert.equal(cards[0].querySelector('.hd-ov-value').textContent, '1m 35s');
  assert.ok(cards[0].querySelector('.hd-ov-value').classList.contains('run-time'),
    'the ELAPSED value node is tagged for the 1 s interval');
  // runStepLabel (Task 3) against CLIENT_DEFAULT_STEPPER: 7 nodes
  // (preflight/clarify/plan/refine/implement/review/done), frontier = implement = 5th.
  assert.equal(cards[0].querySelector('.hd-ov-sub').textContent, 'step 5/7 · Implement');
  assert.equal(cards[1].querySelector('.hd-ov-value').textContent, '$1.50');
  assert.match(cards[1].querySelector('.hd-ov-value').title, /Estimated cost \$1\.5000/);
  assert.equal(cards[1].querySelector('.hd-ov-sub').textContent, 'cap $5.00 per pipeline');
  assert.equal(cards[2].querySelector('.hd-ov-value').textContent, 'active');
  assert.equal(cards[2].querySelector('.hd-ov-sub').textContent, '/tmp/wt');
});

test('the COST sub-line reads "across N steps" when no per-pipeline cap is set', async () => {
  const ctx = await bootRunning({ budget: okBudget({ pipelineLimitUsd: null }) });
  await openRun(ctx);
  const { window } = ctx;
  click(window, tabOf(window, 'overview'));
  await settle(window);
  const cards = [...secOf(window, 'overview').querySelectorAll('.hd-ov-grid .hd-ov-card')];
  assert.equal(cards[1].querySelector('.hd-ov-sub').textContent, 'across 2 steps');
});

test('Overview banner copy follows the run state', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  click(window, tabOf(window, 'overview'));
  await settle(window);
  const copy = () => secOf(window, 'overview').querySelector('.rd-ov-copy').textContent;

  frame(ctx, { type: 'phase', runId: 'r1', phase: 'review', status: 'start', cycle: 2 });
  await settle(window);
  assert.equal(copy(), 'Review is running · cycle 2.');

  frame(ctx, {
    type: 'question', runId: 'r1', id: 'q1', kind: 'clarify',
    questions: [{ id: 'q1a', question: 'Which theme?', options: ['dark', 'light', ''] }],
  });
  await settle(window);
  assert.equal(copy(), 'Parked on Review until the questions above are answered.');

  frame(ctx, { type: 'question-resolved', runId: 'r1', id: 'q1', reason: 'resolved' });
  frame(ctx, { type: 'state', runId: 'r1', id: 'p1', status: 'paused', steps: STEPS() });
  await settle(window);
  assert.equal(copy(),
    'Paused by you. Agents in flight finished their checkpoint; nothing new is dispatched.');
});

test('the Task card shows the prompt with a Show more expander past 600 chars', async () => {
  const ctx = await bootRunning();
  const long = 'x'.repeat(650);
  await openRun(ctx, { prompt: long });
  const { window } = ctx;
  click(window, tabOf(window, 'overview'));
  await settle(window);
  const task = secOf(window, 'overview').querySelector('.hd-ov-task');
  assert.equal(task.querySelector('.hd-ov-task-h').textContent, 'Task');
  assert.equal(task.querySelector('p').textContent.length, 601);      // 600 + the ellipsis
  const more = task.querySelector('.hd-ov-more');
  assert.equal(more.textContent, 'Show more');
  click(window, more);
  assert.equal(task.querySelector('p').textContent, long);
  assert.equal(task.querySelector('.hd-ov-more'), null, 'the expander removes itself');
  assert.deepEqual([...task.querySelectorAll('.hd-ov-tag')].map((c) => c.textContent),
    ['proj', 'main', '2 sub-agents']);
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs`
Expected: FAIL with `AssertionError [ERR_ASSERTION]: the current-state banner renders` — `buildRdOverview` is not defined, so `initDetailTabs` leaves the panel empty.

- [ ] **Step 7: Implement the Overview builder (and widen the `onState` capture)**

First, replace `ui/public/app.js:1525-1527`:

```javascript
  if (msg && msg.branch && msg.branch.feature) {
    r.branchFeature = msg.branch.feature;
  }
```

with:

```javascript
  // The branch record and the prompt are what the detail's row 3, retained-work
  // banner and Overview tab read (§5.2, §5.7). Field-by-field and guarded: a
  // pre-_setupRunRoot snapshot carries `branch: null`, and a later snapshot may
  // omit a field it already reported — never clobber a known value with undefined.
  if (msg && msg.branch && typeof msg.branch === 'object') {
    if (msg.branch.feature) r.branchFeature = msg.branch.feature;
    if (msg.branch.source) r.branchSource = msg.branch.source;
    if (msg.branch.worktreeDir) r.worktreeDir = msg.branch.worktreeDir;
    if (msg.branch.worktreeRemoved !== undefined) r.worktreeRemoved = msg.branch.worktreeRemoved;
  }
  // state.prompt is stamped after createPipeline (orchestrator.mjs:569), so the
  // first snapshots have none; keep the last non-empty value.
  if (typeof msg.prompt === 'string' && msg.prompt) r.prompt = msg.prompt;
```

Then append the Overview builder to the `.rd-*` block added in Step 3 (after `buildRdLogs`):

```javascript
// ── Overview tab ────────────────────────────────────────────────────────────

// One line of current-state copy (§5.7). Every arm is a fact the run model
// already carries — nothing here is inferred or invented.
function rdStateCopy(r, stepName) {
  const step = stepName || 'this step';
  if (r.pendingQuestion != null) return `Parked on ${step} until the questions above are answered.`;
  // The cost arms reuse the banner's own wording (stats-view.mjs:254/268) so the
  // Overview line and the banner above the graph never disagree.
  if (r.pauseReason === 'cost_pipeline') return 'Paused — pipeline cost limit reached.';
  if (r.pauseReason === 'cost_total') return 'Paused — total budget reached.';
  if (r.status === 'paused' || r.status === 'pausing' || r.status === 'interrupted') {
    return 'Paused by you. Agents in flight finished their checkpoint; nothing new is dispatched.';
  }
  if (RD_TERMINAL.includes(r.status)) {
    // finishedAtMs is stamped by finishRun (Task 9). Absent on a run this tab
    // never saw finish (hello-seeded lingerer) -> the sentence is simply omitted
    // rather than guessed from startedAt.
    const at = r.finishedAtMs
      ? ` Finished at ${startedLabel(new Date(r.finishedAtMs).toISOString())}.`
      : '';
    return `${runStatusMeta(r).word}.${at}`;
  }
  const cyc = Number(r.cycle) || 0;
  return `${step} is running${cyc > 1 ? ` · cycle ${cyc}` : ''}.`;
}

function rdOvStateBanner(host, r) {
  host.innerHTML = '';
  const { n, m, name } = runStepLabel(r);
  const chip = document.createElement('span');
  chip.className = `rd-ov-chip st-${runStatusMeta(r).family}`;
  chip.textContent = name || `step ${n}/${m}`;
  const copy = document.createElement('span');
  copy.className = 'rd-ov-copy';
  copy.textContent = rdStateCopy(r, name);
  host.append(chip, copy);
}

function rdOvStats(host, r) {
  host.innerHTML = '';
  const { n, m, name } = runStepLabel(r);
  const stepSub = `step ${n}/${m}${name ? ` · ${name}` : ''}`;

  const elapsed = hdStatCard('elapsed', 'ELAPSED',
    fmtDuration(liveTotalMs(r.steps, Date.now())) || '0s', stepSub);
  // `.run-time` is the class the 1 s interval (app.js:11789) writes, so tagging
  // the value node makes this card tick with the header and the graph — one
  // timer, no second interval to drift against it (§11).
  elapsed.querySelector('.hd-ov-value').classList.add('run-time');
  host.appendChild(elapsed);

  const steps = Array.isArray(r.steps) ? r.steps : [];
  // The per-pipeline cap comes from the SAME budget record renderCostPauseBanner
  // consumes (budgetState.budget, app.js:339; the field is budgetStatus()'s
  // pipelineLimitUsd, src/core/cost-budget.mjs:84/92) — i.e. the value that drives
  // pauseReason 'cost_pipeline'. null/absent means no cap is configured, and the
  // sub-line falls back to a fact rather than a fabricated number.
  const cap = Number(budgetState.budget && budgetState.budget.pipelineLimitUsd);
  const costSub = Number.isFinite(cap) && cap > 0
    ? `cap ${fmtUsd(cap)} per pipeline`
    : `across ${steps.length} step${steps.length === 1 ? '' : 's'}`;
  const cost = hdStatCard('cost', 'COST SO FAR', fmtUsd(r.totalCostUsd || 0), costSub);
  cost.querySelector('.hd-ov-value').title = estTitle(r.totalCostUsd || 0);
  host.appendChild(cost);

  // Tri-state, exactly like History's card (10520-10527): absent while the run
  // holds the worktree, true after teardown, explicitly false on the
  // commit-failure path. `!== true` is the correct test for all three.
  const held = !!r.worktreeDir && r.worktreeRemoved !== true;
  host.appendChild(hdStatCard('worktree', 'WORKTREE', held ? 'active' : 'released', r.worktreeDir || ''));
}

function rdOvTask(r) {
  const task = document.createElement('div');
  task.className = 'hd-ov-task';
  const h = document.createElement('div');
  h.className = 'hd-ov-task-h';
  h.textContent = 'Task';
  task.appendChild(h);
  const prompt = String(r.prompt || '').trim();
  const p = document.createElement('p');
  const LIMIT = 600;
  if (prompt.length > LIMIT) {
    p.textContent = prompt.slice(0, LIMIT) + '…';
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'hd-ov-more';
    more.textContent = 'Show more';
    more.addEventListener('click', () => { p.textContent = prompt; more.remove(); });
    task.append(p, more);
  } else {
    p.textContent = prompt || '(no prompt recorded)';
    task.appendChild(p);
  }
  const chips = document.createElement('div');
  chips.className = 'hd-ov-chips';
  const subCount = Array.isArray(r.subAgents) ? r.subAgents.length : 0;
  // A workspace run carries NO projectDir (the New form sends workspaceId
  // instead, app.js:6366-6379) — name it by its member list rather than letting
  // projectName() print "(no project)".
  const project = r.projectDir
    ? projectName(r.projectDir)
    : (Array.isArray(r.projectNames) ? r.projectNames.join(' · ') : '');
  for (const text of [project, r.branchSource || '', subCount ? `${subCount} sub-agent${subCount === 1 ? '' : 's'}` : '']) {
    if (!text) continue;
    const c = document.createElement('span');
    c.className = 'hd-ov-tag mono';
    c.textContent = text;
    chips.appendChild(c);
  }
  task.appendChild(chips);
  return task;
}

function buildRdOverview(sec, ctx) {
  sec.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'hd-ov';
  const banner = document.createElement('div');
  banner.className = 'rd-ov-state';
  const grid = document.createElement('div');
  grid.className = 'hd-ov-grid';
  // The Task card is built ONCE and never re-rendered: the prompt cannot change
  // mid-run, and rebuilding it would slam the "Show more" expander shut under the
  // user on every arriving `state` frame.
  wrap.append(banner, grid, rdOvTask(ctx.run));
  sec.appendChild(wrap);
  const paint = (c) => { rdOvStateBanner(banner, c.run); rdOvStats(grid, c.run); };
  paint(ctx);
  sec.__update = paint;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs`
Expected: PASS — 6 tests.

- [ ] **Step 9: Write the failing Agents test**

Append to `test/ui-running-detail.test.mjs`:

```javascript
// --- T7: Agents -------------------------------------------------------------

test('Agents groups by main agent and renders the live-state column', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  click(window, tabOf(window, 'agents'));
  await settle(window);
  const sec = secOf(window, 'agents');

  const groups = [...sec.querySelectorAll('.rd-ag-group')];
  assert.equal(groups.length, 2, 'one card per MAIN agent that ran');
  assert.deepEqual(groups.map((g) => g.querySelector('.rd-ag-head b').textContent),
    ['Plan', 'Implement']);

  // Plan spawned nothing: its header still carries its own step status + skills.
  assert.equal(groups[0].querySelector('.rd-ag-meta').textContent, 'cycle 1');
  assert.equal(groups[0].querySelector('.subs-stat').textContent, 'done');
  assert.equal(groups[0].querySelector('.skill-pill.is-skill').textContent, 'brainstorming');
  assert.equal(groups[0].querySelector('.rd-ag-none').textContent, 'No sub-agents spawned');

  // Implement: meta sums only the rows that carry values; graphify pill survives.
  assert.equal(groups[1].querySelector('.rd-ag-meta').textContent, 'cycle 1 · 2m 4s · $0.0421');
  assert.equal(groups[1].querySelector('.graphify-pill').textContent, 'graphify ×2');
  assert.equal(groups[1].querySelector('.subs-stat').textContent, 'running');

  const rows = [...groups[1].querySelectorAll('.rd-ag-row')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.rd-ag-label').textContent, 'Explore repo');
  assert.equal(rows[0].querySelector('.agent-type-pill').textContent, 'Explore');
  assert.ok(rows[0].querySelector('.rd-ag-dot').classList.contains('run'));
  assert.equal(rows[0].querySelector('.rd-ag-state').textContent, 'running');
  assert.equal(rows[0].querySelector('.rd-ag-dur').textContent, '');
  assert.equal(rows[0].querySelector('.rd-ag-cost').textContent, '');
  assert.equal(rows[1].querySelector('.rd-ag-state').textContent, 'finished');
  assert.ok(rows[1].querySelector('.rd-ag-dot').classList.contains('done'));
  assert.equal(rows[1].querySelector('.rd-ag-dur').textContent, '2m 4s');
  assert.equal(rows[1].querySelector('.rd-ag-cost').textContent, '$0.0421');
  // No invented vocabulary: the stream only ever emits running|finished|error.
  assert.equal(sec.textContent.includes('queued'), false);
});

test('Agents renders the empty state when nothing has been recorded', async () => {
  const ctx = await bootRunning();
  frame(ctx, {
    type: 'run-created', runId: 'r2', title: 'Fresh run', projectDir: PROJECT,
    status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run',
  });
  go(ctx.window, 'running/r2');
  await settle(ctx.window, 6);
  click(ctx.window, tabOf(ctx.window, 'agents'));
  await settle(ctx.window);
  assert.equal(secOf(ctx.window, 'agents').querySelector('.rd-ag-empty').textContent,
    '(no sub-agents recorded)');
  assert.equal(tabOf(ctx.window, 'agents').querySelector('.rd-tab-badge'), null,
    'no badge when there are no sub-agents');
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs`
Expected: FAIL with `AssertionError [ERR_ASSERTION]: one card per MAIN agent that ran: 0 !== 2` — `buildRdAgents` is not defined.

- [ ] **Step 11: Implement the Agents builder**

Append to the `.rd-*` block in `ui/public/app.js` (after `buildRdOverview`):

```javascript
// ── Agents tab ──────────────────────────────────────────────────────────────

// The state word a sub-agent row shows. The `subagent` stream carries exactly
// 'running' (orchestrator.mjs:3192), 'finished' | 'error' (:3218) and onSubagent's
// finish default (app.js:1604) — nothing else. So those are the words rendered:
// the mockup's `queued` is absent because no frame can produce it, and no
// scheduling concept is invented for it. An unrecognized value prints verbatim
// rather than being dropped or renamed; the FAMILY still comes from subRowStatus
// (11101) so the colour vocabulary matches the rest of the app.
const RD_SUB_WORDS = { running: 'running', finished: 'finished', error: 'error', stopped: 'stopped' };
function rdSubState(status) {
  const raw = status == null ? '' : String(status);
  return { word: RD_SUB_WORDS[raw] || raw, family: subRowStatus(raw) };
}

function rdAgentsBody(sec, r) {
  sec.innerHTML = '';
  const groups = subsGroupsForRender(r.subAgents, r.steps, r.stepper);
  const keys = Object.keys(groups);
  if (!keys.length) {
    const empty = document.createElement('div');
    empty.className = 'hint rd-ag-empty';
    empty.textContent = '(no sub-agents recorded)';
    sec.appendChild(empty);
    return;
  }
  const labelOf = cycleAwareLabel(r.stepper, r.subAgents, keys);
  const skillsByGroup = stepSkillsFromSteps(r.steps);
  const graphifyByGroup = stepGraphifyFromSteps(r.steps);
  const statusOf = stepStatusByKey(r.steps, r.stepper);

  for (const key of keys) {
    const list = Array.isArray(groups[key]) ? groups[key] : [];
    const card = document.createElement('div');
    card.className = 'rd-ag-group';
    // Non-empty: roll up from the rows. Empty: the main agent's own step status —
    // subGroupStatus would report a bare 'done' for an agent still in flight.
    const gstat = list.length ? subGroupStatus(list) : (statusOf[key] || 'run');
    const durSum = list.reduce((n, s) => n + (hdSubDuration(s) || 0), 0);
    const costSum = list.reduce((n, s) => n + (Number(s && s.costUsd) || 0), 0);
    const cycle = Number(String(key).slice(String(key).indexOf(CYCLE_KEY_SEP) + 1)) || 0;
    const metaBits = [
      `cycle ${cycle}`,
      durSum ? fmtDuration(durSum) : '',
      costSum ? fmtUsd4(costSum) : '',
    ].filter(Boolean).join(' · ');
    const head = document.createElement('div');
    head.className = 'rd-ag-head';
    // Skill + graphify pills are kept here so nothing the removed .subs-bar
    // showed (spec §7) is lost. skillPillsHtml goes LAST, exactly as
    // renderSubsTree and buildHdAgents emit it — the pill block claims a full row
    // of its own, so a mid-header block would push the meta onto a second line.
    head.innerHTML =
      `<b>${escapeHtml(labelOf(key))}</b>` +
      `<span class="subs-stat ${gstat}">${SUBS_STAT_TEXT[gstat] || gstat}</span>` +
      graphifyCountPillHtml(graphifyByGroup[key]) +
      `<span class="rd-ag-meta mono">${escapeHtml(metaBits)}</span>` +
      skillPillsHtml(skillsByGroup[key]);
    card.appendChild(head);
    if (!list.length) {
      const note = document.createElement('div');
      note.className = 'hint rd-ag-none';
      note.textContent = 'No sub-agents spawned';
      card.appendChild(note);
    }
    for (const s of list) {
      const st = rdSubState(s && s.status);
      const dur = hdSubDuration(s);
      const row = document.createElement('div');
      row.className = 'rd-ag-row';
      row.innerHTML =
        `<span class="rd-ag-name">` +
          `<span class="rd-ag-dot ${st.family}"></span>` +
          `<span class="rd-ag-label">${escapeHtml((s && s.label) || (s && s.id) || '')}</span>` +
          agentTypePillHtml(s && s.subagentType) +
          graphifyCountPillHtml(s && s.graphifyCount) +
        `</span>` +
        `<span class="rd-ag-state ${st.family}">${escapeHtml(st.word)}</span>` +
        `<span class="rd-ag-dur mono">${dur != null ? escapeHtml(fmtDuration(dur)) : ''}</span>` +
        `<span class="rd-ag-cost mono">${s && s.costUsd != null ? escapeHtml(fmtUsd4(s.costUsd)) : ''}</span>` +
        skillPillsHtml(s && s.skills);
      card.appendChild(row);
    }
    sec.appendChild(card);
  }
}

function buildRdAgents(sec, ctx) {
  // A handful of cards with a handful of rows — a full rebuild is cheaper than
  // reconciling, and the section itself does not scroll (the screen does), so
  // nothing is lost by replacing it wholesale on every live frame.
  const paint = (c) => rdAgentsBody(sec, c.run);
  paint(ctx);
  sec.__update = paint;
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs`
Expected: PASS — 8 tests.

- [ ] **Step 13: Style the three tab bodies**

Extend the three shared pill selector lists in place (never duplicated — a bare appended rule would tie on specificity and still lose to the existing ancestor scope). Replace `ui/public/style.css:1195-1198` with:

```css
.hd-ag-head .subs-stat,.rd-ag-head .subs-stat,.subs-step-head .subs-stat{font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:999px;letter-spacing:.02em;text-transform:uppercase;}
.hd-ag-head .subs-stat.run,.rd-ag-head .subs-stat.run,.subs-step-head .subs-stat.run{background:var(--blue-bg);color:var(--blue-ink);}
.hd-ag-head .subs-stat.done,.rd-ag-head .subs-stat.done,.subs-step-head .subs-stat.done{background:var(--green-bg);color:var(--green-ink);}
.hd-ag-head .subs-stat.stop,.rd-ag-head .subs-stat.stop,.subs-step-head .subs-stat.stop{background:var(--red-bg);color:var(--red-ink);}
```

Replace `ui/public/style.css:1222` with:

```css
.hd-ag-head .subs-skills,.hd-ag-row .subs-skills,.rd-ag-head .subs-skills,.subs-tree li .subs-skills{flex:0 0 100%;margin-top:6px;}  /* own full row, aligned under .ag-name */
```

Replace `ui/public/style.css:1238` with:

```css
.hd-ag-row .agent-type-pill,.rd-ag-name .agent-type-pill,.subs-tree li .agent-type-pill{font-size:10.5px;font-weight:700;letter-spacing:.01em;padding:2px 9px;border-radius:999px;white-space:nowrap;background:var(--violet-bg);color:var(--violet-ink);}
```

Then append to the end of `ui/public/style.css` (after line 1984):

```css

/* ---------- Running detail: tab bodies ---------- */
/* style.css has NO base .mono rule (see the comment at :1605) — scope one to the
   detail screen so `class="mono"` there is not silently rendered in Poppins. */
#run-detail .mono{font-family:var(--mono);}

/* Live log tab (§5.6). The pane is the shared `.log` markup, so only its size
   differs from the card's. `.run-log .log` (:605) is (0,2,0) and so is this —
   source order is what makes it win, which is why the rule lives at the END of
   the file and must not be moved above :605. */
.rd-sec-logs .log{min-height:300px;max-height:520px;}

/* Overview tab (§5.7). The stat cards, the task card and the chips deliberately
   reuse History's `.hd-ov-*` rules (:1804-:1828) — hdStatCard emits those class
   names, so re-declaring them here would fork one card design into two. Only the
   current-state banner is new. */
.rd-ov-state{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:16px 20px;
  background:var(--panel);border:1px solid var(--line);border-radius:var(--r-card);}
.rd-ov-chip{padding:5px 12px;border-radius:999px;font:600 11.5px var(--sans);
  background:var(--field);color:var(--ink-2);}
.rd-ov-chip.st-blue{background:var(--blue-bg);color:var(--blue-ink);}
.rd-ov-chip.st-amber{background:var(--amber-bg);color:var(--amber-ink);}
.rd-ov-chip.st-green{background:var(--green-bg);color:var(--green-ink);}
.rd-ov-chip.st-red{background:var(--red-bg);color:var(--red-ink);}
.rd-ov-copy{min-width:0;font:400 13px var(--sans);color:var(--ink-2);}

/* Agents tab (§5.8). History's card shell, but the spec's four-column GRID row
   instead of its flex row — which is why these carry their own class names
   rather than extending `.hd-ag-*`. */
.rd-ag-group{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-card);overflow:hidden;}
.rd-ag-group + .rd-ag-group{margin-top:14px;}
.rd-ag-head{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:15px 20px;
  border-bottom:1px solid var(--line);}
.rd-ag-head b{font-size:13.5px;font-weight:600;letter-spacing:-.01em;}
.rd-ag-meta{color:var(--ink-3);font-size:11.5px;margin-left:auto;}
.rd-ag-none{padding:12px 20px;}
.rd-ag-row{display:grid;grid-template-columns:1fr 130px 96px 84px;align-items:center;gap:10px;
  padding:12px 20px;border-top:1px solid var(--line);}
/* NOT `:first-of-type` — `.rd-ag-head` is the first div in the card, so no row
   would ever match it (same trap the `.hd-ag-head + .hd-ag-row` rule at :1843
   documents). */
.rd-ag-head + .rd-ag-row{border-top:none;}
.rd-ag-name{display:flex;align-items:center;gap:9px;min-width:0;font:500 13px var(--sans);color:var(--ink);}
.rd-ag-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.rd-ag-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;background:var(--ink-3);}
.rd-ag-dot.run{background:var(--blue);animation:wr-pulse 1.6s ease-in-out infinite;}
.rd-ag-dot.done{background:var(--green);}
.rd-ag-dot.stop{background:var(--red);}
.rd-ag-state{font:500 12px var(--sans);}
.rd-ag-state.run{color:var(--blue-ink);}
.rd-ag-state.done{color:var(--green-ink);}
.rd-ag-state.stop{color:var(--red-ink);}
.rd-ag-dur,.rd-ag-cost{text-align:right;font-size:11.5px;color:var(--ink-2);}
/* skillPillsHtml emits `.subs-skills` into the head AND every row; in a grid row
   it must claim a full line of its own, the grid twin of the flex rule at :1222. */
.rd-ag-row .subs-skills{grid-column:1/-1;margin-top:6px;}
/* AFTER the rules it neutralizes — source order, not specificity, is what makes
   this win in this stylesheet. */
@media (prefers-reduced-motion: reduce){
  .rd-ag-dot.run{animation:none;}
}
```

> NOTE: `@keyframes wr-pulse` is one of the four keyframes the contract says to add once. Task 3 adds it for the card's status avatar. Verify with `grep -n "wr-pulse" ui/public/style.css` before this step; if it is absent, add `@keyframes wr-pulse{0%,100%{opacity:1;}50%{opacity:.35;}}` beside the other `wr-*` keyframes instead of duplicating it here.

- [ ] **Step 14: Run the whole suite and commit**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs` then `npm test`
Expected: the new suite passes 8/8 and `npm test` reports 0 failures.

```bash
git add ui/public/app.js ui/public/style.css test/ui-running-detail.test.mjs
git commit -m "feat(running): add Live log / Overview / Agents tabs to the run detail"
```

---

### Task 8: Live repaint contract

**Files:**
- Modify: `ui/public/app.js:577-586` (`handleServerMessage` tail — the detail branch)
- Modify: `ui/public/app.js:11789-11805` (the 1 s live timer — join the detail screen)
- Modify: `ui/public/app.js` (`openRunDetail` — route its initial paint through `repaintRunDetail`)
- Modify: `ui/public/app.js:2743-2744` (`window.__np` exports)
- Test: `test/ui-running-detail.test.mjs`

**Interfaces:**
- Consumes (Task 5): `runDetailState = {runId, screen}`; `el.runShell` (`#run-shell`); `state.selectedRunId`.
- Consumes (Task 6): `paintRunDetail(r)` — repaints header meta, status pill, graph, banners and the question panel.
- Consumes (Task 7): `rdCtx(r)`, `RD_TABS`, `rdLogBox(sec)`, `rdAutoscrollLog(sec, r)`, `rdMaybePaintLogFilters(sec, r, rec)`.
- Consumes (existing, verified): `clearLogPlaceholder(logEl)` `app.js:3865`; `appendLogRec` `:3717`; `trimLogDom` `:3706`; `logLineVisible` (`./log-filter.mjs`); `liveTotalMs` `:1249`; `durByNode(steps, now, live)` `:1264`; `fmtDuration` `:1230`.
- Produces: `rdOpenRun() -> run|null`; `rdPaintTabBadges(screen, ctx) -> void`; `rdUpdateSections(r) -> void`; `rdAppendLogFrame(r, msg) -> void`; `repaintRunDetail(r) -> void`; `rdTickHosts(r) -> Element[]`.

- [ ] **Step 1: Write the failing test — the repaint branch**

Append to `test/ui-running-detail.test.mjs`:

```javascript
// --- T8: live repaint contract ---------------------------------------------

test('a state frame for the open run repaints the ACTIVE section only', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  click(window, tabOf(window, 'overview'));
  await settle(window);
  const ov = secOf(window, 'overview');
  const agents = secOf(window, 'agents');
  assert.equal(agents.dataset.loaded, undefined, 'Agents was never activated, so never built');
  // Activate Agents once so it IS built, then go back to Overview.
  click(window, tabOf(window, 'agents'));
  await settle(window);
  assert.equal(agents.dataset.loaded, '1');
  click(window, tabOf(window, 'overview'));
  await settle(window);

  frame(ctx, {
    type: 'state', runId: 'r1', id: 'p1', status: 'running',
    steps: STEPS(), totalCostUsd: 9.75,
    subAgents: [...SUBS(), { id: 'a3', label: 'Third', nodeId: 'implement', cycle: 1, status: 'running' }],
    branch: { source: 'main', feature: 'worca-cc/dark-p1', worktreeDir: '/tmp/wt' },
  });
  await settle(window);

  // Active section updated in place.
  const cards = [...ov.querySelectorAll('.hd-ov-grid .hd-ov-card')];
  assert.equal(cards[1].querySelector('.hd-ov-value').textContent, '$9.75');
  // Hidden section: not repainted, but re-armed so activation rebuilds it.
  assert.equal(agents.dataset.loaded, undefined, 'the hidden section was re-armed');
  // The badge tracks the live count even while its tab is hidden.
  assert.equal(tabOf(window, 'agents').querySelector('.rd-tab-badge').textContent, '3');
  click(window, tabOf(window, 'agents'));
  await settle(window);
  assert.equal(agents.querySelectorAll('.rd-ag-row').length, 3, 'rebuilt against current data');
});

test('a log frame appends into the open pane without rebuilding it', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  const sec = secOf(window, 'logs');
  frame(ctx, { type: 'log', runId: 'r1', source: 'planner', level: 'info', text: 'one', ts: 0, stepIndex: 0, cycle: 1 });
  await settle(window);
  const box = rdBox(window);
  assert.equal(box.querySelectorAll('.log-line').length, 1);

  frame(ctx, { type: 'log', runId: 'r1', source: 'planner', level: 'info', text: 'two', ts: 0, stepIndex: 0, cycle: 1 });
  await settle(window);
  assert.equal(rdBox(window), box, 'the pane node survives — no full rebuild');
  assert.equal(box.querySelectorAll('.log-line').length, 2);

  // Facets GROW as new sources/steps/cycles appear (History's build-once fill is
  // the bug being avoided), and a new cycle still draws its separator.
  frame(ctx, { type: 'log', runId: 'r1', source: 'reviewer', level: 'error', text: 'boom', ts: 0, stepIndex: 5, cycle: 2 });
  await settle(window);
  const bar = sec.querySelector('.log-filters');
  assert.deepEqual([...bar.querySelector('.log-f-source').options].map((o) => o.value),
    ['', 'planner', 'reviewer']);
  assert.deepEqual([...bar.querySelector('.log-f-cycle').options].map((o) => o.value), ['', '1', '2']);
  assert.equal(box.querySelectorAll('.log-sep').length, 1);
  assert.equal(box.querySelector('.log-sep').textContent, 'Cycle 2');
  assert.equal(box.querySelectorAll('.log-line').length, 3);
});

test('frames for another run refresh the sidebar but never touch the open detail', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  frame(ctx, { type: 'log', runId: 'r1', source: 'planner', level: 'info', text: 'mine', ts: 0, stepIndex: 0, cycle: 1 });
  await settle(window);
  frame(ctx, {
    type: 'run-created', runId: 'r2', title: 'Other run', projectDir: PROJECT,
    status: 'running', startedAt: '2026-08-19T11:00:00Z', kind: 'run',
  });
  frame(ctx, { type: 'log', runId: 'r2', source: 'planner', level: 'info', text: 'theirs', ts: 0, stepIndex: 0, cycle: 1 });
  frame(ctx, { type: 'state', runId: 'r2', id: 'p2', status: 'running', steps: STEPS(), totalCostUsd: 99 });
  await settle(window);

  const box = rdBox(window);
  assert.equal(box.querySelectorAll('.log-line').length, 1, "r2's lines stay out of r1's pane");
  assert.match(box.textContent, /mine/);
  assert.doesNotMatch(box.textContent, /theirs/);
  assert.equal(window.document.querySelector('#run-detail .rd-header .rd-title').textContent, 'Add dark mode');
  // The sidebar DID learn about r2.
  assert.ok(window.document.querySelector('#nav-running-children button.nav-child[data-child-run-id="r2"]'));
});

test('the existing 1 s interval ticks the open detail, not just the card', async () => {
  const ctx = await bootRunning();
  await openRun(ctx, {
    steps: [
      { key: 'plan#1', nodeId: 'plan', cycle: 1, status: 'done', activeMs: 65000, costUsd: 0.5 },
      { key: 'implement#1', nodeId: 'implement', cycle: 1, status: 'start',
        activeMs: 30000, runningSince: Date.now(), costUsd: 1.0 },
    ],
  });
  const { window } = ctx;
  // ONE timer: the detail screen joins the existing interval's host list rather
  // than getting an interval of its own.
  const r = window.__np.getRun('r1');
  const hosts = window.__np.rdTickHosts(r);
  assert.equal(hosts.length, 2, 'the card and the open detail screen');
  assert.equal(hosts[0], r.el);
  assert.ok(hosts[1].contains(window.document.querySelector('#run-detail .rd-header')),
    'the second host is the mounted detail screen');

  click(window, tabOf(window, 'overview'));
  await settle(window);
  const value = () => secOf(window, 'overview').querySelector('.hd-ov-card-elapsed .hd-ov-value').textContent;
  const before = value();
  await new Promise((r) => setTimeout(r, 1200));
  assert.notEqual(value(), before, 'the ELAPSED stat card ticks without a full repaint');
});
```

(`rdBox`, `secOf`, `tabOf`, `frame`, `STEPS`, `SUBS`, `openRun` and `bootRunning` all come from the Task 7 header block at the top of the suite — nothing new is needed here.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs`
Expected: FAIL with `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: '$1.50' !== '$9.75'` — nothing repaints the open detail on a live frame yet.

- [ ] **Step 3: Implement the repaint branch**

Append to the `.rd-*` block in `ui/public/app.js` (after `buildRdAgents`):

```javascript
// ── Live repaint contract (§5.9) ────────────────────────────────────────────

// The run whose detail screen is OPEN, or null. Three conditions, all load-bearing:
// runDetailState survives a close until the slide finishes (closeRunDetail empties
// the host on transitionend), `.detail-open` is the class the spec keys the
// contract on, and state.selectedRunId is the routing flag the two must agree with.
function rdOpenRun() {
  if (!el.runShell || !el.runShell.classList.contains('detail-open')) return null;
  const id = runDetailState && runDetailState.runId;
  if (!id || id !== state.selectedRunId) return null;
  return runs.get(id) || null;
}

// Tab badges are computed once by initDetailTabs, but the Agents count is live —
// repaint them from the table on every frame so a hidden tab still shows the
// truth. Creates/removes the badge node rather than leaving an empty pill.
function rdPaintTabBadges(screen, ctx) {
  for (const t of RD_TABS) {
    const btn = screen.querySelector(`.rd-tab[data-sec="${t.key}"]`);
    if (!btn) continue;
    const want = t.badge(ctx);
    let b = btn.querySelector('.rd-tab-badge');
    if (want == null) { if (b) b.remove(); continue; }
    if (!b) {
      b = document.createElement('span');
      b.className = 'rd-tab-badge';
      btn.appendChild(b);
    }
    b.textContent = want;
  }
}

// The ACTIVE section repaints in place, keeping its scroll, its filter and (on
// Overview) its expander. Hidden ones only lose their `loaded` stamp, so the next
// activation rebuilds them against current data instead of showing a frozen
// snapshot — cheaper than updating three bodies for every frame, and it is the
// one rule that covers a section that was never built at all.
function rdUpdateSections(r) {
  const screen = runDetailState && runDetailState.screen;
  if (!screen) return;
  const ctx = rdCtx(r);
  for (const sec of screen.querySelectorAll('.rd-sec')) {
    if (sec.hidden) { delete sec.dataset.loaded; continue; }
    if (typeof sec.__update === 'function') sec.__update(ctx);
  }
  rdPaintTabBadges(screen, ctx);
}

// One arriving log record, straight into the open detail's pane. A full
// paintRunDetail per line would rebuild the graph and every banner at log speed;
// this mirrors onLog's tail (3775-3783) with the section as the root and the
// section's own cycle cursor.
function rdAppendLogFrame(r, msg) {
  if (msg.text === undefined || msg.text === null) return;   // onLog's own guard
  // D8: once the run is terminal this pane is a settled artifact, not a live one —
  // "the log stops growing". onLog still records the line to r.logLines, so nothing
  // is lost: History's Logs tab is the durable view, and re-opening this tab
  // rebuilds from the model.
  if (RD_TERMINAL.includes(r.status)) return;
  const screen = runDetailState && runDetailState.screen;
  if (!screen) return;
  const sec = screen.querySelector('.rd-sec[data-sec="logs"]');
  if (!sec) return;
  // Hidden tab: drop the built body so activation rebuilds it from r.logLines —
  // the same re-arm rule rdUpdateSections applies to the other two sections.
  if (sec.hidden) { delete sec.dataset.loaded; return; }
  const rec = r.logLines[r.logLines.length - 1];
  if (!rec) return;
  const repainted = rdMaybePaintLogFilters(sec, r, rec);
  const box = rdLogBox(sec);
  if (!box || repainted || !logLineVisible(rec, r.logFilter)) return;
  clearLogPlaceholder(box);
  sec._lastCycle = appendLogRec(box, rec, sec._lastCycle ?? null);
  trimLogDom(box);
  rdAutoscrollLog(sec, r);
}

// The ONE full repaint of an open detail. Everything that changes the run — the
// open path, every live frame — goes through here so the header/graph/banner half
// (Task 6) and the tab half can never drift apart.
function repaintRunDetail(r) {
  paintRunDetail(r);
  rdUpdateSections(r);
}
```

Now wire it into `handleServerMessage`. Replace `ui/public/app.js:584-585`:

```javascript
  renderPipelineTabs();            // keep sidebar child rows + roll-up live from ANY view
  if (currentView() === 'running') renderRunningView();
```

with:

```javascript
  renderPipelineTabs();            // keep sidebar child rows + roll-up live from ANY view
  // §5.9. A frame for the run whose detail is open repaints that screen; a frame
  // for ANY OTHER run has already refreshed the counts and the sidebar above and
  // must stop there — the open detail is not its business. `log` takes the cheap
  // path: onLog already appended to the card, so all that is left is this pane.
  const rdRun = rdOpenRun();
  if (rdRun && rdRun.runId === msg.runId) {
    if (msg.type === 'log') rdAppendLogFrame(rdRun, msg);
    else repaintRunDetail(rdRun);
  }
  if (currentView() === 'running') renderRunningView();
```

Route the open path through the same entry point: locate it with
`grep -n "paintRunDetail(r);" ui/public/app.js` and, inside `openRunDetail` only, replace Task 7's two lines

```javascript
  initRdTabs(screen, r);
  paintRunDetail(r);
```

with

```javascript
  initRdTabs(screen, r);
  repaintRunDetail(r);
```

The order is load-bearing: `repaintRunDetail` calls `rdUpdateSections`, which needs the `.rd-sec` elements `initRdTabs` creates.

Finally add to `window.__np` (after `buildRdAgents,` from Task 7):

```javascript
    rdOpenRun,
    rdUpdateSections,
    rdAppendLogFrame,
    repaintRunDetail,
    rdTickHosts,
```

- [ ] **Step 4: Extend the existing 1 s timer instead of adding a second one**

Replace `ui/public/app.js:11789-11805` with:

```javascript
// Every mounted surface showing THIS run's live timers: its list card and, when
// the detail screen happens to be showing the same run, that screen. One walk,
// one interval — a second timer for the detail would drift against this one and
// double the per-second work (§11).
function rdTickHosts(r) {
  const hosts = [];
  if (r.el) hosts.push(r.el);
  const open = rdOpenRun();
  if (open && open.runId === r.runId && runDetailState.screen) hosts.push(runDetailState.screen);
  return hosts;
}

const _timerTick = setInterval(() => {
  for (const r of runs.values()) {
    const active = r.status === 'running' || r.status === 'starting';
    const paused = r.pendingQuestion != null;
    if (!active || paused) continue;
    const hosts = rdTickHosts(r);
    if (!hosts.length) continue;
    const now = Date.now();
    const elapsed = fmtDuration(liveTotalMs(r.steps, now));
    const durs = durByNode(r.steps, now, true);
    for (const host of hosts) {
      // querySelectorAll, not querySelector: the detail screen carries the header
      // elapsed AND the Overview ELAPSED stat card, both tagged `.run-time`.
      for (const timeEl of host.querySelectorAll('.run-time')) timeEl.textContent = elapsed;
      for (const el of host.querySelectorAll('.run-node[data-id]')) {
        const durEl = el.querySelector('.dur');
        if (!durEl) continue;
        const d = durs[el.dataset.id];
        durEl.textContent = d != null ? fmtDuration(d) : '';
      }
    }
  }
}, 1000);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs`
Expected: PASS — 12 tests.

- [ ] **Step 6: Run the whole suite and commit**

Run: `npm test`
Expected: 0 failures.

```bash
git add ui/public/app.js test/ui-running-detail.test.mjs
git commit -m "feat(running): repaint the open run detail from live WS frames"
```

---

### Task 9: Terminal state + "View in History" link

**Files:**
- Modify: `ui/public/app.js:4336-4341` (`finishRun` — stamp `finishedAtMs`)
- Modify: `ui/public/app.js:4359-4364` (`finishRun` — remove the focus-view bounce, D8)
- Modify: `ui/public/app.js` (the `.rd-*` block — add `historyKeyForRun` + `paintRdTerminal`, and call it from `repaintRunDetail`)
- Modify: `ui/public/app.js:2743-2744` (`window.__np` exports)
- Modify: `ui/public/style.css` (append the terminal-state rules)
- Test: `test/ui-running-detail.test.mjs`

**Interfaces:**
- Consumes (Task 6): `.rd-header` carries `.rd-status` (a `.pill-run` + family class wrapping `<span class="pdot">` + the status word), `.rd-row3` (with `.rd-pause`, `.rd-stop`, `.rd-spacer`), and `.rd-graph`.
- Consumes (Task 7): `RD_TERMINAL`. (Task 8): `repaintRunDetail(r)`, and `rdAppendLogFrame`'s `RD_TERMINAL` early-return — the "log stops growing" half of D8 already ships there.
- Consumes (existing, verified): `state.historyAll` `app.js:28` (rows carry `{id, projectKey, projectDir, projectName, target}` — `listAllPipelines`, `src/core/artifacts.mjs:1521-1560`); `histDetailParam`-style route grammar `#history/<projectKey>/<id>` `app.js:9186`; `startedLabel` `:10912`.
- Produces: `historyKeyForRun(r) -> string` (`''` when unresolvable); `paintRdTerminal(screen, r) -> void`.

> NOTE (contract refinement, per the §5.2 dot spec): `.rd-status` is expected to be `<span class="rd-status pill-run <family>"><span class="pdot"></span><span class="pill-text"></span></span>` — the existing status-pill markup (`index.html:362`) whose `.pdot` already carries the pulse (`style.css:567`) and is already neutralized under `prefers-reduced-motion` (`:761`). Task 9 only adds the `parked` class that stops that pulse; the family flip is automatic because Task 6 paints the pill from `runStatusMeta(r)`, which returns the terminal family. If Task 6 named the dot differently, change the selector in Step 5's CSS to match rather than adding a second dot element.

> NOTE: `projectKey` **cannot** be derived from a live run's own fields. It is a server-side `slug-sha1(canonicalProjectRoot)` (`src/core/store.mjs:36-47`), and `/api/projects` returns only `{name, path, exists}` (`src/core/projects.mjs:94-96`) — so `state.projects` is useless here. The one client-side mapping is the History dataset: every `/api/history` row carries `{id, projectKey, projectDir}`, running rows included (`listAllPipelines` filters on `archived_at IS NULL` only), and it is background-loaded on the first `hello` (`app.js:656-657`). `historyKeyForRun` therefore matches on `pipelineId` first (exact) and falls back to **any** row sharing the run's `projectDir` (the dir↔key mapping is 1:1 and stable) — which is what covers a pipeline created after boot, since a plain `done` broadcasts no `pipelines-changed` and `state.historyAll` is only force-reloaded while the History view is open. When both lookups miss (a project with no prior history at all, or a workspace run — those carry `projectDir: ''`, `app.js:6366-6379` — before its own row lands), the link is **omitted** rather than pointed at a fabricated key. Spec §5.2 already omits it when `pipelineId` is unknown; this extends the same rule to an unknown key.

> NOTE: the terminal set is `RD_TERMINAL = ['done','stopped','error']` (Task 7), **not** `isTerminalStatus` (`app.js:4290`), which also matches `interrupted` — a status the Running view renders as a resumable pause.

- [ ] **Step 1: Write the failing test**

Append to `test/ui-running-detail.test.mjs`:

```javascript
// --- T9: terminal state -----------------------------------------------------

test('a run that finishes while its detail is open keeps the page and goes terminal', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  frame(ctx, { type: 'log', runId: 'r1', source: 'planner', level: 'info', text: 'one', ts: 0, stepIndex: 0, cycle: 1 });
  await settle(window);
  assert.equal(rdBox(window).querySelectorAll('.log-line').length, 1);

  frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
  await settle(window, 6);

  // D8: no auto-redirect — the page stays exactly where it was.
  assert.equal(window.location.hash, '#running/r1');
  assert.ok(window.document.getElementById('run-shell').classList.contains('detail-open'));
  assert.ok(window.document.querySelector('#run-detail .rd-header'), 'the screen is still mounted');

  const header = window.document.querySelector('#run-detail .rd-header');
  assert.equal(header.querySelector('.rd-pause').hidden, true);
  assert.equal(header.querySelector('.rd-stop').hidden, true);
  const pill = header.querySelector('.rd-status');
  assert.ok(pill.classList.contains('green'), 'the pill takes the terminal family');
  assert.ok(pill.classList.contains('parked'), 'and its dot stops pulsing');
  assert.ok(window.document.querySelector('#run-detail .rd-graph').classList.contains('settled'));

  const link = header.querySelector('.rd-history-link');
  assert.equal(link.hidden, false);
  assert.equal(link.getAttribute('href'), `#history/${KEY}/p1`);
  assert.equal(link.textContent, 'View in History');

  // The log stops growing: a stray late frame lands on a finished run and the
  // pane is unchanged.
  frame(ctx, { type: 'log', runId: 'r1', source: 'planner', level: 'info', text: 'late', ts: 0, stepIndex: 0, cycle: 1 });
  await settle(window);
  assert.doesNotMatch(rdBox(window).textContent, /late/);
});

test('Overview reads the terminal state once the run has finished', async () => {
  const ctx = await bootRunning();
  await openRun(ctx);
  const { window } = ctx;
  click(window, tabOf(window, 'overview'));
  await settle(window);
  frame(ctx, { type: 'done', runId: 'r1', status: 'stopped' });
  await settle(window, 6);
  const copy = secOf(window, 'overview').querySelector('.rd-ov-copy').textContent;
  assert.match(copy, /^Stopped\. Finished at \d\d:\d\d:\d\d\.$/);
  assert.ok(secOf(window, 'overview').querySelector('.rd-ov-chip').classList.contains('st-red'));
});

test('the History link is omitted when the pipeline id is unknown', async () => {
  const ctx = await bootRunning();
  frame(ctx, {
    type: 'run-created', runId: 'r3', title: 'No id yet', projectDir: PROJECT,
    status: 'running', startedAt: '2026-08-19T10:00:00Z', kind: 'run',
  });
  go(ctx.window, 'running/r3');
  await settle(ctx.window, 6);
  frame(ctx, { type: 'error', runId: 'r3' });
  await settle(ctx.window, 6);
  const link = ctx.window.document.querySelector('#run-detail .rd-history-link');
  assert.equal(link.hidden, true, 'no pipelineId -> no link');
});

test('the projectKey falls back to another pipeline from the same project dir', async () => {
  // r1's own pipeline id ('p1') is NOT in the History dataset — only an older run
  // from the same projectDir is. The dir->key mapping still resolves the link.
  const ctx = await bootRunning({ rows: [HISTORY_ROW] });
  await openRun(ctx);
  const { window } = ctx;
  assert.equal(ctx.box.rows.some((p) => p.id === 'p1'), false);
  frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
  await settle(window, 6);
  assert.equal(window.document.querySelector('#run-detail .rd-history-link').getAttribute('href'),
    `#history/${KEY}/p1`);
});

test('an unresolvable projectKey hides the link instead of guessing one', async () => {
  const ctx = await bootRunning({ rows: [] });          // no history at all
  await openRun(ctx);
  const { window } = ctx;
  frame(ctx, { type: 'done', runId: 'r1', status: 'done' });
  await settle(window, 6);
  assert.equal(window.document.querySelector('#run-detail .rd-history-link').hidden, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs`
Expected: FAIL with `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: '#running' !== '#running/r1'` — `finishRun` still bounces the focus view back to the list.

- [ ] **Step 3: Stop the bounce and stamp the finish time**

Replace `ui/public/app.js:4339-4341`:

```javascript
  r.status = status;
  r.pendingQuestion = null;
  r._answering = false;
```

with:

```javascript
  r.status = status;
  r.pendingQuestion = null;
  r._answering = false;
  // No `done` frame carries a timestamp (the orchestrator emits {status,
  // pipelineDir} and bufferEvent only tags runId, ui/server.mjs:308-313), so the
  // arrival time is the only honest "finished at" the client can show. Read by the
  // detail Overview's terminal copy (§5.7).
  r.finishedAtMs = Date.now();
```

Then replace `ui/public/app.js:4359-4364`:

```javascript
  // Q&A #5: if the user is staring at THIS run's focus tab, drop them to Overview.
  // A paused run keeps its focus tab (its card stays, now showing Resume).
  if (!paused && state.selectedRunId === r.runId) {
    state.selectedRunId = '';
    if (location.hash.slice(1) !== 'running') location.hash = 'running'; // → hashchange → Overview
  }
```

with:

```javascript
  // D8: a run that finishes while its DETAIL page is open keeps the page. The old
  // single-card focus view had to bounce here — it rendered exactly one live card,
  // so a finished run left it empty — but the detail screen renders a terminal run
  // perfectly well (paintRdTerminal below), and D16 makes a lingering run's detail
  // a legitimate destination in its own right. Dropping state.selectedRunId here
  // would ALSO break the §5.9 repaint branch, whose guard compares it with
  // runDetailState.runId. Lingering/acknowledgement is untouched: markLingering
  // above still runs, and Back still acknowledges through openRunDetail.
```

- [ ] **Step 4: Implement the terminal painter**

Append to the `.rd-*` block in `ui/public/app.js` (after `repaintRunDetail`):

```javascript
// ── Terminal state + View in History (§5.2, D8) ─────────────────────────────

// The projectKey half of `#history/<projectKey>/<pipelineId>`. See the task NOTE:
// a live run carries only projectDir, and projectKey is a server-side
// slug+sha1(canonicalProjectRoot) (src/core/store.mjs:36-47) that /api/projects
// never exposes. The History dataset is the one client-side mapping — its rows
// carry {id, projectKey, projectDir} and it is background-loaded on the first
// hello (app.js:656). Exact id match first; then ANY row from the same projectDir,
// which is what covers a pipeline created after this tab loaded. '' when neither
// resolves — the caller omits the link rather than inventing a key.
function historyKeyForRun(r) {
  const rows = Array.isArray(state.historyAll) ? state.historyAll : [];
  if (r.pipelineId) {
    const byId = rows.find((p) => p && p.id === r.pipelineId && p.projectKey);
    if (byId) return byId.projectKey;
  }
  if (r.projectDir) {
    const byDir = rows.find((p) => p && p.projectDir === r.projectDir && p.projectKey);
    if (byDir) return byDir.projectKey;
  }
  return '';
}

// Flip the open screen between live and terminal. Idempotent and called on EVERY
// repaint (including the first), so opening an already-finished lingering run
// (D16) lands in the terminal state directly rather than flashing live controls.
function paintRdTerminal(screen, r) {
  if (!screen) return;
  const terminal = RD_TERMINAL.includes(r.status);

  const pause = screen.querySelector('.rd-pause');
  const resume = screen.querySelector('.rd-resume');
  const stop = screen.querySelector('.rd-stop');
  // Only FORCE hidden; leaving them alone on the live path keeps Task 6's
  // pause/resume swap and its total-budget gating in charge.
  if (terminal) {
    if (pause) pause.hidden = true;
    if (resume) resume.hidden = true;
    if (stop) stop.hidden = true;
  }

  const pill = screen.querySelector('.rd-status');
  if (pill) pill.classList.toggle('parked', terminal);
  const graph = screen.querySelector('.rd-graph');
  if (graph) graph.classList.toggle('settled', terminal);

  // The link is created here rather than in the template so it cannot exist in a
  // half-painted state on a live run, and so the row-3 markup owns no state.
  const row = screen.querySelector('.rd-row3');
  let link = screen.querySelector('.rd-history-link');
  if (!link && row) {
    link = document.createElement('a');
    link.className = 'rd-history-link';
    link.textContent = 'View in History';
    link.hidden = true;
    row.appendChild(link);
  }
  if (!link) return;
  const key = terminal ? historyKeyForRun(r) : '';
  if (terminal && r.pipelineId && key) {
    link.setAttribute('href', `#history/${key}/${r.pipelineId}`);
    link.hidden = false;
  } else {
    link.removeAttribute('href');
    link.hidden = true;
  }
}
```

Then extend `repaintRunDetail` — replace its body:

```javascript
function repaintRunDetail(r) {
  paintRunDetail(r);
  rdUpdateSections(r);
}
```

with:

```javascript
function repaintRunDetail(r) {
  paintRunDetail(r);
  rdUpdateSections(r);
  paintRdTerminal((runDetailState && runDetailState.screen) || null, r);
}
```

Finally add to `window.__np` (after `rdTickHosts,` from Task 8):

```javascript
    historyKeyForRun,
    paintRdTerminal,
```

- [ ] **Step 5: Style the terminal state**

Append to the end of `ui/public/style.css`:

```css

/* ---------- Running detail: terminal state (D8) ---------- */
/* The pill keeps its family colours from `.pill-run.<family>` (:568-:573); only
   the dot's pulse stops. (0,3,0) beats `.pill-run .pdot` (0,2,0), so this holds
   wherever it sits in the file. */
.rd-status.parked .pdot{animation:none;}

/* A finished run stops moving. `paintStepper` only nulls activeId when the status
   is exactly 'done' (app.js:11258), so a STOPPED or ERRORED run's frontier node can
   still be `now` and its wire would march forever. Neutralize the three motions
   the graph carries rather than fighting the adapter. */
.rd-graph.settled .run-flow .wires path.wire-live{animation:none;}
.rd-graph.settled .run-flow .node.is-active{animation:none;}
.rd-graph.settled .run-flow .node .fan .sq.on{animation:none;}

.rd-history-link{flex:0 0 auto;font:600 12.5px var(--sans);color:var(--blue-ink);text-decoration:none;}
.rd-history-link:hover{text-decoration:underline;}
.rd-history-link[hidden]{display:none;}
.rd-history-link:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-detail.test.mjs`
Expected: PASS — 17 tests.

- [ ] **Step 7: Run the whole suite and commit**

Run: `npm test`
Expected: 0 failures. If `test/ui-running-nav.test.mjs` or `test/ui-running-order.test.mjs` assert the old `finishRun` bounce (`location.hash === '#running'` after a `done` frame), update those assertions to the D8 behaviour — the detail stays open — and name the change in the commit body.

```bash
git add ui/public/app.js ui/public/style.css test/ui-running-detail.test.mjs
git commit -m "feat(running): keep the detail page on finish and link it to History"
```

---

### Task 10: Stop confirmation modal

**Files:**
- Modify: `ui/public/index.html:1186-1187` (insert `#stop-modal` immediately after `#shipit-modal`'s closing `</div>`)
- Modify: `ui/public/app.js:7806-7825` (`stopRun` returns a result), `ui/public/app.js:7959-7965` (`.btn-stop` opens the modal), `ui/public/app.js:8061` (append the modal + the `#run-detail` delegate), `ui/public/app.js:2743` (`window.__np` exports)
- Modify: `ui/public/style.css` (append at EOF, i.e. after the History card v2 block that currently ends at `:1984`)
- Test: `test/ui-running-stop-modal.test.mjs` (new)

**Interfaces:**
- Consumes: `stopRun(runId, btn)` (`app.js:7806`), `runs` Map (`app.js:1056`), `r.title` / `r.branchFeature` (set by `onState`, `app.js:1525-1527`), `state.selectedRunId` (`app.js:12`), `.btn-stop` inside `.rc-acts` (Task 3), `.rd-stop` inside `.rd-row3` (Task 6), `closeRunDetail(opts)` (Task 5), the Running Escape handler (Task 5), `$` (`app.js:3`), `safeJson` (`app.js:10785`), `onLog`
- Produces:
  - `openStopModal(runId: string) -> void` — no-ops for an unknown `runId` and while the modal is already open
  - `closeStopModal() -> void` — no-ops when nothing is open
  - `stopRun(runId, btn) -> Promise<{ ok: boolean, error?: string }>` (was `Promise<void>`)
  - `window.__np.openStopModal`, `window.__np.closeStopModal`
  - DOM: `#stop-modal` `.stop-card` `.stop-title` `.stop-body` `.stop-ident` `.stop-ident-title` `.stop-ident-branch` `.stop-err` `.stop-actions` `.stop-cancel` `.stop-confirm`; the open modal carries `dataset.runId`

> NOTE: `confirmModal` (`app.js:6030`) cannot host this dialog. Its entire API is
> `{title, message, confirmLabel, cancelLabel, checkbox:{label}, danger}` — six
> plain strings written into six fixed nodes of one **shared singleton**
> (`el.confirmTitle` / `el.confirmMessage` / `el.confirmOk` / `el.confirmCancel` /
> `el.confirmCheckbox*`). There is no slot for §6's `--field` identity block (run
> title on one line, branch on the next, mono), no inline error slot, and no busy
> state on the OK button — `confirmModal` resolves its promise and hides
> immediately on click, so the "Stopping…" → failure-inline-in-the-modal flow is
> unrepresentable. Teaching it those three things would change the node set every
> one of its existing callers shares. This is the same reasoning History used for
> `#shipit-modal` (`app.js:9448`), and this task follows that file's conventions.

> NOTE: CONTRACT.md's class list for the modal (`#stop-modal`, `.stop-title`
> `.stop-body` `.stop-ident` `.stop-cancel` `.stop-confirm`) has no name for the
> two identity lines or for the inline error slot. This task adds
> `.stop-ident-title` / `.stop-ident-branch` / `.stop-err`, named after
> `.shipit-err` (`index.html:1181`), rather than inventing a different scheme.

- [ ] **Step 1: Write the failing test**

Create `test/ui-running-stop-modal.test.mjs`:

```javascript
// test/ui-running-stop-modal.test.mjs — the dedicated "Stop this pipeline?" confirm
// modal (design §6 / D5). Opened from the card's .btn-stop AND the detail header's
// .rd-stop; both stamp the target runId. Keep running cancels, Stop pipeline POSTs
// /api/stop, a failure renders inline, Escape + backdrop close it, and Escape while
// it is open must NOT also navigate the detail screen back to the list.
//
// boot()/dispatch()/showRunning() are a deliberate verbatim copy of
// test/ui-question.test.mjs:19-81 (plus the `scrollIntoView` stub from
// test/ui-history-shipit.test.mjs:30, which the detail screen needs) — the suites
// do not import each other.
//
// Each test gets a fresh DOM + a fresh module import (cache-busted) so module
// top-level state (stopModalClose, runDetailState) can't leak between cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;

  // jsdom doesn't implement scrollIntoView; the detail screen calls it on open.
  window.Element.prototype.scrollIntoView = function () {};

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() {
      this.readyState = 1; // OPEN — app.js gates backfill subscribes on wsReady
      this._listeners = {};
      wsBox.ws = this;
    }
    send() {}
    close() {}
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    }
    dispatch(type, evt) {
      (this._listeners[type] || []).forEach((fn) => fn(evt));
    }
  };

  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) {
      const r = fetchHandler(String(url), opts || {});
      if (r) return r;
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] }),
    });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch {
      /* read-only global already present — leave it */
    }
  }
  globalThis.window = window;
  globalThis.document = window.document;

  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  function dispatch(msg) {
    wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
  }
  function showRunning() {
    window.location.hash = 'running';
    window.dispatchEvent(new window.Event('hashchange'));
  }

  return { window, dispatch, showRunning, calls, wsBox };
}

const RUN_ID = 'run-stop-1';
const BRANCH = 'worca-cc/chat-connectivity-followups-9c21ae44';

// Open the WS, seed one running pipeline, land on Running, then give it a branch
// (r.branchFeature is only ever set from a `state` frame — app.js:1525-1527).
function seed(ctx) {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({
    type: 'hello',
    runs: [{
      runId: RUN_ID, title: 'Implement Chat Connectivity Follow-ups', projectDir: '/tmp/p',
      status: 'running', startedAt: '2026-01-01T00:00:00Z', kind: 'run', pipelineId: 'p1',
    }],
  });
  ctx.showRunning();
  ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'running', branch: { feature: BRANCH } });
}

const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const esc = (window) =>
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
const stopPosts = (ctx) => ctx.calls.filter((c) => c.url.includes('/api/stop'));

test('the card Stop button opens #stop-modal with the run identity and POSTs nothing', async () => {
  const ctx = await boot();
  seed(ctx);

  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  assert.ok(card, 'run card exists');
  const modal = ctx.window.document.getElementById('stop-modal');
  assert.ok(modal, '#stop-modal exists in index.html');
  assert.ok(modal.classList.contains('hidden'), 'modal starts closed');

  click(ctx.window, card.querySelector('.btn-stop'));

  assert.equal(modal.classList.contains('hidden'), false, 'Stop opens the modal');
  assert.equal(modal.dataset.runId, RUN_ID, 'the opener stamps the target runId');
  assert.equal(modal.querySelector('.stop-title').textContent, 'Stop this pipeline?');
  assert.match(
    modal.querySelector('.stop-body').textContent,
    /^Agents in flight are cancelled at their next checkpoint\. The run moves to History as stopped; its worktree and branch stay in place so you can resume from there\.$/,
  );
  assert.equal(modal.querySelector('.stop-ident-title').textContent, 'Implement Chat Connectivity Follow-ups');
  assert.equal(modal.querySelector('.stop-ident-branch').textContent, BRANCH);
  assert.equal(modal.querySelector('.stop-ident-branch').hidden, false, 'branch line shown when known');
  assert.equal(modal.querySelector('.stop-cancel').textContent, 'Keep running');
  assert.equal(modal.querySelector('.stop-confirm').textContent, 'Stop pipeline');
  assert.equal(stopPosts(ctx).length, 0, 'opening the modal must not stop anything');
});

test('a run with no feature branch hides the branch line', async () => {
  const ctx = await boot();
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({
    type: 'hello',
    runs: [{ runId: RUN_ID, title: 'No branch yet', projectDir: '/tmp/p', status: 'running',
      startedAt: '2026-01-01T00:00:00Z', kind: 'run' }],
  });
  ctx.showRunning();

  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  click(ctx.window, card.querySelector('.btn-stop'));

  const modal = ctx.window.document.getElementById('stop-modal');
  assert.equal(modal.querySelector('.stop-ident-title').textContent, 'No branch yet');
  assert.equal(modal.querySelector('.stop-ident-branch').hidden, true, 'no branch -> line hidden');
});

test('"Keep running" closes the modal without POSTing /api/stop', async () => {
  const ctx = await boot();
  seed(ctx);
  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  click(ctx.window, card.querySelector('.btn-stop'));

  const modal = ctx.window.document.getElementById('stop-modal');
  click(ctx.window, modal.querySelector('.stop-cancel'));

  assert.ok(modal.classList.contains('hidden'), 'Keep running closes it');
  assert.equal(modal.dataset.runId, undefined, 'the runId stamp is cleared on close');
  assert.equal(stopPosts(ctx).length, 0, 'cancel never stops the run');
});

test('"Stop pipeline" POSTs /api/stop {runId} and closes the modal', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/stop')
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) })
      : null),
  });
  seed(ctx);
  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  click(ctx.window, card.querySelector('.btn-stop'));

  const modal = ctx.window.document.getElementById('stop-modal');
  click(ctx.window, modal.querySelector('.stop-confirm'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const posts = stopPosts(ctx);
  assert.equal(posts.length, 1, 'exactly one POST /api/stop');
  assert.equal(posts[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(posts[0].opts.body), { runId: RUN_ID });
  assert.ok(modal.classList.contains('hidden'), 'a successful stop closes the modal');
});

test('a failed /api/stop renders inline in the modal and re-arms the button', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.includes('/api/stop')
      ? Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'run already finished' }) })
      : null),
  });
  seed(ctx);
  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  click(ctx.window, card.querySelector('.btn-stop'));

  const modal = ctx.window.document.getElementById('stop-modal');
  const ok = modal.querySelector('.stop-confirm');
  click(ctx.window, ok);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(modal.classList.contains('hidden'), false, 'the modal stays open on failure');
  const err = modal.querySelector('.stop-err');
  assert.equal(err.hidden, false, 'the inline error slot is shown');
  assert.match(err.textContent, /run already finished/);
  assert.equal(ok.disabled, false, 'the confirm button is re-enabled');
  assert.equal(ok.textContent, 'Stop pipeline', 'the busy label is restored');
});

test('backdrop click closes; a click inside the card does not', async () => {
  const ctx = await boot();
  seed(ctx);
  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  click(ctx.window, card.querySelector('.btn-stop'));

  const modal = ctx.window.document.getElementById('stop-modal');
  click(ctx.window, modal.querySelector('.stop-ident'));       // inside the dialog card
  assert.equal(modal.classList.contains('hidden'), false, 'clicks inside the card do not close');

  modal.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));   // the overlay itself
  assert.ok(modal.classList.contains('hidden'), 'backdrop click closes');
  assert.equal(stopPosts(ctx).length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-stop-modal.test.mjs`

Expected: FAIL — first case dies on `assert.ok(modal, '#stop-modal exists in index.html')` (`getElementById('stop-modal')` returns `null`).

- [ ] **Step 3: Add the `#stop-modal` markup**

In `ui/public/index.html`, insert between line 1186 (`</div>`, closing `#shipit-modal`) and the `<!-- ===== Add-project modal ===== -->` comment at line 1188:

```html

    <!-- ===== "Stop this pipeline?" confirm modal (Running card + detail) ===== -->
    <!-- No z-index of its own: .viewer-modal is z-index:50 (style.css:775) and
         #stop-modal FOLLOWS #shipit-modal in the DOM, so it paints above every
         earlier overlay. It never coexists with one — the Running Escape guard and
         openStopModal's double-open guard keep them mutually exclusive. -->
    <div id="stop-modal" class="viewer-modal hidden" role="dialog" aria-modal="true" aria-labelledby="stop-title">
      <div class="card stop-card">
        <h2 id="stop-title" class="stop-title">Stop this pipeline?</h2>
        <p class="stop-body">Agents in flight are cancelled at their next checkpoint. The run moves to History as stopped; its worktree and branch stay in place so you can resume from there.</p>
        <div class="stop-ident">
          <div class="stop-ident-title"></div>
          <div class="stop-ident-branch" hidden></div>
        </div>
        <!-- `hint err`, not `err`: style.css has no standalone .err rule, only
             .hint.err (:284). .hint sets display:block, so .stop-err ships an
             explicit [hidden] twin in the stylesheet — same as .shipit-err. -->
        <div class="stop-err hint err" hidden></div>
        <div class="stop-actions">
          <button type="button" class="stop-cancel">Keep running</button>
          <button type="button" class="stop-confirm">Stop pipeline</button>
        </div>
      </div>
    </div>
```

- [ ] **Step 4: Add the modal CSS**

Append at the very END of `ui/public/style.css` (currently `:1984` — after the ship-it reduced-motion block at `:1933-1940` and after the History card v2 block):

```css

/* ---------- "Stop this pipeline?" confirm modal (design §6) ---------- */
/* WIDTH GOES ON `#stop-modal .card`, NOT `.stop-card`. The markup is
   `<div class="card stop-card">` inside `.viewer-modal`, and
   `.viewer-modal .card{width:min(860px,100%);…}` (:780) is (0,2,0): a bare
   `.stop-card{width:…}` (0,1,0) loses no matter where it is appended. Exact
   precedent: `#shipit-modal .card` (:1893). */
#stop-modal .card{width:min(560px,100%);}
.stop-card{padding:24px;animation:wr-rise .28s cubic-bezier(.2,.7,.3,1) both;}
.stop-title{margin:0 0 12px;font:700 17px/1.25 var(--sans);letter-spacing:-.015em;}
.stop-body{margin:0;font:400 13.5px/1.6 var(--sans);color:var(--ink-2);}
.stop-ident{margin-top:14px;padding:11px 13px;background:var(--field);border-radius:14px;
  font:400 12px/1.6 var(--mono);color:var(--ink-2);word-break:break-all;}
/* author display rule beats the UA [hidden] rule — a branch-less run must not
   leave a blank mono line in the block */
.stop-ident-branch[hidden]{display:none;}
.stop-err{margin-top:12px;}
/* MANDATORY twin: the node is `class="hint err" hidden` and `.hint` (:283) sets
   display:block, which always beats the UA `[hidden]{display:none}`. Same as
   `.shipit-err[hidden]` (:1925). */
.stop-err[hidden]{display:none;}
.stop-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:22px;}
.stop-cancel{padding:11px 20px;border:1.5px solid var(--line-2);border-radius:999px;
  background:var(--panel);font:600 13.5px var(--sans);color:var(--ink);cursor:pointer;}
.stop-cancel:hover{background:var(--field);}
.stop-confirm{padding:11px 20px;border:1.5px solid transparent;border-radius:999px;
  background:var(--red-bg);font:600 13.5px var(--sans);color:var(--red-ink);cursor:pointer;}
/* The mockup's hover is #F7D2CD — a shade §9 does not name and no token carries.
   brightness() keeps the darker-on-hover intent inside the existing palette. */
.stop-confirm:hover{filter:brightness(.97);}
.stop-confirm:disabled{opacity:.6;cursor:default;}
.stop-cancel:focus-visible,.stop-confirm:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
```

> NOTE: `wr-rise` is declared once in Task 12. If Task 12 has not landed yet the
> animation silently no-ops (an unknown `animation-name` is inert) — the dialog
> still renders correctly; only the entrance is missing.

- [ ] **Step 5: Make `stopRun` report its outcome**

Replace `ui/public/app.js:7806-7825` (`stopRun`). The only behavioural change is the
return value; the existing `onLog` writes stay exactly as they are.

```javascript
// Returns {ok:true} | {ok:false,error} so a caller with its own error surface
// (the stop modal) can render the failure inline. The card log write below is
// unchanged, so the run's own log still records every failure.
async function stopRun(runId, btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
    if (!res.ok) {
      const err = await safeJson(res);
      if (btn) btn.disabled = false;
      const msg = String((err && err.error) || res.status);
      const r = runs.get(runId);
      if (r) onLog(r, { source: 'ui', level: 'error', text: `stop failed: ${msg}`, ts: Date.now() });
      return { ok: false, error: msg };
    }
  } catch (e) {
    if (btn) btn.disabled = false;
    const r = runs.get(runId);
    if (r) onLog(r, { source: 'ui', level: 'error', text: `stop error: ${e.message}`, ts: Date.now() });
    return { ok: false, error: e.message };
  }
  return { ok: true };
}
```

- [ ] **Step 6: Add `openStopModal` / `closeStopModal` and rewire both openers**

6a. In `ui/public/app.js`, replace the `.btn-stop` branch of the `#run-list` delegated
click handler (`app.js:7959-7965`):

```javascript
    const stopBtn = e.target.closest && e.target.closest('.btn-stop');
    if (stopBtn) {
      const card = stopBtn.closest('.run-card');
      const runId = card && card.dataset.runId;
      // D5: Stop confirms. This used to call stopRun(runId, stopBtn) directly.
      if (runId) openStopModal(runId);
      return;
    }
```

6b. Append, immediately after the closing `}` of the `if (runListEl) { … }` block
(`app.js:8061`) and before the `buildLogFilterBar` comment:

```javascript

// ---------------------------------------------------------------------------
// Stop confirmation modal (design §6 / D5). A dedicated overlay, not confirmModal:
// confirmModal (app.js:6030) is a SHARED singleton whose whole API is six plain
// strings written into six fixed nodes. It has no slot for this dialog's --field
// identity block (run title + branch, mono, two lines), no inline error slot, and
// no busy state — it hides and resolves on the first click. Teaching it those
// three things would change the node set every one of its callers shares. Same
// reasoning as History's #shipit-modal (app.js:9448), whose structure this follows.
// ---------------------------------------------------------------------------

// Teardown handle for the OPEN stop modal (null when closed). closeRunDetail calls
// through it: the modal is a TOP-LEVEL overlay, not a child of the detail screen,
// so emptying #run-detail would otherwise leave a full-screen overlay (and a live
// document keydown listener) over the LIST — after which the double-open guard
// below makes Stop permanently dead. Exact analogue of shipItClose (app.js:9445).
let stopModalClose = null;
function closeStopModal() { if (stopModalClose) stopModalClose(); }

function openStopModal(runId) {
  const modal = document.getElementById('stop-modal');
  const r = runs.get(runId);
  if (!modal || !r) return;
  if (!modal.classList.contains('hidden')) return;   // double-open guard: a second
                                                     // open would stack a second
                                                     // onOk -> two POST /api/stop
  const q = (sel) => modal.querySelector(sel);
  modal.dataset.runId = runId;                       // both openers stamp the target
  q('.stop-ident-title').textContent = r.title || runId;
  const branch = r.branchFeature || '';
  const branchEl = q('.stop-ident-branch');
  branchEl.textContent = branch;
  branchEl.hidden = !branch;                         // no branch -> no blank line
  const err = q('.stop-err');
  err.hidden = true; err.textContent = '';
  const ok = q('.stop-confirm');
  ok.disabled = false; ok.textContent = 'Stop pipeline';
  modal.classList.remove('hidden');
  ok.focus();

  // `closed` is load-bearing (see openShipItModal's note): Keep running is NOT
  // disabled while the POST is in flight, so cancel-mid-flight is reachable and a
  // non-idempotent done() would tear down a newer generation's listeners.
  let closed = false;
  const done = () => {
    if (closed) return;
    closed = true;
    modal.classList.add('hidden');
    delete modal.dataset.runId;
    if (stopModalClose === done) stopModalClose = null;  // never clobber a newer handle
    ok.removeEventListener('click', onOk);
    q('.stop-cancel').removeEventListener('click', onCancel);
    modal.removeEventListener('click', onBackdrop);
    document.removeEventListener('keydown', onKey);
  };
  stopModalClose = done;
  const onCancel = () => done();
  const onBackdrop = (e) => { if (e.target === modal) done(); };
  const onKey = (e) => { if (e.key === 'Escape') done(); };
  const onOk = async () => {
    ok.disabled = true;
    ok.textContent = 'Stopping…';
    const res = await stopRun(runId, ok);
    if (closed) return;                 // cancelled / navigated while in flight
    if (res && res.ok) { done(); return; }
    ok.disabled = false;                // stopRun already re-enabled it; be explicit
    ok.textContent = 'Stop pipeline';
    err.hidden = false;
    err.textContent = `Could not stop: ${(res && res.error) || 'unknown error'}`;
  };
  ok.addEventListener('click', onOk);
  q('.stop-cancel').addEventListener('click', onCancel);
  modal.addEventListener('click', onBackdrop);
  document.addEventListener('keydown', onKey);
}

// The detail header's Stop pill opens the SAME modal. #run-detail is a static host
// (Task 5), so this binds once at module scope, exactly like #run-list above; the
// header itself is rebuilt on every detail open, so a per-build binding would leak.
// state.selectedRunId is the contract's "which run the detail screen shows".
const runDetailEl = $('#run-detail');
if (runDetailEl) {
  runDetailEl.addEventListener('click', (e) => {
    const stopBtn = e.target.closest && e.target.closest('.rd-stop');
    if (!stopBtn) return;
    if (state.selectedRunId) openStopModal(state.selectedRunId);
  });
}
```

6c. Add to the `window.__np` object literal (`ui/public/app.js:2743`, next to
`resumeRunFromCard, seedResumedLog,`):

```javascript
    openStopModal,
    closeStopModal,
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-stop-modal.test.mjs`

Expected: PASS — `# pass 6`, `# fail 0`.

- [ ] **Step 8: Write the failing Escape-ordering / detail-opener tests**

Append to `test/ui-running-stop-modal.test.mjs`:

```javascript
// The Running detail screen's Escape handler is CAPTURE-phase (Task 5, modelled on
// History's at app.js:10734), and openStopModal's own Escape listener is
// bubble-phase. Capture therefore runs FIRST: without an explicit `#stop-modal`
// guard in that handler, one Escape would close the modal AND navigate the detail
// screen back to the list. These two cases lock the guard down.
function openDetail(ctx) {
  ctx.window.location.hash = `running/${RUN_ID}`;
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
}

test('the detail header Stop pill opens the same modal, stamped with the same runId', async () => {
  const ctx = await boot();
  seed(ctx);
  openDetail(ctx);
  await new Promise((r) => setTimeout(r, 0));

  const detail = ctx.window.document.getElementById('run-detail');
  const rdStop = detail.querySelector('.rd-stop');
  assert.ok(rdStop, '.rd-stop present on the detail header');
  click(ctx.window, rdStop);

  const modal = ctx.window.document.getElementById('stop-modal');
  assert.equal(modal.classList.contains('hidden'), false, '.rd-stop opens the modal');
  assert.equal(modal.dataset.runId, RUN_ID, 'the detail opener stamps the same runId');
  assert.equal(stopPosts(ctx).length, 0);
});

test('Escape closes the modal and does NOT also navigate the detail back', async () => {
  const ctx = await boot();
  seed(ctx);
  openDetail(ctx);
  await new Promise((r) => setTimeout(r, 0));
  click(ctx.window, ctx.window.document.querySelector('#run-detail .rd-stop'));

  const modal = ctx.window.document.getElementById('stop-modal');
  esc(ctx.window);

  assert.ok(modal.classList.contains('hidden'), 'Escape closes the modal');
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), `running/${RUN_ID}`,
    'the modal owns Escape — the detail screen stays open');

  // A second Escape, with no modal open, belongs to the detail screen again.
  esc(ctx.window);
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'running',
    'once the modal is gone Escape navigates back');
});

test('leaving the detail while the modal is open tears the overlay down', async () => {
  const ctx = await boot();
  seed(ctx);
  openDetail(ctx);
  await new Promise((r) => setTimeout(r, 0));
  click(ctx.window, ctx.window.document.querySelector('#run-detail .rd-stop'));

  const modal = ctx.window.document.getElementById('stop-modal');
  assert.equal(modal.classList.contains('hidden'), false);

  ctx.window.location.hash = 'running';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(modal.classList.contains('hidden'),
    'closeRunDetail tears the top-level overlay down instead of stranding it over the list');
});
```

- [ ] **Step 9: Run the new tests to verify they fail**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-stop-modal.test.mjs`

Expected: FAIL — "Escape closes the modal and does NOT also navigate the detail back"
fails on `assert.equal(hash, 'running/run-stop-1')` (actual `'running'`), and
"leaving the detail while the modal is open tears the overlay down" fails on the
final `assert.ok` (the overlay is still visible).

- [ ] **Step 10: Add the Escape guard and the detail teardown hook**

10a. In the Running-detail Escape handler added by Task 5 (a capture-phase
`document.addEventListener('keydown', …, true)` modelled on History's at
`app.js:10734-10746`), add the stop-modal bail alongside the existing modal
guards, before the `location.hash = 'running'` line:

```javascript
  const stop = document.getElementById('stop-modal');
  if (stop && !stop.classList.contains('hidden')) return;
```

10b. In `closeRunDetail(opts)` (Task 5), add as the FIRST statement — mirroring
`closeHistDetail`'s `closeShipItModal()` call (`app.js:9285`):

```javascript
  closeStopModal();   // no-op when nothing is open; the modal is a TOP-LEVEL
                      // overlay, so emptying #run-detail would otherwise strand
                      // a full-screen overlay + its keydown listener over the list
```

> NOTE: 10a/10b edit code Task 5 creates. If Task 5's handler is named or shaped
> differently, apply the same two guards to whatever it produced — the ordering
> requirement (capture-phase router defers to the bubble-phase modal) and the
> teardown requirement are what matter, not the line numbers.

- [ ] **Step 11: Run the test to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-running-stop-modal.test.mjs`

Expected: PASS — `# pass 9`, `# fail 0`.

- [ ] **Step 12: Run the neighbouring suites**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-shell.test.mjs test/ui-history-shipit.test.mjs test/ui-history-routing.test.mjs test/ui-running-nav.test.mjs test/ui-pause-resume.test.mjs`

Expected: PASS, `fail 0` — `stopRun`'s new return value has exactly one other
caller (the rewired `.btn-stop` branch), and `#stop-modal` adds no `data-view`.

- [ ] **Step 13: Commit**

```
git add ui/public/index.html ui/public/app.js ui/public/style.css test/ui-running-stop-modal.test.mjs
git commit -m "feat(running): confirm Stop in a dedicated modal from card and detail"
```

---

### Task 11: Question panel restyle (card + detail) + "Open run" button

**Files:**
- Modify: `ui/public/style.css:10-34` (four new `:root` tokens), `ui/public/style.css:631-656` (rewrite the `.qpanel` block)
- Modify: `ui/public/app.js:4123-4141` (`renderClarifyBody`'s footer gains **Open run**)
- Test: `test/ui-question-panel.test.mjs` (new), `test/ui-question.test.mjs` (must stay green, unmodified), `test/ui-question-agent.test.mjs` (must stay green, unmodified)

**Interfaces:**
- Consumes: `renderQpanel(r)` (`app.js:3978`), `renderClarifyBody(r, panel, pq)` (`4033`), `renderGateBody` (`4144`), `renderRecoveryBody` (`4206`), `setPanelBusy(r, busy)` (`4297`), `.rd-questions` (Task 6's detail host), `--green` / `--green-bg` / `--amber-bg` / `--amber-ink` / `--field` / `--line` / `--line-2` / `--panel` / `--ink*` / `--mono` / `--sans` (`style.css:10-34`)
- Produces:
  - `:root` tokens `--amber-wash:#FEF7EC`, `--amber-wash-2:#FEFAF3`, `--amber-line:#F5D9A8`, `--radio-ring:#D6D6D2`
  - CSS: `.qpanel` (card base) + `.rd-questions .qpanel …` (detail scale-up), `.qopt::before` radio, `.qopen`
  - DOM: `button.qopen` ("Open run") inside `.qpanel-foot`, **card only**

> NOTE: spec §4.3 and §5.4 also ask for an "N of M answered" counter. That is not
> styling — it needs a live recount on every `.qopt` click and every `.qfree`
> keystroke — so it was originally scoped out of this task. It is now **Steps 9-16
> below**, because no other task owned it. Consequence for the CSS above:
> `.qpanel-foot` keeps `justify-content:flex-end` on the card, but the detail
> surface uses `space-between` so the counter takes the left slot.

> NOTE: spec §9 lists `#8C7FD6` (cycle pill) and `#B5751A` (sub-agent log source)
> among the "genuinely new literals". They are not new — they are the existing
> values of `--violet` (`style.css:24`) and `--peach-ink` (`:21`). No token is
> added for either; `var(--violet)` / `var(--peach-ink)` are used instead. Task 12
> locks that with a test.

- [ ] **Step 1: Write the failing test**

Create `test/ui-question-panel.test.mjs`:

```javascript
// test/ui-question-panel.test.mjs — the redesigned clarify/gate/recovery panel
// (design §4.3 + §5.4): amber wash, numbered ink circles (19px card / 22px detail),
// green-tinted picked options with a filled radio + white check, a free-text field
// that turns white-on-green once it holds a non-option value, a right-aligned
// footer, and the card-only "Open run" button.
//
// ruleBody() is a verbatim copy of test/ui-run-flow-css.test.mjs:18-22.
// boot()/dispatch()/showRunning() are a verbatim copy of test/ui-question.test.mjs:19-81.
// The suites do not import each other — this duplication is the house convention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../ui/public/style.css'), 'utf8');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() {
      this.readyState = 1; // OPEN — app.js gates backfill subscribes on wsReady
      this._listeners = {};
      wsBox.ws = this;
    }
    send() {}
    close() {}
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    }
    dispatch(type, evt) {
      (this._listeners[type] || []).forEach((fn) => fn(evt));
    }
  };

  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) {
      const r = fetchHandler(String(url), opts || {});
      if (r) return r;
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] }),
    });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch {
      /* read-only global already present — leave it */
    }
  }
  globalThis.window = window;
  globalThis.document = window.document;

  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  function dispatch(msg) {
    wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
  }
  function showRunning() {
    window.location.hash = 'running';
    window.dispatchEvent(new window.Event('hashchange'));
  }

  return { window, dispatch, showRunning, calls, wsBox };
}

const RUN_ID = 'run-qp-1';

function seedClarify(ctx) {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({
    type: 'hello',
    runs: [{ runId: RUN_ID, title: 'Demo run', projectDir: '/tmp/p', status: 'running',
      startedAt: '2026-01-01T00:00:00Z', kind: 'run' }],
  });
  ctx.showRunning();
  ctx.dispatch({
    type: 'question', runId: RUN_ID, id: 'clarify-1', kind: 'clarify',
    questions: [
      { id: 'q1', question: 'Where to store sessions?', options: ['Redis', 'Postgres', ''], allowFreeText: true },
    ],
  });
}

// ---------------------------------------------------------------------------
// CSS locks (jsdom computes no layout — assert on the stylesheet text)
// ---------------------------------------------------------------------------

test('the four question-panel tokens exist', () => {
  const root = ruleBody(':root');
  assert.ok(root, ':root block missing');
  assert.match(root, /--amber-wash:\s*#FEF7EC/i);
  assert.match(root, /--amber-wash-2:\s*#FEFAF3/i);
  assert.match(root, /--amber-line:\s*#F5D9A8/i);
  assert.match(root, /--radio-ring:\s*#D6D6D2/i);
});

test('.qpanel is the amber card variant and no longer shares its rules with the dead .q-* twins', () => {
  const body = ruleBody('.qpanel');
  assert.ok(body, '.qpanel rule missing');
  assert.match(body, /background:\s*var\(--amber-wash\)/, 'card panel uses the amber wash');
  assert.match(body, /border:\s*1px solid var\(--amber-bg\)/);
  assert.match(body, /border-radius:\s*14px/);
  assert.ok(!/#FFFDF8/i.test(css), 'the old hardcoded wash is gone');
  for (const dead of ['.question-card', '.q-option', '.q-options', '.q-question', '.q-block', '.q-submit-row'])
    assert.ok(!css.includes(dead), `dead selector ${dead} still present`);
});

test('card number circles are 19px, detail circles are 22px', () => {
  const card = ruleBody('.qtext .qn');
  assert.ok(card, '.qtext .qn rule missing');
  assert.match(card, /width:\s*19px/);
  assert.match(card, /height:\s*19px/);
  assert.match(card, /background:\s*var\(--ink\)/);
  const detail = ruleBody('.rd-questions .qtext .qn');
  assert.ok(detail, '.rd-questions .qtext .qn rule missing');
  assert.match(detail, /width:\s*22px/);
  assert.match(detail, /height:\s*22px/);
});

test('a picked option goes green-tinted with a filled radio and a white check', () => {
  const sel = ruleBody('.qopt.sel');
  assert.ok(sel, '.qopt.sel rule missing');
  assert.match(sel, /background:\s*var\(--green-bg\)/);
  assert.match(sel, /border-color:\s*var\(--green\)/);

  const radio = ruleBody('.qopt::before');
  assert.ok(radio, '.qopt::before radio missing');
  assert.match(radio, /border-radius:\s*50%/);
  assert.match(radio, /border:\s*1\.5px solid var\(--radio-ring\)/);

  const on = ruleBody('.qopt.sel::before');
  assert.ok(on, '.qopt.sel::before missing');
  assert.match(on, /var\(--green\)/, 'the filled radio uses --green');
  assert.match(on, /data:image\/svg\+xml/, 'the white check is a CSS-only data URI');
  assert.match(on, /stroke='%23fff'/, 'the check strokes white');
});

test('the free-text field turns white with a green border once it holds a value', () => {
  const base = ruleBody('.qfree');
  assert.ok(base, '.qfree rule missing');
  assert.match(base, /background:\s*var\(--field\)/);
  const has = ruleBody('.qfree.has');
  assert.ok(has, '.qfree.has rule missing');
  assert.match(has, /background:\s*var\(--panel\)/);
  assert.match(has, /border-color:\s*var\(--green\)/);
});

test('the footer is right-aligned on both surfaces; the detail panel rises', () => {
  const foot = ruleBody('.qpanel-foot');
  assert.ok(foot, '.qpanel-foot rule missing');
  assert.match(foot, /justify-content:\s*flex-end/);
  const detail = ruleBody('.rd-questions .qpanel');
  assert.ok(detail, '.rd-questions .qpanel rule missing');
  assert.match(detail, /background:\s*var\(--amber-wash-2\)/);
  assert.match(detail, /border:\s*1\.5px solid var\(--amber-line\)/);
  assert.match(detail, /animation:wr-rise/);
});

// ---------------------------------------------------------------------------
// Behaviour: the card-only "Open run" button
// ---------------------------------------------------------------------------

test('the clarify footer offers "Open run" beside Submit, and it navigates', async () => {
  const ctx = await boot();
  seedClarify(ctx);

  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);
  const foot = card.querySelector('.qpanel-foot');
  assert.ok(foot, 'footer present');
  const open = foot.querySelector('.qopen');
  assert.ok(open, '.qopen present on the card');
  assert.equal(open.textContent, 'Open run');
  assert.equal(open.type, 'button');
  // Open run comes FIRST, Submit second (§4.3: secondary next to the primary).
  const order = [...foot.children].map((n) => n.className);
  assert.equal(order[0], 'qopen');
  assert.ok(order[1].includes('btn-go'), 'Submit answers & resume is the primary');

  open.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), `running/${RUN_ID}`);
  assert.equal(ctx.calls.filter((c) => c.url.includes('/api/answer')).length, 0,
    'Open run navigates — it must never POST an answer');
});

test('"Open run" is NOT rendered on the detail screen (you are already there)', async () => {
  const ctx = await boot();
  seedClarify(ctx);
  ctx.window.location.hash = `running/${RUN_ID}`;
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));

  const panel = ctx.window.document.querySelector('#run-detail .rd-questions .qpanel');
  assert.ok(panel, 'the detail renders the question panel');
  assert.ok(panel.querySelector('.qpanel-foot .btn-go'), 'Submit is still there');
  assert.equal(panel.querySelector('.qopen'), null, 'no Open run on the detail page');
});

test('setPanelBusy covers the new button while an answer is in flight', async () => {
  const ctx = await boot();
  seedClarify(ctx);
  const card = ctx.window.document.querySelector(`.run-card[data-run-id="${RUN_ID}"]`);

  // setPanelBusy (app.js:4297) disables every button/input in the panel; the new
  // .qopen must be inside that sweep, not an escape hatch out of a busy panel.
  card.querySelector('.qpanel .btn-go').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ctx.calls.filter((c) => c.url.includes('/api/answer')).length, 1, 'the answer was posted');
  assert.equal(card.querySelector('.qpanel .qopen').disabled, true,
    'the panel busy state covers the new button');
  assert.equal(card.querySelector('.qpanel .btn-go').disabled, true, 'and the primary, as before');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-question-panel.test.mjs`

Expected: FAIL — the first case fails on `assert.match(root, /--amber-wash:\s*#FEF7EC/i)`
("The input did not match the regular expression"), and the behaviour cases fail on
`assert.ok(open, '.qopen present on the card')`.

- [ ] **Step 3: Add the four `:root` tokens**

In `ui/public/style.css`, insert immediately after `--seq:#B7B7BC;` (line 26):

```css
  /* Question panel (design §9): the only literals in the Running mockup that no
     existing token already carries. #8C7FD6 and #B5751A, which §9 also lists, are
     NOT added — they are the values of --violet and --peach-ink. */
  --amber-wash:#FEF7EC; --amber-wash-2:#FEFAF3; --amber-line:#F5D9A8;
  --radio-ring:#D6D6D2;
```

> NOTE: an earlier task in this series (Task 2's ask banner, Task 3's question
> pill) may already have added `--amber-wash`. Add only the tokens that are
> missing — `grep -n -- '--amber-wash' ui/public/style.css` before editing.

- [ ] **Step 4: Rewrite the `.qpanel` block**

Replace `ui/public/style.css:631-656` (from the `/* ---------- Questions panel ---------- */`
comment through the `.qpanel-foot,.q-submit-row{…}` line) with:

```css
/* ---------- Questions panel (run card + run detail) ---------- */
/* The CARD is the base (design §4.3: 19px number circles, 12.5px options); the
   detail screen scales up through `.rd-questions .qpanel …` (§5.4), which wins on
   SPECIFICITY, so this block's position in the file does not matter.
   The `.q-*` twins that used to share every selector here (.question-card,
   .q-block, .q-question, .q-options, .q-option, .q-free, .q-submit-row) had ZERO
   emitters left in ui/ and test/ and are dropped with this rewrite. */
.qpanel{margin-top:18px;padding:14px 16px 13px;background:var(--amber-wash);
  border:1px solid var(--amber-bg);border-radius:14px;}
.qpanel-head{display:flex;align-items:center;gap:11px;}
.qpanel-head svg{stroke:var(--amber-ink);flex:0 0 auto;}
.qpanel-head b{flex:1;min-width:0;font-weight:600;font-size:12.5px;color:var(--amber-ink);}
.qpanel-head .qcount{margin-left:auto;flex:0 0 auto;background:var(--amber-bg);color:var(--amber-ink);
  font-weight:700;font-size:11.5px;padding:4px 10px;border-radius:999px;}
.qblock{padding:13px 0 0;}
.qtext{font-weight:500;font-size:13px;margin:0 0 9px;display:flex;align-items:flex-start;
  gap:9px;line-height:1.45;}
.qtext .qn{flex:0 0 auto;width:19px;height:19px;border-radius:50%;background:var(--ink);color:#fff;
  font-family:var(--mono);font-size:10.5px;font-weight:600;display:grid;place-items:center;margin-top:1px;}
/* the option column and the free-text field line up under the number circle */
.qopts{display:flex;flex-direction:column;align-items:stretch;gap:7px;margin:0 0 7px;padding-left:28px;}
.qblock > .qfree{margin-left:28px;width:calc(100% - 28px);}
.qopt{display:flex;align-items:center;gap:8px;font-family:inherit;font-weight:500;font-size:12.5px;
  color:var(--ink);background:var(--panel);border:1.5px solid var(--line);border-radius:11px;
  padding:10px 14px;cursor:pointer;transition:.14s;text-align:left;width:100%;}
/* Radio + white check drawn entirely in CSS: renderClarifyBody keeps emitting a
   bare <button> with one text node (§4.3 — styling only, no markup change), and
   an inline data-URI background needs no extra element and no positioning context. */
.qopt::before{content:'';flex:0 0 auto;width:15px;height:15px;border-radius:50%;
  border:1.5px solid var(--radio-ring);background:var(--panel);}
.qopt.sel::before{border-color:var(--green);
  background:var(--green) center/9px 9px no-repeat url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='3.6' stroke-linecap='round' stroke-linejoin='round'><path d='M5 13l4 4L19 7'/></svg>");}
.qopt:hover{border-color:var(--ink-3);}
.qopt.sel{background:var(--green-bg);color:var(--ink);border-color:var(--green);}
.qopt:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.qfree{width:100%;font-family:inherit;font-size:12.5px;color:var(--ink);background:var(--field);
  border:1.5px solid var(--line);border-radius:11px;padding:10px 14px;transition:.14s;}
.qfree::placeholder{color:var(--ink-3);}
/* `.has` is toggled by renderClarifyBody (app.js:4108) the moment the field holds a
   non-empty, non-option value — the green border IS that state. */
.qfree:focus{outline:none;background:var(--panel);border-color:var(--green);}
.qfree.has{background:var(--panel);border-color:var(--green);}
.qpanel-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:14px;}
.qpanel-foot .btn-go{padding:9px 18px;font-size:12px;gap:8px;}
/* secondary "Open run" — card only (§4.3) */
.qopen{padding:9px 16px;border:1.5px solid var(--line-2);border-radius:999px;background:var(--panel);
  font-family:inherit;font-weight:600;font-size:12px;color:var(--ink);cursor:pointer;transition:.14s;}
.qopen:hover{background:var(--field);}
.qopen:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}

/* ---- run-detail variant: the mockup's larger metrics (design §5.4) ---- */
.rd-questions .qpanel{padding:22px 24px 20px;background:var(--amber-wash-2);
  border:1.5px solid var(--amber-line);border-radius:var(--r-card);
  animation:wr-rise .3s cubic-bezier(.2,.7,.3,1) both;}
.rd-questions .qpanel-head{gap:12px;padding-bottom:16px;border-bottom:1px solid var(--amber-line);}
.rd-questions .qpanel-head b{font-size:15px;color:var(--ink);}
.rd-questions .qpanel-head .qcount{font-weight:600;font-size:11.5px;padding:5px 12px;}
.rd-questions .qblock{padding-top:18px;}
.rd-questions .qtext{font-weight:600;font-size:14px;line-height:1.5;gap:11px;margin-bottom:12px;}
.rd-questions .qtext .qn{width:22px;height:22px;font-size:11.5px;}
/* the detail panel is wide enough to drop the number-circle indent */
.rd-questions .qopts{gap:9px;margin:12px 0 0;padding-left:0;}
.rd-questions .qblock > .qfree{margin-left:0;width:100%;padding:13px 16px;border-radius:13px;font-size:13.5px;}
.rd-questions .qopt{gap:11px;padding:13px 16px;border-radius:13px;font-size:13.5px;}
.rd-questions .qopt::before{width:17px;height:17px;}
.rd-questions .qopt.sel::before{background-size:10px 10px;}
.rd-questions .qpanel-foot{margin-top:20px;padding-top:16px;border-top:1px solid var(--amber-line);}
.rd-questions .qpanel-foot .btn-go{padding:13px 22px;font-size:13.5px;gap:9px;}
```

- [ ] **Step 5: Add the "Open run" button to `renderClarifyBody`**

In `ui/public/app.js`, replace the footer block of `renderClarifyBody`
(`app.js:4123-4141`, from `// ----- foot: submit -----` down to
`panel.appendChild(foot);`):

```javascript
  // ----- foot: Open run (card only) + submit -----
  const foot = document.createElement('div');
  foot.className = 'qpanel-foot';
  // §4.3: the CARD's clarify footer offers a way into the detail page; the detail
  // page's own panel omits it (you are already there). The card is identified by
  // the `.run-card` ancestor renderQpanel always paints into (it reads r.el, and
  // r.el IS the card) — a test that never depends on Task 6's attach order.
  if (panel.closest && panel.closest('.run-card')) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'qopen';
    open.textContent = 'Open run';
    open.addEventListener('click', (e) => {
      // stopPropagation: the card-header navigation listener and the #run-list
      // delegate both sit above this node.
      e.stopPropagation();
      location.hash = `running/${r.runId}`;
    });
    foot.appendChild(open);
  }
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'btn-go';
  const NS = 'http://www.w3.org/2000/svg';
  const play = document.createElementNS(NS, 'svg');
  play.setAttribute('width', '14');
  play.setAttribute('height', '14');
  play.setAttribute('viewBox', '0 0 24 24');
  play.setAttribute('fill', 'currentColor');
  const tri = document.createElementNS(NS, 'path');
  tri.setAttribute('d', 'M6 4l14 8-14 8V4Z');
  play.appendChild(tri);
  submit.appendChild(play);
  submit.appendChild(document.createTextNode('Submit answers & resume'));
  foot.appendChild(submit);
  panel.appendChild(foot);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-question-panel.test.mjs`

Expected: PASS — `# pass 9`, `# fail 0`.

- [ ] **Step 7: Prove the existing behaviour suites are untouched**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-question.test.mjs test/ui-question-agent.test.mjs test/ui-cost-paused.test.mjs test/ui-running-pause-fixes.test.mjs`

Expected: PASS, `fail 0`. `ui-question.test.mjs` asserts `.qblock`, `.qopt`,
`.qopt.sel`, `aria-pressed`, `.qcount`, `.qpanel-foot .btn-go`, gate buttons and
`.qpanel.hidden` — every one of those class names and handlers survives this task
unchanged; only their declarations moved.

- [ ] **Step 8: Commit**

```
git add ui/public/style.css ui/public/app.js test/ui-question-panel.test.mjs
git commit -m "feat(running): restyle the question panel and add an Open run action"
```

- [ ] **Step 9: Write the failing test — the "N of M answered" counter**

Append to `test/ui-question-panel.test.mjs`:

```javascript
// --- T11: the "N of M answered" counter (spec §4.3 card header, §5.4 detail footer) ---

test('the answered counter starts at 0 of N and tracks option picks', async () => {
  const ctx = await boot();
  const { window } = ctx;
  const doc = window.document;

  ctx.recv({ type: 'run-created', runId: 'r1', title: 'Counter run', projectDir: '/p', kind: 'run', status: 'running', startedAt: new Date().toISOString() });
  ctx.recv({
    type: 'question', runId: 'r1', id: 'q-1', kind: 'clarify', agent: 'refiner',
    questions: [
      { id: 'a', text: 'First?',  options: ['A', 'B'] },
      { id: 'b', text: 'Second?', options: ['C', 'D'] },
    ],
  });
  await ctx.settle();

  const card = doc.querySelector('#run-list .run-card[data-run-id="r1"]');
  const count = card.querySelector('.qpanel .qanswered');
  assert.ok(count, 'the panel header carries an answered counter');
  assert.equal(count.textContent, '0 of 2 answered');

  card.querySelectorAll('.qpanel .qblock')[0].querySelector('.qopt').click();
  await ctx.settle();
  assert.equal(count.textContent, '1 of 2 answered', 'picking an option counts it');

  card.querySelectorAll('.qpanel .qblock')[1].querySelector('.qopt').click();
  await ctx.settle();
  assert.equal(count.textContent, '2 of 2 answered');
});

test('free text counts as answered, and clearing it counts back down', async () => {
  const ctx = await boot();
  const { window } = ctx;
  const doc = window.document;

  ctx.recv({ type: 'run-created', runId: 'r1', title: 'Counter run', projectDir: '/p', kind: 'run', status: 'running', startedAt: new Date().toISOString() });
  ctx.recv({
    type: 'question', runId: 'r1', id: 'q-1', kind: 'clarify', agent: 'refiner',
    questions: [{ id: 'a', text: 'Free?', options: ['A'] }],
  });
  await ctx.settle();

  const card = doc.querySelector('#run-list .run-card[data-run-id="r1"]');
  const count = card.querySelector('.qpanel .qanswered');
  const free = card.querySelector('.qpanel .qfree');

  free.value = 'my own answer';
  free.dispatchEvent(new window.Event('input', { bubbles: true }));
  await ctx.settle();
  assert.equal(count.textContent, '1 of 1 answered');

  free.value = '';
  free.dispatchEvent(new window.Event('input', { bubbles: true }));
  await ctx.settle();
  assert.equal(count.textContent, '0 of 1 answered', 'an emptied free-text field is not an answer');
});

test('the counter is unhidden only for the clarify body', async () => {
  const ctx = await boot();
  const { window } = ctx;
  const doc = window.document;

  ctx.recv({ type: 'run-created', runId: 'r1', title: 'Gate run', projectDir: '/p', kind: 'run', status: 'running', startedAt: new Date().toISOString() });
  ctx.recv({
    type: 'question', runId: 'r1', id: 'q-1', kind: 'gate', agent: 'reviewer',
    issues: [{ severity: 'major', title: 'Something', detail: 'd', location: 'f.js:1' }],
  });
  await ctx.settle();

  const card = doc.querySelector('#run-list .run-card[data-run-id="r1"]');
  const count = card.querySelector('.qpanel .qanswered');
  assert.ok(count.hidden, 'a review gate has nothing to count');
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-question-panel.test.mjs`
Expected: FAIL — `the panel header carries an answered counter` (the `.qanswered` node does not exist yet).

- [ ] **Step 11: Add the counter node to the panel head**

In `renderQpanel` (`app.js:3978`), where `.qpanel-head` is built, append the counter after the existing head content. It is hidden by default and only the clarify body unhides it:

```javascript
const answered = doc.createElement('span');
answered.className = 'qanswered';
answered.hidden = true;
head.appendChild(answered);
```

- [ ] **Step 12: Recount on every answer change**

Add the recount helper next to `renderClarifyBody` (`app.js:4033`), and call it once after the panel is built and again from the existing `.qopt` click and `.qfree` input handlers — the same handlers that already write into the panel's answer slots:

```javascript
// Count a question as answered when its slot holds a non-empty value — either a
// picked option or typed free text. The slots are per-panel (see T6), so the
// card and the detail page count their own panels independently.
function refreshAnsweredCount(panel, slots) {
  const el = panel.querySelector('.qanswered');
  if (!el) return;
  const total = slots.length;
  if (!total) { el.hidden = true; return; }
  const done = slots.filter((v) => v != null && String(v).trim() !== '').length;
  el.textContent = `${done} of ${total} answered`;
  el.hidden = false;
}
```

Call it at the end of `renderClarifyBody`, and at the end of each `.qopt` / `.qfree` handler, passing that panel's own slot array.

- [ ] **Step 13: Style the counter**

Append to the question-panel CSS block in `ui/public/style.css`:

```css
.qpanel .qanswered{margin-left:auto;font:400 11.5px var(--mono);color:var(--amber-ink);}
.rd-questions .qpanel .qanswered{font-size:12px;}
```

`.qpanel-head` is already a flex row, so `margin-left:auto` parks the counter on the right of the card header. On the detail page the same node sits in the footer rule that spec §5.4 describes; keep `.qpanel-foot{justify-content:space-between}` there so the counter takes the left slot and the submit button the right.

- [ ] **Step 14: Run the test to verify it passes**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-question-panel.test.mjs`
Expected: PASS, all cases.

- [ ] **Step 15: Run the existing question suites**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-question.test.mjs test/ui-question-agent.test.mjs`
Expected: PASS — the counter is additive; no existing assertion reads `.qpanel-head`'s child count.

- [ ] **Step 16: Commit**

```
git add ui/public/app.js ui/public/style.css test/ui-question-panel.test.mjs
git commit -m "feat(running): count answered questions in the clarify panel"
```

---

### Task 12: CSS polish, dead-code sweep, full-suite green

**Files:**
- Modify: `ui/public/style.css` (EOF: the four `wr-*` keyframes + one reduced-motion block; `:587-589` `.run-foot`/`.chip.qcount`; `:192` + `:560` `.run-top`; `:1167-1211`, `:1222`, `:1238` the `.subs-*` block)
- Modify: `ui/public/app.js:11027-11044` (`subsPillText`), `:11045-11172` (`paintSubsBar`), `:11173-11232` (`renderSubsTree`), `:2719/:2720/:2722` (`__np` exports), `:11768-11777` (the `.run-top` listener, if Task 3 left it)
- Test: `test/ui-theme.test.mjs`, `test/ui-shell.test.mjs`, `test/ui-run-flow-css.test.mjs`, and the seven suites whose subject this task removes (below)

**Interfaces:**
- Consumes: everything Tasks 1–11 produced; `tokenValue(name)` (`test/ui-theme.test.mjs:8`), `ruleBody(selector)` (`test/ui-run-flow-css.test.mjs:18-22`)
- Produces: no new runtime API. Stylesheet invariants other tasks depend on:
  `@keyframes wr-spin | wr-pulse | wr-rise | wr-blink` declared exactly once each,
  and one `@media (prefers-reduced-motion: reduce)` block that is the LAST block in
  the file

- [ ] **Step 1: Write the failing stylesheet test**

Append to `test/ui-theme.test.mjs`:

```javascript
test('running-redesign tokens: the four genuinely new literals', () => {
  assert.equal(tokenValue('amber-wash'), '#fef7ec');
  assert.equal(tokenValue('amber-wash-2'), '#fefaf3');
  assert.equal(tokenValue('amber-line'), '#f5d9a8');
  assert.equal(tokenValue('radio-ring'), '#d6d6d2');
});

test('the running redesign spends tokens, not raw hex', () => {
  // Each new literal may appear exactly ONCE — in its own :root declaration.
  for (const lit of ['#FEF7EC', '#FEFAF3', '#F5D9A8', '#D6D6D2'])
    assert.equal((css.match(new RegExp(lit, 'gi')) || []).length, 1,
      `${lit} may appear only in its :root token`);
  // Spec §9 lists these two as "new". They are not: they are --violet and
  // --peach-ink. Each must still appear exactly once — its own token.
  for (const lit of ['#8C7FD6', '#B5751A'])
    assert.equal((css.match(new RegExp(lit, 'gi')) || []).length, 1,
      `${lit} already has a token — use var(), do not restate it`);
  assert.ok(!/#FFFDF8/i.test(css), 'the old .qpanel wash literal is gone');
});

test('the four wr-* keyframes are declared exactly once each', () => {
  for (const n of ['wr-spin', 'wr-pulse', 'wr-rise', 'wr-blink'])
    assert.equal((css.match(new RegExp(`@keyframes\\s+${n}\\b`, 'g')) || []).length, 1,
      `@keyframes ${n} must be declared exactly once`);
});

test('the reduced-motion guard comes AFTER every wr-* animation it neutralizes', () => {
  // @media contributes NO specificity, so source order is the only thing that
  // makes `animation:none` win — the same reason style.css:748-759 and :1927-1932
  // give for their placement.
  const guard = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(guard > 0, 'no reduced-motion block found');
  const lastUse = Math.max(...['wr-spin', 'wr-pulse', 'wr-rise', 'wr-blink']
    .map((n) => css.lastIndexOf(`animation:${n}`)));
  assert.ok(lastUse > 0, 'no `animation:wr-*` declaration found at all');
  assert.ok(lastUse < guard,
    'every `animation:wr-*` rule must precede the final prefers-reduced-motion block');
  assert.ok(css.slice(guard).includes('animation:none'),
    'the final reduced-motion block must actually neutralize something');
});

test('the redesign orphans are gone from the stylesheet', () => {
  for (const dead of ['.run-foot', '.chip.qcount', '.run-top', '.subs-bar', '.subs-panel',
    '.btn-subs', '.subs-legend', '.subs-step', '.subs-tree'])
    assert.ok(!css.includes(dead), `${dead} still present in style.css`);
  // …but the halves History's Agents tab still emits survive.
  assert.ok(css.includes('.hd-ag-head .subs-stat'), '.subs-stat kept for the History Agents tab');
  assert.ok(css.includes('.hd-ag-row .st'), '.st kept for the History Agents tab');
  assert.ok(/\.subs-skills\s*\{/.test(css), '.subs-skills kept — skillPillsHtml still emits it');
  assert.ok(css.includes('.skill-pill'), '.skill-pill kept');
  assert.ok(css.includes('.agent-type-pill'), '.agent-type-pill kept');
  assert.ok(css.includes('.graphify-pill'), '.graphify-pill kept');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-theme.test.mjs`

Expected: FAIL — "the four wr-* keyframes are declared exactly once each" fails with
`Expected values to be strictly equal: 0 !== 1` for `@keyframes wr-spin` (unless an
earlier task already added them), and "the redesign orphans are gone" fails on
`.run-foot still present in style.css`.

- [ ] **Step 3: Add the keyframes and the reduced-motion guard**

First check what is already there:

```
grep -n "@keyframes wr-" ui/public/style.css
```

Add only the missing names. Append at the very END of `ui/public/style.css`:

```css

/* ---------- Running redesign: shared keyframes ---------- */
/* Declared ONCE, at EOF. @keyframes are name-resolved, not cascaded, so their
   position relative to the rules that use them is irrelevant — but the guard
   below is cascaded, and it must follow every `animation:wr-*` declaration in the
   file (see the notes at :748-759 and :1927-1932). Values are the mockup's. */
@keyframes wr-spin{to{transform:rotate(360deg);}}
@keyframes wr-pulse{0%,100%{opacity:1;}50%{opacity:.32;}}
@keyframes wr-rise{0%{transform:translateY(10px);opacity:0;}100%{transform:translateY(0);opacity:1;}}
@keyframes wr-blink{0%,49%{opacity:1;}50%,100%{opacity:0;}}

/* ---------- reduced motion for the Running redesign ---------- */
/* MUST be the LAST block in the file: @media contributes no specificity, so a
   (0,1,0) `animation:none` here would LOSE the source-order tie against any
   `animation:wr-*` rule appended after it — exactly the trap documented at
   :748-759 for the four legacy names and at :1927-1932 for the ship-it set. */
@media (prefers-reduced-motion: reduce){
  /* #stop-modal is a top-level overlay, outside the shell — named explicitly. */
  #stop-modal .card{animation:none;}
  /* One scoped blanket for everything inside the two Running screens: the status
     avatar spinner, the pulsing status/agent accent dots, the live-log caret and
     the question panel's rise. `!important` (like the `*{transition:none !important}` rule at
     :762) because enumerating them would restate selectors owned by Tasks 3/6/7/8
     and silently rot the day one of them is renamed. The run-graph's own reduced
     motion block (:1253) is unaffected — it substitutes box-shadows, and only its
     redundant `animation:none` is overridden. */
  .run-shell *{animation:none !important;}
}
```

> NOTE: the blanket is deliberate. Its alternative — listing `.rc-sic svg`,
> `.rd-status .rd-dot`, the log caret and the agent-row dots — would hard-code
> class names this task does not own. If a later task prefers the enumeration, it
> can replace the blanket without moving the block.

- [ ] **Step 4: Verify the tokens and re-run**

```
grep -n -- '--amber-wash\|--amber-line\|--radio-ring' ui/public/style.css
```

All four must appear exactly once, inside `:root` (Task 11 added them). If any is
missing, add it there now.

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-theme.test.mjs`

Expected: the token / keyframe / reduced-motion cases PASS; "the redesign orphans
are gone from the stylesheet" still FAILS on `.run-foot still present in style.css`.

- [ ] **Step 5: Sweep the card-chrome orphans (verify, then remove)**

Run each grep and act only on a zero-caller result:

```
grep -rn "renderFocusView" ui/ test/
grep -rn "run-foot" ui/ test/
grep -rn "run-top" ui/ test/
grep -rn "class=\"chip\"\|'chip'" ui/public/ test/
grep -rn "qcount" ui/public/ test/
```

Expected findings and the action for each:

- **`renderFocusView`** — Task 5 deletes the function (`app.js:11497`) and its call
  site (`app.js:11412`). If the grep still reports either, delete them now;
  otherwise record "already removed by Task 5" and move on.
- **`.run-foot`** — the markup went with Task 3's `#run-card-tpl` rewrite. Delete
  the orphaned rule `ui/public/style.css:587`.
- **`.run-top`** — delete `#run-list .run-card .run-top { cursor: pointer; }`
  (`style.css:192`) and `.run-top{…}` (`style.css:560`), and, if Task 3 left it, the
  focus listener at `app.js:11768-11777` (`$('#run-list')?.addEventListener('click', …)`
  ending with `location.hash = \`running/${id}\``).
- **`.chip`** — **KEEP** `style.css:588`. `renderWorkspaceMembers` still emits
  `chip.className = 'chip'` (`app.js:5022`) and `test/ui-target-selector.test.mjs:88`
  asserts `#ws-members .chip`, so the rule has a live consumer. Delete only
  `.chip.qcount` (`style.css:589`): `renderQpanel` sets `count.className = 'qcount'`
  (`app.js:4012`) — never `chip qcount` — so that compound has never matched.
- **`.chip` in Running tests** — `test/ui-duration.test.mjs:185` and
  `test/ui-stepper.test.mjs:41` read `#run-list [data-run-id] .chip` (the old
  `.run-foot` phase chip). Task 4 repoints them at the compact row's step chip. If
  the grep shows them still on `.chip`, that is a Task 4 regression — fix it there,
  not by resurrecting `.run-foot`.

- [ ] **Step 6: Run the affected suites**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-theme.test.mjs test/ui-duration.test.mjs test/ui-stepper.test.mjs test/ui-target-selector.test.mjs test/ui-scroll.test.mjs`

Expected: PASS, `fail 0`. `ui-theme`'s orphan case now fails only on the `.subs-*`
names (next step).

- [ ] **Step 7: Sweep the sub-agent painters (verify, then remove)**

```
grep -n "paintSubsBar\|renderSubsTree\|subsPillText" ui/public/app.js
grep -rln "paintSubsBar\|renderSubsTree\|subsPillText" test/
grep -n "subGroupStatus\|skillPillsHtml\|agentTypePillHtml\|graphifyCountPillHtml" ui/public/app.js
```

Expected: in `ui/public/app.js` the only remaining hits for the first grep are the
three definitions (`subsPillText` `:11027`, `paintSubsBar` `:11045`, `renderSubsTree`
`:11173`) plus their `window.__np` exports (`:2719`, `:2720`, `:2722`) — Task 4 removed the
`paintSubsBar(…)` call in `paintRunCard` (`app.js:11334-11343`) and the `.subs-bar`
slot from `#run-card-tpl` (`index.html:367-375`). Zero app callers ⇒ delete all
three functions and drop `subsPillText,` `paintSubsBar,` `renderSubsTree,` from the
`__np` literal.

The third grep must still show live callers at `app.js:10615`, `:10628-10630` and
`:10652-10657` — `buildHdAgents` — so `subGroupStatus`, `skillPillsHtml`,
`agentTypePillHtml`, `graphifyCountPillHtml` and `subFanHtml` all **stay**, along
with every `__np` export of them.

Then delete the CSS the removed painters owned, `ui/public/style.css`:
- `:1167-1189` — the comment, `.subs-bar`, `.subs-bar[hidden]`, `.btn-subs` and its
  five descendants, `.subs-panel`, `.subs-panel[hidden]`, `.subs-legend` ×4,
  `.subs-step`, `.subs-step:first-of-type`, `.subs-step-head`, `.subs-step-head .dot`,
  `.subs-step-head b`
- `:1199-1207` — `.subs-step-head .subs-n`, `.subs-step .subs-empty`, `.subs-tree`,
  `.subs-tree li`, `li::before`, `li::after`, `li .led`, `li .led.on`, `li .ag-name`
- `:1216` — `.subs-tree li{flex-wrap:wrap;}`
- and the `.subs-*` HALF of each shared selector list, keeping the `.hd-ag-*` half:
  `:1195-1198` (`.subs-step-head .subs-stat…` → drop), `:1208-1211`
  (`.subs-tree li .st…` → drop), `:1222` (`.subs-tree li .subs-skills` → drop),
  `:1238` (`.subs-tree li .agent-type-pill` → drop). The bare `.subs-skills{…}`
  (`:1215`), `.skill-pill*`, `.agent-type-pill` and `.graphify-pill` rules stay —
  `skillPillsHtml` still emits `<div class="subs-skills">`.

- [ ] **Step 8: Repoint the seven suites whose subject was just removed**

`grep -rln "paintSubsBar\|renderSubsTree\|subsPillText" test/` lists eight files;
`test/ui-history-detail.test.mjs:1338` is a comment only — leave it. For the other
seven:

- `test/ui-subagent-pill.test.mjs` — the whole file drives `subsPillText` and
  `paintSubsBar`. **Delete the file** (4 tests).
- `test/ui-subagent-tree.test.mjs` — delete the three `renderSubsTree` tests
  (`:48`, `:92`, `:110`); keep `subGroupStatus` (`:38`). (−3)
- `test/ui-subagent-cycle-split.test.mjs` — delete the `renderSubsTree` test
  (`:67`); keep the three projection tests. (−1)
- `test/ui-agents-dropdown.test.mjs` — delete `:50` (clones `.subs-bar` from the
  template), `:121`, `:148`, `:160`, `:175`, `:183`; keep the four
  `subsGroupsForRender` / `stepStatusByKey` / `cycleAwareLabel` tests. (−6)
- `test/ui-graphify-count-pill.test.mjs` — delete `:49`, `:66`, `:85`; keep
  `graphifyCountPillHtml` (`:39`), `onSubagent` (`:106`), `onStepGraphify` (`:114`),
  `stepGraphifyFromSteps` (`:122`). Row-order coverage survives in
  `test/ui-history-detail.test.mjs:1338`. (−3)
- `test/ui-subagent-type-pill.test.mjs` — delete `:39` and `:56`; `agentTypePillHtml`
  (`:66`) already covers "raw value, escaped, empty when absent". (−2)
- `test/ui-skill-pills.test.mjs` — **repoint, do not delete**, the three pure-render
  tests (`:40`, `:68`, `:91`) and the malformed-tag test (`:111`) onto
  `skillPillsHtml`, which is already on `__np` and is the code they actually assert.
  Delete only the §7.5 reload test (`:125`), whose chain
  (`paintSubsBar` → `renderSubsTree`) no longer exists. (−1)

  The repoint is mechanical — replace the render call and the DOM query with the
  helper and a parsed fragment. E.g. for `:40`:

```javascript
test('skillPillsHtml renders label pills, escaped and kind-classed', async () => {
  const { window } = await bootLive();
  const { skillPillsHtml } = window.__np;
  const host = window.document.createElement('div');
  host.innerHTML = skillPillsHtml(['skill:graphify', 'mcp:playwright', 'mcp:<x>']);

  const head = host.querySelector('.subs-skills');
  assert.deepEqual([...head.querySelectorAll('.skill-pill')].map((e) => e.textContent),
    ['graphify', 'playwright', '<x>']);                                   // names only, escaped
  assert.ok(head.querySelector('.skill-pill.is-mcp'), 'mcp pill carries is-mcp');
  assert.ok(head.querySelector('.skill-pill.is-skill'), 'skill pill carries is-skill');
  assert.equal(head.querySelector('.skill-pill').innerHTML, 'graphify');  // not raw "skill:graphify"
  assert.equal(skillPillsHtml([]), '', 'no skills -> no pill row');
});
```

  and apply the same substitution (`skillPillsHtml(labels)` into a scratch `<div>`,
  then the existing assertions unchanged) to `:68`, `:91` and `:111`.

- `test/ui-subagent-pulse-scope.test.mjs:87` — the graph half stays; delete the
  second half of the test body (from `// open the tree and assert NOTHING under it
  pulses` to the end) and its trailing `.subs-bar` / `.subs-panel` assertions. The
  test keeps its name and its graph-square assertions. (net 0)
- `test/ui-run-flow-css.test.mjs:170-189` — `test('Sub-agents pill: rounded button,
  sb-count blue default + grey variant, chev rotate')`. Every assertion in its body
  targets a rule Step 7 deletes (`.subs-bar`, `.btn-subs`, `.btn-subs .sb-count`,
  `.sb-count.grey`, `.subs-panel`, `.subs-panel[hidden]`, the chevron rotate).
  **Delete the whole test**; the neighbouring `.run-flow` / reduced-motion tests in
  that file are untouched. (−1)

Net for this step: **−21 tests**.

- [ ] **Step 9: Run the repointed suites**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-theme.test.mjs test/ui-subagent-tree.test.mjs test/ui-subagent-cycle-split.test.mjs test/ui-agents-dropdown.test.mjs test/ui-graphify-count-pill.test.mjs test/ui-skill-pills.test.mjs test/ui-subagent-type-pill.test.mjs test/ui-subagent-pulse-scope.test.mjs test/ui-history-detail.test.mjs test/ui-run-flow-css.test.mjs`

Expected: PASS, `fail 0` — including `ui-theme`'s "the redesign orphans are gone"
and `ui-run-flow-css` with its Sub-agents-pill test removed.

- [ ] **Step 10: Update `test/ui-shell.test.mjs`**

Three assertions change; name them exactly.

10a. `test('exactly fourteen routed views')` — **unchanged**. The Running rewrite adds
`.run-screen` divs inside the existing `<section class="view" data-view="running">`
and no new `data-view`; verify with `grep -o "data-view" ui/public/index.html | wc -l`
→ must print `14`.

10b. `test('shell hooks present (base + workspace surfaces)')` — extend the id list
with the four hooks this redesign adds:

```javascript
test('shell hooks present (base + workspace surfaces)', () => {
  for (const id of [
    'run-card-tpl', 'run-detail-tpl', 'run-shell', 'run-detail', 'stop-modal',
    'hist-card-tpl', 'hist-detail-tpl', 'shipit-modal',
    'run-list', 'nav-running-count', 'nav-history-count',
    'nav-workspaces-count', 'ws-card-tpl', 'ws-list', 'target-seg', 'target-project-pane',
    'target-workspace-pane', 'workspaceSelect', 'ws-members', 'wiz-close', 'wiz-abort', 'wiz-desc',
  ])
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
});
```

10c. `test('run-card template: 6 steps + qpanel + stop')` — the title is already
stale and the two removed slots must be asserted absent. Replace it with:

```javascript
test('run-card template v2: header cluster + graph + qpanel + stop, no run-foot / subs-bar', () => {
  const m = html.match(/<template id="run-card-tpl">([\s\S]*?)<\/template>/);
  assert.ok(m, 'missing run-card-tpl');
  const tpl = m[1];
  // The pipeline graph is JS-built: the template carries only the empty
  // .run-flow-wrap > .run-flow container the run/history graph renders into.
  assert.ok(/class="run-flow-wrap"><div class="run-flow"><\/div><\/div>/.test(tpl), 'tpl missing empty .run-flow container');
  assert.ok(!tpl.includes('data-step'), 'tpl should no longer carry static data-step stages');
  assert.ok(tpl.includes('qpanel'), 'tpl missing qpanel slot');
  assert.ok(tpl.includes('btn-stop'), 'tpl missing btn-stop');
  assert.ok(tpl.includes('rc-head'), 'tpl missing the v2 header row');
  assert.ok(!tpl.includes('run-foot'), '.run-foot removed (design §7)');
  assert.ok(!tpl.includes('subs-bar'), '.subs-bar removed (design §7)');
});
```

> NOTE: `buildLogFilterBar()` (`app.js:8066`) clones `.log-filters` out of
> `#run-card-tpl` and History depends on it, so the `.log-filters` markup must
> survive Task 4's rewrite verbatim. If 10c's `.run-flow-wrap` regex fails, the
> template's whitespace changed — fix the template, not the regex.

- [ ] **Step 11: Run the shell suite**

Run: `WORCA_HOME=.worca-cc-test node --disable-warning=ExperimentalWarning --test test/ui-shell.test.mjs test/ui-log-filters-row.test.mjs test/ui-live-log-dom.test.mjs`

Expected: PASS, `fail 0`.

- [ ] **Step 12: Full suite green**

Run: `npm test`

Expected: `fail 0`, `cancelled 0`, `skipped 0`, `todo 0`, and `pass` equal to `tests`.

The count: the branch baseline before this redesign is **2732 passing** (verified by
running `npm test` on `feat/pipeline-views` @ `a7e97ac5`, 2026-08-19 — `tests 2732 /
pass 2732 / fail 0`). Step 8 removes 21 tests; Tasks 10 and 11 add 9 each. So

```
pass = 2732 − 21 + 9 + 9 + (tests added by Tasks 1–9)  =  2729 + T1–T9
```

i.e. **at least 2729**, and `fail 0`. If anything is red, fix it here — this is the
task that owns a green suite; do not defer a failure to a follow-up.

- [ ] **Step 13: Commit**

```
git add ui/public/style.css ui/public/app.js test/ui-theme.test.mjs test/ui-shell.test.mjs \
        test/ui-run-flow-css.test.mjs test/ui-subagent-tree.test.mjs \
        test/ui-subagent-cycle-split.test.mjs test/ui-agents-dropdown.test.mjs \
        test/ui-graphify-count-pill.test.mjs test/ui-skill-pills.test.mjs \
        test/ui-subagent-type-pill.test.mjs test/ui-subagent-pulse-scope.test.mjs
git rm test/ui-subagent-pill.test.mjs
git commit -m "refactor(running): add wr-* keyframes, tokenize the new literals, drop the orphaned card chrome"
```

---
