// Run card v2 model: every case of the run and group page card as data, and view() that turns a case plus the
// viewer's choices (open stage, added chips, ship mode) into one view model. The local mock and the design canvas
// both render this, so a case is written once. Times in the "working" case are a real run's figures.
(function () {
  const s = (name, state, time, o) => Object.assign({ name, state, time: time || '', loops: 0, live: '', when: '' }, o || {});
  const ok = (name, time, o) => s(name, 'done', time, o);
  const next = (name, o) => s(name, 'next', '', o);

  const PLAN = [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Refine plan', '40m 5s', { loops: 4 }), ok('Plan review', '19m 19s')];
  const BUILD = [ok('Implementation', '2h 4m', { loops: 3 })];
  const REVIEW = [ok('Review implementation', '37m 21s', { loops: 3 }), ok('Manual tests checklist', '1m 18s'), ok('Manual web UI testing', '21m 10s')];
  const PR_NEXT = [next('Create PR'), next('Checks'), next('Approval')];
  const PR_OPEN = (checks, approval, extra) => [ok('Create PR', '', { live: 'worca/worka-cc#959' }), checks, approval].concat(extra || []);
  const LAND = (state, live) => [s('Into dev', state, '', { live: live || '' })];

  const run = (o) => [
    { key: 'plan', label: 'Plan', subs: o.plan || PLAN },
    { key: 'build', label: 'Build', subs: o.build || BUILD },
    { key: 'review', label: 'Review', subs: o.review || REVIEW },
  ].concat(o.tail || [{ key: 'pr', label: 'PR', subs: o.pr || PR_NEXT }, { key: 'merged', label: 'Merged', subs: o.merged || LAND('next') }]);
  const allNext = (subs) => subs.map((x) => next(x.name));

  // A group's runs: each run is one segment, its four stages are the cells; the last segment is the PR stack.
  const member = (n, title, states, o) => ({ key: 'run' + n, label: 'Run ' + n, title, run: true,
    subs: ['Plan', 'Build', 'Review', 'Ready'].map((st, i) => s(st, states[i], (o && o.times && o.times[i]) || '', { live: (o && o.live && o.live[i]) || '', when: (o && o.when && o.when[i]) || '' })) });
  const RUNS = ['One head for run and group pages', 'Breadcrumb in the top bar', 'Phone layout of the head'];

  const LIVE_FIGS = [['Time', '4h 38m'], ['Cost', '$84.10'], ['Rate', '$18.20/h']];
  const DONE_FIGS = [['Time', '4h 52m'], ['Cost', '$86.02']];
  // Four tabs, one question each: Summary (what you asked, what to check), Changes (what changed: the git diff or a
  // Folder run's files), Activity (how it ran: every step with its log, model and cost; the graph is a view of it),
  // Decisions (questions, answers and approvals). Artifacts sit in Summary; Try it and the patch are the action's ▾.
  const RUN_TABS = [['summary', 'Summary'], ['changes', 'Changes', '14'], ['activity', 'Activity'], ['decisions', 'Decisions', '3']];
  const GROUP_TABS = [['runs', 'Runs', '3'], ['summary', 'Summary'], ['activity', 'Activity'], ['decisions', 'Decisions', '4']];
  const A = (label, icon, primary, items) => ({ label, icon, primary: !!primary, items: items || [] });

  const CASES = [
    // One run, start to merge
    { id: 'starting', group: 'Run', label: 'Starting', word: 'Starting', dot: 'is-peach is-pulse', figs: [['Time', '0m 12s'], ['Cost', '$0.00']],
      stages: run({ plan: [s('Clarify', 'now', '', { live: 'Setting up the worktree', when: 'now' }), next('Plan'), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'working', group: 'Run', label: 'Working', word: 'Working', dot: 'is-peach is-pulse', figs: LIVE_FIGS,
      stages: run({ review: [REVIEW[0], REVIEW[1], s('Manual web UI testing', 'now', '21m', { live: 'Opening the Runs page at 375px to check the breadcrumb', when: '8s ago' })] }) },
    { id: 'question', group: 'Run', label: 'Needs you', word: 'Needs you', sym: 'q', action: A('Answer', '', true, ['Use the default answer']), figs: LIVE_FIGS,
      stages: run({ review: [s('Review implementation', 'ask', '12m', { live: 'Keep the breadcrumb on phones under 600px, or show only Back there?', when: '4m' }), next('Manual tests checklist'), next('Manual web UI testing')] }) },
    { id: 'paused', group: 'Run', label: 'Paused', word: 'Paused', dot: 'is-grey', detail: 'Usage limit · resumes at 14:00', action: A('Resume', 'play', false, ['Resume when the limit resets', 'Stop']), figs: [['Time', '2h 40m'], ['Cost', '$48.30']],
      stages: run({ build: [s('Implementation', 'paused', '1h 2m')], review: allNext(REVIEW) }) },
    { id: 'failed', group: 'Run', label: 'Failed', word: 'Failed', sym: 'x', action: A('Resume from Build', 'refresh', true, ['Report this run', 'Start a new run']), figs: [['Time', '2h 12m'], ['Cost', '$41.30']],
      stages: run({ build: [s('Implementation', 'failed', '1h 30m', { loops: 3, live: 'Tests failed 3 times in a row' })], review: allNext(REVIEW) }) },
    { id: 'ready', group: 'Run', label: 'Ready', word: 'Ready', dot: 'is-green', action: A('Create PR', 'prc', true, ['Try it', 'Push main', 'Discard']), figs: DONE_FIGS, stages: run({}) },
    { id: 'checks', group: 'Run', label: 'Checks running', word: 'In review', dot: 'is-green', action: A('View PR', 'pr', false, ['Watch', 'Copy PR link']), figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(s('Checks', 'now', '', { live: '3 of 7 passed', when: 'running' }), next('Approval')) }) },
    { id: 'failing', group: 'Run', label: 'Checks failing', word: 'Needs you', dot: 'is-amber', action: A('Fix checks', 'refresh', true, ['View PR', 'Copy PR link']), figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(s('Checks', 'problem', '', { live: '2 failed · unit, e2e' }), next('Approval')) }) },
    { id: 'conflicts', group: 'Run', label: 'Conflicts', word: 'Needs you', dot: 'is-amber', action: A('Fix conflicts', 'refresh', true, ['View PR', 'Copy PR link']), figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(ok('Checks', '', { live: '7 of 7 passed' }), s('Up to date with dev', 'problem', '', { live: 'Conflicts in 2 files' })) }) },
    { id: 'approved', group: 'Run', label: 'Approved', word: 'In review', dot: 'is-green', action: A('Merge PR', 'merge', true, ['View PR', 'Watch', 'Copy PR link']), figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(ok('Checks', '', { live: '7 of 7 passed' }), ok('Approval', '', { live: 'Approved by 1 reviewer' })) }) },
    { id: 'merged', group: 'Run', label: 'Merged', word: 'Merged', dot: 'is-violet', action: A('View PR', 'merge', false), figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(ok('Checks'), ok('Approval')), merged: LAND('merged', 'Merged 25 Oct, 16:02') }) },

    // Run kinds
    { id: 'push', group: 'Kinds', label: 'Push path', word: 'Ready', dot: 'is-green', branch: 'main', action: A('Push main', 'up', true, ['Create PR instead', 'Discard']), figs: [['Time', '38m'], ['Cost', '$6.40']],
      stages: run({ tail: [{ key: 'push', label: 'Push', subs: [next('To origin/main')] }] }) },
    { id: 'folder', group: 'Kinds', label: 'Folder run', word: 'Ready', dot: 'is-green', branch: '', folder: '~/src/marketing-site', action: A('Apply to folder', 'folder', true, ['Try it', 'Discard']), figs: [['Time', '52m'], ['Cost', '$9.15']],
      stages: run({ tail: [{ key: 'apply', label: 'Apply', subs: [next('Into ~/src/marketing-site', { live: '14 files changed in a copy' })] }] }) },
    { id: 'workspace', group: 'Kinds', label: 'Workspace', word: 'In review', dot: 'is-green', branch: 'feat/billing-export', project: 'billing workspace', action: A('View PRs', 'pr', false, ['worca-api #212', 'worca-web #88', 'worca-docs #31', 'Copy PR links']), figs: [['Time', '3h 05m'], ['Cost', '$52.70']],
      stages: run({ tail: [{ key: 'pr', label: 'PRs', subs: [s('worca-api #212', 'merged', '', { live: 'Merged into main' }), s('worca-web #88', 'now', '', { live: 'Checks running · 5 of 7' }), s('worca-docs #31', 'problem', '', { live: 'Conflicts with main' })] }, { key: 'merged', label: 'Merged', subs: [s('1 of 3 repositories', 'now', '', { live: 'worca-api is in main' })] }] }) },
    { id: 'noproject', group: 'Kinds', label: 'No project', word: 'Finished', dot: 'is-green', project: 'No project', branch: '', figs: [['Time', '12m'], ['Cost', '$1.80']], tabs: [['summary', 'Summary'], ['activity', 'Activity'], ['decisions', 'Decisions']],
      stages: run({ tail: [{ key: 'done', label: 'Done', subs: [ok('3 artifacts', '', { live: 'In the Artifacts tab' })] }] }) },

    // Shaper
    { id: 'clarify', group: 'Shaper', label: 'Clarify', word: 'Needs you', sym: 'q', action: A('Answer', '', true, ['Use defaults']), figs: [['Time', '2m'], ['Cost', '$0.76']],
      stages: run({ plan: [s('Clarify', 'ask', '34s', { live: '3 questions · which pages, what Back does, phones', when: '1m' }), next('Plan'), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'plan', group: 'Shaper', label: 'Plan ready', word: 'Needs you', sym: 'q', action: A('Approve and build', 'check', true, ['Ask for changes', 'Full plan']), figs: [['Time', '34m'], ['Cost', '$15.41']],
      stages: run({ plan: [ok('Clarify', '34s'), s('Plan', 'ask', '33m 57s', { live: '6 steps · 2 open issues · waiting for you', when: '4m' }), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'outline', group: 'Shaper', label: 'Plan in slices', word: 'Needs you', sym: 'q', action: A('Approve 3 runs', 'check', true, ['Ask me before each run', 'Don’t split', 'Ask for changes']), figs: [['Time', '41m'], ['Cost', '$18.90']],
      stack: { mode: 'outline' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), s('Cut into runs', 'ask', '7m', { live: '3 runs, one PR each · waiting for you', when: '2m' })] },
        { key: 'run1', label: 'Run 1', subs: allNext(['Plan', 'Build', 'Review', 'Ready'].map((n) => s(n))) }, { key: 'run2', label: 'Run 2', subs: allNext(['Plan', 'Build', 'Review', 'Ready'].map((n) => s(n))) },
        { key: 'run3', label: 'Run 3', subs: allNext(['Plan', 'Build', 'Review', 'Ready'].map((n) => s(n))) }, { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'slice', group: 'Shaper', label: 'A slice running', kind: 'Run 2 of 3 ›', word: 'Working', dot: 'is-peach is-pulse', branch: 'feat/head-breadcrumb-2', figs: [['Time', '1h 10m'], ['Cost', '$19.40'], ['Rate', '$16.60/h']],
      stages: run({ build: [s('Implementation', 'now', '12m', { live: 'Builds on run 1 · editing app.js', when: '3s ago' })], review: allNext(REVIEW),
        tail: [{ key: 'ship', label: 'Ship', subs: [next('With the feature', { live: 'One stacked PR each, from the feature page' })] }] }) },

    // Groups
    { id: 'feature', group: 'Groups', label: 'Feature, run 2', kind: 'Feature', word: 'Working', dot: 'is-peach is-pulse', branch: '', figs: [['Time', '3h 20m'], ['Cost', '$61.10'], ['Rate', '$18.30/h']], tabs: GROUP_TABS,
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Cut into runs', '7m', { live: '3 runs, one PR each' })] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m', ''] }),
        member(2, RUNS[1], ['done', 'now', 'next', 'next'], { times: ['18m', '40m'], live: ['', 'Editing app.js'], when: ['', '3s ago'] }),
        member(3, RUNS[2], ['next', 'next', 'next', 'next']),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'featureready', group: 'Groups', label: 'Feature ready', kind: 'Feature', word: 'Ready', dot: 'is-green', branch: '', action: A('Create 3 PRs', 'prc', true, ['Try it', 'Discard']), figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS,
      stack: { mode: 'create', runs: RUNS, rec: 'stack', reason: '3 runs and about 1,200 changed lines: three small reviews go faster than one large one.' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Cut into runs', '7m')] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['18m', '1h 2m', '27m'] }),
        member(3, RUNS[2], ['done', 'done', 'done', 'done'], { times: ['12m', '44m', '19m'] }),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'featureone', group: 'Groups', label: 'Feature ready, small', kind: 'Feature', word: 'Ready', dot: 'is-green', branch: '', action: A('Create PR', 'prc', true, ['Try it', 'Discard']), figs: [['Time', '1h 40m'], ['Cost', '$21.70']], tabs: GROUP_TABS,
      stack: { mode: 'create', runs: RUNS.slice(0, 2), rec: 'one', reason: '2 small runs, 180 changed lines, and they combine without conflicts: one review is enough.' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '12m'), ok('Cut into runs', '3m')] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['8m', '31m', '12m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['6m', '22m', '9m'] }),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2')] }] },
    { id: 'featureblocked', group: 'Groups', label: 'Feature ready, One PR off', kind: 'Feature', word: 'Ready', dot: 'is-green', branch: '', action: A('Create 3 PRs', 'prc', true, ['Try it', 'Discard']), figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS,
      stack: { mode: 'create', runs: RUNS, rec: 'stack', oneBlocked: 'Not possible: run 3 changes the same lines as run 2. Ship them stacked, or fix the overlap first.', reason: 'Runs 2 and 3 overlap, so only the stacked way keeps each review clean.' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Cut into runs', '7m')] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['18m', '1h 2m', '27m'] }),
        member(3, RUNS[2], ['done', 'done', 'done', 'done'], { times: ['12m', '44m', '19m'] }),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'chain', group: 'Groups', label: 'Stack in review', kind: 'Chain', word: 'In review', dot: 'is-green', branch: '', action: A('Merge PR 1 of 3', 'merge', true, ['View PRs', 'Watch PRs', 'Copy PR links']), figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS,
      stack: { mode: 'review' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Cut into runs', '7m')] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done']), member(2, RUNS[1], ['done', 'done', 'done', 'done']), member(3, RUNS[2], ['done', 'done', 'done', 'done']),
        { key: 'pr', label: 'PRs', subs: [ok('#959'), s('#960', 'review'), s('#961', 'problem')] }] },
  ];

  // The stack: the PRs of a feature or chain, in merge order, each based on the one above it.
  const STACKS = {
    outline: { title: '3 runs, one PR each', note: 'Each run builds on the one before', rows: RUNS.map((t, i) => ({ num: String(i + 1), title: t, state: 'next', word: ['Small', 'Medium', 'Small'][i], sub: i ? 'Builds on run ' + i : 'Starts from dev' })) },
    create: { title: 'Ship as', choice: true },
    review: { title: 'Merge in order', rows: [
      { num: '#959', title: RUNS[0], state: 'done', word: 'Ready to merge', sub: 'Into dev · 7 of 7 checks · approved', isNext: true },
      { num: '#960', title: RUNS[1], state: 'review', word: 'In review', sub: 'Into #959 · 5 of 7 checks' },
      { num: '#961', title: RUNS[2], state: 'problem', word: 'Checks failing', sub: 'Into #960 · 2 failed' }] },
  };



  // What the tabs hold, shared by every case (sample content; the step list comes from the case itself).
  const MODEL_OF = { Clarify: 'Sonnet 5.5', Plan: 'Opus 5.5', 'Refine plan': 'Opus 5.5', 'Plan review': 'Sonnet 5.5', Implementation: 'Opus 5.5',
    'Review implementation': 'Opus 5.5', 'Manual tests checklist': 'Haiku 5.5', 'Manual web UI testing': 'Sonnet 5.5' };
  const COST_OF = { Clarify: '$0.76', Plan: '$14.65', 'Refine plan': '$18.29', 'Plan review': '$7.82', Implementation: '$31.18', 'Review implementation': '$9.95', 'Manual tests checklist': '$0.80', 'Manual web UI testing': '$0.00' };
  const DETAIL = {
    task: 'One head for the run and group pages: Back, the breadcrumb and the run’s actions in the top bar, and the page title once.',
    check: ['The breadcrumb hides under 600px: try it on a phone', 'Back on a group page now goes to Runs, not the group list'],
    artifacts: [['plan.md', 'Plan'], ['review-3.md', 'Review implementation'], ['checklist.md', 'Manual tests checklist']],
    files: [['ui/public/run-head.mjs', 182, 64], ['ui/public/style.css', 41, 58], ['ui/public/app.js', 27, 19], ['ui/public/nav/routes.mjs', 12, 3], ['test/ui-run-head.test.mjs', 96, 0]],
    decisions: [
      { step: 'Clarify', q: 'Which pages get the breadcrumb?', a: 'Run and group pages', by: 'You' },
      { step: 'Plan', q: 'Approve the plan', a: 'Approved · 6 steps, 2 open issues fixed', by: 'You' },
      { step: 'Review implementation', q: 'Keep the breadcrumb on phones under 600px?', a: 'Show only Back there', by: 'Answered for you · Away mode' }],
  };

  // One line on what each action does: the main button's tooltip and the head of its ▾ menu, and each menu item's help.
  const HELP = {
    'Answer': 'Opens the question Worca is waiting on',
    'Use the default answer': 'Goes on with what Worca would pick',
    'Use defaults': 'Skips the questions; the planner picks sensible answers',
    'Resume': 'Starts again from the step it paused in',
    'Resume when the limit resets': 'Waits for the limit, then goes on by itself',
    'Stop': 'Ends the run; the branch and changes stay',
    'Resume from Build': 'Runs Build again with what Plan already made',
    'Report this run': 'Sends the logs and a note to the Worca team',
    'Start a new run': 'A fresh run with the same task',
    'Create PR': 'Opens a pull request from this run’s branch into dev',
    'Create 3 PRs': 'Opens one PR per run, each into the one before',
    'Create 2 PRs': 'Opens one PR per run, the second into the first',
    'Try it': 'Checks the branch out locally so you can run it',
    'Push main': 'Pushes the commits straight to origin/main, no PR',
    'Discard': 'Throws the changes away; the run stays in history',
    'View PR': 'Opens the pull request on GitHub',
    'Watch': 'Worca follows the PR and fixes failing checks for you',
    'Copy PR link': 'Copies the PR’s address',
    'Fix checks': 'Starts a short run that fixes the failing checks',
    'Fix conflicts': 'Starts a short run that merges dev in and resolves the conflicts',
    'Merge PR': 'Merges the PR into dev on GitHub',
    'Merge PR 1 of 3': 'Merges #959 into dev; #960 then points at dev',
    'View PRs': 'Opens the pull requests on GitHub',
    'Watch PRs': 'Worca follows all three PRs',
    'Copy PR links': 'Copies every PR’s address',
    'Create PR instead': 'Opens a PR rather than pushing to main',
    'Apply to folder': 'Copies the changed files into the folder',
    'Approve and build': 'Accepts the plan and starts Build',
    'Ask for changes': 'Tells the planner what to change, then it plans again',
    'Full plan': 'Opens the whole plan to read',
    'Approve 3 runs': 'Creates the feature: three runs that build one after another',
    'Ask me before each run': 'Stops for your OK before each later run starts',
    'Don’t split': 'Builds it as one run and one PR',
    'worca-api #212': 'Merged into main', 'worca-web #88': 'Checks running', 'worca-docs #31': 'Conflicts with main',
  };

  const LIVE = { now: 1, ask: 1, problem: 1, failed: 1, paused: 1, review: 1 };
  const isDone = (x) => x.state === 'done' || x.state === 'merged';
  // Each sub-step state: the rail circle, its icon, the word a screen reader hears, the bar cell.
  const DOT = { done: ['is-done', 'check', 'Done'], now: ['is-working is-pulse', 'now', 'In progress'], ask: ['is-problem', 'question', 'Needs you'],
    problem: ['is-problem', 'alert', 'Needs attention'], failed: ['is-failed', 'alert', 'Failed'], paused: ['is-closed', 'pause', 'Paused'], review: ['is-review', 'pr', 'In review'], next: ['is-future', '', 'Not yet'], merged: ['is-merged', 'merge', 'Merged'] };
  const stageState = (subs) => (subs.some((x) => LIVE[x.state]) ? 'live' : subs.every(isDone) ? 'done' : 'next');
  const toMin = (t) => { let m = 0; t.replace(/(\d+)\s*([hms])/g, (_, n, u) => { m += u === 'h' ? +n * 60 : u === 'm' ? +n : +n / 60; return ''; }); return m; };
  const fmtMin = (m) => {
    if (m < 1) return Math.round(m * 60) + 's';
    const r = Math.round(m);   // round first, so 59.8 minutes reads 1h, not 60m
    return r >= 60 ? Math.floor(r / 60) + 'h' + (r % 60 ? ' ' + (r % 60) + 'm' : '') : r + 'm';
  };
  // The label under a segment says only what its cells cannot: how long. Total for a finished stage, so far for the
  // live one, nothing for one still to come (the cells already show how many steps and how far along it is).
  function stageMeta(st) {
    if (stageState(st.subs) === 'next') return '';
    const m = st.subs.reduce((a, x) => a + (x.time ? toMin(x.time) : 0), 0);
    return m ? fmtMin(m) : '';
  }
  const STAGE_WORD = { live: 'in progress', done: 'done', next: 'not started' };
  function defaultStage(c) {
    const live = c.stages.find((st) => stageState(st.subs) === 'live');
    if (live) return live.key;
    if (c.stack && c.stack.mode !== 'outline') return 'pr';
    const last = c.stages.slice().reverse().find((st) => st.subs.some(isDone));
    return (last || c.stages[0]).key;
  }
  const rowOf = (x, nextX) => {
    const d = DOT[x.state] || DOT.next;
    return { name: x.name, live: x.live, when: x.when, time: x.time, loops: x.loops, dotCls: d[0], icon: d[1], word: d[2],
      rowCls: 'is-' + x.state + (nextX && isDone(x) && isDone(nextX) ? ' is-linked' : '') };
  };

  // ui: { open: stage key | null, chips: [{kind, text}], ship: 'stack' | 'one' }
  function view(caseId, ui) {
    ui = ui || {};
    const c = CASES.find((x) => x.id === caseId) || CASES[1];
    const now = defaultStage(c);
    const open = ui.open && c.stages.some((st) => st.key === ui.open) ? ui.open : now;
    const st = c.stages.find((x) => x.key === open);
    let stack = null;
    if (c.stack && (open === 'pr' || (c.stack.mode === 'outline' && open === 'plan'))) {
      const src = STACKS[c.stack.mode];
      let rows = src.rows || [];
      let choice = null;
      if (src.choice) {
        // One PR or stacked: Worca recommends one and says why; an option that cannot work is off, with its reason.
        const sh = c.stack;
        const n = sh.runs.length;
        const pick = ui.ship && !(ui.ship === 'one' && sh.oneBlocked) ? ui.ship : sh.rec;
        choice = { reason: sh.reason, options: [
          { id: 'stack', label: 'Stacked · ' + n + ' PRs', help: 'One PR per run, each into the one before. Small reviews, merged in order.', rec: sh.rec === 'stack', disabled: '', selected: pick === 'stack' },
          { id: 'one', label: 'One PR', help: sh.oneBlocked || 'All ' + n + ' runs on one branch. One review, one merge.', rec: sh.rec === 'one', disabled: sh.oneBlocked || '', selected: pick === 'one' }] };
        rows = pick === 'one'
          ? [{ num: 'One PR', title: 'All ' + n + ' runs, one branch', state: 'next', word: 'Not opened', sub: 'Into dev' }]
          : sh.runs.map((t, i) => ({ num: 'PR ' + (i + 1), title: t, state: 'next', word: 'Not opened', sub: i ? 'Into PR ' + i + '\u2019s branch' : 'Into dev' }));
        c.__pick = pick;
      }
      rows = rows.map((r) => Object.assign(rowOf({ state: r.state }), r, { rowCls: 'is-' + r.state + (r.isNext ? ' is-next-up' : '') }));
      stack = { title: src.title, note: src.note || '', choice, rows };
    }
    let action = null;
    if (c.action) {
      const label = c.stack && c.stack.mode === 'create' ? (c.__pick === 'one' ? 'Create PR' : 'Create ' + c.stack.runs.length + ' PRs') : c.action.label;
      action = Object.assign({}, c.action, { label, help: HELP[label] || '', items: c.action.items.map((t) => ({ text: t, help: HELP[t] || '' })) });
    }
    return {
      id: c.id, title: c.title || 'Unified page navigation: one head, breadcrumb in the top', kind: c.kind || '',
      project: c.project || 'worka-cc', branch: c.branch === undefined ? 'feat/unified-page-navigation-one-head-breadcrumb' : c.branch, folder: c.folder || '',
      started: 'started 08:31', chips: ui.chips || [],
      word: c.word, dot: c.dot || '', sym: c.sym || '', detail: c.detail || '', action,
      stages: c.stages.map((x) => ({ key: x.key, label: x.label, meta: stageMeta(x), selected: x.key === open, live: stageState(x.subs) === 'live',
        aria: [x.label, STAGE_WORD[stageState(x.subs)], stageMeta(x)].filter(Boolean).join(', '),
        cells: x.subs.map((y) => 'is-' + y.state) })),
      open: { key: open, label: st.label, title: st.title || '', isRun: !!st.run, browsing: open !== now,
        rows: stack ? [] : st.subs.map((x, i) => Object.assign(rowOf(x, st.subs[i + 1]), { ref: st.run ? '' : st.key + '/' + x.name })), stack },
      figs: c.figs.map(([k, v]) => ({ k, v })),
      tabs: (c.tabs || RUN_TABS).map(([id, l, n], i, all) => ({ id, l, n: n || '', sel: id === (all.some((t) => t[0] === ui.tab) ? ui.tab : all[0][0]) })),
      activity: c.stages.map((x) => ({ key: x.key, label: x.label, meta: stageMeta(x), title: x.title || '',
        rows: x.subs.map((y, i) => Object.assign(rowOf(y, x.subs[i + 1]), { model: MODEL_OF[y.name] || '', cost: y.state === 'next' ? '' : COST_OF[y.name] || '', focus: ui.focus === x.key + '/' + y.name, ref: x.key + '/' + y.name })) })),
      detail: DETAIL,
    };
  }

  const ADD = [{ kind: 'label', text: 'ui', menu: 'Label', help: 'Find and filter runs by it in the Runs list' },
    { kind: 'tag', text: 'team: web', menu: 'Cost tag', help: 'Splits this run’s cost in Statistics' },
    { kind: 'group', text: 'Navigation ›', menu: 'Add to group', help: 'Tracks it with related runs on one page' }];
  window.RunCardModel = { cases: CASES.map((c) => ({ id: c.id, label: c.label, group: c.group })), view, add: ADD };
})();
