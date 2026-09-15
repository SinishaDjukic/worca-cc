// src/shared/report-reasons.mjs
// The run-report vocabulary, shared by the core builder (src/core/run-report.mjs)
// and the browser (ui/public/report-run.mjs). Browser-safe: no node builtins, no
// imports. Kept here — not in src/core — because ui/public cannot import src/core
// but src/shared/** is served at /src/shared, so both sides read the SAME module.
//
// The six reasons and the three opt-in classes are a product contract, not an
// implementation detail: the reason id is also the GitHub issue LABEL, so renaming
// one silently re-labels every future issue.

/** The reason taxonomy, in the order the modal's <select> lists it. */
export const REPORT_REASONS = Object.freeze([
  Object.freeze({ id: 'poor-quality',    label: 'Poor quality',           evidence: 'quality' }),
  Object.freeze({ id: 'too-expensive',   label: 'Too expensive',          evidence: 'cost' }),
  Object.freeze({ id: 'too-slow',        label: 'Too slow',               evidence: 'speed' }),
  Object.freeze({ id: 'wrong-or-unsafe', label: 'Wrong or unsafe change', evidence: 'safety' }),
  Object.freeze({ id: 'failed-or-stuck', label: 'It failed or got stuck', evidence: 'failure' }),
  Object.freeze({ id: 'something-else',  label: 'Something else',         evidence: null }),
]);

export const REPORT_REASON_IDS = Object.freeze(REPORT_REASONS.map((r) => r.id));

/** @returns {{id:string,label:string,evidence:string|null}|null} */
export function reasonById(id) {
  return REPORT_REASONS.find((r) => r.id === id) || null;
}

// The three excluded classes a reporter may opt back IN. The unified diff and the
// run's log lines are deliberately absent and must never be added here: they are
// not offered anywhere in the UI and the builder has no code path for them.
export const OPT_IN_CLASSES = Object.freeze([
  Object.freeze({
    key: 'paths',
    label: 'File paths, review issue titles and the run narrative',
    hint: 'Adds changed-file paths, each review issue’s title and location, and the cached overview narrative.',
  }),
  Object.freeze({
    key: 'prompt',
    label: 'The task prompt',
    hint: 'Adds the prompt text you gave this run, verbatim.',
  }),
  Object.freeze({
    key: 'names',
    label: 'Project, branch and workspace names',
    hint: 'Adds the run title, project key, branch names and workspace name. Never the worktree path.',
  }),
]);

export const OPT_IN_KEYS = Object.freeze(OPT_IN_CLASSES.map((c) => c.key));

/** Coerce an untrusted `include` bag to exactly the three booleans. */
export function normalizeInclude(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of OPT_IN_KEYS) out[key] = src[key] === true;
  return out;
}
