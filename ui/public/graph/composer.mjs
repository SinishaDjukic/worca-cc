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
import { renderPalette, applyFilter, FLOW_GROUP } from './palette.mjs';
import { renderNodeInspector, renderWireInspector, renderEmptyInspector } from './inspector.mjs';
import { renderSaveDialog, openDialog, closeDialog } from './save-dialog.mjs';
import { WIRE_HIT_TOL, PORT_HIT_R, SNAP, ZOOM_MIN, ZOOM_MAX, ZOOM_K, NODE_W, snap, bezierPath }
  from '../../../src/shared/graph/geometry.mjs';
import { canWire, newNode, newWire, normalizeTemplate, serializeTemplate }
  from '../../../src/shared/graph/template.mjs';
import { validateGraph } from '../../../src/shared/graph/validate.mjs';
import { autoLayout } from '../../../src/shared/graph/layout.mjs';

export const UNDO_LIMIT = 50;
export const INSPECTOR_KEY = 'worca.composer.inspector';
export const TAB_KEY = 'worca.composer.tab';
export const TABS = Object.freeze(['agents', 'info']);
/** px of canvas hidden under the floating inspector rail (§7.6 constants). */
export const INSET_OPEN = 340;
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
      const nums = ((el && el.getAttribute('d')) || '').match(/-?\d+(?:\.\d+)?/g);
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
    paintPalette();
    paintInspector();
    if (hooks.onRender) hooks.onRender();
  }
  function paintChrome() {
    const n = lastReport.errors.length;
    if (hostEls.saveBtn) hostEls.saveBtn.disabled = n > 0 || !ready;
    if (hostEls.errors) {
      hostEls.errors.hidden = n === 0;
      hostEls.errors.textContent = n ? `${n} error${n === 1 ? '' : 's'}` : '';
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

  let ready = true;                 // false while /api/agents is in flight (app.js sets it)
  const hooks = {};                 // onRender, set by app.js

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
  const onNewCanvas = () => composer.newCanvas();
  const onSaveClick = () => openSaveDialog();

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
  // `autoLayout(tpl, portsFn)` returns a POSITION MAP `{ [nodeId]: {x, y} }` — not
  // a template, not `{nodes}` (verified 2026-08-27 against src/shared/graph/layout.mjs,
  // whose own JSDoc says "the caller applies them").
  function runAutoLayout() {
    commit('auto-layout', () => {
      const pos = autoLayout(tpl, portsFn);
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
    if (modalUp()) return;                        // a modal owns the keyboard — never the canvas
    if (isTyping(ev.target)) return;              // guard FIRST — before space, before anything
    if (ev.key === ' ') { if (!space) { space = true; stage.classList.add('space'); } ev.preventDefault(); return; }
    if (ev.key === 'Escape') {
      if (gesture) cancel();
      else if (hostEls.filter && hostEls.filter.value) { hostEls.filter.value = ''; onFilterInput(); }
      else select(null);
      return;
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSelection(); return; }
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); nudge(-SNAP, 0); return; }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); nudge(SNAP, 0); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); nudge(0, -SNAP); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); nudge(0, SNAP); return; }
    if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'z' || ev.key === 'Z')) { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); }
  }
  function onKeyUp(ev) { if (ev.key === ' ') { space = false; stage.classList.remove('space'); } }

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

  // ---- drag-to-spawn: 4px threshold, fixed-position ghost, drop must land
  // inside the cached stage rect MINUS the inspector inset.
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
    const head = ev.target.closest && ev.target.closest('.pal-grp');
    if (!head) return;
    const d = head.dataset.domain;
    if (collapsed.has(d)) collapsed.delete(d); else collapsed.add(d);
    paintPalette();
  }
  const onFilterInput = () => { query = hostEls.filter ? hostEls.filter.value : ''; applyFilter(hostEls.palette, query, collapsed); };

  let models = [];
  let efforts = [];
  let modelsSet = false;          // an explicit setModels() wins over the mount fetch
  const readKey = (k) => { try { return storage ? storage.getItem(k) : null; } catch { return null; } };
  const writeKey = (k, v) => { try { if (storage) storage.setItem(k, v); } catch { /* private mode */ } };

  function applyModels({ models: m = [], efforts: e = [] } = {}) {
    models = Array.isArray(m) ? m : [];
    efforts = Array.isArray(e) ? e : [];
    paintInspector();
  }

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

  /** The rail's two panes. Selection NEVER moves the tab (D2): a canvas click
   *  repaints Info silently, so placing a run of agents is never interrupted. */
  function setTab(name, { persist = false } = {}) {
    if (!hostEls.insRail) return;
    const tab = TABS.includes(name) ? name : TABS[0];
    hostEls.insRail.dataset.tab = tab;
    if (hostEls.insTabs) {
      for (const btn of hostEls.insTabs.querySelectorAll('[data-tab]')) {
        btn.setAttribute('aria-selected', btn.dataset.tab === tab ? 'true' : 'false');
        btn.tabIndex = btn.dataset.tab === tab ? 0 : -1;
      }
    }
    if (persist) writeKey(TAB_KEY, tab);
  }
  function onTabClick(ev) {
    const btn = ev.target.closest && ev.target.closest('[data-tab]');
    if (!btn) return;
    setTab(btn.dataset.tab, { persist: true });
  }

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
    // wf_${slugify(name)}. The one reserved id, wf_default, is never a target.
    if (!saveAs && tpl.id && tpl.id !== 'wf_default') body.id = tpl.id;
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
    hostEls.newBtn?.addEventListener('click', onNewCanvas);
    hostEls.errors?.addEventListener('click', onErrChip);
    view.world.addEventListener('click', onWorldClick);
    hostEls.palette?.addEventListener('pointerdown', onPalDown);
    hostEls.palette?.addEventListener('click', onPalClick);
    hostEls.filter?.addEventListener('input', onFilterInput);
    hostEls.insBody?.addEventListener('change', onInspectorChange);
    hostEls.insToggle?.addEventListener('click', onRailToggle);
    hostEls.insTabs?.addEventListener('click', onTabClick);
    hostEls.saveBtn?.addEventListener('click', onSaveClick);
    setRail(readKey(INSPECTOR_KEY) !== 'collapsed');
    setTab(readKey(TAB_KEY) || TABS[0]);
    // The model/effort lists are chrome, not graph state: pull them once through
    // the injected api so the inspector's selects are usable the moment the rail
    // opens. app.js may still call setModels() explicitly; that wins.
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
    return composer;
  }
  let ro = null;

  function destroy() {
    suspend();
    stage.removeEventListener('pointerdown', onDown);
    stage.removeEventListener('wheel', onWheel);
    hostEls.autoBtn?.removeEventListener('click', runAutoLayout);
    hostEls.newBtn?.removeEventListener('click', onNewCanvas);
    hostEls.errors?.removeEventListener('click', onErrChip);
    view.world.removeEventListener('click', onWorldClick);
    hostEls.palette?.removeEventListener('pointerdown', onPalDown);
    hostEls.palette?.removeEventListener('click', onPalClick);
    hostEls.filter?.removeEventListener('input', onFilterInput);
    hostEls.insBody?.removeEventListener('change', onInspectorChange);
    hostEls.insToggle?.removeEventListener('click', onRailToggle);
    hostEls.insTabs?.removeEventListener('click', onTabClick);
    hostEls.saveBtn?.removeEventListener('click', onSaveClick);
    endPalDrag();
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

  /** Load a saved template (or `null` for a fresh canvas). Resets undo + dirty.
   *  SYNCHRONOUS and UNGUARDED on purpose: this is the programmatic model API
   *  (tests, the CDP probe, initComposer's first paint). Every path a USER can
   *  click goes through newCanvas()/openTemplate(), which ask first. */
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
    mount, destroy, resume, suspend, commit, loadTemplate,
    fit, autoLayout: runAutoLayout, zoomAbout, undo, redo, undoDepth: () => undoStack.length, deleteSelection,
    spawn, paintPalette, paintInspector,
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
