// src/core/workflow-tests/criteria-runner.mjs — Part 4 (plans/workflow-tests-part4-plan.md D90, D91): an example's criteria checked on a
// try, and the criteria phase at the end of a test (the reused tries, and any still missing). One failed criterion never stops the
// others; a try is never failed by a check that did not run.
import { recordTestJudgeCost } from '../cost-budget.mjs';
import { mainResult, readTryPatch } from './result.mjs';
import { exampleSourcesText } from './sources-text.mjs';
import { judgeCriterion, judgePair, JUDGE_DEFAULTS } from './judge.mjs';
import { SUBJECT_MAX, CHANGES_HEADING } from './judge-prompt.mjs';
import { finishedTry, pairTriesOf } from '../../shared/workflow-tests/criteria-verdicts.mjs';
import * as store from './store.mjs';
import * as cs from './criteria-store.mjs';
import { tx } from '../db.mjs';

/** D90: what the checking model reads of a try: its main result, and a project try's diff under a heading. */
export async function subjectOfTry(t, { readMain = mainResult, readPatch = readTryPatch } = {}) {
  const m = t && t.pipelineId ? await readMain(t.pipelineId) : { text: null };
  let text = typeof m.text === 'string' ? m.text : '';
  if (t && (t.startCommit || t.changes)) {
    const p = await readPatch(t.pipelineId, SUBJECT_MAX);
    if (p && p.patch) text = `${text}\n\n${CHANGES_HEADING}\n${p.patch}`;
  }
  return text;
}

