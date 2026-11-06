// The Runs list's mock: the runs and groups it holds. Each row points at a real run-page case: its state, word, section and
// page come from there through the library (runs-list.js), so a list can never call Paused or Stopped Ready.
(function () {
  const run = (id, kase, title, project, detail, time, day, o = {}) => ({ id, case: kase, title, project, detail, time, day, labels: [], cost: null, archived: false, unread: false, pr: '', group: '', kind: 'Git', by: 'Emil Angelov', ...o });
  const round = (n, words, time, kase = 'round') => ({ n, words, time, case: kase });
  const OLD = ['Tidy the CI cache', 'Bump Vite to 6', 'Drop the old router', 'Remove dead flags', 'Rename billing tables', 'Pin Playwright', 'Trim the docker image', 'Split the auth tests', 'Add a health route', 'Clean up logging', 'Fix the sitemap', 'Move fonts to the CDN', 'Lint the migrations', 'Retry on 429', 'Shorten the release notes', 'Add a robots file', 'Index the audit table', 'Fix a flaky date test', 'Rotate the staging keys', 'Remove the beta banner', 'Sort the settings keys', 'Cache the avatar', 'Update the licence year', 'Drop Node 20'];
  const seed = () => ({
    groups: [
      { id: 'g-nav', kind: 'feature', case: 'feature', title: 'Unified page navigation', project: 'worca-cc', time: '12:04', day: 'today', cost: 41.2 },
      { id: 'g-stack', kind: 'chain', case: 'chain', title: 'Billing export stack', project: 'billing-api', time: '11:30', day: 'today', cost: 28.5 },
      { id: 'g-q3', kind: 'user', case: 'group-working', title: 'Q3 cleanup', project: 'web-app', time: '10:50', day: 'today', cost: 12.75 },
      { id: 'g-docs', kind: 'feature', case: 'featureready', title: 'Docs search', project: 'docs-site', time: 'Mon', day: 'week', cost: 33 },
    ],
    runs: [
      run('r1', 'question', 'Add CSV export to billing', 'billing-api', 'Plan asks 2 questions', '14:32', 'today', { labels: ['billing', 'ui'], cost: 3.4, unread: true }),
      run('r2', 'gate', 'Migrate cron parser', 'worca-cc', 'Review gate', '13:40', 'today', { labels: ['backend'], cost: 6.1 }),
      run('r3', 'paused-limit', 'Refactor auth middleware', 'web-app', 'Usage limit · resets 18:00', '13:12', 'today', { cost: 11.8 }),
      run('r4', 'capped', 'Rebuild the search index', 'docs-site', 'Cost cap · reached $120', '12:58', 'today', { cost: 120 }),
      run('r5', 'failed', 'Update Node to 24', 'web-app', 'Test step · 3 tests failed', '12:40', 'today', { cost: 4.2, unread: true, labels: ['hotfix'] }),
      run('r6', 'interrupted', 'Move sessions to Redis', 'worca-cc', 'Worca was stopped', '11:58', 'today', { cost: 2.1 }),
      run('r7', 'failing', 'Retry on 502', 'web-app', 'Checks failing', '11:20', 'today', { pr: '#962', cost: 7.3, labels: ['hotfix'], rounds: { line: 'Round 7 · fix checks · nothing pushed: tests still fail', list: [round(7, 'fix checks · nothing pushed', '11:20', 'round-failing'), round(6, 'merge dev in · pushed 3e4f5a6', '10:41'), round(5, 'fix checks · pushed 19ab20c', '09:50'), round(4, 'merge dev in · pushed 77d1e02', 'Thu'), round(3, 'fix checks · pushed a1b2c3d', 'Thu'), round(2, 'merge dev in · pushed 0f0e0d0', 'Wed')] } }),
      run('r8', 'ready', 'Dark mode for the marketing site', 'marketing-site', 'Checks pass', '10:58', 'today', { cost: 9.9, labels: ['ui'] }),
      run('r9', 'approved', 'Add pager to the audit log', 'worca-cc', 'Approved · checks pass', '10:20', 'today', { pr: '#959', cost: 5.2 }),
      run('r10', 'working', 'Fix flaky login test', 'web-app', 'Build · task 2 of 4', '12 min', 'today', { labels: ['ui', 'tests'], cost: 1.6 }),
      run('r11', 'checks', 'Rename settings keys', 'worca-cc', 'Checks running', '4 min', 'today', { pr: '#960', labels: ['backend'], cost: 2.7, rounds: { line: 'Round 2 · merge dev in · running', list: [round(2, 'merge dev in · running', '')] } }),
      run('r12', 'starting', 'Add rate limiting to the public API', 'billing-api', 'Plan is under way', 'now', 'today', { cost: 0 }),
      run('r13', 'network', 'Write the API reference', 'docs-site', 'Waiting for the network', '2 min', 'today', { kind: 'Folder', cost: 0.4 }),
      run('r14', 'scheduled', 'Deploy docs site', 'docs-site', 'Starts when “Write the API reference” finishes', '', 'upcoming'),
      run('r15', 'ticket-firing', 'Weekly digest', 'worca-cc', 'Starts now · every Friday', '', 'upcoming'),
      run('r16', 'waiting-interrupted', 'Publish the changelog', 'worca-cc', 'Waits on “Move sessions to Redis”, which was interrupted', '', 'upcoming'),
      run('r17', 'ticket-missed', 'Nightly dependency bump', 'web-app', 'Missed 03:00: Worca was not running', '03:00', 'upcoming'),
      run('r27', 'scheduled', 'Refresh the demo data', 'worca-cc', 'Queued behind the run before it', '', 'upcoming'),
      run('r28', 'scheduled', 'Sync the price list', 'billing-api', 'Could not start · retrying at 16:00', '', 'upcoming'),
      run('r18', 'merged', 'Fix the invoice rounding', 'billing-api', 'Merged', '09:12', 'today', { pr: '#951', cost: 3.1, labels: ['billing'] }),
      run('r19', 'stopped', 'Try the new planner', 'worca-cc', 'Stopped by you', '08:30', 'today', { cost: 8.8 }),
      run('r20', 'discarded', 'Spike: move to Bun', 'web-app', 'The changes are gone', 'Yesterday', 'yesterday', { cost: 2 }),
      run('r21', 'applied', 'Rewrite the landing copy', 'marketing-site', 'Applied to the folder', 'Yesterday', 'yesterday', { kind: 'Folder', cost: 1.9 }),
      run('r22', 'noproject', 'Summarise the incident notes', '', 'Finished', 'Yesterday', 'yesterday', { kind: 'No project', cost: 0.8 }),
      run('r23', 'mock-run', 'Try the Lean workflow', 'worca-cc', 'No model was called', 'Tue', 'week', { mock: true, cost: 0 }),
      run('r24', 'merged', 'Archive old exports', 'billing-api', 'Merged', 'Mon', 'week', { pr: '#940', archived: true, cost: 2.2 }),
      run('r25', 'stopped', 'Trial of a second cache', 'web-app', 'Stopped by you', 'Sep 30', 'month', { archived: true, cost: 1.1 }),
      run('r26', 'round', 'Retry on 504 · Round 3', 'web-app', 'merge dev in · pushed 5a5a5a5', 'Tue', 'week', { pr: '#930', orphan: true, cost: 0.9 }),
      // a feature: a run done, one working, one to come
      run('m1', 'ready', 'Trail in the top bar', 'worca-cc', 'Checks pass', '10:02', 'today', { group: 'g-nav', pos: 1, cost: 18 }),
      run('m2', 'slice', 'Pager between runs', 'worca-cc', 'Build · task 1 of 3', '12:04', 'today', { group: 'g-nav', pos: 2, cost: 23.2 }),
      run('m3', 'scheduled', 'Deep links', 'worca-cc', 'Starts when “Pager between runs” finishes', '', 'upcoming', { group: 'g-nav', pos: 3 }),
      // a chain: approved, checks, failing
      run('m4', 'approved', 'Export: the table', 'billing-api', 'Approved', '09:44', 'today', { group: 'g-stack', pos: 1, pr: '#970', cost: 9 }),
      run('m5', 'checks', 'Export: the button', 'billing-api', 'Checks running', '10:30', 'today', { group: 'g-stack', pos: 2, pr: '#971', cost: 8.5 }),
      run('m6', 'failing', 'Export: the email', 'billing-api', 'Checks failing', '11:30', 'today', { group: 'g-stack', pos: 3, pr: '#972', cost: 11 }),
      // a person's group: runs that can move
      run('m7', 'working', 'Remove unused CSS', 'web-app', 'Review · 1 of 2', '6 min', 'today', { group: 'g-q3', cost: 3.5, adhoc: true }),
      run('m8', 'merged', 'Delete old icons', 'web-app', 'Merged', '10:50', 'today', { group: 'g-q3', pr: '#948', cost: 2.25, adhoc: true }),
      run('m9', 'stopped', 'Drop the IE styles', 'web-app', 'Stopped by you', '09:15', 'today', { group: 'g-q3', cost: 7, adhoc: true }),
      // a finished feature: closed until opened
      run('m10', 'ready', 'Index the pages', 'docs-site', 'Checks pass', 'Mon', 'week', { group: 'g-docs', pos: 1, cost: 20 }),
      run('m11', 'ready', 'The search box', 'docs-site', 'Checks pass', 'Mon', 'week', { group: 'g-docs', pos: 2, cost: 13 }),
      ...OLD.map((t, i) => run(`o${i}`, i % 5 === 3 ? 'stopped' : 'merged', t, ['web-app', 'worca-cc', 'billing-api'][i % 3], i % 5 === 3 ? 'Stopped by you' : 'Merged', ['Sep 12', 'Aug 30', 'Aug 2', 'Jul 18'][i % 4], 'older', { cost: 1 + (i % 7), pr: i % 5 === 3 ? '' : `#${800 - i}`, by: i % 2 ? 'Dana Ruiz' : 'Emil Angelov', labels: i === 2 ? ['hotfix'] : [] })),
    ],
    userGroups: [{ id: 'g-rel', title: 'Release 1.20' }, { id: 'g-tidy', title: 'Tidy up' }, { id: 'g-sec', title: 'Security review' }],
  });
  window.RunsListModel = { seed, PEOPLE: ['Emil Angelov', 'Dana Ruiz'], DAYS: [['upcoming', 'Upcoming'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Previous 7 days'], ['month', 'Previous 30 days'], ['older', 'Older']] };
})();
