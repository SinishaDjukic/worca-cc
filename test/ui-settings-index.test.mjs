// test/ui-settings-index.test.mjs — the Settings / Add-ons catalogue behind the top bar search:
// every entry names a real tab/card in index.html with the same mode and Labs gate, and locks read the live state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { TABS, CARDS, UNLISTED_CARDS, SETTING_ENTRIES, ADDON_ENTRIES, ADDON_PAGES, addonEntriesFrom, locksFor, lockNote } from '../ui/public/settings-index.mjs';
import { tabFromParam } from '../ui/public/marketplace/page.mjs';
import { parseMcpParam } from '../ui/public/mcp-view.mjs';
import { parseModelsParam, PROVIDER_ROWS } from '../ui/public/models/page-tabs.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

const doc = new JSDOM(readIndexHtml()).window.document;
const FORM_TABS = ['general', 'tags', 'runs', 'ask'];   // app.js SETTINGS_FORM_TABS: only these scroll to a card

test('every catalogued tab exists with the same mode, flag and name as its button; no tab is missing', () => {
  for (const t of TABS) {
    const b = doc.querySelector(`#settings-tabs button[data-tab="${t.id}"]`);
    assert.ok(b, `tab ${t.id}`);
    assert.equal(b.dataset.minLevel, t.min, `${t.id} min level`);
    assert.equal(b.dataset.flag || '', t.flag, `${t.id} flag`);
    assert.equal(b.textContent.trim(), t.title, `${t.id} title`);
  }
  const buttons = [...doc.querySelectorAll('#settings-tabs button[data-tab]')].map((b) => b.dataset.tab);
  assert.deepEqual(TABS.map((t) => t.id).sort(), buttons.sort(), 'no tab missing from the catalogue');
});

const { CHAT_SOURCE_BRANCH_SETTING } = await import('../src/shared/chat-source-branch.mjs');
const PAINTED_HEADINGS = { 'chat-runs-settings-card': CHAT_SOURCE_BRANCH_SETTING };

test('every catalogued card sits on its form tab with the same mode, flag and heading; every form-tab card is listed', () => {
  for (const c of CARDS) {
    const card = doc.getElementById(c.id);
    assert.ok(card, `card ${c.id}`);
    assert.equal(card.closest('.settings-pane').dataset.tab, c.tab, `${c.id} pane`);
    assert.equal(card.dataset.minLevel, c.min, `${c.id} min level`);
    assert.equal(card.dataset.flag || '', c.flag, `${c.id} flag`);
    // The card's h2; the root folder card has none, its first field's label names it. A heading app.js paints from a
    // shared module is empty in the HTML: the catalogue's title is that module's constant (Chat runs: source branch).
    const heading = (card.querySelector('h2') || card.querySelector('.label-row label')).textContent.trim();
    if (PAINTED_HEADINGS[c.id]) assert.equal(heading === '' ? PAINTED_HEADINGS[c.id] : heading, c.title, `${c.id} heading`);
    else assert.equal(heading, c.title, `${c.id} heading`);
    assert.ok(FORM_TABS.includes(c.tab), `${c.id}: only form tabs scroll to a card`);
  }
  const onForms = [...doc.querySelectorAll('.settings-pane .settings-card')]
    .filter((n) => FORM_TABS.includes(n.closest('.settings-pane').dataset.tab)).map((n) => n.id);
  assert.deepEqual(onForms.filter((id) => !UNLISTED_CARDS.includes(id)).sort(), CARDS.map((c) => c.id).sort(),
    'a new Settings card is catalogued (with its alternative words) or named in UNLISTED_CARDS');
});

test('locks: a mode lock below the effective mode, a flag lock per Labs feature that is off; the note names both', () => {
  const presets = SETTING_ENTRIES.find((e) => e.id === 'tab:presets');
  assert.deepEqual(locksFor(presets, { level: 'simple', flags: {} }).map((l) => l.type), ['mode']);
  assert.deepEqual(locksFor(presets, { level: 'advanced', flags: {} }), []);
  const budget = SETTING_ENTRIES.find((e) => e.id === 'card:budget-settings-card');
  assert.deepEqual(locksFor(budget, { level: 'simple', flags: {} }), []);
  const chat = SETTING_ENTRIES.find((e) => e.id === 'card:ask-settings-card');   // a Simple card on an Advanced tab
  assert.equal(locksFor(chat, { level: 'simple', flags: {} })[0].min, 'advanced');
  assert.equal(lockNote(locksFor(presets, { level: 'simple', flags: {} })), 'Switch to Advanced mode');
  assert.deepEqual(locksFor(presets, {}), [], 'no level given = Expert, nothing mode-locked');
  const labels = SETTING_ENTRIES.find((e) => e.id === 'card:labels-settings-card');
  assert.deepEqual(locksFor(labels, { level: 'simple', flags: {} }).map((l) => l.key), ['runLabels']);
  assert.deepEqual(locksFor(labels, { level: 'simple', flags: { runLabels: true } }), []);
  assert.equal(lockNote(locksFor(labels, { level: 'simple', flags: {} })), 'Turn on Labs: Run labels');
  assert.equal(lockNote([{ type: 'mode', min: 'advanced' }, { type: 'flag', key: 'runLabels', title: 'Run labels' }]),
    'Switch to Advanced mode · Turn on Labs: Run labels');
  const debug = SETTING_ENTRIES.find((e) => e.id === 'card:debug-spawn-settings-card');
  assert.equal(lockNote(locksFor(debug, { level: 'advanced', flags: {} })), 'Switch to Expert mode');
});

