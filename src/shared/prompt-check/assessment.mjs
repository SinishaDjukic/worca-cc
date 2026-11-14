// src/shared/prompt-check/assessment.mjs — the ONE prompt-check assessment (docs/prompt-check.md): the kinds, their
// labels and rubrics, the requirement window, the kind → Auto taskKind table and the normalizer every surface reads.
// Browser-safe: relative src/shared imports only.
import { TASK_KINDS } from '../graph/assemble.mjs';
import { checkShape } from '../shape/shape.mjs';
import { PERSPECTIVE_KEYS } from '../shape/perspectives.mjs';

export const PROMPT_KINDS = Object.freeze(['requirement', 'implementation', 'bug', 'plan', 'idea', 'run-change', 'deliverable']);
/** Never checked: a chat message that is not a task. */
export const NON_TASK_KINDS = Object.freeze(['conversation', 'question']);
const ALL_KINDS = new Set([...PROMPT_KINDS, ...NON_TASK_KINDS]);

export const KIND_LABELS = Object.freeze({
  requirement: 'Requirement',
  implementation: 'Implementation task',
  bug: 'Bug report',
  plan: 'Plan',
  idea: 'Idea',
  'run-change': 'Change to a run',
  deliverable: 'Deck, doc or video',
});

/** What a Clear prompt of each kind states (the grading call is told these ids). */
export const KIND_RUBRICS = Object.freeze({
  requirement: Object.freeze(['who', 'problem', 'outcome', 'done-when', 'scope', 'constraints']),
  implementation: Object.freeze(['change', 'where', 'tests', 'done-when']),
  bug: Object.freeze(['steps', 'expected', 'actual', 'where', 'logs', 'frequency']),
  plan: Object.freeze(['shape-check']),
  idea: Object.freeze(['goal']),
  'run-change': Object.freeze(['change']),
  deliverable: Object.freeze(['audience', 'purpose', 'length', 'sources']),
});

export const GRADES = Object.freeze(['clear', 'needs-detail']);
export const GRADE_LABELS = Object.freeze({ clear: 'Clear', 'needs-detail': 'Needs detail' });
export const ASSESS_SIZES = Object.freeze(['small', 'medium', 'large', 'very-large']);
/** The requirement-so-far window: the current message plus 2 earlier task messages. */
export const PROMPT_CHECK_WINDOW = 3;

/** Six kinds start a plain prompt run; `plan` is resolved by taskKindFor through the shape check. */
export const KIND_TO_TASK_KIND = Object.freeze({
  requirement: 'prompt',
  implementation: 'prompt',
  bug: 'prompt',
  plan: 'plan',
  idea: 'prompt',
  'run-change': 'prompt',
  deliverable: 'prompt',
});

const OPEN_DECISIONS_MAX = 6;
const TEXT_MAX = 160;
const MINOR_KINDS_MAX = 2;
const SOURCES = new Set(['model', 'deterministic', 'mock']);
const SHAPE_SIZES = new Set(['small', 'medium', 'large']);
const PERSPECTIVE_SET = new Set(PERSPECTIVE_KEYS);

/** The shape check's size for an assessment size: very-large checks as large; anything else is not passed. */
const shapeSize = (size) => (size === 'very-large' ? 'large' : SHAPE_SIZES.has(size) ? size : undefined);

/**
 * One of TASK_KINDS for a task kind, or null for a non-task or unknown kind (D3). A plan goes through the existing
 * shape check: failed → plan-partial; passed → plan-complete-small when small, else plan-complete-detailed.
 */
export function taskKindFor(kind, text, { size } = {}) {
  const mapped = Object.prototype.hasOwnProperty.call(KIND_TO_TASK_KIND, kind) ? KIND_TO_TASK_KIND[kind] : null;
  if (mapped !== 'plan') return mapped;
  const s = shapeSize(size);
  const passed = checkShape(String(text ?? ''), s ? { size: s } : {}).ok;
  const out = !passed ? 'plan-partial' : size === 'small' ? 'plan-complete-small' : 'plan-complete-detailed';
  return TASK_KINDS.includes(out) ? out : null;
}

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const clip = (s) => s.trim().slice(0, TEXT_MAX);

function perspectivesOf(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    const id = typeof p === 'string' ? p : isObject(p) && typeof p.id === 'string' ? p.id : null;
    if (!id || !PERSPECTIVE_SET.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, reason: isObject(p) && typeof p.reason === 'string' ? clip(p.reason) : '' });
  }
  return out;
}

/**
 * @typedef {{
 *   v: 1,
 *   isTask: boolean,
 *   kind: string|null,
 *   minorKinds: string[],
 *   confidence: number,
 *   grade: 'clear'|'needs-detail'|null,
 *   size: 'small'|'medium'|'large'|'very-large'|null,
 *   openDecisions: string[],
 *   perspectives: {id:string, reason:string}[],
 *   continuesRequirement: boolean|null,
 *   taskKind: string|null,
 *   source: 'model'|'deterministic'|'mock'
 * }} Assessment
 */

/**
 * Any input (a model reply, the browser's deterministic guess, a legacy `assess`) → the full Assessment. Never throws;
 * extra keys are dropped and every string is kept as plain text.
 * @returns {Assessment}
 */
export function normalizeAssessment(raw, { forceTask = false, text = '' } = {}) {
  const r = isObject(raw) ? raw : {};
  let kind = typeof r.kind === 'string' && ALL_KINDS.has(r.kind) ? r.kind : null;
  let isTask;
  if (NON_TASK_KINDS.includes(kind)) {
    if (forceTask) { kind = 'requirement'; isTask = true; } else isTask = false;
  } else isTask = kind !== null || r.isTask === true || forceTask === true;
  const minorKinds = [...new Set(Array.isArray(r.minorKinds) ? r.minorKinds : [])]
    .filter((k) => typeof k === 'string' && PROMPT_KINDS.includes(k) && k !== kind)
    .slice(0, MINOR_KINDS_MAX);
  const c = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  const size = ASSESS_SIZES.includes(r.size) ? r.size : null;
  const openDecisions = (Array.isArray(r.openDecisions) ? r.openDecisions : [])
    .filter((s) => typeof s === 'string' && s.trim())
    .map(clip)
    .slice(0, OPEN_DECISIONS_MAX);
  return {
    v: 1,
    isTask,
    kind,
    minorKinds,
    confidence: Math.round(c * 100) / 100,
    grade: isTask && GRADES.includes(r.grade) ? r.grade : null,
    size,
    openDecisions,
    perspectives: perspectivesOf(r.perspectives),
    continuesRequirement: typeof r.continuesRequirement === 'boolean' ? r.continuesRequirement : null,
    taskKind: isTask && kind ? taskKindFor(kind, text, { size }) : null,
    source: SOURCES.has(r.source) ? r.source : 'deterministic',
  };
}
