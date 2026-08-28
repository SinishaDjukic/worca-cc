// ui/public/graph/run-hosts.mjs   (depth 3 below the repo root)
//
// The three run-graph HOSTS. One renderer (view.mjs) + one decor pass
// (run-decor.mjs) mounted with per-host mode, zoom clamp, wheel policy and
// sizing. Nothing here knows about the app's run model — app.js hands it a
// manifest + a decor bag and gets clicks back.
//
// Measurement: `viewport` is a FUNCTION `() => ({left, top, width, height})`
// (or null), handed VERBATIM to createGraphView; every size this module needs
// is `view.readRect()` — the ONE measurement path the renderer already owns.
// Bounds: `view.bounds(pad)` — the shared geometry over the RENDERED template
// with the footer rows the view actually painted (never a second band count).
import { createGraphView } from './view.mjs';
import { applyDecor, manifestAgents, manifestNodes, manifestPortsFn, manifestTemplate } from './run-decor.mjs';
import { fitBounds } from '../../../src/shared/graph/geometry.mjs';

export const STATIC_HOST_H = 300;      // D5: the Running list card's graph height
export const STATIC_INSET = 32;        // wrap padding allowance on both axes (16 each side)
export const DETAIL_MIN_H = 360, DETAIL_MAX_H = 600, DETAIL_PAD_H = 48;
export const HINT_TEXT = 'click to pan · ⌘+scroll to zoom';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Centre `b` (already padded) in a vw×vh viewport through the SHARED `fitBounds`;
 *  fit NEVER magnifies past 1× (spec §7.6). Returns the view's `{x, y, z}`. */
export function fitInto(b, vw, vh, { zoomMin = 0.3 } = {}) {
  const f = fitBounds(b, { width: vw, height: vh }, { zoomMin, zoomMax: 1 });
  return { x: f.tx, y: f.ty, z: f.z };
}

/** The node-id set as a string — a change of it is the ONE structural change
 *  short of a new run (the manifest is never rewritten mid-run, spec §5.8). */
const nodeSig = (stepper) => manifestNodes(stepper).map((n) => n.id).join(',');

