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
import { BOOKEND_EXECUTION_IDS, KEYED_KINDS } from '../shared/graph/constants.mjs';

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
  if (node && !KEYED_KINDS.includes(node.kind)) {   // a flow card: one dim ✓ line, no ordinal / duration / cost
    if (ev.status !== 'done') return '';
    return `${color('green', '✓')} ${label}${MARKED_FLOW.has(node.kind) ? flowMarker(node, m, color) : ''}`;
  }
  const ord = ` #${ev.ordinal ?? 1}`;
  if (ev.status === 'start') return `${color('cyan', '▶')} ${label}${ord}${loopSource(ev, node, m)}`;
  if (ev.status === 'paused') return `${color('yellow', '⏸')} ${label}${ord}  paused`;
  const dur = ev.durationMs != null ? `  ${fmtDur(ev.durationMs)}` : '';
  if (ev.status === 'error') return `${color('red', '✗')} ${label}${ord}${dur} — ${ev.error || 'failed'}`;
  if (ev.status !== 'done') return '';   // `skipped` (and anything unknown) renders nothing
  const cost = node && node.kind === 'script'
    ? (ev.exitCode != null ? ` · exit ${ev.exitCode}` : '')
    : (ev.costUsd != null ? ` · ${usd(ev.costUsd)}` : '');
  const verdict = ev.verdict ? (ev.verdict.missing ? ' — no verdict written (treated as clean)' : ev.verdict.hasBlocking ? ' — blocking' : ' — clean') : '';
  return `${color('green', '✓')} ${label}${ord}${dur}${cost}${verdict}`;
}

