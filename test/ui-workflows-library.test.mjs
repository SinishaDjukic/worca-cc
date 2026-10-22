// test/ui-workflows-library.test.mjs — the Library card over plain data (no app.js): the Agents / Scripts / Workflows
// selector, folders that expand in place, the chips, the header search and its flat results, rows and their actions,
// highlight, focus.
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
const FLOW_ROWS = ['flow:task', 'flow:end', 'flow:and', 'flow:or', 'flow:combine'];

async function boot(data = {}, extra = {}) {
  const dom = new JSDOM('<!doctype html><body><aside id="lib"></aside></body>', { url: 'http://localhost:4317/' });
  const doc = dom.window.document;
  const { createLibrary } = await import(LIB_URL);
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  const actions = new Proxy({ portsFn: () => ({ inputs: [], outputs: [] }), ...extra }, { get: (t, k) => (k in t ? t[k] : rec(String(k))) });
  const lib = createLibrary({ doc, host: doc.getElementById('lib'), actions });
  lib.setData({ agents: AGENTS, scripts: SCRIPTS, workflows: WORKFLOWS, archived: [], placedKinds: ['task', 'end'], openId: 'wf_default', newIds: new Set(['wf_mine']), ...data });
  lib.setOpen(true);
  return { dom, win: dom.window, doc, lib, calls, host: doc.getElementById('lib') };
}
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const rowsOf = (host) => [...host.querySelectorAll('.wfl-item')].map((r) => r.dataset.item);
/** The selector's tabs as [data-tab, label, count, aria-selected]. */
const tabsOf = (host) => [...host.querySelectorAll('.wfl-seg .wfl-tab')].map((t) => [t.dataset.tab, t.querySelector('.wfl-tname').textContent, t.querySelector('.wfl-n').textContent, t.getAttribute('aria-selected')]);
/** The folder rows on screen as [data-folder, name, count, aria-expanded]. */
const foldersOf = (host) => [...host.querySelectorAll('.wfl-folder')].map((f) => [f.dataset.folder, f.querySelector('.wfl-fname').textContent, f.querySelector('.wfl-fn').textContent, f.getAttribute('aria-expanded')]);
const folder = (host, key) => [...host.querySelectorAll('.wfl-folder')].find((f) => f.dataset.folder === key);
const tagsOf = (host) => [...host.querySelectorAll('.wfl-item')].map((r) => (r.querySelector('.wfl-where') || { textContent: '' }).textContent);
const footOf = (host) => host.querySelector('.wfl-foot').textContent;
const searching = (host) => host.querySelector('.wfl-head').classList.contains('is-searching');
const type = (s, value) => {
  const f = s.doc.getElementById('wfl-filter');
  f.value = value;
  f.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  return f;
};

