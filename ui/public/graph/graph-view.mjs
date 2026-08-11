// ui/public/graph/graph-view.mjs
// The shared graph renderer: node cards + ONE svg wire layer, both inside a
// single `.gv-world` div that carries the whole pan/zoom transform. Three
// callers share it — the composer (editable), the run monitor (live decor) and
// the saved-pipeline preview (static) — so it renders a template and a decor
// bag and owns no interaction of its own; composer-editor.mjs binds pointers.
//
// CONTRACT: the render path NEVER measures. Every anchor, size and wire path is
// derived from the model x/y through graph-geometry, which is what makes the
// renderer testable under jsdom (no layout there) and what keeps a repaint O(n)
// instead of a forced reflow per node. Do not reach for getBoundingClientRect
// in here — interaction code above may, the renderer may not.
//
// Card anatomy (spec §6 as amended by f): meta inputs, 9px separator, outputs,
// a SECOND 9px separator, then the engine-synthesized `await` gate row on agent
// cards only (dot on the LEFT edge, subdued until wired). Task/End/OR close with
// a 24px caption row. Flow cards (task/end/and/or/combine) wear the dark-ink
// "system" header — deliberately not an agent tint.

import { classifyLoops, resolveOrOutType, CAPTION_KINDS } from './graph-model.mjs';
import { nodeSize, portAnchor, bezierPath, NODE_W, PORT_SEP } from './graph-geometry.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Zoom below which port dots stop being useful and fade out (spec §6). */
export const DOT_FADE_ZOOM = 0.6;

// Built-in icons are repo-shipped SVG fragments (trusted, injected raw). User
// agents' metadata is user-writable (POST /api/agents, wizard Mode B), so their
// icon could carry arbitrary markup — they get a fixed glyph instead. This is
// app.js's origin-trust gate, ported verbatim so the canvas is no weaker than
// the run graph it replaces.
export const USER_AGENT_ICON = '<circle cx="12" cy="12" r="3.4"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"></path>';

export function safeAgentIcon(meta) {
  return meta && meta.origin === 'user' ? USER_AGENT_ICON : String((meta && meta.icon) || '');
}

/** Flow cards are engine builtins — no sidecar, no registry entry, so their
 *  glyphs and titles live here (mockup's Flow group, 20-unit grid). */
const FLOW_META = {
  task: {
    title: 'Task',
    icon: '<path d="M5.2 3.4h9.6v13.2H5.2z"/><path d="M7.6 7.2h4.8M7.6 10h4.8M7.6 12.8h3"/>',
  },
  end: {
    title: 'End',
    icon: '<path d="M5.6 3.4v13.2"/><path d="M5.6 4.2h8.6l-2.4 3.4 2.4 3.4H5.6z"/>',
  },
  and: {
    title: 'AND',
    icon: '<path d="M3.4 6h3.2M3.4 14h3.2"/><path d="M6.6 4.2h3.2a5.8 5.8 0 010 11.6H6.6z"/><path d="M15.6 10h1.8"/>',
  },
  or: {
    title: 'OR',
    icon: '<path d="M3.4 5.5h3.6l4.4 4.5h5.4M3.4 14.5h3.6l4.4-4.5"/><path d="M14.6 7.8l2.2 2.2-2.2 2.2"/>',
  },
  combine: {
    title: 'Combine',
    icon: '<path d="M3.4 5.5h4.2l4.4 4.5h4.6M3.4 14.5h4.2l4.4-4.5"/><path d="M14.4 7.8l2.2 2.2-2.2 2.2"/>',
  },
};
const FLOW_VIEWBOX = '0 0 20 20';
const AGENT_VIEWBOX = '0 0 24 24';

/** The 24px caption row each captioned kind closes with (mockup convention). */
const CAPTIONS = {
  task: 'prompt + attached files',
  end: 'pipeline result',
  or: 'forwards freshest input',
};

/** Task and End are one-per-template sinks/sources — pinned styling. */
const PINNED_KINDS = new Set(['task', 'end']);

/** Legend copy is NORMATIVE (spec §6 ⟨f⟩) — the mockup's wording is illustrative. */
export const LEGEND_TEXT = 'grey = data · amber = loop · ◆ = conditional · ○ = gate · ⤫N = fan-out';

/** The fan-out chip glyph, the same one the legend names. */
export const FANOUT_GLYPH = '⤫';

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function svgEl(doc, tag, cls) {
  const n = doc.createElementNS(SVG_NS, tag);
  if (cls) n.setAttribute('class', cls);
  return n;
}

