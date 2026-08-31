// src/shared/graph/geometry.mjs
// THE geometry: card sizing, port anchors and model-driven card/port hit tests.
// Wire SHAPE lives in route.mjs (the orthogonal router), which imports
// WIRE_HIT_TOL from here. Framework-free and DOM-free so the whole render path
// derives from the
// model's x/y — zero getBoundingClientRect on the pointer path, and every claim
// is unit-testable without jsdom. style.css consumes these numbers ONLY through
// the --gv-* custom properties injectGeometry writes, so the CSS box model can
// never drift from nodeSize.
export const NODE_W = 220;
export const HEAD_H = 34;
export const ROW_H = 24;
export const SEP_H = 9;
export const PAD_T = 8.5;
export const PAD_B = 8;
export const BORDER = 1.5;
export const DOT = 10;
export const FOOT_H = 26;
export const EXEC_ROW_H = 22;
/** Sub-agent fan squares per wrapped line. The squares are 7px + 3px gap, so a
 *  full line is 16·10 − 3 = 157px (--gv-fan-w), leaving the ×N tail its column. */
export const FAN_PER_ROW = 16;
export const FAN_ROW_W = FAN_PER_ROW * 10 - 3;
export const SNAP = 11;
export const PORT_HIT_R = 14;
export const WIRE_HIT_TOL = 6;
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 1.6;
export const ZOOM_K = 0.002;
/** First row centre from the top of the card: 1.5 + 34 + 8.5 + 12. */
export const ROW0 = BORDER + HEAD_H + PAD_T + ROW_H / 2;

/** Every CSS-visible number, as the custom properties style.css reads. */
export const GEOMETRY_CSS_VARS = Object.freeze({
  '--gv-node-w': `${NODE_W}px`, '--gv-head-h': `${HEAD_H}px`, '--gv-row-h': `${ROW_H}px`,
  '--gv-sep-h': `${SEP_H}px`, '--gv-pad-t': `${PAD_T}px`, '--gv-pad-b': `${PAD_B}px`,
  '--gv-border': `${BORDER}px`, '--gv-dot': `${DOT}px`, '--gv-foot-h': `${FOOT_H}px`,
  '--gv-exec-row-h': `${EXEC_ROW_H}px`, '--gv-fan-w': `${FAN_ROW_W}px`,
});

/** Write the variables onto a host element at mount. Guarded: jsdom hosts and a
 *  missing element are both fine (the caller is a renderer, not a validator). */
export function injectGeometry(el) {
  if (!el || !el.style || typeof el.style.setProperty !== 'function') return;
  for (const [name, value] of Object.entries(GEOMETRY_CSS_VARS)) el.style.setProperty(name, value);
}

const CAPTION_SET = new Set(['task', 'end', 'or']);
const metaInputs = (ports) => (Array.isArray(ports?.inputs) ? ports.inputs : []).filter((p) => !p?.synthetic);
const hasAwaitRow = (ports) => (Array.isArray(ports?.inputs) ? ports.inputs : []).some((p) => p?.synthetic);
const outs = (ports) => (Array.isArray(ports?.outputs) ? ports.outputs : []);

/** Zones top to bottom: inputs -> outputs -> await gate (agents) -> caption
 *  (task/end/or). A zone is emitted only when NON-EMPTY and a separator sits
 *  only BETWEEN emitted zones — that is what reproduces the closed forms and
 *  degrades sanely on a 0-input card. */
function zones(node, ports) {
  const z = [];
  const ins = metaInputs(ports).length;
  if (ins) z.push({ kind: 'in', n: ins });
  if (outs(ports).length) z.push({ kind: 'out', n: outs(ports).length });
  if (hasAwaitRow(ports)) z.push({ kind: 'await', n: 1 });
  if (CAPTION_SET.has(node?.kind)) z.push({ kind: 'cap', n: 1 });
  return z;
}

/** y offset of a zone's FIRST row centre, or null when the zone is not emitted. */
function zoneTop(node, ports, kind) {
  let y = ROW0;
  for (const z of zones(node, ports)) {
    if (z.kind === kind) return y;
    y += z.n * ROW_H + SEP_H;
  }
  return null;
}

