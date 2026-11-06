// src/core/setup-stages.mjs — the names of a run's setup stages (state.setupStage) that other modules read. A leaf module:
// the workflow-test runner reads WORKTREE_STAGE without importing the whole run harness.

/** The setup stage while a git run makes its worktree (state.setupStage): the workflow-test runner reads it as a phase. */
export const WORKTREE_STAGE = 'Creating the worktree';
