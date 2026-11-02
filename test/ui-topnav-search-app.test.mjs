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
// `holds`: path → a promise the answer waits for (a test may add one after boot, and lift `down` entries too).
async function boot({ down = {}, flags = '', threads = [], arms = [], holds = {} } = {}) {
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
    const arm = [...arms, ...ARMS].find(([p]) => path === p);
    if (arm) {
      const answer = { ok: true, status: 200, json: async () => arm[1]() };
      return holds[path] ? holds[path].then(() => answer) : Promise.resolve(answer);
    }
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
    { name: 'an Add-ons row → its place, found by an alternative word too (A-6)', run: async () => {
      const ctx = await boot();
      await searchPick(ctx, 'plugins', 'Browse plugins');
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

// ── Marketplace plugins and Add-ons inner rows ─────────────────────────────
const ZERO = { taskSources: 0, chatChannels: 0, mcpServers: 0, models: 0, agents: 0, scripts: 0, skills: 0, workflows: 0 };
const JIRA = { name: 'jira', version: '1.0.0', pinnedSha: 'a'.repeat(40), repo: 'https://github.com/acme/plugins', subdir: 'plugins/jira',
  marketplace: 'acme', marketplaceName: 'Acme', enabled: true, linked: false, broken: false, apiMismatch: null, pythonMissing: false,
  ignored: [], mcpSets: [], skillSets: [], contributions: { ...ZERO, taskSources: 1 }, description: 'Jira task source', ref: null,
  latest: null, setup: { ok: true, missing: [], noProfiles: [] }, notes: [], hasSettings: true };
const ACME = { id: 'acme', name: 'Acme', url: 'https://github.com/acme/plugins', ref: 'main', warnings: [], lastError: null,
  lastSync: { sha: 'b'.repeat(40), at: '2026-10-20T10:00:00.000Z' },
  plugins: [
    { name: 'jira', subdir: 'plugins/jira', description: 'Jira task source', version: '1.0.0', installed: true, notes: [], inventory: { taskSources: [{ id: 'jira', displayName: 'Jira', secrets: [] }] } },
    { name: 'slack-chat', subdir: 'plugins/slack-chat', description: 'Slack chat channel', version: '0.2.0', installed: false, notes: [],
      inventory: { chatChannels: [{ id: 'slack', displayName: 'Slack', secrets: [] }] } },
  ] };
const MARKET_ARMS = [
  ['/api/plugins', () => ({ plugins: [JIRA], orphans: [] })],
  ['/api/marketplaces', () => ({ marketplaces: [ACME] })],
  ['/api/marketplaces/refresh', () => ({ ok: true, marketplaces: [ACME] })],
  ['/api/chat/status', () => ({ channels: [] })],
  ['/api/plugins/jira', () => ({ plugin: {}, inventory: { taskSources: [{ id: 'jira', displayName: 'Jira' }] }, repo: 'https://github.com/acme/plugins',
    subdir: 'plugins/jira', sha: 'a'.repeat(40), installedAt: null, updatedAt: null, webUrl: null })],
  ['/api/plugins/jira/config', () => ({ sources: [{ id: 'jira', multiProfile: false, profile: null, profiles: [],
    schema: [{ key: 'baseUrl', label: 'Base URL', required: true }], values: { baseUrl: '' } }], channels: [] })],
];
const sheet = (doc) => doc.getElementById('mk-sheet');
// searchPick types right after ⌘K, before loadTopnavLazy settles: rows that come from the lazy reads (plugins,
// marketplaces, MCP servers) need the open to settle first.
async function searchPickLoaded(ctx, query, title) {
  ctx.key(ctx.doc.body, 'k', { metaKey: true });
  await settle(ctx.window, 8);
  ctx.type(query);
  ctx.click(title);
  await settle(ctx.window, 8);
}

test('Plugins rows open the manage or install sheet; a plugin settings row lands on the Settings field', async () => {
  await checkRows([
    { name: 'an installed plugin → #marketplace/installed/jira, its manage sheet', run: async () => {
      const ctx = await boot({ arms: MARKET_ARMS });
      await searchPickLoaded(ctx, 'jira', 'jira');
      await settle(ctx.window, 16);
      assert.equal(ctx.window.location.hash, '#marketplace/installed/jira');
      assert.equal(sheet(ctx.doc)?.dataset.mode, 'manage');
    } },
    { name: '"jira settings" (Add-ons) → the manage sheet with the first settings field focused', run: async () => {
      const ctx = await boot({ arms: MARKET_ARMS });
      await searchPickLoaded(ctx, 'jira settings', 'jira settings');
      await settle(ctx.window, 16);
      assert.equal(ctx.window.location.hash, '#marketplace/installed/jira/settings');
      assert.equal(ctx.doc.activeElement, ctx.doc.querySelector('#mk-sheet [data-key="baseUrl"]'));
    } },
    { name: 'an available plugin → #marketplace/browse/acme/slack-chat, its install sheet; the installed jira is not listed as available', run: async () => {
      const ctx = await boot({ arms: MARKET_ARMS });
      ctx.key(ctx.doc.body, 'k', { metaKey: true });
      await settle(ctx.window, 8);
      ctx.type('jira');
      assert.deepEqual([...ctx.doc.querySelectorAll('#tsearch-pop .tsearch-opt-plugin .tsearch-meta')].map((n) => n.textContent), ['Installed']);
      ctx.type('slack');
      ctx.click('slack-chat');
      await settle(ctx.window, 16);
      assert.equal(ctx.window.location.hash, '#marketplace/browse/acme/slack-chat');
      assert.equal(sheet(ctx.doc)?.dataset.mode, 'install');
    } },
  ]);
});

test('the plugin lists are read once and kept until plugins-changed; never the marketplace network refresh', async () => {
  const ctx = await boot({ arms: MARKET_ARMS });
  const open = async () => { ctx.key(ctx.doc.body, 'k', { metaKey: true }); await settle(ctx.window, 8); };
  await open();
  const first = ctx.count('/api/plugins');
  assert.ok(first >= 1);
  await open(); await open();                           // close, then open again
  assert.equal(ctx.count('/api/plugins'), first, 'a second open reads nothing new');
  ctx.recv({ type: 'plugins-changed', action: 'install' });
  await open(); await open();
  assert.equal(ctx.count('/api/plugins'), first + 1, 'plugins-changed makes the next open read again');
  assert.equal(ctx.count('/api/marketplaces/refresh'), 0, 'the search never syncs marketplaces');
});

test('Add-ons inner rows land on their row or card and flash it', async () => {
  const isFound = (n) => !!n && n.classList.contains('is-found');
  await checkRows([
    { name: '"openai key" → #providers/openai, the OpenAI-compatible row flashed, its key field focused', run: async () => {
      const ctx = await boot({ arms: [['/api/providers', () => ({})]] });
      await searchPick(ctx, 'openai key', 'OpenAI-compatible');
      await settle(ctx.window, 8);
      assert.equal(ctx.window.location.hash, '#providers/openai');
      const row = ctx.doc.querySelector('#providers-list .mv-pv-row[data-provider="openai"]');
      assert.ok(isFound(row.closest('.mv-pv-card') || row));
      assert.equal(ctx.doc.activeElement, row.querySelector('.mv-pv-key'));
    } },
    { name: '"helper model" at Expert → #models/engine-settings-card, the Engines card flashed', run: async () => {
      const ctx = await boot();
      await searchPick(ctx, 'helper model', 'Helper job models');
      assert.equal(ctx.window.location.hash, '#models/engine-settings-card');
      assert.ok(found(ctx.doc, 'engine-settings-card'));
    } },
    { name: '"helper model" at Advanced is locked: the mode dialog opens, nothing routes', run: async () => {
      const ctx = await boot();
      ctx.doc.documentElement.dataset.level = 'advanced';
      const before = ctx.window.location.hash;
      await searchPick(ctx, 'helper model', 'Helper job models');
      assert.ok(modeOpen(ctx.doc));
      assert.equal(ctx.window.location.hash, before);
    } },
    { name: 'an MCP server by name → #connectors/servers/<id>, its row flashed', run: async () => {
      const ctx = await boot({ arms: [
        ['/api/mcp/servers', () => ({ newer: false, servers: [{ id: 'manual:linear', base: 'linear', provisional: false, source: 'manual', sourceLabel: 'Added by you',
          type: 'stdio', description: 'Linear issues', fields: [], inSets: [], tools: null, pluginDisabled: false, inClaudeConfig: false, retired: null }] })],
        ['/api/mcp/sets', () => ({ sets: [] })],
      ] });
      await searchPickLoaded(ctx, 'linear', 'linear');
      await settle(ctx.window, 8);
      assert.equal(ctx.window.location.hash, '#connectors/servers/manual%3Alinear');
      assert.ok(isFound(ctx.doc.querySelector('.mcp-server-row[data-server="manual:linear"]')));
    } },
    { name: 'your own model → #models/model/my-gpt: the catalogue search the user left is cleared and the row flashed', run: async () => {
      const MODEL = { id: 'my-gpt', label: 'My GPT', efforts: ['high'], engine: 'claude', env: {} };
      const ctx = await boot({ arms: [
        ['/api/config', () => ({ config: { steps: {}, customModels: [] }, models: [{ ...MODEL, custom: 'global', hasEnv: false, routed: false }], efforts: [] })],
        ['/api/models', () => ({ models: [MODEL], plugin: [], policy: [], predefined: [], efforts: ['high'], codex: [], copilot: [] })],
        ['/api/providers', () => ({})],
      ] });
      ctx.window.location.hash = '#models';
      await settle(ctx.window, 8);
      const search = ctx.doc.querySelector('#models-list .mv-search');
      search.value = 'zzz';
      search.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
      assert.equal(ctx.doc.querySelector('#models-list .mv-card[data-id="my-gpt"]'), null, 'the user narrowed the catalogue');
      await searchPick(ctx, 'my gpt', 'My GPT');
      await settle(ctx.window, 8);
      assert.equal(ctx.window.location.hash, '#models/model/my-gpt');
      assert.ok(isFound(ctx.doc.querySelector('#models-list .mv-card[data-id="my-gpt"]')));
    } },
  ]);
});

// A model pick clears every narrowing the catalogue keeps (search box, chip, Just imported, a folded group).
const MY_GPT = { id: 'my-gpt', label: 'My GPT', efforts: ['high'], engine: 'claude', env: {} };
const MODEL_ARMS = [
  ['/api/config', () => ({ config: { steps: {}, customModels: [] }, models: [{ ...MY_GPT, custom: 'global', hasEnv: false, routed: false }], efforts: [] })],
  ['/api/models', () => ({ models: [MY_GPT], plugin: [], policy: [], predefined: [], efforts: ['high'], codex: [], copilot: [] })],
  ['/api/providers', () => ({})],
];
const myGptCard = (doc) => doc.querySelector('#models-list .mv-card[data-id="my-gpt"]');
const isFound = (n) => !!n && n.classList.contains('is-found');
const press = (ctx, node) => node.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));

test('a model pick lands on its row whatever the catalogue was narrowed by: a chip, Just imported, a folded group', async () => {
  const onModels = async (arms = []) => {
    const ctx = await boot({ arms: [...arms, ...MODEL_ARMS] });
    ctx.window.location.hash = '#models';
    await settle(ctx.window, 8);
    return ctx;
  };
  const pickMyGpt = async (ctx) => {
    await searchPick(ctx, 'my gpt', 'My GPT');
    await settle(ctx.window, 8);
    assert.equal(ctx.window.location.hash, '#models/model/my-gpt');
    assert.ok(isFound(myGptCard(ctx.doc)), 'the row is shown and flashed');
  };
  await checkRows([
    { name: 'the Built-in chip on: the pick goes back to All', run: async () => {
      const ctx = await onModels();
      press(ctx, ctx.doc.querySelector('#models-list .mv-filters [data-filter="builtin"]'));
      assert.equal(myGptCard(ctx.doc), null, 'the chip hides your own models');
      await pickMyGpt(ctx);
      assert.equal(ctx.doc.querySelector('#models-list .mv-filters [data-filter="all"]').getAttribute('aria-pressed'), 'true');
    } },
    { name: 'Just imported on: the pick drops the import filter and its chip', run: async () => {
      const ctx = await onModels([
        ['/api/providers', () => ({ copilot: { connected: true } })],
        ['/api/providers/copilot/models', () => ({ models: [{ id: 'gpt-5', name: 'GPT-5', vendor: 'OpenAI' }] })],
        ['/api/providers/copilot/import-models', () => ({ created: ['copilot-gpt-5'], updated: [], skipped: [] })],
      ]);
      press(ctx, ctx.doc.getElementById('model-import-btn'));
      await settle(ctx.window, 8);
      const cb = ctx.doc.querySelector('#mimp-body .mvi-cb');
      cb.checked = true;
      cb.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
      press(ctx, ctx.doc.getElementById('mimp-go'));
      await settle(ctx.window, 16);
      press(ctx, ctx.doc.querySelector('#models-list .mv-filters [data-filter="imported"]'));
      assert.equal(myGptCard(ctx.doc), null, 'Just imported hides my-gpt');
      await pickMyGpt(ctx);
      assert.equal(ctx.doc.querySelector('#models-list .mv-filters [data-filter="imported"]'), null);
    } },
    { name: 'Your models folded: the pick unfolds the group', run: async () => {
      const ctx = await onModels();
      press(ctx, ctx.doc.querySelector('#models-list .mv-sec-toggle[data-section="global"]'));
      const group = () => ctx.doc.querySelector('#models-list .mv-section[data-section="global"]');
      assert.ok(group().classList.contains('is-folded'), 'the user folded Your models');
      await pickMyGpt(ctx);
      assert.equal(group().classList.contains('is-folded'), false);
    } },
  ]);
});

test('a failed plugin read leaves the lists stale: the next open reads again and lists what it missed', async () => {
  const down = { '/api/marketplaces': 500 };
  const ctx = await boot({ arms: MARKET_ARMS, down });
  const toggle = async () => { ctx.key(ctx.doc.body, 'k', { metaKey: true }); await settle(ctx.window, 8); };
  await toggle();
  ctx.type('slack');
  assert.equal(ctx.titles().includes('slack-chat'), false, 'the catalogue read failed');
  const reads = ctx.count('/api/marketplaces');
  delete down['/api/marketplaces'];                     // the server is back
  await toggle(); await toggle();                       // close, open again
  assert.equal(ctx.count('/api/marketplaces'), reads + 1, 'the failed read is retried on the next open');
  ctx.type('slack');
  assert.ok(ctx.titles().includes('slack-chat'));
});

test('the Marketplace page\'s own reads refill the plugin lists: the search open reads nothing more', async () => {
  let plugins = [JIRA];
  const ctx = await boot({ arms: [['/api/plugins', () => ({ plugins, orphans: [] })], ...MARKET_ARMS] });
  ctx.window.location.hash = '#marketplace';
  await settle(ctx.window, 16);
  plugins = [JIRA, { ...JIRA, name: 'confluence', description: 'Confluence pages' }];
  ctx.recv({ type: 'plugins-changed', action: 'install' });   // the page re-reads by itself
  await settle(ctx.window, 16);
  const reads = ctx.count('/api/plugins');
  ctx.key(ctx.doc.body, 'k', { metaKey: true });
  await settle(ctx.window, 8);
  assert.equal(ctx.count('/api/plugins'), reads, 'no read beyond the page\'s own');
  ctx.type('confluence');
  assert.ok(ctx.titles().includes('confluence'), 'the page\'s answer is the search\'s list');
});

// A pick whose page loads slowly: the user moved on before the answer came, so nothing is flashed and no sheet opens.
const deferred = () => { let release; const promise = new Promise((r) => { release = r; }); return { promise, release }; };
test('a landing that finishes after the user moved on flashes nothing and opens nothing', async () => {
  const moveOn = async (ctx, hold, hash) => {
    ctx.window.location.hash = hash;
    await settle(ctx.window, 8);
    hold.release();
    await settle(ctx.window, 16);
    assert.equal(ctx.doc.querySelector('.is-found'), null, `nothing flashed after moving to ${hash}`);
  };
  const modelRow = (to) => ({ name: `a model pick, then ${to}`, run: async () => {
    const hold = deferred();
    const holds = {};
    const ctx = await boot({ arms: MODEL_ARMS, holds });
    holds['/api/models'] = hold.promise;
    await searchPick(ctx, 'my gpt', 'My GPT');
    assert.equal(ctx.window.location.hash, '#models/model/my-gpt');
    await moveOn(ctx, hold, to);
  } });
  const providerRow = (to) => ({ name: `a provider pick, then ${to}`, run: async () => {
    const hold = deferred();
    const ctx = await boot({ arms: [['/api/providers', () => ({})]], holds: { '/api/providers': hold.promise } });
    await searchPick(ctx, 'openai key', 'OpenAI-compatible');
    assert.equal(ctx.window.location.hash, '#providers/openai');
    await moveOn(ctx, hold, to);
  } });
  const serverRow = (to) => ({ name: `an MCP server pick, then ${to}`, run: async () => {
    const hold = deferred();
    const holds = {};
    const ctx = await boot({ holds, arms: [
      ['/api/mcp/servers', () => ({ newer: false, servers: [{ id: 'manual:linear', base: 'linear', provisional: false, source: 'manual', sourceLabel: 'Added by you',
        type: 'stdio', description: 'Linear issues', fields: [], inSets: [], tools: null, pluginDisabled: false, inClaudeConfig: false, retired: null }] })],
      ['/api/mcp/sets', () => ({ sets: [] })],
    ] });
    ctx.key(ctx.doc.body, 'k', { metaKey: true });
    await settle(ctx.window, 8);
    ctx.type('linear');
    holds['/api/mcp/servers'] = hold.promise;
    ctx.click('linear');
    await settle(ctx.window, 8);
    assert.equal(ctx.window.location.hash, '#connectors/servers/manual%3Alinear');
    await moveOn(ctx, hold, to);
  } });
  await checkRows([
    modelRow('#models'),
    modelRow('#providers/model/my-gpt'),
    providerRow('#providers'),
    providerRow('#models/openai'),
    serverRow('#connectors/servers'),
    serverRow('#models/servers/manual%3Alinear'),
    { name: 'a plugin pick, then another Marketplace tab: no manage sheet opens', run: async () => {
      const hold = deferred();
      const holds = {};
      const ctx = await boot({ arms: MARKET_ARMS, holds });
      ctx.key(ctx.doc.body, 'k', { metaKey: true });
      await settle(ctx.window, 8);
      ctx.type('jira');
      holds['/api/plugins'] = hold.promise;
      ctx.click('jira');
      await settle(ctx.window, 8);
      assert.equal(ctx.window.location.hash, '#marketplace/installed/jira');
      ctx.window.location.hash = '#marketplace/installed';
      await settle(ctx.window, 8);
      hold.release();
      await settle(ctx.window, 16);
      const host = ctx.doc.getElementById('mk-sheet-host');
      assert.ok(!host || host.classList.contains('hidden'), 'no sheet over the tab the user moved to');
    } },
  ]);
});

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

