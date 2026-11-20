// test/marketplace-installed.test.mjs — the Installed tab controller against a fake page (CONTRACT §3.5) and fake deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createInstalledTab } from '../ui/public/marketplace/installed.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };
const ZERO = { taskSources: 0, chatChannels: 0, mcpServers: 0, models: 0, agents: 0, scripts: 0, skills: 0, workflows: 0 };
const row = (name, extra = {}) => ({ name, version: '0.1.0', pinnedSha: 'a'.repeat(40), marketplace: 'worca-cc', marketplaceName: 'Worca CC Official',
  enabled: true, linked: false, broken: false, apiMismatch: null, pythonMissing: false, ignored: [], mcpSets: [], skillSets: [],
  contributions: { ...ZERO }, latest: null, setup: { ok: true, missing: [], noProfiles: [] }, notes: [], ...extra });
const L = (version, access = []) => ({ version, sha: 'b'.repeat(40), marketplace: 'worca-cc', access });
const SECRET = { kind: 'secret', id: 'github.webhookSecret', red: true };
const CANVAS = [
  row('atlassian-mcp', { contributions: { ...ZERO, mcpServers: 1 }, mcpSets: ['Havn'], latest: L('0.1.1') }),
  row('example-models', { version: '0.4.0', contributions: { ...ZERO, models: 2 }, marketplace: 'example', marketplaceName: 'example/worca-marketplace' }),
  row('github-source', { version: '0.2.0', contributions: { ...ZERO, taskSources: 1 }, latest: L('0.3.0', [SECRET]) }),
  row('slack-chat', { contributions: { ...ZERO, chatChannels: 1 }, setup: { ok: false, missing: [{ kind: 'chatChannel', id: 'slack', keys: ['botToken'] }], noProfiles: [] } }),
];
const ok = (data) => ({ ok: true, status: 200, data });
const no = (status, data) => ({ ok: false, status, data });
const dialogShown = (doc) => !!doc.querySelector('#mk-dialog-host.viewer-modal:not(.hidden)');

function world({ plugins = CANVAS, orphans = [], policy = null, catalog = [], channelStatus = [], api = {} } = {}) {
  const { window } = new JSDOM('<!doctype html><body><a class="tab mk-tab" data-tab="installed" href="#marketplace/installed">Installed</a><div id="head"></div><div id="host"></div></body>', { url: 'http://localhost/' });
  const doc = window.document;
  const log = { calls: [], toasts: [], menus: [], acts: [], loads: [] };
  const provided = {};
  const tabs = {};
  const page = {
    state: { tab: 'installed', plugins, orphans, policy, catalog, channelStatus, marketplaces: [], filters: {} },
    registerTab: (key, spec) => { tabs[key] = spec; },
    provide: (action, fn) => { provided[action] = fn; },
    act: (action, ...args) => { log.acts.push([action, ...args]); return provided[action] ? provided[action](...args) : undefined; },
    load: async (o = {}) => { log.loads.push(o); },
    setTab: (tab) => log.acts.push(['setTab', tab]),
  };
  const deps = {
    api: async (method, url, body) => {
      log.calls.push([method, url, body]);
      const h = api[`${method} ${url}`];
      return (typeof h === 'function' ? h(body) : h) || no(404, { error: `no route ${method} ${url}` });
    },
    notify: (t) => log.toasts.push(t),
    openMenu: (o) => { log.menus.push(o); return { el: null, close() {} }; },
    navigate: (hash) => log.acts.push(['navigate', hash]),
    confirmModal: async () => true,
    gitOn: () => true,
    invalidateAgentCaches: () => log.acts.push(['invalidateAgentCaches']),
    openSetupChecklist: () => log.acts.push(['openSetupChecklist']),
  };
  createInstalledTab({ doc, win: window, page, deps });
  tabs.installed.render(page.state, doc.getElementById('host'), page);
  tabs.installed.header(page.state, doc.getElementById('head'), page);
  const click = (sel) => { const n = doc.querySelector(sel); assert.ok(n, `no ${sel}`); n.click(); return n; };
  return { window, doc, page, tabs, provided, log, click };
}

test('registers Installed: label, count, the updates chip, the header (refresh + Update all · n)', () => {
  const { tabs, page, doc, log, click } = world();
  assert.equal(tabs.installed.label, 'Installed');
  assert.equal(tabs.installed.count(page.state), 4);
  assert.deepEqual([tabs.installed.chip(page.state).textContent, tabs.installed.chip(page.state).classList.contains('mk-upd-chip')], ['2 updates', true]);
  assert.equal(tabs.installed.chip({ plugins: [CANVAS[0]] }).textContent, '1 update');
  assert.equal(tabs.installed.chip({ plugins: [CANVAS[1]] }), null);
  assert.deepEqual([...doc.getElementById('head').children].map((b) => b.getAttribute('aria-label') || b.textContent), ['Refresh marketplaces', 'Update all · 2']);
  click('#head .mk-refresh');
  const all = click('#head .mk-update-all');
  assert.deepEqual(log.loads, [{ refresh: true }]);
  assert.deepEqual(log.acts, [['openUpdateReview', undefined, { opener: all }]]);
  assert.deepEqual([...doc.getElementById('head').children].map((b) => b.dataset.focusKey), ['refresh', 'update-all'], 'focus survives a header repaint (P3)');
  tabs.installed.header({ ...page.state, refreshing: true }, doc.getElementById('head'), page);
  const busy = doc.querySelector('#head .mk-refresh');
  busy.click();
  assert.deepEqual([busy.getAttribute('aria-disabled'), busy.getAttribute('aria-busy'), busy.disabled, log.loads.length], ['true', 'true', false, 1],
    'while a refresh runs: aria-disabled + aria-busy, not disabled (P3\u2019s header pattern), and a click does nothing');
});

