// Pulse mock: the cases, the event catalogue by group, and the pure figures the renderer paints (pulse.js).
// Spec: plans/rail/pulse.md. Vitals is a state, Updates is an event; usage is read per provider and window.
(function () {
  const R = window.RailUI, W = window.RailWorld;   // who is running what, and the usage and spend behind it, come from shell/world.js
  // The groups, in Settings order. Each event: its id, its own title, its severity: needs (waiting for a person), problem
  // (went wrong while nobody waited), info (simply happened). A group with a `flag` follows that Labs feature.
  // Your own Pause and a drain (the server stopping) wait on nobody: they are not events and never notify.
  const GROUPS = [
    { id: 'runs', name: 'Runs', level: 'problems', where: 'both', events: [
      ['run.questions', 'Questions waiting', 'needs'], ['run.gate', 'Approval needed', 'needs'], ['run.recovery', 'Recovery decision needed', 'needs'],
      ['run.workflow', 'Workflow to review', 'needs'], ['run.cost_cap', 'Cost cap reached', 'needs'], ['run.failed', 'Task failed', 'problem'],
      ['run.paused_limit', 'Usage limit reached', 'problem'], ['run.paused_error', 'Paused on error', 'problem'], ['run.paused_night', 'Night guardrail reached', 'problem'],
      ['run.paused_time', 'Time limit reached', 'problem'], ['run.paused_stopped', 'Worca was stopped', 'problem'], ['run.done', 'Run finished', 'info'], ['run.resumed', 'Resumed after limit', 'info']] },
    { id: 'schedules', name: 'Schedules', level: 'problems', where: 'both', events: [
      ['schedule.missed', 'Start missed', 'problem'], ['schedule.failed', 'Could not start', 'problem'], ['schedule.run_error', 'Scheduled run failed', 'problem'], ['schedule.run_paused', 'Run paused', 'problem'],
      ['schedule.self_paused', 'Series paused itself', 'problem'], ['schedule.late', 'Started late', 'info'], ['schedule.retrying', 'Retrying a start', 'info'], ['schedule.skipped', 'Start skipped', 'info'],
      ['schedule.canceled', 'Start canceled', 'info'], ['schedule.ended', 'Series ended', 'info'], ['schedule.completed', 'Scheduled run finished', 'info']] },
    { id: 'automations', name: 'Automations', level: 'problems', where: 'both', flag: 'gitAutomations', events: [
      ['automation.approval', 'Waiting for approval', 'needs'], ['automation.failed', 'Automation failed', 'problem'], ['automation.started', 'Automation started', 'info'],
      ['automation.skipped', 'Automation skipped', 'info'], ['automation.queued', 'Automation queued', 'info'], ['automation.done', 'Automation done', 'info']] },
    { id: 'chat', name: 'Chat', level: 'needs', where: 'both', events: [
      ['chat.run', 'Task to approve', 'needs'], ['chat.web', 'Web access to approve', 'needs'], ['chat.workflow', 'Workflow to review', 'needs'], ['chat.schedule', 'Schedule to approve', 'needs']] },
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
    { id: 'app', name: 'Worca', level: 'all', where: 'pulse', events: [['app.update_available', 'New version', 'info']] },
  ];
  const EVENT = Object.fromEntries(GROUPS.flatMap((g) => g.events.map(([id, name, sev]) => [id, { id, name, sev, g: g.id }])));
  // Vitals › Scheduled, top to bottom.
  const SCHED = [['missed', 'Missed'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week'], ['later', 'Later'], ['after', 'After a run'], ['reset', 'After a reset']];
  const LEVELS = [
    { id: 'needs', text: 'what needs you', help: 'Only what waits for you: questions, gates, a watched PR that needs a person' },
    { id: 'problems', text: 'what needs you and problems', help: 'Also what went wrong while nobody was waiting: a failed run, a missed start, a limit' },
    { id: 'all', text: 'everything', help: 'Also what simply happened: a run finished, a fix was published, a limit reset' },
  ];
  const WHERE = [
    { id: 'pulse', text: 'Stays in Pulse only', help: 'Kept in Pulse; nothing leaves Worca' },
    { id: 'desktop', text: 'desktop', help: 'Also a desktop notification, in browsers that allow it' },
    { id: 'chat', text: 'chat', help: 'Also a message to your working chat channels' },
    { id: 'both', text: 'desktop and chat', help: 'Also a desktop notification and a chat message' },
  ];
  // Notifications' other sentences: each reads right for every choice (gates/settings-sentences.mjs).
  const BADGE = [{ id: 'needs', text: 'counts what needs you', help: 'The tab title, the favicon\'s dot and the app icon show while 2 runs wait for you' }, { id: 'problems', text: 'counts what needs you and problems', help: 'Also unread problems: a failed run, a missed start, a limit' }, { id: 'none', text: 'shows no count', help: 'The tab title never shows a count' }];
  const chatWords = (names) => (names.length ? `Sent to ${names.join(', ')}` : 'No chat channel is working');
  const RANK = { needs: 0, problem: 1, info: 2 };
  const LEVEL_MAX = { needs: 0, problems: 1, all: 2 };
  const qualifies = (level, sev) => RANK[sev] <= LEVEL_MAX[level];

  // Anything a run can spend against: a harness's own sign-in (Claude Code, Codex, Copilot, Cursor, the Gemini CLI) or a
  // provider through the bridge (OpenRouter's free models). Gemini reports no figures: the person sets its quota in
  // Settings › Models › Sign-ins and Worca counts against it; with none set it has no ring and says where to set one. `runs`: it can be picked as where a run runs.
  // `src`: who reports the figures. Windows: a short one (session) and a long one (week, day or month). A plan may have
  // only the long one: Claude's Ultra (was Max 20x) has no 5-hour session once the account is verified (30 Oct 2026);
  // its week stays.
  const PROVIDER = {
    claude: { name: 'Claude Code', vendor: 'Claude', runs: true, src: 'Reported by Claude Code' },
    codex: { name: 'Codex', vendor: 'OpenAI', runs: true, src: 'Reported by Codex' },
    copilot: { name: 'Copilot', vendor: 'GitHub', runs: true, src: 'Premium requests read from GitHub' },
    gemini: { name: 'Gemini', vendor: 'Google', runs: true, src: 'Requests Worca counted today, against the quota set in Settings › Models › Sign-ins' },
    openrouter: { name: 'OpenRouter', vendor: 'free models', runs: false, src: 'Free requests Worca counted today' },
  };
  const WIN = { session: 'Session', week: 'Week', day: 'Day', month: 'Month' };
  const LONG = ['week', 'day', 'month'];
  const WHAT = { day: 'daily requests', week: 'weekly limit', month: 'monthly requests', session: 'session' };

  // Where each kind of update opens: one destination per kind, and `to` says it. A run's own kinds open that run, as the
  // world has it now. Limits and the budget open Usage and costs; a step on the row may go further (Raise budget).
  const DEST = { schedule: { go: 'schedules', to: 'Schedules' }, automation: { go: 'settings/automations', to: 'Settings › Automations', land: 'automations|Automations' }, project: { go: 'projects', to: 'Projects' },
    away: { go: 'settings/runs', to: 'Settings › Runs' }, budget: { go: 'usage', to: 'Usage and costs' }, 'usage.near': { go: 'usage', to: 'Usage and costs' }, 'usage.reached': { go: 'usage', to: 'Usage and costs' },
    app: { go: 'settings/general', to: 'Settings › General, on the version', land: 'general|Version' } };
  // An update. Its title is the event's own, then what it is about, unless it says more. Info rows arrive read. `run`: the
  // world's run it is about (it must be in the case). `chat`: the chat it opens. `fix`: the step that deals with a problem;
  // taking it resolves the row, or `fixLand` takes you to where it is done.
  const up = (id, e, about, meta, time, day, o = {}) => ({ id, e, g: EVENT[e].g, sev: EVENT[e].sev, title: o.title || `${EVENT[e].name} · ${about}`, meta, time, day, unread: EVENT[e].sev !== 'info' && !o.read,
    ...(o.chat ? { go: `chat/${o.chat}`, to: 'the chat' } : DEST[e] || DEST[e.split('.')[0]] || (o.run ? { go: 'run', to: 'the run page' } : { go: 'runs', to: 'Runs' })), ...o });
  // An update about one of the world's runs: its title and project are the run's own.
  const ofRun = (id, e, runId, meta, time, day, o = {}) => up(id, e, W.title(runId), `${W.project(runId)} · ${meta}`, time, day, { run: runId, ...o });
  const NEW_VERSION = (id) => up(id, 'app.update_available', '', 'you run 1.19', '08:40', 'Today', { title: 'New version: 1.20' });
  const CASES = [
    { id: 'afternoon', label: 'A busy afternoon', desktop: 'on', task: { title: 'Add rate limiting to the public API' },
      away: { status: 'here', hours: ['22:00', '07:00'] }, newVersion: '1.20.0', chatUnread: true,
      updates: [
        NEW_VERSION('u-upd'),
        ofRun('u1', 'run.questions', 'r1', 'Review asks which date format', '14:32', 'Today', { open: true, to: 'its card in its chat, at its question' }),
        up('u10', 'chat.run', 'Ship the CSV export', 'a run waits for your OK', '14:05', 'Today', { open: true, chat: 'c1' }),
        ofRun('u2', 'run.failed', 'r5', 'Test step · 3 tests failed', '12:40', 'Today', { to: 'the run page, on the step that stopped', fix: 'Restart Build' }),
        up('u3', 'pr.published', '#962 Retry on 502', 'web-app · watched PR · checks running', '13:10', 'Today', { run: 'r7', to: 'the fix run' }),
        up('u4', 'schedule.missed', 'Nightly dependency bump', 'web-app · Worca was not running at 03:00', '09:02', 'Today', { run: 'r17', fix: 'Run now' }),
        ofRun('u5', 'run.done', 'h1', '18 min · $1.42', '08:40', 'Today'),
        up('u6', 'usage.reset', '', 'OpenAI · Plus · Session', '17:05', 'Yesterday', { title: 'Codex session reset · 1 run resumed', run: 'r10', to: 'the resumed run' }),
        ofRun('u7', 'run.questions', 'h2', 'answered at 11:20', '11:02', 'Yesterday', { read: true, resolved: true }),
        up('u8', 'schedule.missed', 'Run after: Breadcrumb tests', 'worca-cc · started late, when the run before it resumed', '10:40', 'Yesterday', { read: true, resolved: true }),
        up('u9', 'project.clone_done', 'acme/design-tokens', '2.1 MB', '10:15', 'Yesterday')] },
    { id: 'near', label: 'Session near its limit', desktop: 'unsupported', task: { title: 'Add rate limiting to the public API' },
      away: { status: 'no-hours' },
      updates: [
        up('n0', 'usage.moved', '', 'web-app · Claude Code\'s session was at 84% · the slice keeps Codex to the end', '14:24', 'Today', { title: 'Slice 2 of 4 moved to Codex · Rate limiting', run: 's2', to: 'the slice\'s run page' }),
        up('n1', 'usage.near', '', 'Claude · Max · runs on it may pause before it resets', '14:20', 'Today', { title: 'Claude Code session at 80% · resets 16:40' }),
        ofRun('n2', 'run.done', 'h1', '18 min · $1.42', '13:40', 'Today'),
        up('n3', 'pr.fix_started', '#962 Retry on 502', 'web-app · watched PR · 2 checks failing', '11:30', 'Today', { run: 'r7', to: 'the fix run' })] },
    { id: 'reached', label: 'Weekly limit reached', desktop: 'on', task: { title: 'Add rate limiting to the public API' },
      away: { status: 'paused' },
      updates: [
        up('r1', 'usage.reached', '', 'OpenAI · Plus · it resumes by itself Mon 09:05', '11:05', 'Today', { title: 'Codex weekly limit reached · 1 run paused' }),
        ofRun('r2', 'run.failed', 'r5', 'Test step · 3 tests failed', '09:58', 'Today', { to: 'the run page, on the step that stopped', fix: 'Restart Build' }),
        up('r3', 'usage.near', '', 'OpenAI · Plus', '16:12', 'Yesterday', { title: 'Codex week at 80% · resets Mon 09:00', read: true })] },
    { id: 'budget', label: 'Spend near its budget', desktop: 'off', task: { title: 'Add rate limiting to the public API' },
      away: { status: 'away-now' },
      updates: [
        ofRun('b1', 'run.cost_cap', 'r1', 'paused at $5.00 · raise the cap or stop', '10:12', 'Today', { open: true, to: 'the run page at its cost cap' }),
        up('b2', 'budget.threshold', '', 'Budget · $80.40 of $100', '09:30', 'Today', { title: 'Budget at 80% of $100' })] },
    // The budget is used up: every run is paused, and nothing starts until it resets or is raised.
    { id: 'spent', label: 'Budget used up', desktop: 'on', task: { title: 'Add rate limiting to the public API' },
      away: { status: 'here', hours: ['22:00', '07:00'] },
      updates: [
        up('x1', 'budget.exceeded', '', 'Budget · runs pause until it resets or you raise it', '09:30', 'Today', { title: 'Budget of $100 used up', fix: 'Raise budget', fixLand: 'runs|Budget' }),
        up('x2', 'budget.threshold', '', 'Budget · $80.40 of $100', '08:20', 'Today', { title: 'Budget at 80% of $100' })] },
    { id: 'gemini', label: 'Gemini only', desktop: 'insecure', gemQuota: '1000', task: { title: 'Write the API reference for v2' },
      away: { status: 'here', hours: ['20:00', '08:00'] },
      updates: [
        up('g1', 'usage.near', '', 'Gemini · Free · 800 of 1,000 requests', '13:44', 'Today', { title: 'Gemini daily requests at 80% · resets 02:00' })] },
    { id: 'quiet', label: 'All quiet', desktop: 'blocked', task: { title: 'Add rate limiting to the public API' },
      away: { status: 'unknown' },
      updates: [
        ofRun('q1', 'run.done', 'h1', '18 min · $1.42', '09:15', 'Today')] },
    // A shared sign-in with one of every kind: the card, the team's note, every Vitals section and event.
    { id: 'every', label: 'Every kind, shared sign-in', desktop: 'on', task: { title: 'Add rate limiting to the public API' },
      identity: { people: ['Emil Angelov', 'Dana Ruiz'], via: 'Through your team\'s sign-in' }, teamSetup: true, newVersion: '1.20.0', chatUnread: true,
      away: { status: 'away-hours', hours: ['18:00', '08:00'] },
      updates: [
        NEW_VERSION('e-upd'),
        ofRun('e01', 'run.questions', 'r1', 'Review asks which date format', '14:32', 'Today', { open: true, to: 'its card in its chat, at its question' }),
        ofRun('e02', 'run.gate', 'r2', 'approve the plan', '13:40', 'Today', { open: true, to: 'the run page at its gate' }),
        ofRun('e03', 'run.recovery', 'r29', 'the same step failed three times', '14:10', 'Today', { open: true }),
        ofRun('e04', 'run.workflow', 'r30', 'Shaper proposes a workflow', '14:02', 'Today', { open: true }),
        ofRun('e05', 'run.cost_cap', 'r4', 'paused at $120', '12:58', 'Today', { open: true, to: 'the run page at its cost cap' }),
        ofRun('e06', 'run.failed', 'r5', 'Test step · 3 tests failed', '12:40', 'Today', { to: 'the run page, on the step that stopped', fix: 'Restart Build' }),
        ofRun('e07', 'run.paused_limit', 'r3', 'Gemini refused: daily quota', '13:12', 'Today', { fix: 'Resume' }),
        ofRun('e08', 'run.paused_error', 'r32', 'lost the connection to the model', '13:30', 'Today', { fix: 'Resume' }),
        ofRun('e09', 'run.paused_night', 'r33', '20 answers while you were away', '02:10', 'Today', { fix: 'Resume' }),
        ofRun('e10', 'run.paused_time', 'r31', 'Build ran past its time limit', '01:40', 'Today', { fix: 'Resume' }),
        ofRun('e11', 'run.paused_stopped', 'r6', 'resume it when you are ready', '11:58', 'Today', { fix: 'Resume' }),
        ofRun('e12', 'run.done', 'r8', '18 min · $9.90', '10:58', 'Today'),
        ofRun('e13', 'run.resumed', 'r12', 'after the session reset', '00:20', 'Today'),
        up('e20', 'schedule.missed', 'Nightly dependency bump', 'web-app · Worca was not running at 03:00', '09:02', 'Yesterday', { run: 'r17', fix: 'Run now' }),
        up('e21', 'schedule.failed', 'Weekly digest', 'worca-cc · its project is missing', '09:00', 'Yesterday'),
        up('e22', 'schedule.run_error', 'Refresh the docs index', 'docs-site · ended with an error', '06:12', 'Yesterday'),
        up('e23', 'schedule.run_paused', 'Tidy project memory', 'worca-cc · paused at its cost cap', '06:05', 'Yesterday', { fix: 'Resume' }),
        up('e24', 'schedule.self_paused', 'Weekly digest', 'worca-cc · 3 failures in a row', '06:00', 'Yesterday', { fix: 'Resume' }),
        up('e25', 'schedule.late', 'Nightly dependency bump', 'web-app · started 40 min late', '03:40', 'Yesterday'),
        up('e26', 'schedule.retrying', 'Nightly dependency bump', 'web-app · try 2 of 3 in 5 min', '03:05', 'Yesterday'),
        up('e27', 'schedule.skipped', 'Tidy project memory', 'worca-cc · the last run is still going', '03:00', 'Yesterday'),
        up('e28', 'schedule.canceled', 'Deploy docs site', 'docs-site · canceled by you', '02:50', 'Yesterday'),
        up('e29', 'schedule.ended', 'Quarterly licence check', 'web-app · reached its end', '02:40', 'Yesterday'),
        up('e30', 'schedule.completed', 'Tidy project memory', 'worca-cc · 4 min · $0.20', '02:30', 'Yesterday'),
        up('e40', 'automation.approval', 'Issue #88 opened', 'web-app · a rule wants to start a run', '11:02', 'Yesterday', { open: true }),
        up('e41', 'automation.failed', 'Issue #87 opened', 'web-app · the workflow is missing', '10:58', 'Yesterday'),
        up('e42', 'automation.started', 'PR #961 opened', 'web-app · run started', '10:50', 'Yesterday'),
        up('e43', 'automation.skipped', 'Issue #86 opened', 'web-app · no rule matched its labels', '10:40', 'Yesterday'),
        up('e44', 'automation.queued', 'Issue #85 opened', 'web-app · waits for a free slot', '10:30', 'Yesterday'),
        up('e45', 'automation.done', 'Issue #84 opened', 'web-app · run finished', '10:20', 'Yesterday'),
        up('e50', 'chat.run', 'Plan the API rewrite', 'a run waits for your OK', '10:12', 'Yesterday', { open: true, chat: 'c5' }),
        up('e51', 'chat.web', 'Why did the build fail', 'wants to reach npmjs.com', '10:08', 'Yesterday', { open: true, chat: 'c2' }),
        up('e52', 'chat.workflow', 'Release checklist', 'a workflow waits for your OK', '10:04', 'Yesterday', { open: true, chat: 'c9' }),
        up('e53', 'chat.schedule', 'Tidy the migrations', 'a schedule waits for your OK', '10:00', 'Yesterday', { open: true, chat: 'c3' }),
        up('e60', 'pr.needs_person', '#960 Rename settings keys', 'worca-cc · two reviewers disagree', '09:50', 'Earlier', { open: true, run: 'r11' }),
        ofRun('e61', 'pr.open_failed', 'r8', 'GitHub refused the push', '09:40', 'Earlier', { fix: 'Open PR' }),
        up('e62', 'pr.fix_started', '#962 Retry on 502', 'web-app · round 7 · 2 checks failing', '09:30', 'Earlier', { run: 'r7', to: 'the fix run' }),
        up('e63', 'pr.published', '#962 Retry on 502', 'web-app · round 5 · pushed 19ab20c', '09:20', 'Earlier', { run: 'r7', to: 'the fix run' }),
        up('e70', 'usage.near', '', 'Claude · Max', '09:10', 'Earlier', { title: 'Claude Code session at 80% · resets 16:40' }),
        up('e71', 'usage.reached', '', 'OpenAI · Plus', '09:00', 'Earlier', { title: 'Codex weekly limit reached · 1 run paused' }),
        up('e72', 'usage.reset', '', 'OpenAI · Plus', '08:50', 'Earlier', { title: 'Codex session reset · 1 run resumed', run: 'r12', to: 'the resumed run' }),
        up('e73', 'usage.moved', '', 'web-app · the slice keeps Codex to the end', '08:40', 'Earlier', { title: 'Slice 2 of 4 moved to Codex · Rate limiting', run: 's2', to: 'the slice\'s run page' }),
        up('e74', 'usage.held', '', 'web-app · no harness has room', '08:30', 'Earlier', { title: 'Slice 3 of 4 waits for 16:40 · Rate limiting', run: 's3', to: 'the slice\'s run page' }),
        up('e75', 'budget.threshold', '', 'Budget · $80.40 of $100', '08:20', 'Earlier', { title: 'Budget at 80% of $100' }),
        up('e76', 'budget.exceeded', '', 'Budget · it reset on Nov 1', '08:10', 'Earlier', { title: 'Budget of $100 used up in October', read: true, resolved: true }),
        up('e80', 'away.started', '', 'Until 08:00', '18:00', 'Earlier', { title: 'Away hours started' }),
        up('e81', 'away.ended', '', 'Since 18:00 yesterday', '08:00', 'Earlier', { title: 'Away hours ended' }),
        up('e90', 'project.clone_failed', 'acme/old-api', 'the repository is gone', '07:50', 'Earlier'),
        up('e91', 'project.clone_done', 'acme/design-tokens', '2.1 MB', '07:40', 'Earlier'),
        up('e92', 'project.sync_failed', 'web-app', 'local changes in the way', '07:30', 'Earlier'),
        up('e93', 'project.sync_behind', 'billing-api', '12 commits behind origin', '07:20', 'Earlier')] },
  ];
  // Newest first within a day, and each case with the world's usage, spend and running actions. An update's run must be
  // in its case: a row can never name a run the lists do not have.
  for (const c of CASES) {
    const { usage, budget, actions } = W.facts(c.id);
    Object.assign(c, { usage, budget, actions });
    const dayOrder = [...new Set(c.updates.map((u) => u.day))];
    c.updates.sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day) || b.time.localeCompare(a.time));
    for (const u of c.updates) if (u.run && !W.has(c.id, u.run)) throw new Error(`${u.id} is about ${u.run}, which is not in the case ${c.id}`);
  }

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
    F('place', 'Tasks', 'Place', 'runs', { words: 'runs' }), F('place', 'Chats', 'Place', 'chat'), F('place', 'Schedules', 'Place', 'schedules', { min: 'advanced' }), F('place', 'Insights', 'Place', 'insights', { min: 'advanced', words: 'statistics spend cost' }), F('place', 'Team metrics', 'Place', 'team-metrics', { min: 'expert' }),
    F('place', 'Workflows', 'Place', 'workflows'), F('place', 'Requirements', 'Place', 'requirements', { flag: 'requirements' }), F('place', 'Marketplace', 'Place', 'marketplace', { min: 'advanced' }), F('place', 'Projects', 'Place', 'projects'), F('place', 'Workspaces', 'Place', 'workspaces', { min: 'advanced' }),
    F('project', 'billing-api', 'Project', 'projects'), F('project', 'web-app', 'Project', 'projects'), F('project', 'worca-cc', 'Project', 'projects'), F('project', 'docs-site', 'Project', 'projects'),
    F('workspace', 'platform-core', 'Workspace', 'workspaces', { min: 'advanced' }),
    F('workflow', 'Default', 'Workflow · 5 agents', 'workflows'), F('workflow', 'Lean', 'Workflow · 4 agents', 'workflows'), F('workflow', 'Shaper', 'Workflow · 6 agents', 'workflows'), F('workflow', 'Promo video', 'Workflow · 8 agents', 'workflows'), F('workflow', 'Architecture (C4)', 'Workflow · 2 agents', 'workflows'),
    F('schedule', 'Nightly dependency bump', 'Schedule · every day', 'schedules', { min: 'advanced' }), F('schedule', 'Weekly digest', 'Schedule · every Friday', 'schedules', { min: 'advanced' }),
    F('ticket', 'Deploy docs site', 'Scheduled once · after a run', 'schedules', { min: 'advanced' }), F('ticket', 'Tidy project memory', 'Scheduled once · today 18:00', 'schedules', { min: 'advanced' }),
    F('label', 'hotfix', 'Label · Runs', 'runs', { flag: 'runLabels' }), F('label', 'ui', 'Label · Runs', 'runs', { flag: 'runLabels' }), F('label', 'billing', 'Label · Runs', 'runs', { flag: 'runLabels' }), F('label', 'backend', 'Label · Runs', 'runs', { flag: 'runLabels' }), F('label', 'tests', 'Label · Runs', 'runs', { flag: 'runLabels' }),
    F('plugin', 'github-source', 'Plugin · Marketplace', 'marketplace', { min: 'advanced' }), F('plugin', 'jira-source', 'Plugin · Marketplace', 'marketplace', { min: 'advanced' }), F('plugin', 'telegram-chat', 'Plugin · Marketplace', 'marketplace', { min: 'advanced' }),
    F('plugin', 'slack-chat', 'Plugin · Marketplace', 'marketplace', { min: 'advanced' }), F('plugin', 'discord-chat', 'Plugin · Marketplace', 'marketplace', { min: 'advanced' }),
    F('chat', 'Why did the build fail', 'Chat · today', 'chat/c2'), F('chat', 'Plan the API rewrite', 'Chat · today', 'chat/c5'), F('chat', 'Release checklist', 'Chat · yesterday', 'chat/c9'),
  ];
  const FLAG_ROW = { requirements: 'Requirements', runLabels: 'Run labels', gitAutomations: 'Git event automations' };
  // `label:ui`: the runs with that label. Otherwise the name, or a word of where it lives, anywhere in the text.
  // The runs are the world's, as they are now.
  const runFinds = () => W.rows().filter((r) => !r.archived).map((r) => F('run', r.title, `Task · ${r.project || 'No project'}`, `run/${r.case}`, { labels: r.labels }));
  function find(q) {
    const raw = q.trim().toLowerCase();
    const m = raw.match(/^label:\s*(.*)$/), runs = runFinds();
    if (m) return [...FINDS.filter((f) => f.kind === 'label' && f.label.includes(m[1])), ...runs.filter((f) => (f.labels || []).some((l) => l.includes(m[1]))).map((f) => ({ ...f, flag: 'runLabels' }))];
    return [...FINDS, ...runs].filter((f) => f.label.toLowerCase().includes(raw) || f.kind.startsWith(raw) || f.words?.includes(raw));
  }

  // The tone of a share: '' under the warning line, warn at or over it, over when used up.
  const tone = (pct, warnAt) => (pct >= 100 ? 'over' : pct >= warnAt ? 'warn' : '');
  const winWord = (k) => WIN[k];

  const usd = (n) => '$' + n.toLocaleString('en', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const BUDGET_RESETS = 'Dec 1';
  // A used-up budget stops every run and every start; it wins over any window.
  const budgetGone = (b) => !!b?.limit && b.spent >= b.limit;
  const spendPct = (b) => (b && b.limit ? Math.round((b.spent / b.limit) * 100) : null);
  // A window in words: "86%", or the count where the provider counts requests ("212 of 300").
  const fig = (w) => (w.of ? `${w.used.toLocaleString('en')} of ${w.of.toLocaleString('en')}` : `${w.pct}%`);

  // The avatar's rings, outside in: Session, then the long window (a week; a day or a month where that is the only
  // one), each its tightest connected provider's live usage; a ring nobody reports is not drawn. Money is not a ring: a budget
  // lives in Settings › Runs and its figures in Usage and costs.
  function rings(c, warnAt) {
    const out = [];
    for (const [slot, kinds] of [['session', ['session']], ['long', LONG]]) {
      let best = null;
      for (const u of c.usage) for (const w of u.win) if (kinds.includes(w.k) && (!best || w.pct > best.pct)) best = { ...w, p: u.p };
      if (best) out.push({ slot, pct: best.pct, tone: tone(best.pct, warnAt),
        line: R.usageTip({ what: R.usageWindow(best.k), who: PROVIDER[best.p].name, figure: `${best.pct}%`, resets: best.resets }) });
    }
    return out;
  }

  // Limits in Vitals: each window at or over the warning line, and the budget. It is a state: it goes when the window resets.
  function limits(c, warnAt) {
    const out = [];
    for (const u of c.usage) for (const w of u.win) {
      if (w.pct < warnAt) continue;
      const name = PROVIDER[u.p].name, what = WHAT[w.k], paused = (c.runs || []).filter((r) => r.resumes && r.on === u.p).length;
      out.push(w.pct >= 100
        ? { p: u.p, tone: 'over', title: `${name} ${what} reached`, detail: paused ? `${paused} ${paused === 1 ? 'run' : 'runs'} paused · ${paused === 1 ? 'it resumes' : 'they resume'} by ${paused === 1 ? 'itself' : 'themselves'} after it resets` : `Runs on ${name} wait until it resets`, time: `resets ${w.resets}`, tip: `Resets ${w.resets}` }
        : { p: u.p, tone: 'warn', title: `${name} ${what} at ${w.pct}%`, detail: `Runs on ${name} may pause before then`, time: `resets ${w.resets}`, tip: `Resets ${w.resets}` });
    }
    const sp = spendPct(c.budget);
    if (sp != null && sp >= warnAt) out.push(sp >= 100
      ? { tone: 'over', title: `Budget of ${usd(c.budget.limit)} used up`, detail: 'Runs stay paused until it resets or you raise it', time: `resets ${BUDGET_RESETS}`, tip: 'The budget resets on 1 December' }
      : { tone: 'warn', title: `Budget at ${sp}% of ${usd(c.budget.limit)}`, detail: 'Runs stop at the budget', time: `resets ${BUDGET_RESETS}`, tip: 'The budget resets on 1 December' });
    return out;
  }

  // Vitals's rows by section: the same top-level rows as the Runs list.
  function vitalsRuns() {
    const out = { needs: [], running: [], scheduled: [] };
    for (const r of W.tops()) out[r.section]?.push(r);
    return out;
  }

  // What the mock's next minute reports: only connected providers, a little further on, as of now. In the app the figures
  // come from each provider; a Wave 1 question.
  const refreshed = (c, ticks, clock) => (ticks ? { ...c, usage: c.usage.map((u) => ({ ...u, asOf: clock, win: u.win.map((w) => { const pct = Math.min(100, w.pct + ticks); return w.of ? { ...w, pct, used: Math.min(w.of, w.used + ticks) } : { ...w, pct }; }) })) } : c);

  // Gemini's window is the person's own: the quota set in Settings › Models › Sign-ins, what Worca counted against it.
  function withQuota(c, quota, used) {
    if (!c.usage.some((u) => u.p === 'gemini')) return c;
    const q = +quota;
    return { ...c, usage: c.usage.map((u) => (u.p !== 'gemini' ? u : q ? { ...u, noQuota: false, win: [{ k: 'day', pct: Math.round((used / q) * 100), used, of: q, resets: '02:00' }] } : { ...u, noQuota: true, win: [] })) };
  }

  // The window a start on this harness would run into, or null: the fullest at or over the warning line.
  function near(c, p, warnAt) {
    const u = c.usage.find((x) => x.p === p); if (!u) return null;
    const hit = u.win.filter((w) => w.pct >= warnAt).sort((a, b) => b.pct - a.pct)[0];
    return hit ? { ...hit, p, name: PROVIDER[p].name, what: WHAT[hit.k] } : null;
  }
  // The harnesses with room: set up, able to run the run, every window under the warning line; the most room first.
  function room(c, warnAt, except) {
    return c.usage.filter((u) => u.p !== except && PROVIDER[u.p].runs && u.win.length && !near(c, u.p, warnAt))
      .sort((a, b) => Math.max(...a.win.map((w) => w.pct)) - Math.max(...b.win.map((w) => w.pct))).map((u) => u.p);
  }

  // The Prototype corner's new event, one per severity, so the sound can be tried. Each is a fresh update.
  const TRY = { needs: ['run.questions', 'Rename settings keys', 'worca-cc · 1 question', 'run/question'], problem: ['run.failed', 'Fix the flaky e2e test', 'worca-cc · it stopped at Review', 'run/failed'], info: ['run.done', 'Update the changelog', 'docs-site · ready', 'run/ready'] };
  const tryEvent = (sev, n) => { const [e, about, meta, go] = TRY[sev]; return up('try-' + n, e, about, meta, 'now', 'Today', { go }); };
  window.PulseModel = { BUDGET_RESETS, budgetGone, tryEvent, refreshed, withQuota, vitalsRuns, awayRow, awayLine, FINDS, FLAG_ROW, find, EVENT, BADGE, chatWords, SCHED, GROUPS, LEVELS, WHERE, PROVIDER, CASES, WHAT, qualifies, tone, rings, limits, near, room, winWord, fig, usd, spendPct };
})();
