// test/helpers/stillhet-live-fixture.mjs — one answer per D10 source (and a hello frame), fixed to NOW: the live map,
// adapter and counts tests read the same world.
export const NOW = new Date(2026, 10, 12, 15, 0).getTime();
export const at = (h, m = 0, d = 12) => new Date(2026, 10, d, h, m).toISOString();
export const SOURCES = {
  hello: { type: 'hello', runs: [
    { runId: 'run-a', pipelineId: 'pa', projectDir: '/src/web', title: 'Ask me', status: 'running', pendingQuestion: { questions: [{ question: 'Which format?' }] }, startedAt: at(14, 10), labels: [], sessionId: 'S' },
    { runId: 'run-b', pipelineId: 'pb', projectDir: '/src/web', title: 'Busy', status: 'running', pendingQuestion: null, startedAt: at(14, 20) },
    { runId: 'run-c', pipelineId: 'pc', projectDir: '/src/api', title: 'At a limit', status: 'paused', limitEngine: 'claude', limitResetAt: at(18), startedAt: at(13) },
  ] },
  history: { pipelines: [
    { id: 'pa', title: 'Ask me', status: 'paused', projectName: 'web', dir: '/secret/pa', totalCostUsd: 1, startedAt: at(14, 10), mtime: Date.parse(at(14, 30)) },
    { id: 'h1', title: 'Old pause', status: 'paused', projectName: 'api', dir: '/secret/h1', totalCostUsd: 2.5, startedAt: at(9), mtime: Date.parse(at(9, 30)) },
    { id: 'h2', title: 'Shipped', status: 'done', projectName: 'api', dir: '/secret/h2', totalCostUsd: null, startedAt: at(8, 0, 11), mtime: Date.parse(at(8, 30, 11)) },
    { id: 'h3', title: 'Broke', status: 'error', projectName: 'web', totalCostUsd: 0.4, startedAt: at(7), mtime: Date.parse(at(7, 5)) },
    { id: 'h4', title: 'Gone', status: 'done', archived: true, projectName: 'web', startedAt: at(7) },
  ] },
  threads: { threads: [
    { id: 'ask_1', title: 'Waiting chat', waiting: true, inFlight: false, pinnedAt: at(9), archivedAt: null, updatedAt: at(14), context: 'SECRET', sessionId: 'S1', worktrees: 2, startedRuns: 1, runLinks: 1 },
    { id: 'ask_2', title: 'Writing', waiting: false, inFlight: true, pinnedAt: null, archivedAt: null, updatedAt: at(13), startedRuns: 0, runLinks: 0 },
    { id: 'ask_3', title: 'Archived', archivedAt: at(1), updatedAt: at(1) },
  ], counts: { all: 2, needs: 1, archived: 1 } },
  groups: { groups: [{ id: 'g1', name: 'Release', count: 2, total: 3 }] },
  schedules: { schedules: [{ id: 'sr1', kind: 'recurring', title: 'Nightly', status: 'active', sentence: 'every day at 02:00', nextRunAt: at(2, 0, 13), createdAt: at(1, 0, 1), projectKey: 'web-1' }, { id: 'sr2', kind: 'recurring', title: 'Paused series', status: 'paused', nextRunAt: null, createdAt: at(1, 0, 1) }],
    tickets: [{ id: 'tk1', kind: 'once', title: 'Missed one', status: 'missed', runAt: at(3), projectKey: 'web-1', createdAt: at(1) }, { id: 'tk2', kind: 'once', title: 'Later today', status: 'scheduled', runAt: at(18), createdAt: at(1) }],
    counts: { scheduled: 1, missed: 1, recurring: 2, unread: 0 } },
  projects: { projects: [
    { key: 'web-1', name: 'web', path: '/src/web', displayPath: '~/src/web', exists: true, vcs: 'git' },
    { key: 'api-2', name: 'api', path: '/src/api', displayPath: '~/src/api', exists: true, vcs: 'git' },
    { key: 'gone-3', name: 'gone', path: '/src/gone', displayPath: '~/src/gone', exists: false, vcs: 'git' },
  ] },
  sync: { projects: { 'web-1': { base: 'main', remote: 'origin', state: 'up-to-date', ahead: 0, behind: 0, fetchedAt: at(14) }, 'api-2': { base: 'main', remote: 'origin', state: 'diverged', ahead: 1, behind: 2, fetchedAt: at(14) } } },
  budget: { totalLimitUsd: 100, resetPeriod: 'monthly', windowSpendUsd: 12.5, windowSavedUsd: 40, windowEndMs: new Date(2026, 11, 1).getTime() },
  actions: [{ instanceId: 'i1', runId: 'run-b', label: 'Dev server :4417', status: 'running', runTitle: 'Busy' }, { instanceId: 'i2', runId: 'run-x', label: 'Old', status: 'exited' }],
  notifications: { notifications: [{ id: 7, kind: 'missed', ticketId: 'tk1', title: 'Missed one', message: 'Worca was off', createdAt: at(3, 5), readAt: null, unread: true }, { id: 8, kind: 'nonsense', createdAt: at(3) }], unread: 1 },
  // GET /api/ask/run-links: ask_1 started run-a; ask_2 only follows run-b (Stillhet Chat, D7)
  runLinks: { links: [{ threadId: 'ask_1', runId: 'run-a', pipelineId: 'pa', started: true }, { threadId: 'ask_2', runId: 'run-b', pipelineId: 'pb', started: false }] },
  away: { toggle: 'auto', config: {} },
  settings: { keepAwake: true, uiLevel: 'expert', flags: { rail: true }, git: { available: true } },
};