test('row actions: name → manage, Review → review sheet, Set up → manage Settings, Check health → the provided action', () => {
  const { log, click, provided } = world({ plugins: [...CANVAS, row('old', { broken: true })] });
  const n = click('section.mk-all button.mk-name[data-name="atlassian-mcp"]');
  const r = click('section.mk-attention li[data-name="github-source"] [data-act="review"]');
  const s = click('section.mk-attention li[data-name="slack-chat"] [data-act="setup"]');
  click('section.mk-attention li[data-name="old"] [data-act="health"]');
  assert.deepEqual(log.acts, [['openManage', 'atlassian-mcp', { opener: n }], ['openUpdateReview', ['github-source'], { opener: r }],
    ['openManage', 'slack-chat', { section: 'settings', opener: s }], ['checkHealth', 'old']]);
  assert.deepEqual(Object.keys(provided).sort(), ['openRemove', 'updateOne']);
});

test('Nothing installed yet: "Browse {n} plugins" switches tabs through page.setTab (SM63); a modified click stays the browser’s', () => {
  const { window, doc, log, click } = world({ plugins: [], catalog: [{ name: 'a', iconKind: 'none' }, { name: 'b', iconKind: 'none' }] });
  assert.equal(click('.mk-empty a.mk-browse-all').textContent, 'Browse 2 plugins');
  assert.deepEqual(log.acts, [['setTab', 'browse']]);
  const a = doc.querySelector('.mk-empty a.mk-browse-all');
  const fire = (o) => a.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...o }));
  assert.equal(fire({}), false, 'a plain primary click is handled here (prevented)');
  assert.deepEqual(log.acts, [['setTab', 'browse'], ['setTab', 'browse']]);
  for (const o of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    assert.equal(fire(o), true, `${JSON.stringify(o)}: not prevented — ⌘/Ctrl-click keeps "open in a new tab"`);
  }
  assert.equal(log.acts.length, 2, 'a modified click switches nothing');
});

test('the switch acts at once; a refusal puts it back and says why', async () => {
  let answer = ok({ ok: true, enabled: false });
  const busy = [];   // the switch's disabled state while its POST is out
  // A browser's focus fixup drops focus from a control that turns disabled (jsdom keeps it): the fake drops it.
  const drop = () => { sw.disabled = false; sw.blur(); sw.disabled = true; };
  const { doc, window, log } = world({ api: { 'POST /api/plugins/github-source/enable': () => { busy.push(sw.disabled); drop(); return answer; } } });
  const sw = doc.querySelector('input.mk-enable[data-name="github-source"]');
  sw.focus();
  sw.checked = false;
  sw.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(log.calls.at(-1), ['POST', '/api/plugins/github-source/enable', { enabled: false }]);
  assert.deepEqual([busy, sw.disabled], [[true], false], 'disabled while its POST is out, enabled after');
  assert.equal(doc.activeElement, sw, 'focus comes back to the switch');
  assert.deepEqual(log.loads, [{}]);
  assert.ok(log.acts.some((a) => a[0] === 'invalidateAgentCaches'));
  answer = no(409, { error: 'plugin is locked by the team policy' });
  sw.checked = false;
  sw.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  assert.equal(sw.checked, true, 'reverted');
  assert.deepEqual([busy, sw.disabled], [[true, true], false]);
  assert.deepEqual(log.toasts.at(-1), { tone: 'err', title: 'plugin is locked by the team policy' });
});

test('⋯ menu: Open in Connectors only with MCP servers, no Check for update on a linked plugin, Remove… last (danger)', () => {
  const { log, click } = world({ plugins: [...CANVAS, row('local-dev', { linked: true, pinnedSha: null, version: 'dev', marketplace: null, marketplaceName: null })] });
  const a = click('button.mk-more[data-name="atlassian-mcp"]');
  click('button.mk-more[data-name="example-models"]');
  click('button.mk-more[data-name="local-dev"]');
  const shape = (m) => m.items.map((i) => (i.sep ? '—' : `${i.label}${i.danger ? ' (danger)' : ''}`));
  assert.deepEqual(shape(log.menus[0]), ['Open in Connectors', 'Check health', 'Check for update', '—', 'Remove… (danger)']);
  assert.deepEqual(shape(log.menus[1]), ['Check health', 'Check for update', '—', 'Remove… (danger)']);
  assert.deepEqual(shape(log.menus[2]), ['Check health', '—', 'Remove… (danger)']);
  assert.deepEqual([log.menus[0].anchor, log.menus[0].align, log.menus[0].label], [a, 'end', 'atlassian-mcp actions']);
  assert.deepEqual(log.menus[0].items.map((i) => i.icon || null), ['plug', 'pulse', 'refresh', null, 'trash']);
  log.menus[0].items[0].onSelect();
  log.menus[0].items[1].onSelect();
  assert.deepEqual(log.acts.slice(-2), [['navigate', '#connectors/servers'], ['checkHealth', 'atlassian-mcp']]);
});

