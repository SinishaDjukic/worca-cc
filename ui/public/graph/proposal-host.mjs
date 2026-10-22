// ui/public/graph/proposal-host.mjs   (depth 3 below the repo root)
//
// The chat's PROPOSAL well: Ask Worca's build_workflow and propose_workflow (Auto) cards draw a workflow that has not
// run exactly as the Workflows canvas draws it — the same renderer (view.mjs) on layout 'auto': the template's own x/y,
// scale 1, every wire routed into orthogonal lanes (lanes.mjs), loops under the cards with their ≤N pill, the
// description footer. It behaves like the chat run card's well (run-hosts.mjs `card`): drag pans, shift+wheel or a
// mostly horizontal wheel pans, ⌘/ctrl+wheel zooms, a plain vertical wheel stays the chat's scroll, and a pan or zoom
// never leaves the graph. Unlike it there is no run decor and no follow camera, and the well OPENS AT ZOOM 1: a graph
// wider than the well pans; it never shrinks to fit or re-flows into rows. The nav cluster is the run monitor's (same
// glyphs, .gv-nav / .gv-nav-btn) plus Expand, which hands the workflow to the host (the Workflows composer).
//
// Measurement: `viewport` (a function, or null) is handed VERBATIM to createGraphView; the width is view.readRect()'s.
// The well height comes from the MODEL bounds at zoom 1 (view.bounds), so it is right before the card is attached.
import { createGraphView } from './view.mjs';
import { NAV_BTNS, NAV_INSET, fitInto } from './run-hosts.mjs';
import { autoLayout } from '../../../src/shared/graph/layout.mjs';
import { ZOOM_STEP } from '../../../src/shared/graph/geometry.mjs';

/** The well height: the graph's padded height at zoom 1, clamped (the chat run card's CARD_MIN_H..CARD_MAX_H rule). */
export const WELL_MIN_H = 220, WELL_MAX_H = 480, WELL_PAD = 24;
/** Zoom: out to the run monitor's 0.3 floor, in to 1 — never past the canvas's own card size. */
export const WELL_ZOOM_MIN = 0.3, WELL_ZOOM_MAX = 1;
export const EXPAND_LABEL = 'Open full screen in Workflows';
/** The chat run card's Expand arrows (chat/run-card.mjs ICONS.expand), drawn at NAV_BTNS' size. */
const EXPAND_GLYPH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"></path></svg>';
const KEYED = new Set(['agent', 'script']);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isNode = (n) => Boolean(n) && typeof n === 'object' && !Array.isArray(n) && typeof n.id === 'string';

/** The template a well draws. `restack`: the canvas's own auto-layout re-run with the heights this well draws — the
 *  description footer, and the chip band when `band`. An Auto proposal was laid out WITHOUT either (assemble.mjs), so
 *  its stacked cards (a parallel group, the OR valve) would overlap. x is kept (layout.mjs ranks deterministically); the
 *  y of a stacked column, or of a card fed only by loop wires (placed below its taller source), can move. A
 *  build_workflow graph is laid out for the footer already: no restack. */
export function wellTemplate(template, portsFn, { restack = false, band = false } = {}) {
  if (!restack) return template;
  const pos = autoLayout(template, portsFn, { describe: true, band });
  return { ...template, nodes: (template.nodes || []).map((n) => (isNode(n) && pos[n.id] ? { ...n, x: pos[n.id].x, y: pos[n.id].y } : n)) };
}

/** Placement order: left to right, then top to bottom — the aria label and the build animation (auto-build.mjs) read it. */
export function readingOrder(template) {
  return ((template && template.nodes) || []).filter(isNode)
    .map((n) => ({ id: n.id, x: Number(n.x) || 0, y: Number(n.y) || 0 }))
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((n) => n.id);
}

/** The registry the cards read, each keyed node's meta carrying `of(key)` as its description (the composer's footer
 *  text). A key `of` has no text for keeps whatever it had. */
function withDescriptions(agents, tpl, of) {
  const out = { ...(agents || {}) };
  if (typeof of !== 'function') return out;
  for (const n of tpl.nodes || []) {
    if (!isNode(n) || !KEYED.has(n.kind) || !n.key) continue;
    const text = String(of(n.key) || '');
    if (text) out[n.key] = { ...(out[n.key] || {}), description: text };
  }
  return out;
}

/**
 * @param {HTMLElement} hostEl  the well (.ask-wfcard-graph): the stage fills it, the nav cluster is its last child
 * @param {object} template      the workflow (manifestTemplate(manifest)); never mutated
 * @param {{doc?:Document, raf?:Function|null, viewport?:Function|null, portsFn:Function, agents?:object,
 *          band?:((node:object)=>object|null)|null, restack?:boolean, descriptionOf?:((key:string)=>string)|null,
 *          onExpand?:(()=>unknown)|null}} opts
 * @returns {{view:object, order:string[], template():object, height():number, relayout():void, fit():void,
 *            setDescriptions(of:(key:string)=>string):boolean, destroy():void}}
 */
