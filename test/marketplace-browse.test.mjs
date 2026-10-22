// test/marketplace-browse.test.mjs — the Browse tab: rail, grouped tiles, header, empty states (marketplace P3, boards 1.1, 4.2).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { OFF, BD, ROWS, pageHarness } from './helpers/marketplace-fixtures.mjs';
import { browseTab, browseAction, renderTile, renderNoMarketplaces } from '../ui/public/marketplace/browse.mjs';
import { buildCatalog, shortDate } from '../ui/public/marketplace/catalog.mjs';

const trackDom = useDomRelease(afterEach);
const tick = () => new Promise((r) => setTimeout(r, 0));
const mkts = (list) => ({ 'GET /api/marketplaces': () => ({ ok: true, status: 200, data: { marketplaces: list } }) });
async function browse(routes = {}) {
  const h = pageHarness({ trackDom, routes });
  h.page.registerTab('browse', browseTab({ doc: h.doc }));
  h.page.provide('browse', browseAction(h.page, h.deps));
  await h.page.load();
  const panel = h.doc.querySelector('.mk-panel[data-tab="browse"]');
  const tiles = () => [...panel.querySelectorAll('button.mk-tile')].map((t) => t.dataset.key);
  const type = (el, v) => { el.value = v; el.dispatchEvent(new h.window.Event('input', { bubbles: true })); };
  return { ...h, panel, tiles, type };
}

test('a tile is a button: kind tile, name, version · marketplace, description, chips, one of Install / Installed / Update x', () => {
  const { doc } = pageHarness({ trackDom });
  const rows = [...ROWS, { name: 'slack-chat', version: '0.1.0', marketplace: 'off', enabled: true, latest: null, contributions: { chatChannels: 1 } }];
  const [gh, slack, rn, bmf] = buildCatalog([OFF, BD], rows).map((i) => renderTile(doc, i));
  assert.deepEqual([gh.tagName, gh.type, gh.className, gh.dataset.key], ['BUTTON', 'button', 'mk-tile', 'off/github-source']);
  assert.equal(gh.querySelector('.mk-tile-top > .mk-mt').className, 'mk-mt mk-mt-md mk-t-src');
  assert.deepEqual([gh.querySelector('.mk-tile-name').textContent, gh.querySelector('.mk-tile-meta').textContent, gh.querySelector('.mk-tile-desc').textContent],
    ['github-source', '0.2.0·Worca CC Official', 'Pull tasks from GitHub Issues, write results back']);
  assert.deepEqual([gh.querySelector('.mk-tile-meta > span.mk-ver').textContent, gh.querySelector('.mk-tile-meta .mono, .mk-tile-meta .mk-mono')],
    ['0.2.0', null], 'SM30 / SM57: the version in span.mk-ver, sans');
  assert.deepEqual([gh.querySelector('.mk-ver').className, bmf.querySelector('.mk-ver').className], ['mk-ver', 'mk-ver mk-sha'],
    'SM30: a sha standing in for a missing version is mono');
  const foot = (t) => [...t.querySelector('.mk-tile-foot').children].map((c) => [c.className, c.textContent]);
  assert.deepEqual(foot(gh), [['badge mk-chip mk-chip-n', 'Task source'], ['badge mk-chip mk-chip-n', 'Token'], ['badge mk-chip mk-chip-upd mk-tile-status', 'Update 0.3.0']]);
  assert.ok(gh.querySelector('.mk-tile-foot > .badge:nth-child(2) svg'), 'the key glyph on the secrets chip');
  assert.deepEqual(foot(slack).at(-1), ['badge mk-chip mk-chip-ok mk-tile-status', 'Installed']);
  assert.deepEqual(foot(rn), [['badge mk-chip mk-chip-n', '2 agents · 1 skill · 1 workflow'], ['btn btn-sm mk-tile-status', 'Install']]);
  assert.deepEqual([bmf.querySelector('.mk-tile-meta').textContent, foot(bmf)], ['16b6363·BD-AI-SDLC/worca-marketplace', [['badge mk-chip mk-chip-n', '5 models'], ['btn btn-sm mk-tile-status', 'Install']]]);
  const [unsynced] = buildCatalog([{ id: 'n', name: 'n', plugins: [{ name: 'cc' }] }], []).map((i) => renderTile(doc, i));
  assert.equal(unsynced.querySelector('.mk-tile-status'), null, 'no snapshot sha: nothing to install yet');
  const [linked] = buildCatalog([OFF], [{ ...ROWS[0], linked: true }]).map((i) => renderTile(doc, i));
  assert.deepEqual([linked.querySelector('.mk-tile-meta .mk-chip')?.textContent, linked.querySelector('.mk-tile-mkt')], ['linked', null], 'a linked plugin reads "linked" instead of its marketplace');
});

