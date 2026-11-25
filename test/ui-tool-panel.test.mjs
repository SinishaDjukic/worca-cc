// test/ui-tool-panel.test.mjs — the tool panel (issue 1064): the header icons, mixed tabs per scope, the divider, the +
// page, keys, the tab menu, Move to project, archiving, persistence, maximize, the narrow sheet and showSession.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createToolPanel } from '../ui/public/tool-panel.mjs';
import { createToolRegistry } from '../ui/public/tool-kinds.mjs';
import { createTabModel, viewKey, BLOCKED, TOOLS_KEY } from '../ui/public/tool-tabs.mjs';
import { readFileSync } from 'node:fs';

const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const RUN_A = { view: 'history-detail', pipelineId: 'aaaa1111', projectKey: 'app-0000aaaa' };
const RUN_B = { view: 'history-detail', pipelineId: 'bbbb2222', projectKey: 'app-0000aaaa' };
// Every booted panel is destroyed and its window closed after each test: a starting run's view re-follows on a 1.5 s
// window timer, and a timer left on a jsdom window keeps the file alive forever under npm test (no force-exit).
const booted = [];
afterEach(() => { for (const b of booted.splice(0)) { b.panel.destroy(); b.win.close(); } });

function fakeKind(kind, order, log, shortcut) {
  return { kind, label: kind[0].toUpperCase() + kind.slice(1), icon: 'none', order, shortcut,
    title: () => kind[0].toUpperCase() + kind.slice(1),
    mount: (tab, host) => { log.push(['mount', tab.id]); host.append(Object.assign(host.ownerDocument.createElement('button'), { className: `view-${kind}`, textContent: tab.id })); },
    unmount: (tab) => log.push(['unmount', tab.id]),
    close: async (tab) => { log.push(['close', tab.id]); return true; } };
}
/** A fake Overview controller (tool-overview.mjs's shape) that records what the panel asks of it. */
function fakeOverview() {
  const log = [];
  let key = null;
  return { log,
    mount: (host, view, { expand = null } = {}) => { key = viewKey(view); log.push(['mount', key, expand]); host.append(Object.assign(host.ownerDocument.createElement('button'), { className: 'ov-root', textContent: key })); },
    unmount: () => { if (key) log.push(['unmount', key]); key = null; },
    focus: (id = null) => log.push(['focus', id]),
    expand: (id) => log.push(['expand', id]),
    viewKey: () => key };
}
function boot({ ctx = RUN_A, storage = memStore(), sheet = false, suggest = null, mirror = null, overview = null, extra = [] } = {}) {
  const dom = new JSDOM('<!doctype html><body><div class="app"><div class="bar"><span class="tool-icons" data-tool-icons></span></div></div></body>', { url: 'http://localhost/' });
  const win = dom.window;
  win.matchMedia = () => ({ matches: sheet, addEventListener() {}, removeEventListener() {} });
  const env = { ctx };
  const log = [];
  const registry = createToolRegistry();
  registry.register(fakeKind('terminal', 10, log, { code: 'Backquote', key: '`', ctrl: true, label: 'Ctrl+`' }));
  registry.register(fakeKind('files', 30, log, { code: 'KeyE', key: 'E', ctrl: true, shift: true, label: 'Ctrl+Shift+E' }));
  registry.register({ ...fakeKind('changes', 40, log), strip: true });   // a stand-in kind with a header icon (the real Changes is turned off)
  for (const k of extra) registry.register(k(log));
  const model = createTabModel({ storage });
  const panel = createToolPanel({ doc: win.document, win, registry, model, getPageContext: () => env.ctx, suggest, mirror, overview });
  win.document.body.append(panel.root);
  panel.syncIcons();
  const doc = win.document;
  const go = async (ctx) => { env.ctx = ctx; panel.onContextChange(); await tick(); };
  const tabsText = () => [...doc.querySelectorAll('.tool-tabs > *')].map((n) => (n.classList.contains('tool-divider') ? '|' : n.querySelector('.tool-tab-text').textContent));
  const icon = (k) => doc.querySelector(`.tool-icon[data-tool-kind="${k}"]`);
  const key = (o) => doc.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...o }));
  const ovIcon = () => doc.querySelector('.tool-icon-overview');
  const b = { win, doc, panel, model, registry, log, env, go, tabsText, icon, key, storage, overview, ovIcon };
  booted.push(b);
  return b;
}
const OS_CHAT_A = { view: 'chat', chatId: 'ask_0000aaaa', chatProjectKey: 'app-0000aaaa' };
const OS_CHAT_B = { view: 'chat', chatId: 'ask_0000bbbb', chatProjectKey: 'app-0000aaaa' };
const OS_NEW_CHAT = { view: 'chat' };
const OS_PENDING = { view: 'running', runId: 'u-1', projectKey: 'app-0000aaaa' };
const OS_PROJECT = { view: 'project-detail', projectKey: 'app-0000aaaa' };
const shown = (b) => b.panel.isOpen() && !b.panel.root.hidden && b.doc.body.classList.contains('term-open');