test('Add-ons rows: an entry on a static card has that card on its page with the same mode; a Jobs block row locks by that block\'s level; every other entry is page-level and never locks', () => {
  // The Jobs tab's blocks are built at runtime (jobs-view.mjs, pinned by test/models-jobs-view.test.mjs): the role
  // tiles are Simple, the job cards Advanced.
  const JOBS_BLOCK_LEVELS = { roles: 'simple', steps: 'advanced', helpers: 'advanced' };
  for (const e of ADDON_ENTRIES) {
    assert.ok(Object.hasOwn(ADDON_PAGES, e.page), `${e.id} page`);
    assert.equal(e.tabTitle, ADDON_PAGES[e.page], `${e.id} names its page`);
    const block = /^#models\/jobs\/([^/]+)$/.exec(e.href)?.[1];
    if (e.card) {
      const card = doc.getElementById(e.card);
      assert.ok(card, `${e.id}: card ${e.card}`);
      assert.equal(card.closest('section.view').dataset.view, e.page, `${e.id}: the card sits on its page`);
      assert.equal(card.dataset.minLevel, e.min, `${e.id}: the row locks by its card's own mode`);
    } else if (block) {
      assert.ok(Object.hasOwn(JOBS_BLOCK_LEVELS, block), `${e.id}: a Jobs block`);
      assert.equal(e.min, JOBS_BLOCK_LEVELS[block], `${e.id}: the row locks by its Jobs block's level`);
    } else {
      assert.equal(e.min, 'simple', `${e.id}: a page-level row never locks (A-9)`);
    }
    assert.deepEqual(e.flags, []);
  }
  assert.equal(new Set(ADDON_ENTRIES.map((e) => e.id)).size, ADDON_ENTRIES.length, 'ids are unique');
});

