// ui/public/graph/run-decor.mjs   (depth 3 below the repo root)
//
// Run monitor v2. ONE pure reducer turns a run's `state` into ONE decor bag, and
// ONE DOM pass (applyDecor, Task 4) lays that bag over the shared graph view.
//
// Genericity charter: nothing here keys off an agent key or a phase name. Row
// labels read the manifest's port metadata (`loop: true`), statuses read the
// execution ledger (state.steps[], one row per execution, key === executionId),
// colours read the manifest node. History renders with the registry absent.
import { manifestPortsFn, manifestTemplate } from '../../../src/shared/graph/manifest.mjs';
import { BOOKEND_EXECUTION_IDS, DEFAULT_MAX_CYCLES } from '../../../src/shared/graph/constants.mjs';

/** The run-level warning a run that drained without binding End carries. */
export const QUIESCENCE_WARNING = 'finished at quiescence — End not reached';

/** Composite (kind:'task') rows label from the task title; keep the card readable. */
const TITLE_MAX = 40;
/** Squares in a sub-agent fan strip before the count alone carries the tail. */
const SUB_SQUARE_CAP = 24;
/** Run statuses that mean "nothing is running any more". */
const TERMINAL_RUN = new Set(['done', 'stopped', 'error', 'paused']);
/** Row statuses that mean "this execution is over". */
const TERMINAL_ROW = new Set(['done', 'error', 'stopped', 'paused']);
/** P8's bookend EXECUTIONS (`x:preflight:1` / `x:done:1`); never executions, never progress. */
const BOOKEND_EXECS = new Set(BOOKEND_EXECUTION_IDS);

// Re-exported so run-hosts has ONE import for the manifest readers.
export { manifestPortsFn, manifestTemplate };

// ── formatters ──────────────────────────────────────────────────────────────

/** `4s` / `2m 10s` / `1h 1m` — integer seconds FIRST, then the same shape as
 *  app.js `fmtDuration`, so a card and the header never spell one duration two ways. */
export function fmtDur(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** `$0.42`, with a `<$0.01` floor so a real-but-tiny spend never reads as free. */
export function fmtUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0.00';
  if (v > 0 && v < 0.01) return '<$0.01';
  return `$${v.toFixed(2)}`;
}

// ── manifest readers ────────────────────────────────────────────────────────

export function isGraphManifest(stepper) {
  return !!(stepper && stepper.version === 2 && stepper.graph && Array.isArray(stepper.graph.nodes));
}
export function manifestNodes(stepper) {
  return isGraphManifest(stepper) ? stepper.graph.nodes.filter(Boolean) : [];
}
export function manifestWires(stepper) {
  return isGraphManifest(stepper) && Array.isArray(stepper.graph.wires) ? stepper.graph.wires.filter(Boolean) : [];
}
/** The header registry the view reads (`agents[node.key]` -> tint, title, icon),
 *  built from the manifest's own agent nodes so History never needs the registry. */
export function manifestAgents(stepper) {
  const out = {};
  for (const n of manifestNodes(stepper)) {
    if (n.kind === 'agent' && n.key && !out[n.key]) out[n.key] = { displayName: n.label || n.key, color: n.color || '', icon: n.icon || '' };
  }
  return out;
}
const nodeById = (stepper, id) => manifestNodes(stepper).find((n) => n.id === id) || null;

// ── the execution ledger (state.steps[]) ────────────────────────────────────

/** Ledger rows in arrival order, bookends dropped. An EXECUTION row ALWAYS
 *  carries `executionId` (=== key; graph/orchestrator `_execStep`). Today's
 *  framework bookends are run-harness `_recordStep('preflight'|'done', 0, …)`
 *  rows — `{ key:'preflight'|'done', phase, cycle:0 }`, NO nodeId, NO
 *  executionId — so the executionId guard drops them; P8's bookend EXECUTIONS
 *  (`x:preflight:1` / `x:done:1`) are dropped by the shared id set. */
export function ledgerRows(st) {
  const out = [];
  for (const s of Array.isArray(st && st.steps) ? st.steps : []) {
    if (!s || !s.executionId) continue;
    if (BOOKEND_EXECS.has(s.executionId)) continue;
    out.push(s);
  }
  return out;
}

