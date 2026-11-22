// test/ui-connectors-toolbar.test.mjs — the Connectors page: tab counts, the Servers / Skills toolbars (search, chips,
// Source), Clear filters, filters surviving repaints, keyboard moves, a stale load and the deep link clearing filters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createMcpView } from '../ui/public/mcp-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const win = doc.defaultView;
const click = (el) => el.dispatchEvent(new win.Event('click', { bubbles: true }));
const type = (el, v) => { el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); };
const key = (el, k) => el.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

const SETS = [
  { id: 'general', name: 'General', group: 'general', greyed: false, home: null, serverCount: 1, skillCount: 0, problem: false, usedBy: [], members: [] },
  { id: 'billing', name: 'Billing', group: 'set', greyed: false, home: null, serverCount: 1, skillCount: 0, problem: true, usedBy: [], members: [] },
];
const srv = (id, over = {}) => ({ id, base: id.split(':')[1], provisional: false, source: 'manual', sourceLabel: 'Manual', type: 'stdio', description: '', fields: [],
  inSets: [], tools: null, pluginDisabled: false, inClaudeConfig: false, retired: null, needsSetup: false, ...over });
const SERVERS = [
  srv('manual:pg', { description: 'Replica', inSets: [{ id: 'billing', name: 'Billing' }] }),
  srv('plugin:acme/sentry', { source: 'plugin', sourceLabel: 'acme', inSets: [{ id: 'general', name: 'General' }], needsSetup: true }),
  srv('plugin:acme/jira', { source: 'plugin', sourceLabel: 'acme' }),
];
const sk = (id, over = {}) => ({ id, name: id.split(':').pop(), description: '', source: 'library', sourceLabel: 'Imported', valid: true, problems: [], scripts: [],
  shellBlocks: 0, files: 1, frontmatter: {}, inSets: [], updateAvailable: false, pluginEnabled: true, origin: null, ...over });
const SKILLS = [sk('skill:library:a'), sk('skill:plugin:acme/b', { source: 'plugin', plugin: 'acme', sourceLabel: 'acme', updateAvailable: true }),
  sk('skill:library:c', { frontmatter: { hooks: true } })];

function mount({ over = {} } = {}) {
  const calls = [];
  const api = async (method, path, body) => {
    calls.push([method, path, body]);
    const k = `${method} ${path}`;
    if (Object.hasOwn(over, k)) { const v = over[k]; if (typeof v !== 'function') return v; const r = v(); if (r) return r; }
    if (k === 'GET /api/mcp/sets') return { ok: true, status: 200, data: { newer: false, sets: SETS } };
    if (method === 'GET' && path.startsWith('/api/mcp/sets/')) {
      return { ok: true, status: 200, data: { set: { id: 'general', name: 'General', group: 'general', greyed: false, home: null, usedBy: [], pluginName: 'general', renamedPlugin: false }, members: [], skills: [] } };
    }
    if (k === 'GET /api/mcp/servers') return { ok: true, status: 200, data: { servers: SERVERS } };
    if (k === 'GET /api/skills') return { ok: true, status: 200, data: { newer: false, skills: SKILLS } };
    return { ok: true, status: 200, data: { ok: true } };
  };
  const host = doc.createElement('section');
  doc.body.replaceChildren(host);
  const nav = [];
  const modal = { open() {}, close() {} };
  const ctl = createMcpView({ host, api, navigate: (h) => nav.push(h), confirm: async () => true, modal, doc });
  return { host, ctl, calls, nav };
}
const ids = (host) => [...host.querySelectorAll('.cx-list .cx-row')].map((r) => r.dataset.server || r.dataset.skill);
const counts = (host) => [...host.querySelectorAll('nav.mk-tabs .mk-count')].map((c) => (c.hidden ? null : c.textContent));
const chip = (host, k) => host.querySelector(`[data-cx-chip="${k}"]`);

test('tab counts: each tab\'s .mk-count shows its list length on first paint, on every view', async () => {
  for (const view of ['', 'servers', 'skills']) {
    const { host, ctl } = mount();
    await ctl.show(view);
    assert.deepEqual(counts(host), ['2', '3', '3'], `view "${view}"`);
  }
  const { host, ctl } = mount({ over: { 'GET /api/skills': { ok: false, status: 500, data: { error: 'x' } } } });
  await ctl.show('');
  assert.deepEqual(counts(host), ['2', '3', null], 'a count not loaded is hidden');
});

test('servers toolbar: typing filters rows and keeps focus and caret in the search', async () => {
  const { host, ctl } = mount();
  await ctl.show('servers');
  assert.deepEqual(ids(host), SERVERS.map((s) => s.id));
  const box = host.querySelector('[data-cx-search="servers"]');
  box.focus();
  box.value = 'repl';
  box.setSelectionRange(2, 2);
  box.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.deepEqual(ids(host), ['manual:pg']);
  const again = host.querySelector('[data-cx-search="servers"]');
  assert.notEqual(again, box);
  assert.equal(doc.activeElement, again);
  assert.deepEqual([again.value, again.selectionStart], ['repl', 2]);
});

test('servers toolbar: chips narrow the rows and set aria-pressed; counts follow the query', async () => {
  const { host, ctl } = mount();
  await ctl.show('servers');
  const n = (k) => chip(host, k).querySelector('.n').textContent;
  assert.deepEqual(['all', 'in-set', 'no-set', 'needs-setup'].map(n), ['3', '2', '1', '1']);
  click(chip(host, 'needs-setup'));
  assert.deepEqual(ids(host), ['plugin:acme/sentry']);
  assert.equal(chip(host, 'needs-setup').getAttribute('aria-pressed'), 'true');
  assert.equal(chip(host, 'all').getAttribute('aria-pressed'), 'false');
  click(chip(host, 'no-set'));
  assert.deepEqual(ids(host), ['plugin:acme/jira']);
  click(chip(host, 'in-set'));
  assert.deepEqual(ids(host), ['manual:pg', 'plugin:acme/sentry']);
  type(host.querySelector('[data-cx-search="servers"]'), 'sentry');
  assert.deepEqual(['all', 'in-set', 'no-set', 'needs-setup'].map(n), ['1', '1', '0', '1'], 'counts honour the query, not the chip');
});