test('the rail: search, Adds (All + kinds that have plugins, with dots), From (stale snapshot chip), Hide installed', async () => {
  const { panel } = await browse();
  const search = panel.querySelector('.mk-rail[role="group"][aria-label="Filters"] input#mk-search');
  assert.deepEqual([search.type, search.placeholder, search.getAttribute('aria-label'), search.className], ['search', 'Search plugins', 'Search plugins', 'input']);
  assert.deepEqual([...panel.querySelectorAll('.mk-rail-label')].map((l) => l.textContent), ['Adds', 'From']);
  const row = (b) => [b.dataset.adds ?? b.dataset.from, b.querySelector('.mk-facet-dot')?.className ?? null, b.querySelector('.mk-facet-label').textContent,
    b.querySelector('.mk-facet-n').textContent, b.getAttribute('aria-pressed')];
  assert.deepEqual([...panel.querySelectorAll('button.mk-facet[data-adds]')].map(row), [
    ['all', null, 'All plugins', '4', 'true'], ['taskSources', 'mk-facet-dot mk-dot-src', 'Task sources', '1', 'false'],
    ['chatChannels', 'mk-facet-dot mk-dot-chat', 'Chat channels', '1', 'false'], ['models', 'mk-facet-dot mk-dot-model', 'Models', '1', 'false'],
    ['agents', 'mk-facet-dot mk-dot-agent', 'Agents', '1', 'false'], ['skills', 'mk-facet-dot mk-dot-skill', 'Skills', '1', 'false'],
    ['workflows', 'mk-facet-dot mk-dot-wf', 'Workflows', '1', 'false']]);
  const from = [...panel.querySelectorAll('button.mk-facet[data-from]')];
  assert.deepEqual(from.map(row), [['off', null, 'Worca CC Official', '3', 'false'], ['bd', null, 'BD-AI-SDLC/worca-marketplace', '1', 'false']]);
  assert.deepEqual([...from[1].querySelectorAll('.mk-facet-name > *')].map((n) => [n.className, n.textContent]),
    [['mk-facet-label', 'BD-AI-SDLC/worca-marketplace'], ['badge mk-chip mk-chip-warn', `Snapshot from ${shortDate(BD.lastSync.at)}`]]);
  assert.equal(from[0].querySelector('.mk-chip-warn'), null);
  const hide = panel.querySelector('label.mk-hide');
  assert.deepEqual([hide.querySelector('input').id, hide.querySelector('input').type, hide.textContent], ['mk-hide-installed', 'checkbox', 'Hide installed']);
});

