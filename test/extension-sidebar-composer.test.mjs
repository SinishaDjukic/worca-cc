// test/extension-sidebar-composer.test.mjs — the sidebar's composer is Ask Worca's (the real sidebar.mjs in jsdom):
// attachments, the area capture's chip, the model and scope pickers, cost + context, Settings' Pinpoint option and the
// running-Action pre-pin.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { bootSidebar, stopSidebar, ok, pairedRoutes, SNAP } from './helpers/sidebar-harness.mjs';

afterEach(stopSidebar);
const STORE = { 'worca.baseUrl': 'http://127.0.0.1:4888', 'worca.token': 'tok' };
const TID = 'askt_00000001';
const CATALOG = {
  models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'high', 'max'] }, { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['low', 'high'] }],
  efforts: ['low', 'high', 'max'], default: { model: 'claude-opus-5-5', effort: 'high' },
};
const PROJECTS = [{ key: 'acme-api', name: 'ACME API' }, { key: 'acme-web', name: 'ACME Web' }];
const TAB = { type: 'tab', tabId: 7, readable: true, title: 'Rate limits', url: 'http://fixture.test/page.html' };
const dec = (b64) => Buffer.from(b64, 'base64').toString('utf8');
const MATCH = '/api/extension/actions/match?origin=http%3A%2F%2Flocalhost%3A5173';

/** A paired sidebar whose message POSTs are recorded; `extra` routes first. */
function rig(extra = null, opts = {}) {
  const posts = [];
  const route = pairedRoutes((p, o, method) => {
    const r = extra ? extra(p, o, method) : null;
    if (r) return r;
    if (p === '/api/ask/models') return ok(CATALOG);
    if (p === '/api/ask/threads' && method === 'POST') return ok({ thread: { id: TID, title: null } });
    if (p === `/api/ask/threads/${TID}` && method === 'GET') return ok(SNAP(TID));
    if (p === `/api/ask/threads/${TID}/messages` && method === 'POST') { const body = JSON.parse(o.body); posts.push(body); return ok({ userMessageId: 'askm_u1', attachments: body.attachments.map((a, i) => ({ id: `att_${i}`, name: a.name, bytes: 1, kind: 'text' })) }); }
    if (method === 'PATCH') return ok({ ok: true });
    if (p.startsWith('/api/extension/actions/match')) return ok({ match: null });
    return null;
  }, { projects: PROJECTS, ...opts });
  return { route, posts };
}
/** Type, press Send, and answer the sidebar's page-context request as the service worker would (from the last tab). */
async function typeAndSend(h, text) {
  const input = h.$('textarea.ask-input');
  input.value = text;
  input.dispatchEvent(new h.win.Event('input', { bubbles: true }));
  await h.click(h.$('.ask-send'));
  const ask = [...h.posted].reverse().find((m) => m.type === 'collect');
  const tab = h.lastTab;
  if (ask) await h.fromBackground({ type: 'context', id: ask.id, data: tab ? { url: tab.url, title: tab.title, selection: '' } : null });
}
async function deliverTab(h, tab) { h.lastTab = tab; await h.fromBackground(tab); }
const fileChips = (h) => h.$$('.ask-chip:not(.wx-page-chip):not(.ask-chip-quote) .ask-chip-name').map((n) => n.textContent);
function pickFiles(h, files) {
  const input = h.$('.ask-composer-row input[type=file]');
  Object.defineProperty(input, 'files', { configurable: true, get: () => files });
  input.dispatchEvent(new h.win.Event('change', { bubbles: true }));
  return h.flush();
}

test('the composer row is Ask\'s, minus voice, plus the capture button', async () => {
  const { route } = rig();
  const h = await bootSidebar({ storage: STORE, route });
  const row = h.$('.ask-composer-row');
  const kids = [...row.children].map((c) => (c.matches('input[type=file][hidden]') ? 'file' : c.matches('[data-ask-attach-btn]') ? 'attach' : c.matches('[data-wx-capture-btn]') ? 'capture' : c.className.split(' ')[0]));
  assert.deepEqual(kids, ['file', 'attach', 'capture', 'ask-scope-btn', 'ask-composer-spacer', 'ask-meter', 'ask-model-btn', 'ask-send', 'ask-stop']);
  assert.ok(h.$('.ask-stop').hidden);
  for (const gone of ['.ask-voice', '[data-ask-mic]', '.wx-scope', '#wx-scope']) assert.equal(h.$(gone), null, gone);
});