test('the icon strip: a stand-in strip kind, then the three slots in order; Browser is disabled until it registers; a click opens a tab in the run', async () => {
  const b = boot();
  assert.deepEqual([...b.doc.querySelectorAll('.tool-icon')].map((x) => x.dataset.toolKind), ['changes', 'terminal', 'browser', 'files']);
  assert.equal(b.icon('browser').disabled, true);
  assert.match(b.icon('browser').title, /coming soon/);
  assert.match(b.icon('terminal').title, /Ctrl\+`/);
  b.icon('terminal').click();
  await tick();
  assert.equal(b.panel.isOpen(), true);
  assert.equal(b.doc.body.classList.contains('term-open'), true);
  assert.deepEqual(b.tabsText(), ['Terminal']);
  assert.equal(b.model.tabs()[0].scope.id, 'aaaa1111');
  assert.equal(b.icon('terminal').getAttribute('aria-pressed'), 'true');
});

test('click focuses the newest tab of its kind; Shift-click always opens another ("Terminal 2")', async () => {
  const b = boot();
  b.icon('terminal').click();
  await tick();
  b.icon('terminal').click();
  await tick();
  assert.equal(b.model.tabs().length, 1);
  b.icon('terminal').dispatchEvent(new b.win.MouseEvent('click', { bubbles: true, shiftKey: true }));
  await tick();
  assert.deepEqual(b.tabsText(), ['Terminal', 'Terminal 2']);
});

test('switching runs swaps only the run tabs: project tabs stay left of the divider; hidden tabs are unmounted, not closed', async () => {
  const b = boot();
  b.icon('terminal').click();
  await tick();
  const runTab = b.model.tabs()[0];
  b.panel.showKind('files');
  await tick();
  b.model.moveToProject(b.model.tabs()[1].id, 'app-0000aaaa');
  await b.go(RUN_A);
  await b.go({ ...RUN_A });          // a no-op route: nothing remounts
  await b.go(RUN_B);
  assert.deepEqual(b.tabsText(), ['Files']);
  assert.ok(b.log.some(([e, id]) => e === 'unmount' && id === runTab.id));
  assert.ok(!b.log.some(([e]) => e === 'close'));
  b.doc.querySelector('.tool-new').click();
  await tick();
  assert.match(b.doc.querySelector('.tool-newtab-hidden').textContent, /^1 tab in other chats and runs$/);
  b.icon('terminal').click();
  await tick();
  assert.deepEqual(b.tabsText(), ['Files', '|', 'Terminal']);
  await b.go(RUN_A);
  assert.deepEqual(b.tabsText(), ['Files', '|', 'Terminal']);
  assert.equal(b.model.visible({ project: 'app-0000aaaa', side: { type: 'run', id: 'aaaa1111' } }).side[0].id, runTab.id);
});

test('a chat with no project: icons are disabled with the reason; its own tabs (agent shells) still show', async () => {
  const b = boot({ ctx: { view: 'chat', chatId: 'ask_1' } });
  assert.equal(b.icon('files').disabled, true);
  assert.match(b.icon('files').title, /no project/);
  b.panel.syncSessions([{ id: 't-a', status: 'running', scope: 'project', projectKey: 'x-0000aaaa', createdBy: 'ask:ask_1', label: 'Ask · x', createdAt: '2026-01-01T00:00:00Z' }]);
  await b.panel.open();
  await tick();
  assert.deepEqual(b.tabsText(), ['Terminal']);
  assert.equal(b.icon('terminal').disabled, false, 'its newest terminal tab can still be focused');
});

test('keyboard: arrows move focus, Shift+Arrow reorders, Delete closes, Home/End jump', async () => {
  const b = boot();
  b.icon('terminal').click();
  await tick();
  b.panel.showKind('files');
  await tick();
  b.panel.showKind('changes');
  await tick();
  const tabs = () => [...b.doc.querySelectorAll('.tool-tab')];
  tabs()[0].focus();
  tabs()[0].dispatchEvent(new b.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(b.doc.activeElement, tabs()[1]);
  tabs()[1].dispatchEvent(new b.win.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(b.doc.activeElement, tabs()[2]);
  tabs()[2].dispatchEvent(new b.win.KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
  await tick();
  assert.deepEqual(b.tabsText(), ['Terminal', 'Changes', 'Files']);
  assert.equal(b.doc.activeElement.textContent, 'Changes');
  b.doc.activeElement.dispatchEvent(new b.win.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  await tick();
  assert.deepEqual(b.tabsText(), ['Terminal', 'Files']);
  assert.ok(b.log.some(([e]) => e === 'close'));
  assert.ok(b.doc.querySelector('.tool-tabs').contains(b.doc.activeElement), 'the focus stays in the strip');
});

test('the tab menu: Move to project keeps the tab beside every run of the project; Close closes', async () => {
  const b = boot();
  b.icon('files').click();
  await tick();
  b.doc.querySelector('.tool-tab').dispatchEvent(new b.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const items = [...b.doc.querySelectorAll('.wfv-menu [role="menuitem"]')];
  assert.deepEqual(items.map((i) => i.textContent.trim()).slice(0, 3), ['Move to project', 'Move left', 'Move right']);
  items[0].click();
  await tick();
  await b.go(RUN_B);
  assert.deepEqual(b.tabsText(), ['Files']);
  assert.equal(b.doc.querySelector('.tool-tab-item').classList.contains('is-project'), true);
});

test('closeScope (archiving) removes the run\'s tabs and unmounts the one on screen', async () => {
  const b = boot();
  b.icon('terminal').click();
  await tick();
  const id = b.model.tabs()[0].id;
  b.panel.closeScope({ type: 'run', id: 'aaaa1111' });
  await tick();
  assert.equal(b.model.tabs().length, 0);
  assert.ok(b.log.some(([e, t]) => e === 'unmount' && t === id));
  assert.ok(b.doc.querySelector('.tool-newtab'), 'the + page shows when nothing is left');
});

test('shortcuts: Ctrl+Shift+E opens Files; Ctrl+` opens a terminal, and hides the panel when a terminal is on screen', async () => {
  const b = boot();
  b.key({ key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true });
  await tick();
  assert.deepEqual(b.tabsText(), ['Files']);
  b.key({ key: '`', code: 'Backquote', ctrlKey: true });
  await tick();
  assert.deepEqual(b.tabsText(), ['Files', 'Terminal']);
  b.key({ key: '`', code: 'Backquote', ctrlKey: true });
  await tick();
  assert.equal(b.panel.isOpen(), false);
  assert.equal(b.doc.body.classList.contains('term-open'), false);
});

test('the + page lists every kind with its keys; Suggested stays hidden without suggestions; blocked views disable rows', async () => {
  const b = boot();
  await b.panel.open();
  await tick();
  const rows = [...b.doc.querySelectorAll('.tool-newtab-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.tool-newtab-label').textContent), ['Terminal', 'Files', 'Changes']);
  assert.deepEqual([...rows[1].querySelectorAll('kbd')].map((k) => k.textContent), ['Ctrl', 'Shift', 'E']);
  assert.equal(b.doc.querySelector('.tool-suggest'), null);
  rows[1].click();
  await tick();
  assert.deepEqual(b.tabsText(), ['Files']);
  await b.go({ view: 'running', runId: 'u-9' });
  b.doc.querySelector('.tool-new').click();
  await tick();
  assert.equal(b.doc.querySelector('.tool-newtab-row').disabled, true);
  assert.match(b.doc.querySelector('.tool-newtab-row').title, /starting/);
});

test('persistence: a reload restores the tabs, the active tab, open, width and maximize', async () => {
  const storage = memStore();
  const a = boot({ storage });
  a.icon('terminal').click();
  await tick();
  a.panel.showKind('files');
  await tick();
  a.doc.querySelector('.tool-max').click();
  const b = boot({ storage });
  await tick();
  assert.equal(b.panel.isOpen(), true);
  assert.deepEqual(b.tabsText(), ['Terminal', 'Files']);
  assert.equal(b.doc.querySelector('.tool-tab[aria-selected="true"]').textContent, 'Files');
  assert.equal(b.doc.body.classList.contains('tool-maxed'), true);
  assert.equal(b.doc.querySelector('.tool-max').getAttribute('aria-pressed'), 'true');
});

test('narrow screens: the open panel is a sheet and the page behind it is inert', async () => {
  const b = boot({ sheet: true });
  await b.panel.open();
  assert.equal(b.panel.root.classList.contains('is-sheet'), true);
  assert.equal(b.doc.querySelector('.app').hasAttribute('inert'), true);
  b.doc.querySelector('.term-hide').click();
  assert.equal(b.doc.querySelector('.app').hasAttribute('inert'), false);
});

