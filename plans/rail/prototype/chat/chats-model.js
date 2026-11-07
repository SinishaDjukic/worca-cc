// The Chats column's mock: the chats and their topic groups. `state` is a chat state (R.chatState), `kind` what it did.
(function () {
  const chat = (id, title, state, kind, project, time, day, o = {}) => ({ id, title, state, kind, project, time, day, cost: null, pinned: false, archived: false, unread: false, group: '', origin: null, rank: 0, labels: [], tasks: [], ...o });
  const base = () => ({
    groups: [{ id: 't-bill', name: 'Billing export', total: 4 }, { id: 't-rel', name: 'Release 1.20', total: 2 }, { id: 't-ops', name: 'On call', total: 2 }],
    chats: [
      chat('c1', 'Billing CSV export', 'needs-you', 'started', 'billing-api', '14:32', 'today', { cost: 1.2, unread: true, labels: ['hotfix', 'billing'], tasks: [
        { id: 't1', title: 'Add CSV export', case: 'question', stage: 2, git: 'open', watch: 'idle', branch: 'feat/billing-csv-export', detail: 'Review · step 2 of 3', after: [{ id: 't2', title: 'Invoices export', case: 'scheduled', stage: 0, branch: 'feat/invoices-export', detail: 'Starts after Add CSV export', endWord: 'after it' }] },
        { id: 's1', kind: 'schedule', title: 'Nightly export check', time: '02:00', detail: 'Every day at 02:00 · Next in 11h' }] }),
      chat('c2', 'Why did the build fail', 'replying', 'chat', 'web-app', '14:30', 'today', { cost: 0.4 }),
      chat('c3', 'Tidy the migrations', 'command', 'workflow', 'worca-cc', '14:12', 'today', { cost: 0.9, tasks: [{ id: 't3', title: 'Tidy the migrations', case: 'working', stage: 1, git: 'branch', branch: 'chore/tidy-migrations', detail: 'Build · step 1 of 2' }] }),
      chat('c4', 'Watch the nightly run', 'following', 'tracks', 'web-app', '13:58', 'today', { cost: 0.2, origin: { platform: 'slack' }, tasks: [{ id: 't4', title: 'Fix the flaky login', case: 'checks', stage: 3, git: 'fail', watch: 'fix', branch: 'fix/flaky-login', detail: 'Round 3 · Fixing 2 failed checks' }] }),
      chat('c5', 'Plan the API rewrite', 'idle', 'workflow', 'worca-cc', '12:20', 'today', { cost: 2.4, pinned: true }),
      chat('c6', 'Export columns', 'idle', 'chat', 'billing-api', '11:40', 'today', { cost: 0.5, group: 't-bill' }),
      chat('c7', 'Export email wording', 'idle', 'started', 'billing-api', '10:10', 'today', { cost: 1.1, group: 't-bill' }),
      chat('c8', 'Incident in the Telegram room', 'idle', 'chat', '', '09:15', 'today', { origin: { platform: 'telegram' } }),
      chat('c9', 'Release checklist', 'idle', 'started', 'worca-cc', 'Yesterday', 'yesterday', { cost: 3.3, group: 't-rel', tasks: [{ id: 't9', title: 'Write the notes', case: 'merged', stage: 4, git: 'merged', branch: 'docs/release-notes', detail: 'Merged #1101 into dev' }] }),
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
  const seed = () => {
    const d = base(), f = window.RailWorld.facts().chats;
    for (const c of d.chats) {
      c.unread = (f.unread || []).includes(c.id);
      c.state = (f.needs || []).includes(c.id) ? 'needs-you' : c.state === 'needs-you' ? 'idle' : f.quiet ? QUIET[c.state] || c.state : c.state;
    }
    return d;
  };
  // A conversation's turns: what a person said, what Worca said, what it did. Work points at its task.
  const thread = (c) => {
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
    const out = [{ t: 'you', id: 'a1', text: c.title, when: c.time }, { t: 'think', text: 'Thought for 6s' }, { t: 'words', html: c.state === 'idle' ? 'Here is what I found. Tell me if you want it as a task.' : 'On it.' }];
    (c.tasks || []).forEach((x, i) => out.push({ t: x.kind === 'schedule' ? 'schedule' : 'task', id: `b${i}`, task: x.id }));
    if (['replying', 'command', 'following'].includes(c.state)) out.push({ t: 'working', text: window.RailUI.chatState(c.state).line, end: '12s' });
    return out;
  };
  window.ChatsListModel = { thread, seed, DAYS: [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Previous 7 days'], ['month', 'Previous 30 days'], ['older', 'Older']] };
})();
