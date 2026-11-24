// src/core/workflow-tests/criteria-store.mjs — Part 4 storage (plans/workflow-tests-part4-plan.md D95–D97, D101, D106): the checking
// model's answers (judgements); Tasks 8, 12 and 13 add the person's answers, the result you liked and Check the checker rounds.
// Every write validates; reads never throw on bad JSON.
import { createHash } from 'node:crypto';
import { getDb, prepare } from '../db.mjs';
import { criterionKey } from '../../shared/workflow-tests/criteria.mjs';
import { RETRY_ERRORS } from '../../shared/workflow-tests/criteria-verdicts.mjs';
import { testError } from './store.mjs';

const parse = (t, f) => { try { const v = JSON.parse(t); return v ?? f; } catch { return f; } };
export const nowIso = () => new Date().toISOString();
const int = (v) => (v == null ? null : Number(v));

/** D95: what judgements and trust are kept by: the criterion's words, normalised (criterionKey), hashed. */
export function criterionFp(text) { return createHash('sha256').update(criterionKey(text)).digest('hex').slice(0, 16); }
/** Errors asked again on the next pass: the one list the cells use too (criteria-verdicts.mjs), final review M6. */
export { RETRY_ERRORS };

const J_COLS = `id, workflow_id, example_id, criterion_id, criterion_fp, model, purpose, try_id, other_try_id, round_id, card, variant, subject,
  met, winner, reason, proof, proof_found, error, cost_usd, ms, created_at, test_run_id`;
export function judgementOf(r) {
  if (!r) return null;
  return {
    id: Number(r.id), workflowId: r.workflow_id, exampleId: Number(r.example_id), criterionId: r.criterion_id ?? null, fp: r.criterion_fp,
    model: r.model, purpose: r.purpose, tryId: int(r.try_id), otherTryId: int(r.other_try_id), roundId: int(r.round_id), card: int(r.card),
    variant: parse(r.variant, null), subject: r.subject ?? null, met: r.met == null ? null : r.met === 1, winner: r.winner ?? null,
    reason: r.reason ?? null, proof: r.proof ?? null, proofFound: r.proof_found === 1, error: r.error ?? null,
    costUsd: Number(r.cost_usd || 0), ms: int(r.ms), createdAt: r.created_at, testRunId: int(r.test_run_id),
  };
}

/** One answer of the checking model. `j` = judgeCriterion's (or Task 14's judgePair's) result. `testRunId`: the test that wrote it (fix
 *  round 3, M7: a 'cap' or 'limit' row is worded only on that test). */