test('showSession: a chat\'s shell shown beside another page as a guest tab, until the page changes', async () => {
  const b = boot();
  const s = { id: 't-g', status: 'running', scope: 'project', projectKey: 'x-0000aaaa', createdBy: 'ask:ask_7', label: 'Ask · x', createdAt: '2026-01-01T00:00:00Z' };
  b.panel.syncSessions([s]);
  assert.equal(await b.panel.showSession('t-g'), true);
  await tick();
  assert.deepEqual(b.tabsText(), ['Terminal']);
  assert.equal(await b.panel.showSession('t-none'), false);
  await b.go(RUN_B);
  assert.deepEqual(b.tabsText(), []);
});

test('a shell that ends keeps its tab while it is on screen (Enter starts a new one); an ended shell out of sight leaves', async () => {
  const b = boot();
  const s1 = { id: 't-1', status: 'running', scope: 'run', runId: 'aaaa1111', createdBy: 'local', label: 'Run', createdAt: '2026-01-01T00:00:01Z' };
  const s2 = { ...s1, id: 't-2', createdAt: '2026-01-01T00:00:02Z' };
  b.panel.syncSessions([s1, s2]);
  assert.equal(await b.panel.showSession('t-1'), true);
  await tick();
  b.panel.syncSessions([{ ...s1, status: 'exited' }, { ...s2, status: 'exited' }]);
  await tick();
  assert.deepEqual(b.model.tabs().map((t) => t.state.sessionId), ['t-1']);
});

test('a blocked view opens no tab: showKind answers null and the + page says why', async () => {
  const b = boot({ ctx: { view: 'running', runId: 'u-9', projectKey: 'app-0000aaaa' } });
  assert.equal(await b.panel.showKind('files'), null);
  await tick();
  assert.equal(b.model.tabs().length, 0);
  assert.match(b.doc.querySelector('.tool-newtab .tool-note').textContent, /starting/);
});

test('a kind that refuses to close (No in its confirm) keeps its tab', async () => {
  const b = boot();
  b.registry.register({ ...fakeKind('changes', 40, b.log), close: async () => false });
  await b.panel.showKind('changes');
  await tick();
  b.doc.querySelector('.tool-tab-close').click();
  await tick();
  assert.deepEqual(b.tabsText(), ['Changes']);
});

test('a page context that arrives late (the projects list answers after the route): the icon and Ctrl+` read it on use', async () => {
  const b = boot({ ctx: {} });
  b.env.ctx = { view: 'project-detail', projectKey: 'app-0000aaaa' };     // no hashchange, no onContextChange
  b.panel.toggleKind('terminal');
  await tick();
  assert.deepEqual(b.tabsText(), ['Terminal']);
  assert.deepEqual(b.model.tabs()[0].scope, { type: 'project', id: 'app-0000aaaa' });
  assert.equal(b.doc.querySelector('.tool-newtab'), null);
  // The header icon (showKind) reads it too.
  const c = boot({ ctx: {} });
  c.env.ctx = { view: 'project-detail', projectKey: 'app-0000aaaa' };
  c.icon('files').disabled = false;                        // the icon was drawn while the page had no context
  c.icon('files').click();
  await tick();
  assert.deepEqual(c.tabsText(), ['Files']);
  // Ctrl+` on the + page that said "open a run…": once the context is there it opens, it does not hide the panel.
  const d = boot({ ctx: {} });
  await d.panel.open();
  await tick();
  d.env.ctx = { view: 'project-detail', projectKey: 'app-0000aaaa' };
  d.key({ key: '`', code: 'Backquote', ctrlKey: true });
  await tick();
  assert.equal(d.panel.isOpen(), true);
  assert.deepEqual(d.tabsText(), ['Terminal']);
});

test('closing a background tab keeps the active tab on screen', async () => {
  const b = boot();
  b.icon('terminal').click();
  await tick();
  await b.panel.showKind('files');
  await b.panel.showKind('changes');
  await b.panel.showKind('terminal');
  await tick();
  const active = () => b.doc.querySelector('.tool-tab[aria-selected="true"]').textContent;
  assert.equal(active(), 'Terminal');
  const before = b.log.length;
  b.doc.querySelectorAll('.tool-tab-close')[2].click();
  await tick();
  assert.deepEqual(b.tabsText(), ['Terminal', 'Files']);
  assert.equal(active(), 'Terminal');
  assert.deepEqual(b.log.slice(before).filter(([e]) => e !== 'close'), [], 'the terminal stays mounted');
});

test('closing a background shell whose closed frame lands before the close answers keeps the active tab', async () => {
  const b = boot();
  const s = (n) => ({ id: `t-${n}`, status: 'running', scope: 'run', runId: 'aaaa1111', createdBy: 'local', label: 'Run', createdAt: `2026-01-01T00:00:0${n}Z` });
  b.registry.register({ ...fakeKind('terminal', 10, b.log), close: async () => { b.panel.syncSessions([s(1), s(3)]); return true; } });
  b.panel.syncSessions([s(1), s(2), s(3)]);
  assert.equal(await b.panel.showSession('t-3'), true);
  await tick();
  const id = (n) => b.model.tabs().find((t) => t.state.sessionId === `t-${n}`).id;
  const t3 = id(3);
  b.doc.querySelectorAll('.tool-tab-close')[1].click();
  await tick();
  assert.deepEqual(b.model.tabs().map((t) => t.state.sessionId), ['t-1', 't-3']);
  assert.equal(b.doc.querySelector('.tool-tab[aria-selected="true"]').closest('.tool-tab-item').dataset.tabId, t3);
});

test('openKind: a new tab holding its state in the view\'s scope, every time; an unknown kind opens nothing', async () => {
  const b = boot();
  const t = await b.panel.openKind('files', { path: 'src' });
  assert.deepEqual([t.scope.type, t.scope.id, t.state], ['run', 'aaaa1111', { path: 'src' }]);
  assert.equal(b.panel.isOpen(), true);
  assert.equal(b.doc.querySelector('.tool-tab[aria-selected="true"]').closest('.tool-tab-item').dataset.tabId, t.id);
  const t2 = await b.panel.openKind('files', { path: 'docs' });
  assert.notEqual(t2.id, t.id, 'never the newest tab of the kind: a new one');
  assert.deepEqual(b.tabsText(), ['Files', 'Files 2']);
  assert.equal(await b.panel.openKind('nope', {}), null);
});

