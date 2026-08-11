// ui/public/graph/run-decor.mjs
//
// Run monitor v2 (spec §7). The run view renders the SAME graph as the composer
// — graph-view.mjs, driven by the run's `pipelines.stepper` manifest — and this
// module is everything that sits on top of it: the exec ledger folded into node
// statuses, the per-node executions footer, loop badges, the gate pip, ants on
// the active execution's trigger wires and the End result chip.
//
// The split mirrors graph-model/graph-view: everything here is a pure reader of
// the manifest + the run's event ledger, EXCEPT `decorate()`, which is the one
// DOM pass. graph-view owns no run state and binds no handlers, so decorate()
// runs AFTER every `view.render()` — paintCard rewrites `className`/`height`
// wholesale, and the decor has to land again on top.
//
// Genericity charter: nothing here keys off an agent key or a phase name. Row
// labels read the manifest's port metadata (`loop: true`), statuses read the
// exec ledger, colours read the manifest node.

import { NODE_W, nodeSize } from './graph-geometry.mjs';
import { AWAIT_PORT, CAPTION_KINDS } from './graph-model.mjs';

/** The run-level warning a run that drained without binding End carries (orchestrator.mjs:148). */
export const QUIESCENCE_WARNING = 'finished at quiescence — End not reached';

/** Composite (kind:'task') rows label from the task title; keep the card readable. */
const TITLE_MAX = 40;

/** Squares in a sub-agent fan strip before the count alone carries the tail. */
const SUB_SQUARE_CAP = 24;

/** Node statuses this module can produce (spec §7 states). */
const STATUSES = ['pending', 'active', 'done', 'paused', 'stopped', 'error', 'skipped'];
const STATUS_CLASSES = STATUSES.map((s) => `is-${s}`);

/** Run statuses that mean "nothing is running any more". */
const TERMINAL_RUN = new Set(['done', 'stopped', 'error', 'paused']);

// ---------------------------------------------------------------------------
// Formatters — the run-card vocabulary, single-sourced so the node header, the
// execution rows and the card totals cannot drift apart.
// ---------------------------------------------------------------------------