/** nodeId -> rows, in arrival order. */
function rowsByNode(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.nodeId == null) continue;
    if (!map.has(r.nodeId)) map.set(r.nodeId, []);
    map.get(r.nodeId).push(r);
  }
  return map;
}

/** A row's active ms, extended by the live clock while it is running. */
export function rowMs(row, now, live) {
  if (!row) return 0;
  const base = Number(row.activeMs) || 0;
  if (!live || !row.runningSince) return base;
  return base + Math.max(0, (now || Date.now()) - new Date(row.runningSince).getTime());
}

/**
 * The status precedence. NOTE the deliberate deviation from spec §8, which
 * checks `active` AFTER the error rule: here membership in `state.active`
 * wins FIRST, so a node whose OLDER execution errored and whose newer one
 * is in flight reads `active` (the error stays visible in that node's
 * footer rows). `rows` are THIS node's ledger
 * rows in arrival order; `ctx.active` is the Set of node ids in state.active
 * (already filtered: an entry whose own row is terminal is dropped by the
 * reducer); `ctx.stepByExec` maps executionId -> row; `ctx.resolved` means
 * nothing runs any more.
 */
export function statusOf(node, rows, ctx) {
  const list = Array.isArray(rows) ? rows : [];
  // 1. in flight. `state.active` is the scheduler's own word and can precede the
  //    node's first row (the parent exec `start` lands before `_execStep`).
  if (ctx.active.has(node.id)) return 'active';
  // 2. never fired. A DONE run means the scheduler drained without ever reaching
  //    this node — including End when endReached === false (quiescence). A
  //    stopped/error run stopped early, so its unreached nodes stay `pending`.
  if (!list.length) return ctx.runStatus === 'done' ? 'skipped' : 'pending';
  const last = list[list.length - 1];
  // 3. only the ledger knows a pause/stop: a paused execution completes as `done`
  //    on the wire, so the exec status alone would read it as finished.
  if (last.status === 'paused' || last.status === 'stopped') return last.status;
  // 4. any error in the node's history sticks.
  if (list.some((r) => r.status === 'error')) return 'error';
  // 5. finished cleanly.
  if (last.status === 'done') return 'done';
  // 6. started, not in flight, no terminal transition.
  return ctx.resolved ? 'stopped' : 'active';
}

// ── the reducer ─────────────────────────────────────────────────────────────

/**
 * ONE decor bag from ONE state snapshot. `st` is the SAME shape live
 * (orchestrator `state` events) and frozen (`rowToState` off pipelines +
 * pipeline_steps), so both surfaces call this with no adapter.
 * @param {object} st                 { stepper, status, steps, active, endReached, result, warnings, wireDeliveries, tokens, gate }
 * @param {{live?:boolean, now?:number, subsOf?:(nodeId:string)=>Array}} opts
 */
