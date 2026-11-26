// test/ui-models-entry-points-app.test.mjs — every way into the Models page from elsewhere lands on the right
// tab and the right thing, inside the real app (app.js boots in jsdom, the harness of
// test/ui-topnav-search-app.test.mjs): Marketplace, a plugin's "Used by" Open and Ask worca's model card
// (#models, the Catalogue), "Add model…" in a New run picker (step 1 of Add model), Design › Pictures
// "Set up" and the account menu's free requests (their Providers row unfolded), the top bar search
// (a Providers row, a model's side panel, the Roles block), Settings' Smart run naming link (the Helper
// jobs card) and the old bookmarks #providers/speech and #settings/models. `#models` stays `#models`,
// never `#models/catalogue`.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { landing } from '../ui/public/marketplace/kinds.mjs';

const trackDom = useDomRelease(afterEach);
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const AGO = (ms) => new Date(Date.now() - ms).toISOString();
const GENERIC = { config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 };

const ARMS = [
  ['/api/history', () => ({ pipelines: [{ id: 'p1', projectKey: 'proj-0000beef', projectName: 'proj', title: 'Login page polish', status: 'done',
    startedAt: AGO(864e5), mtime: AGO(864e5) }] })],
  ['/api/projects', () => ({ projects: [{ key: 'proj-0000beef', name: 'proj', path: '/repos/proj', exists: true }] })],
  ['/api/workspaces', () => ({ workspaces: [{ id: 'wks-team-0000abcd', name: 'Team', projectKeys: ['proj-0000beef'], projectPaths: ['/repos/proj'] }] })],
  ['/api/workflows', () => ({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_nightly', name: 'Nightly login sweep' }] })],
  ['/api/schedules', () => ({ schedules: [{ id: 'sch_1', title: 'Login smoke', sentence: 'Every day at 02:00', status: 'active' }], tickets: [], counts: {} })],
];

// Your own model, for the search row (test/ui-topnav-search-app.test.mjs MODEL_ARMS).
const MY_GPT = { id: 'my-gpt', label: 'My GPT', efforts: ['high'], engine: 'claude', env: {} };
const MODEL_ARMS = [
  ['/api/config', () => ({ config: { steps: {}, customModels: [] }, models: [{ ...MY_GPT, custom: 'global', hasEnv: false, routed: false }], efforts: [] })],
  ['/api/models', () => ({ models: [MY_GPT], plugin: [], policy: [], predefined: [], efforts: ['high'], codex: [], copilot: [] })],
  ['/api/providers', () => ({})],
];
// The account menu's free-request row draws only when OpenRouter's daily count is on and known
// (test/ui-account-corner.test.mjs FREE).
const FREE = { enabled: true, known: true, limit: 50, remaining: 4, resetAt: new Date(Date.now() + 3 * 3600000).toISOString(), models: [] };
const COMMON_ARMS = [
  ['/api/settings', () => ({ ...GENERIC, uiLevel: 'expert' })],
  ['/api/openrouter/free-daily', () => FREE],
  ...MODEL_ARMS,
];

// New run: a project and a saved workflow, so the agent rows exist (test/ui-newpipeline-engine-models.test.mjs).
const PROJECT = '/tmp/proj-engine';
const MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['medium', 'high', 'max'], engine: 'claude' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], engine: 'claude' },
  { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['minimal', 'low', 'medium', 'high'], engine: 'codex', builtin: true },
];
const AGENTS = [
  { key: 'planner', displayName: 'Plan', color: 'violet', fanOut: true },
  { key: 'reviewer', displayName: 'Review', color: 'blue', fanOut: false },
];
const WF = {
  id: 'wf_t', name: 'Tuned',
  steps: [[{ id: 'n0', key: 'planner', defaults: { model: 'claude-opus-4-8', effort: 'high' } }], [{ id: 'n1', key: 'reviewer' }]],
  feedbacks: [],
};
const NEW_RUN_ARMS = [
  ['/api/projects', () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] })],
  ['/api/workflows', () => ({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: WF.id, name: WF.name }] })],
  [`/api/workflows/${WF.id}`, () => WF],
  [`/api/workflows/${WF.id}/defaults`, () => ({ workflow: WF, defaults: {} })],
  ['/api/agents', () => ({ agents: AGENTS })],
  ['/api/config', () => ({ config: { steps: {}, customModels: [], workflows: {} }, models: MODELS, efforts: ['medium', 'high', 'max'],
    subagentModels: ['sonnet', 'opus', 'fable', 'auto', 'inherit'] })],
];

