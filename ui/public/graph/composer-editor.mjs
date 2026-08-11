// ui/public/graph/composer-editor.mjs
// The free-form node composer: palette rail, pointer wiring, selection,
// keyboard, pan/zoom, a 50-deep undo ring, dirty tracking and the save modal.
// graph-view.mjs paints; this module decides.
//
// TWO RULES HOLD THE DESIGN TOGETHER:
//
// 1. Legality is graph-model's. Every drop asks the OBJECT-signature
//    canWire({template, portsFn, from, to}) with the LIVE template, so the
//    uniform single-wire rule (V7 ⟨f⟩), type compatibility and or-homogeneity
//    are decided once, in the module the engine's validator mirrors. The editor
//    never keeps its own wire list or its own reason strings.
// 2. Save is the validate adapter's. The button's disabled state is derived
//    from validateGraph's errors, never from a bespoke "is there an End node?"
//    check — so a rule added to the validator reaches the composer for free.
//    The server stays authoritative through the POST's 422.
//
// Hit-testing is MODEL-driven (graph-geometry's hitPort/hitNode/hitWire against
// portAnchor), not DOM-driven: no elementFromPoint, no per-node rects. That is
// what makes pointer behaviour testable under jsdom, which has no layout — and
// it keeps a drag O(ports) instead of forcing a reflow per move.

import {
  canWire, newNode, newWire, normalizeTemplate, serializeTemplate,
  validateGraph, classifyLoops, CAPTION_KINDS,
} from './graph-model.mjs';
import {
  portAnchor, bezierPath, nodeSize, snap, hitNode, hitPort, hitWire, fitBounds, SNAP, NODE_W,
} from './graph-geometry.mjs';
import { autoLayout } from './graph-layout.mjs';
import { groupPaletteByDomain, paletteDesc, FLOW_GROUP } from './agents-meta.mjs';
import { createGraphView, LEGEND_TEXT } from './graph-view.mjs';
import { renderNodeInspector, renderWireInspector, renderEmptyInspector } from './inspector.mjs';
import { renderSaveDialog, openDialog, closeDialog } from './save-dialog.mjs';

/** Undo ring depth (spec §6). */
export const UNDO_LIMIT = 50;
/** Zoom clamp (spec §6). */
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.1;
/** Wheel-to-zoom sensitivity; the same curve serves Cmd+wheel and pinch. */
const ZOOM_WHEEL_K = 0.002;

export const EMPTY_STATE_COPY = 'Wire agents from the Task node to the End node — outputs → inputs';

/** Flow pills advertise their ports the way agent pills do (mockup line 2). */
const FLOW_PORT_LINE = {
  task: 'source · out task',
  end: 'in result · terminal',
  and: 'in in1..inN · out out',
  or: 'in in1..inN · out out',
  combine: 'in in1, in2 · out out',
};

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function icon(doc, d) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.innerHTML = d;
  return svg;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Ordered domain headers: every non-shared, non-general domain in first-seen
 *  order, then `general`. (`shared` agents are folded into every group by
 *  groupPaletteByDomain, so it is never a header of its own.) */
function paletteDomains(pal) {
  const seen = [];
  for (const a of pal) {
    if (a.domain && a.domain !== 'shared' && a.domain !== 'general' && !seen.includes(a.domain)) seen.push(a.domain);
  }
  seen.push('general');
  return seen;
}

/**
 * @param {object} opts
 * @param {Document} [opts.doc]
 * @param {Element} opts.canvas       canvas host — chrome + the graph view mount
 * @param {Element} opts.palette      palette rail host
 * @param {Element} opts.inspector    right-rail host
 * @param {Element} [opts.dialogHost] where the save <dialog> is mounted
 * @param {HTMLButtonElement} [opts.saveButton]
 * @param {HTMLInputElement} [opts.filter]
 * @param {Function} [opts.canvasInsetTop] px of canvas hidden under open chrome (the top drawer)
 * @param {Function} [opts.canvasInsetRight] px of canvas hidden under the floating inspector rail
 * @param {Function} opts.portsFn     the SYNTHESIZING ports function
 * @param {Array} [opts.agents]       mergePalette entries
 * @param {object|null} [opts.template] a template to load; null = new canvas
 * @param {Function} [opts.onSave]    (body) => Promise — owns the POST
 * @param {Function} [opts.onChange]  ({dirty, report}) => void, after every repaint
 */