test('attach: a picked file becomes a chip, × removes it, Send carries it before the page context', async () => {
  const { route, posts } = rig();
  const h = await bootSidebar({ storage: STORE, route });
  await deliverTab(h, TAB);
  await pickFiles(h, [new h.win.File(['# hi'], 'notes.md')]);
  assert.deepEqual(fileChips(h), ['notes.md']);
  await h.click(h.$('.ask-chip button[aria-label="Remove notes.md"]'));
  assert.deepEqual(fileChips(h), []);
  await pickFiles(h, [new h.win.File(['# hi'], 'notes.md')]);
  await typeAndSend(h, 'What is in my notes?');
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].attachments[0], { name: 'notes.md', dataBase64: Buffer.from('# hi').toString('base64') });
  assert.equal(posts[0].attachments[1].name, 'page-context.md');
  assert.deepEqual(fileChips(h), [], 'sent files leave the composer');
});

test('attach: a refused type says so in the composer line', async () => {
  const { route } = rig();
  const h = await bootSidebar({ storage: STORE, route });
  await pickFiles(h, [new h.win.File(['x'], 'tool.exe')]);
  assert.match(h.$('.ask-composer-msg').textContent, /attachment type not allowed: tool\.exe/);
  assert.equal(h.$('.ask-composer-msg').hidden, false);
});

test('model: the popover lists the catalog; a pick relabels the button, is stored and PATCHes the open thread', async () => {
  const { route, posts } = rig(null, { threads: [{ id: TID, title: 'Rate limits' }] });
  const h = await bootSidebar({ storage: STORE, route });
  assert.equal(h.$('.ask-model-btn-label').textContent, 'Opus 5.5');
  assert.equal(h.$('.ask-model-btn-effort').textContent, 'high');
  await h.change(h.$('.chat-head select[aria-label="Chat"]'), TID);
  await h.click(h.$('.ask-model-btn'));
  const items = h.$$('.ask-pop-model .ask-model-item');
  assert.deepEqual(items.map((i) => i.querySelector('.ask-model-name').textContent), ['Opus 5.5', 'Sonnet 5.5']);
  assert.ok(items[0].querySelector('.ask-model-check'), 'the current pick is ticked');
  await h.click(items[1]);
  assert.equal(h.$('.ask-pop-model'), null, 'closes on pick');
  assert.equal(h.$('.ask-model-btn-label').textContent, 'Sonnet 5.5');
  assert.deepEqual(h.store['worca.askPick'], { model: 'claude-sonnet-5-5', effort: 'high' });
  assert.ok(h.calls.some((c) => c === `PATCH http://127.0.0.1:4888/api/ask/threads/${TID} {"model":"claude-sonnet-5-5","effort":"high"}`), h.calls.join('\n'));
  await h.click(h.$('.ask-model-btn'));
  await h.click(h.$('.ask-pop-model [data-ask-effort-row]'));
  const efforts = h.$$('.ask-pop-model .ask-effort-item');
  assert.deepEqual(efforts.map((e) => e.textContent.replace('✓', '')), ['low', 'high']);
  await h.click(efforts[0]);
  assert.equal(h.$('.ask-model-btn-effort').textContent, 'low');
  await typeAndSend(h, 'x');
  assert.deepEqual([posts[0].model, posts[0].effort], ['claude-sonnet-5-5', 'low']);
});

test('model: a stored pick the catalog still offers survives a reload; an unknown one falls back to the default', async () => {
  const a = rig();
  const h = await bootSidebar({ storage: { ...STORE, 'worca.askPick': { model: 'claude-sonnet-5-5', effort: 'low' } }, route: a.route });
  assert.equal(h.$('.ask-model-btn-label').textContent, 'Sonnet 5.5');
  stopSidebar();
  const b = rig();
  const h2 = await bootSidebar({ storage: { ...STORE, 'worca.askPick': { model: 'gone', effort: 'low' } }, route: b.route });
  assert.equal(h2.$('.ask-model-btn-label').textContent, 'Opus 5.5');
});