test('the selector switches Agents / Scripts / Workflows (registry counts); Agents splits by domain (shared folded in), Flow pinned last; a folder expands in place', async () => {
  const s = await boot();
  assert.equal(s.host.dataset.tab, 'agents', 'first open: Agents');
  assert.deepEqual(tabsOf(s.host), [['agents', 'Agents', '3', 'true'], ['scripts', 'Scripts', '2', 'false'], ['workflows', 'Workflows', '3', 'false']],
    'the counts leave out what the canvas cannot take (the built-in Scanner)');
  assert.equal(s.host.querySelector('.wfl-crumbs, .wfl-crumb, #wfl-up, #wfl-crumb-home'), null, 'no breadcrumb, no back row');
  assert.deepEqual(foldersOf(s.host), [['agents/coding', 'coding', '2', 'false'], ['agents/general', 'general', '2', 'false'], [`agents/${FLOW}`, 'Flow', '5', 'false']]);
  assert.deepEqual(rowsOf(s.host), [], 'folders start folded');
  assert.equal(footOf(s.host), '3 agents');
  click(folder(s.host, 'agents/coding'));
  assert.equal(s.host.dataset.tab, 'agents', 'a folder opens in place');
  assert.equal(folder(s.host, 'agents/coding').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(rowsOf(s.host), ['agent:clarify', 'agent:planner']);
  const fold = s.host.querySelector('.wfl-fold[data-fold="agents/coding"]');
  assert.equal(fold.previousElementSibling, folder(s.host, 'agents/coding'), 'its rows follow its row');
  assert.equal(fold.querySelectorAll('.wfl-item').length, 2);
  assert.deepEqual(foldersOf(s.host).map(([k]) => k), ['agents/coding', 'agents/general', `agents/${FLOW}`], 'the other folders stay');
  click(folder(s.host, `agents/${FLOW}`));
  assert.deepEqual(rowsOf(s.host), ['agent:clarify', 'agent:planner', ...FLOW_ROWS], 'several folders open at once');
  assert.equal(footOf(s.host), '3 agents', 'the count is the section, never the flow cards');
  click(folder(s.host, 'agents/coding'));
  assert.deepEqual(rowsOf(s.host), FLOW_ROWS, 'a second click folds it');
  click(s.doc.getElementById('wfl-tab-scripts'));
  assert.equal(s.host.dataset.tab, 'scripts');
  assert.deepEqual(tabsOf(s.host).map((t) => t[3]), ['false', 'true', 'false']);
  click(s.doc.getElementById('wfl-tab-agents'));
  assert.deepEqual(rowsOf(s.host), FLOW_ROWS, 'an open folder stays open across a section switch');
});

test('one group lists its rows directly: Scripts here, and a one-domain Workflows (Archived still pinned last)', async () => {
  const s = await boot({ workflows: [WORKFLOWS[0], WORKFLOWS[1]], archived: ARCH });
  s.lib.open('scripts');
  assert.deepEqual(foldersOf(s.host), []);
  assert.deepEqual(rowsOf(s.host), ['script:gitDiff', 'script:runTests']);
  assert.equal(footOf(s.host), '2 scripts');
  s.lib.open('workflows');
  assert.deepEqual(rowsOf(s.host), ['workflow:wf_default', 'workflow:wf_quick']);
  assert.deepEqual(foldersOf(s.host), [[`workflows/${ARCHIVED}`, 'Archived', '1', 'false']]);
  assert.equal(s.host.querySelector('.wfl-list').lastElementChild.dataset.folder, `workflows/${ARCHIVED}`, 'pinned last');
  assert.equal(footOf(s.host), '2 workflows');
});

test('Workflows: domain folders replace the domain chips; Archived (N) holds the archived rows, each deleted from its own button', async () => {
  const s = await boot({ archived: ARCH });
  s.lib.open('workflows');
  assert.equal(s.host.querySelector('[data-chip]'), null, 'no chips in Workflows');
  assert.deepEqual(foldersOf(s.host).map((f) => f.slice(0, 3)), [['workflows/coding', 'coding', '2'], ['workflows/general', 'general', '1'], [`workflows/${ARCHIVED}`, 'Archived', '1']]);
  click(folder(s.host, `workflows/${ARCHIVED}`));
  assert.deepEqual(rowsOf(s.host), ['archived:wf_gone']);
  assert.equal(s.host.querySelector('.wfl-wf'), null, 'an archived row is no workflow row (the tour\'s fallback target)');
  assert.equal(footOf(s.host), '3 workflows');
  click(s.host.querySelector('.wfl-item[data-item="archived:wf_gone"] .wfl-del'));
  assert.deepEqual(s.calls.at(-1), ['deleteArchived', ARCH[0]]);
  assert.deepEqual(workflowDomains([{ domain: 'shared' }, {}, { domain: 'zeta' }, { domain: 'alpha' }, { domain: 'general' }]),
    ['alpha', 'zeta', 'general', 'shared'], 'the old domain chips\' order');
});

test('All / Built-in / Yours narrow Agents and Scripts (a folder with nothing to show hides); the search narrows to matches', async () => {
  const s = await boot();
  click(s.host.querySelector('[data-chip="yours"]'));
  assert.deepEqual(foldersOf(s.host), [['agents/general', 'general', '1', 'false']], 'coding and Flow have nothing of yours');
  click(folder(s.host, 'agents/general'));
  assert.deepEqual(rowsOf(s.host), ['agent:docsWriter']);
  click(s.host.querySelector('[data-chip="all"]'));
  assert.deepEqual(rowsOf(s.host), ['agent:clarify', 'agent:docsWriter'], 'the open folder stays open');
  assert.equal(foldersOf(s.host).length, 3);
  click(s.doc.getElementById('wfl-filter-btn'));
  assert.equal(s.doc.getElementById('wfl-filter').placeholder, 'Search agents…');
  type(s, 'docs');
  assert.deepEqual(rowsOf(s.host), ['agent:docsWriter']);
  type(s, 'zzz');
  assert.equal(s.host.querySelector('.wfl-empty').textContent, 'No agents match “zzz”');
  s.lib.open('workflows');
  assert.equal(s.host.querySelector('[data-chip]'), null, 'no chips in Workflows');
});

test('a search lists every match in the selected section flat, each tagged with its subfolder; a section switch keeps the query', async () => {
  const s = await boot({ archived: ARCH });
  click(s.doc.getElementById('wfl-filter-btn'));
  type(s, 'plan');
  assert.deepEqual(rowsOf(s.host), ['agent:planner', 'agent:docsWriter']);
  assert.deepEqual(tagsOf(s.host), ['coding', 'general']);
  assert.deepEqual(foldersOf(s.host), [], 'one flat list: no folder rows');
  assert.equal(footOf(s.host), '2 agents');
  click(s.doc.getElementById('wfl-tab-scripts'));
  assert.equal(s.doc.getElementById('wfl-filter').value, 'plan', 'the query stays and searches Scripts now');
  assert.equal(s.doc.getElementById('wfl-filter').placeholder, 'Search scripts…');
  assert.equal(s.host.querySelector('.wfl-empty').textContent, 'No scripts match “plan”');
  type(s, 'git');
  assert.deepEqual(rowsOf(s.host), ['script:gitDiff']);
  assert.equal(s.host.querySelector('.wfl-where'), null, 'a row sitting in the section itself carries no tag');
  click(s.doc.getElementById('wfl-tab-workflows'));
  type(s, 'mine');
  assert.deepEqual([rowsOf(s.host), tagsOf(s.host)], [['workflow:wf_mine'], ['general']]);
  type(s, 'gone');
  assert.deepEqual([rowsOf(s.host), tagsOf(s.host)], [['archived:wf_gone'], ['Archived']]);
  click(s.doc.getElementById('wfl-tab-agents'));
  type(s, 'clarify');
  assert.deepEqual([rowsOf(s.host), tagsOf(s.host)], [['agent:clarify'], ['coding']], 'a shared agent shows once, at the first folder listing it');
  s.lib.openFolder(['agents', 'coding']);
  assert.equal(s.doc.getElementById('wfl-filter').value, '', 'openFolder clears the query: the folder shows');
  assert.deepEqual(rowsOf(s.host), ['agent:clarify', 'agent:planner']);
});

test('the search button grows a field over the title; an empty field folds back on it; ✕ closes an open search, else the Library', async () => {
  const s = await boot();
  const head = s.host.querySelector('.wfl-head');
  const btn = s.doc.getElementById('wfl-filter-btn');
  const x = s.doc.getElementById('wfl-close');
  const f = s.doc.getElementById('wfl-filter');
  assert.ok(head.contains(btn) && head.contains(f) && head.contains(x), 'the field lives on the header line');
  assert.equal(searching(s.host), false);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.ok(f.hasAttribute('inert'), 'the folded field takes no focus');
  assert.equal(x.getAttribute('aria-label'), 'Close library');
  click(btn);
  assert.equal(searching(s.host), true);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(f.hasAttribute('inert'), false);
  assert.equal(s.doc.activeElement, f, 'opening focuses the field');
  assert.equal(x.getAttribute('aria-label'), 'Close search');
  click(btn);
  assert.equal(searching(s.host), false, 'the search button folds an empty field');
  assert.equal(s.doc.activeElement, btn);
  click(btn);
  type(s, 'docs');
  click(btn);
  assert.equal(searching(s.host), true, 'a field with text stays open');
  assert.equal(s.doc.activeElement, f, '… and takes the focus');
  assert.deepEqual(rowsOf(s.host), ['agent:docsWriter']);
  click(x);
  assert.equal(searching(s.host), false, '✕ closes the open search');
  assert.equal(f.value, '', '… and clears it');
  assert.equal(foldersOf(s.host).length, 3, 'the folders are back');
  assert.equal(s.calls.some((c) => c[0] === 'closeLibrary'), false, 'the Library stays open');
  click(x);
  assert.deepEqual(s.calls.at(-1), ['closeLibrary'], 'a second ✕ closes the Library');
  s.lib.setData({ placedKinds: ['task'] });
  assert.equal(s.host.querySelector('.wfl-head'), head, 'the header survives a repaint, so its animation runs');
  assert.equal(s.host.firstElementChild, head);
});

test('a row drags {kind,key} as application/x-worca; "+" adds at the centre', async () => {
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
});

test('detail actions by origin: built-in View · Duplicate; user Edit · Delete', async () => {
  const s = await boot();
  s.lib.openFolder(['agents', 'coding']);
  click(s.host.querySelector('.wfl-item[data-item="agent:planner"] .wfl-main'));
  const d = s.host.querySelector('.wfl-item[data-item="agent:planner"] .wfl-detail');
  assert.match(d.textContent, /planner · producer: Writes the plan\./);
  assert.deepEqual([...d.querySelectorAll('.wfl-actions button')].map((b) => b.textContent), ['Add to canvas', 'View', 'Duplicate']);
  s.lib.openFolder(['agents', 'general']);
  click(s.host.querySelector('.wfl-item[data-item="agent:docsWriter"] .wfl-main'));
  const u = s.host.querySelector('.wfl-item[data-item="agent:docsWriter"] .wfl-detail');
  assert.deepEqual([...u.querySelectorAll('.wfl-actions button')].map((b) => b.textContent), ['Add to canvas', 'Edit', 'Delete']);
  click([...u.querySelectorAll('.wfl-actions button')].find((b) => b.textContent === 'Edit'));
  assert.deepEqual(s.calls.at(-1), ['editAgent', 'docsWriter']);
});

test('the "+" sits at the selector\'s right in Agents (New agent) and Scripts (New script); Workflows keeps an empty slot; Scripts rows keep their chips and actions', async () => {
  const s = await boot();
  const na = s.doc.getElementById('wfl-new-agent');
  assert.ok(na.closest('.wfl-bar'), 'in the selector bar');
  assert.equal(na.previousElementSibling.className, 'wfl-seg tabs');
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
  assert.equal(s.host.querySelector('button.wfl-new'), null, 'Workflows has no "+"');
  assert.ok(s.host.querySelector('.wfl-bar > span.wfl-new.is-slot[aria-hidden="true"]'), '… only its slot, so the selector keeps its width');
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

test('highlight selects the section AND opens the folder holding the row, closes the search, resets the chip, opens and flashes the row', async () => {
  const s = await boot();
  click(s.host.querySelector('[data-chip="yours"]'));
  click(s.doc.getElementById('wfl-filter-btn'));
  type(s, 'zzz');
  s.lib.highlight('agent', 'planner');
  assert.equal(s.host.dataset.tab, 'agents');
  assert.equal(folder(s.host, 'agents/coding').getAttribute('aria-expanded'), 'true');
  assert.equal(searching(s.host), false, 'the search closed');
  assert.equal(s.doc.getElementById('wfl-filter').value, '');
  assert.equal(s.host.querySelector('[data-chip="all"]').getAttribute('aria-pressed'), 'true');
  const planner = s.host.querySelector('.wfl-item[data-item="agent:planner"]');
  assert.ok(planner.classList.contains('is-flash') && planner.querySelector('.wfl-detail'));
  s.lib.highlight('script', 'runTests');
  assert.equal(s.host.dataset.tab, 'scripts', 'one group: the section itself');
  const item = s.host.querySelector('.wfl-item[data-item="script:runTests"]');
  assert.ok(item.classList.contains('is-flash'));
  assert.ok(item.querySelector('.wfl-detail'));
  s.lib.highlight('workflow', 'wf_mine');
  assert.equal(s.host.dataset.tab, 'workflows');
  assert.equal(folder(s.host, 'workflows/general').getAttribute('aria-expanded'), 'true');
  assert.ok(s.host.querySelector('.wfl-wf[data-id="wf_mine"]').classList.contains('is-flash'));
});

test('focus survives a row toggle and a folder toggle and is never looked up through a selector built from a key', async () => {
  const s = await boot();
  // Chrome throws on `#agent:planner` (an unknown pseudo-class); jsdom does not — emulate Chrome.
  const real = s.win.Element.prototype.querySelector;
  s.host.querySelector = function (sel) {
    if (/#[^\s\]]*:/.test(sel)) throw new s.win.DOMException(`'${sel}' is not a valid selector`, 'SyntaxError');
    return real.call(this, sel);
  };
  click(folder(s.host, 'agents/coding'));
  const main = real.call(s.host, '.wfl-item[data-item="agent:planner"] .wfl-main');
  main.focus();
  click(main);
  assert.equal(s.doc.activeElement.dataset.focusKey, 'agent:planner');
  folder(s.host, 'agents/coding').focus();
  click(folder(s.host, 'agents/coding'));
  assert.equal(s.doc.activeElement.dataset.focusKey, 'folder:agents/coding');
  assert.equal(s.doc.activeElement.getAttribute('aria-expanded'), 'false');
});

test('folders and the selector\'s tabs are real buttons: a folder keeps the focus as it opens and folds; arrows walk the tabs', async () => {
  const s = await boot();
  const coding = folder(s.host, 'agents/coding');
  assert.deepEqual([coding.tagName, coding.type], ['BUTTON', 'button']);
  coding.focus();
  click(coding);
  assert.equal(s.doc.activeElement.dataset.folder, 'agents/coding', 'focus stays on the folder that opened');
  assert.equal(s.doc.activeElement.getAttribute('aria-expanded'), 'true');
  const seg = s.host.querySelector('.wfl-seg');
  assert.equal(seg.getAttribute('role'), 'tablist');
  const agents = s.doc.getElementById('wfl-tab-agents');
  assert.deepEqual([agents.tagName, agents.type, agents.getAttribute('role'), agents.tabIndex], ['BUTTON', 'button', 'tab', 0]);
  assert.equal(s.doc.getElementById('wfl-tab-scripts').tabIndex, -1, 'one tab stop: the selected tab');
  const key = (k) => s.doc.activeElement.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  agents.focus();
  key('ArrowRight');
  assert.deepEqual([s.host.dataset.tab, s.doc.activeElement.id], ['scripts', 'wfl-tab-scripts']);
  key('ArrowLeft');
  key('ArrowLeft');
  assert.deepEqual([s.host.dataset.tab, s.doc.activeElement.id], ['workflows', 'wfl-tab-workflows'], 'wraps around');
});

test('a double-click on a folder row opens it once: its second press never reaches the repainted list', async () => {
  const s = await boot();
  // A real double-click: mousedown + click with detail 1, then again with detail 2 on whatever now sits under the pointer.
  const press = (el, detail) => {
    const down = new s.win.MouseEvent('mousedown', { bubbles: true, cancelable: true, detail });
    el.dispatchEvent(down);
    el.dispatchEvent(new s.win.MouseEvent('click', { bubbles: true, cancelable: true, detail }));
    return down;
  };
  const opened = () => s.calls.filter((c) => c[0] === 'openWorkflow').length;
  press(folder(s.host, 'agents/coding'), 1);
  assert.equal(press(folder(s.host, 'agents/coding'), 2).defaultPrevented, true, 'its mousedown moves no focus');
  assert.equal(folder(s.host, 'agents/coding').getAttribute('aria-expanded'), 'true', 'the second press never folds it back');
  s.lib.open('workflows');
  press(folder(s.host, 'workflows/coding'), 1);
  const down = press(s.host.querySelector('.wfl-wf[data-id="wf_default"] .wfl-main'), 2);
  assert.equal(opened(), 0, 'the second click never opens the workflow now under the pointer');
  assert.equal(down.defaultPrevented, true);
  click(folder(s.host, 'workflows/coding'));
  assert.equal(folder(s.host, 'workflows/coding').getAttribute('aria-expanded'), 'false', 'a keyboard activation (detail 0) right after a toggle still toggles');
  click(s.doc.getElementById('wfl-filter-btn'));
  press(folder(s.host, 'workflows/general'), 1);
  assert.equal(press(s.doc.getElementById('wfl-filter'), 2).defaultPrevented, false, 'a double-click in the search field still selects a word');
  s.lib.openFolder(['workflows', 'coding']);
  const now = Date.now;
  Date.now = () => now() + 1000;
  try { press(s.host.querySelector('.wfl-wf[data-id="wf_default"] .wfl-main'), 2); } finally { Date.now = now; }
  assert.equal(opened(), 1, 'a double-click well after the toggle acts as before');
});

test('built-in and plugin agents and scripts the canvas cannot take are not listed — folders, counts, search; the user\'s own stay, marked and never placeable', async () => {
  const WS = { key: 'workspaceReviewer', displayName: 'Workspace Reviewer', origin: 'builtin', domain: 'coding', scope: 'workspace-only', inputs: [], outputs: [] };
  const PLUG_AGENT = { key: 'mapper', displayName: 'Mapper', origin: 'plugin:demo', domain: 'mapping', placeable: false, inputs: [], outputs: [] };
  const MINE = { key: 'offline', displayName: 'Offline Reviewer', origin: 'user', domain: 'general', placeable: false, inputs: [], outputs: [] };
  const PLUG = { key: 'lint', displayName: 'Lint', runtime: 'python', origin: 'plugin:demo', caseCount: 2, inputs: [], outputs: [] };
  const HIDDEN_SCRIPT = { key: 'mapJoin', displayName: 'Map join', runtime: 'node', origin: 'builtin', domain: 'mapping', placeable: false, inputs: [], outputs: [] };
  const s = await boot({ agents: [...AGENTS, WS, PLUG_AGENT, MINE], scripts: [...SCRIPTS, PLUG, HIDDEN_SCRIPT], runtimes: { python: { ok: false } } });
  assert.deepEqual(tabsOf(s.host).map((t) => t[2]), ['4', '3', '3'], 'Agents: Plan, Clarify, Docs Writer and the user\'s Offline Reviewer; Scripts: no Map join');
  assert.deepEqual(foldersOf(s.host).map(([k]) => k), ['agents/coding', 'agents/general', `agents/${FLOW}`], 'a domain only unplaceable agents fill never shows');
  s.lib.openFolder(['agents', 'coding']);
  s.lib.openFolder(['agents', 'general']);
  assert.deepEqual(rowsOf(s.host), ['agent:clarify', 'agent:planner', 'agent:clarify', 'agent:docsWriter', 'agent:offline'], 'no Workspace Reviewer; the shared Clarify sits in both');
  const mine = s.host.querySelector('.wfl-item[data-item="agent:offline"]');
  assert.equal(mine.querySelector('.wfl-row').getAttribute('draggable'), 'false', 'the user\'s own unplaceable agent: listed so its sheet can switch it back on');
  assert.equal(mine.querySelector('.wfl-add'), null);
  assert.match(mine.textContent, /not placeable/);
  click(s.doc.getElementById('wfl-filter-btn'));
  type(s, 'workspace');
  assert.equal(s.host.querySelector('.wfl-empty').textContent, 'No agents match “workspace”', 'the search never finds a hidden one');
  type(s, '');
  s.lib.open('scripts');
  assert.deepEqual(foldersOf(s.host), [], 'Map join\'s domain never makes Scripts split');
  assert.deepEqual(rowsOf(s.host), ['script:gitDiff', 'script:lint', 'script:runTests']);
  const lint = s.host.querySelector('.wfl-item[data-item="script:lint"]');
  for (const chip of ['plugin:demo', '2 cases', 'python not found']) assert.match(lint.textContent, new RegExp(chip));
});

test('a chip click keeps focus on that chip (never <body>, where the canvas takes Delete); the chips sit under the selector, in Agents and Scripts only', async () => {
  const s = await boot();
  const chip = s.host.querySelector('[data-chip="yours"]');
  chip.focus();
  click(chip);
  assert.equal(s.doc.activeElement.dataset.chip, 'yours');
  s.lib.open('scripts');
  assert.deepEqual([...s.host.children].map((n) => n.className), ['wfl-head', 'wfl-bar', 'wfl-tools', 'wfl-list', 'wfl-foot']);
  s.lib.open('workflows');
  assert.deepEqual([...s.host.children].map((n) => n.className), ['wfl-head', 'wfl-bar', 'wfl-list', 'wfl-foot']);
});

test('typing in the search keeps the input and its caret, through a data refresh too; highlight moves to the folder holding the row', async () => {
  const s = await boot();
  click(s.doc.getElementById('wfl-filter-btn'));
  const f = s.doc.getElementById('wfl-filter');
  f.value = 'docs';
  f.setSelectionRange(2, 2);
  f.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  assert.equal(s.doc.getElementById('wfl-filter'), f, 'the input is not rebuilt');
  assert.equal(s.doc.activeElement, f);
  assert.equal(f.selectionStart, 2);
  assert.deepEqual(rowsOf(s.host), ['agent:docsWriter']);
  assert.equal(footOf(s.host), '1 agents');
  s.lib.setData({ placedKinds: ['task'] });
  assert.deepEqual([s.doc.getElementById('wfl-filter'), s.doc.activeElement, f.selectionStart], [f, f, 2], 'a refresh keeps the field, its focus and its caret');
  s.lib.highlight('agent', 'docsWriter');
  assert.equal(folder(s.host, 'agents/general').getAttribute('aria-expanded'), 'true');
  assert.ok(s.host.querySelector('.wfl-item[data-item="agent:docsWriter"].is-flash'));
  assert.equal(s.doc.activeElement, s.doc.getElementById('wfl-filter-btn'), 'the closed field hands its focus to the search button, never <body>');
});

test('Escape in the search clears it, then closes it, and never reaches the document', async () => {
  const s = await boot();
  click(s.doc.getElementById('wfl-filter-btn'));
  const f = s.doc.getElementById('wfl-filter');
  f.value = 'docs';
  f.dispatchEvent(new s.win.Event('input', { bubbles: true }));
  let reached = 0;
  s.doc.addEventListener('keydown', () => { reached += 1; });
  const esc = () => s.doc.activeElement.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  esc();
  assert.equal(f.value, '', 'the first Escape clears');
  assert.equal(searching(s.host), true, '… and keeps the search open');
  assert.ok(foldersOf(s.host).some(([k]) => k === 'agents/coding'), '… and the folders are back');
  esc();
  assert.equal(searching(s.host), false, 'the second Escape closes it');
  assert.equal(s.doc.activeElement.id, 'wfl-filter-btn');
  assert.equal(reached, 0, 'the canvas keyboard (a document listener) never sees either Escape');
});

test('a data refresh and a folder toggle keep the list where it was scrolled; a section switch starts at the top', async () => {
  const s = await boot();
  s.host.querySelector('.wfl-list').scrollTop = 40;
  s.lib.setData({ placedKinds: ['task'] });
  assert.equal(s.host.querySelector('.wfl-list').scrollTop, 40);
  click(folder(s.host, 'agents/coding'));
  assert.equal(s.host.querySelector('.wfl-list').scrollTop, 40);
  click(s.doc.getElementById('wfl-tab-scripts'));
  assert.equal(s.host.querySelector('.wfl-list').scrollTop, 0);
});

test('open(tab) and openFolder pick a section (an unknown one moves nothing); folderOf names where a row lives; a refresh that empties a folder keeps focus off <body>', async () => {
  const s = await boot();
  assert.equal(s.lib.tab(), 'agents');
  s.lib.openFolder(['agents', 'coding']);
  s.lib.open('agents');
  assert.equal(folder(s.host, 'agents/coding').getAttribute('aria-expanded'), 'true', 'a sheet closing to #workflows/agents keeps the open folder');
  s.lib.open('scripts');
  assert.equal(s.lib.tab(), 'scripts');
  s.lib.open('nope');
  s.lib.openFolder(['nope', 'x']);
  s.lib.openFolder([]);
  assert.equal(s.host.dataset.tab, 'scripts', 'an unknown section moves nothing');
  assert.deepEqual(s.lib.folderOf('agent', 'docsWriter'), ['agents', 'general']);
  assert.deepEqual(s.lib.folderOf('agent', 'clarify'), ['agents', 'coding'], 'a shared agent: the first domain folder listing it');
  assert.deepEqual(s.lib.folderOf('script', 'gitDiff'), ['scripts'], 'one group: the section itself');
  assert.deepEqual(s.lib.folderOf('workflow', 'wf_default'), ['workflows', 'coding']);
  assert.deepEqual(s.lib.folderOf('agent', 'nobody'), ['agents'], 'not listed (yet): its section');
  s.lib.openFolder(['workflows', 'general']);
  folder(s.host, 'workflows/general').focus();
  s.lib.setData({ workflows: [WORKFLOWS[0], WORKFLOWS[1]] });       // wf_mine went: one domain is left
  assert.deepEqual(foldersOf(s.host), []);
  assert.deepEqual(rowsOf(s.host), ['workflow:wf_default', 'workflow:wf_quick']);
  assert.equal(s.doc.activeElement.id, 'wfl-tab-workflows', 'focus falls to the selected tab, never <body>');
});

test('a registry load error shows with Retry, above the folders', async () => {
  let retried = 0;
  const s = await boot({ loadError: 'Couldn’t load agents — ', retry: () => { retried += 1; } });
  assert.match(s.host.querySelector('.wfl-list').textContent, /Couldn’t load agents/);
  click([...s.host.querySelectorAll('.wfl-list button')].find((b) => b.textContent === 'Retry'));
  assert.equal(retried, 1);
  assert.equal(foldersOf(s.host).length, 3, 'the folders still list');
});

test('a placed Task / End: the focus its gone "+" or Add to canvas held goes to its row, else the selected tab — never <body>', async () => {
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
  assert.equal(s.doc.activeElement.id, 'wfl-tab-agents', 'the selected tab');
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

test('roomy rows: 14px names, 12px second lines, 26px tiles, 32px folder rows (review A5) with a 24px glyph; detail, port chips and actions a notch up', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const rule = (sel) => { const i = css.indexOf(`\n${sel}{`); assert.ok(i >= 0, `${sel} has a rule`); return css.slice(i + sel.length + 2, css.indexOf('}', i)); };
  assert.match(rule('.wfl-name'), /font-size:13px;/);
  assert.match(rule('.wfl-l2'), /font-size:12px;/);
  assert.match(rule('.wfl-ic'), /width:26px;height:26px;/);
  assert.match(rule('.wfl-main'), /padding:9px /);
  assert.match(rule('.wfl-folder'), /min-height:32px;.*font:500 13px/);
  assert.match(rule('.wfl-folder svg'), /width:24px;height:24px;/);
  assert.match(rule('.wfl-detail'), /font-size:13px;/);
  assert.match(rule('.wfl-pchip'), /font:500 11px/);
  assert.equal(css.indexOf('.wfl-actions .wfv-btn'), -1, 'the actions are .btn .btn-sm (28px, 12px): no skin of their own');
  assert.match(rule('.btn-sm'), /height:28px;.*font-size:var\(--fs-meta\);/);
});

test('the search box slides over the title (reduced motion: at once); folders and tabs show the house focus ring; the breadcrumb and back-row rules are gone', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\n\.wfl-sbox\{position:absolute;[^}]*transition:left \.24s /);
  assert.match(css, /\n\.wfl-head\.is-searching \.wfl-sbox\{left:7px;\}/);
  assert.match(css, /\n\.wfl-filter-btn svg\{width:16px;height:16px;\}/, 'the search glyph matches the ✕ beside it');
  assert.match(css, /\n\.wfl-head\.is-searching \.wfl-title\{opacity:0;visibility:hidden;\}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.wfl-sbox,\.wfl-title,\.wfl-filter-input\{transition:none;\}\}/);
  assert.match(css, /\.wfl-tab:focus-visible\{outline:2px solid var\(--ink\);outline-offset:-2px;\}/);
  const lib = readFileSync(new URL('../ui/public/workflows/library.mjs', import.meta.url), 'utf8');
  assert.match(lib, /h\('button', 'filter-chip', t\)/, 'the All / Built-in / Yours chips are the shared .filter-chip');
  assert.doesNotMatch(css, /\.wfl-(crumbs?|trail|csep|up|search|gh|gn|group|archived)\b/);
  const src = readFileSync(new URL('../ui/public/workflows/library.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /wfl-(crumbs?|crumb-home|trail|csep|up|search|gh|gn|group|archived)\b/);
});

test('workflow row ⋯: Pin to Chat home / Unpin from Chat home calls togglePin with the row', async () => {
  const pinned = new Set(['wf_mine']);
  const s = await boot({}, { isPinned: (id) => pinned.has(id) });
  s.lib.openFolder(['workflows', 'general']);
  const more = s.host.querySelector('.wfl-wf[data-id="wf_mine"] .wfl-more');
  assert.ok(more.classList.contains('btn') && more.classList.contains('btn-icon'));
  assert.equal(more.getAttribute('aria-label'), 'More for "Mine"');
  click(more);
  const items = [...s.doc.querySelectorAll('.wfv-menu-item')];
  assert.deepEqual(items.map((b) => b.textContent), ['Unpin from Chat home']);
  click(items[0]);
  assert.equal(s.calls.at(-1)[0], 'togglePin');
  assert.equal(s.calls.at(-1)[1].id, 'wf_mine');
  assert.equal(s.doc.querySelector('.wfv-menu'), null, 'picking an item closes the menu');
  pinned.clear();
  click(more);   // reopen: the label follows the state at open time
  assert.deepEqual([...s.doc.querySelectorAll('.wfv-menu-item')].map((b) => b.textContent), ['Pin to Chat home']);
});
