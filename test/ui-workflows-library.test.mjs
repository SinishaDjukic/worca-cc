// test/ui-workflows-library.test.mjs — the Library card over plain data (no app.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const AGENTS = [
  { key: 'planner', displayName: 'Plan', description: 'Writes the plan.', runnerType: 'producer', origin: 'builtin', domain: 'coding', color: 'violet',
    inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'plan', type: 'md' }], order: 2 },
  { key: 'clarify', displayName: 'Clarify', description: 'Asks first.', runnerType: 'clarifier', origin: 'builtin', domain: 'shared', color: 'red',
    inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'answers', type: 'json' }], order: 1, asksQuestions: true },
  { key: 'docsWriter', displayName: 'Docs Writer', description: 'Writes docs.', runnerType: 'producer', origin: 'user', domain: 'general', color: 'green',
    inputs: [{ id: 'plan', type: 'md' }], outputs: [{ id: 'docs', type: 'md' }] },
  { key: 'workspaceScanner', displayName: 'Scanner', origin: 'builtin', domain: 'coding', placeable: false, inputs: [], outputs: [] },
];
const SCRIPTS = [
  { key: 'gitDiff', displayName: 'Git diff', runtime: 'node', origin: 'builtin', inputs: [{ id: 'done', type: 'void' }], outputs: [{ id: 'diff', type: 'md' }] },
  { key: 'runTests', displayName: 'Run tests', runtime: 'shell', origin: 'user', inputs: [{ id: 'code', type: 'void' }], outputs: [{ id: 'log', type: 'md' }, { id: 'fail', type: 'md', when: 'blocking' }] },
];
const WORKFLOWS = [
  { id: 'wf_default', name: 'Default', version: 2, domain: 'coding', origin: null, nodes: [{ id: 'n_t', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_e', kind: 'end', x: 400, y: 0, config: {} }], wires: [] },
  { id: 'wf_quick', name: 'Quick Fix', version: 2, domain: 'coding', origin: 'plugin:demo', nodes: [], wires: [] },
  { id: 'wf_mine', name: 'Mine', version: 2, domain: 'general', origin: null, nodes: [], wires: [] },
];

async function boot(data = {}) {
  const dom = new JSDOM('<!doctype html><body><aside id="lib"></aside></body>', { url: 'http://localhost:4317/' });
  const doc = dom.window.document;
  const { createLibrary } = await import(new URL('../ui/public/workflows/library.mjs', import.meta.url).href);
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  const actions = new Proxy({ portsFn: () => ({ inputs: [], outputs: [] }) }, { get: (t, k) => (k in t ? t[k] : rec(String(k))) });
  const lib = createLibrary({ doc, host: doc.getElementById('lib'), actions });
  lib.setData({ agents: AGENTS, scripts: SCRIPTS, workflows: WORKFLOWS, archived: [], placedKinds: ['task', 'end'], openId: 'wf_default', newIds: new Set(['wf_mine']), ...data });
  lib.setOpen(true);
  return { dom, win: dom.window, doc, lib, calls, host: doc.getElementById('lib') };
}
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const rowsOf = (host) => [...host.querySelectorAll('.wfl-item')].map((r) => r.dataset.item);

test('three tabs with counts; Agents groups by domain, shared folded in, Flow pinned last', async () => {
  const s = await boot();
  assert.deepEqual([...s.host.querySelectorAll('[role="tab"]')].map((t) => [t.dataset.tab, t.querySelector('.wfl-n').textContent]),
    [['agents', '4'], ['scripts', '2'], ['workflows', '3']]);
  assert.deepEqual([...s.host.querySelectorAll('.wfl-gh .wfl-gl')].map((g) => g.textContent), ['coding', 'general', 'Flow']);
  const coding = s.host.querySelector('.wfl-group[data-group="coding"]');
  assert.deepEqual([...coding.querySelectorAll('.wfl-item')].map((r) => r.dataset.item), ['agent:clarify', 'agent:planner', 'agent:workspaceScanner']);
  assert.equal(s.host.querySelector('.wfl-foot').textContent, '4 agents');
});

test('Built-in / Yours chips and the filter narrow the rows', async () => {
  const s = await boot();
  click(s.host.querySelector('[data-chip="yours"]'));
  assert.deepEqual(rowsOf(s.host), ['agent:docsWriter']);
  click(s.host.querySelector('[data-chip="all"]'));
  click(s.host.querySelector('.wfl-filter-btn'));
  const f = s.doc.getElementById('wfl-filter');
  assert.equal(f.placeholder, 'Filter agents…');
  f.value = 'docs';
  f.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  assert.deepEqual(rowsOf(s.host), ['agent:docsWriter']);
  f.value = 'zzz';
  f.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  assert.equal(s.host.querySelector('.wfl-empty').textContent, 'No agents match “zzz”');
});

test('a row drags {kind,key} as application/x-worca; "+" adds at the centre; not-placeable rows do neither', async () => {
  const s = await boot();
  const row = s.host.querySelector('.wfl-item[data-item="agent:planner"] .wfl-row');
  assert.equal(row.getAttribute('draggable'), 'true');
  const set = {};
  const ev = new s.win.Event('dragstart', { bubbles: true });
  ev.dataTransfer = { setData: (t, v) => { set[t] = v; }, setDragImage() {}, effectAllowed: '' };
  row.dispatchEvent(ev);
  assert.deepEqual(JSON.parse(set['application/x-worca']), { kind: 'agent', key: 'planner' });
  assert.equal(set['text/plain'], 'Plan');
  click(s.host.querySelector('.wfl-item[data-item="agent:planner"] .wfl-add'));
  assert.deepEqual(s.calls.at(-1), ['addToCanvas', { kind: 'agent', key: 'planner' }]);
  const scanner = s.host.querySelector('.wfl-item[data-item="agent:workspaceScanner"]');
  assert.equal(scanner.querySelector('.wfl-row').getAttribute('draggable'), 'false');
  assert.equal(scanner.querySelector('.wfl-add'), null);
  assert.match(scanner.textContent, /not placeable/);
});

test('detail actions by origin: built-in View · Duplicate; user Edit · Delete', async () => {
  const s = await boot();
  click(s.host.querySelector('.wfl-item[data-item="agent:planner"] .wfl-main'));
  const d = s.host.querySelector('.wfl-item[data-item="agent:planner"] .wfl-detail');
  assert.match(d.textContent, /planner · producer — Writes the plan\./);
  assert.deepEqual([...d.querySelectorAll('.wfl-actions button')].map((b) => b.textContent), ['Add to canvas', 'View', 'Duplicate']);
  click(s.host.querySelector('.wfl-item[data-item="agent:docsWriter"] .wfl-main'));
  const u = s.host.querySelector('.wfl-item[data-item="agent:docsWriter"] .wfl-detail');
  assert.deepEqual([...u.querySelectorAll('.wfl-actions button')].map((b) => b.textContent), ['Add to canvas', 'Edit', 'Delete']);
  click([...u.querySelectorAll('.wfl-actions button')].find((b) => b.textContent === 'Edit'));
  assert.deepEqual(s.calls.at(-1), ['editAgent', 'docsWriter']);
});

test('Scripts tab: runtime chip, "+ New script", Edit/Open opens the editor sheet', async () => {
  const s = await boot();
  s.lib.open('scripts');
  assert.match(s.host.querySelector('.wfl-item[data-item="script:runTests"]').textContent, /shell/);
  click(s.doc.getElementById('wfl-new-script'));
  assert.deepEqual(s.calls.at(-1), ['newScript']);
  click(s.host.querySelector('.wfl-item[data-item="script:gitDiff"] .wfl-main'));
  const d = s.host.querySelector('.wfl-item[data-item="script:gitDiff"] .wfl-detail');
  assert.deepEqual([...d.querySelectorAll('.wfl-actions button')].map((b) => b.textContent), ['Add to canvas', 'Open', 'Duplicate']);
  click([...d.querySelectorAll('.wfl-actions button')].find((b) => b.textContent === 'Open'));
  assert.deepEqual(s.calls.at(-1), ['openScript', 'gitDiff']);
});

test('Workflows tab: a row click opens it; built-ins have no trash; NEW and Open chips; Export…', async () => {
  const s = await boot();
  s.lib.open('workflows');
  const def = s.host.querySelector('.wfl-wf[data-id="wf_default"]');
  assert.equal(def.querySelector('.wfl-del'), null);
  assert.match(def.textContent, /Open/);
  assert.match(s.host.querySelector('.wfl-wf[data-id="wf_mine"]').textContent, /NEW/);
  assert.match(s.host.querySelector('.wfl-wf[data-id="wf_quick"]').textContent, /plugin:demo/);
  click(s.host.querySelector('.wfl-wf[data-id="wf_mine"] .wfl-main'));
  assert.deepEqual(s.calls.at(-1), ['openWorkflow', 'wf_mine']);
  click(s.host.querySelector('.wfl-wf[data-id="wf_mine"] .wfl-del'));
  assert.equal(s.calls.at(-1)[0], 'deleteWorkflow');
  click(s.host.querySelector('.wfl-wf[data-id="wf_mine"] .wfl-export'));
  assert.equal(s.calls.at(-1)[0], 'exportWorkflow');
  assert.deepEqual([...s.host.querySelectorAll('[data-chip]')].map((c) => c.textContent), ['All 3', 'coding 2', 'general 1']);
});

test('highlight switches tab, clears the filter, opens and flashes the row', async () => {
  const s = await boot();
  s.lib.highlight('script', 'runTests');
  assert.equal(s.host.dataset.tab, 'scripts');
  const item = s.host.querySelector('.wfl-item[data-item="script:runTests"]');
  assert.ok(item.classList.contains('is-flash'));
  assert.ok(item.querySelector('.wfl-detail'));
});

test('focus survives a row toggle and is never looked up through a selector built from a key', async () => {
  const s = await boot();
  // Chrome throws on `#agent:planner` (an unknown pseudo-class); jsdom does not — emulate Chrome.
  const real = s.win.Element.prototype.querySelector;
  s.host.querySelector = function (sel) {
    if (/#[^\s\]]*:/.test(sel)) throw new s.win.DOMException(`'${sel}' is not a valid selector`, 'SyntaxError');
    return real.call(this, sel);
  };
  const main = real.call(s.host, '.wfl-item[data-item="agent:planner"] .wfl-main');
  main.focus();
  click(main);
  assert.equal(s.doc.activeElement.dataset.focusKey, 'agent:planner');
});

test('a workspace-only agent is listed but never placeable; plugin rows and scripts carry their chips', async () => {
  const WS = { key: 'workspaceReviewer', displayName: 'Workspace Reviewer', origin: 'builtin', domain: 'coding', scope: 'workspace-only', inputs: [], outputs: [] };
  const PLUG = { key: 'lint', displayName: 'Lint', runtime: 'python', origin: 'plugin:demo', caseCount: 2, inputs: [], outputs: [] };
  const s = await boot({ agents: [...AGENTS, WS], scripts: [...SCRIPTS, PLUG], runtimes: { python: { ok: false } } });
  const row = s.host.querySelector('.wfl-item[data-item="agent:workspaceReviewer"]');
  assert.equal(row.querySelector('.wfl-row').getAttribute('draggable'), 'false');
  assert.equal(row.querySelector('.wfl-add'), null);
  assert.match(row.textContent, /workspace only/);
  s.lib.open('scripts');
  const lint = s.host.querySelector('.wfl-item[data-item="script:lint"]');
  for (const chip of ['plugin:demo', '2 cases', 'python not found']) assert.match(lint.textContent, new RegExp(chip));
});

test('a chip click keeps focus on that chip (never <body>, where the canvas takes Delete)', async () => {
  const s = await boot();
  const chip = s.host.querySelector('[data-chip="yours"]');
  chip.focus();
  click(chip);
  assert.equal(s.doc.activeElement.dataset.chip, 'yours');
  s.lib.open('workflows');
  const d = s.host.querySelector('[data-chip="coding"]');
  d.focus();
  click(d);
  assert.equal(s.doc.activeElement.dataset.chip, 'coding');
});

test('typing in the filter keeps the input and its caret; highlight unfolds a folded group', async () => {
  const s = await boot();
  click(s.host.querySelector('.wfl-filter-btn'));
  const f = s.doc.getElementById('wfl-filter');
  f.value = 'docs';
  f.setSelectionRange(2, 2);
  f.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  assert.equal(s.doc.getElementById('wfl-filter'), f, 'the input is not rebuilt');
  assert.equal(s.doc.activeElement, f);
  assert.equal(f.selectionStart, 2);
  assert.deepEqual(rowsOf(s.host), ['agent:docsWriter']);
  assert.equal(s.host.querySelector('.wfl-foot').textContent, '1 agents');
  f.value = '';
  f.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  s.lib.open('scripts');
  click(s.host.querySelector('.wfl-group[data-group="general"] .wfl-gh'));
  assert.equal(s.host.querySelector('.wfl-item[data-item="script:runTests"]'), null, 'folded');
  s.lib.highlight('script', 'runTests');
  assert.ok(s.host.querySelector('.wfl-item[data-item="script:runTests"].is-flash'));
});

test('Escape in the filter clears it, then closes it, and never reaches the document; a tab switch resets the filter', async () => {
  const s = await boot();
  click(s.host.querySelector('.wfl-filter-btn'));
  const f = s.doc.getElementById('wfl-filter');
  f.focus();
  f.value = 'docs';
  f.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  let reached = 0;
  s.doc.addEventListener('keydown', () => { reached += 1; });
  const esc = () => s.doc.activeElement.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  esc();
  assert.equal(s.doc.getElementById('wfl-filter').value, '', 'the first Escape clears');
  assert.equal(s.host.querySelector('.wfl-search').hidden, false, '… and keeps the box open');
  assert.ok(rowsOf(s.host).includes('agent:planner'));
  esc();
  assert.equal(s.host.querySelector('.wfl-search').hidden, true, 'the second Escape closes it');
  assert.equal(s.doc.activeElement.id, 'wfl-filter-btn');
  assert.equal(reached, 0, 'the canvas keyboard (a document listener) never sees either Escape');
  click(s.host.querySelector('.wfl-filter-btn'));
  const g = s.doc.getElementById('wfl-filter');
  g.value = 'zzz';
  g.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  s.lib.open('scripts');
  assert.equal(s.doc.getElementById('wfl-filter').value, '');
  assert.deepEqual(rowsOf(s.host).sort(), ['script:gitDiff', 'script:runTests']);
});

test('a data refresh keeps the list where it was scrolled; a tab switch starts at the top', async () => {
  const s = await boot();
  s.host.querySelector('.wfl-list').scrollTop = 40;
  s.lib.setData({ placedKinds: ['task'] });
  assert.equal(s.host.querySelector('.wfl-list').scrollTop, 40);
  s.lib.open('scripts');
  assert.equal(s.host.querySelector('.wfl-list').scrollTop, 0);
});

test('the Library tabs, filter chips and group heads show the house focus ring, not the browser\'s', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /:is\(\.wfl-tab,\.wfl-gh\):focus-visible\{outline:2px solid var\(--ink\);outline-offset:-2px;\}/);
  assert.match(css, /\.wfl-chip:focus-visible\{outline:2px solid var\(--ink\);outline-offset:2px;\}/);
});

test('a placed Task / End: the focus its gone "+" or Add to canvas held goes to its row, else the tab — never <body>', async () => {
  const s = await boot({ placedKinds: ['task'] });
  const add = s.host.querySelector('.wfl-item[data-item="flow:end"] .wfl-add');
  add.focus();
  click(add);
  assert.deepEqual(s.calls.at(-1), ['addToCanvas', { kind: 'end' }]);
  s.lib.setData({ placedKinds: ['task', 'end'] });        // app.js afterRender after the spawn
  assert.equal(s.host.querySelector('.wfl-item[data-item="flow:end"] .wfl-add'), null, 'precondition: the "+" is gone');
  assert.equal(s.doc.activeElement.dataset.focusKey, 'flow:end', 'the End row');
  s.lib.setData({ placedKinds: ['task'] });
  click(s.host.querySelector('.wfl-item[data-item="flow:end"] .wfl-main'));
  const inline = [...s.host.querySelectorAll('.wfl-item[data-item="flow:end"] .wfl-actions button')].find((b) => b.textContent === 'Add to canvas');
  inline.focus();
  s.lib.setData({ placedKinds: ['task', 'end'] });
  assert.equal(s.doc.activeElement.dataset.focusKey, 'flow:end', 'the detail\'s Add to canvas falls back to its row');
  s.lib.render('agent:nobody:View');                       // an opener whose row is gone
  assert.equal(s.doc.activeElement.id, 'wfl-tab-agents', 'the tab');
});
