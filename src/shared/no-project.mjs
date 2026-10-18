// src/shared/no-project.mjs — P3 (CONTRACT §3): the one reserved store key for runs without a project.
// Pure ESM (browser + node): constants only.

export const NO_PROJECT_KEY = 'no-project-00000000';
export const NO_PROJECT_NAME = 'No project';
export const WORK_DIR_NAME = 'work';
export const NEEDS_REPO_NOTE = 'Some steps expect a code repository.';

/** True only for the reserved key itself. */
export function isNoProjectKey(key) { return key === NO_PROJECT_KEY; }

export const NO_PROJECT_ERRORS = Object.freeze({
  target: 'provide one of projectDir, workspaceId or noProject',
  type: 'noProject must be true or false',
  schedule: 'a run without a project cannot be scheduled yet',
  memory: 'memoryScope needs a project',
  slices: 'a run without a project cannot be planned in slices yet',
  register: 'this folder belongs to a run without a project',
  proposalTarget: 'provide one of projectKey, workspaceId or noProject',
});
