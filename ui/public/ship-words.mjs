// The words the run summary and the run details page share (audit F-7, F-11).
export const CREATE_PR_LABEL = 'Create PR';

// runModel(run).state in src/shared/run-model.mjs gives 'ready' | 'in-review' | 'merged' | 'needs-you' | 'unsuccessful' for a done run.
const DONE_WORDS = Object.freeze({
  ready: 'Ready to ship',
  'in-review': 'In review',
  merged: 'Merged',
  'needs-you': 'Needs you',
  unsuccessful: 'Unsuccessful',
});

/** The header word for a finished run, from its run-model state; '' when the state is not a done-state. */
export function doneStatusWord(state) {
  return DONE_WORDS[state] || '';
}
