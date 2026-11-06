// Run card v2 model: every case of the run and group page card as data, and view() that turns a case plus the
// viewer's choices (open stage, added chips, ship mode) into one view model. The local mock and the design canvas
// both render this, so a case is written once. Times in the "working" case are a real run's figures.
(function () {
  const R = window.RailUI;   // states, actions and where the work goes come from the library (docs/rail/logic.md)
  const s = (name, state, time, o) => Object.assign({ name, state, time: time || '', loops: 0, live: '', when: '' }, o || {});
  const ok = (name, time, o) => s(name, 'done', time, o);
  const next = (name, o) => s(name, 'next', '', o);

  const PLAN = [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Refine plan', '40m 5s', { loops: 4 }), ok('Plan review', '19m 19s')];
  const BUILD = [ok('Implementation', '2h 4m', { loops: 3 })];
  const REVIEW = [ok('Review implementation', '37m 21s', { loops: 3 }), ok('Manual tests checklist', '1m 18s'), ok('Manual web UI testing', '21m 10s')];
  const PR_NEXT = [next('Create PR'), next('Checks'), next('Approval')];
  const PR_OPEN = (checks, approval, extra) => [ok('Create PR', '', { live: 'Opened 25 Oct, 13:40' }), checks, approval].concat(extra || []);
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
  const SLICE = [0.42, 0.31, 0.27];   // how much of a whole run each slice of a feature takes
  const SIZES = ['+278 \u221264', '+41 \u221258', '+39 \u221222'];   // each run's diff; a group's is their sum

  const LIVE_FIGS = [['Time', '4h 38m'], ['Cost', '$84.10'], ['Rate', '$18.20/h']];
  const DONE_FIGS = [['Time', '4h 52m'], ['Cost', '$86.02']];
  // Four tabs, one question each: Summary (what you asked, what to check), Changes (what changed: the git diff or a
  // Folder run's files), Activity (how it ran: every step with its log, model and cost; the graph is a view of it),
  // Decisions (questions, answers and approvals). Artifacts sit in Summary; Try it and the patch are the action's ▾.
  const RUN_TABS = [['summary', 'Overview'], ['changes', 'Changes', '5'], ['activity', 'Activity'], ['decisions', 'Decisions', '3']];
  const GROUP_TABS = [['summary', 'Overview'], ['activity', 'Activity'], ['decisions', 'Decisions', '4']];   // the stepper is the list of runs
  const A = R.makeAction;

  const SRC = 'feat/windows-git-bash-shell-with-command';
  const SRC_TAIL = (merged) => [{ key: 'push', label: 'Push', subs: [merged ? ok('Merge back', '', { live: 'Into ' + SRC }) : next('Merge back'), next('To origin/' + SRC)] }];

  const CASES0 = [
    // One run, start to merge
    { id: 'starting', group: 'Run', label: 'Starting', figs: [['Time', '0m 12s'], ['Cost', '$0.00']],
      stages: run({ plan: [s('Clarify', 'now', '', { live: 'Setting up the worktree', when: 'now' }), next('Plan'), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'working', group: 'Run', label: 'Working', figs: LIVE_FIGS,
      stages: run({ review: [REVIEW[0], REVIEW[1], s('Manual web UI testing', 'now', '21m', { live: 'Opening the Runs page at 375px to check the breadcrumb', when: '8s ago' })] }) },
    { id: 'question', group: 'Run', label: R.runState('question').word, figs: LIVE_FIGS,
      stages: run({ review: [s('Review implementation', 'ask', '12m', { live: 'Keep the breadcrumb on phones under 600px, or show only Back there?', when: '4m' }), next('Manual tests checklist'), next('Manual web UI testing')] }) },
    { id: 'paused', group: 'Run', label: 'Paused', detail: 'Usage limit · resumes at 14:00', figs: [['Time', '2h 40m'], ['Cost', '$48.30']],
      stages: run({ build: [s('Implementation', 'paused', '1h 2m')], review: allNext(REVIEW) }) },
    { id: 'failed', group: 'Run', label: 'Failed', figs: [['Time', '2h 12m'], ['Cost', '$41.30']],
      stages: run({ build: [s('Implementation', 'failed', '1h 30m', { loops: 3, live: 'Tests still failing after every retry' })], review: allNext(REVIEW) }) },
    { id: 'ready', group: 'Run', label: 'Ready', figs: DONE_FIGS, stages: run({}) },
    { id: 'checks', group: 'Run', label: 'Checks running', figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(s('Checks', 'now', '', { live: '3 of 7 passed', when: 'running' }), next('Approval')) }) },
    { id: 'failing', group: 'Run', label: 'Checks failing', figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(s('Checks', 'problem', '', { live: '2 failed · unit, e2e' }), next('Approval')) }) },
    { id: 'conflicts', group: 'Run', label: 'Conflicts', figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(ok('Checks', '', { live: '7 of 7 passed' }), s('Up to date with dev', 'problem', '', { live: 'Conflicts in 2 files' })) }) },
    { id: 'approved', group: 'Run', label: 'Approved', figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(ok('Checks', '', { live: '7 of 7 passed' }), ok('Approval', '', { live: 'Approved by 1 reviewer' })) }) },
    { id: 'labelled', group: 'Run', label: 'With labels, tags, group', figs: DONE_FIGS, stages: run({}),
      chips: [{ kind: 'label', text: 'ui' }, { kind: 'label', text: 'needs demo' }, { kind: 'tag', text: 'team: web' }, { kind: 'group', text: 'Navigation' }] },
    { id: 'merged', group: 'Run', label: 'Merged', figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(ok('Checks'), ok('Approval')), merged: LAND('merged', 'Merged 25 Oct, 16:02') }) },

    // States the app has today: a run waiting to start after another, a review gate, a cost cap, kept work, archived
    { id: 'scheduled', group: 'Run', label: 'Waiting (run after)', detail: 'Starts when “Unified page navigation” finishes', figs: [['Time', '0m'], ['Cost', '$0.00']],
      title: 'Breadcrumb tests for saved runs', tabs: [['summary', 'Overview'], ['activity', 'Activity'], ['decisions', 'Decisions']], stages: run({ plan: allNext(PLAN), build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'waiting-interrupted', group: 'Run', label: 'Waiting on an interrupted run', detail: '“Unified page navigation” was interrupted and can still resume; this waits for it', figs: [['Time', '0m'], ['Cost', '$0.00']],
      title: 'Breadcrumb tests for saved runs', tabs: [['summary', 'Overview'], ['activity', 'Activity'], ['decisions', 'Decisions']], stages: run({ plan: allNext(PLAN), build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'gate', group: 'Run', label: 'Review gate', detail: 'Review sent it back 3 times; the limit is 3', figs: LIVE_FIGS,
      stages: run({ review: [s('Review implementation', 'ask', '37m 21s', { loops: 3, live: 'Still 1 minor issue after 3 rounds: accept, or run another cycle?', when: '6m' }), next('Manual tests checklist'), next('Manual web UI testing')] }) },
    { id: 'capped', group: 'Run', label: 'Paused at cost cap', detail: 'Reached the $120 cap for this run', figs: LIVE_FIGS,
      stages: run({ review: [REVIEW[0], s('Manual tests checklist', 'paused', '1m 18s', { live: 'Paused at $120.00' }), next('Manual web UI testing')] }) },
    { id: 'kept', group: 'Run', label: 'Work kept', detail: 'The last commit failed; the work is kept in a copy', over: true, figs: DONE_FIGS,
      stages: run({ review: [REVIEW[0], REVIEW[1], s('Manual web UI testing', 'problem', '21m 10s', { live: 'Commit failed: pre-commit hook exited 1' })] }) },
    { id: 'archived', group: 'Run', label: 'Archived', detail: 'Branch, worktree and logs removed; the remote branch and PR stay', figs: DONE_FIGS, archived: true,
      stages: run({ pr: PR_OPEN(ok('Checks'), ok('Approval')), merged: LAND('merged', 'Merged 25 Oct, 16:02') }) },
    // Where actions lead: a stopped, discarded or applied run
    { id: 'stopped', group: 'Run', label: 'Stopped', detail: 'Stopped by you · the branch and changes stay', figs: [['Time', '2h 40m'], ['Cost', '$48.30']],
      stages: run({ build: [s('Implementation', 'paused', '1h 2m', { live: 'Stopped by you' })], review: allNext(REVIEW) }) },
    { id: 'discarded', group: 'Run', label: 'Discarded', detail: 'The changes are gone; the run stays in history', figs: DONE_FIGS,
      stages: run({ tail: [{ key: 'done', label: 'Done', subs: [s('Discarded', 'paused', '', { live: 'By you, 25 Oct 14:02' })] }] }) },

    // Run kinds
    { id: 'push', group: 'Kinds', label: 'Push path', branch: 'main', figs: [['Time', '38m'], ['Cost', '$6.40']],
      stages: run({ tail: [{ key: 'push', label: 'Push', subs: [next('To origin/main')] }] }) },
    // Run on the source branch: the work lands on the source itself (the agents commit on a hidden copy that merges back
    // when they finish), so from the start the place line names the source and its remote, never a PR; the hidden
    // copy shows only when its merge back failed.
    { id: 'source', group: 'Kinds', label: 'On its source, working', branch: SRC, onSource: true, figs: LIVE_FIGS,
      stages: run({ review: [REVIEW[0], s('Manual tests checklist', 'now', '1m', { live: 'Checking the Git Bash shell opens with its command', when: '4s ago' }), next('Manual web UI testing')], tail: SRC_TAIL() }) },
    { id: 'source-ready', group: 'Kinds', label: 'On its source, ready', branch: SRC, onSource: true, figs: DONE_FIGS,
      stages: run({ tail: SRC_TAIL(true) }) },
    { id: 'source-unmerged', group: 'Kinds', label: 'On its source, not merged back', detail: SRC + ' moved while the run worked', branch: SRC, onSource: true, hidden: 'worca/run-7b0bfb1e',
      figs: DONE_FIGS,
      stages: run({ tail: [{ key: 'push', label: 'Push', subs: [s('Merge back', 'problem', '', { live: 'Not merged back into ' + SRC }), next('To origin/' + SRC)] }] }) },
    { id: 'folder', group: 'Kinds', label: 'Folder run', branch: '', folder: '~/src/marketing-site', figs: [['Time', '52m'], ['Cost', '$9.15']],
      stages: run({ tail: [{ key: 'apply', label: 'Apply', subs: [next('Into the folder', { live: '5 files changed in a copy' })] }] }) },
    { id: 'applied', group: 'Kinds', label: 'Folder applied', branch: '', folder: '~/src/marketing-site', figs: [['Time', '52m'], ['Cost', '$9.15']],
      stages: run({ tail: [{ key: 'apply', label: 'Apply', subs: [s('Into the folder', 'merged', '', { live: '5 files written · 25 Oct 14:05' })] }] }) },
    { id: 'workspace', group: 'Kinds', label: 'Workspace', extraItems: ['worca-api #212', 'worca-web #88', 'worca-docs #31'], detail: 'worca-docs #31 conflicts with main', branch: 'feat/billing-export', project: 'billing workspace', repos: ['worca-api', 'worca-web', 'worca-docs'], figs: [['Time', '3h 05m'], ['Cost', '$52.70']],
      stages: run({ tail: [{ key: 'pr', label: 'PRs', subs: [s('worca-api #212', 'merged', '', { live: 'Merged into main' }), s('worca-web #88', 'now', '', { live: 'Checks running · 5 of 7' }), s('worca-docs #31', 'problem', '', { live: 'Conflicts with main' })] }, { key: 'merged', label: 'Merged', subs: [s('1 of 3 repositories', 'next', '', { live: 'worca-api is in main' })] }] }) },
    { id: 'noproject', group: 'Kinds', label: 'No project', project: '', branch: '', figs: [['Time', '12m'], ['Cost', '$1.80']], tabs: [['summary', 'Overview'], ['activity', 'Activity'], ['decisions', 'Decisions']],
      stages: run({ tail: [{ key: 'done', label: 'Done', subs: [ok('3 artifacts', '', { live: 'In Overview' })] }] }) },

    // Shaper
    { id: 'clarify', group: 'Shaper', label: 'Clarify', figs: [['Time', '2m'], ['Cost', '$0.76']],
      stages: run({ plan: [s('Clarify', 'ask', '34s', { live: '3 questions · which pages, what Back does, phones', when: '1m' }), next('Plan'), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'plan', group: 'Shaper', label: 'Plan ready', figs: [['Time', '34m'], ['Cost', '$15.41']],
      stages: run({ plan: [ok('Clarify', '34s'), s('Plan', 'ask', '33m 57s', { live: '6 steps · 2 open issues · waiting for you', when: '4m' }), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'outline', n: 3, group: 'Shaper', label: 'Plan in slices', figs: [['Time', '41m'], ['Cost', '$18.90']],
      stack: { mode: 'outline' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), s('Cut into runs', 'ask', '7m', { live: '3 runs, one PR each · waiting for you', when: '2m' })] },
        { key: 'run1', label: 'Run 1', subs: allNext(['Plan', 'Build', 'Review', 'Ready'].map((n) => s(n))) }, { key: 'run2', label: 'Run 2', subs: allNext(['Plan', 'Build', 'Review', 'Ready'].map((n) => s(n))) },
        { key: 'run3', label: 'Run 3', subs: allNext(['Plan', 'Build', 'Review', 'Ready'].map((n) => s(n))) }, { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'slice', group: 'Shaper', label: 'A slice running', parent: { caseId: 'feature', index: 1 }, branch: 'feat/head-breadcrumb-2', figs: [['Time', '1h 10m'], ['Cost', '$19.40'], ['Rate', '$16.60/h']],
      stages: run({ build: [s('Implementation', 'now', '12m', { live: 'Builds on run 1 · editing app.js', when: '3s ago' })], review: allNext(REVIEW),
        tail: [{ key: 'ship', label: 'Ship', subs: [next('With the feature', { live: 'One stacked PR each, from the feature page' })] }] }) },

    // Groups
    { id: 'feature', group: 'Groups', runCases: ['ready', 'slice', ''], follows: true, label: 'Feature, run 2', kind: 'Feature', title: 'Unified page navigation', branch: '', figs: [['Time', '3h 20m'], ['Cost', '$61.10'], ['Rate', '$18.30/h']], tabs: GROUP_TABS,
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Cut into runs', '7m', { live: '3 runs, one PR each' })] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m', ''] }),
        member(2, RUNS[1], ['done', 'now', 'next', 'next'], { times: ['18m', '40m'], live: ['', 'Editing app.js'], when: ['', '3s ago'] }),
        member(3, RUNS[2], ['next', 'next', 'next', 'next']),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'featureready', n: 3, group: 'Groups', runCases: ['ready', 'ready', 'ready'], label: 'Feature ready', kind: 'Feature', title: 'Unified page navigation', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS,
      stack: { mode: 'create', runs: RUNS, rec: 'stack', sizes: ['+278 \u221264', '+41 \u221258', '+39 \u221222'], reason: '3 runs and 502 changed lines, most of them in run 1: three focused reviews go faster than one mixed one.' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s', { live: 'Plan accepted by you · pass 2' }), ok('Cut into runs', '7m', { live: '3 runs, one PR each · accepted by you' })] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['18m', '1h 2m', '27m'] }),
        member(3, RUNS[2], ['done', 'done', 'done', 'done'], { times: ['12m', '44m', '19m'] }),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'featureone', n: 2, group: 'Groups', runCases: ['ready', 'ready'], label: 'Feature ready, small', kind: 'Feature', title: 'Unified page navigation', branch: '', figs: [['Time', '1h 40m'], ['Cost', '$21.70']], tabs: GROUP_TABS,
      diff: '+158 \u221262', stack: { mode: 'create', runs: RUNS.slice(0, 2), rec: 'one', sizes: ['+120 \u221240', '+38 \u221222'], reason: '2 small runs, 220 changed lines, that combine without conflicts: one review is enough.' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '12m'), ok('Cut into runs', '3m')] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['8m', '31m', '12m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['6m', '22m', '9m'] }),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2')] }] },
    { id: 'featureblocked', n: 3, group: 'Groups', runCases: ['ready', 'ready', 'ready'], label: 'Feature ready, One PR off', kind: 'Feature', title: 'Unified page navigation', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS,
      stack: { mode: 'create', runs: RUNS, rec: 'stack', sizes: ['+278 \u221264', '+41 \u221258', '+39 \u221222'], oneBlocked: 'Not possible: runs 2 and 3 started from the same branch and both change ui/public/app.js lines 36,380\u201336,412, so they conflict on one branch.', reason: 'Runs 2 and 3 don\u2019t build on each other and conflict; stacked, each lands on top of the one before.' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Cut into runs', '7m')] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['18m', '1h 2m', '27m'] }),
        member(3, RUNS[2], ['done', 'done', 'done', 'done'], { times: ['12m', '44m', '19m'] }),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'chain', group: 'Groups', runCases: ['approved', 'checks', 'failing'], runPRs: ['#959', '#960', '#961'], label: 'Stack in review', kind: 'Chain', title: 'Unified page navigation', detail: '#961 checks failing · #959 ready to merge', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS,
      stack: { mode: 'review' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Cut into runs', '7m')] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['18m', '1h 2m', '27m'] }), member(3, RUNS[2], ['done', 'done', 'done', 'done'], { times: ['12m', '44m', '19m'] }),
        { key: 'pr', label: 'PRs', subs: [ok('#959'), s('#960', 'review'), s('#961', 'problem')] }] },
  ];

  // The rest of what a run can be. A case names the state it shows (`state`); its detail line and steps are its own.
  const PAUSED_AT = (live) => run({ build: [s('Implementation', 'paused', '1h 2m', { live: live || '' })], review: allNext(REVIEW) });
  const P_FIGS = [['Time', '2h 40m'], ['Cost', '$48.30']];
  const pausedCase = (id, state, label, detail, live, o) => Object.assign({ id, state, group: 'Paused', label, detail, figs: P_FIGS, stages: PAUSED_AT(live) }, o || {});
  const TICKET = { title: 'Nightly dependency update', figs: [['Time', '0m'], ['Cost', '$0.00']], tabs: [['summary', 'Overview'], ['activity', 'Activity'], ['decisions', 'Decisions']] };
  const ticket = (id, state, label, detail, o) => Object.assign({ id, state, group: 'Schedule', label, detail, stages: run({ plan: allNext(PLAN), build: allNext(BUILD), review: allNext(REVIEW) }) }, TICKET, o || {});
  const prCase = (id, state, label, detail, pr, o) => Object.assign({ id, state, group: 'Pull request', label, detail, figs: DONE_FIGS, stages: run({ pr }) }, o || {});
  const CHECKS_OK = ok('Checks', '', { live: '7 of 7 passed' });
  const CHECKS_RUN = s('Checks', 'now', '', { live: '3 of 7 passed', when: 'running' });
  const WATCH = (state, live, o) => s('Watch', state, '', Object.assign({ live }, o || {}));
  const REVIEWING = next('Approval', { live: 'Waiting for a review' });
  const RECEIPT_PLAN = [ok('Clarify', '34s'), ok('Plan', '33m 57s', { live: 'Plan accepted by you · pass 2' }), ok('Cut into runs', '7m', { live: '3 runs, one PR each · accepted by you' })];
  const groupOf = (id, group, label, cases3, o) => Object.assign({ id, group, label, runCases: cases3, kind: 'Feature', title: 'Unified page navigation', branch: '', figs: [['Time', '3h 20m'], ['Cost', '$61.10']], tabs: GROUP_TABS, follows: true, state: 'feature',
    stages: [{ key: 'plan', label: 'Plan', subs: RECEIPT_PLAN }, member(1, RUNS[0], ['done', 'done', 'done', 'done']), member(2, RUNS[1], ['done', 'now', 'next', 'next']), member(3, RUNS[2], ['next', 'next', 'next', 'next']), { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] }, o || {});
  const GROUP_RUNS = ['Remove the old invoices page', 'Billing export as CSV'];
  const userGroup = (id, label, runCases, o) => Object.assign({ id, group: 'Groups', label, runCases, runTitles: GROUP_RUNS, kind: 'Group', independent: true, title: 'Billing cleanup', branch: '', figs: [['Time', '1h 40m'], ['Cost', '$21.70']], tabs: GROUP_TABS,
    stages: [member(1, GROUP_RUNS[0], ['done', 'done', 'done', 'done']), member(2, GROUP_RUNS[1], ['done', 'done', 'done', 'done']), { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2')] }] }, o || {});
  const READY3 = (o) => Object.assign({ mode: 'create', runs: RUNS, rec: 'stack', sizes: ['+278 −64', '+41 −58', '+39 −22'], reason: '3 runs and 502 changed lines: three focused reviews go faster than one mixed one.' }, o || {});
  const READY_STAGES = [{ key: 'plan', label: 'Plan', subs: RECEIPT_PLAN }, member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['18m', '1h 2m', '27m'] }), member(3, RUNS[2], ['done', 'done', 'done', 'done'], { times: ['12m', '44m', '19m'] }), { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }];
  const REC_EV = { title: 'This step could not reach the model', log: 'Open the log', lines: ['api.anthropic.com: connection reset, 3 tries', 'Retrying by itself until 14:40'] };
  const AUTH_EV = { title: 'This step could not reach the model', log: 'Open the log', lines: ['401: the Claude token has expired', 'Run claude setup-token or /login, then Retry'] };
  const KEPT_EV = { title: '3 tests failed in test/ui-run-head.test.mjs', log: 'Open log at line 1,284', lines: ['✖ breadcrumb hides under 600px (12ms)', 'hook exited 1 · the work is kept in a copy'] };
  const FAILED_AT = (live) => run({ build: [s('Implementation', 'failed', '1h 30m', { loops: 3, live: live || 'Tests still failing after every retry' })], review: allNext(REVIEW) });
  const APPLY = (state, live) => [{ key: 'apply', label: 'Apply', subs: [s('Into the folder', state, '', { live })] }];
  const FOLDER = { branch: '', folder: '~/src/marketing-site' };

  const GROUP_SHIP = { 'Create 2 PRs': { to: 'group-shipped', say: 'Created #959 and #960', dialog: 'pr' }, 'Create PR': { to: 'group-shipped', say: 'A new branch combines both runs; opened #959', dialog: 'pr' } };
  const CASES1 = [
    // Paused, and why: each reason has its words and its own way on
    pausedCase('paused-limit', 'paused-limit', 'Usage limit, resets soon', 'Claude Code’s usage limit · resets at 13:55, in 1h 12m'),
    pausedCase('paused-reset', 'paused-reset', 'Usage limit, has reset', 'Claude Code’s usage limit · it reset at 13:55; Resume to go on'),
    pausedCase('paused-missed', 'paused-missed', 'Usage limit, resume missed', 'Usage limit · the resume at 14:00 was missed'),
    pausedCase('paused-free', 'paused-limit', 'Free requests used up', 'OpenRouter’s free-model requests are used up · they come back at 14:00'),
    pausedCase('paused-budget', 'paused-budget', 'Total budget', 'Total budget reached · $500 of $500 this month', 'Paused at the total budget'),
    pausedCase('paused-team', 'paused-team', 'Team cap', 'Reached your team’s cap of $200 for a run', 'Paused at the team cap'),
    pausedCase('paused-restart', 'paused-reason', 'Worca restarted', 'Worca restarted · the worktree and progress are kept'),
    pausedCase('paused-time', 'paused-reason', 'Time limit', 'Reached a step’s time limit of 1h · Resume runs the step again', 'Stopped at its 1h limit'),
    pausedCase('paused-away', 'paused-reason', 'Away mode limit', 'Away mode limit reached · $20 of answers tonight'),
    pausedCase('paused-error', 'paused-reason', 'Paused on an error', 'Paused on an error: no space left on device · fix it, then Resume', 'No space left on device'),
    pausedCase('interrupted', 'interrupted', 'Interrupted', 'Worca stopped while it ran · Resume goes on from this step', 'Interrupted'),
    pausedCase('interrupted-dead', 'interrupted-dead', 'Interrupted, cannot resume', 'Worca stopped while it ran · this run cannot resume', 'Interrupted', { over: true, noSetup: true }),

    // Live, in trouble, or not in the usual shape
    { id: 'copying', state: 'starting', group: 'Live', label: 'Copying the folder', detail: 'Copying the folder', figs: [['Time', '0m 12s'], ['Cost', '$0.00']], ...FOLDER,
      stages: run({ plan: [s('Clarify', 'now', '', { live: 'Preflight: checking the copy', when: 'now' }), next('Plan'), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW), tail: APPLY('next', 'Nothing changed yet') }) },
    { id: 'network', group: 'Live', label: 'Waiting for the network', detail: 'Waiting for the network · api.anthropic.com · retries by itself until 14:40', figs: LIVE_FIGS,
      stages: run({ review: [REVIEW[0], s('Manual tests checklist', 'now', '1m', { live: 'Waiting for the network', when: '40s' }), next('Manual web UI testing')] }) },
    { id: 'recovery', group: 'Live', label: 'Cannot reach the model', detail: 'This step could not reach the model · it retries by itself until 14:40', figs: LIVE_FIGS, ev: REC_EV,
      stages: run({ build: [s('Implementation', 'problem', '1h 2m', { live: R.failureOf('Reach the model').title })], review: allNext(REVIEW) }) },
    { id: 'recovery-auth', state: 'recovery', group: 'Live', label: 'Sign-in expired', detail: 'The Claude token has expired · run claude setup-token, then Retry', figs: LIVE_FIGS, ev: AUTH_EV,
      stages: run({ build: [s('Implementation', 'problem', '1h 2m', { live: R.failureOf('Reach the model').title })], review: allNext(REVIEW) }) },
    { id: 'parallel', state: 'working', group: 'Live', label: 'Parallel steps', figs: LIVE_FIGS,
      stages: run({ review: [s('Review implementation', 'now', '12m', { live: 'Reading the diff', when: '2s ago' }), s('Manual tests checklist', 'now', '9m', { live: 'Writing the checklist', when: '5s ago' }), s('Manual web UI testing', 'now', '3m', { live: 'Opening the Runs page', when: '1s ago' })] }) },
    { id: 'roles-live', state: 'working', group: 'Live', label: 'Role reviews running', figs: LIVE_FIGS,
      stages: run({ review: [s('Security review', 'done', '6m', { live: 'Passed · no findings' }), s('Design review', 'now', '4m', { live: 'Reading the diff', when: '3s ago' }), s('Backend review', 'now', '4m', { live: 'Checking the routes', when: '9s ago' }), next('Manual web UI testing')] }) },
    { id: 'nodes', state: 'working', group: 'Live', label: 'A workflow without stages', title: 'Weekly issue triage', figs: LIVE_FIGS, tabs: [['summary', 'Overview'], ['activity', 'Activity'], ['decisions', 'Decisions']], noDiff: true, branch: '',
      stages: [{ key: 'n1', label: 'Fetch issues', subs: [ok('Fetch issues', '4m')] }, { key: 'n2', label: 'Triage', subs: [s('Triage', 'now', '2m', { live: 'Sorting 41 issues', when: '3s ago' })] }, { key: 'n3', label: 'Write report', subs: [next('Write report')] }, { key: 'n4', label: 'Post report', subs: [next('Post report')] }] },
    { id: 'noreview', state: 'working', group: 'Live', label: 'A stage not in the workflow', figs: LIVE_FIGS,
      stages: run({ build: [s('Implementation', 'now', '12m', { live: 'Editing app.js', when: '3s ago' })], review: [next('Not in this workflow')] }) },

    // Finished, with something to say
    { id: 'ready-issues', state: 'ready', group: 'Finished', label: 'Ready, open issues', detail: '2 open issues · not in dev yet', figs: DONE_FIGS, stages: run({}), issues: true, shaped: true },
    { id: 'ready-end', state: 'ready', group: 'Finished', label: 'Ready, end not reached', detail: 'End not reached · part of the workflow did not run', figs: DONE_FIGS, stages: run({}) },
    { id: 'ready-moved', state: 'ready', group: 'Finished', label: 'Ready, base moved', detail: 'Not in dev yet · dev moved while it ran', figs: DONE_FIGS, stages: run({}), baseMoved: true },
    { id: 'ready-held', state: 'ready', group: 'Finished', label: 'Ready, branch held', figs: DONE_FIGS, stages: run({}), heldBy: 'Breadcrumb tests for saved runs' },
    { id: 'ready-deps', state: 'ready', group: 'Finished', label: 'Ready, runs wait on it', figs: DONE_FIGS, stages: run({}), dependents: 2 },
    { id: 'ready-nocost', state: 'ready', group: 'Finished', label: 'Ready, engine with no cost', figs: DONE_FIGS, stages: run({}), agentsUnknown: true },
    { id: 'hosted', state: 'ready', group: 'Finished', label: 'Ready, on a hosted Worca', figs: DONE_FIGS, stages: run({}), hosted: true },
    { id: 'finished-nogit', state: 'noproject', group: 'Finished', label: 'Finished, no git', detail: 'Git is not set up here, so there is no branch or PR', branch: '', figs: [['Time', '12m'], ['Cost', '$1.80']], noDiff: true, noSetup: true, tabs: [['summary', 'Overview'], ['activity', 'Activity'], ['decisions', 'Decisions']],
      stages: run({ tail: [{ key: 'done', label: 'Done', subs: [ok('Finished')] }] }) },
    { id: 'folder-nochange', state: 'noproject', group: 'Finished', label: 'Folder, no files changed', detail: 'No files changed', ...FOLDER, figs: [['Time', '12m'], ['Cost', '$1.80']], noDiff: true, tabs: [['summary', 'Overview'], ['activity', 'Activity'], ['decisions', 'Decisions']],
      stages: run({ tail: [{ key: 'done', label: 'Done', subs: [ok('Finished', '', { live: 'Nothing to apply' })] }] }) },
    { id: 'failed-kept', group: 'Finished', label: 'Failed, work kept', detail: 'Tests still failing · the work is kept in a copy', over: true, ev: KEPT_EV, figs: [['Time', '2h 12m'], ['Cost', '$41.30']], stages: FAILED_AT() },
    { id: 'failed-kept-wait', group: 'Finished', label: 'Failed, kept work settling', detail: 'Tests still failing · the kept work is still being saved', over: true, ev: KEPT_EV, figs: [['Time', '2h 12m'], ['Cost', '$41.30']], stages: FAILED_AT() },
    { id: 'failed-folder', group: 'Finished', label: 'Failed, folder copy pending', detail: 'Tests still failing · 5 files changed in a copy', over: true, ...FOLDER, ev: KEPT_EV, figs: [['Time', '52m'], ['Cost', '$9.15']],
      stages: run({ build: [s('Implementation', 'failed', '30m', { live: 'Tests still failing after every retry' })], review: allNext(REVIEW), tail: APPLY('next', '5 files changed in a copy') }) },
    { id: 'stopped-folder', group: 'Finished', label: 'Stopped, folder copy pending', detail: 'Stopped by you · 5 files changed in a copy', over: true, ...FOLDER, figs: [['Time', '52m'], ['Cost', '$9.15']],
      stages: run({ build: [s('Implementation', 'paused', '30m', { live: 'Stopped by you' })], review: allNext(REVIEW), tail: APPLY('next', '5 files changed in a copy') }) },
    { id: 'in-base', group: 'Finished', label: 'Already in the base', detail: 'Already in dev through another branch · no PR of its own', noSetup: true, figs: DONE_FIGS, stages: run({ tail: [{ key: 'merged', label: 'Merged', subs: [s('Into dev', 'merged', '', { live: 'In dev · no PR of its own' })] }] }) },
    { id: 'pushed', group: 'Finished', label: 'On its source, pushed', detail: SRC + ' is on origin', branch: SRC, onSource: true, figs: DONE_FIGS, stages: run({ tail: [{ key: 'push', label: 'Push', subs: [ok('Merge back', '', { live: 'Into ' + SRC }), s('To origin/' + SRC, 'merged', '', { live: 'Pushed' })] }] }) },
    { id: 'diverged', group: 'Finished', label: 'On its source, diverged', detail: SRC + ' and origin have diverged: pull or rebase, then push', branch: SRC, onSource: true, figs: DONE_FIGS, stages: run({ tail: [{ key: 'push', label: 'Push', subs: [ok('Merge back', '', { live: 'Into ' + SRC }), s('To origin/' + SRC, 'problem', '', { live: 'Diverged' })] }] }) },
    { id: 'deleted', group: 'Finished', label: 'Deleted', detail: 'Gone from Runs; only this page still knows it', figs: DONE_FIGS, noSetup: true, archived: true, stages: run({ tail: [{ key: 'done', label: 'Done', subs: [s('Deleted', 'paused', '', { live: 'By you' })] }] }) },

    // A scheduled run before it is a run
    ticket('ticket-missed', 'ticket-missed', 'Missed its start', 'Missed its 09:00 start · Worca was off'),
    ticket('ticket-firing', 'ticket-firing', 'Its time has come', 'Starting from its schedule', { over: true }),
    ticket('ticket-failed', 'ticket-failed', R.failureOf('Start').title, R.failureOf('Start at 09:00').title + ': the project folder is gone'),
    ticket('ticket-canceled', 'ticket-ended', 'Cancelled', 'Cancelled before it started'),
    ticket('ticket-skipped', 'ticket-ended', 'Skipped', 'Skipped: the last one was still running'),

    // A pull request's own states
    prCase('pr-draft', 'pr-draft', 'Draft', 'Draft · no one is asked to review yet', PR_OPEN(CHECKS_OK, next('Approval', { live: 'Not asked yet: it is a draft' }))),
    prCase('pr-waiting', 'checks', 'Waiting for a review', 'Waiting for a review', PR_OPEN(CHECKS_OK, REVIEWING), { flow: { next: null } }),
    prCase('pr-changes', 'pr-changes', 'Changes requested', 'Changes requested by a reviewer', PR_OPEN(CHECKS_OK, s('Approval', 'problem', '', { live: 'Changes requested by 1 reviewer' }))),
    prCase('pr-fixing', 'pr-fixing', 'Fixing', 'Fixing · round 2 · fix the failing e2e check', PR_OPEN(s('Checks', 'problem', '', { live: '1 failed · e2e' }), REVIEWING, [WATCH('now', 'Fixing · round 2'), ok('Round 1', '6m', { live: 'Fixed the unit test' }), s('Round 2', 'now', '2m', { live: 'Fix the failing e2e check', when: '4s ago' })])),
    prCase('pr-closed', 'pr-closed', 'Closed', 'The PR was closed without merging', [s('Create PR', 'paused', '', { live: '#959 was closed without merging' }), next('Checks'), next('Approval')]),
    prCase('pr-abandoned', 'pr-closed', 'Closed, on Azure', 'The PR was abandoned', [s('Create PR', 'paused', '', { live: '#959 was abandoned' }), next('Checks'), next('Approval')], { host: 'azure' }),
    prCase('pr-declined', 'pr-closed', 'Closed, on Bitbucket', 'The PR was declined', [s('Create PR', 'paused', '', { live: '#959 was declined' }), next('Checks'), next('Approval')], { host: 'bitbucket' }),
    prCase('pr-behind', 'pr-behind', 'Out of date', 'Out of date with dev', PR_OPEN(CHECKS_OK, s('Up to date with dev', 'problem', '', { live: '4 commits behind; it merges cleanly' }))),
    prCase('pr-blocked', 'pr-blocked', 'Blocked', 'Blocked by branch rules', PR_OPEN(CHECKS_OK, s('Approval', 'problem', '', { live: 'Branch rules need 2 approvals; it has 1' }))),
    prCase('watching', 'checks', 'Watch on', '', PR_OPEN(CHECKS_RUN, next('Approval'), [WATCH('now', 'Watching · fixes failing checks and asked-for changes')])),
    prCase('watch-merging', 'pr-fixing', 'Watch merging', 'Merging dev in', PR_OPEN(CHECKS_OK, s('Up to date with dev', 'problem', '', { live: '4 commits behind' }), [WATCH('now', 'Merging dev in')])),
    prCase('watch-resolving', 'pr-fixing', 'Watch resolving', 'Resolving conflicts', PR_OPEN(CHECKS_OK, s('Up to date with dev', 'problem', '', { live: 'Conflicts in 2 files' }), [WATCH('now', 'Resolving conflicts')])),
    prCase('watch-stopped', 'watch-stopped', 'Watch stopped', 'Watch stopped · 2 fix runs, conflicts remain', PR_OPEN(CHECKS_OK, s('Up to date with dev', 'problem', '', { live: 'Conflicts in 2 files' }), [WATCH('paused', 'Stopped · 2 fix runs, conflicts remain')])),
    prCase('watch-off', 'checks', 'Watch unavailable', '', PR_OPEN(CHECKS_RUN, next('Approval'), [WATCH('paused', 'Unavailable: no token for this repository')]), { flow: { next: null } }),
    prCase('watch-finishing', 'pr-fixing', 'Watch off, finishing', 'Watch is off; its last fix is finishing', PR_OPEN(CHECKS_OK, REVIEWING, [WATCH('now', 'Disabled (finishing)')])),
    prCase('round', 'round', 'A fix round', 'Round 2 · fix the failing e2e check', PR_OPEN(CHECKS_RUN, next('Approval'), [ok('Round 1', '6m', { live: 'Fixed the unit test' }), s('Round 2', 'now', '2m', { live: 'Fix the failing e2e check', when: '4s ago' })])),
    prCase('round-failing', 'round', 'A round, PR failing', 'Round 2 · checks still failing; the run that opened the PR raises it', PR_OPEN(s('Checks', 'review', '', { live: '1 failed · e2e' }), next('Approval'), [ok('Round 1', '6m', { live: 'Fixed the unit test' }), ok('Round 2', '2m', { live: 'Pushed its fix' })]), { flow: { next: null } }),
    prCase('auto-opened', 'checks', 'PR opened by itself', '', [ok('Create PR', '', { live: 'Opened by itself when the run finished · 25 Oct, 13:40' }), CHECKS_RUN, next('Approval')], { flow: { next: null } }),
    prCase('auto-failed', 'ready', 'PR not opened by itself', '', [next('Create PR', { live: 'Not opened: gh is not signed in' }), next('Checks'), next('Approval')], { openStage: 'pr' }),
    prCase('reqs', 'reqs', 'Requirements to mark', '', [next('Create PR', { live: 'Waiting for the requirements to be marked' }), next('Checks'), next('Approval')], { reqsCheck: true, openStage: 'pr', shaped: true }),

    // Shaper
    { id: 'requirements', group: 'Shaper', label: 'Requirements', figs: [['Time', '2m'], ['Cost', '$0.76']],
      stages: run({ plan: [ok('Clarify', '34s'), s('Requirements', 'ask', '1m', { live: '4 agreed · 1 needs you', when: '1m' }), next('Plan'), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'auto', group: 'Shaper', label: 'Auto proposal', figs: [['Time', '1m'], ['Cost', '$0.12']],
      stages: run({ plan: [s('Auto workflow', 'ask', '1m', { live: 'Proposes 7 steps for this task', when: '1m' }), next('Clarify'), next('Plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'auto-feature', state: 'ready', group: 'Shaper', label: 'A slice, PR waits', parent: { caseId: 'feature', index: 0 }, branch: 'feat/head-breadcrumb-1', figs: DONE_FIGS, shipLive: 'Waiting for the feature',
      stages: run({ tail: [{ key: 'ship', label: 'Ship', subs: [next('With the feature')] }] }) },

    // Groups: what holds a group up, and how it ships
    groupOf('feature-failed', 'Groups', 'Feature, a run failed', ['ready', 'failed', '']),
    groupOf('feature-paused', 'Groups', 'Feature, a run paused', ['ready', 'paused', '']),
    groupOf('feature-needs', 'Groups', 'Feature, a run asks', ['ready', 'question', '']),
    groupOf('feature-stopped', 'Groups', 'Feature, stopped', ['ready', 'stopped', '']),
    groupOf('feature-asks', 'Groups', 'Feature, asks before run 3', ['ready', 'ready', ''], { state: 'group-asks', k: 3, follows: false, detail: 'Run 2 is ready · run 3 waits for your OK', askEach: true }),
    groupOf('ship-waiting', 'Groups', 'Ship, waiting for runs', ['ready', 'slice', ''], { shipWaiting: 'Waiting for run 2' }),
    { id: 'ship-declined', n: 3, group: 'Groups', runCases: ['ready', 'ready', 'ready'], label: 'Ship, not now', kind: 'Feature', title: 'Unified page navigation', detail: 'Not shipped yet · ship it from here', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS, stack: READY3(), stages: READY_STAGES },
    { id: 'ship-applied', group: 'Groups', runCases: ['approved', 'approved', 'approved'], runPRs: ['#959', '#959', '#959'], label: 'Ship, applied', kind: 'Feature', title: 'Unified page navigation', detail: 'Shipped as one PR · closed 3 drafts · release v1.20.0 drafted', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS,
      stages: READY_STAGES.slice(0, -1).concat({ key: 'pr', label: 'PRs', subs: [ok('#959', '', { live: 'All 3 runs · into dev' })] }) },
    { id: 'feature-reqs', state: 'featureblocked', n: 3, group: 'Groups', runCases: ['ready', 'ready', 'ready'], label: 'Feature, requirements to mark', kind: 'Feature', title: 'Unified page navigation', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS, reqsCheck: true, shaped: true, stack: READY3(), stages: READY_STAGES },
    { id: 'chain-loose', state: 'featureblocked', n: 3, group: 'Groups', runCases: ['ready', 'ready', 'ready'], label: 'Chain, One PR off', kind: 'Chain', title: 'Unified page navigation', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS, stack: READY3({ oneBlocked: 'A run does not start from the previous run’s branch', reason: 'Stacked, each run lands on top of the one before.' }), stages: READY_STAGES },
    { id: 'chain-owned', state: 'featureblocked', n: 3, group: 'Groups', runCases: ['ready', 'ready', 'ready'], label: 'Feature, a run has a PR', kind: 'Feature', title: 'Unified page navigation', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS, stack: READY3({ oneBlocked: 'A run already has a PR', reason: 'Run 1 already has its PR; the others stack on it.' }), stages: READY_STAGES },
    userGroup('group-working', 'Group, in any order', ['ready', 'working'], { state: 'feature', detail: 'Any order · 1 of 2 running' }),
    userGroup('group-shipped', 'Group, shipped', ['approved', 'approved'], { state: 'ship-applied', runPRs: ['#959', '#960'], detail: 'Shipped as 2 PRs', stages: [member(1, GROUP_RUNS[0], ['done', 'done', 'done', 'done']), member(2, GROUP_RUNS[1], ['done', 'done', 'done', 'done']), { key: 'pr', label: 'PRs', subs: [s('#959', 'review'), s('#960', 'review')] }] }),
    userGroup('group-ready', 'Group, ready', ['ready', 'ready'], { state: 'featureone', n: 2, flow: GROUP_SHIP, stack: { mode: 'create', runs: GROUP_RUNS, rec: 'stack', sizes: ['+120 −40', '+38 −22'], reason: 'The two runs combine cleanly, so one PR is possible: a new branch combines their branches.' } }),
    userGroup('group-checking', 'Group, One PR being checked', ['ready', 'ready'], { state: 'featureone', n: 2, flow: Object.assign({ next: 'group-ready', event: 'The runs combine cleanly' }, GROUP_SHIP), stack: { mode: 'create', runs: GROUP_RUNS, rec: 'stack', sizes: ['+120 −40', '+38 −22'], oneBlocked: 'Checking whether the runs combine…', reason: 'Each run has its own PR until the check says they combine.' } }),
    { id: 'workspace-partly', group: 'Kinds', label: 'Workspace, partly shipped', detail: '1 of 2 merged · worca-docs has no PR yet', branch: 'feat/billing-export', project: 'billing workspace', repos: ['worca-api', 'worca-web', 'worca-docs'], figs: [['Time', '3h 05m'], ['Cost', '$52.70']],
      stages: run({ tail: [{ key: 'pr', label: 'PRs', subs: [s('worca-api #212', 'merged', '', { live: 'Merged into main · Watch off' }), ok('worca-web', '', { live: 'No changes in this repository' }), next('worca-docs', { live: 'No PR yet' })] }, { key: 'merged', label: 'Merged', subs: [s('1 of 2 repositories', 'next', '', { live: 'worca-api is in main' })] }] }) },
  ];
  // A case's facts are its own; its state's word, colour and one action are the library's.
  const CTX = { pr: '#959', pr2: '#960', pr3: '#961', base: 'dev', branch: 'feat/unified-page-navigation-one-head-breadcrumb', groupBranch: 'feat/unified-page-navigation', source: SRC, hidden: 'worca/run-7b0bfb1e', folder: '~/src/marketing-site' };
  const ctxOf = (c) => Object.assign({}, CTX, c.n ? { n: c.n } : {}, c.k ? { k: c.k } : {}, c.host ? { host: c.host } : {}, c.extraItems ? { extraItems: c.extraItems } : {});
  const CASES = CASES0.concat(CASES1).map((c) => Object.assign({}, R.runState(c.state || c.id, ctxOf(c)), c));

  // The stack: the PRs of a feature or chain, in merge order, each based on the one above it.
  const outlineRows = (titles) => titles.map((t, i) => ({ num: String(i + 1), title: t, state: 'next', word: ['Small', 'Medium', 'Small'][i] || 'Small', sub: i ? 'Builds on run ' + i : 'Starts from dev', editable: true, index: i }));
  const STACKS = {
    outline: (titles) => ({ title: titles.length + ' runs, one PR each', note: 'Each run builds on the one before', rows: outlineRows(titles) }),
    create: () => ({ title: 'Ship as', choice: true }),
  };
  // A stack in review merges one PR at a time, in order. Each PR's state: ready, review, checks (moved onto dev, checks
  // running again), failing, merged. Merging one makes Worca move the next onto dev (today nothing does: it keeps
  // pointing at the merged branch unless GitHub deletes that branch).
  const CHAIN_PRS = [['#959', '+278 \u221264'], ['#960', '+41 \u221258'], ['#961', '+39 \u221222']];
  const CHAIN_START = ['ready', 'review', 'failing'];
  const PR_LOOK = { ready: ['done', R.runState('approved').word, '7 of 7 checks · approved'], review: ['review', R.runState('checks').word, '5 of 7 checks'],
    checks: ['review', 'Checks running', 'moved onto dev · checks run again'], failing: ['problem', 'Checks failing', '2 failed'], merged: ['merged', 'Merged', 'merged'] };
  const chainBase = (st, i) => (i === 0 || st[i - 1] === 'merged' ? 'dev' : CHAIN_PRS[i - 1][0]);
  function reviewOf(st) {
    const k = st.indexOf(st.find((x) => x !== 'merged'));
    return { title: 'Merge in order', rows: CHAIN_PRS.map(([num, size], i) => { const [state, word, sub] = PR_LOOK[st[i]];
      const base = chainBase(st, i); const moved = st[i] === 'checks' && i > 0 && base === 'dev';
      return { num, title: RUNS[i], state, word, sub: st[i] === 'merged' ? 'Into dev' : 'Into ' + base + ' · ' + size + ' · ' + (st[i] === 'checks' && !moved ? 'checks run again' : sub), isNext: i === k }; }) };
  }
  // The chain page follows its PRs: fix what fails first, else merge the next ready one, else wait for review.
  function chainLive(c, st) {
    const k = st.findIndex((x) => x !== 'merged');
    const pr = { key: 'pr', label: 'PRs', subs: CHAIN_PRS.map(([num], i) => s(num, PR_LOOK[st[i]][0] === 'done' ? 'done' : PR_LOOK[st[i]][0])) };
    const stages = c.stages.slice(0, -1).concat(pr);
    if (k < 0) return Object.assign({}, c, { stages, word: 'Merged', dot: 'is-violet', detail: 'All 3 merged into dev, in order', action: A('View PRs', 'merge', false, ['Copy PR links']) });
    const f = st.indexOf('failing'); const ready = st[k] === 'ready';
    const tools = ['View PRs', 'Watch PRs', 'Copy PR links'];
    const action = f >= 0 ? A('Fix checks on ' + CHAIN_PRS[f][0], 'refresh', true, (ready ? ['Merge ' + CHAIN_PRS[k][0]] : []).concat(tools))
      : ready ? A('Merge ' + CHAIN_PRS[k][0], 'merge', true, tools) : A('View PRs', 'pr', false, tools.slice(1));
    const detail = [f >= 0 ? CHAIN_PRS[f][0] + ' checks failing' : '', ready ? CHAIN_PRS[k][0] + ' ready to merge' : '', !ready && f < 0 ? CHAIN_PRS[k][0] + ' ' + PR_LOOK[st[k]][1].toLowerCase() : ''].filter(Boolean).join(' · ');
    return Object.assign({}, c, { stages, word: R.runState(f >= 0 || ready ? 'question' : 'checks').word, dot: f >= 0 || ready ? 'is-amber' : 'is-peach is-pulse', detail, action });
  }



  // What the tabs hold, shared by every case (sample content; the step list comes from the case itself).
  const MODEL_OF = { Clarify: 'Sonnet 5.5', Plan: 'Opus 5.5', 'Refine plan': 'Opus 5.5', 'Plan review': 'Sonnet 5.5', Implementation: 'Opus 5.5',
    'Review implementation': 'Opus 5.5', 'Manual tests checklist': 'Haiku 5.5', 'Manual web UI testing': 'Sonnet 5.5' };
  const COST_OF = { Clarify: '$0.76', Plan: '$14.65', 'Refine plan': '$18.29', 'Plan review': '$7.82', Implementation: '$31.18', 'Review implementation': '$9.95', 'Manual tests checklist': '$0.80', 'Manual web UI testing': '$0.65' };
  const DETAIL = {
    task: 'One head for the run and group pages: Back, the breadcrumb and the run’s actions in the top bar, and the page title once.',
    // Before you ship: what needs your eyes, each with why it is there and its one way to act.
    check: [{ t: 'On phones under 600px only Back shows, not the breadcrumb: try it on a phone', why: 'Worca decided this while you were away', act: 'Change it', go: 'tab:decisions' },
      { t: 'Back on a group page now goes to Runs, not the group list', why: 'A change you did not ask for' },
      { t: 'run-head.mjs is new and has 2 review notes', why: 'The largest change', act: 'Open it', go: 'file:0' }],
    // The ask, part by part, with what was done; and what it did unasked.
    ask: [['One head for the run and group pages', 'The breadcrumb, the title and the actions share one row'],
      ['Back, the breadcrumb and the actions in the top bar', 'Back became the breadcrumb: it goes up a level'],
      ['The page title once', 'The title row holds it; the bar no longer repeats it']],
    unasked: ['96 new tests', 'test/ui-run-head.test.mjs'],
    artifacts: [['plan.md', 'Plan'], ['review-3.md', 'Review implementation'], ['checklist.md', 'Manual tests checklist']],
    files: [['ui/public/run-head.mjs', 182, 64], ['ui/public/style.css', 41, 58], ['ui/public/app.js', 27, 19], ['ui/public/nav/routes.mjs', 12, 3], ['test/ui-run-head.test.mjs', 96, 0]],
    // Per file: added or modified, review comments, and the first hunk shown when the file opens.
    fileMeta: { 'ui/public/run-head.mjs': { st: 'A', notes: 2 }, 'test/ui-run-head.test.mjs': { st: 'A' }, 'ui/public/nav/routes.mjs': { st: 'M', notes: 1 } },
    hunk: { at: '@@ ui/public/app.js:36,380', lines: [[' ', 'function paintRunHead(run, el) {'], ['-', '  el.append(backButton(run));'], ['-', '  el.append(groupList(run));'], ['+', '  el.append(breadcrumb(ROUTES.parentOf(run)));'], ['+', '  el.append(titleRow(run), actions(run));'], [' ', '}']] },
    // What the run says it did, once Build has made something.
    outcome: ['Run and group pages share one head: the breadcrumb, the title and the actions', 'Back is gone from group pages; the breadcrumb goes up a level', 'Under 760px the bar shows one link, ‹ Parent name', '96 new tests in test/ui-run-head.test.mjs'],
    // The approved plan, item by item.
    plan: ['Add ROUTES.parentOf for run, group and slice pages', 'Build the breadcrumb from the parent chain', 'Move Back, Pause and Stop into the top bar', 'One title row: title, kind chip, actions', 'Phone: ‹ Parent under 760px', 'Tests for every page type'],
    planIssues: ['Slices: the parent is the feature, not the project', 'Saved runs have no live parent: fall back to Runs'],
    // A step that ran more than once: each round and why it went round again.
    rounds: {
      'Refine plan': [['9m 40s', 'Sent back: no phone layout'], ['11m 02s', 'Sent back: slices had no parent'], ['10m 13s', 'Sent back: tests missing for saved runs'], ['9m 10s', 'Accepted']],
      Implementation: [['48m', 'Review found 3 failing tests'], ['41m', 'Review: bar has two primaries'], ['35m', 'Accepted']],
      'Review implementation': [['14m', 'Sent back to Build'], ['12m', 'Sent back to Build'], ['11m 21s', 'Passed']] },
    decisions: [
      { step: 'Clarify', q: 'Which pages get the breadcrumb?', a: 'Run and group pages', who: 'you', when: '08:33' },
      { step: 'Plan', q: 'Approve the plan', a: 'Approved · 6 steps, 2 open issues fixed', who: 'you', when: '09:12' },
      { step: 'Review implementation', q: 'Keep the breadcrumb on phones under 600px?', a: 'Show only Back there', who: 'away', when: '12:48', note: 'Sonnet 5.5 · $0.32' }],
    issue: '#942',
    // What Generate drafts: the run's own summary, its changes and how it was checked (the AI draft, as today).
    prBody: (title, files) => ['## Summary', ...DETAIL.outcome.map((x) => '- ' + x), '', '## Changes', ...files.map(([f, a, d]) => '- `' + f + '` +' + a + ' \u2212' + d), '',
      '## How it was checked', '- 96 new tests in test/ui-run-head.test.mjs', '- Review implementation: 3 rounds, no open issues', '- Manual web UI testing at 375px and 900px', '', 'Closes #942'].join('\n'),
    // A stacked PR's description: its run's summary, the Stack in merge order (this PR marked), how it was checked; only
    // the last PR closes the issue, so the first merge does not close it while the rest are open.
    // A stacked PR's row: a one-line summary, its size, and why it is worth a look when Worca thinks so.
    prSum: ['One head shared by run and group pages; Back goes', 'The trail moves into the top bar; the page is never a crumb', 'The head on phones: ‹ Parent, one-line title'],
    prFiles: [6, 4, 3],
    prFlag: { 1: 'Worth a look: changes 2 files PR 1 also changes' },
    // Today's text for a stacked PR (the server's template), kept when Worca cannot write one.
    prTemplate: (i, titles, feature) => ['Part of ' + feature + ': slice ' + (i + 1) + ' of ' + titles.length, ...titles.map((t, j) => j === i ? null : '- Slice ' + (j + 1) + ', ' + t + ': not opened yet').filter(Boolean), '', titles[i]].concat(i === titles.length - 1 ? ['', 'Closes #942'] : []).join('\n'),
    // Every suggestion runs on a helper job's model (Models › Helper jobs), named in the sparkle's tooltip.
    helper: { pr: { job: 'PR description', model: 'Haiku 5.5' }, draft: { job: 'Drafts', model: 'Haiku 5.5' } },
    prBodyStack: (i, titles, feature) => ['## Summary', '- ' + ['Run and group pages share one head: the breadcrumb, the title and the actions in one row', 'The breadcrumb takes its parent from the route, a slice from its feature', 'Under 760px the bar shows one link, ‹ Parent name'][i % 3], '',
      '## Stack', ...titles.map((t, j) => (j + 1) + '. ' + (j === i ? '**This PR**: ' : '') + t + ' → ' + (j === 0 ? 'dev' : j === i + 1 ? 'this PR' : 'PR ' + j)), '',
      '## How it was checked', '- ' + [41, 33, 22][i % 3] + ' new tests in test/ui-run-head.test.mjs', '',
      'Part ' + (i + 1) + ' of ' + titles.length + ' of “' + feature + '”' + (i === titles.length - 1 ? '\n\nCloses #942' : '')].join('\n'),
    // The question a run is waiting on: the options Worca offers, the one it would pick, and why.
    asks: {
      question: { q: 'Keep the breadcrumb on phones under 600px, or show only Back there?', why: 'Review implementation found the trail wraps to two lines at 375px.',
        options: ['Keep the full breadcrumb, truncate the middle crumbs', 'Show only ‹ Parent under 600px', 'Hide the breadcrumb on phones'], pick: 1 },
      clarify: { q: 'Which pages get the breadcrumb?', why: 'The task names the run page; group and saved run pages share its head.', n: '1 of 3',
        options: ['Run pages only', 'Run and group pages', 'Every page with a parent'], pick: 1 },
      requirements: { q: 'On phones, does the page keep its full trail?', why: 'Security and Design disagree · 4 requirements agreed by the perspectives', options: ['Keep the full trail', 'Show only ‹ Parent under 600px'], pick: 1 },
      auto: { kind: 'auto', q: 'Run this workflow?', why: 'A medium change in two areas, with UI: Worca adds a plan review and a manual test, and leaves out the security review.' } },
    budget: 120,
    // What the plan answers to: the requirements the perspectives agreed, and the one that needs you.
    criteria: [['R-po-1', 'Run and group pages share one head'], ['R-po-2', 'The breadcrumb goes up one level, never to the page itself'], ['R-po-3', 'Under 760px the bar shows one link, ‹ Parent name'], ['R-sec-1', 'No route exposes another person’s run']],
    // A review's findings, by role, and the issues a gate still holds open.
    issues: [{ sev: 'Minor', t: 'The trail wraps to two lines at 375px', at: 'ui/public/run-head.mjs:41' }, { sev: 'Minor', t: 'Group pages keep an unused Back handler', at: 'ui/public/app.js:36,392' }],
    roles: [{ role: 'Security', n: 0, t: 'Passed · no findings', findings: [] }, { role: 'Design', n: 1, t: '1 finding', findings: ['The trail wraps to two lines at 375px'] }, { role: 'Backend', n: 1, t: '1 finding', findings: ['Group pages keep an unused Back handler'] }],
    // A perspective's checklist, one review cycle each: what is not met stays open, with its evidence.
    checklist: { cycle: 3, met: ['Every route has a parent', 'The bar holds one primary', 'Saved runs fall back to Runs', 'Tests cover every page type'], unmet: [['Phone layout checked at 375px', 'The manual test ran at 390px only']], earlier: [['Cycle 2', '3 of 5 met'], ['Cycle 1', '2 of 5 met']] },
    skills: ['frontend-design', 'testing', 'worca-pr-flow'],
    memory: ['Added: the breadcrumb takes its parent from the route', 'Changed: phones under 600px show ‹ Parent'],
    worktree: '~/.worca-cc/worktrees/run-7b0bfb1e',
    services: [{ id: 'web', name: 'Web server', port: 3000 }, { id: 'api', name: 'API server', port: 8080 }],
    builtins: ['Install dependencies', 'Run the tests'],
    members: [{ name: 'worca-api', files: 12 }, { name: 'worca-docs', files: 3 }],
    noChangeMembers: ['worca-web'],
    comments: { 'ui/public/run-head.mjs': [{ line: 'el.append(breadcrumb(ROUTES.parentOf(run)));', who: 'Review implementation', t: 'parentOf can be null on a saved run' }, { line: 'el.append(titleRow(run), actions(run));', who: 'Review implementation', t: 'One primary only in actions' }], 'ui/public/nav/routes.mjs': [{ line: 'el.append(groupList(run));', who: 'Review implementation', t: 'Group list moves to the trail' }] },
    tunables: [['Review cycles', '3', 'How many times Review may send it back'], ['Cost cap', '$120', 'Pauses the run here'], ['Step time limit', '1h', 'Pauses a step that runs longer'], ['Model for Build', 'Opus 5.5', 'From the task’s size']],
    autoWhy: 'A medium change in two areas, with UI: Worca adds a plan review and a manual test, and leaves out the security review.',
    costOther: [['Away mode', '$0.32'], ['Auto workflow', '$0.12'], ['Run title', '$0.01']],
    costApart: [['Stopped reviews', 'at least $0.20'], ['Stopped agent turns', 'at least $1.10']],
    docBody: { 'plan.md': '## The plan\n- Add ROUTES.parentOf for run, group and slice pages\n- Build the breadcrumb from the parent chain\n- Move Back, Pause and Stop into the top bar\n- One title row: title, kind chip, actions\n- Phone: ‹ Parent under 760px\n- Tests for every page type', 'review-3.md': '## Review, round 3\nPassed. One minor note: the trail wraps at 375px.', 'checklist.md': '## Manual tests\n- Run page at 375px\n- Group page at 900px\n- Saved run with no live parent' },
  };
  // What a failed or blocked step shows in Activity: what broke, the last lines, and where in the log.
  const EVIDENCE = {
    'build/Implementation': { title: '3 tests failed in test/ui-run-head.test.mjs', log: 'Open log at line 1,284',
      lines: ['\u2716 breadcrumb hides under 600px (12ms)', '  AssertionError: expected [ \'Back\' ] to equal [ \'Back\', \'Runs\' ]', '\u2716 group page Back goes to Runs (4ms)', '\u2716 bar keeps one primary (3ms)'] },
    'pr/Checks': { title: '2 checks failed: unit, e2e', log: 'Open the failing check',
      lines: ['unit \u2716 test/ui-run-head.test.mjs \u203a bar keeps one primary', 'e2e  \u2716 run page at 375px: breadcrumb overflows by 18px'] },
    'review/Manual web UI testing': { title: 'The end-of-run commit failed', log: 'Open the hook output',
      lines: ['pre-commit: eslint ui/public/run-head.mjs', '  41:7  error  \'crumbs\' is assigned but never used', 'hook exited 1 · nothing committed; the work is kept in a copy'] },
    'pr/Up to date with dev': { title: 'Conflicts in 2 files', log: 'Open the conflicts',
      lines: ['ui/public/app.js  lines 36,380\u201336,412', 'ui/public/style.css  lines 5,210\u20135,214'] },
  };
  const NO_DIFF = { scheduled: 1, starting: 1, clarify: 1, plan: 1, outline: 1, noproject: 1, copying: 1, requirements: 1, auto: 1, 'ticket-missed': 1, 'ticket-firing': 1, 'ticket-failed': 1, 'ticket-canceled': 1, 'ticket-skipped': 1 };
  const money = (v) => parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0;

  // A form behind a step: its words and its one field or choice (docs/rail/forms.md).
  const FORMS = {
    model: { title: 'Switch model', yes: 'Resume', text: 'Every remaining step runs on the model you pick; the run resumes from Implementation.', options: ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5'], pick: 1 },
    'resume-at': { title: 'Resume at a time', yes: 'Schedule the resume', text: 'The run stays paused until then, and you can cancel it.', field: { label: 'Time', value: '15:30', hint: 'Today, in your time zone' } },
    cap: { title: 'Raise the cap', yes: 'Raise it and go on', text: 'A new cost cap for this run; it goes on from Manual tests checklist.', field: { label: 'New cap', value: '$180', hint: 'It is at $120' } },
    'team-cap': { title: 'Continue past team cap', yes: 'Continue past the cap', text: 'Your team’s cap is $200 a run. Going past it is recorded with your reason.', field: { label: 'Reason', value: '', hint: 'Your team’s policy asks for one', required: true } },
    preset: { title: 'Save as preset', yes: 'Save preset', text: 'The next run can start from this run’s setup: its workflow, models and budget.', field: { label: 'Name', value: 'Unified page navigation', required: true } },
  };

  const INSTANCE_HELP = { 'worca-api #212': 'Merged into main', 'worca-web #88': 'Checks running', 'worca-docs #31': 'Conflicts with main' };
  const HELP_OF = (t, ctx) => INSTANCE_HELP[t] || R.actionHelp(t, ctx || CTX);

  // Actions this design proposes that today's app does not have (parity audit, 26 Oct): listed with why in the
  // prototype's intro, never marked on the buttons themselves.
  const PROPOSED = [
    ['Send answer', 'A question is answered under its step in the card; today the answer panel sits apart, above the steps.'],
    ['Pause after this step', 'Lets the current step finish before pausing; today Pause stops at once.'],
    ['Fix checks', 'Starts a short run that fixes failing checks, like Fix conflicts does today for conflicts.'],
    ['Re-run checks', 'Runs a PR\'s checks again from Worca; today that is on GitHub.'],
    ['Merge PR', 'Merges from Worca, one PR at a time in stack order, and moves the next PR onto dev; today you merge on GitHub and nothing moves the next PR.'],
    ['Restart Build', 'Runs one stage again with what earlier stages made; today a failed run resumes or starts over.'],
    ['Raise the cap', 'Sets a new cost cap and goes on; today the choices are Continue without cap or Settings.'],
    ['Copy link', 'Copies a link to the run from ⋯, for Chat or an issue.'],
  ];
  const NEW = new Set(['Merge PR', 'Merge #959', 'Fix checks', 'Re-run checks', 'Fix checks on #961', 'Restart Build', 'Raise the cap', 'Pause after this step', 'Send answer', 'Copy link']);
  const { isDone, stageState, fmtMin, toMin, stageMeta, STAGE_WORD } = R;
  const defaultStage = (c) => R.defaultStage(c.stages, c.stack ? c.stack.mode : '');
  const rowOf = R.stepLook;
  const LIVE = { now: 1, ask: 1, problem: 1, failed: 1, paused: 1, review: 1 };
  // A run inside a group is one record seen from two pages: the group's segment for it and its own page read the same
  // stages, time and cost. On its own page it ships with the group, so its PR stages become one Ship stage (a feature)
  // or stay its PR (a chain), and only fix-it actions stay; creating and merging PRs is the group page's job.
  const SHIP = /^(pr|merged|push|apply|done|ship)$/;
    const BRANCH = 'feat/unified-page-navigation-one-head-breadcrumb';
  function asMember(c0, g, i) {
    const chain = g.kind === 'Chain'; const groupWord = g.kind.toLowerCase(); const titles = g.runTitles || RUNS;
    let stages = chain ? c0.stages : c0.stages.filter((x) => !SHIP.test(x.key))
      .concat({ key: 'ship', label: 'Ship', subs: [next('With the ' + groupWord, { live: c0.shipLive || 'From the ' + groupWord + ' page, with the other runs' })] });
    // What gets the run moving stays on its page; what ships it is the group's, also in its ▾.
    const keep = c0.action && R.memberKeeps(c0.action.label);
    const kept = keep ? Object.assign({}, c0.action, { items: c0.action.items.filter(R.memberKeeps) }) : null;
    const k = SLICE[i] || 0.3;
    const scaled = (c0.stages).map((st) => Object.assign({}, st, { subs: st.subs.map((x) => (x.time ? Object.assign({}, x, { time: fmtMin(toMin(x.time) * k) }) : x)) }));
    stages = chain ? scaled : scaled.filter((x) => !SHIP.test(x.key)).concat(stages.slice(-1));
    return Object.assign({}, c0, { stages, scale: k, title: titles[i], kind: '', branch: BRANCH + '-' + (i + 1), diff: ((g.stack && g.stack.sizes) || SIZES)[i],
      action: kept, detail: c0.detail || (keep ? '' : chain ? 'Merges in order, from the chain' : c0.word === 'Ready' ? 'Ships with the ' + groupWord : ''),
      pr: chain && g.runPRs ? g.runPRs[i] : '', base: chain && g.runPRs ? (i ? g.runPRs[i - 1] : 'dev') : '', group: g, index: i });
  }
  // A member's case: the group's own, unless something done on the member's page moved it on (ui.over).
    const memberCase = (g, i, ui) => ((ui && ui.over) || {})[g.id + ':' + i] || (g.runCases || [])[i] || '';
    const memberOf = (g, i, ui) => { const id = memberCase(g, i, ui); return id ? asMember(CASES.find((x) => x.id === id), g, i) : null; };
  const subState = (st) => R.subState(st.subs);
  // A group's run segment: one cell per stage of that run, read from the run itself when it has a page.
  function resolve(c, ui) {
    if (!c.runCases) return c;
    const titles = c.runTitles || null;
    return Object.assign({}, c, { stages: c.stages.filter((st) => !(ui && ui.restGone && st.run && !memberCase(c, +st.key.slice(3) - 1, ui))).map((st) => {
      if (!st.run) return st;
      const m = memberOf(c, +st.key.slice(3) - 1, ui);
      if (!m) return titles ? Object.assign({}, st, { title: titles[+st.key.slice(3) - 1] }) : st;
      return Object.assign({}, st, { member: m, subs: m.stages.filter((x) => !SHIP.test(x.key)).map((x) => {
        const lv = x.subs.find((y) => LIVE[y.state]);
        return s(x.label, subState(x), stageMeta(x), { live: lv ? lv.live : '', when: lv ? lv.when : '' });
      }) });
    }) });
  }
  // Time is the sum of every step; cost is every step's price, plus each run's own total on a group page.
  function totals(c) {
    const mins = c.stages.reduce((a, x) => a + x.subs.reduce((b, y) => b + (y.time ? toMin(y.time) : 0), 0), 0);
    const cost = c.stages.reduce((a, x) => a + (x.run ? (x.member ? totals(resolve(x.member)).cost : 0)
      : x.subs.reduce((b, y) => b + (y.state === 'next' ? 0 : money(COST_OF[y.name] || 0)), 0) * (c.scale || 1)), 0);
    return { mins, cost };
  }
  // Overview reports by exception: it leads with what this state needs from you (an answer, a plan to approve, what
  // broke, or what to check); a running run shows its plan's progress. What went fine is one line each once it is
  // built: the ask, and the evidence (left out when the focus is what broke: that is the evidence). Files and documents
  // are Changes'.
  function overview(c, live, ui) {
    const built = c.stages.some((x) => x.key === 'build' && x.subs.some(isDone));
    const planDone = c.stages.some((x) => x.key === 'plan' && x.subs.every(isDone));
    const buildLive = c.stages.some((x) => x.key === 'build' && x.subs.some((y) => LIVE[y.state]));
    const ev = c.ev ? c.ev : c.id === 'kept' ? EVIDENCE['review/Manual web UI testing'] : c.id === 'failed' ? EVIDENCE['build/Implementation'] : c.id === 'failing' ? EVIDENCE['pr/Checks'] : /^(conflicts|workspace)$/.test(c.id) ? EVIDENCE['pr/Up to date with dev'] : null;
    let focus = null;
    if (c.id === 'plan') focus = { kind: 'plan', items: DETAIL.plan.map((t) => ({ t, state: 'next' })), issues: ui && ui.fixed && ui.fixed.plan ? [] : DETAIL.planIssues };
    else if (c.reqsCheck) focus = { kind: 'reqs', items: DETAIL.criteria, left: reqLeft(ui) };
    else if (c.id === 'requirements') focus = { kind: 'criteria', items: DETAIL.criteria };
    else if (c.id === 'gate') focus = { kind: 'findings', title: 'What Review still holds open', issues: DETAIL.issues, roles: DETAIL.roles };
    else if (c.issues) focus = { kind: 'findings', title: '2 open issues', note: 'A review ran out of cycles with these open, and the run went on past them', issues: DETAIL.issues, roles: DETAIL.roles };
    else if (ev) focus = { kind: 'broke', ev, next: c.action ? c.action.label : '' };
    else if (planDone && !c.runCases && (buildLive || c.stages.some((x) => x.key === 'review' && x.subs.some((y) => LIVE[y.state])))) {
      const doneN = buildLive ? 3 : DETAIL.plan.length;
      focus = { kind: 'progress', note: buildLive ? doneN + ' of ' + DETAIL.plan.length + ' built' : 'all ' + DETAIL.plan.length + ' built · now in Review', items: DETAIL.plan.map((t, i) => ({ t, state: i < doneN ? 'done' : i === doneN ? 'now' : 'next' })) };
    } else if (built && !c.runCases && !/^(Failed|Merged|Archived|Discarded|Applied|Stopped|Finished)$/.test(c.word)) focus = { kind: 'check', items: DETAIL.check, title: prOpen(c) ? 'Before you merge' : 'Before you ship' };
    const areas = {};
    if (built && !NO_DIFF[c.id] && !c.noDiff) DETAIL.files.forEach(([f, a, d]) => { const k = f.slice(0, f.lastIndexOf('/') + 1); const x = areas[k] || (areas[k] = { dir: k, n: 0, add: 0, del: 0 }); x.n++; x.add += a; x.del += d; });
    const max = Math.max(1, ...Object.values(areas).map((x) => x.add + x.del));
    const rounds = DETAIL.rounds['Review implementation'].length;
    const done = built && !live;
    return { focus, checklist: c.shaped || c.id === 'gate' ? DETAIL.checklist : null, outcome: done ? DETAIL.outcome : [], task: DETAIL.task,   // what it did, once it is done
      ask: done ? { parts: DETAIL.ask, unasked: DETAIL.unasked } : null,
      evidence: done && (!focus || focus.kind !== 'broke') ? `Tests pass · Review passed on round ${rounds} · Manual test passed` : '',
      areas: Object.values(areas).map((x) => Object.assign(x, { pct: Math.round(((x.add + x.del) / max) * 100) })),
      artifacts: planDone || built ? DETAIL.artifacts : DETAIL.artifacts.slice(0, 0) };
  }
  // A feature reads from the run that holds it up: failed first, then one that asks, one paused, one stopped.
  const HOLD = [['Failed', 'group-failed', (k, n) => 'Run ' + k + ' of ' + n + ' · failed'], [R.runState('group-needs').word, 'group-needs', (k, n) => 'Run ' + k + ' of ' + n + ' · needs you'],
    ['Paused', 'group-paused', (k, n, m) => 'Run ' + k + ' of ' + n + ' · ' + ((m.detail || 'paused').split(' · ')[0].toLowerCase())], ['Stopped', 'group-stopped', (k) => 'Stopped at run ' + k]];
  function groupHold(c) {
    if (!c.follows) return null;
    const runs = c.stages.filter((x) => x.run);
    for (const [word, state, line] of HOLD) {
      const i = runs.findIndex((x) => x.member && x.member.word === word);
      if (i >= 0) return { state, k: i + 1, detail: line(i + 1, runs.length, runs[i].member) };
    }
    return null;
  }
  // The requirements a person still has to mark before anything ships; Not met and Dropped count once they say why.
  const reqLeft = (ui) => DETAIL.criteria.filter(([id]) => { const m = ((ui && ui.marks) || {})[id]; return !m || (m !== 'met' && !(((ui && ui.markText) || {})[id] || '').trim()); }).length;
  // A case's log, read from its steps: a line when it started, what its agent did, each round again, and what went wrong.
  function logsOf(c) {
    const out = []; let m = 31;
    const stamp = () => { m += 1; return '08:' + String(m % 60).padStart(2, '0') + ':' + String((m * 7) % 60).padStart(2, '0'); };
    c.stages.forEach((st) => st.subs.forEach((y) => {
      if (y.state === 'next') return;
      const step = st.run ? st.label + ' · ' + y.name : y.name; const model = MODEL_OF[y.name] || 'Sonnet 5.5'; const session = 's-' + String(step.length % 3 + 1);
      const push = (from, lvl, cycle, sum, raw) => out.push({ t: stamp(), step, from, lvl, cycle, session, sum, raw });
      push('worca', 'info', 1, 'Started ' + y.name, '[orchestrator] node="' + y.name + '" status=start model="' + model + '"');
      push('agent', 'info', 1, 'Read 12 files, edited 3', '[agent] Read(ui/public/run-head.mjs) · Read(ui/public/app.js) · Edit(ui/public/style.css)');
      push('tool', 'info', 1, 'Ran the tests: 214 passed', '[bash] node --test test/ui-run-head.test.mjs → 214 pass, 0 fail');
      for (let i = 2; i <= (y.loops || 0); i++) push('worca', 'warn', i, 'Round ' + i + ': sent back', '[orchestrator] node="' + y.name + '" cycle=' + i + ' reason="review sent it back"');
      if (y.state === 'problem' || y.state === 'failed') push('agent', 'error', y.loops || 1, y.live || 'It did not pass', '[agent] error: ' + (y.live || 'step failed'));
      else if (y.live && y.state !== 'done') push('agent', 'info', y.loops || 1, y.live, '[agent] ' + y.live);
    }));
    return out;
  }
  // Who did the work, read from the same steps.
  function agentsOf(c) {
    const rows = [];
    c.stages.forEach((st) => st.subs.forEach((y) => { if (y.state === 'next' || st.run) return;
      rows.push({ name: y.name, type: /review/i.test(y.name) ? 'Reviewer' : /plan/i.test(y.name) ? 'Planner' : 'Builder', model: MODEL_OF[y.name] || 'Sonnet 5.5', cycle: String(y.loops || 1), tokens: Math.round(money(COST_OF[y.name] || '$0.40') * 41) + 'k', skills: /Impl/.test(y.name) ? '3' : '0', graph: /Impl|Plan/.test(y.name) ? '12' : '0' }); }));
    return rows.concat([{ name: 'Away mode answers', type: 'Worca', model: 'Sonnet 5.5', cycle: '1', tokens: '4k', skills: '0', graph: '0' }, { name: 'Run title', type: 'Worca', model: 'Haiku 5.5', cycle: '1', tokens: '1k', skills: '0', graph: '0' }]);
  }
  function sessionsOf(c) {
    return c.stages.flatMap((st) => st.subs.filter((y) => y.state !== 'next' && !st.run).map((y) => { const k = money(COST_OF[y.name] || '$0.40'); return { name: y.name, id: 'sess_' + y.name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 8), turns: String(Math.max(2, Math.round(k * 3))), in: Math.round(k * 22) + 'k', out: Math.round(k * 6) + 'k', cache: Math.round(k * 80) + 'k', cost: COST_OF[y.name] || '$0.40' }; }));
  }
  function usageOf(c) {
    return c.stages.flatMap((st) => st.subs.filter((y) => y.state !== 'next' && !st.run).map((y) => { const k = money(COST_OF[y.name] || '$0.40'); return { name: y.name, peak: Math.min(92, Math.round(20 + k * 3)) + '%', cache: Math.min(96, Math.round(50 + k * 2)) + '%', calls: String(Math.round(k * 9) + 1), retries: String(y.loops ? y.loops - 1 : 0), compact: String(k > 15 ? 1 : 0), errors: String(y.state === 'failed' || y.state === 'problem' ? 2 : 0), model: MODEL_OF[y.name] || 'Sonnet 5.5', time: y.time || '—' }; }));
  }
  // The graph is the steps again, drawn at full size; a proposal draws what it would run.
  function graphOf(c, ui) {
    const stages = c.stages.map((st) => ({ label: st.label + (st.title ? ' · ' + st.title : ''), nodes: st.subs.map((y) => ({ key: st.key + '/' + y.name, name: y.name, state: y.state, loops: y.loops || 0, gate: /review|Approval/i.test(y.name), meta: y.time || '', selected: ui && ui.graphNode === st.key + '/' + y.name })) }));
    const live = c.stages.some((st) => st.subs.some((y) => LIVE[y.state]));
    return { stages, end: live ? '' : 'End · ' + c.word };
  }
  function prOpen(c) { return c.stages.some((x) => x.key === 'pr' && x.subs[0] && x.subs[0].name === 'Create PR' && isDone(x.subs[0])); }

  // ui: { open: stage key | null, chips: [{kind, text}], ship: 'stack' | 'one', parent: { caseId, index } }
  function view(caseId, ui) {
    ui = ui || {};
    const c0 = CASES.find((x) => x.id === caseId) || CASES[1];
    const par = ui.parent || c0.parent || null;
    const g = par ? CASES.find((x) => x.id === par.caseId) : null;
    let c = resolve(g ? asMember(c0, g, par.index) : c0, ui);
    // A group held up by one of its runs reads from that run, and says which.
    const hold = groupHold(c);
    let stateId = c.state || c.id;
    if (hold) { const h = R.runState(hold.state, Object.assign({}, ctxOf(c), { k: hold.k })); stateId = hold.state; c = Object.assign({}, c, { word: h.word, dot: h.dot, sym: h.sym, action: h.action, detail: hold.detail, k: hold.k }); }
    if (c.shipWaiting) c = Object.assign({}, c, { stages: c.stages.map((st) => (st.key === 'pr' ? Object.assign({}, st, { subs: st.subs.map((x) => Object.assign({}, x, { live: c.shipWaiting })) }) : st)) });
    if (c.id === 'plan' && ui.fixed && ui.fixed.plan) c = Object.assign({}, c, { stages: c.stages.map((st) => Object.assign({}, st, { subs: st.subs.map((x) => (x.live ? Object.assign({}, x, { live: x.live.replace('2 open issues', 'issues fixed') }) : x)) })) });
    const outlineN = c.stack && c.stack.mode === 'outline' ? (ui.outline || RUNS).length : 0;
    const left = c.reqsCheck ? reqLeft(ui) : 0;
    if (c.reqsCheck && left) c = Object.assign({}, c, { detail: 'Mark every requirement before you create the PR · ' + left + ' left' });
    const liveCtx = Object.assign({}, ctxOf(c), outlineN ? { n: outlineN } : {}, c.k ? { k: c.k } : {});
    const chainSt = ui.stackSt || CHAIN_START;
    if (c.id === 'chain') c = chainLive(c, chainSt);
    const now = c.openStage || defaultStage(c);
    const open = ui.open && c.stages.some((st) => st.key === ui.open) ? ui.open : now;
    const st = c.stages.find((x) => x.key === open);
    let stack = null;
    // Stacked or one PR: Worca recommends one and says why; the choice itself is the action's ▾ and the Create PR
    // dialog, never a form in the card.
    const sh = c.stack && c.stack.mode === 'create' ? c.stack : null;
    const pick = sh ? (ui.ship && !(ui.ship === 'one' && sh.oneBlocked) ? ui.ship : sh.rec) : '';
    const shipWord = (id) => (id === 'one' ? 'one PR' : sh.runs.length + ' stacked PRs');
    if (c.stack && (open === 'pr' || (c.stack.mode === 'outline' && open === 'plan'))) {
      const src = c.stack.mode === 'review' ? reviewOf(chainSt) : STACKS[c.stack.mode](ui.outline || RUNS);
      let rows = src.rows || [];
      let choice = null;
      if (src.choice) {
        const n = sh.runs.length;
        rows = pick === 'one'
          ? [{ num: 'One PR', title: 'All ' + n + ' runs, one branch', state: 'next', word: 'Not opened', sub: 'Into dev' }]
          : sh.runs.map((t, i) => ({ num: 'PR ' + (i + 1), title: t, state: 'next', word: 'Not opened', sub: (i ? 'Into PR ' + i + '’s branch' : 'Into dev') + (sh.sizes ? ' · ' + sh.sizes[i] : '') }));
        choice = { note: (pick === sh.rec ? 'Worca suggests ' + shipWord(sh.rec) : 'You picked ' + shipWord(pick) + '; Worca suggests ' + shipWord(sh.rec)) + ': ' + sh.reason };
      }
      rows = rows.map((r) => Object.assign(rowOf({ state: r.state }), r, { rowCls: 'is-' + r.state + (r.isNext ? ' is-next-up' : ''), total: rows.length }));
      stack = { title: sh ? (pick === 'one' ? 'What it opens: one PR' : 'What it opens: ' + sh.runs.length + ' stacked PRs') : src.title, note: choice ? choice.note : src.note || '', choice: null, rows };
    }
    let action = null;
    const ENDED = /^(Failed|Waiting|Stopped|Discarded|Archived)$/;   // a run in one of these has nothing to pause or stop
    const liveNow = !ENDED.test(c.word) && !c.over && !c.stages.filter((x) => !SHIP.test(x.key)).every((x) => x.subs.every(isDone));
    if (!c.action && liveNow && c.word !== 'Paused') c = Object.assign({}, c, { action: A('Pause', 'pause', false, ['Pause after this step']) });
    if (c.action) {
      const label = sh ? (pick === 'one' ? 'Create PR' : 'Create ' + sh.runs.length + ' PRs') : outlineN ? 'Approve ' + outlineN + ' runs' : c.action.label;
      const liveRun = c.stages.filter((x) => x.run).findIndex((x) => stageState(x.subs) === 'live');
      const offs = Object.assign({}, c.action.off || {});
      if (c.reqsCheck && left) offs[label] = 'Mark every requirement before you create the PR · ' + left + ' left';
      const alt = sh ? [pick === 'one' ? 'Create ' + sh.runs.length + ' stacked PRs instead' : 'Create one PR instead'] : [];
      const rest = liveNow && c.stages.some((x) => x.run) && c.stages.some((x) => x.run && x.subs.every((y) => y.state === 'next'));
      const stopWord = c.stages.some((x) => x.run) && liveRun >= 0 ? 'Stop run ' + (liveRun + 1) : 'Stop the run';
      const items = alt.concat(c.action.items.filter((t) => !/^Create (PR|\d+ PRs)$/.test(t) && R.shows(R.actionLevel(t)))).concat(liveNow && !c.action.items.includes('Stop') && !c.action.items.includes('Abort') ? [stopWord] : []).concat(rest && !c.action.items.includes('Re-plan the rest') ? ['Re-plan the rest'] : []).concat(rest && !c.action.items.includes('Cancel the rest') ? ['Cancel the rest'] : []);
      const helpOf = (t) => offs[t] || HELP_OF(t, liveCtx) || (/^Merge #(\d+)$/.test(t) ? 'Merges ' + t.slice(6) + ' into dev; Worca then moves the next PR onto dev' : /^Fix checks on #/.test(t) ? 'Starts a short run that fixes ' + t.slice(14) + '’s failing checks' : '');
      action = Object.assign({}, c.action, { label, isNew: NEW.has(label), help: helpOf(label), items: items.map((t) => ({ text: t, isNew: NEW.has(t), help: sh && / instead$/.test(t) ? (/one PR/.test(t) && sh.oneBlocked ? 'Not possible: ' + sh.oneBlocked.replace(/^Not possible: /, '') : sh.reason) : helpOf(t), off: !!offs[t] || (/one PR instead/.test(t) && sh && !!sh.oneBlocked), checked: t === 'Watch' ? !!ui.watched : undefined })), offWhy: offs[label] || '' });
    }
    // The run is live while any work stage (everything before shipping) is unfinished and it has not failed;
    // waiting on CI, reviewers or a merge is the PR's business, not the run's, so Pause and Stop go. A run waiting on
    // your answer has nothing to pause.
    const work = c.stages.filter((x) => !SHIP.test(x.key));
    const live = !ENDED.test(c.word) && !c.over && !work.every((x) => x.subs.every(isDone));
    const t = totals(c);
    const runStages = c.stages.filter((x) => x.run);
    const budget = DETAIL.budget * Math.max(1, runStages.length);
    // Where you are: Runs › the place (project, folder or workspace) › the group. The page itself is never a crumb.
    const place = c.folder ? c.folder.split('/').pop() : c.project === '' ? '' : c.project || 'worka-cc';
    const crumbs = [{ t: 'Runs' }].concat(place ? [{ t: place }] : [])
      .concat(g ? [{ t: g.title, go: { caseId: g.id, open: 'run' + (par.index + 1) } }] : [])
      .concat((ui.chips || []).filter((x) => x.kind === 'group').map((x) => ({ t: x.text, group: true })));   // a group added with +
    const sibling = (j) => (g && g.stages.some((x) => x.key === 'run' + (j + 1)) ? { index: j, ok: !!(g.runCases || [])[j] } : null);
    const branch = c.branch === undefined ? BRANCH : c.branch;
    return {
      bar: { pause: live && c.word !== 'Paused' && c.sym !== 'q', stop: live, more: true, scope: runStages.length ? c.kind.toLowerCase() : '' },
      id: c.id, title: TITLES[c.id] || c.title || 'Unified page navigation: one head, breadcrumb in the top',
      kind: runStages.length && c.kind ? c.kind : '',   // the stepper already counts the runs
      crumbs, pager: g ? { index: par.index, n: g.stages.filter((x) => x.run).length, prev: sibling(par.index - 1), next: sibling(par.index + 1), group: g.id } : null,
      // The place line: where the code lives and where it goes, the PR once it exists. Each part once on the page.
      place: { branch, copy: !!branch && branch !== 'main', base: c.base || (c.onSource ? 'origin' : branch === 'main' ? 'origin/main' : branch ? 'dev' : ''), onSource: !!c.onSource, hidden: c.hidden || '',
        pr: c.pr !== undefined && c.pr !== '' ? c.pr : prOpen(c) ? '#959' : '', folder: c.folder || '', repos: c.repos || [],
        merged: c.stages.some((x) => x.key === 'merged' && x.subs.length && x.subs.every((y) => y.state === 'merged')), applied: c.word === 'Applied' },
      chips: (ui.chips || []).filter((x) => x.kind !== 'group'), inGroup: !!g || runStages.length > 0, addedGroup: ((ui.chips || []).find((x) => x.kind === 'group') || {}).text || '',
      word: c.word, dot: c.dot || '', sym: c.sym || '', detail: c.detail || '', action, archived: !!c.archived,
      finished: !live && !/^(Waiting)$/.test(c.word),
      // Run after, as today: on any run with a project that is not archived or a group; its words follow the state.
      runAfter: c.archived || runStages.length || !place ? null : !live && !/^(Waiting)$/.test(c.word)
        ? { short: 'Run after', label: 'Start a follow-up run', help: 'A new run that builds on this one' }
        : { short: 'Run after', label: 'Schedule a run after this', help: 'A run that starts when this one finishes' },
      stages: c.stages.map((x) => ({ key: x.key, label: x.label, meta: stageMeta(x), selected: x.key === open, live: stageState(x.subs) === 'live',
        aria: [x.label, STAGE_WORD[stageState(x.subs)], stageMeta(x)].filter(Boolean).join(', '),
        cells: x.subs.map((y) => 'is-' + y.state) })),
      open: (() => {
        const rows = stack ? [] : st.subs.map((x, i) => Object.assign(rowOf(x, st.subs[i + 1]), { ref: st.run ? '' : st.key + '/' + x.name }));
        if (!st.run) return { key: open, label: st.label, title: st.title || '', isRun: false, rows, stack };
        // A run inside a group: its stages, its PR once it has one, its cost, and a way in.
        const i = +st.key.slice(3) - 1;
        if (c.stack && c.stack.mode === 'review') {
          const pr = reviewOf(chainSt).rows[i];
          rows.push(Object.assign(rowOf({ state: pr.state }), { name: pr.num, live: [pr.word, pr.sub].filter(Boolean).join(' · ') }));
        }
        return { key: open, label: st.label, title: st.title || '', isRun: true, rows, stack,
          meta: st.member ? '$' + totals(resolve(st.member)).cost.toFixed(2) : '', runIndex: i, canOpen: !!st.member };
      })(),
      // The group's runs, each read from the run itself: the Runs tab, the pager and Open all agree with its page.
      runs: runStages.map((x, i) => {
        const m = x.member;
        return { n: i + 1, title: x.title, word: m ? m.word : 'Waiting', dot: m ? (m.sym === 'q' ? 'is-amber' : m.sym ? 'is-red' : m.dot) : 'is-grey-ring',
          time: stageMeta(x), cost: m ? '$' + totals(resolve(m)).cost.toFixed(2) : '', pr: (c.runPRs || [])[i] || '', canOpen: !!m };
      }),
      figs: c.figs.filter(([k]) => k !== 'Rate').map(([k, v]) => {
        if (k === 'Time') return { k, v: t.mins ? fmtMin(t.mins) : v, title: 'Started 25 Oct, 08:31' };
        if (k !== 'Cost') return { k, v };
        const cost = t.cost ? '$' + t.cost.toFixed(2) : v;
        const pct = Math.round((money(cost) / budget) * 100);
        return { k, v: cost, of: 'of $' + budget, warn: pct >= 80, title: pct + '% of the ' + (runStages.length ? c.kind.toLowerCase() : 'run') + '’s budget' };
      }).concat(NO_DIFF[c.id] || c.noDiff ? [] : [{ k: 'Changes', v: c.diff || '+358 −144', tab: (c.tabs || RUN_TABS).some((x) => x[0] === 'changes') ? 'changes' : '' }]),   // links only where a Changes tab exists
      tabs: (c.tabs || RUN_TABS).map(([id, l], i, all) => ({ id, l, n: id === 'runs' ? String(runStages.length) : id === 'changes' ? String(DETAIL.files.length) + (overview(c, live, ui).artifacts.length ? ' · ' + overview(c, live, ui).artifacts.length + ' docs' : '') : id === 'decisions' ? String(DETAIL.decisions.length) : '',
        sel: id === (all.some((x) => x[0] === ui.tab) ? ui.tab : all[0][0]) })),
      activity: c.stages.map((x) => {
        const cost = x.run ? (x.member ? totals(resolve(x.member)).cost : 0) : x.subs.reduce((a, y) => a + (y.state === 'next' ? 0 : money(COST_OF[y.name] || 0)), 0) * (c.scale || 1);
        return { key: x.key, label: x.label, title: x.title || '', meta: cost ? '$' + cost.toFixed(2) : '',
          rows: x.subs.map((y, i) => Object.assign(rowOf(y, x.subs[i + 1]), { model: x.run ? '' : MODEL_OF[y.name] || '',
            cost: x.run || y.state === 'next' || !COST_OF[y.name] ? '' : '$' + (money(COST_OF[y.name]) * (c.scale || 1)).toFixed(2) + (/^(now|ask|paused)$/.test(y.state) ? ' so far' : ''),
            evidence: /^(failed|problem)$/.test(y.state) ? EVIDENCE[x.key + '/' + y.name] || null : null,
            focus: ui.focus === x.key + '/' + y.name, ref: x.key + '/' + y.name })) };
      }),
      tryIt: (() => {
        if (g) return 'Copied: git switch ' + BRANCH + '-' + (par.index + 1) + (par.index ? ' · runs 1\u2013' + (par.index + 1) + ' together' : ' · run 1 alone');
        if (runStages.length) return pick === 'one' ? 'Copied: git switch ' + BRANCH + ' · all ' + runStages.length + ' runs on one branch'
          : 'Copied: git switch ' + BRANCH + '-' + runStages.length + ' · the top of the stack holds all ' + runStages.length + ' runs';
        return branch ? 'Copied: git switch ' + branch : 'Opened the copy in a terminal';
      })(),
      ship: sh ? { pick, rec: sh.rec, n: sh.runs.length, reason: sh.reason, oneBlocked: sh.oneBlocked || '', sizes: sh.sizes || [] } : null,
      // A group's next run, under the run it follows: whether it starts by itself or asks first is set right there.
      then: c.independent || hold ? null : (() => { const k = runStages.findIndex((x) => stageState(x.subs) === 'live'); const nx = k >= 0 && runStages[k + 1]; return nx && nx.subs.every((y) => y.state === 'next') && open === runStages[k].key ? { n: k + 2, title: nx.title } : null; })(),
      planHead: runStages.length > 0 && open === 'plan',
      runCases: c.runCases || [], parent: par, over: overview(c, live, ui), ask: DETAIL.asks[c.id] || null, under: /^(gate|plan|outline)$/.test(c.id) ? { issues: c.id === 'gate' ? DETAIL.issues : [], roles: DETAIL.roles } : null,
      flow: flowOf(c, stateId, liveCtx), state: stateId, event: EVENT_OF(c, stateId, liveCtx),
      hasSetup: !c.noSetup && !runStages.length, dependents: c.dependents || 0, heldBy: c.heldBy || '', hosted: !!c.hosted, baseMoved: !!c.baseMoved, independent: !!c.independent, reqsLeft: left, reqsCheck: !!c.reqsCheck, holdIndex: c.k ? c.k - 1 : -1,
      logs: logsOf(c), agents: agentsOf(c), sessions: sessionsOf(c), usage: usageOf(c), graph: graphOf(c, ui), agentsUnknown: !!c.agentsUnknown, isWorkspace: !!(c.repos && c.repos.length), docsHere: !(c.tabs || RUN_TABS).some((x) => x[0] === 'changes'), outlineN, outlineRuns: ui.outline || RUNS, rounds: DETAIL.rounds,
      tabData: DETAIL,
    };
  }

  // An action either moves the run to another state (`to`) or does its job where it is and says so (`say`); `confirm`
  // asks first; events from outside (checks finish, a reviewer approves) are `next`. The table is the library's.
  const INSTANCE_FLOW = { workspace: { 'worca-api #212': { say: 'Opens worca-api #212' }, 'worca-web #88': { say: 'Opens worca-web #88' }, 'worca-docs #31': { say: 'Opens worca-docs #31' } } };
  function flowOf(c, stateId, ctx) { return Object.assign(R.actionFlow(stateId, ctx), INSTANCE_FLOW[c.id] || {}, c.flow || {}); }
  function EVENT_OF(c, stateId, ctx) { return flowOf(c, stateId, ctx).event || ''; }
  const FLOW = Object.fromEntries(CASES.map((c) => [c.id, flowOf(c, c.state || c.id, ctxOf(c))]));
  const RUN_FLOW = R.runFlow();

  // The + menu: what each kind is for, a placeholder for typing one, and the existing values to pick from.
  const ADD = [{ kind: 'label', menu: 'Label', help: 'Find and filter runs by it in the Runs list', placeholder: 'Type or pick a label', suggest: ['ui', 'hotfix', 'needs demo'] },
    { kind: 'tag', menu: 'Cost tag', help: 'Splits this run’s cost in Statistics', placeholder: 'key: value', suggest: ['team: web', 'team: api', 'client: acme'] },
    { kind: 'group', menu: 'Add to group', help: 'Tracks it with related runs on one page', placeholder: 'New group name', suggest: ['Navigation', 'Billing export', 'Onboarding'] }];
  const TITLES = {};
  // A host page may name a case's run as the row that opens it (the one Worca's Runs list); empty here.
  window.RunCardModel = { forms: FORMS, titles: TITLES, chainStart: CHAIN_START, chainPrs: CHAIN_PRS.map((x) => x[0]), proposed: PROPOSED, isNew: (t) => NEW.has(t), flow: FLOW, runFlow: RUN_FLOW, cases: CASES.map((c) => ({ id: c.id, label: c.label, group: c.group, chips: c.chips || [] })), view, add: ADD };
})();
