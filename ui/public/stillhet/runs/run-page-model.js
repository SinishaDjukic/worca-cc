// Run card v2 model: every case of the task and group page card as data, and view() that turns a case plus the
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

  // A short task with no project: its steps add up to its own 12m and $1.80, not a full run's.
  const SHORT_RUN = (tail) => ({ plan: [ok('Clarify', '34s', { cost: '$0.12' }), ok('Plan', '3m', { cost: '$0.48' })], build: [ok('Implementation', '5m 26s', { cost: '$0.80' })], review: [ok('Review implementation', '2m', { cost: '$0.30' }), ok('Manual tests checklist', '1m', { cost: '$0.10' })], tail });
  const SHORT_FACTS = (task, outcome) => ({ task, outcome, decisions: [], evidence: 'Review passed' });
  const run = (o) => [
    { key: 'plan', label: 'Plan', subs: o.plan || PLAN },
    { key: 'build', label: 'Build', subs: o.build || BUILD },
    { key: 'review', label: 'Review', subs: o.review || REVIEW },
  ].concat(o.tail || [{ key: 'pr', label: 'PR', subs: o.pr || PR_NEXT }, { key: 'merged', label: 'Merged', subs: o.merged || LAND('next') }]);
  const allNext = (subs) => subs.map((x) => next(x.name));

  // A group's runs: each task is one segment, its four stages are the cells; the last segment is the PR stack.
  const member = (n, title, states, o) => ({ key: 'run' + n, label: 'Task ' + n, title, run: true,
    subs: ['Plan', 'Build', 'Review', 'Ready'].map((st, i) => s(st, states[i], (o && o.times && o.times[i]) || '', { live: (o && o.live && o.live[i]) || '', when: (o && o.when && o.when[i]) || '' })) });
  const NEEDS_YOU = R.runState('question').word;
  const RUNS = ['One head for run and group pages', 'Breadcrumb in the top bar', 'Phone layout of the head'];
  const SLICE = [0.42, 0.31, 0.27];   // how much of a whole run each slice of a feature takes
  const SIZES = ['+278 \u221264', '+41 \u221258', '+39 \u221222'];   // each task's diff; a group's is their sum

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
    // One task, start to merge
    { id: 'starting', group: 'Running', label: 'Starting', figs: [['Time', '0m 12s'], ['Cost', '$0.00']],
      stages: run({ plan: [s('Clarify', 'now', '', { live: 'Setting up the worktree', when: 'now', cost: '$0.00' }), next('Plan'), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'working', group: 'Running', label: 'Working', figs: LIVE_FIGS,
      stages: run({ review: [REVIEW[0], REVIEW[1], s('Manual web UI testing', 'now', '21m', { live: 'Opening the Runs page at 375px to check the breadcrumb', when: '8s ago' })] }) },
    { id: 'question', group: NEEDS_YOU, label: R.runState('question').word, figs: LIVE_FIGS,
      stages: run({ review: [s('Review implementation', 'ask', '12m', { live: 'Keep the breadcrumb on phones under 600px, or show only Back there?', when: '4m' }), next('Manual tests checklist'), next('Manual web UI testing')] }) },
    { id: 'paused', group: 'Paused', label: 'Paused', detail: 'Usage limit · resumes at 14:00', figs: [['Time', '2h 40m'], ['Cost', '$48.30']],
      stages: run({ build: [s('Implementation', 'paused', '1h 2m')], review: allNext(REVIEW) }) },
    { id: 'failed', group: 'Ended', label: 'Failed', figs: [['Time', '2h 12m'], ['Cost', '$41.30']],
      stages: run({ build: [s('Implementation', 'failed', '1h 30m', { loops: 3, live: 'Tests still failing after every retry' })], review: allNext(REVIEW) }) },
    { id: 'ready', group: 'Ready', label: 'Ready', figs: DONE_FIGS, stages: run({}) },
    { id: 'no-remote', group: 'Ready', label: 'Ready, no git remote', detail: 'This project has no git remote', figs: DONE_FIGS, stages: run({ pr: [next('Create PR', { live: 'Needs a git remote' }), next('Checks'), next('Approval')] }) },
    { id: 'mock-run', group: 'Ready', label: 'Mock task', detail: 'No model was called; it adds nothing to Saved', mock: true, diff: '+1 \u22120', files: [['README.md', 1, 0]], figs: [['Time', '2m'], ['Cost', '$0.00']], stages: run({ pr: [next('Create PR', { live: 'A mock task’s change is a placeholder' }), next('Checks'), next('Approval')] }).map((st) => Object.assign({}, st, { subs: st.subs.map((y) => Object.assign({}, y, { time: '', loops: 0, cost: '$0.00' })) })) },
    { id: 'checks', group: 'Pull requests', label: 'Checks running', figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(s('Checks', 'now', '', { live: '3 of 7 passed', when: 'running' }), next('Approval')) }) },
    { id: 'failing', group: 'Pull requests', label: 'Checks failing', figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(s('Checks', 'problem', '', { live: '2 failed · unit, e2e' }), next('Approval')) }) },
    { id: 'conflicts', group: 'Pull requests', label: 'Conflicts', figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(ok('Checks', '', { live: '7 of 7 passed' }), s('Conflicts with dev', 'problem', '', { live: 'Conflicts in 2 files' })) }) },
    { id: 'approved', group: 'Pull requests', label: 'Approved', figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(ok('Checks', '', { live: '7 of 7 passed' }), ok('Approval', '', { live: 'Approved by 1 reviewer' })) }) },
    { id: 'labelled', group: 'Ready', label: 'With labels, tags, group', figs: DONE_FIGS, stages: run({}),
      chips: [{ kind: 'label', text: 'ui' }, { kind: 'label', text: 'needs demo' }, { kind: 'tag', text: 'team: web' }, { kind: 'group', text: 'Navigation' }] },
    { id: 'merged', group: 'Done', label: 'Merged', figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(ok('Checks'), ok('Approval')), merged: LAND('merged', 'Merged 25 Oct, 16:02') }) },

    // States the app has today: a task waiting to start after another, a review gate, a cost cap, kept work, archived
    { id: 'scheduled', group: 'Waiting', label: 'Waiting (run after)', detail: 'Starts when “Unified page navigation” finishes', figs: [['Time', '0m'], ['Cost', '$0.00']],
      title: 'Breadcrumb tests for saved runs', stages: run({ plan: allNext(PLAN), build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'waiting-interrupted', group: 'Waiting', label: 'Waiting on an interrupted run', detail: '“Unified page navigation” was interrupted and can still resume; this waits for it', figs: [['Time', '0m'], ['Cost', '$0.00']],
      title: 'Breadcrumb tests for saved runs', stages: run({ plan: allNext(PLAN), build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'gate', group: NEEDS_YOU, label: 'Waits for your OK', detail: 'Review sent it back 3 times; the limit is 3', figs: LIVE_FIGS,
      stages: run({ review: [s('Review implementation', 'ask', '37m 21s', { loops: 3, live: 'Still 2 minor issues after 3 rounds: accept, or run another cycle?', when: '6m' }), next('Manual tests checklist'), next('Manual web UI testing')] }) },
    { id: 'capped', group: NEEDS_YOU, label: 'Paused at cost cap', detail: 'Reached the $120 cap for this task', figs: LIVE_FIGS,
      stages: run({ build: [ok('Implementation', '2h 4m', { loops: 3, cost: '$67.73' })], review: [REVIEW[0], s('Manual tests checklist', 'paused', '1m 18s', { live: 'Paused at $120.00' }), next('Manual web UI testing')] }) },
    { id: 'kept', group: 'Ended', label: 'Work kept', detail: 'The last commit failed; the work is kept in a copy', over: true, figs: DONE_FIGS,
      stages: run({ review: [REVIEW[0], REVIEW[1], s('Manual web UI testing', 'problem', '21m 10s', { live: 'Commit failed: pre-commit hook exited 1' })] }) },
    { id: 'archived', group: 'Done', label: 'Archived', detail: 'Branch, worktree and logs removed; the remote branch and PR stay', figs: DONE_FIGS, archived: true,
      stages: run({ pr: PR_OPEN(ok('Checks'), ok('Approval')), merged: LAND('merged', 'Merged 25 Oct, 16:02') }) },
    // Where actions lead: a stopped, discarded or applied run
    { id: 'stopped', group: 'Ended', label: 'Stopped', detail: 'Stopped by you · the branch and changes stay', figs: [['Time', '2h 40m'], ['Cost', '$48.30']],
      stages: run({ build: [s('Implementation', 'paused', '1h 2m', { live: 'Stopped by you' })], review: allNext(REVIEW) }) },
    { id: 'discarded', group: 'Ended', label: 'Discarded', detail: 'The changes are gone; the task stays in history', figs: DONE_FIGS,
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
    { id: 'source-unmerged', group: 'Kinds', label: 'On its source, not merged back', detail: SRC + ' moved while the task worked', branch: SRC, onSource: true, hidden: 'worca/run-7b0bfb1e',
      figs: DONE_FIGS,
      stages: run({ tail: [{ key: 'push', label: 'Push', subs: [s('Merge back', 'problem', '', { live: 'Not merged back into ' + SRC }), next('To origin/' + SRC)] }] }) },
    { id: 'folder', group: 'Kinds', label: 'Folder run', branch: '', folder: '~/src/marketing-site', figs: [['Time', '52m'], ['Cost', '$9.15']],
      stages: run({ tail: [{ key: 'apply', label: 'Apply', subs: [next('Into the folder', { live: '5 files changed in a copy' })] }] }) },
    { id: 'applied', group: 'Kinds', label: 'Folder applied', branch: '', folder: '~/src/marketing-site', figs: [['Time', '52m'], ['Cost', '$9.15']],
      stages: run({ tail: [{ key: 'apply', label: 'Apply', subs: [s('Into the folder', 'merged', '', { live: '5 files written · 25 Oct 14:05' })] }] }) },
    { id: 'workspace', group: 'Kinds', label: 'Workspace', extraItems: ['worca-api #212', 'worca-web #88', 'worca-docs #31'], detail: 'worca-docs #31 conflicts with main', branch: 'feat/billing-export', project: 'billing workspace', repos: ['worca-api', 'worca-web', 'worca-docs'], figs: [['Time', '3h 05m'], ['Cost', '$52.70']],
      stages: run({ tail: [{ key: 'pr', label: 'PRs', subs: [s('worca-api #212', 'merged', '', { live: 'Merged into main' }), s('worca-web #88', 'now', '', { live: 'Checks running · 5 of 7' }), s('worca-docs #31', 'problem', '', { live: 'Conflicts with main' })] }, { key: 'merged', label: 'Merged', subs: [s('1 of 3 repositories', 'next', '', { live: 'worca-api is in main' })] }] }) },
    { id: 'noproject', group: 'Kinds', label: 'No project', project: '', branch: '', noDiff: true, figs: [['Time', '12m'], ['Cost', '$1.80']], ...SHORT_FACTS('Summarise the incident notes into one page.', ['Wrote the summary and two supporting documents']),
      stages: run(SHORT_RUN([{ key: 'done', label: 'Done', subs: [ok('3 documents', '', { live: 'In Overview' })] }])) },

    // Shaper
    { id: 'clarify', group: 'Shaper', label: 'Clarify', figs: [['Time', '2m'], ['Cost', '$0.76']],
      stages: run({ plan: [s('Clarify', 'ask', '34s', { live: '3 questions · which pages, what Back does, phones', when: '1m' }), next('Plan'), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'plan', group: 'Shaper', label: 'Plan ready', figs: [['Time', '34m'], ['Cost', '$15.41']],
      stages: run({ plan: [ok('Clarify', '34s'), s('Plan', 'ask', '33m 57s', { live: '6 steps · 2 open issues · waiting for you', when: '4m' }), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'outline', n: 3, group: 'Shaper', label: 'Plan in slices', figs: [['Time', '41m'], ['Cost', '$18.90']],
      stack: { mode: 'outline' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), s('Cut into tasks', 'ask', '7m', { live: '3 tasks, one PR each · waiting for you', when: '2m' })] },
        { key: 'run1', label: 'Task 1', subs: allNext(['Plan', 'Build', 'Review', 'Ready'].map((n) => s(n))) }, { key: 'run2', label: 'Task 2', subs: allNext(['Plan', 'Build', 'Review', 'Ready'].map((n) => s(n))) },
        { key: 'run3', label: 'Task 3', subs: allNext(['Plan', 'Build', 'Review', 'Ready'].map((n) => s(n))) }, { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'slice', group: 'Shaper', label: 'A slice running', parent: { caseId: 'feature', index: 1 }, branch: 'feat/head-breadcrumb-2', figs: [['Time', '1h 10m'], ['Cost', '$19.40'], ['Rate', '$16.60/h']],
      stages: run({ build: [s('Implementation', 'now', '12m', { live: 'Builds on task 1 · editing app.js', when: '3s ago' })], review: allNext(REVIEW),
        tail: [{ key: 'ship', label: 'Ship', subs: [next('With the feature', { live: 'One stacked PR each, from the feature page' })] }] }) },

    // Groups
    { id: 'feature', group: 'Groups', runCases: ['ready', 'slice', ''], follows: true, label: 'Feature, run 2', kind: 'Feature', title: 'Unified page navigation', branch: '', figs: [['Time', '3h 20m'], ['Cost', '$61.10'], ['Rate', '$18.30/h']], tabs: GROUP_TABS,
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Cut into tasks', '7m', { live: '3 tasks, one PR each' })] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m', ''] }),
        member(2, RUNS[1], ['done', 'now', 'next', 'next'], { times: ['18m', '40m'], live: ['', 'Editing app.js'], when: ['', '3s ago'] }),
        member(3, RUNS[2], ['next', 'next', 'next', 'next']),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'featureready', n: 3, group: 'Groups', runCases: ['ready', 'ready', 'ready'], label: 'Feature ready', kind: 'Feature', title: 'Unified page navigation', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS,
      stack: { mode: 'create', runs: RUNS, rec: 'stack', sizes: ['+278 \u221264', '+41 \u221258', '+39 \u221222'], reason: '3 tasks and 502 changed lines, most of them in task 1: three focused reviews go faster than one mixed one.' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s', { live: 'Plan accepted by you · pass 2' }), ok('Cut into tasks', '7m', { live: '3 tasks, one PR each · accepted by you' })] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['18m', '1h 2m', '27m'] }),
        member(3, RUNS[2], ['done', 'done', 'done', 'done'], { times: ['12m', '44m', '19m'] }),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'featureone', n: 2, group: 'Groups', runCases: ['ready', 'ready'], label: 'Feature ready, small', kind: 'Feature', title: 'Unified page navigation', branch: '', figs: [['Time', '1h 40m'], ['Cost', '$21.70']], tabs: GROUP_TABS,
      diff: '+158 \u221262', stack: { mode: 'create', runs: RUNS.slice(0, 2), rec: 'one', sizes: ['+120 \u221240', '+38 \u221222'], reason: '2 small tasks, 220 changed lines, that combine without conflicts: one review is enough.' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '12m'), ok('Cut into tasks', '3m')] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['8m', '31m', '12m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['6m', '22m', '9m'] }),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2')] }] },
    { id: 'featureblocked', n: 3, group: 'Groups', runCases: ['ready', 'ready', 'ready'], label: 'Feature ready, One PR off', kind: 'Feature', title: 'Unified page navigation', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS,
      stack: { mode: 'create', runs: RUNS, rec: 'stack', sizes: ['+278 \u221264', '+41 \u221258', '+39 \u221222'], oneBlocked: 'Not possible: tasks 2 and 3 started from the same branch and both change ui/public/app.js lines 36,380\u201336,412, so they conflict on one branch.', reason: 'Runs 2 and 3 don\u2019t build on each other and conflict; stacked, each lands on top of the one before.' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Cut into tasks', '7m')] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['18m', '1h 2m', '27m'] }),
        member(3, RUNS[2], ['done', 'done', 'done', 'done'], { times: ['12m', '44m', '19m'] }),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'chain', group: 'Groups', runCases: ['approved', 'checks', 'failing'], runPRs: ['#959', '#960', '#961'], label: 'Stack in review', kind: 'Chain', title: 'Unified page navigation', detail: '#961 checks failing · #959 ready to merge', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS,
      stack: { mode: 'review' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Cut into tasks', '7m')] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['18m', '1h 2m', '27m'] }), member(3, RUNS[2], ['done', 'done', 'done', 'done'], { times: ['12m', '44m', '19m'] }),
        { key: 'pr', label: 'PRs', subs: [ok('#959'), s('#960', 'review'), s('#961', 'problem')] }] },
  ];

  // The rest of what a task can be. A case names the state it shows (`state`); its detail line and steps are its own.
  const PAUSED_AT = (live) => run({ build: [s('Implementation', 'paused', '1h 2m', { live: live || '' })], review: allNext(REVIEW) });
  const P_FIGS = [['Time', '2h 40m'], ['Cost', '$48.30']];
  const pausedCase = (id, state, label, detail, live, o) => Object.assign({ id, state, group: 'Paused', label, detail, figs: P_FIGS, stages: PAUSED_AT(live) }, o || {});
  const TICKET = { title: 'Nightly dependency update', figs: [['Time', '0m'], ['Cost', '$0.00']] };
  const ticket = (id, state, label, detail, o) => Object.assign({ id, state, group: 'Waiting', label, detail, stages: run({ plan: allNext(PLAN), build: allNext(BUILD), review: allNext(REVIEW) }) }, TICKET, o || {});
  const prCase = (id, state, label, detail, pr, o) => Object.assign({ id, state, group: 'Pull requests', label, detail, figs: DONE_FIGS, stages: run({ pr }) }, o || {});
  const CHECKS_OK = ok('Checks', '', { live: '7 of 7 passed' });
  const CHECKS_RUN = s('Checks', 'now', '', { live: '3 of 7 passed', when: 'running' });
  const WATCH = (state, live, o) => s('Watch', state, '', Object.assign({ live }, o || {}));
  const REVIEWING = next('Approval', { live: 'Waiting for a review' });
  const RECEIPT_PLAN = [ok('Clarify', '34s'), ok('Plan', '33m 57s', { live: 'Plan accepted by you · pass 2' }), ok('Cut into tasks', '7m', { live: '3 tasks, one PR each · accepted by you' })];
  const groupOf = (id, group, label, cases3, o) => Object.assign({ id, group, label, runCases: cases3, kind: 'Feature', title: 'Unified page navigation', branch: '', figs: [['Time', '3h 20m'], ['Cost', '$61.10']], tabs: GROUP_TABS, follows: true, state: 'feature',
    stages: [{ key: 'plan', label: 'Plan', subs: RECEIPT_PLAN }, member(1, RUNS[0], ['done', 'done', 'done', 'done']), member(2, RUNS[1], ['done', 'now', 'next', 'next']), member(3, RUNS[2], ['next', 'next', 'next', 'next']), { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] }, o || {});
  const GROUP_RUNS = ['Remove the old invoices page', 'Billing export as CSV'];
  const userGroup = (id, label, runCases, o) => Object.assign({ id, group: 'Groups', label, runCases, runTitles: GROUP_RUNS, kind: 'Group', independent: true, sizes: ['+120 −40', '+38 −22'], title: 'Billing cleanup', branch: '', figs: [['Time', '1h 40m'], ['Cost', '$21.70']], tabs: GROUP_TABS, task: 'Clean up billing: remove the old invoices page, and export billing as CSV.',
    decisions: [{ step: 'Remove the old invoices page', q: 'Keep the old invoices address working?', a: 'Redirect it to Billing', who: 'you', when: '10:14' }, { step: 'Billing export as CSV', q: 'Which dates does the export use?', a: 'The invoice date', who: 'away', when: '11:02', note: 'Sonnet 5.5 · $0.21' }],
    stages: [member(1, GROUP_RUNS[0], ['done', 'done', 'done', 'done']), member(2, GROUP_RUNS[1], ['done', 'done', 'done', 'done']), { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2')] }] }, o || {});
  const READY3 = (o) => Object.assign({ mode: 'create', runs: RUNS, rec: 'stack', sizes: ['+278 −64', '+41 −58', '+39 −22'], reason: '3 tasks and 502 changed lines: three focused reviews go faster than one mixed one.' }, o || {});
  const READY_STAGES = [{ key: 'plan', label: 'Plan', subs: RECEIPT_PLAN }, member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['18m', '1h 2m', '27m'] }), member(3, RUNS[2], ['done', 'done', 'done', 'done'], { times: ['12m', '44m', '19m'] }), { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }];
  const REC_EV = { title: 'This step could not reach the model', log: 'Open the log', lines: ['api.anthropic.com: connection reset, 3 tries', 'Retrying by itself until 14:40'] };
  const AUTH_EV = { title: 'This step could not reach the model', log: 'Open the log', lines: ['401: the Claude token has expired', 'Run claude setup-token or /login, then Retry'] };
  const KEPT_EV = { title: '1 test failed in test/ui-run-head.test.mjs', log: 'Open log at line 1,284', lines: ['✖ breadcrumb hides under 600px (12ms)', 'hook exited 1 · the work is kept in a copy'] };
  const FAILED_AT = (live) => run({ build: [s('Implementation', 'failed', '1h 30m', { loops: 3, live: live || 'Tests still failing after every retry' })], review: allNext(REVIEW) });
  const APPLY = (state, live) => [{ key: 'apply', label: 'Apply', subs: [s('Into the folder', state, '', { live })] }];
  const FOLDER = { branch: '', folder: '~/src/marketing-site' };

  const GROUP_SHIP = { 'Create 2 PRs': { to: 'group-shipped', say: 'Created #959 and #960', dialog: 'pr' }, 'Create PR': { to: 'ship-applied', say: 'A new branch combines both tasks; opened #959', dialog: 'pr' } };
  const CASES1 = [
    // Paused, and why: each reason has its words and its own way on
    pausedCase('paused-limit', 'paused-limit', 'Usage limit, resets soon', 'Claude Code’s usage limit · resets at 13:55, in 1h 12m'),
    pausedCase('paused-reset', 'paused-reset', 'Usage limit, has reset', 'Claude Code’s usage limit · it reset at 13:55; Resume to go on'),
    pausedCase('paused-missed', 'paused-missed', 'Usage limit, resume missed', 'Usage limit · the resume at 14:00 was missed'),
    pausedCase('paused-free', 'paused-limit', 'Free requests used up', 'OpenRouter’s free-model requests are used up · they come back at 14:00'),
    pausedCase('paused-budget', 'paused-budget', 'Total budget', 'Total budget reached · $500 of $500 this month', 'Paused at the total budget'),
    pausedCase('paused-team', 'paused-team', 'Team cap', 'Reached your team’s cap of $200 for a task', 'Paused at the team cap', { budget: 200, stages: run({ build: [s('Implementation', 'paused', '1h 2m', { live: 'Paused at the team cap', cost: '$158.48' })], review: allNext(REVIEW) }) }),
    pausedCase('paused-you', 'paused-you', 'Paused by you', 'Paused by you · Resume goes on from {step}', 'Paused by you'),
    pausedCase('paused-at', 'paused-at', 'Resume set for a time', 'Paused by you · resumes at {at}', 'Paused by you'),
    pausedCase('paused-restart', 'paused-reason', 'Worca restarted', 'Worca restarted · the worktree and progress are kept'),
    pausedCase('paused-time', 'paused-reason', 'Time limit', 'Reached a step’s time limit of 1h · Resume runs the step again', 'Stopped at its 1h limit'),
    pausedCase('paused-away', 'paused-reason', 'Away mode limit', 'Away mode limit reached · $20 spent on answers tonight'),
    pausedCase('paused-error', 'paused-reason', 'Paused on an error', 'Paused on an error: no space left on device · fix it, then Resume', 'No space left on device'),
    pausedCase('interrupted', 'interrupted', 'Interrupted', 'Worca stopped while it ran · Resume goes on from this step', 'Interrupted'),
    pausedCase('interrupted-dead', 'interrupted-dead', 'Interrupted, cannot resume', 'Worca stopped while it ran · this task cannot resume', 'Interrupted', { over: true, noSetup: true, noTry: true }),

    // Live, in trouble, or not in the usual shape
    { id: 'copying', state: 'starting', group: 'Running', label: 'Copying the folder', detail: 'Copying the folder', figs: [['Time', '0m 12s'], ['Cost', '$0.00']], ...FOLDER,
      stages: run({ plan: [s('Clarify', 'now', '', { live: 'Preflight: checking the copy', when: 'now', cost: '$0.00' }), next('Plan'), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW), tail: APPLY('next', 'Nothing changed yet') }) },
    { id: 'network', group: 'Running', label: 'Waiting for the network', detail: 'Waiting for the network · api.anthropic.com · retries by itself until 14:40', figs: LIVE_FIGS,
      stages: run({ review: [REVIEW[0], s('Manual tests checklist', 'now', '1m', { live: 'Waiting for the network', when: '40s' }), next('Manual web UI testing')] }) },
    { id: 'recovery', group: NEEDS_YOU, label: 'Cannot reach the model', detail: 'This step could not reach the model · it retries by itself until 14:40', figs: LIVE_FIGS, ev: REC_EV,
      stages: run({ build: [s('Implementation', 'problem', '1h 2m', { live: R.failureOf('Reach the model').title })], review: allNext(REVIEW) }) },
    { id: 'recovery-auth', state: 'recovery', group: NEEDS_YOU, label: 'Sign-in expired', detail: 'The Claude token has expired · run claude setup-token, then Retry', figs: LIVE_FIGS, ev: AUTH_EV,
      stages: run({ build: [s('Implementation', 'problem', '1h 2m', { live: R.failureOf('Reach the model').title })], review: allNext(REVIEW) }) },
    { id: 'parallel', state: 'working', group: 'Running', label: 'Parallel steps', figs: LIVE_FIGS,
      stages: run({ review: [s('Review implementation', 'now', '12m', { live: 'Reading the diff', when: '2s ago' }), s('Manual tests checklist', 'now', '9m', { live: 'Writing the checklist', when: '5s ago' }), s('Manual web UI testing', 'now', '3m', { live: 'Opening the Runs page', when: '1s ago' })] }) },
    { id: 'roles-live', state: 'working', group: 'Running', label: 'Role reviews running', figs: LIVE_FIGS,
      stages: run({ review: [s('Security review', 'done', '6m', { live: 'Passed · no findings' }), s('Design review', 'now', '4m', { live: 'Reading the diff', when: '3s ago' }), s('Backend review', 'now', '4m', { live: 'Checking the routes', when: '9s ago' }), next('Manual web UI testing')] }) },
    { id: 'nodes', state: 'working', group: 'Running', label: 'A workflow without stages', title: 'Weekly issue triage', figs: [['Time', '6m'], ['Cost', '$0.82']], noDiff: true, branch: '',
      stages: [{ key: 'n1', label: 'Fetch issues', subs: [ok('Fetch issues', '4m')] }, { key: 'n2', label: 'Triage', subs: [s('Triage', 'now', '2m', { live: 'Sorting 41 issues', when: '3s ago' })] }, { key: 'n3', label: 'Write report', subs: [next('Write report')] }, { key: 'n4', label: 'Post report', subs: [next('Post report')] }] },
    { id: 'noreview', state: 'working', group: 'Running', label: 'A stage not in the workflow', figs: LIVE_FIGS,
      stages: run({ build: [s('Implementation', 'now', '12m', { live: 'Editing app.js', when: '3s ago' })], review: [next('Not in this workflow')] }) },

    // Finished, with something to say
    { id: 'ready-issues', state: 'ready', group: 'Ready', label: 'Ready, open issues', detail: '2 open issues · not in dev yet', figs: DONE_FIGS, stages: run({ review: [ok('Review implementation', '37m 21s', { loops: 3, live: 'Ran out of cycles · 2 open issues' }), REVIEW[1], REVIEW[2]] }), issues: true, shaped: true, evidence: 'Tests pass · Review ran out of cycles · Manual test passed' },
    { id: 'ready-end', state: 'ready', group: 'Ready', label: 'Ready, end not reached', detail: 'End not reached · part of the workflow did not run', over: true, figs: DONE_FIGS, stages: run({ review: [REVIEW[0], REVIEW[1], next('Manual web UI testing', { live: 'Did not run' })] }), evidence: 'Tests pass · Review passed on round 3 · Manual test did not run' },
    { id: 'ready-moved', state: 'ready-moved', group: 'Ready', label: 'Ready, base moved', detail: 'Not in dev yet · dev moved while it ran', figs: DONE_FIGS, stages: run({}), baseMoved: true },
    { id: 'ready-held', state: 'ready', group: 'Ready', label: 'Ready, branch held', figs: DONE_FIGS, stages: run({}), heldBy: 'Breadcrumb tests for saved runs' },
    { id: 'ready-deps', state: 'ready', group: 'Ready', label: 'Ready, runs wait on it', figs: DONE_FIGS, stages: run({}), dependents: 2 },
    { id: 'ready-nocost', state: 'ready', group: 'Ready', label: 'Ready, engine with no cost', figs: DONE_FIGS, stages: run({}), agentsUnknown: true },
    { id: 'hosted', state: 'ready', group: 'Ready', label: 'Ready, on a hosted Worca', figs: DONE_FIGS, stages: run({}), hosted: true },
    { id: 'finished-nogit', state: 'noproject', group: 'Ready', label: 'Finished, no git', detail: 'Git is not set up here, so there is no branch or PR', branch: '', figs: [['Time', '12m'], ['Cost', '$1.80']], noDiff: true, noSetup: true, ...SHORT_FACTS('Summarise the incident notes into one page.', ['Wrote the summary']),
      stages: run(SHORT_RUN([{ key: 'done', label: 'Done', subs: [ok('Finished')] }])) },
    { id: 'folder-nochange', state: 'noproject', group: 'Ready', label: 'Folder, no files changed', detail: 'No files changed', ...FOLDER, figs: [['Time', '12m'], ['Cost', '$1.80']], noDiff: true, ...SHORT_FACTS('Check the marketing site for broken links and fix any you find.', ['Found no broken links, so changed nothing']),
      stages: run(SHORT_RUN([{ key: 'done', label: 'Done', subs: [ok('Finished', '', { live: 'Nothing to apply' })] }])) },
    { id: 'failed-kept', group: 'Ended', label: 'Failed, work kept', detail: 'Tests still failing · the work is kept in a copy', over: true, ev: KEPT_EV, figs: [['Time', '2h 12m'], ['Cost', '$41.30']], stages: FAILED_AT() },
    { id: 'failed-kept-wait', group: 'Ended', label: 'Failed, kept work settling', detail: 'Tests still failing · the kept work is still being saved', over: true, ev: KEPT_EV, figs: [['Time', '2h 12m'], ['Cost', '$41.30']], stages: FAILED_AT() },
    { id: 'failed-folder', group: 'Ended', label: 'Failed, folder copy pending', detail: 'Tests still failing · 5 files changed in a copy', over: true, ...FOLDER, ev: KEPT_EV, figs: [['Time', '52m'], ['Cost', '$9.15']],
      stages: run({ build: [s('Implementation', 'failed', '30m', { live: 'Tests still failing after every retry' })], review: allNext(REVIEW), tail: APPLY('next', '5 files changed in a copy') }) },
    { id: 'stopped-folder', group: 'Ended', label: 'Stopped, folder copy pending', detail: 'Stopped by you · 5 files changed in a copy', over: true, ...FOLDER, figs: [['Time', '52m'], ['Cost', '$9.15']],
      stages: run({ build: [s('Implementation', 'paused', '30m', { live: 'Stopped by you' })], review: allNext(REVIEW), tail: APPLY('next', '5 files changed in a copy') }) },
    { id: 'in-base', group: 'Done', label: 'Already in the base', detail: 'Already in dev through another branch · no PR of its own', noSetup: true, figs: DONE_FIGS, stages: run({ tail: [{ key: 'merged', label: 'Merged', subs: [s('Into dev', 'merged', '', { live: 'In dev · no PR of its own' })] }] }) },
    { id: 'pushed', group: 'Done', label: 'On its source, pushed', detail: SRC + ' is on origin', branch: SRC, onSource: true, figs: DONE_FIGS, stages: run({ tail: [{ key: 'push', label: 'Push', subs: [ok('Merge back', '', { live: 'Into ' + SRC }), s('To origin/' + SRC, 'merged', '', { live: 'Pushed' })] }] }) },
    { id: 'diverged', group: 'Done', label: 'On its source, diverged', detail: SRC + ' and origin have diverged: pull or rebase, then push', branch: SRC, onSource: true, figs: DONE_FIGS, stages: run({ tail: [{ key: 'push', label: 'Push', subs: [ok('Merge back', '', { live: 'Into ' + SRC }), s('To origin/' + SRC, 'problem', '', { live: 'Diverged' })] }] }) },
    { id: 'deleted', group: 'Done', label: 'Deleted', detail: 'Gone from Tasks', figs: DONE_FIGS, noSetup: true, archived: true, stages: run({ tail: [{ key: 'done', label: 'Done', subs: [s('Deleted', 'paused', '', { live: 'By you' })] }] }) },

    // A scheduled run before it is a run
    ticket('ticket-missed', 'ticket-missed', 'Missed its start', 'Missed its 09:00 start · Worca was off'),
    ticket('ticket-firing', 'ticket-firing', 'Its time has come', 'Starting from its schedule', { over: true }),
    ticket('ticket-failed', 'ticket-failed', R.failureOf('Start').title, R.failureOf('Start at 09:00').title + ': the project folder is gone'),
    ticket('ticket-canceled', 'cancelled', 'Cancelled', 'Cancelled before it started'),
    ticket('ticket-skipped', 'ticket-ended', 'Skipped', 'Skipped: the last one was still running'),

    // A pull request's own states
    prCase('pr-draft', 'pr-draft', 'Draft', 'Draft · no one is asked to review yet', PR_OPEN(CHECKS_OK, next('Approval', { live: 'Not asked yet: it is a draft' }))),
    prCase('pr-waiting', 'checks', 'Waiting for a review', 'Waiting for a review', PR_OPEN(CHECKS_OK, REVIEWING), { flow: { next: null } }),
    prCase('pr-changes', 'pr-changes', 'Changes requested', 'Changes requested by a reviewer', PR_OPEN(CHECKS_OK, s('Approval', 'problem', '', { live: 'Changes requested by 1 reviewer' })), { requested: true }),
    prCase('pr-fixing', 'pr-fixing', 'Fixing', 'Fixing · round 2 · fix the failing e2e check', PR_OPEN(s('Checks', 'problem', '', { live: '1 failed · e2e' }), REVIEWING, [WATCH('now', 'Fixing · round 2'), ok('Round 1', '6m', { live: 'Fixed the unit test' }), s('Round 2', 'now', '2m', { live: 'Fix the failing e2e check', when: '4s ago' })])),
    prCase('pr-closed', 'pr-closed', 'Closed', 'The PR was closed without merging', [s('Create PR', 'paused', '', { live: '#959 was closed without merging' }), next('Checks'), next('Approval')]),
    prCase('pr-abandoned', 'pr-closed', 'Closed, on Azure', 'The PR was abandoned', [s('Create PR', 'paused', '', { live: '#959 was abandoned' }), next('Checks'), next('Approval')], { host: 'azure' }),
    prCase('pr-declined', 'pr-closed', 'Closed, on Bitbucket', 'The PR was declined', [s('Create PR', 'paused', '', { live: '#959 was declined' }), next('Checks'), next('Approval')], { host: 'bitbucket' }),
    prCase('pr-behind', 'pr-behind', 'Out of date', 'Out of date with dev', PR_OPEN(CHECKS_OK, s('Behind dev', 'problem', '', { live: '4 commits behind; it merges cleanly' }))),
    prCase('pr-blocked', 'pr-blocked', 'Blocked', 'Blocked by branch rules', PR_OPEN(CHECKS_OK, s('Approval', 'problem', '', { live: 'Branch rules need 2 approvals; it has 1' }))),
    prCase('watching', 'checks', 'Watch on', '', PR_OPEN(CHECKS_RUN, next('Approval'), [WATCH('now', 'Watching · fixes failing checks and asked-for changes')])),
    prCase('watch-merging', 'pr-fixing', 'Watch merging', 'Merging dev in', PR_OPEN(CHECKS_OK, s('Behind dev', 'problem', '', { live: '4 commits behind' }), [WATCH('now', 'Merging dev in')])),
    prCase('watch-resolving', 'pr-fixing', 'Watch resolving', 'Resolving conflicts', PR_OPEN(CHECKS_OK, s('Conflicts with dev', 'problem', '', { live: 'Conflicts in 2 files' }), [WATCH('now', 'Resolving conflicts')])),
    prCase('watch-stopped', 'watch-stopped', 'Watch stopped', 'Watch stopped · 2 fix tasks, conflicts remain', PR_OPEN(CHECKS_OK, s('Conflicts with dev', 'problem', '', { live: 'Conflicts in 2 files' }), [WATCH('paused', 'Stopped · 2 fix tasks, conflicts remain')])),
    prCase('watch-off', 'checks', 'Watch unavailable', '', PR_OPEN(CHECKS_RUN, next('Approval'), [WATCH('paused', 'Unavailable: no token for this repository')]), { flow: { next: null }, watchOff: 'No token for this repository, so Worca cannot watch it' }),
    prCase('watch-finishing', 'pr-fixing', 'Watch off, finishing', 'Watch is off; its last fix is finishing', PR_OPEN(CHECKS_OK, REVIEWING, [WATCH('now', 'Off · its last fix is finishing')])),
    // What a Fix leads to: the fix is under way, in the present tense, until it is pushed
    prCase('fixing-checks', 'pr-fixing', 'Fixing checks', 'Fixing 2 failing checks', PR_OPEN(s('Checks', 'now', '', { live: 'Fixing unit and e2e', when: 'now' }), REVIEWING)),
    prCase('fixing-conflicts', 'pr-fixing', 'Fixing conflicts', 'Fixing 2 conflicts with dev', PR_OPEN(CHECKS_OK, s('Conflicts with dev', 'now', '', { live: 'Merging dev in', when: 'now' }))),
    prCase('fixing-changes', 'pr-fixing', 'Fixing what was asked', 'Fixing what the reviewer asked', PR_OPEN(CHECKS_OK, s('Approval', 'now', '', { live: 'Fixing what the reviewer asked', when: 'now' }))),
    prCase('round', 'round', 'A fix round', 'Round 2 · fix the failing e2e check', PR_OPEN(CHECKS_RUN, next('Approval'), [ok('Round 1', '6m', { live: 'Fixed the unit test' }), s('Round 2', 'now', '2m', { live: 'Fix the failing e2e check', when: '4s ago' })])),
    prCase('round-failing', 'round', 'A round, PR failing', 'Round 2 · checks still failing; the task that opened the PR asks you', PR_OPEN(s('Checks', 'review', '', { live: '1 failed · e2e' }), next('Approval'), [ok('Round 1', '6m', { live: 'Fixed the unit test' }), ok('Round 2', '2m', { live: 'Pushed its fix' })]), { flow: { next: null } }),
    prCase('auto-opened', 'checks', 'PR opened by itself', '', [ok('Create PR', '', { live: 'Opened by itself when the task finished · 25 Oct, 13:40' }), CHECKS_RUN, next('Approval')], { flow: { next: null } }),
    prCase('auto-failed', 'auto-failed', 'PR not opened by itself', 'Not opened: the GitHub CLI is not signed in', [next('Create PR', { live: 'Waiting for you to sign in' }), next('Checks'), next('Approval')], { openStage: 'pr' }),
    prCase('reqs', 'reqs', 'Requirements to mark', '', [next('Create PR', { live: 'Waiting for the requirements to be marked' }), next('Checks'), next('Approval')], { reqsCheck: true, openStage: 'pr', shaped: true }),

    // Shaper
    { id: 'requirements', group: 'Shaper', label: 'Requirements', figs: [['Time', '2m'], ['Cost', '$0.76']],
      stages: run({ plan: [ok('Clarify', '34s'), s('Requirements', 'ask', '1m', { live: '4 agreed · 1 needs you', when: '1m' }), next('Plan'), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'auto', group: 'Shaper', label: 'Auto proposal', figs: [['Time', '1m'], ['Cost', '$0.12']],
      stages: run({ plan: [s('Auto workflow', 'ask', '1m', { live: 'Proposes 7 steps for this task', when: '1m' }), next('Clarify'), next('Plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'plan-fixing', group: 'Shaper', label: 'Fixing the plan', detail: 'Fixing the plan’s 2 open issues', figs: [['Time', '34m'], ['Cost', '$15.41']],
      stages: run({ plan: [ok('Clarify', '34s'), s('Plan', 'now', '33m 57s', { live: 'Fixing 2 open issues', when: 'now' }), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'outline-fixing', group: 'Shaper', label: 'Fixing the split', detail: 'Fixing the split’s 1 open issue', figs: [['Time', '41m'], ['Cost', '$18.90']],
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), s('Cut into tasks', 'now', '7m', { live: 'Fixing 1 open issue', when: 'now' })] },
        { key: 'run1', label: 'Task 1', subs: allNext(['Plan', 'Build', 'Review', 'Ready'].map((n) => s(n))) }, { key: 'run2', label: 'Task 2', subs: allNext(['Plan', 'Build', 'Review', 'Ready'].map((n) => s(n))) },
        { key: 'run3', label: 'Task 3', subs: allNext(['Plan', 'Build', 'Review', 'Ready'].map((n) => s(n))) }, { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'auto-feature', state: 'ready', group: 'Shaper', label: 'A slice, PR waits', parent: { caseId: 'feature', index: 0 }, branch: 'feat/head-breadcrumb-1', figs: DONE_FIGS, shipLive: 'Waiting for the feature',
      stages: run({ tail: [{ key: 'ship', label: 'Ship', subs: [next('With the feature')] }] }) },

    // Groups: what holds a group up, and how it ships
    groupOf('feature-failed', 'Groups', 'Feature, a task failed', ['ready', 'failed', '']),
    groupOf('feature-paused', 'Groups', 'Feature, a task paused', ['ready', 'paused', '']),
    groupOf('feature-needs', 'Groups', 'Feature, a task asks', ['ready', 'question', '']),
    groupOf('feature-stopped', 'Groups', 'Feature, stopped', ['ready', 'stopped', '']),
    groupOf('feature-asks', 'Groups', 'Feature, asks before run 3', ['ready', 'ready', ''], { state: 'group-asks', k: 3, follows: false, detail: 'Task 2 is ready · task 3 waits for your OK', askEach: true }),
    groupOf('ship-waiting', 'Groups', 'Ship, waiting for runs', ['ready', 'slice', ''], { shipWaiting: 'Waiting for run 2' }),
    { id: 'ship-declined', n: 3, group: 'Groups', runCases: ['ready', 'ready', 'ready'], label: 'Ship, not now', kind: 'Feature', title: 'Unified page navigation', detail: 'Not shipped yet · ship it from here', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS, stack: READY3(), stages: READY_STAGES },
    { id: 'ship-applied', group: 'Groups', runCases: ['approved', 'approved', 'approved'], runPRs: ['#959', '#959', '#959'], label: 'Ship, applied', kind: 'Feature', title: 'Unified page navigation', detail: 'Shipped as one PR · closed 3 drafts · release v1.20.0 drafted', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS,
      stages: READY_STAGES.slice(0, -1).concat({ key: 'pr', label: 'PRs', subs: [ok('#959', '', { live: 'All 3 tasks · into dev' })] }) },
    { id: 'feature-reqs', state: 'featureblocked', n: 3, group: 'Groups', runCases: ['ready', 'ready', 'ready'], label: 'Feature, requirements to mark', kind: 'Feature', title: 'Unified page navigation', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS, reqsCheck: true, shaped: true, stack: READY3(), stages: READY_STAGES },
    { id: 'chain-loose', state: 'featureblocked', n: 3, group: 'Groups', runCases: ['ready', 'ready', 'ready'], label: 'Chain, One PR off', kind: 'Chain', title: 'Unified page navigation', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS, stack: READY3({ oneBlocked: 'A task does not start from the previous task’s branch', reason: 'Stacked, each task lands on top of the one before.' }), stages: READY_STAGES },
    { id: 'chain-owned', state: 'featureblocked', n: 3, group: 'Groups', runCases: ['ready', 'ready', 'ready'], label: 'Feature, a task has a PR', kind: 'Feature', title: 'Unified page navigation', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS, flow: { 'Create 2 PRs': { to: 'chain', say: 'Created #960 and #961, on top of #959', dialog: 'pr' } }, stack: READY3({ owned: { 0: '#959' }, oneBlocked: 'A task already has a PR', reason: 'Run 1 already has its PR; the others stack on it.' }), stages: READY_STAGES.slice(0, -1).concat({ key: 'pr', label: 'PRs', subs: [s('#959', 'review'), next('#2'), next('#3')] }) },
    userGroup('group-working', 'Group, in any order', ['ready', 'working'], { state: 'feature', follows: true, flow: { next: 'group-ready' }, detail: 'Any order · 1 of 2 running', sizes: ['+120 −40', '+38 −22'] }),
    userGroup('group-shipped', 'Group, shipped', ['approved', 'approved'], { state: 'ship-applied', runPRs: ['#959', '#960'], detail: 'Shipped as 2 PRs', stages: [member(1, GROUP_RUNS[0], ['done', 'done', 'done', 'done']), member(2, GROUP_RUNS[1], ['done', 'done', 'done', 'done']), { key: 'pr', label: 'PRs', subs: [s('#959', 'review'), s('#960', 'review')] }] }),
    userGroup('group-ready', 'Group, ready', ['ready', 'ready'], { state: 'featureone', n: 2, flow: GROUP_SHIP, stack: { mode: 'create', separate: true, runs: GROUP_RUNS, rec: 'stack', sizes: ['+120 −40', '+38 −22'], reason: 'independent tasks, so each gets its own review. They also combine cleanly, so One PR is open to you.' } }),
    userGroup('group-checking', 'Group, One PR being checked', ['ready', 'ready'], { state: 'featureone', n: 2, flow: Object.assign({ next: 'group-ready', event: 'The runs combine cleanly' }, GROUP_SHIP), stack: { mode: 'create', separate: true, runs: GROUP_RUNS, rec: 'stack', sizes: ['+120 −40', '+38 −22'], oneBlocked: 'Checking whether the tasks combine…', reason: 'each task has its own PR until the check says they combine.' } }),
    { id: 'workspace-fixing', group: 'Kinds', label: 'Workspace, fixing', detail: 'Fixing worca-docs #31’s conflicts', branch: 'feat/billing-export', project: 'billing workspace', repos: ['worca-api', 'worca-web', 'worca-docs'], figs: [['Time', '3h 05m'], ['Cost', '$52.70']],
      stages: run({ tail: [{ key: 'pr', label: 'PRs', subs: [s('worca-api #212', 'merged', '', { live: 'Merged into main' }), s('worca-web #88', 'now', '', { live: 'Checks running · 5 of 7' }), s('worca-docs #31', 'now', '', { live: 'Fixing the conflicts', when: 'now' })] }, { key: 'merged', label: 'Merged', subs: [s('1 of 3 repositories', 'next', '', { live: 'worca-api is in main' })] }] }) },
    { id: 'workspace-partly', group: 'Kinds', label: 'Workspace, partly shipped', detail: '1 of 2 merged · worca-docs has no PR yet', branch: 'feat/billing-export', project: 'billing workspace', repos: ['worca-api', 'worca-web', 'worca-docs'], figs: [['Time', '3h 05m'], ['Cost', '$52.70']],
      stages: run({ tail: [{ key: 'pr', label: 'PRs', subs: [s('worca-api #212', 'merged', '', { live: 'Merged into main · Watch off' }), ok('worca-web', '', { live: 'No changes in this repository' }), next('worca-docs', { live: 'No PR yet' })] }, { key: 'merged', label: 'Merged', subs: [s('1 of 2 repositories', 'next', '', { live: 'worca-api is in main' })] }] }) },
  ];
  // A case's facts are its own; its state's word, colour and one action are the library's.
  const CTX = { pr: '#959', pr2: '#960', pr3: '#961', base: 'dev', branch: 'feat/unified-page-navigation-one-head-breadcrumb', groupBranch: 'feat/unified-page-navigation', source: SRC, hidden: 'worca/run-7b0bfb1e', folder: '~/src/marketing-site', worktree: '~/.worca-cc/worktrees/run-7b0bfb1e', at: '14:00' };
  const ctxOf = (c) => Object.assign({}, CTX, c.at ? { at: c.at } : {}, c.n ? { n: c.n } : {}, c.k ? { k: c.k } : {}, c.host ? { host: c.host } : {}, c.extraItems ? { extraItems: c.extraItems } : {});
  const CASES = CASES0.concat(CASES1).map((c) => Object.assign({}, R.runState(c.state || c.id, ctxOf(c)), c));

  // The stack: the PRs of a feature or chain, in merge order, each based on the one above it.
  const outlineRows = (titles) => titles.map((t, i) => ({ num: String(i + 1), title: t, state: 'next', word: ['Small', 'Medium', 'Small'][i] || 'Small', sub: i ? 'Builds on task ' + i : 'Starts from dev', editable: true, index: i }));
  const STACKS = {
    outline: (titles) => ({ title: titles.length + ' tasks, one PR each', note: 'Each task builds on the one before', rows: outlineRows(titles) }),
    create: () => ({ title: 'Ship as', choice: true }),
  };
  // A stack in review merges one PR at a time, in order. Each PR's state: ready, review, checks (moved onto dev, checks
  // running again), failing, merged. Merging one makes Worca move the next onto dev (today nothing does: it keeps
  // pointing at the merged branch unless GitHub deletes that branch).
  const CHAIN_PRS = [['#959', '+278 \u221264'], ['#960', '+41 \u221258'], ['#961', '+39 \u221222']];
  const CHAIN_START = ['ready', 'review', 'failing'];
  const PR_LOOK = { fixing: ['review', 'Fixing checks', 'a short task is fixing them'], ready: ['done', R.runState('approved').word, ''], review: ['review', R.runState('checks').word, '5 of 7 checks'],
    checks: ['review', 'Checks running', 'moved onto dev · checks run again'], failing: ['problem', 'Checks failing', '2 failed'], merged: ['merged', 'Merged', 'merged'] };
  const chainBase = (st, i) => (i === 0 || st[i - 1] === 'merged' ? 'dev' : CHAIN_PRS[i - 1][0]);
  function reviewOf(st) {
    const k = st.indexOf(st.find((x) => x !== 'merged'));
    return { title: 'Merge in order', rows: CHAIN_PRS.map(([num, size], i) => { const [state, word, sub] = PR_LOOK[st[i]];
      const base = chainBase(st, i); const moved = st[i] === 'checks' && i > 0 && base === 'dev';
      return { num, title: RUNS[i], state, word, sub: st[i] === 'merged' ? 'Into dev' : ['Into ' + base, size, st[i] === 'checks' && !moved ? 'checks run again' : sub].filter(Boolean).join(' · '), isNext: i === k }; }) };
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
    task: 'One head for the task and group pages: Back, the breadcrumb and the task’s actions in the top bar, and the page title once.',
    // Before you ship: what needs your eyes, each with why it is there and its one way to act.
    check: [{ t: 'On phones under 600px only Back shows, not the breadcrumb: try it on a phone', why: 'Worca decided this while you were away', act: 'Change it', go: 'tab:decisions' },
      { t: 'Back on a group page now goes to Runs, not the group list', why: 'A change you did not ask for' },
      { t: 'run-head.mjs is new and has 2 review notes', why: 'The largest change', act: 'Open it', go: 'file:0' }],
    // The ask, part by part, with what was done; and what it did unasked.
    ask: [['One head for the task and group pages', 'The breadcrumb, the title and the actions share one row'],
      ['Back, the breadcrumb and the actions in the top bar', 'Back became the breadcrumb: it goes up a level'],
      ['The page title once', 'The title row holds it; the bar no longer repeats it']],
    unasked: ['14 new tests', 'test/ui-run-head.test.mjs'],
    artifacts: [['plan.md', 'Plan'], ['review-3.md', 'Review implementation'], ['checklist.md', 'Manual tests checklist']],
    files: [['ui/public/run-head.mjs', 182, 64], ['ui/public/style.css', 41, 58], ['ui/public/app.js', 27, 19], ['ui/public/nav/routes.mjs', 12, 3], ['test/ui-run-head.test.mjs', 96, 0]],
    // Per file: added or modified, review comments, and the first hunk shown when the file opens.
    fileMeta: { 'ui/public/run-head.mjs': { st: 'A', notes: 2 }, 'test/ui-run-head.test.mjs': { st: 'A' }, 'ui/public/nav/routes.mjs': { st: 'M', notes: 1 } },
    hunk: { at: '@@ ui/public/app.js:36,380', lines: [[' ', 'function paintRunHead(run, el) {'], ['-', '  el.append(backButton(run));'], ['-', '  el.append(groupList(run));'], ['+', '  el.append(breadcrumb(ROUTES.parentOf(run)));'], ['+', '  el.append(titleRow(run), actions(run));'], [' ', '}']] },
    // What the task says it did, once Build has made something.
    outcome: ['Run and group pages share one head: the breadcrumb, the title and the actions', 'Back is gone from group pages; the breadcrumb goes up a level', 'Under 760px the bar shows one link, ‹ Parent name', '14 new tests in test/ui-run-head.test.mjs'],
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
    // What Generate drafts: the task's own summary, its changes and how it was checked (the AI draft, as today).
    prBody: (title, files) => ['## Summary', ...DETAIL.outcome.map((x) => '- ' + x), '', '## Changes', ...files.map(([f, a, d]) => '- `' + f + '` +' + a + ' \u2212' + d), '',
      '## How it was checked', '- 14 new tests in test/ui-run-head.test.mjs', '- Review implementation: 3 rounds, no open issues', '- Manual web UI testing at 375px and 900px', '', 'Closes #942'].join('\n'),
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
    // The question a task is waiting on: the options Worca offers, the one it would pick, and why.
    asks: {
      question: { q: 'Keep the breadcrumb on phones under 600px, or show only Back there?', why: 'Review implementation found the trail wraps to two lines at 375px.',
        options: ['Keep the full breadcrumb, truncate the middle crumbs', 'Show only ‹ Parent under 600px', 'Hide the breadcrumb on phones'], pick: 1 },
      clarify: { questions: [{ q: 'Which pages get the breadcrumb?', why: 'The task names the task page; group and saved run pages share its head.', options: ['Run pages only', 'Run and group pages', 'Every page with a parent'], pick: 1 },
        { q: 'What does Back do on a group page?', why: 'Today it goes to the group list; the breadcrumb already does that.', options: ['Goes to Runs', 'Goes to the group list'], pick: 0 },
        { q: 'What shows on phones?', why: 'The full trail wraps to two lines at 375px.', options: ['The full trail', 'Only ‹ Parent'], pick: 1 }] },
      requirements: { q: 'On phones, does the page keep its full trail?', why: 'Security and Design disagree · 4 requirements agreed by the reviewers', options: ['Keep the full trail', 'Show only ‹ Parent under 600px'], pick: 1 },
      auto: { kind: 'auto', q: 'Run this workflow?', why: 'A medium change in two areas, with UI: Worca adds a plan review and a manual test, and leaves out the security review.' } },
    budget: 120,
    // What the plan answers to: the requirements the perspectives agreed, and the one that needs you.
    criteria: [['R-po-1', 'Run and group pages share one head'], ['R-po-2', 'The breadcrumb goes up one level, never to the page itself'], ['R-po-3', 'Under 760px the bar shows one link, ‹ Parent name'], ['R-sec-1', 'No route exposes another person’s run']],
    // What a reviewer asked to change on the PR.
    requested: [{ sev: 'Change', t: 'Keep the group list reachable from a group page', at: 'ui/public/run-head.mjs:41' }, { sev: 'Change', t: 'Name the new test after the page it covers', at: 'test/ui-run-head.test.mjs:12' }],
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
    tunables: [['Review cycles', '3', 'How many times Review may send it back'], ['Cost cap', '$120', 'Pauses the task here'], ['Step time limit', '1h', 'Pauses a step that runs longer'], ['Model for Build', 'Opus 5.5', 'From the task’s size']],
    autoWhy: 'A medium change in two areas, with UI: Worca adds a plan review and a manual test, and leaves out the security review.',
    costOther: [['Away mode', '$0.32'], ['Auto workflow', '$0.12'], ['Run title', '$0.01']],
    costApart: [['Reviews you stopped', 'at least $0.20'], ['Agent turns you stopped', 'at least $1.10']],
    docBody: { 'plan.md': '## The plan\n- Add ROUTES.parentOf for run, group and slice pages\n- Build the breadcrumb from the parent chain\n- Move Back, Pause and Stop into the top bar\n- One title row: title, kind chip, actions\n- Phone: ‹ Parent under 760px\n- Tests for every page type', 'review-3.md': '## Review, round 3\nPassed. One minor note: the trail wraps at 375px.', 'checklist.md': '## Manual tests\n- Run page at 375px\n- Group page at 900px\n- Saved run with no live parent' },
  };
  // What a failed or blocked step shows in Activity: what broke, the last lines, and where in the log.
  const EVIDENCE = {
    'build/Implementation': { title: '3 tests failed in test/ui-run-head.test.mjs', log: 'Open log at line 1,284',
      lines: ['\u2716 breadcrumb hides under 600px (12ms)', '  AssertionError: expected [ \'Back\' ] to equal [ \'Back\', \'Runs\' ]', '\u2716 group page Back goes to Runs (4ms)', '\u2716 bar keeps one primary (3ms)'] },
    'pr/Checks/one': { title: '1 check failed: e2e', log: 'Open the failing check', lines: ['e2e  \u2716 run page at 375px: breadcrumb overflows by 18px'] },
    'pr/Checks': { title: '2 checks failed: unit, e2e', log: 'Open the failing check',
      lines: ['unit \u2716 test/ui-run-head.test.mjs \u203a bar keeps one primary', 'e2e  \u2716 run page at 375px: breadcrumb overflows by 18px'] },
    'review/Manual web UI testing': { title: 'The end-of-run commit failed', log: 'Open the hook output',
      lines: ['pre-commit: eslint ui/public/run-head.mjs', '  41:7  error  \'crumbs\' is assigned but never used', 'hook exited 1 · nothing committed; the work is kept in a copy'] },
    'pr/Conflicts with dev': { title: 'Conflicts in 2 files', log: 'Open the conflicts',
      lines: ['ui/public/app.js  lines 36,380\u201336,412', 'ui/public/style.css  lines 5,210\u20135,214'] },
  };
  const money = (v) => parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0;

  // A form behind a step: its words and its one field or choice (docs/rail/forms.md).
  const FORMS = {
    model: { title: 'Switch model', yes: 'Resume', text: 'Every remaining step runs on the model you pick; the task resumes from {step}.', options: ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5'], pick: 1 },
    'resume-at': { title: 'Resume at a time', yes: 'Schedule the resume', text: 'The task stays paused until then, and you can cancel it.', field: { label: 'Time', value: '15:30', hint: 'Today, in your time zone', time: true } },
    report: { title: 'Report this task', yes: 'Send report', text: 'Sends the task’s logs and your note to the Worca team.', field: { label: 'Note', value: '', hint: 'What went wrong, or what you expected', multiline: true } },
    cap: { title: 'Raise the cap', yes: 'Raise it and go on', text: 'A new cost cap for this task; it goes on from {step}.', field: { label: 'New cap', value: '$180', hint: 'It is at $120' } },
    'team-cap': { title: 'Continue past team cap', yes: 'Continue past the cap', text: 'Your team’s cap is $200 a run. Going past it is recorded with your reason.', field: { label: 'Reason', value: '', hint: 'Your team’s policy asks for one', required: true } },
    preset: { title: 'Save as preset', yes: 'Save preset', text: 'The next run can start from this task’s setup: its workflow, models and budget.', field: { label: 'Name', value: 'Unified page navigation', required: true } },
  };

  const INSTANCE_HELP = { 'worca-api #212': 'Merged into main', 'worca-web #88': 'Checks running', 'worca-docs #31': 'Conflicts with main' };
  const HELP_OF = (t, ctx) => INSTANCE_HELP[t] || R.actionHelp(t, ctx || CTX);

  // Actions this design introduces that today's app does not have (audit, 26 Oct): each is built for real in the app
  // (stillhet-wiring.md: new, build it); listed with why in the prototype's intro, never marked on the buttons themselves.
  const PROPOSED = [
    ['Send answer', 'A question is answered under its step in the card; today the answer panel sits apart, above the steps.'],
    ['Pause after this step', 'Lets the current step finish before pausing; today Pause stops at once.'],
    ['Fix checks', 'Starts a short task that fixes failing checks, like Fix conflicts does today for conflicts.'],
    ['Re-run checks', 'Runs a PR\'s checks again from Worca; today that is on GitHub.'],
    ['Merge PR', 'Merges from Worca, one PR at a time in stack order, and moves the next PR onto dev; today you merge on GitHub and nothing moves the next PR.'],
    ['Restart Build', 'Runs one stage again with what earlier stages made; today a failed run resumes or starts over.'],
    ['Raise the cap', 'Sets a new cost cap and goes on; today the choices are Continue without cap or Settings.'],
    ['Copy link', 'Copies a link to the task from ⋯, for Chat or an issue.'],
  ];
  const costOf = (y) => money(y.cost !== undefined ? y.cost : COST_OF[y.name] || 0);
  const NEW = new Set(['Merge PR', 'Merge #959', 'Fix checks', 'Re-run checks', 'Fix checks on #961', 'Restart Build', 'Raise the cap', 'Pause after this step', 'Send answer', 'Copy link']);
  const { isDone, stageState, fmtMin, toMin, stageMeta, STAGE_WORD } = R;
  const defaultStage = (c) => R.defaultStage(c.stages, c.stack ? c.stack.mode : '');
  const rowOf = R.stepLook;
  const LIVE = { now: 1, ask: 1, problem: 1, failed: 1, paused: 1, review: 1 };
  // A task inside a group is one record seen from two pages: the group's segment for it and its own page read the same
  // stages, time and cost. On its own page it ships with the group, so its PR stages become one Ship stage (a feature)
  // or stay its PR (a chain), and only fix-it actions stay; creating and merging PRs is the group page's job.
  const SHIP = /^(pr|merged|push|apply|done|ship)$/;
  const SIZE = (t) => { const m = String(t).match(/\+(\d+)\s*\u2212(\d+)/); return m ? [+m[1], +m[2]] : [0, 0]; };
  const sizesOf = (g) => g.sizes || (g.stack && g.stack.sizes) || SIZES;
  // Each task's own files: what its figure adds up from.
  const RUN_FILES = [[['ui/public/run-head.mjs', 182, 64], ['test/ui-run-head.test.mjs', 96, 0]], [['ui/public/style.css', 41, 58]], [['ui/public/app.js', 27, 19], ['ui/public/nav/routes.mjs', 12, 3]]];
  const GROUP_FILES = [[['ui/public/billing/invoices.mjs', 120, 40]], [['ui/public/billing/export.mjs', 38, 22]]];
    const BRANCH = 'feat/unified-page-navigation-one-head-breadcrumb';
  function asMember(c0, g, i) {
    const chain = g.kind === 'Chain'; const groupWord = g.kind.toLowerCase(); const titles = g.runTitles || RUNS;
    let stages = chain ? c0.stages : c0.stages.filter((x) => !SHIP.test(x.key))
      .concat({ key: 'ship', label: 'Ship', subs: [next('With the ' + groupWord, { live: c0.shipLive || 'From the ' + groupWord + ' page, with the other runs' })] });
    // What gets the task moving stays on its page; what ships it is the group's, also in its ▾.
    // A main the group owns gives way to the first step it leaves here (a stopped run's Restart Build).
    const mine = c0.action ? [c0.action.label].concat(c0.action.items).filter(R.memberKeeps) : [];
    const keep = mine.length > 0;
    const kept = keep ? Object.assign({}, c0.action, { label: mine[0], icon: c0.action.label === mine[0] ? c0.action.icon : 'refresh', primary: c0.action.label === mine[0] ? c0.action.primary : true, items: mine.slice(1) }) : null;
    const k = SLICE[i] || 0.3;
    const scaled = (c0.stages).map((st) => Object.assign({}, st, { subs: st.subs.map((x) => (x.time ? Object.assign({}, x, { time: fmtMin(toMin(x.time) * k) }) : x)) }));
    stages = chain ? scaled : scaled.filter((x) => !SHIP.test(x.key)).concat(stages.slice(-1));
    return Object.assign({}, c0, { stages, scale: k, title: titles[i], kind: '', branch: BRANCH + '-' + (i + 1), diff: sizesOf(g)[i], files: g.runTitles ? GROUP_FILES[i] : RUN_FILES[i],
      action: kept, detail: c0.detail || (keep ? '' : chain ? 'Merges in order, from the chain' : c0.word === 'Ready' ? 'Ships with the ' + groupWord : ''),
      pr: chain && g.runPRs ? g.runPRs[i] : '', base: chain && g.runPRs ? (i ? g.runPRs[i - 1] : 'dev') : '', group: g, index: i });
  }
  // A member's case: the group's own, unless something done on its page or the group's moved it on (ui.over).
  const memberRaw = (g, i, ui) => { const id = ((ui && ui.over) || {})[g.id + ':' + i] || (g.runCases || [])[i] || ''; return id && typeof id === 'object' ? id : id ? CASES.find((x) => x.id === id) : null; };
  const memberOf = (g, i, ui) => { const raw = memberRaw(g, i, ui); return raw ? asMember(raw, g, i) : null; };
  const memberCase = (g, i, ui) => memberRaw(g, i, ui) ? 1 : 0;
  const subState = (st) => R.subState(st.subs);
  // A group's run segment: one cell per stage of that run, read from the task itself when it has a page.
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
  // Time is the sum of every step; cost is every step's price, plus each task's own total on a group page.
  function totals(c) {
    const mins = c.stages.reduce((a, x) => a + x.subs.reduce((b, y) => b + (y.time ? toMin(y.time) : 0), 0), 0);
    const cost = c.stages.reduce((a, x) => a + (x.run ? (x.member ? totals(resolve(x.member)).cost : 0)
      : x.subs.reduce((b, y) => b + (y.state === 'next' ? 0 : costOf(y)), 0) * (c.scale || 1)), 0);
    return { mins, cost };
  }
  // Overview reports by exception: it leads with what this state needs from you (an answer, a plan to approve, what
  // broke, or what to check); a running run shows its plan's progress. What went fine is one line each once it is
  // built: the ask, and the evidence (left out when the focus is what broke: that is the evidence). Files and documents
  // are Changes'.
  // act.this-thing: a seeded task's own branch, ask and plan (shell/world.js); a page with none keeps its case's.
  const seedOf = (c) => window.RunCardModel?.seeds?.[(c.movedFrom && c.title) || TITLES[c.id] || c.title] || null;
  function overview(c, live, ui) {
    const PLAN_ITEMS = seedOf(c)?.plan || DETAIL.plan;
    const built = c.stages.some((x) => x.key === 'build' && x.subs.some(isDone));
    const planDone = c.stages.some((x) => x.key === 'plan' && x.subs.every(isDone));
    const buildLive = c.stages.some((x) => x.key === 'build' && x.subs.some((y) => LIVE[y.state]));
    const clean = c.stages.filter((x) => !SHIP.test(x.key)).every((x) => x.subs.every(isDone));
    const ev = c.ev ? c.ev : c.id === 'kept' ? EVIDENCE['review/Manual web UI testing'] : c.id === 'failed' ? EVIDENCE['build/Implementation'] : c.id === 'failing' ? EVIDENCE['pr/Checks'] : /^(conflicts|workspace)$/.test(c.id) ? EVIDENCE['pr/Conflicts with dev'] : null;
    let focus = null;
    if (c.id === 'plan') focus = { kind: 'plan', items: PLAN_ITEMS.map((t) => ({ t, state: 'next' })), issues: ui && ui.fixed && ui.fixed.plan ? [] : DETAIL.planIssues };
    else if (c.reqsCheck) focus = { kind: 'reqs', items: DETAIL.criteria, left: reqLeft(ui) };
    else if (c.id === 'requirements') focus = { kind: 'criteria', items: DETAIL.criteria };
    else if (c.id === 'gate') focus = { kind: 'findings', title: 'What Review still holds open', issues: DETAIL.issues, roles: DETAIL.roles };
    else if (c.requested) focus = { kind: 'findings', title: 'What the reviewer asked', issues: DETAIL.requested, roles: [] };
    else if (c.issues) focus = { kind: 'findings', title: '2 open issues', note: 'A review ran out of cycles with these open, and the task went on past them', issues: DETAIL.issues, roles: DETAIL.roles };
    else if (ev) focus = { kind: 'broke', ev };
    else if (planDone && !c.runCases && (buildLive || c.stages.some((x) => x.key === 'review' && x.subs.some((y) => LIVE[y.state])))) {
      const doneN = buildLive ? 3 : PLAN_ITEMS.length;
      const moving = !/^(Paused|Stopped)$/.test(c.word);   // a task held up is not working on its next item
      focus = { kind: 'progress', note: buildLive ? doneN + ' of ' + PLAN_ITEMS.length + ' built' : 'all ' + PLAN_ITEMS.length + ' built · now in Review', items: PLAN_ITEMS.map((t, i) => ({ t, state: i < doneN ? 'done' : i === doneN ? (moving ? 'now' : 'paused') : 'next' })) };
    } else if (built && !c.runCases && !c.mock && !/^(Failed|Merged|Archived|Discarded|Deleted|Applied|Stopped|Finished|Closed|Abandoned|Declined)$/.test(c.word)) focus = { kind: 'check', items: DETAIL.check, title: prOpen(c) ? 'Before you merge' : 'Before you ship' };
    const areas = {};
    if (built && !c.noDiff) DETAIL.files.forEach(([f, a, d]) => { const k = f.slice(0, f.lastIndexOf('/') + 1); const x = areas[k] || (areas[k] = { dir: k, n: 0, add: 0, del: 0 }); x.n++; x.add += a; x.del += d; });
    const max = Math.max(1, ...Object.values(areas).map((x) => x.add + x.del));
    const rounds = DETAIL.rounds['Review implementation'].length;
    const done = built && !live;
    return { focus, checklist: c.shaped || c.id === 'gate' ? DETAIL.checklist : null, outcome: done ? c.outcome || DETAIL.outcome : [], task: seedOf(c)?.ask || c.task || DETAIL.task,   // what it did, once it is done
      // It says it did what you asked only when everything ran, nothing stayed open, and there is a change to show for it.
      ask: done && clean && !c.issues && !c.noDiff && !c.mock && !c.evidence && !/^(Archived|Discarded|Deleted)$/.test(c.word) ? { parts: DETAIL.ask, unasked: DETAIL.unasked } : null,
      evidence: !done || c.mock || (focus && focus.kind === 'broke') ? '' : c.evidence || (clean ? `Tests pass · Review passed on round ${rounds} · Manual test passed` : ''),
      areas: Object.values(areas).map((x) => Object.assign(x, { pct: Math.round(((x.add + x.del) / max) * 100) })),
      artifacts: DETAIL.artifacts.filter(([, step]) => c.stages.some((x) => x.subs.some((y) => y.name === step && y.state !== 'next'))) };
  }
  // A feature reads from the task that holds it up: failed first, then one that asks, one paused, one stopped.
  const HOLD = [['Failed', 'group-failed', (k, n) => 'Task ' + k + ' of ' + n + ' · failed'], [R.runState('group-needs').word, 'group-needs', (k, n) => 'Task ' + k + ' of ' + n + ' · needs you'],
    ['Paused', 'group-paused', (k, n, m) => 'Task ' + k + ' of ' + n + ' · ' + ((m.detail || 'paused').split(' · ')[0].toLowerCase())], ['Stopped', 'group-stopped', (k) => 'Stopped at task ' + k]];
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
    return !rows.length ? rows : rows.concat([{ name: 'Away mode answers', type: 'Worca', model: 'Sonnet 5.5', cycle: '1', tokens: '4k', skills: '0', graph: '0' }, { name: 'Run title', type: 'Worca', model: 'Haiku 5.5', cycle: '1', tokens: '1k', skills: '0', graph: '0' }]);
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
  // A decision exists once its step has run; on a group, once the plan is done.
  const decisionsOf = (c, runStages) => (c.decisions && (!runStages.length || runStages.some((x) => x.subs.some(isDone))) ? c.decisions : c.decisions ? [] : runStages.length ? (runStages.some((x) => x.subs.some(isDone)) ? DETAIL.decisions : []) : DETAIL.decisions.filter((d) => c.stages.some((x) => x.subs.some((y) => y.name === d.step && isDone(y)))));
  function prOpen(c) { return c.stages.some((x) => x.key === 'pr' && x.subs[0] && x.subs[0].name === 'Create PR' && isDone(x.subs[0])); }


  // An action moves THIS run (docs/rail/thing-page.md: One task, moving). The target case supplies only its state, its word,
  // its detail and what its state changes; the title, the time and cost its steps add up to, the branch and the PR are the
  // run's own, here and nowhere else. A task you paused remembers where it was, and an archived one what it was.
  const RUN_FACTS = ['title', 'task', 'decisions', 'outcome', 'branch', 'folder', 'project', 'repos', 'onSource', 'hidden', 'host', 'noDiff', 'noSetup', 'noTry', 'mock', 'hosted', 'heldBy', 'agentsUnknown', 'dependents', 'shaped', 'budget', 'files', 'diff', 'figs', 'at', 'base', 'pr', 'shipLive', 'sizes', 'parent'];
  const GROUP_FACTS = ['title', 'task', 'decisions', 'kind', 'runTitles', 'independent', 'n', 'figs', 'sizes'];
  const caseFor = (to) => CASES.find((x) => x.id === to) || CASES.find((x) => (x.state || x.id) === to);
  const stepMap = (stages, fn) => stages.map((st) => (SHIP.test(st.key) ? st : Object.assign({}, st, { subs: st.subs.map(fn) })));
  const STARTED = { live: 'Under way', when: 'now', time: '', cost: '$0.00' };
  const hold = (stages, state, live) => stepMap(stages, (y) => (LIVE[y.state] ? Object.assign({}, y, { state, live, when: '' }) : y));
  const wake = (stages) => stepMap(stages, (y) => (LIVE[y.state] && (y.state !== 'now' || /^Waiting/.test(y.live)) ? Object.assign({}, y, { state: 'now', live: 'Going on', when: 'now' }) : y));
  // What was live is done; the next step starts, in the stage named or the next one that has steps left; steps skipped on the way do not count.
  function advance(stages, toKey) {
    let seen = false, placed = false;
    return stages.map((st) => {
      if (SHIP.test(st.key)) return st;
      const subs = [];
      for (const y of st.subs) {
        if (LIVE[y.state]) { seen = true; subs.push(Object.assign({}, y, { state: 'done', live: '', when: '' })); continue; }
        if (seen && !placed && y.state === 'next') {
          if (!toKey || st.key === toKey) { placed = true; subs.push(Object.assign({}, y, STARTED)); continue; }
          continue;
        }
        subs.push(y);
      }
      return Object.assign({}, st, { subs: subs.length ? subs : st.subs.slice(0, 1) });
    });
  }
  const allAhead = (subs) => subs.map((y) => Object.assign({}, y, { state: 'next', live: '', when: '', time: '', loops: 0 }));
  // A stage runs again: its first step starts, what it spent stays on the page, what came after waits again.
  function restart(stages, key) {
    const k = stages.findIndex((st) => st.key === key); if (k < 0) return wake(stages);
    // Spending stays spent: what the steps it wipes took stays in the step that runs again.
    const undone = stages.slice(k).flatMap((st) => st.subs).filter((y) => y.state !== 'next');
    const cost = undone.reduce((a, y) => a + costOf(y), 0); const mins = undone.reduce((a, y) => a + (y.time ? toMin(y.time) : 0), 0);
    return stages.map((st, i) => {
      if (i < k) return st;
      if (i > k) return Object.assign({}, st, { subs: allAhead(st.subs) });
      const [a, ...rest] = st.subs;
      return Object.assign({}, st, { subs: [Object.assign({}, a, { state: 'now', live: 'Running again', when: 'now', loops: (a.loops || 1) + 1, cost: '$' + cost.toFixed(2), time: mins ? fmtMin(mins) : a.time })].concat(allAhead(rest)) });
    });
  }
  // A new run with the same task: nothing spent, nothing made.
  function freshRun(stages) { let first = true; return stages.map((st) => Object.assign({}, st, { subs: st.subs.map((y) => { const n = Object.assign({}, y, { state: 'next', live: '', when: '', time: '', loops: 0, cost: undefined }); if (first && !SHIP.test(st.key)) { first = false; return Object.assign(n, { state: 'now', live: 'Setting up the worktree', when: 'now', cost: '$0.00' }); } return n; }) })); }
  const finish = (stages) => stepMap(stages, (y) => (isDone(y) ? y : Object.assign({}, y, { state: 'done', live: '', when: '' })));
  const tailOf = (c) => c.stages.filter((st) => SHIP.test(st.key));
  const workOf = (stages) => stages.filter((st) => !SHIP.test(st.key));
  const landed = (stages) => stages.map((st) => (SHIP.test(st.key) ? Object.assign({}, st, { subs: st.subs.map((y) => (isDone(y) ? y : Object.assign({}, y, { state: 'merged', live: 'Pushed' }))) }) : st));
  // Where a task lands when its work is done depends on what it is.
  const readyOf = (c) => (c.folder ? 'folder' : c.onSource ? 'source-ready' : c.branch === 'main' ? 'push' : 'ready');
  const LIVE_STATES = /^(working|starting|slice|source|feature|network)$/;
  const BEFORE_BUILD = /^(clarify|requirements|plan|outline|auto)$/;
  function movedSteps(raw, t, f) {
    const state = t.state || t.id; const step = f.step || '';
    if (step === 'fresh') return freshRun(raw.stages);
    if (step === 'land') return landed(raw.stages);
    if (step.startsWith('restart:')) return restart(raw.stages, step.slice(8));
    if (step.startsWith('advance:')) return advance(raw.stages, step.slice(8));
    if (step === 'pause-after') return hold(advance(raw.stages), 'paused', 'Paused by you');
    if (BEFORE_BUILD.test(state) || /^(plan|outline)-fixing$/.test(state)) return t.stages;
    if (state === 'paused-you') return hold(raw.stages, 'paused', 'Paused by you');
    if (state === 'stopped') return hold(raw.stages, 'paused', 'Stopped by you');
    if (state === 'starting' && !raw.stages.some((st) => st.subs.some((y) => LIVE[y.state]))) return freshRun(raw.stages);
    if (LIVE_STATES.test(state)) return raw.stages.some((st) => st.subs.some((y) => y.state === 'ask')) || state === 'starting' ? advance(raw.stages) : wake(raw.stages);
    if (state === 'discarded') return workOf(raw.stages).concat(tailOf(t));
    // What ships next: the steps are finished if they were not, and what lies ahead is the new state's.
    const ships = workOf(t.stages).every((st) => st.subs.every(isDone));
    if (!ships || /^(archived|deleted|cancelled)$/.test(state)) return raw.stages;
    const held = /^(Failed|Stopped)$/.test(raw.word);
    return (held ? workOf(raw.stages) : workOf(finish(raw.stages))).concat(tailOf(t));
  }
  function moveGroup(raw, t, to, f, ctx) {
    const facts = Object.fromEntries(GROUP_FACTS.map((k) => [k, raw[k]]));
    if (to === 'outline') return Object.assign({}, t, { title: raw.title, spent: totals(resolve(raw)) });   // what is left is planned again: what it spent stays on the page
    const runs = raw.stages.filter((st) => !SHIP.test(st.key));
    if (to === 'discarded') return Object.assign({}, t, facts, { runCases: raw.runCases.map((x) => (x ? 'discarded' : '')), action: null, stages: runs.concat(tailOf(t)) });
    if (to === 'archived') return Object.assign({}, t, facts, { runCases: raw.runCases, stages: raw.stages, action: null, restoreTo: raw });
    const runCases = f.startsRun ? raw.runCases.map((x, i) => (i === (raw.k || 1) - 1 ? 'slice' : x)) : (t.runCases || raw.runCases);
    return Object.assign({}, t, facts, { runCases, runPRs: t.runPRs || raw.runPRs, stages: runs.concat(t.stages.filter((st) => SHIP.test(st.key)).length ? t.stages.filter((st) => SHIP.test(st.key)) : tailOf(raw)), stack: t.stack ? Object.assign({}, t.stack, raw.stack && raw.stack.runs ? { runs: raw.stack.runs, sizes: raw.stack.sizes } : {}) : undefined });
  }
  /** This run after an action: `raw` is where it is, `to` the state it moves to. */
  function move(raw, to0, f = {}) {
    const to = to0 === 'ready' ? readyOf(raw) : to0;
    const t = caseFor(to); if (!t) throw new Error(`no run case for ${to}`);
    if (raw.runCases) return Object.assign(moveGroup(raw, t, to, f), { movedFrom: raw.id });
    // Resume goes back to where it was: its own step, its own state.
    if (raw.resumeTo && LIVE_STATES.test(t.state || t.id) && !f.step) return raw.resumeTo;
    const facts = Object.fromEntries(RUN_FACTS.map((k) => [k, raw[k]]));
    if (t.runCases) return Object.assign({}, t, { title: raw.title || TITLES[raw.id] || NAMELESS, movedFrom: raw.id });   // a plan cut into runs is a group from here on
    const held = /^(paused-you|paused-at|paused)$/.test(t.state || t.id);
    const atNow = f.value && (t.state || t.id) === 'paused-at' ? f.value.padStart(5, '0') : raw.at;   // the time you chose names its button, not the fixture's
    return Object.assign({}, t, facts, atNow && atNow !== t.at ? { action: R.runState(t.state || t.id, ctxOf({ ...t, at: atNow })).action } : {}, { title: TITLES[raw.id] || raw.title || NAMELESS, at: atNow, stages: movedSteps(raw, t, f), movedFrom: raw.id, figs: f.step === 'fresh' ? t.figs : raw.figs, spent: raw.spent,
      resumeTo: held ? (raw.resumeTo || (LIVE_STATES.test(raw.state || raw.id) ? raw : undefined)) : undefined, restoreTo: to === 'archived' ? raw : undefined });
  }
  // Where a case is now: its own fixture, or what actions made of it.
  const rawOf = (caseId, ui) => (ui && ui.run && ui.run.id === caseId ? ui.run : CASES.find((x) => x.id === caseId) || CASES[1]);

  // ui: { open: stage key | null, chips: [{kind, text}], ship: 'stack' | 'one', parent: { caseId, index }, run: this task as actions moved it }
  function view(caseId, ui) {
    ui = ui || {};
    const c0 = rawOf(caseId, ui);
    const par = ui.parent || c0.parent || null;
    const g = par ? (ui.groupRun && ui.groupRun.id === par.caseId ? ui.groupRun : CASES.find((x) => x.id === par.caseId)) : null;
    let c = resolve(g ? asMember(c0, g, par.index) : c0, ui);
    const seed = seedOf(c);
    if (seed) c = Object.assign({}, c, { stages: c.stages.map((st) => Object.assign({}, st, { subs: st.subs.map((x) => (x.live && /breadcrumb/i.test(x.live) ? Object.assign({}, x, { live: x.state === 'ask' && seed.question ? seed.question.q : seed.plan[Math.min(2, seed.plan.length - 1)] }) : x)) })) });
    // A group held up by one of its runs reads from that run, and says which.
    const hold = groupHold(c);
    let stateId = c.state || c.id;
    if (hold) { const h = R.runState(hold.state, Object.assign({}, ctxOf(c), { k: hold.k })); stateId = hold.state; c = Object.assign({}, c, { word: h.word, dot: h.dot, sym: h.sym, action: h.action, detail: hold.detail, k: hold.k }); }
    if (c.shipWaiting) c = Object.assign({}, c, { stages: c.stages.map((st) => (st.key === 'pr' ? Object.assign({}, st, { subs: st.subs.map((x) => Object.assign({}, x, { live: c.shipWaiting })) }) : st)) });
    if (c.id === 'plan' && ui.fixed && ui.fixed.plan) c = Object.assign({}, c, { stages: c.stages.map((st) => Object.assign({}, st, { subs: st.subs.map((x) => (x.live ? Object.assign({}, x, { live: x.live.replace('2 open issues', 'issues fixed') }) : x)) })) });
    // Watch is a row in the PR's stage: it follows the switch, not only a toast.
    const watching = ui.watched === null || ui.watched === undefined ? c.stages.some((st) => st.key === 'pr' && st.subs.some((x) => x.name === 'Watch' && x.state === 'now')) : ui.watched;
    if (ui.watched !== null && ui.watched !== undefined && !c.watchOff) c = Object.assign({}, c, { stages: c.stages.map((st) => { if (st.key !== 'pr') return st; const rest = st.subs.filter((x) => x.name !== 'Watch'); return Object.assign({}, st, { subs: watching ? rest.concat(s('Watch', 'now', '', { live: 'Watching · fixes failing checks' })) : rest }); }) });
    const published = !!(ui.fixed && ui.fixed.published);
    if (published && /^Ready$/.test(c.word) && !c.detail) c = Object.assign({}, c, { detail: 'On origin · no PR yet' });
    const clarifying = c.id === 'clarify' ? DETAIL.asks.clarify.questions : null;
    const qIndex = clarifying ? Math.min(ui.question || 0, clarifying.length - 1) : 0;
    if (clarifying && qIndex < clarifying.length - 1) c = Object.assign({}, c, { action: Object.assign({}, c.action, { label: 'Next question', icon: 'chevron', items: c.action.items.concat(qIndex ? ['Previous question'] : []) }) });
    else if (clarifying && qIndex) c = Object.assign({}, c, { action: Object.assign({}, c.action, { items: c.action.items.concat('Previous question') }) });
    const outlineN = c.stack && c.stack.mode === 'outline' ? (ui.outline || RUNS).length : 0;
    const left = c.reqsCheck ? reqLeft(ui) : 0;
    if (c.reqsCheck && left) c = Object.assign({}, c, { detail: 'Mark every requirement before you create the PR · ' + left + ' left' });
    const heldStep = c.stages.flatMap((x) => (SHIP.test(x.key) ? [] : x.subs)).find((y) => LIVE[y.state]);
    const liveCtx = Object.assign({}, ctxOf(c), outlineN ? { n: outlineN } : {}, c.k ? { k: c.k } : {}, { step: heldStep ? heldStep.name : 'the next step' });
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
    const stackWord = sh && sh.separate ? 'separate' : 'stacked';
    const shipWord = (id) => (id === 'one' ? 'one PR' : sh.runs.length + ' ' + stackWord + ' PRs');
    const owned = (sh && sh.owned) || {};
    const toOpen = sh ? sh.runs.length - Object.keys(owned).length : 0;
    if (c.stack && (open === 'pr' || (c.stack.mode === 'outline' && open === 'plan'))) {
      const src = c.stack.mode === 'review' ? reviewOf(chainSt) : STACKS[c.stack.mode](ui.outline || RUNS);
      let rows = src.rows || [];
      let choice = null;
      if (src.choice) {
        const n = sh.runs.length;
        rows = pick === 'one'
          ? [{ num: 'One PR', title: (n === 2 ? 'Both' : 'All ' + n) + ' runs, one branch', state: 'next', word: 'Not opened', sub: 'Into dev' }]
          : sh.runs.map((t, i) => ({ num: owned[i] || 'PR ' + (i + 1), title: t, state: owned[i] ? 'review' : 'next', word: owned[i] ? 'Opened' : 'Not opened', sub: (i && !sh.separate ? 'Into PR ' + i + '’s branch' : 'Into dev') + (sh.sizes ? ' · ' + sh.sizes[i] : '') }));
        choice = { note: (pick === sh.rec ? 'Worca suggests ' + shipWord(sh.rec) : 'You picked ' + shipWord(pick) + '; Worca suggests ' + shipWord(sh.rec)) + ': ' + sh.reason };
      }
      rows = rows.map((r) => Object.assign(rowOf({ state: r.state }), r, { rowCls: 'is-' + r.state + (r.isNext ? ' is-next-up' : ''), total: rows.length }));
      stack = { title: sh ? 'What it opens' : src.title, note: choice ? choice.note : src.note || '', choice: null, rows };
    }
    let action = null;
    const ENDED = /^(Failed|Waiting|Stopped|Cancelled|Discarded|Archived|Deleted)$/;   // a task in one of these has nothing to pause or stop
    const liveNow = !ENDED.test(c.word) && !c.over && !c.stages.filter((x) => !SHIP.test(x.key)).every((x) => x.subs.every(isDone));
    if (!c.action && liveNow && c.word !== 'Paused') c = Object.assign({}, c, { action: A('Pause', 'pause', false, ['Pause after this step']) });
    if (c.action) {
      const label = sh ? (pick === 'one' ? 'Create PR' : 'Create ' + toOpen + ' PRs') : outlineN ? 'Approve ' + outlineN + ' tasks' : c.action.label;
      const liveRun = c.stages.filter((x) => x.run).findIndex((x) => stageState(x.subs) === 'live');
      const offs = Object.assign({}, c.action.off || {});
      if (c.reqsCheck && left) offs[label] = 'Mark every requirement before you create the PR · ' + left + ' left';
      const alt = sh ? [pick === 'one' ? 'Create ' + sh.runs.length + ' ' + stackWord + ' PRs instead' : 'Create one PR instead'] : [];
      if (published) offs['Publish branch'] = 'It is already on origin';
      if (c.watchOff) offs.Watch = c.watchOff;
      const rest = liveNow && c.stages.some((x) => x.run) && c.stages.some((x) => x.run && x.subs.every((y) => y.state === 'next'));
      const stopWord = c.stages.some((x) => x.run) && liveRun >= 0 ? 'Stop task ' + (liveRun + 1) : 'Stop the task';
      // ▾ holds each step once: a group's way to ship is the choice above; a menu never repeats the main.
      const items = alt.concat(c.action.items.filter((t) => !(sh && /^Create (PR|\d+ PRs)$/.test(t)) && t !== label && !(t === 'Fix all' && ui.fixed && ui.fixed[c.id]) && R.shows(R.actionLevel(t)))).concat(liveNow && !c.action.items.includes('Stop') && !c.action.items.includes('Abort') ? [stopWord] : []).concat(rest && !c.action.items.includes('Re-plan the rest') ? ['Re-plan the rest'] : []).concat(rest && !c.action.items.includes('Cancel the rest') ? ['Cancel the rest'] : []);
      const helpOf = (t) => offs[t] || (sh && sh.separate && /^Create \d+ PRs$/.test(t) ? 'Creates one PR per task, each into dev' : '') || HELP_OF(t, liveCtx) || (/^Merge #(\d+)$/.test(t) ? 'Merges ' + t.slice(6) + ' into dev; Worca then moves the next PR onto dev' : /^Fix checks on #/.test(t) ? 'Starts a short task that fixes ' + t.slice(14) + '’s failing checks' : '');
      action = Object.assign({}, c.action, { label, isNew: NEW.has(label), help: helpOf(label), items: items.map((t) => ({ text: t, isNew: NEW.has(t), help: sh && / instead$/.test(t) ? (/one PR/.test(t) && sh.oneBlocked ? 'Not possible: ' + sh.oneBlocked.replace(/^Not possible: /, '') : sh.reason) : helpOf(t), off: !!offs[t] || (/one PR instead/.test(t) && sh && !!sh.oneBlocked), checked: t === 'Watch' ? watching : t === 'Pause after this step' ? !!ui.pauseAfter : undefined })), offWhy: offs[label] || '' });
    }
    // The task is live while any work stage (everything before shipping) is unfinished and it has not failed;
    // waiting on CI, reviewers or a merge is the PR's business, not the task's, so Pause and Stop go. A task waiting on
    // your answer has nothing to pause.
    const work = c.stages.filter((x) => !SHIP.test(x.key));
    const live = !ENDED.test(c.word) && !c.over && !work.every((x) => x.subs.every(isDone));
    const t = c.spent || totals(c);
    const runStages = c.stages.filter((x) => x.run);
    const budget = (c.budget || DETAIL.budget) * Math.max(1, runStages.length);
    if (ui.pauseAfter && live) c = Object.assign({}, c, { detail: 'Pauses after ' + liveCtx.step + (c.detail ? ' · ' + c.detail : '') });
    // What this state can truthfully show. Never started means nothing spent, nothing made and nothing decided; gone is gone.
    const started = c.stages.some((x) => x.subs.some((y) => y.state !== 'next')) || runStages.some((x) => x.member);
    const gone = { Archived: 'archived', Discarded: 'discarded', Deleted: 'deleted' }[c.word] || '';
    const buildStarted = c.stages.some((x) => x.key === 'build' && x.subs.some((y) => y.state !== 'next'));
    const hasChanges = !c.noDiff && !runStages.length && buildStarted;
    const groupBuilt = runStages.filter((x) => x.subs.some((y) => y.name === 'Build' && y.state !== 'next')).map((x) => +x.key.slice(3) - 1);
    const logsGone = gone === 'archived' || gone === 'deleted';
    const files = c.files || DETAIL.files;
    // Where you are: Runs › the place (project, folder or workspace) › the group. The page itself is never a crumb.
    const place = c.folder ? c.folder.split('/').pop() : c.project === '' ? '' : c.project || 'worca-cc';
    const crumbs = [{ t: 'Tasks' }].concat(place ? [{ t: place }] : [])
      .concat(g ? [{ t: g.title, go: { caseId: g.id, open: 'run' + (par.index + 1) } }] : [])
      .concat((ui.chips || []).filter((x) => x.kind === 'group').map((x) => ({ t: x.text, group: true })));   // a group added with +
    const sibling = (j) => (g && g.stages.some((x) => x.key === 'run' + (j + 1)) ? { index: j, ok: !!(g.runCases || [])[j] } : null);
    const branch = c.branch === undefined ? seed?.branch || BRANCH : c.branch;
    return {
      bar: { pause: live && c.word !== 'Paused' && c.sym !== 'q', stop: live, more: true, scope: runStages.length ? c.kind.toLowerCase() : '' },
      id: c.id, has: { changes: hasChanges, started, worktree: !gone && started && !!(c.folder || (c.branch === undefined || c.branch)) , try: hasChanges && !gone && !c.noTry && !c.mock, report: !gone && !c.mock && (started || /^Failed$/.test(c.word)), logsGone }, gone,
      title: (c.movedFrom && c.title) || TITLES[c.id] || c.title || NAMELESS,   // a task that moved keeps its own name, not the name of whatever else sits in that state
      kind: runStages.length && c.kind ? c.kind : '',   // the stepper already counts the tasks
      crumbs, pager: g ? { index: par.index, n: g.stages.filter((x) => x.run).length, prev: sibling(par.index - 1), next: sibling(par.index + 1), group: g.id } : null,
      // The place line: where the code lives and where it goes, the PR once it exists. Each part once on the page.
      place: { branch, copy: !!branch && branch !== 'main', base: c.base || (c.onSource ? 'origin' : branch === 'main' ? 'origin/main' : branch ? 'dev' : ''), onSource: !!c.onSource, hidden: seed ? '' : c.hidden || '',
        pr: c.pr !== undefined && c.pr !== '' ? c.pr : prOpen(c) ? '#959' : '', folder: c.folder || '', repos: c.repos || [],
        merged: c.stages.some((x) => x.key === 'merged' && x.subs.length && x.subs.every((y) => y.state === 'merged')), applied: c.word === 'Applied' },
      chips: (ui.chips || []).filter((x) => x.kind !== 'group'), inGroup: !!g || runStages.length > 0, addedGroup: ((ui.chips || []).find((x) => x.kind === 'group') || {}).text || '',
      alert: R.stateIds().includes(stateId) ? R.runState(stateId).alert : undefined, word: c.word, dot: c.dot || '', sym: c.sym || '', detail: R.fill(c.detail || '', Object.assign({}, liveCtx, { branch })), action, archived: !!c.archived,
      finished: !live && !/^(Waiting)$/.test(c.word),
      // Run after, as today: on any run with a project that is not archived or a group; its words follow the state.
      runAfter: c.archived || gone || runStages.length || !place || c.mock || (!started && c.word !== 'Waiting') || (c.action && [c.action.label].concat(c.action.items).includes('Start a new task')) ? null : !live && !/^(Waiting)$/.test(c.word)
        ? { short: 'Run after', label: 'Start a follow-up task', help: 'A new run that builds on this one' }
        : { short: 'Run after', label: 'Schedule a task after this', help: 'A task that starts when this one finishes' },
      stages: c.stages.map((x) => ({ key: x.key, label: x.label, meta: stageMeta(x), selected: x.key === open, live: stageState(x.subs) === 'live',
        aria: [x.label, STAGE_WORD[stageState(x.subs)], stageMeta(x)].filter(Boolean).join(', '),
        cells: x.subs.map((y) => 'is-' + y.state) })),
      open: (() => {
        const rows = stack ? [] : st.subs.map((x, i) => Object.assign(rowOf(x, st.subs[i + 1]), { ref: st.run ? '' : st.key + '/' + x.name }));
        if (!st.run) return { key: open, label: st.label, title: st.title || '', isRun: false, rows, stack };
        // A task inside a group: its stages, its PR once it has one, its cost, and a way in.
        const i = +st.key.slice(3) - 1;
        if (c.stack && c.stack.mode === 'review') {
          const pr = reviewOf(chainSt).rows[i];
          rows.push(Object.assign(rowOf({ state: pr.state }), { name: pr.num, live: [pr.word, pr.sub].filter(Boolean).join(' · ') }));
        }
        return { key: open, label: st.label, title: st.title || '', isRun: true, rows, stack,
          meta: st.member ? '$' + totals(resolve(st.member)).cost.toFixed(2) : '', runIndex: i, canOpen: !!st.member };
      })(),
      // The group's runs, each read from the task itself: the Runs tab, the pager and Open all agree with its page.
      runs: runStages.map((x, i) => {
        const m = x.member;
        return { n: i + 1, title: x.title, word: m ? m.word : 'Waiting', dot: m ? (m.sym === 'q' ? 'is-amber' : m.sym ? 'is-red' : m.dot) : 'is-grey-ring',
          time: stageMeta(x), cost: m ? '$' + totals(resolve(m)).cost.toFixed(2) : '', pr: (c.runPRs || [])[i] || '', canOpen: !!m };
      }),
      figs: c.figs.filter(([k]) => k !== 'Rate').map(([k, v]) => {
        if (k === 'Time') return { k, v: t.mins ? fmtMin(t.mins) : v, title: started ? 'Started 25 Oct, 08:31' : 'Not started yet' };
        if (k !== 'Cost') return { k, v };
        const cost = t.cost ? '$' + t.cost.toFixed(2) : v;
        const pct = Math.round((money(cost) / budget) * 100);
        return { k, v: cost, of: 'of $' + budget, warn: pct >= 80, title: pct + '% of the ' + (runStages.length ? c.kind.toLowerCase() : 'run') + '’s budget' };
      }).concat(gone || c.noDiff || (!buildStarted && !groupBuilt.length) ? [] : [runStages.length ? (() => { const sum = groupBuilt.reduce((a, i) => { const [p, m] = SIZE(sizesOf(c)[i] || '+0 \u22120'); return [a[0] + p, a[1] + m]; }, [0, 0]); return { k: 'Changes', v: '+' + sum[0] + ' \u2212' + sum[1], tab: '' }; })()
        : { k: 'Changes', v: c.diff || '+' + files.reduce((a, x) => a + x[1], 0) + ' \u2212' + files.reduce((a, x) => a + x[2], 0), tab: 'changes' }]),
      // A tab shows only what exists: no diff before Build, no decisions before anything was decided.
      tabs: (runStages.length ? GROUP_TABS : RUN_TABS).filter(([id]) => (id === 'changes' ? hasChanges : id === 'decisions' ? decisionsOf(c, runStages).length > 0 || !!DETAIL.asks[c.id] : true)).map(([id, l], i, all) => ({ id, l, n: id === 'changes' && !gone ? String(files.length) + (overview(c, live, ui).artifacts.length ? ' · ' + overview(c, live, ui).artifacts.length + ' docs' : '') : id === 'decisions' ? String(decisionsOf(c, runStages).length + (DETAIL.asks[c.id] ? 1 : 0)) : '',
        sel: id === (all.some((x) => x[0] === ui.tab) ? ui.tab : all[0][0]) })),
      activity: c.stages.map((x) => {
        const cost = x.run ? (x.member ? totals(resolve(x.member)).cost : 0) : x.subs.reduce((a, y) => a + (y.state === 'next' ? 0 : costOf(y)), 0) * (c.scale || 1);
        return { key: x.key, label: x.label, title: x.title || '', meta: cost ? '$' + cost.toFixed(2) : '',
          rows: x.subs.map((y, i) => Object.assign(rowOf(y, x.subs[i + 1]), { model: x.run ? '' : MODEL_OF[y.name] || '',
            cost: x.run || y.state === 'next' || !COST_OF[y.name] ? '' : '$' + (costOf(y) * (c.scale || 1)).toFixed(2) + (/^(now|ask|paused)$/.test(y.state) ? ' so far' : ''),
            // the evidence of this state: what this step says went wrong, not a neighbour's
            evidence: /^(failed|problem)$/.test(y.state) ? (x.key === 'pr' && y.name === 'Checks' && /^1 failed/.test(y.live) ? EVIDENCE['pr/Checks/one'] : c.ev && x.key !== 'pr' ? c.ev : EVIDENCE[x.key + '/' + y.name] || null) : null,
            focus: ui.focus === x.key + '/' + y.name, ref: x.key + '/' + y.name })) };
      }),
      tryIt: window.RailWould((() => {
        if (g) return 'copy: git switch ' + BRANCH + '-' + (par.index + 1) + (par.index ? ' · runs 1\u2013' + (par.index + 1) + ' together' : ' · run 1 alone');
        if (runStages.length) return pick === 'one' ? 'copy: git switch ' + BRANCH + ' · ' + (runStages.length === 2 ? 'both tasks' : 'all ' + runStages.length + ' tasks') + ' on one branch'
          : 'copy: git switch ' + BRANCH + '-' + runStages.length + ' · the top of the stack holds ' + (runStages.length === 2 ? 'both tasks' : 'all ' + runStages.length + ' tasks');
        return branch ? 'copy: git switch ' + branch : 'open the copy in a terminal';
      })()),
      ship: sh ? { pick, rec: sh.rec, n: sh.runs.length, word: stackWord, owned, reason: sh.reason, oneBlocked: sh.oneBlocked || '', sizes: sh.sizes || [] } : null,
      // A group's next run, under the task it follows: whether it starts by itself or asks first is set right there.
      then: c.independent || hold ? null : (() => { const k = runStages.findIndex((x) => stageState(x.subs) === 'live'); const nx = k >= 0 && runStages[k + 1]; return nx && nx.subs.every((y) => y.state === 'next') && open === runStages[k].key ? { n: k + 2, title: nx.title } : null; })(),
      planHead: runStages.length > 0 && open === 'plan',
      runCases: c.runCases || [], parent: par, over: overview(c, live, ui), ask: clarifying ? Object.assign({}, clarifying[qIndex], { n: (qIndex + 1) + ' of ' + clarifying.length }) : (c.id === 'question' && seed?.question) || DETAIL.asks[c.id] || null, under: /^(gate|plan|outline)$/.test(c.id) ? { issues: c.id === 'gate' ? DETAIL.issues : [], roles: DETAIL.roles } : null,
      flow: flowOf(c, stateId, liveCtx), state: stateId, event: EVENT_OF(c, stateId, liveCtx), runFlow: R.runFlow(liveCtx), liveRun: runStages.findIndex((x) => stageState(x.subs) === 'live' && x.member && /^(Working|Starting)$/.test(x.member.word)), formCtx: liveCtx,
      hasSetup: !c.noSetup && !runStages.length, dependents: c.dependents || 0, heldBy: c.heldBy || '', hosted: !!c.hosted, baseMoved: !!c.baseMoved, independent: !!c.independent, reqsLeft: left, reqsCheck: !!c.reqsCheck, holdIndex: c.k ? c.k - 1 : -1,
      logs: logsGone ? [] : logsOf(c), agents: logsGone ? [] : agentsOf(c), sessions: logsGone ? [] : sessionsOf(c), usage: usageOf(c), graph: graphOf(c, ui), agentsUnknown: !!c.agentsUnknown, isWorkspace: !!(c.repos && c.repos.length), docsHere: !hasChanges, outlineN, outlineRuns: ui.outline || RUNS, rounds: DETAIL.rounds,
      tabData: Object.assign({}, DETAIL, seed ? { plan: seed.plan, docBody: Object.assign({}, DETAIL.docBody, { 'plan.md': '## The plan\n' + seed.plan.map((t) => '- ' + t).join('\n') }) } : {}, { files, decisions: decisionsOf(c, runStages) }),
    };
  }

  // An action either moves the task to another state (`to`) or does its job where it is and says so (`say`); `confirm`
  // asks first; events from outside (checks finish, a reviewer approves) are `next`. The table is the library's.
  const INSTANCE_FLOW = { workspace: { 'worca-api #212': { say: window.RailWould('open worca-api #212 on GitHub') }, 'worca-web #88': { say: window.RailWould('open worca-web #88 on GitHub') }, 'worca-docs #31': { say: window.RailWould('open worca-docs #31 on GitHub') } } };
  function flowOf(c, stateId, ctx) { return Object.assign(R.actionFlow(stateId, Object.assign({}, ctx, { would: window.RailWould })), INSTANCE_FLOW[c.id] || {}, c.flow || {}); }
  function EVENT_OF(c, stateId, ctx) { return flowOf(c, stateId, ctx).event || ''; }
  const FLOW = Object.fromEntries(CASES.map((c) => [c.id, flowOf(c, c.state || c.id, ctxOf(c))]));
  const RUN_FLOW = R.runFlow();

  // The + menu: what each kind is for, a placeholder for typing one, and the existing values to pick from.
  const ADD = [{ kind: 'label', menu: 'Label', help: 'Find and filter runs by it in the Tasks list', placeholder: 'Type or pick a label', suggest: ['ui', 'hotfix', 'needs demo'] },
    { kind: 'tag', menu: 'Cost tag', help: 'Splits this task’s cost in Statistics', placeholder: 'key: value', suggest: ['team: web', 'team: api', 'client: acme'] },
    { kind: 'group', menu: 'Add to group', help: 'Tracks it with related tasks on one page', placeholder: 'New group name', suggest: ['Navigation', 'Billing export', 'Onboarding'] }];
  const TITLES = {}, NAMELESS = 'Unified page navigation: one head, breadcrumb in the top';
  // A host page may name a case's run as the row that opens it (the one Worca's Runs list); empty here.
  // The case picker's groups, by what you check.
  const CASE_GROUPS = ['Running', NEEDS_YOU, 'Paused', 'Waiting', 'Pull requests', 'Ready', 'Done', 'Ended', 'Kinds', 'Shaper', 'Groups'];
  const moveIn = (ui, to, f) => move(rawOf(ui.caseId, ui), to, f);
  // A group's run as what happened on either page left it.
  const memberAt = (groupId, i, ui) => { const g = ui.groupRun && ui.groupRun.id === groupId ? ui.groupRun : CASES.find((x) => x.id === groupId); return memberRaw(g, i, ui); };
  const moveMember = (groupId, i, ui, to, f) => move(memberAt(groupId, i, ui), to, f);
  const restored = (ui) => { const raw = rawOf(ui.caseId, ui); return Object.assign({}, raw.restoreTo || caseFor('merged'), { action: null, detail: 'Restored: its branch, worktree and logs were not brought back' }); };
  const stageOf = (id) => { const c = CASES.find((x) => x.id === id), st = c?.stages; if (!st?.length || !st[0].subs) return {}; const live = st.findIndex((x) => R.stageState(x.subs) === 'live'); let done = -1; st.forEach((x, i) => { if (R.stageState(x.subs) === 'done') done = i; }); return { stage: live >= 0 ? live : done, stages: st.length }; };
  window.RunCardModel = { stageOf, move: moveIn, memberAt, moveMember, restored, caseGroups: CASE_GROUPS, stateOf: (id) => { const c = CASES.find((x) => x.id === id); if (!c) throw new Error(`no run case ${id}`); return c.state || c.id; }, forms: FORMS, titles: TITLES, chainStart: CHAIN_START, chainPrs: CHAIN_PRS.map((x) => x[0]), proposed: PROPOSED, isNew: (t) => NEW.has(t), flow: FLOW, runFlow: RUN_FLOW, cases: CASES.map((c) => ({ id: c.id, label: c.label, group: c.group, chips: c.chips || [] })), view, add: ADD };
})();
