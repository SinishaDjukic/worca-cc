// test/extension-sidebar-head.test.mjs — the paired sidebar's head (the real sidebar.mjs in jsdom): the chat list plus
// worca's New chat button, and the project picker's list / empty / failed / pinned states.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { bootSidebar, stopSidebar, ok, pairedRoutes, SNAP } from './helpers/sidebar-harness.mjs';

afterEach(stopSidebar);
const BASE = 'http://127.0.0.1:4888';
const STORE = { 'worca.baseUrl': BASE, 'worca.token': 'tok' };
const PROJECTS = [{ key: 'acme-api', name: 'ACME API' }, { key: 'acme-web', name: 'ACME Web' }];
const WORKSPACES = [{ id: 'ws_1', name: 'ACME platform' }];
const TID = 'askt_00000001';

test('the head keeps the chat list and adds worca\'s New chat icon button; it opens an empty chat, the draft stays', async () => {
  const h = await bootSidebar({ storage: STORE, route: pairedRoutes((p) => (p === `/api/ask/threads/${TID}` ? ok(SNAP(TID)) : null), { threads: [{ id: TID, title: 'Rate limits' }] }) });
  const chats = h.$('.chat-head select[aria-label="Chat"]');
  assert.ok(chats, 'the chat list stays');
  const btn = h.$('.chat-head button[aria-label="New chat"]');
  assert.ok(btn, 'a New chat button');
  assert.equal(btn.className, 'ask-icon-btn chat-head-btn');
  assert.equal(btn.title, 'New chat');
  assert.equal(btn.querySelector('svg path').getAttribute('d'), 'M12 5v14M5 12h14');
  await h.change(chats, TID);
  assert.equal(h.$$('.ask-msg').length, 1, 'the chat loaded');
  const input = h.$('textarea.ask-input');
  input.value = 'half a question';
  input.dispatchEvent(new h.win.Event('input', { bubbles: true }));
  await h.click(btn);
  assert.equal(h.$$('.ask-msg').length, 0, 'an empty transcript');
  assert.equal(chats.value, '', 'no chat selected');
  assert.equal(h.$('textarea.ask-input').value, 'half a question', 'the draft stays');
});

test('project picker: a visible "Project" label, "Any project" with its tooltip, projects and workspaces in their own groups', async () => {
  const h = await bootSidebar({ storage: STORE, route: pairedRoutes(null, { projects: PROJECTS, workspaces: WORKSPACES }) });
  const sel = h.doc.getElementById('wx-scope');
  assert.ok(sel);
  assert.equal(h.$('label[for="wx-scope"]').textContent, 'Project');
  const any = sel.options[0];
  assert.equal(any.textContent, 'Any project');
  assert.equal(any.value, 'auto');
  assert.equal(any.title, 'Worca picks the project from your message');
  assert.equal(sel.value, 'auto');
  const groups = [...sel.querySelectorAll('optgroup')].map((g) => [g.label, [...g.children].map((o) => [o.value, o.textContent])]);
  assert.deepEqual(groups, [['Projects', [['p:acme-api', 'ACME API'], ['p:acme-web', 'ACME Web']]], ['Workspaces', [['w:ws_1', 'ACME platform']]]]);
  assert.ok(!sel.hasAttribute('data-pinned'));
});

test('project picker: the server has none → a muted line and Open Worca (opens the Worca address in a tab)', async () => {
  const h = await bootSidebar({ storage: STORE, route: pairedRoutes() });
  assert.equal(h.doc.getElementById('wx-scope'), null, 'no select');
  const bar = h.$('.wx-scope');
  assert.match(bar.textContent, /No projects in this Worca yet/);
  const link = [...bar.querySelectorAll('a')].find((a) => a.textContent === 'Open Worca');
  assert.ok(link);
  await h.click(link);
  assert.deepEqual(h.tabsCreated, [{ url: BASE }]);
});

test('project picker: a failed load says so (not "none") and Retry re-fetches only the lists', async () => {
  let fail = true;
  const h = await bootSidebar({ storage: STORE, route: pairedRoutes((p) => (fail && p === '/api/projects' ? ok({ error: 'boom' }, 500) : null), { projects: PROJECTS }) });
  const bar = h.$('.wx-scope');
  assert.match(bar.textContent, /Couldn't load projects/);
  assert.doesNotMatch(bar.textContent, /No projects/);
  assert.equal(h.doc.getElementById('wx-scope'), null);
  const retry = [...bar.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
  assert.ok(retry);
  fail = false;
  const before = h.calls.length;
  await h.click(retry);
  assert.deepEqual(h.paths().slice(before).sort(), ['/api/projects', '/api/workspaces']);
  assert.ok(h.doc.getElementById('wx-scope'), 'the picker is back');
  assert.equal(h.doc.getElementById('wx-scope').options.length, 1 + PROJECTS.length);
});

test('project picker: a pinned chat shows its project on load; a pin the list lacks still shows; a change PATCHes the scope', async () => {
  const route = pairedRoutes((p, opts, method) => {
    if (p === `/api/ask/threads/${TID}` && method === 'GET') return ok(SNAP(TID, { pinned: true, projectKey: 'acme-web' }));
    if (p === '/api/ask/threads/askt_00000002' && method === 'GET') return ok(SNAP('askt_00000002', { pinned: true, workspaceId: 'ws_gone' }));
    if (method === 'PATCH') return ok({ ok: true });
    return null;
  }, { projects: PROJECTS, workspaces: WORKSPACES, threads: [{ id: TID, title: 'A' }, { id: 'askt_00000002', title: 'B' }] });
  const h = await bootSidebar({ storage: STORE, route });
  await h.change(h.$('.chat-head select[aria-label="Chat"]'), TID);
  const sel = h.doc.getElementById('wx-scope');
  assert.equal(sel.value, 'p:acme-web');
  assert.ok(sel.hasAttribute('data-pinned'), 'styled as pinned');
  assert.match(sel.title, /ACME Web/);
  await h.change(sel, 'w:ws_1');
  const patch = h.calls.find((c) => c.startsWith('PATCH '));
  assert.ok(patch && patch.endsWith(`/api/ask/threads/${TID} {"scope":{"pinned":true,"workspaceId":"ws_1"}}`), patch);
  assert.ok(h.doc.getElementById('wx-scope').hasAttribute('data-pinned'));
  await h.change(h.$('.chat-head select[aria-label="Chat"]'), 'askt_00000002');
  const sel2 = h.doc.getElementById('wx-scope');
  assert.equal(sel2.value, 'w:ws_gone', 'an unknown pin is still shown');
  await h.change(sel2, 'auto');
  assert.ok(!h.doc.getElementById('wx-scope').hasAttribute('data-pinned'));
});

test('project picker: a pinned chat on a Worca with no projects still shows its pin', async () => {
  const route = pairedRoutes((p, opts, method) => (p === `/api/ask/threads/${TID}` && method === 'GET' ? ok(SNAP(TID, { pinned: true, projectKey: 'acme-old' })) : null), { threads: [{ id: TID, title: 'A' }] });
  const h = await bootSidebar({ storage: STORE, route });
  await h.change(h.$('.chat-head select[aria-label="Chat"]'), TID);
  assert.equal(h.doc.getElementById('wx-scope').value, 'p:acme-old');
});
