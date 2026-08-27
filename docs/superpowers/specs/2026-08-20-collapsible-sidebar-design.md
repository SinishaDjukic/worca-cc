# Collapsible main menu (icon rail) for the Worca sidebar

**Date:** 2026-08-20
**Branch:** `dev`
**Source design:** `~/Downloads/colapsable area/Worca Running.dc.html` (lines 31–232)
**Status:** approved design, ready for implementation planning

---

## 1. Problem

The sidebar (`ui/public/index.html:14-90`) is a fixed 298px column
(`ui/public/style.css:68-76`). It is the only chrome above 1080px; below that
breakpoint it is hidden outright and a wrapped `.topnav` takes over
(`ui/public/style.css:911-913`, `:938-950`).

At 298px it costs a fifth of a 1440px viewport permanently, and there is no way
to trade the labels for screen space. The Running list, the Workflow Composer
canvas and the history detail view all want that width.

The `.dc.html` mock answers this with a second sidebar state: a 76px icon rail
carrying the favicon, icon-only nav buttons, square per-run tiles with the
run's initials, and a circular budget indicator pinned to the bottom. A single
chevron button toggles between the two states.

**Goal:** the same two states in the real app, with the collapsed state driven
by one class on the existing markup — not a duplicate DOM tree — so every
selector, count updater and routing test that exists today keeps working
untouched.

---

## 2. Locked decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **One DOM, CSS-driven.** The existing `<nav>` is the only nav tree. `.sidebar.collapsed` hides labels and reshapes buttons; JS only swaps the two pieces whose *content* genuinely differs (run rows → initials tiles, spend block → ring). | The mock's two `<sc-if>` subtrees would duplicate all 10 nav items and force every count/active write to hit two bindings. `navLinks` is a boot-time snapshot (`app.js:13648`) — a second tree mounted later would never be in it. |
| D2 | **Collapse is a preference, not a breakpoint.** `@media(max-width:1080px)` is untouched: the sidebar still `display:none`s and `.topnav` still takes over. The collapsed rail only ever appears ≥1080px. | Two mechanisms competing for the same width is where regressions live. `.topnav` carries its own spend readout (`#topnav-spend`) and 12 buttons with locked ordering tests (`test/ui-nav-sections.test.mjs:154-168`). |
| D3 | **State key `worca-cc.sidebar.collapsed`, default expanded**, persisted in `localStorage`, read once at boot. | Mirrors `RUN_DENSITY_KEY` (`app.js:12286-12295`) exactly, including the `try/catch` for private mode. Default expanded = today's behaviour, so an existing user sees no change until they ask for one. |
| D4 | **Settings button does NOT move.** It stays the last child of `.nav`, above `.side-foot`. | `test/ui-nav-sections.test.mjs:57-60` locks this: *"settings must not move into .side-foot — routing would silently die"*, because `navLinks` only snapshots `.nav button[data-nav]` and `.topnav button[data-nav]`. Consequence: the collapsed foot renders **gear above ring**, where the mock has ring above gear. See §9. |
| D5 | **Section labels become hairlines, in place.** `.nav-sect` keeps its text node and gets `font-size:0` + a 26×1px background when collapsed. | Matches the mock's `<div style="width:26px;height:1px">` separators while keeping "Activity"/"Build"/"Manage" in the accessibility tree. `test/ui-nav-sections.test.mjs:27-34` asserts the label DOM order — removing or re-tagging them would break it. |
| D6 | **Grey (zero / inert) count badges are hidden when collapsed**; only the green live-run badge survives, as a corner badge. | The mock shows exactly one badge on the collapsed rail. A grey `0` pinned to a 40px square is noise, and `.nav-count.n-grey` is already the app's "inert inventory" treatment (`style.css:105`). |
| D7 | **The paused badge is dropped when collapsed**; its count moves into the Running button's `title`. | `#nav-paused-badge` and `#nav-running-count` would occupy the same top-right corner. The paused signal is not lost: every paused run still shows its static amber dot on its own rail tile (`runDotClass` → `paused`). |
| D8 | **Run tiles reuse `pipelineTabRuns()` verbatim** — same source, same `cmpTabRuns` order, same click target (`location.hash = 'running/<id>'`), same `runDotClass(r)` status dot. | The collapsed rail is a different *rendering* of the child tabs, not a different list. Divergence here would mean two definitions of "what is in the sidebar". |
| D9 | **Initials = first letter of the first two whitespace-separated words of the title, uppercased.** | The mock's algorithm verbatim (`Worca Running.dc.html:1076`). |
| D10 | **`sidebarCollapsed` joins the `tabsSig` signature** in `renderPipelineTabs`. | That function early-returns on an unchanged signature (`app.js:13533-13535`). Without this, toggling the rail would leave the previous mode's rows on screen until the next server event. |
| D11 | **The ring keeps the class `spend-ind`** (as `spend-ind spend-ring`). | `app.js:435` routes the sidebar spend click via `e.target.closest('.spend-ind')` on the `#side-spend` container. Renaming the root would silently kill the click-through to `#stats`. |
| D12 | **No total limit → neutral ring**: flat track, no arc, centre shows a compact amount (`$3.2k`), `title` still ends "no total limit". | A percentage with no denominator is a fabricated number. The expanded block already says "no total limit" in this case (`stats-view.mjs:215`). |
| D13 | **The arc percentage is passed as the custom property `--ring-pct`**, and the `conic-gradient` is composed in the stylesheet — not as an inline `background` string. | jsdom's `cssstyle` drops values it cannot parse, and `conic-gradient` is not guaranteed. A custom property is stored verbatim, so the tests can assert the real number. (Plan must verify this empirically before relying on it.) |
| D14 | **One chevron SVG, mirrored by CSS.** The mock's two glyphs (`M15 6l-5 6 5 6M7 5v14` and `M9 6l5 6-5 6M17 5v14`) are exact mirror images; the collapsed state applies `transform:scaleX(-1)`. | Half the markup, and the two states can never drift apart. |

