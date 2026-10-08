// test/ui-settings-engines.test.mjs — Settings › Models engine section (plans/cascading-settings-design.md §6): a Default
// engine row and a card per engine with step and helper rows; the Claude helper cards move into the Claude card; Save
// posts runEngine / stepModels / utilityModels. Boot copied from test/ui-settings-title-model.test.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { renderEngineSection, renderAskEngineSection, enginePatchToSettingsBody, ENGINE_EFFORTS, utilityId } from '../ui/public/engine-settings-view.mjs';
import { EFFORTS, CODEX_EFFORTS } from '../src/core/model-env.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const CATALOG = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', engine: 'claude', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
  { id: 'gpt-5.5', label: 'GPT-5.5', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'], custom: false, builtin: true },
];
const STEPS = [{ key: 'planner', label: 'Plan' }, { key: 'reviewer', label: 'Review' }];

test('the efforts the UI offers are the engines\' own', () => {
  assert.deepEqual(ENGINE_EFFORTS.claude, EFFORTS);
  assert.deepEqual(ENGINE_EFFORTS.codex, CODEX_EFFORTS);
  assert.equal(utilityId('codex', 'title'), 'models.codex.utility.title');
  assert.equal(utilityId('codex', 'workspaceScan'), 'models.codex.workspaceScan');
});

test('enginePatchToSettingsBody maps setting ids onto the settings keys', () => {
  assert.deepEqual(enginePatchToSettingsBody({
    'run.engine': 'codex', 'models.codex.steps.planner': { model: 'gpt-5.5' }, 'models.claude.steps.reviewer': null,
    'models.codex.utility.title': { model: 'gpt-5.5', effort: 'low' }, 'models.codex.memoryDefrag': null,
  }), {
    runEngine: 'codex',
    stepModels: { codex: { planner: { model: 'gpt-5.5' } }, claude: { reviewer: null } },
    utilityModels: { codex: { title: { model: 'gpt-5.5', effort: 'low' }, memoryDefrag: null } },
  });
});

test('renderEngineSection: a row per role and job, each engine\'s models only', () => {
  const doc = new JSDOM('<!doctype html><div id="h"></div>').window.document;
  const host = doc.getElementById('h');
  const extra = renderEngineSection(host, { level: 'user', roles: STEPS, catalog: CATALOG, fields: {
    'run.engine': { own: 'codex', inherited: { value: 'claude', source: 'default' } },
  }, jobs: { claude: [], codex: ['title', 'workspaceScan'] } });
  assert.equal(host.querySelector('[data-setting="run.engine"] .inherit-input').value, 'codex');
  assert.deepEqual([...host.querySelectorAll('.engine-card')].map((c) => c.dataset.engine), ['claude', 'codex', 'cursor']);
  const codexPlan = host.querySelector('.engine-card[data-engine="codex"] [data-setting="models.codex.steps.planner"] .inherit-model');
  assert.deepEqual([...codexPlan.options].map((o) => o.value), ['', 'gpt-5.5']);
  assert.ok(host.querySelector('[data-setting="models.codex.workspaceScan"]'));
  assert.equal(host.querySelector('[data-setting="models.claude.utility.title"]'), null, 'Claude helpers are the existing cards at your level');
  assert.ok(extra.claude.classList.contains('engine-card-extra'));
});

