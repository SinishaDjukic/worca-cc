// test/ui-workflows-library.test.mjs — the Library card over plain data (no app.js): Home and its folders, the
// breadcrumb and the back row, the chips, the flat filter, rows and their actions, highlight, focus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const LIB_URL = new URL('../ui/public/workflows/library.mjs', import.meta.url).href;
const { FLOW, ARCHIVED, workflowDomains } = await import(LIB_URL);

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
const ARCH = [{ id: 'wf_gone', name: 'Gone flow', version: 2, domain: 'coding' }];

async function boot(data = {}) {
  const dom = new JSDOM('<!doctype html><body><aside id="lib"></aside></body>', { url: 'http://localhost:4317/' });
  const doc = dom.window.document;
  const { createLibrary } = await import(LIB_URL);
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
/** The folder rows on screen as [data-folder, name, count]. */
const foldersOf = (host) => [...host.querySelectorAll('.wfl-folder')].map((f) => [f.dataset.folder, f.querySelector('.wfl-fname').textContent, f.querySelector('.wfl-fn').textContent]);
const folder = (host, key) => [...host.querySelectorAll('.wfl-folder')].find((f) => f.dataset.folder === key);
const crumbsOf = (host) => [...host.querySelectorAll('.wfl-crumbs .wfl-crumb')].map((c) => c.textContent);
const tagsOf = (host) => [...host.querySelectorAll('.wfl-item')].map((r) => (r.querySelector('.wfl-where') || { textContent: '' }).textContent);
const type = (s, value) => {
  const f = s.doc.getElementById('wfl-filter');
  f.value = value;
  f.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  return f;
};

test('Home lists the Agents / Scripts / Workflows folders with their registry counts; Agents splits by domain (shared folded in), Flow pinned last', async () => {
  const s = await boot();
  assert.equal(s.host.dataset.tab, 'home');
  assert.deepEqual(foldersOf(s.host), [['agents', 'Agents', '4'], ['scripts', 'Scripts', '2'], ['workflows', 'Workflows', '3']]);
  assert.deepEqual([...s.host.querySelectorAll('.wfl-folder')].map((f) => f.dataset.tab), ['agents', 'scripts', 'workflows']);
  assert.equal(s.host.querySelector('[role="tab"]'), null, 'the segmented tabs are gone');
  assert.deepEqual(crumbsOf(s.host), ['Library']);
  assert.equal(s.doc.getElementById('wfl-up'), null, 'Home has no back row');
  assert.equal(s.host.querySelector('.wfl-foot').textContent, '9 items');
  click(folder(s.host, 'agents'));
  assert.equal(s.host.dataset.tab, 'agents');
  assert.deepEqual(foldersOf(s.host), [['agents/coding', 'coding', '3'], ['agents/general', 'general', '2'], [`agents/${FLOW}`, 'Flow', '5']]);
  assert.deepEqual(rowsOf(s.host), [], 'two domains: folders only');
  assert.equal(s.host.querySelector('.wfl-foot').textContent, '4 agents');
  click(folder(s.host, 'agents/coding'));
  assert.equal(s.host.dataset.path, 'agents/coding');
  assert.deepEqual(rowsOf(s.host), ['agent:clarify', 'agent:planner', 'agent:workspaceScanner']);
  assert.equal(s.host.querySelector('.wfl-foot').textContent, '3 agents');
  s.lib.openFolder(['agents', FLOW]);
  assert.deepEqual(rowsOf(s.host), ['flow:task', 'flow:end', 'flow:and', 'flow:or', 'flow:combine']);
  assert.equal(s.host.querySelector('.wfl-foot').textContent, '5 flow cards');
});

test('one group lists its rows directly: Scripts here, and a one-domain Workflows (Archived still pinned last)', async () => {
  const s = await boot({ workflows: [WORKFLOWS[0], WORKFLOWS[1]], archived: ARCH });
  s.lib.open('scripts');
  assert.deepEqual(foldersOf(s.host), []);
  assert.deepEqual(rowsOf(s.host), ['script:gitDiff', 'script:runTests']);
  assert.equal(s.host.querySelector('.wfl-foot').textContent, '2 scripts');
  s.lib.open('workflows');
  assert.deepEqual(rowsOf(s.host), ['workflow:wf_default', 'workflow:wf_quick']);
  assert.deepEqual(foldersOf(s.host), [[`workflows/${ARCHIVED}`, 'Archived', '1']]);
  assert.equal(s.host.querySelector('.wfl-list').lastElementChild.dataset.folder, `workflows/${ARCHIVED}`, 'pinned last');
  assert.equal(s.host.querySelector('.wfl-foot').textContent, '2 workflows');
});

test('Workflows: domain folders replace the domain chips; Archived (N) holds the archived rows, each deleted from its own button', async () => {
  const s = await boot({ archived: ARCH });
  s.lib.open('workflows');
  assert.equal(s.host.querySelector('[data-chip]'), null, 'no chips in Workflows');
  assert.deepEqual(foldersOf(s.host), [['workflows/coding', 'coding', '2'], ['workflows/general', 'general', '1'], [`workflows/${ARCHIVED}`, 'Archived', '1']]);
  click(folder(s.host, `workflows/${ARCHIVED}`));
  assert.deepEqual(rowsOf(s.host), ['archived:wf_gone']);
  assert.equal(s.host.querySelector('.wfl-wf'), null, 'an archived row is no workflow row (the tour\'s fallback target)');
  assert.equal(s.host.querySelector('.wfl-foot').textContent, '1 archived');
  click(s.host.querySelector('.wfl-item[data-item="archived:wf_gone"] .wfl-del'));
  assert.deepEqual(s.calls.at(-1), ['deleteArchived', ARCH[0]]);
  assert.deepEqual(workflowDomains([{ domain: 'shared' }, {}, { domain: 'zeta' }, { domain: 'alpha' }, { domain: 'general' }]),
    ['alpha', 'zeta', 'general', 'shared'], 'the old domain chips\' order');
});

test('All / Built-in / Yours narrow Agents and Scripts (a folder with nothing to show hides); the filter narrows to matches', async () => {
  const s = await boot();
  assert.equal(s.host.querySelector('[data-chip]'), null, 'no chips at Home');
  s.lib.open('agents');
  click(s.host.querySelector('[data-chip="yours"]'));
  assert.deepEqual(foldersOf(s.host), [['agents/general', 'general', '1']], 'coding and Flow have nothing of yours');
  click(folder(s.host, 'agents/general'));
  assert.deepEqual(rowsOf(s.host), ['agent:docsWriter']);
  assert.equal(s.host.querySelector('[data-chip="yours"]').getAttribute('aria-pressed'), 'true', 'the chip holds inside the folder');
  click(s.host.querySelector('[data-chip="all"]'));
  assert.deepEqual(rowsOf(s.host), ['agent:clarify', 'agent:docsWriter']);
  click(s.host.querySelector('.wfl-crumb[data-crumb="1"]'));
  click(s.host.querySelector('.wfl-filter-btn'));
  assert.equal(s.doc.getElementById('wfl-filter').placeholder, 'Filter agents…');
  type(s, 'docs');
  assert.deepEqual(rowsOf(s.host), ['agent:docsWriter']);
  type(s, 'zzz');
  assert.equal(s.host.querySelector('.wfl-empty').textContent, 'No agents match “zzz”');
});

test('a filter query lists every match under the open folder flat, each tagged with its folder; at Home it covers all three', async () => {
  const s = await boot({ archived: ARCH });
  click(s.host.querySelector('.wfl-filter-btn'));
  assert.equal(s.doc.getElementById('wfl-filter').placeholder, 'Filter the Library…');
  type(s, 'plan');
  assert.deepEqual(rowsOf(s.host), ['agent:planner', 'agent:docsWriter']);
  assert.deepEqual(tagsOf(s.host), ['Agents › coding', 'Agents › general']);
  assert.deepEqual(foldersOf(s.host), [], 'one flat list: no folder rows');
  assert.equal(s.doc.getElementById('wfl-up'), null);
  assert.equal(s.host.querySelector('.wfl-foot').textContent, '2 items');
  type(s, 'git');
  assert.deepEqual([rowsOf(s.host), tagsOf(s.host)], [['script:gitDiff'], ['Scripts']]);
  type(s, 'mine');
  assert.deepEqual([rowsOf(s.host), tagsOf(s.host)], [['workflow:wf_mine'], ['Workflows › general']]);
  type(s, 'gone');
  assert.deepEqual([rowsOf(s.host), tagsOf(s.host)], [['archived:wf_gone'], ['Workflows › Archived']]);
  s.lib.openFolder(['agents']);
  type(s, 'clarify');
  assert.deepEqual([rowsOf(s.host), tagsOf(s.host)], [['agent:clarify'], ['Agents › coding']], 'a shared agent shows once, at the first folder listing it');
  s.lib.openFolder(['agents', 'coding']);
  assert.equal(s.doc.getElementById('wfl-filter').value, '', 'a move clears the query');
  type(s, 'plan');
  assert.deepEqual(rowsOf(s.host), ['agent:planner'], 'the open folder bounds the search');
});

test('a row drags {kind,key} as application/x-worca; "+" adds at the centre; not-placeable rows do neither', async () => {
  const s = await boot();
  s.lib.openFolder(['agents', 'coding']);
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
  s.lib.openFolder(['agents', 'coding']);
  click(s.host.querySelector('.wfl-item[data-item="agent:planner"] .wfl-main'));
  const d = s.host.querySelector('.wfl-item[data-item="agent:planner"] .wfl-detail');
  assert.match(d.textContent, /planner · producer — Writes the plan\./);
  assert.deepEqual([...d.querySelectorAll('.wfl-actions button')].map((b) => b.textContent), ['Add to canvas', 'View', 'Duplicate']);
  s.lib.openFolder(['agents', 'general']);
  click(s.host.querySelector('.wfl-item[data-item="agent:docsWriter"] .wfl-main'));
  const u = s.host.querySelector('.wfl-item[data-item="agent:docsWriter"] .wfl-detail');
  assert.deepEqual([...u.querySelectorAll('.wfl-actions button')].map((b) => b.textContent), ['Add to canvas', 'Edit', 'Delete']);
  click([...u.querySelectorAll('.wfl-actions button')].find((b) => b.textContent === 'Edit'));
  assert.deepEqual(s.calls.at(-1), ['editAgent', 'docsWriter']);
});

test('the "+" sits at the breadcrumb\'s right in Agents (New agent) and Scripts (New script) only; Scripts rows keep their chips and actions', async () => {
  const s = await boot();
  assert.equal(s.doc.getElementById('wfl-new-agent'), null, 'no "+" at Home');
  s.lib.openFolder(['agents', 'coding']);
  const na = s.doc.getElementById('wfl-new-agent');
  assert.ok(na.closest('.wfl-crumbs'), 'in the breadcrumb bar');
  assert.equal(na.getAttribute('aria-label'), 'New agent');
  click(na);
  assert.deepEqual(s.calls.at(-1), ['newAgent']);
  s.lib.open('scripts');
  assert.equal(s.doc.getElementById('wfl-new-agent'), null);
  assert.match(s.host.querySelector('.wfl-item[data-item="script:runTests"]').textContent, /shell/);
  click(s.doc.getElementById('wfl-new-script'));
  assert.deepEqual(s.calls.at(-1), ['newScript']);
  click(s.host.querySelector('.wfl-item[data-item="script:gitDiff"] .wfl-main'));
  const d = s.host.querySelector('.wfl-item[data-item="script:gitDiff"] .wfl-detail');
  assert.deepEqual([...d.querySelectorAll('.wfl-actions button')].map((b) => b.textContent), ['Add to canvas', 'Open', 'Duplicate']);
  click([...d.querySelectorAll('.wfl-actions button')].find((b) => b.textContent === 'Open'));
  assert.deepEqual(s.calls.at(-1), ['openScript', 'gitDiff']);
  s.lib.open('workflows');
  assert.equal(s.host.querySelector('.wfl-new'), null, 'Workflows has no "+"');
});

test('Workflows rows: a row click opens it; built-ins have no trash; NEW and Open chips; Export…', async () => {
  const s = await boot();
  s.lib.openFolder(['workflows', 'coding']);
  const def = s.host.querySelector('.wfl-wf[data-id="wf_default"]');
  assert.equal(def.querySelector('.wfl-del'), null);
  assert.match(def.textContent, /Open/);
  assert.match(s.host.querySelector('.wfl-wf[data-id="wf_quick"]').textContent, /plugin:demo/);
  s.lib.openFolder(['workflows', 'general']);
  assert.match(s.host.querySelector('.wfl-wf[data-id="wf_mine"]').textContent, /NEW/);
  click(s.host.querySelector('.wfl-wf[data-id="wf_mine"] .wfl-main'));
  assert.deepEqual(s.calls.at(-1), ['openWorkflow', 'wf_mine']);
  click(s.host.querySelector('.wfl-wf[data-id="wf_mine"] .wfl-del'));
  assert.equal(s.calls.at(-1)[0], 'deleteWorkflow');
  click(s.host.querySelector('.wfl-wf[data-id="wf_mine"] .wfl-export'));
  assert.equal(s.calls.at(-1)[0], 'exportWorkflow');
});

test('highlight opens the folder AND the domain subfolder holding the row, clears the filter and the chip, opens and flashes the row', async () => {
  const s = await boot();
  s.lib.open('agents');
  click(s.host.querySelector('[data-chip="yours"]'));
  click(s.host.querySelector('.wfl-filter-btn'));
  type(s, 'zzz');
  s.lib.highlight('agent', 'planner');
  assert.equal(s.host.dataset.path, 'agents/coding');
  assert.equal(s.host.querySelector('.wfl-search').hidden, true, 'the filter closed');
  assert.equal(s.doc.getElementById('wfl-filter').value, '');
  assert.equal(s.host.querySelector('[data-chip="all"]').getAttribute('aria-pressed'), 'true');
  const planner = s.host.querySelector('.wfl-item[data-item="agent:planner"]');
  assert.ok(planner.classList.contains('is-flash') && planner.querySelector('.wfl-detail'));
  s.lib.highlight('script', 'runTests');
  assert.equal(s.host.dataset.path, 'scripts', 'one group: the top folder');
  const item = s.host.querySelector('.wfl-item[data-item="script:runTests"]');
  assert.ok(item.classList.contains('is-flash'));
  assert.ok(item.querySelector('.wfl-detail'));
  s.lib.highlight('workflow', 'wf_mine');
  assert.equal(s.host.dataset.path, 'workflows/general');
  assert.ok(s.host.querySelector('.wfl-wf[data-id="wf_mine"]').classList.contains('is-flash'));
});

test('focus survives a row toggle and a folder move and is never looked up through a selector built from a key', async () => {
  const s = await boot();
  // Chrome throws on `#agent:planner` (an unknown pseudo-class); jsdom does not — emulate Chrome.
  const real = s.win.Element.prototype.querySelector;
  s.host.querySelector = function (sel) {
    if (/#[^\s\]]*:/.test(sel)) throw new s.win.DOMException(`'${sel}' is not a valid selector`, 'SyntaxError');
    return real.call(this, sel);
  };
  click(folder(s.host, 'agents'));
  click(folder(s.host, 'agents/coding'));
  const main = real.call(s.host, '.wfl-item[data-item="agent:planner"] .wfl-main');
  main.focus();
  click(main);
  assert.equal(s.doc.activeElement.dataset.focusKey, 'agent:planner');
  click(s.doc.getElementById('wfl-up'));
  assert.equal(s.doc.activeElement.dataset.focusKey, 'folder:agents/coding');
});

test('folders, the back row and the crumbs are real buttons: entering a folder focuses its back row, going up focuses the folder it left', async () => {
  const s = await boot();
  const agents = folder(s.host, 'agents');
  assert.deepEqual([agents.tagName, agents.type], ['BUTTON', 'button']);
  agents.focus();
  click(agents);
  const back = s.doc.activeElement;
  assert.deepEqual([back.id, back.tagName, back.textContent, back.getAttribute('aria-label')], ['wfl-up', 'BUTTON', 'Library', 'Back to Library']);
  click(folder(s.host, 'agents/coding'));
  assert.equal(s.doc.activeElement.getAttribute('aria-label'), 'Back to Agents');
  assert.deepEqual(crumbsOf(s.host), ['Library', 'Agents', 'coding']);
  assert.deepEqual([...s.host.querySelectorAll('.wfl-crumbs button.wfl-crumb')].map((b) => b.textContent), ['Library', 'Agents'],
    'every crumb but the last is a button');
  assert.equal(s.host.querySelector('.wfl-crumb.is-current').getAttribute('aria-current'), 'location');
  click(s.doc.getElementById('wfl-up'));
  assert.equal(s.host.dataset.path, 'agents');
  assert.equal(s.doc.activeElement.dataset.folder, 'agents/coding', 'up: the folder row it came out of');
  click(folder(s.host, 'agents/general'));
  click(s.doc.getElementById('wfl-crumb-home'));
  assert.equal(s.host.dataset.path, 'home');
  assert.equal(s.doc.activeElement.dataset.folder, 'agents', 'the Library crumb: the top folder it left');
});

test('a double-click on a folder row, the back row or a crumb moves once: its second click never reaches the repainted list', async () => {
  const s = await boot();
  // A real double-click: mousedown + click with detail 1, then again with detail 2 on whatever now sits under the pointer.
  const press = (el, detail) => {
    const down = new s.win.MouseEvent('mousedown', { bubbles: true, cancelable: true, detail });
    el.dispatchEvent(down);
    el.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true, cancelable: true, detail }));
    return down;
  };
  const opened = () => s.calls.filter((c) => c[0] === 'openWorkflow').length;
  press(folder(s.host, 'workflows'), 1);
  assert.equal(s.doc.activeElement.id, 'wfl-up', 'entering a folder focuses its back row, with focus on <body> before the click');
  press(folder(s.host, 'workflows/coding'), 1);
  assert.equal(s.host.dataset.path, 'workflows/coding');
  const down = press(s.host.querySelector('.wfl-wf[data-id="wf_default"] .wfl-main'), 2);
  assert.equal(opened(), 0, 'the second click never opens the workflow now under the pointer');
  assert.equal(down.defaultPrevented, true, 'its mousedown moves no focus');
  assert.equal(s.host.dataset.path, 'workflows/coding');
  assert.equal(s.doc.activeElement.id, 'wfl-up');
  press(s.doc.getElementById('wfl-up'), 1);
  assert.equal(s.host.dataset.path, 'workflows');
  press(s.host.querySelector('.wfl-list').firstElementChild, 2);
  assert.equal(s.host.dataset.path, 'workflows', 'the back row goes up one level, not two');
  press(s.doc.getElementById('wfl-crumb-home'), 1);
  assert.equal(s.host.dataset.path, 'home');
  assert.equal(press(s.host.querySelector('.wfl-crumb.is-current'), 2).defaultPrevented, true);
  assert.equal(s.doc.activeElement.dataset.folder, 'workflows', 'focus stays on the folder the crumb went up to');
  press(folder(s.host, 'agents'), 1);
  assert.equal(press(s.host.querySelector('.wfl-tools'), 2).defaultPrevented, true, 'the chip row under the pointer takes no focus');
  assert.equal(s.doc.activeElement.id, 'wfl-up');
  click(folder(s.host, 'agents/coding'));
  assert.equal(s.host.dataset.path, 'agents/coding', 'a keyboard activation (detail 0) right after a move still moves');
  click(s.doc.getElementById('wfl-filter-btn'));
  press(s.doc.getElementById('wfl-up'), 1);
  assert.equal(press(s.doc.getElementById('wfl-filter'), 2).defaultPrevented, false, 'a double-click in the filter still selects a word');
  s.lib.openFolder(['workflows', 'coding']);
  const now = Date.now;
  Date.now = () => now() + 1000;
  try { press(s.host.querySelector('.wfl-wf[data-id="wf_default"] .wfl-main'), 2); } finally { Date.now = now; }
  assert.equal(opened(), 1, 'a double-click well after the move acts as before');
});

