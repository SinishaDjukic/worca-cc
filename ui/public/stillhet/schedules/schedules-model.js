// The Schedules' mock: each schedule, what it belongs to, the day of its next run, and each time it ran (a task on a real
// run-page case), by the library's day sections.
(function () {
  // Today is the real today in both kinds (local midnight on each read, so a page left open past midnight moves on):
  // the demo's runs are dated back from it, so every "next" a schedule says is still to come.
  const today = () => { const d = new Date(Date.now()); d.setHours(0, 0, 0, 0); return d; };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const ago = (n) => { const d = today(); d.setDate(d.getDate() - n); return d; };
  const word = (d) => `${MON[d.getMonth()]} ${d.getDate()}`;
  const last = (dow) => { let n = 1; while (ago(n).getDay() !== dow) n += 1; return n; };   // how many days ago that weekday last was
  // a finished run `n` days ago, in the list's day sections
  const ok = (n, meta, title, time) => ({ day: n === 0 ? 'today' : n === 1 ? 'yesterday' : 'week', date: word(ago(n)), time: time || (n === 1 ? 'Yesterday' : WD[ago(n).getDay()]), title, case: 'merged', stage: 4, git: 'merged', meta });
  // the live kind (D9): the store's schedules, read again on every call
  // and each one's runs from its own read (StillhetScheduleLive.runs, live/schedule-live.mjs): none until that read lands
  const seed = () => (window.StillhetWorld?.live ? { schedules: window.StillhetWorld.part('schedules').map((s) => ({ ...s, runs: window.StillhetScheduleLive?.runs?.(s.id) || s.runs || [] })) } : window.StillhetFirstRun ? { schedules: [] } : { schedules: [
    { id: 's1', title: 'Nightly export check', project: 'billing-api', chat: 'c1', every: 'every day', at: '02:00', next: 'Next tomorrow at 02:00', day: 'tomorrow', state: 'scheduled', time: '02:00', section: 'next', labels: ['billing'], what: 'Checks the billing export still runs in time.', cost: 0.45, started: word(ago(41)), workflow: 'Quick Fix',
      runs: [ok(0, 'Merged #1102', 'Check the export', '02:00'), { day: 'yesterday', date: word(ago(1)), time: 'Yesterday', title: 'Check the export', case: 'failed', stage: 2, git: 'fail', meta: 'Failed at Review · 2 tests', log: '✗ exports 50k rows under 2s\n  expected 1980ms, got 11240ms', over: true }, ok(2, 'Merged #1099', 'Check the export'), ok(3, 'Merged #1097', 'Check the export'), ok(4, 'Merged #1095', 'Check the export'), ok(5, 'Merged #1093', 'Check the export'), ok(6, 'Merged #1091', 'Check the export')] },
    { id: 's5', title: 'Changelog digest', project: 'docs-site', chat: '', every: 'every weekday', at: '14:30', next: 'Next weekday at 14:30', day: 'tomorrow', state: 'scheduled', time: '14:30', section: 'next', labels: [], what: "Writes the week's changes for the team.", cost: 0.2, started: word(ago(3)),
      runs: [{ day: 'today', date: word(ago(0)), time: '6 min', title: 'Changelog digest', case: 'working', stage: 1, git: 'branch', meta: 'Build · writing the digest' }, ok(1, 'Merged', 'Changelog digest'), ok(2, 'Merged', 'Changelog digest'), ok(3, 'Merged', 'Changelog digest')] },
    { id: 's2', title: 'Weekly deps update', project: 'worca-cc', chat: '', every: 'every Monday', at: '09:00', next: 'Next on Monday', day: 'week', state: 'scheduled', time: 'Mon', section: 'next', labels: [], what: 'Bumps dependencies and opens a PR.', cost: 1.1, started: word(ago(last(1))), runs: [ok(last(1), 'Merged #1088', 'Bump dependencies', 'Mon')] },
    { id: 's3', title: 'Docs sync', project: 'docs-site', chat: '', every: 'every Tuesday', at: '06:00', next: 'Missed Tuesday: Worca was off', day: 'today', state: 'diverged', time: 'Tue', section: 'needs', labels: [], what: 'Keeps the docs in step with the code.', cost: 0.3, started: word(ago(last(2) + 21)), missed: word(ago(last(2))), missedWhy: 'Worca was off', runs: [] },
    { id: 's4', title: 'Cost report', project: '', chat: '', every: 'every Friday', at: '17:00', next: 'Paused by you', state: 'paused', time: 'Fri', section: 'paused', labels: [], what: "Sums the week's AI spend.", cost: 0.15, started: word(ago(70)), runs: [] },
    // Schedules slice: a skipped next time (Keep next time brings it back), one that runs a saved preset, and one that ended
    { id: 's6', title: 'Release notes draft', project: 'docs-site', chat: '', every: 'every Thursday', at: '16:00', next: 'Skips next time, then as usual', skip: 'Next on Thursday at 16:00', day: 'week', state: 'scheduled', time: 'Thu', section: 'next', labels: [], what: 'Drafts the release notes from the merged PRs.', cost: 0.25, started: word(ago(last(4) + 28)), runs: [ok(last(4), 'Merged #1090', 'Release notes draft', 'Thu')] },
    { id: 's7', title: 'Flaky test sweep', project: 'worca-cc', chat: '', every: 'every weekend', at: '08:00', next: 'Next weekend at 08:00', day: 'later', state: 'scheduled', time: '08:00', section: 'next', labels: [], what: 'Reruns the flaky tests and opens a fix.', cost: 0.6, started: word(ago(18)), preset: 'Flaky sweep', overlap: 'queue', fails: 5, ifMissed: 'skip', runs: [] },
    { id: 's8', title: 'Q3 migration check', project: 'billing-api', chat: '', every: 'every Monday', at: '07:00', next: '', state: 'ended', time: '', section: 'ended', labels: [], what: 'Checked the old tables were empty, ten times.', cost: 0.1, started: word(ago(100)), ended: true, runs: [] },
  ] });
  window.SchedulesModel = { seed, get TODAY() { return today(); } };
})();
