// test/ui-settings-engines.test.mjs — the Models page's Engines card (plans/cascading-settings-design.md §6): a Default
// engine row and a tab per engine with Step models and Helper jobs tables; Claude's helper jobs are its legacy settings
// keys (titleModel, autoWorkflowModel, prDescriptionModel, memoryDefrag); Save posts runEngine / stepModels / utilityModels.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { renderEngineSection, renderAskEngineSection, enginePatchToSettingsBody, ENGINE_EFFORTS, utilityId } from '../ui/public/engine-settings-view.mjs';
import { EFFORTS, CODEX_EFFORTS } from '../src/core/model-env.mjs';
import { applyFlags } from '../ui/public/flags.mjs';

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
  // Agent generation is Claude's alone, a pair on its own settings key.
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.utility.agentGen': { model: 'claude-opus-5-5', effort: 'high' } }),
    { agentGenModel: { model: 'claude-opus-5-5', effort: 'high' } });
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.utility.agentGen': null }), { agentGenModel: null });
  // So is Run naming (Smart run naming's model), on namingModel; Codex has no such slot.
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.utility.naming': { model: 'claude-opus-5-5', effort: 'high' } }),
    { namingModel: { model: 'claude-opus-5-5', effort: 'high' } });
  assert.deepEqual(enginePatchToSettingsBody({ 'models.claude.utility.naming': null }), { namingModel: null });
  assert.deepEqual(enginePatchToSettingsBody({ 'models.codex.utility.naming': { model: 'gpt-5.5' } }), {});
});

test('renderEngineSection: a row per role and job, each engine\'s models only', () => {
  const doc = new JSDOM('<!doctype html><div id="h"></div>').window.document;
  const host = doc.getElementById('h');
  const extra = renderEngineSection(host, { level: 'user', roles: STEPS, catalog: CATALOG, fields: {
    'run.engine': { own: 'codex', inherited: { value: 'claude', source: 'default' } },
  }, jobs: { claude: [], codex: ['title', 'workspaceScan'] } });
  assert.equal(host.querySelector('[data-setting="run.engine"] .inherit-input').value, 'codex');
  assert.deepEqual([...host.querySelectorAll('.engine-card')].map((c) => c.dataset.engine), ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'goose', 'opencode', 'qwen']);
  const codexPlan = host.querySelector('.engine-card[data-engine="codex"] [data-setting="models.codex.steps.planner"] .inherit-model');
  assert.deepEqual([...codexPlan.options].map((o) => o.value), ['', 'gpt-5.5']);
  assert.ok(host.querySelector('[data-setting="models.codex.workspaceScan"]'));
  assert.equal(host.querySelector('[data-setting="models.claude.utility.title"]'), null, 'no Claude jobs asked for, none rendered');
  assert.deepEqual(extra, {});
});

