# Node-Graph v2 — P5: Composer v2 Implementation Plan

> **Status: v1 draft (contract-aligned 2026-08-27). Re-anchor + refine per the house recipe before execution — anchors valid for dev @ e6968e15 only.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 workflow composer with the v2 node-graph composer: one incremental renderer (`ui/public/graph/view.mjs`) shared by the editor, the run monitor and static previews, plus an editor (`composer.mjs`, `palette.mjs`, `inspector.mjs`, `save-dialog.mjs`) whose pointer pipeline is stage-owned, rAF-coalesced and measurement-free — the four defects the user reported (glitchy ghost cord, backwards reverse-drags, dead header buttons, laggy card drags) are made structurally impossible, not merely fixed.

**Architecture:** DOM cards (`div.node`, `transform: translate(x,y)`, explicit px height from `nodeSize`) plus ONE `svg.gv-wires` holding every wire path AND the permanent ghost path, both children of `.gv-world`, which carries the only pan/zoom transform. `.gv-stage` (absolute inset:0, `tabindex=0`) is the single pointer target and owns pointer capture; the header bar, the reason chip and the floating inspector are SIBLINGS of the stage, so a click on a button can never be retargeted by capture. Hit-testing is model-driven in world coordinates (`hitPort` r14 → `hitNode` → `hitWire`), never `elementFromPoint`, never a rect read on the move path: `pointermove` only stores the client point and schedules one `requestAnimationFrame`; `frame()` performs at most one DOM pass per animation frame and repaints only the dragged node's incident wires through a `d`-cache. Validation (`validateGraph`, V1–V21) and `classifyLoops` run once per COMMITTED mutation, never per frame. All geometry comes from `src/shared/graph/geometry.mjs` and is injected into CSS as `--gv-*` custom properties, so the stylesheet cannot drift from the formulas.

**Series position:** P5 of 8; requires P4 landed (sentinel: `export function createGraphOrchestrator` in `src/core/graph/orchestrator.mjs` and `wf_default_v2` in `src/core/workflows.mjs`); leaves dev green and shippable; the v1 engine stays live (only the v1 *composer* dies here).

**Tech Stack:** Node ≥ 22 (`node:sqlite`, `node:test`), Express server `ui/server.mjs`, vanilla ESM UI `ui/public/*.mjs` (no build step), jsdom 29 for UI tests, offline fake-claude mocks (`WORCA_MOCK=1`).

**Spec:** `docs/superpowers/specs/2026-08-26-node-graph-v2-rebuild-design.md` §7 (UNTRACKED — absent in a pipeline worktree; this plan is self-contained and repeats every rule, formula, class name and message string it needs).

**Halves:** **P5a** (renderer: `view.mjs`, geometry CSS, modes, thumbnails) ends with a green full suite and a commit at the split point. **P5b** (editor: composer/palette/inspector/save-dialog, `index.html`, `app.js`, run-setup, v1 deletion, CDP script) starts at `### — split point: P5b starts here —` and re-checks its own entry conditions, so either half can be executed as its own pipeline run.

## Global Constraints

