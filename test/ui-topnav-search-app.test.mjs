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
// `flags`: data-flags on the shell's html element, as the server renders it. `threads`: the /api/ask/threads?q= answer.
async function boot({ down = {}, flags = '', threads = [] } = {}) {
  const raw = readFileSync(htmlPath, 'utf8');
  const dom = trackDom(new JSDOM(flags ? raw.replace('<html lang="en"', `<html lang="en" data-flags="${flags}"`) : raw, { url: 'http://localhost:4317/' }));
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
    if (path.startsWith('/api/ask/threads')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ threads: url.includes('q=') ? threads : [] }) });
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
  return { window, doc, input, key, type, titles, click, count, recv, calls };
}

async function settle(window, n = 4) {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0));
}

test('⌘K opens the top bar search, not Ask in Chat; the rows come from the runs, History, projects and the lazy reads', async () => {
  const { window, doc, input, key, type, titles, count } = await boot();
  const before = { wf: count('/api/workflows'), sch: count('/api/schedules') };
  const e = key(doc.body, 'k', { metaKey: true });
  assert.equal(e.defaultPrevented, true);
  assert.equal(doc.activeElement, input);
  assert.deepEqual(titles(), ['Fix login', 'Login page polish', 'Ask in Chat'], 'nothing typed: runs only');
  await settle(window, 8);
  type('l');
  type('lo');
  type('login');
  await settle(window, 4);
  assert.deepEqual(titles(), ['Login page polish', 'Fix login', 'Login smoke', 'Nightly login sweep', 'Ask in Chat'], 'prefix before word start');
  assert.equal(count('/api/workflows') - before.wf, 1, 'workflows: once for this open');
  assert.equal(count('/api/schedules') - before.sch, 1, 'schedules: once for this open');
  type('team');
  assert.deepEqual(titles(), ['Team', 'Ask in Chat'], 'workspaces were loaded for the search');
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
    assert.deepEqual(titles(), ['Login page polish', 'Fix login', 'Ask in Chat']);
    type('proj project');
    assert.deepEqual(titles(), ['proj', 'Team', 'Ask in Chat'], 'the project, then the workspace whose meta matches');
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
      assert.deepEqual(titles(), ['Login page polish', 'Fix login', 'Nightly login sweep', 'Ask in Chat']);
    } },
    { name: 'workflows answer 500: the schedules still list', run: async () => {
      const { window, doc, key, type, titles } = await boot({ down: { '/api/workflows': 500 } });
      key(doc.body, 'k', { metaKey: true });
      await settle(window, 8);
      type('login');
      assert.deepEqual(titles(), ['Login page polish', 'Fix login', 'Login smoke', 'Ask in Chat']);
    } },
  ]);
});

