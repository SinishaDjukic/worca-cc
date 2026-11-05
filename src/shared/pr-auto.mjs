// src/shared/pr-auto.mjs
// "Create a PR when a run finishes": the values, labels and source wording shared by the core
// (resolution, validation) and the browser (the New run form, the run header, the settings pages).
// Pure: no imports, no I/O.

export const PR_OPEN = Object.freeze(['none', 'draft', 'ready']);
export const PR_SLICES = Object.freeze(['each', 'one']);
export const PR_OPEN_LABELS = Object.freeze({ none: "Don't create a PR", draft: 'Create a draft PR', ready: 'Create a PR ready for review' });
export const PR_SLICES_LABELS = Object.freeze({ each: 'A PR per slice, stacked', one: 'One PR for the whole feature' });
export const PR_EXEMPT = Object.freeze(['automation', 'pr-watch', 'round', 'resolve', 'no-work', 'same-as-source', 'no-project']);

const SOURCE_TEXT = Object.freeze({
  run: 'This run', project: 'Project setting', workspace: 'Workspace setting',
  team: 'Team default', default: 'Worca default', feature: 'From the feature',
});
const EXEMPT_TEXT = Object.freeze({
  automation: "The Git automation opens this run's PR",
  'pr-watch': 'A PR-watch run never creates a PR of its own',
  round: "A requirements round's work goes into its feature, not a PR of its own",
  resolve: 'A conflict-resolution run never creates a PR of its own',
  'no-work': 'This kind of run changes no repository, so it opens no PR',
  'same-as-source': 'This run works on the source branch, so there is no branch to create a PR from',
  'no-project': 'A run with no project has no repository to create a PR in',
});

/** 'run' → 'This run', 'team' → 'Team default'; an unknown source is shown as-is. */
export function prSourceText(source) { return SOURCE_TEXT[source] || (source ? String(source) : ''); }
/** Why an exempt run opens no PR through this path; an unknown kind reads as no-work. */
export function prExemptText(exempt) { return EXEMPT_TEXT[exempt] || EXEMPT_TEXT['no-work']; }