test('openKind on a page about no run, chat or project: the given scope, shown as a guest; without one the + page says why', async () => {
  const b = boot({ ctx: { view: 'settings' } });
  assert.equal(await b.panel.openKind('files', { path: 'x' }), null);
  assert.equal(b.doc.querySelector('.tool-newtab .tool-note').textContent, 'Open a run, a chat or a project to use its tools.');
  const t = await b.panel.openKind('files', { path: 'x' }, { scope: { type: 'run', id: 'cccc3333', projectKey: 'app-0000aaaa' } });
  assert.deepEqual([t.scope.type, t.scope.id], ['run', 'cccc3333']);
  assert.deepEqual(b.tabsText(), ['Files'], 'the guest shows beside the (empty) view');
  await b.go(RUN_B);
  assert.deepEqual(b.tabsText(), [], 'a guest leaves with the page');
  const blocked = boot({ ctx: { view: 'chat', chatId: null } });
  const g = await blocked.panel.openKind('files', {}, { scope: { type: 'run', id: 'dddd4444' } });
  assert.equal(g.scope.id, 'dddd4444', 'a view that opens no tab (a new chat) uses the fallback too');
  const left = boot();   // a run page, then Settings: the run's view leaves with it, the tab goes to its own scope
  await left.go({ view: 'settings' });
  const s = await left.panel.openKind('files', {}, { scope: { type: 'run', id: 'eeee5555', projectKey: 'app-0000aaaa' } });
  assert.equal(s.scope.id, 'eeee5555', 'not the run the person looked at before Settings');
  assert.deepEqual(left.tabsText(), ['Files'], 'shown as a guest, alone');
  assert.equal(await left.panel.openKind('files', {}), null, 'with no scope of its own: nothing, not the run left behind');
  const own = boot();   // a run page of its own: the page's scope wins over the one the tab brings
  const o = await own.panel.openKind('files', {}, { scope: { type: 'run', id: 'eeee5555', projectKey: 'app-0000aaaa' } });
  assert.equal(o.scope.id, 'aaaa1111');
});

test('refreshNewPage: the + page draws its Suggested rows again, keeps the focused row, and leaves a tab on screen alone', async () => {
  const rows = [];
  const opened = [];
  const b = boot({ suggest: () => rows.map((label) => ({ label, open: () => opened.push(label) })) });
  await b.panel.open();
  assert.equal(b.doc.querySelector('.tool-suggest'), null);
  rows.push('Web :4417');
  b.panel.refreshNewPage();
  const row = () => [...b.doc.querySelectorAll('.tool-suggest .tool-newtab-row')].find((r) => r.textContent.includes('Web :4417'));
  assert.ok(row());
  row().focus();
  rows.push('API :4418');
  b.panel.refreshNewPage();
  assert.equal(b.doc.activeElement, row(), 'the same row keeps the focus');
  assert.equal(b.doc.querySelectorAll('.tool-suggest .tool-newtab-row').length, 2);
  row().click();
  assert.deepEqual(opened, ['Web :4417']);
  b.icon('files').click();
  await tick();
  rows.length = 0;
  b.panel.refreshNewPage();
  assert.ok(b.doc.querySelector('.view-files'), 'a mounted tab is not replaced by the + page');
});

test('a divider drag turns off framed pages under the pointer (style.css, pinned in ui-tool-browser), and any release or cancel ends it', () => {
  const b = boot();
  const res = b.doc.querySelector('.term-resize');
  for (const end of ['pointerup', 'pointercancel']) {
    res.dispatchEvent(new b.win.Event('pointerdown', { bubbles: true, cancelable: true }));
    assert.equal(b.doc.body.classList.contains('tool-resizing'), true, 'a Browser tab\'s iframe would take the moves and the release');
    b.doc.dispatchEvent(new b.win.Event(end, { bubbles: true }));
    assert.equal(b.doc.body.classList.contains('tool-resizing'), false, end);
  }
});

test('the assistant\'s tabs join when their chat comes into view, marked; an open panel shows the newest non-terminal one', async () => {
  const CHAT_CTX = { view: 'chat', chatId: 'ask_0000aaaa', chatProjectKey: 'app-0000aaaa' };
  let serve = [];
  const env = {};
  // pull answers a tick later, like the real GET: the panel's own redraw has run by then, so only pullView selects.
  const mirror = { pull: async (scope) => { await Promise.resolve(); return scope.type === 'chat' ? env.b.model.adopt(scope, serve.splice(0)) : []; }, schedule() {} };
  const b = (env.b = boot({ ctx: RUN_A, mirror }));
  b.icon('files').click();
  await tick();
  serve = [{ id: 'tab_srv1', kind: 'changes' }, { id: 'tab_srv2', kind: 'terminal' }];   // the terminal is newest and last
  b.model.setOpenAt('chat:ask_0000aaaa', true);   // the person left the panel open in that chat
  await b.go(CHAT_CTX);
  await tick();
  const items = [...b.doc.querySelectorAll('.tool-tab-item.is-assistant')];
  assert.deepEqual(items.map((n) => n.dataset.tabId), ['tab_srv1', 'tab_srv2']);
  assert.match(items[0].querySelector('.tool-tab').title, /opened by the assistant/);
  assert.equal(b.doc.querySelector('.tool-tab[aria-selected="true"]').closest('.tool-tab-item').dataset.tabId, 'tab_srv1', 'never the terminal');
  // Closing it hands over to no neighbour that would start a shell the user never picked (D9).
  b.doc.querySelector('.tool-tab-item[data-tab-id="tab_srv1"] .tool-tab-close').click();
  await tick();
  assert.ok(!b.log.some(([e, id]) => e === 'mount' && id === 'tab_srv2'), JSON.stringify(b.log));
  assert.deepEqual([...b.doc.querySelectorAll('.tool-tab-item')].map((n) => n.dataset.tabId), ['tab_srv2'], 'its tab stays in the strip');
});