test('groups: one section per kind, then Mixed; title, count, tiles in marketplace order', async () => {
  const { panel } = await browse();
  assert.deepEqual([...panel.querySelectorAll('section.mk-group')].map((s) => [s.dataset.group, s.querySelector('h2.section-title').textContent,
    s.querySelector('.mk-count').textContent, [...s.querySelectorAll('.mk-tile')].map((t) => t.dataset.key)]), [
    ['taskSources', 'Task sources', '1', ['off/github-source']], ['chatChannels', 'Chat channels', '1', ['off/slack-chat']],
    ['models', 'Models', '1', ['bd/bmf-models']], ['mix', 'Mixed', '1', ['off/release-notes']]]);
  const s = panel.querySelector('section.mk-group[data-group="models"]');
  assert.equal(s.getAttribute('aria-labelledby'), s.querySelector('h2').id);
});

test('search, Adds, From and Hide installed narrow the grid; the search field keeps focus through a data repaint', async () => {
  const { doc, page, panel, tiles, type } = await browse();
  const search = panel.querySelector('#mk-search');
  search.focus(); type(search, 'SLACK');
  assert.deepEqual(tiles(), ['off/slack-chat']);
  page.render();
  assert.deepEqual([panel.querySelector('#mk-search') === search, doc.activeElement === search, search.value, panel.querySelector('.mk-search-clear').hidden],
    [true, true, 'SLACK', false]);
  const x = panel.querySelector('.mk-search-clear'); x.focus(); x.click();
  assert.deepEqual([search.value, tiles().length, doc.activeElement === search, panel.querySelector('.mk-search-clear').hidden], ['', 4, true, true]);
  panel.querySelector('button.mk-facet[data-adds="models"]').focus();
  panel.querySelector('button.mk-facet[data-adds="models"]').click();
  assert.equal(doc.activeElement, panel.querySelector('button.mk-facet[data-adds="models"]'), 'focus stays on the pressed facet');
  assert.deepEqual([tiles(), panel.querySelector('button.mk-facet[data-adds="models"]').getAttribute('aria-pressed'),
    panel.querySelector('button.mk-facet[data-adds="all"]').getAttribute('aria-pressed')], [['bd/bmf-models'], 'true', 'false']);
  panel.querySelector('button.mk-facet[data-adds="models"]').click();
  assert.deepEqual(tiles(), ['bd/bmf-models'], 'Adds is single-select: a second click keeps it');
  panel.querySelector('button.mk-facet[data-adds="all"]').click();
  panel.querySelector('button.mk-facet[data-from="off"]').click();
  assert.deepEqual(tiles(), ['off/github-source', 'off/slack-chat', 'off/release-notes']);
  panel.querySelector('button.mk-facet[data-from="off"]').click();
  assert.equal(tiles().length, 4, 'From toggles off');
  const hide = panel.querySelector('#mk-hide-installed'); hide.focus(); hide.checked = true;
  hide.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  assert.deepEqual(tiles(), ['off/slack-chat', 'bd/bmf-models', 'off/release-notes']);
  assert.equal(doc.activeElement, panel.querySelector('#mk-hide-installed'), 'Hide installed keeps focus');
});

test('no results: “No plugins match”, the corpus line, Clear search; facets alone → Clear filters', async () => {
  const { panel, tiles, type } = await browse();
  type(panel.querySelector('#mk-search'), 'gitlab');
  const empty = panel.querySelector('.mk-groups > .mk-empty');
  assert.deepEqual([empty.querySelector('.mk-mt').className, empty.querySelector('h3.mk-empty-title').textContent, empty.querySelector('.mk-meta').textContent],
    ['mk-mt mk-mt-lg mk-t-n', 'No plugins match “gitlab”', '4 plugins in 2 marketplaces']);
  empty.querySelector('button.btn.mk-clear-search').click();
  assert.equal(tiles().length, 4);
  panel.querySelector('button.mk-facet[data-from="bd"]').click();
  panel.querySelector('button.mk-facet[data-adds="taskSources"]').click();
  const e2 = panel.querySelector('.mk-groups > .mk-empty');
  assert.deepEqual([e2.querySelector('h3'), e2.querySelector('button').className, e2.querySelector('button').textContent], [null, 'btn mk-clear-filters', 'Clear filters']);
  e2.querySelector('button').click();
  assert.deepEqual([tiles().length, panel.querySelector('button.mk-facet[data-adds="all"]').getAttribute('aria-pressed')], [4, 'true']);
});

