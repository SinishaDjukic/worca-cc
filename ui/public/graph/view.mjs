// ui/public/graph/view.mjs
// The ONE v2 graph renderer: DOM cards + one SVG wire layer (the ghost path
// included), both inside `.gv-world`, which carries the only pan/zoom transform.
// Three callers share it — the composer (edit), the run monitor (monitor) and
// the previews (static) — so it renders a template plus a decor bag and owns no
// interaction: composer.mjs binds the pointers to `view.stage`.
//
// CONTRACT: the render path NEVER measures. Every anchor, size and wire path is
// derived from the model x/y through the SHARED geometry module, which is what
// makes the renderer testable under jsdom (no layout there) and what keeps a
// repaint O(n) instead of a forced reflow per node. Do not reach for
// getBoundingClientRect in here.
//
// This file lives at depth 3 below the repo root, so the shared core is three
// `..` up; the browser clamps that at the URL root and the server serves it at
// /src/shared (P1). Absolute specifiers would break the Node-side UI tests.
// graphBounds/fitBounds are imported HERE even though only Task 3 calls them:
// this is the file's one geometry import and Task 3 appends code, not imports.
import {
  NODE_W, ZOOM_MIN, ZOOM_MAX,
  injectGeometry, nodeSize, portAnchor, bezierPath, bezierMid, graphBounds, fitBounds,
} from '../../../src/shared/graph/geometry.mjs';
import { portsOf, resolveOrOutType } from '../../../src/shared/graph/ports.mjs';
import { classifyLoops } from '../../../src/shared/graph/loops.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Legend copy is NORMATIVE (spec §7.1); the agents card header row renders it. */
export const LEGEND_TEXT = 'grey = data · amber = loop · ◆ = conditional · ○ = gate · ⤫N = fan-out';
export const FANOUT_GLYPH = '⤫';

/** Per-mode zoom clamps (§7.6). `edit` uses the geometry defaults. */
export const MODE_ZOOM = {
  edit: { min: ZOOM_MIN, max: ZOOM_MAX },
  monitor: { min: 0.3, max: ZOOM_MAX },
  static: { min: 0.3, max: 1 },
};

/** The 24px caption row each captioned kind closes with. */
const CAPTIONS = { task: 'prompt + attached files', end: 'pipeline result', or: 'forwards freshest input' };

/** Flow cards are engine builtins — no sidecar — so their glyphs live here. */
const FLOW_META = {
  task: { title: 'Task', icon: '<path d="M5.2 3.4h9.6v13.2H5.2z"/><path d="M7.6 7.2h4.8M7.6 10h4.8M7.6 12.8h3"/>' },
  end: { title: 'End', icon: '<path d="M5.6 3.4v13.2"/><path d="M5.6 4.2h8.6l-2.4 3.4 2.4 3.4H5.6z"/>' },
  and: { title: 'AND', icon: '<path d="M3.4 6h3.2M3.4 14h3.2"/><path d="M6.6 4.2h3.2a5.8 5.8 0 010 11.6H6.6z"/><path d="M15.6 10h1.8"/>' },
  or: { title: 'OR', icon: '<path d="M3.4 5.5h3.6l4.4 4.5h5.4M3.4 14.5h3.6l4.4-4.5"/><path d="M14.6 7.8l2.2 2.2-2.2 2.2"/>' },
  combine: { title: 'Combine', icon: '<path d="M3.4 5.5h4.2l4.4 4.5h4.6M3.4 14.5h4.2l4.4-4.5"/><path d="M14.4 7.8l2.2 2.2-2.2 2.2"/>' },
};
const FLOW_VIEWBOX = '0 0 20 20';
const AGENT_VIEWBOX = '0 0 24 24';