export function mountProposalGraph(hostEl, template, {
  doc = hostEl.ownerDocument, raf = null, viewport = null, portsFn, agents = {}, band = null,
  restack = false, descriptionOf = null, onExpand = null,
} = {}) {
  const win = doc.defaultView || globalThis;
  const hasBand = typeof band === 'function';
  const tpl = wellTemplate(template, portsFn, { restack, band: hasBand });
  let meta = withDescriptions(agents, tpl, descriptionOf);
  const view = createGraphView(hostEl, { doc, mode: 'monitor', layout: 'auto', scale: 1, describe: true, portsFn,
    agents: meta, band: hasBand ? band : null, raf, viewport, zoomMin: WELL_ZOOM_MIN, zoomMax: WELL_ZOOM_MAX });
  hostEl.classList.add('gv-well');
  view.render(tpl, {});
  // No dead tab stops (the chat run card's rule): the stage and the cards are skipped. A pickable chip (a <button>)
  // and the nav buttons stay in the tab order.
  for (const n of [view.stage, ...hostEl.querySelectorAll('.node[tabindex]')]) n.setAttribute('tabindex', '-1');

  const listeners = [];
  const on = (target, type, fn, o) => { target.addEventListener(type, fn, o); listeners.push([target, type, fn, o]); };
  let wellH = WELL_MIN_H, last = null, lastW = 0, placed = 'open', nav = null, ro = null, expanding = false, dead = false;

  /** The well's height: the padded graph at zoom 1, clamped. Set once — no width, band or description changes it. */
  function sizeWell() {
    const b = view.bounds(WELL_PAD);
    wellH = b ? clamp(Math.ceil(b.h), WELL_MIN_H, WELL_MAX_H) : WELL_MIN_H;
    hostEl.style.height = `${wellH}px`;
  }
  /** The span the graph may use across: the well minus the nav cluster's column (NAV_INSET), so neither a placement
   *  nor a clamp parks a card under the buttons. 0 while the well is unmeasured (detached, hidden). */
  function spanX() {
    const w = view.readRect().width || 0;
    return w > 0 ? Math.max(1, w - NAV_INSET) : 0;
  }
  /** One axis of the well's rule (run-hosts clampCard): an axis that fits is centred, a longer one never shows past
   *  either end of the graph. */
  const axis = (v, span, lo, size, z) => {
    const s = size * z;
    return s <= span ? (span - s) / 2 - lo * z : clamp(v, span - (lo * z + s), -lo * z);
  };
  function clampWell(t) {
    const b = view.bounds(WELL_PAD);
    if (!b) return t;
    const sx = spanX();
    return { x: sx ? axis(t.x, sx, b.x, b.w, t.z) : t.x, y: axis(t.y, wellH, b.y, b.h, t.z), z: t.z };
  }
  /** `open`: zoom 1, an axis that fits centred, a longer one at its start edge. `fit` (the Center button): the whole
   *  graph, ≤ 1×, down to WELL_ZOOM_MIN. Unmeasured, both are the start edge at zoom 1 — the first relayout() that
   *  sees a width places it for real. */
  function place(kind = placed) {
    const b = view.bounds(WELL_PAD);
    if (!b) return;
    placed = kind;
    const sx = spanX();
    const t = !sx ? { x: -b.x, y: axis(-b.y, wellH, b.y, b.h, 1), z: 1 }
      : kind === 'fit' ? clampWell(fitInto(b, sx, wellH, { zoomMin: WELL_ZOOM_MIN }))
        : clampWell({ x: -b.x, y: -b.y, z: 1 });
    view.setTransform(t);
    last = view.getTransform();
    lastW = sx;
    paintNav();
  }
  /** True until the user pans or zooms away from the last placement. */
  function untouched() {
    if (!last) return true;
    const t = view.getTransform();
    return Math.abs(t.x - last.x) < 0.5 && Math.abs(t.y - last.y) < 0.5 && Math.abs(t.z - last.z) < 1e-6;
  }
  /** The well changed width (the chat column resized, the card attached). NEVER moves a node: an untouched view is
   *  placed again (as it was last placed), one the user panned or zoomed only stays inside the well. */
  function relayout() {
    if (dead) return;
    const sx = spanX();
    if (!sx) return;
    if (untouched()) { if (sx !== lastW) place(); return; }
    view.setTransform(clampWell(view.getTransform()));
  }
  /** The cluster's only state: a button that cannot move is disabled. */
  function paintNav() {
    if (!nav) return;
    const z = view.getTransform().z;
    nav.querySelector('[data-nav="in"]').disabled = z >= WELL_ZOOM_MAX - 1e-9;
    nav.querySelector('[data-nav="out"]').disabled = z <= view.zoomFloor() + 1e-9;
  }
  /** One zoom press about the well's centre; view.zoomAbout owns the WELL_ZOOM_MIN..1 clamp. */
  function zoomStep(mult) {
    const sx = spanX() || (view.readRect().width || 0);
    view.zoomAbout(view.getTransform().z * mult, sx / 2, wellH / 2);
    view.setTransform(clampWell(view.getTransform()));
    paintNav();
  }
  /** Expand: the host opens the workflow in the composer. One at a time — in flight the button is aria-disabled, never
   *  `disabled` (Chrome moves the focus of a button that turns disabled to <body>; workflows/card-views.mjs cardKit).
   *  The host is called synchronously: a click's user activation must reach a navigation. */
  function expand(btn) {
    if (expanding) return;
    expanding = true;
    btn.setAttribute('aria-disabled', 'true');
    let pending = null;
    try { pending = onExpand(); } catch { pending = null; }
    Promise.resolve(pending).catch(() => {}).finally(() => { expanding = false; btn.removeAttribute('aria-disabled'); });
  }
  function buildNav() {
    nav = doc.createElement('div');
    nav.className = 'gv-nav';
    const buttons = typeof onExpand === 'function' ? [...NAV_BTNS, ['expand', EXPAND_LABEL, EXPAND_GLYPH]] : NAV_BTNS;
    for (const [key, label, glyph] of buttons) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-icon gv-nav-btn';
      b.dataset.nav = key;
      b.setAttribute('aria-label', label);
      b.title = label;
      b.innerHTML = glyph;                        // a literal from this module or run-hosts, never proposal data
      nav.appendChild(b);
    }
    // A SIBLING of the stage (run-hosts buildNav's rule): a press on a button never reaches the drag pipeline.
    hostEl.appendChild(nav);
    on(nav, 'click', (e) => {
      const btn = e.target.closest && e.target.closest('.gv-nav-btn');
      if (!btn || btn.disabled) return;
      if (btn.dataset.nav === 'in') zoomStep(ZOOM_STEP);
      else if (btn.dataset.nav === 'out') zoomStep(1 / ZOOM_STEP);
      else if (btn.dataset.nav === 'center') place('fit');
      else if (btn.dataset.nav === 'expand') expand(btn);
    });
  }

  sizeWell();
  buildNav();
  // Drag pans and ⌘/ctrl+wheel zooms (the view's nav); every such write is kept inside the well.
  view.createNav({ onTransform: (t) => {
    const c = clampWell(t);
    if (c.x !== t.x || c.y !== t.y) view.setTransform(c);   // a programmatic write never re-enters the nav
    paintNav();
  } });
  // The chat's wheel policy (run-hosts `card`): a plain vertical wheel stays the chat's scroll; shift+wheel or a
  // mostly horizontal wheel (trackpads) pans along the graph; ⌘/ctrl+wheel is the nav's zoom.
  on(hostEl, 'wheel', (e) => {
    if (e.ctrlKey || e.metaKey) return;
    const dx = e.shiftKey ? (e.deltaX || e.deltaY) : (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0);
    if (!dx) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (view.readRect().width || 400) : 1;
    const t = view.getTransform();
    view.setTransform(clampWell({ x: t.x - dx * unit, y: t.y, z: t.z }));
  }, { passive: false });
  place('open');
  // jsdom has no ResizeObserver — guard through the document's window (run-hosts' idiom).
  if (typeof win.ResizeObserver === 'function') {
    ro = new win.ResizeObserver(() => relayout());
    ro.observe(hostEl);
  }

  /** The library's descriptions landed: repaint the footers' TEXT (view.repaintMeta). Their height is fixed, so no card
   *  moves and no wire is rewritten (a running build animation keeps its hidden wires). False when nothing changed. */
  function setDescriptions(of) {
    if (dead) return false;
    const next = withDescriptions(meta, tpl, of);
    const changed = Object.keys(next).some((k) => ((next[k] || {}).description || '') !== ((meta[k] || {}).description || ''));
    if (!changed) return false;
    meta = next;
    view.repaintMeta(meta);
    return true;
  }
  function destroy() {
    if (dead) return;
    dead = true;
    for (const [t, type, fn, o] of listeners.splice(0)) t.removeEventListener(type, fn, o);
    if (ro) { try { ro.disconnect(); } catch { /* jsdom */ } ro = null; }
    if (nav) { nav.remove(); nav = null; }
    view.destroy();                                // tears the view's own nav (drag + ⌘/ctrl-wheel) down too
    hostEl.classList.remove('gv-well');
    hostEl.style.removeProperty('height');
  }

  return { view, order: readingOrder(tpl), template: () => tpl, height: () => wellH, relayout, fit: () => place('fit'), setDescriptions, destroy };
}
