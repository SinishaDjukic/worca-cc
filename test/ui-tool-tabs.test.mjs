// test/ui-tool-tabs.test.mjs — the tool panel's tab model and kind registry (issue 1064): views, scopes, groups, order,
// moves, hidden counts, the server-shell sync, persistence; and kinds as registrations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewOf, viewKey, inView, sessionScope, scopeQuery, runQuery, createTabModel, cleanScope, BLOCKED, TOOLS_KEY, openKeyOf } from '../ui/public/tool-tabs.mjs';
import { createToolRegistry, ICON_SLOTS } from '../ui/public/tool-kinds.mjs';
import { checkRows } from './helpers/rows.mjs';

const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m }; };
let n = 0;
const ids = () => `tab_t${(n += 1)}`;
const RUN_A = { view: 'history-detail', pipelineId: 'aaaa1111', projectKey: 'app-0000aaaa' };
const RUN_B = { view: 'running', runId: 'u-2', pipelineId: 'bbbb2222', projectKey: 'app-0000aaaa' };
const vA = viewOf(RUN_A);
const vB = viewOf(RUN_B);

test('viewOf: run, workspace run, starting run, chat, chat with no project or no thread, project page, other pages', async () => {
  await checkRows([
    { name: 'saved run', run: () => assert.deepEqual(vA, { project: 'app-0000aaaa', side: { type: 'run', id: 'aaaa1111', projectKey: 'app-0000aaaa' } }) },
    { name: 'workspace run has no project group', run: () => assert.deepEqual(viewOf({ view: 'running', runId: 'u', pipelineId: 'cccc3333', workspaceId: 'workspaces/wks-1' }),
      { project: null, side: { type: 'run', id: 'cccc3333', workspaceId: 'wks-1' } }) },
    { name: 'a No-project run keeps its key for the lookup, but has no project group', run: () => assert.deepEqual(viewOf({ view: 'history-detail', pipelineId: 'dddd4444', projectKey: 'no-project-00000000' }),
      { project: null, side: { type: 'run', id: 'dddd4444', projectKey: 'no-project-00000000' } }) },
    { name: 'starting run is blocked', run: () => assert.equal(viewOf({ view: 'running', runId: 'u-1', projectKey: 'app-0000aaaa' }).blocked, BLOCKED.pending) },
    { name: 'chat with a project', run: () => assert.deepEqual(viewOf({ view: 'chat', chatId: 'ask_1', chatProjectKey: 'app-0000aaaa' }),
      { project: 'app-0000aaaa', side: { type: 'chat', id: 'ask_1', projectKey: 'app-0000aaaa' } }) },
    { name: 'chat without a project keeps its tabs, blocks new ones', run: () => {
      const v = viewOf({ view: 'chat', chatId: 'ask_2' });
      assert.deepEqual(v.side, { type: 'chat', id: 'ask_2' });
      assert.equal(v.blocked, BLOCKED.noProject);
    } },
    { name: 'new chat', run: () => assert.equal(viewOf({ view: 'chat' }).blocked, BLOCKED.newChat) },
    { name: 'project page', run: () => assert.deepEqual(viewOf({ view: 'project-detail', projectKey: 'app-0000aaaa' }), { project: 'app-0000aaaa', side: null }) },
    { name: 'other page keeps the last view', run: () => assert.equal(viewOf({ view: 'settings' }), null) },
  ]);
});

test('sessionScope: Chat\'s agent shells and chat shells belong to their chat; run, project and branch shells to theirs', async () => {
  await checkRows([
    { name: 'ask', run: () => assert.deepEqual(sessionScope({ createdBy: 'ask:ask_9', scope: 'run', runId: 'r1', projectKey: 'k' }), { type: 'chat', id: 'ask_9', projectKey: 'k' }) },
    { name: 'ask cap is not a chat', run: () => assert.deepEqual(sessionScope({ createdBy: 'ask:cap', scope: 'project', projectKey: 'k' }), { type: 'project', id: 'k' }) },
    { name: 'chatId', run: () => assert.deepEqual(sessionScope({ chatId: 'ask_3', scope: 'chat', projectKey: 'k' }), { type: 'chat', id: 'ask_3', projectKey: 'k' }) },
    { name: 'run', run: () => assert.deepEqual(sessionScope({ scope: 'run', runId: 'r1', createdBy: 'local' }), { type: 'run', id: 'r1' }) },
    { name: 'branch', run: () => assert.deepEqual(sessionScope({ scope: 'branch', projectKey: 'k' }), { type: 'project', id: 'k' }) },
    { name: 'junk', run: () => assert.equal(sessionScope({ scope: 'run' }), null) },
  ]);
});

