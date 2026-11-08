// The Schedules' mock: each schedule, what it belongs to, the day of its next run, and each time it ran (a task on a real
// run-page case), by the library's day sections.
(function () {
  const seed = () => (window.RailFirstRun ? { schedules: [] } : { schedules: [
    { id: 's1', title: 'Nightly export check', project: 'billing-api', chat: 'c1', every: 'every day', at: '02:00', next: 'Next in 11h', day: 'tomorrow', state: 'scheduled', time: '02:00', section: 'next', labels: ['billing'],
      runs: [{ day: 'today', title: 'Check the export', case: 'ready', stage: 3, git: 'pass', meta: 'Ready' }, { day: 'yesterday', title: 'Check the export', case: 'failed', stage: 2, git: 'fail', meta: 'Failed at Review · 2 tests', log: '✗ exports 50k rows under 2s\n  expected 1980ms, got 11240ms' }, { day: 'week', title: 'Check the export', case: 'merged', stage: 4, git: 'merged', meta: 'Merged #1102' }, { day: 'week', title: 'Check the export', case: 'merged', stage: 4, git: 'merged', meta: 'Merged #1097' }] },
    { id: 's2', title: 'Weekly deps update', project: 'worca-cc', chat: '', every: 'every Monday', at: '09:00', next: 'Next on Monday', day: 'week', state: 'scheduled', time: 'Mon', section: 'next', labels: [], runs: [{ day: 'week', title: 'Bump dependencies', case: 'merged', stage: 4, git: 'merged', meta: 'Merged #1088' }] },
    { id: 's3', title: 'Docs sync', project: 'docs-site', chat: '', every: 'every Tuesday', at: '06:00', next: 'Missed Tuesday: Worca was off', day: 'today', state: 'diverged', time: 'Tue', section: 'needs', labels: [], runs: [] },
    { id: 's4', title: 'Cost report', project: '', chat: '', every: 'every Friday', at: '17:00', next: 'Paused by you', state: 'paused', time: 'Fri', section: 'paused', labels: [], runs: [] },
  ] });
  window.SchedulesModel = { seed };
})();
