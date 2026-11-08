// Marketplace on Rail (Wave 3, 4.1): dev's Browse, install and marketplaces, Rail's design. One list in the one bar (no
// card per plugin): its sentence picks what a plugin adds and where it comes from; a plugin's page is a PlaceHead with its
// one step (Install, Update, Set up), then what it adds, what it asks for and where it comes from, as rows. Installing
// asks in a short form under the head; what is installed is managed in Settings › Plugins, as it is today.
(function () {
  const R = window.RailUI;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const KINDS = ['Task sources', 'Chat channels', 'MCP servers', 'Models', 'Agents', 'Scripts', 'Skills', 'Workflows'];
  const data = {
    markets: [{ id: 'official', name: 'Worca CC Official', url: 'github.com/SinishaDjukic/worca-cc', branch: 'dev', sha: '42eb305', synced: 'just now' }],
    plugins: [
      { id: 'github-source', ver: '0.2.0', kind: 'Task sources', market: 'official', what: 'Pull tasks from GitHub Issues, write results back', adds: ['A task source: GitHub Issues'], asks: ['A GitHub token'], installed: false },
      { id: 'jira-source', ver: '0.1.0', kind: 'Task sources', market: 'official', what: 'Pull tasks from Jira issues, write results back', adds: ['A task source: Jira'], asks: ['A Jira API token', 'Your Jira site'], installed: true, update: '0.2.0' },
      { id: 'slack-chat', ver: '0.2.0', kind: 'Chat channels', market: 'official', what: 'A two-way Slack channel: notices, and /status, /pause, /approve from Slack', adds: ['A chat channel: Slack', 'Runs a worker that listens for commands'], asks: ['A Slack bot token', 'A Slack app token'], installed: false },
      { id: 'cloudflare-mcp', ver: '0.1.0', kind: 'MCP servers', market: 'official', what: 'The whole Cloudflare API, and its docs, for your tasks', adds: ['2 MCP servers'], asks: ['A Cloudflare API token'], installed: false },
      { id: 'notion-mcp', ver: '0.1.0', kind: 'MCP servers', market: 'official', what: 'Search, read and edit Notion pages and databases', adds: ['An MCP server: Notion'], asks: ['A Notion integration token'], installed: true },
      { id: 'review-pack', ver: '1.0.0', kind: 'Agents', market: 'official', what: 'A security and a performance reviewer, ready for your workflows', adds: ['2 agents'], asks: [], installed: false },
    ],
  };
  const view = { adds: 'all', from: 'all' };
  let current = '', form = null, ctl = null, home = null, bar = null, page = null, menu = '';
  const stOf = (p) => (p.update ? { word: 'Update available', tone: 'act', act: `Update to ${p.update}` } : p.installed ? { word: 'Installed', tone: 'ok', act: 'Set it up' } : { word: 'Not installed', tone: 'idle', act: 'Install' });
  const marketOf = (p) => data.markets.find((m) => m.id === p.market)?.name || 'linked';
  const rowOf = (p) => ({ key: `plug:${p.id}`, _p: p, title: p.id, mark: R.kindMark({ kind: 'plugin', tone: stOf(p).tone, title: stOf(p).word }), end: p.update ? `Update ${p.update}` : p.installed ? 'Installed' : p.ver, current: p.id === current, tip: `${p.id} ${p.ver}\n${p.kind} · ${marketOf(p)}\n${p.what}`,
    menu: [{ id: 'step', text: stOf(p).act, help: p.installed ? 'Its settings, in Settings › Plugins' : `Adds ${p.adds.join(', ')}` }, { id: 'source', text: 'View its source', help: `${marketOf(p)} · ${data.markets[0].sha}` }] });
  function step(p) {
    if (p.update) { p.ver = p.update; delete p.update; draw(); say(`Updated ${p.id} to ${p.ver}`); return; }
    if (p.installed) { window.RailShell.go('settings/plugins'); return; }
    form = { k: 'install', id: p.id }; if (current === p.id) draw(); else window.RailShell.go(`marketplace/${p.id}`);
  }
  function pageHtml(p) {
    const st = stOf(p);
    const head = R.placeHead({ title: p.id, facts: esc(`${p.kind.replace(/s$/, '')} · ${p.ver} · ${marketOf(p)}`), mark: R.kindMark({ kind: 'plugin', tone: st.tone, title: st.word }), word: st.word, why: p.what,
      action: R.button({ label: st.act, kind: p.installed && !p.update ? '' : 'primary', attrs: { 'data-mk-step': '' } }),
      menu: R.moreMenu({ id: 'mk-more', label: `More for ${p.id}`, icon: R.icon('more', 16), open: menu === 'mk-more', items: [{ id: 'source', text: 'View its source', help: `${data.markets[0].url} · ${data.markets[0].sha}` }, ...(p.installed ? [{ sep: true }, { id: 'remove', text: 'Remove…', danger: true, help: 'Asks first; says what stops working' }] : [])] }) });
    const install = form?.id === p.id && form.k === 'install' ? `<div class="card-form">${R.confirmForm({ form: 'install', id: 'mk-install-t', text: `Install ${p.id} ${p.ver}? It ${p.adds.map((a) => a.charAt(0).toLowerCase() + a.slice(1)).join(' and ')}${p.asks.length ? `, and asks for ${p.asks.map((a) => a.charAt(0).toLowerCase() + a.slice(1)).join(' and ')}: you set ${p.asks.length > 1 ? 'them' : 'it'} up in Settings after` : ''}.`, body: R.confirmActions({ yes: 'Install' }) })}</div>`
      : form?.id === p.id && form.k === 'remove' ? R.confirmStrip({ text: `Remove ${p.id}? What it adds stops working; its settings and secrets stay until you purge them.`, yes: 'Remove', danger: true }) : '';
    const rows = R.settingsSection({ title: 'What it adds', rows: p.adds.map((a) => R.settingsRow({ name: 'Adds', sentence: esc(a) })).join('') })
      + R.settingsSection({ title: 'What it asks for', rows: p.asks.length ? p.asks.map((a) => R.settingsRow({ name: 'Asks for', sentence: esc(a), end: p.installed ? R.button({ label: 'Set up', kind: 'quiet', attrs: { 'data-mk-setup': '' } }) : '' })).join('') : R.settingsRow({ name: 'Nothing', sentence: 'No secrets, no setup' }) })
      + R.settingsSection({ title: 'Where it comes from', rows: R.settingsRow({ name: 'Source', sentence: esc(`${data.markets[0].url} on ${data.markets[0].branch} · ${data.markets[0].sha}`) }) });
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${install}${rows}</div></div><div class="convo-dock" id="mk-dock"></div></div>`;
  }
  function homeHtml() {
    const m = data.markets;
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${R.placeHead({ title: 'Marketplace', facts: esc(`${m.length} ${m.length === 1 ? 'marketplace' : 'marketplaces'} · ${data.plugins.length} plugins · ${data.plugins.filter((p) => p.installed).length} installed`) })}
      ${R.settingsSection({ title: 'Where plugins come from', rows: m.map((x) => R.settingsRow({ name: x.name, sentence: esc(`${x.url} · synced ${x.synced} · ${x.sha}`), end: R.button({ label: 'Sync', kind: 'quiet', attrs: { 'data-mk-sync': x.id } }) })).join('') + R.settingsRow({ name: 'Add one', sentence: R.field({ id: 'mk-add', label: 'Repository or folder', quietLabel: true, placeholder: 'owner/repo, a GitHub URL or a folder', attrs: { 'data-mk-add': '' } }), end: R.button({ label: 'Add', attrs: { 'data-mk-addgo': '' } }) }) })}
      ${R.emptyState({ title: 'Pick a plugin in the list beside.', text: 'Each says what it adds and what it asks for before you install it.' })}</div></div></div>`;
  }
  function draw() {
    if (!bar || !page) return;
    ctl?.paint();
    const p = data.plugins.find((x) => x.id === current);
    page.innerHTML = p ? pageHtml(p) : homeHtml();
    if (p) window.RailConversation?.dock(document.getElementById('mk-dock'), { kind: 'plugin', title: p.id, chat: '' });
  }
  function wire(b, pg) {
    bar = b; page = pg;
    const shown = () => data.plugins.filter((p) => (view.adds === 'all' || p.kind === view.adds) && (view.from === 'all' || p.market === view.from));
    ctl = R.listController({ root: bar, spec: { noun: 'plugins', label: 'Selected plugins', view: () => ({ state: 'ready',
      parts: [{ word: 'Showing', id: 'adds', text: view.adds === 'all' ? 'all plugins' : view.adds.toLowerCase(), tip: 'What a plugin adds', items: [{ id: 'all', text: 'all plugins', checked: view.adds === 'all' }, { sep: true }, ...KINDS.map((k) => ({ id: k, text: k.toLowerCase(), checked: view.adds === k, hint: String(data.plugins.filter((p) => p.kind === k).length) }))] },
        { word: 'from', id: 'from', text: view.from === 'all' ? 'every marketplace' : data.markets.find((m) => m.id === view.from)?.name, tip: 'Where it comes from', items: [{ id: 'all', text: 'every marketplace', checked: view.from === 'all' }, ...data.markets.map((m) => ({ id: m.id, text: m.name, checked: view.from === m.id }))] }],
      sections: [{ id: 'update', title: 'Updates', rows: shown().filter((p) => p.update).map(rowOf) }, { id: 'new', title: 'Not installed', rows: shown().filter((p) => !p.installed).map(rowOf) }, { id: 'in', title: 'Installed', rows: shown().filter((p) => p.installed && !p.update).map(rowOf) }],
      empty: { text: 'No plugins like that.', action: 'Show all plugins' } }),
      can: () => ['menu'], bulk: () => [], act: (id, rows) => { const p = rows[0]?._p; if (!p) return; if (id === 'step') step(p); else say(`${p.id}: ${data.markets[0].url} at ${data.markets[0].sha}`); },
      open: (r) => window.RailShell.go(`marketplace/${r._p.id}`), word: (id, v) => { view[id] = v; return false; }, say, active: () => /^#marketplace/.test(location.hash), emptyAct: () => { view.adds = 'all'; view.from = 'all'; draw(); } } });
    page.addEventListener('click', (e) => {
      const on = (q) => e.target.closest(q); let hit; const p = data.plugins.find((x) => x.id === current);
      if ((hit = on('[data-mk-sync]'))) { data.markets.find((m) => m.id === hit.dataset.mkSync).synced = 'just now'; draw(); say('Synced: 6 plugins, nothing new'); return; }
      if (on('[data-mk-addgo]')) { const v = page.querySelector('[data-mk-add]')?.value.trim(); if (!v) { page.querySelector('[data-mk-add]')?.focus(); say('Say which repository or folder first'); return; } data.markets.push({ id: v, name: v.split('/').pop(), url: v, branch: 'main', sha: 'a1b2c3d', synced: 'just now' }); draw(); say(`Added ${v}: its plugins are in the list`); return; }
      if (!p || !page.querySelector('#mk-dock')) return;
      if (on('[data-mk-step]')) { step(p); return; }
      if (on('[data-mk-setup]')) { window.RailShell.go('settings/plugins'); return; }
      if ((hit = on('[data-confirm]'))) { const yes = hit.dataset.confirm === 'yes', was = form?.k; form = null; if (yes && was === 'install') { p.installed = true; say(`Installed ${p.id}${p.asks.length ? ': set it up in Settings' : ''}`); } if (yes && was === 'remove') { p.installed = false; delete p.update; say(`Removed ${p.id}`); } draw(); return; }
      if ((hit = on('[data-menu-pick]'))) { const [, v] = hit.dataset.menuPick.split('|'); menu = ''; if (v === 'remove') form = { k: 'remove', id: p.id }; else say(`${p.id}: ${data.markets[0].url} at ${data.markets[0].sha}`); draw(); return; }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
    });
    R.dismissOnOutside(document, { open: () => !!menu, inside: '#route-place .rc-pop', back: () => null, close: () => { menu = ''; }, paint: draw });
  }
  window.RailPlaces = window.RailPlaces || {};
  window.RailPlaces.marketplace = { sample: 'slack-chat', show: ({ bar: b, page: pg, arg }) => { if (b !== bar) wire(b, pg); if (current !== arg) menu = ''; if (form && form.id !== arg) form = null; current = arg || ''; draw(); } };
})();
