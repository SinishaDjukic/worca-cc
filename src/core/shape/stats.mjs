// src/core/shape/stats.mjs — Shaper D28: what a shaped run records about its shaping. Pure.
import { normalizeStartCare } from '../../shared/shape/feature-record.mjs';
import { normalizePrototype } from '../../shared/shape/prototype.mjs';

/** The nodes that run before the approval stop; every other step row is building. */
export const SHAPING_NODES = Object.freeze(['n_clarify', 'n_plan', 'n_roles', 'n_refine']);
const REVIEW_NODE = 'n_review';
const BY = new Set(['person', 'check']);
// The same 4-decimal rounding as run-harness.mjs roundUsd/sumStepCosts, so shaping + building = totalCostUsd.
const round4 = (n) => Math.round((Number(n) || 0) * 1e4) / 1e4;

/** The recorded (not derivable) part, empty or rebuilt from a stored shapeStats on resume. */
export function shapeRecordFrom(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  return {
    questions: { asked: n(s.questions?.asked), skipped: n(s.questions?.skipped) },
    revises: (Array.isArray(s.revises) ? s.revises : [])
      .filter((r) => r && Number.isInteger(r.round) && BY.has(r.by)).map((r) => ({ round: r.round, by: r.by })),
    shapeScore: Number.isFinite(s.shapeScore) ? s.shapeScore : null,
    // Shaper small runs B1 (D1): the marker stamped when the planning run started; only `true` is kept, never a flag read.
    ...(s.smallRuns === true ? { smallRuns: true } : {}),
    // Shaper small runs B2 (D8): the Care chosen at the Start step, kept only when it is a valid record.
    ...careEntry(s.care),
    // Shaper small runs C1 (D12): the Prototype step's state, kept only when it is a valid record.
    ...protoEntry(s.prototype),
  };
}

const protoEntry = (raw) => { const p = raw ? normalizePrototype(raw) : null; return p ? { prototype: p } : {}; };
const careEntry = (raw) => { const c = raw ? normalizeStartCare(raw) : null; return c?.ok ? { care: c.care } : {}; };

/** A Clarify ask's counts from the RAW answer payload ({answers} or a bare array): no non-blank choice = skipped. */
export function clarifyCounts(questions, payload) {
  const qs = Array.isArray(questions) ? questions : [];
  const arr = Array.isArray(payload?.answers) ? payload.answers : Array.isArray(payload) ? payload : [];
  const given = new Set(arr.filter((a) => a && a.id != null && String(a.choice ?? '').trim()).map((a) => String(a.id)));
  return { asked: qs.length, skipped: qs.filter((q) => !given.has(String(q?.id))).length };
}

/** passed / total of the approved round's check, 3 decimals; null without a check. */
export const shapeScoreOf = (check) => (check && check.total > 0 ? Math.round((check.passed / check.total) * 1000) / 1000 : null);

/**
 * @param {{questions:{asked:number, skipped:number}, revises:Array<{round:number, by:'person'|'check'}>, shapeScore:number|null}} record
 * @param {Array<{nodeId?:string, status?:string, costUsd?:number}>} steps the run's state.steps
 */
export function buildShapeStats(record, steps) {
  let shaping = 0;
  let building = 0;
  let reviewCycles = 0;
  for (const st of Array.isArray(steps) ? steps : []) {
    const cost = Number.isFinite(st?.costUsd) ? st.costUsd : 0;
    if (SHAPING_NODES.includes(st?.nodeId)) shaping += cost; else building += cost;
    if (st?.nodeId === REVIEW_NODE && st.status === 'done') reviewCycles += 1;
  }
  return {
    questions: { ...record.questions },
    revises: record.revises.map((r) => ({ ...r })),
    shapeScore: record.shapeScore,
    reviewCycles,
    checklist: null,                          // slice 3 (-3-checklists) fills { met, unmet, na }
    cost: { shaping: round4(shaping), building: round4(building) },
    ...(record.smallRuns === true ? { smallRuns: true } : {}),
    ...careEntry(record.care),
    ...protoEntry(record.prototype),
  };
}