- NEVER `git add` anything under `docs/superpowers/**`. Never `git push`. Product name in every user-facing string: **worca** (never "worca-cc" — the repo directory name is fine in paths).
- Commits: `worca: Node-graph v2 P5 — <task title>`.
- Run tests as `npm test` (full) or `node --test test/<file>.test.mjs` (one file). Baseline recorded in Task 0; final total recorded in the last task of each half.
- **Import convention** (no build step; the `..` count = the importing file's depth below the repo root, and every ui module carries a one-line header comment saying so):
  ```js
  // ui/public/app.js             (depth 2)
  import { portsFnFor } from '../../src/shared/graph/ports.mjs';
  // ui/public/graph/view.mjs     (depth 3)
  import { nodeSize } from '../../../src/shared/graph/geometry.mjs';
  ```
  Absolute specifiers (`/src/shared/...`) are FORBIDDEN — they break Node ESM, and the UI tests import `ui/public/*.mjs` as plain Node modules. No import map. The browser clamps `..` at the URL root, so `../../../src/shared/graph/geometry.mjs` from `/graph/view.mjs` resolves to `/src/shared/graph/geometry.mjs`, which P1 serves via `app.use('/src/shared', express.static(...))`.
- **NEVER reintroduce the PR #359 defects.** These are non-negotiable and each has a mutation-proof test in this plan:
  1. No on-canvas controls of any kind (no zoom cluster, no fit button, no fullscreen, no legend on the canvas). Auto-layout and Save live in the header bar; the legend lives in the agents card header row.
  2. The header bar, the reason chip and the inspector rail are SIBLINGS of `.gv-stage`, never descendants of it.
  3. `pointermove`/`pointerup` are bound on the STAGE (with pointer capture), never on `document`.
  4. No validation, no `classifyLoops`, no `render()` and no `getBoundingClientRect()` on the pointer-move path.
  5. `pointercancel`, `lostpointercapture` and window `blur` all cancel the gesture; capture is released in `finish()`.
  6. `fill:none` is a rule on the wire layer's ELEMENT selector (`.gv-wires path`), so a filled ghost blob is structurally impossible.
- jsdom 29 facts the tests depend on: `PointerEvent` and `WheelEvent` exist; `setPointerCapture`/`hasPointerCapture`/`ResizeObserver` DO NOT (every call is optional-chained and try-wrapped); `requestAnimationFrame` exists only with `pretendToBeVisual` (inject `opts.raf`); `getBoundingClientRect()` returns zeros (inject `opts.viewport`). Never wrap a jsdom `dispatchEvent` in `assert.doesNotThrow` — jsdom reports listener errors as window `error` events, so the assertion is vacuous.

---

### Task 0: Branch check, deps, baseline, predecessor sentinel

**Files:** none (verification only).

- [ ] Step 1: `git rev-parse --abbrev-ref HEAD` — you are on the pipeline's branch. By hand: `git checkout -b worca-cc/node-graph-v2-p5` off dev. NEVER `git checkout dev`; never create a branch inside a pipeline run.
- [ ] Step 2: `[ -d node_modules ] || npm ci`
- [ ] Step 3: predecessor sentinels — P4 must have landed:
  ```sh
  grep -q "export function createGraphOrchestrator" src/core/graph/orchestrator.mjs \
    && grep -q "wf_default_v2" src/core/workflows.mjs \
    && ls src/shared/graph/geometry.mjs src/shared/graph/ports.mjs src/shared/graph/validate.mjs \
         src/shared/graph/template.mjs src/shared/graph/loops.mjs src/shared/graph/layout.mjs \
         src/shared/graph/thumbnail.mjs src/shared/graph/agent-meta.mjs \
    && ls ui/public/graph/model.mjs \
    && echo P4_OK
  ```
  If this does not print `P4_OK`, STOP — P1–P4 are not in this tree and nothing in this plan can be built.
- [ ] Step 4: this plan borrows adapted code from the discarded branch. Make it fetchable (the plan EMBEDS every borrowed snippet, so this is a convenience only, and its absence must not block execution):
  ```sh
  git rev-parse --verify origin/worca-cc/v2-orchestrator-bfb6a0ed >/dev/null 2>&1 \
    || git fetch origin worca-cc/v2-orchestrator-bfb6a0ed || true
  ```
- [ ] Step 5: `npm test 2>&1 | tail -5` — record the printed pass count as **BASELINE**; it must be green before any task starts. Do not invent a number; copy what the run prints.

---

### Task 1: `view.mjs` — substrate, cards, keyed render diff, port signature

**Files:** create `ui/public/graph/view.mjs`; create `test/ui-graph-view.test.mjs`.
**Interfaces:** produces `createGraphView(host, opts) → view`. Consumes, from P2's shared core: `geometry.mjs` (`NODE_W, ROW_H, SNAP, PORT_HIT_R, WIRE_HIT_TOL, ZOOM_MIN, ZOOM_MAX, ZOOM_K, FOOT_H, EXEC_ROW_H, GEOMETRY_CSS_VARS, injectGeometry, nodeSize(node, ports, {footerRows}), portAnchor(node, ports, portId, dir), bezierPath(a, b, {mirror, loop}), bezierMid(a, b, {loop}), snap, hitNode, hitPort, hitWire, graphBounds(tpl, portsFn, {pad, footerRowsOf}), fitBounds(bounds, {width, height}, {zoomMin, zoomMax}) → {z, tx, ty}`), `ports.mjs` (`portsOf(portsFn, node) → {inputs, outputs, known, ported}`, `resolveOrOutType(tpl, portsFn, orId, seen)`), `loops.mjs` (`classifyLoops(tpl, portsFn) → {loopWireIds, loopInputs, sccOf, launchOrder}`).

`createGraphView(host, { doc, mode, portsFn, agents, raf, viewport, zoomMin, zoomMax, wheelPan })`:

| option | default | meaning |
|---|---|---|
| `doc` | `globalThis.document` | owner document (jsdom) |
| `mode` | `'edit'` | `'edit'` · `'monitor'` · `'static'` (§7.8) |
| `portsFn` | required | `(node) => {inputs, outputs}` — the SYNTHESIZING ports function (the `await` port arrives as an input with `synthetic: true`, appended LAST) |
| `agents` | `{}` | `key → meta` map (`indexByKey(list)`) for header tint / icon / display name |
| `raf` | `doc.defaultView.requestAnimationFrame` | injectable frame scheduler (jsdom) |
| `viewport` | `null` | `() => {left, top, width, height}` — injectable stage rect; when absent the view reads `stage.getBoundingClientRect()` |
| `zoomMin` / `zoomMax` | `ZOOM_MIN` / `ZOOM_MAX` (0.4 / 1.6) | per-mode clamps (monitor 0.3–1.6, static 0.3–1.0) |
| `wheelPan` | `'always'` | `'always'` · `'engaged'` — nav-controller policy (§7.8); composer passes `'always'` |

The view PREPENDS `<div class="gv-stage gv-<mode>" tabindex="0">` into `host` and never calls `host.replaceChildren()`, so sibling chrome already in the host (`.gv-chip`, `.gv-ins-rail`) survives; `destroy()` removes only the stage it created.

- [ ] Step 1: Write the failing test.

`test/ui-graph-view.test.mjs`
```js
// test/ui-graph-view.test.mjs — jsdom unit tests for the v2 graph renderer.
// jsdom 29 has NO layout (getBoundingClientRect is all-zeros), no ResizeObserver
// and no pointer capture, so the view takes injectable `raf` and `viewport`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const viewPath = new URL('../ui/public/graph/view.mjs', import.meta.url).href;

/** The proto fixture: Task(60,143) → Agent(400,80, 2 in / 2 out / await) → End(760,143). */
export function fixture() {
  return {
    id: 'wf_t', name: 'T', version: 2, domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 60, y: 143, config: {} },
      { id: 'n_agent', kind: 'agent', key: 'planner', x: 400, y: 80, config: {} },
      { id: 'n_end', kind: 'end', x: 760, y: 143, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_agent', port: 'task' } },
      { id: 'w2', from: { node: 'n_agent', port: 'plan' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
}

const BASE = {
  task: { inputs: [], outputs: [{ id: 'task', type: 'md', when: 'always' }] },
  agent: {
    inputs: [{ id: 'task', type: 'md', required: true }, { id: 'fix', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }, { id: 'review', type: 'json', when: 'blocking' }],
  },
  end: { inputs: [{ id: 'result', type: 'any', required: true }], outputs: [] },
  and: { inputs: [], outputs: [{ id: 'out', type: 'void', when: 'always' }] },
};

/** Mirrors the engine's portsFn: agents gain the synthesized `await` input LAST. */
export function portsFn(node) {
  const base = BASE[node.kind] || { inputs: [], outputs: [] };
  const inputs = base.inputs.map((p) => ({ ...p }));
  if (node.kind === 'and' || node.kind === 'or' || node.kind === 'combine') {
    const n = Number.isInteger(node.config?.arity) ? node.config.arity : 2;
    for (let i = 1; i <= n; i += 1) inputs.push({ id: `in${i}`, type: 'any', required: true });
  }
  if (node.kind === 'agent') inputs.push({ id: 'await', type: 'any', required: false, synthetic: true });
  return { inputs, outputs: base.outputs.map((p) => ({ ...p })), known: true, ported: true };
}

export function boot() {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { url: 'http://localhost:4317/' });
  const q = [];
  const raf = (fn) => { q.push(fn); return q.length; };
  const flush = () => { const list = q.splice(0, q.length); for (const fn of list) fn(); return list.length; };
  return { dom, win: dom.window, doc: dom.window.document, host: dom.window.document.getElementById('host'), raf, flush, q };
}

export const AGENTS = { planner: { key: 'planner', displayName: 'Plan', color: 'violet', icon: '<path d="M4 4h8"/>', origin: 'builtin' } };

test('createGraphView builds stage/world/wire-layer and one card per node', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: AGENTS });
  view.render(fixture(), {});
  const stage = host.querySelector('.gv-stage');
  assert.ok(stage, 'stage exists');
  assert.equal(stage.getAttribute('tabindex'), '0');
  assert.ok(stage.classList.contains('gv-edit'));
  assert.equal(host.firstElementChild, stage, 'stage is prepended, host chrome survives');
  const world = stage.querySelector('.gv-world');
  assert.ok(world.querySelector('svg.gv-wires'));
  assert.equal(world.querySelectorAll('.node').length, 3);
});
```

Append to the same file (all numbers below are the arithmetic of §7.4, verified against the 2026-08-26 prototype measurement — do not "fix" them):

```js
test('cards carry transform + explicit px height from nodeSize', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, portsFn, agents: AGENTS });
  view.render(fixture(), {});
  const agent = view.nodeEl('n_agent');
  assert.equal(agent.style.transform, 'translate(400px, 80px)');
  assert.equal(agent.style.height, '191.5px');           // 95.5 + 24*(2+2)
  assert.equal(view.nodeEl('n_task').style.height, '110.5px');
  assert.equal(view.nodeEl('n_end').style.height, '110.5px');
  assert.equal(agent.dataset.nodeId, 'n_agent');
  assert.equal(agent.getAttribute('tabindex'), '0');
  // zones: 2 inputs, sep, 2 outputs, sep, await  => 5 rows, 2 separators
  assert.equal(agent.querySelectorAll('.nbody > .prow').length, 5);
  assert.equal(agent.querySelectorAll('.nbody > .psep').length, 2);
  assert.equal(agent.querySelector('.prow.gate').dataset.port, 'await');
  // conditional output renders a diamond + "on blocking", never a type dot
  const review = [...agent.querySelectorAll('.prow.out')].find((r) => r.dataset.port === 'review');
  assert.ok(review.querySelector('i.dia'));
  assert.equal(review.querySelector('.pt').textContent, 'on blocking');
});

test('wires paint exact bezier d strings; ghost is the LAST child of the layer', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, portsFn, agents: AGENTS });
  view.render(fixture(), {});
  // w1: n_task.task (280,199) -> n_agent.task (400,136); dx = clamp(48,160,0.45*120) = 54
  assert.equal(view.wireEl('w1').getAttribute('d'), 'M 280 199 C 334 199, 346 136, 400 136');
  // w2: n_agent.plan (620,193) -> n_end.result (760,199); dx = 0.45*140 = 63
  assert.equal(view.wireEl('w2').getAttribute('d'), 'M 620 193 C 683 193, 697 199, 760 199');
  const layer = host.querySelector('svg.gv-wires');
  assert.equal(layer.lastElementChild.getAttribute('class'), 'wire ghost');
  assert.equal(layer.querySelectorAll('path[data-wire-id]').length, 2);
});

test('loop wires bow below and carry a ≤N badge at the cubic midpoint', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const tpl = fixture();
  tpl.nodes.push({ id: 'n_rev', kind: 'agent', key: 'planner', x: 400, y: 400, config: {} });
  tpl.wires.push({ id: 'w3', from: { node: 'n_agent', port: 'plan' }, to: { node: 'n_rev', port: 'task' } });
  tpl.wires.push({ id: 'w4', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_agent', port: 'fix' }, config: { maxCycles: 2 } });
  const view = createGraphView(host, { doc, portsFn, agents: AGENTS });
  view.render(tpl, {});
  const d = view.wireEl('w4').getAttribute('d');
  assert.ok(view.wireEl('w4').getAttribute('class').includes('loop'), 'classified as a loop wire');
  // a = n_rev.review (620,537), b = n_agent.fix (400,160); bow = 56 + 0.2*377 = 131.4
  assert.equal(d, 'M 620 537 C 719 668.4, 301 291.4, 400 160');
  const badge = host.querySelector('.wbadge[data-wire-id="w4"]');
  assert.equal(badge.textContent, '≤2');
});

test('re-render does NOT rebuild rows whose port signature is unchanged', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, portsFn, agents: AGENTS });
  const tpl = fixture();
  view.render(tpl, {});
  const rowsBefore = [...view.nodeEl('n_agent').querySelectorAll('.nbody > *')];
  tpl.nodes[1].x = 480;                       // a pure move must not touch the body
  view.render(tpl, {});
  const rowsAfter = [...view.nodeEl('n_agent').querySelectorAll('.nbody > *')];
  assert.equal(rowsAfter.length, rowsBefore.length);
  for (let i = 0; i < rowsAfter.length; i += 1) {
    assert.equal(rowsAfter[i], rowsBefore[i], `row ${i} is the SAME element (identity), not a rebuild`);
  }
  assert.equal(view.nodeEl('n_agent').style.transform, 'translate(480px, 80px)');
  // changing the signature (arity) DOES rebuild
  tpl.nodes.push({ id: 'n_and', kind: 'and', x: 900, y: 400, config: { arity: 2 } });
  view.render(tpl, {});
  const andRows = [...view.nodeEl('n_and').querySelectorAll('.nbody > .prow')];
  tpl.nodes[3].config.arity = 3;
  view.render(tpl, {});
  const andRows2 = [...view.nodeEl('n_and').querySelectorAll('.nbody > .prow')];
  assert.equal(andRows.length, 3);            // in1, in2, out
  assert.equal(andRows2.length, 4);           // in1, in2, in3, out
  assert.notEqual(andRows2[0], andRows[0], 'signature change rebuilds the body');
});
```

`Expected: FAIL — Error: Cannot find module '.../ui/public/graph/view.mjs'` (all five tests error at the dynamic import).

- [ ] Step 2: Implement `ui/public/graph/view.mjs` (part 1 of 1 for this task — the file is created complete for the render path; Tasks 2–3 append the fast paths and the nav controller to the returned object).

`ui/public/graph/view.mjs`
```js
// ui/public/graph/view.mjs
// The ONE v2 graph renderer: DOM cards + one SVG wire layer (the ghost path
// included), both inside `.gv-world`, which carries the only pan/zoom transform.
// Three callers share it — the composer (edit), the run monitor (monitor) and
// the previews (static) — so it renders a template plus a decor bag and owns no
// interaction: composer.mjs binds the pointers to `view.stage`.
//
// CONTRACT: the render path NEVER measures. Every anchor, size and wire path is
// derived from the model x/y through the SHARED geometry module, which is what
// makes the renderer testable under jsdom (no layout there) and what keeps a
// repaint O(n) instead of a forced reflow per node. Do not reach for
// getBoundingClientRect in here.
//
// This file lives at depth 3 below the repo root, so the shared core is three
// `..` up; the browser clamps that at the URL root and the server serves it at
// /src/shared (P1). Absolute specifiers would break the Node-side UI tests.
import {
  NODE_W, ROW_H, ZOOM_MIN, ZOOM_MAX,
  GEOMETRY_CSS_VARS, injectGeometry, nodeSize, portAnchor, bezierPath, bezierMid,
} from '../../../src/shared/graph/geometry.mjs';
import { portsOf, resolveOrOutType } from '../../../src/shared/graph/ports.mjs';
import { classifyLoops } from '../../../src/shared/graph/loops.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Legend copy is NORMATIVE (spec §7.1); the agents card header row renders it. */
export const LEGEND_TEXT = 'grey = data · amber = loop · ◆ = conditional · ○ = gate · ⤫N = fan-out';
export const FANOUT_GLYPH = '⤫';

/** Per-mode zoom clamps (§7.6). `edit` uses the geometry defaults. */
export const MODE_ZOOM = {
  edit: { min: ZOOM_MIN, max: ZOOM_MAX },
  monitor: { min: 0.3, max: ZOOM_MAX },
  static: { min: 0.3, max: 1 },
};

/** The 24px caption row each captioned kind closes with. */
const CAPTIONS = { task: 'prompt + attached files', end: 'pipeline result', or: 'forwards freshest input' };

/** Flow cards are engine builtins — no sidecar — so their glyphs live here. */
const FLOW_META = {
  task: { title: 'Task', icon: '<path d="M5.2 3.4h9.6v13.2H5.2z"/><path d="M7.6 7.2h4.8M7.6 10h4.8M7.6 12.8h3"/>' },
  end: { title: 'End', icon: '<path d="M5.6 3.4v13.2"/><path d="M5.6 4.2h8.6l-2.4 3.4 2.4 3.4H5.6z"/>' },
  and: { title: 'AND', icon: '<path d="M3.4 6h3.2M3.4 14h3.2"/><path d="M6.6 4.2h3.2a5.8 5.8 0 010 11.6H6.6z"/><path d="M15.6 10h1.8"/>' },
  or: { title: 'OR', icon: '<path d="M3.4 5.5h3.6l4.4 4.5h5.4M3.4 14.5h3.6l4.4-4.5"/><path d="M14.6 7.8l2.2 2.2-2.2 2.2"/>' },
  combine: { title: 'Combine', icon: '<path d="M3.4 5.5h4.2l4.4 4.5h4.6M3.4 14.5h4.2l4.4-4.5"/><path d="M14.4 7.8l2.2 2.2-2.2 2.2"/>' },
};
const FLOW_VIEWBOX = '0 0 20 20';
const AGENT_VIEWBOX = '0 0 24 24';

// Builtin icons are repo-shipped SVG fragments (trusted, injected raw). A USER
// agent's metadata is user-writable (POST /api/agents), so its icon could carry
// arbitrary markup — those get a fixed glyph instead. This is app.js's
// origin-trust gate, ported verbatim: do not relax it.
export const USER_AGENT_ICON = '<circle cx="12" cy="12" r="3.4"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"></path>';
export function safeAgentIcon(meta) {
  return meta && meta.origin === 'user' ? USER_AGENT_ICON : String((meta && meta.icon) || '');
}

const dotClass = (t) => `dot ${t === 'md' || t === 'json' || t === 'void' || t === 'any' ? t : 'md'}`;
const whenCaption = (w) => (w === 'blocking' ? 'on blocking' : w === 'clean' ? 'on clean' : '');

export function createGraphView(host, {
  doc = globalThis.document,
  mode = 'edit',
  portsFn,
  agents: agentsIn = {},
  raf = null,
  viewport = null,
  zoomMin = null,
  zoomMax = null,
  wheelPan = 'always',
} = {}) {
  const win = doc.defaultView || globalThis;
  const clamps = MODE_ZOOM[mode] || MODE_ZOOM.edit;
  const zMin = zoomMin == null ? clamps.min : zoomMin;
  const zMax = zoomMax == null ? clamps.max : zoomMax;
  const schedule = raf || ((fn) => (win.requestAnimationFrame ? win.requestAnimationFrame(fn) : setTimeout(fn, 16)));
  let agents = agentsIn || {};

  const stage = doc.createElement('div');
  stage.className = `gv-stage gv-${mode}`;
  stage.setAttribute('tabindex', '0');
  stage.setAttribute('aria-label', 'pipeline canvas');
  const world = doc.createElement('div');
  world.className = 'gv-world';
  const wiresEl = doc.createElementNS(SVG_NS, 'svg');
  wiresEl.setAttribute('class', 'gv-wires');
  wiresEl.setAttribute('width', '1');
  wiresEl.setAttribute('height', '1');
  const ghost = doc.createElementNS(SVG_NS, 'path');
  ghost.setAttribute('class', 'wire ghost');
  ghost.dataset.ghost = '1';
  wiresEl.appendChild(ghost);          // ALWAYS last: committed wires insert BEFORE it
  world.appendChild(wiresEl);
  stage.appendChild(world);
  // Never replaceChildren(host): `.gv-chip` and `.gv-ins-rail` are the stage's
  // SIBLINGS inside the same canvas host and must survive a (re)mount.
  host.prepend(stage);
  injectGeometry(stage);
```

Continue the same file (still inside `createGraphView`):

```js
  const nodeEls = new Map();      // nodeId  -> card element
  const wireEls = new Map();      // wireId  -> path element
  const badgeEls = new Map();     // wireId  -> .wbadge element
  const incident = new Map();     // nodeId  -> Set(wireId)
  const dCache = new Map();       // wireId  -> last written `d`
  const footers = new Map();      // nodeId  -> footerRows (int)
  let T = { x: 0, y: 0, z: 1 };
  let current = null;             // last rendered template
  let ctx = null;                 // last render context (ports, loops, wired inputs)
  const stats = { wireDUpdates: 0, ghostUpdates: 0, rectReads: 0 };

  const h = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const svgEl = (tag, cls) => {
    const n = doc.createElementNS(SVG_NS, tag);
    if (cls) n.setAttribute('class', cls);
    return n;
  };
  const portsAt = (node) => portsOf(portsFn, node) || { inputs: [], outputs: [] };
  const sizeOf = (node) => nodeSize(node, portsAt(node), { footerRows: footers.get(node.id) || 0 });

  function headerOf(node) {
    if (node.kind === 'agent') {
      const meta = agents[node.key] || null;
      return {
        cls: `h-${(meta && meta.color) || 'blue'}`,
        title: (meta && meta.displayName) || node.key || node.id,
        icon: safeAgentIcon(meta),
        viewBox: AGENT_VIEWBOX,
      };
    }
    const flow = FLOW_META[node.kind] || { title: node.kind, icon: '' };
    return { cls: 'h-flow', title: flow.title, icon: flow.icon, viewBox: FLOW_VIEWBOX };
  }

  function portRow(port, dir, resolvedType) {
    const type = resolvedType || port.type;
    const row = h('div', `prow ${dir}`);
    row.dataset.port = port.id;
    row.dataset.dir = dir;
    row.dataset.type = type;
    const cond = dir === 'out' && (port.when === 'blocking' || port.when === 'clean');
    const glyph = cond ? h('i', 'dia') : h('i', dotClass(type));
    const name = h('span', 'pn', port.id);
    const cap = h('span', cond ? 'pt cond' : 'pt', cond ? whenCaption(port.when) : type);
    if (dir === 'in') {
      row.append(glyph, name, cap);
      if (port.loop) row.appendChild(h('span', 'chip am mla', 'loop'));
      else if (port.expands) row.appendChild(h('span', 'chip fan mla', `${FANOUT_GLYPH}N`));
    } else {
      row.append(cap, name, glyph);
    }
    return row;
  }

  function gateRow(wired) {
    const row = h('div', `prow in gate${wired ? ' wired' : ''}`);
    row.dataset.port = 'await';
    row.dataset.dir = 'in';
    row.dataset.type = 'any';
    row.append(h('i', 'gdot'), h('span', 'pn', 'await'), h('span', 'pt', 'any'));
    return row;
  }

  // The body's identity: rebuild the rows ONLY when one of these changes. A pure
  // move, a selection or a status flip must never touch a row element (the
  // PR #359 defect: replaceChildren per pointermove for every card).
  function bodySig(node, p, orType, awaitWired) {
    const io = [...p.inputs, ...p.outputs]
      .map((q) => `${q.id}:${q.type}:${q.when || ''}:${q.loop ? 'L' : ''}${q.expands ? 'X' : ''}`)
      .join(',');
    return [node.kind, node.key || '', io, node.config && node.config.arity != null ? node.config.arity : '',
      orType || '', awaitWired ? '1' : '0'].join('|');
  }

  function paintBody(el, node, p, orType, awaitWired) {
    const body = el.querySelector(':scope > .nbody');
    const sig = bodySig(node, p, orType, awaitWired);
    if (body.dataset.sig === sig) return;
    body.dataset.sig = sig;
    const metaIns = p.inputs.filter((x) => !x.synthetic);
    const gate = p.inputs.find((x) => x.synthetic) || null;
    const caption = CAPTIONS[node.kind] || '';
    const kids = [];
    // Zones top->bottom, each emitted only when non-empty, a 9px separator only
    // BETWEEN emitted zones — this is exactly what nodeSize counts.
    const zone = (rows) => { if (kids.length) kids.push(h('div', 'psep')); kids.push(...rows); };
    if (metaIns.length) zone(metaIns.map((q) => portRow(q, 'in')));
    if (p.outputs.length) zone(p.outputs.map((q) => portRow(q, 'out', node.kind === 'or' ? (orType || 'any') : null)));
    if (gate) zone([gateRow(awaitWired)]);
    if (caption) zone([(() => { const c = h('div', 'prow cap'); c.appendChild(h('span', 'pt', caption)); return c; })()]);
    body.replaceChildren(...kids);
  }

  function placeCard(node) {
    const el = nodeEls.get(node.id);
    if (el) el.style.transform = `translate(${node.x}px, ${node.y}px)`;
  }
```

Continue the same file (still inside `createGraphView`):

```js
  function paintCard(el, node) {
    const p = portsAt(node);
    const orType = node.kind === 'or' ? resolveOrOutType(current, portsFn, node.id, new Set()) : null;
    const awaitWired = ctx.wiredInputs.has(`${node.id}.await`);
    // Never rewrite className wholesale: `sel`, `is-*` and `bad` are owned by the
    // fast paths and must survive a repaint.
    if (el.dataset.kind !== node.kind) {
      for (const c of [...el.classList]) if (c.startsWith('node-')) el.classList.remove(c);
      el.classList.add('node', `node-${node.kind}`);
      el.dataset.kind = node.kind;
    }
    el.style.width = `${NODE_W}px`;
    el.style.height = `${sizeOf(node).h}px`;
    const head = el.querySelector(':scope > .nhead');
    const hd = headerOf(node);
    const sig = `${hd.cls}|${hd.title}|${hd.icon}`;
    if (head.dataset.sig !== sig) {
      head.dataset.sig = sig;
      head.className = `nhead ${hd.cls}`;
      const icon = svgEl('svg');
      icon.setAttribute('viewBox', hd.viewBox);
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.innerHTML = hd.icon;
      head.replaceChildren(icon, h('span', 'tt', hd.title));
    }
    paintBody(el, node, p, orType, awaitWired);
    placeCard(node);
  }

  function buildCard(node) {
    const el = h('div', `node node-${node.kind}`);
    el.dataset.nodeId = node.id;
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', `${node.kind} ${node.key || node.id}`);
    el.append(h('div', 'nhead'), h('div', 'nbody'));
    return el;
  }

  const anchorOf = (end, dir) => {
    const node = ctx.byId.get(end.node);
    return node ? portAnchor(node, portsAt(node), end.port, dir) : null;
  };

  /** Writes `d` only when the cached string differs — the whole point of the cache. */
  function paintWire(wireId) {
    const w = ctx.wireById.get(wireId);
    const path = wireEls.get(wireId);
    if (!w || !path) return;
    const a = anchorOf(w.from, 'out');
    const b = anchorOf(w.to, 'in');
    if (!a || !b) return;                       // dangling endpoint paints nothing, never NaN
    const loop = ctx.loopWireIds.has(wireId);
    const d = bezierPath(a, b, { loop });
    if (dCache.get(wireId) !== d) {
      dCache.set(wireId, d);
      path.setAttribute('d', d);
      stats.wireDUpdates += 1;
    }
    const badge = badgeEls.get(wireId);
    if (badge) {
      const mid = bezierMid(a, b, { loop });
      badge.style.left = `${mid.x}px`;
      badge.style.top = `${mid.y}px`;
    }
  }

  function renderNodes() {
    const seen = new Set();
    for (const node of current.nodes) {
      seen.add(node.id);
      let el = nodeEls.get(node.id);
      if (!el) { el = buildCard(node); nodeEls.set(node.id, el); world.appendChild(el); }
      paintCard(el, node);
    }
    for (const [id, el] of [...nodeEls]) {
      if (seen.has(id)) continue;
      el.remove(); nodeEls.delete(id); footers.delete(id);
    }
  }

  function renderWires() {
    const seenW = new Set();
    const seenB = new Set();
    incident.clear();
    for (const w of current.wires) {
      if (!w || !w.from || !w.to) continue;
      seenW.add(w.id);
      for (const id of [w.from.node, w.to.node]) {
        if (!incident.has(id)) incident.set(id, new Set());
        incident.get(id).add(w.id);
      }
      let path = wireEls.get(w.id);
      if (!path) {
        path = svgEl('path', 'wire');
        path.dataset.wireId = w.id;
        wireEls.set(w.id, path);
        wiresEl.insertBefore(path, ghost);      // committed wires go BEFORE the ghost
      }
      const loop = ctx.loopWireIds.has(w.id);
      path.setAttribute('class', `wire${loop ? ' loop' : ''}`);
      const budget = w.config && w.config.maxCycles;
      if (Number.isInteger(budget)) {
        seenB.add(w.id);
        let badge = badgeEls.get(w.id);
        if (!badge) { badge = h('div', 'wbadge'); badge.dataset.wireId = w.id; badgeEls.set(w.id, badge); world.appendChild(badge); }
        badge.textContent = `≤${budget}`;
      }
      dCache.delete(w.id);                      // geometry may have moved: force one write
      paintWire(w.id);
    }
    for (const [id, el] of [...wireEls]) if (!seenW.has(id)) { el.remove(); wireEls.delete(id); dCache.delete(id); }
    for (const [id, el] of [...badgeEls]) if (!seenB.has(id)) { el.remove(); badgeEls.delete(id); }
  }
```

Finish the file (still inside `createGraphView`, then the returned object):

```js
  /** Validation pips + `bad` wires. One pip per node, title = the first message. */
  function applyReport(report) {
    const byNode = new Map();
    const badWires = new Set();
    for (const e of (report && report.errors) || []) {
      if (e.nodeId && !byNode.has(e.nodeId)) byNode.set(e.nodeId, e.message || e.code);
      if (e.wireId) badWires.add(e.wireId);
    }
    for (const [id, el] of nodeEls) {
      const msg = byNode.get(id);
      let pip = el.querySelector(':scope > .npip');
      if (!msg) { if (pip) pip.remove(); continue; }
      if (!pip) { pip = h('div', 'npip'); pip.dataset.nodeId = id; el.appendChild(pip); }
      pip.title = msg;
    }
    for (const [id, el] of wireEls) el.classList.toggle('bad', badWires.has(id));
  }

  function render(template, state = {}) {
    current = template;
    ctx = {
      byId: new Map(template.nodes.map((n) => [n.id, n])),
      wireById: new Map(template.wires.map((w) => [w.id, w])),
      wiredInputs: new Set(template.wires.filter((w) => w && w.to).map((w) => `${w.to.node}.${w.to.port}`)),
      loopWireIds: classifyLoops(template, portsFn).loopWireIds,
    };
    renderNodes();
    renderWires();
    view.setSelection(state.selection || null);
    applyReport(state.report || null);
    // (No decor here: run-decor.mjs's applyDecor(view, decor) — P6 — is the ONE
    // decor pass, run AFTER render through the fast paths below.)
    return view;
  }

  function setTransform(next) {
    T = { x: Number(next && next.x) || 0, y: Number(next && next.y) || 0, z: Number(next && next.z) || T.z || 1 };
    world.style.transform = `translate(${T.x}px, ${T.y}px) scale(${T.z})`;
    return { ...T };
  }

  const view = {
    stage, world, wiresEl, ghostEl: ghost, mode, stats, schedule, wheelPan,
    zoomMin: zMin, zoomMax: zMax,
    render,
    setTransform,
    getTransform: () => ({ ...T }),
    nodeEl: (id) => nodeEls.get(id) || null,
    wireEl: (id) => wireEls.get(id) || null,
    template: () => current,
    ports: (node) => portsAt(node),
    size: (node) => sizeOf(node),
    anchor: (node, portId, dir) => portAnchor(node, portsAt(node), portId, dir),
    incidentOf: (nodeId) => incident.get(nodeId) || new Set(),
    isLoopWire: (wireId) => Boolean(ctx && ctx.loopWireIds.has(wireId)),
    /** Swap the registry the headers read (the palette arrives after the first
     *  paint when /api/agents is slow). Header signatures are invalidated so the
     *  next render repaints tint, icon and title. Never destroy the view here —
     *  that would repaint into a detached root (a permanently blank canvas). */
    setAgents(next) {
      agents = next || {};
      for (const el of nodeEls.values()) {
        const head = el.querySelector(':scope > .nhead');
        if (head) delete head.dataset.sig;
      }
      if (current) render(current, {});
    },
    destroy() {
      stage.remove();
      nodeEls.clear(); wireEls.clear(); badgeEls.clear(); incident.clear(); dCache.clear(); footers.clear();
      current = null; ctx = null;
    },
  };
  // Internals the later tasks' fast paths close over.
  view._internals = { nodeEls, wireEls, badgeEls, incident, dCache, footers, paintWire, placeCard, sizeOf, portsAt, h, viewport, doc, getCtx: () => ctx, getCurrent: () => current };
  setTransform(T);
  return view;
}
```

- [ ] Step 3: `render` calls `view.setSelection`, so it lands in THIS task (its dedicated test arrives in Task 2). Add it inside the returned object, above `setAgents`:

```js
    setSelection(sel) {
      for (const [id, el] of nodeEls) el.classList.toggle('sel', Boolean(sel && sel.kind === 'node' && sel.id === id));
      for (const [id, el] of wireEls) el.classList.toggle('sel', Boolean(sel && sel.kind === 'wire' && sel.id === id));
    },
    // (no applyDecor on the view: run-decor.mjs's applyDecor(view, decor) — P6 — owns the decor pass)
```
The view carries NO `applyDecor` and `render` accepts NO `decor`: P6's `run-decor.mjs` exports `applyDecor(view, decor)` and drives the Task 2 fast paths (`setStatus`/`setFooter`/`setNodeChrome`/`setWireBadge`/`setWireLive`) after every `render` — one decor owner (cross-plan pass 2026-08-27).

- [ ] Step 4: `node --test test/ui-graph-view.test.mjs` → `Expected: # pass 5 / # fail 0`.
- [ ] Step 5: Commit — `worca: Node-graph v2 P5 — graph view renderer (cards, wires, keyed diff)`.

---

### Task 2: `view.mjs` fast paths — `moveNode`, `setGhost`, `setStatus`, `setFooter`, `setWireLive`, `centerOn`

**Files:** modify `ui/public/graph/view.mjs`; modify `test/ui-graph-view.test.mjs`.
**Interfaces:** produces (all bypass `render`, all O(1)/O(incident)) `view.moveNode(id)`, `view.setGhost(d, cls)`, `view.paintWire(wireId)`, `view.setStatus(nodeId, status)`, `view.setFooter(nodeId, bands)`, `view.setNodeChrome(nodeId, {color, gate, totals})`, `view.setWireBadge(wireId, badge)`, `view.setWireLive(ids)`, `view.centerOn(nodeId)`. The run-mode vocabulary (consumed by P6's `applyDecor(view, decor)` in `run-decor.mjs`; the composer never calls these three):
```js
// view.setFooter(nodeId, bands)  — bands = [] | null clears the footer; the card height is
// nodeSize(node, ports, { footerRows: bands.length }) — 26px for the first band, 22px each extra.
//   { kind:'fan',    leds:('run'|'done')[], count:number }
//   { kind:'strip',  leds:NodeStatus[], summary:string, expanded:boolean }
//   { kind:'exec',   executionId, led:NodeStatus, label:string, right:string }
//   { kind:'result', text:string, path:string|null }
// view.setNodeChrome(nodeId, { color:''|paletteToken -> --c, gate:null|{wireId,title} -> .ngate pip,
//                             totals:null|{dur,cost} -> .nrun })  — also stamps class run-node + data-id
// view.setWireBadge(wireId, badge)  badge = null | { text, title }   -> .wbadge[data-wire-id] .wfired
```
`setFooter` re-runs `nodeSize` so the card GROWS — run-decor NEVER sets `card.style.height` itself (the PR #359 defect `old:run-decor.mjs:457-461`); this view is the ONE writer of every run-mode card byte.

- [ ] Step 1: Write the failing tests — append to `test/ui-graph-view.test.mjs`:

```js
test('moveNode repaints ONLY the incident wires; setGhost writes d once', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, portsFn, agents: AGENTS });
  const tpl = fixture();
  view.render(tpl, {});
  const w2Before = view.wireEl('w2').getAttribute('d');
  const n0 = view.stats.wireDUpdates;
  tpl.nodes[0].x = 71;                                   // n_task: incident = w1 only
  view.moveNode('n_task');
  assert.equal(view.stats.wireDUpdates - n0, 1, 'exactly one wire repainted');
  assert.equal(view.wireEl('w2').getAttribute('d'), w2Before, 'w2 untouched');
  assert.equal(view.nodeEl('n_task').style.transform, 'translate(71px, 143px)');
  const g0 = view.stats.ghostUpdates;
  view.setGhost('M 0 0 C 1 1, 2 2, 3 3', 'legal');
  view.setGhost('M 0 0 C 1 1, 2 2, 3 3', 'legal');       // identical d ⇒ no second write
  assert.equal(view.stats.ghostUpdates - g0, 1);
  assert.equal(view.ghostEl.getAttribute('class'), 'wire ghost on legal');
  view.setGhost(null);
  assert.equal(view.ghostEl.getAttribute('class'), 'wire ghost');
});

test('setNodeChrome paints --c, the gate pip and the header totals; nulls clear them', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS });
  view.render(fixture(), {});
  const card = view.nodeEl('n_agent');
  view.setNodeChrome('n_agent', { color: 'violet', gate: { wireId: 'w1', title: 'waiting on a loop gate' }, totals: { dur: '2m 10s', cost: '$0.42' } });
  assert.equal(card.style.getPropertyValue('--c'), 'var(--violet)');
  assert.equal(card.querySelector(':scope > .ngate').dataset.wireId, 'w1');
  assert.equal(card.querySelector(':scope > .nrun .dur').textContent, '2m 10s');
  assert.equal(card.querySelector(':scope > .nrun .cost').textContent, '$0.42');
  assert.ok(card.classList.contains('run-node') && card.dataset.id === 'n_agent', 'the 1s tick hook selects .run-node[data-id] .dur');
  view.setNodeChrome('n_agent', { color: '', gate: null, totals: null });
  assert.equal(card.querySelector(':scope > .ngate'), null);
  assert.equal(card.querySelector(':scope > .nrun'), null);
});

test('setWireBadge writes an amber cycle badge on a loop wire and clears it', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS });
  view.render(fixture(), {});                             // w4 is the fixture's loop wire (badge host)
  view.setWireBadge('w4', { text: '2×', title: '2 of 3 cycles' });
  const badge = host.querySelector('.wbadge[data-wire-id="w4"] .wfired');
  assert.equal(badge.textContent, '2×');
  assert.equal(badge.title, '2 of 3 cycles');
  view.setWireBadge('w4', null);
  assert.equal(host.querySelector('.wfired'), null);
  view.setWireBadge('w1', { text: '1×' });                // a plain wire has no badge host: no-op
  assert.equal(host.querySelector('.wfired'), null);
});

test('setStatus / setWireLive / setFooter are classList + height only', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS });
  view.render(fixture(), {});
  const card = view.nodeEl('n_agent');
  const rows = [...card.querySelectorAll('.nbody > *')];
  view.setStatus('n_agent', 'active');
  assert.ok(card.classList.contains('is-active'));
  view.setStatus('n_agent', 'done');
  assert.ok(card.classList.contains('is-done') && !card.classList.contains('is-active'));
  assert.equal(card.dataset.status, 'done');
  view.setWireLive(['w1']);
  assert.ok(view.wireEl('w1').classList.contains('wire-live'));
  assert.ok(!view.wireEl('w2').classList.contains('wire-live'));
  view.setWireLive([]);
  assert.ok(!view.wireEl('w1').classList.contains('wire-live'));
  assert.equal(card.style.height, '191.5px');
  view.setFooter('n_agent', [{ kind: 'strip', leds: ['done'], summary: '1 run · $0.10', expanded: false }]);   // collapsed strip: +26
  assert.equal(card.style.height, '217.5px');
  assert.equal(card.querySelectorAll(':scope > .xfoot .xtoggle').length, 1);
  assert.equal(card.querySelector(':scope > .xfoot .xsum').textContent, '1 run · $0.10');
  view.setFooter('n_agent', [                            // +26 + 2*22
    { kind: 'strip', leds: ['done', 'active'], summary: '2 runs · $1.12', expanded: true },
    { kind: 'exec', executionId: 'x:n_agent:1', led: 'done', label: 'cycle 1', right: '1m 3s · $0.12' },
    { kind: 'exec', executionId: 'x:n_agent:2', led: 'active', label: 'cycle 2 · fix', right: '4s' },
  ]);
  assert.equal(card.style.height, '261.5px');
  assert.deepEqual([...card.querySelectorAll(':scope > .xfoot .xrow')].map((r) => r.dataset.executionId), ['x:n_agent:1', 'x:n_agent:2']);
  assert.equal(card.querySelectorAll(':scope > .xfoot .xrow')[1].className, 'xrow is-active');
  view.setFooter('n_agent', []);
  assert.equal(card.style.height, '191.5px');
  assert.equal(card.querySelector(':scope > .xfoot'), null, 'clearing removes the footer');
  assert.deepEqual([...card.querySelectorAll('.nbody > *')], rows, 'no row was rebuilt');
  // anchors are top-relative: the footer never re-routes a wire (D8)
  assert.equal(view.wireEl('w2').getAttribute('d'), 'M 620 193 C 683 193, 697 199, 760 199');
});

test('centerOn puts the node box centre at the viewport centre', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, {
    doc, portsFn, agents: AGENTS, viewport: () => ({ left: 0, top: 0, width: 1000, height: 600 }),
  });
  view.render(fixture(), {});
  view.setTransform({ x: 0, y: 0, z: 1 });
  view.centerOn('n_agent');                              // box (400,80,220,191.5), centre (510, 175.75)
  const T = view.getTransform();
  assert.equal(T.x, 500 - 510);
  assert.equal(T.y, 300 - 175.75);
});
```

`Expected: FAIL — TypeError: view.moveNode is not a function` (and the same for `setStatus`, `setFooter`, `setWireLive`, `centerOn`).

- [ ] Step 2: Implement — add to `createGraphView`, above `setAgents` in the returned object (and delete the now-redundant `view._internals` line at the bottom, replacing it with `view._internals = { incident, dCache, footers };` for the composer's tests):

```js
    /** Statuses the monitor sets; every one is a class toggle, never a rebuild. */
    setStatus(nodeId, status) {
      const el = nodeEls.get(nodeId);
      if (!el) return;
      for (const s of ['pending', 'active', 'done', 'paused', 'stopped', 'error', 'skipped']) {
        el.classList.toggle(`is-${s}`, s === status);
      }
      if (status) el.dataset.status = status; else delete el.dataset.status;
    },
    /** Replace the executions footer with `bands` (the run monitor's vocabulary,
     *  see the Interfaces block) and RE-SIZE the card from the band count. Anchors
     *  are top-relative, so no wire re-routes (D8) — only height, hit box and fit
     *  bounds change. The ONE place a run-mode card height is written. */
    setFooter(nodeId, bands) {
      const node = ctx && ctx.byId.get(nodeId);
      const el = nodeEls.get(nodeId);
      if (!node || !el) return;
      const list = Array.isArray(bands) ? bands.filter(Boolean) : [];
      for (const stale of el.querySelectorAll(':scope > .xfoot')) stale.remove();
      if (list.length) {
        const foot = h('div', 'xfoot');
        foot.dataset.nodeId = nodeId;
        for (const band of list) foot.appendChild(bandEl(nodeId, band));
        el.appendChild(foot);
      }
      if (list.length) footers.set(nodeId, list.length); else footers.delete(nodeId);
      el.style.height = `${sizeOf(node).h}px`;
    },
    /** Per-card ornaments: agent colour, gate pip, header duration · cost. */
    setNodeChrome(nodeId, { color = '', gate = null, totals = null } = {}) {
      const el = nodeEls.get(nodeId);
      if (!el) return;
      el.style.setProperty('--c', color ? `var(--${color})` : '');
      // Keep the 1 s elapsed tick (app.js `.run-node[data-id] .dur`) working on v2 cards.
      el.classList.add('run-node');
      el.dataset.id = nodeId;
      for (const stale of el.querySelectorAll(':scope > .ngate')) stale.remove();
      if (gate) {
        const pip = h('div', 'ngate', '?');
        pip.dataset.wireId = gate.wireId || '';
        pip.title = gate.title || '';
        el.appendChild(pip);
      }
      let run = el.querySelector(':scope > .nrun');
      if (!totals) { if (run) run.remove(); return; }
      if (!run) { run = h('div', 'nrun'); run.append(h('span', 'dur'), h('span', 'cost')); el.appendChild(run); }
      run.querySelector('.dur').textContent = totals.dur || '';
      run.querySelector('.cost').textContent = totals.cost || '';
    },
    /** The amber `N×` delivery badge on a loop wire's bow (no-op on a plain wire). */
    setWireBadge(wireId, badge) {
      const host = badgeEls.get(wireId);
      if (!host) return;
      for (const stale of host.querySelectorAll('.wfired')) stale.remove();
      if (!badge) return;
      const b = h('span', 'wfired', badge.text || '');
      if (badge.title) b.title = badge.title;
      host.appendChild(b);
    },
```
and, as module-private helpers next to `placeCard` (they close over `doc` and Task 1's `h(tag, cls, text)`):
```js
  const svgChevron = () => {
    const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'chev'); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.innerHTML = '<path d="M6 9l6 6 6-6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
    return s;
  };
  /** One footer band -> one element (the run monitor's vocabulary; see Interfaces). */
  function bandEl(nodeId, band) {
    if (band.kind === 'fan') {
      const fan = h('div', 'fan');
      for (const led of band.leds || []) fan.appendChild(h('i', `sq${led === 'run' ? ' on' : ''}`));
      fan.appendChild(h('span', 'fl', `×${band.count}`));
      return fan;
    }
    if (band.kind === 'strip') {
      const btn = doc.createElement('button');
      btn.type = 'button'; btn.className = 'xtoggle'; btn.dataset.nodeId = nodeId;
      btn.setAttribute('aria-expanded', band.expanded ? 'true' : 'false');
      const sq = h('span', 'xsq');
      for (const led of band.leds || []) sq.appendChild(h('i', `xq is-${led}`));
      btn.append(sq, h('span', 'xsum', band.summary || ''), svgChevron());
      return btn;
    }
    if (band.kind === 'exec') {
      const row = h('div', `xrow is-${band.led || 'pending'}`);
      row.dataset.executionId = band.executionId || '';
      row.dataset.nodeId = nodeId;
      row.append(h('i', 'led'), h('span', 'xl', band.label || ''), h('span', 'xr', band.right || ''));
      return row;
    }
    const res = h('div', 'xresult');           // kind: 'result'
    if (!band.path) { res.textContent = band.text || ''; return res; }
    const a = h('a', null, band.text || '');
    a.href = '#'; a.dataset.path = band.path; a.title = band.path;
    res.appendChild(a);
    return res;
  }
    setWireLive(ids) {
      const live = new Set(ids || []);
      for (const [id, el] of wireEls) el.classList.toggle('wire-live', live.has(id));
    },
    /** One transform write per dragged node + its incident wires only. */
    moveNode(nodeId) {
      const node = ctx && ctx.byId.get(nodeId);
      if (!node) return;
      placeCard(node);
      for (const wid of incident.get(nodeId) || []) paintWire(wid);
    },
    paintWire,
    /** `d = null` hides the ghost. Identical `d` never re-writes the attribute. */
    setGhost(d, cls = '') {
      if (d == null) { ghost.setAttribute('class', 'wire ghost'); return; }
      if (ghost.getAttribute('d') !== d) { ghost.setAttribute('d', d); stats.ghostUpdates += 1; }
      ghost.setAttribute('class', `wire ghost on${cls ? ` ${cls}` : ''}`);
    },
    /** Pan (never zoom) the node's box centre to the viewport centre. */
    centerOn(nodeId) {
      const node = ctx && ctx.byId.get(nodeId);
      if (!node) return;
      const r = view.readRect();
      const s = sizeOf(node);
      setTransform({
        x: r.width / 2 - (node.x + s.w / 2) * T.z,
        y: r.height / 2 - (node.y + s.h / 2) * T.z,
        z: T.z,
      });
    },
```

and add the rect cache the last two need (module-private, above the returned object):

```js
  let R = { left: 0, top: 0, width: 0, height: 0 };
  /** The ONE measurement in the whole renderer. `viewport` injects it under jsdom. */
  function readRect() {
    if (viewport) { R = { ...viewport() }; return R; }
    const b = stage.getBoundingClientRect();
    R = { left: b.left, top: b.top, width: b.width, height: b.height };
    stats.rectReads += 1;
    return R;
  }
  const toWorld = (cx, cy) => ({ x: (cx - R.left - T.x) / T.z, y: (cy - R.top - T.y) / T.z });
  const toScreen = (wx, wy) => ({ x: wx * T.z + T.x, y: wy * T.z + T.y });
```
plus `readRect, toWorld, toScreen, rect: () => ({ ...R }),` in the returned object. `centerOn` calls `readRect()` first (it is not on a move path).

- [ ] Step 3: `node --test test/ui-graph-view.test.mjs` → `Expected: # pass 8 / # fail 0`.
- [ ] Step 4: Commit — `worca: Node-graph v2 P5 — view fast paths (move, ghost, status, footer, live wires)`.

---

### Task 3: `view.mjs` — fit, `fitToWidth`, modes, and the monitor nav controller

**Files:** modify `ui/public/graph/view.mjs`; modify `test/ui-graph-view.test.mjs`.
**Interfaces:** produces `view.bounds({pad})`, `view.fit({insetRight, pad})`, `view.fitToWidth(w)`, `view.createNav({wheelPan})` → `{destroy}`, `view.destroy()` (already present; now also tears the nav down). **`static` mode installs NO listeners at all.** The monitor's `wheelPan:'engaged'` policy (D8): the graph captures a plain wheel only after it is ENGAGED (pointerdown inside, or focus via Tab); ⌘/Ctrl+wheel and pinch are captured always; Escape or a pointerdown outside disengages. The composer passes `wheelPan:'always'`.

- [ ] Step 1: Write the failing tests — append to `test/ui-graph-view.test.mjs`:

```js
const VP = { left: 0, top: 0, width: 1280, height: 560 };

test('fit centres model bounds and never magnifies past 1x', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, portsFn, agents: AGENTS, viewport: () => ({ ...VP }) });
  view.render(fixture(), {});
  view.fit({ insetRight: 0, pad: 60 });
  const T = view.getTransform();
  // boxes span x 60..980, y 80..271.5 ⇒ padded bounds (0, 20, 1040, 311.5)
  assert.equal(T.z, 1, 'fit caps at 1x');
  assert.equal(T.x, 120);
  assert.equal(T.y, 104.25);
  view.fit({ insetRight: 280, pad: 60 });               // inspector expanded band
  assert.ok(Math.abs(view.getTransform().z - 1000 / 1040) < 1e-12);
});

test('static mode binds NO listeners and fitToWidth uses the host width', async () => {
  const { doc, host, win } = boot();
  const { createGraphView } = await import(viewPath);
  let bound = 0;
  const realAdd = win.HTMLElement.prototype.addEventListener;
  win.HTMLElement.prototype.addEventListener = function (...a) { bound += 1; return realAdd.apply(this, a); };
  const view = createGraphView(host, { doc, mode: 'static', portsFn, agents: AGENTS, viewport: () => ({ ...VP }) });
  view.render(fixture(), {});
  const nav = view.createNav();                          // refused in static mode
  win.HTMLElement.prototype.addEventListener = realAdd;
  assert.equal(bound, 0, 'static mode installs zero element listeners, even via createNav');
  assert.equal(typeof nav.destroy, 'function');
  assert.ok(view.stage.classList.contains('gv-static'));
  view.fitToWidth(520);                                  // 520/1040 = 0.5 ≥ zoomMin 0.3
  assert.equal(view.getTransform().z, 0.5);
});

test('monitor nav: wheelPan "engaged" ignores a plain wheel until engaged', async () => {
  const { doc, host, win } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS, viewport: () => ({ ...VP }) });
  view.render(fixture(), {});
  const nav = view.createNav({ wheelPan: 'engaged' });
  view.setTransform({ x: 0, y: 0, z: 1 });
  view.stage.dispatchEvent(new win.WheelEvent('wheel', { deltaX: 40, deltaY: -25, bubbles: true, cancelable: true }));
  assert.deepEqual(view.getTransform(), { x: 0, y: 0, z: 1 }, 'not engaged ⇒ page scrolls, graph does not pan');
  // ctrl+wheel is captured even when not engaged
  view.stage.dispatchEvent(new win.WheelEvent('wheel', { deltaY: -120, ctrlKey: true, clientX: 600, clientY: 300, bubbles: true, cancelable: true }));
  assert.ok(view.getTransform().z > 1);
  view.setTransform({ x: 0, y: 0, z: 1 });
  view.stage.dispatchEvent(new win.PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 10, bubbles: true }));
  view.stage.dispatchEvent(new win.WheelEvent('wheel', { deltaX: 40, deltaY: -25, bubbles: true, cancelable: true }));
  assert.deepEqual(view.getTransform(), { x: -40, y: 25, z: 1 }, 'engaged ⇒ plain wheel pans by exactly −delta');
  nav.destroy();
  view.stage.dispatchEvent(new win.WheelEvent('wheel', { deltaX: 40, deltaY: 0, bubbles: true, cancelable: true }));
  assert.equal(view.getTransform().x, -40, 'no listener after destroy');
});
```

`Expected: FAIL — TypeError: view.fit is not a function`.

- [ ] Step 2: Implement — add to `createGraphView` (module-private helpers first, then the returned-object entries):

```js
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** MODEL bounds (no DOM measure): the shared `graphBounds` over the rendered
   *  template, with this view's footer rows (only the view knows them). */
  function bounds(pad = 0) {
    if (!current || !current.nodes.length) return null;
    return graphBounds(current, portsAt, { pad, footerRowsOf: (n) => footers.get(n.id) || 0 });
  }
  /** `fitBounds` → `{z, tx, ty}` mapped onto this view's `{x, y, z}` transform. */
  const applyFit = (b, width, height, zoomMax) => {
    const f = fitBounds(b, { width, height }, { zoomMin: zMin, zoomMax });
    setTransform({ x: f.tx, y: f.ty, z: f.z });
  };

  /** Zoom about a stage-local point s: w = (s − t)/z is invariant ⇒ t' = s − w·z'. */
  function zoomAbout(zNext, sx, sy) {
    const z2 = clamp(zNext, zMin, zMax);
    const wx = (sx - T.x) / T.z;
    const wy = (sy - T.y) / T.z;
    setTransform({ x: sx - wx * z2, y: sy - wy * z2, z: z2 });
  }
```

Returned-object entries (above `setAgents`):

```js
    bounds,
    zoomAbout,
    /** Auto-fit from MODEL bounds into the band left of the floating inspector.
     *  Fit NEVER magnifies past 1x; the user zoom range stays zoomMin..zoomMax.
     *  Runs on view entry/re-entry and template load only — never after an edit. */
    fit({ insetRight = 0, pad = 60 } = {}) {
      const r = view.readRect();
      const b = bounds(pad);
      if (!b) return;
      applyFit(b, Math.max(1, (r.width || 0) - insetRight), Math.max(1, r.height || 0), 1);   // never past 1×
    },
    /** Static hosts: fit the graph into a card of width `w` (ResizeObserver-driven). */
    fitToWidth(w) {
      const r = view.readRect();
      const b = bounds(60);
      if (!b) return;
      const vw = Math.max(1, w || r.width || 0);
      const f = fitBounds(b, { width: vw, height: Number.MAX_SAFE_INTEGER }, { zoomMin: zMin, zoomMax: 1 });   // width decides z
      setTransform({ x: f.tx, y: (Math.max(1, r.height || 0) - b.h * f.z) / 2 - b.y * f.z, z: f.z });
    },
    /** Wheel/zoom nav for `monitor` hosts. `static` gets nothing; `edit` binds its
     *  own richer pipeline in composer.mjs and does NOT call this. */
    createNav({ wheelPan: pan = wheelPan, onEngaged = null } = {}) {
      if (mode === 'static') return { destroy() {} };
      let engaged = pan === 'always';
      const setEngaged = (v) => { if (engaged !== v) { engaged = v; if (onEngaged) onEngaged(v); } };
      const onWheel = (ev) => {
        const zoom = ev.ctrlKey || ev.metaKey;
        if (!zoom && !engaged) return;                   // engaged-only: let the PAGE scroll
        ev.preventDefault();
        const m = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? (R.height || 560) : 1;
        if (zoom) { zoomAbout(T.z * Math.exp(-ev.deltaY * m * 0.002), ev.clientX - R.left, ev.clientY - R.top); return; }
        setTransform({ x: T.x - ev.deltaX * m, y: T.y - ev.deltaY * m, z: T.z });
      };
      const engage = () => setEngaged(true);
      const disengage = (ev) => { if (pan !== 'always' && !stage.contains(ev.target)) setEngaged(false); };
      const onKey = (ev) => { if (ev.key === 'Escape' && pan !== 'always') setEngaged(false); };
      view.readRect();
      stage.addEventListener('wheel', onWheel, { passive: false });
      stage.addEventListener('pointerdown', engage);
      stage.addEventListener('focus', engage);
      doc.addEventListener('pointerdown', disengage, true);
      doc.addEventListener('keydown', onKey);
      const nav = {
        isEngaged: () => engaged,
        destroy() {
          stage.removeEventListener('wheel', onWheel);
          stage.removeEventListener('pointerdown', engage);
          stage.removeEventListener('focus', engage);
          doc.removeEventListener('pointerdown', disengage, true);
          doc.removeEventListener('keydown', onKey);
        },
      };
      navs.push(nav);
      return nav;
    },
```

with `const navs = [];` next to the Maps, and `destroy()` extended to `for (const n of navs.splice(0)) n.destroy();` before `stage.remove()`.

- [ ] Step 3: `node --test test/ui-graph-view.test.mjs` → `Expected: # pass 11 / # fail 0`.
- [ ] Step 4: Commit — `worca: Node-graph v2 P5 — view fit, modes and monitor nav controller`.

---

### Task 4: `style.css` — the `.gv-*` canvas block, geometry by CSS variable ONLY

**Files:** modify `ui/public/style.css` (APPEND a new block at the end of the file — do not touch `:1032-1185` or `:1258-1381` in this half); create `test/ui-graph-css.test.mjs`.
**Interfaces:** consumes `injectGeometry(stage)` (Task 1 already calls it at mount). Produces the class contract the renderer emits: `.gv-stage`, `.gv-world`, `.gv-wires`, `.node`, `.nhead`, `.nbody`, `.prow{.in,.out,.gate,.cap}`, `.psep`, `.dot{.md,.json,.void,.any}`, `.dia`, `.gdot`, `.npip`, `.wbadge`, `.gv-chip`.

> **Collision hazard (verified on dev):** `style.css:1094` declares an UNSCOPED `.node { position:relative; width:230px; padding:13px 14px 13px 18px; display:flex; align-items:center; gap:12px; }` for the v1 composer/run graph, and `:1096` gives it a `::before` colour bar. The v2 cards are also `div.node`, so EVERY v2 rule below is scoped under `.gv-world` (higher specificity) and explicitly resets the six leaked properties plus `::before`. P5b re-scopes the v1 rule to `.run-flow .node`; until then both must coexist.

- [ ] Step 1: Write the failing test — `test/ui-graph-css.test.mjs`:

```js
// test/ui-graph-css.test.mjs — the CSS geometry contract: style.css may express
// canvas geometry ONLY through the --gv-* variables injectGeometry writes, so
// the box model can never drift from nodeSize/portAnchor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { injectGeometry, GEOMETRY_CSS_VARS } from '../src/shared/graph/geometry.mjs';

const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');

test('every --gv-* variable style.css uses is one injectGeometry writes, and vice versa', () => {
  const dom = new JSDOM('<!doctype html><body><div id="s"></div></body>');
  const el = dom.window.document.getElementById('s');
  injectGeometry(el);
  const written = new Set((el.getAttribute('style') || '').match(/--gv-[a-z0-9-]+/g) || []);
  const used = new Set(css.match(/--gv-[a-z0-9-]+/g) || []);
  assert.ok(written.size >= 10, `injectGeometry wrote ${written.size} vars`);
  assert.deepEqual([...used].sort(), [...written].sort(), 'style.css --gv-* set === injectGeometry set');
  assert.equal(Object.keys(GEOMETRY_CSS_VARS).length, written.size);
});

test('the v2 canvas block hard-codes no geometry number', () => {
  const block = css.slice(css.indexOf('/* v2 node-graph canvas'));
  assert.ok(block.length > 400, 'the v2 block exists at the end of style.css');
  // Geometry constants only — decorative px (font sizes, radii, the dot grid) are fine.
  for (const bad of ['220px', '34px', '8.5px', '1.5px', '26px', '191.5px', '110.5px']) {
    assert.ok(!block.includes(bad), `v2 canvas CSS must not hard-code ${bad} — use var(--gv-*)`);
  }
});

test('.gv-wires path carries fill:none on the ELEMENT selector (ghost blob is impossible)', () => {
  const rule = css.match(/\.gv-wires\s+path\s*\{[^}]*\}/);
  assert.ok(rule, '.gv-wires path rule exists');
  assert.ok(/fill\s*:\s*none/.test(rule[0]), 'fill:none is on the layer element selector, not on .wire');
});

test('v2 cards neutralise the unscoped v1 .node rule', () => {
  const block = css.slice(css.indexOf('/* v2 node-graph canvas'));
  const card = block.match(/\.gv-world\s+\.node\s*\{[^}]*\}/);
  assert.ok(card, '.gv-world .node rule exists');
  for (const prop of ['position:absolute', 'display:block', 'padding:0', 'gap:0', 'width:var(--gv-node-w)']) {
    assert.ok(card[0].replace(/\s+/g, '').includes(prop), `resets ${prop}`);
  }
  assert.ok(/\.gv-world\s+\.node::before\s*\{[^}]*content\s*:\s*none/.test(block), 'kills the v1 colour bar');
});
```

`Expected: FAIL — AssertionError: the v2 block exists at the end of style.css` (and the `--gv-*` set equality fails: `used` is empty).

- [ ] Step 2: Implement — append to the END of `ui/public/style.css`:

```css
/* ========================================================================== */
/* v2 node-graph canvas — EVERY geometry number comes from the --gv-* custom   */
/* properties injectGeometry() writes on .gv-stage at mount, so the CSS box    */
/* model cannot drift from nodeSize()/portAnchor(). Never hard-code a px       */
/* geometry value here (test/ui-graph-css.test.mjs enforces it).               */
/* Scoped under .gv-world because style.css:1094 declares an UNSCOPED `.node`  */
/* for the v1 run graph; the resets below neutralise every property it leaks.  */
/* ========================================================================== */
.gv-canvas{position:relative;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;
  background:#FBFBF9 radial-gradient(circle,var(--line-2) 1.1px,transparent 1.1px);background-size:22px 22px;}
.gv-stage{position:absolute;inset:0;outline:none;}
.gv-stage.panning{cursor:grabbing;}
.gv-stage.space{cursor:grab;}
.gv-world{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;will-change:transform;}
.gv-wires{position:absolute;left:0;top:0;overflow:visible;pointer-events:none;z-index:1;}
/* THE rule that makes a filled ghost blob structurally impossible. */
.gv-wires path{fill:none;stroke:var(--seq);stroke-width:2;stroke-linecap:round;}
.gv-wires path.loop{stroke:var(--amber);}
.gv-wires path.sel{stroke:var(--ink);stroke-width:2.5;}
.gv-wires path.bad{stroke:var(--red);}
.gv-wires path.ghost{stroke:var(--ink-3);stroke-dasharray:5 4;visibility:hidden;}
.gv-wires path.ghost.on{visibility:visible;}
.gv-wires path.ghost.legal{stroke:var(--green);stroke-dasharray:none;}
.gv-wires path.ghost.illegal{stroke:var(--red);}
.gv-world .node{position:absolute;left:0;top:0;display:block;padding:0;gap:0;align-items:stretch;z-index:2;
  width:var(--gv-node-w);background:#fff;border:var(--gv-border) solid var(--line-2);border-radius:16px;
  box-shadow:var(--shadow-soft);cursor:grab;transition:box-shadow .12s;}
.gv-world .node::before{content:none;}
.gv-world .node:hover{box-shadow:var(--shadow);}
.gv-world .node.sel{outline:2px solid var(--ink);outline-offset:2px;}
.gv-world .node.dragging{cursor:grabbing;transition:none;}
.gv-static .node,.gv-static .wbadge{pointer-events:none;}
.gv-world .nhead{height:var(--gv-head-h);display:flex;align-items:center;gap:8px;padding:0 11px;
  border-radius:14.5px 14.5px 0 0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gv-world .nhead svg{width:15px;height:15px;flex:0 0 auto;stroke-width:1.85;}
.gv-world .nhead .tt{overflow:hidden;text-overflow:ellipsis;}
.gv-world .h-flow{background:var(--ink);color:#fff;}
.gv-world .h-violet{background:var(--violet-bg);color:var(--violet-ink);}
.gv-world .h-blue{background:#DEEFF7;color:#2E6E8E;}
.gv-world .h-green{background:#E2F3DF;color:#3B7C3B;}
.gv-world .h-red{background:var(--red-bg);color:var(--red-ink);}
.gv-world .h-peach{background:#FCEEDA;color:#8A5A16;}
.gv-world .h-amber{background:var(--amber-bg);color:var(--amber-ink);}
.gv-world .nbody{padding:var(--gv-pad-t) 0 var(--gv-pad-b);}
.gv-world .prow{position:relative;height:var(--gv-row-h);display:flex;align-items:center;gap:7px;padding:0 13px;}
.gv-world .prow.out{justify-content:flex-end;}
.gv-world .prow .pn{font-size:12.5px;font-weight:500;}
.gv-world .prow .pt{font:10px/1.3 var(--mono);color:var(--ink-3);}
.gv-world .prow .pt.cond{color:var(--amber-ink);}
.gv-world .prow .mla{margin-left:auto;}
.gv-world .psep{height:var(--gv-sep-h);position:relative;}
.gv-world .psep::after{content:"";position:absolute;left:13px;right:13px;top:4px;height:1px;background:var(--line);}
/* dot centre = row centre: top = (ROW_H − DOT)/2; x overhang = DOT/2 + BORDER,
   so the anchor lands exactly on node.x / node.x + NODE_W. */
.gv-world .dot,.gv-world .gdot{position:absolute;top:calc((var(--gv-row-h) - var(--gv-dot)) / 2);
  width:var(--gv-dot);height:var(--gv-dot);border-radius:50%;}
.gv-world .prow.in .dot,.gv-world .prow.in .gdot{left:calc(-1 * (var(--gv-dot) / 2 + var(--gv-border)));}
.gv-world .prow.out .dot{right:calc(-1 * (var(--gv-dot) / 2 + var(--gv-border)));}
.gv-world .dot.md{background:var(--ink);}
.gv-world .dot.json{background:var(--blue);}
.gv-world .dot.void{background:#fff;border:2px solid var(--ink-3);}
.gv-world .dot.any{background:#fff;border:2px solid var(--ink);}
.gv-world .dia{position:absolute;top:8px;right:calc(-1 * (4px + var(--gv-border)));width:8px;height:8px;
  background:var(--amber);border-radius:2px;transform:rotate(45deg);}
.gv-world .gdot{background:var(--field);border:2px dashed var(--seq);}
.gv-world .prow.gate .pn,.gv-world .prow.gate .pt{color:var(--ink-3);}
.gv-world .prow.gate.wired .gdot{background:#fff;border-color:var(--ink);}
.gv-world .prow.gate.wired .pn{color:var(--ink);}
.gv-world .prow.drop-ok .dot,.gv-world .prow.drop-ok .gdot{transform:scale(1.35);box-shadow:0 0 0 3px #D8EFD6;border-color:var(--green);}
.gv-world .prow.drop-bad .dot,.gv-world .prow.drop-bad .gdot{box-shadow:0 0 0 3px var(--red-bg);border-color:var(--red);}
.gv-world .npip{position:absolute;top:-7px;left:-7px;width:14px;height:14px;border-radius:50%;
  background:var(--red);border:2px solid #fff;cursor:pointer;z-index:3;}
.gv-world .wbadge{position:absolute;transform:translate(-50%,-50%);z-index:2;background:var(--amber-bg);
  color:var(--amber-ink);border:1px solid var(--amber);border-radius:999px;padding:1px 7px;
  font:10px/1.4 var(--mono);pointer-events:none;}
.gv-chip{position:absolute;z-index:6;pointer-events:none;background:var(--red-bg);color:var(--red-ink);
  border:1px solid var(--red);border-radius:8px;padding:4px 8px;font-size:11px;font-weight:600;white-space:nowrap;}
.gv-chip[hidden]{display:none;}
@media (prefers-reduced-motion:reduce){.gv-world .node{transition:none;}}
```

- [ ] Step 3: `node --test test/ui-graph-css.test.mjs` → `Expected: # pass 4 / # fail 0`.
- [ ] Step 4: Commit — `worca: Node-graph v2 P5 — canvas CSS driven by the geometry variables`.

---

### Task 5: thumbnails, static previews, and the `destroy()` leak proof

**Files:** modify `ui/public/graph/view.mjs`; modify `test/ui-graph-view.test.mjs`.
**Interfaces:** produces `thumbnailFor(template, portsFn, {width, height}) → string` (thin guard over the shared `thumbnailSvg`; returns `''` for an empty/absent template so a saved row never renders `undefined`) and `mountStaticGraph(host, template, {doc, portsFn, agents, width}) → view` (a `static` view, rendered, `fitToWidth`, with a GUARDED `ResizeObserver` — jsdom has none). Consumed by P5b's saved-pipelines list and by P6's Running-list Detailed card.

- [ ] Step 1: Write the failing tests — append to `test/ui-graph-view.test.mjs`:

```js
test('thumbnailFor guards empty templates and returns svg markup otherwise', async () => {
  const { createGraphView, thumbnailFor } = await import(viewPath);
  assert.equal(typeof createGraphView, 'function');
  assert.equal(thumbnailFor(null, portsFn, { width: 240, height: 90 }), '');
  assert.equal(thumbnailFor({ nodes: [], wires: [] }, portsFn, { width: 240, height: 90 }), '');
  const svg = thumbnailFor(fixture(), portsFn, { width: 240, height: 90 });
  assert.match(svg, /^<svg[\s>]/);
  assert.ok(!svg.includes('NaN'), 'no NaN in the path data');
});

test('mountStaticGraph renders, fits to width and survives a missing ResizeObserver', async () => {
  const { doc, host, win } = boot();
  assert.equal(typeof win.ResizeObserver, 'undefined', 'jsdom 29 has no ResizeObserver');
  const { mountStaticGraph } = await import(viewPath);
  const view = mountStaticGraph(host, fixture(), {
    doc, portsFn, agents: AGENTS, width: 520, viewport: () => ({ left: 0, top: 0, width: 520, height: 300 }),
  });
  assert.equal(view.mode, 'static');
  assert.equal(view.getTransform().z, 0.5);
  assert.equal(host.querySelectorAll('.node').length, 3);
});

test('destroy() removes the stage and leaves no listener that can mutate anything', async () => {
  const { doc, host, win } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS, viewport: () => ({ ...VP }) });
  view.render(fixture(), {});
  view.createNav({ wheelPan: 'always' });
  const stage = view.stage;
  view.setTransform({ x: 0, y: 0, z: 1 });
  view.destroy();
  assert.equal(host.querySelector('.gv-stage'), null, 'stage removed');
  stage.dispatchEvent(new win.WheelEvent('wheel', { deltaX: 40, bubbles: true, cancelable: true }));
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.deepEqual(view.getTransform(), { x: 0, y: 0, z: 1 }, 'no listener survived destroy()');
});
```

`Expected: FAIL — TypeError: thumbnailFor is not a function`.

- [ ] Step 2: Implement — add to `ui/public/graph/view.mjs`:

```js
import { thumbnailSvg } from '../../../src/shared/graph/thumbnail.mjs';

/** Saved-pipeline preview markup. Numbers only — no DOM, no measure. */
export function thumbnailFor(template, portsFn, { width = 240, height = 96 } = {}) {
  if (!template || !Array.isArray(template.nodes) || !template.nodes.length) return '';
  return thumbnailSvg(template, portsFn, { width, height });
}

/** A non-interactive graph for a fixed-width card (saved rows, Running list).
 *  NO listeners: the card's own click handler must keep working, which is why
 *  `.gv-static .node` is pointer-events:none in style.css. */
export function mountStaticGraph(host, template, { doc = globalThis.document, portsFn, agents = {}, width = 0, viewport = null } = {}) {
  const view = createGraphView(host, { doc, mode: 'static', portsFn, agents, viewport });
  view.render(template, {});
  const paint = () => view.fitToWidth(width || host.clientWidth || 0);
  paint();
  const win = doc.defaultView || globalThis;
  if (typeof win.ResizeObserver === 'function') {
    const ro = new win.ResizeObserver(() => view.fitToWidth(host.clientWidth || width || 0));
    ro.observe(host);
    const inner = view.destroy;
    view.destroy = () => { ro.disconnect(); inner(); };
  }
  return view;
}
```

- [ ] Step 3: Add the import-convention guard — `test/ui-graph-imports.test.mjs`:

```js
// test/ui-graph-imports.test.mjs — the §3 import convention is a CONTRACT: the
// browser modules reach the shared core by a relative path that walks above the
// static root. An absolute specifier ('/src/shared/...') breaks Node ESM, and the
// UI tests import these files as plain Node modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = fileURLToPath(new URL('../ui/public/graph/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.mjs'));

test('every ui/public/graph module reaches src/shared by a 3-level relative path', () => {
  assert.ok(files.length >= 5, `expected the graph modules, found ${files.join(',')}`);
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/from\s+['"]\/src\//.test(src), `${f} must not use an absolute /src specifier`);
    for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const spec = m[1];
      if (!spec.includes('src/shared')) continue;
      assert.ok(spec.startsWith('../../../src/shared/'), `${f}: '${spec}' must start with ../../../src/shared/ (depth 3)`);
      assert.ok(existsSync(path.join(dir, spec)), `${f}: '${spec}' resolves on disk`);
    }
  }
});

test('the browser modules never import from src/core (no cross-layer leak)', () => {
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/src\/core\//.test(src), `${f} must not import from src/core`);
  }
});
```
`Expected: PASS — 2 tests` (the guard is green the moment `view.mjs` exists with the documented imports; if it fails, fix the import, never the test).

- [ ] Step 4: `node --test test/ui-graph-view.test.mjs test/ui-graph-imports.test.mjs` → `Expected: # pass 16 / # fail 0`.
- [ ] Step 5: Commit — `worca: Node-graph v2 P5 — thumbnails, static previews, destroy teardown`.

---

### Task 6: P5a green — full suite, commit, split point

- [ ] Step 1: `npm test 2>&1 | tail -5`. **Expected: BASELINE + 20 new tests** (14 in `test/ui-graph-view.test.mjs` + 4 in `test/ui-graph-css.test.mjs` + 2 in `test/ui-graph-imports.test.mjs`), 0 failures. Nothing in P5a touches an existing suite: `view.mjs`, `style.css`'s new tail block and the three new test files are additive.
- [ ] Step 2: If `test/api-sources.test.mjs` fails with `ENOTEMPTY` in teardown, re-run that file alone — it is a known intermittent that fails the whole FILE and inflates the count by one; it is never caused by this plan's diff.
- [ ] Step 3: Commit — `worca: Node-graph v2 P5 — P5a renderer complete (view, CSS, thumbnails)`.
- [ ] Step 4: Record the printed total; P5b's entry check re-reads it as its own baseline.

### — split point: P5b starts here —

### Task 7: P5b entry check

- [ ] Step 1: `git rev-parse --abbrev-ref HEAD` — the pipeline's branch (by hand: continue on `worca-cc/node-graph-v2-p5`, or branch `worca-cc/node-graph-v2-p5b` off the P5a commit). Never `git checkout dev`.
- [ ] Step 2: `[ -d node_modules ] || npm ci`
- [ ] Step 3: P5a sentinel — `grep -q "export function createGraphView" ui/public/graph/view.mjs && grep -q "export function mountStaticGraph" ui/public/graph/view.mjs && grep -q "v2 node-graph canvas" ui/public/style.css && echo P5A_OK`. If absent, STOP.
- [ ] Step 4: `npm test 2>&1 | tail -5` — record the pass count as **BASELINE-B** (= P5a's final total; must be green).

---

### Task 8: Retire the v1 composer (surgical — the v1 RUN graph must keep working)

**Files:** delete `ui/public/composer-core.mjs` (211 lines). Delete `test/composer-ui.test.mjs`, `test/ui-composer.test.mjs`, `test/ui-composer-hint.test.mjs`, `test/ui-composer-legend.test.mjs`, `test/ui-composer-palette-desc.test.mjs`, `test/ui-composer-palette-filter.test.mjs`, `test/ui-composer-steptag.test.mjs`, `test/ui-composer-wires.test.mjs`, `test/connects-to.test.mjs`. Modify `ui/public/app.js`, `ui/public/index.html`, `ui/public/style.css`, `test/ui-workspace-selectors.test.mjs`, `test/ui-agents-view.test.mjs`.

> **Three couplings verified on dev — get these wrong and the Running/History graphs break:**
> 1. `composerPaintWires` (`app.js:2353-2434`) is the SHARED v1 wire renderer: `app.js:1205` (`const paint = (window.__np && window.__np.composerPaintWires) || composerPaintWires;`) and `app.js:2919` (the `window.__np` export read by `test/ui-run-graph-paint.test.mjs:109`) both need it. **KEEP it**, together with `COMPOSER_COLORS` (`:1950`), `COMPOSER_TINTS` (`:1951`) and `COMPOSER_SEQ` (`:1952`).
> 2. `runNodeAgent` (`app.js:959-968`) reads `composer.agents[key] || EMBEDDED_AGENTS[key]` for the run-graph icon/label. Both die here, so it gets a real registry cache instead.
> 3. `style.css:1094-1121` declares an UNSCOPED `.node` that `.run-flow .node` INHERITS (documented at `style.css:1260-1262`). Re-scope it; do not delete it.

- [ ] Step 1: `app.js` — replace the run-graph's agent-meta source. Delete lines 954-957 (the "read composer.agents RAW" comment) and rewrite `runNodeAgent`'s first three lines:
```js
// The run graph paints agent icons/labels from the live registry. The cache is
// filled on demand (buildRunGraph) and by every agent mutation, so a run opened
// without ever visiting the Composer still shows real icons.
const agentMetaCache = new Map();     // key -> normalized meta from GET /api/agents
let _agentMetaPending = null;
async function ensureAgentMeta(onReady) {
  if (agentMetaCache.size) return;
  if (!_agentMetaPending) _agentMetaPending = fetchAgents();
  const res = await _agentMetaPending;
  _agentMetaPending = null;
  const list = Array.isArray(res) ? res : (res && Array.isArray(res.agents) ? res.agents : []);
  for (const a of list) if (a && a.key) agentMetaCache.set(a.key, a);
  if (list.length && typeof onReady === 'function') onReady();
}
function runNodeAgent(node) {
  const key = node && node.key;
  const meta = (key && agentMetaCache.get(key)) || {};
  return {
```
(the rest of `runNodeAgent` — `icon`/`color`/`label`/`sub` — is unchanged). In `buildRunGraph(host, manifest)` (`app.js:1071`; called from `:941`, `:10875`, `:14078`, `:14924`) add as the first statement: `ensureAgentMeta(() => buildRunGraph(host, manifest));` — one refetch, one repaint, never a loop (the `agentMetaCache.size` guard makes the second call a no-op, and the callback only fires when the fetch actually filled the cache). In `invalidateAgentCaches` (`:6590`) replace `_composerPaletteDirty = true;` with `agentMetaCache.clear();`.
- [ ] Step 2: `app.js` — delete the `composer-core.mjs` import statement (`:52-61`, the whole `import { … } from './composer-core.mjs';`). Delete lines **1935-2636** (from the `// ---` banner at `:1935` through the closing `}` of `composerRenderList` at `:2636`) EXCEPT: keep `COMPOSER_COLORS`/`COMPOSER_TINTS`/`COMPOSER_SEQ` (`:1950-1952`) and the whole `composerPaintWires` function (`:2353-2434`) — move both above the run-graph section (after `app.js:948`) under the banner `// ---- v1 run-graph wire renderer (dies with the v1 engine in P8) ----`. Do NOT touch `modelById`/`option` (`:2638-2647`) — the New-Pipeline rows use them.
- [ ] Step 3: `app.js` — drop `composer, composerRefresh,` from the `window.__np` export (`:2880`); KEEP `composerPaintWires,` (`:2919`). Change `TIP_SELECTOR` (`:7780`) to `'.info-tip, #gv-palette .ap'`. Delete the `if (name === 'composer') initComposer();` line (`:15416`) — Task 16 re-adds it. Leave `'composer'` in `VIEW_NAMES` (`:15315`).
- [ ] Step 4: `index.html` — replace lines 1061-1116 with the placeholder (Task 9 fills it):
```html
        <!-- ===== VIEW: WORKFLOW COMPOSER (v2 node graph) ===== -->
        <section class="view hidden" data-view="composer"></section>
        <!-- /view composer -->
```
- [ ] Step 5: `style.css` — delete `:1032-1093` (banner + `.builder-card` … `.composer-hint` … `.col.over .par-hint`) and `:1123-1167` (`.builder-foot` … `.ro-flow .node`). KEEP `:1168-1185` (`.fanout-toggle`, `.questions-toggle` — New Pipeline). Re-scope `:1094-1121` by prefixing every selector with `.run-flow ` (e.g. `.node{…}` → `.run-flow .node{…}`, `.node .nx,.node .loop,.node .selfloop{…}` → `.run-flow .node .nx,.run-flow .node .loop,.run-flow .node .selfloop{…}`), and change `:1102`'s `.flow .node .nmeta small` to `.run-flow .node .nmeta small`. Add the banner `/* v1 run-graph node look (was the shared composer `.node`; dies in P8) */` above them. Do NOT touch `:1258-1381`.
- [ ] Step 6: Tests — delete the nine files listed above. In `test/ui-workspace-selectors.test.mjs` replace the `composer-core is imported INSIDE app.js` test (`:67-69` inside its `test(...)` block) with:
```js
test('the v1 composer is gone: no composer-core module, no composer-core script tag', () => {
  assert.ok(!js.includes('composer-core.mjs'), 'app.js no longer imports composer-core.mjs');
  assert.ok(!html.includes('composer-core.mjs'), 'composer-core.mjs must not be a <script> in index.html');
});
```
In `test/ui-agents-view.test.mjs` delete the whole `test('composer save surfaces server warnings via the link-banner toast', …)` block (`:131-159`) — it drives `#composer-save` / `#composer-link-text`, which no longer exist.
- [ ] Step 7: `npm test 2>&1 | tail -5` → green. **Record the printed total as BASELINE-B2** and the drop from BASELINE-B (that number is the retired suites' test count; do not guess it — copy what the run prints). Also run `grep -rn "composer-core\|EMBEDDED_AGENTS\|__composer\b" ui/ test/ src/` → only the `log-line.mjs:5` prose comment may remain; fix anything else.
- [ ] Step 8: Commit — `worca: Node-graph v2 P5 — retire the v1 composer (run graph preserved)`.

---

### Task 9: `index.html` + `style.css` — the D3 composer shell

**Files:** modify `ui/public/index.html` (REPLACE the placeholder composer section Task 8 left behind); modify `ui/public/style.css` (append the composer-shell block after the v2 canvas block); create `test/ui-composer-shell.test.mjs`.
**Interfaces:** produces the element ids the editor binds to. **The header bar, the reason chip and the inspector rail are SIBLINGS of the stage** (the stage is created inside `#gv-canvas` by `createGraphView`), so a pointerdown on a button never reaches the stage handler — the PR #359 capture bug is structurally impossible.

- [ ] Step 1: Write the failing test — `test/ui-composer-shell.test.mjs`:

```js
// test/ui-composer-shell.test.mjs — the composer view's markup contract (D3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
const doc = new JSDOM(html).window.document;
const view = doc.querySelector('section.view[data-view="composer"]');

test('the composer view carries the D3 layout in order', () => {
  assert.ok(view, 'composer view exists');
  const order = [...view.querySelectorAll(':scope > .gv-head, :scope > .gv-canvas, :scope > .gv-agents, :scope > .gv-saved')]
    .map((el) => el.className.split(' ')[0]);
  assert.deepEqual(order, ['gv-head', 'gv-canvas', 'gv-agents', 'gv-saved']);
});

test('chip and inspector rail are SIBLINGS of the stage inside the canvas host', () => {
  const canvas = view.querySelector('#gv-canvas');
  assert.equal(canvas.querySelector(':scope > #gv-chip').tagName, 'DIV');
  assert.equal(canvas.querySelector(':scope > #gv-ins-rail').tagName, 'DIV');
  assert.equal(canvas.querySelector('.gv-stage'), null, 'the stage is created by createGraphView, not shipped in HTML');
  for (const id of ['gv-save', 'gv-autolayout', 'gv-new']) {
    assert.ok(!canvas.contains(doc.getElementById(id)), `#${id} must live in the header bar, never inside the canvas`);
  }
});

test('every id the editor binds exists exactly once', () => {
  for (const id of ['gv-head', 'gv-name', 'gv-new', 'gv-autolayout', 'gv-save', 'gv-dirty', 'gv-errors',
    'gv-canvas', 'gv-chip', 'gv-ins-rail', 'gv-ins-body', 'gv-ins-toggle', 'gv-agents', 'gv-agent-filter',
    'gv-palette', 'gv-legend', 'gv-saved-list', 'gv-saved-count', 'gv-archived', 'gv-dialog-host']) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `#${id} appears exactly once`);
  }
  assert.equal(doc.getElementById('gv-legend').textContent.trim(),
    'grey = data · amber = loop · ◆ = conditional · ○ = gate · ⤫N = fan-out');
});

test('the v1 composer markup is gone', () => {
  for (const id of ['composer-flow', 'composer-wires', 'composer-palette', 'composer-saved-list']) {
    assert.ok(!html.includes(`id="${id}"`), `v1 #${id} removed`);
  }
});
```

`Expected: FAIL — AssertionError: Expected values to be strictly deep-equal: [] !== ['gv-head','gv-canvas','gv-agents','gv-saved']`.

- [ ] Step 2: Implement — replace the placeholder `<section class="view hidden" data-view="composer">…</section>` in `ui/public/index.html` with:

```html
        <!-- ===== VIEW: WORKFLOW COMPOSER (v2 node graph) ===== -->
        <section class="view hidden" data-view="composer">
          <div class="topbar">
            <div>
              <h1>Workflow Composer</h1>
              <div class="sub">Wire agents into a pipeline — outputs feed inputs, loops carry a budget</div>
            </div>
          </div>

          <section class="card">
            <div class="gv-head" id="gv-head">
              <input id="gv-name" class="gv-name" type="text" spellcheck="false" placeholder="Untitled pipeline" aria-label="Pipeline name">
              <span class="gv-dirty" id="gv-dirty" hidden title="Unsaved changes">•</span>
              <button type="button" class="gv-errchip" id="gv-errors" hidden></button>
              <span class="sp"></span>
              <button type="button" class="btn-ghost" id="gv-new">New canvas</button>
              <button type="button" class="btn-ghost" id="gv-autolayout">Auto-layout</button>
              <button type="button" class="btn-go" id="gv-save">Save</button>
            </div>
            <!-- The stage is created INSIDE #gv-canvas by createGraphView. The chip
                 and the inspector rail are its SIBLINGS: a pointerdown on them can
                 never reach the stage, so capture can never retarget their click. -->
            <div class="gv-canvas" id="gv-canvas">
              <div class="gv-chip" id="gv-chip" hidden></div>
              <div class="gv-ins-rail" id="gv-ins-rail" data-open="open">
                <button type="button" class="gv-ins-toggle" id="gv-ins-toggle" aria-expanded="true" aria-label="Collapse inspector">›</button>
                <div class="gv-ins-body" id="gv-ins-body"></div>
              </div>
            </div>
          </section>

          <section class="card gv-agents" id="gv-agents">
            <div class="gv-agents-head">
              <b>Agents</b>
              <input id="gv-agent-filter" class="pal-filter" type="search" placeholder="Filter agents…" aria-label="Filter agents by name or ports">
              <span class="gv-legend" id="gv-legend">grey = data · amber = loop · ◆ = conditional · ○ = gate · ⤫N = fan-out</span>
            </div>
            <div class="gv-palette" id="gv-palette"></div>
          </section>

          <section class="card gv-saved">
            <div class="saved-head">
              <div><b>Saved pipelines</b><span class="cnt" id="gv-saved-count"></span></div>
            </div>
            <div class="saved-list" id="gv-saved-list"></div>
            <div class="gv-archived" id="gv-archived" hidden></div>
          </section>
          <div id="gv-dialog-host"></div>
        </section>
        <!-- /view composer -->
```

- [ ] Step 3: Append to `ui/public/style.css` (after the v2 canvas block; the canvas height is CONSTANT — D3):

```css
/* v2 composer shell — header bar / canvas / agents card / saved list. */
.gv-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line-2);}
.gv-head .sp{flex:1;}
.gv-name{border:1px solid transparent;background:transparent;font:600 15px var(--sans);color:var(--ink);
  padding:6px 8px;border-radius:8px;min-width:200px;}
