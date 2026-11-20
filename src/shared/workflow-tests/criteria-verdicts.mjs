// src/shared/workflow-tests/criteria-verdicts.mjs — Part 4 (plans/workflow-tests-part4-plan.md D91, D98): which tries are checked, and
// (Task 9) a criterion's result on one try and the status a try has with its criteria. Pure and browser-safe.

/** D91, P4-Q5: a try whose run finished (its stored verdict says so) and that Worca did not set aside. */
export const finishedTry = (t) => !!(t && t.verdict && t.verdict.facts && t.verdict.facts.status === 'done' && !t.verdict.worcaProblem);