test('no marketplaces: the bag tile, “No marketplaces yet” and an inline add whose errors stay in the form', async () => {
  const asked = [];
  const { window, doc, page, panel } = await browse(mkts([]));
  assert.equal(doc.querySelector('.mk-head-actions').childElementCount, 0, 'board 4.2: no header actions beside the inline add');
  page.provide('openAddMarketplace', async (o) => { asked.push(o); return asked.length <= 2
    ? { ok: false, status: 409, data: { error: 'git is not installed on this machine', code: 'GIT_MISSING' } }
    : { ok: false, status: 400, data: { error: 'not a marketplace repo' } }; });
  const empty = panel.querySelector('.mk-empty.mk-empty-mkts');
  assert.deepEqual([empty.querySelector('.mk-mt').className, empty.querySelector('h3.mk-empty-title').textContent, panel.querySelector('.mk-rail')],
    ['mk-mt mk-mt-lg mk-t-mkt', 'No marketplaces yet', null]);
  const form = empty.querySelector('form.mk-empty-add'); const field = form.querySelector('input'); const add = form.querySelector('button[type="submit"]');
  assert.deepEqual([field.placeholder, field.getAttribute('aria-label'), add.className, add.textContent],
    ['owner/repo, GitHub URL or folder', 'Marketplace repo, URL or folder', 'btn btn-primary btn-sm', 'Add']);
  const submit = async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick(); };
  await submit();
  assert.deepEqual([asked, form.querySelector('.field-error').textContent], [[], 'Enter a marketplace repo (https://github.com/owner/repo, owner/repo, or a local path).']);
  field.value = 'https://gitlab.com/a/m'; await submit(); await submit();
  assert.deepEqual([asked[0].url, asked[0].opener === add, Object.keys(asked[0]), form.querySelectorAll('.pl-needs-git').length], ['https://gitlab.com/a/m', true, ['url', 'opener'], 1], 'one Needs git chip after two refusals (U2a)');
  field.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(form.querySelector('.pl-needs-git'), null, 'typing removes it');
  await submit();
  assert.deepEqual([asked.length, form.querySelector('.field-error').textContent], [3, 'not a marketplace repo']);
});

test('renderNoMarketplaces is the same block on its own (SM20, P7\'s Marketplaces tab); an undefined answer leaves the form as it is', async () => {
  const { doc, window } = pageHarness({ trackDom });
  const got = [];
  const block = renderNoMarketplaces(doc, { onAdd: (url, opener) => { got.push([url, opener.textContent]); } });
  doc.body.append(block);
  block.querySelector('input').value = ' acme/m ';
  block.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick();
  assert.deepEqual([block.className, got, block.querySelector('.field-error, .pl-needs-git')], ['mk-empty mk-empty-mkts', [['acme/m', 'Add']], null]);
});

