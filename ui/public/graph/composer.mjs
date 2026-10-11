// ui/public/graph/composer.mjs
// The v2 composer editor. It owns the POINTER PIPELINE and nothing else about
// rendering: view.mjs paints, this file classifies and mutates.
//
// The four PR #359 defects are structurally excluded here:
//  · listeners live on the STAGE with pointer capture, never on `document`
//  · onMove stores a point and schedules ONE rAF — no DOM, no hit-test, no validate
//  · a node drag re-routes the dirty region only and writes `d` for the wires
//    whose route actually moved, through the view's d-cache
//  · pointercancel / lostpointercapture / window blur / Escape all cancel, and
//    finish() releases capture
// Depth 3 ⇒ the shared core is three `..` up.
import { createGraphView } from './view.mjs';
import { renderNodeInspector, renderWireInspector, renderEmptyInspector, stripLevels } from './inspector.mjs';
import { paramEditorHook } from '../script-forms.mjs';
import { renderSaveDialog, openDialog, closeDialog } from './save-dialog.mjs';
import { withButton, fieldError, clearFieldErrors, cardAlert } from '../feedback.mjs';
import { PORT_HIT_R, SNAP, ZOOM_MIN, ZOOM_MAX, ZOOM_K, NODE_W, snap }
  from '../../../src/shared/graph/geometry.mjs';
import { hitRoute } from '../../../src/shared/graph/route.mjs';
import { PARAMS_PORT } from '../../../src/shared/graph/constants.mjs';
import { canWire, newNode, newWire, normalizeTemplate, serializeTemplate }
  from '../../../src/shared/graph/template.mjs';
import { validateGraph, CANVAS_WARNING_CODES } from '../../../src/shared/graph/validate.mjs';
import { autoLayout } from '../../../src/shared/graph/layout.mjs';
import { applyCanvasOps, newRealErrors } from '../../../src/shared/graph/canvas-ops.mjs';
import { mintId } from '../../../src/shared/graph/template.mjs';
import { LABEL_H } from '../../../src/shared/graph/geometry.mjs';

export const UNDO_LIMIT = 50;
/** The ONE reserved workflow id: the server prepends this built-in to
 *  GET /api/workflows and refuses DELETE on it (ui/server.mjs). Exported HERE so
 *  the composer and app.js share one literal (the saved list hides the ×, the
 *  Save dialog prefills a copy name). */
export const RESERVED_WORKFLOW_ID = 'wf_default';
/** Every built-in the server lists and refuses to delete: wf_default + the Memory defragment
 *  workflow. Both open read-only here (Save is Save-a-copy). wf_auto never reaches the composer. */
export const RESERVED_WORKFLOW_IDS = new Set([RESERVED_WORKFLOW_ID, 'wf_memory_defrag']);
export const isReservedWorkflowId = (id) => RESERVED_WORKFLOW_IDS.has(id);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** 'plugin:demo-plug' -> 'demo-plug'; anything else -> ''. `origin` is a row
 *  column the server's rowToTpl projects and normalizeTemplate drops, so the
 *  composer keeps it beside the template. */
export const pluginOriginName = (origin) => (typeof origin === 'string' && origin.startsWith('plugin:')
  ? origin.slice('plugin:'.length) : '');