async function boot({ arms = [] } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {}
    close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (u) => {
    const url = String(u);
    const path = url.split('?')[0];
    const arm = [...arms, ...ARMS].find(([p]) => path === p);
    if (arm) return Promise.resolve({ ok: true, status: 200, json: async () => arm[1]() });
    if (path.startsWith('/api/ask/threads')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ threads: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => GENERIC });
  };
  // + the element classes New run's change handler tests with instanceof (as test/ui-newpipeline-engine-models.test.mjs)
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'HTMLInputElement', 'HTMLSelectElement']) {
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
  // A throw in a listener never fails a test by itself (jsdom reports it on the window): collect them.
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.error?.message || e.message)));
  const doc = window.document;
  const input = doc.getElementById('tsearch-input');
  const key = (target, k, init = {}) => {
    const e = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    return e;
  };
  const type = (text) => { input.value = text; input.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const click = (title) => {
    const o = [...doc.querySelectorAll('#tsearch-pop [role="option"]')].find((x) => x.querySelector('.tsearch-title').textContent === title);
    assert.ok(o, `"${title}" is listed`);
    o.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  };
  return { window, doc, key, type, click, errors };
}

async function settle(window, n = 4) {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0));
}

async function searchPick(ctx, query, title) {
  ctx.key(ctx.doc.body, 'k', { metaKey: true });
  ctx.type(query);
  ctx.click(title);
  await settle(ctx.window, 8);
}

// as test/ui-models-catalogue-app.test.mjs: set the hash, dispatch hashchange (this harness's settle(window, 8))
async function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window, 8);
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function waitFor(pred, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) { if (Date.now() > end) throw new Error('waitFor timed out'); await tick(); }
}
async function openWf(window) {
  const doc = window.document;
  const p = doc.querySelector('#projectSelect');
  p.value = PROJECT; p.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  const w = doc.querySelector('#workflowSelect');
  w.value = WF.id; w.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => doc.querySelector('.step-model[data-node-id="n1"]'));
}

// The booted app of the current row.
let ctx, win, doc;

const TABS = ['catalogue', 'jobs', 'providers'];
// The Models page is shown on tab t: its view is shown and of the three panels only t's is.
const panelShown = (t) => !doc.querySelector('section.view[data-view="models"]').classList.contains('hidden')
  && TABS.every((x) => doc.getElementById(`models-tab-${x}`).hidden === (x !== t));
// A Providers row unfolded: its head says expanded and its body shows, on the Providers tab.
const rowOpen = (n) => panelShown('providers')
  && !!doc.querySelector(`section.mv-pv-card[data-row="${n}"] > button.mdl-fold[aria-expanded="true"]`)
  && doc.querySelector(`section.mv-pv-card[data-row="${n}"] > .mdl-fold-body`)?.hidden === false;
