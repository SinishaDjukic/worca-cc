# Post-mortem: PR #359 `worca-cc/v2-orchestrator-bfb6a0ed` (head `0e6cee6f`, base `7c390dc8`)

Read old-branch files with `git show origin/worca-cc/v2-orchestrator-bfb6a0ed:<path>`. Line anchors below are relative to that branch.

Diff vs base: **222 files, +26 013 / −11 349**. Deleted: `src/core/channels.mjs` (302), `src/core/runners.mjs` (167), `src/core/workflow-validator.mjs` (185), `ui/public/composer-core.mjs` (211).

## 1. Engine — `src/core/graph/*`

| File | LOC | Exported API |
|---|---|---|
| `ports.mjs` | 352 | `makeToken` · `classifyLoops` (Tarjan SCC + blocking-source ⇒ loop wires/inputs + condensation-topo launch order) · `firedOutputs` (conditional routing) · `resolveOrOutType` · `isReady` (firing rule) |
| `validate.mjs` | 579 | `validateGraph(template, portsFn) → {errors, warnings}` — rules V1–V21 (V22 retired), one named fn per rule |
| `scheduler.mjs` | 819 | `sliceExecutionId` · `createScheduler(opts) → {run, pause, abort, getState}` — token store, drain/launch loop, per-wire loop budgets + human gates, End completion, resume-v2 snapshot, composite fan-out driver |
| `executor.mjs` | 768 | `allocateOutputs` · `allocateVerdict` · `portIoBlock` · `selectMode` · `taskSourcedPorts` · `expandsOutputPort` · `normalizeDecomposition` · `readDecomposition` · `resolveMockRole` · `buildAgentPrompt` · `runAgentExecution` · `runClarifierExecution` · `runAnd/Or/End/Task/CombineExecution` · `readVerdict` |
| `builtin-workflows.mjs` | 49 | `deepFreeze` · `GRAPH_DEFAULT_WORKFLOW` (`wf_default` as v2) |
| `seed-templates.mjs` | 318 | `SEED_TEMPLATES` (7 hand-authored v2 graphs) · `NODE_ID_MAP` · `FB_WIRE_MAP` (V17 overlay maps) |
| `fixtures.mjs` | 211 | `FIXTURE_DEFAULT` · `FIXTURE_FLOW` · `FIXTURE_PORTS` (11 builtin keys) · `AWAIT_PORT` · `portsFnFor` |

Modified: `orchestrator.mjs` 3809 (net rewrite), `phases.mjs` 653 (was ~1456; pure prompt helpers reused by the executor), `workflows.mjs` 622 (`resolveGraph`, `buildGraphManifest`, `registryPortsFn`, CRUD), `agent-registry.mjs` 521 (`normalizeMeta`, `validateMetaV2`, `loadAgentRegistry`), `db.mjs` 1078.

### Template v2 JSON shape (verbatim, `src/core/graph/seed-templates.mjs:42` and `:66`)
```js
{ id: 'n_or', kind: 'or', x: 2010, y: 430, config: { arity: 2 } },
{ id: 'w12', from: { node: 'n_review', port: 'review' }, to: { node: 'n_or', port: 'in1' }, config: { maxCycles: 3 } },
```
Top level is **flat** — `{id, name, version:2, domain, createdAt, nodes, wires}`, never nested under `graph`. Kinds: `agent | task | and | or | combine | end`; `key` only on `agent` (V3). Ports are **not stored** — from `portsFn(node)` (agent sidecar meta + synthesized `await`). Loops derived: a wire is a loop wire iff both endpoints are in the same nontrivial SCC (or self-wire) **and** its source output is `when:'blocking'` (`ports.mjs:27-31`). Budgets on the **wire** (`config.maxCycles`), consumed at delivery.

**Token model** (`ports.mjs:31-42`): `{seq, type, path, value, meta, sourceExecutionId, forced}` — latch per input keyed `'<nodeId>.<port>'`; `consumed` keyed by bare port id (comment at `ports.mjs:38-41` warns mixing the two key spaces "silently yields never ready" — smell).