const isTyping = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export function createComposer(hostEls, { doc = globalThis.document, api, raf = null, viewport = null, storage = null, portsFn, highlight = null, notify = null, allLevels = false, insetRight: insetRightOpt = null } = {}) {
  const win = doc.defaultView || globalThis;
  const schedule = raf || ((fn) => win.requestAnimationFrame(fn));
  const stats = { rectReads: 0, frames: 0, pointerMoves: 0, validations: 0 };
  let ready = true;                 // false while /api/agents is in flight (app.js sets it)
  const hooks = {};                 // onRender, onSelect, onZoom, onTransform, onDocChange, … — set by the host

  let tpl = emptyCanvas();
  let tplOrigin = '';             // 'plugin:<name>' of the LOADED row ('' = user-created)
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
  let agents = {};                // key -> agent meta (the placeable agents)
  let scripts = {};               // key -> script meta (the placeable scripts); the view gets the MERGED index
  const headerIndex = () => ({ ...agents, ...scripts });   // keys never collide (D16)

  let modelById = new Map();                        // id -> label, from /api/config (applyModels)
  const view = createGraphView(hostEls.canvas, {
    doc, mode: 'edit', portsFn, agents, viewport,
    zoomMin: ZOOM_MIN, zoomMax: ZOOM_MAX,
    modelLabel: (id) => modelById.get(id) || id,
    onTransform: (t) => { paintGrid(t); if (hooks.onTransform) hooks.onTransform(t); },
  });
  const stage = view.stage;

  /** The dot grid follows the canvas (mockup:1923): 22px × zoom, doubled while denser than 11px. */
  function paintGrid(t) {
    const host = hostEls.canvas;
    if (!host || !host.style) return;
    let g = 22 * t.z;
    while (g < 11) g *= 2;
    host.style.backgroundSize = `${g}px ${g}px`;
    host.style.backgroundPosition = `${(t.x % g) - 1}px ${(t.y % g) - 1}px`;
  }

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
      if (pt.x >= n.x && pt.x <= n.x + s.w && pt.y >= n.y - LABEL_H && pt.y <= n.y + s.h) return n;
    }
    return null;
  }
  /** The hit test reads the EXACT painted polyline (view.wireRoute) and measures
   *  point-to-SEGMENT per leg, so there is nothing to re-derive and no second
   *  geometry to keep in sync: hit and paint cannot diverge. The private copy
   *  this replaced compared the click to 49 SAMPLED POINTS, which left up to
   *  37.7% of a shipped wire's drawn line dead (MAJ-18). The painted corners are
   *  rounded by ≤2.35px relative to the sharp polyline — well inside the 6px
   *  tolerance. */
  function hitWireAt(pt) {
    for (const w of tpl.wires) {
      const pts = view.wireRoute(w.id);
      if (pts && hitRoute(pts, pt)) return w;       // dangling endpoint is never a target
    }
    return null;
  }

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
      view.render(tpl, { selection: sel, report: shownReport() });
      paintChrome();
    }, 0);
  }
  function render() {
    view.render(tpl, { selection: sel, report: shownReport() });
    paintChrome();
    paintInspector();
    if (hooks.onRender) hooks.onRender();
  }
  /** What the cards show: a fresh canvas stays quiet until its first edit (mockup wf.untouched) — no pips on the bookends. */
  function shownReport() {
    return isPristine() ? { ...lastReport, errors: [], warnings: [] } : lastReport;
  }
  /** A canvas nobody has touched: the two bookends, no wires, no edits. */
  function isPristine() {
    return !dirty && tpl.wires.length === 0 && tpl.nodes.length === 2
      && tpl.nodes.every((n) => n.kind === 'task' || n.kind === 'end');
  }
  function paintChrome() {
    const n = lastReport.errors.length;
    const real = lastReport.errors.filter((e) => !e.incomplete).length;
    const todo = n - real;
    const warn = (lastReport.warnings || []).filter((w) => CANVAS_WARNING_CODES.includes(w.code) && warnNode(w)).length;
    const tip = real ? 'Fix the errors to save' : todo ? 'Wire Task → … → End to save' : '';
    if (hostEls.saveBtn) {
      hostEls.saveBtn.disabled = n > 0 || !ready;
      hostEls.saveBtn.title = tip;
    }
    if (hostEls.saveWrap) hostEls.saveWrap.title = tip;
    if (hostEls.errors) {
      const pristine = isPristine();
      const quiet = !real && todo > 0 && !pristine;
      const warned = !real && !todo && warn > 0 && !pristine;
      hostEls.errors.hidden = !real && !quiet && !warned;
      hostEls.errors.classList.toggle('is-incomplete', quiet);
      hostEls.errors.classList.toggle('is-warning', warned);
      hostEls.errors.textContent = real
        ? `${real} error${real === 1 ? '' : 's'}`
        : quiet ? `${todo} port${todo === 1 ? '' : 's'} to wire`
          : warned ? `${warn} warning${warn === 1 ? '' : 's'}` : '';
      hostEls.errors.setAttribute('aria-label', hostEls.errors.hidden ? '' : `${hostEls.errors.textContent} — show the first one`);
    }
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
        view.setGhost(view.routeGhost(g.anchor, pt, { mirror: g.mirror }), '');
      } else if (node) {
        g = { type: 'node', id: node.id, grab: { dx: pt.x - node.x, dy: pt.y - node.y }, start: { x: node.x, y: node.y }, moved: false };
        select({ kind: 'node', id: node.id });
        view.nodeEl(node.id).classList.add('dragging');
        view.nodeEl(node.id).focus({ preventScroll: true });   // Delete / Escape / arrows reach the card, not a Library tab
      } else {
        const wire = hitWireAt(pt);
        if (wire) { select({ kind: 'wire', id: wire.id }); g = { type: 'idle' }; }
        else {
          select(null); g = { type: 'pan' };
          const f = doc.activeElement;
          if (f && f !== doc.body && stage.contains(f)) f.blur();   // the card that held the focus lets go
        }
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
      view.moveNode(n.id);                                // dirty-filtered re-route, d-cache gated
      return;
    }
    const target = hitPortAt(pt, g.origin);
    const v = legality(g.origin, target);
    const end = v && v.ok ? target.anchor : pt;           // snap to the legal anchor
    view.setGhost(view.routeGhost(g.anchor, end, { mirror: g.mirror }), v ? (v.ok ? 'legal' : 'illegal') : '');
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
      // rerouteAll is the D15 canonical pass: cancel never renders, so without it
      // the drag's dirty-filtered routes could outlive the gesture. Paint only —
      // no commit, no undo entry, no capture op.
      if (n) { n.x = g.start.x; n.y = g.start.y; view.moveNode(n.id); view.rerouteAll(); }
    }
    finish(g);
  }

  function select(next) {
    sel = next;
    view.setSelection(sel);
    paintInspector();
    if (hooks.onSelect) hooks.onSelect(sel);
  }

  const onCancelEv = () => cancel();
  const onLost = () => { if (gesture) cancel(); };
  const onBlur = () => { space = false; stage.classList.remove('space'); cancel(); };
  const onRefresh = () => readRect();
  const onSaveClick = () => openSaveDialog();

  function zoomAbout(zNext, sx, sy) {
    const t = T();
    const z2 = clamp(zNext, view.zoomFloor(), ZOOM_MAX);
    view.setTransform({ x: sx - ((sx - t.x) / t.z) * z2, y: sy - ((sy - t.y) / t.z) * z2, z: z2 });
    paintNav();
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

  /** px of canvas hidden under floating chrome on the right — 0 in the Workflows view (the Library is a
   *  flex sibling, not an overlay); a host may inject a function (the phone overlay Library). */
  function insetRight() {
    return typeof insetRightOpt === 'function' ? Math.max(0, Number(insetRightOpt()) || 0) : 0;
  }
  /** `opts.insetBottom`: px of the stage's bottom hidden under the open chat dock (chat-cards reveal). */
  function fit(opts = {}) {
    view.fit({ insetRight: opts.insetRight == null ? insetRight() : opts.insetRight, insetBottom: Math.max(0, Number(opts.insetBottom) || 0), pad: 60 });
    paintNav();
  }
  /** Stage-local centre of the band the right-hand chrome leaves visible — the
   *  point the zoom menu zooms about. Reads the rect itself: the stage may have
   *  been resized since the last gesture. */
  function bandCenter() {
    readRect();
    return { x: (R.width - insetRight()) / 2, y: R.height / 2 };
  }
  /** One discrete zoom press. zoomAbout owns the clamp: 0.4 (or a lower fit, view.fit)..1.6. */
  function zoomStep(mult) {
    const c = bandCenter();
    zoomAbout(T().z * mult, c.x, c.y);
  }
  /** The zoom % the host shows (the Workflows view's zoom menu label). */
  function paintNav() { if (hooks.onZoom) hooks.onZoom(T().z); }
  // `autoLayout(tpl, portsFn)` returns a POSITION MAP `{ [nodeId]: {x, y} }` — not
  // a template, not `{nodes}` (verified 2026-08-27 against src/shared/graph/layout.mjs,
  // whose own JSDoc says "the caller applies them"). `describe`: composer cards bill
  // the description footer.
  function runAutoLayout() {
    commit('auto-layout', () => {
      const pos = autoLayout(tpl, portsFn, { describe: true });
      for (const n of tpl.nodes) {
        const p = pos[n.id];
        if (p) { n.x = p.x; n.y = p.y; }
      }
    });
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

  /** True while ANY modal owns the keyboard (MAJ-19). Two selectors, because no
   *  single one covers the two modal shapes this document carries:
   *   · the composer's own <dialog> — `open` is set by showModal() (spec: the
   *     attribute is reflected) AND by save-dialog.mjs's jsdom fallback. Its
   *     Cancel/Save buttons are focusable NON-inputs, which `isTyping`
   *     deliberately does not cover, and showModal's inertness does not stop the
   *     dialog's own keydown from bubbling to this document listener;
   *   · the app's overlays — plain <div role="dialog" aria-modal="true"> that only
   *     toggle the `hidden` CLASS (index.html:1247 #confirm-modal and four
   *     siblings), which `dialog[open]` misses entirely; confirmModal auto-focuses
   *     their <button> (app.js:6973), so a Backspace aimed at a Delete-pipeline
   *     confirm would otherwise delete the selected NODE behind it. The Ask Worca
   *     sheet carries role="dialog" WITHOUT aria-modal and is deliberately NOT
   *     matched: it is a docked, non-modal panel the canvas is used alongside.
   *  The `:not(.hidden):not([hidden])` pair is load-bearing: without it the arm
   *  is permanently true (every overlay is in the DOM from page load) and the
   *  canvas keyboard dies for good. */
  function modalUp() {
    if (doc.querySelector('dialog[open]')) return true;
    // `aria-modal`, not `role="dialog"`: the Ask Worca sheet (ask-panel.mjs:206) is a
    // role="dialog" DOCKED panel that stays open while the canvas is used — it must
    // never own the canvas keyboard. Every app overlay declares aria-modal="true".
    return Boolean(doc.querySelector('[aria-modal="true"]:not(.hidden):not([hidden])'));
  }

  function onKeyDown(ev) {
    if (ev.key === 'Tab') { insTab = ev.shiftKey ? -1 : 1; setTimeout(() => { insTab = 0; }, 0); }   // see paintInspector
    if (ev.defaultPrevented) return;              // a menu/popover already handled it
    if (modalUp()) return;                        // a modal owns the keyboard — never the canvas
    if (isTyping(ev.target)) return;              // guard FIRST — before space, before anything
    // ⌘Z / ⇧⌘Z still reach the canvas from a fenced BUTTON (Save, Auto-layout, a Library row, a chat card): a pointer
    // click focuses it, and undo is the one key with no other meaning there. Fields stay theirs (isTyping, above).
    if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'z' || ev.key === 'Z')) { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
    if (ev.target && ev.target.closest && ev.target.closest('[data-canvas-keys="off"]')) return;   // top bars, dock, Library, chat, sheet, menus
    if (ev.key === ' ') { if (!space) { space = true; stage.classList.add('space'); } ev.preventDefault(); return; }
    if (ev.key === 'Escape') {
      if (gesture) cancel(); else select(null);
      return;
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSelection(); return; }
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); nudge(-SNAP, 0); return; }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); nudge(SNAP, 0); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); nudge(0, -SNAP); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); nudge(0, SNAP); }
  }
  function onKeyUp(ev) { if (ev.key === ' ') { space = false; stage.classList.remove('space'); } }

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
  /** The spot's box overlaps a card already there (mockup canvas.js addAtCenter `taken`). */
  function taken(x, y, h) {
    return tpl.nodes.some((n) => {
      const z = view.size(n);
      return x - 7 < n.x + z.w + 7 && x + NODE_W + 7 > n.x - 7 && y - LABEL_H < n.y + z.h && y + h > n.y - LABEL_H;
    });
  }
  function spawn(entry, at) {
    const p = at || freeSlot(centerWorld());
    let node = null;
    commit('add', () => {
      node = entry.kind === 'script'
        ? newNode('script', entry.key, snap(p.x), snap(p.y))
        : entry.kind
          ? newNode(entry.kind, null, snap(p.x), snap(p.y))
          : newNode('agent', entry.key, snap(p.x), snap(p.y));
      if (entry.kind === 'and' || entry.kind === 'or' || entry.kind === 'combine') node.config.arity = 2;
      // D14: a config-ported script starts from the sidecar's defaultPorts, deep-copied — the card owns its ports from here.
      const meta = entry.kind === 'script' ? scripts[entry.key] : null;
      if (meta && meta.ports === 'config' && meta.defaultPorts) node.config.ports = JSON.parse(JSON.stringify(meta.defaultPorts));
      if (!at) { const h = view.size(node).h; for (let i = 0; i < 30 && taken(node.x, node.y, h); i += 1) { node.x += SNAP * 2; node.y += SNAP * 2; } }
      tpl.nodes.push(node);
    });
    select({ kind: 'node', id: node.id });
    return node;
  }

  let models = [];
  let efforts = [];
  let subagentModels = [];
  let modelsSet = false;          // an explicit setModels() wins over the mount fetch

  function applyModels({ models: m = [], efforts: e = [], subagentModels: sm = [] } = {}) {
    models = Array.isArray(m) ? m : [];
    efforts = Array.isArray(e) ? e : [];
    subagentModels = Array.isArray(sm) ? sm : [];
    modelById = new Map(models.filter(Boolean).map((m) => [m.id, m.label || m.id]));
    paintInspector();
    // /api/config lands AFTER the first loadTemplate: repaint so the label rows show model labels, not raw ids.
    render();
  }

  // Code editors mounted into the inspector. Each owns a debounce timer and three
  // listeners, so every repaint destroys the previous set before the tree goes —
  // a pending highlight against a detached node is a leak, not a crash, and this
  // is the only place that sees both sides of the swap. With no `highlight`
  // injected the hook is null and renderParamsForm keeps P1b's plain textarea.
  const insEditors = [];
  const insEditorFor = paramEditorHook({ doc, highlight, editors: insEditors });
  function disposeInsEditors() {
    for (const ed of insEditors) ed.destroy();
    insEditors.length = 0;
  }

  /** Every commit repaints the inspector, and the shell hosts it in the open More popover: a keyboard user's field
   *  would go with the old body and the focus drop to <body>, where Escape no longer closes the popover and the next
   *  Delete deletes the card. So the focus comes back to the same control — its `data-field`, else its place among
   *  the controls — one control on when a Tab committed the field. A Tab's blur commit has already let go of the focus
   *  when `change` fires (Chrome), so that case waits a turn and acts only if the focus found no home; a commit by a
   *  click elsewhere leaves the focus where the click put it. */
  const INS_CONTROLS = 'input, select, textarea, button, summary, [tabindex]:not([tabindex="-1"])';
  let insFrom = null;              // the control whose `change` is being committed (onInspectorChange)
  let insTab = 0;                  // +1 / -1 while a Tab keydown is moving the focus (onKeyDown)
  const insControls = (body) => [...body.querySelectorAll(INS_CONTROLS)].filter((e) => !e.disabled && !e.hidden);
  function insFocusAt(body, at) {
    const list = insControls(body);
    let i = at.field ? list.findIndex((e) => e.dataset.field === at.field) : -1;
    if (i < 0) i = at.index;
    const t = list[i + at.step] || list[i] || list[list.length - 1];
    if (t) t.focus({ preventScroll: true });
  }
  function paintInspector() {
    const hostBody = hostEls.insBody;
    if (!hostBody) return;
    const active = doc.activeElement;
    const inside = Boolean(active && active !== doc.body && hostBody.contains(active));
    const had = inside ? active : (insFrom && hostBody.contains(insFrom) ? insFrom : null);
    const at = had ? { field: (had.dataset && had.dataset.field) || '', index: Math.max(0, insControls(hostBody).indexOf(had)), step: insTab } : null;
    if (at) insTab = 0;
    disposeInsEditors();
    hostBody.replaceChildren(inspectorFor(sel));
    if (allLevels) stripLevels(hostBody);
    if (at && inside) insFocusAt(hostBody, at);
    else if (at && at.step) setTimeout(() => { if ((!doc.activeElement || doc.activeElement === doc.body) && hostBody.isConnected) insFocusAt(hostBody, at); }, 0);
    if (hooks.onInspector) hooks.onInspector(sel);
  }
  function inspectorFor(s) {
    if (!s) return renderEmptyInspector({ doc });
    if (s.kind === 'node') {
      const node = nodeById(s.id);
      if (!node) return renderEmptyInspector({ doc });
      const meta = node.kind === 'agent' ? (agents[node.key] || null) : (node.kind === 'script' ? (scripts[node.key] || null) : null);
      return renderNodeInspector(node, { template: tpl, portsFn, meta, models, efforts, subagentModels, editorFor: insEditorFor, doc });
    }
    const wire = wireById(s.id);
    return wire ? renderWireInspector(wire, { loop: view.isLoopWire(wire.id), doc }) : renderEmptyInspector({ doc });
  }

  /** node.config.ports, cloned one level deep so a commit never mutates the undo ring's copy. */
  const clonePorts = (raw) => ({
    inputs: (Array.isArray(raw && raw.inputs) ? raw.inputs : []).map((p) => ({ ...p })),
    outputs: (Array.isArray(raw && raw.outputs) ? raw.outputs : []).map((p) => ({ ...p })),
  });
  const nextPortId = (list, base) => { let i = 0; for (;;) { const id = i ? `${base}${i + 1}` : base; if (!list.some((p) => p.id === id)) return id; i += 1; } };
  /** A param control's value in the declared type; undefined = delete the key. */
  function coerceParam(decl, target) {
    if (!decl) return target.value === '' ? undefined : target.value;
    if (decl.type === 'boolean') return Boolean(target.checked);
    if (decl.type === 'number') { const n = Number(target.value); return target.value === '' || !Number.isFinite(n) ? undefined : n; }
    // A command or code value of blanks alone is no value: the runner trims it away, so V22 must see it as missing.
    if ((decl.type === 'command' || decl.type === 'code') && target.value.trim() === '') return undefined;
    return target.value === '' ? undefined : target.value;
  }

  function onInspectorChange(ev) {
    insFrom = ev.target;             // paintInspector keeps the focus on it across the repaints below
    try { inspectorChange(ev); } finally { insFrom = null; }
  }
  function inspectorChange(ev) {
    const name = ev.target.dataset && ev.target.dataset.field;
    // The field's own panel names the card or wire it edits (inspector.mjs stamps it). A press on another card selects
    // that card FIRST and the field lets go after (its blur fires `change`), so `sel` would hand the typed value to the
    // card just pressed.
    const panel = ev.target.closest ? ev.target.closest('[data-node-id], [data-wire-id]') : null;
    const owner = panel ? (panel.dataset.nodeId ? { kind: 'node', id: panel.dataset.nodeId } : { kind: 'wire', id: panel.dataset.wireId }) : sel;
    if (!name || !owner) return;
    if (owner.kind === 'wire') {
      const wire = wireById(owner.id);
      if (!wire || name !== 'maxCycles') return;
      const n = Number.parseInt(ev.target.value, 10);
      commit('maxCycles', () => {
        wire.config = { ...(wire.config || {}) };
        if (Number.isInteger(n) && n >= 1) wire.config.maxCycles = n; else delete wire.config.maxCycles;
        if (!Object.keys(wire.config).length) delete wire.config;
      });
      return;
    }
    const node = nodeById(owner.id);
    if (!node) return;
    if (node.kind === 'script' && name.startsWith('param:')) {
      const id = name.slice('param:'.length);
      const decl = ((scripts[node.key] && scripts[node.key].params) || []).find((p) => p.id === id);
      commit(name, () => {
        const params = { ...(node.config.params || {}) };
        const v = coerceParam(decl, ev.target);
        if (v === undefined) delete params[id]; else params[id] = v;
        if (Object.keys(params).length) node.config.params = params; else delete node.config.params;
      });
      paintInspector();
      return;
    }
    if (node.kind === 'script' && name === 'timeoutMs') {
      const secs = Number(ev.target.value);
      commit(name, () => {
        if (ev.target.value !== '' && Number.isFinite(secs) && secs >= 1) node.config.timeoutMs = Math.round(secs * 1000);
        else delete node.config.timeoutMs;
      });
      paintInspector();
      return;
    }
    if (node.kind === 'script' && name.startsWith('port:')) {
      const [, dir, idx, fieldName] = name.split(':');
      if (fieldName === 'id') {
        // Wires follow a port BY ID (below), so an id that is blank, reserved or already taken on this side is
        // refused and the box snaps back: passing through '' would strand the wires on a port that cannot be
        // drawn, and two ports sharing an id would hand one port's wires to the other on the next rename.
        const next = ev.target.value.trim();
        const side = node.config.ports && Array.isArray(node.config.ports[dir]) ? node.config.ports[dir] : [];
        const engineOwned = next === 'await' || (dir === 'inputs' && next === PARAMS_PORT.id && node.config.paramsPort === true);
        if (!next || engineOwned || side.some((q, j) => j !== Number(idx) && q && q.id === next)) return void paintInspector();
      }
      commit(name, () => {
        const ports = clonePorts(node.config.ports);
        const p = ports[dir] && ports[dir][Number(idx)];
        if (!p) return;
        if (fieldName === 'required') p.required = Boolean(ev.target.checked);
        else if (fieldName === 'loop') { if (ev.target.checked) p.loop = true; else delete p.loop; }
        else if (fieldName === 'id') {
          // A rename carries the port's wires with it: a wire into a port id that no longer exists is
          // never drawn, so it could be neither selected nor deleted and the graph would stay invalid.
          const old = p.id;
          p.id = ev.target.value.trim();
          if (old && old !== p.id) for (const w of tpl.wires) { const end = dir === 'inputs' ? w.to : w.from; if (end.node === node.id && end.port === old) end.port = p.id; }
        }
        else if (ev.target.value === '') delete p[fieldName];
        else p[fieldName] = ev.target.value;
        if (fieldName === 'type' && ev.target.value === 'void') delete p.filename;
        node.config.ports = ports;
      });
      paintInspector();
      return;
    }
    commit(name, () => {
      if (name === 'arity') {
        const n = Number.parseInt(ev.target.value, 10);
        node.config.arity = Number.isInteger(n) && n >= 2 ? n : 2;   // V12 floor
      } else if (ev.target.type === 'checkbox') {
        if (ev.target.checked) node.config[name] = true; else delete node.config[name];
        // The params port leaves with its toggle, and its wires with it — a wire into a port that no longer
        // exists is never drawn, so it could be neither selected nor deleted (same reason as a removed config port).
        // Resolved AFTER the delete: an input still called `params` is the script's OWN (a stuck opt-in V22
        // refuses), and the wires into it are the user's.
        if (name === 'paramsPort' && !ev.target.checked && !(portsFn(node)?.inputs || []).some((p) => p && p.id === PARAMS_PORT.id)) {
          tpl.wires = tpl.wires.filter((w) => !(w.to.node === node.id && w.to.port === PARAMS_PORT.id));
        }
      } else if (ev.target.value === '') {
        delete node.config[name];
      } else {
        node.config[name] = ev.target.value;
      }
    });
    paintInspector();                                  // re-read the committed value
  }

  /** The port editor's add/remove buttons (script cards only). */
  function onInspectorClick(ev) {
    const add = ev.target.closest && ev.target.closest('[data-port-add]');
    const rm = ev.target.closest && ev.target.closest('[data-port-remove]');
    if ((!add && !rm) || !sel || sel.kind !== 'node') return;
    const node = nodeById(sel.id);
    if (!node || node.kind !== 'script') return;
    commit('ports', () => {
      const ports = clonePorts(node.config.ports);
      if (add) {
        const dir = add.dataset.portAdd;
        if (dir === 'inputs') ports.inputs.push({ id: nextPortId(ports.inputs, 'in'), type: 'md', required: false });
        else { const id = nextPortId(ports.outputs, 'out'); ports.outputs.push({ id, type: 'md', when: 'always', filename: `${id}-cycle{cycle}.md` }); }
      } else {
        const [dir, idx] = rm.dataset.portRemove.split(':');
        const gone = ports[dir] ? ports[dir].splice(Number(idx), 1)[0] : null;
        // The removed port's wires go with it (same reason as the rename above).
        if (gone && gone.id) tpl.wires = tpl.wires.filter((w) => { const end = dir === 'inputs' ? w.to : w.from; return !(end.node === node.id && end.port === gone.id); });
      }
      node.config.ports = ports;
    });
    paintInspector();
  }

  let dialog = null;
  let savedDomains = [];

  /** Two loaded rows may never be saved IN PLACE, so Save on them IS Save-a-copy:
   *   · the built-in Default — its id is reserved and its name re-mints it, so an
   *     in-place save writes a row nothing can list, read or delete (C-3);
   *   · a plugin-owned row — `worca plugin update` overwrites name/domain/graph
   *     unconditionally, so the edits are erased with no prompt (MAJ-4).
   *  @returns {{copy: boolean, plugin: string}} */
  function saveMode(saveAs) {
    const plugin = pluginOriginName(tplOrigin);
    return { copy: Boolean(saveAs) || isReservedWorkflowId(tpl.id) || Boolean(plugin), plugin };
  }

  function openSaveDialog({ saveAs = false } = {}) {
    if (!hostEls.dialogHost) return null;
    if (dialog) dialog.remove();
    const mode = saveMode(saveAs);
    dialog = renderSaveDialog({
      name: mode.copy ? `${tpl.name || 'Untitled'} copy` : (tpl.name || ''),
      domain: tpl.domain || '', domains: savedDomains,
      title: mode.copy ? 'Save a copy' : 'Save pipeline',
      note: mode.plugin
        ? `This pipeline belongs to plugin "${mode.plugin}" and is replaced on plugin update — saving creates your own copy.`
        : '',
      doc,
    });
    if (allLevels) stripLevels(dialog);
    dialog.dataset.saveAs = mode.copy ? '1' : '';
    dialog.querySelector('.sd-actions').dataset.cardActions = '';   // a refusal's cardAlert lands above it
    hostEls.dialogHost.replaceChildren(dialog);
    dialog.querySelector('.sd-cancel').addEventListener('click', () => closeDialog(dialog));
    dialog.querySelector('.sd-confirm').addEventListener('click', () => { confirmSave(); });
    openDialog(dialog);
    return dialog;
  }

  // #555: with an injected `notify` (app.js), refusals are a cardAlert on the dialog and an
  // empty name a fieldError; without one (the Pattern-A suites) they keep the .sd-msg line.
  async function confirmSave() {
    if (!dialog) return;
    const dlg = dialog;
    const panel = dlg.querySelector('.sd-body');
    const msg = dlg.querySelector('.sd-msg');
    const nameInput = dlg.querySelector('.sd-name');
    const name = nameInput.value.trim();
    msg.className = 'sd-msg';
    if (notify) { clearFieldErrors(panel); cardAlert(panel, null); }
    const refuse = (text) => {
      if (notify) cardAlert(panel, { title: 'Not saved', detail: text });
      else { msg.textContent = text; msg.className = 'sd-msg err'; }
    };
    if (!name) {
      if (notify) fieldError(nameInput, 'Name is required.');
      else { msg.textContent = 'name is required'; msg.className = 'sd-msg err'; }
      return;
    }
    const domain = dlg.querySelector('.sd-domain').value.trim();
    const saveAs = dlg.dataset.saveAs === '1';
    const body = { ...serializeTemplate(tpl), version: 2, name, domain };
    // What THIS request carries: an edit that lands while it is in flight (a chat canvas-edit applies the
    // moment its frame arrives) is not in the saved row, so markSaved must not count it as saved.
    const sent = snapshot();
    // Save on a LOADED row sends its id; a copy omits it so the server mints
    // wf_${slugify(name)}. `dataset.saveAs` already carries saveMode()'s verdict,
    // so the reserved built-in and every plugin-owned row land here as copies.
    if (!saveAs && tpl.id && !isReservedWorkflowId(tpl.id)) body.id = tpl.id;
    else delete body.id;
    // withButton never throws: a throw comes back as { ok: false, error }.
    const r = await withButton(dlg.querySelector('.sd-confirm'), async () => {
      const res = await api.saveWorkflow(body);
      if (res && res.ok === false) {
        // 422 = the shared validator's issues; render them VERBATIM.
        const issues = Array.isArray(res.issues) ? res.issues : [];
        refuse(issues.length
          ? issues.map((i) => (i.code ? `${i.code}: ${i.message}` : i.message)).join('\n')
          : (res.error || `save failed (${res.status || 'error'})`));
        return { ok: false };
      }
      composer.markSaved(res && res.workflow && res.workflow.id, name, domain, sent);
      closeDialog(dlg);
      if (hooks.onSaved) hooks.onSaved(res && res.workflow);
      render();
      notify?.({ tone: 'ok', title: 'Pipeline saved' });
      return { ok: true };
    });
    if (r.ok === false && r.error) refuse(r.error);
  }

  /** The card a surfaced warning belongs to: its node, or — V19 names only a wire — the wire's target (D15). */
  function warnNode(w) {
    if (w.nodeId) return w.nodeId;
    const wire = w.wireId ? wireById(w.wireId) : null;
    return wire && wire.to ? wire.to.node : null;
  }
  function firstErrorNode() {
    const e = (lastReport.errors || []).find((x) => x.nodeId);
    if (e) return e.nodeId;
    const w = (lastReport.warnings || []).find((x) => CANVAS_WARNING_CODES.includes(x.code) && warnNode(x));
    return w ? warnNode(w) : null;
  }
  const onErrChip = () => { const id = firstErrorNode(); if (id) { select({ kind: 'node', id }); view.centerOn(id); } };
  const onWorldClick = (ev) => {
    const pip = ev.target.closest && ev.target.closest('.npip, .nwarn');
    if (!pip) return;
    ev.stopPropagation();
    const id = pip.dataset.nodeId;
    if (id) { select({ kind: 'node', id }); view.centerOn(id); }
  };

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

  function mount() {
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('wheel', onWheel, { passive: false });
    resume();                                   // doc/window listeners live here
    hostEls.autoBtn?.addEventListener('click', runAutoLayout);
    hostEls.errors?.addEventListener('click', onErrChip);
    view.world.addEventListener('click', onWorldClick);
    hostEls.insBody?.addEventListener('change', onInspectorChange);
    hostEls.insBody?.addEventListener('click', onInspectorClick);
    hostEls.saveBtn?.addEventListener('click', onSaveClick);
    // The model/effort lists are chrome, not graph state: pull them once through
    // the injected api so the inspector's selects are usable the moment it is
    // shown. app.js may still call setModels() explicitly; that wins.
    if (api && typeof api.config === 'function') {
      Promise.resolve(api.config()).then((cfg) => { if (!modelsSet && cfg) applyModels(cfg); }).catch(() => {});
    }
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onCancelEv);
    stage.addEventListener('lostpointercapture', onLost);
    if (typeof win.ResizeObserver === 'function') {
      ro = new win.ResizeObserver(onRefresh);
      ro.observe(stage);
    }
    readRect();
    paintNav();
    return composer;
  }
  let ro = null;

  function destroy() {
    suspend();
    stage.removeEventListener('pointerdown', onDown);
    stage.removeEventListener('wheel', onWheel);
    hostEls.autoBtn?.removeEventListener('click', runAutoLayout);
    hostEls.errors?.removeEventListener('click', onErrChip);
    view.world.removeEventListener('click', onWorldClick);
    hostEls.insBody?.removeEventListener('change', onInspectorChange);
    hostEls.insBody?.removeEventListener('click', onInspectorClick);
    disposeInsEditors();
    hostEls.saveBtn?.removeEventListener('click', onSaveClick);
    stage.removeEventListener('pointermove', onMove);
    stage.removeEventListener('pointerup', onUp);
    stage.removeEventListener('pointercancel', onCancelEv);
    stage.removeEventListener('lostpointercapture', onLost);
    if (ro) { ro.disconnect(); ro = null; }
    if (validateTimer) { clearTimeout(validateTimer); validateTimer = null; }
  }

  /** The unsaved-work gate for the two entry points that REPLACE the canvas and
   *  wipe the undo ring, so the work is unrecoverable (MAJ-6). `confirmDiscard`
   *  is an injected hook — app.js installs its confirmModal — and an ABSENT hook
   *  PROCEEDS, which is what keeps every headless caller (unit tests, the CDP
   *  probe) behaving exactly as it did. A hook that throws counts as "no":
   *  losing the answer must never lose the graph.
   *  @returns {Promise<boolean>} true to go ahead. */
  async function guardDiscard() {
    if (!dirty) return true;
    const ask = hooks.confirmDiscard;
    if (typeof ask !== 'function') return true;
    try { return Boolean(await ask()); } catch { return false; }
  }

  let token = mintId('d_');                       // the open DOCUMENT: new on every load, never on an edit or a save
  function loadTemplate(next) {
    tpl = next ? normalizeTemplate(next) : emptyCanvas();
    tplOrigin = (next && typeof next.origin === 'string') ? next.origin : '';
    sel = null;
    undoStack.length = 0; redoStack.length = 0;
    savedHash = snapshot();
    metaDirty = false;
    dirty = false;
    token = mintId('d_');
    lastReport = validateGraph(tpl, portsFn);
    if (hostEls.name) hostEls.name.value = tpl.name || '';
    render();
    if (hooks.onDocChange) hooks.onDocChange(token);
    return tpl;
  }
  /** A chat-built workflow: a NEW unsaved document (no id, no origin), dirty from the start (D13). */
  function loadDraft(draft) {
    loadTemplate({ id: '', name: String(draft.name || ''), version: 2, domain: String(draft.domain || ''),
      nodes: draft.nodes, wires: draft.wires });
    metaDirty = true;
    dirty = true;
    paintChrome();
    return tpl;
  }
  /** Apply a canvas-ops batch (canvas-ops.mjs) as ONE undo step; refused whole on the first bad op, and (D12) when
   *  it would add a NEW real validation error HERE: the chat validated it on the canvas its message carried, but the
   *  canvas stays live during a turn — a wire the user drew since can make the same batch close a cycle. */
  function applyOps(ops, label = 'chat edit') {
    const r = applyCanvasOps(tpl, ops, { portsFn });
    if (!r.ok) return r;
    const broke = newRealErrors(validateGraph(tpl, portsFn), validateGraph(r.tpl, portsFn));
    if (broke.length) return { ok: false, error: `that change would now leave the graph invalid — ${broke[0].message}` };
    commit(label, () => { tpl.nodes = r.tpl.nodes; tpl.wires = r.tpl.wires; });
    if (sel && ((sel.kind === 'node' && !nodeById(sel.id)) || (sel.kind === 'wire' && !wireById(sel.id)))) select(null);
    return { ok: true, depth: undoStack.length, added: r.added, removed: r.removed };
  }
  /** Spawn from a Library drop at a CLIENT point: card top-left = point − (NODE_W/2, 20) (BRIEF.md). */
  function spawnAtClient(entry, clientX, clientY) {
    readRect();
    const p = toWorld(clientX, clientY);
    return spawn(entry, { x: snap(p.x - NODE_W / 2), y: snap(p.y - 20) });
  }
  /** Where the selection toolbar anchors, in STAGE-local screen px: under a node's box centre, or a wire's pill/mid. */
  function selectionAnchor() {
    if (!sel) return null;
    if (sel.kind === 'node') {
      const n = nodeById(sel.id);
      if (!n) return null;
      const s = view.size(n);
      const b = toScreen(n.x + s.w / 2, n.y + s.h);
      const t = toScreen(n.x + s.w / 2, n.y - LABEL_H);
      return { x: b.x, y: b.y, top: t.y, kind: 'node' };
    }
    const c = view.curveOf(sel.id);
    if (!c) return null;
    const m = toScreen(c.mid.x, c.mid.y);
    return { x: m.x, y: m.y, top: m.y, kind: 'wire' };
  }

  const composer = {
    view, stats, hooks,
    mount, destroy, resume, suspend, commit, loadTemplate,
    fit, autoLayout: runAutoLayout, zoomAbout, zoomStep, undo, redo, undoDepth: () => undoStack.length, deleteSelection,
    spawn, paintInspector,
    guardDiscard,
    loadDraft, applyOps, spawnAtClient, selectionAnchor,
    docToken: () => token,
    models: () => ({ models, efforts, subagentModels }),
    metaOf: (node) => (node && node.kind === 'agent' ? (agents[node.key] || null) : node && node.kind === 'script' ? (scripts[node.key] || null) : null),
    placedKinds: () => tpl.nodes.map((n) => n.kind),
    isPristine: () => isPristine(),
    getAgents: () => agents,
    getScripts: () => scripts,
    openSaveDialog, setSavedDomains(list) { savedDomains = list || []; },
    setModels(cfg) { modelsSet = true; applyModels(cfg || {}); },
    /** The header's New-canvas button. Asks before discarding (MAJ-6).
     *  @returns {Promise<object|null>} the new template, or null when refused. */
    newCanvas: async () => ((await guardDiscard()) ? loadTemplate(null) : null),
    /** The saved list's Open. Asks before discarding (MAJ-6).
     *  @returns {Promise<object|null>} the loaded template, or null when refused. */
    openTemplate: async (next) => ((await guardDiscard()) ? loadTemplate(next) : null),
    template: () => tpl,
    serialize: () => serializeTemplate(tpl),
    report: () => lastReport,
    selection: () => (sel ? { ...sel } : null),
    select,
    gesture: () => gesture,
    /** True while focus sits in the inspector (the Workflows More / Params popover): the chat waits before committing. */
    inspectorFocused: () => Boolean(hostEls.insBody && doc.activeElement && hostEls.insBody.contains(doc.activeElement)),
    isDirty: () => dirty,
    setReady(v) { ready = v; paintChrome(); },
    // A registry reload (MAJ-16) must re-validate the OPEN canvas: a wire into a
    // port the Agents view just deleted is an error now, not at the next edit.
    setAgents(map) { agents = map || {}; view.setAgents(headerIndex()); if (tpl.nodes.length) scheduleValidate(); },
    setScripts(map) { scripts = map || {}; view.setAgents(headerIndex()); if (tpl.nodes.length) scheduleValidate(); },
    /** Rename: an unsaved edit, so it sets `dirty` — it never clears it. */
    setName(name) { tpl.name = String(name || ''); metaDirty = true; dirty = true; paintChrome(); },
    /** 'plugin:<name>' of the loaded row, '' when user-created. */
    origin: () => tplOrigin,
    /** `sent`: the snapshot() of the graph the save request carried (default: the graph now). */
    markSaved(id, name, domain, sent = null) {
      // What was just written is a row of the USER's, whatever the source row
      // was: a copy of a plugin template is not itself plugin-owned.
      if (id && id !== tpl.id) tplOrigin = '';
      if (id) tpl.id = id;
      if (name != null) tpl.name = name;
      if (name != null && hostEls.name) hostEls.name.value = name;   // the header follows the saved name (a forced copy renames)
      if (domain != null) tpl.domain = domain;
      savedHash = sent == null ? snapshot() : sent;
      metaDirty = false;
      dirty = snapshot() !== savedHash;          // an edit made while the request was in flight is still unsaved
      paintChrome();
    },
    _internal: { readRect, toWorld, toScreen, hitPortAt, hitNodeAt, hitWireAt, nodeById, wireById, pushUndo, undoStack, redoStack, scheduleValidate, setSpace(v) { space = v; }, isSpace: () => space, getR: () => ({ ...R }) },
  };
  return composer;
}