test('renderEngineSection: the Cursor card has step rows, no helper rows, its own default label and the Claude-helpers note', () => {
  const doc = new JSDOM('<!doctype html><div id="h"></div>').window.document;
  const host = doc.getElementById('h');
  renderEngineSection(host, { level: 'user', roles: STEPS, catalog: [...CATALOG, { id: 'my-cursor-m', label: 'my-cursor-m', engine: 'cursor', efforts: [], custom: 'global' }],
    fields: {}, jobs: { claude: [], codex: ['title'], cursor: [] } });
  assert.deepEqual([...host.querySelectorAll('[data-setting="run.engine"] option')].map((o) => o.value).filter(Boolean), ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'goose', 'opencode', 'qwen']);
  assert.deepEqual([...host.querySelectorAll('.engine-card')].map((c) => c.dataset.engine), ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'goose', 'opencode', 'qwen']);
  const copilot = host.querySelector('.engine-card[data-engine="copilot"]');
  assert.ok(copilot.querySelector('[data-setting="models.copilot.steps.planner"]'), 'Copilot has step rows');
  assert.match(copilot.querySelector('.engine-helpers .engine-slot-rest').textContent, /^Copilot runs its helper jobs .* on its own default model\.$/);
  const card = host.querySelector('.engine-card[data-engine="cursor"]');
  assert.equal(card.querySelector('h3').firstChild.textContent, 'Cursor');
  assert.equal(card.querySelector('h3 .beta-badge')?.textContent, 'Beta');
  const plan = card.querySelector('[data-setting="models.cursor.steps.planner"] .inherit-model');
  assert.deepEqual([...plan.options].map((o) => o.value), ['', 'my-cursor-m']);
  assert.match(plan.options[0].textContent, /Cursor's default model/);
  assert.equal(card.querySelector('.engine-helpers .engine-slot'), null, 'no helper rows');
  assert.equal(card.querySelector('.engine-helpers h4').textContent, 'Helper jobs');
  assert.match(card.querySelector('.engine-helpers .engine-slot-rest').textContent, /^Cursor runs its helper jobs \(titles, overview, PR description, Auto classifier, Away mode's decider\) on Claude\. See the Claude tab\.$/);
  assert.ok(card.querySelector('.engine-card-status'), 'a status line app.js fills');
  assert.equal(host.querySelector('.engine-card[data-engine="claude"] .engine-card-status'), null);
  assert.deepEqual(enginePatchToSettingsBody({ 'models.cursor.steps.planner': { model: 'my-cursor-m' } }), { stepModels: { cursor: { planner: { model: 'my-cursor-m' } } } });
});

for (const [engine, label] of [['gemini', 'Gemini CLI'], ['qwen', 'Qwen Code']]) {
  test(`renderEngineSection: the ${label} card is Cursor's shape: steps only, its default label, the Claude-helpers note`, () => {
    const doc = new JSDOM('<!doctype html><div id="h"></div>').window.document;
    const host = doc.getElementById('h');
    renderEngineSection(host, { level: 'user', roles: STEPS, catalog: [...CATALOG, { id: 'm1', label: 'm1', engine, efforts: [], custom: 'global' }], fields: {} });
    const card = host.querySelector(`.engine-card[data-engine="${engine}"]`);
    assert.equal(card.querySelector('h3').firstChild.textContent, label);
    assert.equal(card.querySelector('h3 .beta-badge')?.textContent, 'Beta');
    const plan = card.querySelector(`[data-setting="models.${engine}.steps.planner"] .inherit-model`);
    assert.deepEqual([...plan.options].map((o) => o.value), ['', 'm1']);
    assert.match(plan.options[0].textContent, new RegExp(`${label}'s default model`));
    assert.equal(card.querySelector('.engine-helpers .engine-slot'), null, 'no helper rows');
    assert.equal(card.querySelector('.engine-helpers .engine-slot-rest').textContent,
      `${label} runs its helper jobs (titles, overview, PR description, Auto classifier, Away mode's decider) on Claude. See the Claude tab.`);
    assert.deepEqual(enginePatchToSettingsBody({ [`models.${engine}.steps.planner`]: { model: 'm1' } }), { stepModels: { [engine]: { planner: { model: 'm1' } } } });
  });
}

test('renderAskEngineSection offers no Cursor engine', () => {
  const doc = new JSDOM('<!doctype html><div id="h"></div>').window.document;
  const host = doc.getElementById('h');
  renderAskEngineSection(host, { catalog: CATALOG });
  assert.deepEqual([...host.querySelectorAll('[data-setting="askEngine"] option')].map((o) => o.value).filter(Boolean), ['codex', 'copilot', 'gemini', 'goose', 'opencode', 'qwen'], 'Claude is the default option, listed once');
  assert.match(host.textContent, /Chat on Qwen Code needs a Qwen Code model: add one on the Models page\./, 'an engine that ships no model says how to get one');
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

test('the Models page: stored picks paint, Claude\'s helper jobs are rows of its tab, Save posts the changes', async () => {
  const { doc, window, posts, tick } = await boot({ runEngine: 'codex', stepModels: { codex: { planner: { model: 'gpt-5.5', effort: 'low' } } }, utilityModels: {} });
  const root = doc.getElementById('engine-settings-root');
  assert.ok(root, 'the section is on the Models page');
  assert.equal(root.querySelector('[data-setting="run.engine"] .inherit-input').value, 'codex');
  assert.equal(root.querySelector('[data-setting="models.codex.steps.planner"] .inherit-model').value, 'gpt-5.5');
  const claude = doc.querySelector('.engine-card[data-engine="claude"]');
  for (const job of ['utility.title', 'utility.classifier', 'utility.prDescription', 'memoryDefrag', 'utility.agentGen']) {
    assert.ok(claude.querySelector(`.engine-helpers [data-setting="models.claude.${job}"]`), `${job} is a Helper jobs row`);
  }
  assert.match(claude.querySelector('[data-setting="models.claude.utility.agentGen"]').textContent, /Agent generation/);
  assert.equal(root.querySelector('[data-setting*=".agentGen"]:not([data-setting="models.claude.utility.agentGen"])'), null, 'agent generation runs on Claude only: no other engine has the row');
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

test('the Models page: a Claude helper row saves onto its legacy key (titleModel, a model only; memoryDefrag, a pair)', async () => {
  const { doc, window, posts, tick } = await boot({ titleModel: null, memoryDefrag: { model: null, effort: null } }, { hash: 'models' });
  const root = doc.getElementById('engine-settings-root');
  const pick = (id, value, part = '.inherit-model') => {
    const sel = root.querySelector(`[data-setting="${id}"] ${part}`);
    sel.value = value; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  pick('models.claude.utility.title', 'claude-opus-5-5');
  pick('models.claude.memoryDefrag', 'claude-opus-5-5');
  doc.getElementById('engineSettingsSave').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(posts.at(-1).titleModel, 'claude-opus-5-5');
  assert.equal(posts.at(-1).memoryDefrag.model, 'claude-opus-5-5');
  assert.equal(posts.at(-1).utilityModels, undefined, 'never under utilityModels.claude');
});

test('the Models page: the Agent generation row paints the stored pair and saves onto agentGenModel', async () => {
  const { doc, window, posts, tick } = await boot({ agentGenModel: { model: 'claude-opus-5-5', effort: 'high' } }, { hash: 'models' });
  const row = doc.querySelector('[data-setting="models.claude.utility.agentGen"]');
  assert.equal(row.querySelector('.inherit-model').value, 'claude-opus-5-5');
  assert.equal(row.querySelector('.inherit-effort').value, 'high');
  assert.equal(row.querySelector('.inherit-effort').disabled, false, 'the row takes an effort, unlike Titles');
  const effort = row.querySelector('.inherit-effort');
  effort.value = 'max'; effort.dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.getElementById('engineSettingsSave').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(posts.at(-1), { agentGenModel: { model: 'claude-opus-5-5', effort: 'max' } });
  const model = row.isConnected ? row.querySelector('.inherit-model') : doc.querySelector('[data-setting="models.claude.utility.agentGen"] .inherit-model');
  model.value = ''; model.dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.getElementById('engineSettingsSave').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(posts.at(-1), { agentGenModel: null }, 'a cleared row clears the setting');
});

test('the Models page: Run naming is a Claude Helper jobs row only while smartRunNaming is on', async () => {
  const { doc, window, posts, tick } = await boot({ namingModel: { model: 'claude-opus-5-5', effort: 'high' } }, { hash: 'models' });
  const sel = '[data-setting="models.claude.utility.naming"]';
  assert.equal(doc.querySelector(sel), null, 'flag off: no Run naming row');
  applyFlags({ smartRunNaming: true }, doc);
  for (let i = 0; i < 8; i++) await tick();
  const claude = doc.querySelector('.engine-card[data-engine="claude"]');
  const row = claude.querySelector(`.engine-helpers ${sel}`);
  assert.ok(row, 'flag on: a Claude Helper jobs row');
  assert.match(row.textContent, /Run naming/);
  assert.equal(row.querySelector('.inherit-model').value, 'claude-opus-5-5');
  assert.equal(row.querySelector('.inherit-effort').value, 'high');
  assert.equal(doc.querySelector(`[data-setting*=".naming"]:not(${sel})`), null, 'Claude only: no Codex/Cursor row');
  const model = row.querySelector('.inherit-model');
  model.value = ''; model.dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.getElementById('engineSettingsSave').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(posts.at(-1), { namingModel: null }, 'a cleared row clears the setting');
  applyFlags({ smartRunNaming: false }, doc);
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(doc.querySelector(sel), null, 'flag off again: the row is gone');
});

test('opening the Models page directly paints the Engines card (a link or a reload lands there)', async () => {
  const { doc } = await boot({ runEngine: 'codex' }, { hash: 'models' });
  const root = doc.getElementById('engine-settings-root');
  assert.equal(root.querySelector('[data-setting="run.engine"] .inherit-input')?.value, 'codex', 'painted without visiting another Settings tab first');
  assert.ok(root.querySelector('[data-setting="models.claude.utility.title"] .inherit-model')?.options.length > 1, 'the Claude helper rows too');
});

test('the Models page: each non-Claude card says whether its engine is ready (GET /api/engines)', async () => {
  const { doc } = await boot({}, { hash: 'models', engines: [
    { name: 'claude', label: 'Claude', ready: true, reason: null },
    { name: 'codex', label: 'Codex', ready: true, reason: 'could not check the codex sign-in' },
    { name: 'cursor', label: 'Cursor', ready: false, reason: 'cursor-agent is not signed in' },
  ] });
  const status = (e) => doc.querySelector(`.engine-card[data-engine="${e}"] .engine-card-status`)?.textContent;
  assert.equal(status('cursor'), "Cursor can't start runs yet: cursor-agent is not signed in.");
  assert.equal(status('codex'), 'Codex can start runs: its CLI is installed and signed in. Note: could not check the codex sign-in.');
  assert.equal(status('claude'), undefined, 'the Claude card has no status line');
  const { doc: none } = await boot({}, { hash: 'models' });
  assert.equal(none.querySelector('.engine-card[data-engine="cursor"] .engine-card-status').textContent, '', 'no engines array: an empty line');
});

// Scale: one engine card at a time (the default engine's first), and each card lists only the slots set at this
// level; the rest are summed up in one line, "+ Override a step…" reveals one, Show all reveals every slot.
test('renderEngineSection: one card at a time, only the changed steps, one-line summary, override and show all', () => {
  const doc = new JSDOM('<!doctype html><div id="h"></div>').window.document;
  const host = doc.getElementById('h');
  const roles = [{ key: 'planner', label: 'Plan' }, { key: 'implementer', label: 'Implement' }, { key: 'reviewer', label: 'Review' }];
  const fields = {
    'run.engine': { own: undefined, inherited: { value: 'codex', source: 'user' } },
    'models.codex.steps.reviewer': { own: { model: 'gpt-5.5', effort: 'high' }, inherited: { value: undefined, source: 'default' } },
  };
  renderEngineSection(host, { level: 'project', roles, catalog: CATALOG, fields, jobs: { claude: [], codex: [], cursor: [] } });
  const cards = () => [...host.querySelectorAll('.engine-card')].filter((c) => !c.hidden).map((c) => c.dataset.engine);
  assert.deepEqual(cards(), ['codex'], 'the default engine\'s card first');
  assert.equal(host.querySelector('.engine-switch').dataset.minLevel, 'expert');
  assert.equal(host.querySelector('.engine-card').dataset.minLevel, 'advanced');
  const codex = host.querySelector('.engine-card[data-engine="codex"]');
  const visible = () => [...codex.querySelectorAll('.engine-slot')].filter((r) => !r.hidden).map((r) => r.dataset.setting);
  assert.deepEqual(visible(), ['models.codex.steps.reviewer']);
  assert.equal(codex.querySelector('.engine-slot-rest').textContent, '2 other steps follow your settings.');
  const add = codex.querySelector('.engine-slot-add');
  assert.deepEqual([...add.options].map((o) => o.textContent), ['Override a step…', 'Plan', 'Implement']);
  add.value = 'models.codex.steps.planner';
  add.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  assert.deepEqual(visible(), ['models.codex.steps.planner', 'models.codex.steps.reviewer']);
  assert.equal(codex.querySelector('.engine-slot-rest').textContent, '1 other step follows your settings.');
  const all = codex.querySelector('.engine-slot-all');
  all.click();
  assert.equal(visible().length, 3);
  assert.equal(all.textContent, 'Show only changes');
  all.click();
  assert.deepEqual(visible(), ['models.codex.steps.reviewer'], 'an untouched revealed row folds away again');
  host.querySelector('.engine-switch button[data-engine="claude"]').click();
  assert.deepEqual(cards(), ['claude']);
  assert.equal(host.querySelector('.engine-card[data-engine="claude"] .engine-slot-rest').textContent, 'Every step follows your settings.');
});
