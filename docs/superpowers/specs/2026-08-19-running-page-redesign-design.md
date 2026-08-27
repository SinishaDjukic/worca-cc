# Running Page Redesign — Design Spec

Date: 2026-08-19
Branch context: `feat/pipeline-views` (HEAD `a7e97ac5`)
Design source: `/Users/denislavprinov/Downloads/Running detail page redesign/Worca Running.dc.html` (authoritative) plus `PipelineGraph.dc.html`, which it pulls in twice via `<dc-import name="PipelineGraph" steps="{{ … }}">`. The screenshots in `uploads/` are current-state references; where they disagree with the `.dc.html`, the `.dc.html` wins.
Precedent: `docs/superpowers/specs/2026-08-18-history-detail-redesign-design.md`. This spec deliberately mirrors that one's shell, routing, and CSS patterns — History and Running should read as the same product.

## 1. Summary

Rework the Running area from "a vertical stack of one full-height live card per run" into two screens:

1. **Running list** — the same view chrome (H1, subtitle) plus a new Compact/Detailed density toggle, an inert "waiting on your answers" banner, and redesigned run cards.
2. **Run detail page** — a full-screen second panel slid in from the right, addressable at `#running/<runId>`. Sticky pill tabs (Live log / Overview / Agents) sit under a scrolling header card and the live pipeline graph.

The sidebar is **unchanged** — its nested live-run tree already matches the mockup. What changes is where a click on one of those rows lands: the new detail page instead of today's single-card focus view.

Scope is the Running view plus one new modal. History is untouched; shared internals are reused, not modified in behavior. The one shared-code change is extracting History's table-driven tab engine into a generic helper.

## 2. Locked decisions (from user Q&A — do not re-litigate)

