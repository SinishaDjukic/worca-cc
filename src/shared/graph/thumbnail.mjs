// src/shared/graph/thumbnail.mjs
// A v2 template -> a mini-SVG string for the saved-pipeline rows. Pure and
// deterministic, and the markup carries NUMBERS ONLY (no ids, no names, no
// author text), so the result is safe to hand to innerHTML without escaping.
// The whole scene is drawn in WORLD space inside one <g transform>, which is
// what lets it reuse the real router instead of a second wire geometry.
import { graphBounds, fitBounds, nodeSize, portAnchor } from './geometry.mjs';
import { routeAll, routePathD } from './route.mjs';
import { portsOf, findPort } from './ports.mjs';

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

  const byId = new Map(nodes.map((n) => [n.id, n]));
  // The cards are the router's obstacles, so the tile shows the same shapes the
  // live canvas does — one wire, one <path>, no arrow markers, no split legs.
  const obstacles = nodes.map((n) => ({ x: Number(n.x) || 0, y: Number(n.y) || 0, ...nodeSize(n, portsOf(portsFn, n)) }));
  const wireList = [];
  for (const w of (Array.isArray(tpl?.wires) ? tpl.wires : [])) {
    const from = byId.get(w?.from?.node);
    const to = byId.get(w?.to?.node);
    if (!from || !to) continue;                                    // dangling (V5) — never draw NaN
    const fromPorts = portsOf(portsFn, from);
    const toPorts = portsOf(portsFn, to);
    if (!findPort(fromPorts, w.from.port, 'out') || !findPort(toPorts, w.to.port, 'in')) continue;
    const a = portAnchor(from, fromPorts, w.from.port, 'out');
    const b = portAnchor(to, toPorts, w.to.port, 'in');
    if (a && b) wireList.push({ id: String(w.id), a, b });          // ids stay INTERNAL: route keys only
  }
  const { routes } = routeAll(wireList, obstacles);

  // Measured over the DRAWN set, never the raw one: a junk entry the loop above
  // skips must not stretch the fit that positions the cards it does draw. The
  // routed vertices join the union so a detour is never clipped out of the tile.
  const base = graphBounds({ ...tpl, nodes }, portsFn, { pad: 0 });
  let x0 = base.x; let y0 = base.y; let x1 = base.x + base.w; let y1 = base.y + base.h;
  for (const pts of routes.values()) {
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  }
  const bounds = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  const { z, tx, ty } = fitBounds(bounds, { width, height }, { zoomMin: 0, zoomMax: 1 });
  const stroke = round(1 / (z || 1));

  // Wires first so the cards sit on top, exactly like the live canvas.
  const paths = [...routes.values()].map((pts) =>
    `<path d="${routePathD(pts)}" fill="none" stroke="#B7B7BC" stroke-width="${stroke}" stroke-linejoin="round"/>`).join('');

  const rects = nodes.map((node) => {
    const size = nodeSize(node, portsOf(portsFn, node));
    return `<rect x="${round(Number(node.x) || 0)}" y="${round(Number(node.y) || 0)}" `
      + `width="${round(size.w)}" height="${round(size.h)}" rx="${radius}" `
      + `fill="#FFFFFF" stroke="#C9C9CE" stroke-width="${stroke}"/>`;
  }).join('');

  return `${open}<g transform="translate(${round(tx)} ${round(ty)}) scale(${round(z)})">${paths}${rects}</g></svg>`;
}
