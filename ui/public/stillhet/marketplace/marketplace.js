// Marketplace on Stillhet (Wave 3, 4.1). Its home: a
// PlaceHead with the one update to take, For you (Worca's suggestions, each with its reason), then shelves named for what
// you want (Bring tasks in, Talk to Worca from, Give tasks tools, New agents and workflows), each plugin once, as
// PluginCards with its brand in Stillhet's line. A plugin's page: its PlaceHead and one step, what it adds, what it asks for,
// where it comes from. The bar lists them all. Installing asks in a short form; what is installed is managed in Settings.
// Live (slice 8 D3): the same code reads window.StillhetMarketLive.data() through src(), and each write runs its live branch
// first (live/market-live.mjs, dev's plugin and marketplace routes); the demo branches keep the prototype's own data.
(function () {
  const R = window.StillhetUI;
  const esc = R.esc;   // the library's: it escapes the double quote too
  const say = (t, undo) => window.StillhetPulse?.say(t, undo);
  const data = {
    markets: [{ id: 'official', name: 'Worca CC Official', url: 'github.com/SinishaDjukic/worca-cc', branch: 'dev', sha: '42eb305', synced: 'just now', builtin: true, webUrl: 'https://github.com/SinishaDjukic/worca-cc/tree/42eb305' }],
    plugins: [
      { id: 'github-source', name: 'GitHub Issues', brand: 'brand-github', ver: '0.2.0', kind: 'Task sources', market: 'official', what: 'Pull tasks from GitHub Issues; close them when the PR merges.', adds: ['A task source: GitHub Issues'], asks: ['A GitHub token'], installed: false, uses: 120, why: 'Your projects live on GitHub' },
      { id: 'jira-source', name: 'Jira', brand: 'brand-jira', ver: '0.1.0', kind: 'Task sources', market: 'official', what: 'Pull tasks from Jira issues; write the result back to the ticket.', adds: ['A task source: Jira'], asks: ['A Jira API token', 'Your Jira site'], installed: true, pinned: 'c3d9a17', uses: 60, update: '0.2.0', updateSha: '42eb305', ...(window.StillhetDemoState?.market === 'update-asks' ? { updateAsks: ['A Jira webhook secret'] } : {}) },
      { id: 'slack-chat', name: 'Slack', brand: 'brand-slack', ver: '0.2.0', kind: 'Chat channels', market: 'official', what: 'Talk to Worca from Slack: notices, and /status, /pause, /approve.', adds: ['A chat channel: Slack', 'Keeps a small worker running that listens for commands'], asks: ['A Slack bot token', 'A Slack app token'], installed: false, uses: 88, why: 'You step away most evenings: answer from your phone' },
      { id: 'telegram-chat', name: 'Telegram', brand: 'brand-telegram', ver: '0.1.0', kind: 'Chat channels', market: 'official', what: 'Notices and answers from Telegram.', adds: ['A chat channel: Telegram'], asks: ['A Telegram bot token'], installed: true, pinned: '7b21e04', uses: 21 },
      { id: 'cloudflare-mcp', name: 'Cloudflare', brand: 'brand-cloudflare', ver: '0.1.0', kind: 'MCP servers', market: 'official', what: 'The whole Cloudflare API and its docs, for your tasks.', adds: ['2 MCP servers'], parts: [['MCP server', 'Cloudflare API'], ['MCP server', 'Cloudflare docs']], asks: ['A Cloudflare API token'], installed: false, uses: 45 },
      { id: 'notion-mcp', name: 'Notion', brand: 'brand-notion', ver: '0.1.0', kind: 'MCP servers', market: 'official', what: 'Search, read and edit Notion pages and databases.', adds: ['An MCP server: Notion'], asks: ['A Notion integration token'], installed: true, pinned: '5e8f2c9', uses: 52, needsSetup: true },
      { id: 'azure-source', name: 'Azure Boards', ver: '0.1.0', kind: 'Task sources', market: 'official', what: 'Pull tasks from Azure Boards work items.', adds: ['A task source: Azure Boards'], asks: ['An Azure DevOps token'], installed: true, pinned: 'a40d6b3', uses: 12 },
      { id: 'discord-chat', name: 'Discord', ver: '0.1.0', kind: 'Chat channels', market: 'official', what: 'Notices and answers from Discord.', adds: ['A chat channel: Discord'], asks: ['A Discord bot token'], installed: true, pinned: '9f13e58', uses: 18 },
      { id: 'teams-chat', name: 'Teams', ver: '0.1.0', kind: 'Chat channels', market: 'official', what: 'Notices and answers from Microsoft Teams.', adds: ['A chat channel: Teams'], asks: ['A Teams bot token'], installed: true, pinned: '2d7c4a1', uses: 30 },
      { id: 'sentry-mcp', name: 'Sentry', ver: '0.1.0', kind: 'MCP servers', market: 'official', what: 'Read issues and traces from Sentry, for your tasks.', adds: ['An MCP server: Sentry'], asks: ['A Sentry auth token'], installed: false, uses: 70 },
      { id: 'review-pack', name: 'Review pack', ver: '1.0.0', kind: 'Agents', market: 'official', what: 'A security and a performance reviewer, ready for your workflows.', adds: ['2 agents'], asks: [], installed: false, uses: 34,
        gives: { agent: [{ id: 'sec-review', title: 'Security review', type: 'verifier', ins: 'the change', outs: 'findings when it blocks', model: 'Opus 5.5', effort: 'high', asks: false, fan: false, says: 'Reviews the change for security problems.' }, { id: 'perf-review', title: 'Performance review', type: 'verifier', ins: 'the change', outs: 'findings when it blocks', model: 'Sonnet 5.5', effort: 'high', asks: false, fan: false, says: 'Reviews the change for what would run slowly.' }] } },
      { id: 'promo-video', name: 'Promo video', ver: '0.3.0', kind: 'Workflows', market: 'official', what: 'From a feature to a 30-second video: script, shots, cut.', adds: ['A workflow and 3 agents'], asks: [], installed: false, uses: 7,
        gives: { agent: [{ id: 'script-writer', title: 'Script writer', type: 'producer', ins: 'the feature', outs: 'the script', model: 'Opus 5.5', effort: 'high', asks: true, fan: false, says: 'Writes the 30-second script.' }, { id: 'shot-maker', title: 'Shot maker', type: 'producer', ins: 'the script', outs: 'the shots', model: 'Sonnet 5.5', effort: 'medium', asks: false, fan: false, says: 'Makes each shot.' }, { id: 'video-cutter', title: 'Video cutter', type: 'producer', ins: 'the shots', outs: 'the video', model: 'Haiku 5.5', effort: 'medium', asks: false, fan: false, says: 'Cuts the shots into the video.' }],
          workflow: [{ id: 'promo-video', title: 'Promo video', what: 'From a feature to a 30-second video: script, shots, cut.', steps: [['Script', 'script-writer', 'Opus 5.5', 'high', 4, 0.30], ['Shots', 'shot-maker', 'Sonnet 5.5', 'medium', 12, 0.60], ['Cut', 'video-cutter', 'Haiku 5.5', 'medium', 3, 0.05]] }] } },
    ],
  };
  const isLive = () => window.StillhetAdapter?.kind === 'live';
  const LIVE = () => (isLive() ? window.StillhetMarketLive || null : null);
  const NONE = { markets: [], plugins: [] };
  const src = () => (isLive() ? LIVE()?.data() || NONE : data);   // D3: every read of the records goes through here
  const listNow = () => { const st = isLive() ? LIVE()?.status() || 'loading' : window.StillhetDemoState?.list; return st === 'loading' || st === 'failed' ? st : 'ready'; };   // D18
  const busyOf = (id) => LIVE()?.pending(id) || '';   // the action running on it (D8, D9, D14): its button says so, disabled
  const UNDO_MS = 5000;
  const view = { sort: '' };
  // an open of the place (D9, F-5-18): true until the live layer has been told, and again once the address leaves #marketplace
  let opening = true, watching = false;
  const openIfDue = () => { if (opening && here() && LIVE()) { opening = false; LIVE().opened(); } };
  let current = '', form = null, ctl = null, home = null, bar = null, page = null, menu = '', addVal = '', addErr = '';
  const srcKey = (s) => s.trim().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/^github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '').toLowerCase();
  const countOf = (m) => src().plugins.filter((p) => p.market === m.id).length;
  const plugins = (n) => `${n} ${n === 1 ? 'plugin' : 'plugins'}`;
  // the one reading of a source you typed: why it cannot be added, or ''
  const addProblem = (v) => (!v ? 'Say which repository or folder first.' : v.length > 200 ? 'That is too long for a repository or a folder.' : !/^(https?:\/\/\S+|[.~]{0,2}\/\S*|(www\.)?github\.com\/[\w.-]+\/[\w.-]+\/?|[\w.-]+\/[\w.-]+)$/.test(v) ? 'Use owner/repo, a GitHub URL or a folder.' : src().markets.some((m) => srcKey(m.url) === srcKey(v)) ? 'That source is already added.' : '');
  const stOf = (p) => (p.update ? { word: 'Update available', tone: 'act', act: `Update to ${p.update}` } : p.installed && p.needsSetup ? { word: 'Needs set-up', tone: 'act', act: 'Set it up' } : p.installed ? { word: 'Installed', tone: 'ok', act: 'Set it up' } : { word: 'Not installed', tone: 'idle', act: 'Install' });   // Needs set-up: list.kind-mark (D13)
  const WORKING = { install: 'Installing…', update: 'Updating…', setup: 'Saving…', remove: 'Removing…' };
  const actOf = (p) => WORKING[busyOf(p.id)] || stOf(p).act;   // the step's label, or what it is doing now
  const SHELF_ICON = ['track', 'kind-chat', 'sliders', 'kind-workflow'];   // the plug means a plugin, always (look.one-icon)
  const SORTS_ALL = { used: 'most used', new: 'highest version', az: 'A–Z' };   // a plugin has a version and no date: the sort says what it reads
  // D7: "most used" only when some plugin has a usage figure (dev has none); the sort then starts on A–Z
  const sorts = () => (src().plugins.some((p) => typeof p.uses === 'number') ? SORTS_ALL : { new: SORTS_ALL.new, az: SORTS_ALL.az });
  const sortNow = () => (view.sort && sorts()[view.sort] ? view.sort : Object.keys(sorts()).includes('used') ? 'used' : 'az');
  const shown = {};   // how many of a view's plugins are shown: six, then Show N more
  const SHELVES = [['Bring tasks in', 'Tickets become tasks; the result goes back to the ticket.', ['Task sources']], ['Talk to Worca from', 'Answer what needs you without opening Worca.', ['Chat channels']], ['Give tasks tools', 'MCP servers and models a task can call.', ['MCP servers', 'Models']], ['New agents and workflows', 'Steps and whole flows for your workflows.', ['Agents', 'Workflows', 'Scripts', 'Skills']]];
  const nameOf = (p) => p.name || p.id;
  const markOf = (p, size = 20) => R.kindMark({ kind: 'plugin', icon: p.brand || '', tone: stOf(p).tone, size, title: stOf(p).word });   // its brand in Stillhet's line; a plug without one
  const factsOf = (p) => `Adds ${p.adds.map((a) => { const w = a.split(':')[0]; return w.charAt(0).toLowerCase() + w.slice(1); }).join(', ')} · ${p.asks.length ? `asks for ${p.asks.length === 1 ? p.asks[0].replace(/^A /, 'a ').replace(/^An /, 'an ').replace(/^Your /, 'your ') : `${p.asks.length} things`}` : 'asks for nothing'}`;
  // what it adds, each by name: [kind of thing, its name]
  const partsOf = (p) => p.parts || (p.gives ? Object.entries(p.gives).flatMap(([k, l]) => l.map((x) => [k === 'agent' ? 'Agent' : 'Workflow', `${x.title}: ${x.says || x.what}`])) : p.adds.map((a) => { const i = a.indexOf(': '); return i > 0 ? [a.slice(0, i).replace(/^An? /, '').replace(/^./, (c) => c.toUpperCase()), a.slice(i + 2)] : ['Also', a]; }));
  // Worca's suggestions: one you install stays where it was until you leave them
  const forYou = () => src().plugins.filter((p) => p.why && (!p.installed || p.keptForYou));
  // Update lives on the card that has it, once per plugin (stillhet.one-action)
  // stillhet.card-opens: the title is a link and the whole card opens the plugin's page; its one step is a bordered button
  const stepBtn = (p, attrs) => R.button({ label: stOf(p).act, busy: WORKING[busyOf(p.id)] ? { label: WORKING[busyOf(p.id)] } : false, attrs: { 'aria-label': `${stOf(p).act}: ${nameOf(p)}`, ...attrs, disabled: !!busyOf(p.id) } });
  const cardOf = (p, why = false) => R.pluginCard({ mark: markOf(p), kicker: `${p.kind.replace(/s$/, '')}${p.update ? '' : ` · ${p.installed ? (p.on === false ? 'installed, off' : 'installed') : p.ver}`}`, update: p.update || '', title: nameOf(p), titleHtml: R.textLink({ label: nameOf(p), attrs: { 'data-mk-open': p.id, title: `Opens ${nameOf(p)}` } }), what: p.what, why: why ? p.why : '', facts: factsOf(p),
    action: stepBtn(p, { 'data-mk-card': p.id }), attrs: { 'data-mk-plugin': p.id, 'data-mk-open': p.id } });
  const mkOf = (p) => src().markets.find((m) => m.id === p.market) || null;   // the plugin's own market (D15)
  const marketOf = (p) => mkOf(p)?.name || 'linked';
  // where it comes from (F-5-15): an installed plugin's own pinned commit, the catalogue's only as the update it offers; a
  // plugin not installed, the catalogue's commit it would install
  const whereOf = (p) => {
    const mk = mkOf(p), own = `${p.pinned ? ` · pinned ${p.pinned}` : ''}${p.update ? ` · update available: ${p.updateSha || p.update}` : ''}`;
    if (!mk) return `${p.source?.repoUrl || 'linked'}${p.installed ? own : ''}`;
    return `${mk.url} on ${mk.branch}${p.installed ? own : mk.sha ? ` · ${mk.sha}` : ''}`;
  };
  // what it asks for (F-5-16, V3-13): the live record's needs (manifest labels; a key's plain words with the key kept), or the
  // demo's asks with the site heuristic; each named without its article
  const needsOf = (p) => p.needs || p.asks.map((a) => ({ label: a, key: '', secret: !/site$/i.test(a) }));
  const bare = (a) => { const t = a.replace(/^(An?|Your) /, ''); return t.charAt(0).toUpperCase() + t.slice(1); };
  const lowerArticle = (a) => a.replace(/^(An?|Your) /, (w) => w.toLowerCase());
  const rowOf = (p) => ({ key: `plug:${p.id}`, _p: p, title: nameOf(p), mark: markOf(p), end: p.update ? `Update ${p.update}` : p.installed ? 'Installed' : p.ver, current: p.id === current, tip: `${p.id} ${p.ver}\n${p.kind} · ${marketOf(p)}\n${p.what}`,
    menu: [{ id: 'step', text: stOf(p).act, help: p.installed ? 'Set it up on its page' : `Adds ${p.adds.join(', ')}` }, { id: 'source', text: 'View its source', help: whereOf(p) }] });
  const toPage = (p) => { if (current === p.id) draw(); else window.StillhetShell.go(`marketplace/${p.id}`); };
  // Set it up (form.plugin-setup, D12): a plugin that asks for nothing says so; one that asks, or that still needs set-up,
  // opens its form on its own page. "Is set up" is never said while it reads Needs set-up.
  function setUp(p) {
    if (!p.asks.length && !p.needsSetup) { say(`${nameOf(p)} is set up: it asks for nothing`); return; }
    form = { k: 'setup', id: p.id, fields: isLive() ? null : needsOf(p).map((n, i) => ({ key: `ask-${i}`, label: bare(n.label), secret: n.secret, set: !!p.installed && !p.needsSetup })) };
    if (isLive()) { const f = form; LIVE().setupFields(p.id).then((a) => { if (form !== f) return;
      if (!a.ok || !a.fields.length) { form = null; say(a.ok ? `${nameOf(p)} still needs set-up, and nothing here is left to fill in` : a.text); } else f.fields = a.fields.map((x) => ({ ...x, key: x.name })); draw(); }); }
    toPage(p);
  }
  // the set-up form's parts: one per target it is saved with (live: a source, a channel or the model keys), each its own Save
  const setupParts = (fields) => { const out = []; for (const f of fields || []) { let g = out.find((x) => x.group === (f.group || '')); if (!g) out.push((g = { group: f.group || '', where: f.where || '', fields: [] })); g.fields.push(f); } return out; };
  // Update (D9): one press when it asks for nothing new; an update that asks for something new asks first (form.update-asks)
  function runUpdate(p, confirmed = false) {
    if (!isLive()) {
      if (p.updateAsks && !confirmed) { form = { k: 'update', id: p.id, text: `Update ${p.id} to ${p.update}? It now asks for ${p.updateAsks.map((a) => a.charAt(0).toLowerCase() + a.slice(1)).join(' and ')}.` }; toPage(p); return; }
      p.ver = p.update; delete p.update; delete p.updateAsks; draw(); say(`Updated ${nameOf(p)} to ${p.ver}`); return;
    }
    LIVE().update(p.id, { confirmed }).then((a) => {
      if (a.ask) { form = { k: 'update', id: p.id, text: a.ask.text }; toPage(p); return; }
      if (a.text) say(a.text);
      draw();
    });
    draw();
  }
  function step(p) {
    if (busyOf(p.id)) return;
    if (p.update) { runUpdate(p); return; }
    if (p.installed) { setUp(p); return; }
    form = { k: 'install', id: p.id }; toPage(p);
  }
  const lowerFirst = (a) => a.charAt(0).toLowerCase() + a.slice(1);
  function formHtml(p) {
    if (form?.id !== p.id) return '';
    if (form.k === 'install') return R.confirmForm({ form: 'install', id: 'mk-install-t', text: `Install ${p.id} ${p.ver}? It adds ${p.adds.map(lowerFirst).join(' and ')}${p.asks.length ? `, and asks for ${p.asks.map(lowerArticle).join(' and ')}: you set ${p.asks.length > 1 ? 'them' : 'it'} up here after` : ''}.`, body: busyOf(p.id) === 'install' ? R.confirmActions({ yes: WORKING.install, busy: true }) : R.confirmActions({ yes: 'Install' }) });
    if (form.k === 'remove') return R.confirmStrip({ text: `Remove ${p.id}? What it adds stops working; its settings and secrets stay until you purge them.`, yes: 'Remove', danger: true, busy: busyOf(p.id) === 'remove' ? WORKING.remove : '' });
    if (form.k === 'purge') return R.confirmStrip({ text: `Purge what ${nameOf(p)} keeps? Its settings and secrets on this machine are deleted; the plugin stays installed and needs set-up again.`, yes: 'Purge', danger: true });
    if (form.k === 'update') return R.confirmStrip({ text: form.text, yes: 'Update', busy: busyOf(p.id) === 'update' ? WORKING.update : '', attrs: { 'data-mk-update-asks': '' } });
    if (form.k === 'setup') {
      const parts = setupParts(form.fields), many = parts.length > 1, acts = busyOf(p.id) === 'setup' ? R.confirmActions({ yes: WORKING.setup, busy: true }) : R.confirmActions({ yes: 'Save', busy: !form.fields });
      let n = 0;
      const fieldsOf = (list) => list.filter((f) => !f.profileOnly).map((f) => R.field({ id: `mk-setup-${n++}`, label: f.label, type: f.secret ? 'password' : 'text', placeholder: f.secret && f.set ? 'Set; type to replace' : '', attrs: { 'data-mk-field': f.key, autocomplete: 'off' } })).join('');
      const textOf = (part) => (part.fields.every((f) => f.profileOnly) ? `Set up ${nameOf(p)}: ${part.where} needs its first profile, named Default.` : `Set up ${nameOf(p)}${many ? `, ${part.where}` : ''}: what it asks for stays on this machine.`);
      if (!many) return R.confirmForm({ form: 'setup', id: 'mk-setup-t', text: textOf(parts[0] || { fields: [] }), body: `${fieldsOf(parts[0]?.fields || [])}${acts}` });
      return parts.map((part, i) => R.confirmForm({ form: 'setup', id: `mk-setup-t-${i}`, text: textOf(part), body: `${fieldsOf(part.fields)}${acts}` })).join('');
    }
    return '';
  }
  // ---- an installed plugin, managed on its own page (classic: Settings › Plugins and Chat channels; demo only until the live layer reads them) ----
  const isChannel = (p) => p.kind === 'Chat channels';
  const manageOn = (p) => !!p.installed && !isLive();
  const DEMO_CHAT = { 'telegram-chat': '-100 428 1193', 'discord-chat': '#worca-notices', 'teams-chat': 'Engineering › Worca' };
  // a chat channel's own values, edited here (GET and PUT /api/plugins/:name/config, { channelId, values })
  const channelOf = (p) => (p.channel = p.channel || { id: `${p.id}-1`, name: nameOf(p), chat: DEMO_CHAT[p.id] || 'general', sends: 'What needs you, and what failed' });
  const CH_FIELDS = [['name', 'Channel name', 60], ['chat', 'Chat or channel', 80], ['sends', 'What it sends you', 80]];
  const healthOf = (p) => (p.on === false ? { word: 'Off', tone: 'idle', says: 'Nothing uses it while it is off' } : p.needsSetup ? { word: 'Needs set-up', tone: 'act', says: `${bare(needsOf(p)[0]?.label || 'A setting')} is missing` } : p.tested === 'failed' ? { word: 'Not reachable', tone: 'fail', says: 'The last test got no answer' } : { word: 'Working', tone: 'ok', says: p.tested ? `Tested ${p.tested}` : 'Last used today' });
  function manageHtml(p) {
    if (!manageOn(p)) return '';
    const h = healthOf(p), off = p.on === false;
    const health = R.settingsSection({ title: 'How it is doing', rows: R.settingsRow({ name: 'Health', sentence: `<span class="mk-health is-${h.tone}">${esc(h.word)}</span> · ${esc(h.says)}`, end: off || p.needsSetup ? R.tooltip({ text: off ? 'Turn it on first' : 'Set it up first', off: true, html: R.button({ kind: 'quiet', label: 'Test connection', attrs: { disabled: true } }) }) : R.button({ kind: 'quiet', label: 'Test connection', attrs: { 'data-mk-test': '', title: `Asks ${nameOf(p)} for an answer; changes nothing` } }) })
      + R.settingsRow({ name: 'Enabled', sentence: off ? 'Off: what it adds is not offered to tasks or chats' : 'On: tasks and chats can use what it adds', end: R.switchButton({ on: !off, label: `${nameOf(p)} enabled`, attrs: { 'data-mk-enable': '' } }) }) });
    if (!isChannel(p)) return health;
    const c = channelOf(p), editing = form?.id === p.id && form.k === 'channel';
    const channel = editing ? R.settingsSection({ title: 'Its channel', attrs: { 'data-mk-channel-form': '' }, rows: R.confirmForm({ form: 'channel', id: 'mk-channel-t', text: `Edit the channel ${c.name}`, body: CH_FIELDS.map(([k, label, max]) => R.field({ id: `mk-ch-${k}`, label, value: form.typed?.[k] ?? c[k], error: form.errors?.[k] || '', attrs: { 'data-mk-ch': k, maxlength: max, autocomplete: 'off' } })).join('') + R.confirmActions({ yes: 'Save' }) }) })
      : R.settingsSection({ title: 'Its channel', meta: 'Where Worca writes to you, and what it sends. Settings › Chat links here.', attrs: { 'data-mk-channel': '' },
        action: R.button({ kind: 'quiet', label: 'Edit', attrs: { 'data-mk-ch-edit': '', title: 'Change its name, where it writes and what it sends' } }) + (off ? '' : R.button({ kind: 'quiet', label: 'Send a test message', attrs: { 'data-mk-ch-test': '' } })),
        rows: CH_FIELDS.map(([k, label]) => R.settingsRow({ name: label, sentence: esc(c[k]) })).join('') });
    return health + channel;
  }
  function pageHtml(p) {
    const st = stOf(p);
    const asking = form?.id === p.id && !['remove', 'purge', 'channel'].includes(form.k);   // the form below holds the one step
    // an installed plugin with nothing to update or set up has no step in its head: its settings are rows below
    const settled = p.installed && !p.update && !p.needsSetup;
    const ask = R.button({ kind: 'quiet', label: 'Ask about it in chat', attrs: { 'data-mk-chat': '', title: 'Opens Chat with this plugin attached' } });
    const head = R.placeHead({ center: { label: 'Marketplace', to: 'marketplace' }, title: nameOf(p), facts: esc(`${p.kind.replace(/s$/, '')} · ${p.id} ${p.ver}`), mark: markOf(p), word: p.installed && p.on === false ? 'Installed, off' : st.word, why: p.what,
      action: asking || settled ? '' : stepBtn(p, { 'data-mk-step': '' }), actions: ask,   // no Warning here: outlined (stillhet.one-action)
      menu: R.moreMenu({ id: 'mk-more', label: `More for ${p.id}`, icon: R.icon('more', 16), open: menu === 'mk-more', items: [...(!isLive() ? [{ id: 'source', text: 'View its source', help: window.StillhetWould('open it on GitHub') }] : p.source?.webUrl ? [{ id: 'source', text: 'View its source', help: 'On GitHub, in a new tab' }] : []), ...(p.installed ? [{ sep: true }, ...(manageOn(p) ? [{ id: 'purge', text: 'Purge its settings…', danger: true, help: 'Deletes its settings and secrets; it stays installed' }] : []), { id: 'remove', text: 'Remove…', danger: true, help: 'Asks first; says what stops working' }] : [])] }) });
    const install = form?.k === 'channel' ? '' : formHtml(p), setting = form?.id === p.id && form.k === 'setup';   // its rows' Set up would open the same form again
    const asks = R.settingsSection({ title: p.installed ? 'Its settings' : 'What it asks for', rows: p.asks.length ? needsOf(p).map((n) => R.settingsRow({ name: bare(n.label), sentence: `${n.secret ? 'Secret' : 'Setting'}${p.installed ? (p.needsSetup ? ' · not set' : ' · set') : ''}${n.key ? ` · <code>${esc(n.key)}</code>` : ''}`, end: !p.installed ? '' : setting ? R.tooltip({ text: 'The set-up form above is open', off: true, html: R.button({ label: 'Set up', attrs: { 'data-mk-setup': '', disabled: true } }) }) : R.button({ label: p.needsSetup ? 'Set up' : 'Change', attrs: { 'data-mk-setup': '' } }) })).join('') : R.settingsRow({ name: 'Setup', sentence: 'No secrets, nothing to do' }) });
    const adds = R.settingsSection({ title: 'What it adds', rows: partsOf(p).map(([kind, name]) => R.settingsRow({ name: esc(kind), sentence: esc(name) })).join('') });
    const from = R.settingsSection({ title: 'Where it comes from', rows: R.settingsRow({ name: 'Repository', sentence: esc(whereOf(p)) }) });
    // installed: what you manage leads (health, its channel, its settings); not installed: what you would get leads
    const rows = p.installed ? manageHtml(p) + asks + adds + from : adds + asks + from;
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col is-center" data-mk-page>${head}${install}${rows}</div></div></div>`;
  }
  function wayOf(key) {
    if (key === 'updates') return { title: 'Updates', meta: 'What can be updated; nothing new is asked for unless it says so', list: src().plugins.filter((p) => p.update) };
    if (key === 'installed') return { title: 'Installed', meta: 'Set one up or remove it on its page', list: src().plugins.filter((p) => p.installed) };
    if (key === 'for-you') return { title: 'For you', meta: 'Worca suggests these from how you work; each says why', list: forYou(), why: true };
    if (key === 'new') return { title: 'Not installed', meta: 'What you could add', list: src().plugins.filter((p) => !p.installed) };
    if (key === 'all') return { title: 'All plugins', meta: 'Every plugin from every source', list: src().plugins.slice() };
    if (key.startsWith('shelf-')) { const [t, meta, kinds] = SHELVES[parseInt(key.slice(6), 10)], fresh = key.endsWith('-new'); return { title: t, meta: fresh ? 'What you have not installed yet' : meta, list: src().plugins.filter((p) => kinds.includes(p.kind) && !forYou().includes(p) && !(fresh && p.installed)), fresh }; }
    if (key.startsWith('src-')) { const m = src().markets.find((x) => x.id === key.slice(4)); return { title: m?.name || 'Source', meta: m ? `${m.url} · synced ${m.synced}` : '', list: src().plugins.filter((p) => p.market === m?.id) }; }
    return null;
  }
  // the catalogue with no plugins at all (#1298): Loading while a never-synced builtin's first sync runs, then No plugins yet
  // with its Sync, and why it is empty in words; a filtered view with plugins elsewhere keeps its own empty line
  const firstSyncing = () => !!LIVE()?.firstSyncing();
  const noCatalogue = () => !src().plugins.length;
  const firstLine = (t) => t.split('\n').map((x) => x.trim()).find(Boolean)?.slice(0, 120) || '';
  function catalogueEmpty(all = '') {
    const ms = src().markets, m = ms.find((x) => x.builtin && x.synced === 'never') || ms.find((x) => x.builtin) || ms[0];
    if (!m) return R.emptyState({ title: 'No plugins yet', text: 'Add a source to see plugins.', actions: all });
    const busy = !!busyOf(`source:${m.id}`), never = m.synced === 'never';
    const text = never && m.error ? `The last sync of ${m.name} failed: ${firstLine(m.error)}` : never ? `Sync fetches the catalogue from ${m.name}.` : 'Your sources list no plugins. Sync checks them again.';
    return R.emptyState({ title: 'No plugins yet', text, actions: R.button({ label: 'Sync', busy: busy ? { label: 'Syncing…' } : false, attrs: { 'data-mk-sync': m.id } }) + all });
  }
  const catalogueLoading = () => R.listState({ state: 'loading', noun: 'the catalogue' });
  function emptyOf(key, w) {   // an empty view says what comes next
    const goto = (label, to) => R.button({ label, kind: 'quiet', attrs: { 'data-mk-goto': to } });
    if (noCatalogue() && firstSyncing()) return catalogueLoading();
    if (key.startsWith('src-')) return R.emptyState({ title: 'No plugins from this source yet.', text: 'A plugin shows here once its repository or folder holds a worca-cc-plugin.json. Sync after adding one.', actions: R.button({ label: 'Sync', attrs: { 'data-mk-sync': key.slice(4) } }) + goto('All plugins', '~all') });
    if (w.fresh) return R.emptyState({ title: 'You have installed them all.', text: 'What they added is in your workflows and agents.', actions: goto('Installed', '~installed') });
    if (noCatalogue()) return catalogueEmpty(goto('All plugins', '~all'));
    return R.emptyState({ title: key === 'updates' ? 'Everything is up to date.' : key === 'installed' ? 'Nothing is installed yet.' : key === 'new' ? 'You have installed them all.' : 'Nothing here yet.', text: key === 'installed' ? 'Install a plugin and it shows here, with its settings on its own page.' : '', actions: goto('All plugins', '~all') });
  }
  // list.filters: which plugins, as tabs with their counts (classic's Hide installed, as Installed and Not installed), and Sort by
  const VIEWS = [['all', 'All', () => true], ['installed', 'Installed', (p) => p.installed], ['updates', 'Updates', (p) => p.update], ['new', 'Not installed', (p) => !p.installed]];
  function filtersHtml(key, sortable) {
    const sort = sortNow(), SORTS = sorts();
    return R.centerFilters({ pick: menu, parts: [{ id: 'mk-view', label: 'Which plugins', text: (VIEWS.find(([id]) => id === key) || VIEWS[0])[1], tabs: VIEWS.map(([id]) => id), items: VIEWS.map(([id, text, test]) => ({ id, text, checked: id === key, hint: String(src().plugins.filter(test).length) })) },
      ...(sortable ? [{ id: 'mk-sort', label: 'Sort by', text: SORTS[sort], tip: 'How the plugins are ordered', items: Object.entries(SORTS).map(([id, text]) => ({ id, text, checked: id === sort })) }] : [])] });
  }
  function wayHtml(key) {
    const w = wayOf(key); if (!w) return homeHtml();
    const sort = sortNow(), list = w.list.sort((a, b) => (sort === 'az' ? nameOf(a).localeCompare(nameOf(b)) : sort === 'new' ? b.ver.localeCompare(a.ver, undefined, { numeric: true }) : (b.uses || 0) - (a.uses || 0))), n = shown[key] || 6;
    const ups = key === 'updates' && list.length > 1 ? R.button({ label: `Update all ${list.length}`, busy: updatingAll ? { label: WORKING.update } : false, attrs: { 'data-mk-update-all': '' } }) : '';
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col is-center">${R.placeHead({ center: { label: 'Marketplace', to: 'marketplace' }, title: w.title, facts: esc(`${list.length} ${list.length === 1 ? 'plugin' : 'plugins'} · ${w.meta}`), ...(ups ? { mark: R.kindMark({ kind: 'plugin', icon: 'refresh', tone: 'act' }), word: `${list.length} to update`, why: 'Each asks for nothing new', action: ups } : {}) })}
      ${filtersHtml(VIEWS.some(([id]) => id === key) ? key : '', list.length > 1)}
      ${list.length ? `<div class="pg-grid">${list.slice(0, n).map((p) => cardOf(p, w.why)).join('')}</div>${list.length > n ? `<div style="margin:12px 0 0">${R.button({ kind: 'quiet', label: `Show ${list.length - n} more`, attrs: { 'data-mk-more': key } })}</div>` : ''}` : emptyOf(key, w)}
    </div></div></div>`;
  }
  function homeHtml() {
    const m = src().markets, ups = src().plugins.filter((p) => p.update), yours = forYou(), rest = src().plugins.filter((p) => !yours.includes(p));   // each plugin once
    const shelf = (title, meta, list, cls = '') => (list.length ? `<section class="pg-shelf ${cls}"><h2 class="pg-shelf-h">${esc(title)} <span class="n">${list.length}</span></h2>${meta ? `<p class="pg-shelf-m">${esc(meta)}</p>` : ''}<div class="pg-grid">${list.map((p) => cardOf(p, cls === 'pg-for')).join('')}</div></section>` : '');
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col is-center">${R.placeHead({ title: 'Marketplace', facts: `${src().plugins.length} plugins · ${src().plugins.filter((p) => p.installed).length} installed · from ${m.length === 1 ? esc(m[0].name) : `${m.length} sources`}`,
      ...(ups.length ? { mark: R.kindMark({ kind: 'plugin', tone: 'act' }), word: `${ups.length} ${ups.length === 1 ? 'update' : 'updates'}`, why: `${ups.map((p) => `${nameOf(p)} ${p.update}`).join(', ')} asks for nothing new`, ...(ups.length > 1 ? { action: R.button({ label: 'Update all', busy: updatingAll ? { label: WORKING.update } : false, attrs: { 'data-mk-update-all': '' } }) } : {}) } : {}) })}
      ${noCatalogue() ? '' : filtersHtml('all', false)}
      ${noCatalogue() ? (firstSyncing() ? catalogueLoading() : catalogueEmpty()) : ''}
      ${shelf('For you', 'Worca suggests these from how you work; each says why.', yours, 'pg-for')}
      ${SHELVES.map(([t, meta, kinds]) => shelf(t, meta, rest.filter((p) => kinds.includes(p.kind)))).join('')}
      ${R.settingsSection({ title: 'Where plugins come from', rows: m.map((x) => R.settingsRow({ name: x.name, sentence: `${x.webUrl ? R.textLink({ label: x.url, attrs: { 'data-mk-market': x.id, title: 'Opens it on GitHub, in a new tab' } }) : esc(x.url)}${esc([`synced ${x.synced}`, x.sha, x.error ? `can't reach it: ${firstLine(x.error)}` : ''].filter(Boolean).map((t) => ` · ${t}`).join(''))}`, end: R.button({ label: 'Sync', busy: busyOf(`source:${x.id}`) ? { label: 'Syncing…' } : false, attrs: { 'data-mk-sync': x.id } }) + (x.builtin ? '' : R.button({ kind: 'quiet', label: 'Remove', attrs: { 'data-mk-unsource': x.id, title: 'Stops looking here; Undo brings it back' } })) })).join('') + R.settingsRow({ name: 'Add one', sentence: R.field({ id: 'mk-add', label: 'Repository or folder', quietLabel: true, placeholder: 'owner/repo, a GitHub URL or a folder', value: addVal, error: addErr, attrs: { 'data-mk-add': '' } }), end: R.button({ label: 'Add', busy: busyOf('source:add') ? { label: 'Adding…' } : false, attrs: { 'data-mk-addgo': '' } }) }) })}</div></div></div>`;
  }
  const here = () => (location.hash.slice(1) || '').split('/')[0] === 'marketplace';   // the page area is shared by every place: draw only while this one is open
  function draw() {
    if (!bar || !page || !here()) return;
    ctl?.paint();
    const ls = listNow();
    if (ls !== 'ready') { page.innerHTML = `<div class="convo"><div class="convo-scroll"><div class="convo-col is-center">${R.placeHead({ title: 'Marketplace' })}${R.listState({ state: ls, noun: 'plugins', retry: ls === 'failed' ? { 'data-mk-retry': '' } : null })}</div></div></div>`; return; }   // D18
    // what you typed survives a redraw (a list read again, a pending label)
    const typed = [...page.querySelectorAll('[data-mk-field], [data-mk-add]')].map((i) => [i.dataset.mkField ?? '', i.value, i === document.activeElement]);
    const p = src().plugins.find((x) => x.id === current);
    page.innerHTML = p ? pageHtml(p) : current.startsWith('~') ? wayHtml(current.slice(1)) : homeHtml();
    for (const [k, v, had] of typed) { const i = k ? [...page.querySelectorAll('[data-mk-field]')].find((x) => x.dataset.mkField === k) : page.querySelector('[data-mk-add]'); if (i) { if (v) i.value = v; if (had) i.focus(); } }
    if (p && form && !form.focused && (form.k !== 'setup' || form.fields)) { form.focused = true; (page.querySelector('[data-mk-field], [data-mk-ch]') || page.querySelector('[data-confirm="yes"]'))?.focus(); }   // Enter takes it, Esc leaves it
  }
  // the answer to the form or strip under the head: Install, Remove, Update (it asks for something new) or Save
  function confirm(p, yes, hit) {
    const was = form?.k;
    if (!yes) { form = null; draw(); return; }
    if (busyOf(p.id)) return;
    if (was === 'channel') {   // its values, checked as fields, then kept (the demo's model; live: PUT /api/plugins/:name/config)
      const c = channelOf(p), typed = Object.fromEntries([...page.querySelectorAll('[data-mk-ch]')].map((x) => [x.dataset.mkCh, x.value.trim()]));
      const errors = Object.fromEntries(CH_FIELDS.filter(([k]) => !typed[k]).map(([k, label]) => [k, `${label} cannot be empty`]));
      if (Object.keys(errors).length) { form.typed = typed; form.errors = errors; draw(); page.querySelector(`#mk-ch-${Object.keys(errors)[0]}`)?.focus(); return; }
      const changed = CH_FIELDS.some(([k]) => c[k] !== typed[k]); Object.assign(c, typed); form = null; draw(); if (changed) say(`Saved the channel ${c.name}`); page.querySelector('[data-mk-ch-edit]')?.focus(); return;
    }
    if (was === 'purge') { form = null; p.needsSetup = p.asks.length > 0; delete p.channel; delete p.tested; draw(); say(`Purged what ${nameOf(p)} kept${p.asks.length ? ': it needs set-up again' : ''}`); return; }
    if (!LIVE()) {
      form = null;
      if (was === 'install') { setOn(p, true); say(`Installed ${p.id}${p.asks.length ? ': set it up' : ''}`); }
      if (was === 'remove') { setOn(p, false); say(`Removed ${p.id}`); }
      if (was === 'update') { runUpdate(p, true); return; }
      if (was === 'setup') { p.needsSetup = false; delete p.tested; say(`${nameOf(p)} is set up`); }
      draw(); return;
    }
    const f = form, done = (a) => {
      const closes = (a.ok || was !== 'setup') && form === f;
      if (closes) form = null;
      if (a.text) say(a.text);
      if (closes && a.more) { const q = src().plugins.find((x) => x.id === p.id); if (q && current === p.id) { setUp(q); return; } }   // still Needs set-up: the form again, on what is left
      draw();
      if (closes) (page.querySelector('[data-mk-step]:not([disabled])') || page.querySelector('[data-mk-setup]:not([disabled])') || [...page.querySelectorAll('[data-mk-card]')].find((b) => b.dataset.mkCard === p.id))?.focus();   // the focus stays on the plugin's step
    };
    if (was === 'install') LIVE().install(p.id).then(done);   // the form stays, its Install reads Installing…, until dev answers (D8)
    else if (was === 'remove') LIVE().remove(p.id).then(done);
    else if (was === 'update') { form = null; runUpdate(p, true); return; }
    else if (was === 'setup') {   // one part per Save (its target); a refusal keeps the form open
      const box = hit?.closest('form') || page, i = Number(/-(\d+)$/.exec(box.querySelector?.('.rc-confirm-t')?.id || '')?.[1]), part = setupParts(f.fields)[Number.isInteger(i) ? i : 0];
      const values = Object.fromEntries([...box.querySelectorAll('[data-mk-field]')].map((x) => [x.dataset.mkField, x.value]));
      LIVE().saveSetup(p.id, values, part?.group || undefined).then(done);
    }
    draw();
  }
  let updatingAll = false;
  const setOn = (p, on) => { if (on && p.why) p.keptForYou = true; p.installed = on; if (!on) delete p.update; window.StillhetPlaces.workflows?.plugin(p.id, nameOf(p), p.gives, on); };   // one truth: Workflows' lists and counts follow
  function wire(b, pg) {
    bar = b; page = pg;
    if (!watching) { watching = true; window.addEventListener('hashchange', () => { if (!here()) opening = true; }); }   // a move inside the place is no open
    const way = (key, title, mark, n) => ({ key: `way:${key}`, _way: key, title, mark, end: String(n), current: current === `~${key}`, tip: `${title} · ${n}` });
    ctl = R.listController({ root: bar, spec: { noun: 'plugins', label: 'Selected plugins', retry: () => LIVE()?.load(), view: () => ({ state: listNow(), parts: [],
      sections: [{ id: 'yours', title: 'Yours', noCount: true, rows: [way('updates', 'Updates', R.kindMark({ kind: 'plugin', icon: 'refresh', tone: src().plugins.some((p) => p.update) ? 'act' : 'idle' }), src().plugins.filter((p) => p.update).length), way('installed', 'Installed', R.kindMark({ kind: 'plugin', icon: 'check' }), src().plugins.filter((p) => p.installed).length)] },
        { id: 'browse', title: 'Browse', noCount: true, rows: [way('for-you', 'For you', R.kindMark({ kind: 'plugin', icon: 'whoYou' }), forYou().length), ...SHELVES.map(([t, , kinds], n) => way(`shelf-${n}`, t, R.kindMark({ kind: 'plugin', icon: SHELF_ICON[n] }), src().plugins.filter((p) => kinds.includes(p.kind) && !forYou().includes(p)).length)), way('all', 'All plugins', R.kindMark({ kind: 'plugin', icon: 'list' }), src().plugins.length)] },
        { id: 'sources', title: 'Sources', noCount: true, rows: src().markets.map((m) => way(`src-${m.id}`, m.name, R.kindMark({ kind: 'plugin', icon: /^[.~/]/.test(m.url) ? 'folder' : 'brand-github' }), src().plugins.filter((p) => p.market === m.id).length)) }] }),
      can: () => [], bulk: () => [], act: () => {}, open: (r) => window.StillhetShell.go(`marketplace/~${r._way}`), word: () => false, say, active: () => /^#marketplace/.test(location.hash) } });
    page.addEventListener('click', (e) => {
      if (!here()) return;   /* another place's page is showing */
      const on = (q) => e.target.closest(q); let hit; const p = src().plugins.find((x) => x.id === current);
      if (on('[data-mk-retry]')) { LIVE()?.load(); draw(); return; }
      if ((hit = on('[data-mk-market]'))) { const m = src().markets.find((y) => y.id === hit.dataset.mkMarket); if (LIVE()) LIVE().openMarket(m.id); else say(window.StillhetWould(`open ${m.url} at ${m.sha} on GitHub`)); return; }
      if ((hit = on('[data-mk-sync]')) && LIVE()) { LIVE().sync(hit.dataset.mkSync).then((a) => { if (a.text) say(a.text); draw(); }); return; }
      if ((hit = on('[data-mk-unsource]')) && LIVE()) { const m = src().markets.find((y) => y.id === hit.dataset.mkUnsource); if (!m) return; const u = LIVE().deferRemoveSource(m.id, UNDO_MS); say(`Removed the source ${m.name}`, () => { if (!u.undo()) say(`Too late to undo: ${m.name} is being removed`); }); return; }
      if ((hit = on('[data-mk-sync]'))) { const m = src().markets.find((y) => y.id === hit.dataset.mkSync); m.synced = 'just now'; draw(); say(`Synced ${m.name}: ${plugins(countOf(m))}, nothing new`); return; }
      if ((hit = on('[data-mk-unsource]'))) { const i = src().markets.findIndex((y) => y.id === hit.dataset.mkUnsource), m = src().markets[i]; src().markets.splice(i, 1); draw(); say(`Removed the source ${m.name}`, () => { src().markets.splice(i, 0, m); draw(); }); return; }
      if ((hit = on('[data-mk-goto]'))) { window.StillhetShell.go(`marketplace/${hit.dataset.mkGoto}`); return; }
      if ((hit = on('[data-mk-more]'))) { shown[hit.dataset.mkMore] = Infinity; draw(); return; }
      if ((hit = on('[data-pick^="mk-sort|"]'))) { view.sort = hit.dataset.pick.split('|')[1]; menu = ''; draw(); page.querySelector('[data-menu="mk-sort"]')?.focus(); return; }
      if ((hit = on('[data-pick^="mk-view|"]'))) { const v = hit.dataset.pick.split('|')[1]; menu = ''; window.StillhetShell.go(v === 'all' ? 'marketplace' : `marketplace/~${v}`); setTimeout(() => page.querySelector(`[data-pick="mk-view|${v}"]`)?.focus(), 0); return; }
      if (!p && (hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); return; }
      if ((hit = on('[data-mk-card]'))) { step(src().plugins.find((x) => x.id === hit.dataset.mkCard)); return; }
      if ((hit = on('[data-mk-open]'))) { window.StillhetShell.go(`marketplace/${hit.dataset.mkOpen}`); return; }
      if (on('[data-mk-update-all]') && LIVE()) { if (updatingAll) return; updatingAll = true; draw(); LIVE().updateAll().then((a) => { updatingAll = false; if (a.text) say(a.text); draw(); }); return; }
      if (on('[data-mk-update-all]')) { const ups = src().plugins.filter((x) => x.update); ups.forEach((x) => { x.ver = x.update; delete x.update; }); draw(); say(`Updated ${ups.map(nameOf).join(', ')}`); return; }
      if (on('[data-mk-addgo]')) { const v = page.querySelector('[data-mk-add]')?.value.trim() || ''; addErr = addProblem(v); addVal = addErr ? v : ''; if (addErr) { draw(); page.querySelector('[data-mk-add]')?.focus(); return; }
        if (LIVE()) { addVal = v; LIVE().addSource(v).then((a) => { if (a.ok) { addVal = ''; const i = page.querySelector('[data-mk-add]'); if (i) i.value = ''; window.StillhetShell.go(a.to); } if (a.text) say(a.text); draw(); }); draw(); return; }
        src().markets.push({ id: `s${src().markets.length}`, name: srcKey(v) === v.toLowerCase() ? v : v.replace(/^(https?:\/\/)?(www\.)?(github\.com\/)?/, '').replace(/\.git$/, '').replace(/\/$/, ''), url: v, branch: 'main', sha: /^[.~/]/.test(v) ? '' : 'a1b2c3d', synced: 'just now' }); const added = src().markets[src().markets.length - 1]; window.StillhetShell.go(`marketplace/~src-${added.id}`); say(`Added ${added.name}: no plugins from it yet`); return; }
      if (!p || !page.querySelector('[data-mk-page]')) return;
      if (on('[data-mk-step]')) { step(p); return; }
      if (on('[data-mk-chat]')) { window.StillhetConversation?.handOver({ about: { kind: 'Plugin', name: nameOf(p) }, ph: `Ask about ${nameOf(p)}` }); return; }
      // Test connection waits on the plugin: busy with what it is doing, then its health says the answer
      if ((hit = on('[data-mk-test]'))) { R.busy(hit, { label: 'Testing…', until: new Promise((r) => setTimeout(r, 700)) }).then(() => { p.tested = 'just now'; if (current === p.id && here()) { draw(); page.querySelector('[data-mk-test]')?.focus(); } say(`${nameOf(p)} answered`); }); return; }
      if ((hit = on('[data-mk-ch-test]'))) { R.busy(hit, { label: 'Sending…', until: new Promise((r) => setTimeout(r, 700)) }).then(() => say(`Sent a test message to ${channelOf(p).chat}`)); return; }
      if (on('[data-mk-enable]')) { p.on = p.on === false; draw(); page.querySelector('[data-mk-enable]')?.focus(); say(p.on ? `${nameOf(p)} is on` : `${nameOf(p)} is off: nothing uses it`, () => { p.on = !p.on; draw(); }); return; }
      if (on('[data-mk-ch-edit]')) { form = { k: 'channel', id: p.id }; draw(); return; }
      if (on('[data-mk-setup]')) { setUp(p); return; }
      if ((hit = on('[data-confirm]'))) { confirm(p, hit.dataset.confirm === 'yes', hit); return; }
      if ((hit = on('[data-menu-pick]'))) { const [, v] = hit.dataset.menuPick.split('|'); menu = ''; if (v === 'remove' || v === 'purge') form = { k: v, id: p.id }; else if (LIVE()) LIVE().openSource(p.id).then((a) => { if (a.text) say(a.text); }); else say(window.StillhetWould(`open ${mkOf(p)?.url} at ${mkOf(p)?.sha} on GitHub`)); draw(); return; }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
    });
    page.addEventListener('submit', (e) => { if (!here()) return; e.preventDefault(); e.target.querySelector('[data-confirm="yes"]')?.click(); });   // Enter in a field takes the form's step
    R.dismissOnOutside(document, { open: () => here() && !!menu, inside: '#route-place .rc-pop, #route-place .spick, #route-place .pz-pick', back: () => null, close: () => { menu = ''; }, paint: draw });
    document.addEventListener('keydown', (e) => { if (e.key !== 'Escape' || !here() || menu || !form) return; form = null; draw(); }, true);   // capture: an open menu takes Esc first
    page.addEventListener('keydown', (e) => { if (here() && e.key === 'Enter' && e.target.matches('[data-mk-ch]')) { e.preventDefault(); e.target.closest('form')?.querySelector('[data-confirm="yes"]')?.click(); return; }   // several fields: Enter still saves
      if (!here() || !e.target.matches('[data-mk-add]')) return;
      if (e.key === 'Enter') { e.preventDefault(); page.querySelector('[data-mk-addgo]')?.click(); }
      if (e.key === 'Escape' && (e.target.value || addErr)) { addVal = ''; addErr = ''; draw(); page.querySelector('[data-mk-add]')?.focus(); } });
  }
  window.StillhetPlaces = window.StillhetPlaces || {};
  const byName = (name) => src().plugins.find((p) => nameOf(p) === name);
  const isWay = (k) => (k.startsWith('shelf-') ? /^shelf-\d+(-new)?$/.test(k) && !!SHELVES[parseInt(k.slice(6), 10)] : k.startsWith('src-') ? src().markets.some((m) => m.id === k.slice(4)) : ['updates', 'installed', 'new', 'for-you', 'all'].includes(k));
  window.StillhetPlaces.marketplace = { records: () => src(), changed: () => { if (here()) { openIfDue(); draw(); } }, has: (a) => (isLive() && listNow() !== 'ready') || (a.startsWith('~') ? isWay(a.slice(1)) : src().plugins.some((p) => p.id === a)),
    // the one truth of what is installed: Settings › Plugins and Workflows read it (undefined: not a plugin of this list)
    isInstalled: (name) => byName(name)?.installed, setInstalled: (name, on) => { const p = byName(name); if (p && !isLive()) setOn(p, on); },   // live: Settings › Plugins changes nothing here (D19)
    hasUpdate: (name) => !!byName(name)?.update, update: (name) => { const p = byName(name); if (p?.update && !isLive()) { p.ver = p.update; delete p.update; } },
    notInstalled: (n) => src().plugins.filter((p) => SHELVES[n][2].includes(p.kind) && !p.installed).length,
    search: (q) => src().plugins.filter((p) => `${nameOf(p)} ${p.id} ${p.what}`.toLowerCase().includes(q)).map((p) => ({ label: nameOf(p), where: `${p.kind.replace(/s$/, '')}${p.installed ? ' · installed' : ''}`, hash: `marketplace/${p.id}` })), sample: 'slack-chat', show: ({ bar: b, page: pg, arg }) => { openIfDue(); if (b !== bar) wire(b, pg); if (current !== arg) menu = ''; if (form && form.id !== arg) form = null; current = arg || ''; draw(); } };
})();