test('header: “can’t be reached” chip → Marketplaces tab, Refresh marketplaces (busy while it runs), Add marketplace', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { doc, page, calls } = await browse({ 'POST /api/marketplaces/refresh': async () => { await gate; return { ok: true, status: 200, data: { ok: true, marketplaces: [OFF, BD] } }; } });
  const head = doc.querySelector('.mk-head-actions');
  const chip = head.querySelector('a.mk-health');
  assert.deepEqual([chip.className, chip.getAttribute('href'), chip.textContent, !!chip.querySelector('svg')],
    ['badge mk-chip mk-chip-warn mk-health', '#marketplace/marketplaces', "1 marketplace can't be reached", true]);
  const add = head.querySelector('button.mk-add-mkt');
  assert.deepEqual([add.className, add.textContent, !!add.querySelector('svg')], ['btn mk-add-mkt', 'Add marketplace', true]);
  const acts = []; page.provide('openAddMarketplace', (o) => acts.push(o)); add.click();
  assert.deepEqual([acts.length, Object.keys(acts[0]), acts[0].opener === add], [1, ['opener'], true], 'SM16: the opener rides along for focus return');
  const refresh = head.querySelector('button.mk-refresh');
  assert.deepEqual([refresh.className, refresh.getAttribute('aria-label')], ['btn btn-quiet btn-icon mk-refresh', 'Refresh marketplaces']);
  refresh.focus(); refresh.click(); await tick(); await tick();
  const busy = doc.querySelector('.mk-head-actions .mk-refresh');
  assert.deepEqual([busy.getAttribute('aria-disabled'), busy.getAttribute('aria-busy'), calls.filter((c) => c === 'POST /api/marketplaces/refresh').length], ['true', 'true', 1]);
  assert.equal(doc.activeElement, doc.querySelector('.mk-head-actions .mk-refresh'), 'focus stays on Refresh through the busy repaint');
  busy.click(); await tick();
  assert.equal(calls.filter((c) => c === 'GET /api/plugins').length, 2, 'a click while busy is ignored');
  release(); await tick(); await tick();
  const back = doc.querySelector('.mk-head-actions .mk-refresh');
  assert.deepEqual([back.getAttribute('aria-disabled'), doc.activeElement === back], [null, true]);
});

test('header: healthy marketplaces read “Synced 3m ago”; two unreachable read in the plural', async () => {
  const at = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const ok = await browse(mkts([{ ...OFF, lastSync: { ...OFF.lastSync, at } }]));
  assert.equal(ok.doc.querySelector('.mk-head-actions .mk-synced').textContent, 'Synced 3m ago');
  const two = await browse(mkts([BD, { ...BD, id: 'bd2' }]));
  assert.deepEqual([two.doc.querySelector('.mk-head-actions .mk-health').textContent, two.doc.querySelector('.mk-head-actions .mk-synced')],
    ["2 marketplaces can't be reached", null], 'Synced only when nothing is unreachable');
  two.doc.querySelector('.mk-head-actions .mk-health').click();
  assert.deepEqual([two.page.state.tab, two.navs.at(-1)], ['marketplaces', '#marketplace/marketplaces']);
});

test('a tile opens its plugin (openPlugin gets the catalog item); browse({ adds }) filters, selects Browse and routes', async () => {
  const { panel, page, navs, tiles, type } = await browse();
  const got = []; page.provide('openPlugin', (item) => got.push(item));
  panel.querySelector('button.mk-tile[data-key="off/slack-chat"] .mk-tile-status').click();
  assert.deepEqual([got.length, got[0] === page.state.catalog[1]], [1, true]);
  type(panel.querySelector('#mk-search'), 'zzz'); panel.querySelector('#mk-hide-installed').click();
  page.setTab('installed');
  page.act('browse', { adds: 'chatChannels' });
  assert.deepEqual([panel.querySelector('#mk-search').value, panel.querySelector('#mk-hide-installed').checked], ['', false], 'browse() resets search and Hide installed');
  assert.deepEqual([page.state.tab, page.state.filters, navs.at(-1), tiles()], ['browse', { q: '', adds: 'chatChannels', from: null, hideInstalled: false }, '#marketplace', ['off/slack-chat']]);
});

test('From lists every marketplace (an empty one counts 0); an unreachable one never synced has no snapshot chip', async () => {
  const { panel } = await browse(mkts([OFF, { id: 'e', name: 'Empty', url: 'https://github.com/a/e', lastSync: null, lastError: { code: 'UNREACHABLE', message: 'HTTP 404' }, plugins: [] }]));
  assert.deepEqual([...panel.querySelectorAll('button.mk-facet[data-from]')].map((b) => [b.dataset.from, b.querySelector('.mk-facet-n').textContent, !!b.querySelector('.mk-chip-warn')]),
    [['off', '3', false], ['e', '0', false]]);
});