// ── chat links (issue 1064 final slice): openIn / focusTab ─────────────────────────────────────────────────────
const CHAT_C = { type: 'chat', id: 'ask_0000c0c0' };
const CHAT_VIEW = { view: 'chat', threadId: 'ask_0000c0c0', projectKey: 'app-0000aaaa' };
const mounts = (b, id) => b.log.filter((e) => e[0] === 'mount' && (!id || e[1] === id)).length;
test('openIn: a matched Files tab takes the new line and is drawn again; the panel opens', async () => {
  const b = boot({ ctx: CHAT_VIEW });
  const match = (t) => t.state.file === 'src/a.js';
  const t1 = await b.panel.openIn('files', CHAT_C, { file: 'src/a.js', line: 5 }, { match });
  await tick();
  const t2 = await b.panel.openIn('files', CHAT_C, { file: 'src/a.js', line: 9 }, { match });
  await tick();
  assert.equal(t1.id, t2.id);
  assert.equal(b.model.tabs().length, 1);
  assert.equal(b.model.get(t1.id).state.line, 9);
  assert.equal(mounts(b, t1.id), 2);
  assert.equal(b.panel.isOpen(), true);
  assert.ok(b.doc.querySelector('.tool-tab-item[data-kind="files"]'));
});
test('openIn: a narrow page opens the sheet', async () => {
  const b = boot({ ctx: CHAT_VIEW, sheet: true });
  await b.panel.openIn('files', CHAT_C, { file: 'src/a.js' });
  await tick();
  assert.equal(b.panel.root.classList.contains('is-sheet'), true);
  assert.equal(b.panel.isOpen(), true);
});
test('openIn: a chat scope on a run view is a guest until the view changes', async () => {
  const b = boot();
  await b.panel.openIn('files', CHAT_C, { file: 'src/a.js' });
  await tick();
  assert.deepEqual(b.tabsText(), ['Files']);
  await b.go(RUN_B);
  assert.deepEqual(b.tabsText(), []);
});
test('openIn: a Browser tab on the same address is never mounted again; the 64-tab cap answers null with the note', async () => {
  const b = boot({ ctx: CHAT_VIEW });
  b.registry.register(fakeKind('browser', 20, b.log));
  const match = (t) => t.state.url === 'https://x.example/';
  const t = await b.panel.openIn('browser', CHAT_C, { url: 'https://x.example/' }, { match });
  await tick();
  await b.panel.openIn('browser', CHAT_C, { url: 'https://x.example/' }, { match });
  await tick();
  assert.equal(mounts(b, t.id), 1);
  await b.panel.focusTab(t.id, {});
  await tick();
  assert.equal(mounts(b, t.id), 1, 'a Browser focus frame does not reload');
  for (let i = b.model.tabs().length; i < 64; i++) b.model.open('files', CHAT_C, { file: `f${i}` });
  assert.equal(await b.panel.openIn('files', CHAT_C, { file: 'new.js' }), null);
  await tick();
  assert.match(b.panel.root.textContent, /Close a tab first/);
});
test('focusTab: closed panel = state only; open = active without taking the focus; show:false keeps the other tab', async () => {
  const b = boot({ ctx: CHAT_VIEW });
  const t = await b.panel.openIn('files', CHAT_C, { file: 'src/a.js', line: 1 });
  await tick();
  const other = await b.panel.openIn('files', CHAT_C, { file: 'src/b.js' });
  await tick();
  b.panel.hide();
  assert.equal(await b.panel.focusTab(t.id, { line: 4 }), true);
  assert.equal(b.panel.isOpen(), false);
  assert.equal(b.model.get(t.id).state.line, 4);
  await b.panel.open();
  await tick();
  const outside = b.doc.createElement('input'); b.doc.body.append(outside); outside.focus();
  await b.panel.focusTab(t.id, { line: 5 });
  await tick();
  assert.equal(b.doc.querySelector('.tool-tab[aria-selected="true"]').closest('.tool-tab-item').dataset.tabId, t.id);
  assert.equal(b.doc.activeElement, outside);
  await b.panel.focusTab(other.id, {});   // other active
  await tick();
  await b.panel.focusTab(t.id, { line: 7 }, { show: false });
  await tick();
  assert.equal(b.doc.querySelector('.tool-tab[aria-selected="true"]').closest('.tool-tab-item').dataset.tabId, other.id);
  assert.equal(b.model.get(t.id).state.line, 7);
  assert.equal(await b.panel.focusTab('tab_nope', {}), false);
});

// ── open per scope: the panel starts closed and opens only for the person ──────────────────────────────────────
test('first boot: no saved state starts closed; the old terminal pane\'s open flag is ignored, its width carries over', async () => {
  for (const ctx of [RUN_A, OS_CHAT_A, OS_PROJECT]) {
    const b = boot({ ctx });
    await tick();
    assert.equal(shown(b), false, JSON.stringify(ctx));
  }
  const legacy = memStore();
  legacy.setItem('worca-cc.terminal.open', '1');
  legacy.setItem('worca-cc.terminal.width', '520');
  const b = boot({ ctx: OS_CHAT_A, storage: legacy });
  await tick();
  assert.equal(shown(b), false);
  assert.equal(b.doc.body.style.getPropertyValue('--term-w'), '520px');
});

test('per scope: a new chat starts closed after the panel was open in another chat; a chat never opened too; back in the first chat it opens again; hidden stays hidden', async () => {
  const b = boot({ ctx: OS_CHAT_A });
  b.icon('files').click();
  await tick();
  assert.equal(shown(b), true);
  const tab = b.model.tabs()[0];
  await b.go(OS_NEW_CHAT);
  assert.equal(shown(b), false, 'a new chat');
  await b.go(OS_CHAT_B);
  assert.equal(shown(b), false, 'a chat never opened');
  await b.go(OS_CHAT_A);
  assert.equal(shown(b), true, 'the chat it was left open in');
  assert.equal(b.log.filter(([e, id]) => e === 'mount' && id === tab.id).length, 2, 'its tab is on screen again');
  b.panel.hide();
  await b.go(OS_CHAT_B);
  await b.go(OS_CHAT_A);
  assert.equal(shown(b), false, 'closed in A stays closed in A');
});

test('a page about no run, chat or project (Runs list, Workflows, Settings) has no tool icons: the panel steps aside there, its tabs kept, and opens again back in the chat', async () => {
  const b = boot({ ctx: OS_CHAT_A });
  b.icon('files').click();
  await tick();
  assert.equal(shown(b), true);
  const tab = b.model.tabs()[0];
  await b.go({ view: 'runs' });
  assert.equal(shown(b), false, 'the Runs list: no panel');
  assert.deepEqual(b.tabsText(), [], 'the chat\'s tabs are not drawn beside another page');
  assert.equal(b.log.at(-1)?.[0], 'unmount', 'its tab is unmounted, not closed');
  assert.ok(b.model.get(tab.id), 'the tab stays');
  await b.go({ view: 'settings' });
  assert.equal(shown(b), false);
  await b.go(OS_CHAT_A);
  assert.equal(shown(b), true, 'back in the chat it was left open in');
  assert.deepEqual(b.tabsText(), ['Files']);
  const reload = boot({ ctx: OS_CHAT_A, storage: b.storage });
  await tick();
  assert.equal(shown(reload), true, 'stepping aside saved nothing: a reload in the chat opens it');
  const guest = boot({ ctx: { view: 'settings' } });   // a page's own action (an Actions service) still opens it there
  await guest.panel.openKind('files', { path: 'x' }, { scope: { type: 'run', id: 'cccc3333', projectKey: 'app-0000aaaa' } });
  await guest.go({ view: 'settings' });
  assert.equal(shown(guest), true, 'a guest opened on the page stays while the page does');
});

