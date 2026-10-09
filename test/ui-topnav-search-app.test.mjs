// test/ui-topnav-search-app.test.mjs — the top bar search inside the real app (app.js boots in jsdom):
// ⌘K opens the search and not Ask Worca, rows come from the live runs, History, projects and the lazy
// workflow / schedule reads (fetched once per open), each row routes, the Ask Worca row hands over to
// the chat, and the Escape that closes the search never steps a run's detail back.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const AGO = (ms) => new Date(Date.now() - ms).toISOString();

const ARMS = [
  ['/api/history', () => ({ pipelines: [{ id: 'p1', projectKey: 'proj-0000beef', projectName: 'proj', title: 'Login page polish', status: 'done',
    startedAt: AGO(864e5), mtime: AGO(864e5) }] })],
  ['/api/projects', () => ({ projects: [{ key: 'proj-0000beef', name: 'proj', path: '/repos/proj', exists: true }] })],
  ['/api/workspaces', () => ({ workspaces: [{ id: 'wks-team-0000abcd', name: 'Team', projectKeys: ['proj-0000beef'], projectPaths: ['/repos/proj'] }] })],
  ['/api/workflows', () => ({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_nightly', name: 'Nightly login sweep' }] })],
  ['/api/schedules', () => ({ schedules: [{ id: 'sch_1', title: 'Login smoke', sentence: 'Every day at 02:00', status: 'active' }], tickets: [], counts: {} })],
];

// `down`: path → 'reject' (the network fails) or an HTTP status (the server answers with an error).
async function boot({ down = {} } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {}
    close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  const calls = [];
  window.fetch = (u, opts) => {
    const url = String(u);
    calls.push(url);
    const path = url.split('?')[0];
    if (down[path] === 'reject') return Promise.reject(new TypeError('Failed to fetch'));
    if (down[path]) return Promise.resolve({ ok: false, status: down[path], json: async () => ({ error: 'down' }) });
    const arm = ARMS.find(([p]) => path === p);
    if (arm) return Promise.resolve({ ok: true, status: 200, json: async () => arm[1]() });
    if (path.startsWith('/api/ask/threads')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ threads: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  lastWs._l.open?.forEach((fn) => fn());
  recv({ type: 'hello', runs: [{ runId: 'r1', title: 'Fix login', projectDir: '/repos/proj', status: 'running', startedAt: AGO(6e4), kind: 'run',
    pipelineId: null, pendingQuestion: null, pauseReason: null }], ask: [] });
  await settle(window, 8);
  const doc = window.document;
  const input = doc.getElementById('tsearch-input');
  const key = (target, k, init = {}) => {
    const e = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    return e;
  };
  const type = (text) => { input.value = text; input.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const titles = () => [...doc.querySelectorAll('#tsearch-pop [role="option"] .tsearch-title')].map((n) => n.textContent);
  const click = (title) => {
    const o = [...doc.querySelectorAll('#tsearch-pop [role="option"]')].find((x) => x.querySelector('.tsearch-title').textContent === title);
    assert.ok(o, `"${title}" is listed`);
    o.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  };
  const count = (path) => calls.filter((u) => u.split('?')[0] === path).length;
  return { window, doc, input, key, type, titles, click, count, recv };
}

async function settle(window, n = 4) {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0));
}

test('⌘K opens the top bar search, not Ask Worca; the rows come from the runs, History, projects and the lazy reads', async () => {
  const { window, doc, input, key, type, titles, count } = await boot();
  const before = { wf: count('/api/workflows'), sch: count('/api/schedules') };
  const e = key(doc.body, 'k', { metaKey: true });
  assert.equal(e.defaultPrevented, true);
  assert.equal(doc.activeElement, input);
  assert.equal(doc.querySelector('.ask-sheet').hidden, true, 'Ask Worca stays shut');
  assert.deepEqual(titles(), ['Fix login', 'Login page polish', 'Ask Worca'], 'nothing typed: runs only');
  await settle(window, 8);
  type('l');
  type('lo');
  type('login');
  await settle(window, 4);
  assert.deepEqual(titles(), ['Login page polish', 'Fix login', 'Login smoke', 'Nightly login sweep', 'Ask Worca'], 'prefix before word start');
  assert.equal(count('/api/workflows') - before.wf, 1, 'workflows: once for this open');
  assert.equal(count('/api/schedules') - before.sch, 1, 'schedules: once for this open');
  type('team');
  assert.deepEqual(titles(), ['Team', 'Ask Worca'], 'workspaces were loaded for the search');
  assert.equal(doc.querySelector('#tsearch-pop .tsearch-meta').textContent, 'Workspace · 1 project');
});

test('workflows and schedules down (a 500, a network failure): the runs, projects and workspaces still list, quietly', async () => {
  const { window, doc, key, type, titles, count } = await boot({ down: { '/api/workflows': 500, '/api/schedules': 'reject' } });
  const logged = [];
  const saved = { error: console.error, warn: console.warn };
  console.error = (...a) => logged.push(a);
  console.warn = (...a) => logged.push(a);
  try {
    const before = { wf: count('/api/workflows'), sch: count('/api/schedules') };
    key(doc.body, 'k', { metaKey: true });
    await settle(window, 8);
    type('login');
    await settle(window, 4);
    assert.deepEqual(titles(), ['Login page polish', 'Fix login', 'Ask Worca']);
    type('proj project');
    assert.deepEqual(titles(), ['proj', 'Team', 'Ask Worca'], 'the project, then the workspace whose meta matches');
    assert.equal(count('/api/workflows') - before.wf, 1, 'one try per open, no retry loop');
    assert.equal(count('/api/schedules') - before.sch, 1);
    assert.deepEqual(logged, [], 'nothing logged');
  } finally {
    console.error = saved.error;
    console.warn = saved.warn;
  }
});

test('one lazy read down: what the other one brought still lists', async () => {
  await checkRows([
    { name: 'schedules unreachable: the workflows still list', run: async () => {
      const { window, doc, key, type, titles } = await boot({ down: { '/api/schedules': 'reject' } });
      key(doc.body, 'k', { metaKey: true });
      await settle(window, 8);
      type('login');
      assert.deepEqual(titles(), ['Login page polish', 'Fix login', 'Nightly login sweep', 'Ask Worca']);
    } },
    { name: 'workflows answer 500: the schedules still list', run: async () => {
      const { window, doc, key, type, titles } = await boot({ down: { '/api/workflows': 500 } });
      key(doc.body, 'k', { metaKey: true });
      await settle(window, 8);
      type('login');
      assert.deepEqual(titles(), ['Login page polish', 'Fix login', 'Login smoke', 'Ask Worca']);
    } },
  ]);
});

test('⌘K from the Ask Worca composer moves to the search; with a confirm open it is left to the confirm', async () => {
  await checkRows([
    { name: 'the Ask composer has focus: the search opens and takes it', run: async () => {
      const { window, doc, input, key } = await boot();
      doc.querySelector('.ask-pill').click();
      await settle(window);
      const composer = doc.querySelector('textarea.ask-input');
      composer.focus();
      assert.equal(doc.activeElement, composer);
      const e = key(composer, 'k', { metaKey: true });
      assert.equal(e.defaultPrevented, true);
      assert.equal(doc.activeElement, input);
      assert.equal(doc.querySelector('#tsearch-pop').hidden, false);
    } },
    { name: 'the sheet was opened by pressing its pill: a press on a row keeps the search open over the chat, and the click routes', run: async () => {
      const { window, doc, input, key, type } = await boot();
      const pill = doc.querySelector('.ask-pill');
      pill.focus();                                // Chrome focuses a pressed button, so the sheet's close would hand focus back to it
      pill.click();
      await settle(window);
      const composer = doc.querySelector('textarea.ask-input');
      composer.focus();
      key(composer, 'k', { metaKey: true });
      type('fix');
      const row = [...doc.querySelectorAll('#tsearch-pop [role="option"]')].find((o) => o.querySelector('.tsearch-title').textContent === 'Fix login');
      assert.ok(row, '"Fix login" is listed');
      row.dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true }));
      const down = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
      row.dispatchEvent(down);
      assert.equal(down.defaultPrevented, true);
      assert.equal(doc.querySelector('#tsearch-pop').hidden, false, 'still open after the press');
      assert.equal(row.isConnected, true, 'the pressed row is still there for its click');
      assert.equal(doc.activeElement, input, 'focus stayed in the search');
      assert.equal(doc.querySelector('.ask-sheet').hidden, false, 'the press left the chat open');
      row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await settle(window);
      assert.equal(window.location.hash, '#running/r1');
      assert.equal(doc.querySelector('#tsearch-pop').hidden, true);
    } },
    { name: 'a confirm modal is open: no search, focus stays on the confirm, its Escape still cancels it', run: async () => {
      const { window, doc, key } = await boot();
      const modal = doc.getElementById('confirm-modal');
      modal.classList.remove('hidden');
      const ok = doc.getElementById('confirm-ok');
      ok.focus();
      const e = key(ok, 'k', { ctrlKey: true });
      assert.equal(e.defaultPrevented, false);
      assert.equal(doc.querySelector('#tsearch-pop').hidden, true);
      assert.equal(doc.activeElement, ok);
      const esc = key(ok, 'Escape');
      assert.equal(esc.defaultPrevented, false, 'the search does not consume an Escape it does not hold');
      await settle(window);
    } },
  ]);
});

test('each row routes; the Ask Worca row hands what was typed to the chat', async () => {
  await checkRows([
    { name: 'a live run → #running/r1', run: async () => {
      const { window, doc, key, type, click } = await boot();
      key(doc.body, 'k', { metaKey: true });
      type('fix');
      click('Fix login');
      await settle(window);
      assert.equal(window.location.hash, '#running/r1');
      assert.equal(doc.querySelector('#tsearch-pop').hidden, true);
      assert.equal(doc.getElementById('tsearch-input').value, '');
    } },
    { name: 'a finished run → #history/<projectKey>/<id>', run: async () => {
      const { window, doc, key, type, click } = await boot();
      key(doc.body, 'k', { metaKey: true });
      type('polish');
      click('Login page polish');
      await settle(window);
      assert.equal(window.location.hash, '#history/proj-0000beef/p1');
    } },
    { name: 'a project → #projects/<key>', run: async () => {
      const { window, doc, key, type, click } = await boot();
      key(doc.body, 'k', { metaKey: true });
      type('proj project');
      click('proj');
      await settle(window);
      assert.equal(window.location.hash, '#projects/proj-0000beef');
    } },
    { name: 'a series → #schedules/repeating', run: async () => {
      const { window, doc, key, type, click } = await boot();
      key(doc.body, 'k', { metaKey: true });
      await settle(window, 8);
      type('smoke');
      click('Login smoke');
      await settle(window);
      assert.equal(window.location.hash, '#schedules/repeating');
    } },
    { name: 'Ask Worca with text: the chat opens with it in the composer', run: async () => {
      const { window, doc, key, type, click } = await boot();
      key(doc.body, 'k', { metaKey: true });
      type('  why did the login run fail ');
      click('Ask Worca');
      await settle(window);
      assert.equal(doc.querySelector('.ask-sheet').hidden, false);
      assert.equal(doc.querySelector('textarea.ask-input').value, 'why did the login run fail');
      assert.equal(doc.activeElement, doc.querySelector('textarea.ask-input'));
    } },
    { name: 'Ask Worca with nothing typed: the chat just opens', run: async () => {
      const { window, doc, key, click } = await boot();
      key(doc.body, 'k', { metaKey: true });
      click('Ask Worca');
      await settle(window);
      assert.equal(doc.querySelector('.ask-sheet').hidden, false);
      assert.equal(doc.querySelector('textarea.ask-input').value, '');
    } },
  ]);
});

test('the Escape that closes the search never steps an open run back to the list', async () => {
  const { window, doc, input, key } = await boot();
  window.location.hash = 'running/r1';
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window);
  doc.getElementById('runs-shell').dataset.layout = 'slide';    // where a run's Escape does route back
  key(doc.body, 'k', { metaKey: true });
  assert.equal(doc.activeElement, input);
  const e = key(input, 'Escape');
  await settle(window);
  assert.equal(e.defaultPrevented, true);
  assert.equal(doc.querySelector('#tsearch-pop').hidden, true);
  assert.equal(window.location.hash, '#running/r1');
  key(doc.body, 'Escape');
  await settle(window);
  assert.equal(window.location.hash, '#runs', 'with the search shut, Escape is the page’s again');
});
