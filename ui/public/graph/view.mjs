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
  ZOOM_MIN, ZOOM_MAX, ZOOM_K, LABEL_H,
  injectGeometry, nodeSize, portAnchor, graphBounds, fitBounds,
} from '../../../src/shared/graph/geometry.mjs';
import { flowLayout, FLOW_DEFAULT_WIDTH } from '../../../src/shared/graph/flow-layout.mjs';
import { wireCurve, ghostCurve } from '../../../src/shared/graph/curves.mjs';
import { portsOf, resolveOrOutType, findPort } from '../../../src/shared/graph/ports.mjs';
import { CANVAS_WARNING_CODES } from '../../../src/shared/graph/validate.mjs';
import { classifyLoops } from '../../../src/shared/graph/loops.mjs';
import { thumbnailSvg } from '../../../src/shared/graph/thumbnail.mjs';
import { sanitizeIcon } from '../../../src/shared/graph/manifest.mjs';
import { KEYED_KINDS, DEFAULT_MAX_CYCLES } from '../../../src/shared/graph/constants.mjs';
import { AWAY_GLYPH } from '../away-glyph.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const FANOUT_GLYPH = '⤫';
/** px a press must travel before it becomes a PAN rather than a click. The run
 *  canvas delegates row/gate/result clicks off the same stage, so the threshold
 *  is what keeps a shaky click from stealing them. */
export const DRAG_PX = 4;

/** ms after the last transform write / card move before the stage loses `gv-moving` (style.css drops the
 *  cards' backdrop blur while it is set: without a GPU the blur was 70–85% of every pan/zoom frame). */
export const MOVING_SETTLE_MS = 160;

/** Per-mode zoom clamps (§7.6). `edit` uses the geometry defaults. */
export const MODE_ZOOM = {
  edit: { min: ZOOM_MIN, max: ZOOM_MAX },
  monitor: { min: 0.3, max: ZOOM_MAX },
  static: { min: 0.3, max: 1 },
};

/** The caption footer (CAP_H, paintFoot) each captioned kind closes with. */
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

// Builtin icons are repo-shipped SVG fragments (trusted, injected raw). EVERY
// other origin is DATA someone else wrote: a user agent's meta is writable
// through POST /api/agents, and a plugin agent's rides in on a sidecar a
// marketplace plugin ships (no code-execution consent, SHA-only updates). Both
// land in an SVG innerHTML below, in an origin with no CSP and no auth on the
// API — so both go through the SHARED allowlist, and an icon the allowlist
// rejects whole is replaced by this neutral glyph.
//
// The gate used to be `origin === 'user'` — a one-value DENYLIST that let every
// plugin icon through raw (C-2). Sanitizing rather than blanking is not a
// relaxation: the run monitor already renders these same icons through
// sanitizeIcon (manifest.mjs), so this is what makes the two canvases agree.
export const USER_AGENT_ICON = '<circle cx="12" cy="12" r="3.4"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"></path>';
export function safeAgentIcon(meta) {
  const raw = String((meta && meta.icon) || '');
  if (!raw || (meta && meta.origin === 'builtin')) return raw;
  return sanitizeIcon(raw) || USER_AGENT_ICON;
}

