// src/core/shape/run.mjs — shaped-run helpers: the POST /api/run `shape` field and the plan answer (spec D2, D9).
import { SHAPE_WORKFLOW_ID, SHAPE_UX_WORKFLOW_ID } from '../graph/builtin-workflows.mjs';
import { normalizePerspectives, DEFAULT_PERSPECTIVES } from '../../shared/shape/perspectives.mjs';

export const PLAN_ASK_KIND = 'plan';
export const PLAN_FEEDBACK_MAX = 8000;
const SHAPE_FIELDS = new Set(['perspectives']);   // slice 4 adds `slices`

export const isShapeWorkflowId = (id) => id === SHAPE_WORKFLOW_ID || id === SHAPE_UX_WORKFLOW_ID;

/**
 * The `shape` field and workflow of a run request. A shaped run always runs wf_shape — wf_shape_ux when UX is a
 * perspective. Gate off: both `shape` and the shape workflows are refused.
 * @returns {{ok:true, shape:null|{perspectives:string[]}, workflowId:string|null}|{ok:false, error:string}}
 */
export function resolveShapeRequest({ shape, workflowId }, { enabled }) {
  const named = typeof workflowId === 'string' && workflowId.trim() ? workflowId.trim() : null;
  if (shape === undefined && !isShapeWorkflowId(named)) return { ok: true, shape: null, workflowId: named };
  if (!enabled) {
    return { ok: false, error: shape !== undefined ? 'shape is not available on this server' : `workflow "${named}" is not available on this server` };
  }
  if (shape !== undefined && (shape === null || typeof shape !== 'object' || Array.isArray(shape))) {
    return { ok: false, error: 'shape must be an object' };
  }
  const extra = Object.keys(shape || {}).filter((k) => !SHAPE_FIELDS.has(k));
  if (extra.length) return { ok: false, error: `shape has unknown field(s): ${extra.join(', ')}` };
  if (named && !isShapeWorkflowId(named)) {
    return { ok: false, error: `a shaped run uses the Shape it first workflow (${SHAPE_WORKFLOW_ID}), not "${named}"` };
  }
  const p = normalizePerspectives(shape?.perspectives ?? [...DEFAULT_PERSPECTIVES]);
  if (!p.ok) return { ok: false, error: p.error };
  return {
    ok: true,
    shape: { perspectives: p.perspectives },
    workflowId: p.perspectives.includes('ux') ? SHAPE_UX_WORKFLOW_ID : SHAPE_WORKFLOW_ID,
  };
}

/** The `plan` ask's validator (RunHarness.answer → 422 on {ok:false}). */
export function validatePlanAnswer(raw, { revisable = false } = {}) {
  const bad = (message) => ({ ok: false, errors: [{ path: 'decision', code: 'invalid', message }] });
  const d = raw && typeof raw === 'object' ? raw.decision : undefined;
  if (d === 'approve' || d === 'stop') return { ok: true, payload: { decision: d } };
  if (d !== 'revise') return bad('decision must be approve, revise or stop');
  if (!revisable) return bad('this plan cannot be revised');
  const feedback = typeof raw.feedback === 'string' ? raw.feedback.trim() : '';
  if (!feedback) return { ok: false, errors: [{ path: 'feedback', code: 'required', message: 'revise needs feedback text' }] };
  if (feedback.length > PLAN_FEEDBACK_MAX) {
    return { ok: false, errors: [{ path: 'feedback', code: 'too-long', message: `feedback is over ${PLAN_FEEDBACK_MAX} characters` }] };
  }
  const source = raw.source === undefined ? 'person' : raw.source;
  if (source !== 'person' && source !== 'check') {
    return { ok: false, errors: [{ path: 'source', code: 'invalid', message: 'source must be person or check' }] };
  }
  return { ok: true, payload: { decision: 'revise', feedback, ...(source === 'check' ? { source } : {}) } };
}

/** The file a `revise` hands the Planner on its `revise` loop port. */
export function renderPlanFeedback(feedback, planFile) {
  return '# Feedback on the plan\n\n' +
    `The person reviewing the plan${planFile ? ` at \`${planFile}\`` : ''} asked for these changes before ` +
    'anything is built. Treat each point as a major finding.\n\n' +
    `${String(feedback).trim()}\n`;
}
