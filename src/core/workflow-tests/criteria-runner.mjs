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
  const d = { judgeCriterion, judgePair, subjectOf: (t) => subjectOfTry(t), contextOf: (ex) => exampleSourcesText(ex), book: recordTestJudgeCost, ...deps };

  /** The criteria of `example` that the finished try `t` still needs checked by the example's model. */
  const missingOf = (example, t) => {
    const model = example && example.judge ? example.judge.model : null;
    if (!model || !finishedTry(t)) return [];
    return ((example && example.criteria) || []).filter((c) => cs.needsJudging(t.id, cs.criterionFp(c.text), model));
  };
  /** D91: each criterion of `example` that `t` still needs, with the example's model. Returns the new judgements. */
  async function judgeTry(example, t, { testRunId = null, mock = false, stopped = () => false, overCap = () => false } = {}) {
    const model = example && example.judge ? example.judge.model : null;
    const todo = missingOf(example, t);
    if (!todo.length) return [];
    const subject = await d.subjectOf(t);
    const context = d.contextOf(example);
    const out = [];
    for (const c of todo) {
      if (stopped() || overCap()) break;
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
      const budget = () => (overCap() ? { blocked: true } : JUDGE_DEFAULTS.budget());
      const j = await d.judgeCriterion({ criterion: c.text, subject, context, model, mock: mock || !!t.mock, book }, { budget });
      out.push(cs.insertJudgement({ workflowId: example.workflowId, exampleId: example.id, criterionId: c.id, fp, model, purpose: 'try', tryId: t.id, j }));
      if (j.error === 'limit') break;   // the rest wait for the next pass
    }
    return out;
  }

  /** D91: the criteria phase: every finished try the test shows (its own and the reused ones) that still misses a criterion.
   *  P4-M5: `onProgress({ done, of })` before the first and after each such try (board 20's "7 of 12 tries"). */
  async function judgeMissing(run, { stopped = () => false, overCap = () => false, onProgress = null } = {}) {
    const examples = new Map();
    const exampleOf = (id) => { if (!examples.has(id)) examples.set(id, store.readExample(run.workflowId, id)); return examples.get(id); };
    const todo = store.triesOfRun(run.id).filter((t) => (t.status === 'passed' || t.status === 'failed') && missingOf(exampleOf(t.exampleId), t).length);
    const say = (done) => { if (onProgress) onProgress({ done, of: todo.length }); };
    say(0);
    for (const [i, t] of todo.entries()) {
      if (stopped() || overCap()) return;
      await judgeTry(exampleOf(t.exampleId), t, { testRunId: run.id, mock: !!t.mock, stopped, overCap });
      say(i + 1);
    }
    await judgePairs(run, { stopped, overCap });
  }

  /** D100, P4-Q8: one pair per compared example with criteria or a result you liked: the first finished try of each side. */
  async function judgePairs(run, { stopped = () => false, overCap = () => false } = {}) {
    if (run.a == null) return;
    const tries = store.triesOfRun(run.id);
    for (const id of run.exampleIds) {
      if (stopped() || overCap()) return;
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
      // The pair's own budget check also reports "over" when this test's cap is reached (as for a criterion).
      const budget = () => (overCap() ? { blocked: true } : JUDGE_DEFAULTS.budget());
      const j = await d.judgePair({ a: await d.subjectOf(A), b: await d.subjectOf(B), liked: liked ? liked.text : null, context: d.contextOf(ex),
        model: ex.judge.model, mock: !!(A.mock || B.mock), book }, { budget });
      cs.insertJudgement({ workflowId: run.workflowId, exampleId: id, fp, model: ex.judge.model, purpose: 'pair', tryId: A.id, otherTryId: B.id,
        variant: { question: liked ? 'liked' : 'better', swapped: j.swapped }, j });
      if (j.error === 'limit') return;   // the rest wait for the next pass
    }
  }
  return { judgeTry, judgeMissing, judgePairs };
}
