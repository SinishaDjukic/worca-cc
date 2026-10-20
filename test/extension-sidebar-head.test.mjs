// test/extension-sidebar-head.test.mjs — the paired sidebar's head (the real sidebar.mjs in jsdom): the chat list plus
// worca's New chat button, and the chat scope pill's list / empty / failed / pinned states.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { bootSidebar, stopSidebar, ok, pairedRoutes, SNAP } from './helpers/sidebar-harness.mjs';

afterEach(stopSidebar);
const BASE = 'http://127.0.0.1:4888';
const STORE = { 'worca.baseUrl': BASE, 'worca.token': 'tok' };
const PROJECTS = [{ key: 'acme-api', name: 'ACME API' }, { key: 'acme-web', name: 'ACME Web' }];
const WORKSPACES = [{ id: 'ws_1', name: 'ACME platform' }];
const TID = 'askt_00000001';

test('the head keeps the chat list and adds worca\'s labelled "+ New chat" button next to it; it opens an empty chat, the draft stays', async () => {
  const h = await bootSidebar({ storage: STORE, route: pairedRoutes((p) => (p === `/api/ask/threads/${TID}` ? ok(SNAP(TID)) : null), { threads: [{ id: TID, title: 'Rate limits' }] }) });
  const chats = h.$('.chat-head select[aria-label="Chat"]');
  assert.ok(chats, 'the chat list stays');
  const btn = h.$('.chat-head button[data-ask-new-btn]');
  assert.ok(btn, 'a New chat button');
  assert.equal(btn.className, 'btn btn-sm btn-quiet chat-new-btn chat-head-btn');
  assert.equal(btn.textContent, 'New chat', 'a labelled button, not an icon');
  assert.equal(btn.getAttribute('aria-label'), null, 'the visible label is its name');
  assert.equal(btn.querySelector('svg').getAttribute('aria-hidden'), 'true');
  assert.equal(btn.querySelector('svg path').getAttribute('d'), 'M12 5v14M5 12h14');
  assert.equal(chats.nextElementSibling, btn, 'the chat list sits right next to it');
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

test('every request the sidebar makes names the extension in X-Worca-Extension (no trailing slash)', async () => {
  const h = await bootSidebar({ storage: STORE, route: pairedRoutes() });
  assert.ok(h.headers.length >= 5, 'hello, status, models, threads, lists');
  for (const hd of h.headers) assert.equal(hd['X-Worca-Extension'], 'chrome-extension://wx-test');
});

// The chat scope is Ask's composer pill + popover (it replaced the head's project picker).
const pill = (h) => h.$('.ask-scope-btn');
const scopeItems = (h) => [...h.$$('.ask-pop-scope .ask-pop-item')];
const scopeLabels = (h) => scopeItems(h).map((i) => [i.querySelector('.ask-model-name').textContent, !!i.querySelector('.ask-model-check')]);

test('chat scope: "No project" with its title, then projects and workspaces under their own captions', async () => {
  const h = await bootSidebar({ storage: STORE, route: pairedRoutes(null, { projects: PROJECTS, workspaces: WORKSPACES }) });
  assert.equal(h.$('.wx-scope'), null, 'no head picker any more');
  assert.equal(h.$('.ask-scope-label').textContent, 'No project');
  assert.equal(pill(h).title, 'Chat scope: No project');
  assert.ok(!pill(h).hasAttribute('data-pinned'));
  await h.click(pill(h));
  assert.deepEqual([...h.$$('.ask-pop-scope .ask-pop-caption')].map((c) => c.textContent), ['Chat scope', 'Projects', 'Workspaces']);
  assert.deepEqual(scopeLabels(h), [['No project', true], ['ACME API', false], ['ACME Web', false], ['ACME platform', false]]);
  assert.equal(scopeItems(h)[0].title, 'Chat scope: No project');
  await h.click(pill(h));
  assert.equal(h.$('.ask-pop-scope'), null, 'a second click closes it');
});

test('chat scope: the server has none → a muted line and Open Worca (opens the Worca address in a tab)', async () => {
  const h = await bootSidebar({ storage: STORE, route: pairedRoutes() });
  await h.click(pill(h));
  assert.match(h.$('.ask-pop-scope').textContent, /No projects in this Worca yet/);
  const open = scopeItems(h).find((b) => b.textContent === 'Open Worca');
  assert.ok(open);
  await h.click(open);
  assert.deepEqual(h.tabsCreated, [{ url: BASE }]);
});

test('chat scope: a failed load says so (not "none") and Retry re-fetches only the lists', async () => {
  let fail = true;
  const h = await bootSidebar({ storage: STORE, route: pairedRoutes((p) => (fail && p === '/api/projects' ? ok({ error: 'boom' }, 500) : null), { projects: PROJECTS }) });
  await h.click(pill(h));
  const pop = h.$('.ask-pop-scope');
  assert.match(pop.textContent, /Couldn't load projects/);
  assert.doesNotMatch(pop.textContent, /No projects/);
  const retry = scopeItems(h).find((b) => b.textContent === 'Retry');
  assert.ok(retry);
  fail = false;
  const before = h.calls.length;
  await h.click(retry);
  assert.deepEqual(h.paths().slice(before).sort(), ['/api/projects', '/api/workspaces']);
  assert.equal(scopeItems(h).length, 1 + PROJECTS.length, 'the open popover shows the lists');
});

test('chat scope: a pinned chat shows its project on load; a pin the list lacks still shows; a pick PATCHes the scope', async () => {
  const route = pairedRoutes((p, opts, method) => {
    if (p === `/api/ask/threads/${TID}` && method === 'GET') return ok(SNAP(TID, { pinned: true, projectKey: 'acme-web' }));
    if (p === '/api/ask/threads/askt_00000002' && method === 'GET') return ok(SNAP('askt_00000002', { pinned: true, workspaceId: 'ws_gone' }));
    if (method === 'PATCH') return ok({ ok: true });
    return null;
  }, { projects: PROJECTS, workspaces: WORKSPACES, threads: [{ id: TID, title: 'A' }, { id: 'askt_00000002', title: 'B' }] });
  const h = await bootSidebar({ storage: STORE, route });
  await h.change(h.$('.chat-head select[aria-label="Chat"]'), TID);
  assert.equal(h.$('.ask-scope-label').textContent, 'ACME Web');
  assert.ok(pill(h).hasAttribute('data-pinned') && pill(h).classList.contains('is-pinned'), 'styled as pinned');
  assert.match(pill(h).title, /ACME Web/);
  await h.click(pill(h));
  assert.deepEqual(scopeLabels(h).filter(([, on]) => on), [['ACME Web', true]]);
  await h.click(scopeItems(h).find((b) => b.textContent.startsWith('ACME platform')));
  const patch = h.calls.find((c) => c.startsWith('PATCH '));
  assert.ok(patch && patch.endsWith(`/api/ask/threads/${TID} {"scope":{"pinned":true,"workspaceId":"ws_1"}}`), patch);
  assert.equal(h.$('.ask-scope-label').textContent, 'ACME platform');
  await h.change(h.$('.chat-head select[aria-label="Chat"]'), 'askt_00000002');
  assert.equal(h.$('.ask-scope-label').textContent, 'ws_gone', 'an unknown pin is still shown');
  await h.click(pill(h));
  await h.click(scopeItems(h).find((b) => b.textContent.startsWith('No project')));
  assert.ok(!pill(h).hasAttribute('data-pinned'));
  assert.equal(h.$('.ask-scope-label').textContent, 'No project');
});

test('chat scope: a pinned chat on a Worca with no projects still shows its pin', async () => {
  const route = pairedRoutes((p, opts, method) => (p === `/api/ask/threads/${TID}` && method === 'GET' ? ok(SNAP(TID, { pinned: true, projectKey: 'acme-old' })) : null), { threads: [{ id: TID, title: 'A' }] });
  const h = await bootSidebar({ storage: STORE, route });
  await h.change(h.$('.chat-head select[aria-label="Chat"]'), TID);
  assert.equal(h.$('.ask-scope-label').textContent, 'acme-old');
  assert.ok(pill(h).hasAttribute('data-pinned'));
});
