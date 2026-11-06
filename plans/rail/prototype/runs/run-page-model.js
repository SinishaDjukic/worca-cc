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
    { id: 'question', group: 'Run', label: 'Needs you', figs: LIVE_FIGS,
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
    { id: 'feature', group: 'Groups', runCases: ['ready', 'slice', ''], label: 'Feature, run 2', kind: 'Feature', title: 'Unified page navigation', branch: '', figs: [['Time', '3h 20m'], ['Cost', '$61.10'], ['Rate', '$18.30/h']], tabs: GROUP_TABS,
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Cut into runs', '7m', { live: '3 runs, one PR each' })] },
        member(1, RUNS[0], ['done', 'done', 'done', 'done'], { times: ['22m', '58m', '31m', ''] }),
        member(2, RUNS[1], ['done', 'now', 'next', 'next'], { times: ['18m', '40m'], live: ['', 'Editing app.js'], when: ['', '3s ago'] }),
        member(3, RUNS[2], ['next', 'next', 'next', 'next']),
        { key: 'pr', label: 'PRs', subs: [next('#1'), next('#2'), next('#3')] }] },
    { id: 'featureready', n: 3, group: 'Groups', runCases: ['ready', 'ready', 'ready'], label: 'Feature ready', kind: 'Feature', title: 'Unified page navigation', branch: '', figs: [['Time', '5h 02m'], ['Cost', '$92.40']], tabs: GROUP_TABS,
      stack: { mode: 'create', runs: RUNS, rec: 'stack', sizes: ['+278 \u221264', '+41 \u221258', '+39 \u221222'], reason: '3 runs and 502 changed lines, most of them in run 1: three focused reviews go faster than one mixed one.' },
      stages: [{ key: 'plan', label: 'Plan', subs: [ok('Clarify', '34s'), ok('Plan', '33m 57s'), ok('Cut into runs', '7m')] },
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
  // A case's facts are its own; its state's word, colour and one action are the library's.
  const CTX = { pr: '#959', pr2: '#960', pr3: '#961', base: 'dev', branch: 'feat/unified-page-navigation-one-head-breadcrumb', groupBranch: 'feat/unified-page-navigation', source: SRC, hidden: 'worca/run-7b0bfb1e', folder: '~/src/marketing-site' };
  const ctxOf = (c) => Object.assign({}, CTX, c.n ? { n: c.n } : {}, c.extraItems ? { extraItems: c.extraItems } : {});
  const CASES = CASES0.map((c) => Object.assign({}, R.runState(c.id, ctxOf(c)), c));

  // The stack: the PRs of a feature or chain, in merge order, each based on the one above it.
  const STACKS = {
    outline: { title: '3 runs, one PR each', note: 'Each run builds on the one before', rows: RUNS.map((t, i) => ({ num: String(i + 1), title: t, state: 'next', word: ['Small', 'Medium', 'Small'][i], sub: i ? 'Builds on run ' + i : 'Starts from dev' })) },
    create: { title: 'Ship as', choice: true },
  };
  // A stack in review merges one PR at a time, in order. Each PR's state: ready, review, checks (moved onto dev, checks
  // running again), failing, merged. Merging one makes Worca move the next onto dev (today nothing does: it keeps
  // pointing at the merged branch unless GitHub deletes that branch).
  const CHAIN_PRS = [['#959', '+278 \u221264'], ['#960', '+41 \u221258'], ['#961', '+39 \u221222']];
  const CHAIN_START = ['ready', 'review', 'failing'];
  const PR_LOOK = { ready: ['done', 'Ready to merge', '7 of 7 checks · approved'], review: ['review', 'In review', '5 of 7 checks'],
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
    return Object.assign({}, c, { stages, word: f >= 0 || ready ? 'Needs you' : 'In review', dot: f >= 0 || ready ? 'is-amber' : 'is-peach is-pulse', detail, action });
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

  const INSTANCE_HELP = { 'worca-api #212': 'Merged into main', 'worca-web #88': 'Checks running', 'worca-docs #31': 'Conflicts with main' };
  const HELP_OF = (t) => INSTANCE_HELP[t] || R.actionHelp(t, CTX);

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
    const chain = g.kind === 'Chain';
    let stages = chain ? c0.stages : c0.stages.filter((x) => !SHIP.test(x.key))
      .concat({ key: 'ship', label: 'Ship', subs: [next('With the feature', { live: 'From the feature page, with the other runs' })] });
    const keep = c0.action && R.memberKeeps(c0.action.label);
    const k = SLICE[i] || 0.3;
    const scaled = (c0.stages).map((st) => Object.assign({}, st, { subs: st.subs.map((x) => (x.time ? Object.assign({}, x, { time: fmtMin(toMin(x.time) * k) }) : x)) }));
    stages = chain ? scaled : scaled.filter((x) => !SHIP.test(x.key)).concat(stages.slice(-1));
    return Object.assign({}, c0, { stages, scale: k, title: RUNS[i], kind: '', branch: BRANCH + '-' + (i + 1), diff: ((g.stack && g.stack.sizes) || SIZES)[i],
      action: keep ? c0.action : null, detail: c0.detail || (keep ? '' : chain ? 'Merges in order, from the chain' : c0.word === 'Ready' ? 'Ships with the feature' : ''),
      pr: chain ? g.runPRs[i] : '', base: chain ? (i ? g.runPRs[i - 1] : 'dev') : '', group: g, index: i });
  }
  const memberOf = (g, i) => { const id = (g.runCases || [])[i]; return id ? asMember(CASES.find((x) => x.id === id), g, i) : null; };
  const subState = (st) => R.subState(st.subs);
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
  // Overview reports by exception: it leads with what this state needs from you (an answer, a plan to approve, what
  // broke, or what to check); a running run shows its plan's progress. What went fine is one line each once it is
  // built: the ask, and the evidence (left out when the focus is what broke: that is the evidence). Files and documents
  // are Changes'.
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
    const rounds = DETAIL.rounds['Review implementation'].length;
    const done = built && !live;
    return { focus, outcome: done ? DETAIL.outcome : [], task: DETAIL.task,   // what it did, once it is done
      ask: done ? { parts: DETAIL.ask, unasked: DETAIL.unasked } : null,
      evidence: done && (!focus || focus.kind !== 'broke') ? `Tests pass · Review passed on round ${rounds} · Manual test passed` : '',
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
    const chainSt = ui.stackSt || CHAIN_START;
    if (c.id === 'chain') c = chainLive(c, chainSt);
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
      const src = c.stack.mode === 'review' ? reviewOf(chainSt) : STACKS[c.stack.mode];
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
    const ENDED = /^(Failed|Waiting|Stopped|Discarded|Archived)$/;   // a run in one of these has nothing to pause or stop
    const liveNow = !ENDED.test(c.word) && !c.over && !c.stages.filter((x) => !SHIP.test(x.key)).every((x) => x.subs.every(isDone));
    if (!c.action && liveNow && c.word !== 'Paused') c = Object.assign({}, c, { action: A('Pause', 'pause', false, ['Pause after this step']) });
    if (c.action) {
      const label = sh ? (pick === 'one' ? 'Create PR' : 'Create ' + sh.runs.length + ' PRs') : c.action.label;
      const alt = sh ? [pick === 'one' ? 'Create ' + sh.runs.length + ' stacked PRs instead' : 'Create one PR instead'] : [];
      const items = alt.concat(c.action.items.filter((t) => !/^Create (PR|\d+ PRs)$/.test(t))).concat(liveNow && !c.action.items.includes('Stop') ? ['Stop the run'] : []).concat(liveNow && c.stages.some((x) => x.run) && c.stages.some((x) => x.run && x.subs.every((y) => y.state === 'next')) ? ['Cancel the rest'] : []);
      const helpOf = (t) => HELP_OF(t) || (/^Merge #(\d+)$/.test(t) ? 'Merges ' + t.slice(6) + ' into dev; Worca then moves the next PR onto dev' : /^Fix checks on #/.test(t) ? 'Starts a short run that fixes ' + t.slice(14) + '’s failing checks' : '');
      action = Object.assign({}, c.action, { label, isNew: NEW.has(label), help: helpOf(label), items: items.map((t) => ({ text: t, isNew: NEW.has(t), help: sh && / instead$/.test(t) ? (/one PR/.test(t) && sh.oneBlocked ? 'Not possible: ' + sh.oneBlocked.replace(/^Not possible: /, '') : sh.reason) : helpOf(t), off: /one PR instead/.test(t) && sh && !!sh.oneBlocked })) });
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
      }).concat(NO_DIFF[c.id] ? [] : [{ k: 'Changes', v: c.diff || '+358 −144', tab: (c.tabs || RUN_TABS).some((x) => x[0] === 'changes') ? 'changes' : '' }]),   // links only where a Changes tab exists
      tabs: (c.tabs || RUN_TABS).map(([id, l], i, all) => ({ id, l, n: id === 'runs' ? String(runStages.length) : id === 'changes' ? String(DETAIL.files.length) + (overview(c, live).artifacts.length ? ' · ' + overview(c, live).artifacts.length + ' docs' : '') : id === 'decisions' ? String(DETAIL.decisions.length) : '',
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
      then: (() => { const k = runStages.findIndex((x) => stageState(x.subs) === 'live'); const nx = k >= 0 && runStages[k + 1]; return nx && nx.subs.every((y) => y.state === 'next') && open === runStages[k].key ? { n: k + 2, title: nx.title } : null; })(),
      planHead: runStages.length > 0 && open === 'plan',
      runCases: c.runCases || [], parent: par, over: overview(c, live), ask: DETAIL.asks[c.id] || null, rounds: DETAIL.rounds,
      tabData: DETAIL,
    };
  }

  // An action either moves the run to another state (`to`) or does its job where it is and says so (`say`); `confirm`
  // asks first; events from outside (checks finish, a reviewer approves) are `next`. The table is the library's.
  const FLOW = Object.fromEntries(CASES.map((c) => [c.id, R.actionFlow(c.id, ctxOf(c))]));
  Object.assign(FLOW.workspace, { 'worca-api #212': { say: 'Opens worca-api #212' }, 'worca-web #88': { say: 'Opens worca-web #88' }, 'worca-docs #31': { say: 'Opens worca-docs #31' } });
  const RUN_FLOW = R.runFlow();

  // The + menu: what each kind is for, a placeholder for typing one, and the existing values to pick from.
  const ADD = [{ kind: 'label', menu: 'Label', help: 'Find and filter runs by it in the Runs list', placeholder: 'Type or pick a label', suggest: ['ui', 'hotfix', 'needs demo'] },
    { kind: 'tag', menu: 'Cost tag', help: 'Splits this run’s cost in Statistics', placeholder: 'key: value', suggest: ['team: web', 'team: api', 'client: acme'] },
    { kind: 'group', menu: 'Add to group', help: 'Tracks it with related runs on one page', placeholder: 'New group name', suggest: ['Navigation', 'Billing export', 'Onboarding'] }];
  const TITLES = {};
  // A host page may name a case's run as the row that opens it (the one Worca's Runs list); empty here.
  window.RunCardModel = { titles: TITLES, chainStart: CHAIN_START, chainPrs: CHAIN_PRS.map((x) => x[0]), proposed: PROPOSED, isNew: (t) => NEW.has(t), flow: FLOW, runFlow: RUN_FLOW, cases: CASES.map((c) => ({ id: c.id, label: c.label, group: c.group, chips: c.chips || [] })), view, add: ADD };
})();