export function decorFromState(st, { live = true, now = Date.now(), subsOf = null } = {}) {
  const state = st || {};
  const stepper = state.stepper || null;
  const nodes = manifestNodes(stepper);
  const wires = manifestWires(stepper);
  const runStatus = String(state.status || '').toLowerCase();
  const resolved = !live || TERMINAL_RUN.has(runStatus);
  const rows = ledgerRows(state);
  const grouped = rowsByNode(rows);
  const stepByExec = new Map(rows.map((r) => [r.executionId, r]));
  // A composite (fan-out) PARENT execution has NO ledger row of its own — only its
  // kind:'task' slices do (`parentExecutionId`), and they carry the parent's
  // trigger verbatim. The last slice stands in for the parent.
  const rowFor = (a) => stepByExec.get(a.executionId)
    || (grouped.get(a.nodeId) || []).filter((r) => r.parentExecutionId === a.executionId).pop() || null;
  // `_execStep(ctx,'done')` emits its state snapshot BEFORE the scheduler's own
  // `exec done` drops the execution from `active`, so one frame can name an
  // execution whose OWN row is already terminal. The row wins.
  const activeList = (Array.isArray(state.active) ? state.active : []).filter((a) => {
    if (!a) return false;
    const own = stepByExec.get(a.executionId);
    return !own || !TERMINAL_ROW.has(own.status);
  });
  const activeSet = new Set(activeList.map((a) => a.nodeId));
  const ctx = { active: activeSet, stepByExec, resolved, runStatus };

  const status = {};
  const colors = {};
  for (const node of nodes) {
    status[node.id] = statusOf(node, grouped.get(node.id) || [], ctx);
    colors[node.id] = node.color || '';
  }

  // Progress = done AGENT nodes / AGENT nodes (D15: a number, never a bar).
  const agents = nodes.filter((n) => n.kind === 'agent');
  const progress = { done: agents.filter((n) => status[n.id] === 'done').length, total: agents.length };

  // Active nodes, most recently started FIRST (the compact row and the pill name
  // the newest one; two or more collapse to "N agents running").
  const startedAt = (a) => {
    const r = rowFor(a);
    const t = r && r.startedAt ? Date.parse(r.startedAt) : NaN;
    return Number.isFinite(t) ? t : 0;
  };
  const activeNodes = activeList
    .map((a) => {
      const node = nodeById(stepper, a.nodeId);
      return { nodeId: a.nodeId, executionId: a.executionId || null,
        label: (node && (node.label || node.id)) || a.nodeId, color: (node && node.color) || '', _t: startedAt(a) };
    })
    .sort((x, y) => y._t - x._t)
    .map(({ _t, ...a }) => a);

  const endReached = state.endReached === true;
  const endNode = nodes.find((n) => n.kind === 'end') || null;
  const endResult = endReached && state.result && endNode ? buildEndResult(endNode, state.result) : null;

  const warnings = (Array.isArray(state.warnings) ? state.warnings : []).filter(Boolean);
  // The engine's own definition: `finish('done') && !ended`. A paused, stopped or
  // errored run also has endReached:false, and is NOT quiescence.
  const quiescent = runStatus === 'done' && state.endReached === false;
  if (quiescent && !warnings.includes(QUIESCENCE_WARNING)) warnings.push(QUIESCENCE_WARNING);

  const deliveries = state.wireDeliveries && typeof state.wireDeliveries === 'object' ? state.wireDeliveries : {};
  const loopDeliveries = wires.reduce((a, w) => a + (w.loop ? (Number(deliveries[w.id]) || 0) : 0), 0);

  const decor = {
    version: 2, live, resolved, runStatus, status, colors,
    footers: {}, totals: {}, liveWireIds: [], loopBadges: {}, gate: null,
    endResult, progress, activeNodes, warnings, quiescent,
    executions: rows.length, loopDeliveries,
    nodeIds: nodes.map((n) => n.id), wireIds: wires.map((w) => w.id), expanded: null,
  };
  decorateExecutions(decor, { stepper, nodes, wires, grouped, rows, activeList, rowFor, stepByExec, state, now, live, subsOf });
  return decor;
}

/** End's result chip: basename link for a path, the void treatment otherwise. */
function buildEndResult(endNode, result) {
  const path = result && result.path ? String(result.path) : null;
  const rel = path ? path.split('/').filter(Boolean).pop() : null;
  return { nodeId: endNode.id, path, rel, text: path ? rel : '— completed', kind: path ? 'path' : 'void' };
}

/** `cycle 2 · fix` (loop-port re-fire) / `cycle 2` / the task title for slices. */
export function rowLabel(node, row) {
  if (row.kind === 'task') {
    const t = String(row.title || '').trim();
    return truncate(t || `cycle ${row.ordinal}`);
  }
  const base = `cycle ${row.ordinal}`;
  const loopIns = new Set(((node && node.ports && node.ports.inputs) || []).filter((p) => p && p.loop).map((p) => p.id));
  const port = ((row.trigger && row.trigger.freshPorts) || []).find((p) => loopIns.has(p));
  return port ? `${base} · ${port}` : base;
}

