// The Chats column's mock: the chats and their topic groups. `state` is a chat state (R.chatState), `kind` what it did.
(function () {
  const chat = (id, title, state, kind, project, time, day, o = {}) => ({ id, title, state, kind, project, time, day, cost: null, pinned: false, archived: false, unread: false, group: '', origin: null, rank: 0, ...o });
  const base = () => ({
    groups: [{ id: 't-bill', name: 'Billing export', total: 4 }, { id: 't-rel', name: 'Release 1.20', total: 2 }, { id: 't-ops', name: 'On call', total: 2 }],
    chats: [
      chat('c1', 'Ship the CSV export', 'needs-you', 'started', 'billing-api', '14:32', 'today', { cost: 1.2, unread: true, group: 't-bill' }),
      chat('c2', 'Why did the build fail', 'replying', 'chat', 'web-app', '14:30', 'today', { cost: 0.4 }),
      chat('c3', 'Tidy the migrations', 'command', 'workflow', 'worca-cc', '14:12', 'today', { cost: 0.9 }),
      chat('c4', 'Watch the nightly run', 'following', 'tracks', 'web-app', '13:58', 'today', { cost: 0.2, origin: { platform: 'slack' } }),
      chat('c5', 'Plan the API rewrite', 'idle', 'workflow', 'worca-cc', '12:20', 'today', { cost: 2.4, pinned: true }),
      chat('c6', 'Export columns', 'idle', 'chat', 'billing-api', '11:40', 'today', { cost: 0.5, group: 't-bill' }),
      chat('c7', 'Export email wording', 'idle', 'started', 'billing-api', '10:10', 'today', { cost: 1.1, group: 't-bill' }),
      chat('c8', 'Incident in the Telegram room', 'idle', 'chat', '', '09:15', 'today', { origin: { platform: 'telegram' } }),
      chat('c9', 'Release checklist', 'idle', 'started', 'worca-cc', 'Yesterday', 'yesterday', { cost: 3.3, group: 't-rel' }),
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
  window.ChatsListModel = { seed, DAYS: [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Previous 7 days'], ['month', 'Previous 30 days'], ['older', 'Older']] };
})();
