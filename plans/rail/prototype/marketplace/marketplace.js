// Marketplace on Rail (Wave 3, 4.1, the mock Emil agreed on 8 Nov: plans/rail/mocks/wave-3/marketplace.html). Its home: a
// PlaceHead with the one update to take, For you (Worca's suggestions, each with its reason), then shelves named for what
// you want (Bring tasks in, Talk to Worca from, Give tasks tools, New agents and workflows), each plugin once, as
// PluginCards with its brand in Rail's line. A plugin's page: its PlaceHead and one step, what it adds, what it asks for,
// where it comes from. The bar lists them all. Installing asks in a short form; what is installed is managed in Settings.
(function () {
  const R = window.RailUI;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const data = {
    markets: [{ id: 'official', name: 'Worca CC Official', url: 'github.com/SinishaDjukic/worca-cc', branch: 'dev', sha: '42eb305', synced: 'just now' }],
    plugins: [
      { id: 'github-source', name: 'GitHub Issues', brand: 'brand-github', ver: '0.2.0', kind: 'Task sources', market: 'official', what: 'Pull tasks from GitHub Issues; close them when the PR merges.', adds: ['A task source: GitHub Issues'], asks: ['A GitHub token'], installed: false, uses: 120, why: 'Your projects live on GitHub' },
      { id: 'jira-source', name: 'Jira', brand: 'brand-jira', ver: '0.1.0', kind: 'Task sources', market: 'official', what: 'Pull tasks from Jira issues; write the result back to the ticket.', adds: ['A task source: Jira'], asks: ['A Jira API token', 'Your Jira site'], installed: true, uses: 60, update: '0.2.0' },
      { id: 'slack-chat', name: 'Slack', brand: 'brand-slack', ver: '0.2.0', kind: 'Chat channels', market: 'official', what: 'Talk to Worca from Slack: notices, and /status, /pause, /approve.', adds: ['A chat channel: Slack', 'Keeps a small worker running that listens for commands'], asks: ['A Slack bot token', 'A Slack app token'], installed: false, uses: 88, why: 'You step away most evenings: answer from your phone' },
      { id: 'telegram-chat', name: 'Telegram', brand: 'brand-telegram', ver: '0.1.0', kind: 'Chat channels', market: 'official', what: 'Notices and answers from Telegram.', adds: ['A chat channel: Telegram'], asks: ['A Telegram bot token'], installed: true, uses: 21 },
      { id: 'cloudflare-mcp', name: 'Cloudflare', brand: 'brand-cloudflare', ver: '0.1.0', kind: 'MCP servers', market: 'official', what: 'The whole Cloudflare API and its docs, for your tasks.', adds: ['2 MCP servers'], parts: [['MCP server', 'Cloudflare API'], ['MCP server', 'Cloudflare docs']], asks: ['A Cloudflare API token'], installed: false, uses: 45 },
      { id: 'notion-mcp', name: 'Notion', brand: 'brand-notion', ver: '0.1.0', kind: 'MCP servers', market: 'official', what: 'Search, read and edit Notion pages and databases.', adds: ['An MCP server: Notion'], asks: ['A Notion integration token'], installed: true, uses: 52 },
      { id: 'azure-source', name: 'Azure Boards', ver: '0.1.0', kind: 'Task sources', market: 'official', what: 'Pull tasks from Azure Boards work items.', adds: ['A task source: Azure Boards'], asks: ['An Azure DevOps token'], installed: true, uses: 12 },
      { id: 'discord-chat', name: 'Discord', ver: '0.1.0', kind: 'Chat channels', market: 'official', what: 'Notices and answers from Discord.', adds: ['A chat channel: Discord'], asks: ['A Discord bot token'], installed: true, uses: 18 },
      { id: 'teams-chat', name: 'Teams', ver: '0.1.0', kind: 'Chat channels', market: 'official', what: 'Notices and answers from Microsoft Teams.', adds: ['A chat channel: Teams'], asks: ['A Teams bot token'], installed: true, uses: 30 },
      { id: 'sentry-mcp', name: 'Sentry', ver: '0.1.0', kind: 'MCP servers', market: 'official', what: 'Read issues and traces from Sentry, for your tasks.', adds: ['An MCP server: Sentry'], asks: ['A Sentry auth token'], installed: false, uses: 70 },
      { id: 'review-pack', name: 'Review pack', ver: '1.0.0', kind: 'Agents', market: 'official', what: 'A security and a performance reviewer, ready for your workflows.', adds: ['2 agents'], asks: [], installed: false, uses: 34,
        gives: { agent: [{ id: 'sec-review', title: 'Security review', type: 'verifier', ins: 'the change', outs: 'findings when it blocks', model: 'Opus 5.5', effort: 'high', asks: false, fan: false, says: 'Reviews the change for security problems.' }, { id: 'perf-review', title: 'Performance review', type: 'verifier', ins: 'the change', outs: 'findings when it blocks', model: 'Sonnet 5.5', effort: 'high', asks: false, fan: false, says: 'Reviews the change for what would run slowly.' }] } },
      { id: 'promo-video', name: 'Promo video', ver: '0.3.0', kind: 'Workflows', market: 'official', what: 'From a feature to a 30-second video: script, shots, cut.', adds: ['A workflow and 3 agents'], asks: [], installed: false, uses: 7,
        gives: { agent: [{ id: 'script-writer', title: 'Script writer', type: 'producer', ins: 'the feature', outs: 'the script', model: 'Opus 5.5', effort: 'high', asks: true, fan: false, says: 'Writes the 30-second script.' }, { id: 'shot-maker', title: 'Shot maker', type: 'producer', ins: 'the script', outs: 'the shots', model: 'Sonnet 5.5', effort: 'medium', asks: false, fan: false, says: 'Makes each shot.' }, { id: 'video-cutter', title: 'Video cutter', type: 'producer', ins: 'the shots', outs: 'the video', model: 'Haiku 5.5', effort: 'medium', asks: false, fan: false, says: 'Cuts the shots into the video.' }],
          workflow: [{ id: 'promo-video', title: 'Promo video', what: 'From a feature to a 30-second video: script, shots, cut.', steps: [['Script', 'script-writer', 'Opus 5.5', 'high', 4, 0.30], ['Shots', 'shot-maker', 'Sonnet 5.5', 'medium', 12, 0.60], ['Cut', 'video-cutter', 'Haiku 5.5', 'medium', 3, 0.05]] }] } },
    ],
  };
  const view = { sort: 'used' };
  let current = '', form = null, ctl = null, home = null, bar = null, page = null, menu = '', addVal = '', addErr = '';
  const srcKey = (s) => s.trim().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/^github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '').toLowerCase();
  const countOf = (m) => data.plugins.filter((p) => p.market === m.id).length;
  const plugins = (n) => `${n} ${n === 1 ? 'plugin' : 'plugins'}`;
  // the one reading of a source you typed: why it cannot be added, or ''
  const addProblem = (v) => (!v ? 'Say which repository or folder first.' : v.length > 200 ? 'That is too long for a repository or a folder.' : !/^(https?:\/\/\S+|[.~]{0,2}\/\S*|(www\.)?github\.com\/[\w.-]+\/[\w.-]+\/?|[\w.-]+\/[\w.-]+)$/.test(v) ? 'Use owner/repo, a GitHub URL or a folder.' : data.markets.some((m) => srcKey(m.url) === srcKey(v)) ? 'That source is already added.' : '');
  const stOf = (p) => (p.update ? { word: 'Update available', tone: 'act', act: `Update to ${p.update}` } : p.installed ? { word: 'Installed', tone: 'ok', act: 'Set it up' } : { word: 'Not installed', tone: 'idle', act: 'Install' });
  const SHELF_ICON = ['track', 'kind-chat', 'sliders', 'kind-workflow'];   // the plug means a plugin, always (look.one-icon)
  const SORTS = { used: 'most used', new: 'highest version', az: 'A–Z' };   // a plugin has a version and no date: the sort says what it reads
  const shown = {};   // how many of a view's plugins are shown: six, then Show N more
  const SHELVES = [['Bring tasks in', 'Tickets become tasks; the result goes back to the ticket.', ['Task sources']], ['Talk to Worca from', 'Answer what needs you without opening Worca.', ['Chat channels']], ['Give tasks tools', 'MCP servers and models a task can call.', ['MCP servers', 'Models']], ['New agents and workflows', 'Steps and whole flows for your workflows.', ['Agents', 'Workflows', 'Scripts', 'Skills']]];
  const nameOf = (p) => p.name || p.id;
  const markOf = (p, size = 20) => R.kindMark({ kind: 'plugin', icon: p.brand || '', tone: stOf(p).tone, size, title: stOf(p).word });   // its brand in Rail's line; a plug without one
  const factsOf = (p) => `Adds ${p.adds.map((a) => { const w = a.split(':')[0]; return w.charAt(0).toLowerCase() + w.slice(1); }).join(', ')} · ${p.asks.length ? `asks for ${p.asks.length === 1 ? p.asks[0].replace(/^A /, 'a ').replace(/^An /, 'an ').replace(/^Your /, 'your ') : `${p.asks.length} things`}` : 'asks for nothing'}`;
  // what it adds, each by name: [kind of thing, its name]
  const partsOf = (p) => p.parts || (p.gives ? Object.entries(p.gives).flatMap(([k, l]) => l.map((x) => [k === 'agent' ? 'Agent' : 'Workflow', `${x.title}: ${x.says || x.what}`])) : p.adds.map((a) => { const i = a.indexOf(': '); return i > 0 ? [a.slice(0, i).replace(/^An? /, '').replace(/^./, (c) => c.toUpperCase()), a.slice(i + 2)] : ['Also', a]; }));
  // Worca's suggestions: one you install stays where it was until you leave them
  const forYou = () => data.plugins.filter((p) => p.why && (!p.installed || p.keptForYou));
  // Update lives on the card that has it, once per plugin (rail.one-action)
  const cardOf = (p, why = false) => R.pluginCard({ mark: markOf(p), kicker: `${p.kind.replace(/s$/, '')}${p.update ? '' : ` · ${p.installed ? 'installed' : p.ver}`}`, update: p.update || '', title: nameOf(p), what: p.what, why: why ? p.why : '', facts: factsOf(p),
    action: R.button({ label: stOf(p).act, kind: p.installed && !p.update ? 'quiet' : '', attrs: { 'data-mk-card': p.id } }), more: R.button({ label: 'What it asks for', kind: 'quiet', attrs: { 'data-mk-open': p.id } }), attrs: { 'data-mk-plugin': p.id } });
  const marketOf = (p) => data.markets.find((m) => m.id === p.market)?.name || 'linked';
  const rowOf = (p) => ({ key: `plug:${p.id}`, _p: p, title: nameOf(p), mark: markOf(p), end: p.update ? `Update ${p.update}` : p.installed ? 'Installed' : p.ver, current: p.id === current, tip: `${p.id} ${p.ver}\n${p.kind} · ${marketOf(p)}\n${p.what}`,
    menu: [{ id: 'step', text: stOf(p).act, help: p.installed ? 'Its settings, in Settings › Plugins' : `Adds ${p.adds.join(', ')}` }, { id: 'source', text: 'View its source', help: `${marketOf(p)} · ${data.markets[0].sha}` }] });
  // Set it up: a plugin that asks for nothing says so; one that asks lands on its own row in Settings › Plugins
  function setUp(p) {
    if (!p.asks.length) { say(`${nameOf(p)} is set up: it asks for nothing`); return; }
    window.addEventListener('hashchange', () => {
      const row = [...document.querySelectorAll('#route-settings .list-row')].find((r) => r.querySelector('.lr-t')?.textContent.trim() === nameOf(p));
      if (row) { row.scrollIntoView({ block: 'center' }); row.querySelector('.lr-main')?.focus({ preventScroll: true }); R.land(row); }
    }, { once: true });
    window.RailShell.go('settings/plugins');
  }
  function step(p) {
    if (p.update) { p.ver = p.update; delete p.update; draw(); say(`Updated ${nameOf(p)} to ${p.ver}`); return; }
    if (p.installed) { setUp(p); return; }
    form = { k: 'install', id: p.id }; if (current === p.id) draw(); else window.RailShell.go(`marketplace/${p.id}`);
  }
  function pageHtml(p) {
    const st = stOf(p);
    const asking = form?.id === p.id && form.k === 'install';   // the form below holds the one Install
    const head = R.placeHead({ center: { label: 'Marketplace', to: 'marketplace' }, title: nameOf(p), facts: esc(`${p.kind.replace(/s$/, '')} · ${p.id} ${p.ver}`), mark: markOf(p), word: st.word, why: p.what,
      action: asking ? '' : R.button({ label: st.act, attrs: { 'data-mk-step': '' } }),   // no Warning here: outlined (rail.one-action)
      menu: R.moreMenu({ id: 'mk-more', label: `More for ${p.id}`, icon: R.icon('more', 16), open: menu === 'mk-more', items: [{ id: 'source', text: 'View its source', help: 'Would open it on GitHub' }, ...(p.installed ? [{ sep: true }, { id: 'remove', text: 'Remove…', danger: true, help: 'Asks first; says what stops working' }] : [])] }) });
    const install = form?.id === p.id && form.k === 'install' ? R.confirmForm({ form: 'install', id: 'mk-install-t', text: `Install ${p.id} ${p.ver}? It adds ${p.adds.map((a) => a.charAt(0).toLowerCase() + a.slice(1)).join(' and ')}${p.asks.length ? `, and asks for ${p.asks.map((a) => a.charAt(0).toLowerCase() + a.slice(1)).join(' and ')}: you set ${p.asks.length > 1 ? 'them' : 'it'} up in Settings after` : ''}.`, body: R.confirmActions({ yes: 'Install' }) })
      : form?.id === p.id && form.k === 'remove' ? R.confirmStrip({ text: `Remove ${p.id}? What it adds stops working; its settings and secrets stay until you purge them.`, yes: 'Remove', danger: true }) : '';
    const rows = R.settingsSection({ title: 'What it adds', rows: partsOf(p).map(([kind, name]) => R.settingsRow({ name: esc(kind), sentence: esc(name) })).join('') })
      + R.settingsSection({ title: 'What it asks for', rows: p.asks.length ? p.asks.map((a) => R.settingsRow({ name: /site$/.test(a) ? 'Site' : 'Token', sentence: esc(a.replace(/^(An?|Your) /, '').replace(/ (token|site)$/, '')), end: p.installed ? R.button({ label: 'Set up', kind: 'quiet', attrs: { 'data-mk-setup': '' } }) : '' })).join('') : R.settingsRow({ name: 'Setup', sentence: 'No secrets, nothing to do' }) })
      + R.settingsSection({ title: 'Where it comes from', rows: R.settingsRow({ name: 'Repository', sentence: esc(`${data.markets[0].url} on ${data.markets[0].branch} · ${data.markets[0].sha}`) }) });
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${install}${rows}</div></div><div class="convo-dock" id="mk-dock"></div></div>`;
  }
  function wayOf(key) {
    if (key === 'updates') return { title: 'Updates', meta: 'What can be updated; nothing new is asked for unless it says so', list: data.plugins.filter((p) => p.update) };
    if (key === 'installed') return { title: 'Installed', meta: 'Turn one off, remove it or set it up in Settings › Plugins', list: data.plugins.filter((p) => p.installed) };
    if (key === 'for-you') return { title: 'For you', meta: 'Worca suggests these from how you work; each says why', list: forYou(), why: true };
    if (key === 'all') return { title: 'All plugins', meta: 'Every plugin from every source', list: data.plugins.slice() };
    if (key.startsWith('shelf-')) { const [t, meta, kinds] = SHELVES[parseInt(key.slice(6), 10)], fresh = key.endsWith('-new'); return { title: t, meta: fresh ? 'What you have not installed yet' : meta, list: data.plugins.filter((p) => kinds.includes(p.kind) && !forYou().includes(p) && !(fresh && p.installed)), fresh }; }
    if (key.startsWith('src-')) { const m = data.markets.find((x) => x.id === key.slice(4)); return { title: m?.name || 'Source', meta: m ? `${m.url} · synced ${m.synced}` : '', list: data.plugins.filter((p) => p.market === m?.id) }; }
    return null;
  }
  function emptyOf(key, w) {   // an empty view says what comes next
    const goto = (label, to) => R.button({ label, kind: 'quiet', attrs: { 'data-mk-goto': to } });
    if (key.startsWith('src-')) return R.emptyState({ title: 'No plugins from this source yet.', text: 'A plugin shows here once its repository or folder holds a worca-cc-plugin.json. Sync after adding one.', actions: R.button({ label: 'Sync', attrs: { 'data-mk-sync': key.slice(4) } }) + goto('All plugins', '~all') });
    if (w.fresh) return R.emptyState({ title: 'You have installed them all.', text: 'What they added is in your workflows and agents.', actions: goto('Installed', '~installed') });
    return R.emptyState({ title: key === 'updates' ? 'Everything is up to date.' : 'Nothing here yet.', actions: goto('All plugins', '~all') });
  }
  function wayHtml(key) {
    const w = wayOf(key); if (!w) return homeHtml();
    const sort = view.sort || 'used', list = w.list.sort((a, b) => (sort === 'az' ? nameOf(a).localeCompare(nameOf(b)) : sort === 'new' ? b.ver.localeCompare(a.ver, undefined, { numeric: true }) : (b.uses || 0) - (a.uses || 0))), n = shown[key] || 6;
    const ups = key === 'updates' && list.length > 1 ? R.button({ label: `Update all ${list.length}`, attrs: { 'data-mk-update-all': '' } }) : '';
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${R.placeHead({ center: { label: 'Marketplace', to: 'marketplace' }, title: w.title, facts: esc(`${list.length} ${list.length === 1 ? 'plugin' : 'plugins'} · ${w.meta}`), ...(ups ? { mark: R.kindMark({ kind: 'plugin', icon: 'refresh', tone: 'act' }), word: `${list.length} to update`, why: 'Each asks for nothing new', action: ups } : {}) })}
      ${list.length > 1 ? `<div class="convo-head">Showing ${R.sentencePicker({ id: 'mk-sort', text: SORTS[sort], items: Object.entries(SORTS).map(([id, text]) => ({ id, text, checked: id === sort })), open: menu === 'mk-sort', chevron: R.icon('chevron', 10) })} first</div>` : ''}
      ${list.length ? `<div class="pg-grid">${list.slice(0, n).map((p) => cardOf(p, w.why)).join('')}</div>${list.length > n ? `<div style="margin:12px 0 0">${R.button({ label: `Show ${list.length - n} more`, kind: 'quiet', attrs: { 'data-mk-more': key } })}</div>` : ''}` : emptyOf(key, w)}
    </div></div></div>`;
  }
  function homeHtml() {
    const m = data.markets, ups = data.plugins.filter((p) => p.update), yours = forYou(), rest = data.plugins.filter((p) => !yours.includes(p));   // each plugin once
    const shelf = (title, meta, list, cls = '') => (list.length ? `<section class="pg-shelf ${cls}"><h2 class="pg-shelf-h">${esc(title)} <span class="n">${list.length}</span></h2>${meta ? `<p class="pg-shelf-m">${esc(meta)}</p>` : ''}<div class="pg-grid">${list.map((p) => cardOf(p, cls === 'pg-for')).join('')}</div></section>` : '');
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${R.placeHead({ title: 'Marketplace', facts: `${data.plugins.length} plugins · ${data.plugins.filter((p) => p.installed).length} installed · from ${m.length === 1 ? esc(m[0].name) : `${m.length} sources`}`,
      ...(ups.length ? { mark: R.kindMark({ kind: 'plugin', tone: 'act' }), word: `${ups.length} ${ups.length === 1 ? 'update' : 'updates'}`, why: `${ups.map((p) => `${nameOf(p)} ${p.update}`).join(', ')} asks for nothing new`, ...(ups.length > 1 ? { action: R.button({ label: 'Update all', attrs: { 'data-mk-update-all': '' } }) } : {}) } : {}) })}
      ${shelf('For you', 'Worca suggests these from how you work; each says why.', yours, 'pg-for')}
      ${SHELVES.map(([t, meta, kinds]) => shelf(t, meta, rest.filter((p) => kinds.includes(p.kind)))).join('')}
      ${R.settingsSection({ title: 'Where plugins come from', rows: m.map((x) => R.settingsRow({ name: x.name, sentence: esc([x.url, `synced ${x.synced}`, x.sha].filter(Boolean).join(' · ')), end: R.button({ label: 'Sync', kind: 'quiet', attrs: { 'data-mk-sync': x.id } }) + (x.id === 'official' ? '' : R.button({ label: 'Remove', kind: 'quiet', attrs: { 'data-mk-unsource': x.id, title: 'Stops looking here; Undo brings it back' } })) })).join('') + R.settingsRow({ name: 'Add one', sentence: R.field({ id: 'mk-add', label: 'Repository or folder', quietLabel: true, placeholder: 'owner/repo, a GitHub URL or a folder', value: addVal, error: addErr, attrs: { 'data-mk-add': '' } }), end: R.button({ label: 'Add', attrs: { 'data-mk-addgo': '' } }) }) })}</div></div></div>`;
  }
  const here = () => (location.hash.slice(1) || '').split('/')[0] === 'marketplace';   // the page area is shared by every place: draw only while this one is open
  function draw() {
    if (!bar || !page || !here()) return;
    ctl?.paint();
    const p = data.plugins.find((x) => x.id === current);
    page.innerHTML = p ? pageHtml(p) : current.startsWith('~') ? wayHtml(current.slice(1)) : homeHtml();
    if (p) window.RailConversation?.dock(document.getElementById('mk-dock'), { kind: 'plugin', title: p.id, chat: '' });
    if (p && form && !form.focused) { form.focused = true; page.querySelector('[data-confirm="yes"]')?.focus(); }   // Enter takes it, Esc leaves it
  }
  const setOn = (p, on) => { if (on && p.why) p.keptForYou = true; p.installed = on; if (!on) delete p.update; window.RailPlaces.workflows?.plugin(p.id, nameOf(p), p.gives, on); };   // one truth: Workflows' lists and counts follow
  function wire(b, pg) {
    bar = b; page = pg;
    const way = (key, title, mark, n) => ({ key: `way:${key}`, _way: key, title, mark, end: String(n), current: current === `~${key}`, tip: `${title} · ${n}` });
    ctl = R.listController({ root: bar, spec: { noun: 'plugins', label: 'Selected plugins', view: () => ({ state: 'ready', parts: [],
      sections: [{ id: 'yours', title: 'Yours', noCount: true, rows: [way('updates', 'Updates', R.kindMark({ kind: 'plugin', icon: 'refresh', tone: data.plugins.some((p) => p.update) ? 'act' : 'idle' }), data.plugins.filter((p) => p.update).length), way('installed', 'Installed', R.kindMark({ kind: 'plugin', icon: 'check' }), data.plugins.filter((p) => p.installed).length)] },
        { id: 'browse', title: 'Browse', noCount: true, rows: [way('for-you', 'For you', R.kindMark({ kind: 'plugin', icon: 'whoYou' }), forYou().length), ...SHELVES.map(([t, , kinds], n) => way(`shelf-${n}`, t, R.kindMark({ kind: 'plugin', icon: SHELF_ICON[n] }), data.plugins.filter((p) => kinds.includes(p.kind) && !forYou().includes(p)).length)), way('all', 'All plugins', R.kindMark({ kind: 'plugin', icon: 'list' }), data.plugins.length)] },
        { id: 'sources', title: 'Sources', noCount: true, rows: data.markets.map((m) => way(`src-${m.id}`, m.name, R.kindMark({ kind: 'plugin', icon: /^[.~/]/.test(m.url) ? 'folder' : 'brand-github' }), data.plugins.filter((p) => p.market === m.id).length)) }] }),
      can: () => [], bulk: () => [], act: () => {}, open: (r) => window.RailShell.go(`marketplace/~${r._way}`), word: () => false, say, active: () => /^#marketplace/.test(location.hash) } });
    page.addEventListener('click', (e) => {
      if (!here()) return;   /* another place's page is showing */
      const on = (q) => e.target.closest(q); let hit; const p = data.plugins.find((x) => x.id === current);
      if ((hit = on('[data-mk-sync]'))) { const m = data.markets.find((y) => y.id === hit.dataset.mkSync); m.synced = 'just now'; draw(); say(`Synced ${m.name}: ${plugins(countOf(m))}, nothing new`); return; }
      if ((hit = on('[data-mk-unsource]'))) { const i = data.markets.findIndex((y) => y.id === hit.dataset.mkUnsource), m = data.markets[i]; data.markets.splice(i, 1); draw(); say(`Removed the source ${m.name}`, () => { data.markets.splice(i, 0, m); draw(); }); return; }
      if ((hit = on('[data-mk-goto]'))) { window.RailShell.go(`marketplace/${hit.dataset.mkGoto}`); return; }
      if ((hit = on('[data-mk-more]'))) { shown[hit.dataset.mkMore] = Infinity; draw(); return; }
      if ((hit = on('[data-menu-pick^="mk-sort|"]'))) { view.sort = hit.dataset.menuPick.split('|')[1]; menu = ''; draw(); return; }
      if (!p && (hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); return; }
      if ((hit = on('[data-mk-card]'))) { step(data.plugins.find((x) => x.id === hit.dataset.mkCard)); return; }
      if ((hit = on('[data-mk-open]'))) { window.RailShell.go(`marketplace/${hit.dataset.mkOpen}`); return; }
      if (on('[data-mk-update-all]')) { const ups = data.plugins.filter((x) => x.update); ups.forEach((x) => { x.ver = x.update; delete x.update; }); draw(); say(`Updated ${ups.map(nameOf).join(', ')}`); return; }
      if (on('[data-mk-addgo]')) { const v = page.querySelector('[data-mk-add]')?.value.trim() || ''; addErr = addProblem(v); addVal = addErr ? v : ''; if (addErr) { draw(); page.querySelector('[data-mk-add]')?.focus(); return; } data.markets.push({ id: `s${data.markets.length}`, name: srcKey(v) === v.toLowerCase() ? v : v.replace(/^(https?:\/\/)?(www\.)?(github\.com\/)?/, '').replace(/\.git$/, '').replace(/\/$/, ''), url: v, branch: 'main', sha: /^[.~/]/.test(v) ? '' : 'a1b2c3d', synced: 'just now' }); const added = data.markets[data.markets.length - 1]; window.RailShell.go(`marketplace/~src-${added.id}`); say(`Added ${added.name}: no plugins from it yet`); return; }
      if (!p || !page.querySelector('#mk-dock')) return;
      if (on('[data-mk-step]')) { step(p); return; }
      if (on('[data-mk-setup]')) { setUp(p); return; }
      if ((hit = on('[data-confirm]'))) { const yes = hit.dataset.confirm === 'yes', was = form?.k; form = null; if (yes && was === 'install') { setOn(p, true); say(`Installed ${p.id}${p.asks.length ? ': set it up in Settings' : ''}`); } if (yes && was === 'remove') { setOn(p, false); say(`Removed ${p.id}`); } draw(); return; }
      if ((hit = on('[data-menu-pick]'))) { const [, v] = hit.dataset.menuPick.split('|'); menu = ''; if (v === 'remove') form = { k: 'remove', id: p.id }; else say(`Would open ${data.markets[0].url} at ${data.markets[0].sha} on GitHub`); draw(); return; }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
    });
    R.dismissOnOutside(document, { open: () => here() && !!menu, inside: '#route-place .rc-pop, #route-place .spick', back: () => null, close: () => { menu = ''; }, paint: draw });
    document.addEventListener('keydown', (e) => { if (e.key !== 'Escape' || !here() || menu || !form) return; form = null; draw(); }, true);   // capture: an open menu takes Esc first
    page.addEventListener('keydown', (e) => { if (!here() || !e.target.matches('[data-mk-add]')) return;
      if (e.key === 'Enter') { e.preventDefault(); page.querySelector('[data-mk-addgo]')?.click(); }
      if (e.key === 'Escape' && (e.target.value || addErr)) { addVal = ''; addErr = ''; draw(); page.querySelector('[data-mk-add]')?.focus(); } });
  }
  window.RailPlaces = window.RailPlaces || {};
  const byName = (name) => data.plugins.find((p) => nameOf(p) === name);
  const isWay = (k) => (k.startsWith('shelf-') ? /^shelf-\d+(-new)?$/.test(k) && !!SHELVES[parseInt(k.slice(6), 10)] : k.startsWith('src-') ? data.markets.some((m) => m.id === k.slice(4)) : ['updates', 'installed', 'for-you', 'all'].includes(k));
  window.RailPlaces.marketplace = { has: (a) => (a.startsWith('~') ? isWay(a.slice(1)) : data.plugins.some((p) => p.id === a)),
    // the one truth of what is installed: Settings › Plugins and Workflows read it (undefined: not a plugin of this list)
    isInstalled: (name) => byName(name)?.installed, setInstalled: (name, on) => { const p = byName(name); if (p) setOn(p, on); },
    hasUpdate: (name) => !!byName(name)?.update, update: (name) => { const p = byName(name); if (p?.update) { p.ver = p.update; delete p.update; } },
    notInstalled: (n) => data.plugins.filter((p) => SHELVES[n][2].includes(p.kind) && !p.installed).length,
    search: (q) => data.plugins.filter((p) => `${nameOf(p)} ${p.id} ${p.what}`.toLowerCase().includes(q)).map((p) => ({ label: nameOf(p), where: `${p.kind.replace(/s$/, '')}${p.installed ? ' · installed' : ''}`, hash: `marketplace/${p.id}` })), sample: 'slack-chat', show: ({ bar: b, page: pg, arg }) => { if (b !== bar) wire(b, pg); if (current !== arg) menu = ''; if (form && form.id !== arg) form = null; current = arg || ''; draw(); } };
})();