.gv-name:hover{background:var(--field);}
.gv-name:focus{background:#fff;border-color:var(--line-2);outline:none;}
.gv-dirty{color:var(--amber);font-size:20px;line-height:1;}
.gv-dirty[hidden]{display:none;}
.gv-errchip{background:var(--red-bg);color:var(--red-ink);border:1px solid var(--red);border-radius:999px;
  padding:3px 10px;font:600 11.5px var(--sans);cursor:pointer;}
.gv-errchip[hidden]{display:none;}
#gv-canvas{height:560px;}
.gv-ins-rail{position:absolute;top:0;right:0;bottom:0;width:280px;z-index:6;background:var(--panel);
  border-left:1px solid var(--line-2);display:flex;overflow:hidden;}
.gv-ins-rail[data-open="collapsed"]{width:28px;}
.gv-ins-rail[data-open="collapsed"] .gv-ins-body{display:none;}
.gv-ins-toggle{width:28px;flex:0 0 28px;border:none;background:var(--field);color:var(--ink-2);cursor:pointer;font-size:13px;}
.gv-ins-body{flex:1;overflow:auto;padding:12px;}
.gv-agents-head{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);}
.gv-legend{margin-left:auto;font:11px var(--mono);color:var(--ink-3);}
.gv-palette{max-height:300px;overflow:auto;padding:10px 16px 14px;}
.pal-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;}
.pal-chip{border:1px solid var(--line-2);border-radius:999px;background:#fff;padding:3px 11px;font-size:11.5px;cursor:pointer;}
.pal-chip.off{opacity:.45;}
.pal-group .grp{display:flex;align-items:center;gap:8px;margin:10px 0 6px;font:600 11.5px var(--sans);color:var(--ink-2);}
.pal-group[hidden]{display:none;}
.pills{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;}
.ap{display:flex;align-items:center;gap:9px;border:1px solid var(--line-2);border-radius:12px;background:#fff;
  padding:8px 11px;cursor:grab;text-align:left;}
.ap[hidden]{display:none;}
.ap:disabled,.ap.dim{opacity:.45;cursor:default;}
.ap .d{width:9px;height:9px;border-radius:50%;background:var(--seq);flex:0 0 auto;}
.ap .b{min-width:0;}
.ap .n{display:block;font:600 12.5px var(--sans);}
.ap .p{display:block;font:10.5px var(--mono);color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.gv-drag-ghost{position:fixed;z-index:99;pointer-events:none;border:1.5px dashed var(--ink-3);border-radius:12px;
  background:#fff;padding:6px 10px;font:600 12px var(--sans);opacity:.9;}
.gv-saved .pl-thumb{width:100%;height:96px;display:block;}
.gv-saved .pl-legacy{background:var(--field);color:var(--ink-3);border-radius:999px;padding:2px 9px;font-size:11px;}
.gv-archived{padding:10px 16px;border-top:1px solid var(--line);font-size:12px;color:var(--ink-2);}
.gv-archived[hidden]{display:none;}
.gv-empty{position:absolute;left:0;right:0;top:44%;text-align:center;color:var(--ink-3);font-size:13px;pointer-events:none;}
.gv-empty[hidden]{display:none;}
```

- [ ] Step 4: `node --test test/ui-composer-shell.test.mjs` → `Expected: # pass 4 / # fail 0`; then `npm test 2>&1 | tail -5` → `Expected: BASELINE-B2 + 4`, green.
- [ ] Step 5: Commit — `worca: Node-graph v2 P5 — composer shell markup and CSS (D3 layout)`.

---

### Task 10: `composer.mjs` — the normative pointer pipeline

**Files:** create `ui/public/graph/composer.mjs`; create `test/ui-composer-editor.test.mjs`.
**Interfaces:** produces `createComposer(hostEls, {api, raf, viewport, storage, doc}) → composer`. `hostEls` = `{canvas, chip, head, name, dirty, errors, newBtn, autoBtn, saveBtn, insRail, insBody, insToggle, palette, filter, savedList, savedCount, archived, dialogHost}`. `api` (injected — the editor never calls `fetch` itself) = `{ agents(), agentsAll(), config(), listWorkflows(), listArchived(), readWorkflow(id), saveWorkflow(body), deleteWorkflow(id) }`. The composer exposes `{ mount, destroy, loadTemplate, newCanvas, template, report, commit, undo, redo, undoDepth, isDirty, fit, gesture, view, stats }`.

**THE PIPELINE (normative — every line of it is a defect fix):**
- `mount()` binds: stage `pointerdown/pointermove/pointerup/pointercancel/lostpointercapture`, stage `wheel {passive:false}`, window `blur`, document `keydown/keyup`, `ResizeObserver(stage)` (guarded), window `resize`, document `scroll {capture:true, passive:true}`. `destroy()` removes every one of them.
- `onDown`: bail if a gesture is live or `button ∉ {0,1}`; ONE `readRect()`; `pt = toWorld(...)`; classify middle/space ⇒ pan · `hitPortAt` ⇒ wire (ghost shown NOW, one write) · `hitNodeAt` ⇒ node (grab offset + start pos + `moved:false`) · `hitWireAt` ⇒ select wire · else pan + clear selection; then `try { stage.setPointerCapture(id) } catch {}` + `preventDefault()`.
- `onMove`: `pend = {x, y}; if (!rafId) rafId = raf(frame);` — NOTHING else. No DOM, no hit-test, no validation.
- `frame()`: at most one DOM pass per animation frame; node drags repaint ONLY `view.incidentOf(id)`.
- `onUp`: cancel the pending frame, run `frame()` once at the up position, commit, `finish()`.
- `cancel()`: reverts a moved node to `start`, hides ghost + chip, `finish()`.
- `commit(label, mutate)`: push undo → mutate → `dirty = true` → targeted render → `scheduleValidate()` (`setTimeout(0)`, collapsed to one run). Validation and `classifyLoops` NEVER run on the pointer path.

- [ ] Step 1: Write the failing test — `test/ui-composer-editor.test.mjs`:

```js
// test/ui-composer-editor.test.mjs — the composer's pointer pipeline under jsdom.
// jsdom has no layout, no rAF and no pointer capture: `viewport` injects the
// stage rect and `raf` queues frames so "60 moves ⇒ 1 frame" is observable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fixture, portsFn, AGENTS } from './ui-graph-view.test.mjs';

const composerPath = new URL('../ui/public/graph/composer.mjs', import.meta.url).href;
const RECT = { left: 0, top: 0, width: 1280, height: 560 };

const IDS = ['gv-canvas', 'gv-chip', 'gv-head', 'gv-name', 'gv-dirty', 'gv-errors', 'gv-new', 'gv-autolayout',
  'gv-save', 'gv-ins-rail', 'gv-ins-body', 'gv-ins-toggle', 'gv-palette', 'gv-agent-filter', 'gv-saved-list',
  'gv-saved-count', 'gv-archived', 'gv-dialog-host'];

export function shell() {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/' });
  const doc = dom.window.document;
  const el = {};
  for (const id of IDS) {
    const tag = /name|agent-filter/.test(id) ? 'input' : (/save|new|autolayout|errors|ins-toggle/.test(id) ? 'button' : 'div');
    const n = doc.createElement(tag);
    n.id = id;
    doc.body.appendChild(n);
  }
  // chip and rail are the stage's SIBLINGS inside the canvas host, exactly as in index.html
  doc.getElementById('gv-canvas').append(doc.getElementById('gv-chip'), doc.getElementById('gv-ins-rail'));
  for (const id of IDS) el[id.replace(/^gv-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = doc.getElementById(id);
  const q = [];
  return {
    dom, win: dom.window, doc, el,
    hostEls: {
      canvas: el.canvas, chip: el.chip, head: el.head, name: el.name, dirty: el.dirty, errors: el.errors,
      newBtn: el.new, autoBtn: el.autolayout, saveBtn: el.save, insRail: el.insRail, insBody: el.insBody,
      insToggle: el.insToggle, palette: el.palette, filter: el.agentFilter, savedList: el.savedList,
      savedCount: el.savedCount, archived: el.archived, dialogHost: el.dialogHost,
    },
    raf: (fn) => { q.push(fn); return q.length; },
    flush: () => { const l = q.splice(0, q.length); for (const fn of l) fn(); return l.length; },
    frames: () => q.length,
  };
}

export const API = {
  agents: async () => Object.values(AGENTS),
  agentsAll: async () => Object.values(AGENTS),
  config: async () => ({ models: [{ id: 'sonnet', label: 'Sonnet' }], efforts: ['low', 'high'] }),
  listWorkflows: async () => [],
  listArchived: async () => [],
  readWorkflow: async () => null,
  saveWorkflow: async () => ({ ok: true, workflow: { id: 'wf_x' } }),
  deleteWorkflow: async () => ({ ok: true }),
};

export async function open(overrides = {}) {
  const s = shell();
  const { createComposer } = await import(composerPath);
  const c = createComposer(s.hostEls, {
    doc: s.doc, api: { ...API, ...(overrides.api || {}) }, raf: s.raf,
    viewport: () => ({ ...RECT }), storage: overrides.storage || null, portsFn,
  });
  c.mount();
  c.loadTemplate(overrides.template === undefined ? fixture() : overrides.template);
  return { ...s, c };
}

const down = (s, x, y, extra = {}) => s.c.view.stage.dispatchEvent(new s.win.PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true, ...extra }));
const move = (s, x, y) => s.c.view.stage.dispatchEvent(new s.win.PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: y, bubbles: true }));
const up = (s, x, y) => s.c.view.stage.dispatchEvent(new s.win.PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true }));

test('60 pointermoves coalesce into ONE frame and ONE ghost d write', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  down(s, 620, 193);                                     // n_agent.plan output anchor
  assert.equal(s.c.gesture().type, 'wire');
  const g0 = s.c.view.stats.ghostUpdates;
  for (let i = 0; i < 60; i += 1) move(s, 200 + i, 480 + (i % 7));
  assert.equal(s.frames(), 1, '60 moves ⇒ exactly one queued frame');
  assert.equal(s.c.view.stats.ghostUpdates - g0, 0, 'no DOM write before the frame runs');
  s.flush();
  assert.equal(s.c.view.stats.ghostUpdates - g0, 1, 'the frame writes d exactly once');
  assert.equal(s.c.stats.rectReads, 2, 'one read at mount + one at gesture start; ZERO on the move path');
  up(s, 259, 486);
  s.flush();
  assert.equal(s.c.gesture(), null);
  assert.equal(s.c.template().wires.length, 2, 'a drop on empty canvas commits nothing');
  assert.equal(s.c.view.ghostEl.getAttribute('class'), 'wire ghost');
});
```

Append three more tests to the same file:

```js
test('a drag from an INPUT port mirrors the tangent, snaps to a legal anchor and commits', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  down(s, 400, 160);                                     // n_agent.fix (input)
  move(s, 280, 160); s.flush();
  const d = s.c.view.ghostEl.getAttribute('d');
  const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  assert.equal(d, 'M 400 160 C 346 160, 334 160, 280 160');
  assert.ok(n[2] < n[0], 'first control x is LEFT of the anchor (mirrored)');
  move(s, 280, 199); s.flush();                          // onto n_task.task (output)
  assert.equal(s.c.view.ghostEl.getAttribute('class'), 'wire ghost on legal');
  assert.match(s.c.view.ghostEl.getAttribute('d'), /280 199$/, 'ghost end snapped to the anchor');
  assert.ok(s.c.view.nodeEl('n_task').querySelector('.prow[data-port="task"]').classList.contains('drop-ok'));
  up(s, 280, 199); s.flush();
  assert.equal(s.c.template().wires.length, 3);
  const w = s.c.template().wires[2];
  assert.deepEqual(w.from, { node: 'n_task', port: 'task' }, 'normalised output → input on commit');
  assert.deepEqual(w.to, { node: 'n_agent', port: 'fix' });
  assert.equal(s.c.isDirty(), true);
  assert.equal(s.c.view.wiresEl.lastElementChild.getAttribute('class'), 'wire ghost', 'ghost is still last');
});

test('illegal drops show the reason chip at world→screen + 14 and commit nothing', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  down(s, 620, 193);                                     // n_agent.plan (already wired to n_end.result)
  move(s, 760, 199); s.flush();                          // over n_end.result
  assert.equal(s.c.view.ghostEl.getAttribute('class'), 'wire ghost on illegal');
  assert.equal(s.el.chip.textContent, 'already connected');
  assert.equal(s.el.chip.hidden, false);
  assert.equal(s.el.chip.style.left, `${760 + 14}px`);
  assert.equal(s.el.chip.style.top, `${199 + 14}px`);
  assert.ok(s.c.view.nodeEl('n_end').querySelector('.prow[data-port="result"]').classList.contains('drop-bad'));
  move(s, 400, 136); s.flush();                          // over n_agent.task — same node
  assert.equal(s.el.chip.textContent, 'same node');
  up(s, 400, 136); s.flush();
  assert.equal(s.c.template().wires.length, 2);
  assert.equal(s.el.chip.hidden, true);
  assert.equal(s.c.isDirty(), false);
});

test('destroy() unbinds everything; pointercancel and window blur end a gesture', async () => {
  const s = await open();
  down(s, 400, 80); move(s, 500, 120); s.flush();
  assert.equal(s.c.gesture().type, 'node');
  s.win.dispatchEvent(new s.win.Event('blur'));
  assert.equal(s.c.gesture(), null, 'blur cancels');
  assert.equal(s.c.template().nodes[1].x, 400, 'the moved node reverted');
  down(s, 400, 80);
  s.c.view.stage.dispatchEvent(new s.win.PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
  assert.equal(s.c.gesture(), null, 'pointercancel cancels');
  const before = JSON.stringify(s.c.template());
  s.c.destroy();
  down(s, 400, 80); move(s, 900, 400); s.flush();
  s.doc.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  assert.equal(s.c.gesture(), null, 'no listener survived destroy()');
  assert.equal(JSON.stringify(s.c.template()), before, 'nothing mutated after destroy()');
});
```

`Expected: FAIL — Error: Cannot find module '.../ui/public/graph/composer.mjs'` (all four tests).

- [ ] Step 2: Implement `ui/public/graph/composer.mjs` (part 1 — state, hit tests, the pipeline):

```js
// ui/public/graph/composer.mjs
// The v2 composer editor. It owns the POINTER PIPELINE and nothing else about
// rendering: view.mjs paints, this file classifies and mutates.
//
// The four PR #359 defects are structurally excluded here:
//  · listeners live on the STAGE with pointer capture, never on `document`
//  · onMove stores a point and schedules ONE rAF — no DOM, no hit-test, no validate
//  · a node drag repaints only view.incidentOf(id), through the view's d-cache
//  · pointercancel / lostpointercapture / window blur / Escape all cancel, and
//    finish() releases capture
// Depth 3 ⇒ the shared core is three `..` up.
import { createGraphView } from './view.mjs';
import { WIRE_HIT_TOL, PORT_HIT_R, SNAP, ZOOM_MIN, ZOOM_MAX, ZOOM_K, NODE_W, snap, bezierPath }
  from '../../../src/shared/graph/geometry.mjs';
import { canWire, newNode, newWire, normalizeTemplate, serializeTemplate }
  from '../../../src/shared/graph/template.mjs';
import { validateGraph } from '../../../src/shared/graph/validate.mjs';
import { autoLayout } from '../../../src/shared/graph/layout.mjs';

export const UNDO_LIMIT = 50;
export const INSPECTOR_KEY = 'worca.composer.inspector';
export const EMPTY_STATE_COPY = 'Wire agents from the Task node to the End node — outputs → inputs.';
/** px of canvas hidden under the floating inspector rail (§7.6 constants). */
export const INSET_OPEN = 280;
export const INSET_COLLAPSED = 28;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isTyping = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export function createComposer(hostEls, { doc = globalThis.document, api, raf = null, viewport = null, storage = null, portsFn } = {}) {
  const win = doc.defaultView || globalThis;
  const schedule = raf || ((fn) => win.requestAnimationFrame(fn));
  const stats = { rectReads: 0, frames: 0, pointerMoves: 0, validations: 0 };

  let tpl = emptyCanvas();
  let sel = null;                 // {kind:'node'|'wire', id}
  let dirty = false;
  let savedHash = '';
  let gesture = null;
  let pend = null;
  let rafId = 0;
  let space = false;
  let validateTimer = null;
  let lastReport = { ok: true, errors: [], warnings: [] };
  const undoStack = [];
  const redoStack = [];
  let agents = {};                // key -> meta (palette + header tint)

  const view = createGraphView(hostEls.canvas, {
    doc, mode: 'edit', portsFn, agents, viewport,
    zoomMin: ZOOM_MIN, zoomMax: ZOOM_MAX, wheelPan: 'always',
  });
  const stage = view.stage;

  function emptyCanvas() {
    // A fresh canvas preloads the two bookends V20/V21 require.
    return normalizeTemplate({
      id: '', name: '', version: 2, domain: '',
      nodes: [newNode('task', null, 60, 200), newNode('end', null, 960, 200)],
      wires: [],
    });
  }

  const nodeById = (id) => tpl.nodes.find((n) => n.id === id) || null;
  const wireById = (id) => tpl.wires.find((w) => w.id === id) || null;

  // -------------------------------------------------------------- rect cache
  let R = { left: 0, top: 0, width: 0, height: 0 };
  function readRect() {
    R = viewport ? { ...viewport() } : (() => {
      const b = stage.getBoundingClientRect();
      return { left: b.left, top: b.top, width: b.width, height: b.height };
    })();
    stats.rectReads += 1;
    return R;
  }
  const T = () => view.getTransform();
  const toWorld = (cx, cy) => { const t = T(); return { x: (cx - R.left - t.x) / t.z, y: (cy - R.top - t.y) / t.z }; };
  const toScreen = (wx, wy) => { const t = T(); return { x: wx * t.z + t.x, y: wy * t.z + t.y }; };

  // ------------------------------------------------------------- hit testing
  // Model-driven, in world coordinates. Never elementFromPoint, never a rect
  // read, never a per-path listener.
  function allPortsOf(node) {
    const p = view.ports(node);
    const out = [];
    for (const q of p.inputs) out.push({ node, port: q.id, dir: 'in', type: q.type, synthetic: Boolean(q.synthetic) });
    for (const q of p.outputs) out.push({ node, port: q.id, dir: 'out', type: q.type });
    return out;
  }
  function hitPortAt(pt, exclude) {
    let best = null;
    let bd = PORT_HIT_R;
    for (const node of tpl.nodes) {
      for (const q of allPortsOf(node)) {
        if (exclude && exclude.node.id === node.id && exclude.port === q.port && exclude.dir === q.dir) continue;
        const a = view.anchor(node, q.port, q.dir);
        const d = Math.hypot(pt.x - a.x, pt.y - a.y);
        if (d <= bd) { bd = d; best = { ...q, anchor: a }; }
      }
    }
    return best;
  }
  function hitNodeAt(pt) {
    for (let i = tpl.nodes.length - 1; i >= 0; i -= 1) {
      const n = tpl.nodes[i];
      const s = view.size(n);
      if (pt.x >= n.x && pt.x <= n.x + s.w && pt.y >= n.y && pt.y <= n.y + s.h) return n;
    }
    return null;
  }
  /** Sample the wire's OWN cached `d` (the single bezier definition) 48×. */
  function hitWireAt(pt) {
    for (const w of tpl.wires) {
      const el = view.wireEl(w.id);
      const nums = (el && el.getAttribute('d') || '').match(/-?\d+(?:\.\d+)?/g);
      if (!nums || nums.length < 8) continue;
      const [ax, ay, c1x, c1y, c2x, c2y, bx, by] = nums.map(Number);
      for (let i = 0; i <= 48; i += 1) {
        const t = i / 48;
        const u = 1 - t;
        const x = u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * bx;
        const y = u * u * u * ay + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * by;
        if (Math.hypot(pt.x - x, pt.y - y) <= WIRE_HIT_TOL) return w;
      }
    }
    return null;
  }
```

- [ ] Step 3: Implement part 2 — commit/validate/render and the pipeline (same file):

```js
  // ------------------------------------------------------------ mutate/render
  const snapshot = () => JSON.stringify({ nodes: tpl.nodes, wires: tpl.wires });
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }
  /** The ONE mutation gate: undo → mutate → dirty → targeted render → one
   *  deferred validate. Nothing on the pointer path may call render/validate. */
  let metaDirty = false;              // name/domain edits: not part of the structural hash
  function commit(label, mutate) {
    pushUndo();
    mutate();
    dirty = metaDirty || snapshot() !== savedHash;
    render();
    scheduleValidate();
  }
  function scheduleValidate() {
    if (validateTimer) return;                            // collapsed to one run
    validateTimer = setTimeout(() => {
      validateTimer = null;
      lastReport = validateGraph(tpl, portsFn);
      stats.validations += 1;
      view.render(tpl, { selection: sel, report: lastReport });
      paintChrome();
    }, 0);
  }
  function render() {
    view.render(tpl, { selection: sel, report: lastReport });
    paintChrome();
    if (hooks.onRender) hooks.onRender();
  }
  function paintChrome() {
    const n = lastReport.errors.length;
    if (hostEls.dirty) hostEls.dirty.hidden = !dirty;
    if (hostEls.saveBtn) hostEls.saveBtn.disabled = n > 0 || !ready;
    if (hostEls.errors) {
      hostEls.errors.hidden = n === 0;
      hostEls.errors.textContent = n ? `${n} error${n === 1 ? '' : 's'}` : '';
    }
    if (empty) empty.hidden = tpl.wires.length > 0;
  }

  // ------------------------------------------------------------------- ghost
  function showChip(text, pt) {
    if (!hostEls.chip) return;
    const s = toScreen(pt.x, pt.y);            // world→screen math, never a rect read
    hostEls.chip.textContent = text;
    hostEls.chip.style.left = `${s.x + 14}px`;
    hostEls.chip.style.top = `${s.y + 14}px`;
    hostEls.chip.hidden = false;
  }
  const hideChip = () => { if (hostEls.chip) hostEls.chip.hidden = true; };
  function markDropRow(target, ok) {
    clearDropRows();
    if (!target) return;
    const card = view.nodeEl(target.node.id);
    const row = card && card.querySelector(`.prow[data-port="${target.port}"][data-dir="${target.dir}"]`);
    if (row) row.classList.add(ok ? 'drop-ok' : 'drop-bad');
  }
  function clearDropRows() {
    for (const row of view.world.querySelectorAll('.prow.drop-ok, .prow.drop-bad')) row.classList.remove('drop-ok', 'drop-bad');
  }
  /** Wire legality for the LIVE drag: a Map lookup + a type check. Never
   *  classifyLoops, never validateGraph. Reasons come from canWire verbatim. */
  function legality(origin, target) {
    if (!target || origin.dir === target.dir) return null;
    const out = origin.dir === 'out' ? origin : target;
    const inp = origin.dir === 'in' ? origin : target;
    const v = canWire({
      tpl, portsFn,
      from: { node: out.node.id, port: out.port },
      to: { node: inp.node.id, port: inp.port },
    });
    return { ...v, from: { node: out.node.id, port: out.port }, to: { node: inp.node.id, port: inp.port } };
  }

  // ---------------------------------------------------------------- pipeline
  function onDown(ev) {
    if (gesture || (ev.button !== 0 && ev.button !== 1)) return;
    readRect();                                           // the ONE rect read of this gesture
    const pt = toWorld(ev.clientX, ev.clientY);
    let g = null;
    if (ev.button === 1 || space) g = { type: 'pan' };
    else {
      const port = hitPortAt(pt);
      const node = port ? null : hitNodeAt(pt);
      if (port) {
        g = { type: 'wire', origin: port, anchor: port.anchor, mirror: port.dir === 'in' };
        view.setGhost(bezierPath(g.anchor, pt, { mirror: g.mirror }), '');
      } else if (node) {
        g = { type: 'node', id: node.id, grab: { dx: pt.x - node.x, dy: pt.y - node.y }, start: { x: node.x, y: node.y }, moved: false };
        select({ kind: 'node', id: node.id });
        view.nodeEl(node.id).classList.add('dragging');
      } else {
        const wire = hitWireAt(pt);
        if (wire) { select({ kind: 'wire', id: wire.id }); g = { type: 'idle' }; }
        else { select(null); g = { type: 'pan' }; }
      }
    }
    if (g.type === 'pan') { const t = T(); Object.assign(g, { sx: ev.clientX, sy: ev.clientY, ox: t.x, oy: t.y }); stage.classList.add('panning'); }
    g.pointerId = ev.pointerId;
    gesture = g;
    // Chrome throws NotFoundError for a SYNTHETIC pointerId it does not own and
    // jsdom has no such method: capture is a bonus, never a precondition.
    try { stage.setPointerCapture?.(ev.pointerId); } catch { /* synthetic pointer */ }
    ev.preventDefault();
  }

  function onMove(ev) {
    if (!gesture) return;
    stats.pointerMoves += 1;
    pend = { x: ev.clientX, y: ev.clientY };
    if (!rafId) rafId = schedule(frame);
  }

  function frame() {
    rafId = 0;
    const g = gesture;
    const p = pend;
    if (!g || !p) return;
    stats.frames += 1;
    if (g.type === 'pan') {
      view.setTransform({ x: g.ox + (p.x - g.sx), y: g.oy + (p.y - g.sy), z: T().z });
      return;
    }
    if (g.type === 'idle') return;
    const pt = toWorld(p.x, p.y);
    if (g.type === 'node') {
      const n = nodeById(g.id);
      const nx = snap(pt.x - g.grab.dx);
      const ny = snap(pt.y - g.grab.dy);
      if (!n || (nx === n.x && ny === n.y)) return;
      n.x = nx; n.y = ny; g.moved = true;
      view.moveNode(n.id);                                // incident wires ONLY
      return;
    }
    const target = hitPortAt(pt, g.origin);
    const v = legality(g.origin, target);
    const end = v && v.ok ? target.anchor : pt;           // snap to the legal anchor
    view.setGhost(bezierPath(g.anchor, end, { mirror: g.mirror }), v ? (v.ok ? 'legal' : 'illegal') : '');
    markDropRow(target, Boolean(v && v.ok));
    if (v && !v.ok) showChip(v.reason || v.code, pt); else hideChip();
  }

  function finish(g) {
    gesture = null; pend = null;
    if (rafId) { rafId = 0; }
    view.setGhost(null); hideChip(); clearDropRows();
    stage.classList.remove('panning');
    if (g && g.type === 'node') view.nodeEl(g.id)?.classList.remove('dragging');
    try { if (stage.hasPointerCapture?.(g && g.pointerId)) stage.releasePointerCapture(g.pointerId); } catch { /* already gone */ }
  }

  function onUp(ev) {
    const g = gesture;
    if (!g || ev.pointerId !== g.pointerId) return;
    pend = { x: ev.clientX, y: ev.clientY };
    rafId = 0;
    frame();                                              // settle the last position
    if (g.type === 'wire') {
      const pt = toWorld(ev.clientX, ev.clientY);
      const v = legality(g.origin, hitPortAt(pt, g.origin));
      finish(g);
      if (v && v.ok) commit('wire', () => { tpl.wires.push(newWire(v.from, v.to)); });
      return;
    }
    if (g.type === 'node' && g.moved) {
      const n = nodeById(g.id);
      const to = { x: n.x, y: n.y };
      n.x = g.start.x; n.y = g.start.y;                    // rewind so ONE undo entry covers the drag
      finish(g);
      commit('move', () => { n.x = to.x; n.y = to.y; });
      return;
    }
    finish(g);
  }

  function cancel() {
    const g = gesture;
    if (!g) return;
    if (g.type === 'node' && g.moved) {
      const n = nodeById(g.id);
      if (n) { n.x = g.start.x; n.y = g.start.y; view.moveNode(n.id); }
    }
    finish(g);
  }
```

- [ ] Step 4: Implement part 3 — selection, mount/destroy, template loading, the returned object (same file):

```js
  let empty = null;
  let ready = true;                 // false while /api/agents is in flight (app.js sets it)
  const hooks = {};                 // onRender, set by app.js

  function select(next) {
    sel = next;
    view.setSelection(sel);
    if (hooks.onSelect) hooks.onSelect(sel);
  }

  const onCancelEv = () => cancel();
  const onLost = () => { if (gesture) cancel(); };
  const onBlur = () => { space = false; stage.classList.remove('space'); cancel(); };
  const onRefresh = () => readRect();

  function mount() {
    empty = doc.createElement('div');
    empty.className = 'gv-empty';
    empty.textContent = EMPTY_STATE_COPY;
    hostEls.canvas.appendChild(empty);
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onCancelEv);
    stage.addEventListener('lostpointercapture', onLost);
    win.addEventListener('blur', onBlur);
    win.addEventListener('resize', onRefresh);
    doc.addEventListener('scroll', onRefresh, { capture: true, passive: true });
    if (typeof win.ResizeObserver === 'function') {
      ro = new win.ResizeObserver(onRefresh);
      ro.observe(stage);
    }
    readRect();
    return composer;
  }
  let ro = null;

  function destroy() {
    cancel();
    stage.removeEventListener('pointerdown', onDown);
    stage.removeEventListener('pointermove', onMove);
    stage.removeEventListener('pointerup', onUp);
    stage.removeEventListener('pointercancel', onCancelEv);
    stage.removeEventListener('lostpointercapture', onLost);
    win.removeEventListener('blur', onBlur);
    win.removeEventListener('resize', onRefresh);
    doc.removeEventListener('scroll', onRefresh, { capture: true });
    if (ro) { ro.disconnect(); ro = null; }
    if (validateTimer) { clearTimeout(validateTimer); validateTimer = null; }
    if (empty) { empty.remove(); empty = null; }
  }

  /** Load a saved template (or `null` for a fresh canvas). Resets undo + dirty. */
  function loadTemplate(next) {
    tpl = next ? normalizeTemplate(next) : emptyCanvas();
    sel = null;
    undoStack.length = 0; redoStack.length = 0;
    savedHash = snapshot();
    metaDirty = false;
    dirty = false;
    lastReport = validateGraph(tpl, portsFn);
    if (hostEls.name) hostEls.name.value = tpl.name || '';
    render();
    return tpl;
  }

  const composer = {
    view, stats, hooks,
    mount, destroy, commit, loadTemplate,
    newCanvas: () => loadTemplate(null),
    template: () => tpl,
    serialize: () => serializeTemplate(tpl),
    report: () => lastReport,
    selection: () => (sel ? { ...sel } : null),
    select,
    gesture: () => gesture,
    isDirty: () => dirty,
    setReady(v) { ready = v; paintChrome(); },
    setAgents(map) { agents = map || {}; view.setAgents(agents); },
    /** Rename: an unsaved edit, so it sets `dirty` — it never clears it. */
    setName(name) { tpl.name = String(name || ''); metaDirty = true; dirty = true; paintChrome(); },
    markSaved(id, name, domain) {
      if (id) tpl.id = id;
      if (name != null) tpl.name = name;
      if (domain != null) tpl.domain = domain;
      savedHash = snapshot();
      metaDirty = false;
      dirty = false;
      paintChrome();
    },
    _internal: { readRect, toWorld, toScreen, hitPortAt, hitNodeAt, hitWireAt, nodeById, wireById, pushUndo, undoStack, redoStack, scheduleValidate, setSpace(v) { space = v; }, isSpace: () => space, getR: () => ({ ...R }) },
  };
  return composer;
}
```

- [ ] Step 5: `node --test test/ui-composer-editor.test.mjs` → `Expected: # pass 4 / # fail 0`.
- [ ] Step 6: **Mutation check** (do not commit it): temporarily move the `view.setGhost(...)` call out of `frame()` into `onMove` and confirm the coalescing test FAILS with `ghostUpdates − g0 === 60`; revert.
- [ ] Step 7: Commit — `worca: Node-graph v2 P5 — composer pointer pipeline (rAF-coalesced, capture-owned)`.

---

### Task 11: wheel, zoom, pan, fit, keyboard

**Files:** modify `ui/public/graph/composer.mjs`, `test/ui-composer-editor.test.mjs`.
**Interfaces:** produces `composer.fit()`, `composer.autoLayout()`, `composer.zoomAbout(z, sx, sy)` and the `wheel`/`keydown`/`keyup` handlers bound by `mount()`. Transform math: `screen = world·z + t`; zoom about stage point `s`: `t' = s − (s − t)·z'/z`. `deltaMode` 1 ⇒ ×16, 2 ⇒ ×`rect.height`. Plain/two-finger wheel ⇒ pan `t −= (dX, dY)`; `ctrlKey || metaKey` ⇒ `z' = clamp(z·exp(−dY·0.002), 0.4, 1.6)` about the cursor, never rounded. Keys (ignored while `isTyping`): Delete/Backspace, arrows nudge 11px, ⌘/Ctrl+Z, ⇧⌘Z, Escape, Space (pan modifier, `preventDefault`). **No control ever lands on the canvas.**

- [ ] Step 1: Write the failing tests — append to `test/ui-composer-editor.test.mjs`:

```js
const wheel = (s, o) => s.c.view.stage.dispatchEvent(new s.win.WheelEvent('wheel', { bubbles: true, cancelable: true, ...o }));
const key = (s, k, o = {}) => s.doc.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));

test('ctrl+wheel zooms about the cursor (world point invariant) and clamps 0.4..1.6', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  const before = s.c._internal.toWorld(600, 300);
  wheel(s, { deltaY: -120, ctrlKey: true, clientX: 600, clientY: 300 });
  const after = s.c._internal.toWorld(600, 300);
  assert.ok(Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6);
  assert.ok(Math.abs(s.c.view.getTransform().z - Math.exp(0.24)) < 1e-9);
  for (let i = 0; i < 12; i += 1) wheel(s, { deltaY: -240, ctrlKey: true, clientX: 600, clientY: 300 });
  assert.ok(s.c.view.getTransform().z <= 1.6 + 1e-12);
  for (let i = 0; i < 30; i += 1) wheel(s, { deltaY: 240, ctrlKey: true, clientX: 600, clientY: 300 });
  assert.ok(s.c.view.getTransform().z >= 0.4 - 1e-12);
});

test('plain wheel pans by exactly −delta; deltaMode 1 scales by 16', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  wheel(s, { deltaX: 40, deltaY: -25 });
  assert.deepEqual(s.c.view.getTransform(), { x: -40, y: 25, z: 1 });
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  wheel(s, { deltaX: 1, deltaY: 0, deltaMode: 1 });
  assert.equal(s.c.view.getTransform().x, -16);
});

test('keyboard: nudge, delete, undo/redo, Escape — all skipped while typing', async () => {
  const s = await open();
  s.c.select({ kind: 'node', id: 'n_agent' });
  key(s, 'ArrowRight');
  assert.equal(s.c.template().nodes[1].x, 411, 'nudged by SNAP');
  key(s, 'z', { metaKey: true });
  assert.equal(s.c.template().nodes[1].x, 400, 'undo');
  key(s, 'z', { metaKey: true, shiftKey: true });
  assert.equal(s.c.template().nodes[1].x, 411, 'redo');
  s.el.name.focus();
  s.el.name.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  assert.equal(s.c.template().nodes.length, 3, 'typing in the name field never deletes a node');
  s.c.select({ kind: 'node', id: 'n_agent' });
  key(s, 'Backspace');
  assert.equal(s.c.template().nodes.length, 2, 'node deleted');
  assert.equal(s.c.template().wires.length, 0, 'its wires went with it');
  assert.equal(s.c.selection(), null);
});

test('fit centres the model in the band left of the inspector and never magnifies', async () => {
  const s = await open();
  s.c.fit();                                   // rail open ⇒ insetRight 280 ⇒ vw 1000
  const T = s.c.view.getTransform();
  assert.ok(Math.abs(T.z - 1000 / 1040) < 1e-12, 'z = vw / bounds.w');
  assert.ok(Math.abs(T.x - 0) < 1e-9, 'exactly centred: (1000 − 1040·z)/2 − 0·z = 0');
  s.c.fit({ insetRight: 28 });                 // rail collapsed ⇒ vw 1252
  assert.equal(s.c.view.getTransform().z, 1, 'fit never magnifies past 1x');
});
```

`Expected: FAIL — TypeError: s.c.fit is not a function` (and the wheel/key tests leave the transform at `{x:0,y:0,z:1}`).

- [ ] Step 2: Implement — add to `composer.mjs` (before `mount`), and bind/unbind the three listeners in `mount`/`destroy`:

```js
  function zoomAbout(zNext, sx, sy) {
    const t = T();
    const z2 = clamp(zNext, ZOOM_MIN, ZOOM_MAX);
    view.setTransform({ x: sx - ((sx - t.x) / t.z) * z2, y: sy - ((sy - t.y) / t.z) * z2, z: z2 });
  }

  function onWheel(ev) {
    ev.preventDefault();                          // the page never scrolls under the canvas
    const m = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? (R.height || 560) : 1;
    const dX = ev.deltaX * m;
    const dY = ev.deltaY * m;
    if (ev.ctrlKey || ev.metaKey) {               // trackpad pinch sets ctrlKey
      zoomAbout(T().z * Math.exp(-dY * ZOOM_K), ev.clientX - R.left, ev.clientY - R.top);
      return;
    }
    const t = T();
    view.setTransform({ x: t.x - dX, y: t.y - dY, z: t.z });
  }

  /** px of canvas hidden under the floating rail — the fit band's right inset. */
  function insetRight() {
    return hostEls.insRail && hostEls.insRail.dataset.open === 'collapsed' ? INSET_COLLAPSED : INSET_OPEN;
  }
  function fit(opts = {}) {
    view.fit({ insetRight: opts.insetRight == null ? insetRight() : opts.insetRight, pad: 60 });
  }
  function runAutoLayout() {
    commit('auto-layout', () => { const next = autoLayout(tpl, portsFn); tpl.nodes = next.nodes; });
  }
  function deleteSelection() {
    if (!sel) return;
    if (sel.kind === 'wire') { const id = sel.id; commit('delete wire', () => { tpl.wires = tpl.wires.filter((w) => w.id !== id); }); }
    else { const id = sel.id; commit('delete node', () => {
      tpl.nodes = tpl.nodes.filter((n) => n.id !== id);
      tpl.wires = tpl.wires.filter((w) => w.from.node !== id && w.to.node !== id);
    }); }
    select(null);
  }
  function nudge(dx, dy) {
    if (!sel || sel.kind !== 'node') return;
    const n = nodeById(sel.id);
    if (!n) return;
    commit('nudge', () => { n.x = snap(n.x + dx); n.y = snap(n.y + dy); });
  }
  function restore(json) {
    const st = JSON.parse(json);
    tpl.nodes = st.nodes; tpl.wires = st.wires;
    if (sel && ((sel.kind === 'node' && !nodeById(sel.id)) || (sel.kind === 'wire' && !wireById(sel.id)))) sel = null;
    dirty = metaDirty || snapshot() !== savedHash;
    render();
    scheduleValidate();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }

  function onKeyDown(ev) {
    if (isTyping(ev.target)) return;              // guard FIRST — before space, before anything
    if (ev.key === ' ') { if (!space) { space = true; stage.classList.add('space'); } ev.preventDefault(); return; }
    if (ev.key === 'Escape') { if (gesture) cancel(); else select(null); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSelection(); return; }
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); nudge(-SNAP, 0); return; }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); nudge(SNAP, 0); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); nudge(0, -SNAP); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); nudge(0, SNAP); return; }
    if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'z' || ev.key === 'Z')) { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); }
  }
  function onKeyUp(ev) { if (ev.key === ' ') { space = false; stage.classList.remove('space'); } }
```

In `mount()` add `stage.addEventListener('wheel', onWheel, { passive: false }); doc.addEventListener('keydown', onKeyDown); doc.addEventListener('keyup', onKeyUp);` and the matching `removeEventListener` calls in `destroy()`. Wire the header buttons in `mount()` too: `hostEls.autoBtn?.addEventListener('click', runAutoLayout)` and `hostEls.newBtn?.addEventListener('click', () => composer.newCanvas())` (both removed in `destroy()`). Add `fit, autoLayout: runAutoLayout, zoomAbout, undo, redo, undoDepth: () => undoStack.length, deleteSelection` to the returned object.

- [ ] Step 3: `node --test test/ui-composer-editor.test.mjs` → `Expected: # pass 8 / # fail 0`.
- [ ] Step 4: **Mutation check**: move the `isTyping` guard below the Space branch and confirm the "skipped while typing" assertion fails; revert.
- [ ] Step 5: Commit — `worca: Node-graph v2 P5 — wheel, zoom about cursor, pan, fit and keyboard`.

---

### Task 12: undo ring, dirty hash, validation report, Save gating

**Files:** modify `ui/public/graph/composer.mjs`, `test/ui-composer-editor.test.mjs`.
**Interfaces:** undo ring = structural snapshots `{nodes, wires}` (JSON), cap **50**, redo cleared on push, a whole drag = **one** entry; `dirty = hash(snapshot) !== savedHash`. Validation once per commit: `errors.length > 0` ⇒ Save disabled + an `N errors` chip in the header bar + red `.npip`s + `bad` wires; clicking the chip or a pip calls `view.centerOn(nodeId)`.

- [ ] Step 1: Write the failing tests — append to `test/ui-composer-editor.test.mjs`:

```js
test('a whole drag is ONE undo entry and the ring caps at 50', async () => {
  const s = await open();
  assert.equal(s.c.undoDepth(), 0);
  down(s, 400, 80);
  for (let i = 0; i < 20; i += 1) { move(s, 400 + i * 5, 80 + i * 3); s.flush(); }
  up(s, 500, 140); s.flush();
  assert.equal(s.c.undoDepth(), 1, '20 frames ⇒ one undo entry');
  const moved = { ...s.c.template().nodes[1] };
  s.c.undo();
  assert.equal(s.c.template().nodes[1].x, 400);
  s.c.redo();
  assert.equal(s.c.template().nodes[1].x, moved.x);
  for (let i = 0; i < 60; i += 1) s.c.commit('n', () => { s.c.template().nodes[1].x += 11; });
  assert.equal(s.c.undoDepth(), 50, 'ring capped at UNDO_LIMIT');
});

test('errors disable Save, show the chip, pip the node, and centre it on click', async () => {
  const s = await open({ template: { id: '', name: '', version: 2, domain: '', nodes: [], wires: [] } });
  await new Promise((r) => setTimeout(r, 0));            // let scheduleValidate run
  assert.ok(s.el.save.disabled, 'Save disabled while the graph has errors');
  assert.equal(s.el.errors.hidden, false);
  assert.match(s.el.errors.textContent, /^\d+ errors?$/);
  const s2 = await open();
  s2.c.commit('rm-end', () => { s2.c.template().nodes = s2.c.template().nodes.filter((n) => n.kind !== 'end'); s2.c.template().wires = []; });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s2.el.save.disabled, true, 'V21: exactly one End node');
  s2.c.view.setTransform({ x: 0, y: 0, z: 1 });
  const pip = s2.c.view.world.querySelector('.npip');
  if (pip) { pip.dispatchEvent(new s2.win.MouseEvent('click', { bubbles: true })); assert.notDeepEqual(s2.c.view.getTransform(), { x: 0, y: 0, z: 1 }, 'pip click centres the offender'); }
  s2.c.commit('fix', () => { s2.c.template().nodes.push({ id: 'n_end2', kind: 'end', x: 900, y: 200, config: {} }); s2.c.template().wires.push({ id: 'w9', from: { node: 'n_agent', port: 'plan' }, to: { node: 'n_end2', port: 'result' } }); });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s2.el.errors.hidden, true);
  assert.equal(s2.el.save.disabled, false);
});

test('validation runs ONCE per commit, never per frame', async () => {
  const s = await open();
  await new Promise((r) => setTimeout(r, 0));
  const v0 = s.c.stats.validations;
  down(s, 400, 80);
  for (let i = 0; i < 30; i += 1) { move(s, 400 + i, 80 + i); s.flush(); }
  assert.equal(s.c.stats.validations, v0, 'zero validations during the drag');
  up(s, 430, 110); s.flush();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.c.stats.validations, v0 + 1, 'exactly one after the commit');
});
```

`Expected: FAIL — TypeError: s.c.undoDepth is not a function` for the first test; the second fails on `s.el.errors.hidden` (still `false`/unset) once `undoDepth` lands.

- [ ] Step 2: Implement — `undo`/`redo`/`undoDepth` already landed in Task 11. Add the chip/pip navigation in `mount()` (and unbind in `destroy()`):

```js
  function firstErrorNode() {
    const e = (lastReport.errors || []).find((x) => x.nodeId);
    return e ? e.nodeId : null;
  }
  const onErrChip = () => { const id = firstErrorNode(); if (id) { select({ kind: 'node', id }); view.centerOn(id); } };
  const onWorldClick = (ev) => {
    const pip = ev.target.closest && ev.target.closest('.npip');
    if (!pip) return;
    ev.stopPropagation();
    const id = pip.dataset.nodeId;
    if (id) { select({ kind: 'node', id }); view.centerOn(id); }
  };
```
bound as `hostEls.errors?.addEventListener('click', onErrChip)` and `view.world.addEventListener('click', onWorldClick)`.

- [ ] Step 3: `node --test test/ui-composer-editor.test.mjs` → `Expected: # pass 11 / # fail 0`.
- [ ] Step 4: Commit — `worca: Node-graph v2 P5 — undo ring, dirty flag, validation report and Save gating`.

---

### Task 13: `palette.mjs` — pills, domain chips, filter, click spawn, drag-to-spawn

**Files:** create `ui/public/graph/palette.mjs`; modify `ui/public/graph/composer.mjs`; modify `test/ui-composer-editor.test.mjs`.
**Interfaces:** produces `renderPalette(host, {agents, placedKinds, collapsed, doc}) → void`, `paletteEntries(agents) → grouped[]`, `portLineOf(entry) → string`, `FLOW_PILLS`, `FLOW_GROUP`, `FLOW_PORT_LINE`, and `createPaletteController(host, {doc, onSpawn, onDragSpawn, stageRectFn, insetRightFn}) → {destroy, filter(q), toggleDomain(d)}`. `placeable: false` agents (workspaceScanner) are never listed. Pill line 2 = META port ids only (`in plan · out plan, revise`, 10.5px mono) — the synthesized `await` gate is never listed. Task/End pills disable once placed (V20/V21).

- [ ] Step 1: Write the failing tests — append to `test/ui-composer-editor.test.mjs`:

```js
test('palette groups by domain, pins Flow last, hides placeable:false, disables placed bookends', async () => {
  const agents = [
    { key: 'planner', displayName: 'Plan', domain: 'coding', color: 'violet', order: 1, inputs: [{ id: 'plan', type: 'md' }], outputs: [{ id: 'plan', type: 'md' }, { id: 'revise', type: 'md' }] },
    { key: 'wsScan', displayName: 'Workspace Scan', domain: 'shared', order: 0.5, placeable: false, inputs: [], outputs: [] },
    { key: 'docs', displayName: 'Docs', domain: 'writing', order: 2, inputs: [], outputs: [{ id: 'doc', type: 'md' }] },
  ];
  const s = await open({ api: { agents: async () => agents, agentsAll: async () => agents } });
  const { renderPalette } = await import(new URL('../ui/public/graph/palette.mjs', import.meta.url).href);
  renderPalette(s.el.palette, { agents, placedKinds: ['task', 'end'], collapsed: new Set(), doc: s.doc });
  const groups = [...s.el.palette.querySelectorAll('.pal-group')].map((g) => g.dataset.domain);
  assert.deepEqual(groups, ['coding', 'writing', 'flow'], 'domains first-seen (empty groups omitted), pinned Flow last');
  assert.equal(s.el.palette.querySelector('.ap[data-key="wsScan"]'), null, 'placeable:false never listed');
  assert.equal(s.el.palette.querySelector('.ap[data-key="planner"] .p').textContent, 'in plan · out plan, revise');
  assert.equal(s.el.palette.querySelector('.ap[data-kind="task"]').disabled, true);
  assert.equal(s.el.palette.querySelector('.ap[data-kind="and"]').disabled, false);
  assert.equal(s.el.palette.querySelector('.ap[data-kind="and"] .p').textContent, 'in in1..inN · out out');
});

test('click spawns at the canvas centre with the 24-try de-stacker', async () => {
  const s = await open();
  s.c.view.setTransform({ x: 0, y: 0, z: 1 });
  const n0 = s.c.template().nodes.length;
  s.c.spawn({ kind: 'and' });
  s.c.spawn({ kind: 'and' });
  const nodes = s.c.template().nodes;
  assert.equal(nodes.length, n0 + 2);
  assert.equal(nodes[n0].kind, 'and');
  assert.equal(nodes[n0].config.arity, 2);
  assert.notDeepEqual({ x: nodes[n0].x, y: nodes[n0].y }, { x: nodes[n0 + 1].x, y: nodes[n0 + 1].y }, 'second spawn de-stacked');
  assert.equal(nodes[n0].x % 11, 0, 'snapped to the 11px grid');
  assert.equal(s.c.undoDepth(), 2, 'each spawn is one undo entry');
});

test('drag-to-spawn: ghost after 4px, drop inside the stage commits, outside cancels', async () => {
  const s = await open();
  const agents = [{ key: 'planner', displayName: 'Plan', domain: 'coding', order: 1, inputs: [], outputs: [] }];
  const { renderPalette } = await import(new URL('../ui/public/graph/palette.mjs', import.meta.url).href);
  renderPalette(s.el.palette, { agents, placedKinds: [], collapsed: new Set(), doc: s.doc });
  const pill = s.el.palette.querySelector('.ap[data-key="planner"]');
  const n0 = s.c.template().nodes.length;
  pill.dispatchEvent(new s.win.PointerEvent('pointerdown', { pointerId: 3, button: 0, clientX: 100, clientY: 700, bubbles: true }));
  s.doc.dispatchEvent(new s.win.PointerEvent('pointermove', { pointerId: 3, clientX: 102, clientY: 700, bubbles: true }));
  assert.equal(s.doc.querySelector('.gv-drag-ghost'), null, '2px is still a click');
  s.doc.dispatchEvent(new s.win.PointerEvent('pointermove', { pointerId: 3, clientX: 400, clientY: 300, bubbles: true }));
  assert.ok(s.doc.querySelector('.gv-drag-ghost'), 'ghost after 4px');
  s.doc.dispatchEvent(new s.win.PointerEvent('pointerup', { pointerId: 3, clientX: 400, clientY: 300, bubbles: true }));
  assert.equal(s.c.template().nodes.length, n0 + 1, 'dropped inside the stage ⇒ spawned');
  assert.equal(s.doc.querySelector('.gv-drag-ghost'), null, 'ghost removed');
  pill.dispatchEvent(new s.win.PointerEvent('pointerdown', { pointerId: 4, button: 0, clientX: 100, clientY: 700, bubbles: true }));
  s.doc.dispatchEvent(new s.win.PointerEvent('pointermove', { pointerId: 4, clientX: 1270, clientY: 300, bubbles: true }));
  s.doc.dispatchEvent(new s.win.PointerEvent('pointerup', { pointerId: 4, clientX: 1270, clientY: 300, bubbles: true }));
  assert.equal(s.c.template().nodes.length, n0 + 1, 'a drop under the inspector rail cancels');
});
```

`Expected: FAIL — Error: Cannot find module '.../ui/public/graph/palette.mjs'`.

- [ ] Step 2: Implement `ui/public/graph/palette.mjs`:

```js
// ui/public/graph/palette.mjs
// The agents card: domain chips, filter, agent pills and the PINNED Flow group.
// Pure DOM + one delegated controller; it never touches the template — it calls
// back into the composer, which owns every mutation.
export const FLOW_GROUP = 'flow';
/** Flow pills advertise their ports the way agent pills do (pill line 2). */
export const FLOW_PORT_LINE = {
  task: 'source · out task',
  end: 'in result · terminal',
  and: 'in in1..inN · out out',
  or: 'in in1..inN · out out',
  combine: 'in in1, in2 · out out',
};
export const FLOW_PILLS = Object.freeze([
  Object.freeze({ kind: 'task', displayName: 'Task', description: 'The pipeline entry: the prompt and its attached files.' }),
  Object.freeze({ kind: 'end', displayName: 'End', description: 'The pipeline sink. A token arriving here completes the run.' }),
  Object.freeze({ kind: 'and', displayName: 'AND', description: 'Fires when ALL of its inputs are fresh. Payloads discarded — pure sequencing.' }),
  Object.freeze({ kind: 'or', displayName: 'OR', description: 'Fires on ANY fresh input and forwards the freshest payload.' }),
  Object.freeze({ kind: 'combine', displayName: 'Combine', description: 'Joins its md inputs into one document, in port order.' }),
]);
const SINGLETON_KINDS = new Set(['task', 'end']);

/** Pill line 2: META port ids only. The synthesized `await` gate is never listed —
 *  it is not part of the agent's declared contract and every agent has one. */
export function portLineOf(entry) {
  const ids = (ports) => (Array.isArray(ports) ? ports : []).filter((p) => p && !p.synthetic).map((p) => p.id);
  const reads = ids(entry && entry.inputs);
  const writes = ids(entry && entry.outputs);
  return [reads.length ? `in ${reads.join(', ')}` : '', writes.length ? `out ${writes.join(', ')}` : ''].filter(Boolean).join(' · ');
}

/** Ordered groups: every non-shared, non-general domain in first-seen order,
 *  then `general`, then the pinned Flow group. `shared` agents are folded into
 *  every domain group; `placeable:false` agents are dropped everywhere (that is
 *  how workspaceScanner never reaches a canvas). Empty groups are omitted. */
export function paletteEntries(agents, { placedKinds = [] } = {}) {
  const list = (Array.isArray(agents) ? agents : []).filter((a) => a && a.placeable !== false)
    .map((a) => ({ ...a, order: typeof a.order === 'number' ? a.order : 99, domain: a.domain || 'general' }));
  const shared = list.filter((a) => a.domain === 'shared');
  const byOrder = (x, y) => x.order - y.order || String(x.key).localeCompare(String(y.key));
  const domains = [];
  for (const a of list) if (a.domain !== 'shared' && a.domain !== 'general' && !domains.includes(a.domain)) domains.push(a.domain);
  domains.push('general');
  const groups = domains
    .map((domain) => ({ domain, flow: false, agents: [...shared, ...list.filter((a) => a.domain === domain)].sort(byOrder) }))
    .filter((g) => g.agents.length);
  const placed = new Set(placedKinds);
  groups.push({
    domain: FLOW_GROUP, flow: true,
    agents: FLOW_PILLS.map((p) => ({ ...p, portLine: FLOW_PORT_LINE[p.kind] || '', disabled: SINGLETON_KINDS.has(p.kind) && placed.has(p.kind) })),
  });
  return groups;
}

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function pill(doc, entry) {
  const btn = h(doc, 'button', 'ap');
  btn.type = 'button';
  if (entry.key) btn.dataset.key = entry.key; else btn.dataset.kind = entry.kind;
  btn.disabled = Boolean(entry.disabled);
  if (entry.disabled) btn.classList.add('dim');
  const dot = h(doc, 'span', 'd');
  dot.dataset.color = entry.kind ? 'flow' : (entry.color || 'blue');
  const body = h(doc, 'span', 'b');
  body.append(h(doc, 'span', 'n', entry.displayName || entry.key || entry.kind),
    h(doc, 'span', 'p pt', entry.portLine != null ? entry.portLine : portLineOf(entry)));
  btn.append(dot, body);
  if (entry.disabled) btn.appendChild(h(doc, 'span', 'chip', '1 placed'));
  if (entry.description) btn.title = entry.description;
  return btn;
}

export function renderPalette(host, { agents = [], placedKinds = [], collapsed = new Set(), query = '', doc = globalThis.document } = {}) {
  if (!host) return;
  const groups = paletteEntries(agents, { placedKinds });
  const frag = doc.createDocumentFragment();
  const chips = h(doc, 'div', 'pal-chips');
  for (const g of groups) {
    if (g.flow) continue;
    const c = h(doc, 'button', `pal-chip${collapsed.has(g.domain) ? ' off' : ''}`, g.domain);
    c.type = 'button';
    c.dataset.domain = g.domain;
    chips.appendChild(c);
  }
  frag.appendChild(chips);
  for (const g of groups) {
    const sec = h(doc, 'section', `pal-group${g.flow ? ' pal-pinned' : ''}`);
    sec.dataset.domain = g.domain;
    const head = h(doc, 'div', 'grp');
    head.append(h(doc, 'span', 'lab', g.flow ? 'Flow' : g.domain), h(doc, 'span', 'chip', String(g.agents.length)));
    if (g.flow) head.appendChild(h(doc, 'span', 'chip pinned-tag', 'pinned'));
    const pills = h(doc, 'div', 'pills');
    for (const a of g.agents) pills.appendChild(pill(doc, a));
    sec.append(head, pills);
    frag.appendChild(sec);
  }
  // host IS the 300px scroll container: replaceChildren collapses scrollHeight,
  // which clamps scrollTop to 0 and would bounce the list to the top after every
  // spawn, throwing the pinned Flow group out of reach.
  const keep = host.scrollTop;
  host.replaceChildren(frag);
  if (keep) host.scrollTop = keep;
  applyFilter(host, query, collapsed);
}

export function applyFilter(host, query, collapsed = new Set()) {
  if (!host) return;
  const q = String(query || '').trim().toLowerCase();
  for (const sec of host.querySelectorAll('.pal-group')) {
    let any = false;
    for (const btn of sec.querySelectorAll('.ap')) {
      const hay = `${btn.querySelector('.n').textContent} ${btn.dataset.key || btn.dataset.kind || ''} ${btn.querySelector('.p').textContent}`.toLowerCase();
      const show = !q || hay.includes(q);
      btn.hidden = !show;
      if (show) any = true;
    }
    sec.hidden = !any || (sec.dataset.domain !== FLOW_GROUP && collapsed.has(sec.dataset.domain));
  }
}
```

- [ ] Step 3: Implement the spawn + drag-to-spawn controller in `composer.mjs` (imports `renderPalette`, `applyFilter`, `FLOW_GROUP` from `./palette.mjs`):

```js
  const collapsed = new Set();
  let query = '';

  function paintPalette() {
    renderPalette(hostEls.palette, {
      agents: Object.values(agents), placedKinds: tpl.nodes.map((n) => n.kind), collapsed, query, doc,
    });
  }
  /** Diagonal de-stacker: 24 tries, SNAP*2 per try so each attempt lands one
   *  dot-grid cell down-right. Not a general overlap avoider — it exists so a
   *  run of spawns does not stack. */
  function freeSlot(p) {
    let { x, y } = p;
    for (let i = 0; i < 24; i += 1) {
      if (!tpl.nodes.some((n) => n.x === snap(x) && n.y === snap(y))) break;
      x += SNAP * 2; y += SNAP * 2;
    }
    return { x, y };
  }
  function centerWorld() {
    readRect();
    const c = toWorld(R.left + (R.width - insetRight()) / 2, R.top + R.height / 2);
    return { x: c.x - NODE_W / 2, y: c.y - 60 };
  }
  function spawn(entry, at) {
    const p = at || freeSlot(centerWorld());
    let node = null;
    commit('add', () => {
      node = entry.kind
        ? newNode(entry.kind, null, snap(p.x), snap(p.y))
        : newNode('agent', entry.key, snap(p.x), snap(p.y));
      if (entry.kind === 'and' || entry.kind === 'or' || entry.kind === 'combine') node.config.arity = 2;
      tpl.nodes.push(node);
    });
    select({ kind: 'node', id: node.id });
    return node;
  }

  // ---- drag-to-spawn (~60 LOC): 4px threshold, fixed-position ghost, drop must
  // land inside the cached stage rect MINUS the inspector inset.
  let drag = null;
  function onPalDown(ev) {
    const btn = ev.target.closest && ev.target.closest('.ap');
    if (!btn || btn.disabled || ev.button !== 0) return;
    drag = { entry: btn.dataset.kind ? { kind: btn.dataset.kind } : { key: btn.dataset.key },
      sx: ev.clientX, sy: ev.clientY, id: ev.pointerId, label: btn.querySelector('.n').textContent, ghost: null };
    try { btn.setPointerCapture?.(ev.pointerId); } catch { /* synthetic */ }
    doc.addEventListener('pointermove', onPalMove);
    doc.addEventListener('pointerup', onPalUp);
    doc.addEventListener('pointercancel', onPalCancel);
  }
  function onPalMove(ev) {
    if (!drag) return;
    if (!drag.ghost && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 4) return;
    if (!drag.ghost) {
      drag.ghost = doc.createElement('div');
      drag.ghost.className = 'gv-drag-ghost';
      drag.ghost.textContent = drag.label;
      doc.body.appendChild(drag.ghost);
      readRect();
    }
    drag.ghost.style.left = `${ev.clientX + 8}px`;
    drag.ghost.style.top = `${ev.clientY + 8}px`;
  }
  function onPalUp(ev) {
    const d = drag;
    if (!d) return;
    const dragged = Boolean(d.ghost);
    endPalDrag();
    if (!dragged) { spawn(d.entry); return; }             // < 4px is a click
    const inBand = ev.clientX >= R.left && ev.clientX <= R.left + R.width - insetRight()
      && ev.clientY >= R.top && ev.clientY <= R.top + R.height;
    if (!inBand) return;
    const p = toWorld(ev.clientX, ev.clientY);
    spawn(d.entry, { x: snap(p.x - NODE_W / 2), y: snap(p.y - 20) });
  }
  const onPalCancel = () => endPalDrag();
  function endPalDrag() {
    if (drag && drag.ghost) drag.ghost.remove();
    drag = null;
    doc.removeEventListener('pointermove', onPalMove);
    doc.removeEventListener('pointerup', onPalUp);
    doc.removeEventListener('pointercancel', onPalCancel);
  }
  function onPalClick(ev) {
    const chip = ev.target.closest && ev.target.closest('.pal-chip');
    if (!chip) return;
    const d = chip.dataset.domain;
    if (collapsed.has(d)) collapsed.delete(d); else collapsed.add(d);
    paintPalette();
  }
  const onFilterInput = () => { query = hostEls.filter ? hostEls.filter.value : ''; applyFilter(hostEls.palette, query, collapsed); };
```

`mount()` binds `hostEls.palette?.addEventListener('pointerdown', onPalDown)`, `hostEls.palette?.addEventListener('click', onPalClick)`, `hostEls.filter?.addEventListener('input', onFilterInput)`; `destroy()` removes them and calls `endPalDrag()`. `render()` calls `paintPalette()` (so the Task/End pills disable the moment one is placed). Escape in `onKeyDown` also clears the filter when it has a value. Export `spawn`, `paintPalette` on the returned object.

- [ ] Step 4: `node --test test/ui-composer-editor.test.mjs` → `Expected: # pass 14 / # fail 0`.
- [ ] Step 5: Commit — `worca: Node-graph v2 P5 — agents palette with click and drag-to-spawn`.

---

### Task 14: `inspector.mjs` + the floating, collapsible rail

**Files:** create `ui/public/graph/inspector.mjs`; modify `ui/public/graph/composer.mjs`, `test/ui-composer-editor.test.mjs`.
**Interfaces:** produces `renderNodeInspector(node, {template, portsFn, meta, models, efforts, doc}) → Element`, `renderWireInspector(wire, {loop, doc}) → Element`, `renderEmptyInspector({doc}) → Element`. Adapted from `old:ui/public/graph/inspector.mjs` with four changes: (1) `resolveOrOutType` imported from the SHARED `ports.mjs` with the `(tpl, portsFn, orId, seen)` signature; (2) a Task panel gains the `planStoreSeed` toggle; (3) the rail's storage key is **`worca.composer.inspector`** (the old branch used `worca-cc.composer.inspector` — the product is "worca"); (4) End's panel carries the run-mode result chip slot. Capability rows are gated by META BOOLEANS only — no key lists anywhere, which is the whole point of meta v2. ONE delegated `change` listener on `hostEls.insBody`, routed on `data-field`.

- [ ] Step 1: Write the failing tests — append to `test/ui-composer-editor.test.mjs`:

```js
test('agent inspector gates rows on meta booleans and commits every change', async () => {
  const meta = { key: 'planner', displayName: 'Plan', color: 'violet', fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false, inputs: [], outputs: [] };
  const s = await open({ api: { agents: async () => [meta], agentsAll: async () => [meta] } });
  s.c.setAgents({ planner: meta });
  s.c.select({ kind: 'node', id: 'n_agent' });
  const body = s.el.insBody;
  assert.ok(body.querySelector('[data-field="model"]'), 'model select');
  assert.ok(body.querySelector('[data-field="fanOut"]'), 'fan-out row exists for a fanOut agent');
  assert.ok(body.querySelector('[data-field="askQuestions"]'));
  assert.ok(body.querySelector('[data-field="awaitAll"]'));
  const sel2 = body.querySelector('[data-field="model"]');
  sel2.value = 'sonnet';
  sel2.dispatchEvent(new s.win.Event('change', { bubbles: true }));
  assert.equal(s.c.template().nodes[1].config.model, 'sonnet');
  assert.equal(s.c.undoDepth(), 1, 'a field change is one undo entry');
  const box = body.querySelector('[data-field="awaitAll"]');
  box.checked = true;
  box.dispatchEvent(new s.win.Event('change', { bubbles: true }));
  assert.equal(s.c.template().nodes[1].config.awaitAll, true);
});

test('locked questions are forced + disabled; a non-asking agent has no row', async () => {
  const locked = { key: 'planner', displayName: 'Plan', asksQuestions: true, questionsLocked: true, questionsDefault: true, inputs: [], outputs: [] };
  const s = await open();
  s.c.setAgents({ planner: locked });
  s.c.select({ kind: 'node', id: 'n_agent' });
  const box = s.el.insBody.querySelector('[data-field="askQuestions"]');
  assert.equal(box.disabled, true);
  assert.equal(box.checked, true);
  assert.equal(box.closest('.ins-tog').title, 'Always on for this agent');
  const mute = { key: 'planner', displayName: 'Plan', asksQuestions: false, inputs: [], outputs: [] };
  s.c.setAgents({ planner: mute });
  s.c.select(null); s.c.select({ kind: 'node', id: 'n_agent' });
  assert.equal(s.el.insBody.querySelector('[data-field="askQuestions"]'), null);
});

test('arity stepper floors at 2; loop wires get maxCycles; Task gets planStoreSeed', async () => {
  const s = await open();
  s.c.spawn({ kind: 'and' });
  const andId = s.c.template().nodes[s.c.template().nodes.length - 1].id;
  const inp = s.el.insBody.querySelector('[data-field="arity"]');
  inp.value = '1';
  inp.dispatchEvent(new s.win.Event('change', { bubbles: true }));
  assert.equal(s.c.template().nodes.find((n) => n.id === andId).config.arity, 2, 'floor is 2 (V12)');
  s.c.select({ kind: 'node', id: 'n_task' });
  const seed = s.el.insBody.querySelector('[data-field="planStoreSeed"]');
  assert.ok(seed, 'Task node exposes planStoreSeed');
  seed.checked = true;
  seed.dispatchEvent(new s.win.Event('change', { bubbles: true }));
  assert.equal(s.c.template().nodes[0].config.planStoreSeed, true);
  s.c.select({ kind: 'wire', id: 'w1' });
  assert.equal(s.el.insBody.querySelector('[data-field="maxCycles"]'), null, 'a plain wire has no budget control (V13)');
});

test('the rail collapse state persists under worca.composer.inspector', async () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  const s = await open({ storage });
  assert.equal(s.el.insRail.dataset.open, 'open');
  s.el.insToggle.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  assert.equal(s.el.insRail.dataset.open, 'collapsed');
  assert.equal(s.el.insToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(store.get('worca.composer.inspector'), 'collapsed');
  const s2 = await open({ storage });
  assert.equal(s2.el.insRail.dataset.open, 'collapsed', 'restored on the next mount');
});
```

`Expected: FAIL — Error: Cannot find module '.../ui/public/graph/inspector.mjs'` (after the composer's import lands) / `TypeError: Cannot read properties of null (reading 'querySelector')`.

- [ ] Step 2: Implement `ui/public/graph/inspector.mjs`:

```js
// ui/public/graph/inspector.mjs
// Pure DOM renderers for the composer's floating rail. Every function takes the
// target `document` via opts and returns a DETACHED element — no fetch, no
// listeners. composer.mjs mounts the result and binds ONE delegated `change`
// listener, routing on `data-field`. Capability rows are gated by META
// BOOLEANS: a new agent's sidecar drives its panel with no UI change.
import { resolveOrOutType } from '../../../src/shared/graph/ports.mjs';

const ARITY_KINDS = new Set(['and', 'or', 'combine']);
const FLOW_TITLES = { task: 'Task', end: 'End', and: 'AND', or: 'OR', combine: 'Combine' };
const FLOW_BLURB = {
  task: 'The pipeline entry: the prompt and its attached files.',
  end: 'The pipeline sink. A token arriving here completes the run.',
  and: 'Fires when ALL of its inputs are fresh. Payloads are discarded — pure sequencing.',
  or: 'Fires on ANY fresh input and forwards the freshest payload.',
  combine: 'Joins its md inputs into one document, in port order.',
};

const h = (doc, tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const field = (doc, cls, label) => { const w = h(doc, 'div', `ins-f ${cls}`); w.appendChild(h(doc, 'label', 'ins-label', label)); return w; };

function select(doc, cls, name, label, items, value) {
  const wrap = field(doc, cls, label);
  const sel = h(doc, 'select', 'ins-select');
  sel.dataset.field = name;
  for (const opt of items) {
    const o = doc.createElement('option');
    o.value = opt.value; o.textContent = opt.text;
    if (opt.value === (value == null ? '' : String(value))) o.selected = true;
    sel.appendChild(o);
  }
  wrap.appendChild(sel);
  return wrap;
}
function toggle(doc, cls, name, label, hint, { checked = false, disabled = false, title = '' } = {}) {
  const row = h(doc, 'div', `ins-tog ${cls}`);
  if (title) row.title = title;
  const box = doc.createElement('input');
  box.type = 'checkbox'; box.dataset.field = name; box.checked = Boolean(checked); box.disabled = Boolean(disabled);
  const body = h(doc, 'span', 'ins-tog-b');
  body.appendChild(h(doc, 'span', 'ins-tog-t', label));
  if (hint) body.appendChild(h(doc, 'small', 'ins-tog-h', hint));
  row.append(box, body);
  return row;
}
function head(doc, title, sub) {
  const w = h(doc, 'div', 'ins-head');
  w.appendChild(h(doc, 'div', 'ins-name', title));
  if (sub) w.appendChild(h(doc, 'div', 'ins-sub', sub));
  return w;
}
function number(doc, cls, name, label, value, min) {
  const wrap = field(doc, cls, label);
  const input = doc.createElement('input');
  input.type = 'number'; input.className = 'ins-number'; input.dataset.field = name;
  input.min = String(min); input.step = '1'; input.value = String(value);
  wrap.appendChild(input);
  return wrap;
}
/** Read-only listing of a node's resolved ports. */
function portList(doc, ports) {
  const wrap = h(doc, 'div', 'ins-ports');
  const zone = (label, list, dir) => {
    if (!list.length) return;
    wrap.appendChild(h(doc, 'div', 'ins-zone', label));
    const ul = h(doc, 'div', 'ins-plist');
    for (const p of list) {
      const item = h(doc, 'div', `ins-pitem${p.synthetic ? ' gate' : ''}`);
      item.appendChild(h(doc, 'i', p.synthetic ? 'gdot' : `dot ${p.type}`));
      item.appendChild(h(doc, 'span', 'pn', p.id));
      const bits = [p.type];
      if (p.synthetic) bits.push('engine');
      else if (dir === 'in') bits.push(p.loop ? 'loop' : (p.required === false ? 'optional' : 'required'));
      else if (p.when && p.when !== 'always') bits.push(`on ${p.when}`);
      if (p.expands) bits.push('fan-out');
      item.appendChild(h(doc, 'span', 'pt mla', bits.join(' · ')));
      ul.appendChild(item);
    }
    wrap.appendChild(ul);
  };
  zone('Inputs', ports.inputs, 'in');
  zone('Outputs', ports.outputs, 'out');
  return wrap;
}

export function renderNodeInspector(node, { template, portsFn, meta = null, models = [], efforts = [], doc = globalThis.document } = {}) {
  const ports = portsFn(node) || { inputs: [], outputs: [] };
  const root = h(doc, 'div', `ins-panel ins-${node.kind === 'agent' ? 'agent' : `flow ins-${node.kind}`}`);
  root.dataset.nodeId = node.id;
  const body = h(doc, 'div', 'ins-body-in');

  if (node.kind === 'agent') {
    root.appendChild(head(doc, (meta && meta.displayName) || node.key || node.id, `${node.key} · ${node.id}`));
    body.appendChild(select(doc, 'ins-model', 'model', 'Model',
      [{ value: '', text: 'inherit' }, ...models.map((m) => ({ value: m.id, text: m.label || m.id }))], node.config.model));
    body.appendChild(select(doc, 'ins-effort', 'effort', 'Effort',
      [{ value: '', text: 'default' }, ...efforts.map((e) => ({ value: e, text: e }))], node.config.effort));
    if (meta && meta.fanOut) {
      body.appendChild(toggle(doc, 'ins-fanout', 'fanOut', 'Research fan-out', 'parallel research sub-agents',
        { checked: node.config.fanOut === true }));
    }
    if (meta && meta.asksQuestions) {
      const locked = Boolean(meta.questionsLocked);
      const saved = node.config.askQuestions;
      body.appendChild(toggle(doc, 'ins-questions', 'askQuestions', 'Ask questions', 'pauses the run for input', {
        checked: locked ? Boolean(meta.questionsDefault) : (typeof saved === 'boolean' ? saved : Boolean(meta.questionsDefault)),
        disabled: locked,
        title: locked ? (meta.questionsDefault ? 'Always on for this agent' : 'Always off for this agent') : '',
      }));
    }
    body.appendChild(toggle(doc, 'ins-awaitall', 'awaitAll', 'Await all inputs', 'gate until every wire fires',
      { checked: node.config.awaitAll === true }));
  } else {
    root.appendChild(head(doc, FLOW_TITLES[node.kind] || node.kind, node.id));
    body.appendChild(h(doc, 'p', 'ins-blurb', FLOW_BLURB[node.kind] || ''));
    if (ARITY_KINDS.has(node.kind)) {
      body.appendChild(number(doc, 'ins-arity', 'arity', 'Inputs', Number.isInteger(node.config.arity) ? node.config.arity : 2, 2));
    }
    if (node.kind === 'or') {
      const resolved = resolveOrOutType(template, portsFn, node.id, new Set());
      body.appendChild(h(doc, 'div', 'ins-resolved', resolved ? `forwards: ${resolved}` : 'unresolved'));
    }
    if (node.kind === 'task') {
      body.appendChild(toggle(doc, 'ins-seed', 'planStoreSeed', 'Seed the plan store', 'treat an attached plan as the run’s plan',
        { checked: node.config.planStoreSeed === true }));
    }
    if (node.kind === 'end') body.appendChild(h(doc, 'div', 'ins-result', ''));
  }
  body.appendChild(h(doc, 'div', 'ins-sep'));
  body.appendChild(portList(doc, ports));
  root.appendChild(body);
  return root;
}

/** Loop wires carry the per-wire cycle budget; a plain wire must NOT expose one
 *  (maxCycles on a non-loop wire is V13's error). */
export function renderWireInspector(wire, { loop = false, doc = globalThis.document } = {}) {
  const root = h(doc, 'div', `ins-panel ins-wire${loop ? ' ins-loop' : ''}`);
  root.dataset.wireId = wire.id;
  root.appendChild(head(doc, loop ? 'Loop wire' : 'Wire', `${wire.from.node}.${wire.from.port} → ${wire.to.node}.${wire.to.port}`));
  const body = h(doc, 'div', 'ins-body-in');
  if (loop) {
    body.appendChild(number(doc, 'ins-maxcycles', 'maxCycles', 'Max cycles',
      wire.config && Number.isInteger(wire.config.maxCycles) ? wire.config.maxCycles : 3, 1));
    body.appendChild(h(doc, 'small', 'ins-hint', 'How many times this loop may re-deliver before the gate asks.'));
  } else {
    body.appendChild(h(doc, 'p', 'ins-blurb', 'Plain data wire. Delete it to rewire the target input.'));
  }
  root.appendChild(body);
  return root;
}

export function renderEmptyInspector({ doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'ins-panel ins-empty');
  root.appendChild(h(doc, 'p', 'ins-blurb', 'Select a node or a wire to configure it.'));
  return root;
}
```

- [ ] Step 3: Implement the rail + the delegated `change` router in `composer.mjs`:

```js
  import { renderNodeInspector, renderWireInspector, renderEmptyInspector } from './inspector.mjs';
  // ... inside createComposer:
  let models = [];
  let efforts = [];
  const readKey = (k) => { try { return storage ? storage.getItem(k) : null; } catch { return null; } };
  const writeKey = (k, v) => { try { if (storage) storage.setItem(k, v); } catch { /* private mode */ } };

  function paintInspector() {
    const hostBody = hostEls.insBody;
    if (!hostBody) return;
    if (!sel) return void hostBody.replaceChildren(renderEmptyInspector({ doc }));
    if (sel.kind === 'node') {
      const node = nodeById(sel.id);
      if (!node) return void hostBody.replaceChildren(renderEmptyInspector({ doc }));
      const meta = node.kind === 'agent' ? (agents[node.key] || null) : null;
      return void hostBody.replaceChildren(renderNodeInspector(node, { template: tpl, portsFn, meta, models, efforts, doc }));
    }
    const wire = wireById(sel.id);
    if (!wire) return void hostBody.replaceChildren(renderEmptyInspector({ doc }));
    hostBody.replaceChildren(renderWireInspector(wire, { loop: view.isLoopWire(wire.id), doc }));
  }

  function setRail(open, { persist = false } = {}) {
    if (!hostEls.insRail) return;
    hostEls.insRail.dataset.open = open ? 'open' : 'collapsed';
    if (hostEls.insToggle) {
      hostEls.insToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      hostEls.insToggle.setAttribute('aria-label', open ? 'Collapse inspector' : 'Expand inspector');
    }
    if (persist) writeKey(INSPECTOR_KEY, open ? 'open' : 'collapsed');
  }
  const onRailToggle = () => setRail(hostEls.insRail.dataset.open === 'collapsed', { persist: true });

  function onInspectorChange(ev) {
    const name = ev.target.dataset && ev.target.dataset.field;
    if (!name || !sel) return;
    if (sel.kind === 'wire') {
      const wire = wireById(sel.id);
      if (!wire || name !== 'maxCycles') return;
      const n = Number.parseInt(ev.target.value, 10);
      commit('maxCycles', () => {
        wire.config = { ...(wire.config || {}) };
        if (Number.isInteger(n) && n >= 1) wire.config.maxCycles = n; else delete wire.config.maxCycles;
        if (!Object.keys(wire.config).length) delete wire.config;
      });
      return;
    }
    const node = nodeById(sel.id);
    if (!node) return;
    commit(name, () => {
      if (name === 'arity') {
        const n = Number.parseInt(ev.target.value, 10);
        node.config.arity = Number.isInteger(n) && n >= 2 ? n : 2;   // V12 floor
      } else if (ev.target.type === 'checkbox') {
        if (ev.target.checked) node.config[name] = true; else delete node.config[name];
      } else if (ev.target.value === '') {
        delete node.config[name];
      } else {
        node.config[name] = ev.target.value;
      }
    });
    paintInspector();                                  // re-read the committed value
  }
```

`render()` calls `paintInspector()`; `select()` calls it too. `mount()` binds `hostEls.insBody?.addEventListener('change', onInspectorChange)` and `hostEls.insToggle?.addEventListener('click', onRailToggle)`, then `setRail(readKey(INSPECTOR_KEY) !== 'collapsed')`; `destroy()` removes both. Add `setModels({models, efforts})` to the returned object (app.js feeds it from `GET /api/config`).

- [ ] Step 4: `node --test test/ui-composer-editor.test.mjs` → `Expected: # pass 18 / # fail 0`.
- [ ] Step 5: Commit — `worca: Node-graph v2 P5 — node/wire inspector and the collapsible rail`.

---

### Task 15: `save-dialog.mjs` — Save, Save-as, and the server's 422

**Files:** create `ui/public/graph/save-dialog.mjs`; modify `ui/public/graph/composer.mjs`, `test/ui-composer-editor.test.mjs`.
**Interfaces:** produces `renderSaveDialog({name, domain, domains, title, doc}) → HTMLDialogElement` (`.sd-name`, `.sd-domain` + datalist, `.sd-msg`, `.sd-cancel`, `.sd-confirm`), `openDialog(dlg)`, `closeDialog(dlg)` (jsdom has no `showModal` — fall back to the `open` attribute). Adapted from `old:ui/public/graph/save-dialog.mjs` unchanged except: the confirm path posts `{ ...serializeTemplate(tpl), version: 2, name, domain }` and **includes `id` only when the canvas was loaded from a saved row** (Save on a loaded row sends its id; Save-as omits it, so the server mints `wf_${slugify(name)}`). A 422 body carries the shared validator's issues — they render VERBATIM, one line per issue, and the server stays authoritative.

- [ ] Step 1: Write the failing tests — append to `test/ui-composer-editor.test.mjs`:

```js
test('Save posts version 2 with the loaded id; Save-as omits it', async () => {
  const posts = [];
  const s = await open({ api: { saveWorkflow: async (b) => { posts.push(b); return { ok: true, workflow: { id: b.id || 'wf_new' } }; } } });
  s.c.loadTemplate({ id: 'wf_loaded', name: 'Loaded', version: 2, domain: 'coding', nodes: fixture().nodes, wires: fixture().wires });
  await new Promise((r) => setTimeout(r, 0));
  s.el.save.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  const dlg = s.el.dialogHost.querySelector('dialog.save-dialog');
  assert.equal(dlg.querySelector('.sd-name').value, 'Loaded');
  dlg.querySelector('.sd-confirm').dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posts[0].version, 2);
  assert.equal(posts[0].id, 'wf_loaded');
  assert.ok(Array.isArray(posts[0].nodes) && Array.isArray(posts[0].wires));
  assert.equal(s.c.isDirty(), false, 'saving clears the dirty flag');
  s.c.openSaveDialog({ saveAs: true });
  const dlg2 = s.el.dialogHost.querySelector('dialog.save-dialog');
  dlg2.querySelector('.sd-name').value = 'Copy';
  dlg2.querySelector('.sd-confirm').dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posts[1].id, undefined, 'Save-as omits the id');
  assert.equal(posts[1].name, 'Copy');
});

test('a 422 renders the validator issues verbatim and keeps the dialog open', async () => {
  const s = await open({ api: { saveWorkflow: async () => ({ ok: false, status: 422, issues: [
    { code: 'V21', message: 'exactly one end node is required' },
    { code: 'V5', message: 'n_agent.task is not wired', nodeId: 'n_agent' },
  ] }) } });
  s.el.save.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  const dlg = s.el.dialogHost.querySelector('dialog.save-dialog');
  dlg.querySelector('.sd-name').value = 'X';
  dlg.querySelector('.sd-confirm').dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const msg = dlg.querySelector('.sd-msg');
  assert.match(msg.textContent, /exactly one end node is required/);
  assert.match(msg.textContent, /n_agent\.task is not wired/);
  assert.ok(dlg.hasAttribute('open') || dlg.open, 'dialog stays open on 422');
  assert.equal(s.c.isDirty(), true);
});

test('an empty name is refused client-side before any POST', async () => {
  let calls = 0;
  const s = await open({ api: { saveWorkflow: async () => { calls += 1; return { ok: true, workflow: { id: 'x' } }; } } });
  s.el.save.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  const dlg = s.el.dialogHost.querySelector('dialog.save-dialog');
  dlg.querySelector('.sd-name').value = '   ';
  dlg.querySelector('.sd-confirm').dispatchEvent(new s.win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 0);
  assert.equal(dlg.querySelector('.sd-msg').textContent, 'name is required');
});
```

`Expected: FAIL — TypeError: Cannot read properties of null (reading 'querySelector')` (no dialog is mounted).

- [ ] Step 2: Implement `ui/public/graph/save-dialog.mjs`:

```js
// ui/public/graph/save-dialog.mjs
// The composer's save modal — a real <dialog>, never window.prompt. Pure
// renderer: it returns a DETACHED dialog; composer.mjs mounts it and owns the POST.
function h(doc, tag, cls, text) { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

export function renderSaveDialog({ name = '', domain = '', domains = [], title = 'Save pipeline', doc = globalThis.document } = {}) {
  const dlg = doc.createElement('dialog');
  dlg.className = 'save-dialog';
  const form = h(doc, 'div', 'sd-body');
  form.appendChild(h(doc, 'h2', 'sd-title', title));

  const nameWrap = h(doc, 'div', 'sd-field');
  nameWrap.appendChild(h(doc, 'label', null, 'Name'));
  const nameInput = doc.createElement('input');
  nameInput.type = 'text'; nameInput.className = 'sd-name'; nameInput.value = name;
  nameInput.setAttribute('spellcheck', 'false'); nameInput.placeholder = 'e.g. Full pipeline';
  nameWrap.appendChild(nameInput);
  form.appendChild(nameWrap);

  const domWrap = h(doc, 'div', 'sd-field');
  domWrap.appendChild(h(doc, 'label', null, 'Domain'));
  const domInput = doc.createElement('input');
  domInput.type = 'text'; domInput.className = 'sd-domain'; domInput.value = domain;
  domInput.setAttribute('spellcheck', 'false'); domInput.placeholder = 'general';
  const listId = `sd-domains-${Math.random().toString(36).slice(2, 8)}`;
  domInput.setAttribute('list', listId);
  const list = doc.createElement('datalist');
  list.id = listId;
  for (const d of domains) { const o = doc.createElement('option'); o.value = d; list.appendChild(o); }
  domWrap.append(domInput, list);
  form.appendChild(domWrap);

  form.appendChild(h(doc, 'p', 'sd-msg'));
  const actions = h(doc, 'div', 'sd-actions');
  const cancel = h(doc, 'button', 'btn-ghost sd-cancel', 'Cancel'); cancel.type = 'button';
  const confirm = h(doc, 'button', 'btn-go sd-confirm', 'Save'); confirm.type = 'button';
  actions.append(cancel, confirm);
  form.appendChild(actions);
  dlg.appendChild(form);
  return dlg;
}

/** jsdom (and older browsers) lack showModal — fall back to the `open`
 *  attribute so the modal is still in the accessibility tree. */
export function openDialog(dlg) {
  if (typeof dlg.showModal === 'function') { try { dlg.showModal(); return; } catch { /* already open */ } }
  dlg.setAttribute('open', '');
}
export function closeDialog(dlg) {
  if (typeof dlg.close === 'function') { try { dlg.close(); return; } catch { /* not open */ } }
  dlg.removeAttribute('open');
}
```

- [ ] Step 3: Implement the save path in `composer.mjs`:

```js
  import { renderSaveDialog, openDialog, closeDialog } from './save-dialog.mjs';
  // ... inside createComposer:
  let dialog = null;
  let savedDomains = [];

  function openSaveDialog({ saveAs = false } = {}) {
    if (!hostEls.dialogHost) return null;
    if (dialog) dialog.remove();
    dialog = renderSaveDialog({
      name: saveAs ? `${tpl.name || 'Untitled'} copy` : (tpl.name || ''),
      domain: tpl.domain || '', domains: savedDomains,
      title: saveAs ? 'Save a copy' : 'Save pipeline', doc,
    });
    dialog.dataset.saveAs = saveAs ? '1' : '';
    hostEls.dialogHost.replaceChildren(dialog);
    dialog.querySelector('.sd-cancel').addEventListener('click', () => closeDialog(dialog));
    dialog.querySelector('.sd-confirm').addEventListener('click', () => { confirmSave(); });
    openDialog(dialog);
    return dialog;
  }

  async function confirmSave() {
    if (!dialog) return;
    const msg = dialog.querySelector('.sd-msg');
    const name = dialog.querySelector('.sd-name').value.trim();
    msg.className = 'sd-msg';
    if (!name) { msg.textContent = 'name is required'; msg.className = 'sd-msg err'; return; }
    const domain = dialog.querySelector('.sd-domain').value.trim();
    const saveAs = dialog.dataset.saveAs === '1';
    const body = { ...serializeTemplate(tpl), version: 2, name, domain };
    // Save on a LOADED row sends its id; Save-as omits it so the server mints
    // wf_${slugify(name)}. wf_default / wf_default_v2 are never targets.
    if (!saveAs && tpl.id && tpl.id !== 'wf_default' && tpl.id !== 'wf_default_v2') body.id = tpl.id;
    else delete body.id;
    try {
      const res = await api.saveWorkflow(body);
      if (res && res.ok === false) {
        // 422 = the shared validator's issues; render them VERBATIM.
        const issues = Array.isArray(res.issues) ? res.issues : [];
        msg.textContent = issues.length
          ? issues.map((i) => (i.code ? `${i.code}: ${i.message}` : i.message)).join('\n')
          : (res.error || `save failed (${res.status || 'error'})`);
        msg.className = 'sd-msg err';
        return;
      }
      composer.markSaved(res && res.workflow && res.workflow.id, name, domain);
      closeDialog(dialog);
      if (hooks.onSaved) hooks.onSaved(res && res.workflow);
      render();
    } catch (err) {
      msg.textContent = err && err.message ? err.message : String(err);
      msg.className = 'sd-msg err';
    }
  }
```

`mount()` binds `hostEls.saveBtn?.addEventListener('click', () => openSaveDialog())`; `destroy()` removes it. Add `openSaveDialog, setSavedDomains(list) { savedDomains = list || []; }` to the returned object. Add the dialog styles to `style.css` if `.save-dialog` is not already styled (`grep -n "save-dialog" ui/public/style.css`); if absent append:
```css
.save-dialog{border:none;border-radius:16px;padding:0;box-shadow:var(--shadow);max-width:420px;width:92vw;}
.save-dialog .sd-body{padding:18px 20px;display:flex;flex-direction:column;gap:12px;}
.save-dialog .sd-title{margin:0;font-size:15px;}
.save-dialog .sd-field{display:flex;flex-direction:column;gap:5px;}
.save-dialog .sd-field input{border:1px solid var(--line-2);border-radius:9px;padding:8px 10px;font:13px var(--sans);}
.save-dialog .sd-msg{margin:0;font-size:12px;color:var(--ink-3);white-space:pre-line;}
.save-dialog .sd-msg.err{color:var(--red-ink);}
.save-dialog .sd-actions{display:flex;justify-content:flex-end;gap:8px;}
```

- [ ] Step 4: `node --test test/ui-composer-editor.test.mjs` → `Expected: # pass 21 / # fail 0`.
- [ ] Step 5: Commit — `worca: Node-graph v2 P5 — save dialog, version 2 POST and 422 rendering`.

---

### Task 16: `app.js` — mount once, fit on re-entry, agents fetch, saved list

**Files:** modify `ui/public/app.js`; create `test/ui-composer-app.test.mjs`.
**Interfaces:** produces `initComposer()` (mount-once + `fit()` on every re-entry) and `composerExit()` (leave-guard), the `api` adapter the editor consumes, the saved-pipelines list and the Archived footer. `GET /api/agents` (no `?all=1`) feeds the palette; `GET /api/agents?all=1` feeds `portsFn` (workspace-only agents can appear in loaded templates). Run/History graphs NEVER use the live registry — the run manifest snapshots ports at run start.

**Loading and failure copy (normative):** while the fetch is in flight the palette shows `Loading agents…`; on failure an inline row `Couldn't load agents — Retry` (a `<button class="gv-retry">Retry</button>`) and Save stays disabled (`composer.setReady(false)`). A loaded template still renders — an unknown key yields empty ports, `known:false` and a V4 pip.

- [ ] Step 1: Write the failing test — `test/ui-composer-app.test.mjs` (boots the real `app.js` under jsdom, the house pattern from `test/ui-composer-wires.test.mjs:14-36`):

```js
// test/ui-composer-app.test.mjs — the composer's app.js integration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const AGENTS = [
  { key: 'planner', displayName: 'Plan', domain: 'coding', color: 'violet', order: 1, metaVersion: 2, fanOut: true, asksQuestions: true,
    inputs: [{ id: 'task', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  { key: 'reviewer', displayName: 'Review', domain: 'coding', color: 'blue', order: 4, metaVersion: 2, asksQuestions: true,
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
];
const V2_ROW = { id: 'wf_g', name: 'Graph one', version: 2, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 200, config: {} }, { id: 'n_end', kind: 'end', x: 960, y: 200, config: {} }], wires: [] };
const V1_ROW = { id: 'wf_old', name: 'Legacy one', version: 1, domain: 'coding', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] };

async function boot({ agentsFail = false, archived = [] } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const json = (v, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => v });
  window.fetch = (u) => {
    const url = String(u);
    if (url.includes('/api/agents')) return agentsFail ? Promise.reject(new Error('down')) : json({ agents: AGENTS });
    if (url.includes('/api/workflows?archived=1')) return json({ workflows: archived });
    if (url.includes('/api/workflows')) return json({ workflows: [V2_ROW, V1_ROW] });
    if (url.includes('/api/config')) return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
    return json({ projects: [], runs: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  window.location.hash = 'composer';
  window.dispatchEvent(new window.Event('hashchange'));
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  return window;
}

test('entering the composer mounts once, preloads Task+End and lists saved rows', async () => {
  const win = await boot();
  const doc = win.document;
  assert.ok(doc.querySelector('#gv-canvas .gv-stage'), 'stage mounted');
  assert.equal(doc.querySelectorAll('#gv-canvas .gv-stage').length, 1);
  assert.equal(doc.querySelectorAll('#gv-canvas .node').length, 2, 'new canvas preloads Task + End');
  assert.match(doc.querySelector('.gv-empty').textContent, /^Wire agents from the Task node to the End node/);
  assert.ok(doc.querySelector('#gv-palette .ap[data-key="planner"]'), 'palette rendered from /api/agents');
  const rows = [...doc.querySelectorAll('#gv-saved-list .pl-item')];
  assert.equal(rows.length, 2);
  assert.ok(rows[0].querySelector('svg'), 'v2 row carries a thumbnail');
  assert.equal(rows[1].querySelector('.pl-legacy').textContent, 'legacy · runnable until the graph cut-over');
  assert.equal(rows[1].querySelector('.pl-open'), null, 'a v1 row cannot be opened in the v2 composer');
  // re-entry re-fits without re-mounting
  win.location.hash = 'running'; win.dispatchEvent(new win.Event('hashchange'));
  win.location.hash = 'composer'; win.dispatchEvent(new win.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelectorAll('#gv-canvas .gv-stage').length, 1, 'mounted once');
});

test('an /api/agents failure shows Retry and disables Save; the graph still renders', async () => {
  const win = await boot({ agentsFail: true });
  const doc = win.document;
  assert.match(doc.querySelector('#gv-palette').textContent, /Couldn’t load agents|Couldn't load agents/);
  assert.ok(doc.querySelector('#gv-palette .gv-retry'), 'Retry button');
  assert.equal(doc.querySelector('#gv-save').disabled, true);
  assert.equal(doc.querySelectorAll('#gv-canvas .node').length, 2, 'the canvas still renders');
});

test('the Archived footer appears only when the endpoint returns rows', async () => {
  const win = await boot();
  assert.equal(win.document.querySelector('#gv-archived').hidden, true);
  const win2 = await boot({ archived: [{ id: 'wf_dead', name: 'Old', version: 1, archivedAt: '2026-08-26' }] });
  const foot = win2.document.querySelector('#gv-archived');
  assert.equal(foot.hidden, false);
  assert.match(foot.textContent, /Archived \(1\)/);
});

test('leaving the composer calls composerExit: no document listener survives', async () => {
  const win = await boot();
  const doc = win.document;
  win.location.hash = 'running';
  win.dispatchEvent(new win.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  const before = doc.querySelectorAll('#gv-canvas .node').length;
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  assert.equal(doc.querySelectorAll('#gv-canvas .node').length, before, 'Backspace elsewhere never edits the graph');
});
```

`Expected: FAIL — AssertionError: stage mounted` (`#gv-canvas .gv-stage` is null; `initComposer` no longer exists after Task 8).

- [ ] Step 2: Implement in `ui/public/app.js` — add the imports at the top (depth 2 for `src/shared`, plain relative for the graph modules):

```js
import { createComposer } from './graph/composer.mjs';
import { thumbnailFor, mountStaticGraph } from './graph/view.mjs';
import { portsFnFor } from '../../src/shared/graph/ports.mjs';
import { indexByKey } from '../../src/shared/graph/agent-meta.mjs';
```

then, where the old composer block used to live, the new one:

```js
// ---------------------------------------------------------------------------
// Workflow Composer v2 (node graph). initComposer() mounts ONCE and re-fits on
// every re-entry; composerExit() (called by showView's leave-guard) unbinds the
// keyboard and cancels any live gesture.
// ---------------------------------------------------------------------------
let gvComposer = null;
let gvAgents = [];          // palette list  (GET /api/agents)
let gvAgentsAll = [];       // ports source  (GET /api/agents?all=1)
let gvPortsFn = portsFnFor({});

const gvApi = {
  agents: async () => { const r = await fetchAgents(); return Array.isArray(r) ? r : (r && r.agents) || []; },
  agentsAll: async () => {
    const res = await fetch('/api/agents?all=1');
    if (!res.ok) throw new Error(`agents ${res.status}`);
    const d = await safeJson(res);
    return Array.isArray(d) ? d : (d && d.agents) || [];
  },
  config: async () => { const res = await fetch('/api/config'); const d = await safeJson(res); return { models: d.models || [], efforts: d.efforts || [] }; },
  listWorkflows: async () => listWorkflows(),
  listArchived: async () => {
    try {
      const res = await fetch('/api/workflows?archived=1');
      if (!res.ok) return [];
      const d = await safeJson(res);
      return Array.isArray(d && d.workflows) ? d.workflows : [];
    } catch { return []; }
  },
  readWorkflow: async (id) => {
    const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return safeJson(res);
  },
  saveWorkflow: async (body) => {
    const res = await fetch('/api/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await safeJson(res);
    // 422 = the shared validator's issues, rendered verbatim by the dialog.
    if (!res.ok) return { ok: false, status: res.status, issues: d && (d.issues || d.errors), error: d && d.error };
    return { ok: true, workflow: (d && d.workflow) || d };
  },
  deleteWorkflow: async (id) => {
    const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { ok: res.ok };
  },
};

function gvEls() {
  const g = (id) => document.getElementById(id);
  return {
    canvas: g('gv-canvas'), chip: g('gv-chip'), head: g('gv-head'), name: g('gv-name'), dirty: g('gv-dirty'),
    errors: g('gv-errors'), newBtn: g('gv-new'), autoBtn: g('gv-autolayout'), saveBtn: g('gv-save'),
    insRail: g('gv-ins-rail'), insBody: g('gv-ins-body'), insToggle: g('gv-ins-toggle'),
    palette: g('gv-palette'), filter: g('gv-agent-filter'), savedList: g('gv-saved-list'),
    savedCount: g('gv-saved-count'), archived: g('gv-archived'), dialogHost: g('gv-dialog-host'),
  };
}

async function gvLoadAgents() {
  const els = gvEls();
  els.palette.textContent = 'Loading agents…';
  gvComposer.setReady(false);
  try {
    const [pal, all, cfg] = await Promise.all([gvApi.agents(), gvApi.agentsAll(), gvApi.config()]);
    gvAgents = pal; gvAgentsAll = all;
    gvPortsFn = portsFnFor(indexByKey(all));
    gvComposer.setModels(cfg);
    gvComposer.setAgents(indexByKey(pal));
    gvComposer.setReady(true);
    gvComposer.paintPalette();
  } catch {
    els.palette.replaceChildren();
    const row = document.createElement('div');
    row.className = 'gv-pal-err';
    row.textContent = 'Couldn’t load agents — ';
    const retry = document.createElement('button');
    retry.type = 'button'; retry.className = 'gv-retry'; retry.textContent = 'Retry';
    retry.addEventListener('click', () => { gvLoadAgents(); });
    row.appendChild(retry);
    els.palette.appendChild(row);
    gvComposer.setReady(false);          // Save stays disabled without a registry
  }
}

async function initComposer() {
  if (gvComposer) { gvComposer.resume(); await gvRefreshSaved(); gvComposer.fit(); return; }
  gvComposer = createComposer(gvEls(), {
    doc: document, api: gvApi, storage: (() => { try { return window.localStorage; } catch { return null; } })(),
    portsFn: (node) => gvPortsFn(node),
  });
  gvComposer.mount();
  gvComposer.newCanvas();
  gvComposer.hooks.onSaved = () => { gvRefreshSaved(); };
  // Renaming marks the canvas DIRTY (it is an unsaved edit) — never markSaved().
  gvEls().name.addEventListener('change', (e) => gvComposer.setName(e.target.value));
  await gvLoadAgents();
  await gvRefreshSaved();
  gvComposer.fit();
}

// Leave-guard: the composer stays MOUNTED (its DOM and undo ring survive), but
// every document-level listener is unbound and any live gesture is cancelled, so
// Delete/arrows/⌘Z can never edit the graph from another view (a PR #359 bug).
function composerExit() {
  if (gvComposer) gvComposer.suspend();
}
```

Add the pair to `composer.mjs` (splitting `mount()`'s document/window bindings out so both paths share them):

```js
  let live = false;
  function resume() {
    if (live) return;
    live = true;
    doc.addEventListener('keydown', onKeyDown);
    doc.addEventListener('keyup', onKeyUp);
    doc.addEventListener('scroll', onRefresh, { capture: true, passive: true });
    win.addEventListener('blur', onBlur);
    win.addEventListener('resize', onRefresh);
  }
  function suspend() {
    if (!live) return;
    live = false;
    cancel();
    space = false; stage.classList.remove('space');
    doc.removeEventListener('keydown', onKeyDown);
    doc.removeEventListener('keyup', onKeyUp);
    doc.removeEventListener('scroll', onRefresh, { capture: true });
    win.removeEventListener('blur', onBlur);
    win.removeEventListener('resize', onRefresh);
  }
```
`mount()` calls `resume()` instead of binding those five directly; `destroy()` calls `suspend()` first. Export `resume, suspend`.

- [ ] Step 3: Implement the saved list + Archived footer in `app.js`:

```js
async function gvRefreshSaved() {
  const els = gvEls();
  const list = await gvApi.listWorkflows();
  els.savedCount.textContent = list.length ? `· ${list.length}` : '';
  gvComposer.setSavedDomains([...new Set(list.map((w) => w.domain).filter(Boolean))]);
  els.savedList.replaceChildren();
  for (const wf of list) {
    const item = document.createElement('div');
    item.className = 'pl-item';
    item.dataset.id = wf.id;
    const row = document.createElement('div');
    row.className = 'pl-row';
    const main = document.createElement('div');
    main.className = 'pl-main';
    const name = document.createElement('div');
    name.className = 'pl-name';
    name.textContent = wf.name || wf.id;
    const meta = document.createElement('div');
    meta.className = 'pl-meta';
    meta.textContent = wf.domain || 'general';
    main.append(name, meta);
    row.appendChild(main);
    if (wf.version === 2) {
      const thumb = document.createElement('div');
      thumb.className = 'pl-thumb';
      // thumbnailFor is numbers-only markup built from the SAME geometry module.
      thumb.innerHTML = thumbnailFor(wf, gvPortsFn, { width: 240, height: 96 });
      item.appendChild(thumb);
      const open = document.createElement('button');
      open.type = 'button'; open.className = 'btn-ghost pl-open'; open.textContent = 'Open';
      open.addEventListener('click', async () => {
        const full = await gvApi.readWorkflow(wf.id);
        if (full) { gvComposer.loadTemplate(full); gvComposer.fit(); }
      });
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'pl-del'; del.textContent = '×';
      del.addEventListener('click', async () => { await gvApi.deleteWorkflow(wf.id); gvRefreshSaved(); });
      row.append(open, del);
    } else {
      const tag = document.createElement('span');
      tag.className = 'pl-legacy';
      tag.textContent = 'legacy · runnable until the graph cut-over';
      row.appendChild(tag);
    }
    item.prepend(row);
    els.savedList.appendChild(item);
  }
  await gvRefreshArchived();
}

// The Archived footer only exists once V24 (P8) archives rows: it is rendered
// when — and only when — GET /api/workflows?archived=1 returns at least one row,
// so it is invisible today and lights up after the break with no further work.
async function gvRefreshArchived() {
  const els = gvEls();
  const rows = await gvApi.listArchived();
  els.archived.replaceChildren();
  els.archived.hidden = rows.length === 0;
  if (!rows.length) return;
  const head = document.createElement('span');
  head.textContent = `Archived (${rows.length}) — v1 templates kept but not runnable. `;
  els.archived.appendChild(head);
  for (const wf of rows) {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'pl-chip'; chip.textContent = `${wf.name || wf.id} ×`;
    chip.title = 'Delete permanently';
    chip.addEventListener('click', async () => { await gvApi.deleteWorkflow(wf.id); gvRefreshArchived(); });
    els.archived.appendChild(chip);
  }
}
```

- [ ] Step 4: Re-add the router hooks in `app.js`: `if (name === 'composer') initComposer();` at `:15416`'s position (after `if (name === 'projects') loadProjectsView();`), and the leave-guard at the TOP of `showView`, next to the two existing ones (dev `app.js:15318-15325` quoted verbatim):
```js
  // Leave-guard: navigating away from the wizard while a scan is live aborts the
  // scan + resets wizard state (addresses orphaned-background-request risk).
  if (currentShownView === 'workspace-create' && name !== 'workspace-create') {
    if (state.wizard.scanId || state.wizard.abort) abortWizardScan();
    resetWizard();
  }
  // Same guard for the agent wizard: stop a live generation on the way out.
  if (currentShownView === 'agent-create' && name !== 'agent-create') {
```
Insert, immediately above the first of those:
```js
  // Same guard for the composer: unbind its keyboard and cancel any live gesture
  // so Delete/arrows/⌘Z can never edit the graph from another view.
  if (currentShownView === 'composer' && name !== 'composer') composerExit();
```
- [ ] Step 5: `node --test test/ui-composer-app.test.mjs` → `Expected: # pass 4 / # fail 0`. Then `node --test test/ui-workspace-selectors.test.mjs test/ui-agents-view.test.mjs` → green.
- [ ] Step 6: Commit — `worca: Node-graph v2 P5 — composer mounted in app.js with the saved list`.

---

### Task 17: run-setup — the v2 branch of `buildNodeConfigRows` / `buildFeedbackRows`

**Files:** modify `ui/public/app.js` (`buildNodeConfigRows` at `:2669`, `buildFeedbackRows` at `:2813`, `saveFeedback` at `:3646`); modify `test/ui-composer-app.test.mjs`.
**Interfaces:** for a `version === 2` workflow, `buildNodeConfigRows` returns the SAME row shape (`{nodeId, key, role, label, color, description, stepIndex, parallel, model, effort, fanOut, askQuestions, questionsLocked, def, override, modified}`) built from the **agent nodes in condensation-topo order** (loop wires excluded from the ranking), and `buildFeedbackRows` returns one row per **loop wire** with `{fbId: wire.id, from, to, fromLabel, toLabel, selfLoop, label, maxCycles}` read from `runConfig.wires[wireId].maxCycles` → `wire.config.maxCycles` → 3. Writes go through a new `saveWire(workflowId, wireId, maxCycles)` → `PATCH /api/config { projectDir, workflowId, wires: { [wireId]: { maxCycles } } }` (the v1 twin at `:3646` posts `feedbacks:{…}` and stays until P8).

- [ ] Step 1: Write the failing tests — append to `test/ui-composer-app.test.mjs`:

```js
test('v2 workflows produce topo-ordered node rows and loop-wire cycle rows', async () => {
  const win = await boot();
  const np = win.__np;
  const tpl = {
    id: 'wf_g2', name: 'G', version: 2, domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 600, y: 0, config: { model: 'sonnet' } },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 900, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
      { id: 'w3', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_plan', port: 'revise' }, config: { maxCycles: 2 } },
      { id: 'w4', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
  const reg = { planner: { displayName: 'Plan', color: 'violet', fanOut: true, asksQuestions: true },
    reviewer: { displayName: 'Review', color: 'blue', asksQuestions: true } };
  const rows = np.buildNodeConfigRows(tpl, reg, { nodes: { n_rev: { effort: 'high' } }, wires: {} });
  assert.deepEqual(rows.map((r) => r.nodeId), ['n_plan', 'n_rev'], 'agent nodes only, topo order, loop wire ignored');
  assert.equal(rows[0].label, 'Plan');
  assert.equal(rows[1].effort, 'high', 'per-project override wins');
  assert.equal(rows[1].model, 'sonnet', 'template node.config is layer 2');
  assert.deepEqual(rows[1].override, { effort: 'high' });
  const fbs = np.buildFeedbackRows(tpl, reg, { nodes: {}, wires: { w3: { maxCycles: 5 } } });
  assert.equal(fbs.length, 1, 'one row per LOOP wire');
  assert.equal(fbs[0].fbId, 'w3');
  assert.equal(fbs[0].maxCycles, 5, 'run-config overlay wins over wire.config');
  assert.equal(fbs[0].label, 'Plan ← Review');
  const fbs2 = np.buildFeedbackRows(tpl, reg, { nodes: {}, wires: {} });
  assert.equal(fbs2[0].maxCycles, 2, 'falls back to wire.config.maxCycles');
});

test('a v1 workflow still produces v1 rows (no regression)', async () => {
  const win = await boot();
  const np = win.__np;
  const rows = np.buildNodeConfigRows(V1_ROW, { planner: { displayName: 'Plan' } }, { nodes: {} });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nodeId, 's0_0');
  assert.deepEqual(np.buildFeedbackRows(V1_ROW, {}, { feedbacks: {} }), []);
});
```

`Expected: FAIL — AssertionError: Expected values to be strictly deep-equal: [] !== ['n_plan','n_rev']` (the v1 branch returns zero rows for a v2 template).

- [ ] Step 2: Implement in `app.js` — add `import { classifyLoops } from '../../src/shared/graph/loops.mjs';`, then branch both builders:

```js
function buildNodeConfigRows(workflow, registry, runConfig, opts = {}) {
  if (workflow && workflow.version === 2) return buildGraphNodeRows(workflow, registry, runConfig);
  const steps = Array.isArray(workflow && workflow.steps) ? workflow.steps : [];
  // ... existing v1 body unchanged ...
}

// v2: agent nodes only, in condensation-topo launch order (loop wires excluded
// from the ranking, exactly as the scheduler orders launches). The four config
// layers are the same as v1: run-config nodes[nodeId] -> template node.config ->
// sidecar -> hard default.
function buildGraphNodeRows(tpl, registry, runConfig) {
  const reg = registry || {};
  const nodes = (runConfig && runConfig.nodes) || {};
  const order = classifyLoops(tpl, gvPortsFn).launchOrder;
  const byId = new Map(tpl.nodes.map((n) => [n.id, n]));
  const rank = new Map(order.map((id, i) => [id, i]));
  const agentNodes = order.map((id) => byId.get(id)).filter((n) => n && n.kind === 'agent');
  const rows = [];
  for (const node of agentNodes) {
    const meta = reg[node.key] || null;
    const saved = { ...nodes[node.id] };
    const wfDef = (node.config && typeof node.config === 'object') ? node.config : {};
    const metaFan = meta && typeof meta.fanOut === 'boolean' ? meta.fanOut : false;
    const metaAsks = !!(meta && meta.asksQuestions);
    const metaLocked = !!(meta && meta.questionsLocked);
    const metaQDefault = !!(meta && meta.questionsDefault);
    const override = {};
    if (typeof saved.model === 'string' && saved.model) override.model = saved.model;
    if (typeof saved.effort === 'string' && saved.effort) override.effort = saved.effort;
    if (typeof saved.fanOut === 'boolean') override.fanOut = saved.fanOut;
    if (typeof saved.askQuestions === 'boolean') override.askQuestions = saved.askQuestions;
    const def = {
      model: typeof wfDef.model === 'string' ? wfDef.model : '',
      effort: typeof wfDef.model === 'string' && typeof wfDef.effort === 'string' ? wfDef.effort : '',
      fanOut: typeof wfDef.fanOut === 'boolean' ? wfDef.fanOut : metaFan,
      askQuestions: typeof wfDef.askQuestions === 'boolean' ? wfDef.askQuestions : metaQDefault,
    };
    const model = override.model !== undefined ? override.model : def.model;
    const effort = override.effort !== undefined ? override.effort : (override.model !== undefined ? '' : def.effort);
    const fanOut = override.fanOut !== undefined ? override.fanOut : def.fanOut;
    const askQuestions = override.askQuestions !== undefined ? override.askQuestions : def.askQuestions;
    rows.push({
      nodeId: node.id, key: node.key, role: null,
      label: (meta && meta.displayName) || node.key || node.id,
      color: (meta && meta.color) || '', description: (meta && meta.description) || '',
      stepIndex: rank.get(node.id) || 0,
      parallel: false,
      model, effort, fanOut,
      askQuestions: !metaAsks ? null : (metaLocked ? metaQDefault : askQuestions),
      questionsLocked: metaAsks && metaLocked,
      def, override,
      modified: modifiedFieldsOf({ model, effort, fanOut, askQuestions }, def,
        { asksQuestions: metaAsks, questionsLocked: metaLocked }).length > 0,
    });
  }
  return rows;
}

function buildFeedbackRows(workflow, registry, runConfig) {
  if (workflow && workflow.version === 2) return buildGraphWireRows(workflow, registry, runConfig);
  const steps = Array.isArray(workflow && workflow.steps) ? workflow.steps : [];
  // ... existing v1 body unchanged ...
}

// v2: one row per LOOP wire (a plain wire has no budget — V13). Labels reuse the
// v1 vocabulary: "<toName> ← <fromName>", "(step N)" only when a name repeats.
function buildGraphWireRows(tpl, registry, runConfig) {
  const reg = registry || {};
  const saved = (runConfig && runConfig.wires) || {};
  const { loopWireIds, launchOrder } = classifyLoops(tpl, gvPortsFn);
  const byId = new Map(tpl.nodes.map((n) => [n.id, n]));
  const rank = new Map(launchOrder.map((id, i) => [id, i]));
  const nameCount = new Map();
  const nameOf = (id) => {
    const n = byId.get(id);
    if (!n) return id;
    const meta = n.kind === 'agent' ? reg[n.key] : null;
    return (meta && meta.displayName) || n.key || n.id;
  };
  for (const n of tpl.nodes) nameCount.set(nameOf(n.id), (nameCount.get(nameOf(n.id)) || 0) + 1);
  const labelFor = (id) => {
    const nm = nameOf(id);
    return (nameCount.get(nm) || 0) > 1 ? `${nm} (step ${(rank.get(id) || 0) + 1})` : nm;
  };
  return tpl.wires.filter((w) => loopWireIds.has(w.id)).map((w) => {
    const rc = saved[w.id] || {};
    const n = Number(rc.maxCycles);
    const cfg = Number(w.config && w.config.maxCycles);
    const fromLabel = labelFor(w.from.node);
    const toLabel = labelFor(w.to.node);
    const selfLoop = w.from.node === w.to.node;
    return {
      fbId: w.id, from: w.from.node, to: w.to.node, fromLabel, toLabel, selfLoop,
      label: selfLoop ? `${toLabel} ↺ (self loop)` : `${toLabel} ← ${fromLabel}`,
      maxCycles: Number.isFinite(n) && n >= 1 ? n : (Number.isFinite(cfg) && cfg >= 1 ? cfg : 3),
    };
  });
}
```

- [ ] Step 3: Add the writer next to `saveFeedback` (`app.js:3646`), and route the cycle input to it for v2 workflows (the renderer calls `saveFeedback` today; pass the workflow version through and pick the writer):
```js
// Persist one loop wire's cycle budget: PATCH /api/config
// { projectDir, workflowId, wires:{ [wireId]:{maxCycles} } }.
async function saveWire(workflowId, wireId, maxCycles) {
  const projectDir = selectedProjectPath();
  if (!projectDir) return;
  try {
    const res = await fetch('/api/config', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir, workflowId, wires: { [wireId]: { maxCycles } } }),
    });
    const data = await safeJson(res);
    if (!res.ok) { appendLog({ source: 'ui', level: 'error', text: `config: ${data.error || res.status}`, ts: Date.now() }); return; }
    if (data.config) state.config = data.config;
  } catch (e) {
    appendLog({ source: 'ui', level: 'error', text: `config error: ${e.message}`, ts: Date.now() });
  }
}
```
- [ ] Step 4: The workflow picker's read-only mini-graph: where the picker paints the selected workflow's preview, branch on `version === 2` and call `mountStaticGraph(previewHost, wf, { doc: document, portsFn: gvPortsFn, agents: indexByKey(gvAgentsAll), width: previewHost.clientWidth })`; v1 rows keep today's preview. `mountStaticGraph` binds NO listeners, so the picker row's own click still opens it. "Default (graph)" (`wf_default_v2`) arrives from `GET /api/workflows` with `version: 2` and needs no special case.
- [ ] Step 5: Expose the two builders for the tests: they are already on `window.__np` (`app.js:2878-2925`) — confirm `buildNodeConfigRows` and `buildFeedbackRows` are in that object; add them if not.
- [ ] Step 6: `node --test test/ui-composer-app.test.mjs` → `Expected: # pass 6 / # fail 0`; `node --test test/ui-new-pipeline*.test.mjs` (whatever exists) → green.
- [ ] Step 7: Commit — `worca: Node-graph v2 P5 — run-setup rows for v2 graphs and per-wire budgets`.

---

### Task 18: `scripts/verify-composer-cdp.mjs` — the headless-Chrome proof

**Files:** create `scripts/verify-composer-cdp.mjs`.
**Interfaces:** a standalone Node script (**NEVER part of `npm test`** — it needs Chrome and a live server). It boots the app server on a free port with `WORCA_HOME` in a temp dir, drives Chrome over CDP with the native `WebSocket`, and prints one `PASS`/`FAIL` line per check plus a JSON summary.

> **Harness caveat (binding, from the 2026-08-26 prototype run):** `--headless=new` emits BeginFrames only on demand and, late in a session, stops emitting them spontaneously — a queued `requestAnimationFrame` never runs and every rAF-based assertion hangs or reads stale state. Forcing paint damage does NOT help. The working recipe: arm a marker rAF, then call `Page.captureScreenshot` repeatedly until the marker fires (41 of 43 settles needed exactly one forced frame). Forced frames cannot inflate the frame counter — `frame()` clears `raf` and is re-armed only by the next `pointermove` — so the "Δframes === 1" coalescing numbers stand.
>
> **Selector scoping (binding):** the app renders several `.gv-world`s (composer, Running list cards, detail pages). Every selector MUST be scoped to `#gv-canvas` — e.g. `document.querySelector('#gv-canvas .gv-world')` — never a bare `.gv-world`.

- [ ] Step 1: Expose the probe seam. In `app.js`'s composer section add, next to the other `window.__np` hooks:
```js
  if (typeof window !== 'undefined') window.__gv = () => (gvComposer ? { c: gvComposer, v: gvComposer.view } : null);
```
This is the only production change the script needs; it exposes no mutator the UI does not already own.

- [ ] Step 2: Write `scripts/verify-composer-cdp.mjs`:

```js
#!/usr/bin/env node
// scripts/verify-composer-cdp.mjs — headless-Chrome proof of the composer's
// pointer pipeline (spec §7.11 (1)-(9)). NOT part of `npm test`: it needs Chrome
// and a live server. Run: node scripts/verify-composer-cdp.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_PORT || 9333);
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let profile = null; let failed = 0;
async function shutdown(code) {
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}          // kill Chrome on EVERY exit path
  try { if (srv) await new Promise((r) => srv.close(r)); } catch {}
  try { if (home) await rm(home, { recursive: true, force: true }); } catch {}
  try { if (profile) await rm(profile, { recursive: true, force: true }); } catch {}
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}

// ---- app server on an ephemeral port (the house pattern: env BEFORE the import)
home = await mkdtemp(path.join(tmpdir(), 'worca-cdp-'));
process.env.WORCA_HOME = home;
process.env.WORCA_MOCK = '1';
const { app } = await import(new URL('../ui/server.mjs', import.meta.url).href);
srv = http.createServer(app);
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
log(`server ${base}`);

// ---- chrome + cdp
profile = await mkdtemp(path.join(tmpdir(), 'worca-cdp-profile-'));
chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,900', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'],
{ stdio: ['ignore', 'pipe', 'pipe'] });
chrome.stderr.on('data', () => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl; else await sleep(200);
  } catch { await sleep(250); }
}
if (!wsUrl) { console.error('no devtools target'); await shutdown(1); }
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map(); const listeners = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id != null) { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)); return; }
  for (const l of [...listeners]) l(m);
};
function cdp(method, params = {}, ms = 15000) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT ${method}`)); }, ms);
    pending.set(id, { res: (v) => { clearTimeout(to); res(v); }, rej: (er) => { clearTimeout(to); rej(er); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const waitEvent = (name, ms = 15000) => new Promise((res, rej) => {
  const to = setTimeout(() => { off(); rej(new Error(`timeout ${name}`)); }, ms);
  const l = (m) => { if (m.method === name) { clearTimeout(to); off(); res(m.params); } };
  const off = () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
  listeners.push(l);
});
const errors = [];
listeners.push((m) => {
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args || []).map((a) => a.value || a.description).join(' '));
});
await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');

async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`EVAL: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n${expr}`);
  return r.result.value;
}
// Headless Chrome does not tick rAF on its own: arm a marker and force frames.
const kick = () => cdp('Page.captureScreenshot', { format: 'jpeg', quality: 1, clip: { x: 0, y: 0, width: 16, height: 16, scale: 1 } }, 15000).catch(() => null);
async function settle(tag = '') {
  await ev('window.__rafHit=0;requestAnimationFrame(()=>{window.__rafHit=1;});0');
  for (let i = 0; i < 10; i += 1) { if (await ev('window.__rafHit')) return; await kick(); }
  throw new Error(`no animation frame after 10 forced frames (${tag})`);
}
const press = (x, y, button = 'left') => cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'middle' ? 4 : 1, clickCount: 1 });
const mmove = (x, y, buttons = 1, button = 'left') => cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button, buttons, clickCount: 0 });
const mup = (x, y, button = 'left') => cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 });
const wheel = (x, y, dx, dy, modifiers = 0) => cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy, modifiers, button: 'none' });
const keyEv = (type, k, code, vk) => cdp('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(k === ' ' ? { text: ' ' } : {}) });
function check(n, what, ok, detail) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} (${n}) ${what}${ok ? '' : `\n      ${JSON.stringify(detail)}`}`);
}
```

