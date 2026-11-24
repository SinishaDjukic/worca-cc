import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createTabModel } from '../ui/public/tool-tabs.mjs';
import { createTabMirror, mirrorTab } from '../ui/public/tool-mirror.mjs';
import { createBrowserKind, hostLabel } from '../ui/public/tool-browser.mjs';
import { createFrameVerdicts } from '../ui/public/frame-verdicts.mjs';

const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const CHAT = { type: 'chat', id: 'ask_0000aaaa' };

test('mirror: files target, no att target, exact adopt, no att entry PUT', async () => {
  assert.deepEqual(mirrorTab({ id: 'tab_a', kind: 'files', state: { file: 'src/a.js', line: 3, root: 'run:abcd1234' }, at: 1 }).target, { path: 'src/a.js', line: 3, root: 'run:abcd1234' });
  assert.equal(mirrorTab({ id: 'tab_a', kind: 'files', state: { att: 'att_1', attName: 'x' }, at: 1 }).target, undefined);
  const calls = [];
  const timers = [];
  const win = { setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {} };
  const server = [{ id: 'tab_srv1', kind: 'files', delivered: false, target: { path: 'src/a.js', line: 7 } }];
  const fetch = async (url, o = {}) => { calls.push([o.method || 'GET', url, o.body ? JSON.parse(o.body) : null]); return { ok: true, json: async () => ({ tabs: server }) }; };
  let mirror; let n = 0;
  const model = createTabModel({ storage: memStore(), newId: () => `tab_t${(n += 1)}`, onChange: () => mirror?.schedule() });
  mirror = createTabMirror({ win, fetch, model });
  await mirror.pull(CHAT);
  assert.deepEqual(model.get('tab_srv1').state, { openedBy: 'assistant', file: 'src/a.js', line: 7 });
  model.open('files', CHAT, { att: 'att_1', attName: 'x.txt' });
  while (timers.length) timers.shift()(); await tick();
  const put = calls.filter((c) => c[0] === 'PUT').at(-1);
  assert.deepEqual(put[2].tabs.map((t) => t.id), ['tab_srv1']);
});

function browser({ frameCheck = null, frameRefused = () => false } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { url: 'http://localhost:4317/' });
  const win = dom.window;
  const tabs = new Map();
  const api = { tab: (id) => tabs.get(id), isMounted: (id) => tabs.has(id), scopeFor: (t) => t.scope,
    setTabState: (id, p) => { const t = tabs.get(id); for (const [k, v] of Object.entries(p)) { if (v === undefined) delete t.state[k]; else t.state[k] = v; } },
    openTab: () => null, close: (id) => tabs.delete(id), view: () => ({}) };
  const kind = createBrowserKind({ doc: win.document, win, fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }), storage: win.localStorage, loadTimeoutMs: 5, frameCheck, frameRefused });
  const host = win.document.getElementById('host');
  const tab = { id: 'tab_b1', kind: 'browser', scope: CHAT, state: { url: 'https://example.org/' } };
  tabs.set(tab.id, tab);
  return { win, host, kind, tab, api, mount: async () => { kind.mount(tab, host, api); await tick(); } };
}
test('browser: framable:false → note + Open externally, no slow hint; true keeps frame; refused → no iframe; host label', async () => {
  const no = browser({ frameCheck: async () => ({ framable: false }) });
  await no.mount(); await new Promise((r) => setTimeout(r, 20));
  assert.match(no.host.textContent, /This site cannot be shown here/);
  assert.ok([...no.host.querySelectorAll('button')].some((b) => b.textContent === 'Open externally'));
  assert.equal(no.host.querySelector('.tool-browser-slow'), null);
  const yes = browser({ frameCheck: async () => ({ framable: true }) });
  await yes.mount();
  assert.ok(yes.host.querySelector('iframe'));
  const ref = browser({ frameRefused: () => true });
  await ref.mount();
  assert.equal(ref.host.querySelector('iframe'), null);
  assert.deepEqual(hostLabel('https://xn--pple-43d.com/'), { host: 'xn--pple-43d.com', intl: true });
  const intl = browser();
  intl.tab.state.url = 'https://xn--pple-43d.com/';
  await intl.mount();
  assert.equal(intl.host.querySelector('.tool-browser-host.is-intl')?.textContent, 'xn--pple-43d.com');
});
test('frame verdicts: stored and reread; one POST per origin; failure stores nothing', async () => {
  const st = memStore();
  let posts = 0;
  const v = createFrameVerdicts({ fetch: async () => { posts++; await tick(1); return { ok: true, json: async () => ({ framable: false }) }; }, storage: st });
  await Promise.all([v.check('https://a.example/x'), v.check('https://a.example/y')]);
  assert.equal(posts, 1);
  assert.equal(createFrameVerdicts({ fetch: async () => null, storage: st }).refused('https://a.example'), true);
  const st2 = memStore();
  const f = createFrameVerdicts({ fetch: async () => { throw new Error('x'); }, storage: st2 });
  assert.deepEqual(await f.check('https://b.example/'), { framable: null });
  assert.equal(st2.getItem('worca-cc.frameRefused'), null);
});
