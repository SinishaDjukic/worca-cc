// ui/public/graph/graph-geometry.mjs
// Pure geometry for the node-graph composer: card sizing, port anchors, wire
// beziers and hit tests. Framework-free, DOM-free and browser-loadable as-is (no
// build step) so the whole render path derives from model x/y — zero
// getBoundingClientRect, which is what makes graph-view jsdom-testable.
//
// Card anatomy (STACKED port zones): header, then ALL inputs, a 9px separator,
// then ALL outputs. An agent card adds a SECOND separator and a bottom `await`
// gate row (the synthesized port, dot on the LEFT edge). Task, End and OR cards
// render a 24px caption row last; the caption flag is a per-KIND decision made
// by the caller, never derived here.

export const NODE_W = 220, HEADER_H = 34, PORT_ROW_H = 24, PORT_SEP = 9,
             PAD_T = 8.5, PAD_B = 8, BORDER = 1.5, FOOTER_H = 26, EXEC_ROW_H = 22, SNAP = 11;

/** Port dots are 10px but forgiving to grab; wires are 2px but selectable. */
export const PORT_HIT_R = 14, WIRE_HIT_TOL = 6;

/**
 * Card size from the RESOLVED ports (the await port included — it is measured
 * separately, not counted among the meta inputs).
 *
 * @param {{inputs:Array, outputs:Array}} ports
 * @param {{footerRows?:number, caption?:boolean}} [opts]
 *   footerRows: 0 = none; 1 = AWAIT chip / collapsed executions strip (FOOTER_H);
 *   >1 = collapsed strip + (footerRows-1) expanded execution rows (run monitor).
 *   caption: true for task, end AND or cards ONLY. agent/and/combine carry none.
 * @returns {{w:number, h:number}}
 */
export function nodeSize(ports, { footerRows = 0, caption = false } = {}) {
  const footer = footerRows === 0 ? 0 : FOOTER_H + (footerRows - 1) * EXEC_ROW_H;
  const metaIns = ports.inputs.filter((p) => !p.synthetic);          // await row measured separately
  const hasAwait = ports.inputs.some((p) => p.synthetic);            // kind 'agent' only
  const rows = metaIns.length * PORT_ROW_H + PORT_SEP + ports.outputs.length * PORT_ROW_H
             + (hasAwait ? PORT_SEP + PORT_ROW_H : 0)                // second separator + await gate row
             + (caption                                              // caption brings its OWN separator, but only
                 ? (metaIns.length > 0 && ports.outputs.length > 0   // when BOTH port zones are non-empty (else the
                     ? PORT_SEP : 0) + PORT_ROW_H                    // single zone's own separator already precedes it)
                 : 0);
  return { w: NODE_W, h: HEADER_H + PAD_T + rows + PAD_B + 2 * BORDER + footer };
  // Task card: 0 inputs — its single output row fills the input-zone slot, then separator + caption.
  // Both 1-port flow cards: H = 34 + 8.5 + (24 + 9 + 24) + 8 + 3 = 110.5 (mockup-exact).
  // Arity-2 OR: 167.5. Arity-3 OR: 191.5. Arity-2 AND (no caption): 134.5.
  // Agent card H = 95.5 + 24*(nInMeta + nOut).
}

/**
 * Where a port's dot sits in canvas space. A caption is always the LAST row, so
 * no formula below carries a caption term — the OR's `out` anchors in the output
 * zone ABOVE its caption, exactly like any other output.
 *
 * meta-input i at y + 56 + 24*i ; output j at y + 65 + 24*nInMeta + 24*j
 * (nInMeta EXCLUDES the synthesized await) — EXCEPT on a 0-input card (Task),
 * where outputs render first, in the input zone, at y + 56 + 24*j ; the await
 * anchor sits on the LEFT edge at y + 74 + 24*(nInMeta + nOut).
 * (56 = BORDER + HEADER_H + PAD_T + PORT_ROW_H/2 ; 65 = 56 + PORT_SEP ; 74 = 65 + PORT_SEP.)
 *
 * @param {{x:number, y:number}} node
 * @param {{inputs:Array, outputs:Array}} ports
 * @param {string} portId
 * @param {'in'|'out'} dir
 * @returns {{x:number, y:number}}
 */