// The ƒ glyph lives with the icon set (one source for the page's tile and this canvas).
import { SCRIPT_GLYPH } from '../../../src/shared/graph/script-icons.mjs';
export { SCRIPT_GLYPH };

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
  scale = 1,             // geometry multiplier (A1): every --gv-* length × scale, fonts floor at 9px in CSS
  layout = 'auto',       // 'auto' = the template's x/y (today) · 'flow' = rows in dispatch order (flow-layout.mjs)
  band = null,           // (node) => {model, effort, flags:[{text, cls?, title?}]} | null — the chip band under agent heads
  order = null,          // flow only: agent ids in dispatch order (a host may pass the proposal's `order[]`)
  describe = mode === 'edit', // the agent/script description footer (edit hosts; run cards keep their run footer)
  modelLabel = null,          // (modelId) => display label for the label row's meta ('' hides it)
  onTransform = null,         // called after EVERY transform write (the composer re-tiles its dot grid off it)
} = {}) {
  const win = doc.defaultView || globalThis;
  const clamps = MODE_ZOOM[mode] || MODE_ZOOM.edit;
  const zMin = zoomMin == null ? clamps.min : zoomMin;
  const zMax = zoomMax == null ? clamps.max : zoomMax;
  const schedule = raf || ((fn) => (win.requestAnimationFrame ? win.requestAnimationFrame(fn) : setTimeout(fn, 16)));
  let agents = agentsIn || {};
  const S = Number(scale) > 0 ? Number(scale) : 1;
  const isFlow = layout === 'flow';
  const hasBand = typeof band === 'function';
  let bandOverride = null;          // Map(nodeId -> band data) set by setBands(); wins over band(node)
  let source = null;                // the caller's template (flow re-lays it out on every render; never mutated)
  let flowLay = null;               // last flowLayout() result (flow only)
  let flowWidth = 0;                // last known host width (flow only; 0 => FLOW_DEFAULT_WIDTH)

  const stage = doc.createElement('div');
  stage.className = `gv-stage gv-${mode}${isFlow ? ' gv-flow' : ''}`;
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
  // Never replaceChildren(host): `.gv-chip` (the refusal chip) is the stage's
  // SIBLING inside the same canvas host and must survive a (re)mount.
  host.prepend(stage);
  injectGeometry(stage, S);
  const geo = { band: hasBand, scale: S, describe };

  const nodeEls = new Map();      // nodeId  -> card element
  const wireEls = new Map();      // wireId  -> path element
  const badgeEls = new Map();     // wireId  -> .wbadge element
  const incident = new Map();     // nodeId  -> Set(wireId)
  const dCache = new Map();       // wireId  -> last written `d`
  const footers = new Map();      // nodeId  -> footer LINES (Σ bandUnits, what nodeSize bills)
  const navs = [];                // nav controllers created by createNav()
  let T = { x: 0, y: 0, z: 1 };
  let current = null;             // last rendered template
  let ctx = null;                 // last render context (ports, loops, wired inputs)
  let curves = new Map();         // wireId -> {d, pts, mid, swoop} (curves.mjs)
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
  const sizeOf = (node) => nodeSize(node, portsAt(node), { footerRows: footers.get(node.id) || 0, ...geo });

  // ------------------------------------------------------------ wire curves
  // Every repaint derives the wire shapes from the same model x/y the cards are
  // placed by (still zero measurement). A wire may pass behind cards; only a
  // same-row backward wire swoops under them (curves.mjs).
  const isNodeObj = (n) => Boolean(n) && typeof n === 'object' && !Array.isArray(n);
  const rectOf = (node) => ({ x: Number(node.x) || 0, y: Number(node.y) || 0, ...sizeOf(node) });

  /** The SOURCE port's type tints the wire (an OR forwards its resolved type). */
  function typeOf(w) {
    const node = ctx.byId.get(w.from.node);
    if (!node) return 'any';
    const t = node.kind === 'or'
      ? resolveOrOutType(current, portsFn, node.id, new Set())
      : (findPort(portsAt(node), w.from.port, 'out') || {}).type;
    return t === 'md' || t === 'json' || t === 'void' ? t : 'any';
  }

  /** Recompute every wire's curve (cheap: no search). paintWire writes only the d strings that changed. */
  function reroute() {
    if (!ctx || !current) return;
    const nodes = current.nodes.filter(isNodeObj);
    // The pill and the swoop floor keep off each card's LABEL ROW too (mockup rectOf: y − LABEL_H … bottom);
    // from/to stay the bare boxes (crossRows reads their bottoms only).
    const rects = nodes.map((n) => { const r = rectOf(n); return { ...r, y: r.y - LABEL_H * S, h: r.h + LABEL_H * S }; });
    const next = new Map();
    for (const w of current.wires) {
      if (!w || !w.from || !w.to) continue;
      const fromN = ctx.byId.get(w.from.node);
      const toN = ctx.byId.get(w.to.node);
      const a = anchorOf(w.from, 'out');
      const b = anchorOf(w.to, 'in');
      if (!fromN || !toN || !a || !b) continue;
      // A flow host clips at its left edge (overflow:hidden): a row-wrap S must not leave it (xMin).
      next.set(w.id, wireCurve(a, b, { from: rectOf(fromN), to: rectOf(toN), rects, self: fromN === toN, scale: S, xMin: isFlow ? 1 : -Infinity }));
    }
    curves = next;
  }

  /** D15: canonical full re-curve + repaint (drag cancel, footer line change). */
  function rerouteAll() {
    reroute();
    for (const id of wireEls.keys()) paintWire(id);
  }

  /** The label row ABOVE the card: family tile + title + quiet meta (agent: its model; script: its runtime). */
  function labelOf(node) {
    if (KEYED_KINDS.includes(node.kind)) {
      const meta = agents[node.key] || null;                // the MERGED key -> meta index (agents + scripts)
      const script = node.kind === 'script';
      const model = !script && !hasBand && node.config && node.config.model
        ? String((modelLabel && modelLabel(node.config.model)) || node.config.model) : '';
      return {
        fam: (meta && meta.color) || (script ? 'amber' : 'blue'),
        title: (meta && meta.displayName) || node.key || node.id,
        icon: safeAgentIcon(meta) || (script ? SCRIPT_GLYPH : ''),
        viewBox: AGENT_VIEWBOX,
        meta: script ? ((meta && meta.runtime) || 'script') : model,
        mono: script,
        desc: meta ? String(meta.description || '') : String(node.key || ''),
        descMono: !meta,
      };
    }
    const flow = FLOW_META[node.kind] || { title: node.kind, icon: '' };
    return { fam: 'flow', title: flow.title, icon: flow.icon, viewBox: FLOW_VIEWBOX, meta: '', mono: false, desc: '', descMono: false };
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
    const kids = [];
    // Zones top->bottom, each emitted only when non-empty, a 9px separator only
    // BETWEEN emitted zones — this is exactly what nodeSize counts.
    const zone = (rows) => { if (kids.length) kids.push(h('div', 'psep')); kids.push(...rows); };
    // The await gate is the LAST input row; the caption is a footer now (paintFoot), never a row.
    if (metaIns.length || gate) zone([...metaIns.map((q) => portRow(q, 'in')), ...(gate ? [gateRow(awaitWired)] : [])]);
    if (p.outputs.length) zone(p.outputs.map((q) => portRow(q, 'out', node.kind === 'or' ? (orType || 'any') : null)));
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
      // Squares wrap inside .fsq (a fixed --gv-fan-w column, FAN_PER_ROW per
      // line) so they never shrink; `.f2` is the two-line height the model bills.
      const fan = h('div', `fan${(band.lines || 1) > 1 ? ' f2' : ''}`);
      const sq = h('span', 'fsq');
      for (const led of band.leds || []) sq.appendChild(h('i', `sq${led === 'run' ? ' on' : ''}`));
      fan.append(sq, h('span', 'fl', `×${band.count}`));
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
      const row = h('div', execRowClass(band));
      row.dataset.executionId = band.executionId || '';
      row.dataset.nodeId = nodeId;
      row.append(h('i', 'led'), h('span', 'xl', band.label || ''), h('span', 'xr', band.right || ''));
      return row;
    }
    if (band.kind === 'away') {
      // Away mode spend under the execution it answered: glyph · label · cost. Not clickable.
      const row = h('div', `xaway is-${band.variant === 'stopped' ? 'stopped' : 'booked'}`);
      row.dataset.executionId = band.executionId || '';
      row.title = band.title || '';
      const ico = h('span', 'xaway-ico');
      ico.innerHTML = AWAY_GLYPH;                  // a repo-shipped literal, never run data
      row.append(ico, h('span', 'xl', band.label || ''), h('span', 'xr', band.right || ''));
      return row;
    }
    if (band.kind === 'live') {
      const l = h('div', 'xlive mono');
      l.textContent = band.text || '';
      l.title = band.text || '';
      return l;
    }
    const res = h('div', 'xresult');           // kind: 'result'
    if (!band.path) { res.textContent = band.text || ''; return res; }
    const a = h('a', null, band.text || '');
    // draggable=false: Chrome drags an <a href> natively, which pointercancels a
    // pan that started on it (D16). The click stays delegated to run-hosts.
    a.href = '#'; a.draggable = false; a.dataset.path = band.path; a.title = band.path;
    res.appendChild(a);
    return res;
  }

  /** The identity of a band ACROSS repaints. `exec` is keyed by its execution,
   *  `away` by its execution AND variant (one execution can carry a booked and a
   *  stopped band), the singletons by their kind — so the strip's <button>
   *  survives every decor generation (MAJ-20). */
  const bandKey = (band) => (band.kind === 'exec' ? `exec|${band.executionId || ''}`
    : band.kind === 'away' ? `away|${band.executionId || ''}|${band.variant === 'stopped' ? 'stopped' : 'booked'}` : band.kind);

  /** `.stack` = dur · cost on its own line, `.l2` = two clamped label lines —
   *  the layout the band's own `units` billed (run-decor execBandLayout). */
  const execRowClass = (band) => `xrow is-${band.led || 'pending'}${band.stack ? ' stack' : ''}${band.l2 ? ' l2' : ''}`;

  /** Footer LINES a band occupies — what nodeSize bills as footerRows. */
  const bandUnits = (band) => (band.kind === 'fan' ? (band.lines || 1) : band.kind === 'exec' ? (band.units || 1) : 1);

  /** Update an EXISTING band element in place. Returns false when the element's
   *  shape cannot express the new band (a different led count on a fan, a result
   *  gaining or losing its link) and the caller must rebuild it. Nothing here is
   *  focusable except the strip's own <button>, which is only ever written to —
   *  never replaced. */
  function syncBand(el, band) {
    if (band.kind === 'fan') {
      const leds = band.leds || [];
      const cur = el.querySelectorAll(':scope > .fsq > .sq');
      if (cur.length !== leds.length) return false;
      leds.forEach((led, i) => { const c = `sq${led === 'run' ? ' on' : ''}`; if (cur[i].className !== c) cur[i].className = c; });
      const cls = `fan${(band.lines || 1) > 1 ? ' f2' : ''}`;
      if (el.className !== cls) el.className = cls;
      const fl = el.querySelector(':scope > .fl');
      const txt = `×${band.count}`;
      if (fl && fl.textContent !== txt) fl.textContent = txt;
      return true;
    }
    if (band.kind === 'strip') {
      const exp = band.expanded ? 'true' : 'false';
      if (el.getAttribute('aria-expanded') !== exp) el.setAttribute('aria-expanded', exp);
      const sq = el.querySelector(':scope > .xsq');
      const leds = band.leds || [];
      const cur = sq.querySelectorAll(':scope > .xq');
      if (cur.length !== leds.length) sq.replaceChildren(...leds.map((led) => h('i', `xq is-${led}`)));
      else leds.forEach((led, i) => { const c = `xq is-${led}`; if (cur[i].className !== c) cur[i].className = c; });
      const sum = el.querySelector(':scope > .xsum');
      const t = band.summary || '';
      if (sum && sum.textContent !== t) sum.textContent = t;
      return true;
    }
    if (band.kind === 'live') { if (el.textContent !== band.text) { el.textContent = band.text || ''; el.title = band.text || ''; } return true; }
    if (band.kind === 'away') {
      // Before the `result` arm, which would blank an away band.
      const l = el.querySelector(':scope > .xl');
      const r = el.querySelector(':scope > .xr');
      if (!l || !r) return false;
      const lt = band.label || '';
      const rt = band.right || '';
      if (l.textContent !== lt) l.textContent = lt;
      if (r.textContent !== rt) r.textContent = rt;
      if (el.title !== (band.title || '')) el.title = band.title || '';
      return true;
    }
    if (band.kind === 'exec') {
      const cls = execRowClass(band);
      if (el.className !== cls) el.className = cls;
      const l = el.querySelector(':scope > .xl');
      const r = el.querySelector(':scope > .xr');
      const lt = band.label || '';
      const rt = band.right || '';
      if (l && l.textContent !== lt) l.textContent = lt;
      if (r && r.textContent !== rt) r.textContent = rt;
      return true;
    }
    const a = el.querySelector(':scope > a');            // kind: 'result'
    if (Boolean(band.path) !== Boolean(a)) return false;
    const txt = band.text || '';
    if (!a) { if (el.textContent !== txt) el.textContent = txt; return true; }
    if (a.textContent !== txt) a.textContent = txt;
    if (a.dataset.path !== band.path) { a.dataset.path = band.path; a.title = band.path; }
    return true;
  }

  const bandDataOf = (node) => (bandOverride && bandOverride.has(node.id) ? bandOverride.get(node.id) : (hasBand ? band(node) : null));
  // Separated: an unseparated join lets {model:'Opus', effort:'5'} and {model:'Opus5', effort:''}
  // share a signature, and paintBand early-returns on an equal one — stale chips after setBands.
  const bandSig = (b) => (b ? [b.model || '', b.effort || '', b.pick ? 'pick' : '', ...(b.flags || []).map((f) => `${f.text}|${f.cls || ''}`)].join('\u0001') : '');
  /** The chip band: model · effort · flags, one BAND_H×s row between .nlabel and .nbody (agents only).
   *  `pick` (the chat card's proposed state, P3) makes the model/effort chips real buttons the host's delegated
   *  click opens a picker for; flags stay inert. Listeners never live here: replaceChildren would drop them. */
  function paintBand(el, node) {
    let nb = el.querySelector(':scope > .nband');
    if (!hasBand || node.kind !== 'agent') { if (nb) nb.remove(); return; }
    const data = bandDataOf(node) || { model: '', effort: '', flags: [] };
    const sig = bandSig(data);
    if (nb && nb.dataset.sig === sig) return;
    if (!nb) { nb = h('div', 'nband'); el.insertBefore(nb, el.querySelector(':scope > .nbody')); }
    nb.dataset.sig = sig;
    const pick = !!data.pick;
    const chip = (cls, text, which, title) => {
      const c = h(pick ? 'button' : 'span', cls, text);
      c.title = title;
      if (pick) { c.type = 'button'; c.dataset.chip = which; c.setAttribute('aria-haspopup', 'menu'); c.setAttribute('aria-expanded', 'false'); }
      return c;
    };
    const kids = [chip(`bchip model${data.model ? '' : ' is-unset'}`, data.model || 'default', 'model', data.model ? `model: ${data.model}` : 'model: the CLI default')];
    if (data.effort || pick) kids.push(chip('bchip effort', data.effort || 'effort', 'effort', data.effort ? `effort: ${data.effort}` : 'effort: pick one'));
    for (const f of data.flags || []) { const c = h('span', `bchip flag${f.cls ? ` ${f.cls}` : ''}`, f.text); c.title = f.title || f.text; kids.push(c); }
    nb.replaceChildren(...kids);
  }

  function paintLabel(el, node) {
    const lab = el.querySelector(':scope > .nlabel');
    const l = labelOf(node);
    const sig = `${l.fam}|${l.title}|${l.icon}|${l.meta}`;
    if (lab.dataset.sig === sig) return;
    lab.dataset.sig = sig;
    const tile = h('span', `ltile h-${l.fam}`);
    const icon = svgEl('svg');
    icon.setAttribute('viewBox', l.viewBox);
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.innerHTML = l.icon;
    tile.appendChild(icon);
    const tt = h('span', 'tt', l.title);
    tt.title = l.title;                                   // an ellipsised name keeps its tooltip
    const kids = [tile, tt];
    if (l.meta) kids.push(h('span', l.mono ? 'lm mono' : 'lm', l.meta));
    const run = lab.querySelector(':scope > .nrun');      // a run's dur · cost (setNodeChrome) survives a repaint
    lab.replaceChildren(...kids, ...(run ? [run] : []));
  }

  /** The footer under the port rows: the description (describe hosts, agent/script) or the caption. */
  function paintFoot(el, node) {
    const l = labelOf(node);
    const desc = describe && KEYED_KINDS.includes(node.kind);
    const text = desc ? l.desc : (CAPTIONS[node.kind] || '');
    let f = el.querySelector(':scope > .ncap');
    if (!desc && !text) { if (f) f.remove(); return; }
    const cls = desc ? `ncap desc${l.descMono ? ' mono' : ''}` : 'ncap';
    if (!f) { f = h('div', cls); el.insertBefore(f, el.querySelector(':scope > .xfoot')); }
    if (f.className !== cls) { f.className = cls; f.replaceChildren(); }
    // A description clamps to two lines INSIDE a span (mockup .cv-foot>span): clamped on the padded box, a third line showed cut.
    const t = desc ? (f.firstElementChild || f.appendChild(h('span'))) : f;
    if (t.textContent !== text) { t.textContent = text; f.title = text; }
  }

  /** A badge is FILLED once its port is wired (a class toggle; rows are never rebuilt for it). */
  function paintWired(el, node) {
    for (const row of el.querySelectorAll(':scope > .nbody > .prow[data-port]')) {
      const key = `${node.id}.${row.dataset.port}`;
      const on = row.dataset.dir === 'in' ? ctx.wiredInputs.has(key) : ctx.wiredOutputs.has(key);
      if (row.classList.contains('wired') !== on) row.classList.toggle('wired', on);
    }
  }

  function paintCard(el, node) {
    const p = portsAt(node);
    const orType = node.kind === 'or' ? resolveOrOutType(current, portsFn, node.id, new Set()) : null;
    const awaitWired = ctx.wiredInputs.has(`${node.id}.await`);
    // Never rewrite className wholesale: `sel`, `is-*` and `bad` are owned by the fast paths.
    if (el.dataset.kind !== node.kind) {
      for (const c of [...el.classList]) if (c.startsWith('node-')) el.classList.remove(c);
      el.classList.add('node', `node-${node.kind}`);
      el.dataset.kind = node.kind;
    }
    const box = sizeOf(node);
    el.style.width = `${box.w}px`;                 // inline width beats the CSS var (a scaled host)
    el.style.height = `${box.h}px`;
    paintLabel(el, node);
    paintBand(el, node);
    paintBody(el, node, p, orType, awaitWired);
    paintFoot(el, node);
    paintWired(el, node);
    placeCard(node);
  }

  function buildCard(node) {
    const el = h('div', `node node-${node.kind}`);
    el.dataset.nodeId = node.id;
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', `${node.kind} ${node.key || node.id}`);
    el.append(h('div', 'nlabel'), h('div', 'nbody'));
    return el;
  }

  const anchorOf = (end, dir) => {
    const node = ctx.byId.get(end.node);
    return node ? portAnchor(node, portsAt(node), end.port, dir, geo) : null;
  };

  /** Writes `d` only when the cached string differs — the whole point of the cache. */
  function paintWire(wireId) {
    const path = wireEls.get(wireId);
    if (!path) return;
    const c = curves.get(wireId);
    if (!c) return;                             // dangling endpoint paints nothing, never NaN
    if (dCache.get(wireId) !== c.d) {
      dCache.set(wireId, c.d);
      path.setAttribute('d', c.d);
      stats.wireDUpdates += 1;
    }
    const badge = badgeEls.get(wireId);
    if (badge) {
      badge.style.left = `${c.mid.x}px`;
      badge.style.top = `${c.mid.y}px`;
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
    reroute();                                  // canonical full pass (D15): every render routes from scratch
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
      path.setAttribute('class', `wire w-${typeOf(w)}${loop ? ' loop' : ''}`);
      const explicit = Number.isInteger(w.config && w.config.maxCycles);
      if (loop || explicit) {
        // EVERY loop wire carries its "≤N" pill (default N = 3), on every host (D4). A wire with an explicit
        // budget keeps its pill too, as before (run fixtures hang the N× delivery count on such a wire).
        seenB.add(w.id);
        const budget = explicit ? w.config.maxCycles : DEFAULT_MAX_CYCLES;
        let badge = badgeEls.get(w.id);
        if (!badge) {
          badge = h('div', 'wbadge');
          badge.dataset.wireId = w.id;
          badge.appendChild(h('span', 'wmax'));
          badgeEls.set(w.id, badge);
          world.appendChild(badge);
        }
        const max = badge.querySelector(':scope > .wmax');
        if (max.textContent !== `≤${budget}`) max.textContent = `≤${budget}`;
        badge.setAttribute('aria-label', `Loop wire, at most ${budget} cycles`);
      }
      dCache.delete(w.id);                      // geometry may have moved: force one write
      paintWire(w.id);
    }
    for (const [id, el] of [...wireEls]) if (!seenW.has(id)) { el.remove(); wireEls.delete(id); dCache.delete(id); }
    for (const [id, el] of [...badgeEls]) if (!seenB.has(id)) { el.remove(); badgeEls.delete(id); }
  }

  function setPip(el, id, cls, msg) {
    let pip = el.querySelector(`:scope > .${cls}`);
    if (!msg) { if (pip) pip.remove(); return; }
    if (!pip) { pip = h('div', cls); pip.dataset.nodeId = id; el.appendChild(pip); }
    pip.title = msg;
  }
  /** Validation pips: red for the node's first error, amber for its first surfaced warning (D15, only
   *  where there is no error); `bad` on wires an error names. */
  function applyReport(report) {
    const errBy = new Map();
    const warnBy = new Map();
    const badWires = new Set();
    for (const e of (report && report.errors) || []) {
      if (e.nodeId && !errBy.has(e.nodeId)) errBy.set(e.nodeId, e.message || e.code);
      if (e.wireId) badWires.add(e.wireId);
    }
    for (const w of (report && report.warnings) || []) {
      if (!CANVAS_WARNING_CODES.includes(w.code)) continue;
      // V19 names only a wire ({wireId}): its pip goes on the wire's TARGET card (D15).
      const wire = !w.nodeId && w.wireId ? current.wires.find((x) => x && x.id === w.wireId) : null;
      const id = w.nodeId || (wire && wire.to ? wire.to.node : null);
      if (id && !warnBy.has(id)) warnBy.set(id, w.message || w.code);
    }
    for (const [id, el] of nodeEls) {
      setPip(el, id, 'npip', errBy.get(id));
      setPip(el, id, 'nwarn', errBy.has(id) ? null : warnBy.get(id));
    }
    for (const [id, el] of wireEls) el.classList.toggle('bad', badWires.has(id));
  }

  /** flow: lay the caller's template out in rows and return a POSITIONED COPY (never mutate the caller's). */
  function layoutFlow(template) {
    flowLay = flowLayout(template, portsFn, { width: flowWidth || FLOW_DEFAULT_WIDTH, scale: S, band: hasBand, agentOrder: order });
    stage.style.height = `${flowLay.height}px`;
    return { ...template, nodes: template.nodes.map((n) => (isNodeObj(n) && flowLay.positions[n.id] ? { ...n, ...flowLay.positions[n.id] } : n)) };
  }

  function render(template, state = {}) {
    source = template;
    current = isFlow ? layoutFlow(template) : template;
    // ALL FOUR ctx fields read `current`: in flow mode `template` still carries the caller's x/y.
    ctx = {
      byId: new Map(current.nodes.map((n) => [n.id, n])),
      wireById: new Map(current.wires.map((w) => [w.id, w])),
      wiredInputs: new Set(current.wires.filter((w) => w && w.to).map((w) => `${w.to.node}.${w.to.port}`)),
      wiredOutputs: new Set(current.wires.filter((w) => w && w.from).map((w) => `${w.from.node}.${w.from.port}`)),
      loopWireIds: classifyLoops(current, portsFn).loopWireIds,
    };
    renderNodes();
    renderWires();
    view.setSelection(state.selection || null);
    applyReport(state.report || null);
    // (No decor here: run-decor.mjs's applyDecor(view, decor) — P6 — is the ONE
    // decor pass, run AFTER render through the fast paths below.)
    return view;
  }

  /** The canvas is moving: the frosted cards render unblurred until MOVING_SETTLE_MS after the last write. */
  let movingTimer = null;
  function markMoving() {
    stage.classList.add('gv-moving');
    if (movingTimer) win.clearTimeout(movingTimer);
    movingTimer = win.setTimeout(() => { movingTimer = null; stage.classList.remove('gv-moving'); }, MOVING_SETTLE_MS);
  }

  function setTransform(next) {
    T = { x: Number(next && next.x) || 0, y: Number(next && next.y) || 0, z: Number(next && next.z) || T.z || 1 };
    markMoving();
    world.style.transform = `translate(${T.x}px, ${T.y}px) scale(${T.z})`;
    if (onTransform) { try { onTransform({ ...T }); } catch { /* a host repaint never breaks a pan */ } }
    return { ...T };
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** MODEL bounds (no DOM measure): the shared `graphBounds` over the rendered
   *  template, with this view's footer rows (only the view knows them), UNIONED
   *  with the routed wire vertices — a backward detour or a lane offset leaves
   *  the card union, and a fit must never clip it (D9). `ids` narrows it to those
   *  cards alone (the glance's Live view frames the running steps, not the wires). */
  function bounds(pad = 0, ids = null) {
    if (!current || !current.nodes.length) return null;
    if (Array.isArray(ids)) {
      const only = new Set(ids);
      const nodes = current.nodes.filter((n) => n && only.has(n.id));
      return graphBounds({ ...current, nodes }, portsAt, { pad, footerRowsOf: (n) => footers.get(n.id) || 0, ...geo });
    }
    const base = graphBounds(current, portsAt, { pad: 0, footerRowsOf: (n) => footers.get(n.id) || 0, ...geo });
    if (!base) return null;
    let x0 = base.x; let y0 = base.y; let x1 = base.x + base.w; let y1 = base.y + base.h;
    for (const c of curves.values()) {
      for (const p of c.pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      y1 = Math.max(y1, c.mid.y + 12);                 // a swoop's pill hangs below its lowest point
    }
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
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
    stage, world, wiresEl, ghostEl: ghost, mode, stats, schedule,
    zoomMin: zMin, zoomMax: zMax,
    render,
    setTransform,
    getTransform: () => ({ ...T }),
    nodeEl: (id) => nodeEls.get(id) || null,
    wireEl: (id) => wireEls.get(id) || null,
    template: () => current,
    ports: (node) => portsAt(node),
    size: (node) => sizeOf(node),
    anchor: (node, portId, dir) => portAnchor(node, portsAt(node), portId, dir, geo),
    layout,
    /** flow: re-lay out for a host width (px) and repaint; returns the layout (null outside flow mode). */
    relayout(width) {
      if (!isFlow || !source) return flowLay;
      flowWidth = Math.max(0, Number(width) || 0);
      render(source, {});
      setTransform({ x: 0, y: 0, z: 1 });
      return flowLay;
    },
    flowLayout: () => flowLay,
    /** Replace the band data for some nodes (the tunables table drives this); geometry never moves. */
    setBands(map) {
      bandOverride = map ? new Map(Object.entries(map)) : null;
      for (const [id, el] of nodeEls) { const node = ctx && ctx.byId.get(id); if (node) paintBand(el, node); }
    },
    incidentOf: (nodeId) => incident.get(nodeId) || new Set(),
    isLoopWire: (wireId) => Boolean(ctx && ctx.loopWireIds.has(wireId)),
    setSelection(sel) {
      for (const [id, el] of nodeEls) el.classList.toggle('sel', Boolean(sel && sel.kind === 'node' && sel.id === id));
      for (const [id, el] of wireEls) el.classList.toggle('sel', Boolean(sel && sel.kind === 'wire' && sel.id === id));
      for (const [id, el] of badgeEls) el.classList.toggle('sel', Boolean(sel && sel.kind === 'wire' && sel.id === id));
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
    /** Reconcile the executions footer to `bands` (the run monitor's vocabulary,
     *  see the Interfaces block) and RE-SIZE the card from the footer LINE count
     *  (Σ bandUnits — a wrapped fan or stacked exec row bills every line). Anchors
     *  are top-relative, so no wire re-routes (D8) — only height, hit box and fit
     *  bounds change. The ONE place a run-mode card height is written.
     *
     *  REUSE, never rebuild (MAJ-20): applyDecor calls this for every node on
     *  every decor generation, and the strip is a real <button> — the run
     *  monitor's only interactive footer control. Rebuilding it moved a keyboard
     *  user's focus to <body> (so the strip could not be expanded by keyboard at
     *  all on a live run) and swallowed any click whose down/up straddled a
     *  repaint. A dataset.sig diff is not enough: an expanded node's exec rows
     *  carry a live duration, so its footer changes on every tick and would
     *  rebuild anyway. Elements are therefore keyed by bandKey() and written in
     *  place; only a band that vanished is removed. */
    setFooter(nodeId, bands) {
      const node = ctx && ctx.byId.get(nodeId);
      const el = nodeEls.get(nodeId);
      if (!node || !el) return;
      const prevLines = footers.get(nodeId) || 0;
      const list = Array.isArray(bands) ? bands.filter(Boolean) : [];
      const feet = el.querySelectorAll(':scope > .xfoot');
      let foot = feet[0] || null;
      for (const stale of feet) if (stale !== foot) stale.remove();   // a card owns ONE footer
      if (!list.length) {
        if (foot) foot.remove();
        footers.delete(nodeId);
        el.style.height = `${sizeOf(node).h}px`;
        if ((footers.get(nodeId) || 0) !== prevLines) rerouteAll();   // a changed card height re-curves (D16: a swoop floor, a pill)
        return;
      }
      if (!foot) {
        foot = h('div', 'xfoot');
        foot.dataset.nodeId = nodeId;
        el.appendChild(foot);
      }
      // Index what is already there; a duplicate key cannot be reused twice.
      const have = new Map();
      for (const kid of [...foot.children]) {
        const k = kid.dataset.bandKey;
        if (k && !have.has(k)) have.set(k, kid); else kid.remove();
      }
      let i = 0;
      for (const band of list) {
        const key = bandKey(band);
        let kid = have.get(key) || null;
        if (kid) {
          have.delete(key);
          if (!syncBand(kid, band)) {
            const next = bandEl(nodeId, band);
            next.dataset.bandKey = key;
            kid.replaceWith(next);
            kid = next;
          }
        } else {
          kid = bandEl(nodeId, band);
          kid.dataset.bandKey = key;
        }
        // Only ever moves when the band ORDER changed; the steady state (and an
        // expand, which appends) leaves every element exactly where it is.
        if (foot.children[i] !== kid) foot.insertBefore(kid, foot.children[i] || null);
        i += 1;
      }
      for (const gone of have.values()) gone.remove();
      footers.set(nodeId, list.reduce((a, band) => a + bandUnits(band), 0));
      el.style.height = `${sizeOf(node).h}px`;
      if ((footers.get(nodeId) || 0) !== prevLines) rerouteAll();     // a changed card height re-curves (D16: a swoop floor, a pill)
    },
    /** Per-card ornaments: agent colour, gate pip, header duration · cost (and the
     *  Away mode chip when `totals.away.text` is set — the share is inside `cost`). */
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
      const lab = el.querySelector(':scope > .nlabel');
      let run = lab.querySelector(':scope > .nrun');
      if (!totals) { if (run) run.remove(); return; }
      if (!run) { run = h('span', 'nrun'); run.append(h('span', 'dur'), h('span', 'cost')); lab.appendChild(run); }
      run.querySelector('.dur').textContent = totals.dur || '';
      run.querySelector('.cost').textContent = totals.cost || '';
      const awayText = (totals.away && totals.away.text) || '';
      let away = run.querySelector(':scope > .away');
      if (!awayText) { if (away) away.remove(); return; }
      if (!away) { away = h('span', 'away'); run.appendChild(away); }
      if (away.textContent !== awayText) away.textContent = awayText;
      away.title = totals.away.title || 'Away mode';
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
    /** Ants march per path (the :root clock is retired — it forced a whole-
     *  document style recalc per frame). A wire GOING live starts its own
     *  animation, so it is seated at the shared document-timeline phase with a
     *  negative delay: every live wire marches in step, and because one
     *  iteration is exactly one 12px dash period the seat itself is seamless.
     *  600 = the .6s period style.css declares on `animation:wireDash`.
     *  Steady-state calls must NOT rewrite the stamp: re-stamping a RUNNING
     *  animation re-maps its time against the ORIGINAL start and desyncs the
     *  phase — so the stamp is written only on the off→on edge, and it leaves
     *  with the class. render() wipes wire classes wholesale (the
     *  setAttribute('class', …) repaint), so a remounted wire re-enters
     *  through was=false and gets a fresh, phase-exact seat; a stale inline
     *  delay on a dark wire is inert (no animation without the class).
     *  jsdom: no document.timeline -> t=0 -> a zero stamp. */
    setWireLive(ids) {
      const live = new Set(ids || []);
      for (const [id, el] of wireEls) {
        const was = el.classList.contains('wire-live');
        const on = live.has(id);
        el.classList.toggle('wire-live', on);
        if (on && !was) {
          const t = Number(doc.timeline && doc.timeline.currentTime) || 0;
          el.style.animationDelay = `-${t % 600}ms`;
        } else if (!on && was) {
          el.style.removeProperty('animation-delay');
        }
      }
    },
    /** One transform write per dragged node, then a full re-curve (O(wires), no search): a card
     *  can set a swoop's floor, so moving it may change wires it is not wired to. The dCache gate
     *  keeps the DOM writes to the wires whose curve actually moved. */
    moveNode(nodeId) {
      const node = ctx && ctx.byId.get(nodeId);
      if (!node) return;
      markMoving();
      placeCard(node); rerouteAll();
    },
    /** D15: the canonical full pass every gesture must END in. */
    rerouteAll,
    /** The EXACT painted polyline for a wire (null while dangling): the curve's samples. The hit
     *  test and the tests consume this, so paint and hit can never diverge. */
    wireRoute(wireId) { const c = curves.get(wireId); return c ? c.pts : null; },
    curveOf: (wireId) => curves.get(wireId) || null,
    /** The ghost `d` of the composer's wiring drag (curves.mjs; `mirror`: the drag started on an input). */
    routeGhost(anchor, end, { mirror = false } = {}) { return ghostCurve(anchor, end, { mirror, scale: S }); },
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
    /** Auto-fit from MODEL bounds into the band left of the floating inspector and above `insetBottom` px of
     *  floating chrome at the bottom (the Workflows chat dock: fitBounds centres inside (0, 0, w, h), so the
     *  graph lands in the band ABOVE it). Fit NEVER magnifies past 1x; the user zoom range stays zoomMin..zoomMax.
     *  Runs on view entry/re-entry and template load — and when a chat edit lands out of sight (chat-cards reveal). */
    fit({ insetRight = 0, insetBottom = 0, pad = 60 } = {}) {
      const r = view.readRect();
      const b = bounds(pad);
      if (!b) return;
      applyFit(b, Math.max(1, (r.width || 0) - insetRight), Math.max(1, (r.height || 0) - insetBottom), 1);   // never past 1×
    },
    /** Static hosts: fit the graph into a card of width `w` (ResizeObserver-driven). */
    fitToWidth(w) {
      if (isFlow) return view.relayout(w);
      const r = view.readRect();
      const b = bounds(60);
      if (!b) return;
      const vw = Math.max(1, w || r.width || 0);
      const f = fitBounds(b, { width: vw, height: Number.MAX_SAFE_INTEGER }, { zoomMin: zMin, zoomMax: 1 });   // width decides z
      setTransform({ x: f.tx, y: (Math.max(1, r.height || 0) - b.h * f.z) / 2 - b.y * f.z, z: f.z });
    },
    /** Wheel zoom + (Task 2) left-drag pan for `monitor` hosts. `static` gets
     *  nothing; `edit` binds its own richer pipeline in composer.mjs and does NOT
     *  call this. POLICY (2026-09-10): a modifier-less wheel is the PAGE's — this
     *  canvas never traps a scroll — and ⌘/ctrl+wheel zooms about the cursor.
     *  The trackpad pinch arrives as ctrl+wheel on macOS, Windows and Linux alike.
     *  `onTransform` fires after every transform the NAV writes (the host repaints
     *  its zoom buttons off it); a programmatic setTransform/fit never calls it. */
    createNav({ onTransform = null } = {}) {
      if (mode === 'static') return { destroy() {} };
      const emit = () => { if (onTransform) onTransform({ ...T }); };
      const onWheel = (ev) => {
        if (!(ev.ctrlKey || ev.metaKey)) return;         // the page keeps its scroll
        ev.preventDefault();
        readRect();                                      // the page may have scrolled since the last fit
        const m = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? (R.height || 560) : 1;
        zoomAbout(T.z * Math.exp(-ev.deltaY * m * ZOOM_K), ev.clientX - R.left, ev.clientY - R.top);
        emit();
      };
      // ---- left-drag pan ---------------------------------------------------
      // The press is NOT preventDefault'ed: the run host delegates .xrow /
      // .xtoggle / .ngate / .xresult clicks off this very stage, so a press that
      // never crosses DRAG_PX has to stay a click. Past the threshold the gesture
      // is a pan, and the click the browser fires at the end of it is swallowed.
      let drag = null;
      let swallowT = 0;
      function swallow(ev) { ev.stopPropagation(); ev.preventDefault(); disarm(); }
      function disarm() {
        doc.removeEventListener('click', swallow, true);
        if (swallowT) { win.clearTimeout(swallowT); swallowT = 0; }
      }
      function armSwallow() {
        disarm();
        doc.addEventListener('click', swallow, true);
        swallowT = win.setTimeout(disarm, 0);
      }
      function settle() {
        if (!drag) return;
        setTransform({ x: drag.ox + (drag.px - drag.sx), y: drag.oy + (drag.py - drag.sy), z: T.z });
        emit();
      }
      function pump() {
        if (!drag || drag.pending) return;
        drag.pending = true;
        schedule(() => { if (drag) { drag.pending = false; settle(); } });
      }
      /** Drop the gesture WITHOUT settling. Chrome reports pointercancel at
       *  client (0,0), so settling off it would teleport the graph by the whole
       *  press offset — and leave untouched() false, killing the auto re-fit.
       *  The last rAF settle already left the pan where the user saw it. */
      function onCancel() { endDrag(); }
      function endDrag() {
        if (!drag) return;
        const id = drag.id;
        drag = null;                                   // FIRST: releasePointerCapture below
        stage.classList.remove('panning');             // can re-enter through lostpointercapture
        doc.removeEventListener('pointermove', onMove);
        doc.removeEventListener('pointerup', onEnd);
        doc.removeEventListener('pointercancel', onCancel);
        stage.removeEventListener('lostpointercapture', onCancel);
        win.removeEventListener('blur', onCancel);
        try { if (stage.hasPointerCapture?.(id)) stage.releasePointerCapture(id); } catch { /* already gone */ }
      }
      function onDown(ev) {
        if (drag || ev.button !== 0) return;
        if (ev.pointerType && ev.pointerType !== 'mouse') return;
        readRect();
        drag = { id: ev.pointerId, sx: ev.clientX, sy: ev.clientY, px: ev.clientX, py: ev.clientY,
          ox: T.x, oy: T.y, moved: false, pending: false };
        doc.addEventListener('pointermove', onMove);
        doc.addEventListener('pointerup', onEnd);
        doc.addEventListener('pointercancel', onCancel);
        stage.addEventListener('lostpointercapture', onCancel);
        win.addEventListener('blur', onCancel);
      }
      function onMove(ev) {
        if (!drag || ev.pointerId !== drag.id) return;
        if (!ev.buttons) { endDrag(); return; }          // a release this document never saw
        drag.px = ev.clientX; drag.py = ev.clientY;
        if (!drag.moved) {
          if (Math.abs(drag.px - drag.sx) < DRAG_PX && Math.abs(drag.py - drag.sy) < DRAG_PX) return;
          drag.moved = true;
          drag.ox = T.x; drag.oy = T.y;                  // a re-fit may have landed since the press
          stage.classList.add('panning');
          try { stage.setPointerCapture?.(drag.id); } catch { /* synthetic pointer */ }
        }
        ev.preventDefault();
        pump();
      }
      function onEnd(ev) {
        if (!drag || (ev.pointerId != null && ev.pointerId !== drag.id)) return;
        const moved = drag.moved;
        if (moved) { drag.px = ev.clientX; drag.py = ev.clientY; settle(); }
        endDrag();
        if (moved) armSwallow();
      }
      readRect();
      stage.addEventListener('wheel', onWheel, { passive: false });
      stage.addEventListener('pointerdown', onDown);
      const nav = {
        destroy() {
          stage.removeEventListener('wheel', onWheel);
          stage.removeEventListener('pointerdown', onDown);
          endDrag();
          disarm();
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
        const lab = el.querySelector(':scope > .nlabel'); if (lab) delete lab.dataset.sig;
      }
      if (current) render(source || current, {});
    },
    destroy() {
      for (const n of navs.splice(0)) n.destroy();
      if (movingTimer) { win.clearTimeout(movingTimer); movingTimer = null; }
      stage.remove();
      nodeEls.clear(); wireEls.clear(); badgeEls.clear(); incident.clear(); dCache.clear(); footers.clear(); curves.clear();
      current = null; ctx = null;
      source = null; flowLay = null; bandOverride = null;
    },
  };
  // Internals the later tasks' fast paths close over.
  view._internals = { incident, dCache, footers };
  setTransform(T);
  return view;
}

/** Saved-pipeline preview markup. Numbers only — no DOM, no measure. */
export function thumbnailFor(template, portsFn, { width = 240, height = 96 } = {}) {
  if (!template || !Array.isArray(template.nodes) || !template.nodes.length) return '';
  return thumbnailSvg(template, portsFn, { width, height });
}

/** A non-interactive graph for a fixed-width card (saved rows, Running list).
 *  NO listeners: the card's own click handler must keep working, which is why
 *  `.gv-static .node` is pointer-events:none in style.css. */
export function mountStaticGraph(host, template, {
  doc = globalThis.document, portsFn, agents = {}, width = 0, viewport = null,
  scale = 1, layout = 'auto', band = null, order = null, onLayout = null,
} = {}) {
  const view = createGraphView(host, { doc, mode: 'static', portsFn, agents, viewport, scale, layout, band, order });
  view.render(template, {});
  const isFlow = layout === 'flow';
  const widthOf = () => host.clientWidth || width || 0;
  const paint = () => {
    if (!isFlow) { view.fitToWidth(width || host.clientWidth || 0); return; }
    const lay = view.relayout(widthOf());          // 0 → FLOW_DEFAULT_WIDTH inside the view
    host.style.height = `${lay.height}px`;         // the host grows with the rows (min 120)
    if (onLayout) onLayout(lay);
  };
  paint();
  const win = doc.defaultView || globalThis;
  const inner = view.destroy;
  let ro = null;
  if (typeof win.ResizeObserver === 'function') {
    let lastW = host.clientWidth;
    ro = new win.ResizeObserver(() => { const w = host.clientWidth; if (isFlow && w === lastW) return; lastW = w; paint(); });
    ro.observe(host);
  }
  let dead = false;
  view.destroy = () => { if (dead) return; dead = true; if (ro) ro.disconnect(); inner(); if (isFlow) host.style.removeProperty('height'); };
  return view;
}