test('a reload opens the panel only in the scope it was left open in', async () => {
  const storage = memStore();
  const a = boot({ ctx: OS_CHAT_A, storage });
  a.icon('files').click();
  await tick();
  assert.equal(shown(boot({ ctx: OS_CHAT_A, storage })), true);
  const other = boot({ ctx: OS_CHAT_B, storage });
  await tick();
  assert.equal(shown(other), false);
});

test('a new chat that gets its id (first message) keeps the panel as it was; without that hint the id is a scope of its own', async () => {
  for (const [hint, want] of [[{ created: 'ask_0000cccc' }, true], [{ created: 'ask_0000dddd' }, false], [undefined, false]]) {
    const b = boot({ ctx: OS_NEW_CHAT });
    b.key({ code: 'KeyE', key: 'E', ctrlKey: true, shiftKey: true });   // the person opens it (the + page: a new chat opens no tab)
    await tick();
    assert.equal(shown(b), true);
    b.env.ctx = { view: 'chat', chatId: 'ask_0000cccc', chatProjectKey: 'app-0000aaaa' };
    b.panel.onContextChange(hint);
    await tick();
    assert.equal(shown(b), want, JSON.stringify(hint));
    assert.equal(b.model.isOpenAt('chat:ask_0000cccc'), want);
    if (hint?.created !== 'ask_0000dddd') continue;
    // The hint named another chat: it is spent, not kept for later. The person opens the panel here; the chat it named starts closed.
    b.key({ code: 'KeyE', key: 'E', ctrlKey: true, shiftKey: true });
    await tick();
    assert.equal(shown(b), true);
    await b.go({ view: 'chat', chatId: 'ask_0000dddd', chatProjectKey: 'app-0000aaaa' });
    assert.equal(shown(b), false, 'a spent hint carries nothing');
  }
});

test('a starting run keeps the panel as the person left it when its pipeline id lands; another run does not inherit it', async () => {
  const other = { view: 'running', runId: 'u-9', pipelineId: 'dddd4444', projectKey: 'app-0000aaaa' };
  for (const [next, want] of [[{ ...OS_PENDING, pipelineId: 'cccc3333' }, true], [other, false]]) {
    const b = boot({ ctx: OS_PENDING });
    b.doc.querySelector('.tool-new').click();             // the + button: opens without re-reading the page (the boot's run id)
    await tick();
    assert.equal(shown(b), true);
    await b.go(next);
    assert.equal(shown(b), want, next.runId);
    assert.equal(b.model.isOpenAt(`run:${next.pipelineId}`), want);
  }
});

test('a project page keeps its own state across a reload; a starting run of that project never takes it', async () => {
  const storage = memStore();
  const p = boot({ ctx: OS_PROJECT, storage });
  p.icon('files').click();
  await tick();
  assert.equal(shown(p), true);
  const again = boot({ ctx: OS_PROJECT, storage });
  await tick();
  assert.equal(shown(again), true);
  const pending = boot({ ctx: OS_PENDING, storage });
  await tick();
  assert.equal(shown(pending), false);
});

function markRig(ctx = OS_CHAT_A) {
  let serve = [];
  const env = {};
  // pull answers a tick later, like the real GET
  const mirror = { pull: async (scope) => { await Promise.resolve(); return env.b.model.adopt(scope, serve.splice(0)); }, schedule() {} };
  const b = (env.b = boot({ ctx, mirror }));
  return { b, serve: (list) => { serve = list; } };
}

test('an assistant\'s tab arriving while the panel is closed: it stays closed; the strip marks it; its kind\'s icon (and the opener, for a terminal) gets a dot until the person opens the panel', async () => {
  const { b, serve } = markRig();
  const opener = b.doc.createElement('button');
  opener.className = 'term-opener';
  b.doc.body.append(opener);
  await tick();
  serve([{ id: 'tab_srv1', kind: 'changes' }, { id: 'tab_srv2', kind: 'terminal' }]);
  await b.panel.pullMirror();
  await tick();
  assert.equal(shown(b), false);
  assert.deepEqual([...b.doc.querySelectorAll('.tool-tab-item.is-assistant')].map((n) => n.dataset.tabId), ['tab_srv1', 'tab_srv2']);
  assert.equal(b.icon('changes').classList.contains('has-dot'), true);
  assert.equal(b.icon('changes').getAttribute('aria-description'), 'New tab from the assistant');
  assert.match(b.icon('changes').title, /new tab from the assistant/);
  assert.equal(b.icon('files').classList.contains('has-dot'), false);
  assert.equal(opener.classList.contains('has-dot'), true, 'a terminal tab: the project page\'s opener too');
  b.icon('changes').click();
  await tick();
  assert.equal(shown(b), true);
  assert.equal(b.doc.querySelector('.tool-tab[aria-selected="true"]').closest('.tool-tab-item').dataset.tabId, 'tab_srv1');
  assert.equal(b.doc.querySelectorAll('.has-dot').length, 0, 'opening the panel clears every mark in view');
  assert.equal(b.icon('changes').hasAttribute('aria-description'), false);
});

test('an assistant\'s tab arriving while the panel is open: no dot (the strip is on screen); the newest non-terminal one shows', async () => {
  const { b, serve } = markRig();
  b.icon('files').click();
  await tick();
  serve([{ id: 'tab_srv3', kind: 'changes' }]);
  await b.panel.pullMirror();
  await tick();
  assert.equal(b.icon('changes').classList.contains('has-dot'), false);
  assert.equal(b.doc.querySelector('.tool-tab[aria-selected="true"]').closest('.tool-tab-item').dataset.tabId, 'tab_srv3');
  serve([{ id: 'tab_srv5', kind: 'terminal' }]);           // a Terminal tab never comes forward on its own: still no dot
  await b.panel.pullMirror();
  await tick();
  assert.equal(b.icon('terminal').classList.contains('has-dot'), false);
});

test('open_tab on a tab the chat already has, panel closed: it stays closed and the tab\'s kind gets the dot', async () => {
  const b = boot({ ctx: OS_CHAT_A });
  b.icon('files').click();
  await tick();
  const t = b.model.tabs()[0];
  b.panel.hide();
  assert.equal(await b.panel.focusTab(t.id, { line: 3 }), true);
  await tick();
  assert.equal(shown(b), false);
  assert.equal(b.icon('files').classList.contains('has-dot'), true);
});

test('the side column\'s chat: its assistant tab arriving off screen is marked once that chat is in view', async () => {
  const { b, serve } = markRig(RUN_A);
  await tick();                                            // the boot pull of the run page has answered
  serve([{ id: 'tab_srv4', kind: 'changes' }]);
  await b.panel.pullChat('ask_0000aaaa');
  await tick();
  assert.equal(b.icon('changes').classList.contains('has-dot'), false, 'not this page\'s tab');
  await b.go(OS_CHAT_A);
  assert.equal(shown(b), false);
  assert.equal(b.icon('changes').classList.contains('has-dot'), true);
});