function truncate(s) {
  return s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX - 1)}…` : s;
}

/** Money is CENTS: `0.1 + 0.32 === 0.42000000000000004` in doubles, and the raw
 *  `costUsd` number is part of the frozen bag shape, so it is rounded here once. */
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const sumUsd = (rows) => round2(rows.reduce((a, r) => a + (Number(r.costUsd) || 0), 0));

/** `3 runs · $1.12`; the cost half is dropped when the total is zero. */
export function stripText(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  const total = sumUsd(list);
  const runs = `${list.length} ${list.length === 1 ? 'run' : 'runs'}`;
  return total > 0 ? `${runs} · ${fmtUsd(total)}` : runs;
}

/** The status the 7px leds / row classes use ('start' is the wire's word for active). */
const ledOf = (status) => (status === 'start' ? 'active' : (status || 'pending'));

function decorateExecutions(decor, ctx) {
  const { nodes, wires, grouped, activeList, rowFor, state, now, live, subsOf } = ctx;

  for (const node of nodes) {
    const list = grouped.get(node.id) || [];
    // A FLOW node (task/and/or/combine/end) executes instantly and for free: its
    // rows carry no duration and no cost pill, and its card no header totals.
    const flow = node.kind !== 'agent';
    const rows = list.map((row) => {
      // A flow node executes instantly and for free: the NUMBERS are zeroed with
      // the pill texts, so `durMs`/`costUsd` never contradict `dur`/`cost` (a
      // consumer that sums the numbers must not pick up a flow row's real ms).
      const durMs = flow ? 0 : rowMs(row, now, live);
      const costUsd = flow ? 0 : round2(row.costUsd);
      return {
        executionId: row.executionId, nodeId: node.id,
        kind: row.kind === 'task' ? 'task' : 'cycle',
        ordinal: Number(row.ordinal ?? row.cycle) || 1,
        label: rowLabel(node, row), led: ledOf(row.status),
        dur: !flow && row.activeMs != null ? fmtDur(durMs) : '',
        cost: flow ? '' : fmtUsd(costUsd),
        durMs, costUsd, flow,
      };
    });

    const subs = typeof subsOf === 'function' ? (subsOf(node.id) || []) : [];
    const fan = subs.length
      ? { leds: subs.slice(0, SUB_SQUARE_CAP).map((s) => (s && s.status === 'running' ? 'run' : 'done')), count: subs.length }
      : null;

    if (rows.length || fan) {
      decor.footers[node.id] = { rows, summary: stripText(rows), leds: rows.map((r) => r.led), fan };
    }
    if (rows.length && !flow) {
      const durMs = rows.reduce((a, r) => a + r.durMs, 0);
      const costUsd = sumUsd(rows);
      decor.totals[node.id] = {
        durMs, dur: fmtDur(durMs), costUsd, cost: fmtUsd(costUsd),
        hasStep: rows.some((r) => r.dur !== ''),
      };
    }
  }

  // Ants: the trigger wires of the IN-FLIGHT executions (a composite parent
  // marches on its slices' trigger — the slices carry the parent's verbatim).
  // A resolved run marches nothing: a drain publish after End routes nowhere.
  // Ants are NEVER restricted to loop wires — a re-fire through an OR valve
  // names the valve's out wire; only the badges below are loop-wire-only.
  if (live && !decor.resolved) {
    const ants = new Set();
    for (const a of activeList) {
      const row = rowFor(a);
      for (const id of (row && row.trigger && row.trigger.wireIds) || []) ants.add(id);
    }
    decor.liveWireIds = [...ants];
  }

  // Loop badges from the scheduler's own delivery counters (authoritative;
  // `wireDeliveries` is keyed by LOOP wire ids only and counts tokens that went
  // THROUGH the wire — a held token is not counted).
  const deliveries = state.wireDeliveries && typeof state.wireDeliveries === 'object' ? state.wireDeliveries : {};
  for (const w of wires) {
    if (!w.loop) continue;
    const n = Number(deliveries[w.id]) || 0;
    if (n < 1) continue;
    const max = Number(w.maxCycles) || DEFAULT_MAX_CYCLES;
    decor.loopBadges[w.id] = { n, max, text: `${n}×`, title: `${n} of ${max} cycles` };
  }

  // Gate pip: the gate holds at the SOURCE's publish.
  const g = state.gate && typeof state.gate === 'object' ? state.gate : null;
  if (g && g.wireId) {
    const wire = wires.find((w) => w.id === g.wireId) || null;
    const nodeId = g.fromNode || (wire && wire.from && wire.from.node) || null;
    if (nodeId) decor.gate = { nodeId, wireId: g.wireId, askId: g.askId || null };
  }
}