test('model: a pick made before the first message is what that message uses (a new thread has no model yet)', async () => {
  const { route, posts } = rig();
  const h = await bootSidebar({ storage: STORE, route });
  await h.click(h.$('.ask-model-btn'));
  await h.click(h.$$('.ask-pop-model .ask-model-item')[1]);
  await typeAndSend(h, 'first');
  assert.deepEqual([posts[0].model, posts[0].effort], ['claude-sonnet-5-5', 'high']);
});

test('scope: the pill reads "Any project"; picking a project pins it and PATCHes the open thread', async () => {
  const { route } = rig(null, { threads: [{ id: TID, title: 'A' }] });
  const h = await bootSidebar({ storage: STORE, route });
  const pill = h.$('.ask-scope-btn');
  assert.equal(h.$('.ask-scope-label').textContent, 'Any project');
  assert.equal(pill.title, 'Worca picks the project from your message');
  await h.change(h.$('.chat-head select[aria-label="Chat"]'), TID);
  await h.click(pill);
  const pop = h.$('.ask-pop-scope');
  assert.equal(pop.querySelector('.ask-pop-caption').textContent, 'Chat scope');
  const items = [...pop.querySelectorAll('.ask-scope-item')];
  assert.deepEqual(items.map((i) => i.querySelector('.ask-model-name').textContent), ['Any project', 'ACME API', 'ACME Web']);
  assert.ok(items[0].querySelector('.ask-model-check'));
  await h.click(items[2]);
  assert.equal(h.$('.ask-scope-label').textContent, 'ACME Web');
  assert.ok(pill.classList.contains('is-pinned') && pill.hasAttribute('data-pinned'));
  assert.ok(h.calls.some((c) => c.endsWith(`/api/ask/threads/${TID} {"scope":{"pinned":true,"projectKey":"acme-web"}}`)));
});