test('a workspace-only agent is listed but never placeable; plugin rows and scripts carry their chips', async () => {
  const WS = { key: 'workspaceReviewer', displayName: 'Workspace Reviewer', origin: 'builtin', domain: 'coding', scope: 'workspace-only', inputs: [], outputs: [] };
  const PLUG = { key: 'lint', displayName: 'Lint', runtime: 'python', origin: 'plugin:demo', caseCount: 2, inputs: [], outputs: [] };
  const s = await boot({ agents: [...AGENTS, WS], scripts: [...SCRIPTS, PLUG], runtimes: { python: { ok: false } } });
  s.lib.openFolder(['agents', 'coding']);
  const row = s.host.querySelector('.wfl-item[data-item="agent:workspaceReviewer"]');
  assert.equal(row.querySelector('.wfl-row').getAttribute('draggable'), 'false');
  assert.equal(row.querySelector('.wfl-add'), null);
  assert.match(row.textContent, /workspace only/);
  s.lib.open('scripts');
  const lint = s.host.querySelector('.wfl-item[data-item="script:lint"]');
  for (const chip of ['plugin:demo', '2 cases', 'python not found']) assert.match(lint.textContent, new RegExp(chip));
});

test('a chip click keeps focus on that chip (never <body>, where the canvas takes Delete); the chips sit under the breadcrumb, in Agents and Scripts only', async () => {
  const s = await boot();
  s.lib.open('agents');
  const chip = s.host.querySelector('[data-chip="yours"]');
  chip.focus();
  click(chip);
  assert.equal(s.doc.activeElement.dataset.chip, 'yours');
  s.lib.open('scripts');
  assert.deepEqual([...s.host.children].map((n) => n.className), ['wfl-head', 'wfl-crumbs', 'wfl-search', 'wfl-tools', 'wfl-list', 'wfl-foot']);
  s.lib.open('workflows');
  assert.deepEqual([...s.host.children].map((n) => n.className), ['wfl-head', 'wfl-crumbs', 'wfl-search', 'wfl-list', 'wfl-foot']);
});

