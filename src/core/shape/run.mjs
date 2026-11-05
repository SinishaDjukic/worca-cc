// src/core/shape/run.mjs — shaped-run helpers: the POST /api/run `shape` field and the plan answer (spec D2, D9).
import { isAbsolute } from 'node:path';
import { SHAPE_WORKFLOW_ID, SHAPE_UX_WORKFLOW_ID, SHAPE_REQ_WORKFLOW_ID, SHAPE_UX_REQ_WORKFLOW_ID, SHAPE_REQ_WORKFLOW_IDS } from '../graph/builtin-workflows.mjs';
import { shapeRequirementsEligible } from '../../shared/shape/requirements.mjs';
import { isAnswererLead, ANSWERER_LEAD_KEYS } from '../../shared/answerer.mjs';
import { normalizePerspectives, DEFAULT_PERSPECTIVES } from '../../shared/shape/perspectives.mjs';
import { normalizeOutline, normalizeEdits, applyOutlineEdits } from '../../shared/shape/slices.mjs';
import { normalizePicks } from '../../shared/review/findings.mjs';
import { validateDecisionPicks } from '../../shared/review/decisions.mjs';

export const PLAN_ASK_KIND = 'plan';
export const PLAN_FEEDBACK_MAX = 8000;
const SHAPE_FIELDS = new Set(['perspectives', 'slices', 'size', 'lead']);
const SHAPE_INTERNAL_FIELDS = new Set(['slice', 'replaces']);   // only a fired slice ticket / a re-plan run carries these
const SLICES_MODES = new Set(['auto', 'off']);
const SIZES = new Set(['small', 'medium', 'large']);

/** shape.slice of a slice ticket (L3); null when malformed. */
function normalizeSliceRef(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = normalizeOutline(raw.outline);
  const { feature, index, total } = raw;
  if (typeof feature !== 'string' || !feature || !o.ok || !Number.isInteger(index) || index < 1
    || total !== o.outline.slices.length || index > total) return null;
  return { feature, index, total, outline: o.outline };
}

export const isShapeWorkflowId = (id) => id === SHAPE_WORKFLOW_ID || id === SHAPE_UX_WORKFLOW_ID || SHAPE_REQ_WORKFLOW_IDS.includes(id);

/**
 * The `shape` field and workflow of a run request. A shaped run always runs wf_shape — wf_shape_ux when UX is a
 * perspective — or, with `requirementsOn` (Labs flag shapeRequirements) for a medium or large task that is not a slice
 * ticket, its requirements variant. A request that names a requirements id it cannot take is refused, never downgraded.
 * `shape.lead` is the person's lead perspective; it joins the perspectives when missing.
 * `internal` (a fired ticket) also admits the `slice` and `replaces` fields.
 * @returns {{ok:true, shape:null|{perspectives:string[], slices?:string, size?:string, slice?:object, replaces?:string}, workflowId:string|null}|{ok:false, error:string}}
 */