/** The dot glyph class for a port's type. `any` renders hollow-with-ink-ring. */
function dotClass(type) {
  return `dot ${type === 'md' || type === 'json' || type === 'void' || type === 'any' ? type : 'md'}`;
}

/** Caption under a conditional output — the verdict arm it fires on. */
function whenCaption(when) {
  return when === 'blocking' ? 'on blocking' : when === 'clean' ? 'on clean' : '';
}

/**
 * The renderer. `host` is the canvas element; everything is (re)built inside it.
 *
 * @param {Element} host
 * @param {{doc?: Document, portsFn: Function, agents?: Record<string, object>}} opts
 *   `agents` maps agent key -> palette entry (mergePalette shape) for the header
 *   tint, icon and display name. Unknown keys degrade to a neutral card.
 */
export function createGraphView(host, { doc = globalThis.document, portsFn, agents: agentsIn = {} } = {}) {
  let agents = agentsIn;
  const root = h(doc, 'div', 'gv');
  const world = h(doc, 'div', 'gv-world');
  const wiresEl = svgEl(doc, 'svg', 'gv-wires');
  // 1x1 with overflow:visible — the paths carry absolute world coordinates, so
  // the svg box is a mount point, not a viewport (no viewBox, no scaling).
  wiresEl.setAttribute('width', '1');
  wiresEl.setAttribute('height', '1');
  world.appendChild(wiresEl);
  root.appendChild(world);
  host.replaceChildren(root);

  const nodeEls = new Map();   // nodeId -> card element
  const wireEls = new Map();   // wireId -> path element
  const badgeEls = new Map();  // wireId -> .wbadge element
  let transform = { x: 0, y: 0, zoom: 1 };
  let current = null;

  function agentMeta(node) {
    return (node.kind === 'agent' && agents[node.key]) || null;
  }

  function headerOf(node) {
    if (node.kind === 'agent') {
      const meta = agentMeta(node);
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

  /** One 24px port row. `dir` decides the mirror layout and the dot edge. */
  function portRow(node, port, dir, resolvedType) {
    const type = resolvedType || port.type;
    const row = h(doc, 'div', `prow ${dir === 'in' ? 'in' : 'out'}`);
    row.dataset.port = port.id;
    row.dataset.dir = dir;
    row.dataset.type = type;
    const conditional = dir === 'out' && (port.when === 'blocking' || port.when === 'clean');
    const caption = conditional ? whenCaption(port.when) : type;
    const name = h(doc, 'span', 'pn', port.id);
    const cap = h(doc, 'span', conditional ? 'pt cond' : 'pt', caption);
    const glyph = conditional
      ? h(doc, 'i', 'dia')
      : h(doc, 'i', dotClass(type));

    if (dir === 'in') {
      row.append(glyph, name, cap);
      if (port.loop) row.appendChild(h(doc, 'span', 'chip am mla', 'loop'));
      else if (port.expands) row.appendChild(h(doc, 'span', 'chip fan mla', `${FANOUT_GLYPH}N`));
    } else {
      row.append(cap, name, glyph);
    }
    return row;
  }

  /** The engine-synthesized gate: left-edge dashed ring, subdued until wired. */
  function gateRow(node, wired) {
    const row = h(doc, 'div', `prow in gate${wired ? '' : ' off'}`);
    row.dataset.port = 'await';
    row.dataset.dir = 'in';
    row.dataset.type = 'any';
    row.append(h(doc, 'i', 'gdot'), h(doc, 'span', 'pn', 'await'), h(doc, 'span', 'pt', 'any'));
    return row;
  }

  function captionRow(text) {
    const row = h(doc, 'div', 'prow cap');
    row.appendChild(h(doc, 'span', 'pt', text));
    return row;
  }

  function buildCard(node) {
    const el = h(doc, 'div', 'node');
    el.dataset.nodeId = node.id;
    el.appendChild(h(doc, 'div', 'nhead'));
    el.appendChild(h(doc, 'div', 'nbody'));
    return el;
  }

  // Decor appends siblings (the validation pip), so header/body are addressed
  // by class — never by firstElementChild/lastElementChild, which would drift
  // the moment a pip lands and silently repaint the wrong element.
  const headOf = (el) => el.querySelector(':scope > .nhead');
  const bodyOf = (el) => el.querySelector(':scope > .nbody');

  function paintCard(el, node, ctx) {
    const p = portsFn(node) || { inputs: [], outputs: [] };
    const metaIns = p.inputs.filter((x) => !x.synthetic);
    const awaitPort = p.inputs.find((x) => x.synthetic) || null;
    const caption = CAPTION_KINDS.has(node.kind) ? CAPTIONS[node.kind] : '';
    const { h: height } = nodeSize(p, { caption: Boolean(caption) });

    el.className = `node node-${node.kind}${PINNED_KINDS.has(node.kind) ? ' pinned' : ''}`;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.width = `${NODE_W}px`;
    el.style.height = `${height}px`;

    // Header — rebuilt only when its inputs changed (icon markup is trusted or
    // the fixed user glyph; the title is always textContent).
    const head = headOf(el);
    const hd = headerOf(node);
    const sig = `${hd.cls}|${hd.title}|${hd.icon}`;
    if (head.dataset.sig !== sig) {
      head.dataset.sig = sig;
      head.className = `nhead ${hd.cls}`;
      const icon = svgEl(doc, 'svg');
      icon.setAttribute('viewBox', hd.viewBox);
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.innerHTML = hd.icon;
      head.replaceChildren(icon, h(doc, 'span', 'tt', hd.title));
    }

    // OR's out type is resolved from wiring, never stored (spec §4 ⟨f⟩).
    const orType = node.kind === 'or' ? resolveOrOutType(node, ctx.template, portsFn) : null;

    const body = bodyOf(el);
    const kids = [];
    const firstZoneIsOutputs = metaIns.length === 0 && p.outputs.length > 0;
    if (firstZoneIsOutputs) {
      for (const out of p.outputs) kids.push(portRow(node, out, 'out', node.kind === 'or' ? (orType || 'any') : null));
    } else {
      for (const inp of metaIns) kids.push(portRow(node, inp, 'in'));
    }
    kids.push(h(doc, 'div', 'psep'));
    if (!firstZoneIsOutputs) {
      for (const out of p.outputs) kids.push(portRow(node, out, 'out', node.kind === 'or' ? (orType || 'any') : null));
    }
    if (awaitPort) {
      kids.push(h(doc, 'div', 'psep'));
      kids.push(gateRow(node, ctx.wiredInputs.has(`${node.id}.await`)));
    }
    if (caption) {
      // The caption brings its OWN separator only when both port zones are
      // non-empty — mirrors nodeSize, so the painted rows always sum to `height`.
      if (metaIns.length > 0 && p.outputs.length > 0) kids.push(h(doc, 'div', 'psep'));
      kids.push(captionRow(caption));
    }
    body.replaceChildren(...kids);
  }

  function renderNodes(ctx) {
    const seen = new Set();
    for (const node of ctx.template.nodes) {
      seen.add(node.id);
      let el = nodeEls.get(node.id);
      if (!el) {
        el = buildCard(node);
        nodeEls.set(node.id, el);
        world.appendChild(el);
      }
      paintCard(el, node, ctx);
    }
    for (const [id, el] of [...nodeEls]) {
      if (seen.has(id)) continue;
      el.remove();
      nodeEls.delete(id);
    }
  }

  /** Cubic midpoint (t = 0.5) with bezierPath's own control points, so a badge
   *  always sits ON its wire. Kept local: geometry exports the path, not the
   *  sample, and this is the only consumer. */
  function wireMid(a, b, loop) {
    const dx = Math.max(48, Math.min(160, Math.abs(b.x - a.x) * 0.45));
    const bow = loop ? 56 + Math.abs(a.y - b.y) * 0.2 : 0;
    const c1 = { x: a.x + dx, y: a.y + bow };
    const c2 = { x: b.x - dx, y: b.y + bow };
    const at = (p0, p1, p2, p3) => (p0 + 3 * p1 + 3 * p2 + p3) / 8;
    return { x: at(a.x, c1.x, c2.x, b.x), y: at(a.y, c1.y, c2.y, b.y) };
  }

  function renderWires(ctx) {
    const seenWires = new Set();
    const seenBadges = new Set();
    for (const wire of ctx.template.wires) {
      const from = ctx.byId.get(wire.from && wire.from.node);
      const to = ctx.byId.get(wire.to && wire.to.node);
      if (!from || !to) continue;   // dangling endpoints paint nothing, never NaN
      const a = portAnchor(from, portsFn(from) || { inputs: [], outputs: [] }, wire.from.port, 'out');
      const b = portAnchor(to, portsFn(to) || { inputs: [], outputs: [] }, wire.to.port, 'in');
      const loop = ctx.loopWires.has(wire.id);
      seenWires.add(wire.id);

      let path = wireEls.get(wire.id);
      if (!path) {
        path = svgEl(doc, 'path', 'wire');
        path.dataset.wireId = wire.id;
        wireEls.set(wire.id, path);
        wiresEl.appendChild(path);
      }
      path.setAttribute('class', `wire${loop ? ' loop' : ''}`);
      path.setAttribute('d', bezierPath(a, b, { loop }));

      const budget = wire.config && wire.config.maxCycles;
      if (Number.isInteger(budget)) {
        seenBadges.add(wire.id);
        let badge = badgeEls.get(wire.id);
        if (!badge) {
          badge = h(doc, 'div', 'wbadge');
          badge.dataset.wireId = wire.id;
          badgeEls.set(wire.id, badge);
          world.appendChild(badge);
        }
        const mid = wireMid(a, b, loop);
        badge.style.left = `${mid.x}px`;
        badge.style.top = `${mid.y}px`;
        badge.textContent = `≤${budget}`;
      }
    }
    for (const [id, el] of [...wireEls]) {
      if (seenWires.has(id)) continue;
      el.remove();
      wireEls.delete(id);
    }
    for (const [id, el] of [...badgeEls]) {
      if (seenBadges.has(id)) continue;
      el.remove();
      badgeEls.delete(id);
    }
  }

  function applyDecor(state) {
    const sel = state.selection || null;
    for (const [id, el] of nodeEls) {
      el.classList.toggle('sel', Boolean(sel && sel.kind === 'node' && sel.id === id));
    }
    for (const [id, el] of wireEls) {
      el.classList.toggle('sel', Boolean(sel && sel.kind === 'wire' && sel.id === id));
    }

    const report = state.report || { errors: [], warnings: [] };
    const byNode = new Map();
    const badWires = new Set();
    for (const e of report.errors || []) {
      if (e.nodeId && !byNode.has(e.nodeId)) byNode.set(e.nodeId, e.msg);
      if (e.wireId) badWires.add(e.wireId);
      for (const wid of e.wireIds || []) badWires.add(wid);
    }
    for (const [id, el] of nodeEls) {
      const msg = byNode.get(id);
      let pip = el.querySelector(':scope > .npip');
      if (!msg) { if (pip) pip.remove(); continue; }
      if (!pip) { pip = h(doc, 'div', 'npip'); el.appendChild(pip); }
      pip.title = msg;
    }
    for (const [id, el] of wireEls) el.classList.toggle('bad', badWires.has(id));
  }

  function render(template, state = {}) {
    current = template;
    const byId = new Map(template.nodes.map((n) => [n.id, n]));
    const wiredInputs = new Set(
      template.wires
        .filter((w) => w && w.to && byId.has(w.to.node))
        .map((w) => `${w.to.node}.${w.to.port}`),
    );
    const { loopWires } = classifyLoops(template, portsFn);
    const ctx = { template, byId, wiredInputs, loopWires };
    renderNodes(ctx);
    renderWires(ctx);
    applyDecor(state);
    return view;
  }

  function setTransform(next) {
    transform = {
      x: Number(next && next.x) || 0,
      y: Number(next && next.y) || 0,
      zoom: Number(next && next.zoom) || 1,
    };
    world.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`;
    world.classList.toggle('dots-faded', transform.zoom < DOT_FADE_ZOOM);
    return transform;
  }

  const view = {
    el: root,
    world,
    wiresEl,
    render,
    setTransform,
    getTransform: () => ({ ...transform }),
    nodeEl: (id) => nodeEls.get(id) || null,
    wireEl: (id) => wireEls.get(id) || null,
    /** Swap the registry the headers read (the palette arrives after the first
     *  paint when /api/agents is slow). Header signatures are invalidated so the
     *  next render repaints tint, icon and title. */
    setAgents(next) {
      agents = next || {};
      for (const el of nodeEls.values()) {
        const head = headOf(el);
        if (head) delete head.dataset.sig;
      }
    },
    template: () => current,
    destroy() { host.replaceChildren(); nodeEls.clear(); wireEls.clear(); badgeEls.clear(); },
  };
  setTransform(transform);
  return view;
}

export { PORT_SEP };