test('Update with no new access: preview, then a confirm bound to the previewed candidateSha', async () => {
  const pre = { pinnedSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), pinnedVersion: '0.1.0', candidateVersion: '0.1.1', access: [],
    commits: [{ sha: 'b'.repeat(40), subject: 'fix: retry' }], diffstat: ' 1 file changed, 2 insertions(+)', manifestDelta: {} };
  const { log, click } = world({ api: { 'POST /api/plugins/atlassian-mcp/update': (body) => (body.confirm ? ok({ ok: true, updated: true }) : ok({ preview: pre })) } });
  click('section.mk-attention li[data-name="atlassian-mcp"] [data-act="update"]');
  await settle();
  assert.deepEqual(log.calls.map((c) => c[2]), [{}, { confirm: true, candidateSha: 'b'.repeat(40) }]);
  assert.deepEqual(log.toasts, [{ tone: 'ok', title: 'Updated atlassian-mcp.' }]);
  assert.deepEqual(log.loads, [{}]);
});

test('Update hands over to the review sheet when the preview asks for access, needs git, or went stale; other refusals are toasts', async () => {
  const pre = (access) => ok({ preview: { pinnedSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), access,
    commits: [{ sha: 'b'.repeat(40), subject: 'fix: retry' }], diffstat: ' 1 file changed, 2 insertions(+)' } });
  for (const [answer, confirm] of [
    [pre([{ kind: 'setup', id: null, red: false }]), null],
    [no(409, { error: 'git is not installed on this machine', code: 'GIT_MISSING' }), null],
    [pre([]), no(409, { error: 'the candidate moved', code: 'STALE_PREVIEW', candidateSha: 'c'.repeat(40) })],
  ]) {
    const { log, provided } = world({ api: { 'POST /api/plugins/atlassian-mcp/update': (b) => (b.confirm ? confirm : answer) } });
    await provided.updateOne('atlassian-mcp');
    assert.deepEqual(log.acts.at(-1), ['openUpdateReview', ['atlassian-mcp'], { opener: null }]);
    assert.deepEqual([log.toasts, log.calls.length], [[], confirm ? 2 : 1], 'only the stale case reaches the confirm');
  }
  const same = world({ api: { 'POST /api/plugins/atlassian-mcp/update': () => ok({ preview: { pinnedSha: 'a'.repeat(40), candidateSha: 'a'.repeat(40), access: [] } }) } });
  await same.provided.updateOne('atlassian-mcp');
  assert.deepEqual(same.log.toasts, [{ tone: 'ok', title: 'atlassian-mcp is up to date.' }]);
  const busy = world({ api: { 'POST /api/plugins/atlassian-mcp/update': () => no(409, { error: 'an update is already running' }) } });
  await busy.provided.updateOne('atlassian-mcp');
  assert.deepEqual(busy.log.toasts, [{ tone: 'err', title: 'an update is already running' }]);
  assert.deepEqual(busy.log.acts, []);
});

test('a diff without commits (a rollback, or a history the preview could not list) is never applied at once: the review sheet decides', async () => {
  const back = ok({ preview: { pinnedSha: 'a'.repeat(40), candidateSha: 'c'.repeat(40), pinnedVersion: '1.1.0', candidateVersion: '1.0.0',
    commits: [], diffstat: ' 1 file changed, 1 insertion(+), 1 deletion(-)', access: [] } });
  const { log, provided } = world({ api: { 'POST /api/plugins/atlassian-mcp/update': (b) => (b.confirm ? ok({ ok: true, updated: true }) : back) } });
  await provided.updateOne('atlassian-mcp');
  assert.deepEqual([log.calls.map((c) => c[2]), log.acts, log.toasts, log.loads], [[{}], [['openUpdateReview', ['atlassian-mcp'], { opener: null }]], [], []], 'no confirm POST');
});

test('Check for update: up to date is a toast; anything newer (or needing git) opens the review sheet', async () => {
  let answer = ok({ preview: { pinnedSha: 'a'.repeat(40), candidateSha: 'a'.repeat(40), access: [] } });
  const { log, click } = world({ api: { 'POST /api/plugins/example-models/update': () => answer } });
  click('button.mk-more[data-name="example-models"]');
  const check = () => log.menus[0].items.find((i) => i.label === 'Check for update').onSelect();
  await check();
  assert.deepEqual(log.toasts, [{ tone: 'ok', title: 'example-models is up to date.' }]);
  answer = ok({ preview: { pinnedSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), access: [] } });
  await check();
  assert.deepEqual(log.acts.at(-1), ['openUpdateReview', ['example-models']]);
  answer = no(409, { error: 'git is not installed on this machine', code: 'GIT_MISSING' });
  await check();
  assert.equal(log.acts.filter((a) => a[0] === 'openUpdateReview').length, 2);
  answer = no(500, { error: 'fetch failed' });
  await check();
  assert.deepEqual(log.toasts.at(-1), { tone: 'err', title: 'fetch failed' });
});

