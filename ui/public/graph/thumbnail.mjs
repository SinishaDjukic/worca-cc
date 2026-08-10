// ui/public/graph/thumbnail.mjs
// A v2 template -> a mini-SVG string for the saved-template rows. Pure and
// deterministic; the markup carries NUMBERS ONLY (no ids, no names, no author
// text), so the result is safe to hand to innerHTML without escaping.
import { nodeSize } from './graph-geometry.mjs';
import { CAPTION_KINDS } from './graph-model.mjs';

const DEFAULTS = { width: 120, height: 64, pad: 3, radius: 1.5 };

/**
 * @param {object} template  v2 template { nodes, wires }
 * @param {(node:object) => ({inputs?:Array, outputs?:Array}|undefined)} portsFn
 * @param {{width?:number, height?:number, pad?:number, radius?:number}} [opts]
 * @returns {string}  a standalone `<svg>…</svg>`
 */
export function thumbnail(template, portsFn, opts = {}) {
  const { width, height, pad, radius } = { ...DEFAULTS, ...opts };
  const nodes = (Array.isArray(template?.nodes) ? template.nodes : []).filter(Boolean);
  const wires = Array.isArray(template?.wires) ? template.wires : [];

  const boxes = nodes.map((node) => {
    const size = nodeSize(portsFn(node) || { inputs: [], outputs: [] }, { caption: CAPTION_KINDS.has(node.kind) });
    return { id: node.id, x: Number(node.x) || 0, y: Number(node.y) || 0, w: size.w, h: size.h };
  });

  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `
    + `viewBox="0 0 ${width} ${height}" role="img" aria-hidden="true">`;
  if (!boxes.length) return `${open}</svg>`;

  const project = projector(boxes, { width, height, pad });
  const byId = new Map(boxes.map((b) => [b.id, b]));

  // Wires first so the cards sit on top, exactly like the live canvas.
  const paths = wires.map((w) => {
    const from = byId.get(w?.from?.node);
    const to = byId.get(w?.to?.node);
    if (!from || !to) return '';                       // dangling endpoint (V5) — skip, never draw NaN
    const a = project({ x: from.x + from.w, y: from.y + from.h / 2 });
    const b = project({ x: to.x, y: to.y + to.h / 2 });
    const cx = Math.max(2, Math.abs(b.x - a.x) * 0.45);
    return `<path d="M ${a.x} ${a.y} C ${a.x + cx} ${a.y}, ${b.x - cx} ${b.y}, ${b.x} ${b.y}" `
      + 'fill="none" stroke="#B7B7BC" stroke-width="1"/>';
  }).filter(Boolean).join('');

  const rects = boxes.map((box) => {
    const at = project(box);
    const to = project({ x: box.x + box.w, y: box.y + box.h });
    return `<rect x="${at.x}" y="${at.y}" width="${round(to.x - at.x)}" height="${round(to.y - at.y)}" `
      + `rx="${radius}" fill="#FFFFFF" stroke="#C9C9CE" stroke-width="1"/>`;
  }).join('');

  return `${open}${paths}${rects}</svg>`;
}

/**
 * A uniform scale that fits every card into the padded box, centred. Uniform so
 * the mini-graph keeps the canvas's proportions; a single node (zero span)
 * simply centres at scale 1.
 */
function projector(boxes, { width, height, pad }) {
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const spanX = Math.max(...boxes.map((b) => b.x + b.w)) - minX;
  const spanY = Math.max(...boxes.map((b) => b.y + b.h)) - minY;
  const innerW = Math.max(1, width - 2 * pad);
  const innerH = Math.max(1, height - 2 * pad);
  const scale = Math.min(spanX > 0 ? innerW / spanX : 1, spanY > 0 ? innerH / spanY : 1);
  const offsetX = pad + (innerW - spanX * scale) / 2;
  const offsetY = pad + (innerH - spanY * scale) / 2;
  return (pt) => ({
    x: round(offsetX + (pt.x - minX) * scale),
    y: round(offsetY + (pt.y - minY) * scale),
  });
}

/** Two decimals: short markup, and identical strings run to run. */
function round(value) {
  return Math.round(value * 100) / 100;
}