---

## 3. Structure

```
aside.sidebar[.collapsed]
├── .brand                       ← flex row; toggle pinned right
│   ├── img.logo                 ← worca-logo.png    (expanded only)
│   ├── img.logo-mark            ← worca-favicon.png (collapsed only, 32px round)
│   └── button.side-toggle       ← chevron, aria-expanded
├── nav.nav                      ← UNCHANGED markup
│   ├── button[data-nav=new].nav-cta
│   ├── .nav-sect  Activity      ← hairline when collapsed
│   ├── button[data-nav=running] + #nav-running-children
│   ├── … 8 more [data-nav] buttons …
│   ├── .nav-sep
│   └── button[data-nav=settings]
└── .side-foot > #side-spend     ← block when expanded, ring when collapsed
```

Expanded is exactly today's tree plus two nodes in `.brand`. Collapsed is the
same tree under one class.

---

## 4. Markup changes (`ui/public/index.html`)

Only `.brand` changes. Everything from `<nav class="nav">` to `</aside>` is
byte-identical to today.

```html
<div class="brand">
  <img class="logo" src="/assets/worca-logo.png" alt="Worca" />
  <img class="logo-mark" src="/assets/worca-favicon.png" alt="Worca" />
  <button type="button" class="side-toggle" id="side-toggle"
          aria-expanded="true" aria-controls="side-nav"
          title="Collapse menu" aria-label="Collapse menu">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-5 6 5 6M7 5v14"></path></svg>
  </button>
</div>
```

`ui/public/assets/worca-favicon.png` already exists (it is the page favicon,
`index.html:9`), so no new asset is needed. `<nav class="nav">` gains
`id="side-nav"` purely as the `aria-controls` target — safe against
`test/ui-nav-sections.test.mjs:19`, whose `/<nav class="nav"[\s\S]*?<\/nav>/`
is a prefix match and does not require `>` to follow the class.

---

## 5. CSS (`ui/public/style.css`)

Appended after the existing sidebar block. Every rule is scoped under
`.sidebar.collapsed`, so the expanded state cannot regress.