**Firing rule** (`ports.mjs:53-111`): `task` fires once; `end/and/combine` all-inputs-fresh; `or` any-fresh; agent first run waits on every wired non-loop input (loop inputs excused), re-runs on any fresh token, or with `awaitAll` on all wired non-loop fresh **or** a lone fresh loop token.

### DB
`SCHEMA_VERSION = 18`. **V17** (`applySchemaV17`, `db.mjs:828`): re-seeds saved v1 workflows as v2, rewrites `config_workflow_nodes.node_id` via `NODE_ID_MAP`, migrates `config_workflow_feedbacks` → new table `config_workflow_wires` (`db.mjs:551`) via dynamic resolver `v17ResolveWireId` (`db.mjs:795`) with `FB_WIRE_MAP` pinned fallback, **deletes un-migratable v1 rows** (`:890-893`), sweeps paused runs to interrupted (`V17_PAUSE_SWEEP_REASON`, `:901`); audit-log channel `auditV17` (`:761`). **V18** adds `pipelines.outcome` (`:943`).

### Events
Scheduler → orchestrator: **`exec`**, **`token`**, **`gate`** (`scheduler.mjs:187, 205, 590, 604`). Orchestrator fan-out (`orchestrator.mjs:1888`): `token` passes through; `gate` swallowed into audit trail; `exec` enriched with `costUsd`. UI over WS (`ui/server.mjs:160`): `exec`, `token`, `log`, `question`, `artifact`, `state`, `done`, `error`, `subagent`, `stepskills`, `stepgraphify`, `title`. `phase` still emitted internally (`orchestrator.mjs:3207`) but **not** in `EVENT_NAMES` — dead.

## 2. Composer UI — `ui/public/graph/*`

| File | LOC | Responsibility / API |
|---|---|---|
| `graph-model.mjs` | 997 | `AWAIT_PORT`, `portsFnFor`, `classifyLoops`, `resolveOrOutType`, `validateGraph` (V1–V21), `CAPTION_KINDS`, `normalizeTemplate`, `serializeTemplate`, `newNode`, `newWire`, `canWire`. **Byte-copy of `src/core/graph/{ports,validate,fixtures}.mjs`** (`graph-model.mjs:5-14`) with a `toString()` drift guard in tests. |
| `composer-editor.mjs` | 849 | chrome, pointer wiring, selection, keyboard, pan/zoom, 50-deep undo ring, dirty flag, save modal. `createComposerEditor` |
| `graph-view.mjs` | 423 | DOM cards + one SVG wire layer in `.gv-world`. `createGraphView`, `LEGEND_TEXT`, `DOT_FADE_ZOOM` |
| `run-decor.mjs` | 555 | run overlay: `decorate`, `nodeStatusMap`, `executionRows`, `antWireIds`, `manifestTemplate/PortsFn/Agents`, `legacyChipRows`, `fmtDur/fmtUsd` |
| `agents-meta.mjs` | 277 | `EMBEDDED_AGENTS` (offline builtin port table), `FLOW_PILLS`, `mergePalette`, `groupPaletteByDomain`, `paletteDesc` |
| `inspector.mjs` | 256 | `renderNodeInspector`, `renderWireInspector`, `renderEmptyInspector` |
| `graph-geometry.mjs` | 172 | `NODE_W/HEADER_H/PORT_ROW_H/…`, `nodeSize`, `portAnchor`, `bezierPath`, `snap`, `hitNode`, `hitPort`, `hitWire`, `fitBounds` |
| `graph-layout.mjs` | 154 | `rankNodes`, `autoLayout` — longest-path ranks, loop wires excluded, `x = 60 + rank*300`, barycenter, 11px snap |
| `composer-chrome.mjs` | 112 | inspector-rail disclosure + persistence. `createComposerChrome → {canvasInsetRight, destroy}` |
| `thumbnail.mjs` | 79 | `thumbnail(template, portsFn)` → `<svg>` string |
| `save-dialog.mjs` | 87 | `renderSaveDialog`, `openDialog`, `closeDialog` |