/** `4s` / `2m 10s` / `1h 1m`. */
export function fmtDur(ms) {
  const s = Math.max(0, Math.round(Number(ms) || 0) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** `$0.42`, with a `<$0.01` floor so a real-but-tiny spend never reads as free. */
export function fmtUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0.00';
  if (v > 0 && v < 0.01) return '<$0.01';
  return `$${v.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Manifest readers — v2 `{version:2, graph:{nodes,wires}}` (workflows.mjs:567),
// degrading to the v1 `{steps:[{nodes:[…]}]}` shape frozen history still holds.
// ---------------------------------------------------------------------------

export function isGraphManifest(stepper) {
  return !!(stepper && stepper.version === 2 && stepper.graph && Array.isArray(stepper.graph.nodes));
}

/** Every node in the manifest, in declaration order (v1 cells flattened). */
export function manifestNodes(stepper) {
  if (isGraphManifest(stepper)) return stepper.graph.nodes.filter(Boolean);
  const cells = stepper && Array.isArray(stepper.steps) ? stepper.steps : [];
  return cells.flatMap((cell) => (cell && Array.isArray(cell.nodes) ? cell.nodes.filter(Boolean) : []));
}

/** Every wire in the manifest (v1 manifests have none). */
export function manifestWires(stepper) {
  return isGraphManifest(stepper) && Array.isArray(stepper.graph.wires)
    ? stepper.graph.wires.filter(Boolean)
    : [];
}

const nodeById = (stepper, id) => manifestNodes(stepper).find((n) => n.id === id) || null;

/**
 * The node's "model · effort" caption, from the manifest's resolved context.
 * A node with neither inherits the global default -> "default" (per-field
 * "default" when only one is set). Flow cards run no model -> ''.
 */
export function nodeModelLine(node) {
  if (!node || node.kind !== 'agent') return '';
  const model = node.model || '';
  const effort = node.effort || '';
  if (!model && !effort) return 'default';
  return `${model || 'default'} · ${effort || 'default'}`;
}

/** The manifest node's palette colour, '' for flow cards and unknown ids. */
export function nodeColor(stepper, nodeId) {
  const node = nodeById(stepper, nodeId);
  return (node && node.color) || '';
}

/**
 * The manifest projected back into the template shape graph-view renders.
 * Budgets travel in `wire.config.maxCycles` because that is where the shared
 * renderer reads them for the `≤N` badge.
 */
export function manifestTemplate(stepper) {
  return {
    nodes: manifestNodes(stepper).map((n) => ({
      id: n.id, kind: n.kind, key: n.key || undefined, x: Number(n.x) || 0, y: Number(n.y) || 0, config: {},
    })),
    wires: manifestWires(stepper).map((w) => ({
      id: w.id,
      from: { node: w.from?.node, port: w.from?.port },
      to: { node: w.to?.node, port: w.to?.port },
      config: w.maxCycles != null ? { maxCycles: Number(w.maxCycles) } : {},
    })),
  };
}

/**
 * A portsFn over the manifest's frozen port lists. The manifest projection drops
 * `synthetic` (workflows.mjs:535), so re-mark the engine-reserved `await` input —
 * graph-view keys the gate row and the geometry off that flag alone.
 */
export function manifestPortsFn(stepper) {
  const byId = new Map(manifestNodes(stepper).map((n) => [n.id, n]));
  return (node) => {
    const m = byId.get(node && node.id);
    if (!m || !m.ports) return { inputs: [], outputs: [] };
    return {
      inputs: (m.ports.inputs || []).map((p) => (p.id === AWAIT_PORT.id ? { ...p, synthetic: true } : { ...p })),
      outputs: (m.ports.outputs || []).map((p) => ({ ...p })),
    };
  };
}

/**
 * The `agents` palette graph-view draws headers from, with the RUN's resolved
 * label/colour winning over the live palette (a run renders the agents it ran
 * with, even after the sidecar is renamed). `palette` = key -> mergePalette entry.
 */
export function manifestAgents(stepper, palette = {}) {
  const out = { ...palette };
  for (const n of manifestNodes(stepper)) {
    if (n.kind !== 'agent' || !n.key) continue;
    const base = palette[n.key] || {};
    out[n.key] = { ...base, displayName: n.label || base.displayName || n.key, color: n.color || base.color || 'blue' };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Exec ledger
// ---------------------------------------------------------------------------

const execsOf = (decor) => (decor && Array.isArray(decor.executions) ? decor.executions.filter(Boolean) : []);

const stepIndex = (decor) => {
  const map = new Map();
  for (const s of (decor && Array.isArray(decor.steps) ? decor.steps : [])) {
    if (!s) continue;
    const key = s.executionId || s.key;
    if (key != null) map.set(key, s);
  }
  return map;
};

/** A step row's active ms, extended by the live clock while it is running. */
function stepMs(step, now, live) {
  if (!step) return 0;
  const base = Number(step.activeMs) || 0;
  if (!live || !step.runningSince) return base;
  return base + Math.max(0, (now || Date.now()) - new Date(step.runningSince).getTime());
}

/** Executions grouped by node, in arrival order. */
function byNode(decor) {
  const map = new Map();
  for (const e of execsOf(decor)) {
    if (e.nodeId == null) continue;
    if (!map.has(e.nodeId)) map.set(e.nodeId, []);
    map.get(e.nodeId).push(e);
  }
  return map;
}

/**
 * nodeId -> status for EVERY manifest node. Precedence: the step row (only it
 * knows a pause — the scheduler completes a paused execution as `done`), then
 * error, then the in-flight set, then the last execution, then pending. End is
 * special-cased ONCE: a resolved run that never bound it renders `skipped`.
 */
export function nodeStatusMap(stepper, decor) {
  const grouped = byNode(decor);
  const steps = stepIndex(decor);
  const active = new Set((decor && Array.isArray(decor.active) ? decor.active : []).map((a) => a && a.nodeId));
  const resolved = !decor.live || TERMINAL_RUN.has(decor.runStatus);
  const out = {};
  for (const node of manifestNodes(stepper)) {
    out[node.id] = statusOf(node, grouped.get(node.id) || [], { active, steps, decor, resolved });
  }
  return out;
}

function statusOf(node, list, { active, steps, decor, resolved }) {
  if (!list.length) {
    // Amendment f: a run that drained at quiescence never bound End — say so
    // rather than leaving the sink looking merely un-reached.
    if (node.kind === 'end' && resolved && decor.endReached === false) return 'skipped';
    return 'pending';
  }
  const last = list[list.length - 1];
  const step = steps.get(last.executionId);
  // Only the step row knows a pause: the scheduler completes a paused execution
  // as `done` (orchestrator.mjs:2017), so exec alone would read it as finished.
  if (step && (step.status === 'paused' || step.status === 'stopped')) return step.status;
  if (list.some((e) => e.status === 'error')) return 'error';
  if (active.has(node.id)) return 'active';
  if (last.status === 'done') return 'done';
  // Started, not in flight, no terminal transition: still running on a live run,
  // and on a resolved one it is where the run stopped.
  return resolved ? 'stopped' : 'active';
}

/**
 * The execution row label (genericity charter): `cycle <ordinal>`, plus
 * ` · <inputPortId>` when the fresh binding that triggered it landed on a
 * `loop: true` input. `await` is never `loop: true`, so a pure-await re-fire
 * labels plainly. Composite (`kind:'task'`) rows carry the task title instead.
 */
function labelFor(node, entry) {
  if (entry.kind === 'task') return truncate(String(entry.title || '').trim() || `cycle ${entry.ordinal}`);
  const base = `cycle ${entry.ordinal}`;
  const loopIns = new Set((node?.ports?.inputs || []).filter((p) => p.loop).map((p) => p.id));
  const port = (entry.trigger?.freshPorts || []).find((p) => loopIns.has(p));
  return port ? `${base} · ${port}` : base;
}

function truncate(s) {
  return s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX - 1)}…` : s;
}

/**
 * nodeId -> ordered execution rows. `flow` rows are the engine's own instant
 * $0 executions (task/end/and/or/combine): they get no cost pill at all rather
 * than a misleading `$0.00`.
 */
export function executionRows(stepper, decor) {
  const grouped = byNode(decor);
  const steps = stepIndex(decor);
  const out = {};
  for (const node of manifestNodes(stepper)) {
    const list = grouped.get(node.id) || [];
    if (!list.length) continue;
    out[node.id] = list.map((entry) => {
      const step = steps.get(entry.executionId);
      const flow = node.kind !== 'agent';
      const ms = stepMs(step, decor.now, decor.live !== false);
      const costUsd = flow ? 0 : Number(entry.costUsd) || 0;
      const label = labelFor(node, entry);
      // A flow execution is instant and free — it gets no cost pill at all,
      // rather than a misleading `$0.00`. An AGENT execution that cost nothing
      // (a mock run) still says `$0.00`: it ran, and that is the truth.
      const right = [step ? fmtDur(ms) : null, flow ? null : fmtUsd(costUsd)].filter(Boolean);
      return {
        executionId: entry.executionId,
        nodeId: node.id,
        ordinal: entry.ordinal,
        status: entry.status,
        flow,
        hasStep: !!step,
        ms,
        costUsd,
        label,
        text: [label, ...right].join(' · '),
      };
    });
  }
  return out;
}

/** The collapsed footer summary: `3 runs · $1.12` (cost omitted when there is none). */
export function stripText(rows, fmt = fmtUsd) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  const total = list.reduce((a, r) => a + (Number(r.costUsd) || 0), 0);
  const runs = `${list.length} ${list.length === 1 ? 'run' : 'runs'}`;
  return total > 0 ? `${runs} · ${fmt(total)}` : runs;
}