test('a monorepo marketplace moved its tip, not the plugin folder: no commits and no diffstat is up to date (Update, Check for update)', async () => {
  const mono = (extra = {}) => ok({ preview: { pinnedSha: 'a'.repeat(40), candidateSha: 'c'.repeat(40), commits: [], diffstat: '', access: [], ...extra } });
  const one = world({ api: { 'POST /api/plugins/atlassian-mcp/update': (b) => (b.confirm ? ok({ ok: true, updated: true }) : mono()) } });
  await one.provided.updateOne('atlassian-mcp');
  assert.deepEqual(one.log.calls.map((c) => c[2]), [{}], 'no confirm POST');
  assert.deepEqual([one.log.toasts, one.log.acts, one.log.loads], [[{ tone: 'ok', title: 'atlassian-mcp is up to date.' }], [], []]);
  let answer = mono();
  const two = world({ api: { 'POST /api/plugins/example-models/update': () => answer } });
  two.click('button.mk-more[data-name="example-models"]');
  const check = () => two.log.menus[0].items.find((i) => i.label === 'Check for update').onSelect();
  await check();
  assert.deepEqual([two.log.toasts, two.log.acts], [[{ tone: 'ok', title: 'example-models is up to date.' }], []]);
  answer = mono({ commits: [{ sha: 'c'.repeat(40), subject: 'feat: x' }] });
  await check();
  answer = mono({ diffstat: ' 1 file changed, 1 insertion(+)' });
  await check();
  assert.deepEqual([two.log.toasts.length, two.log.acts], [1, [['openUpdateReview', ['example-models']], ['openUpdateReview', ['example-models']]]],
    'a commit or a diffstat in the plugin folder is an update');
});

const DETAIL = (inventory) => ok({ plugin: {}, inventory, repo: null, subdir: '', sha: 'a'.repeat(40), installedAt: null, updatedAt: null, webUrl: null });
const sel = (id, count) => ({ kind: 'model-selection', contributionKind: 'models', contribution: id, label: id, count, href: '#models' });

test('Remove: Goes away and Changes from the installed detail; the box maps to ?purge=1; success closes, toasts, reloads, calls onRemoved', async () => {
  const removed = [];
  const { doc, log, provided } = world({ api: {
    'GET /api/plugins/atlassian-mcp': DETAIL({ mcpServers: [{ name: 'atlassian', type: 'http', url: 'https://mcp.atlassian.com/v1/sse' }] }),
    'GET /api/plugins/atlassian-mcp/references': ok({ references: [] }),
    'DELETE /api/plugins/atlassian-mcp?purge=1': ok({ ok: true, purged: true }),
  } });
  await provided.openRemove('atlassian-mcp', { onRemoved: () => removed.push(1) });
  const dlg = doc.getElementById('mk-dialog');
  assert.equal(dialogShown(doc), true);
  assert.deepEqual([dlg.dataset.kind, dlg.getAttribute('aria-labelledby')], ['remove', 'mk-dialog-title']);
  assert.equal(doc.getElementById('mk-dialog-title').textContent, 'Remove atlassian-mcp?');
  assert.deepEqual([...dlg.querySelectorAll('.mk-goes > li')].map((li) => [li.querySelector('.mk-goes-k').textContent, li.querySelector('.mk-id').textContent]), [['MCP server', 'atlassian']]);
  assert.deepEqual([...dlg.querySelectorAll('.mk-changes > li')].map((li) => [li.querySelector('.badge').textContent, li.querySelector('.mk-meta').textContent]),
    [['Havn', 'loses the atlassian server with its values and secrets']]);
  dlg.querySelector('.mk-purge-box').checked = true;
  dlg.querySelector('[data-dlg="remove"]').click();
  await settle();
  assert.deepEqual(log.calls.at(-1), ['DELETE', '/api/plugins/atlassian-mcp?purge=1', undefined]);
  assert.deepEqual(log.toasts, [{ tone: 'ok', title: 'Removed atlassian-mcp.' }]);
  assert.deepEqual([log.loads, removed, dialogShown(doc)], [[{}], [1], false]);
  assert.ok(log.acts.some((a) => a[0] === 'invalidateAgentCaches'), 'a removed plugin’s agents leave the caches');
  assert.equal(doc.activeElement, doc.querySelector('.mk-tab[data-tab="installed"]'), 'focus lands on the tab, never on <body>');
});