// A block flashed as found, on the tab that holds it.
const found = (id) => {
  const n = doc.getElementById(id);
  return !!n && n.classList.contains('is-found') && panelShown(n.closest('.mdl-panel').dataset.tab);
};
const follow = (href) => go(win, href);
const pickOption = (sel, v) => {
  assert.ok(sel, 'the picker is there');
  sel.value = v;
  assert.equal(sel.value, v, `the picker offers "${v}"`);
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
};
const link = (root, sel) => {
  const a = root.querySelector(sel);
  assert.ok(a, `${sel} is linked`);
  return a.getAttribute('href');
};
const clickAccountRow = (sel) => {
  const press = (el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  press(doc.getElementById('side-acct'));
  const row = doc.querySelector(`#acct-menu ${sel}`);
  assert.ok(row, `the account menu has ${sel}`);
  press(row);
};
// Settings › Runs, where the Smart run naming hint links its model (settings/settings.html:354, :468).
const settingsView = () => {
  const pane = doc.querySelector('.settings-pane[data-tab="runs"]');
  assert.equal(pane.classList.contains('hidden'), false, 'Settings › Runs is shown');
  return pane;
};
// Settings › Memory, where the Memory defragment line links its model (settings/settings.html .mem-model-link).
const memoryPane = () => {
  const pane = doc.querySelector('.settings-pane[data-tab="memory"]');
  assert.equal(pane.classList.contains('hidden'), false, 'Settings › Memory is shown');
  return pane;
};
// The Jobs tab's pressed harness tile.
const pressedHarness = () => doc.querySelector('#jobs-root .mdl-hx [aria-pressed="true"]')?.dataset.engine;
// An install whose default harness is Codex.
const CODEX_ARMS = [['/api/settings', () => ({ ...GENERIC, uiLevel: 'expert', runEngine: 'codex' })]];
// An install whose default harness is Cursor (no helper jobs).
const CURSOR_ARMS = [['/api/settings', () => ({ ...GENERIC, uiLevel: 'expert', runEngine: 'cursor' })]];

// [name, act, hash, check, arms]. A source that keeps its href private is followed by the href it renders, per its pin.
const WAYS = [
  ['Marketplace "Open in Models"', () => follow(landing('models').href), '#models', () => panelShown('catalogue')],    // marketplace/kinds.mjs:28,111
  ['plugin "Used by" Open', () => follow('#models'), '#models', () => panelShown('catalogue')],                         // marketplace-installed.test.mjs:263
  ['Ask worca model card', () => follow('#models'), '#models', () => panelShown('catalogue')],                          // ask-panel-card.test.mjs:955
  ['"Add model…" in a New run picker', async () => { await openWf(win); pickOption(doc.querySelector('.step-model[data-node-id="n1"]'), '__add__'); }, '#models',
    () => panelShown('catalogue') && !!doc.querySelector('#model-editor-modal:not(.hidden) #mv-editor-host .mdl-add[data-step="1"]'),
    NEW_RUN_ARMS],                                                                                                       // as ui-newpipeline-engine-models.test.mjs:145-172
  ['Design › Pictures "Set up"', () => follow('#models/providers/images'), '#models/providers/images', () => rowOpen('images')], // ui-design-library.test.mjs:257-259
  ['account menu free requests', () => clickAccountRow('.mc-free'), '#models/providers/openrouter', () => rowOpen('openrouter')],
  ['search "openai key"', () => searchPick(ctx, 'openai key', 'OpenAI-compatible'), '#models/providers/openai', () => rowOpen('openai')],
  ['search a model by name', () => searchPick(ctx, 'my gpt', 'My GPT'), '#models/model/my-gpt',
    () => panelShown('catalogue') && doc.querySelector('#model-panel-host aside#model-panel.mdl-side')?.getAttribute('aria-label') === 'My GPT'],
  ['search "Roles"', () => searchPick(ctx, 'Roles', 'Roles'), '#models/jobs/roles', () => found('jobs-roles')],
  // On a Codex install: Run naming is Claude's job only, so its link opens Claude Code's card all the same.
  ['Settings › Smart run naming model link', async () => { await go(win, '#settings/runs'); await follow(link(settingsView(), '#smartNamingModelHint a[href="#models/jobs/helpers/claude"]')); },
    '#models/jobs/helpers/claude', () => found('jobs-helpers') && pressedHarness() === 'claude', CODEX_ARMS],
  // A defragment run takes its run engine's own job (orchestrator.mjs defragSlotPair): Codex's card on a Codex install.
  ['Settings › Memory defragment model link', async () => { await go(win, '#settings/memory'); await follow(link(memoryPane(), '.mem-model-link a[href="#models/jobs/helpers/codex"]')); },
    '#models/jobs/helpers/codex', () => found('jobs-helpers') && pressedHarness() === 'codex', CODEX_ARMS],
  // A harness without the job (Cursor) runs it on its own Quick jobs role (settings-cascade.mjs utilityModelFor): its Roles.
  ['Settings › Memory defragment model link on a Cursor install', async () => { await go(win, '#settings/memory'); await follow(link(memoryPane(), '.mem-model-link a[href="#models/jobs/roles/cursor"]')); },
    '#models/jobs/roles/cursor', () => found('jobs-roles') && pressedHarness() === 'cursor', CURSOR_ARMS],
  ['old bookmark #providers/speech', () => go(win, '#providers/speech'), '#models/providers/speech', () => rowOpen('speech')],
  ['old bookmark #settings/models', () => go(win, '#settings/models'), '#models', () => panelShown('catalogue')],
];

for (const [name, act, hash, check, arms = []] of WAYS) {
  test(`a way into Models: ${name} lands on ${hash}`, async () => {
    ctx = await boot({ arms: [...arms, ...COMMON_ARMS] });
    win = ctx.window; doc = ctx.doc;
    await act();
    await settle(win, 8);
    assert.equal(win.location.hash, hash);
    assert.ok(check(), `${name}: the right tab and thing`);
    assert.deepEqual(ctx.errors, [], 'nothing threw on the way');
  });
}