| # | Decision |
|---|---|
| D1 | **No Diff tab.** The detail page has three tabs: Live log / Overview / Agents. A live run has no persisted patch (`diff-patch.patch` is written only at completion), and no live-diff endpoint is added. Diff stays a History-only feature. |
| D2 | **Detailed card = mockup exactly**: header + pipeline graph + live log. The current `.run-foot` row (phase chip, Pause/Resume/Stop) and the `.subs-bar` Agents disclosure are **removed from the card**. Pause/Stop become icon buttons in the card header; sub-agents live only in the detail page's Agents tab. |
| D3 | **Density: Detailed is the default, and the choice persists** in `localStorage`. |
| D4 | **Lingering finished runs stay.** A terminated-but-unacknowledged run keeps its place in the list with a done/stopped/error status avatar and status word; opening it still acknowledges and drops it. |
| D5 | **Stop confirms, from both places.** The card's Stop icon button and the detail header's Stop pill both open a dedicated "Stop this pipeline?" modal. Pause/Resume stay instant (reversible). |
| D6 | **All three question-panel kinds render in both places** — clarify questions, the blocking-issues review gate, and the recovery prompt — on the list card and on the detail page. No loss of today's inline answering. |
| D7 | **Non-pipeline runs leave the Running list.** Workspace scans and agent-generation jobs (`kind !== 'run' && kind !== 'workspace-run'`) no longer render as cards. Running is pipelines only. |
| D8 | **A run that finishes while its detail page is open keeps the page.** Status flips to the terminal family, Pause/Stop hide, the log stops growing, the graph settles, and a **View in History** link appears. No auto-redirect. |
| D9 | **The log filter bar is History's bar, verbatim** — the shared `#run-card-tpl .log-filters` clone: source / level / step / **cycle** selects, search, copy, plus the auto-scroll switch. Cycle separator rows inside the log are kept. **No** `×` clear-all button (the mockup shows one; the shared-markup constraint wins, exactly as History decided). |
| D10 | **Overview tab has three stat cards** — ELAPSED, COST SO FAR, WORKTREE. **No MODEL card**, consistent with History's D5. |
| D11 | **Cost-pause and retained-work banners render in both places** — on the list card (as today) and on the detail page above the graph (as History does). |
| D12 | **The detail header scrolls away**, exactly like History's: it is a rounded white card inside the scrolling screen, and `.rd-tabs` is `position:sticky; top:0`. |
| D13 | **The compact card keeps its model line** (current step's `model · effort`), per the mockup. D10 is a detail-page decision only. |
| D14 | **The "N pipelines are waiting on your answers" banner renders but is inert** — no click handler, matching the mockup (whose `openFirstQuestion` handler is dead code). |
| D15 | **No progress bar on the compact card.** Feedback loops make a monotonic bar dishonest and a regressing bar jumpy. The compact row is `STEP n/m` chip · step name · model. |
| D16 | **Clicking an already-finished (lingering) run opens the Running detail page in its terminal state**, not History. One click target, one destination. |
| D17 | **Code sharing: a parallel `.rd-*` implementation** that reuses only already-pure, already-dual-source helpers. History's `hd-*` painters are not refactored, with one exception: `initHdTabs` is extracted into a generic `initDetailTabs`. This keeps History's 12 jsdom suites out of the blast radius. |

## 3. Current-state anchors (verified by exploration)

### 3.1 Shell and routing
- SPA, no framework, no build step. Views are `<section class="view" data-view=…>` in `ui/public/index.html`; `VIEW_NAMES` at `app.js:11661`; `showView(name, param)` (`app.js:11663`) is the single switcher; `hashchange` (`app.js:11778`) is the single driver, with a `syncingHash` re-entry guard (`app.js:11752`). `parseHash()` (`app.js:660`) splits on the **first** `/`.
- Nav buttons never call `showView` directly — they write `location.hash` (`app.js:11756`).
- `showView` leave-guards at `app.js:11665-11692` already include `closeHistDetail({instant:true})`; Running needs the twin.
- `state.selectedRunId` (`app.js:12`) is today's focus flag: `''` = overview, otherwise `#running/<runId>` paints exactly one card.

### 3.2 Running render chain
`renderRunningView()` (`app.js:11411`) → `renderOverview()` (`11465`) or `renderFocusView(runId)` (`11497`) → `paintRunList(list, runs, emptyMsg)` (`11438`) → `buildRunCard(r)` (`10960`) / `paintRunCard(r)` (`11297`). Card template `#run-card-tpl` at `index.html:358-382`. Scroll preservation on reorder: `insertCardPreservingScroll` (`11421`).

Supporting painters: `renderRunMeta` (`10952`), `statusPill(r)` (`10924`), `paintStepper(r)` (`11240`), `paintSubsBar` (`11045`), `renderSubsTree` (`11173`), `renderQpanel(r)` (`3978`) with `renderClarifyBody` (`4033`), `renderGateBody` (`4144`), `renderRecoveryBody` (`4206`).

Run selection helpers: `overviewRuns()` (`10860`), `pipelineTabRuns()` (`10850`), `isLive` (`10831`), `isLingering` (`10837`), `isPaused` (`10845`), `isPipelineRun` (`10825`), `tabGroupRank` (`10869`), `cmpTabRuns` (`10874`), `runDotClass` (`10885`).

### 3.3 Sidebar (unchanged by this work)
Static markup `index.html:14-91`. The Running item is `index.html:26-34` (`#nav-running-rollup`, `#nav-running-count`, `#nav-paused-badge`). The nested tree host is `#nav-running-children` (`index.html:35`), painted by `renderPipelineTabs()` (`app.js:11508`) with a `host.dataset.tabsSig` rebuild gate (`11531-11546`); rows are `button.nav-child[data-child-run-id]` and click at `app.js:11606` sets `location.hash = 'running/<runId>'`. Counts: `updateNavCounts()` (`11611`), `refreshAllCounts()` (`11638`). `pipelineTabRuns()` already filters to pipelines, so the sidebar is already consistent with D7.

### 3.4 Live data flow
One broadcast WebSocket at `/ws` (client `connectWS` `app.js:284`; server `ui/server.mjs:180`, `broadcast` `:282`). Router: `handleServerMessage(msg)` (`app.js:441`); its tail (`577-585`) calls `updateNavCounts()`, `renderPipelineTabs()`, and `renderRunningView()` **only when `currentView() === 'running'`**.

Frames consumed by Running: `hello` (`onHello` `591`), `run-created` (inline `503-521`), `phase` (`onPhase` `1140`), `log` (`onLog` `3760`), `state` (`onState` `1516`), `question` (`onQuestion` `3937`), `question-resolved` (`onQuestionResolved` `1181`), `artifact` (`onArtifact` `3908`), `title` (`onTitle` `1556`), `subagent` (`onSubagent` `1589`), `stepskills` (`1612`), `stepgraphify` (`1622`), `done` (`onDone` `4382`), `error` (`onError` `4396`). Server vocabulary: `EVENT_NAMES` at `ui/server.mjs:164`. Replay on `{type:'subscribe',runId}` → `replayEntry` (`server.mjs:275`, `MAX_BUFFER=5000`) then `sendStateSnapshot` (`:256`).

A 1 s interval (`app.js:11788-11810`) ticks `.run-time` and per-node `.dur` from local state — this is what makes "elapsed" live, and the detail page must join it.

### 3.5 Run model
`runs = new Map()` (`app.js:1056`), values from `makeRun` (`1075-1119`): `{runId, title, projectDir, projectNames, status, startedAt, kind, pipelineId, pauseReason, workspaceId, workspaceName, orderKey, stepper, nodeStatus, nodeCycle, maxCellIdx, phaseKey, cycle, phaseStatus, costByNode, totalCostUsd, steps, pendingQuestion, logLines, logFilter, autoscroll, subAgents, stepSkills, stepGraphify, el, _finished}`. `acknowledged` / `lingering` are `Set`s persisted in `localStorage` (`4615-4625`).

Statuses: `created|starting|running|pausing|paused|done|stopped|error|interrupted`. `pauseReason ∈ {cost_pipeline, cost_total, usage_limit, null}`.

### 3.6 History patterns being mirrored
- Slide shell CSS `style.css:1591-1603` (`.hist-shell`, `.hist-screen`, `.hist-screen-detail`, `.detail-open`, `.no-anim`) plus the two companions `body.view-history .main` (`:222`) and `body.view-history .topnav` (`:227`), toggled from `showView` (`app.js:11713`).
- `.hist-screen-detail{padding:0}` is what lets `.hd-tabs{position:sticky;top:0}` (`style.css:1731`) pin flush; the detail re-supplies gutters via `.hd-header{margin:20px 32px 0}` (`:1615`) and `.hd-body{padding:0 32px 40px}` (`:1620`). The header therefore **scrolls with the body** — this is the D12 behavior.
- Routing: `histDetailParam` (`app.js:9186`), `routeHistoryDetail` (`9206`), `openHistDetail` (`9232`), `closeHistDetail` (`9284`), Escape handler (`10735`), `histReturnFocus` (`9204`), inert/aria-hidden management on both screens.
- Tab engine: `HD_TABS` table (`app.js:10035-10053`) + `initHdTabs` (`10062`), lazy bodies stamped `sec.dataset.loaded='1'` after the builder returns.

### 3.7 Shared helpers available for reuse
Graph: `buildRunGraph` (`907`), `paintRunGraph` (`976`), `runNode` (`855`), `manifestFor` (`712`), `manifestSig` (`720`), `locateInManifest` (`730`), `loopCounts` (`956`), `CLIENT_DEFAULT_STEPPER` (`694`).
Derivations: `durByNode` (`1264`, already takes `live`), `costByNode` (`1275`), `modelUsedByNode` (`1290`), `subAgentsForNode` (`1320`, explicitly dual-source), `subsGroupsForRender` (`1390`), `stepStatusByKey` (`1418`), `stepSkillsFromSteps` (`1433`), `stepGraphifyFromSteps` (`1445`), `cycleAwareLabel` (`1487`), `nodeLabelLookup` (`11233`), `liveTotalMs`.
Logs: `buildLogFilterBar` (`8066`), `readLogFilterFrom` (`8073`), `scheduleLogSearch` (`8086`), `fillFilterSelect` (`3791`), `appendLogRec` (`3717`), `buildLogLine` (`3597`), `buildLogSeparator` (`3695`), `trimLogDom` (`3706`), `MAX_LOG_LINES = 4000` (`3593`), `log-filter.mjs` (`compileLogFilter`, `logFacets`, `logLineVisible`), `log-line.mjs` (`projectLogRecord`, `serializeLog`, `cycleSeparatorBefore`, `logLineClass`, `logLineTime`).
Chrome: `renderCostPauseBanner` (`stats-view.mjs:244`), `renderRetainedWork` (`8611`), `addRecoveryPatchLink` (`8656`), `setupDiscardWorktreeButton` (`8677`, **not idempotent** — binds a listener per call), `confirmModal` (`6030`), `copyBranchToClipboard` (`3658`), `copyLogToClipboard` (`3627`), `flashCopyBtn` (`3647`), `hdStatCard` (`10447`), `issueList` (`8973`), `hdDot` (`9618`), `rafSafe` (`9279`), `cssEscape` (`8284`), `fmtDuration` (`1230`), `fmtUsd` (`1204`), `fmtUsd4` (`1213`), `estTitle` (`1220`), `escapeHtml` (`1189`).
Test seam: `window.__np` (`app.js:2669`).

### 3.8 Design tokens
`:root` block at `style.css:10-34` already carries every color the mockup uses: `--bg:#F1F1EF`, `--panel:#FFFFFF`, `--ink:#19191B`, `--ink-2:#5C5C63`, `--ink-3:#9A9AA1`, `--line:#ECECEA`, `--line-2:#E3E3E0`, `--field:#F6F6F4`, and the six status families (`green`/`peach`/`red`/`blue`/`violet`/`amber` × `-bg`/`base`/`-ink`), `--r-card:24px`, `--r-ctrl:14px`, `--shadow`, `--shadow-soft`, `--sans`, `--mono`. There is no dark mode and none is added.

## 4. Screen 1 — Running list

### 4.1 Chrome

```
Running                                              [≡][▤]
Pipelines executing right now
```

- H1 + subtitle keep their existing markup (`index.html:347-353`). `#running-sub` keeps its `renderOverview()` copy ("N pipelines executing · M needs your input") and `#running-status-pill` keeps its behavior.
- **Density toggle** (new), right-aligned in the topbar: `<div class="run-density" role="group" aria-label="List density">` with two `<button class="rd-seg" data-density="compact|detailed">`, each carrying `aria-pressed`, a `title` ("Compact — three runs per screen" / "Detailed — one run with graph and log") and the mockup's icons (three filled bars / an outlined card with a title bar and two dimmed lines). Active segment is `--ink` bg + white fg; inactive is transparent + `--ink-2`.
- Persistence: `localStorage['worca-cc.running.density']`, values `'compact' | 'detailed'`, **default `'detailed'`** (D3). Read once at boot into a module-level `runDensity`; the toggle writes it and repaints the list. Invalid/absent values fall back to `'detailed'`.
- **Ask banner** (new, inert — D14): renders above the list when `overviewRuns().some(r => r.pendingQuestion)`. Markup `<div class="run-ask-banner">` with a 26px `?` circle and the text "1 pipeline is waiting on your answers" / "N pipelines are waiting on your answers". No `role=button`, no `tabindex`, no listener.
  Colour: the mockup paints a soft `#FEF7EC` wash with an `#FCE8C8` circle, which is not expressible in existing tokens (an `--amber-bg` fill would swallow the circle). The banner therefore ships on the new `--amber-wash` token added in §9, with the circle inverted to `--panel` until that token lands; `--amber` border, `--amber-ink` text throughout.

### 4.2 Which runs render

`overviewRuns()` (`app.js:10860`) gains an `isPipelineRun(r)` filter (D7), making it identical in membership to `pipelineTabRuns()`. Ordering is unchanged: `cmpTabRuns` → needs-attention, then live, then lingering-finished, newest `orderKey` first within each group. Ordering must stay insensitive to log activity, as today.

Empty state copy stays "No active runs — start one from New." via `.run-empty`.

### 4.3 Card anatomy

`#run-card-tpl` is rewritten. Root stays `<section class="card run-card" data-run-id="">` so `paintRunList`'s reconcile, `insertCardPreservingScroll`, and every `#run-list` delegated listener keep working. A `data-density` attribute on the root selects the body.

**Header row — always present**, `.rc-head`:

1. **Status avatar** `.rc-sic` — 36px circle, `background`/`color` from the status family, `title` and `aria-label` = the status word. Glyphs:
   - `running` / `starting` → arc spinner, `animation: wr-spin 1.15s linear infinite` (blue family)
   - pending question → `?` (amber family)
   - `paused` / `pausing` / `interrupted` → pause bars (amber family)
   - `done` → check (green family)
   - `stopped` → filled square (red family)
   - `error` → exclamation (red family)
   Reuse History's `.sic-*` SVG set where the glyph already exists; add the spinner and the `?`.
2. **Title + meta** `.rc-body`:
   - `.rc-title` — one line, ellipsized. Keeps `.title-provisional` styling while a title is provisional.
   - `.rc-meta` — accent dot · status word (colored per family) · `started HH:MM:SS` · **elapsed** (bold mono) · **cost** (bold mono). Status word and family come from `statusPill(r)` (`app.js:10924`) **reused as-is** — it already emits every phrase the mockup needs, including "Paused · awaiting answers", "Paused · cost limit", "Paused · total budget", "Done", "Stopped", "Error". The middot separators use the bold-mono `·` treatment.
   - `.rc-branch` — `base →` grey mono + branch copy chip (`min-width:12ch`, `--field` fill, copy glyph, `stopPropagation`, "Copied" feedback for ~1.5 s via `copyBranchToClipboard`/`flashCopyBtn`). Hidden when the run has no feature branch; the `base →` prefix hides when no source branch is known.
   - Retained-work badge and the pause caption keep their current placement in this block.
3. **Action cluster** `.rc-acts` (all `stopPropagation`):
   - Question-count pill (`.rc-qpill`) when a question is pending — amber, "1 question" / "N questions".
   - **Pause/Resume** 30px icon button `.btn-pause` / `.btn-resume` — amber outline; icon and `title` swap on state. Existing handlers `pauseRun` (`7831`) / `resumeRunFromCard` (`7908`) and the total-budget gating in `paintRunCard` are preserved; only the markup moves.
   - **Stop** 30px icon button `.btn-stop` — red outline. Now opens the stop modal (D5) instead of calling `stopRun` directly.
   - **Chevron** `.rc-open` — 30px, inverts to ink on hover; navigates to the detail page.

**Compact body** (`data-density="compact"`), `.rc-compact`: `STEP n/m` chip (status-family tinted, bold mono) · step name (`font:600 14.5px`) · model (`model · effort`, grey mono — D13). `n` is the frontier node index + 1 and `m` is the total node count, both from the run's manifest via `manifestFor`/`runGraphNodeIds`. No progress bar (D15).

**Detailed body** (`data-density="detailed"`), `.rc-detailed`, `cursor:default` with a `stopPropagation` guard so clicks inside do not navigate:
- `.run-flow-wrap > .run-flow` — the existing graph, built by `buildRunGraph` and painted by `paintStepper(r)`. Unchanged.
- Live log block — `.run-log` with `.run-log-head` (label "Live log", the `.log-filters` bar, the `.switch.autoscroll` switch) and `.log`. The bar is the existing shared markup (D9): source / level / step / cycle selects, search, copy.

**Question panel** `.qpanel` — rendered for both densities when a question is pending (D6). All three bodies (`renderClarifyBody`, `renderGateBody`, `renderRecoveryBody`) keep their logic and handlers; only styling changes to the amber panel: `--amber-bg`-family fill, numbered 19px ink circles, option buttons that go green-tinted when picked (`--green-bg` fill, `--green` border, filled radio + white check), a free-text input that turns white with a green border once it holds a non-option value, and a right-aligned footer. The clarify footer gains the mockup's secondary **Open run** button next to **Submit answers & resume**.

**Banners** — the cost-pause banner (`renderCostPauseBanner`) and the retained-work banner (`renderRetainedWork` + `addRecoveryPatchLink` + `setupDiscardWorktreeButton`) keep their current card placement (D11).

### 4.4 Interaction

- Click anywhere on the header (excluding buttons, inputs, `.qpanel`, and the detailed body) → `location.hash = 'running/<runId>'`. The chevron fires the same. This replaces today's `.run-top` focus listener (`app.js:11768`).
- The card header becomes focusable (`role="button"`, `tabindex="0"`); Enter/Space opens the detail page.
- Sidebar `.nav-child` click keeps writing `#running/<runId>` (`app.js:11606`) — unchanged code, new destination.
- Opening a lingering run still calls `acknowledgeRun(runId)` (`app.js:11720-11725`), so it drops from the list on Back (D4, D16).

## 5. Screen 2 — Run detail

### 5.1 Shell, routing, transition

Markup mirrors History:

```html
<section class="view hidden" data-view="running">
  <div class="run-shell" id="run-shell">
    <div class="run-screen run-screen-list">  <!-- topbar + banner + #run-list --> </div>
    <div class="run-screen run-screen-detail" id="run-detail" aria-hidden="true" inert></div>
  </div>
</section>
<template id="run-detail-tpl"> … </template>
```

CSS mirrors `style.css:1591-1603` under `.run-shell` / `.run-screen` / `.run-screen-list` / `.run-screen-detail` / `.run-shell.detail-open` / `.run-shell.no-anim`, plus `body.view-running .main` and `body.view-running .topnav` companions matching `:222` and `:227`. `showView` toggles `body.view-running` next to `view-history` (`app.js:11713`).

- Route: `#running` = list; `#running/<runId>` = detail. `runId` is opaque and slash-free, so `parseHash()`'s first-slash split is sufficient — no `parseHistDetailParam` equivalent is needed.
- `showView('running', param)` calls `routeRunDetail(param, {instant: prevView !== 'running'})`, which opens or closes the detail screen. `state.selectedRunId` is retained as the "which run is open" flag, but it now gates the detail screen rather than the list contents.
- Open: add `.detail-open` to `#run-shell`, set `aria-hidden=false` and remove `inert` on `#run-detail`, set both on `.run-screen-list`, focus `.rd-back`, reset the detail scroll to 0.
- Close: reverse, restore focus to the originating card (re-query by `data-run-id`, since a repaint may have replaced the node), and empty `#run-detail` on `transitionend` guarded on `e.target === host && propertyName === 'transform'`, with a ~600 ms fallback timer — the exact `closeHistDetail` recipe (`app.js:9284`).
- Detail→detail hops (clicking another run in the sidebar while a detail is open) skip the close path; the screen is rebuilt in place for the new run.
- Back paths: the header Back button, Escape (gated on `currentView() === 'running'` and deferring to any open modal), and browser Back — all land on `#running`.
- Deep link / reload on `#running/<runId>`: boot straight into the detail with no animation. If the run is not in the `runs` Map after `hello` has been processed, bounce to `#running` (today's `renderFocusView` behavior).
- Leaving the view: `showView`'s leave-guard calls `closeRunDetail({instant:true})`.

### 5.2 Header card

`.rd-header` — white, `--r-card`, `--shadow`, `margin:20px 32px 0`, inside the scrolling screen (D12).

- **Row 1**: `.rd-back` pill (chevron-left + "Back", `aria-label="Back to running list"`) · `.rd-title` (ellipsized) · `.rd-status` pill on the right — status-family tinted, containing a 7px accent dot with `animation: wr-pulse 1.6s ease-in-out infinite` while live and `none` when parked, plus the status word.
- **Row 2** `.rd-meta`: project name · `started HH:MM:SS` · **elapsed** (bold ink mono) · **cost** (bold ink mono) · `step n/m · <step name>`. Bold-mono `·` separators, as History's `.hd-meta` does.
- **Row 3** `.rd-row3`: `base →` · branch copy button (`min-width:16ch`) + "Copied" feedback · flexible spacer · **Pause/Resume** pill (amber) · **Stop** pill (red outline).
- **Row 4** `.rd-error` — inline error slot for failed actions, hidden by default.
- **Banners** `.rd-banners`, above the graph (D11): cost-pause banner (including its "Continue without cap" → `confirmModal` → `POST /api/resume {ignoreCostCap:true}` flow) and retained-work banner. `setupDiscardWorktreeButton` is not idempotent, so the detail must bind it exactly once per screen build.

**Terminal state (D8)**: when the run's status becomes `done`/`stopped`/`error`, the Pause/Resume and Stop controls are hidden, the status pill takes the terminal family with a static dot, and a **View in History** link renders in row 3 pointing at `#history/<projectKey>/<pipelineId>`. The link is omitted when `pipelineId` is unknown.

### 5.3 Pipeline graph

`.rd-graph > .run-flow-wrap > .run-flow`, built with `buildRunGraph(host, r.stepper)` and painted with **`paintStepper(r)`'s adapter** — `live: true`, a real `activeId` from the frontier, `durByNode(r.steps, now, true)` — so the current node glows and the wires animate. This is the deliberate difference from History's `paintHistStepper`, which hardcodes `activeId:null, live:false`.

Panel styling follows the mockup: dot-grid background (`radial-gradient(circle, var(--line-2) 1.1px, transparent 1.1px)` at `22px 22px`), rounded, horizontal scroll. `.run-flow-wrap` scrollLeft is preserved across repaints, as it is on the card today.

The mockup's `PipelineGraph.dc.html` hardcodes five steps with fixed icons and copy; the real graph is manifest-driven and keeps its existing node rendering (`runNode`, `app.js:855`). The dot-grid panel, the `STEP n` labels, and the corner status badges are the parts adopted.

### 5.4 Questions panel

When `r.pendingQuestion` is set, a large amber panel renders between the graph and the tabs, with `animation: wr-rise .3s cubic-bezier(.2,.7,.3,1) both`. Same three bodies as the card (D6), at the mockup's larger detail-page metrics (22px number circles, `font:600 14px` questions, `padding:13px 16px` options, `--r-ctrl`-ish 13px radii). Footer: "N of M answered" on the left, **Submit answers & resume** ink pill on the right. Handlers are the existing `postAnswer` / `submitAnswer` paths.

### 5.5 Section tabs (sticky)

`.rd-tabs` — pill row, `position:sticky; top:0; z-index:5`, with the `linear-gradient(var(--bg) 78%, transparent)` backdrop so log lines do not bleed through. Active tab is inverted (ink fill, white text).

| Order | Tab | Badge | Visible when |
|---|---|---|---|
| 1 | **Live log** (default) | — | always |
| 2 | **Overview** | — | always |
| 3 | **Agents** | sub-agent count | always (empty state when none) |

Diff is absent (D1). Clarify is absent — live questions are a panel, not a tab.

The tab engine is History's `initHdTabs` (`app.js:10062`) extracted to a generic **`initDetailTabs(screen, tabs, ctx, {tabClass, secClass})`**: a table of `{key, label, badge(ctx), visible(ctx), build(sec, ctx)}`, lazy bodies stamped `dataset.loaded='1'` **after** the builder returns so a throw re-arms it, and per-screen state held on the screen element rather than in module globals (History's `hdTabCells`/`hdActivateTab` module globals must not be shared between two screens). History is migrated onto the extracted helper in the same change, with its behavior held constant.

Unlike History, Running's sections must **repaint on live frames**, not just build once. Each builder attaches an `update(ctx)` function to its section element. The detail repaint path calls `update` on the **active** section only; inactive sections are left untouched and are rebuilt from scratch on activation by clearing `dataset.loaded` whenever a frame arrives while they are hidden. Concretely: a section that is hidden when a `state`/`subagent` frame lands gets `dataset.loaded` cleared, so switching to it re-runs `build` against current data; the active one gets `update` and keeps its scroll position and filter state.

### 5.6 Live log tab

This is the card's **live** log pipeline, not History's fetch-once painter:

- The bar is `buildLogFilterBar()` (D9); filter state is the run's own `r.logFilter`, so the card and the detail page share one filter per run and switching between them is seamless.
- Lines come from `r.logLines`; new `log` frames append through `appendLogRec` with cycle separators via `cycleSeparatorBefore`/`buildLogSeparator`, capped by `trimLogDom` at `MAX_LOG_LINES`.
- Facets refresh as new sources/steps/cycles appear (`logFacets` + `fillFilterSelect`) — History's build-once facet fill is exactly what must not be copied.
- Auto-scroll switch bound to `r.autoscroll` via `setAutoscroll` / `maybeAutoscrollLog`.
- Copy takes all currently-matching lines via `copyLogToClipboard`.
- Viewport: white, `--line` border, 16px radius, `min-height:300px`, `max-height:520px`.

### 5.7 Overview tab

1. **Current-state banner** — white card with a status-family pill showing the current step name, plus one line of copy:
   - pending question → "Parked on `<step>` until the questions above are answered."
   - paused → "Paused by you. Agents in flight finished their checkpoint; nothing new is dispatched."
   - cost-paused → the cost-pause phrasing already used by the banner.
   - running → "`<step>` is running · cycle N." (the cycle clause is omitted when cycle ≤ 1)
   - terminal → the terminal status word plus "Finished at HH:MM:SS."
2. **Stat cards**, `repeat(auto-fit, minmax(220px,1fr))`, built with `hdStatCard` (D10 — three cards):
   - **ELAPSED** → `fmtDuration(liveTotalMs(r.steps, now))`, ticking with the existing 1 s interval; sub-line `step n/m · <step name>`.
   - **COST SO FAR** → `fmtUsd(r.totalCostUsd)` with the `estTitle` tooltip; sub-line is the per-pipeline cost cap when one is configured — read from the same budget record that `renderCostPauseBanner` already consumes (`/api/budget`, cached in `budgetState.budget`, `app.js:339`), i.e. the value that drives `pauseReason:'cost_pipeline'` — else "across N steps". Never a fabricated number.
   - **WORKTREE** → "active" while the run holds a worktree, "released" otherwise; sub-line is the worktree path in grey mono when known.
3. **Task card** — "Task" heading, the run prompt (first ~600 chars with a "Show more" expander), then chips: project name, base branch, and "N sub-agents" when any.

### 5.8 Agents tab

Groups come from the existing `subsGroupsForRender(r.subAgents, r.steps, r.stepper)` projection with `cycleAwareLabel`. Each group is a card: header = label + meta ("cycle 1 · 2m 04s · $0.00", summed from rows that carry values, omitted when none do).

Rows are a `1fr 130px 96px 84px` grid:
1. 7px status dot (`animation: wr-pulse 1.6s ease-in-out infinite` for live states, `none` otherwise) + agent name, ellipsized, with `subagent_type` as a grey suffix chip when present.
2. **Live state** word, colored per family — this replaces History's model column.
3. Duration — `durationMs`, else derived from `finishedAt − startedAt`, else blank.
4. Cost — `fmtUsd4(costUsd)`, else blank.

State vocabulary is whatever the `subagent` frames actually carry; the mockup's `queued` state is rendered only if the stream produces it, and no scheduling concept is invented for it. Skill and graphify pills from `stepSkillsFromSteps` / `stepGraphifyFromSteps` are kept in the group header, so nothing the current `.subs-bar` shows is lost.

Empty state: "(no sub-agents recorded)".

### 5.9 Live repaint contract

`handleServerMessage`'s tail (`app.js:577-585`) currently repaints the list when `currentView() === 'running'`. It gains a detail branch: when `#run-shell` has `.detail-open` and the frame's `runId` matches `state.selectedRunId`, repaint the detail screen — header meta, status pill, graph, banners, question panel, and the active tab's `update`. Frames for other runs still refresh the sidebar and counts but must not touch the open detail screen.

`log` frames take the cheap path: append to the log box directly when the Live log tab is active, without a full detail repaint.

## 6. Stop confirmation modal (D5)

A dedicated overlay, `#stop-modal`, added to `index.html` beside `#shipit-modal` and following the `.viewer-modal` conventions (fixed overlay, backdrop click + Escape to close, listener cleanup on close). `confirmModal` cannot host the identity block, so this is its own modal — the same reasoning History used for "Ship it?".

- Card: `width:min(560px,100%)`, `--r-card`, `--shadow`, `animation: wr-rise .28s cubic-bezier(.2,.7,.3,1) both`.
- Title: "Stop this pipeline?"
- Body: "Agents in flight are cancelled at their next checkpoint. The run moves to History as stopped; its worktree and branch stay in place so you can resume from there."
- Identity block: `--field` fill, 14px radius, mono — run title on one line, branch on the next.
- Buttons: **Keep running** (`--line-2` outline, white) · **Stop pipeline** (red-family fill, `--red-ink` text).
- Confirm → the existing `stopRun(runId, btn)` path (`app.js:7806`), with a busy state on the confirm button; failure renders inline in the modal.
- Opened from `.btn-stop` on the card and `.rd-stop` on the detail header. Both stamp the target `runId` on the modal.
- Under `prefers-reduced-motion: reduce` the rise animation is neutralized by the existing global rule.

## 7. Removals

- `renderFocusView` (`app.js:11497`) and its call site in `renderRunningView` — `#running/<id>` now routes to the detail screen.
- `.run-foot` from `#run-card-tpl` (`index.html:365`): the phase chip and the Pause/Resume/Stop buttons in their current position. The buttons return as header icon buttons; the chip's information moves into the compact row and the detail meta line.
- `.subs-bar` and `.subs-panel` from `#run-card-tpl` (`index.html:367-375`), the `paintSubsBar` call in `paintRunCard`, and — since that is their last call site (History's `buildHdAgents` consumes the projection directly, not these painters) — `paintSubsBar` (`app.js:11045`), `renderSubsTree` (`11173`), `subsPillText` (`11027`) and their CSS (`style.css:1169-1184`). The pure projections `subsGroupsForRender` / `cycleAwareLabel` / `stepSkillsFromSteps` / `stepGraphifyFromSteps` are kept — both History and the new Agents tab depend on them. The shared selector lists that pair `.subs-*` with `.hd-ag-*` (`style.css:1195-1198`, `:1208-1211`, `:1222`, `:1238`) lose their `.subs-*` halves rather than the whole rule.
- Non-pipeline runs from `overviewRuns()` (D7). `onScanEvent` / `onAgentGenEvent` and their wizard surfaces are untouched.
- `.run-top` click-to-focus listener (`app.js:11768`), replaced by the card-header navigation listener.
- The direct `stopRun` binding on `.btn-stop`, replaced by the modal opener.

## 8. Server changes

**None.** Every field the new screens need already arrives over `/ws` — `state` snapshots carry `steps[]`, `stepper`, `subAgents[]`, `branch{source,feature,worktreeDir}`, `totalCostUsd`, `totalActiveMs`, `prompt`; `log`/`phase`/`subagent`/`stepskills`/`stepgraphify` carry the deltas. Dropping the Diff tab (D1) is what removes the only reason to add an endpoint.

## 9. Visual language

- Existing palette and typography only. The mockup's literals map onto existing tokens one-to-one: `#F1F1EF`→`--bg`, `#fff`→`--panel`, `#19191B`→`--ink`, `#5C5C63`→`--ink-2`, `#9A9AA1`→`--ink-3`, `#ECECEA`→`--line`, `#E3E3E0`→`--line-2`, `#F6F6F4`→`--field`, and the status families onto `--{green,red,amber,blue,violet}-{bg,,-ink}`. Exactly **four** literals are genuinely new and are added as tokens rather than inline hex: the two amber panel washes `#FEF7EC` (card) and `#FEFAF3` (detail), the panel border `#F5D9A8`, and the unpicked radio ring `#D6D6D2`. Two literals the mockup uses are **already tokens** and must reuse them rather than being re-added: `#8C7FD6` is `--violet` (cycle pill) and `#B5751A` is `--peach-ink` (sub-agent log source).
- Four keyframes, added once: `wr-spin`, `wr-pulse`, `wr-rise`, `wr-blink`. `wr-blink` drives the green caret at the tail of a live log.
- New CSS is namespaced `.rc-*` (run card v2) and `.rd-*` (run detail) to avoid colliding with History's `.hd-*` and with the shared `.run-*` graph/log classes.
- `@media (prefers-reduced-motion: reduce)` blocks go **after** the rules they neutralize, per the existing convention documented in `style.css`.

## 10. Tests

Same harness as everywhere else: `node:test` + `node:assert/strict` + jsdom, booting the real `index.html` and the real `app.js` with a cache-busted import, driving fake WS frames and real DOM events. Boot helpers are copied verbatim from the nearest existing suite with a comment naming the source, per house convention.

New suites:
- `test/ui-running-card.test.mjs` — header anatomy per status, meta line, branch copy, action cluster, question pill, lingering rendering, non-pipeline exclusion.
- `test/ui-running-density.test.mjs` — toggle markup and `aria-pressed`, compact vs detailed bodies, `localStorage` persistence and the `'detailed'` default, graph/log present only in detailed.
- `test/ui-running-routing.test.mjs` — `#running/<id>` opens the detail, `.detail-open` on `#run-shell`, Back/Escape/browser-Back return to `#running`, deep-link boot, unknown id bounce, sidebar row click, leave-guard on view change, inert/aria-hidden on both screens.
- `test/ui-running-detail.test.mjs` — header fields, live graph adapter (`activeId` set, `live` true), tab visibility and default, Overview's three stat cards, Agents grouping and live state column, live-log append + facet growth, terminal-state transition and the View in History link.
- `test/ui-running-stop-modal.test.mjs` — opens from both places, identity block content, Keep running cancels, Stop pipeline calls `POST /api/stop`, Escape and backdrop close.
- CSS-only assertions via the existing `ruleBody()` idiom for the slide shell, the sticky tab bar, and the dot-grid graph panel.

Updated suites (expected churn): `ui-pipeline-tabs`, `ui-running-order`, `ui-running-nav`, `ui-scroll`, `ui-question`, `ui-question-agent`, `ui-pause-resume`, `ui-running-resume`, `ui-running-pause-fixes`, `ui-cost-paused`, `ui-live-log-dom`, `ui-log-filters-row`, `ui-subagent-*`, `ui-shell` — wherever they assert the focus view, `.run-foot`, or `.subs-bar` on a card.

`window.__np` gains the new painters that tests need to drive directly, mirroring how the graph and card painters are already exposed.

The baseline is green and must stay green: `npm test`.

## 11. Risks and open notes

- **Non-pipeline visibility (D7).** Removing scan and agent-gen cards means a scan's progress is only visible inside its wizard. Navigating away mid-scan makes it invisible until it finishes. Accepted; noted here because it is a real behavior change, not a pure refactor.
- **Tab-engine extraction (D17).** Migrating History onto `initDetailTabs` is the one place this work can regress History. It must be behavior-preserving and covered by History's existing suites running unchanged.
- **Module-global screen state.** History's `hdTabCells` / `hdActivateTab` / `histDetailState` are single-screen globals. The Running detail must keep its state on the screen element (or a dedicated `runDetailState`) so a future second live detail cannot alias it, and so the extracted tab helper stays reentrant.
- **`setupDiscardWorktreeButton` is not idempotent** — it binds a listener per call. The detail screen must call it once per build, and repaints must not re-run it.
- **Elapsed ticking on the detail page.** The existing 1 s interval walks `#run-list` cards; it must also update the open detail header and the ELAPSED stat card, without doing a full repaint.
- **Cost cap sub-line.** The Overview COST card's cap sub-line depends on where the per-pipeline cost cap is configured. If no cap is set, the sub-line falls back to "across N steps"; it never invents a number.
