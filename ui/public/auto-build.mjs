// ui/public/auto-build.mjs
// The workflow card's BUILD choreography (mockup 2026-09-05 §B + §F "Motion"): the four-step trace while
// propose_workflow runs (heuristic timing — no child→parent IPC, PD13) and the staged reveal of the REAL graph once
// the proposed payload lands (cards in placement order, a wire after both ends, badges + match line last).
// Pure DOM + injected timers; prefers-reduced-motion ⇒ everything lands at once. Names no agent key.
const SVG_NS = 'http://www.w3.org/2000/svg';
const EASE_NODE_MS = 140;     // stagger between cards
const WIRE_AFTER_MS = 120;    // a wire draws this long after its later end landed
const TAIL_MS = 420;          // badges + match line after the last card

export const BUILD_STEPS = Object.freeze([
  ['Reading agent cards', 'meta + frontmatter'],
  ['Sizing the task', 'kind · size · signals'],
  ['Assembling the graph', 'cards and wires'],
  ['Checking saved workflows', 'exact-topology match'],
]);
/** ms after START at which steps 0..2 turn live; step 3 turns live only with the proposed flip (the element is replaced). */
export const TRACE_TIMING = Object.freeze({ task: [0, 600, 2000], shape: [0, 0, 400] });

export function prefersReducedMotion(win) {
  try { return !!(win && win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
}

const h = (doc, tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

/** The trace list of the building card. */
export function buildTrace(doc, { mode = 'task' } = {}) {
  const ul = h(doc, 'ul', 'ask-wfcard-trace');
  ul.setAttribute('aria-live', 'polite');
  const steps = BUILD_STEPS.map(([labelText, meter], i) => {
    const li = h(doc, 'li', 'ask-wfcard-step');
    const ico = h(doc, 'span', 'st-ico'); ico.appendChild(h(doc, 'span', 'st-dot'));
    const check = doc.createElementNS(SVG_NS, 'svg'); check.setAttribute('viewBox', '0 0 24 24'); check.setAttribute('class', 'st-check'); check.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS(SVG_NS, 'path'); path.setAttribute('d', 'M5 13l4 4L19 7'); check.appendChild(path); ico.appendChild(check);
    const label = h(doc, 'span', 'st-label', mode === 'shape' && i === 1 ? 'Checking the shape' : labelText);
    const met = h(doc, 'span', 'st-meter', '');
    li.append(ico, label, met); ul.appendChild(li);
    return { li, met, meter };
  });
  const setStep = (n, meterText = null) => {
    steps.forEach((s, i) => {
      s.li.classList.toggle('is-done', i < n);
      s.li.classList.toggle('is-live', i === n);
      s.met.textContent = i < n ? s.meter : (i === n && meterText != null ? meterText : '');
    });
  };
  setStep(0);
  return { el: ul, setStep };
}

/** Advance the trace on the heuristic clock; returns stop(). */
export function scheduleTrace(trace, { win = globalThis, mode = 'task' } = {}) {
  const at = TRACE_TIMING[mode] || TRACE_TIMING.task;
  const timers = at.map((ms, i) => win.setTimeout(() => trace.setStep(i), ms));
  return () => { for (const t of timers) win.clearTimeout(t); };
}

/**
 * Reveal a mounted proposal's graph in placement order. `handle` = renderAutoProposal's return (its `graph` view is
 * mountStaticGraph's handle: flowLayout().order, nodeEl, wiresEl, world, template). Returns cancel() — which LANDS
 * everything (used when the card element is dropped mid-build).
 */
export function playAssembly(handle, { win = globalThis, onDone = null } = {}) {
  const view = handle && handle.graph;
  const land = () => {
    if (view) {
      for (const id of (view.flowLayout()?.order || [])) view.nodeEl(id)?.classList.remove('is-hid');
      for (const p of view.wiresEl.querySelectorAll('path.wire.is-hid')) p.classList.remove('is-hid');
      for (const b of view.world.querySelectorAll('.wbadge.is-hid')) b.classList.remove('is-hid');
    }
    handle?.parts?.match?.classList.remove('is-hid');
    handle?.parts?.loops?.classList.remove('is-hid');
  };
  const order = view ? (view.flowLayout()?.order || []) : [];
  if (!view || !order.length || prefersReducedMotion(win)) { land(); if (onDone) onDone(); return () => {}; }
  const wires = [...view.wiresEl.querySelectorAll('path.wire[data-wire-id]')];   // committed wires only (the ghost has no id)
  const badges = [...view.world.querySelectorAll('.wbadge')];
  const tpl = view.template();
  const endsOf = (p) => { const w = (tpl?.wires || []).find((x) => x.id === p.dataset.wireId); return w ? [w.from.node, w.to.node] : null; };
  for (const id of order) view.nodeEl(id)?.classList.add('is-hid');
  for (const p of wires) p.classList.add('is-hid');
  for (const b of badges) b.classList.add('is-hid');
  handle.parts.match?.classList.add('is-hid');
  handle.parts.loops?.classList.add('is-hid');
  const timers = [];
  const later = (fn, ms) => timers.push(win.setTimeout(fn, ms));
  const shown = new Set();
  order.forEach((id, i) => {
    later(() => { shown.add(id); view.nodeEl(id)?.classList.remove('is-hid'); }, i * EASE_NODE_MS);
    later(() => { for (const p of wires) { const e = endsOf(p); if (e && shown.has(e[0]) && shown.has(e[1])) p.classList.remove('is-hid'); } }, i * EASE_NODE_MS + WIRE_AFTER_MS);
  });
  let finished = false;
  later(() => { finished = true; land(); if (onDone) onDone(); }, order.length * EASE_NODE_MS + TAIL_MS);
  return () => { if (finished) return; for (const t of timers) win.clearTimeout(t); land(); };
}