```css
/* transition added to the existing .sidebar rule */
.sidebar{ … transition:flex-basis .2s cubic-bezier(.65,.02,.28,1); }

.brand{ … justify-content:space-between; gap:8px; }
.brand .logo-mark{display:none;width:32px;height:32px;border-radius:50%;}
.side-toggle{display:flex;align-items:center;justify-content:center;
  width:30px;height:30px;flex:0 0 auto;border:0;border-radius:9px;
  background:transparent;color:var(--ink-3);cursor:pointer;}
.side-toggle svg{width:17px;height:17px;}
.side-toggle:hover{background:var(--field);color:var(--ink);}
.side-toggle:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}

/* ---- collapsed rail ---- */
.sidebar.collapsed{width:76px;flex:0 0 76px;padding:22px 18px 18px;}
.sidebar.collapsed .brand{flex-direction:column;gap:0;margin-bottom:8px;padding:0;}
.sidebar.collapsed .logo{display:none;}
.sidebar.collapsed .logo-mark{display:block;}
.sidebar.collapsed .side-toggle{width:40px;height:40px;margin:10px 0 8px;}
.sidebar.collapsed .side-toggle svg{transform:scaleX(-1);}

/* `:not(.rail-tile)` is LOAD-BEARING on both rules. Run tiles are <button>s
   inside .nav, so without it the first rule would force them to 40×40 and the
   second would `display:none` their .child-dot / .child-q spans — the two
   things a tile exists to show. */
.sidebar.collapsed .nav{align-items:center;}
.sidebar.collapsed .nav button:not(.rail-tile){position:relative;
  width:40px;height:40px;padding:0;gap:0;justify-content:center;}
.sidebar.collapsed .nav button:not(.rail-tile) > span:not(.nav-count):not(.nav-rollup){display:none;}
.sidebar.collapsed .nav button.nav-cta{background:var(--ink);color:#fff;}
.sidebar.collapsed .nav button.nav-cta svg{stroke:#fff;}

.sidebar.collapsed .nav-sect{width:26px;height:1px;margin:10px auto;padding:0;
  font-size:0;letter-spacing:0;background:var(--line);overflow:hidden;}
.sidebar.collapsed .nav-sep{width:26px;margin-top:auto;}

.sidebar.collapsed .nav-count{position:absolute;top:-2px;right:-2px;margin:0;
  min-width:17px;height:17px;padding:0 4px;font-size:10px;
  border:2px solid var(--panel);}
.sidebar.collapsed .nav-count.n-grey,
.sidebar.collapsed #nav-paused-badge{display:none;}
.sidebar.collapsed .nav-rollup{position:absolute;right:-1px;bottom:-1px;margin:0;}

/* ---- collapsed run tiles ---- */
/* Scoped `.nav .rail-tile` for the same reason `.nav .nav-child` is scoped
   (style.css:~150): it must outrank the generic `.nav button` rule. */
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
/* `margin:0` overrides the base .child-q's `margin-left:6px` (style.css:196),
   which would otherwise shift the absolutely-positioned badge off the corner.
   The base `animation:pulse` is kept — a waiting run should still pulse. */
.nav .rail-tile .child-q{position:absolute;top:-5px;right:-5px;margin:0;
  display:flex;align-items:center;justify-content:center;
  width:15px;height:15px;border:2px solid var(--panel);border-radius:50%;
  background:var(--amber);color:#fff;font-size:9px;font-weight:700;}

/* ---- collapsed budget ring ---- */
.sidebar.collapsed .side-foot{align-items:center;gap:8px;
  padding-top:12px;border-top:1px solid var(--line);}
.spend-ring{--ring-pct:0;--ring-fill:var(--blue-ink);--ring-track:var(--blue-bg);
  display:flex;align-items:center;justify-content:center;
  width:38px;height:38px;padding:0;border:0;border-radius:50%;cursor:pointer;
  background:conic-gradient(var(--ring-fill) 0 calc(var(--ring-pct) * 1%),
                            var(--ring-track) 0);}
.spend-ring.warn{--ring-fill:var(--amber-ink);--ring-track:var(--amber-bg);}
.spend-ring.over{--ring-fill:var(--red-ink); --ring-track:var(--red-bg);}
.spend-ring.no-limit{--ring-fill:var(--line);--ring-track:var(--line);}
.spend-ring-val{display:flex;align-items:center;justify-content:center;
  width:28px;height:28px;border-radius:50%;background:var(--panel);
  font-family:var(--mono);font-size:9.5px;color:var(--ink-2);}
.spend-ring:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
```

The reduced-motion block at `style.css:904-907` already neutralises the
flex-basis transition with its blanket `*{transition:none !important}`.

`.spend-ring` inherits `.spend-ind`'s `warn`/`over` classes but must override
its `border`, `padding` and `border-radius`; the rules above are appended
*after* `.spend-ind` (`style.css:1596`), so source order carries them.

---

## 6. `ui/public/app.js`

### 6.1 State + toggle

**Placement: immediately BEFORE the "Spend indicator" section (`app.js:339`)** —
not next to the density block at `:12285`. `paintBudget` (`:366`) reads
`sidebarCollapsed`, and a `let` declared 12k lines further down would be in its
temporal dead zone for any synchronous boot-time paint. Everything the block
calls (`renderPipelineTabs`, `paintBudget`) is a hoisted function declaration,
so an early position costs nothing.

