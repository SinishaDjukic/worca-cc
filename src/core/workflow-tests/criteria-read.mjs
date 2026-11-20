// src/core/workflow-tests/criteria-read.mjs — Part 4 reads (plans/workflow-tests-part4-plan.md D95, D98, D99): trust per criterion key and
// model; Task 9 adds the tries with their criteria and Compare's notes. No model calls here.
import { trustOf } from '../../shared/workflow-tests/criteria.mjs';
import * as cs from './criteria-store.mjs';

/** D95. `memo` (a Map) keeps one read per key and model inside one page's read. */
export function trustFor(workflowId, fp, model, memo = null) {
  const k = `${fp}|${model}`;
  if (memo && memo.has(k)) return memo.get(k);
  const t = trustOf({ roundDone: cs.roundDone(workflowId, fp, model), answers: cs.answersFor(workflowId, fp, model) });
  if (memo) memo.set(k, t);
  return t;
}