test('the provider rows sit on the Models page\'s Providers tab: ids keep addon:providers/<key>, the meta names the tab', () => {
  assert.equal(Object.hasOwn(ADDON_PAGES, 'providers'), false, 'Providers is a tab of the Models page, not an Add-ons page');
  const rows = ADDON_ENTRIES.filter((e) => e.id.startsWith('addon:providers/'));
  assert.deepEqual(rows.map((e) => e.id), ['copilot', 'openai', 'openrouter', 'anthropic', 'speech', 'images', 'sound'].map((k) => `addon:providers/${k}`));
  for (const e of rows) {
    assert.equal(e.page, 'models', `${e.id} is on the Models page`);
    assert.match(e.href, /^#models\/providers\/(copilot|openrouter|openai|anthropic|speech|images|sound)$/, `${e.id}: one Providers row`);
    assert.equal(e.meta, 'Models · Providers', `${e.id}: the row names the tab, not only the page`);
    assert.equal(e.alts.at(-1), 'providers', `${e.id}: the query "providers" finds it`);
  }
  assert.ok(!ADDON_ENTRIES.some((e) => e.href.startsWith('#providers')), 'no row routes through the old page');
});

test('Add-ons hrefs reach their place: a Marketplace tab, a Connectors view, a Models tab (a Jobs block, a Providers row)', () => {
  assert.ok(doc.getElementById('jobs-root')?.closest('#models-tab-jobs'), 'the Jobs tab draws its blocks into #jobs-root');
  for (const e of ADDON_ENTRIES) {
    const [view, ...rest] = e.href.replace(/^#/, '').split('/');
    const param = rest.join('/');
    assert.equal(view, e.page, `${e.id} routes to its page`);
    if (view === 'marketplace') assert.equal(tabFromParam(param), e.id.split('/')[1], `${e.id}: the tab it names`);
    if (view === 'connectors') assert.equal(parseMcpParam(param).view, { sets: 'sets', servers: 'servers', skills: 'skills' }[e.id.split('/')[1]], e.id);
    if (view === 'models') {
      const { tab, rest: where } = parseModelsParam(param);
      if (tab === 'providers') assert.ok(PROVIDER_ROWS.includes(where), `${e.id}: #models/providers/<a provider row>`);
      if (tab === 'jobs') assert.ok(where === '' || ['roles', 'steps', 'helpers', 'design'].includes(where), `${e.id}: #models/jobs/<a Jobs block>`);
      if (tab === 'catalogue') assert.ok(where === '' || /^model\/[^/]+$/.test(where), `${e.id}: #models or #models/model/<id>`);
    }
  }
  const href = (id) => ADDON_ENTRIES.find((e) => e.id === id).href;
  assert.equal(href('addon:providers/openrouter'), '#models/providers/openrouter', 'OpenRouter has a row of its own');
  assert.equal(href('addon:models/helper-jobs'), '#models/jobs/helpers', 'helper-job models live in the Jobs tab\'s Helper jobs card');
  assert.equal(href('addon:models/engines'), '#models/jobs/steps', 'step models live in the Steps card');
  assert.equal(href('addon:models/roles'), '#models/jobs/roles');
});

test('locks: Step models and Helper job models need Advanced (the job cards\' level); Roles, the providers and the tabs never lock', () => {
  const e = (id) => ADDON_ENTRIES.find((x) => x.id === id);
  assert.equal(e('addon:models/engines').title, 'Step models', 'the old Engines row is named for what it finds');
  for (const id of ['addon:models/engines', 'addon:models/helper-jobs']) {
    assert.equal(lockNote(locksFor(e(id), { level: 'simple', flags: {} })), 'Switch to Advanced mode', id);
    assert.deepEqual(locksFor(e(id), { level: 'advanced', flags: {} }), [], id);
  }
  for (const id of ['addon:models/roles', 'addon:providers/openai', 'addon:marketplace/installed', 'addon:connectors/servers']) {
    assert.deepEqual(locksFor(e(id), { level: 'simple', flags: {} }), [], id);
  }
});

test('addonEntriesFrom: a settings row per installed plugin that has settings, a row per MCP server, own / plugin / team-policy models only', () => {
  const rows = addonEntriesFrom({
    plugins: [{ name: 'jira', hasSettings: true }, { name: 'atlassian-mcp', hasSettings: false }, { name: '' }, null],
    connectors: [{ id: 'manual:linear', name: 'linear', description: 'Linear issues' }, { id: '', name: 'x' }, { id: 'manual:noname' }],
    models: [{ id: 'my-gpt', label: 'My GPT', source: 'global' }, { id: 'acme/fast', label: 'Acme fast', source: 'plugin', plugin: 'acme' },
      { id: 'team-sonnet', label: 'Team Sonnet', source: 'policy' }, { id: 'opus', label: 'Opus', source: 'builtin' },
      { id: 'legacy', label: 'Legacy', source: 'project' }],
  });
  assert.deepEqual(rows.map((r) => [r.id, r.title, r.href, r.meta]), [
    ['addon:marketplace/settings:jira', 'jira settings', '#marketplace/installed/jira/settings', 'Marketplace · Plugin settings'],
    ['addon:connectors/server:manual:linear', 'linear', '#connectors/servers/manual%3Alinear', 'Connectors · MCP server'],
    ['addon:models/model:my-gpt', 'My GPT', '#models/model/my-gpt', 'Models · Your model'],
    ['addon:models/model:acme/fast', 'Acme fast', '#models/model/acme%2Ffast', 'Models · From acme'],
    ['addon:models/model:team-sonnet', 'Team Sonnet', '#models/model/team-sonnet', 'Models · Team policy'],
  ]);
  for (const r of rows) assert.deepEqual(locksFor(r, { level: 'simple', flags: {} }), [], `${r.id} never locks`);
  assert.deepEqual(addonEntriesFrom({}), []);
  assert.deepEqual(addonEntriesFrom(), []);
});

test('hrefs: General is plain #settings, other tabs #settings/<tab>, cards #settings/<tab>/<card id>', () => {
  const h = (id) => SETTING_ENTRIES.find((e) => e.id === id).href;
  assert.equal(h('tab:general'), '#settings');
  assert.equal(h('tab:guardrails'), '#settings/guardrails');
  assert.equal(h('card:appearance-card'), '#settings/general/appearance-card');
  assert.equal(h('card:budget-settings-card'), '#settings/runs/budget-settings-card');
});

test('Appearance is found by screensaver, screen saver, idle', async () => {
  const { searchRows } = await import('../ui/public/global-search.mjs');
  for (const q of ['screensaver', 'screen saver', 'idle']) {
    const ids = searchRows({ level: 'simple', flags: {} }, q).settings.map((r) => r.id);
    assert.ok(ids.includes('card:appearance-card'), `${q}: ${ids.join(', ')}`);
  }
});