/**
 * wireId -> how many times that loop wire delivered, counted off the executions
 * it triggered. In an OR-fanned template the loop wires are the ones INTO the
 * valve, so the badges land there and `or.out -> fix` stays a plain grey wire.
 */
export function loopBadgeCounts(stepper, decor) {
  const loopWires = new Set(manifestWires(stepper).filter((w) => w.loop).map((w) => w.id));
  const out = {};
  for (const e of execsOf(decor)) {
    for (const id of e.trigger?.wireIds || []) {
      if (loopWires.has(id)) out[id] = (out[id] || 0) + 1;
    }
  }
  return out;
}

/**
 * Wires that march: the trigger wires of the in-flight executions. Nothing
 * marches on a finished run, and a post-End drain publish routes nowhere, so a
 * recorded-not-routed token can never light an edge.
 */
export function antWireIds(decor) {
  const out = new Set();
  if (!decor || decor.live === false) return out;
  const byId = new Map(execsOf(decor).map((e) => [e.executionId, e]));
  for (const a of Array.isArray(decor.active) ? decor.active : []) {
    for (const id of byId.get(a && a.executionId)?.trigger?.wireIds || []) out.add(id);
  }
  return out;
}

/**
 * The node holding a gate ask. The ask carries only `wireId`
 * (orchestrator.mjs:1966) — the gate holds at the SOURCE's publish, so the pip
 * belongs on the wire's `from` node.
 */