test('servers toolbar: Source narrows to one source label', async () => {
  const { host, ctl } = mount();
  await ctl.show('servers');
  const sel = host.querySelector('[data-cx-source]');
  assert.deepEqual([...sel.options].map((o) => o.value), ['', 'acme', 'Manual']);
  sel.value = 'acme';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.deepEqual(ids(host), ['plugin:acme/sentry', 'plugin:acme/jira']);
  assert.equal(host.querySelector('[data-cx-source]').value, 'acme');
});

test('servers toolbar: no match shows "No servers match." with Clear filters, which resets and focuses search', async () => {
  const { host, ctl } = mount();
  await ctl.show('servers');
  type(host.querySelector('[data-cx-search="servers"]'), 'zzz');
  assert.equal(host.querySelector('p.empty-line').textContent.trim(), 'No servers match. Clear filters');
  assert.equal(host.querySelector('.cx-list'), null);
  click(host.querySelector('[data-act="clear-filters"]'));
  assert.deepEqual(ids(host), SERVERS.map((s) => s.id));
  assert.equal(host.querySelector('[data-cx-search="servers"]').value, '');
  assert.equal(doc.activeElement, host.querySelector('[data-cx-search="servers"]'));
});

test('skills toolbar: Needs attention keeps update-available and hooks skills; Imported / From plugins split by source', async () => {
  const { host, ctl } = mount();
  await ctl.show('skills');
  click(chip(host, 'attention'));
  assert.deepEqual(ids(host), ['skill:plugin:acme/b', 'skill:library:c']);
  click(chip(host, 'imported'));
  assert.deepEqual(ids(host), ['skill:library:a', 'skill:library:c']);
  click(chip(host, 'plugins'));
  assert.deepEqual(ids(host), ['skill:plugin:acme/b']);
  assert.equal(host.querySelector('.cx-row .mk-chip-upd').textContent, 'Update available');
});

test('filters survive load() and a write repaint, and never fetch or write', async () => {
  const { host, ctl, calls } = mount();
  await ctl.show('servers');
  const before = calls.length;
  click(chip(host, 'in-set'));
  type(host.querySelector('[data-cx-search="servers"]'), 'pg');
  assert.equal(calls.length, before, 'a filter makes no API call');
  await ctl.show('servers');
  assert.deepEqual(ids(host), ['manual:pg']);
  assert.equal(chip(host, 'in-set').getAttribute('aria-pressed'), 'true');
});

test('keyboard: ↑/↓ move between rail facets and between rows; Enter on a server row opens its first action', async () => {
  const { host, ctl } = mount();
  await ctl.show('');
  const [a, b] = host.querySelectorAll('.cx-rail .mk-facet');
  assert.deepEqual([a.tabIndex, b.tabIndex], [0, -1], 'one Tab stop in the rail');
  a.focus();
  key(a, 'ArrowDown');
  assert.equal(doc.activeElement, b);
  assert.deepEqual([a.tabIndex, b.tabIndex], [-1, 0]);
  key(b, 'ArrowUp');
  assert.equal(doc.activeElement, a);
  await ctl.show('servers');
  const rows = [...host.querySelectorAll('.cx-list .cx-row')];
  assert.deepEqual(rows.map((r) => r.tabIndex), [0, -1, -1]);
  rows[0].focus();
  key(rows[0], 'ArrowDown');
  assert.equal(doc.activeElement, rows[1]);
  key(rows[1], 'End');
  assert.equal(doc.activeElement, rows[2]);
  let opened = null;
  rows[2].querySelector('[data-add-to]').addEventListener('click', () => { opened = true; });
  key(rows[2], 'Enter');
  assert.equal(opened, true);
});

test('a stale load never paints: a slow earlier servers read lands after a view switch and draws nothing', async () => {
  let late;
  let first_ = true;
  const { host, ctl } = mount({ over: { 'GET /api/mcp/servers': () => { if (!first_) return null; first_ = false; return new Promise((r) => { late = r; }); } } });
  const first = ctl.show('servers');
  await ctl.show('skills');
  late({ ok: true, status: 200, data: { servers: SERVERS } });
  await first;
  assert.ok(host.querySelector('.cx-skills'));
  assert.equal(host.querySelector('.cx-servers'), null);
});

test('a deep link clears the servers filters, so the routed row is on the page', async () => {
  const { host, ctl } = mount();
  await ctl.show('servers');
  click(chip(host, 'no-set'));
  await ctl.show('servers/plugin%3Aacme%2Fsentry');
  assert.ok(host.querySelector('.cx-row[data-server="plugin:acme/sentry"]'));
});

test('a load error says what, why and that nothing changed, with Try again', async () => {
  const { host, ctl, calls } = mount({ over: { 'GET /api/mcp/servers': { ok: false, status: 500, data: { error: 'boom' } } } });
  await ctl.show('servers');
  const err = host.querySelector('.empty-line.is-err[role=alert]');
  assert.match(err.textContent, /Could not load servers.*boom\. Nothing changed\./);
  assert.match(host.querySelector('.form-msg.err').textContent, /boom/);
  const n = calls.length;
  click(err.querySelector('[data-act="retry"]'));
  await settle();
  assert.ok(calls.length > n);
});