test('scopeQuery and runQuery carry the run lookup keys', () => {
  assert.equal(scopeQuery({ type: 'project', id: 'k' }, { path: 'src' }), 'scope=project&projectKey=k&path=src');
  assert.equal(scopeQuery({ type: 'chat', id: 'ask_1' }), 'scope=chat&threadId=ask_1');
  assert.equal(scopeQuery({ type: 'run', id: 'r1', workspaceId: 'w' }, { member: 'm' }), 'scope=run&runId=r1&workspaceId=w&member=m');
  assert.equal(runQuery({ type: 'run', id: 'r1', projectDir: '/p/app' }), 'projectDir=%2Fp%2Fapp');
  assert.equal(cleanScope({ type: 'run', id: '../x y' }), null);
});

test('visible: the view\'s project tabs, then its run\'s tabs; another run\'s tabs are hidden and counted', () => {
  const m = createTabModel({ storage: memStore(), newId: ids });
  const p = m.open('files', { type: 'project', id: 'app-0000aaaa' });
  const a = m.open('terminal', vA.side);
  const b = m.open('changes', vB.side);
  assert.deepEqual(m.visible(vA), { project: [p], side: [a] });
  assert.deepEqual(m.visible(vB), { project: [p], side: [b] });
  assert.deepEqual(m.hidden(vA).map((t) => t.id), [b.id]);
  assert.equal(inView(p, vB), true);
  assert.notEqual(viewKey(vA), viewKey(vB));
});

test('active: per view, falling back to the last visible tab; newest finds the newest of a kind', () => {
  let t = 0;
  const m = createTabModel({ storage: memStore(), newId: ids, now: () => (t += 1) });
  const a1 = m.open('terminal', vA.side);
  const a2 = m.open('terminal', vA.side);
  assert.equal(m.active(vA).id, a2.id);
  m.activate(vA, a1.id);
  assert.equal(m.active(vA).id, a1.id);
  assert.equal(m.active(vB), null);
  assert.equal(m.newest('terminal', vA).id, a2.id);
  assert.equal(m.newest('files', vA), null);
});

test('move and moveBefore stay inside a group; moveToProject changes the scope', () => {
  const m = createTabModel({ storage: memStore(), newId: ids });
  const p1 = m.open('files', { type: 'project', id: 'app-0000aaaa' });
  const a1 = m.open('terminal', vA.side);
  const a2 = m.open('files', vA.side);
  assert.equal(m.move(a2.id, -1, vA), true);
  assert.deepEqual(m.visible(vA).side.map((x) => x.id), [a2.id, a1.id]);
  assert.equal(m.move(a2.id, -1, vA), false, 'first in its group');
  assert.equal(m.moveBefore(a1.id, p1.id, vA), false, 'never across the divider');
  assert.equal(m.moveBefore(a1.id, a2.id, vA), true);
  assert.deepEqual(m.visible(vA).side.map((x) => x.id), [a1.id, a2.id]);
  assert.equal(m.moveToProject(a1.id, 'app-0000aaaa'), true);
  assert.deepEqual(m.visible(vB).project.map((x) => x.id), [p1.id, a1.id]);
});

test('closeScope removes a run\'s or chat\'s tabs and returns them', () => {
  const m = createTabModel({ storage: memStore(), newId: ids });
  m.open('terminal', vA.side);
  const keep = m.open('files', vB.side);
  assert.equal(m.closeScope(vA.side).length, 1);
  assert.deepEqual(m.tabs().map((x) => x.id), [keep.id]);
});

test('closeScope with no id (a chat history clear) removes every tab of that type', () => {
  const m = createTabModel({ storage: memStore(), newId: ids });
  m.open('files', { type: 'chat', id: 'ask_1' });
  m.open('terminal', { type: 'chat', id: 'ask_2' });
  const run = m.open('files', vA.side);
  assert.equal(m.closeScope({ type: 'chat', id: null }).length, 2);
  assert.deepEqual(m.tabs().map((x) => x.id), [run.id]);
});