// ---- a run's REST state (GET /api/ask/runs/:id `state`, artifacts.mjs rowToState), for the chat's TaskCard ----
const agentNode = (id, key, progressStage) => ({ id, kind: 'agent', key, progressStage, x: 0, y: 0, label: key[0].toUpperCase() + key.slice(1), color: 'violet',
  ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true } });
export const RUN_MANIFEST = { version: 2, template: { id: 'wf_default', name: 'Default' }, graph: {
  nodes: [agentNode('n_plan', 'planner', 'plan'), agentNode('n_impl', 'implementer', 'build'), agentNode('n_rev', 'reviewer', 'review'),
    { id: 'n_end', kind: 'end', key: null, x: 0, y: 0, label: 'End', color: '', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } }],
  wires: [
    { id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_impl', port: 'task' }, loop: false },
    { id: 'w2', from: { node: 'n_impl', port: 'out' }, to: { node: 'n_rev', port: 'task' }, loop: false },
    { id: 'w3', from: { node: 'n_rev', port: 'out' }, to: { node: 'n_end', port: 'result' }, loop: false },
  ] }, bookends: { preflight: true, done: true } };
const ledger = (over) => ({ key: over.executionId, stepIndex: null, cycle: over.ordinal ?? 1, status: 'done', activeMs: 1000, costUsd: 0.1, startedAt: '2026-11-12T13:00:00Z', ...over });
/** A run on its second stage (Build) with 4 agents at work: the TaskCard counts stages, never agents. */
export const RUN_STATE = (over = {}) => ({ id: 'pa', title: 'Ask me', projectKey: 'web-1', projectDir: '/src/web', status: 'running', stepper: RUN_MANIFEST,
  steps: [ledger({ executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1 }),
    ...[1, 2, 3, 4].map((k) => ledger({ executionId: `x:n_impl:${k}`, nodeId: 'n_impl', ordinal: k, status: 'start' }))],
  active: [1, 2, 3, 4].map((k) => ({ nodeId: 'n_impl', executionId: `x:n_impl:${k}` })), totalCostUsd: 0.42, totalActiveMs: 65_000, startedAt: at(14, 10), ...over });

// ---- a thread (GET /api/ask/threads/:id), one message per Step 4 row the cards test does not cover ----
export const THREAD = {
  thread: { id: 'ask_1', title: 'Waiting chat' },
  messages: [
    { id: 'm1', role: 'user', text: 'Add a CSV export', status: 'done', createdAt: at(13, 0), blocks: [{ kind: 'where', label: 'Tasks', icon: 'tasks' }, { kind: 'attachment', id: 'att1', name: 'spec.md', bytes: 120, attKind: 'text' }] },
    { id: 'm2', role: 'assistant', text: 'I will start a task: <b>safe</b>\nwith two lines', status: 'done', durationMs: 8000, createdAt: at(13, 1), blocks: [
      { kind: 'tool', id: 'tu1', name: 'Read', status: 'done', durationMs: 200 },
      { kind: 'agent', id: 'ag1', label: 'Explore', status: 'done' },
      { kind: 'card', id: 'card_prop', state: 'proposed', textAt: 99, card: { title: 'CSV export', brief: 'Add a CSV export to billing', workflowName: 'Default', projectName: 'web', target: 'project' } },
      { kind: 'card', id: 'card_run', state: 'started', textAt: 99, card: { title: 'Ask me', brief: 'b', workflowName: 'Default', target: 'project' } },
      { kind: 'notice', text: 'Read 3 files' },
      { kind: 'divider', text: 'Switched to web' },
    ] },
    { id: 'm3', role: 'user', text: 'And the totals?', status: 'done', createdAt: at(13, 5), blocks: [] },
    { id: 'm4', role: 'assistant', text: '', status: 'error', reason: 'model overloaded', createdAt: at(13, 6), blocks: [] },
  ],
  runLinks: [{ threadId: 'ask_1', runId: 'run-a', pipelineId: 'pa', cardId: 'card_run' }],
  inFlight: null,
};

