// The PR words every surface shares (one ship flow): "Create PR" makes PRs, "View PR" goes to one, "View PRs" to
// several. "Ship" is a step word ("Ready to ship"), never a button; "pull request" only in headings and sentences.
export const CREATE_PR_LABEL = 'Create PR';
export const VIEW_PR_LABEL = 'View PR';
export const VIEW_PRS_LABEL = 'View PRs';
export const PR_CREATED = 'PR created';
export const CREATE_PR_FAILED = 'Could not create PR';
export const CREATING_PR = 'Creating…';
export const TRY_IT_FIRST = 'Try it first';

/** The Create PR dialog's title and confirm: "Create PR" for one, "Create 3 PRs" for several. */
export function createPrLabel(n = 1) {
  return n > 1 ? `Create ${n} PRs` : CREATE_PR_LABEL;
}

/** A menu item or link to one PR: "View PR #812", or "View PR" when the number is unknown. */
export function viewPrLabel(number) {
  return number ? `${VIEW_PR_LABEL} #${number}` : VIEW_PR_LABEL;
}

// runModel(run).state in src/shared/run-model.mjs gives 'ready' | 'in-review' | 'merged' | 'needs-you' for a done run.
const DONE_WORDS = Object.freeze({
  ready: 'Ready to ship',
  'in-review': 'In review',
  merged: 'Merged',
  'needs-you': 'Needs you',
});

/** The header word for a finished run, from its run-model state; '' when the state is not a done-state. */
export function doneStatusWord(state) {
  return DONE_WORDS[state] || '';
}