/** The interactive gate prompt's header. */
export function formatGateHeader(payload, manifest) {
  const m = manifest || {};
  const wire = wiresOf(m).find((w) => w.id === (payload && payload.wireId)) || null;
  const where = wire ? ` · ${labelOf(m, wire.from.node)} → ${labelOf(m, wire.to.node)}` : '';
  const max = wire && wire.maxCycles ? Number(wire.maxCycles) : null;
  // The cycle comes from the PAYLOAD's `deliveryNo`, never from the id: a wire that
  // holds more than once mints `gate-<wireId>-<deliveryNo>-h<holdNo>`, so the id's
  // trailing number is the HOLD ordinal, not the delivery (MAJ-11). No deliveryNo
  // (an older resume point, a hand-built payload) falls back to the budget.
  const n = Number(payload && payload.deliveryNo);
  const used = Number.isFinite(n) && n > 0 ? n : max;
  const budget = max ? `  ${used || max}/${max} cycles used` : '';
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

/**
 * The interactive Auto proposal (spec §9): what the question panel shows in the
 * browser, as text. Pure — the payload is `question.workflow` (auto/proposal.mjs).
 * Stages follow the proposal's DISPATCH `order` (a reused composer row's node order
 * is arbitrary); every model/plugin-authored string in the payload was cleaned by
 * the assembler (single line, no control characters), so it is safe to print.
 * @param {object} w the proposal
 * @returns {string[]} lines
 */
export function formatWorkflowProposal(w) {
  const p = w && typeof w === 'object' ? w : {};
  const where = p.match
    ? `(same shape as your saved workflow "${p.match.name}" — Accept reuses it)`
    : `(no saved workflow has this shape — Accept saves it as "${p.name ?? ''}")`;
  const lines = [`? Auto proposes a workflow · round ${p.round || 1}  ${where}`];
  if (p.reasoning) lines.push(`  ${p.reasoning}`);
  // buildProposal defaults `size` to 'medium', so every REAL proposal prints this line;
  // the guard only spares the unit fixtures that carry neither field.
  const cues = [p.size, ...(Array.isArray(p.signals) ? p.signals : [])].filter(Boolean);
  if (cues.length) lines.push(`  ${cues.join(' · ')}`);
  const nodes = p.manifest?.graph?.nodes || [];
  const wires = p.manifest?.graph?.wires || [];
  const agents = nodes.filter((n) => KEYED_KINDS.includes(n.kind));
  const ordered = Array.isArray(p.order) && p.order.length
    ? p.order.map((id) => agents.find((n) => n.id === id)).filter(Boolean)
    : agents;
  const labelOf = (id) => nodes.find((n) => n.id === id)?.label || id;
  const tune = (n) => [n.model, n.effort].filter(Boolean).join(' · ');
  lines.push(`  stages: ${ordered.map((n) => `${n.label || n.key}${tune(n) ? ` (${tune(n)})` : ''}${n.fanOut ? ' ⤴' : ''}`).join(' → ')}`);
  for (const l of wires.filter((x) => x.loop)) lines.push(`  loop: ${labelOf(l.from.node)} → ${labelOf(l.to.node)} (max ${l.maxCycles} cycles)`);
  if (p.ignoredProjectOverrides) lines.push('  note: this project\'s saved settings for that workflow are not applied to Auto runs');
  for (const msg of p.warnings || []) lines.push(`  ! ${msg}`);
  if (Number(p.costUsd) > 0) lines.push(`  classifier cost so far: $${Number(p.costUsd).toFixed(2)}`);
  return lines;
}

// ── ask forms: the CLI's prompt FORMATTING (spec §8) ────────────────────────────
//
// The readline loop lives in worca-cc.mjs and every coercion rule lives in P1's
// coerceInput() — nothing here parses. `field` is one entry of
// promptFields(ask): { field, label, widget, type, schema, options: [{value,label}],
// items, itemFields, verdicts, free, default, required, when }. Colour is the
// caller's, exactly like formatExecLine.

/** How many times the CLI re-offers a form before giving up (MAX_QUESTION_ROUNDS's twin). */
export const FORM_REPROMPT_MAX = 3;

const isNum = (type) => type === 'number' || type === 'integer';

/** The `, Enter = <default>` / ` [Enter = <default>]` tail, or ''. */
function defaultHint(field, { bare = false } = {}) {
  const d = field.default;
  if (d === undefined || d === null || d === '') return '';
  const text = Array.isArray(d) ? d.join(', ') : String(d);
  return bare ? ` [Enter = ${text}]` : `, Enter = ${text}`;
}

/**
 * The lines to print for ONE form field, plus its readline prompt. `prompt` is null
 * for `review-list`: the caller loops field.items and prompts each field.itemFields
 * entry itself.
 * @param {object} field one promptFields() entry
 * @returns {{lines: string[], prompt: string|null}}
 */
export function formatFormField(field) {
  const f = field || {};
  const label = f.label || f.field;
  const lines = [`${label}${f.required ? ' *' : ''}`];
  const choices = Array.isArray(f.options) ? f.options : [];
  if (choices.length) choices.forEach((o, i) => lines.push(`  ${i + 1}) ${String(o.label)}`));

  if (f.widget === 'review-list') return { lines, prompt: null };
  const hint = defaultHint(f);
  if (f.widget === 'toggle' || f.type === 'boolean') return { lines, prompt: `Choose [y/n${hint}]: ` };
  if (f.widget === 'rank') return { lines, prompt: `Order [comma-separated numbers or ids${hint}]: ` };
  if (f.type === 'array') return { lines, prompt: `Choose [numbers or values, comma-separated${hint}]: ` };
  // A `suggest` select (P1 C14) accepts free text beside its suggestions.
  if (choices.length && f.free) return { lines, prompt: `Choose [number, value or your own text${hint}]: ` };
  if (choices.length) return { lines, prompt: `Choose [number or value${hint}]: ` };
  if (isNum(f.type)) return { lines, prompt: `Enter a number${defaultHint(f, { bare: true })}: ` };
  if (f.widget === 'date') return { lines, prompt: `Enter a date (YYYY-MM-DD)${defaultHint(f, { bare: true })}: ` };
  return { lines, prompt: `Your answer${defaultHint(f, { bare: true })}: ` };
}

/** A failed coerceInput() as ONE printable line. P1's message names the problem but not
 *  the field, because a chat reply prefixes the path instead (X7). */
export function formatCoerceError(field, res) {
  const f = field || {};
  const label = f.label || f.field || '';
  const message = res && res.message ? String(res.message) : 'invalid value';
  return label ? `  ${label}: ${message}` : `  ${message}`;
}

/** P1 validate()/collectAnswer() errors as indented printable lines. */
export function formatFormErrors(errors) {
  return (Array.isArray(errors) ? errors : []).map((e) => {
    const path = e && e.path ? String(e.path) : '';
    const message = e && e.message ? String(e.message) : 'invalid value';
    return path ? `  ${path}: ${message}` : `  ${message}`;
  });
}
