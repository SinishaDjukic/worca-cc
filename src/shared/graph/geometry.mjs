// src/shared/graph/geometry.mjs
// THE geometry: card sizing, port anchors and model-driven card/port hit tests.
// Wire SHAPE lives in curves.mjs. Framework-free and DOM-free so the whole render
// path derives from the model's x/y — zero getBoundingClientRect on the pointer
// path, and every claim is unit-testable without jsdom. style.css consumes these
// numbers ONLY through the --gv-* custom properties injectGeometry writes, so the
// CSS box model can never drift from nodeSize.
//
// Card anatomy (2026-10-09 Workflows redesign, composer-mockup.html): a LABEL ROW
// sits ABOVE the card box (icon tile + title + meta; LABEL_H includes its 8px gap
// and is never billed by nodeSize), the frosted body holds the input zone (the
// await gate is its LAST row) and the output zone, then a caption footer (Task /
// End / OR) or — `describe` on, agent/script only — the description footer.
export const NODE_W = 232;
export const LABEL_H = 26;
export const ROW_H = 22;
export const SEP_H = 9;
export const PAD_T = 6;
export const PAD_B = 6;
/** The ring is a box-shadow: anchors sit exactly on the card edge. */
export const BORDER = 0;
export const DOT = 12;
/** Caption footer of Task / End / OR cards. */
export const CAP_H = 27;
/** Description footer of agent / script cards (edit hosts only — `describe`). */
export const DESC_H = 46;
export const FOOT_H = 26;
export const EXEC_ROW_H = 22;
/** The model·effort chip band at the top of an AGENT body (auto-proposal hosts only). */
export const BAND_H = 24;
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
/** Multiplier per zoom-BUTTON press. */
export const ZOOM_STEP = 1.2;
/** First row centre from the top of the card box: 6 + 11. */
export const ROW0 = PAD_T + ROW_H / 2;

const px3 = (v) => `${Math.round(v * 1000) / 1000}px`;
/** Every CSS-visible number at `scale`, as the custom properties style.css reads. */
export function geometryCssVars(scale = 1) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  return Object.freeze({
    '--gv-node-w': px3(NODE_W * s), '--gv-label-h': px3(LABEL_H * s), '--gv-row-h': px3(ROW_H * s),
    '--gv-sep-h': px3(SEP_H * s), '--gv-pad-t': px3(PAD_T * s), '--gv-pad-b': px3(PAD_B * s),
    '--gv-border': px3(BORDER * s), '--gv-dot': px3(DOT * s), '--gv-foot-h': px3(FOOT_H * s),
    '--gv-exec-row-h': px3(EXEC_ROW_H * s), '--gv-fan-w': px3(FAN_ROW_W * s),
    '--gv-band-h': px3(BAND_H * s), '--gv-cap-h': px3(CAP_H * s), '--gv-desc-h': px3(DESC_H * s),
    '--gv-scale': String(s),
  });
}
export const GEOMETRY_CSS_VARS = geometryCssVars(1);

export function injectGeometry(el, scale = 1) {
  if (!el || !el.style || typeof el.style.setProperty !== 'function') return;
  for (const [name, value] of Object.entries(geometryCssVars(scale))) el.style.setProperty(name, value);
}

const CAPTION_SET = new Set(['task', 'end', 'or']);
const DESCRIBED = new Set(['agent', 'script']);
const metaInputs = (ports) => (Array.isArray(ports?.inputs) ? ports.inputs : []).filter((p) => !p?.synthetic);
const hasAwaitRow = (ports) => (Array.isArray(ports?.inputs) ? ports.inputs : []).some((p) => p?.synthetic);
const outs = (ports) => (Array.isArray(ports?.outputs) ? ports.outputs : []);
const inRows = (ports) => metaInputs(ports).length + (hasAwaitRow(ports) ? 1 : 0);
const bandOf = (node, band) => (band && node?.kind === 'agent' ? BAND_H : 0);
/** The footer under the port rows: the description (describe hosts, agent/script), else the caption. */
const capOf = (node, describe) => (describe && DESCRIBED.has(node?.kind) ? DESC_H : CAPTION_SET.has(node?.kind) ? CAP_H : 0);

export function fanLines(n) {
  return Math.max(1, Math.ceil((Number(n) || 0) / FAN_PER_ROW));
}

