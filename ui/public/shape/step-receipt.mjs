// ui/public/shape/step-receipt.mjs — the receipt a step card leaves once answered (shaper-cards spec §2.2): the decision,
// named ("Plan approved", "Split into 3 runs", "Another cycle started"), never "Answered". Pure naming + a per-tab note
// keyed by run id AND question id (engine ids such as `gate-review-1` repeat across runs and resumes), written by app.js
// postAnswer BEFORE its POST (question-resolved can land before the 200).
import { applyOutlineEdits } from '../../../src/shared/shape/slices.mjs';
import { askKindOf } from '../ask/registry.mjs';
import { clarifyText, planApprovedText, splitText, gateText, NOT_SPLIT_TEXT } from '../../../src/shared/shape/feature-log.mjs';
import { planApprovedLine } from '../log-line.mjs';

const NAMED = new Map();          // `${runId}|${questionId}` → { text, answers }
const NAMED_MAX = 200;

/** The named decision for an answer to `pq`, or null when the kind has no step name (a non-shaping Clarify, a form). */
export function stepReceipt(pq, payload, { shaping = false } = {}) {
  if (!pq) return null;
  const p = payload || {};
  const d = p.decision;
  const kind = askKindOf(pq);
  if (kind === 'gate') return gateText(d);
  if (kind === 'recovery') return d === 'retry' ? 'Retried' : d === 'abort' ? 'Aborted' : 'Paused';
  if (kind === 'plan') {
    const plan = pq.plan || {};
    if (plan.outline) {
      if (d === 'approve') {
        const r = applyOutlineEdits(plan.outline, Array.isArray(p.edits) ? p.edits : []);
        const n = (r.ok ? r.outline : plan.outline).slices.length;
        return splitText(n);
      }
      if (d === 'flat') return NOT_SPLIT_TEXT;
      if (d === 'stop') return 'Stopped at the split';
      return 'Changes asked · Runs';
    }
    if (d === 'approve') {
      // Role reviews (RR): the receipt names the roles and any open issue accepted, as the chat card's own line does.
      const rr = plan.roleReviews;
      if (rr && Array.isArray(rr.rounds) && rr.rounds.length) return planApprovedLine(rr);
      return planApprovedText((Number(plan.round) || 1) - 1);
    }
    if (d === 'stop') return 'Stopped at the plan';
    return Array.isArray(p.perspectives) ? 'Changes asked · perspectives' : 'Changes asked · Plan';
  }
  if (kind === 'clarify' && shaping && Array.isArray(p.answers)) {
    const k = p.answers.filter((a) => a && typeof a.choice === 'string' && a.choice.trim()).length;
    return clarifyText(k);
  }
  return null;
}

const keyOf = (runId, id) => `${runId || ''}|${id}`;

/** Remember what this tab is sending for run `runId`'s `pq` (called before the POST). */
export function noteAnswer(runId, pq, payload, opts) {
  if (!pq || !pq.id) return;
  const text = stepReceipt(pq, payload, opts);
  if (!text) return;
  const key = keyOf(runId, pq.id);
  NAMED.delete(key);
  NAMED.set(key, { text, answers: Array.isArray(payload && payload.answers) ? payload.answers : [] });
  if (NAMED.size > NAMED_MAX) NAMED.delete(NAMED.keys().next().value);
}
export const forgetAnswer = (runId, id) => { NAMED.delete(keyOf(runId, id)); };
export const namedAnswer = (runId, id) => (id ? NAMED.get(keyOf(runId, id)) || null : null);
