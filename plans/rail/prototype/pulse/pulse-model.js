// Pulse mock: the cases, the event catalogue by group, and the pure figures the renderer paints (pulse.js).
// Spec: plans/rail/pulse.md. Now is a state, Updates is an event; usage is read per provider and window.
(function () {
  // The groups, in Settings order. Each event: its id, its own title, its severity: needs (waiting for a person), problem
  // (went wrong while nobody waited), info (simply happened). A group with a `flag` follows that Labs feature.
  // Your own Pause and a drain (the server stopping) wait on nobody: they are not events and never notify.
  const GROUPS = [
    { id: 'runs', name: 'Runs', level: 'problems', where: 'both', events: [
      ['run.questions', 'Questions waiting', 'needs'], ['run.gate', 'Approval needed', 'needs'], ['run.recovery', 'Recovery decision needed', 'needs'],
      ['run.workflow', 'Workflow to review', 'needs'], ['run.cost_cap', 'Cost cap reached', 'needs'], ['run.failed', 'Run failed', 'problem'],
      ['run.paused_limit', 'Usage limit reached', 'problem'], ['run.paused_error', 'Paused on error', 'problem'], ['run.paused_night', 'Night guardrail reached', 'problem'],
      ['run.paused_time', 'Time limit reached', 'problem'], ['run.paused_stopped', 'Worca was stopped', 'problem'], ['run.done', 'Run finished', 'info'], ['run.resumed', 'Resumed after limit', 'info']] },
    { id: 'schedules', name: 'Schedules', level: 'problems', where: 'both', events: [
      ['schedule.missed', 'Start missed', 'problem'], ['schedule.failed', 'Could not start', 'problem'], ['schedule.run_error', 'Run ended badly', 'problem'], ['schedule.run_paused', 'Run paused', 'problem'],
      ['schedule.self_paused', 'Series paused itself', 'problem'], ['schedule.late', 'Started late', 'info'], ['schedule.retrying', 'Retrying a start', 'info'], ['schedule.skipped', 'Start skipped', 'info'],
      ['schedule.canceled', 'Start canceled', 'info'], ['schedule.ended', 'Series ended', 'info'], ['schedule.completed', 'Scheduled run finished', 'info']] },
    { id: 'automations', name: 'Automations', level: 'problems', where: 'both', flag: 'gitAutomations', events: [
      ['automation.approval', 'Waiting for approval', 'needs'], ['automation.failed', 'Automation failed', 'problem'], ['automation.started', 'Automation started', 'info'],
      ['automation.skipped', 'Automation skipped', 'info'], ['automation.queued', 'Automation queued', 'info'], ['automation.done', 'Automation done', 'info']] },
    { id: 'chat', name: 'Chat', level: 'needs', where: 'both', events: [
      ['chat.run', 'Run to approve', 'needs'], ['chat.web', 'Web access to approve', 'needs'], ['chat.workflow', 'Workflow to review', 'needs'], ['chat.schedule', 'Schedule to approve', 'needs']] },
    { id: 'prs', name: 'Pull requests', level: 'needs', where: 'both', events: [
      ['pr.needs_person', 'PR needs you', 'needs'], ['pr.open_failed', 'Could not open PR', 'problem'], ['pr.fix_started', 'Fix started', 'info'], ['pr.published', 'Fix published', 'info']] },
    { id: 'usage', name: 'Usage', level: 'problems', where: 'both', events: [
      ['usage.near', 'Near warning line', 'problem'], ['usage.reached', 'Limit reached', 'problem'], ['usage.reset', 'Limit reset', 'info'],
      ['usage.moved', 'Start moved', 'info'], ['usage.held', 'Start held', 'problem'],
      ['budget.threshold', 'Spend near budget', 'problem'], ['budget.exceeded', 'Budget used up', 'problem']] },
    { id: 'away', name: 'Away mode', level: 'all', where: 'chat', events: [
      ['away.started', 'Away hours started', 'info'], ['away.ended', 'Away hours ended', 'info']] },
    { id: 'projects', name: 'Projects', level: 'problems', where: 'pulse', events: [
      ['project.clone_failed', 'Clone failed', 'problem'], ['project.clone_done', 'Clone finished', 'info'],
      ['project.sync_failed', 'Sync failed', 'problem'], ['project.sync_behind', 'Behind its remote', 'info']] },
  ];
  const EVENT = Object.fromEntries(GROUPS.flatMap((g) => g.events.map(([id, name, sev]) => [id, { id, name, sev, g: g.id }])));
  const CHANNELS = ['Telegram', 'Slack', 'Discord'];
  // Now › Scheduled, top to bottom.
  const SCHED = [['missed', 'Missed'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week'], ['later', 'Later'], ['after', 'After a run']];
  const LEVELS = [
    { id: 'needs', text: 'needs you', help: 'Only what waits for you: questions, gates, a watched PR that needs a person' },
    { id: 'problems', text: 'needs you and problems', help: 'Also what went wrong while nobody was waiting: a failed run, a missed start, a limit' },
    { id: 'all', text: 'everything', help: 'Also what simply happened: a run finished, a fix was published, a limit reset' },
  ];
  const WHERE = [
    { id: 'pulse', text: 'Pulse only', help: 'Kept in Pulse; nothing leaves Worca' },
    { id: 'desktop', text: 'desktop', help: 'Also a desktop notification, in browsers that allow it' },
    { id: 'chat', text: 'chat', help: 'Also a message to your chat channels (Telegram, Slack, Discord)' },
    { id: 'both', text: 'desktop and chat', help: 'Also a desktop notification and a chat message' },
  ];
  const RANK = { needs: 0, problem: 1, info: 2 };
  const LEVEL_MAX = { needs: 0, problems: 1, all: 2 };
  const qualifies = (level, sev) => RANK[sev] <= LEVEL_MAX[level];

  // Anything a run can spend against: a harness's own sign-in (Claude Code, Codex, Copilot, Cursor, the Gemini CLI) or a
  // provider through the bridge (OpenRouter's free models). Gemini reports no figures: the person sets its quota in
  // Settings › Providers and Worca counts against it; with none set it has no ring and says where to set one. `runs`: it can be picked as where a run runs.
  // `src`: who reports the figures. Windows: a short one (session) and a long one (week, day or month). A plan may have
  // only the long one: Claude's Ultra (was Max 20x) has no 5-hour session once the account is verified (30 Oct 2026);
  // its week stays.
  const PROVIDER = {
    claude: { name: 'Claude Code', vendor: 'Claude', runs: true, src: 'Reported by Claude Code' },
    codex: { name: 'Codex', vendor: 'OpenAI', runs: true, src: 'Reported by Codex' },
    copilot: { name: 'Copilot', vendor: 'GitHub', runs: true, src: 'Premium requests read from GitHub' },
    gemini: { name: 'Gemini', vendor: 'Google', runs: true, src: 'Requests Worca counted today, against the quota set in Settings › Providers' },
    openrouter: { name: 'OpenRouter', vendor: 'free models', runs: false, src: 'Free requests Worca counted today' },
  };
  const WIN = { session: 'Session', week: 'Week', day: 'Day', month: 'Month' };
  const LONG = ['week', 'day', 'month'];
  const WHAT = { day: 'daily requests', week: 'weekly limit', month: 'monthly requests', session: 'session' };

  // What a run uses of each window, per harness and Shaper's size: the median of done runs with the same agents and size
  // in the last 60 days (estimate.mjs, read against the harness's usage before and after each run). `N`: how many runs
  // it comes from. A harness with no history has no estimate, and the warning line decides alone.
  const SIZES = ['small', 'medium', 'large'];
  const EST = {
    claude: { small: { session: 4, week: 1 }, medium: { session: 12, week: 3 }, large: { session: 28, week: 7 } },
    codex: { small: { session: 3, week: 1 }, medium: { session: 10, week: 3 }, large: { session: 24, week: 6 } },
    copilot: { small: { month: 1 }, medium: { month: 3 }, large: { month: 8 } },
    gemini: { small: { day: 2 }, medium: { day: 6 }, large: { day: 15 } },
  };
  const N = { small: 21, medium: 12, large: 5 };

  // A run in Now: `state` is the library's state (runState, sectionOf: which section it sorts into) and the run page's case.
  const run = (state, title, project, detail, time, more) => ({ state, title, project, detail, time, ...more });
  // A start still to come, by when it comes (SCHED).
  const start = (when, title, project, detail, time, more) => run('scheduled', title, project, detail, time, { when, ...more });
  // An update. Its title is the event's own, then what it is about, unless it says more. Info rows arrive read. `go`: where
  // it opens in the one Worca; `to`: the same in words. `fix`: the step that deals with a problem; taking it resolves the row.
  const up = (id, e, about, meta, time, day, o = {}) => ({ id, e, g: EVENT[e].g, sev: EVENT[e].sev, title: o.title || `${EVENT[e].name} · ${about}`, meta, time, day,
    unread: EVENT[e].sev !== 'info' && !o.read, to: o.to || 'the run page', go: o.go || 'runs', ...o });
  const CASES = [
    { id: 'afternoon', label: 'A busy afternoon', desktop: 'on', task: { title: 'Add rate limiting to the public API', size: 'medium' },
      away: { status: 'here', hours: ['22:00', '07:00'] }, update: true, chatUnread: true,
      actions: [{ id: 'a1', run: 'Fix flaky login test', label: 'Dev server :4417', go: 'run/working' }, { id: 'a2', run: 'Rename settings keys', label: 'Storybook :6006', go: 'run/checks' }],
      runs: [run('question', 'Add CSV export to billing', 'billing-api', 'Plan asks 2 questions', '14:32'), run('gate', 'Migrate cron parser', 'worca-cc', 'Gate: approve the plan', '13:40'),
        run('working', 'Fix flaky login test', 'web-app', 'Build · step 3 of 5', '12 min'), run('checks', 'Rename settings keys', 'worca-cc', 'Review · checks running', '4 min'),
        start('today', 'Tidy project memory', 'worca-cc', 'Today at 18:00', '18:00'), start('tomorrow', 'Nightly dependency bump', 'web-app', 'Every day at 03:00', '03:00'), start('later', 'Quarterly licence check', 'web-app', 'Every 3 months', 'Jan 5')],
      usage: [
        { p: 'claude', plan: 'Ultra', asOf: '14:28', win: [{ k: 'week', pct: 31, resets: 'Mon 09:00' }],
          note: { text: 'No session limit on Ultra', tip: 'Anthropic removed the 5-hour session from verified Ultra accounts on 30 Oct 2026; the weekly limit stays' } },
        { p: 'codex', plan: 'Plus', asOf: '13:52', win: [{ k: 'session', pct: 12, resets: '15:10' }, { k: 'week', pct: 40, resets: 'Sun 22:00' }] },
        { p: 'copilot', plan: 'Business', asOf: '14:05', win: [{ k: 'month', pct: 71, used: 212, of: 300, resets: 'Nov 1' }] },
        { p: 'openrouter', plan: 'Free', asOf: '13:30', win: [{ k: 'day', pct: 64, used: 32, of: 50, resets: '02:00' }] }],
      budget: { period: 'this week', spent: 1225.97, saved: 69306.73 },
      updates: [
        up('u1', 'run.questions', 'Add CSV export to billing', 'billing-api · Plan asks 2 questions', '14:32', 'Today', { open: true, to: 'the run page at its questions', go: 'run/question' }),
        up('u2', 'run.failed', 'Update Node to 24', 'web-app · Test step · 3 tests failed', '13:58', 'Today', { to: 'the run page, on the step that stopped', go: 'run/failed', fix: 'Try again' }),
        up('u3', 'pr.published', '#962 Retry on 502', 'web-app · watched PR · checks green', '13:10', 'Today', { to: 'the fix run', go: 'run/checks' }),
        up('u4', 'schedule.missed', 'Nightly dependency bump', 'web-app · Worca was not running at 03:00', '09:02', 'Today', { to: 'Schedules, with its sheet open', go: 'schedules', fix: 'Run now' }),
        up('u5', 'run.done', 'Tidy the settings page', 'worca-cc · 18 min · $1.42', '08:40', 'Today', { go: 'run/ready' }),
        up('u6', 'usage.reset', '', 'OpenAI · Plus · Session', '17:05', 'Yesterday', { title: 'Codex session reset · 1 run resumed', to: 'the resumed run', go: 'run/working' }),
        up('u7', 'run.questions', 'Split the auth module', 'worca-cc · answered at 11:20', '11:02', 'Yesterday', { read: true, resolved: true, go: 'run/working' }),
        up('u8', 'project.clone_done', 'acme/design-tokens', 'Projects · 2.1 MB', '10:15', 'Yesterday', { to: 'the project page', go: 'projects' })] },
    { id: 'near', label: 'Session near its limit', desktop: 'unsupported', task: { title: 'Add rate limiting to the public API', size: 'large' },
      away: { status: 'no-hours' }, actions: [],
      runs: [run('working', 'Fix flaky login test', 'web-app', 'Build · step 3 of 5 · Claude Code', '12 min'), run('slice', 'Rate limiting · slice 2 of 4', 'web-app', 'Build · Codex · moved from Claude Code at the start', '6 min'),
        // Worca starts these with nobody there to ask: each is checked against its own estimate when its turn comes.
        start('after', 'Rate limiting · slice 3 of 4', 'web-app', '', 'next', { slice: true, on: 'claude', size: 'large' }),
        start('after', 'Rename the config flag', 'worca-cc', '', 'next', { queued: true, on: 'claude', size: 'small' })],
      usage: [
        { p: 'claude', plan: 'Max', asOf: '14:28', win: [{ k: 'session', pct: 86, resets: '16:40' }, { k: 'week', pct: 52, resets: 'Mon 09:00' }] },
        { p: 'codex', plan: 'Plus', asOf: '14:24', win: [{ k: 'session', pct: 20, resets: '15:10' }, { k: 'week', pct: 44, resets: 'Sun 22:00' }] }],
      budget: { period: 'this week', spent: 312.4, saved: 9120.55 },
      updates: [
        up('n0', 'usage.moved', '', 'web-app · Claude Code\'s session was at 84% · the slice keeps Codex to the end', '14:24', 'Today', { title: 'Slice 2 of 4 moved to Codex · Rate limiting', to: 'the slice\'s run page', go: 'run/slice' }),
        up('n1', 'usage.near', '', 'Claude · Max · runs on it may pause before it resets', '14:20', 'Today', { title: 'Claude Code session at 80% · resets 16:40', to: 'the usage card', go: 'usage' }),
        up('n2', 'run.done', 'Tidy the settings page', 'worca-cc · 18 min · $1.42', '13:40', 'Today', { go: 'run/ready' }),
        up('n3', 'pr.fix_started', '#962 Retry on 502', 'web-app · watched PR · 2 checks failing', '11:30', 'Today', { to: 'the fix run', go: 'run/working' })] },
    { id: 'reached', label: 'Weekly limit reached', desktop: 'on', task: { title: 'Add rate limiting to the public API', size: 'medium' },
      away: { status: 'paused' }, actions: [{ id: 'a1', run: 'Rename settings keys', label: 'Preview :3000', go: 'run/checks' }],
      runs: [run('checks', 'Rename settings keys', 'worca-cc', 'Review · checks running', '4 min'), run('paused', 'Update the changelog', 'docs-site', 'Usage limit · resumes Mon 09:05', '11:05'),
        start('tomorrow', 'Nightly dependency bump', 'web-app', 'Every day at 03:00', '03:00')],
      usage: [
        { p: 'claude', plan: 'Max', asOf: '14:28', win: [{ k: 'session', pct: 30, resets: '16:40' }, { k: 'week', pct: 61, resets: 'Mon 09:00' }] },
        { p: 'codex', plan: 'Plus', asOf: '11:05', win: [{ k: 'session', pct: 64, resets: '15:10' }, { k: 'week', pct: 100, resets: 'Mon 09:00' }], paused: 2 }],
      budget: { period: 'this week', spent: 488.1, saved: 15402.2 },
      updates: [
        up('r1', 'usage.reached', '', 'OpenAI · Plus · they resume by themselves Mon 09:05', '11:05', 'Today', { title: 'Codex weekly limit reached · 2 runs paused', to: 'Runs, filtered to the paused runs', go: 'runs' }),
        up('r2', 'run.failed', 'Update Node to 24', 'web-app · Test step · 3 tests failed', '09:58', 'Today', { to: 'the run page, on the step that stopped', go: 'run/failed', fix: 'Try again' }),
        up('r3', 'usage.near', '', 'OpenAI · Plus', '16:12', 'Yesterday', { title: 'Codex week at 80% · resets Mon 09:00', read: true, to: 'the usage card', go: 'usage' })] },
    { id: 'budget', label: 'Spend near its budget', desktop: 'off', task: { title: 'Add rate limiting to the public API', size: 'medium' },
      away: { status: 'away-now' }, actions: [],
      runs: [run('capped', 'Add CSV export to billing', 'billing-api', 'Cost cap reached at $5.00', '10:12')],
      usage: [{ p: 'claude', plan: 'API key', asOf: '10:12', win: [] }],
      budget: { period: 'in October', spent: 92, limit: 100 },
      updates: [
        up('b1', 'run.cost_cap', 'Add CSV export to billing', 'billing-api · paused at $5.00 · raise the cap or stop', '10:12', 'Today', { open: true, to: 'the run page at its cost cap', go: 'run/capped' }),
        up('b2', 'budget.threshold', '', 'Budget · $80.40 of $100', '09:30', 'Today', { title: 'Spend at 80% of $100 in October', to: 'Statistics', go: 'stats' })] },
    { id: 'gemini', label: 'Gemini only', desktop: 'insecure', task: { title: 'Write the API reference for v2', size: 'large' },
      away: { status: 'here', hours: ['20:00', '08:00'] }, actions: [],
      runs: [run('working', 'Write the API reference', 'docs-site', 'Build · step 2 of 4', '7 min')],
      usage: [{ p: 'gemini', plan: 'Free tier', asOf: '14:02', win: [{ k: 'day', pct: 84, used: 840, of: 1000, resets: '02:00' }] }],
      budget: null,
      updates: [
        up('g1', 'usage.near', '', 'Gemini · Free · 800 of 1,000 requests', '13:44', 'Today', { title: 'Gemini daily requests at 80% · resets 02:00', to: 'the usage card', go: 'usage' })] },
    { id: 'quiet', label: 'All quiet', desktop: 'blocked', task: { title: 'Add rate limiting to the public API', size: 'small' },
      away: { status: 'unknown' }, actions: [],
      runs: [],
      usage: [{ p: 'claude', plan: 'Pro', asOf: '09:15', win: [{ k: 'session', pct: 5, resets: '13:30' }, { k: 'week', pct: 12, resets: 'Thu 08:00' }] }],
      budget: { period: 'this week', spent: 18.2, saved: 402.1 },
      updates: [
        up('q1', 'run.done', 'Tidy the settings page', 'worca-cc · 18 min · $1.42', '09:15', 'Today', { go: 'run/ready' })] },
    // A shared sign-in with one of every kind: the card, the team's note, a blocked budget, every Now section and event.
    { id: 'every', label: 'Every kind, shared sign-in', desktop: 'on', task: { title: 'Add rate limiting to the public API', size: 'medium' },
      identity: { people: ['Emil Angelov', 'Dana Ruiz'], via: 'Through your team\'s sign-in' }, teamSetup: true, update: true, chatUnread: true,
      away: { status: 'away-hours', hours: ['18:00', '08:00'] },
      actions: [{ id: 'a1', run: 'Fix flaky login test', label: 'Dev server :4417', go: 'run/working' }, { id: 'a2', run: 'A removed run', label: 'Tunnel :8080', go: '' }],
      runs: [run('question', 'Add CSV export to billing', 'billing-api', 'Plan asks 2 questions', '14:32'), run('failed', 'Update Node to 24', 'web-app', 'Test step · 3 tests failed', '13:58'),
        run('paused', 'Update the changelog', 'docs-site', 'Night guardrail · waits for you', '02:10'), run('approved', 'Retry on 502', 'web-app', '#962 approved · checks pass', '12:40'),
        run('working', 'Fix flaky login test', 'web-app', 'Build · step 3 of 5', '12 min'), run('starting', 'Add audit log', 'worca-cc', 'Setting up its worktree', '1 min'),
        start('missed', 'Nightly dependency bump', 'web-app', 'Was due at 03:00', '03:00'), start('today', 'Tidy project memory', 'worca-cc', 'Today at 18:00', '18:00'),
        start('tomorrow', 'Refresh the docs index', 'docs-site', 'Tomorrow at 06:00', '06:00'), start('week', 'Weekly digest', 'worca-cc', 'Every Friday at 09:00', 'Fri'),
        start('later', 'Quarterly licence check', 'web-app', 'Every 3 months', 'Jan 5'), start('after', 'Deploy docs site', 'docs-site', 'After Add audit log', 'next')],
      usage: [
        { p: 'claude', plan: 'Max', asOf: '14:28', win: [{ k: 'session', pct: 86, resets: '16:40' }, { k: 'week', pct: 52, resets: 'Mon 09:00' }] },
        { p: 'copilot', plan: 'Business', asOf: '14:05', win: [{ k: 'month', pct: 71, used: 212, of: 300, resets: 'Nov 1' }] },
        { p: 'gemini', plan: 'CLI', asOf: '13:02', win: [], noQuota: true }],
      budget: { period: 'in November', spent: 100, limit: 100, blocked: true },
      updates: [
        up('e01', 'run.questions', 'Add CSV export to billing', 'billing-api · Plan asks 2 questions', '14:32', 'Today', { open: true, to: 'the run page at its questions', go: 'run/question' }),
        up('e02', 'run.gate', 'Migrate cron parser', 'worca-cc · approve the plan', '14:20', 'Today', { open: true, to: 'the run page at its gate', go: 'run/gate' }),
        up('e03', 'run.recovery', 'Update Node to 24', 'web-app · the same step failed three times', '14:10', 'Today', { open: true, go: 'run/failed' }),
        up('e04', 'run.workflow', 'Add audit log', 'worca-cc · Shaper proposes a workflow', '14:02', 'Today', { open: true, go: 'run/plan' }),
        up('e05', 'run.cost_cap', 'Add CSV export to billing', 'billing-api · paused at $5.00', '13:55', 'Today', { open: true, go: 'run/capped' }),
        up('e06', 'run.failed', 'Update Node to 24', 'web-app · Test step · 3 tests failed', '13:50', 'Today', { go: 'run/failed', fix: 'Try again' }),
        up('e07', 'run.paused_limit', 'Write the API reference', 'docs-site · Gemini refused: daily quota', '13:40', 'Today', { go: 'run/paused', fix: 'Resume' }),
        up('e08', 'run.paused_error', 'Rename settings keys', 'worca-cc · lost the connection to the model', '13:30', 'Today', { go: 'run/paused', fix: 'Resume' }),
        up('e09', 'run.paused_night', 'Update the changelog', 'docs-site · 20 answers while you were away', '02:10', 'Today', { go: 'run/paused', fix: 'Resume' }),
        up('e10', 'run.paused_time', 'Fix flaky login test', 'web-app · Build ran past its time limit', '01:40', 'Today', { go: 'run/paused', fix: 'Resume' }),
        up('e11', 'run.paused_stopped', 'Add audit log', 'worca-cc · resume it when you are ready', '01:05', 'Today', { go: 'run/paused', fix: 'Resume' }),
        up('e12', 'run.done', 'Tidy the settings page', 'worca-cc · 18 min · $1.42', '00:40', 'Today', { go: 'run/ready' }),
        up('e13', 'run.resumed', 'Rate limiting', 'web-app · after the session reset', '00:20', 'Today', { go: 'run/working' }),
        up('e20', 'schedule.missed', 'Nightly dependency bump', 'web-app · Worca was not running at 03:00', '09:02', 'Yesterday', { to: 'Schedules, with its sheet open', go: 'schedules', fix: 'Run now' }),
        up('e21', 'schedule.failed', 'Weekly digest', 'worca-cc · its project is missing', '09:00', 'Yesterday', { to: 'Schedules, with its sheet open', go: 'schedules', fix: 'Run now' }),
        up('e22', 'schedule.run_error', 'Refresh the docs index', 'docs-site · ended with an error', '06:12', 'Yesterday', { go: 'run/failed', fix: 'Try again' }),
        up('e23', 'schedule.run_paused', 'Tidy project memory', 'worca-cc · paused at its cost cap', '06:05', 'Yesterday', { go: 'run/paused', fix: 'Resume' }),
        up('e24', 'schedule.self_paused', 'Weekly digest', 'worca-cc · 3 failures in a row', '06:00', 'Yesterday', { to: 'Schedules, with its sheet open', go: 'schedules', fix: 'Resume' }),
        up('e25', 'schedule.late', 'Nightly dependency bump', 'web-app · started 40 min late', '03:40', 'Yesterday', { to: 'the run', go: 'run/working' }),
        up('e26', 'schedule.retrying', 'Nightly dependency bump', 'web-app · try 2 of 3 in 5 min', '03:05', 'Yesterday', { to: 'Schedules', go: 'schedules' }),
        up('e27', 'schedule.skipped', 'Tidy project memory', 'worca-cc · the last run is still going', '03:00', 'Yesterday', { to: 'Schedules', go: 'schedules' }),
        up('e28', 'schedule.canceled', 'Deploy docs site', 'docs-site · canceled by you', '02:50', 'Yesterday', { to: 'Schedules', go: 'schedules' }),
        up('e29', 'schedule.ended', 'Quarterly licence check', 'web-app · reached its end', '02:40', 'Yesterday', { to: 'Schedules', go: 'schedules' }),
        up('e30', 'schedule.completed', 'Tidy project memory', 'worca-cc · 4 min · $0.20', '02:30', 'Yesterday', { go: 'run/ready' }),
        up('e40', 'automation.approval', 'Issue #88 opened', 'web-app · a rule wants to start a run', '11:02', 'Yesterday', { open: true, to: 'Settings › Automations', go: 'settings/automations' }),
        up('e41', 'automation.failed', 'Issue #87 opened', 'web-app · the workflow is missing', '10:58', 'Yesterday', { to: 'Settings › Automations', go: 'settings/automations' }),
        up('e42', 'automation.started', 'PR #961 opened', 'web-app · run started', '10:50', 'Yesterday', { go: 'run/working' }),
        up('e43', 'automation.skipped', 'Issue #86 opened', 'web-app · no rule matched its labels', '10:40', 'Yesterday', { to: 'Settings › Automations', go: 'settings/automations' }),
        up('e44', 'automation.queued', 'Issue #85 opened', 'web-app · waits for a free slot', '10:30', 'Yesterday', { go: 'runs', to: 'Runs' }),
        up('e45', 'automation.done', 'Issue #84 opened', 'web-app · run finished', '10:20', 'Yesterday', { go: 'run/ready' }),
        up('e50', 'chat.run', 'Plan the API rewrite', 'Chat · a run waits for your OK', '10:12', 'Yesterday', { open: true, to: 'the chat', go: 'chat' }),
        up('e51', 'chat.web', 'Why did the build fail', 'Chat · wants to reach npmjs.com', '10:08', 'Yesterday', { open: true, to: 'the chat', go: 'chat' }),
        up('e52', 'chat.workflow', 'Release checklist', 'Chat · a workflow waits for your OK', '10:04', 'Yesterday', { open: true, to: 'the chat', go: 'chat' }),
        up('e53', 'chat.schedule', 'Nightly tidy', 'Chat · a schedule waits for your OK', '10:00', 'Yesterday', { open: true, to: 'the chat', go: 'chat' }),
        up('e60', 'pr.needs_person', '#960 Fix the login race', 'web-app · two reviewers disagree', '09:50', 'Earlier', { open: true, to: 'the run page', go: 'run/failing' }),
        up('e61', 'pr.open_failed', 'Tidy the settings page', 'worca-cc · GitHub refused the push', '09:40', 'Earlier', { go: 'run/ready', fix: 'Open PR' }),
        up('e62', 'pr.fix_started', '#962 Retry on 502', 'web-app · 2 checks failing', '09:30', 'Earlier', { to: 'the fix run', go: 'run/working' }),
        up('e63', 'pr.published', '#962 Retry on 502', 'web-app · checks green', '09:20', 'Earlier', { to: 'the fix run', go: 'run/checks' }),
        up('e70', 'usage.near', '', 'Claude · Max', '09:10', 'Earlier', { title: 'Claude Code session at 80% · resets 16:40', to: 'the usage card', go: 'usage' }),
        up('e71', 'usage.reached', '', 'OpenAI · Plus', '09:00', 'Earlier', { title: 'Codex weekly limit reached · 2 runs paused', to: 'Runs', go: 'runs' }),
        up('e72', 'usage.reset', '', 'OpenAI · Plus', '08:50', 'Earlier', { title: 'Codex session reset · 1 run resumed', to: 'the resumed run', go: 'run/working' }),
        up('e73', 'usage.moved', '', 'web-app · the slice keeps Codex to the end', '08:40', 'Earlier', { title: 'Slice 2 of 4 moved to Codex · Rate limiting', go: 'run/slice' }),
        up('e74', 'usage.held', '', 'web-app · no harness has room', '08:30', 'Earlier', { title: 'Slice 3 of 4 waits for 16:40 · Rate limiting', go: 'run/scheduled' }),
        up('e75', 'budget.threshold', '', 'Budget · $80.40 of $100', '08:20', 'Earlier', { title: 'Spend at 80% of $100 in November', to: 'Statistics', go: 'stats' }),
        up('e76', 'budget.exceeded', '', 'Budget · runs pause until it resets or you raise it', '08:10', 'Earlier', { title: 'Budget of $100 used up', to: 'Settings › Runs', go: 'settings/runs', fix: 'Raise limit' }),
        up('e80', 'away.started', '', 'Until 08:00', '18:00', 'Earlier', { title: 'Away hours started', to: 'Settings › Runs', go: 'settings/runs' }),
        up('e81', 'away.ended', '', 'Since 18:00 yesterday', '08:00', 'Earlier', { title: 'Away hours ended', to: 'Settings › Runs', go: 'settings/runs' }),
        up('e90', 'project.clone_failed', 'acme/old-api', 'Projects · the repository is gone', '07:50', 'Earlier', { to: 'the project page', go: 'projects', fix: 'Try again' }),
        up('e91', 'project.clone_done', 'acme/design-tokens', 'Projects · 2.1 MB', '07:40', 'Earlier', { to: 'the project page', go: 'projects' }),
        up('e92', 'project.sync_failed', 'web-app', 'Projects · local changes in the way', '07:30', 'Earlier', { to: 'the project page', go: 'projects', fix: 'Try again' }),
        up('e93', 'project.sync_behind', 'billing-api', 'Projects · 12 commits behind origin', '07:20', 'Earlier', { to: 'the project page', go: 'projects' })] },
  ];

  // The Away row in the profile menu: its hint and tip, from where the person stands (the app's describeAwayRow).
  const TURN_ON = 'Turn Away on to have Worca answer waiting run questions for you.';
  function awayRow({ status, hours }) {
    const here = { state: 'here', disabled: false }, away = { state: 'away', disabled: false };
    switch (status) {
      case 'here': return { ...here, hint: `away at ${hours[0]}`, tip: `Away hours run ${hours[0]} to ${hours[1]}. ${TURN_ON}` };
      case 'no-hours': return { ...here, hint: '', tip: `No away hours are set. ${TURN_ON}` };
      case 'paused': return { ...here, hint: 'Away mode paused', tip: 'Away mode is paused: Worca answers nothing. Turn Away on to have Worca answer for you.' };
      case 'away-now': return { ...away, hint: '', tip: 'You said you are away. Worca answers waiting run questions for you until you turn Away off.' };
      case 'away-hours': return { ...away, hint: `until ${hours[1]}`, tip: `Away hours until ${hours[1]}. Turn Away off to count as here until they end.` };
      default: return { ...here, hint: '', disabled: true, tip: 'Could not read away mode. Worca tries again by itself.' };
    }
  }
  // What the away screensaver says: the most pressing thing wins.
  function awayLine(needs, running) {
    if (needs) return needs === 1 ? 'When you have a moment, a run would like an answer.' : `When you have a moment, ${needs} runs would like an answer.`;
    return running ? 'Everything is under control.' : 'All quiet. Enjoy the break.';
  }

  // What the top bar's search finds beyond Settings (pulse.js adds those). `min` and `flag`: what must be on for it to
  // show, the search's lock note. `go`: where it lands; a captured page just opens.
  const F = (kind, label, where, go, o) => ({ kind, label, where, go, ...o });
  const FINDS = [
    F('run', 'Add CSV export to billing', 'Run · billing-api', 'run/question', { labels: ['billing', 'ui'] }), F('run', 'Migrate cron parser', 'Run · worca-cc', 'run/gate', { labels: ['backend'] }),
    F('run', 'Fix flaky login test', 'Run · web-app', 'run/working', { labels: ['ui', 'tests'] }), F('run', 'Rename settings keys', 'Run · worca-cc', 'run/checks', { labels: ['backend'] }), F('run', 'Unified page navigation', 'Run · web-app', 'run/ready', { labels: ['ui'] }),
    F('project', 'billing-api', 'Project', 'projects'), F('project', 'web-app', 'Project', 'projects'), F('project', 'worca-cc', 'Project', 'projects'), F('project', 'docs-site', 'Project', 'projects'),
    F('workspace', 'platform-core', 'Workspace', 'workspaces', { min: 'advanced' }),
    F('workflow', 'Default', 'Workflow · 5 agents', 'workflows'), F('workflow', 'Lean', 'Workflow · 4 agents', 'workflows'), F('workflow', 'Shaper', 'Workflow · 6 agents', 'workflows'), F('workflow', 'Promo video', 'Workflow · 8 agents', 'workflows'), F('workflow', 'Architecture (C4)', 'Workflow · 2 agents', 'workflows'),
    F('schedule', 'Nightly dependency bump', 'Schedule · every day', 'schedules', { min: 'advanced' }), F('schedule', 'Weekly digest', 'Schedule · every Friday', 'schedules', { min: 'advanced' }),
    F('ticket', 'Deploy docs site', 'Scheduled once · after a run', 'schedules', { min: 'advanced' }), F('ticket', 'Tidy project memory', 'Scheduled once · today 18:00', 'schedules', { min: 'advanced' }),
    F('label', 'ui', 'Label · Runs', 'runs', { flag: 'runLabels' }), F('label', 'billing', 'Label · Runs', 'runs', { flag: 'runLabels' }), F('label', 'backend', 'Label · Runs', 'runs', { flag: 'runLabels' }), F('label', 'tests', 'Label · Runs', 'runs', { flag: 'runLabels' }),
    F('addon', 'Statistics', 'Place', 'stats', { min: 'advanced' }), F('addon', 'Team metrics', 'Place', 'team-metrics', { min: 'expert' }), F('addon', 'Requirements', 'Place · Labs', 'requirements', { flag: 'requirements' }), F('addon', 'Marketplace', 'Add-ons', 'marketplace', { min: 'advanced' }),
    F('plugin', 'github-source', 'Plugin · Marketplace', 'marketplace', { min: 'advanced' }), F('plugin', 'jira-source', 'Plugin · Marketplace', 'marketplace', { min: 'advanced' }), F('plugin', 'telegram-chat', 'Plugin · Marketplace', 'marketplace', { min: 'advanced' }),
    F('plugin', 'slack-chat', 'Plugin · Marketplace', 'marketplace', { min: 'advanced' }), F('plugin', 'discord-chat', 'Plugin · Marketplace', 'marketplace', { min: 'advanced' }),
    F('chat', 'Why did the build fail', 'Chat · today', 'chat'), F('chat', 'Plan the API rewrite', 'Chat · yesterday', 'chat'), F('chat', 'Release checklist', 'Chat · Oct 28', 'chat'),
  ];
  const FLAG_ROW = { requirements: 'Requirements', runLabels: 'Run labels', gitAutomations: 'Git automations' };
  // `label:ui`: the runs with that label. Otherwise the name, or a word of where it lives, anywhere in the text.
  function find(q) {
    const raw = q.trim().toLowerCase();
    const m = raw.match(/^label:\s*(.*)$/);
    if (m) return FINDS.filter((f) => f.kind === 'run' && (f.labels || []).some((l) => l.includes(m[1]))).map((f) => ({ ...f, flag: 'runLabels' }));
    return FINDS.filter((f) => f.label.toLowerCase().includes(raw) || f.kind.startsWith(raw));
  }

  // The tone of a share: '' under the warning line, warn at or over it, over when used up.
  const tone = (pct, warnAt) => (pct >= 100 ? 'over' : pct >= warnAt ? 'warn' : '');
  const winWord = (k) => WIN[k];

  const usd = (n) => '$' + n.toLocaleString('en', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const spendPct = (b) => (b && b.limit ? Math.round((b.spent / b.limit) * 100) : null);
  // A window in words: "86%", or the count where the provider counts requests ("212 of 300").
  const fig = (w) => (w.of ? `${w.used.toLocaleString('en')} of ${w.of.toLocaleString('en')}` : `${w.pct}%`);

  // The avatar's rings, outside in: Session, then the long window (a week; a day or a month where that is the only
  // one), then Spend when a budget has a limit. Each shows its tightest provider; a ring nobody reports is not drawn.
  function rings(c, warnAt) {
    const out = [];
    for (const [slot, kinds] of [['session', ['session']], ['long', LONG]]) {
      let best = null;
      for (const u of c.usage) for (const w of u.win) if (kinds.includes(w.k) && (!best || w.pct > best.pct)) best = { ...w, p: u.p };
      if (best) out.push({ slot, pct: best.pct, tone: tone(best.pct, warnAt),
        line: `${winWord(best.k)} ${best.pct}% · ${PROVIDER[best.p].name} · ${best.pct >= 100 ? 'reached, resets' : 'resets'} ${best.resets}` });
    }
    const sp = spendPct(c.budget);
    if (sp != null) out.push({ slot: 'spend', pct: sp, tone: tone(sp, warnAt), line: `Spend ${usd(c.budget.spent)} of ${usd(c.budget.limit)} ${c.budget.period}` });
    return out;
  }

  // Limits in Now: each window at or over the warning line, and the budget. It is a state: it goes when the window resets.
  function limits(c, warnAt) {
    const out = [];
    for (const u of c.usage) for (const w of u.win) {
      if (w.pct < warnAt) continue;
      const name = PROVIDER[u.p].name;
      const what = { day: 'daily requests', week: 'weekly limit', month: 'monthly requests', session: 'session' }[w.k];
      out.push(w.pct >= 100
        ? { p: u.p, tone: 'over', title: `${name} ${what} reached`, detail: `${u.paused || 0} runs paused · they resume by themselves after it resets`, time: w.resets, tip: `Resets ${w.resets}` }
        : { p: u.p, tone: 'warn', title: `${name} ${what} at ${w.pct}%`, detail: `Resets ${w.resets} · runs on ${name} may pause before then`, time: w.resets, tip: `Resets ${w.resets}` });
    }
    const sp = spendPct(c.budget);
    if (sp != null && sp >= warnAt) out.push({ tone: sp >= 100 ? 'over' : 'warn', title: `Spend at ${sp}% of ${usd(c.budget.limit)}`, detail: `${c.budget.period[0].toUpperCase() + c.budget.period.slice(1)} · runs stop at the budget`, time: 'Nov 1', tip: 'The budget resets on 1 November' });
    return out;
  }

  // Now's runs by the section their state sorts into: `sectionOf` and `wordOf` come from the library (run-state.mjs).
  function nowRuns(c, sectionOf, wordOf) {
    const out = { needs: [], running: [], scheduled: [] };
    for (const r of c.runs) out[sectionOf(wordOf(r.state))]?.push(r);
    return out;
  }

  // What a run of this size uses of each window on a harness, or null when it has no history.
  const est = (p, size) => (size && EST[p] && EST[p][size]) || null;
  // The window a start on this harness would run into, or null. With an estimate: one whose use plus the run's share is
  // over 100%, so a small run near a limit still starts. With none: one at or over the warning line.
  function near(c, p, warnAt, size) {
    const u = c.usage.find((x) => x.p === p); if (!u) return null;
    const e = est(p, size);
    const hit = u.win.map((w) => ({ ...w, need: e && e[w.k] != null ? e[w.k] : null }))
      .filter((w) => (w.need != null ? w.pct + w.need > 100 : w.pct >= warnAt))
      .sort((a, b) => b.pct + (b.need || 0) - (a.pct + (a.need || 0)))[0];
    return hit ? { ...hit, p, name: PROVIDER[p].name, what: WHAT[hit.k], left: Math.max(0, 100 - hit.pct) } : null;
  }
  // The harnesses with room: set up, able to run the run, and the run fits (or, with no estimate, every window under the
  // warning line); the most room first.
  function room(c, warnAt, except, size) {
    return c.usage.filter((u) => u.p !== except && PROVIDER[u.p].runs && u.win.length && !near(c, u.p, warnAt, size))
      .sort((a, b) => Math.max(...a.win.map((w) => w.pct)) - Math.max(...b.win.map((w) => w.pct))).map((u) => u.p);
  }

  window.PulseModel = { nowRuns, awayRow, awayLine, FINDS, FLAG_ROW, find, EVENT, CHANNELS, SCHED, GROUPS, LEVELS, WHERE, PROVIDER, CASES, SIZES, N, WHAT, qualifies, tone, rings, limits, near, room, est, winWord, fig, usd, spendPct };
})();
