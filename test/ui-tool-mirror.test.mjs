// test/ui-tool-mirror.test.mjs — the tool panel's mirror client (issue 1064 slice 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabModel } from '../ui/public/tool-tabs.mjs';
import { createTabMirror, MIRROR_DEBOUNCE_MS } from '../ui/public/tool-mirror.mjs';

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
function rig(serverTabs = []) {
  const calls = [];
  const timers = [];
  const win = { setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {} };
  const fetch = async (url, o = {}) => { calls.push([o.method || 'GET', url, o.body ? JSON.parse(o.body) : null]); return { ok: true, json: async () => ({ tabs: serverTabs }) }; };
  let mirror;
  let n = 0;
  const model = createTabModel({ storage: memStore(), newId: () => `tab_t${(n += 1)}`, onChange: () => mirror?.schedule() });
  mirror = createTabMirror({ win, fetch, model });
  const run = async () => { while (timers.length) timers.shift()(); await new Promise((r) => setTimeout(r, 0)); };
  return { calls, model, mirror, run };
}
const CHAT = { type: 'chat', id: 'ask_0000aaaa', projectKey: 'app-1' };

test('one PUT per changed chat or project scope; run tabs never; an emptied scope sends []', async () => {
  const r = rig();
  r.model.open('browser', CHAT, { url: 'http://localhost:4400/', title: 'Page title' });
  r.model.open('files', { type: 'run', id: 'run-1' });
  await r.run();
  assert.deepEqual(r.calls, [['PUT', '/api/tools/tabs?scope=chat&threadId=ask_0000aaaa',
    { tabs: [{ id: 'tab_t1', kind: 'browser', url: 'http://localhost:4400/', at: r.model.get('tab_t1').at }], seen: [] }]]);
  r.calls.length = 0;
  r.model.activate({ project: 'app-1', side: CHAT }, 'tab_t1');   // a save that changes no list
  await r.run();
  assert.deepEqual(r.calls, []);
  r.model.close('tab_t1');
  await r.run();
  assert.deepEqual(r.calls.map((c) => [c[0], c[2].tabs]), [['PUT', []]]);
});

test('pull adopts only undelivered tabs, then the PUT names them as seen', async () => {
  const r = rig([{ id: 'tab_srv1', kind: 'browser', url: 'http://localhost:4400/x', delivered: false }, { id: 'tab_old', kind: 'files', delivered: true }]);
  const added = await r.mirror.pull(CHAT);
  assert.deepEqual(added.map((t) => t.id), ['tab_srv1']);
  await r.run();
  const p = r.calls.find((c) => c[0] === 'PUT');
  assert.deepEqual(p[2].seen, ['tab_srv1']);
  assert.deepEqual(p[2].tabs.map((t) => t.id), ['tab_srv1']);
  assert.deepEqual(await r.mirror.pull({ type: 'run', id: 'run-1' }), []);
});

// ── in the real app (app.js + index.html): the boot sync, a model change and the frame-driven pull ─────────────────────
const PK = 'app-0000aaaa';
const TID = 'ask_0000c0de';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function bootMirrored({ url, tools, serverTabs = () => [], thread = null }) {
  const { bootChat, ok } = await import('./helpers/chat-panel-boot.mjs');
  const puts = [];
  const ctx = await bootChat({ url, local: { 'worca-cc.tools': JSON.stringify(tools) }, arms: (u, opts) => {
    const path = u.split('?')[0];
    if (path.endsWith('/api/projects')) return ok({ projects: [{ key: PK, name: 'app', path: '/tmp/app' }] });
    if (path.endsWith('/api/tools/tabs')) {
      if (opts.method === 'PUT') { const b = JSON.parse(opts.body); puts.push({ q: u.split('?')[1], ...b }); return ok({ tabs: b.tabs }); }
      return ok({ tabs: serverTabs() });
    }
    if (thread && path.endsWith(`/api/ask/threads/${thread.id}`)) return ok({ thread, messages: [], attachments: [] });
    return null;
  } });
  await ctx.settle(8);
  return { ...ctx, doc: ctx.window.document, puts };
}

test('in the real app: the boot PUTs this browser\'s project tabs; closing one PUTs the shorter list', async () => {
  const tools = { v: 1, tabs: [{ id: 'tab_pm1', kind: 'files', scope: { type: 'project', id: PK }, state: {}, at: 1 },
    { id: 'tab_pm2', kind: 'files', scope: { type: 'project', id: PK }, state: {}, at: 2 }], active: {}, prefs: { width: 460 }, open: [`project:${PK}`] };
  const a = await bootMirrored({ url: `http://localhost:4317/#projects/${PK}`, tools });
  await wait(MIRROR_DEBOUNCE_MS + 100);
  const q = `scope=project&projectKey=${PK}`;
  assert.deepEqual(a.puts.map((p) => [p.q, p.tabs.map((t) => t.id)]), [[q, ['tab_pm1', 'tab_pm2']]], 'the boot sync, once');
  const close = a.doc.querySelector('.tool-panel .tool-tab-close[aria-label="Close Files 2"]');
  assert.ok(close, 'the project page shows its tabs');
  close.click();
  await wait(MIRROR_DEBOUNCE_MS + 100);
  assert.deepEqual(a.puts.slice(1).map((p) => [p.q, p.tabs.map((t) => t.id)]), [[q, ['tab_pm1']]], 'the model change was mirrored');
});

test('in the real app: an ask-tool-tabs frame for the chat on screen pulls the assistant\'s tab; the next PUT names it seen', async () => {
  const thread = { id: TID, title: 'Tabs', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', runLinks: 0 };
  let server = [];
  const a = await bootMirrored({ url: `http://localhost:4317/#chat/${TID}`, thread, serverTabs: () => server,
    tools: { v: 1, tabs: [], active: {}, prefs: { width: 460 } } });
  await wait(MIRROR_DEBOUNCE_MS + 100);
  assert.deepEqual(a.puts, [], 'nothing mirrored yet');
  server = [{ id: 'tab_as1', kind: 'files', openedBy: 'assistant', delivered: false, at: 5 }];
  a.dispatch({ type: 'ask-tool-tabs', threadId: 'ask_0000ffff' });   // another chat: not this page's business
  await a.settle(6);
  assert.ok(!a.doc.querySelector('.tool-panel .tool-tab-close[aria-label="Close Files"]'));
  a.dispatch({ type: 'ask-tool-tabs', threadId: TID });
  await a.settle(8);
  assert.ok(a.doc.querySelector('.tool-panel .tool-tab-close[aria-label="Close Files"]'), 'the assistant\'s tab joined the strip');
  assert.equal(a.doc.querySelector('.tool-panel').hidden, true, 'the assistant\'s tab never opens the panel');
  assert.ok(a.doc.querySelector('.tool-icon.has-dot[data-tool-kind="files"]'), 'its kind\'s header icon has the dot');
  await wait(MIRROR_DEBOUNCE_MS + 100);
  const last = a.puts.at(-1);
  assert.equal(last.q, `scope=chat&threadId=${TID}`);
  assert.deepEqual([last.tabs.map((t) => t.id), last.seen], [['tab_as1'], ['tab_as1']]);
});