export function portAnchor(node, ports, portId, dir /* 'in'|'out' */) {
  const metaIns = ports.inputs.filter((p) => !p.synthetic);
  const nInMeta = metaIns.length;
  if (dir === 'in' && portId === 'await') {
    return { x: node.x, y: node.y + 74 + PORT_ROW_H * (nInMeta + ports.outputs.length) };
  }
  if (dir === 'in') {
    const i = metaIns.findIndex((p) => p.id === portId);
    return { x: node.x, y: node.y + 56 + PORT_ROW_H * i };
  }
  const j = ports.outputs.findIndex((p) => p.id === portId);
  if (nInMeta === 0) {                                    // Task card: out first, no input zone
    return { x: node.x + NODE_W, y: node.y + 56 + PORT_ROW_H * j };
  }
  return { x: node.x + NODE_W, y: node.y + 65 + PORT_ROW_H * nInMeta + PORT_ROW_H * j };
}

/**
 * The wire path: ONE cubic, control points pushed out horizontally by 45% of the
 * span (clamped 48..160). Loop wires bow underneath instead of routing around —
 * the mockup's hand-authored corridors are aspirational; users drag nodes to
 * declutter (no waypoint routing).
 *
 * @param {{x:number, y:number}} a  source anchor
 * @param {{x:number, y:number}} b  target anchor
 * @param {{loop?:boolean}} [opts]
 * @returns {string}  an SVG path `d`
 */
export function bezierPath(a, b, { loop = false } = {}) {
  const dx = Math.max(48, Math.min(160, Math.abs(b.x - a.x) * 0.45));
  if (!loop) return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  const bow = 56 + Math.abs(a.y - b.y) * 0.2;   // loop wires bow underneath
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y + bow}, ${b.x - dx} ${b.y + bow}, ${b.x} ${b.y}`;
}

/** The control points `bezierPath` draws, so hit-testing samples the SAME curve. */
function bezierPoints(a, b, { loop = false } = {}) {
  const dx = Math.max(48, Math.min(160, Math.abs(b.x - a.x) * 0.45));
  const bow = loop ? 56 + Math.abs(a.y - b.y) * 0.2 : 0;
  return [a, { x: a.x + dx, y: a.y + bow }, { x: b.x - dx, y: b.y + bow }, b];
}

/** Snap to the 11px half-grid (the 22px dot grid's half step). DRAG only —
 *  loaded templates render at their authored positions unsnapped. */
export function snap(value, grid = SNAP) {
  return Math.round(value / grid) * grid;
}

/**
 * @param {{x:number, y:number}} node
 * @param {{w:number, h:number}} size
 * @param {{x:number, y:number}} pt  canvas-space point
 */
export function hitNode(node, size, pt) {
  return pt.x >= node.x && pt.x <= node.x + size.w && pt.y >= node.y && pt.y <= node.y + size.h;
}

/** @param {{x:number, y:number}} anchor @param {{x:number, y:number}} pt */
export function hitPort(anchor, pt, r = PORT_HIT_R) {
  return Math.hypot(pt.x - anchor.x, pt.y - anchor.y) <= r;
}

/**
 * Within `tol` px of the drawn curve. Sampled rather than solved: the curves are
 * short, the tolerance is 6px and a closed-form cubic distance buys nothing.
 */
export function hitWire(a, b, pt, { loop = false, tol = WIRE_HIT_TOL, samples = 48 } = {}) {
  const [p0, p1, p2, p3] = bezierPoints(a, b, { loop });
  let prev = p0;
  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples;
    const u = 1 - t;
    const next = {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
    if (distanceToSegment(pt, prev, next) <= tol) return true;
    prev = next;
  }
  return false;
}

function distanceToSegment(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/**
 * The union rect of the card boxes, for the fit-to-view control.
 *
 * @param {Array<{x:number, y:number, w:number, h:number}>} boxes
 * @param {number} [pad]
 * @returns {{x:number, y:number, w:number, h:number}|null}  null when empty
 */
export function fitBounds(boxes, pad = 0) {
  const list = Array.isArray(boxes) ? boxes : [];
  if (!list.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const box of list) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}