// Builtin icons are repo-shipped SVG fragments (trusted, injected raw). A USER
// agent's metadata is user-writable (POST /api/agents), so its icon could carry
// arbitrary markup — those get a fixed glyph instead. This is app.js's
// origin-trust gate, ported verbatim: do not relax it.
export const USER_AGENT_ICON = '<circle cx="12" cy="12" r="3.4"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"></path>';
export function safeAgentIcon(meta) {
  return meta && meta.origin === 'user' ? USER_AGENT_ICON : String((meta && meta.icon) || '');
}

const dotClass = (t) => `dot ${t === 'md' || t === 'json' || t === 'void' || t === 'any' ? t : 'md'}`;
const whenCaption = (w) => (w === 'blocking' ? 'on blocking' : w === 'clean' ? 'on clean' : '');

export function createGraphView(host, {
  doc = globalThis.document,
  mode = 'edit',
  portsFn,
  agents: agentsIn = {},
  raf = null,
  viewport = null,
  zoomMin = null,
  zoomMax = null,
  wheelPan = 'always',
} = {}) {
  const win = doc.defaultView || globalThis;
  const clamps = MODE_ZOOM[mode] || MODE_ZOOM.edit;
  const zMin = zoomMin == null ? clamps.min : zoomMin;
  const zMax = zoomMax == null ? clamps.max : zoomMax;
  const schedule = raf || ((fn) => (win.requestAnimationFrame ? win.requestAnimationFrame(fn) : setTimeout(fn, 16)));
  let agents = agentsIn || {};

  const stage = doc.createElement('div');
  stage.className = `gv-stage gv-${mode}`;
  stage.setAttribute('tabindex', '0');
  stage.setAttribute('aria-label', 'pipeline canvas');
  const world = doc.createElement('div');
  world.className = 'gv-world';
  const wiresEl = doc.createElementNS(SVG_NS, 'svg');
  wiresEl.setAttribute('class', 'gv-wires');
  wiresEl.setAttribute('width', '1');
  wiresEl.setAttribute('height', '1');
  const ghost = doc.createElementNS(SVG_NS, 'path');
  ghost.setAttribute('class', 'wire ghost');
  ghost.dataset.ghost = '1';
  wiresEl.appendChild(ghost);          // ALWAYS last: committed wires insert BEFORE it
  world.appendChild(wiresEl);
  stage.appendChild(world);
  // Never replaceChildren(host): `.gv-chip` and `.gv-ins-rail` are the stage's
  // SIBLINGS inside the same canvas host and must survive a (re)mount.
  host.prepend(stage);
  injectGeometry(stage);

  const nodeEls = new Map();      // nodeId  -> card element
  const wireEls = new Map();      // wireId  -> path element
  const badgeEls = new Map();     // wireId  -> .wbadge element
  const incident = new Map();     // nodeId  -> Set(wireId)
  const dCache = new Map();       // wireId  -> last written `d`
  const footers = new Map();      // nodeId  -> footerRows (int)
  const navs = [];                // nav controllers created by createNav()
  let T = { x: 0, y: 0, z: 1 };
  let current = null;             // last rendered template
  let ctx = null;                 // last render context (ports, loops, wired inputs)
  const stats = { wireDUpdates: 0, ghostUpdates: 0, rectReads: 0 };

  const h = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const svgEl = (tag, cls) => {
    const n = doc.createElementNS(SVG_NS, tag);
    if (cls) n.setAttribute('class', cls);
    return n;
  };
  const portsAt = (node) => portsOf(portsFn, node) || { inputs: [], outputs: [] };
  const sizeOf = (node) => nodeSize(node, portsAt(node), { footerRows: footers.get(node.id) || 0 });

  function headerOf(node) {
    if (node.kind === 'agent') {
      const meta = agents[node.key] || null;
      return {
        cls: `h-${(meta && meta.color) || 'blue'}`,
        title: (meta && meta.displayName) || node.key || node.id,
        icon: safeAgentIcon(meta),
        viewBox: AGENT_VIEWBOX,
      };
    }
    const flow = FLOW_META[node.kind] || { title: node.kind, icon: '' };
    return { cls: 'h-flow', title: flow.title, icon: flow.icon, viewBox: FLOW_VIEWBOX };
  }

  function portRow(port, dir, resolvedType) {
    const type = resolvedType || port.type;
    const row = h('div', `prow ${dir}`);
    row.dataset.port = port.id;
    row.dataset.dir = dir;
    row.dataset.type = type;
    const cond = dir === 'out' && (port.when === 'blocking' || port.when === 'clean');
    const glyph = cond ? h('i', 'dia') : h('i', dotClass(type));
    const name = h('span', 'pn', port.id);
    const cap = h('span', cond ? 'pt cond' : 'pt', cond ? whenCaption(port.when) : type);
    if (dir === 'in') {
      row.append(glyph, name, cap);
      if (port.loop) row.appendChild(h('span', 'chip am mla', 'loop'));
      else if (port.expands) row.appendChild(h('span', 'chip fan mla', `${FANOUT_GLYPH}N`));
    } else {
      row.append(cap, name, glyph);
    }
    return row;
  }

  function gateRow(wired) {
    const row = h('div', `prow in gate${wired ? ' wired' : ''}`);
    row.dataset.port = 'await';
    row.dataset.dir = 'in';
    row.dataset.type = 'any';
    row.append(h('i', 'gdot'), h('span', 'pn', 'await'), h('span', 'pt', 'any'));
    return row;
  }

  // The body's identity: rebuild the rows ONLY when one of these changes. A pure
  // move, a selection or a status flip must never touch a row element (the
  // PR #359 defect: replaceChildren per pointermove for every card).
  function bodySig(node, p, orType, awaitWired) {
    const io = [...p.inputs, ...p.outputs]
      .map((q) => `${q.id}:${q.type}:${q.when || ''}:${q.loop ? 'L' : ''}${q.expands ? 'X' : ''}`)
      .join(',');
    return [node.kind, node.key || '', io, node.config && node.config.arity != null ? node.config.arity : '',
      orType || '', awaitWired ? '1' : '0'].join('|');
  }

  function paintBody(el, node, p, orType, awaitWired) {
    const body = el.querySelector(':scope > .nbody');
    const sig = bodySig(node, p, orType, awaitWired);
    if (body.dataset.sig === sig) return;
    body.dataset.sig = sig;
    const metaIns = p.inputs.filter((x) => !x.synthetic);
    const gate = p.inputs.find((x) => x.synthetic) || null;
    const caption = CAPTIONS[node.kind] || '';
    const kids = [];
    // Zones top->bottom, each emitted only when non-empty, a 9px separator only
    // BETWEEN emitted zones — this is exactly what nodeSize counts.
    const zone = (rows) => { if (kids.length) kids.push(h('div', 'psep')); kids.push(...rows); };
    if (metaIns.length) zone(metaIns.map((q) => portRow(q, 'in')));
    if (p.outputs.length) zone(p.outputs.map((q) => portRow(q, 'out', node.kind === 'or' ? (orType || 'any') : null)));
    if (gate) zone([gateRow(awaitWired)]);
    if (caption) zone([(() => { const c = h('div', 'prow cap'); c.appendChild(h('span', 'pt', caption)); return c; })()]);
    body.replaceChildren(...kids);
  }

  function placeCard(node) {
    const el = nodeEls.get(node.id);
    if (el) el.style.transform = `translate(${node.x}px, ${node.y}px)`;
  }

  const svgChevron = () => {
    const s = doc.createElementNS(SVG_NS, 'svg');
    s.setAttribute('class', 'chev'); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.innerHTML = '<path d="M6 9l6 6 6-6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
    return s;
  };
  /** One footer band -> one element (the run monitor's vocabulary; see Interfaces). */
  function bandEl(nodeId, band) {
    if (band.kind === 'fan') {
      const fan = h('div', 'fan');
      for (const led of band.leds || []) fan.appendChild(h('i', `sq${led === 'run' ? ' on' : ''}`));
      fan.appendChild(h('span', 'fl', `×${band.count}`));
      return fan;
    }
    if (band.kind === 'strip') {
      const btn = doc.createElement('button');
      btn.type = 'button'; btn.className = 'xtoggle'; btn.dataset.nodeId = nodeId;
      btn.setAttribute('aria-expanded', band.expanded ? 'true' : 'false');
      const sq = h('span', 'xsq');
      for (const led of band.leds || []) sq.appendChild(h('i', `xq is-${led}`));
      btn.append(sq, h('span', 'xsum', band.summary || ''), svgChevron());
      return btn;
    }
    if (band.kind === 'exec') {
      const row = h('div', `xrow is-${band.led || 'pending'}`);
      row.dataset.executionId = band.executionId || '';
      row.dataset.nodeId = nodeId;
      row.append(h('i', 'led'), h('span', 'xl', band.label || ''), h('span', 'xr', band.right || ''));
      return row;
    }
    const res = h('div', 'xresult');           // kind: 'result'
    if (!band.path) { res.textContent = band.text || ''; return res; }
    const a = h('a', null, band.text || '');
    a.href = '#'; a.dataset.path = band.path; a.title = band.path;
    res.appendChild(a);
    return res;
  }

  function paintCard(el, node) {
    const p = portsAt(node);
    const orType = node.kind === 'or' ? resolveOrOutType(current, portsFn, node.id, new Set()) : null;
    const awaitWired = ctx.wiredInputs.has(`${node.id}.await`);
    // Never rewrite className wholesale: `sel`, `is-*` and `bad` are owned by the
    // fast paths and must survive a repaint.
    if (el.dataset.kind !== node.kind) {
      for (const c of [...el.classList]) if (c.startsWith('node-')) el.classList.remove(c);
      el.classList.add('node', `node-${node.kind}`);
      el.dataset.kind = node.kind;
    }
    el.style.width = `${NODE_W}px`;
    el.style.height = `${sizeOf(node).h}px`;
    const head = el.querySelector(':scope > .nhead');
    const hd = headerOf(node);
    const sig = `${hd.cls}|${hd.title}|${hd.icon}`;
    if (head.dataset.sig !== sig) {
      head.dataset.sig = sig;
      head.className = `nhead ${hd.cls}`;
      const icon = svgEl('svg');
      icon.setAttribute('viewBox', hd.viewBox);
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.innerHTML = hd.icon;
      head.replaceChildren(icon, h('span', 'tt', hd.title));
    }
    paintBody(el, node, p, orType, awaitWired);
    placeCard(node);
  }

  function buildCard(node) {
    const el = h('div', `node node-${node.kind}`);
    el.dataset.nodeId = node.id;
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', `${node.kind} ${node.key || node.id}`);
    el.append(h('div', 'nhead'), h('div', 'nbody'));
    return el;
  }

  const anchorOf = (end, dir) => {
    const node = ctx.byId.get(end.node);
    return node ? portAnchor(node, portsAt(node), end.port, dir) : null;
  };

  /** Writes `d` only when the cached string differs — the whole point of the cache. */
  function paintWire(wireId) {
    const w = ctx.wireById.get(wireId);
    const path = wireEls.get(wireId);
    if (!w || !path) return;
    const a = anchorOf(w.from, 'out');
    const b = anchorOf(w.to, 'in');
    if (!a || !b) return;                       // dangling endpoint paints nothing, never NaN
    const loop = ctx.loopWireIds.has(wireId);
    const d = bezierPath(a, b, { loop });
    if (dCache.get(wireId) !== d) {
      dCache.set(wireId, d);
      path.setAttribute('d', d);
      stats.wireDUpdates += 1;
    }
    const badge = badgeEls.get(wireId);
    if (badge) {
      const mid = bezierMid(a, b, { loop });
      badge.style.left = `${mid.x}px`;
      badge.style.top = `${mid.y}px`;
    }
  }

  function renderNodes() {
    const seen = new Set();
    for (const node of current.nodes) {
      seen.add(node.id);
      let el = nodeEls.get(node.id);
      if (!el) { el = buildCard(node); nodeEls.set(node.id, el); world.appendChild(el); }
      paintCard(el, node);
    }
    for (const [id, el] of [...nodeEls]) {
      if (seen.has(id)) continue;
      el.remove(); nodeEls.delete(id); footers.delete(id);
    }
  }

  function renderWires() {
    const seenW = new Set();
    const seenB = new Set();
    incident.clear();
    for (const w of current.wires) {
      if (!w || !w.from || !w.to) continue;
      seenW.add(w.id);
      for (const id of [w.from.node, w.to.node]) {
        if (!incident.has(id)) incident.set(id, new Set());
        incident.get(id).add(w.id);
      }
      let path = wireEls.get(w.id);
      if (!path) {
        path = svgEl('path', 'wire');
        path.dataset.wireId = w.id;
        wireEls.set(w.id, path);
        wiresEl.insertBefore(path, ghost);      // committed wires go BEFORE the ghost
      }
      const loop = ctx.loopWireIds.has(w.id);
      path.setAttribute('class', `wire${loop ? ' loop' : ''}`);
      const budget = w.config && w.config.maxCycles;
      if (Number.isInteger(budget)) {
        seenB.add(w.id);
        let badge = badgeEls.get(w.id);
        if (!badge) { badge = h('div', 'wbadge'); badge.dataset.wireId = w.id; badgeEls.set(w.id, badge); world.appendChild(badge); }
        badge.textContent = `≤${budget}`;
      }
      dCache.delete(w.id);                      // geometry may have moved: force one write
      paintWire(w.id);
    }
    for (const [id, el] of [...wireEls]) if (!seenW.has(id)) { el.remove(); wireEls.delete(id); dCache.delete(id); }
    for (const [id, el] of [...badgeEls]) if (!seenB.has(id)) { el.remove(); badgeEls.delete(id); }
  }

  /** Validation pips + `bad` wires. One pip per node, title = the first message. */
  function applyReport(report) {
    const byNode = new Map();
    const badWires = new Set();
    for (const e of (report && report.errors) || []) {
      if (e.nodeId && !byNode.has(e.nodeId)) byNode.set(e.nodeId, e.message || e.code);
      if (e.wireId) badWires.add(e.wireId);
    }
    for (const [id, el] of nodeEls) {
      const msg = byNode.get(id);
      let pip = el.querySelector(':scope > .npip');
      if (!msg) { if (pip) pip.remove(); continue; }
      if (!pip) { pip = h('div', 'npip'); pip.dataset.nodeId = id; el.appendChild(pip); }
      pip.title = msg;
    }
    for (const [id, el] of wireEls) el.classList.toggle('bad', badWires.has(id));
  }

  function render(template, state = {}) {
    current = template;
    ctx = {
      byId: new Map(template.nodes.map((n) => [n.id, n])),
      wireById: new Map(template.wires.map((w) => [w.id, w])),
      wiredInputs: new Set(template.wires.filter((w) => w && w.to).map((w) => `${w.to.node}.${w.to.port}`)),
      loopWireIds: classifyLoops(template, portsFn).loopWireIds,
    };
    renderNodes();
    renderWires();
    view.setSelection(state.selection || null);
    applyReport(state.report || null);
    // (No decor here: run-decor.mjs's applyDecor(view, decor) — P6 — is the ONE
    // decor pass, run AFTER render through the fast paths below.)
    return view;
  }

  function setTransform(next) {
    T = { x: Number(next && next.x) || 0, y: Number(next && next.y) || 0, z: Number(next && next.z) || T.z || 1 };
    world.style.transform = `translate(${T.x}px, ${T.y}px) scale(${T.z})`;
    return { ...T };
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** MODEL bounds (no DOM measure): the shared `graphBounds` over the rendered
   *  template, with this view's footer rows (only the view knows them). */
  function bounds(pad = 0) {
    if (!current || !current.nodes.length) return null;
    return graphBounds(current, portsAt, { pad, footerRowsOf: (n) => footers.get(n.id) || 0 });
  }
  /** `fitBounds` → `{z, tx, ty}` mapped onto this view's `{x, y, z}` transform. */
  const applyFit = (b, width, height, zoomMax) => {
    const f = fitBounds(b, { width, height }, { zoomMin: zMin, zoomMax });
    setTransform({ x: f.tx, y: f.ty, z: f.z });
  };

  /** Zoom about a stage-local point s: w = (s − t)/z is invariant ⇒ t' = s − w·z'. */
  function zoomAbout(zNext, sx, sy) {
    const z2 = clamp(zNext, zMin, zMax);
    const wx = (sx - T.x) / T.z;
    const wy = (sy - T.y) / T.z;
    setTransform({ x: sx - wx * z2, y: sy - wy * z2, z: z2 });
  }

  let R = { left: 0, top: 0, width: 0, height: 0 };
  /** The ONE measurement in the whole renderer. `viewport` injects it under jsdom. */
  function readRect() {
    if (viewport) { R = { ...viewport() }; return R; }
    const b = stage.getBoundingClientRect();
    R = { left: b.left, top: b.top, width: b.width, height: b.height };
    stats.rectReads += 1;
    return R;
  }
  const toWorld = (cx, cy) => ({ x: (cx - R.left - T.x) / T.z, y: (cy - R.top - T.y) / T.z });
  const toScreen = (wx, wy) => ({ x: wx * T.z + T.x, y: wy * T.z + T.y });

  const view = {
    stage, world, wiresEl, ghostEl: ghost, mode, stats, schedule, wheelPan,
    zoomMin: zMin, zoomMax: zMax,
    render,
    setTransform,
    getTransform: () => ({ ...T }),
    nodeEl: (id) => nodeEls.get(id) || null,
    wireEl: (id) => wireEls.get(id) || null,
    template: () => current,
    ports: (node) => portsAt(node),
    size: (node) => sizeOf(node),
    anchor: (node, portId, dir) => portAnchor(node, portsAt(node), portId, dir),
    incidentOf: (nodeId) => incident.get(nodeId) || new Set(),
    isLoopWire: (wireId) => Boolean(ctx && ctx.loopWireIds.has(wireId)),
    setSelection(sel) {
      for (const [id, el] of nodeEls) el.classList.toggle('sel', Boolean(sel && sel.kind === 'node' && sel.id === id));
      for (const [id, el] of wireEls) el.classList.toggle('sel', Boolean(sel && sel.kind === 'wire' && sel.id === id));
    },
    // (no applyDecor on the view: run-decor.mjs's applyDecor(view, decor) — P6 — owns the decor pass)
    /** Statuses the monitor sets; every one is a class toggle, never a rebuild. */
    setStatus(nodeId, status) {
      const el = nodeEls.get(nodeId);
      if (!el) return;
      for (const s of ['pending', 'active', 'done', 'paused', 'stopped', 'error', 'skipped']) {
        el.classList.toggle(`is-${s}`, s === status);
      }
      if (status) el.dataset.status = status; else delete el.dataset.status;
    },
    /** Replace the executions footer with `bands` (the run monitor's vocabulary,
     *  see the Interfaces block) and RE-SIZE the card from the band count. Anchors
     *  are top-relative, so no wire re-routes (D8) — only height, hit box and fit
     *  bounds change. The ONE place a run-mode card height is written. */
    setFooter(nodeId, bands) {
      const node = ctx && ctx.byId.get(nodeId);
      const el = nodeEls.get(nodeId);
      if (!node || !el) return;
      const list = Array.isArray(bands) ? bands.filter(Boolean) : [];
      for (const stale of el.querySelectorAll(':scope > .xfoot')) stale.remove();
      if (list.length) {
        const foot = h('div', 'xfoot');
        foot.dataset.nodeId = nodeId;
        for (const band of list) foot.appendChild(bandEl(nodeId, band));
        el.appendChild(foot);
      }
      if (list.length) footers.set(nodeId, list.length); else footers.delete(nodeId);
      el.style.height = `${sizeOf(node).h}px`;
    },
    /** Per-card ornaments: agent colour, gate pip, header duration · cost. */
    setNodeChrome(nodeId, { color = '', gate = null, totals = null } = {}) {
      const el = nodeEls.get(nodeId);
      if (!el) return;
      el.style.setProperty('--c', color ? `var(--${color})` : '');
      // Keep the 1 s elapsed tick (app.js `.run-node[data-id] .dur`) working on v2 cards.
      el.classList.add('run-node');
      el.dataset.id = nodeId;
      for (const stale of el.querySelectorAll(':scope > .ngate')) stale.remove();
      if (gate) {
        const pip = h('div', 'ngate', '?');
        pip.dataset.wireId = gate.wireId || '';
        pip.title = gate.title || '';
        el.appendChild(pip);
      }
      let run = el.querySelector(':scope > .nrun');
      if (!totals) { if (run) run.remove(); return; }
      if (!run) { run = h('div', 'nrun'); run.append(h('span', 'dur'), h('span', 'cost')); el.appendChild(run); }
      run.querySelector('.dur').textContent = totals.dur || '';
      run.querySelector('.cost').textContent = totals.cost || '';
    },
    /** The amber `N×` delivery badge on a loop wire's bow (no-op on a plain wire). */
    setWireBadge(wireId, badge) {
      const badgeHost = badgeEls.get(wireId);
      if (!badgeHost) return;
      for (const stale of badgeHost.querySelectorAll('.wfired')) stale.remove();
      if (!badge) return;
      const b = h('span', 'wfired', badge.text || '');
      if (badge.title) b.title = badge.title;
      badgeHost.appendChild(b);
    },
    setWireLive(ids) {
      const live = new Set(ids || []);
      for (const [id, el] of wireEls) el.classList.toggle('wire-live', live.has(id));
    },
    /** One transform write per dragged node + its incident wires only. */
    moveNode(nodeId) {
      const node = ctx && ctx.byId.get(nodeId);
      if (!node) return;
      placeCard(node);
      for (const wid of incident.get(nodeId) || []) paintWire(wid);
    },
    paintWire,
    /** `d = null` hides the ghost. Identical `d` never re-writes the attribute. */
    setGhost(d, cls = '') {
      if (d == null) { ghost.setAttribute('class', 'wire ghost'); return; }
      if (ghost.getAttribute('d') !== d) { ghost.setAttribute('d', d); stats.ghostUpdates += 1; }
      ghost.setAttribute('class', `wire ghost on${cls ? ` ${cls}` : ''}`);
    },
    /** Pan (never zoom) the node's box centre to the viewport centre. */
    centerOn(nodeId) {
      const node = ctx && ctx.byId.get(nodeId);
      if (!node) return;
      const r = view.readRect();
      const s = sizeOf(node);
      setTransform({
        x: r.width / 2 - (node.x + s.w / 2) * T.z,
        y: r.height / 2 - (node.y + s.h / 2) * T.z,
        z: T.z,
      });
    },
    readRect, toWorld, toScreen, rect: () => ({ ...R }),
    bounds,
    zoomAbout,
    /** Auto-fit from MODEL bounds into the band left of the floating inspector.
     *  Fit NEVER magnifies past 1x; the user zoom range stays zoomMin..zoomMax.
     *  Runs on view entry/re-entry and template load only — never after an edit. */
    fit({ insetRight = 0, pad = 60 } = {}) {
      const r = view.readRect();
      const b = bounds(pad);
      if (!b) return;
      applyFit(b, Math.max(1, (r.width || 0) - insetRight), Math.max(1, r.height || 0), 1);   // never past 1×
    },
    /** Static hosts: fit the graph into a card of width `w` (ResizeObserver-driven). */
    fitToWidth(w) {
      const r = view.readRect();
      const b = bounds(60);
      if (!b) return;
      const vw = Math.max(1, w || r.width || 0);
      const f = fitBounds(b, { width: vw, height: Number.MAX_SAFE_INTEGER }, { zoomMin: zMin, zoomMax: 1 });   // width decides z
      setTransform({ x: f.tx, y: (Math.max(1, r.height || 0) - b.h * f.z) / 2 - b.y * f.z, z: f.z });
    },
    /** Wheel/zoom nav for `monitor` hosts. `static` gets nothing; `edit` binds its
     *  own richer pipeline in composer.mjs and does NOT call this. */
    createNav({ wheelPan: pan = wheelPan, onEngaged = null } = {}) {
      if (mode === 'static') return { destroy() {} };
      let engaged = pan === 'always';
      const setEngaged = (v) => { if (engaged !== v) { engaged = v; if (onEngaged) onEngaged(v); } };
      const onWheel = (ev) => {
        const zoom = ev.ctrlKey || ev.metaKey;
        if (!zoom && !engaged) return;                   // engaged-only: let the PAGE scroll
        ev.preventDefault();
        const m = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? (R.height || 560) : 1;
        if (zoom) { zoomAbout(T.z * Math.exp(-ev.deltaY * m * 0.002), ev.clientX - R.left, ev.clientY - R.top); return; }
        setTransform({ x: T.x - ev.deltaX * m, y: T.y - ev.deltaY * m, z: T.z });
      };
      const engage = () => setEngaged(true);
      const disengage = (ev) => { if (pan !== 'always' && !stage.contains(ev.target)) setEngaged(false); };
      const onKey = (ev) => { if (ev.key === 'Escape' && pan !== 'always') setEngaged(false); };
      view.readRect();
      stage.addEventListener('wheel', onWheel, { passive: false });
      stage.addEventListener('pointerdown', engage);
      stage.addEventListener('focus', engage);
      doc.addEventListener('pointerdown', disengage, true);
      doc.addEventListener('keydown', onKey);
      const nav = {
        isEngaged: () => engaged,
        destroy() {
          stage.removeEventListener('wheel', onWheel);
          stage.removeEventListener('pointerdown', engage);
          stage.removeEventListener('focus', engage);
          doc.removeEventListener('pointerdown', disengage, true);
          doc.removeEventListener('keydown', onKey);
        },
      };
      navs.push(nav);
      return nav;
    },
    /** Swap the registry the headers read (the palette arrives after the first
     *  paint when /api/agents is slow). Header signatures are invalidated so the
     *  next render repaints tint, icon and title. Never destroy the view here —
     *  that would repaint into a detached root (a permanently blank canvas). */
    setAgents(next) {
      agents = next || {};
      for (const el of nodeEls.values()) {
        const head = el.querySelector(':scope > .nhead');
        if (head) delete head.dataset.sig;
      }
      if (current) render(current, {});
    },
    destroy() {
      for (const n of navs.splice(0)) n.destroy();
      stage.remove();
      nodeEls.clear(); wireEls.clear(); badgeEls.clear(); incident.clear(); dCache.clear(); footers.clear();
      current = null; ctx = null;
    },
  };
  // Internals the later tasks' fast paths close over.
  view._internals = { incident, dCache, footers };
  setTransform(T);
  return view;
}