```js
// ── Sidebar collapse (icon rail) ───────────────────────────────────────────
const SIDEBAR_KEY = 'worca-cc.sidebar.collapsed';

function readSidebarCollapsed() {
  try { return localStorage.getItem(SIDEBAR_KEY) === '1'; }
  catch { return false; }                       // private mode / storage disabled
}

let sidebarCollapsed = readSidebarCollapsed();

function applySidebarCollapsed() {
  const aside = $('.sidebar');
  const btn = $('#side-toggle');
  if (aside) aside.classList.toggle('collapsed', sidebarCollapsed);
  if (btn) {
    btn.setAttribute('aria-expanded', String(!sidebarCollapsed));
    const label = sidebarCollapsed ? 'Expand menu' : 'Collapse menu';
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
}

function setSidebarCollapsed(v) {
  sidebarCollapsed = !!v;
  try { localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? '1' : '0'); }
  catch { /* private mode */ }
  applySidebarCollapsed();
  renderPipelineTabs();   // rows ⇄ tiles (sig includes sidebarCollapsed)
  paintBudget();          // block ⇄ ring
}

$('#side-toggle')?.addEventListener('click', () => setSidebarCollapsed(!sidebarCollapsed));
applySidebarCollapsed();   // boot: restore before first paint
```

`applySidebarCollapsed()` runs at module scope so the restored state lands
before the first `renderPipelineTabs`/`paintBudget`.

### 6.2 `renderPipelineTabs` (`:13507`) — two changes

1. `sidebarCollapsed` is prepended to the `sig` array (D10).
2. Row construction forks. The existing `.nav-child` branch is untouched; the
   new branch builds tiles:

```js
function railInitials(title) {
  return String(title || '').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0].toUpperCase()).join('') || '?';
}

function tabStatusWord(r) {
  if (r.pendingQuestion != null) return 'Waiting for your input';
  if (isPaused(r)) return 'Paused';
  if (r._finished || isTerminalStatus(r.status)) {
    return r.status === 'done' ? 'Completed' : 'Did not complete';
  }
  return 'Running';
}
```

Tile: `<button class="rail-tile">` + text `railInitials(r.title)`, a
`<span class="child-dot ${runDotClass(r)}">`, and — only when
`r.pendingQuestion != null` — a `<span class="child-q">?</span>`.
`.active` when `r.runId === state.selectedRunId`, `.lingering` when
`isLingering(r)`, `title` = `` `${r.title} · ${tabStatusWord(r)}` ``,
`dataset.childRunId = r.runId`, click → `location.hash = 'running/' + r.runId`.

Note the deliberate asymmetry with the expanded row: expanded shows a
green/red `.child-q` end-marker for a finished-unseen run, collapsed does not —
the tile's corner dot already carries `green`/`red` from `runDotClass`, and a
second marker on a 36px square is unreadable.

### 6.3 `paintBudget` (`:366`)

```js
mount.replaceChildren(
  (sidebarCollapsed ? renderBudgetRing : renderBudgetIndicator)(b,
    { fmt: { usd: fmtUsd, usd4: fmtUsd4, duration: fmtDuration, estTitle } }));
```

Nothing else in `paintBudget` changes; `#topnav-spend`, the New-view gate and
`repaintCostBanners()` are all mode-independent.

### 6.4 Running-button title (D7)

`updateNavCounts()` (`:13601`) already computes `paused`. It gains one line so
the dropped badge's information survives on the rail:

```js
const rb = $('.nav button[data-nav="running"]');
if (rb) rb.title = paused ? `Running — ${live} live, ${paused} paused` : `Running — ${live} live`;
```

Set unconditionally (not only when collapsed) so the two modes cannot drift.

---

## 7. `ui/public/stats-view.mjs`

One new export, placed directly after `renderBudgetIndicator` (`:197-219`) and
sharing its `periodWord` / `fmtResetAt` / `BUDGET_WARN_AT` helpers.