test('renderEngineSection: the Cursor card has step rows, no helper rows, its own default label and the Claude-helpers note', () => {
  const doc = new JSDOM('<!doctype html><div id="h"></div>').window.document;
  const host = doc.getElementById('h');
  renderEngineSection(host, { level: 'user', roles: STEPS, catalog: [...CATALOG, { id: 'my-cursor-m', label: 'my-cursor-m', engine: 'cursor', efforts: [], custom: 'global' }],
    fields: {}, jobs: { claude: [], codex: ['title'], cursor: [] } });
  assert.deepEqual([...host.querySelectorAll('[data-setting="run.engine"] option')].map((o) => o.value).filter(Boolean), ['claude', 'codex', 'copilot', 'cursor']);
  assert.deepEqual([...host.querySelectorAll('.engine-card')].map((c) => c.dataset.engine), ['claude', 'codex', 'cursor'], 'Copilot owns no models: no card');
  const card = host.querySelector('.engine-card[data-engine="cursor"]');
  assert.equal(card.querySelector('h3').textContent, 'Cursor');
  const plan = card.querySelector('[data-setting="models.cursor.steps.planner"] .inherit-model');
  assert.deepEqual([...plan.options].map((o) => o.value), ['', 'my-cursor-m']);
  assert.match(plan.options[0].textContent, /Cursor's default model/);
  assert.equal(card.querySelector('.engine-helpers'), null, 'no helper rows');
  assert.match(card.querySelector('.hint').textContent, /Helper jobs \(titles, overview, PR description, Auto classifier, Away mode's decider\) run on Claude on a Cursor run\./);
  assert.ok(card.querySelector('.engine-card-status'), 'a status line app.js fills');
  assert.equal(host.querySelector('.engine-card[data-engine="claude"] .engine-card-status'), null);
  assert.deepEqual(enginePatchToSettingsBody({ 'models.cursor.steps.planner': { model: 'my-cursor-m' } }), { stepModels: { cursor: { planner: { model: 'my-cursor-m' } } } });
});

test('renderAskEngineSection offers no Cursor engine', () => {
  const doc = new JSDOM('<!doctype html><div id="h"></div>').window.document;
  const host = doc.getElementById('h');
  renderAskEngineSection(host, { catalog: CATALOG });
  assert.deepEqual([...host.querySelectorAll('[data-setting="askEngine"] option')].map((o) => o.value).filter(Boolean), ['claude', 'codex']);
});

async function boot(settings = {}, { hash = 'settings', engines = null } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const posts = [];
  const body = () => ({ root: '/w', projectsRoot: '/p', projectsRootDefault: '/p', default: {}, chat: {}, titleModel: null,
    titleModelEffective: { model: null, source: 'run', stale: null }, hideBuiltinModels: false, ...settings });
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const ok = (b) => Promise.resolve({ ok: true, status: 200, json: async () => b });
    if (u.includes('/api/settings')) {
      if (method === 'POST') { const b = JSON.parse(opts.body); posts.push(b); return ok({ ...body(), ...b }); }
      return ok(body());
    }
    if (u.includes('/api/projects')) return ok({ projects: [] });
    if (engines && u.endsWith('/api/engines')) return ok({ engines });
    return ok({ config: { steps: {}, customModels: [] }, models: CATALOG, steps: STEPS, efforts: ['medium', 'high'] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  // '#settings' runs loadSettings, which paints every Settings card (the Models pane's included), as the title test does.
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  for (let i = 0; i < 8; i++) await tick();
  return { window, doc: window.document, posts, tick };
}

test('Settings › Models: stored picks paint, the Claude helper cards sit in the Claude card, Save posts the changes', async () => {
  const { doc, window, posts, tick } = await boot({ runEngine: 'codex', stepModels: { codex: { planner: { model: 'gpt-5.5', effort: 'low' } } }, utilityModels: {} });
  const root = doc.getElementById('engine-settings-root');
  assert.ok(root, 'the section is on the Models tab');
  assert.equal(root.querySelector('[data-setting="run.engine"] .inherit-input').value, 'codex');
  assert.equal(root.querySelector('[data-setting="models.codex.steps.planner"] .inherit-model').value, 'gpt-5.5');
  assert.ok(doc.querySelector('.engine-card[data-engine="claude"] .models-helpers #titleModel'), 'Title generation now lives in the Claude card');
  const eng = root.querySelector('[data-setting="run.engine"] .inherit-input');
  eng.value = '';
  eng.dispatchEvent(new window.Event('change', { bubbles: true }));
  const rev = root.querySelector('[data-setting="models.codex.steps.reviewer"] .inherit-model');
  rev.value = 'gpt-5.5';
  rev.dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.getElementById('engineSettingsSave').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(posts.at(-1), { runEngine: null, stepModels: { codex: { reviewer: { model: 'gpt-5.5' } } } });
  assert.equal(doc.getElementById('engineSettingsMsg').textContent, 'Saved.');
});

test('opening Settings › Models directly paints the Engines card (a link or a reload lands there)', async () => {
  const { doc } = await boot({ runEngine: 'codex' }, { hash: 'settings/models' });
  const root = doc.getElementById('engine-settings-root');
  assert.equal(root.querySelector('[data-setting="run.engine"] .inherit-input')?.value, 'codex', 'painted without visiting another Settings tab first');
  assert.ok(doc.querySelector('#titleModel')?.options.length > 1, 'the Claude helper pickers too');
});

test('Settings › Models: each non-Claude card says whether its engine is ready (GET /api/engines)', async () => {
  const { doc } = await boot({}, { hash: 'settings/models', engines: [
    { name: 'claude', label: 'Claude', ready: true, reason: null },
    { name: 'codex', label: 'Codex', ready: true, reason: 'could not check the codex sign-in' },
    { name: 'cursor', label: 'Cursor', ready: false, reason: 'cursor-agent is not signed in' },
  ] });
  const status = (e) => doc.querySelector(`.engine-card[data-engine="${e}"] .engine-card-status`)?.textContent;
  assert.equal(status('cursor'), 'Not ready — cursor-agent is not signed in');
  assert.equal(status('codex'), 'Ready — could not check the codex sign-in');
  assert.equal(status('claude'), undefined, 'the Claude card has no status line');
  const { doc: none } = await boot({}, { hash: 'settings/models' });
  assert.equal(none.querySelector('.engine-card[data-engine="cursor"] .engine-card-status').textContent, '', 'no engines array: an empty line');
});