test('typing in the filter keeps the input and its caret; highlight leaves the open folder for the one holding the row', async () => {
  const s = await boot();
  s.lib.open('agents');
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
  s.lib.openFolder(['agents', 'coding']);
  s.lib.highlight('agent', 'docsWriter');
  assert.equal(s.host.dataset.path, 'agents/general');
  assert.ok(s.host.querySelector('.wfl-item[data-item="agent:docsWriter"].is-flash'));
});

test('Escape in the filter clears it, then closes it, and never reaches the document; leaving the folder resets the filter', async () => {
  const s = await boot();
  s.lib.open('agents');
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
  assert.ok(foldersOf(s.host).some(([k]) => k === 'agents/coding'), '… and the folder listing is back');
  esc();
  assert.equal(s.host.querySelector('.wfl-search').hidden, true, 'the second Escape closes it');
  assert.equal(s.doc.activeElement.id, 'wfl-filter-btn');
  assert.equal(reached, 0, 'the canvas keyboard (a document listener) never sees either Escape');
  click(s.host.querySelector('.wfl-filter-btn'));
  type(s, 'zzz');
  s.lib.open('scripts');
  assert.equal(s.doc.getElementById('wfl-filter').value, '');
  assert.deepEqual(rowsOf(s.host).sort(), ['script:gitDiff', 'script:runTests']);
  s.lib.open('agents');
  click(folder(s.host, 'agents/coding'));
  type(s, 'zzz');
  click(s.host.querySelector('.wfl-crumb[data-crumb="1"]'));
  assert.equal(s.doc.getElementById('wfl-filter').value, '', 'a crumb clears it too');
  assert.equal(s.host.querySelector('.wfl-search').hidden, false, '… and keeps the box open');
});

