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

/** P4-C1, boards 2, 12, 32: a trust mark's badge class and words. */
export const TRUST_BADGE = Object.freeze({
  reliable: ['badge green', 'Reliable'], exact: ['badge green', 'Reliable'], unreliable: ['badge red', 'Unreliable'],
  collecting: ['badge', 'Needs your answers'], confirm: ['badge amber', 'Confirm 4 results'],
});
/** P4-C1: the line beside the badge. */
export function trustLine(t) {
  if (!t) return '';
  if (t.state === 'reliable') return `Worca agrees with people ${t.agree} of ${t.n} times`;
  if (t.state === 'unreliable') return `Agrees with people ${t.agree} of ${t.n} times. Shown, but does not decide better or worse.`;
  if (t.state === 'collecting') return `Worca has ${t.n} of the 10 answers it needs`;
  if (t.state === 'confirm') return 'New criterion. It counts, but you have not confirmed that Worca judges it right.';
  return 'Can be checked exactly, without AI.';
}
