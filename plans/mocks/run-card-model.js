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
  const A = (label, icon, primary, items) => ({ label, icon, primary: !!primary, items: items || [] });

  const CASES = [
    // One run, start to merge
    { id: 'starting', group: 'Run', label: 'Starting', word: 'Starting', dot: 'is-peach is-pulse', figs: [['Time', '0m 12s'], ['Cost', '$0.00']],
      stages: run({ plan: [s('Clarify', 'now', '', { live: 'Setting up the worktree', when: 'now' }), next('Plan'), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'working', group: 'Run', label: 'Working', word: 'Working', dot: 'is-peach is-pulse', figs: LIVE_FIGS,
      stages: run({ review: [REVIEW[0], REVIEW[1], s('Manual web UI testing', 'now', '21m', { live: 'Opening the Runs page at 375px to check the breadcrumb', when: '8s ago' })] }) },
    { id: 'question', group: 'Run', label: 'Needs you', word: 'Needs you', sym: 'q', action: A('Send answer', 'check', true, ['Use the default answer']), figs: LIVE_FIGS,
      stages: run({ review: [s('Review implementation', 'ask', '12m', { live: 'Keep the breadcrumb on phones under 600px, or show only Back there?', when: '4m' }), next('Manual tests checklist'), next('Manual web UI testing')] }) },
    { id: 'paused', group: 'Run', label: 'Paused', word: 'Paused', dot: 'is-grey', detail: 'Usage limit · resumes at 14:00', action: A('Resume now', 'play', false, ['Don’t resume at 14:00', 'Resume on Codex', 'Switch model…', 'Resume at…']), figs: [['Time', '2h 40m'], ['Cost', '$48.30']],
      stages: run({ build: [s('Implementation', 'paused', '1h 2m')], review: allNext(REVIEW) }) },
    { id: 'failed', group: 'Run', label: 'Failed', word: 'Failed', sym: 'x', action: A('Restart Build', 'refresh', true, ['Report this run', 'Start a new run']), figs: [['Time', '2h 12m'], ['Cost', '$41.30']],
      stages: run({ build: [s('Implementation', 'failed', '1h 30m', { loops: 3, live: 'Tests still failing after every retry' })], review: allNext(REVIEW) }) },
    { id: 'ready', group: 'Run', label: 'Ready', word: 'Ready', dot: 'is-green', action: A('Create PR', 'prc', true, ['Publish branch', 'How to merge', 'Push main', 'Discard']), figs: DONE_FIGS, stages: run({}) },
    { id: 'checks', group: 'Run', label: 'Checks running', word: 'In review', dot: 'is-peach is-pulse', action: A('View PR', 'pr', false, ['Watch', 'Copy PR link']), figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(s('Checks', 'now', '', { live: '3 of 7 passed', when: 'running' }), next('Approval')) }) },
    { id: 'failing', group: 'Run', label: 'Checks failing', word: 'Needs you', dot: 'is-amber', action: A('Fix checks', 'refresh', true, ['View PR', 'Copy PR link']), figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(s('Checks', 'problem', '', { live: '2 failed · unit, e2e' }), next('Approval')) }) },
    { id: 'conflicts', group: 'Run', label: 'Conflicts', word: 'Needs you', dot: 'is-amber', action: A('Fix conflicts', 'refresh', true, ['Update branch', 'Resolve in a terminal', 'Re-check', 'View PR', 'Copy PR link']), figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(ok('Checks', '', { live: '7 of 7 passed' }), s('Up to date with dev', 'problem', '', { live: 'Conflicts in 2 files' })) }) },
    { id: 'approved', group: 'Run', label: 'Approved', word: 'Ready to merge', dot: 'is-green', action: A('Merge PR', 'merge', true, ['View PR', 'Watch', 'Copy PR link']), figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(ok('Checks', '', { live: '7 of 7 passed' }), ok('Approval', '', { live: 'Approved by 1 reviewer' })) }) },
    { id: 'labelled', group: 'Run', label: 'With labels, tags, group', word: 'Ready', dot: 'is-green', action: A('Create PR', 'prc', true, ['Publish branch', 'How to merge', 'Push main', 'Discard']), figs: DONE_FIGS, stages: run({}),
      chips: [{ kind: 'label', text: 'ui' }, { kind: 'label', text: 'needs demo' }, { kind: 'tag', text: 'team: web' }, { kind: 'group', text: 'Navigation' }] },
    { id: 'merged', group: 'Run', label: 'Merged', word: 'Merged', dot: 'is-violet', action: A('View PR', 'merge', false), figs: DONE_FIGS,
      stages: run({ pr: PR_OPEN(ok('Checks'), ok('Approval')), merged: LAND('merged', 'Merged 25 Oct, 16:02') }) },

    // States the app has today: a run waiting to start after another, a review gate, a cost cap, kept work, archived
    { id: 'scheduled', group: 'Run', label: 'Waiting (run after)', word: 'Waiting', dot: 'is-grey-ring', detail: 'Starts when “Unified page navigation” finishes', action: A('Start now', 'play', false, ['Cancel']), figs: [['Time', '0m'], ['Cost', '$0.00']],
      title: 'Breadcrumb tests for saved runs', tabs: [['summary', 'Overview'], ['activity', 'Activity'], ['decisions', 'Decisions']], stages: run({ plan: allNext(PLAN), build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'gate', group: 'Run', label: 'Review gate', word: 'Needs you', sym: 'q', detail: 'Review sent it back 3 times; the limit is 3', action: A('Accept as is', 'check', true, ['Run another cycle', 'Stop']), figs: LIVE_FIGS,
      stages: run({ review: [s('Review implementation', 'ask', '37m 21s', { loops: 3, live: 'Still 1 minor issue after 3 rounds: accept, or run another cycle?', when: '6m' }), next('Manual tests checklist'), next('Manual web UI testing')] }) },
    { id: 'capped', group: 'Run', label: 'Paused at cost cap', word: 'Paused', dot: 'is-grey', detail: 'Reached the $120 cap for this run', action: A('Continue without cap', 'play', false, ['Raise the cap', 'Open budget settings']), figs: LIVE_FIGS,
      stages: run({ review: [REVIEW[0], s('Manual tests checklist', 'paused', '1m 18s', { live: 'Paused at $120.00' }), next('Manual web UI testing')] }) },
    { id: 'kept', group: 'Run', label: 'Work kept', word: 'Needs you', dot: 'is-amber', detail: 'The last commit failed; the work is kept in a copy', over: true, action: A('Apply to branch', 'check', true, ['Download patch', 'Commit it yourself', 'Discard']), figs: DONE_FIGS,
      stages: run({ review: [REVIEW[0], REVIEW[1], s('Manual web UI testing', 'problem', '21m 10s', { live: 'Commit failed: pre-commit hook exited 1' })] }) },
    { id: 'archived', group: 'Run', label: 'Archived', word: 'Archived', dot: 'is-grey', detail: 'Branch, worktree and logs removed; the remote branch and PR stay', figs: DONE_FIGS, archived: true,
      stages: run({ pr: PR_OPEN(ok('Checks'), ok('Approval')), merged: LAND('merged', 'Merged 25 Oct, 16:02') }) },
    // Where actions lead: a stopped, discarded or applied run
    { id: 'stopped', group: 'Run', label: 'Stopped', word: 'Stopped', dot: 'is-grey', detail: 'Stopped by you · the branch and changes stay', action: A('Start a new run', 'play', false, ['Restart Build']), figs: [['Time', '2h 40m'], ['Cost', '$48.30']],
      stages: run({ build: [s('Implementation', 'paused', '1h 2m', { live: 'Stopped by you' })], review: allNext(REVIEW) }) },
    { id: 'discarded', group: 'Run', label: 'Discarded', word: 'Discarded', dot: 'is-grey', detail: 'The changes are gone; the run stays in history', action: A('Start a new run', 'play', false), figs: DONE_FIGS,
      stages: run({ tail: [{ key: 'done', label: 'Done', subs: [s('Discarded', 'paused', '', { live: 'By you, 25 Oct 14:02' })] }] }) },

    // Run kinds
    { id: 'push', group: 'Kinds', label: 'Push path', word: 'Ready', dot: 'is-green', branch: 'main', action: A('Push main', 'up', true, ['Create PR instead', 'Discard']), figs: [['Time', '38m'], ['Cost', '$6.40']],
      stages: run({ tail: [{ key: 'push', label: 'Push', subs: [next('To origin/main')] }] }) },
    { id: 'folder', group: 'Kinds', label: 'Folder run', word: 'Ready', dot: 'is-green', branch: '', folder: '~/src/marketing-site', action: A('Apply to folder', 'folder', true, ['Open the copy', 'Discard']), figs: [['Time', '52m'], ['Cost', '$9.15']],
      stages: run({ tail: [{ key: 'apply', label: 'Apply', subs: [next('Into the folder', { live: '5 files changed in a copy' })] }] }) },
    { id: 'applied', group: 'Kinds', label: 'Folder applied', word: 'Applied', dot: 'is-violet', branch: '', folder: '~/src/marketing-site', action: A('Open the folder', 'folder', false), figs: [['Time', '52m'], ['Cost', '$9.15']],
      stages: run({ tail: [{ key: 'apply', label: 'Apply', subs: [s('Into the folder', 'merged', '', { live: '5 files written · 25 Oct 14:05' })] }] }) },
    { id: 'workspace', group: 'Kinds', label: 'Workspace', word: 'Needs you', dot: 'is-amber', detail: 'worca-docs #31 conflicts with main', branch: 'feat/billing-export', project: 'billing workspace', repos: ['worca-api', 'worca-web', 'worca-docs'], action: A('Fix conflicts', 'refresh', true, ['worca-api #212', 'worca-web #88', 'worca-docs #31', 'Copy PR links']), figs: [['Time', '3h 05m'], ['Cost', '$52.70']],
      stages: run({ tail: [{ key: 'pr', label: 'PRs', subs: [s('worca-api #212', 'merged', '', { live: 'Merged into main' }), s('worca-web #88', 'now', '', { live: 'Checks running · 5 of 7' }), s('worca-docs #31', 'problem', '', { live: 'Conflicts with main' })] }, { key: 'merged', label: 'Merged', subs: [s('1 of 3 repositories', 'next', '', { live: 'worca-api is in main' })] }] }) },
    { id: 'noproject', group: 'Kinds', label: 'No project', word: 'Finished', dot: 'is-green', project: '', branch: '', figs: [['Time', '12m'], ['Cost', '$1.80']], tabs: [['summary', 'Overview'], ['activity', 'Activity'], ['decisions', 'Decisions']],
      stages: run({ tail: [{ key: 'done', label: 'Done', subs: [ok('3 artifacts', '', { live: 'In Overview' })] }] }) },

    // Shaper
    { id: 'clarify', group: 'Shaper', label: 'Clarify', word: 'Needs you', sym: 'q', action: A('Send answer', 'check', true, ['Use defaults']), figs: [['Time', '2m'], ['Cost', '$0.76']],
      stages: run({ plan: [s('Clarify', 'ask', '34s', { live: '3 questions · which pages, what Back does, phones', when: '1m' }), next('Plan'), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'plan', group: 'Shaper', label: 'Plan ready', word: 'Needs you', sym: 'q', action: A('Approve and build', 'check', true, ['Ask for changes', 'Full plan']), figs: [['Time', '34m'], ['Cost', '$15.41']],
      stages: run({ plan: [ok('Clarify', '34s'), s('Plan', 'ask', '33m 57s', { live: '6 steps · 2 open issues · waiting for you', when: '4m' }), next('Refine plan'), next('Plan review')], build: allNext(BUILD), review: allNext(REVIEW) }) },
    { id: 'outline', group: 'Shaper', label: 'Plan in slices', word: 'Needs you', sym: 'q', action: A('Approve 3 runs', 'check', true, ['Ask me before each run', 'Don’t split', 'Ask for changes']), figs: [['Time', '41m'], ['Cost', '$18.90']],
      stack: { mode: 'outline' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), s('Cut into runs', 'ask', '7m', { live: '3 runs, one PR each · waiting for you', when: '2m' })] },
        { key: 'run1', label: 'Run 1', subs: allNext(['Plan', 'Build', 'Review', 'Ready'].map((n) => s(n))) }, { key: 'run2', label: 'Run 2', subs: allNext(['Plan', 'Build', 'Review', 'Ready'].map((n) => s(n))) },
        { key: 'run3', label: 'Run 3', subs: allNext(['Plan', 'Build', 'Review', 'Ready'].map((n) => s(n))) }, { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'slice', group: 'Shaper', label: 'A slice running', parent: { caseId: 'feature', index: 1 }, word: 'Working', dot: 'is-peach is-pulse', branch: 'feat/head-breadcrumb-2', figs: [['Time', '1h 10m'], ['Cost', '$19.40'], ['Rate', '$16.60/h']],
      stages: run({ build: [s('Implementation', 'now', '12m', { live: 'Builds on run 1 · editing app.js', when: '3s ago' })], review: allNext(REVIEW),
        tail: [{ key: 'ship', label: 'Ship', subs: [next('With the feature', { live: 'One stacked PR each, from the feature page' })] }] }) },

    // Groups
    { id: 'feature', group: 'Groups', runCases: ['ready', 'slice', ''], label: 'Feature, run 2', kind: 'Feature', title: 'Unified page navigation', word: 'Working', dot: 'is-peach is-pulse', branch: '', figs: [['Time', '3h 20m'], ['Cost', '$61.10'], ['Rate', '$18.30/h']], tabs: GROUP_TABS,
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Cut into runs', '7m', { live: '3 runs, one PR each' })] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m', ''] }),
        member(2, RUNS[1], ['done', 'now', 'next', 'next'], { times: ['18m', '40m'], live: ['', 'Editing app.js'], when: ['', '3s ago'] }),
        member(3, RUNS[2], ['next', 'next', 'next', 'next']),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'featureready', group: 'Groups', runCases: ['ready', 'ready', 'ready'], label: 'Feature ready', kind: 'Feature', title: 'Unified page navigation', word: 'Ready', dot: 'is-green', branch: '', action: A('Create 3 PRs', 'prc', true, ['Check out the whole feature', 'Discard']), figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS,
      stack: { mode: 'create', runs: RUNS, rec: 'stack', sizes: ['+278 \u221264', '+41 \u221258', '+39 \u221222'], reason: '3 runs and 502 changed lines, most of them in run 1: three focused reviews go faster than one mixed one.' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Cut into runs', '7m')] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['18m', '1h 2m', '27m'] }),
        member(3, RUNS[2], ['done', 'done', 'done', 'done'], { times: ['12m', '44m', '19m'] }),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'featureone', group: 'Groups', runCases: ['ready', 'ready'], label: 'Feature ready, small', kind: 'Feature', title: 'Unified page navigation', word: 'Ready', dot: 'is-green', branch: '', action: A('Create PR', 'prc', true, ['Check out the whole feature', 'Discard']), figs: [['Time', '1h 40m'], ['Cost', '$21.70']], tabs: GROUP_TABS,
      diff: '+158 \u221262', stack: { mode: 'create', runs: RUNS.slice(0, 2), rec: 'one', sizes: ['+120 \u221240', '+38 \u221222'], reason: '2 small runs, 220 changed lines, that combine without conflicts: one review is enough.' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '12m'), ok('Cut into runs', '3m')] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['8m', '31m', '12m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['6m', '22m', '9m'] }),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2')] }] },
    { id: 'featureblocked', group: 'Groups', runCases: ['ready', 'ready', 'ready'], label: 'Feature ready, One PR off', kind: 'Feature', title: 'Unified page navigation', word: 'Ready', dot: 'is-green', branch: '', action: A('Create 3 PRs', 'prc', true, ['Check out the whole feature', 'Discard']), figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS,
      stack: { mode: 'create', runs: RUNS, rec: 'stack', sizes: ['+278 \u221264', '+41 \u221258', '+39 \u221222'], oneBlocked: 'Not possible: runs 2 and 3 started from the same branch and both change ui/public/app.js lines 36,380\u201336,412, so they conflict on one branch.', reason: 'Runs 2 and 3 don\u2019t build on each other and conflict; stacked, each lands on top of the one before.' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Cut into runs', '7m')] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['18m', '1h 2m', '27m'] }),
        member(3, RUNS[2], ['done', 'done', 'done', 'done'], { times: ['12m', '44m', '19m'] }),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'chain', group: 'Groups', runCases: ['approved', 'checks', 'failing'], runPRs: ['#959', '#960', '#961'], label: 'Stack in review', kind: 'Chain', title: 'Unified page navigation', word: 'Needs you', dot: 'is-amber', detail: '#961 checks failing · #959 ready to merge', branch: '', action: A('Fix checks on #961', 'refresh', true, ['Merge #959', 'View PRs', 'Watch PRs', 'Copy PR links']), figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS,
      stack: { mode: 'review' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Cut into runs', '7m')] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m'] }), member(2, RUNS[1], ['done', 'done', 'done', 'done'], { times: ['18m', '1h 2m', '27m'] }), member(3, RUNS[2], ['done', 'done', 'done', 'done'], { times: ['12m', '44m', '19m'] }),
        { key: 'pr', label: 'PRs', subs: [ok('#959'), s('#960', 'review'), s('#961', 'problem')] }] },
  ];

  // The stack: the PRs of a feature or chain, in merge order, each based on the one above it.
  const STACKS = {
    outline: { title: '3 runs, one PR each', note: 'Each run builds on the one before', rows: RUNS.map((t, i) => ({ num: String(i + 1), title: t, state: 'next', word: ['Small', 'Medium', 'Small'][i], sub: i ? 'Builds on run ' + i : 'Starts from dev' })) },
    create: { title: 'Ship as', choice: true },
    review: { title: 'Merge in order', rows: [
      { num: '#959', title: RUNS[0], state: 'done', word: 'Ready to merge', sub: 'Into dev · +278 \u221264 · 7 of 7 checks · approved by you', isNext: true },
      { num: '#960', title: RUNS[1], state: 'review', word: 'In review', sub: 'Into #959 · +41 \u221258 · 5 of 7 checks' },
      { num: '#961', title: RUNS[2], state: 'problem', word: 'Checks failing', sub: 'Into #960 · +39 \u221222 · 2 failed' }] },
  };



  // What the tabs hold, shared by every case (sample content; the step list comes from the case itself).
  const MODEL_OF = { Clarify: 'Sonnet 5.5', Plan: 'Opus 5.5', 'Refine plan': 'Opus 5.5', 'Plan review': 'Sonnet 5.5', Implementation: 'Opus 5.5',
    'Review implementation': 'Opus 5.5', 'Manual tests checklist': 'Haiku 5.5', 'Manual web UI testing': 'Sonnet 5.5' };
  const COST_OF = { Clarify: '$0.76', Plan: '$14.65', 'Refine plan': '$18.29', 'Plan review': '$7.82', Implementation: '$31.18', 'Review implementation': '$9.95', 'Manual tests checklist': '$0.80', 'Manual web UI testing': '$0.65' };
  const DETAIL = {
    task: 'One head for the run and group pages: Back, the breadcrumb and the run’s actions in the top bar, and the page title once.',
    check: ['The breadcrumb hides under 600px: try it on a phone', 'Back on a group page now goes to Runs, not the group list'],
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
    // The question a run is waiting on: the options Worca offers, the one it would pick, and why.
    asks: {
      question: { q: 'Keep the breadcrumb on phones under 600px, or show only Back there?', why: 'Review implementation found the trail wraps to two lines at 375px.',
        options: ['Keep the full breadcrumb, truncate the middle crumbs', 'Show only ‹ Parent under 600px', 'Hide the breadcrumb on phones'], pick: 1 },
      clarify: { q: 'Which pages get the breadcrumb?', why: 'The task names the run page; group and saved run pages share its head.', n: '1 of 3',
        options: ['Run pages only', 'Run and group pages', 'Every page with a parent'], pick: 1 } },
    budget: 120,
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
  const NO_DIFF = { scheduled: 1, starting: 1, clarify: 1, plan: 1, outline: 1, noproject: 1 };
  const money = (v) => parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0;

  // One line on what each action does: the main button's tooltip and the head of its ▾ menu, and each menu item's help.
  const HELP = {
    'Send answer': 'Sends the answer you picked or wrote; the run goes on',
    'Use the default answer': 'Goes on with what Worca would pick',
    'Use defaults': 'Skips the questions; the planner picks sensible answers',
    'Resume': 'Starts again from the step it paused in',
    'Resume when the limit resets': 'Waits for the limit, then goes on by itself',
    'Stop': 'Ends the run; the branch and changes stay',
    'Restart Build': 'Runs Build again with what Plan already made',
    'Report this run': 'Sends the logs and a note to the Worca team',
    'Start a new run': 'A fresh run with the same task',
    'Create PR': 'Opens a pull request from this run’s branch into dev',
    'Create 3 PRs': 'Opens one PR per run, each into the one before',
    'Create 2 PRs': 'Opens one PR per run, the second into the first',
    'Try it': 'Checks the branch out locally so you can run it; in a stack, each run’s branch holds the runs before it',
    'Check out the whole feature': 'Checks out the top of the stack, which holds every run',
    'Open the copy': 'Opens a terminal in the copy the run changed',
    'Push main': 'Pushes the commits straight to origin/main, no PR',
    'Discard': 'Throws the changes away; the run stays in history',
    'View PR': 'Opens the pull request on GitHub',
    'Watch': 'Worca follows the PR and fixes failing checks for you',
    'Copy PR link': 'Copies the PR’s address',
    'Fix checks': 'Starts a short run that fixes the failing checks',
    'Fix conflicts': 'Starts a short run that merges dev in and resolves the conflicts',
    'Merge PR': 'Merges the PR into dev on GitHub',
    'Merge #959': 'Merges #959 into dev; #960 then points at dev',
    'Fix checks on #961': 'Starts a short run that fixes #961’s failing unit and e2e checks',
    'Resume now': 'Goes on now instead of waiting for the limit to reset',
    'Pause': 'Stops at once; Resume starts the current step again',
    'Pause after this step': 'Lets the current step finish, then pauses',
    'Stop the run': 'Ends it; the branch and changes stay',
    'Open the folder': 'Opens ~/src/marketing-site in your file manager',
    'Don’t resume at 14:00': 'Cancels the scheduled resume; Resume stays here',
    'Resume on Codex': 'Goes on now on another engine, from the same step',
    'Switch model…': 'Pick another model, then resume',
    'Resume at…': 'Pick a time to resume',
    'Publish branch': 'Pushes the branch to origin without opening a PR',
    'How to merge': 'Shows the git commands to merge it yourself',
    'Update branch': 'Merges dev into the branch; it merges cleanly',
    'Resolve in a terminal': 'Opens a terminal in the worktree with the conflicts',
    'Re-check': 'Checks again whether the branch is up to date with dev',
    'Start now': 'Starts it now instead of waiting',
    'Cancel': 'Deletes the scheduled run',
    'Accept as is': 'Takes the review as it is and goes on to the manual tests',
    'Run another cycle': 'One more Build and Review round',
    'Continue without cap': 'Goes on with no cost cap for this run',
    'Raise the cap': 'Sets a new cap for this run, then goes on',
    'Open budget settings': 'Opens Settings › Runs › Budget',
    'Apply to branch': 'Commits the kept work to the branch, skipping the failed hook',
    'Download patch': 'Saves the kept work as a .patch file',
    'Commit it yourself': 'Shows the commands to commit it by hand',
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

  // Actions this design proposes that today's app does not have (parity audit, 26 Oct): listed with why in the
  // prototype's intro, never marked on the buttons themselves.
  const PROPOSED = [
    ['Send answer', 'A question is answered under its step in the card; today the answer panel sits apart, above the steps.'],
    ['Pause after this step', 'Lets the current step finish before pausing; today Pause stops at once.'],
    ['Fix checks', 'Starts a short run that fixes failing checks, like Fix conflicts does today for conflicts.'],
    ['Merge PR', 'Merges from Worca, in stack order for a chain; today you merge on GitHub (How to merge shows the commands).'],
    ['Restart Build', 'Runs one stage again with what earlier stages made; today a failed run resumes or starts over.'],
    ['Raise the cap', 'Sets a new cost cap and goes on; today the choices are Continue without cap or Settings.'],
    ['Copy link', 'Copies a link to the run from ⋯, for Chat or an issue.'],
  ];
  const NEW = new Set(['Merge PR', 'Merge #959', 'Fix checks', 'Fix checks on #961', 'Restart Build', 'Raise the cap', 'Pause after this step', 'Send answer', 'Copy link']);
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

  // A run inside a group is one record seen from two pages: the group's segment for it and its own page read the same
  // stages, time and cost. On its own page it ships with the group, so its PR stages become one Ship stage (a feature)
  // or stay its PR (a chain), and only fix-it actions stay; creating and merging PRs is the group page's job.
  const SHIP = /^(pr|merged|push|apply|done|ship)$/;
  const FIX = /^(Answer|Use defaults|Resume now|Restart Build|Fix checks|Fix conflicts|Approve and build)$/;
  const BRANCH = 'feat/unified-page-navigation-one-head-breadcrumb';
  function asMember(c0, g, i) {
    const chain = g.kind === 'Chain';
    let stages = chain ? c0.stages : c0.stages.filter((x) => !SHIP.test(x.key))
      .concat({ key: 'ship', label: 'Ship', subs: [next('With the feature', { live: 'From the feature page, with the other runs' })] });
    const keep = c0.action && FIX.test(c0.action.label);
    const k = SLICE[i] || 0.3;
    const scaled = (c0.stages).map((st) => Object.assign({}, st, { subs: st.subs.map((x) => (x.time ? Object.assign({}, x, { time: fmtMin(toMin(x.time) * k) }) : x)) }));
    stages = chain ? scaled : scaled.filter((x) => !SHIP.test(x.key)).concat(stages.slice(-1));
    return Object.assign({}, c0, { stages, scale: k, title: RUNS[i], kind: '', branch: BRANCH + '-' + (i + 1), diff: ((g.stack && g.stack.sizes) || SIZES)[i],
      action: keep ? c0.action : null, detail: c0.detail || (keep ? '' : chain ? 'Merges in order, from the chain' : c0.word === 'Ready' ? 'Ships with the feature' : ''),
      pr: chain ? g.runPRs[i] : '', base: chain ? (i ? g.runPRs[i - 1] : 'dev') : '', group: g, index: i });
  }
  const memberOf = (g, i) => { const id = (g.runCases || [])[i]; return id ? asMember(CASES.find((x) => x.id === id), g, i) : null; };
  const subState = (st) => { const lv = st.subs.find((x) => LIVE[x.state]); return lv ? lv.state : st.subs.every(isDone) ? 'done' : 'next'; };
  // A group's run segment: one cell per stage of that run, read from the run itself when it has a page.
  function resolve(c) {
    if (!c.runCases) return c;
    return Object.assign({}, c, { stages: c.stages.map((st) => {
      if (!st.run) return st;
      const m = memberOf(c, +st.key.slice(3) - 1);
      if (!m) return st;
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
  // Overview leads with what this state needs from you: an answer, a plan to approve, what broke, or what to check;
  // a running run shows its plan's progress. The rest (what it did, what you asked, where it changed, artifacts)
  // follows, each only once there is something to say.
  function overview(c, live) {
    const built = c.stages.some((x) => x.key === 'build' && x.subs.some(isDone));
    const planDone = c.stages.some((x) => x.key === 'plan' && x.subs.every(isDone));
    const buildLive = c.stages.some((x) => x.key === 'build' && x.subs.some((y) => LIVE[y.state]));
    const ev = c.id === 'kept' ? EVIDENCE['review/Manual web UI testing'] : c.id === 'failed' ? EVIDENCE['build/Implementation'] : c.id === 'failing' ? EVIDENCE['pr/Checks'] : /^(conflicts|workspace)$/.test(c.id) ? EVIDENCE['pr/Up to date with dev'] : null;
    let focus = null;
    if (c.id === 'plan') focus = { kind: 'plan', items: DETAIL.plan.map((t) => ({ t, state: 'next' })), issues: DETAIL.planIssues };
    else if (ev) focus = { kind: 'broke', ev, next: c.action ? c.action.label : '' };
    else if (planDone && !c.runCases && (buildLive || c.stages.some((x) => x.key === 'review' && x.subs.some((y) => LIVE[y.state])))) {
      const doneN = buildLive ? 3 : DETAIL.plan.length;
      focus = { kind: 'progress', note: buildLive ? doneN + ' of ' + DETAIL.plan.length + ' built' : 'all ' + DETAIL.plan.length + ' built · now in Review', items: DETAIL.plan.map((t, i) => ({ t, state: i < doneN ? 'done' : i === doneN ? 'now' : 'next' })) };
    } else if (built && !c.runCases && !/^(Failed|Merged|Archived|Discarded|Applied|Stopped|Finished)$/.test(c.word)) focus = { kind: 'check', items: DETAIL.check, title: prOpen(c) ? 'Before you merge' : 'Before you ship' };
    const areas = {};
    if (built && !NO_DIFF[c.id]) DETAIL.files.forEach(([f, a, d]) => { const k = f.slice(0, f.lastIndexOf('/') + 1); const x = areas[k] || (areas[k] = { dir: k, n: 0, add: 0, del: 0 }); x.n++; x.add += a; x.del += d; });
    const max = Math.max(1, ...Object.values(areas).map((x) => x.add + x.del));
    return { focus, outcome: built && !live ? DETAIL.outcome : [], task: DETAIL.task,   // what it did, once it is done
      areas: Object.values(areas).map((x) => Object.assign(x, { pct: Math.round(((x.add + x.del) / max) * 100) })),
      artifacts: planDone || built ? DETAIL.artifacts : DETAIL.artifacts.slice(0, 0) };
  }
  function prOpen(c) { return c.stages.some((x) => x.key === 'pr' && x.subs[0] && x.subs[0].name === 'Create PR' && isDone(x.subs[0])); }

  // ui: { open: stage key | null, chips: [{kind, text}], ship: 'stack' | 'one', parent: { caseId, index } }
  function view(caseId, ui) {
    ui = ui || {};
    const c0 = CASES.find((x) => x.id === caseId) || CASES[1];
    const par = ui.parent || c0.parent || null;
    const g = par ? CASES.find((x) => x.id === par.caseId) : null;
    let c = resolve(g ? asMember(c0, g, par.index) : c0);
    const now = defaultStage(c);
    const open = ui.open && c.stages.some((st) => st.key === ui.open) ? ui.open : now;
    const st = c.stages.find((x) => x.key === open);
    let stack = null;
    // Stacked or one PR: Worca recommends one and says why; the choice itself is the action's ▾ and the Create PR
    // dialog, never a form in the card.
    const sh = c.stack && c.stack.mode === 'create' ? c.stack : null;
    const pick = sh ? (ui.ship && !(ui.ship === 'one' && sh.oneBlocked) ? ui.ship : sh.rec) : '';
    const shipWord = (id) => (id === 'one' ? 'one PR' : sh.runs.length + ' stacked PRs');
    if (c.stack && (open === 'pr' || (c.stack.mode === 'outline' && open === 'plan'))) {
      const src = STACKS[c.stack.mode];
      let rows = src.rows || [];
      let choice = null;
      if (src.choice) {
        const n = sh.runs.length;
        rows = pick === 'one'
          ? [{ num: 'One PR', title: 'All ' + n + ' runs, one branch', state: 'next', word: 'Not opened', sub: 'Into dev' }]
          : sh.runs.map((t, i) => ({ num: 'PR ' + (i + 1), title: t, state: 'next', word: 'Not opened', sub: (i ? 'Into PR ' + i + '’s branch' : 'Into dev') + (sh.sizes ? ' · ' + sh.sizes[i] : '') }));
        choice = { note: (pick === sh.rec ? 'Worca suggests ' + shipWord(sh.rec) : 'You picked ' + shipWord(pick) + '; Worca suggests ' + shipWord(sh.rec)) + ': ' + sh.reason };
      }
      rows = rows.map((r) => Object.assign(rowOf({ state: r.state }), r, { rowCls: 'is-' + r.state + (r.isNext ? ' is-next-up' : '') }));
      stack = { title: sh ? (pick === 'one' ? 'What it opens: one PR' : 'What it opens: ' + sh.runs.length + ' stacked PRs') : src.title, note: choice ? choice.note : src.note || '', choice: null, rows };
    }
    let action = null;
    const liveNow = c.word !== 'Failed' && c.word !== 'Waiting' && !c.over && !c.stages.filter((x) => !SHIP.test(x.key)).every((x) => x.subs.every(isDone));
    if (!c.action && liveNow && c.word !== 'Paused') c = Object.assign({}, c, { action: A('Pause', 'pause', false, ['Pause after this step']) });
    if (c.action) {
      const label = sh ? (pick === 'one' ? 'Create PR' : 'Create ' + sh.runs.length + ' PRs') : c.action.label;
      const alt = sh ? [pick === 'one' ? 'Create ' + sh.runs.length + ' stacked PRs instead' : 'Create one PR instead'] : [];
      const items = alt.concat(c.action.items.filter((t) => !/^Create (PR|\d+ PRs)$/.test(t))).concat(liveNow && !c.action.items.includes('Stop') ? ['Stop the run'] : []);
      action = Object.assign({}, c.action, { label, isNew: NEW.has(label), help: HELP[label] || '', items: items.map((t) => ({ text: t, isNew: NEW.has(t), help: sh && / instead$/.test(t) ? (/one PR/.test(t) && sh.oneBlocked ? 'Not possible: ' + sh.oneBlocked.replace(/^Not possible: /, '') : sh.reason) : HELP[t] || '', off: /one PR instead/.test(t) && sh && !!sh.oneBlocked })) });
    }
    // The run is live while any work stage (everything before shipping) is unfinished and it has not failed;
    // waiting on CI, reviewers or a merge is the PR's business, not the run's, so Pause and Stop go. A run waiting on
    // your answer has nothing to pause.
    const work = c.stages.filter((x) => !SHIP.test(x.key));
    const live = c.word !== 'Failed' && c.word !== 'Waiting' && !c.over && !work.every((x) => x.subs.every(isDone));
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
      id: c.id, title: c.title || 'Unified page navigation: one head, breadcrumb in the top',
      kind: runStages.length && c.kind ? c.kind : '',   // the stepper already counts the runs
      crumbs, pager: g ? { index: par.index, n: g.stages.filter((x) => x.run).length, prev: sibling(par.index - 1), next: sibling(par.index + 1), group: g.id } : null,
      // The place line: where the code lives and where it goes, the PR once it exists. Each part once on the page.
      place: { branch, copy: !!branch && branch !== 'main', base: c.base || (branch === 'main' ? 'origin/main' : branch ? 'dev' : ''),
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
          const pr = STACKS.review.rows[i];
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
      }).concat(NO_DIFF[c.id] ? [] : [{ k: 'Changes', v: c.diff || '+358 −144', tab: (c.tabs || RUN_TABS).some((x) => x[0] === 'changes') ? 'changes' : '' }]),   // links only where a Changes tab exists
      tabs: (c.tabs || RUN_TABS).map(([id, l], i, all) => ({ id, l, n: id === 'runs' ? String(runStages.length) : id === 'changes' ? String(DETAIL.files.length) : id === 'decisions' ? String(DETAIL.decisions.length) : '',
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
      ship: sh ? { pick, rec: sh.rec, n: sh.runs.length, reason: sh.reason, oneBlocked: sh.oneBlocked || '' } : null,
      runCases: c.runCases || [], parent: par, over: overview(c, live), ask: DETAIL.asks[c.id] || null, rounds: DETAIL.rounds,
      tabData: DETAIL,
    };
  }

  // The prototype's flow: an action either moves the run to another case (`to`) or does its job where it is and says
  // so (`say`); `confirm` asks first. Events from outside (checks finish, a reviewer approves) are `next`.
  const FLOW = {
    starting: { next: 'working' },
    working: { next: 'ready' },
    question: { 'Send answer': { to: 'working', say: 'Answer sent; Review goes on' }, 'Use the default answer': { to: 'working', say: 'Worca’s pick sent; Review goes on' } },
    paused: { 'Resume now': { to: 'working', say: 'Resumed from Implementation' }, 'Don’t resume at 14:00': { say: 'The 14:00 resume is cancelled' }, 'Resume on Codex': { to: 'working', say: 'Resumed on Codex' }, 'Switch model…': { say: 'Model picker: Opus 5.5, Sonnet 5.5, Haiku 5.5' }, 'Resume at…': { say: 'Time picker: resume at a time you choose' } },
    scheduled: { 'Start now': { to: 'starting', say: 'Started now; it no longer waits' }, Cancel: { to: 'discarded', confirm: 'Delete this scheduled run?' } },
    gate: { 'Accept as is': { to: 'working', say: 'Review accepted; manual tests start' }, 'Run another cycle': { to: 'working', say: 'One more Build and Review round' }, Stop: { to: 'stopped', confirm: 'Stop the run? The branch and changes stay.' } },
    capped: { 'Continue without cap': { to: 'working', confirm: 'Go on with no cost cap for this run?' }, 'Raise the cap': { say: 'Cap raised to $180; the run goes on' }, 'Open budget settings': { say: 'Opens Settings › Runs › Budget' } },
    kept: { 'Apply to branch': { to: 'ready', say: 'Committed to the branch' }, 'Download patch': { say: 'Downloading run.patch' }, 'Commit it yourself': { say: 'Commands: cd the worktree, git add -A, git commit --no-verify' }, Discard: { to: 'discarded', confirm: 'Discard the kept work? A patch is saved first.' } },
    archived: {},
    failed: { 'Restart Build': { to: 'working', say: 'Build runs again with what Plan made' }, 'Report this run': { say: 'Logs and a note sent to the Worca team' }, 'Start a new run': { to: 'starting', say: 'A new run with the same task' } },
    ready: { 'Create PR': { to: 'checks', say: 'Opened #959 into dev', dialog: 'pr' }, 'Publish branch': { say: 'Pushed the branch to origin; no PR' }, 'How to merge': { say: 'git switch dev && git merge feat/unified-page-navigation-one-head-breadcrumb' }, 'Try it': { say: 'Copied: git switch feat/unified-page-navigation-one-head-breadcrumb' }, 'Push main': { to: 'merged', say: 'Pushed to origin/main' }, Discard: { to: 'discarded', confirm: 'Discard the changes? The run stays in history.' } },
    labelled: { 'Create PR': { to: 'checks', say: 'Opened #959 into dev', dialog: 'pr' }, 'Publish branch': { say: 'Pushed the branch to origin; no PR' }, 'How to merge': { say: 'git switch dev && git merge feat/unified-page-navigation-one-head-breadcrumb' }, 'Try it': { say: 'Copied: git switch feat/unified-page-navigation-one-head-breadcrumb' }, 'Push main': { to: 'merged', say: 'Pushed to origin/main' }, Discard: { to: 'discarded', confirm: 'Discard the changes? The run stays in history.' } },
    checks: { 'View PR': { say: 'Opens #959 on GitHub' }, Watch: { say: 'Worca watches #959 and fixes failing checks' }, 'Copy PR link': { say: 'Copied the link to #959' }, next: 'failing' },
    failing: { 'Fix checks': { to: 'checks', say: 'A short run fixed unit and e2e; checks run again' }, 'View PR': { say: 'Opens #959 on GitHub' }, 'Copy PR link': { say: 'Copied the link to #959' }, next: 'conflicts' },
    conflicts: { 'Fix conflicts': { to: 'checks', say: 'dev merged in, 2 conflicts resolved; checks run again' }, 'Update branch': { say: 'dev does not merge cleanly: 2 files conflict. Use Fix conflicts' }, 'Resolve in a terminal': { say: 'Opens a terminal in the worktree' }, 'Re-check': { say: 'Still 2 conflicts with dev' }, 'View PR': { say: 'Opens #959 on GitHub' }, 'Copy PR link': { say: 'Copied the link to #959' }, next: 'approved' },
    approved: { 'Merge PR': { to: 'merged', confirm: 'Merge #959 into dev?' }, 'View PR': { say: 'Opens #959 on GitHub' }, Watch: { say: 'Worca watches #959' }, 'Copy PR link': { say: 'Copied the link to #959' } },
    merged: { 'View PR': { say: 'Opens the merged #959 on GitHub' } },
    stopped: { 'Start a new run': { to: 'starting', say: 'A new run with the same task' }, 'Restart Build': { to: 'working', say: 'Build runs again from where it stopped' } },
    discarded: { 'Start a new run': { to: 'starting', say: 'A new run with the same task' } },
    push: { 'Push main': { to: 'merged', say: 'Pushed to origin/main' }, 'Create PR instead': { to: 'checks', say: 'Opened #959 into dev', dialog: 'pr' }, Discard: { to: 'discarded', confirm: 'Discard the changes? The run stays in history.' } },
    folder: { 'Apply to folder': { to: 'applied', confirm: 'Write 5 files into ~/src/marketing-site?' }, 'Open the copy': { say: 'Opened the copy in a terminal' }, Discard: { to: 'discarded', confirm: 'Discard the changes? The run stays in history.' } },
    applied: { 'Open the folder': { say: 'Opens ~/src/marketing-site' } },
    workspace: { 'Fix conflicts': { say: 'A short run is fixing worca-docs #31' }, 'worca-api #212': { say: 'Opens worca-api #212' }, 'worca-web #88': { say: 'Opens worca-web #88' }, 'worca-docs #31': { say: 'Opens worca-docs #31' }, 'Copy PR links': { say: 'Copied 3 PR links' } },
    clarify: { 'Send answer': { to: 'plan', say: 'Answers sent; the planner writes the plan' }, 'Use defaults': { to: 'plan', say: 'Defaults used; the planner writes the plan' } },
    plan: { 'Approve and build': { to: 'working', say: 'Plan approved; Build starts' }, 'Ask for changes': { say: 'Sent to the planner; it plans again' }, 'Full plan': { say: 'Opens plan.md' } },
    outline: { 'Approve 3 runs': { to: 'feature', say: 'The feature has 3 runs; run 1 starts' }, 'Ask me before each run': { say: 'Worca asks before runs 2 and 3 start' }, 'Don’t split': { to: 'plan', say: 'One run, one PR' }, 'Ask for changes': { say: 'Sent to the planner; it cuts again' } },
    feature: { next: 'featureready' },
    featureready: { 'Create 3 PRs': { to: 'chain', say: 'Opened #959, #960 and #961, each into the one before', dialog: 'pr' }, 'Create PR': { to: 'checks', say: 'Opened #959 for all 3 runs', dialog: 'pr' }, 'Try it': { say: 'Copied: git switch feat/unified-page-navigation' }, Discard: { to: 'discarded', confirm: 'Discard all 3 runs’ changes?' } },
    featureone: { 'Create PR': { to: 'checks', say: 'Opened #959 for both runs', dialog: 'pr' }, 'Create 2 PRs': { to: 'chain', say: 'Opened #959 and #960', dialog: 'pr' }, 'Try it': { say: 'Copied: git switch feat/unified-page-navigation' }, Discard: { to: 'discarded', confirm: 'Discard both runs’ changes?' } },
    featureblocked: { 'Create 3 PRs': { to: 'chain', say: 'Opened #959, #960 and #961, each into the one before', dialog: 'pr' }, 'Try it': { say: 'Copied: git switch feat/unified-page-navigation' }, Discard: { to: 'discarded', confirm: 'Discard all 3 runs’ changes?' } },
    chain: { 'Fix checks on #961': { say: 'A short run is fixing #961’s checks' }, 'Merge #959': { say: 'Merged #959 into dev; #960 now points at dev', confirm: 'Merge #959 into dev?' }, 'View PRs': { say: 'Opens #959, #960 and #961 on GitHub' }, 'Watch PRs': { say: 'Worca watches all three PRs' }, 'Copy PR links': { say: 'Copied 3 PR links' } },
  };
  // Run-wide controls: what Pause, Stop and ⋯ lead to, from any live run.
  const RUN_FLOW = { pauseNow: { to: 'paused', say: 'Paused; Resume goes on from Implementation' }, pauseAfter: { to: 'paused', say: 'Pauses after the current step finishes' },
    stop: { to: 'stopped', confirm: 'Stop the run? The branch and changes stay.' } };

  // The + menu: what each kind is for, a placeholder for typing one, and the existing values to pick from.
  const ADD = [{ kind: 'label', menu: 'Label', help: 'Find and filter runs by it in the Runs list', placeholder: 'Type or pick a label', suggest: ['ui', 'hotfix', 'needs demo'] },
    { kind: 'tag', menu: 'Cost tag', help: 'Splits this run’s cost in Statistics', placeholder: 'key: value', suggest: ['team: web', 'team: api', 'client: acme'] },
    { kind: 'group', menu: 'Add to group', help: 'Tracks it with related runs on one page', placeholder: 'New group name', suggest: ['Navigation', 'Billing export', 'Onboarding'] }];
  window.RunCardModel = { proposed: PROPOSED, isNew: (t) => NEW.has(t), flow: FLOW, runFlow: RUN_FLOW, cases: CASES.map((c) => ({ id: c.id, label: c.label, group: c.group, chips: c.chips || [] })), view, add: ADD };
})();