test('a data refresh keeps the list where it was scrolled; a folder move starts at the top', async () => {
  const s = await boot();
  s.lib.open('agents');
  s.host.querySelector('.wfl-list').scrollTop = 40;
  s.lib.setData({ placedKinds: ['task'] });
  assert.equal(s.host.querySelector('.wfl-list').scrollTop, 40);
  click(folder(s.host, 'agents/coding'));
  assert.equal(s.host.querySelector('.wfl-list').scrollTop, 0);
});

test('open(tab) stays in a subfolder of that tab and moves to another tab\'s top; folderOf names where a row lives; a refresh that empties a folder shows its parent', async () => {
  const s = await boot();
  assert.equal(s.lib.tab(), 'home');
  s.lib.openFolder(['agents', 'coding']);
  s.lib.open('agents');
  assert.equal(s.host.dataset.path, 'agents/coding', 'a sheet closing to #workflows/agents keeps the folder');
  assert.deepEqual([s.lib.tab(), s.lib.path()], ['agents', ['agents', 'coding']]);
  s.lib.open('scripts');
  assert.equal(s.host.dataset.path, 'scripts');
  s.lib.open('nope');
  assert.equal(s.host.dataset.path, 'scripts', 'an unknown tab moves nothing');
  assert.deepEqual(s.lib.folderOf('agent', 'docsWriter'), ['agents', 'general']);
  assert.deepEqual(s.lib.folderOf('agent', 'clarify'), ['agents', 'coding'], 'a shared agent: the first domain folder listing it');
  assert.deepEqual(s.lib.folderOf('script', 'gitDiff'), ['scripts'], 'one group: the top folder');
  assert.deepEqual(s.lib.folderOf('workflow', 'wf_default'), ['workflows', 'coding']);
  assert.deepEqual(s.lib.folderOf('agent', 'nobody'), ['agents'], 'not listed (yet): its top folder');
  s.lib.openFolder(['workflows', 'general']);
  s.doc.getElementById('wfl-up').focus();
  s.lib.setData({ workflows: [WORKFLOWS[0], WORKFLOWS[1]] });       // wf_mine went: one domain is left
  assert.equal(s.host.dataset.path, 'workflows');
  assert.deepEqual(rowsOf(s.host), ['workflow:wf_default', 'workflow:wf_quick']);
  assert.equal(s.doc.activeElement.id, 'wfl-up', 'focus stays on the back row, never <body>');
});

