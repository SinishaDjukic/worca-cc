// src/core/workflow-tests/criteria-runner.mjs — Part 4 (plans/workflow-tests-part4-plan.md D90, D91): an example's criteria checked on a
// try, and the criteria phase at the end of a test (the reused tries, and any still missing). One failed criterion never stops the
// others; a try is never failed by a check that did not run.
import { recordTestJudgeCost } from '../cost-budget.mjs';
import { mainResult, readTryPatch } from './result.mjs';
import { exampleSourcesText } from './sources-text.mjs';
import { judgeCriterion, judgePair, JUDGE_DEFAULTS } from './judge.mjs';
import { SUBJECT_MAX, CHANGES_HEADING } from './judge-prompt.mjs';
import { finishedTry } from '../../shared/workflow-tests/criteria-verdicts.mjs';
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

  /** D91: each criterion of `example` that `t` still needs, with the example's model. Returns the new judgements. */
  async function judgeTry(example, t, { testRunId = null, mock = false, stopped = () => false, overCap = () => false } = {}) {
    const criteria = (example && example.criteria) || [];
    const model = example && example.judge ? example.judge.model : null;
    if (!criteria.length || !model || !finishedTry(t)) return [];
    const todo = criteria.filter((c) => cs.needsJudging(t.id, cs.criterionFp(c.text), model));
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

  /** D91: the criteria phase: every finished try the test shows (its own and the reused ones) that still misses a criterion. */
  async function judgeMissing(run, { stopped = () => false, overCap = () => false } = {}) {
    const examples = new Map();
    const exampleOf = (id) => { if (!examples.has(id)) examples.set(id, store.readExample(run.workflowId, id)); return examples.get(id); };
    for (const t of store.triesOfRun(run.id)) {
      if (stopped() || overCap()) return;
      if (t.status !== 'passed' && t.status !== 'failed') continue;
      const ex = exampleOf(t.exampleId);
      if (ex) await judgeTry(ex, t, { testRunId: run.id, mock: !!t.mock, stopped, overCap });
    }
    await judgePairs(run, { stopped, overCap });
  }

  /** D100, P4-Q8: one pair per compared example with criteria or a result you liked: the first finished try of each side. */
  async function judgePairs(run, { stopped = () => false, overCap = () => false } = {}) {
    if (run.a == null) return;
    const tries = store.triesOfRun(run.id).filter((t) => (t.status === 'passed' || t.status === 'failed') && finishedTry(t));
    for (const id of run.exampleIds) {
      if (stopped() || overCap()) return;
      const ex = store.readExample(run.workflowId, id);
      const liked = ex ? cs.readLiked(ex.id) : null;
      if (!ex || !ex.judge || (!ex.criteria.length && !liked)) continue;
      const first = (side) => tries.filter((t) => t.exampleId === id && t.side === side).sort((x, y) => x.tryNo - y.tryNo)[0] || null;
      const A = first('a'); const B = first('b');
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
