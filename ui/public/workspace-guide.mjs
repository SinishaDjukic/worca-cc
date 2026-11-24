// "How workspaces work" (FEAT-7): a four-screen walkthrough with a made-up sample map. Static copy
// and art only — it never reads or changes a workspace. app.js decides WHEN it opens (Create
// workspace for a first-timer; the Workspaces page's "How workspaces work" button on request) and
// remembers that it was seen (POST /api/onboarding {workspaceGuideSeen:true}); this module paints.
import { openGuideDialog } from './how-it-works/guide-dialog.mjs';
import { changeOrder } from '../../src/shared/workspace-map/order.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_W = 132;
const NODE_H = 36;
const VIEW_W = 620;
const VIEW_H = 216;

/** The sample's projects: made-up, everyday names (A-5), laid out by hand (an illustration). */
export const SAMPLE_PROJECTS = Object.freeze([
  Object.freeze({ key: 'web-shop', name: 'Web shop', x: 8, y: 92 }),
  Object.freeze({ key: 'payments', name: 'Payments service', x: 236, y: 24 }),
  Object.freeze({ key: 'design-kit', name: 'Design kit', x: 236, y: 160 }),
  Object.freeze({ key: 'email', name: 'Email service', x: 480, y: 24 }),
]);
/** from USES to — the real map's direction (src/shared/workspace-map/order.mjs). */
export const SAMPLE_LINKS = Object.freeze([
  Object.freeze({ from: 'web-shop', to: 'payments', kind: 'http', label: 'calls its API' }),
  Object.freeze({ from: 'payments', to: 'email', kind: 'topic', label: 'sends it messages' }),
  Object.freeze({ from: 'web-shop', to: 'design-kit', kind: 'pkg', label: 'uses its package' }),
]);

export const SAMPLE_CAPTION = 'A sample map with made-up projects, not yours. Each arrow points from a project to the one it relies on.';
export const ORDER_LEAD = 'In the sample map, the suggested change order is:';

/** The screens, in order (R-po-8: 3 to 4). Plain words only: no scan stage or confidence names. */
export const WORKSPACE_GUIDE_STEPS = Object.freeze([
  Object.freeze({ id: 'what', title: 'What a workspace is', paras: Object.freeze([
    'A workspace is a named group of 2 to 40 related projects that work together, such as a web shop and the services behind it.',
    'Worca scans the group and keeps a map of how its projects connect, so one feature can be built across all of them in a single run.',
  ]) }),
  Object.freeze({ id: 'find', title: 'How Worca finds the interconnections', art: 'map', paras: Object.freeze([
    'Worca reads each project and looks for the places where one relies on another: one project calling another’s API, using its messages, building on its package or sharing its data.',
    'Every link it finds keeps its evidence, the file and line where it was found, and a confidence level that says how sure Worca is about it.',
    'The scan only reads. It never changes your projects.',
  ]) }),
  Object.freeze({ id: 'check', title: 'Check the map', paras: Object.freeze([
    'After the scan, open the workspace’s Map to review what was found. Confirm the links that are right, reject the ones that are wrong, and add any the scan missed.',
    'Links you add by hand count the same as scanned ones: they appear on the map and shape the change order.',
  ]) }),
  Object.freeze({ id: 'use', title: 'How Worca uses the map in a run', art: 'order', paras: Object.freeze([
    'From the map, Worca works out a suggested change order: projects that provide something come before the projects that use it.',
    'When you start a run on a workspace, every agent in the run gets a description of this map. The plan names which projects each change goes into, and the change order says which ones to change first.',
  ]) }),
]);

/**
 * Create workspace opens the walkthrough first only for a first-timer: the flag is KNOWN to be
 * unseen and there is no workspace. `seen` null/undefined = the server could not say → never
 * block creation (business rule: the walkthrough never blocks someone from creating a workspace).
 */
export function shouldAutoOpenWorkspaceGuide({ seen, workspaceCount } = {}) {
  return seen === false && Number(workspaceCount) === 0;
}

/** The sample's change order, by name, computed with the REAL rule so the picture cannot drift. */
export function sampleChangeOrder() {
  const name = new Map(SAMPLE_PROJECTS.map((p) => [p.key, p.name]));
  return changeOrder(SAMPLE_PROJECTS.map((p) => p.key), SAMPLE_LINKS).order.map((layer) => layer.map((k) => name.get(k)));
}

/** One line a screen reader gets for the picture. */
export function sampleMapSummary() {
  const name = new Map(SAMPLE_PROJECTS.map((p) => [p.key, p.name]));
  return `Sample map: ${SAMPLE_LINKS.map((l) => `${name.get(l.from)} → ${name.get(l.to)} (${l.label})`).join('; ')}.`;
}

