// src/shared/model-jobs.mjs — the jobs that pick a model of their own beside the three roles (U2b, L21): each
// harness's helper jobs and the Design jobs. Served as-is to the browser (/src/shared/model-jobs.mjs).
// Copied from engine-settings-view.mjs (JOB_LABELS, utilityId, DESIGN_ROW_LABELS), which still serves Project settings
// and the setup assistant; app.js's copies were removed in P6 (app.js at checkpoint 98c2f9e3e still has them). Roles are model-roles.mjs's
// roleOfJob; codex keys are settings.mjs UTILITY_JOBS.

const helper = (engine, key, label, role, extra) => Object.freeze({
  key,
  label,
  // utilityId: the jobs that start a run of their own sit outside `utility.`.
  settingId: ['memoryDefrag', 'workspaceScan', 'requirementsInterview', 'secondOpinion'].includes(key)
    ? `models.${engine}.${key}` : `models.${engine}.utility.${key}`,
  role,
  ...extra,
});

/** Helper jobs with a model of their own, per harness. settingId is today's row id (`utilityId`,
 *  engine-settings-view.mjs:24, e.g. 'models.claude.utility.agentGen', 'models.claude.memoryDefrag').
 *  { key, label, settingId, role: 'deep'|'everyday'|'quick'|null, modelOnly?: true, flag?: string } */
export const HELPER_JOBS = Object.freeze({
  claude: Object.freeze([
    helper('claude', 'title', 'Titles', 'quick', { modelOnly: true }),
    helper('claude', 'classifier', 'Auto workflow classifier', 'everyday', { modelOnly: true }),
    helper('claude', 'prDescription', 'PR description', 'quick', { modelOnly: true }),
    helper('claude', 'memoryDefrag', 'Memory defragment', 'quick'),
    helper('claude', 'agentGen', 'Agent generation', 'everyday'),
    helper('claude', 'naming', 'Run naming', 'quick', { flag: 'smartRunNaming' }),
    helper('claude', 'commandSummary', 'Command summaries', 'quick', { flag: 'commandSummaries' }),
    helper('claude', 'guide', 'Guide', 'quick', { flag: 'shaperSmallRuns' }),
    helper('claude', 'secondOpinion', 'Second-opinion reviewer', null),
    helper('claude', 'requirementsInterview', 'Requirements interview', 'everyday', { flag: 'requirements' }),
  ]),
  codex: Object.freeze([
    helper('codex', 'title', 'Titles', 'quick'),
    helper('codex', 'classifier', 'Auto workflow classifier', 'quick'),
    helper('codex', 'overview', 'Run overview', 'quick'),
    helper('codex', 'prDescription', 'PR description', 'quick'),
    helper('codex', 'memoryDefrag', 'Memory defragment', 'quick'),
    helper('codex', 'workspaceScan', 'Workspace scan', 'everyday'),
    helper('codex', 'secondOpinion', 'Second-opinion reviewer', null),
  ]),
});

/** The Design jobs (designModels.<engine>.<key>), with the role their pick falls back to. */
export const DESIGN_JOBS = Object.freeze([
  Object.freeze({ key: 'lead', label: 'Design lead', role: 'deep' }),
  Object.freeze({ key: 'builder', label: 'Design builders', role: 'everyday' }),
]);