export function resolveShapeRequest({ shape, workflowId }, { internal = false, requirementsOn = false } = {}) {
  const named = typeof workflowId === 'string' && workflowId.trim() ? workflowId.trim() : null;
  if (shape === undefined && !isShapeWorkflowId(named)) return { ok: true, shape: null, workflowId: named };
  if (shape !== undefined && (shape === null || typeof shape !== 'object' || Array.isArray(shape))) {
    return { ok: false, error: 'shape must be an object' };
  }
  const allowed = (k) => SHAPE_FIELDS.has(k) || (internal && SHAPE_INTERNAL_FIELDS.has(k));
  const extra = Object.keys(shape || {}).filter((k) => !allowed(k));
  if (extra.length) return { ok: false, error: `shape has unknown field(s): ${extra.join(', ')}` };
  if (named && !isShapeWorkflowId(named)) {
    return { ok: false, error: `a shaped run uses the Shaper workflow (${SHAPE_WORKFLOW_ID}), not "${named}"` };
  }
  if (shape?.lead !== undefined && !isAnswererLead(shape.lead)) {
    return { ok: false, error: `shape.lead must be one of ${ANSWERER_LEAD_KEYS.join(', ')}` };
  }
  const askedP = shape?.perspectives ?? [...DEFAULT_PERSPECTIVES];
  const p = normalizePerspectives(shape?.lead && Array.isArray(askedP) ? [...askedP, shape.lead] : askedP);
  if (!p.ok) return { ok: false, error: p.error };
  if (shape?.slices !== undefined && !SLICES_MODES.has(shape.slices)) return { ok: false, error: 'shape.slices must be "auto" or "off"' };
  if (shape?.size !== undefined && !SIZES.has(shape.size)) return { ok: false, error: 'shape.size must be small, medium or large' };
  let slice = null;
  if (shape?.slice !== undefined) {
    slice = normalizeSliceRef(shape.slice);
    if (!slice) return { ok: false, error: 'shape.slice is malformed' };
  }
  if (shape?.replaces !== undefined && (typeof shape.replaces !== 'string' || !shape.replaces)) {
    return { ok: false, error: 'shape.replaces must be a feature id' };
  }
  const resolved = {
    perspectives: p.perspectives,
    ...(shape?.slices !== undefined ? { slices: shape.slices } : {}),
    ...(shape?.size !== undefined ? { size: shape.size } : {}),
    ...(shape?.lead !== undefined ? { lead: shape.lead } : {}),
    ...(slice ? { slice } : {}),
    ...(shape?.replaces !== undefined ? { replaces: shape.replaces } : {}),
  };
  const ux = p.perspectives.includes('ux');
  if (SHAPE_REQ_WORKFLOW_IDS.includes(named)) {
    if (!requirementsOn) return { ok: false, error: 'the requirements stage is off (Labs flag shapeRequirements)' };
    if (resolved.slice) return { ok: false, error: `a slice ticket runs the Shaper workflow (${SHAPE_WORKFLOW_ID})` };
    if (!shapeRequirementsEligible(resolved, true)) return { ok: false, error: 'the requirements stage needs a medium or large task' };
  }
  const req = shapeRequirementsEligible(resolved, requirementsOn);
  return {
    ok: true,
    shape: resolved,
    workflowId: req ? (ux ? SHAPE_UX_REQ_WORKFLOW_ID : SHAPE_REQ_WORKFLOW_ID) : (ux ? SHAPE_UX_WORKFLOW_ID : SHAPE_WORKFLOW_ID),
  };
}

/** The `plan` ask's validator (RunHarness.answer → 422 on {ok:false}). `conflicts` are the asked round's conflicts:
 *  an optional `raw.conflicts` holds the person's picks for them, on any decision. `decisions` (a criteria hold) are
 *  the hold's decisions: `raw.decisions` picks are checked against them and every decision gets a pick. `error` (an ask
 *  whose files could not be read) admits `retry` and refuses approve. A failing `criteria` check refuses approve too. */
export function validatePlanAnswer(raw, { revisable = false, perspectives = null, conflicts = [], decisions = null, error = false, criteria = null } = {}) {
  const bad = (message) => ({ ok: false, errors: [{ path: 'decision', code: 'invalid', message }] });
  const d = raw && typeof raw === 'object' ? raw.decision : undefined;
  if (error && d === 'retry') return { ok: true, payload: { decision: 'retry' } };
  if (d !== 'approve' && d !== 'stop' && d !== 'revise') return bad('decision must be approve, revise or stop');
  if (error && d === 'approve') return bad('nothing to approve: try again or ask for changes');
  if (criteria && criteria.ok === false && d === 'approve') {
    return bad(`the requirements check has ${criteria.total - criteria.passed} to fix: ask for changes`);
  }
  const picks = raw.conflicts === undefined ? null : normalizePicks(raw.conflicts, conflicts);
  if (picks && !picks.ok) return { ok: false, errors: [{ path: 'conflicts', code: 'invalid', message: picks.error }] };
  const chosen = Array.isArray(decisions) && d !== 'stop' ? validateDecisionPicks(raw.decisions, decisions) : null;
  if (chosen && !chosen.ok) return { ok: false, errors: chosen.errors };
  const withPicks = (payload) => ({ ...payload, ...(picks ? { conflicts: picks.picks } : {}), ...(chosen ? { decisions: chosen.picks } : {}) });
  if (d === 'approve' || d === 'stop') return { ok: true, payload: withPicks({ decision: d }) };
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
  const payload = { decision: 'revise', feedback, ...(source === 'check' ? { source } : {}) };
  if (raw.perspectives !== undefined) {
    const p = normalizePerspectives(raw.perspectives);
    if (!p.ok) return { ok: false, errors: [{ path: 'perspectives', code: 'invalid', message: p.error }] };
    const had = Array.isArray(perspectives) ? perspectives : DEFAULT_PERSPECTIVES;
    if (had.includes('ux') !== p.perspectives.includes('ux')) {
      return { ok: false, errors: [{ path: 'perspectives', code: 'invalid',
        message: 'UX adds or drops the manual-test stages: start a new shaped run to change it' }] };
    }
    payload.perspectives = p.perspectives;
  }
  return { ok: true, payload: withPicks(payload) };
}