test('Remove when something still uses it: the Blocked view — Used by rows, Open closes on its way, Remove disabled', async () => {
  const { doc, provided, log } = world({ api: {
    'GET /api/plugins/example-models': DETAIL({ models: [{ id: 'example-stable' }, { id: 'example-stable-fast' }] }),
    'GET /api/plugins/example-models/references': ok({ references: [sel('example-stable', 2), sel('example-stable-fast', 1)] }),
  } });
  await provided.openRemove('example-models');
  const dlg = doc.getElementById('mk-dialog');
  assert.equal(dlg.dataset.kind, 'blocked');
  assert.equal(doc.getElementById('mk-dialog-title').textContent, 'example-models is still in use');
  assert.deepEqual([...dlg.querySelectorAll('.mk-used > li')].map((li) => [li.querySelector('.mk-row-title').textContent, li.querySelector('.mk-meta').textContent, li.querySelector('a.mk-open').getAttribute('href')]),
    [['example-stable', 'Model · 2 pipeline selections', '#models'], ['example-stable-fast', 'Model · 1 pipeline selection', '#models']]);
  assert.equal(dlg.querySelector('.mk-used-note').textContent, 'Clear those selections first.');
  assert.equal(dlg.querySelector('[data-dlg="remove"]').disabled, true);
  dlg.querySelector('a.mk-open').click();
  assert.equal(dialogShown(doc), false, 'Open leaves for the Models page and closes the dialog');
  assert.equal(log.calls.filter((c) => c[0] === 'DELETE').length, 0);
});

test('a 409 at remove time lands inside the dialog: the Blocked view when the guard names something, else its first line', async () => {
  let refs = [];
  const api = {
    'GET /api/plugins/github-source': DETAIL({ taskSources: [{ id: 'github' }] }),
    'GET /api/plugins/github-source/references': () => ok({ references: refs }),
    'DELETE /api/plugins/github-source': no(409, { error: 'used by saved workflow(s): Docs Flow\nremove it there first', references: [{ workflowId: 'wf_docs', name: 'Docs Flow', keys: ['triager'] }] }),
  };
  const one = world({ api });
  await one.provided.openRemove('github-source');
  refs = [{ kind: 'workflow', contributionKind: 'agents', contribution: 'triager', label: 'Docs Flow', count: 1, href: '#workflows' }];
  one.doc.querySelector('#mk-dialog [data-dlg="remove"]').click();
  await settle();
  assert.equal(one.doc.getElementById('mk-dialog').dataset.kind, 'blocked');
  assert.deepEqual([...one.doc.querySelectorAll('#mk-dialog .mk-used > li')].map((li) => [li.querySelector('.mk-row-title').textContent, li.querySelector('.mk-meta').textContent]), [['triager', 'Agent · in Docs Flow']]);
  assert.equal(one.doc.querySelector('#mk-dialog .mk-used-note').textContent, 'Clear those first.');
  assert.deepEqual(one.log.toasts, []);
  refs = [];
  const two = world({ api });
  await two.provided.openRemove('github-source');
  two.doc.querySelector('#mk-dialog [data-dlg="remove"]').click();
  await settle();
  const err = two.doc.querySelector('#mk-dialog .mk-dlg-err');
  assert.deepEqual([err.hidden, err.textContent], [false, 'used by saved workflow(s): Docs Flow']);
  assert.equal(two.doc.getElementById('mk-dialog').dataset.kind, 'remove');
  assert.equal(two.doc.querySelector('#mk-dialog [data-dlg="remove"]').disabled, false, 'idle again for another try');
  assert.deepEqual([two.log.toasts, dialogShown(two.doc)], [[], true]);
});

test('⋯ Remove… opens the dialog from the row menu; Cancel and Close close it; focus goes back to the row’s ⋯', async () => {
  const { doc, log, click } = world({ api: {
    'GET /api/plugins/slack-chat': DETAIL({ chatChannels: [{ id: 'slack' }] }),
    'GET /api/plugins/slack-chat/references': ok({ references: [] }),
  } });
  const more = click('button.mk-more[data-name="slack-chat"]');
  await log.menus[0].items.at(-1).onSelect();
  assert.equal(doc.getElementById('mk-dialog-title').textContent, 'Remove slack-chat?');
  doc.querySelector('#mk-dialog [data-dlg="cancel"]').click();
  assert.equal(dialogShown(doc), false);
  assert.equal(doc.activeElement, more, 'the opener the menu passed through openRemove');
  await log.menus[0].items.at(-1).onSelect();
  doc.querySelector('#mk-dialog [data-dlg="close"]').click();
  assert.equal(dialogShown(doc), false);
});

test('Leftover data: Purge opens its own danger dialog; the delete runs only from it; a failure stays inside', async () => {
  let answer = no(409, { error: 'plugin is installed' });
  const { doc, log, click, page, tabs } = world({ orphans: [{ name: 'telegram-chat', dataDir: '/h/.worca-cc/plugins/telegram-chat/data' }],
    catalog: [{ name: 'telegram-chat', iconKind: 'chatChannels' }], api: { 'DELETE /api/plugins/telegram-chat/data': () => answer } });
  // As the page does: the reload re-renders the tab, and the purged leftover (the dialog's opener) is gone.
  page.load = async (o = {}) => { log.loads.push(o); page.state = { ...page.state, orphans: [] }; tabs.installed.render(page.state, doc.getElementById('host'), page); };
  click('section.mk-leftover [data-act="purge"][data-name="telegram-chat"]');
  await settle();
  const dlg = doc.getElementById('mk-dialog');
  assert.deepEqual([dlg.dataset.kind, doc.getElementById('mk-dialog-title').textContent, log.calls.length], ['purge', 'Purge telegram-chat?', 0]);
  dlg.querySelector('[data-dlg="purge"]').click();
  await settle();
  assert.deepEqual([dlg.querySelector('.mk-dlg-err').hidden, dlg.querySelector('.mk-dlg-err').textContent, log.toasts], [false, 'plugin is installed', []]);
  answer = ok({ ok: true, name: 'telegram-chat' });
  dlg.querySelector('[data-dlg="purge"]').click();
  await settle();
  assert.deepEqual(log.calls.at(-1), ['DELETE', '/api/plugins/telegram-chat/data', undefined]);
  assert.deepEqual([log.toasts, log.loads, dialogShown(doc)], [[{ tone: 'ok', title: 'Purged leftover data for telegram-chat.' }], [{}], false]);
  assert.equal(doc.querySelector('section.mk-leftover'), null, 'the reload took the row away');
  assert.equal(doc.activeElement, doc.querySelector('.mk-tab[data-tab="installed"]'), 'focus lands on the tab, never on <body>');
});