export function gateNodeId(stepper, wireId) {
  if (!wireId) return null;
  const wire = manifestWires(stepper).find((w) => w.id === wireId);
  return wire?.from?.node || null;
}

/**
 * The End card's result chip: the bound payload's basename when it carries a
 * path, else the void "completed" treatment. null until End binds.
 */
export function endResult(decor) {
  if (!decor || !decor.endReached || !decor.result) return null;
  const end = execsOf(decor).find((e) => e.result !== undefined);
  const path = decor.result.path || null;
  return {
    nodeId: end ? end.nodeId : null,
    path,
    text: path ? String(path).split('/').filter(Boolean).pop() : '— completed',
  };
}

/** Run-level warnings for the header banner (Amendment f's quiescence case). */
export function runWarnings(decor) {
  return (decor && Array.isArray(decor.warnings) ? decor.warnings : []).filter(Boolean);
}

/**
 * Frozen v1 runs have no graph — render their manifest as a flat chip strip
 * (spec §7's legacy row). Statuses/cost/duration come from the step rows, which
 * v1 keyed by nodeId exactly as v2 does.
 */
export function legacyChipRows(stepper, { steps = [] } = {}) {
  const acc = new Map();
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s || s.nodeId == null) continue;
    const cur = acc.get(s.nodeId) || { ms: 0, cost: 0, status: 'pending' };
    cur.ms += Number(s.activeMs) || 0;
    cur.cost += Number(s.costUsd) || 0;
    cur.status = s.status === 'start' ? 'active' : (s.status || 'pending');
    acc.set(s.nodeId, cur);
  }
  return manifestNodes(stepper).map((n) => {
    const hit = acc.get(n.id);
    const label = n.label || n.id;
    const parts = hit ? [label, fmtDur(hit.ms), hit.cost > 0 ? fmtUsd(hit.cost) : null] : [label];
    return {
      id: n.id,
      label,
      color: n.color || '',
      status: hit ? hit.status : 'pending',
      text: parts.filter(Boolean).join(' · '),
    };
  });
}

/** The sub-agent square strip for a run card: one square per sub, `.on` while running. */
export function subFanHtml(subs) {
  const list = Array.isArray(subs) ? subs : [];
  if (!list.length) return '';
  const squares = list
    .slice(0, SUB_SQUARE_CAP)
    .map((s) => `<i class="sq${s && s.status === 'running' ? ' on' : ''}"></i>`)
    .join('');
  return `<div class="fan">${squares}<span class="fl">×${list.length}</span></div>`;
}

// ---------------------------------------------------------------------------
// The DOM pass
// ---------------------------------------------------------------------------

const el = (doc, tag, cls, text) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * Lay the run decor over an already-rendered graph-view. Idempotent and
 * self-clearing: every decorated element is removed and rebuilt, so a repaint
 * after the run settles cannot strand an ant, a badge or a gate pip.
 *
 * `decor` = { live, runStatus, active[], executions[], steps[], endReached,
 *             result, warnings[], gateWireId, expanded[], subsOf?, now }.
 */
