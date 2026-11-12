// The Schedules' mock: each schedule, what it belongs to, the day of its next run, and each time it ran (a task on a real
// run-page case), by the library's day sections.
(function () {
  // The prototype's today (the Tasks and Schedules centers): every "Next up" and "Started" reads from it.
  const TODAY = new Date(2026, 10, 12);
  const ok = (day, date, time, meta, title) => ({ day, date, time, title, case: 'merged', stage: 4, git: 'merged', meta });
  // the live kind (D9): the store's schedules, read again on every call
  const seed = () => (window.RailWorld?.live ? { schedules: window.RailWorld.part('schedules').map((s) => ({ ...s })) } : window.RailFirstRun ? { schedules: [] } : { schedules: [
    { id: 's1', title: 'Nightly export check', project: 'billing-api', chat: 'c1', every: 'every day', at: '02:00', next: 'Next in 11h', day: 'tomorrow', state: 'scheduled', time: '02:00', section: 'next', labels: ['billing'], what: 'Checks the billing export still runs in time.', cost: 0.45, started: 'Oct 2', workflow: 'Quick Fix',
      runs: [ok('today', 'Nov 12', '02:00', 'Merged #1102', 'Check the export'), { day: 'yesterday', date: 'Nov 11', time: 'Yesterday', title: 'Check the export', case: 'failed', stage: 2, git: 'fail', meta: 'Failed at Review · 2 tests', log: '✗ exports 50k rows under 2s\n  expected 1980ms, got 11240ms', over: true }, ok('week', 'Nov 10', 'Tue', 'Merged #1099', 'Check the export'), ok('week', 'Nov 9', 'Mon', 'Merged #1097', 'Check the export'), ok('week', 'Nov 8', 'Sun', 'Merged #1095', 'Check the export'), ok('week', 'Nov 7', 'Sat', 'Merged #1093', 'Check the export'), ok('week', 'Nov 6', 'Fri', 'Merged #1091', 'Check the export')] },
    { id: 's5', title: 'Changelog digest', project: 'docs-site', chat: '', every: 'every weekday', at: '14:30', next: 'Next weekday at 14:30', day: 'tomorrow', state: 'scheduled', time: '14:30', section: 'next', labels: [], what: "Writes the week's changes for the team.", cost: 0.2, started: 'Nov 9',
      runs: [{ day: 'today', date: 'Nov 12', time: '6 min', title: 'Changelog digest', case: 'working', stage: 1, git: 'branch', meta: 'Build · writing the digest' }, ok('yesterday', 'Nov 11', 'Yesterday', 'Merged', 'Changelog digest'), ok('week', 'Nov 10', 'Tue', 'Merged', 'Changelog digest'), ok('week', 'Nov 9', 'Mon', 'Merged', 'Changelog digest')] },
    { id: 's2', title: 'Weekly deps update', project: 'worca-cc', chat: '', every: 'every Monday', at: '09:00', next: 'Next on Monday', day: 'week', state: 'scheduled', time: 'Mon', section: 'next', labels: [], what: 'Bumps dependencies and opens a PR.', cost: 1.1, started: 'Nov 9', runs: [ok('week', 'Nov 9', 'Mon', 'Merged #1088', 'Bump dependencies')] },
    { id: 's3', title: 'Docs sync', project: 'docs-site', chat: '', every: 'every Tuesday', at: '06:00', next: 'Missed Tuesday: Worca was off', day: 'today', state: 'diverged', time: 'Tue', section: 'needs', labels: [], what: 'Keeps the docs in step with the code.', cost: 0.3, started: 'Oct 20', missed: 'Nov 10', missedWhy: 'Worca was off', runs: [] },
    { id: 's4', title: 'Cost report', project: '', chat: '', every: 'every Friday', at: '17:00', next: 'Paused by you', state: 'paused', time: 'Fri', section: 'paused', labels: [], what: "Sums the week's AI spend.", cost: 0.15, started: 'Sep 4', runs: [] },
  ] });
  window.SchedulesModel = { seed, TODAY };
})();
