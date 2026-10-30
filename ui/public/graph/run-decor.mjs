// ui/public/graph/run-decor.mjs   (depth 3 below the repo root)
//
// Run monitor v2. ONE pure reducer turns a run's `state` into ONE decor bag, and
// ONE DOM pass (applyDecor, Task 4) lays that bag over the shared graph view.
//
// Genericity charter: nothing here keys off an agent key or a phase name. Row
// labels read the manifest's port metadata (`loop: true`), statuses read the
// execution ledger (state.steps[], one row per execution, key === executionId),
// colours read the manifest node. History renders with the registry absent.
import { levelAtLeast } from '../ui-level.mjs';
import { manifestPortsFn, manifestTemplate } from '../../../src/shared/graph/manifest.mjs';
import { BOOKEND_EXECUTION_IDS, DEFAULT_MAX_CYCLES, KEYED_KINDS } from '../../../src/shared/graph/constants.mjs';
import { fanLines } from '../../../src/shared/graph/geometry.mjs';
import { stepAux, fmtAuxCalls, floorText } from '../../../src/shared/cost/breakdown.mjs';
import { engineReportsCost, engineLabel, sessionSupport, SESSION_SUBAGENTS_VERIFIED } from '../../../src/shared/engine-switch.mjs';
import { sessionsOf, isMemberDispatch, SESSION_DEFAULT_LABEL } from '../../../src/shared/graph/sessions.mjs';

/** The run-level warning a run that drained without binding End carries. */
export const QUIESCENCE_WARNING = 'finished at quiescence — End not reached';

/** Composite (kind:'task') rows label from the task title; keep the card readable. */
const TITLE_MAX = 40;
/** Squares in a sub-agent fan strip before the count alone carries the tail.
 *  Wraps at FAN_PER_ROW (16), so the cap must stay ≤ 32 — style.css spells the
 *  two-line fan height (`.fan.f2`) and no taller. */
const SUB_SQUARE_CAP = 24;
/** Leds on the collapsed strip before the `N runs · $…` text alone carries the
 *  tail — 6 squares + the summary + the chevron is what the 220px card fits. */
const STRIP_LED_CAP = 6;
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
    if (KEYED_KINDS.includes(n.kind) && n.key && !out[n.key]) {
      out[n.key] = { displayName: n.label || n.key, color: n.color || '', icon: n.icon || '', ...(n.kind === 'script' ? { runtime: n.runtime || '' } : {}) };
    }
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
 * @param {{live?:boolean, now?:number, subsOf?:(nodeId:string)=>Array, lastLines?:Map, modelLabel?:(id:string)=>string, sessionVerified?:object}} opts
 *   `modelLabel` names a model id for the Away mode band (the catalog lives in app.js; default: the raw id).
 *   `sessionVerified`: the sub-agents gate per engine, read only while a session has no summary yet (tests open it).
 */
export function decorFromState(st, { live = true, now = Date.now(), subsOf = null, lastLines = null, modelLabel = null, sessionVerified = SESSION_SUBAGENTS_VERIFIED } = {}) {
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

  // Progress = done KEYED nodes / keyed nodes: a count, not the bar; the run progress bar is src/shared/run-progress.mjs (spec 2026-10-14 P12 supersedes D15). A script is a keyed card.
  const keyed = nodes.filter((n) => KEYED_KINDS.includes(n.kind));
  const progress = { done: keyed.filter((n) => status[n.id] === 'done').length, total: keyed.length };

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
    nodeIds: nodes.map((n) => n.id), wireIds: wires.map((w) => w.id), expanded: null, sessions: {},
  };
  decorateExecutions(decor, { stepper, nodes, wires, grouped, rows, activeList, rowFor, stepByExec, state, now, live, subsOf, lastLines, status,
    modelLabel: typeof modelLabel === 'function' ? modelLabel : (id) => id });
  decorateSessions(decor, { stepper, nodes, grouped, rowFor, state, runStatus, sessionVerified });
  return decor;
}

