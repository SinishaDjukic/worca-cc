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
  const onNewCanvas = () => composer.newCanvas();

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

  function mount() {
    empty = doc.createElement('div');
    empty.className = 'gv-empty';
    empty.textContent = EMPTY_STATE_COPY;
    hostEls.canvas.appendChild(empty);
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('wheel', onWheel, { passive: false });
    doc.addEventListener('keydown', onKeyDown);
    doc.addEventListener('keyup', onKeyUp);
    hostEls.autoBtn?.addEventListener('click', runAutoLayout);
    hostEls.newBtn?.addEventListener('click', onNewCanvas);
    hostEls.errors?.addEventListener('click', onErrChip);
    view.world.addEventListener('click', onWorldClick);
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
    stage.removeEventListener('wheel', onWheel);
    doc.removeEventListener('keydown', onKeyDown);
    doc.removeEventListener('keyup', onKeyUp);
    hostEls.autoBtn?.removeEventListener('click', runAutoLayout);
    hostEls.newBtn?.removeEventListener('click', onNewCanvas);
    hostEls.errors?.removeEventListener('click', onErrChip);
    view.world.removeEventListener('click', onWorldClick);
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
    fit, autoLayout: runAutoLayout, zoomAbout, undo, redo, undoDepth: () => undoStack.length, deleteSelection,
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