test('syncSessions: a tab per live shell in its scope; an ended shell\'s tab leaves unless kept; no duplicates', () => {
  const m = createTabModel({ storage: memStore(), newId: ids });
  const live = [
    { id: 't-1', status: 'running', scope: 'run', runId: 'aaaa1111', createdBy: 'local', createdAt: '2026-01-01T00:00:01Z' },
    { id: 't-2', status: 'running', scope: 'project', projectKey: 'app-0000aaaa', createdBy: 'ask:ask_1', createdAt: '2026-01-01T00:00:02Z' },
  ];
  assert.equal(m.syncSessions(live), true);
  assert.equal(m.visible(vA).side[0].state.sessionId, 't-1');
  assert.equal(m.visible({ project: null, side: { type: 'chat', id: 'ask_1' } }).side[0].state.sessionId, 't-2');
  assert.equal(m.syncSessions(live), false, 'nothing new');
  const kept = m.visible(vA).side[0];
  m.syncSessions([{ ...live[0], status: 'exited' }, live[1]], new Set([kept.id]));
  assert.ok(m.get(kept.id), 'the tab on screen stays to offer Enter');
  m.syncSessions([live[1]]);
  assert.equal(m.get(kept.id), null);
  const pending = m.open('terminal', vB.side);
  m.syncSessions([live[1]]);
  assert.ok(m.get(pending.id), 'a tab still starting its shell is never pruned');
});

test('persistence: tabs, active, width and maximize round-trip; open is kept per scope; junk is dropped; the pane\'s width (never its open flag) seeds the first boot', async () => {
  await checkRows([
    { name: 'round-trip, and a scope never opened starts closed', run: () => {
      const store = memStore();
      const m = createTabModel({ storage: store, newId: ids });
      const a = m.open('terminal', vA.side, { sessionId: 't-9' });
      m.activate(vA, a.id);
      m.setPrefs({ open: true, width: 600, max: true });   // an old caller's `open` is ignored: open/closed is per scope
      m.setOpenAt('run:aaaa1111', true);
      const again = createTabModel({ storage: store, newId: ids });
      assert.deepEqual(again.tabs(), m.tabs());
      assert.equal(again.active(vA).id, a.id);
      assert.deepEqual(again.prefs(), { width: 600, max: true });
      assert.equal(again.isOpenAt('run:aaaa1111'), true);
      assert.equal(again.isOpenAt('run:bbbb2222'), false);
      assert.equal(again.isOpenAt(null), false);
      assert.deepEqual(JSON.parse(store.map.get(TOOLS_KEY)).open, ['run:aaaa1111']);
    } },
    { name: 'junk tabs are dropped', run: () => {
      const junk = memStore({ [TOOLS_KEY]: JSON.stringify({ v: 1, tabs: [{ id: 'x', kind: 'terminal', scope: vA.side }, { id: 'tab_ok', kind: 'BAD', scope: vA.side },
        { id: 'tab_ok2', kind: 'files', scope: { type: 'nope', id: 'x' } }, { id: 'tab_ok3', kind: 'files', scope: vA.side, state: 'str' }] }) });
      assert.deepEqual(createTabModel({ storage: junk }).tabs().map((t) => [t.id, t.state]), [['tab_ok3', {}]]);
    } },
    { name: 'first boot: the terminal pane\'s width carries over, its open flag never does', run: () => {
      const legacy = createTabModel({ storage: memStore({ 'worca-cc.terminal.open': '1', 'worca-cc.terminal.width': '520' }) });
      assert.deepEqual(legacy.prefs(), { width: 520, max: false });
      for (const k of ['run:aaaa1111', 'chat:ask_1', 'project:app-0000aaaa']) assert.equal(legacy.isOpenAt(k), false, k);
    } },
    { name: 'an old global prefs.open opens nothing', run: () => {
      const old = createTabModel({ storage: memStore({ [TOOLS_KEY]: JSON.stringify({ v: 1, tabs: [], active: {}, prefs: { open: true, width: 500 } }) }) });
      assert.deepEqual(old.prefs(), { width: 500, max: false });
      assert.equal(old.isOpenAt(openKeyOf(vA)), false);
    } },
    { name: 'stored open keys: junk dropped, a duplicate kept once', run: () => {
      const store = memStore({ [TOOLS_KEY]: JSON.stringify({ v: 1, tabs: [], open: ['run:aaaa1111', 'run:aaaa1111', 'nope:x', 7, 'chat:', 'chat:../x', 'chat:ask_1'] }) });
      const m = createTabModel({ storage: store });
      assert.equal(m.isOpenAt('run:aaaa1111'), true);
      m.setPrefs({ width: 470 });                          // any save writes the cleaned list
      assert.deepEqual(JSON.parse(store.map.get(TOOLS_KEY)).open, ['run:aaaa1111', 'chat:ask_1']);
      const many = createTabModel({ storage: memStore({ [TOOLS_KEY]: JSON.stringify({ v: 1, tabs: [], open: Array.from({ length: 60 }, (_, i) => `run:r${i}`) }) }) });
      assert.deepEqual([many.isOpenAt('run:r9'), many.isOpenAt('run:r10'), many.isOpenAt('run:r59')], [false, true, true], 'a stored list keeps its 50 newest');
    } },
    { name: 'setOpenAt that changes nothing writes nothing (the mirror is not woken)', run: () => {
      let writes = 0;
      const store = memStore();
      const setItem = store.setItem;
      store.setItem = (k, v) => { writes += 1; setItem(k, v); };
      const m = createTabModel({ storage: store });
      m.setOpenAt('run:aaaa1111', true);
      m.setOpenAt('run:aaaa1111', true);
      m.setOpenAt('chat:ask_1', false);
      assert.equal(writes, 1);
    } },
    { name: 'setOpenAt: a key that is no scope is refused; closing unlists; the 50 newest are kept', run: () => {
      const store = memStore();
      const m = createTabModel({ storage: store });
      for (const bad of ['', 'run:', 'nope:x', null, 7]) m.setOpenAt(bad, true);
      assert.equal(store.map.get(TOOLS_KEY), undefined, 'nothing saved for a refused key');
      for (let i = 0; i < 60; i += 1) m.setOpenAt(`run:r${i}`, true);
      assert.equal(m.isOpenAt('run:r9'), false);
      assert.equal(m.isOpenAt('run:r10'), true);
      m.setOpenAt('run:r59', false);
      assert.equal(m.isOpenAt('run:r59'), false);
      assert.equal(JSON.parse(store.map.get(TOOLS_KEY)).open.length, 49);
    } },
    { name: 'private mode: defaults, nothing open', run: () => {
      const m = createTabModel({ storage: { getItem() { throw new Error('private'); }, setItem() { throw new Error('private'); } } });
      assert.deepEqual(m.prefs(), { width: 460, max: false });
      m.setOpenAt('run:aaaa1111', true);
      assert.equal(m.isOpenAt('run:aaaa1111'), true, 'kept in memory');
    } },
  ]);
});