test('the dot rule: terminal-pane.css draws it on a marked icon and opener with a colour token', () => {
  const css = readFileSync(new URL('../ui/public/terminal/terminal-pane.css', import.meta.url), 'utf8');
  assert.match(css, /\.tool-icon\.has-dot,\.term-opener\.has-dot\{position:relative;\}/);
  assert.match(css, /\.tool-icon\.has-dot::after,\.term-opener\.has-dot::after\{content:"";[^}]*border-radius:50%;[^}]*background:var\(--blue-ink-strong\);/);
});

// ── the Overview (the no-tab view) ────────────────────────────────────────────────────────────────────
const OS_NOPROJ = { view: 'chat', chatId: 'ask_0000cccc' };
const mounted = (b) => b.overview.viewKey();
const kindOf = (b) => b.panel.root.querySelector('.tool-body').dataset.kind;

test('overview icon first only with overview: no tool kind, labelled Overview', () => {
  const b = boot({ overview: fakeOverview() });
  const first = b.doc.querySelector('[data-tool-icons]').firstElementChild;
  assert.ok(first.classList.contains('tool-icon-overview'));
  assert.equal(first.dataset.toolView, 'overview');
  assert.equal(first.getAttribute('aria-label'), 'Overview');
  assert.equal(first.dataset.toolKind, undefined, 'the kind click delegate ignores it');
  assert.ok(first.querySelector('svg'));
  assert.equal(first.disabled, false);
  assert.equal(first.title, 'Overview');
  assert.deepEqual([...b.doc.querySelectorAll('.tool-icon[data-tool-kind]')].map((x) => x.dataset.toolKind), ['changes', 'terminal', 'browser', 'files']);
  const plain = boot();
  assert.equal(plain.ovIcon(), null);
});

test('no tab → overview mounted; the + page still opens Open a tool', async () => {
  const b = boot({ overview: fakeOverview() });
  await b.panel.open();
  assert.equal(mounted(b), viewKey({ project: 'app-0000aaaa', side: { type: 'run', id: 'aaaa1111', projectKey: 'app-0000aaaa' } }));
  assert.equal(kindOf(b), 'overview');
  assert.equal(b.panel.root.querySelector('.tool-newtab'), null);
  assert.equal(b.ovIcon().getAttribute('aria-pressed'), 'true');
  await b.panel.open();
  assert.equal(b.overview.log.filter(([e]) => e === 'mount').length, 1, 'a second show keeps the mounted Overview');
  b.doc.querySelector('.tool-new').click();
  await tick();
  assert.ok(b.panel.root.querySelector('.tool-newtab'), 'the + page');
  assert.equal(kindOf(b), 'new');
  assert.equal(mounted(b), null, 'the Overview let go');
  assert.equal(b.ovIcon().getAttribute('aria-pressed'), 'false');
  b.panel.refreshNewPage();
  b.ovIcon().click();
  await tick();
  assert.equal(kindOf(b), 'overview');
  b.panel.refreshNewPage();
  assert.equal(kindOf(b), 'overview', 'a Suggested refresh never draws the + page over the Overview');
});

test('icon returns from a tab; the choice survives a re-boot', async () => {
  const storage = memStore();
  const b = boot({ overview: fakeOverview(), storage });
  b.icon('terminal').click();
  await tick();
  const t = b.model.tabs()[0];
  assert.equal(kindOf(b), 'terminal');
  assert.equal(b.ovIcon().getAttribute('aria-pressed'), 'false');
  b.ovIcon().click();
  await tick();
  assert.equal(kindOf(b), 'overview');
  assert.ok(b.log.some(([e, id]) => e === 'unmount' && id === t.id), 'the tab is unmounted, not closed');
  assert.equal(b.model.tabs().length, 1);
  assert.equal(b.icon('terminal').getAttribute('aria-pressed'), 'false');
  assert.equal(b.ovIcon().getAttribute('aria-pressed'), 'true');
  assert.deepEqual(b.overview.log.filter(([e]) => e === 'focus'), [['focus', null]], 'the focus moves into the Overview');
  const again = boot({ overview: fakeOverview(), storage });
  await tick();
  assert.equal(again.panel.isOpen(), true, 'it was left open here');
  assert.equal(kindOf(again), 'overview', 'no tab selected survives the reload');
  b.panel.root.querySelector('.tool-tab').click();
  await tick();
  assert.equal(kindOf(b), 'terminal', 'a tab click leaves the Overview');
  assert.equal(mounted(b), null);
});

test('closing the last tab → overview', async () => {
  const b = boot({ overview: fakeOverview() });
  b.icon('terminal').click();
  await tick();
  await b.panel.root.querySelector('.tool-tab-close').click();
  await tick();
  assert.equal(b.model.tabs().length, 0);
  assert.equal(kindOf(b), 'overview');
  assert.ok(mounted(b));
});

test('new chat or a starting run: icon disabled with the blocked title, the no-tab view is the + page with its reason', async () => {
  const b = boot({ ctx: OS_NEW_CHAT, overview: fakeOverview() });
  assert.equal(b.ovIcon().disabled, true);
  assert.equal(b.ovIcon().title, `Overview: ${BLOCKED.newChatNoProject}`);
  assert.equal(b.panel.showOverview(), false);
  assert.equal(b.panel.isOpen(), false, 'a refusal opens nothing');
  await b.panel.showKind('files');
  await tick();
  assert.ok(b.panel.root.querySelector('.tool-newtab'));
  assert.match(b.panel.root.querySelector('.tool-note').textContent, /first message/);
  assert.equal(mounted(b), null);
  await b.go(OS_PENDING);
  assert.equal(b.ovIcon().disabled, true);
  assert.equal(b.ovIcon().title, `Overview: ${BLOCKED.pending}`);
  await b.go({ view: 'settings' });
  const none = boot({ ctx: { view: 'settings' }, overview: fakeOverview() });
  assert.equal(none.ovIcon().title, 'Overview: Open a run, a chat or a project to see its overview.');
});

test('no-project chat: overview enabled, tools disabled; a project page has one too', async () => {
  const b = boot({ ctx: OS_NOPROJ, overview: fakeOverview() });
  assert.equal(b.ovIcon().disabled, false);
  assert.equal(b.icon('terminal').disabled, true);
  assert.equal(b.icon('files').disabled, true);
  assert.equal(b.panel.showOverview({ scope: { type: 'chat', id: 'ask_0000cccc' } }), true);
  await tick();
  assert.equal(kindOf(b), 'overview');
  await b.panel.showKind('files');
  assert.equal(b.model.tabs().length, 0, 'openNew still refuses');
  const p = boot({ ctx: OS_PROJECT, overview: fakeOverview() });
  assert.equal(p.ovIcon().disabled, false);
  assert.equal(p.panel.showOverview(), true);
  await tick();
  assert.equal(mounted(p), 'app-0000aaaa|');
});

