// test/helpers/covers-plan.mjs — a plan shaped like a real Shaper plan that reuses agreed ids in its checklists and
// names its coverage on `Covers:` lines (src/shared/review/coverage.mjs). Shared by the coverage and plan-card tests.

/** The feature's agreed ids, with their texts. */
export const COVERS_AGREED = Object.freeze({
  'R-arch-1': 'Holds the next run until the owner starts it',
  'R-arch-2': 'A missing feature row never holds',
  'R-arch-3': 'A forced ticket is never held',
  'R-po-3': 'The owner is asked once per run',
  'R-qa-1': 'Each bug has a red test',
  'R-qa-2': 'Slice 2 stays held after slice 1 is done',
  'R-qa-5': 'The outline is byte-equal at the revise spawn',
  'R-ops-2': 'The held run shows on the dashboard',
  'R-rel-2': 'One PR into dev',
});

/** Every agreed id has a `Covers:` line except R-ops-2, which is only mentioned in prose. The checklists reuse R-qa-2,
 *  R-qa-5 and add R-arch-4 for other checks. */
export const COVERS_PLAN = [
  '# Plan: hold the next run',
  '',
  '## Decisions',
  '',
  '| # | Decision | Where |',
  '|---|---|---|',
  '| D1 | The hold is a scheduler option · Covers: R-arch-1, R-arch-2 | `src/core/scheduler.mjs` |',
  '| D2 | Run now skips the hold. R-ops-2 is a dashboard question for later. | `src/core/scheduler.mjs` |',
  '',
  '### Checklist',
  '',
  '- [ ] R-arch-4 The scheduler stays generic.',
  '- [ ] R-qa-2 No new ticket status.',
  '',
  '## Implementation steps',
  '',
  '- Step 1 · Covers: R-arch-3, R-po-3',
  '- Step 2 · Covers: R-qa-1, R-qa-2',
  '- Step 3 · Covers: R-qa-5, R-rel-2',
  '',
  '## Testing',
  '',
  '### Checklist',
  '',
  '- [ ] R-qa-5 The new tests run in under a second.',
  '',
  '## Out of scope',
  '',
  '- The Schedules page.',
  '',
].join('\n');
