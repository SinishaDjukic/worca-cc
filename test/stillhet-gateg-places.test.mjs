// test/stillhet-gateg-places.test.mjs — gate G (G4) fixes on Stillhet Projects, Insights and Chat, in the live app host:
// F-G-G4-01 a workspace address opens on a fresh load; F-G-G4-03 a task started on a workspace keeps the workspace as the
// chat's scope (classic's ask-panel PATCH {scope:{pinned,workspaceId}}); ledger row 3 (slice 10 review) Insights links:
// Copy link has no scope= (classic's #team-metrics link carries none), and an of= or a saved view's key the live data
// lacks opens without it and says so.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PJ_SOURCES, PJ_LISTS, WS, KEYS, projectsHost, sent, settle, clone, closeHosts } from './helpers/stillhet-projects-host.mjs';
import { liveHost, LISTS, SOURCES, saidText } from './helpers/stillhet-chat-live-host.mjs';
import { insightsHost } from './helpers/stillhet-insights-host.mjs';
import { VIEWS_KEY } from '../ui/public/stillhet/live/insights-live.mjs';

afterEach(closeHosts);
const until = async (f, ms = 6000) => { for (let t = 0; t < ms && !f(); t += 50) await settle(50); };

test('F-G-G4-01: a fresh load of #projects/ws:ID (a reload or a shared link) opens the workspace page, never #projects', async () => {
  const h = await liveHost({ hash: `#projects/ws:${WS}`, sources: { ...clone(SOURCES), ...clone(PJ_SOURCES) }, lists: { ...LISTS, ...clone(PJ_LISTS) }, beforeScripts: (win) => { win.structuredClone ||= structuredClone; } });
  await until(() => /How Seed shop connects|Seed shop/.test(h.d.getElementById('route-place')?.textContent || ''));
  await settle(300);
  assert.equal(h.w.location.hash, `#projects/ws:${WS}`);
  assert.match(h.d.getElementById('route-place').textContent, /Seed shop/);
});

test('F-G-G4-03: a task started on a workspace sends its scope as classic does and the chat keeps it', async () => {
  const h = await projectsHost({ hash: `#projects/ws:${WS}`, write: (url, body, method) => {
    if (url === '/api/ask/threads' && method === 'POST') return [201, { thread: { id: 'ask_ws' } }];
    if (method === 'PATCH' && url === '/api/ask/threads/ask_ws') return [200, { thread: { id: 'ask_ws', context: { pinned: true, ...body.scope } } }];
    if (url.endsWith('/messages')) return [202, { userMessageId: 'u1' }];
    return [200, {}];
  } });
  const start = [...h.d.querySelectorAll('#route-place [data-ws="task"]')].find((b) => /Start a task across all/.test(b.textContent));
  assert.ok(start, 'Start a task across all is offered');
  start.click(); await settle(120);
  assert.equal(h.w.location.hash, '#chat');
  assert.equal(h.d.querySelector('#route-chat [data-menu="cp-project"]').textContent.trim(), 'Seed shop');
  h.d.querySelector('#route-chat [data-composer-t]').value = 'Add a refund flow across both';
  h.d.querySelector('#route-chat [data-cp-send]').click(); await settle(150);
  const writes = sent(h.calls);
  const patch = writes.find(([m, u]) => m === 'PATCH' && u === '/api/ask/threads/ask_ws');
  assert.deepEqual(patch?.[2], { scope: { pinned: true, workspaceId: WS } }, JSON.stringify(writes));
  const order = writes.map(([m, u]) => `${m} ${u}`);
  assert.ok(order.indexOf('PATCH /api/ask/threads/ask_ws') < order.indexOf('POST /api/ask/threads/ask_ws/messages'), 'the scope before the first message');
  assert.equal(h.w.location.hash, '#chat/ask_ws');
  assert.equal(h.d.querySelector('#route-chat [data-menu="cp-project"]').textContent.trim(), 'Seed shop', 'the chat keeps the workspace, never No project');
});

test('F-G-G4-03: in a chat, picking a workspace PATCHes {scope:{pinned,workspaceId}}; picking a project its projectKey', async () => {
  const h = await projectsHost({ hash: '#chat/ask_1', write: (url, body, method) => (method === 'PATCH' ? [200, { thread: { id: 'ask_1', context: { pinned: true, ...body.scope } } }] : [200, {}]) });
  await settle(120);
  h.d.querySelector('#route-chat [data-menu="cp-project"]').click(); await settle(10);
  const ws = h.d.querySelector('#route-chat [data-menu-pick="cp-project|Seed shop"]');
  assert.ok(ws, 'the workspace is offered from Advanced, as in classic\'s scope picker');
  ws.click(); await settle(80);
  assert.deepEqual(sent(h.calls).filter(([m]) => m === 'PATCH').at(-1)?.[2], { scope: { pinned: true, workspaceId: WS } });
  h.d.querySelector('#route-chat [data-menu="cp-project"]').click(); await settle(10);
  h.d.querySelector('#route-chat [data-menu-pick="cp-project|seed-ok"]').click(); await settle(80);
  assert.deepEqual(sent(h.calls).filter(([m]) => m === 'PATCH').at(-1)?.[2], { scope: { pinned: true, projectKey: KEYS.ok } });
});

test('ledger row 3: live Copy link on a team page carries no scope=, as classic\'s link', async () => {
  const h = await insightsHost({ hash: '#insights/team', scopes: 2 });
  let copied = '';
  Object.defineProperty(h.w.navigator, 'clipboard', { value: { writeText: (t) => { copied = t; return Promise.resolve(); } }, configurable: true });
  h.d.querySelector('#route-place [data-menu="in-of"]').click(); await settle(30);
  h.d.querySelector('#route-place [data-pick="in-of|scope:workspace:wks-shop"]').click(); await settle(200);
  h.d.querySelector('#route-place [data-menu="in-more"]').click(); await settle(20);
  h.d.querySelector('#route-place [data-menu-pick="in-more|link"]').click(); await settle(60);
  assert.match(copied, /#insights\/team/);
  assert.doesNotMatch(copied, /scope=/);
});

test('ledger row 3: a link whose of= names something the live data lacks opens without it and says so', async () => {
  const h = await insightsHost({ hash: '#insights/spend?of=project:gone-app,project:web-app' });
  await settle(200);
  assert.match(saidText(h.d), /gone-app/);
  let copied = '';
  Object.defineProperty(h.w.navigator, 'clipboard', { value: { writeText: (t) => { copied = t; return Promise.resolve(); } }, configurable: true });
  h.d.querySelector('#route-place [data-menu="in-more"]').click(); await settle(20);
  h.d.querySelector('#route-place [data-menu-pick="in-more|link"]').click(); await settle(60);
  assert.match(copied, /of=project%3Aweb-app$|of=project:web-app$/);
  assert.doesNotMatch(copied, /gone-app/);
});

test('ledger row 3: a saved view with a stale key opens without it and says so', async () => {
  const view = { id: 'vstale', name: 'Old view', sub: 'spend', st: { by: 'project', then: '', when: 'this month', filter: ['project:gone-app'], as: 'bars', against: 'none', narrow: null } };
  const h = await insightsHost({ hash: '#insights/vstale', beforeScripts: (win) => win.localStorage.setItem(VIEWS_KEY, JSON.stringify([view])) });
  await settle(200);
  assert.match(saidText(h.d), /gone-app/);
  assert.doesNotMatch(h.d.getElementById('route-place').textContent, /of gone-app/);
});