test('⌘K from the Chat composer moves to the search; with a confirm open it is left to the confirm', async () => {
  await checkRows([
    { name: 'the chat composer has focus: the search opens and takes it', run: async () => {
      const { window, doc, input, key } = await boot();
      await settle(window);
      const composer = doc.querySelector('textarea.ask-input');
      composer.focus();
      assert.equal(doc.activeElement, composer);
      const e = key(composer, 'k', { metaKey: true });
      assert.equal(e.defaultPrevented, true);
      assert.equal(doc.activeElement, input);
      assert.equal(doc.querySelector('#tsearch-pop').hidden, false);
    } },
    { name: 'on the Chat page a press on a row keeps the search open over the chat, and the click routes', run: async () => {
      const { window, doc, input, key, type } = await boot();
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
      assert.equal(doc.querySelector('[data-view="chat"]').classList.contains('hidden'), false, 'the press left the Chat page showing');
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

test('each row routes; the Ask in Chat row hands what was typed to the chat', async () => {
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
    // Ask worca beside the page (L7): on another page the row is "Ask worca · with this page" and opens the side column.
    { name: 'Ask worca with text, from another page: the side column opens with it in the composer, the page stays', run: async () => {
      const { window, doc, key, type, click } = await boot();
      window.location.hash = '#runs';
      await settle(window);
      assert.equal(doc.querySelector('[data-view="chat"]').classList.contains('hidden'), true, 'precondition: another page');
      key(doc.body, 'k', { metaKey: true });
      type('  why did the login run fail ');
      click('Ask worca');
      await settle(window);
      assert.equal(window.location.hash, '#runs');
      assert.equal(doc.getElementById('ask-side').hidden, false);
      assert.equal(doc.querySelector('#ask-side textarea.ask-input').value, 'why did the login run fail');
      assert.equal(doc.activeElement, doc.querySelector('#ask-side textarea.ask-input'));
    } },
    { name: 'Ask worca with nothing typed, from another page: the side column just opens', run: async () => {
      const { window, doc, key, click } = await boot();
      window.location.hash = '#runs';
      await settle(window);
      key(doc.body, 'k', { metaKey: true });
      click('Ask worca');
      await settle(window);
      assert.equal(window.location.hash, '#runs');
      assert.equal(doc.getElementById('ask-side').hidden, false);
      assert.equal(doc.querySelector('#ask-side textarea.ask-input').value, '');
      assert.equal(doc.activeElement, doc.querySelector('#ask-side textarea.ask-input'));
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

// ── Settings and Add-ons rows (FEAT-1): the route, the highlight, and the hand-off after a locked pick ──
async function searchPick(ctx, query, title) {
  ctx.key(ctx.doc.body, 'k', { metaKey: true });
  ctx.type(query);
  ctx.click(title);
  await settle(ctx.window, 8);
}
const modeOpen = (doc) => !doc.getElementById('mode-modal').classList.contains('hidden');
const found = (doc, id) => doc.getElementById(id).classList.contains('is-found');

test('Settings and Add-ons rows route to their own address; a setting is scrolled to and highlighted (R-po-2/9/13)', async () => {
  await checkRows([
    { name: 'a tab → #settings/guardrails', run: async () => {
      const ctx = await boot();
      await searchPick(ctx, 'guardrails', 'Guardrails');
      assert.equal(ctx.window.location.hash, '#settings/guardrails');
      assert.ok(!ctx.doc.querySelector('.settings-pane[data-tab="guardrails"]').classList.contains('hidden'));
    } },
    { name: 'a General setting → #settings/general/appearance-card, highlighted, then the highlight fades (A-7)', run: async () => {
      const ctx = await boot();
      await searchPick(ctx, 'dark mode', 'Appearance');
      assert.equal(ctx.window.location.hash, '#settings/general/appearance-card', 'the sub survives on General');
      assert.ok(found(ctx.doc, 'appearance-card'));
      await new Promise((r) => setTimeout(r, 3100));
      assert.ok(!found(ctx.doc, 'appearance-card'));
    } },
    { name: 'picking the setting already open replays the highlight (same hash, no hashchange)', run: async () => {
      const ctx = await boot();
      await searchPick(ctx, 'budget', 'Budget & cost limits');
      ctx.doc.getElementById('budget-settings-card').classList.remove('is-found');
      await searchPick(ctx, 'budget', 'Budget & cost limits');
      assert.ok(found(ctx.doc, 'budget-settings-card'));
    } },
    { name: 'an Add-ons row → its page, found by an alternative word too (A-6)', run: async () => {
      const ctx = await boot();
      await searchPick(ctx, 'plugins', 'Marketplace');
      assert.equal(ctx.window.location.hash, '#marketplace');
    } },
  ]);
});

test('a mode-locked pick opens the mode dialog; the mode that unlocks it takes the user on; a closed dialog forgets (R-po-16/20/21)', async () => {
  await checkRows([
    { name: 'Simple: Away mode → the dialog; Expert-only Spawn diagnostics stays; Advanced → the card, highlighted', run: async () => {
      const ctx = await boot();
      ctx.doc.documentElement.dataset.level = 'simple';
      const before = ctx.window.location.hash;
      await searchPick(ctx, 'away mode', 'Away mode');
      assert.ok(modeOpen(ctx.doc), 'R-po-16: the place where the mode is changed');
      assert.equal(ctx.window.location.hash, before, 'not on the locked setting');
      ctx.doc.querySelector('#mode-cards [data-level-choice="advanced"]').click();
      await settle(ctx.window, 8);
      assert.ok(!modeOpen(ctx.doc));
      assert.equal(ctx.window.location.hash, '#settings/runs/night-settings-card');
      assert.ok(found(ctx.doc, 'night-settings-card'));
    } },
    { name: 'a mode below the one needed keeps the dialog open and the pick armed (edge: unlocking something else)', run: async () => {
      const ctx = await boot();
      ctx.doc.documentElement.dataset.level = 'simple';
      const before = ctx.window.location.hash;
      await searchPick(ctx, 'spawn', 'Spawn diagnostics');
      ctx.doc.querySelector('#mode-cards [data-level-choice="advanced"]').click();
      await settle(ctx.window, 8);
      assert.ok(modeOpen(ctx.doc));
      assert.equal(ctx.window.location.hash, before);
      ctx.doc.querySelector('#mode-cards [data-level-choice="expert"]').click();
      await settle(ctx.window, 8);
      assert.equal(ctx.window.location.hash, '#settings/general/debug-spawn-settings-card');
    } },
    { name: 'Done first, then Advanced from the account menu: nothing moves (A-10)', run: async () => {
      const ctx = await boot();
      ctx.doc.documentElement.dataset.level = 'simple';
      const before = ctx.window.location.hash;
      await searchPick(ctx, 'away mode', 'Away mode');
      ctx.doc.getElementById('mode-done').click();
      ctx.doc.querySelector('#lvl-menu [data-level-choice="advanced"]').click();
      await settle(ctx.window, 8);
      assert.equal(ctx.doc.documentElement.dataset.level, 'advanced');
      assert.equal(ctx.window.location.hash, before);
    } },
    { name: 'the Settings reload of the route answers before the mode is saved: the old mode never comes back', run: async () => {
      const ctx = await boot();
      ctx.doc.documentElement.dataset.level = 'simple';
      const base = ctx.window.fetch;
      let release = null;
      globalThis.fetch = ctx.window.fetch = (u, opts = {}) => {
        if (String(u).split('?')[0] !== '/api/settings') return base(u, opts);
        if (opts.method === 'POST') {
          return new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => ({ uiLevel: 'advanced' }) }); });
        }
        return base(u, opts).then((res) => ({ ...res, json: async () => ({ ...(await res.json()), uiLevel: 'simple' }) }));
      };
      await searchPick(ctx, 'away mode', 'Away mode');
      ctx.doc.querySelector('#mode-cards [data-level-choice="advanced"]').click();
      await settle(ctx.window, 8);
      assert.equal(ctx.window.location.hash, '#settings/runs/night-settings-card');
      assert.equal(ctx.doc.documentElement.dataset.level, 'advanced', 'the read that predates the save is not applied');
      assert.ok(found(ctx.doc, 'night-settings-card'));
      release();
      await settle(ctx.window, 8);
      assert.equal(ctx.doc.documentElement.dataset.level, 'advanced');
    } },
  ]);
});

test('a Labs-locked pick opens its row in Labs; turning it on takes the user on; leaving Labs forgets (R-po-15/19/21)', async () => {
  await checkRows([
    { name: 'Labels → #settings/experimental/runLabels; runLabels on → the card, highlighted', run: async () => {
      const ctx = await boot();
      await searchPick(ctx, 'labels', 'Labels');
      assert.equal(ctx.window.location.hash, '#settings/experimental/runLabels');
      ctx.recv({ type: 'flags', flags: { runLabels: true } });
      await settle(ctx.window, 8);
      assert.equal(ctx.window.location.hash, '#settings/tags/labels-settings-card');
      assert.ok(found(ctx.doc, 'labels-settings-card'));
    } },
    { name: 'Cost tags left Labs: its pick goes straight to the card', run: async () => {
      const ctx = await boot();
      await searchPick(ctx, 'cost tags', 'Cost tags');
      assert.equal(ctx.window.location.hash, '#settings/tags/tag-dims-settings-card');
      assert.ok(found(ctx.doc, 'tag-dims-settings-card'));
    } },
    { name: 'leaving Labs, then turning the flag on elsewhere: nothing moves', run: async () => {
      const ctx = await boot();
      await searchPick(ctx, 'labels', 'Labels');
      ctx.window.location.hash = '#runs';
      await settle(ctx.window, 8);
      ctx.recv({ type: 'flags', flags: { runLabels: true } });
      await settle(ctx.window, 8);
      assert.equal(ctx.window.location.hash, '#runs');
    } },
  ]);
});

const CHAT = (i) => ({ id: `ask_0000000${i}`, title: `Login chat ${i}`, updatedAt: AGO(i * 6e4), archivedAt: null, archived: false });

test('#948 s2: a typed chat title lists under Chats, first on #chat and after Runs on #runs, 5 rows at most', async () => {
  const threads = Array.from({ length: 7 }, (_, i) => CHAT(i + 1));
  const { window, doc, input, key, type, calls } = await boot({ threads });
  const labels = () => [...doc.querySelectorAll('#tsearch-pop .tsearch-label')].map((n) => n.textContent);
  const chatOpts = () => doc.querySelectorAll('#tsearch-pop [role="option"].tsearch-opt-chat').length;
  window.location.hash = '#chat';
  await settle(window, 4);
  assert.equal(input.placeholder, 'Search chats or ask');
  key(doc.body, 'k', { metaKey: true });
  type('login');
  await new Promise((r) => setTimeout(r, 200));   // past the 150ms debounce
  await settle(window, 4);
  assert.ok(calls.some((u) => u.startsWith('/api/ask/threads?limit=5&q=login')));
  assert.equal(labels()[0], 'Chats');
  assert.equal(chatOpts(), 5);
  key(input, 'Escape');
  window.location.hash = '#runs';
  await settle(window, 4);
  assert.equal(input.placeholder, 'Search or ask');
  key(doc.body, 'k', { metaKey: true });
  type('login');
  await new Promise((r) => setTimeout(r, 200));
  await settle(window, 4);
  assert.deepEqual(labels().slice(0, 2), ['Runs', 'Chats']);
});