export function mountRunGraph(hostEl, opts = {}) {
  const { mode = 'monitor', doc = hostEl.ownerDocument, raf = null, viewport = null,
    onRowClick = null, onGateClick = null, onResultClick = null } = opts;
  const wrap = hostEl.closest('.run-flow-wrap') || hostEl.parentElement || hostEl;
  const win = doc.defaultView || globalThis;
  const isStatic = mode === 'static';
  const zoomMin = 0.3, zoomMax = isStatic ? 1 : 1.6;

  let view = null, stepper = null, decor = null, runId = null, expanded = null, ro = null, lastFit = null, bound = false;
  // The last width `view.readRect()` reported. A host inside a `display:none`
  // subtree (compact density, a closed detail) measures 0×0, and both fitters
  // BAIL on that rather than poison the transform / --run-host-h with it; the
  // first paint that sees a real box has to re-fit even when nothing structural
  // changed, or the graph keeps the transform it had while it was hidden.
  let lastRectW = 0;
  const listeners = [];
  const on = (target, type, fn, o) => { target.addEventListener(type, fn, o); listeners.push([target, type, fn, o]); };

  /** True until the user pans or zooms away from the last auto-fit. */
  const untouched = () => {
    if (!view || !lastFit) return true;
    const t = view.getTransform();
    return Math.abs(t.x - lastFit.x) < 0.5 && Math.abs(t.y - lastFit.y) < 0.5 && Math.abs(t.z - lastFit.z) < 1e-6;
  };

  // Static (the Running list card): fit BOTH axes into (width − 32, 300 − 32),
  // 0.3–1×. CSS scrollable overflow only extends rightwards, so a graph that is
  // wider than the card even at the 0.3 floor is LEFT-aligned and the host is
  // widened inline; `.gv-wrap-static{overflow-x:auto}` then scrolls it natively.
  function fitStatic() {
    // FIRST, before ANY measurement: `.gv-stage` is `inset:0` inside
    // `.run-flow.gv-host`, so `view.readRect()` returns the HOST's box — including
    // the inline width this very function writes on the wide branch. Leaving it on
    // would make the next fit measure the widened host, take the centred branch,
    // clear the width, and take the wide branch again: consecutive fits oscillate.
    hostEl.style.width = '';
    const r = view.readRect();
    if (!(r.width > 0)) return;                 // hidden host (0×0): nothing to fit into
    const b = view.bounds(16);
    if (!b) return;
    const vw = Math.max(1, r.width - STATIC_INSET), vh = STATIC_HOST_H - STATIC_INSET;
    const f = fitInto(b, vw, vh, { zoomMin });
    const sw = b.w * f.z;
    if (sw > vw) {
      hostEl.style.width = `${Math.ceil(sw + STATIC_INSET)}px`;
      view.setTransform({ x: 16 - b.x * f.z, y: 16 + f.y, z: f.z });
    } else {
      hostEl.style.width = '';
      view.setTransform({ x: 16 + f.x, y: 16 + f.y, z: f.z });
    }
  }

  // Monitor (the detail pages), two-pass: the WIDTH decides the zoom, the zoom
  // decides the host height (clamp 360..600 via --run-host-h on the wrap), then
  // both axes fit into (width, hostH). `applyTransform: false` is the height
  // pass alone — a touched view keeps its pan/zoom while a taller card lands.
  function fitMonitor(applyTransform) {
    const r = view.readRect();
    if (!(r.width > 0)) return;                 // hidden host (0×0): a 0-width fit would
    const b = view.bounds(24);                  // pin --run-host-h at the 360px floor and
    if (!b) return;                             // zoom to the 0.3 clamp for good.
    const vw = Math.max(1, r.width);
    const zw = clamp(Math.min(vw / b.w, 1), zoomMin, 1);
    const hostH = clamp(Math.round((b.h - 48) * zw + DETAIL_PAD_H), DETAIL_MIN_H, DETAIL_MAX_H);   // b is padded 24 each side
    wrap.style.setProperty('--run-host-h', `${hostH}px`);
    if (applyTransform) view.setTransform(fitInto(b, vw, hostH, { zoomMin }));
  }

  function fit() {
    if (!view || !stepper) return;
    if (isStatic) fitStatic(); else fitMonitor(true);
    lastFit = view.getTransform();
  }
  /** The size pass without the transform (monitor only; static hosts never grow). */
  function sizeHost() {
    if (!view || !stepper || isStatic) return;
    fitMonitor(false);
  }
  /** Re-fit while the user has not touched the view; otherwise only re-size the host. */
  function refit() { if (untouched()) fit(); else sizeHost(); }

  function paint() {
    if (!view || !decor) return;
    applyDecor(view, { ...decor, expanded });
  }

  function mount() {
    // `.run-flow` is the v1 flex column box (padding 66/52, width:max-content).
    // The v2 renderer's `.gv-stage{position:absolute;inset:0}` would fill THAT
    // padding box, not the wrap — `.gv-host` / `.gv-wrap-*` (style.css) reset it.
    hostEl.classList.add('gv-host');
    wrap.classList.add('gv-wrap', isStatic ? 'gv-wrap-static' : 'gv-wrap-monitor');
    view = createGraphView(hostEl, { mode, doc, raf, viewport,
      portsFn: manifestPortsFn(stepper), agents: manifestAgents(stepper), zoomMin, zoomMax,
      wheelPan: isStatic ? 'always' : 'engaged' });
    // The view never auto-binds a nav: monitor hosts ask for one (D8 engaged-only)
    // and learn engagement from it — run-hosts keeps NO engagement state of its own,
    // and view.destroy() destroys every nav, so the handle is not kept.
    if (!isStatic) view.createNav({ wheelPan: 'engaged', onEngaged: (engaged) => wrap.classList.toggle('rg-engaged', engaged) });
  }

  function update(nextRunId, nextStepper, nextDecor) {
    const runChanged = nextRunId !== runId;
    const structural = !view || runChanged || nodeSig(nextStepper) !== nodeSig(stepper);
    const sameBag = !structural && nextDecor === decor;
    if (runChanged) { runId = nextRunId; expanded = null; lastFit = null; }   // one node open per surface; a new run is a new build
    // A node-set change needs a view whose portsFn/headers read the NEW manifest.
    if (view && structural && nodeSig(nextStepper) !== nodeSig(stepper)) { view.destroy(); view = null; lastFit = null; }
    stepper = nextStepper; decor = nextDecor;
    if (!view) mount();
    if (!bound) { bind(); bound = true; }
    if (structural) view.render(manifestTemplate(stepper), {});   // the O(n) wire rewrite: structural only
    if (!sameBag) paint();                                       // statuses/footers/badges: fast paths
    // A host that was hidden (0×0) when it was last painted never got a real fit:
    // re-fit on the first paint that sees a box, structural or not.
    const rectW = view.readRect().width || 0;
    const revealed = rectW > 0 && !(lastRectW > 0);
    lastRectW = rectW;
    if ((structural || revealed) && untouched()) fit();
  }

  function bind() {
    if (!isStatic) {
      const hint = doc.createElement('div');
      hint.className = 'rg-hint';
      hint.textContent = HINT_TEXT;
      wrap.appendChild(hint);
      // (engage/disengage listeners live in the view's nav — see mount() above)
      on(hostEl, 'click', (e) => {
        const toggle = e.target.closest && e.target.closest('.xtoggle');
        if (toggle) { expanded = expanded === toggle.dataset.nodeId ? null : toggle.dataset.nodeId; paint(); refit(); return; }
        const link = e.target.closest && e.target.closest('.xresult a');
        if (link) { e.preventDefault(); if (onResultClick) onResultClick(link.dataset.path); return; }
        const gate = e.target.closest && e.target.closest('.ngate');
        if (gate) { if (onGateClick) onGateClick(gate.dataset.wireId); return; }
        const row = e.target.closest && e.target.closest('.xrow');
        if (row && onRowClick) onRowClick(row.dataset.executionId, row.dataset.nodeId);
      });
    }
    // jsdom has no ResizeObserver — guard through the document's window (P5's idiom).
    if (typeof win.ResizeObserver === 'function') {
      ro = new win.ResizeObserver(() => { if (isStatic) fit(); else refit(); });
      ro.observe(wrap);
    }
  }

  function destroy() {
    for (const [t, type, fn, o] of listeners) t.removeEventListener(type, fn, o);
    listeners.length = 0;
    if (ro) { try { ro.disconnect(); } catch { /* jsdom */ } ro = null; }
    const hint = wrap.querySelector(':scope > .rg-hint');
    if (hint) hint.remove();
    if (view) { view.destroy(); view = null; }   // view.destroy() tears every nav down
    hostEl.classList.remove('gv-host');
    wrap.classList.remove('gv-wrap', 'gv-wrap-static', 'gv-wrap-monitor', 'rg-engaged');
    wrap.style.removeProperty('--run-host-h');
    hostEl.style.width = '';
    hostEl.innerHTML = '';
    lastFit = null;
    lastRectW = 0;
    // bind() is called once per mount, guarded by `bound`. destroy() removed every
    // listener, the hint chip and the ResizeObserver, so a later update() must be
    // allowed to bind them again — otherwise the re-mounted view is inert.
    bound = false;
  }

  return { update, fit, destroy, get view() { return view; } };
}