test('a later Remove or Purge wins: a slower earlier Remove never replaces its dialog', async () => {
  let release;
  const { doc, log, provided, click } = world({ orphans: [{ name: 'telegram-chat', dataDir: '/x' }], catalog: [], api: {
    'GET /api/plugins/slack-chat': () => new Promise((r) => { release = r; }),
    'GET /api/plugins/slack-chat/references': ok({ references: [] }),
    'GET /api/plugins/example-models': DETAIL({ models: [{ id: 'm' }] }),
    'GET /api/plugins/example-models/references': ok({ references: [] }),
    'DELETE /api/plugins/example-models': ok({ ok: true }),
  } });
  const a = provided.openRemove('slack-chat');
  await provided.openRemove('example-models');
  release(DETAIL({ chatChannels: [{ id: 'slack' }] }));
  await a;
  assert.equal(doc.getElementById('mk-dialog-title').textContent, 'Remove example-models?');
  doc.querySelector('#mk-dialog [data-dlg="remove"]').click();
  await settle();
  assert.deepEqual(log.calls.filter((c) => c[0] === 'DELETE').map((c) => c[1]), ['/api/plugins/example-models']);
  const b = provided.openRemove('slack-chat');
  click('section.mk-leftover [data-act="purge"][data-name="telegram-chat"]');
  release(DETAIL({ chatChannels: [{ id: 'slack' }] }));
  await b;
  assert.equal(doc.getElementById('mk-dialog').dataset.kind, 'purge', 'a Purge asked for later wins too');
});

test('a 409 holds the dialog until the re-read lands; the Blocked view keeps focus inside; a dialog that took over keeps its own view', async () => {
  let reads = 0;
  let release;
  const used = { references: [{ kind: 'workflow', contributionKind: 'agents', contribution: 'triager', label: 'Docs Flow', count: 1, href: '#workflows' }] };
  const { doc, window, log, provided } = world({ api: {
    'GET /api/plugins/github-source': DETAIL({ taskSources: [{ id: 'github' }] }),
    'GET /api/plugins/github-source/references': () => (reads++ === 0 ? ok({ references: [] }) : new Promise((r) => { release = r; })),
    'DELETE /api/plugins/github-source': no(409, { error: 'used by saved workflow(s): Docs Flow', references: [] }),
    'GET /api/plugins/slack-chat': DETAIL({ chatChannels: [{ id: 'slack' }] }),
    'GET /api/plugins/slack-chat/references': ok({ references: [] }),
    'DELETE /api/plugins/slack-chat': ok({ ok: true }),
  } });
  await provided.openRemove('github-source');
  const go = doc.querySelector('#mk-dialog [data-dlg="remove"]');
  go.focus();
  go.click();
  await settle();
  const p = doc.getElementById('mk-dialog');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  p.querySelector('[data-dlg="close"] .ic').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));   // a disabled Close’s glyph
  assert.deepEqual([dialogShown(doc), p.getAttribute('aria-busy'), p.querySelector('[data-dlg="cancel"]').disabled], [true, 'true', true],
    'held while the references are re-read');
  release(ok(used));
  await settle();
  assert.equal(p.dataset.kind, 'blocked');
  assert.equal(doc.activeElement, p.querySelector('.mk-dlg-close'), 'the focused Remove left with the old foot: focus stays inside');
  // Another dialog takes over while a 409 is re-read: the late answer never paints into it.
  const again = world({ api: {
    'GET /api/plugins/github-source': DETAIL({ taskSources: [{ id: 'github' }] }),
    'GET /api/plugins/github-source/references': () => (again.reads++ === 0 ? ok({ references: [] }) : new Promise((r) => { release = r; })),
    'DELETE /api/plugins/github-source': no(409, { error: 'used by saved workflow(s): Docs Flow', references: [] }),
    'GET /api/plugins/slack-chat': DETAIL({ chatChannels: [{ id: 'slack' }] }),
    'GET /api/plugins/slack-chat/references': ok({ references: [] }),
    'DELETE /api/plugins/slack-chat': ok({ ok: true }),
  } });
  again.reads = 0;
  await again.provided.openRemove('github-source');
  again.doc.querySelector('#mk-dialog [data-dlg="remove"]').click();
  await settle();
  await again.provided.openRemove('slack-chat');
  release(ok(used));
  await settle();
  assert.deepEqual([again.doc.getElementById('mk-dialog').dataset.kind, again.doc.getElementById('mk-dialog-title').textContent], ['remove', 'Remove slack-chat?']);
  again.doc.querySelector('#mk-dialog [data-dlg="remove"]').click();
  await settle();
  assert.deepEqual(again.log.calls.filter((c) => c[0] === 'DELETE').map((c) => c[1]), ['/api/plugins/github-source', '/api/plugins/slack-chat']);
  assert.deepEqual(log.toasts, []);
});