Continue the same script — the nine checks (every selector scoped to `#gv-canvas`):

```js
async function load(first = false) {
  if (first) await cdp('Page.navigate', { url: `${base}/#composer` }); else await cdp('Page.reload', {});
  await waitEvent('Page.loadEventFired');
  for (let i = 0; i < 60; i += 1) { if (await ev('!!(window.__gv && window.__gv())')) break; await sleep(100); }
  if (!await ev('!!(window.__gv && window.__gv())')) throw new Error('composer never mounted');
  // seed a deterministic 3-card graph through the public editor API
  await ev(`(()=>{const {c}=window.__gv();c.loadTemplate({id:'',name:'probe',version:2,domain:'coding',
    nodes:[{id:'n_task',kind:'task',x:60,y:143,config:{}},{id:'n_agent',kind:'agent',key:${JSON.stringify(process.env.PROBE_AGENT || 'planner')},x:400,y:80,config:{}},{id:'n_end',kind:'end',x:760,y:143,config:{}}],
    wires:[{id:'w1',from:{node:'n_task',port:'task'},to:{node:'n_agent',port:'task'}}]});c.fit();return 1;})()`);
  await settle('post-load');
}
const clientOfAnchor = (id, port, dir) => ev(`(()=>{const {c,v}=window.__gv();const n=c.template().nodes.find(n=>n.id===${JSON.stringify(id)});
  const a=v.anchor(n,${JSON.stringify(port)},${JSON.stringify(dir)});const s=v.toScreen(a.x,a.y);const r=v.rect();return {x:s.x+r.left,y:s.y+r.top};})()`);