test('marketplaces without plugins: the bag tile and the corpus line only; Clear filters also clears Hide installed', async () => {
  const none = await browse(mkts([{ ...OFF, plugins: [] }]));
  const e = none.panel.querySelector('.mk-groups > .mk-empty');
  assert.deepEqual([e.querySelector('.mk-mt').className, e.querySelector('.mk-meta').textContent, e.querySelector('h3, button')],
    ['mk-mt mk-mt-lg mk-t-n', '0 plugins in 1 marketplace', null]);
  const { panel, tiles } = await browse();
  panel.querySelector('#mk-hide-installed').click();
  panel.querySelector('button.mk-facet[data-adds="taskSources"]').click();
  panel.querySelector('.mk-groups .mk-clear-filters').click();
  assert.deepEqual([tiles().length, panel.querySelector('#mk-hide-installed').checked], [4, false]);
});

test('a failed refresh, or one answered under an open layer, never leaves Refresh busy', async () => {
  const bad = await browse({ 'POST /api/marketplaces/refresh': () => ({ ok: false, status: 500, data: { error: 'boom' } }) });
  bad.doc.querySelector('.mk-head-actions .mk-refresh').click(); await tick(); await tick();
  assert.equal(bad.doc.querySelector('.mk-head-actions .mk-refresh').getAttribute('aria-disabled'), null, 'after a failed refresh');
  const { doc } = await browse();
  const modal = doc.createElement('div'); modal.className = 'viewer-modal'; doc.body.append(modal);
  doc.querySelector('.mk-head-actions .mk-refresh').click(); await tick(); await tick();
  assert.equal(doc.querySelector('.mk-head-actions .mk-refresh').getAttribute('aria-disabled'), null, 'the panels wait for the layer; the button does not');
});

test('no marketplaces: a background render keeps the add form, its text and focus; while an add is out, Add is busy and a second submit posts nothing', async () => {
  const { window, doc, page, panel } = await browse(mkts([]));
  let release; const asked = [];
  page.provide('openAddMarketplace', (o) => { asked.push(o.url); return new Promise((r) => { release = () => r({ ok: false, status: 400, data: { error: 'not a marketplace repo' } }); }); });
  const input = panel.querySelector('.mk-empty-add input'); const add = panel.querySelector('.mk-empty-add button[type="submit"]');
  input.focus(); input.value = 'owner/re';
  await page.load({ background: true });
  assert.deepEqual([panel.querySelector('.mk-empty-add input') === input, input.value, doc.activeElement === input], [true, 'owner/re', true]);
  const submit = () => input.form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  submit(); submit();
  assert.deepEqual([asked, add.getAttribute('aria-busy'), add.getAttribute('aria-disabled'), add.disabled], [['owner/re'], 'true', 'true', false]);
  release(); await tick(); await tick();
  assert.deepEqual([add.getAttribute('aria-busy'), add.getAttribute('aria-disabled'), input.form.querySelector('.field-error').textContent],
    [null, null, 'not a marketplace repo']);
});

test('style.css: tile footers line up, a long version ellipsises, Refresh turns while busy, a long marketplace name wraps in the rail', () => {
  const CSS = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  for (const re of [/\.mk-tile-foot\{[^}]*min-height:28px;/, /\.mk-tile-meta > \.mk-ver\{flex:none;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\}/,
    /\.mk-refresh\[aria-busy="true"\] svg\{animation:ws-spin \.9s linear infinite;\}/, /\.mk-facet-label\{min-width:0;overflow-wrap:anywhere;\}/,
    /\.mk-empty-add > \.btn\{margin-top:2px;\}/]) assert.match(CSS, re);
});

