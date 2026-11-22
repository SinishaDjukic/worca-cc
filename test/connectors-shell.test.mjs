// test/connectors-shell.test.mjs — the Connectors page frame: tabs, toolbar, pure filters, states, arrow-key move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  renderTabs, renderHead, renderToolbar, renderLoadError, renderEmpty, emptyLine, moveInList, sourceOptions,
  filterServers, serverChipCounts, filterSkills, skillChipCounts,
} from '../ui/public/mcp-servers/connectors-shell.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const srv = (id, over = {}) => ({ id, base: id, description: '', sourceLabel: 'Manual', inSets: [], needsSetup: false, ...over });
const SERVERS = [
  srv('pg', { inSets: [{ id: 'billing', name: 'Billing' }], description: 'Replica' }),
  srv('sentry', { sourceLabel: 'acme-tools', inSets: [{ id: 'g', name: 'General' }], needsSetup: true }),
  srv('jira', { sourceLabel: 'acme-tools' }),
];
const sk = (id, over = {}) => ({ id, name: id, description: '', source: 'library', valid: true, frontmatter: {}, inSets: [], ...over });
const SKILLS = [
  sk('a'), sk('b', { source: 'plugin', plugin: 'acme', sourceLabel: 'acme', updateAvailable: true }),
  sk('c', { frontmatter: { hooks: {} } }), sk('d', { source: 'plugin', plugin: 'zed', sourceLabel: 'zed', valid: false }),
];

test('filterServers: each chip, q, source, and in combination', () => {
  const ids = (f) => filterServers(SERVERS, f).map((s) => s.id);
  assert.deepEqual(ids({}), ['pg', 'sentry', 'jira']);
  assert.deepEqual(ids({ chip: 'in-set' }), ['pg', 'sentry']);
  assert.deepEqual(ids({ chip: 'no-set' }), ['jira']);
  assert.deepEqual(ids({ chip: 'needs-setup' }), ['sentry']);
  assert.deepEqual(ids({ q: 'BILL' }), ['pg'], 'set names are searched, case-insensitively');
  assert.deepEqual(ids({ q: 'replica' }), ['pg']);
  assert.deepEqual(ids({ source: 'acme-tools' }), ['sentry', 'jira']);
  assert.deepEqual(ids({ source: 'acme-tools', chip: 'no-set' }), ['jira']);
});

test('serverChipCounts honours q and source but not the chip', () => {
  assert.deepEqual(serverChipCounts(SERVERS), { all: 3, 'in-set': 2, 'no-set': 1, 'needs-setup': 1 });
  assert.deepEqual(serverChipCounts(SERVERS, { source: 'acme-tools' }), { all: 2, 'in-set': 1, 'no-set': 1, 'needs-setup': 1 });
  assert.equal(serverChipCounts(SERVERS, { q: 'pg' }).all, 1);
});

test('filterSkills / skillChipCounts: Imported, From plugins and Needs attention (D3)', () => {
  const ids = (f) => filterSkills(SKILLS, f).map((x) => x.id);
  assert.deepEqual(ids({ chip: 'imported' }), ['a', 'c']);
  assert.deepEqual(ids({ chip: 'plugins' }), ['b', 'd']);
  assert.deepEqual(ids({ chip: 'attention' }), ['b', 'c', 'd'], 'update, hooks, invalid');
  assert.deepEqual(ids({ source: 'Imported' }), ['a', 'c']);
  assert.deepEqual(ids({ source: 'zed' }), ['d']);
  assert.deepEqual(skillChipCounts(SKILLS), { all: 4, imported: 2, plugins: 2, attention: 3 });
  assert.equal(skillChipCounts(SKILLS, { source: 'acme' }).attention, 1);
});

test('sourceOptions: All sources, then distinct sorted', () => {
  assert.deepEqual(sourceOptions(SERVERS, (s) => s.sourceLabel), [
    { value: '', label: 'All sources' }, { value: 'Manual', label: 'Manual' }, { value: 'acme-tools', label: 'acme-tools' }]
    .sort((a, b) => (a.value === '' ? -1 : b.value === '' ? 1 : a.value.localeCompare(b.value))));
});