try {
  await load(true);

  // (7) every node's nodeSize box maps inside the stage rect after auto-fit
  const fitR = await ev(`(()=>{const {c,v}=window.__gv();const r=v.rect();let ok=true;const out=[];
    for(const n of c.template().nodes){const s=v.size(n);for(const [dx,dy] of [[0,0],[s.w,0],[0,s.h],[s.w,s.h]]){const p=v.toScreen(n.x+dx,n.y+dy);
      const inside=p.x>=0&&p.x<=r.width&&p.y>=0&&p.y<=r.height;if(!inside)ok=false;out.push([n.id,+p.x.toFixed(1),+p.y.toFixed(1),inside]);}}
    return {ok,z:v.getTransform().z,worlds:document.querySelectorAll('#gv-canvas .gv-world').length,out};})()`);
  check(7, 'auto-fit keeps every node box inside the stage and z ≤ 1', fitR.ok && fitR.z <= 1 && fitR.worlds === 1, fitR);

  // (3) ghost fill:none at rest
  const fillRest = await ev(`getComputedStyle(document.querySelector('#gv-canvas .gv-wires path.ghost')).fill`);
  check('3a', 'getComputedStyle(ghost).fill === "none" at rest', fillRest === 'none', { fillRest });

  // (1)+(2) 60-move burst: Δframes 1, Δghost ≤ 1, ΔrectReads 0
  const plan = await clientOfAnchor('n_agent', 'plan', 'out');
  await press(plan.x, plan.y); await settle('press');
  await ev(`(()=>{const {c,v}=window.__gv();const st=v.stage;window.__s0={f:c.stats.frames,g:v.stats.ghostUpdates,r:c.stats.rectReads};
    window.__gb=0;window.__oGB=Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect=function(){window.__gb++;return window.__oGB.apply(this,arguments);};
    for(let i=0;i<60;i++)st.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:${Math.round(plan.x)}-i,clientY:${Math.round(plan.y)}+(i%7),bubbles:true}));
    window.__rafHit=0;requestAnimationFrame(()=>{window.__rafHit=1;});return 1;})()`);
  for (let i = 0; i < 10 && !(await ev('window.__rafHit')); i += 1) await kick();
  const burst = await ev(`(()=>{const {c,v}=window.__gv();Element.prototype.getBoundingClientRect=window.__oGB;
    return {df:c.stats.frames-window.__s0.f,dg:v.stats.ghostUpdates-window.__s0.g,dr:c.stats.rectReads-window.__s0.r,gb:window.__gb,
      fill:getComputedStyle(v.ghostEl).fill,cls:v.ghostEl.getAttribute('class')};})()`);
  check(1, '60 pointermoves ⇒ Δframes === 1 and ΔghostUpdates ≤ 1', burst.df === 1 && burst.dg <= 1, burst);
  check(2, 'zero getBoundingClientRect calls during the burst', burst.dr === 0 && burst.gb === 0, burst);
  check('3b', 'getComputedStyle(ghost).fill === "none" mid-drag', burst.fill === 'none', burst);
  await mup(plan.x - 59, plan.y + 3); await settle('up');

  // (5) mirrored tangent from an INPUT port
  await load();
  const fix = await clientOfAnchor('n_agent', 'task', 'in');
  await press(fix.x, fix.y); await settle('press-in');
  await mmove(fix.x - 120, fix.y); await settle('move-left');
  const mir = await ev(`(()=>{const {v}=window.__gv();const d=v.ghostEl.getAttribute('d');const n=(d.match(/-?\\d+(?:\\.\\d+)?/g)||[]).map(Number);
    return {d,ax:n[0],c1x:n[2]};})()`);
  check(5, 'a drag from an input mirrors the tangent (first control x < anchor x)', mir.c1x < mir.ax, mir);
  await keyEv('rawKeyDown', 'Escape', 'Escape', 27); await keyEv('keyUp', 'Escape', 'Escape', 27); await settle('esc');

  // (6) zoom about the cursor + plain-wheel pan
  await load();
  const z0 = await ev(`(()=>{const {c,v}=window.__gv();const r=v.rect();return {w:c._internal.toWorld(r.left+600,r.top+300),T:v.getTransform(),r};})()`);
  await wheel(z0.r.left + 600, z0.r.top + 300, 0, -120, 2); await settle('zoom');
  const z1 = await ev(`(()=>{const {c,v}=window.__gv();const r=v.rect();return {w:c._internal.toWorld(r.left+600,r.top+300),T:v.getTransform()};})()`);
  for (let i = 0; i < 14; i += 1) await wheel(z0.r.left + 600, z0.r.top + 300, 0, -240, 2);
  await settle('zmax');
  const zMax = await ev('window.__gv().v.getTransform().z');
  for (let i = 0; i < 32; i += 1) await wheel(z0.r.left + 600, z0.r.top + 300, 0, 240, 2);
  await settle('zmin');
  const zMin = await ev('window.__gv().v.getTransform().z');
  await ev('window.__gv().v.setTransform({x:0,y:0,z:1})');
  await wheel(z0.r.left + 600, z0.r.top + 300, 40, -25, 0); await settle('pan');
  const pan = await ev('window.__gv().v.getTransform()');
  check(6, 'ctrl+wheel keeps the world point under the cursor; clamps 0.4..1.6; plain wheel pans by −delta',
    Math.abs(z1.w.x - z0.w.x) < 1e-6 && Math.abs(z1.w.y - z0.w.y) < 1e-6
    && zMax <= 1.6 + 1e-12 && zMin >= 0.4 - 1e-12 && Math.abs(pan.x + 40) < 1e-9 && Math.abs(pan.y - 25) < 1e-9,
    { z0: z0.w, z1: z1.w, zMax, zMin, pan });

  // (4) header buttons still click after a canvas drag; cross-release never clicks
  await load();
  const saveBox = await ev(`(()=>{const b=document.getElementById('gv-save').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};})()`);
  const empty = await ev(`(()=>{const r=window.__gv().v.rect();return {x:r.left+120,y:r.top+r.height-60};})()`);
  await ev('window.__clicks=0;document.getElementById("gv-autolayout").addEventListener("click",()=>{window.__clicks++;});0');
  await press(empty.x, empty.y); await settle('e1'); await mmove(empty.x + 60, empty.y - 30); await settle('e2'); await mup(empty.x + 60, empty.y - 30); await settle('e3');
  const alBox = await ev(`(()=>{const b=document.getElementById('gv-autolayout').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};})()`);
  await press(alBox.x, alBox.y); await mup(alBox.x, alBox.y); await settle('e4');
  const c1 = await ev('window.__clicks');
  await press(empty.x, empty.y); await settle('e5'); await mmove(alBox.x, alBox.y); await settle('e6'); await mup(alBox.x, alBox.y); await settle('e7');
  const c2 = await ev('({clicks:window.__clicks,gesture:window.__gv().c.gesture()})');
  check(4, 'a real header click fires after a canvas drag; press-on-canvas → release-over-button does not',
    c1 === 1 && c2.clicks === 1 && c2.gesture === null, { c1, c2, saveBox });

  // (8) node drag: incident wires only, 11px snap, Escape reverts
  await load();
  const head = await ev(`(()=>{const {v}=window.__gv();const s=v.toScreen(500,95);const r=v.rect();return {x:s.x+r.left,y:s.y+r.top};})()`);
  const d0 = await ev(`(()=>{const o={};for(const p of document.querySelectorAll('#gv-canvas .gv-wires path[data-wire-id]'))o[p.dataset.wireId]=p.getAttribute('d');
    return {d:o,pos:window.__gv().c.template().nodes[1].x};})()`);
  await press(head.x, head.y); await settle('n1');
  await mmove(head.x + 93, head.y + 62); await settle('n2');
  const drag = await ev(`(()=>{const o={};for(const p of document.querySelectorAll('#gv-canvas .gv-wires path[data-wire-id]'))o[p.dataset.wireId]=p.getAttribute('d');
    const el=document.querySelector('#gv-canvas [data-node-id="n_agent"]');const n=(el.style.transform.match(/-?\\d+(?:\\.\\d+)?/g)||[]).map(Number);return {d:o,tf:n};})()`);
  await keyEv('rawKeyDown', 'Escape', 'Escape', 27); await keyEv('keyUp', 'Escape', 'Escape', 27); await settle('n3');
  const esc = await ev(`(()=>{const o={};for(const p of document.querySelectorAll('#gv-canvas .gv-wires path[data-wire-id]'))o[p.dataset.wireId]=p.getAttribute('d');
    return {d:o,pos:window.__gv().c.template().nodes[1].x,gesture:window.__gv().c.gesture()};})()`);
  await mup(head.x + 93, head.y + 62);
  check(8, 'node drag snaps to 11px, repaints only incident wires, Escape reverts',
    drag.tf.length === 2 && drag.tf.every((v) => v % 11 === 0)
    && JSON.stringify(esc.d) === JSON.stringify(d0.d) && esc.pos === d0.pos && esc.gesture === null,
    { tf: drag.tf, reverted: JSON.stringify(esc.d) === JSON.stringify(d0.d) });

  // (9) middle-drag / space+drag pan; window blur ends a gesture
  await load();
  const t0 = await ev('window.__gv().v.getTransform()');
  const e2 = await ev(`(()=>{const r=window.__gv().v.rect();return {x:r.left+150,y:r.top+r.height-70};})()`);
  await press(e2.x, e2.y, 'middle'); await settle('m1');
  await mmove(e2.x + 55, e2.y - 35, 4, 'middle'); await settle('m2');
  const tMid = await ev('window.__gv().v.getTransform()');
  await mup(e2.x + 55, e2.y - 35, 'middle'); await settle('m3');
  await keyEv('rawKeyDown', ' ', 'Space', 32);
  const t1 = await ev('window.__gv().v.getTransform()');
  await press(head.x, head.y); await settle('s1');
  await mmove(head.x - 40, head.y + 25); await settle('s2');
  const t2 = await ev('window.__gv().v.getTransform()');
  await mup(head.x - 40, head.y + 25); await settle('s3');
  await keyEv('keyUp', ' ', 'Space', 32);
  await press(e2.x, e2.y); await settle('b1');
  const blur = await ev(`(()=>{window.dispatchEvent(new Event('blur'));const {c,v}=window.__gv();return {g:c.gesture(),cls:v.ghostEl.getAttribute('class')};})()`);
  await mup(e2.x, e2.y);
  check(9, 'middle-drag and space+drag pan by the exact delta; blur ends the gesture',
    Math.abs(tMid.x - t0.x - 55) < 1e-9 && Math.abs(tMid.y - t0.y + 35) < 1e-9
    && Math.abs(t2.x - t1.x + 40) < 1e-9 && Math.abs(t2.y - t1.y - 25) < 1e-9
    && blur.g === null && blur.cls === 'wire ghost',
    { t0, tMid, t1, t2, blur });

  check('console', 'no page errors or exceptions', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  failed += 1;
  console.log(`FAIL (fatal) ${e && e.stack ? e.stack : e}`);
}
console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`} — ${((Date.now() - T0) / 1000).toFixed(1)}s`);
await shutdown(failed === 0 ? 0 : 1);
```

- [ ] Step 3: `grep -n "verify-composer-cdp" package.json` → MUST print nothing. The script is never wired into `npm test`; add it only as an optional `"verify:composer": "node scripts/verify-composer-cdp.mjs"` script if the repo's `scripts` block already carries similar manual entries (`grep -n '"smoke:workspace"' package.json`).
- [ ] Step 4: Run it by hand: `node scripts/verify-composer-cdp.mjs`. Expect nine `PASS` lines plus `PASS (console)` and `ALL CHECKS PASSED`. If a `no animation frame after 10 forced frames` error appears, the settle recipe regressed — do NOT weaken the assertion; re-check that `settle()` arms the marker BEFORE forcing frames.
- [ ] Step 5: Commit — `worca: Node-graph v2 P5 — headless-Chrome verification script` (paste the run's PASS lines into the commit body).

---

### Task 19: P5b green — full suite, manual checklist, handoff

- [ ] Step 1: `npm test 2>&1 | tail -5`. **Expected: BASELINE-B2 + 31 new tests**, 0 failures — 4 (`test/ui-composer-shell.test.mjs`) + 21 (`test/ui-composer-editor.test.mjs`: 4 + 4 + 3 + 3 + 4 + 3) + 6 (`test/ui-composer-app.test.mjs`: 4 + 2). BASELINE-B2 is the number Task 8 Step 7 printed (it already accounts for the retired v1 suites and the one deleted `ui-agents-view` block).
- [ ] Step 2: Guard greps — all must print nothing:
  ```sh
  grep -rn "composer-core\|EMBEDDED_AGENTS" ui/ src/ test/ scripts/ | grep -v "log-line.mjs"
  grep -rn "document.addEventListener('pointermove'\|document.addEventListener('pointerup'" ui/public/graph/
  grep -rn "getBoundingClientRect" ui/public/graph/composer.mjs | grep -v "readRect"
  grep -n "gv-zoom\|zoom-in\|zoom-fit\|gv-legend" ui/public/index.html | grep -v "gv-legend"
  ```
  (The last one proves D2: no on-canvas controls. `#gv-legend` lives in the AGENTS card header row, not on the canvas — that hit is expected and is why it is filtered.)