function linkGeometry(a, b) {
  const sx = a.x + NODE_W;
  const sy = a.y + NODE_H / 2;
  const ex = b.x - 1;                     // the arrowhead's tip sits on the box edge
  const ey = b.y + NODE_H / 2;
  const mx = (sx + ex) / 2;
  return { d: `M${sx} ${sy} C${mx} ${sy} ${mx} ${ey} ${ex} ${ey}`, lx: mx, ly: (sy + ey) / 2 - 6 };
}

/** The sample map as an <svg>: four boxes, three labelled, coloured, arrowed links (R-po-14). */
export function buildSampleMap(doc) {
  const s = (tag, attrs = {}, text = null) => {
    const n = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    if (text != null) n.textContent = text;
    return n;
  };
  const svg = s('svg', { class: 'wg-map', viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, role: 'img', 'aria-labelledby': 'wg-map-title' });
  svg.append(s('title', { id: 'wg-map-title' }, sampleMapSummary()));
  const defs = s('defs');
  for (const kind of new Set(SAMPLE_LINKS.map((l) => l.kind))) {
    const marker = s('marker', { id: `wg-arrow-${kind}`, class: `wg-k-${kind}`, viewBox: '0 0 10 10', refX: 10, refY: 5,
      markerWidth: 9, markerHeight: 9, markerUnits: 'userSpaceOnUse', orient: 'auto' });
    marker.append(s('path', { class: 'wg-arrow', d: 'M0 0L10 5L0 10z' }));
    defs.append(marker);
  }
  const byKey = new Map(SAMPLE_PROJECTS.map((p) => [p.key, p]));
  const links = s('g', { class: 'wg-links' });
  for (const l of SAMPLE_LINKS) {
    const g = linkGeometry(byKey.get(l.from), byKey.get(l.to));
    const link = s('g', { class: `wg-link wg-k-${l.kind}`, 'data-from': l.from, 'data-to': l.to });
    link.append(
      s('path', { class: 'wg-line', d: g.d, 'marker-end': `url(#wg-arrow-${l.kind})` }),
      s('text', { class: 'wg-label', x: g.lx, y: g.ly, 'text-anchor': 'middle' }, l.label),
    );
    links.append(link);
  }
  const nodes = s('g', { class: 'wg-nodes' });
  for (const p of SAMPLE_PROJECTS) {
    const node = s('g', { class: 'wg-node', 'data-key': p.key, transform: `translate(${p.x} ${p.y})` });
    node.append(s('rect', { width: NODE_W, height: NODE_H, rx: 10 }), s('text', { x: 14, y: 23 }, p.name));
    nodes.append(node);
  }
  svg.append(defs, links, nodes);
  return svg;
}

function buildArt(doc, kind) {
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  if (kind === 'map') {
    const fig = el('figure', 'wg-art wg-art-map');
    fig.append(buildSampleMap(doc), el('figcaption', 'wg-caption', SAMPLE_CAPTION));
    return [fig];
  }
  if (kind === 'order') {
    const fig = el('figure', 'wg-art wg-art-order');
    const ol = el('ol', 'wg-order');
    for (const layer of sampleChangeOrder()) ol.append(el('li', null, layer.join(', ')));
    fig.append(el('figcaption', 'wg-caption', ORDER_LEAD), ol);
    return [fig];
  }
  return [];
}

/**
 * Open the walkthrough over the current page. mode 'create' (from Create workspace: the last
 * screen's button reads "Create workspace") or 'learn' (from "How workspaces work": "Done").
 * `tour` ({ label }) adds a "show me" button on the last screen; Workspaces passes none today.
 * onClose(how), called once: 'finish' (the last screen's button) | 'skip' (Skip) |
 * 'close' (×, Escape, a backdrop click) | 'tour'. The caller routes; this module never does.
 * @returns {{ close:(how?:string)=>void, goTo:(i:number)=>void, index:()=>number, modal:HTMLElement }}
 */
export function openWorkspaceGuide({ doc = globalThis.document, mode = 'learn', tour = null, onClose = () => {} } = {}) {
  const create = mode === 'create';
  return openGuideDialog({
    doc,
    id: 'workspace-guide-modal',
    steps: WORKSPACE_GUIDE_STEPS,
    buildArt,
    finishLabel: create ? 'Create workspace' : 'Done',
    tour,
    tourPlacement: create ? 'secondary' : 'primary',
    dataset: { mode },
    onClose,
  });
}
