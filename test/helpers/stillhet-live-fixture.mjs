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
  away: { toggle: 'auto', config: {} },
  settings: { keepAwake: true, uiLevel: 'expert', flags: { rail: true }, git: { available: true } },
};

