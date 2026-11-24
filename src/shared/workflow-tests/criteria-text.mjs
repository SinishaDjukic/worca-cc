// src/shared/workflow-tests/criteria-text.mjs — Part 4's words (plans/workflow-tests-part4-plan.md P4-C1–C7 and the boards). Pure.
// Plain words only (D103): never "judge", "score" or "confidence".

/** P4-C2: a criterion that does not decide a try, and why. */
export const NOT_CHECKED = Object.freeze({
  pending: 'Not checked yet',
  'not-finished': 'Not checked: the try did not finish',
  limit: 'Not checked: the spending limit is reached',
  cap: 'Not checked: this test reached its cost limit',   // Task 21 fix round 2: the test's own cap (Compare's band words)
  'no-result': 'Not checked: the try left no result',
  unreadable: "Not checked: Worca's answer could not be read",
  'no-proof': "Not checked: Worca's proof was not in the result",
  failed: 'Not checked: the check did not run',
  stopped: 'Not checked: you stopped the check',   // board 59 B: a check a person's Stop cut short
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

/** Board 5's line: the words after its bold "Worca's checking" (checkingSentence without them). */
export function checkingRest(c) {
  const head = ` is reliable for ${c.reliable} of ${c.total} criteria.`;
  if (!c.unreliable) return head;
  return c.unreliable === 1 ? `${head} 1 unreliable criterion is shown, but does not decide better or worse.`
    : `${head} ${c.unreliable} unreliable criteria are shown, but do not decide better or worse.`;
}
/** Board 5's card. */
export const checkingSentence = (c) => `Worca's checking${checkingRest(c)}`;
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
/** Board 58 (B · Messages): the refusal of a test while that check runs, and the Tests list's hint on its disabled Test (final review M3);
 *  board 59 C: also the band in Compare while it runs. */
export const CHECKING_TEXT = 'Worca is checking your criteria on these tries. A test can start when it is done.';
/** Board 59 C: the band's button, and its line after a stop (`done` of `of` tries checked). */
export const STOP_CHECKING = 'Stop checking';
export const stoppedCheckText = (done, of) => `You stopped the check. Worca checked ${done} of ${of} tries; the rest read "Not checked yet".`;
export const CHECKED_CRITERIA_TEXT = 'Worca checked your criteria on these tries.';
export const CAP_CHECKS_TEXT = 'This test reached its cost limit, so Worca checks nothing more on it. Test again to check your criteria.';
export const ADDED_AFTER_TEXT = 'Added after this test';
export const NO_CHECKED_TRY = 'No checked try';
export const COST_UNKNOWN_NOTE = 'the cost of some checks is not known';
/** P4-M3: Check the checker's refusals (checker.mjs throws them; the page tells them apart). */
export const NO_SOURCE_TEXT = 'Try this example once first, so Worca has a good result to break.';
/** Board 59 A: the example was tried, but no try passed (nothing liked, no good run either). */
export const NO_PASSED_TRY_TEXT = 'No try of this example passed yet, so Worca has no good result to break. Pick a result you liked, or fix what fails and try again.';
/** The words of Task 11's check route when the total spending limit is already reached. */
export const LIMIT_TEXT = 'Total cost limit reached — nothing was sent to the model. Raise the limit in worca Settings.';
/** Board 58: a Check the checker round that did not finish (its answers are refused, and the page says so). */
export const ROUND_NOT_FINISHED_TEXT = 'This round did not finish. Start a new round.';
/** User decision 2026-11-22: Check the checker refused because the good result's written text is over the planting limit (planted.mjs
 *  PLANT_RESULT_MAX); no round, no call. */
export const TOO_LONG_TEXT = 'This result is too long for Worca to break on purpose. Check the checker works on results up to about 40,000 characters.';
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
  // A real round has the checking model break the criterion everywhere it is met (checker.mjs plantCopies); only a mock round uses
  // Worca's own simple plants (planted.mjs deterministicPlants).
  planted: ['Planted mistakes', 'Worca has a good result broken on purpose, so the criterion is no longer true anywhere in it, and checks that it notices. In mock mode Worca makes simple mistakes itself, such as removing a number.'],
  again: ['Asked again', 'The same result is checked 3 times. The verdict should not change.'],
  order: ['Order swapped', 'When Worca picks the better of two results, it sees them in both orders. The winner must not depend on which one comes first.'],
  longer: ['Longer is not better', 'Filler text is added to a result. A longer result must not get a better verdict.'],
  proof: ['Proof for every verdict', 'Each verdict must quote the part of the result it is based on. Worca checks that the quote is really there. Verdicts without proof are not counted.'],
  people: ['Agreement with people', 'From your Agree and Disagree answers and "Check the checker".'],   // P4-M4's words (no colleagues until Part 5)
});
export const answersText = (n) => `${n} ${n === 1 ? 'answer' : 'answers'}`;
export function trustTestLine(t) {
  if (t.state === 'none') return 'Not run yet';
  if (t.key === 'planted') {
    if (t.state === 'good') return `${t.caught} of ${t.of} caught`;
    const on = [...new Set(t.missedOn)];   // boards 13 and P4-M4: "Both missed on" when the two misses share one criterion
    return `${t.caught} of ${t.of} caught. ${on.length === 1 && t.of - t.caught === 2 ? 'Both missed' : 'Missed'} on "${on.join('", "')}".`;
  }
  if (t.key === 'again') return `${t.n} of ${t.of} criteria give the same verdict`;
  if (t.key === 'order') return `Same winner in ${t.n} of ${t.of} pairs`;
  if (t.key === 'longer') return t.fooled ? `${t.fooled} ${t.fooled === 1 ? 'criterion' : 'criteria'} fooled` : 'No criterion fooled';
  if (t.key === 'proof') return `${t.n} of ${t.of} verdicts had proof. ${t.of - t.n} ${t.of - t.n === 1 ? 'was' : 'were'} not counted.`;
  if (t.state === 'waiting') return `${t.pct}% · of ${answersText(t.n)} (Worca needs 10)`;   // user decision 5: 1 to 9 answers
  return `${t.pct}% of ${answersText(t.n)}`;   // P4-M4's test 6
}
/** User decision 4 (board 13): a test that found a problem counts it ("2 missed", "1 changes"); 1 to 9 answers are grey, as a
 *  criterion's own "Needs your answers" (P4-C1). Returns [badge class, words]. */
export function trustTestBadge(t) {
  if (t.state === 'good') return ['badge green', 'Good'];
  if (t.state === 'waiting') return ['badge', 'Needs your answers'];
  if (t.state !== 'bad') return ['badge', 'Not run yet'];
  if (t.key === 'planted') return ['badge red', `${t.of - t.caught} missed`];
  if (t.key === 'again' || t.key === 'order') return ['badge red', `${t.of - t.n} changes`];
  if (t.key === 'longer') return ['badge red', `${t.fooled} fooled`];
  if (t.key === 'proof') return ['badge red', `${t.of - t.n} without proof`];
  return ['badge red', `${t.n - t.agree} disagree`];
}

/** P4-C4: the hint under "What to check" for each Part 4 exact kind (board P4-M1). */
export const EXACT_KIND_HINTS = Object.freeze({
  quotes: "Each sentence in quotation marks must appear word for word in the example's files or request. Small differences in spacing and quotation marks are ignored.",
  numbers: "Each number in the result must appear in the example's files or request.",
  'no-personal': 'No e-mail addresses, phone numbers, bank account or card numbers.',
  links: 'Every link in the result opens a real page.',
});