test('renderTabs: link tabs, only the selected one is current, counts hidden until known', () => {
  const nav = renderTabs(doc, { view: 'servers', counts: { sets: 3, servers: 5 } });
  assert.ok(nav.matches('nav.tabs.mk-tabs[aria-label="Connectors sections"]'));
  const tabs = [...nav.querySelectorAll('a.tab.mk-tab')];
  assert.deepEqual(tabs.map((a) => a.getAttribute('href')), ['#connectors', '#connectors/servers', '#connectors/skills']);
  assert.deepEqual(tabs.map((a) => a.classList.contains('on')), [false, true, false]);
  assert.deepEqual(tabs.map((a) => a.getAttribute('aria-current')), [null, 'page', null]);
  assert.deepEqual(tabs.map((a) => a.dataset.mcpView), ['sets', 'servers', 'skills']);
  assert.deepEqual(tabs.map((a) => a.querySelector('.mk-count').textContent), ['3', '5', '']);
  assert.deepEqual(tabs.map((a) => a.querySelector('.mk-count').hidden), [false, false, true]);
  const head = renderHead(doc, { tabs: nav, actions: [doc.createElement('button')] });
  assert.ok(head.querySelector('.mk-head-actions button') && head.firstChild === nav);
});

test('renderToolbar: search, pressed chip with count, Source options', () => {
  const bar = renderToolbar(doc, { kind: 'servers', filters: { q: 'x', chip: 'no-set', source: 'Manual' },
    counts: { all: 3, 'no-set': 1 }, sources: sourceOptions(SERVERS, (s) => s.sourceLabel) });
  assert.ok(bar.matches('.mdl-toolbar.cx-toolbar[role=search]'));
  const search = bar.querySelector('input.mv-search[data-cx-search=servers]');
  assert.equal(search.value, 'x');
  assert.equal(search.getAttribute('aria-label'), 'Search servers');
  const chips = [...bar.querySelectorAll('button.filter-chip[data-cx-chip]')];
  assert.deepEqual(chips.map((c) => c.dataset.cxChip), ['all', 'in-set', 'no-set', 'needs-setup']);
  assert.deepEqual(chips.map((c) => c.getAttribute('aria-pressed')), ['false', 'false', 'true', 'false']);
  assert.equal(chips[2].querySelector('.n').textContent, '1');
  assert.equal(bar.querySelector('select[data-cx-source]').value, 'Manual');
  assert.equal(renderToolbar(doc, { kind: 'skills', filters: {}, sources: [] }).querySelector('input').getAttribute('aria-label'), 'Search skills');
});

test('renderLoadError / renderEmpty / emptyLine', () => {
  const e = renderLoadError(doc, { what: 'servers', cause: 'HTTP 500.', retryAct: 'retry' });
  assert.ok(e.matches('.empty-line.is-err[role=alert]'));
  assert.match(e.textContent, /Could not load servers/);
  assert.match(e.textContent, /HTTP 500\. Nothing changed\./);
  assert.ok(e.querySelector('.el-acts button[data-act=retry]'));
  const m = renderEmpty(doc, { title: 'No MCP servers yet', line: 'Add one.', action: doc.createElement('button') });
  assert.ok(m.matches('.mk-empty') && m.querySelector('.mk-empty-title').textContent === 'No MCP servers yet' && m.querySelector('button'));
  assert.ok(emptyLine(doc, 'None.').matches('p.empty-line'));
});

test('moveInList: arrows, Home/End, clamped, null for other keys', () => {
  const items = ['a', 'b', 'c'];
  const k = (key) => ({ key });
  assert.equal(moveInList(k('ArrowDown'), items, 'a'), 'b');
  assert.equal(moveInList(k('ArrowDown'), items, 'c'), 'c');
  assert.equal(moveInList(k('ArrowUp'), items, 'a'), 'a');
  assert.equal(moveInList(k('ArrowUp'), items, 'c'), 'b');
  assert.equal(moveInList(k('Home'), items, 'c'), 'a');
  assert.equal(moveInList(k('End'), items, 'a'), 'c');
  assert.equal(moveInList(k('Enter'), items, 'a'), null);
  assert.equal(moveInList(k('ArrowDown'), [], null), null);
});
