// src/cli/render.mjs
//
// The CLI's rendering of the graph engine's `exec` stream. PURE: no IO, no
// colour codes of its own — the caller injects `color(name, text)`. Labels come
// from the run manifest (pipelines.stepper); execution ids are NEVER printed.
//
// The line shapes (spec §8, literal):
//   ▶ Implementer #2 · fix ← Reviewer      agent start (loop port from trigger.freshPorts; source = the wire's from-node)
//     ▶ task 3/7 · Add schema              kind:'task' slice start (indented; index within its phase)
//   ✓ Implementer #2  1m03s · $0.12        agent done (verifiers append " — blocking" / " — clean")
//   ✓ OR · OR → Implementer                flow-node done: ONE dim line, no ordinal/duration/cost; the
//                                          marker only for AND / OR / COMBINE (`✓ Task` is bare)
//   ✗ Reviewer #1  12s — <error>           agent error
//   ⏸ Implementer #1  paused               agent paused
//   ■ End ← Reviewer.pass → plan-review.md End bound — End's ONLY line
// Flow nodes never print a start/paused/error line; `skipped` and P8's bookend
// executions render nothing; `token` events are never rendered.
import { BOOKEND_EXECUTION_IDS } from '../shared/graph/constants.mjs';

const nodesOf = (m) => ((m && m.graph && m.graph.nodes) || []).filter(Boolean);
const wiresOf = (m) => ((m && m.graph && m.graph.wires) || []).filter(Boolean);
const nodeOf = (m, id) => nodesOf(m).find((n) => n.id === id) || null;
const labelOf = (m, id) => { const n = nodeOf(m, id); return (n && (n.label || n.id)) || id; };
const base = (p) => String(p || '').split('/').filter(Boolean).pop() || '';
/** Flow kinds whose done line carries a marker (` · AND`, ` · OR → X`, ` · COMBINE → X`). */
const MARKED_FLOW = new Set(['and', 'or', 'combine']);

/** `12s` / `1m03s` / `1h01m` — the CLI's compact shape (NOT the UI's `1m 3s`). */
export function fmtDur(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}
const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;

/** ` · fix ← Reviewer`: the loop port that re-fired this execution
 *  (trigger.freshPorts ∩ the node's `loop: true` inputs) and the node that
 *  published on the wire that DELIVERED it. Through an OR valve that wire is
 *  the valve's out-wire, so the source reads `← OR` (probe P13). */
function loopSource(ev, node, m) {
  const loopIns = new Set(((node && node.ports && node.ports.inputs) || []).filter((p) => p && p.loop).map((p) => p.id));
  const trig = ev.trigger || {};
  const port = (trig.freshPorts || []).find((p) => loopIns.has(p));
  if (!port) return '';
  const wire = wiresOf(m).find((w) => (trig.wireIds || []).includes(w.id) && w.to && w.to.port === port);
  return wire ? ` · ${port} ← ${labelOf(m, wire.from.node)}` : ` · ${port}`;
}

/** The dim marker an AND/OR/COMBINE card carries: ` · AND`, ` · OR → Implementer`. */
function flowMarker(node, m, color) {
  const kind = String(node.kind).toUpperCase();
  const out = wiresOf(m).find((w) => w.from && w.from.node === node.id);
  return color('dim', out ? ` · ${kind} → ${labelOf(m, out.to.node)}` : ` · ${kind}`);
}