/**
 * @param {{kind:string}} node
 * @param {{inputs:Array, outputs:Array}} ports  RESOLVED ports (await included for agents/scripts)
 * @param {{footerRows?:number, band?:boolean, scale?:number, describe?:boolean}} [opts]  footer LINES of a
 *   run card (the first is FOOT_H tall, every further one EXEC_ROW_H); `band` bills BAND_H on an agent;
 *   `describe` bills the description footer on agent/script cards; `scale` multiplies the box.
 */
export function nodeSize(node, ports, { footerRows = 0, band = false, scale = 1, describe = false } = {}) {
  const ins = inRows(ports);
  const o = outs(ports).length;
  const rows = ins + o;
  const footer = footerRows ? FOOT_H + (footerRows - 1) * EXEC_ROW_H : 0;
  const h = bandOf(node, band) + PAD_T + rows * ROW_H + (ins && o ? SEP_H : 0) + PAD_B + capOf(node, describe) + footer;
  return { w: NODE_W * scale, h: h * scale };
}

/** Inputs (the await gate last) anchor on the LEFT edge, outputs on the RIGHT edge. No anchor depends on
 *  a footer. Offsets scale; node.x/y do not. */
export function portAnchor(node, ports, portId, dir, { band = false, scale = 1 } = {}) {
  const at = (dx, dy) => ({ x: node.x + dx * scale, y: node.y + dy * scale });
  const top0 = ROW0 + bandOf(node, band);
  if (dir === 'in') {
    const metas = metaInputs(ports);
    let i = metas.findIndex((p) => p?.id === portId);
    if (i < 0 && portId === 'await' && hasAwaitRow(ports)) i = metas.length;
    return i < 0 ? null : at(0, top0 + ROW_H * i);
  }
  const j = outs(ports).findIndex((p) => p?.id === portId);
  if (j < 0) return null;
  const ins = inRows(ports);
  return at(NODE_W, top0 + (ins ? ins * ROW_H + SEP_H : 0) + ROW_H * j);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Snap to the 11px half-grid (the 22px dot grid's half step). DRAG only. */
export function snap(value, grid = SNAP) {
  return Math.round(value / grid) * grid;
}

export function hitNode(node, size, pt) {
  return pt.x >= node.x && pt.x <= node.x + size.w && pt.y >= node.y && pt.y <= node.y + size.h;
}

export function hitPort(anchor, pt, r = PORT_HIT_R) {
  return Math.hypot(pt.x - anchor.x, pt.y - anchor.y) <= r;
}

/** The union of the card boxes AND their label rows, optionally padded. null when there is nothing. */
export function graphBounds(tpl, portsFn, { pad = 0, footerRowsOf, band = false, scale = 1, describe = false } = {}) {
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : [])
    .filter((n) => Boolean(n) && typeof n === 'object' && !Array.isArray(n));
  if (!nodes.length) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const node of nodes) {
    const ports = (typeof portsFn === 'function' ? portsFn(node) : null) || { inputs: [], outputs: [] };
    const size = nodeSize(node, ports, { footerRows: footerRowsOf ? footerRowsOf(node) : 0, band, scale, describe });
    const x = Number(node.x) || 0;
    const y = Number(node.y) || 0;
    minX = Math.min(minX, x); minY = Math.min(minY, y - LABEL_H * scale);
    maxX = Math.max(maxX, x + size.w); maxY = Math.max(maxY, y + size.h);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

/** Fit `bounds` into a viewport: `screen = world·z + t`. zoomMax defaults to 1 — auto-fit never magnifies past 1×. */
export function fitBounds(bounds, viewport, { zoomMin = ZOOM_MIN, zoomMax = 1 } = {}) {
  const width = Number(viewport?.width) || 0;
  const height = Number(viewport?.height) || 0;
  if (!bounds || !(bounds.w > 0) || !(bounds.h > 0) || width <= 0 || height <= 0) return { z: 1, tx: 0, ty: 0 };
  const z = clamp(Math.min(width / bounds.w, height / bounds.h), zoomMin, zoomMax);
  return { z, tx: (width - bounds.w * z) / 2 - bounds.x * z, ty: (height - bounds.h * z) / 2 - bounds.y * z };
}