test('every URL encodes the plugin name; an unknown name opens nothing; Purge holds while its DELETE is out and shows the old glyph', async () => {
  const odd = world({ plugins: [row('odd name#1')] });
  await odd.provided.openRemove('odd name#1');
  odd.doc.querySelector('#mk-dialog [data-dlg="remove"]').click();
  await settle();
  await odd.provided.updateOne('odd name#1');
  assert.ok(odd.log.calls.length >= 4);
  for (const [, u] of odd.log.calls) assert.ok(u.startsWith('/api/plugins/odd%20name%231'), u);
  const ghost = world();
  await ghost.provided.openRemove('ghost');
  assert.deepEqual([ghost.log.calls, dialogShown(ghost.doc)], [[], false], 'not an installed row: no request, no dialog');
  const seen = [];
  const { doc, click } = world({ orphans: [{ name: 'telegram-chat', dataDir: '/x' }], catalog: [{ name: 'telegram-chat', iconKind: 'chatChannels' }], api: {
    'DELETE /api/plugins/telegram-chat/data': () => {
      const p = doc.getElementById('mk-dialog');
      seen.push([p.getAttribute('aria-busy'), p.querySelector('[data-dlg="close"]').disabled, p.querySelector('[data-dlg="cancel"]').disabled]);
      return ok({ ok: true, name: 'telegram-chat' });
    },
  } });
  click('section.mk-leftover [data-act="purge"][data-name="telegram-chat"]');
  const glyph = (sel) => doc.querySelector(`${sel} .mk-mt svg`).innerHTML;
  assert.equal(glyph('#mk-dialog .mk-dialog-head'), glyph('section.mk-leftover'), 'the leftover row’s glyph');
  doc.querySelector('#mk-dialog [data-dlg="purge"]').click();
  await settle();
  assert.deepEqual(seen, [['true', true, true]]);
});

test('focus never falls to <body> when the opener’s row left while the dialog was open (removed elsewhere)', async () => {
  const { doc, log, click, page, tabs } = world({ api: {
    'GET /api/plugins/slack-chat': DETAIL({ chatChannels: [{ id: 'slack' }] }),
    'GET /api/plugins/slack-chat/references': ok({ references: [] }),
  } });
  click('button.mk-more[data-name="slack-chat"]');
  await log.menus[0].items.at(-1).onSelect();
  page.state = { ...page.state, plugins: CANVAS.filter((p) => p.name !== 'slack-chat') };
  tabs.installed.render(page.state, doc.getElementById('host'), page);
  doc.querySelector('#mk-dialog [data-dlg="cancel"]').click();
  assert.equal(doc.activeElement, doc.querySelector('.mk-tab[data-tab="installed"]'));
});

test('while the delete is out the dialog holds: aria-busy, Close and Cancel disabled; a 500 frees them and stays inside', async () => {
  const seen = [];
  const { doc, log, provided } = world({ api: {
    'GET /api/plugins/slack-chat': DETAIL({ chatChannels: [{ id: 'slack' }] }),
    'GET /api/plugins/slack-chat/references': ok({ references: [] }),
    'DELETE /api/plugins/slack-chat': () => {
      const p = doc.getElementById('mk-dialog');
      seen.push([p.getAttribute('aria-busy'), p.querySelector('[data-dlg="close"]').disabled, p.querySelector('[data-dlg="cancel"]').disabled]);
      return no(500, { error: 'disk full' });
    },
  } });
  await provided.openRemove('slack-chat');
  doc.querySelector('#mk-dialog [data-dlg="remove"]').click();
  await settle();
  const dlg = doc.getElementById('mk-dialog');
  assert.deepEqual(seen, [['true', true, true]], 'Cancel must not close the dialog mid-request');
  assert.deepEqual([dlg.hasAttribute('aria-busy'), dlg.querySelector('[data-dlg="close"]').disabled, dlg.querySelector('[data-dlg="cancel"]').disabled],
    [false, false, false]);
  assert.equal(dlg.querySelector('.mk-dlg-err').textContent, 'disk full');
  assert.deepEqual([dialogShown(doc), log.toasts], [true, []]);
});

