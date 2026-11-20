// src/core/workflow-tests/criteria-store.mjs — Part 4 storage (plans/workflow-tests-part4-plan.md D95–D97, D101, D106): the checking
// model's answers (judgements); Tasks 8, 12 and 13 add the person's answers, the result you liked and Check the checker rounds.
// Every write validates; reads never throw on bad JSON.
import { createHash } from 'node:crypto';
import { getDb, prepare } from '../db.mjs';
import { criterionKey } from '../../shared/workflow-tests/criteria.mjs';

const parse = (t, f) => { try { const v = JSON.parse(t); return v ?? f; } catch { return f; } };
export const nowIso = () => new Date().toISOString();
const int = (v) => (v == null ? null : Number(v));

/** D95: what judgements and trust are kept by: the criterion's words, normalised (criterionKey), hashed. */
export function criterionFp(text) { return createHash('sha256').update(criterionKey(text)).digest('hex').slice(0, 16); }
/** Errors asked again on the next pass (the limit was reached, the call failed); the others are final for that try. */
export const RETRY_ERRORS = Object.freeze(['limit', 'failed']);

const J_COLS = `id, workflow_id, example_id, criterion_id, criterion_fp, model, purpose, try_id, other_try_id, round_id, card, variant, subject,
  met, winner, reason, proof, proof_found, error, cost_usd, ms, created_at`;
export function judgementOf(r) {
  if (!r) return null;
  return {
    id: Number(r.id), workflowId: r.workflow_id, exampleId: Number(r.example_id), criterionId: r.criterion_id ?? null, fp: r.criterion_fp,
    model: r.model, purpose: r.purpose, tryId: int(r.try_id), otherTryId: int(r.other_try_id), roundId: int(r.round_id), card: int(r.card),
    variant: parse(r.variant, null), subject: r.subject ?? null, met: r.met == null ? null : r.met === 1, winner: r.winner ?? null,
    reason: r.reason ?? null, proof: r.proof ?? null, proofFound: r.proof_found === 1, error: r.error ?? null,
    costUsd: Number(r.cost_usd || 0), ms: int(r.ms), createdAt: r.created_at,
  };
}

/** One answer of the checking model. `j` = judgeCriterion's (or Task 14's judgePair's) result. */
export function insertJudgement({ workflowId, exampleId, criterionId = null, fp, model, purpose, tryId = null, otherTryId = null, roundId = null,
  card = null, variant = null, subject = null, j }) {
  getDb();
  const info = prepare(`INSERT INTO wf_test_judgements (workflow_id, example_id, criterion_id, criterion_fp, model, purpose, try_id, other_try_id,
      round_id, card, variant, subject, met, winner, reason, proof, proof_found, error, cost_usd, ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(workflowId, Number(exampleId), criterionId, fp, model, purpose, tryId, otherTryId, roundId, card, variant ? JSON.stringify(variant) : null,
      subject, j.met == null ? null : (j.met ? 1 : 0), j.winner ?? null, j.reason ?? null, j.proof ?? null, j.proofFound ? 1 : 0, j.error ?? null,
      Number(j.costUsd || 0), Number.isFinite(j.ms) ? Math.round(j.ms) : null, nowIso());
  return readJudgement(Number(info.lastInsertRowid));
}

export function readJudgement(id) {
  getDb();
  return judgementOf(prepare(`SELECT ${J_COLS} FROM wf_test_judgements WHERE id = ?`).get(Number(id)));
}

/** The newest 'try' judgement of each (try, criterion key, model) of these tries. */
export function tryJudgements(tryIds) {
  getDb();
  const ids = [...new Set(tryIds.map(Number).filter(Number.isInteger))];
  if (!ids.length) return [];
  const rows = prepare(`SELECT ${J_COLS} FROM wf_test_judgements WHERE purpose = 'try' AND try_id IN (SELECT value FROM json_each(?))
      ORDER BY id DESC`).all(JSON.stringify(ids)).map(judgementOf);
  const seen = new Set();
  return rows.filter((j) => { const k = `${j.tryId}|${j.fp}|${j.model}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Whether a try still needs this criterion checked by this model: never asked, or the last answer hit the limit or failed. */
export function needsJudging(tryId, fp, model) {
  getDb();
  const r = prepare(`SELECT error FROM wf_test_judgements WHERE purpose = 'try' AND try_id = ? AND criterion_fp = ? AND model = ?
      ORDER BY id DESC LIMIT 1`).get(Number(tryId), fp, model);
  return !r || RETRY_ERRORS.includes(r.error);
}