/** ONE `exec` event -> ONE terminal line ('' when the event renders nothing). */
export function formatExecLine(ev, manifest, { color = (n, s) => s } = {}) {
  if (!ev || !ev.nodeId) return '';
  if (BOOKEND_EXECUTION_IDS.includes(ev.executionId)) return '';   // P8's preflight/done rows render nothing
  const m = manifest || {};
  const node = nodeOf(m, ev.nodeId);
  const label = labelOf(m, ev.nodeId);
  if (ev.kind === 'task') {   // a composite slice: one indented start line, nothing else
    if (ev.status !== 'start') return '';
    const n = ev.taskIndex, t = ev.taskTotal;
    const which = Number.isFinite(n) && Number.isFinite(t) ? ` ${n}/${t}` : '';
    return `  ${color('cyan', '▶')} task${which}${ev.title ? ` · ${ev.title}` : ''}`;
  }
  if (node && node.kind === 'end') {   // End renders ONE line: the binding
    if (ev.status !== 'done') return '';
    const wire = wiresOf(m).find((w) => ((ev.trigger && ev.trigger.wireIds) || []).includes(w.id));
    const from = wire ? ` ← ${labelOf(m, wire.from.node)}.${wire.from.port}` : '';
    const r = ev.result || {};
    const tail = r.path ? ` → ${base(r.path)}` : (r.value != null ? ` → ${String(r.value)}` : '');
    return `${color('bold', '■')} ${label}${from}${tail}`;
  }
  if (node && node.kind !== 'agent') {   // a flow card: one dim ✓ line, no ordinal / duration / cost
    if (ev.status !== 'done') return '';
    return `${color('green', '✓')} ${label}${MARKED_FLOW.has(node.kind) ? flowMarker(node, m, color) : ''}`;
  }
  const ord = ` #${ev.ordinal ?? 1}`;
  if (ev.status === 'start') return `${color('cyan', '▶')} ${label}${ord}${loopSource(ev, node, m)}`;
  if (ev.status === 'paused') return `${color('yellow', '⏸')} ${label}${ord}  paused`;
  const dur = ev.durationMs != null ? `  ${fmtDur(ev.durationMs)}` : '';
  if (ev.status === 'error') return `${color('red', '✗')} ${label}${ord}${dur} — ${ev.error || 'failed'}`;
  if (ev.status !== 'done') return '';   // `skipped` (and anything unknown) renders nothing
  const cost = ev.costUsd != null ? ` · ${usd(ev.costUsd)}` : '';
  const verdict = ev.verdict ? (ev.verdict.hasBlocking ? ' — blocking' : ' — clean') : '';
  return `${color('green', '✓')} ${label}${ord}${dur}${cost}${verdict}`;
}

/** The interactive gate prompt's header. */
export function formatGateHeader(payload, manifest) {
  const m = manifest || {};
  const wire = wiresOf(m).find((w) => w.id === (payload && payload.wireId)) || null;
  const where = wire ? ` · ${labelOf(m, wire.from.node)} → ${labelOf(m, wire.to.node)}` : '';
  const max = wire && wire.maxCycles ? Number(wire.maxCycles) : null;
  // P3 gate ask ids are `gate-<wireId>-<deliveryNo>` (spec §5.3); no deliveryNo field rides the payload.
  const m2 = /-(\d+)$/.exec(String((payload && payload.id) || ''));
  const n = m2 ? Number(m2[1]) : max;
  const budget = max ? `  ${n || max}/${max} cycles used` : '';
  return `? Loop gate${where}${budget}`;
}

/** The summary's result line. */
export function formatResultLine(result) {
  const r = result || {};
  if (r.path) return `Result: ${r.path}`;
  if (r.value != null && r.value !== '') return `Result: ${String(r.value)}`;
  return 'Result: completed';
}

/** `9 executions · 12m00s active · $1.23`. */
export function formatTotals({ executions = 0, activeMs = 0, costUsd = 0 } = {}) {
  return `${executions} execution${executions === 1 ? '' : 's'} · ${fmtDur(activeMs)} active · ${usd(costUsd)}`;
}

/**
 * The v2 run summary the CLI prints under `Pipeline complete.` — pure, so the
 * quiescence arm and the executions count are testable without spawning a run.
 * Returns [] for a v1 run. An EXECUTION row carries an executionId that is not
 * a bookend id: today's bookends are `_recordStep('preflight'|'done', …)` rows
 * with key 'preflight' / 'done' and NO executionId; P8's become real
 * x:preflight:1 / x:done:1 executions (BOOKEND_EXECUTION_IDS). The active time
 * is the SUM over execution rows — state.totalActiveMs includes preflight.
 */
export function formatRunSummary(state) {
  const st = state || {};
  if (!(st.stepper && st.stepper.version === 2)) return [];
  const rows = (Array.isArray(st.steps) ? st.steps : [])
    .filter((s) => s && s.executionId && !BOOKEND_EXECUTION_IDS.includes(s.executionId));
  const lines = [];
  // Quiescence is the reducer's rule: the run reached `done` WITHOUT the End node
  // firing. A stopped/errored run also has endReached false and must NOT claim it.
  if (st.endReached === false && String(st.status || '').toLowerCase() === 'done') lines.push('Finished at quiescence — End not reached');
  else lines.push(formatResultLine(st.result));
  lines.push(formatTotals({
    executions: rows.length,
    activeMs: rows.reduce((a, s) => a + (Number(s.activeMs) || 0), 0),
    costUsd: st.totalCostUsd,
  }));
  return lines;
}
