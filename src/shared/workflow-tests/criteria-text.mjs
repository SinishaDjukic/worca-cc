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

/** Board 5's card. */
export function checkingSentence(c) {
  const head = `Worca's checking is reliable for ${c.reliable} of ${c.total} criteria.`;
  if (!c.unreliable) return head;
  return c.unreliable === 1 ? `${head} 1 unreliable criterion is shown, but does not decide better or worse.`
    : `${head} ${c.unreliable} unreliable criteria are shown, but do not decide better or worse.`;
}
/** Board 1's card "Can you trust Worca's checking?". */
export function listTrustSentence(c) {
  const head = `Reliable for ${c.reliable} of ${c.total} criteria.`;
  const tail = [c.unreliable ? `${c.unreliable} ${c.unreliable === 1 ? 'is' : 'are'} unreliable` : null,
    c.waiting ? `${c.waiting} ${c.waiting === 1 ? 'needs' : 'need'} your answers` : null].filter(Boolean);
  return tail.length ? `${head} ${tail.join(', ')}.` : head;
}
/** Board 2: the line under a criterion that an exact check can stand in for (D94). */
export const exactLine = (alt) => (alt && alt.kind === 'mentions' ? `Can be checked exactly: the result must contain "${alt.text}".` : 'Can be checked exactly, without AI.');
/** Board 5's title, the tab, the card title. */
export const BY_CRITERION = 'By criterion';
export const BY_EXAMPLE = 'By example';
export const SEE_BY_CRITERION = 'See by criterion';

/** P4-M5: Compare's lines about criteria that did not decide every try, and board 20's line in the criteria phase. */
export const CRITERIA_CHANGED_TEXT = 'Your criteria changed after this test. New criteria show as "Not checked yet" until Worca checks them on these tries.';
export const CHECK_THEM = 'Check them on these tries';
export const NOT_EVERY_TRY = 'Not checked on every try, so it does not decide yet';
export const CHECKING_CRITERIA_TEXT = 'Worca is checking your criteria on these tries… No test of this workflow can start until it is done.';
export const CHECKED_CRITERIA_TEXT = 'Worca checked your criteria on these tries.';
export const CAP_CHECKS_TEXT = 'This test reached its cost limit, so Worca checks nothing more on it. Test again to check your criteria.';
export const ADDED_AFTER_TEXT = 'Added after this test';
export const NO_CHECKED_TRY = 'No checked try';
export const COST_UNKNOWN_NOTE = 'the cost of some checks is not known';
export const CRITERIA_PHASE_TEXT = 'Checking your criteria on earlier tries';
/** "Not checked on every try, so it does not decide yet: "A", "B" in Example 1; "C" in Example 2." (`entries` = notes.notChecked). */
export const notEveryTryText = (entries) => `${NOT_EVERY_TRY}: ${entries.map((e) => `"${e.criteria.join('", "')}" in ${e.name}`).join('; ')}.`;
/** In short (D98): the examples that differ only in unreliable criteria. `b` and `a` are the versions' labels, as In short's other
 *  sentences write them (compare.mjs inShortSentences: "v5 draft is cheaper …"). */
export function unreliableOnlyText(a, b, names) {
  const who = `${b} differs from ${a}`;
  return names.length === 1 ? `${who} on 1 example only in a criterion Worca cannot judge reliably yet: ${names[0]}.`
    : `${who} on ${names.length} examples only in criteria Worca cannot judge reliably yet: ${names.join(', ')}.`;
}
/** The example's row in By example: the criteria it differs in (none known: the words without them). */
export const unreliableWhyText = (labels) => (labels.length ? `Differs only in "${labels.join('", "')}", which Worca cannot judge reliably yet`
  : 'Differs only in criteria Worca cannot judge reliably yet');

/** Board 13: each test's title, what it does, and its result line. */
export const TRUST_TESTS = Object.freeze({
  planted: ['Planted mistakes', 'Worca breaks good results on purpose, for example removes a number or adds a made-up quote, and checks that it notices.'],
  again: ['Asked again', 'The same result is checked 3 times. The verdict should not change.'],
  order: ['Order swapped', 'When Worca picks the better of two results, it sees them in both orders. The winner must not depend on which one comes first.'],
  longer: ['Longer is not better', 'Filler text is added to a result. A longer result must not get a better verdict.'],
  proof: ['Proof for every verdict', 'Each verdict must quote the part of the result it is based on. Worca checks that the quote is really there. Verdicts without proof are not counted.'],
  people: ['Agreement with people', 'From your Agree and Disagree answers and Check the checker.'],
});
export function trustTestLine(t) {
  if (t.state === 'none') return 'Not run yet';
  if (t.key === 'planted') return t.state === 'good' ? `${t.caught} of ${t.of} caught` : `${t.caught} of ${t.of} caught. Missed on "${t.missedOn.join('", "')}".`;
  if (t.key === 'again') return `${t.n} of ${t.of} criteria give the same verdict`;
  if (t.key === 'order') return `Same winner in ${t.n} of ${t.of} pairs`;
  if (t.key === 'longer') return t.fooled ? `${t.fooled} ${t.fooled === 1 ? 'criterion' : 'criteria'} fooled` : 'No criterion fooled';
  if (t.key === 'proof') return `${t.n} of ${t.of} verdicts had proof. ${t.of - t.n} ${t.of - t.n === 1 ? 'was' : 'were'} not counted.`;
  return `${t.pct}% · of ${t.n} answers`;
}

/** P4-C4: the hint under "What to check" for each Part 4 exact kind (board P4-M1). */
export const EXACT_KIND_HINTS = Object.freeze({
  quotes: "Each sentence in quotation marks must appear word for word in the example's files or request. Small differences in spacing and quotation marks are ignored.",
  numbers: "Each number in the result must appear in the example's files or request.",
  'no-personal': 'No e-mail addresses, phone numbers, bank account or card numbers.',
  links: 'Every link in the result opens a real page.',
});