export function insertJudgement({ workflowId, exampleId, criterionId = null, fp, model, purpose, tryId = null, otherTryId = null, roundId = null,
  card = null, variant = null, subject = null, testRunId = null, j }) {
  getDb();
  const info = prepare(`INSERT INTO wf_test_judgements (workflow_id, example_id, criterion_id, criterion_fp, model, purpose, try_id, other_try_id,
      round_id, card, variant, subject, met, winner, reason, proof, proof_found, error, cost_usd, ms, created_at, test_run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(workflowId, Number(exampleId), criterionId, fp, model, purpose, tryId, otherTryId, roundId, card, variant ? JSON.stringify(variant) : null,
      subject, j.met == null ? null : (j.met ? 1 : 0), j.winner ?? null, j.reason ?? null, j.proof ?? null, j.proofFound ? 1 : 0, j.error ?? null,
      Number(j.costUsd || 0), Number.isFinite(j.ms) ? Math.round(j.ms) : null, nowIso(), testRunId == null ? null : Number(testRunId));
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

const byKey = (by) => (typeof by === 'string' ? by : '');
/** D96: the person's answer on one verdict: true = agree (Right), false = disagree (Wrong); a later one replaces it; null removes it. */
export function setAnswer(judgementId, { agree, by = null }) {
  getDb();
  if (agree === null) {
    prepare('DELETE FROM wf_test_judge_answers WHERE judgement_id = ? AND by_key = ?').run(Number(judgementId), byKey(by));
    return;
  }
  prepare(`INSERT INTO wf_test_judge_answers (judgement_id, by_key, agree, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(judgement_id, by_key) DO UPDATE SET agree = excluded.agree, created_at = excluded.created_at`)
    .run(Number(judgementId), byKey(by), agree ? 1 : 0, nowIso());
}
export function answerOf(judgementId, by = null) {
  getDb();
  const r = prepare('SELECT agree FROM wf_test_judge_answers WHERE judgement_id = ? AND by_key = ?').get(Number(judgementId), byKey(by));
  return r ? r.agree === 1 : null;
}
/** I9: anyone's newest answer on one verdict (the trust report's "unless the person said that is right" reads it, whoever views). */
export function latestAnswerOf(judgementId) {
  getDb();
  const r = prepare('SELECT agree FROM wf_test_judge_answers WHERE judgement_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(Number(judgementId));
  return r ? r.agree === 1 : null;
}
/** D95: every answer on a criterion key and model in a workflow, as `{ judgeMet, agree }`. Pairs and repeats never count. */
export function answersFor(workflowId, fp, model) {
  getDb();
  return prepare(`SELECT j.met AS met, a.agree AS agree FROM wf_test_judge_answers a JOIN wf_test_judgements j ON j.id = a.judgement_id
      WHERE j.workflow_id = ? AND j.criterion_fp = ? AND j.model = ? AND j.purpose IN ('try', 'real', 'planted') AND j.met IS NOT NULL`)
    .all(workflowId, fp, model).map((r) => ({ judgeMet: r.met === 1, agree: r.agree === 1 }));
}
/** D95: a Check the checker round of this key and model is done (all four cards answered). */
export function roundDone(workflowId, fp, model) {
  getDb();
  return !!prepare(`SELECT 1 FROM wf_test_checker_rounds WHERE workflow_id = ? AND criterion_fp = ? AND model = ? AND status = 'done' LIMIT 1`)
    .get(workflowId, fp, model);
}

export const LIKED_MAX = 2 * 1024 * 1024;
const UTF8 = new TextDecoder('utf-8', { fatal: true });
/** D101: the example's one result you liked; a new one replaces it. `kind` 'text' | 'changes'. */
export function putLiked(exampleId, { kind = 'text', name, data, fromPipeline = null }) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  if (!buf.length) throw testError('the result you liked is empty', 'BAD_REQUEST');
  if (buf.length > LIKED_MAX) throw testError('the result you liked is larger than 2 MB', 'BAD_REQUEST');
  try { UTF8.decode(buf); } catch { throw testError('the result you liked must be a text file', 'BAD_REQUEST'); }
  const clean = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (!['text', 'changes'].includes(kind)) throw testError('the result you liked is text or changes', 'BAD_REQUEST');
  if (!clean) throw testError('give the result you liked a name', 'BAD_REQUEST');
  getDb();
  prepare(`INSERT INTO wf_test_liked (example_id, kind, name, data, sha256, size, from_pipeline, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(example_id) DO UPDATE SET kind = excluded.kind, name = excluded.name, data = excluded.data, sha256 = excluded.sha256,
      size = excluded.size, from_pipeline = excluded.from_pipeline, created_at = excluded.created_at`)
    .run(Number(exampleId), kind, clean, buf, createHash('sha256').update(buf).digest('hex'), buf.length, fromPipeline, nowIso());
}
export function readLiked(exampleId) {
  getDb();
  const r = prepare('SELECT kind, name, data, from_pipeline FROM wf_test_liked WHERE example_id = ?').get(Number(exampleId));
  return r ? { kind: r.kind, name: r.name, text: Buffer.from(r.data).toString('utf8'), fromPipeline: r.from_pipeline ?? null } : null;
}
export function deleteLiked(exampleId) { getDb(); prepare('DELETE FROM wf_test_liked WHERE example_id = ?').run(Number(exampleId)); }

const R_COLS = 'id, workflow_id, example_id, criterion_id, criterion_fp, model, source, status, detail, created_by, created_at, finished_at';
const roundOf = (r) => (r ? { id: Number(r.id), workflowId: r.workflow_id, exampleId: Number(r.example_id), criterionId: r.criterion_id, fp: r.criterion_fp,
  model: r.model, source: parse(r.source, {}), status: r.status, detail: r.detail ?? null, createdBy: r.created_by ?? null, createdAt: r.created_at,
  finishedAt: r.finished_at ?? null } : null);
export function createRound({ workflowId, exampleId, criterionId, fp, model, source, by = null }) {
  getDb();
  const info = prepare(`INSERT INTO wf_test_checker_rounds (workflow_id, example_id, criterion_id, criterion_fp, model, source, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'making', ?, ?)`).run(workflowId, Number(exampleId), criterionId, fp, model, JSON.stringify(source), by, nowIso());
  return readRound(Number(info.lastInsertRowid));
}
export function readRound(id) { getDb(); return roundOf(prepare(`SELECT ${R_COLS} FROM wf_test_checker_rounds WHERE id = ?`).get(Number(id))); }
export function updateRound(id, { status, detail = null }) {
  getDb();
  const end = status === 'making' ? null : nowIso();
  prepare('UPDATE wf_test_checker_rounds SET status = ?, detail = ?, finished_at = ? WHERE id = ?').run(status, detail, end, Number(id));
  return readRound(id);
}
export function roundJudgements(roundId) {
  getDb();
  return prepare(`SELECT ${J_COLS} FROM wf_test_judgements WHERE round_id = ? ORDER BY id`).all(Number(roundId)).map(judgementOf);
}
/** What a round's calls cost; `purpose` 'checker': only the round's own calls (its copies and checks), not its clearer words. */
export function roundSpentUsd(roundId, { purpose = null } = {}) {
  getDb();
  if (purpose) return Number(prepare('SELECT COALESCE(SUM(amount_usd), 0) AS s FROM wf_test_judge_ledger WHERE round_id = ? AND purpose = ?').get(Number(roundId), purpose).s || 0);
  return Number(prepare('SELECT COALESCE(SUM(amount_usd), 0) AS s FROM wf_test_judge_ledger WHERE round_id = ?').get(Number(roundId)).s || 0);
}
/** P4-Q17: some call of the round reported no cost (booked as a $0 'unknown' row). */
export function roundCostUnknown(roundId) {
  getDb();
  return !!prepare("SELECT 1 FROM wf_test_judge_ledger WHERE round_id = ? AND cost_kind = 'unknown' LIMIT 1").get(Number(roundId));
}
/** M18: at boot, a round left 'making' by a restart is failed (its calls stopped with the old process). Returns how many. */
export function recoverRounds() {
  getDb();
  return Number(prepare(`UPDATE wf_test_checker_rounds SET status = 'failed', detail = 'Worca restarted before this round was ready. Try again.',
      finished_at = ? WHERE status = 'making'`).run(nowIso()).changes || 0);
}

/** D100: a pair's key: "better overall", or "closer to" one liked result (its sha256, so a new liked result asks again). */
export const PAIR_BETTER = 'pair:better';
export const pairFp = (likedSha = null) => (likedSha ? `pair:liked:${String(likedSha).slice(0, 16)}` : PAIR_BETTER);
/** The newest pair answer of these two tries (A, B), or null. */
export function pairJudgement(tryA, tryB) {
  getDb();
  return judgementOf(prepare(`SELECT ${J_COLS} FROM wf_test_judgements WHERE purpose = 'pair' AND try_id = ? AND other_try_id = ? ORDER BY id DESC LIMIT 1`)
    .get(Number(tryA), Number(tryB)));
}
export function likedSha(exampleId) {
  getDb();
  const r = prepare('SELECT sha256 FROM wf_test_liked WHERE example_id = ?').get(Number(exampleId));
  return r ? r.sha256 : null;
}

/** The newest round per criterion key and model in a workflow that is ready or done. */
export function latestRounds(workflowId) {
  getDb();
  return prepare(`SELECT ${R_COLS} FROM wf_test_checker_rounds r WHERE workflow_id = ? AND status IN ('ready', 'done')
      AND id = (SELECT MAX(id) FROM wf_test_checker_rounds x WHERE x.workflow_id = r.workflow_id AND x.criterion_fp = r.criterion_fp AND x.model = r.model
      AND x.status IN ('ready', 'done'))`).all(workflowId).map(roundOf);
}
/** `live` = the keys `${exampleId}|${model}` of the examples that still exist with their current model. */
export function pairJudgements(workflowId, live = null) {
  getDb();
  return prepare(`SELECT ${J_COLS} FROM wf_test_judgements WHERE workflow_id = ? AND purpose = 'pair' AND winner IS NOT NULL`).all(workflowId).map(judgementOf)
    .filter((j) => !live || live.has(`${j.exampleId}|${j.model}`));
}
/** `live` = the keys `${fp}|${model}` of the criteria as they stand; null counts everything. */
export function tryProofCounts(workflowId, live = null) {
  getDb();
  const r = prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(proof_found), 0) AS f FROM wf_test_judgements WHERE workflow_id = ? AND purpose = 'try'
      AND (met IS NOT NULL OR error = 'no-proof') AND (? IS NULL OR criterion_fp || '|' || model IN (SELECT value FROM json_each(?)))`)
    .get(workflowId, live ? JSON.stringify([...live]) : null, live ? JSON.stringify([...live]) : null);
  return { found: Number(r.f || 0), of: Number(r.n || 0) };
}