export function createComposerEditor({
  doc = globalThis.document,
  canvas,
  palette: paletteHost,
  inspector: inspectorHost,
  dialogHost = null,
  saveButton = null,
  filter = null,
  canvasInsetTop = () => 0,
  canvasInsetRight = () => 0,
  portsFn,
  agents = [],
  template = null,
  models = [],
  efforts = [],
  savedDomains = [],
  onSave = null,
  onChange = null,
} = {}) {
  // ----------------------------------------------------------------- state
  let tpl = template ? normalizeTemplate(template) : newCanvas();
  let transform = tpl.canvas
    ? { x: tpl.canvas.x, y: tpl.canvas.y, zoom: clamp(tpl.canvas.zoom, ZOOM_MIN, ZOOM_MAX) }
    : { x: 0, y: 0, zoom: 1 };
  let sel = null;                  // {kind:'node'|'wire', id}
  let dirty = false;
  let collapsed = new Set();       // domains folded away via the group chips
  let query = '';
  const undoStack = [];
  const redoStack = [];
  let gesture = null;              // active pointer gesture
  let spaceDown = false;
  let dialog = null;

  /** A fresh canvas preloads the two bookends V20/V21 require. */
  function newCanvas() {
    const task = newNode('task', { x: 60, y: 200 });
    const end = newNode('end', { x: 960, y: 200 });
    return { id: '', name: '', version: 2, domain: '', nodes: [task, end], wires: [] };
  }

  // ------------------------------------------------------------ canvas chrome
  const stage = h(doc, 'div', 'gv-stage');
  const empty = h(doc, 'div', 'gv-empty', EMPTY_STATE_COPY);
  const chip = h(doc, 'div', 'gv-chip');
  chip.hidden = true;
  const legend = h(doc, 'div', 'gv-legend', LEGEND_TEXT);
  const zoomCluster = h(doc, 'div', 'gv-zoom');
  const zoomOut = h(doc, 'button', 'zoom-out', '−');
  const pct = h(doc, 'span', 'pct', '100%');
  const zoomIn = h(doc, 'button', 'zoom-in', '+');
  const zoomFit = h(doc, 'button', 'zoom-fit');
  const autoBtn = h(doc, 'button', 'gv-autolayout');
  for (const b of [zoomOut, zoomIn, zoomFit, autoBtn]) b.type = 'button';
  zoomOut.title = 'Zoom out';
  zoomIn.title = 'Zoom in';
  zoomFit.title = 'Fit to screen';
  zoomFit.appendChild(icon(doc, '<path d="M4 9V5.5A1.5 1.5 0 015.5 4H9M15 4h3.5A1.5 1.5 0 0120 5.5V9M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15M9 20H5.5A1.5 1.5 0 014 18.5V15"/>'));
  autoBtn.title = 'Auto-layout';
  autoBtn.appendChild(icon(doc, '<path d="M4 7h7M4 17h7M13 12h7"/><path d="M11 7v10"/><path d="M17 9l-2 3 2 3"/>'));
  zoomCluster.append(zoomOut, pct, zoomIn, h(doc, 'span', 'zdiv'), zoomFit, autoBtn);
  canvas.replaceChildren(stage, empty, chip, legend, zoomCluster);

  const view = createGraphView(stage, { doc, portsFn, agents: byKey(agents) });

  // The ghost wire lives INSIDE the world, so its coordinates are world
  // coordinates and pan/zoom carry it for free.
  const ghost = h(doc, 'div', 'gv-ghost');
  ghost.hidden = true;
  const ghostSvg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ghostSvg.setAttribute('width', '1');
  ghostSvg.setAttribute('height', '1');
  const ghostPath = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  ghostPath.setAttribute('class', 'wire ghost');
  ghostSvg.appendChild(ghostPath);
  ghost.appendChild(ghostSvg);
  view.world.appendChild(ghost);

  function byKey(list) {
    return Object.fromEntries((list || []).map((a) => [a.key, a]));
  }

  // ------------------------------------------------------------------ model
  const nodeById = (id) => tpl.nodes.find((n) => n.id === id) || null;
  const wireById = (id) => tpl.wires.find((w) => w.id === id) || null;
  const portsOf = (node) => portsFn(node) || { inputs: [], outputs: [] };
  const sizeOf = (node) => nodeSize(portsOf(node), { caption: CAPTION_KINDS.has(node.kind) });

  function snapshot() {
    return JSON.stringify({ nodes: tpl.nodes, wires: tpl.wires });
  }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    dirty = true;
  }

  function restore(json) {
    const state = JSON.parse(json);
    tpl.nodes = state.nodes;
    tpl.wires = state.wires;
    if (sel && ((sel.kind === 'node' && !nodeById(sel.id)) || (sel.kind === 'wire' && !wireById(sel.id)))) sel = null;
    render();
  }

  // ------------------------------------------------------------- validation
  function report() {
    return validateGraph(tpl, portsFn);
  }

  // --------------------------------------------------------------- rendering
  function render() {
    // ONE validate pass per repaint: the card pips, the Save button and the
    // host's dirty/error readout all read the same verdict.
    const verdict = report();
    view.render(tpl, { selection: sel, report: verdict });
    view.setTransform(transform);
    empty.hidden = tpl.wires.length > 0;
    pct.textContent = `${Math.round(transform.zoom * 100)}%`;
    renderPalette();
    renderInspector();
    renderSaveState(verdict);
    if (onChange) onChange({ dirty, report: verdict });
  }

  function renderSaveState({ errors }) {
    if (!saveButton) return;
    saveButton.disabled = errors.length > 0;
    saveButton.dataset.errorCount = String(errors.length);
    saveButton.classList.toggle('has-errors', errors.length > 0);
    saveButton.title = errors.length
      ? `${errors.length} validation ${errors.length === 1 ? 'error' : 'errors'} — hover a red pip for details`
      : '';
  }

  // ------------------------------------------------------------------ palette
  function pillMatches(entry, q) {
    if (!q) return true;
    const hay = `${entry.displayName || ''} ${entry.key || entry.kind || ''} ${entry.portLine || ''}`.toLowerCase();
    return hay.includes(q);
  }

  function buildPill(entry) {
    const btn = h(doc, 'button', 'ap');
    btn.type = 'button';
    if (entry.key) btn.dataset.key = entry.key;
    else btn.dataset.kind = entry.kind;
    btn.disabled = Boolean(entry.disabled);
    if (entry.disabled) btn.classList.add('dim');
    const dot = h(doc, 'span', 'd');
    dot.dataset.color = entry.kind ? 'flow' : (entry.color || 'blue');
    const body = h(doc, 'span', 'b');
    body.appendChild(h(doc, 'span', 'n', entry.displayName));
    body.appendChild(h(doc, 'span', 'p pt', entry.portLine));
    btn.append(dot, body);
    if (entry.disabled) btn.appendChild(h(doc, 'span', 'chip', '1 placed'));
    if (entry.description) btn.title = entry.description;
    return btn;
  }

  function renderPalette() {
    if (!paletteHost) return;
    const placedKinds = tpl.nodes.map((n) => n.kind);
    const domains = paletteDomains(agents);
    const groups = groupPaletteByDomain(agents, domains, { placedKinds });
    const frag = doc.createDocumentFragment();

    // Domain chips: one per non-flow group, toggles that section away.
    const chips = h(doc, 'div', 'pal-chips');
    for (const g of groups) {
      if (g.flow) continue;
      const c = h(doc, 'button', `pal-chip${collapsed.has(g.domain) ? ' off' : ''}`, g.domain);
      c.type = 'button';
      c.dataset.domain = g.domain;
      chips.appendChild(c);
    }
    frag.appendChild(chips);

    for (const g of groups) {
      const sec = h(doc, 'section', `pal-group${g.flow ? ' pal-pinned' : ''}`);
      sec.dataset.domain = g.flow ? FLOW_GROUP : g.domain;
      const head = h(doc, 'div', 'grp');
      head.appendChild(h(doc, 'span', 'lab', g.flow ? 'Flow' : g.domain));
      head.appendChild(h(doc, 'span', 'chip', String(g.agents.length)));
      if (g.flow) head.appendChild(h(doc, 'span', 'chip pinned-tag', 'pinned'));
      sec.appendChild(head);
      const pills = h(doc, 'div', 'pills');
      for (const a of g.agents) {
        const entry = g.flow
          ? { ...a, portLine: FLOW_PORT_LINE[a.kind] || '' }
          : { ...a, portLine: paletteDesc(a) };
        pills.appendChild(buildPill(entry));
      }
      sec.appendChild(pills);
      sec.hidden = !g.flow && collapsed.has(g.domain);
      frag.appendChild(sec);
    }
    // paletteHost IS the 240px drawer scroll container now. replaceChildren()
    // collapses scrollHeight, which clamps scrollTop to 0 — so a pill click
    // would bounce the panel to the top and throw the pinned Flow group out of
    // reach, after every single spawn. The emitted markup is unchanged.
    const keepScroll = paletteHost.scrollTop;
    paletteHost.replaceChildren(frag);
    if (keepScroll) paletteHost.scrollTop = keepScroll;
    applyFilter();
  }

  function applyFilter() {
    if (!paletteHost) return;
    const q = query.trim().toLowerCase();
    for (const sec of paletteHost.querySelectorAll('.pal-group')) {
      let anyVisible = false;
      for (const btn of sec.querySelectorAll('.ap')) {
        const entry = {
          displayName: btn.querySelector('.n').textContent,
          key: btn.dataset.key,
          kind: btn.dataset.kind,
          portLine: btn.querySelector('.p').textContent,
        };
        const show = pillMatches(entry, q);
        btn.hidden = !show;
        if (show) anyVisible = true;
      }
      const domain = sec.dataset.domain;
      sec.hidden = !anyVisible || (domain !== FLOW_GROUP && collapsed.has(domain));
    }
  }

  // ---------------------------------------------------------------- inspector
  function renderInspector() {
    if (!inspectorHost) return;
    if (!sel) return void inspectorHost.replaceChildren(renderEmptyInspector({ doc }));
    if (sel.kind === 'node') {
      const node = nodeById(sel.id);
      if (!node) return void inspectorHost.replaceChildren(renderEmptyInspector({ doc }));
      const meta = node.kind === 'agent' ? agents.find((a) => a.key === node.key) || null : null;
      return void inspectorHost.replaceChildren(
        renderNodeInspector(node, { template: tpl, portsFn, meta, models, efforts, doc }),
      );
    }
    const wire = wireById(sel.id);
    if (!wire) return void inspectorHost.replaceChildren(renderEmptyInspector({ doc }));
    const { loopWires } = classifyLoops(tpl, portsFn);
    inspectorHost.replaceChildren(renderWireInspector(wire, { loop: loopWires.has(wire.id), doc }));
  }

  // ------------------------------------------------------------- coordinates
  function toWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left - transform.x) / transform.zoom,
      y: (clientY - r.top - transform.y) / transform.zoom,
    };
  }

  /** Ports first (their dots overhang the card edge), then cards, then wires. */
  function hitTest(pt) {
    for (let i = tpl.nodes.length - 1; i >= 0; i -= 1) {
      const node = tpl.nodes[i];
      const p = portsOf(node);
      for (const inp of p.inputs) {
        if (hitPort(portAnchor(node, p, inp.id, 'in'), pt)) {
          return { kind: 'port', node, port: inp.id, dir: 'in' };
        }
      }
      for (const out of p.outputs) {
        if (hitPort(portAnchor(node, p, out.id, 'out'), pt)) {
          return { kind: 'port', node, port: out.id, dir: 'out' };
        }
      }
    }
    for (let i = tpl.nodes.length - 1; i >= 0; i -= 1) {
      const node = tpl.nodes[i];
      if (hitNode(node, sizeOf(node), pt)) return { kind: 'node', node };
    }
    const { loopWires } = classifyLoops(tpl, portsFn);
    for (const wire of tpl.wires) {
      const from = nodeById(wire.from.node);
      const to = nodeById(wire.to.node);
      if (!from || !to) continue;
      const a = portAnchor(from, portsOf(from), wire.from.port, 'out');
      const b = portAnchor(to, portsOf(to), wire.to.port, 'in');
      if (hitWire(a, b, pt, { loop: loopWires.has(wire.id) })) return { kind: 'wire', wire };
    }
    return null;
  }

  // -------------------------------------------------------------- reason chip
  function showChip(text, clientX, clientY) {
    chip.textContent = text;
    chip.hidden = false;
    if (Number.isFinite(clientX)) {
      const r = canvas.getBoundingClientRect();
      chip.style.left = `${clientX - r.left + 14}px`;
      chip.style.top = `${clientY - r.top + 14}px`;
    }
  }
  function hideChip() {
    chip.hidden = true;
    chip.textContent = '';
  }

  // ------------------------------------------------------------------ wiring
  /** Normalize a (origin, target) pair into canWire's from/to, or null. */
  function orient(origin, target) {
    if (!target || target.kind !== 'port') return null;
    if (origin.dir === 'out' && target.dir === 'in') {
      return { from: { node: origin.node.id, port: origin.port }, to: { node: target.node.id, port: target.port } };
    }
    if (origin.dir === 'in' && target.dir === 'out') {
      return { from: { node: target.node.id, port: target.port }, to: { node: origin.node.id, port: origin.port } };
    }
    return null;
  }

  function tryWire(origin, target, ev) {
    const pair = orient(origin, target);
    if (!pair) return false;
    const verdict = canWire({ template: tpl, portsFn, from: pair.from, to: pair.to });
    if (!verdict.ok) {
      showChip(verdict.reason, ev && ev.clientX, ev && ev.clientY);
      return false;
    }
    pushUndo();
    tpl.wires.push(newWire(pair.from, pair.to));
    hideChip();
    return true;
  }

  // -------------------------------------------------------------- public ops
  /** Successive pill clicks would otherwise stack every card on one pixel —
   *  centerWorld() is a pure function of the rect and the transform, and spawn()
   *  changes neither. Step off anything already sitting on the slot — anything
   *  SNAPPED, that is: loaded templates, and newCanvas()'s own Task at x:60 and
   *  End at x:960, render at unsnapped authored coordinates
   *  (graph-geometry.mjs:107) and are invisible to this test. It de-stacks
   *  successive spawns, which is what it is for; it is not a general overlap
   *  avoider. The step is
   *  SNAP*2 so the snapped result moves by exactly one dot-grid cell each time.
   *  The 24-try ceiling keeps a pathological template from looping, and it IS
   *  reachable: 25 consecutive default spawns fill slots 0..24 and the 26th
   *  exhausts the loop and stacks on slot 24. Accepted — 25 cards spawned without
   *  ever moving one is not a real session, the alternative is an unbounded loop,
   *  and the step is diagonal, so slot 24 is already 528px down and right of
   *  centre and off-canvas anyway. */
  function freeSlot(p) {
    let { x, y } = p;
    for (let i = 0; i < 24; i += 1) {
      const taken = tpl.nodes.some((n) => n.x === snap(x) && n.y === snap(y));
      if (!taken) break;
      x += SNAP * 2;
      y += SNAP * 2;
    }
    return { x, y };
  }

  function spawn(entry, at) {
    const p = at || freeSlot(centerWorld());
    pushUndo();
    const node = entry.kind
      ? newNode(entry.kind, { x: snap(p.x), y: snap(p.y), config: entry.kind === 'and' || entry.kind === 'or' || entry.kind === 'combine' ? { arity: 2 } : {} })
      : newNode('agent', { key: entry.key, x: snap(p.x), y: snap(p.y) });
    tpl.nodes.push(node);
    sel = { kind: 'node', id: node.id };
    render();
    return node;
  }

  // The top drawer OVERLAYS the canvas, so the raw rect's centre can sit behind
  // it — a pill-spawned node would land under the panel that was just clicked.
  // Centre on the VISIBLE band instead. The default inset is 0, which is the
  // pre-drawer arithmetic exactly.
  function centerWorld() {
    const r = canvas.getBoundingClientRect();
    const h = r.height || 0;
    const w = r.width || 0;
    const inset = Math.min(Math.max(canvasInsetTop() || 0, 0), h);
    const insetR = Math.min(Math.max(canvasInsetRight() || 0, 0), w);
    const c = toWorld(r.left + (w - insetR) / 2, r.top + inset + (h - inset) / 2);
    return { x: c.x - NODE_W / 2, y: c.y - 60 };
  }

  function moveNode(id, x, y) {
    const node = nodeById(id);
    if (!node) return;
    pushUndo();
    node.x = x;
    node.y = y;
    render();
  }

  function deleteNode(id) {
    if (!nodeById(id)) return;
    pushUndo();
    tpl.nodes = tpl.nodes.filter((n) => n.id !== id);
    tpl.wires = tpl.wires.filter((w) => w.from.node !== id && w.to.node !== id);
    if (sel && sel.kind === 'node' && sel.id === id) sel = null;
    render();
  }

  function deleteWire(id) {
    if (!wireById(id)) return;
    pushUndo();
    tpl.wires = tpl.wires.filter((w) => w.id !== id);
    if (sel && sel.kind === 'wire' && sel.id === id) sel = null;
    render();
  }

  function select(next) {
    sel = next && next.id ? { kind: next.kind, id: next.id } : null;
    render();
  }

  function setTransform(next) {
    transform = {
      x: next.x, y: next.y, zoom: clamp(next.zoom, ZOOM_MIN, ZOOM_MAX),
    };
    view.setTransform(transform);
    pct.textContent = `${Math.round(transform.zoom * 100)}%`;
  }

  function setZoom(z, about) {
    const next = clamp(Math.round(z * 100) / 100, ZOOM_MIN, ZOOM_MAX);
    if (!about) return void setTransform({ ...transform, zoom: next });
    const r = canvas.getBoundingClientRect();
    const world = toWorld(about.x, about.y);
    setTransform({
      x: (about.x - r.left) - world.x * next,
      y: (about.y - r.top) - world.y * next,
      zoom: next,
    });
  }

  function fit() {
    const boxes = tpl.nodes.map((n) => ({ x: n.x, y: n.y, ...sizeOf(n) }));
    const b = fitBounds(boxes, 60);
    if (!b || !b.w || !b.h) return;
    const r = canvas.getBoundingClientRect();
    const insetR = Math.min(Math.max(canvasInsetRight() || 0, 0), r.width || 0);
    const vw = (r.width || 960) - insetR;
    const vh = r.height || 600;
    // Same overlay problem as centerWorld: without the inset, "fit to screen"
    // parks the top of the graph under the open panel — and the zoom cluster is
    // bottom-right, so it is exactly the button a stuck user reaches for. Fit
    // into the visible band, then push the origin below the panel. Under jsdom
    // r.height is 0, so the clamp yields 0 and this is the old arithmetic.
    const inset = Math.min(Math.max(canvasInsetTop() || 0, 0), r.height || 0);
    const zoom = clamp(Math.round(Math.min(vw / b.w, (vh - inset) / b.h) * 100) / 100, ZOOM_MIN, ZOOM_MAX);
    setTransform({ x: -b.x * zoom, y: -b.y * zoom + inset, zoom });
  }

  function runAutoLayout() {
    const positions = autoLayout(tpl, portsFn);
    const changed = tpl.nodes.some((n) => positions[n.id] && (positions[n.id].x !== n.x || positions[n.id].y !== n.y));
    if (!changed) return;
    pushUndo();
    for (const node of tpl.nodes) {
      const p = positions[node.id];
      if (p) { node.x = p.x; node.y = p.y; }
    }
    render();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    dirty = true;
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    dirty = true;
  }

  function serialize() {
    tpl.canvas = { x: transform.x, y: transform.y, zoom: transform.zoom };
    return serializeTemplate(tpl);
  }

  // ------------------------------------------------------------- save dialog
  function openSaveDialog() {
    if (!dialogHost) return null;
    if (dialog) dialog.remove();
    dialog = renderSaveDialog({
      name: tpl.name, domain: tpl.domain, domains: savedDomains, doc,
    });
    dialogHost.replaceChildren(dialog);
    dialog.querySelector('.sd-cancel').addEventListener('click', () => closeDialog(dialog));
    dialog.querySelector('.sd-confirm').addEventListener('click', () => { confirmSave(); });
    openDialog(dialog);
    return dialog;
  }

  async function confirmSave() {
    if (!dialog) return;
    const msg = dialog.querySelector('.sd-msg');
    const name = dialog.querySelector('.sd-name').value.trim();
    if (!name) { msg.textContent = 'name is required'; msg.className = 'sd-msg err'; return; }
    const domain = dialog.querySelector('.sd-domain').value.trim();
    tpl.name = name;
    tpl.domain = domain;
    const body = { ...serialize(), name, domain };
    if (!onSave) { closeDialog(dialog); dirty = false; return; }
    try {
      const res = await onSave(body);
      if (res && res.ok === false) {
        msg.textContent = res.error || 'save failed';
        msg.className = 'sd-msg err';
        return;
      }
      dirty = false;
      closeDialog(dialog);
      render();
    } catch (err) {
      msg.textContent = err && err.message ? err.message : String(err);
      msg.className = 'sd-msg err';
    }
  }

  // -------------------------------------------------------------- listeners
  function onPointerDown(ev) {
    if (ev.button !== 0 && ev.button !== 1) return;
    ev.preventDefault?.();                      // no native text-selection drag off a port
    canvas.setPointerCapture?.(ev.pointerId);   // jsdom has no setPointerCapture
    const pt = toWorld(ev.clientX, ev.clientY);
    const panning = ev.button === 1 || spaceDown;
    if (panning) {
      gesture = { type: 'pan', startX: ev.clientX, startY: ev.clientY, origin: { ...transform } };
      return;
    }
    const hit = hitTest(pt);
    if (hit && hit.kind === 'port') {
      const p = portsOf(hit.node);
      gesture = { type: 'wire', origin: hit, anchor: portAnchor(hit.node, p, hit.port, hit.dir) };
      ghost.hidden = false;
      ghostPath.setAttribute('d', bezierPath(gesture.anchor, pt));
      return;
    }
    if (hit && hit.kind === 'node') {
      gesture = { type: 'node', id: hit.node.id, grab: { x: pt.x - hit.node.x, y: pt.y - hit.node.y }, moved: false };
      select({ kind: 'node', id: hit.node.id });
      return;
    }
    if (hit && hit.kind === 'wire') {
      select({ kind: 'wire', id: hit.wire.id });
      return;
    }
    gesture = { type: 'marquee-less-pan', startX: ev.clientX, startY: ev.clientY, origin: { ...transform } };
    select(null);
    hideChip();
  }

  function onPointerMove(ev) {
    if (!gesture) return;
    if (gesture.type === 'pan' || gesture.type === 'marquee-less-pan') {
      setTransform({
        x: gesture.origin.x + (ev.clientX - gesture.startX),
        y: gesture.origin.y + (ev.clientY - gesture.startY),
        zoom: transform.zoom,
      });
      return;
    }
    const pt = toWorld(ev.clientX, ev.clientY);
    if (gesture.type === 'node') {
      const node = nodeById(gesture.id);
      if (!node) return;
      if (!gesture.moved) { gesture.moved = true; gesture.before = snapshot(); }
      node.x = snap(pt.x - gesture.grab.x);
      node.y = snap(pt.y - gesture.grab.y);
      view.render(tpl, { selection: sel, report: report() });
      return;
    }
    if (gesture.type === 'wire') {
      ghostPath.setAttribute('d', bezierPath(gesture.anchor, pt));
      const target = hitTest(pt);
      const pair = orient(gesture.origin, target);
      if (!pair) { hideChip(); ghost.classList.remove('legal', 'illegal'); return; }
      const verdict = canWire({ template: tpl, portsFn, from: pair.from, to: pair.to });
      ghost.classList.toggle('legal', verdict.ok);
      ghost.classList.toggle('illegal', !verdict.ok);
      if (verdict.ok) hideChip(); else showChip(verdict.reason, ev.clientX, ev.clientY);
    }
  }

  function onPointerUp(ev) {
    const g = gesture;
    gesture = null;
    if (!g) return;
    if (g.type === 'node') {
      if (g.moved) {
        // Commit ONE undo entry for the whole drag, not one per pointermove.
        undoStack.push(g.before);
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        redoStack.length = 0;
        dirty = true;
      }
      render();
      return;
    }
    if (g.type === 'wire') {
      ghost.hidden = true;
      ghost.classList.remove('legal', 'illegal');
      tryWire(g.origin, hitTest(toWorld(ev.clientX, ev.clientY)), ev);
      render();
    }
  }

  function onWheel(ev) {
    ev.preventDefault?.();
    if (ev.metaKey || ev.ctrlKey) {
      // Cmd+wheel and trackpad pinch share one curve and one clamp.
      setZoom(transform.zoom * Math.exp(-ev.deltaY * ZOOM_WHEEL_K), { x: ev.clientX, y: ev.clientY });
      return;
    }
    setTransform({ x: transform.x - ev.deltaX, y: transform.y - ev.deltaY, zoom: transform.zoom });
  }

  function isTyping(target) {
    const tag = target && target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function onKeyDown(ev) {
    if (ev.key === ' ') { spaceDown = true; return; }
    if (isTyping(ev.target)) return;
    const meta = ev.metaKey || ev.ctrlKey;
    if (meta && (ev.key === 'z' || ev.key === 'Z')) {
      if (ev.shiftKey) redo(); else undo();
      return;
    }
    if (ev.key === 'Escape') { select(null); hideChip(); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      if (!sel) return;
      if (sel.kind === 'node') deleteNode(sel.id); else deleteWire(sel.id);
      return;
    }
    const nudge = { ArrowLeft: [-SNAP, 0], ArrowRight: [SNAP, 0], ArrowUp: [0, -SNAP], ArrowDown: [0, SNAP] }[ev.key];
    if (nudge && sel && sel.kind === 'node') {
      const node = nodeById(sel.id);
      if (node) moveNode(node.id, node.x + nudge[0], node.y + nudge[1]);
    }
  }

  function onKeyUp(ev) { if (ev.key === ' ') spaceDown = false; }

  function onPaletteClick(ev) {
    const chipBtn = ev.target.closest?.('.pal-chip');
    if (chipBtn) {
      const d = chipBtn.dataset.domain;
      if (collapsed.has(d)) collapsed.delete(d); else collapsed.add(d);
      renderPalette();
      return;
    }
    const btn = ev.target.closest?.('.ap');
    if (!btn || btn.disabled) return;
    spawn(btn.dataset.kind ? { kind: btn.dataset.kind } : { key: btn.dataset.key });
  }

  function onInspectorChange(ev) {
    const fieldName = ev.target.dataset && ev.target.dataset.field;
    if (!fieldName || !sel) return;
    if (sel.kind === 'wire') {
      const wire = wireById(sel.id);
      if (!wire || fieldName !== 'maxCycles') return;
      const n = Number.parseInt(ev.target.value, 10);
      pushUndo();
      wire.config = { ...(wire.config || {}) };
      if (Number.isInteger(n) && n >= 1) wire.config.maxCycles = n; else delete wire.config.maxCycles;
      if (!Object.keys(wire.config).length) delete wire.config;
      render();
      return;
    }
    const node = nodeById(sel.id);
    if (!node) return;
    pushUndo();
    if (fieldName === 'arity') {
      const n = Number.parseInt(ev.target.value, 10);
      node.config.arity = Number.isInteger(n) && n >= 2 ? n : 2;
    } else if (ev.target.type === 'checkbox') {
      if (ev.target.checked) node.config[fieldName] = true;
      else delete node.config[fieldName];
    } else if (ev.target.value === '') {
      delete node.config[fieldName];
    } else {
      node.config[fieldName] = ev.target.value;
    }
    render();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  doc.addEventListener('pointermove', onPointerMove);
  doc.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  doc.addEventListener('keydown', onKeyDown);
  doc.addEventListener('keyup', onKeyUp);
  if (paletteHost) paletteHost.addEventListener('click', onPaletteClick);
  if (inspectorHost) inspectorHost.addEventListener('change', onInspectorChange);
  if (filter) filter.addEventListener('input', () => { query = filter.value; applyFilter(); });
  if (saveButton) saveButton.addEventListener('click', () => openSaveDialog());
  zoomIn.addEventListener('click', () => setZoom(transform.zoom + ZOOM_STEP));
  zoomOut.addEventListener('click', () => setZoom(transform.zoom - ZOOM_STEP));
  zoomFit.addEventListener('click', fit);
  autoBtn.addEventListener('click', runAutoLayout);

  render();

  const editor = {
    view,
    template: () => tpl,
    serialize,
    report,
    selection: () => (sel ? { ...sel } : null),
    select,
    spawn,
    moveNode,
    deleteNode,
    deleteWire,
    undo,
    redo,
    undoDepth: () => undoStack.length,
    isDirty: () => dirty,
    transform: () => ({ ...transform }),
    toWorld,
    setZoom: (z) => setZoom(z),
    fit,
    autoLayout: runAutoLayout,
    openSaveDialog,
    // Swap the palette in place, exactly as the run monitor does: the view's
    // own setAgents re-keys the registry and invalidates the header signatures,
    // so the next render repaints tint/icon/title. Destroying the view here
    // would `host.replaceChildren()` the world out of the stage and repaint
    // into a detached root — a permanently blank canvas after any agent save.
    setAgents(list) { agents = list || []; view.setAgents(byKey(agents)); render(); },
    refresh: render,
    destroy() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      doc.removeEventListener('pointermove', onPointerMove);
      doc.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      doc.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('keyup', onKeyUp);
      if (paletteHost) paletteHost.removeEventListener('click', onPaletteClick);
      if (inspectorHost) inspectorHost.removeEventListener('change', onInspectorChange);
    },
  };
  return editor;
}