/** The outline ask's validator (L4). `outline` is the one asked about; edits are re-applied to it, never trusted. */
export function validateOutlineAnswer(raw, { outline, revisable = false } = {}) {
  const bad = (path, message) => ({ ok: false, errors: [{ path, code: 'invalid', message }] });
  const d = raw && typeof raw === 'object' ? raw.decision : undefined;
  if (d === 'flat' || d === 'stop') return { ok: true, payload: { decision: d } };
  if (d === 'revise') {
    if (!revisable) return bad('decision', 'this outline cannot be revised again: plan slice 1, don\'t slice, or stop');
    const feedback = typeof raw.feedback === 'string' ? raw.feedback.trim() : '';
    if (!feedback) return { ok: false, errors: [{ path: 'feedback', code: 'required', message: 'revise needs feedback text' }] };
    if (feedback.length > PLAN_FEEDBACK_MAX) return { ok: false, errors: [{ path: 'feedback', code: 'too-long', message: `feedback is over ${PLAN_FEEDBACK_MAX} characters` }] };
    return { ok: true, payload: { decision: 'revise', feedback } };
  }
  if (d !== 'approve') return bad('decision', 'decision must be approve, flat, revise or stop');
  const e = normalizeEdits(raw.edits);
  if (!e.ok) return bad('edits', e.error);
  const applied = applyOutlineEdits(outline, e.edits);
  if (!applied.ok) return bad('edits', applied.error);
  if (raw.approveEach !== undefined && typeof raw.approveEach !== 'boolean') return bad('approveEach', 'approveEach must be true or false');
  return { ok: true, payload: { decision: 'approve', ...(e.edits.length ? { edits: e.edits } : {}), approveEach: raw.approveEach === true } };
}

/** state.shaping of a shaped run; `saved` is the resume point's copy (a resumed run keeps its versions). */
export function initialShaping(shape, saved = null) {
  const s = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const feature = shape?.slice ? { id: shape.slice.feature, index: shape.slice.index, total: shape.slice.total }
    : (s.feature && typeof s.feature === 'object' ? { ...s.feature } : null);
  const outline = s.outline && typeof s.outline === 'object' ? structuredClone(s.outline) : null;
  return {
    perspectives: Array.isArray(shape?.perspectives) ? [...shape.perspectives] : [...DEFAULT_PERSPECTIVES],
    rounds: Array.isArray(s.rounds) ? s.rounds.filter((r) => r && Number.isInteger(r.round)).map((r) => ({ ...r })) : [],
    approved: s.approved && typeof s.approved === 'object' ? { ...s.approved } : null,
    savedTo: typeof s.savedTo === 'string' ? s.savedTo : null,
    ...(feature ? { feature } : {}),
    ...(outline ? { outline } : {}),
  };
}

const isPlanPath = (f) => typeof f === 'string' && isAbsolute(f) && /\.md$/i.test(f);

/** The plan file a request means: round N's (versions), else the open plan ask's, else the approved one. Never a
 *  client path. */
export function planFileOf({ pendingQuestion = null, shaping = null } = {}, round = undefined) {
  if (round !== undefined && round !== null && round !== '') {
    const n = Number(round);
    if (!Number.isInteger(n)) return null;
    const row = Array.isArray(shaping?.rounds) ? shaping.rounds.find((r) => r.round === n) : null;
    return isPlanPath(row?.file) ? row.file : null;
  }
  if (pendingQuestion?.kind === PLAN_ASK_KIND && isPlanPath(pendingQuestion.plan?.file)) return pendingQuestion.plan.file;
  return isPlanPath(shaping?.approved?.file) ? shaping.approved.file : null;
}

export const SHAPING_FEEDBACK_PREVIEW = 300;

/** The file a `revise` hands the Planner on its `revise` loop port. */
export function renderPlanFeedback(feedback, planFile) {
  return '# Feedback on the plan\n\n' +
    `The person reviewing the plan${planFile ? ` at \`${planFile}\`` : ''} asked for these changes before ` +
    'anything is built. Treat each point as a major finding.\n\n' +
    `${String(feedback).trim()}\n`;
}
