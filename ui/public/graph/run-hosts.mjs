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
import { fitBounds, ZOOM_STEP } from '../../../src/shared/graph/geometry.mjs';

export const STATIC_HOST_H = 300;      // D5: the Running list card's graph height
export const STATIC_INSET = 32;        // wrap padding allowance on both axes (16 each side)
export const DETAIL_MIN_H = 360, DETAIL_MAX_H = 600, DETAIL_PAD_H = 48;
export const HINT_TEXT = 'drag to pan · ⌘/ctrl+scroll to zoom';
/** px of monitor canvas the nav cluster owns: 30px button + 12px inset + 12px air.
 *  The composer reserves `insetRight` for its rail for exactly this reason — the
 *  cluster is opaque and clickable, and an auto-fit that ignores it parks the
 *  bottom-right card's .xtoggle strip underneath. */
export const NAV_INSET = 54;
/** The cluster's three buttons: [data-nav, label, glyph]. The glyphs are the
 *  composer's (ui/public/index.html #gv-nav) so both canvases read identically. */
const NAV_BTNS = [
  ['in', 'Zoom in', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke-linecap="round"></path></svg>'],
  ['out', 'Zoom out', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M5 12h14" stroke-linecap="round"></path></svg>'],
  ['center', 'Fit graph to view', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="2.5"></rect><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"></circle></svg>'],
];
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
    onRowClick = null, onGateClick = null, onResultClick = null, onNodeClick = null } = opts;
  const wrap = hostEl.closest('.run-flow-wrap') || hostEl.parentElement || hostEl;
  const win = doc.defaultView || globalThis;
  const isStatic = mode === 'static';
  const zoomMin = 0.3, zoomMax = isStatic ? 1 : 1.6;

  let view = null, stepper = null, decor = null, runId = null, expanded = null, ro = null, lastFit = null, bound = false, nav = null;
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
    const vw = Math.max(1, r.width - NAV_INSET);   // the cluster is opaque and clickable
    const zw = clamp(Math.min(vw / b.w, 1), zoomMin, 1);
    const hostH = clamp(Math.round((b.h - 48) * zw + DETAIL_PAD_H), DETAIL_MIN_H, DETAIL_MAX_H);   // b is padded 24 each side
    wrap.style.setProperty('--run-host-h', `${hostH}px`);
    if (applyTransform) view.setTransform(fitInto(b, vw, hostH, { zoomMin }));
  }

  /** Stage-local centre of the host box — the point the buttons zoom about.
   *  Reads the rect itself: the host may have resized since the last fit. */
  function hostCenter() {
    const r = view.readRect();
    return { x: (r.width || 0) / 2, y: (r.height || 0) / 2 };
  }
  /** One discrete zoom press; view.zoomAbout owns the zoomMin..zoomMax clamp. */
  function zoomStep(mult) {
    if (!view) return;
    const c = hostCenter();
    view.zoomAbout(view.getTransform().z * mult, c.x, c.y);
    paintNav();
  }
  /** The cluster's only state: a button that cannot move is disabled. Guarded —
   *  a static host never builds a cluster, and destroy() drops it. */
  function paintNav() {
    if (!nav || !view) return;
    const z = view.getTransform().z;
    nav.querySelector('[data-nav="in"]').disabled = z >= zoomMax - 1e-9;
    nav.querySelector('[data-nav="out"]').disabled = z <= zoomMin + 1e-9;
  }
  function buildNav() {
    nav = doc.createElement('div');
    nav.className = 'gv-nav';
    for (const [key, label, glyph] of NAV_BTNS) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'gv-nav-btn';
      b.dataset.nav = key;
      b.setAttribute('aria-label', label);
      b.title = label;
      b.innerHTML = glyph;                        // a literal from this module, never run data
      nav.appendChild(b);
    }
    // A SIBLING of the stage, like .rg-hint: a press on a button can never reach
    // the drag pipeline (the rule the composer's own cluster follows).
    wrap.appendChild(nav);
    on(nav, 'click', (e) => {
      const btn = e.target.closest && e.target.closest('.gv-nav-btn');
      if (!btn) return;
      if (btn.dataset.nav === 'in') zoomStep(ZOOM_STEP);
      else if (btn.dataset.nav === 'out') zoomStep(1 / ZOOM_STEP);
      else fit();                                 // Center = zoom-to-fit, and it re-arms the auto re-fit
    });
  }

  function fit() {
    if (!view || !stepper) return;
    if (isStatic) fitStatic(); else fitMonitor(true);
    lastFit = view.getTransform();
    paintNav();
  }
  /** The size pass without the transform (monitor only; static hosts never grow). */
  function sizeHost() {
    if (!view || !stepper || isStatic) return;
    fitMonitor(false);
  }
  /** Re-fit while the user has not touched the view; otherwise only re-size the host. */
  function refit() { if (untouched()) fit(); else sizeHost(); }

  // Per-HOST, never on the decor bag: runDecorFor memoises one bag per mode and
  // documents it as immutable, so stamping this on it would hand the answer to
  // every other consumer of that memo. It rides the same spread `expanded` does.
  let opensPanel = false;

  function paint() {
    if (!view || !decor) return;
    applyDecor(view, { ...decor, expanded, opensPanel });
  }

  function mount() {
    // `.run-flow` is the v1 flex column box (padding 66/52, width:max-content).
    // The v2 renderer's `.gv-stage{position:absolute;inset:0}` would fill THAT
    // padding box, not the wrap — `.gv-host` / `.gv-wrap-*` (style.css) reset it.
    hostEl.classList.add('gv-host');
    wrap.classList.add('gv-wrap', isStatic ? 'gv-wrap-static' : 'gv-wrap-monitor');
    view = createGraphView(hostEl, { mode, doc, raf, viewport,
      portsFn: manifestPortsFn(stepper), agents: manifestAgents(stepper), zoomMin, zoomMax });
    // The view never auto-binds a nav: monitor hosts ask for one. There is no
    // engagement state any more — a plain wheel is always the page's (D2) — and
    // onTransform is how a wheel zoom or a drag repaints the cluster.
    if (!isStatic) view.createNav({ onTransform: paintNav });
  }

  function update(nextRunId, nextStepper, nextDecor, { opensPanel: nextOpens = false } = {}) {
    const runChanged = nextRunId !== runId;
    const structural = !view || runChanged || nodeSig(nextStepper) !== nodeSig(stepper);
    // `opensPanel` joins the fast-path test: it is NOT on the bag, so an unchanged
    // bag identity would otherwise skip the paint that has to strip or restamp the
    // cards' trigger semantics.
    const sameBag = !structural && nextDecor === decor && nextOpens === opensPanel;
    opensPanel = nextOpens;
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
      buildNav();
      paintNav();
      // (the wheel + drag gestures live in the view's nav — see mount() above)
      on(hostEl, 'click', (e) => {
        const toggle = e.target.closest && e.target.closest('.xtoggle');
        if (toggle) { expanded = expanded === toggle.dataset.nodeId ? null : toggle.dataset.nodeId; paint(); refit(); return; }
        const link = e.target.closest && e.target.closest('.xresult a');
        if (link) { e.preventDefault(); if (onResultClick) onResultClick(link.dataset.path); return; }
        const gate = e.target.closest && e.target.closest('.ngate');
        if (gate) { if (onGateClick) onGateClick(gate.dataset.wireId); return; }
        // `if (row) { if (onRowClick) …; return; }`, the shape `.ngate` uses one
        // line up — NOT `if (row && onRowClick)`. A host mounted without an
        // onRowClick would otherwise fall through to the card branch below and
        // open the retune popover from a click on an execution log row.
        const row = e.target.closest && e.target.closest('.xrow');
        if (row) { if (onRowClick) onRowClick(row.dataset.executionId, row.dataset.nodeId); return; }
        // LAST in the chain on purpose: every ornament above (.xtoggle, .xresult a,
        // .ngate, .xrow) lives INSIDE a card, so a card handler placed earlier would
        // swallow them all. `mode:'static'` never enters this block, so the
        // Running-list card stays inert.
        const card = e.target.closest && e.target.closest('.node[data-node-id]');
        if (card && onNodeClick) onNodeClick(card.dataset.nodeId, card);
      });
      // Cards carry tabindex="0" (view.mjs:392-396), so the keyboard must reach the
      // same action. Registered through the tracked `on()` helper, so destroy()
      // removes it with everything else.
      //
      // It matches the CARD ITSELF and never walks up to one, which is the
      // keyboard mirror of the click chain's ornament exclusions: `.xfoot` is a
      // CHILD of the card (view.mjs:618) and two of its bands are natively
      // keyboard-activatable — `.xtoggle` is a <button> (view.mjs:276-277) and
      // `.xresult a` is an <a href> (view.mjs:292-294). For both, the activation
      // click IS the keydown's default action, so resolving an ancestor card and
      // calling preventDefault() would cancel it and leave the footer toggle and
      // the artifact links dead to the keyboard — on History too, where the
      // callback's own guard returns and the keypress then does nothing at all.
      // The card is where focus lands when the card is what the user tabbed to,
      // so this stays correct for any ornament added later, with no second
      // exclusion list to keep in sync.
      //
      // preventDefault() is CONDITIONAL on the callback reporting that it acted.
      // onNodeClick has screen guards of its own (History, a settled run, a
      // non-agent card) and returns false when it declines; swallowing the key
      // anyway would leave Space on a focused History card doing nothing at all,
      // where it used to page-scroll the detail body. Calling preventDefault()
      // after the callback is still in time — it only has to happen somewhere
      // inside this handler, not before the work.
      // The card whose last real activation was consumed, or null. Auto-repeats
      // mirror that verdict rather than re-deciding — but only for the SAME card:
      // a bare boolean let a repeat that arrived after focus moved apply one card's
      // verdict to another. The state describes one key-press, so it is keyed by
      // the element the press landed on.
      let heldOn = null;
      on(hostEl, 'keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        // BOTH guards come first. An `e.repeat` bail placed above them would
        // preventDefault every held Enter/Space anywhere in the host — including
        // on the background, where no card is involved at all, and on a History
        // card whose callback declines: the first press would scroll and every
        // repeat after it would jam.
        if (!onNodeClick || !e.target.matches || !e.target.matches('.node[data-node-id]')) return;
        // Auto-repeat is NOT a second activation. The retune popover toggles when
        // reopened on the same anchor, so a held key would strobe it ~30×/s —
        // opening and closing, focus ping-ponging between the card and the panel's
        // first select, with no way to land on a stable panel until the user lets
        // go. The repeat still inherits the first press's verdict, so a held key
        // over an OPEN popover does not scroll the detail body out from under it.
        if (e.repeat) { if (heldOn === e.target) e.preventDefault(); return; }
        const consumed = onNodeClick(e.target.dataset.nodeId, e.target) !== false;
        heldOn = consumed ? e.target : null;
        if (consumed) e.preventDefault();   // Space would otherwise scroll
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
    if (nav) { nav.remove(); nav = null; }
    if (view) { view.destroy(); view = null; }   // view.destroy() tears every nav down
    hostEl.classList.remove('gv-host');
    wrap.classList.remove('gv-wrap', 'gv-wrap-static', 'gv-wrap-monitor');
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