test('scope: a failed load says so with Retry; an empty Worca offers Open Worca', async () => {
  let fail = true;
  const a = rig((p) => (fail && p === '/api/projects' ? ok({ error: 'boom' }, 500) : null));
  const h = await bootSidebar({ storage: STORE, route: a.route });
  await h.click(h.$('.ask-scope-btn'));
  const pop = h.$('.ask-pop-scope');
  assert.match(pop.textContent, /Couldn't load projects/);
  assert.doesNotMatch(pop.textContent, /No projects/);
  fail = false;
  const before = h.calls.length;
  await h.click([...pop.querySelectorAll('.ask-scope-item')].find((b) => b.textContent === 'Retry'));
  assert.deepEqual(h.paths().slice(before).sort(), ['/api/projects', '/api/workspaces']);
  assert.deepEqual([...h.$('.ask-pop-scope').querySelectorAll('.ask-scope-item')].map((i) => i.querySelector('.ask-model-name').textContent), ['Any project', 'ACME API', 'ACME Web']);
  stopSidebar();
  const b = rig(null, { projects: [] });
  const h2 = await bootSidebar({ storage: STORE, route: b.route });
  await h2.click(h2.$('.ask-scope-btn'));
  assert.match(h2.$('.ask-pop-scope').textContent, /No projects in this Worca yet/);
  await h2.click([...h2.$$('.ask-pop-scope .ask-scope-item')].find((x) => x.textContent === 'Open Worca'));
  assert.deepEqual(h2.tabsCreated, [{ url: 'http://127.0.0.1:4888' }]);
});

test('scope: a pinned chat keeps its pin on the pill while projects fail to load (never "Any project")', async () => {
  const snap = SNAP(TID);
  snap.thread.context = { pinned: true, projectKey: 'acme-web' };
  const { route } = rig((p, o, m) => (p === '/api/projects' ? ok({ error: 'boom' }, 500) : p === `/api/ask/threads/${TID}` && m === 'GET' ? ok(snap) : null), { threads: [{ id: TID, title: 'A' }] });
  const h = await bootSidebar({ storage: STORE, route });
  await h.change(h.$('.chat-head select[aria-label="Chat"]'), TID);
  const pill = h.$('.ask-scope-btn');
  assert.equal(h.$('.ask-scope-label').textContent, 'acme-web');
  assert.ok(pill.classList.contains('is-pinned') && pill.hasAttribute('data-pinned'));
  assert.equal(pill.title, 'This chat is pinned to acme-web');
});

test('meter: cost and the context ring from the thread totals; the ring opens the context popover', async () => {
  const snap = SNAP(TID);
  snap.thread.totals = { costUsd: 0.42, ctx: 120400, ctxWindow: 1000000, turns: 1 };
  const { route } = rig((p, o, m) => (p === `/api/ask/threads/${TID}` && m === 'GET' ? ok(snap) : null), { threads: [{ id: TID, title: 'A' }] });
  const h = await bootSidebar({ storage: STORE, route });
  await h.change(h.$('.chat-head select[aria-label="Chat"]'), TID);
  assert.equal(h.$('.ask-meter-cost').textContent, '$0.42');
  assert.equal(h.$('.ask-ctx-ring-arc').getAttribute('stroke-dasharray'), '12.04 100');
  assert.equal(h.$('.ask-ctx-ring').getAttribute('aria-label'), 'Context window, 12% full');
  await h.click(h.$('.ask-ctx-ring'));
  const pop = h.$('.ask-pop-ctx');
  assert.ok(pop);
  assert.equal(pop.querySelector('.ask-pop-caption-meter').textContent, '120.4k / 1M (12%)');
  assert.equal(pop.querySelectorAll('.ask-ctx-stat').length, 3);
  assert.match(pop.textContent, /This chat so far: \$0\.42/);
});

test('capture: the camera asks the service worker; a capture becomes an image chip; Send carries the PNG and page-capture.md', async () => {
  const { route, posts } = rig();
  const h = await bootSidebar({ storage: STORE, route });
  await deliverTab(h, TAB);
  await h.click(h.$('[data-wx-capture-btn]'));
  assert.deepEqual(h.posted.at(-1), { type: 'capture' });
  await h.fromBackground({ type: 'capture', image: { name: 'screenshot-1.png', mime: 'image/png', bytes: 3, dataBase64: 'iVBORw==', width: 10, height: 10 },
    meta: { url: 'http://fixture.test/page.html', title: 'Rate limits', viewport: { width: 1280, height: 720, dpr: 1 }, rect: { x: 1, y: 2, width: 30, height: 40 }, selector: '#para', snippet: '<p id="para">x</p>' } });
  const thumb = h.$('.ask-chip img.ask-chip-thumb');
  assert.ok(thumb);
  assert.equal(thumb.getAttribute('src'), 'data:image/png;base64,iVBORw==');
  assert.match(h.$('.wx-sends').textContent, /1 screenshot with their page details/);
  await typeAndSend(h, 'What is this?');
  const names = posts[0].attachments.map((a) => a.name);
  assert.deepEqual(names, ['screenshot-1.png', 'page-context.md', 'page-capture.md']);
  const md = dec(posts[0].attachments[2].dataBase64);
  assert.match(md, /selector: #para/);
  assert.match(md, /url: http:\/\/fixture\.test\/page\.html/);
});

test('capture: Esc in the sidebar cancels a pending overlay (focus stays here, so the page never sees the key)', async () => {
  const { route } = rig();
  const h = await bootSidebar({ storage: STORE, route });
  const esc = () => { const e = new h.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); h.$('textarea.ask-input').dispatchEvent(e); return e; };
  esc();
  assert.ok(!h.posted.some((m) => m.type === 'capture-cancel'), 'no overlay up: Esc is the sidebar\'s own');
  await h.fromBackground({ type: 'capture-state', on: true });
  const e = esc();
  assert.deepEqual(h.posted.at(-1), { type: 'capture-cancel' });
  assert.ok(e.defaultPrevented);
  await h.fromBackground({ type: 'capture-state', on: false });
  const n = h.posted.length;
  esc();
  assert.equal(h.posted.length, n, 'the overlay is gone: Esc no longer cancels anything');
});

test('capture-failed and notices show in the composer line', async () => {
  const { route } = rig();
  const h = await bootSidebar({ storage: STORE, route });
  await h.fromBackground({ type: 'capture-failed', error: 'Switch back to the page to capture it.' });
  assert.equal(h.$('.ask-composer-msg').textContent, 'Switch back to the page to capture it.');
  await h.fromBackground({ type: 'notice', text: 'Select some text on the page first, then press the shortcut again.' });
  assert.match(h.$('.ask-composer-msg').textContent, /Select some text/);
});

test('running Action: the page\'s run pre-pins an "Any project" chat and is named in the page context', async () => {
  const action = { url: 'http://localhost:5173', projectKey: 'acme-web', workspaceId: null, runId: 'r1', runTitle: 'Fix checkout' };
  const { route, posts } = rig((p) => (p === MATCH ? ok({ match: action }) : null));
  const h = await bootSidebar({ storage: STORE, route });
  await deliverTab(h, { type: 'tab', tabId: 7, readable: true, title: 'Cart', url: 'http://localhost:5173/cart' });
  assert.equal(h.$('.ask-scope-label').textContent, 'ACME Web');
  assert.match(h.$('.wx-sends').textContent, /the running worca run it belongs to/);
  await typeAndSend(h, 'Why is the cart empty?');
  assert.deepEqual(posts[0].context.pinned, true);
  assert.equal(posts[0].context.projectKey, 'acme-web');
  assert.match(dec(posts[0].attachments[0].dataBase64), /worca run: Fix checkout \(run id r1, project acme-web\)/);
});

test('running Action: a scope the user picked is never overridden; "Any project" after a pre-pin sticks', async () => {
  const action = { url: 'http://localhost:5173', projectKey: 'acme-web', workspaceId: null, runId: 'r1', runTitle: 'Fix checkout' };
  const { route } = rig((p) => (p === MATCH ? ok({ match: action }) : null));
  const h = await bootSidebar({ storage: STORE, route });
  await h.click(h.$('.ask-scope-btn'));
  await h.click([...h.$$('.ask-pop-scope .ask-scope-item')].find((x) => x.textContent === 'ACME API'));
  await deliverTab(h, { type: 'tab', tabId: 7, readable: true, title: 'Cart', url: 'http://localhost:5173/cart' });
  assert.equal(h.$('.ask-scope-label').textContent, 'ACME API', 'the user\'s pick stays');
  stopSidebar();
  const b = rig((p) => (p === MATCH ? ok({ match: action }) : null));
  const h2 = await bootSidebar({ storage: STORE, route: b.route });
  await deliverTab(h2, { type: 'tab', tabId: 7, readable: true, title: 'Cart', url: 'http://localhost:5173/cart' });
  assert.equal(h2.$('.ask-scope-label').textContent, 'ACME Web', 'pre-pinned');
  await h2.click(h2.$('.ask-scope-btn'));
  await h2.click([...h2.$$('.ask-pop-scope .ask-scope-item')].find((x) => x.textContent.startsWith('Any project')));
  await deliverTab(h2, { type: 'tab', tabId: 7, readable: true, title: 'Cart 2', url: 'http://localhost:5173/cart?2' });
  assert.equal(h2.$('.ask-scope-label').textContent, 'Any project', 'the user chose Any project; it sticks');
});

test('settings: the paired head reveals Settings; the Pinpoint option is stored', async () => {
  const { route } = rig();
  const h = await bootSidebar({ storage: STORE, route });
  const details = h.$('.chat-convo details.wx-settings');
  assert.ok(details && details.hidden, 'hidden until asked for');
  await h.click(h.$('.chat-head [data-wx-settings-btn]'));
  assert.ok(!details.hidden && details.open);
  assert.equal(details.querySelector('summary').textContent, 'Settings');
  const box = h.doc.getElementById('wx-pinpoint-select');
  assert.equal(box.checked, false);
  box.checked = true;
  box.dispatchEvent(new h.win.Event('change', { bubbles: true }));
  await h.flush();
  assert.equal(h.store['worca.pinpointOnSelect'], true);
});