test('openKeyOf: a run or chat by its id, a project page by its project; a new chat, a starting run and no view have none', () => {
  assert.equal(openKeyOf(vA), 'run:aaaa1111');
  assert.equal(openKeyOf(viewOf({ view: 'chat', chatId: 'ask_1', chatProjectKey: 'app-0000aaaa' })), 'chat:ask_1');
  assert.equal(openKeyOf(viewOf({ view: 'chat', chatId: 'ask_2' })), 'chat:ask_2', 'a chat with no project has its own');
  assert.equal(openKeyOf(viewOf({ view: 'project-detail', projectKey: 'app-0000aaaa' })), 'project:app-0000aaaa');
  assert.equal(openKeyOf(viewOf({ view: 'chat' })), null, 'a new chat before its first message');
  assert.equal(openKeyOf(viewOf({ view: 'running', runId: 'u-1', projectKey: 'app-0000aaaa' })), null, 'a starting run never takes its project page\'s state');
  assert.equal(openKeyOf(null), null);
});

test('closeScope also forgets the archived scope\'s open state (a chat history clear: every chat\'s)', () => {
  const m = createTabModel({ storage: memStore(), newId: ids });
  for (const k of ['run:aaaa1111', 'chat:ask_1', 'chat:ask_2', 'project:app-0000aaaa']) m.setOpenAt(k, true);
  m.closeScope({ type: 'run', id: 'aaaa1111' });
  assert.equal(m.isOpenAt('run:aaaa1111'), false);
  assert.equal(m.isOpenAt('chat:ask_1'), true);
  m.closeScope({ type: 'chat', id: null });
  assert.deepEqual(['chat:ask_1', 'chat:ask_2', 'project:app-0000aaaa'].map((k) => m.isOpenAt(k)), [false, false, true]);
});

test('at most 64 tabs', () => {
  const m = createTabModel({ storage: memStore(), newId: ids });
  for (let i = 0; i < 64; i += 1) assert.ok(m.open('files', vA.side));
  assert.equal(m.open('files', vA.side), null);
});