/** End's result chip: basename link for a path, the void treatment otherwise. */
function buildEndResult(endNode, result) {
  const path = result && result.path ? String(result.path) : null;
  const rel = path ? path.split('/').filter(Boolean).pop() : null;
  return { nodeId: endNode.id, path, rel, text: path ? rel : 'completed', kind: path ? 'path' : 'void' };
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

/** `3 runs · $1.12`; the cost half is dropped when the total is zero, or when the run's engine reports no cost
 *  (`unpriced`: the rows then hold only worca's own helper spend, never the run's cost). */
export function stripText(rows, { unpriced = false } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  const total = sumUsd(list);
  const runs = `${list.length} ${list.length === 1 ? 'run' : 'runs'}`;
  return total > 0 && !unpriced ? `${runs} · ${fmtUsd(total)}` : runs;
}

/** The status the 7px leds / row classes use ('start' is the wire's word for active). */
const ledOf = (status) => (status === 'start' ? 'active' : (status || 'pending'));

/**
 * How many 22px lines an exec row takes, decided from its texts so the model
 * bills the exact height style.css renders (the card height is model-driven;
 * CSS can never measure for it). Conservative per-glyph estimates — a wide
 * outlier degrades to the ellipsis, never to a taller row:
 *   1 = label + `dur · cost` share one line (the short-cycle common case);
 *   2 = `dur · cost` moves to its own right-aligned line (`.stack`);
 *   3 = the label itself takes two clamped lines above it (`.stack.l2`).
 */
export function execBandLayout(label, right) {
  const l = String(label || '');
  const r = String(right || '');
  if (!r) return { units: 1, stack: false, l2: false };            // flow rows: label alone
  if (l.length * 5.8 + r.length * 6.1 <= 168) return { units: 1, stack: false, l2: false };
  const l2 = l.length * 5.8 > 180;                                 // past one 180px label line
  return { units: l2 ? 3 : 2, stack: true, l2 };
}

/** Away mode (worca's own review of an ask): the step's booked share, `stepAux(row).away`
 *  ({usd, calls, floorUsd, stopped}; Task 1 books it inside the step cost), plus the model the
 *  review ran on — read off its sub-agent row (`subagentType 'night-decider'`, stepKey === the
 *  execution id, `runModel`), which rides the live run AND History's frozen state through the
 *  same `subsOf`. Null when the execution had no review. */
function awayOf(row, reviewModels, modelLabel) {
  const ax = stepAux(row).away;
  if (!ax) return null;
  const model = reviewModels.get(row.executionId) || null;
  return { ...ax, model, modelText: model ? modelLabel(model) : null };
}

/** The node chip's tooltip: `Away mode · 2 reviews · 1 stopped`, and `not in total` when the chip
 *  itself shows the stopped reviews' lower bound. */
const awayTitle = (a, floorShown) => ['Away mode', a.calls ? fmtAuxCalls('away', a.calls) : '', a.stopped ? `${a.stopped} stopped` : '',
  floorShown ? 'not in total' : ''].filter(Boolean).join(' · ');

function decorateExecutions(decor, ctx) {
  const { nodes, wires, grouped, activeList, rowFor, state, now, live, subsOf, lastLines, status, modelLabel } = ctx;
  const unpriced = !engineReportsCost(state?.runEngine);   // Cursor: no $0.00 pill
  // A session member's row says where it ran (Task 59): its exec row's tooltip. A row outside a host turn gets no key.
  const inSession = (row) => sessionRowLine(row, state && state.sessionHosts);

  for (const node of nodes) {
    const list = grouped.get(node.id) || [];
    // A session member's own dispatch is the member itself, never a research square on its card (05 §6.2, C8).
    const subs = typeof subsOf === 'function' ? (subsOf(node.id) || []).filter((s) => !isMemberDispatch(s)) : [];
    // executionId -> the model its LAST Away mode review ran on (one execution may raise several asks).
    const reviewModels = new Map();
    for (const s of subs) if (s && s.subagentType === 'night-decider' && s.stepKey && s.runModel) reviewModels.set(s.stepKey, s.runModel);
    // A FLOW node (task/and/or/combine/end) executes instantly and for free: its
    // rows carry no duration and no cost pill, and its card no header totals.
    const flow = !KEYED_KINDS.includes(node.kind);
    // A SCRIPT runs a child process: real duration, no cost pill — an exit code where an agent shows cost (S5).
    const script = node.kind === 'script';
    const rows = list.map((row) => {
      // A flow node executes instantly and for free: the NUMBERS are zeroed with
      // the pill texts, so `durMs`/`costUsd` never contradict `dur`/`cost` (a
      // consumer that sums the numbers must not pick up a flow row's real ms).
      const durMs = flow ? 0 : rowMs(row, now, live);
      const costUsd = flow || script ? 0 : round2(row.costUsd);
      const away = flow || script ? null : awayOf(row, reviewModels, modelLabel);
      const where = inSession(row);
      return {
        executionId: row.executionId, nodeId: node.id,
        kind: row.kind === 'task' ? 'task' : 'cycle',
        ordinal: Number(row.ordinal ?? row.cycle) || 1,
        label: rowLabel(node, row), led: ledOf(row.status),
        dur: !flow && row.activeMs != null ? fmtDur(durMs) : '',
        cost: flow || script || unpriced ? '' : fmtUsd(costUsd),
        exit: script && row.exitCode != null ? `exit ${row.exitCode}` : '',
        durMs, costUsd, flow,
        ...(away ? { away } : {}),
        ...(where ? { title: where } : {}),
      };
    });

    const fan = subs.length
      ? { leds: subs.slice(0, SUB_SQUARE_CAP).map((s) => (s && s.status === 'running' ? 'run' : 'done')), count: subs.length }
      : null;

    if (rows.length || fan) {
      decor.footers[node.id] = { rows, summary: stripText(rows, { unpriced }), leds: rows.map((r) => r.led), fan };
    }
    // S4: the last captured line of a RUNNING script, when the page has one.
    const liveLine = script && live && status[node.id] === 'active' && lastLines && typeof lastLines.get === 'function' ? lastLines.get(node.id) : null;
    if (liveLine) {
      if (!decor.footers[node.id]) decor.footers[node.id] = { rows: [], summary: '', leds: [], fan: null };
      decor.footers[node.id].live = String(liveLine);
    }
    if (rows.length && !flow) {
      const durMs = rows.reduce((a, r) => a + r.durMs, 0);
      const costUsd = sumUsd(rows);
      decor.totals[node.id] = {
        durMs, dur: fmtDur(durMs), costUsd, cost: script || unpriced ? '' : fmtUsd(costUsd),
        hasStep: rows.some((r) => r.dur !== ''),
      };
      // The node's Away mode share, kept apart from (and already inside) `cost`. Booked reviews show
      // their cost — $0.00 included (mock / a free model); a node whose reviews were ALL stopped shows
      // their lower bound (≥$x, not in total); unpriced, {free} or sub-cent shows no chip (never $0.00).
      const aw = rows.filter((r) => r.away).map((r) => r.away);
      if (aw.length) {
        const a = aw.reduce((t, x) => ({ usd: t.usd + x.usd, calls: t.calls + x.calls, stopped: t.stopped + x.stopped,
          floorUsd: x.floorUsd == null ? t.floorUsd : (t.floorUsd || 0) + x.floorUsd }), { usd: 0, calls: 0, stopped: 0, floorUsd: null });
        const floor = a.calls > 0 ? '' : floorText(a.floorUsd, fmtUsd);
        decor.totals[node.id].away = { ...a, text: a.calls > 0 ? fmtUsd(a.usd) : floor, title: awayTitle(a, !!floor) };
      }
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

// ── sessions (Task 56; 05 §6.1) ─────────────────────────────────────────────

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const times = (n) => (n === 1 ? 'once' : `${n} times`);
/** `14:00`: a reset time as a local 24-hour clock ('' when unreadable). */
function clock(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/** Why a session with no summary yet runs as separate sessions ('' when the reason is unknown), or undefined while it is
 *  undecided: the hosts open before the first step, so a member that ran, or a run that ended, with no summary never had
 *  a host (the kill switch); before that the Labs flag and the gate the view reads decide (its own paint stays). A run
 *  paused or interrupted before its first step (preflight, a usage limit, a server stop) has not ended: its resume opens
 *  the hosts. */
function noSummaryFallback(spec, engine, sessionVerified, ended, ran) {
  if (spec.members.length < 2) return 'one step';
  if (spec.settings.mode !== 'shared' && !sessionSupport(engine, { verified: sessionVerified }).subagents) return `sub-agents are not available on ${engineLabel(engine)} yet`;
  return ended || ran ? '' : undefined;
}

/** A session's mode reason in UI words: the flag's key is not copy ("never 'group'"); its Labs title is "One session". */
export function sessionReasonText(reason) {
  return String(reason ?? '').replace('the Labs flag sessionGroups is off', 'the One session Labs flag is off');
}

/** Where a member row ran (Task 59; spec §6.4 "inside session ‹label› · turn 7"): `Inside session ‹label› · turn N ·
 *  dispatch d:…`, N the number after the last `:` of its `turnId`; '' for a row that ran outside a host turn. The label is
 *  the session summary's (`state.sessionHosts[sid]`), else the default. Here, not in run-sessions-view.mjs (which
 *  re-exports it): that view imports this module, and a helper the decor imports back would close a module cycle. */
export function sessionRowLine(step, sessionHosts) {
  const ref = step && step.session && typeof step.session === 'object' ? step.session : null;
  if (!ref || typeof ref.sid !== 'string' || !ref.sid) return '';
  const s = sessionHosts && typeof sessionHosts === 'object' && Object.hasOwn(sessionHosts, ref.sid) ? sessionHosts[ref.sid] : null;
  const label = (s && typeof s.label === 'string' && s.label) || SESSION_DEFAULT_LABEL;
  const n = ref.turnId == null ? '' : String(ref.turnId).split(':').pop();
  return [`Inside session ${label}`, n ? `turn ${n}` : '', ref.dispatchId ? `dispatch ${ref.dispatchId}` : ''].filter(Boolean).join(' · ');
}

/**
 * `decor.sessions[sid]`: the tray header of every session in the manifest, `{}` without one. The status follows the
 * members' card statuses, first match wins (05 §6.1 as the plan's Task 56 table orders it; row 5, "interrupted", is
 * checked first because an interrupted run's unfinished member reads `active` live and `stopped` frozen). The summary
 * (`state.sessionHosts[sid]`) gives the turns, the cost and the mode; a member's rows give the time.
 */
function decorateSessions(decor, ctx) {
  const { stepper, nodes, grouped, rowFor, state, runStatus, sessionVerified } = ctx;
  if (!nodes.some((n) => n && n.config && n.config.session != null)) return;   // ungrouped: nothing derived, nothing allocated
  const specs = sessionsOf(manifestTemplate(stepper), manifestPortsFn(stepper));
  const hosts = state.sessionHosts && typeof state.sessionHosts === 'object' ? state.sessionHosts : {};
  const engine = state.runEngine || 'claude';
  const engineText = engineLabel(engine);
  const unpriced = !engineReportsCost(engine);
  const labelOf = (id) => { const n = nodeById(stepper, id); return (n && (n.label || n.id)) || id; };
  // A flow card (task/and/or/combine/end) is never the step a session waits for; a loop wire is followed through flow
  // cards (an OR valve) to the keyed cards it really joins.
  const flowCard = (id) => { const n = nodeById(stepper, id); return !!n && !KEYED_KINDS.includes(n.kind); };
  const wires = manifestWires(stepper);
  const ends = (id, dir, seen = new Set()) => {
    if (seen.has(id)) return [];
    seen.add(id);
    if (!flowCard(id)) return [id];
    return wires.filter((w) => (dir === 'out' ? w.from.node : w.to.node) === id).flatMap((w) => ends(dir === 'out' ? w.to.node : w.from.node, dir, seen));
  };
  // [from, to] for every loop wire between two different keyed cards: once `to` ran again, the run comes back to `from`.
  const loopsBack = wires.filter((w) => w.loop && w.from && w.to)
    .flatMap((w) => ends(w.from.node, 'in').flatMap((f) => ends(w.to.node, 'out').filter((t) => t !== f).map((t) => [f, t])));
  for (const spec of specs) {
    const sid = spec.sid;
    const members = spec.members;
    const mine = new Set(members);
    const summary = hosts[sid] && typeof hosts[sid] === 'object' ? hosts[sid] : null;
    const label = (summary && summary.label) || spec.settings.label || SESSION_DEFAULT_LABEL;
    const mode = (summary && summary.mode) || spec.settings.mode || 'subagents';
    const ran = members.some((id) => (grouped.get(id) || []).length > 0);
    const why = summary ? (summary.mode === 'separate' ? sessionReasonText(summary.modeReason) : null)
      : noSummaryFallback(spec, engine, sessionVerified, decor.resolved && runStatus !== 'paused' && runStatus !== 'interrupted', ran);
    const fallback = why === undefined ? null : why !== null;   // null: undecided, the view's own words stay
    const st = members.map((id) => decor.status[id] || 'pending');
    const lastRow = (id) => { const list = grouped.get(id) || []; return list[list.length - 1] || null; };
    const queued = (id) => { const r = lastRow(id); return !!(r && r.queued === true); };
    // The member running now: the newest active member (activeNodes is newest first) not waiting for its host (C39).
    const activeMembers = decor.activeNodes.filter((a) => mine.has(a.nodeId));
    const curEntry = activeMembers.find((a) => !queued(a.nodeId)) || activeMembers[0] || null;
    const curRow = curEntry ? rowFor(curEntry) : null;
    const ordinal = curRow ? Number(curRow.ordinal ?? curRow.cycle) || 1 : 1;
    const current = curEntry ? { nodeId: curEntry.nodeId, label: labelOf(curEntry.nodeId), cycleText: ordinal > 1 ? `cycle ${ordinal}` : '' } : null;
    const turns = summary && finite(summary.turns) ? summary.turns : 0;   // host turns; with no summary there was no host
    const shared = mode === 'shared';
    const gateHere = !!(decor.gate && mine.has(decor.gate.nodeId));
    // The member's last cycle (a composite's slices carry their parent's), 0 before it ran.
    const ord = (id) => { const list = grouped.get(id) || []; const r = list[list.length - 1]; return r ? Number(r.ordinal ?? r.cycle) || 1 : 0; };
    // A fix loop between two members: the loop wire's target ran again after its source last ran (Implementation cycle 2
    // after Review cycle 1), so the run comes back to the source. Members that ran a different number of times with no
    // loop between them (Refine's own revise loop, Check after Review's last pass) are not one.
    const midCycle = loopsBack.some(([f, t]) => mine.has(f) && mine.has(t) && ord(t) > ord(f));
    const back = gateHere || midCycle;                       // the run will come back to this session
    const allDone = st.every((x) => x === 'done' || x === 'skipped');
    const started = st.some((x) => x !== 'pending');
    const stepsWord = shared ? count(members.length, 'step') : count(members.length, 'sub-agent');
    let status;
    let tail;
    if (runStatus === 'interrupted' && started && (!allDone || back)) {   // the session part-done (or mid-loop) when the server stopped
      status = 'interrupted'; tail = 'Interrupted · resume continues this session';
    } else if (current && curRow && curRow.kind === 'task') {
      status = 'waiting'; tail = `waiting · ${current.label}'s tasks run on their own`;   // ×N slices never go through a host (D2)
    } else if (current) {
      status = 'active'; tail = current.cycleText ? `${current.label} · ${current.cycleText}` : current.label;
    } else if (st.includes('paused') || (runStatus === 'paused' && started && (!allDone || back))) {
      status = 'paused';
      const reset = state.pauseReason === 'usage_limit' ? clock(state.limitResetAt) : '';
      tail = state.pauseReason === 'usage_limit' ? `Paused · usage limit${reset ? ` · resets ${reset}` : ''}` : 'Paused · resumes in this session';
    } else if (st.includes('error')) {
      status = 'error'; tail = `Failed in ${labelOf(members[st.indexOf('error')])}`;
    } else if (st.includes('stopped')) {
      status = 'stopped'; tail = 'Stopped';
    } else if (st.every((x) => x === 'skipped')) {
      status = 'skipped'; tail = 'Skipped';
    } else if (!decor.resolved && allDone && back) {
      // Not done while the run can come back to it: a loop gate held on a member's verdict, or a fix loop between its
      // members (one is a cycle ahead of the other). The hosts stay open until the run ends.
      status = 'waiting'; tail = gateHere ? 'waiting for an answer' : 'waiting';
    } else if (allDone) {
      status = 'done'; tail = `Done · ${shared ? count(st.filter((x) => x === 'done').length, 'step') : count(st.filter((x) => x === 'done').length, 'sub-agent')} · ${count(turns, 'turn')}`;
    } else if (st.every((x) => x === 'pending')) {
      status = 'pending'; tail = stepsWord;
    } else if (!decor.resolved) {
      const outside = decor.activeNodes.find((a) => !mine.has(a.nodeId) && !flowCard(a.nodeId));
      status = 'waiting'; tail = gateHere ? 'waiting for an answer' : outside ? `waiting for ${outside.label}` : 'waiting';
    } else {
      status = 'stopped'; tail = 'Stopped';               // the run ended with part of the session never run
    }
    const text = fallback ? `${label} · ${engineText} · Separate sessions${why ? ` · ${why}` : ''}` : `${label} · ${engineText} · ${tail}`;
    const durMs = members.reduce((a, id) => a + ((decor.totals[id] && decor.totals[id].durMs) || 0), 0);
    // The session's cost is its members' totals (05 §6.1: "Σ member totals"), the figures on their cards: a hosted turn
    // books the member's share and the hand-off on the member's row, and a member that ran plain (a runtime degrade, the
    // kill switch) books there too, where the trace's own sum never looks. The summary's sum stands in only while no row
    // has a figure.
    const priced = members.some((id) => (grouped.get(id) || []).some((r) => finite(r.costUsd)));
    const costUsd = priced ? round2(members.reduce((a, id) => a + ((decor.totals[id] && decor.totals[id].costUsd) || 0), 0))
      : (summary && finite(summary.costUsd) ? round2(summary.costUsd) : null);
    const overheadUsd = summary && finite(summary.hostOverheadUsd) ? round2(summary.hostOverheadUsd) : null;
    const cost = unpriced || costUsd == null ? '' : fmtUsd(costUsd);
    const dur = fmtDur(durMs);
    const restarts = summary && finite(summary.restarts) ? summary.restarts : 0;
    const rotations = summary && finite(summary.rotations) ? summary.rotations : 0;
    // Runs per member (a composite's slices are one run of it); host turns are the session's own count (retries add turns).
    const runsOf = (id) => new Set((grouped.get(id) || []).map((r) => r.parentExecutionId || r.executionId)).size;
    const perMember = members.map((id) => `${labelOf(id)} ×${runsOf(id)}`).join(', ');
    const title = [
      text,                                                 // hosts that show only the dot keep the words in the tooltip
      fallback ? `Separate ${engineText} sessions${why ? ` · ${why}` : ''}`
        : shared ? `One ${engineText} conversation` : `One ${engineText} session · main agent ${(summary && summary.hostModel) || 'default model'}`,
      ran ? `${turns > 0 ? `${count(turns, 'turn')} · ` : ''}runs: ${perMember}` : '',
      [dur, cost ? `${cost}${overheadUsd != null && !unpriced ? ` incl. ${fmtUsd(overheadUsd)} hand-offs` : ''}` : ''].filter(Boolean).join(' · '),
      restarts > 0 ? `restarted fresh ${times(restarts)}` : '',
      rotations > 0 ? `rotated ${times(rotations)}` : '',
    ].filter(Boolean).join('\n');
    const phrase = status === 'active' && !fallback
      ? `running ${current.label}${turns > 0 ? `, turn ${turns}` : ''}`
      : (fallback ? `Separate sessions${why ? ` · ${why}` : ''}` : tail).replace(/ · /g, ', ').replace(/^./, (ch) => ch.toLowerCase());
    decor.sessions[sid] = {
      sid, members: [...members], status, label, engine, fallback, mode, current, turns, restarts,
      durMs, dur, costUsd, cost, overheadUsd, text,
      right: [turns > 0 ? `turn ${turns}` : '', dur, cost].filter(Boolean).join(' · '),
      title, aria: `${label}: ${members.map(labelOf).join(', ')}. ${phrase}`,
    };
    // C39: a member waiting for its host says so on its card (the card stays active; its clock is not paused in v1).
    for (const id of members) {
      if (!queued(id) || !decor.footers[id]) continue;
      const busy = current && current.nodeId !== id ? current.label : null;
      decor.footers[id].queued = true;
      decor.footers[id].live = busy ? `queued · waiting for ${busy}` : 'queued · waiting for its session';
    }
  }
}

/** One execution's Away mode bands (one 22px line each — "Away mode" itself does not fit a 220px
 *  card line, so the band leads with the Away mode glyph and `title` carries the words). A booked
 *  band shows even at $0.00; a stopped one shows its lower bound (≥$x, "not in total" in its title),
 *  or nothing when it is not priced, {free} or under a cent. */
function awayBands(r) {
  const a = r.away;
  if (!a) return [];
  const out = [];
  if (a.calls > 0) {
    const label = [fmtAuxCalls('away', a.calls), a.modelText].filter(Boolean).join(' · ');
    out.push({ kind: 'away', executionId: r.executionId, variant: 'booked', label, title: `Away mode · ${label}`, right: fmtUsd(a.usd) });
  }
  if (a.stopped > 0) {
    const label = a.stopped === 1 ? 'review stopped' : `${a.stopped} reviews stopped`;
    const right = floorText(a.floorUsd, fmtUsd);
    out.push({ kind: 'away', executionId: r.executionId, variant: 'stopped', label, title: `Away mode · ${label}${right ? ' · not in total' : ''}`, right });
  }
  return out;
}

/**
 * Lay the decor over an already-rendered view. Idempotent and self-clearing:
 * every ornament is rebuilt from the bag, so a repaint after the run settles
 * cannot strand an ant, a badge or a gate pip. NEVER writes a card height —
 * `view.setFooter` re-runs `nodeSize` for the band count it was handed.
 * Band order inside a footer, top → bottom: fan → strip → exec×N (only for the
 * ONE expanded node; each followed by its Away mode bands, booked then stopped) → result.
 */
export function applyDecor(view, decor) {
  if (!view || !decor) return;
  // Interface mode (docs/ui-levels.md): status colours, the gate pip, the End result and live wires
  // are for everyone; per-node totals, the fan and execution strips and loop-count badges are
  // expert detail. Gated HERE, not in CSS — a footer band sets the card's height.
  const full = decor.detail !== undefined ? !!decor.detail : levelAtLeast('expert');
  const expanded = full ? (decor.expanded || null) : null;
  for (const nodeId of decor.nodeIds || []) {
    view.setStatus(nodeId, decor.status[nodeId] || 'pending');
    view.setNodeChrome(nodeId, {
      color: decor.colors[nodeId] || '',
      gate: decor.gate && decor.gate.nodeId === nodeId
        ? { wireId: decor.gate.wireId, title: 'waiting on a loop gate. Open the question panel' } : null,
      totals: full ? (decor.totals[nodeId] || null) : null,
    });
    const foot = full ? (decor.footers[nodeId] || null) : null;
    const bands = [];
    if (foot && foot.fan) {
      bands.push({ kind: 'fan', leds: foot.fan.leds, count: foot.fan.count, lines: fanLines(foot.fan.leds.length) });
    }
    if (foot && foot.rows.length) {
      bands.push({ kind: 'strip', leds: foot.leds.slice(0, STRIP_LED_CAP), summary: foot.summary, expanded: expanded === nodeId });
      if (expanded === nodeId) {
        for (const r of foot.rows) {
          const right = [r.dur, r.cost || r.exit].filter(Boolean).join(' · ');
          bands.push({ kind: 'exec', executionId: r.executionId, led: r.led, label: r.label,
            right, ...execBandLayout(r.label, right), ...(r.title ? { title: r.title } : {}) });
          bands.push(...awayBands(r));
        }
      }
    }
    if (foot && foot.live) bands.push({ kind: 'live', text: foot.live });
    if (decor.endResult && decor.endResult.nodeId === nodeId) {
      bands.push({ kind: 'result', text: decor.endResult.text, path: decor.endResult.path });
    }
    view.setFooter(nodeId, bands);
  }
  for (const wireId of decor.wireIds || []) view.setWireBadge(wireId, full ? (decor.loopBadges[wireId] || null) : null);
  view.setWireLive(decor.liveWireIds || []);
  // The session trays (Task 56): status, words and the run's own fallback at every level; `turn · dur · cost` is expert
  // detail, like the node totals (05 §6.2).
  if (typeof view.setSessionChrome !== 'function') return;
  for (const [sid, s] of Object.entries(decor.sessions || {})) {
    const right = full ? s.right : null;
    if (s.fallback === null) view.setSessionChrome(sid, { status: s.status, right, text: null, title: null, aria: null });   // undecided: the view's words
    else view.setSessionChrome(sid, { status: s.status, text: s.text, right, title: s.title, aria: s.aria, fallback: s.fallback });
  }
}