test('a registry load error shows at Home too, with Retry, above the folders', async () => {
  let retried = 0;
  const s = await boot({ loadError: 'Couldn’t load agents — ', retry: () => { retried += 1; } });
  assert.equal(s.host.dataset.tab, 'home');
  assert.match(s.host.querySelector('.wfl-list').textContent, /Couldn’t load agents/);
  click([...s.host.querySelectorAll('.wfl-list button')].find((b) => b.textContent === 'Retry'));
  assert.equal(retried, 1);
  assert.equal(foldersOf(s.host).length, 3, 'the folders still list');
});

test('a placed Task / End: the focus its gone "+" or Add to canvas held goes to its row, else the back row — never <body>', async () => {
  const s = await boot({ placedKinds: ['task'] });
  s.lib.openFolder(['agents', FLOW]);
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
  assert.equal(s.doc.activeElement.id, 'wfl-up', 'the back row');
});

test('the Library card is 380px wide, a min(380px, 100% − 16px) overlay at <= 760px, and app.js keeps the canvas fit clear of it while a 200px band stays', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\n\.wfl\{flex:0 0 380px;width:380px;/);
  assert.match(css, /@media \(max-width:760px\)\{\.wfl\{position:absolute;top:8px;right:8px;bottom:8px;z-index:35;width:min\(380px,calc\(100% - 16px\)\);/);
  assert.match(css, /\n\.wfl\[data-open="false"\]\{width:0;flex-basis:0;/, 'the closed card still collapses');
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  assert.match(app, /insetRight: \(\) => \{\n\s+if \(!\(window\.innerWidth <= 760 && wfvLibrary && wfvLibrary\.isOpen\(\)\)\) return 0;\n[^\n]*\n\s+return stageW - 396 >= 200 \? 396 : 0;\n/);
});

test('roomy rows: 14px names, 12px second lines, 26px tiles, 14.5px folder rows with a 20px glyph; detail, port chips and actions a notch up', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const rule = (sel) => { const i = css.indexOf(`\n${sel}{`); assert.ok(i >= 0, `${sel} has a rule`); return css.slice(i + sel.length + 2, css.indexOf('}', i)); };
  assert.match(rule('.wfl-name'), /font-size:14px;/);
  assert.match(rule('.wfl-l2'), /font-size:12px;/);
  assert.match(rule('.wfl-ic'), /width:26px;height:26px;/);
  assert.match(rule('.wfl-main'), /padding:9px /);
  assert.match(rule('.wfl-folder,.wfl-up'), /min-height:44px;padding:10px;.*font:500 14\.5px/);
  assert.match(rule('.wfl-folder svg,.wfl-up svg'), /width:20px;height:20px;/);
  assert.match(rule('.wfl-detail'), /font-size:13px;/);
  assert.match(rule('.wfl-pchip'), /font:500 11\.5px/);
  assert.match(rule('.wfl-actions .wfv-btn'), /height:28px;.*font-size:12\.5px;/);
});

test('folder rows, the back row, the crumbs and the chips show the house focus ring; the tab, group-head and archived-chip rules are gone', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /:is\(\.wfl-folder,\.wfl-up,\.wfl-crumb\):focus-visible\{outline:2px solid var\(--ink\);outline-offset:-2px;\}/);
  assert.match(css, /\.wfl-chip:focus-visible\{outline:2px solid var\(--ink\);outline-offset:2px;\}/);
  assert.doesNotMatch(css, /\.wfl-(seg|tab|gh|gn|group|archived)\b/);
  const src = readFileSync(new URL('../ui/public/workflows/library.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /wfl-(seg|tab|gh|gn|group|archived)\b/);
});