/** Wrapped lines a fan of `n` squares occupies (the leds are pre-capped upstream). */
export function fanLines(n) {
  return Math.max(1, Math.ceil((Number(n) || 0) / FAN_PER_ROW));
}

/**
 * @param {{kind:string}} node
 * @param {{inputs:Array, outputs:Array}} ports  RESOLVED ports (await included for agents)
 * @param {{footerRows?:number}} [opts]  footer LINES: 0 none · 1 collapsed executions
 *   strip · more for extra lines (a wrapped fan line, a stacked exec row's extra
 *   lines). The first line is FOOT_H tall, every further one EXEC_ROW_H.
 */
export function nodeSize(node, ports, { footerRows = 0 } = {}) {
  const zs = zones(node, ports);
  const rows = zs.reduce((s, z) => s + z.n, 0);
  const seps = Math.max(0, zs.length - 1);
  const footer = footerRows ? FOOT_H + (footerRows - 1) * EXEC_ROW_H : 0;
  return { w: NODE_W, h: 2 * BORDER + HEAD_H + PAD_T + rows * ROW_H + seps * SEP_H + PAD_B + footer };
}

/** Inputs and the await gate anchor on the LEFT edge, outputs on the RIGHT.
 *  The footer is the bottom-most box, so no anchor depends on it. */
export function portAnchor(node, ports, portId, dir) {
  if (dir === 'in' && portId === 'await' && hasAwaitRow(ports)) {
    return { x: node.x, y: node.y + zoneTop(node, ports, 'await') };
  }
  if (dir === 'in') {
    const i = metaInputs(ports).findIndex((p) => p?.id === portId);
    const top = zoneTop(node, ports, 'in');
    return i < 0 || top === null ? null : { x: node.x, y: node.y + top + ROW_H * i };
  }
  const j = outs(ports).findIndex((p) => p?.id === portId);
  const top = zoneTop(node, ports, 'out');
  return j < 0 || top === null ? null : { x: node.x + NODE_W, y: node.y + top + ROW_H * j };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Snap to the 11px half-grid (the 22px dot grid's half step). DRAG only —
 *  loaded templates render at their authored positions, unsnapped. */
export function snap(value, grid = SNAP) {
  return Math.round(value / grid) * grid;
}

export function hitNode(node, size, pt) {
  return pt.x >= node.x && pt.x <= node.x + size.w && pt.y >= node.y && pt.y <= node.y + size.h;
}

export function hitPort(anchor, pt, r = PORT_HIT_R) {
  return Math.hypot(pt.x - anchor.x, pt.y - anchor.y) <= r;
}

/** The union of the card boxes, optionally padded. `footerRowsOf(node)` lets the
 *  run monitor fit an expanded executions footer. null when there is nothing. */
export function graphBounds(tpl, portsFn, { pad = 0, footerRowsOf } = {}) {
  // OBJECTS only: `filter(Boolean)` kept a truthy non-object (`7`), sized it as a
  // card at the origin and stretched the bounds of every fit built from it.
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : [])
    .filter((n) => Boolean(n) && typeof n === 'object' && !Array.isArray(n));
  if (!nodes.length) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const node of nodes) {
    const ports = (typeof portsFn === 'function' ? portsFn(node) : null) || { inputs: [], outputs: [] };
    const size = nodeSize(node, ports, { footerRows: footerRowsOf ? footerRowsOf(node) : 0 });
    const x = Number(node.x) || 0;
    const y = Number(node.y) || 0;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + size.w); maxY = Math.max(maxY, y + size.h);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

/** Fit `bounds` into a viewport: `screen = world·z + t`. zoomMax defaults to 1 —
 *  auto-fit NEVER magnifies past 1x (spec §7.6). */
export function fitBounds(bounds, viewport, { zoomMin = ZOOM_MIN, zoomMax = 1 } = {}) {
  const width = Number(viewport?.width) || 0;
  const height = Number(viewport?.height) || 0;
  if (!bounds || !(bounds.w > 0) || !(bounds.h > 0) || width <= 0 || height <= 0) return { z: 1, tx: 0, ty: 0 };
  const z = clamp(Math.min(width / bounds.w, height / bounds.h), zoomMin, zoomMax);
  return { z, tx: (width - bounds.w * z) / 2 - bounds.x * z, ty: (height - bounds.h * z) / 2 - bounds.y * z };
}
