export const NOW = '2026-09-15T14:41:03.120Z';

const agentSteps = [
  { key: 'x:preflight:1', agentKey: null, phase: null, cycle: 0, costUsd: 0 },
  { key: 'plan:1', agentKey: 'planner', phase: 'plan', cycle: 1, costUsd: 0.61, modelUsed: 'claude-opus-5-5' },
  { key: 'impl:1', agentKey: 'implementer', phase: 'implement', cycle: 1, costUsd: 1.2, modelUsed: 'claude-sonnet-5' },
  { key: 'rev:1', agentKey: 'reviewer', phase: 'review', cycle: 1, costUsd: 0.3, modelUsed: 'claude-opus-5-5' },
  { key: 'impl:2', agentKey: 'implementer', phase: 'implement', cycle: 2, costUsd: 0.95, modelUsed: 'claude-sonnet-5' },
  { key: 'rev:2', agentKey: 'reviewer', phase: 'review', cycle: 2, costUsd: 0.36, modelUsed: 'claude-opus-5-5' },
  { key: 'x:done:1', agentKey: null, phase: null, cycle: 0, costUsd: 0 },
];

export const projectDone = {
  status: 'done', error: null, runId: 'a1b2c3d4', worcaVersion: '1.2.0',
  startedAt: '2026-09-15T14:30:12.004Z', endedAt: '2026-09-15T14:40:58.990Z',
  totalActiveMs: 512340, totalCostUsd: 3.42,
  steps: agentSteps, subAgents: [],
  workflow: { id: 'wf_auto', name: 'Auto', version: 2, rev: '1a2b3c4d' },
  agentKeys: ['planner', 'implementer', 'reviewer', 'refiner'],
  target: { kind: 'project', project: 'acme/billing-api' },
  title: 'Add idempotency keys to POST /invoices',
  source: { type: 'github-issues', ref: '#412', url: 'https://github.com/acme/billing-api/issues/412', title: 'Idempotency keys for invoices' },
  pr: null, prBase: 'dev',
  git: { branch: 'worca/idempotency-keys', head: '8067ff25', base: 'dev', filesChanged: 12, insertions: 340, deletions: 25 },
  interventions: { questions: 1, pauses: 0, resumes: 0 },
  lastPause: null,
  actor: 'Siniša Đukić',
};

// Real budget failures pause first (failure-policy `budget` row); the terminal error comes later (resume site).
export const failedBudget = {
  ...projectDone, status: 'error', runId: 'bbbb0001', error: 'resume failed: worktree gone',
  lastPause: { reason: 'cost_pipeline', detail: 'pipeline cost cap $5.00 reached' },
};

// Parked by a cost cap and stopped before resume() rehydrated it (resume clears lastPause once rehydrated).
export const stoppedAfterBudget = {
  ...projectDone, status: 'stopped', runId: 'bbbb0003',
  lastPause: { reason: 'cost_total', detail: 'pipeline cost cap $5.00 reached' },
};

export const preflightFailed = {
  ...projectDone, status: 'error', runId: 'bbbb0002', error: 'worktree missing',
  steps: [{ key: 'x:preflight:1', agentKey: null, phase: null, cycle: 0, costUsd: 0 }],
  totalCostUsd: 0, agentKeys: null,
};

export const stoppedRun = {
  ...projectDone, status: 'stopped', runId: 'cccc0001',
  git: { branch: 'worca/x', head: null, base: 'main', filesChanged: null, insertions: null, deletions: null },
};

export const resumedRun = { ...projectDone, runId: 'dddd0001', interventions: { questions: 2, pauses: 1, resumes: 1 } };

export const workspaceTouched = {
  ...projectDone, runId: 'eeee0001',
  target: { kind: 'workspace', workspace: 'IoT SP Platform', projects: ['acme/device-registry', 'acme/gateway'], touched: ['acme/gateway'] },
};

export const workspaceUntouched = {
  ...workspaceTouched, runId: 'eeee0002',
  target: { ...workspaceTouched.target, touched: [] },
};