test('at the cap the oldest Files or Changes tab of another run or chat makes room; shells, project tabs and kept tabs stay', () => {
  let t = 0;
  const m = createTabModel({ storage: memStore(), newId: ids, now: () => (t += 1) });
  const run = (i) => ({ type: 'run', id: `run${String(i).padStart(4, '0')}` });
  const shell = m.open('terminal', run(0));                // the oldest tab, but a shell
  const proj = m.open('files', { type: 'project', id: 'app-0000aaaa' });
  const kept = m.open('changes', run(1));                  // on screen as a guest
  for (let i = 2; i < 63; i += 1) assert.ok(m.open(i % 2 ? 'files' : 'changes', run(i)));
  assert.equal(m.tabs().length, 64);
  const oldest = m.tabs()[3];
  const tab = m.open('changes', run(64), {}, { keep: new Set([kept.id]) });
  assert.ok(tab, 'the 65th run opens its tab');
  assert.equal(m.tabs().length, 64);
  assert.equal(m.get(oldest.id), null, 'the oldest hidden Files/Changes tab went');
  for (const x of [shell, proj, kept]) assert.ok(m.get(x.id));
  // A live shell at the cap gets its tab the same way.
  const next = m.tabs().find((x) => x.kind !== 'terminal' && x.scope.type !== 'project' && x.id !== kept.id);
  assert.equal(m.syncSessions([{ id: 's-new', status: 'running', scope: 'run', runId: 'run9999', createdAt: '2026-01-01T00:00:00Z' }], new Set([kept.id])), true);
  assert.ok(m.tabs().some((x) => x.state.sessionId === 's-new'));
  assert.equal(m.get(next.id), null);
});

test('registry: kinds are registrations; order, validation, shortcuts and the icon slots', () => {
  const r = createToolRegistry();
  const def = (kind, order, shortcut) => ({ kind, label: kind, icon: 'none', order, title: () => kind, mount: () => {}, shortcut });
  r.register(def('files', 30, { code: 'KeyE', ctrl: true, shift: true, label: 'Ctrl+Shift+E' }));
  r.register(def('terminal', 10, { code: 'Backquote', key: '`', ctrl: true, label: 'Ctrl+`' }));
  assert.deepEqual(r.list().map((k) => k.kind), ['terminal', 'files']);
  assert.throws(() => r.register({ kind: 'Bad Kind', title: () => '', mount: () => {} }));
  assert.throws(() => r.register({ kind: 'nomount', title: () => '' }));
  const key = (o) => ({ ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, key: '', code: '', ...o });
  assert.equal(r.matchShortcut(key({ ctrlKey: true, code: 'Backquote' })).kind, 'terminal');
  assert.equal(r.matchShortcut(key({ ctrlKey: true, shiftKey: true, code: 'KeyE', key: 'E' })).kind, 'files');
  assert.equal(r.matchShortcut(key({ ctrlKey: true, code: 'KeyE' })), null, 'Shift is part of the chord');
  assert.equal(r.matchShortcut(key({ metaKey: true, ctrlKey: true, code: 'Backquote' })), null);
  assert.deepEqual(ICON_SLOTS.map((s) => s.kind), ['terminal', 'browser', 'files', 'changes']);
  const off = r.register(def('browser', 20));
  assert.equal(r.get('browser').kind, 'browser');
  off();
  assert.equal(r.get('browser'), null);
});

test('onChange fires on every save; adopt takes in the assistant\'s new tabs once, marked, in the given scope', () => {
  let n = 0;
  const m = createTabModel({ storage: memStore(), newId: ids, onChange: () => { n += 1; } });
  m.open('files', { type: 'project', id: 'app-0000aaaa' });
  assert.equal(n, 1);
  const chat = { type: 'chat', id: 'ask_0000aaaa', projectKey: 'app-0000aaaa' };
  const added = m.adopt(chat, [{ id: 'tab_srv1', kind: 'browser', url: 'http://localhost:4400/' }, { id: 'bad id', kind: 'files' }]);
  assert.deepEqual(added.map((t) => [t.id, t.state.openedBy, t.state.url, t.scope.type]), [['tab_srv1', 'assistant', 'http://localhost:4400/', 'chat']]);
  assert.deepEqual(m.adopt(chat, [{ id: 'tab_srv1', kind: 'browser' }]), [], 'never twice');
  assert.equal(n, 2);
});

test('active(): an assistant Terminal tab that never started a shell is never the default tab', () => {
  const m = createTabModel({ storage: memStore(), newId: ids });
  const chat = { type: 'chat', id: 'ask_0000aaaa', projectKey: 'app-0000aaaa' };
  const view = { project: 'app-0000aaaa', side: chat };
  const f = m.open('files', chat);
  m.adopt(chat, [{ id: 'tab_srv9', kind: 'terminal' }]);
  assert.equal(m.active(view).id, f.id);
  m.activate(view, 'tab_srv9');
  assert.equal(m.active(view).id, 'tab_srv9', 'the user picked it');
  const only = createTabModel({ storage: memStore(), newId: ids });
  only.adopt(chat, [{ id: 'tab_srv8', kind: 'terminal' }]);
  assert.equal(only.active(view), null, 'nothing shows rather than a shell starting');
});
