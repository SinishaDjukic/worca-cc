// src/shared/run-rerun.mjs
// Rerun (docs/runs.md): which saved statuses can be rerun, and the reason given for the others. Shared by the server's
// rerun routes and the run page's ⋯ › Rerun item, so the two never disagree. Pure: no imports, no I/O.

export const RERUN_ENDED = new Set(['done', 'stopped', 'error']);
export const RERUN_NOT_ENDED = 'Rerun is available once the run has ended.';
