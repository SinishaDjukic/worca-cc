// src/shared/workflow-tests/criteria-text.mjs — Part 4's words (plans/workflow-tests-part4-plan.md P4-C1–C7 and the boards). Pure.
// Plain words only (D103): never "judge", "score" or "confidence".

/** P4-C2: a criterion that does not decide a try, and why. */
export const NOT_CHECKED = Object.freeze({
  pending: 'Not checked yet',
  'not-finished': 'Not checked: the try did not finish',
  limit: 'Not checked: the spending limit is reached',
  'no-result': 'Not checked: the try left no result',
  unreadable: "Not checked: Worca's answer could not be read",
  'no-proof': "Not checked: Worca's proof was not in the result",
  failed: 'Not checked: the check did not run',
});