test('Team policy card: Install opens the plugin sheet on the snapshot the policy names; Turn on, Update, Set up (with seeds), Set up…', async () => {
  const policy = { requirements: [
    { name: 'azure-boards-source', marketplace: 'Worca CC Official', minVersion: '0.1.0', state: 'missing', homes: ['acme/gw'] },
    { name: 'ghost', marketplace: 'gone', minVersion: null, state: 'missing', homes: ['acme/gw'] },
    { name: 'teams-chat', minVersion: null, state: 'disabled', homes: ['acme/gw'] },
    { name: 'jira', minVersion: '2.0.0', state: 'outdated', homes: ['acme/gw'] },
    { name: 'slack-chat', minVersion: null, state: 'ok', homes: ['acme/gw'], config: { notifyChatIds: 'C07Q2M4KD1' } },
  ], blockedPlugins: [] };
  const item = { key: 'worca-cc/azure-boards-source', name: 'azure-boards-source', iconKind: 'taskSources',
    marketplace: { id: 'worca-cc', name: 'Worca CC Official', stale: false, snapshotAt: null },
    source: { repoUrl: 'https://github.com/SinishaDjukic/worca-cc', subdir: 'plugins/azure-boards-source', sha: 'c'.repeat(40), webUrl: null } };
  const { log, click } = world({ policy, catalog: [item], api: {
    'POST /api/plugins/teams-chat/enable': ok({ ok: true, enabled: true }),
    'POST /api/plugins/jira/update': ok({ preview: { pinnedSha: 'a'.repeat(40), candidateSha: 'a'.repeat(40), access: [] } }),
  } });
  click('section.mk-policy [data-act="policy-install"][data-name="azure-boards-source"]');
  assert.deepEqual(log.acts.at(-1), ['openPlugin', { name: 'azure-boards-source', marketplace: 'Worca CC Official' }], 'P4 resolves the snapshot the policy names');
  click('section.mk-policy [data-act="policy-install"][data-name="ghost"]');
  assert.deepEqual(log.acts.at(-1), ['openPlugin', { name: 'ghost', marketplace: 'gone' }], 'P4 says itself when no synced marketplace lists it');
  click('section.mk-policy [data-act="policy-on"][data-name="teams-chat"]');
  await settle();
  assert.deepEqual([log.calls.at(-1), log.loads], [['POST', '/api/plugins/teams-chat/enable', { enabled: true }], [{}]]);
  click('section.mk-policy [data-act="policy-update"][data-name="jira"]');
  await settle();
  assert.deepEqual([log.calls.at(-1), log.toasts.at(-1)], [['POST', '/api/plugins/jira/update', {}], { tone: 'ok', title: 'jira is up to date.' }]);
  const ps = click('section.mk-policy [data-act="policy-setup"][data-name="slack-chat"]');
  assert.deepEqual(log.acts.at(-1), ['openManage', 'slack-chat', { section: 'settings', seeds: { notifyChatIds: 'C07Q2M4KD1' }, opener: ps }]);
  click('section.mk-policy button.mk-policy-setup');
  assert.deepEqual(log.acts.at(-1), ['openSetupChecklist']);
});

test('Team policy card: Turn on sends one request per click while it is out', async () => {
  let release;
  const policy = { requirements: [{ name: 'teams-chat', minVersion: null, state: 'disabled', homes: ['acme/gw'] }], blockedPlugins: [] };
  const { doc, log } = world({ policy, api: { 'POST /api/plugins/teams-chat/enable': () => new Promise((r) => { release = r; }) } });
  const on = doc.querySelector('section.mk-policy [data-act="policy-on"][data-name="teams-chat"]');
  on.click();
  on.click();
  await settle();
  release(ok({ ok: true, enabled: true }));
  await settle();
  assert.deepEqual([log.calls.filter((c) => c[1] === '/api/plugins/teams-chat/enable').length, log.loads], [1, [{}]]);
});

test('a preview that lands after a sheet or dialog opened meanwhile hands nothing over (Check for update; Update: access, git, STALE)', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const pre = (access) => ok({ preview: { pinnedSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40), access,
    commits: [{ sha: 'b'.repeat(40), subject: 'fix: retry' }], diffstat: ' 1 file changed, 2 insertions(+)' } });
  const { doc, log, click, provided } = world({ api: {
    'POST /api/plugins/github-source/update': () => held.then(() => pre([SECRET])),
    'POST /api/plugins/atlassian-mcp/update': (b) => (b.confirm ? held.then(() => no(409, { error: 'moved', code: 'STALE_PREVIEW', candidateSha: 'c'.repeat(40) })) : pre([])),
    'POST /api/plugins/slack-chat/update': () => held.then(() => no(409, { error: 'git is not installed on this machine', code: 'GIT_MISSING' })),
  } });
  click('button.mk-more[data-name="github-source"]');
  const checking = log.menus[0].items.find((i) => i.label === 'Check for update').onSelect();
  const updating = provided.updateOne('github-source');
  const stale = provided.updateOne('atlassian-mcp');
  const noGit = provided.updateOne('slack-chat');
  await settle();
  const sheet = doc.createElement('div');
  sheet.className = 'viewer-modal mk-sheet-host';      // the person opened a sheet meanwhile (a git fetch can take seconds)
  doc.body.append(sheet);
  release();
  await Promise.all([checking, updating, stale, noGit]);
  assert.deepEqual(log.acts.filter((a) => a[0] === 'openUpdateReview'), [], 'nothing takes over the sheet on screen');
  sheet.classList.add('hidden');
  await provided.updateOne('github-source');
  await provided.updateOne('atlassian-mcp');
  await provided.updateOne('slack-chat');
  assert.deepEqual(log.acts.filter((a) => a[0] === 'openUpdateReview').map((a) => a[1][0]), ['github-source', 'atlassian-mcp', 'slack-chat'], 'with nothing open, each hands over');
});
