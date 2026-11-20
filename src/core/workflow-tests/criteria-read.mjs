// src/core/workflow-tests/criteria-read.mjs — Part 4 reads (plans/workflow-tests-part4-plan.md D95, D98, D99): trust per criterion key and
// model; Task 9 adds the tries with their criteria and Compare's notes. No model calls here.
import { trustOf } from '../../shared/workflow-tests/criteria.mjs';
import * as cs from './criteria-store.mjs';
import * as store from './store.mjs';
import { compareModel } from '../../shared/workflow-tests/compare.mjs';
import { criterionResult, withCriteria, unreliableOnly, notCheckedEverywhere, finishedTry } from '../../shared/workflow-tests/criteria-verdicts.mjs';

/** D95. `memo` (a Map) keeps one read per key and model inside one page's read. */
export function trustFor(workflowId, fp, model, memo = null) {
  const k = `${fp}|${model}`;
  if (memo && memo.has(k)) return memo.get(k);
  const t = trustOf({ roundDone: cs.roundDone(workflowId, fp, model), answers: cs.answersFor(workflowId, fp, model) });
  if (memo) memo.set(k, t);
  return t;
}

/** D98: tries as the pages read them: with their criteria (the example's current ones, checked by its current model). */
export function withCriteriaFor(workflowId, tries, { withAnswers = false, by = null } = {}) {
  if (!tries.length) return tries;
  const examples = new Map();
  const exOf = (id) => { if (!examples.has(id)) examples.set(id, store.readExample(workflowId, id)); return examples.get(id); };
  const js = new Map(cs.tryJudgements(tries.map((t) => t.id)).map((j) => [`${j.tryId}|${j.fp}|${j.model}`, j]));
  const memo = new Map();
  return withCriteria(tries, (t) => {
    const ex = exOf(t.exampleId);
    const model = ex && ex.judge ? ex.judge.model : null;
    if (!ex || !model || !ex.criteria.length) return null;
    return ex.criteria.map((c) => {
      const fp = cs.criterionFp(c.text);
      const j = js.get(`${t.id}|${fp}|${model}`) || null;
      // I9: the side by side shows the viewer's earlier Agree / Disagree (by = actorOf(req); '' without identities).
      return criterionResult(c, j, trustFor(workflowId, fp, model, memo), { finished: finishedTry(t),
        ...(withAnswers && j ? { answer: cs.answerOf(j.id, by) } : {}) });
    });
  });
}

/** D98, P4-M5: Compare's notes. `input` = compareModel's input whose tries came through withCriteriaFor. */
export function compareNotes(input) {
  const notChecked = notCheckedEverywhere(input.tries, input.examples);   // I6
  if (!input.a) return { unreliableOnly: [], notChecked };
  const shadow = compareModel({ ...input, tries: input.tries.map((t) => (t.shadowStatus ? { ...t, status: t.shadowStatus } : t)) });
  return { unreliableOnly: unreliableOnly(compareModel(input), shadow), notChecked };
}

import { byCriterionModel, checkingCounts } from '../../shared/workflow-tests/criteria-report.mjs';
import { prepare } from '../db.mjs';
import { ratesFor } from '../helper-call/cost.mjs';
import { estimateCost } from '../config.mjs';

/** The trust of each criterion of an example (its current model); exact checks made from a criterion count as 'exact'. */
export function trustOfExample(ex, memo = new Map()) {
  const model = ex.judge ? ex.judge.model : null;
  const out = {};
  for (const c of ex.criteria || []) out[c.id] = model ? trustFor(ex.workflowId, cs.criterionFp(c.text), model, memo) : null;
  return out;
}
/** Boards 1 and 5: the counts over these examples (all of the workflow when `exampleIds` is null). */
export function checkingOf(workflowId, exampleIds = null) {
  const memo = new Map();
  const exs = store.listExamples(workflowId).filter((e) => !exampleIds || exampleIds.includes(e.id));
  return checkingCounts(exs.flatMap((e) => [...Object.values(trustOfExample(e, memo)), ...(e.checks || []).filter((k) => k.said).map(() => ({ state: 'exact' }))]));
}
/** Board 12. `run` = the test (store.readTestRun shape). */
export function byCriterionOf(workflowId, run) {
  const memo = new Map();
  const examples = run.exampleIds.map((id) => store.readExample(workflowId, id)).filter(Boolean)
    .map((e) => ({ id: e.id, name: e.name, criteria: e.criteria, checks: e.checks, trust: trustOfExample(e, memo) }));
  const m = byCriterionModel({ examples, hasA: run.a != null, tries: withCriteriaFor(workflowId, store.triesOfRun(run.id)) });
  return { ...m, counts: checkingOf(workflowId, run.exampleIds) };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** Whether the criteria phase asks the pair question (Task 14 sets it to true when it adds judgePairs). */
const PAIRS_ASKED = false;
/** Board 4: what one check of a criterion costs on `model`: its own last 20, else a typical call (6000 tokens in, 250 out) at its price. */
export function judgeCallUsd(model, { rates = (m) => ratesFor('claude', m), estimate = estimateCost } = {}) {
  const own = prepare(`SELECT amount_usd AS u FROM wf_test_judge_ledger WHERE purpose = 'try' AND model = ? ORDER BY id DESC LIMIT 20`).all(model).map((r) => Number(r.u));
  if (own.length) return median(own);
  const priced = model ? rates(model) : null;
  return priced ? estimate({ input_tokens: 6000, output_tokens: 250 }, priced) : null;
}
/** Board 4 (Task 11): per try, the average cost of checking the chosen examples' criteria; the pairs (2 calls per example that has
 *  criteria, P4-Q8). null when no chosen example has criteria. */
export function criteriaPlanOf(workflowId, exampleIds = [], { hasA = false } = {}) {
  const exs = store.listExamples(workflowId).filter((e) => (!exampleIds.length || exampleIds.includes(e.id)) && e.criteria.length && e.judge);
  if (!exs.length) return null;
  const per = exs.map((e) => { const u = judgeCallUsd(e.judge.model); return u === null ? null : u * e.criteria.length; });
  if (per.some((u) => u === null)) return { perTryUsd: null, pairsUsd: null };
  const all = store.listExamples(workflowId).filter((e) => !exampleIds.length || exampleIds.includes(e.id));
  // M6: pairs are asked only from Task 14 (4b); until then this is 0, and Task 14 changes `PAIRS_ASKED` to true.
  return { perTryUsd: per.reduce((s, u) => s + u, 0) / all.length,
    pairsUsd: PAIRS_ASKED && hasA ? exs.reduce((s, e) => s + 2 * judgeCallUsd(e.judge.model), 0) : 0 };
}
