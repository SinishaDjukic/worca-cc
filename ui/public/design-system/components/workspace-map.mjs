// WorkspaceBoxes and WorkspaceMap (docs/rail/panels.md › panel.workspace-map): how your projects fit together. Each workspace
// is one box saying only what is wrong or running; one opens in place, its projects drawn by who uses whom, the others
// staying boxes beside it. It holds at any size: boxes grow with workspaces, not projects, and a project in two says so.
import { attrs, cls, esc } from './html.mjs';

/**
 * WorkspaceBoxes.
 * @param {object} o
 * @param {{id:string, title:string, count:string, lines?:[string, string?][], attrs?:object}[]} o.boxes   lines: [words, tone (ask|fail)]
 * @param {string} [o.openId]  the box opened in place
 * @param {string} [o.open]    what it holds (a WorkspaceMap)
 * @param {string} [o.openTitle] its name, and its heading unless openHead is given
 * @param {string} [o.openHead]  markup in place of the heading (its age and Scan again)
 */
export function workspaceBoxes({ boxes, openId = '', open = '', openTitle = '', openHead = '' }) {
  const box = (b) => `<button type="button" class="wb-box"${attrs(b.attrs || {})}><span class="wb-h"><b>${esc(b.title)}</b><span>${esc(b.count)}</span></span>${(b.lines || []).map(([t, tone]) => `<span class="${cls('wb-l', tone && `is-${tone}`)}">${esc(t)}</span>`).join('')}</button>`;
  const rest = boxes.filter((b) => b.id !== openId);
  if (!openId) return `<div class="wb">${boxes.map(box).join('')}</div>`;
  return `<div class="wb is-open${rest.length ? '' : ' is-solo'}"><section class="wb-open"${attrs({ 'aria-label': openTitle })}>${openHead || `<h3 class="wb-open-h">${esc(openTitle)}</h3>`}${open}</section>${rest.length ? `<div class="wb-side">${rest.map(box).join('')}</div>` : ''}</div>`;
}

const W = 150, H = 48, GX = 92, GY = 26, PAD = 8;

/** Each project's column: what uses others sits left of what it uses; a cycle stops where it closes. */
function ranks(ids, links) {
  const rank = Object.fromEntries(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass += 1) for (const l of links) if (rank[l.from] !== undefined && rank[l.to] !== undefined && rank[l.to] <= rank[l.from] && rank[l.from] < ids.length - 1) rank[l.to] = rank[l.from] + 1;
  return rank;
}

/**
 * WorkspaceMap: a workspace's projects by who uses whom, each link an arrow with its word; one Worca is unsure of is dashed.
 * @param {object} o
 * @param {string} o.label
 * @param {{id:string, title:string, status?:string, tone?:string, attrs?:object}[]} o.nodes
 * @param {{from:string, to:string, word?:string, unsure?:boolean}[]} [o.links]
 */
export function workspaceMap({ label, nodes, links = [] }) {
  const ids = nodes.map((n) => n.id), known = links.filter((l) => ids.includes(l.from) && ids.includes(l.to)), rank = ranks(ids, known);
  const inRank = {}; const at = {};
  for (const n of nodes) { const r = rank[n.id], k = (inRank[r] = (inRank[r] || 0) + 1) - 1; at[n.id] = { x: PAD + r * (W + GX), y: PAD + k * (H + GY) }; }
  const width = PAD * 2 + (Math.max(0, ...Object.values(rank)) + 1) * W + Math.max(0, ...Object.values(rank)) * GX;
  const height = PAD * 2 + Math.max(1, ...Object.values(inRank)) * (H + GY) - GY;
  const fan = {}; known.forEach((l) => { (fan[l.from] = fan[l.from] || []).push(l); });   // links leaving one project leave at their own height, the highest target first so they do not cross
  for (const f of Object.values(fan)) f.sort((p, q) => at[p.to].y - at[q.to].y);
  const wires = known.map((l) => { const a = at[l.from], b = at[l.to], x1 = a.x + W, f = fan[l.from], y1 = a.y + H / 2 + (f.indexOf(l) - (f.length - 1) / 2) * 12, x2 = b.x, y2 = b.y + H / 2, lane = (f.indexOf(l) - (f.length - 1) / 2) * 12, mid = x2 > x1 ? x1 + Math.min(GX / 2, (x2 - x1) / 2) + lane : x1 + 16 + Math.max(0, lane);   // and turn at their own place: no two share a segment
    return `<path class="${cls('wm-w', l.unsure && 'is-unsure')}" d="M${x1} ${y1}H${mid}V${y2}H${x2 - 2}" marker-end="url(#wm-a)"/>${l.word ? `<text class="${cls('wm-t', l.unsure && 'is-unsure')}" x="${(mid + x2) / 2}" y="${y2 - 5}" text-anchor="middle">${esc(l.word)}</text>` : ''}`; }).join('');
  const boxes = nodes.map((n) => `<button type="button" class="${cls('wm-n', n.tone && `is-${n.tone}`)}" style="left:${at[n.id].x}px;top:${at[n.id].y}px"${attrs(n.attrs || {})}><b>${esc(n.title)}</b>${n.status ? `<span>${esc(n.status)}</span>` : ''}</button>`).join('');
  return `<div class="wm-scroll"><div class="wm" role="group" style="width:${width}px;height:${height}px"${attrs({ 'aria-label': label })}><svg width="${width}" height="${height}" aria-hidden="true"><defs><marker id="wm-a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8" fill="none" stroke="currentColor"/></marker></defs>${wires}</svg>${boxes}</div></div>`;
}

/** The order a change goes through a workspace: what is used before what uses it. */
export function workspaceOrder(ids, links) {
  const left = [...ids], out = [], uses = (a, b) => links.some((l) => l.from === a && l.to === b);
  while (left.length) { const i = left.findIndex((a) => !left.some((b) => b !== a && uses(a, b))); out.push(...left.splice(i < 0 ? 0 : i, 1)); }
  return out;
}
