// src/shared/graph/thumbnail.mjs
// A v2 template -> a mini-SVG string for the saved-pipeline rows. Pure and
// deterministic, and the markup carries NUMBERS ONLY (no names, no author text; the one id is a session's
// `data-session`, which sessionsOf admits only as SESSION_ID_RE `s_[0-9a-z]{8}`), so the result is safe to hand
// to innerHTML without escaping.
// The whole scene is drawn in WORLD space inside one <g transform>, which is
// what lets it reuse the real lane routes instead of a second wire geometry.
import { graphBounds, fitBounds, nodeSize, portAnchor } from './geometry.mjs';
import { routeGraph } from './lanes.mjs';
import { portsOf, findPort } from './ports.mjs';
import { classifyLoops } from './loops.mjs';
import { sessionsOf, sessionRects } from './sessions.mjs';

const DEFAULTS = { width: 120, height: 64, pad: 8, radius: 3 };
const round = (v) => Math.round(v * 100) / 100;
/** A drawable node: an object with a string id. A truthy non-object survived
 *  `filter(Boolean)` and indexed under `undefined`, which is what let a
 *  non-object wire find a `from` and throw on `w.from.port` below. */
const isNode = (n) => Boolean(n) && typeof n === 'object' && !Array.isArray(n) && typeof n.id === 'string';

export function thumbnailSvg(tpl, portsFn, opts = {}) {
  const { width, height, pad, radius } = { ...DEFAULTS, ...opts };
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : []).filter(isNode);
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `
    + `viewBox="0 0 ${width} ${height}" role="img" aria-hidden="true">`;
  if (!nodes.length) return `${open}</svg>`;

  const cl = classifyLoops({ ...tpl, nodes }, portsFn);
  const loops = cl.loopWireIds;
  // A dangling wire (V5) or an unknown port has no anchor and is never drawn — never NaN.
  const { routes } = routeGraph({ ...tpl, nodes }, {
    sizeOf: (n) => nodeSize(n, portsOf(portsFn, n)),
    anchorOf: (n, port, dir) => { const p = portsOf(portsFn, n); return findPort(p, port, dir) ? portAnchor(n, p, port, dir) : null; },
    loopWireIds: loops,
  });
  const drawn = [...routes].map(([id, c]) => ({ c, loop: loops.has(id) }));
  const base = graphBounds({ ...tpl, nodes }, portsFn, { pad: 0 });
  let x0 = base.x; let y0 = base.y; let x1 = base.x + base.w; let y1 = base.y + base.h;
  for (const { c } of drawn) {
    for (const p of c.pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  }
  // A session is a tray behind its cards (no header strip on a thumbnail), inside the fitted tile. sessionsOf returns
  // [] without one, so an ungrouped template draws byte-identically.
  const specs = sessionsOf({ ...tpl, nodes }, portsFn, { loops: cl });
  const trays = specs.length
    ? sessionRects(specs, new Map(nodes.map((n) => [n.id, n])), (n) => nodeSize(n, portsOf(portsFn, n)), routes, { header: false })
    : new Map();
  for (const t of trays.values()) { x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x + t.w); y1 = Math.max(y1, t.y + t.h); }
  const bounds = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  const { z, tx, ty } = fitBounds(bounds, { width, height }, { zoomMin: 0, zoomMax: 1 });
  const stroke = round(1 / (z || 1));
  // Wires first so the cards sit on top, exactly like the live canvas; loop wires amber (#E6962A = --amber).
  const sess = [...trays].map(([sid, t]) => `<rect data-session="${sid}" x="${round(t.x)}" y="${round(t.y)}" `
    + `width="${round(t.w)}" height="${round(t.h)}" rx="${radius * 2}" fill="#9A9AA1" fill-opacity=".14"/>`).join('');
  const paths = drawn.map(({ c, loop }) =>
    `<path d="${c.d}" fill="none" stroke="${loop ? '#E6962A' : '#B7B7BC'}" stroke-width="${stroke}" stroke-linecap="round"/>`).join('');

  const rects = nodes.map((node) => {
    const size = nodeSize(node, portsOf(portsFn, node));
    return `<rect x="${round(Number(node.x) || 0)}" y="${round(Number(node.y) || 0)}" `
      + `width="${round(size.w)}" height="${round(size.h)}" rx="${radius}" `
      + `fill="#FFFFFF" stroke="#C9C9CE" stroke-width="${stroke}"/>`;
  }).join('');

  return `${open}<g transform="translate(${round(tx)} ${round(ty)}) scale(${round(z)})">${sess}${paths}${rects}</g></svg>`;
}