test('showOverview other scope → false, model untouched', async () => {
  const storage = memStore();
  const b = boot({ ctx: OS_CHAT_A, overview: fakeOverview(), storage });
  b.icon('files').click();
  await tick();
  const t = b.model.tabs()[0];
  const saved = storage.getItem(TOOLS_KEY);
  assert.equal(b.panel.showOverview({ scope: { type: 'chat', id: 'ask_0000bbbb' }, expand: 'context' }), false);
  await tick();
  assert.equal(storage.getItem(TOOLS_KEY), saved, 'nothing saved');
  assert.equal(b.model.active(b.panel.view()).id, t.id);
  assert.equal(kindOf(b), 'files');
  b.panel.hide();
  assert.equal(b.panel.showOverview({ scope: { type: 'chat', id: 'ask_0000bbbb' } }), false);
  assert.equal(b.panel.isOpen(), false, 'still closed');
  assert.equal(b.panel.showOverview({ scope: { type: 'chat', id: 'ask_0000aaaa' } }), true);
  await tick();
  assert.equal(b.model.active(b.panel.view()), null, 'the tab is deselected');
  assert.equal(kindOf(b), 'overview');
});

test('expand forwarded: to the mount, then to the mounted Overview; the focus goes to that section', async () => {
  const b = boot({ ctx: OS_CHAT_A, overview: fakeOverview() });
  const scope = { type: 'chat', id: 'ask_0000aaaa' };
  assert.equal(b.panel.showOverview({ scope, expand: 'context' }), true);
  await tick();
  assert.deepEqual(b.overview.log.filter(([e]) => e === 'mount').map((x) => x[2]), ['context']);
  assert.deepEqual(b.overview.log.at(-1), ['focus', 'context']);
  assert.equal(b.panel.showOverview({ scope, expand: 'context' }), true);
  await tick();
  assert.ok(b.overview.log.some(([e, id]) => e === 'expand' && id === 'context'), 'already mounted: expand()');
  assert.equal(b.overview.log.filter(([e]) => e === 'mount').length, 1);
});

test('view change resets the + page: the next scope shows its Overview', async () => {
  const b = boot({ overview: fakeOverview() });
  await b.go(RUN_B);
  await b.panel.open();
  await b.go(RUN_A);
  await b.panel.open();
  b.doc.querySelector('.tool-new').click();
  await tick();
  assert.equal(kindOf(b), 'new');
  await b.go(RUN_B);
  assert.equal(b.panel.isOpen(), true);
  assert.equal(kindOf(b), 'overview');
  await b.go(RUN_A);
  assert.equal(kindOf(b), 'overview', 'the + page was a one-off');
});

test('hide unmounts the overview', async () => {
  const b = boot({ overview: fakeOverview() });
  await b.panel.open();
  assert.ok(mounted(b));
  b.panel.hide();
  assert.equal(mounted(b), null);
});

// ── the Overview: branches the first rows left unpinned (review M7) ───────────────────────────────────────
test('the Overview icon drops a guest tab: the Overview shows in its place', async () => {
  const b = boot({ overview: fakeOverview() });
  const s = { id: 't-g', status: 'running', scope: 'project', projectKey: 'x-0000aaaa', createdBy: 'ask:ask_7', label: 'Ask · x', createdAt: '2026-01-01T00:00:00Z' };
  b.panel.syncSessions([s]);
  assert.equal(await b.panel.showSession('t-g'), true);
  await tick();
  assert.deepEqual(b.tabsText(), ['Terminal'], 'the guest is on screen');
  assert.equal(kindOf(b), 'terminal');
  b.ovIcon().click();
  await tick();
  assert.equal(kindOf(b), 'overview', 'the guest is not selected any more');
  assert.deepEqual(b.tabsText(), [], 'it left the strip');
  assert.ok(mounted(b));
  assert.equal(b.ovIcon().getAttribute('aria-pressed'), 'true');
});

test('showOverview reads the page first: a route that changed this tick (onContextChange still deferred) is the view it checks', async () => {
  const b = boot({ ctx: OS_CHAT_A, overview: fakeOverview() });
  b.env.ctx = OS_CHAT_B;
  b.panel.onContextChange();   // follows on a 0 ms timer: not yet
  assert.equal(b.panel.showOverview({ scope: { type: 'chat', id: 'ask_0000bbbb' } }), true, 'the new chat is the one on screen');
  await tick();
  assert.equal(kindOf(b), 'overview');
  assert.equal(mounted(b), viewKey({ project: 'app-0000aaaa', side: { type: 'chat', id: 'ask_0000bbbb', projectKey: 'app-0000aaaa' } }));
  const n = boot({ ctx: OS_CHAT_A, overview: fakeOverview() });
  n.env.ctx = OS_NEW_CHAT;
  n.panel.onContextChange();
  assert.equal(n.panel.showOverview(), false, 'a new chat has no Overview, even before the deferred follow');
  assert.equal(n.panel.isOpen(), false);
});

test('a page with no Overview: a guest opened and closed leaves the disabled Overview icon unpressed', async () => {
  const b = boot({ ctx: { view: 'settings' }, overview: fakeOverview() });
  assert.equal(b.ovIcon().disabled, true);
  const t = await b.panel.openKind('files', { path: 'x' }, { scope: { type: 'run', id: 'cccc3333', projectKey: 'app-0000aaaa' } });
  assert.ok(t);
  assert.equal(b.panel.isOpen(), true);
  b.panel.root.querySelector('.tool-tab-close').click();
  await tick();
  assert.deepEqual(b.tabsText(), []);
  assert.equal(b.panel.isOpen(), true, 'the panel stays open on the + page');
  assert.equal(b.ovIcon().disabled, true);
  assert.equal(b.ovIcon().getAttribute('aria-pressed'), 'false', 'a disabled icon never reads pressed');
});

test('Design is a tab like the others: its tab shows in the row with its name, and Shift-click opens another', async () => {
  const b = boot({ ctx: OS_CHAT_A, extra: [(log) => ({ ...fakeKind('design', 5, log), strip: true, onlyWhenAvailable: true, folderless: true, unavailable: (v) => (v?.side?.id === OS_CHAT_A.chatId ? null : 'no') })] });
  b.icon('design').click(); await tick();
  assert.equal(b.doc.querySelector('.tool-tabs').hidden, false, 'one Design tab still draws the tab row');
  assert.deepEqual(b.tabsText(), ['Design']);
  b.icon('design').dispatchEvent(new b.win.MouseEvent('click', { bubbles: true, shiftKey: true })); await tick();
  assert.deepEqual(b.tabsText(), ['Design', 'Design 2']);
  assert.ok(!b.panel.root.classList.contains('is-lone'));
});