// ---- Stillhet Tasks (slice 5): one dev history detail per task state the page and the card draw. Each is
// { row: the store's task, state: GET /api/history/:key/:id `state`, checks: GET /api/pr/checks }. Not in SOURCES, so the
// host tests that serve SOURCES keep their own answers.
const branch = (feature, source = 'dev') => ({ source, feature, branchKept: true });
const step = (agentKey, status, extra = {}) => ({ key: agentKey, nodeId: `n_${agentKey}`, agentKey, status, costUsd: 0.5, activeMs: 120000, ...extra });
const done3 = [step('planner', 'done'), step('implementer', 'done'), step('reviewer', 'done')];
export const PR_URL = 'https://github.com/acme/web/pull/959';
export const TASK_DETAILS = {
  failed: { row: { id: 'h3', case: 'failed', title: 'Broke', detail: 'Failed', cost: 0.4, pr: '' },
    state: { id: 'h3', title: 'Broke', status: 'error', projectKey: 'web-1', projectDir: '/src/web', branch: branch('chore/node-24'), totalCostUsd: 4.2, totalActiveMs: 31 * 60000,
      startedAt: at(7), prompt: 'Update Node to 24', stepper: { template: { id: 'wf_default' } }, guardrailsId: 'g1', runEngine: 'claude', labels: ['infra'], tags: [{ key: 'team', value: 'web' }],
      steps: [step('planner', 'done'), step('implementer', 'error', { error: '3 tests failed\n✗ test/a.test.mjs: timeout\n✗ test/b.test.mjs: expected 2\n✗ test/c.test.mjs: ENOENT' })] } },
  approved: { row: { id: 'h2', case: 'checks', title: 'Shipped', detail: 'Finished', cost: 1.1, pr: PR_URL },
    state: { id: 'h2', title: 'Shipped', status: 'done', projectKey: 'api-2', projectDir: '/src/api', branch: branch('feat/audit-log-pager'), totalCostUsd: 1.1, totalActiveMs: 600000, steps: done3,
      pr: { url: PR_URL, state: 'OPEN' } },
    checks: { checks: { state: 'passing', total: 12, failed: 0, pending: 0, skipped: 0, inherited: 0 }, mergeable: 'MERGEABLE', base: 'dev',
      reviews: [{ by: 'maya', state: 'APPROVED' }], status: { tone: 'ok', label: 'Ready to merge', detail: 'All 12 checks passed' }, watch: { watching: false, status: null } } },
  failing: { row: { id: 'h5', case: 'checks', title: 'Red CI', detail: 'Finished', cost: 0.9, pr: PR_URL },
    state: { id: 'h5', title: 'Red CI', status: 'done', branch: branch('feat/red'), totalCostUsd: 0.9, totalActiveMs: 300000, steps: done3, pr: { url: PR_URL, state: 'OPEN' } },
    checks: { checks: { state: 'failing', total: 5, failed: 2, pending: 0, skipped: 0, inherited: 0 }, mergeable: 'MERGEABLE', base: 'dev', reviews: [], watch: { watching: true, status: 'watching' } } },
  capped: { row: { id: 'h1', case: 'capped', title: 'Old pause', detail: 'Paused', cost: 2.5, pr: '' },
    state: { id: 'h1', title: 'Old pause', status: 'paused', pauseReason: 'cost_pipeline', branch: branch('feat/big'), totalCostUsd: 2.5, totalActiveMs: 900000, costCapUsd: null, pipelineCapUsd: 2,
      steps: [step('planner', 'done'), step('implementer', 'paused')] } },
  plan: { row: { id: 'run-a', case: 'plan', title: 'Ask me', detail: 'Approve the plan', cost: 1, pr: '' },
    state: { id: 'pa', title: 'Ask me', status: 'running', branch: branch('feat/ask'), totalCostUsd: 1, totalActiveMs: 120000, steps: [step('planner', 'running')],
      pendingQuestion: { id: 'q-plan', kind: 'plan' } } },
  stopped: { row: { id: 'h6', case: 'stopped', title: 'Halted', detail: 'Stopped', cost: 0.3, pr: '' },
    state: { id: 'h6', title: 'Halted', status: 'stopped', branch: branch('feat/halt'), totalCostUsd: 0.3, totalActiveMs: 60000, steps: [step('planner', 'done'), step('implementer', 'stopped')] } },
};
export const TASK_GROUP = { id: 'g-nav', name: 'Navigation', members: ['h2', 'h5', 'h3'] };
