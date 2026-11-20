// src/shared/cost/breakdown.mjs — worca's own AI spend inside a run's cost, as every surface shows it.
// Pure, browser + Node (served at /src/shared; ui/public imports it as '../../src/shared/cost/breakdown.mjs').
// Booking lives in run-harness _recordCost ({aux}; `session` = a session's main agent, its hand-offs); this only reads steps[].auxCosts and
// steps[].stoppedTurns. Numbers stay raw here; callers format them. Lower bounds (`floorUsd`: a call
// or an agent turn cut off before its `result`) are NEVER in `total` or `agents` (I4).

export const AUX_KINDS = Object.freeze({
  away: Object.freeze({ label: 'Away mode' }),
  auto: Object.freeze({ label: 'Auto workflow' }),
  title: Object.freeze({ label: 'Run title' }),
  session: Object.freeze({ label: 'Session hand-offs' }),         // C22: a session's main agent (session groups)
});
export const AUX_ORDER = Object.freeze(['away', 'auto', 'title', 'session']);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
/** A stored lower bound: a finite number ≥ 0 (0 = a {free} model), else null (not priced).
 *  Strict on purpose: Number(null) is 0, which would turn "not priced" into "free". */
const floorOf = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
/** Σ of lower bounds: null only while none of the parts was priced. */
const addFloor = (a, b) => (a == null ? b : b == null ? a : a + b);

/** One step's aux shares, normalized; only kinds the step has. */
export function stepAux(step) {
  const out = {};
  const a = step && step.auxCosts && typeof step.auxCosts === 'object' ? step.auxCosts : null;
  if (!a) return out;
  for (const k of AUX_ORDER) {
    const b = a[k];
    if (!b || typeof b !== 'object') continue;
    out[k] = { usd: num(b.usd), calls: Math.floor(num(b.calls)), floorUsd: floorOf(b.floorUsd), stopped: Math.floor(num(b.stopped)) };
  }
  return out;
}

/** One step's agent turns cut before their `result` (Task 3), normalized; null when it has none. */
function stepCut(step) {
  const c = step.stoppedTurns && typeof step.stoppedTurns === 'object' ? step.stoppedTurns : null;
  return c ? { turns: Math.floor(num(c.turns)), tokens: Math.floor(num(c.tokens)), floorUsd: floorOf(c.floorUsd) } : null;
}

/** The run's breakdown: one line per aux kind present (fixed order), the agents' share, and — apart,
 *  never summed — the stopped calls' and the cut agent turns' lower bounds.
 *  `total` is the run total the header shows (a finite NUMBER), else Σ steps. */
export function runCostBreakdown(steps, totalCostUsd) {
  const list = Array.isArray(steps) ? steps : [];
  const sum = list.reduce((s, x) => s + num(x && x.costUsd), 0);
  const total = typeof totalCostUsd === 'number' && Number.isFinite(totalCostUsd) ? totalCostUsd : sum;
  const acc = {};
  const cut = { turns: 0, tokens: 0, floorUsd: null };
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    for (const [k, b] of Object.entries(stepAux(s))) {
      const t = (acc[k] ||= { usd: 0, calls: 0, floorUsd: null, stopped: 0 });
      t.usd += b.usd; t.calls += b.calls; t.floorUsd = addFloor(t.floorUsd, b.floorUsd); t.stopped += b.stopped;
    }
    const c = stepCut(s);
    if (c) { cut.turns += c.turns; cut.tokens += c.tokens; cut.floorUsd = addFloor(cut.floorUsd, c.floorUsd); }
  }
  const lines = AUX_ORDER.filter((k) => acc[k]).map((k) => ({ kind: k, label: AUX_KINDS[k].label, ...acc[k] }));
  const auxUsd = lines.reduce((s, l) => s + l.usd, 0);
  return {
    total, agents: Math.max(0, total - auxUsd), lines,
    floorUsd: lines.reduce((f, l) => addFloor(f, l.floorUsd), null), stopped: lines.reduce((s, l) => s + l.stopped, 0), cut,
  };
}

/** A lower bound as every surface prints it: `≥$x`, x rounded DOWN to whole cents (rounding up would
 *  claim more than was spent; the 1e-9 absorbs binary fractions like 0.29 × 100). '' when there is
 *  nothing to print: not priced (null), a {free} model (0), under a cent, or junk. */
export function floorText(floorUsd, fmtUsd) {
  if (typeof floorUsd !== 'number' || !Number.isFinite(floorUsd)) return '';
  const cents = Math.floor(floorUsd * 100 + 1e-9) / 100;
  return cents > 0 ? `≥${fmtUsd(cents)}` : '';
}

const SUB_LABELS = Object.freeze({ 'night-decider': 'Away mode review', 'auto-classify': 'Auto workflow', 'run-title': 'Run title' });
/** Display label for a worca-owned sub-agent row (stored labels are frozen; old rows say "Night decider"). */
export function auxLabelForSubagent(subagentType, kind) {
  const base = Object.hasOwn(SUB_LABELS, String(subagentType)) ? SUB_LABELS[subagentType] : null;
  if (!base) return null;
  return subagentType === 'night-decider' && kind ? `${base} (${kind})` : base;
}

/** "1 review" / "2 reviews" for Away mode, "1 hand-off" / "n hand-offs" for a session's main agent (C22),
 *  "1 call" / "n calls" for the others. */
export function fmtAuxCalls(kind, calls) {
  const n = Math.max(0, Math.floor(Number(calls) || 0));
  const w = kind === 'away' ? 'review' : kind === 'session' ? 'hand-off' : 'call';
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}
