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