`app.js` 9207 LOC (composer block `app.js:1598-1840`, run graph `app.js:694-760`). `style.css` canvas block `:856-1000`.

### 2a. Wire dragging — pointer flow, ghost cord, glitch causes
`canvas.addEventListener('pointerdown', …)` (`composer-editor.mjs:792`); `pointermove`/`pointerup` on **`document`** (`:793-794`). On down (`:625-638`): `ev.preventDefault()`; `canvas.setPointerCapture(ev.pointerId)`; `toWorld`; gesture `{type:'wire', origin: hit, anchor: portAnchor(...)}`; `ghost.hidden=false`; `ghostPath.setAttribute('d', bezierPath(anchor, pt))`.
Ghost DOM (`:168-177`): `div.gv-ghost` > 1×1 `<svg>` > `path.wire.ghost`, appended to `view.world` (inherits pan/zoom).
`toWorld` (`:351-357`): `{x:(clientX - r.left - transform.x)/zoom, y:(clientY - r.top - transform.y)/zoom}` with `r = canvas.getBoundingClientRect()`.
Bezier (`graph-geometry.mjs:92-97`):
```js
const dx = Math.max(48, Math.min(160, Math.abs(b.x - a.x) * 0.45));
if (!loop) return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
const bow = 56 + Math.abs(a.y - b.y) * 0.2;
return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y + bow}, ${b.x - dx} ${b.y + bow}, ${b.x} ${b.y}`;
```
Hit-testing model-driven (`:360-389`): ports (`PORT_HIT_R = 14`), cards, wires (`hitWire` samples cubic 48× at tol 6). Drop legality `canWire({template, portsFn, from, to})` (`graph-model.mjs:960`).

**Glitch causes:**
1. **Ghost is a filled black blob** — only `.gv-wires .wire{fill:none}` (`style.css:931`); `.gv-wires .wire.ghost` (`:935`) never matches (ghost lives under `.gv-ghost`); `.gv-ghost.legal/.illegal .wire` set stroke only. SVG default `fill:black` paints the area under the cubic.
2. **Reverse drags draw a backwards S** — `bezierPath(anchor, pt)` always pushes control points right; drags starting on an INPUT port (legal, `orient` at `:413`) bulge rightward across the card.
3. **No rAF, no throttle** — `onPointerMove` (`:655-685`) writes DOM synchronously per event: `setAttribute('d')` + `hitTest` (which calls `classifyLoops` = Tarjan at `:379`) + `canWire` (rebuilds a Map of all nodes) + `showChip` with a **second** `getBoundingClientRect` (`:396`). Zero rAF in the whole directory.
4. **Node drag rebuilds the entire graph DOM per pointermove** — `:672` calls `view.render(tpl, {selection, report: report()})` (full V1–V21 validate) and `paintCard` does `body.replaceChildren(...kids)` (`graph-view.mjs:259`) for **every node**.
5. **No `pointercancel` / `lostpointercapture` handler** — cancelled gesture leaves ghost visible + `gesture` non-null forever.
6. **Pointer capture never released.**
7. Not causes: `user-select` handled (`style.css:857-861`), `touch-action:none` (`:859`), `.gv-wires{overflow:visible}` (`:865`), no CSS transition on `.wire`.

### 2b. Canvas controls & the pointer-capture bug
Chrome built in `composer-editor.mjs:143-162`, mounted as children of the canvas host: `.gv-zoom` cluster (−/100%/+/fit/auto-layout), `.gv-empty`, `.gv-chip`, `.gv-legend`. No minimap, no fullscreen. Inspector rail = sibling of the canvas (`index.html:805-813`), z-index 6, 280px, collapsible via `composer-chrome.mjs`.
**Pointer-capture bug**: `onPointerDown` (`:623`) has no `ev.target.closest('.gv-zoom')` bail-out → click on `+` bubbles → preventDefault + setPointerCapture → `click` retargeted to canvas → button listeners (`:802-805`) never fire; `hitTest` misses → pan gesture + `select(null)` → full re-render.
Zoom/pan (`:710-718`): plain wheel = pan; Cmd/Ctrl+wheel (and pinch) = zoom about cursor via `setZoom(zoom * Math.exp(-deltaY * 0.002), {x, y})`; middle button or space+drag = pan; drag on empty canvas = pan. Transform = single `world.style.transform = translate(x,y) scale(zoom)` (`graph-view.mjs:392`), `transform-origin:0 0`, `will-change:transform`. Clamp 0.4…1.6.
Secondary: `+`/`−` call `setZoom(z)` with no `about` (zooms about world origin); `fit()` pins bounds top-left rather than centring (`:548`); `spaceDown` set before the `isTyping` guard (`:726` vs `:727`), no `blur` reset; all key handlers on `document`, editor never destroyed on view exit (Delete/Backspace/arrows/Cmd-Z mutate the composer from other views).

### 2c. Card rendering
DOM cards + one SVG wire layer inside `.gv-world` (`graph-view.mjs:115-124`). Card = `div.node` > `div.nhead` + `div.nbody`; port = `div.prow` with `dataset.port/dir/type`, `<i class="dot">` at `left:-6.5px`/`right:-6.5px` (`style.css:914-916`); gate = `.prow.gate` with dashed `.gdot` (`graph-view.mjs:176-183`).
Nothing measured: `el.style.left/top/width/height` from `node.x/y`, `NODE_W`, `nodeSize` (`graph-view.mjs:213-216`). `nodeSize` (`graph-geometry.mjs:30-45`) = `HEADER_H + PAD_T + rows + PAD_B + 2*BORDER + footer`, rows = `nMetaIns*24 + 9 + nOuts*24 (+9+24 await) (+9+24 caption)`. `portAnchor` (`:64-79`) mirrors with magic 56/65/74. CSS box model + two functions must agree by hand.
Auto-layout (`graph-layout.mjs`): longest-path ranks, loop wires excluded, `x = 60 + rank*300`, barycenter within column, y stacked 40px gap, 11px snap. Deterministic, idempotent.

### 2d. Inspector / palette / chrome / save
Inspector (`inspector.mjs`, delegated `change` on `data-field`, `composer-editor.mjs:761-790`): agent nodes = Model + Effort selects, Research fan-out toggle (iff `meta.fanOut`), Ask questions toggle (absent if agent doesn't ask; forced+disabled if `questionsLocked`), Await all inputs; `and/or/combine` = arity stepper (floor 2) + OR resolved type; wires = `maxCycles` only; read-only port list. Every edit = `pushUndo()` + full `render()`.
Palette: click-to-spawn (not drag) (`:748-759`); spawn at `freeSlot(centerWorld())` with 24-try diagonal de-stacker (`:449-458`); domain chips collapse groups; filter hides pills; `renderPalette` preserves scrollTop manually (`:300-307`).
Top drawer: REMOVED — palette is an always-expanded card BELOW the canvas (`index.html:823-829`); `composer-chrome.mjs:9-13` documents `worca-cc.composer.drawer` as a dead localStorage key.
Save: `<dialog>` (name + domain datalist), `renderSaveDialog`/`openDialog`; POST owned by `app.js:1718 composerPersist`; button disabled from `validateGraph().errors.length` (`:228-236`); server 422 authoritative.

### 2e. Run decoration & thumbnail
`run-decor.decorate(view, stepper, decor)` (`run-decor.mjs:415`) runs after every `view.render()` (invariant enforced only by call order at `app.js:748`): rewrites status classes, sets `--c`, rebuilds `.ngate`/`.xfoot`/`.xresult`/`.fan`, then **re-sizes the card** (`card.style.height` at `:460`). Loop badges get `count×`; active trigger wires `.wire-live` (marching ants keyframes `style.css:1311-1312`, reduced-motion `:1317`). Degrades to v1 manifests (`legacyChipRows`, `:361`).
`thumbnail(template, portsFn)` → numbers-only `<svg>` string; wires anchored at card mid-height (`thumbnail.mjs:38-39`), `cx = max(2, |Δx|*0.45)` — fourth copy of the bezier constant.

## 3. Test surface
Engine (13 files, 208 tests): `graph-validate` 43 · `graph-executor` 32 · `graph-scheduler` 24 · `graph-prompt-parity` 23 · `graph-ports` 17 · `graph-seed-templates` 17 · `graph-build` 15 · `graph-decompose` 13 · `orchestrator-graph` 10 · `mock-graph` 7 · `graph-builtin-workflows` 4 · `graph-fixtures` 3 · `agent-registry-decomposer`.
UI (13 files, 214 tests): `ui-composer-editor` 39 · `ui-run-decor` 32 · `ui-composer-chrome` 25 · `ui-graph-model` 22 · `ui-graph-view` 21 · `ui-graph-geometry` 19 · `ui-agent-port-editor` 13 · `ui-graph-layout` 10 · `v1-remnants-removed` 10 · `ui-composer-wires` 9 · `ui-composer-chrome-app` 8 · `ui-graph-thumbnail` 7 · `ui-history-legacy` 6 · `ui-composer-save` 2.
Deleted: `ui-composer.test.mjs`, `ui-stepper`, `ui-run-graph`, `ui-run-graph-paint`, `workflow-validator`, `ui-node-model`, `workspace-runners`, `workspace-channel`, `ui-composer-{hint,legend,steptag,palette-desc,palette-filter}`, `stepper-rewrite`, `ui-palette-*`, `ui-phase-label`, `ui-agent-editor`.

## 4. Assessment
**Why a rebuild is justified.**
- *Duplicate-source policy is the deepest flaw.* `graph-model.mjs:5-14` sanctions a byte-identical copy of `AWAIT_PORT`, `classifyLoops`, `resolveOrOutType` and all 21 validator rules into the browser, policed by a `toString()` drift guard. 700+ LOC maintained twice because `ui/public` has no build step. Fix the build constraint, not the symptom.
- *Geometry encoded in four places that must agree by hand.* `nodeSize`, `portAnchor` magic 56/65/74, CSS box model (`style.css:886-925`), `run-decor` re-size (`run-decor.mjs:457-461`). Bezier `0.45` copied four times.
- *Render is all-or-nothing with no scheduling.* Full card rebuild + full validate per pointermove; no rAF; two `getBoundingClientRect` per wire-drag frame; `classifyLoops` 3× per repaint.
- *DOM/SVG split leaks.* Cards DOM, wires SVG, badges DOM positioned by JS from a bezier sample (`graph-view.mjs:284-291`), ghost a third SVG island with stale CSS scope.
- *Lifecycle leaky.* `destroy()` (`:837-846`) omits `saveButton` + `filter` listeners (`:800-801`); `composerLoadTemplate` (`app.js:1741-1758`) is a 13-arg copy of `app.js:1692-1707`; document key handlers never unbound.
- *Migration complexity.* V17 re-seeds, rewrites two overlay tables via dynamic resolver + pinned map (one `UNVERIFIED` entry, `seed-templates.mjs:305-307`), deletes un-migratable rows, force-interrupts paused runs.

**Worth keeping (ideas, not code).**
- Ports/wires/tokens with **derived** loops (SCC + `when:'blocking'`).
- Per-**wire** `maxCycles` with the gate at delivery.
- Numbered validator rules (V1–V21) with error text beside the check; one adapter feeding save-button state, pips, server 422.
- Genericity charter: no agent-key branches; executor keyed on `kind` + `meta.runnerType`; renderer on port `as`; mode on port freshness; decomposition contract owned by the wire.
- Injected `execute` with a `composite` discriminator — scheduler owns ids/ledger/semaphore, zero IO. Very testable.
- Model-driven hit-testing (no `elementFromPoint`).
- Shared renderer across composer / run monitor / preview with a pure decor bag.
- Auto-layout excluding loop wires from ranking.
- Frozen shipping constants re-exported as test fixtures.