export function createCriteriaJudge(deps = {}) {
  // `budget`: Worca's spending limit (budgetStatus); the test's own cap is each call's `overCap`.
  const d = { judgeCriterion, judgePair, subjectOf: (t) => subjectOfTry(t), contextOf: (ex) => exampleSourcesText(ex), book: recordTestJudgeCost,
    budget: () => JUDGE_DEFAULTS.budget(), ...deps };
  const blockedNow = () => { try { const b = d.budget(); return !!(b && b.blocked); } catch { return false; } };
  /** Board 59 B: the code of a call a stop cut short (`stopped()` gives the stop's reason: 'person', 'cap', …). The test's own cost cap is
   *  'cap' (review Minor 1), a person's Stop 'stopped'; any other stop leaves the call 'failed'. */
  const cutCode = (said, halted, stopped, overCap) => {
    if (said.error !== 'failed' || !halted()) return said;
    const why = stopped();
    const code = overCap() || why === 'cap' ? 'cap' : why === 'person' ? 'stopped' : null;
    return code ? { ...said, error: code } : said;
  };

  /** The criteria of `example` that the finished try `t` still needs checked by the example's model. */
  const missingOf = (example, t) => {
    const model = example && example.judge ? example.judge.model : null;
    if (!model || !finishedTry(t)) return [];
    return ((example && example.criteria) || []).filter((c) => cs.needsJudging(t.id, cs.criterionFp(c.text), model));
  };
  /** D91: each criterion of `example` that `t` still needs, with the example's model. Returns the new judgements. */
  // Fix round 3 (B): `signal` (the test's stop, or a stop of a criteria-only check) aborts the call in flight; the criteria not
  // finished are left as a stop leaves them (the cut call by cutCode, then leaveUnchecked's sweep at the end of a test).
  async function judgeTry(example, t, { testRunId = null, mock = false, stopped = () => false, overCap = () => false, signal = null } = {}) {
    const halted = () => stopped() || !!(signal && signal.aborted);
    const model = example && example.judge ? example.judge.model : null;
    const todo = missingOf(example, t);
    if (!todo.length) return [];
    const subject = await d.subjectOf(t);
    const context = d.contextOf(example);
    const out = [];
    for (const c of todo) {
      if (halted() || overCap()) break;
      const fp = cs.criterionFp(c.text);
      // Every real call books its spend (D92): judgeCriterion calls book(usd, costKind) as the model answers.
      const book = (usd, costKind) => {
        try {
          return d.book({ workflowId: example.workflowId, exampleId: example.id, testRunId, purpose: 'try', model, amountUsd: usd, costKind });
        } catch (e) {
          // A paid call whose booking failed: the amount would vanish from the cap and the ledger, so say it, then let it surface.
          console.error(`[workflow-tests] spend not recorded: USD ${usd} (${costKind}), model ${model}, workflow ${example.workflowId}, example ${example.id}, test run ${testRunId}: ${e && e.message ? e.message : e}`);
          throw e;
        }
      };
      // The judge may ask twice (an unreadable reply, a missing proof): its own budget check also reports "over" when this test's cap is reached.
      // Task 21 fix round 2: a refusal because of the test's cap is recorded as 'cap', not as Worca's spending limit ('limit').
      let capped = false;
      const budget = () => { if (overCap()) { capped = true; return { blocked: true }; } return d.budget(); };
      const said = await d.judgeCriterion({ criterion: c.text, subject, context, model, mock: mock || !!t.mock, signal, book }, { budget });
      const j = said.error === 'limit' && capped ? { ...said, error: 'cap' } : cutCode(said, halted, stopped, overCap);
      out.push(cs.insertJudgement({ workflowId: example.workflowId, exampleId: example.id, criterionId: c.id, fp, model, purpose: 'try', tryId: t.id, testRunId, j }));
      if (j.error === 'limit' || j.error === 'cap') break;   // the rest wait for the next pass
    }
    return out;
  }

  /** D91: the criteria phase: every finished try the test shows (its own and the reused ones) that still misses a criterion.
   *  P4-M5: `onProgress({ done, of })` before the first and after each such try (board 20's "7 of 12 tries"), then
   *  `onProgress(null)` before the pairs (fix round 1: the line counts earlier tries, never the pair calls). */
  async function judgeMissing(run, { stopped = () => false, overCap = () => false, onProgress = null, signal = null } = {}) {
    const halted = () => stopped() || !!(signal && signal.aborted);
    const examples = new Map();
    const exampleOf = (id) => { if (!examples.has(id)) examples.set(id, store.readExample(run.workflowId, id)); return examples.get(id); };
    const todo = store.triesOfRun(run.id).filter((t) => (t.status === 'passed' || t.status === 'failed') && missingOf(exampleOf(t.exampleId), t).length);
    const say = (done) => { if (onProgress) onProgress(done === null ? null : { done, of: todo.length }); };
    say(0);
    for (const [i, t] of todo.entries()) {
      if (halted() || overCap()) return;
      await judgeTry(exampleOf(t.exampleId), t, { testRunId: run.id, mock: !!t.mock, stopped, overCap, signal });
      if (!halted()) say(i + 1);   // board 59 C: a try a stop cut short is not counted as checked ("Worca checked N of M tries")
    }
    say(null);
    await judgePairs(run, { stopped: halted, overCap, signal });
  }

  /**
   * Fix rounds 1, 2 (P4-M5): at the end of a test, each criterion of a finished try that nothing checked gets a row with met null,
   * no cost and an error from the state at the end: 'cap' when the test is at its own cost limit (`overCap()`), else 'limit' when
   * Worca's spending limit blocks checks (`d.budget()`), else 'pending' after a person's Stop (`stopReason` 'person', board 59 B: what
   * the stop never reached reads "Not checked yet"), else 'failed' (another stop, a call that threw). `error` forces one (boot: 'failed').
   * The criterion existed while the test ran, so Compare calls it 'unchecked', never 'new' (criteria-read.mjs reasonOfCriterion); a
   * later pass still checks it (cs.RETRY_ERRORS). Never a model call, never a booking. A try that already has a row for it keeps it.
   * One transaction: nothing else may run one around it (db.mjs tx is not nested).
   */
  function leaveUnchecked(run, { error = null, overCap = () => false, stopReason = null } = {}) {
    const tries = store.triesOfRun(run.id).filter((t) => (t.status === 'passed' || t.status === 'failed') && finishedTry(t));
    const had = new Set(cs.tryJudgements(tries.map((t) => t.id)).map((j) => `${j.tryId}|${j.fp}|${j.model}`));
    const examples = new Map();
    const rows = [];
    for (const t of tries) {
      if (!examples.has(t.exampleId)) examples.set(t.exampleId, store.readExample(run.workflowId, t.exampleId));
      const ex = examples.get(t.exampleId);
      const model = ex && ex.judge ? ex.judge.model : null;
      if (!model) continue;
      for (const c of ex.criteria || []) {
        const fp = cs.criterionFp(c.text);
        if (!had.has(`${t.id}|${fp}|${model}`)) rows.push({ workflowId: run.workflowId, exampleId: ex.id, criterionId: c.id, fp, model, purpose: 'try', tryId: t.id, testRunId: run.id });
      }
    }
    if (!rows.length) return;
    const code = error || (overCap() ? 'cap' : blockedNow() ? 'limit' : stopReason === 'person' ? 'pending' : 'failed');
    tx(() => { for (const r of rows) cs.insertJudgement({ ...r, j: { met: null, error: code } }); });
  }

  /** D100, P4-Q8: one pair per compared example with criteria or a result you liked: the first finished try of each side. */
  async function judgePairs(run, { stopped = () => false, overCap = () => false, signal = null } = {}) {
    if (run.a == null) return;
    const tries = store.triesOfRun(run.id);
    for (const id of run.exampleIds) {
      if (stopped() || (signal && signal.aborted) || overCap()) return;
      const ex = store.readExample(run.workflowId, id);
      const liked = ex ? cs.readLiked(ex.id) : null;
      if (!ex || !ex.judge || (!ex.criteria.length && !liked)) continue;
      const { A, B } = pairTriesOf(tries, id);
      if (!A || !B) continue;
      const fp = cs.pairFp(liked ? cs.likedSha(ex.id) : null);
      const had = cs.pairJudgement(A.id, B.id);
      if (had && had.fp === fp && !cs.RETRY_ERRORS.includes(had.error)) continue;
      const book = (usd, costKind) => {
        try {
          return d.book({ workflowId: run.workflowId, exampleId: id, testRunId: run.id, purpose: 'pair', model: ex.judge.model, amountUsd: usd, costKind });
        } catch (e) {
          console.error(`[workflow-tests] spend not recorded: USD ${usd} (${costKind}), model ${ex.judge.model}, workflow ${run.workflowId}, example ${id}, test run ${run.id}: ${e && e.message ? e.message : e}`);
          throw e;
        }
      };
      // The pair's own budget check also reports "over" when this test's cap is reached (as for a criterion). Fix round 4 (leftover 3):
      // a refusal because of the test's cap is recorded as 'cap', not as Worca's spending limit ('limit'), as judgeTry does.
      let capped = false;
      const budget = () => { if (overCap()) { capped = true; return { blocked: true }; } return d.budget(); };
      // Fix round 3 (final review M8): the first order's answer a cut-short pass kept on its row (same question and model) is not asked again.
      const first = had && had.fp === fp && had.model === ex.judge.model && had.variant && had.variant.first ? had.variant.first : null;
      const said = await d.judgePair({ a: await d.subjectOf(A), b: await d.subjectOf(B), liked: liked ? liked.text : null, context: d.contextOf(ex),
        model: ex.judge.model, mock: !!(A.mock || B.mock), signal, book, ...(first ? { first } : {}) }, { budget });
      const j = said.error === 'limit' && capped ? { ...said, error: 'cap' } : cutCode(said, () => stopped() || !!(signal && signal.aborted), stopped, overCap);
      cs.insertJudgement({ workflowId: run.workflowId, exampleId: id, fp, model: ex.judge.model, purpose: 'pair', tryId: A.id, otherTryId: B.id, testRunId: run.id,
        variant: { question: liked ? 'liked' : 'better', swapped: j.swapped, ...(j.first ? { first: j.first } : {}) }, j });
      if (j.error === 'limit' || j.error === 'cap') return;   // the rest wait for the next pass
    }
  }
  return { judgeTry, judgeMissing, judgePairs, leaveUnchecked };
}
