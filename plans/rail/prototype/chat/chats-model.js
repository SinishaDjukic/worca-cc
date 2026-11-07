// The Chats column's mock: the chats and their topic groups. `state` is a chat state (R.chatState), `kind` what it did.
(function () {
  const chat = (id, title, state, kind, project, time, day, o = {}) => ({ id, title, state, kind, project, time, day, cost: null, pinned: false, archived: false, unread: false, group: '', origin: null, rank: 0, labels: [], tasks: [], ...o });
  const base = () => ({
    groups: [{ id: 't-bill', name: 'Billing export', total: 4 }, { id: 't-rel', name: 'Release 1.20', total: 2 }, { id: 't-ops', name: 'On call', total: 2 }],
    chats: [
      chat('c1', 'Billing CSV export', 'needs-you', 'started', 'billing-api', '14:32', 'today', { cost: 1.2, unread: true, labels: ['hotfix', 'billing'], tasks: [
        { id: 't1', run: 'r1', title: 'Add CSV export to billing', case: 'question', stage: 2, git: 'open', watch: 'idle', branch: 'feat/billing-csv-export', detail: 'Review · step 2 of 3', after: [{ id: 't2', title: 'Invoices export', case: 'scheduled', stage: 0, branch: 'feat/invoices-export', detail: 'Starts after Add CSV export', endWord: 'after it' }] },
        { id: 's1', kind: 'schedule', title: 'Nightly export check', time: '02:00', detail: 'Every day at 02:00 · Next in 11h' }] }),
      chat('c16', 'Migrate the cron parser', 'idle', 'started', 'worca-cc', '13:40', 'today', { cost: 6.1, tasks: [{ id: 't16', run: 'r2', title: 'Migrate cron parser', case: 'gate', stage: 2, git: 'branch', branch: 'refactor/cron-parser', detail: 'Review gate' }] }),
      chat('c17', 'Node 24', 'idle', 'started', 'web-app', '12:40', 'today', { cost: 4.2, labels: ['hotfix'], tasks: [{ id: 't17', run: 'r5', title: 'Update Node to 24', case: 'failed', stage: 1, git: 'branch', branch: 'chore/node-24', detail: 'Test step · 3 tests failed' }] }),
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
  // A chat's task that is also in Tasks and Pulse (its `run`) reads its name, state and line from there: one task, one truth.
  const sync = (c) => { const walk = (t) => { const r = t.run && window.RailWorld.find(t.run); if (r) Object.assign(t, { title: r.title, case: r.case, detail: r.detail }); (t.after || []).forEach(walk); }; (c.tasks || []).forEach(walk); };
  const seed = () => {
    const d = base(), f = window.RailWorld.facts().chats;
    for (const c of d.chats) {
      sync(c);
      c.unread = (f.unread || []).includes(c.id);
      c.state = (f.needs || []).includes(c.id) ? 'needs-you' : c.state === 'needs-you' ? 'idle' : f.quiet ? QUIET[c.state] || c.state : c.state;
    }
    return d;
  };
  // A conversation's turns: what a person said, what Worca said, what it did. Work points at its task.
  const thread = (c) => {
    if (c.fromTask) return (c.tasks || []).map((x, i) => ({ t: 'task', id: `b${i}`, task: x.id }));   // opened from Tasks or Pulse: its card, nothing made up
    if (c.id === 'c1') return [
      { t: 'you', id: 'a1', text: 'Add a CSV export to the billing page', when: '14:02' },
      { t: 'think', text: 'Thought for 8s' },
      { t: 'cmds', text: 'Ran 4 commands', end: '12s', body: 'git status\nrg "exportCsv" src\nnpm run lint\nnpm test -- billing' },
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
      { t: 'cmds', text: 'Ran 4 commands', end: '12s', body: 'gh run view 8841\ngit log -3\nnpm ci\nnpm test -- export' },
      { t: 'fail', id: 'a2', cmd: 'npm test -- export', end: '3s', body: '✗ exports 50k rows under 2s\n  expected 1980ms, got 11240ms\n  at test/export.test.mjs:42', when: '14:29' },
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
      { t: 'act', id: 'a6', mark: 'ask', text: '<b>Stop Fix flaky login test?</b> 12 minutes of Review are lost', actions: [['Stop', 'danger', 'Stopped Fix flaky login test'], ['Not now', 'quiet', 'Kept running']] },
    ];
    if (c.id === 'c11') return [
      { t: 'you', id: 'a1', text: 'Who owns the cron parser?', when: 'Mon' },
      { t: 'act', id: 'a2', mark: 'ask', text: '<b>This sounds like worca-cc.</b> Use it for this chat?', actions: [['Use worca-cc', 'primary', 'This chat is on worca-cc now'], ['Keep no project', 'quiet', 'This chat stays without a project']] },
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
      { t: 'cmd', cmd: 'ls migrations | wc -l', sum: '84 files', end: '1s', out: '84', done: true },
      { t: 'words', html: '84 migrations; 61 are older than the squash point. Squashing them, first as a dry run:' },
      { t: 'cmd', cmd: 'npm run db:squash -- --dry-run' },
    ];
    if (c.id === 'c13') return [
      { t: 'you', id: 'a1', text: 'Compare two queue libraries for the export jobs', when: 'Mon' },
      { t: 'words', html: 'Two things decide it. Answer them, or take my picks for both:' },
      { t: 'question', id: 'a2', text: 'How many jobs a minute at peak?', options: ['Under 100', '100 to 10,000', 'More than 10,000'], pick: 1, many: 'a3', when: 'Mon' },
      { t: 'question', id: 'a3', text: 'Can jobs be lost if the server restarts?', options: ['No, every job must survive', 'A few is fine'], pick: 0, when: 'Mon' },
    ];
    const out = [{ t: 'you', id: 'a1', text: c.title, when: c.time }, { t: 'think', text: 'Thought for 6s' }, { t: 'words', html: c.state === 'idle' ? 'Here is what I found. Tell me if you want it as a task.' : 'On it.' }];
    (c.tasks || []).forEach((x, i) => out.push({ t: x.kind === 'schedule' ? 'schedule' : 'task', id: `b${i}`, task: x.id }));
    if (['replying', 'command', 'following'].includes(c.state)) out.push({ t: 'working', text: window.RailUI.chatState(c.state).line, end: '12s' });
    return out;
  };
  window.ChatsListModel = { thread, seed, sync, DAYS: window.RailUI.DAY_SECTIONS.filter(([d]) => d !== 'upcoming') };
})();