export function decorate(view, stepper, decor) {
  const doc = view.el.ownerDocument;
  const statuses = nodeStatusMap(stepper, decor);
  const rowsByNode = executionRows(stepper, decor);
  const expanded = new Set(decor.expanded || []);
  const ports = manifestPortsFn(stepper);
  const gateNode = gateNodeId(stepper, decor.gateWireId);
  const result = endResult(decor);

  for (const node of manifestNodes(stepper)) {
    const card = view.nodeEl(node.id);
    if (!card) continue;
    card.classList.remove(...STATUS_CLASSES);
    card.classList.add(`is-${statuses[node.id]}`);
    // The active glow reads as "who is running": --c is the node's own palette
    // token (style.css :root), empty for flow cards, which fall back in CSS.
    card.style.setProperty('--c', node.color ? `var(--${node.color})` : '');

    for (const stale of card.querySelectorAll(':scope > .ngate, :scope > .xfoot, :scope > .xresult, :scope > .fan')) stale.remove();

    // model · effort has no row of its own on the shared card (its geometry is
    // fixed by the port lists), so it rides the header as a tooltip.
    const head = card.querySelector(':scope > .nhead');
    const modelLine = nodeModelLine(node);
    if (head) head.title = modelLine ? `${node.label || node.id} — ${modelLine}` : '';

    if (node.id === gateNode) {
      const pip = el(doc, 'div', 'ngate', '?');
      pip.dataset.wireId = decor.gateWireId;
      pip.title = 'waiting on a loop gate — open the question panel';
      card.appendChild(pip);
    }

    if (result && result.nodeId === node.id) card.appendChild(resultRow(doc, result));

    const fanHtml = typeof decor.subsOf === 'function' ? subFanHtml(decor.subsOf(node.id)) : '';
    const rows = rowsByNode[node.id] || [];
    const open = expanded.has(node.id);
    if (fanHtml || rows.length) card.appendChild(footer(doc, node, rows, open, fanHtml));

    // graph-view sized the card without a footer (it has no run state); re-size
    // for what we just added so expand/collapse actually moves the card.
    const footerRows = (fanHtml ? 1 : 0) + (rows.length ? (open ? rows.length + 1 : 1) : 0);
    if (footerRows) {
      const { h } = nodeSize(ports(node), { footerRows, caption: CAPTION_KINDS.has(node.kind) });
      card.style.height = `${h}px`;
    }

    paintHeaderTotals(doc, card, rows);
  }

  const ants = antWireIds(decor);
  for (const w of manifestWires(stepper)) {
    const path = view.wireEl(w.id);
    if (path) path.classList.toggle('wire-live', ants.has(w.id));
  }

  for (const stale of view.world.querySelectorAll('.wfired')) stale.remove();
  const fired = loopBadgeCounts(stepper, decor);
  for (const [wireId, count] of Object.entries(fired)) {
    const badge = view.world.querySelector(`.wbadge[data-wire-id="${wireId}"]`);
    if (badge) badge.appendChild(el(doc, 'span', 'wfired', `${count}×`));
  }
}

function resultRow(doc, result) {
  const row = el(doc, 'div', 'xresult');
  if (!result.path) {
    row.textContent = result.text;
    return row;
  }
  const link = el(doc, 'a', null, result.text);
  link.href = '#';
  link.dataset.path = result.path;
  link.title = result.path;
  row.appendChild(link);
  return row;
}

function footer(doc, node, rows, open, fanHtml) {
  const foot = el(doc, 'div', 'xfoot');
  foot.dataset.nodeId = node.id;
  foot.style.width = `${NODE_W}px`;
  if (fanHtml) foot.insertAdjacentHTML('beforeend', fanHtml);
  if (!rows.length) return foot;

  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'xtoggle';
  toggle.dataset.nodeId = node.id;
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  const squares = el(doc, 'span', 'xsq');
  for (const r of rows) squares.appendChild(el(doc, 'i', `xq is-${r.status === 'start' ? 'active' : r.status}`));
  toggle.append(squares, el(doc, 'span', 'xsum', stripText(rows)), chevron(doc));
  foot.appendChild(toggle);

  const list = el(doc, 'div', 'xrows');
  if (!open) list.hidden = true;
  else {
    for (const r of rows) {
      const row = el(doc, 'div', `xrow is-${r.status === 'start' ? 'active' : r.status}`);
      row.dataset.executionId = r.executionId;
      row.dataset.nodeId = r.nodeId;
      const right = r.text.slice(r.label.length).replace(/^ · /, '');
      row.append(el(doc, 'i', 'led'), el(doc, 'span', 'xl', r.label), el(doc, 'span', 'xr', right));
      list.appendChild(row);
    }
  }
  foot.appendChild(list);
  return foot;
}

function chevron(doc) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'chev');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.innerHTML = '<path d="M6 9l6 6 6-6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
  return svg;
}

/** Node header duration · cost = the sum over that node's executions. */
function paintHeaderTotals(doc, card, rows) {
  let run = card.querySelector(':scope > .nrun');
  if (!rows.length) {
    if (run) run.remove();
    return;
  }
  if (!run) {
    run = el(doc, 'div', 'nrun');
    run.append(el(doc, 'span', 'dur'), el(doc, 'span', 'cost'));
    card.appendChild(run);
  }
  // Blank means "never ran". A node that ran shows its real figures, including
  // a truthful 0s / $0.00 — so the two states stay distinguishable.
  const ms = rows.reduce((a, r) => a + (Number(r.ms) || 0), 0);
  const cost = rows.reduce((a, r) => a + (Number(r.costUsd) || 0), 0);
  run.querySelector('.dur').textContent = rows.some((r) => r.hasStep) ? fmtDur(ms) : '';
  run.querySelector('.cost').textContent = rows.some((r) => !r.flow) ? fmtUsd(cost) : '';
}
