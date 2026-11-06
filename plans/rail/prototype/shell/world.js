// The one mock of who is running what, per Pulse case (docs/rail/build.md). The Runs list, Pulse's Vitals and Updates, Usage
// and costs, the Chats column and the run page's title all read it, so the badge, the rows and the lists agree. A run is
// written once, in `table`, and a case picks its runs; a page that acts on a run changes it here.
(function () {
  const R = window.RailUI, RM = window.RunCardModel;
  const run = (id, kase, title, project, detail, time, day, o = {}) => ({ id, case: kase, title, project, detail, time, day, labels: [], cost: null, archived: false, unread: false, pr: '', group: '', kind: 'Git', by: 'Emil Angelov', ...o });
  // not started yet: `when` is its group in Vitals › Scheduled
  const wait = (id, kase, when, title, project, detail, time, o) => run(id, kase, title, project, detail, time, 'upcoming', { when, ...o });
  const round = (n, words, time, kase = 'round') => ({ n, words, time, case: kase });
  const OLD = ['Tidy the CI cache', 'Bump Vite to 6', 'Drop the old router', 'Remove dead flags', 'Rename billing tables', 'Pin Playwright', 'Trim the docker image', 'Split the auth tests', 'Add a health route', 'Clean up logging', 'Fix the sitemap', 'Move fonts to the CDN', 'Lint the migrations', 'Retry on 429', 'Shorten the release notes', 'Add a robots file', 'Index the audit table', 'Fix a flaky date test', 'Rotate the staging keys', 'Remove the beta banner', 'Sort the settings keys', 'Cache the avatar', 'Update the licence year', 'Drop Node 20'];
  const ROUNDS = { line: 'Round 7 · fix checks · nothing pushed: tests still fail', list: [round(7, 'fix checks · nothing pushed', '11:20', 'round-failing'), round(6, 'merge dev in · pushed 3e4f5a6', '10:41'), round(5, 'fix checks · pushed 19ab20c', '09:50'), round(4, 'merge dev in · pushed 77d1e02', 'Thu'), round(3, 'fix checks · pushed a1b2c3d', 'Thu'), round(2, 'merge dev in · pushed 0f0e0d0', 'Wed')] };
  const table = () => Object.fromEntries([
    run('r1', 'question', 'Add CSV export to billing', 'billing-api', 'Plan asks 2 questions', '14:32', 'today', { labels: ['billing', 'ui'], cost: 3.4, unread: true }),
    run('r2', 'gate', 'Migrate cron parser', 'worca-cc', 'Review gate', '13:40', 'today', { labels: ['backend'], cost: 6.1 }),
    run('r3', 'paused-limit', 'Refactor auth middleware', 'web-app', 'Usage limit · Gemini refused: daily quota', '13:12', 'today', { cost: 11.8 }),
    run('r4', 'capped', 'Rebuild the search index', 'docs-site', 'Cost cap · reached $120', '12:58', 'today', { cost: 120 }),
    run('r5', 'failed', 'Update Node to 24', 'web-app', 'Test step · 3 tests failed', '12:40', 'today', { cost: 4.2, unread: true, labels: ['hotfix'] }),
    run('r6', 'interrupted', 'Move sessions to Redis', 'worca-cc', 'Worca was stopped', '11:58', 'today', { cost: 2.1 }),
    run('r7', 'failing', 'Retry on 502', 'web-app', 'Checks failing', '11:20', 'today', { pr: '#962', cost: 7.3, labels: ['hotfix'], rounds: ROUNDS }),
    run('r8', 'ready', 'Dark mode for the marketing site', 'marketing-site', 'Checks pass', '10:58', 'today', { cost: 9.9, labels: ['ui'] }),
    run('r9', 'approved', 'Add pager to the audit log', 'worca-cc', 'Approved · checks pass', '10:20', 'today', { pr: '#959', cost: 5.2 }),
    run('r10', 'working', 'Fix flaky login test', 'web-app', 'Build · task 2 of 4', '12 min', 'today', { labels: ['ui', 'tests'], cost: 1.6 }),
    run('r11', 'checks', 'Rename settings keys', 'worca-cc', 'Checks running', '4 min', 'today', { pr: '#960', labels: ['backend'], cost: 2.7, rounds: { line: 'Round 2 · merge dev in · running', list: [round(2, 'merge dev in · running', '')] } }),
    run('r12', 'starting', 'Add rate limiting to the public API', 'billing-api', 'Plan is under way', 'now', 'today', { cost: 0 }),
    run('r13', 'network', 'Write the API reference', 'docs-site', 'Waiting for the network', '2 min', 'today', { kind: 'Folder', cost: 0.4 }),
    wait('r14', 'scheduled', 'after', 'Deploy docs site', 'docs-site', 'Starts when “Write the API reference” finishes', ''),
    run('r15', 'ticket-firing', 'Weekly digest', 'worca-cc', 'Starts now · every Friday', 'now', 'upcoming'),
    wait('r16', 'waiting-interrupted', 'after', 'Publish the changelog', 'worca-cc', 'Waits on “Move sessions to Redis”, which was interrupted', ''),
    wait('r17', 'ticket-missed', 'missed', 'Nightly dependency bump', 'web-app', 'Worca was not running', '03:00'),
    wait('r27', 'scheduled', 'after', 'Refresh the demo data', 'worca-cc', 'Queued behind the run before it', ''),
    wait('r28', 'scheduled', 'today', 'Sync the price list', 'billing-api', 'Could not start · retrying', '16:00'),
    run('r29', 'recovery', 'Port the cron worker', 'worca-cc', 'The same step failed three times', '14:10', 'today', { cost: 1.2 }),
    run('r30', 'plan', 'Add audit log', 'worca-cc', 'Shaper proposes a workflow', '14:02', 'today', { cost: 0.6 }),
    run('r31', 'paused-time', 'Speed up the test suite', 'web-app', 'Build ran past its time limit', '01:40', 'today', { cost: 3.2 }),
    run('r32', 'paused-error', 'Translate the emails', 'worca-cc', 'Lost the connection to the model', '13:30', 'today', { cost: 0.9 }),
    run('r33', 'paused-away', 'Update the changelog', 'docs-site', 'Night guardrail · waits for you', '02:10', 'today', { cost: 0.7 }),
    wait('r34', 'scheduled', 'today', 'Tidy project memory', 'worca-cc', 'Once', '18:00'),
    wait('r35', 'scheduled', 'tomorrow', 'Refresh the docs index', 'docs-site', 'Once', '06:00'),
    wait('r36', 'scheduled', 'week', 'Send the status report', 'worca-cc', 'Every Friday', 'Fri 09:00'),
    wait('r37', 'scheduled', 'later', 'Quarterly licence check', 'web-app', 'Every 3 months', 'Jan 5'),
    run('s2', 'slice', 'Rate limiting · slice 2 of 4', 'web-app', 'Build · Codex · moved from Claude Code at the start', '6 min', 'today', { cost: 2.4 }),
    // Worca starts these with nobody there to ask: each is checked against the warning line when its turn comes.
    wait('s3', 'scheduled', 'after', 'Rate limiting · slice 3 of 4', 'web-app', '', '', { slice: true, on: 'claude' }),
    wait('s4', 'scheduled', 'after', 'Rename the config flag', 'worca-cc', '', '', { queued: true, on: 'claude' }),
    // what has ended: it reads the same in every case
    run('r18', 'merged', 'Fix the invoice rounding', 'billing-api', 'Merged', '09:12', 'today', { pr: '#951', cost: 3.1, labels: ['billing'] }),
    run('r19', 'stopped', 'Try the new planner', 'worca-cc', 'Stopped by you', '08:30', 'today', { cost: 8.8 }),
    run('r20', 'discarded', 'Spike: move to Bun', 'web-app', 'The changes are gone', 'Yesterday', 'yesterday', { cost: 2 }),
    run('r21', 'applied', 'Rewrite the landing copy', 'marketing-site', 'Applied to the folder', 'Yesterday', 'yesterday', { kind: 'Folder', cost: 1.9 }),
    run('r22', 'noproject', 'Summarise the incident notes', '', 'Finished', 'Yesterday', 'yesterday', { kind: 'No project', cost: 0.8 }),
    run('r23', 'mock-run', 'Try the Lean workflow', 'worca-cc', 'No model was called', 'Tue', 'week', { mock: true, cost: 0 }),
    run('r24', 'merged', 'Archive old exports', 'billing-api', 'Merged', 'Mon', 'week', { pr: '#940', archived: true, cost: 2.2 }),
    run('r25', 'stopped', 'Trial of a second cache', 'web-app', 'Stopped by you', 'Sep 30', 'month', { archived: true, cost: 1.1 }),
    run('r26', 'round', 'Retry on 504 · Round 3', 'web-app', 'merge dev in · pushed 5a5a5a5', 'Tue', 'week', { pr: '#930', orphan: true, cost: 0.9 }),
    run('h1', 'merged', 'Tidy the settings page', 'worca-cc', 'Merged', '08:40', 'today', { pr: '#958', cost: 1.42 }),
    run('h2', 'merged', 'Split the auth module', 'worca-cc', 'Merged', 'Yesterday', 'yesterday', { pr: '#955', cost: 4.1 }),
    run('h3', 'merged', 'Breadcrumb tests', 'worca-cc', 'Merged', 'Yesterday', 'yesterday', { pr: '#954', cost: 1.1 }),
    // a feature: a run done, one working, one to come
    run('m1', 'ready', 'Trail in the top bar', 'worca-cc', 'Checks pass', '10:02', 'today', { group: 'g-nav', pos: 1, cost: 18 }),
    run('m2', 'slice', 'Pager between runs', 'worca-cc', 'Build · task 1 of 3', '12:04', 'today', { group: 'g-nav', pos: 2, cost: 23.2 }),
    wait('m3', 'scheduled', 'after', 'Deep links', 'worca-cc', 'Starts when “Pager between runs” finishes', '', { group: 'g-nav', pos: 3 }),
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
  ].map((r) => [r.id, r]));
  const GROUPS = {
    'g-nav': { id: 'g-nav', kind: 'feature', case: 'feature', title: 'Unified page navigation', project: 'worca-cc', time: '12:04', day: 'today', cost: 41.2 },
    'g-stack': { id: 'g-stack', kind: 'chain', case: 'chain', title: 'Billing export stack', project: 'billing-api', time: '11:30', day: 'today', cost: 28.5 },
    'g-q3': { id: 'g-q3', kind: 'user', case: 'group-working', title: 'Q3 cleanup', project: 'web-app', time: '10:50', day: 'today', cost: 12.75 },
    'g-docs': { id: 'g-docs', kind: 'feature', case: 'featureready', title: 'Docs search', project: 'docs-site', time: 'Mon', day: 'week', cost: 33 },
  };
  const ENDED = ['r18', 'r19', 'r20', 'r21', 'r22', 'r23', 'r24', 'r25', 'h1', 'h2', 'h3', ...OLD.map((_, i) => `o${i}`)];
  const MEMBERS = { 'g-nav': ['m1', 'm2', 'm3'], 'g-stack': ['m4', 'm5', 'm6'], 'g-q3': ['m7', 'm8', 'm9'], 'g-docs': ['m10', 'm11'] };
  const NIGHTLY = { case: 'scheduled', when: 'tomorrow', detail: 'Every day' };
  const CLAUDE_MAX = (session, week) => ({ p: 'claude', plan: 'Max', asOf: '14:28', win: [{ k: 'session', pct: session, resets: '16:40' }, { k: 'week', pct: week, resets: 'Mon 09:00' }] });
  const CODEX = (asOf, session, week, weekResets = 'Sun 22:00') => ({ p: 'codex', plan: 'Plus', asOf, win: [{ k: 'session', pct: session, resets: '15:10' }, { k: 'week', pct: week, resets: weekResets }] });
  const COPILOT = { p: 'copilot', plan: 'Business', asOf: '14:05', win: [{ k: 'month', pct: 71, used: 212, of: 300, resets: 'Dec 1' }] };
  const month = (spent, limit, saved) => ({ period: 'this month', spent, limit, saved });
  // Each case: its runs (by id, with what differs here), its groups, and what it holds beside them. A budget is always
  // this month's; Settings › Runs › Budget reads the same figures.
  const CASES = {
    afternoon: { runs: { r1: 0, r2: 0, r5: 0, r10: 0, r11: 0, r7: { case: 'checks', detail: 'Checks running after the fix', time: '2 min', rounds: undefined }, r34: 0, r17: NIGHTLY, r37: 0 }, groups: ['g-nav'],
      actions: [['a1', 'r10', 'Dev server :4417'], ['a2', 'r11', 'Storybook :6006']],
      usage: [{ p: 'claude', plan: 'Ultra', asOf: '14:28', win: [{ k: 'week', pct: 31, resets: 'Mon 09:00' }], note: { text: 'No session limit on Ultra', tip: 'Anthropic removed the 5-hour session from verified Ultra accounts on 30 Oct 2026; the weekly limit stays' } },
        CODEX('13:52', 12, 40), COPILOT, { p: 'openrouter', plan: 'Free', asOf: '13:30', win: [{ k: 'day', pct: 64, used: 32, of: 50, resets: '02:00' }] }],
      budget: month(412, 1000, 2310.5), chats: { needs: ['c1'], unread: ['c1'] } },
    near: { runs: { r10: 0, s2: 0, s3: 0, s4: 0, r7: { case: 'pr-fixing', detail: 'Fixing 2 failing checks', time: '3 min', rounds: undefined } }, actions: [],
      usage: [CLAUDE_MAX(86, 52), CODEX('14:24', 20, 44)], budget: month(312.4, 1000, 1120.55), chats: {} },
    reached: { runs: { r11: 0, r5: 0, r33: { case: 'paused-limit', detail: 'Usage limit · resumes by itself', time: 'Mon 09:05', day: 'upcoming', when: 'reset', resumes: true, on: 'codex' }, r17: NIGHTLY },
      actions: [['a1', 'r11', 'Preview :3000']], usage: [CLAUDE_MAX(30, 61), CODEX('11:05', 64, 100, 'Mon 09:00')], budget: month(488.1, 1000, 1540.2), chats: {} },
    budget: { runs: { r1: { case: 'capped', detail: 'Cost cap reached at $5.00', time: '10:12' } }, actions: [],
      usage: [{ p: 'claude', plan: 'API key', asOf: '10:12', win: [] }], budget: month(92, 100), chats: {} },
    spent: { runs: { r1: { case: 'paused-budget', detail: 'Budget used up · waits for you', time: '09:30' }, r10: { case: 'paused-budget', detail: 'Budget used up · waits for you', time: '09:30' } }, actions: [],
      usage: [CLAUDE_MAX(30, 41), CODEX('14:24', 20, 44)], budget: month(100, 100), chats: {} },
    gemini: { runs: { r13: { case: 'working', detail: 'Build · task 2 of 4', time: '7 min', kind: 'Git' } }, actions: [],
      usage: [{ p: 'gemini', plan: 'Free tier', asOf: '14:02', win: [] }], budget: null, chats: {} },
    quiet: { runs: {}, actions: [], usage: [{ p: 'claude', plan: 'Pro', asOf: '09:15', win: [{ k: 'session', pct: 5, resets: '13:30' }, { k: 'week', pct: 12, resets: 'Thu 08:00' }] }],
      budget: month(18.2, 1000, 402.1), chats: { quiet: true } },
    every: { runs: Object.fromEntries(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15', 'r16', 'r17', 'r27', 'r28', 'r29', 'r30', 'r31', 'r32', 'r33', 'r34', 'r35', 'r26', 'r36', 'r37', 's2', 's3'].map((id) => [id, 0])), groups: Object.keys(GROUPS),
      actions: [['a1', 'r10', 'Dev server :4417'], ['a2', '', 'Tunnel :8080', 'A removed run']],
      usage: [CLAUDE_MAX(86, 52), CODEX('14:24', 20, 44), COPILOT, { p: 'gemini', plan: 'CLI', asOf: '13:02', win: [] }], budget: month(92, 100), chats: { needs: ['c2', 'c3', 'c5', 'c9'], unread: ['c2'] } },
  };
  let current = 'afternoon', data = null;
  const listeners = [];
  // A case starts fresh: what the pages did to its runs goes.
  function build(id) {
    const c = CASES[id], t = table();
    const groups = (c.groups || []);
    const ids = [...Object.keys(c.runs), ...groups.flatMap((g) => MEMBERS[g]), ...ENDED];
    data = { groups: groups.map((g) => ({ ...GROUPS[g] })), runs: ids.map((x) => ({ ...t[x], ...(c.runs[x] || {}) })), userGroups: [{ id: 'g-rel', title: 'Release 1.20' }, { id: 'g-tidy', title: 'Tidy up' }, { id: 'g-sec', title: 'Security review' }] };
    titles();
  }
  // The run page's title, on any way in (a deep link, the case picker): the run this case's mock has in that state.
  function titles() {
    if (!RM?.titles) return;
    for (const k of Object.keys(RM.titles)) delete RM.titles[k];
    for (const x of [...data.groups, ...data.runs]) if (!RM.titles[x.case]) RM.titles[x.case] = x.title;
  }
  const stateOf = (r) => RM.stateOf(r.case);
  const wordOf = (r) => R.runState(stateOf(r)).word;
  // Where a run sorts: by its state, but a run paused at a limit that resumes by itself waits on nobody.
  const section = (r) => (r.archived ? 'recent' : r.resumes ? 'scheduled' : R.sectionOf(wordOf(r)));
  const membersOf = (g) => data.runs.filter((r) => r.group === g.id).sort((a, b) => (a.pos || 0) - (b.pos || 0));
  // A member that waits on a person raises its group; one that is simply ready ships with the group.
  const raises = (m) => section(m) === 'needs' && ![R.runState('ready').word, R.runState('approved').word].includes(wordOf(m));
  const groupSection = (g) => (membersOf(g).filter((m) => !m.archived).some(raises) ? 'needs' : R.sectionOf(R.runState(RM.stateOf(g.case)).word));
  // What the list shows at its top level: a run, or a group as one row. Vitals reads the same rows, so the counts agree.
  function tops() {
    const out = data.runs.filter((r) => !r.group && !r.archived).map((r) => ({ ...r, state: stateOf(r), section: section(r) }));
    for (const g of data.groups) {
      const ms = membersOf(g); if (!ms.length || ms.every((m) => m.archived)) continue;
      const sec = groupSection(g), needy = ms.find(raises), own = RM.stateOf(g.case);
      out.push({ id: g.id, case: g.case, title: g.title, project: g.project, time: g.time, detail: `${{ feature: 'Feature', chain: 'Chain', user: 'Group' }[g.kind]}${needy ? ` · Run ${needy.pos || ms.indexOf(needy) + 1} ${wordOf(needy).toLowerCase()}` : ''}`, section: sec, state: sec === 'needs' && needy && R.sectionOf(R.runState(own).word) !== 'needs' ? stateOf(needy) : own, when: 'after', isGroup: true });
    }
    return out;
  }
  build(current);
  window.RailWorld = {
    current: () => current,
    set: (id) => { current = id; build(id); listeners.forEach((fn) => fn()); },
    onChange: (fn) => listeners.push(fn),
    data: () => data,
    replace: (d) => { data = d; },   // the Runs list's Undo puts back what it kept
    rows: () => data.runs,
    find: (id) => data.runs.find((r) => r.id === id),
    has: (caseId, id) => id in CASES[caseId].runs || ENDED.includes(id) || (CASES[caseId].groups || []).some((g) => MEMBERS[g].includes(id)),
    title: (id) => table()[id]?.title,
    project: (id) => table()[id]?.project,
    facts: (caseId = current) => ({ ...CASES[caseId], actions: CASES[caseId].actions.map(([aid, r, label, gone]) => ({ id: aid, runId: r, run: gone || table()[r].title, label })) }),
    // A step taken on a run from elsewhere (Pulse's Try again, Resume): the run moves, and every list reads it.
    move: (id, kase, detail) => { const r = data.runs.find((x) => x.id === id); if (r) Object.assign(r, { case: kase, detail, time: 'now', day: 'today', when: undefined, resumes: false, unread: false }); titles(); },
    section, raises, groupSection, tops, membersOf,
  };
})();