- [ ] Step 3: **Manual CDP verification** — run by hand, not in `npm test`:
  ```sh
  node scripts/verify-composer-cdp.mjs
  ```
  Checklist (all must print `PASS`): (1) 60-move burst ⇒ Δframes 1, Δghost ≤ 1 · (2) zero rect reads during the burst · (3a/3b) ghost `fill:none` at rest and mid-drag · (4) header button clicks after a canvas drag; cross-release does not click · (5) mirrored tangent from an input port · (6) zoom about the cursor invariant + clamps + plain-wheel pan · (7) auto-fit keeps every node box inside the stage, z ≤ 1 · (8) node drag snaps to 11px, repaints only incident wires, Escape reverts · (9) middle/space pan and blur-cancel · (console) no page errors. **Paste the PASS lines into the commit body.**
- [ ] Step 4: Manual smoke in a real browser (`npm start`, open `#composer`): drag a card — the wire follows without a lag or a flicker; drag from an input dot leftwards — the cord leaves LEFT and is never a filled blob; hover a wired input — red cord + `already connected`; click Save and Auto-layout right after a canvas drag — both fire; wheel over the canvas — the page never scrolls; ⌘+wheel — zoom stays under the cursor; leave to Running and press Backspace — the graph is untouched.
- [ ] Step 5: Commit — `worca: Node-graph v2 P5 — P5b composer v2 complete` (with the CDP PASS lines in the body).
- [ ] Step 6: **Handoff.** P5 is complete. Sentinels for P6: `grep -q "export function createGraphView" ui/public/graph/view.mjs` and `grep -q 'class="gv-head"' ui/public/index.html`. P6 consumes `createGraphView(host, {mode:'monitor'|'static', portsFn, agents, raf, viewport, zoomMin, zoomMax, wheelPan})`, the fast paths `setStatus`/`setFooter(nodeId, bands)`/`setNodeChrome`/`setWireBadge`/`setWireLive`/`moveNode`/`setTransform({x,y,z})`/`fit`/`fitToWidth`/`centerOn` plus `nodeEl(id)`/`wireEl(id)` (the view has NO `applyDecor` — P6's `run-decor.mjs` owns that pass), `view.createNav({wheelPan:'engaged', onEngaged})` for the detail pages (the view never auto-binds a nav), and `mountStaticGraph(host, tpl, …)` + `thumbnailFor(tpl, portsFn, …)` for the Running list card. Cards carry `data-node-id`, wire paths `data-wire-id`, loop badges `.wbadge[data-wire-id]`. Plan path: `/Users/denislavprinov/Develop/worca-cc/docs/superpowers/plans/2026-08-26-node-graph-v2-P5-composer-v2.md`.

## Clarifications (Q&A)

- **D1** — How does this land? → **One plan on top of dev, executed as two independently-green halves (P5a renderer / P5b editor); each half ends with a full-suite run and a commit (user decision 2026-08-26).**
- **D2** — Canvas navigation? → **NO on-canvas controls of any kind. Wheel/trackpad pans; ⌘/Ctrl+wheel and pinch zoom 0.4–1.6 about the cursor; space-drag / middle-drag / empty-canvas drag pan; auto-fit (capped at 1×) on entry and on template load only. Auto-layout and Save live in the header bar (user decision 2026-08-26).**
- **D3** — Composer layout? → **Header bar → constant-height canvas with a floating, collapsible inspector over its right edge → always-expanded AGENTS card below (domain chips, filter, pills, pinned Flow group, legend row) → saved pipelines with thumbnails (user decision 2026-08-26).**
- **D4** — Wire shape? → **Cubic bezier with horizontal tangents; loop wires bow below; the ghost is the same curve from the port anchor to the cursor, MIRRORED when the drag starts on an input, rAF-throttled, in world space (user decision 2026-08-26).**
- **D8** — Does the executions footer re-route wires? → **No. The footer is the bottom-most box, anchors are top-relative, and the card simply grows via `view.setFooter` (user decision 2026-08-26, adjudication adj-c §5).**
- **V7** — What happens on a drop onto an already-wired input? → **Rejected with the reason chip `already connected`; every input in the graph takes exactly one wire (base spec Amendment f).**
- **V12** — Arity floor? → **2 for AND/OR/Combine; the stepper clamps anything lower back to 2 (base spec Amendment f).**
- **V13** — Can a plain wire carry `maxCycles`? → **No — the inspector renders the budget control for LOOP wires only (base spec §2).**
- **Q1** — Where does the composer get agent ports? → **`GET /api/agents` for the palette and `GET /api/agents?all=1` for `portsFn`; no embedded table. `EMBEDDED_AGENTS` and `connects-to.test.mjs` are deleted here (rebuild spec §3).**
- **Q2** — `hostEls`/`api` shape for `createComposer`? → **`createComposer(hostEls, {doc, api, raf, viewport, storage, portsFn})` with the 18 host elements and the 8 `api` methods listed in Task 10 (planner default — the spec fixes only the module path and the export name).**
- **Q3** — Storage key for the inspector rail? → **`worca.composer.inspector` (the rebuild spec's key; the old branch's `worca-cc.composer.inspector` is NOT reused — the product is "worca").**
- **Q4** — Where does the `wheelPan` flag live? → **On the nav controller: `createGraphView(host, {wheelPan})` sets the default and `view.createNav({wheelPan})` overrides it per host; the composer never calls `createNav` (it binds its own richer pipeline) and behaves as `'always'` (rebuild spec §7.8; placement is a planner default).**
- **Q5** — Does the view own the stage element? → **Yes. `createGraphView` creates `.gv-stage` and PREPENDS it into the host, never `replaceChildren`, so `.gv-chip` and `.gv-ins-rail` survive as its siblings (planner default; the spec fixes the DOM shape, not who builds it).**
- **Q6** — Does `render` accept a `decor` bag? → **No. The view exposes the run-mode fast paths — `setStatus`, `setFooter(nodeId, bands)` (band vocabulary `fan | strip | exec | result`), `setNodeChrome`, `setWireBadge`, `setWireLive` — and P6's `run-decor.mjs` `applyDecor(view, decor)` is the ONE decor pass, run after every `render` (agent adjudication, cross-plan pass 2026-08-27: the view owns every card byte, P6 owns the decor reducer, no plan rewrites another's function body).**
- **Q7** — Archived footer now or after P8? → **Ship it now, rendered ONLY when `GET /api/workflows?archived=1` returns ≥ 1 row. Today it is invisible; after V24 it lights up with no further work (planner default; the rebuild spec §7.1 says "after P8").**
- **Q8** — Can the v1 composer block be deleted wholesale? → **No. `composerPaintWires` and `COMPOSER_COLORS/TINTS/SEQ` are shared with the v1 RUN graph (`app.js:1205`, `:2919`, `test/ui-run-graph-paint.test.mjs:109`) and the unscoped `.node` CSS rule (`style.css:1094-1121`) is inherited by `.run-flow .node`. P5 keeps them (re-homed and re-scoped); P8 kills them with the v1 engine (verified on dev 2026-08-26).**
- **Q9** — What replaces `EMBEDDED_AGENTS` for the v1 run graph's icons? → **An `agentMetaCache` filled on demand by `ensureAgentMeta()` from `GET /api/agents`, invalidated by `invalidateAgentCaches()` (planner default; the spec only mandates the deletion).**
- **Q10** — `PATCH /api/config` body for a loop wire's budget? → **`{ projectDir, workflowId, wires: { [wireId]: { maxCycles } } }`, mirroring today's `feedbacks` writer at `app.js:3646` (rebuild spec §4).**
- **Q11** — Does the view use `graphBounds`/`fitBounds` from the shared geometry module? → **Yes: `bounds()` delegates to `graphBounds(current, portsAt, {pad, footerRowsOf})` (the view supplies its footer rows through that hook) and `fit`/`fitToWidth` map `fitBounds`'s `{z, tx, ty}` onto the view transform with the inspector inset applied to the viewport width and `zoomMax: 1`; P6's run-hosts use the same two functions — one source of truth (agent adjudication, cross-plan pass 2026-08-27).**
- **Q13** — Who reports nav engagement to a host? → **`view.createNav({wheelPan, onEngaged})` calls `onEngaged(true|false)` on every change; a monitor host toggles its `rg-engaged` class from it and keeps no engagement state of its own (agent adjudication, cross-plan pass 2026-08-27).**
- **Q12** — What does the leave-guard do? → **`composerExit()` calls `composer.suspend()`: it cancels any live gesture and unbinds the document/window listeners, but the editor stays mounted so its DOM, transform and undo ring survive; re-entry calls `resume()` + `fit()` (rebuild spec §7.1 "mount-once + fit() on re-entry").**

## Known issues (Session A, 2026-08-27 — resolve during this plan's refinement, before execution)

Findings recorded while refining P1/P2 and adjudicating the cross-plan contracts. The refinement reports live (untracked) in `docs/superpowers/plans/2026-08-26-node-graph-v2-reports/`; `xplan-manifest.md` §A is the canonical contract sheet, §D the residual list.

- xplan §D2: composer wire hit-testing must call geometry's `hitWire(a, b, pt, {loop, tol})` (spec §7.2) rather than re-sampling the cached `d`, or justify in Q&A.
- xplan §D3: the band/chrome/badge fast paths assume Task 1's `h(tag, cls, text)` helper semantics and per-loop-wire badge hosts — dry-run must confirm.
- xplan §D7: Task 2 expected count +2 (re-measure).