test('the first read failed: the Browse header keeps Refresh marketplaces (the retry) and Add marketplace', async () => {
  const { doc, page } = await browse({ 'GET /api/plugins': () => ({ ok: false, status: 500, data: { error: 'db locked' } }) });
  page.setTab('browse');
  assert.deepEqual([...doc.querySelectorAll('.mk-head-actions > button')].map((b) => b.className), ['btn btn-quiet btn-icon mk-refresh', 'btn mk-add-mkt']);
});
test('From shows pressed; browse({ from }) filters by marketplace', async () => {
  const { page, panel, tiles } = await browse();
  panel.querySelector('button.mk-facet[data-from="off"]').click();
  assert.equal(panel.querySelector('button.mk-facet[data-from="off"]').getAttribute('aria-pressed'), 'true');
  page.act('browse', { from: 'bd' });
  assert.deepEqual([page.state.filters.from, tiles()], ['bd', ['bd/bmf-models']]);
});
test('the Browse count is the whole catalogue; a focused tile and Add marketplace keep focus through a render (M5)', async () => {
  const { doc, page, panel, type } = await browse();
  type(panel.querySelector('#mk-search'), 'slack'); page.render();
  assert.equal(doc.querySelector('.mk-tab[data-tab="browse"] .mk-count').textContent, '4');
  type(panel.querySelector('#mk-search'), '');
  panel.querySelector('button.mk-tile[data-key="off/slack-chat"]').focus(); page.render();
  assert.equal(doc.activeElement.dataset.key, 'off/slack-chat');
  doc.querySelector('.mk-head-actions .mk-add-mkt').focus(); page.render();
  assert.equal(doc.activeElement, doc.querySelector('.mk-head-actions .mk-add-mkt'));
});
test('no version → no dot; a real version is never set as a sha (SM30)', () => {
  const { doc } = pageHarness({ trackDom });
  const bare = renderTile(doc, buildCatalog([{ id: 'n', name: 'n', plugins: [{ name: 'cc' }] }], [])[0]);
  assert.deepEqual([bare.querySelector('.mk-ver'), bare.querySelector('.mk-tile-meta').textContent], [null, 'n']);
  assert.equal(renderTile(doc, buildCatalog([OFF], [])[2]).querySelector('.mk-ver').className, 'mk-ver');
  assert.equal(renderTile(doc, buildCatalog([BD], [{ name: 'bmf-models', version: '1.0.0', marketplace: 'bd' }])[0]).querySelector('.mk-ver').className, 'mk-ver');
});
test('Clear filters focuses the search; the no-results title quotes the trimmed query', async () => {
  const { doc, panel, type } = await browse();
  type(panel.querySelector('#mk-search'), '  gitlab ');
  assert.equal(panel.querySelector('.mk-empty-title').textContent, 'No plugins match “gitlab”');
  panel.querySelector('.mk-clear-search').click();
  panel.querySelector('button.mk-facet[data-from="bd"]').click();
  panel.querySelector('button.mk-facet[data-adds="taskSources"]').click();
  const b = panel.querySelector('.mk-clear-filters'); b.focus(); b.click();
  assert.equal(doc.activeElement, panel.querySelector('#mk-search'));
});
test('the inline add: a resubmit replaces the old error; an ok answer shows none', async () => {
  const { doc, window } = pageHarness({ trackDom });
  const answers = [{ ok: false, status: 400, data: { error: 'bad' } }, { ok: false, status: 409, data: { error: 'no git', code: 'GIT_MISSING' } }, { ok: true, status: 200, data: {} }];
  const block = renderNoMarketplaces(doc, { onAdd: async () => answers.shift() }); doc.body.append(block);
  const form = block.querySelector('form'); block.querySelector('input').value = 'acme/m';
  const submit = async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick(); };
  await submit(); await submit();
  assert.deepEqual([form.querySelector('.field-error'), form.querySelectorAll('.pl-needs-git').length], [null, 1]);
  await submit();
  assert.equal(form.querySelector('.field-error, .pl-needs-git'), null);
});
