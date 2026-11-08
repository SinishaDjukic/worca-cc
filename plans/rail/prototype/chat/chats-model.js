// The Chats column's mock: the chats and their topic groups. `state` is a chat state (R.chatState), `kind` what it did.
(function () {
  const chat = (id, title, state, kind, project, time, day, o = {}) => ({ id, title, state, kind, project, time, day, cost: null, pinned: false, archived: false, unread: false, group: '', origin: null, rank: 0, labels: [], tasks: [], ...o });
  const base = () => ({
    groups: [{ id: 't-bill', name: 'Billing export', total: 4 }, { id: 't-rel', name: 'Release 1.20', total: 2 }, { id: 't-ops', name: 'On call', total: 2 }],
    chats: [
      chat('c1', 'Billing CSV export', 'needs-you', 'started', 'billing-api', '14:32', 'today', { cost: 1.2, unread: true, labels: ['hotfix', 'billing'], tasks: [
        { id: 't1', run: 'r1', title: 'Add CSV export to billing', depth: { steps: [{ meta: '3 min · $0.40', arts: ['plan.md'] }, { meta: '2 cycles · 9 min · $1.06' }, { meta: 'cycle 2 of 3 · 4 agents running · $0.31 so far', arts: ['review-cycle-2.md', 'export-50k.png', 'timings.csv'] }],
          log: [{ s: 0, c: 1, t: '13:38:02', from: 'planner', text: 'Read the billing module and its tests', sum: true }, { s: 0, c: 1, t: '13:40:47', from: 'planner', text: 'Wrote plan.md: 4 steps, streaming the rows', sum: true },
            { s: 1, c: 1, t: '13:41:10', from: 'implementer', text: 'Added export.mjs and columns.mjs', sum: true }, { s: 1, c: 1, t: '13:44:31', from: 'implementer', text: 'npm test: 3 failed in export.test.mjs', lvl: 'error', sum: true }, { s: 1, c: 1, t: '13:44:32', from: 'implementer', text: 'expected 50000 rows, got 49999 (the header counted)', lvl: 'error' },
            { s: 1, c: 2, t: '13:45:02', from: 'implementer', text: 'Fixed the off-by-one: the header is not a row', sum: true }, { s: 1, c: 2, t: '13:50:40', from: 'implementer', text: 'npm test: 214 passed', sum: true },
            { s: 2, c: 1, t: '13:51:12', from: 'reviewer', text: 'Cycle 1: the retry lives in the caller; sent back', lvl: 'warn', sum: true },
            { s: 2, c: 2, t: '14:02:11', from: 'reviewer', text: 'Reading export.mjs and columns.mjs', sum: true }, { s: 2, c: 2, t: '14:02:20', from: 'reviewer', text: 'git diff dev...feat/billing-csv-export: 5 files' }, { s: 2, c: 2, t: '14:02:40', from: 'reviewer ▸ security', text: 'Checking the CSV for formula injection', sum: true }, { s: 2, c: 2, t: '14:02:58', from: 'reviewer ▸ security', text: 'Cells starting with = + - @ are quoted: fine' }, { s: 2, c: 2, t: '14:03:05', from: 'reviewer ▸ browser', text: 'Exporting 50k rows in the browser', sum: true }, { s: 2, c: 2, t: '14:03:41', from: 'reviewer ▸ browser', text: '50,000 rows in 2.8 s, 4.1 MB', sum: true }],
          arts: [{ name: 'plan.md', step: 'Plan', size: '4 KB', icon: 'file', body: '<h3>Add CSV export to billing</h3><p>1. Stream the invoice rows, never all in memory. 2. One column per field, in the table\'s order. 3. Quote cells that start with = + - @. 4. Test 50k rows and the empty list.</p>' },
            { name: 'review-cycle-2.md', step: 'Review · cycle 2', size: '2 KB', icon: 'file', body: '<h3>Review, cycle 2</h3><p>The export streams rows and the totals match. Two things to confirm: the retry lives in the caller, and the empty-list branch has no test.</p>' },
            { name: 'export-50k.png', step: 'Review · a screenshot', size: '180 KB', icon: 'image', body: '<p>The browser after exporting 50,000 rows: the download bar shows billing-2026-11.csv, 4.1 MB.</p>' },
            { name: 'timings.csv', step: 'Review · a table', size: '12 KB', icon: 'list', body: '<table><tr><th>Rows</th><th>Time</th><th>Size</th></tr><tr><td>1,000</td><td>0.1 s</td><td>82 KB</td></tr><tr><td>10,000</td><td>0.6 s</td><td>0.8 MB</td></tr><tr><td>50,000</td><td>2.8 s</td><td>4.1 MB</td></tr></table>' }],
          findings: [{ id: 'f1', sev: 'Major', text: 'Plan deviation: the retry lives in the caller', at: 'export.mjs:41' }, { id: 'f2', sev: 'Minor', text: 'No unit test for the empty-list branch', at: 'columns.mjs:88' }] }, facts: { cost: '$1.84', time: '23 min', agents: 3, files: 5, artifacts: 2 }, case: 'question', stage: 2, git: 'open', watch: 'idle', branch: 'feat/billing-csv-export', detail: 'Review · step 2 of 3', after: [{ id: 't2', title: 'Invoices export', case: 'scheduled', stage: 0, branch: 'feat/invoices-export', detail: 'Starts after Add CSV export', endWord: 'after it' }] },
        { id: 's1', kind: 'schedule', title: 'Nightly export check', time: '02:00', detail: 'Every day at 02:00 · Next in 11h' }] }),
      chat('c0', 'Getting started', 'idle', 'chat', '', 'now', 'today', { pinned: true }),
      chat('c16', 'Migrate the cron parser', 'idle', 'started', 'worca-cc', '13:40', 'today', { cost: 6.1, tasks: [{ id: 't16', run: 'r2', title: 'Migrate cron parser', case: 'gate', stage: 2, git: 'branch', branch: 'refactor/cron-parser', detail: 'Waits for your OK on the review', why: ['Review sent it back 3 times; the limit is 3', '2 small things left: a name in parser.mjs, a leap-year test'] }] }),
      chat('c17', 'Node 24', 'idle', 'started', 'web-app', '12:40', 'today', { cost: 4.2, labels: ['hotfix'], tasks: [{ id: 't17', run: 'r5', title: 'Update Node to 24', case: 'failed', stage: 1, git: 'branch', branch: 'chore/node-24', detail: 'Build · 3 tests failed', why: ['✗ fetch keeps the connection alive: socket hang up on Node 24', '✗ crypto.createCipher is gone in Node 24', '✗ the build image still pins node:20'] }] }),
      chat('c18', 'Audit log pager', 'idle', 'started', 'worca-cc', '10:20', 'today', { cost: 5.2, tasks: [{ id: 't18', run: 'r9', title: 'Add pager to the audit log', case: 'approved', stage: 3, git: 'pass', watch: 'idle', branch: 'feat/audit-log-pager', detail: 'Approved · checks pass', why: ['✓ unit', '✓ e2e', '✓ lint', 'Approved by Maya'] }] }),
      chat('c19', 'Retry on 502', 'idle', 'started', 'web-app', '11:20', 'today', { cost: 7.3, labels: ['hotfix'], tasks: [{ id: 't19', run: 'r7', title: 'Retry on 502', case: 'failing', stage: 3, git: 'fail', branch: 'fix/retry-502', detail: 'Checks failing · 2 of 7: unit, e2e' }] }),
      chat('c2', 'Why did the build fail', 'replying', 'chat', 'web-app', '14:30', 'today', { cost: 0.4 }),
      chat('c3', 'Tidy the migrations', 'command', 'workflow', 'worca-cc', '14:12', 'today', { cost: 0.9, tasks: [{ id: 't3', kind: 'workflow', title: 'Tidy the migrations', case: 'working', stage: 1, git: 'branch', branch: 'chore/tidy-migrations', detail: 'Build · step 1 of 2' }] }),
      chat('c4', 'Track the flaky login fix', 'following', 'tracks', 'web-app', '13:58', 'today', { cost: 0.2, origin: { platform: 'slack' }, tasks: [{ id: 't4', run: 'r10', title: 'Fix flaky login test', case: 'checks', stage: 3, git: 'branch', branch: 'fix/flaky-login', detail: 'Round 3 · Fixing 2 failed checks' }] }),
      chat('c5', 'Plan the API rewrite', 'idle', 'workflow', 'worca-cc', '12:20', 'today', { cost: 2.4, pinned: true, tasks: [{ id: 'f5a', run: 'm1', kind: 'feature', title: 'Trail in the top bar', case: 'ready', stage: 3, git: 'pass', branch: 'feat/trail', detail: 'Ready · Shaper slice 1 of 3' }, { id: 'f5b', run: 'm2', kind: 'feature', title: 'Pager between runs', case: 'working', stage: 1, git: 'branch', branch: 'feat/pager', detail: 'Build · Shaper slice 2 of 3' }, { id: 'f5c', run: 'm3', kind: 'feature', title: 'Deep links', case: 'scheduled', stage: 0, detail: 'Shaper slice 3 of 3 · after the pager', endWord: 'after it' }] }),
      chat('c6', 'Export columns', 'idle', 'chat', 'billing-api', '11:40', 'today', { cost: 0.5, group: 't-bill' }),
      chat('c7', 'Export email wording', 'idle', 'started', 'billing-api', '10:10', 'today', { cost: 1.1, group: 't-bill' }),
      chat('c8', 'Incident in the Telegram room', 'idle', 'chat', '', '09:15', 'today', { origin: { platform: 'telegram' } }),
      chat('c9', 'Release checklist', 'idle', 'started', 'worca-cc', 'Yesterday', 'yesterday', { cost: 3.3, group: 't-rel', tasks: [{ id: 't9s', title: 'Bump dependencies', case: 'scheduled', stage: -1, detail: 'Starts at 17:00, after the release' }, { id: 't9', title: 'Write the notes', case: 'merged', stage: 4, git: 'merged', branch: 'docs/release-notes', detail: 'Merged #1101 into dev' }] }),
      chat('c10', 'Changelog draft', 'idle', 'chat', 'docs-site', 'Yesterday', 'yesterday', { cost: 0.6, group: 't-rel' }),
      chat('c11', 'Who owns the cron parser', 'idle', 'tracks', 'worca-cc', 'Yesterday', 'yesterday', { origin: { platform: 'discord' }, group: 't-ops' }),
      chat('c12', 'Pager rota', 'idle', 'chat', 'web-app', 'Tue', 'week', { origin: { platform: 'teams' }, group: 't-ops' }),
      chat('c13', 'Compare two queue libraries', 'idle', 'chat', '', 'Mon', 'week', { cost: 0.7 }),
      chat('c14', 'Old invoice bug', 'idle', 'started', 'billing-api', 'Oct 20', 'month', { archived: true, cost: 1.4, group: 't-bill' }),
      chat('c15', 'A plugin chat', 'idle', 'chat', 'web-app', 'Oct 12', 'month', { origin: { platform: 'mattermost', label: 'Mattermost' } }),
      ...['Rename the env vars', 'Docker layer cache', 'Sentry noise', 'Fonts on Safari', 'Slow query on orders', 'Webhook retries', 'Cookie banner copy', 'Audit table index', 'Move to pnpm', 'Sitemap again', 'Backfill the stats'].map((t, i) => chat(`o${i}`, t, 'idle', i % 3 ? 'chat' : 'started', ['web-app', 'worca-cc', 'billing-api'][i % 3], ['Sep 12', 'Aug 30', 'Aug 2', 'Jul 18'][i % 4], 'older', { cost: i % 2 ? 0.3 + i / 10 : null })),
    ],
  });
  // What waits on you and what is unread follow the Pulse case in view (shell/world.js), so Updates and the column agree.
  const QUIET = { replying: 'idle', command: 'idle', following: 'idle' };
  // One store (shell/world.js): a chat's task is a task in the store, by its id (`run`); the chat keeps only where it is in
  // the talk. Its name, state, stage and line are read from the store, after every change anywhere.
  const GIT = { checks: 'open', 'pr-fixing': 'fail', failing: 'fail', approved: 'pass', ready: 'branch', merged: 'merged', conflicts: 'conflict' };
  const link = (c, t) => {
    if (t.kind === 'schedule') return t;
    const W = window.RailWorld; if (t.run && W.find(t.run)) return t;
    const r = W.add({ id: t.run || `k-${t.id}`, case: t.case || 'starting', title: t.title, project: c.project || '', detail: t.detail || '', stage: t.stage, chat: c.id, day: t.case === 'scheduled' ? 'upcoming' : 'today', when: t.case === 'scheduled' ? 'after' : undefined });
    t.run = r.id; return t;
  };
  const sync = (c) => {
    const walk = (t) => {
      const r = t.run && window.RailWorld.find(t.run);
      if (r) {
        const st = window.RunCardModel?.stageOf?.(r.case) || {}, merged = r.case === 'merged';
        Object.assign(t, { title: r.title, case: r.case, detail: r.detail, stage: merged ? 4 : r.stage ?? (st.stage >= 0 ? st.stage : t.stage) });   // its stage is the store's, else its state's
        if (t.git && GIT[r.case]) t.git = GIT[r.case];   // its PR mark follows its state: checks running is an open PR, not a red one
      }
      (t.after || []).forEach(walk);
    };
    (c.tasks || []).forEach(walk);
  };
  const seed = () => {
    const d = base(), f = window.RailWorld.facts().chats;
    if (window.RailFirstRun) { d.groups = []; d.chats = d.chats.filter((c) => c.id === 'c0'); }   // the first run: Getting started alone
    for (const c of d.chats) {
      const walk = (t) => { link(c, t); (t.after || []).forEach(walk); }; (c.tasks || []).forEach(walk);   // every task in the store, once
      sync(c);
      c.unread = (f.unread || []).includes(c.id);
      c.state = (f.needs || []).includes(c.id) ? 'needs-you' : c.state === 'needs-you' ? 'idle' : f.quiet ? QUIET[c.state] || c.state : c.state;
    }
    return d;
  };
  // A conversation's turns: what a person said, what Worca said, what it did. Work points at its task.
  const thread = (c) => {
    if (c.fromTask) return (c.tasks || []).map((x, i) => ({ t: 'task', id: `b${i}`, task: x.id }));   // opened from Tasks or Pulse: its card, nothing made up
    if (c.id === 'c0') return [   // the first minutes: a chat like any other, so nothing new to learn
      { t: 'words', html: 'Hi, I’m Worca. I run coding tasks for you: you say what to do, I plan it, build it, review it and open a pull request. Two things first, then your first task.' },
      { t: 'change', id: 'g1', kind: 'Sign-in', title: 'Sign in to Claude Code', why: 'Worca uses your own Claude to do the work', rows: [{ name: 'Engine', before: '', after: 'Claude Code' }], choice: { label: 'Use', items: ['your Claude subscription', 'an Anthropic API key'], rec: 'your Claude subscription' }, apply: 'Sign in', state: 'proposed' },
      { t: 'change', id: 'g2', kind: 'Project', title: 'Add your first project', why: 'Worca works in a project: a folder, a clone, or a new one', how: 'Folder', state: 'proposed' },
    ];
    if (c.id === 'c1') return [
      { t: 'you', id: 'a1', text: 'Add a CSV export to the billing page', when: '14:02' },
      { t: 'think', text: 'Thought for 8s' },
      { t: 'commands', id: 'g1', dur: '12.0s', rows: [{ summary: 'Checked what changed', cmd: 'git status --short', end: '0.4s', out: ' M src/billing/export.mjs' }, { summary: 'Found where the export is built', cmd: 'rg "exportCsv" src', end: '0.9s', out: 'src/billing/export.mjs:12: export function exportCsv(rows) {' }, { summary: 'Linted the code', cmd: 'npm run lint', end: '3.1s', out: '✓ no problems' }, { summary: 'Ran the billing tests', cmd: 'npm test -- billing', end: '7.6s', out: '✓ 42 tests passed' }], dir: 'billing-api' },
      { t: 'words', html: 'I\'ll start a task on <b>billing-api</b>: plan, build and review, then a pull request into dev.' },
      { t: 'task', id: 'a2', task: 't1' },
      { t: 'question', id: 'a3', task: 't1', text: 'Which date format should the export use?', options: ['ISO 8601 (2026-11-07)', 'The account\'s locale'], pick: 0, when: '14:32' },
      { t: 'you', id: 'a4', text: 'Also add it to invoices when it\'s done, and check the export every night', when: '14:34' },
      { t: 'task', id: 'a5', task: 't2' },
      { t: 'schedule', id: 'a6', task: 's1' },
    ];
    if (c.id === 'c2') return [
      { t: 'you', id: 'a1', text: 'Why did the build fail?', when: '14:28' },
      { t: 'think', text: 'Thought for 8s' },
      { t: 'commands', id: 'a2', dur: '12.0s', dir: 'web-app', when: '14:29', rows: [{ summary: 'Read the failed CI run', cmd: 'gh run view 8841', end: '1.2s', out: 'X build · test (ubuntu) failed in 3m' }, { summary: 'Looked at the last commits', cmd: 'git log -3 --oneline', end: '0.2s', out: '3e4f5a6 Stream the export\n19ab20c Add the column picker\n0c1d2e3 Bump node' }, { summary: 'Installed the packages', cmd: 'npm ci', end: '7.6s', out: 'added 412 packages in 7s' }, { summary: 'Ran the export tests', cmd: 'npm test -- export', state: 'fail', end: 'exit 1 · 3.0s', out: '✗ exports 50k rows under 2s\n  expected 1980ms, got 11240ms\n  at test/export.test.mjs:42' }] },
      { t: 'words', html: 'The export loads every row into memory, then sorts it. On accounts over 50k rows that takes most of the 11 seconds. Two changes fix it:' },
      { t: 'words', html: '1. Stream rows from <code>listInvoices</code> instead of loading them.<br>2. Let the database sort, using the index on <code>created_at</code>.' },
      { t: 'code', file: 'export.mjs', text: 'for await (const row of db.stream(query)) {\n  out.write(toCsv(row));\n}' },
      { t: 'files', text: '2 files changed', meta: '+42 −8' },
      { t: 'working', text: 'Replying', end: '42s' },
    ];
    // The rest of a chat's cards, each where it comes up: a PR to open, a receipt, a stop warning; a project switch and its
    // divider; a settings change; a workflow; questions with Worca's picks.
    if (c.id === 'c9') return [
      { t: 'you', id: 'a1', text: 'Is the release branch ready?', when: '11:40' },
      { t: 'think', text: 'Thought for 5s' },
      { t: 'words', html: 'Everything for 1.20 is in and the checks passed.' },
      { t: 'act', id: 'a2', mark: 'git', text: '<b>Ready to open a PR</b> 12 files +540 −96 into main', actions: [['Create PR', 'primary', 'Opened PR #1104 into main'], ['View changes', 'quiet', 'Opens the changes']] },
      { t: 'you', id: 'a3', text: 'Bump the version to 1.20.0', when: '11:42' },
      { t: 'change', id: 'a4', kind: 'Version', title: 'Version bumped', rows: [{ name: 'package.json', before: '1.19.4', after: '1.20.0' }], state: 'applied' },
      { t: 'task', id: 'a4b', task: 't9s' },
      { t: 'you', id: 'a5', text: 'Stop the flaky login fix, it can wait', when: '11:44' },
      { t: 'you', id: 'a7', text: 'Plan the follow-ups for 1.20 with me', when: '11:50' },
      { t: 'form', id: 'f1', kind: 'slider', text: 'How many review rounds before a follow-up asks you?', min: 1, max: 6, value: 3, pick: 4, unit: 'rounds' },
      { t: 'form', id: 'f2', kind: 'rank', text: 'What matters most in the release notes? Put them in order.', items: [{ id: 'i1', text: 'What changed for users' }, { id: 'i2', text: 'How to upgrade' }, { id: 'i3', text: 'Fixed issues by number' }] },
      { t: 'form', id: 'f3', kind: 'rows', text: 'Which tickets should become tasks?', cols: ['Ticket', 'Estimate', 'Priority'], rows: [{ id: 'r1', cells: ['REL-88 · Changelog page', '2 h', 'High'], checked: true }, { id: 'r2', cells: ['REL-90 · Docs for 1.20', '1 day', 'High'], checked: true }, { id: 'r3', cells: ['REL-93 · Old flags clean-up', '3 days', 'Low'], checked: false }] },
      { t: 'change', id: 'w9', kind: 'Workflow', title: 'Security-first review', why: 'Proposed from this chat · you asked for a security pass before each PR', steps: [['Plan', 'Plan', 'Opus 5.5', 'high'], ['Build', 'Implementation', 'Sonnet 5.5', 'high'], ['Security', 'Security review', 'Opus 5.5', 'high'], ['Review', 'Review', 'Opus 5.5', 'medium']], loop: ['Security', 'Build', '2'], cost: 'Each task costs about $0.40 more and 6 minutes longer than Default', apply: 'Save', state: 'proposed' },
      { t: 'change', id: 'p9', kind: 'Settings', title: 'Route tasks through the company proxy', why: 'You said downloads fail on the VPN', rows: [{ name: 'Proxy', before: 'None', after: 'proxy.corp.example:3128' }, { name: 'Skips', before: '', after: 'localhost, *.internal' }], apply: 'Apply', state: 'proposed' },
      { t: 'act', id: 'a6', mark: 'ask', text: '<b>Stop Fix flaky login test?</b> 12 minutes of Review are lost', actions: [['Stop', 'danger', 'Stopped Fix flaky login test'], ['Not now', 'quiet', 'Kept running']] },
    ];
    if (c.id === 'c11') return [
      { t: 'you', id: 'a1', text: 'Who owns the cron parser?', when: 'Mon' },
      { t: 'act', id: 'a2', mark: 'ask', done: 'This chat is on worca-cc now', text: '<b>This sounds like worca-cc.</b> Use it for this chat?', actions: [['Use worca-cc', 'primary', 'This chat is on worca-cc now'], ['Keep no project', 'quiet', 'This chat stays without a project']] },
      { t: 'divider', text: 'Switched to worca-cc' },
      { t: 'notice', text: 'Read CODEOWNERS and the last 20 commits on src/cron' },
      { t: 'words', html: 'Dana Ruiz owns <code>src/cron</code>: CODEOWNERS names her, and she wrote 14 of its last 20 commits.' },
    ];
    if (c.id === 'c12') return [
      { t: 'you', id: 'a1', text: 'Mute me on weekends, unless something needs me', when: 'Sun' },
      { t: 'words', html: 'Here is the change. Nothing changes until you apply it.' },
      { t: 'change', id: 'a2', kind: 'Away', title: 'Quiet on weekends', why: 'Saturdays and Sundays you only hear about what needs you.', rows: [{ name: 'Away on', before: 'Never', after: 'Saturdays and Sundays' }, { name: 'While away', before: 'Every update', after: 'Only what needs you' }], state: 'proposed' },
    ];
    if (c.id === 'c5') return [
      { t: 'you', id: 'a1', text: 'Plan the API rewrite as a workflow I can reuse', when: '12:20' },
      { t: 'think', text: 'Thought for 9s' },
      { t: 'change', id: 'a2', kind: 'Workflow', title: 'API rewrite, in three slices', why: 'Plan once, then build each slice behind its own review; a person signs off the contract first.', graph: true, apply: 'Save', state: 'proposed' },
      { t: 'feature', id: 'a3', title: 'Unified page navigation', slices: [{ title: 'Trail in the top bar', case: 'ready', stage: 2, detail: 'Ready' }, { title: 'Pager between runs', case: 'working', stage: 1, detail: 'Build · step 1 of 2' }, { title: 'Deep links', case: 'scheduled', stage: -1, detail: 'After the pager' }] },
    ];
    if (c.id === 'c6') return [
      { t: 'you', id: 'a1', text: 'Which columns should the CSV export have? Shape it first', when: '13:10' },
      { t: 'think', text: 'Thought for 12s' },
      { t: 'words', html: 'Shaper drafted a plan and five roles reviewed it. One thing is still open:' },
      { t: 'plan', id: 'a2', title: 'CSV export: columns and rollout', summary: 'Twelve columns in the invoice table’s order, dates in ISO 8601, money in the account’s currency.', v: 2, versions: 2,
        roles: [{ name: 'Product', ok: true, note: 'Columns match what support gets asked for' }, { name: 'Security', ok: false, note: 'Wants it behind a flag for a week' }, { name: 'UX', ok: true, note: 'Header names read well in Excel' }, { name: 'Data', ok: true, note: 'Totals reconcile with the invoice' }, { name: 'Performance', ok: true, note: 'Streams; fine past 50k rows' }] },
      { t: 'question', id: 'a3', text: 'Security and UX disagree on the rollout', options: ['Behind a flag for a week (Security)', 'To everyone at once (UX)'], pick: 0, when: '13:12' },
      { t: 'question', id: 'a4', text: 'How should it ship?', options: ['One PR', 'A stack of three PRs', 'One PR behind a flag'], pick: 2, when: '13:12' },
      { t: 'change', id: 'a5', kind: 'Changes', title: 'Proposed changes', why: 'What Build will change, before it does.', rows: [{ name: 'export.mjs', before: 'loads every row', after: 'streams rows' }, { name: 'columns.mjs', before: '8 columns', after: '12 columns' }, { name: 'flags.json', before: '', after: 'csvExport, off' }], apply: 'Start building', state: 'proposed' },
      { t: 'cmds', text: 'Agreed requirements · 8, by perspective', end: '', body: 'Product: twelve columns in the invoice table’s order\nSecurity: behind a flag for a week\nUX: header names in plain words\nData: totals reconcile with the invoice\n…' },
      { t: 'feature', id: 'a7', title: 'CSV export, in three tasks', split: true, slices: [{ title: 'Columns and order', detail: 'Build, review', case: 'scheduled', stage: -1 }, { title: 'Dates and money', detail: 'Build, review', case: 'scheduled', stage: -1 }, { title: 'Behind a flag', detail: 'Build', case: 'scheduled', stage: -1 }] },
      { t: 'gate', id: 'a8', title: 'A decision is needed', line: '2 issues in Columns and order', actions: [['Accept as is', 'primary', 'Accepted as is: manual tests start'], ['Run another cycle', 'quiet', 'One more Build and Review round'], ['Stop', 'quiet', 'Stopped at the review']] },
      { t: 'ship', id: 'a6', title: 'Ship CSV export', reqs: [{ text: 'Twelve columns in the table’s order', v: 'Met' }, { text: 'Dates in ISO 8601', v: 'Met' }, { text: 'Behind a flag for a week', v: 'Not met: moved to a later task' }] },
    ];
    if (c.id === 'c14') return [
      { t: 'you', id: 'a1', text: 'This is what the customer sent. Same bug as last year?', refs: [{ title: 'Add CSV export', case: 'question' }], quote: 'The total on invoice 4411 is off by one cent', files: ['invoice-4411.pdf', 'screenshot.png'], when: 'Oct 2' },
      { t: 'think', text: 'Thought for 7s' },
      { t: 'words', html: 'Yes: rounding per line, then summing. I put the two side by side:' },
      { t: 'filesgrid', label: 'What I compared', files: [{ name: 'invoice-4411.png', image: true }, { name: 'rounding-diff.png', image: true }, { name: 'repro.txt', meta: '2 KB' }] },
    ];
    if (c.id === 'c10') return [
      { t: 'you', id: 'a1', text: 'Make an agent that drafts the changelog from merged PRs', when: 'Oct 1' },
      { t: 'change', id: 'a2', kind: 'Agent', title: 'Changelog writer', why: 'Reads the PRs merged since the last tag and writes one line per change, grouped by area.', rows: [{ name: 'Reads', before: '', after: 'Merged PRs since the last tag' }, { name: 'Writes', before: '', after: 'CHANGELOG.md, a draft' }, { name: 'Model', before: '', after: 'Sonnet 5.5' }], apply: 'Save', state: 'proposed' },
      { t: 'act', id: 'a3', mark: 'ask', text: '<b>Run scripts/release-notes.sh?</b> It reads git tags and writes nothing', actions: [['Run', 'primary', 'Ran scripts/release-notes.sh: 14 changes found'], ['Not now', 'quiet', 'Not run']] },
      { t: 'you', id: 'a4', text: 'Write a guide for the CSV export', when: 'Yesterday' },
      { t: 'change', id: 'a5', kind: 'Changes', title: '3 files changed on a copy of docs-site', why: 'docs-site has no git: the task worked on a copy. Apply it to the folder, or discard it.', rows: [{ name: 'Adds', before: '', after: 'guides/export.md' }, { name: 'Updates', before: '', after: 'index.md, nav.yml' }, { name: 'Checked', before: '', after: 'nothing changed in the folder since it started' }], diff: [['guides/export.md', '+42'], ['index.md', '+3 −1'], ['nav.yml', '+1']], actions: [['Apply 3 files', 'primary', 'Applied 3 files to docs-site'], ['Show the diff', 'quiet', ''], ['Discard', 'danger', 'Discarded the copy: docs-site is as it was']], state: 'proposed' },
    ];
    if (c.id === 'c7') return [
      { t: 'you', id: 'a1', text: 'Check what Stripe says about CSV exports', when: 'Oct 3' },
      { t: 'change', id: 'a2', kind: 'Web access', title: 'Read stripe.com/docs', why: 'This chat wants to read one page on the web.', rows: [{ name: 'Site', before: '', after: 'stripe.com' }], actions: [['Allow in chat', 'primary', 'Allowed in this chat'], ['Always allow', 'quiet', 'Always allowed'], ['Not now', 'quiet', 'Not allowed']], state: 'proposed' },
      { t: 'you', id: 'a3', text: 'Move the nightly export check to 03:00', when: 'Oct 3' },
      { t: 'change', id: 'a4', kind: 'Schedule', title: 'Nightly export check', rows: [{ name: 'Runs', before: 'every day at 02:00', after: 'every day at 03:00' }, { name: 'Next', before: '', after: 'tonight 03:00 · tomorrow 03:00' }], actions: [['Move', 'primary', 'Moved to 03:00'], ['Run now', 'quiet', 'Running now'], ['Not now', 'quiet', 'Not changed']], menuItems: ['Delete schedule'], state: 'proposed' },
      { t: 'you', id: 'a5', text: 'Take docs-site out of the Billing workspace', when: 'Oct 3' },
      { t: 'change', id: 'a6', kind: 'Workspace', title: 'Remove docs-site', rows: [{ name: 'Workspace', before: '', after: 'Billing' }, { name: 'Remove', before: '', after: 'docs-site' }], choice: { label: 'Re-scan after', items: ['No re-scan', 'Partial re-scan', 'Full re-scan'], rec: 'Partial re-scan' }, actions: [['Remove', 'danger', 'Removed docs-site'], ['Not now', 'quiet', 'Not changed']], state: 'proposed' },
    ];
    if (c.id === 'c3') return [
      { t: 'you', id: 'a1', text: 'Tidy the migrations folder', when: '14:12' },
      { t: 'think', text: 'Thought for 4s' },
      { t: 'commands', id: 'g3', dir: 'worca-cc', rows: [{ summary: 'Counted the migrations: 84 files', cmd: 'ls migrations | wc -l', end: '0.4s', out: '84' }] },
      { t: 'words', html: '84 migrations; 61 are older than the squash point. Squashing them, first as a dry run:' },
      { t: 'cmd', cmd: 'npm run db:squash -- --dry-run', sum: 'Squashing the migrations (a dry run)', dir: 'worca-cc' },
    ];
    if (c.id === 'c13') return [
      { t: 'you', id: 'a1', text: 'Compare two queue libraries for the export jobs', when: 'Mon' },
      { t: 'words', html: 'Two things decide it. Answer them, or take my picks for both:' },
      { t: 'question', id: 'a2', text: 'How many jobs a minute at peak?', options: ['Under 100', '100 to 10,000', 'More than 10,000'], pick: 1, many: 'a3', when: 'Mon' },
      { t: 'question', id: 'a3', text: 'Can jobs be lost if the server restarts?', options: ['No, every job must survive', 'A few is fine'], pick: 0, when: 'Mon' },
    ];
    const out = [{ t: 'you', id: 'a1', text: c.title, when: c.time }, { t: 'think', text: 'Thought for 6s' }, { t: 'words', html: (c.tasks || []).some((t) => t.kind !== 'schedule') ? 'I’ll do it as a task:' : c.state === 'idle' ? 'Here is the answer, from the project’s code.' : 'On it.' }];
    (c.tasks || []).forEach((x, i) => out.push({ t: x.kind === 'schedule' ? 'schedule' : 'task', id: `b${i}`, task: x.id }));
    // a chat that follows a task shows the task's card, which is live; one replying or running a command finishes soon after you look
    if (['replying', 'command'].includes(c.state)) out.push({ t: 'working', text: window.RailUI.chatState(c.state).line, end: '12s', settle: 'Done: the answer is above, with the files it read.' });
    return out;
  };
  window.ChatsListModel = { thread, seed, sync, link, DAYS: window.RailUI.DAY_SECTIONS.filter(([d]) => d !== 'upcoming') };
})();