```js
/** Compact centre label: $4 · $317 · $3.2k · $10k (max 4 glyphs at 9.5px). */
function compactUsd(n) {
  const v = n || 0;
  if (v >= 9950) return `$${Math.round(v / 1000)}k`;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

/** Collapsed-rail budget ring. Same click target as renderBudgetIndicator. */
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

The `title` is deliberately the same sentence `renderBudgetIndicator` builds
(`:206-208`), with the no-limit case spelled out inline because the collapsed
ring has no room for the `.spend-ind-sub` line that carries it today.

---

## 8. Testing

New file `test/ui-sidebar-collapse.test.mjs`, using both idioms already in the
suite: `ruleBody()` CSS-text assertions (as in `test/ui-pinned-sidebar.test.mjs`)
and a jsdom `boot()` (as in `test/ui-pipeline-tabs.test.mjs`).

**CSS contract**
1. `.sidebar` transitions `flex-basis`; `.sidebar.collapsed` is `76px` on both `width` and `flex`.
2. Labels hidden: the span rule exists and excludes both badge classes, **and carries `:not(.rail-tile)` on its button** — the regression guard for the bug where run tiles lose their dot and `?` badge.
3. `.nav-sect` collapses to a 26×1px hairline with `font-size:0` (text kept in the DOM).
4. `.nav-count.n-grey` and `#nav-paused-badge` are `display:none` when collapsed.
5. `.spend-ring` composes its `conic-gradient` from `--ring-pct`; `warn`/`over`/`no-limit` each redefine `--ring-fill`.
6. The expanded state is unchanged — `.sidebar` still declares `width:298px`.

**Behaviour (jsdom)**
7. Boot with no stored value → `.sidebar` has no `collapsed` class, toggle `aria-expanded="true"`.
8. Click `#side-toggle` → class added, `aria-expanded="false"`, `aria-label` becomes "Expand menu", `localStorage['worca-cc.sidebar.collapsed'] === '1'`.
9. Second boot with `'1'` stored → collapsed before the first paint.
10. Collapsed + `hello` with two live runs → two `.rail-tile`, no `.nav-child`; initials match D9; each carries `.child-dot` with the `runDotClass` family.
11. A run with `pendingQuestion` renders `.child-q` on its tile; the roll-up dot still un-hides.
12. Clicking a tile sets `location.hash` to `running/<id>`.
13. Toggling with runs already on screen repaints (the D10 signature regression test): rows → tiles in one synchronous toggle, no server event.
14. `#nav-running-count` still updates while collapsed; the Running button's `title` names the paused count.
15. Storage that throws (private mode) → boot does not throw, state falls back to expanded.

**Unit** — appended to `test/ui-budget-indicator.test.mjs`:
16. `renderBudgetRing` with a limit → `--ring-pct` is the rounded percentage; centre text `"63%"`.
17. ≥80% → `.warn`; `blocked` → `.over` and `--ring-pct` `100`.
18. No limit → `.no-limit`, `--ring-pct` `0`, centre `compactUsd` (`$3.2k`), title ends "no total limit".
19. Root keeps `.spend-ind` (D11) and `data-nav="stats"`.

**Pre-flight for the plan:** confirm jsdom's `cssstyle` round-trips
`style.setProperty('--ring-pct', '63')` → `style.getPropertyValue('--ring-pct')`.
If it does not, fall back to a `data-pct` attribute plus an inline
`background` string and assert the attribute instead (D13).

---

## 9. Deviations from the mock

| Mock | This spec | Why |
|---|---|---|
| Collapsed foot: budget ring above the Settings gear | Gear above ring | D4 — Settings cannot leave `.nav`, and CSS `order` cannot reorder across two parents. Purely cosmetic; reversible only by rewriting the `ui-nav-sections` invariant. |
| Collapsed rail: no History/Projects/Workspaces counts | Same (badges hidden) | D6 — matches, noted only because the *expanded* state keeps them. |
| Mock renders two separate subtrees | One tree + a class | D1. |

---

## 10. Out of scope

- Keyboard shortcut for the toggle.
- Hover flyout labels / tooltip popovers on the rail (native `title` only).
- Auto-collapse at any viewport width.
- Any change to `.topnav` or the `max-width:1080px` behaviour.
- Any change to the Running/History/Composer views themselves — they reflow
  automatically because `.main` is `flex:1;min-width:0`.

---

## 11. Clarifications Q&A

**Q: How should the collapsed rail be built in the DOM?**
A: One DOM, CSS-driven — the single existing `<nav>` restyled by
`.sidebar.collapsed`, with JS swapping only the run rows and the spend block.
(D1)

**Q: How does collapse interact with the existing <1080px rule?**
A: Collapse is a user preference only; the `display:none` + `.topnav` behaviour
below 1080px is untouched. (D2)

**Q: What does the ring show when no total budget limit is configured?**
A: A neutral full-circle track with no arc, the compact spend amount in the
centre, and the amount plus "no total limit" in the tooltip. (D12)
